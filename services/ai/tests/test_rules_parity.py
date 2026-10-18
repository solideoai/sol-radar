"""V2-01: 판정 입력은 규칙 파일에서 나오고, env 키는 대소문자를 구분해 읽는다."""

import copy
import json
import os
import subprocess
import sys

from sol_ai.run_mode import resolve_run_mode, rule_env_keys
from sol_ai.settings import Settings

EX_CONFIG = 78


def test_v2_01_rule_keys_cover_every_forbidden_key(rules):
    keys = rule_env_keys(rules)
    for spec in rules["modes"].values():
        assert set(spec["forbidden"]) <= keys
    assert rules["hostedApproval"]["key"] in keys


def test_v2_01_new_forbidden_key_in_rules_refuses_startup(rules, tmp_path):
    custom = copy.deepcopy(rules)
    custom["modes"]["mock"]["forbidden"]["NEW_FORBIDDEN_KEY"] = "on"
    rules_file = tmp_path / "run-modes.json"
    rules_file.write_text(json.dumps(custom), encoding="utf-8")
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("SOL_", "AI_", "KEV_", "HOSTED_")) and k != "DEMO_MODE"
    }
    env.update({"SOL_RUN_MODES_FILE": str(rules_file), "NEW_FORBIDDEN_KEY": "on"})
    result = subprocess.run(
        [sys.executable, "-m", "sol_ai"],
        check=False,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == EX_CONFIG
    assert "기동 거부: NEW_FORBIDDEN_KEY(FORBIDDEN_IN_MODE)" in result.stderr


def test_v2_01_settings_env_includes_forbidden_keys_from_rules(rules, monkeypatch):
    monkeypatch.setenv("AI_FALLBACK_TO_MOCK", "true")
    env = Settings(SOL_RUN_MODE="live").as_env(rules)
    assert env["AI_FALLBACK_TO_MOCK"] == "true"
    assert env["SOL_RUN_MODE"] == "live"


def test_v2_01_lowercase_keys_are_not_read(rules, monkeypatch):
    for name in ("AI_PROVIDER", "SOL_RUN_MODE", "KEV_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ai_provider", "mock")
    monkeypatch.setenv("sol_run_mode", "fixture")
    settings = Settings(SOL_RUN_MODE="live")
    env = settings.as_env(rules)
    assert "ai_provider" not in env
    assert settings.AI_PROVIDER is None
    result = resolve_run_mode(env, rules)
    assert result.effective["AI_PROVIDER"] == "local"
    assert result.violations == []
