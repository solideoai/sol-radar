"""G9: 인용 검증(15 §5, 명세 §1 "인용 검증", K1·K2).

앞부분은 공개 함수 `sol_ai.citation.norm`·`verify_citation` 단위 시험이고,
뒷부분은 `/extract` 가 필드 단위로 적용하는 결과(오프셋·경고·K1 전이·EXTRACTION_LOW_CONFIDENCE)를 본다.
"""

import importlib

import pytest
from support import bid_body, extract_request, extraction_fixture, text_ref


# 공개 함수는 시험 안에서 불러온다. 모듈이 없을 때 수집 오류로 전체 실행이 멈추지 않고 시험마다 실패하게 한다.
def norm(s: str) -> str:
    return importlib.import_module("sol_ai.citation").norm(s)


def verify_citation(*args, **kwargs):
    return importlib.import_module("sol_ai.citation").verify_citation(*args, **kwargs)


# 퍼지 시험용 원문. 앞 50·100자를 잘라 쓴다. 치환 문자 "Ж" 는 원문에 없다.
BASE = (
    "제안사는 사업 착수 후 삼십일 이내에 상세 설계서와 데이터 이관 계획서, 보안 점검표를 함께 "
    "제출하여야 하며 발주기관 감리 의견을 반영한 수정본을 열흘 안에 다시 내야 한다. 또한 월간 보고를 한다"
)
Q50 = BASE[:50]
Q100 = BASE[:100]
SUB = "Ж"


def substitute(text: str, positions: list[int]) -> str:
    chars = list(text)
    for position in positions:
        chars[position] = SUB
    return "".join(chars)


def summary(result) -> tuple:
    return (result.match, result.char_start, result.char_end, result.reason, list(result.notes))


# ---------------------------------------------------------------- norm (15 §5.1)


def test_norm_applies_nfkc_to_fullwidth_brackets_quotes_and_letters():
    assert norm("（필수）＂인증＂，ＡＢＣ１２３") == '(필수)"인증",ABC123'


def test_norm_removes_zero_width_characters():
    assert norm("사\u200b업\u200c예\u200d산\ufeff") == "사업예산"


def test_norm_collapses_whitespace_runs_to_one_space():
    assert norm("가  나\n\t다\r\n라") == "가 나 다 라"


def test_norm_trims_leading_and_trailing_whitespace():
    assert norm("  \n 가나 \t ") == "가나"


def test_norm_keeps_commas_between_digits():
    assert norm("사업예산 450,000,000원") == "사업예산 450,000,000원"


def test_norm_turns_fullwidth_digits_and_comma_into_ascii():
    assert norm("４５０，０００") == "450,000"


def test_norm_turns_ideographic_space_into_single_space():
    assert norm("가\u3000\u3000나") == "가 나"


def test_norm_removes_zero_width_before_collapsing_spaces():
    assert norm("가 \u200b 나") == "가 나"


def test_norm_is_idempotent():
    text = "  （가）\u200b  나\n\n다 ４５０，０００  "
    assert norm(norm(text)) == norm(text)


# ---------------------------------------------------------------- verify_citation (15 §5.2)

DOC = "본 사업은 행정 데이터 통합 플랫폼을 구축한다. 사업예산은 12억원이다. 제출은 나라장터로 한다."


def test_exact_when_offsets_match_quote():
    quote = "사업예산은 12억원이다"
    start = DOC.find(quote)
    result = verify_citation(quote, DOC, char_start=start, char_end=start + len(quote))
    assert summary(result) == ("EXACT", start, start + len(quote), None, [])


def test_exact_offsets_are_measured_on_normalized_document():
    raw = "본 사업은  행정 데이터\n\n통합 플랫폼을 구축한다. 사업예산은 12억원이다."
    quote = "사업예산은 12억원이다"
    start = norm(raw).find(quote)
    assert start != raw.find(quote)  # 전제: 원문과 정규화 오프셋이 다르다
    result = verify_citation(quote, raw, char_start=start, char_end=start + len(quote))
    assert summary(result) == ("EXACT", start, start + len(quote), None, [])


