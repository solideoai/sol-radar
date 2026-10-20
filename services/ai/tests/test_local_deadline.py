"""C5-A 보안 후속 S1(요청당 단조 시계 마감)·S12(잠금을 쥔 채 네트워크 호출 금지). 구현 전 실패 시험(red).

근거(e8 확정 2026-10-19): worker 는 /kev 를 KEV_TIMEOUT_MS+2s, /extract 를 AI_TIMEOUT_MS+5s 에 끊는다. gateway 의
실제 소요는 그보다 짧아야 "응답했지만 쓸 수 없음"과 "전송 실패"가 정본대로 갈린다(ADR-031 C6).

시험이 기대하는 모양(구현자가 맞춘다):
- sol_ai.deadline.Deadline(seconds, clock=time.monotonic). remaining() 은 남은 초이고 지났으면 0 이하다.
- http.call(endpoint, method, path, *, deadline=Deadline, json_body=None). 남은 시간을 timeout 으로 쓰고, 0 이하면
  네트워크를 부르지 않고 TransportFailure("DeadlineExceeded"). 본문은 조각마다 마감을 다시 본다.
- run_extraction(request, qwen, config, *, deadline=Deadline). 첫 호출과 재시도에 같은 Deadline 객체를 인자로 넘긴다.
- /kev(local): 요청 시작 + KEV_TIMEOUT_MS 하나를 레지스트리 지연 대조와 모든 v0.2 묶음이 나눠 쓴다.
- /extract(local): 요청 시작 + AI_TIMEOUT_MS 하나를 첫 호출과 재시도가 나눠 쓴다.

시간 값은 명세 값(마감 1000ms, 서버 지연 600ms, 여유 300ms, S12 지연 500ms)이다. 고치기 전 코드는 결과 코드가
다르거나 기대보다 확실히 오래 걸린다(1.8s·4s 등). 재시도 시작 판정과 본문 조각 판정은 주입한 시계로 결정적으로 본다.
모델 서버는 127.0.0.1 가짜 서버뿐이다.
"""

import json
import threading
import time

import pytest
from fake_models import (
    Reply,
    chat_completion,
    extraction_output,
    free_port,
    kev_answer,
    kev_models,
)
from pydantic import SecretStr
from support import (
    KEV_RUN,
    PROMPT_VERSION,
    QWEN_KEY,
    FakeClock,
    deadline_type,
    extract_request,
    kev_request,
    new_deadline,
)
from test_local_kev_v02 import KevResponder, v02_extraction

from sol_ai.adapters import http
from sol_ai.adapters.base import ModelOutput
from sol_ai.contracts import ExtractRequest
from sol_ai.extraction import ExtractionConfig, run_extraction
from sol_ai.guards import InjectionGuard
from sol_ai.paths import INJECTION_PATTERNS_FILE
from sol_ai.qualifications import default_dictionary
from sol_ai.schema import default_schema

SYSTEMONE = "/v1/systemone"
MODELS = "/v1/models"
COMPLETIONS = "/v1/chat/completions"
V0_2 = "kev-qs/v0.2"

# 명세 S1 값
BUDGET_MS = 1000
BUDGET_S = BUDGET_MS / 1000
SERVER_DELAY = 0.6
SLACK = 0.3
# 조금씩 흘려보내는 서버: 헤더는 바로, 본문은 100ms 마다 1바이트. 고치기 전 코드가 끝없이 기다리지 않게 4초 뒤 닫는다
DRIP = {"drip": b" ", "drip_interval": 0.1, "drip_for": 4.0}
# 명세 S12 값
REGISTRY_DELAY = 0.5


def disabled(result: dict) -> tuple:
    return (
        result["kev"]["enabled"],
        result["errorCode"],
        result["stateHash"],
        result["wire"],
        result["requirements"],
    )


UNAVAILABLE = (False, "KEV_UNAVAILABLE", None, None, None)


def timed_post(client, path: str, body: dict) -> tuple[dict, float]:
    started = time.monotonic()
    response = client.post(path, json=body)
    elapsed = time.monotonic() - started
    assert response.status_code == 200
    return response.json(), elapsed


def endpoint(server) -> http.Endpoint:
    return http.Endpoint(server.url, SecretStr(QWEN_KEY))


