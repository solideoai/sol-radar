"use server";

import { refresh } from "next/cache";
import { setUserStatus, type StatusChangeResult } from "@/server/admin";

// 얇게 둔다 — 입력 검증·운영자 확인은 도메인(@/server/admin)이, 마지막 판단은 DB 함수(admin_set_user_status)가 한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다.
export async function changeUserStatus(
  userId: unknown,
  status: unknown,
): Promise<StatusChangeResult> {
  const result = await setUserStatus(userId, status);
  // 거절도 화면이 낡았다는 뜻이라(이미 탈퇴·운영자가 됨) 다시 그린다.
  if (result.status !== "invalid" && result.status !== "signed-out") refresh();
  return result;
}
