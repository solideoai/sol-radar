import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import {
  analysisHistoryRepo,
  listAnalysisHistory,
  parseAnalysisHistoryQuery,
  readCursorSecret,
} from "@/server/bids";

export function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const query = parseAnalysisHistoryQuery(rawQueryOf(request));
    if (!query.ok) return invalidQuery(query.issues);
    return serviceResponse(
      await listAnalysisHistory(ctx.orgId, query.value, {
        repo: analysisHistoryRepo,
        cursorSecret: readCursorSecret(process.env.API_CURSOR_SECRET),
      }),
    );
  });
}