def late_kev(make_client, monkeypatch, fake_server):
    """기동 때 Kev 는 닫힌 포트(레지스트리 미확인, registry_match=None)이고, 기동 뒤 같은 포트에 서버가 생긴다."""
    port = free_port()
    monkeypatch.setenv("KEV_BASE_URL", f"http://127.0.0.1:{port}")
    client = make_client(SOL_RUN_MODE="fixture")
    assert client.get("/health").json()["kev"]["registryMatch"] is None  # 전제: 기동 때 미확인
    return client, fake_server(port)


def schema_violation() -> str:
    output = json.loads(extraction_output("FX-01"))
    output["projectType"]["value"] = "WEB"  # enum 밖 값(test_local_qwen 의 스키마 위반 응답과 같다)
    return json.dumps(output, ensure_ascii=False)


# ---------------------------------------------------------------- Deadline(주입한 시계)


def test_deadline_remaining_starts_at_budget():
    assert new_deadline(1.5, FakeClock()).remaining() == 1.5


def test_deadline_remaining_follows_injected_clock():
    clock = FakeClock()
    deadline = new_deadline(1.5, clock)
    clock.advance(0.5)
    assert deadline.remaining() == 1.0


@pytest.mark.parametrize("elapsed", [1.5, 2.0], ids=["exactly_at_deadline", "past_deadline"])
def test_deadline_remaining_is_not_positive_after_budget(elapsed):
    clock = FakeClock()
    deadline = new_deadline(1.5, clock)
    clock.advance(elapsed)
    assert deadline.remaining() <= 0


def test_deadline_default_clock_counts_real_time():
    remaining = new_deadline(BUDGET_S).remaining()
    assert 0 < remaining <= BUDGET_S


# ---------------------------------------------------------------- http.call 은 남은 시간만 쓴다


@pytest.mark.parametrize("elapsed", [1.0, 2.0], ids=["zero_left", "negative_left"])
def test_call_without_remaining_time_does_not_touch_network(fake_server, elapsed):
    server = fake_server().route("GET", MODELS, Reply(json_body={}))
    clock = FakeClock()
    deadline = new_deadline(1.0, clock)
    clock.advance(elapsed)
    with pytest.raises(http.TransportFailure) as failure:
        http.call(endpoint(server), "GET", MODELS, deadline=deadline)
    assert (str(failure.value), server.requests) == ("DeadlineExceeded", [])


def test_call_uses_remaining_time_as_timeout(fake_server):
    # 예산 5초 중 4.7초가 지나 0.3초 남았다. 서버는 1.5초 뒤 답한다 → 예산 전체(5초)가 아니라 남은 0.3초로 끊어야 한다
    server = fake_server().route("GET", MODELS, Reply(json_body={}, delay=1.5))
    clock = FakeClock()
    deadline = new_deadline(5.0, clock)
    clock.advance(4.7)
    with pytest.raises(http.TransportFailure):
        http.call(endpoint(server), "GET", MODELS, deadline=deadline)


def test_call_cuts_dripping_body_at_deadline(fake_server):
    server = fake_server().route("GET", "/drip", Reply(**DRIP))
    started = time.monotonic()
    with pytest.raises(http.TransportFailure):
        http.call(endpoint(server), "GET", "/drip", deadline=new_deadline(BUDGET_S))
    assert time.monotonic() - started < BUDGET_S + SLACK


def test_call_checks_deadline_between_body_chunks(fake_server):
    # 헤더를 보낸 직후 주입 시계를 마감 뒤로 옮긴다. 읽기 timeout(남은 5초)은 걸리지 않으므로, 조각마다 마감을
    # 다시 보지 않으면 흘려보내기가 끝나는 4초 뒤 본문을 다 받아 성공으로 돌아온다
    clock = FakeClock()
    reply = Reply(**DRIP, before_body=lambda: clock.advance(10.0))
    server = fake_server().route("GET", "/drip", reply)
    started = time.monotonic()
    with pytest.raises(http.TransportFailure):
        http.call(endpoint(server), "GET", "/drip", deadline=new_deadline(5.0, clock))
    assert time.monotonic() - started < 3.0


# ---------------------------------------------------------------- /kev: 레지스트리 지연 대조 + 모든 묶음이 마감 하나


