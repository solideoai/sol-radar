import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /health/ready", () => {
  it("설정이 없으면 503", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("MINIO_ENDPOINT", "");
    vi.stubEnv("AI_GATEWAY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    // 설정이 없으면 네트워크를 부르면 안 된다. 불리면 이 가짜가 실패시킨다.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("설정이 없는데 네트워크를 불렀다"))),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { status: string; checks: Record<string, string> };
    expect(body.status).toBe("unavailable");
    expect(body.checks).toEqual({
      db: "unavailable",
      redis: "unavailable",
      storage: "unavailable",
      ai: "unavailable",
    });
  });
});
