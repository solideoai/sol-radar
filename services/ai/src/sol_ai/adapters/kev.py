"""Kev 어댑터(docs/03 §5.7·§5.10). state → wire 요청 → Kev 응답 → KevAssist.

- Kev 는 참고 지표만 낸다. 입력에 규칙 결과가 없고(KevRequest), 출력은 KevAssist(+ v0.2 항목 분포)뿐이다.
- 판정 순서(e8): ko state 거부(422) → KEV_ENABLED=false(errorCode=null) → 장애 주입(KEV_UNAVAILABLE)
  → 추출 인젝션 의심(INJECTION_SUSPECTED, 서버를 부르지 않는다) → Kev 호출.
- timeout·미접속·형식 오류·값 범위 밖은 enabled=false, errorCode=KEV_UNAVAILABLE(K4). 분석은 실패하지 않는다.
- kev-qs/v0.2: 공고 단위 11질문(파일 순서) + 담당 항목마다 req.<itemId>.status 를 24개씩 나눠 같은 state 로 보낸다.
  묶음 하나라도 실패하면 전체 KEV_UNAVAILABLE(부분 결과 없음). stateTrace 생성 실패는 null + warning 로그.
- 시간: 요청 하나의 마감(deadline, 요청 시작 + KEV_TIMEOUT_MS)을 모든 묶음이 나눠 쓴다(C5-A S1). 마감이 지나면
  KEV_UNAVAILABLE 이고 부분 결과를 내지 않는다.
"""

import hashlib
import logging
from dataclasses import dataclass, field

from sol_ai.adapters import kev_wire
from sol_ai.adapters.base import KevClient, KevReply, KevUnavailable, TranslationAdapter
from sol_ai.contracts import (
    FitScore,
    KevAssist,
    KevCalibration,
    KevRequest,
    KevRisk,
    KevScores,
    KevStateTrace,
    RequirementDistribution,
    StateTraceLine,
)
from sol_ai.deadline import Deadline
from sol_ai.guards import InjectionGuard
from sol_ai.kev_state import build_state
from sol_ai.kev_state_v02 import StateDocument, StateTemplate, build_state_v02
from sol_ai.paths import INJECTION_PATTERNS_FILE
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import (
    Q_FIT,
    Q_MANDATORY_RISK,
    Q_NEEDS_HUMAN_REVIEW,
    Q_RECOMMENDATION,
    REQUIREMENT_LABELS,
    RISK_QIDS,
    SCORE_QIDS,
    V0_2,
    QuestionSet,
    requirement_qid,
)
from sol_ai.thresholds import Thresholds
from sol_ai.translation import (
    checked_translations,
    collect_notice_texts,
    collect_profile_texts,
    missing_warnings,
    translate_texts,
)

logger = logging.getLogger("sol_ai.kev")

OPTIONS = ("BID", "WATCH", "NO_BID")
KEV_UNAVAILABLE = "KEV_UNAVAILABLE"
INJECTION_SUSPECTED = "INJECTION_SUSPECTED"
# 03 §5.10: 요청 하나에 질문이 많으면 24개씩 나눠 보낸다
CHUNK_SIZE = 24
# 분포 동점이면 보수적인 쪽(NEEDS_REVIEW → NOT_SATISFIED → SATISFIED)
LABEL_PRIORITY = ("NEEDS_REVIEW", "NOT_SATISFIED", "SATISFIED")


class KoStateNotAllowed(Exception):
    """stateLanguage="ko" 인데 KEV_ALLOW_KO_STATE 가 "true" 가 아니다 → 422 KO_STATE_NOT_ALLOWED."""


@dataclass(frozen=True)
class KevOutcome:
    kev: KevAssist
    state_hash: str | None
    wire: list[dict] | None
    error_code: str | None
    requirements: list[RequirementDistribution] | None = None
    warnings: list[str] = field(default_factory=list)


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


