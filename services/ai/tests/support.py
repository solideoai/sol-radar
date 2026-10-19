"""시험 공용 도우미. 경로·fixture 읽기·요청 본문 조립·기대값 계산만 한다(제품 코드를 흉내 내지 않는다).

기대값은 명세(03·15·K1~K10)에서 직접 옮기거나, fixture 원문에서 str.find 같은 단순 연산으로 계산한다.
"""

import copy
import hashlib
import json
import re
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]  # services/ai
REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "fixtures"

SCHEMA_FILE = AI_ROOT / "schemas" / "requirement-extraction.v0.1.json"
PROMPT_FILE = AI_ROOT / "prompts" / "req-extract.v0.1.md"
DICTIONARY_FILE = AI_ROOT / "dictionaries" / "qualification-codes.yaml"
QUESTION_SET_FILE = AI_ROOT / "kev" / "question-sets" / "v0.1.json"
SRC_DIR = AI_ROOT / "src" / "sol_ai"

PROMPT_VERSION = "req-extract/v0.1"
KEV_DISCLAIMER = "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."
FIXED_CLOSING = "최종 참여 결정은 사람이 합니다."

FIELDS = (
    "summary",
    "projectType",
    "domain",
    "requiredSkills",
    "preferredSkills",
    "qualifications",
    "pastPerformance",
    "staffing",
    "budgetKrw",
    "deadlineAt",
    "contractMethod",
    "restrictions",
    "submission",
)

# 03 §5.6 한글 범위(음절·자모·호환 자모)
HANGUL = re.compile("[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]")
# 03 §6·명세 §3 숫자 토큰
NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")
# G4: "수주 확률" 이 부정 없이 단독으로 나오면 안 된다. 고지 문구를 지운 뒤 0회여야 한다.
WIN_PROBABILITY = re.compile(r"수주\s*확률")

# 요청에 쓰는 ID. fixture 자리표시("FX-01", "FX-01#01")와 다르게 둬서 치환(K5)을 볼 수 있게 한다.
BID_ID = "4d1f3e2a-0000-4000-8000-000000000001"
REVISION_ID = "9b7c1d2e-0000-4000-8000-000000000002"

ALL_EXTRACTION_IDS = tuple(sorted(p.stem for p in (FIXTURES_DIR / "extractions").glob("*.json")))
ALL_BID_IDS = tuple(sorted(p.stem for p in (FIXTURES_DIR / "bids").glob("*.json")))


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def extraction_fixture(fixture_id: str) -> dict:
    """fixtures/extractions/<id>.json 의 사본(시험이 고쳐 써도 원본에 영향 없다)."""
    return copy.deepcopy(load_json(FIXTURES_DIR / "extractions" / f"{fixture_id}.json"))


def kev_fixture(fixture_id: str) -> dict:
    return copy.deepcopy(load_json(FIXTURES_DIR / "kev" / f"{fixture_id}.json"))


def bid_record(fixture_id: str) -> dict:
    """K5: FX-xx 는 마지막 record, FX-xx.rNN 은 NN 번째(1부터) record."""
    base, _, revision = fixture_id.partition(".")
    records = load_json(FIXTURES_DIR / "bids" / f"{base}.json")["records"]
    if revision:
        return records[int(revision.removeprefix("r")) - 1]
    return records[-1]


def bid_body(fixture_id: str) -> str:
    return bid_record(fixture_id)["content"]


def bid_meta(fixture_id: str) -> dict:
    """NormalizedBid 메타. 원문 표기 예산("1,500백만원")과 상대 날짜("+21d")는 정규화 전 값이라 null 로 둔다."""
    record = bid_record(fixture_id)
    budget = record.get("budgetKrw")
    return {
        "stage": record.get("stage"),
        "agency": record.get("agency"),
        "budgetKrw": budget if isinstance(budget, str) and budget.isdigit() else None,
        "deadlineAt": None,
    }


