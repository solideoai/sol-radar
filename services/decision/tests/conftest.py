"""공용 fixture. torch 없이 돈다.

- gateway 파서(services/ai/src/sol_ai/adapters/kev_wire.py)를 그대로 import 해 parity 를 확인한다(sys.path 에 ../ai/src).
- 환경 격리: DECISION_* 를 비운다. 키는 가짜 값이다.
"""

import json
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from sol_decision.app import ServerConfig, create_app
from sol_decision.backend import DecisionBackend, FakeBackend

DECISION_ROOT = Path(__file__).resolve().parents[1]  # services/decision
SERVICES_ROOT = DECISION_ROOT.parent
REPO_ROOT = SERVICES_ROOT.parent
AI_SRC = SERVICES_ROOT / "ai" / "src"
QUESTION_SET_FILE = SERVICES_ROOT / "ai" / "kev" / "question-sets" / "v0.2.json"
REGISTRY_FILE = SERVICES_ROOT / "ai" / "models" / "registry.yaml"

API_KEY = "decision-test-key-0001"
ALIAS = "bosun-v3.1-0.6b"


def gateway_module(name: str) -> ModuleType:
    """게이트웨이 모듈을 import 한다(시험 전용). 제품 코드는 services/ai 에 의존하지 않는다."""
    if str(AI_SRC) not in sys.path:
        sys.path.insert(0, str(AI_SRC))
    module = __import__(name, fromlist=["_"])
    return module


@pytest.fixture(scope="session")
def kev_wire() -> ModuleType:
    return gateway_module("sol_ai.adapters.kev_wire")


@pytest.fixture(scope="session")
def question_set() -> dict:
    return json.loads(QUESTION_SET_FILE.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "DECISION_API_KEY",
        "DECISION_TIMEOUT_MS",
        "DECISION_RUN",
        "DECISION_REVISION",
        "DECISION_BASE",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def make_client() -> Callable[..., TestClient]:
    def _make(
        backend: DecisionBackend | None = None,
        *,
        timeout_ms: int = 4_500,
        alias: str = ALIAS,
        seed: int = 0,
        clock=None,
    ) -> TestClient:
        config = ServerConfig(
            api_key=SecretStr(API_KEY), alias=alias, timeout_ms=timeout_ms, seed=seed
        )
        kwargs = {} if clock is None else {"clock": clock}
        app = create_app(backend or FakeBackend(), config, **kwargs)
        return TestClient(app, raise_server_exceptions=False)

    return _make


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}"}
