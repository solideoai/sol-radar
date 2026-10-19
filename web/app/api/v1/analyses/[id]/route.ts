import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { getAnalysis, isUuid } from "@/server/bids";

// 05 §2 GET /analyses/:id — 분석 한 건(화면 polling). 다른 조직의 run 은 없는 것과 같은 404 다.
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/analyses/[id]">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("analysis");
    return serviceResponse(await getAnalysis(ctx.orgId, id, { repo: workDeps().bids }));
  });
}