def test_wrong_offsets_fall_back_to_normalized_with_found_offsets():
    quote = "사업예산은 12억원이다"
    start = DOC.find(quote)
    result = verify_citation(quote, DOC, char_start=start + 1, char_end=start + 1 + len(quote))
    assert summary(result) == ("NORMALIZED", start, start + len(quote), None, [])


def test_normalized_when_found_once_without_offsets():
    quote = "사업예산은 12억원이다"
    start = DOC.find(quote)
    assert summary(verify_citation(quote, DOC)) == (
        "NORMALIZED",
        start,
        start + len(quote),
        None,
        [],
    )


def test_normalized_after_normalizing_fullwidth_and_spacing_in_quote():
    quote = "사업예산은  １２억원이다"
    expected = "사업예산은 12억원이다"
    start = DOC.find(expected)
    assert summary(verify_citation(quote, DOC)) == (
        "NORMALIZED",
        start,
        start + len(expected),
        None,
        [],
    )


def test_multiple_occurrences_reports_first_position_and_note():
    doc = "참가 자격은 중소기업이다. 다시 말해 참가 자격은 중소기업이다."
    quote = "참가 자격은 중소기업이다"
    assert summary(verify_citation(quote, doc)) == (
        "NORMALIZED",
        0,
        len(quote),
        None,
        ["MULTIPLE_OCCURRENCES"],
    )


def test_multiple_occurrences_counts_overlapping_matches():
    doc = "아아아아아아"
    result = verify_citation("아아아아아", doc)
    assert summary(result) == ("NORMALIZED", 0, 5, None, ["MULTIPLE_OCCURRENCES"])


def test_fuzzy_when_one_substitution_in_fifty_chars():
    doc = "머리말 " + Q50 + " 맺음말"
    quote = substitute(Q50, [25])
    start = doc.find(Q50)
    assert summary(verify_citation(quote, doc)) == ("FUZZY", start, start + 50, None, [])


def test_fuzzy_just_above_default_threshold():
    # 100자 중 7자 치환 → ratio 0.93 ≥ 0.92
    doc = "머리말 " + Q100 + " 맺음말"
    quote = substitute(Q100, [12, 24, 36, 48, 60, 72, 84])
    start = doc.find(Q100)
    assert summary(verify_citation(quote, doc)) == ("FUZZY", start, start + 100, None, [])


def test_failed_just_below_default_threshold():
    # 100자 중 9자 치환 → ratio 0.91 < 0.92
    doc = "머리말 " + Q100 + " 맺음말"
    quote = substitute(Q100, [10, 20, 30, 40, 50, 60, 70, 80, 90])
    assert summary(verify_citation(quote, doc)) == ("FAILED", None, None, "NOT_FOUND", [])


def test_fuzzy_min_ratio_argument_raises_threshold():
    # 50자 중 3자 치환 → ratio 0.94. 임계 0.95 면 실패
    doc = "머리말 " + Q50 + " 맺음말"
    quote = substitute(Q50, [10, 25, 40])
    assert verify_citation(quote, doc).match == "FUZZY"
    assert summary(verify_citation(quote, doc, fuzzy_min_ratio=0.95)) == (
        "FAILED",
        None,
        None,
        "NOT_FOUND",
        [],
    )


def test_fuzzy_tie_prefers_earlier_start():
    first = substitute(Q50, [20])
    second = substitute(Q50, [30])
    doc = "앞 " + first + " 가운데 " + second + " 끝"
    result = verify_citation(Q50, doc)
    start = doc.find(first)
    assert summary(result) == ("FUZZY", start, start + 50, None, [])


def test_fuzzy_tie_at_same_start_prefers_length_closest_to_quote():
    # 마지막 글자만 다른 인용: 길이 49 창(삭제 1)과 50 창(치환 1)이 같은 ratio → 50
    quote = Q50[:-1] + SUB
    doc = "앞 " + Q50 + " 끝"
    start = doc.find(Q50)
    assert summary(verify_citation(quote, doc)) == ("FUZZY", start, start + 50, None, [])


