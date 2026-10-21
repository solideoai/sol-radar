"""FastAPI 앱(docs/03 §5.3 서버 계약).

- POST /v1/systemone(+ /systemone 별칭): Kev wire 요청 → 질문별 predict(순차, 한 번에 하나) → Kev wire 응답.
- GET /v1/models: {"object":"list","data":[{id, object, run, base, lora, revision, decision_embeddings_sha256,
  temperature: null, questionTypes}]}. 게이트웨이가 레지스트리와 대조한다(03 §11).
- GET /health: {status, model, backend, device, loadedAt}. 인증 없음, 비밀 없음.
- 인증: /v1/* 와 /systemone 은 Authorization: Bearer <DECISION_API_KEY>(상수 시간 비교). 아니면 401.
- 상한·마감: 본문 128 KiB(413), state 24,000자(422. 게이트웨이 kev_state 가 자르는 6,000 토큰 × 4자/토큰),
  질문 1~24(422), 대기열 DECISION_MAX_QUEUE(503), 요청 전체 마감 DECISION_TIMEOUT_MS(504).
  마감이 지나면 진행 중인 forward 를 기다리지 않고 504 를 보낸다(스레드는 끊지 못하므로 끝날 때까지 대기열 한 자리를 쓴다).
- state 는 영어만(03 §5.6). 한글 음절·자모가 있으면 422. 평가 전용 DECISION_ALLOW_KO_STATE=true 일 때만 검사하지 않는다
  (게이트웨이 KEV_ALLOW_KO_STATE 와 짝).
- 오류 본문은 {"errorCode": …}(+ 422 는 errors). 모든 응답에 x-typesafe-request-id(uuid4).
- 로그: 요청 id·질문 수·상태·지연·예외 종류 이름만(logsafe). state·질문·키·예외 메시지는 쓰지 않는다.

오류 표
| 상태 | errorCode | 뜻 |
|---|---|---|
| 401 | UNAUTHORIZED | Bearer 없음·불일치 |
| 413 | PAYLOAD_TOO_LARGE | 본문 128 KiB 초과 |
| 422 | INVALID_REQUEST | wire 형식 위반(알 수 없는 필드, 질문 0·25개, criteria 모양 …) |
| 422 | MODEL_MISMATCH | 요청 model 이 서버 alias 와 다름 |
| 422 | STATE_TOO_LARGE | state 가 24,000자 초과(객체면 JSON 직렬화 길이) |
| 422 | STATE_NOT_ENGLISH | state 에 한글(DECISION_ALLOW_KO_STATE=true 면 검사하지 않음) |
| 500 | INVALID_DISTRIBUTION | 백엔드 확률이 분포가 아님(길이·NaN·음수·합 0) |
| 500 | INFERENCE_FAILED | 백엔드 예외 |
| 503 | QUEUE_FULL | 처리 중·대기 중 요청이 DECISION_MAX_QUEUE 개(Retry-After: 1) |
| 504 | DEADLINE_EXCEEDED | 요청 전체 마감 초과 |
"""

import asyncio
import hmac
import json
import re
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

MAX_BODY_BYTES = 128 * 1024
# 게이트웨이 kev_state.TOKEN_LIMIT(6,000) × CHARS_PER_TOKEN(4). 게이트웨이는 past performance 부터 줄여 이 아래로
# 맞추려 하지만 보장은 아니다(03 §5.6 best-effort). 넘어오면 422 이고 게이트웨이는 KEV_UNAVAILABLE 로 받는다
MAX_STATE_CHARS = 6_000 * 4
# 03 §5.6 한글 범위(음절·자모·호환 자모). 게이트웨이 kev_state.HANGUL 과 같은 식이다
HANGUL = re.compile("[가-힣ᄀ-ᇿ㄰-㆏]")
DEFAULT_ALIAS = "bosun-v3.1-0.6b"
DEFAULT_MAX_QUEUE = 4
# 마감이 지난 뒤 추론 스레드가 질문 사이 검사로 스스로 멈출 여유. 이 안에 안 끝나면 스레드를 두고 504 를 보낸다
DEADLINE_GRACE_S = 0.05
RETRY_AFTER_S = 1

UNAUTHORIZED = "UNAUTHORIZED"
PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
INVALID_REQUEST = "INVALID_REQUEST"
MODEL_MISMATCH = "MODEL_MISMATCH"
STATE_TOO_LARGE = "STATE_TOO_LARGE"
STATE_NOT_ENGLISH = "STATE_NOT_ENGLISH"
INVALID_DISTRIBUTION = "INVALID_DISTRIBUTION"
INFERENCE_FAILED = "INFERENCE_FAILED"
QUEUE_FULL = "QUEUE_FULL"
DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED"


