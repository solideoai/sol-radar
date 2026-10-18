import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultWorkerDeps, errorCode, startWorker, type WorkerDeps } from "@/worker/main";

const env = {
  REDIS_URL: "redis://example-host/0",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123",
};

function fakeDeps(overrides: Partial<WorkerDeps> = {}) {
  const workerClose = vi.fn(() => Promise.resolve());
  const heartbeatStop = vi.fn();
  const deps = {
    checkReadiness: vi.fn(() => Promise.resolve()),
    createWorker: vi.fn(() => ({ close: workerClose })),
    startHeartbeat: vi.fn(() => ({ stop: heartbeatStop })),
    ...overrides,
  } satisfies WorkerDeps;
  return { deps, workerClose, heartbeatStop };
}

describe("startWorker", () => {
  it("준비 확인이 실패하면 reject 하고 worker 와 heartbeat 를 만들지 않는다", async () => {
    const { deps } = fakeDeps({ checkReadiness: vi.fn(() => Promise.reject(new Error("redis"))) });
    await expect(startWorker(env, deps)).rejects.toThrow("redis");
    expect(deps.createWorker).not.toHaveBeenCalled();
    expect(deps.startHeartbeat).not.toHaveBeenCalled();
  });

  it("env 가 부족하면 준비 확인 전에 reject 한다", async () => {
    const { deps } = fakeDeps();
    await expect(startWorker({}, deps)).rejects.toThrow("worker env 누락");
    expect(deps.checkReadiness).not.toHaveBeenCalled();
  });

  it("heartbeat 경로를 env 에서 받아 시작한다", async () => {
    const { deps } = fakeDeps();
    await startWorker({ ...env, WORKER_HEARTBEAT_FILE: "/run/hb" }, deps);
    expect(deps.startHeartbeat).toHaveBeenCalledWith("/run/hb");
  });

  it("close 가 worker 와 heartbeat 를 모두 닫는다", async () => {
    const { deps, workerClose, heartbeatStop } = fakeDeps();
    const handle = await startWorker(env, deps);
    await handle.close();
    expect(workerClose).toHaveBeenCalledOnce();
    expect(heartbeatStop).toHaveBeenCalledOnce();
  });
});

describe("startWorker heartbeat 파일", () => {
  it("준비 확인보다 먼저 이전 heartbeat 파일을 지운다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-hb-"));
    const file = join(dir, "hb");
    try {
      writeFileSync(file, "stale\n");
      let existedDuringReadiness = true;
      const { deps } = fakeDeps({
        checkReadiness: vi.fn(() => {
          existedDuringReadiness = existsSync(file);
          return Promise.reject(new Error("redis"));
        }),
      });
      await expect(startWorker({ ...env, WORKER_HEARTBEAT_FILE: file }, deps)).rejects.toThrow();
      expect(existedDuringReadiness).toBe(false);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("파일이 없어도 오류 없이 기동한다", async () => {
    const { deps } = fakeDeps();
    await expect(
      startWorker({ ...env, WORKER_HEARTBEAT_FILE: "/nonexistent-dir-sol/hb" }, deps),
    ).resolves.toBeDefined();
  });
});

describe("errorCode", () => {
  it("문자열 code 만 돌려주고 message 는 보지 않는다", () => {
    expect(errorCode(Object.assign(new Error("redis://:pw@h"), { code: "ECONNREFUSED" }))).toBe(
      "ECONNREFUSED",
    );
    expect(errorCode(new Error("x"))).toBeNull();
    expect(errorCode({ code: 5 })).toBeNull();
    expect(errorCode({ code: "has space://pw" })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe("기본 준비 확인 오류", () => {
  it("닫힌 포트면 실패한 쪽 이름과 오류 코드만 싣고 URL·비밀번호는 싣지 않는다", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await new Promise((resolve) => server.close(resolve));
    const error: unknown = await defaultWorkerDeps
      .checkReadiness({
        redisUrl: `redis://:pw-secret@127.0.0.1:${port}`,
        heartbeatFile: "/unused",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("준비 확인 실패: redis");
    expect(message).toContain("redis: ECONNREFUSED");
    expect(message).not.toContain("pw-secret");
    expect(message).not.toContain(String(port));
  });
});
