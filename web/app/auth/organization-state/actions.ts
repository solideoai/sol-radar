"use server";

import { refresh } from "next/cache";
import {
  findUnlinkedMember,
  type FindMemberResult,
  submitMyJoinRequest,
  type SubmitJoinResult,
} from "@/server/join-request";

// 얇게 둔다 — 입력 검사·로그인 확인은 도메인(@/server/join-request)이, 대상 직원·중복 연결은 DB 함수가 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다.

export async function submitJoin(input: unknown): Promise<SubmitJoinResult> {
  const result = await submitMyJoinRequest(input);
  // 이미 연결된 계정이면 화면이 낡은 것이라 다시 그린다(업무 화면으로 옮겨 간다).
  if (result.status === "submitted" || result.status === "already-linked") refresh();
  return result;
}

export async function findMember(input: unknown): Promise<FindMemberResult> {
  return findUnlinkedMember(input);
}
