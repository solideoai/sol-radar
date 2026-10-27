"""HWP 5.0(OLE 복합 문서) 어댑터: olefile(BSD-2-Clause) + zlib.

한글과컴퓨터 공개 문서 "HWP 5.0 파일 구조"를 따른다.
- `FileHeader` 속성 비트: 0 압축, 1 암호, 2 배포용, 4 DRM, 8 공인인증서 암호화, 10 공인인증서 DRM.
  암호·DRM 은 ENCRYPTED, 배포용은 DISTRIBUTION_PROTECTED 다. 보호를 풀지 않는다(03 §10.2).
- `BodyText/Section<N>` 은 raw deflate 다(압축 비트가 있을 때). 압축 해제 총량을 제한한다.
- 레코드 머리 32비트: tag 10비트, level 10비트, size 12비트(0xFFF 면 다음 32비트가 크기).
- 문단(PARA_HEADER 66)의 글자는 PARA_TEXT(67, UTF-16LE). 32 미만 코드는 제어 문자다:
  문자 제어(1 WCHAR) 0·10·13·24~31, 그 밖(인라인·확장 제어)은 8 WCHAR 를 차지한다.
- 표는 CTRL_HEADER(71) id `tbl ` 아래 TABLE(77)·셀마다 LIST_HEADER(72) + 문단이다.
"""

import io
import re
import struct
import sys
import zlib
from array import array
from dataclasses import dataclass, field

import olefile

from sol_ai.parsers.document import (
    Budget,
    Extracted,
    Limits,
    ParseFailure,
    TreeCell,
    TreeParagraph,
    TreeTable,
    flatten,
)

SIGNATURE = b"HWP Document File"
FILE_HEADER = "FileHeader"
SECTION_NAME = re.compile(r"Section(\d+)")

FLAG_COMPRESSED = 1 << 0
FLAG_PASSWORD = 1 << 1
FLAG_DISTRIBUTION = 1 << 2
FLAG_DRM = 1 << 4
FLAG_CERT_ENCRYPTED = 1 << 8
FLAG_CERT_DRM = 1 << 10
ENCRYPTED_FLAGS = FLAG_PASSWORD | FLAG_DRM | FLAG_CERT_ENCRYPTED | FLAG_CERT_DRM

TAG_PARA_HEADER = 66
TAG_PARA_TEXT = 67
TAG_CTRL_HEADER = 71
TAG_LIST_HEADER = 72
TAG_TABLE = 77

CTRL_TABLE = b"tbl "
# 머리말·꼬리말은 쪽마다 반복되는 장식이라 본문에서 뺀다(HWPX 와 같게)
SKIPPED_CTRLS = frozenset({b"head", b"foot"})

# 문자 제어 코드(1 WCHAR)와 그 출력. 나머지 32 미만 코드는 8 WCHAR 인라인·확장 제어다
CHAR_CONTROLS = {0: "", 10: " ", 13: "", 24: "-", 30: " ", 31: " "} | {
    code: "" for code in range(25, 30)
}
TAB = 9
EXTENDED_WCHARS = 8
# olefile 은 손상 유형에 따라 OleFileError(OSError)·struct.error·IndexError 등을 낸다
OLE_ERRORS = (OSError, ValueError, struct.error, IndexError, EOFError)


@dataclass
class Record:
    tag: int
    level: int
    payload: bytes
    children: list["Record"] = field(default_factory=list)


