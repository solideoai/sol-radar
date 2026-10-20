"""모델 레지스트리 파일(03 §11, local 명세 §2). 값을 모르는 항목은 null 로 두고 지어내지 않는다."""

import pytest
import yaml
from support import KEV_MODEL_ID, KEV_RUN, QWEN_RUN, REGISTRY_FILE

UNKNOWN_KEV_FIELDS = (
    "base",
    "base_revision",
    "init_from",
    "lora",
    "temperature",
    "dataset",
    "questionSet",
    "stateTemplate",
)

# Hub jaredpalmer/kev-9b 태그 v1.0(커밋 3afdec81…)의 adapter_model.safetensors·head.pt.
# 2026-10-20 파일을 받아 계산한 sha256sum 이 Hub tree API 의 LFS oid 와 같았다(docs/22 §2.2)
KEV_V1_0_WEIGHTS_SHA256 = "2b2a70cf4ef4440b6c22899e1f72c2f8ea5c6f65b19aa344539b4b8971d1f13d"
KEV_V1_0_HEAD_SHA256 = "8e1dab2c8e3664f6fee843e0257d57946c25e0210c61901ea77e71761f4244e1"


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


def test_registry_kev_v1_0_sha256_are_verified_full_values():
    kev = entry(KEV_MODEL_ID)
    assert kev["weights_sha256"] == KEV_V1_0_WEIGHTS_SHA256
    assert kev["head_sha256"] == KEV_V1_0_HEAD_SHA256
    for value in (kev["weights_sha256"], kev["head_sha256"]):
        assert len(value) == 64 and all(ch in "0123456789abcdef" for ch in value)


def test_registry_kev_reports_are_empty():
    assert entry(KEV_MODEL_ID)["reports"] == []


def test_registry_qwen_default_entry():
    qwen = entry("qwen3.5-9b")
    assert (qwen["kind"], qwen["run"], qwen["default"]) == ("qwen", QWEN_RUN, True)
