"""Qwen 본문 ID의 null 직렬화 오류와 Citation → 번역 → Bosun 경계 회귀."""

import copy
import json

import pytest
from fake_models import Reply, chat_completion
from support import extract_request, extraction_fixture, kev_request, text_ref

COMPLETIONS = "/v1/chat/completions"
QUOTE = "필수 기술은 전자정부 프레임워크 Java 17이다."
TRANSLATIONS = {"requiredSkills[0]": "e-Government Framework with Java 17"}


def skills_extraction(document_id):
    extraction = extraction_fixture("FX-04")
    extraction["requiredSkills"] = {
        "state": "KNOWN",
        "value": ["전자정부 프레임워크 Java 17"],
        "evidence": [text_ref(QUOTE, document_id, charStart=0, charEnd=len(QUOTE))],
    }
    return extraction


def serve_extraction(local_models, extraction, translations=TRANSLATIONS):
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(extraction, ensure_ascii=False))),
        Reply(json_body=chat_completion(json.dumps({"translations": translations}))),
    )


@pytest.mark.parametrize("document_id", [None, "null"])
def test_body_id_is_verified_before_korean_translation(make_client, local_models, document_id):
    extraction = skills_extraction(document_id)
    before = copy.deepcopy(extraction)
    request = extract_request("FX-04", body=QUOTE)
    original_request = copy.deepcopy(request)
    serve_extraction(local_models, extraction)

    response = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request)
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "COMPLETED"
    assert result["warnings"] == []
    field = result["payload"]["requiredSkills"]
    assert field["state"] == "KNOWN" and field["value"] == before["requiredSkills"]["value"]
    assert field["evidence"] == [
        {
            **before["requiredSkills"]["evidence"][0],
            "documentId": None,
            "revisionId": request["revisionId"],
            "match": "EXACT",
        }
    ]
    assert result["translations"] == TRANSLATIONS
    calls = local_models.qwen.calls("POST", COMPLETIONS)
    assert len(calls) == 2
    assert json.loads(calls[1].json()["messages"][1]["content"])["values"] == {
        "requiredSkills[0]": "전자정부 프레임워크 Java 17"
    }
    assert extraction == before and request == original_request


@pytest.mark.parametrize(
    ("document_id", "body", "attachment_text", "expected_state"),
    [
        ("null", "수요기관 담당자에게 문의하십시오.", QUOTE, "KNOWN"),
        ("null", QUOTE, "첨부 문서에는 사업 담당자의 연락처만 기재되어 있다.", "UNKNOWN"),
        (None, QUOTE, "첨부 문서에는 사업 담당자의 연락처만 기재되어 있다.", "KNOWN"),
    ],
)
def test_real_null_attachment_id_is_preserved_without_body_fallback(
    make_client, local_models, document_id, body, attachment_text, expected_state
):
    extraction = skills_extraction(document_id)
    serve_extraction(local_models, extraction)
    result = (
        make_client(SOL_RUN_MODE="fixture")
        .post(
            "/extract",
            json=extract_request(
                "FX-04",
                body=body,
                attachments=[{"documentId": "null", "text": attachment_text, "pages": []}],
            ),
        )
        .json()
    )
    field = result["payload"]["requiredSkills"]
    assert field["state"] == expected_state
    assert field["evidence"][0]["documentId"] == document_id
    assert field["evidence"][0]["quotedText"] == QUOTE
    assert field["evidence"][0]["match"] == ("EXACT" if expected_state == "KNOWN" else "FAILED")
    if expected_state == "UNKNOWN":
        assert result["translations"] == {}
        assert len(local_models.qwen.calls("POST", COMPLETIONS)) == 1
    else:
        assert result["translations"] == TRANSLATIONS


@pytest.mark.parametrize("document_id", [17, False, [], {}])
def test_invalid_document_id_type_fails_schema_before_citation_or_translation(
    make_client, local_models, document_id
):
    extraction = skills_extraction(document_id)
    local_models.qwen.route(
        "POST", COMPLETIONS, Reply(json_body=chat_completion(json.dumps(extraction)))
    )
    result = (
        make_client(SOL_RUN_MODE="fixture")
        .post("/extract", json=extract_request("FX-04", body=QUOTE))
        .json()
    )
    assert result["status"] == "FAILED" and result["errorCode"] == "EXTRACTION_FAILED"
    assert result["payload"] is None and result["translations"] is None
    calls = local_models.qwen.calls("POST", COMPLETIONS)
    assert len(calls) == 2  # 기존 스키마 재시도 1회만 수행한다.
    assert all(
        c.json()["response_format"]["json_schema"]["name"] != "state_translation" for c in calls
    )


