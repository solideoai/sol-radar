"""게이트웨이 파서 parity: services/ai 의 kev_wire.build_request 로 만든 요청을 우리 서버에 보내고,
같은 모듈의 kev_wire.parse_response 로 응답을 읽는다. WireFormatError 가 나지 않아야 한다."""

import math

from fakes import ByIdBackend

from sol_decision.backend import FakeBackend

MODEL = "bosun-v3.1-0.6b"


def _questions(kev_wire, question_set: dict, item_ids=("R1", "R2")) -> dict:
    questions = {}
    for qid, data in question_set["questions"].items():
        if "{itemId}" in qid:
            for item_id in item_ids:
                real_qid = qid.replace("{itemId}", item_id)
                entry = {**data, "instructions": data["instructions"].replace("{itemId}", item_id)}
                questions[real_qid] = kev_wire.question_from_file(real_qid, entry)
        else:
            questions[qid] = kev_wire.question_from_file(qid, data)
    return questions


def test_v02_question_set_round_trip_parses_with_gateway_parser(
    kev_wire, question_set, make_client, auth
):
    questions = _questions(kev_wire, question_set)
    assert len(questions) <= 24
    body = kev_wire.build_request("COMPANY ... NOTICE ...", MODEL, questions)
    response = make_client(FakeBackend()).post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 200, response.text
    assert response.headers[kev_wire.REQUEST_ID_HEADER]
    result = kev_wire.parse_response(response.json(), questions)
    assert set(result.answers) == set(questions)
    assert isinstance(result.answers["recommendation"], kev_wire.ChoiceAnswer)
    assert isinstance(result.answers["fit"], kev_wire.ScoreAnswer)
    assert isinstance(result.answers["mandatoryRisk"], kev_wire.YesAnswer)
    assert isinstance(result.answers["needsHumanReview"], kev_wire.YesAnswer)
    assert isinstance(result.answers["req.R1.status"], kev_wire.ChoiceAnswer)
    assert result.latency is not None and result.latency >= 0


def test_skewed_distributions_still_satisfy_parser_tolerances(
    kev_wire, question_set, make_client, auth
):
    """합 1±0.01, score=Σ i·p_i ±0.05, 키는 선택지·등급 안: 치우친 분포도 통과한다."""
    questions = _questions(kev_wire, question_set, item_ids=("R9",))
    backend = ByIdBackend({"4": 0.97, "NEEDS_REVIEW": 0.98, "true": 0.999}, default=0.0001)
    body = kev_wire.build_request("state", MODEL, questions)
    response = make_client(backend).post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 200
    result = kev_wire.parse_response(response.json(), questions)
    fit = result.answers["fit"]
    assert math.isclose(
        fit.score, sum(int(g) * p for g, p in fit.probabilities.items()), abs_tol=1e-9
    )
    assert fit.legend == kev_wire.score_legend(questions["fit"])
    assert result.answers["req.R9.status"].choice == "NEEDS_REVIEW"
    assert result.answers["risk.scale"].probability > 0.99


def test_wire_record_accepts_our_body(kev_wire, question_set, make_client, auth):
    questions = _questions(kev_wire, question_set, item_ids=())
    body = kev_wire.build_request("state", MODEL, questions)
    response = make_client().post("/v1/systemone", json=body, headers=auth)
    record = kev_wire.wire_record(response.json())
    assert set(record) == {kev_wire.RESPONSES, kev_wire.USAGE, kev_wire.LATENCY_MS}
