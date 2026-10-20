"""Kev local 클라이언트(AI_PROVIDER=local, kev-qs/v0.1, docs/03 §5.4·§5.7·§11, L1·L4).

- POST {KEV_BASE_URL}/v1/systemone. 본문 모양과 필드명은 kev_wire 가 만든다.
- 시간: 요청 하나의 마감(요청 시작 + KEV_TIMEOUT_MS, /kev 핸들러가 만든다)을 레지스트리 지연 대조와 모든 호출
  (v0.2 묶음)이 나눠 쓴다(C5-A S1). 호출마다 KEV_TIMEOUT_MS 를 새로 쓰지 않는다.
- 레지스트리 대조(L1): 기동 때 미확인이었으면 첫 호출 전에 GET /v1/models 로 대조한다.
  미접속이면 이번 호출만 KEV_UNAVAILABLE(다음 호출에서 다시 대조), 불일치면 KEV_UNAVAILABLE + error 로그이고
  이후 호출은 서버를 부르지 않는다(래치). 잠금은 상태 읽기·갱신에만 쓰고 대조 요청은 잠금 밖에서 한다(S12).
  동시에 대조한 결과가 갈리면 불일치(False)가 남는다. 일치(True)는 불일치를 덮지 못한다.
- 응답 본문 상한은 KEV_MAX_RESPONSE_BYTES(압축을 푼 1 MiB, C5-A R6)다. POST /v1/systemone(묶음마다)과
  GET /v1/models(기동 대조·요청 때 지연 대조) 모두 같다. Qwen 은 http.MAX_RESPONSE_BYTES(4 MiB) 그대로다.
- 연결 실패·timeout·마감 초과·응답 과대·3xx·4xx·5xx·표준 JSON 아님 → KevUnavailable.
"""

import logging
import threading

from sol_ai.adapters import http, kev_wire
from sol_ai.adapters.base import KevReply, KevUnavailable
from sol_ai.contracts import KevRequest
from sol_ai.deadline import Deadline
from sol_ai.registry import RegistryEntry
from sol_ai.strict_json import parse_json

logger = logging.getLogger("sol_ai.kev")

MODELS = "/v1/models"
SYSTEMONE = "/v1/systemone"
# 미검증 가정(Kev README 예시): 레지스트리 항목에 requestModel 이 없을 때 쓰는 값
DEFAULT_REQUEST_MODEL = "kev-latest"
# Kev 응답 본문 상한(압축을 푼 바이트, R6). 24문항 묶음 하나의 응답은 수십 KB 다. 넘으면 ResponseTooLarge.
# 파싱(strict_json)은 마지막 HTTP 호출 뒤라 마감 밖이므로, 읽는 크기를 줄여 파싱 시간도 묶는다
KEV_MAX_RESPONSE_BYTES = 1 * 1024 * 1024


def kev_registry_match(reply: http.HttpReply, entry: RegistryEntry) -> bool | None:
    """GET /v1/models 응답을 레지스트리 항목과 대조. 200 이 아니거나 읽을 수 없으면 None(미확인).

    응답의 모델 객체(최상위 data 배열 원소, 없으면 최상위 객체) 가운데 run 이 같고, 레지스트리의
    base·lora·temperature 중 null 이 아닌 값이 모두 같은 객체가 있으면 일치. 필드 이름은 03 §11 미검증 가정.
    """
    if reply.status != 200:
        return None
    body = parse_json(reply.text)
    if isinstance(body, dict) and isinstance(body.get("data"), list):
        models = body["data"]
    elif isinstance(body, dict):
        models = [body]
    else:
        return None
    return any(
        isinstance(model, dict)
        and model.get("run") == entry.run
        and all(model.get(field) == value for field, value in entry.match_values.items())
        for model in models
    )


def check_kev_registry(
    endpoint: http.Endpoint, entry: RegistryEntry, deadline: Deadline
) -> bool | None:
    try:
        reply = http.call(
            endpoint, "GET", MODELS, deadline=deadline, max_bytes=KEV_MAX_RESPONSE_BYTES
        )
    except http.TransportFailure as error:
        logger.warning("kev /v1/models unreachable: %s", error)
        return None
    result = kev_registry_match(reply, entry)
    if result is None:
        logger.warning("kev /v1/models unconfirmed: status=%d", reply.status)
    return result


class LocalKev:
    provider = "local"

    def __init__(
        self,
        *,
        endpoint: http.Endpoint,
        entry: RegistryEntry,
        model_id: str,
        question_set: str,
        registry_match: bool | None,
    ) -> None:
        self._endpoint = endpoint
        self._entry = entry
        self._match = registry_match
        self._lock = threading.Lock()
        self.model_id: str | None = model_id
        self.assist_model: str | None = entry.run
        self.request_model = entry.request_model or DEFAULT_REQUEST_MODEL
        self.question_sets = (question_set,)

    @property
    def registry_match(self) -> bool | None:
        return self._match

    def precheck(self) -> None:
        """local 은 호출 전 판정이 없다(레지스트리 대조는 answer 에서 한다. 인젝션 의심이면 그 전에 생략된다)."""

    def _ensure_registry(self, deadline: Deadline) -> None:
        with self._lock:
            known = self._match
        if known is True:
            return
        if known is False:
            raise KevUnavailable("kev registry mismatch (latched)")
        # 대조 요청은 잠금 밖에서 한다. 동시 요청이 서로의 대조를 기다리지 않는다(S12)
        result = check_kev_registry(self._endpoint, self._entry, deadline)
        if result is None:
            raise KevUnavailable("kev registry unconfirmed")
        with self._lock:
            latched = self._match is False
            if not latched:
                self._match = result
        if latched:
            # 다른 요청이 먼저 불일치를 정했다. 이 대조가 일치여도 덮지 않는다(래치)
            raise KevUnavailable("kev registry mismatch (latched)")
        if not result:
            logger.error(
                "kev /v1/models does not match registry entry %s. Kev calls are blocked",
                self.model_id,
            )
            raise KevUnavailable("kev registry mismatch")

    def answer(self, wire_request: dict, request: KevRequest, *, deadline: Deadline) -> KevReply:
        self._ensure_registry(deadline)
        try:
            reply = http.call(
                self._endpoint,
                "POST",
                SYSTEMONE,
                deadline=deadline,
                json_body=wire_request,
                max_bytes=KEV_MAX_RESPONSE_BYTES,
            )
        except http.TransportFailure as error:
            logger.warning("kev call failed: %s", error)
            raise KevUnavailable("kev transport failure") from None
        if not reply.ok:
            logger.warning("kev unavailable: status=%d", reply.status)
            raise KevUnavailable(f"kev status {reply.status}")
        body = parse_json(reply.text)
        if not isinstance(body, dict):
            raise KevUnavailable("kev reply is not a JSON object")
        return KevReply(body, reply.headers.get(kev_wire.REQUEST_ID_HEADER))
