"""모델 서버 HTTP 호출(httpx + httpcore). local 어댑터와 기동 레지스트리 대조가 쓴다.

- 호출 하나는 요청 마감(Deadline)의 남은 시간만 쓴다(C5-A S1·R1). 남은 시간이 없으면 네트워크를 부르지 않는다.
  - 소켓 조작(TCP 연결·TLS 핸드셰이크·읽기·쓰기)마다 timeout 을 min(httpcore 가 준 값, 그 순간의 남은 시간)으로 바꾼다
    (DeadlineNetworkBackend·DeadlineNetworkStream). 남은 시간이 0 이하면 소켓을 부르지 않고 httpcore 의 timeout 예외를 낸다.
  - httpcore 는 단계 timeout 하나를 여러 소켓 조작에 다시 쓴다(연결 timeout 을 TCP 연결과 TLS 핸드셰이크에 따로,
    헤더 읽기 timeout 을 recv 마다). 그래서 단계 시작 때의 남은 시간만 주면 헤더·TLS 를 흘리는 서버가 마감을 넘긴다.
    소켓 조작마다 다시 재야 한다.
  - CPython 의 connect·recv·send 와 ssl 핸드셰이크·read·write 는 호출 한 번 안에서 받은 timeout 을 전체 마감으로 쓴다.
    그래서 소켓 조작 하나는 요청 마감을 넘지 못하고, 요청 총소요는 예산 + ε(조작 사이의 계산 시간)다.
  - 예외는 이름 조회(getaddrinfo)다. 표준 라이브러리에 timeout 이 없어 마감 밖에 남는다. 허용 호스트가 회사
    엔드포인트(registry allowedHosts)와 루프백뿐이라 받아들인다(S2).
  - 쓰기는 WRITE_CHUNK_BYTES 조각마다 남은 시간을 다시 준다. 조각 하나 안에서 send 가 여러 번 나뉘면(요청 본문을
    느리게 읽는 서버) 그 send 들은 조각 시작 때의 timeout 을 같이 쓴다.
  - 본문은 조각마다 마감을 다시 본다(앞 조각을 받은 뒤 마감이 지났으면 더 읽지 않는다).
- 응답 본문은 압축을 푼 뒤 MAX_RESPONSE_BYTES 까지만 받는다(S8). Content-Length 가 넘으면 본문을 읽지 않는다.
  본문은 언제나 UTF-8 로 읽는다(RFC 8259 §8.1, R4). charset 매개변수는 보지 않는다.
- TLS 인증서 검증과 호스트 이름 검사는 켜져 있다(ssl_context). 끄는 경로를 두지 않는다(ADR-025).
- 프록시·netrc·인증서 경로 같은 환경 변수는 읽지 않는다(trust_env=False·ssl_context, S7). 연결 경로는 설정 URL 하나뿐이다.
- 리다이렉트는 따라가지 않는다. 3xx 는 호출자가 미접속으로 다룬다.
- 키는 Authorization 헤더로만 보낸다. URL·키·본문을 로그·예외 메시지에 넣지 않는다. 실패 메시지는 예외 종류 이름이나
  이 모듈의 사유 이름(DeadlineExceeded·ResponseTooLarge 등)뿐이다.
- 기동 검사의 URL 판정(url_problems, S2·S5·R5)도 여기 둔다.
"""

import socket
import ssl
import zlib
from collections.abc import Collection, Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpcore
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
# 쓰기 한 조각(바이트). 조각마다 남은 시간을 다시 준다. TLS 레코드 최대 크기(16 KiB)와 같다
WRITE_CHUNK_BYTES = 16 * 1024

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
    # 해석과 호스트 접근을 모두 여기서 한다. 잘못된 퓨니코드는 호스트를 읽을 때 IDNAError(UnicodeError)가 난다(R5).
    # 예외 메시지에는 레이블 조각이 실릴 수 있어 사유 이름만 돌려준다
    try:
        parts = urlsplit(url)
        host = parts.hostname
        parsed = httpx.URL(url)
        parsed_host = parsed.host
        has_userinfo = bool(parsed.userinfo)
    except (ValueError, UnicodeError, httpx.InvalidURL):
        return [INSECURE_URL]
    if not host or not parsed_host:
        return [INSECURE_URL]
    hosts = {host, parsed_host}
    loopback = hosts <= LOOPBACK_HOSTS
    scheme = parts.scheme.lower()
    problems = []
    if not (scheme == "https" or (scheme == "http" and loopback)):
        problems.append(INSECURE_URL)
    if "@" in parts.netloc or has_userinfo:
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


