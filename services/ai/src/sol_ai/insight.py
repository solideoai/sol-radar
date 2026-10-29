"""POST /insight 추천 분석(스펙 §4.3, 계획 C3): 모델 출력 검증과 규칙 결과 템플릿.

판정(점수·권고)은 규칙 엔진 결과를 입력으로 받기만 한다. 모델 출력은 아래 순서로 검사하고, 하나라도 걸리면 그 이유와 함께
템플릿으로 대체한다(응답은 언제나 200).

1. JSON·모양(INVALID_OUTPUT): 표준 JSON 객체, 모르는 키 없음, 글자·개수 상한(InsightBody).
2. 근거 번호(UNKNOWN_REF): refIds 가 요청 refs 에 있다.
3. 금지어(FORBIDDEN_WORD): 승률·확률·가능성·수주 금액·점유율·경쟁사·%.
4. 판정 이름(LABEL_CONFLICT): 다른 판정의 한국어 이름(BID=추천·WATCH=보류·NO_BID=비추천)과 영문 판정 토큰.
5. 숫자(UNKNOWN_NUMBER): 문장의 숫자가 요청 JSON(requestId 제외)의 숫자 안에 있다(/explain 숫자 검사와 같은 토큰).

금지어·판정 이름은 NFKC 로 바꾸고 공백을 지운 글에서 찾는다("수주금액"·"10％"·"비 추천"도 잡는다).
템플릿도 같은 검사를 지난 항목만 남긴다. 로그에 요청·모델 출력을 남기지 않는다.
"""

import json
import re
import unicodedata
from decimal import Decimal

from pydantic import ValidationError

from sol_ai.adapters.base import ExtractionFailed, InsightAdapter, ModelUnavailable, QwenAdapter
from sol_ai.contracts import (
    InsightBody,
    InsightFactor,
    InsightFallbackReason,
    InsightItem,
    InsightRequest,
    InsightResponse,
    Recommendation,
)
from sol_ai.deadline import Deadline
from sol_ai.explain import allowed_numbers, number_tokens
from sol_ai.paths import INSIGHT_PROMPT_FILE, INSIGHT_SCHEMA_FILE
from sol_ai.schema import prompt_hash
from sol_ai.strict_json import parse_json

# promptHash = sha256(프롬프트 + 스키마 파일 + 이 버전). 추출 promptHash 와 따로다
INSIGHT_PROMPT_VERSION = "insight/v0.1"

FORBIDDEN_WORDS = ("승률", "확률", "가능성", "수주 금액", "점유율", "경쟁사", "%")
# 화면 판정 이름(ADR-062). "비추천"을 먼저 찾아 그 안의 "추천"을 BID 로 세지 않는다
VERDICT_NAMES = {"비추천": "NO_BID", "추천": "BID", "보류": "WATCH"}
_VERDICT_NAME = re.compile("|".join(VERDICT_NAMES))
# 영문 판정 토큰은 판정과 상관없이 쓰지 않는다
_ENGLISH_VERDICT = re.compile(r"(?<![A-Za-z])(?:NO[\s_-]?BID|BID|WATCH)(?![A-Za-z])", re.IGNORECASE)
_SPACE = re.compile(r"\s+")

# 템플릿 고르기(계획 Task 1): 강점은 비율 0.6 이상 요소 3개까지, 보완할 점은 미충족·확인 필요 자격 2개 + 0.4 미만 요소 2개
STRENGTH_MIN_RATIO = 0.6
WEAKNESS_MAX_RATIO = 0.4
MAX_TEMPLATE_STRENGTHS = 3
MAX_TEMPLATE_CHECKS = 2
MAX_TEMPLATE_WEAK_FACTORS = 2
CHECK_STATUS_TEXT = {"NOT_SATISFIED": "미충족", "NEEDS_REVIEW": "확인 필요"}
# recommendationBasis 가 규칙 엔진 코드로 오면 문장으로 바꾼다. 그 밖의 글은 그대로 쓴다
BASIS_TEXT = {
    "RULES_ONLY": "규칙 엔진만으로 판정했습니다.",
    "RULES_WITH_KEV_ASSIST": "규칙 엔진이 판정하고 Bosun 참고 지표를 함께 봤습니다.",
}
MAX_SUMMARY_CHARS = 400
MAX_ITEM_CHARS = 200


