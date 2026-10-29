"""추천 분석(스펙 §4.3, 계획 C3): 모델 출력 검증·템플릿.

검증 순서는 JSON·모양 → 근거 번호 → 금지어 → 판정 이름 → 숫자다. 하나라도 걸리면 템플릿으로 대체하고 그 이유를 낸다.
"""

import copy
import json

import pytest
from support import insight_request

from sol_ai.contracts import InsightRequest
from sol_ai.insight import template_insight, validate_insight

# 입력 숫자(58·2026-12-01·20)와 요청 refs(B1·B2·C1·C2)만 쓴 모델 출력
MODEL_OUTPUT = {
    "summary": (
        "SOL Score 58점으로 규칙 엔진이 판정했습니다. 기술 적합도와 인력 가용은 충분하지만 "
        "정보통신공사업 등록이 없어 사람이 확인해야 합니다."
    ),
    "strengths": [
        {"text": "요구 기술 Java와 PostgreSQL을 이미 보유하고 있습니다.", "refIds": ["B1", "C1"]},
        {"text": "2026-12-01부터 투입할 수 있는 인력이 20명 있습니다.", "refIds": ["C2"]},
    ],
    "improvements": [
        {"text": "참가 자격인 정보통신공사업 등록을 확인해야 합니다.", "refIds": ["B2"]},
    ],
}


def request_model(recommendation: str = "WATCH", **changes) -> InsightRequest:
    return InsightRequest.model_validate(insight_request(recommendation, **changes))


def output(**changes) -> str:
    data = copy.deepcopy(MODEL_OUTPUT)
    data.update(changes)
    return json.dumps(data, ensure_ascii=False)


def reason_of(raw: str, recommendation: str = "WATCH") -> str | None:
    return validate_insight(raw, request_model(recommendation))[1]


def test_valid_model_output_passes():
    body, reason = validate_insight(output(), request_model())
    assert reason is None
    assert body is not None and body.model_dump() == MODEL_OUTPUT


@pytest.mark.parametrize(
    "changes",
    [
        {"summary": "수주 확률이 높은 공고입니다."},
        {"strengths": [{"text": "인력 여유는 20 ％ 입니다.", "refIds": ["C2"]}]},
    ],
)
def test_forbidden_word_falls_back(changes):
    assert reason_of(output(**changes)) == "FORBIDDEN_WORD"


def test_unknown_number_falls_back():
    assert reason_of(output(summary="사업 규모가 37억원이라 부담이 큽니다.")) == "UNKNOWN_NUMBER"


@pytest.mark.parametrize(
    "summary",
    [
        "판정은 비추천입니다.",
        "참여를 추천합니다.",
        "BID 로 볼 수 있습니다.",
        "NO_BID 에 가깝습니다.",
        "NO-BID 입니다.",
        "WATCH 입니다.",
    ],
)
def test_other_label_falls_back(summary):
    assert reason_of(output(summary=summary)) == "LABEL_CONFLICT"


def test_same_verdict_korean_label_passes():
    assert reason_of(output(summary="판정은 보류이며 자격을 확인해야 합니다.")) is None
    assert reason_of(output(summary="판정은 비추천이며 자격을 확인해야 합니다."), "NO_BID") is None


def test_unknown_ref_falls_back():
    improvements = [{"text": "참가 자격을 확인해야 합니다.", "refIds": ["B9"]}]
    assert reason_of(output(improvements=improvements)) == "UNKNOWN_REF"


@pytest.mark.parametrize(
    "raw",
    [
        output()[:-5],
        "[]",
        output(strengths=[{"text": "기술이 맞습니다.", "refIds": ["B1"]}] * 5),
        output(summary="가" * 401),
        output(improvements=[{"text": "  ", "refIds": []}]),
        output(improvements=[{"text": "확인해야 합니다.", "refIds": ["X1"]}]),
        output(recommendation="BID"),
    ],
    ids=["truncated", "not-object", "too-many", "too-long", "blank", "bad-ref-id", "extra-key"],
)
def test_broken_json_falls_back(raw):
    assert reason_of(raw) == "INVALID_OUTPUT"


def test_checks_run_in_contract_order():
    every_rule = {"summary": "수주 확률 37억 규모라 추천합니다."}
    unknown_ref = [{"text": "확인해야 합니다.", "refIds": ["B9"]}]
    assert reason_of(output(**every_rule, improvements=unknown_ref)) == "UNKNOWN_REF"
    assert reason_of(output(**every_rule)) == "FORBIDDEN_WORD"
    assert reason_of(output(summary="37억 규모라 추천합니다.")) == "LABEL_CONFLICT"


def labels(items) -> list[str]:
    return [item.text.partition(":")[0] for item in items]


@pytest.mark.parametrize("recommendation", ["BID", "WATCH", "NO_BID"])
def test_template_is_deterministic_and_clean(recommendation):
    request = request_model(recommendation)
    first = template_insight(request)
    assert template_insight(request) == first
    assert validate_insight(first.model_dump_json(), request) == (first, None)
    assert first.summary.startswith("SOL Score 58점. ")
    assert labels(first.strengths) == ["기술 적합도", "인력 가용", "전략 선호"]
    assert labels(first.improvements) == [
        "정보통신공사업 등록",
        "직접생산확인증명서",
        "유사 실적",
        "규모 적합",
    ]


def test_template_drops_items_that_break_output_rules():
    raw = insight_request()
    raw["rules"]["qualificationChecks"][1]["label"] = "추천서 제출"
    raw["rules"]["factors"][0]["reason"] = "수주 확률을 보지 않는다"
    request = InsightRequest.model_validate(raw)
    body = template_insight(request)
    assert validate_insight(body.model_dump_json(), request) == (body, None)
    assert labels(body.improvements)[0] == "직접생산확인증명서"
    assert body.strengths[0].text == "기술 적합도: 30점 중 24점."
