"""학습기 순수 함수 시험(torch 없이): 레코드 파싱·검증, 슬롯 재배열, 프롬프트 배선, 길이 필터, 지표 집계,
manifest 재계산, 온도 보정. 모델이 필요한 시험은 `tests_model/`(서버 전용)에 있다."""

from __future__ import annotations

import hashlib
import json
import sys
import types
from pathlib import Path
from typing import ClassVar

import pytest

from sol_decision.trainer import calibrate, checkpoint
from sol_decision.trainer.data import (
    RecordError,
    filter_by_state_length,
    parse_lines,
    parse_record,
    read_records,
)
from sol_decision.trainer.metrics import StepLog, TrainingMetrics, label_distribution
from sol_decision.trainer.prompting import (
    PromptContractError,
    check_order_consistency,
    model_module,
    render_record,
    slot_targets,
    slot_to_candidate_order,
)

CHOICE_CANDIDATES = [
    {"id": "SATISFIED", "label": "SATISFIED", "description": "clearly meets"},
    {"id": "NOT_SATISFIED", "label": "NOT_SATISFIED", "description": "explicitly not met"},
    {"id": "NEEDS_REVIEW", "label": "NEEDS_REVIEW", "description": "missing or ambiguous"},
]


def make_record(**overrides: object) -> dict:
    record = {
        "rowId": "a" * 64,
        "itemId": "item-1",
        "clusterId": "cluster-1",
        "split": "train",
        "qid": "req.requiredSkills[0].status",
        "questionType": "choice",
        "instructions": "Consider the requirement marked [requiredSkills[0]].",
        "candidates": CHOICE_CANDIDATES,
        "state": "NOTICE\n- stage: NOTICE\n\nCOMPANY\n- ...",
        "stateHash": "b" * 64,
        "stateTemplate": "en.v0.2",
        "questionSet": "kev-qs/v0.2",
        "gold": {"candidateId": "NEEDS_REVIEW", "probabilities": [0, 0, 1]},
        "labelSource": "CONSTRUCTED",
    }
    record.update(overrides)
    return record


# --- 레코드 파싱·검증 -------------------------------------------------------------


def test_parse_record_keeps_contract_fields() -> None:
    record = parse_record(make_record(), line_no=1)
    assert record.row_id == "a" * 64
    assert record.question_type == "choice"
    assert record.candidate_ids == ("SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW")
    assert record.gold_candidate_id == "NEEDS_REVIEW"
    assert record.gold_index == 2
    assert record.gold_probabilities == (0.0, 0.0, 1.0)
    assert record.candidates[0].as_mapping() == CHOICE_CANDIDATES[0]
    assert record.label_source == "CONSTRUCTED"
    assert record.cluster_id == "cluster-1"


def test_parse_record_accepts_soft_target_and_missing_description() -> None:
    noul = make_record(
        qid="risk.scale",
        questionType="noul",
        candidates=[{"id": "true", "label": "true"}, {"id": "false", "label": "false"}],
        gold={"candidateId": "true", "probabilities": [0.7, 0.3]},
    )
    record = parse_record(noul)
    assert record.candidates[0].description == ""
    assert record.gold_probabilities == (0.7, 0.3)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"questionType": "rank"}, "questionType"),
        ({"candidates": CHOICE_CANDIDATES[:1]}, "candidates must be 2..255"),
        ({"candidates": [{"id": str(i), "label": str(i)} for i in range(256)]}, "2..255"),
        ({"candidates": CHOICE_CANDIDATES + [CHOICE_CANDIDATES[0]]}, "duplicate candidate id"),
        (
            {"gold": {"candidateId": "MAYBE", "probabilities": [0, 0, 1]}},
            "not one of the candidates",
        ),
        ({"gold": {"candidateId": "NEEDS_REVIEW", "probabilities": [0, 1]}}, "must have 3 entries"),
        ({"gold": {"candidateId": "NEEDS_REVIEW", "probabilities": [0.5, 0, 1]}}, "sum to 1"),
        ({"gold": {"candidateId": "SATISFIED", "probabilities": [0.2, 0.3, 0.5]}}, "argmax"),
        ({"gold": {"candidateId": "SATISFIED", "probabilities": [1, 0, "x"]}}, "must be a number"),
        ({"state": {"stage": "NOTICE"}}, "'state' must be a non-empty string"),
        ({"instructions": ""}, "'instructions'"),
    ],
)
def test_parse_record_rejects_contract_violations(overrides: dict, message: str) -> None:
    with pytest.raises(RecordError, match=message):
        parse_record(make_record(**overrides), line_no=7)


