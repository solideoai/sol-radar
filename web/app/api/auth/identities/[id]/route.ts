import type { NextRequest } from "next/server";
import { unlinkMyLoginMethod } from "@/server/auth";
import { apiError, noContent, requireUser, unauthenticated } from "@/app/api/_lib/http";

// 로그인 수단 하나를 해제한다. id 는 GET /api/auth/me 의 identities[].id 다.
// 마지막 하나는 해제하지 못하고(다시 로그인할 길이 없어진다), 남의 것은 없는 것과 같다.
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/auth/identities/[id]">,
) {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  const result = await unlinkMyLoginMethod((await ctx.params).id);
  switch (result.status) {
    case "unlinked":
      return noContent();
    case "signed-out":
      return unauthenticated();
    case "invalid":
    case "not-found":
      return apiError(404, "not_found", "연결된 로그인 수단을 찾지 못했습니다.");
    case "last-method":
      return apiError(409, "last_identity", "마지막 로그인 수단은 해제할 수 없습니다.");
  }
}
