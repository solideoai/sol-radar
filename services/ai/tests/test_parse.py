"""POST /parse 형식 판정·텍스트 추출·거절 경로(03 §2.1·§10.1·§10.5, 15 §5.1, 명세 §4, K7).

형식은 확장자·Content-Type 이 아니라 내용(매직 바이트)으로 판정한다. 시험 문서는 tests/documents.py 가
바이트로 합성한다(실제 공고 첨부는 저장소에 넣지 않는다).
"""

import asyncio
import io
import json
import sys
import time
import zipfile

import pytest
from documents import (
    CTRL_HEADER,
    LIST_HEADER,
    hwp_bytes,
    hwpx_bytes,
    hwpx_paragraph,
    hwpx_section,
    hwpx_table,
    inline_control,
    paragraph,
    pdf_bytes,
    record,
    table_control,
    text_units,
    wchars,
)

from sol_ai.citation import norm
from sol_ai.parse import DocumentParser
from sol_ai.parsers import DEFAULTS
from sol_ai.parsers.document import Limits, run

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


# ---------------------------------------------------------------- 형식별 추출(03 §10.1)

# 빈 셀이 표 맨 앞·행 끝에 있어도 공백이 겹치지 않아야 한다(실표본에서 찾은 결함, norm(text) = text)
TABLE_ROWS = [["", "금액"], ["예산", ""], ["합계", "450,000,000원"]]
EXPECTED_CELLS = [
    (0, 0, ""),
    (0, 1, "금액"),
    (1, 0, "예산"),
    (1, 1, ""),
    (2, 0, "합계"),
    (2, 1, "450,000,000원"),
]
TABLE_TEXT = "| 금액 예산 | 합계 | 450,000,000원"


def cells_of(result: dict) -> list[tuple[int, int, str]]:
    tables = [b for b in result["blocks"] if b["kind"] == "table"]
    assert len(tables) == 1
    text = result["text"]
    return [(c["r"], c["c"], text[c["charStart"] : c["charEnd"]]) for c in tables[0]["cells"]]


def assert_parsed(result: dict, fmt: str, text: str) -> None:
    assert (result["status"], result["format"], result["errorCode"]) == ("PARSED", fmt, None)
    assert result["parserId"] == DEFAULTS[fmt].parser_id
    assert result["text"] == text
    # 15 §5.1: text 는 이미 정규화돼 있어 인용 오프셋을 그대로 쓴다
    assert norm(result["text"]) == result["text"]


def test_pdf_text_and_table_cells(make_client):
    body = [
        (72, 760 - 14 * i, f"Line {i}: bidders must hold a software business registration.")
        for i in range(5)
    ]
    cells = [
        (80, 655, "Item"),
        (280, 655, "Amount"),
        (80, 615, "Budget"),
        (280, 615, "450,000,000 KRW"),
    ]
    grid = [(72, 640, 200, 40), (272, 640, 200, 40), (72, 600, 200, 40), (272, 600, 200, 40)]
    result = post(make_client(), pdf_bytes(body + cells, grid), "rfp.hwp", "application/x-hwp")
    paragraph_text = " ".join(text for _, _, text in body)
    assert_parsed(result, "PDF", f"{paragraph_text} Item | Amount Budget | 450,000,000 KRW")
    assert result["pages"] == [{"page": 1, "charOffset": 0}]
    assert cells_of(result) == [
        (0, 0, "Item"),
        (0, 1, "Amount"),
        (1, 0, "Budget"),
        (1, 1, "450,000,000 KRW"),
    ]


def test_hwpx_text_and_table_cells_without_header(make_client):
    header = f"<hp:ctrl><hp:header><hp:subList>{hwpx_paragraph('쪽머리')}</hp:subList></hp:header></hp:ctrl>"
    body = f"<hp:p><hp:run>{header}<hp:t>참가자격:<hp:tab/>소프트웨어사업자</hp:t></hp:run></hp:p>"
    data = hwpx_bytes(hwpx_section(body + hwpx_table(TABLE_ROWS)))
    result = post(make_client(), data, "rfp.zip", "application/octet-stream")
    assert_parsed(result, "HWPX", f"참가자격: 소프트웨어사업자 {TABLE_TEXT}")
    assert result["pages"] == []
    assert cells_of(result) == EXPECTED_CELLS


