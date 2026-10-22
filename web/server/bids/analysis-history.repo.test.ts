import { expect, it, vi } from "vitest";
import { analysisHistoryRepo } from "./analysis-history.repo";

const sdk = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/server/supabase", () => ({ getSupabase: async () => ({ from: () => sdk }) }));

it("DB 실행모드 MOCK로 필터하고 소문자 DTO로 읽으며 실패 결과의 잔여 점수를 노출하지 않는다", async () => {
  sdk.select.mockReturnValue(sdk);
  sdk.eq.mockReturnValue(sdk);
  sdk.order.mockReturnValue(sdk);
  const stored = {
    id: "a0000000-0000-4000-8000-000000000001",
    bid_id: "b0000000-0000-4000-8000-000000000001",
    profile_revision: 1,
    status: "PARTIAL",
    run_mode: "MOCK",
    score: 72,
    recommendation: "WATCH",
    error_code: null,
    review_flags: [],
    queued_at: "2026-10-22T01:00:00Z",
    finished_at: null,
    algorithm_version: "sol-v0.1.0",
    created_at: "2026-10-22T01:00:00Z",
    revision: { revision: 1 },
    bid: { title: "실행모드 경계 공고", is_demo: true },
  };
  sdk.limit.mockResolvedValue({
    data: [stored, { ...stored, id: "a0000000-0000-4000-8000-000000000002", status: "FAILED" }],
    error: null,
  });
  const result = await analysisHistoryRepo.list(
    "org-1",
    { bidId: null, status: null, recommendation: null, runMode: "mock", cursor: null, limit: 20 },
    null,
  );
  expect(sdk.eq).toHaveBeenCalledWith("run_mode", "MOCK");
  expect(result.items[0]).toMatchObject({ runMode: "mock", solScore: 72, recommendation: "WATCH" });
  expect(result.items[1]).toMatchObject({ runMode: "mock", solScore: null, recommendation: null });
  expect(sdk.order.mock.calls).toEqual([
    ["created_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
});
