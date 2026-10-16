import type { Instrumentation } from "next";
import { reportServerError } from "@/server/shared";

// Next 가 잡은 서버 오류(서버 렌더·라우트 핸들러·서버 함수·proxy)마다 불린다. 기록하는 일은 reportServerError 한 곳이 한다.
// 근거: web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
// request.headers 에는 쿠키·인증 헤더가 들어 있어 넘기지 않는다.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportServerError(
    error,
    { path: request.path, method: request.method },
    { routePath: context.routePath, routeType: context.routeType },
  );
};
