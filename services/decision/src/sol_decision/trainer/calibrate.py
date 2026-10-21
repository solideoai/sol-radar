"""F3 온도 보정(docs/22 §4.4, 21 §4.4): dev 예측으로 온도 1개를 맞춰 `calibration.json` 에 기록한다.

- 입력 ①: `sol_eval.bosun_score` 의 `predictions.jsonl`(`rowId`·`probabilities[]`·`seed`) + 같은 dev 레코드 파일(gold).
- 입력 ②: `--package` 로 직접 추론(torch 필요. 함수 안에서만 import).
- 방법: `softmax(log p / T)` 의 NLL 을 dev 에서 최소화하는 T(황금분할 탐색, log T 구간). 로짓이 아니라 확률에서
  시작해도 log-softmax 는 평행이동에 불변이라 로짓 온도 보정과 같다.
- 서빙에는 적용하지 않는다(기록용). 지표는 NLL·Brier·ECE(등폭 bins, 기본 10) 전후다.

순수 파이썬이라 torch 없이 import·시험할 수 있다.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sol_decision.trainer.data import TrainRecord, read_records, sha256_file

DEFAULT_BINS = 10
MIN_LOG_TEMPERATURE = math.log(0.05)
MAX_LOG_TEMPERATURE = math.log(20.0)
# 0 확률의 log 를 막는 바닥값
PROBABILITY_FLOOR = 1e-12


@dataclass(frozen=True)
class CalibrationRow:
    row_id: str
    probabilities: tuple[float, ...]
    gold_index: int
    seed: int | None = None


@dataclass(frozen=True)
class CalibrationReport:
    temperature: float
    rows: int
    nll_before: float
    nll_after: float
    ece_before: float
    ece_after: float
    brier_before: float
    brier_after: float
    accuracy: float
    bins: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": "temperature_scaling_min_nll",
            "temperature": self.temperature,
            "rows": self.rows,
            "accuracy": self.accuracy,
            "bins": self.bins,
            "before": {"nll": self.nll_before, "ece": self.ece_before, "brier": self.brier_before},
            "after": {"nll": self.nll_after, "ece": self.ece_after, "brier": self.brier_after},
        }


def _log_softmax(values: Sequence[float]) -> list[float]:
    peak = max(values)
    log_sum = peak + math.log(sum(math.exp(value - peak) for value in values))
    return [value - log_sum for value in values]


def scale_probabilities(probabilities: Sequence[float], temperature: float) -> list[float]:
    """`softmax(log p / T)`. T=1 이면 (정규화 외에) 그대로다."""

    if temperature <= 0.0:
        raise ValueError("temperature must be positive")
    logits = [
        math.log(max(float(value), PROBABILITY_FLOOR)) / temperature for value in probabilities
    ]
    return [math.exp(value) for value in _log_softmax(logits)]


def negative_log_likelihood(rows: Sequence[CalibrationRow], temperature: float) -> float:
    total = 0.0
    for row in rows:
        scaled = scale_probabilities(row.probabilities, temperature)
        total -= math.log(max(scaled[row.gold_index], PROBABILITY_FLOOR))
    return total / len(rows)


def brier_score(rows: Sequence[CalibrationRow], temperature: float) -> float:
    """다중 클래스 Brier: Σ_k (p_k − y_k)² 의 평균."""

    total = 0.0
    for row in rows:
        scaled = scale_probabilities(row.probabilities, temperature)
        for index, probability in enumerate(scaled):
            target = 1.0 if index == row.gold_index else 0.0
            total += (probability - target) ** 2
    return total / len(rows)


def expected_calibration_error(
    rows: Sequence[CalibrationRow], temperature: float, bins: int = DEFAULT_BINS
) -> float:
    """최대 확률(confidence)을 등폭 bins 로 나눈 ECE."""

    if bins < 1:
        raise ValueError("bins must be >= 1")
    bucket_confidence = [0.0] * bins
    bucket_correct = [0.0] * bins
    bucket_count = [0] * bins
    for row in rows:
        scaled = scale_probabilities(row.probabilities, temperature)
        confidence = max(scaled)
        predicted = scaled.index(confidence)
        bucket = min(int(confidence * bins), bins - 1)
        bucket_confidence[bucket] += confidence
        bucket_correct[bucket] += 1.0 if predicted == row.gold_index else 0.0
        bucket_count[bucket] += 1
    total = len(rows)
    error = 0.0
    for index in range(bins):
        count = bucket_count[index]
        if count == 0:
            continue
        gap = abs(bucket_confidence[index] / count - bucket_correct[index] / count)
        error += gap * count / total
    return error


def accuracy(rows: Sequence[CalibrationRow]) -> float:
    hits = sum(
        1 for row in rows if row.probabilities.index(max(row.probabilities)) == row.gold_index
    )
    return hits / len(rows)


def fit_temperature(rows: Sequence[CalibrationRow], iterations: int = 100) -> float:
    """dev NLL 을 최소화하는 온도. log T 구간에서 황금분할 탐색(단봉 함수)."""

    if not rows:
        raise ValueError("no rows to calibrate")
    golden = (math.sqrt(5.0) - 1.0) / 2.0
    low, high = MIN_LOG_TEMPERATURE, MAX_LOG_TEMPERATURE
    inner_low = high - golden * (high - low)
    inner_high = low + golden * (high - low)
    value_low = negative_log_likelihood(rows, math.exp(inner_low))
    value_high = negative_log_likelihood(rows, math.exp(inner_high))
    for _ in range(iterations):
        if value_low < value_high:
            high, inner_high, value_high = inner_high, inner_low, value_low
            inner_low = high - golden * (high - low)
            value_low = negative_log_likelihood(rows, math.exp(inner_low))
        else:
            low, inner_low, value_low = inner_low, inner_high, value_high
            inner_high = low + golden * (high - low)
            value_high = negative_log_likelihood(rows, math.exp(inner_high))
    return math.exp((low + high) / 2.0)


def calibrate(rows: Sequence[CalibrationRow], bins: int = DEFAULT_BINS) -> CalibrationReport:
    temperature = fit_temperature(rows)
    return CalibrationReport(
        temperature=temperature,
        rows=len(rows),
        nll_before=negative_log_likelihood(rows, 1.0),
        nll_after=negative_log_likelihood(rows, temperature),
        ece_before=expected_calibration_error(rows, 1.0, bins),
        ece_after=expected_calibration_error(rows, temperature, bins),
        brier_before=brier_score(rows, 1.0),
        brier_after=brier_score(rows, temperature),
        accuracy=accuracy(rows),
        bins=bins,
    )


def rows_from_predictions(
    predictions: Sequence[dict[str, Any]], records: Sequence[TrainRecord]
) -> list[CalibrationRow]:
    """`predictions.jsonl` 행을 레코드 gold 와 `rowId` 로 묶는다. seed 가 여럿이면 행마다 표본 하나다."""

    by_row_id = {record.row_id: record for record in records}
    rows: list[CalibrationRow] = []
    for position, prediction in enumerate(predictions):
        row_id = prediction.get("rowId")
        if not isinstance(row_id, str) or row_id not in by_row_id:
            raise ValueError(f"predictions[{position}]: rowId not found in the data file")
        record = by_row_id[row_id]
        probabilities = prediction.get("probabilities")
        if not isinstance(probabilities, list) or len(probabilities) != record.candidate_count:
            raise ValueError(
                f"predictions[{position}]: probabilities must have {record.candidate_count} entries"
            )
        seed = prediction.get("seed")
        rows.append(
            CalibrationRow(
                row_id=row_id,
                probabilities=tuple(float(value) for value in probabilities),
                gold_index=record.gold_index,
                seed=int(seed) if isinstance(seed, int) else None,
            )
        )
    if not rows:
        raise ValueError("no prediction rows")
    return rows


def read_predictions(path: Path) -> list[dict[str, Any]]:
    predictions: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped:
                obj = json.loads(stripped)
                if not isinstance(obj, dict):
                    raise ValueError("each predictions.jsonl line must be a JSON object")
                predictions.append(obj)
    return predictions


def rows_from_package(
    package_dir: Path, records: Sequence[TrainRecord], *, seeds: Sequence[int], device: str
) -> list[CalibrationRow]:
    """패키지로 직접 추론해 보정 행을 만든다(torch 필요. 서버 전용)."""

    from sol_decision.trainer.params import load_bosun, resolve_device, resolve_dtype

    resolved = resolve_device(device)
    model = load_bosun(package_dir, device=resolved, dtype=resolve_dtype(resolved, None))
    rows: list[CalibrationRow] = []
    for record in records:
        for seed in seeds:
            result = model.predict(
                state=record.state,
                instructions=record.instructions,
                candidates=[candidate.as_mapping() for candidate in record.candidates],
                decision_type=record.question_type,
                seed=seed,
                row_id=record.row_id,
            )
            rows.append(
                CalibrationRow(
                    row_id=record.row_id,
                    probabilities=tuple(float(value) for value in result["probabilities"]),
                    gold_index=record.gold_index,
                    seed=seed,
                )
            )
    return rows


def parse_seeds(text: str) -> list[int]:
    """`0-5` 또는 `0,1,2` 형식."""

    if "-" in text:
        start, end = text.split("-", 1)
        return list(range(int(start), int(end) + 1))
    return [int(part) for part in text.split(",") if part.strip()]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m sol_decision.trainer.calibrate",
        description="dev 예측으로 온도 1개를 맞춰 calibration.json 에 기록한다(서빙 미적용).",
    )
    parser.add_argument("--data", type=Path, required=True, help="dev 레코드 bosun/dev.en.jsonl")
    parser.add_argument("--out", type=Path, required=True, help="calibration.json 경로")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--predictions", type=Path, help="bosun_score 의 predictions.jsonl")
    source.add_argument("--package", type=Path, help="직접 추론할 패키지 디렉터리(torch 필요)")
    parser.add_argument("--seeds", default="0", help="--package 일 때 제시 순서 seed(예: 0-5)")
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    parser.add_argument("--bins", type=int, default=DEFAULT_BINS)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    records = read_records(args.data)
    inputs: dict[str, Any] = {"data": args.data.name, "dataSha256": sha256_file(args.data)}
    if args.predictions is not None:
        rows = rows_from_predictions(read_predictions(args.predictions), records)
        inputs["predictions"] = args.predictions.name
        inputs["predictionsSha256"] = sha256_file(args.predictions)
    else:
        seeds = parse_seeds(args.seeds)
        rows = rows_from_package(args.package, records, seeds=seeds, device=args.device)
        inputs["package"] = args.package.name
        inputs["seeds"] = seeds
    report = calibrate(rows, bins=args.bins)
    seeds_seen = sorted({row.seed for row in rows if row.seed is not None})
    payload = {
        **report.to_dict(),
        "appliedToServing": False,
        "inputs": {**inputs, "seedsSeen": seeds_seen},
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"temperature={report.temperature:.4f} rows={report.rows} "
        f"nll {report.nll_before:.4f}->{report.nll_after:.4f} "
        f"ece {report.ece_before:.4f}->{report.ece_after:.4f} -> {args.out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
