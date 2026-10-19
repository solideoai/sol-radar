"""C5-A 보안 후속 3차 R6(c5/gateway-hardening-3, 기준 480ac63, 3e 재확인 2026-10-20). 구현 전 실패 시험(red).

시험이 기대하는 모양(구현자가 맞춘다):
- Kev 응답 상한: sol_ai.adapters.kev_local.KEV_MAX_RESPONSE_BYTES = 1 * 1024 * 1024(압축을 푼 본문 바이트, 새 이름).
  Kev 의 POST /v1/systemone(v0.1·v0.2 묶음마다)과 GET /v1/models(기동 대조·요청 때 지연 대조)에 쓴다.
  넘으면 TransportFailure("ResponseTooLarge") 다. /kev 는 KEV_UNAVAILABLE, /v1/models 는 미확인(None)이다.
- Qwen 은 지금처럼 http.MAX_RESPONSE_BYTES(4 MiB)다. 추출 호출과 기동 대조 GET /v1/models 모두 같다.
- http.call(endpoint, method, path, *, deadline, json_body=None, max_bytes=MAX_RESPONSE_BYTES)(새 키워드 인자 max_bytes).
  Content-Length·스트림·압축을 푼 크기를 모두 이 상한으로 본다. 넘지 않고 같으면 읽는다. 기본값은 지금 상한(4 MiB) 그대로다.
- strict_json._check_depth(text) 를 빠르게 한다. 같은 프로세스에서 번갈아 잰 CPU 시간(time.process_time)의 중앙값으로 본다.
  - 4 MiB 최악 입력([[[1]]] 반복): _check_depth ≤ 0.3 × json.loads(같은 입력). 명세 문구 그대로다.
  - 4 MiB 문자열이 많은 입력 3종: _check_depth ≤ 0.3 × json.loads(4 MiB 최악 입력).
    명세 문구는 "같은 입력의 json.loads" 다. 그런데 문자열 입력에서는 json.loads 자체가 수 ms(긴 문자열 4 MiB 약 4ms)라서,
    사전 검사가 글을 한 번만 훑어도 0.3 배를 넘는다. 그래서 기준을 최악 입력의 json.loads 로 잡았다. 이렇게 해도
    strict_json.loads 의 최악 시간이 json.loads 최악 시간의 1.3 배를 넘지 않는다는 R6 의 목적은 같다.
  - 측정 전에 gc.collect() 로 GC 상태를 맞춘다. json.loads 시간의 절반 이상이 GC 다(4 MiB 최악 입력에서 GC 를 끄면 약 100ms,
    켜면 약 250ms). 운영과 같게 GC 는 켠 채로 잰다.
- 판정 규칙(R3)은 그대로다. 128 통과·129 거절(최상위 [] 가 깊이 1), 문자열 안 괄호와 \\"·\\\\" 이스케이프는 세지 않는다,
  닫히지 않은 문자열 뒤는 세지 않는다, JSON 이 아닌 글은 파서가 거절한다. R3 시험(test_local_hardening2)은 그대로 둔다.
  이 파일의 R3 절은 사전 검사를 다시 쓸 때 깨지기 쉬운 경우(형제 하위 트리·공백·역슬래시 연속·한글·짝 없는 서로게이트·
  괄호 없는 글)를 더한 가드다.

모델 서버는 127.0.0.1 가짜 서버뿐이다(conftest 가 루프백 밖 연결·이름 조회를 막는다). 키는 모두 가짜 값이다.
"""

import functools
import gc
import gzip
import json
import statistics
import time
import tracemalloc

import pytest
from fake_models import (
    Reply,
    chat_completion,
    extraction_output,
    kev_answer,
    kev_models,
    vllm_models,
)
from pydantic import SecretStr
from support import KEV_KEY, extract_request, kev_request, new_deadline
from test_local_hardening import gzip_bomb
from test_local_kev_v02 import KevResponder, v02_extraction

from sol_ai import strict_json
from sol_ai.adapters import http, kev_local
from sol_ai.errors import StartupRefused

SYSTEMONE = "/v1/systemone"
MODELS = "/v1/models"
COMPLETIONS = "/v1/chat/completions"
V0_2 = "kev-qs/v0.2"

# 명세 R6 값
KEV_LIMIT = 1 * 1024 * 1024
QWEN_LIMIT = 4 * 1024 * 1024

