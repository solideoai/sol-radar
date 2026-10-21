import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { isUuid, listBidRevisions } from "@/server/bids";

// 05 §2 GET /bids/:id/revisions — 공고의 revision 목록(최신 먼저).
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/revisions">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(await listBidRevisions(ctx.orgId, id, { repo: workDeps().bids }));
  });
}
