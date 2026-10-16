import type { NextRequest } from "next/server";
import { deleteMyAccount, getMyProfile, updateMyDisplayName } from "@/server/profile";
import {
  apiError,
  json,
  noContent,
  readJsonObject,
  requireUser,
  unauthenticated,
} from "@/app/api/_lib/http";

// 내 프로필. 누구의 것인지는 경로·본문이 아니라 토큰에서 읽는다(남의 id 를 보낼 자리가 없다).
async function readMe(userId: string): Promise<Response> {
  const me = await getMyProfile();
  if (me.status === "suspended") return apiError(403, "suspended", "정지된 계정입니다.");
  if (me.status !== "ready") return unauthenticated();
  return json({
    id: userId,
    email: me.profile.email,
    displayName: me.profile.displayName,
    avatarUrl: me.profile.avatarUrl,
    role: me.profile.isAdmin ? "admin" : "user",
    status: "active",
    joinedAt: me.profile.joinedAt,
  });
}

export async function GET() {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  return readMe(guarded.user.id);
}

// 고칠 수 있는 것은 표시 이름 하나다. 다른 필드(role·status·avatarUrl 등)를 보내도 읽지 않는다 — DB 권한도 열지 않았다.
export async function PATCH(request: NextRequest) {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  const body = await readJsonObject(request);
  if (!body)
    return apiError(400, "invalid", '본문은 { "displayName": string } 모양의 JSON 입니다.');
  const result = await updateMyDisplayName(body.displayName);
  if (result.status === "invalid") return apiError(400, "invalid", result.message);
  if (result.status === "signed-out") return unauthenticated();
  return readMe(guarded.user.id);
}

// 탈퇴. 즉시 지워지고 되돌릴 수 없다. 모든 세션도 함께 지워진다.
export async function DELETE() {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded.response;
  const result = await deleteMyAccount();
  switch (result.status) {
    case "deleted":
      return noContent();
    case "signed-out":
      return unauthenticated();
    case "suspended":
      return apiError(403, "suspended", "정지된 계정입니다.");
    case "sole-owner":
      return apiError(
        409,
        "sole_owner",
        "다른 멤버가 있는 팀의 유일한 owner 입니다. owner 를 넘기거나 팀을 나간 뒤 탈퇴하세요.",
      );
  }
}
