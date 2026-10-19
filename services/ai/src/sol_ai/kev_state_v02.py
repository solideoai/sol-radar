"""Kev state v0.2 빌더(docs/03 §5.10·§5.11·§5.12, 15 §2.1). v0.1 빌더(kev_state)와 경로를 나눈다.

- 줄 구성은 v0.1 과 같고, Kev 담당 항목마다 NOTICE 에 "- [<itemId>] <라벨>: <값>" 한 줄을 더한다.
  담당 항목: KNOWN 필드의 requiredSkills[i]·pastPerformance[i]·staffing[i], 사전 코드가 없는 qualifications[i].
- 라벨은 템플릿 파일(kev/state-templates/{en,ko}.v0.2.txt). 두 언어는 줄 순서·항목 id·숫자가 같다.
- 6,000 토큰(글자 수 / 4)을 넘으면 pastPerformance 항목을 뒤에서부터 뺀다. 뺀 항목은 질문도 만들지 않는다.
- 줄마다 근거(KevStateTrace)를 함께 만든다: NOTICE 줄은 그 필드의 검증된 인용, COMPANY 줄은 프로필 기록 키.
"""

from dataclasses import dataclass, field, fields
from pathlib import Path

from sol_ai.citation import parse_element_mapping
from sol_ai.contracts import KevRequest
from sol_ai.kev_state import CHARS_PER_TOKEN, TOKEN_LIMIT, Labels, StateBuilder
from sol_ai.qualifications import QualificationDictionary

TEMPLATE_VERSION = "v0.2"
ITEM_KEYS = (
    "item_line",
    "item_required_skill",
    "item_past_performance",
    "item_staffing",
    "item_qualification",
)
# 질문 순서(03 §5.10): requiredSkills → pastPerformance → staffing → qualifications, 원소 순
ITEM_FIELDS = ("requiredSkills", "pastPerformance", "staffing", "qualifications")
ITEM_LABEL_KEYS = {
    "requiredSkills": "item_required_skill",
    "pastPerformance": "item_past_performance",
    "staffing": "item_staffing",
    "qualifications": "item_qualification",
}


@dataclass(frozen=True)
class StateTemplate:
    name: str  # "en.v0.2" | "ko.v0.2"
    language: str
    labels: Labels
    items: dict[str, str]


def load_state_template(path: Path, language: str) -> StateTemplate:
    """ "키 = 값" 줄을 읽는다. #·빈 줄은 건너뛴다. 키가 빠지거나 남으면 ValueError(기동 실패)."""
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition(" = ")
        if not separator or key in values:
            raise ValueError(f"{path.name}: 템플릿 줄 형식이 다르거나 키가 겹친다")
        values[key] = value
    label_keys = {f.name for f in fields(Labels)}
    if set(values) != label_keys | set(ITEM_KEYS):
        raise ValueError(f"{path.name}: 템플릿 키 집합이 다르다")
    return StateTemplate(
        name=f"{language}.{TEMPLATE_VERSION}",
        language=language,
        labels=Labels(**{k: values[k] for k in label_keys}),
        items={k: values[k] for k in ITEM_KEYS},
    )


def load_state_templates(directory: Path) -> dict[str, StateTemplate]:
    return {
        language: load_state_template(directory / f"{language}.{TEMPLATE_VERSION}.txt", language)
        for language in ("en", "ko")
    }


@dataclass
class TraceLine:
    text: str
    notice_evidence: list[dict] = field(default_factory=list)
    company_evidence: list[dict] = field(default_factory=list)
    item_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StateDocument:
    text: str
    lines: list[TraceLine]
    # 질문을 만들 담당 항목 id(질문 순서)
    item_ids: list[str]