def test_failed_not_found_when_absent():
    assert summary(verify_citation("정보통신공사업 등록업체", DOC)) == (
        "FAILED",
        None,
        None,
        "NOT_FOUND",
        [],
    )


def test_fx13_failed_quote_is_not_found():
    quote = extraction_fixture("FX-13")["qualifications"]["evidence"][0]["quotedText"]
    assert summary(verify_citation(quote, bid_body("FX-13"))) == (
        "FAILED",
        None,
        None,
        "NOT_FOUND",
        [],
    )


def test_quote_of_four_chars_fails_with_quote_length():
    assert summary(verify_citation("사업예산", DOC)) == ("FAILED", None, None, "QUOTE_LENGTH", [])


def test_quote_of_five_chars_is_accepted():
    start = DOC.find("사업예산은")
    assert verify_citation("사업예산은", DOC).match == "NORMALIZED"
    assert verify_citation("사업예산은", DOC).char_start == start


def test_quote_length_is_measured_after_norm():
    assert verify_citation(" 사업\u200b예산 ", DOC).reason == "QUOTE_LENGTH"


def test_quote_of_300_chars_is_accepted():
    quote = "가나다라마" * 60
    assert verify_citation(quote, quote + ".").match == "NORMALIZED"


def test_quote_of_301_chars_fails_with_quote_length():
    quote = "가나다라마" * 60 + "가"
    assert summary(verify_citation(quote, quote + ".")) == (
        "FAILED",
        None,
        None,
        "QUOTE_LENGTH",
        [],
    )


def test_missing_document_fails_with_document_unavailable():
    assert summary(verify_citation("사업예산은 12억원이다", None)) == (
        "FAILED",
        None,
        None,
        "DOCUMENT_UNAVAILABLE",
        [],
    )


PAGE1 = "제1장 사업 개요. 본 사업은 데이터 플랫폼을 구축한다."
PAGE2 = "제2장 참가 자격. 소프트웨어사업자 신고확인서를 보유하여야 한다."
PAGED_DOC = PAGE1 + " " + PAGE2
PAGES = [{"page": 1, "charOffset": 0}, {"page": 2, "charOffset": len(PAGE1) + 1}]
PAGED_QUOTE = "소프트웨어사업자 신고확인서를 보유하여야 한다"


def test_page_hit_returns_absolute_offsets_without_note():
    start = PAGED_DOC.find(PAGED_QUOTE)
    result = verify_citation(PAGED_QUOTE, PAGED_DOC, page=2, pages=PAGES)
    assert summary(result) == ("NORMALIZED", start, start + len(PAGED_QUOTE), None, [])


def test_wrong_page_retries_whole_document_with_page_mismatch():
    start = PAGED_DOC.find(PAGED_QUOTE)
    result = verify_citation(PAGED_QUOTE, PAGED_DOC, page=1, pages=PAGES)
    assert summary(result) == (
        "NORMALIZED",
        start,
        start + len(PAGED_QUOTE),
        None,
        ["PAGE_MISMATCH"],
    )


def test_unknown_page_searches_whole_document_with_page_mismatch():
    start = PAGED_DOC.find(PAGED_QUOTE)
    result = verify_citation(PAGED_QUOTE, PAGED_DOC, page=5, pages=PAGES)
    assert summary(result) == (
        "NORMALIZED",
        start,
        start + len(PAGED_QUOTE),
        None,
        ["PAGE_MISMATCH"],
    )


def test_exact_inside_page_uses_absolute_offsets():
    start = PAGED_DOC.find(PAGED_QUOTE)
    result = verify_citation(
        PAGED_QUOTE,
        PAGED_DOC,
        char_start=start,
        char_end=start + len(PAGED_QUOTE),
        page=2,
        pages=PAGES,
    )
    assert summary(result) == ("EXACT", start, start + len(PAGED_QUOTE), None, [])


