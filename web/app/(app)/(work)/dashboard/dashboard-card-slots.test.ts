import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@/server/bids";
import {
  DASHBOARD_CARD_SLOTS,
  type DashboardCardInput,
  type DashboardCardSlotId,
} from "./dashboard-card-slots";

// 대시보드 요약 카드 슬롯 정의(설계 §2.3, 06 DashboardCardSlots). 값은 19 S2 리허설 값이다.

const NOW = new Date("2026-10-19T00:00:00Z");

const SUMMARY: DashboardSummary = {
  generatedAt: NOW.toISOString(),
  dataFreshness: {
    lastIngestAt: "2026-10-18T23:48:00Z",
    lastIngestStatus: "SUCCEEDED",
    isDemo: true,
    lastIngestSummary: {
      created: 19,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 1,
      retried: 0,
    },
  },
  ai: { provider: "mock", kevEnabled: true, lastGatewayCheckAt: null, healthy: true },
  bids: {
    total: 19,
    byStage: { PLAN: 2, PRE_SPEC: 3, NOTICE: 14 },
    byStatus: { OPEN: 17, AMENDED: 1, CANCELLED: 1, CLOSED: 0 },
    deadlineWithin7Days: 1,
  },
  analyses: {
    total: 18,
    byRecommendation: { BID: 3, WATCH: 9, NO_BID: 6 },
    partial: 0,
    withReviewFlags: 5,
    latestByStatus: { completed: 18, partial: 0, failed: 0 },
  },
  reviews: { pending: 16, byDecision: { BID: 1, WATCH: 0, NO_BID: 1 }, disagreementWithSystem: 0 },
  upcoming: [],
  unreadNotifications: 2,
};

const input = (over: Partial<DashboardCardInput> = {}): DashboardCardInput => ({
  summary: SUMMARY,
  recommendedTotal: 3,
  now: NOW,
  ...over,
});

const withSummary = (over: Partial<DashboardSummary>): DashboardCardInput =>
  input({ summary: { ...SUMMARY, ...over } });

const withLatest = (latestByStatus: DashboardSummary["analyses"]["latestByStatus"]) =>
  withSummary({ analyses: { ...SUMMARY.analyses, latestByStatus } });

const withFreshness = (over: Partial<DashboardSummary["dataFreshness"]>) =>
  withSummary({ dataFreshness: { ...SUMMARY.dataFreshness, ...over } });

const slot = (id: DashboardCardSlotId) => {
  const found = DASHBOARD_CARD_SLOTS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`슬롯이 없다: ${id}`);
  return found;
};

describe("DASHBOARD_CARD_SLOTS", () => {
  it("슬롯은 5개이고 순서는 BID 권고 → 검토 대기 → 마감 임박 → 수집 → 분석 현황 (완료)다", () => {
    expect(DASHBOARD_CARD_SLOTS.map(({ id, label }) => [id, label])).toEqual([
      ["recommended", "BID 권고"],
      ["review-pending", "검토 대기"],
      ["deadline", "마감 임박 (7일)"],
      ["ingest", "수집"],
      ["analyses", "분석 현황 (완료)"],
    ]);
  });

  it("S2 값: BID 3 · 검토 대기 16 · 마감 임박 1 · 수집 12분 전(적재 19 · 격리 1) · 분석 현황 18(부분 0 · 실패 0)", () => {
    expect(DASHBOARD_CARD_SLOTS.map((card) => card.read(input()))).toEqual([
      { value: "3", tone: "default" },
      { value: "16", tone: "default" },
      { value: "1", tone: "default" },
      { value: "12분 전", hint: "적재 19 · 격리 1", tone: "default" },
      { value: "18", hint: "부분 0 · 실패 0", tone: "default" },
    ]);
  });

  it("BID 권고는 요약의 byRecommendation 이 아니라 표와 같은 조건의 recommendedTotal 이다(M4)", () => {
    expect(slot("recommended").read(input({ recommendedTotal: 7 })).value).toBe("7");
  });
});

describe("분석 현황 슬롯", () => {
  it("분석이 0건이면 값 0, 힌트는 '분석 기록 없음'이다(06 §5.2 빈 상태, 미결정 30-7)", () => {
    expect(slot("analyses").read(withLatest({ completed: 0, partial: 0, failed: 0 }))).toEqual({
      value: "0",
      hint: "분석 기록 없음",
      tone: "default",
    });
  });

  it("값은 완료 건수이고 힌트에 부분·실패 건수를 적는다(S6 뒤: 완료 17 · 부분 1)", () => {
    expect(slot("analyses").read(withLatest({ completed: 17, partial: 1, failed: 0 }))).toEqual({
      value: "17",
      hint: "부분 1 · 실패 0",
      tone: "default",
    });
  });

  it("실패만 있으면 빈 상태 문구가 아니라 '부분 0 · 실패 N' 이다", () => {
    expect(slot("analyses").read(withLatest({ completed: 0, partial: 0, failed: 2 }))).toEqual({
      value: "0",
      hint: "부분 0 · 실패 2",
      tone: "default",
    });
  });
});

describe("수집 슬롯", () => {
  it("마지막 수집이 실패면 값은 '실패'이고 위험 색이다 — 다른 슬롯은 위험 색을 쓰지 않는다", () => {
    const failed = withFreshness({ lastIngestStatus: "FAILED" });
    expect(slot("ingest").read(failed)).toEqual({
      value: "실패",
      hint: "적재 19 · 격리 1",
      tone: "destructive",
    });
    const others = DASHBOARD_CARD_SLOTS.filter((card) => card.id !== "ingest");
    expect(others.map((card) => card.read(failed).tone)).toEqual([
      "default",
      "default",
      "default",
      "default",
    ]);
  });

  it("수집 기록이 없으면 값은 —, 힌트는 '수집 기록 없음'이다", () => {
    expect(
      slot("ingest").read(
        withFreshness({ lastIngestAt: null, lastIngestStatus: null, lastIngestSummary: null }),
      ),
    ).toEqual({ value: "—", hint: "수집 기록 없음", tone: "default" });
  });

  it("수집 요약이 없으면 힌트 없이 상대 시각만 보인다", () => {
    expect(slot("ingest").read(withFreshness({ lastIngestSummary: null }))).toEqual({
      value: "12분 전",
      hint: undefined,
      tone: "default",
    });
  });
});
