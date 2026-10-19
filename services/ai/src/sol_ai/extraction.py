"""POST /extract 검증 파이프라인(docs/03 §4.4, 명세 §1). mock·local 이 같은 코드로 지난다.

어느 단계도 값을 "고쳐서 살리지" 않는다. 살릴 수 없으면 UNKNOWN 이다.
순서: 입력 인젝션 → 모델 호출 → 스키마 정리·검증 → gateway 값 채우기 → 상태 정합성 → 인용 검증
→ 출력 인젝션 → 정규화 → 메타데이터 대조 → 사전 매핑 → 상태 결정.
"""

import copy
import json
import logging
import time
from collections.abc import Iterable
from dataclasses import dataclass

from sol_ai.adapters.base import ExtractionFailed, ModelOutput, ModelUnavailable, QwenAdapter
from sol_ai.citation import DocumentText, norm, threshold_of, verify_fields
from sol_ai.contracts import ExtractMeta, ExtractRequest, ExtractResponse, ExtractTimings
from sol_ai.guards import InjectionGuard
from sol_ai.qualifications import QualificationDictionary
from sol_ai.schema import ExtractionSchema
from sol_ai.timeutil import parse_instant, to_utc_z

logger = logging.getLogger("sol_ai.extract")

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
LIST_FIELDS = frozenset(
    {
        "requiredSkills",
        "preferredSkills",
        "qualifications",
        "pastPerformance",
        "staffing",
        "restrictions",
    }
)
SKILL_FIELDS = ("requiredSkills", "preferredSkills")
# 응답 EvidenceRef 키 순서(15 §2)
REF_KEYS = (
    "kind",
    "documentId",
    "revisionId",
    "page",
    "charStart",
    "charEnd",
    "apiField",
    "apiSource",
    "quotedText",
    "sourceUrl",
    "fetchedAt",
    "match",
)
QUALIFICATION_KEYS = ("name", "kind", "mandatory", "detail", "code")
NOTE_MAX_CHARS = 200

INJECTION_SUSPECTED = "INJECTION_SUSPECTED"
LOW_CONFIDENCE = "EXTRACTION_LOW_CONFIDENCE"
ATTACHMENT_PARSE_FAILED = "ATTACHMENT_PARSE_FAILED:"
EXTRACTION_FAILED = "EXTRACTION_FAILED"
QWEN_UNAVAILABLE = "QWEN_UNAVAILABLE"


@dataclass(frozen=True)
class ExtractionConfig:
    schema: ExtractionSchema
    guard: InjectionGuard
    dictionary: QualificationDictionary
    prompt_version: str
    prompt_hash: str
    fuzzy_min_ratio: float


def decide_status(*, failed: bool, injection: bool, warnings: Iterable[str]) -> str:
    """K2 상태 결정. 실패면 FAILED. 인젝션 의심·첨부 파싱 실패·인용 저신뢰면 PENDING_REVIEW. 아니면 COMPLETED."""
    if failed:
        return "FAILED"
    codes = list(warnings)
    if (
        injection
        or LOW_CONFIDENCE in codes
        or any(code.startswith(ATTACHMENT_PARSE_FAILED) for code in codes)
    ):
        return "PENDING_REVIEW"
    return "COMPLETED"


def _dedupe(codes: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(codes))


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _failed(
    error_code: str, injection: bool, warnings: list[str], started: float
) -> ExtractResponse:
    codes = _dedupe(([INJECTION_SUSPECTED] if injection else []) + warnings)
    return ExtractResponse(
        status=decide_status(failed=True, injection=injection, warnings=codes),
        payload=None,
        translations=None,
        errorCode=error_code,
        injectionSuspected=injection,
        warnings=codes,
        timings=ExtractTimings(extractMs=_elapsed_ms(started)),
    )


def _documents(request: ExtractRequest) -> dict[str | None, DocumentText]:
    """인용 검증 대상 문서. None = 공고 본문. 같은 documentId 가 두 번 오면 앞의 것."""
    documents: dict[str | None, DocumentText] = {None: DocumentText(norm(request.body), [])}
    for attachment in request.attachments:
        documents.setdefault(
            attachment.documentId,
            DocumentText(norm(attachment.text), [p.model_dump() for p in attachment.pages]),
        )
    return documents


