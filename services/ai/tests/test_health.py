"""V2-01: GET /health 계약(Phase 0)."""

from fastapi.testclient import TestClient

from sol_ai.app import create_app
from sol_ai.settings import Settings


def test_health_mock_mode():
    client = TestClient(create_app(Settings(SOL_RUN_MODE="mock")))
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "runMode": "mock",
        "provider": "mock",
        "kevEnabled": True,
        "qwen": None,
        "kev": None,
        "questionSets": [],
        "parsers": [],
    }
