import { describe, expect, it } from "vitest";
import { readWorkerEnv } from "@/worker/env";

const full = {
  REDIS_URL: "redis://example-host/0",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123",
};

describe("readWorkerEnv", () => {
  it("필수 값이 있으면 redisUrl 과 기본 heartbeat 경로를 돌려준다", () => {
    expect(readWorkerEnv(full)).toEqual({
      redisUrl: "redis://example-host/0",
      heartbeatFile: "/tmp/sol-worker-heartbeat",
    });
  });

  it("WORKER_HEARTBEAT_FILE 로 경로를 바꾼다", () => {
    expect(readWorkerEnv({ ...full, WORKER_HEARTBEAT_FILE: "/run/hb" }).heartbeatFile).toBe(
      "/run/hb",
    );
  });

  it("REDIS_URL 이 없으면 키 이름만 담아 던지고 비밀 값은 싣지 않는다", () => {
    const rest = {
      NEXT_PUBLIC_SUPABASE_URL: full.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: full.SUPABASE_SERVICE_ROLE_KEY,
    };
    expect(() => readWorkerEnv(rest)).toThrowError(/REDIS_URL/);
    try {
      readWorkerEnv(rest);
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
    }
  });

  it("빈 문자열도 누락으로 보고 누락 키를 모두 나열한다", () => {
    expect(() => readWorkerEnv({ REDIS_URL: " " })).toThrowError(
      "worker env 누락: REDIS_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    );
  });
});
