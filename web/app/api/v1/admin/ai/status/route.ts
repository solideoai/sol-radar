import { apiError, json } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { currentRunMode } from "@/app/_lib/run-mode";
import { deploymentRole } from "@/app/_lib/deployment-role";
import { relayRedisApi } from "@/app/_lib/redis-api-client";
import { getAiStatus, type AiStatusResult } from "@/server/health";

// 05 §2 GET /admin/ai/status — 실행 모드·AI 공급자·Qwen·Kev 상태(ADMIN). 값은 gateway /health 에서만 읽는다(05 §7).
// gateway 가 불가여도 200 이고 gateway.healthy=false 다. 422 HOSTED_NOT_APPROVED 는 이 경로에서만 난다(05 §5).
function aiStatusResponse(result: AiStatusResult): Response {
  switch (result.status) {
    case "ready":
      return json(result.data);
    case "forbidden":
      return apiError(403, "FORBIDDEN", "AI 상태를 조회할 권한이 없습니다.", {
        required: result.required,
      });
    case "hosted-not-approved":
      return apiError(422, "HOSTED_NOT_APPROVED", "hosted AI 공급자 사용이 승인되지 않았습니다.");
  }
}

export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx, signal) => {
    if (deploymentRole() === "frontend") {
      if (ctx.role !== "ADMIN")
        return aiStatusResponse({ status: "forbidden", required: ["ADMIN"] });
      return relayRedisApi(request, "/api/v1/admin/ai/status", { signal });
    }
    return aiStatusResponse(await getAiStatus(ctx.role, currentRunMode));
  });
}
