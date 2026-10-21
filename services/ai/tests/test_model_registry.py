"""모델 레지스트리 파일(03 §11, ADR-034 6번)과 읽기(sol_ai.registry). 값을 모르는 항목은 null 로 두고 지어내지 않는다.

- active 항목: bosun-v3.1-0.6b(kind decision), qwen3.8-flash-next(kind qwen, default)
- retired: kev-9b-v1.0(내용 보존)·qwen3.5-27b·qwen3.5-9b(default 제거), backup: qwen3-4b-instruct-2507(리비전 기록만)
- mock 항목은 두지 않는다(ADR-034 15번)
"""

import pytest
import yaml
from support import (
    BACKUP_QWEN_RUN,
    KEV_BASE,
    KEV_LORA_SHA256,
    KEV_MODEL_ID,
    KEV_REQUEST_MODEL,
    KEV_REVISION,
    KEV_RUN,
    QWEN_RUN,
    REGISTRY_FILE,
    RETIRED_KEV_MODEL_ID,
    RETIRED_QWEN27B_RUN,
    RETIRED_QWEN_RUN,
)

from sol_ai.errors import StartupRefused
from sol_ai.registry import ModelRegistry

# Hugging Face Hanno-Labs/bosun-v3.1-0.6b 리비전 5e78a37c… 의 패키지 manifest.json(2026-10-20 확인)
BOSUN_BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
BOSUN_DECISION_EMBEDDINGS_SHA256 = (
    "88f9e856054f78ac521ba0180052d25720c3786d1db4e80aa7a8ecf39be01188"
)
QWEN_BACKUP_REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"
# 퇴역 Kev 항목이 보존해야 하는 값(Hub jaredpalmer/kev-9b 태그 v1.0, docs/22 §2.2)
KEV_V1_0_WEIGHTS_SHA256 = "2b2a70cf4ef4440b6c22899e1f72c2f8ea5c6f65b19aa344539b4b8971d1f13d"
KEV_V1_0_HEAD_SHA256 = "8e1dab2c8e3664f6fee843e0257d57946c25e0210c61901ea77e71761f4244e1"

UNKNOWN_BOSUN_FIELDS = ("init_from", "temperature", "dataset", "questionSet", "stateTemplate")
HEX64 = set("0123456789abcdef")


def registry() -> dict:
    return yaml.safe_load(REGISTRY_FILE.read_text(encoding="utf-8"))


def entry(entry_id: str) -> dict:
    return next(e for e in registry()["entries"] if e["id"] == entry_id)


