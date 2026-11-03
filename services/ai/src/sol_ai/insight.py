"""POST /insight 추천 분석(스펙 §4.3, 계획 C3, ADR-078): 모델 출력 검증과 규칙 결과 템플릿.

판정(점수·권고)은 규칙 엔진 결과를 입력으로 받기만 한다. 입력이 인젝션 의심이면(run 의 injectionSuspected 또는
InjectionGuard 가 모델에 갈 글에서 찾음) 모델을 부르지 않고 템플릿으로 답한다(INJECTION_SUSPECTED, 보안 리뷰 중-2).
모델 출력은 아래 순서로 검사한다(응답은 언제나 200).

1. JSON·모양(INVALID_OUTPUT): 표준 JSON 객체, 모르는 키 없음, 글자·개수 상한(InsightBody). 걸리면 전체를 템플릿으로.
2. 숨은 문자(INVALID_OUTPUT): 판단 이유·항목 문장·요소 키·자격 이름 어디든(유니코드 범주 Cc·Cf·Zl·Zp·Co·Cs.
   탭·개행은 허용). 조작 신호라 항목만 빼지 않고 전체를 템플릿으로(사용자 결정 Q1).
3. 판단 이유(summary): 금지어(FORBIDDEN_WORD) → 판정(LABEL_CONFLICT) → 숫자(UNKNOWN_NUMBER). 걸리면 전체를 템플릿으로.
4. 세부 항목(강점·보완할 점·요소 해설·자격 해설·확인할 것)마다: 금지어, 판정, 숫자, 없는 근거 번호, 요청에 없는 요소 키,
   미충족·확인 필요 자격이 아닌 자격 이름, 같은 자격 이름의 두 번째 해설. 걸린 항목만 뺀다.
5. 남은 본문을 MODEL 로 돌려준다.

판정 검사는 다른 판정의 한국어 이름(BID=추천·WATCH=보류·NO_BID=비추천), 영문 판정 토큰, 판정과 상관없이 참여를 권하거나
말리는 표현(VERDICT_INTENTS)을 본다. 숫자 검사는 문장의 숫자가 요청 JSON(requestId 제외)의 숫자 안에 있는지 본다
(/explain 숫자 검사와 같은 토큰). 금지어·판정은 NFKC 로 바꾸고 공백을 지운 글에서 찾는다("수주금액"·"10％"·"비 추천"·
"B I D"도 잡는다). 한글 수사("십이억")는 숫자 검사가 보지 못한다(남은 위험). 템플릿도 같은 검사를 지난 항목만 남긴다.
로그에 요청·모델 출력·뺀 항목의 내용을 남기지 않는다(뺀 개수와 사유 코드만).
"""

import json
import logging
import re
import unicodedata
from collections import Counter
from collections.abc import Callable
from decimal import Decimal
from typing import Any

from pydantic import ValidationError

from sol_ai.adapters.base import ExtractionFailed, InsightAdapter, ModelUnavailable, QwenAdapter
from sol_ai.contracts import (
    InsightBody,
    InsightCheckNote,
    InsightFactor,
    InsightFactorNote,
    InsightFallbackReason,
    InsightItem,
    InsightRequest,
    InsightResponse,
    Recommendation,
)
from sol_ai.deadline import Deadline
from sol_ai.explain import allowed_numbers, number_tokens
from sol_ai.guards import InjectionGuard
from sol_ai.logsafe import log_id
from sol_ai.paths import INSIGHT_PROMPT_FILE, INSIGHT_SCHEMA_FILE
from sol_ai.schema import prompt_hash
from sol_ai.strict_json import parse_json

logger = logging.getLogger("sol_ai.insight")

# 출력 형식 버전(ADR-078). promptHash = sha256(프롬프트 + 스키마 파일 + 이 버전). 추출 promptHash 와 따로다.
# web insight.model.ts INSIGHT_PROMPT_VERSION·마이그레이션 제약 글자와 같아야 한다(scripts/insight-prompt-version.test.mjs)
INSIGHT_PROMPT_VERSION = "insight/v0.2"

