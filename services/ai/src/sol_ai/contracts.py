"""gateway 내부 계약(docs/03 §2.1·§5.7·§10.1, K4~K10)의 요청·응답 모델.

요청 본문 형식 오류는 FastAPI 기본 422 로 끝난다(K9). RequirementExtraction 본문은 JSON Schema 로 검증한다.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from sol_ai.schema import default_schema
from sol_ai.timeutil import parse_instant

KrwString = Annotated[str, StringConstraints(pattern=r"^[0-9]+$")]
Recommendation = Literal["BID", "WATCH", "NO_BID"]
QuestionSetVersion = Literal["kev-qs/v0.1", "kev-qs/v0.2"]
Provider = Literal["mock", "local", "hosted"]

KEV_DISCLAIMER = "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."


class OpenModel(BaseModel):
    """필요한 필드만 검증하고 나머지 키는 허용한다(K6·K8)."""

    model_config = ConfigDict(extra="allow")


class ErrorBody(BaseModel):
    """200 이 아닌 응답 본문(K9). 대상은 422 KO_STATE_NOT_ALLOWED 와 503 AI_UNAVAILABLE 뿐이다."""

    errorCode: str
    message: str


# ---------------------------------------------------------------- /extract


class ExtractMeta(BaseModel):
    """NormalizedBid 의 stage·agency·budgetKrw·deadlineAt. 값은 null 일 수 있다."""

    stage: str | None = None
    agency: str | None = None
    budgetKrw: KrwString | None = None
    deadlineAt: str | None = None

    @field_validator("deadlineAt")
    @classmethod
    def _deadline_has_offset(cls, value: str | None) -> str | None:
        if value is not None and parse_instant(value) is None:
            raise ValueError("오프셋이 있는 ISO8601 date-time 이어야 한다")
        return value


class PageOffset(BaseModel):
    page: int = Field(ge=1)
    charOffset: int = Field(ge=0)


class Attachment(BaseModel):
    documentId: str = Field(min_length=1)
    text: str
    pages: list[PageOffset] = Field(default_factory=list)


class ExtractRequest(BaseModel):
    requestId: str
    bidId: str = Field(min_length=1)
    revisionId: str = Field(min_length=1)
    fixtureId: str | None = None
    meta: ExtractMeta
    body: str
    attachments: list[Attachment] = Field(default_factory=list)


class ExtractTimings(BaseModel):
    extractMs: int


class ExtractResponse(BaseModel):
    status: Literal["COMPLETED", "PENDING_REVIEW", "FAILED"]
    payload: dict[str, Any] | None
    translations: dict[str, str] | None
    errorCode: Literal["EXTRACTION_FAILED", "QWEN_UNAVAILABLE"] | None
    injectionSuspected: bool
    warnings: list[str]
    timings: ExtractTimings


# ---------------------------------------------------------------- /kev


class ProfileTechnology(OpenModel):
    name: str


class ProfileLicense(OpenModel):
    code: str
    name: str | None = None
    status: Literal["HELD", "NOT_HELD"]


class ProfileProject(OpenModel):
    amountKrw: KrwString


class ProfileFinancials(OpenModel):
    annualRevenueKrw: KrwString | None = None
    employeeCount: int | None = Field(default=None, ge=0)
    maxContractKrw: KrwString | None = None


class StaffAvailability(OpenModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    availableFte: int | float = Field(ge=0)
    eligibleStaff: int = Field(ge=0)


class ProfileSummary(OpenModel):
    """C4 CompanyProfile + 선택 staffAvailability(K6). state 에 쓰는 필드만 검증한다. 규칙 결과는 받지 않는다."""

    revision: int | None = None
    technologies: list[ProfileTechnology]
    licenses: list[ProfileLicense]
    pastProjects: list[ProfileProject]
    financials: ProfileFinancials | None = None
    staffAvailability: StaffAvailability | None = None


class KevRequest(BaseModel):
    """03 §5.7 KevAdapterInput + requestId·fixtureId. 규칙 결과(자격 판정·점수·권고) 필드는 없다.

    그런 키가 와도 버린다(extra="ignore"). Kev 가 규칙 판정을 바꾸지 못하는 계약이다.
    """

    model_config = ConfigDict(extra="ignore")

    requestId: str
    fixtureId: str | None = None
    bidId: str
    orgId: str
    revisionId: str
    profileRevision: int
    extraction: dict[str, Any]
    translations: dict[str, str] | None = None
    profileSummary: ProfileSummary
    attachmentsIncomplete: bool
    questionSetVersion: QuestionSetVersion
    stateLanguage: Literal["en", "ko"]

    @field_validator("extraction")
    @classmethod
    def _extraction_matches_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        errors = default_schema().errors(value)
        if errors:
            raise ValueError(f"RequirementExtraction 스키마 위반: {errors[:5]}")
        return value


class FitScore(BaseModel):
    score: float
    legend: dict[str, str]


class KevAssist(BaseModel):
    """03 §5.7. enabled=false 면 disclaimer 밖은 모두 null 이다. v0.2 필드는 v0.1 run 에서 null."""

    enabled: bool
    provider: Provider | None = None
    model: str | None = None
    questionSetVersion: QuestionSetVersion | None = None
    suggestedOption: Recommendation | None = None
    probabilities: dict[str, float] | None = None
    confidence: float | None = None
    mandatoryRisk: float | None = None
    needsHumanReview: float | None = None
    fit: FitScore | None = None
    scores: None = None
    risks: None = None
    calibration: None = None
    stateTrace: None = None
    latencyMs: int | float | None = None
    requestId: str | None = None
    disclaimer: Literal["Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."] = (
        KEV_DISCLAIMER
    )


class KevTimings(BaseModel):
    kevMs: int


class KevResponse(BaseModel):
    kev: KevAssist
    stateHash: str | None
    requirements: None = None
    wire: list[dict[str, Any]] | None
    errorCode: Literal["KEV_UNAVAILABLE"] | None
    timings: KevTimings


# ---------------------------------------------------------------- /explain


class QualificationCheckInput(OpenModel):
    requirementName: str
    mandatory: bool
    outcome: Literal["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW", "NOT_APPLICABLE"]


class ScoreBreakdownInput(OpenModel):
    score: int | float
    factors: list[dict[str, Any]]
    recommendation: Recommendation
    recommendationBasis: str
    reviewFlags: list[str]
    missingFactors: list[Any]


class KevSummaryInput(OpenModel):
    enabled: bool
    suggestedOption: Recommendation | None = None


class DocumentIssue(OpenModel):
    documentId: str
    downloadStatus: str
    parseStatus: str
    errorCode: str | None


class ExplainRequest(BaseModel):
    requestId: str
    qualificationChecks: list[QualificationCheckInput]
    scoreBreakdown: ScoreBreakdownInput
    evidence: list[dict[str, Any]]
    kevSummary: KevSummaryInput | None
    documentIssues: list[DocumentIssue]


class ExplainResponse(BaseModel):
    text: str
    usedNumbers: list[str]
    fallback: bool


# ---------------------------------------------------------------- /parse


class ParseResult(BaseModel):
    """03 §10.1. 파서 어댑터가 아직 없어 지금은 UNSUPPORTED 만 낸다."""

    status: Literal["PARSED", "PARTIAL", "UNSUPPORTED", "FAILED"]
    format: Literal["PDF", "HWPX", "HWP", "UNKNOWN"]
    parserId: str
    text: str
    pages: list[PageOffset]
    blocks: list[dict[str, Any]]
    quality: dict[str, Any] | None
    errorCode: (
        Literal[
            "UNSUPPORTED_FORMAT",
            "NO_TEXT_LAYER",
            "ENCRYPTED",
            "DISTRIBUTION_PROTECTED",
            "TOO_LARGE",
            "CORRUPTED",
            "PARSER_ERROR",
        ]
        | None
    )
    warnings: list[str]
