"""V2-01·K10: GET /health 계약.

V2-01 의미(상태·실행 모드·공급자·Kev 사용 여부)는 그대로 두고, K10 에서 qwen·kev·questionSets·parsers 를 채운다.
"""

import json

from support import expected_prompt_hash


def test_health_mock_mode(make_client):
    response = make_client(SOL_RUN_MODE="mock").get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "runMode": "mock",
        "provider": "mock",
        "kevEnabled": True,
        "qwen": {"model": "fixture", "promptHash": expected_prompt_hash()},
        "kev": {"modelId": "mock", "registryMatch": None},
        "questionSets": ["kev-qs/v0.1"],
        "parsers": [
            {"format": "PDF", "parserId": None},
            {"format": "HWPX", "parserId": None},
            {"format": "HWP", "parserId": None},
        ],
    }


def test_health_reports_only_kev_off_under_explicit_test_rules(
    make_client, monkeypatch, allow_disabled_kev_rules
):
    allow_disabled_kev_rules()
    monkeypatch.setenv("KEV_ENABLED", "false")
    body = make_client(SOL_RUN_MODE="mock").get("/health").json()
    assert (body["kevEnabled"], body["kev"], body["qwen"]) == (
        False,
        None,
        {"model": "fixture", "promptHash": expected_prompt_hash()},
    )


def test_disabled_adapter_rules_leave_shared_repository_rules_unchanged(
    rules, allow_disabled_kev_rules
):
    original = json.dumps(rules, sort_keys=True)
    allow_disabled_kev_rules()
    assert json.dumps(rules, sort_keys=True) == original


def test_health_fixture_mode_does_not_invent_adapter_info(make_client):
    # local 어댑터는 이번 단계 범위 밖. qwen·kev 를 지어내지 않고 null 로 둔다(명세 §5).
    body = make_client(SOL_RUN_MODE="fixture").get("/health").json()
    assert (body["runMode"], body["provider"], body["qwen"], body["kev"]) == (
        "fixture",
        "local",
        None,
        None,
    )
