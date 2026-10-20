import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETED_REVIEWER_ID } from "./bid-row.mapper";
import { reviewRepo } from "./review.supabase";
import { callsOf, fakeDb, type FakeQuery } from "./supabase-fake.test-data";

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const BID = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";
const ASSIGNEE = "66666666-6666-4666-8666-666666666666";
const T0 = "2026-10-16T00:00:00+00:00";

// bid_reviews 행 + 결정자(프로필·멤버십)·담당자(멤버십 → 프로필) 임베드
function storedReview(patch: Record<string, unknown> = {}) {
  return {
    id: "rv-1",
    org_id: ORG,
    bid_id: BID,
    revision_id: "r2",
    score_run_id: RUN,
    reviewer_id: USER,
    assignee_id: ASSIGNEE,
    decision: "WATCH",
    reason: "인력 배정이 겹쳐 지켜본다",
    decided_at: T0,
    created_at: T0,
    system_recommendation: "BID",
    disagreement_flag: true,
    reviewer: {
      display_name: "김영업",
      email: "kim@example.com",
      memberships: [
        { org_id: OTHER_ORG, sol_role: "VIEWER" },
        { org_id: ORG, sol_role: "SALES" },
      ],
    },
    assignee: { profile: { display_name: null, email: "park@example.com" } },
    ...patch,
  };
}

const only = (target: string): FakeQuery => {
  const found = fakeDb.queries(target);
  expect(found).toHaveLength(1);
  return found[0] as FakeQuery;
};

beforeEach(() => fakeDb.reset());

describe("createReview(O2)", () => {
  const input = {
    orgId: ORG,
    bidId: BID,
    revisionId: "r2",
    scoreRunId: RUN,
    reviewerId: USER,
    decision: "WATCH" as const,
    reason: "인력 배정이 겹쳐 지켜본다",
    assigneeUserId: ASSIGNEE,
    systemRecommendationAtDecision: "BID" as const,
    disagreementFlag: true,
  };

  it("insert 열은 일곱 개뿐이고 시스템 권고·불일치는 쓰지 않는다(트리거가 채운다)", async () => {
    fakeDb.on("bid_reviews", fakeDb.rows([storedReview()]));
    await reviewRepo.createReview(input);
    const inserted = callsOf(only("bid_reviews"), "insert")[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(inserted).sort()).toEqual(
      [
        "org_id",
        "bid_id",
        "revision_id",
        "score_run_id",
        "assignee_id",
        "decision",
        "reason",
      ].sort(),
    );
    expect(inserted).not.toHaveProperty("system_recommendation");
    expect(inserted).not.toHaveProperty("disagreement_flag");
    expect(inserted).not.toHaveProperty("reviewer_id");
    expect(inserted).toMatchObject({ assignee_id: ASSIGNEE, score_run_id: RUN, decision: "WATCH" });
  });

  it("응답은 returning 행(트리거 값 포함)과 결정자·담당자 표시 열로 만든다", async () => {
    fakeDb.on("bid_reviews", fakeDb.rows([storedReview()]));
    const review = await reviewRepo.createReview(input);
    expect(callsOf(only("bid_reviews"), "single")).toEqual([[]]);
    expect(review).toEqual({
      id: "rv-1",
      bidId: BID,
      revisionId: "r2",
      scoreRunId: RUN,
      reviewer: { id: USER, name: "김영업", role: "SALES" },
      decision: "WATCH",
      reason: "인력 배정이 겹쳐 지켜본다",
      decidedAt: T0,
      assignee: { id: ASSIGNEE, name: "park" },
      systemRecommendationAtDecision: "BID",
      disagreementFlag: true,
    });
  });

  it("insert 오류는 던진다", async () => {
    fakeDb.on("bid_reviews", { error: new Error("rls") });
    await expect(reviewRepo.createReview(input)).rejects.toThrow("rls");
  });
});

