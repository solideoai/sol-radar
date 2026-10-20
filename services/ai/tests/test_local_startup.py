"""local 어댑터 기동 검사(local 명세 §1, L1~L3). AI_PROVIDER=local 은 SOL_RUN_MODE=fixture 로 연다.

- 127.0.0.1 만 쓰는 경우는 sol_ai.__main__.main 을 subprocess 로 돌려 exit 78·stderr 를 본다(support.run_main).
- 루프백 밖 URL 이 들어가는 경우는 같은 프로세스에서 create_app 을 부른다. conftest 가 루프백 밖 연결·이름 조회를
  막고 시도가 있으면 시험을 실패시키므로 실제로 나가지 않는다.
- 모델 서버는 시험 안의 가짜 HTTP 서버(fake_models)뿐이다.
"""

import pytest
from fake_models import Reply, closed_url, free_port, kev_models, vllm_models
from support import (
    BACKUP_QWEN_RUN,
    KEV_KEY,
    KEV_MODEL_ID,
    KEV_RUN,
    QWEN_KEY,
    QWEN_RUN,
    RETIRED_KEV_MODEL_ID,
    RETIRED_QWEN_RUN,
    run_main,
)

EX_CONFIG = 78
OUTSIDE_HTTP = "http://203.0.113.10:8000"  # 문서용 주소(RFC 5737). conftest 가 연결을 막는다


def env_for(qwen_url: str | None, kev_url: str | None, **extra: str | None) -> dict[str, str]:
    env = {
        "SOL_RUN_MODE": "fixture",
        "QWEN_BASE_URL": qwen_url,
        "QWEN_API_KEY": QWEN_KEY,
        "KEV_BASE_URL": kev_url,
        "KEV_API_KEY": KEV_KEY,
        **extra,
    }
    return {k: v for k, v in env.items() if v is not None}


def model_servers(fake_server, *, qwen_models=None, kev_reply=None):
    qwen = fake_server().route(
        "GET", "/v1/models", qwen_models or Reply(json_body=vllm_models(QWEN_RUN))
    )
    kev = fake_server().route("GET", "/v1/models", kev_reply or Reply(json_body=kev_models()))
    return qwen, kev


def started(result) -> tuple:
    return (result.returncode, "기동 거부" in result.stderr)


def refused_with(result, code: str) -> tuple:
    return (result.returncode, code in result.stderr)


# ---------------------------------------------------------------- 대조군·레지스트리 대조(L1)


def test_local_starts_when_registry_matches(fake_server):
    qwen, kev = model_servers(fake_server)
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_registry_check_calls_both_models_endpoints_with_bearer_keys(fake_server):
    qwen, kev = model_servers(fake_server)
    run_main(env_for(qwen.url, kev.url))
    assert [r.headers.get("authorization") for r in qwen.calls("GET", "/v1/models")] == [
        f"Bearer {QWEN_KEY}"
    ]
    assert [r.headers.get("authorization") for r in kev.calls("GET", "/v1/models")] == [
        f"Bearer {KEV_KEY}"
    ]


@pytest.mark.parametrize("shape", ["data_array", "top_level_object"])
def test_kev_smoke_run_is_registry_mismatch(fake_server, shape):
    reply = Reply(json_body=kev_models("runs/smoke", top_level=shape == "top_level_object"))
    qwen, kev = model_servers(fake_server, kev_reply=reply)
    result = run_main(env_for(qwen.url, kev.url))
    assert refused_with(result, "기동 거부: KEV_MODEL_ID(REGISTRY_MISMATCH)") == (EX_CONFIG, True)


def test_kev_registry_accepts_top_level_model_object(fake_server):
    qwen, kev = model_servers(
        fake_server, kev_reply=Reply(json_body=kev_models(KEV_RUN, top_level=True))
    )
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_qwen_model_missing_from_vllm_is_registry_mismatch(fake_server):
    qwen, kev = model_servers(
        fake_server, qwen_models=Reply(json_body=vllm_models("Qwen/Qwen3.5-4B"))
    )
    result = run_main(env_for(qwen.url, kev.url))
    assert refused_with(result, "기동 거부: QWEN_MODEL(REGISTRY_MISMATCH)") == (EX_CONFIG, True)


