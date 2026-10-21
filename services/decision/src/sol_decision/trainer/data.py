"""학습 레코드 `bosun/{split}.en.jsonl` 읽기·검증(docs/15 §4.1). torch 를 import 하지 않는다.

한 줄 = 질문 하나. 필수 필드: `rowId`·`qid`·`questionType`·`instructions`·`state`·`candidates[]`·
`gold{candidateId, probabilities[]}`. 나머지(`itemId`·`clusterId`·`split`·`stateHash`·`labelSource`)는
추적용으로 보존만 한다. 레코드 본문(state·instructions)은 로그에 쓰지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

QUESTION_TYPES = ("choice", "score", "noul")
MIN_CANDIDATES = 2
MAX_CANDIDATES = 255
# gold.probabilities 합이 1 에서 벗어날 수 있는 허용치
PROBABILITY_SUM_TOLERANCE = 1e-3


class RecordError(ValueError):
    """레코드 한 줄이 계약(15 §4.1)에 맞지 않을 때. 메시지에 줄 번호를 넣고 본문은 넣지 않는다."""


@dataclass(frozen=True)
class Candidate:
    id: str
    label: str
    description: str

    def as_mapping(self) -> dict[str, str]:
        """`render_decision_prompt(candidates=...)` 에 그대로 넘기는 형태."""

        return {"id": self.id, "label": self.label, "description": self.description}


@dataclass(frozen=True)
class TrainRecord:
    row_id: str
    qid: str
    question_type: str
    instructions: str
    state: str
    candidates: tuple[Candidate, ...]
    gold_candidate_id: str
    gold_probabilities: tuple[float, ...]
    item_id: str | None = None
    cluster_id: str | None = None
    split: str | None = None
    state_hash: str | None = None
    label_source: str | None = None

    @property
    def candidate_ids(self) -> tuple[str, ...]:
        return tuple(candidate.id for candidate in self.candidates)

    @property
    def gold_index(self) -> int:
        return self.candidate_ids.index(self.gold_candidate_id)

    @property
    def candidate_count(self) -> int:
        return len(self.candidates)


def _require(obj: dict, key: str, line_no: int) -> object:
    if key not in obj:
        raise RecordError(f"line {line_no}: missing field '{key}'")
    return obj[key]


def _require_str(obj: dict, key: str, line_no: int) -> str:
    value = _require(obj, key, line_no)
    if not isinstance(value, str) or not value:
        raise RecordError(f"line {line_no}: field '{key}' must be a non-empty string")
    return value


def _optional_str(obj: dict, key: str) -> str | None:
    value = obj.get(key)
    return value if isinstance(value, str) else None


def _parse_candidates(raw: object, line_no: int) -> tuple[Candidate, ...]:
    if not isinstance(raw, list):
        raise RecordError(f"line {line_no}: 'candidates' must be a list")
    if not MIN_CANDIDATES <= len(raw) <= MAX_CANDIDATES:
        raise RecordError(
            f"line {line_no}: candidates must be {MIN_CANDIDATES}..{MAX_CANDIDATES}, got {len(raw)}"
        )
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            raise RecordError(f"line {line_no}: candidates[{position}] must be an object")
        candidate_id = item.get("id")
        label = item.get("label")
        if not isinstance(candidate_id, str) or not candidate_id:
            raise RecordError(f"line {line_no}: candidates[{position}].id must be a string")
        if not isinstance(label, str) or not label:
            raise RecordError(f"line {line_no}: candidates[{position}].label must be a string")
        if candidate_id in seen:
            raise RecordError(f"line {line_no}: duplicate candidate id at position {position}")
        seen.add(candidate_id)
        description = item.get("description")
        candidates.append(
            Candidate(
                id=candidate_id,
                label=label,
                description=description if isinstance(description, str) else "",
            )
        )
    return tuple(candidates)


def _parse_gold(
    raw: object, candidate_ids: Sequence[str], line_no: int
) -> tuple[str, tuple[float, ...]]:
    if not isinstance(raw, dict):
        raise RecordError(f"line {line_no}: 'gold' must be an object")
    candidate_id = raw.get("candidateId")
    if not isinstance(candidate_id, str) or candidate_id not in candidate_ids:
        raise RecordError(f"line {line_no}: gold.candidateId is not one of the candidates")
    probabilities = raw.get("probabilities")
    if not isinstance(probabilities, list) or len(probabilities) != len(candidate_ids):
        raise RecordError(
            f"line {line_no}: gold.probabilities must have {len(candidate_ids)} entries"
        )
    values: list[float] = []
    for position, value in enumerate(probabilities):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise RecordError(f"line {line_no}: gold.probabilities[{position}] must be a number")
        number = float(value)
        if not math.isfinite(number) or number < 0.0 or number > 1.0:
            raise RecordError(f"line {line_no}: gold.probabilities[{position}] must be in [0, 1]")
        values.append(number)
    total = sum(values)
    if abs(total - 1.0) > PROBABILITY_SUM_TOLERANCE:
        raise RecordError(f"line {line_no}: gold.probabilities must sum to 1 (got {total:.6f})")
    gold_index = list(candidate_ids).index(candidate_id)
    if values[gold_index] < max(values):
        raise RecordError(f"line {line_no}: gold.candidateId is not the argmax of probabilities")
    return candidate_id, tuple(values)


def parse_record(obj: object, *, line_no: int = 0) -> TrainRecord:
    """JSON 객체 하나를 검증해 `TrainRecord` 로 만든다. 어기면 `RecordError`."""

    if not isinstance(obj, dict):
        raise RecordError(f"line {line_no}: record must be a JSON object")
    question_type = _require_str(obj, "questionType", line_no)
    if question_type not in QUESTION_TYPES:
        raise RecordError(f"line {line_no}: questionType must be one of {QUESTION_TYPES}")
    candidates = _parse_candidates(_require(obj, "candidates", line_no), line_no)
    candidate_ids = [candidate.id for candidate in candidates]
    gold_candidate_id, gold_probabilities = _parse_gold(
        _require(obj, "gold", line_no), candidate_ids, line_no
    )
    return TrainRecord(
        row_id=_require_str(obj, "rowId", line_no),
        qid=_require_str(obj, "qid", line_no),
        question_type=question_type,
        instructions=_require_str(obj, "instructions", line_no),
        state=_require_str(obj, "state", line_no),
        candidates=candidates,
        gold_candidate_id=gold_candidate_id,
        gold_probabilities=gold_probabilities,
        item_id=_optional_str(obj, "itemId"),
        cluster_id=_optional_str(obj, "clusterId"),
        split=_optional_str(obj, "split"),
        state_hash=_optional_str(obj, "stateHash"),
        label_source=_optional_str(obj, "labelSource"),
    )


def parse_lines(lines: Iterable[str]) -> list[TrainRecord]:
    """JSONL 줄들을 레코드로. 빈 줄은 건너뛰고, 깨진 줄은 줄 번호와 함께 실패한다."""

    records: list[TrainRecord] = []
    for line_no, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError as error:
            raise RecordError(f"line {line_no}: invalid JSON ({error.msg})") from None
        records.append(parse_record(obj, line_no=line_no))
    if not records:
        raise RecordError("no records found")
    return records


def read_records(path: Path) -> list[TrainRecord]:
    with path.open(encoding="utf-8") as handle:
        return parse_lines(handle)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class LengthFilterResult:
    kept: tuple[TrainRecord, ...]
    skipped_row_ids: tuple[str, ...]
    max_state_tokens_seen: int

    @property
    def skipped(self) -> int:
        return len(self.skipped_row_ids)


def filter_by_state_length(
    records: Sequence[TrainRecord],
    count_tokens: Callable[[str], int],
    max_state_tokens: int,
) -> LengthFilterResult:
    """state 토큰 수가 상한을 넘는 레코드를 건너뛴다(22 §4.1: Bosun 은 자르지 않으므로 거른다).

    `count_tokens` 는 토크나이저 의존을 떼어 낸 함수다(시험에서는 가짜를 넣는다).
    """

    kept: list[TrainRecord] = []
    skipped: list[str] = []
    longest = 0
    for record in records:
        tokens = count_tokens(record.state)
        longest = max(longest, tokens)
        if tokens > max_state_tokens:
            skipped.append(record.row_id)
        else:
            kept.append(record)
    return LengthFilterResult(
        kept=tuple(kept), skipped_row_ids=tuple(skipped), max_state_tokens_seen=longest
    )
