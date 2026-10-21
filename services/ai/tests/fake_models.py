"""시험용 가짜 모델 서버(vLLM·kev.serve 흉내). 127.0.0.1 의 포트 0(자동 배정)에만 열린다.

표준 라이브러리 http.server + 스레드. 받은 요청(메서드·경로·헤더·본문)을 기록하고, 경로마다 정한 응답을 돌려준다.
지연(delay)은 이벤트 대기로 흉내 내서 close() 가 기다리는 요청을 바로 풀어 준다(스레드가 남지 않는다).
HTTP/1.0 으로 답하므로 Content-Length 를 보내지 않으면 클라이언트는 연결이 닫힐 때까지 본문을 읽는다.
실제 회사 엔드포인트·외부 네트워크는 쓰지 않는다. 기록용 프록시가 필요하면 서버 하나를 프록시 주소로 쓴다
(프록시로 온 요청은 경로가 절대 URL 이라 경로 표에 없고, 404 로 답하되 기록은 남는다).

C5-A 2차(R1)용으로 더한 것:
- FakeModelServer(ssl_context=...): 자체 서명 인증서로 TLS 를 끝까지 하는 서버. 제품 클라이언트는 이 서버에 실패해야 한다
  (TLS 검증 켜짐). 인증서·키는 self_signed_certificate 가 시험 실행 때 임시 폴더에 만든다(저장소에 두지 않는다).
- RawServer: TCP 를 직접 다루는 서버. 헤더 흘리기·TCP 를 받고 아무것도 안 보내기·TLS 레코드 흘리기를 흉내 낸다.
  고치기 전 코드가 시험을 끝없이 붙잡지 않게 모든 흘리기·정지는 정한 시간(duration) 뒤 연결을 닫는다.
- over_tls(behavior, context): RawServer 행동을 TLS 핸드셰이크 뒤에 돈다(구현 뒤 검증 때 더함). 제품 클라이언트가 그
  인증서를 믿는 것은 시험이 ssl_context 를 "검증을 켠 채 시험 CA 를 더 믿는 것" 으로 바꿔 끼울 때뿐이다.
"""

import json
import shutil
import socket
import ssl
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from support import (
    KEV_BASE,
    KEV_LORA_SHA256,
    KEV_MODEL_ID,
    KEV_REVISION,
    KEV_RUN,
    QWEN_RUN,
    extraction_fixture,
    kev_fixture,
)


@dataclass(frozen=True)
class Reply:
    status: int = 200
    json_body: object = None
    raw_body: bytes | None = None
    headers: dict = field(default_factory=dict)
    delay: float = 0.0
    # Content-Length 헤더 값. None 이면 실제 본문 길이(흘려보내기면 보내지 않는다). send_length=False 면 보내지 않는다
    content_length: int | None = None
    send_length: bool = True
    # 조금씩 흘려보내기: 헤더를 바로 보내고 drip 바이트를 drip_interval 초마다 보낸다. drip_for 초가 지나면 연결을 닫는다.
    # 명세(C5-A S1)는 "끝없이" 보내지만, 고치기 전 코드가 시험을 끝없이 붙잡지 않게 상한을 둔다
    drip: bytes | None = None
    drip_interval: float = 0.1
    drip_for: float = 4.0
    # 헤더를 보낸 뒤, 본문을 보내기 전에 부른다(주입한 시계를 그 순간 옮기는 시험용). 서버 스레드에서 돈다
    before_body: Callable[[], None] | None = None
    # Content-Type 헤더 값(C5-A 2차 R4: 이상한 charset 매개변수)
    content_type: str = "application/json"
    # 흘리기 박자의 기준 시각(time.monotonic). 주면 첫 바이트는 헤더 직후, 그 뒤는 drip_anchor + k × drip_interval 에
    # 보낸다(요청 시작에 맞춘 박자, C5-A 2차 R1). None 이면 바이트마다 drip_interval 을 기다린다
    drip_anchor: float | None = None

    def body(self) -> bytes:
        if self.raw_body is not None:
            return self.raw_body
        return json.dumps(self.json_body, ensure_ascii=False).encode("utf-8")


@dataclass(frozen=True)
class Recorded:
    method: str
    path: str
    headers: dict
    body: bytes

    def json(self):
        return json.loads(self.body.decode("utf-8"))


