"""G9: POST /kev 어댑터 계약(03 §5.4~§5.7, 명세 §2, K4·K6·K9).

state 텍스트는 응답에 나오지 않는다(stateHash = sha256(state) 만 나온다). 그래서 state 내용은
"한글 값·규칙 결과만 바꾼 두 요청의 stateHash 가 같다"(불변)와 "영어 값을 바꾸면 stateHash 가 다르다"(대조)로 본다.
"""

import ast
import json
import re

import pytest
from support import (
    HANGUL,
    KEV_ASSIST_KEYS,
    KEV_DISCLAIMER,
    LEGEND,
    SRC_DIR,
    WIN_PROBABILITY,
    canonical,
    extraction_fixture,
    kev_fixture,
    kev_request,
    question_set_questions,
    text_ref,
    without_timings,
)

# 03 §5.5 표에서 옮긴 질문 세트 원문
QUESTION_SET = {
    "recommendation": {
        "type": "choice",
        "instructions": (
            "Given the company profile and the notice requirements, "
            "which action should the sales team take?"
        ),
        "criteria": {
            "BID": "Requirements are met and the fit is strong",
            "WATCH": "Promising but something must be confirmed first",
            "NO_BID": "A mandatory requirement is unmet or the fit is poor",
        },
    },
    "mandatoryRisk": {
        "type": "noul",
        "instructions": (
            "Is there a mandatory qualification, license or past-performance requirement "
            "that this company probably does not satisfy?"
        ),
        "criteria": {
            "true": "At least one mandatory item is likely unmet or unverifiable",
            "false": "All mandatory items appear satisfied",
        },
    },
    "needsHumanReview": {
        "type": "noul",
        "instructions": (
            "Does this notice contain ambiguity, conflicting figures or unusual conditions "
            "that a human should check before deciding?"
        ),
        "criteria": None,
    },
    "fit": {
        "type": "score",
        "instructions": "How well does this company's capability match this notice overall?",
        "criteria": ["Very poor", "Poor", "Moderate", "Good", "Very good"],
    },
}

# 07 §6.3 표 + fixtures/kev 파일 값: (suggestedOption, probabilities, confidence, mandatoryRisk,
# needsHumanReview, fit wire score)
KEV_FIXTURE_CASES = {
    "FX-01": ("BID", {"BID": 0.71, "WATCH": 0.24, "NO_BID": 0.05}, 0.71, 0.05, 0.12, 3.5),
    "FX-02": ("WATCH", {"BID": 0.36, "WATCH": 0.52, "NO_BID": 0.12}, 0.52, 0.1, 0.74, 2.2),
    "FX-03": ("BID", {"BID": 0.55, "WATCH": 0.3, "NO_BID": 0.15}, 0.55, 0.85, 0.58, 1.8),
    "FX-16": ("NO_BID", {"BID": 0.1, "WATCH": 0.2, "NO_BID": 0.7}, 0.7, 0.9, 0.3, 0.6),
}

# 명세 §2 공식(파일 없을 때)
FORMULA_NO_BID = ("NO_BID", {"BID": 0.05, "WATCH": 0.15, "NO_BID": 0.80}, 0.80, 0.80, 0.30)
FORMULA_WATCH = ("WATCH", {"BID": 0.15, "WATCH": 0.70, "NO_BID": 0.15}, 0.70, 0.50, 0.70)
FORMULA_BID = ("BID", {"BID": 0.60, "WATCH": 0.30, "NO_BID": 0.10}, 0.60, 0.10, 0.20)


def post(client, request: dict) -> dict:
    response = client.post("/kev", json=request)
    assert response.status_code == 200
    return response.json()


def kev_tuple(kev: dict) -> tuple:
    return (
        kev["suggestedOption"],
        kev["probabilities"],
        kev["confidence"],
        kev["mandatoryRisk"],
        kev["needsHumanReview"],
    )


# ---------------------------------------------------------------- 질문 세트 파일 (03 §5.5)


def question_set() -> dict:
    return question_set_questions()


def test_question_set_has_exactly_four_questions():
    assert set(question_set()) == set(QUESTION_SET)


