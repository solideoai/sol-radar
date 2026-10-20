"""질문 타입 → Bosun 후보 → Kev wire 답 변환(docs/03 §5.4 변환 표, 계획 §4.1). 순수 함수만 둔다.

- 후보: choice 는 criteria 키 순서대로 {id: key, label: key, description: criteria[key]},
  score 는 {id: "i", label: criteria[i]}, noul 은 {id: "true"/"false", label 같음, description: criteria 값 또는 "yes"/"no"}.
- 백엔드는 후보 순서대로의 확률 리스트를 돌려준다. 여기서 **후보 id 로** dict 를 만든다(위치가 아니라 id 로 되돌린다).
  합이 1 이 되게 정규화한다. 음수·NaN·무한·길이 불일치·합 0 은 InvalidDistribution 이다.
- 답: choice {choice: 최대 확률 키(동률은 criteria 순서 앞), confidence: max p, probabilities{key}},
  score {score: Σ i·p_i, probabilities{"0".."N-1"}, confidence: max p, legend: criteria 리스트}, noul {noul: P(true)}.
  게이트웨이 파서(kev_wire.parse_response)의 검사(합 1±0.01, score=Σ i·p_i ±0.05)를 같은 식으로 만족한다.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sol_decision import wire

NOUL_TRUE = "true"
NOUL_FALSE = "false"
NOUL_DEFAULT_DESCRIPTIONS = {NOUL_TRUE: "yes", NOUL_FALSE: "no"}


class InvalidDistribution(ValueError):
    """백엔드 확률이 분포가 아니다(길이·범위·합). 메시지는 사유 이름뿐이다."""


@dataclass(frozen=True)
class Candidate:
    """Bosun predict 의 candidates 원소. description 이 없으면(score) 키를 넣지 않는다."""

    id: str
    label: str
    description: str | None = None

    def as_bosun(self) -> dict[str, str]:
        candidate = {"id": self.id, "label": self.label}
        if self.description is not None:
            candidate["description"] = self.description
        return candidate


def candidates_for(question: wire.WireQuestion) -> list[Candidate]:
    """질문 타입과 criteria 로 후보 목록을 만든다(순서 = criteria 순서)."""
    if question.type == wire.CHOICE:
        criteria = question.criteria if isinstance(question.criteria, dict) else {}
        return [Candidate(key, key, description) for key, description in criteria.items()]
    if question.type == wire.SCORE:
        legend = question.criteria if isinstance(question.criteria, list) else []
        return [Candidate(str(index), label) for index, label in enumerate(legend)]
    descriptions = question.criteria if isinstance(question.criteria, dict) else {}
    return [
        Candidate(key, key, descriptions.get(key) or NOUL_DEFAULT_DESCRIPTIONS[key])
        for key in (NOUL_TRUE, NOUL_FALSE)
    ]


def distribution_by_id(
    candidates: Sequence[Candidate], probabilities: Sequence[float]
) -> dict[str, float]:
    """후보 순서대로의 확률 리스트를 후보 id → 확률 dict 로. 합 1 로 정규화한다."""
    if len(probabilities) != len(candidates):
        raise InvalidDistribution("LENGTH_MISMATCH")
    values = []
    for value in probabilities:
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
        ):
            raise InvalidDistribution("NOT_FINITE")
        if value < 0:
            raise InvalidDistribution("NEGATIVE")
        values.append(float(value))
    total = sum(values)
    if total <= 0:
        raise InvalidDistribution("ZERO_SUM")
    return {
        candidate.id: value / total for candidate, value in zip(candidates, values, strict=True)
    }


def _argmax(distribution: Mapping[str, float]) -> str:
    """최대 확률 키. 동률이면 먼저 온 키(criteria 순서)."""
    return max(distribution, key=lambda key: distribution[key])


def choice_answer(distribution: Mapping[str, float]) -> dict[str, Any]:
    choice = _argmax(distribution)
    return {
        wire.CHOICE: choice,
        wire.CONFIDENCE: distribution[choice],
        wire.PROBABILITIES: dict(distribution),
    }


def score_answer(legend: Sequence[str], distribution: Mapping[str, float]) -> dict[str, Any]:
    """score = 0 부터 센 등급 index 의 기대값 Σ i·p_i. 등급 키는 "0".."N-1"."""
    return {
        wire.SCORE: sum(int(grade) * p for grade, p in distribution.items()),
        wire.PROBABILITIES: dict(distribution),
        wire.CONFIDENCE: distribution[_argmax(distribution)],
        wire.LEGEND: list(legend),
    }


def noul_answer(distribution: Mapping[str, float]) -> dict[str, Any]:
    return {wire.NOUL: distribution[NOUL_TRUE]}


def answer_for(question: wire.WireQuestion, probabilities: Sequence[float]) -> dict[str, Any]:
    """백엔드 확률(후보 순서)을 그 질문의 Kev wire 답으로."""
    candidates = candidates_for(question)
    distribution = distribution_by_id(candidates, probabilities)
    if question.type == wire.CHOICE:
        return choice_answer(distribution)
    if question.type == wire.SCORE:
        legend = question.criteria if isinstance(question.criteria, list) else []
        return score_answer(legend, distribution)
    return noul_answer(distribution)
