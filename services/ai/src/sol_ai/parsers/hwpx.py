"""HWPX(OWPML) 어댑터: 표준 zipfile + expat. 외부 의존성 없음.

- `Contents/section<N>.xml` 을 번호 순서로 읽는다. 문단 `p`, 글자 `t`, 표 `tbl`·`tc`(`cellAddr`·`cellSpan`)를 본다.
- XML 은 DTD·엔티티 선언을 만나는 즉시 거부한다(외부 엔티티·엔티티 확장 폭탄 차단).
- 압축 해제는 항목 수·총량 상한 안에서 조각으로 읽는다(압축 폭탄 차단).
- 머리말·꼬리말(`header`·`footer`)은 쪽마다 반복되는 장식이라 본문에서 뺀다.
"""

import io
import re
import zipfile
import zlib
from xml.parsers import expat

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

SECTION_NAME = re.compile(r"Contents/section(\d+)\.xml")
MANIFEST = "META-INF/manifest.xml"
MAX_MANIFEST_BYTES = 1 << 20
CHUNK = 1 << 16
ZIP_ENCRYPTED_FLAG = 0x1

SKIP_ELEMENTS = frozenset({"header", "footer"})
# `t` 안의 빈 요소 중 글자 하나로 바꿀 것
INLINE_CHARACTERS = {
    "tab": " ",
    "lineBreak": " ",
    "fwSpace": " ",
    "nbSpace": " ",
    "hyphen": "-",
}

_NONE, _FRAME, _TEXT, _SKIP = range(4)


class _XmlRejected(Exception):
    pass


def _reject_declaration(*_args) -> None:
    raise _XmlRejected


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except ValueError:
        return default


class _SectionHandler:
    """expat 이벤트로 문단·표 트리를 만든다. 전체 DOM 을 만들지 않는다."""

    def __init__(self, limits: Limits) -> None:
        self.limits = limits
        self.root: list[TreeParagraph] = []
        self.frames: list[TreeParagraph | TreeTable | TreeCell] = []
        self.opened: list[int] = []
        self.in_text = 0
        self.skipping = 0

    def _attach(self, node: TreeParagraph | TreeTable) -> None:
        parent = self.frames[-1] if self.frames else None
        if isinstance(parent, TreeParagraph):
            parent.parts.append(node)
        elif isinstance(parent, TreeCell):
            parent.paragraphs.append(
                node if isinstance(node, TreeParagraph) else TreeParagraph([node])
            )
        elif parent is None:
            self.root.append(node if isinstance(node, TreeParagraph) else TreeParagraph([node]))

    def _push(self, node: TreeParagraph | TreeTable | TreeCell) -> int:
        if len(self.frames) >= self.limits.max_depth:
            raise ParseFailure.failed("CORRUPTED", "NESTING_LIMIT")
        self.frames.append(node)
        return _FRAME

    def start(self, name: str, attrs: dict[str, str]) -> None:
        if len(self.opened) >= self.limits.max_xml_depth:
            raise ParseFailure.failed("CORRUPTED", "NESTING_LIMIT")
        self.opened.append(self._open(name.rpartition(" ")[2], attrs))

    def _open(self, local: str, attrs: dict[str, str]) -> int:
        if self.skipping:
            return _NONE
        if local in SKIP_ELEMENTS:
            self.skipping += 1
            return _SKIP
        if self.in_text:
            if local in INLINE_CHARACTERS:
                self.characters(INLINE_CHARACTERS[local])
            return _NONE
        if local == "t":
            self.in_text += 1
            return _TEXT
        if local == "p":
            paragraph = TreeParagraph()
            self._attach(paragraph)
            return self._push(paragraph)
        if local == "tbl":
            table = TreeTable(_int(attrs.get("rowCnt"), 0), _int(attrs.get("colCnt"), 0))
            self._attach(table)
            return self._push(table)
        if local == "tc":
            return self._push(TreeCell())
        cell = self.frames[-1] if self.frames else None
        if isinstance(cell, TreeCell):
            if local == "cellAddr":
                cell.col = _int(attrs.get("colAddr"), 0)
                cell.row = _int(attrs.get("rowAddr"), 0)
            elif local == "cellSpan":
                cell.col_span = _int(attrs.get("colSpan"), 1)
                cell.row_span = _int(attrs.get("rowSpan"), 1)
        return _NONE

    def end(self, _name: str) -> None:
        kind = self.opened.pop()
        if kind == _SKIP:
            self.skipping -= 1
        elif kind == _TEXT:
            self.in_text -= 1
        elif kind == _FRAME:
            node = self.frames.pop()
            if (
                isinstance(node, TreeCell)
                and self.frames
                and isinstance(self.frames[-1], TreeTable)
            ):
                self.frames[-1].cells.append(node)

    def characters(self, data: str) -> None:
        if self.in_text and not self.skipping and self.frames:
            paragraph = self.frames[-1]
            if isinstance(paragraph, TreeParagraph):
                paragraph.parts.append(data)


