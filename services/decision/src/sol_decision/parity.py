"""동일성 검사(ADR-034 미검증 콜아웃, 계획 §10 4번): 학습 경로와 `predict()` 가 같은 분포를 내는지.

같은 레코드에 대해
  ① `model.predict(...)["probabilities"]`
  ② 우리 프롬프트(`trainer.prompting.render_record`) → 토크나이즈 → `decision_logits` → `[:K]` softmax → 후보 순서 복원
을 비교해 최대 절대 오차를 낸다. 프롬프트 문자열도 바이트 단위로 같아야 한다.
배치 >1 학습이 쓰는 왼쪽 패딩 경로도 따로 비교한다(bf16 에서는 커널이 달라 오차가 조금 커질 수 있어 허용치를 따로 둔다).

    python -m sol_decision.parity --package DIR --data test.en.jsonl --n 8

학습 전에 서버에서 반드시 통과시킨다. 넘으면 exit 1.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

from sol_decision.trainer.batching import encode_prompts
from sol_decision.trainer.data import TrainRecord, read_records
from sol_decision.trainer.loss import slot_probabilities
from sol_decision.trainer.params import load_bosun, resolve_device, resolve_dtype
from sol_decision.trainer.prompting import RenderedPrompt, render_record, slot_to_candidate_order

DEFAULT_TOLERANCE = 1e-4
DEFAULT_BATCH_TOLERANCE = 1e-2

log = logging.getLogger("sol_decision.parity")


@dataclass(frozen=True)
class ParityRow:
    row_id: str
    prompt_identical: bool
    max_abs_diff_single: float
    max_abs_diff_batched: float


@dataclass(frozen=True)
class ParityReport:
    rows: tuple[ParityRow, ...]
    tolerance: float
    batch_tolerance: float

    @property
    def max_abs_diff_single(self) -> float:
        return max(row.max_abs_diff_single for row in self.rows)

    @property
    def max_abs_diff_batched(self) -> float:
        return max(row.max_abs_diff_batched for row in self.rows)

    @property
    def prompts_identical(self) -> bool:
        return all(row.prompt_identical for row in self.rows)

    @property
    def passed(self) -> bool:
        return (
            self.prompts_identical
            and self.max_abs_diff_single <= self.tolerance
            and self.max_abs_diff_batched <= self.batch_tolerance
        )


def our_probabilities(model: Any, rendered: Sequence[RenderedPrompt]) -> list[list[float]]:
    """학습 경로로 후보 순서 확률을 낸다(평가 모드, grad 없음)."""

    encoded = encode_prompts(model.tokenizer, [item.prompt for item in rendered], model.device)
    with torch.no_grad():
        logits = model.decision_logits(
            input_ids=encoded["input_ids"], attention_mask=encoded["attention_mask"]
        )
    result: list[list[float]] = []
    for row, item in enumerate(rendered):
        probabilities = slot_probabilities(logits[row], len(item.presentation_order))
        result.append(
            slot_to_candidate_order(probabilities.cpu().tolist(), item.presentation_order)
        )
    return result


def max_abs_diff(left: Sequence[float], right: Sequence[float]) -> float:
    return max(abs(a - b) for a, b in zip(left, right, strict=True))


def run_parity(
    model: Any,
    records: Sequence[TrainRecord],
    *,
    seed: int,
    tolerance: float = DEFAULT_TOLERANCE,
    batch_tolerance: float = DEFAULT_BATCH_TOLERANCE,
) -> ParityReport:
    model.eval()
    rendered = [render_record(model, record, seed=seed) for record in records]
    reference: list[list[float]] = []
    prompt_identical: list[bool] = []
    for record, item in zip(records, rendered, strict=True):
        predicted = model.predict(
            state=record.state,
            instructions=record.instructions,
            candidates=[candidate.as_mapping() for candidate in record.candidates],
            decision_type=record.question_type,
            seed=seed,
            row_id=record.row_id,
        )
        reference.append([float(value) for value in predicted["probabilities"]])
        prompt_identical.append(str(predicted["prompt"]) == item.prompt)
    single = [our_probabilities(model, [item])[0] for item in rendered]
    batched = our_probabilities(model, rendered) if len(rendered) > 1 else single
    rows = tuple(
        ParityRow(
            row_id=record.row_id,
            prompt_identical=identical,
            max_abs_diff_single=max_abs_diff(ref, ours_single),
            max_abs_diff_batched=max_abs_diff(ref, ours_batched),
        )
        for record, identical, ref, ours_single, ours_batched in zip(
            records, prompt_identical, reference, single, batched, strict=True
        )
    )
    return ParityReport(rows=rows, tolerance=tolerance, batch_tolerance=batch_tolerance)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m sol_decision.parity",
        description="predict() 와 학습 경로(decision_logits)의 확률 동일성 검사. 허용치를 넘으면 exit 1.",
    )
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True, help="bosun/*.en.jsonl")
    parser.add_argument("--n", type=int, default=8, help="앞에서부터 비교할 레코드 수")
    parser.add_argument("--seed", type=int, default=0, help="제시 순서 seed(서빙 기본 0)")
    parser.add_argument("--tol", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--batch-tol", type=float, default=DEFAULT_BATCH_TOLERANCE)
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    dtype = parser.add_mutually_exclusive_group()
    dtype.add_argument("--bf16", dest="bf16", action="store_true", default=None)
    dtype.add_argument("--no-bf16", dest="bf16", action="store_false")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = build_parser().parse_args(argv)
    if args.n < 1:
        log.error("--n must be >= 1")
        return 2
    records = read_records(args.data)[: args.n]
    device = resolve_device(args.device)
    dtype = resolve_dtype(device, args.bf16)
    log.info(
        "loading package=%s device=%s dtype=%s records=%d",
        args.package.name,
        device,
        dtype,
        len(records),
    )
    model = load_bosun(args.package, device=device, dtype=dtype)
    report = run_parity(
        model, records, seed=args.seed, tolerance=args.tol, batch_tolerance=args.batch_tol
    )
    for row in report.rows:
        log.info(
            "row=%s prompt_identical=%s single=%.2e batched=%.2e",
            row.row_id[:12],
            row.prompt_identical,
            row.max_abs_diff_single,
            row.max_abs_diff_batched,
        )
    log.info(
        "parity %s: prompts_identical=%s max_single=%.2e (tol %.1e) max_batched=%.2e (tol %.1e)",
        "PASS" if report.passed else "FAIL",
        report.prompts_identical,
        report.max_abs_diff_single,
        report.tolerance,
        report.max_abs_diff_batched,
        report.batch_tolerance,
    )
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
