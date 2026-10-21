"""타입 → 후보 → 답 변환(03 §5.4 변환 표). 순수 함수."""

import math

import pytest

from sol_decision import contract, wire


def _q(kind: str, criteria=None) -> wire.WireQuestion:
    return wire.WireQuestion(type=kind, instructions="x", criteria=criteria)


def test_choice_candidates_follow_criteria_order():
    question = _q("choice", {"BID": "met", "WATCH": "confirm", "NO_BID": "unmet"})
    assert [c.as_bosun() for c in contract.candidates_for(question)] == [
        {"id": "BID", "label": "BID", "description": "met"},
        {"id": "WATCH", "label": "WATCH", "description": "confirm"},
        {"id": "NO_BID", "label": "NO_BID", "description": "unmet"},
    ]


def test_score_candidates_are_index_ids_with_legend_labels():
    question = _q("score", ["Very poor", "Poor", "Moderate", "Good", "Very good"])
    assert [c.as_bosun() for c in contract.candidates_for(question)] == [
        {"id": "0", "label": "Very poor"},
        {"id": "1", "label": "Poor"},
        {"id": "2", "label": "Moderate"},
        {"id": "3", "label": "Good"},
        {"id": "4", "label": "Very good"},
    ]


def test_noul_candidates_default_yes_no():
    assert [c.as_bosun() for c in contract.candidates_for(_q("noul"))] == [
        {"id": "true", "label": "true", "description": "yes"},
        {"id": "false", "label": "false", "description": "no"},
    ]


def test_noul_candidates_use_criteria_descriptions():
    question = _q("noul", {"true": "likely unmet", "false": "all satisfied"})
    assert [c.description for c in contract.candidates_for(question)] == [
        "likely unmet",
        "all satisfied",
    ]
    partial = _q("noul", {"true": "only true given"})
    assert [c.description for c in contract.candidates_for(partial)] == ["only true given", "no"]


def test_distribution_by_id_normalizes_and_keys_by_id():
    candidates = contract.candidates_for(_q("choice", {"A": "", "B": "", "C": ""}))
    dist = contract.distribution_by_id(candidates, [1, 1, 2])
    assert dist == {"A": 0.25, "B": 0.25, "C": 0.5}
    assert math.isclose(sum(dist.values()), 1.0)


@pytest.mark.parametrize(
    ("probabilities", "code"),
    [
        ([0.5, 0.5, 0.0, 0.0], "LENGTH_MISMATCH"),
        ([0.5], "LENGTH_MISMATCH"),
        ([0.5, float("nan")], "NOT_FINITE"),
        ([0.5, float("inf")], "NOT_FINITE"),
        ([0.5, True], "NOT_FINITE"),
        ([0.7, -0.2], "NEGATIVE"),
        ([0.0, 0.0], "ZERO_SUM"),
    ],
)
def test_invalid_distributions(probabilities, code):
    candidates = contract.candidates_for(_q("noul"))
    with pytest.raises(contract.InvalidDistribution, match=code):
        contract.distribution_by_id(candidates, probabilities)


def test_choice_answer_argmax_and_tie_goes_to_earlier_key():
    question = _q("choice", {"SATISFIED": "", "NOT_SATISFIED": "", "NEEDS_REVIEW": ""})
    answer = contract.answer_for(question, [0.2, 0.4, 0.4])
    # 동률은 criteria 순서 앞(NOT_SATISFIED). 게이트웨이의 NEEDS_REVIEW 우선 규칙은 거기서 다시 적용한다
    assert answer["choice"] == "NOT_SATISFIED"
    assert math.isclose(answer["confidence"], 0.4)
    assert set(answer["probabilities"]) == {"SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"}


def test_score_answer_expected_grade_and_legend():
    legend = ["Very poor", "Poor", "Moderate", "Good", "Very good"]
    answer = contract.answer_for(_q("score", legend), [0.0, 0.1, 0.2, 0.3, 0.4])
    assert math.isclose(answer["score"], 0.1 + 0.4 + 0.9 + 1.6)
    # legend 는 Kev wire 와 같은 객체({"0": 이름, …}). 배열이면 worker 가 fit.legend 를 거부한다(WIRE_INVALID)
    assert answer["legend"] == dict(zip(["0", "1", "2", "3", "4"], legend, strict=True))
    assert list(answer["probabilities"]) == ["0", "1", "2", "3", "4"]
    assert math.isclose(answer["confidence"], 0.4)


def test_noul_answer_is_probability_of_true():
    answer = contract.answer_for(_q("noul"), [0.3, 0.7])
    assert answer == {"noul": 0.3}
