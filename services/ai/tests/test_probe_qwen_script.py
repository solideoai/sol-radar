"""scripts/probe-qwen-api.py 의 URL 거부·--dry-run 경로(3e 보안 검토 L3). 네트워크를 쓰지 않는다.

스크립트는 import 하지 않고 subprocess 로 띄운다(scripts/ 는 패키지가 아니다). 키 없이 돌리므로 어떤 경로도
실요청을 보내지 않는다(키가 있어도 URL 거부는 키 검사보다 앞이다).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "probe-qwen-api.py"
COMPANY = "https://acropolissg.com/vllm/v1"


def run_probe(*args: str, base_url: str, key: str | None = None) -> subprocess.CompletedProcess:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "QWEN_BASE_URL": base_url,
        "QWEN_MODEL": "Qwen/Qwen3.5-27B",
        # 프록시·HF 설정 등 바깥 env 는 넘기지 않는다
    }
    if key is not None:
        env["QWEN_API_KEY"] = key
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.mark.parametrize(
    ("base_url", "reason"),
    [
        ("https://evil.example.com/v1", "HOST_NOT_ALLOWED"),
        ("https://vllm.acropolissg.com/v1", "HOST_NOT_ALLOWED"),
        ("http://acropolissg.com/vllm/v1", "INSECURE_URL"),
        ("https://user:pw@acropolissg.com/vllm/v1", "URL_HAS_CREDENTIALS"),
    ],
)
def test_url_outside_allowlist_is_refused_before_any_request(base_url, reason):
    # 키가 있어도 보내지 않는다. stdout 에 요청 계획도 없고, 키 값은 어디에도 없다
    result = run_probe("--dry-run", base_url=base_url, key="probe-test-key-must-not-leak")
    assert result.returncode == 3, result.stderr
    assert reason in result.stderr
    assert result.stdout == ""
    assert "probe-test-key-must-not-leak" not in result.stdout + result.stderr
    assert "evil.example.com" not in result.stderr


def test_key_and_no_dry_run_still_refused_before_sending():
    """실제로 키가 나갈 수 있는 경로(키 있음·--dry-run 없음·허용 밖 호스트)도 검사가 막는다.

    .invalid 는 예약 TLD 라 검사를 빼면 DNS 실패(exit 1)로 끝나고 트래픽은 나가지 않는다 — 변형이 잡힌다.
    """
    result = run_probe(base_url="https://evil.invalid/v1", key="probe-test-key-must-not-leak")
    assert result.returncode == 3, result.stderr
    assert "HOST_NOT_ALLOWED" in result.stderr
    assert result.stdout == ""
    assert "probe-test-key-must-not-leak" not in result.stdout + result.stderr


def test_allowed_host_dry_run_prints_plan_without_sending():
    result = run_probe("--dry-run", base_url=COMPANY)
    assert result.returncode == 0, result.stderr
    plan = json.loads(result.stdout)
    assert plan["dryRun"] is True
    assert [r["url"] for r in plan["requests"]] == [
        "https://acropolissg.com/vllm/v1/models",
        "https://acropolissg.com/vllm/v1/chat/completions",
    ]
    assert all(r["authorization"] == "bearer(missing)" for r in plan["requests"])


def test_loopback_http_is_allowed_for_local_vllm():
    result = run_probe("--dry-run", base_url="http://127.0.0.1:8001")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["requests"][0]["url"] == "http://127.0.0.1:8001/v1/models"


def test_missing_key_on_allowed_host_exits_2_without_sending():
    result = run_probe(base_url=COMPANY)
    assert result.returncode == 2
    assert "QWEN_API_KEY" in result.stderr
    assert result.stdout == ""
