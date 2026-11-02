import { describe, expect, it, vi } from "vitest";
import type { AwardReferenceRepo, AwardSampleRow, AwardTarget } from "./award-reference.model";
import { getAwardReference } from "./award-reference.service";

const NOW = new Date("2026-11-02T00:00:00.000Z");
const TARGET: AwardTarget = {
  bidNoticeNo: "R26BK00000001",
  classNo: "81112299",
  className: "소프트웨어유지및지원서비스",
  midClassName: "SW 유지관리",
  group: "NEGOTIATION",
  base: { amountKrw: 796011720, kind: "ASSIGNED_BUDGET" },
  priceWeight: 10,
  lowerLimitRate: null,
};
const ROWS: AwardSampleRow[] = [0.861, 0.894, 0.927, 0.88, 0.91].map((awardRatio, index) => ({
  bidNoticeNo: `R25BK0000000${index}`,
  classNo: TARGET.classNo,
  midClassName: TARGET.midClassName,
  baseAmountKrw: 800000000,
  awardRatio,
}));

const fakeRepo = (overrides: Partial<AwardReferenceRepo> = {}): AwardReferenceRepo => ({
  loadTarget: vi.fn(async () => TARGET),
  loadCandidates: vi.fn(async () => ROWS),
  loadDatasetMeta: vi.fn(async () => ({
    dataAsOf: "2026-11-01T12:00:00.000Z",
    earliestOpenedAt: "2026-03-15T01:00:00.000Z",
  })),
  ...overrides,
});

describe("getAwardReference — 공고 상세 카드 값", () => {
  it("카드 대상이 아닌 공고(나라장터 아님·데모·그 밖 방식)는 null 이고 낙찰 이력을 읽지 않는다", async () => {
    const repo = fakeRepo({ loadTarget: vi.fn(async () => null) });
    await expect(getAwardReference("bid-1", { repo, now: NOW })).resolves.toBeNull();
    expect(repo.loadCandidates).not.toHaveBeenCalled();
  });

  it("낙찰 이력 표가 비어 있으면(수집 전) 카드를 숨긴다", async () => {
    const repo = fakeRepo({
      loadCandidates: vi.fn(async () => []),
      loadDatasetMeta: vi.fn(async () => ({ dataAsOf: null, earliestOpenedAt: null })),
    });
    await expect(getAwardReference("bid-1", { repo, now: NOW })).resolves.toBeNull();
  });

  it("후보는 가장 넓은 금액대·최근 12개월로 한 번에 읽고, 기간은 가장 이른 개찰부터 올림 개월 수(최대 12)", async () => {
    const repo = fakeRepo();
    const reference = await getAwardReference("bid-1", { repo, now: NOW });

    expect(repo.loadTarget).toHaveBeenCalledWith("bid-1");
    expect(repo.loadCandidates).toHaveBeenCalledWith({
      classNo: "81112299",
      midClassName: "SW 유지관리",
      group: "NEGOTIATION",
      minBase: 265337240,
      maxBase: 2388035160,
      openedSince: "2025-11-02T00:00:00.000Z",
    });
    expect(reference).toMatchObject({
      kind: "RANGE",
      step: 1,
      sampleSize: 5,
      periodMonths: 8,
      ratio: { q1: 0.88, median: 0.894, q3: 0.91 },
      dataAsOf: "2026-11-01T12:00:00.000Z",
    });

    const older = fakeRepo({
      loadDatasetMeta: vi.fn(async () => ({
        dataAsOf: "2026-11-01T12:00:00.000Z",
        earliestOpenedAt: "2025-06-01T00:00:00.000Z",
      })),
    });
    await expect(getAwardReference("bid-1", { repo: older, now: NOW })).resolves.toMatchObject({
      periodMonths: 12,
    });
  });
});