def test_page_scope_limits_occurrence_count():
    repeated = "소프트웨어사업자 신고확인서를 보유하여야 한다."
    doc = "제1장. " + repeated + " 제2장. " + repeated
    pages = [{"page": 1, "charOffset": 0}, {"page": 2, "charOffset": doc.find("제2장")}]
    quote = repeated[:-1]
    second = doc.find(quote, doc.find("제2장"))
    result = verify_citation(quote, doc, page=2, pages=pages)
    assert summary(result) == ("NORMALIZED", second, second + len(quote), None, [])


LONG_FILLER = "x" * 210_000


def test_long_document_finds_exact_text():
    doc = LONG_FILLER + Q50 + LONG_FILLER[:100]
    assert summary(verify_citation(Q50, doc)) == (
        "NORMALIZED",
        210_000,
        210_050,
        None,
        [],
    )


def test_long_document_fuzzy_searches_near_quote_prefix():
    doc = LONG_FILLER + Q50 + LONG_FILLER[:100]
    quote = substitute(Q50, [30])  # 앞 20자는 원문과 같다
    assert summary(verify_citation(quote, doc)) == ("FUZZY", 210_000, 210_050, None, [])


def test_long_document_fails_when_quote_prefix_is_absent():
    # 앞 20자 안의 치환 → q[:20] 을 찾지 못해 창 탐색을 하지 않는다(15 §5.2, 명세 §1-4)
    doc = LONG_FILLER + Q50 + LONG_FILLER[:100]
    quote = substitute(Q50, [5])
    assert summary(verify_citation(quote, doc)) == ("FAILED", None, None, "NOT_FOUND", [])


def test_verify_citation_is_deterministic():
    doc = "머리말 " + Q100 + " 맺음말"
    quote = substitute(Q100, [12, 24, 36])
    assert summary(verify_citation(quote, doc)) == summary(verify_citation(quote, doc))


# ---------------------------------------------------------------- /extract 필드 단위 적용


def post_extract(make_client, extraction: dict, custom_fixtures, **request) -> dict:
    custom_fixtures({"FX-01": extraction})
    response = make_client().post("/extract", json=extract_request("FX-01", **request))
    assert response.status_code == 200
    return response.json()


ATTACHMENT_PAGE1 = "제안요청서 1쪽. 사업 개요를 설명한다."
ATTACHMENT_PAGE2 = "제안요청서 2쪽. 백엔드는 NestJS, 데이터베이스는 PostgreSQL을 사용하여야 한다."
ATTACHMENT_TEXT = ATTACHMENT_PAGE1 + " " + ATTACHMENT_PAGE2
ATTACHMENT_QUOTE = "백엔드는 NestJS, 데이터베이스는 PostgreSQL을 사용하여야 한다"
ATTACHMENT = {
    "documentId": "doc-rfp-1",
    "text": ATTACHMENT_TEXT,
    "pages": [{"page": 1, "charOffset": 0}, {"page": 2, "charOffset": len(ATTACHMENT_PAGE1) + 1}],
}


def with_attachment_skills(page: int) -> dict:
    extraction = extraction_fixture("FX-01")
    extraction["requiredSkills"] = {
        "value": ["NestJS", "PostgreSQL"],
        "state": "KNOWN",
        "evidence": [text_ref(ATTACHMENT_QUOTE, document_id="doc-rfp-1", page=page)],
        "note": "[0],[1]→evidence[0]",
    }
    return extraction


def test_attachment_ref_gets_absolute_offsets_in_attachment_text(make_client, custom_fixtures):
    result = post_extract(
        make_client, with_attachment_skills(page=2), custom_fixtures, attachments=[ATTACHMENT]
    )
    ref = result["payload"]["requiredSkills"]["evidence"][0]
    start = ATTACHMENT_TEXT.find(ATTACHMENT_QUOTE)
    assert (ref["match"], ref["charStart"], ref["charEnd"]) == (
        "NORMALIZED",
        start,
        start + len(ATTACHMENT_QUOTE),
    )


def test_attachment_ref_on_wrong_page_adds_page_mismatch_warning(make_client, custom_fixtures):
    result = post_extract(
        make_client, with_attachment_skills(page=1), custom_fixtures, attachments=[ATTACHMENT]
    )
    assert result["warnings"] == ["PAGE_MISMATCH"]


