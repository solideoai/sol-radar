"""모델 레지스트리 파일(03 §11, local 명세 §2). 값을 모르는 항목은 null 로 두고 지어내지 않는다."""

import pytest
import yaml
from support import KEV_MODEL_ID, KEV_RUN, QWEN_RUN, REGISTRY_FILE

UNKNOWN_KEV_FIELDS = (
    "base",
    "base_revision",
    "init_from",
    "lora",
    "weights_sha256",
    "head_sha256",
    "temperature",
    "dataset",
    "questionSet",
    "stateTemplate",
)


def registry() -> dict:
    return yaml.safe_load(REGISTRY_FILE.read_text(encoding="utf-8"))


def entry(entry_id: str) -> dict:
    return next(e for e in registry()["entries"] if e["id"] == entry_id)


def test_registry_schema_version():
    assert registry()["schemaVersion"] == "model-registry/v0.1"


def test_registry_ids_are_unique():
    ids = [e["id"] for e in registry()["entries"]]
    assert len(ids) == len(set(ids))


def test_registry_kev_entry_identity():
    kev = entry(KEV_MODEL_ID)
    assert (kev["kind"], kev["run"]) == ("kev", KEV_RUN)


def test_registry_kev_request_model_is_kev_latest():
    # L4: /v1/systemone 요청의 "model". README 예시라 미검증 가정이다
    assert entry(KEV_MODEL_ID)["requestModel"] == "kev-latest"


@pytest.mark.parametrize("field", UNKNOWN_KEV_FIELDS)
def test_registry_kev_unknown_values_are_null(field):
    kev = entry(KEV_MODEL_ID)
    assert field in kev
    assert kev[field] is None


def test_registry_kev_reports_are_empty():
    assert entry(KEV_MODEL_ID)["reports"] == []


def test_registry_qwen_default_entry():
    qwen = entry("qwen3.5-9b")
    assert (qwen["kind"], qwen["run"], qwen["default"]) == ("qwen", QWEN_RUN, True)