def test_unreachable_model_servers_still_start():
    assert started(run_main(env_for(closed_url(), closed_url()))) == (0, False)


@pytest.mark.parametrize(
    ("server", "status"), [("qwen", 500), ("qwen", 401), ("kev", 503), ("kev", 403)]
)
def test_unconfirmed_registry_reply_still_starts(fake_server, server, status):
    error = Reply(status, {"error": "unavailable"})
    qwen, kev = model_servers(
        fake_server,
        qwen_models=error if server == "qwen" else None,
        kev_reply=error if server == "kev" else None,
    )
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_kev_registry_is_not_checked_when_kev_disabled(fake_server):
    qwen, kev = model_servers(fake_server, kev_reply=Reply(json_body=kev_models("runs/smoke")))
    result = run_main(env_for(qwen.url, kev.url, KEV_ENABLED="false"))
    assert (started(result), kev.calls("GET", "/v1/models")) == ((0, False), [])


def test_refusal_hides_urls_and_keys(fake_server):
    qwen, kev = model_servers(fake_server, kev_reply=Reply(json_body=kev_models("runs/smoke")))
    result = run_main(env_for(qwen.url, kev.url))
    output = result.stdout + result.stderr
    assert result.returncode == EX_CONFIG
    leaked = [v for v in (kev.url, str(kev.port), qwen.url, KEV_KEY, QWEN_KEY) if v in output]
    assert leaked == []


# ---------------------------------------------------------------- 설정 검사(1~5)


def test_fallback_to_mock_is_not_implemented():
    result = run_main(env_for(closed_url(), closed_url(), AI_FALLBACK_TO_MOCK="true"))
    # 모든 모드가 금지(ADR-030 B11, infra/run-modes.json)라 run-mode 검사가 먼저 거부한다
    assert refused_with(result, "기동 거부: AI_FALLBACK_TO_MOCK(FORBIDDEN_IN_MODE)") == (
        EX_CONFIG,
        True,
    )


@pytest.mark.parametrize("missing", ["QWEN_BASE_URL", "KEV_BASE_URL", "KEV_API_KEY"])
def test_missing_endpoint_setting_is_refused(missing):
    env = env_for(closed_url(), closed_url())
    del env[missing]
    assert refused_with(run_main(env), f"{missing}(MISSING)") == (EX_CONFIG, True)


def test_kev_settings_are_optional_when_kev_disabled():
    env = env_for(closed_url(), None, KEV_ENABLED="false")
    del env["KEV_API_KEY"]
    assert started(run_main(env)) == (0, False)


@pytest.mark.parametrize("value", [None, ""], ids=["missing", "empty"])
def test_qwen_api_key_is_required(value):
    # C5-A S3: 03 §3·09 는 local 에서 QWEN_API_KEY 를 필수로 정한다(이전에는 선택으로 시험했다)
    env = env_for(closed_url(), closed_url())
    if value is None:
        del env["QWEN_API_KEY"]
    else:
        env["QWEN_API_KEY"] = value
    assert refused_with(run_main(env), "QWEN_API_KEY(MISSING)") == (EX_CONFIG, True)


def test_qwen_api_key_is_required_when_kev_disabled():
    env = env_for(closed_url(), None, KEV_ENABLED="false")
    del env["QWEN_API_KEY"]
    del env["KEV_API_KEY"]
    assert refused_with(run_main(env), "QWEN_API_KEY(MISSING)") == (EX_CONFIG, True)


def test_question_set_outside_supported_versions_is_refused():
    # 지원 집합(kev-qs/v0.1·v0.2) 밖 버전은 파일이 없어 기동 거부(초안 단계의 "미지원 → 거부" 의도를 이어 간다)
    result = run_main(env_for(closed_url(), closed_url(), KEV_QUESTION_SET="kev-qs/v0.9"))
    assert refused_with(result, "KEV_QUESTION_SET(QUESTION_SET_NOT_AVAILABLE)") == (
        EX_CONFIG,
        True,
    )


