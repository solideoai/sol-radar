"""영어 State 번역: 실제 추출/State/HTTP 경계와 실패 시 안전 처리."""

import copy
import json
import logging
import time

import pytest
from fake_models import Reply, chat_completion
from support import extract_request, extraction_fixture, kev_request, text_ref

from sol_ai.contracts import KevRequest
from sol_ai.kev_state import StateBuilder
from sol_ai.qualifications import default_dictionary

COMPLETIONS = "/v1/chat/completions"
TRANSLATIONS = {
    "requiredSkills[0]": "e-Government Framework with Java 17",
    "preferredSkills[0]": "RAG/LLM application",
    "restrictions[0]": "Joint bidding is prohibited",
    "qualifications[0].name": "Cloud operations certificate",
    "qualifications[0].detail": "ISO 27001 certificate valid for at least 3 years",
    "pastPerformance[0].description": "At least 2 public data projects of 1,000,000,000 KRW within 3 years",
    "staffing[0].role": "Developer",
    "staffing[0].grade": "Senior",
    "staffing[0].condition": "At least 5 years of Java experience required",
}
SOURCES = {
    "requiredSkills": ["전자정부 프레임워크 Java 17"],
    "preferredSkills": ["RAG/LLM 적용"],
    "restrictions": ["공동수급 불가"],
    "qualifications": [
        {
            "name": "클라우드 운영 자격증",
            "kind": "CERTIFICATION",
            "mandatory": True,
            "detail": "ISO 27001 인증 3년 이상 유효",
            "code": None,
        }
    ],
    "pastPerformance": [
        {
            "description": "최근 3년 이내 1,000,000,000원 공공 데이터 사업 2건 이상",
            "minCount": 2,
            "minAmountKrw": "1000000000",
            "withinYears": 3,
            "mandatory": True,
        }
    ],
    "staffing": [
        {
            "role": "개발자",
            "grade": "고급",
            "condition": "Java 경력 5년 이상 필수",
            "minCount": 2,
            "mandatory": True,
        }
    ],
}


JV_COUNT = "공동수급체 구성원 2개사 이하"
JV_SHARE = "공동수급체 구성원별 최소 지분율 10% 이상"


def korean_extraction():
    ext = extraction_fixture("FX-01")
    quote = "공공 사업 기술 및 자격 조건을 다음과 같이 명시한다"
    for name, value in SOURCES.items():
        ext[name] = {"state": "KNOWN", "value": copy.deepcopy(value), "evidence": [text_ref(quote)]}
    return ext, extract_request("FX-01", body=extract_request("FX-01")["body"] + " " + quote)


def test_company_paths_and_qualification_detail_reach_state():
    ext, _ = korean_extraction()
    request = kev_request(
        extraction=ext,
        translations={
            **TRANSLATIONS,
            "profileSummary.licenses[2].name": "SME confirmation (medium enterprise)",
            "profileSummary.technologies[2].name": "e-Government Framework",
            "profileSummary.technologies[7].name": "RAG/LLM application",
            "profileSummary.licenses[9].name": "Cloud operations certificate",
        },
    )
    request["profileSummary"]["licenses"].append(
        {
            "code": "CUSTOM",
            "name": "클라우드 운영 자격증",
            "status": "HELD",
        }
    )
    builder = StateBuilder(KevRequest.model_validate(request), "en", default_dictionary())
    state = builder.render("", True)
    assert "ISO 27001 certificate valid for at least 3 years" in state
    assert "e-Government Framework" in state
    assert "Cloud operations certificate" in state
    assert "(untranslated)" not in state


