"""HTTP 계약: 인증·상한(본문·state·대기열)·state 언어·model 불일치·마감·백엔드 실패·요청 id·로그 내용."""

import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import ALIAS, API_KEY
from fakes import BlockingBackend, RaisingBackend, ScriptedBackend, SlowBackend
from fastapi.testclient import TestClient

from sol_decision import app as app_module
from sol_decision import wire

UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
STATE = "SECRET-STATE-TEXT-7f3a the company has 12 engineers"
BODY = {
    "state": STATE,
    "model": ALIAS,
    "questions": {"needsHumanReview": {"type": "noul", "instructions": "Should a human check?"}},
}


def test_health_without_auth(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == ALIAS
    assert body["backend"] == "fake"
    assert body["loadedAt"]
    assert API_KEY not in response.text


@pytest.mark.parametrize("path", ["/v1/systemone", "/systemone", "/v1/models"])
def test_missing_bearer_is_401(client, path):
    send = client.post if path.endswith("systemone") else client.get
    response = send(path, json=BODY) if path.endswith("systemone") else send(path)
    assert response.status_code == 401
    assert response.json() == {"errorCode": "UNAUTHORIZED"}


@pytest.mark.parametrize(
    "header",
    ["Bearer wrong-key", "Basic " + API_KEY, API_KEY, "Bearer", "Bearer " + API_KEY + "x"],
)
def test_wrong_bearer_is_401(client, header):
    response = client.post("/v1/systemone", json=BODY, headers={"Authorization": header})
    assert response.status_code == 401


def test_alias_path_and_request_id_header(client, auth):
    for path in ("/v1/systemone", "/systemone"):
        response = client.post(path, json=BODY, headers=auth)
        assert response.status_code == 200, response.text
        request_id = response.headers[wire.REQUEST_ID_HEADER]
        assert UUID4.match(request_id)
        assert uuid.UUID(request_id).version == 4
        assert set(response.json()) == {"responses", "usage", "latency_ms"}


def test_request_id_differs_per_request_and_present_on_errors(client, auth):
    first = client.post("/v1/systemone", json=BODY, headers=auth)
    second = client.post("/v1/systemone", json=BODY, headers=auth)
    assert first.headers[wire.REQUEST_ID_HEADER] != second.headers[wire.REQUEST_ID_HEADER]
    unauthorized = client.post("/v1/systemone", json=BODY)
    assert UUID4.match(unauthorized.headers[wire.REQUEST_ID_HEADER])


def test_model_mismatch_is_422(client, auth):
    response = client.post("/v1/systemone", json={**BODY, "model": "kev-latest"}, headers=auth)
    assert response.status_code == 422
    assert response.json() == {"errorCode": "MODEL_MISMATCH"}


def test_model_omitted_is_accepted(client, auth):
    body = {k: v for k, v in BODY.items() if k != "model"}
    assert client.post("/v1/systemone", json=body, headers=auth).status_code == 200


def test_extra_field_is_422_without_echoing_input(client, auth):
    response = client.post("/v1/systemone", json={**BODY, "n_perm": 6}, headers=auth)
    assert response.status_code == 422
    body = response.json()
    assert body["errorCode"] == "INVALID_REQUEST"
    assert body["errors"][0]["loc"] == ["n_perm"]
    assert STATE not in response.text


def test_invalid_json_is_422(client, auth):
    response = client.post(
        "/v1/systemone", content=b"{not json", headers={**auth, "Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["errorCode"] == "INVALID_REQUEST"


def test_zero_and_25_questions_are_422(client, auth):
    assert (
        client.post("/v1/systemone", json={**BODY, "questions": {}}, headers=auth).status_code
        == 422
    )
    many = {f"q{i}": BODY["questions"]["needsHumanReview"] for i in range(25)}
    assert (
        client.post("/v1/systemone", json={**BODY, "questions": many}, headers=auth).status_code
        == 422
    )


def test_body_limit_is_128kib(client, auth):
    assert app_module.MAX_BODY_BYTES == 128 * 1024
    big = {**BODY, "state": "x" * (app_module.MAX_BODY_BYTES + 1)}
    response = client.post("/v1/systemone", json=big, headers=auth)
    assert response.status_code == 413
    assert response.json() == {"errorCode": "PAYLOAD_TOO_LARGE"}


def test_body_over_limit_without_content_length_is_413(client, auth):
    def chunks():
        yield b'{"state": "'
        yield b"x" * (app_module.MAX_BODY_BYTES + 1)
        yield b'", "questions": {}}'

    response = client.post(
        "/v1/systemone",
        content=chunks(),
        headers={**auth, "Content-Type": "application/json", "Transfer-Encoding": "chunked"},
    )
    assert response.status_code == 413


def test_slow_backend_hits_deadline_504(make_client, auth):
    client = make_client(SlowBackend(0.05), timeout_ms=20)
    response = client.post("/v1/systemone", json=BODY, headers=auth)
    assert response.status_code == 504
    assert response.json() == {"errorCode": "DEADLINE_EXCEEDED"}


def test_deadline_checked_between_questions(make_client, auth):
    """첫 질문이 마감을 넘기면 두 번째 질문은 predict 하지 않는다."""
    calls = []

    class Counting(SlowBackend):
        def predict(self, **kwargs):
            calls.append(kwargs["row_id"])
            return super().predict(**kwargs)

    client = make_client(Counting(0.05), timeout_ms=20)
    body = {
        **BODY,
        "questions": {
            "a": BODY["questions"]["needsHumanReview"],
            "b": BODY["questions"]["needsHumanReview"],
        },
    }
    assert client.post("/v1/systemone", json=body, headers=auth).status_code == 504
    assert len(calls) == 1


def test_backend_exception_is_500_inference_failed(make_client, auth):
    response = make_client(RaisingBackend()).post("/v1/systemone", json=BODY, headers=auth)
    assert response.status_code == 500
    assert response.json() == {"errorCode": "INFERENCE_FAILED"}


@pytest.mark.parametrize("output", [[0.5, 0.5, 0.0], [float("nan"), 1.0], [-0.1, 1.1], [0.0, 0.0]])
def test_invalid_distribution_is_500_invalid_distribution(make_client, auth, output):
    response = make_client(ScriptedBackend([output])).post("/v1/systemone", json=BODY, headers=auth)
    assert response.status_code == 500
    assert response.json() == {"errorCode": "INVALID_DISTRIBUTION"}


def test_logs_do_not_contain_state_key_or_exception_message(make_client, auth, caplog):
    caplog.set_level(logging.DEBUG)
    ok = make_client().post("/v1/systemone", json=BODY, headers=auth)
    failed = make_client(RaisingBackend(f"model blew up on {STATE}")).post(
        "/v1/systemone", json=BODY, headers=auth
    )
    assert ok.status_code == 200 and failed.status_code == 500
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert "systemone request_id=" in text
    assert "questions=1 status=200" in text
    assert "code=INFERENCE_FAILED error=RuntimeError" in text
    assert STATE not in text
    assert "SECRET-STATE" not in text
    assert API_KEY not in text
    assert "blew up" not in text
    assert "Should a human check?" not in text


def test_state_object_is_passed_through_to_backend(make_client, auth):
    from fakes import ByIdBackend

    backend = ByIdBackend({"true": 0.8, "false": 0.2})
    body = {**BODY, "state": {"company": {"staff": 12}, "notice": "x"}}
    assert make_client(backend).post("/v1/systemone", json=body, headers=auth).status_code == 200
    assert backend.calls[0]["state"] == body["state"]
    assert backend.calls[0]["seed"] == 0
    assert backend.calls[0]["decision_type"] == "noul"
    assert backend.calls[0]["instructions"] == "Should a human check?"


# ---------------------------------------------------------------- state 상한·언어(3e 보안 검토 M1·L1)


def test_state_limit_matches_gateway_truncation():
    # 게이트웨이 kev_state 는 6,000 토큰(글자 수 / 4) 에서 자른다. 서버는 그 길이를 넘는 state 를 받지 않는다
    assert app_module.MAX_STATE_CHARS == 24_000


def test_state_at_limit_is_accepted(client, auth):
    body = {**BODY, "state": "x" * app_module.MAX_STATE_CHARS}
    assert client.post("/v1/systemone", json=body, headers=auth).status_code == 200


def test_state_string_over_limit_is_422_state_too_large(client, auth):
    body = {**BODY, "state": "x" * (app_module.MAX_STATE_CHARS + 1)}
    response = client.post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 422
    assert response.json() == {"errorCode": "STATE_TOO_LARGE"}
    assert "xxxx" not in response.text


def test_state_object_over_limit_is_422_state_too_large(client, auth):
    # 객체 state 는 JSON 직렬화 길이로 잰다
    body = {**BODY, "state": {"notice": "x" * app_module.MAX_STATE_CHARS}}
    response = client.post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 422
    assert response.json() == {"errorCode": "STATE_TOO_LARGE"}


@pytest.mark.parametrize(
    "state",
    [
        "COMPANY 솔리데오 has 12 engineers",
        "ㄱ",
        {"company": {"name": "회사"}, "notice": "x"},
        {"items": ["ok", "한글"]},
    ],
)
def test_korean_state_is_422_state_not_english(client, auth, state):
    response = client.post("/v1/systemone", json={**BODY, "state": state}, headers=auth)
    assert response.status_code == 422
    assert response.json() == {"errorCode": "STATE_NOT_ENGLISH"}
    assert "회사" not in response.text and "솔리데오" not in response.text


def test_korean_questions_are_not_checked(client, auth):
    # L1 은 state 만 본다. 질문 문구(평가용 번역 세트)는 그대로 통과한다
    body = {**BODY, "questions": {"q": {"type": "noul", "instructions": "사람이 확인해야 하나?"}}}
    assert client.post("/v1/systemone", json=body, headers=auth).status_code == 200


def test_korean_state_allowed_only_with_eval_flag(make_client, auth):
    body = {**BODY, "state": "COMPANY 솔리데오 has 12 engineers"}
    allowed = make_client(allow_ko_state=True).post("/v1/systemone", json=body, headers=auth)
    assert allowed.status_code == 200
    # 상한은 플래그와 무관하다
    huge = {**BODY, "state": "가" * (app_module.MAX_STATE_CHARS + 1)}
    assert make_client(allow_ko_state=True).post(
        "/v1/systemone", json=huge, headers=auth
    ).json() == {"errorCode": "STATE_TOO_LARGE"}


def test_korean_state_422_is_logged_without_state(client, auth, caplog):
    caplog.set_level(logging.DEBUG)
    body = {**BODY, "state": "SECRET-KO 솔리데오"}
    assert client.post("/v1/systemone", json=body, headers=auth).status_code == 422
    assert "솔리데오" not in caplog.text and "SECRET-KO" not in caplog.text


# ---------------------------------------------------------------- 대기열·마감 뒤 응답(3e 보안 검토 M1)


def _post_until(client, auth, status: int, *, seconds: float = 3.0):
    """status 가 올 때까지 다시 보낸다(추론 스레드가 자리를 비우는 시점은 비동기다)."""
    end = time.monotonic() + seconds
    while True:
        response = client.post("/v1/systemone", json=BODY, headers=auth)
        if response.status_code == status or time.monotonic() >= end:
            return response
        time.sleep(0.02)


def test_queue_full_is_503_until_inference_frees(make_client, auth, caplog):
    caplog.set_level(logging.DEBUG)
    backend = BlockingBackend()
    first_client = make_client(backend, max_queue=1, timeout_ms=5_000)
    second_client = TestClient(first_client.app, raise_server_exceptions=False)
    with first_client, ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(first_client.post, "/v1/systemone", json=BODY, headers=auth)
        assert backend.started.wait(2)
        busy = second_client.post("/v1/systemone", json=BODY, headers=auth)
        assert busy.status_code == 503
        assert busy.json() == {"errorCode": "QUEUE_FULL"}
        assert busy.headers["Retry-After"] == "1"
        assert UUID4.match(busy.headers[wire.REQUEST_ID_HEADER])
        backend.release.set()
        assert first.result(timeout=5).status_code == 200
        assert _post_until(first_client, auth, 200).status_code == 200
    assert "code=QUEUE_FULL" in caplog.text
    assert backend.calls == 2


def test_queue_counts_waiting_requests(make_client, auth):
    """max_queue=2: 처리 중 1 + 대기 1 까지 받고 세 번째는 503."""
    backend = BlockingBackend()
    client = make_client(backend, max_queue=2, timeout_ms=5_000)
    others = [TestClient(client.app, raise_server_exceptions=False) for _ in range(2)]
    with client, ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, "/v1/systemone", json=BODY, headers=auth)
        assert backend.started.wait(2)
        second = pool.submit(others[0].post, "/v1/systemone", json=BODY, headers=auth)
        # 두 번째가 대기열에 들어간 것(count == 2)을 확인한 뒤에 세 번째를 보낸다(08 검토: 순서 경쟁으로 흔들렸다)
        end = time.monotonic() + 2
        while client.app.state.in_flight.count < 2:
            assert time.monotonic() < end, "두 번째 요청이 대기열에 들어가지 않았다"
            time.sleep(0.01)
        third = others[1].post("/v1/systemone", json=BODY, headers=auth)
        assert third.status_code == 503
        assert third.json() == {"errorCode": "QUEUE_FULL"}
        backend.release.set()
        assert first.result(timeout=5).status_code == 200
        assert second.result(timeout=5).status_code == 200


def test_in_flight_returns_to_zero_after_requests(client, auth):
    assert client.app.state.in_flight.count == 0
    with client:
        assert client.post("/v1/systemone", json=BODY, headers=auth).status_code == 200
        assert client.post("/v1/systemone", json=BODY, headers=auth).status_code == 200
    assert client.app.state.in_flight.count == 0


def test_forward_past_deadline_returns_504_without_waiting(make_client, auth):
    """forward 하나가 마감을 넘기면 스레드를 기다리지 않고 504 를 보낸다. 그동안 자리는 차 있다(503)."""
    backend = BlockingBackend()
    client = make_client(backend, max_queue=1, timeout_ms=50)
    with client:
        started = time.monotonic()
        response = client.post("/v1/systemone", json=BODY, headers=auth)
        assert time.monotonic() - started < 2
        assert response.status_code == 504
        assert response.json() == {"errorCode": "DEADLINE_EXCEEDED"}
        assert backend.started.is_set() and not backend.release.is_set()
        assert client.post("/v1/systemone", json=BODY, headers=auth).status_code == 503
        backend.release.set()
        # 스레드가 끝나면(마감이 지나 DeadlineExceeded 로 끝난다) 자리가 비고 다시 받는다
        assert _post_until(client, auth, 200).status_code == 200
