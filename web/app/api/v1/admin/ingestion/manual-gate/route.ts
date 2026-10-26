import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { ingestionDeps } from "@/app/_lib/ingestion-deps";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { relayRedisApi } from "@/app/_lib/redis-api-client";
import { canManageIngestion, getManualIngestGate, ingestionForbidden } from "@/server/ingestion";

// GET /admin/ingestion/manual-gate — 수동 수집을 다시 받을 수 있는 시각·최근 공유 실행·오늘 사용량·정기 일정 실제 등록(ADMIN).
// Redis 는 회사 redis-api 만 가진다. frontend(Vercel)는 권한을 먼저 보고 회사 API 로 중계한다(같은 403).
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx, signal) => {
    if (!canManageIngestion(ctx.role)) return serviceResponse(ingestionForbidden());
    if (deploymentRole() === "frontend") {
      return relayRedisApi(request, "/api/v1/admin/ingestion/manual-gate", { signal });
    }
    return serviceResponse(await getManualIngestGate(ctx, ingestionDeps(ctx.orgId)));
  });
}
