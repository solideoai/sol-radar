"""Vercel 서비스 경계 밖의 저장소 파일 없이 실행되는지 검증한다."""

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

AI_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_ROOT.parents[1]


def deployment_tree(tmp_path: Path, module_root: str = "src") -> Path:
    root = tmp_path / "ai"
    root.mkdir()
    shutil.copytree(AI_ROOT / "src", root / module_root)
    for directory in ("schemas", "prompts", "guards", "dictionaries", "kev", "models"):
        shutil.copytree(AI_ROOT / directory, root / directory)
    entrypoint = AI_ROOT / "app.py"
    assert entrypoint.is_file(), "Vercel FastAPI 진입점이 필요하다"
    shutil.copy2(entrypoint, root / "app.py")
    builder = AI_ROOT / "prepare_vercel.py"
    assert builder.is_file(), "서비스 밖 자료를 포함하는 빌드 단계가 필요하다"
    spec = importlib.util.spec_from_file_location("prepare_vercel", builder)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare(REPO_ROOT, root)
    return root


def run_isolated(root: Path, script: str, **env: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=root,
        env={
            **os.environ,
            "PYTHONPATH": str(root / ("src" if (root / "src").exists() else "_vendor")),
            **env,
        },
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


@pytest.mark.parametrize("module_root", ["src", "_vendor"])
def test_isolated_service_has_runtime_data_and_original_routes(tmp_path, module_root):
    root = deployment_tree(tmp_path, module_root)
    result = run_isolated(
        root,
        """
from fastapi.testclient import TestClient
from app import app
from pathlib import Path
from sol_ai.paths import AI_ROOT, fixtures_dir
assert AI_ROOT == Path.cwd(), 'installed package must resolve the deployed service root'
with TestClient(app) as client:
    health = client.get('/health')
    assert health.status_code == 200, health.text
    assert health.json()['provider'] == 'mock'
    assert health.json()['kevEnabled'] is True
    parsed = client.post('/parse', content=b'%PDF-1.7 test')
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()['format'] == 'PDF'
    assert client.get('/ai/health').status_code == 404
assert (fixtures_dir(None) / 'extractions' / 'FX-01.json').is_file()
""",
        SOL_RUN_MODE="mock",
    )
    assert result.returncode == 0, result.stderr
    assert sorted(path.name for path in (root / "_vercel_data").iterdir()) == [
        "fixtures",
        "run-modes.json",
    ]
    assert sorted(path.name for path in (root / "_vercel_data" / "fixtures").iterdir()) == [
        "extractions",
        "kev",
    ]


def test_build_import_does_not_validate_runtime_settings_or_call_models(tmp_path):
    root = deployment_tree(tmp_path)
    result = run_isolated(
        root,
        """
import socket
def blocked(*args, **kwargs):
    raise AssertionError('build must not contact models')
socket.socket.connect = blocked
from app import app
from fastapi import FastAPI
assert isinstance(app, FastAPI)
""",
        SOL_RUN_MODE="live",
        AI_PROVIDER="hosted",
        AI_HOSTED_APPROVED="false",
    )
    assert result.returncode == 0, result.stderr


def test_runtime_still_refuses_invalid_mode_settings(tmp_path):
    root = deployment_tree(tmp_path)
    result = run_isolated(
        root,
        """
from fastapi.testclient import TestClient
from app import app
from sol_ai.errors import StartupRefused
try:
    with TestClient(app):
        pass
except StartupRefused:
    pass
else:
    raise AssertionError('runtime must validate mode settings')
""",
        SOL_RUN_MODE="live",
        AI_PROVIDER="mock",
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("key", ["SOL_FIXTURES_DIR", "SOL_RUN_MODES_FILE"])
def test_deployment_defaults_preserve_explicit_paths(tmp_path, key):
    root = deployment_tree(tmp_path)
    result = run_isolated(
        root,
        """
from pathlib import Path
from sol_ai.paths import fixtures_dir
from sol_ai.run_mode import rules_path
import os
key = os.environ['TEST_PATH_KEY']
actual = rules_path() if key == 'SOL_RUN_MODES_FILE' else fixtures_dir(os.environ[key])
assert actual == Path('/custom/runtime-data')
""",
        **{key: "/custom/runtime-data", "TEST_PATH_KEY": key},
    )
    assert result.returncode == 0, result.stderr
