"""mock 어댑터(AI_PROVIDER=mock). 모델 호출만 fixture 고정 응답으로 바꾼다(docs/03 §3.1).

추출 응답은 검증 파이프라인(스키마·인용·인젝션)을 local 과 같은 코드로 지난다. 여기서 값을 고치지 않는다.
AI_FAULT_INJECT 는 이 어댑터만 흉내 낸다(K3).
"""

import json
import logging
import re
from pathlib import Path

from sol_ai.adapters import kev_wire
from sol_ai.adapters.base import ExtractionFailed, KevUnavailable, ModelOutput, ModelUnavailable
from sol_ai.contracts import ExtractRequest, KevRequest
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import (
    Q_FIT,
    Q_MANDATORY_RISK,
    Q_NEEDS_HUMAN_REVIEW,
    Q_RECOMMENDATION,
    V0_1,
    QuestionSet,
)
from sol_ai.timeutil import parse_instant

logger = logging.getLogger("sol_ai.mock")

# K5: "FX-07" 또는 파일 stem "FX-07.r01". 이 형식 밖이면 파일을 열지 않는다(경로 조작 방지)
FIXTURE_ID = re.compile(r"FX-\d{2}(?:\.r\d{2})?")

FAULT_QWEN_ERROR = "qwen_error"
FAULT_QWEN_UNREACHABLE = "qwen_unreachable"
FAULT_KEV_TIMEOUT = "kev_timeout"
FAULT_KEV_UNREACHABLE = "kev_unreachable"
FAULT_GATEWAY_DOWN = "gateway_down"
FAULTS = (
    FAULT_KEV_TIMEOUT,
    FAULT_QWEN_ERROR,
    FAULT_QWEN_UNREACHABLE,
    FAULT_KEV_UNREACHABLE,
    FAULT_GATEWAY_DOWN,
)

WARNING_FIXTURE_NOT_FOUND = "MOCK_FIXTURE_NOT_FOUND"


def fixture_file(root: Path, kind: str, fixture_id: str | None) -> Path | None:
    """fixtures/<kind>/<fixtureId>.json. 형식 밖 id 는 None(파일을 열지 않는다)."""
    if fixture_id is None or not FIXTURE_ID.fullmatch(fixture_id):
        return None
    return root / kind / f"{fixture_id}.json"


class MockQwen:
    """fixtures/extractions/<fixtureId>.json 을 모델 응답 원문으로 돌려준다."""

    provider = "mock"
    model_name = "fixture"

    def __init__(self, fixtures_root: Path, fault: str | None) -> None:
        self._root = fixtures_root
        self._fault = fault

    def extract(self, request: ExtractRequest) -> ModelOutput:
        if self._fault == FAULT_QWEN_ERROR:
            raise ExtractionFailed("fault injected: qwen_error")
        if self._fault == FAULT_QWEN_UNREACHABLE:
            raise ModelUnavailable("fault injected: qwen_unreachable")
        path = fixture_file(self._root, "extractions", request.fixtureId)
        if path is None or not path.is_file():
            raise ExtractionFailed("mock fixture not found", [WARNING_FIXTURE_NOT_FOUND])
        text = path.read_text(encoding="utf-8")
        # 결정성: model 블록의 시각·지연은 실제 시각이 아니라 fixture 값을 쓴다
        extracted_at, latency = _fixture_model_meta(text)
        return ModelOutput(text, extracted_at, latency, retries=0)


def _fixture_model_meta(text: str) -> tuple[str, int | float]:
    try:
        model = json.loads(text).get("model") or {}
    except (ValueError, AttributeError) as error:
        raise ExtractionFailed("mock fixture is not a JSON object") from error
    extracted_at, latency = model.get("extractedAt"), model.get("latencyMs")
    if not isinstance(extracted_at, str) or parse_instant(extracted_at) is None:
        raise ExtractionFailed("mock fixture model.extractedAt missing")
    if isinstance(latency, bool) or not isinstance(latency, int | float) or latency < 0:
        raise ExtractionFailed("mock fixture model.latencyMs missing")
    return extracted_at, latency