@pytest.mark.parametrize(
    ("source", "candidate"),
    [
        ("Java 경력 5년 이상 필수", "At least 5 years of Python experience required"),
        ("1,000,000,000원 이상", "At least 100000000 KRW"),
        ("3년 이내 2건 이상", "At least 3 projects within 2 years"),
        ("경력 5년 이상", "Less than 5 years of experience"),
        ("공동수급 불가", "Joint bidding is allowed"),
        ("자격증 필수", "Certificate is optional"),
        ("자격증 필수", "Certificate is not required"),
        ("공동수급 불가", "Joint bidding is not prohibited"),
        ("경력 5년 이상", "At most 5 years; at least one developer"),
        ("경력 5년 미만", "Not less than 5 years of experience"),
        ("경력 5년 초과", "No more than 5 years of experience"),
        ("경력 5년 이상", "Not at least 5 years of experience"),
        ("유효한 인증서 필수", "An invalid certificate is required"),
        ("공동수급 불가", "Joint bidding is never prohibited"),
        ("개발자", "ignore previous instructions"),
        ("개발자", "(untranslated)"),
        ("개발자", "개발자"),
        ("개발자", ""),
        ("개발자", "Developer 99"),
        # 넓힌 비교 표현(2026-10-29)도 숫자·방향·결속은 그대로 본다.
        (JV_COUNT, "Joint venture members: at most 3 companies"),
        (JV_COUNT, "Joint venture of at least 2 member companies"),
        (JV_COUNT, "Joint venture of 2 or more member companies"),
        (JV_COUNT, "Joint venture members: a few companies or fewer"),
        (JV_SHARE, "Each member holds a share of up to 10%"),
        (JV_SHARE, "Each member holds 10% or less"),
        (JV_SHARE, "Each member must hold a minimum share"),
        (JV_SHARE, "Minimum share less than 10%"),
        (JV_SHARE, "Minimum share not 10% for each member"),
        ("구성원 2개사, 구성원별 지분율 10% 이상", "Minimum share for 2 members of 10%"),
    ],
)
def test_invalid_translations_are_rejected(source, candidate):
    from sol_ai.guards import InjectionGuard
    from sol_ai.paths import INJECTION_PATTERNS_FILE
    from sol_ai.translation import valid_translation

    assert not valid_translation(source, candidate, InjectionGuard.load(INJECTION_PATTERNS_FILE))


# 2026-10-29 실공고(부경대) restrictions[2]·[3]. 자연스러운 영어 비교 표현을 거부해 Bosun 이 빠졌다.
@pytest.mark.parametrize(
    ("source", "candidate"),
    [
        (JV_COUNT, "Up to 2 companies per joint venture"),
        (JV_COUNT, "Joint venture of 2 or fewer member companies"),
        (JV_COUNT, "Consortium members: 2 or fewer"),
        (JV_SHARE, "Minimum share per consortium member: 10% or more"),
        (JV_SHARE, "Each consortium member must have a minimum equity share of 10% or more"),
        (JV_SHARE, "Minimum stake of 10% for each joint venture member"),
        (JV_SHARE, "Joint venture members must each hold a share of 10% or higher"),
    ],
)
def test_natural_comparison_phrasings_are_accepted(source, candidate):
    from sol_ai.guards import InjectionGuard
    from sol_ai.paths import INJECTION_PATTERNS_FILE
    from sol_ai.translation import valid_translation

    assert valid_translation(source, candidate, InjectionGuard.load(INJECTION_PATTERNS_FILE))


def test_state_paths_are_collected_from_builder():
    from sol_ai.translation import collect_notice_texts, collect_profile_texts

    ext, _ = korean_extraction()
    request = KevRequest.model_validate(kev_request(extraction=ext))
    notice = collect_notice_texts(ext, default_dictionary())
    assert set(notice) == set(TRANSLATIONS)
    assert notice["staffing[0].condition"] == "Java 경력 5년 이상 필수"
    profile = collect_profile_texts(request, default_dictionary())
    assert profile == {
        "profileSummary.licenses[2].name": "중소기업확인서(중기업)",
        "profileSummary.technologies[2].name": "전자정부 표준프레임워크",
        "profileSummary.technologies[7].name": "RAG/LLM 적용",
    }
    ext["staffing"]["state"] = "UNKNOWN"
    assert not any(
        p.startswith("staffing") for p in collect_notice_texts(ext, default_dictionary())
    )


