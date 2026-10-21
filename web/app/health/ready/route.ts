import { getApplicationReadiness } from "@/app/_lib/application-health";
import { guardRedisApiRequest } from "@/app/_lib/redis-api-auth";

// 의존성(db·redis·storage·ai)이 쓸 수 있는지 본다. 인증 없음. 요청 때마다 평가하고 캐시하지 않는다.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request = new Request("http://localhost/health/ready"),
): Promise<Response> {
  const rejected = guardRedisApiRequest(request);
  if (rejected) return rejected;
  const { httpStatus, body } = await getApplicationReadiness();
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
