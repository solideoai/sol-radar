"""보안·로그(local 명세 §6, security-auditor Low). 키·state·본문·프롬프트·모델 출력은 로그와 응답에 없다.

TLS 검증을 끄는 경로가 코드에 없다. 요청 id 는 로그에 그대로(줄바꿈·128자 초과) 나오지 않는다.
"""

import logging

import pytest
from fake_models import Reply, chat_completion, extraction_output, kev_answer
from support import (
    KEV_KEY,
    QWEN_KEY,
    SRC_DIR,
    bid_body,
    explain_request,
    extract_request,
    kev_request,
)

SECRET_MARKERS = (QWEN_KEY, KEV_KEY)
CONTENT_MARKERS = (
    bid_body("FX-01")[:30],  # 공고 본문
    "COMPANY (profile revision",  # Kev state
    "너는 대한민국 공공 입찰",  # system prompt
    "Requirements are met and the fit is strong",  # 질문 세트(요청 본문)
)


def exercise_local(make_client, local_models):
    local_models.qwen.route(
        "POST", "/v1/chat/completions", Reply(json_body=chat_completion(extraction_output()))
    )
    local_models.kev.route("POST", "/v1/systemone", Reply(json_body=kev_answer()))
    client = make_client(SOL_RUN_MODE="fixture")
    return [
        client.post("/extract", json=extract_request("FX-01")),
        client.post("/kev", json=kev_request("FX-01")),
        client.get("/health"),
    ]


def test_product_code_has_no_tls_verification_bypass():
    offenders = [
        f"{path.relative_to(SRC_DIR)}"
        for path in sorted(SRC_DIR.rglob("*.py"))
        if "verify=False" in path.read_text(encoding="utf-8")
        or "verify = False" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_local_logs_have_no_keys(make_client, local_models, caplog):
    caplog.set_level(logging.DEBUG)
    exercise_local(make_client, local_models)
    assert [m for m in SECRET_MARKERS if m in caplog.text] == []


def test_local_logs_have_no_state_body_prompt_or_output(make_client, local_models, caplog):
    caplog.set_level(logging.DEBUG)
    exercise_local(make_client, local_models)
    assert [m for m in CONTENT_MARKERS if m in caplog.text] == []


def test_local_responses_have_no_keys(make_client, local_models):
    responses = exercise_local(make_client, local_models)
    assert [r.status_code for r in responses] == [200, 200, 200]
    assert [m for r in responses for m in SECRET_MARKERS if m in r.text] == []


# ---------------------------------------------------------------- 요청 id 로그(mock 으로 충분)


def sol_ai_messages(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name.startswith("sol_ai")]


def post_with_request_id(client, endpoint: str, request_id: str):
    if endpoint == "/extract":
        return client.post(endpoint, json=extract_request("FX-01", request_id=request_id))
    if endpoint == "/kev":
        return client.post(endpoint, json=kev_request("FX-01", requestId=request_id))
    return client.post(endpoint, json={**explain_request(), "requestId": request_id})


@pytest.mark.parametrize("endpoint", ["/extract", "/kev", "/explain"])
def test_request_id_line_break_does_not_split_log_line(make_client, caplog, endpoint):
    caplog.set_level(logging.INFO)
    response = post_with_request_id(make_client(), endpoint, "req-1\nFORGED level=ERROR\r")
    assert response.status_code == 200
    messages = sol_ai_messages(caplog)
    assert messages != []
    assert [m for m in messages if "\n" in m or "\r" in m] == []


@pytest.mark.parametrize("endpoint", ["/extract", "/kev", "/explain"])
def test_long_request_id_is_truncated_in_logs(make_client, caplog, endpoint):
    caplog.set_level(logging.INFO)
    response = post_with_request_id(make_client(), endpoint, "R" * 300)
    assert response.status_code == 200
    messages = sol_ai_messages(caplog)
    assert [m for m in messages if "R" * 129 in m] == []
    assert [m for m in messages if "R" * 64 in m] != []  # 잘라서라도 남긴다


def test_long_parse_request_id_header_is_truncated_in_logs(make_client, caplog):
    caplog.set_level(logging.INFO)
    response = make_client().post(
        "/parse",
        content=b"%PDF-1.7\n%%EOF\n",
        headers={
            "X-File-Name": "rfp.pdf",
            "Content-Type": "application/pdf",
            "X-Request-Id": "R" * 300,
        },
    )
    assert response.status_code == 200
    assert [m for m in sol_ai_messages(caplog) if "R" * 129 in m] == []
