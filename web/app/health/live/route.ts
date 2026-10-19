// 프로세스가 떠 있는지만 본다. 의존성은 보지 않는다(/health/ready 가 본다). 인증 없음.
// 요청 때마다 평가하고 캐시하지 않는다(Next 문서: Route Handler 의 GET 은 force-static 일 때만 캐시된다).
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