KEV_UNAVAILABLE = (200, False, "KEV_UNAVAILABLE")
KEV_READ = (200, True, None)
EXTRACTED = (200, "COMPLETED", None)

# 본문을 보내는 방법: Content-Length 를 보냄 · 보내지 않음(연결이 닫힐 때까지 읽는다) · gzip(압축을 푼 크기로 센다)
DELIVERIES = ["content_length", "streamed", "gzip"]


def padded(value: object, size: int) -> bytes:
    """JSON 직렬화 뒤 공백(표준 JSON 이 허용하는 끝 공백)으로 정확히 size 바이트를 만든다."""
    raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
    assert len(raw) <= size  # 전제
    return raw + b" " * (size - len(raw))


def sized_reply(value: object, size: int, delivery: str = "content_length", **changes) -> Reply:
    """value 를 압축을 푼 크기 size 바이트로 보내는 응답."""
    body = padded(value, size)
    if delivery == "content_length":
        return Reply(raw_body=body, **changes)
    if delivery == "streamed":
        return Reply(raw_body=body, send_length=False, **changes)
    headers = {**changes.pop("headers", {}), "Content-Encoding": "gzip"}
    return Reply(raw_body=gzip.compress(body), headers=headers, **changes)


def fixture_client(make_client):
    """fixture 모드(local) 앱. 500 도 응답으로 받아 상태 코드로 본다."""
    return make_client(SOL_RUN_MODE="fixture", raise_server_exceptions=False)


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


def run_kev(make_client, local_models, reply: Reply):
    local_models.kev.route("POST", SYSTEMONE, reply)
    return fixture_client(make_client).post("/kev", json=kev_request("FX-01"))


def run_extract(make_client, local_models, reply: Reply):
    local_models.qwen.route("POST", COMPLETIONS, reply)
    return fixture_client(make_client).post("/extract", json=extract_request("FX-01"))


def kev_registry_match(client):
    return client.get("/health").json()["kev"]["registryMatch"]


# ================================================================ R6-1 http.call 의 max_bytes


def capped_call(server, max_bytes: int | None = None, path: str = "/big") -> http.HttpReply:
    endpoint = http.Endpoint(server.url, SecretStr(KEV_KEY))
    extra = {} if max_bytes is None else {"max_bytes": max_bytes}
    return http.call(endpoint, "GET", path, deadline=new_deadline(10.0), **extra)


def capped_failure(server, max_bytes: int) -> str:
    with pytest.raises(http.TransportFailure) as failure:
        capped_call(server, max_bytes)
    return str(failure.value)


def test_call_reads_streamed_body_at_max_bytes(fake_server):
    server = fake_server().route("GET", "/big", Reply(raw_body=b" " * KEV_LIMIT, send_length=False))
    assert len(capped_call(server, KEV_LIMIT).text) == KEV_LIMIT


def test_call_refuses_streamed_body_one_byte_over_max_bytes(fake_server):
    body = b" " * (KEV_LIMIT + 1)
    server = fake_server().route("GET", "/big", Reply(raw_body=body, send_length=False))
    assert capped_failure(server, KEV_LIMIT) == "ResponseTooLarge"


def test_call_refuses_content_length_over_max_bytes_before_reading_body(fake_server):
    # 헤더는 상한+1 바이트를 알리고 본문은 3초 동안 조금씩 보낸다. 본문을 읽기 전에 끊어야 바로 끝난다
    reply = Reply(drip=b" ", drip_interval=0.1, drip_for=3.0, content_length=KEV_LIMIT + 1)
    server = fake_server().route("GET", "/big", reply)
    started = time.monotonic()
    message = capped_failure(server, KEV_LIMIT)
    assert (message, time.monotonic() - started < 1.0) == ("ResponseTooLarge", True)


def test_call_counts_max_bytes_after_decompression(fake_server):
    raw = gzip.compress(b" " * (KEV_LIMIT + 1))
    assert len(raw) < KEV_LIMIT // 100  # 전제: 압축 크기는 상한보다 훨씬 작다
    reply = Reply(raw_body=raw, headers={"Content-Encoding": "gzip"})
    server = fake_server().route("GET", "/big", reply)
    assert capped_failure(server, KEV_LIMIT) == "ResponseTooLarge"


