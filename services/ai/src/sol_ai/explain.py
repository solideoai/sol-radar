"""POST /explain 템플릿 설명(docs/03 §2.1·§6, K8).

규칙 결과를 템플릿에 넣어 한국어 2~4문장 + 고정 문장을 만든다. Qwen 설명 어댑터는 아직 없어서
모든 모드가 템플릿이다(fallback=true). 03 §2.1 은 설명이 실패해도 템플릿으로 대체하고 분석을 실패시키지 않는다.

숫자 검사(§6): 문장의 숫자 토큰이 입력 JSON 전체의 숫자 집합 밖이면 그 문장을 버리고
"규칙 판정 결과를 확인하세요."로 대체한다. 템플릿에 입력 밖 상수 숫자(임계값 75·50 등)를 넣지 않는다.
수주 확률·낙찰 확률·충족 확률 문구를 만들지 않는다.
"""

import json
import re
from typing import Any

from sol_ai.contracts import ExplainRequest, ExplainResponse

NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")

RECOMMENDATION_LABEL = {
    "BID": "BID(참여 권고)",
    "WATCH": "WATCH(사람 검토)",
    "NO_BID": "NO-BID(참여 비권고)",
}
DOCUMENT_ISSUE_SENTENCE = "첨부 문서를 읽지 못해 첨부에만 있는 요구사항은 반영되지 않았습니다."
CHECK_RULES_SENTENCE = "규칙 판정 결과를 확인하세요."
CLOSING_SENTENCE = "최종 참여 결정은 사람이 합니다."


def number_tokens(text: str) -> list[str]:
    """숫자 토큰(쉼표 제거)을 등장 순서대로, 중복 없이."""
    seen: list[str] = []
    for token in NUMBER_TOKEN.findall(text):
        cleaned = token.replace(",", "")
        if cleaned not in seen:
            seen.append(cleaned)
    return seen


def allowed_numbers(raw_request: Any) -> set[str]:
    """입력 JSON 전체에서 모은 숫자 집합. 받은 값을 JSON 으로 다시 써서 센다(한글은 이스케이프하지 않는다)."""
    return set(number_tokens(json.dumps(raw_request, ensure_ascii=False)))


def _score_text(score: float) -> str:
    # 입력 JSON 표기와 같게 쓴다(68 → "68", 68.5 → "68.5"). 반올림하지 않는다
    return json.dumps(score)


def _qualification_sentence(request: ExplainRequest) -> str:
    mandatory = [check for check in request.qualificationChecks if check.mandatory]
    unmet = [c.requirementName for c in mandatory if c.outcome == "NOT_SATISFIED"]
    if unmet:
        return f"필수자격 미충족: {', '.join(unmet)}."
    review = [c.requirementName for c in mandatory if c.outcome == "NEEDS_REVIEW"]
    if review:
        return f"필수자격 확인 필요: {', '.join(review)}. 정보 부족은 미충족이 아니며 사람이 확인합니다."
    if not mandatory:
        return "확인된 필수자격 항목이 없습니다."
    return "필수자격을 모두 충족했습니다."


def template_sentences(request: ExplainRequest) -> list[str]:
    """고정 문장을 뺀 템플릿 문장(순서: 첨부 문제 → 자격 → 점수·권고 → Kev 불일치)."""
    breakdown = request.scoreBreakdown
    sentences = []
    if request.documentIssues:
        sentences.append(DOCUMENT_ISSUE_SENTENCE)
    sentences.append(_qualification_sentence(request))
    label = RECOMMENDATION_LABEL[breakdown.recommendation]
    sentences.append(f"SOL Score {_score_text(breakdown.score)}점, 권고 {label}.")
    kev = request.kevSummary
    if (
        kev is not None
        and kev.enabled
        and kev.suggestedOption is not None
        and kev.suggestedOption != breakdown.recommendation
    ):
        option = RECOMMENDATION_LABEL[kev.suggestedOption]
        sentences.append(f"Kev 참고 지표는 {option}를 제시했지만 점수와 권고에 반영하지 않습니다.")
    return sentences


def explain(request: ExplainRequest, raw_request: Any) -> ExplainResponse:
    allowed = allowed_numbers(raw_request)
    sentences = template_sentences(request)
    kept = [s for s in sentences if set(number_tokens(s)) <= allowed]
    if len(kept) < len(sentences):
        kept.append(CHECK_RULES_SENTENCE)
    text = " ".join([*kept, CLOSING_SENTENCE])
    return ExplainResponse(text=text, usedNumbers=number_tokens(text), fallback=True)