def test_kev_v0_2_registry_check_and_chunks_share_one_deadline(
    make_client, monkeypatch, fake_server, local_models
):
    # 명세 S1: /v1/models 600ms + 묶음 2개 각 600ms. 고치기 전에는 약 1.8s 뒤 성공한다
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    monkeypatch.setenv("KEV_QUESTION_SET", V0_2)
    client, server = late_kev(make_client, monkeypatch, fake_server)
    server.route("GET", MODELS, Reply(json_body=kev_models(KEV_RUN), delay=SERVER_DELAY))
    server.respond_with("POST", SYSTEMONE, KevResponder(delay=SERVER_DELAY))
    result, elapsed = timed_post(client, "/kev", kev_request("FX-01", extraction=v02_extraction()))
    assert (disabled(result), elapsed < BUDGET_S + SLACK) == (UNAVAILABLE, True)


def test_kev_v0_2_late_registry_and_chunks_within_deadline_succeed(
    make_client, monkeypatch, fake_server, local_models
):
    # 회귀 없음: 같은 조건에서 서버가 빨리 답하면 정상 결과다(대조 1회 + 묶음 2개)
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    monkeypatch.setenv("KEV_QUESTION_SET", V0_2)
    client, server = late_kev(make_client, monkeypatch, fake_server)
    server.route("GET", MODELS, Reply(json_body=kev_models(KEV_RUN)))
    server.respond_with("POST", SYSTEMONE, KevResponder())
    result, _ = timed_post(client, "/kev", kev_request("FX-01", extraction=v02_extraction()))
    assert (
        result["kev"]["enabled"],
        result["errorCode"],
        [(r.method, r.path) for r in server.requests],
    ) == (True, None, [("GET", MODELS), ("POST", SYSTEMONE), ("POST", SYSTEMONE)])


def test_kev_v0_1_registry_check_and_call_share_one_deadline(
    make_client, monkeypatch, fake_server, local_models
):
    # v0.1: /v1/models 600ms + 호출 600ms. 고치기 전에는 약 1.2s 뒤 성공한다
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    client, server = late_kev(make_client, monkeypatch, fake_server)
    server.route("GET", MODELS, Reply(json_body=kev_models(KEV_RUN), delay=SERVER_DELAY))
    server.route("POST", SYSTEMONE, Reply(json_body=kev_answer(), delay=SERVER_DELAY))
    result, elapsed = timed_post(client, "/kev", kev_request("FX-01"))
    assert (disabled(result), elapsed < BUDGET_S + SLACK) == (UNAVAILABLE, True)


def test_kev_dripping_server_is_cut_at_deadline(make_client, monkeypatch, local_models):
    # 고치기 전에는 읽기 timeout 이 바이트마다 새로 시작해 흘려보내기가 끝나는 4초 뒤에야 끝난다
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    local_models.kev.route("POST", SYSTEMONE, Reply(**DRIP))
    client = make_client(SOL_RUN_MODE="fixture")
    result, elapsed = timed_post(client, "/kev", kev_request("FX-01"))
    assert (disabled(result), elapsed < BUDGET_S + SLACK) == (UNAVAILABLE, True)


# ---------------------------------------------------------------- /extract: 첫 호출과 재시도가 마감 하나


def test_extract_first_call_and_retry_share_one_deadline(make_client, monkeypatch, local_models):
    # 명세 S1: 첫 응답(스키마 위반) 600ms + 재시도 600ms. 재시도는 남은 400ms 로 끊겨 QWEN_UNAVAILABLE(03 §4.3).
    # 고치기 전에는 약 1.2s 뒤 재시도가 성공해 COMPLETED 다
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    local_models.qwen.route(
        "POST",
        COMPLETIONS,
        Reply(json_body=chat_completion(schema_violation()), delay=SERVER_DELAY),
        Reply(json_body=chat_completion(extraction_output("FX-01")), delay=SERVER_DELAY),
    )
    client = make_client(SOL_RUN_MODE="fixture")
    result, elapsed = timed_post(client, "/extract", extract_request("FX-01"))
    assert (result["status"], result["errorCode"], elapsed < BUDGET_S + SLACK) == (
        "FAILED",
        "QWEN_UNAVAILABLE",
        True,
    )


def test_extract_dripping_server_is_cut_at_deadline(make_client, monkeypatch, local_models):
    # 고치기 전에는 4초 뒤 공백뿐인 본문을 받아 EXTRACTION_FAILED 다
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    local_models.qwen.route("POST", COMPLETIONS, Reply(**DRIP))
    client = make_client(SOL_RUN_MODE="fixture")
    result, elapsed = timed_post(client, "/extract", extract_request("FX-01"))
    assert (result["errorCode"], elapsed < BUDGET_S + SLACK) == ("QWEN_UNAVAILABLE", True)


