import { describe, expect, it } from "vitest";
import { itBatchIdempotencyKey, preanalyzeIdempotencyKey } from "@/server/analysis";
import {
  reviewPendingBids,
  type PendingAnalysisRow,
  type PendingSourceRow,
} from "./review-pending";

// 입찰 프로젝트 보드의 "검토 대기" 칸(P1 N6). IT 일괄 분석 run(ADR-069)만 빼고,
// 사람이 누른 분석과 DEMO 사전 분석(키 없음·demo-pre 키)은 그대로 센다.

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-30T01:00:00.000Z");
const BATCH_KEY = itBatchIdempotencyKey(
  ORG_ID,
  { bidId: "bid-1", revisionId: "rev-1", revision: 1 },
  5,
);
/** 화면 [분석]의 키: `${orgId}:${uuid}`. */
const SCREEN_KEY = `${ORG_ID}:5f0c9a3e-2b7d-4c1a-9e8f-6d5c4b3a2f10`;

function analysis(
  id: string,
  createdAt: string,
  idempotencyKey: string | null,
): PendingAnalysisRow {
  return {
    id,
    status: "COMPLETED",
    recommendation: "BID",
    reviewFlagCount: 0,
    createdAt,
    idempotencyKey,
  };
}

function bid(analyses: PendingAnalysisRow[], isDemo = false): PendingSourceRow {
  return {
    bidId: "bid-1",
    title: "공고",
    agency: "기관",
    isDemo,
    stage: "NOTICE",
    status: "OPEN",
    deadlineAt: "2026-11-10T09:00:00.000Z",
    analyses,
    reviews: [],
  };
}

const pendingIds = (row: PendingSourceRow) =>
  reviewPendingBids({ bids: [row] }, NOW).map((card) => card.bidId);

describe("검토 대기와 IT 일괄 분석", () => {
  it("IT 일괄 분석만 있는 공고는 검토 대기가 아니다", () => {
    expect(pendingIds(bid([analysis("run-1", "2026-10-29T10:00:00.000Z", BATCH_KEY)]))).toEqual([]);
  });

  it("일괄 분석 뒤 사람이 누른 분석이 있으면 검토 대기다", () => {
    const row = bid([
      analysis("run-1", "2026-10-29T10:00:00.000Z", BATCH_KEY),
      analysis("run-2", "2026-10-29T11:00:00.000Z", SCREEN_KEY),
    ]);
    expect(pendingIds(row)).toEqual(["bid-1"]);
  });

  it("키가 없거나 demo-pre 키인 DEMO 사전 분석은 검토 대기다", () => {
    const demoKey = preanalyzeIdempotencyKey(ORG_ID, { fixtureId: "FX-01", revision: 1 });
    for (const key of [null, demoKey]) {
      expect(pendingIds(bid([analysis("run-1", "2026-10-29T10:00:00.000Z", key)], true))).toEqual([
        "bid-1",
      ]);
    }
  });
});
