import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  deploymentRole,
  isServiceToken,
  type DeploymentEnv,
  type DeploymentRole,
} from "./deployment-role";
import { redisApiOperation } from "./redis-api-path";
import { redisApiError, redisApiUnavailable } from "./redis-api-response";

function matchesToken(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Proxy뿐 아니라 업무 Route Handler에서도 호출해 직접 handler 실행을 보호한다. */
export function guardRedisApiRequest(
  request: Request,
  env: DeploymentEnv = process.env,
): Response | null {
  let role: DeploymentRole;
  try {
    role = deploymentRole(env);
  } catch {
    return redisApiUnavailable();
  }
  if (role !== "redis-api") return null;
  const operation = redisApiOperation(request.method, new URL(request.url).pathname);
  if (operation === null) return redisApiError(404, "NOT_FOUND", "요청 경로를 찾을 수 없습니다.");
  const current = env.REDIS_API_TOKEN ?? "";
  const previous = env.REDIS_API_TOKEN_PREVIOUS ?? "";
  if (!isServiceToken(current) || (previous !== "" && !isServiceToken(previous)))
    return redisApiUnavailable();
  const received = request.headers.get("X-Sol-Service-Token") ?? "";
  const currentMatches = matchesToken(received, current);
  const previousMatches = previous !== "" && matchesToken(received, previous);
  if (!currentMatches && !previousMatches) {
    return redisApiError(401, "UNAUTHENTICATED", "서비스 인증이 필요합니다.");
  }
  if (
    operation !== "health" &&
    !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(request.headers.get("Authorization") ?? "")
  ) {
    return redisApiError(401, "UNAUTHENTICATED", "사용자 Bearer 인증이 필요합니다.");
  }
  return null;
}