def ssl_context() -> ssl.SSLContext:
    """모델 서버 TLS 설정. certifi CA·인증서 검증·호스트 이름 검사가 켜져 있다.

    SSL_CERT_FILE·SSL_CERT_DIR 같은 환경 변수를 읽지 않는다(httpx.create_ssl_context(trust_env=False) 와 같다).
    ssl 표준 라이브러리가 SSLKEYLOGFILE 로 켜는 세션 키 기록도 끈다. call 이 호출마다 이 함수를 부른다
    (시험은 검증을 켠 채 시험 CA 를 더 믿는 context 로 바꿔 끼울 수 있다).
    """
    context = httpx.create_ssl_context(trust_env=False)
    context.keylog_filename = None
    return context


def _bounded_timeout(
    deadline: Deadline, timeout: float | None, expired: type[httpcore.TimeoutException]
) -> float:
    """소켓 조작 하나의 timeout: min(받은 값, 남은 시간). 남은 시간이 0 이하면 소켓을 부르기 전에 expired 를 낸다."""
    remaining = deadline.remaining()
    if remaining <= 0:
        raise expired(DEADLINE_EXCEEDED)
    return remaining if timeout is None else min(timeout, remaining)


class DeadlineNetworkStream(httpcore.NetworkStream):
    """httpcore NetworkStream 래퍼(R1). read·write·start_tls 마다 timeout 을 요청 마감의 남은 시간으로 줄인다.

    start_tls 가 돌려준 TLS 스트림도 같은 래퍼로 감싼다.
    """

    def __init__(self, inner: httpcore.NetworkStream, deadline: Deadline) -> None:
        self._inner = inner
        self._deadline = deadline

    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self._inner.read(
            max_bytes, _bounded_timeout(self._deadline, timeout, httpcore.ReadTimeout)
        )

    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        # httpcore 는 요청 헤더와 본문(httpx 의 JSON 본문은 통째로 하나)을 write 한 번에 넘긴다. 조각으로 나눠
        # 조각마다 남은 시간을 다시 준다
        for start in range(0, len(buffer), WRITE_CHUNK_BYTES):
            self._inner.write(
                buffer[start : start + WRITE_CHUNK_BYTES],
                _bounded_timeout(self._deadline, timeout, httpcore.WriteTimeout),
            )

    def close(self) -> None:
        self._inner.close()

    def start_tls(
        self,
        ssl_context: ssl.SSLContext,
        server_hostname: str | None = None,
        timeout: float | None = None,
    ) -> httpcore.NetworkStream:
        try:
            bounded = _bounded_timeout(self._deadline, timeout, httpcore.ConnectTimeout)
        except httpcore.ConnectTimeout:
            # 핸드셰이크를 시작하지 않는다(ClientHello 를 보내지 않는다). 열린 TCP 연결은 닫는다
            self._inner.close()
            raise
        tls = self._inner.start_tls(ssl_context, server_hostname, bounded)
        return DeadlineNetworkStream(tls, self._deadline)

    def get_extra_info(self, info: str) -> Any:
        return self._inner.get_extra_info(info)


