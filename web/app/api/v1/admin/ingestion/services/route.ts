import { loadSourceSummary } from "@/app/_lib/opportunity-sources";
import { getOpportunityClient } from "@/server/opportunities";
import { currentDefaultOrigin } from "@/app/_lib/run-mode";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { apiError, json } from "@/app/api/v1/_lib/http";
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    if (ctx.role !== "ADMIN")
      return apiError(403, "FORBIDDEN", "관리자만 수집 서비스를 조회할 수 있습니다");
    const client = await getOpportunityClient();
    if (!client) return apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다");
    return json(await loadSourceSummary(client, currentDefaultOrigin()));
  });
}