def _compact(text: str) -> str:
    return _SPACE.sub("", unicodedata.normalize("NFKC", text))


_FORBIDDEN = tuple(_compact(word) for word in FORBIDDEN_WORDS)


def has_forbidden_word(text: str) -> bool:
    compact = _compact(text)
    return any(word in compact for word in _FORBIDDEN)


def has_other_verdict(text: str, recommendation: Recommendation) -> bool:
    if _ENGLISH_VERDICT.search(unicodedata.normalize("NFKC", text)):
        return True
    named = {VERDICT_NAMES[name] for name in _VERDICT_NAME.findall(_compact(text))}
    return bool(named - {recommendation})


def _numbers(text: str) -> set[Decimal]:
    # 01·1, 21·21.0 은 같은 수다
    return {Decimal(token) for token in number_tokens(unicodedata.normalize("NFKC", text))}


def request_numbers(request: InsightRequest) -> set[Decimal]:
    """요청 JSON 의 숫자. requestId(uuid)의 숫자는 입력 사실이 아니라 뺀다."""
    raw = request.model_dump(mode="json", by_alias=True, exclude={"requestId"})
    return {Decimal(token) for token in allowed_numbers(raw)}


def _texts(body: InsightBody) -> list[str]:
    return [body.summary, *(item.text for item in (*body.strengths, *body.improvements))]


def _text_reason(
    texts: list[str], request: InsightRequest, allowed: set[Decimal]
) -> InsightFallbackReason | None:
    """3~5단계. 단계마다 모든 문장을 본다(앞 단계가 먼저 걸린다)."""
    if any(has_forbidden_word(text) for text in texts):
        return "FORBIDDEN_WORD"
    if any(has_other_verdict(text, request.rules.recommendation) for text in texts):
        return "LABEL_CONFLICT"
    if any(not _numbers(text) <= allowed for text in texts):
        return "UNKNOWN_NUMBER"
    return None


def validate_insight(
    raw: str, request: InsightRequest
) -> tuple[InsightBody | None, InsightFallbackReason | None]:
    """모델 원문 JSON 을 검사한다. 통과하면 (본문, None), 아니면 (None, 이유)."""
    data = parse_json(raw)
    if not isinstance(data, dict):
        return None, "INVALID_OUTPUT"
    try:
        body = InsightBody.model_validate(data)
    except ValidationError:
        return None, "INVALID_OUTPUT"
    known = {ref.id for ref in request.refs}
    if any(
        ref_id not in known
        for item in (*body.strengths, *body.improvements)
        for ref_id in item.refIds
    ):
        return None, "UNKNOWN_REF"
    reason = _text_reason(_texts(body), request, request_numbers(request))
    return (None, reason) if reason is not None else (body, None)


# ---------------------------------------------------------------- 템플릿


def _number(value: float) -> str:
    # 입력 JSON 표기와 같게 쓴다(58 → "58", 58.5 → "58.5"). 반올림하지 않는다
    return json.dumps(value)


def _ratio(factor: InsightFactor) -> float | None:
    return factor.points / factor.maxPoints if factor.maxPoints > 0 else None


def _candidates(head: str, reason: str) -> list[str]:
    """이유를 붙인 문장, 그다음 머리만. 이유가 규칙에 걸리거나 길면 머리만 쓴다."""
    detail = reason.strip().rstrip(".")
    return [f"{head} {detail}.", head] if detail else [head]


def _factor_texts(factor: InsightFactor) -> list[str]:
    head = f"{factor.label}: {_number(factor.maxPoints)}점 중 {_number(factor.points)}점."
    return _candidates(head, factor.reason)