def test_parse_record_reports_missing_field_with_line_number() -> None:
    broken = make_record()
    del broken["gold"]
    with pytest.raises(RecordError, match=r"line 12: missing field 'gold'"):
        parse_record(broken, line_no=12)


def test_parse_lines_skips_blank_lines_and_names_bad_json_line() -> None:
    lines = [json.dumps(make_record()), "", "   ", json.dumps(make_record(rowId="c" * 64))]
    records = parse_lines(lines)
    assert [record.row_id for record in records] == ["a" * 64, "c" * 64]
    with pytest.raises(RecordError, match=r"line 2: invalid JSON"):
        parse_lines([json.dumps(make_record()), "{not json"])
    with pytest.raises(RecordError, match="no records"):
        parse_lines(["", "\n"])


def test_read_records_from_file(tmp_path: Path) -> None:
    path = tmp_path / "train.en.jsonl"
    path.write_text(json.dumps(make_record()) + "\n", encoding="utf-8")
    assert len(read_records(path)) == 1


# --- 슬롯 재배열 -------------------------------------------------------------------


def test_slot_targets_rearranges_candidate_order_to_slots() -> None:
    candidate_to_slot = {"A": 2, "B": 0, "C": 1}
    assert slot_targets([0.7, 0.2, 0.1], ["A", "B", "C"], candidate_to_slot) == [0.2, 0.1, 0.7]


def test_slot_to_candidate_order_inverts_presentation_order() -> None:
    # presentation_order[slot] = 원래 후보 index
    presentation_order = (2, 0, 1)
    slot_values = [0.5, 0.3, 0.2]
    candidate_values = slot_to_candidate_order(slot_values, presentation_order)
    assert candidate_values == [0.3, 0.2, 0.5]
    # 둘은 서로 역함수다
    candidate_to_slot = {"c0": 1, "c1": 2, "c2": 0}
    assert slot_targets(candidate_values, ["c0", "c1", "c2"], candidate_to_slot) == slot_values


def test_check_order_consistency_detects_disagreement() -> None:
    ids = ["x", "y", "z"]
    check_order_consistency((1, 2, 0), {"y": 0, "z": 1, "x": 2}, ids)
    with pytest.raises(PromptContractError, match="disagrees"):
        check_order_consistency((1, 2, 0), {"y": 1, "z": 0, "x": 2}, ids)
    with pytest.raises(PromptContractError, match="permutation"):
        check_order_consistency((0, 0, 1), {"x": 0, "y": 0, "z": 1}, ids)


# --- 프롬프트 배선(모델 모듈의 render_decision_prompt·_SYSTEM_PROMPT 를 그대로 쓰는지) ----------


class FakeTokenizer:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def apply_chat_template(self, messages: list[dict], **kwargs: object) -> str:
        self.calls.append({"messages": messages, **kwargs})
        return "<chat>" + messages[-1]["content"] + "</chat>"


class FakeConfig:
    prompt_schema = "fake-schema"
    decision_prompt_enable_thinking = False


def install_fake_bosun_module(monkeypatch: pytest.MonkeyPatch) -> tuple[types.ModuleType, type]:
    module = types.ModuleType("fake_modeling_bosun")
    module._SYSTEM_PROMPT = "FAKE SYSTEM PROMPT"
    calls: list[dict] = []

    def render_decision_prompt(**kwargs: object) -> tuple[str, list[int], dict[str, int]]:
        calls.append(kwargs)
        candidates = kwargs["candidates"]
        order = list(range(len(candidates)))[::-1]  # 결정적 역순 제시
        candidate_to_slot = {str(candidates[index]["id"]): slot for slot, index in enumerate(order)}
        return "CONTENT:" + str(kwargs["row_id"]), order, candidate_to_slot

    module.render_decision_prompt = render_decision_prompt
    module.render_calls = calls
    monkeypatch.setitem(sys.modules, module.__name__, module)

    class FakeModel:
        __module__ = module.__name__
        decision_tokens: ClassVar[list[str]] = [f"<|decision_{index:03d}|>" for index in range(256)]
        config = FakeConfig()

        def __init__(self) -> None:
            self.tokenizer = FakeTokenizer()

    return module, FakeModel


