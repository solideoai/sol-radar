import { describe, expect, it } from "vitest";
import { readG2bServiceKey, readWorkerEnv } from "@/worker/env";

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

describe("readG2bServiceKey", () => {
  const name = "G2B_BID_NOTICE_SERVICE_KEY";

  it("포털의 Encoding 키를 decodeURIComponent 로 한 번 디코딩해 Decoding 키로 돌려준다", () => {
    expect(readG2bServiceKey({ [name]: "abc%2Bdef%2Fghi%3D%3D" }, name)).toBe("abc+def/ghi==");
  });

  it("이미 Decoding 키(% 없음)면 값을 바꾸지 않는다", () => {
    expect(readG2bServiceKey({ [name]: "abc+def/ghi==" }, name)).toBe("abc+def/ghi==");
  });

  it("정확히 한 번만 디코딩한다(두 번 인코딩된 값은 한 겹만 벗긴다)", () => {
    expect(readG2bServiceKey({ [name]: "abc%252B" }, name)).toBe("abc%2B");
  });

  it("앞뒤 공백을 지운다", () => {
    expect(readG2bServiceKey({ [name]: "  abc%3D \n" }, name)).toBe("abc=");
  });

  it("없거나 비어 있으면 env 이름만 담아 던진다", () => {
    expect(() => readG2bServiceKey({}, name)).toThrowError(`worker env 누락: ${name}`);
    expect(() => readG2bServiceKey({ [name]: " " }, name)).toThrowError(`worker env 누락: ${name}`);
  });

  it("퍼센트 인코딩이 깨진 값이면 env 이름만 담아 던지고 값은 싣지 않는다", () => {
    const broken = { [name]: "SECRET%E0%A4%A" };
    expect(() => readG2bServiceKey(broken, name)).toThrowError(new RegExp(name));
    try {
      readG2bServiceKey(broken, name);
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
    }
  });
});