def _pick(candidates: list[list[str]], limit: int, accept) -> list[InsightItem]:
    """후보마다 규칙을 지나는 첫 문장을 고른다. 지나는 문장이 없는 후보는 뺀다."""
    items = []
    for texts in candidates:
        text = next((t for t in texts if len(t) <= MAX_ITEM_CHARS and accept(t)), None)
        if text is not None:
            items.append(InsightItem(text=text, refIds=[]))
        if len(items) == limit:
            break
    return items


def template_insight(request: InsightRequest) -> InsightBody:
    """규칙 결과로 만든 대체 문장. 같은 요청이면 같은 결과이고, 모델 출력과 같은 검사를 지난다.

    근거 번호는 붙이지 않는다(요소·자격과 refs 의 대응을 gateway 가 모른다).
    """
    rules = request.rules
    allowed = request_numbers(request)

    def accept(text: str) -> bool:
        return _text_reason([text], request, allowed) is None

    rated = [(factor, ratio) for factor in rules.factors if (ratio := _ratio(factor)) is not None]
    strong = sorted((p for p in rated if p[1] >= STRENGTH_MIN_RATIO), key=lambda p: -p[1])
    weak = sorted((p for p in rated if p[1] < WEAKNESS_MAX_RATIO), key=lambda p: p[1])
    checks = sorted(
        (c for c in rules.qualificationChecks if c.status in CHECK_STATUS_TEXT),
        key=lambda c: c.status != "NOT_SATISFIED",
    )
    check_texts = [
        _candidates(f"{c.label}: {CHECK_STATUS_TEXT[c.status]}.", c.reason) for c in checks
    ]
    strengths = _pick([_factor_texts(f) for f, _ in strong], MAX_TEMPLATE_STRENGTHS, accept)
    improvements = [
        *_pick(check_texts, MAX_TEMPLATE_CHECKS, accept),
        *_pick([_factor_texts(f) for f, _ in weak], MAX_TEMPLATE_WEAK_FACTORS, accept),
    ]
    head = f"SOL Score {_number(rules.score)}점."
    basis = BASIS_TEXT.get(rules.recommendationBasis, rules.recommendationBasis).strip()
    summary = next(
        (
            text
            for text in (f"{head} {basis}" if basis else head, head)
            if len(text) <= MAX_SUMMARY_CHARS and accept(text)
        ),
        head,
    )
    return InsightBody(summary=summary, strengths=strengths, improvements=improvements)


# ---------------------------------------------------------------- 경로


def insight_prompt_hash() -> str:
    return prompt_hash(
        INSIGHT_PROMPT_FILE, INSIGHT_SCHEMA_FILE.read_text(encoding="utf-8"), INSIGHT_PROMPT_VERSION
    )


def run_insight(
    request: InsightRequest, adapter: QwenAdapter, *, prompt_hash: str, deadline: Deadline
) -> InsightResponse:
    """모델을 한 번 부르고 검사한다. 이 기능이 없는 어댑터·미접속·검사 실패는 템플릿으로 대체한다."""
    reason: InsightFallbackReason
    if not isinstance(adapter, InsightAdapter):
        reason = "MODEL_UNAVAILABLE"
    else:
        try:
            raw = adapter.insight(request, deadline=deadline)
        except ModelUnavailable:
            reason = "MODEL_UNAVAILABLE"
        except ExtractionFailed:
            reason = "INVALID_OUTPUT"
        else:
            body, failure = validate_insight(raw, request)
            if body is not None:
                return _response(body, None, adapter.model_name, prompt_hash)
            reason = failure or "INVALID_OUTPUT"
    return _response(template_insight(request), reason, None, prompt_hash)


def _response(
    body: InsightBody, reason: InsightFallbackReason | None, model: str | None, prompt_hash: str
) -> InsightResponse:
    return InsightResponse(
        summary=body.summary,
        strengths=body.strengths,
        improvements=body.improvements,
        fallback=reason is not None,
        fallbackReason=reason,
        model=model,
        promptHash=prompt_hash,
    )
