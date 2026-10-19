"""요청 크기 상한(security-auditor Low). 넘으면 FastAPI 기본 422(본문 형식 오류와 같은 처리, K9).

ExtractRequest: body·attachments[].text 최대 2,000,000자, attachments 최대 200개.
/kev·/explain 은 "같은 수준 상한"이다. 어느 필드에 거는지는 정해지지 않아 2,000,000자를 넘는 문자열 하나로 본다.
"""

import pytest
from support import bid_meta, explain_request, extract_request, extraction_fixture, kev_request

LIMIT = 2_000_000


def default_422(response) -> tuple:
    return (response.status_code, "detail" in response.json())


def small_attachment(index: int) -> dict:
    return {"documentId": f"doc-{index}", "text": "첨부", "pages": []}


def test_extract_body_at_limit_is_accepted(make_client):
    # FX-04 추출은 인용이 없어 큰 본문도 검증 비용이 작다
    request = extract_request("FX-04", body="가" * LIMIT, meta=bid_meta("FX-04"))
    assert make_client().post("/extract", json=request).status_code == 200


def test_extract_body_over_limit_is_422(make_client):
    request = extract_request("FX-04", body="가" * (LIMIT + 1), meta=bid_meta("FX-04"))
    assert default_422(make_client().post("/extract", json=request)) == (422, True)


def test_extract_attachment_text_over_limit_is_422(make_client):
    attachment = {"documentId": "doc-big", "text": "가" * (LIMIT + 1), "pages": []}
    request = extract_request("FX-04", attachments=[attachment])
    assert default_422(make_client().post("/extract", json=request)) == (422, True)


@pytest.mark.parametrize(("count", "status"), [(200, 200), (201, 422)])
def test_extract_attachment_count_limit(make_client, count, status):
    request = extract_request("FX-04", attachments=[small_attachment(i) for i in range(count)])
    assert make_client().post("/extract", json=request).status_code == status


def test_kev_oversized_string_is_422(make_client):
    extraction = extraction_fixture("FX-01")
    extraction["summary"]["value"] = "가" * (LIMIT + 1)
    response = make_client().post("/kev", json=kev_request("FX-01", extraction=extraction))
    assert default_422(response) == (422, True)


def test_explain_oversized_string_is_422(make_client):
    request = explain_request()
    request["qualificationChecks"][0]["reason"] = "가" * (LIMIT + 1)
    assert default_422(make_client().post("/explain", json=request)) == (422, True)
