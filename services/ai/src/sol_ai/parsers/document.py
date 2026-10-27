"""파서 공통부: 중간 표현, 직렬화(03 §10.1·15 §5.1 오프셋 규칙), 품질 신호(03 §10.4), 결과 조립.

어댑터(pdf·hwpx·hwp)는 문서를 `Para`·`Table` 블록 목록으로만 바꾼다. 텍스트 정규화·오프셋·
PARSED/PARTIAL 판정은 여기서 한 번만 한다. 네트워크·파일 시스템을 쓰지 않는다.
"""

import re
import statistics
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from sol_ai.citation import norm
from sol_ai.contracts import MAX_TEXT_CHARS, PageOffset, ParseResult

ErrorCode = Literal[
    "UNSUPPORTED_FORMAT",
    "NO_TEXT_LAYER",
    "ENCRYPTED",
    "DISTRIBUTION_PROTECTED",
    "TOO_LARGE",
    "CORRUPTED",
    "PARSER_ERROR",
]

# 표 셀 구분자(03 §10.1·15 §5.1). 블록·표 행 사이는 공백 하나다(norm 뒤 줄바꿈은 공백이 된다)
CELL_SEPARATOR = " | "
BLOCK_SEPARATOR = " "

# 03 §10.4 부분 파싱 신호의 초기값
MIN_MEDIAN_CHARS_PER_PAGE = 200
MAX_REPLACEMENT_RATIO = 0.01
MAX_EMPTY_CELL_RATIO = 0.5
TABLE_CAPTION = re.compile(r"<\s*표")
# 요구사항 고유번호(예: SFR-001). 같은 접두어 번호가 3개 이상이고 촘촘할 때만 빈 번호를 센다
REQUIREMENT_ID = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2,4})-(\d{3})(?!\d)")
MIN_REQUIREMENT_IDS = 3
MAX_REPORTED_GAPS = 20
REPLACEMENT_CHAR = "\ufffd"


@dataclass(frozen=True)
class Limits:
    """처리 상한. 넘으면 예외가 아니라 사유 코드가 있는 결과로 끝난다."""

    max_text_chars: int = MAX_TEXT_CHARS  # /extract 첨부 text 상한과 같다
    max_pdf_pages: int = 300
    max_zip_entries: int = 5_000
    max_unpacked_bytes: int = 200 * 1024 * 1024  # HWPX 섹션 XML·HWP 본문 압축 해제 총량
    max_depth: int = 64  # 표·글상자 중첩, HWP 레코드 수준
    max_xml_depth: int = 1_000  # XML 요소 깊이


class ParseFailure(Exception):
    """어댑터가 처리를 멈출 때 던진다. 메시지에 문서 내용을 넣지 않는다."""

    def __init__(
        self,
        status: Literal["UNSUPPORTED", "FAILED"],
        error_code: ErrorCode,
        warnings: tuple[str, ...] = (),
    ) -> None:
        super().__init__(error_code)
        self.status = status
        self.error_code = error_code
        self.warnings = list(warnings)

    @classmethod
    def unsupported(cls, error_code: ErrorCode, *warnings: str) -> "ParseFailure":
        return cls("UNSUPPORTED", error_code, warnings)

    @classmethod
    def failed(cls, error_code: ErrorCode, *warnings: str) -> "ParseFailure":
        return cls("FAILED", error_code, warnings)


class Budget:
    """압축 해제 총량. 넘는 순간 TOO_LARGE 로 멈춘다(압축 폭탄)."""

    def __init__(self, limit: int) -> None:
        self.remaining = limit

    def spend(self, size: int) -> None:
        self.remaining -= size
        if self.remaining < 0:
            raise ParseFailure.unsupported("TOO_LARGE", "UNPACKED_LIMIT")


# ---------------------------------------------------------------- 중간 표현


@dataclass(frozen=True)
class Para:
    text: str


@dataclass(frozen=True)
class Cell:
    row: int
    col: int
    row_span: int
    col_span: int
    text: str


@dataclass(frozen=True)
class Table:
    rows: int
    cols: int
    cells: tuple[Cell, ...]


Block = Para | Table


@dataclass
class Extracted:
    """어댑터 출력. paged 면 sections 하나가 한 쪽이다(PDF). 아니면 pages 를 비운다(HWP·HWPX)."""

    sections: list[list[Block]]
    paged: bool
    warnings: list[str] = field(default_factory=list)