def test_call_reads_compressed_body_at_max_bytes(fake_server):
    reply = Reply(raw_body=gzip.compress(b" " * KEV_LIMIT), headers={"Content-Encoding": "gzip"})
    server = fake_server().route("GET", "/big", reply)
    assert len(capped_call(server, KEV_LIMIT).text) == KEV_LIMIT


def test_call_without_max_bytes_keeps_the_4_mib_limit(fake_server):
    # 가드: 기본 상한은 Qwen 의 4 MiB 그대로다(Kev 상한 1 MiB 로 바뀌지 않는다)
    body = b" " * (KEV_LIMIT + 1)
    server = fake_server().route("GET", "/big", Reply(raw_body=body, send_length=False))
    assert (http.MAX_RESPONSE_BYTES, len(capped_call(server).text)) == (QWEN_LIMIT, KEV_LIMIT + 1)


# ================================================================ R6-1 Kev 응답 상한 1 MiB


def test_kev_max_response_bytes_is_1_mib():
    assert kev_local.KEV_MAX_RESPONSE_BYTES == KEV_LIMIT


# ---- POST /v1/systemone(v0.1)


@pytest.mark.parametrize("delivery", DELIVERIES)
def test_kev_reply_one_byte_over_kev_limit_is_kev_unavailable(make_client, local_models, delivery):
    reply = sized_reply(kev_answer(), KEV_LIMIT + 1, delivery)
    assert kev_outcome(run_kev(make_client, local_models, reply)) == KEV_UNAVAILABLE


@pytest.mark.parametrize("delivery", DELIVERIES)
def test_kev_reply_at_kev_limit_is_read(make_client, local_models, delivery):
    reply = sized_reply(kev_answer(), KEV_LIMIT, delivery)
    assert kev_outcome(run_kev(make_client, local_models, reply)) == KEV_READ


def test_kev_reply_declaring_more_than_kev_limit_is_cut_before_reading_body(
    make_client, local_models
):
    # 고치기 전에는 본문을 3초 동안 읽다가 연결이 닫혀 전송 실패가 된다(결과 코드는 같고 시간만 넘는다)
    reply = Reply(drip=b" ", drip_interval=0.1, drip_for=3.0, content_length=KEV_LIMIT + 1)
    local_models.kev.route("POST", SYSTEMONE, reply)
    client = fixture_client(make_client)
    started = time.monotonic()
    response = client.post("/kev", json=kev_request("FX-01"))
    elapsed = time.monotonic() - started
    assert (kev_outcome(response), elapsed < 1.0) == (KEV_UNAVAILABLE, True)


# ---- POST /v1/systemone(v0.2 묶음 하나)


class SizedChunk:
    """v0.2 묶음 응답기(KevResponder)를 감싸 chunk 번째 묶음만 압축을 푼 크기 size 바이트로 보낸다."""

    def __init__(self, chunk: int, size: int) -> None:
        self.inner = KevResponder()
        self.chunk = chunk
        self.size = size

    def __call__(self, recorded) -> Reply:
        reply = self.inner(recorded)
        if self.inner.calls != self.chunk:
            return reply
        return sized_reply(reply.json_body, self.size, headers=dict(reply.headers))


@pytest.fixture
def v02_kev(make_client, local_models, monkeypatch):
    """KEV_QUESTION_SET=kev-qs/v0.2 local 앱으로 /kev 를 부른다. 묶음은 2개다(v02_extraction 기본, 묶음당 24문항)."""
    monkeypatch.setenv("KEV_QUESTION_SET", V0_2)

    def run(responder: SizedChunk):
        local_models.kev.respond_with("POST", SYSTEMONE, responder)
        response = fixture_client(make_client).post(
            "/kev", json=kev_request("FX-01", extraction=v02_extraction())
        )
        assert responder.inner.calls >= responder.chunk  # 전제: 그 묶음까지 보냈다
        return response

    return run


@pytest.mark.parametrize("chunk", [1, 2], ids=["first_chunk", "second_chunk"])
def test_v0_2_chunk_one_byte_over_kev_limit_disables_kev(v02_kev, chunk):
    response = v02_kev(SizedChunk(chunk, KEV_LIMIT + 1))
    requirements = response.json()["requirements"] if response.status_code == 200 else "?"
    assert (kev_outcome(response), requirements) == (KEV_UNAVAILABLE, None)


def test_v0_2_chunk_at_kev_limit_is_read(v02_kev):
    response = v02_kev(SizedChunk(2, KEV_LIMIT))
    assert kev_outcome(response) == KEV_READ


