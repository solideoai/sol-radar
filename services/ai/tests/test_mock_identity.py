"""mock 과 실제 모델의 구분(ADR-034 15번). mock 응답은 실제 Bosun·Qwen 이 추론한 것처럼 보이면 안 된다.

- AI_PROVIDER=mock: /kev 의 kev.provider·kev.model 은 "mock", /health 의 kev.modelId 는 "mock", qwen.model 은 fixture 의
  model.name("fixture"). 레지스트리 run(Hanno-Labs/…·Qwen/…)이 어디에도 나오지 않는다.
- AI_PROVIDER=local(fixture 모드, 가짜 서버): /health 의 kev.modelId 는 레지스트리 id(bosun-v3.1-0.6b), /kev 의 kev.model 은
  레지스트리 run, /extract 의 payload.model.name 은 QWEN_MODEL(레지스트리 default run).
"""

from fake_models import Reply, chat_completion, extraction_output, kev_answer
from support import (
    KEV_MODEL_ID,
    KEV_RUN,
    QWEN_RUN,
    extract_request,
    extraction_fixture,
    kev_request,
)

MOCK = "mock"
# 추출 fixture 공통 model.name(K13). 실제 모델명이 아니다
FIXTURE_QWEN_NAME = "fixture"


def real_model_names() -> tuple[str, ...]:
    return (KEV_RUN, KEV_MODEL_ID, QWEN_RUN, "bosun", "Bosun", "Hanno-Labs")


def post_ok(client, path: str, body: dict) -> dict:
    response = client.post(path, json=body)
    assert response.status_code == 200
    return response.json()


# ---------------------------------------------------------------- mock


def test_mock_kev_response_identifies_itself_as_mock(make_client):
    result = post_ok(make_client(SOL_RUN_MODE=MOCK), "/kev", kev_request("FX-01"))
    assert (result["kev"]["enabled"], result["kev"]["provider"], result["kev"]["model"]) == (
        True,
        MOCK,
        MOCK,
    )


def test_mock_health_kev_model_id_is_mock(make_client):
    body = make_client(SOL_RUN_MODE=MOCK).get("/health").json()
    assert (body["provider"], body["kev"]) == (MOCK, {"modelId": MOCK, "registryMatch": None})


def test_mock_health_qwen_model_is_fixture_name(make_client):
    body = make_client(SOL_RUN_MODE=MOCK).get("/health").json()
    fixture_model = extraction_fixture("FX-01")["model"]
    assert body["qwen"] == {"model": FIXTURE_QWEN_NAME, "promptHash": fixture_model["promptHash"]}
    assert fixture_model["name"] == FIXTURE_QWEN_NAME


def test_mock_extract_model_block_is_mock_provider(make_client):
    result = post_ok(make_client(SOL_RUN_MODE=MOCK), "/extract", extract_request("FX-01"))
    model = result["payload"]["model"]
    assert (model["provider"], model["name"]) == (MOCK, FIXTURE_QWEN_NAME)


def test_mock_responses_never_carry_real_model_names(make_client):
    client = make_client(SOL_RUN_MODE=MOCK)
    texts = (
        client.get("/health").text,
        client.post("/kev", json=kev_request("FX-01")).text,
        client.post("/extract", json=extract_request("FX-01")).text,
    )
    leaked = [name for text in texts for name in real_model_names() if name in text]
    assert leaked == []


# ---------------------------------------------------------------- local(fixture 모드, 가짜 서버)


def test_local_health_kev_model_id_is_registry_entry(make_client, local_models):
    body = make_client(SOL_RUN_MODE="fixture").get("/health").json()
    assert (body["provider"], body["kev"]["modelId"], body["qwen"]["model"]) == (
        "local",
        KEV_MODEL_ID,
        QWEN_RUN,
    )
    assert KEV_MODEL_ID == "bosun-v3.1-0.6b"


def test_local_kev_response_model_is_registry_run(make_client, local_models):
    local_models.kev.route("POST", "/v1/systemone", Reply(json_body=kev_answer()))
    result = post_ok(make_client(SOL_RUN_MODE="fixture"), "/kev", kev_request("FX-01"))
    assert (result["kev"]["provider"], result["kev"]["model"]) == ("local", KEV_RUN)
    assert MOCK not in (result["kev"]["provider"], result["kev"]["model"])


def test_local_extract_model_name_is_qwen_run(make_client, local_models):
    local_models.qwen.route(
        "POST", "/v1/chat/completions", Reply(json_body=chat_completion(extraction_output()))
    )
    result = post_ok(make_client(SOL_RUN_MODE="fixture"), "/extract", extract_request("FX-01"))
    model = result["payload"]["model"]
    assert (model["provider"], model["name"]) == ("local", QWEN_RUN)