@pytest.mark.parametrize("qid", sorted(QUESTION_SET))
def test_question_type_matches_03(qid):
    assert question_set()[qid]["type"] == QUESTION_SET[qid]["type"]


@pytest.mark.parametrize("qid", sorted(QUESTION_SET))
def test_question_instructions_match_03_verbatim(qid):
    assert question_set()[qid]["instructions"] == QUESTION_SET[qid]["instructions"]


@pytest.mark.parametrize("qid", sorted(QUESTION_SET))
def test_question_criteria_match_03_verbatim(qid):
    assert question_set()[qid].get("criteria") == QUESTION_SET[qid]["criteria"]


# ---------------------------------------------------------------- wire 필드명 격리 (03 §5.7)

WIRE_ONLY_NAMES = {"noul", "latency_ms"}


def wire_name_uses(path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and node.value in WIRE_ONLY_NAMES:
            found.append(f"{path.name}:{node.lineno} 문자열 {node.value!r}")
        elif isinstance(node, ast.Attribute) and node.attr in WIRE_ONLY_NAMES:
            found.append(f"{path.name}:{node.lineno} 속성 {node.attr}")
        elif isinstance(node, ast.Name) and node.id in WIRE_ONLY_NAMES:
            found.append(f"{path.name}:{node.lineno} 이름 {node.id}")
        elif isinstance(node, ast.arg) and node.arg in WIRE_ONLY_NAMES:
            found.append(f"{path.name}:{node.lineno} 인자 {node.arg}")
        elif isinstance(node, ast.keyword) and node.arg in WIRE_ONLY_NAMES:
            found.append(f"{path.name}:{node.lineno} 키워드 {node.arg}")
    return found


def test_kev_wire_module_owns_wire_field_names():
    wire_modules = sorted(SRC_DIR.rglob("kev_wire.py"))
    assert len(wire_modules) == 1
    assert wire_name_uses(wire_modules[0]) != []


def test_wire_field_names_are_not_hardcoded_outside_kev_wire():
    offenders = [
        use
        for path in sorted(SRC_DIR.rglob("*.py"))
        if path.name != "kev_wire.py"
        for use in wire_name_uses(path)
    ]
    assert offenders == []


# ---------------------------------------------------------------- 응답 계약


def test_kev_response_has_contract_keys_only(make_client):
    result = post(make_client(), kev_request("FX-03"))
    assert set(result) == {"kev", "stateHash", "requirements", "wire", "errorCode", "timings"}
    assert set(result["timings"]) == {"kevMs"}


def test_kev_assist_has_exact_field_set_without_rule_results(make_client):
    # FX-03: Kev 는 BID 를 내지만 규칙 결과(권고·점수·자격 판정)를 담을 자리가 응답에 없다
    kev = post(make_client(), kev_request("FX-03"))["kev"]
    assert set(kev) == KEV_ASSIST_KEYS


def test_fx03_kev_suggests_bid_against_rules(make_client):
    assert post(make_client(), kev_request("FX-03"))["kev"]["suggestedOption"] == "BID"


@pytest.mark.parametrize("fixture_id", sorted(KEV_FIXTURE_CASES))
def test_kev_fixture_values_map_to_kev_assist(make_client, fixture_id):
    kev = post(make_client(), kev_request(fixture_id))["kev"]
    expected = KEV_FIXTURE_CASES[fixture_id]
    assert kev_tuple(kev) == expected[:5]
    assert kev["fit"] == {"score": expected[5], "legend": LEGEND}


def test_fx02_full_kev_assist(make_client):
    kev = post(make_client(), kev_request("FX-02"))["kev"]
    assert kev == {
        "enabled": True,
        "provider": "mock",
        "model": "mock",
        "questionSetVersion": "kev-qs/v0.1",
        "suggestedOption": "WATCH",
        "probabilities": {"BID": 0.36, "WATCH": 0.52, "NO_BID": 0.12},
        "confidence": 0.52,
        "mandatoryRisk": 0.1,
        "needsHumanReview": 0.74,
        "fit": {"score": 2.2, "legend": LEGEND},
        "scores": None,
        "risks": None,
        "calibration": None,
        "stateTrace": None,
        "latencyMs": 0,
        "requestId": None,
        "disclaimer": KEV_DISCLAIMER,
    }


@pytest.mark.parametrize("fixture_id", sorted(KEV_FIXTURE_CASES))
def test_kev_wire_is_fixture_response_without_envelope(make_client, fixture_id):
    fixture = kev_fixture(fixture_id)
    result = post(make_client(), kev_request(fixture_id))
    assert result["wire"] == [
        {
            "responses": fixture["responses"],
            "usage": fixture["usage"],
            "latency_ms": fixture["latency_ms"],
        }
    ]


def test_kev_requirements_is_null_for_v0_1(make_client):
    assert post(make_client(), kev_request("FX-01"))["requirements"] is None


def test_kev_disclaimer_is_exact(make_client):
    assert post(make_client(), kev_request("FX-01"))["kev"]["disclaimer"] == KEV_DISCLAIMER


def test_mock_answers_v0_1_even_when_v0_2_requested(make_client):
    request = kev_request("FX-01", questionSetVersion="kev-qs/v0.2")
    kev = post(make_client(), request)["kev"]
    assert (kev["questionSetVersion"], kev["scores"], kev["risks"], kev["calibration"]) == (
        "kev-qs/v0.1",
        None,
        None,
        None,
    )


def test_k5_kev_fx02_r01_falls_back_to_base_kev_file(make_client):
    kev = post(make_client(), kev_request("FX-02.r01"))["kev"]
    assert kev_tuple(kev) == KEV_FIXTURE_CASES["FX-02"][:5]


def test_kev_state_hash_is_sha256_hex(make_client):
    state_hash = post(make_client(), kev_request("FX-01"))["stateHash"]
    assert re.fullmatch("[0-9a-f]{64}", state_hash)


def test_kev_error_code_is_null_when_healthy(make_client):
    assert post(make_client(), kev_request("FX-01"))["errorCode"] is None


def test_kev_is_deterministic_except_timings(make_client):
    client = make_client()
    first = post(client, kev_request("FX-02"))
    second = post(client, kev_request("FX-02"))
    assert canonical(without_timings(first)) == canonical(without_timings(second))


def test_g4_kev_response_has_no_win_probability_phrase_besides_disclaimer(make_client):
    text = json.dumps(post(make_client(), kev_request("FX-03")), ensure_ascii=False)
    assert WIN_PROBABILITY.findall(text.replace(KEV_DISCLAIMER, "")) == []


# ---------------------------------------------------------------- 공식 경로 (fixtures/kev 파일 없음)


def formula_extraction(qualifications: dict) -> dict:
    extraction = extraction_fixture("FX-01")
    extraction["qualifications"] = qualifications
    return extraction


def known_qualifications(*items: tuple) -> dict:
    return {
        "value": [
            {"name": name, "kind": "CERTIFICATION", "mandatory": mandatory, "code": code}
            for name, code, mandatory in items
        ],
        "state": "KNOWN",
        "evidence": [text_ref(f"참가 자격은 {name} 보유 업체") for name, _, _ in items],
    }


def formula_fixtures(custom_fixtures, kev: dict[str, dict] | None = None):
    """kev/ 에 파일이 없거나 주어진 것만 있는 시험 디렉터리. extractions/ 에는 실제 FX-01 추출을 둔다.

    mock 은 추출 fixture 가 하나도 없으면 기동을 거부한다(K13). 그 검사를 피하는 것이 아니라 실제와 같은
    model 블록을 가진 추출 fixture 를 둬서 정상 디렉터리로 만든다.
    """
    return custom_fixtures({"FX-01": extraction_fixture("FX-01")}, kev)


FORMULA_CASES = {
    "mandatory_code_not_held": (
        known_qualifications(("정보통신공사업 등록", "ICT_CONSTRUCTION", True)),
        FORMULA_NO_BID,
    ),
    "qualifications_unknown": ({"value": None, "state": "UNKNOWN", "evidence": []}, FORMULA_WATCH),
    "qualifications_conflicted": (
        {
            "value": None,
            "state": "CONFLICTED",
            "evidence": [text_ref("참가 자격 가 보유 업체"), text_ref("참가 자격 나 보유 업체")],
        },
        FORMULA_WATCH,
    ),
    "mandatory_code_null": (known_qualifications(("건설업 면허", None, True)), FORMULA_WATCH),
    "mandatory_codes_held": (
        known_qualifications(("소프트웨어사업자 신고확인서", "SW_BUSINESS_REG", True)),
        FORMULA_BID,
    ),
    "optional_code_not_held": (
        known_qualifications(
            ("소프트웨어사업자 신고확인서", "SW_BUSINESS_REG", True), ("CSAP 인증", "CSAP", False)
        ),
        FORMULA_BID,
    ),
}


@pytest.mark.parametrize("case", sorted(FORMULA_CASES))
def test_kev_formula_without_fixture_file(make_client, custom_fixtures, case):
    qualifications, expected = FORMULA_CASES[case]
    formula_fixtures(custom_fixtures)  # kev/ 가 빈 시험 디렉터리 → FX-05 파일 없음
    request = kev_request("FX-05", extraction=formula_extraction(qualifications))
    assert kev_tuple(post(make_client(), request)["kev"]) == expected


def test_kev_formula_fit_is_two_with_five_grade_legend(make_client, custom_fixtures):
    formula_fixtures(custom_fixtures)
    kev = post(make_client(), kev_request("FX-05"))["kev"]
    assert kev["fit"] == {"score": 2.0, "legend": LEGEND}


def test_kev_formula_is_marked_mock(make_client, custom_fixtures):
    formula_fixtures(custom_fixtures)
    kev = post(make_client(), kev_request("FX-05"))["kev"]
    assert (kev["enabled"], kev["provider"], kev["questionSetVersion"]) == (
        True,
        "mock",
        "kev-qs/v0.1",
    )


def test_kev_formula_wire_has_fixture_shape(make_client, custom_fixtures):
    formula_fixtures(custom_fixtures)
    request = kev_request(
        "FX-05", extraction=formula_extraction(FORMULA_CASES["mandatory_code_not_held"][0])
    )
    wire = post(make_client(), request)["wire"]
    assert len(wire) == 1
    assert set(wire[0]) == {"responses", "usage", "latency_ms"}
    assert set(wire[0]["responses"]) == set(QUESTION_SET)
    assert (
        wire[0]["responses"]["recommendation"]["choice"],
        wire[0]["responses"]["recommendation"]["probabilities"],
    ) == ("NO_BID", FORMULA_NO_BID[1])


def test_kev_without_fixture_id_uses_formula(make_client):
    request = kev_request(
        None, extraction=formula_extraction(FORMULA_CASES["mandatory_codes_held"][0])
    )
    assert "fixtureId" not in request
    assert kev_tuple(post(make_client(), request)["kev"]) == FORMULA_BID


# ---------------------------------------------------------------- K5' fixtureId 대체 규칙(/kev)


def test_k5_kev_revision_without_any_file_uses_formula(make_client, custom_fixtures):
    formula_fixtures(custom_fixtures)
    # FX-05 추출은 qualifications UNKNOWN → 공식 WATCH 중심
    assert kev_tuple(post(make_client(), kev_request("FX-05.r01"))["kev"]) == FORMULA_WATCH


def test_k5_kev_revision_file_is_preferred_over_base(make_client, custom_fixtures):
    formula_fixtures(
        custom_fixtures, {"FX-02": kev_fixture("FX-02"), "FX-02.r01": kev_fixture("FX-16")}
    )
    kev = post(make_client(), kev_request("FX-02.r01"))["kev"]
    assert kev_tuple(kev) == KEV_FIXTURE_CASES["FX-16"][:5]


@pytest.mark.parametrize(
    "fixture_id", ["../kev/FX-02", "FX-02.r1", "FX-2", "FX-02.r001", "FX-02.json"]
)
def test_k5_kev_fixture_id_outside_format_uses_formula(make_client, custom_fixtures, fixture_id):
    formula_fixtures(custom_fixtures, {"FX-02": kev_fixture("FX-02")})
    request = kev_request(
        fixture_id, extraction=formula_extraction(FORMULA_CASES["mandatory_codes_held"][0])
    )
    assert kev_tuple(post(make_client(), request)["kev"]) == FORMULA_BID


@pytest.mark.parametrize(
    "fixture_id", ["FX-\u0660\u0662", "FX-\uff10\uff12"], ids=["arabic_indic", "fullwidth"]
)
def test_kev_fixture_id_with_non_ascii_digits_uses_formula(
    make_client, custom_fixtures, fixture_id
):
    # 같은 이름의 kev 파일(FX-02 값)을 실제로 둔다. 열면 FX-02 값, 안 열면 공식
    formula_fixtures(
        custom_fixtures, {"FX-02": kev_fixture("FX-02"), fixture_id: kev_fixture("FX-02")}
    )
    request = kev_request(
        fixture_id, extraction=formula_extraction(FORMULA_CASES["mandatory_codes_held"][0])
    )
    assert kev_tuple(post(make_client(), request)["kev"]) == FORMULA_BID


def test_mock_kev_fixture_with_nan_probability_is_unavailable(make_client, custom_fixtures):
    # mock 은 fixture 파일을 표준 json 으로 읽어 NaN 이 들어온다. wire 값 검증(유한수·범위)이 막아야 한다
    bad = kev_fixture("FX-02")
    bad["responses"]["recommendation"]["probabilities"]["BID"] = float("nan")
    formula_fixtures(custom_fixtures, {"FX-02": bad})
    result = post(make_client(), kev_request("FX-02"))
    assert (result["kev"]["enabled"], result["errorCode"], result["wire"]) == (
        False,
        "KEV_UNAVAILABLE",
        None,
    )


# ---------------------------------------------------------------- Kev 생략 판정 순서(e8)
# ko 거부(422) → KEV_ENABLED=false(errorCode null) → 장애 주입(KEV_UNAVAILABLE) → 인젝션 의심(INJECTION_SUSPECTED)


def injected_extraction() -> dict:
    extraction = extraction_fixture("FX-01")
    extraction["injectionSuspected"] = True
    return extraction


def skipped(result: dict) -> tuple:
    rest = {k: v for k, v in result["kev"].items() if k not in ("enabled", "disclaimer")}
    return (
        result["kev"]["enabled"],
        result["errorCode"],
        result["stateHash"],
        result["wire"],
        rest == dict.fromkeys(KEV_ASSIST_KEYS - {"enabled", "disclaimer"}),
    )


def test_injection_suspected_extraction_skips_kev_in_mock(make_client):
    request = kev_request("FX-01", extraction=injected_extraction())
    assert skipped(post(make_client(), request)) == (False, "INJECTION_SUSPECTED", None, None, True)


def test_kev_fault_wins_over_injection_suspected(make_client, monkeypatch):
    monkeypatch.setenv("AI_FAULT_INJECT", "kev_timeout")
    request = kev_request("FX-01", extraction=injected_extraction())
    assert skipped(post(make_client(), request))[1] == "KEV_UNAVAILABLE"


def test_kev_disabled_wins_over_fault_and_injection(make_client, monkeypatch):
    monkeypatch.setenv("KEV_ENABLED", "false")
    monkeypatch.setenv("AI_FAULT_INJECT", "kev_timeout")
    request = kev_request("FX-01", extraction=injected_extraction())
    assert skipped(post(make_client(), request)) == (False, None, None, None, True)


def test_korean_state_refusal_comes_before_every_skip(make_client, monkeypatch):
    monkeypatch.setenv("KEV_ENABLED", "false")
    monkeypatch.setenv("AI_FAULT_INJECT", "kev_timeout")
    request = kev_request("FX-01", extraction=injected_extraction(), stateLanguage="ko")
    response = make_client().post("/kev", json=request)
    assert (response.status_code, response.json()["errorCode"]) == (422, "KO_STATE_NOT_ALLOWED")


# ---------------------------------------------------------------- state 내용(한글 0자·규칙 결과 0개)


def state_hash(client, request: dict) -> str:
    return post(client, request)["stateHash"]


def test_rule_result_keys_in_request_do_not_change_response(make_client):
    client = make_client()
    plain = post(client, kev_request("FX-03"))
    request = kev_request(
        "FX-03", recommendation="NO_BID", score=68, qualificationStatus="NOT_SATISFIED"
    )
    request["profileSummary"]["recommendation"] = "BID"
    request["profileSummary"]["score"] = 99
    assert canonical(without_timings(post(client, request))) == canonical(without_timings(plain))


def _set_extraction(path: list, value):
    def change(request: dict) -> None:
        target = request["extraction"]
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return change


def _set_profile(path: list, value):
    def change(request: dict) -> None:
        target = request["profileSummary"]
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return change


# 한글 값만 다른 값으로 바꾼다. state 에 한글이 들어가지 않으면(→ (untranslated)·제외) stateHash 가 같다.
KOREAN_ONLY_CHANGES = {
    "required_skill_korean": _set_extraction(
        ["requiredSkills", "value", 3], "한국형 개발 프레임워크"
    ),
    "restriction_korean": _set_extraction(["restrictions", "value", 0], "지역 제한경쟁"),
    "staffing_role_korean": _set_extraction(["staffing", "value", 2, "role"], "개발자"),
    "summary_korean": _set_extraction(["summary", "value"], "다른 요약 문장이다."),
    "domain_korean": _set_extraction(["domain", "value"], "교육"),
    "company_name": _set_profile(["name"], "가상회사"),
    "profile_technology_korean": _set_profile(["technologies", 2, "name"], "국산 프레임워크"),
    "past_project_name": _set_profile(["pastProjects", 0, "name"], "다른 사업 이름"),
    "past_project_domain": _set_profile(["pastProjects", 0, "domain"], "교육"),
    "license_korean_name": _set_profile(["licenses", 0, "name"], "SW사업자 신고확인서"),
    "preferences_korean": _set_profile(["preferences", "domains", 0], "교통"),
}


@pytest.mark.parametrize("case", sorted(KOREAN_ONLY_CHANGES))
def test_korean_only_change_keeps_state_hash(make_client, case):
    client = make_client()
    base = kev_request("FX-01")
    changed = kev_request("FX-01")
    KOREAN_ONLY_CHANGES[case](changed)
    assert state_hash(client, changed) == state_hash(client, base)


# 대조군: state 에 들어가는 영어·숫자 값을 바꾸면 stateHash 가 달라진다(위 불변 시험이 공허하지 않음을 보인다)
STATE_CHANGES = {
    "required_skill_english": _set_extraction(["requiredSkills", "value", 0], "Python"),
    "budget": _set_extraction(["budgetKrw", "value"], "1300000000"),
    "profile_technology_english": _set_profile(["technologies", 0, "name"], "Go"),
    "license_status": _set_profile(["licenses", 7, "status"], "HELD"),
    "max_contract": _set_profile(["financials", "maxContractKrw"], "6000000000"),
    "available_fte": _set_profile(["staffAvailability", "availableFte"], 10),
}


@pytest.mark.parametrize("case", sorted(STATE_CHANGES))
def test_english_or_numeric_change_changes_state_hash(make_client, case):
    client = make_client()
    base = kev_request("FX-01")
    changed = kev_request("FX-01")
    STATE_CHANGES[case](changed)
    assert state_hash(client, changed) != state_hash(client, base)


def test_profile_revision_enters_state(make_client):
    # 요청 profileRevision 과 profileSummary.revision 중 어느 쪽을 쓰는지 명세가 정하지 않아 둘 다 바꾼다
    client = make_client()
    changed = kev_request("FX-01", profileRevision=3)
    changed["profileSummary"]["revision"] = 3
    assert state_hash(client, changed) != state_hash(client, kev_request("FX-01"))


def test_incomplete_attachments_enter_state(make_client):
    client = make_client()
    changed = kev_request("FX-01", attachmentsIncomplete=True)
    assert state_hash(client, changed) != state_hash(client, kev_request("FX-01"))


def test_kev_response_has_no_hangul_except_disclaimer(make_client):
    text = json.dumps(post(make_client(), kev_request("FX-01")), ensure_ascii=False)
    assert HANGUL.findall(text.replace(KEV_DISCLAIMER, "")) == []


# ---------------------------------------------------------------- stateLanguage (K9, 03 §5.11)


@pytest.mark.parametrize("allow", [None, "false"])
def test_korean_state_is_rejected_unless_allowed(make_client, monkeypatch, allow):
    if allow is not None:
        monkeypatch.setenv("KEV_ALLOW_KO_STATE", allow)
    response = make_client().post("/kev", json=kev_request("FX-01", stateLanguage="ko"))
    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"errorCode", "message"}
    assert body["errorCode"] == "KO_STATE_NOT_ALLOWED"
    assert isinstance(body["message"], str) and body["message"] != ""


