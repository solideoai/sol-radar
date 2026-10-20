"""갈래 ① 빌더(docs/23 §4.4): 녹음 구조화 필드 × 가상 기업 변형 → EvalItem JSONL.

NOTICE 는 구조화 필드만(예산·마감·계약 방법·면허제한 행·참가가능지역·첨부 유무). 추출 필드(requiredSkills·
pastPerformance·staffing)는 UNKNOWN 이고 attachmentsIncomplete=true 로 "첨부를 읽지 못했다" 한 줄이 state 에 들어간다.

라벨 규칙(22 §4.1 표 · 23 §4.4 표):
- req.qualifications[i].status: 사전 코드 없는 면허제한 행(Kev 담당) ↔ 회사 업종 보유 상태 → CONSTRUCTED.
  면허제한이 여러 행이면 NEEDS_REVIEW/AMBIGUOUS_MATCH(16 미결정 19). 사전 코드가 있는 행은 RULE_SILVER(train 만).
- risk.scale: 변형이 수행 상한을 바꿨으면 CONSTRUCTED, 아니면 예산 vs 상한·최대 실적으로 RULE_SILVER(train 만).
- risk.staffing: 변형이 가용 FTE 를 바꿨으면 CONSTRUCTED, 아니면 FTE 로 RULE_SILVER(train 만).
- risk.schedule: 마감 vs 기준일(--as-of = state 의 staff availability 시작일) 로 RULE_SILVER(train 만). state 에 그 줄이
  있는 변형에만 붙인다. 0~7일 true, 30일 이상 false, 사이·지난 마감은 라벨 없음.
- 홀드아웃 원형(기본 06)은 test 에만. test·dev 에는 CONSTRUCTED 만 붙인다(사람 라벨은 뒤에 JSONL 로 더한다).
"""

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from sol_ai.contracts import CompanyEvidenceRef
from sol_ai.kev_state import NUMBER_TOKEN
from sol_ai.qualifications import QualificationDictionary, default_dictionary
from sol_eval.companies import (
    AMPLE_FTE,
    VARIANTS_WITH_QUAL,
    VARIANTS_WITHOUT_QUAL,
    CompanyProfileSnapshot,
    VariantSpec,
    available_fte,
    cap_krw,
    company_ref,
    industry_status,
    largest_project_krw,
    license_status,
    load_companies,
    make_variant,
)
from sol_eval.dataset import SPLITS, BidRef, DatasetFormatError, EvalItem, Label, write_items
from sol_eval.recorded import (
    NoticeRecord,
    RecordedBundle,
    join_recordings,
    load_industry_master,
    load_recorded_dir,
)
from sol_eval.splits import derive_splits, load_splits, splits_to_json

BRANCH = 1
EXTRACTION_SCHEMA_VERSION = "requirement-extraction/v0.1"
NOT_EXTRACTED_NOTE = "branch 1: attachment not read; field not extracted"
NOTE_MAX_LENGTH = 200
API_SOURCE_NOTICE = "g2b-bid-notice"
API_SOURCE_LICENSE = "g2b-bid-license-limit"
API_SOURCE_REGION = "g2b-bid-region"
# 나라장터 시각은 KST 로 적혀 있다(오프셋 없음). 오프셋 없는 시각은 받지 않으므로 +09:00 을 붙인다(가정, README)
KST_OFFSET = "+09:00"
LICENSE_NAME_CODE = re.compile(r"^(.*)/(\d{4})$")
SCHEDULE_TIGHT_DAYS = 7
SCHEDULE_SAFE_DAYS = 30
REGION_EN = {
    "서울특별시": "Seoul",
    "부산광역시": "Busan",
    "대구광역시": "Daegu",
    "인천광역시": "Incheon",
    "광주광역시": "Gwangju",
    "대전광역시": "Daejeon",
    "울산광역시": "Ulsan",
    "세종특별자치시": "Sejong",
    "경기도": "Gyeonggi",
    "강원특별자치도": "Gangwon",
    "충청북도": "Chungbuk",
    "충청남도": "Chungnam",
    "전북특별자치도": "Jeonbuk",
    "전라남도": "Jeonnam",
    "전남광주통합특별시": "Jeonnam-Gwangju",
    "경상북도": "Gyeongbuk",
    "경상남도": "Gyeongnam",
    "제주특별자치도": "Jeju",
}


