"""local Kev kev-qs/v0.2 지원(v0.2 명세 §1~§6, 03 §5.10~§5.12, 15 §2.1). 모델 서버는 127.0.0.1 가짜 kev.serve.

가짜 서버는 받은 묶음의 질문으로 응답을 만든다(KevResponder). 묶음 수·묶음당 질문 수·state·질문 순서와,
응답 매핑(scores·risks·calibration·requirements·stateTrace)을 본다.
"""

import pytest
from fake_models import Reply
from support import (
    AI_ROOT,
    LEGEND,
    NUMBER_TOKEN,
    extraction_fixture,
    kev_fixture,
    kev_request,
    text_ref,
)

SYSTEMONE = "/v1/systemone"
V0_2 = "kev-qs/v0.2"
CHUNK = 24
QS_DIR = AI_ROOT / "kev" / "question-sets"
EN_FILE = QS_DIR / "v0.2.json"
KO_FILE = QS_DIR / "v0.2.ko.json"
TEMPLATE_DIR = AI_ROOT / "kev" / "state-templates"
THRESHOLDS_FILE = AI_ROOT / "kev" / "thresholds.v0.1.json"
REQ = "req.{itemId}.status"
NOTICE_QIDS = {
    "recommendation",
    "mandatoryRisk",
    "needsHumanReview",
    "fit",
    "techFit",
    "perfRelevance",
    "risk.schedule",
    "risk.staffing",
    "risk.scale",
    "risk.techGap",
    "risk.scopeAmbiguity",
}
RISK_ORDER = ["risk.schedule", "risk.staffing", "risk.scale", "risk.techGap", "risk.scopeAmbiguity"]
NOUL = {
    "mandatoryRisk": 0.05,
    "needsHumanReview": 0.12,
    "risk.schedule": 0.69,  # τ 0.70 바로 아래
    "risk.staffing": 0.70,  # τ 와 같다 → overThreshold
    "risk.scale": 0.1,
    "risk.techGap": 0.2,
    "risk.scopeAmbiguity": 0.3,
}
SCORE = {"fit": 3.5, "techFit": 3.0, "perfRelevance": 2.0}
# 03 §5.4 score 답: score = 분포의 기대 등급 Σ i·p_i(P2b, 차이 0.05 이하), 분포 합 1, confidence = 최대 확률
SCORE_DISTRIBUTION = {
    "fit": {"0": 0, "1": 0, "2": 0, "3": 0.5, "4": 0.5},  # 3.5
    "techFit": {"0": 0, "1": 0, "2": 0.2, "3": 0.6, "4": 0.2},  # 3.0
    "perfRelevance": {"0": 0, "1": 0.2, "2": 0.6, "3": 0.2, "4": 0},  # 2.0
}
DEFAULT_REQ = {"SATISFIED": 0.6, "NOT_SATISFIED": 0.1, "NEEDS_REVIEW": 0.3}


class KevResponder:
    """/v1/systemone 묶음마다 받은 질문으로 03 §5.4 응답을 만든다. 만든 응답을 순서대로 남긴다."""

    def __init__(self, *, requirements=None, fail_on_call=None, failure=None, delay=0.0):
        self.requirements = requirements or {}
        self.fail_on_call = fail_on_call
        self.failure = failure
        self.delay = delay
        self.calls = 0
        self.replies: list[dict] = []

    def answer(self, qid: str, question: dict) -> dict:
        if qid.startswith("req."):
            dist = self.requirements.get(qid[len("req.") : -len(".status")], DEFAULT_REQ)
            choice = max(dist, key=dist.get)
            return {"choice": choice, "confidence": dist[choice], "probabilities": dict(dist)}
        if question["type"] == "choice":
            return kev_fixture("FX-01")["responses"]["recommendation"]
        if question["type"] == "noul":
            return {"noul": NOUL[qid]}
        probabilities = SCORE_DISTRIBUTION[qid]
        return {
            "score": SCORE[qid],
            "legend": LEGEND,
            "probabilities": dict(probabilities),
            "confidence": max(probabilities.values()),
        }

    def __call__(self, recorded) -> Reply:
        self.calls += 1
        if self.fail_on_call == self.calls:
            return self.failure
        questions = recorded.json()["questions"]
        reply = {
            "responses": {qid: self.answer(qid, q) for qid, q in questions.items()},
            "usage": {"input_tokens": 600, "output_tokens": len(questions)},
            "latency_ms": 100 + self.calls,
        }
        self.replies.append(reply)
        headers = {"x-typesafe-request-id": f"req-typesafe-{self.calls}"}
        return Reply(json_body=reply, headers=headers, delay=self.delay)


def ref(quote: str, match: str = "NORMALIZED") -> dict:
    return {**text_ref(quote), "match": match, "charStart": 0, "charEnd": len(quote)}


