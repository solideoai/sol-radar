import { describe, expect, it, vi } from "vitest";
import { runDocumentsOnly, type DocumentsOnlyDeps } from "@/worker/documents-only-main";

// documents 전용 worker 는 live 에서만 뜬다. 모드·설정이 틀리면 Redis·Supabase 에 닿기 전에 멈춘다.
const liveEnv = {
  SOL_RUN_MODE: "live",
  REDIS_URL: "redis://redis.test:6379",
  AI_GATEWAY_URL: "http://gateway.test:8000",
};

function testDeps() {
  const checkReadiness = vi.fn(async () => undefined);
  const createWorker = vi.fn(() => ({ close: async () => undefined }));
  const deps: DocumentsOnlyDeps = {
    workerDeps: { checkReadiness, createWorker, startHeartbeat: () => ({ stop: () => undefined }) },
    onSignal: () => undefined,
    exit: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
  };
  return { deps, checkReadiness, createWorker };
}

describe("documents 전용 worker", () => {
  it.each([
    ["mock 모드", { ...liveEnv, SOL_RUN_MODE: "mock" }, "SOL_RUN_MODE=live"],
    ["범위 밖 상한", { ...liveEnv, DOCUMENTS_MAX_PER_BID: "77" }, "DOCUMENTS_MAX_PER_BID"],
  ])("%s 이면 연결하지 않고 exit 1, 값은 싣지 않는다", async (_label, env, expected) => {
    const { deps, checkReadiness, createWorker } = testDeps();
    await runDocumentsOnly([], env, deps);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
    const output = vi.mocked(deps.logError).mock.calls.flat().join("\n");
    expect(output).toContain(expected);
    expect(output).not.toContain("77");
  });
});