class DeadlineNetworkBackend(httpcore.NetworkBackend):
    """httpcore NetworkBackend 래퍼(R1). 기본은 httpcore.SyncBackend 를 감싼다.

    TCP 연결은 이름을 먼저 풀고 주소마다 따로 연결한다. 주소마다 남은 시간을 다시 재야, 주소가 여럿일 때
    (socket.create_connection 처럼) 주소마다 같은 timeout 을 써서 마감을 넘기지 않는다. 이름 조회 자체는 마감 밖이다
    (모듈 머리말).
    """

    def __init__(self, deadline: Deadline, inner: httpcore.NetworkBackend | None = None) -> None:
        self._deadline = deadline
        self._inner = inner if inner is not None else httpcore.SyncBackend()

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.NetworkStream:
        _bounded_timeout(self._deadline, timeout, httpcore.ConnectTimeout)
        try:
            infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as error:
            raise httpcore.ConnectError(type(error).__name__) from None
        failure: Exception = httpcore.ConnectError("NoAddress")
        for info in infos:
            address = str(info[4][0])
            bounded = _bounded_timeout(self._deadline, timeout, httpcore.ConnectTimeout)
            try:
                stream = self._inner.connect_tcp(
                    address, port, bounded, local_address, socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as error:
                failure = error
                continue
            return DeadlineNetworkStream(stream, self._deadline)
        raise failure


class _CoreResponseStream(httpx.SyncByteStream):
    """httpcore 응답 본문을 httpx 응답 본문으로 넘긴다. 예외는 httpcore 것 그대로 둔다(call 이 종류 이름으로 바꾼다)."""

    def __init__(self, stream: Iterable[bytes]) -> None:
        self._stream = stream

    def __iter__(self) -> Iterator[bytes]:
        yield from self._stream

    def close(self) -> None:
        close = getattr(self._stream, "close", None)
        if close is not None:
            close()


class DeadlineTransport(httpx.BaseTransport):
    """마감 백엔드를 붙인 httpcore.ConnectionPool(공개 API)로 요청을 보내는 httpx transport.

    httpx.HTTPTransport 는 network_backend 를 받지 않는다. 비공개 속성(_pool)을 바꾸지 않으려고 같은 변환
    (httpx 요청 → httpcore 요청 → httpx 응답)만 하는 작은 transport 를 둔다. 프록시는 쓰지 않는다.
    """

    def __init__(self, deadline: Deadline, context: ssl.SSLContext) -> None:
        self._pool = httpcore.ConnectionPool(
            ssl_context=context, network_backend=DeadlineNetworkBackend(deadline)
        )

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if not isinstance(request.stream, Iterable):
            raise TypeError("동기 요청 본문이 아니다")
        response = self._pool.handle_request(
            httpcore.Request(
                method=request.method,
                url=httpcore.URL(
                    scheme=request.url.raw_scheme,
                    host=request.url.raw_host,
                    port=request.url.port,
                    target=request.url.raw_path,
                ),
                headers=request.headers.raw,
                content=request.stream,
                extensions=request.extensions,
            )
        )
        if not isinstance(response.stream, Iterable):
            raise TypeError("동기 응답 본문이 아니다")
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=_CoreResponseStream(response.stream),
            extensions=response.extensions,
        )

    def close(self) -> None:
        self._pool.close()


# 전송 실패로 바꿀 httpcore 예외(transport 가 httpx 예외로 바꾸지 않고 그대로 낸다)
_HTTPCORE_ERRORS = (
    httpcore.TimeoutException,
    httpcore.NetworkError,
    httpcore.ProtocolError,
    httpcore.UnsupportedProtocol,
    httpcore.ProxyError,
)


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
        # Client 의 timeout(단계 timeout)은 지금의 남은 시간이다. 소켓 조작마다 DeadlineNetworkStream 이 다시 줄인다
        with (
            httpx.Client(
                transport=DeadlineTransport(deadline, ssl_context()),
                timeout=remaining,
                follow_redirects=False,
                trust_env=False,
            ) as client,
            client.stream(
                method,
                endpoint.url(path),
                json=json_body,
                headers={**endpoint.headers(), "Accept-Encoding": ACCEPT_ENCODING},
            ) as response,
        ):
            body = _read_body(response, deadline)
            # 본문은 언제나 UTF-8 로 읽는다(RFC 8259 §8.1, R4). charset 매개변수는 보지 않는다
            text = body.decode("utf-8", errors="replace")
            return HttpReply(response.status_code, text, response.headers)
    except (
        httpx.HTTPError,
        httpx.InvalidURL,
        httpx.StreamError,
        *_HTTPCORE_ERRORS,
        ValueError,
        TypeError,
        OSError,
    ) as error:
        # 헤더 구성(UnicodeEncodeError·잘못된 헤더 값)·본문 직렬화 오류도 전송 실패다. 메시지는 종류 이름만
        raise TransportFailure(type(error).__name__) from None