def test_korean_state_is_built_when_allowed(make_client, monkeypatch):
    monkeypatch.setenv("KEV_ALLOW_KO_STATE", "true")
    client = make_client()
    korean = post(client, kev_request("FX-01", stateLanguage="ko"))["stateHash"]
    english = post(client, kev_request("FX-01"))["stateHash"]
    assert re.fullmatch("[0-9a-f]{64}", korean)
    assert korean != english


def test_request_shape_error_keeps_fastapi_default_422(make_client):
    request = kev_request("FX-01")
    del request["profileSummary"]
    response = make_client().post("/kev", json=request)
    assert (response.status_code, "detail" in response.json()) == (422, True)


# ---------------------------------------------------------------- Kev 꺼짐·timeout (03 §9, 명세 §2·K4)
# 실제 규칙 파일(infra/run-modes.json)은 세 모드 모두 KEV_ENABLED=["true","false"] 다(2026-10-19 사용자 확정).
# 03 §9 "KEV_ENABLED=false 와 Kev timeout 두 경우" 의 gateway 쪽 결과를 같은 묶음으로 본다.
# 둘 다 /kev 200·kev.enabled=false. false 는 errorCode null, timeout 은 KEV_UNAVAILABLE.

KEV_OFF_CASES = {
    "kev_enabled_false": ({"KEV_ENABLED": "false"}, None),
    "kev_timeout": ({"AI_FAULT_INJECT": "kev_timeout"}, "KEV_UNAVAILABLE"),
}


