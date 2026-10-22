import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { getBidRevision, isUuid, parseRevisionParam } from "@/server/bids";

// 05 §2 GET /bids/:id/revisions/:rev — 그 revision 의 정규화 스냅샷.
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/revisions/[rev]">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id, rev } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    const revision = parseRevisionParam(rev);
    if (revision === null) return pathNotFound("revision");
    return serviceResponse(
      await getBidRevision(ctx.orgId, id, revision, { repo: workDeps().bids }),
    );
  });
}
