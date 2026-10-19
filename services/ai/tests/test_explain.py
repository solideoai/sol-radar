"""POST /explain 템플릿 설명(03 §2.1·§6, 명세 §3, K8).

mock 은 규칙 결과를 템플릿에 넣는다(fallback=true). 입력 밖 숫자 금지, 수주·낙찰·충족 확률 문구 금지.
"""

import copy
import re

import pytest
from support import (
    FIXED_CLOSING,
    canonical,
    explain_request,
    number_set,
    ordered_numbers,
)

DOCUMENT_ISSUE_SENTENCE = "첨부 문서를 읽지 못해 첨부에만 있는 요구사항은 반영되지 않았습니다."
FORBIDDEN = re.compile(r"(수주|낙찰|충족)\s*확률")


def post(client, request: dict) -> dict:
    response = client.post("/explain", json=request)
    assert response.status_code == 200
    return response.json()


def test_explain_response_has_contract_keys(make_client):
    assert set(post(make_client(), explain_request())) == {"text", "usedNumbers", "fallback"}


def test_mock_explanation_is_template_fallback(make_client):
    assert post(make_client(), explain_request())["fallback"] is True


def test_explanation_ends_with_fixed_sentence(make_client):
    assert post(make_client(), explain_request())["text"].endswith(FIXED_CLOSING)


def test_explanation_states_score_and_recommendation(make_client):
    assert "SOL Score 68점, 권고 " in post(make_client(), explain_request())["text"]


def test_explanation_names_unsatisfied_mandatory_qualification(make_client):
    assert "정보통신공사업 등록" in post(make_client(), explain_request())["text"]


def test_explanation_starts_with_document_issue_sentence(make_client):
    request = explain_request()
    request["documentIssues"] = [
        {
            "documentId": "doc-rfp-1",
            "downloadStatus": "DOWNLOADED",
            "parseStatus": "UNSUPPORTED",
            "errorCode": "UNSUPPORTED_FORMAT",
        }
    ]
    assert post(make_client(), request)["text"].startswith(DOCUMENT_ISSUE_SENTENCE)


def test_explanation_omits_document_issue_sentence_without_issues(make_client):
    assert DOCUMENT_ISSUE_SENTENCE not in post(make_client(), explain_request())["text"]


def test_explanation_mentions_kev_disagreement_without_applying_it(make_client):
    # 규칙 NO_BID, Kev BID(FX-03)
    text = post(make_client(), explain_request())["text"]
    assert "Kev 참고 지표는 " in text
    assert "를 제시했지만 점수와 권고에 반영하지 않습니다." in text


def test_explanation_has_no_kev_sentence_when_kev_agrees(make_client):
    request = explain_request()
    request["kevSummary"]["suggestedOption"] = "NO_BID"
    assert "Kev 참고 지표" not in post(make_client(), request)["text"]


@pytest.mark.parametrize("kev", ["disabled", "absent"])
def test_explanation_has_no_kev_sentence_without_kev(make_client, kev):
    request = explain_request()
    if kev == "absent":
        request["kevSummary"] = None
    else:
        request["kevSummary"] = {
            **{k: None for k in request["kevSummary"]},
            "enabled": False,
            "disclaimer": request["kevSummary"]["disclaimer"],
        }
    assert "Kev 참고 지표" not in post(make_client(), request)["text"]


def test_explanation_uses_only_numbers_from_input(make_client):
    request = explain_request()
    text = post(make_client(), request)["text"]
    assert set(ordered_numbers(text)) <= number_set(request)


def test_used_numbers_list_numbers_in_text_order(make_client):
    result = post(make_client(), explain_request())
    assert result["usedNumbers"] == ordered_numbers(result["text"])


@pytest.mark.parametrize("score", [94, 72, 41])
def test_explanation_score_follows_input(make_client, score):
    request = explain_request()
    request["scoreBreakdown"]["score"] = score
    result = post(make_client(), request)
    assert f"SOL Score {score}점" in result["text"]
    assert set(result["usedNumbers"]) <= number_set(request)


def test_explanation_has_no_probability_phrases(make_client):
    request = explain_request()
    request["documentIssues"] = [
        {"documentId": "d", "downloadStatus": "FAILED", "parseStatus": "", "errorCode": None}
    ]
    assert FORBIDDEN.findall(post(make_client(), request)["text"]) == []


def test_explain_is_deterministic(make_client):
    client = make_client()
    request = explain_request()
    first = post(client, copy.deepcopy(request))
    second = post(client, copy.deepcopy(request))
    assert canonical(first) == canonical(second)
