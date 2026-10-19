import { describe, expect, it, vi } from "vitest";
import type { CreateReview, ReviewRepo, ReviewTarget } from "./bids.repo";
import { recordReview } from "./review.service";
import type { Review } from "./review.model";

const ctx = { orgId: "org1", userId: "u1", role: "SALES" as const };
const reason = "근거가 충분해 입찰을 권고합니다";

function fake(overrides: Partial<ReviewRepo> = {}) {
  const created: CreateReview[] = [];
  const target: ReviewTarget = {
    revisionId: "rev1",
    analysis: { id: "run1", recommendation: "BID" },
  };
  const repo: ReviewRepo = {
    getReviewTarget: async () => target,
    isOrgMember: async () => true,
    createReview: async (input) => {
      created.push(input);
      return {
        id: "r1",
        bidId: input.bidId,
        revisionId: input.revisionId,
        scoreRunId: input.scoreRunId,
        reviewer: { id: input.reviewerId, name: "영업", role: "SALES" },
        decision: input.decision,
        reason: input.reason,
        decidedAt: "2026-10-19T00:00:00Z",
        assignee: null,
        systemRecommendationAtDecision: input.systemRecommendationAtDecision,
        disagreementFlag: input.disagreementFlag,
      } satisfies Review;
    },
    ...overrides,
  };
  return { repo, created };
}

describe("recordReview", () => {
  it("ANALYST 는 403 이다", async () => {
    const f = fake();
    const result = await recordReview(
      { ...ctx, role: "ANALYST" },
      "b1",
      { decision: "BID", reason },
      f,
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    expect(f.created).toHaveLength(0);
  });

  it("사유가 9자면 400 이고 첫 이슈 path 가 reason 이다", async () => {
    const result = await recordReview(ctx, "b1", { decision: "BID", reason: "123456789" }, fake());
    expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
    if (!result.ok) {
      const issues = result.details?.issues as { path: string }[];
      expect(issues[0]?.path).toBe("reason");
    }
  });

  it("공고가 없으면 404 bid 다", async () => {
    const f = fake({ getReviewTarget: async () => null });
    const result = await recordReview(ctx, "b1", { decision: "BID", reason }, f);
    expect(result).toMatchObject({ ok: false, status: 404, details: { resource: "bid" } });
  });

  it("지정한 분석 run 이 없으면 404 analysis 다", async () => {
    const f = fake({ getReviewTarget: async () => ({ revisionId: "rev1", analysis: null }) });
    const result = await recordReview(ctx, "b1", { decision: "BID", reason, scoreRunId: "zz" }, f);
    expect(result).toMatchObject({ ok: false, status: 404, details: { resource: "analysis" } });
  });

  it("담당자가 조직 밖이면 404 이고 resource 가 assignee 다", async () => {
    const f = fake({ isOrgMember: async () => false });
    const result = await recordReview(
      ctx,
      "b1",
      { decision: "BID", reason, assigneeUserId: "x" },
      f,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "assignee" },
    });
    expect(f.created).toHaveLength(0);
  });

  it("결정과 권고가 같으면 201 이고 disagreementFlag 는 false 다", async () => {
    const f = fake();
    const result = await recordReview(ctx, "b1", { decision: "BID", reason }, f);
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(f.created[0]).toMatchObject({
      reviewerId: "u1",
      scoreRunId: "run1",
      revisionId: "rev1",
      systemRecommendationAtDecision: "BID",
      disagreementFlag: false,
      assigneeUserId: null,
    });
  });

  it("결정과 최신 권고가 다르면 disagreementFlag=true 다", async () => {
    const f = fake();
    const result = await recordReview(ctx, "b1", { decision: "NO_BID", reason }, f);
    expect(result.ok && result.data.disagreementFlag).toBe(true);
  });

  it("분석이 없으면 권고는 null 이고 불일치가 아니다", async () => {
    const f = fake({ getReviewTarget: async () => ({ revisionId: "rev1", analysis: null }) });
    const result = await recordReview(ctx, "b1", { decision: "WATCH", reason }, f);
    expect(result.ok && result.data.scoreRunId).toBeNull();
    expect(result.ok && result.data.disagreementFlag).toBe(false);
  });

  it("scoreRunId 를 주면 그 run 을 기준으로 target 을 읽는다", async () => {
    const spy = vi.fn(async () => ({
      revisionId: "rev1",
      analysis: { id: "run0", recommendation: "WATCH" as const },
    }));
    const f = fake({ getReviewTarget: spy });
    await recordReview(ctx, "b1", { decision: "WATCH", reason, scoreRunId: "run0" }, f);
    expect(spy).toHaveBeenCalledWith("org1", "b1", "run0");
  });
});
