"""모델 서버 HTTP 호출(httpx). local 어댑터와 기동 레지스트리 대조가 쓴다.

- 호출 하나는 요청 마감(Deadline)의 남은 시간만 쓴다(C5-A S1). 남은 시간이 없으면 네트워크를 부르지 않는다.
  연결·보내기·헤더 읽기·본문 읽기 단계를 시작할 때마다 그 순간의 남은 시간을 timeout 으로 쓰고, 본문은 조각마다
  마감을 다시 본다. 그래서 본문을 조금씩 흘려보내는 서버도 마감 근처에서 끊긴다.
- 응답 본문은 압축을 푼 뒤 MAX_RESPONSE_BYTES 까지만 받는다(S8). Content-Length 가 넘으면 본문을 읽지 않는다.
- TLS 인증서 검증은 httpx 기본값(켜짐) 그대로 둔다. 끄는 경로를 두지 않는다(ADR-025).
- 프록시·netrc·인증서 경로 같은 환경 변수는 읽지 않는다(trust_env=False, S7). 연결 경로는 설정 URL 하나뿐이다.
- 리다이렉트는 따라가지 않는다. 3xx 는 호출자가 미접속으로 다룬다.
- 키는 Authorization 헤더로만 보낸다. URL·키·본문을 로그·예외 메시지에 넣지 않는다. 실패 메시지는 예외 종류 이름이나
  이 모듈의 사유 이름(DeadlineExceeded·ResponseTooLarge 등)뿐이다.
- 기동 검사의 URL 판정(url_problems, S2·S5)도 여기 둔다.
"""

import zlib
from collections.abc import Collection, Iterator, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr

from sol_ai.deadline import Deadline

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# 응답 본문 상한(압축을 푼 바이트, S8)
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
# 압축은 gzip·deflate 만 받는다(풀린 크기를 조각마다 셀 수 있는 것만). 그 밖의 인코딩은 요청하지 않는다
ACCEPT_ENCODING = "gzip, deflate"
_ZLIB_ENCODINGS = frozenset({"gzip", "x-gzip", "deflate"})
# zlib·gzip 머리말을 스스로 알아본다
_ZLIB_AUTO_HEADER = zlib.MAX_WBITS | 32
# 단계를 시작할 때 남은 시간이 0 이하일 때 쓰는 timeout(초). 0 은 소켓을 non-blocking 으로 만들어 쓰지 않는다
_MIN_TIMEOUT_S = 0.001

# 실패 사유(TransportFailure 메시지)
DEADLINE_EXCEEDED = "DeadlineExceeded"
RESPONSE_TOO_LARGE = "ResponseTooLarge"
UNSUPPORTED_CONTENT_ENCODING = "UnsupportedContentEncoding"
DECODING_ERROR = "DecodingError"

# 기동 검사 3단계 URL 위반 사유
INSECURE_URL = "INSECURE_URL"
URL_HAS_CREDENTIALS = "URL_HAS_CREDENTIALS"
HOST_NOT_ALLOWED = "HOST_NOT_ALLOWED"


def url_problems(url: str, allowed_hosts: Collection[str]) -> list[str]:
    """기동 검사 3단계(URL) 위반 사유. 비면 통과다. 사유에는 URL·호스트 값을 넣지 않는다.

    - INSECURE_URL: https 가 아니고 루프백(127.0.0.1·localhost·::1)의 http 도 아니다. 해석할 수 없는 URL 도 여기다.
    - URL_HAS_CREDENTIALS: 계정 정보(u:pw@·u@·빈 @)가 있다(S5).
    - HOST_NOT_ALLOWED: 소문자 호스트가 allowedHosts 와 정확히 같지 않고 루프백도 아니다(S2). 하위 도메인·끝 점은 다르다.

    표준 라이브러리와 httpx(실제로 연결하는 쪽)가 해석한 호스트가 둘 다 허용돼야 한다. 두 해석이 갈리는 URL 로
    허용 목록을 비껴가지 못하게 한다.
    """
    try:
        parts = urlsplit(url)
        host = parts.hostname
        parsed = httpx.URL(url)
    except (ValueError, httpx.InvalidURL):
        return [INSECURE_URL]
    if not host or not parsed.host:
        return [INSECURE_URL]
    hosts = {host, parsed.host}
    loopback = hosts <= LOOPBACK_HOSTS
    scheme = parts.scheme.lower()
    problems = []
    if not (scheme == "https" or (scheme == "http" and loopback)):
        problems.append(INSECURE_URL)
    if "@" in parts.netloc or parsed.userinfo:
        problems.append(URL_HAS_CREDENTIALS)
    if not loopback and not hosts <= set(allowed_hosts):
        problems.append(HOST_NOT_ALLOWED)
    return problems


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
    """연결 실패·timeout·마감 초과·응답 과대 등 쓸 수 있는 HTTP 응답을 받지 못했다.

    메시지는 예외 종류 이름이나 이 모듈의 사유 이름뿐이다(URL·키·본문을 담지 않는다).
    """


