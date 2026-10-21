"""후보 id 매핑: 백엔드가 후보 순서를 어떻게 받든 확률은 id 로 되돌린다(NEEDS_REVIEW ↔ NOT_SATISFIED 가 바뀌지 않는다)."""

import math

from fakes import ByIdBackend

from sol_decision import contract, wire

STATUS_WEIGHTS = {"SATISFIED": 0.1, "NOT_SATISFIED": 0.2, "NEEDS_REVIEW": 0.7}


def _req(criteria: dict) -> dict:
    return {
        "state": "s",
        "questions": {
            "req.R1.status": {"type": "choice", "instructions": "Does it?", "criteria": criteria}
        },
    }


def test_choice_probabilities_keyed_by_candidate_id_in_any_order(make_client, auth):
    orders = [
        {"SATISFIED": "a", "NOT_SATISFIED": "b", "NEEDS_REVIEW": "c"},
        {"NEEDS_REVIEW": "c", "NOT_SATISFIED": "b", "SATISFIED": "a"},
        {"NOT_SATISFIED": "b", "NEEDS_REVIEW": "c", "SATISFIED": "a"},
    ]
    for criteria in orders:
        backend = ByIdBackend(STATUS_WEIGHTS)
        response = make_client(backend).post("/v1/systemone", json=_req(criteria), headers=auth)
        assert response.status_code == 200, response.text
        answer = response.json()["responses"]["req.R1.status"]
        assert answer["choice"] == "NEEDS_REVIEW"
        assert math.isclose(answer["probabilities"]["NEEDS_REVIEW"], 0.7)
        assert math.isclose(answer["probabilities"]["NOT_SATISFIED"], 0.2)
        assert math.isclose(answer["probabilities"]["SATISFIED"], 0.1)
        # 백엔드에는 criteria 순서 그대로의 후보가 갔다
        assert [c["id"] for c in backend.calls[0]["candidates"]] == list(criteria)


def test_positional_reading_would_swap_but_id_reading_does_not():
    """같은 확률 리스트를 후보 순서만 바꿔 넘기면, 위치로 읽으면 뒤바뀌고 id 로 읽으면 같다."""
    a = contract.candidates_for(
        wire.WireQuestion(
            type="choice", instructions="x", criteria={"NOT_SATISFIED": "", "NEEDS_REVIEW": ""}
        )
    )
    b = contract.candidates_for(
        wire.WireQuestion(
            type="choice", instructions="x", criteria={"NEEDS_REVIEW": "", "NOT_SATISFIED": ""}
        )
    )
    # 백엔드는 "후보 순서대로" 돌려주므로 b 는 리스트도 뒤집힌다
    assert contract.distribution_by_id(a, [0.3, 0.7]) == contract.distribution_by_id(b, [0.7, 0.3])
    assert contract.distribution_by_id(a, [0.3, 0.7])["NEEDS_REVIEW"] == 0.7


def test_score_and_noul_ids(make_client, auth):
    backend = ByIdBackend({"4": 0.6, "true": 0.9, "false": 0.1}, default=0.1)
    body = {
        "state": "s",
        "questions": {
            "fit": {"type": "score", "instructions": "x", "criteria": ["a", "b", "c", "d", "e"]},
            "risk.scale": {"type": "noul", "instructions": "x"},
        },
    }
    response = make_client(backend).post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 200
    fit = response.json()["responses"]["fit"]
    assert max(fit["probabilities"], key=fit["probabilities"].get) == "4"
    assert math.isclose(fit["score"], sum(int(k) * p for k, p in fit["probabilities"].items()))
    assert math.isclose(response.json()["responses"]["risk.scale"]["noul"], 0.9)
    assert [c["id"] for c in backend.calls[1]["candidates"]] == ["true", "false"]
