import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import { serviceResponse } from "@/app/api/v1/_lib/http";
import { parseWorkforceQuery, simulateWorkforce, workforceRepo } from "@/server/workforce";
export function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const parsed = parseWorkforceQuery(rawQueryOf(request).bidIds);
    if (!parsed.success)
      return invalidQuery(
        parsed.error.issues.map((issue) => ({ path: "bidIds", message: issue.message })),
      );
    return serviceResponse(
      await simulateWorkforce(ctx.orgId, parsed.data, { repo: workforceRepo }, new Date()),
    );
  });
}
