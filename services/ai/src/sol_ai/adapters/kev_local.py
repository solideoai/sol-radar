"""Kev local 클라이언트(AI_PROVIDER=local, kev-qs/v0.1, docs/03 §5.4·§5.7·§11, L1·L4).

- POST {KEV_BASE_URL}/v1/systemone. 본문 모양과 필드명은 kev_wire 가 만든다.
- 레지스트리 대조(L1): 기동 때 미확인이었으면 첫 호출 전에 GET /v1/models 로 대조한다.
  미접속이면 이번 호출만 KEV_UNAVAILABLE(다음 호출에서 다시 대조), 불일치면 KEV_UNAVAILABLE + error 로그이고
  이후 호출은 서버를 부르지 않는다(래치).
- 연결 실패·timeout·3xx·4xx·5xx·표준 JSON 아님 → KevUnavailable.
"""

import logging
import threading

from sol_ai.adapters import http, kev_wire
from sol_ai.adapters.base import KevReply, KevUnavailable
from sol_ai.contracts import KevRequest
from sol_ai.registry import RegistryEntry

logger = logging.getLogger("sol_ai.kev")

MODELS = "/v1/models"
SYSTEMONE = "/v1/systemone"
# 미검증 가정(Kev README 예시): 레지스트리 항목에 requestModel 이 없을 때 쓰는 값
DEFAULT_REQUEST_MODEL = "kev-latest"


def kev_registry_match(reply: http.HttpReply, entry: RegistryEntry) -> bool | None:
    """GET /v1/models 응답을 레지스트리 항목과 대조. 200 이 아니거나 읽을 수 없으면 None(미확인).

    응답의 모델 객체(최상위 data 배열 원소, 없으면 최상위 객체) 가운데 run 이 같고, 레지스트리의
    base·lora·temperature 중 null 이 아닌 값이 모두 같은 객체가 있으면 일치. 필드 이름은 03 §11 미검증 가정.
    """
    if reply.status != 200:
        return None
    body = http.parse_json(reply.text)
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
    endpoint: http.Endpoint, entry: RegistryEntry, timeout_s: float
) -> bool | None:
    try:
        reply = http.call(endpoint, "GET", MODELS, timeout_s=timeout_s)
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
        timeout_s: float,
        registry_match: bool | None,
    ) -> None:
        self._endpoint = endpoint
        self._entry = entry
        self._timeout_s = timeout_s
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

    def _ensure_registry(self) -> None:
        with self._lock:
            if self._match is True:
                return
            if self._match is False:
                raise KevUnavailable("kev registry mismatch (latched)")
            result = check_kev_registry(self._endpoint, self._entry, self._timeout_s)
            if result is None:
                raise KevUnavailable("kev registry unconfirmed")
            self._match = result
            if not result:
                logger.error(
                    "kev /v1/models does not match registry entry %s. Kev calls are blocked",
                    self.model_id,
                )
                raise KevUnavailable("kev registry mismatch")

    def answer(self, wire_request: dict, request: KevRequest) -> KevReply:
        self._ensure_registry()
        try:
            reply = http.call(
                self._endpoint, "POST", SYSTEMONE, timeout_s=self._timeout_s, json_body=wire_request
            )
        except http.TransportFailure as error:
            logger.warning("kev call failed: %s", error)
            raise KevUnavailable("kev transport failure") from None
        if not reply.ok:
            logger.warning("kev unavailable: status=%d", reply.status)
            raise KevUnavailable(f"kev status {reply.status}")
        body = http.parse_json(reply.text)
        if not isinstance(body, dict):
            raise KevUnavailable("kev reply is not a JSON object")
        return KevReply(body, reply.headers.get(kev_wire.REQUEST_ID_HEADER))
