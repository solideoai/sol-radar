"""Bosun v3.1 0.6B 공개 LoRA 이어 학습기(docs/22 §4.2·§4.3, ADR-034 7번).

    python -m sol_decision.train --package <snapshot> --data bosun/train.en.jsonl --out runs/<name> [--max-steps 20]

- 로딩: 패키지 디렉터리(manifest sha256 대조 뒤) → `AutoModelForCausalLM.from_pretrained(trust_remote_code, local_files_only)`.
- 동결: LoRA 파라미터(392 텐서·10,092,544)만 학습. decision token 임베딩·백본·토크나이저 동결. 집계가 다르면 중단.
- 프롬프트·슬롯: 모델 모듈의 `render_decision_prompt`·`_SYSTEM_PROMPT` 를 그대로 쓴다(`trainer.prompting`).
- 손실: `decision_logits(...)[:, :K]` soft-CE. 에폭마다 `seed = --seed + epoch` 로 제시 순서를 바꾼다. 배치 >1 은 왼쪽 패딩.
- 길이: state 토큰이 `--max-state-tokens` 를 넘는 레코드는 건너뛰고 개수를 기록한다(0 이 아니면 경고).
- 저장: `runs/<name>/` 에 HF 레이아웃 패키지 + `manifest.json`(sha256 재계산)·`training_metrics.json`·`MODEL_CARD.md`.
  `--verify-reload` 면 저장 직후 다시 올려 `predict` 1회를 확인한다.

GPU 실행은 사용자 승인 뒤 회사 서버(물리 GPU 1 공유)에서만 한다. 레코드 본문은 로그에 쓰지 않는다.
"""

from __future__ import annotations

import argparse
import logging
import math
import random
import sys
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import torch

from sol_decision.trainer import checkpoint
from sol_decision.trainer.batching import forward_batch
from sol_decision.trainer.data import (
    RecordError,
    TrainRecord,
    filter_by_state_length,
    read_records,
    sha256_file,
)
from sol_decision.trainer.metrics import StepLog, TrainingMetrics, label_distribution
from sol_decision.trainer.params import (
    EXPECTED_LORA_PARAMS,
    EXPECTED_LORA_TENSORS,
    ParameterContractError,
    assert_expected_tally,
    enable_gradient_checkpointing,
    environment_versions,
    freeze_for_lora,
    load_bosun,
    max_memory_mb,
    resolve_device,
    resolve_dtype,
    trainable_parameters,
)

DEFAULT_MAX_STATE_TOKENS = 6144
TRAINER_NAME = "sol_decision.train"

log = logging.getLogger(TRAINER_NAME)


class TrainingError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=f"python -m {TRAINER_NAME}",
        description="Bosun v3.1 0.6B 공개 LoRA 이어 학습(LoRA 파라미터만, 슬롯 soft-CE).",
    )
    parser.add_argument("--package", type=Path, required=True, help="출발 Bosun 패키지 디렉터리")
    parser.add_argument("--data", type=Path, required=True, help="bosun/train.en.jsonl")
    parser.add_argument("--out", type=Path, required=True, help="출력 runs/<name>/ (새 디렉터리)")
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument(
        "--batch", type=int, default=1, help="마이크로 배치 크기(>1 이면 왼쪽 패딩)"
    )
    parser.add_argument("--accum", type=int, default=8, help="gradient accumulation 횟수")
    parser.add_argument("--max-steps", type=int, default=0, help="0 이면 전체. F1 smoke 는 20")
    parser.add_argument(
        "--warmup-steps", type=int, default=0, help="선형 warmup step 수(0 이면 상수 lr)"
    )
    parser.add_argument("--weight-decay", type=float, default=0.0)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--grad-checkpointing", action="store_true")
    dtype = parser.add_mutually_exclusive_group()
    dtype.add_argument(
        "--bf16", dest="bf16", action="store_true", default=None, help="기본: cuda 면 bf16"
    )
    dtype.add_argument("--no-bf16", dest="bf16", action="store_false", help="cuda 에서도 fp32")
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    parser.add_argument(
        "--seed", type=int, default=0, help="재현성 seed. 에폭 e 의 제시 순서 seed 는 seed+e"
    )
    parser.add_argument("--max-state-tokens", type=int, default=DEFAULT_MAX_STATE_TOKENS)
    parser.add_argument("--expect-tensors", type=int, default=EXPECTED_LORA_TENSORS)
    parser.add_argument("--expect-params", type=int, default=EXPECTED_LORA_PARAMS)
    parser.add_argument(
        "--verify-reload", action="store_true", help="저장 뒤 다시 올려 predict 1회"
    )
    parser.add_argument("--log-every", type=int, default=1)
    return parser


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def state_token_counter(tokenizer: Any) -> Callable[[str], int]:
    return lambda text: len(tokenizer(text, add_special_tokens=False)["input_ids"])


