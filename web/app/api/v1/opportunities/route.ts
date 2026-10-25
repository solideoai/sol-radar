import {
  listOpportunities,
  parseOpportunityQuery,
  OpportunityReadError,
} from "@/server/opportunities";
import { getOpportunityClient } from "@/server/opportunities";
import { readCursorSecret } from "@/server/bids";
import { currentDefaultOrigin } from "@/app/_lib/run-mode";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { apiError, json } from "@/app/api/v1/_lib/http";

export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const q = parseOpportunityQuery(rawQueryOf(request), currentDefaultOrigin());
    if (!q.ok) return invalidQuery(q.issues);
    const client = await getOpportunityClient();
    if (!client) return apiError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다");
    try {
      return json(
        await listOpportunities(
          client,
          ctx.orgId,
          q.value,
          readCursorSecret(process.env.API_CURSOR_SECRET),
          ctx.userId,
        ),
      );
    } catch (error) {
      if (error instanceof OpportunityReadError)
        return apiError(error.code === "INVALID_CURSOR" ? 400 : 503, error.code, error.message);
      throw error;
    }
  });
}