# ---- GET /v1/models(기동 대조·요청 때 지연 대조)


def test_startup_kev_models_reply_over_kev_limit_is_unconfirmed(make_client, local_models):
    local_models.kev.route("GET", MODELS, sized_reply(kev_models(), KEV_LIMIT + 1))
    assert kev_registry_match(fixture_client(make_client)) is None


def test_startup_kev_models_reply_at_kev_limit_is_matched(make_client, local_models):
    local_models.kev.route("GET", MODELS, sized_reply(kev_models(), KEV_LIMIT))
    assert kev_registry_match(fixture_client(make_client)) is True


def test_startup_kev_models_mismatch_over_kev_limit_is_unconfirmed_not_refused(
    make_client, local_models
):
    # 다른 run 만 있는 목록이지만 상한을 넘어 읽지 않는다 → 미확인이라 기동한다(불일치 거부가 아니다)
    local_models.kev.route("GET", MODELS, sized_reply(kev_models("runs/other"), KEV_LIMIT + 1))
    try:
        outcome = kev_registry_match(fixture_client(make_client))
    except StartupRefused as refused:
        outcome = refused.summary
    assert outcome is None


UNCONFIRMED = Reply(503, {"error": "starting"})


@pytest.mark.parametrize(
    "size, outcome, posts",
    [(KEV_LIMIT + 1, KEV_UNAVAILABLE, 0), (KEV_LIMIT, KEV_READ, 1)],
    ids=["over_kev_limit", "at_kev_limit"],
)
def test_request_time_kev_models_reply_size(make_client, local_models, size, outcome, posts):
    # 기동 때는 미확인(503)이고, /kev 때 지연 대조가 받는 목록의 크기만 다르다
    local_models.kev.route("GET", MODELS, UNCONFIRMED, sized_reply(kev_models(), size))
    local_models.kev.route("POST", SYSTEMONE, Reply(json_body=kev_answer()))
    client = fixture_client(make_client)
    assert kev_registry_match(client) is None  # 전제: 기동 대조는 미확인
    response = client.post("/kev", json=kev_request("FX-01"))
    assert (kev_outcome(response), len(local_models.kev.calls("POST", SYSTEMONE))) == (
        outcome,
        posts,
    )


# ---- Qwen 은 4 MiB 그대로(가드)


@pytest.mark.parametrize("delivery", DELIVERIES)
def test_qwen_reply_over_kev_limit_is_read(make_client, local_models, delivery):
    reply = sized_reply(chat_completion(extraction_output("FX-01")), KEV_LIMIT + 1, delivery)
    assert extract_outcome(run_extract(make_client, local_models, reply)) == EXTRACTED


def test_qwen_reply_of_3_mib_is_read(make_client, local_models):
    reply = sized_reply(chat_completion(extraction_output("FX-01")), 3 * 1024 * 1024)
    assert extract_outcome(run_extract(make_client, local_models, reply)) == EXTRACTED


def test_startup_qwen_models_mismatch_over_kev_limit_is_still_refused(make_client, local_models):
    # 대조 응답을 실제로 읽는지: 상한(4 MiB) 안이므로 다른 모델만 있으면 불일치 거부다
    reply = sized_reply(vllm_models("Qwen/other-model"), KEV_LIMIT + 1)
    local_models.qwen.route("GET", MODELS, reply)
    with pytest.raises(StartupRefused) as refused:
        make_client(SOL_RUN_MODE="fixture")
    assert "QWEN_MODEL(REGISTRY_MISMATCH)" in refused.value.summary


# ================================================================ R6-2 깊이 계수 속도

SPEED_BYTES = 4 * 1024 * 1024
SPEED_RATIO = 0.3
SPEED_REPEATS = 5

# 문자열이 많은 입력(배열 원소). 짧은 문자열 · 괄호와 \" 가 든 짧은 문자열 · 괄호로 찬 1 KiB 문자열
STRING_HEAVY = {
    "many_short_strings": '"ab"',
    "short_strings_with_brackets_and_escaped_quotes": '"[\\"]"',
    "long_strings_full_of_brackets": json.dumps("[{" * 512),
}


