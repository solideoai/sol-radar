"""실행 모드 판정. 규칙 원천은 infra/run-modes.json 이고 Node(scripts/run-mode.mjs)와 같은 판정을 낸다."""

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

CHECKED_KEYS = ("DEMO_MODE", "AI_PROVIDER", "KEV_ENABLED")


@dataclass(frozen=True)
class Violation:
    key: str
    reason: str


@dataclass(frozen=True)
class RunModeResult:
    mode: str | None
    effective: dict[str, str] | None
    violations: list[Violation] = field(default_factory=list)


def rules_path() -> Path:
    """규칙 파일 경로. env SOL_RUN_MODES_FILE 이 우선이고, 없으면 저장소의 infra/run-modes.json."""
    override = os.environ.get("SOL_RUN_MODES_FILE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[4] / "infra" / "run-modes.json"


def load_rules() -> dict:
    return json.loads(rules_path().read_text(encoding="utf-8"))


def rule_env_keys(rules: dict) -> set[str]:
    """판정에 쓰는 env 키 집합. 규칙 파일에서만 나온다(코드에 키를 따로 적지 않는다)."""
    keys = {"SOL_RUN_MODE", rules["hostedApproval"]["key"], *CHECKED_KEYS}
    for spec in rules["modes"].values():
        keys.update(spec["forbidden"])
    return keys


def _given(value: str | None) -> str | None:
    """None 과 빈 문자열은 "미지정"이다. 그 밖의 값은 고치지 않고 그대로 쓴다."""
    return None if value is None or value == "" else value


def resolve_run_mode(env: Mapping[str, str], rules: dict) -> RunModeResult:
    """판정 순서: SOL_RUN_MODE, DEMO_MODE, AI_PROVIDER, KEV_ENABLED, forbidden, hosted 승인.

    requiredSecrets 는 보지 않는다(gateway 는 서비스키를 받지 않는다. Node resolveRunMode 와 같다).
    """
    requested = _given(env.get("SOL_RUN_MODE")) or rules["default"]
    if requested not in rules["modes"]:
        return RunModeResult(None, None, [Violation("SOL_RUN_MODE", "UNKNOWN_MODE")])
    spec = rules["modes"][requested]
    violations: list[Violation] = []

    effective: dict[str, str] = {}
    for key in CHECKED_KEYS:
        effective[key] = _given(env.get(key)) or spec[key][0]
        if effective[key] not in spec[key]:
            violations.append(Violation(key, "CONTRADICTS_MODE"))

    for key, forbidden_value in spec["forbidden"].items():
        if _given(env.get(key)) == forbidden_value:
            violations.append(Violation(key, "FORBIDDEN_IN_MODE"))

    approval = rules["hostedApproval"]
    if (
        effective["AI_PROVIDER"] == approval["provider"]
        and approval["provider"] in spec["AI_PROVIDER"]
        and _given(env.get(approval["key"])) != approval["value"]
    ):
        violations.append(Violation(approval["key"], "HOSTED_NOT_APPROVED"))

    return RunModeResult(requested, effective, violations)
