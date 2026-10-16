import type { NextRequest } from "next/server";
import { setUserStatus } from "@/server/admin";
import { apiError, json, readJsonObject, requireAdmin } from "@/app/api/_lib/http";

// 운영자: 회원을 정지(suspended)하거나 되돌린다(active). 정지하면 그 회원의 로그인이 막히고 모든 세션이 끊긴다.
// 문지기(requireAdmin)·도메인·DB 함수가 각각 운영자인지 다시 본다.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/users/[id]/status">,
) {
  const guarded = await requireAdmin();
  if (!guarded.ok) return guarded.response;
  const body = await readJsonObject(request);
  const { id } = await ctx.params;
  const result = await setUserStatus(id, body?.status);
  switch (result.status) {
    case "saved":
      return json({ id: id.toLowerCase(), status: body?.status });
    case "invalid":
      return apiError(
        400,
        "invalid",
        '본문은 { "status": "active" | "suspended" } 이고 id 는 회원 id 입니다.',
      );
    case "self":
      return apiError(409, "self", "자기 자신의 상태는 바꾸지 못합니다.");
    case "admin-target":
      return apiError(409, "admin_target", "다른 운영자의 상태는 바꾸지 못합니다.");
    case "not-found":
      return apiError(404, "not_found", "회원을 찾지 못했습니다.");
    case "no-database":
      return apiError(503, "not_configured", "DB 가 연결되지 않았습니다.");
    case "signed-out":
    case "forbidden":
      return apiError(403, "forbidden", "운영자만 할 수 있습니다.");
  }
}
