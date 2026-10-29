"""인용 검증(docs/15 §5). 같은 입력에 같은 결과가 나온다.

- `norm`·`verify_citation`: 공개 함수. 인용 하나를 문서 하나와 대조한다(15 §5.1·§5.2).
- `verify_fields`: `/extract` 가 필드 단위로 적용한다(15 §5.3, K1). 값을 고쳐서 살리지 않는다.
  끝에 응답 quotedText 를 1~300자로 맞춘다(`fit_quotes`, Worker 계약).
"""

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from fractions import Fraction

from rapidfuzz.distance import Levenshtein

MIN_QUOTE_CHARS = 5
MAX_QUOTE_CHARS = 300
# 이보다 긴 문서는 4단계(창 탐색)를 인용 앞 20자 위치 ±2,000자 안에서만 한다(15 §5.2)
LONG_DOCUMENT_CHARS = 200_000
ANCHOR_CHARS = 20
ANCHOR_RADIUS = 2_000
# 창 탐색 후보를 좁힐 때 쓰는 조각의 최소 길이. 이보다 짧아지면(임계값이 아주 낮을 때) 모든 위치를 본다
MIN_PIECE_CHARS = 2

MATCH_FAILED = "FAILED"
NOTE_PAGE_MISMATCH = "PAGE_MISMATCH"
NOTE_MULTIPLE_OCCURRENCES = "MULTIPLE_OCCURRENCES"

_ZERO_WIDTH = re.compile("[\u200b-\u200d\ufeff]")
_WHITESPACE = re.compile(r"\s+")


def norm(s: str) -> str:
    """15 §5.1: NFKC → 제로폭 문자 제거 → 연속 공백·줄바꿈·탭을 공백 1개로, 앞뒤 공백 제거.

    전각 괄호·따옴표·쉼표는 NFKC 가 반각으로 바꾼다. 숫자 사이 쉼표는 그대로 둔다.
    """
    text = unicodedata.normalize("NFKC", s)
    text = _ZERO_WIDTH.sub("", text)
    return _WHITESPACE.sub(" ", text).strip()


@dataclass(frozen=True)
class CitationResult:
    """match 와 norm(문서) 기준 절대 오프셋. FAILED 면 오프셋은 None 이고 reason 에 사유가 있다."""

    match: str
    char_start: int | None = None
    char_end: int | None = None
    reason: str | None = None
    notes: list[str] = field(default_factory=list)


def _failed(reason: str) -> CitationResult:
    return CitationResult(MATCH_FAILED, None, None, reason, [])


def threshold_of(ratio: float | Fraction) -> Fraction:
    """임계값을 정확한 분수로 바꾼다. 0.92 같은 float 의 이진 오차로 경계 판정이 흔들리지 않게 한다."""
    return ratio if isinstance(ratio, Fraction) else Fraction(str(ratio))


def verify_citation(
    quoted_text: str,
    doc_text: str | None,
    *,
    char_start: int | None = None,
    char_end: int | None = None,
    page: int | None = None,
    pages: Sequence[Mapping] | None = None,
    fuzzy_min_ratio: float = 0.92,
) -> CitationResult:
    """15 §5.2 절차. doc_text 가 None 이면 검증할 문서가 없다(DOCUMENT_UNAVAILABLE)."""
    if doc_text is None:
        return _failed("DOCUMENT_UNAVAILABLE")
    return verify_normalized(
        norm(quoted_text),
        norm(doc_text),
        char_start=char_start,
        char_end=char_end,
        page=page,
        pages=pages,
        threshold=threshold_of(fuzzy_min_ratio),
    )


def verify_normalized(
    q: str,
    doc: str,
    *,
    char_start: int | None,
    char_end: int | None,
    page: int | None,
    pages: Sequence[Mapping] | None,
    threshold: Fraction,
) -> CitationResult:
    """이미 norm 한 인용·문서로 0~5단계를 돈다. 오프셋은 doc 기준 절대 위치다."""
    if not MIN_QUOTE_CHARS <= len(q) <= MAX_QUOTE_CHARS:
        return _failed("QUOTE_LENGTH")
    whole = (0, len(doc))
    if page is None:
        return _search(q, doc, whole, char_start, char_end, threshold) or _failed("NOT_FOUND")
    scope = _page_scope(page, pages, len(doc))
    if scope is not None:
        hit = _search(q, doc, scope, char_start, char_end, threshold)
        if hit is not None:
            return hit
    # 지정 페이지에 없거나 그 페이지를 모르면 문서 전체로 다시 찾고, 찾으면 PAGE_MISMATCH 를 단다
    hit = _search(q, doc, whole, char_start, char_end, threshold)
    if hit is None:
        return _failed("NOT_FOUND")
    return CitationResult(
        hit.match, hit.char_start, hit.char_end, None, [*hit.notes, NOTE_PAGE_MISMATCH]
    )