@pytest.mark.parametrize(
    ("document_id", "body"),
    [("null", "수요기관 담당자에게 문의하십시오."), ("missing-attachment", QUOTE)],
)
def test_unproven_quote_stays_unknown_without_translation(
    make_client, local_models, document_id, body
):
    serve_extraction(local_models, skills_extraction(document_id))
    result = (
        make_client(SOL_RUN_MODE="fixture")
        .post("/extract", json=extract_request("FX-04", body=body))
        .json()
    )
    field = result["payload"]["requiredSkills"]
    assert field["state"] == "UNKNOWN" and field["value"] is None
    assert field["evidence"][0]["match"] == "FAILED"
    assert field["evidence"][0]["quotedText"] == QUOTE
    assert "CITATION_FAILED:requiredSkills" in result["warnings"]
    assert result["translations"] == {}
    assert len(local_models.qwen.calls("POST", COMPLETIONS)) == 1


@pytest.mark.parametrize("kind", ["TEXT", "API_FIELD"])
def test_metadata_only_deadline_cannot_become_body_evidence(make_client, local_models, kind):
    extraction = skills_extraction("null")
    deadline = "2026-11-01T00:00:00Z"
    extraction["deadlineAt"] = {
        "state": "KNOWN",
        "value": deadline,
        "evidence": [text_ref(deadline, "null", kind=kind)],
    }
    serve_extraction(local_models, extraction)
    result = (
        make_client(SOL_RUN_MODE="fixture")
        .post(
            "/extract",
            json=extract_request("FX-04", body=QUOTE, meta={"deadlineAt": deadline}),
        )
        .json()
    )
    field = result["payload"]["deadlineAt"]
    assert field["value"] is None and field["state"] == "UNKNOWN"
    assert field["evidence"][0]["match"] == "FAILED"
    assert field["evidence"][0]["quotedText"] == deadline
    assert field["evidence"][0]["documentId"] == (None if kind == "TEXT" else "null")
    assert "CITATION_FAILED:deadlineAt" in result["warnings"]
    assert result["translations"] == TRANSLATIONS


def test_cited_deadline_still_conflicts_with_different_metadata(make_client, local_models):
    extraction = skills_extraction("null")
    deadline = "2026-11-01T00:00:00Z"
    extraction["deadlineAt"] = {
        "state": "KNOWN",
        "value": deadline,
        "evidence": [
            text_ref(
                deadline,
                "null",
                charStart=len(QUOTE) + 1,
                charEnd=len(QUOTE) + 1 + len(deadline),
            )
        ],
    }
    serve_extraction(local_models, extraction)
    result = (
        make_client(SOL_RUN_MODE="fixture")
        .post(
            "/extract",
            json=extract_request(
                "FX-04",
                body=f"{QUOTE} {deadline}",
                meta={"deadlineAt": "2026-11-02T00:00:00Z"},
            ),
        )
        .json()
    )
    field = result["payload"]["deadlineAt"]
    assert field["state"] == "CONFLICTED" and field["value"] is None
    assert field["evidence"][0]["match"] == "EXACT"
    assert field["evidence"][0]["quotedText"] == deadline
    assert field["evidence"][0]["documentId"] is None
    assert field["note"] == f"NormalizedBid 2026-11-02T00:00:00Z vs extraction {deadline}"
    assert result["translations"] == TRANSLATIONS


def test_missing_translation_after_body_id_repair_blocks_bosun(make_client, local_models):
    serve_extraction(local_models, skills_extraction("null"), translations={})
    client = make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.2")
    result = client.post("/extract", json=extract_request("FX-04", body=QUOTE)).json()
    assert result["payload"]["requiredSkills"]["state"] == "KNOWN"
    assert result["status"] == "PENDING_REVIEW" and result["translations"] == {}
    assert "TRANSLATION_MISSING:requiredSkills[0]" in result["warnings"]

    decision = client.post(
        "/kev",
        json=kev_request(
            extraction=result["payload"],
            translations=result["translations"],
            questionSetVersion="kev-qs/v0.2",
        ),
    ).json()
    assert decision["errorCode"] == "KEV_UNAVAILABLE" and not decision["kev"]["enabled"]
    assert decision["wire"] is None and decision["requirements"] is None
    assert "TRANSLATION_MISSING:requiredSkills[0]" in decision["warnings"]
    assert not local_models.kev.calls("POST", "/v1/systemone")
    assert len(local_models.qwen.calls("POST", COMPLETIONS)) == 2
