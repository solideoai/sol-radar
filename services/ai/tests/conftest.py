"""공용 fixture: 저장소의 실행 모드 규칙 파일을 읽어 시험에 넘긴다."""

import json
from pathlib import Path

import pytest

# services/ai/tests/conftest.py -> 저장소 루트
REPO_ROOT = Path(__file__).resolve().parents[3]
RULES_FILE = REPO_ROOT / "infra" / "run-modes.json"


@pytest.fixture(scope="session")
def rules() -> dict:
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))
