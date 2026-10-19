"""V2-01·K13: python -m sol_ai 기동 거부. 위반이면 exit 78, stderr 에 키 이름(사유)만 쓴다."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fake_models import closed_url
from support import KEV_KEY, extraction_fixture, run_main, write_fixture_dir

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


# ---------------------------------------------------------------- K13 mock 추출 fixture model 블록 기동 검사
# mock 은 추출 fixture 의 model.name·promptVersion·promptHash 가 파일마다 다르거나 추출 fixture 가 없으면
# 기동을 거부한다. fixture 모드(AI_PROVIDER=local)는 이 검사를 하지 않는다.
# 검사를 통과한 경우 서버가 뜨지 않게 uvicorn.run 만 비우고 sol_ai.__main__.main 을 그대로 부른다
# (통과면 exit 0, 거부면 exit 78). 포트를 열지 않는다.

MODEL_MISMATCH = "기동 거부: SOL_FIXTURES_DIR(MOCK_FIXTURE_MODEL_MISMATCH)"
FIXTURES_MISSING = "기동 거부: SOL_FIXTURES_DIR(MOCK_FIXTURES_MISSING)"


def mismatched_fixture_dir(root, key: str, value: str):
    other = extraction_fixture("FX-02")
    other["model"][key] = value
    return write_fixture_dir(root, {"FX-01": extraction_fixture("FX-01"), "FX-02": other})


def test_k13_main_starts_mock_with_real_fixtures():
    # 대조군: 실제 fixtures/extractions 로는 기동한다(이 실행 방식이 거부를 지어내지 않음을 보인다)
    result = run_main({"SOL_RUN_MODE": "mock"})
    assert (result.returncode, "기동 거부" in result.stderr) == (0, False)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("promptHash", "0" * 64),
        ("name", "fixture-other"),
        ("promptVersion", "req-extract/v0.2"),
    ],
)
def test_k13_mock_refuses_fixtures_with_different_model_identity(tmp_path, key, value):
    root = mismatched_fixture_dir(tmp_path / "fixtures", key, value)
    result = run_main({"SOL_RUN_MODE": "mock", "SOL_FIXTURES_DIR": str(root)})
    assert result.returncode == EX_CONFIG
    assert MODEL_MISMATCH in result.stderr


@pytest.mark.parametrize("layout", ["empty_extractions_dir", "no_extractions_dir"])
def test_k13_mock_refuses_without_extraction_fixtures(tmp_path, layout):
    root = tmp_path / "fixtures"
    if layout == "empty_extractions_dir":
        write_fixture_dir(root)
    else:
        root.mkdir()
    result = run_main({"SOL_RUN_MODE": "mock", "SOL_FIXTURES_DIR": str(root)})
    assert result.returncode == EX_CONFIG
    assert FIXTURES_MISSING in result.stderr


def test_k13_refusal_does_not_print_model_values(tmp_path):
    root = mismatched_fixture_dir(tmp_path / "fixtures", "promptHash", "0" * 64)
    result = run_main({"SOL_RUN_MODE": "mock", "SOL_FIXTURES_DIR": str(root)})
    assert result.returncode == EX_CONFIG
    output = result.stdout + result.stderr
    assert ("0" * 64 in output, extraction_fixture("FX-01")["model"]["promptHash"] in output) == (
        False,
        False,
    )


def test_k13_mock_allows_other_model_fields_to_differ(tmp_path):
    root = mismatched_fixture_dir(tmp_path / "fixtures", "extractedAt", "2026-10-17T09:00:00Z")
    result = run_main({"SOL_RUN_MODE": "mock", "SOL_FIXTURES_DIR": str(root)})
    assert (result.returncode, "기동 거부" in result.stderr) == (0, False)


def test_k13_fixture_mode_skips_fixture_model_check(tmp_path):
    # fixture 모드는 local 기동 검사(엔드포인트 설정)를 통과해야 하므로 닫힌 127.0.0.1 포트를 준다(L1: 미확인 → 기동)
    root = mismatched_fixture_dir(tmp_path / "fixtures", "promptHash", "0" * 64)
    result = run_main(
        {
            "SOL_RUN_MODE": "fixture",
            "SOL_FIXTURES_DIR": str(root),
            "QWEN_BASE_URL": closed_url(),
            "KEV_BASE_URL": closed_url(),
            "KEV_API_KEY": KEV_KEY,
        }
    )
    assert (result.returncode, "기동 거부" in result.stderr) == (0, False)


def test_m2_hosted_with_korean_state_refuses_startup():
    result = run_main(
        {
            "SOL_RUN_MODE": "fixture",
            "AI_PROVIDER": "hosted",
            "AI_HOSTED_APPROVED": "true",
            "KEV_ALLOW_KO_STATE": "true",
        }
    )
    assert result.returncode == EX_CONFIG
    assert "기동 거부: KEV_ALLOW_KO_STATE(FORBIDDEN_WITH_HOSTED)" in result.stderr
