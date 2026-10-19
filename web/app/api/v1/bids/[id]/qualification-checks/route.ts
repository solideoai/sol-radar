import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { getQualificationChecks, isUuid } from "@/server/bids";

// 05 §2 GET /bids/:id/qualification-checks — 이 조직의 최신 점수 run 에 저장된 자격 확인(11 G5).
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/qualification-checks">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(await getQualificationChecks(ctx.orgId, id, { repo: workDeps().bids }));
  });
}
