"""Kev 어댑터(docs/03 §5.7). 영어 state → wire 요청 → Kev 응답 → KevAssist.

- Kev 는 참고 지표만 낸다. 입력에 규칙 결과가 없고(KevRequest), 출력은 KevAssist 뿐이다.
- 판정 순서(e8): ko state 거부(422) → KEV_ENABLED=false(errorCode=null) → 장애 주입(KEV_UNAVAILABLE)
  → 추출 인젝션 의심(INJECTION_SUSPECTED, 서버를 부르지 않는다) → Kev 호출.
- timeout·미접속·형식 오류·값 범위 밖은 enabled=false, errorCode=KEV_UNAVAILABLE(K4). 분석은 실패하지 않는다.
"""

import hashlib
from dataclasses import dataclass

from sol_ai.adapters import kev_wire
from sol_ai.adapters.base import KevClient, KevUnavailable
from sol_ai.contracts import FitScore, KevAssist, KevRequest
from sol_ai.kev_state import build_state
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import (
    Q_FIT,
    Q_MANDATORY_RISK,
    Q_NEEDS_HUMAN_REVIEW,
    Q_RECOMMENDATION,
    QuestionSet,
)

OPTIONS = ("BID", "WATCH", "NO_BID")
KEV_UNAVAILABLE = "KEV_UNAVAILABLE"
INJECTION_SUSPECTED = "INJECTION_SUSPECTED"


class KoStateNotAllowed(Exception):
    """stateLanguage="ko" 인데 KEV_ALLOW_KO_STATE 가 "true" 가 아니다 → 422 KO_STATE_NOT_ALLOWED."""


@dataclass(frozen=True)
class KevOutcome:
    kev: KevAssist
    state_hash: str | None
    wire: list[dict] | None
    error_code: str | None


def disabled_assist() -> KevAssist:
    """enabled=false. disclaimer 밖은 모두 null(03 §5.7)."""
    return KevAssist(enabled=False)


def _assist(
    result: kev_wire.WireResult, client: KevClient, version: str, request_id: str | None
) -> KevAssist:
    recommendation = result.answers[Q_RECOMMENDATION]
    mandatory_risk = result.answers[Q_MANDATORY_RISK]
    needs_review = result.answers[Q_NEEDS_HUMAN_REVIEW]
    fit = result.answers[Q_FIT]
    if not (
        isinstance(recommendation, kev_wire.ChoiceAnswer)
        and isinstance(mandatory_risk, kev_wire.YesAnswer)
        and isinstance(needs_review, kev_wire.YesAnswer)
        and isinstance(fit, kev_wire.ScoreAnswer)
    ):
        raise kev_wire.WireFormatError("질문 타입이 kev-qs/v0.1 과 다르다")
    if set(recommendation.probabilities) != set(OPTIONS):
        raise kev_wire.WireFormatError("recommendation 선택지가 BID·WATCH·NO_BID 가 아니다")
    return KevAssist(
        enabled=True,
        provider=client.provider,
        model=client.assist_model,
        questionSetVersion=version,
        suggestedOption=recommendation.choice,
        probabilities={option: recommendation.probabilities[option] for option in OPTIONS},
        confidence=recommendation.confidence,
        mandatoryRisk=mandatory_risk.probability,
        needsHumanReview=needs_review.probability,
        fit=FitScore(score=fit.score, legend=fit.legend),
        latencyMs=result.latency,
        # 응답 헤더 x-typesafe-request-id. mock 은 HTTP 를 쓰지 않아 없다
        requestId=request_id,
    )


class KevAdapter:
    def __init__(
        self,
        client: KevClient | None,
        question_sets: dict[str, QuestionSet],
        dictionary: QualificationDictionary,
        *,
        allow_ko_state: bool,
    ) -> None:
        self._client = client
        self._question_sets = question_sets
        self._dictionary = dictionary
        self._allow_ko_state = allow_ko_state

    def _question_set(self, requested: str) -> QuestionSet | None:
        """요청 버전을 이 Kev 가 답하면 그것, 아니면 Kev 의 기본 버전(mock 은 v0.2 요청에도 v0.1)."""
        supported = self._client.question_sets if self._client else ()
        version = requested if requested in supported else next(iter(supported), None)
        return self._question_sets.get(version) if version else None

    def assess(self, request: KevRequest) -> KevOutcome:
        if request.stateLanguage == "ko" and not self._allow_ko_state:
            raise KoStateNotAllowed
        if self._client is None:
            return KevOutcome(disabled_assist(), None, None, None)
        unavailable = KevOutcome(disabled_assist(), None, None, KEV_UNAVAILABLE)
        try:
            self._client.precheck()
        except KevUnavailable:
            return unavailable
        if request.extraction.get("injectionSuspected") is True:
            # 인젝션이 의심되는 추출로 state 를 만들지 않는다. 서버를 부르지 않는다(보안 점검 결정)
            return KevOutcome(disabled_assist(), None, None, INJECTION_SUSPECTED)
        question_set = self._question_set(request.questionSetVersion)
        if question_set is None:
            return unavailable
        state = build_state(request, request.stateLanguage, self._dictionary)
        wire_request = kev_wire.build_request(
            state, self._client.request_model, question_set.questions
        )
        try:
            reply = self._client.answer(wire_request, request)
            assist = _assist(
                kev_wire.parse_response(reply.body, question_set.questions),
                self._client,
                question_set.version,
                reply.request_id,
            )
        except (KevUnavailable, kev_wire.WireFormatError):
            return unavailable
        state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
        return KevOutcome(assist, state_hash, [reply.body], None)