FORBIDDEN_WORDS = (
    "승률",
    "확률",
    "가능성",
    "수주 금액",
    "점유율",
    "경쟁사",
    "%",
    "낙찰률",
    "낙찰율",
    "수주율",
    "수주률",
    "퍼센트",
    "경쟁 업체",
    "타사",
)
# 공백을 없앤 글에서 "타사"는 기타 사항·기타 사업·타 사업에도 생긴다. 이것들은 경쟁사 표현이 아니라 뺀다
_FORBIDDEN_EXCEPTIONS = {"타사": r"(?<!기)타사(?!업)"}
# 화면 판정 이름(ADR-062). "비추천"을 먼저 찾아 그 안의 "추천"을 BID 로 세지 않는다
VERDICT_NAMES = {"비추천": "NO_BID", "추천": "BID", "보류": "WATCH"}
_VERDICT_NAME = re.compile("|".join(VERDICT_NAMES))
# 판정을 다시 말하는 표현. 판정과 상관없이 쓰지 않는다("참여하려면 …해야 합니다"는 보통 문장이라 통과한다)
VERDICT_INTENTS = (
    "참여하지 않",
    "참여하지 마",
    "입찰하지 않",
    "입찰하지 마",
    "참여를 권",
    "입찰을 권",
    "참여를 포기",
    "입찰을 포기",
    "참여를 보류",
    "입찰을 보류",
    "불참",
    "참여하십시오",
    "입찰하십시오",
)
# 영문 판정 토큰은 판정과 상관없이 쓰지 않는다. 공백을 없앤 글에서도 찾는다("B I D")
_ENGLISH_VERDICT = re.compile(r"(?<![A-Za-z])(?:NO[\s_-]?BID|BID|WATCH)(?![A-Za-z])", re.IGNORECASE)
_SPACE = re.compile(r"\s+")
# 보이지 않거나 글을 쪼개는 문자(제어·서식·줄/문단 구분·사용자 정의·짝 없는 서로게이트). 탭·개행만 허용한다
HIDDEN_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp", "Co", "Cs"})
ALLOWED_CONTROLS = frozenset("\t\n\r")

# 템플릿 고르기(계획 Task 1): 강점은 비율 0.6 이상 요소 3개까지, 보완할 점은 미충족·확인 필요 자격 2개 + 0.4 미만 요소 2개
STRENGTH_MIN_RATIO = 0.6
WEAKNESS_MAX_RATIO = 0.4
MAX_TEMPLATE_STRENGTHS = 3
MAX_TEMPLATE_CHECKS = 2
MAX_TEMPLATE_WEAK_FACTORS = 2
# 새 칸(ADR-078)은 출력 상한(InsightBody)까지 채운다
MAX_TEMPLATE_FACTOR_NOTES = 8
MAX_TEMPLATE_CHECK_NOTES = 8
MAX_TEMPLATE_NEXT_STEPS = 5
CHECK_STATUS_TEXT = {"NOT_SATISFIED": "미충족", "NEEDS_REVIEW": "확인 필요"}
NEXT_STEP_TEXT = "{label}: 참여하려면 충족 여부를 확인해야 합니다."
# recommendationBasis 가 규칙 엔진 코드로 오면 문장으로 바꾼다. 그 밖의 글은 그대로 쓴다
BASIS_TEXT = {
    "RULES_ONLY": "규칙 엔진만으로 판정했습니다.",
    "RULES_WITH_KEV_ASSIST": "규칙 엔진이 판정하고 Bosun 참고 지표를 함께 봤습니다.",
}
MAX_SUMMARY_CHARS = 800
MAX_ITEM_CHARS = 200
# InsightFactorNote.factor 상한과 같다
MAX_FACTOR_CHARS = 40


def _compact(text: str) -> str:
    return _SPACE.sub("", unicodedata.normalize("NFKC", text))


_FORBIDDEN = re.compile(
    "|".join(_FORBIDDEN_EXCEPTIONS.get(word, re.escape(_compact(word))) for word in FORBIDDEN_WORDS)
)
_VERDICT_INTENT = re.compile("|".join(re.escape(_compact(phrase)) for phrase in VERDICT_INTENTS))


def has_hidden_character(text: str) -> bool:
    return any(
        char not in ALLOWED_CONTROLS and unicodedata.category(char) in HIDDEN_CATEGORIES
        for char in text
    )


def has_forbidden_word(text: str) -> bool:
    return _FORBIDDEN.search(_compact(text)) is not None


def has_verdict_conflict(text: str, recommendation: Recommendation) -> bool:
    """다른 판정 이름·영문 판정 토큰·판정 취지 표현."""
    compact = _compact(text)
    if _ENGLISH_VERDICT.search(unicodedata.normalize("NFKC", text)) or _ENGLISH_VERDICT.search(
        compact
    ):
        return True
    if _VERDICT_INTENT.search(compact):
        return True
    named = {VERDICT_NAMES[name] for name in _VERDICT_NAME.findall(compact)}
    return bool(named - {recommendation})


def _numbers(text: str) -> set[Decimal]:
    # 01·1, 21·21.0 은 같은 수다
    return {Decimal(token) for token in number_tokens(unicodedata.normalize("NFKC", text))}


def request_numbers(request: InsightRequest) -> set[Decimal]:
    """요청 JSON 의 숫자. requestId(uuid)의 숫자는 입력 사실이 아니라 뺀다."""
    raw = request.model_dump(mode="json", by_alias=True, exclude={"requestId"})
    return {Decimal(token) for token in allowed_numbers(raw)}


