"""서버 전용 학습 smoke(torch·transformers·peft 필요. 기본 `testpaths` 밖).

    SOL_BOSUN_PACKAGE=<snapshot> HF_HUB_OFFLINE=1 uv run --extra model pytest tests_model

`SOL_BOSUN_PACKAGE` 가 없으면 skip 이 아니라 **명확한 실패**로 끝난다(모델 없는 노트북에서 돌릴 시험이 아니다).
데이터는 영어 더미 레코드 몇 건이다(실제 공고·회사 데이터가 아니고 성능 주장을 하지 않는다).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from sol_decision.trainer.checkpoint import ADAPTER_WEIGHTS, read_manifest, verify_manifest
from sol_decision.trainer.data import parse_record

PACKAGE_ENV = "SOL_BOSUN_PACKAGE"
MISSING_PACKAGE_MESSAGE = (
    f"{PACKAGE_ENV} is not set. This is a server-only test: point it at a verified local Bosun "
    "snapshot (docs/22 §2.2) and run `uv run --extra model pytest tests_model` with HF_HUB_OFFLINE=1."
)


def require_package() -> Path:
    value = os.environ.get(PACKAGE_ENV)
    if not value:
        pytest.fail(MISSING_PACKAGE_MESSAGE, pytrace=False)
    package = Path(value)
    if not (package / "config.json").is_file():
        pytest.fail(f"{PACKAGE_ENV}={package} has no config.json", pytrace=False)
    return package


def row_id(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def dummy_records() -> list[dict]:
    """더미 질문 3종(choice 3·noul 2·score 5). 내용은 계약 형식 확인용 영어 문장이다."""

    state = (
        "NOTICE\n- stage: NOTICE; agency: (public agency); budget: 300,000,000 KRW\n"
        "- [requiredSkills[0]] Java-based web application development\n\n"
        "COMPANY (profile revision 1)\n- technologies: Java, Spring, PostgreSQL\n"
    )
    return [
        {
            "rowId": row_id("choice"),
            "qid": "req.requiredSkills[0].status",
            "questionType": "choice",
            "instructions": "Consider the requirement marked [requiredSkills[0]] in the NOTICE section. "
            "Does the company described in the COMPANY section satisfy it?",
            "candidates": [
                {"id": "SATISFIED", "label": "SATISFIED", "description": "clearly meets"},
                {
                    "id": "NOT_SATISFIED",
                    "label": "NOT_SATISFIED",
                    "description": "explicitly not met",
                },
                {
                    "id": "NEEDS_REVIEW",
                    "label": "NEEDS_REVIEW",
                    "description": "missing or ambiguous",
                },
            ],
            "state": state,
            "gold": {"candidateId": "SATISFIED", "probabilities": [1, 0, 0]},
            "labelSource": "CONSTRUCTED",
        },
        {
            "rowId": row_id("noul"),
            "qid": "risk.techGap",
            "questionType": "noul",
            "instructions": "Is there a technology gap between the notice and the company?",
            "candidates": [
                {"id": "true", "label": "true", "description": "yes"},
                {"id": "false", "label": "false", "description": "no"},
            ],
            "state": state,
            "gold": {"candidateId": "false", "probabilities": [0, 1]},
            "labelSource": "CONSTRUCTED",
        },
        {
            "rowId": row_id("score"),
            "qid": "techFit",
            "questionType": "score",
            "instructions": "How well do the company's technologies match the required stack?",
            "candidates": [
                {"id": str(index), "label": label}
                for index, label in enumerate(
                    ["Very poor", "Poor", "Moderate", "Good", "Very good"]
                )
            ],
            "state": state,
            "gold": {"candidateId": "3", "probabilities": [0, 0, 0.2, 0.8, 0]},
            "labelSource": "HUMAN",
        },
    ]


def write_dummy_data(path: Path) -> Path:
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in dummy_records()),
        encoding="utf-8",
    )
    return path


def test_lora_parameter_tally_matches_public_adapter() -> None:
    package = require_package()
    import torch

    from sol_decision.trainer.params import (
        EXPECTED_LORA_PARAMS,
        EXPECTED_LORA_TENSORS,
        assert_expected_tally,
        freeze_for_lora,
        load_bosun,
    )

    model = load_bosun(package, device=torch.device("cpu"), dtype=torch.float32)
    tally = freeze_for_lora(model)
    assert tally.trainable_tensors == EXPECTED_LORA_TENSORS
    assert tally.trainable_params == EXPECTED_LORA_PARAMS
    assert tally.input_embedding_frozen and tally.output_embedding_frozen
    assert_expected_tally(
        tally, expect_tensors=EXPECTED_LORA_TENSORS, expect_params=EXPECTED_LORA_PARAMS
    )


def test_training_path_matches_predict() -> None:
    package = require_package()
    import torch

    from sol_decision.parity import run_parity
    from sol_decision.trainer.params import load_bosun

    model = load_bosun(package, device=torch.device("cpu"), dtype=torch.float32)
    records = [parse_record(record) for record in dummy_records()]
    report = run_parity(model, records, seed=0, tolerance=1e-4, batch_tolerance=1e-3)
    assert report.prompts_identical
    assert report.passed, (report.max_abs_diff_single, report.max_abs_diff_batched)


def test_two_steps_on_cpu_save_and_reload(tmp_path: Path) -> None:
    package = require_package()
    from sol_decision.train import main

    data = write_dummy_data(tmp_path / "smoke.en.jsonl")
    out = tmp_path / "runs" / "smoke"
    code = main(
        [
            "--package",
            str(package),
            "--data",
            str(data),
            "--out",
            str(out),
            "--device",
            "cpu",
            "--max-steps",
            "2",
            "--batch",
            "2",
            "--accum",
            "1",
            "--epochs",
            "2",
            "--lr",
            "1e-4",
            "--verify-reload",
        ]
    )
    assert code == 0
    for name in (
        "config.json",
        "configuration_bosun.py",
        "modeling_bosun.py",
        "decision_embeddings.safetensors",
        "serving.json",
        "manifest.json",
        "training_metrics.json",
        "MODEL_CARD.md",
        "adapter/adapter_config.json",
        "adapter/adapter_model.safetensors",
        "tokenizer/tokenizer_config.json",
    ):
        assert (out / name).is_file(), name
    manifest = read_manifest(out)
    assert verify_manifest(out, manifest) == []
    source_manifest = read_manifest(package)
    assert manifest["base_model"] == source_manifest["base_model"]
    assert manifest["base_revision"] == source_manifest["base_revision"]
    assert (
        manifest["files"]["decision_embeddings.safetensors"]
        == source_manifest["files"]["decision_embeddings.safetensors"]
    )
    assert manifest["files"][ADAPTER_WEIGHTS] != source_manifest["files"][ADAPTER_WEIGHTS]
    assert manifest["train"]["steps"] == 2
    metrics = json.loads((out / "training_metrics.json").read_text(encoding="utf-8"))
    assert metrics["metrics"]["steps"] == 2
    assert metrics["metrics"]["skippedOverLength"] == 0
    assert metrics["paramTally"]["trainable_tensors"] == 392