def epoch_batches(
    records: Sequence[TrainRecord], batch_size: int, rng: random.Random
) -> list[list[TrainRecord]]:
    """에폭마다 레코드 순서를 섞고 마이크로 배치로 나눈다."""

    order = list(records)
    rng.shuffle(order)
    return [order[start : start + batch_size] for start in range(0, len(order), batch_size)]


def grouped(items: Sequence[Any], size: int) -> list[Sequence[Any]]:
    return [items[start : start + size] for start in range(0, len(items), size)]


def learning_rate_at(step: int, base_lr: float, warmup_steps: int) -> float:
    if warmup_steps <= 0:
        return base_lr
    return base_lr * min(1.0, (step + 1) / warmup_steps)


def ensure_new_out_dir(out_dir: Path) -> None:
    """학습마다 `--out` 을 새로 짓는다(22 §4.3). 비어 있지 않은 디렉터리는 덮어쓰지 않는다."""

    if out_dir.exists() and any(out_dir.iterdir()):
        raise TrainingError(f"--out {out_dir} already exists and is not empty; choose a new name")
    out_dir.mkdir(parents=True, exist_ok=True)


def verify_reload(
    out_dir: Path, record: TrainRecord, *, device: torch.device, dtype: torch.dtype
) -> None:
    """저장한 패키지를 다시 올려 `predict` 1회가 후보 수 길이의 분포를 내는지 확인한다."""

    reloaded = load_bosun(out_dir, device=device, dtype=dtype)
    result = reloaded.predict(
        state=record.state,
        instructions=record.instructions,
        candidates=[candidate.as_mapping() for candidate in record.candidates],
        decision_type=record.question_type,
        seed=0,
        row_id=record.row_id,
    )
    probabilities = [float(value) for value in result["probabilities"]]
    if len(probabilities) != record.candidate_count or abs(sum(probabilities) - 1.0) > 1e-3:
        raise TrainingError("reloaded package predict() returned a malformed distribution")
    log.info("reload OK: predict() returned %d probabilities", len(probabilities))


