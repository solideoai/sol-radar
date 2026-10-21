import { serviceResponse } from "@/app/api/v1/_lib/http";
import {
  businessRoute,
  invalidQuery,
  lazyJsonBody,
  pathNotFound,
  rawQueryOf,
} from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { relayRedisApi } from "@/app/_lib/redis-api-client";
import { isUuid, listBidAnalyses, parsePageQuery, requestAnalysis } from "@/server/bids";

// 05 §2 GET /bids/:id/analyses — 이 조직의 분석 이력(HMAC 커서).
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/analyses">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    const query = parsePageQuery(rawQueryOf(request));
    if (!query.ok) return invalidQuery(query.issues);
    const deps = workDeps();
    return serviceResponse(
      await listBidAnalyses(ctx.orgId, id, query.value, deps.cursorSecret, { repo: deps.bids }),
    );
  });
}

// 05 §2·§5 POST /bids/:id/analyses — 분석 요청(202). 권한·멱등·속도 제한·큐 등록은 서비스가 정한다.
// Idempotency-Key 헤더가 없으면 null 을 넘기고, 서버가 키를 만든다.
// 본문은 서비스가 권한·키·속도 제한을 본 뒤에 읽는다(16KB 상한, 보안 L5).
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/analyses">,
): Promise<Response> {
  return businessRoute(request, async (ctx, signal) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    if (deploymentRole() === "frontend") {
      return relayRedisApi(request, `/api/v1/bids/${id}/analyses`, { signal });
    }
    const deps = workDeps();
    return serviceResponse(
      await requestAnalysis(
        ctx,
        id,
        lazyJsonBody(request),
        request.headers.get("Idempotency-Key"),
        {
          repo: deps.bids,
          queue: deps.queue,
          limiter: deps.limiter,
          onInfraError: deps.onInfraError,
        },
      ),
    );
  });
}
