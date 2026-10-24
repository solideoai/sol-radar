"use server";

import { refresh } from "next/cache";
import { requireCompleteEmployment } from "@/app/(app)/employment-guard";
import {
  cancelOrgInvitation,
  changeMySolRole,
  changeOrgMemberSolRole,
  inviteOrgMember,
  type OrgInvitationCancelResult,
  type OrgInviteResult,
  type OrgRoleChangeResult,
} from "@/server/organization";
import { type DecideJoinResult, decideOrgJoinRequest } from "@/server/join-request";
import { ORG_SETTINGS_PATH } from "./org-settings-copy";

// 얇게 둔다 — 검증·로그인·ADMIN 확인·저장은 도메인(@/server/organization)이, 최종 권한은 DB 정책과 트리거가 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다. 조직 id 는 받지 않는다
// (지금 업무 조직을 로그인에서 읽는다).

export async function changeSolRole(userId: unknown, role: unknown): Promise<OrgRoleChangeResult> {
  await requireCompleteEmployment(ORG_SETTINGS_PATH);
  const result = await changeOrgMemberSolRole(userId, role);
  // 권한을 잃은 경우(forbidden)·대상이 나간 경우(not-member)도 다시 그린다 — 화면이 403·새 목록이 된다.
  if (result.status !== "signed-out" && result.status !== "invalid") refresh();
  return result;
}

// 내 업무 역할을 낮춘다. 성공하면 화면이 대시보드로 옮겨 가므로 이 화면을 다시 그리지 않는다
// (다시 그리면 옮기기 전에 403 안내가 잠깐 보인다, 디자인 스펙 D5).
export async function demoteMySolRole(role: unknown): Promise<OrgRoleChangeResult> {
  await requireCompleteEmployment(ORG_SETTINGS_PATH);
  const result = await changeMySolRole(role);
  if (result.status !== "saved" && result.status !== "signed-out" && result.status !== "invalid")
    refresh();
  return result;
}

export async function inviteToOrg(input: unknown): Promise<OrgInviteResult> {
  await requireCompleteEmployment(ORG_SETTINGS_PATH);
  const result = await inviteOrgMember(input);
  if (result.status === "invited" || result.status === "renewed" || result.status === "forbidden")
    refresh();
  return result;
}

export async function cancelOrgInvite(invitationId: unknown): Promise<OrgInvitationCancelResult> {
  await requireCompleteEmployment(ORG_SETTINGS_PATH);
  const result = await cancelOrgInvitation(invitationId);
  if (result.status === "done" || result.status === "forbidden") refresh();
  return result;
}

// 가입 신청 승인·거절. ADMIN 확인은 도메인이, 최종 판정(대상 직원·경쟁)은 DB 함수가 한다.
// 이미 처리된 신청·권한 잃음도 화면이 낡은 것이라 다시 그린다.
export async function decideJoin(input: unknown): Promise<DecideJoinResult> {
  await requireCompleteEmployment(ORG_SETTINGS_PATH);
  const result = await decideOrgJoinRequest(input);
  if (result.status !== "signed-out" && result.status !== "invalid") refresh();
  return result;
}
