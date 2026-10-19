"""Kev wire 형식(docs/03 §5.4, Kev README 기준). wire 필드명과 요청 본문 모양은 이 모듈에서만 다룬다.

다른 모듈은 여기 함수와 상수를 쓴다. 필드명을 다른 곳에 하드코딩하지 않는다(03 §5.7).
"""

import math
from collections.abc import Collection, Mapping
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
# 응답 헤더(03 §5.4). KevAssist.requestId 로 옮긴다
REQUEST_ID_HEADER = "x-typesafe-request-id"
# 선택지 분포 합의 허용 오차(보안 점검 Low)
PROBABILITY_SUM_TOLERANCE = 0.01


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
    """score 질문의 답(03 §5.4): 0부터 센 평균 등급 index·등급 이름·등급별 확률·confidence.

    score·probabilities·confidence 는 응답에 꼭 있어야 한다. 등급 이름(legend)은 질문 세트에서 온다(C5-A S9).
    """

    score: float
    legend: dict[str, str]
    probabilities: dict[str, float]
    confidence: float


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


def _number(value: Any, low: float | None = None, high: float | None = None) -> float:
    """유한한 숫자이고 [low, high] 안이어야 한다. NaN·Infinity·bool 은 받지 않는다."""
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise WireFormatError("유한한 숫자가 아니다")
    if (low is not None and value < low) or (high is not None and value > high):
        raise WireFormatError("숫자가 범위 밖이다")
    return value


def _probabilities(value: Any, allowed_keys: Collection[str]) -> dict[str, float]:
    """각 값이 [0, 1] 이고 합이 1 ± 0.01 인 분포. 키는 allowed_keys 의 부분집합이어야 한다(C5-A S9)."""
    if not isinstance(value, Mapping) or not value:
        raise WireFormatError("probabilities 가 객체가 아니다")
    if not all(isinstance(k, str) and k in allowed_keys for k in value):
        raise WireFormatError("probabilities 키가 선택지·등급 밖이다")
    distribution = {k: _number(v, 0, 1) for k, v in value.items()}
    if abs(sum(distribution.values()) - 1) > PROBABILITY_SUM_TOLERANCE:
        raise WireFormatError("probabilities 합이 1 이 아니다")
    return distribution


# 03 §5.4: score 는 "0부터 시작하는 평균 등급 index" 다. 같은 답의 등급 분포에서 구한 기대 등급
# Σ int(등급)·p(등급) 과 이보다 크게 다르면 score 와 분포가 서로 맞지 않는 응답으로 보고 거절한다.
# 0.05 는 fixture·Kev 응답의 소수 둘째 자리 반올림을 받아 주는 여유다(e8 판정 P2b).
SCORE_EXPECTED_GRADE_TOLERANCE = 0.05


def _expected_grade(probabilities: Mapping[str, float]) -> float:
    try:
        return sum(int(grade) * p for grade, p in probabilities.items())
    except ValueError as error:
        raise WireFormatError("score probabilities 의 등급 키가 정수가 아니다") from error


def _parse_answer(question: WireQuestion, raw: Any) -> Answer:
    if not isinstance(raw, Mapping):
        raise WireFormatError(f"질문 {question.qid}: 응답이 객체가 아니다")
    if question.kind == CHOICE:
        options = question.criteria or {}
        choice = raw.get(CHOICE)
        if not isinstance(choice, str) or choice not in options:
            raise WireFormatError(f"질문 {question.qid}: choice 가 선택지 밖이다")
        return ChoiceAnswer(
            choice,
            _number(raw.get(CONFIDENCE), 0, 1),
            _probabilities(raw.get(PROBABILITIES), options),
        )
    if question.kind == NOUL:
        return YesAnswer(_number(raw.get(NOUL), 0, 1))
    # score: 등급 이름은 질문 세트 것을 쓴다. 서버가 보낸 legend 는 값도 모양도 보지 않는다(C5-A S9).
    # 응답 원문(wire)은 그대로 저장되므로 서버 legend 는 거기에만 남는다
    legend = score_legend(question)
    if PROBABILITIES not in raw or CONFIDENCE not in raw:
        # score 답의 등급 분포·confidence 는 선택이 아니다(e8 판정 P2a)
        raise WireFormatError(f"질문 {question.qid}: score 답에 probabilities·confidence 가 없다")
    # score 는 0부터 센 평균 등급 index 라 [0, 등급 수 - 1](v0.1 fit 은 [0, 4])
    top_grade = max(len(question.criteria or []) - 1, 0)
    score = _number(raw.get(SCORE), 0, top_grade)
    # 등급 키는 "0".."N-1" 표기만 받는다("00"·"+1"·"-0"·" 3"·"٣" 처럼 int() 가 읽어 주는 변형도 거절)
    probabilities = _probabilities(raw.get(PROBABILITIES), legend.keys())
    if abs(score - _expected_grade(probabilities)) > SCORE_EXPECTED_GRADE_TOLERANCE:
        raise WireFormatError(f"질문 {question.qid}: score 가 등급 분포의 기대 등급과 다르다")
    return ScoreAnswer(
        score,
        legend,
        probabilities,
        _number(raw.get(CONFIDENCE), 0, 1),
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
        None if latency is None else _number(latency, 0),
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
    return {
        SCORE: answer.score,
        LEGEND: dict(answer.legend),
        PROBABILITIES: dict(answer.probabilities),
        CONFIDENCE: answer.confidence,
    }


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
