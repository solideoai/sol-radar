import "server-only";

export function redisApiError(
  status: number,
  code: string,
  message: string,
  details: object = {},
): Response {
  const requestId = crypto.randomUUID();
  return Response.json(
    { error: { code, message, details, requestId } },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}

export const redisApiUnavailable = () =>
  redisApiError(503, "SERVICE_UNAVAILABLE", "작업 접수 서버를 사용할 수 없습니다.", {
    component: "redis-api",
  });
