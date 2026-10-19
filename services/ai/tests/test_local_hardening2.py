"""C5-A 보안 후속 2차 R1~R5(c5/gateway-hardening, 기준 df5d4aa, 3e 재검토 2026-10-20). 구현 전 실패 시험(red).

시험이 기대하는 모양(구현자가 맞춘다):
- R1: http.call 의 소켓 조작(connect_tcp·start_tls·read·write) 하나하나가 요청 마감(Deadline)의 남은 시간을 넘지 못한다.
  남은 시간이 0 이하면 소켓을 부르지 않고 timeout 실패다. 실패는 TransportFailure(종류 이름)다. 붙이는 방법(백엔드·
  transport 클래스 이름)은 묶지 않고 행위로 본다. TLS 검증은 켜진 채이고 SSL_CERT_FILE 같은 env 를 읽지 않는다.
- R2: strict_json 은 유한하지 않은 수(1e999·-1e999·1E400)와 float 로 바꿀 때 넘치는 정수(9×309자리, 2**1024)를
  ValueError 로 거절한다. 1e308·int(sys.float_info.max) 같은 유한한 큰 수는 통과한다.
- R3: strict_json.MAX_JSON_DEPTH = 128. 파싱 전에 중첩 깊이를 세고 128 은 통과, 129 는 ValueError.
  문자열 안의 괄호와 이스케이프(\\")는 세지 않는다.
- R4: 응답 본문은 charset 매개변수와 관계없이 UTF-8 로 읽는다(디코딩 실패 바이트는 replace).
- R5: 잘못된 퓨니코드 호스트(IDNAError)는 기동 검사 3단계 위반 (키, "INSECURE_URL") 이다. 값은 출력에 나오지 않는다.

시간 값은 명세 값이다(마감 1000ms, 여유 300ms). 고치기 전 코드는 같은 결과 코드로 끝나도 확실히 오래 걸린다
(헤더 흘리기 약 4s, 본문 0.95s 간격 약 1.9s, 느린 TCP 연결 0.8s + TLS 정지 약 1.8s). 흘리기·정지 서버는 4초 뒤 닫는다.
느린 TCP 연결은 시험이 그 포트로의 socket.connect 앞에 지연을 넣어 흉내 낸다(루프백은 TCP 연결이 즉시 끝난다).
모델 서버는 127.0.0.1 가짜 서버뿐이다. 자체 서명 인증서는 시험 실행 때 임시 폴더에 만들고, 제품 클라이언트가 그
서버에 "실패해야 한다" 로만 쓴다. 키는 모두 가짜 값이다.

구현 뒤 검증에서 더한 절(표시: "구현 뒤 검증에서 더함"):
- R1 핸드셰이크 뒤 TLS 스트림: 이 절만 http.ssl_context 를 "제품 context(검증·호스트 이름 검사 켜짐) + 시험 CA" 로
  바꿔 끼워 자체 서명 서버와 TLS 를 끝낸다. 검증을 끄는 코드는 쓰지 않는다.
- R1 래퍼 단위: DeadlineNetworkBackend·DeadlineNetworkStream 을 가짜 inner 와 주입 시계로 본다.
- R5 보강: urlsplit 이 ValueError 로 거절하는 대괄호 호스트.
"""

import json
import logging
import re
import socket
import ssl
import sys
import threading
import time

import httpcore
import pytest
from fake_models import (
    FakeModelServer,
    RawServer,
    Reply,
    by_route,
    chat_completion,
    closed_url,
    drip_headers,
    extraction_output,
    free_port,
    json_reply,
    kev_answer,
    kev_models,
    over_tls,
    self_signed_certificate,
    server_tls_context,
    silent,
    tls_record_drip,
    vllm_models,
)
from pydantic import SecretStr
from support import (
    KEV_KEY,
    QWEN_KEY,
    QWEN_RUN,
    SRC_DIR,
    FakeClock,
    extract_request,
    extraction_fixture,
    kev_request,
    new_deadline,
    run_main,
)
from test_local_hardening import RETRY_NOTE, user_tails

from sol_ai import strict_json
from sol_ai.adapters import http
from sol_ai.errors import StartupRefused

SYSTEMONE = "/v1/systemone"
MODELS = "/v1/models"
COMPLETIONS = "/v1/chat/completions"
EX_CONFIG = 78
COMPANY_HOST = "acropolissg.com"
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

# 명세 R1 값
BUDGET_MS = 1000
BUDGET_S = BUDGET_MS / 1000
SLACK = 0.3
LIMIT = BUDGET_S + SLACK
# 흘리기·정지 서버가 연결을 닫기까지(초). 고치기 전 코드가 시험을 끝없이 붙잡지 않게 한다
STALL_FOR = 4.0
# 본문을 마감 직전에 멈추는 서버: 헤더 직후 1바이트, 그 뒤 요청 시작부터 0.95초마다 1바이트(1차에서 1.92s 걸린 경우).
# 박자를 요청 시작에 맞춘다. /extract 는 프롬프트를 만드느라 본문 단계가 늦게 시작해, 바이트마다 0.95초를 세면
# 고치기 전에도 본문 읽기 timeout(그 단계 시작 때 남은 시간 < 0.95s)에 걸려 마감 근처에서 끝나 버린다
BODY_DRIP_INTERVAL = 0.95
# 느린 TCP 연결(초). 예산보다 짧아 연결은 성공하고, 남은 시간이 TLS 핸드셰이크 몫이다
CONNECT_DELAY = 0.8


def body_drip() -> Reply:
    """지금부터 0.95초마다 1바이트(바로 뒤에 요청을 보낸다)."""
    return Reply(
        drip=b" ", drip_interval=BODY_DRIP_INTERVAL, drip_for=3.0, drip_anchor=time.monotonic()
    )


@pytest.fixture
def raw_server():
    """RawServer 를 만든다. 시험이 끝나면 모두 닫는다."""
    servers: list[RawServer] = []

    def _make(behavior, port: int = 0) -> RawServer:
        server = RawServer(behavior, port)
        servers.append(server)
        return server

    yield _make
    for server in servers:
        server.close()


@pytest.fixture(scope="session")
def certificate(tmp_path_factory) -> tuple:
    """127.0.0.1 자체 서명 인증서·키(임시 폴더). 저장소에 두지 않는다."""
    return self_signed_certificate(tmp_path_factory.mktemp("self-signed-tls"))


@pytest.fixture
def tls_server(certificate):
    """자체 서명 인증서로 TLS 를 끝까지 하는 가짜 모델 서버를 만든다."""
    servers: list[FakeModelServer] = []

    def _make() -> FakeModelServer:
        server = FakeModelServer(ssl_context=server_tls_context(*certificate))
        servers.append(server)
        return server

    yield _make
    for server in servers:
        server.close()


def slow_connect(monkeypatch, port: int, *, delay: float = 0.0, then=None) -> None:
    """127.0.0.1:port 로의 socket.connect 앞에 delay 초를 기다리고 then() 을 부른다(느린 TCP 연결 흉내)."""
    inner = socket.socket.connect

    def connect(self, address):
        if self.family == socket.AF_INET and address[1] == port:
            if delay:
                time.sleep(delay)
            if then is not None:
                then()
        return inner(self, address)

    monkeypatch.setattr(socket.socket, "connect", connect)


def endpoint(url: str) -> http.Endpoint:
    return http.Endpoint(url, SecretStr(QWEN_KEY))


def failed_call(url: str, deadline=None, path: str = MODELS) -> tuple[str, float]:
    """http.call 이 TransportFailure 로 끝나야 한다. (메시지, 걸린 초)."""
    started = time.monotonic()
    with pytest.raises(http.TransportFailure) as failure:
        http.call(endpoint(url), "GET", path, deadline=deadline or new_deadline(BUDGET_S))
    return str(failure.value), time.monotonic() - started


def is_reason_name(message: str) -> bool:
    return IDENTIFIER.fullmatch(message) is not None


def fixture_client(make_client):
    """fixture 모드(local) 앱. 500 도 응답으로 받아 상태 코드로 본다."""
    return make_client(SOL_RUN_MODE="fixture", raise_server_exceptions=False)


def timed_post(client, path: str, body: dict):
    started = time.monotonic()
    response = client.post(path, json=body)
    return response, time.monotonic() - started


