"""가상 기업 원형 로드와 항목별 변형(docs/21 §3.2·§3.3, 22 §4.1, 23 §4.4 갈래 ① COMPANY 블록).

원형: fixtures/eval/companies/NN-*.json(company-profile/v0.1). 없으면 fixtures/company/solideo-profile.json 하나로 개발한다.
변형은 원형 하나를 복사해 한 가지 사실만 바꾼다. 라벨은 바꾼 사실에서 구성으로 정해진다(CONSTRUCTED).

| 축(arm) | 값 | 바꾸는 것 | 라벨 |
|---|---|---|---|
| qual | held / not_held / missing | 면허제한 업종 코드의 industryCodes 기록(+ licenses 미러) | req.qualifications[i].status S / NS / NR·COMPANY_EVIDENCE_MISSING |
| scale | over / within | 수행 상한·실적 금액(예산 대비) | risk.scale true / false |
| staff | none / ample | staffAvailability.availableFte 0 / AMPLE_FTE | risk.staffing true / false |

제안: 서빙 state 빌더(kev_state_v02)는 industryCodes 를 그리지 않는다. 업종 보유 상태가 state 에 보이게 industryCodes 를
licenses 에 `INDUSTRY_<코드>` 로 미러링한다. worker 가 같은 미러링을 하지 않으면 train/serve skew 가 난다(보고 대상).
"""

import copy
import json
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from sol_ai.contracts import CompanyEvidenceRef
from sol_eval.dataset import COMPANY_SCHEMA_VERSION, CompanyProfileSnapshot

QualArm = str | None  # "held" | "not_held" | "missing" | None
ScaleArm = str | None  # "over" | "within" | None
StaffArm = str | None  # "none" | "ample" | None

INDUSTRY_LICENSE_PREFIX = "INDUSTRY_"
AMPLE_FTE = 12
ELIGIBLE_STAFF = 20
STAFF_WINDOW_DAYS = 90


@dataclass(frozen=True)
class VariantSpec:
    variant_id: str
    qual: QualArm = None
    scale: ScaleArm = None
    staff: StaffArm = None


# 변형 순서. 자격 축이 있을 때 7개, 없을 때 뒤 4개만(자격 축 None). 세 자격 값이 1:1:1 에 가깝게 축을 섞는다
VARIANTS_WITH_QUAL = (
    VariantSpec("q-held", qual="held"),
    VariantSpec("q-not-held", qual="not_held"),
    VariantSpec("q-missing", qual="missing"),
    VariantSpec("s-over", qual="held", scale="over"),
    VariantSpec("s-within", qual="not_held", scale="within"),
    VariantSpec("f-none", qual="missing", staff="none"),
    VariantSpec("f-ample", qual="held", staff="ample"),
)
VARIANTS_WITHOUT_QUAL = (
    VariantSpec("s-over", scale="over"),
    VariantSpec("s-within", scale="within"),
    VariantSpec("f-none", staff="none"),
    VariantSpec("f-ample", staff="ample"),
)


class CompanyFormatError(ValueError):
    pass


def industry_license_code(industry_code: str) -> str:
    return f"{INDUSTRY_LICENSE_PREFIX}{industry_code}"


def industry_license_name(industry_code: str) -> str:
    """한글 없는 이름. en state 의 license_label 은 번역 경로가 없어 한글이면 (untranslated) 가 된다."""
    return f"industry code {industry_code}"


def load_company(path: Path) -> CompanyProfileSnapshot:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != COMPANY_SCHEMA_VERSION:
        raise CompanyFormatError(
            f"{path.name}: schemaVersion 이 {COMPANY_SCHEMA_VERSION} 이 아니다"
        )
    data.setdefault("industryCodes", [])
    data["companyId"] = path.stem
    return CompanyProfileSnapshot.model_validate(data)


def load_companies(
    directory: Path, fallback_file: Path
) -> tuple[list[CompanyProfileSnapshot], str]:
    """원형 폴더의 *.json 을 이름순으로. 폴더가 없거나 비었으면 fallback 파일 하나(개발용)."""
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    if files:
        return [load_company(f) for f in files], str(directory)
    return [load_company(fallback_file)], str(fallback_file)


def mirror_industry_codes(profile: dict[str, Any]) -> None:
    """industryCodes 를 licenses 에 INDUSTRY_<코드> 항목으로 비춘다(없으면 추가, 있으면 status 를 맞춘다)."""
    by_code = {lic.get("code"): lic for lic in profile["licenses"]}
    for entry in profile["industryCodes"]:
        code = industry_license_code(entry["code"])
        mirrored = by_code.get(code)
        if mirrored is None:
            profile["licenses"].append(
                {
                    "code": code,
                    "name": industry_license_name(entry["code"]),
                    "status": entry["status"],
                }
            )
        else:
            mirrored["status"] = entry["status"]
            mirrored["name"] = industry_license_name(entry["code"])


