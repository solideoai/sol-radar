import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { listNotifications, parseNotificationQuery } from "@/server/bids";

// 05 §2 GET /notifications — 내 알림(HMAC 커서). 링크는 서비스가 앱 안 경로로 바꾼다(O1).
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const query = parseNotificationQuery(rawQueryOf(request));
    if (!query.ok) return invalidQuery(query.issues);
    const deps = workDeps();
    return serviceResponse(
      await listNotifications(ctx.orgId, ctx.userId, query.value, deps.cursorSecret, {
        repo: deps.notifications,
      }),
    );
  });
}