# HWP·HWPX 공용 트리. 문단 안에 글자·표·글상자 문단이 문서 순서대로 들어 있다.
@dataclass
class TreeParagraph:
    parts: list["str | TreeTable | TreeParagraph"] = field(default_factory=list)


@dataclass
class TreeCell:
    row: int = 0
    col: int = 0
    row_span: int = 1
    col_span: int = 1
    paragraphs: list[TreeParagraph] = field(default_factory=list)


@dataclass
class TreeTable:
    rows: int
    cols: int
    cells: list[TreeCell] = field(default_factory=list)


def _is_container(table: TreeTable) -> bool:
    """칸이 하나인 표는 글상자처럼 쓰인다(안내 상자·쪽 테두리). 표가 아니라 안의 문단으로 펼친다."""
    return len(table.cells) <= 1


def _inline_text(paragraphs: list[TreeParagraph]) -> str:
    """셀 안 내용을 한 문자열로. 셀 안 표는 행을 공백, 셀을 ` | ` 로 잇는다."""
    pieces: list[str] = []
    for paragraph in paragraphs:
        for part in paragraph.parts:
            if isinstance(part, str):
                pieces.append(part)
            elif isinstance(part, TreeParagraph):
                pieces.append(" " + _inline_text([part]) + " ")
            else:
                rows: dict[int, list[TreeCell]] = {}
                for cell in part.cells:
                    rows.setdefault(cell.row, []).append(cell)
                lines = [
                    CELL_SEPARATOR.join(
                        norm(_inline_text(c.paragraphs)) for c in sorted(r, key=lambda c: c.col)
                    )
                    for _, r in sorted(rows.items())
                ]
                pieces.append(" " + " ".join(lines) + " ")
        pieces.append("\n")
    return "".join(pieces)


def _flatten_paragraph(paragraph: TreeParagraph, blocks: list[Block]) -> None:
    text: list[str] = []

    def flush() -> None:
        if text:
            blocks.append(Para("".join(text)))
            text.clear()

    for part in paragraph.parts:
        if isinstance(part, str):
            text.append(part)
            continue
        flush()
        if isinstance(part, TreeParagraph):
            _flatten_paragraph(part, blocks)
        elif _is_container(part):
            for cell in part.cells:
                for inner in cell.paragraphs:
                    _flatten_paragraph(inner, blocks)
        else:
            cells = tuple(
                Cell(
                    c.row, c.col, max(1, c.row_span), max(1, c.col_span), _inline_text(c.paragraphs)
                )
                for c in part.cells
            )
            blocks.append(Table(part.rows, part.cols, cells))
    flush()


def flatten(paragraphs: list[TreeParagraph]) -> list[Block]:
    """트리를 읽는 순서의 블록 목록으로 편다. 깊이는 어댑터가 Limits.max_depth 로 막는다."""
    blocks: list[Block] = []
    for paragraph in paragraphs:
        _flatten_paragraph(paragraph, blocks)
    return blocks


# ---------------------------------------------------------------- 직렬화


def _render_table(table: Table) -> tuple[str, dict] | None:
    """행마다 한 줄, 셀 사이 ` | `. 빈 셀도 자리를 남기되 공백이 겹치지 않게 쓴다(norm(text) = text)."""
    cells = sorted(table.cells, key=lambda c: (c.row, c.col))
    texts = [norm(c.text) for c in cells]
    if not any(texts):
        return None
    out: list[str] = []
    length = 0
    last = ""
    infos: list[dict] = []
    previous_row: int | None = None
    for cell, text in zip(cells, texts, strict=True):
        if previous_row is not None:
            separator = BLOCK_SEPARATOR if cell.row != previous_row else CELL_SEPARATOR
            if length == 0 or last == " ":
                separator = separator.lstrip(" ")
            if separator:
                out.append(separator)
                length += len(separator)
                last = separator[-1]
        start = length
        if text:
            out.append(text)
            length += len(text)
            last = text[-1]
        infos.append(
            {
                "r": cell.row,
                "c": cell.col,
                "rowSpan": cell.row_span,
                "colSpan": cell.col_span,
                "charStart": start,
                "charEnd": length,
            }
        )
        previous_row = cell.row
    rendered = "".join(out)
    if rendered.endswith(" "):
        rendered = rendered[:-1]
        for info in infos:
            info["charStart"] = min(info["charStart"], len(rendered))
            info["charEnd"] = min(info["charEnd"], len(rendered))
    rows = max([table.rows, *(c.row + c.row_span for c in cells)])
    cols = max([table.cols, *(c.col + c.col_span for c in cells)])
    return rendered, {
        "kind": "table",
        "charStart": 0,
        "charEnd": len(rendered),
        "rows": rows,
        "cols": cols,
        "cells": infos,
    }


