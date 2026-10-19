import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SolRole } from "@/server/organization";
import type { AnalysisView, QualificationCheckView } from "./analysis-view.model";
import {
  cursorScope,
  fingerprintOf,
  signCursor,
  verifyCursor,
  type BidListQuery,
  type PageQuery,
} from "./bid-query";
import type { BidDetail } from "./bid-detail.model";
import {
  isUuid,
  type AnalysisStatus,
  type BidListItem,
  type Page,
  type ServiceErrorCode,
} from "./bid.model";
import type {
  AnalysisQueue,
  AnalysisRateLimiter,
  BidsRepo,
  ListAfter,
  PagedRows,
  RunRef,
} from "./bids.repo";

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

// 커서 비밀(API_CURSOR_SECRET)이 없거나 짧으면 목록을 내지 않는다.
export const cursorUnavailable = (): ServiceFailure =>
  fail(503, "SERVICE_UNAVAILABLE", "커서 서명 설정이 올바르지 않습니다", { component: "cursor" });

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

export type AnalysisDeps = {
  repo: BidsRepo;
  queue: AnalysisQueue;
  limiter: AnalysisRateLimiter;
  // Redis 계열 장애(속도 제한 저장소 "redis", 큐 등록 "queue")의 원인을 로그로 남기는 곳.
  // Route Handler 가 넘긴다. 응답에는 싣지 않고, 이 콜백이 던져도 응답과 run 정리는 영향받지 않는다.
  onInfraError: (component: "queue" | "redis", error: unknown) => void;
};

// 로그 콜백이 던져도 응답을 바꾸지 않는다.
function reportInfraError(deps: AnalysisDeps, component: "queue" | "redis", error: unknown): void {
  try {
    deps.onInfraError(component, error);
  } catch {
    // 로깅 실패는 삼킨다. 원래 장애 응답이 우선이다.
  }
}

