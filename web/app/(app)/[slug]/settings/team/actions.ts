"use server";

import { requireCurrentOrganization } from "@/app/(app)/employment-guard";

import { refresh } from "next/cache";
import {
  deleteTeam,
  type DeleteTeamResult,
  renameTeam,
  type RenameTeamResult,
} from "@/server/organization";

// 얇게 둔다 — 검증·로그인 확인·저장은 도메인(@/server/organization)이, 누가 바꾸고 지우는지는 DB 정책이 정한다.
// 서버 함수는 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않고 unknown 으로 받는다(조직 id 도 마찬가지다).

// 저장했거나 화면이 낡았으면(그새 member 가 됨·정지) 다시 그린다 — 새 이름이 앱 틀과 설명 줄에, 권한이 바뀌었으면 member 모양이 된다.
// 입력 오류·로그인 풀림은 다시 그려도 달라지는 것이 없어 그리지 않는다.
export async function rename(orgId: unknown, input: unknown): Promise<RenameTeamResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  const result = await renameTeam(orgId, input);
  if (result.status !== "invalid" && result.status !== "signed-out") refresh();
  return result;
}

// 지운 뒤에는 이 팀의 화면을 볼 수 없다. 여기서 다시 그리면 404 가 먼저 보이므로, 화면이 개인 조직으로 옮겨 간 뒤 다시 그린다.
export async function remove(orgId: unknown, input: unknown): Promise<DeleteTeamResult> {
  if (!(await requireCurrentOrganization("/settings", orgId))) return { status: "signed-out" };
  return deleteTeam(orgId, input);
}