def _render(block: Block) -> tuple[str, dict] | None:
    if isinstance(block, Table):
        return _render_table(block)
    text = norm(block.text)
    if not text:
        return None
    return text, {"kind": "paragraph", "charStart": 0, "charEnd": len(text)}


def _shift(info: dict, offset: int) -> dict:
    shifted = {**info, "charStart": info["charStart"] + offset, "charEnd": info["charEnd"] + offset}
    if "cells" in info:
        shifted["cells"] = [
            {**c, "charStart": c["charStart"] + offset, "charEnd": c["charEnd"] + offset}
            for c in info["cells"]
        ]
    return shifted


@dataclass
class Serialized:
    text: str
    pages: list[PageOffset]
    blocks: list[dict]
    truncated: bool


def serialize(extracted: Extracted, max_chars: int) -> Serialized:
    """블록을 순서대로 이어 text 를 만든다. 오프셋은 모두 이 text 기준이다(15 §5.1)."""
    out: list[str] = []
    length = 0
    blocks: list[dict] = []
    marks: list[int] = []
    truncated = False
    for section in extracted.sections:
        marks.append(length + (len(BLOCK_SEPARATOR) if length else 0))
        for block in section:
            rendered = _render(block)
            if rendered is None:
                continue
            text, info = rendered
            start = length + (len(BLOCK_SEPARATOR) if length else 0)
            if start + len(text) > max_chars:
                truncated = True
                break
            if length:
                out.append(BLOCK_SEPARATOR)
            out.append(text)
            blocks.append(_shift(info, start))
            length = start + len(text)
        if truncated:
            break
    pages = (
        [PageOffset(page=i + 1, charOffset=min(mark, length)) for i, mark in enumerate(marks)]
        if extracted.paged
        else []
    )
    return Serialized("".join(out), pages, blocks, truncated)


# ---------------------------------------------------------------- 품질 신호(03 §10.4)


def _requirement_gaps(text: str) -> dict[str, list[int]]:
    numbers: dict[str, set[int]] = {}
    for prefix, digits in REQUIREMENT_ID.findall(text):
        numbers.setdefault(prefix, set()).add(int(digits))
    gaps: dict[str, list[int]] = {}
    for prefix, found in numbers.items():
        if len(found) < MIN_REQUIREMENT_IDS:
            continue
        low, high = min(found), max(found)
        # 듬성듬성한 번호(인용·예시)는 연속 번호 목록으로 보지 않는다
        if high - low + 1 > 2 * len(found):
            continue
        missing = sorted(set(range(low, high + 1)) - found)
        if missing:
            gaps[prefix] = missing[:MAX_REPORTED_GAPS]
    return gaps


def _is_private_use(ch: str) -> bool:
    return "\ue000" <= ch <= "\uf8ff"