def train_loop(
    model: Any,
    records: Sequence[TrainRecord],
    args: argparse.Namespace,
    *,
    device: torch.device,
    metrics: TrainingMetrics,
) -> None:
    parameters = trainable_parameters(model)
    optimizer = torch.optim.AdamW(parameters, lr=args.lr, weight_decay=args.weight_decay)
    steps_per_epoch = math.ceil(len(records) / (args.batch * args.accum))
    planned = steps_per_epoch * args.epochs
    if args.max_steps > 0:
        planned = min(planned, args.max_steps)
    log.info(
        "plan: records=%d batch=%d accum=%d steps/epoch=%d epochs=%d planned_steps=%d lr=%g",
        len(records),
        args.batch,
        args.accum,
        steps_per_epoch,
        args.epochs,
        planned,
        args.lr,
    )
    model.train()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    step = 0
    started = time.perf_counter()
    for epoch in range(args.epochs):
        epoch_seed = args.seed + epoch
        rng = random.Random(epoch_seed)
        micro_batches = epoch_batches(records, args.batch, rng)
        stopped = False
        for group in grouped(micro_batches, args.accum):
            step_started = time.perf_counter()
            group_loss = 0.0
            group_records = 0
            for micro in group:
                output = forward_batch(model, micro, seed=epoch_seed, device=device)
                (output.loss / len(group)).backward()
                group_loss += float(output.loss.detach().item())
                group_records += len(micro)
                metrics.note_prompt_tokens(output.prompt_tokens)
            lr_now = learning_rate_at(step, args.lr, args.warmup_steps)
            for param_group in optimizer.param_groups:
                param_group["lr"] = lr_now
            torch.nn.utils.clip_grad_norm_(parameters, args.max_grad_norm)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            step_log = StepLog(
                step=step,
                epoch=epoch,
                loss=group_loss / len(group),
                lr=lr_now,
                seconds=time.perf_counter() - step_started,
                max_memory_mb=max_memory_mb(device),
                records=group_records,
            )
            metrics.add_step(step_log)
            if step % args.log_every == 0 or step == planned:
                log.info(
                    "step %d/%d epoch=%d loss=%.4f lr=%.2e %.2fs max_mem=%s",
                    step,
                    planned,
                    epoch,
                    step_log.loss,
                    lr_now,
                    step_log.seconds,
                    f"{step_log.max_memory_mb:.0f}MB"
                    if step_log.max_memory_mb is not None
                    else "n/a",
                )
            if not math.isfinite(step_log.loss):
                raise TrainingError(f"loss is not finite at step {step}")
            if args.max_steps > 0 and step >= args.max_steps:
                stopped = True
                break
        if stopped:
            break
        metrics.epochs_completed += 1
    metrics.wall_seconds = time.perf_counter() - started
    model.eval()


def save_run(
    model: Any,
    args: argparse.Namespace,
    *,
    source_manifest: dict[str, Any],
    metrics: TrainingMetrics,
    tally: dict[str, int | bool],
    records: Sequence[TrainRecord],
    data_sha256: str,
    device: torch.device,
    dtype: torch.dtype,
) -> dict[str, Any]:
    out_dir: Path = args.out
    checkpoint.copy_package_sources(args.package, out_dir)
    embeddings_sha = checkpoint.check_decision_embeddings_unchanged(
        args.package, out_dir, source_manifest
    )
    checkpoint.save_adapter(model, out_dir)
    environment = {**environment_versions(), "device": str(device), "dtype": str(dtype)}
    init_from = {
        "package": args.package.name,
        "adapter_sha256": source_manifest["files"].get(checkpoint.ADAPTER_WEIGHTS),
        "decision_embeddings_sha256": embeddings_sha,
    }
    summary = metrics.summary()
    train_meta = {
        "trainer": TRAINER_NAME,
        "finishedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "dataFile": args.data.name,
        "dataSha256": data_sha256,
        "recordsTotal": metrics.records_total,
        "recordsKept": metrics.records_kept,
        "skippedOverLength": metrics.skipped_over_length,
        "maxStateTokens": args.max_state_tokens,
        "steps": metrics.step_count,
        "epochs": args.epochs,
        "epochsCompleted": metrics.epochs_completed,
        "maxSteps": args.max_steps,
        "lr": args.lr,
        "batch": args.batch,
        "accum": args.accum,
        "warmupSteps": args.warmup_steps,
        "weightDecay": args.weight_decay,
        "maxGradNorm": args.max_grad_norm,
        "seed": args.seed,
        "gradCheckpointing": args.grad_checkpointing,
        "device": str(device),
        "dtype": str(dtype),
        "firstLoss": summary["firstLoss"],
        "finalLoss": summary["finalLoss"],
        "meanLossLast10": summary["meanLossLast10"],
        "peakMemoryMb": summary["peakMemoryMb"],
        "wallSeconds": summary["wallSeconds"],
    }
    distribution = label_distribution(records)
    checkpoint.write_json(
        out_dir / "training_metrics.json",
        {
            "args": {
                key: str(value) if isinstance(value, Path) else value
                for key, value in vars(args).items()
            },
            "paramTally": tally,
            "environment": environment,
            "data": {
                "file": args.data.name,
                "sha256": data_sha256,
                "labelDistribution": distribution,
            },
            "metrics": metrics.to_dict(),
        },
    )
    (out_dir / "MODEL_CARD.md").write_text(
        checkpoint.render_model_card(
            run_name=out_dir.name,
            init_from={
                **init_from,
                "base_model": source_manifest["base_model"],
                "base_revision": source_manifest["base_revision"],
            },
            train=train_meta,
            metrics_summary=summary,
            label_distribution=distribution,
            environment=environment,
        ),
        encoding="utf-8",
    )
    manifest = checkpoint.write_manifest(
        out_dir, source_manifest, init_from=init_from, train=train_meta
    )
    log.info(
        "saved %s: adapter sha256=%s files=%d",
        out_dir,
        manifest["files"].get(checkpoint.ADAPTER_WEIGHTS),
        len(manifest["files"]),
    )
    return manifest


