import "server-only";
import type { RunMode } from "@/server/analysis";
import type { SolRole } from "@/server/organization";
import {
  AI_STATUS_ROLES,
  type AiStatus,
  type GatewayHealthBody,
  isHostedBlocked,
  readAiStatusEnv,
  resolveProvider,
  toAiStatus,
} from "./ai-status.model";
import { fetchGatewayHealth } from "./ai-status.repo";
import { limitProbe } from "./health.service";

export type AiStatusDeps = {
  /** 부를 때 읽은 env. 시험은 객체를 넘긴다. */
  env: Record<string, string | undefined>;
  /** gateway /health 한 번. 불가면 null(던져도 service 가 null 로 바꾼다). */
  fetchHealth: (healthUrl: string) => Promise<GatewayHealthBody | null>;
  now: () => Date;
};

export type AiStatusResult =
  | { status: "ready"; data: AiStatus }
  | { status: "forbidden"; required: readonly SolRole[] }
  | { status: "hosted-not-approved" };

// 환경 변수는 호출 때 읽는다. 모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다.
function defaultAiStatusDeps(): AiStatusDeps {
  return { env: process.env, fetchHealth: fetchGatewayHealth, now: () => new Date() };
}

/**
 * 순서: 역할(ADMIN) → env 기준 hosted 승인(gateway 를 부르기 전) → gateway /health 한 번 → gateway 가 알린 provider 의 hosted 승인.
 * 실행 모드는 역할을 확인한 뒤에 읽는다(SOL_RUN_MODE 가 틀려 던져도 ADMIN 이 아니면 403 이 먼저다).
 * gateway 가 불가여도 던지지 않고 gateway.healthy=false 로 돌려준다.
 */
export async function getAiStatus(
  role: SolRole,
  readRunMode: () => RunMode,
  deps: AiStatusDeps = defaultAiStatusDeps(),
): Promise<AiStatusResult> {
  if (!AI_STATUS_ROLES.includes(role)) return { status: "forbidden", required: AI_STATUS_ROLES };
  const runMode = readRunMode();
  const env = readAiStatusEnv(deps.env);
  if (isHostedBlocked(resolveProvider(null, env, runMode), env.hostedApproved)) {
    return { status: "hosted-not-approved" };
  }
  const { healthUrl } = env.gateway;
  const health =
    healthUrl === null ? null : await limitProbe(() => deps.fetchHealth(healthUrl), null);
  const data = toAiStatus({ runMode, env, health, checkedAt: deps.now() });
  if (isHostedBlocked(data.provider, data.hostedApproved)) return { status: "hosted-not-approved" };
  return { status: "ready", data };
}