@dataclass
class BuildOptions:
    recorded_dir: Path
    industry_dir: Path
    companies_dir: Path
    company_file: Path
    splits_file: Path | None
    out_dir: Path
    as_of: date
    dataset_version: str
    holdout_company: str = "06"
    max_train_records: int | None = None
    include_missing_license_rows: bool = False


@dataclass
class BuildReport:
    counts: Counter = field(default_factory=Counter)
    label_counts: dict[str, Counter] = field(default_factory=dict)
    source_counts: dict[str, Counter] = field(default_factory=dict)
    variant_counts: Counter = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            **self.meta,
            "counts": dict(sorted(self.counts.items())),
            "variants": dict(sorted(self.variant_counts.items())),
            "labelsByFamilyAndValue": {
                split: {f"{family}={label}": n for (family, label), n in sorted(c.items())}
                for split, c in self.label_counts.items()
            },
            "labelsBySource": {
                split: dict(sorted(c.items())) for split, c in self.source_counts.items()
            },
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------- 공고 → 추출(구조화 필드만)


def api_evidence(
    revision_id: str, api_source: str, api_field: str, value: str, fetched_at: str
) -> dict[str, Any]:
    return {
        "kind": "API_FIELD",
        "documentId": None,
        "revisionId": revision_id,
        "page": None,
        "charStart": None,
        "charEnd": None,
        "apiField": api_field,
        "apiSource": api_source,
        "quotedText": value[:300],
        "fetchedAt": fetched_at,
    }


def _unknown(note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"value": None, "state": "UNKNOWN", "evidence": []}
    if note:
        out["note"] = note
    return out


def _known(value: Any, evidence: list[dict[str, Any]], note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"value": value, "state": "KNOWN", "evidence": evidence}
    if note:
        out["note"] = note
    return out


def _mapping_note(count: int) -> str | None:
    """원소 i ↔ 근거 i 대응 표기(03 §4.1). note 상한 200자를 넘으면 생략한다(빌더는 필드 근거 전체를 쓴다)."""
    note = ", ".join(f"[{i}]→evidence[{i}]" for i in range(count))
    return note if len(note) <= NOTE_MAX_LENGTH else None


def parse_budget(row: dict[str, Any]) -> tuple[int, str] | None:
    for api_field in ("asignBdgtAmt", "presmptPrce"):
        raw = str(row.get(api_field) or "").strip()
        if raw.isdigit() and int(raw) > 0:
            return int(raw), api_field
    return None


