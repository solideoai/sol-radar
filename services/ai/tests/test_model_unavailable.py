"""V2-03(gateway 부분): 모델 쪽 실패 유형을 서로 다른 코드로 기록한다(03 §8, 11 V2-03, K3·K4).

Qwen 미접속은 QWEN_UNAVAILABLE, 추출 실패는 EXTRACTION_FAILED, Kev 미접속은 KEV_UNAVAILABLE.
한 유형을 다른 유형의 코드로 기록하거나, 한쪽 장애가 다른 쪽 엔드포인트를 실패시키면 안 된다.
"""

from support import extract_request, kev_request


def client_with_fault(make_client, monkeypatch, fault: str):
    monkeypatch.setenv("AI_FAULT_INJECT", fault)
    return make_client()


def extract(client) -> dict:
    response = client.post("/extract", json=extract_request("FX-01"))
    assert response.status_code == 200
    return response.json()


def kev(client) -> dict:
    response = client.post("/kev", json=kev_request("FX-01"))
    assert response.status_code == 200
    return response.json()


def test_v2_03_qwen_unreachable_is_qwen_unavailable_not_extraction_failed(make_client, monkeypatch):
    assert (
        extract(client_with_fault(make_client, monkeypatch, "qwen_unreachable"))["errorCode"]
        == "QWEN_UNAVAILABLE"
    )


def test_v2_03_qwen_error_is_extraction_failed_not_qwen_unavailable(make_client, monkeypatch):
    assert (
        extract(client_with_fault(make_client, monkeypatch, "qwen_error"))["errorCode"]
        == "EXTRACTION_FAILED"
    )


def test_v2_03_kev_unreachable_is_kev_unavailable(make_client, monkeypatch):
    result = kev(client_with_fault(make_client, monkeypatch, "kev_unreachable"))
    assert (result["errorCode"], result["kev"]["enabled"]) == ("KEV_UNAVAILABLE", False)


def test_v2_03_kev_outage_does_not_fail_extraction(make_client, monkeypatch):
    result = extract(client_with_fault(make_client, monkeypatch, "kev_unreachable"))
    assert (result["status"], result["errorCode"]) == ("COMPLETED", None)


def test_v2_03_qwen_outage_does_not_disable_kev(make_client, monkeypatch):
    result = kev(client_with_fault(make_client, monkeypatch, "qwen_unreachable"))
    assert (result["errorCode"], result["kev"]["enabled"]) == (None, True)


def test_v2_03_model_failure_codes_are_three_distinct_values(make_client, monkeypatch):
    codes = set()
    for fault, call in (
        ("qwen_unreachable", extract),
        ("qwen_error", extract),
        ("kev_unreachable", kev),
    ):
        codes.add(call(client_with_fault(make_client, monkeypatch, fault))["errorCode"])
    assert codes == {"QWEN_UNAVAILABLE", "EXTRACTION_FAILED", "KEV_UNAVAILABLE"}