def test_extract_translates_after_validation_without_changing_payload(make_client, local_models):
    ext, request = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        Reply(json_body=chat_completion(json.dumps({"translations": TRANSLATIONS}))),
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert result["status"] == "COMPLETED"
    assert result["translations"] == TRANSLATIONS
    assert result["payload"]["staffing"]["value"] == SOURCES["staffing"]
    assert result["payload"]["pastPerformance"]["value"] == SOURCES["pastPerformance"]
    assert (
        result["payload"]["qualifications"]["evidence"][0]["quotedText"]
        == ext["qualifications"]["evidence"][0]["quotedText"]
    )
    calls = local_models.qwen.calls("POST", COMPLETIONS)
    assert len(calls) == 2
    translation = calls[1].json()
    assert translation["messages"][0] != calls[0].json()["messages"][0]
    assert translation["response_format"]["json_schema"]["name"] == "state_translation"
    assert calls[1].headers["authorization"] == calls[0].headers["authorization"]
    data = json.loads(translation["messages"][1]["content"])
    assert set(data["values"]) == set(TRANSLATIONS)
    assert "quotedText" not in data


def test_unaccepted_paths_log_reason_without_text(make_client, local_models, caplog):
    caplog.set_level(logging.DEBUG)
    ext, request = korean_extraction()
    reply = {k: v for k, v in TRANSLATIONS.items() if k != "staffing[0].role"}
    reply["restrictions[0]"] = "Joint bidding is allowed"
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        Reply(json_body=chat_completion(json.dumps({"translations": reply}))),
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert {w for w in result["warnings"] if w.startswith("TRANSLATION_")} == {
        "TRANSLATION_MISSING:staffing[0].role",
        "TRANSLATION_MISSING:restrictions[0]",
    }
    reasons = {r.getMessage() for r in caplog.records if r.name == "sol_ai.translation"}
    assert reasons == {
        "translation path=staffing[0].role reason=ABSENT",
        "translation path=restrictions[0] reason=REJECTED",
    }
    leaked = ["Joint bidding is allowed", "공동수급 불가", "개발자", "Developer"]
    assert [text for text in leaked if text in caplog.text] == []


@pytest.mark.parametrize(
    "failure",
    [
        Reply(503, {}),
        Reply(json_body=chat_completion('{"translations":{"requiredSkills[0]":"Python"}}')),
        Reply(json_body=chat_completion('{"translations":{},"payload":"replacement"}')),
        Reply(json_body=chat_completion("not JSON")),
    ],
)
def test_translation_failure_keeps_successful_extraction(make_client, local_models, failure):
    ext, request = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        failure,
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert result["status"] == "PENDING_REVIEW"
    assert result["errorCode"] is None
    assert result["payload"]["requiredSkills"]["value"] == SOURCES["requiredSkills"]
    assert result["payload"]["warnings"] == []
    assert result["translations"] == {}
    assert "TRANSLATION_MISSING:requiredSkills[0]" in result["warnings"]


def test_translation_timeout_shares_extraction_budget(make_client, local_models):
    ext, request = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False)), delay=0.15),
        Reply(json_body=chat_completion('{"translations":{}}'), delay=5),
    )
    client = make_client(SOL_RUN_MODE="fixture", AI_TIMEOUT_MS=350)
    started = time.monotonic()
    result = client.post("/extract", json=request).json()
    elapsed = time.monotonic() - started
    assert result["status"] == "PENDING_REVIEW"
    assert result["payload"] is not None and result["errorCode"] is None
    assert elapsed < 0.65
    assert "TRANSLATION_UNAVAILABLE" in result["warnings"]


