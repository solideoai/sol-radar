"""GET /health(local, local 명세 §5). 원격을 부르지 않고 기동·호출 때 정한 값만 보인다."""

from fake_models import closed_url
from support import KEV_MODEL_ID, QWEN_RUN, expected_prompt_hash

PARSERS = [
    {"format": "PDF", "parserId": None},
    {"format": "HWPX", "parserId": None},
    {"format": "HWP", "parserId": None},
]


def test_local_health_reports_models_and_registry_match(make_client, local_models):
    body = make_client(SOL_RUN_MODE="fixture").get("/health").json()
    assert body == {
        "status": "ok",
        "runMode": "fixture",
        "provider": "local",
        "kevEnabled": True,
        "qwen": {"model": QWEN_RUN, "promptHash": expected_prompt_hash()},
        "kev": {"modelId": KEV_MODEL_ID, "registryMatch": True},
        "questionSets": ["kev-qs/v0.1"],
        "parsers": PARSERS,
    }


def test_local_health_prompt_hash_follows_prompt_version(make_client, local_models, monkeypatch):
    monkeypatch.setenv("AI_PROMPT_VERSION", "req-extract/v0.1-test")
    qwen = make_client(SOL_RUN_MODE="fixture").get("/health").json()["qwen"]
    assert qwen == {"model": QWEN_RUN, "promptHash": expected_prompt_hash("req-extract/v0.1-test")}


def test_local_health_registry_match_is_null_when_kev_unreachable(
    make_client, local_models, monkeypatch
):
    monkeypatch.setenv("KEV_BASE_URL", closed_url())
    kev = make_client(SOL_RUN_MODE="fixture").get("/health").json()["kev"]
    assert kev == {"modelId": KEV_MODEL_ID, "registryMatch": None}


def test_local_health_without_kev(make_client, local_models, monkeypatch):
    monkeypatch.setenv("KEV_ENABLED", "false")
    body = make_client(SOL_RUN_MODE="fixture").get("/health").json()
    assert (body["kevEnabled"], body["kev"], body["questionSets"], body["qwen"]) == (
        False,
        None,
        [],
        {"model": QWEN_RUN, "promptHash": expected_prompt_hash()},
    )


def test_local_registry_check_runs_once_and_health_calls_nothing(make_client, local_models):
    client = make_client(SOL_RUN_MODE="fixture")
    before = (len(local_models.qwen.requests), len(local_models.kev.requests))
    for _ in range(3):
        client.get("/health")
    after = (len(local_models.qwen.requests), len(local_models.kev.requests))
    assert (before, after) == ((1, 1), (1, 1))
