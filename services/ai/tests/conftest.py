"""공용 fixture: 저장소의 실행 모드 규칙 파일을 읽어 시험에 넘긴다."""

import json
import os
from pathlib import Path

import pytest

from sol_ai.run_mode import rule_env_keys

# services/ai/tests/conftest.py -> 저장소 루트
REPO_ROOT = Path(__file__).resolve().parents[3]
RULES_FILE = REPO_ROOT / "infra" / "run-modes.json"


@pytest.fixture(scope="session")
def rules() -> dict:
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))


# 규칙 파일이 가리키는 키 외에 Settings·어댑터가 읽는 비밀·주소 키. 호출자 셸 값이 시험에 새지 않게 비운다.
EXTRA_ENV_KEYS = ("SOL_RUN_MODES_FILE", "AI_HOST", "HOSTED_API_KEY", "HOSTED_API_BASE_URL")
EXTRA_ENV_PREFIXES = ("QWEN_", "KEV_", "AI_")


@pytest.fixture(autouse=True)
def _isolate_run_mode_env(monkeypatch: pytest.MonkeyPatch) -> None:
    rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    keys = set(rule_env_keys(rules)) | set(EXTRA_ENV_KEYS)
    keys |= {k for k in os.environ if k.startswith(EXTRA_ENV_PREFIXES)}
    for key in keys:
        monkeypatch.delenv(key, raising=False)