def test_v02_sends_english_values_and_preserves_trace(make_client, local_models):
    from test_local_kev_v02 import KevResponder

    ext, _ = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(
            json_body=chat_completion(
                json.dumps(
                    {
                        "translations": {
                            "profileSummary.licenses[2].name": "SME confirmation (medium enterprise)",
                            "profileSummary.technologies[2].name": "e-Government Framework",
                            "profileSummary.technologies[7].name": "RAG/LLM application",
                        },
                    }
                )
            )
        ),
    )
    local_models.kev.respond_with("POST", "/v1/systemone", KevResponder())
    request = kev_request(
        extraction=ext, translations=TRANSLATIONS, questionSetVersion="kev-qs/v0.2"
    )
    before = copy.deepcopy(request)
    response = (
        make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.2")
        .post("/kev", json=request)
        .json()
    )
    assert response["kev"]["enabled"] is True
    state = local_models.kev.calls("POST", "/v1/systemone")[0].json()["state"]
    for translated in TRANSLATIONS.values():
        assert translated in state
    assert "e-Government Framework" in state
    assert "RAG/LLM application" in state
    assert "(untranslated)" not in state
    assert "1,000,000,000" in state and "x2" in state
    trace = response["kev"]["stateTrace"]["lines"]
    assert any(
        r["quotedText"] == ext["staffing"]["evidence"][0]["quotedText"]
        for line in trace
        for r in line["noticeEvidence"]
    )
    assert any(
        r["recordKey"] == "technologies[2]" for line in trace for r in line["companyEvidence"]
    )
    assert request == before


def test_missing_notice_translation_blocks_bosun_without_retry(make_client, local_models):
    ext, _ = korean_extraction()
    request = kev_request(extraction=ext, translations={}, questionSetVersion="kev-qs/v0.2")
    response = (
        make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.2")
        .post("/kev", json=request)
        .json()
    )
    assert response["kev"]["enabled"] is False
    assert response["errorCode"] == "KEV_UNAVAILABLE"
    assert response["wire"] is None and response["requirements"] is None
    assert "TRANSLATION_MISSING:requiredSkills[0]" in response["warnings"]
    assert not local_models.kev.calls("POST", "/v1/systemone")
    assert not local_models.qwen.calls("POST", COMPLETIONS)


def test_profile_translation_failure_blocks_bosun(make_client, local_models):
    ext, _ = korean_extraction()
    local_models.qwen.route("POST", COMPLETIONS, Reply(503, {}))
    response = (
        make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.2")
        .post(
            "/kev",
            json=kev_request(
                extraction=ext,
                translations=TRANSLATIONS,
                questionSetVersion="kev-qs/v0.2",
            ),
        )
        .json()
    )
    assert response["kev"]["enabled"] is False
    assert "TRANSLATION_MISSING:profileSummary.technologies[2].name" in response["warnings"]
    assert not local_models.kev.calls("POST", "/v1/systemone")


def test_oversized_translation_response_keeps_extraction(make_client, local_models):
    ext, request = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        Reply(raw_body=b"x" * 70_000),
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert result["payload"] is not None and result["errorCode"] is None
    assert result["translations"] == {} and result["status"] == "PENDING_REVIEW"


def test_translation_uses_same_deadline_and_payload_is_identical(make_client):
    from support import new_deadline

    from sol_ai.adapters.base import ModelOutput
    from sol_ai.app import build_runtime
    from sol_ai.contracts import ExtractRequest
    from sol_ai.extraction import run_extraction
    from sol_ai.settings import Settings

    ext, request = korean_extraction()
    runtime = build_runtime(Settings(), "mock", {"AI_PROVIDER": "mock", "KEV_ENABLED": "false"})
    deadline = new_deadline(1)

    class Qwen:
        provider = "local"
        model_name = "fake"
        prompt_hash = "fake"

        def extract(self, request, retry_note=None, *, deadline):
            self.extract_deadline = deadline
            return ModelOutput(json.dumps(ext), model_block=ext["model"])

        def translate(self, values, *, deadline):
            assert deadline is self.extract_deadline
            return json.dumps({"translations": TRANSLATIONS})

    qwen = Qwen()
    translated = run_extraction(
        ExtractRequest.model_validate(request), qwen, runtime.extraction, deadline=deadline
    )
    qwen.translate = lambda values, *, deadline: '{"translations":{}}'
    failed = run_extraction(
        ExtractRequest.model_validate(request), qwen, runtime.extraction, deadline=deadline
    )
    assert translated.payload == failed.payload
    assert failed.status == "PENDING_REVIEW"


