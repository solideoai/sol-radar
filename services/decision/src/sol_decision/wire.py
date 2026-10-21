"""Kev wire 형식(docs/03 §5.4). 요청은 pydantic 으로 검증하고, 응답은 dict 로 만든다.

게이트웨이(services/ai `adapters/kev_wire.py`)가 보내는 요청과 그 파서가 요구하는 응답 모양을 여기서만 다룬다.
필드 이름을 다른 모듈에 하드코딩하지 않는다.

요청: {model?: str, state: str | object, questions: {qid: {type, instructions, criteria?}}}
- 알 수 없는 필드는 거절(extra="forbid"). 질문은 1~24개, qid 는 1~128자.
- choice: criteria 는 dict(선택지 키 → 설명), 2~255개. score: criteria 는 등급 이름 list, 2~255개.
  noul: criteria 는 {true?, false?} dict 또는 없음.
응답: {responses: {qid: 답}, usage: {input_tokens, output_tokens}, latency_ms} + 헤더 x-typesafe-request-id.
- choice 답 {choice, confidence, probabilities{key}}, score 답 {score, probabilities{"0".."N-1"}, confidence, legend},
  noul 답 {noul}. 계산은 contract 가 한다.
"""

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# 질문 타입
CHOICE = "choice"
SCORE = "score"
NOUL = "noul"
QUESTION_TYPES = (CHOICE, SCORE, NOUL)

# 응답 필드
RESPONSES = "responses"
USAGE = "usage"
INPUT_TOKENS = "input_tokens"
OUTPUT_TOKENS = "output_tokens"
LATENCY_MS = "latency_ms"
CONFIDENCE = "confidence"
PROBABILITIES = "probabilities"
LEGEND = "legend"
# 응답 헤더(03 §5.4). 게이트웨이가 KevAssist.requestId 로 옮긴다
REQUEST_ID_HEADER = "x-typesafe-request-id"

MIN_QUESTIONS = 1
MAX_QUESTIONS = 24
MAX_QID_CHARS = 128
# Bosun 후보 수 범위(modeling_bosun.render_decision_prompt)
MIN_CANDIDATES = 2
MAX_CANDIDATES = 255
NOUL_KEYS = frozenset({"true", "false"})


class WireQuestion(BaseModel):
    """질문 하나. 타입마다 criteria 모양이 정해져 있다."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["choice", "score", "noul"]
    instructions: str = Field(min_length=1)
    criteria: dict[str, str] | list[str] | None = None

    @model_validator(mode="after")
    def _criteria_shape(self) -> "WireQuestion":
        if self.type == CHOICE:
            if not isinstance(self.criteria, dict):
                raise ValueError("choice 질문의 criteria 는 선택지 객체여야 한다")
            _check_count(len(self.criteria), "choice 선택지")
        elif self.type == SCORE:
            if not isinstance(self.criteria, list):
                raise ValueError("score 질문의 criteria 는 등급 이름 목록이어야 한다")
            _check_count(len(self.criteria), "score 등급")
        elif isinstance(self.criteria, list):
            raise ValueError("noul 질문의 criteria 는 {true, false} 객체 또는 없음이어야 한다")
        elif self.criteria is not None and not set(self.criteria) <= NOUL_KEYS:
            raise ValueError("noul 질문의 criteria 키는 true·false 만 받는다")
        return self


def _check_count(count: int, what: str) -> None:
    if not MIN_CANDIDATES <= count <= MAX_CANDIDATES:
        raise ValueError(f"{what}은 {MIN_CANDIDATES}~{MAX_CANDIDATES}개여야 한다")


class WireRequest(BaseModel):
    """POST /v1/systemone 본문."""

    model_config = ConfigDict(extra="forbid")

    model: str | None = None
    state: str | dict[str, Any]
    questions: dict[str, WireQuestion] = Field(min_length=MIN_QUESTIONS, max_length=MAX_QUESTIONS)

    @model_validator(mode="after")
    def _qid_length(self) -> "WireRequest":
        for qid in self.questions:
            if not 1 <= len(qid) <= MAX_QID_CHARS:
                raise ValueError(f"질문 id 는 1~{MAX_QID_CHARS}자여야 한다")
        return self


def build_response(
    answers: Mapping[str, Mapping[str, Any]],
    *,
    latency_ms: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> dict[str, Any]:
    """질문별 답(contract 가 만든 dict)으로 응답 본문을 만든다."""
    return {
        RESPONSES: {qid: dict(answer) for qid, answer in answers.items()},
        USAGE: {INPUT_TOKENS: input_tokens, OUTPUT_TOKENS: output_tokens},
        LATENCY_MS: latency_ms,
    }