def decode_para_text(payload: bytes) -> str:
    """PARA_TEXT 를 글자로. 탭·줄바꿈·묶음 빈칸은 공백, 하이픈은 '-', 나머지 제어는 지운다."""
    units = array("H")
    units.frombytes(payload[: len(payload) // 2 * 2])
    if sys.byteorder == "big":
        units.byteswap()
    out: list[str] = []
    run_start = 0
    i = 0
    n = len(units)
    while i < n:
        code = units[i]
        if code >= 32:
            i += 1
            continue
        if run_start < i:
            out.append(payload[run_start * 2 : i * 2].decode("utf-16-le", "replace"))
        if code in CHAR_CONTROLS:
            out.append(CHAR_CONTROLS[code])
            i += 1
        else:
            if code == TAB:
                out.append(" ")
            i += EXTENDED_WCHARS
        run_start = i
    if run_start < n:
        out.append(payload[run_start * 2 : n * 2].decode("utf-16-le", "replace"))
    return "".join(out)


def read_records(data: bytes, max_level: int) -> list[Record]:
    """레코드를 읽어 level 로 트리를 만든다. 잘린 레코드는 CORRUPTED 다."""
    root = Record(-1, -1, b"")
    stack = [root]
    pos = 0
    n = len(data)
    while pos < n:
        if pos + 4 > n:
            raise ParseFailure.failed("CORRUPTED", "HWP_RECORD_TRUNCATED")
        (header,) = struct.unpack_from("<I", data, pos)
        pos += 4
        tag, level, size = header & 0x3FF, (header >> 10) & 0x3FF, header >> 20
        if size == 0xFFF:
            if pos + 4 > n:
                raise ParseFailure.failed("CORRUPTED", "HWP_RECORD_TRUNCATED")
            (size,) = struct.unpack_from("<I", data, pos)
            pos += 4
        if pos + size > n:
            raise ParseFailure.failed("CORRUPTED", "HWP_RECORD_TRUNCATED")
        if level > max_level:
            raise ParseFailure.failed("CORRUPTED", "NESTING_LIMIT")
        record = Record(tag, level, data[pos : pos + size])
        pos += size
        while stack[-1].level >= level:
            stack.pop()
        stack[-1].children.append(record)
        stack.append(record)
    return root.children


def _ctrl_id(record: Record) -> bytes:
    # 컨트롤 id 는 리틀 엔디언 32비트라 바이트를 뒤집으면 'tbl ' 처럼 읽힌다
    return record.payload[:4][::-1]


def _u16(payload: bytes, offset: int, default: int) -> int:
    if len(payload) < offset + 2:
        return default
    return struct.unpack_from("<H", payload, offset)[0]


def _table(ctrl: Record) -> TreeTable:
    rows = cols = 0
    cells: list[TreeCell] = []
    current: TreeCell | None = None
    for child in ctrl.children:
        if child.tag == TAG_TABLE:
            rows, cols = _u16(child.payload, 4, 0), _u16(child.payload, 6, 0)
        elif child.tag == TAG_LIST_HEADER:
            # 셀 LIST_HEADER: 문단 수·속성(8바이트) 뒤에 열·행 주소, 열·행 병합 수(각 UINT16)
            current = TreeCell(
                col=_u16(child.payload, 8, 0),
                row=_u16(child.payload, 10, 0),
                col_span=_u16(child.payload, 12, 1),
                row_span=_u16(child.payload, 14, 1),
                paragraphs=_find_paragraphs(child.children),
            )
            cells.append(current)
        elif child.tag == TAG_PARA_HEADER and current is not None:
            current.paragraphs.append(_paragraph(child))
    return TreeTable(rows, cols, cells)


def _paragraph(header: Record) -> TreeParagraph:
    paragraph = TreeParagraph()
    for child in header.children:
        if child.tag == TAG_PARA_TEXT:
            paragraph.parts.append(decode_para_text(child.payload))
    # 개체(표·글상자·각주)는 문단 글자 뒤에 둔다
    for child in header.children:
        if child.tag != TAG_CTRL_HEADER:
            continue
        ctrl = _ctrl_id(child)
        if ctrl in SKIPPED_CTRLS:
            continue
        if ctrl == CTRL_TABLE:
            paragraph.parts.append(_table(child))
        else:
            paragraph.parts.extend(_find_paragraphs(child.children))
    return paragraph


def _find_paragraphs(records: list[Record]) -> list[TreeParagraph]:
    """하위 레코드에서 문단을 찾는다(글상자·각주의 LIST_HEADER 뒤 문단)."""
    found: list[TreeParagraph] = []
    for record in records:
        if record.tag == TAG_PARA_HEADER:
            found.append(_paragraph(record))
        else:
            found.extend(_find_paragraphs(record.children))
    return found


def _inflate(raw: bytes, budget: Budget) -> bytes:
    inflater = zlib.decompressobj(-zlib.MAX_WBITS)
    try:
        out = inflater.decompress(raw, budget.remaining + 1)
    except zlib.error:
        raise ParseFailure.failed("CORRUPTED", "HWP_INFLATE") from None
    budget.spend(len(out))
    return out


def _open(data: bytes) -> olefile.OleFileIO:
    try:
        return olefile.OleFileIO(io.BytesIO(data))
    except OLE_ERRORS:
        raise ParseFailure.failed("CORRUPTED", "OLE_INVALID") from None


def _flags(ole: olefile.OleFileIO) -> int:
    try:
        header = ole.openstream(FILE_HEADER).read(256) if ole.exists(FILE_HEADER) else b""
    except OLE_ERRORS:
        raise ParseFailure.failed("CORRUPTED", "OLE_STREAM") from None
    if len(header) < 40 or not header.startswith(SIGNATURE):
        raise ParseFailure.failed("CORRUPTED", "HWP_NO_FILE_HEADER")
    version, flags = struct.unpack_from("<II", header, 32)
    if version >> 24 != 5:
        raise ParseFailure.unsupported("UNSUPPORTED_FORMAT", "HWP_VERSION")
    return flags


def _sections(ole: olefile.OleFileIO, storage: str) -> list[list[str]]:
    found = []
    for path in ole.listdir(streams=True, storages=False):
        if len(path) == 2 and path[0] == storage and (match := SECTION_NAME.fullmatch(path[1])):
            found.append((int(match.group(1)), path))
    return [path for _, path in sorted(found)]


def extract(data: bytes, limits: Limits) -> Extracted:
    with _open(data) as ole:
        flags = _flags(ole)
        if flags & ENCRYPTED_FLAGS:
            raise ParseFailure.unsupported("ENCRYPTED")
        if flags & FLAG_DISTRIBUTION:
            raise ParseFailure.unsupported("DISTRIBUTION_PROTECTED")
        sections = _sections(ole, "BodyText")
        if not sections:
            # 배포용 문서는 본문을 ViewText 에 암호화해 둔다
            if _sections(ole, "ViewText"):
                raise ParseFailure.unsupported("DISTRIBUTION_PROTECTED")
            raise ParseFailure.failed("CORRUPTED", "HWP_NO_SECTION")
        budget = Budget(limits.max_unpacked_bytes)
        paragraphs: list[TreeParagraph] = []
        for path in sections:
            try:
                raw = ole.openstream(path).read()
            except OLE_ERRORS:
                raise ParseFailure.failed("CORRUPTED", "OLE_STREAM") from None
            body = _inflate(raw, budget) if flags & FLAG_COMPRESSED else raw
            if not flags & FLAG_COMPRESSED:
                budget.spend(len(body))
            paragraphs.extend(_find_paragraphs(read_records(body, limits.max_depth)))
    return Extracted([flatten(paragraphs)], paged=False)