def v02_extraction(skills: int = 10, past: int = 3, staff: int = 3, past_text: str = "") -> dict:
    """Kev 담당 항목: requiredSkills·pastPerformance·staffing 원소 전부 + qualifications 중 code=null(0·2번)."""
    ext = extraction_fixture("FX-01")
    ext["requiredSkills"] = {
        "value": [f"Skill{i}" for i in range(skills)],
        "state": "KNOWN",
        "evidence": [ref("required skill list"), ref("quote not in notice", "FAILED")],
    }
    ext["pastPerformance"] = {
        "value": [
            {
                "description": f"public sector data platform project {i}{past_text}",
                "minCount": 1,
                "withinYears": 3,
                "mandatory": True,
            }
            for i in range(past)
        ],
        "state": "KNOWN",
        "evidence": [ref("past performance requirement")],
    }
    ext["staffing"] = {
        "value": [
            {"role": f"Engineer{i}", "minCount": 1, "mandatory": False} for i in range(staff)
        ],
        "state": "KNOWN",
        "evidence": [ref("staffing requirement")],
    }
    ext["qualifications"] = {
        "value": [
            {"name": "Construction license", "kind": "LICENSE", "mandatory": True, "code": None},
            {
                "name": "소프트웨어사업자 신고확인서",
                "kind": "REGISTRATION",
                "mandatory": True,
                "code": "SW_BUSINESS_REG",
            },
            {
                "name": "Cloud operations certificate",
                "kind": "CERTIFICATION",
                "mandatory": False,
                "code": None,
            },
        ],
        "state": "KNOWN",
        "evidence": [ref("qualification requirement")],
    }
    return ext


def item_ids(skills=10, past=3, staff=3) -> list[str]:
    return (
        [f"requiredSkills[{i}]" for i in range(skills)]
        + [f"pastPerformance[{i}]" for i in range(past)]
        + [f"staffing[{i}]" for i in range(staff)]
        + ["qualifications[0]", "qualifications[2]"]
    )


@pytest.fixture
def v02(make_client, local_models, monkeypatch):
    """KEV_QUESTION_SET=kev-qs/v0.2 local 앱과 묶음 응답기. call(request) 로 /kev 를 부른다."""
    monkeypatch.setenv("KEV_QUESTION_SET", V0_2)

    class Run:
        responder = KevResponder()

        def client(self):
            local_models.kev.respond_with("POST", SYSTEMONE, self.responder)
            return make_client(SOL_RUN_MODE="fixture")

        def call(self, request=None, client=None):
            response = (client or self.client()).post(
                "/kev", json=request or kev_request("FX-01", extraction=v02_extraction())
            )
            assert response.status_code == 200
            return response.json()

        def recorded(self):
            return local_models.kev.calls("POST", SYSTEMONE)

        def sent(self) -> list[dict]:
            return [r.json() for r in self.recorded()]

    return Run()


def sent_qids(run) -> list[str]:
    return [qid for body in run.sent() for qid in body["questions"]]


# ---------------------------------------------------------------- 파일·기동


# ---------------------------------------------------------------- 질문·분할(§3)


# ---------------------------------------------------------------- state(§2)


def state_of(run) -> str:
    return run.sent()[0]["state"]


# ---------------------------------------------------------------- 응답 매핑(§4)


def test_v0_2_scores(v02):
    assert v02.call()["kev"]["scores"] == {
        "techFit": {"score": 3.0, "legend": LEGEND},
        "perfRelevance": {"score": 2.0, "legend": LEGEND},
    }


# ---------------------------------------------------------------- 묶음 실패 → 전체 KEV_UNAVAILABLE(§3)


def chunk_values_out_of_range() -> KevResponder:
    bad = KevResponder()
    original = bad.answer

    def answer(qid, question):
        reply = original(qid, question)
        return {"noul": 1.5} if qid.startswith("risk.") and reply.get("noul") is not None else reply

    bad.answer = answer
    return bad


def test_v0_2_invalid_values_in_a_chunk_disable_everything(v02):
    v02.responder = chunk_values_out_of_range()
    result = v02.call()
    assert (result["kev"]["enabled"], result["errorCode"], result["requirements"]) == (
        False,
        "KEV_UNAVAILABLE",
        None,
    )


# ---------------------------------------------------------------- stateTrace(§5)


def trace_of(result) -> dict:
    return result["kev"]["stateTrace"]


def company_refs(trace) -> list[dict]:
    return [ref for line in trace["lines"] for ref in line["companyEvidence"]]


# ---------------------------------------------------------------- ko.v0.2(§2, KEV_ALLOW_KO_STATE)


@pytest.fixture
def ko_run(v02, monkeypatch):
    monkeypatch.setenv("KEV_ALLOW_KO_STATE", "true")
    client = v02.client()
    english = client.post("/kev", json=kev_request("FX-01", extraction=v02_extraction())).json()
    en_calls = len(v02.sent())
    korean = client.post(
        "/kev", json=kev_request("FX-01", extraction=v02_extraction(), stateLanguage="ko")
    ).json()
    return {
        "english": english,
        "korean": korean,
        "en_state": v02.sent()[0]["state"],
        "ko_state": v02.sent()[en_calls]["state"],
        "ko_bodies": v02.sent()[en_calls:],
    }


def line_numbers(lines: list[str]) -> list[list[str]]:
    return [[t.replace(",", "") for t in NUMBER_TOKEN.findall(line)] for line in lines]


def markers(text: str) -> list[str]:
    return sorted(i for i in item_ids() if f"[{i}]" in text)


def test_v0_2_korean_state_is_refused_without_allow(v02):
    request = kev_request("FX-01", extraction=v02_extraction(), stateLanguage="ko")
    response = v02.client().post("/kev", json=request)
    assert (response.status_code, response.json()["errorCode"]) == (422, "KO_STATE_NOT_ALLOWED")