def test_ref_to_unknown_document_fails_and_unknowns_field(make_client, custom_fixtures):
    result = post_extract(make_client, with_attachment_skills(page=2), custom_fixtures)
    field = result["payload"]["requiredSkills"]
    assert (field["value"], field["state"], field["note"], field["evidence"][0]["match"]) == (
        None,
        "UNKNOWN",
        "CITATION_FAILED",
        "FAILED",
    )
    assert result["warnings"] == ["CITATION_FAILED:requiredSkills"]


def test_api_field_ref_from_model_is_failed(make_client, custom_fixtures):
    extraction = extraction_fixture("FX-01")
    ref = extraction["domain"]["evidence"][0]
    ref.update({"kind": "API_FIELD", "apiField": "ntceInsttNm", "apiSource": "g2b-bid-notice"})
    result = post_extract(make_client, extraction, custom_fixtures)
    field = result["payload"]["domain"]
    assert (field["state"], field["evidence"][0]["match"]) == ("UNKNOWN", "FAILED")
    assert result["warnings"] == ["CITATION_FAILED:domain"]


def test_duplicate_quote_in_body_adds_multiple_occurrences_warning(make_client, custom_fixtures):
    body = bid_body("FX-01") + " 사업 분야는 민원"
    result = post_extract(make_client, extraction_fixture("FX-01"), custom_fixtures, body=body)
    ref = result["payload"]["domain"]["evidence"][0]
    assert (ref["match"], ref["charStart"]) == ("NORMALIZED", body.find("사업 분야는 민원"))
    assert result["warnings"] == ["MULTIPLE_OCCURRENCES"]


def fuzzy_domain_extraction() -> dict:
    """domain 인용을 50자로 늘리고 3자를 바꾼다(ratio 0.94)."""
    extraction = extraction_fixture("FX-01")
    extraction["domain"]["evidence"][0]["quotedText"] = substitute(Q50, [10, 25, 40])
    return extraction


def test_extract_accepts_fuzzy_quote_at_default_threshold(make_client, custom_fixtures):
    body = bid_body("FX-01") + " " + Q50
    result = post_extract(make_client, fuzzy_domain_extraction(), custom_fixtures, body=body)
    field = result["payload"]["domain"]
    assert (field["state"], field["evidence"][0]["match"]) == ("KNOWN", "FUZZY")


def test_extract_reads_citation_threshold_from_env(make_client, custom_fixtures, monkeypatch):
    monkeypatch.setenv("CITATION_FUZZY_MIN_RATIO", "0.95")
    body = bid_body("FX-01") + " " + Q50
    result = post_extract(make_client, fuzzy_domain_extraction(), custom_fixtures, body=body)
    field = result["payload"]["domain"]
    assert (field["state"], field["evidence"][0]["match"]) == ("UNKNOWN", "FAILED")


def test_failed_ref_drops_only_its_array_element(make_client, custom_fixtures):
    body = bid_body("FX-01").replace("중소기업확인서를 보유한 업체", "중소기업 확인 서류를 낸 업체")
    result = post_extract(make_client, extraction_fixture("FX-01"), custom_fixtures, body=body)
    field = result["payload"]["qualifications"]
    assert field["state"] == "KNOWN"
    assert [q["name"] for q in field["value"]] == [
        "소프트웨어사업자 신고확인서",
        "소프트웨어 직접생산확인증명서",
    ]
    assert [ref["match"] for ref in field["evidence"]] == ["NORMALIZED", "NORMALIZED", "FAILED"]


def preferred_with_one_bad_ref(note: str | None) -> dict:
    extraction = extraction_fixture("FX-01")
    field = extraction["preferredSkills"]
    field["evidence"] = [
        text_ref("우대 기술은 Elasticsearch, Kafka 이다"),
        text_ref("우대 기술은 Redis 이다"),
    ]
    if note is None:
        field.pop("note")
    else:
        field["note"] = note
    return extraction