def _requirement(item_id: str, answer: kev_wire.Answer) -> RequirementDistribution:
    if not isinstance(answer, kev_wire.ChoiceAnswer) or set(answer.probabilities) != set(
        REQUIREMENT_LABELS
    ):
        raise kev_wire.WireFormatError(
            "항목 질문의 선택지가 SATISFIED·NOT_SATISFIED·NEEDS_REVIEW 가 아니다"
        )
    distribution = {label: answer.probabilities[label] for label in REQUIREMENT_LABELS}
    top = max(distribution.values())
    label = next(label for label in LABEL_PRIORITY if distribution[label] == top)
    return RequirementDistribution(
        itemId=item_id, qid=requirement_qid(item_id), distribution=distribution, label=label
    )


def _score(answer: kev_wire.Answer) -> FitScore:
    if not isinstance(answer, kev_wire.ScoreAnswer):
        raise kev_wire.WireFormatError("score 질문의 답이 아니다")
    return FitScore(score=answer.score, legend=answer.legend)


def _risk(qid: str, answer: kev_wire.Answer, threshold: float) -> KevRisk:
    if not isinstance(answer, kev_wire.YesAnswer):
        raise kev_wire.WireFormatError("risk 질문의 답이 아니다")
    return KevRisk(
        qid=qid, probability=answer.probability, overThreshold=answer.probability >= threshold
    )


def _state_trace(
    document: StateDocument, state_hash: str, template: StateTemplate
) -> KevStateTrace:
    return KevStateTrace(
        stateHash=state_hash,
        template=template.name,
        lines=[
            StateTraceLine(
                lineNo=number,
                text=line.text,
                noticeEvidence=line.notice_evidence,
                companyEvidence=line.company_evidence,
                itemIds=line.item_ids,
            )
            for number, line in enumerate(document.lines, start=1)
        ],
    )


def _chunks(questions: dict[str, kev_wire.WireQuestion]) -> list[dict[str, kev_wire.WireQuestion]]:
    items = list(questions.items())
    return [dict(items[i : i + CHUNK_SIZE]) for i in range(0, len(items), CHUNK_SIZE)]