def kev_off_response(make_client, monkeypatch, case: str):
    env, _ = KEV_OFF_CASES[case]
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return make_client(SOL_RUN_MODE="mock").post("/kev", json=kev_request("FX-01"))


@pytest.mark.parametrize("case", sorted(KEV_OFF_CASES))
def test_section9_kev_off_returns_200_with_kev_disabled(make_client, monkeypatch, case):
    response = kev_off_response(make_client, monkeypatch, case)
    assert response.status_code == 200
    assert (response.json()["kev"]["enabled"], response.json()["errorCode"]) == (
        False,
        KEV_OFF_CASES[case][1],
    )


@pytest.mark.parametrize("case", sorted(KEV_OFF_CASES))
def test_section9_kev_off_leaves_only_disclaimer_in_assist(make_client, monkeypatch, case):
    kev = kev_off_response(make_client, monkeypatch, case).json()["kev"]
    assert kev["disclaimer"] == KEV_DISCLAIMER
    assert {k: v for k, v in kev.items() if k not in ("enabled", "disclaimer")} == dict.fromkeys(
        KEV_ASSIST_KEYS - {"enabled", "disclaimer"}
    )


@pytest.mark.parametrize("case", sorted(KEV_OFF_CASES))
def test_section9_kev_off_has_no_state_wire_or_requirements(make_client, monkeypatch, case):
    result = kev_off_response(make_client, monkeypatch, case).json()
    assert (result["stateHash"], result["wire"], result["requirements"]) == (None, None, None)


def test_real_rules_start_mock_with_kev_disabled(make_client, monkeypatch):
    monkeypatch.setenv("KEV_ENABLED", "false")
    body = make_client(SOL_RUN_MODE="mock").get("/health").json()
    assert (body["kevEnabled"], body["kev"]) == (False, None)
