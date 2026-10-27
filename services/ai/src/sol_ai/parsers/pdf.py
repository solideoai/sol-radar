"""PDF 어댑터: pdfplumber(MIT, pdfminer.six 기반).

- 쪽마다 선으로 그린 표를 찾아 셀 단위로 읽고, 표 밖 글자는 줄 → 문단으로 묶는다. 읽는 순서는 위에서 아래다.
- 칸이 하나뿐인 표(안내 상자·테두리)는 표로 보지 않고 안의 글자를 문단으로 읽는다.
- 쪽 수는 Limits.max_pdf_pages 까지만 읽는다. 넘으면 PARTIAL(`PAGE_LIMIT:<n>`).
- 열기 암호가 걸린 문서는 ENCRYPTED 다. 소유자 암호만 있는 문서(빈 사용자 암호)는 그대로 읽는다.
- 텍스트 레이어가 없는 스캔 PDF 는 OCR 하지 않는다(build_result 가 NO_TEXT_LAYER 로 끝낸다).
"""

import bisect
import io

import pdfplumber
from pdfminer.pdfdocument import PDFEncryptionError
from pdfminer.psexceptions import PSException
from pdfplumber.utils import extract_text
from pdfplumber.utils.exceptions import MalformedPDFException, PdfminerException

from sol_ai.parsers.document import Cell, Extracted, Limits, Para, ParseFailure, Table

PDF_ERRORS = (PdfminerException, MalformedPDFException, PSException)
# 두 줄 사이 빈 공간이 윗줄 높이보다 크면 문단을 나눈다
PARAGRAPH_GAP_RATIO = 1.0
COORD_DIGITS = 1


def _failure(error: BaseException) -> ParseFailure:
    cause = error.args[0] if isinstance(error, PdfminerException) and error.args else error
    if isinstance(cause, PDFEncryptionError):
        return ParseFailure.unsupported("ENCRYPTED")
    return ParseFailure.failed("CORRUPTED")


def _inside(obj: dict, box: tuple[float, float, float, float]) -> bool:
    x = (obj["x0"] + obj["x1"]) / 2
    y = (obj["top"] + obj["bottom"]) / 2
    return box[0] <= x < box[2] and box[1] <= y < box[3]


def _table(found) -> Table | None:
    """pdfplumber 표를 셀 목록으로. 셀 경계 좌표로 행·열 번호와 병합 수를 정한다."""
    bboxes = found.cells
    if len(bboxes) <= 1:
        return None
    xs = sorted({round(v, COORD_DIGITS) for b in bboxes for v in (b[0], b[2])})
    ys = sorted({round(v, COORD_DIGITS) for b in bboxes for v in (b[1], b[3])})

    def index(edges: list[float], value: float) -> int:
        return bisect.bisect_left(edges, round(value, COORD_DIGITS))

    cells: list[Cell] = []
    covered: set[tuple[int, int]] = set()
    for row, texts in zip(found.rows, found.extract(), strict=True):
        for box, text in zip(row.cells, texts, strict=True):
            if box is None:
                continue
            c0, c1 = index(xs, box[0]), index(xs, box[2])
            r0, r1 = index(ys, box[1]), index(ys, box[3])
            cells.append(Cell(r0, c0, max(1, r1 - r0), max(1, c1 - c0), text or ""))
            covered.update(
                (r, c) for r in range(r0, max(r1, r0 + 1)) for c in range(c0, max(c1, c0 + 1))
            )
    # 테두리 선이 빠진 칸은 셀로 잡히지 않는다. 표 안 글자를 잃지 않게 격자 칸으로 채운다
    chars = found.page.chars
    for r in range(len(ys) - 1):
        for c in range(len(xs) - 1):
            if (r, c) in covered:
                continue
            box = (xs[c], ys[r], xs[c + 1], ys[r + 1])
            inside = [ch for ch in chars if _inside(ch, box)]
            if inside:
                cells.append(Cell(r, c, 1, 1, extract_text(inside)))
    return Table(len(ys) - 1, len(xs) - 1, tuple(cells))


def _page_blocks(page) -> list[Para | Table]:
    page = page.dedupe_chars()
    tables: list[tuple[float, Table, tuple]] = []
    for found in page.find_tables():
        table = _table(found)
        if table is not None:
            tables.append((found.bbox[1], table, found.bbox))
    boxes = [box for _, _, box in tables]
    body = page.filter(
        lambda obj: obj.get("object_type") != "char" or not any(_inside(obj, b) for b in boxes)
    )
    items: list[tuple[float, int, object]] = [(top, 1, table) for top, table, _ in tables]
    items += [(line["top"], 0, line) for line in body.extract_text_lines(return_chars=False)]
    items.sort(key=lambda item: (item[0], item[1]))

    blocks: list[Para | Table] = []
    lines: list[str] = []
    previous: dict | None = None

    def flush() -> None:
        if lines:
            blocks.append(Para("\n".join(lines)))
            lines.clear()

    for _, kind, item in items:
        if kind == 1:
            flush()
            blocks.append(item)
            previous = None
            continue
        if previous is not None:
            gap = item["top"] - previous["bottom"]
            if gap > PARAGRAPH_GAP_RATIO * (previous["bottom"] - previous["top"]):
                flush()
        lines.append(item["text"])
        previous = item
    flush()
    return blocks


def extract(data: bytes, limits: Limits) -> Extracted:
    try:
        document = pdfplumber.open(io.BytesIO(data))
    except PDF_ERRORS as error:
        raise _failure(error) from None
    warnings: list[str] = []
    with document:
        try:
            pages = document.pages
        except PDF_ERRORS as error:
            raise _failure(error) from None
        if len(pages) > limits.max_pdf_pages:
            warnings.append(f"PAGE_LIMIT:{limits.max_pdf_pages}")
            pages = pages[: limits.max_pdf_pages]
        sections: list[list[Para | Table]] = []
        for number, page in enumerate(pages, start=1):
            try:
                sections.append(_page_blocks(page))
            except PDF_ERRORS:
                # 한 쪽이 깨져도 나머지는 읽는다. 빠진 쪽이 있으므로 PARTIAL 이다
                warnings.append(f"PAGE_ERROR:{number}")
                sections.append([])
    return Extracted(sections, paged=True, warnings=warnings)
