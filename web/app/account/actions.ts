"use server";

import { refresh } from "next/cache";
import { type UnlinkResult, unlinkMyLoginMethod } from "@/server/auth";
import {
  type DeleteAccountResult,
  deleteMyAccount,
  type DisplayNameResult,
  updateMyDisplayName,
} from "@/server/profile";

// 얇게 둔다 — 검증·로그인 확인·저장은 도메인(@/server/profile·@/server/auth)이, 누가 고칠 수 있는지는 RLS·Supabase Auth 가 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다.
export async function saveDisplayName(input: unknown): Promise<DisplayNameResult> {
  const result = await updateMyDisplayName(input);
  if (result.status === "saved") refresh();
  return result;
}

// 해제는 바뀐 목록을 다시 그려야 한다. 거절(마지막 하나·이미 해제됨)도 화면이 낡은 것이라 다시 그린다.
export async function unlinkLoginMethod(identityId: unknown): Promise<UnlinkResult> {
  const result = await unlinkMyLoginMethod(identityId);
  if (result.status !== "signed-out" && result.status !== "invalid") refresh();
  return result;
}

// 즉시 삭제다. 이 브라우저의 로그인 쿠키는 화면이 지운다(getSupabaseBrowser().auth.signOut({ scope: "local" })).
export async function deleteAccount(): Promise<DeleteAccountResult> {
  return deleteMyAccount();
}
