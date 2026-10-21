import "server-only";

export type DeploymentRole = "frontend" | "redis-api" | "standalone";
export type DeploymentEnv = Record<string, string | undefined>;

export function deploymentRole(env: DeploymentEnv = process.env): DeploymentRole {
  const role = env.SOL_DEPLOYMENT_ROLE?.trim();
  if (role === "frontend" || role === "redis-api" || role === "standalone") return role;
  if (!role && env.NODE_ENV !== "production" && env.VERCEL !== "1") return "standalone";
  throw new Error("SOL_DEPLOYMENT_ROLE 설정이 필요합니다");
}

// base64url 32 bytes(43자) 또는 hex 32 bytes(64자)를 허용한다. 값은 오류에 넣지 않는다.
export const isServiceToken = (value: string): boolean => /^[A-Za-z0-9_-]{43,256}$/.test(value);

export function redisApiConnection(env: DeploymentEnv = process.env) {
  const base = env.REDIS_API_BASE_URL ?? "";
  const token = env.REDIS_API_TOKEN ?? "";
  const timeoutMs = Number(env.REDIS_API_TIMEOUT_MS ?? "15000");
  if (!isServiceToken(token)) throw new Error("REDIS_API_TOKEN 형식 오류");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000) {
    throw new Error("REDIS_API_TIMEOUT_MS 형식 오류");
  }
  if (!URL.canParse(base)) throw new Error("REDIS_API_BASE_URL 형식 오류");
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9/_-]*$/.test(url.pathname)
  )
    throw new Error("REDIS_API_BASE_URL 형식 오류");
  return { baseUrl: url.href.replace(/\/+$/, ""), token, timeoutMs };
}

export function validateDeployment(env: DeploymentEnv = process.env): void {
  const role = deploymentRole(env);
  if (env.VERCEL === "1" && role !== "frontend")
    throw new Error("Vercel은 SOL_DEPLOYMENT_ROLE=frontend가 필요합니다");
  if (role === "standalone") {
    return;
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("웹 SUPABASE_SERVICE_ROLE_KEY 사용 금지");
  if (role === "frontend") {
    if (env.REDIS_URL) throw new Error("frontend REDIS_URL 사용 금지");
    redisApiConnection(env);
    return;
  }
  if (!isServiceToken(env.REDIS_API_TOKEN ?? "")) throw new Error("REDIS_API_TOKEN 형식 오류");
  const previous = env.REDIS_API_TOKEN_PREVIOUS;
  if (previous && !isServiceToken(previous)) throw new Error("REDIS_API_TOKEN_PREVIOUS 형식 오류");
  if (!/^rediss?:\/\//.test(env.REDIS_URL ?? ""))
    throw new Error("REDIS_URL TCP 주소가 필요합니다");
}
