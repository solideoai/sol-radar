"""POST /parse 형식 판정·미지원 응답(03 §2.1·§10.1·§10.5, 명세 §4, K7).

형식은 확장자·Content-Type 이 아니라 내용(매직 바이트)으로 판정한다. 파서 어댑터는 아직 없다.
"""

import asyncio
import io
import json
import zipfile

import pytest
from support import canonical

LIMIT = 52_428_800  # 50 MB
CHUNK = 1 << 20
PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
OLE_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")


def zip_bytes(entries: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries:
            archive.writestr(zipfile.ZipInfo(name), data, compress_type=zipfile.ZIP_STORED)
    return buffer.getvalue()


HWPX = zip_bytes([("mimetype", b"application/hwp+zip"), ("Contents/section0.xml", b"<hs:sec/>")])
EPUB_LIKE_ZIP = zip_bytes([("mimetype", b"application/epub+zip"), ("content.opf", b"<package/>")])
PLAIN_ZIP = zip_bytes([("readme.txt", b"hello")])
# OLE 헤더 512바이트 뒤에 HWP FileHeader 스트림 서명을 둔다
HWP = OLE_SIGNATURE + b"\0" * 504 + b"HWP Document File" + b"\0" * 495
OLE_OTHER = OLE_SIGNATURE + b"\0" * 504 + b"Microsoft Excel Workbook" + b"\0" * 488
TEXT = "제안요청서 본문입니다.".encode()
PNG = bytes.fromhex("89504E470D0A1A0A") + b"\0" * 64


def headers(file_name: str, content_type: str) -> dict:
    return {"X-File-Name": file_name, "Content-Type": content_type, "X-Request-Id": "req-parse-1"}


def post(
    client, content, file_name: str = "rfp.bin", content_type: str = "application/octet-stream"
):
    response = client.post("/parse", content=content, headers=headers(file_name, content_type))
    assert response.status_code == 200
    return response.json()


def test_parse_response_has_contract_keys(make_client):
    assert set(post(make_client(), PDF, "rfp.pdf", "application/pdf")) == {
        "status",
        "format",
        "parserId",
        "text",
        "pages",
        "blocks",
        "quality",
        "errorCode",
        "warnings",
    }


@pytest.mark.parametrize(
    ("content", "file_name", "content_type", "fmt"),
    [
        (PDF, "rfp.pdf", "application/pdf", "PDF"),
        (HWPX, "rfp.hwpx", "application/hwp+zip", "HWPX"),
        (HWP, "rfp.hwp", "application/x-hwp", "HWP"),
    ],
)
def test_known_format_without_parser_is_unsupported_with_warning(
    make_client, content, file_name, content_type, fmt
):
    result = post(make_client(), content, file_name, content_type)
    assert (result["status"], result["format"], result["errorCode"], result["warnings"]) == (
        "UNSUPPORTED",
        fmt,
        "UNSUPPORTED_FORMAT",
        [f"PARSER_NOT_CONFIGURED:{fmt}"],
    )


@pytest.mark.parametrize("content", [PDF, HWPX, HWP], ids=["PDF", "HWPX", "HWP"])
def test_unparsed_result_is_empty_with_none_parser(make_client, content):
    result = post(make_client(), content)
    assert (
        result["parserId"],
        result["text"],
        result["pages"],
        result["blocks"],
        result["quality"],
    ) == ("none", "", [], [], None)


@pytest.mark.parametrize(
    "content",
    [EPUB_LIKE_ZIP, PLAIN_ZIP, OLE_OTHER, TEXT, PNG],
    ids=["zip_other_mimetype", "zip_without_mimetype", "ole_without_hwp", "text", "png"],
)
def test_unknown_content_is_unsupported_format(make_client, content):
    result = post(make_client(), content)
    assert (result["status"], result["format"], result["errorCode"]) == (
        "UNSUPPORTED",
        "UNKNOWN",
        "UNSUPPORTED_FORMAT",
    )
    assert [w for w in result["warnings"] if w.startswith("PARSER_NOT_CONFIGURED")] == []


@pytest.mark.parametrize(
    ("content", "file_name", "content_type", "fmt"),
    [
        (PDF, "rfp.hwp", "application/x-hwp", "PDF"),
        (HWP, "rfp.pdf", "application/pdf", "HWP"),
        (HWPX, "rfp.zip", "application/zip", "HWPX"),
        (TEXT, "rfp.pdf", "application/pdf", "UNKNOWN"),
        (PLAIN_ZIP, "rfp.hwpx", "application/hwp+zip", "UNKNOWN"),
    ],
)
def test_format_is_judged_by_content_not_name_or_type(
    make_client, content, file_name, content_type, fmt
):
    assert post(make_client(), content, file_name, content_type)["format"] == fmt


def big_pdf(total: int):
    head = b"%PDF-1.7\n"
    yield head
    remaining = total - len(head)
    block = b"\0" * CHUNK
    while remaining > 0:
        size = min(CHUNK, remaining)
        yield block if size == CHUNK else block[:size]
        remaining -= size


def test_body_over_50mb_is_too_large(make_client):
    result = post(make_client(), big_pdf(LIMIT + 1), "big.pdf", "application/pdf")
    assert (result["status"], result["errorCode"], result["format"]) == (
        "UNSUPPORTED",
        "TOO_LARGE",
        "PDF",
    )


def test_body_of_exactly_50mb_is_not_too_large(make_client):
    result = post(make_client(), big_pdf(LIMIT), "big.pdf", "application/pdf")
    assert (result["errorCode"], result["warnings"]) == (
        "UNSUPPORTED_FORMAT",
        ["PARSER_NOT_CONFIGURED:PDF"],
    )


def test_parse_stops_reading_body_after_limit(make_client):
    """ASGI 로 직접 1 MiB 씩 60 MiB 를 흘려 보내고, gateway 가 50 MB 를 넘긴 뒤 더 읽지 않는지 센다."""
    app = make_client().app
    total_chunks = 60
    state = {"sent": 0, "consumed": 0}
    messages: list[dict] = []

    async def receive() -> dict:
        if state["sent"] >= total_chunks:
            return {"type": "http.request", "body": b"", "more_body": False}
        body = b"%PDF-1.7\n" + b"\0" * (CHUNK - 9) if state["sent"] == 0 else b"\0" * CHUNK
        state["sent"] += 1
        state["consumed"] += len(body)
        return {"type": "http.request", "body": body, "more_body": state["sent"] < total_chunks}

    async def send(message: dict) -> None:
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/parse",
        "raw_path": b"/parse",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/pdf"),
            (b"x-file-name", b"big.pdf"),
            (b"x-request-id", b"req-parse-big"),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    assert (status, json.loads(body)["errorCode"]) == (200, "TOO_LARGE")
    assert state["consumed"] <= LIMIT + CHUNK


def test_parse_is_deterministic(make_client):
    client = make_client()
    assert canonical(post(client, HWPX)) == canonical(post(client, HWPX))


@pytest.mark.parametrize("content", [PDF, HWPX, HWP, TEXT], ids=["PDF", "HWPX", "HWP", "text"])
def test_parse_is_same_in_fixture_mode(make_client, local_models, content):
    mock = post(make_client(), content)
    fixture = post(make_client(SOL_RUN_MODE="fixture"), content)
    assert canonical(fixture) == canonical(mock)