def is_sha256(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= HEX64


def is_sha1(value: object) -> bool:
    return isinstance(value, str) and len(value) == 40 and set(value) <= HEX64


def write_registry(tmp_path, data: dict):
    path = tmp_path / "registry.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


# ---------------------------------------------------------------- 파일


def test_registry_schema_version():
    assert registry()["schemaVersion"] == "model-registry/v0.1"


def test_registry_ids_are_unique():
    ids = [e["id"] for e in registry()["entries"]]
    assert len(ids) == len(set(ids))


def test_registry_has_no_mock_entry():
    # ADR-034 15번: mock 응답의 모델 식별자는 "mock" 이고 레지스트리 항목이 아니다
    values = {str(v).lower() for e in registry()["entries"] for v in (e["id"], e["run"])}
    assert not any("mock" in v for v in values)


def test_registry_decision_entry_identity():
    bosun = entry(KEV_MODEL_ID)
    assert (bosun["kind"], bosun["run"], bosun["status"]) == ("decision", KEV_RUN, "active")


def test_registry_decision_entry_revisions_are_full_sha1():
    bosun = entry(KEV_MODEL_ID)
    assert (bosun["revision"], bosun["base_revision"]) == (KEV_REVISION, BOSUN_BASE_REVISION)
    assert is_sha1(bosun["revision"]) and is_sha1(bosun["base_revision"])
    # run·base 표기는 <repo>@<sha 앞 8자>
    assert (
        KEV_RUN.endswith("@" + KEV_REVISION[:8]),
        KEV_BASE.endswith("@" + BOSUN_BASE_REVISION[:8]),
    ) == (True, True)
    assert bosun["base"] == KEV_BASE


def test_registry_decision_entry_sha256_are_verified_full_values():
    bosun = entry(KEV_MODEL_ID)
    assert bosun["lora"] == KEV_LORA_SHA256
    assert bosun["decision_embeddings_sha256"] == BOSUN_DECISION_EMBEDDINGS_SHA256
    assert is_sha256(bosun["lora"]) and is_sha256(bosun["decision_embeddings_sha256"])


def test_registry_decision_request_model_is_entry_id():
    assert entry(KEV_MODEL_ID)["requestModel"] == KEV_REQUEST_MODEL == KEV_MODEL_ID


@pytest.mark.parametrize("field", UNKNOWN_BOSUN_FIELDS)
def test_registry_decision_unknown_values_are_null(field):
    bosun = entry(KEV_MODEL_ID)
    assert field in bosun
    assert bosun[field] is None


def test_registry_decision_reports_are_empty():
    assert entry(KEV_MODEL_ID)["reports"] == []


def test_registry_qwen_default_entry():
    qwen = entry("qwen3.8-flash-next")
    assert (qwen["kind"], qwen["run"], qwen["default"], qwen["status"]) == (
        "qwen",
        QWEN_RUN,
        True,
        "active",
    )
    # 회사 운영 값이라 리비전은 모른다(null). 지어내지 않는다
    assert "revision" in qwen and qwen["revision"] is None


def test_registry_has_exactly_one_active_qwen_default():
    defaults = [
        e
        for e in registry()["entries"]
        if e["kind"] == "qwen" and e.get("default") and e.get("status", "active") == "active"
    ]
    assert [e["id"] for e in defaults] == ["qwen3.8-flash-next"]


def test_registry_retired_kev_entry_is_preserved():
    kev = entry(RETIRED_KEV_MODEL_ID)
    assert (kev["kind"], kev["run"], kev["status"]) == ("kev", "jaredpalmer/kev-9b@v1.0", "retired")
    assert (kev["weights_sha256"], kev["head_sha256"]) == (
        KEV_V1_0_WEIGHTS_SHA256,
        KEV_V1_0_HEAD_SHA256,
    )
    assert kev["requestModel"] == "kev-latest"


def test_registry_retired_qwen27b_entry_has_no_default():
    # 2026-10-21 회사 vLLM 모델 교체로 퇴역. 리비전은 그때도 몰랐다(null)
    qwen = entry("qwen3.5-27b")
    assert (qwen["kind"], qwen["run"], qwen["status"], qwen["revision"]) == (
        "qwen",
        RETIRED_QWEN27B_RUN,
        "retired",
        None,
    )
    assert "default" not in qwen


def test_registry_retired_qwen_entry_has_no_default():
    qwen = entry("qwen3.5-9b")
    assert (qwen["kind"], qwen["run"], qwen["status"]) == ("qwen", RETIRED_QWEN_RUN, "retired")
    assert "default" not in qwen


def test_registry_backup_qwen_entry_records_revision_only():
    qwen = entry("qwen3-4b-instruct-2507")
    assert (qwen["kind"], qwen["run"], qwen["status"], qwen["revision"]) == (
        "qwen",
        BACKUP_QWEN_RUN,
        "backup",
        QWEN_BACKUP_REVISION,
    )
    assert "default" not in qwen


# ---------------------------------------------------------------- 읽기(ModelRegistry)


def loaded() -> ModelRegistry:
    return ModelRegistry.load(REGISTRY_FILE)


def test_load_decision_entry_fields():
    bosun = loaded().decision(KEV_MODEL_ID)
    assert bosun is not None
    assert (bosun.kind, bosun.run, bosun.status, bosun.active) == (
        "decision",
        KEV_RUN,
        "active",
        True,
    )
    assert (bosun.revision, bosun.base_revision, bosun.decision_embeddings_sha256) == (
        KEV_REVISION,
        BOSUN_BASE_REVISION,
        BOSUN_DECISION_EMBEDDINGS_SHA256,
    )
    # 대조 값: base·lora 만(temperature 는 null 이라 대조하지 않는다)
    assert bosun.match_values == {"base": KEV_BASE, "lora": KEV_LORA_SHA256}
    assert (bosun.request_model, bosun.question_set) == (KEV_REQUEST_MODEL, None)


def test_load_retired_decision_entry_is_found_but_not_active():
    kev = loaded().decision(RETIRED_KEV_MODEL_ID)
    assert kev is not None
    assert (kev.kind, kev.status, kev.active) == ("kev", "retired", False)


def test_load_unknown_decision_entry_is_none():
    assert loaded().decision("kev-unknown-v9") is None


def test_load_qwen_entry_is_not_a_decision_entry():
    assert loaded().decision("qwen3.8-flash-next") is None


def test_load_qwen_default_is_active_flash_next():
    default = loaded().qwen_default()
    assert default is not None
    assert (default.id, default.run, default.revision) == ("qwen3.8-flash-next", QWEN_RUN, None)


def test_load_qwen_runs_exclude_retired_and_backup():
    assert loaded().qwen_runs() == {QWEN_RUN}


@pytest.mark.parametrize(
    ("run", "status"),
    [
        (RETIRED_QWEN27B_RUN, "retired"),
        (RETIRED_QWEN_RUN, "retired"),
        (BACKUP_QWEN_RUN, "backup"),
    ],
)
def test_load_inactive_qwen_entry_is_found_with_status(run, status):
    qwen = loaded().qwen_entry(run)
    assert qwen is not None
    assert (qwen.status, qwen.active, qwen.default) == (status, False, False)


# ---------------------------------------------------------------- /v1/models 대조(RegistryEntry.matches)


def server_model(**overrides: object) -> dict:
    model: dict[str, object] = {
        "id": KEV_MODEL_ID,
        "run": KEV_RUN,
        "base": KEV_BASE,
        "lora": KEV_LORA_SHA256,
        "revision": KEV_REVISION,
        "temperature": None,
    }
    return {**model, **overrides}


def bosun():
    found = loaded().decision(KEV_MODEL_ID)
    assert found is not None
    return found


def test_matches_server_model_with_same_values():
    assert bosun().matches(server_model()) is True


def test_matches_ignores_null_temperature_in_registry():
    # 레지스트리 temperature 가 null 이면 서버 값이 무엇이든 대조하지 않는다
    assert bosun().matches(server_model(temperature=1.0)) is True


@pytest.mark.parametrize("field", ["run", "base", "lora", "revision"])
def test_matches_rejects_different_value(field):
    assert bosun().matches(server_model(**{field: "something-else"})) is False


@pytest.mark.parametrize("field", ["base", "lora"])
def test_matches_rejects_missing_non_null_field(field):
    model = server_model()
    del model[field]
    assert bosun().matches(model) is False


def test_matches_skips_revision_when_server_omits_it():
    model = server_model()
    del model["revision"]
    assert bosun().matches(model) is True


def test_matches_rejects_non_object():
    assert bosun().matches("bosun") is False


def test_matches_string_lora_against_string_lora():
    # lora 가 sha256 문자열이어도 non-null 값 비교로 동작한다(옛 항목은 null 이라 비교하지 않았다)
    assert bosun().matches(server_model(lora=KEV_LORA_SHA256.upper())) is False


# ---------------------------------------------------------------- 파일 위반(기동 거부)


def test_load_rejects_unknown_kind(tmp_path):
    data = registry()
    data["entries"][0]["kind"] = "oracle"
    with pytest.raises(StartupRefused) as refused:
        ModelRegistry.load(write_registry(tmp_path, data))
    assert refused.value.summary == "MODEL_REGISTRY(KIND_INVALID)"


def test_load_rejects_unknown_status(tmp_path):
    data = registry()
    data["entries"][0]["status"] = "draft"
    with pytest.raises(StartupRefused) as refused:
        ModelRegistry.load(write_registry(tmp_path, data))
    assert refused.value.summary == "MODEL_REGISTRY(STATUS_INVALID)"


def test_load_rejects_two_active_qwen_defaults(tmp_path):
    data = registry()
    retired = next(e for e in data["entries"] if e["id"] == "qwen3.5-9b")
    retired.update({"status": "active", "default": True})
    with pytest.raises(StartupRefused) as refused:
        ModelRegistry.load(write_registry(tmp_path, data))
    assert refused.value.summary == "MODEL_REGISTRY(QWEN_DEFAULT_AMBIGUOUS)"


def test_load_rejects_duplicate_ids(tmp_path):
    data = registry()
    data["entries"].append(dict(data["entries"][0]))
    with pytest.raises(StartupRefused) as refused:
        ModelRegistry.load(write_registry(tmp_path, data))
    assert refused.value.summary == "MODEL_REGISTRY(DUPLICATE_ID)"


def test_load_defaults_status_to_active(tmp_path):
    data = registry()
    for e in data["entries"]:
        if e["id"] == KEV_MODEL_ID:
            del e["status"]
    found = ModelRegistry.load(write_registry(tmp_path, data)).decision(KEV_MODEL_ID)
    assert found is not None and found.active is True


def test_load_refusal_hides_path(tmp_path):
    data = registry()
    data["entries"][0]["kind"] = "oracle"
    with pytest.raises(StartupRefused) as refused:
        ModelRegistry.load(write_registry(tmp_path, data))
    assert str(tmp_path) not in str(refused.value)