def test_mapped_element_with_failed_ref_is_dropped(make_client, custom_fixtures):
    extraction = preferred_with_one_bad_ref("[0]→evidence[0], [1]→evidence[1]")
    result = post_extract(make_client, extraction, custom_fixtures)
    field = result["payload"]["preferredSkills"]
    assert (field["state"], field["value"]) == ("KNOWN", ["Elasticsearch"])


def test_elements_are_kept_when_note_has_no_mapping(make_client, custom_fixtures):
    result = post_extract(make_client, preferred_with_one_bad_ref(None), custom_fixtures)
    field = result["payload"]["preferredSkills"]
    assert (field["state"], field["value"]) == ("KNOWN", ["Elasticsearch", "Kafka"])
    assert [ref["match"] for ref in field["evidence"]] == ["NORMALIZED", "FAILED"]


def test_conflicted_field_with_all_refs_failed_becomes_unknown(make_client, custom_fixtures):
    extraction = extraction_fixture("FX-01")
    extraction["budgetKrw"] = {
        "value": None,
        "state": "CONFLICTED",
        "evidence": [text_ref("사업예산은 13억원"), text_ref("총 사업비 14억원")],
        "note": "본문 13억원 vs 첨부 14억원",
    }
    result = post_extract(make_client, extraction, custom_fixtures)
    field = result["payload"]["budgetKrw"]
    assert (field["value"], field["state"], field["note"]) == (None, "UNKNOWN", "CITATION_FAILED")
    assert "CITATION_FAILED:budgetKrw" in result["warnings"]


def test_not_applicable_field_keeps_state_when_ref_fails(make_client, custom_fixtures):
    extraction = extraction_fixture("FX-01")
    extraction["restrictions"] = {
        "value": None,
        "state": "NOT_APPLICABLE",
        "evidence": [text_ref("지역 제한 조항은 두지 않는다")],
    }
    result = post_extract(make_client, extraction, custom_fixtures)
    assert result["payload"]["restrictions"]["state"] == "NOT_APPLICABLE"
    assert "CITATION_FAILED:restrictions" not in result["warnings"]


# FX-01 에서 restrictions 를 빼면 ref 10개. 본문에 일부 인용만 남겨 FAILED 비율을 만든다.
Q_SUMMARY = (
    "세종특별자치시가 차세대 행정정보시스템 고도화 사업의 제안사를 모집한다"  # summary·projectType
)
Q_DOMAIN = "사업 분야는 민원"
Q_BUDGET = "사업예산은 12억원"
Q_STAFF = "PM 1명, PL 1명, 개발 10명으로 합계 12명"


def ten_ref_extraction() -> dict:
    extraction = extraction_fixture("FX-01")
    extraction["restrictions"] = {"value": None, "state": "UNKNOWN", "evidence": []}
    return extraction


def test_failed_ratio_above_half_sets_low_confidence_and_pending_review(
    make_client, custom_fixtures
):
    body = f"{Q_SUMMARY}. {Q_DOMAIN}. {Q_BUDGET}."  # 4개 통과, 6개 실패 = 60%
    result = post_extract(make_client, ten_ref_extraction(), custom_fixtures, body=body)
    assert result["status"] == "PENDING_REVIEW"
    assert "EXTRACTION_LOW_CONFIDENCE" in result["warnings"]


def test_failed_ratio_of_exactly_half_is_not_low_confidence(make_client, custom_fixtures):
    body = f"{Q_SUMMARY}. {Q_DOMAIN}. {Q_BUDGET}. {Q_STAFF}."  # 5개 통과, 5개 실패 = 50%
    result = post_extract(make_client, ten_ref_extraction(), custom_fixtures, body=body)
    assert result["status"] == "COMPLETED"
    assert "EXTRACTION_LOW_CONFIDENCE" not in result["warnings"]


@pytest.mark.parametrize("fixture_id", ["FX-01", "FX-13"])
def test_payload_warnings_equal_top_level_warnings(make_client, fixture_id):
    result = make_client().post("/extract", json=extract_request(fixture_id)).json()
    assert result["payload"]["warnings"] == result["warnings"]
    assert result["payload"]["injectionSuspected"] == result["injectionSuspected"]
