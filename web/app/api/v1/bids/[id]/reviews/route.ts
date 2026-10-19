import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { isUuid, listReviews, recordReview } from "@/server/bids";

// 05 §2 GET /bids/:id/reviews — 이 조직의 결정 이력. 다른 조직의 결정은 보이지 않아 [] 다(11 G5).
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/reviews">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(await listReviews(ctx.orgId, id, { repo: workDeps().reviews }));
  });
}

// 05 §2 POST /bids/:id/reviews — 사람 최종 결정 기록(201). 권한(ADMIN·SALES)·사유·담당자는 서비스가 본다.
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/reviews">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("bid");
    return serviceResponse(
      await recordReview(ctx, id, await readJsonBody(request), { repo: workDeps().reviews }),
    );
  });
}
