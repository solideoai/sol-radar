"""POST /parse 형식 판정과 미지원 응답(docs/03 §10, K7). 모델을 쓰지 않으므로 세 모드에서 같다.

형식은 확장자·Content-Type 이 아니라 내용(매직 바이트)으로 판정한다. 네트워크·DB·MinIO 접근 없음.
파서 어댑터는 아직 없다(형식별 선택은 03 §10.3 비교 뒤). 알려진 형식도 UNSUPPORTED + PARSER_NOT_CONFIGURED 다.
"""

import io
import struct
import zipfile
import zlib
from collections.abc import AsyncIterator

from sol_ai.contracts import ParseResult

MAX_BODY_BYTES = 52_428_800  # 50 MB
FORMATS = ("PDF", "HWPX", "HWP")

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
HWP_SIGNATURE = b"HWP Document File"
HWPX_MIMETYPE = b"application/hwp+zip"
# mimetype 항목은 짧다. 이보다 길면 HWPX 로 보지 않는다(압축 폭탄 방지)
MAX_MIMETYPE_BYTES = 256
_LOCAL_HEADER = struct.Struct("<IHHHHHIIIHH")


async def read_limited(
    chunks: AsyncIterator[bytes], limit: int = MAX_BODY_BYTES
) -> tuple[bytes, bool]:
    """본문을 limit 바이트까지만 읽는다. 넘는 순간 읽기를 멈추고 (앞부분, True)."""
    buffer = bytearray()
    async for chunk in chunks:
        buffer.extend(chunk)
        if len(buffer) > limit:
            return bytes(buffer[:limit]), True
    return bytes(buffer), False


def _first_entry_mimetype(data: bytes) -> bytes | None:
    """zip 첫 항목이 mimetype 이면 그 내용. 잘린 앞부분에서도 읽을 수 있게 로컬 헤더를 직접 본다."""
    if len(data) < _LOCAL_HEADER.size:
        return None
    _, _, flags, method, _, _, _, size, _, name_len, extra_len = _LOCAL_HEADER.unpack_from(data)
    start = _LOCAL_HEADER.size
    if data[start : start + name_len] != b"mimetype" or flags & 0x08:
        return None
    body = data[start + name_len + extra_len :][: min(size, MAX_MIMETYPE_BYTES + 1)]
    if method == zipfile.ZIP_STORED:
        return body
    if method == zipfile.ZIP_DEFLATED:
        try:
            return zlib.decompressobj(-zlib.MAX_WBITS).decompress(body, MAX_MIMETYPE_BYTES + 1)
        except zlib.error:
            return None
    return None


def _central_mimetype(data: bytes) -> bytes | None:
    """첫 항목이 아니면 중앙 디렉터리에서 mimetype 항목을 찾는다(본문 전체가 있을 때만 된다)."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo("mimetype")
            if info.file_size > MAX_MIMETYPE_BYTES:
                return None
            return archive.read(info)
    except (zipfile.BadZipFile, KeyError, RuntimeError, ValueError, zlib.error, EOFError):
        return None


def detect_format(data: bytes) -> str:
    if data.startswith(PDF_MAGIC):
        return "PDF"
    if data.startswith(ZIP_MAGIC):
        mimetype = _first_entry_mimetype(data)
        if mimetype is None:
            mimetype = _central_mimetype(data)
        return "HWPX" if mimetype is not None and mimetype.strip() == HWPX_MIMETYPE else "UNKNOWN"
    if data.startswith(OLE_MAGIC):
        return "HWP" if HWP_SIGNATURE in data else "UNKNOWN"
    return "UNKNOWN"


def _unsupported(fmt: str, error_code: str, warnings: list[str]) -> ParseResult:
    return ParseResult(
        status="UNSUPPORTED",
        format=fmt,
        parserId="none",
        text="",
        pages=[],
        blocks=[],
        quality=None,
        errorCode=error_code,
        warnings=warnings,
    )


def parse_document(data: bytes, too_large: bool) -> ParseResult:
    """too_large 면 앞부분으로 형식만 판정한다."""
    fmt = detect_format(data)
    if too_large:
        return _unsupported(fmt, "TOO_LARGE", [])
    if fmt == "UNKNOWN":
        return _unsupported(fmt, "UNSUPPORTED_FORMAT", [])
    # 등록된 파서 어댑터가 아직 없다
    return _unsupported(fmt, "UNSUPPORTED_FORMAT", [f"PARSER_NOT_CONFIGURED:{fmt}"])


def parser_inventory() -> list[dict]:
    """GET /health 의 parsers. 등록된 어댑터가 없으므로 parserId 는 모두 null."""
    return [{"format": fmt, "parserId": None} for fmt in FORMATS]
