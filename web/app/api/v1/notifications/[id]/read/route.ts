import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { isUuid, markNotificationRead } from "@/server/bids";

// 05 §2 PATCH /notifications/:id/read — 내 알림 읽음 처리(D8). 남의 알림은 없는 것과 같은 404 다.
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/v1/notifications/[id]/read">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("notification");
    return serviceResponse(
      await markNotificationRead(ctx.userId, id, { repo: workDeps().notifications }),
    );
  });
}
