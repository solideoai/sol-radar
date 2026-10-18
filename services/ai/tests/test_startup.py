"""V2-01: python -m sol_ai 기동 거부. 위반이면 exit 78, stderr 에 키 이름만 쓴다."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

RULES_FILE = Path(__file__).resolve().parents[3] / "infra" / "run-modes.json"
EX_CONFIG = 78
# 부모 환경에서 섞이면 안 되는 접두사·이름
LEAKY_PREFIXES = ("SOL_", "AI_", "KEV_", "HOSTED_")
LEAKY_NAMES = {"DEMO_MODE"}


def run_gateway(extra: dict[str, str]) -> subprocess.CompletedProcess[str]:
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(LEAKY_PREFIXES) and k not in LEAKY_NAMES
    }
    env["SOL_RUN_MODES_FILE"] = str(RULES_FILE)
    env.update(extra)
    return subprocess.run(
        [sys.executable, "-m", "sol_ai"],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_refuses_live_with_mock_provider():
    result = run_gateway({"SOL_RUN_MODE": "live", "AI_PROVIDER": "mock"})
    assert result.returncode == EX_CONFIG
    assert "AI_PROVIDER" in result.stderr
    assert "기동 거부: AI_PROVIDER(CONTRADICTS_MODE)" in result.stderr


def test_refuses_unapproved_hosted():
    result = run_gateway({"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "hosted"})
    assert result.returncode == EX_CONFIG
    assert "AI_HOSTED_APPROVED" in result.stderr


@pytest.mark.parametrize("approved", [None, "false"])
def test_refuses_hosted_unless_approved_true(approved):
    extra = {"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "hosted"}
    if approved is not None:
        extra["AI_HOSTED_APPROVED"] = approved
    result = run_gateway(extra)
    assert result.returncode == EX_CONFIG
    assert "AI_HOSTED_APPROVED(HOSTED_NOT_APPROVED)" in result.stderr


def test_refusal_does_not_print_values():
    result = run_gateway(
        {
            "SOL_RUN_MODE": "fixture",
            "AI_PROVIDER": "hosted",
            "HOSTED_API_KEY": "sk-test-SECRET-123",
        }
    )
    # exit 78 단언을 함께 둬서, 기동 자체가 실패해 출력이 비어도 통과하지 않게 한다.
    assert result.returncode == EX_CONFIG
    assert "AI_HOSTED_APPROVED" in result.stderr
    assert (result.stdout + result.stderr).count("SECRET") == 0
