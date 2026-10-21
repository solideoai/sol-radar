"""HTTP 계약: 인증·상한·model 불일치·마감·백엔드 실패·요청 id·로그 내용."""

import logging
import re
import uuid

import pytest
from conftest import ALIAS, API_KEY
from fakes import RaisingBackend, ScriptedBackend, SlowBackend

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


def test_body_over_1mib_is_413(client, auth):
    big = {**BODY, "state": "x" * (1024 * 1024 + 1)}
    response = client.post("/v1/systemone", json=big, headers=auth)
    assert response.status_code == 413
    assert response.json() == {"errorCode": "PAYLOAD_TOO_LARGE"}


def test_body_over_1mib_without_content_length_is_413(client, auth):
    def chunks():
        yield b'{"state": "'
        yield b"x" * (1024 * 1024 + 1)
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