def run(args: argparse.Namespace) -> int:
    ensure_new_out_dir(args.out)
    seed_everything(args.seed)
    records = read_records(args.data)
    data_sha256 = sha256_file(args.data)
    log.info("data: %s records=%d sha256=%s", args.data.name, len(records), data_sha256[:16])

    source_manifest = checkpoint.read_manifest(args.package)
    mismatched = checkpoint.verify_manifest(args.package, source_manifest)
    if mismatched:
        raise TrainingError(f"source package manifest mismatch: {', '.join(mismatched)}")
    device = resolve_device(args.device)
    dtype = resolve_dtype(device, args.bf16)
    log.info("loading package=%s device=%s dtype=%s", args.package.name, device, dtype)
    model = load_bosun(args.package, device=device, dtype=dtype)

    tally = freeze_for_lora(model)
    log.info(
        "parameters: trainable tensors=%d params=%d frozen=%d total=%d embeddings_frozen=%s/%s",
        tally.trainable_tensors,
        tally.trainable_params,
        tally.frozen_params,
        tally.total_params,
        tally.input_embedding_frozen,
        tally.output_embedding_frozen,
    )
    assert_expected_tally(
        tally, expect_tensors=args.expect_tensors, expect_params=args.expect_params
    )
    if args.grad_checkpointing:
        enable_gradient_checkpointing(model)

    metrics = TrainingMetrics(records_total=len(records))
    filtered = filter_by_state_length(
        records, state_token_counter(model.tokenizer), args.max_state_tokens
    )
    metrics.records_kept = len(filtered.kept)
    metrics.skipped_over_length = filtered.skipped
    metrics.skipped_row_ids = list(filtered.skipped_row_ids)
    metrics.max_state_tokens_seen = filtered.max_state_tokens_seen
    log.info(
        "length filter: kept=%d skipped=%d max_state_tokens_seen=%d limit=%d",
        len(filtered.kept),
        filtered.skipped,
        filtered.max_state_tokens_seen,
        args.max_state_tokens,
    )
    if filtered.skipped:
        log.warning("%d records exceed --max-state-tokens and were skipped", filtered.skipped)
    if not filtered.kept:
        raise TrainingError("no records left after the length filter")

    train_loop(model, filtered.kept, args, device=device, metrics=metrics)
    log.info(
        "done: steps=%d first_loss=%s final_loss=%s wall=%.1fs peak_mem=%s",
        metrics.step_count,
        metrics.first_loss,
        metrics.final_loss,
        metrics.wall_seconds,
        metrics.peak_memory_mb,
    )
    save_run(
        model,
        args,
        source_manifest=source_manifest,
        metrics=metrics,
        tally=tally.to_dict(),
        records=filtered.kept,
        data_sha256=data_sha256,
        device=device,
        dtype=dtype,
    )
    if args.verify_reload:
        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()
        verify_reload(args.out, filtered.kept[0], device=device, dtype=dtype)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = build_parser().parse_args(argv)
    for name in ("epochs", "batch", "accum", "log_every"):
        if getattr(args, name) < 1:
            log.error("--%s must be >= 1", name.replace("_", "-"))
            return 2
    try:
        return run(args)
    except (
        RecordError,
        TrainingError,
        ParameterContractError,
        checkpoint.CheckpointError,
    ) as error:
        log.error("%s", error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
