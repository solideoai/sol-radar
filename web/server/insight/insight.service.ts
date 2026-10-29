import "server-only";
import type {
  InsightContext,
  InsightReadResult,
  InsightRepo,
  InsightRequestDeps,
  InsightRequestResult,
  InsightRunRef,
} from "./insight-request.model";
import { INSIGHT_REQUEST_ROLES, type InsightStatus, type InsightView } from "./insight.model";
import { insightRepo } from "./insight.repo";

// ── 서비스: 추천 분석 요청(POST)과 조회(GET) ──
// 로그인·CSRF·가입 완료·업무 조직은 Route Handler 입구(businessRoute)가 이미 봤다.
// 중복은 run 기준으로 막는다(Idempotency-Key 는 쓰지 않는다). run 에 PENDING 이 있거나 검증을 통과한 모델 설명(DONE·MODEL)이
// 있으면 새 행을 만들지 않고 그 행을 돌려준다. FAILED·TEMPLATE 뒤의 요청은 새 행이다.

const COMPLETED_RUN_STATUSES = ["COMPLETED", "PARTIAL"];

const pollUrlOf = (bidId: string, runId: string) =>
  `/api/v1/bids/${bidId}/analyses/${runId}/insight`;

const forbidden: InsightRequestResult = {
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  message: "추천 분석을 요청할 권한이 없습니다",
  details: { required: INSIGHT_REQUEST_ROLES },
};

// run 이 없음·다른 조직(RLS 로 안 보임)·다른 공고·완료 전이거나 실패한 run 은 모두 같은 404 다.
const runNotFound = {
  ok: false,
  status: 404,
  code: "NOT_FOUND",
  message: "분석을 찾을 수 없습니다",
  details: { resource: "analysis" },
} as const;

const isCompletedRunOf = (run: InsightRunRef | null, bidId: string): boolean =>
  run !== null && run.bidId === bidId && COMPLETED_RUN_STATUSES.includes(run.status);

// 있던 행을 다시 쓴다. PENDING 이면 큐에 다시 넣는다(같은 jobId 라 job 은 하나다).
const isReusable = (insight: InsightView): boolean =>
  insight.status === "PENDING" || (insight.status === "DONE" && insight.source === "MODEL");

// 로그 콜백이 던져도 응답을 바꾸지 않는다.
function reportInfraError(
  deps: InsightRequestDeps,
  component: "queue" | "redis",
  error: unknown,
): void {
  try {
    deps.onInfraError(component, error);
  } catch {
    // 로깅 실패는 삼킨다. 원래 장애 응답이 우선이다.
  }
}

export async function requestInsight(
  ctx: InsightContext,
  bidId: string,
  runId: string,
  deps: InsightRequestDeps,
): Promise<InsightRequestResult> {
  if (!INSIGHT_REQUEST_ROLES.some((role) => role === ctx.role)) return forbidden;
  const { repo } = deps;
  if (!isCompletedRunOf(await repo.findRun(ctx.orgId, runId), bidId)) return runNotFound;

  const accepted = async (
    insightId: string,
    status: InsightStatus,
    deduplicated: boolean,
  ): Promise<InsightRequestResult> => {
    if (status === "PENDING") {
      try {
        await deps.enqueue({ insightId, orgId: ctx.orgId });
      } catch (error) {
        // 행은 PENDING 으로 남는다. 다음 요청이 같은 행을 다시 큐에 넣고, 아무도 다시 누르지 않으면
        // worker 정리가 10분 뒤 FAILED(STALE)로 닫는다. 화면 역할은 행을 고칠 권한이 없다.
        reportInfraError(deps, "queue", error);
        return {
          ok: false,
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "추천 분석 큐에 넣지 못했습니다",
          details: { component: "queue" },
        };
      }
    }
    return {
      ok: true,
      status: 202,
      data: { insightId, status, deduplicated, pollUrl: pollUrlOf(bidId, runId) },
    };
  };

  const latest = await repo.latestInsight(ctx.orgId, runId);
  if (latest !== null && isReusable(latest)) return accepted(latest.id, latest.status, true);

  // 횟수는 새 행(모델 호출)을 만들 때만 센다. 키는 사용자다(조직이 아니다).
  let limit: Awaited<ReturnType<InsightRequestDeps["limiter"]["hit"]>>;
  try {
    limit = await deps.limiter.hit(ctx.userId);
  } catch (error) {
    reportInfraError(deps, "redis", error);
    return {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "속도 제한 저장소에 연결하지 못했습니다",
      details: { component: "redis" },
    };
  }
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      message: "추천 분석 요청이 너무 많습니다",
      details: { retryAfterSeconds: limit.retryAfterSeconds },
    };
  }

  const created = await repo.insertPending(ctx.orgId, runId);
  if (created !== null) return accepted(created, "PENDING", false);
  // 같은 run 의 PENDING 이 먼저 들어갔다(두 번 누르기·relay 재시도). 그 행을 돌려준다.
  const earlier = await repo.latestInsight(ctx.orgId, runId);
  if (earlier === null) throw new Error("추천 분석 PENDING 충돌 뒤 행을 찾지 못했습니다");
  return accepted(earlier.id, earlier.status, true);
}

/** GET: 그 run 의 최신 1건. 모든 업무 역할이 읽는다(RLS 가 조직을 거른다). */
export async function readInsight(
  ctx: Pick<InsightContext, "orgId">,
  bidId: string,
  runId: string,
  { repo = insightRepo }: { repo?: InsightRepo } = {},
): Promise<InsightReadResult> {
  const [run, insight] = await Promise.all([
    repo.findRun(ctx.orgId, runId),
    repo.latestInsight(ctx.orgId, runId),
  ]);
  if (!isCompletedRunOf(run, bidId)) return runNotFound;
  return { ok: true, status: 200, data: { insight } };
}

/** 공고 상세 첫 화면의 값. run 이 그 공고의 완료 run 이 아니면 null 이다. */
export async function getInsight(
  ctx: Pick<InsightContext, "orgId">,
  bidId: string,
  runId: string,
  deps: { repo?: InsightRepo } = {},
): Promise<InsightView | null> {
  const result = await readInsight(ctx, bidId, runId, deps);
  return result.ok ? result.data.insight : null;
}
