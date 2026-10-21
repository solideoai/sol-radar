import { describe, expect, it } from "vitest";
import { deploymentRole, redisApiConnection, validateDeployment } from "./deployment-role";
import { guardRedisApiRequest } from "./redis-api-auth";
import { redisApiOperation } from "./redis-api-path";

const token = "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const base = { REDIS_API_BASE_URL: "https://acropolissg.com/redis", REDIS_API_TOKEN: token };

describe("deployment boundary", () => {
  it("defaults only local development/tests to standalone", () => {
    expect(deploymentRole({ NODE_ENV: "test" })).toBe("standalone");
    expect(() => deploymentRole({ NODE_ENV: "production" })).toThrow("SOL_DEPLOYMENT_ROLE");
    expect(() => deploymentRole({ VERCEL: "1" })).toThrow("SOL_DEPLOYMENT_ROLE");
    expect(() => validateDeployment({ VERCEL: "1", SOL_DEPLOYMENT_ROLE: "standalone" })).toThrow();
    expect(() =>
      validateDeployment({
        VERCEL: "1",
        SOL_DEPLOYMENT_ROLE: "redis-api",
        REDIS_API_TOKEN: token,
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    ).toThrow("frontend");
  });
  it("frontend forbids TCP and service-role credentials", () => {
    const frontend = { ...base, SOL_DEPLOYMENT_ROLE: "frontend" };
    expect(() => validateDeployment(frontend)).not.toThrow();
    expect(() => validateDeployment({ ...frontend, REDIS_URL: "redis://127.0.0.1:6379" })).toThrow(
      "REDIS_URL",
    );
    expect(() =>
      validateDeployment({ ...frontend, SUPABASE_SERVICE_ROLE_KEY: "test-only" }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(() =>
      validateDeployment({
        ...base,
        SOL_DEPLOYMENT_ROLE: "redis-api",
        REDIS_URL: "https://acropolissg.com/redis",
      }),
    ).toThrow("REDIS_URL");
  });
  it.each([
    "http://acropolissg.com/redis",
    "https://user:password@acropolissg.com/redis",
    "https://acropolissg.com/redis?token=secret",
    "https://acropolissg.com/redis#fragment",
    "https://acropolissg.com/%2fprivate",
  ])("rejects unsafe upstream %s", (url) => {
    expect(() => redisApiConnection({ ...base, REDIS_API_BASE_URL: url })).toThrow(
      "REDIS_API_BASE_URL",
    );
  });
  it.each(["0", "NaN", "15001", "1.5"])("rejects invalid timeout %s", (timeout) => {
    expect(() => redisApiConnection({ ...base, REDIS_API_TIMEOUT_MS: timeout })).toThrow(
      "REDIS_API_TIMEOUT_MS",
    );
  });
  it("supports token rotation while requiring a user JWT for work", () => {
    const previous = "previous-test-service-token-0123456789-abcdefghijklmnop";
    const env = { ...base, SOL_DEPLOYMENT_ROLE: "redis-api", REDIS_API_TOKEN_PREVIOUS: previous };
    expect(
      guardRedisApiRequest(
        new Request("http://localhost/health", { headers: { "X-Sol-Service-Token": previous } }),
        env,
      ),
    ).toBeNull();
    expect(
      guardRedisApiRequest(
        new Request("http://localhost/api/v1/admin/ingestion/runs", {
          method: "POST",
          headers: { "X-Sol-Service-Token": previous, Authorization: "Bearer invalid-user" },
        }),
        env,
      ),
    ).toBeNull();
    expect(
      guardRedisApiRequest(
        new Request("http://localhost/health", { headers: { "X-Sol-Service-Token": token } }),
        { ...env, REDIS_API_TOKEN: "invalid" },
      )?.status,
    ).toBe(503);
  });
  it.each([
    "/api/v1/bids",
    "/health/ready",
    "/redis/health",
    "/api/v1/admin/ingestion/runs/../runs",
    "/api/v1/redis/command",
  ])("does not allow raw/extra path %s", (path) => {
    expect(redisApiOperation("POST", path)).toBeNull();
  });
});