def _items(body: InsightBody) -> list[InsightItem]:
    return [
        *body.strengths,
        *body.improvements,
        *body.factorNotes,
        *body.checkNotes,
        *body.nextSteps,
    ]


def _strings(body: InsightBody) -> list[str]:
    """숨은 문자를 찾는 모든 글: 판단 이유, 항목 문장, 요소 키, 자격 이름."""
    return [
        body.summary,
        *(item.text for item in _items(body)),
        *(note.factor for note in body.factorNotes),
        *(note.label for note in body.checkNotes),
    ]


def _text_reason(
    texts: list[str], request: InsightRequest, allowed: set[Decimal]
) -> InsightFallbackReason | None:
    """금지어 → 판정 → 숫자. 단계마다 모든 문장을 본다(앞 단계가 먼저 걸린다)."""
    if any(has_forbidden_word(text) for text in texts):
        return "FORBIDDEN_WORD"
    if any(has_verdict_conflict(text, request.rules.recommendation) for text in texts):
        return "LABEL_CONFLICT"
    if any(not _numbers(text) <= allowed for text in texts):
        return "UNKNOWN_NUMBER"
    return None


def _keep_items(
    body: InsightBody, request: InsightRequest, allowed: set[Decimal]
) -> tuple[InsightBody, Counter[str]]:
    """4단계. 세부 항목마다 검사해 걸린 항목만 뺀다. 뺀 개수를 사유 코드별로 센다."""
    known_refs = {ref.id for ref in request.refs}
    factors = {factor.factor for factor in request.rules.factors}
    labels = {check.label for check in request.rules.review_checks()}
    dropped: Counter[str] = Counter()

    def keep(items: list, extra: Callable[[Any, list], str | None] | None = None) -> list:
        kept: list = []
        for item in items:
            reason = _text_reason([item.text], request, allowed)
            if reason is None and not set(item.refIds) <= known_refs:
                reason = "UNKNOWN_REF"
            if reason is None and extra is not None:
                reason = extra(item, kept)
            if reason is None:
                kept.append(item)
            else:
                dropped[reason] += 1
        return kept

    def factor_reason(note: InsightFactorNote, kept: list[InsightFactorNote]) -> str | None:
        # 같은 요소는 먼저 남은 해설 하나만 둔다. 화면이 요소마다 한 줄을 그린다
        if note.factor not in factors:
            return "UNKNOWN_FACTOR"
        return "DUPLICATE_FACTOR" if any(other.factor == note.factor for other in kept) else None

    def label_reason(note: InsightCheckNote, kept: list[InsightCheckNote]) -> str | None:
        # 화면은 label 로 자격과 짝짓는다. 같은 자격은 먼저 남은 해설 하나만 둔다
        if note.label not in labels:
            return "UNKNOWN_LABEL"
        return "DUPLICATE_LABEL" if any(other.label == note.label for other in kept) else None

    kept = body.model_copy(
        update={
            "strengths": keep(body.strengths),
            "improvements": keep(body.improvements),
            "factorNotes": keep(body.factorNotes, factor_reason),
            "checkNotes": keep(body.checkNotes, label_reason),
            "nextSteps": keep(body.nextSteps),
        }
    )
    return kept, dropped


def validate_insight(
    raw: str, request: InsightRequest
) -> tuple[InsightBody | None, InsightFallbackReason | None]:
    """모델 원문 JSON 을 검사한다. 통과하면 (걸린 세부 항목을 뺀 본문, None), 전체 대체면 (None, 이유)."""
    data = parse_json(raw)
    if not isinstance(data, dict):
        return None, "INVALID_OUTPUT"
    try:
        body = InsightBody.model_validate(data)
    except ValidationError:
        return None, "INVALID_OUTPUT"
    if any(has_hidden_character(text) for text in _strings(body)):
        return None, "INVALID_OUTPUT"
    allowed = request_numbers(request)
    reason = _text_reason([body.summary], request, allowed)
    if reason is not None:
        return None, reason
    body, dropped = _keep_items(body, request, allowed)
    if dropped:
        # 뺀 항목의 내용은 남기지 않는다
        logger.info(
            "insight requestId=%s droppedItems=%s",
            log_id(request.requestId),
            ",".join(f"{code}:{count}" for code, count in sorted(dropped.items())),
        )
    return body, None


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


def _pick(
    candidates: list[list[str]], limit: int, choose: Callable[[list[str]], str | None]
) -> list[InsightItem]:
    """후보마다 규칙을 지나는 첫 문장을 고른다. 지나는 문장이 없는 후보는 뺀다."""
    items = []
    for texts in candidates:
        text = choose(texts)
        if text is not None:
            items.append(InsightItem(text=text, refIds=[]))
        if len(items) == limit:
            break
    return items