def four_mib_array(element: str) -> str:
    """element 를 쉼표로 이은 배열. 끝 공백으로 정확히 SPEED_BYTES 바이트(UTF-8)로 맞춘다."""
    count = (SPEED_BYTES - 2) // (len(element.encode("utf-8")) + 1)
    text = "[" + ",".join([element] * count) + "]"
    return text + " " * (SPEED_BYTES - len(text.encode("utf-8")))


@functools.cache
def worst_case_input() -> str:
    """3e 실측의 최악 입력 [[[[1]]],…](최상위 배열 + 3단, 깊이 4)."""
    return four_mib_array("[[[1]]]")


def cpu_seconds(function, text: str) -> float:
    gc.collect()
    started = time.process_time()
    function(text)
    return time.process_time() - started


def depth_check_over_parse(check_input: str, parse_input: str) -> tuple[float, str]:
    """(_check_depth(check_input) 중앙값 ÷ json.loads(parse_input) 중앙값, 설명). 반복마다 번갈아 잰다."""
    strict_json._check_depth(check_input)  # 데우기(정규식 캐시 등)
    json.loads(parse_input)
    checks, parses = [], []
    for _ in range(SPEED_REPEATS):
        parses.append(cpu_seconds(json.loads, parse_input))
        checks.append(cpu_seconds(strict_json._check_depth, check_input))
    check, parse = statistics.median(checks), statistics.median(parses)
    ratio = check / parse
    return (
        ratio,
        f"_check_depth {check * 1000:.1f}ms / json.loads {parse * 1000:.1f}ms = {ratio:.2f}",
    )


def test_worst_case_input_is_4_mib_of_valid_shallow_json():
    # 전제(시험 입력): 정확히 4 MiB, 표준 JSON, 깊이 4
    text = worst_case_input()
    assert (len(text.encode("utf-8")), json.loads(text)[0]) == (SPEED_BYTES, [[[1]]])


def test_depth_check_on_worst_case_input_takes_at_most_0_3_of_json_loads():
    text = worst_case_input()
    ratio, detail = depth_check_over_parse(text, text)
    assert ratio <= SPEED_RATIO, detail


@pytest.mark.parametrize("case", sorted(STRING_HEAVY))
def test_depth_check_on_string_heavy_input_takes_at_most_0_3_of_worst_case_json_loads(case):
    text = four_mib_array(STRING_HEAVY[case])
    json.loads(text)  # 전제: 표준 JSON
    ratio, detail = depth_check_over_parse(text, worst_case_input())
    assert ratio <= SPEED_RATIO, detail


def test_worst_case_input_still_parses():
    text = worst_case_input()
    assert strict_json.loads(text) == json.loads(text)


# ================================================================ R6-2 판정 규칙(R3) 가드: 사전 검사를 다시 쓸 때 깨지기 쉬운 경우

MAX_DEPTH = 128


def nested_arrays(depth: int) -> str:
    return "[" * depth + "]" * depth


def outcome(text: str) -> str:
    """결과 이름: parsed(json.loads 와 같은 값) · rejected(ValueError). 다른 예외는 그대로 올린다."""
    try:
        value = strict_json.loads(text)
    except ValueError:
        return "rejected"
    assert value == json.loads(text)
    return "parsed"


DEPTH_CASES = [(MAX_DEPTH, "parsed"), (MAX_DEPTH + 1, "rejected")]
DEPTH_IDS = ["depth_128", "depth_129"]


def twice(subtree: str) -> str:
    """같은 하위 트리 둘(쉼표로 이은 형제). 깊이는 그대로이고 괄호 총수만 두 배다.

    경계 시험(깊이 128)의 괄호 총수가 128 을 넘게 한다. 괄호 총수가 상한 이하면 일찍 끝내는 구현에서도
    128 경계가 실제 깊이 계산을 거치게 한다(시제품 변형 P43 이 이것 없이 살아남았다).
    """
    return subtree + ", " + subtree


@pytest.mark.parametrize("text", ["1", '"x"', "null", "  true  ", '""', '"[{"', '"]}"', "{}", "[]"])
def test_text_with_no_or_few_brackets_is_parsed(text):
    assert outcome(text) == "parsed"


def siblings(count: int, deep: str | None = None, where: str = "last") -> str:
    """최상위 배열 안에 깊이 127 하위 트리 count 개(전체 깊이 128). deep 을 주면 맨 앞이나 맨 뒤에 하나 더 둔다."""
    items = [nested_arrays(MAX_DEPTH - 1)] * count
    if deep is not None:
        items = [deep, *items] if where == "first" else [*items, deep]
    return "[" + ",".join(items) + "]"


