"""추천 분석(스펙 §4.3, 계획 C3): 모델 출력 검증·템플릿과 POST /insight.

검증 순서는 JSON·모양 → 근거 번호 → 금지어 → 판정 이름 → 숫자다. 하나라도 걸리면 템플릿으로 대체하고 그 이유를 낸다.
"""

import copy
import json
import logging
import re

import pytest
from fake_models import Reply, chat_completion
from support import insight_request

from sol_ai.adapters.unavailable import UnavailableQwen
from sol_ai.contracts import InsightRequest
from sol_ai.deadline import Deadline
from sol_ai.insight import run_insight, template_insight, validate_insight
from sol_ai.paths import INSIGHT_PROMPT_FILE

# 입력 숫자(58·2026-12-01·20)와 요청 refs(B1·B2·C1·C2)만 쓴 모델 출력
MODEL_OUTPUT = {
    "summary": (
        "SOL Score 58점으로 규칙 엔진이 판정했습니다. 기술 적합도와 인력 가용은 충분하지만 "
        "정보통신공사업 등록이 없어 사람이 확인해야 합니다."
    ),
    "strengths": [
        {"text": "요구 기술 Java와 PostgreSQL을 이미 보유하고 있습니다.", "refIds": ["B1", "C1"]},
        {"text": "2026-12-01부터 투입할 수 있는 인력이 20명 있습니다.", "refIds": ["C2"]},
    ],
    "improvements": [
        {"text": "참가 자격인 정보통신공사업 등록을 확인해야 합니다.", "refIds": ["B2"]},
    ],
}


def request_model(recommendation: str = "WATCH", **changes) -> InsightRequest:
    return InsightRequest.model_validate(insight_request(recommendation, **changes))


def output(**changes) -> str:
    data = copy.deepcopy(MODEL_OUTPUT)
    data.update(changes)
    return json.dumps(data, ensure_ascii=False)


def reason_of(raw: str, recommendation: str = "WATCH") -> str | None:
    return validate_insight(raw, request_model(recommendation))[1]


def test_valid_model_output_passes():
    body, reason = validate_insight(output(), request_model())
    assert reason is None
    assert body is not None and body.model_dump() == MODEL_OUTPUT


@pytest.mark.parametrize(
    "changes",
    [
        {"summary": "수주 확률이 높은 공고입니다."},
        {"strengths": [{"text": "인력 여유는 20 ％ 입니다.", "refIds": ["C2"]}]},
    ],
)
def test_forbidden_word_falls_back(changes):
    assert reason_of(output(**changes)) == "FORBIDDEN_WORD"


def test_unknown_number_falls_back():
    assert reason_of(output(summary="사업 규모가 37억원이라 부담이 큽니다.")) == "UNKNOWN_NUMBER"


@pytest.mark.parametrize(
    "summary",
    [
        "판정은 비추천입니다.",
        "참여를 추천합니다.",
        "BID 로 볼 수 있습니다.",
        "NO_BID 에 가깝습니다.",
        "NO-BID 입니다.",
        "WATCH 입니다.",
    ],
)
def test_other_label_falls_back(summary):
    assert reason_of(output(summary=summary)) == "LABEL_CONFLICT"


def test_same_verdict_korean_label_passes():
    assert reason_of(output(summary="판정은 보류이며 자격을 확인해야 합니다.")) is None
    assert reason_of(output(summary="판정은 비추천이며 자격을 확인해야 합니다."), "NO_BID") is None


def test_unknown_ref_falls_back():
    improvements = [{"text": "참가 자격을 확인해야 합니다.", "refIds": ["B9"]}]
    assert reason_of(output(improvements=improvements)) == "UNKNOWN_REF"


@pytest.mark.parametrize(
    "raw",
    [
        output()[:-5],
        "[]",
        output(strengths=[{"text": "기술이 맞습니다.", "refIds": ["B1"]}] * 5),
        output(summary="가" * 401),
        output(improvements=[{"text": "  ", "refIds": []}]),
        output(improvements=[{"text": "확인해야 합니다.", "refIds": ["X1"]}]),
        output(recommendation="BID"),
    ],
    ids=["truncated", "not-object", "too-many", "too-long", "blank", "bad-ref-id", "extra-key"],
)
def test_broken_json_falls_back(raw):
    assert reason_of(raw) == "INVALID_OUTPUT"


def test_checks_run_in_contract_order():
    every_rule = {"summary": "수주 확률 37억 규모라 추천합니다."}
    unknown_ref = [{"text": "확인해야 합니다.", "refIds": ["B9"]}]
    assert reason_of(output(**every_rule, improvements=unknown_ref)) == "UNKNOWN_REF"
    assert reason_of(output(**every_rule)) == "FORBIDDEN_WORD"
    assert reason_of(output(summary="37억 규모라 추천합니다.")) == "LABEL_CONFLICT"


def labels(items) -> list[str]:
    return [item.text.partition(":")[0] for item in items]


@pytest.mark.parametrize("recommendation", ["BID", "WATCH", "NO_BID"])
def test_template_is_deterministic_and_clean(recommendation):
    request = request_model(recommendation)
    first = template_insight(request)
    assert template_insight(request) == first
    assert validate_insight(first.model_dump_json(), request) == (first, None)
    assert first.summary.startswith("SOL Score 58점. ")
    assert labels(first.strengths) == ["기술 적합도", "인력 가용", "전략 선호"]
    assert labels(first.improvements) == [
        "정보통신공사업 등록",
        "직접생산확인증명서",
        "유사 실적",
        "규모 적합",
    ]


