"""결정 모델 채점 지표(docs/21 §4.3). bosun_score·compare 가 함께 쓰는 순수 함수.

- 예측 선택지: noul 은 P(true) ≥ 0.5 → "true"(τ 비교 불변, 21 §4.3 "0.5 기준"), 그 밖은 argmax.
  argmax 동률은 후보 순서의 뒤쪽을 고른다 — req.* 후보 순서 [SATISFIED, NOT_SATISFIED, NEEDS_REVIEW] 에서
  서빙의 동률 규칙(NEEDS_REVIEW > NOT_SATISFIED > SATISFIED, 22 §4.1)과 같아진다.
- Macro-F1: gold 나 예측에 한 번이라도 나온 후보만 평균한다(없는 후보는 0 으로 끌어내리지 않는다).
- Brier = 평균 Σ_k (p_k − y_k)², NLL = 평균 −Σ_k y_k log p_k(soft gold 허용, p 는 1e-12 로 자른다),
  ECE = 10 구간 등폭(confidence = max p, 정답 = 예측 선택지 == gold candidateId).
- score 타입은 기대값 MAE(|Σ i·p_i − Σ i·y_i|), noul 은 Brier·정확도(0.5 기준).
- 일관성: seed 간 argmax 동일 비율(argmax_stable), 최대 확률의 seed 간 표준편차(spread, 모표준편차).
"""

import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sol_ai.adapters import kev_wire

ECE_BINS = 10
PROBABILITY_FLOOR = 1e-12
NEEDS_REVIEW = "NEEDS_REVIEW"
NOT_SATISFIED = "NOT_SATISFIED"
NOUL_TRUE = "true"
NOUL_THRESHOLD = 0.5


@dataclass(frozen=True)
class ScoredRow:
    """한 질문의 gold 와 한 seed 의 예측."""

    row_id: str
    qid: str
    question_type: str
    cluster_id: str
    candidate_ids: tuple[str, ...]
    gold_id: str
    gold_probabilities: tuple[float, ...]
    probabilities: tuple[float, ...]


def predicted_id(row: ScoredRow) -> str:
    if row.question_type == kev_wire.NOUL:
        index = row.candidate_ids.index(NOUL_TRUE)
        return (
            NOUL_TRUE
            if row.probabilities[index] >= NOUL_THRESHOLD
            else next(c for c in row.candidate_ids if c != NOUL_TRUE)
        )
    best = max(row.probabilities)
    return [c for c, p in zip(row.candidate_ids, row.probabilities, strict=True) if p == best][-1]


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def accuracy(rows: Sequence[ScoredRow]) -> float | None:
    return _mean([1.0 if predicted_id(r) == r.gold_id else 0.0 for r in rows])


def macro_f1(rows: Sequence[ScoredRow]) -> float | None:
    if not rows:
        return None
    tp: Counter = Counter()
    fp: Counter = Counter()
    fn: Counter = Counter()
    for row in rows:
        predicted = predicted_id(row)
        if predicted == row.gold_id:
            tp[predicted] += 1
        else:
            fp[predicted] += 1
            fn[row.gold_id] += 1
    classes = set(tp) | set(fp) | set(fn)
    scores: list[float] = []
    for cls in classes:
        denominator = 2 * tp[cls] + fp[cls] + fn[cls]
        scores.append(2 * tp[cls] / denominator if denominator else 0.0)
    return _mean(scores)


def recall_of(rows: Sequence[ScoredRow], gold_id: str) -> float | None:
    relevant = [r for r in rows if r.gold_id == gold_id]
    return _mean([1.0 if predicted_id(r) == gold_id else 0.0 for r in relevant])


def confusion_rate(rows: Sequence[ScoredRow], gold_id: str, predicted: str) -> float | None:
    """gold 가 gold_id 인 행 가운데 predicted 로 예측한 비율."""
    relevant = [r for r in rows if r.gold_id == gold_id]
    return _mean([1.0 if predicted_id(r) == predicted else 0.0 for r in relevant])


def brier(rows: Sequence[ScoredRow]) -> float | None:
    return _mean(
        [
            sum((p - y) ** 2 for p, y in zip(r.probabilities, r.gold_probabilities, strict=True))
            for r in rows
        ]
    )


