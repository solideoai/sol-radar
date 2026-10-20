"""학습 진행 지표 집계(`training_metrics.json`). torch 를 import 하지 않는다."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

from sol_decision.trainer.data import TrainRecord


@dataclass(frozen=True)
class StepLog:
    step: int
    epoch: int
    loss: float
    lr: float
    seconds: float
    max_memory_mb: float | None
    records: int


@dataclass
class TrainingMetrics:
    """step 로그를 모아 요약한다. 손실 곡선은 그대로 보존한다(F1·F2 리포트 입력)."""

    steps: list[StepLog] = field(default_factory=list)
    records_total: int = 0
    records_kept: int = 0
    skipped_over_length: int = 0
    skipped_row_ids: list[str] = field(default_factory=list)
    max_state_tokens_seen: int = 0
    max_prompt_tokens_seen: int = 0
    epochs_completed: int = 0
    wall_seconds: float = 0.0

    def add_step(self, step_log: StepLog) -> None:
        self.steps.append(step_log)

    def note_prompt_tokens(self, tokens: int) -> None:
        self.max_prompt_tokens_seen = max(self.max_prompt_tokens_seen, tokens)

    @property
    def step_count(self) -> int:
        return len(self.steps)

    @property
    def final_loss(self) -> float | None:
        return self.steps[-1].loss if self.steps else None

    @property
    def first_loss(self) -> float | None:
        return self.steps[0].loss if self.steps else None

    def mean_loss(self, last_n: int | None = None) -> float | None:
        if not self.steps:
            return None
        window = self.steps if last_n is None else self.steps[-last_n:]
        return sum(step.loss for step in window) / len(window)

    @property
    def mean_step_seconds(self) -> float | None:
        if not self.steps:
            return None
        return sum(step.seconds for step in self.steps) / len(self.steps)

    @property
    def peak_memory_mb(self) -> float | None:
        values = [step.max_memory_mb for step in self.steps if step.max_memory_mb is not None]
        return max(values) if values else None

    @property
    def records_seen(self) -> int:
        return sum(step.records for step in self.steps)

    def summary(self) -> dict[str, Any]:
        return {
            "steps": self.step_count,
            "epochsCompleted": self.epochs_completed,
            "recordsTotal": self.records_total,
            "recordsKept": self.records_kept,
            "recordsSeen": self.records_seen,
            "skippedOverLength": self.skipped_over_length,
            "maxStateTokensSeen": self.max_state_tokens_seen,
            "maxPromptTokensSeen": self.max_prompt_tokens_seen,
            "firstLoss": self.first_loss,
            "finalLoss": self.final_loss,
            "meanLoss": self.mean_loss(),
            "meanLossLast10": self.mean_loss(10),
            "meanStepSeconds": self.mean_step_seconds,
            "peakMemoryMb": self.peak_memory_mb,
            "wallSeconds": self.wall_seconds,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.summary(),
            "skippedRowIds": list(self.skipped_row_ids),
            "lossCurve": [asdict(step) for step in self.steps],
        }


def label_distribution(records: Sequence[TrainRecord]) -> dict[str, Any]:
    """질문 타입·정답 후보·라벨 출처별 건수(MODEL_CARD 용. 레코드 본문은 넣지 않는다)."""

    by_type: Counter[str] = Counter(record.question_type for record in records)
    by_gold: Counter[str] = Counter(
        f"{record.question_type}:{record.gold_candidate_id}" for record in records
    )
    by_source: Counter[str] = Counter(record.label_source or "UNKNOWN" for record in records)
    by_candidate_count: Counter[int] = Counter(record.candidate_count for record in records)
    soft_targets = sum(1 for record in records if max(record.gold_probabilities) < 1.0)
    return {
        "records": len(records),
        "byQuestionType": dict(sorted(by_type.items())),
        "byGoldCandidate": dict(sorted(by_gold.items())),
        "byLabelSource": dict(sorted(by_source.items())),
        "byCandidateCount": {str(key): value for key, value in sorted(by_candidate_count.items())},
        "softTargets": soft_targets,
    }
