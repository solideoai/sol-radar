"""FastAPI 앱. /health·/parse·/extract·/kev·/explain(docs/03 §2.1).

HTTP 200 은 "gateway 가 응답했다"는 뜻이다. 개별 실패는 본문 status·errorCode·kev.enabled·fallback 으로 낸다.
200 이 아닌 본문은 {"errorCode","message"} 이고 422 KO_STATE_NOT_ALLOWED·503 AI_UNAVAILABLE 둘뿐이다(K9).
요청 본문 형식 오류·크기 상한 초과는 FastAPI 기본 422 를 그대로 둔다. 실행 모드 위반과 local 기동 검사 위반은
기동 거부(exit 78)다.

/extract·/kev 는 요청마다 마감 하나(요청 시작 + AI_TIMEOUT_MS·KEV_TIMEOUT_MS)를 만들어 모델 호출 전체가 나눠 쓴다
(C5-A S1). worker 는 /extract 를 AI_TIMEOUT_MS+5s, /kev 를 KEV_TIMEOUT_MS+2s 에 끊는다.
"""

import logging
import time
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from sol_ai.adapters.base import Adapters, TranslationAdapter
from sol_ai.adapters.factory import build_adapters
from sol_ai.adapters.kev import KevAdapter, KoStateNotAllowed
from sol_ai.contracts import (
    ErrorBody,
    ExplainRequest,
    ExplainResponse,
    ExtractRequest,
    ExtractResponse,
    KevRequest,
    KevResponse,
    KevTimings,
    ParseResult,
)
from sol_ai.deadline import Deadline
from sol_ai.errors import StartupRefused
from sol_ai.explain import explain
from sol_ai.extraction import ExtractionConfig, run_extraction
from sol_ai.guards import InjectionGuard
from sol_ai.kev_state_v02 import load_state_templates
from sol_ai.logsafe import log_id
from sol_ai.parse import parse_document, parser_inventory, read_limited
from sol_ai.paths import (
    INJECTION_PATTERNS_FILE,
    PROMPT_FILE,
    QUESTION_SETS_DIR,
    STATE_TEMPLATES_DIR,
    THRESHOLDS_FILE,
)
from sol_ai.qualifications import default_dictionary
from sol_ai.question_sets import load_question_sets
from sol_ai.run_mode import load_rules, resolve_run_mode
from sol_ai.schema import default_schema, prompt_hash
from sol_ai.settings import Settings
from sol_ai.thresholds import Thresholds

logger = logging.getLogger("sol_ai")

PARSER_SETTINGS = {"PDF": "PARSER_PDF", "HWPX": "PARSER_HWPX", "HWP": "PARSER_HWP"}


class RunModeError(StartupRefused):
    """실행 모드 위반. 메시지에는 키 이름과 reason 만 담는다."""


def format_violations(violations) -> str:
    return ", ".join(f"{v.key}({v.reason})" for v in violations)


@dataclass(frozen=True)
class Runtime:
    run_mode: str | None
    adapters: Adapters
    extraction: ExtractionConfig
    kev: KevAdapter


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content=ErrorBody(errorCode=code, message=message).model_dump()
    )


def _gateway_down() -> JSONResponse:
    return _error(503, "AI_UNAVAILABLE", "AI gateway is unavailable (fault injected: gateway_down)")


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def build_runtime(settings: Settings, run_mode: str | None, effective: dict[str, str]) -> Runtime:
    schema = default_schema()
    dictionary = default_dictionary()
    question_sets = load_question_sets(QUESTION_SETS_DIR)
    computed_hash = prompt_hash(PROMPT_FILE, schema.text, settings.AI_PROMPT_VERSION)
    adapters = build_adapters(
        settings,
        provider=effective["AI_PROVIDER"],
        kev_enabled=effective["KEV_ENABLED"] == "true",
        dictionary=dictionary,
        question_sets=question_sets,
        schema=schema,
        prompt_hash=computed_hash,
    )
    for fmt, key in PARSER_SETTINGS.items():
        if getattr(settings, key):
            # 어댑터 id 를 받아도 등록된 파서 어댑터가 없다. 미설정과 같게 처리한다(03 §10.3 비교 전)
            logger.warning(
                "%s 어댑터가 아직 없어 %s 은 PARSER_NOT_CONFIGURED 로 응답한다", key, fmt
            )
    extraction = ExtractionConfig(
        schema=schema,
        guard=InjectionGuard.load(INJECTION_PATTERNS_FILE),
        dictionary=dictionary,
        prompt_version=settings.AI_PROMPT_VERSION,
        prompt_hash=computed_hash,
        fuzzy_min_ratio=settings.CITATION_FUZZY_MIN_RATIO,
    )
    kev = KevAdapter(
        adapters.kev,
        question_sets,
        dictionary,
        allow_ko_state=settings.KEV_ALLOW_KO_STATE == "true",
        korean_question_sets=load_question_sets(QUESTION_SETS_DIR, language="ko"),
        state_templates=load_state_templates(STATE_TEMPLATES_DIR),
        thresholds=Thresholds.load(THRESHOLDS_FILE),
        translator=adapters.qwen if isinstance(adapters.qwen, TranslationAdapter) else None,
    )
    return Runtime(run_mode, adapters, extraction, kev)


