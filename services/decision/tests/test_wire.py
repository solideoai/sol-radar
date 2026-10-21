"""Kev wire 요청 검증(03 §5.4): 타입 3종, extra 필드, 질문 수, qid 길이, criteria 모양."""

import pytest
from pydantic import ValidationError

from sol_decision import wire

STATE = "COMPANY: ... NOTICE: ..."


def _request(questions: dict, **extra) -> dict:
    return {"state": STATE, "model": "bosun-v3.1-0.6b", "questions": questions, **extra}


CHOICE_Q = {
    "type": "choice",
    "instructions": "Which?",
    "criteria": {"BID": "a", "WATCH": "b", "NO_BID": "c"},
}
SCORE_Q = {
    "type": "score",
    "instructions": "How well?",
    "criteria": ["Very poor", "Poor", "Moderate", "Good", "Very good"],
}
NOUL_Q = {
    "type": "noul",
    "instructions": "Is it?",
    "criteria": {"true": "yes it is", "false": "no"},
}
NOUL_BARE_Q = {"type": "noul", "instructions": "Is it?"}


def test_three_types_parse():
    parsed = wire.WireRequest.model_validate(
        _request({"a": CHOICE_Q, "b": SCORE_Q, "c": NOUL_Q, "d": NOUL_BARE_Q})
    )
    assert [q.type for q in parsed.questions.values()] == ["choice", "score", "noul", "noul"]
    assert parsed.questions["d"].criteria is None
    assert parsed.model == "bosun-v3.1-0.6b"


def test_state_may_be_object_and_model_optional():
    parsed = wire.WireRequest.model_validate(
        {"state": {"notice": "x"}, "questions": {"a": CHOICE_Q}}
    )
    assert parsed.model is None
    assert parsed.state == {"notice": "x"}


@pytest.mark.parametrize(
    "body",
    [
        _request({"a": CHOICE_Q}, extra="no"),
        _request({"a": {**CHOICE_Q, "unknown": 1}}),
    ],
)
def test_extra_fields_rejected(body):
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(body)


def test_zero_questions_rejected():
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({}))


def test_24_questions_ok_25_rejected():
    ok = {f"q{i}": NOUL_BARE_Q for i in range(24)}
    assert len(wire.WireRequest.model_validate(_request(ok)).questions) == 24
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({f"q{i}": NOUL_BARE_Q for i in range(25)}))


def test_qid_length_limits():
    assert wire.WireRequest.model_validate(_request({"q" * 128: NOUL_BARE_Q}))
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({"q" * 129: NOUL_BARE_Q}))
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({"": NOUL_BARE_Q}))


@pytest.mark.parametrize(
    "question",
    [
        {"type": "choice", "instructions": "x", "criteria": ["a", "b"]},
        {"type": "choice", "instructions": "x", "criteria": {"only": "one"}},
        {"type": "choice", "instructions": "x"},
        {"type": "score", "instructions": "x", "criteria": {"0": "a", "1": "b"}},
        {"type": "score", "instructions": "x", "criteria": ["one"]},
        {"type": "noul", "instructions": "x", "criteria": ["true", "false"]},
        {"type": "noul", "instructions": "x", "criteria": {"yes": "a"}},
        {"type": "maybe", "instructions": "x"},
        {"type": "noul", "instructions": ""},
    ],
)
def test_criteria_shape_per_type(question):
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({"a": question}))


def test_candidate_upper_bound_255():
    ok = {"type": "choice", "instructions": "x", "criteria": {f"k{i}": "d" for i in range(255)}}
    assert wire.WireRequest.model_validate(_request({"a": ok}))
    too_many = {**ok, "criteria": {f"k{i}": "d" for i in range(256)}}
    with pytest.raises(ValidationError):
        wire.WireRequest.model_validate(_request({"a": too_many}))


def test_build_response_shape():
    body = wire.build_response({"a": {"noul": 0.5}}, latency_ms=12)
    assert body == {
        "responses": {"a": {"noul": 0.5}},
        "usage": {"input_tokens": 0, "output_tokens": 0},
        "latency_ms": 12,
    }