def _parse_section(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, budget: Budget, limits: Limits
) -> list[TreeParagraph]:
    handler = _SectionHandler(limits)
    parser = expat.ParserCreate(namespace_separator=" ")
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    parser.StartDoctypeDeclHandler = _reject_declaration
    parser.EntityDeclHandler = _reject_declaration
    parser.StartElementHandler = handler.start
    parser.EndElementHandler = handler.end
    parser.CharacterDataHandler = handler.characters
    parser.buffer_text = True
    with archive.open(info) as stream:
        while chunk := stream.read(CHUNK):
            budget.spend(len(chunk))
            parser.Parse(chunk, False)
    parser.Parse(b"", True)
    return handler.root


def _is_encrypted(archive: zipfile.ZipFile, infos: list[zipfile.ZipInfo]) -> bool:
    if any(info.flag_bits & ZIP_ENCRYPTED_FLAG for info in infos):
        return True
    try:
        manifest = archive.getinfo(MANIFEST)
    except KeyError:
        return False
    if manifest.file_size > MAX_MANIFEST_BYTES:
        return False
    # ODF 방식 암호화는 manifest 에 encryption-data 를 남긴다
    return b"encryption-data" in archive.read(manifest)


def extract(data: bytes, limits: Limits) -> Extracted:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError, EOFError):
        raise ParseFailure.failed("CORRUPTED") from None
    try:
        with archive:
            infos = archive.infolist()
            if len(infos) > limits.max_zip_entries:
                raise ParseFailure.unsupported("TOO_LARGE", "ZIP_ENTRY_LIMIT")
            if _is_encrypted(archive, infos):
                raise ParseFailure.unsupported("ENCRYPTED")
            sections = sorted(
                (int(match.group(1)), info)
                for info in infos
                if (match := SECTION_NAME.fullmatch(info.filename))
            )
            if not sections:
                raise ParseFailure.failed("CORRUPTED", "HWPX_NO_SECTION")
            if sum(info.file_size for _, info in sections) > limits.max_unpacked_bytes:
                raise ParseFailure.unsupported("TOO_LARGE", "UNPACKED_LIMIT")
            budget = Budget(limits.max_unpacked_bytes)
            paragraphs: list[TreeParagraph] = []
            for _, info in sections:
                paragraphs.extend(_parse_section(archive, info, budget, limits))
    except _XmlRejected:
        raise ParseFailure.failed("CORRUPTED", "XML_DTD_REJECTED") from None
    except (expat.ExpatError, zipfile.BadZipFile, zlib.error, EOFError, ValueError):
        raise ParseFailure.failed("CORRUPTED") from None
    except NotImplementedError:
        # zipfile 이 풀 수 없는 압축 방식
        raise ParseFailure.unsupported("UNSUPPORTED_FORMAT", "ZIP_METHOD") from None
    return Extracted([flatten(paragraphs)], paged=False)