def test_template_drops_items_that_break_output_rules():
    raw = insight_request()
    raw["rules"]["qualificationChecks"][1]["label"] = "추천서 제출"
    raw["rules"]["factors"][0]["reason"] = "수주 확률을 보지 않는다"
    request = InsightRequest.model_validate(raw)
    body = template_insight(request)
    assert validate_insight(body.model_dump_json(), request) == (body, None)
    assert labels(body.improvements)[0] == "직접생산확인증명서"
    assert body.strengths[0].text == "기술 적합도: 30점 중 24점."


# ---------------------------------------------------------------- POST /insight

COMPLETIONS = "/v1/chat/completions"
HEX64 = re.compile(r"[0-9a-f]{64}")


def post_insight(client, request: dict | None = None) -> dict:
    response = client.post("/insight", json=request or insight_request())
    assert response.status_code == 200
    return response.json()


def body_of(response: dict) -> dict:
    return {key: response[key] for key in ("summary", "strengths", "improvements")}


def template_of(request: dict | None = None) -> dict:
    model = InsightRequest.model_validate(request or insight_request())
    return template_insight(model).model_dump()


def test_insight_endpoint_model_path(make_client, local_models):
    local_models.qwen.route("POST", COMPLETIONS, Reply(json_body=chat_completion(output())))
    client = make_client(SOL_RUN_MODE="fixture")
    response = post_insight(client)
    assert (response["fallback"], response["fallbackReason"]) == (False, None)
    assert response["model"] == client.get("/health").json()["qwen"]["model"]
    assert HEX64.fullmatch(response["promptHash"])
    assert body_of(response) == MODEL_OUTPUT
    (call,) = local_models.qwen.calls("POST", COMPLETIONS)
    sent = call.json()
    assert (sent["max_tokens"], sent["response_format"]["json_schema"]["name"]) == (1024, "insight")
    user = json.loads(sent["messages"][1]["content"])
    assert "requestId" not in user and user["refs"] == insight_request()["refs"]


def test_insight_retries_once_without_guided_json(make_client, local_models):
    fenced = f"```json\n{output()}\n```"
    local_models.qwen.route(
        "POST", COMPLETIONS, Reply(400, {}), Reply(json_body=chat_completion(fenced))
    )
    response = post_insight(make_client(SOL_RUN_MODE="fixture"))
    assert (response["fallback"], body_of(response)) == (False, MODEL_OUTPUT)
    first, second = (c.json() for c in local_models.qwen.calls("POST", COMPLETIONS))
    assert "response_format" in first and "response_format" not in second


@pytest.mark.parametrize(
    ("reply", "timeout_ms", "reason"),
    [
        (Reply(500, {}), None, "MODEL_UNAVAILABLE"),
        (Reply(json_body=chat_completion(output()), delay=5), "300", "MODEL_UNAVAILABLE"),
        (Reply(json_body=chat_completion(None)), None, "INVALID_OUTPUT"),
        (
            Reply(json_body=chat_completion(output(summary="수주 확률이 높습니다."))),
            None,
            "FORBIDDEN_WORD",
        ),
    ],
    ids=["server-error", "timeout", "no-content", "forbidden-word"],
)
def test_insight_endpoint_falls_back_on_model_error(
    make_client, local_models, monkeypatch, reply, timeout_ms, reason
):
    if timeout_ms is not None:
        monkeypatch.setenv("AI_TIMEOUT_MS", timeout_ms)
    local_models.qwen.route("POST", COMPLETIONS, reply)
    response = post_insight(make_client(SOL_RUN_MODE="fixture"))
    assert (response["fallback"], response["fallbackReason"], response["model"]) == (
        True,
        reason,
        None,
    )
    assert HEX64.fullmatch(response["promptHash"])
    assert body_of(response) == template_of()


def test_insight_endpoint_mock_is_deterministic(make_client):
    client = make_client()
    first, second = post_insight(client), post_insight(client)
    assert first == second
    assert (first["fallback"], first["model"]) == (
        False,
        client.get("/health").json()["qwen"]["model"],
    )
    assert body_of(first) == template_of()


@pytest.mark.parametrize(
    ("fault", "reason"),
    [("qwen_unreachable", "MODEL_UNAVAILABLE"), ("qwen_error", "INVALID_OUTPUT")],
)
def test_insight_mock_fault_falls_back(make_client, monkeypatch, fault, reason):
    monkeypatch.setenv("AI_FAULT_INJECT", fault)
    response = post_insight(make_client())
    assert (response["fallback"], response["fallbackReason"]) == (True, reason)


def test_adapter_without_insight_uses_template():
    request = InsightRequest.model_validate(insight_request())
    response = run_insight(
        request, UnavailableQwen("hosted"), prompt_hash="0" * 64, deadline=Deadline(1)
    )
    assert (response.fallback, response.fallbackReason, response.model) == (
        True,
        "MODEL_UNAVAILABLE",
        None,
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"refs": [{**insight_request()["refs"][0], "id": f"B{i}"} for i in range(1, 26)]},
        {"refs": [insight_request()["refs"][0]] * 2},
    ],
    ids=["too-many-refs", "duplicate-ref-id"],
)
def test_insight_request_limits_are_422(make_client, changes):
    response = make_client().post("/insight", json=insight_request(**changes))
    assert response.status_code == 422


def test_insight_does_not_log_prompt_or_output(make_client, local_models, caplog):
    caplog.set_level(logging.DEBUG)
    local_models.qwen.route("POST", COMPLETIONS, Reply(json_body=chat_completion(output())))
    post_insight(make_client(SOL_RUN_MODE="fixture"))
    markers = [
        insight_request()["refs"][0]["quotedText"],
        MODEL_OUTPUT["strengths"][0]["text"],
        INSIGHT_PROMPT_FILE.read_text(encoding="utf-8").splitlines()[0],
    ]
    assert [marker for marker in markers if marker in caplog.text] == []
