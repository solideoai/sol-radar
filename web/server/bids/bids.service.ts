import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SolRole } from "@/server/organization";
import type { AnalysisView } from "./analysis-view.model";
import { signCursor, verifyCursor, fingerprintOf, type BidListQuery } from "./bid-query";
import type { BidDetail } from "./bid-detail.model";
import type { AnalysisStatus, BidListItem, Page, ServiceErrorCode } from "./bid.model";
import type { AnalysisQueue, BidsRepo, ListAfter } from "./bids.repo";

// 공고·분석 서비스. 예상한 실패는 결과로 돌려주고, HTTP 로 옮기는 일은 Route Handler(B1)가 한다.

export type ServiceResult<T> =
  | { ok: true; status: 200 | 201 | 202; data: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 429 | 503;
      code: ServiceErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };
export type ServiceFailure = Extract<ServiceResult<never>, { ok: false }>;

export function fail(
  status: ServiceFailure["status"],
  code: ServiceErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ServiceFailure {
  return details === undefined
    ? { ok: false, status, code, message }
    : { ok: false, status, code, message, details };
}

export type AnalysisContext = { orgId: string; userId: string; role: SolRole };
export type AnalysisAccepted = {
  analysisId: string;
  status: AnalysisStatus;
  deduplicated: boolean;
  pollUrl: string;
};

const ANALYSIS_ROLES: readonly SolRole[] = ["ADMIN", "SALES", "ANALYST"];
const REVIEW_ROLES: readonly SolRole[] = ["ADMIN", "SALES"];

export const canRequestAnalysis = (role: SolRole): boolean => ANALYSIS_ROLES.includes(role);
export const canRecordReview = (role: SolRole): boolean => REVIEW_ROLES.includes(role);
export const REQUEST_ANALYSIS_ROLES = ANALYSIS_ROLES;
export const RECORD_REVIEW_ROLES = REVIEW_ROLES;

export const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

// 05 §4.5 AnalysisRequest
const analysisRequestSchema = z.strictObject({
  profileRevision: z.number().int().positive().optional(),
  force: z.boolean().default(false),
});

const pollUrlOf = (id: string) => `/api/v1/analyses/${id}`;

function requestHashOf(bidId: string, profileRevision: number | undefined, force: boolean): string {
  return createHash("sha256")
    .update(JSON.stringify([bidId, profileRevision ?? null, force]))
    .digest("hex");
}

// 분석 요청: 권한 → 본문 → 공고 → 입력 → 멱등 → 진행 중 → 중복 → QUEUED 행 → 큐.
export async function requestAnalysis(
  ctx: AnalysisContext,
  bidId: string,
  input: unknown,
  idempotencyKey: string | null,
  deps: { repo: BidsRepo; queue: AnalysisQueue },
): Promise<ServiceResult<AnalysisAccepted>> {
  const { repo, queue } = deps;
  if (!canRequestAnalysis(ctx.role)) {
    return fail(403, "FORBIDDEN", "분석을 요청할 권한이 없습니다", { required: ANALYSIS_ROLES });
  }
  const parsed = analysisRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
      issues: issuesOf(parsed.error),
    });
  }
  const { profileRevision, force } = parsed.data;

  const bid = await repo.getBid(ctx.orgId, bidId);
  if (bid === null) return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });

  const analysisInput = await repo.resolveAnalysisInput(ctx.orgId, bidId, profileRevision);
  if (analysisInput === null) {
    return fail(404, "NOT_FOUND", "회사 프로필 revision 을 찾을 수 없습니다", {
      resource: "profileRevision",
    });
  }

  // 05 §1 은 Idempotency-Key 를 "받는다" 고만 정한다(필수 아님). 없으면 서버가 UUID 를 만든다.
  const storedKey = `${ctx.orgId}:${idempotencyKey ?? randomUUID()}`;
  const requestHash = requestHashOf(bidId, profileRevision, force);

  if (idempotencyKey !== null) {
    const earlier = await repo.findIdempotency(ctx.orgId, storedKey);
    if (earlier !== null) {
      if (earlier.requestHash !== requestHash) {
        return fail(409, "IDEMPOTENCY_KEY_REUSED", "같은 키로 다른 요청을 보냈습니다");
      }
      return {
        ok: true,
        status: 202,
        data: {
          analysisId: earlier.run.id,
          status: earlier.run.status,
          deduplicated: false,
          pollUrl: pollUrlOf(earlier.run.id),
        },
      };
    }
  }

  const running = await repo.findRunningAnalysis(ctx.orgId, bidId);
  if (running !== null) {
    return fail(409, "ANALYSIS_IN_PROGRESS", "이 공고의 분석이 진행 중입니다", {
      analysisId: running.id,
    });
  }

  if (!force) {
    const done = await repo.findCompletedSameInput(ctx.orgId, bidId, analysisInput.profileRevision);
    if (done !== null) {
      return {
        ok: true,
        status: 202,
        data: {
          analysisId: done.id,
          status: done.status,
          deduplicated: true,
          pollUrl: pollUrlOf(done.id),
        },
      };
    }
  }

  // 큐에 넣기 전에 QUEUED 행을 먼저 남긴다. worker 가 이 행을 읽는다.
  const run = await repo.createAnalysisRun({
    ...analysisInput,
    orgId: ctx.orgId,
    bidId,
    requestedBy: ctx.userId,
    idempotencyKey: storedKey,
    requestHash,
  });
  try {
    await queue.enqueue({ orgId: ctx.orgId, scoreRunId: run.id, idempotencyKey: storedKey });
  } catch {
    // QUEUED 행이 남으면 같은 입력의 다음 요청이 active 인덱스에 막힌다. FAILED 로 풀어 준다.
    await repo.markRunFailed(ctx.orgId, run.id, "ENQUEUE_FAILED");
    return fail(503, "SERVICE_UNAVAILABLE", "분석 큐에 넣지 못했습니다", { component: "queue" });
  }
  return {
    ok: true,
    status: 202,
    data: {
      analysisId: run.id,
      status: run.status,
      deduplicated: false,
      pollUrl: pollUrlOf(run.id),
    },
  };
}

