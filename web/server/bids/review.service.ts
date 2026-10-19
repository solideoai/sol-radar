import "server-only";
import { reviewInputSchema } from "./review.model";
import type { Review } from "./review.model";
import type { ReviewRepo } from "./bids.repo";
import {
  RECORD_REVIEW_ROLES,
  canRecordReview,
  fail,
  issuesOf,
  type AnalysisContext,
  type ServiceResult,
} from "./bids.service";

// 사람 최종 결정 기록(05 §2 POST /bids/:id/reviews). 권한 → 본문 → 공고 → 담당자 → 쓰기.
export async function recordReview(
  ctx: AnalysisContext,
  bidId: string,
  input: unknown,
  deps: { repo: ReviewRepo },
): Promise<ServiceResult<Review>> {
  const { repo } = deps;
  if (!canRecordReview(ctx.role)) {
    return fail(403, "FORBIDDEN", "결정을 기록할 권한이 없습니다", {
      required: RECORD_REVIEW_ROLES,
    });
  }
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
      issues: issuesOf(parsed.error),
    });
  }
  const { decision, reason, scoreRunId, assigneeUserId } = parsed.data;

  const target = await repo.getReviewTarget(ctx.orgId, bidId, scoreRunId);
  if (target === null)
    return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
  if (scoreRunId !== undefined && target.analysis === null) {
    return fail(404, "NOT_FOUND", "분석을 찾을 수 없습니다", { resource: "analysis" });
  }
  if (assigneeUserId !== undefined && !(await repo.isOrgMember(ctx.orgId, assigneeUserId))) {
    return fail(404, "NOT_FOUND", "담당자를 찾을 수 없습니다", { resource: "assignee" });
  }

  const system = target.analysis?.recommendation ?? null;
  const review = await repo.createReview({
    orgId: ctx.orgId,
    bidId,
    revisionId: target.revisionId,
    scoreRunId: target.analysis?.id ?? null,
    reviewerId: ctx.userId,
    decision,
    reason,
    assigneeUserId: assigneeUserId ?? null,
    systemRecommendationAtDecision: system,
    disagreementFlag: system !== null && decision !== system,
  });
  return { ok: true, status: 201, data: review };
}