def test_render_record_uses_model_module_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    module, fake_model_class = install_fake_bosun_module(monkeypatch)
    model = fake_model_class()
    assert model_module(model) is module
    record = parse_record(
        make_record(gold={"candidateId": "SATISFIED", "probabilities": [1, 0, 0]})
    )

    rendered = render_record(model, record, seed=3)

    call = module.render_calls[-1]
    assert call["state"] == record.state
    assert call["instructions"] == record.instructions
    assert call["candidates"] == CHOICE_CANDIDATES
    assert call["decision_type"] == "choice"
    assert call["decision_tokens"] == model.decision_tokens
    assert call["seed"] == 3
    assert call["row_id"] == record.row_id
    assert call["prompt_schema"] == "fake-schema"
    chat = model.tokenizer.calls[-1]
    assert chat["messages"] == [
        {"role": "system", "content": "FAKE SYSTEM PROMPT"},
        {"role": "user", "content": "CONTENT:" + record.row_id},
    ]
    assert chat["tokenize"] is False
    assert chat["add_generation_prompt"] is True
    assert chat["enable_thinking"] is False
    assert rendered.prompt.startswith("<chat>")
    # 역순 제시: 슬롯 0 ← 후보 2, 슬롯 2 ← 후보 0(SATISFIED)
    assert rendered.presentation_order == (2, 1, 0)
    assert rendered.gold_slot == 2
    assert rendered.slot_targets == (0.0, 0.0, 1.0)


def test_model_module_requires_render_function(monkeypatch: pytest.MonkeyPatch) -> None:
    module = types.ModuleType("fake_bosun_without_render")
    module._SYSTEM_PROMPT = "x"
    monkeypatch.setitem(sys.modules, module.__name__, module)

    class Bare:
        __module__ = module.__name__

    with pytest.raises(PromptContractError, match="render_decision_prompt"):
        model_module(Bare())


# --- 길이 필터 ---------------------------------------------------------------------


def test_filter_by_state_length_skips_long_records() -> None:
    short = parse_record(make_record(rowId="1" * 64, state="short"))
    long = parse_record(make_record(rowId="2" * 64, state="x" * 100))
    result = filter_by_state_length([short, long], lambda text: len(text), max_state_tokens=10)
    assert [record.row_id for record in result.kept] == ["1" * 64]
    assert result.skipped_row_ids == ("2" * 64,)
    assert result.skipped == 1
    assert result.max_state_tokens_seen == 100


# --- 지표 집계 ---------------------------------------------------------------------


def test_training_metrics_summary() -> None:
    metrics = TrainingMetrics(records_total=10, records_kept=9, skipped_over_length=1)
    for step in range(1, 13):
        metrics.add_step(
            StepLog(
                step=step,
                epoch=0,
                loss=1.0 / step,
                lr=1e-4,
                seconds=0.5,
                max_memory_mb=100.0 * step,
                records=8,
            )
        )
    metrics.note_prompt_tokens(1234)
    metrics.epochs_completed = 1
    metrics.wall_seconds = 6.0
    summary = metrics.summary()
    assert summary["steps"] == 12
    assert summary["firstLoss"] == 1.0
    assert summary["finalLoss"] == pytest.approx(1 / 12)
    assert summary["meanLossLast10"] == pytest.approx(sum(1.0 / s for s in range(3, 13)) / 10)
    assert summary["peakMemoryMb"] == 1200.0
    assert summary["recordsSeen"] == 96
    assert summary["maxPromptTokensSeen"] == 1234
    assert summary["skippedOverLength"] == 1
    assert len(metrics.to_dict()["lossCurve"]) == 12


def test_label_distribution_counts_without_record_bodies() -> None:
    records = [
        parse_record(make_record()),
        parse_record(
            make_record(gold={"candidateId": "SATISFIED", "probabilities": [0.6, 0.4, 0]})
        ),
    ]
    distribution = label_distribution(records)
    assert distribution["records"] == 2
    assert distribution["byQuestionType"] == {"choice": 2}
    assert distribution["byGoldCandidate"] == {"choice:NEEDS_REVIEW": 1, "choice:SATISFIED": 1}
    assert distribution["byLabelSource"] == {"CONSTRUCTED": 2}
    assert distribution["byCandidateCount"] == {"3": 2}
    assert distribution["softTargets"] == 1
    assert "NOTICE" not in json.dumps(distribution)