def kev_outcome(response) -> tuple:
    """(HTTP 상태, kev.enabled, errorCode). 200 이 아니면 본문은 보지 않는다."""
    if response.status_code != 200:
        return (response.status_code, None, None)
    body = response.json()
    return (200, body["kev"]["enabled"], body["errorCode"])


def extract_outcome(response) -> tuple:
    """(HTTP 상태, status, errorCode). 200 이 아니면 본문은 보지 않는다."""
    if response.status_code != 200:
        return (response.status_code, None, None)
    body = response.json()
    return (200, body["status"], body["errorCode"])


KEV_UNAVAILABLE = (200, False, "KEV_UNAVAILABLE")
KEV_READ = (200, True, None)
QWEN_UNAVAILABLE = (200, "FAILED", "QWEN_UNAVAILABLE")
EXTRACTION_FAILED = (200, "FAILED", "EXTRACTION_FAILED")
EXTRACTED = (200, "COMPLETED", None)


def run_kev(make_client, local_models, reply: Reply):
    local_models.kev.route("POST", SYSTEMONE, reply)
    return fixture_client(make_client).post("/kev", json=kev_request("FX-01"))


def run_extract(make_client, local_models, *replies: Reply):
    local_models.qwen.route("POST", COMPLETIONS, *replies)
    return fixture_client(make_client).post("/extract", json=extract_request("FX-01"))


def completion(content: str) -> Reply:
    return Reply(json_body=chat_completion(content))


def with_extra(body: dict, raw_value: str) -> str:
    """JSON 객체에 어댑터·스키마가 보지 않는 키 "extra" 를 더하고 그 값을 raw_value(JSON 원문 조각)로 둔다."""
    text = json.dumps({**body, "extra": "__RAW__"}, ensure_ascii=False)
    assert text.count('"__RAW__"') == 1  # 전제
    return text.replace('"__RAW__"', raw_value)


def model_output_with_extra(raw_value: str) -> str:
    """FX-01 모델 출력 + 스키마 밖 키. 스키마 정리가 이 키를 버리므로, 파싱이 거절하지 않으면 그대로 통과한다."""
    return with_extra(json.loads(extraction_output("FX-01")), raw_value)


def raw_reply(text: str, **changes) -> Reply:
    return Reply(raw_body=text.encode("utf-8"), **changes)


# ================================================================ R1 마감이 소켓 조작 안쪽까지 묶인다


def test_call_cuts_header_drip_at_deadline(raw_server):
    # 상태 줄은 바로, 헤더는 100ms 마다 1바이트. 고치기 전에는 헤더 읽기 timeout 이 recv 마다 새로 시작해
    # 서버가 닫는 4초 뒤에야 끝난다(3e 실측 6.07s)
    server = raw_server(by_route({}, default=drip_headers(0.1, STALL_FOR)))
    message, elapsed = failed_call(server.url)
    assert (is_reason_name(message), elapsed < LIMIT) == (True, True), f"소요 {elapsed:.2f}s"


def test_call_cuts_body_drip_pausing_just_under_the_budget(fake_server):
    # 본문은 요청 시작부터 0.95초마다 1바이트(마감 직전에 한 바이트, 그 뒤 정지). 고치기 전에는 본문 읽기
    # timeout(단계 시작 때 남은 약 1.0s)을 recv 마다 다시 써서 다음 바이트(약 1.9s)까지 기다린다
    server = fake_server()
    server.route("GET", MODELS, body_drip())
    message, elapsed = failed_call(server.url)
    assert (is_reason_name(message), elapsed < LIMIT) == (True, True), f"소요 {elapsed:.2f}s"


TLS_STALLS = {
    "silent": lambda: silent(STALL_FOR),
    "record_drip": lambda: tls_record_drip(0.1, STALL_FOR),
}
CONNECTS = {"fast_connect": 0.0, "slow_connect": CONNECT_DELAY}


@pytest.mark.parametrize("connect", sorted(CONNECTS))
@pytest.mark.parametrize("stall", sorted(TLS_STALLS))
def test_call_cuts_stalled_tls_handshake_at_deadline(raw_server, monkeypatch, stall, connect):
    # https://127.0.0.1:<port>. 서버는 TCP 를 받고 아무것도 안 보내거나 TLS 레코드를 조금씩 흘린다.
    # 고치기 전에는 connect timeout 하나를 TCP 연결과 TLS 핸드셰이크에 따로 써서 느린 연결이면 약 0.8 + 1.0s 다
    server = raw_server(TLS_STALLS[stall]())
    slow_connect(monkeypatch, server.port, delay=CONNECTS[connect])
    message, elapsed = failed_call(server.https_url)
    assert (is_reason_name(message), elapsed < LIMIT) == (True, True), f"소요 {elapsed:.2f}s"


def test_call_does_not_start_tls_after_connect_used_up_the_deadline(raw_server, monkeypatch):
    # TCP 연결 중에 주입 시계가 마감을 넘긴다. 남은 시간이 0 이하이므로 핸드셰이크를 시작하지 않는다(ClientHello 0바이트).
    # 고치기 전에는 연결 단계 시작 때의 남은 시간(5초)으로 핸드셰이크를 시작한다
    clock = FakeClock()
    server = raw_server(silent(2.0))
    slow_connect(monkeypatch, server.port, then=lambda: clock.advance(10.0))
    message, _ = failed_call(server.https_url, new_deadline(5.0, clock))
    assert (is_reason_name(message), server.wait_for_bytes(0.5), len(server.received())) == (
        True,
        False,
        0,
    )


def test_call_does_not_send_request_after_connect_used_up_the_deadline(raw_server, monkeypatch):
    # 평문 HTTP. TCP 연결 중에 주입 시계가 마감을 넘긴다 → 요청 바이트를 하나도 쓰지 않는다(write 도 마감을 본다)
    clock = FakeClock()
    server = raw_server(silent(2.0))
    slow_connect(monkeypatch, server.port, then=lambda: clock.advance(10.0))
    message, _ = failed_call(server.url, new_deadline(5.0, clock))
    assert (is_reason_name(message), server.wait_for_bytes(1.0)) == (True, False)


def test_call_stops_reading_headers_once_no_time_is_left(raw_server):
    # 상태 줄을 보낸 직후 주입 시계가 마감을 넘긴다. 다음 recv 는 남은 시간이 없으므로 기다리지 않는다.
    # 고치기 전에는 헤더 읽기 단계 시작 때의 남은 시간(5초)을 recv 마다 써서 서버가 닫는 4초 뒤에 끝난다
    clock = FakeClock()
    writer = drip_headers(
        0.1, STALL_FOR, delay_before=0.2, after_status=lambda: clock.advance(10.0)
    )
    server = raw_server(by_route({}, default=writer))
    message, elapsed = failed_call(server.url, new_deadline(5.0, clock))
    assert (is_reason_name(message), elapsed < 2.0) == (True, True), f"소요 {elapsed:.2f}s"


