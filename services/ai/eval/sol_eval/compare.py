"""`compare --candidate <run> --reference <run> --out <dir>`: 두 bosun_score 출력의 짝 부트스트랩 비교(docs/21 §4.3·§4.4, 22 §4.4).

- 두 run 의 predictions.jsonl 이 같은 rowId 집합이고 report.json 의 데이터 sha256 이 같아야 한다(다르면 CompareError).
- Δ = candidate − reference. 지표: Macro-F1·Accuracy·NEEDS_REVIEW recall·ECE(seed 는 기본 0, 서빙과 같다).
- 사업 클러스터 단위 paired bootstrap(기본 2,000회, seed 고정)이 1차 CI 다. 레코드 단위 CI 는 참고로 함께 적는다.
- CI 가 0 을 포함하면(또는 Δ 가 나쁜 방향이면) 그 지표의 improvementClaimable=false — "개선 주장 불가".
  1차 판정 지표는 macroF1 이다(21 §4.4). 클러스터가 적으면(해커톤 test 20) 구간이 넓다. 탐색적 결과로 보고한다.
"""

import json
import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sol_eval.bosun_metrics import NEEDS_REVIEW, ScoredRow, accuracy, ece, macro_f1, recall_of
from sol_eval.bosun_score import PREDICTIONS_FILE, REPORT_FILE, ROWS_FILE
from sol_eval.leakage import read_jsonl

COMPARE_REPORT_SCHEMA_VERSION = "sol-eval-compare-report/v0.1"
DEFAULT_ITERATIONS = 2_000
DEFAULT_BOOTSTRAP_SEED = 0
PRIMARY_METRIC = "macroF1"
# 지표 → (함수, 높을수록 좋은가)
METRICS: dict[str, tuple[Callable[[Sequence[ScoredRow]], float | None], bool]] = {
    "macroF1": (macro_f1, True),
    "accuracy": (accuracy, True),
    "needsReviewRecall": (lambda rows: recall_of(rows, NEEDS_REVIEW), True),
    "ece": (ece, False),
}


class CompareError(ValueError):
    pass


@dataclass
class Run:
    path: Path
    report: dict[str, Any]
    rows: list[ScoredRow]


def load_run(run_dir: Path, seed: int) -> Run:
    report_path = run_dir / REPORT_FILE
    rows_path = run_dir / ROWS_FILE
    predictions_path = run_dir / PREDICTIONS_FILE
    for path in (report_path, rows_path, predictions_path):
        if not path.exists():
            raise CompareError(f"{run_dir}: {path.name} 이 없다")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    rows_by_id = {r["rowId"]: r for r in json.loads(rows_path.read_text(encoding="utf-8"))}
    scored: list[ScoredRow] = []
    for prediction in read_jsonl(predictions_path):
        if int(prediction["seed"]) != seed:
            continue
        meta = rows_by_id.get(prediction["rowId"])
        if meta is None:
            raise CompareError(f"{run_dir}: rows.json 에 없는 rowId 가 predictions 에 있다")
        scored.append(
            ScoredRow(
                row_id=str(meta["rowId"]),
                qid=str(meta["qid"]),
                question_type=str(meta["questionType"]),
                cluster_id=str(meta["clusterId"]),
                candidate_ids=tuple(meta["candidateIds"]),
                gold_id=str(meta["gold"]["candidateId"]),
                gold_probabilities=tuple(float(p) for p in meta["gold"]["probabilities"]),
                probabilities=tuple(float(p) for p in prediction["probabilities"]),
            )
        )
    if not scored:
        raise CompareError(f"{run_dir}: seed {seed} 의 예측이 없다")
    return Run(run_dir, report, sorted(scored, key=lambda r: r.row_id))


def check_same_data(candidate: Run, reference: Run) -> None:
    cand_ids = {r.row_id for r in candidate.rows}
    ref_ids = {r.row_id for r in reference.rows}
    if cand_ids != ref_ids:
        raise CompareError(
            f"rowId 집합이 다르다(candidate만 {len(cand_ids - ref_ids)}, reference만 {len(ref_ids - cand_ids)})"
        )
    cand_sha = (candidate.report.get("data") or {}).get("sha256")
    ref_sha = (reference.report.get("data") or {}).get("sha256")
    if not cand_sha or cand_sha != ref_sha:
        raise CompareError("두 run 의 데이터 sha256 이 다르거나 없다")


def _delta(
    metric: Callable[[Sequence[ScoredRow]], float | None],
    candidate: Sequence[ScoredRow],
    reference: Sequence[ScoredRow],
) -> float | None:
    a, b = metric(candidate), metric(reference)
    return None if a is None or b is None else a - b


