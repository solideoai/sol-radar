import { readFileSync } from "node:fs";

const RULES_URL = new URL("../infra/run-modes.json", import.meta.url);
const CHECKED_KEYS = ["DEMO_MODE", "AI_PROVIDER", "KEV_ENABLED"];

/** 기본 규칙 파일(infra/run-modes.json)을 읽는다. */
export const loadRunModeRules = () => JSON.parse(readFileSync(RULES_URL, "utf8"));

/** undefined 와 빈 문자열은 "미지정"이다. 그 밖의 값은 고치지 않고 그대로 쓴다. */
const given = (value) => (value === undefined || value === "" ? undefined : value);

/**
 * env 로 실행 모드를 판정한다. 판정 순서:
 * SOL_RUN_MODE → DEMO_MODE → AI_PROVIDER → KEV_ENABLED → forbidden → hosted 승인.
 * 값 비교는 정확히 같은 문자열이다(대소문자·공백을 고치지 않는다).
 */
export function resolveRunMode(env, rules = loadRunModeRules()) {
  const requested = given(env.SOL_RUN_MODE) ?? rules.default;
  if (!Object.hasOwn(rules.modes, requested)) {
    return {
      mode: null,
      effective: null,
      violations: [{ key: "SOL_RUN_MODE", reason: "UNKNOWN_MODE" }],
    };
  }
  const spec = rules.modes[requested];
  const violations = [];

  const effective = {};
  for (const key of CHECKED_KEYS) {
    effective[key] = given(env[key]) ?? spec[key][0];
    if (!spec[key].includes(effective[key])) {
      violations.push({ key, reason: "CONTRADICTS_MODE" });
    }
  }

  for (const [key, forbiddenValue] of Object.entries(spec.forbidden)) {
    if (given(env[key]) === forbiddenValue) {
      violations.push({ key, reason: "FORBIDDEN_IN_MODE" });
    }
  }

  const approval = rules.hostedApproval;
  const hostedAllowed = spec.AI_PROVIDER.includes(approval.provider);
  if (
    effective.AI_PROVIDER === approval.provider &&
    hostedAllowed &&
    given(env[approval.key]) !== approval.value
  ) {
    violations.push({ key: approval.key, reason: "HOSTED_NOT_APPROVED" });
  }

  return { mode: requested, effective, violations };
}
