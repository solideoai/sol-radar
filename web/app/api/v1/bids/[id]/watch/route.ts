import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { watchDeps } from "@/app/_lib/watch-deps";
import { isUuid } from "@/server/bids";
import { unwatchBid, watchBid } from "@/server/watchlist";

// 05 §2 PUT·DELETE /bids/:id/watch — 관심 등록·해제(P1, ADR-021 N3). 둘 다 멱등이고 200 { bidId, watched, watcherCount } 다.
// 조직·사람은 세션이 정한다(M17). 본문은 읽지 않는다. 모든 업무 역할(VIEWER 포함)이 자기 관심을 쓴다.

export async function PUT(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/watch">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(
      await watchBid({ orgId: ctx.orgId, userId: ctx.userId }, id, watchDeps()),
    );
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/watch">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(
      await unwatchBid({ orgId: ctx.orgId, userId: ctx.userId }, id, watchDeps()),
    );
  });
}
