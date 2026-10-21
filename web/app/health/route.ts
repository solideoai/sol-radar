import { deploymentRole } from "@/app/_lib/deployment-role";
import { guardRedisApiRequest } from "@/app/_lib/redis-api-auth";
import { redisApiError } from "@/app/_lib/redis-api-response";
import { getReadiness } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rejected = guardRedisApiRequest(request);
  if (rejected) return rejected;
  if (deploymentRole() !== "redis-api")
    return redisApiError(404, "NOT_FOUND", "요청 경로를 찾을 수 없습니다.");
  const { body, httpStatus } = await getReadiness();
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
