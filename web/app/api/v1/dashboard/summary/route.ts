import { json } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { getDashboardSummary, parseOriginQuery } from "@/server/bids";

// 05 §4.6 GET /dashboard/summary — 이 조직의 대시보드 요약. 기본 출처는 실행 모드를 따른다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const deps = workDeps();
    const query = parseOriginQuery(rawQueryOf(request), deps.runMode);
    if (!query.ok) return invalidQuery(query.issues);
    return json(
      await getDashboardSummary(
        ctx.orgId,
        query.value.origin,
        { repo: deps.dashboard },
        new Date(),
      ),
    );
  });
}
