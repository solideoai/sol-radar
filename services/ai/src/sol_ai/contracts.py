"""gateway 내부 계약(docs/03 §2.1·§5.7·§10.1, K4~K10)의 요청·응답 모델.

요청 본문 형식 오류는 FastAPI 기본 422 로 끝난다(K9). RequirementExtraction 본문은 JSON Schema 로 검증한다.
"""

from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from sol_ai.schema import default_schema
from sol_ai.timeutil import parse_instant

KrwString = Annotated[str, StringConstraints(pattern=r"^[0-9]+$")]
Recommendation = Literal["BID", "WATCH", "NO_BID"]
QuestionSetVersion = Literal["kev-qs/v0.1", "kev-qs/v0.2"]
Provider = Literal["mock", "local", "hosted"]

KEV_DISCLAIMER = "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."

# 요청 크기 상한(보안 점검 Low). 넘으면 FastAPI 기본 422
MAX_TEXT_CHARS = 2_000_000
MAX_ATTACHMENTS = 200


def _longest_string_ok(value: Any) -> bool:
    """값 안의 모든 문자열(키 포함)이 MAX_TEXT_CHARS 이하인지. JSON 깊이는 파서가 막는다."""
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if len(item) > MAX_TEXT_CHARS:
                return False
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return True


class SizeLimitedModel(BaseModel):
    """요청 안의 어느 문자열도 MAX_TEXT_CHARS 를 넘지 않는다(/kev·/explain 은 자유 모양 객체를 받는다)."""

    @model_validator(mode="before")
    @classmethod
    def _limit_string_sizes(cls, data: Any) -> Any:
        if not _longest_string_ok(data):
            raise ValueError(f"문자열이 {MAX_TEXT_CHARS}자를 넘는다")
        return data


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
    text: str = Field(max_length=MAX_TEXT_CHARS)
    pages: list[PageOffset] = Field(default_factory=list)


class ExtractRequest(SizeLimitedModel):
    requestId: str
    bidId: str = Field(min_length=1)
    revisionId: str = Field(min_length=1)
    fixtureId: str | None = None
    meta: ExtractMeta
    body: str = Field(max_length=MAX_TEXT_CHARS)
    attachments: list[Attachment] = Field(default_factory=list, max_length=MAX_ATTACHMENTS)


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
    # 공개 출처 실적처럼 금액을 모르면 null. 건수에는 세고 금액 목록·최대 금액에서는 뺀다
    amountKrw: KrwString | None = None
    # 회사 증빙 파일 id(있으면). KevStateTrace 의 CompanyEvidenceRef.documentId 로 옮긴다
    evidenceRef: str | None = None


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


class KevRequest(SizeLimitedModel):
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


class KevScores(BaseModel):
    """v0.2 score 질문 5등급. SOL Score 에 더하지 않는다."""

    techFit: FitScore
    perfRelevance: FitScore


class KevRisk(BaseModel):
    qid: Literal[
        "risk.schedule", "risk.staffing", "risk.scale", "risk.techGap", "risk.scopeAmbiguity"
    ]
    probability: float
    # probability ≥ τ → KEV_DELIVERY_RISK(플래그는 Worker 가 단다)
    overThreshold: bool


class KevCalibration(BaseModel):
    status: Literal["UNCALIBRATED", "CALIBRATED"]
    datasetVersion: str | None
    threshold: float
    thresholdsVersion: str


class CompanyEvidenceRef(BaseModel):
    """15 §2.1. 회사 프로필 revision 의 기록 하나(또는 회사 증빙 파일)."""

    profileRevision: int
    kind: Literal["LICENSE", "INDUSTRY_CODE", "TECHNOLOGY", "PROJECT", "STAFF", "FINANCIAL"]
    recordKey: str
    documentId: str | None
    quotedText: str | None


class StateTraceLine(BaseModel):
    lineNo: int
    text: str
    noticeEvidence: list[dict[str, Any]]
    companyEvidence: list[CompanyEvidenceRef]
    itemIds: list[str]