class _TlsHTTPServer(ThreadingHTTPServer):
    """받은 연결을 TLS 로 감싼다. 핸드셰이크는 요청 처리 스레드에서 한다(accept 스레드를 막지 않는다)."""

    def __init__(self, address, handler, context: ssl.SSLContext) -> None:
        self._context = context
        super().__init__(address, handler)

    def get_request(self):
        sock, address = self.socket.accept()
        wrapped = self._context.wrap_socket(sock, server_side=True, do_handshake_on_connect=False)
        return wrapped, address

    def handle_error(self, request, client_address) -> None:
        # 클라이언트가 인증서를 거절해 핸드셰이크가 깨진 연결이다. 시험 출력에 traceback 을 남기지 않는다
        pass


class FakeModelServer:
    def __init__(self, port: int = 0, ssl_context: ssl.SSLContext | None = None) -> None:
        self.requests: list[Recorded] = []
        self._tls_failed = threading.Event()
        self._routes: dict[tuple[str, str], list[Reply]] = {}
        self._responders: dict = {}
        self._release = threading.Event()
        self._lock = threading.Lock()
        self._tls = ssl_context is not None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def setup(self) -> None:
                if isinstance(self.request, ssl.SSLSocket):
                    self.request.settimeout(5.0)
                    try:
                        self.request.do_handshake()
                    except OSError:
                        owner._tls_failed.set()
                        raise
                super().setup()

            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                headers = {k.lower(): v for k, v in self.headers.items()}
                reply = owner._take(self.command, self.path, headers, body)
                if reply.delay:
                    owner._release.wait(reply.delay)
                dripping = reply.drip is not None
                payload = b"" if dripping else reply.body()
                self.send_response(reply.status)
                self.send_header("Content-Type", reply.content_type)
                declared = reply.content_length
                if declared is None and not dripping:
                    declared = len(payload)
                if reply.send_length and declared is not None:
                    self.send_header("Content-Length", str(declared))
                for key, value in reply.headers.items():
                    self.send_header(key, value)
                self.end_headers()
                if reply.before_body is not None:
                    reply.before_body()
                try:
                    if dripping:
                        owner._drip(self.wfile, reply)
                    else:
                        self.wfile.write(payload)
                except OSError:  # 클라이언트가 먼저 끊었다(BrokenPipe·ConnectionReset 등)
                    pass

            do_GET = _handle
            do_POST = _handle

            def log_message(self, *args) -> None:  # 시험 출력에 접근 로그를 남기지 않는다
                pass

        if ssl_context is None:
            self._server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        else:
            self._server = _TlsHTTPServer(("127.0.0.1", port), Handler, ssl_context)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    @property
    def url(self) -> str:
        scheme = "https" if self._tls else "http"
        return f"{scheme}://127.0.0.1:{self.port}"

    def wait_for_tls_failure(self, timeout: float) -> bool:
        """서버 쪽 TLS 핸드셰이크가 한 번이라도 깨졌으면 True(클라이언트가 인증서를 거절했다). timeout 까지 기다린다."""
        return self._tls_failed.wait(timeout)

    def route(self, method: str, path: str, *replies: Reply) -> "FakeModelServer":
        """경로의 응답 차례. 마지막 응답은 그 뒤 호출에도 계속 쓴다."""
        with self._lock:
            self._responders.pop((method, path), None)
            self._routes[(method, path)] = list(replies)
        return self

    def respond_with(self, method: str, path: str, responder) -> "FakeModelServer":
        """받은 요청(Recorded)으로 응답을 만드는 함수를 둔다(질문 수가 요청마다 다른 Kev v0.2 묶음용)."""
        with self._lock:
            self._routes.pop((method, path), None)
            self._responders[(method, path)] = responder
        return self

    def _take(self, method: str, path: str, headers: dict, body: bytes) -> Reply:
        recorded = Recorded(method, path, headers, body)
        with self._lock:
            self.requests.append(recorded)
            responder = self._responders.get((method, path))
            queue = self._routes.get((method, path))
            if responder is None:
                if not queue:
                    return Reply(404, {"error": "not found"})
                return queue.pop(0) if len(queue) > 1 else queue[0]
        return responder(recorded)

    def _drip(self, wfile, reply: Reply) -> None:
        stop = time.monotonic() + reply.drip_for
        if reply.drip_anchor is not None:
            self._drip_on_beat(wfile, reply, stop)
            return
        while time.monotonic() < stop and not self._release.is_set():
            wfile.write(reply.drip)
            self._release.wait(reply.drip_interval)

    def _drip_on_beat(self, wfile, reply: Reply, stop: float) -> None:
        wfile.write(reply.drip)
        beat = 1
        while (at := reply.drip_anchor + beat * reply.drip_interval) < stop:
            if self._release.wait(max(0.0, at - time.monotonic())):
                return
            wfile.write(reply.drip)
            beat += 1

    def calls(self, method: str, path: str) -> list[Recorded]:
        with self._lock:
            return [r for r in self.requests if r.method == method and r.path == path]

    def close(self) -> None:
        self._release.set()
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def free_port() -> int:
    """지금 비어 있는 127.0.0.1 포트. 바로 닫으므로 그 주소로 연결하면 거부된다(닫힌 포트)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def closed_url() -> str:
    return f"http://127.0.0.1:{free_port()}"


# ---------------------------------------------------------------- TLS(자체 서명) · TCP 직접 다루기(C5-A 2차 R1)


def self_signed_certificate(
    directory: Path,
    *,
    common_name: str = "127.0.0.1",
    alt_names: str = "IP:127.0.0.1,DNS:localhost",
) -> tuple[Path, Path]:
    """자체 서명 인증서와 키를 directory 에 만든다(openssl CLI, 하루짜리 EC 키). 기본은 127.0.0.1·localhost 용이다.

    alt_names 는 subjectAltName 값이다(호스트 이름 검사 시험은 "DNS:localhost" 만 넣는다).
    시험 실행 때 임시 폴더에만 만든다. openssl 이 없으면 시험을 건너뛰지 않고 실패시킨다.
    """
    openssl = shutil.which("openssl")
    if openssl is None:
        raise RuntimeError("openssl 이 없어 자체 서명 인증서를 만들 수 없다")
    cert, key = directory / "self-signed-cert.pem", directory / "self-signed-key.pem"
    subprocess.run(
        [
            openssl,
            "req",
            "-x509",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:prime256v1",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "1",
            "-subj",
            f"/CN={common_name}",
            "-addext",
            f"subjectAltName={alt_names}",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    return cert, key


def server_tls_context(cert: Path, key: Path) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    return context


# RawServer 의 연결 하나를 다루는 함수: behavior(conn, server)
Behavior = Callable[[socket.socket, "RawServer"], None]
# 짧은 대기 단위(초). 흘리기·정지 중에도 close() 를 이 간격 안에 알아챈다
_POLL = 0.05


class RawServer:
    """TCP 를 직접 다루는 가짜 서버. 127.0.0.1 의 port(0 이면 자동 배정)에만 열린다.

    연결마다 스레드에서 behavior(conn, server) 를 부른다. 받은 바이트는 record 로 모으고(received·wait_for_bytes),
    HTTP 요청 줄은 requests 에 (메서드, 경로) 로 남긴다. close() 는 흘리기·정지 중인 연결을 _POLL 안에 풀어 준다.
    """

    def __init__(self, behavior: Behavior, port: int = 0) -> None:
        self.requests: list[tuple[str, str]] = []
        self._behavior = behavior
        self._received = bytearray()
        self._got_bytes = threading.Event()
        self._release = threading.Event()
        self._lock = threading.Lock()
        self._conns: list[socket.socket] = []
        self._threads: list[threading.Thread] = []
        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._listener.bind(("127.0.0.1", port))
        self._listener.listen(16)
        self._listener.settimeout(_POLL)
        self._acceptor = threading.Thread(target=self._accept_loop, daemon=True)
        self._acceptor.start()

    @property
    def port(self) -> int:
        return self._listener.getsockname()[1]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def https_url(self) -> str:
        return f"https://127.0.0.1:{self.port}"

    @property
    def closing(self) -> bool:
        return self._release.is_set()

    def wait(self, seconds: float) -> bool:
        """seconds 동안 기다린다. close() 가 불리면 바로 True."""
        return self._release.wait(seconds)

    def note_request(self, method: str, path: str) -> None:
        with self._lock:
            self.requests.append((method, path))

    def record(self, data: bytes) -> None:
        with self._lock:
            self._received.extend(data)
        self._got_bytes.set()

    def received(self) -> bytes:
        with self._lock:
            return bytes(self._received)

    def wait_for_bytes(self, timeout: float) -> bool:
        """클라이언트가 보낸 바이트가 하나라도 오면 True. timeout 까지 없으면 False."""
        return self._got_bytes.wait(timeout)

    def _accept_loop(self) -> None:
        while not self._release.is_set():
            try:
                conn, _ = self._listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            thread = threading.Thread(target=self._serve, args=(conn,), daemon=True)
            with self._lock:
                self._conns.append(conn)
                self._threads.append(thread)
            thread.start()

    def _serve(self, conn: socket.socket) -> None:
        try:
            self._behavior(conn, self)
        except OSError:  # 클라이언트가 먼저 끊었다(BrokenPipe·ConnectionReset 등)
            pass
        finally:
            conn.close()

    def close(self) -> None:
        self._release.set()
        self._listener.close()
        with self._lock:
            conns, threads = list(self._conns), list(self._threads)
        for conn in conns:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        for thread in [self._acceptor, *threads]:
            thread.join(timeout=5)


def _recv_some(conn: socket.socket, server: RawServer) -> bytes | None:
    """_POLL 동안 받는다. 받은 것이 없으면 b"", 상대가 닫았으면 None."""
    conn.settimeout(_POLL)
    try:
        data = conn.recv(65536)
    except TimeoutError:
        return b""
    if not data:
        return None
    server.record(data)
    return data


def _read_http_request(conn: socket.socket, server: RawServer) -> tuple[str, str]:
    """요청 머리와 본문(Content-Length 만큼)을 다 읽고 (메서드, 경로) 를 돌려준다."""
    data = b""
    while b"\r\n\r\n" not in data:
        if server.closing:
            raise ConnectionAbortedError
        chunk = _recv_some(conn, server)
        if chunk is None:
            raise ConnectionAbortedError
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    method, path, _ = lines[0].split(" ", 2)
    length = 0
    for line in lines[1:]:
        name, _, value = line.partition(":")
        if name.strip().lower() == "content-length":
            length = int(value.strip())
    while len(body) < length:
        if server.closing:
            raise ConnectionAbortedError
        chunk = _recv_some(conn, server)
        if chunk is None:
            raise ConnectionAbortedError
        body += chunk
    return method, path


def by_route(routes: dict[tuple[str, str], Behavior], default: Behavior | None = None) -> Behavior:
    """HTTP 요청을 다 읽은 뒤 (메서드, 경로) 로 응답 쓰기 함수를 고른다. 표에 없고 default 도 없으면 404."""

    def behavior(conn: socket.socket, server: RawServer) -> None:
        method, path = _read_http_request(conn, server)
        server.note_request(method, path)
        writer = routes.get((method, path), default)
        if writer is None:
            writer = json_reply({"error": "not found"}, status=404)
        writer(conn, server)

    return behavior


def json_reply(body: object, status: int = 200) -> Behavior:
    """HTTP/1.0 JSON 응답 하나를 쓰고 닫는다."""

    def writer(conn: socket.socket, server: RawServer) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        head = (
            f"HTTP/1.0 {status} OK\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(payload)}\r\n\r\n"
        ).encode("latin-1")
        conn.sendall(head + payload)

    return writer


def drip_headers(
    interval: float = 0.1,
    duration: float = 4.0,
    *,
    delay_before: float = 0.0,
    after_status: Callable[[], None] | None = None,
) -> Behavior:
    """상태 줄을 바로 보내고, 헤더를 interval 초마다 1바이트씩 보낸다. duration 초 뒤 닫는다(헤더는 끝나지 않는다).

    delay_before: 상태 줄을 보내기 전에 기다리는 시간. after_status: 상태 줄을 보낸 직후 부른다(주입 시계를 옮기는 시험용).
    """

    def writer(conn: socket.socket, server: RawServer) -> None:
        if delay_before and server.wait(delay_before):
            return
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Drip: ")
        if after_status is not None:
            after_status()
        stop = time.monotonic() + duration
        while time.monotonic() < stop and not server.wait(interval):
            conn.sendall(b"a")

    return writer


def silent(duration: float = 4.0) -> Behavior:
    """TCP 를 받고 아무것도 보내지 않는다. 받은 바이트는 기록한다. duration 초 뒤(또는 상대가 닫으면) 닫는다."""

    def behavior(conn: socket.socket, server: RawServer) -> None:
        stop = time.monotonic() + duration
        while time.monotonic() < stop and not server.closing:
            if _recv_some(conn, server) is None:
                return

    return behavior


# TLS 레코드 머리: handshake(0x16), TLS 1.2, 길이 16384. 이 길이를 다 받기 전에는 클라이언트가 레코드를 처리하지 않는다
TLS_RECORD_HEAD = b"\x16\x03\x03\x40\x00"


def tls_record_drip(interval: float = 0.1, duration: float = 4.0) -> Behavior:
    """TLS 핸드셰이크 레코드 머리를 보내고 그 본문을 interval 초마다 1바이트씩 흘린다. duration 초 뒤 닫는다."""

    def behavior(conn: socket.socket, server: RawServer) -> None:
        conn.sendall(TLS_RECORD_HEAD)
        stop = time.monotonic() + duration
        while time.monotonic() < stop and not server.wait(interval):
            conn.sendall(b"\x00")

    return behavior


def over_tls(
    behavior: Behavior, context: ssl.SSLContext, handshakes: threading.Event | None = None
) -> Behavior:
    """behavior 를 TLS 위에서 돈다(C5-A 2차 R1, 핸드셰이크 뒤 TLS 스트림의 읽기·쓰기 마감 시험용).

    TLS 핸드셰이크를 끝까지 한 뒤 handshakes 를 켜고, TLS 소켓으로 behavior 를 부른다. 받은 바이트 기록(received)은
    풀린 응용 데이터다. 클라이언트가 인증서를 거절하면 핸드셰이크 오류(OSError)로 연결을 닫는다.
    """

    def wrapped(conn: socket.socket, server: RawServer) -> None:
        conn.settimeout(5.0)
        with context.wrap_socket(conn, server_side=True) as tls:
            if handshakes is not None:
                handshakes.set()
            behavior(tls, server)

    return wrapped


# ---------------------------------------------------------------- 응답 본문


def vllm_models(*model_ids: str) -> dict:
    """vLLM OpenAI 호환 GET /v1/models."""
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in model_ids]}


def kev_models(
    run: str = KEV_RUN,
    *,
    top_level: bool = False,
    without: tuple[str, ...] = (),
    **overrides: object,
) -> dict:
    """결정 모델 서버(sol_decision) GET /v1/models(03 §11, ADR-034 3번). 기본값은 레지스트리 bosun-v3.1-0.6b 와 같다.

    without 에 적은 키는 응답에서 뺀다(예: revision 을 내지 않는 서버). overrides 는 필드 값을 바꾼다.
    """
    model: dict[str, object] = {
        "id": KEV_MODEL_ID,
        "run": run,
        "base": KEV_BASE,
        "lora": KEV_LORA_SHA256,
        "revision": KEV_REVISION,
        "temperature": None,
        **overrides,
    }
    model = {k: v for k, v in model.items() if k not in without}
    return model if top_level else {"object": "list", "data": [model]}


def chat_completion(content: str | None, *, model: str = QWEN_RUN) -> dict:
    message = (
        {"role": "assistant"} if content is None else {"role": "assistant", "content": content}
    )
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def extraction_output(fixture_id: str = "FX-01") -> str:
    """모델 출력 흉내: 추출 fixture 에서 gateway 가 채우는 model 블록을 뺀 JSON 문자열."""
    data = extraction_fixture(fixture_id)
    data.pop("model", None)
    return json.dumps(data, ensure_ascii=False)


def kev_answer(fixture_id: str = "FX-01", latency_ms: int = 123) -> dict:
    """kev.serve POST /v1/systemone 응답(03 §5.4): responses·usage·latency_ms."""
    fixture = kev_fixture(fixture_id)
    return {
        "responses": fixture["responses"],
        "usage": {"input_tokens": 512, "output_tokens": 4},
        "latency_ms": latency_ms,
    }
