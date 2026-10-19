import { getReadiness } from "@/server/health";

// 의존성(db·redis·storage·ai)이 쓸 수 있는지 본다. 인증 없음. 요청 때마다 평가하고 캐시하지 않는다.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { httpStatus, body } = await getReadiness();
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
