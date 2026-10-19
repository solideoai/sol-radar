"""공용 fixture: 실행 모드 규칙 파일, 환경 격리, 외부 네트워크 차단, 시험 클라이언트."""

import ipaddress
import json
import os
import socket
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from support import write_fixture_dir

from sol_ai.app import create_app
from sol_ai.run_mode import rule_env_keys
from sol_ai.settings import Settings

# services/ai/tests/conftest.py -> 저장소 루트
REPO_ROOT = Path(__file__).resolve().parents[3]
RULES_FILE = REPO_ROOT / "infra" / "run-modes.json"


@pytest.fixture(scope="session")
def rules() -> dict:
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))


# 규칙 파일이 가리키는 키 외에 Settings·어댑터가 읽는 비밀·주소·동작 키. 호출자 셸 값이 시험에 새지 않게 비운다.
EXTRA_ENV_KEYS = (
    "SOL_RUN_MODES_FILE",
    "AI_HOST",
    "HOSTED_API_KEY",
    "HOSTED_API_BASE_URL",
    "CITATION_FUZZY_MIN_RATIO",
    "SOL_FIXTURES_DIR",
)
EXTRA_ENV_PREFIXES = ("QWEN_", "KEV_", "AI_", "PARSER_")


@pytest.fixture(autouse=True)
def _isolate_run_mode_env(monkeypatch: pytest.MonkeyPatch) -> None:
    rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    keys = set(rule_env_keys(rules)) | set(EXTRA_ENV_KEYS)
    keys |= {k for k in os.environ if k.startswith(EXTRA_ENV_PREFIXES)}
    for key in keys:
        monkeypatch.delenv(key, raising=False)


def _is_local_host(host: object) -> bool:
    if host is None or host in ("", "localhost", "testserver"):
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False


@pytest.fixture(autouse=True)
def _block_external_network(monkeypatch: pytest.MonkeyPatch):
    """시험 중 loopback 밖으로의 연결·이름 조회를 막고, 시도가 있었으면 시험을 실패시킨다.

    같은 프로세스 안의 socket 만 막는다. subprocess 기동 시험(test_startup 등)은 연결을 하지 않으므로 영향이 없다.
    앱이 예외를 삼켜 500 으로 바꿔도 시도 기록은 남으므로 teardown 에서 잡힌다.
    """
    attempts: list[str] = []
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def check(sock: socket.socket, address) -> None:
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not _is_local_host(address[0]):
            attempts.append(f"connect {address!r}")
            raise ConnectionRefusedError("시험 중 외부 네트워크 연결 차단")

    def guarded_connect(self, address):
        check(self, address)
        return real_connect(self, address)

    def guarded_connect_ex(self, address):
        check(self, address)
        return real_connect_ex(self, address)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if not _is_local_host(host):
            attempts.append(f"getaddrinfo {host!r}")
            raise socket.gaierror("시험 중 외부 이름 조회 차단")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", guarded_getaddrinfo)
    yield
    if attempts:
        pytest.fail(f"외부 네트워크 시도 {len(attempts)}건: {attempts}")


@pytest.fixture
def make_client():
    """create_app(Settings(...)) 로 앱을 만들고 lifespan 을 연 TestClient 를 돌려준다.

    env(monkeypatch.setenv)는 이 함수를 부르기 전에 둔다. Settings 는 생성 시점의 env 를 읽는다.
    """
    opened: list[TestClient] = []

    def _make(*, raise_server_exceptions: bool = True, **settings) -> TestClient:
        settings.setdefault("SOL_RUN_MODE", "mock")
        client = TestClient(
            create_app(Settings(**settings)), raise_server_exceptions=raise_server_exceptions
        )
        client.__enter__()
        opened.append(client)
        return client

    yield _make
    for client in reversed(opened):
        client.__exit__(None, None, None)


@pytest.fixture
def custom_fixtures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """시험 전용 fixture 디렉터리를 만들고 SOL_FIXTURES_DIR 로 가리킨다(make_client 전에 부른다)."""

    def _point(
        extractions: dict[str, dict] | None = None, kev: dict[str, dict] | None = None
    ) -> Path:
        root = write_fixture_dir(tmp_path / "fixtures", extractions, kev)
        monkeypatch.setenv("SOL_FIXTURES_DIR", str(root))
        return root

    return _point


@pytest.fixture
def allow_disabled_kev_rules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, rules: dict):
    """Adapter-off tests opt into temporary rules; repository startup rules stay unchanged."""

    def _allow() -> None:
        isolated_rules = deepcopy(rules)
        for spec in isolated_rules["modes"].values():
            spec["KEV_ENABLED"] = ["true", "false"]
        rules_file = tmp_path / "adapter-off-run-modes.json"
        rules_file.write_text(json.dumps(isolated_rules), encoding="utf-8")
        monkeypatch.setenv("SOL_RUN_MODES_FILE", str(rules_file))

    return _allow