class KevAdapter:
    def __init__(
        self,
        client: KevClient | None,
        question_sets: dict[str, QuestionSet],
        dictionary: QualificationDictionary,
        *,
        allow_ko_state: bool,
        korean_question_sets: dict[str, QuestionSet] | None = None,
        state_templates: dict[str, StateTemplate] | None = None,
        thresholds: Thresholds | None = None,
        translator: TranslationAdapter | None = None,
    ) -> None:
        self._client = client
        self._question_sets = question_sets
        self._korean_question_sets = korean_question_sets or {}
        self._dictionary = dictionary
        self._allow_ko_state = allow_ko_state
        self._templates = state_templates or {}
        self._thresholds = thresholds
        self._translator = translator
        self._guard = InjectionGuard.load(INJECTION_PATTERNS_FILE)

    def _question_set(self, requested: str) -> QuestionSet | None:
        """요청 버전을 이 Kev 가 답하면 그것, 아니면 Kev 의 기본 버전(mock 은 v0.2 요청에도 v0.1)."""
        supported = self._client.question_sets if self._client else ()
        version = requested if requested in supported else next(iter(supported), None)
        return self._question_sets.get(version) if version else None

    def _english_request(
        self, request: KevRequest, deadline: Deadline
    ) -> tuple[KevRequest, list[str]]:
        """공고 누락은 재번역하지 않는다. 기업만 /kev 기존 마감 내에서 번역한다."""
        candidates = request.translations or {}
        notice = collect_notice_texts(request.extraction, self._dictionary)
        accepted = checked_translations(notice, candidates, self._guard)
        missing = missing_warnings(notice, accepted)
        if missing:
            return request, missing
        profile = collect_profile_texts(request, self._dictionary)
        company = checked_translations(profile, candidates, self._guard)
        pending = {p: v for p, v in profile.items() if p not in company}
        warnings: list[str] = []
        if pending and self._translator is not None:
            translated = translate_texts(pending, self._translator, self._guard, deadline=deadline)
            company.update(translated.values)
            warnings = translated.warnings
        elif pending:
            warnings = missing_warnings(pending, company)
        # 입력 객체·추출·기업 프로필은 그대로다. 번역 사본만 State 구성에 사용한다.
        return request.model_copy(update={"translations": {**accepted, **company}}), warnings

    def assess(self, request: KevRequest, *, deadline: Deadline) -> KevOutcome:
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
        # mock은 기록된 고정 분포 계약을 유지한다. 실제 모델에는 불완전한 영어 State를 보내지 않는다.
        if request.stateLanguage == "en" and self._client.provider != "mock":
            request, warnings = self._english_request(request, deadline)
            if warnings:
                return KevOutcome(disabled_assist(), None, None, KEV_UNAVAILABLE, warnings=warnings)
        question_set = self._question_set(request.questionSetVersion)
        if question_set is None:
            return unavailable
        if question_set.version == V0_2:
            return self._assess_v02(request, question_set, deadline)
        state = build_state(request, request.stateLanguage, self._dictionary)
        if self._guard.matches(state):
            return KevOutcome(disabled_assist(), None, None, INJECTION_SUSPECTED)
        wire_request = kev_wire.build_request(
            state, self._client.request_model, question_set.questions
        )
        try:
            reply = self._client.answer(wire_request, request, deadline=deadline)
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

    def _assess_v02(
        self, request: KevRequest, english: QuestionSet, deadline: Deadline
    ) -> KevOutcome:
        unavailable = KevOutcome(disabled_assist(), None, None, KEV_UNAVAILABLE)
        language = request.stateLanguage
        template = self._templates.get(language)
        if self._client is None or template is None or self._thresholds is None:
            return unavailable
        # ko state(평가 전용)는 한국어판 질문을 보낸다. 없으면 영어 원문
        question_set = (
            self._korean_question_sets.get(V0_2, english) if language == "ko" else english
        )
        document = build_state_v02(request, template, self._dictionary)
        if self._guard.matches(document.text):
            return KevOutcome(disabled_assist(), None, None, INJECTION_SUSPECTED)
        questions = {
            **question_set.notice_questions(),
            **{requirement_qid(i): question_set.item_question(i) for i in document.item_ids},
        }
        replies: list[KevReply] = []
        answers: dict[str, kev_wire.Answer] = {}
        latency: int | float = 0
        try:
            for chunk in _chunks(questions):
                wire_request = kev_wire.build_request(
                    document.text, self._client.request_model, chunk
                )
                reply = self._client.answer(wire_request, request, deadline=deadline)
                result = kev_wire.parse_response(reply.body, chunk)
                replies.append(reply)
                answers.update(result.answers)
                latency += result.latency or 0
            parsed = kev_wire.WireResult(answers, latency)
            assist = _assist(parsed, self._client, question_set.version, replies[0].request_id)
            threshold = self._thresholds.threshold
            assist = assist.model_copy(
                update={
                    "scores": KevScores(**{q: _score(answers[q]) for q in SCORE_QIDS}),
                    "risks": [_risk(q, answers[q], threshold) for q in RISK_QIDS],
                    "calibration": KevCalibration(
                        status=self._thresholds.status,
                        datasetVersion=self._thresholds.dataset_version,
                        threshold=threshold,
                        thresholdsVersion=self._thresholds.version,
                    ),
                }
            )
            requirements = [
                _requirement(item, answers[requirement_qid(item)]) for item in document.item_ids
            ]
        except (KevUnavailable, kev_wire.WireFormatError):
            # 묶음 하나라도 실패하면 부분 결과를 내지 않는다
            return unavailable
        state_hash = hashlib.sha256(document.text.encode("utf-8")).hexdigest()
        try:
            trace = _state_trace(document, state_hash, template)
        except (AttributeError, IndexError, KeyError, TypeError, ValueError) as error:
            # 근거 추적 실패가 Kev 결과를 막지 않는다(v0.2 명세 §4). pydantic 검증 오류도 ValueError 다
            logger.warning("kev stateTrace failed: %s", type(error).__name__)
            trace = None
        assist = assist.model_copy(update={"stateTrace": trace})
        return KevOutcome(assist, state_hash, [r.body for r in replies], None, requirements)