def assess(serialized: Serialized, paged: bool) -> tuple[dict, list[str]]:
    """품질 신호와 PARTIAL 사유. 사유가 하나라도 있으면 PARTIAL 이다."""
    text = serialized.text
    total = len(text)
    tables = [b for b in serialized.blocks if b["kind"] == "table"]
    cells = [c for t in tables for c in t["cells"]]
    empty_cells = sum(1 for c in cells if c["charStart"] == c["charEnd"])
    replacement = text.count(REPLACEMENT_CHAR)
    private_use = sum(1 for ch in text if _is_private_use(ch))
    captions = len(TABLE_CAPTION.findall(text))
    gaps = _requirement_gaps(text)

    page_chars: list[int] = []
    if paged and serialized.pages:
        offsets = [p.charOffset for p in serialized.pages] + [total]
        page_chars = [max(0, offsets[i + 1] - offsets[i]) for i in range(len(serialized.pages))]
    median_chars = statistics.median(page_chars) if page_chars else None

    replacement_ratio = replacement / total if total else 0.0
    empty_ratio = empty_cells / len(cells) if cells else 0.0
    reasons: list[str] = []
    if median_chars is not None and median_chars < MIN_MEDIAN_CHARS_PER_PAGE:
        reasons.append("LOW_TEXT_DENSITY")
    if replacement_ratio > MAX_REPLACEMENT_RATIO:
        reasons.append("REPLACEMENT_CHARS")
    if gaps:
        reasons.append("REQUIREMENT_ID_GAP")
    if captions and not tables:
        reasons.append("TABLE_NOT_DETECTED")
    # 빈 셀 비율은 셀 글자를 좌표로 나눠 담는 PDF 에만 적용한다. HWP·HWPX 는 셀 구조를 그대로 읽으므로
    # 빈 셀은 원문이 빈 칸(서식의 기입란)이다(2026-10-27 실표본, docs/evidence/parser/20261027-parser-check.md)
    if paged and empty_ratio > MAX_EMPTY_CELL_RATIO:
        reasons.append("EMPTY_CELLS")
    if serialized.truncated:
        reasons.append("TEXT_TRUNCATED")

    quality = {
        "charCount": total,
        "pageCount": len(serialized.pages) if paged else None,
        "medianCharsPerPage": median_chars,
        "replacementCharRatio": round(replacement_ratio, 6),
        "privateUseCharRatio": round(private_use / total, 6) if total else 0.0,
        "tableCount": len(tables),
        "tableCaptionCount": captions,
        "cellCount": len(cells),
        "emptyCellRatio": round(empty_ratio, 6),
        "requirementIdGaps": gaps,
        "partialReasons": reasons,
    }
    return quality, reasons


# ---------------------------------------------------------------- 결과 조립

# 어댑터 경고 중 그 자체로 내용이 빠졌다는 뜻인 것(쪽 수 상한·쪽 오류)
PARTIAL_WARNING_PREFIXES = ("PAGE_LIMIT", "PAGE_ERROR")


def failure_result(
    fmt: str, parser_id: str, status: str, error_code: str, warnings: list[str]
) -> ParseResult:
    return ParseResult(
        status=status,
        format=fmt,
        parserId=parser_id,
        text="",
        pages=[],
        blocks=[],
        quality=None,
        errorCode=error_code,
        warnings=warnings,
    )


def build_result(fmt: str, parser_id: str, extracted: Extracted, limits: Limits) -> ParseResult:
    serialized = serialize(extracted, limits.max_text_chars)
    if not serialized.text and serialized.truncated:
        # 첫 블록 하나가 text 상한보다 길다. 글자가 없는 것이 아니라 너무 크다
        return failure_result(
            fmt, parser_id, "UNSUPPORTED", "TOO_LARGE", [*extracted.warnings, "TEXT_LIMIT"]
        )
    if not serialized.text:
        # 글자가 하나도 없다(스캔 PDF·그림뿐인 문서). OCR 은 하지 않는다(03 §10.2)
        return failure_result(fmt, parser_id, "UNSUPPORTED", "NO_TEXT_LAYER", extracted.warnings)
    quality, reasons = assess(serialized, extracted.paged)
    partial = bool(reasons) or any(
        w.startswith(PARTIAL_WARNING_PREFIXES) for w in extracted.warnings
    )
    warnings = list(dict.fromkeys([*extracted.warnings, *reasons]))
    return ParseResult(
        status="PARTIAL" if partial else "PARSED",
        format=fmt,
        parserId=parser_id,
        text=serialized.text,
        pages=serialized.pages,
        blocks=serialized.blocks,
        quality=quality,
        errorCode=None,
        warnings=warnings,
    )


def run(
    fmt: str,
    parser_id: str,
    extract: Callable[[bytes, Limits], Extracted],
    data: bytes,
    limits: Limits,
) -> ParseResult:
    """어댑터를 돌려 ParseResult 로 만든다. 알려진 실패(ParseFailure)는 사유 코드가 있는 결과다.

    그 밖의 예외(어댑터 결함·메모리·재귀 한도)는 worker 프로세스를 끝내고,
    gateway 가 FAILED + PARSER_ERROR(`PARSER_EXIT:<코드>`)로 바꾼다.
    """
    try:
        extracted = extract(data, limits)
    except ParseFailure as failure:
        return failure_result(fmt, parser_id, failure.status, failure.error_code, failure.warnings)
    return build_result(fmt, parser_id, extracted, limits)
