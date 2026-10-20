"""worker 호환: 우리 서버의 원본 응답 본문은 게이트웨이를 그대로 지나 worker 가 다시 검사한다
(web/server/analysis/analysis.model.ts readKevWire → web/server/scoring/analysis-input.model.ts kevMockResponseSchema).
그래서 responses 의 모양은 Kev wire fixture(fixtures/kev/FX-*.json)와 같아야 한다. 특히 fit.legend 는
{"0": 이름, …} 객체다(배열이면 모든 /kev 응답이 WIRE_INVALID 로 버려진다 — 2026-10-20 08 세션 발견).

tests/fixtures/worker-wire-sample.json 은 이 서버(FakeBackend, seed 0)가 v0.2 질문 세트에 낸 responses 의 정본 사본이다.
web/server/analysis/decision-wire-compat.test.ts 가 같은 파일을 읽어 worker 스키마로 검사한다. 모양이 바뀌면 여기서 먼저 깨진다.
"""

import json
from pathlib import Path

from test_parity import MODEL, _questions

from sol_decision.backend import FakeBackend

SAMPLE_FILE = Path(__file__).parent / "fixtures" / "worker-wire-sample.json"
SAMPLE_STATE = "COMPANY ... NOTICE ... (worker compat sample)"
SAMPLE_ITEM_IDS = ("R1", "R2")


def build_sample_responses(kev_wire, question_set, make_client, auth) -> dict:
    questions = _questions(kev_wire, question_set, item_ids=SAMPLE_ITEM_IDS)
    body = kev_wire.build_request(SAMPLE_STATE, MODEL, questions)
    response = make_client(FakeBackend()).post("/v1/systemone", json=body, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["responses"]


def test_fit_legend_is_grade_index_object_like_kev_wire(kev_wire, question_set, make_client, auth):
    responses = build_sample_responses(kev_wire, question_set, make_client, auth)
    fit = responses["fit"]
    legend = fit["legend"]
    assert isinstance(legend, dict), "fit.legend 는 배열이 아니라 {index: 이름} 객체여야 한다"
    assert list(legend) == ["0", "1", "2", "3", "4"]
    assert legend == kev_wire.score_legend(_questions(kev_wire, question_set)["fit"])
    assert set(fit["probabilities"]) == set(legend)
    assert all(isinstance(name, str) and name for name in legend.values())


def test_core_four_answers_match_worker_wire_shape(kev_wire, question_set, make_client, auth):
    """worker kevMockResponseSchema 가 요구하는 네 답의 키·범위."""
    responses = build_sample_responses(kev_wire, question_set, make_client, auth)
    rec = responses["recommendation"]
    assert rec["choice"] in {"BID", "WATCH", "NO_BID"}
    assert set(rec["probabilities"]) == {"BID", "WATCH", "NO_BID"}
    assert 0 <= rec["confidence"] <= 1
    for qid in ("mandatoryRisk", "needsHumanReview"):
        assert set(responses[qid]) == {"noul"}
        assert 0 <= responses[qid]["noul"] <= 1
    assert 0 <= responses["fit"]["score"] <= 4


def test_committed_sample_matches_current_server_output(kev_wire, question_set, make_client, auth):
    """정본 사본이 서버 출력과 같다. 모양을 바꿨으면 사본을 다시 만들고 web 쪽 시험도 함께 돈다:

    SOL_DECISION_WRITE_SAMPLE=1 uv run pytest tests/test_worker_compat.py -k committed
    pnpm -C web exec vitest run server/analysis/decision-wire-compat.test.ts
    """
    import os

    responses = build_sample_responses(kev_wire, question_set, make_client, auth)
    if os.environ.get("SOL_DECISION_WRITE_SAMPLE") == "1":
        SAMPLE_FILE.write_text(
            json.dumps({"responses": responses}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    assert SAMPLE_FILE.is_file(), f"{SAMPLE_FILE} 가 없다. SOL_DECISION_WRITE_SAMPLE=1 로 만든다"
    committed = json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))["responses"]
    assert committed == responses, (
        f"{SAMPLE_FILE} 가 서버 출력과 다르다. SOL_DECISION_WRITE_SAMPLE=1 로 다시 만든다"
    )