def nll(rows: Sequence[ScoredRow]) -> float | None:
    return _mean(
        [
            -sum(
                y * math.log(max(p, PROBABILITY_FLOOR))
                for p, y in zip(r.probabilities, r.gold_probabilities, strict=True)
                if y > 0
            )
            for r in rows
        ]
    )


def ece(rows: Sequence[ScoredRow], bins: int = ECE_BINS) -> float | None:
    if not rows:
        return None
    buckets: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for row in rows:
        confidence = max(row.probabilities)
        correct = 1.0 if predicted_id(row) == row.gold_id else 0.0
        index = min(int(confidence * bins), bins - 1)
        buckets[index].append((confidence, correct))
    total = len(rows)
    error = 0.0
    for pairs in buckets.values():
        mean_confidence = sum(c for c, _ in pairs) / len(pairs)
        mean_accuracy = sum(a for _, a in pairs) / len(pairs)
        error += len(pairs) / total * abs(mean_accuracy - mean_confidence)
    return error


def expected_value(candidate_ids: Sequence[str], probabilities: Sequence[float]) -> float:
    return sum(int(c) * p for c, p in zip(candidate_ids, probabilities, strict=True))


def expected_value_mae(rows: Sequence[ScoredRow]) -> float | None:
    return _mean(
        [
            abs(
                expected_value(r.candidate_ids, r.probabilities)
                - expected_value(r.candidate_ids, r.gold_probabilities)
            )
            for r in rows
        ]
    )


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def group_metrics(rows: Sequence[ScoredRow]) -> dict[str, Any]:
    """한 묶음(전체·qid 가족·타입)의 지표. 묶음에 없는 타입의 지표는 넣지 않는다."""
    out: dict[str, Any] = {
        "n": len(rows),
        "clusters": len({r.cluster_id for r in rows}),
        "accuracy": _round(accuracy(rows)),
        "macroF1": _round(macro_f1(rows)),
        "brier": _round(brier(rows)),
        "nll": _round(nll(rows)),
        "ece": _round(ece(rows)),
    }
    if any(NEEDS_REVIEW in r.candidate_ids for r in rows):
        out["needsReviewRecall"] = _round(recall_of(rows, NEEDS_REVIEW))
        out["needsReviewToNotSatisfied"] = _round(confusion_rate(rows, NEEDS_REVIEW, NOT_SATISFIED))
        out["notSatisfiedToNeedsReview"] = _round(confusion_rate(rows, NOT_SATISFIED, NEEDS_REVIEW))
    score_rows = [r for r in rows if r.question_type == kev_wire.SCORE]
    if score_rows:
        out["expectedValueMae"] = _round(expected_value_mae(score_rows))
    return out


def population_std(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def consistency(rows_by_seed: dict[int, Sequence[ScoredRow]]) -> dict[str, Any]:
    """seed 간 argmax 일치율과 최대 확률 spread. 모든 seed 에 같은 rowId 열이 있어야 한다."""
    seeds = sorted(rows_by_seed)
    if not seeds:
        return {"seeds": [], "argmaxStable": None, "spreadMean": None, "spreadMax": None}
    by_row: dict[str, list[ScoredRow]] = defaultdict(list)
    for seed in seeds:
        for row in rows_by_seed[seed]:
            by_row[row.row_id].append(row)
    stable: list[float] = []
    spreads: list[float] = []
    for versions in by_row.values():
        stable.append(1.0 if len({predicted_id(v) for v in versions}) == 1 else 0.0)
        spreads.append(population_std([max(v.probabilities) for v in versions]))
    return {
        "seeds": seeds,
        "rows": len(by_row),
        "argmaxStable": _round(_mean(stable)),
        "spreadMean": _round(_mean(spreads)),
        "spreadMax": _round(max(spreads) if spreads else None),
    }


def group_by(rows: Iterable[ScoredRow], key) -> dict[str, list[ScoredRow]]:
    groups: dict[str, list[ScoredRow]] = defaultdict(list)
    for row in rows:
        groups[key(row)].append(row)
    return dict(sorted(groups.items()))
