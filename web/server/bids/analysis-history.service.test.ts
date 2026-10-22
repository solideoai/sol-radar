import { describe, expect, it, vi } from "vitest";
import { parseAnalysisHistoryQuery } from "./analysis-history.model";
import { listAnalysisHistory } from "./analysis-history.service";
import type { AnalysisHistoryItem, AnalysisHistoryRepo } from "./analysis-history.model";

const secret = "analysis-history-test-secret-at-least-32-characters";
const item: AnalysisHistoryItem = {
  id: "a1000000-0000-4000-8000-000000000001",
  bidId: "b1000000-0000-4000-8000-000000000001",
  bidTitle: "가상 공고",
  isDemo: true,
  revision: 2,
  profileRevision: 1,
  status: "PARTIAL",
  runMode: "mock",
  solScore: null,
  recommendation: null,
  errorCode: "KEV_UNAVAILABLE",
  reviewFlags: ["KEV_UNAVAILABLE"],
  queuedAt: "2026-10-22T01:00:00Z",
  finishedAt: null,
  model: { algorithmVersion: "sol-v0.1.0" },
};
const query = {
  bidId: null,
  status: null,
  recommendation: null,
  runMode: null,
  cursor: null,
  limit: 20,
} as const;

describe("조직 분석 이력", () => {
  it("여러 공고의 부분·실패 결과를 바꾸지 않고 다음 커서를 조직·필터에 묶는다", async () => {
    const list = vi.fn<AnalysisHistoryRepo["list"]>().mockResolvedValue({
      items: [
        item,
        {
          ...item,
          id: "a2000000-0000-4000-8000-000000000001",
          bidId: "b2000000-0000-4000-8000-000000000001",
          status: "FAILED",
        },
      ],
      hasNext: true,
      last: { id: item.id, sortValue: item.queuedAt },
    });
    const result = await listAnalysisHistory("org-a", query, {
      repo: { list },
      cursorSecret: secret,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.items.map((entry) => entry.solScore)).toEqual([null, null]);
    const cursor = result.data.pageInfo.nextCursor;
    expect(cursor).toBeTypeOf("string");
    list.mockClear();
    const deps = { repo: { list }, cursorSecret: secret };
    expect(await listAnalysisHistory("org-b", { ...query, cursor }, deps)).toMatchObject({
      ok: false,
      code: "INVALID_CURSOR",
    });
    expect(
      await listAnalysisHistory("org-a", { ...query, cursor, status: "FAILED" }, deps),
    ).toMatchObject({ ok: false, code: "INVALID_CURSOR" });
    expect(list).not.toHaveBeenCalled();
    await listAnalysisHistory("org-a", { ...query, cursor }, deps);
    expect(list).toHaveBeenCalledWith(
      "org-a",
      { ...query, cursor },
      expect.objectContaining({ id: item.id }),
    );
  });

  it("상태·실행모드·공고·권고와 페이지 크기를 검증한다", () => {
    expect(
      parseAnalysisHistoryQuery({ status: "PARTIAL", runMode: "mock", limit: "100" }),
    ).toMatchObject({ ok: true, value: { status: "PARTIAL", runMode: "mock", limit: 100 } });
    expect(parseAnalysisHistoryQuery({ limit: "101" }).ok).toBe(false);
    expect(parseAnalysisHistoryQuery({ bidId: "bad" }).ok).toBe(false);
    expect(parseAnalysisHistoryQuery({ status: ["FAILED", "PARTIAL"] }).ok).toBe(false);
  });
});