class ScriptedQwen:
    """QwenAdapter 흉내(네트워크 없음). 호출마다 정한 출력을 돌려주고, 인자로 받은 Deadline 을 남긴다."""

    provider = "local"
    model_name = "scripted-qwen"
    prompt_hash = "0" * 64

    def __init__(self, outputs: list[str], on_call=None) -> None:
        self._outputs = outputs
        self._on_call = on_call
        self.deadlines: list[list] = []

    def extract(self, request, retry_note=None, *args, **kwargs) -> ModelOutput:
        deadline = deadline_type()
        self.deadlines.append([a for a in (*args, *kwargs.values()) if isinstance(a, deadline)])
        if self._on_call is not None:
            self._on_call()
        text = self._outputs[len(self.deadlines) - 1]
        return ModelOutput(text, extracted_at="2026-10-19T00:00:00Z", latency=1)


def extraction_config() -> ExtractionConfig:
    return ExtractionConfig(
        schema=default_schema(),
        guard=InjectionGuard.load(INJECTION_PATTERNS_FILE),
        dictionary=default_dictionary(),
        prompt_version=PROMPT_VERSION,
        prompt_hash="0" * 64,
        fuzzy_min_ratio=0.92,
    )


def run_scripted(qwen: ScriptedQwen, deadline):
    request = ExtractRequest.model_validate(extract_request("FX-01"))
    return run_extraction(request, qwen, extraction_config(), deadline=deadline)


def test_extract_without_time_to_start_retry_is_extraction_failed():
    # 첫 응답(JSON 아님)을 받는 사이 주입 시계가 마감을 넘긴다 → 재시도를 시작하지 않고 EXTRACTION_FAILED
    clock = FakeClock()
    qwen = ScriptedQwen(["not json"], on_call=lambda: clock.advance(10.0))
    response = run_scripted(qwen, new_deadline(BUDGET_S, clock))
    assert (response.status, response.errorCode, len(qwen.deadlines)) == (
        "FAILED",
        "EXTRACTION_FAILED",
        1,
    )


def test_extract_retry_receives_the_first_call_deadline():
    deadline = new_deadline(60.0, FakeClock())
    qwen = ScriptedQwen(["not json", extraction_output("FX-01")])
    response = run_scripted(qwen, deadline)
    assert (
        response.status,
        [[found is deadline for found in call] for call in qwen.deadlines],
    ) == ("COMPLETED", [[True], [True]])


# ---------------------------------------------------------------- S12: 대조 요청은 잠금 밖에서