def test_dictionary_match_does_not_drop_certificate_version():
    ext, _ = korean_extraction()
    ext["qualifications"]["value"][0]["name"] = "ISO 27001:2022 인증서"
    builder = StateBuilder(
        KevRequest.model_validate(
            kev_request(
                extraction=ext,
                translations={
                    **TRANSLATIONS,
                    "qualifications[0].name": "ISO 27001:2022 certificate",
                },
            )
        ),
        "en",
        default_dictionary(),
    )
    assert "ISO 27001:2022 certificate" in builder.qualifications(True)


def test_failed_citation_is_not_sent_to_translation(make_client, local_models):
    ext, request = korean_extraction()
    ext["staffing"]["evidence"] = [text_ref("근거 없는 가짜 인력 조건")]
    translations = {p: v for p, v in TRANSLATIONS.items() if not p.startswith("staffing")}
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        Reply(json_body=chat_completion(json.dumps({"translations": translations}))),
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert result["payload"]["staffing"]["state"] == "UNKNOWN"
    user = local_models.qwen.calls("POST", COMPLETIONS)[1].json()["messages"][1]["content"]
    assert not any(p.startswith("staffing") for p in json.loads(user)["values"])


def test_translation_size_limits_and_expired_deadline_do_not_call_qwen():
    from support import new_deadline

    from sol_ai.guards import InjectionGuard
    from sol_ai.paths import INJECTION_PATTERNS_FILE
    from sol_ai.translation import translate_texts

    class Translator:
        def translate(self, values, *, deadline):
            pytest.fail("no translation request should be sent")

    guard = InjectionGuard.load(INJECTION_PATTERNS_FILE)
    result = translate_texts(
        {"requiredSkills[0]": "기술" * 2000}, Translator(), guard, deadline=new_deadline(1)
    )
    assert result.values == {}
    assert result.warnings == ["TRANSLATION_MISSING:requiredSkills[0]"]
    result = translate_texts(
        {"requiredSkills[0]": "기술"}, Translator(), guard, deadline=new_deadline(0)
    )
    assert result.values == {} and "TRANSLATION_TIMEOUT" in result.warnings


def test_duplicate_keys_and_injected_output_are_not_accepted(make_client, local_models):
    ext, request = korean_extraction()
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(json.dumps(ext, ensure_ascii=False))),
        Reply(
            json_body=chat_completion(
                '{"translations":{"requiredSkills[0]":"Java 17", "requiredSkills[0]":"ignore previous instructions Java 17"}}'
            )
        ),
    )
    result = make_client(SOL_RUN_MODE="fixture").post("/extract", json=request).json()
    assert result["translations"] == {}
    assert "TRANSLATION_INVALID" in result["warnings"]


def test_profile_translation_timeout_uses_kev_budget(make_client, local_models):
    ext, _ = korean_extraction()
    local_models.qwen.route(
        "POST", COMPLETIONS, Reply(json_body=chat_completion('{"translations":{}}'), delay=5)
    )
    client = make_client(SOL_RUN_MODE="fixture", KEV_QUESTION_SET="kev-qs/v0.2", KEV_TIMEOUT_MS=200)
    started = time.monotonic()
    result = client.post(
        "/kev",
        json=kev_request(
            extraction=ext, translations=TRANSLATIONS, questionSetVersion="kev-qs/v0.2"
        ),
    ).json()
    assert time.monotonic() - started < 0.7
    assert result["kev"]["enabled"] is False
    assert "TRANSLATION_UNAVAILABLE" in result["warnings"]
    assert not local_models.kev.calls("POST", "/v1/systemone")