class KevStateTrace(BaseModel):
    """15 §2.1·03 §5.12. state 를 만들 때 줄마다 남긴 출처."""

    stateHash: str
    template: Literal["en.v0.2", "ko.v0.2"]
    lines: list[StateTraceLine]


class RequirementDistribution(BaseModel):
    """03 §2.1 KevResponse.requirements 원소. Kev 담당 항목 하나의 분포(참고 지표)."""

    itemId: str
    qid: str
    distribution: dict[str, float]
    label: Literal["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"]


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
    # v0.2 필드(kev-qs/v0.1 run 에서는 null)
    scores: KevScores | None = None
    risks: list[KevRisk] | None = None
    calibration: KevCalibration | None = None
    stateTrace: KevStateTrace | None = None
    latencyMs: int | float | None = None
    requestId: str | None = None
    disclaimer: Literal["Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."] = (
        KEV_DISCLAIMER
    )


class KevTimings(BaseModel):
    kevMs: int


class KevResponse(BaseModel):
    # 추가 진단. 기존 errorCode/disabled 계약을 유지하며 원문 대신 안전한 필드 경로만 싣는다.
    warnings: list[str] = Field(default_factory=list)
    kev: KevAssist
    stateHash: str | None
    # v0.2 Kev 담당 항목별 분포. v0.1 run·Kev 실패면 null
    requirements: list[RequirementDistribution] | None = None
    wire: list[dict[str, Any]] | None
    # KEV_UNAVAILABLE: 미접속·timeout·오류(K4). INJECTION_SUSPECTED: 추출이 인젝션 의심이라 Kev 를 부르지 않았다(K4')
    errorCode: Literal["KEV_UNAVAILABLE", "INJECTION_SUSPECTED"] | None
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


class ExplainRequest(SizeLimitedModel):
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


# ---------------------------------------------------------------- /insight

# 추천 분석(스펙 §4.3, 계획 C3). 판정(점수·권고)은 입력으로만 받고 바꾸지 않는다. 근거 번호 B = 공고 인용, C = 회사 자료
InsightRefId = Annotated[str, StringConstraints(pattern=r"^[BC][1-9][0-9]?$")]
DateString = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
InsightLabel = Annotated[str, StringConstraints(min_length=1, max_length=80)]
InsightFallbackReason = Literal[
    "MODEL_UNAVAILABLE",
    "INVALID_OUTPUT",
    "FORBIDDEN_WORD",
    "UNKNOWN_NUMBER",
    "UNKNOWN_REF",
    "LABEL_CONFLICT",
    "INJECTION_SUSPECTED",
]


class InsightBid(BaseModel):
    title: str
    agency: str | None = None
    budgetKrw: KrwString | None = None
    deadline: DateString | None = None


class InsightFactor(BaseModel):
    factor: str
    label: InsightLabel
    points: int | float
    maxPoints: int | float
    reason: str


class InsightCheck(BaseModel):
    label: InsightLabel
    status: Literal["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW", "NOT_APPLICABLE"]
    reason: str


# 자격 해설·확인할 것을 다는 자격 판정
REVIEW_STATUSES = frozenset({"NOT_SATISFIED", "NEEDS_REVIEW"})


class InsightRules(BaseModel):
    score: int | float
    recommendation: Recommendation
    recommendationBasis: str
    factors: list[InsightFactor] = Field(max_length=8)
    qualificationChecks: list[InsightCheck] = Field(max_length=20)
    reviewFlags: list[str]
    missingFactors: list[str]

    def review_checks(self) -> list[InsightCheck]:
        """자격 해설(checkNotes)을 다는 자격: 미충족·확인 필요. 같은 label 은 요청 순서의 첫 자격만 남긴다.

        요청 자격에는 id 가 없어 화면이 label 로 짝짓는다(ADR-078, 계획 "자격 해설 짝짓기"). 순서는 요청 그대로다.
        """
        seen: set[str] = set()
        checks = []
        for check in self.qualificationChecks:
            if check.status in REVIEW_STATUSES and check.label not in seen:
                seen.add(check.label)
                checks.append(check)
        return checks


