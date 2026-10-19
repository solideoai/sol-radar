"""local 어댑터 기동 검사(local 명세 §1, L1~L3). 위반은 "키(사유)" 로 모아 기동을 거부한다(exit 78).

1~5단계(설정·URL·질문 세트·레지스트리 항목)에 위반이 있으면 6단계(원격 GET /v1/models 대조)를 하지 않는다.
6단계는 응답이 있고 다를 때만 거부하고, 응답이 없으면(연결 실패·timeout·3xx·401·403·404·5xx) 기동한다.
값(URL·키·해시)은 위반 요약·로그에 넣지 않는다.
"""

import logging
from dataclasses import dataclass

from pydantic import SecretStr

from sol_ai.adapters import http
from sol_ai.adapters.kev_local import LocalKev, check_kev_registry
from sol_ai.adapters.qwen import LocalQwen, system_prompt
from sol_ai.errors import StartupRefused
from sol_ai.paths import PROMPT_FILE, REGISTRY_FILE
from sol_ai.question_sets import V0_1, V0_2, QuestionSet
from sol_ai.registry import ModelRegistry
from sol_ai.schema import ExtractionSchema
from sol_ai.settings import Settings

logger = logging.getLogger("sol_ai.local")

# local Kev 어댑터가 답하는 질문 세트. 지원 여부는 파일이 있는지가 아니라 이 집합으로 판정한다
SUPPORTED_QUESTION_SETS = frozenset({V0_1, V0_2})

# 기동 대조 요청마다의 timeout(초)
REGISTRY_TIMEOUT_S = 5.0
MODELS = "/v1/models"


class LocalConfigError(StartupRefused):
    def __init__(self, violations: list[tuple[str, str]]) -> None:
        super().__init__(", ".join(f"{key}({reason})" for key, reason in violations))
        self.violations = violations


def _given(value: str | None) -> str | None:
    return value if value else None


def _secret_given(value: SecretStr | None) -> bool:
    return value is not None and value.get_secret_value() != ""


def qwen_registry_match(reply: http.HttpReply, model: str) -> bool | None:
    """vLLM GET /v1/models: 200 이면 data[].id 에 모델이 있는지. 200 이 아니거나 읽을 수 없으면 None."""
    if reply.status != 200:
        return None
    body = http.parse_json(reply.text)
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        return None
    return any(isinstance(m, dict) and m.get("id") == model for m in body["data"])


def _check_qwen_registry(endpoint: http.Endpoint, model: str) -> bool | None:
    try:
        reply = http.call(endpoint, "GET", MODELS, timeout_s=REGISTRY_TIMEOUT_S)
    except http.TransportFailure as error:
        logger.warning("qwen /v1/models unreachable: %s", error)
        return None
    result = qwen_registry_match(reply, model)
    if result is None:
        logger.warning("qwen /v1/models unconfirmed: status=%d", reply.status)
    return result


@dataclass(frozen=True)
class LocalAdapters:
    qwen: LocalQwen
    kev: LocalKev | None


def configure_local(
    settings: Settings,
    *,
    kev_enabled: bool,
    question_sets: dict[str, QuestionSet],
    schema: ExtractionSchema,
    prompt_hash: str,
) -> LocalAdapters:
    registry = ModelRegistry.load(REGISTRY_FILE)
    violations: list[tuple[str, str]] = []
    qwen_url, kev_url = _given(settings.QWEN_BASE_URL), _given(settings.KEV_BASE_URL)

    # 1. 자동 대체는 구현하지 않는다(L3)
    if settings.AI_FALLBACK_TO_MOCK == "true":
        violations.append(("AI_FALLBACK_TO_MOCK", "NOT_IMPLEMENTED"))
    # 2. 필수 설정(check:env 와 같은 집합. QWEN_API_KEY 는 선택)
    if qwen_url is None:
        violations.append(("QWEN_BASE_URL", "MISSING"))
    if kev_enabled and kev_url is None:
        violations.append(("KEV_BASE_URL", "MISSING"))
    if kev_enabled and not _secret_given(settings.KEV_API_KEY):
        violations.append(("KEV_API_KEY", "MISSING"))
    # 3. URL 보안: https, 또는 루프백 http
    for key, url in (
        ("QWEN_BASE_URL", qwen_url),
        ("KEV_BASE_URL", kev_url if kev_enabled else None),
    ):
        if url is not None and not http.is_secure_url(url):
            violations.append((key, "INSECURE_URL"))
    # 4·5. 질문 세트·레지스트리 항목
    entry = registry.kev(settings.KEV_MODEL_ID)
    if kev_enabled:
        version = settings.KEV_QUESTION_SET
        if version not in SUPPORTED_QUESTION_SETS or version not in question_sets:
            violations.append(("KEV_QUESTION_SET", "QUESTION_SET_NOT_AVAILABLE"))
        if entry is not None and entry.question_set not in (None, settings.KEV_QUESTION_SET):
            violations.append(("KEV_MODEL_ID", "QUESTION_SET_MISMATCH"))
        if entry is None:
            violations.append(("KEV_MODEL_ID", "NOT_IN_REGISTRY"))
    requested_qwen = _given(settings.QWEN_MODEL)
    default_qwen = registry.qwen_default()
    qwen_runs = registry.qwen_runs()
    qwen_model = requested_qwen or (default_qwen.run if default_qwen is not None else None)
    if qwen_model is None or qwen_model not in qwen_runs:
        violations.append(("QWEN_MODEL", "NOT_IN_REGISTRY"))
    # 1~5 단계에 위반이 있으면 원격 대조를 하지 않는다(e8 결정 1)
    if violations or qwen_url is None or qwen_model is None:
        raise LocalConfigError(violations)

    # 6. 원격 레지스트리 대조(L1). 응답이 있고 다를 때만 거부
    qwen_endpoint = http.Endpoint(qwen_url, settings.QWEN_API_KEY)
    if _check_qwen_registry(qwen_endpoint, qwen_model) is False:
        violations.append(("QWEN_MODEL", "REGISTRY_MISMATCH"))
    kev = None
    if kev_enabled and kev_url is not None and entry is not None:
        kev_endpoint = http.Endpoint(kev_url, settings.KEV_API_KEY)
        match = check_kev_registry(kev_endpoint, entry, REGISTRY_TIMEOUT_S)
        if match is False:
            violations.append(("KEV_MODEL_ID", "REGISTRY_MISMATCH"))
        kev = LocalKev(
            endpoint=kev_endpoint,
            entry=entry,
            model_id=settings.KEV_MODEL_ID,
            question_set=settings.KEV_QUESTION_SET,
            timeout_s=settings.KEV_TIMEOUT_MS / 1000,
            registry_match=match,
        )
    if violations:
        raise LocalConfigError(violations)

    qwen = LocalQwen(
        endpoint=qwen_endpoint,
        model=qwen_model,
        timeout_s=settings.AI_TIMEOUT_MS / 1000,
        system=system_prompt(PROMPT_FILE.read_bytes().decode("utf-8"), schema.text),
        schema=schema.schema,
        budget_tokens=settings.QWEN_CONTEXT_BUDGET_TOKENS,
        prompt_hash=prompt_hash,
    )
    return LocalAdapters(qwen, kev)
