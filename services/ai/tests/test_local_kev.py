"""Kev local 어댑터(POST /kev, kev-qs/v0.1, local 명세 §4, L1·L4, 03 §5.4·§5.7). 모델 서버는 127.0.0.1 가짜 kev.serve.

- wire 요청(경로·Bearer·state·model·questions)과 응답 → KevAssist 매핑
- 실패(timeout·연결·상태 코드·모양·값 범위) → enabled=false·KEV_UNAVAILABLE
- L1 지연 대조와 래치, 인젝션 의심이면 Kev 를 부르지 않음
"""

import hashlib
import json

import pytest
from fake_models import FakeModelServer, Reply, closed_url, free_port, kev_answer, kev_models
from support import (
    HANGUL,
    KEV_ASSIST_KEYS,
    KEV_DISCLAIMER,
    KEV_KEY,
    KEV_MODEL_ID,
    KEV_RUN,
    LEGEND,
    extraction_fixture,
    kev_request,
    question_set_questions,
)

SYSTEMONE = "/v1/systemone"
MODELS = "/v1/models"
TYPESAFE_ID = "req-typesafe-0001"


def answer_reply(answer: dict | None = None, *, request_id: str | None = TYPESAFE_ID) -> Reply:
    headers = {"x-typesafe-request-id": request_id} if request_id else {}
    return Reply(json_body=answer or kev_answer(), headers=headers)


def run_kev(make_client, local_models, *replies: Reply, request: dict | None = None):
    local_models.kev.route("POST", SYSTEMONE, *(replies or (answer_reply(),)))
    client = make_client(SOL_RUN_MODE="fixture")
    response = client.post("/kev", json=request or kev_request("FX-01"))
    assert response.status_code == 200
    return response.json()


def sent(server: FakeModelServer) -> list[dict]:
    return [r.json() for r in server.calls("POST", SYSTEMONE)]


def disabled(result: dict) -> tuple:
    rest = {k: v for k, v in result["kev"].items() if k not in ("enabled", "disclaimer")}
    return (
        result["kev"]["enabled"],
        result["errorCode"],
        result["stateHash"],
        result["wire"],
        rest == dict.fromkeys(KEV_ASSIST_KEYS - {"enabled", "disclaimer"}),
    )


# ---------------------------------------------------------------- 요청(03 §5.4)


def test_kev_request_goes_to_systemone_with_bearer_key(make_client, local_models):
    run_kev(make_client, local_models)
    calls = local_models.kev.calls("POST", SYSTEMONE)
    assert [c.headers.get("authorization") for c in calls] == [f"Bearer {KEV_KEY}"]


def test_kev_request_body_has_state_model_questions(make_client, local_models):
    run_kev(make_client, local_models)
    body = sent(local_models.kev)[0]
    assert (set(body), body["model"]) == ({"state", "model", "questions"}, "kev-latest")


def test_kev_request_questions_are_question_set_file(make_client, local_models):
    run_kev(make_client, local_models)
    assert sent(local_models.kev)[0]["questions"] == question_set_questions()


def test_kev_request_state_has_no_hangul(make_client, local_models):
    run_kev(make_client, local_models)
    state = sent(local_models.kev)[0]["state"]
    assert (state != "", HANGUL.findall(state)) == (True, [])


def test_kev_state_hash_is_sha256_of_sent_state(make_client, local_models):
    result = run_kev(make_client, local_models)
    state = sent(local_models.kev)[0]["state"]
    assert result["stateHash"] == hashlib.sha256(state.encode("utf-8")).hexdigest()


def test_kev_request_state_has_no_rule_results(make_client, local_models):
    request = kev_request("FX-03", recommendation="NO_BID", score=68)
    run_kev(make_client, local_models, request=request)
    state = sent(local_models.kev)[0]["state"]
    assert ("NO_BID" in state, "68" in state.split()) == (False, False)


# ---------------------------------------------------------------- 응답 → KevAssist


def test_kev_response_maps_to_kev_assist(make_client, local_models):
    kev = run_kev(make_client, local_models)["kev"]
    assert kev == {
        "enabled": True,
        "provider": "local",
        "model": KEV_RUN,
        "questionSetVersion": "kev-qs/v0.1",
        "suggestedOption": "BID",
        "probabilities": {"BID": 0.71, "WATCH": 0.24, "NO_BID": 0.05},
        "confidence": 0.71,
        "mandatoryRisk": 0.05,
        "needsHumanReview": 0.12,
        "fit": {"score": 3.5, "legend": LEGEND},
        "scores": None,
        "risks": None,
        "calibration": None,
        "stateTrace": None,
        "latencyMs": 123,
        "requestId": TYPESAFE_ID,
        "disclaimer": KEV_DISCLAIMER,
    }


