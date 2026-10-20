import { describe, expect, it, vi } from "vitest";
import type { BidsRepo } from "./bids.repo";
import { computeWhatIf } from "./what-if.service";

// 가정 재계산 서비스(BOOST-2). 저장소는 스냅샷만 읽고 쓰기 메서드는 하나도 부르지 않는다.
// 규칙 엔진(whatIf)은 실제로 쓰지 않고 막는 경계만 본다 — 스냅샷이 스키마에 안 맞으면 NO_SNAPSHOT 이다.

function fakeRepo(snapshot: Awaited<ReturnType<BidsRepo["getAnalysisSnapshot"]>>) {
  const writes = {
    createAnalysisRun: vi.fn(),
    markRunFailed: vi.fn(),
  };
  const repo = {
    getAnalysisSnapshot: vi.fn(async () => snapshot),
    ...writes,
  } as unknown as BidsRepo;
  return { repo, writes };
}

const body = { assumptions: [{ kind: "QUALIFICATION", code: "ICT_CONSTRUCTION" }] };

describe("computeWhatIf", () => {
  it("본문이 틀리면 400 VALIDATION_ERROR 이고 저장소를 부르지 않는다", async () => {
    const { repo } = fakeRepo(null);
    const bad = [
      {},
      { assumptions: "x" },
      { assumptions: [{ kind: "OTHER", code: "A" }] },
      { assumptions: [{ kind: "QUALIFICATION", code: "" }] },
      { assumptions: [{ kind: "QUALIFICATION", code: "A", extra: 1 }] },
      { assumptions: Array.from({ length: 11 }, () => ({ kind: "QUALIFICATION", code: "A" })) },
    ];
    for (const input of bad) {
      const result = await computeWhatIf("org1", "r1", input, { repo });
      expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
    }
    expect(repo.getAnalysisSnapshot).not.toHaveBeenCalled();
  });

  it("run 이 없거나 다른 조직이면 404 resource analysis 다", async () => {
    const { repo } = fakeRepo(null);
    const result = await computeWhatIf("org1", "r1", body, { repo });
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "analysis" },
    });
    expect(repo.getAnalysisSnapshot).toHaveBeenCalledWith("org1", "r1");
  });

  it.each(["QUEUED", "RUNNING"] as const)("%s 이면 409 ANALYSIS_IN_PROGRESS 다", async (status) => {
    const { repo } = fakeRepo({ status, inputSnapshot: null });
    expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
      ok: false,
      status: 409,
      code: "ANALYSIS_IN_PROGRESS",
    });
  });

  it("FAILED 이면 404 NO_SNAPSHOT 이다", async () => {
    const { repo } = fakeRepo({ status: "FAILED", inputSnapshot: { any: 1 } });
    expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "analysis", reason: "NO_SNAPSHOT" },
    });
  });

  it("스냅샷이 스키마에 안 맞으면(null 포함) 404 NO_SNAPSHOT 이다", async () => {
    for (const inputSnapshot of [null, { broken: true }]) {
      const { repo } = fakeRepo({ status: "COMPLETED", inputSnapshot });
      expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
        ok: false,
        status: 404,
        details: { resource: "analysis", reason: "NO_SNAPSHOT" },
      });
    }
  });

  it("어떤 경우에도 쓰기 메서드를 부르지 않는다", async () => {
    const { repo, writes } = fakeRepo({ status: "COMPLETED", inputSnapshot: { broken: true } });
    await computeWhatIf("org1", "r1", body, { repo });
    await computeWhatIf("org1", "r1", {}, { repo });
    expect(writes.createAnalysisRun).not.toHaveBeenCalled();
    expect(writes.markRunFailed).not.toHaveBeenCalled();
  });
});