def extract_request(
    fixture_id: str | None,
    *,
    body: str | None = None,
    meta: dict | None = None,
    attachments: list | None = None,
    request_id: str = "req-extract-0001",
) -> dict:
    """03 §2.1 ExtractRequest. fixture_id 가 None 이면 fixtureId 키를 넣지 않는다."""
    source = fixture_id if fixture_id is not None else "FX-01"
    request = {
        "requestId": request_id,
        "bidId": BID_ID,
        "revisionId": REVISION_ID,
        "meta": meta if meta is not None else bid_meta(source),
        "body": body if body is not None else bid_body(source),
        "attachments": attachments if attachments is not None else [],
    }
    if fixture_id is not None:
        request["fixtureId"] = fixture_id
    return request


def expected_prompt_hash(version: str = PROMPT_VERSION) -> str:
    """명세 §1-4: sha256(prompt 파일 전문 + "\\n" + schema 파일 전문 + "\\n" + AI_PROMPT_VERSION), 접두 없음."""
    prompt = PROMPT_FILE.read_bytes().decode("utf-8")
    schema = SCHEMA_FILE.read_bytes().decode("utf-8")
    return hashlib.sha256(f"{prompt}\n{schema}\n{version}".encode()).hexdigest()


def without_timings(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k != "timings"}