class _V02Builder(StateBuilder):
    def __init__(
        self, request: KevRequest, template: StateTemplate, dictionary: QualificationDictionary
    ) -> None:
        super().__init__(request, template.language, dictionary, template.labels)
        self.template = template
        self.revision = (
            self.profile.revision
            if self.profile.revision is not None
            else self.request.profileRevision
        )

    # ------------------------------------------------------------ 담당 항목·근거

    def known_values(self, name: str) -> list:
        extracted = self.extraction[name]
        if extracted["state"] != "KNOWN" or not isinstance(extracted["value"], list):
            return []
        return extracted["value"]

    def item_indices(self, name: str) -> list[int]:
        values = self.known_values(name)
        if name == "qualifications":
            return [i for i, q in enumerate(values) if self.dictionary.lookup(q["name"]) is None]
        return list(range(len(values)))

    def evidence(self, name: str, index: int | None = None) -> list[dict]:
        """필드의 검증된 인용(match≠FAILED). UNKNOWN 필드는 없다. index 가 있으면 note 의 원소 대응을 따른다."""
        extracted = self.extraction[name]
        if extracted["state"] == "UNKNOWN":
            return []
        refs = extracted["evidence"]
        positions = list(range(len(refs)))
        if index is not None:
            groups = parse_element_mapping(
                extracted.get("note"), len(self.known_values(name)), len(refs)
            )
            if groups is not None:
                positions = sorted({ref for indices, ref in groups if index in indices})
        return [refs[p] for p in positions if refs[p].get("match") != "FAILED"]

    def company_ref(self, kind: str, record_key: str, document_id: str | None = None) -> dict:
        return {
            "profileRevision": self.revision,
            "kind": kind,
            "recordKey": record_key,
            "documentId": document_id,
            "quotedText": None,
        }

    # ------------------------------------------------------------ 줄

    def item_line(self, name: str, index: int, value: str) -> TraceLine:
        item_id = f"{name}[{index}]"
        text = self.template.items["item_line"].format(
            itemId=item_id, label=self.template.items[ITEM_LABEL_KEYS[name]], value=value
        )
        return TraceLine(text, self.evidence(name, index), [], [item_id])

    def summary_line(self, name: str, text: str, item_names: list[str] | None = None) -> TraceLine:
        return TraceLine(text, self.evidence(name), [], item_names or [])

    def notice(self, past_keep: int, past_items: list[str] | None) -> list[TraceLine]:
        lab = self.labels
        skills_ids = [f"requiredSkills[{i}]" for i in self.item_indices("requiredSkills")]
        qual_items = self.item_indices("qualifications")
        qual_values = self.known_values("qualifications")
        past_ids = [f"pastPerformance[{i}]" for i in range(past_keep)]
        staff_ids = [f"staffing[{i}]" for i in self.item_indices("staffing")]

        lines = [
            TraceLine(lab.notice),
            self.summary_line(
                "projectType",
                f"- {lab.agency}: {lab.agency_value}; "
                f"{lab.project_type}: {self.field('projectType', str)}",
            ),
            self.summary_line("budgetKrw", f"- {lab.budget}: {self._budget()}"),
            self.summary_line(
                "deadlineAt", f"- {lab.deadline}: {self.field('deadlineAt', self.deadline)}"
            ),
            self.summary_line(
                "requiredSkills",
                f"- {lab.required_skills}: {self.skills('requiredSkills')}",
                skills_ids,
            ),
        ]
        lines += [
            self.item_line("requiredSkills", i, self.text(v, f"requiredSkills[{i}]"))
            for i, v in enumerate(self.known_values("requiredSkills"))
        ]
        lines.append(
            self.summary_line(
                "preferredSkills", f"- {lab.preferred_skills}: {self.skills('preferredSkills')}"
            )
        )
        mandatory_ids = [f"qualifications[{i}]" for i in qual_items if qual_values[i]["mandatory"]]
        lines.append(
            self.summary_line(
                "qualifications",
                f"- {lab.mandatory_qualifications}: {self.qualifications(True)}",
                mandatory_ids,
            )
        )
        if self.has_optional_qualifications():
            optional_ids = [
                f"qualifications[{i}]" for i in qual_items if not qual_values[i]["mandatory"]
            ]
            lines.append(
                self.summary_line(
                    "qualifications",
                    f"- {lab.optional_qualifications}: {self.qualifications(False)}",
                    optional_ids,
                )
            )
        lines += [
            self.item_line("qualifications", i, self.qualification_label(i, qual_values[i]))
            for i in qual_items
        ]
        lines.append(
            self.summary_line(
                "pastPerformance",
                f"- {lab.past_performance_required}: {self._past_summary(past_keep, past_items)}",
                past_ids,
            )
        )
        lines += [
            self.item_line("pastPerformance", i, past_items[i])
            for i in range(past_keep if past_items is not None else 0)
        ]
        lines.append(
            self.summary_line(
                "staffing", f"- {lab.staffing_required}: {self.staffing()}", staff_ids
            )
        )
        lines += [
            self.item_line("staffing", i, self.staffing_item(i, item))
            for i, item in enumerate(self.known_values("staffing"))
        ]
        lines.append(
            self.summary_line(
                "restrictions", f"- {lab.restrictions}: {self.skills('restrictions')}"
            )
        )
        if self.request.attachmentsIncomplete:
            lines.append(TraceLine(f"- {lab.attachments_incomplete}"))
        return lines

    def _budget(self) -> str:
        return self.field("budgetKrw", lambda v: f"{int(v):,}")

    def _past_summary(self, keep: int, items: list[str] | None) -> str:
        if items is None:
            # KNOWN 이 아니면 상태 표기만 나온다
            return self.field("pastPerformance", str)
        omitted = len(items) - keep
        if omitted == 0:
            return self.joined(items, "; ")
        return "; ".join([*items[:keep], self.labels.omitted.format(count=omitted)])

    def company(self, with_amounts: bool) -> list[TraceLine]:
        lab = self.labels
        profile = self.profile
        financials = profile.financials
        cap_known = financials is not None and financials.maxContractKrw is not None
        cap = (
            lab.krw.format(amount=f"{int(financials.maxContractKrw):,}")
            if cap_known
            else lab.unknown
        )
        financial_known = financials is not None and (
            financials.annualRevenueKrw is not None or financials.employeeCount is not None
        )
        technologies = self.joined([self.text(t.name, None) for t in profile.technologies])
        return [
            TraceLine(lab.company.format(revision=self.revision)),
            TraceLine(
                f"- {lab.technologies}: {technologies}",
                company_evidence=[
                    self.company_ref("TECHNOLOGY", f"technologies[{i}]")
                    for i in range(len(profile.technologies))
                ],
            ),
            TraceLine(
                f"- {lab.held}: {self.licenses('HELD')}",
                company_evidence=self._licenses("HELD"),
            ),
            TraceLine(
                f"- {lab.not_held}: {self.licenses('NOT_HELD')}",
                company_evidence=self._licenses("NOT_HELD"),
            ),
            TraceLine(
                f"- {lab.past_performance}: {self.company_past_performance(with_amounts)}",
                company_evidence=[
                    self.company_ref("PROJECT", f"pastProjects[{i}]", project.evidenceRef)
                    for i, project in enumerate(profile.pastProjects)
                ],
            ),
            TraceLine(
                f"- {lab.cap}: {cap}",
                company_evidence=[self.company_ref("FINANCIAL", "financials")] if cap_known else [],
            ),
            TraceLine(
                self.staff_line(),
                company_evidence=(
                    [self.company_ref("STAFF", "staffAvailability")]
                    if profile.staffAvailability is not None
                    else []
                ),
            ),
            TraceLine(
                self.financial_line(),
                company_evidence=(
                    [self.company_ref("FINANCIAL", "financials")] if financial_known else []
                ),
            ),
        ]

    def _licenses(self, status: str) -> list[dict]:
        return [
            self.company_ref("LICENSE", f"licenses[{i}]")
            for i, lic in enumerate(self.profile.licenses)
            if lic.status == status
        ]

    def document(self, past_keep: int, past_items: list[str] | None, with_amounts: bool):
        lines = [*self.notice(past_keep, past_items), TraceLine(""), *self.company(with_amounts)]
        return "\n".join(line.text for line in lines), lines


def _too_long(text: str) -> bool:
    return len(text) / CHARS_PER_TOKEN > TOKEN_LIMIT


def build_state_v02(
    request: KevRequest, template: StateTemplate, dictionary: QualificationDictionary
) -> StateDocument:
    builder = _V02Builder(request, template, dictionary)
    past_items = builder.past_performance_items()
    keep = len(past_items or [])
    text, lines = builder.document(keep, past_items, with_amounts=True)
    while _too_long(text) and keep > 0:
        keep -= 1
        text, lines = builder.document(keep, past_items, with_amounts=True)
    if _too_long(text):
        text, lines = builder.document(keep, past_items, with_amounts=False)
    item_ids = [
        f"{name}[{i}]"
        for name in ITEM_FIELDS
        for i in (range(keep) if name == "pastPerformance" else builder.item_indices(name))
    ]
    return StateDocument(text, lines, item_ids)
