"""G9: 인용 검증(15 §5, 명세 §1 "인용 검증", K1·K2).

앞부분은 공개 함수 `sol_ai.citation.norm`·`verify_citation` 단위 시험이고,
뒷부분은 `/extract` 가 필드 단위로 적용하는 결과(오프셋·경고·K1 전이·EXTRACTION_LOW_CONFIDENCE)를 본다.
"""

import importlib

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


# ---------------------------------------------------------------- verify_citation (15 §5.2)

DOC = "본 사업은 행정 데이터 통합 플랫폼을 구축한다. 사업예산은 12억원이다. 제출은 나라장터로 한다."


def test_exact_when_offsets_match_quote():
    quote = "사업예산은 12억원이다"
    start = DOC.find(quote)
    result = verify_citation(quote, DOC, char_start=start, char_end=start + len(quote))
    assert summary(result) == ("EXACT", start, start + len(quote), None, [])


def test_failed_just_below_default_threshold():
    # 100자 중 9자 치환 → ratio 0.91 < 0.92
    doc = "머리말 " + Q100 + " 맺음말"
    quote = substitute(Q100, [10, 20, 30, 40, 50, 60, 70, 80, 90])
    assert summary(verify_citation(quote, doc)) == ("FAILED", None, None, "NOT_FOUND", [])


def test_failed_not_found_when_absent():
    assert summary(verify_citation("정보통신공사업 등록업체", DOC)) == (
        "FAILED",
        None,
        None,
        "NOT_FOUND",
        [],
    )


PAGE1 = "제1장 사업 개요. 본 사업은 데이터 플랫폼을 구축한다."
PAGE2 = "제2장 참가 자격. 소프트웨어사업자 신고확인서를 보유하여야 한다."
PAGED_DOC = PAGE1 + " " + PAGE2
PAGES = [{"page": 1, "charOffset": 0}, {"page": 2, "charOffset": len(PAGE1) + 1}]
PAGED_QUOTE = "소프트웨어사업자 신고확인서를 보유하여야 한다"


LONG_FILLER = "x" * 210_000


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


def fuzzy_domain_extraction() -> dict:
    """domain 인용을 50자로 늘리고 3자를 바꾼다(ratio 0.94)."""
    extraction = extraction_fixture("FX-01")
    extraction["domain"]["evidence"][0]["quotedText"] = substitute(Q50, [10, 25, 40])
    return extraction


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