def canonical(payload: dict) -> str:
    """byte 비교용 직렬화(응답 JSON 의 키 순서를 그대로 둔다)."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def write_fixture_dir(
    root: Path, extractions: dict[str, dict] | None = None, kev: dict[str, dict] | None = None
) -> Path:
    """SOL_FIXTURES_DIR 로 가리킬 시험 전용 fixture 디렉터리를 만든다."""
    (root / "extractions").mkdir(parents=True, exist_ok=True)
    (root / "kev").mkdir(parents=True, exist_ok=True)
    for name, data in (extractions or {}).items():
        (root / "extractions" / f"{name}.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
    for name, data in (kev or {}).items():
        (root / "kev" / f"{name}.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
    return root


def text_ref(quoted_text: str, document_id: str | None = None, **extra) -> dict:
    """모델 출력 형태의 EvidenceRef(match 없음)."""
    return {
        "documentId": document_id,
        "revisionId": "FX-01#01",
        "fetchedAt": "2026-10-16T09:00:00Z",
        "quotedText": quoted_text,
        **extra,
    }


def drop_none(value):
    """선택 키의 "없음"과 "null" 표기 차이만 지운다(값 비교용)."""
    if isinstance(value, dict):
        return {k: drop_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [drop_none(v) for v in value]
    return value


def number_set(value) -> set[str]:
    """입력 JSON 전체에서 모은 숫자 토큰 집합(쉼표 제거). 명세 §3 숫자 검사와 같은 토큰 규칙."""
    text = json.dumps(value, ensure_ascii=False)
    return {token.replace(",", "") for token in NUMBER_TOKEN.findall(text)}


def ordered_numbers(text: str) -> list[str]:
    seen: list[str] = []
    for token in NUMBER_TOKEN.findall(text):
        cleaned = token.replace(",", "")
        if cleaned not in seen:
            seen.append(cleaned)
    return seen


# ---------------------------------------------------------------- /kev·/explain 요청 본문

KEV_ASSIST_KEYS = {
    "enabled",
    "provider",
    "model",
    "questionSetVersion",
    "suggestedOption",
    "probabilities",
    "confidence",
    "mandatoryRisk",
    "needsHumanReview",
    "fit",
    "scores",
    "risks",
    "calibration",
    "stateTrace",
    "latencyMs",
    "requestId",
    "disclaimer",
}
LEGEND = {"0": "Very poor", "1": "Poor", "2": "Moderate", "3": "Good", "4": "Very good"}

# main 폴더 fixtures/company/solideo-profile.json(가상 솔리데오 revision 2) 모양을 본뜬 시험 상수(K6).
PROFILE = {
    "revision": 2,
    "name": "솔리데오",
    "isDemo": True,
    "technologies": [
        {"name": "Java"},
        {"name": "Spring Boot"},
        {"name": "전자정부 표준프레임워크"},
        {"name": "NestJS"},
        {"name": "Next.js"},
        {"name": "PostgreSQL"},
        {"name": "Kubernetes"},
        {"name": "RAG/LLM 적용"},
    ],
    "technologiesComplete": True,
    "licenses": [
        {"code": "SW_BUSINESS_REG", "name": "소프트웨어사업자 신고확인서", "status": "HELD"},
        {
            "code": "DIRECT_PRODUCTION",
            "name": "직접생산확인증명서(소프트웨어개발)",
            "status": "HELD",
        },
        {"code": "SME_CONFIRMATION", "name": "중소기업확인서(중기업)", "status": "HELD"},
        {"code": "ISO_27001", "name": "ISO 27001", "status": "HELD"},
        {"code": "CMMI_L3", "name": "CMMI L3", "status": "HELD"},
        {"code": "ICT_CONSTRUCTION", "name": "정보통신공사업 등록", "status": "NOT_HELD"},
        {"code": "DEFENSE_CONTRACTOR", "name": "방산업체 지정", "status": "NOT_HELD"},
        {"code": "ISMS_P", "name": "ISMS-P", "status": "NOT_HELD"},
        {"code": "CSAP", "name": "CSAP", "status": "NOT_HELD"},
    ],
    "industryCodes": [],
    "pastProjects": [
        {
            "id": "P1",
            "name": "지자체 민원 시스템 고도화",
            "domain": "민원",
            "amountKrw": "1200000000",
            "completedAt": "2024-11-30",
            "evidenceRef": "company-evidence/P1-completion-certificate",
        },
        {
            "id": "P2",
            "name": "공공기관 데이터 플랫폼 구축",
            "domain": "데이터 플랫폼",
            "amountKrw": "2800000000",
            "completedAt": "2024-03-31",
            "evidenceRef": "company-evidence/P2-completion-certificate",
        },
        {
            "id": "P3",
            "name": "교육기관 AI 챗봇 PoC",
            "domain": "교육",
            "amountKrw": "300000000",
            "completedAt": "2025-09-30",
            "evidenceRef": "company-evidence/P3-completion-certificate",
        },
    ],
    "financials": {
        "fiscalYear": 2025,
        "annualRevenueKrw": "18000000000",
        "employeeCount": 200,
        "maxContractKrw": "5000000000",
    },
    "preferences": {
        "agencies": [],
        "agencyTypes": ["지자체", "교육청"],
        "domains": ["데이터 플랫폼", "AX", "민원", "교육"],
        "excludedDomains": ["국방"],
        "excludedKeywords": ["무기체계"],
    },
    "staffAvailability": {
        "from": "2026-12-01",
        "to": "2027-06-30",
        "availableFte": 20,
        "eligibleStaff": 27,
    },
}


def kev_request(
    fixture_id: str | None = "FX-01",
    *,
    extraction: dict | None = None,
    profile: dict | None = None,
    **changes,
) -> dict:
    source = (fixture_id or "FX-01").split(".")[0]
    request = {
        "requestId": f"req-kev-{source}",
        "bidId": BID_ID,
        "orgId": "org-01",
        "revisionId": REVISION_ID,
        "profileRevision": 2,
        "extraction": extraction if extraction is not None else extraction_fixture(source),
        "translations": None,
        "profileSummary": profile if profile is not None else copy.deepcopy(PROFILE),
        "attachmentsIncomplete": False,
        "questionSetVersion": "kev-qs/v0.1",
        "stateLanguage": "en",
    }
    if fixture_id is not None:
        request["fixtureId"] = fixture_id
    request.update(changes)
    return request


def explain_request() -> dict:
    """K8 ExplainRequest. FX-03 상황: 필수 자격 하나 NOT_SATISFIED, 규칙 NO_BID 68점, Kev 는 BID(불일치)."""
    sw_ref = {
        "documentId": None,
        "revisionId": REVISION_ID,
        "charStart": 158,
        "charEnd": 180,
        "quotedText": "소프트웨어사업자 신고확인서를 보유한 업체",
        "fetchedAt": "2026-10-16T09:00:00Z",
        "match": "NORMALIZED",
    }
    ict_ref = {
        **sw_ref,
        "charStart": 186,
        "charEnd": 211,
        "quotedText": "정보통신공사업 등록업체일 것",
    }
    kev = {
        "enabled": True,
        "provider": "mock",
        "model": "mock",
        "questionSetVersion": "kev-qs/v0.1",
        "suggestedOption": "BID",
        "probabilities": {"BID": 0.55, "WATCH": 0.3, "NO_BID": 0.15},
        "confidence": 0.55,
        "mandatoryRisk": 0.85,
        "needsHumanReview": 0.58,
        "fit": {"score": 1.8, "legend": LEGEND},
        "scores": None,
        "risks": None,
        "calibration": None,
        "stateTrace": None,
        "latencyMs": 0,
        "requestId": None,
        "disclaimer": KEV_DISCLAIMER,
    }

    def factor(key: str, points: float, max_points: int, normalized: float) -> dict:
        return {
            "factor": key,
            "rawValue": {},
            "normalized": normalized,
            "points": points,
            "maxPoints": max_points,
            "missing": False,
            "missingReason": None,
            "evidence": [],
            "note": None,
        }

    return {
        "requestId": "req-explain-FX-03",
        "qualificationChecks": [
            {
                "id": "qualifications[0]",
                "requirementCode": "SW_BUSINESS_REG",
                "requirementName": "소프트웨어사업자 신고확인서",
                "mandatory": True,
                "outcome": "SATISFIED",
                "reason": "회사 프로필에 보유 기록이 있다",
                "reasonCode": None,
                "basis": "EXTRACTION",
                "evidence": [sw_ref],
                "profileEvidence": [
                    {
                        "type": "LICENSE",
                        "ref": "licenses[0]",
                        "label": "소프트웨어사업자 신고확인서",
                    }
                ],
                "companyEvidence": [],
            },
            {
                "id": "qualifications[1]",
                "requirementCode": "ICT_CONSTRUCTION",
                "requirementName": "정보통신공사업 등록",
                "mandatory": True,
                "outcome": "NOT_SATISFIED",
                "reason": "회사 프로필에 미보유로 기록돼 있다",
                "reasonCode": None,
                "basis": "EXTRACTION",
                "evidence": [ict_ref],
                "profileEvidence": [
                    {"type": "LICENSE", "ref": "licenses[5]", "label": "정보통신공사업 등록"}
                ],
                "companyEvidence": [
                    {
                        "profileRevision": 2,
                        "kind": "LICENSE",
                        "recordKey": "licenses[5]",
                        "documentId": None,
                        "quotedText": None,
                    }
                ],
            },
        ],
        "scoreBreakdown": {
            "score": 68,
            "factors": [
                factor("skillMatch", 21.0, 30, 0.7),
                factor("pastPerformance", 15.0, 25, 0.6),
                factor("staffAvailability", 16.0, 20, 0.8),
                factor("scaleFit", 9.0, 15, 0.6),
                factor("strategicPreference", 7.0, 10, 0.7),
            ],
            "recommendation": "NO_BID",
            "recommendationBasis": "RULES_WITH_KEV_ASSIST",
            "reviewFlags": ["MODEL_RULE_DISAGREEMENT", "KEV_MANDATORY_RISK"],
            "missingFactors": [],
        },
        "evidence": [sw_ref, ict_ref],
        "kevSummary": kev,
        "documentIssues": [],
    }