def test_kev_wire_is_raw_response(make_client, local_models):
    assert run_kev(make_client, local_models)["wire"] == [kev_answer()]


def test_kev_success_has_no_error_and_no_requirements(make_client, local_models):
    result = run_kev(make_client, local_models)
    assert (result["errorCode"], result["requirements"]) == (None, None)


def test_kev_request_id_is_null_without_header(make_client, local_models):
    kev = run_kev(make_client, local_models, answer_reply(request_id=None))["kev"]
    assert kev["requestId"] is None


def test_kev_no_bid_choice_maps_to_no_bid(make_client, local_models):
    kev = run_kev(make_client, local_models, answer_reply(kev_answer("FX-16")))["kev"]
    assert kev["suggestedOption"] == "NO_BID"


# ---------------------------------------------------------------- 실패 → KEV_UNAVAILABLE


@pytest.mark.parametrize(
    "reply",
    [
        Reply(500, {"error": "x"}),
        Reply(401, {"error": "x"}),
        Reply(403, {"error": "x"}),
        Reply(404, {"error": "x"}),
        Reply(422, {"error": "state too long"}),
        Reply(json_body={"responses": {}}),
        Reply(raw_body=b"not json"),
        Reply(
            json_body={
                **kev_answer(),
                "responses": {
                    **kev_answer()["responses"],
                    "recommendation": {
                        "choice": "MAYBE",
                        "confidence": 0.5,
                        "probabilities": {"BID": 0.5, "WATCH": 0.3, "NO_BID": 0.2},
                    },
                },
            }
        ),
    ],
    ids=["500", "401", "403", "404", "422", "missing_questions", "not_json", "choice_outside"],
)
def test_kev_failure_reply_disables_kev(make_client, local_models, reply):
    result = run_kev(make_client, local_models, reply)
    assert disabled(result) == (False, "KEV_UNAVAILABLE", None, None, True)


def test_kev_timeout_disables_kev(make_client, local_models, monkeypatch):
    monkeypatch.setenv("KEV_TIMEOUT_MS", "300")
    result = run_kev(make_client, local_models, Reply(json_body=kev_answer(), delay=5))
    assert disabled(result) == (False, "KEV_UNAVAILABLE", None, None, True)


def test_kev_redirect_is_not_followed(make_client, local_models):
    local_models.kev.route("POST", "/v1/elsewhere", answer_reply())
    target = f"{local_models.kev.url}/v1/elsewhere"
    result = run_kev(make_client, local_models, Reply(307, {}, headers={"Location": target}))
    assert (result["errorCode"], local_models.kev.calls("POST", "/v1/elsewhere")) == (
        "KEV_UNAVAILABLE",
        [],
    )


def _with(path: list, value) -> dict:
    answer = kev_answer()
    target = answer
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return answer


REC = ["responses", "recommendation", "probabilities"]
OUT_OF_RANGE = {
    "probability_negative": _with(REC, {"BID": -0.1, "WATCH": 0.6, "NO_BID": 0.5}),
    "probability_over_one": _with(REC, {"BID": 1.5, "WATCH": 0.0, "NO_BID": 0.0}),
    "probabilities_sum_off": _with(REC, {"BID": 0.5, "WATCH": 0.3, "NO_BID": 0.1}),
    "noul_over_one": _with(["responses", "mandatoryRisk", "noul"], 1.5),
    "noul_negative": _with(["responses", "needsHumanReview", "noul"], -0.2),
    "score_over_four": _with(["responses", "fit", "score"], 4.5),
    "score_negative": _with(["responses", "fit", "score"], -0.5),
}


@pytest.mark.parametrize("case", sorted(OUT_OF_RANGE))
def test_kev_values_out_of_range_disable_kev(make_client, local_models, case):
    result = run_kev(make_client, local_models, answer_reply(OUT_OF_RANGE[case]))
    assert disabled(result) == (False, "KEV_UNAVAILABLE", None, None, True)


def test_kev_nan_probability_disables_kev(make_client, local_models):
    raw = json.dumps(kev_answer()).replace('"BID": 0.71', '"BID": NaN').encode()
    assert b"NaN" in raw  # 전제: 표준 JSON 밖 NaN 토큰을 실제로 넣었다
    result = run_kev(make_client, local_models, Reply(raw_body=raw))
    assert disabled(result) == (False, "KEV_UNAVAILABLE", None, None, True)


def test_kev_probabilities_within_tolerance_are_accepted(make_client, local_models):
    answer = _with(REC, {"BID": 0.705, "WATCH": 0.245, "NO_BID": 0.055})  # 합 1.005
    assert run_kev(make_client, local_models, answer_reply(answer))["kev"]["enabled"] is True


