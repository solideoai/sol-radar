"""모델 서버 HTTP 호출(httpx). local 어댑터와 기동 레지스트리 대조가 쓴다.

- TLS 인증서 검증은 httpx 기본값(켜짐) 그대로 둔다. 끄는 경로를 두지 않는다(ADR-025).
- 리다이렉트는 따라가지 않는다. 3xx 는 호출자가 미접속으로 다룬다.
- 키는 Authorization 헤더로만 보낸다. URL·키·본문을 로그·예외 메시지에 넣지 않는다.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def is_secure_url(url: str) -> bool:
    """https 이거나, 루프백 호스트의 http(로컬 시험·개발용)만 허용한다."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return False
    if not host:
        return False
    scheme = parts.scheme.lower()
    return scheme == "https" or (scheme == "http" and host in LOOPBACK_HOSTS)


@dataclass(frozen=True)
class Endpoint:
    base_url: str
    api_key: SecretStr | None = None

    def url(self, path: str) -> str:
        return self.base_url.rstrip("/") + path

    def headers(self) -> dict[str, str]:
        key = self.api_key.get_secret_value() if self.api_key is not None else ""
        return {"Authorization": f"Bearer {key}"} if key else {}


@dataclass(frozen=True)
class HttpReply:
    status: int
    text: str
    headers: Mapping[str, str]

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


class TransportFailure(Exception):
    """연결 실패·timeout 등 HTTP 응답을 받지 못했다. 메시지는 예외 종류 이름뿐이다."""


def call(
    endpoint: Endpoint, method: str, path: str, *, timeout_s: float, json_body: Any = None
) -> HttpReply:
    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=False) as client:
            response = client.request(
                method, endpoint.url(path), json=json_body, headers=endpoint.headers()
            )
            return HttpReply(response.status_code, response.text, response.headers)
    except httpx.HTTPError as error:
        raise TransportFailure(type(error).__name__) from None


def _reject_constant(name: str) -> float:
    raise ValueError(f"표준 JSON 밖 수 {name}")


def parse_json(text: str) -> Any | None:
    """표준 JSON 만 읽는다(NaN·Infinity 는 거절). 못 읽으면 None."""
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except ValueError:
        return None
