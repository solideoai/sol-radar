"""FastAPI 앱(docs/03 §5.3 서버 계약).

- POST /v1/systemone(+ /systemone 별칭): Kev wire 요청 → 질문별 predict(순차, 한 번에 하나) → Kev wire 응답.
- GET /v1/models: {"object":"list","data":[{id, object, run, base, lora, revision, decision_embeddings_sha256,
  temperature: null, questionTypes}]}. 게이트웨이가 레지스트리와 대조한다(03 §11).
- GET /health: {status, model, backend, device, loadedAt}. 인증 없음, 비밀 없음.
- 인증: /v1/* 와 /systemone 은 Authorization: Bearer <DECISION_API_KEY>(상수 시간 비교). 아니면 401.
- 상한·마감: 본문 1 MiB(413), 질문 1~24(422), 요청 전체 마감 DECISION_TIMEOUT_MS(504).
- 오류 본문은 {"errorCode": …}(+ 422 는 errors). 모든 응답에 x-typesafe-request-id(uuid4).
- 로그: 요청 id·질문 수·상태·지연·예외 종류 이름만(logsafe). state·질문·키·예외 메시지는 쓰지 않는다.

오류 표
| 상태 | errorCode | 뜻 |
|---|---|---|
| 401 | UNAUTHORIZED | Bearer 없음·불일치 |
| 413 | PAYLOAD_TOO_LARGE | 본문 1 MiB 초과 |
| 422 | INVALID_REQUEST | wire 형식 위반(알 수 없는 필드, 질문 0·25개, criteria 모양 …) |
| 422 | MODEL_MISMATCH | 요청 model 이 서버 alias 와 다름 |
| 500 | INVALID_DISTRIBUTION | 백엔드 확률이 분포가 아님(길이·NaN·음수·합 0) |
| 500 | INFERENCE_FAILED | 백엔드 예외 |
| 504 | DEADLINE_EXCEEDED | 요청 전체 마감 초과 |
"""

import asyncio
import hmac
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import SecretStr, ValidationError

from sol_decision import contract, logsafe, wire
from sol_decision.backend import DecisionBackend, row_id_for

MAX_BODY_BYTES = 1 * 1024 * 1024
DEFAULT_ALIAS = "bosun-v3.1-0.6b"

UNAUTHORIZED = "UNAUTHORIZED"
PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
INVALID_REQUEST = "INVALID_REQUEST"
MODEL_MISMATCH = "MODEL_MISMATCH"
INVALID_DISTRIBUTION = "INVALID_DISTRIBUTION"
INFERENCE_FAILED = "INFERENCE_FAILED"
DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED"


@dataclass(frozen=True)
class ServerConfig:
    api_key: SecretStr
    alias: str = DEFAULT_ALIAS
    timeout_ms: int = 4_500
    seed: int = 0


