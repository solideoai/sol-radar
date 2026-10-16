"use server";

import { refresh } from "next/cache";
import {
  type AcceptResult,
  acceptInvitation,
  declineInvitation,
  type InvitationChangeResult,
} from "@/server/organization";

// 얇게 둔다 — 로그인 확인은 도메인(@/server/organization)이, 수락할 수 있는지
// (내 이메일·만료 전·초대받은 역할)는 DB 정책이 정한다. 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않는다.

// 수락하면 화면이 그 조직으로 옮겨 가므로 이 화면을 다시 그리지 않는다.
export async function accept(invitationId: unknown): Promise<AcceptResult> {
  return acceptInvitation(invitationId);
}

export async function decline(invitationId: unknown): Promise<InvitationChangeResult> {
  const result = await declineInvitation(invitationId);
  if (result.status === "done") refresh();
  return result;
}