// 분석 요청: 권한 → 키 형식 → 속도 제한 → 본문 → 공고 → 입력 → 멱등 → 진행 중 → 중복 → QUEUED 행 → 큐.
export async function requestAnalysis(
  ctx: AnalysisContext,
  bidId: string,
  input: unknown,
  idempotencyKey: string | null,
  deps: AnalysisDeps,
): Promise<ServiceResult<AnalysisAccepted>> {
  const { repo, queue, limiter } = deps;
  if (!canRequestAnalysis(ctx.role)) {
    return fail(403, "FORBIDDEN", "분석을 요청할 권한이 없습니다", { required: ANALYSIS_ROLES });
  }
  if (idempotencyKey !== null && !isUuid(idempotencyKey)) {
    return fail(400, "VALIDATION_ERROR", "Idempotency-Key 는 UUID 여야 합니다", {
      issues: [{ path: "Idempotency-Key", message: "UUID 여야 합니다" }],
    });
  }
  let limit: Awaited<ReturnType<AnalysisRateLimiter["hit"]>>;
  try {
    limit = await limiter.hit(ctx.orgId);
  } catch (error) {
    reportInfraError(deps, "redis", error);
    return fail(503, "SERVICE_UNAVAILABLE", "속도 제한 저장소에 연결하지 못했습니다", {
      component: "redis",
    });
  }
  if (!limit.allowed) {
    return fail(429, "RATE_LIMITED", "분석 요청이 너무 많습니다", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
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
  // 대소문자만 다른 같은 UUID 가 run 을 둘 만들지 않게 소문자로 저장·조회한다.
  const storedKey = `${ctx.orgId}:${(idempotencyKey ?? randomUUID()).toLowerCase()}`;
  const requestHash = requestHashOf(bidId, profileRevision, force);

  // 같은 키 재생: 같은 본문이면 첫 응답, 다른 본문이면 409.
  const replay = (earlier: {
    requestHash: string;
    run: RunRef;
  }): ServiceResult<AnalysisAccepted> =>
    earlier.requestHash !== requestHash
      ? fail(409, "IDEMPOTENCY_KEY_REUSED", "같은 키로 다른 요청을 보냈습니다")
      : accepted(earlier.run, false);
  // 같은 입력이 진행 중: force:false 는 그 run 을 돌려주고, force:true 는 409 다(05 §5).
  const active = (run: RunRef): ServiceResult<AnalysisAccepted> =>
    force
      ? fail(409, "ANALYSIS_IN_PROGRESS", "같은 입력의 분석이 진행 중입니다", {
          analysisId: run.id,
        })
      : accepted(run, true);

  if (idempotencyKey !== null) {
    const earlier = await repo.findIdempotency(ctx.orgId, storedKey);
    if (earlier !== null) return replay(earlier);
  }

  const running = await repo.findRunningAnalysis(ctx.orgId, bidId, analysisInput);
  if (running !== null) return active(running);

  if (!force) {
    const done = await repo.findCompletedSameInput(ctx.orgId, bidId, analysisInput);
    if (done !== null) return accepted(done, true);
  }

  // 큐에 넣기 전에 QUEUED 행을 먼저 남긴다. worker 가 이 행을 읽는다.
  const created = await repo.createAnalysisRun({
    ...analysisInput,
    orgId: ctx.orgId,
    bidId,
    requestedBy: ctx.userId,
    idempotencyKey: storedKey,
    requestHash,
  });
  if ("conflict" in created) {
    // 동시 요청이 먼저 들어갔다. 위 분기와 같게 처리한다.
    if (created.conflict === "ACTIVE_INPUT") return active(created.run);
    // 같은 키로 먼저 들어간 요청을 다시 찾는다. 못 찾으면 키만 쓰인 것이라 재생할 수 없다.
    const earlier = await repo.findIdempotency(ctx.orgId, storedKey);
    if (earlier === null) {
      return fail(409, "IDEMPOTENCY_KEY_REUSED", "같은 키의 요청을 확인할 수 없습니다");
    }
    return replay(earlier);
  }
  const run = created.created;
  try {
    await queue.enqueue({ orgId: ctx.orgId, scoreRunId: run.id, idempotencyKey: storedKey });
  } catch (error) {
    // QUEUED 행이 남으면 같은 입력의 다음 요청이 active 인덱스에 막힌다. FAILED 로 풀어 준다.
    // markRunFailed 가 던지면 전파한다. run 은 QUEUED 로 남고 b3 복구가 10분 뒤 STALE_RUN 으로 닫는다.
    await repo.markRunFailed(ctx.orgId, run.id, "ENQUEUE_FAILED");
    reportInfraError(deps, "queue", error);
    return fail(503, "SERVICE_UNAVAILABLE", "분석 큐에 넣지 못했습니다", { component: "queue" });
  }
  return accepted(run, false);
}

const accepted = (run: RunRef, deduplicated: boolean): ServiceResult<AnalysisAccepted> => ({
  ok: true,
  status: 202,
  data: { analysisId: run.id, status: run.status, deduplicated, pollUrl: pollUrlOf(run.id) },
});

// ── 조회 ──

// 커서 페이지 공통 흐름: 비밀 검사 → 커서 검증 → 조회 → 다음 커서 서명.
// fetch 가 ServiceFailure 를 돌려주면(예: 공고 없음) 그대로 낸다.
export async function paginate<T>(
  scope: string,
  query: PageQuery,
  cursorSecret: string | null,
  fetch: (after: ListAfter) => Promise<PagedRows<T> | ServiceFailure>,
): Promise<ServiceResult<Page<T>>> {
  if (cursorSecret === null) return cursorUnavailable();
  let after: ListAfter = null;
  if (query.cursor !== null) {
    const verified = verifyCursor(query.cursor, scope, cursorSecret);
    if (!verified.ok) return fail(400, "INVALID_CURSOR", "커서가 올바르지 않습니다");
    after = verified.payload;
  }
  const rows = await fetch(after);
  if ("ok" in rows) return rows;
  const nextCursor =
    rows.hasNext && rows.last !== null
      ? signCursor({ ...rows.last, queryFingerprint: scope }, cursorSecret)
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

export function listBids(
  orgId: string,
  query: BidListQuery,
  cursorSecret: string | null,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<Page<BidListItem>>> {
  return paginate(fingerprintOf(query), query, cursorSecret, (after) =>
    deps.repo.listBids(orgId, query, after),
  );
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

// GET /bids/:id/analyses. 커서는 공고마다 따로 묶는다.
export function listBidAnalyses(
  orgId: string,
  bidId: string,
  query: PageQuery,
  cursorSecret: string | null,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<Page<AnalysisView>>> {
  return paginate(cursorScope("analyses", [bidId]), query, cursorSecret, async (after) => {
    if (!(await deps.repo.bidExists(orgId, bidId))) {
      return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
    }
    return deps.repo.listAnalyses(orgId, bidId, query.limit, after);
  });
}

// GET /bids/:id/qualification-checks. 이 조직의 최신 점수 run 에 저장된 행을 그대로 낸다(11 G5).
export async function getQualificationChecks(
  orgId: string,
  bidId: string,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<QualificationCheckView[]>> {
  if (!(await deps.repo.bidExists(orgId, bidId))) {
    return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
  }
  const analysis = await deps.repo.getLatestScoredAnalysis(orgId, bidId);
  if (analysis === null) {
    return fail(404, "NOT_FOUND", "분석을 찾을 수 없습니다", { resource: "analysis" });
  }
  return { ok: true, status: 200, data: analysis.qualification.checks };
}