def create_app(settings: Settings) -> FastAPI:
    rules = load_rules()
    result = resolve_run_mode(settings.as_env(rules), rules)
    if result.violations:
        raise RunModeError(format_violations(result.violations))
    runtime = build_runtime(settings, result.mode, result.effective or {})
    adapters = runtime.adapters
    app = FastAPI(title="SOL RADAR AI gateway")

    @app.get("/health")
    def health() -> dict:
        qwen = adapters.qwen
        kev = adapters.kev
        return {
            "status": "ok",
            "runMode": runtime.run_mode,
            "provider": adapters.provider,
            "kevEnabled": kev is not None,
            "qwen": (
                {"model": qwen.model_name, "promptHash": qwen.prompt_hash}
                if qwen.model_name is not None
                else None
            ),
            "kev": (
                {"modelId": kev.model_id, "registryMatch": kev.registry_match}
                if kev is not None and kev.model_id is not None
                else None
            ),
            "questionSets": list(kev.question_sets) if kev is not None else [],
            "parsers": parser_inventory(),
        }

    @app.post("/parse", response_model=ParseResult)
    async def parse(request: Request) -> ParseResult:
        started = time.perf_counter()
        data, too_large = await read_limited(request.stream())
        parsed = parse_document(data, too_large)
        logger.info(
            "parse requestId=%s format=%s status=%s errorCode=%s ms=%d",
            log_id(request.headers.get("x-request-id")),
            parsed.format,
            parsed.status,
            parsed.errorCode,
            _elapsed_ms(started),
        )
        return parsed

    @app.post("/extract", response_model=ExtractResponse)
    def extract(body: ExtractRequest):
        deadline = Deadline(settings.AI_TIMEOUT_MS / 1000)
        if adapters.gateway_down:
            return _gateway_down()
        response = run_extraction(body, adapters.qwen, runtime.extraction, deadline=deadline)
        logger.info(
            "extract requestId=%s provider=%s status=%s errorCode=%s ms=%d",
            log_id(body.requestId),
            adapters.provider,
            response.status,
            response.errorCode,
            response.timings.extractMs,
        )
        return response

    @app.post("/kev", response_model=KevResponse)
    def kev(body: KevRequest):
        deadline = Deadline(settings.KEV_TIMEOUT_MS / 1000)
        if adapters.gateway_down:
            return _gateway_down()
        started = time.perf_counter()
        try:
            outcome = runtime.kev.assess(body, deadline=deadline)
        except KoStateNotAllowed:
            return _error(
                422,
                "KO_STATE_NOT_ALLOWED",
                'stateLanguage "ko" requires KEV_ALLOW_KO_STATE=true (evaluation only)',
            )
        response = KevResponse(
            kev=outcome.kev,
            stateHash=outcome.state_hash,
            requirements=outcome.requirements,
            wire=outcome.wire,
            errorCode=outcome.error_code,
            warnings=outcome.warnings,
            timings=KevTimings(kevMs=_elapsed_ms(started)),
        )
        logger.info(
            "kev requestId=%s provider=%s enabled=%s errorCode=%s ms=%d",
            log_id(body.requestId),
            adapters.provider,
            outcome.kev.enabled,
            outcome.error_code,
            response.timings.kevMs,
        )
        return response

    @app.post("/explain", response_model=ExplainResponse)
    async def explain_endpoint(body: ExplainRequest, request: Request):
        if adapters.gateway_down:
            return _gateway_down()
        response = explain(body, await request.json())
        logger.info("explain requestId=%s fallback=%s", log_id(body.requestId), response.fallback)
        return response

    return app