class ApiError(Exception):
    """HTTP 오류. 본문은 {"errorCode": code}(+ errors)."""

    def __init__(self, status: int, code: str, errors: list[dict[str, Any]] | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.errors = errors


class DeadlineExceeded(Exception):
    pass


class Deadline:
    """요청 하나의 마감(단조 시계)."""

    def __init__(self, seconds: float, clock: Callable[[], float]) -> None:
        self._clock = clock
        self._end = clock() + seconds

    def expired(self) -> bool:
        return self._clock() >= self._end


def _bearer_token(header: str | None) -> str | None:
    if header is None:
        return None
    scheme, _, token = header.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _validation_errors(error: ValidationError) -> list[dict[str, Any]]:
    """입력 값(input)·ctx·url 은 빼고 위치·메시지·종류만."""
    return [
        {"loc": [str(part) for part in e["loc"]], "msg": e["msg"], "type": e["type"]}
        for e in error.errors(include_url=False, include_input=False, include_context=False)
    ]


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                raise ApiError(413, PAYLOAD_TOO_LARGE)
        except ValueError as error:
            raise ApiError(422, INVALID_REQUEST) from error
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            raise ApiError(413, PAYLOAD_TOO_LARGE)
        chunks.append(chunk)
    return b"".join(chunks)


def create_app(
    backend: DecisionBackend,
    config: ServerConfig,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> FastAPI:
    app = FastAPI(title="sol-decision", docs_url=None, redoc_url=None, openapi_url=None)
    loaded_at = datetime.now(UTC).isoformat(timespec="seconds")
    # 추론 스레드 하나. 한 번에 요청(질문 묶음) 하나만 모델을 쓴다(GPU 메모리·결정성). 나머지는 줄을 선다
    inference = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inference")
    key_bytes = config.api_key.get_secret_value().encode("utf-8")

    @app.middleware("http")
    async def _request_id(request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[wire.REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, error: ApiError) -> JSONResponse:
        body: dict[str, Any] = {"errorCode": error.code}
        if error.errors is not None:
            body["errors"] = error.errors
        return JSONResponse(body, status_code=error.status)

    def require_bearer(request: Request) -> None:
        token = _bearer_token(request.headers.get("authorization"))
        if token is None or not hmac.compare_digest(token.encode("utf-8"), key_bytes):
            raise ApiError(401, UNAUTHORIZED)

    def answer_all(parsed: wire.WireRequest, deadline: Deadline) -> dict[str, dict[str, Any]]:
        """추론 스레드에서 돈다. 질문마다 마감을 보고(줄 서는 동안 지났으면 바로 끝낸다) 순차 predict."""
        answers: dict[str, dict[str, Any]] = {}
        for qid, question in parsed.questions.items():
            if deadline.expired():
                raise DeadlineExceeded
            candidates = contract.candidates_for(question)
            probabilities = backend.predict(
                state=parsed.state,
                instructions=question.instructions,
                candidates=[candidate.as_bosun() for candidate in candidates],
                decision_type=question.type,
                seed=config.seed,
                row_id=row_id_for(qid, parsed.state),
            )
            answers[qid] = contract.answer_for(question, probabilities)
        if deadline.expired():
            raise DeadlineExceeded
        return answers

    def failure_code(error: BaseException) -> str:
        if isinstance(error, DeadlineExceeded):
            return DEADLINE_EXCEEDED
        if isinstance(error, contract.InvalidDistribution):
            return INVALID_DISTRIBUTION
        return INFERENCE_FAILED

    async def systemone(request: Request) -> JSONResponse:
        request_id: str = request.state.request_id
        started = clock()
        body = await _read_body(request)
        try:
            parsed = wire.WireRequest.model_validate_json(body)
        except ValidationError as error:
            raise ApiError(422, INVALID_REQUEST, _validation_errors(error)) from None
        if parsed.model is not None and parsed.model != config.alias:
            raise ApiError(422, MODEL_MISMATCH)
        deadline = Deadline(config.timeout_ms / 1000, clock)
        question_count = len(parsed.questions)
        # 추론 스레드의 결과를 Future 로 받는다. 백엔드(모델 라이브러리)가 어떤 예외를 내든 500 으로 바꾸고,
        # 로그에는 종류 이름만 남긴다(메시지에 입력 조각이 실릴 수 있다)
        future = asyncio.get_running_loop().run_in_executor(inference, answer_all, parsed, deadline)
        await asyncio.wait({future})
        error = future.exception()
        if error is not None:
            code = failure_code(error)
            logsafe.log_failure(request_id, code=code, error=error)
            raise ApiError(504 if code == DEADLINE_EXCEEDED else 500, code)
        answers = future.result()
        latency_ms = int((clock() - started) * 1000)
        logsafe.log_request(request_id, questions=question_count, status=200, latency_ms=latency_ms)
        return JSONResponse(wire.build_response(answers, latency_ms=latency_ms))

    app.add_api_route(
        "/v1/systemone", systemone, methods=["POST"], dependencies=[Depends(require_bearer)]
    )
    app.add_api_route(
        "/systemone", systemone, methods=["POST"], dependencies=[Depends(require_bearer)]
    )

    @app.get("/v1/models", dependencies=[Depends(require_bearer)])
    async def models() -> dict[str, Any]:
        identity = backend.identity()
        return {
            "object": "list",
            "data": [
                {
                    "id": config.alias,
                    "object": "model",
                    "run": identity.run,
                    "base": identity.base,
                    "lora": identity.lora,
                    "revision": identity.revision,
                    "decision_embeddings_sha256": identity.decision_embeddings_sha256,
                    "temperature": None,
                    "questionTypes": list(identity.question_types),
                }
            ],
        }

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": config.alias,
            "backend": backend.name,
            "device": backend.device,
            "loadedAt": loaded_at,
        }

    return app