# --- manifest 재계산(가짜 패키지) -----------------------------------------------------


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_fake_package(root: Path) -> dict:
    files = {
        "config.json": b'{"model_type": "bosun"}',
        "configuration_bosun.py": b"class BosunConfig: ...\n",
        "modeling_bosun.py": b"_SYSTEM_PROMPT = 'x'\n",
        "decision_embeddings.safetensors": b"EMBEDDINGS",
        "serving.json": b"{}",
        "tokenizer/tokenizer.json": b"{}",
        "tokenizer/tokenizer_config.json": b'{"padding_side": "left"}',
        "adapter/adapter_config.json": b'{"r": 16}',
        "adapter/adapter_model.safetensors": b"OLD-ADAPTER",
    }
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    manifest = {
        "base_model": "Qwen/Qwen3-0.6B",
        "base_revision": "c1899de",
        "selected_epoch": 2,
        "metrics": {"eval/accuracy": 0.88},
        "files": {relative: sha256_bytes(content) for relative, content in files.items()},
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


class FakePeftModel:
    def __init__(self) -> None:
        self.kwargs: dict = {}

    def save_pretrained(self, directory: str, **kwargs: object) -> None:
        self.kwargs = kwargs
        target = Path(directory)
        (target / "adapter_config.json").write_bytes(b'{"r": 16, "inference_mode": true}')
        (target / "adapter_model.safetensors").write_bytes(b"NEW-ADAPTER")
        (target / "README.md").write_bytes(b"peft card")


class FakeBosun:
    def __init__(self) -> None:
        self.model = FakePeftModel()


def test_manifest_verify_and_recompute(tmp_path: Path) -> None:
    source = tmp_path / "snapshot"
    source.mkdir()
    source_manifest = build_fake_package(source)
    assert checkpoint.read_manifest(source) == source_manifest
    assert checkpoint.verify_manifest(source, source_manifest) == []

    out = tmp_path / "runs" / "bosun-sol-lora-v0.1"
    copied = checkpoint.copy_package_sources(source, out)
    assert "config.json" in copied and "tokenizer/tokenizer.json" in copied
    digest = checkpoint.check_decision_embeddings_unchanged(source, out, source_manifest)
    assert digest == sha256_bytes(b"EMBEDDINGS")

    bosun = FakeBosun()
    checkpoint.save_adapter(bosun, out)
    assert bosun.model.kwargs == {"safe_serialization": True, "save_embedding_layers": False}
    assert not (out / "adapter" / "README.md").exists()
    (out / "training_metrics.json").write_text("{}", encoding="utf-8")

    manifest = checkpoint.write_manifest(
        out,
        source_manifest,
        init_from={"package": "snapshot", "adapter_sha256": sha256_bytes(b"OLD-ADAPTER")},
        train={"steps": 20, "finalLoss": 0.5},
    )
    written = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert written == manifest
    assert manifest["base_model"] == "Qwen/Qwen3-0.6B"
    assert manifest["base_revision"] == "c1899de"
    assert "metrics" not in manifest and "selected_epoch" not in manifest
    assert manifest["init_from"]["metrics"] == {"eval/accuracy": 0.88}
    assert manifest["init_from"]["selected_epoch"] == 2
    assert manifest["init_from"]["adapter_sha256"] == sha256_bytes(b"OLD-ADAPTER")
    assert manifest["train"] == {"steps": 20, "finalLoss": 0.5}
    files = manifest["files"]
    assert files["adapter/adapter_model.safetensors"] == sha256_bytes(b"NEW-ADAPTER")
    assert (
        files["decision_embeddings.safetensors"]
        == source_manifest["files"]["decision_embeddings.safetensors"]
    )
    assert files["tokenizer/tokenizer_config.json"] == sha256_bytes(b'{"padding_side": "left"}')
    assert "manifest.json" not in files and "training_metrics.json" not in files
    assert list(files) == sorted(files)
    # 재계산한 manifest 로 다시 대조하면 통과한다
    assert checkpoint.verify_manifest(out, manifest) == []


def test_manifest_verify_reports_tampered_file(tmp_path: Path) -> None:
    source = tmp_path / "snapshot"
    source.mkdir()
    manifest = build_fake_package(source)
    (source / "adapter" / "adapter_model.safetensors").write_bytes(b"TAMPERED")
    assert checkpoint.verify_manifest(source, manifest) == ["adapter/adapter_model.safetensors"]


def test_decision_embeddings_change_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "snapshot"
    source.mkdir()
    manifest = build_fake_package(source)
    out = tmp_path / "out"
    checkpoint.copy_package_sources(source, out)
    (out / "decision_embeddings.safetensors").write_bytes(b"CHANGED")
    with pytest.raises(checkpoint.CheckpointError, match="decision_embeddings"):
        checkpoint.check_decision_embeddings_unchanged(source, out, manifest)


def test_model_card_lists_sha_steps_loss_and_skips() -> None:
    card = checkpoint.render_model_card(
        run_name="bosun-sol-lora-v0.1",
        init_from={"adapter_sha256": "961d237b", "metrics": {"hidden": 1}},
        train={"dataSha256": "deadbeef", "steps": 20, "finalLoss": 0.42, "skippedOverLength": 3},
        metrics_summary={"finalLoss": 0.42, "skippedOverLength": 3},
        label_distribution={"records": 6},
        environment={"torch": "2.8.0"},
    )
    assert "# bosun-sol-lora-v0.1" in card
    assert "deadbeef" in card and "961d237b" in card
    assert "`20`" in card and "`0.42`" in card and "`3`" in card
    assert "hidden" not in card
    assert "성능 주장 없음" in card


# --- 온도 보정 ---------------------------------------------------------------------


def test_scale_probabilities_identity_at_t1() -> None:
    assert calibrate.scale_probabilities([0.2, 0.5, 0.3], 1.0) == pytest.approx([0.2, 0.5, 0.3])
    flatter = calibrate.scale_probabilities([0.2, 0.5, 0.3], 2.0)
    assert max(flatter) < 0.5
    assert sum(flatter) == pytest.approx(1.0)


def test_fit_temperature_softens_overconfident_predictions() -> None:
    # 정답을 절반만 맞히면서 0.95 로 확신하는 예측: T > 1 이 되어야 하고 NLL·ECE 가 줄어야 한다
    rows = []
    for index in range(40):
        gold = 0 if index % 2 == 0 else 1
        rows.append(
            calibrate.CalibrationRow(row_id=str(index), probabilities=(0.95, 0.05), gold_index=gold)
        )
    report = calibrate.calibrate(rows, bins=10)
    assert report.temperature > 1.0
    assert report.nll_after < report.nll_before
    assert report.ece_after < report.ece_before
    assert report.accuracy == pytest.approx(0.5)
    assert report.to_dict()["method"] == "temperature_scaling_min_nll"


def test_ece_is_small_for_calibrated_rows() -> None:
    # confidence 0.8 bin 에서 정확히 80% 맞히는 예측
    rows = [
        calibrate.CalibrationRow(
            row_id=str(i), probabilities=(0.8, 0.2), gold_index=0 if i < 8 else 1
        )
        for i in range(10)
    ]
    assert calibrate.expected_calibration_error(rows, 1.0, bins=10) == pytest.approx(0.0, abs=1e-9)


def test_rows_from_predictions_joins_on_row_id() -> None:
    records = [parse_record(make_record(rowId="r" * 64))]
    predictions = [{"rowId": "r" * 64, "probabilities": [0.1, 0.2, 0.7], "seed": 3}]
    rows = calibrate.rows_from_predictions(predictions, records)
    assert rows[0].gold_index == 2 and rows[0].seed == 3
    with pytest.raises(ValueError, match="rowId not found"):
        calibrate.rows_from_predictions([{"rowId": "zzz", "probabilities": [1, 0, 0]}], records)
    with pytest.raises(ValueError, match="must have 3 entries"):
        calibrate.rows_from_predictions([{"rowId": "r" * 64, "probabilities": [1, 0]}], records)


def test_parse_seeds() -> None:
    assert calibrate.parse_seeds("0-5") == [0, 1, 2, 3, 4, 5]
    assert calibrate.parse_seeds("0,2") == [0, 2]
