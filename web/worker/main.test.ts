import { describe, expect, it, vi } from "vitest";
import { startWorker, type WorkerDeps } from "@/worker/main";

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
