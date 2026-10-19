"""local Kev kev-qs/v0.2 지원(v0.2 명세 §1~§6, 03 §5.10~§5.12, 15 §2.1). 모델 서버는 127.0.0.1 가짜 kev.serve.

가짜 서버는 받은 묶음의 질문으로 응답을 만든다(KevResponder). 묶음 수·묶음당 질문 수·state·질문 순서와,
응답 매핑(scores·risks·calibration·requirements·stateTrace)을 본다.
"""

import hashlib

import pytest
from fake_models import Reply
from support import (
    AI_ROOT,
    HANGUL,
    KEV_DISCLAIMER,
    KEV_KEY,
    LEGEND,
    NUMBER_TOKEN,
    PROFILE,
    extraction_fixture,
    kev_fixture,
    kev_request,
    load_json,
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
        probabilities = {"0": 0, "1": 0, "2": 0.5, "3": 0.5, "4": 0}
        return {
            "score": SCORE[qid],
            "legend": LEGEND,
            "probabilities": probabilities,
            "confidence": 0.5,
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


def test_state_template_files_exist():
    assert [(TEMPLATE_DIR / n).is_file() for n in ("en.v0.2.txt", "ko.v0.2.txt")] == [True, True]


def test_thresholds_file_values():
    data = load_json(THRESHOLDS_FILE)
    assert {k: data[k] for k in ("version", "status", "threshold", "datasetVersion")} == {
        "version": "kev-thresholds/v0.1",
        "status": "UNCALIBRATED",
        "threshold": 0.70,
        "datasetVersion": None,
    }


def test_local_v0_2_health_reports_question_set(v02):
    body = v02.client().get("/health").json()
    assert (body["questionSets"], body["kev"]["registryMatch"]) == ([V0_2], True)


# ---------------------------------------------------------------- 질문·분할(§3)


def test_v0_2_questions_are_split_into_chunks_of_24(v02):
    v02.call()
    assert [len(b["questions"]) for b in v02.sent()] == [CHUNK, 11 + 18 - CHUNK]


def test_v0_2_chunks_share_the_same_state(v02):
    v02.call()
    states = {b["state"] for b in v02.sent()}
    assert (len(v02.sent()), len(states)) == (2, 1)


def test_v0_2_chunks_carry_bearer_and_request_model(v02):
    v02.call()
    headers = {r.headers.get("authorization") for r in v02.recorded()}
    assert (headers, {b["model"] for b in v02.sent()}) == ({f"Bearer {KEV_KEY}"}, {"kev-latest"})


def test_v0_2_notice_questions_come_first(v02):
    v02.call()
    assert set(sent_qids(v02)[:11]) == NOTICE_QIDS


def test_v0_2_item_questions_follow_item_order(v02):
    v02.call()
    assert sent_qids(v02)[11:] == [f"req.{i}.status" for i in item_ids()]


def test_v0_2_notice_questions_are_file_originals(v02):
    v02.call()
    sent = {qid: q for body in v02.sent() for qid, q in body["questions"].items()}
    originals = load_json(EN_FILE)["questions"]
    assert {qid: sent[qid] for qid in NOTICE_QIDS} == {qid: originals[qid] for qid in NOTICE_QIDS}


def test_v0_2_item_questions_replace_item_placeholder(v02):
    v02.call()
    sent = {qid: q for body in v02.sent() for qid, q in body["questions"].items()}
    template = load_json(EN_FILE)["questions"][REQ]
    for item in item_ids():
        assert sent[f"req.{item}.status"] == {
            **template,
            "instructions": template["instructions"].replace("{itemId}", item),
        }


def test_v0_2_items_exclude_coded_qualifications_and_non_known_fields(v02):
    ext = v02_extraction()
    ext["staffing"] = {"value": None, "state": "UNKNOWN", "evidence": []}
    ext["pastPerformance"]["state"] = "CONFLICTED"
    ext["pastPerformance"]["value"] = None
    v02.call(kev_request("FX-01", extraction=ext))
    items = [q for q in sent_qids(v02) if q.startswith("req.")]
    expected = [f"requiredSkills[{i}]" for i in range(10)] + [
        "qualifications[0]",
        "qualifications[2]",
    ]
    assert items == [f"req.{i}.status" for i in expected]


def test_v0_2_notice_questions_follow_question_set_file_order(v02):
    # 명세는 공고 질문 11개 사이의 순서를 정하지 않았다. 학습 데이터(ADR-027)와 같은 파일을 쓰므로
    # 재현성을 위해 질문 세트 파일 순서(항목 틀 req.{itemId}.status 를 뺀 순서)로 고정한다
    v02.call()
    file_order = [q for q in load_json(EN_FILE)["questions"] if q != REQ]
    assert sent_qids(v02)[:11] == file_order


def test_v0_2_non_known_field_values_are_not_items(v02):
    # KNOWN 이 아닌 필드는 값이 남아 있어도 담당 항목이 아니다(줄도 질문도 없다)
    ext = v02_extraction()
    ext["staffing"]["state"] = "UNKNOWN"
    ext["pastPerformance"]["state"] = "NOT_APPLICABLE"
    v02.call(kev_request("FX-01", extraction=ext))
    state = state_of(v02)
    items = [q for q in sent_qids(v02) if q.startswith(("req.staffing", "req.pastPerformance"))]
    assert (items, "[staffing[" in state, "[pastPerformance[" in state) == ([], False, False)


def test_v0_2_env_question_set_wins_over_request_version(v02):
    request = kev_request("FX-01", extraction=v02_extraction(), questionSetVersion="kev-qs/v0.1")
    assert v02.call(request)["kev"]["questionSetVersion"] == V0_2


# ---------------------------------------------------------------- state(§2)


def state_of(run) -> str:
    return run.sent()[0]["state"]


def test_v0_2_state_marks_each_kev_item_on_one_line(v02):
    v02.call()
    lines = state_of(v02).split("\n")
    assert {
        item: sum(f"[{item}]" in line for line in lines) for item in item_ids()
    } == dict.fromkeys(item_ids(), 1)


def test_v0_2_state_has_no_marker_for_coded_qualification(v02):
    v02.call()
    assert "[qualifications[1]]" not in state_of(v02)


def test_v0_2_state_has_no_hangul(v02):
    v02.call()
    assert HANGUL.findall(state_of(v02)) == []


def test_v0_2_state_hash_is_sha256_of_sent_state(v02):
    result = v02.call()
    assert result["stateHash"] == hashlib.sha256(state_of(v02).encode("utf-8")).hexdigest()


def test_v0_2_long_state_drops_past_performance_items_from_the_back(v02):
    long_text = " covering " + "integration and migration " * 25  # 약 650자
    ext = v02_extraction(past=40, past_text=long_text)
    v02.call(kev_request("FX-01", extraction=ext))
    state = state_of(v02)
    kept = [i for i in range(40) if f"[pastPerformance[{i}]]" in state]
    asked = [i for i in range(40) if f"req.pastPerformance[{i}].status" in sent_qids(v02)]
    assert len(state) / 4 <= 6000
    assert (kept == list(range(len(kept))), len(kept) < 40, asked == kept) == (True, True, True)


def test_v0_2_long_state_keeps_other_items(v02):
    long_text = " covering " + "integration and migration " * 25
    v02.call(kev_request("FX-01", extraction=v02_extraction(past=40, past_text=long_text)))
    state = state_of(v02)
    assert [i for i in range(10) if f"[requiredSkills[{i}]]" in state] == list(range(10))


# ---------------------------------------------------------------- 응답 매핑(§4)


def test_v0_2_keeps_v0_1_assist_fields(v02):
    kev = v02.call()["kev"]
    assert (
        kev["enabled"],
        kev["provider"],
        kev["questionSetVersion"],
        kev["suggestedOption"],
        kev["probabilities"],
        kev["mandatoryRisk"],
        kev["needsHumanReview"],
        kev["fit"],
        kev["disclaimer"],
    ) == (
        True,
        "local",
        V0_2,
        "BID",
        {"BID": 0.71, "WATCH": 0.24, "NO_BID": 0.05},
        0.05,
        0.12,
        {"score": 3.5, "legend": LEGEND},
        KEV_DISCLAIMER,
    )


def test_v0_2_scores(v02):
    assert v02.call()["kev"]["scores"] == {
        "techFit": {"score": 3.0, "legend": LEGEND},
        "perfRelevance": {"score": 2.0, "legend": LEGEND},
    }


def test_v0_2_risks_follow_03_order_and_threshold_boundary(v02):
    assert v02.call()["kev"]["risks"] == [
        {"qid": qid, "probability": NOUL[qid], "overThreshold": NOUL[qid] >= 0.70}
        for qid in RISK_ORDER
    ]


def test_v0_2_risk_at_tau_is_over_threshold(v02):
    risks = {r["qid"]: r["overThreshold"] for r in v02.call()["kev"]["risks"]}
    assert (risks["risk.schedule"], risks["risk.staffing"]) == (False, True)


def test_v0_2_calibration_comes_from_thresholds_file(v02):
    assert v02.call()["kev"]["calibration"] == {
        "status": "UNCALIBRATED",
        "datasetVersion": None,
        "threshold": 0.7,
        "thresholdsVersion": "kev-thresholds/v0.1",
    }


def test_v0_2_requirements_per_item(v02):
    requirements = v02.call()["requirements"]
    assert requirements == [
        {
            "itemId": item,
            "qid": f"req.{item}.status",
            "distribution": DEFAULT_REQ,
            "label": "SATISFIED",
        }
        for item in item_ids()
    ]


@pytest.mark.parametrize(
    ("distribution", "label"),
    [
        ({"SATISFIED": 0.4, "NOT_SATISFIED": 0.2, "NEEDS_REVIEW": 0.4}, "NEEDS_REVIEW"),
        ({"SATISFIED": 0.4, "NOT_SATISFIED": 0.4, "NEEDS_REVIEW": 0.2}, "NOT_SATISFIED"),
        ({"SATISFIED": 0.2, "NOT_SATISFIED": 0.4, "NEEDS_REVIEW": 0.4}, "NEEDS_REVIEW"),
        ({"SATISFIED": 0.1, "NOT_SATISFIED": 0.7, "NEEDS_REVIEW": 0.2}, "NOT_SATISFIED"),
    ],
    ids=["S_R_tie", "S_N_tie", "N_R_tie", "N_max"],
)
def test_v0_2_requirement_label_is_conservative_on_ties(v02, distribution, label):
    v02.responder = KevResponder(requirements={"requiredSkills[0]": distribution})
    first = v02.call()["requirements"][0]
    assert (first["itemId"], first["label"]) == ("requiredSkills[0]", label)


def test_v0_2_wire_is_chunk_replies_in_order(v02):
    assert v02.call()["wire"] == v02.responder.replies


def test_v0_2_request_id_comes_from_first_chunk(v02):
    # 묶음이 여럿이면 첫 묶음의 x-typesafe-request-id 를 쓴다(구현 결정, 51ad173)
    assert v02.call()["kev"]["requestId"] == "req-typesafe-1"


def test_v0_2_latency_is_sum_of_chunk_latencies(v02):
    # 묶음마다 latency_ms 101·102 → 합 203(구현 결정, 51ad173)
    assert v02.call()["kev"]["latencyMs"] == 101 + 102


def test_v0_2_error_code_is_null(v02):
    assert v02.call()["errorCode"] is None


# ---------------------------------------------------------------- 묶음 실패 → 전체 KEV_UNAVAILABLE(§3)


def chunk_values_out_of_range() -> KevResponder:
    bad = KevResponder()
    original = bad.answer

    def answer(qid, question):
        reply = original(qid, question)
        return {"noul": 1.5} if qid.startswith("risk.") and reply.get("noul") is not None else reply

    bad.answer = answer
    return bad


@pytest.mark.parametrize("failure", ["status_500", "timeout"])
def test_v0_2_one_failed_chunk_disables_everything(v02, monkeypatch, failure):
    if failure == "timeout":
        monkeypatch.setenv("KEV_TIMEOUT_MS", "300")
        failed = Reply(json_body={}, delay=5)
    else:
        failed = Reply(500, {"error": "x"})
    v02.responder = KevResponder(fail_on_call=2, failure=failed)
    result = v02.call()
    assert (
        result["kev"]["enabled"],
        result["errorCode"],
        result["requirements"],
        result["stateHash"],
        result["wire"],
    ) == (False, "KEV_UNAVAILABLE", None, None, None)


def test_v0_2_invalid_values_in_a_chunk_disable_everything(v02):
    v02.responder = chunk_values_out_of_range()
    result = v02.call()
    assert (result["kev"]["enabled"], result["errorCode"], result["requirements"]) == (
        False,
        "KEV_UNAVAILABLE",
        None,
    )


def test_v0_2_timeout_applies_per_chunk(v02, monkeypatch):
    # 49 문항 → 묶음 3개. 묶음마다 0.8초, timeout 1.6초: 합계(2.4초)는 넘지만 묶음 하나는 넘지 않는다
    monkeypatch.setenv("KEV_TIMEOUT_MS", "1600")
    v02.responder = KevResponder(delay=0.8)
    result = v02.call(kev_request("FX-01", extraction=v02_extraction(skills=30)))
    assert (len(v02.sent()), result["kev"]["enabled"]) == (3, True)


# ---------------------------------------------------------------- stateTrace(§5)


def trace_of(result) -> dict:
    return result["kev"]["stateTrace"]


def test_v0_2_state_trace_lines_join_to_state(v02):
    trace = trace_of(v02.call())
    assert (
        trace["template"],
        "\n".join(line["text"] for line in trace["lines"]),
        [line["lineNo"] for line in trace["lines"]],
    ) == ("en.v0.2", state_of(v02), list(range(1, len(trace["lines"]) + 1)))


def test_v0_2_state_trace_hash_matches(v02):
    result = v02.call()
    assert trace_of(result)["stateHash"] == result["stateHash"]


def test_v0_2_item_line_has_item_id_and_verified_notice_evidence(v02):
    ext = v02_extraction()
    trace = trace_of(v02.call(kev_request("FX-01", extraction=ext)))
    line = next(line for line in trace["lines"] if "[requiredSkills[0]]" in line["text"])
    verified = [r for r in ext["requiredSkills"]["evidence"] if r["match"] != "FAILED"]
    assert (line["itemIds"], line["noticeEvidence"]) == (["requiredSkills[0]"], verified)


def company_refs(trace) -> list[dict]:
    return [ref for line in trace["lines"] for ref in line["companyEvidence"]]


def test_v0_2_company_evidence_kinds_and_record_keys(v02):
    refs = company_refs(trace_of(v02.call()))
    keys = {(r["kind"], r["recordKey"]) for r in refs}
    expected = (
        {("TECHNOLOGY", f"technologies[{i}]") for i in range(len(PROFILE["technologies"]))}
        | {("LICENSE", f"licenses[{i}]") for i in range(len(PROFILE["licenses"]))}
        | {("PROJECT", f"pastProjects[{i}]") for i in range(len(PROFILE["pastProjects"]))}
        | {("FINANCIAL", "financials"), ("STAFF", "staffAvailability")}
    )
    assert expected <= keys


def test_v0_2_company_evidence_shape(v02):
    refs = company_refs(trace_of(v02.call()))
    assert refs != []
    assert {tuple(sorted(r)) for r in refs} == {
        ("documentId", "kind", "profileRevision", "quotedText", "recordKey")
    }
    assert {r["profileRevision"] for r in refs} == {2}


def test_v0_2_project_evidence_points_to_profile_evidence_file(v02):
    refs = company_refs(trace_of(v02.call()))
    projects = {r["recordKey"]: r["documentId"] for r in refs if r["kind"] == "PROJECT"}
    assert projects == {
        f"pastProjects[{i}]": p["evidenceRef"] for i, p in enumerate(PROFILE["pastProjects"])
    }


def test_v0_2_lines_without_evidence_have_empty_lists(v02):
    # FX-01 의 deadlineAt 은 UNKNOWN → "(unknown)" 줄은 근거가 없다
    trace = trace_of(v02.call())
    unknown = [line for line in trace["lines"] if "(unknown)" in line["text"]]
    assert unknown != []
    assert {(len(line["noticeEvidence"]), len(line["companyEvidence"])) for line in unknown} == {
        (0, 0)
    }


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


def test_v0_2_korean_state_uses_ko_template(ko_run):
    assert trace_of(ko_run["korean"])["template"] == "ko.v0.2"


def test_v0_2_korean_state_sends_korean_questions(ko_run):
    sent = {qid: q for body in ko_run["ko_bodies"] for qid, q in body["questions"].items()}
    template = load_json(KO_FILE)["questions"][REQ]
    assert sent["req.requiredSkills[0].status"]["instructions"] == template["instructions"].replace(
        "{itemId}", "requiredSkills[0]"
    )


def line_numbers(lines: list[str]) -> list[list[str]]:
    return [[t.replace(",", "") for t in NUMBER_TOKEN.findall(line)] for line in lines]


def markers(text: str) -> list[str]:
    return sorted(i for i in item_ids() if f"[{i}]" in text)


def test_v0_2_korean_state_has_same_line_count_items_and_numbers(ko_run):
    en_lines, ko_lines = ko_run["en_state"].split("\n"), ko_run["ko_state"].split("\n")
    assert len(ko_lines) == len(en_lines)
    assert markers(ko_run["ko_state"]) == markers(ko_run["en_state"])
    assert line_numbers(ko_lines) == line_numbers(en_lines)


def test_v0_2_korean_state_is_refused_without_allow(v02):
    request = kev_request("FX-01", extraction=v02_extraction(), stateLanguage="ko")
    response = v02.client().post("/kev", json=request)
    assert (response.status_code, response.json()["errorCode"]) == (422, "KO_STATE_NOT_ALLOWED")