@dataclass(frozen=True)
class ServerConfig:
    api_key: SecretStr
    alias: str = DEFAULT_ALIAS
    timeout_ms: int = 4_500
    seed: int = 0
    # 추론 스레드에 넘겼고 아직 끝나지 않은 요청(처리 중 1 + 대기)의 상한. 차면 503
    max_queue: int = DEFAULT_MAX_QUEUE
    # 평가 전용. true 면 state 의 한글을 거절하지 않는다
    allow_ko_state: bool = False


class ApiError(Exception):
    """HTTP 오류. 본문은 {"errorCode": code}(+ errors). headers 는 응답 헤더에 더한다."""

    def __init__(
        self,
        status: int,
        code: str,
        errors: list[dict[str, Any]] | None = None,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.errors = errors
        self.headers = headers


class DeadlineExceeded(Exception):
    pass


class Deadline:
    """요청 하나의 마감(단조 시계)."""

    def __init__(self, seconds: float, clock: Callable[[], float]) -> None:
        self._clock = clock
        self._end = clock() + seconds

    def expired(self) -> bool:
        return self._clock() >= self._end

    def remaining(self) -> float:
        return max(0.0, self._end - self._clock())


class InFlight:
    """추론 스레드에 넘겼고 아직 끝나지 않은 요청 수. 이벤트 루프 스레드에서만 읽고 쓴다."""

    def __init__(self) -> None:
        self.count = 0


def state_text(state: str | dict[str, Any]) -> str:
    """상한·한글 검사용 텍스트. 객체는 JSON 으로 직렬화한다(한글을 이스케이프하지 않아 그대로 검사된다)."""
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False, separators=(",", ":"))


def state_problem(state: str | dict[str, Any], *, allow_ko: bool) -> str | None:
    """state 상한·언어 위반 코드. 없으면 None."""
    text = state_text(state)
    if len(text) > MAX_STATE_CHARS:
        return STATE_TOO_LARGE
    if not allow_ko and HANGUL.search(text):
        return STATE_NOT_ENGLISH
    return None


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
    in_flight = InFlight()
    # 시험·관측용 노출. 제품 코드는 이 핸들 밖에서 count 를 바꾸지 않는다
    app.state.in_flight = in_flight
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
        return JSONResponse(body, status_code=error.status, headers=error.headers)

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

    def release(done: asyncio.Future) -> None:
        """추론이 끝났다(응답을 이미 보낸 뒤일 수도 있다). 자리를 비우고, 미회수 예외 경고가 asyncio 로그에
        예외 메시지(입력 조각이 실릴 수 있다)와 함께 남지 않게 예외를 꺼내 버린다."""
        in_flight.count -= 1
        if not done.cancelled():
            done.exception()

    async def systemone(request: Request) -> JSONResponse:
        request_id: str = request.state.request_id
        started = clock()
        # 마감은 본문을 읽기 전, 요청이 들어온 시점부터 센다("요청 전체" 마감)
        deadline = Deadline(config.timeout_ms / 1000, clock)
        body = await _read_body(request)
        try:
            parsed = wire.WireRequest.model_validate_json(body)
        except ValidationError as error:
            raise ApiError(422, INVALID_REQUEST, _validation_errors(error)) from None
        if parsed.model is not None and parsed.model != config.alias:
            raise ApiError(422, MODEL_MISMATCH)
        problem = state_problem(parsed.state, allow_ko=config.allow_ko_state)
        if problem is not None:
            raise ApiError(422, problem)
        if in_flight.count >= config.max_queue:
            logsafe.log_failure(request_id, code=QUEUE_FULL)
            raise ApiError(503, QUEUE_FULL, headers={"Retry-After": str(RETRY_AFTER_S)})
        question_count = len(parsed.questions)
        # 추론 스레드의 결과를 Future 로 받는다. 백엔드(모델 라이브러리)가 어떤 예외를 내든 500 으로 바꾸고,
        # 로그에는 종류 이름만 남긴다(메시지에 입력 조각이 실릴 수 있다).
        # count 는 제출이 성공한 뒤 올린다(executor 종료 중 RuntimeError 면 올리지 않아 자리가 새지 않는다)
        future = asyncio.get_running_loop().run_in_executor(inference, answer_all, parsed, deadline)
        in_flight.count += 1
        future.add_done_callback(release)
        done, _ = await asyncio.wait({future}, timeout=deadline.remaining() + DEADLINE_GRACE_S)
        if not done:
            # forward 하나가 마감을 넘겼다. 스레드는 끊을 수 없으니 두고 응답한다(끝나면 release 가 자리를 비운다)
            logsafe.log_failure(request_id, code=DEADLINE_EXCEEDED)
            raise ApiError(504, DEADLINE_EXCEEDED)
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