def parse_deadline(row: dict[str, Any]) -> str | None:
    raw = str(row.get("bidClseDt") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", raw):
        return None
    return raw.replace(" ", "T") + KST_OFFSET


def parse_license_name(name: str) -> tuple[str, str | None]:
    """'정보통신공사업/0036' → ('정보통신공사업', '0036'). 코드가 없으면 (원문, None)."""
    match = LICENSE_NAME_CODE.fullmatch(name.strip())
    if match is None:
        return name.strip(), None
    return match.group(1), match.group(2)


def _other_numbers(text: str, exclude: str | None) -> list[str]:
    return sorted({t.replace(",", "") for t in NUMBER_TOKEN.findall(text)} - {exclude or ""})


def license_translation(name: str, code: str | None) -> str:
    """en state 용 한글 없는 표기. 원문 숫자를 모두 보존해야 빌더가 받아 준다(kev_state.text)."""
    base = f"industry code {code}" if code else "license limit"
    extra = _other_numbers(name, code)
    return base + (f" (class {', '.join(extra)})" if extra else "")


def region_translation(name: str) -> str:
    tokens = name.split()
    english = REGION_EN.get(tokens[0]) if tokens else None
    if english is None:
        text = "participation limited to a designated region"
    else:
        text = f"participation limited to {english}" + (" (sub-region)" if len(tokens) > 1 else "")
    extra = _other_numbers(name, None)
    return text + (f" ({', '.join(extra)})" if extra else "")


@dataclass
class NoticeFacts:
    notice: NoticeRecord
    revision_id: str
    extraction: dict[str, Any]
    translations: dict[str, str]
    budget: int | None
    budget_evidence: dict[str, Any] | None
    deadline: date | None
    deadline_evidence: dict[str, Any] | None
    # 면허제한 행마다 (index, 행, 업종 코드, 사전 코드, 근거)
    license_items: list[tuple[int, dict[str, Any], str | None, str | None, dict[str, Any]]]


def make_facts(
    notice: NoticeRecord,
    dictionary: QualificationDictionary,
    industry_master: dict[str, str],
    report: BuildReport,
) -> NoticeFacts:
    row = notice.row
    notice_id, order = notice.key
    revision_id = f"{notice_id}#{order}"
    fetched = notice.fetched_at
    translations: dict[str, str] = {}

    title = str(row.get("bidNtceNm") or "").strip()
    summary = (
        _known(title, [api_evidence(revision_id, API_SOURCE_NOTICE, "bidNtceNm", title, fetched)])
        if title
        else _unknown()
    )
    budget = parse_budget(row)
    budget_evidence = None
    if budget is not None:
        budget_evidence = api_evidence(
            revision_id, API_SOURCE_NOTICE, budget[1], str(row[budget[1]]), fetched
        )
        budget_field = _known(str(budget[0]), [budget_evidence])
    else:
        budget_field = _unknown()
    deadline_iso = parse_deadline(row)
    deadline_evidence = None
    deadline_date = None
    if deadline_iso is not None:
        deadline_evidence = api_evidence(
            revision_id, API_SOURCE_NOTICE, "bidClseDt", str(row["bidClseDt"]), fetched
        )
        deadline_field = _known(deadline_iso, [deadline_evidence])
        deadline_date = date.fromisoformat(deadline_iso[:10])
    else:
        deadline_field = _unknown()
    contract = str(row.get("cntrctCnclsMthdNm") or "").strip()
    contract_field = (
        _known(
            contract,
            [api_evidence(revision_id, API_SOURCE_NOTICE, "cntrctCnclsMthdNm", contract, fetched)],
        )
        if contract
        else _unknown()
    )

    license_items: list[tuple[int, dict[str, Any], str | None, str | None, dict[str, Any]]] = []
    if notice.license_rows:
        values = []
        evidence = []
        for index, lic in enumerate(notice.license_rows):
            name = str(lic.get("lcnsLmtNm") or "").strip()
            _, industry_code = parse_license_name(name)
            if industry_code is None:
                report.counts["licenseRowCodeUnparsed"] += 1
            elif industry_code not in industry_master:
                report.counts["licenseRowCodeNotInMaster"] += 1
            code = dictionary.lookup(name)
            ref = api_evidence(
                revision_id,
                API_SOURCE_LICENSE,
                "lcnsLmtNm",
                name,
                notice.license_fetched_at or fetched,
            )
            values.append({"name": name, "kind": "LICENSE", "mandatory": True, "code": code})
            evidence.append(ref)
            translations[f"qualifications[{index}].name"] = license_translation(name, industry_code)
            license_items.append((index, lic, industry_code, code, ref))
        qualifications = _known(values, evidence, _mapping_note(len(values)))
    elif str(row.get("indstrytyLmtYn") or "") == "N":
        qualifications = {
            "value": None,
            "state": "NOT_APPLICABLE",
            "evidence": [],
            "note": "indstrytyLmtYn=N",
        }
    else:
        qualifications = _unknown("license-limit rows not recorded")

    if notice.region_rows:
        names = [str(r.get("prtcptPsblRgnNm") or "").strip() for r in notice.region_rows]
        evidence = [
            api_evidence(
                revision_id,
                API_SOURCE_REGION,
                "prtcptPsblRgnNm",
                name,
                notice.region_fetched_at or fetched,
            )
            for name in names
        ]
        for index, name in enumerate(names):
            translations[f"restrictions[{index}]"] = region_translation(name)
        restrictions = _known(names, evidence, _mapping_note(len(names)))
    else:
        restrictions = _unknown()

    extraction = {
        "schemaVersion": EXTRACTION_SCHEMA_VERSION,
        "bidId": notice_id,
        "revisionId": revision_id,
        "summary": summary,
        "projectType": _unknown(),
        "domain": _unknown(),
        "requiredSkills": _unknown(NOT_EXTRACTED_NOTE),
        "preferredSkills": _unknown(NOT_EXTRACTED_NOTE),
        "qualifications": qualifications,
        "pastPerformance": _unknown(NOT_EXTRACTED_NOTE),
        "staffing": _unknown(NOT_EXTRACTED_NOTE),
        "budgetKrw": budget_field,
        "deadlineAt": deadline_field,
        "contractMethod": contract_field,
        "restrictions": restrictions,
        "submission": _unknown(),
        "injectionSuspected": False,
        "warnings": [],
    }
    return NoticeFacts(
        notice,
        revision_id,
        extraction,
        translations,
        budget[0] if budget else None,
        budget_evidence,
        deadline_date,
        deadline_evidence,
        license_items,
    )


# ---------------------------------------------------------------- 라벨


def _label(
    qid: str,
    value: str,
    source: str,
    *,
    reason: str | None = None,
    notice: list[dict[str, Any]] | None = None,
    company: list[CompanyEvidenceRef] | None = None,
) -> Label:
    return Label(
        qid=qid,
        label=value,
        reason=reason,  # type: ignore[arg-type]
        labelSource=source,  # type: ignore[arg-type]
        draftedBy="RULE" if source == "RULE_SILVER" else "NONE",
        noticeEvidence=notice or [],
        companyEvidence=company or [],
    )


def qualification_labels(
    facts: NoticeFacts,
    company: CompanyProfileSnapshot,
    split: str,
    first_variant: bool,
    industry_master: dict[str, str],
) -> list[Label]:
    labels: list[Label] = []
    multi = len(facts.license_items) > 1
    for index, _row, industry_code, dict_code, ref in facts.license_items:
        qid = f"req.qualifications[{index}].status"
        if dict_code is None:
            # Kev 담당 항목(사전 코드 없음) → CONSTRUCTED
            if multi:
                if first_variant:
                    labels.append(
                        _label(
                            qid,
                            "NEEDS_REVIEW",
                            "CONSTRUCTED",
                            reason="AMBIGUOUS_MATCH",
                            notice=[ref],
                        )
                    )
                continue
            if industry_code is None:
                labels.append(
                    _label(
                        qid,
                        "NEEDS_REVIEW",
                        "CONSTRUCTED",
                        reason="COMPANY_EVIDENCE_MISSING",
                        notice=[ref],
                    )
                )
                continue
            status, record_index = industry_status(company, industry_code)
            name = industry_master.get(industry_code, industry_code)
            if status is None:
                labels.append(
                    _label(
                        qid,
                        "NEEDS_REVIEW",
                        "CONSTRUCTED",
                        reason="COMPANY_EVIDENCE_MISSING",
                        notice=[ref],
                    )
                )
                continue
            evidence = [
                company_ref(
                    company, "INDUSTRY_CODE", f"industryCodes[{record_index}]", f"{name} ({status})"
                )
            ]
            value = "SATISFIED" if status == "HELD" else "NOT_SATISFIED"
            labels.append(_label(qid, value, "CONSTRUCTED", notice=[ref], company=evidence))
        elif split == "train":
            # 사전 코드 자격은 규칙 담당 → RULE_SILVER(train 만). 여러 행이면 규칙도 AMBIGUOUS_MATCH 다
            if multi:
                labels.append(
                    _label(
                        qid, "NEEDS_REVIEW", "RULE_SILVER", reason="AMBIGUOUS_MATCH", notice=[ref]
                    )
                )
                continue
            status, record_index = license_status(company, dict_code)
            if status is None:
                labels.append(
                    _label(
                        qid,
                        "NEEDS_REVIEW",
                        "RULE_SILVER",
                        reason="COMPANY_EVIDENCE_MISSING",
                        notice=[ref],
                    )
                )
                continue
            lic = company.licenses[record_index]
            evidence = [
                company_ref(
                    company,
                    "LICENSE",
                    f"licenses[{record_index}]",
                    f"{lic.get('name', dict_code)} ({status})",
                )
            ]
            value = "SATISFIED" if status == "HELD" else "NOT_SATISFIED"
            labels.append(_label(qid, value, "RULE_SILVER", notice=[ref], company=evidence))
    return labels


def risk_labels(
    facts: NoticeFacts,
    spec: VariantSpec,
    company: CompanyProfileSnapshot,
    split: str,
) -> list[Label]:
    labels: list[Label] = []
    financial = [company_ref(company, "FINANCIAL", "financials")]
    largest = largest_project_krw(company)
    cap = cap_krw(company)
    budget_ev = [facts.budget_evidence] if facts.budget_evidence else []
    if spec.scale is not None:
        labels.append(
            _label(
                "risk.scale",
                "true" if spec.scale == "over" else "false",
                "CONSTRUCTED",
                notice=budget_ev,
                company=financial,
            )
        )
    elif split == "train" and facts.budget is not None and cap is not None:
        if facts.budget > cap and (largest is None or facts.budget > largest):
            labels.append(
                _label("risk.scale", "true", "RULE_SILVER", notice=budget_ev, company=financial)
            )
        elif facts.budget <= cap and largest is not None and largest >= facts.budget:
            labels.append(
                _label("risk.scale", "false", "RULE_SILVER", notice=budget_ev, company=financial)
            )
    staff = [company_ref(company, "STAFF", "staffAvailability")]
    fte = available_fte(company)
    if spec.staff is not None:
        labels.append(
            _label(
                "risk.staffing",
                "true" if spec.staff == "none" else "false",
                "CONSTRUCTED",
                company=staff,
            )
        )
    elif split == "train" and fte is not None:
        if fte == 0:
            labels.append(_label("risk.staffing", "true", "RULE_SILVER", company=staff))
        elif fte >= AMPLE_FTE:
            labels.append(_label("risk.staffing", "false", "RULE_SILVER", company=staff))
    # risk.schedule: state 에 날짜 기준점은 staffAvailability 의 from(= --as-of)뿐이다. 그 줄이 없는 변형에는
    # 붙이지 않는다(상태만 보고 배울 수 없는 라벨이 된다). 마감이 기준일보다 앞이면(지난 공고) 라벨 없음
    staff_from = staff_window_start(company)
    if split == "train" and facts.deadline is not None and staff_from is not None:
        days = (facts.deadline - staff_from).days
        deadline_ev = [facts.deadline_evidence] if facts.deadline_evidence else []
        if 0 <= days <= SCHEDULE_TIGHT_DAYS:
            labels.append(
                _label("risk.schedule", "true", "RULE_SILVER", notice=deadline_ev, company=staff)
            )
        elif days >= SCHEDULE_SAFE_DAYS:
            labels.append(
                _label("risk.schedule", "false", "RULE_SILVER", notice=deadline_ev, company=staff)
            )
    return labels


# ---------------------------------------------------------------- 조립


def staff_window_start(company: CompanyProfileSnapshot) -> date | None:
    staff = company.staffAvailability
    if staff is None or not staff.get("from"):
        return None
    try:
        return date.fromisoformat(str(staff["from"])[:10])
    except ValueError:
        return None


def variant_specs(facts: NoticeFacts) -> tuple[list[VariantSpec], str | None]:
    """변형 목록과 자격 축의 업종 코드. 자격 축은 '면허제한 한 행 + 사전 코드 없음 + 업종 코드 있음' 일 때만."""
    industry_code = None
    if len(facts.license_items) == 1:
        _, _row, code, dict_code, _ref = facts.license_items[0]
        if dict_code is None and code is not None:
            industry_code = code
    specs = list(VARIANTS_WITH_QUAL if industry_code else VARIANTS_WITHOUT_QUAL)
    if facts.budget is None:
        specs = [s for s in specs if s.scale is None]
    return specs, industry_code


def _is_holdout(company: CompanyProfileSnapshot, prefix: str) -> bool:
    return bool(prefix) and (company.companyId or "").startswith(prefix)


def _sample_train(items: list[EvalItem], limit: int | None) -> list[EvalItem]:
    if limit is None or len(items) <= limit:
        return items
    ranked = sorted(items, key=lambda i: hashlib.sha256(i.itemId.encode()).hexdigest())
    kept = {i.itemId for i in ranked[:limit]}
    return [i for i in items if i.itemId in kept]


def _make_item(
    cluster_id: str,
    split: str,
    notice: NoticeRecord,
    facts: NoticeFacts,
    variant: CompanyProfileSnapshot,
    company_variant_id: str,
    labels: list[Label],
) -> EvalItem:
    """EvalItem 을 만든다. 검증 오류는 위치만 남긴다(값·원문을 메시지에 담지 않는다)."""
    try:
        return EvalItem(
            itemId=f"{cluster_id}:{facts.revision_id}:{company_variant_id}",
            split=split,  # type: ignore[arg-type]
            clusterId=cluster_id,
            source="live",
            bid=BidRef(
                source=notice.registry_key,
                noticeId=notice.key[0],
                amendmentNo=notice.key[1],
                revisionId=facts.revision_id,
            ),
            extraction=facts.extraction,
            translations=facts.translations,
            attachmentsIncomplete=True,
            company=variant,
            profileRevision=variant.revision,
            companyVariantId=company_variant_id,
            labels=labels,
        )
    except ValidationError as error:
        locations = sorted({".".join(str(p) for p in e["loc"]) for e in error.errors()})
        messages = sorted({e["msg"].split("input_value")[0][:160] for e in error.errors()})
        raise DatasetFormatError(
            f"{facts.revision_id} {company_variant_id}: EvalItem 형식 위반 {locations} {messages}"
        ) from None


def build(options: BuildOptions) -> BuildReport:
    report = BuildReport()
    dictionary = default_dictionary()
    recordings = load_recorded_dir(options.recorded_dir)
    bundle: RecordedBundle = join_recordings(recordings)
    report.counts.update({f"recorded.{k}": v for k, v in bundle.counts.items()})
    industry_master = load_industry_master(options.industry_dir)
    if not industry_master:
        report.warnings.append(f"업종 마스터가 없다: {options.industry_dir} (코드 확인 생략)")
    companies, companies_source = load_companies(options.companies_dir, options.company_file)
    if len(companies) < 2:
        report.warnings.append(
            f"원형이 {len(companies)}개뿐이다(개발용 대체 입력: {companies_source})"
        )
    holdout = [c.companyId for c in companies if _is_holdout(c, options.holdout_company)]
    if not holdout:
        report.warnings.append(
            f"홀드아웃 원형({options.holdout_company}*)이 없다. 처음 보는 기업 지표를 낼 수 없다"
        )

    if options.splits_file is not None and options.splits_file.exists():
        splits = load_splits(options.splits_file)
    else:
        if options.splits_file is not None:
            report.warnings.append(f"분할 파일이 없어 유도 분할을 쓴다: {options.splits_file}")
        splits = derive_splits([n.row for n in bundle.notices.values()])
    report.meta["splitsSource"] = splits.source
    report.meta["splitsFile"] = splits.path

    items_by_split: dict[str, list[EvalItem]] = {s: [] for s in SPLITS}
    for key in sorted(bundle.notices):
        notice = bundle.notices[key]
        cluster = splits.lookup(key[0])
        if cluster is None:
            report.counts["skipped.notInSplits"] += 1
            continue
        lmt = str(notice.row.get("indstrytyLmtYn") or "")
        if not notice.license_rows and lmt == "Y" and not options.include_missing_license_rows:
            report.counts["skipped.licenseRowsMissingForY"] += 1
            continue
        facts = make_facts(notice, dictionary, industry_master, report)
        report.counts["notices.used"] += 1
        report.counts[f"notices.{cluster.split}"] += 1
        if facts.license_items:
            report.counts["notices.withLicenseRows"] += 1
            if len(facts.license_items) > 1:
                report.counts["notices.multiRowLicense"] += 1
        specs, industry_code = variant_specs(facts)
        if industry_code is not None:
            report.counts["notices.qualAxis"] += 1
        industry_name = (
            industry_master.get(industry_code or "", industry_code) if industry_code else None
        )
        for company in companies:
            if cluster.split != "test" and _is_holdout(company, options.holdout_company):
                continue
            for position, spec in enumerate(specs):
                variant = make_variant(
                    company,
                    spec,
                    industry_code=industry_code,
                    industry_name=industry_name,
                    budget=facts.budget,
                    as_of=options.as_of,
                    deadline=facts.deadline,
                )
                labels = qualification_labels(
                    facts, variant, cluster.split, position == 0, industry_master
                ) + risk_labels(facts, spec, variant, cluster.split)
                if not labels:
                    report.counts["skipped.variantWithoutLabels"] += 1
                    continue
                company_variant_id = f"{company.companyId}:{spec.variant_id}"
                item = _make_item(
                    cluster.cluster_id,
                    cluster.split,
                    notice,
                    facts,
                    variant,
                    company_variant_id,
                    labels,
                )
                items_by_split[cluster.split].append(item)
                report.variant_counts[spec.variant_id] += 1

    items_by_split["train"] = _sample_train(items_by_split["train"], options.max_train_records)
    options.out_dir.mkdir(parents=True, exist_ok=True)
    for split in SPLITS:
        items = items_by_split[split]
        write_items(options.out_dir / f"items.{split}.jsonl", items)
        report.counts[f"items.{split}"] = len(items)
        family = Counter()
        source = Counter()
        for item in items:
            for label in item.labels:
                qid = re.sub(r"\[\d+\]", "[*]", label.qid)
                family[(qid, label.label)] += 1
                source[label.labelSource] += 1
        report.label_counts[split] = family
        report.source_counts[split] = source
        report.counts[f"labels.{split}"] = sum(family.values())
        report.counts[f"clusters.{split}"] = len({i.clusterId for i in items})
    if splits.source == "derived":
        derived_path = options.out_dir / "splits.derived.json"
        derived_path.write_text(
            json.dumps(
                splits_to_json(splits, datetime.now(UTC).isoformat(), str(options.recorded_dir)),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    report.meta.update(
        {
            "schemaVersion": "sol-eval-build-report/v0.1",
            "datasetVersion": options.dataset_version,
            "branch": BRANCH,
            "asOf": options.as_of.isoformat(),
            "createdAt": datetime.now(UTC).isoformat(),
            "recordedDir": str(options.recorded_dir),
            "maskingVersion": bundle.masking_version,
            "recordedFiles": [
                {"path": str(r.path.relative_to(options.recorded_dir)), "rawSha256": r.raw_sha256}
                for r in bundle.files
            ],
            "industryMasterCodes": len(industry_master),
            "companiesSource": companies_source,
            "companies": [c.companyId for c in companies],
            "holdoutCompany": options.holdout_company,
            "holdoutCompanies": holdout,
            "maxTrainRecords": options.max_train_records,
            "scheduleRule": {"tightDays": SCHEDULE_TIGHT_DAYS, "safeDays": SCHEDULE_SAFE_DAYS},
            "kstOffsetAssumed": KST_OFFSET,
        }
    )
    (options.out_dir / "build-report.json").write_text(
        json.dumps(report.to_json(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