def hwp_body() -> bytes:
    """문단 글자(탭·줄바꿈 제어 포함) + 표 + 머리말 컨트롤이 있는 HWP 5.0 본문 레코드."""
    first = (
        text_units("참가자격:")
        + inline_control(9)
        + text_units("소프트웨어사업자")
        + wchars(10)
        + text_units("등록")
        + inline_control(11, b"tbl ")
    )
    header = (
        record(CTRL_HEADER, 1, b"head"[::-1] + b"\0" * 10)
        + record(LIST_HEADER, 2, b"\0" * 16)
        + paragraph(2, text_units("쪽머리"))
    )
    return paragraph(0, first, table_control(1, TABLE_ROWS)) + paragraph(
        0, text_units("본문"), header
    )


def test_hwp5_text_controls_and_table_cells(make_client):
    result = post(make_client(), hwp_bytes(hwp_body()), "rfp.pdf", "application/pdf")
    assert_parsed(result, "HWP", f"참가자격: 소프트웨어사업자 등록 {TABLE_TEXT} 본문")
    assert cells_of(result) == EXPECTED_CELLS


# ---------------------------------------------------------------- 거절 경로(03 §10.2·§10.5, 09)


@pytest.mark.parametrize(
    ("flags", "code"),
    [(0x1 | 0x2, "ENCRYPTED"), (0x1 | 0x4, "DISTRIBUTION_PROTECTED")],
)
def test_protected_hwp_is_not_opened(make_client, flags, code):
    result = post(make_client(), hwp_bytes(hwp_body(), flags))
    assert (result["status"], result["errorCode"], result["text"]) == ("UNSUPPORTED", code, "")


def test_scanned_pdf_has_no_text_layer(make_client):
    result = post(make_client(), pdf_bytes([], [(72, 600, 200, 40)]))
    assert (result["status"], result["format"], result["errorCode"]) == (
        "UNSUPPORTED",
        "PDF",
        "NO_TEXT_LAYER",
    )


@pytest.mark.parametrize(
    ("content", "fmt"),
    [
        (PDF, "PDF"),
        (hwpx_bytes(b"<hs:sec><hp:p>"), "HWPX"),
        (HWP, "HWP"),
    ],
)
def test_corrupted_document_fails_with_reason(make_client, content, fmt):
    result = post(make_client(), content)
    assert (result["status"], result["format"], result["errorCode"]) == ("FAILED", fmt, "CORRUPTED")


def test_hwpx_rejects_dtd_and_entities(make_client):
    entity_bomb = (
        b'<?xml version="1.0"?><!DOCTYPE sec [<!ENTITY a "aaaaaaaaaa">'
        b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><sec>&b;</sec>'
    )
    result = post(make_client(), hwpx_bytes(entity_bomb))
    assert (result["status"], result["errorCode"], result["warnings"]) == (
        "FAILED",
        "CORRUPTED",
        ["XML_DTD_REJECTED"],
    )


def test_zip_bomb_stops_at_unpacked_limit():
    # 4 KiB 상한에 1 MiB 로 풀리는 섹션. 상한을 넘는 순간 멈춘다(압축 해제 총량, 09)
    section = hwpx_section(hwpx_paragraph("가" * 400_000))
    data = hwpx_bytes(section)
    assert len(data) < 8_192
    spec = DEFAULTS["HWPX"]
    result = run("HWPX", spec.parser_id, spec.load(), data, Limits(max_unpacked_bytes=4_096))
    assert (result.status, result.errorCode, result.warnings) == (
        "UNSUPPORTED",
        "TOO_LARGE",
        ["UNPACKED_LIMIT"],
    )


def test_parser_timeout_kills_worker():
    parser = DocumentParser(
        dict(DEFAULTS),
        timeout_seconds=0.5,
        worker_command=[sys.executable, "-c", "import time; time.sleep(30)"],
    )
    started = time.perf_counter()
    result = asyncio.run(parser.parse(PDF, False))
    assert (result.status, result.errorCode, result.warnings) == (
        "FAILED",
        "PARSER_ERROR",
        ["PARSE_TIMEOUT"],
    )
    assert time.perf_counter() - started < 5


def test_unknown_parser_setting_is_not_configured(make_client, monkeypatch):
    monkeypatch.setenv("PARSER_PDF", "pymupdf")
    client = make_client()
    result = post(client, PDF)
    assert (result["status"], result["errorCode"], result["warnings"]) == (
        "UNSUPPORTED",
        "UNSUPPORTED_FORMAT",
        ["PARSER_NOT_CONFIGURED:PDF"],
    )
    parsers = {p["format"]: p["parserId"] for p in client.get("/health").json()["parsers"]}
    assert parsers["PDF"] is None
