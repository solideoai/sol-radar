"""mock 어댑터(AI_PROVIDER=mock). 모델 호출만 fixture 고정 응답으로 바꾼다(docs/03 §3.1).

추출 응답은 검증 파이프라인(스키마·인용·인젝션)을 local 과 같은 코드로 지난다. 여기서 값을 고치지 않는다.
AI_FAULT_INJECT 는 이 어댑터만 흉내 낸다(K3).
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from sol_ai.adapters import kev_wire
from sol_ai.adapters.base import ExtractionFailed, KevUnavailable, ModelOutput, ModelUnavailable
from sol_ai.contracts import ExtractRequest, KevRequest
from sol_ai.errors import StartupRefused
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import (
    Q_FIT,
    Q_MANDATORY_RISK,
    Q_NEEDS_HUMAN_REVIEW,
    Q_RECOMMENDATION,
    V0_1,
    QuestionSet,
)

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
    """fixtureId 로 고를 파일(K5'). 형식 밖 id 는 파일을 열지 않고 None.

    "FX-xx.rNN" 이면 <kind>/FX-xx.rNN.json, 없으면 <kind>/FX-xx.json. "FX-xx" 면 <kind>/FX-xx.json.
    고른 파일이 없으면 None(/extract 는 MOCK_FIXTURE_NOT_FOUND, /kev 는 03 §5.7 공식).
    """
    if fixture_id is None or not FIXTURE_ID.fullmatch(fixture_id):
        return None
    base = fixture_id.split(".")[0]
    candidates = [fixture_id, base] if fixture_id != base else [base]
    return next(
        (path for name in candidates if (path := root / kind / f"{name}.json").is_file()), None
    )


@dataclass(frozen=True)
class ModelIdentity:
    """추출 fixture 들의 공통 model.name·promptVersion·promptHash(seed 의 재사용 키와 같은 값, K13)."""

    name: str
    prompt_version: str
    prompt_hash: str


class FixtureConfigError(StartupRefused):
    """mock 추출 fixture 디렉터리가 기동 조건을 못 맞춘다. summary 는 "SOL_FIXTURES_DIR(사유)" 뿐이다."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"SOL_FIXTURES_DIR({reason})")


def _model_identity(path: Path) -> ModelIdentity | None:
    try:
        model = json.loads(path.read_text(encoding="utf-8")).get("model")
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(model, dict):
        return None
    values = (model.get("name"), model.get("promptVersion"), model.get("promptHash"))
    if not all(isinstance(value, str) for value in values):
        return None
    return ModelIdentity(*values)


def fixture_model_identity(root: Path) -> ModelIdentity:
    """기동 검사(mock 만): extractions/ 의 FX 파일이 하나 이상이고 model 식별 값이 모두 같아야 한다.

    없으면 MOCK_FIXTURES_MISSING, 다르거나 읽을 수 없으면 MOCK_FIXTURE_MODEL_MISMATCH 로 기동을 거부한다.
    """
    directory = root / "extractions"
    paths = (
        [p for p in sorted(directory.glob("*.json")) if FIXTURE_ID.fullmatch(p.stem)]
        if directory.is_dir()
        else []
    )
    if not paths:
        raise FixtureConfigError("MOCK_FIXTURES_MISSING")
    identities = {_model_identity(path) for path in paths}
    if len(identities) != 1 or None in identities:
        raise FixtureConfigError("MOCK_FIXTURE_MODEL_MISMATCH")
    return identities.pop()


class MockQwen:
    """fixtures/extractions/<fixtureId>.json 을 모델 응답 원문으로 돌려준다.

    payload.model 은 fixture 의 model 블록을 그대로 쓴다(K13). AI_PROMPT_VERSION 은 mock 에 영향이 없다.
    """

    provider = "mock"

    def __init__(self, fixtures_root: Path, fault: str | None) -> None:
        identity = fixture_model_identity(fixtures_root)
        self._root = fixtures_root
        self._fault = fault
        self.model_name: str | None = identity.name
        self.prompt_hash: str | None = identity.prompt_hash

    def extract(self, request: ExtractRequest) -> ModelOutput:
        if self._fault == FAULT_QWEN_ERROR:
            raise ExtractionFailed("fault injected: qwen_error")
        if self._fault == FAULT_QWEN_UNREACHABLE:
            raise ModelUnavailable("fault injected: qwen_unreachable")
        path = fixture_file(self._root, "extractions", request.fixtureId)
        if path is None:
            raise ExtractionFailed("mock fixture not found", [WARNING_FIXTURE_NOT_FOUND])
        text = path.read_text(encoding="utf-8")
        try:
            model_block = json.loads(text).get("model")
        except (ValueError, AttributeError) as error:
            raise ExtractionFailed("mock fixture is not a JSON object") from error
        if not isinstance(model_block, dict):
            raise ExtractionFailed("mock fixture has no model block")
        return ModelOutput(text, model_block=model_block)


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
            try:
                return kev_wire.wire_record(json.loads(path.read_text(encoding="utf-8")))
            except ValueError as error:
                raise KevUnavailable("mock kev fixture is invalid") from error
        answers = formula_answers(request, self._dictionary, self._question_set)
        return kev_wire.build_response(self._question_set.questions, answers)