def _page_scope(page: int, pages: Sequence[Mapping] | None, length: int) -> tuple[int, int] | None:
    """page 의 검색 범위 [그 page 의 charOffset, 다음 page 의 charOffset 또는 끝). 모르는 page 면 None."""
    offsets = sorted(int(entry["charOffset"]) for entry in pages or ())
    start = next((int(e["charOffset"]) for e in pages or () if e["page"] == page), None)
    if start is None:
        return None
    end = next((offset for offset in offsets if offset > start), length)
    return (min(max(start, 0), length), min(end, length))


def _search(
    q: str,
    doc: str,
    scope: tuple[int, int],
    char_start: int | None,
    char_end: int | None,
    threshold: Fraction,
) -> CitationResult | None:
    lo, hi = scope
    # 2단계: 모델이 준 오프셋이 범위 안에서 그대로 맞으면 EXACT
    if (
        isinstance(char_start, int)
        and isinstance(char_end, int)
        and lo <= char_start <= char_end <= hi
        and doc[char_start:char_end] == q
    ):
        return CitationResult("EXACT", char_start, char_end)
    # 3단계: 정규화 텍스트에서 찾는다. 겹치는 위치도 센다
    first = doc.find(q, lo, hi)
    if first >= 0:
        notes = [NOTE_MULTIPLE_OCCURRENCES] if doc.find(q, first + 1, hi) >= 0 else []
        return CitationResult("NORMALIZED", first, first + len(q), None, notes)
    # 4단계: 창 탐색
    window = _fuzzy(q, doc, lo, hi, threshold)
    if window is None:
        return None
    return CitationResult("FUZZY", window[0], window[1])


