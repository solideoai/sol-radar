import { beforeEach, describe, expect, it, vi } from "vitest";
import { analysisReadinessRepo } from "./bids.supabase";

// 분석이 첨부 텍스트를 읽는지(ANALYSIS_READS_ATTACHMENT_TEXT). null 이면 실제 값(지금 false)을 쓴다.
// 첨부 reader 연결 뒤의 질의(true)도 미리 확인하려고 시험만 값을 바꾼다.
const flag = vi.hoisted(() => ({ readsAttachmentText: null as boolean | null }));
vi.mock("@/server/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/analysis")>();
  return {
    ...actual,
    get ANALYSIS_READS_ATTACHMENT_TEXT() {
      return flag.readsAttachmentText ?? actual.ANALYSIS_READS_ATTACHMENT_TEXT;
    },
  };
});

// 표마다 돌려줄 행과 질의 기록. 거르기는 흉내 내지 않고 어떤 조건을 걸었는지만 본다(RLS 는 DB 정책 시험 몫).
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "not", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          db.calls.push({ table, method, args });
          return builder;
        };
      }
      builder.maybeSingle = async () => ({ data: db.rows[table]?.[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

const BID = "b0000000-0000-4000-8000-000000000001";
const tablesRead = () => [...new Set(db.calls.map((call) => call.table))];

beforeEach(() => {
  db.rows = {};
  db.calls = [];
  flag.readsAttachmentText = null;
});

describe("분석 원문 준비 읽기(사용자 세션)", () => {
  it("공고가 없거나 보이지 않으면 null 이고 revision·첨부를 읽지 않는다", async () => {
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toBeNull();
    expect(tablesRead()).toEqual(["bid_notices"]);
  });

  it("최신 revision 행이 없으면 오류(500) 대신 원문 미확보다", async () => {
    db.rows = { bid_notices: [{ latest_revision: 3 }] };
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toEqual({
      ready: false,
      reason: "SOURCE_TEXT_MISSING",
    });
    expect(tablesRead()).toEqual(["bid_notices", "bid_revisions"]);
  });

  it("최신 revision 본문이 있으면 첨부를 읽지 않고 분석할 수 있다", async () => {
    db.rows = {
      bid_notices: [{ latest_revision: 2 }],
      bid_revisions: [{ id: "rev-2", content: "공고 본문" }],
    };
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toEqual({
      ready: true,
      reason: null,
    });
    expect(db.calls).toContainEqual({
      table: "bid_revisions",
      method: "eq",
      args: ["revision", 2],
    });
    expect(tablesRead()).not.toContain("bid_documents");
  });

  // 지금 분석 runtime 은 첨부 텍스트를 AI 에 넘기지 않는다. 상수를 true 로 바꾸면 이 시험의 기대가 바뀐다.
  it("지금은 본문이 비면 파싱된 첨부가 있어도 SOURCE_TEXT_MISSING 이고 첨부를 조회하지 않는다", async () => {
    db.rows = {
      bid_notices: [{ latest_revision: 1 }],
      bid_revisions: [{ id: "rev-1", content: "" }],
      bid_documents: [{ id: "doc-1" }],
    };
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toEqual({
      ready: false,
      reason: "SOURCE_TEXT_MISSING",
    });
    expect(tablesRead()).toEqual(["bid_notices", "bid_revisions"]);
  });

  it("첨부를 읽게 되면, 본문이 빌 때 그 revision 의 PARSED·PARTIAL + 텍스트 객체 첨부를 찾고 없으면 SOURCE_TEXT_MISSING 이다", async () => {
    flag.readsAttachmentText = true;
    db.rows = {
      bid_notices: [{ latest_revision: 1 }],
      bid_revisions: [{ id: "rev-1", content: "" }],
      bid_documents: [],
    };
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toEqual({
      ready: false,
      reason: "SOURCE_TEXT_MISSING",
    });
    const documentCalls = db.calls.filter((call) => call.table === "bid_documents");
    expect(documentCalls).toEqual(
      expect.arrayContaining([
        { table: "bid_documents", method: "eq", args: ["bid_id", BID] },
        { table: "bid_documents", method: "eq", args: ["revision_id", "rev-1"] },
        { table: "bid_documents", method: "in", args: ["parse_status", ["PARSED", "PARTIAL"]] },
        { table: "bid_documents", method: "not", args: ["text_object_key", "is", null] },
      ]),
    );
  });

  it("첨부를 읽게 되면, 본문이 비어도 분석 가능한 첨부가 하나 있으면 분석할 수 있다", async () => {
    flag.readsAttachmentText = true;
    db.rows = {
      bid_notices: [{ latest_revision: 1 }],
      bid_revisions: [{ id: "rev-1", content: null }],
      bid_documents: [{ id: "doc-1" }],
    };
    expect(await analysisReadinessRepo.getAnalysisReadiness("org-1", BID)).toEqual({
      ready: true,
      reason: null,
    });
  });
});
