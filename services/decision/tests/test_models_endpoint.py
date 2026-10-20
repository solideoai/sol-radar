"""GET /v1/models 모양과 레지스트리(services/ai/models/registry.yaml) 문자열 일치(03 §11)."""

import pytest
import yaml
from conftest import ALIAS, REGISTRY_FILE, gateway_module
from fakes import IDENTITY, ByIdBackend

from sol_decision.backend import FakeBackend
from sol_decision.package import PUBLIC_IDENTITY

EXPECTED_KEYS = {
    "id",
    "object",
    "run",
    "base",
    "lora",
    "revision",
    "decision_embeddings_sha256",
    "temperature",
    "questionTypes",
}


def test_models_shape(make_client, auth):
    response = make_client(ByIdBackend({})).get("/v1/models", headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "list" and len(body["data"]) == 1
    model = body["data"][0]
    assert set(model) == EXPECTED_KEYS
    assert model["id"] == ALIAS and model["object"] == "model"
    assert model["run"] == IDENTITY.run
    assert model["base"] == IDENTITY.base
    assert model["lora"] == IDENTITY.lora
    assert model["revision"] == IDENTITY.revision
    assert model["decision_embeddings_sha256"] == IDENTITY.decision_embeddings_sha256
    assert model["temperature"] is None
    assert model["questionTypes"] == ["choice", "score", "noul"]


def test_public_identity_strings():
    assert PUBLIC_IDENTITY.run == "Hanno-Labs/bosun-v3.1-0.6b@5e78a37c"
    assert PUBLIC_IDENTITY.revision == "5e78a37c8d86860ebac9ef2d5327d6299498498e"
    assert PUBLIC_IDENTITY.base == "Qwen/Qwen3-0.6B@c1899de2"
    assert PUBLIC_IDENTITY.lora.startswith("961d237b") and len(PUBLIC_IDENTITY.lora) == 64
    assert PUBLIC_IDENTITY.decision_embeddings_sha256.startswith("88f9e856")


def _registry_entry(entry_id: str) -> dict:
    data = yaml.safe_load(REGISTRY_FILE.read_text(encoding="utf-8"))
    entry = next((e for e in data["entries"] if e.get("id") == entry_id), None)
    if entry is None:
        pytest.fail(
            f"services/ai/models/registry.yaml 에 {entry_id} 항목이 없다(ADR-034 6번, 레지스트리 작업자 몫)"
        )
    return entry


def test_models_match_registry_entry(make_client, auth):
    """레지스트리 bosun-v3.1-0.6b 의 run·base·lora·revision·decision_embeddings_sha256 이 공개 identity 와 같다."""
    entry = _registry_entry(ALIAS)
    response = make_client(FakeBackend(PUBLIC_IDENTITY)).get("/v1/models", headers=auth)
    model = response.json()["data"][0]
    for field in ("run", "base", "lora", "revision", "decision_embeddings_sha256"):
        assert model[field] == entry.get(field), field
    assert entry.get("requestModel") == ALIAS


def test_gateway_registry_matcher_accepts_our_models_response(make_client, auth):
    """게이트웨이 kev_local.kev_registry_match 가 우리 /v1/models 를 레지스트리 항목과 일치로 본다."""
    kev_local = gateway_module("sol_ai.adapters.kev_local")
    http = gateway_module("sol_ai.adapters.http")
    registry = gateway_module("sol_ai.registry")
    entry = _registry_entry(ALIAS)
    response = make_client(FakeBackend(PUBLIC_IDENTITY)).get("/v1/models", headers=auth)
    reply = http.HttpReply(response.status_code, response.text, dict(response.headers))
    match_values = {f: entry.get(f) for f in registry.KEV_MATCH_FIELDS if entry.get(f) is not None}
    registry_entry = registry.RegistryEntry(
        id=ALIAS,
        kind=entry["kind"],
        run=entry["run"],
        match_values=match_values,
        question_set=entry.get("questionSet"),
        request_model=entry.get("requestModel"),
        default=False,
    )
    assert kev_local.kev_registry_match(reply, registry_entry) is True