def _fuzzy(q: str, doc: str, lo: int, hi: int, threshold: Fraction) -> tuple[int, int] | None:
    """길이 [floor(0.9L), ceil(1.1L)] 창을 1자씩 옮기며 ratio = 1 - lev/max(len) 의 최댓값을 찾는다.

    동점은 시작 위치가 앞선 것, 그다음 길이가 len(q) 에 가까운 것, 그다음 짧은 것.
    """
    length = len(q)
    n_min = (length * 9) // 10
    n_max = -((-length * 11) // 10)
    if len(doc) > LONG_DOCUMENT_CHARS:
        anchor = doc.find(q[:ANCHOR_CHARS], lo, hi)
        if anchor < 0:
            return None
        lo, hi = max(lo, anchor - ANCHOR_RADIUS), min(hi, anchor + ANCHOR_RADIUS)
    k_max = _allowed_edits(max(length, n_max), threshold)
    if k_max < 0:
        return None
    best: tuple | None = None
    for start in _candidate_starts(q, doc, lo, hi, n_min, k_max):
        for size in range(n_min, n_max + 1):
            end = start + size
            if end > hi:
                break
            longest = max(length, size)
            allowed = _allowed_edits(longest, threshold)
            if abs(size - length) > allowed:
                continue
            distance = Levenshtein.distance(q, doc[start:end], score_cutoff=allowed)
            if distance > allowed:
                continue
            key = (Fraction(longest - distance, longest), -start, -abs(size - length), -size)
            if best is None or key > best[0]:
                best = (key, start, end)
    return None if best is None else (best[1], best[2])


def _allowed_edits(longest: int, threshold: Fraction) -> int:
    """ratio ≥ 임계값이 되는 최대 편집 거리. 1 - d/m ≥ t ⇔ d ≤ m(1 - t)."""
    return math.floor(longest * (1 - threshold))


def _candidate_starts(q: str, doc: str, lo: int, hi: int, n_min: int, k: int) -> list[int]:
    """임계값을 넘을 수 있는 창의 시작 위치 후보.

    편집 k 회 이하로 맞는 창이면 q 를 k+1 조각으로 나눴을 때 적어도 한 조각은 그대로 창 안에 있다(비둘기집).
    그 조각이 문서에 있는 위치에서 시작 위치를 ±k 범위로 되짚는다. 임계값 밖 창만 빠지므로 결과는 전수 탐색과 같다.
    """
    last_start = hi - n_min
    if last_start < lo:
        return []
    pieces = k + 1
    size = len(q) // pieces
    if size < MIN_PIECE_CHARS:
        return list(range(lo, last_start + 1))
    starts: set[int] = set()
    for index in range(pieces):
        offset = index * size
        piece = q[offset : offset + size] if index < pieces - 1 else q[offset:]
        position = doc.find(piece, lo, hi)
        while position >= 0:
            first = max(lo, position - offset - k)
            last = min(last_start, position - offset + k)
            starts.update(range(first, last + 1))
            position = doc.find(piece, position + 1, hi)
    return sorted(starts)


# ---------------------------------------------------------------- 필드 단위 적용 (/extract)


@dataclass(frozen=True)
class DocumentText:
    """인용이 가리키는 문서. text 는 norm 한 텍스트, pages 는 그 텍스트 기준 페이지 시작 오프셋."""

    text: str
    pages: list[dict]


@dataclass
class CitationSummary:
    warnings: list[str]
    total_refs: int
    failed_refs: int

    @property
    def low_confidence(self) -> bool:
        """15 §5.3: 추출 전체 ref 중 FAILED 비율 > 50%. ref 가 없으면 해당 없음."""
        return self.total_refs > 0 and self.failed_refs * 2 > self.total_refs


def verify_ref(
    ref: dict, documents: Mapping[str | None, DocumentText], threshold: Fraction
) -> CitationResult:
    """ref 하나를 검증한다. documentId 가 None 이면 공고 본문, 아니면 같은 id 의 첨부."""
    if ref.get("kind") == "API_FIELD":
        # AI 출력의 근거는 언제나 TEXT 다(15 §2). gateway 는 API 원본 응답을 갖지 않아 대조할 수 없다
        return _failed("DOCUMENT_UNAVAILABLE")
    document = documents.get(ref.get("documentId"))
    if document is None:
        return _failed("DOCUMENT_UNAVAILABLE")
    return verify_normalized(
        norm(ref["quotedText"]),
        document.text,
        char_start=ref.get("charStart"),
        char_end=ref.get("charEnd"),
        page=ref.get("page"),
        pages=document.pages,
        threshold=threshold,
    )


def verify_fields(
    fields: Mapping[str, dict],
    documents: Mapping[str | None, DocumentText],
    threshold: Fraction,
    list_fields: frozenset[str],
) -> CitationSummary:
    """모든 필드의 ref 에 match 를 채우고, 배열 원소 단위 폐기와 K1 전이를 적용한다(제자리 수정)."""
    warnings: list[str] = []
    total = failed = 0
    for name, extracted in fields.items():
        for ref in extracted["evidence"]:
            result = verify_ref(ref, documents, threshold)
            ref["match"] = result.match
            if result.match in ("NORMALIZED", "FUZZY"):
                ref["charStart"], ref["charEnd"] = result.char_start, result.char_end
            warnings.extend(result.notes)
            total += 1
            failed += result.match == MATCH_FAILED
        emptied = name in list_fields and drop_unsupported_elements(extracted)
        if fail_unsupported_field(extracted, elements_emptied=emptied):
            warnings.append(f"CITATION_FAILED:{name}")
        fit_quotes(extracted)
    return CitationSummary(warnings, total, failed)


# 배열 필드 note 의 원소 → 근거 대응 표기(03 §4.1): "[0],[1]→evidence[0]", "[0]→evidence[0], [1]→evidence[1]"
_GROUP = r"\[\d+\](?:\s*,\s*\[\d+\])*\s*(?:→|->)\s*evidence\[\d+\]"
_MAPPING = re.compile(rf"\s*{_GROUP}(?:\s*,\s*{_GROUP})*\s*")
_GROUP_PARTS = re.compile(r"((?:\[\d+\](?:\s*,\s*)?)+)\s*(?:→|->)\s*evidence\[(\d+)\]")
_INDEX = re.compile(r"\[(\d+)\]")


def parse_element_mapping(
    note: str | None, elements: int, refs: int
) -> list[tuple[list[int], int]] | None:
    """note 의 대응 표기를 [(원소 번호들, 근거 번호)] 로 읽는다.

    표기가 note 전체가 아니거나, 번호가 범위 밖이거나, 대응이 없는 원소가 있으면 읽을 수 없다(None).
    """
    if not note or not _MAPPING.fullmatch(note):
        return None
    groups = [
        ([int(i) for i in _INDEX.findall(match.group(1))], int(match.group(2)))
        for match in _GROUP_PARTS.finditer(note)
    ]
    covered = {i for indices, _ in groups for i in indices}
    in_range = all(
        0 <= ref < refs and all(0 <= i < elements for i in indices) for indices, ref in groups
    )
    if not in_range or covered != set(range(elements)):
        return None
    return groups


def drop_unsupported_elements(extracted: dict) -> bool:
    """대응 근거가 모두 FAILED 인 배열 원소를 버린다(03 §4.1 "짝이 안 맞는 원소는 버린다").

    대응 표기를 읽을 수 없으면 원소 단위로 버리지 않는다. 남은 원소가 0개가 되면 True.
    남은 원소의 번호를 다시 매겨 note 의 대응 표기를 고쳐 쓴다(근거 번호는 그대로).
    """
    value = extracted["value"]
    if extracted["state"] != "KNOWN" or not isinstance(value, list) or not value:
        return False
    groups = parse_element_mapping(extracted.get("note"), len(value), len(extracted["evidence"]))
    if groups is None:
        return False
    evidence = extracted["evidence"]
    supported = {
        i for indices, ref in groups if evidence[ref]["match"] != MATCH_FAILED for i in indices
    }
    keep = [i for i in range(len(value)) if i in supported]
    if len(keep) == len(value):
        return False
    renumber = {old: new for new, old in enumerate(keep)}
    extracted["value"] = [value[i] for i in keep]
    remaining = [
        (",".join(f"[{renumber[i]}]" for i in indices if i in renumber), ref)
        for indices, ref in groups
        if any(i in renumber for i in indices)
    ]
    extracted["note"] = ", ".join(f"{indices}→evidence[{ref}]" for indices, ref in remaining)
    if not extracted["note"]:
        del extracted["note"]
    return not keep


def fit_quotes(extracted: dict) -> None:
    """응답 quotedText 를 1~300자로 맞춘다. 검증·원소 폐기·K1 전이를 마친 필드에 쓴다(제자리 수정).

    Worker 는 근거 하나라도 이 길이를 어기면 추출 전체를 버린다(web/server/scoring/analysis-input.model.ts).
    - 300자를 넘으면 norm 한 인용의 앞 300자로 바꾼다. 검증을 통과한 인용은 norm 결과가 300자 이하라 검증한 그대로다.
      실패한 인용(QUOTE_LENGTH 등)은 match=FAILED 그대로 앞 300자만 남는다.
    - 빈 인용은 남길 글자가 없어 뺀다(match 는 언제나 FAILED 다). note 의 원소→근거 번호는 뺀 만큼 당긴다.
    """
    evidence = extracted["evidence"]
    for ref in evidence:
        if len(ref["quotedText"]) > MAX_QUOTE_CHARS:
            ref["quotedText"] = norm(ref["quotedText"])[:MAX_QUOTE_CHARS]
    keep = [i for i, ref in enumerate(evidence) if ref["quotedText"]]
    if len(keep) == len(evidence):
        return
    extracted["evidence"] = [evidence[i] for i in keep]
    note = extracted.get("note")
    if not note or not _MAPPING.fullmatch(note):
        return
    renumber = {old: new for new, old in enumerate(keep)}
    groups = [
        (",".join(f"[{i}]" for i in _INDEX.findall(match.group(1))), renumber[int(match.group(2))])
        for match in _GROUP_PARTS.finditer(note)
        if int(match.group(2)) in renumber
    ]
    extracted["note"] = ", ".join(f"{indices}→evidence[{ref}]" for indices, ref in groups)
    if not extracted["note"]:
        del extracted["note"]


def fail_unsupported_field(extracted: dict, *, elements_emptied: bool) -> bool:
    """K1(15 §2·§5.3): 근거가 1개 이상인데 유효 근거(match≠FAILED)가 0개가 됐거나 남은 원소가 0개인
    KNOWN·CONFLICTED 필드 → value=null, state=UNKNOWN, note="CITATION_FAILED". 실패 ref 는 evidence 에 남긴다.

    NOT_APPLICABLE·UNKNOWN 은 그대로 둔다. 전이했으면 True(호출자가 CITATION_FAILED:<field> 경고를 단다).
    """
    evidence = extracted["evidence"]
    if not evidence or extracted["state"] not in ("KNOWN", "CONFLICTED"):
        return False
    if not elements_emptied and any(ref["match"] != MATCH_FAILED for ref in evidence):
        return False
    extracted["value"] = None
    extracted["state"] = "UNKNOWN"
    extracted["note"] = "CITATION_FAILED"
    return True