def _percentile(sorted_values: Sequence[float], q: float) -> float:
    if not sorted_values:
        raise CompareError("부트스트랩 표본이 없다")
    position = (len(sorted_values) - 1) * q
    low = int(position)
    high = min(low + 1, len(sorted_values) - 1)
    weight = position - low
    return sorted_values[low] * (1 - weight) + sorted_values[high] * weight


def paired_bootstrap(
    candidate: Sequence[ScoredRow],
    reference: Sequence[ScoredRow],
    *,
    unit: str,
    iterations: int,
    seed: int,
) -> dict[str, Any]:
    """unit="cluster": 클러스터를 복원 추출해 그 안의 행을 통째로 넣는다. unit="record": 행을 복원 추출한다."""
    if unit == "cluster":
        groups: dict[str, list[int]] = {}
        for index, row in enumerate(candidate):
            groups.setdefault(row.cluster_id, []).append(index)
        units = list(groups.values())
    elif unit == "record":
        units = [[i] for i in range(len(candidate))]
    else:
        raise CompareError(f"알 수 없는 단위: {unit}")
    rng = random.Random(seed)
    samples: dict[str, list[float]] = {name: [] for name in METRICS}
    for _ in range(iterations):
        chosen = [units[rng.randrange(len(units))] for _ in units]
        indices = [i for group in chosen for i in group]
        cand = [candidate[i] for i in indices]
        ref = [reference[i] for i in indices]
        for name, (metric, _higher) in METRICS.items():
            delta = _delta(metric, cand, ref)
            if delta is not None:
                samples[name].append(delta)
    out: dict[str, Any] = {
        "unit": unit,
        "units": len(units),
        "iterations": iterations,
        "seed": seed,
    }
    for name, (metric, higher_is_better) in METRICS.items():
        point = _delta(metric, candidate, reference)
        values = sorted(samples[name])
        if point is None or not values:
            out[name] = {"delta": None, "ci95": None, "improvementClaimable": False}
            continue
        low, high = _percentile(values, 0.025), _percentile(values, 0.975)
        includes_zero = low <= 0 <= high
        improved = point > 0 if higher_is_better else point < 0
        out[name] = {
            "delta": round(point, 6),
            "ci95": [round(low, 6), round(high, 6)],
            "ciIncludesZero": includes_zero,
            "betterWhen": "higher" if higher_is_better else "lower",
            "improvementClaimable": bool(improved and not includes_zero),
            "samples": len(values),
        }
    return out


@dataclass
class CompareOptions:
    candidate_dir: Path
    reference_dir: Path
    out_dir: Path
    prediction_seed: int = 0
    iterations: int = DEFAULT_ITERATIONS
    bootstrap_seed: int = DEFAULT_BOOTSTRAP_SEED


def compare(options: CompareOptions) -> dict[str, Any]:
    candidate = load_run(options.candidate_dir, options.prediction_seed)
    reference = load_run(options.reference_dir, options.prediction_seed)
    check_same_data(candidate, reference)
    cluster = paired_bootstrap(
        candidate.rows,
        reference.rows,
        unit="cluster",
        iterations=options.iterations,
        seed=options.bootstrap_seed,
    )
    record = paired_bootstrap(
        candidate.rows,
        reference.rows,
        unit="record",
        iterations=options.iterations,
        seed=options.bootstrap_seed,
    )
    primary = cluster[PRIMARY_METRIC]
    report = {
        "schemaVersion": COMPARE_REPORT_SCHEMA_VERSION,
        "createdAt": datetime.now(UTC).isoformat(),
        "candidate": {"path": str(candidate.path), "package": candidate.report.get("package")},
        "reference": {"path": str(reference.path), "package": reference.report.get("package")},
        "data": {
            "sha256": (candidate.report.get("data") or {}).get("sha256"),
            "rows": len(candidate.rows),
            "clusters": cluster["units"],
            "predictionSeed": options.prediction_seed,
        },
        "point": {
            "candidate": {name: fn(candidate.rows) for name, (fn, _h) in METRICS.items()},
            "reference": {name: fn(reference.rows) for name, (fn, _h) in METRICS.items()},
        },
        "bootstrap": {"cluster": cluster, "record": record},
        "claim": {
            "primaryMetric": PRIMARY_METRIC,
            "primaryUnit": "cluster",
            "improvementClaimable": primary["improvementClaimable"],
            "note": (
                "Δ 95% CI 가 0 을 배제하고 좋은 방향일 때만 개선을 주장한다(21 §4.4). "
                "클러스터 수가 적으면 탐색적 결과로 보고한다."
            ),
        },
    }
    options.out_dir.mkdir(parents=True, exist_ok=True)
    (options.out_dir / REPORT_FILE).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
