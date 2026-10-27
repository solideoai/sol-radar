"""Kev state 빌더(docs/03 §5.6·§5.11). 어댑터가 구조화된 사실을 템플릿에 채운다.

- en(운영): 한글이 든 자유 텍스트 값은 translations[fieldPath] 가 있고 그 번역에 ASCII 영어이고 숫자·식별자·단위·조건 검증을
  통과할 때만 그것을, 아니면 "(untranslated)". 자격은 사전 영어 라벨. 기관명은 역할명, 회사 이름은 넣지 않는다.
- ko(평가 전용, KEV_ALLOW_KO_STATE=true): 같은 구조의 한국어 라벨에 원문 값을 넣는다.
- 규칙 결과(자격 판정·점수·권고)는 넣지 않는다. KevRequest 에 그런 필드가 없다.
- KNOWN 값만 넣는다. UNKNOWN·CONFLICTED·NOT_APPLICABLE 은 표기로 바꾼다.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sol_ai.citation import norm
from sol_ai.contracts import KevRequest, ProfileSummary
from sol_ai.guards import InjectionGuard
from sol_ai.paths import INJECTION_PATTERNS_FILE
from sol_ai.qualifications import QualificationDictionary
from sol_ai.timeutil import parse_instant
from sol_ai.translation_validation import HANGUL, valid_translation

# 03 §5.6 한글 범위(음절·자모·호환 자모)

# 길이 상한 6,000 토큰. 토큰 수는 글자 수 / 4 로 근사한다
TOKEN_LIMIT = 6_000
CHARS_PER_TOKEN = 4


@dataclass(frozen=True)
class Labels:
    notice: str
    agency: str
    agency_value: str
    project_type: str
    budget: str
    deadline: str
    required_skills: str
    preferred_skills: str
    mandatory_qualifications: str
    optional_qualifications: str
    past_performance_required: str
    staffing_required: str
    restrictions: str
    attachments_incomplete: str
    company: str
    technologies: str
    held: str
    not_held: str
    past_performance: str
    cap: str
    staff: str
    staff_period: str
    staff_value: str
    financial: str
    financial_value: str
    projects: str
    amounts: str
    largest: str
    krw: str
    unknown: str
    conflicted: str
    none: str
    mandatory: str
    optional: str
    min_count: str
    min_amount: str
    within_years: str
    grade: str
    condition: str
    omitted: str


EN = Labels(
    notice="NOTICE",
    agency="agency",
    agency_value="(Korean public agency)",
    project_type="project type",
    budget="budget (KRW)",
    deadline="deadline",
    required_skills="required skills",
    preferred_skills="preferred skills",
    mandatory_qualifications="mandatory qualifications",
    optional_qualifications="optional qualifications",
    past_performance_required="past performance required",
    staffing_required="staffing required",
    restrictions="restrictions",
    attachments_incomplete="RFP attachment could not be read; requirements may be incomplete",
    company="COMPANY (profile revision {revision})",
    technologies="technologies",
    held="registrations/certifications held",
    not_held="not held",
    past_performance="past performance",
    cap="single-project cap",
    staff="staff availability",
    staff_period="staff availability ({start} to {end})",
    staff_value="{fte} FTE available out of {eligible} scoring-eligible staff",
    financial="financial",
    financial_value="annual revenue {revenue}, employees {employees}",
    projects="{count} projects",
    amounts="amounts KRW {amounts}",
    largest="largest {amount} KRW",
    krw="{amount} KRW",
    unknown="(unknown)",
    conflicted="(conflicted)",
    none="none stated",
    mandatory="mandatory",
    optional="optional",
    min_count=">={count} projects",
    min_amount=">={amount} KRW",
    within_years="within {years} years",
    grade="grade {value}",
    condition="condition {value}",
    omitted="({count} more omitted)",
)

KO = Labels(
    notice="공고",
    agency="발주기관",
    agency_value="(공공기관)",
    project_type="사업 유형",
    budget="예산(원)",
    deadline="마감",
    required_skills="필수 기술",
    preferred_skills="우대 기술",
    mandatory_qualifications="필수 자격",
    optional_qualifications="선택 자격",
    past_performance_required="요구 수행 실적",
    staffing_required="요구 인력",
    restrictions="제한 사항",
    attachments_incomplete="첨부 문서를 읽지 못해 요구사항이 빠졌을 수 있다",
    company="회사 (프로필 revision {revision})",
    technologies="보유 기술",
    held="보유 등록·인증",
    not_held="미보유",
    past_performance="수행 실적",
    cap="단일 사업 수행 상한",
    staff="인력 가용",
    staff_period="인력 가용({start} ~ {end})",
    staff_value="점수 대상 인력 {eligible}명 중 {fte} FTE 가용",
    financial="재무",
    financial_value="연 매출 {revenue}, 직원 {employees}명",
    projects="{count}건",
    amounts="금액(원) {amounts}",
    largest="최대 {amount}원",
    krw="{amount}원",
    unknown="(알 수 없음)",
    conflicted="(상충)",
    none="명시 없음",
    mandatory="필수",
    optional="선택",
    min_count="{count}건 이상",
    min_amount="{amount}원 이상",
    within_years="최근 {years}년 이내",
    grade="등급 {value}",
    condition="조건 {value}",
    omitted="(외 {count}건 생략)",
)

UNTRANSLATED = "(untranslated)"


def _number(value: float) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _krw(value: str | int) -> str:
    return f"{int(value):,}"


class StateBuilder:
    """v0.1 state 줄을 만든다. v0.2 빌더(kev_state_v02)가 같은 값 표기를 물려받는다."""

    def __init__(
        self,
        request: KevRequest,
        language: str,
        dictionary: QualificationDictionary,
        labels: Labels | None = None,
    ) -> None:
        self.extraction = request.extraction
        self.profile: ProfileSummary = request.profileSummary
        self.translations = request.translations or {}
        self.request = request
        self.english = language == "en"
        # v0.1 은 코드의 EN·KO 라벨, v0.2 는 템플릿 파일(kev/state-templates)의 라벨
        self.labels = labels if labels is not None else (EN if self.english else KO)
        self.dictionary = dictionary
        self.translation_sources: dict[str, str] = {}
        self.guard = InjectionGuard.load(INJECTION_PATTERNS_FILE)

    # ------------------------------------------------------------ 값 표기

    def text(self, value: str, path: str | None) -> str:
        """자유 텍스트 값. en의 한국어 값은 공통 검증을 통과한 번역만 쓴다. 줄바꿈은 접는다."""
        text = norm(value)
        if not self.english or not HANGUL.search(text):
            return text
        if path:
            self.translation_sources[path] = text
        candidate = self.translations.get(path) if path else None
        if valid_translation(text, candidate, self.guard):
            return norm(candidate)
        return UNTRANSLATED

    def field(self, name: str, render: Callable[[Any], str]) -> str:
        extracted = self.extraction[name]
        state = extracted["state"]
        if state == "KNOWN" and extracted["value"] is not None:
            return render(extracted["value"])
        if state == "CONFLICTED":
            return self.labels.conflicted
        if state == "NOT_APPLICABLE":
            return self.labels.none
        return self.labels.unknown

    def joined(self, items: list[str], separator: str = ", ") -> str:
        return separator.join(items) if items else self.labels.none

    def mandatory(self, flag: bool) -> str:
        return self.labels.mandatory if flag else self.labels.optional

    # ------------------------------------------------------------ NOTICE

    def deadline(self, value: str) -> str:
        instant = parse_instant(value)
        return self.labels.unknown if instant is None else instant.date().isoformat()

    def skills(self, name: str) -> str:
        return self.field(
            name,
            lambda values: self.joined(
                [self.text(v, f"{name}[{i}]") for i, v in enumerate(values)]
            ),
        )

    def dictionary_label(self, code: str | None, name: str) -> str | None:
        entry = self.dictionary.get(code)
        if entry is None:
            return None
        if not self.english:
            return entry.name
        # 부분 일치 사전 코드는 판단용이다. 추가 버전/등급/조건까지 영어 라벨로 덮어쓰지 않는다.
        aliases = {re.sub(r"\s+", "", a).casefold() for a in (entry.name, *entry.aliases)}
        exact = re.sub(r"\s+", "", name).casefold() in aliases
        qualifier_preserved = "(" not in norm(name) or "(" in entry.en
        return (
            entry.en
            if exact and qualifier_preserved and valid_translation(name, entry.en, self.guard)
            else None
        )

    def qualification_label(self, index: int, item: dict) -> str:
        label = self.dictionary_label(self.dictionary.lookup(item["name"]), item["name"])
        if label is None:
            label = self.text(item["name"], f"qualifications[{index}].name")
        detail = (
            "; " + self.text(item["detail"], f"qualifications[{index}].detail")
            if item.get("detail")
            else ""
        )
        return f"{label} ({item['kind']}, {self.mandatory(item['mandatory'])}{detail})"

    def qualifications(self, mandatory: bool) -> str:
        return self.field(
            "qualifications",
            lambda items: self.joined(
                [
                    self.qualification_label(i, item)
                    for i, item in enumerate(items)
                    if item["mandatory"] is mandatory
                ],
                "; ",
            ),
        )

    def has_optional_qualifications(self) -> bool:
        extracted = self.extraction["qualifications"]
        items = extracted["value"] if extracted["state"] == "KNOWN" else None
        return any(not item["mandatory"] for item in items or [])

    def past_performance_items(self) -> list[str] | None:
        extracted = self.extraction["pastPerformance"]
        if extracted["state"] != "KNOWN" or extracted["value"] is None:
            return None
        items = []
        for index, item in enumerate(extracted["value"]):
            parts = []
            if item.get("minCount") is not None:
                parts.append(self.labels.min_count.format(count=item["minCount"]))
            if item.get("minAmountKrw") is not None:
                parts.append(self.labels.min_amount.format(amount=_krw(item["minAmountKrw"])))
            if item.get("withinYears") is not None:
                parts.append(self.labels.within_years.format(years=_number(item["withinYears"])))
            parts.append(self.mandatory(item["mandatory"]))
            description = self.text(item["description"], f"pastPerformance[{index}].description")
            items.append(f"{description} ({'; '.join(parts)})")
        return items

    def staffing_item(self, index: int, item: dict) -> str:
        role = self.text(item["role"], f"staffing[{index}].role")
        count = f" x{item['minCount']}" if item.get("minCount") is not None else ""
        parts = []
        if item.get("grade") is not None:
            grade = self.text(item["grade"], f"staffing[{index}].grade")
            parts.append(self.labels.grade.format(value=grade))
        if item.get("condition") is not None:
            condition = self.text(item["condition"], f"staffing[{index}].condition")
            parts.append(self.labels.condition.format(value=condition))
        parts.append(self.mandatory(item["mandatory"]))
        return f"{role}{count} ({'; '.join(parts)})"

    def staffing(self) -> str:
        return self.field(
            "staffing",
            lambda items: self.joined(
                [self.staffing_item(i, item) for i, item in enumerate(items)], "; "
            ),
        )

    def notice_lines(self, past_performance: str) -> list[str]:
        lab = self.labels
        project_type = self.field("projectType", str)
        lines = [
            lab.notice,
            f"- {lab.agency}: {lab.agency_value}; {lab.project_type}: {project_type}",
            f"- {lab.budget}: {self.field('budgetKrw', _krw)}",
            f"- {lab.deadline}: {self.field('deadlineAt', self.deadline)}",
            f"- {lab.required_skills}: {self.skills('requiredSkills')}",
            f"- {lab.preferred_skills}: {self.skills('preferredSkills')}",
            f"- {lab.mandatory_qualifications}: {self.qualifications(True)}",
        ]
        if self.has_optional_qualifications():
            lines.append(f"- {lab.optional_qualifications}: {self.qualifications(False)}")
        lines += [
            f"- {lab.past_performance_required}: {past_performance}",
            f"- {lab.staffing_required}: {self.staffing()}",
            f"- {lab.restrictions}: {self.skills('restrictions')}",
        ]
        if self.request.attachmentsIncomplete:
            lines.append(f"- {lab.attachments_incomplete}")
        return lines

    # ------------------------------------------------------------ COMPANY

    def license_label(self, code: str, name: str | None, index: int) -> str:
        label = self.dictionary_label(code, name or code)
        if label is not None:
            return label
        return self.text(name or code, f"profileSummary.licenses[{index}].name")

    def licenses(self, status: str) -> str:
        return self.joined(
            [
                self.license_label(lic.code, lic.name, i)
                for i, lic in enumerate(self.profile.licenses)
                if lic.status == status
            ]
        )

    def company_past_performance(self, with_amounts: bool) -> str:
        lab = self.labels
        # 금액을 모르는 실적(None)도 건수에는 세고, 금액 목록·최대 금액에서만 뺀다
        amounts = [
            int(project.amountKrw)
            for project in self.profile.pastProjects
            if project.amountKrw is not None
        ]
        parts = [lab.projects.format(count=len(self.profile.pastProjects))]
        if amounts:
            if with_amounts:
                parts.append(lab.amounts.format(amounts=" / ".join(f"{a:,}" for a in amounts)))
            parts.append(lab.largest.format(amount=f"{max(amounts):,}"))
        return "; ".join(parts)

    def staff_line(self) -> str:
        lab = self.labels
        staff = self.profile.staffAvailability
        if staff is None:
            return f"- {lab.staff}: {lab.unknown}"
        start, end = (
            self.text(staff.from_, "profileSummary.staffAvailability.from"),
            self.text(staff.to, "profileSummary.staffAvailability.to"),
        )
        heading = lab.staff_period.format(start=start, end=end)
        value = lab.staff_value.format(
            fte=_number(staff.availableFte), eligible=staff.eligibleStaff
        )
        return f"- {heading}: {value}"

    def financial_line(self) -> str:
        lab = self.labels
        financials = self.profile.financials
        if financials is None:
            return f"- {lab.financial}: {lab.unknown}"
        revenue = (
            lab.krw.format(amount=_krw(financials.annualRevenueKrw))
            if financials.annualRevenueKrw is not None
            else lab.unknown
        )
        employees = (
            str(financials.employeeCount) if financials.employeeCount is not None else lab.unknown
        )
        return (
            f"- {lab.financial}: {lab.financial_value.format(revenue=revenue, employees=employees)}"
        )

    def company_lines(self, with_amounts: bool) -> list[str]:
        lab = self.labels
        revision = (
            self.profile.revision
            if self.profile.revision is not None
            else self.request.profileRevision
        )
        financials = self.profile.financials
        cap = (
            lab.krw.format(amount=_krw(financials.maxContractKrw))
            if financials is not None and financials.maxContractKrw is not None
            else lab.unknown
        )
        technologies = self.joined(
            [
                self.text(t.name, f"profileSummary.technologies[{i}].name")
                for i, t in enumerate(self.profile.technologies)
            ]
        )
        return [
            lab.company.format(revision=revision),
            f"- {lab.technologies}: {technologies}",
            f"- {lab.held}: {self.licenses('HELD')}",
            f"- {lab.not_held}: {self.licenses('NOT_HELD')}",
            f"- {lab.past_performance}: {self.company_past_performance(with_amounts)}",
            f"- {lab.cap}: {cap}",
            self.staff_line(),
            self.financial_line(),
        ]

    def render(self, past_performance: str, with_amounts: bool) -> str:
        return "\n".join(
            [*self.notice_lines(past_performance), "", *self.company_lines(with_amounts)]
        )


def _too_long(state: str) -> bool:
    return len(state) / CHARS_PER_TOKEN > TOKEN_LIMIT


def build_state(request: KevRequest, language: str, dictionary: QualificationDictionary) -> str:
    """state 텍스트. 6,000 토큰(근사)을 넘으면 past performance 줄부터 줄인다(03 §5.6)."""
    builder = StateBuilder(request, language, dictionary)
    items = builder.past_performance_items()

    def past_performance(keep: int) -> str:
        if items is None:
            # KNOWN 이 아니면 상태 표기만 나온다(값을 그리지 않는다)
            return builder.field("pastPerformance", str)
        omitted = len(items) - keep
        if omitted == 0:
            return builder.joined(items, "; ")
        return "; ".join([*items[:keep], builder.labels.omitted.format(count=omitted)])

    keep = len(items or [])
    state = builder.render(past_performance(keep), with_amounts=True)
    while _too_long(state) and keep > 0:
        keep -= 1
        state = builder.render(past_performance(keep), with_amounts=True)
    if _too_long(state):
        state = builder.render(past_performance(keep), with_amounts=False)
    return state
