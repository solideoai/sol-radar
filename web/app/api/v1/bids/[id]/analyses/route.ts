import { serviceResponse } from "@/app/api/v1/_lib/http";
import {
  businessRoute,
  invalidQuery,
  pathNotFound,
  rawQueryOf,
  readJsonBody,
} from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
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
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/analyses">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    const deps = workDeps();
    return serviceResponse(
      await requestAnalysis(
        ctx,
        id,
        await readJsonBody(request),
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
