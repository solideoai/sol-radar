"""Kev wire 형식(docs/03 §5.4, Kev README 기준). wire 필드명과 요청 본문 모양은 이 모듈에서만 다룬다.

다른 모듈은 여기 함수와 상수를 쓴다. 필드명을 다른 곳에 하드코딩하지 않는다(03 §5.7).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

# 요청 본문
STATE = "state"
MODEL = "model"
QUESTIONS = "questions"
QUESTION_TYPE = "type"
QUESTION_INSTRUCTIONS = "instructions"
QUESTION_CRITERIA = "criteria"

# 질문 타입
CHOICE = "choice"
NOUL = "noul"
SCORE = "score"
QUESTION_TYPES = (CHOICE, NOUL, SCORE)

# 응답 본문
RESPONSES = "responses"
USAGE = "usage"
LATENCY_MS = "latency_ms"
CONFIDENCE = "confidence"
PROBABILITIES = "probabilities"
LEGEND = "legend"
INPUT_TOKENS = "input_tokens"
OUTPUT_TOKENS = "output_tokens"


class WireFormatError(ValueError):
    """Kev 응답이 wire 형식과 다르다. 값은 메시지에 담지 않는다."""


@dataclass(frozen=True)
class WireQuestion:
    """질문 하나(질문 세트 파일의 항목). criteria 는 choice·noul 이면 dict, score 면 등급 이름 list."""

    qid: str
    kind: str
    instructions: str
    criteria: dict[str, str] | list[str] | None


@dataclass(frozen=True)
class ChoiceAnswer:
    choice: str
    confidence: float
    probabilities: dict[str, float]


@dataclass(frozen=True)
class YesAnswer:
    """noul 질문의 yes 확률."""

    probability: float


@dataclass(frozen=True)
class ScoreAnswer:
    score: float
    legend: dict[str, str]
    probabilities: dict[str, float] | None = None
    confidence: float | None = None


Answer = ChoiceAnswer | YesAnswer | ScoreAnswer


@dataclass(frozen=True)
class WireResult:
    answers: dict[str, Answer]
    latency: int | float | None


def question_from_file(qid: str, data: Mapping[str, Any]) -> WireQuestion:
    """질문 세트 파일 항목(wire 질문 모양 그대로)을 읽는다."""
    kind = data[QUESTION_TYPE]
    if kind not in QUESTION_TYPES:
        raise ValueError(f"질문 {qid}: 알 수 없는 type")
    return WireQuestion(qid, kind, data[QUESTION_INSTRUCTIONS], data.get(QUESTION_CRITERIA))


def build_request(state: str, model: str, questions: Mapping[str, WireQuestion]) -> dict:
    """POST /v1/systemone 요청 본문. criteria 가 없는 질문은 키를 넣지 않는다(03 §5.4 needsHumanReview)."""
    body: dict[str, Any] = {}
    for qid, question in questions.items():
        entry: dict[str, Any] = {
            QUESTION_TYPE: question.kind,
            QUESTION_INSTRUCTIONS: question.instructions,
        }
        if question.criteria is not None:
            entry[QUESTION_CRITERIA] = question.criteria
        body[qid] = entry
    return {STATE: state, MODEL: model, QUESTIONS: body}


def score_legend(question: WireQuestion) -> dict[str, str]:
    """score 질문의 등급 이름을 0부터 센 index → 이름으로."""
    return {str(index): name for index, name in enumerate(question.criteria or [])}


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise WireFormatError("숫자가 아니다")
    return value


def _probabilities(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        raise WireFormatError("probabilities 가 객체가 아니다")
    return {str(k): _number(v) for k, v in value.items()}


def _parse_answer(question: WireQuestion, raw: Any) -> Answer:
    if not isinstance(raw, Mapping):
        raise WireFormatError(f"질문 {question.qid}: 응답이 객체가 아니다")
    if question.kind == CHOICE:
        choice = raw.get(CHOICE)
        if not isinstance(choice, str) or choice not in (question.criteria or {}):
            raise WireFormatError(f"질문 {question.qid}: choice 가 선택지 밖이다")
        return ChoiceAnswer(
            choice, _number(raw.get(CONFIDENCE)), _probabilities(raw.get(PROBABILITIES))
        )
    if question.kind == NOUL:
        return YesAnswer(_number(raw.get(NOUL)))
    legend = raw.get(LEGEND, score_legend(question))
    if not isinstance(legend, Mapping):
        raise WireFormatError(f"질문 {question.qid}: legend 가 객체가 아니다")
    probabilities = raw.get(PROBABILITIES)
    confidence = raw.get(CONFIDENCE)
    return ScoreAnswer(
        _number(raw.get(SCORE)),
        {str(k): str(v) for k, v in legend.items()},
        None if probabilities is None else _probabilities(probabilities),
        None if confidence is None else _number(confidence),
    )


def parse_response(response: Any, questions: Mapping[str, WireQuestion]) -> WireResult:
    """Kev 응답을 질문별 답으로 읽는다. 형식이 다르면 WireFormatError."""
    if not isinstance(response, Mapping) or not isinstance(response.get(RESPONSES), Mapping):
        raise WireFormatError("responses 가 없다")
    raw = response[RESPONSES]
    missing = [qid for qid in questions if qid not in raw]
    if missing:
        raise WireFormatError(f"응답에 질문이 없다: {missing}")
    latency = response.get(LATENCY_MS)
    return WireResult(
        {qid: _parse_answer(q, raw[qid]) for qid, q in questions.items()},
        None if latency is None else _number(latency),
    )


def _answer_body(question: WireQuestion, answer: Answer) -> dict[str, Any]:
    if isinstance(answer, ChoiceAnswer):
        return {
            CHOICE: answer.choice,
            CONFIDENCE: answer.confidence,
            PROBABILITIES: dict(answer.probabilities),
        }
    if isinstance(answer, YesAnswer):
        return {NOUL: answer.probability}
    body: dict[str, Any] = {SCORE: answer.score, LEGEND: dict(answer.legend)}
    if answer.probabilities is not None:
        body[PROBABILITIES] = dict(answer.probabilities)
    if answer.confidence is not None:
        body[CONFIDENCE] = answer.confidence
    return body


def build_response(
    questions: Mapping[str, WireQuestion], answers: Mapping[str, Answer], latency: int = 0
) -> dict:
    """답으로 wire 응답 본문을 만든다(mock 공식 경로). fixtures/kev 파일과 같은 모양이다."""
    return {
        RESPONSES: {qid: _answer_body(q, answers[qid]) for qid, q in questions.items()},
        USAGE: {INPUT_TOKENS: 0, OUTPUT_TOKENS: 0},
        LATENCY_MS: latency,
    }


def wire_record(data: Mapping[str, Any]) -> dict:
    """응답 원문에서 저장할 부분만(fixture envelope 의 schemaVersion·fixtureId·provider·questionSetVersion 제외)."""
    if RESPONSES not in data:
        raise WireFormatError("responses 가 없다")
    return {RESPONSES: data[RESPONSES], USAGE: data.get(USAGE), LATENCY_MS: data.get(LATENCY_MS)}