def test_many_siblings_at_max_depth_are_parsed():
    # 여는 괄호는 모두 합쳐 수십만 개지만 깊이는 128 이다(여는 괄호 수만 세면 거절된다)
    assert outcome(siblings(2000)) == "parsed"


@pytest.mark.parametrize("where", ["first", "last"])
def test_one_sibling_past_max_depth_is_rejected(where):
    assert outcome(siblings(2000, nested_arrays(MAX_DEPTH), where)) == "rejected"


def spaced(depth: int) -> str:
    return "[\n\t " * depth + " \r\n]" * depth


@pytest.mark.parametrize("depth, expected", DEPTH_CASES, ids=DEPTH_IDS)
def test_whitespace_between_brackets_does_not_change_depth(depth, expected):
    # 최상위 1단 + 하위 depth-1 단 둘
    assert outcome("[\n" + twice(spaced(depth - 1)) + "\n]") == expected


@pytest.mark.parametrize("backslashes", [1, 3, 5])
def test_odd_backslash_run_before_quote_keeps_the_string_open(backslashes):
    # 문자열 하나: \…\" 뒤 "[" 3000개. 따옴표가 이스케이프되어 문자열이 이어진다
    text = '["' + "\\" * backslashes + '"' + "[" * 3000 + '"]'
    assert outcome(text) == "parsed"


@pytest.mark.parametrize("depth, expected", DEPTH_CASES, ids=DEPTH_IDS)
@pytest.mark.parametrize("backslashes", [2, 4, 6])
def test_even_backslash_run_before_quote_ends_the_string(backslashes, depth, expected):
    # ["\\…", [[…]], [[…]]]: 역슬래시가 짝수면 따옴표에서 문자열이 끝나고 뒤 괄호를 센다(최상위 1단 + 하위 depth-1 단 둘)
    text = '["' + "\\" * backslashes + '", ' + twice(nested_arrays(depth - 1)) + "]"
    assert outcome(text) == expected


NON_ASCII = {
    "hangul": "가[{나",
    "astral_emoji": "\U0001f600[{",
    "lone_surrogate": "\ud800[{",
}


@pytest.mark.parametrize("depth, expected", DEPTH_CASES, ids=DEPTH_IDS)
@pytest.mark.parametrize("case", sorted(NON_ASCII))
def test_non_ascii_string_does_not_change_depth(case, depth, expected):
    # 문자열은 이스케이프하지 않은 글자 그대로다(짝 없는 서로게이트도 str 에는 들어 있을 수 있다. json.loads 는 받는다)
    string = json.dumps(NON_ASCII[case], ensure_ascii=False)
    text = "[" + string + ", " + twice(nested_arrays(depth - 1)) + "]"
    assert outcome(text) == expected


NOT_JSON = {
    "unclosed_string_then_brackets": '["open ' + "[" * 5000,
    "unclosed_string_with_brackets_inside": '"' + "[{" * 5000,
    "unclosed_string_ending_in_escaped_quote": '["a\\"' + "[" * 5000,
    "unclosed_string_ending_in_backslash": '["x", "\\',
    "closers_before_openers": "]" * 200 + "[" * 200,
    "unbalanced_openers": "[" * 200,
}


@pytest.mark.parametrize("case", sorted(NOT_JSON))
def test_text_that_is_not_json_is_rejected_as_value_error(case):
    assert outcome(NOT_JSON[case]) == "rejected"


# ================================================================ R6 구현 뒤 보강(test-ai 독립 검증, 2026-10-20)
# 변형 확인(M213~)에서 살아남은 변형 가운데 동작이 실제로 바뀌는 것을 잡는다(docs/evidence/phase-5/test-ai.txt 10.15).

# 압축 폭탄을 1 MiB 상한으로 읽을 때 최고 메모리 상한. 지금 약 2.1~2.5 MiB, 압축 해제 한 번을 4 MiB 기준으로 풀면 약 8.1~8.6 MiB
PEAK_LIMIT = 4 * KEV_LIMIT


