"""G6: AI_FAULT_INJECT 장애 대체(03 §3·§8·§9, K3·K4·K9).

값 5개: kev_timeout·qwen_error·qwen_unreachable·kev_unreachable·gateway_down. AI_PROVIDER=mock 에서만 유효.
개별 실패는 HTTP 200 본문으로, gateway_down 만 /extract·/kev·/explain 에 503 {"errorCode","message"}.
"""

import pytest
from support import KEV_ASSIST_KEYS, explain_request, extract_request, kev_request

FAULTS = ("kev_timeout", "qwen_error", "qwen_unreachable", "kev_unreachable", "gateway_down")
PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
PARSE_HEADERS = {
    "X-File-Name": "rfp.pdf",
    "Content-Type": "application/pdf",
    "X-Request-Id": "req-parse-1",
}


def faulty_client(make_client, monkeypatch, fault: str, **settings):
    monkeypatch.setenv("AI_FAULT_INJECT", fault)
    return make_client(**settings)


# ---------------------------------------------------------------- Qwen 쪽


@pytest.mark.parametrize(
    ("fault", "code"),
    [("qwen_error", "EXTRACTION_FAILED"), ("qwen_unreachable", "QWEN_UNAVAILABLE")],
)
def test_g6_qwen_fault_fails_extraction_with_200(make_client, monkeypatch, fault, code):
    response = faulty_client(make_client, monkeypatch, fault).post(
        "/extract", json=extract_request("FX-01")
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["status"], body["errorCode"], body["payload"]) == ("FAILED", code, None)


# ---------------------------------------------------------------- Kev 쪽


@pytest.mark.parametrize("fault", ["kev_timeout", "kev_unreachable"])
def test_g6_kev_fault_disables_kev_with_200(make_client, monkeypatch, fault):
    response = faulty_client(make_client, monkeypatch, fault).post(
        "/kev", json=kev_request("FX-01")
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["kev"]["enabled"], body["errorCode"], body["stateHash"], body["wire"]) == (
        False,
        "KEV_UNAVAILABLE",
        None,
        None,
    )


@pytest.mark.parametrize("fault", ["kev_timeout", "kev_unreachable"])
def test_g6_kev_fault_leaves_only_disclaimer_in_assist(make_client, monkeypatch, fault):
    kev = (
        faulty_client(make_client, monkeypatch, fault)
        .post("/kev", json=kev_request("FX-01"))
        .json()["kev"]
    )
    rest = {k: v for k, v in kev.items() if k not in ("enabled", "disclaimer")}
    assert rest == dict.fromkeys(KEV_ASSIST_KEYS - {"enabled", "disclaimer"})


# ---------------------------------------------------------------- gateway_down


@pytest.mark.parametrize(
    ("path", "build"),
    [
        ("/extract", lambda: extract_request("FX-01")),
        ("/kev", lambda: kev_request("FX-01")),
        ("/explain", explain_request),
    ],
)
def test_g6_gateway_down_returns_503_ai_unavailable(make_client, monkeypatch, path, build):
    response = faulty_client(make_client, monkeypatch, "gateway_down").post(path, json=build())
    assert response.status_code == 503
    body = response.json()
    assert set(body) == {"errorCode", "message"}
    assert body["errorCode"] == "AI_UNAVAILABLE"
    assert isinstance(body["message"], str) and body["message"] != ""


def test_g6_gateway_down_keeps_health_up(make_client, monkeypatch):
    response = faulty_client(make_client, monkeypatch, "gateway_down").get("/health")
    assert (response.status_code, response.json()["status"]) == (200, "ok")


def test_g6_gateway_down_keeps_parse_up(make_client, monkeypatch):
    response = faulty_client(make_client, monkeypatch, "gateway_down").post(
        "/parse", content=PDF_BYTES, headers=PARSE_HEADERS
    )
    assert (response.status_code, response.json()["format"]) == (200, "PDF")


# ---------------------------------------------------------------- 코드 구분 (03 §9)


def observed_code(make_client, monkeypatch, fault: str) -> str:
    client = faulty_client(make_client, monkeypatch, fault)
    if fault.startswith("qwen_"):
        return client.post("/extract", json=extract_request("FX-01")).json()["errorCode"]
    if fault.startswith("kev_"):
        return client.post("/kev", json=kev_request("FX-01")).json()["errorCode"]
    return client.post("/extract", json=extract_request("FX-01")).json()["errorCode"]


def test_g6_section9_fault_codes_are_distinct(make_client, monkeypatch):
    # 03 §9: qwen_error·qwen_unreachable·kev_unreachable·gateway_down 은 서로 다른 코드.
    # kev_timeout 은 K4 대로 kev_unreachable 과 같은 KEV_UNAVAILABLE 이다(아래 시험).
    codes = {
        fault: observed_code(make_client, monkeypatch, fault)
        for fault in ("qwen_error", "qwen_unreachable", "kev_unreachable", "gateway_down")
    }
    assert codes == {
        "qwen_error": "EXTRACTION_FAILED",
        "qwen_unreachable": "QWEN_UNAVAILABLE",
        "kev_unreachable": "KEV_UNAVAILABLE",
        "gateway_down": "AI_UNAVAILABLE",
    }


def test_g6_kev_timeout_is_recorded_as_kev_unavailable(make_client, monkeypatch):
    assert observed_code(make_client, monkeypatch, "kev_timeout") == "KEV_UNAVAILABLE"


# ---------------------------------------------------------------- 장애 주입은 mock 에서만 (K3)


@pytest.mark.parametrize("fault", FAULTS)
def test_g6_fault_injection_does_not_break_health_in_fixture_mode(
    make_client, monkeypatch, local_models, fault
):
    client = faulty_client(make_client, monkeypatch, fault, SOL_RUN_MODE="fixture")
    response = client.get("/health")
    assert (response.status_code, response.json()["provider"]) == (200, "local")


def test_g6_gateway_down_is_ignored_outside_mock(make_client, monkeypatch, local_models):
    # fixture 모드(local)는 가짜 vLLM·Kev(127.0.0.1)로 연다. /extract 결과 자체는 단언하지 않고
    # 주입 응답(503 AI_UNAVAILABLE)이 아님만 본다.
    client = faulty_client(
        make_client,
        monkeypatch,
        "gateway_down",
        SOL_RUN_MODE="fixture",
        raise_server_exceptions=False,
    )
    response = client.post("/extract", json=extract_request("FX-01"))
    injected = response.status_code == 503 and response.json().get("errorCode") == "AI_UNAVAILABLE"
    assert injected is False


def test_g6_parse_is_unaffected_by_fault_in_fixture_mode(make_client, monkeypatch, local_models):
    client = faulty_client(make_client, monkeypatch, "gateway_down", SOL_RUN_MODE="fixture")
    response = client.post("/parse", content=PDF_BYTES, headers=PARSE_HEADERS)
    assert (response.status_code, response.json()["format"]) == (200, "PDF")
