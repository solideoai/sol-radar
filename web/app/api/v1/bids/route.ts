import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { listBids, parseBidListQuery } from "@/server/bids";

// 05 §3 GET /bids — 공고 목록(필터·정렬·HMAC 커서). 기본 출처는 실행 모드를 따른다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const deps = workDeps();
    const query = parseBidListQuery(rawQueryOf(request), deps.runMode);
    if (!query.ok) return invalidQuery(query.issues);
    return serviceResponse(
      await listBids(ctx.orgId, query.value, deps.cursorSecret, {
        repo: deps.bids,
        userId: ctx.userId,
      }),
    );
  });
}
