"""V2-01·K10·K13: GET /health 계약.

V2-01 의미(상태·실행 모드·공급자·Kev 사용 여부)는 그대로 두고, K10 에서 qwen·kev·questionSets·parsers 를 채운다.
K13: mock 의 qwen 은 추출 fixture 공통 model 블록의 name·promptHash 다(seed 재사용 키와 같게).
"""

from support import extraction_fixture


def fixture_qwen() -> dict:
    model = extraction_fixture("FX-01")["model"]
    return {"model": model["name"], "promptHash": model["promptHash"]}


def test_health_mock_mode(make_client):
    response = make_client(SOL_RUN_MODE="mock").get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "runMode": "mock",
        "provider": "mock",
        "kevEnabled": True,
        "qwen": fixture_qwen(),
        "kev": {"modelId": "mock", "registryMatch": None},
        "questionSets": ["kev-qs/v0.1"],
        "parsers": [
            {"format": "PDF", "parserId": None},
            {"format": "HWPX", "parserId": None},
            {"format": "HWP", "parserId": None},
        ],
    }


def test_health_reports_only_kev_off_when_kev_disabled(make_client, monkeypatch):
    # 실제 규칙 파일(세 모드 KEV_ENABLED=["true","false"])로 연다. Kev 자리만 바뀌고 qwen 은 그대로다.
    monkeypatch.setenv("KEV_ENABLED", "false")
    body = make_client(SOL_RUN_MODE="mock").get("/health").json()
    assert (body["kevEnabled"], body["kev"], body["qwen"]) == (
        False,
        None,
        fixture_qwen(),
    )


def test_health_fixture_mode_does_not_invent_adapter_info(make_client):
    # local 어댑터는 이번 단계 범위 밖. qwen·kev 를 지어내지 않고 null 로 둔다(명세 §5).
    body = make_client(SOL_RUN_MODE="fixture").get("/health").json()
    assert (body["runMode"], body["provider"], body["qwen"], body["kev"]) == (
        "fixture",
        "local",
        None,
        None,
    )


def test_k13_health_qwen_comes_from_fixture_model_block(make_client, custom_fixtures):
    extraction = extraction_fixture("FX-01")
    extraction["model"]["name"] = "fixture-test"
    extraction["model"]["promptHash"] = "a" * 64
    custom_fixtures({"FX-01": extraction})
    body = make_client(SOL_RUN_MODE="mock").get("/health").json()
    assert body["qwen"] == {"model": "fixture-test", "promptHash": "a" * 64}
