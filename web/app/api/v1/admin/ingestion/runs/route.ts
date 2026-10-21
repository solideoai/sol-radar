import { serviceResponse } from "@/app/api/v1/_lib/http";
import {
  businessRoute,
  invalidQuery,
  lazyJsonBody,
  rawQueryOf,
} from "@/app/api/v1/_lib/work-route";
import { ingestionDeps } from "@/app/_lib/ingestion-deps";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { relayRedisApi } from "@/app/_lib/redis-api-client";
import { parsePageQuery } from "@/server/bids";
import {
  canManageIngestion,
  ingestionForbidden,
  listIngestionRuns,
  requestIngestionRun,
} from "@/server/ingestion";

// 05 §2 GET /admin/ingestion/runs — 수집 실행 이력(Page<IngestionRun>, HMAC 커서). ADMIN 만.
// 권한을 쿼리 검사보다 먼저 본다. 비ADMIN 은 쿼리가 틀려도 403 이다(POST·단건과 같은 순서).
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    if (!canManageIngestion(ctx.role)) return serviceResponse(ingestionForbidden());
    const query = parsePageQuery(rawQueryOf(request));
    if (!query.ok) return invalidQuery(query.issues);
    return serviceResponse(await listIngestionRuns(ctx, query.value, ingestionDeps(ctx.orgId)));
  });
}

// 05 §2·§5 POST /admin/ingestion/runs — 수동 수집 요청(202). job 만 넣고 ingest_runs 행은 worker 가 만든다.
// 권한·Idempotency-Key·본문 크기·속도 제한·실행 모드·멱등·진행 중 판정은 서비스가 정한 순서로 본다.
// 본문은 서비스가 권한·키·속도 제한을 본 뒤에 읽는다(16KB 상한, 보안 L5).
export async function POST(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx, signal) => {
    if (deploymentRole() === "frontend") {
      return relayRedisApi(request, "/api/v1/admin/ingestion/runs", { signal });
    }
    return serviceResponse(
      await requestIngestionRun(
        ctx,
        lazyJsonBody(request),
        request.headers.get("Idempotency-Key"),
        ingestionDeps(ctx.orgId),
      ),
    );
  });
}