# ---------------------------------------------------------------- L1 지연 대조·래치


def late_kev(make_client, monkeypatch, fake_server, local_models, run: str | None):
    """기동 때는 Kev 서버가 없고(닫힌 포트), 기동 뒤 같은 포트에 서버가 생긴다(run 이 None 이면 끝까지 없다)."""
    port = free_port()
    monkeypatch.setenv("KEV_BASE_URL", f"http://127.0.0.1:{port}")
    client = make_client(SOL_RUN_MODE="fixture")
    server = None
    if run is not None:
        server = fake_server(port)
        server.route("GET", MODELS, Reply(json_body=kev_models(run)))
        server.route("POST", SYSTEMONE, answer_reply())
    return client, server


def test_late_registry_match_checks_models_then_calls_kev(
    make_client, monkeypatch, fake_server, local_models
):
    client, server = late_kev(make_client, monkeypatch, fake_server, local_models, KEV_RUN)
    result = client.post("/kev", json=kev_request("FX-01")).json()
    assert result["kev"]["enabled"] is True
    assert [(r.method, r.path) for r in server.requests] == [("GET", MODELS), ("POST", SYSTEMONE)]


def test_late_registry_match_is_shown_in_health(
    make_client, monkeypatch, fake_server, local_models
):
    client, _ = late_kev(make_client, monkeypatch, fake_server, local_models, KEV_RUN)
    before = client.get("/health").json()["kev"]["registryMatch"]
    client.post("/kev", json=kev_request("FX-01"))
    after = client.get("/health").json()["kev"]["registryMatch"]
    assert (before, after) == (None, True)


def test_late_registry_mismatch_disables_kev_and_latches(
    make_client, monkeypatch, fake_server, local_models
):
    client, server = late_kev(make_client, monkeypatch, fake_server, local_models, "runs/smoke")
    first = client.post("/kev", json=kev_request("FX-01")).json()
    second = client.post("/kev", json=kev_request("FX-01")).json()
    assert (first["errorCode"], second["errorCode"]) == ("KEV_UNAVAILABLE", "KEV_UNAVAILABLE")
    assert (len(server.calls("GET", MODELS)), server.calls("POST", SYSTEMONE)) == (1, [])


def test_late_registry_mismatch_is_shown_in_health(
    make_client, monkeypatch, fake_server, local_models
):
    client, _ = late_kev(make_client, monkeypatch, fake_server, local_models, "runs/smoke")
    client.post("/kev", json=kev_request("FX-01"))
    assert client.get("/health").json()["kev"] == {"modelId": KEV_MODEL_ID, "registryMatch": False}


def test_late_registry_unreachable_is_checked_again_next_call(
    make_client, monkeypatch, fake_server, local_models
):
    port = free_port()
    monkeypatch.setenv("KEV_BASE_URL", f"http://127.0.0.1:{port}")
    client = make_client(SOL_RUN_MODE="fixture")
    first = client.post("/kev", json=kev_request("FX-01")).json()
    server = fake_server(port)
    server.route("GET", MODELS, Reply(json_body=kev_models(KEV_RUN)))
    server.route("POST", SYSTEMONE, answer_reply())
    second = client.post("/kev", json=kev_request("FX-01")).json()
    assert (first["errorCode"], second["kev"]["enabled"]) == ("KEV_UNAVAILABLE", True)


def test_registry_matched_at_startup_is_not_checked_again(make_client, local_models):
    client = make_client(SOL_RUN_MODE="fixture")
    local_models.kev.route("POST", SYSTEMONE, answer_reply())
    client.post("/kev", json=kev_request("FX-01"))
    client.post("/kev", json=kev_request("FX-01"))
    assert (len(local_models.kev.calls("GET", MODELS)), len(sent(local_models.kev))) == (1, 2)


def test_unreachable_kev_server_disables_kev(make_client, local_models, monkeypatch):
    monkeypatch.setenv("KEV_BASE_URL", closed_url())
    result = make_client(SOL_RUN_MODE="fixture").post("/kev", json=kev_request("FX-01")).json()
    assert disabled(result) == (False, "KEV_UNAVAILABLE", None, None, True)


# ---------------------------------------------------------------- 인젝션 의심이면 Kev 를 부르지 않는다


def test_injection_suspected_extraction_skips_kev_call(make_client, local_models):
    extraction = extraction_fixture("FX-01")
    extraction["injectionSuspected"] = True
    result = run_kev(make_client, local_models, request=kev_request("FX-01", extraction=extraction))
    assert disabled(result) == (False, "INJECTION_SUSPECTED", None, None, True)
    assert sent(local_models.kev) == []