def _ordered_ref(ref: dict, revision_id: str) -> dict:
    ref = {**ref, "revisionId": revision_id}
    return {key: ref[key] for key in REF_KEYS if key in ref}


def _fill_gateway_values(
    extraction: dict,
    request: ExtractRequest,
    qwen: QwenAdapter,
    output: ModelOutput,
    config: ExtractionConfig,
) -> dict:
    """bidId·revisionId·evidence[].revisionId 는 요청 값(K5).

    model 은 어댑터가 고정 블록을 주면 그것(스키마 정리·검증을 거친 값) 그대로, 아니면 gateway 가 채운다.
    """
    payload = copy.deepcopy(extraction)
    payload["bidId"] = request.bidId
    payload["revisionId"] = request.revisionId
    if output.model_block is None:
        payload["model"] = {
            "provider": qwen.provider,
            "name": qwen.model_name,
            "promptVersion": config.prompt_version,
            "promptHash": config.prompt_hash,
            "temperature": 0,
            "extractedAt": output.extracted_at,
            "latencyMs": output.latency,
            "retries": output.retries,
        }
    for name in FIELDS:
        payload[name]["evidence"] = [
            _ordered_ref(ref, request.revisionId) for ref in payload[name]["evidence"]
        ]
    return payload


def fix_states(fields: dict[str, dict]) -> list[str]:
    """5단계 상태 정합성(15 §2 "value 는 state 가 KNOWN 일 때만 non-null").

    - KNOWN 인데 value=null 또는 evidence=[] → UNKNOWN, value=null.
    - NOT_APPLICABLE·UNKNOWN·CONFLICTED 인데 value 가 non-null → value=null, state·note 는 그대로.
    둘 다 STATE_FIXED:<field>. 출력 인젝션 탐지는 이 단계 전의 모델 값으로 이미 했다.
    """
    warnings = []
    for name in FIELDS:
        extracted = fields[name]
        if extracted["state"] == "KNOWN":
            if extracted["value"] is None or not extracted["evidence"]:
                extracted["value"] = None
                extracted["state"] = "UNKNOWN"
                warnings.append(f"STATE_FIXED:{name}")
        elif extracted["value"] is not None:
            extracted["value"] = None
            warnings.append(f"STATE_FIXED:{name}")
    return warnings


def normalize_values(fields: dict[str, dict]) -> None:
    """8단계 정규화: deadlineAt 은 UTC Z 표기, 기술명 trim. budgetKrw 는 스키마가 숫자만 허용한다."""
    deadline = fields["deadlineAt"]
    if deadline["state"] == "KNOWN" and deadline["value"] is not None:
        deadline["value"] = to_utc_z(deadline["value"])
    for name in SKILL_FIELDS:
        if fields[name]["state"] == "KNOWN" and fields[name]["value"] is not None:
            fields[name]["value"] = [skill.strip() for skill in fields[name]["value"]]


def _conflict(extracted: dict, meta_value: str, value: str) -> None:
    extracted["value"] = None
    extracted["state"] = "CONFLICTED"
    extracted["note"] = f"NormalizedBid {meta_value} vs extraction {value}"[:NOTE_MAX_CHARS]


def _known(extracted: dict) -> bool:
    return extracted["state"] == "KNOWN" and extracted["value"] is not None


def compare_metadata(fields: dict[str, dict], meta: ExtractMeta) -> None:
    """9단계: NormalizedBid 의 예산·마감과 추출 KNOWN 값이 다르면 CONFLICTED(근거는 유지).

    meta 가 null 이면 대조하지 않는다. 마감은 같은 시각이면 표기(오프셋)가 달라도 같다고 본다.
    """
    budget = fields["budgetKrw"]
    if (
        meta.budgetKrw is not None
        and _known(budget)
        and int(meta.budgetKrw) != int(budget["value"])
    ):
        _conflict(budget, meta.budgetKrw, budget["value"])
    deadline = fields["deadlineAt"]
    if (
        meta.deadlineAt is not None
        and _known(deadline)
        and parse_instant(meta.deadlineAt) != parse_instant(deadline["value"])
    ):
        _conflict(deadline, meta.deadlineAt, deadline["value"])


