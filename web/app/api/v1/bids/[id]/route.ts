import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { getBid, isUuid } from "@/server/bids";

// 05 §2 GET /bids/:id — 공고 상세. 최신 분석·결정은 이 조직 것만 싣는다(11 G5).
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(await getBid(ctx.orgId, id, { repo: workDeps().bids }));
  });
}