def test_call_decompresses_at_most_max_bytes_at_a_time(fake_server):
    # 64 MiB 로 풀리는 gzip 을 max_bytes=1 MiB 로 읽는다. 한 번에 푸는 크기도 max_bytes 로 묶여야 Kev 호출이
    # 기본 상한(4 MiB)만큼을 먼저 잡지 않는다(M215)
    reply = Reply(raw_body=gzip_bomb(64 * 1024 * 1024), headers={"Content-Encoding": "gzip"})
    server = fake_server().route("GET", "/big", reply)
    tracemalloc.start()
    try:
        message = capped_failure(server, KEV_LIMIT)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert (message, peak < PEAK_LIMIT) == ("ResponseTooLarge", True), f"peak {peak} bytes"


def peel_shapes(depth: int) -> dict[str, str]:
    """깊이 depth 인 표준 JSON 가운데 사전 검사의 벗기기(붙은 [] 지우기)를 한 번 이상 거치는 모양.

    빈 배열·객체 200개가 첫 벗기기에서 한꺼번에 빠지고, 남은 사슬은 누적 합으로 센다.
    """
    chain = nested_arrays(depth - 1)
    empties = ["[]", "{}"] * 100
    return {
        "empty_siblings_first": "[" + ",".join([*empties, chain]) + "]",
        "empty_siblings_last": "[" + ",".join([chain, *empties]) + "]",
    }


@pytest.mark.parametrize("depth, expected", DEPTH_CASES, ids=DEPTH_IDS)
@pytest.mark.parametrize("shape", sorted(peel_shapes(MAX_DEPTH)))
def test_empty_siblings_do_not_hide_depth(shape, depth, expected):
    # 빈 배열·객체가 한 번에 벗겨져도 벗긴 단수를 깊이에 더한다(M231)
    assert outcome(peel_shapes(depth)[shape]) == expected


# 표준 JSON 이 아니지만 파서가 오류 위치까지 상한보다 깊이(129) 들어가는 글. 오류 위치 앞은 올바른 앞부분이다.
# 앞의 닫힌 문자열에 괄호가 있어 사전 검사의 따옴표가 셋 이상 남는다
DEEP_PREFIX_NOT_JSON = {
    "unclosed_string_after_string_with_opener": '["[", ' + "[" * MAX_DEPTH + '"open',
    "unclosed_string_after_string_with_closer": '["]", ' + "[" * MAX_DEPTH + '"open',
    "unclosed_string_after_two_strings_with_brackets": '["[", "{", ' + "[" * MAX_DEPTH + '"open',
    "stray_closer_after_deep_prefix": "[" * (MAX_DEPTH + 1) + "]]}",
}


@pytest.mark.parametrize("case", sorted(DEEP_PREFIX_NOT_JSON))
def test_depth_check_rejects_not_json_whose_valid_prefix_is_past_max_depth(case):
    # 파서에 넘기기 전에 사전 검사가 거절한다(M226: 닫히지 않은 따옴표를 첫 따옴표로 잡으면 앞부분 깊이를 놓친다)
    with pytest.raises(ValueError):
        strict_json._check_depth(DEEP_PREFIX_NOT_JSON[case])


# 넓고 깊은 입력(깊이 128 하위 트리를 이어 붙인 4 MiB)은 명세가 이름 붙인 입력이 아니다. 지금 비율은 약 0.25 라
# 명세 기준 0.3 은 기계 부하에 흔들릴 수 있다. 그래서 벗기기를 깊이만큼 되풀이하는 회귀(M230, 약 3.7)를 잡는
# 느슨한 상한 1.0(분모는 최악 입력의 json.loads)을 쓴다
SPEED_GUARD_RATIO = 1.0


@functools.cache
def wide_deep_input() -> str:
    """최상위 배열 안에 깊이 127 사슬을 이어 붙인 4 MiB(전체 깊이 128). 벗기기 한 번이 거의 줄이지 못한다."""
    return four_mib_array(nested_arrays(MAX_DEPTH - 1))


def test_wide_deep_input_is_4_mib_at_max_depth_and_parsed():
    # 전제(시험 입력): 정확히 4 MiB, 깊이 128 이라 받는다
    text = wide_deep_input()
    assert (len(text.encode("utf-8")), outcome(text)) == (SPEED_BYTES, "parsed")


def test_depth_check_on_wide_deep_input_stays_within_the_guard_ratio():
    ratio, detail = depth_check_over_parse(wide_deep_input(), worst_case_input())
    assert ratio <= SPEED_GUARD_RATIO, detail
