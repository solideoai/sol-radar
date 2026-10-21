"""local 어댑터 기동 검사(local 명세 §1, L1~L3). 위반은 "키(사유)" 로 모아 기동을 거부한다(exit 78).

1~5단계(설정·키 형식·URL·질문 세트·레지스트리 항목)에 위반이 있으면 6단계(원격 GET /v1/models 대조)를 하지 않는다.
6단계는 응답이 있고 다를 때만 거부하고, 응답이 없으면(연결 실패·timeout·3xx·401·403·404·5xx) 기동한다.
값(URL·호스트·키·해시)은 위반 요약·로그에 넣지 않는다.

레지스트리 항목(5단계, ADR-034 6번): KEV_MODEL_ID 는 kind decision(옛 kev 호환) 항목, QWEN_MODEL 은 qwen 항목의 run 이다.
항목이 없으면 NOT_IN_REGISTRY, 있어도 status 가 active 가 아니면 상태 이름(RETIRED·BACKUP)으로 거부한다.
QWEN_BASE_URL 은 끝의 /v1 을 뗀 뒤(settings.normalize_qwen_base_url) URL 검사·대조·호출에 쓴다. KEV_BASE_URL 은 그대로다.
"""

import logging
import re
from dataclasses import dataclass

from pydantic import SecretStr

from sol_ai.adapters import http
from sol_ai.adapters.kev_local import LocalKev, check_kev_registry
from sol_ai.adapters.qwen import LocalQwen, system_prompt
from sol_ai.deadline import Deadline
from sol_ai.errors import StartupRefused
from sol_ai.paths import PROMPT_FILE, REGISTRY_FILE
from sol_ai.question_sets import V0_1, V0_2, QuestionSet
from sol_ai.registry import ModelRegistry, RegistryEntry
from sol_ai.schema import ExtractionSchema
from sol_ai.settings import Settings, normalize_qwen_base_url
from sol_ai.strict_json import parse_json

logger = logging.getLogger("sol_ai.local")

# local Kev 어댑터가 답하는 질문 세트. 지원 여부는 파일이 있는지가 아니라 이 집합으로 판정한다
SUPPORTED_QUESTION_SETS = frozenset({V0_1, V0_2})

# 기동 대조 요청마다의 마감(초). 요청 처리의 마감(AI_TIMEOUT_MS·KEV_TIMEOUT_MS)과 무관하다
REGISTRY_TIMEOUT_S = 5.0
MODELS = "/v1/models"
# 모델 서버 키는 출력 가능한 ASCII 만 받는다(C5-A S6). 공백·제어문자·CR/LF·한글은 Authorization 헤더를 깨거나 바꾼다
API_KEY_FORMAT = re.compile(r"[\x21-\x7E]+")


class LocalConfigError(StartupRefused):
    def __init__(self, violations: list[tuple[str, str]]) -> None:
        super().__init__(", ".join(f"{key}({reason})" for key, reason in violations))
        self.violations = violations


def _given(value: str | None) -> str | None:
    return value if value else None


def _status_problem(entry: RegistryEntry | None) -> str | None:
    """레지스트리 항목 위반 사유. 없으면 NOT_IN_REGISTRY, active 가 아니면 상태 이름(RETIRED·BACKUP). 통과면 None."""
    if entry is None:
        return "NOT_IN_REGISTRY"
    if not entry.active:
        return entry.status.upper()
    return None


def _key_problem(value: SecretStr | None) -> str | None:
    """키 위반 사유. 없음·빈 값은 MISSING, 출력 가능한 ASCII 밖 글자가 있으면 INVALID_FORMAT. 값은 돌려주지 않는다."""
    secret = value.get_secret_value() if value is not None else ""
    if secret == "":
        return "MISSING"
    if API_KEY_FORMAT.fullmatch(secret) is None:
        return "INVALID_FORMAT"
    return None


def qwen_registry_match(reply: http.HttpReply, model: str) -> bool | None:
    """vLLM GET /v1/models: 200 이면 data[].id 에 모델이 있는지. 200 이 아니거나 읽을 수 없으면 None."""
    if reply.status != 200:
        return None
    body = parse_json(reply.text)
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        return None
    return any(isinstance(m, dict) and m.get("id") == model for m in body["data"])


