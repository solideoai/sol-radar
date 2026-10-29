import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { insightDeps } from "@/app/_lib/insight-deps";
import { relayRedisApi } from "@/app/_lib/redis-api-client";
import { isUuid } from "@/server/bids";
import { readInsight, requestInsight } from "@/server/insight";

// 추천 분석(ADR-066, 계획 C2). 판정은 규칙 엔진 그대로이고 이 경로는 Qwen 의 판단 이유·강점·보완할 점만 다룬다.

// GET /bids/:id/analyses/:runId/insight — 그 run 의 최신 1건. 모든 업무 역할이 읽는다.
// 어느 배포 역할이든 회사 API 로 중계하지 않고 사용자 세션(RLS)으로 직접 읽는다.
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/analyses/[runId]/insight">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id, runId } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    if (!isUuid(runId)) return pathNotFound("analysis");
    return serviceResponse(await readInsight(ctx, id, runId));
  });
}

// POST /bids/:id/analyses/:runId/insight — 요청(202). 본문은 읽지 않고 Idempotency-Key 도 쓰지 않는다(중복은 run 기준).
// frontend(Vercel)는 회사 API(relay op insight-submit)로 보내고 202 만 성공으로 돌려준다.
// redis-api·standalone 은 서비스가 권한·run·중복·속도 제한을 보고 PENDING 행과 insight job 을 만든다.
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/analyses/[runId]/insight">,
): Promise<Response> {
  return businessRoute(request, async (ctx, signal) => {
    const { id, runId } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    if (!isUuid(runId)) return pathNotFound("analysis");
    if (deploymentRole() === "frontend") {
      return relayRedisApi(request, `/api/v1/bids/${id}/analyses/${runId}/insight`, { signal });
    }
    return serviceResponse(await requestInsight(ctx, id, runId, insightDeps()));
  });
}
