import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { ingestionDeps } from "@/app/_lib/ingestion-deps";
import { getIngestionRun } from "@/server/ingestion";

// 05 §2 GET /admin/ingestion/runs/:id — 수집 실행 하나. ADMIN 만이고 권한을 경로 id 보다 먼저 본다(서비스).
// id 가 UUID 가 아니거나 행이 없으면(worker 가 아직 만들지 않은 run 포함) 404 {resource:"ingestionRun"} 다.
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/admin/ingestion/runs/[id]">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    return serviceResponse(await getIngestionRun(ctx, id, ingestionDeps(ctx.orgId)));
  });
}
