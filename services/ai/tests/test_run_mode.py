"""V2-01: resolve_run_mode 판정표. scripts/check-env.test.mjs 의 resolveRunMode 시험과 같은 입력·기대값."""

import pytest

from sol_ai.run_mode import resolve_run_mode


def pairs(result) -> list[tuple[str, str]]:
    return [(v.key, v.reason) for v in result.violations]


def test_v2_01_unset_is_mock(rules):
    result = resolve_run_mode({}, rules)
    assert result.mode == "mock"
    assert result.effective["AI_PROVIDER"] == "mock"
    assert result.violations == []


def test_v2_01_empty_string_equals_unset(rules):
    empty = resolve_run_mode({"SOL_RUN_MODE": ""}, rules)
    assert empty.mode == "mock"
    assert empty.violations == []
    provider = resolve_run_mode({"SOL_RUN_MODE": "live", "AI_PROVIDER": ""}, rules)
    assert provider.effective["AI_PROVIDER"] == "local"
    assert provider.violations == []


@pytest.mark.parametrize(
    "env",
    [
        {"SOL_RUN_MODE": "live"},
        {"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "local"},
        {"SOL_RUN_MODE": "mock", "KEV_ENABLED": "true"},
        {"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "hosted", "AI_HOSTED_APPROVED": "true"},
    ],
)
def test_v2_01_valid_combination_passes(rules, env):
    assert resolve_run_mode(env, rules).violations == []


@pytest.mark.parametrize(
    ("env", "key", "reason"),
    [
        ({"SOL_RUN_MODE": "live", "AI_PROVIDER": "mock"}, "AI_PROVIDER", "CONTRADICTS_MODE"),
        (
            {"SOL_RUN_MODE": "live", "AI_FALLBACK_TO_MOCK": "true"},
            "AI_FALLBACK_TO_MOCK",
            "FORBIDDEN_IN_MODE",
        ),
        (
            {"SOL_RUN_MODE": "live", "KEV_ALLOW_KO_STATE": "true"},
            "KEV_ALLOW_KO_STATE",
            "FORBIDDEN_IN_MODE",
        ),
        ({"SOL_RUN_MODE": "mock", "DEMO_MODE": "false"}, "DEMO_MODE", "CONTRADICTS_MODE"),
        ({"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "mock"}, "AI_PROVIDER", "CONTRADICTS_MODE"),
        ({"SOL_RUN_MODE": "mock", "AI_PROVIDER": "hosted"}, "AI_PROVIDER", "CONTRADICTS_MODE"),
        (
            {"SOL_RUN_MODE": "fixture", "AI_PROVIDER": "hosted"},
            "AI_HOSTED_APPROVED",
            "HOSTED_NOT_APPROVED",
        ),
        ({"SOL_RUN_MODE": "LIVE"}, "SOL_RUN_MODE", "UNKNOWN_MODE"),
        ({"SOL_RUN_MODE": " mock"}, "SOL_RUN_MODE", "UNKNOWN_MODE"),
    ],
)
def test_v2_01_contradiction_names_key(rules, env, key, reason):
    assert pairs(resolve_run_mode(env, rules)) == [(key, reason)]


def test_v2_01_unknown_mode_has_null_mode_and_effective(rules):
    result = resolve_run_mode({"SOL_RUN_MODE": "LIVE", "AI_PROVIDER": "mock"}, rules)
    assert result.mode is None
    assert result.effective is None
    assert len(result.violations) == 1


def test_v2_01_forbidden_key_only_on_exact_value(rules):
    result = resolve_run_mode({"SOL_RUN_MODE": "live", "AI_FALLBACK_TO_MOCK": "false"}, rules)
    assert result.violations == []


def test_v2_01_multiple_violations_in_decision_order(rules):
    live = resolve_run_mode(
        {
            "SOL_RUN_MODE": "live",
            "DEMO_MODE": "true",
            "AI_PROVIDER": "mock",
            "KEV_ENABLED": "false",
            "KEV_ALLOW_KO_STATE": "true",
            "AI_FALLBACK_TO_MOCK": "true",
        },
        rules,
    )
    assert pairs(live) == [
        ("DEMO_MODE", "CONTRADICTS_MODE"),
        ("AI_PROVIDER", "CONTRADICTS_MODE"),
        ("KEV_ENABLED", "CONTRADICTS_MODE"),
        ("AI_FALLBACK_TO_MOCK", "FORBIDDEN_IN_MODE"),
        ("KEV_ALLOW_KO_STATE", "FORBIDDEN_IN_MODE"),
    ]
    fixture = resolve_run_mode(
        {"SOL_RUN_MODE": "fixture", "DEMO_MODE": "false", "AI_PROVIDER": "hosted"}, rules
    )
    assert pairs(fixture) == [
        ("DEMO_MODE", "CONTRADICTS_MODE"),
        ("AI_HOSTED_APPROVED", "HOSTED_NOT_APPROVED"),
    ]