class InsightBosun(BaseModel):
    reviewFlags: list[str]


class InsightStaff(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: DateString = Field(alias="from")
    to: DateString
    availableFte: int | float = Field(ge=0)
    eligibleStaff: int = Field(ge=0)


class InsightCompany(BaseModel):
    name: str | None = None
    technologies: list[str] = Field(max_length=10)
    staff: InsightStaff | None = None


class InsightRef(BaseModel):
    id: InsightRefId
    kind: Literal["BID", "COMPANY"]
    label: InsightLabel
    quotedText: str = Field(min_length=1, max_length=300)


class InsightRequest(SizeLimitedModel):
    requestId: str
    bid: InsightBid
    rules: InsightRules
    # run 에서 Bosun 을 쓰지 않았으면 null
    bosun: InsightBosun | None = None
    company: InsightCompany
    refs: list[InsightRef] = Field(max_length=24)
    # run 의 추출이 인젝션 의심이었으면 true. 그러면 gateway 는 모델을 부르지 않는다(보안 리뷰 중-2)
    injectionSuspected: bool = False

    def model_input(self) -> dict:
        """모델 user 메시지와 인젝션 검사가 보는 사실. 요청 id·의심 플래그는 사실이 아니라 뺀다."""
        return self.model_dump(
            mode="json", by_alias=True, exclude={"requestId", "injectionSuspected"}
        )

    @field_validator("refs")
    @classmethod
    def _unique_ref_ids(cls, value: list[InsightRef]) -> list[InsightRef]:
        if len({ref.id for ref in value}) != len(value):
            raise ValueError("refs 의 id 가 겹친다")
        return value


class InsightItem(BaseModel):
    # 모델 출력을 그대로 읽는다. 모르는 키·형 변환을 받지 않는다
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=200)
    refIds: list[InsightRefId] = Field(max_length=4)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("빈 문장")
        return value


class InsightFactorNote(InsightItem):
    """점수 요소별 해설. factor 는 요청 rules.factors[].factor 중 하나여야 한다(아니면 gateway 가 그 항목을 뺀다)."""

    factor: str = Field(min_length=1, max_length=40)


class InsightCheckNote(InsightItem):
    """자격 요건 해설. label 은 요청 rules.qualificationChecks 중 미충족·확인 필요 자격의 label 과 글자가 같아야 한다."""

    label: str = Field(min_length=1, max_length=80)


class InsightBody(BaseModel):
    """모델 출력과 템플릿이 같은 모양이다(출력 v0.2, ADR-078). 상한은 web insight.model.ts INSIGHT_LIMITS 와 같다.

    새 칸(factorNotes·checkNotes·nextSteps)이 모델 본문에 없으면 빈 목록으로 본다(모양 오류가 아니다).
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str = Field(min_length=1, max_length=800)
    strengths: list[InsightItem] = Field(max_length=6)
    improvements: list[InsightItem] = Field(max_length=6)
    factorNotes: list[InsightFactorNote] = Field(default_factory=list, max_length=8)
    checkNotes: list[InsightCheckNote] = Field(default_factory=list, max_length=8)
    nextSteps: list[InsightItem] = Field(default_factory=list, max_length=5)

    @field_validator("summary")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("빈 요약")
        return value


class InsightResponse(InsightBody):
    """언제나 200. fallback=false 면 fallbackReason=null·model=어댑터 모델 이름, true 면 model=null(템플릿).

    MODEL·TEMPLATE 모두 새 칸 세 키를 늘 보낸다(비면 []). promptVersion 은 출력 형식 버전("insight/v0.2")이다.
    """

    model_config = ConfigDict(extra="forbid")

    fallback: bool
    fallbackReason: InsightFallbackReason | None
    model: str | None
    promptHash: str
    promptVersion: str


# ---------------------------------------------------------------- /parse


class ParseResult(BaseModel):
    """03 §10.1. 형식별 어댑터는 sol_ai.parsers, 실행·형식 판정은 sol_ai.parse."""

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