def _set_industry(profile: dict[str, Any], industry_code: str, name: str, arm: str) -> None:
    profile["industryCodes"] = [e for e in profile["industryCodes"] if e["code"] != industry_code]
    profile["licenses"] = [
        lic
        for lic in profile["licenses"]
        if lic.get("code") != industry_license_code(industry_code)
    ]
    if arm == "missing":
        return
    status = "HELD" if arm == "held" else "NOT_HELD"
    profile["industryCodes"].append({"code": industry_code, "name": name, "status": status})


def _set_scale(profile: dict[str, Any], arm: str, budget: int) -> None:
    financials = dict(profile.get("financials") or {})
    projects = [dict(p) for p in profile["pastProjects"]]
    if arm == "over":
        cap = max(1, budget // 2)
        financials["maxContractKrw"] = str(cap)
        for project in projects:
            project["amountKrw"] = str(min(int(project["amountKrw"]), cap))
    else:
        financials["maxContractKrw"] = str(budget * 2)
        if projects:
            largest = max(projects, key=lambda p: int(p["amountKrw"]))
            largest["amountKrw"] = str(max(int(largest["amountKrw"]), budget))
    profile["financials"] = financials
    profile["pastProjects"] = projects


def _set_staff(profile: dict[str, Any], arm: str, as_of: date, deadline: date | None) -> None:
    end = (
        deadline
        if deadline is not None and deadline > as_of
        else as_of + timedelta(days=STAFF_WINDOW_DAYS)
    )
    profile["staffAvailability"] = {
        "from": as_of.isoformat(),
        "to": end.isoformat(),
        "availableFte": 0 if arm == "none" else AMPLE_FTE,
        "eligibleStaff": ELIGIBLE_STAFF,
    }


def make_variant(
    base: CompanyProfileSnapshot,
    spec: VariantSpec,
    *,
    industry_code: str | None,
    industry_name: str | None,
    budget: int | None,
    as_of: date,
    deadline: date | None,
) -> CompanyProfileSnapshot:
    """원형 복사본에 spec 의 축을 적용한다. 적용할 수 없는 축(예산 없음·업종 없음)은 호출자가 미리 거른다."""
    profile = copy.deepcopy(base.model_dump(exclude_none=True))
    if spec.qual is not None:
        if industry_code is None:
            raise ValueError("자격 축에는 업종 코드가 필요하다")
        _set_industry(profile, industry_code, industry_name or industry_code, spec.qual)
    if spec.scale is not None:
        if budget is None:
            raise ValueError("규모 축에는 예산이 필요하다")
        _set_scale(profile, spec.scale, budget)
    if spec.staff is not None:
        _set_staff(profile, spec.staff, as_of, deadline)
    mirror_industry_codes(profile)
    profile["companyId"] = base.companyId
    profile["variantId"] = spec.variant_id
    return CompanyProfileSnapshot.model_validate(profile)


def industry_status(profile: CompanyProfileSnapshot, industry_code: str) -> tuple[str | None, int]:
    """회사 기록의 업종 상태와 industryCodes index. 기록이 없으면 (None, -1)."""
    for index, entry in enumerate(profile.industryCodes):
        if entry.get("code") == industry_code:
            return entry.get("status"), index
    return None, -1


def license_status(profile: CompanyProfileSnapshot, code: str) -> tuple[str | None, int]:
    for index, entry in enumerate(profile.licenses):
        if entry.get("code") == code:
            return entry.get("status"), index
    return None, -1


def company_ref(
    profile: CompanyProfileSnapshot, kind: str, record_key: str, quoted: str | None = None
) -> CompanyEvidenceRef:
    return CompanyEvidenceRef(
        profileRevision=profile.revision,
        kind=kind,  # type: ignore[arg-type]
        recordKey=record_key,
        documentId=None,
        quotedText=quoted,
    )


def largest_project_krw(profile: CompanyProfileSnapshot) -> int | None:
    amounts = [int(p["amountKrw"]) for p in profile.pastProjects if p.get("amountKrw")]
    return max(amounts) if amounts else None


def cap_krw(profile: CompanyProfileSnapshot) -> int | None:
    financials = profile.financials or {}
    value = financials.get("maxContractKrw")
    return int(value) if value else None


def available_fte(profile: CompanyProfileSnapshot) -> float | None:
    staff = profile.staffAvailability
    if staff is None or staff.get("availableFte") is None:
        return None
    return float(staff["availableFte"])