def concurrent_kev(client, count: int = 2) -> list[tuple[str | None, float]]:
    """/kev 를 동시에 보내고 (errorCode, 걸린 초) 를 돌려준다. 시작은 장벽으로 맞춘다."""
    barrier = threading.Barrier(count)
    results: list = [None] * count

    def call(index: int) -> None:
        barrier.wait()
        started = time.monotonic()
        body = client.post("/kev", json=kev_request("FX-01")).json()
        results[index] = (body["errorCode"], time.monotonic() - started)

    threads = [threading.Thread(target=call, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return results


def test_concurrent_registry_checks_do_not_wait_for_each_other(
    make_client, monkeypatch, fake_server, local_models
):
    # 명세 S12: /v1/models 가 500ms 뒤 503(미확인). 두 요청 모두 약 0.5s 에 끝난다(고치기 전 두 번째는 약 1.0s)
    client, server = late_kev(make_client, monkeypatch, fake_server)
    server.route("GET", MODELS, Reply(503, {"error": "warming up"}, delay=REGISTRY_DELAY))
    results = concurrent_kev(client)
    assert [(code, elapsed < REGISTRY_DELAY + SLACK) for code, elapsed in results] == [
        ("KEV_UNAVAILABLE", True),
        ("KEV_UNAVAILABLE", True),
    ]


def test_concurrent_match_does_not_overwrite_mismatch(
    make_client, monkeypatch, fake_server, local_models
):
    # 불일치는 래치다. 먼저 끝난 대조가 불일치(0.1s), 늦게 끝난 대조가 일치(0.5s)여도 상태는 불일치로 남고
    # 그 뒤 호출은 서버를 부르지 않는다
    client, server = late_kev(make_client, monkeypatch, fake_server)
    server.route(
        "GET",
        MODELS,
        Reply(json_body=kev_models("runs/smoke"), delay=0.1),
        Reply(json_body=kev_models(KEV_RUN), delay=REGISTRY_DELAY),
    )
    server.route("POST", SYSTEMONE, Reply(json_body=kev_answer()))
    concurrent_kev(client)
    posts_before = len(server.calls("POST", SYSTEMONE))
    after = client.post("/kev", json=kev_request("FX-01")).json()
    assert (
        client.get("/health").json()["kev"]["registryMatch"],
        after["errorCode"],
        len(server.calls("POST", SYSTEMONE)) - posts_before,
    ) == (False, "KEV_UNAVAILABLE", 0)


# ---------------------------------------------------------------- 구현 뒤 변형 확인에서 더한 시험(M128·M129·M174·M175·M182)

# 헤더 뒤 본문이 멈추는 시간(초). 마감(1초)보다 길다
BODY_STALL = 1.5


def test_call_body_read_gets_only_the_time_left_after_headers(fake_server):
    # 헤더는 600ms 뒤에 오고 본문은 1.5초 멈춘다. 본문 읽기 단계의 timeout 은 그 순간 남은 400ms 여야 한다.
    # 단계마다 호출 시작 때의 남은 시간(1초)을 쓰면 1.6초 뒤에야 끊긴다(M128·M129)
    reply = Reply(json_body={}, delay=SERVER_DELAY, before_body=lambda: time.sleep(BODY_STALL))
    server = fake_server().route("GET", MODELS, reply)
    started = time.monotonic()
    with pytest.raises(http.TransportFailure):
        http.call(endpoint(server), "GET", MODELS, deadline=new_deadline(BUDGET_S))
    assert time.monotonic() - started < BUDGET_S + SLACK


def test_each_request_gets_its_own_budget(make_client, monkeypatch, local_models):
    # 마감은 요청 시작부터 센다. 앱을 만든 때부터 세면, 예산보다 늦게 온 요청은 모델을 부르기 전에 끊긴다(M174·M175)
    monkeypatch.setenv("AI_TIMEOUT_MS", str(BUDGET_MS))
    monkeypatch.setenv("KEV_TIMEOUT_MS", str(BUDGET_MS))
    local_models.qwen.route(
        "POST", COMPLETIONS, Reply(json_body=chat_completion(extraction_output("FX-01")))
    )
    local_models.kev.route("POST", SYSTEMONE, Reply(json_body=kev_answer()))
    client = make_client(SOL_RUN_MODE="fixture")
    time.sleep(BUDGET_S + 0.2)
    extracted, _ = timed_post(client, "/extract", extract_request("FX-01"))
    assessed, _ = timed_post(client, "/kev", kev_request("FX-01"))
    assert (
        extracted["status"],
        extracted["errorCode"],
        assessed["kev"]["enabled"],
        assessed["errorCode"],
    ) == ("COMPLETED", None, True, None)


def test_extract_does_not_retry_when_exactly_no_time_is_left():
    # 첫 응답을 받는 사이 남은 시간이 정확히 0 이 됐다. 0 은 "시간 없음"이다(재시도하면 성공하는 출력을 준비해 둔다, M182)
    clock = FakeClock()
    qwen = ScriptedQwen(
        ["not json", extraction_output("FX-01")], on_call=lambda: clock.advance(BUDGET_S)
    )
    response = run_scripted(qwen, new_deadline(BUDGET_S, clock))
    assert (response.status, response.errorCode, len(qwen.deadlines)) == (
        "FAILED",
        "EXTRACTION_FAILED",
        1,
    )


def test_call_fails_when_headers_arrive_after_deadline_even_with_empty_body(fake_server):
    # 서버가 요청을 받은 순간(헤더를 보내기 전) 주입 시계가 마감을 넘긴다. 본문이 비어 조각마다의 검사가 돌지 않아도
    # 마감을 넘긴 호출은 전송 실패다(M139)
    clock = FakeClock()

    def late(_request) -> Reply:
        clock.advance(10.0)
        return Reply(raw_body=b"")

    server = fake_server().respond_with("GET", MODELS, late)
    with pytest.raises(http.TransportFailure):
        http.call(endpoint(server), "GET", MODELS, deadline=new_deadline(5.0, clock))