def assign_qualification_codes(qualifications: dict, dictionary: QualificationDictionary) -> None:
    """10단계: code 는 모델 값을 버리고 사전으로 다시 채운다(못 찾으면 null)."""
    if not isinstance(qualifications["value"], list):
        return
    filled = []
    for item in qualifications["value"]:
        item = {**item, "code": dictionary.lookup(item["name"])}
        filled.append({key: item[key] for key in QUALIFICATION_KEYS if key in item})
    qualifications["value"] = filled


def _ordered_field(extracted: dict) -> dict:
    ordered = {
        "value": extracted["value"],
        "state": extracted["state"],
        "evidence": extracted["evidence"],
    }
    if "note" in extracted:
        ordered["note"] = extracted["note"]
    return ordered


def run_extraction(
    request: ExtractRequest, qwen: QwenAdapter, config: ExtractionConfig
) -> ExtractResponse:
    started = time.perf_counter()

    # 1. 입력 인젝션 탐지. 텍스트는 그대로 모델에 보낸다(지우면 인용 오프셋이 틀어진다)
    input_flag = config.guard.scan_input([request.body, *(a.text for a in request.attachments)])

    # 2. 모델 호출
    try:
        output = qwen.extract(request)
    except ModelUnavailable as error:
        return _failed(QWEN_UNAVAILABLE, input_flag, error.warnings, started)
    except ExtractionFailed as error:
        return _failed(EXTRACTION_FAILED, input_flag, error.warnings, started)

    # 3. 스키마 정리·검증. 위반은 FAILED(mock 은 재시도해도 같다)
    try:
        raw = json.loads(output.text)
    except ValueError:
        logger.warning("extract: model output is not JSON")
        return _failed(EXTRACTION_FAILED, input_flag, [], started)
    if output.model_block is not None and isinstance(raw, dict):
        # 어댑터가 준 고정 model 블록도 같은 스키마 정리·검증을 지난다
        raw = {**raw, "model": output.model_block}
    extraction = config.schema.prune(raw)
    errors = config.schema.errors(extraction)
    if errors:
        logger.warning("extract: schema violation at %s", errors[:5])
        return _failed(EXTRACTION_FAILED, input_flag, [], started)

    # 7단계(출력 인젝션)는 모델이 낸 값으로 본다. 5단계가 값을 지우기 전에 판정하고 결과만 뒤에 합친다
    output_flag = config.guard.scan_output(extraction, FIELDS)
    model_warnings = list(extraction["warnings"])

    # 4. gateway 가 채우는 값
    payload = _fill_gateway_values(extraction, request, qwen, output, config)
    fields = {name: payload[name] for name in FIELDS}
    warnings = [INJECTION_SUSPECTED] if input_flag else []

    # 5. 상태 정합성
    warnings += fix_states(fields)

    # 6. 인용 검증(15 §5, K1)
    citation = verify_fields(
        fields, _documents(request), threshold_of(config.fuzzy_min_ratio), LIST_FIELDS
    )
    warnings += citation.warnings
    if citation.low_confidence:
        warnings.append(LOW_CONFIDENCE)

    # 7. 출력 인젝션 결과 합치기
    if output_flag:
        warnings.append(INJECTION_SUSPECTED)

    # 8~10. 정규화 → 메타데이터 대조 → 사전 매핑
    normalize_values(fields)
    compare_metadata(fields, request.meta)
    assign_qualification_codes(fields["qualifications"], config.dictionary)

    # 11. 상태 결정. 경고는 모델(fixture) 경고 먼저, gateway 경고 뒤, 중복 없이
    injection = input_flag or output_flag or INJECTION_SUSPECTED in model_warnings
    all_warnings = _dedupe(model_warnings + warnings)
    status = decide_status(failed=False, injection=injection, warnings=all_warnings)
    ordered = {
        "schemaVersion": payload["schemaVersion"],
        "bidId": payload["bidId"],
        "revisionId": payload["revisionId"],
        "model": payload["model"],
        **{name: _ordered_field(fields[name]) for name in FIELDS},
        "injectionSuspected": injection,
        "warnings": all_warnings,
    }
    return ExtractResponse(
        status=status,
        payload=ordered,
        translations=None,
        errorCode=None,
        injectionSuspected=injection,
        warnings=all_warnings,
        timings=ExtractTimings(extractMs=_elapsed_ms(started)),
    )
