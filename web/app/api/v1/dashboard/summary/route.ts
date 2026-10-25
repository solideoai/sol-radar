import { json } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { currentDefaultOrigin } from "@/app/_lib/run-mode";
import { getDashboardSummary, parseOriginQuery } from "@/server/bids";

// 05 §4.6 GET /dashboard/summary — 이 조직의 대시보드 요약. 기본 출처는 SOL_DEFAULT_ORIGIN, 없으면 실행 모드를 따른다.
// 상단바 수집 신선도가 origin 없이 이 주소를 읽으므로 신선도도 기본 출처 기준이다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const deps = workDeps();
    const query = parseOriginQuery(rawQueryOf(request), currentDefaultOrigin(deps.runMode));
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
