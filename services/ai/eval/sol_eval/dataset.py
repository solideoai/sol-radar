"""EvalItem(docs/21 §3.7 전체 + e3 설계 §5 축소판 필드) pydantic 모델과 JSONL 읽기·쓰기.

- 추출은 gateway 와 같은 JSON Schema(services/ai/schemas)로 검증한다. contracts.py 에는 RequirementExtraction·
  EvidenceRef 의 pydantic 모델이 없고 JSON Schema 가 정본이라 그것을 재사용한다. CompanyEvidenceRef 는 contracts 것이다.
- 축소판(라벨 파일): split·clusterId·extraction·company 가 없어도 된다. 빌더 출력(전체)은 모두 있다.
- translations·attachmentsIncomplete 는 21 §3.7 에 없지만 state 를 서빙과 같게 다시 만들려면 필요해서 둔다(제안).
"""

import json
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from sol_ai.contracts import CompanyEvidenceRef
from sol_ai.schema import default_schema
from sol_ai.timeutil import is_date_time

Split = Literal["train", "dev", "test"]
SPLITS: tuple[Split, ...] = ("train", "dev", "test")
LabelSource = Literal["CONSTRUCTED", "HUMAN", "RULE_SILVER"]
DraftedBy = Literal["RULE", "QWEN", "CLAUDE", "NONE"]
ReasonCode = Literal[
    "NOTICE_INFO_MISSING",
    "NOTICE_CONFLICTED",
    "COMPANY_EVIDENCE_MISSING",
    "AMBIGUOUS_MATCH",
    "PARSE_UNSUPPORTED",
    "STAGE_NOT_APPLICABLE",
]
REASON_CODES = (
    "NOTICE_INFO_MISSING",
    "NOTICE_CONFLICTED",
    "COMPANY_EVIDENCE_MISSING",
    "AMBIGUOUS_MATCH",
    "PARSE_UNSUPPORTED",
    "STAGE_NOT_APPLICABLE",
)
ItemSource = Literal["fixture", "live"]
COMPANY_SCHEMA_VERSION = "company-profile/v0.1"


def _evidence_validator() -> Draft202012Validator:
    schema = default_schema().schema
    checker = FormatChecker(formats=())
    checker.checks("date-time")(is_date_time)
    return Draft202012Validator(
        {"$ref": "#/$defs/EvidenceRef", "$defs": schema["$defs"]}, format_checker=checker
    )


_EVIDENCE_VALIDATOR: Draft202012Validator | None = None


def evidence_errors(ref: Any) -> list[str]:
    """15 §2 EvidenceRef 모양 검사(JSON Schema $defs/EvidenceRef). 위치·검사 이름만 돌려준다."""
    global _EVIDENCE_VALIDATOR
    if _EVIDENCE_VALIDATOR is None:
        _EVIDENCE_VALIDATOR = _evidence_validator()
    found = sorted(_EVIDENCE_VALIDATOR.iter_errors(ref), key=lambda e: list(e.absolute_path))
    return ["/".join(str(p) for p in e.absolute_path) + f":{e.validator}" for e in found]


class Label(BaseModel):
    """21 §3.7 labels[] 원소 + e3 §5 의 labeler·labeledAt. label 은 언제나 문자열이다(Kev JSONL 로 갈 때 형을 바꾼다)."""

    model_config = ConfigDict(extra="forbid")

    qid: str = Field(min_length=1)
    label: str = Field(min_length=1)
    reason: ReasonCode | None = None
    target: dict[str, float] | None = None
    labelSource: LabelSource
    draftedBy: DraftedBy
    labeler: str | None = None
    labeledAt: str | None = None
    noticeEvidence: list[dict[str, Any]] = Field(default_factory=list)
    companyEvidence: list[CompanyEvidenceRef] = Field(default_factory=list)

    @field_validator("noticeEvidence")
    @classmethod
    def _notice_evidence_shape(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for index, ref in enumerate(value):
            errors = evidence_errors(ref)
            if errors:
                raise ValueError(f"noticeEvidence[{index}] 가 EvidenceRef 가 아니다: {errors[:3]}")
        return value


class BidRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1)
    noticeId: str = Field(min_length=1)
    amendmentNo: str | None = None
    revisionId: str = Field(min_length=1)


class CompanyProfileSnapshot(BaseModel):
    """company-profile/v0.1(fixtures/company/solideo-profile.json 과 같은 모양) + 변형 표식. 나머지 키는 그대로 둔다."""

    model_config = ConfigDict(extra="allow")

    schemaVersion: Literal["company-profile/v0.1"]
    revision: int = Field(ge=0)
    technologies: list[dict[str, Any]]
    technologiesComplete: bool
    licenses: list[dict[str, Any]]
    industryCodes: list[dict[str, Any]] = Field(default_factory=list)
    pastProjects: list[dict[str, Any]]
    financials: dict[str, Any] | None = None
    staffAvailability: dict[str, Any] | None = None
    companyId: str | None = None
    variantId: str | None = None


class EvalItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    itemId: str = Field(min_length=1)
    split: Split | None = None
    clusterId: str | None = None
    source: ItemSource = "live"
    bid: BidRef
    extraction: dict[str, Any] | None = None
    extractionId: str | None = None
    translations: dict[str, str] | None = None
    attachmentsIncomplete: bool = False
    company: CompanyProfileSnapshot | None = None
    profileRevision: int | None = None
    companyVariantId: str | None = None
    rulePredictions: dict[str, str] | None = None
    labels: list[Label] = Field(default_factory=list)

    @field_validator("extraction")
    @classmethod
    def _extraction_matches_schema(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            errors = default_schema().errors(value)
            if errors:
                raise ValueError(f"RequirementExtraction 스키마 위반: {errors[:5]}")
        return value

    def company_id(self) -> str | None:
        if self.company is not None and self.company.companyId is not None:
            return self.company.companyId
        return None


class DatasetFormatError(ValueError):
    """JSONL 줄이 EvalItem 이 아니다. 줄 번호와 위반 위치만 담는다(값은 담지 않는다)."""


def read_items(path: Path) -> list[EvalItem]:
    items: list[EvalItem] = []
    with path.open(encoding="utf-8") as handle:
        for line_no, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as error:
                raise DatasetFormatError(f"{path.name}:{line_no}: JSON 이 아니다") from error
            try:
                items.append(EvalItem.model_validate(data))
            except ValidationError as error:
                locations = sorted({".".join(str(p) for p in e["loc"]) for e in error.errors()})
                raise DatasetFormatError(
                    f"{path.name}:{line_no}: EvalItem 형식 위반 {locations[:6]}"
                ) from error
    return items


LABEL_OPTIONAL_KEYS = ("reason", "target", "labeler", "labeledAt")


def item_to_json(item: EvalItem) -> dict[str, Any]:
    """EvalItem 의 선택 필드(None)는 빼고, CompanyEvidenceRef 의 null(documentId·quotedText)은 그대로 둔다."""
    data = item.model_dump()
    compact = {k: v for k, v in data.items() if v is not None}
    compact["labels"] = [
        {k: v for k, v in label.items() if v is not None or k not in LABEL_OPTIONAL_KEYS}
        for label in data["labels"]
    ]
    if compact.get("company") is not None:
        compact["company"] = {k: v for k, v in compact["company"].items() if v is not None}
    return compact


def write_items(path: Path, items: list[EvalItem]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(json.dumps(item_to_json(item), ensure_ascii=False))
            handle.write("\n")