def _check_qwen_registry(endpoint: http.Endpoint, model: str) -> bool | None:
    try:
        reply = http.call(endpoint, "GET", MODELS, deadline=Deadline(REGISTRY_TIMEOUT_S))
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
    raw_qwen_url, kev_url = _given(settings.QWEN_BASE_URL), _given(settings.KEV_BASE_URL)
    # 회사 vLLM API 주소의 끝 /v1 을 뗀다(Qwen 전용). 떼고 나서 비면 원래 값을 두어 URL 검사(3단계)가 거부하게 한다
    qwen_url = (normalize_qwen_base_url(raw_qwen_url) or raw_qwen_url) if raw_qwen_url else None

    # 1. 자동 대체는 구현하지 않는다(L3)
    if settings.AI_FALLBACK_TO_MOCK == "true":
        violations.append(("AI_FALLBACK_TO_MOCK", "NOT_IMPLEMENTED"))
    # 2. 필수 설정(check:env 와 같은 집합. QWEN_API_KEY 도 필수다: 03 §3·09, C5-A S3)과 키 형식(S6)
    if qwen_url is None:
        violations.append(("QWEN_BASE_URL", "MISSING"))
    if kev_enabled and kev_url is None:
        violations.append(("KEV_BASE_URL", "MISSING"))
    keys = [("QWEN_API_KEY", settings.QWEN_API_KEY)]
    if kev_enabled:
        keys.append(("KEV_API_KEY", settings.KEV_API_KEY))
    for key, secret in keys:
        problem = _key_problem(secret)
        if problem is not None:
            violations.append((key, problem))
    # 3. URL: https 또는 루프백 http(INSECURE_URL), 계정 정보 없음(URL_HAS_CREDENTIALS),
    #    레지스트리 allowedHosts 또는 루프백(HOST_NOT_ALLOWED)
    for key, url in (
        ("QWEN_BASE_URL", qwen_url),
        ("KEV_BASE_URL", kev_url if kev_enabled else None),
    ):
        if url is not None:
            violations.extend(
                (key, reason) for reason in http.url_problems(url, registry.allowed_hosts)
            )
    # 4·5. 질문 세트·레지스트리 항목(결정 모델은 kind decision·옛 kev, active 만. 03 §11)
    entry = registry.decision(settings.KEV_MODEL_ID)
    if kev_enabled:
        version = settings.KEV_QUESTION_SET
        if version not in SUPPORTED_QUESTION_SETS or version not in question_sets:
            violations.append(("KEV_QUESTION_SET", "QUESTION_SET_NOT_AVAILABLE"))
        if entry is not None and entry.question_set not in (None, settings.KEV_QUESTION_SET):
            violations.append(("KEV_MODEL_ID", "QUESTION_SET_MISMATCH"))
        entry_problem = _status_problem(entry)
        if entry_problem is not None:
            violations.append(("KEV_MODEL_ID", entry_problem))
    requested_qwen = _given(settings.QWEN_MODEL)
    default_qwen = registry.qwen_default()
    qwen_model = requested_qwen or (default_qwen.run if default_qwen is not None else None)
    qwen_problem = _status_problem(
        registry.qwen_entry(qwen_model) if qwen_model is not None else None
    )
    if qwen_problem is not None:
        violations.append(("QWEN_MODEL", qwen_problem))
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
        match = check_kev_registry(kev_endpoint, entry, Deadline(REGISTRY_TIMEOUT_S))
        if match is False:
            violations.append(("KEV_MODEL_ID", "REGISTRY_MISMATCH"))
        kev = LocalKev(
            endpoint=kev_endpoint,
            entry=entry,
            model_id=settings.KEV_MODEL_ID,
            question_set=settings.KEV_QUESTION_SET,
            registry_match=match,
        )
    if violations:
        raise LocalConfigError(violations)

    qwen = LocalQwen(
        endpoint=qwen_endpoint,
        model=qwen_model,
        system=system_prompt(PROMPT_FILE.read_bytes().decode("utf-8"), schema.text),
        schema=schema.schema,
        budget_tokens=settings.QWEN_CONTEXT_BUDGET_TOKENS,
        prompt_hash=prompt_hash,
    )
    return LocalAdapters(qwen, kev)