def template_insight(request: InsightRequest) -> InsightBody:
    """규칙 결과로 만든 대체 문장. 같은 요청이면 같은 결과이고, 모델 출력과 같은 검사를 지난다.

    근거 번호는 붙이지 않는다(요소·자격과 refs 의 대응을 gateway 가 모른다). 새 칸(ADR-078)은 요소 해설 = 요소마다 점수와
    요소 이유, 자격 해설 = 미충족·확인 필요 자격의 판정 이유, 확인할 것 = 같은 자격마다 한 문장이다. 같은 자격 이름은
    요청 순서의 첫 자격 하나만 쓴다(InsightRules.review_checks).
    """
    rules = request.rules
    allowed = request_numbers(request)

    def accept(text: str) -> bool:
        return not has_hidden_character(text) and _text_reason([text], request, allowed) is None

    def choose(texts: list[str]) -> str | None:
        return next((t for t in texts if len(t) <= MAX_ITEM_CHARS and accept(t)), None)

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
    strengths = _pick([_factor_texts(f) for f, _ in strong], MAX_TEMPLATE_STRENGTHS, choose)
    improvements = [
        *_pick(check_texts, MAX_TEMPLATE_CHECKS, choose),
        *_pick([_factor_texts(f) for f, _ in weak], MAX_TEMPLATE_WEAK_FACTORS, choose),
    ]
    factor_notes = [
        InsightFactorNote(factor=f.factor, text=text, refIds=[])
        for f in rules.factors
        if len(f.factor) <= MAX_FACTOR_CHARS
        and not has_hidden_character(f.factor)
        and (text := choose(_factor_texts(f))) is not None
    ][:MAX_TEMPLATE_FACTOR_NOTES]
    # 미충족을 먼저 둔다(sorted 는 같은 판정끼리 요청 순서를 지킨다). 자격 이름에 숨은 문자가 있으면 해설을 달지 않는다
    review = sorted(
        (c for c in rules.review_checks() if not has_hidden_character(c.label)),
        key=lambda c: c.status != "NOT_SATISFIED",
    )
    check_notes = [
        InsightCheckNote(label=c.label, text=text, refIds=[])
        for c in review
        if (text := choose(_candidates(f"{CHECK_STATUS_TEXT[c.status]}.", c.reason))) is not None
    ][:MAX_TEMPLATE_CHECK_NOTES]
    next_steps = [
        InsightItem(text=text, refIds=[])
        for c in review
        if (text := choose([NEXT_STEP_TEXT.format(label=c.label)])) is not None
    ][:MAX_TEMPLATE_NEXT_STEPS]
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
    return InsightBody(
        summary=summary,
        strengths=strengths,
        improvements=improvements,
        factorNotes=factor_notes,
        checkNotes=check_notes,
        nextSteps=next_steps,
    )


# ---------------------------------------------------------------- 경로


def insight_prompt_hash() -> str:
    return prompt_hash(
        INSIGHT_PROMPT_FILE, INSIGHT_SCHEMA_FILE.read_text(encoding="utf-8"), INSIGHT_PROMPT_VERSION
    )


def injection_suspected(request: InsightRequest, guard: InjectionGuard) -> bool:
    """run 이 인젝션 의심이었거나, 모델에 갈 글(공고명·근거 인용·자격 이름 등 모든 문자열)에 지시문 패턴이 있다."""
    return request.injectionSuspected or guard.scan_value(request.model_input())


def run_insight(
    request: InsightRequest,
    adapter: QwenAdapter,
    *,
    guard: InjectionGuard,
    prompt_hash: str,
    deadline: Deadline,
) -> InsightResponse:
    """모델을 한 번 부르고 검사한다. 인젝션 의심·이 기능이 없는 어댑터·미접속·검사 실패는 템플릿으로 대체한다."""
    reason: InsightFallbackReason
    if injection_suspected(request, guard):
        reason = "INJECTION_SUSPECTED"
    elif not isinstance(adapter, InsightAdapter):
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
                return _response(body, None, adapter.insight_model, prompt_hash)
            reason = failure or "INVALID_OUTPUT"
    return _response(template_insight(request), reason, None, prompt_hash)


def _response(
    body: InsightBody, reason: InsightFallbackReason | None, model: str | None, prompt_hash: str
) -> InsightResponse:
    # 새 칸 세 키는 MODEL·TEMPLATE 모두 늘 보낸다(비면 [])
    return InsightResponse(
        summary=body.summary,
        strengths=body.strengths,
        improvements=body.improvements,
        factorNotes=body.factorNotes,
        checkNotes=body.checkNotes,
        nextSteps=body.nextSteps,
        fallback=reason is not None,
        fallbackReason=reason,
        model=model,
        promptHash=prompt_hash,
        promptVersion=INSIGHT_PROMPT_VERSION,
    )