describe("listReviews", () => {
  it("공고가 없으면 null", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    fakeDb.on("bid_reviews", fakeDb.rows([]));
    expect(await reviewRepo.listReviews(ORG, BID)).toBeNull();
  });

  it("공고는 있는데 이 조직의 결정이 없으면 [] 다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ id: BID }]));
    fakeDb.on("bid_reviews", fakeDb.rows([]));
    expect(await reviewRepo.listReviews(ORG, BID)).toEqual([]);
    const reviews = only("bid_reviews");
    expect(callsOf(reviews, "eq")).toEqual([
      ["org_id", ORG],
      ["bid_id", BID],
    ]);
    expect(callsOf(reviews, "order")).toEqual([
      ["decided_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("결정자 역할은 이 조직 멤버십에서 읽고, 조직을 떠났으면 null 이다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ id: BID }]));
    fakeDb.on(
      "bid_reviews",
      fakeDb.rows([
        storedReview(),
        storedReview({
          id: "rv-0",
          assignee_id: null,
          assignee: null,
          reviewer: {
            display_name: "떠난 사람",
            email: null,
            memberships: [{ org_id: OTHER_ORG, sol_role: "ADMIN" }],
          },
        }),
        storedReview({
          id: "rv-x",
          reviewer_id: null,
          reviewer: null,
          assignee_id: null,
          assignee: null,
        }),
      ]),
    );
    const reviews = await reviewRepo.listReviews(ORG, BID);
    expect(reviews?.map((r) => r.reviewer)).toEqual([
      { id: USER, name: "김영업", role: "SALES" },
      { id: USER, name: "떠난 사람", role: null },
      { id: DELETED_REVIEWER_ID, name: "탈퇴한 사용자", role: null },
    ]);
    expect(reviews?.[1]?.assignee).toBeNull();
  });
});

describe("getReviewTarget", () => {
  it("공고가 없으면 null", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([]));
    expect(await reviewRepo.getReviewTarget(ORG, BID)).toBeNull();
  });

  it("scoreRunId 가 없으면 이 조직의 최신 점수 run 과 공고 latest_revision 을 쓴다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ latest_revision: 2 }]));
    fakeDb.on("bid_revisions", fakeDb.rows([{ id: "r2" }]));
    fakeDb.on("score_runs", fakeDb.rows([{ id: RUN, recommendation: "BID" }]));
    expect(await reviewRepo.getReviewTarget(ORG, BID)).toEqual({
      revisionId: "r2",
      analysis: { id: RUN, recommendation: "BID" },
    });
    const runs = only("score_runs");
    expect(callsOf(runs, "eq")).toEqual([
      ["org_id", ORG],
      ["bid_id", BID],
    ]);
    expect(callsOf(runs, "in")).toEqual([["status", ["COMPLETED", "PARTIAL"]]]);
    expect(callsOf(only("bid_revisions"), "eq")).toEqual([
      ["bid_id", BID],
      ["revision", 2],
    ]);
  });

  it("scoreRunId 를 주면 그 run 을 조직·공고로 좁혀 찾고, 없으면 analysis 가 null 이다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ latest_revision: 2 }]));
    fakeDb.on("bid_revisions", fakeDb.rows([{ id: "r2" }]));
    fakeDb.on("score_runs", fakeDb.rows([]));
    expect(await reviewRepo.getReviewTarget(ORG, BID, RUN)).toEqual({
      revisionId: "r2",
      analysis: null,
    });
    expect(callsOf(only("score_runs"), "eq")).toEqual([
      ["id", RUN],
      ["org_id", ORG],
      ["bid_id", BID],
    ]);
  });

  it("UUID 가 아닌 scoreRunId 는 DB 에 묻지 않고 analysis 를 null 로 둔다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ latest_revision: 2 }]));
    fakeDb.on("bid_revisions", fakeDb.rows([{ id: "r2" }]));
    expect(await reviewRepo.getReviewTarget(ORG, BID, "abc")).toEqual({
      revisionId: "r2",
      analysis: null,
    });
    expect(fakeDb.queries("score_runs")).toHaveLength(0);
  });
});

describe("isOrgMember", () => {
  it("이 조직 멤버십이 있으면 true", async () => {
    fakeDb.on("memberships", fakeDb.rows([{ user_id: ASSIGNEE }]));
    expect(await reviewRepo.isOrgMember(ORG, ASSIGNEE)).toBe(true);
    expect(callsOf(only("memberships"), "eq")).toEqual([
      ["org_id", ORG],
      ["user_id", ASSIGNEE],
    ]);
  });

  it("없거나 UUID 가 아니면 false", async () => {
    fakeDb.on("memberships", fakeDb.rows([]));
    expect(await reviewRepo.isOrgMember(ORG, ASSIGNEE)).toBe(false);
    expect(await reviewRepo.isOrgMember(ORG, "not-a-uuid")).toBe(false);
    expect(fakeDb.queries("memberships")).toHaveLength(1);
  });
});