class _PhaseTimeouts(Mapping[str, float]):
    """httpcore 의 "timeout" 요청 확장(connect·read·write·pool).

    httpcore 는 단계(연결 대기·연결·보내기·헤더 읽기·본문 읽기)를 시작할 때마다 이 값을 읽는다. 그때마다 마감까지
    남은 시간을 주므로, 앞 단계가 쓴 시간만큼 뒤 단계의 timeout 이 줄어든다.
    """

    _KEYS = ("connect", "read", "write", "pool")

    def __init__(self, deadline: Deadline) -> None:
        self._deadline = deadline

    def __getitem__(self, key: str) -> float:
        if key not in self._KEYS:
            raise KeyError(key)
        return max(self._deadline.remaining(), _MIN_TIMEOUT_S)

    def __iter__(self) -> Iterator[str]:
        return iter(self._KEYS)

    def __len__(self) -> int:
        return len(self._KEYS)


class _BodyReader:
    """응답 본문을 조각마다 받아 압축을 풀고 크기를 센다. 상한을 넘는 순간 ResponseTooLarge."""

    def __init__(self, content_encoding: str | None) -> None:
        codings = [c.strip().lower() for c in (content_encoding or "").split(",")]
        codings = [c for c in codings if c and c != "identity"]
        if len(codings) > 1 or (codings and codings[0] not in _ZLIB_ENCODINGS):
            raise TransportFailure(UNSUPPORTED_CONTENT_ENCODING)
        self._zlib = zlib.decompressobj(_ZLIB_AUTO_HEADER) if codings else None
        self._body = bytearray()

    def _append(self, data: bytes) -> None:
        if len(self._body) + len(data) > MAX_RESPONSE_BYTES:
            raise TransportFailure(RESPONSE_TOO_LARGE)
        self._body.extend(data)

    def feed(self, raw: bytes) -> None:
        if self._zlib is None:
            self._append(raw)
            return
        try:
            data = raw
            while data and not self._zlib.eof:
                # 한 번에 풀 크기를 남은 상한 + 1 로 묶는다(압축 폭탄이 메모리를 먼저 채우지 못하게).
                # max_length 0 은 무제한이라 쓰지 않는다(남은 상한 + 1 은 언제나 1 이상이다)
                self._append(self._zlib.decompress(data, MAX_RESPONSE_BYTES - len(self._body) + 1))
                data = self._zlib.unconsumed_tail
        except zlib.error:
            raise TransportFailure(DECODING_ERROR) from None

    def finish(self) -> bytes:
        if self._zlib is not None:
            try:
                self._append(self._zlib.flush())
            except zlib.error:
                raise TransportFailure(DECODING_ERROR) from None
        return bytes(self._body)


def _declared_length(response: httpx.Response) -> int | None:
    try:
        return int(response.headers["content-length"])
    except (KeyError, ValueError):
        return None


def _read_body(response: httpx.Response, deadline: Deadline) -> bytes:
    declared = _declared_length(response)
    if declared is not None and declared > MAX_RESPONSE_BYTES:
        raise TransportFailure(RESPONSE_TOO_LARGE)
    reader = _BodyReader(response.headers.get("content-encoding"))
    if deadline.expired():
        raise TransportFailure(DEADLINE_EXCEEDED)
    for raw in response.iter_raw():
        # 조각마다 마감을 다시 본다(조금씩 흘려보내는 서버)
        if deadline.expired():
            raise TransportFailure(DEADLINE_EXCEEDED)
        reader.feed(raw)
    return reader.finish()


def call(
    endpoint: Endpoint,
    method: str,
    path: str,
    *,
    deadline: Deadline,
    json_body: Any = None,
) -> HttpReply:
    remaining = deadline.remaining()
    if remaining <= 0:
        raise TransportFailure(DEADLINE_EXCEEDED)
    try:
        # Client 의 timeout 은 확장이 없을 때의 대비값이다. 실제 단계별 timeout 은 _PhaseTimeouts 가 준다
        with (
            httpx.Client(timeout=remaining, follow_redirects=False, trust_env=False) as client,
            client.stream(
                method,
                endpoint.url(path),
                json=json_body,
                headers={**endpoint.headers(), "Accept-Encoding": ACCEPT_ENCODING},
                extensions={"timeout": _PhaseTimeouts(deadline)},
            ) as response,
        ):
            body = _read_body(response, deadline)
            text = body.decode(response.encoding or "utf-8", errors="replace")
            return HttpReply(response.status_code, text, response.headers)
    except (
        httpx.HTTPError,
        httpx.InvalidURL,
        httpx.StreamError,
        ValueError,
        TypeError,
        OSError,
    ) as error:
        # 헤더 구성(UnicodeEncodeError·잘못된 헤더 값)·본문 직렬화 오류도 전송 실패다. 메시지는 종류 이름만
        raise TransportFailure(type(error).__name__) from None