# ---------------------------------------------------------------- Kev


# 03 §5.7 공식(fixtures/kev 파일이 없을 때). 추출·프로필만 쓴다. 규칙 결과는 쓰지 않는다.
# (선택지 분포, mandatoryRisk, needsHumanReview)
FORMULA_NO_BID = ({"BID": 0.05, "WATCH": 0.15, "NO_BID": 0.80}, 0.80, 0.30)
FORMULA_WATCH = ({"BID": 0.15, "WATCH": 0.70, "NO_BID": 0.15}, 0.50, 0.70)
FORMULA_BID = ({"BID": 0.60, "WATCH": 0.30, "NO_BID": 0.10}, 0.10, 0.20)
FORMULA_FIT_SCORE = 2.0


def formula_case(request: KevRequest, dictionary: QualificationDictionary) -> tuple:
    """필수 자격 중 사전 코드가 프로필 HELD 코드에 없으면 NO_BID 중심, 자격이 UNKNOWN·CONFLICTED 이거나
    사전에 없는 필수 자격이 있으면 WATCH 중심, 아니면 BID 중심."""
    qualifications = request.extraction["qualifications"]
    state = qualifications["state"]
    items = (qualifications["value"] or []) if state == "KNOWN" else []
    codes = [dictionary.lookup(item["name"]) for item in items if item["mandatory"]]
    held = {lic.code for lic in request.profileSummary.licenses if lic.status == "HELD"}
    if any(code is not None and code not in held for code in codes):
        return FORMULA_NO_BID
    if state in ("UNKNOWN", "CONFLICTED") or any(code is None for code in codes):
        return FORMULA_WATCH
    return FORMULA_BID


def formula_answers(
    request: KevRequest, dictionary: QualificationDictionary, question_set: QuestionSet
) -> dict[str, kev_wire.Answer]:
    probabilities, mandatory_risk, needs_review = formula_case(request, dictionary)
    choice = max(probabilities, key=lambda option: probabilities[option])
    return {
        Q_RECOMMENDATION: kev_wire.ChoiceAnswer(choice, probabilities[choice], dict(probabilities)),
        Q_MANDATORY_RISK: kev_wire.YesAnswer(mandatory_risk),
        Q_NEEDS_HUMAN_REVIEW: kev_wire.YesAnswer(needs_review),
        Q_FIT: kev_wire.ScoreAnswer(
            FORMULA_FIT_SCORE, kev_wire.score_legend(question_set.questions[Q_FIT])
        ),
    }


class MockKev:
    """fixtures/kev/<FX-xx>.json(wire 응답 형식 그대로)을 우선 읽고, 없으면 03 §5.7 공식. v0.1 만 답한다."""

    provider = "mock"
    model_id = "mock"
    registry_match = None
    question_sets = (V0_1,)

    def __init__(
        self,
        fixtures_root: Path,
        fault: str | None,
        dictionary: QualificationDictionary,
        question_set: QuestionSet,
    ) -> None:
        self._root = fixtures_root
        self._fault = fault
        self._dictionary = dictionary
        self._question_set = question_set

    def answer(self, wire_request: dict, request: KevRequest) -> dict:
        # wire_request 는 실제 Kev 에 보낼 본문과 같다. mock 은 보내지 않는다
        if self._fault in (FAULT_KEV_TIMEOUT, FAULT_KEV_UNREACHABLE):
            raise KevUnavailable(f"fault injected: {self._fault}")
        path = fixture_file(self._root, "kev", request.fixtureId)
        if path is not None:
            # "FX-02.r01" 도 FX-02 의 Kev 파일을 쓴다(Kev fixture 는 revision 구분이 없다)
            path = path.with_name(f"{request.fixtureId.split('.')[0]}.json")
        if path is not None and path.is_file():
            try:
                return kev_wire.wire_record(json.loads(path.read_text(encoding="utf-8")))
            except ValueError as error:
                raise KevUnavailable("mock kev fixture is invalid") from error
        answers = formula_answers(request, self._dictionary, self._question_set)
        return kev_wire.build_response(self._question_set.questions, answers)
