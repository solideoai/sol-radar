import { getOpportunitySummary, parseOpportunityQuery } from "@/server/opportunities";
import { getOpportunityClient } from "@/server/opportunities";
import { currentRunMode } from "@/app/_lib/run-mode";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { apiError, json } from "@/app/api/v1/_lib/http";
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const q = parseOpportunityQuery(rawQueryOf(request), currentRunMode());
    if (!q.ok) return invalidQuery(q.issues);
    const client = await getOpportunityClient();
    if (!client) return apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다");
    return json(
      await getOpportunitySummary(client, ctx.orgId, q.value.origin, q.value.asOf ?? undefined),
    );
  });
}
