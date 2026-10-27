"""결정 모델 레지스트리의 questionSet 과 KEV_QUESTION_SET 대조(local_setup 4단계, 16 닫힌 미결정 26-13 (a)).

레지스트리 항목이 특정 질문 세트로 학습했다고 적혀 있는데 다른 세트로 기동하면 거부한다. null(특정 세트로 학습하지 않음)은 통과다.
"""

import pytest
import yaml
from support import KEV_MODEL_ID, REGISTRY_FILE

from sol_ai.adapters import local_setup
from sol_ai.adapters.local_setup import LocalConfigError

MISMATCH = ("KEV_MODEL_ID", "QUESTION_SET_MISMATCH")


def point_registry(tmp_path, monkeypatch, question_set):
    """결정 모델 항목의 questionSet 만 바꾼 레지스트리 사본을 local_setup 이 읽게 한다."""
    registry = yaml.safe_load(REGISTRY_FILE.read_text(encoding="utf-8"))
    [entry] = [m for m in registry["entries"] if m["id"] == KEV_MODEL_ID]
    entry["questionSet"] = question_set
    copied = tmp_path / "registry.yaml"
    copied.write_text(yaml.safe_dump(registry, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr(local_setup, "REGISTRY_FILE", copied)


def test_question_set_mismatch_is_refused(make_client, local_models, tmp_path, monkeypatch):
    point_registry(tmp_path, monkeypatch, "kev-qs/v0.2")

    with pytest.raises(LocalConfigError) as refused:
        make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.1")

    assert MISMATCH in refused.value.violations


def test_null_question_set_starts(make_client, local_models, tmp_path, monkeypatch):
    point_registry(tmp_path, monkeypatch, None)

    client = make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.1")

    assert client.get("/health").status_code == 200
