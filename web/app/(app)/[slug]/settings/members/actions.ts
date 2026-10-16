"use server";

import { requireCurrentOrganization } from "@/app/(app)/employment-guard";

import { notFound } from "next/navigation";
import { refresh } from "next/cache";
import {
  cancelInvitation,
  getMembersPage,
  changeMemberRole,
  type InvitationChangeResult,
  inviteMember,
  type InviteResult,
  leaveOrg,
  type MembershipChangeResult,
  removeMember,
} from "@/server/organization";

// 얇게 둔다 — 검증·로그인 확인·저장은 도메인(@/server/organization)이, 권한은 DB 정책과 트리거가 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다(조직 id 도 마찬가지다).

export async function invite(orgId: unknown, input: unknown): Promise<InviteResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  const result = await inviteMember(orgId, input);
  if (result.status === "invited" || result.status === "renewed") refresh();
  return result;
}

export async function cancel(invitationId: unknown): Promise<InvitationChangeResult> {
  const current = await requireCurrentOrganization("/settings");
  if (!current) return { status: "signed-out" };
  const members = await getMembersPage({ org: current.current, userId: current.userId });
  if (
    members.status !== "team" ||
    !members.invitations.some((invitation) => invitation.id === invitationId)
  )
    notFound();
  const result = await cancelInvitation(invitationId);
  if (result.status === "done") refresh();
  return result;
}

export async function changeRole(
  orgId: unknown,
  userId: unknown,
  role: unknown,
): Promise<MembershipChangeResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  const result = await changeMemberRole(orgId, userId, role);
  // 권한이 바뀐 경우(forbidden)도 다시 그린다 — 그새 member 로 바뀌었으면 화면이 member 모양이 된다.
  if (result.status !== "signed-out") refresh();
  return result;
}

export async function remove(orgId: unknown, userId: unknown): Promise<MembershipChangeResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  const result = await removeMember(orgId, userId);
  if (result.status !== "signed-out") refresh();
  return result;
}

// 나간 뒤에는 이 조직의 화면을 볼 수 없다. 다시 그리지 않고 화면이 개인 조직으로 옮겨 간다.
export async function leave(orgId: unknown): Promise<MembershipChangeResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  return leaveOrg(orgId);
}