// ── 조회 ──

export async function listBids(
  orgId: string,
  query: BidListQuery,
  cursorSecret: string,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<Page<BidListItem>>> {
  let after: ListAfter = null;
  if (query.cursor !== null) {
    const verified = verifyCursor(query.cursor, query, cursorSecret);
    if (!verified.ok) return fail(400, "INVALID_CURSOR", "커서가 올바르지 않습니다");
    after = verified.payload;
  }
  const rows = await deps.repo.listBids(orgId, query, after);
  const nextCursor =
    rows.hasNext && rows.last !== null
      ? signCursor({ ...rows.last, queryFingerprint: fingerprintOf(query) }, cursorSecret)
      : null;
  return {
    ok: true,
    status: 200,
    data: {
      items: rows.items,
      pageInfo: { cursor: query.cursor, nextCursor, hasNext: nextCursor !== null },
    },
  };
}

export async function getBid(
  orgId: string,
  id: string,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<BidDetail>> {
  const bid = await deps.repo.getBid(orgId, id);
  if (bid === null) return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
  return { ok: true, status: 200, data: bid };
}

// 저장 행 → 뷰 변환은 repo 구현(B1)이 한다. 여기서는 값을 그대로 넘긴다.
export async function getAnalysis(
  orgId: string,
  id: string,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<AnalysisView>> {
  const analysis = await deps.repo.getAnalysis(orgId, id);
  if (analysis === null) {
    return fail(404, "NOT_FOUND", "분석을 찾을 수 없습니다", { resource: "analysis" });
  }
  return { ok: true, status: 200, data: analysis };
}
