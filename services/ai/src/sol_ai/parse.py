"""POST /parse 형식 판정과 격리 실행(docs/03 §10, K7). 모델을 쓰지 않으므로 세 모드에서 같다.

형식은 확장자·Content-Type 이 아니라 내용(매직 바이트)으로 판정한다. 네트워크·DB·Supabase Storage 접근 없음.
형식별 어댑터(sol_ai.parsers)는 요청마다 격리 하위 프로세스에서 돌린다. 처리 시간을 넘기거나
프로세스가 죽어도 gateway 는 살아 있고, 결과는 사유 코드가 있는 ParseResult 다.
"""

import asyncio
import io
import logging
import struct
import sys
import zipfile
import zlib
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

from pydantic import ValidationError

from sol_ai.contracts import ParseResult
from sol_ai.parsers import ParserSpec, select
from sol_ai.parsers.document import failure_result

logger = logging.getLogger("sol_ai")

MAX_BODY_BYTES = 52_428_800  # 50 MB
FORMATS = ("PDF", "HWPX", "HWP")
PARSER_SETTINGS = {"PDF": "PARSER_PDF", "HWPX": "PARSER_HWPX", "HWP": "PARSER_HWP"}
# 문서 하나의 처리 시간 상한. 300쪽 PDF 도 이 안에 끝난다(docs/evidence/parser/20261027-parser-check.md)
PARSE_TIMEOUT_SECONDS = 90.0
# 동시에 띄우는 파서 프로세스 수. 넘는 요청은 차례를 기다린다
MAX_CONCURRENT_PARSES = 2

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
HWP_SIGNATURE = b"HWP Document File"
HWPX_MIMETYPE = b"application/hwp+zip"
# mimetype 항목은 짧다. 이보다 길면 HWPX 로 보지 않는다(압축 폭탄 방지)
MAX_MIMETYPE_BYTES = 256
_LOCAL_HEADER = struct.Struct("<IHHHHHIIIHH")

# 하위 프로세스가 sol_ai 를 찾을 경로(설치 위치·Vercel _vendor 어디든 이 파일 기준)
_PACKAGE_PARENT = str(Path(__file__).resolve().parent.parent)
_BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from sol_ai.parsers.worker import main; raise SystemExit(main(sys.argv[2]))"
)


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
    return failure_result(fmt, "none", "UNSUPPORTED", error_code, warnings)


def _parser_error(fmt: str, spec: ParserSpec, warning: str) -> ParseResult:
    return failure_result(fmt, spec.parser_id, "FAILED", "PARSER_ERROR", [warning])


class DocumentParser:
    """형식 판정 → 어댑터 선택 → 격리 프로세스 실행. 앱마다 하나 만든다."""

    def __init__(
        self,
        selected: dict[str, ParserSpec | None],
        timeout_seconds: float = PARSE_TIMEOUT_SECONDS,
        max_concurrent: int = MAX_CONCURRENT_PARSES,
        worker_command: Sequence[str] | None = None,
    ) -> None:
        self._selected = selected
        self._timeout = timeout_seconds
        self._slots = asyncio.Semaphore(max_concurrent)
        self._worker_command = (
            list(worker_command)
            if worker_command is not None
            else [sys.executable, "-I", "-X", "utf8", "-c", _BOOTSTRAP, _PACKAGE_PARENT]
        )

    @classmethod
    def from_settings(cls, settings) -> "DocumentParser":
        selected: dict[str, ParserSpec | None] = {}
        for fmt, key in PARSER_SETTINGS.items():
            configured = getattr(settings, key)
            spec = select(fmt, configured)
            if spec is None:
                # 모르는 어댑터 id 는 설정 실수다. 그 형식만 PARSER_NOT_CONFIGURED 로 응답한다
                logger.warning(
                    "%s 값이 등록된 %s 어댑터가 아니다. 이 형식은 처리하지 않는다", key, fmt
                )
            selected[fmt] = spec
        return cls(selected)

    def inventory(self) -> list[dict]:
        """GET /health 의 parsers."""
        return [
            {"format": fmt, "parserId": spec.parser_id if spec is not None else None}
            for fmt in FORMATS
            for spec in [self._selected.get(fmt)]
        ]

    async def parse(self, data: bytes, too_large: bool) -> ParseResult:
        """too_large 면 앞부분으로 형식만 판정한다."""
        fmt = detect_format(data)
        if too_large:
            return _unsupported(fmt, "TOO_LARGE", [])
        if fmt == "UNKNOWN":
            return _unsupported(fmt, "UNSUPPORTED_FORMAT", [])
        spec = self._selected.get(fmt)
        if spec is None:
            return _unsupported(fmt, "UNSUPPORTED_FORMAT", [f"PARSER_NOT_CONFIGURED:{fmt}"])
        async with self._slots:
            return await self._run(fmt, spec, data)

    async def _run(self, fmt: str, spec: ParserSpec, data: bytes) -> ParseResult:
        process = await asyncio.create_subprocess_exec(
            *self._worker_command,
            spec.adapter_id,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            # 파서 예외 메시지에 문서 조각이 섞일 수 있어 stderr 는 버린다
            stderr=asyncio.subprocess.DEVNULL,
            env={},
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(data), self._timeout)
        except TimeoutError:
            return _parser_error(fmt, spec, "PARSE_TIMEOUT")
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        if process.returncode != 0:
            return _parser_error(fmt, spec, f"PARSER_EXIT:{process.returncode}")
        try:
            result = ParseResult.model_validate_json(stdout)
        except ValidationError:
            return _parser_error(fmt, spec, "PARSER_OUTPUT_INVALID")
        if result.format != fmt:
            return _parser_error(fmt, spec, "PARSER_OUTPUT_INVALID")
        return result