def trusted_get_status(server: FakeModelServer, cert) -> int:
    """인증서를 신뢰 목록에 넣은 별도 클라이언트(검증 켜짐)로 GET /v1/models 를 보낸다(서버가 정상인지 보는 전제)."""
    context = ssl.create_default_context(cafile=str(cert))
    with (
        socket.create_connection(("127.0.0.1", server.port), timeout=5) as raw,
        context.wrap_socket(raw, server_hostname="127.0.0.1") as tls,
    ):
        tls.sendall(b"GET /v1/models HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        data = b""
        while chunk := tls.recv(65536):
            data += chunk
    return int(data.split(b" ", 2)[1])


def test_call_refuses_self_signed_tls_server(tls_server, certificate):
    server = tls_server().route("GET", MODELS, Reply(json_body=vllm_models(QWEN_RUN)))
    assert (
        trusted_get_status(server, certificate[0]) == 200
    )  # 전제: 인증서를 믿으면 정상 응답하는 서버다
    served = len(server.requests)
    message, _ = failed_call(server.url, new_deadline(5.0))
    assert (
        is_reason_name(message),
        server.wait_for_tls_failure(2.0),
        len(server.requests) - served,
    ) == (True, True, 0)


def test_call_ignores_certificate_environment_variables(tls_server, certificate, monkeypatch):
    # SSL_CERT_FILE·SSL_CERT_DIR 이 자체 서명 인증서를 가리켜도 신뢰 목록은 바뀌지 않는다
    server = tls_server().route("GET", MODELS, Reply(json_body=vllm_models(QWEN_RUN)))
    monkeypatch.setenv("SSL_CERT_FILE", str(certificate[0]))
    monkeypatch.setenv("SSL_CERT_DIR", str(certificate[0].parent))
    message, _ = failed_call(server.url, new_deadline(5.0))
    assert (is_reason_name(message), server.wait_for_tls_failure(2.0), server.requests) == (
        True,
        True,
        [],
    )


TLS_RELAXATIONS = (
    "CERT_NONE",
    "CERT_OPTIONAL",
    "check_hostname = False",
    "check_hostname=False",
    "_create_unverified_context",
)


def test_product_code_does_not_relax_tls_checks():
    # 호스트 이름 검사는 행위로 볼 수 없다(시험 CA 를 제품이 믿게 하지 않는다). 끄는 코드가 없는지 본다
    offenders = [
        (str(path.relative_to(SRC_DIR)), marker)
        for path in sorted(SRC_DIR.rglob("*.py"))
        for marker in TLS_RELAXATIONS
        if marker in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


# ---- R1 끝에서 끝까지(/kev·/extract)

E2E_STALLS = ["body_drip", "header_drip", "tls_record_drip", "tls_silent"]


def stalled_model_server(stall: str, models_body: dict, post_path: str, ctx) -> tuple:
    """멈추는 모델 서버의 기준 URL 과, 앱 기동 뒤 부를 함수.

    - header_drip·body_drip: GET /v1/models 는 정상(기동 대조 일치), POST 가 멈춘다.
    - tls_*: 기동 때는 닫힌 포트(대조 미확인, 바로 거부)이고 기동 뒤 같은 포트에 TLS 정지 서버가 열린다. 그 포트로의
      TCP 연결은 CONNECT_DELAY 만큼 느리다. Kev 는 요청 때 지연 대조(GET /v1/models)가, Qwen 은 POST 가 멈춘다.
    """
    raw_server, fake_server, monkeypatch = ctx
    if stall == "header_drip":
        routes = {("GET", MODELS): json_reply(models_body)}
        server = raw_server(by_route(routes, default=drip_headers(0.1, STALL_FOR)))
        return server.url, lambda: None
    if stall == "body_drip":
        server = fake_server().route("GET", MODELS, Reply(json_body=models_body))
        # 박자는 앱 기동 뒤, 요청 바로 앞에 맞춘다
        return server.url, lambda: server.route("POST", post_path, body_drip())
    port = free_port()
    behavior = TLS_STALLS["silent" if stall == "tls_silent" else "record_drip"]

    def after_start() -> None:
        raw_server(behavior(), port)
        slow_connect(monkeypatch, port, delay=CONNECT_DELAY)

    return f"https://127.0.0.1:{port}", after_start


@pytest.mark.parametrize("stall", E2E_STALLS)
def test_kev_stalled_model_server_is_kev_unavailable_within_budget(
    make_client, monkeypatch, local_models, raw_server, fake_server, stall
):
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    ctx = (raw_server, fake_server, monkeypatch)
    url, after_start = stalled_model_server(stall, kev_models(), SYSTEMONE, ctx)
    monkeypatch.setenv("KEV_BASE_URL", url)
    client = fixture_client(make_client)
    after_start()
    response, elapsed = timed_post(client, "/kev", kev_request("FX-01"))
    assert (kev_outcome(response), elapsed < LIMIT) == (KEV_UNAVAILABLE, True), (
        f"소요 {elapsed:.2f}s"
    )


@pytest.mark.parametrize("stall", E2E_STALLS)
def test_extract_stalled_model_server_is_qwen_unavailable_within_budget(
    make_client, monkeypatch, local_models, raw_server, fake_server, stall
):
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    ctx = (raw_server, fake_server, monkeypatch)
    url, after_start = stalled_model_server(stall, vllm_models(QWEN_RUN), COMPLETIONS, ctx)
    monkeypatch.setenv("QWEN_BASE_URL", url)
    client = fixture_client(make_client)
    after_start()
    response, elapsed = timed_post(client, "/extract", extract_request("FX-01"))
    assert (extract_outcome(response), elapsed < LIMIT) == (QWEN_UNAVAILABLE, True), (
        f"소요 {elapsed:.2f}s"
    )


def test_kev_self_signed_model_server_is_kev_unavailable(
    make_client, monkeypatch, local_models, tls_server
):
    server = tls_server().route("GET", MODELS, Reply(json_body=kev_models()))
    server.route("POST", SYSTEMONE, Reply(json_body=kev_answer()))
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    monkeypatch.setenv("KEV_BASE_URL", server.url)
    client = fixture_client(make_client)
    response, elapsed = timed_post(client, "/kev", kev_request("FX-01"))
    assert (
        kev_outcome(response),
        elapsed < LIMIT,
        server.wait_for_tls_failure(2.0),
        server.requests,
    ) == (KEV_UNAVAILABLE, True, True, [])


def test_extract_self_signed_model_server_is_qwen_unavailable(
    make_client, monkeypatch, local_models, tls_server
):
    server = tls_server().route("GET", MODELS, Reply(json_body=vllm_models(QWEN_RUN)))
    server.route("POST", COMPLETIONS, completion(extraction_output("FX-01")))
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    monkeypatch.setenv("QWEN_BASE_URL", server.url)
    client = fixture_client(make_client)
    response, elapsed = timed_post(client, "/extract", extract_request("FX-01"))
    assert (
        extract_outcome(response),
        elapsed < LIMIT,
        server.wait_for_tls_failure(2.0),
        server.requests,
    ) == (QWEN_UNAVAILABLE, True, True, [])


# ================================================================ R2 넘치는 수(1e999 등)

OVERFLOWING = {
    "exp_1e999": "1e999",
    "negative_exp_1e999": "-1e999",
    "upper_exp_1E400": "1E400",
    "int_309_nines": "9" * 309,
    # float 로 바꿀 때 넘치는 가장 작은 2의 거듭제곱(309자리)
    "int_2_pow_1024": str(2**1024),
}
FINITE = {
    "exp_1e308": ("1e308", 1e308),
    "negative_exp_1e308": ("-1e308", -1e308),
    # float 최댓값과 같은 정수(309자리). float() 가 넘치지 않으므로 통과한다
    "int_float_max": (str(int(sys.float_info.max)), int(sys.float_info.max)),
}


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_overflowing_number_is_rejected_by_strict_json(case):
    with pytest.raises(ValueError):
        strict_json.loads(f'{{"value": {OVERFLOWING[case]}}}')


@pytest.mark.parametrize("case", sorted(FINITE))
def test_large_finite_number_is_parsed_by_strict_json(case):
    text, value = FINITE[case]
    assert strict_json.loads(f'{{"value": {text}}}') == {"value": value}


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_overflowing_number_in_model_output_is_retried_as_json_parse_failure(
    make_client, local_models, case
):
    response = run_extract(
        make_client,
        local_models,
        completion(model_output_with_extra(OVERFLOWING[case])),
        completion(extraction_output("FX-01")),
    )
    retries = (
        response.json()["payload"]["model"]["retries"] if response.status_code == 200 else None
    )
    assert (extract_outcome(response), retries, user_tails(local_models)) == (
        EXTRACTED,
        1,
        ["", RETRY_NOTE + "JSON 파싱 실패"],
    )


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_overflowing_number_in_model_output_twice_is_extraction_failed(
    make_client, local_models, case
):
    reply = completion(model_output_with_extra(OVERFLOWING[case]))
    response = run_extract(make_client, local_models, reply, reply)
    assert (extract_outcome(response), len(local_models.qwen.calls("POST", COMPLETIONS))) == (
        EXTRACTION_FAILED,
        2,
    )


@pytest.mark.parametrize("case", sorted(FINITE))
def test_large_finite_number_in_model_output_is_accepted(make_client, local_models, case):
    reply = completion(model_output_with_extra(FINITE[case][0]))
    response = run_extract(make_client, local_models, reply)
    assert (extract_outcome(response), len(local_models.qwen.calls("POST", COMPLETIONS))) == (
        EXTRACTED,
        1,
    )


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_qwen_reply_envelope_with_overflowing_number_is_not_read(make_client, local_models, case):
    envelope = with_extra(chat_completion(extraction_output("FX-01")), OVERFLOWING[case])
    response = run_extract(make_client, local_models, raw_reply(envelope))
    assert extract_outcome(response) == EXTRACTION_FAILED


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_kev_reply_with_overflowing_number_is_kev_unavailable(make_client, local_models, case):
    response = run_kev(
        make_client, local_models, raw_reply(with_extra(kev_answer(), OVERFLOWING[case]))
    )
    assert kev_outcome(response) == KEV_UNAVAILABLE


@pytest.mark.parametrize("case", sorted(FINITE))
def test_kev_reply_with_large_finite_number_is_read(make_client, local_models, case):
    response = run_kev(
        make_client, local_models, raw_reply(with_extra(kev_answer(), FINITE[case][0]))
    )
    assert kev_outcome(response) == KEV_READ


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_qwen_registry_reply_with_overflowing_number_is_unconfirmed(
    make_client, local_models, case
):
    # 다른 모델만 있는 목록이지만 읽을 수 없는 JSON 이다 → 미확인이라 기동한다(불일치 거부가 아니다)
    body = with_extra(vllm_models("Qwen/other-model"), OVERFLOWING[case])
    local_models.qwen.route("GET", MODELS, raw_reply(body))
    client = fixture_client(make_client)
    assert client.get("/health").json()["qwen"]["model"] == QWEN_RUN


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_kev_registry_reply_with_overflowing_number_is_unconfirmed(make_client, local_models, case):
    body = with_extra(kev_models("runs/other"), OVERFLOWING[case])
    local_models.kev.route("GET", MODELS, raw_reply(body))
    client = fixture_client(make_client)
    assert client.get("/health").json()["kev"]["registryMatch"] is None


@pytest.mark.parametrize("case", sorted(OVERFLOWING))
def test_mock_extract_fixture_with_overflowing_number_is_extraction_failed(
    make_client, custom_fixtures, case
):
    # mock 도 모델 응답 원문(fixture)을 같은 파싱으로 읽는다(3e 재현: withinYears=1e999 가 200 COMPLETED)
    fixture = extraction_fixture("FX-01")
    root = custom_fixtures(extractions={"FX-01": fixture})
    path = root / "extractions" / "FX-01.json"
    path.write_text(with_extra(fixture, OVERFLOWING[case]), encoding="utf-8")
    client = make_client(raise_server_exceptions=False)
    response = client.post("/extract", json=extract_request("FX-01"))
    assert extract_outcome(response) == EXTRACTION_FAILED


# ================================================================ R3 JSON 중첩 깊이 상한(128)

MAX_DEPTH = 128


def nested_arrays(depth: int) -> str:
    return "[" * depth + "]" * depth


def nested_objects(depth: int) -> str:
    return '{"a":' * depth + "null" + "}" * depth


def nested_mixed(depth: int) -> str:
    opens = "".join('{"a":' if level % 2 else "[" for level in range(depth))
    closes = "".join("}" if level % 2 else "]" for level in reversed(range(depth)))
    return opens + "null" + closes


NESTINGS = {"arrays": nested_arrays, "objects": nested_objects, "mixed": nested_mixed}


def test_max_json_depth_is_128():
    assert strict_json.MAX_JSON_DEPTH == MAX_DEPTH


@pytest.mark.parametrize("shape", sorted(NESTINGS))
def test_json_at_max_depth_is_parsed(shape):
    text = NESTINGS[shape](MAX_DEPTH)
    assert strict_json.loads(text) == json.loads(text)


@pytest.mark.parametrize("shape", sorted(NESTINGS))
def test_json_one_past_max_depth_is_rejected(shape):
    with pytest.raises(ValueError):
        strict_json.loads(NESTINGS[shape](MAX_DEPTH + 1))


def test_json_5000_deep_is_rejected():
    # 표준 json 은 이 깊이를 읽는다(RecursionError 가 나지 않는다). 상한으로 거절해야 한다
    with pytest.raises(ValueError):
        strict_json.loads(nested_arrays(5000))


def test_brackets_inside_strings_are_not_counted():
    text = json.dumps({"text": "[{" * 3000, "more": ["]}" * 3000]})
    assert strict_json.loads(text) == json.loads(text)


def test_escaped_quote_does_not_end_string_for_depth_count():
    # 문자열 값: \" 뒤 "[" 3000개. 이스케이프된 따옴표를 문자열 끝으로 보면 괄호 3000개를 센다
    text = '{"text": "\\" ' + "[" * 3000 + '"}'
    assert strict_json.loads(text) == {"text": '" ' + "[" * 3000}


@pytest.mark.parametrize(
    "inner, accepted", [(MAX_DEPTH - 1, True), (MAX_DEPTH, False)], ids=["depth_128", "depth_129"]
)
def test_escaped_backslash_before_quote_ends_string_for_depth_count(inner, accepted):
    # ["\\", [[...]]]: 문자열은 역슬래시 하나이고 따옴표에서 끝난다. \\" 를 이스케이프된 따옴표로 보면 뒤 괄호를 세지 않는다
    text = '["\\\\", ' + nested_arrays(inner) + "]"
    try:
        strict_json.loads(text)
        parsed = True
    except ValueError:
        parsed = False
    assert parsed is accepted


DEEP = nested_arrays(5000)


def test_kev_reply_5000_deep_is_kev_unavailable_not_500(make_client, local_models):
    # 고치기 전에는 파싱은 되고 응답 직렬화(wire)에서 깊이 때문에 500 이다(K9 위반)
    response = run_kev(make_client, local_models, raw_reply(with_extra(kev_answer(), DEEP)))
    assert kev_outcome(response) == KEV_UNAVAILABLE


@pytest.mark.parametrize(
    "inner, outcome",
    [(MAX_DEPTH - 1, KEV_READ), (MAX_DEPTH, KEV_UNAVAILABLE)],
    ids=["depth_128", "depth_129"],
)
def test_kev_reply_depth_boundary(make_client, local_models, inner, outcome):
    # 최상위 객체 1단 + "extra" 배열 inner 단 = 전체 깊이 inner + 1
    reply = raw_reply(with_extra(kev_answer(), nested_arrays(inner)))
    assert kev_outcome(run_kev(make_client, local_models, reply)) == outcome


def test_kev_reply_with_brackets_inside_strings_is_read(make_client, local_models):
    reply = raw_reply(with_extra(kev_answer(), json.dumps("[{" * 3000)))
    assert kev_outcome(run_kev(make_client, local_models, reply)) == KEV_READ


def test_model_output_5000_deep_twice_is_extraction_failed(make_client, local_models):
    reply = completion(model_output_with_extra(DEEP))
    response = run_extract(make_client, local_models, reply, reply)
    assert (extract_outcome(response), len(local_models.qwen.calls("POST", COMPLETIONS))) == (
        EXTRACTION_FAILED,
        2,
    )


def test_model_output_5000_deep_is_retried_as_json_parse_failure(make_client, local_models):
    response = run_extract(
        make_client,
        local_models,
        completion(model_output_with_extra(DEEP)),
        completion(extraction_output("FX-01")),
    )
    retries = (
        response.json()["payload"]["model"]["retries"] if response.status_code == 200 else None
    )
    assert (extract_outcome(response), retries, user_tails(local_models)) == (
        EXTRACTED,
        1,
        ["", RETRY_NOTE + "JSON 파싱 실패"],
    )


def test_qwen_reply_envelope_5000_deep_is_not_read(make_client, local_models):
    envelope = with_extra(chat_completion(extraction_output("FX-01")), DEEP)
    response = run_extract(make_client, local_models, raw_reply(envelope))
    assert extract_outcome(response) == EXTRACTION_FAILED


def test_kev_registry_reply_5000_deep_is_unconfirmed(make_client, local_models):
    local_models.kev.route("GET", MODELS, raw_reply(with_extra(kev_models("runs/other"), DEEP)))
    client = fixture_client(make_client)
    assert client.get("/health").json()["kev"]["registryMatch"] is None


# ================================================================ R4 charset 이 이상한 응답

ODD_CHARSETS = ["base64", "rot13", "x-no-such-charset"]
# 실제 글자 인코딩이지만 본문은 UTF-8 이다. charset 을 따르면 글자가 깨진다
OTHER_TEXT_CHARSETS = ["iso-8859-1", "utf-16"]
UTF8_BODY = {"message": "한글 응답", "data": []}


def charset_reply(body: object, charset: str) -> Reply:
    return Reply(json_body=body, content_type=f"application/json; charset={charset}")


@pytest.mark.parametrize("charset", ODD_CHARSETS + OTHER_TEXT_CHARSETS)
def test_call_reads_body_as_utf8_whatever_the_charset(fake_server, charset):
    server = fake_server().route("GET", MODELS, charset_reply(UTF8_BODY, charset))
    reply = http.call(endpoint(server.url), "GET", MODELS, deadline=new_deadline(5.0))
    assert reply.text == json.dumps(UTF8_BODY, ensure_ascii=False)


@pytest.mark.parametrize("charset", ["iso-8859-1", "rot13"])
def test_call_replaces_invalid_utf8_bytes_whatever_the_charset(fake_server, charset):
    reply = Reply(raw_body=b'{"a":"\xff"}', content_type=f"application/json; charset={charset}")
    server = fake_server().route("GET", MODELS, reply)
    text = http.call(endpoint(server.url), "GET", MODELS, deadline=new_deadline(5.0)).text
    assert text == '{"a":"�"}'


@pytest.mark.parametrize("charset", ODD_CHARSETS)
def test_kev_reply_with_odd_charset_is_read(make_client, local_models, charset):
    response = run_kev(make_client, local_models, charset_reply(kev_answer(), charset))
    assert kev_outcome(response) == KEV_READ


@pytest.mark.parametrize("charset", ODD_CHARSETS)
def test_qwen_reply_with_odd_charset_is_read(make_client, local_models, charset):
    reply = charset_reply(chat_completion(extraction_output("FX-01")), charset)
    assert extract_outcome(run_extract(make_client, local_models, reply)) == EXTRACTED


def startup_env(qwen_url: str, kev_url: str) -> dict[str, str]:
    return {
        "SOL_RUN_MODE": "fixture",
        "QWEN_BASE_URL": qwen_url,
        "QWEN_API_KEY": QWEN_KEY,
        "KEV_BASE_URL": kev_url,
        "KEV_API_KEY": KEV_KEY,
    }


@pytest.mark.parametrize("charset", ODD_CHARSETS)
def test_startup_registry_replies_with_odd_charset_match(fake_server, charset):
    qwen = fake_server().route("GET", MODELS, charset_reply(vllm_models(QWEN_RUN), charset))
    kev = fake_server().route("GET", MODELS, charset_reply(kev_models(), charset))
    result = run_main(startup_env(qwen.url, kev.url))
    assert (result.returncode, "Traceback" in result.stderr, "기동 거부" in result.stderr) == (
        0,
        False,
        False,
    )


@pytest.mark.parametrize("charset", ODD_CHARSETS)
def test_startup_qwen_registry_mismatch_with_odd_charset_is_refused(fake_server, charset):
    # 대조 응답을 실제로 읽는지: 다른 모델만 있으면 불일치 거부다
    qwen = fake_server().route(
        "GET", MODELS, charset_reply(vllm_models("Qwen/other-model"), charset)
    )
    kev = fake_server().route("GET", MODELS, Reply(json_body=kev_models()))
    result = run_main(startup_env(qwen.url, kev.url))
    assert (
        result.returncode,
        "QWEN_MODEL(REGISTRY_MISMATCH)" in result.stderr,
        "Traceback" in result.stderr,
    ) == (EX_CONFIG, True, False)


@pytest.mark.parametrize("charset", ODD_CHARSETS)
def test_kev_registry_reply_with_odd_charset_is_matched(make_client, local_models, charset):
    local_models.kev.route("GET", MODELS, charset_reply(kev_models(), charset))
    client = fixture_client(make_client)
    assert client.get("/health").json()["kev"]["registryMatch"] is True


# ================================================================ R5 잘못된 퓨니코드 URL

SECRET_LABEL = "secretlabel"
BAD_PUNYCODE_URLS = {
    "trailing_hyphen": "https://xn--secretlabel-.com/",
    "uppercase_prefix": "https://XN--secretlabel-.com/sol-radar/qwen",
    "invalid_a_label": "https://xn--secretlabel-9x.com/",
    "combining_mark_first": "https://xn--secretlabel.com/",
    "http_with_port": "http://xn--secretlabel-:8000/",
}


@pytest.mark.parametrize("case", sorted(BAD_PUNYCODE_URLS))
def test_bad_punycode_host_is_insecure_url(case):
    assert http.url_problems(BAD_PUNYCODE_URLS[case], [COMPANY_HOST]) == ["INSECURE_URL"]


@pytest.mark.parametrize("key", ["QWEN_BASE_URL", "KEV_BASE_URL"])
@pytest.mark.parametrize("case", sorted(BAD_PUNYCODE_URLS))
def test_bad_punycode_url_refusal_is_key_and_reason_only(
    make_client, monkeypatch, caplog, key, case
):
    caplog.set_level(logging.DEBUG)
    env = {**startup_env(closed_url(), closed_url()), key: BAD_PUNYCODE_URLS[case]}
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(StartupRefused) as refused:
        make_client(SOL_RUN_MODE="fixture")
    assert (refused.value.summary, SECRET_LABEL in caplog.text.lower()) == (
        f"{key}(INSECURE_URL)",
        False,
    )


@pytest.mark.parametrize("key", ["QWEN_BASE_URL", "KEV_BASE_URL"])
def test_bad_punycode_url_exits_78_without_traceback_or_label(key):
    # 명세 R5 예시 URL. 고치기 전에는 try 밖 호스트 접근에서 IDNAError → exit 1 + traceback
    env = {**startup_env(closed_url(), closed_url()), key: BAD_PUNYCODE_URLS["trailing_hyphen"]}
    result = run_main(env)
    output = (result.stdout + result.stderr).lower()
    assert (
        result.returncode,
        f"기동 거부: {key}(INSECURE_URL)" in result.stderr,
        "traceback" in output,
        SECRET_LABEL in output,
    ) == (EX_CONFIG, True, False, False)


# 표준 라이브러리 urlsplit 이 ValueError(UnicodeError 아님)로 거절하는 대괄호 호스트(구현 뒤 검증에서 더함).
# 해석 예외를 UnicodeError·httpx.InvalidURL 로만 잡으면 이 ValueError 가 기동을 traceback 으로 죽인다
BRACKET_URLS = {
    "unclosed_ipv6": "https://[::1/",
    "bracketed_name": "https://[acropolissg.com]/sol-radar",
    # urlsplit 만 거절하고 httpx 는 받는다
    "unclosed_loopback_http": "http://[127.0.0.1/",
}


@pytest.mark.parametrize("case", sorted(BRACKET_URLS))
def test_url_the_standard_parser_rejects_is_insecure_url(case):
    assert http.url_problems(BRACKET_URLS[case], [COMPANY_HOST]) == ["INSECURE_URL"]


@pytest.mark.parametrize("key", ["QWEN_BASE_URL", "KEV_BASE_URL"])
def test_url_the_standard_parser_rejects_is_refused_with_key_and_reason(
    make_client, monkeypatch, key
):
    env = {
        **startup_env(closed_url(), closed_url()),
        key: BRACKET_URLS["unclosed_loopback_http"],
    }
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(StartupRefused) as refused:
        make_client(SOL_RUN_MODE="fixture")
    assert refused.value.summary == f"{key}(INSECURE_URL)"


# ================================================================ R1 핸드셰이크 뒤 TLS 스트림(구현 뒤 검증에서 더함)
# 제품 ssl_context 를 "검증·호스트 이름 검사를 켠 채 시험 CA(임시 폴더 자체 서명)를 더 믿는 context" 로 바꿔 끼운다.
# 바꿔 끼운 함수도 제품 ssl_context() 를 먼저 부르므로, 제품 설정(trust_env=False·keylog 끔)은 그대로 시험된다.
# 검증을 끄는 코드(CERT_NONE·check_hostname 끄기)는 쓰지 않는다.


class HandshakeHook:
    """TLS 핸드셰이크가 끝난 직후(클라이언트 쪽) then() 을 부르는 SSLSocket 갈래. SSLContext.sslsocket_class 로 붙인다."""

    def __init__(self, then=None) -> None:
        self.count = 0
        hook = self

        class HookedSocket(ssl.SSLSocket):
            def do_handshake(self, block: bool = False) -> None:
                super().do_handshake(block)
                hook.count += 1
                if then is not None:
                    then()

        self.socket_class = HookedSocket


def trust_test_ca(monkeypatch, cert, hook: HandshakeHook | None = None) -> list:
    """http.ssl_context 를 제품 context + 시험 CA 로 바꿔 끼운다. 만든 context 목록을 돌려준다(전제 확인용)."""
    product = http.ssl_context
    made: list[ssl.SSLContext] = []

    def trusting() -> ssl.SSLContext:
        context = product()
        context.load_verify_locations(cafile=str(cert))
        if hook is not None:
            context.sslsocket_class = hook.socket_class
        made.append(context)
        return context

    monkeypatch.setattr(http, "ssl_context", trusting)
    return made


def verification_on(contexts: list) -> bool:
    return bool(contexts) and all(
        c.verify_mode == ssl.CERT_REQUIRED and c.check_hostname for c in contexts
    )


@pytest.fixture(scope="session")
def localhost_only_certificate(tmp_path_factory) -> tuple:
    """subjectAltName 이 DNS:localhost 하나뿐인 자체 서명 인증서(127.0.0.1 로 붙으면 호스트 이름이 다르다)."""
    return self_signed_certificate(
        tmp_path_factory.mktemp("localhost-only-tls"),
        common_name="localhost",
        alt_names="DNS:localhost",
    )


def tls_raw_server(raw_server, certificate, behavior) -> tuple:
    """TLS 핸드셰이크 뒤 behavior 를 도는 RawServer 와 핸드셰이크 완료 이벤트."""
    handshakes = threading.Event()
    server = raw_server(over_tls(behavior, server_tls_context(*certificate), handshakes))
    return server, handshakes


def test_trusted_test_ca_call_succeeds_with_verification_on(tls_server, certificate, monkeypatch):
    # 전제: 바꿔 끼운 context 로는 TLS 가 끝까지 되고 응답을 읽는다. 검증과 호스트 이름 검사는 켜져 있다
    contexts = trust_test_ca(monkeypatch, certificate[0])
    server = tls_server().route("GET", MODELS, Reply(json_body=vllm_models(QWEN_RUN)))
    reply = http.call(endpoint(server.url), "GET", MODELS, deadline=new_deadline(5.0))
    assert (reply.status, json.loads(reply.text), verification_on(contexts)) == (
        200,
        vllm_models(QWEN_RUN),
        True,
    )


def test_call_cuts_header_drip_over_tls_at_deadline(raw_server, certificate, monkeypatch):
    # TLS 를 끝낸 뒤 상태 줄을 바로, 헤더는 100ms 마다 1바이트. TLS 스트림의 read 가 남은 시간을 쓰지 않으면
    # (start_tls 가 돌려준 스트림을 감싸지 않으면) 헤더 읽기 timeout 이 recv 마다 새로 시작해 서버가 닫는 4초 뒤에 끝난다
    contexts = trust_test_ca(monkeypatch, certificate[0])
    server, handshakes = tls_raw_server(
        raw_server, certificate, by_route({}, default=drip_headers(0.1, STALL_FOR))
    )
    message, elapsed = failed_call(server.https_url)
    assert (
        is_reason_name(message),
        elapsed < LIMIT,
        handshakes.is_set(),
        server.requests,
        verification_on(contexts),
    ) == (True, True, True, [("GET", MODELS)], True), f"소요 {elapsed:.2f}s"


def test_call_cuts_body_drip_over_tls_pausing_just_under_the_budget(
    tls_server, certificate, monkeypatch
):
    # TLS 위에서 본문을 요청 시작부터 0.95초마다 1바이트. 감싸지 않은 TLS 스트림은 본문 읽기 timeout(단계 시작 때
    # 남은 약 1.0s)을 recv 마다 다시 써서 다음 바이트(약 1.9s)까지 기다린다
    contexts = trust_test_ca(monkeypatch, certificate[0])
    server = tls_server()
    server.route("GET", MODELS, body_drip())
    message, elapsed = failed_call(server.url)
    assert (
        is_reason_name(message),
        elapsed < LIMIT,
        len(server.requests),
        verification_on(contexts),
    ) == (True, True, 1, True), f"소요 {elapsed:.2f}s"


def test_call_does_not_send_request_over_tls_after_handshake_used_up_the_deadline(
    raw_server, certificate, monkeypatch
):
    # 핸드셰이크가 끝난 직후 주입 시계가 마감을 넘긴다. TLS 스트림의 write 도 마감을 보므로 요청 바이트(풀린 응용
    # 데이터)를 하나도 쓰지 않는다. 감싸지 않으면 연결 시작 때의 남은 시간(5초)으로 요청을 보낸다
    clock = FakeClock()
    hook = HandshakeHook(then=lambda: clock.advance(10.0))
    contexts = trust_test_ca(monkeypatch, certificate[0], hook)
    server, handshakes = tls_raw_server(raw_server, certificate, silent(2.0))
    message, _ = failed_call(server.https_url, new_deadline(5.0, clock))
    assert (
        is_reason_name(message),
        hook.count,
        handshakes.wait(1.0),
        server.wait_for_bytes(1.0),
        verification_on(contexts),
    ) == (True, 1, True, False, True)


def test_call_stops_reading_over_tls_once_no_time_is_left(raw_server, certificate, monkeypatch):
    # TLS 위에서 상태 줄을 보낸 직후 주입 시계가 마감을 넘긴다. TLS 스트림의 다음 read 는 기다리지 않는다.
    # 감싸지 않으면 헤더 읽기 단계 시작 때의 남은 시간(5초)을 recv 마다 써서 서버가 닫는 4초 뒤에 끝난다
    clock = FakeClock()
    contexts = trust_test_ca(monkeypatch, certificate[0])
    writer = drip_headers(
        0.1, STALL_FOR, delay_before=0.2, after_status=lambda: clock.advance(10.0)
    )
    server, handshakes = tls_raw_server(raw_server, certificate, by_route({}, default=writer))
    message, elapsed = failed_call(server.https_url, new_deadline(5.0, clock))
    assert (
        is_reason_name(message),
        elapsed < 2.0,
        handshakes.is_set(),
        server.requests,
        verification_on(contexts),
    ) == (True, True, True, [("GET", MODELS)], True), f"소요 {elapsed:.2f}s"


def test_call_checks_host_name_even_for_a_trusted_certificate(
    raw_server, localhost_only_certificate, monkeypatch
):
    # 인증서(DNS:localhost 만)를 믿어도 127.0.0.1 로 붙으면 호스트 이름이 달라 실패해야 한다(호스트 이름 검사 켜짐).
    # 전제: 같은 서버에 localhost 로 붙으면 성공한다(인증서 신뢰는 맞다)
    contexts = trust_test_ca(monkeypatch, localhost_only_certificate[0])
    handshakes = threading.Event()
    routes = {("GET", MODELS): json_reply(vllm_models(QWEN_RUN))}
    behavior = over_tls(
        by_route(routes), server_tls_context(*localhost_only_certificate), handshakes
    )
    server = raw_server(behavior)
    by_name = http.call(
        endpoint(f"https://localhost:{server.port}"), "GET", MODELS, deadline=new_deadline(5.0)
    )
    handshakes.clear()
    message, _ = failed_call(server.https_url, new_deadline(5.0))
    assert (
        by_name.status,
        is_reason_name(message),
        handshakes.wait(0.5),
        server.requests,
        verification_on(contexts),
    ) == (200, True, False, [("GET", MODELS)], True)


def test_ssl_context_does_not_log_session_keys(monkeypatch, tmp_path):
    monkeypatch.setenv("SSLKEYLOGFILE", str(tmp_path / "keys.log"))
    assert http.ssl_context().keylog_filename is None


def secret_lines(keylog) -> list[str]:
    """키 로그 파일의 비밀 줄(# 머리말 밖). 파일이 없으면 빈 목록."""
    if not keylog.exists():
        return []
    lines = keylog.read_text(encoding="utf-8").splitlines()
    return [line for line in lines if line and not line.startswith("#")]


def test_tls_call_writes_no_session_key_log(tls_server, certificate, monkeypatch, tmp_path):
    # SSLKEYLOGFILE 이 있어도 세션 키를 쓰지 않는다(ssl 표준 라이브러리 기본은 쓴다). 표준 라이브러리가 context 를
    # 만들 때 그 경로에 "#" 머리말 한 줄짜리 파일을 먼저 만들 수는 있다(키는 없다)
    keylog = tmp_path / "keys.log"
    monkeypatch.setenv("SSLKEYLOGFILE", str(keylog))
    trust_test_ca(monkeypatch, certificate[0])
    server = tls_server().route("GET", MODELS, Reply(json_body=vllm_models(QWEN_RUN)))
    reply = http.call(endpoint(server.url), "GET", MODELS, deadline=new_deadline(5.0))
    assert (reply.status, secret_lines(keylog)) == (200, [])


TLS_E2E_STALLS = ["tls_header_drip", "tls_body_drip"]


def trusted_stalled_model_server(stall, models_body, post_path, ctx) -> tuple:
    """TLS(시험 CA 신뢰) 모델 서버의 기준 URL 과, 앱 기동 뒤 부를 함수. GET /v1/models 는 정상, POST 가 멈춘다."""
    raw_server, tls_server, certificate = ctx
    if stall == "tls_header_drip":
        routes = {("GET", MODELS): json_reply(models_body)}
        behavior = by_route(routes, default=drip_headers(0.1, STALL_FOR))
        server = raw_server(over_tls(behavior, server_tls_context(*certificate)))
        return server.https_url, lambda: None
    server = tls_server().route("GET", MODELS, Reply(json_body=models_body))
    return server.url, lambda: server.route("POST", post_path, body_drip())


@pytest.mark.parametrize("stall", TLS_E2E_STALLS)
def test_kev_trusted_tls_model_server_stalling_after_handshake_is_cut_within_budget(
    make_client, monkeypatch, local_models, raw_server, tls_server, certificate, stall
):
    contexts = trust_test_ca(monkeypatch, certificate[0])
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    ctx = (raw_server, tls_server, certificate)
    url, after_start = trusted_stalled_model_server(stall, kev_models(), SYSTEMONE, ctx)
    monkeypatch.setenv("KEV_BASE_URL", url)
    client = fixture_client(make_client)
    registry = client.get("/health").json()["kev"]["registryMatch"]
    after_start()
    response, elapsed = timed_post(client, "/kev", kev_request("FX-01"))
    assert (kev_outcome(response), elapsed < LIMIT, registry, verification_on(contexts)) == (
        KEV_UNAVAILABLE,
        True,
        True,
        True,
    ), f"소요 {elapsed:.2f}s"


@pytest.mark.parametrize("stall", TLS_E2E_STALLS)
def test_extract_trusted_tls_model_server_stalling_after_handshake_is_cut_within_budget(
    make_client, monkeypatch, local_models, raw_server, tls_server, certificate, stall
):
    contexts = trust_test_ca(monkeypatch, certificate[0])
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    ctx = (raw_server, tls_server, certificate)
    url, after_start = trusted_stalled_model_server(stall, vllm_models(QWEN_RUN), COMPLETIONS, ctx)
    monkeypatch.setenv("QWEN_BASE_URL", url)
    client = fixture_client(make_client)
    after_start()
    response, elapsed = timed_post(client, "/extract", extract_request("FX-01"))
    assert (extract_outcome(response), elapsed < LIMIT, verification_on(contexts)) == (
        QWEN_UNAVAILABLE,
        True,
        True,
    ), f"소요 {elapsed:.2f}s"


# ================================================================ R1 래퍼 단위(가짜 inner·주입 시계, 구현 뒤 검증에서 더함)
# DeadlineNetworkBackend(deadline, inner=...)·DeadlineNetworkStream(inner, deadline) 을 가짜 inner 로 결정적으로 본다.
# 시계는 FakeClock(1000.0 에서 시작)이고 이동량은 이진수로 정확한 값(0.25 배수)만 써서 timeout 을 == 로 비교한다.

TIMEOUT_ERRORS = {
    "read": httpcore.ReadTimeout,
    "write": httpcore.WriteTimeout,
    "start_tls": httpcore.ConnectTimeout,
    "connect_tcp": httpcore.ConnectTimeout,
}
TLS_SENTINEL = object()


class InnerStream(httpcore.NetworkStream):
    """가짜 inner 스트림. 조작마다 (이름, 조작, timeout, …) 을 log 에 남기고 시계를 cost 초 옮긴다."""

    def __init__(self, clock, log: list, name: str = "tcp", cost: float = 0.0, tls=None) -> None:
        self._clock = clock
        self._log = log
        self._name = name
        self._cost = cost
        self.tls = tls

    def _spend(self) -> None:
        self._clock.advance(self._cost)

    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        self._log.append((self._name, "read", timeout))
        self._spend()
        return b"data"

    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self._log.append((self._name, "write", timeout, bytes(buffer)))
        self._spend()

    def close(self) -> None:
        self._log.append((self._name, "close"))

    def start_tls(self, ssl_context, server_hostname=None, timeout=None) -> httpcore.NetworkStream:
        self._log.append((self._name, "start_tls", timeout, ssl_context, server_hostname))
        self._spend()
        return self.tls

    def get_extra_info(self, info: str):
        return (self._name, info)


class InnerBackend(httpcore.NetworkBackend):
    """가짜 inner 백엔드. connect_tcp 를 log 에 남기고, failures 에 든 주소는 시계를 옮긴 뒤 그 예외를 낸다."""

    def __init__(self, clock, log: list, failures: dict | None = None) -> None:
        self._clock = clock
        self._log = log
        self._failures = failures or {}
        self.streams: list[InnerStream] = []

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self._log.append(("connect_tcp", host, port, timeout, local_address, socket_options))
        if host in self._failures:
            cost, error = self._failures[host]
            self._clock.advance(cost)
            raise error
        stream = InnerStream(self._clock, self._log)
        self.streams.append(stream)
        return stream


ADDRESSES = ["::1", "127.0.0.1"]


def fake_getaddrinfo(monkeypatch, addresses=ADDRESSES) -> list:
    """socket.getaddrinfo 를 addresses 를 차례로 돌려주는 가짜로 바꾼다. 받은 (host, port) 를 기록한다."""
    asked: list = []

    def getaddrinfo(host, port, *args, **kwargs):
        asked.append((host, port))
        return [
            (
                socket.AF_INET6 if ":" in a else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (a, port, 0, 0) if ":" in a else (a, port),
            )
            for a in addresses
        ]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    return asked


def wrapped_stream(seconds: float = 5.0, cost: float = 0.0):
    """(래퍼, inner, inner TLS, log, clock). 마감은 지금부터 seconds 초."""
    clock, log = FakeClock(), []
    tls = InnerStream(clock, log, "tls", cost)
    inner = InnerStream(clock, log, "tcp", cost, tls=tls)
    return http.DeadlineNetworkStream(inner, new_deadline(seconds, clock)), inner, tls, log, clock


def do_op(target, op: str, timeout):
    """래퍼의 조작 하나를 부른다(connect_tcp 는 백엔드, 나머지는 스트림)."""
    if op == "read":
        return target.read(10, timeout)
    if op == "write":
        return target.write(b"abc", timeout)
    if op == "start_tls":
        return target.start_tls(TLS_SENTINEL, "model.test", timeout)
    return target.connect_tcp("localhost", 8443, timeout)


def timeouts_seen(log: list, op: str) -> list:
    if op == "connect_tcp":
        return [entry[3] for entry in log if entry[0] == "connect_tcp"]
    return [entry[2] for entry in log if entry[1] == op]


def op_target(op: str, monkeypatch, seconds: float = 5.0):
    """(래퍼 또는 백엔드, log, clock)."""
    if op == "connect_tcp":
        fake_getaddrinfo(monkeypatch, ["127.0.0.1"])
        clock, log = FakeClock(), []
        backend = http.DeadlineNetworkBackend(
            new_deadline(seconds, clock), inner=InnerBackend(clock, log)
        )
        return backend, log, clock
    stream, _, _, log, clock = wrapped_stream(seconds)
    return stream, log, clock


OPS = ["read", "write", "start_tls", "connect_tcp"]


@pytest.mark.parametrize("op", OPS)
@pytest.mark.parametrize(
    "given, elapsed, expected",
    [(None, 0.0, 5.0), (10.0, 0.0, 5.0), (2.0, 0.0, 2.0), (2.0, 4.5, 0.5), (None, 4.75, 0.25)],
    ids=["none_full", "longer_full", "shorter_kept", "shorter_cut", "none_cut"],
)
def test_wrapper_passes_min_of_given_timeout_and_time_left(
    monkeypatch, op, given, elapsed, expected
):
    target, log, clock = op_target(op, monkeypatch)
    clock.advance(elapsed)
    do_op(target, op, given)
    assert timeouts_seen(log, op) == [expected]


@pytest.mark.parametrize("op", OPS)
@pytest.mark.parametrize("elapsed", [5.0, 7.5], ids=["exactly_at_deadline", "past_deadline"])
def test_wrapper_raises_timeout_without_calling_inner_once_deadline_passed(
    monkeypatch, op, elapsed
):
    target, log, clock = op_target(op, monkeypatch)
    clock.advance(elapsed)
    with pytest.raises(TIMEOUT_ERRORS[op]):
        do_op(target, op, 10.0)
    assert [entry for entry in log if entry[1:2] != ("close",)] == []


def test_start_tls_without_time_closes_tcp_and_sends_nothing(monkeypatch):
    stream, _, _, log, clock = wrapped_stream(5.0)
    clock.advance(5.0)
    with pytest.raises(httpcore.ConnectTimeout):
        stream.start_tls(TLS_SENTINEL, "model.test", 10.0)
    assert log == [("tcp", "close")]


def test_start_tls_forwards_context_and_host_name():
    stream, _, _, log, _ = wrapped_stream(5.0)
    stream.start_tls(TLS_SENTINEL, "model.test", 10.0)
    assert log == [("tcp", "start_tls", 5.0, TLS_SENTINEL, "model.test")]


def test_start_tls_returns_tls_stream_wrapped_with_the_same_deadline():
    stream, _, tls, log, clock = wrapped_stream(5.0)
    secured = stream.start_tls(TLS_SENTINEL, "model.test", 10.0)
    clock.advance(4.0)
    secured.read(10, 10.0)
    secured.write(b"x", 10.0)
    clock.advance(1.0)
    with pytest.raises(httpcore.ReadTimeout):
        secured.read(10, 10.0)
    with pytest.raises(httpcore.WriteTimeout):
        secured.write(b"y", 10.0)
    assert (secured is not tls, log[1:]) == (
        True,
        [("tls", "read", 1.0), ("tls", "write", 1.0, b"x")],
    )


def test_tls_stream_start_tls_is_wrapped_too():
    # TLS 안의 TLS(프록시 터널용)도 같은 래퍼다. 마감이 지나면 inner TLS 의 start_tls 를 부르지 않고 닫는다
    stream, _, _, log, clock = wrapped_stream(5.0)
    secured = stream.start_tls(TLS_SENTINEL, "model.test", 10.0)
    clock.advance(5.0)
    with pytest.raises(httpcore.ConnectTimeout):
        secured.start_tls(TLS_SENTINEL, "model.test", 10.0)
    assert log[1:] == [("tls", "close")]


def test_wrapper_close_and_extra_info_pass_through():
    stream, _, _, log, _ = wrapped_stream(5.0)
    stream.close()
    assert (stream.get_extra_info("ssl_object"), log) == (("tcp", "ssl_object"), [("tcp", "close")])


# 쓰기 조각 상한(TLS 레코드 최대 크기)
MAX_WRITE_PIECE = 16 * 1024


def written(log: list) -> list:
    return [entry for entry in log if entry[1] == "write"]


def test_write_is_split_into_pieces_each_bounded_by_time_left():
    # 마감 1초, 조각 하나 쓰는 데 0.25초. 조각마다 그 순간의 남은 시간을 준다
    stream, _, _, log, _ = wrapped_stream(1.0, cost=0.25)
    buffer = bytes(range(256)) * (2 * MAX_WRITE_PIECE // 256 + 3)
    stream.write(buffer, 10.0)
    pieces = written(log)
    assert (
        b"".join(entry[3] for entry in pieces),
        [len(entry[3]) <= MAX_WRITE_PIECE for entry in pieces],
        [entry[2] for entry in pieces],
    ) == (buffer, [True, True, True], [1.0, 0.75, 0.5])


def test_write_stops_between_pieces_once_deadline_passed():
    # 조각 하나에 0.5초. 두 조각 뒤 마감이 지나 셋째 조각은 쓰지 않는다
    stream, _, _, log, _ = wrapped_stream(1.0, cost=0.5)
    buffer = b"z" * (2 * MAX_WRITE_PIECE + 100)
    with pytest.raises(httpcore.WriteTimeout):
        stream.write(buffer, 10.0)
    assert [(len(entry[3]), entry[2]) for entry in written(log)] == [
        (MAX_WRITE_PIECE, 1.0),
        (MAX_WRITE_PIECE, 0.5),
    ]


def backend_with(monkeypatch, failures=None, seconds: float = 1.0, addresses=ADDRESSES):
    asked = fake_getaddrinfo(monkeypatch, addresses)
    clock, log = FakeClock(), []
    inner = InnerBackend(clock, log, failures)
    backend = http.DeadlineNetworkBackend(new_deadline(seconds, clock), inner=inner)
    return backend, inner, log, clock, asked


def test_connect_tcp_resolves_name_and_connects_address_by_address(monkeypatch):
    # 첫 주소가 0.75초 뒤 실패하면 둘째 주소는 남은 0.25초만 받는다(create_connection 은 주소마다 같은 timeout)
    refused = httpcore.ConnectError("ConnectionRefusedError")
    backend, _, log, _, asked = backend_with(monkeypatch, {"::1": (0.75, refused)})
    options = [(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)]
    backend.connect_tcp("localhost", 8443, 10.0, local_address=None, socket_options=options)
    assert (asked, log) == (
        [("localhost", 8443)],
        [
            ("connect_tcp", "::1", 8443, 1.0, None, options),
            ("connect_tcp", "127.0.0.1", 8443, 0.25, None, options),
        ],
    )


def test_connect_tcp_does_not_try_next_address_once_deadline_passed(monkeypatch):
    slow = httpcore.ConnectTimeout("TimeoutError")
    backend, _, log, _, _ = backend_with(monkeypatch, {"::1": (1.0, slow)})
    with pytest.raises(httpcore.ConnectTimeout):
        backend.connect_tcp("localhost", 8443, 10.0)
    assert [entry[1] for entry in log] == ["::1"]


def test_connect_tcp_raises_last_failure_when_every_address_fails(monkeypatch):
    first = httpcore.ConnectError("first")
    last = httpcore.ConnectError("last")
    backend, _, _, _, _ = backend_with(
        monkeypatch, {"::1": (0.25, first), "127.0.0.1": (0.25, last)}
    )
    with pytest.raises(httpcore.ConnectError) as failure:
        backend.connect_tcp("localhost", 8443, 10.0)
    assert failure.value is last


def test_connect_tcp_name_failure_is_connect_error(monkeypatch):
    def getaddrinfo(*args, **kwargs):
        raise socket.gaierror("no such name")

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    clock, log = FakeClock(), []
    backend = http.DeadlineNetworkBackend(new_deadline(1.0, clock), inner=InnerBackend(clock, log))
    with pytest.raises(httpcore.ConnectError) as failure:
        backend.connect_tcp("model.test", 8443, 10.0)
    assert (str(failure.value), log) == ("gaierror", [])


def test_connect_tcp_without_time_does_not_resolve_or_connect(monkeypatch):
    backend, _, log, clock, asked = backend_with(monkeypatch)
    clock.advance(1.0)
    with pytest.raises(httpcore.ConnectTimeout):
        backend.connect_tcp("localhost", 8443, 10.0)
    assert (asked, log) == ([], [])


def test_connect_tcp_returns_stream_wrapped_with_the_same_deadline(monkeypatch):
    backend, inner, log, clock, _ = backend_with(monkeypatch, addresses=["127.0.0.1"])
    stream = backend.connect_tcp("localhost", 8443, 10.0)
    clock.advance(0.75)
    stream.read(10, 10.0)
    clock.advance(0.25)
    with pytest.raises(httpcore.ReadTimeout):
        stream.read(10, 10.0)
    assert (stream is not inner.streams[0], log[1:]) == (True, [("tcp", "read", 0.25)])


def test_default_inner_backend_is_httpcore_sync_backend(fake_server):
    # inner 를 주지 않으면 실제 소켓(httpcore.SyncBackend)으로 연결한다
    server = fake_server().route("GET", MODELS, Reply(json_body={"ok": True}))
    backend = http.DeadlineNetworkBackend(new_deadline(5.0))
    stream = backend.connect_tcp("127.0.0.1", server.port, 5.0)
    try:
        stream.write(b"GET /v1/models HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n", 5.0)
        head = stream.read(65536, 5.0)
    finally:
        stream.close()
    assert head.split(b" ", 2)[1] == b"200"