def test_question_set_v0_2_is_supported():
    result = run_main(env_for(closed_url(), closed_url(), KEV_QUESTION_SET="kev-qs/v0.2"))
    assert started(result) == (0, False)


def test_unknown_kev_model_id_is_not_in_registry():
    result = run_main(env_for(closed_url(), closed_url(), KEV_MODEL_ID="kev-unknown-v9"))
    assert refused_with(result, "KEV_MODEL_ID(NOT_IN_REGISTRY)") == (EX_CONFIG, True)


def test_unknown_qwen_model_is_not_in_registry():
    result = run_main(env_for(closed_url(), closed_url(), QWEN_MODEL="Qwen/Qwen3.5-4B"))
    assert refused_with(result, "QWEN_MODEL(NOT_IN_REGISTRY)") == (EX_CONFIG, True)


# ---------------------------------------------------------------- 레지스트리 항목 상태(ADR-034 6번, 03 §11)


def test_default_kev_model_id_is_bosun(fake_server):
    # KEV_MODEL_ID 미지정 → settings 기본값 bosun-v3.1-0.6b. 가짜 서버 /v1/models 기본 응답(Bosun 값)과 맞아 기동한다
    from sol_ai.settings import Settings

    assert Settings().KEV_MODEL_ID == KEV_MODEL_ID == "bosun-v3.1-0.6b"
    qwen, kev = model_servers(fake_server)
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_retired_kev_model_id_is_refused_before_remote_check(fake_server):
    # 퇴역 Kev 서버가 옛 run 을 그대로 내더라도 retired 항목은 고를 수 없다. 원격 대조(6단계) 전에 멈춘다
    qwen, kev = model_servers(
        fake_server, kev_reply=Reply(json_body=kev_models("jaredpalmer/kev-9b@v1.0"))
    )
    result = run_main(env_for(qwen.url, kev.url, KEV_MODEL_ID=RETIRED_KEV_MODEL_ID))
    assert refused_with(result, "KEV_MODEL_ID(RETIRED)") == (EX_CONFIG, True)
    assert (qwen.calls("GET", "/v1/models"), kev.calls("GET", "/v1/models")) == ([], [])


def test_retired_kev_model_id_is_not_reported_as_unknown():
    result = run_main(env_for(closed_url(), closed_url(), KEV_MODEL_ID=RETIRED_KEV_MODEL_ID))
    assert ("KEV_MODEL_ID(RETIRED)" in result.stderr, "NOT_IN_REGISTRY" in result.stderr) == (
        True,
        False,
    )


def test_qwen_entry_is_not_a_kev_model_id():
    result = run_main(env_for(closed_url(), closed_url(), KEV_MODEL_ID="qwen3.5-27b"))
    assert refused_with(result, "KEV_MODEL_ID(NOT_IN_REGISTRY)") == (EX_CONFIG, True)


def test_retired_qwen_model_is_refused(fake_server):
    qwen, kev = model_servers(
        fake_server, qwen_models=Reply(json_body=vllm_models(RETIRED_QWEN_RUN))
    )
    result = run_main(env_for(qwen.url, kev.url, QWEN_MODEL=RETIRED_QWEN_RUN))
    assert refused_with(result, "QWEN_MODEL(RETIRED)") == (EX_CONFIG, True)
    assert qwen.calls("GET", "/v1/models") == []


def test_backup_qwen_model_is_refused(fake_server):
    qwen, kev = model_servers(
        fake_server, qwen_models=Reply(json_body=vllm_models(BACKUP_QWEN_RUN))
    )
    result = run_main(env_for(qwen.url, kev.url, QWEN_MODEL=BACKUP_QWEN_RUN))
    assert refused_with(result, "QWEN_MODEL(BACKUP)") == (EX_CONFIG, True)
    assert qwen.calls("GET", "/v1/models") == []


def test_qwen_default_is_active_27b_not_retired_9b(fake_server):
    # QWEN_MODEL 미지정 → active default(Qwen/Qwen3.5-27B). 퇴역 9B 만 서빙하는 vLLM 은 불일치다
    qwen, kev = model_servers(
        fake_server, qwen_models=Reply(json_body=vllm_models(RETIRED_QWEN_RUN))
    )
    result = run_main(env_for(qwen.url, kev.url))
    assert refused_with(result, "기동 거부: QWEN_MODEL(REGISTRY_MISMATCH)") == (EX_CONFIG, True)


def test_qwen_default_matches_27b_served(fake_server):
    qwen, kev = model_servers(
        fake_server, qwen_models=Reply(json_body=vllm_models(RETIRED_QWEN_RUN, QWEN_RUN))
    )
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


# ---------------------------------------------------------------- 결정 모델 서버 /v1/models 대조 필드(03 §11)


@pytest.mark.parametrize("field", ["base", "lora", "revision"])
def test_kev_models_field_mismatch_is_registry_mismatch(fake_server, field):
    reply = Reply(json_body=kev_models(**{field: "something-else"}))
    qwen, kev = model_servers(fake_server, kev_reply=reply)
    result = run_main(env_for(qwen.url, kev.url))
    assert refused_with(result, "기동 거부: KEV_MODEL_ID(REGISTRY_MISMATCH)") == (EX_CONFIG, True)


def test_kev_models_without_revision_still_matches(fake_server):
    # 서버가 revision 을 내지 않으면 revision 은 대조하지 않는다(run·base·lora 만)
    qwen, kev = model_servers(
        fake_server, kev_reply=Reply(json_body=kev_models(without=("revision",)))
    )
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_kev_models_temperature_is_not_compared_when_registry_null(fake_server):
    qwen, kev = model_servers(fake_server, kev_reply=Reply(json_body=kev_models(temperature=0.7)))
    assert started(run_main(env_for(qwen.url, kev.url))) == (0, False)


def test_kev_models_missing_lora_is_registry_mismatch(fake_server):
    qwen, kev = model_servers(fake_server, kev_reply=Reply(json_body=kev_models(without=("lora",))))
    result = run_main(env_for(qwen.url, kev.url))
    assert refused_with(result, "기동 거부: KEV_MODEL_ID(REGISTRY_MISMATCH)") == (EX_CONFIG, True)


def test_refusal_hides_registry_hashes(fake_server):
    from support import KEV_LORA_SHA256, KEV_REVISION

    qwen, kev = model_servers(fake_server, kev_reply=Reply(json_body=kev_models(lora="x" * 64)))
    result = run_main(env_for(qwen.url, kev.url))
    output = result.stdout + result.stderr
    assert result.returncode == EX_CONFIG
    assert [v for v in (KEV_LORA_SHA256, KEV_REVISION, "x" * 64) if v in output] == []


# ---------------------------------------------------------------- URL 보안(3). 같은 프로세스(연결 차단)


def refusal_summary(make_client) -> str:
    from sol_ai.errors import StartupRefused

    with pytest.raises(StartupRefused) as refused:
        make_client(SOL_RUN_MODE="fixture")
    return str(refused.value)


@pytest.mark.parametrize("key", ["QWEN_BASE_URL", "KEV_BASE_URL"])
def test_public_http_url_is_insecure(make_client, monkeypatch, key):
    for name, value in env_for(closed_url(), closed_url()).items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv(key, OUTSIDE_HTTP)
    assert f"{key}(INSECURE_URL)" in refusal_summary(make_client)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost"])
def test_loopback_http_url_is_allowed(make_client, monkeypatch, host):
    url = f"http://{host}:{free_port()}"
    for name, value in env_for(url, url).items():
        monkeypatch.setenv(name, value)
    assert make_client(SOL_RUN_MODE="fixture").get("/health").status_code == 200


def test_non_loopback_https_url_is_not_insecure(make_client, monkeypatch):
    # https 는 형식상 허용. 레지스트리 밖 KEV_MODEL_ID 로 원격 대조(6단계) 전에 기동을 멈춰 접속하지 않게 한다
    for name, value in env_for(
        "https://example.invalid", "https://example.invalid", KEV_MODEL_ID="kev-unknown-v9"
    ).items():
        monkeypatch.setenv(name, value)
    summary = refusal_summary(make_client)
    assert ("KEV_MODEL_ID(NOT_IN_REGISTRY)" in summary, "INSECURE_URL" in summary) == (True, False)
