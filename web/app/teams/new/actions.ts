"use server";

import { type CreateTeamResult, createTeam } from "@/server/organization";

// 얇게 둔다 — 검증·로그인 확인·저장은 도메인(@/server/organization)이,
// 만든 사람을 owner 로 넣는 일은 DB 트리거가 한다. 화면 밖에서 직접 POST 로도 불리므로 인자를 믿지 않는다.
// 성공하면 화면이 새 팀의 주소로 옮겨 가므로 이 화면을 다시 그리지 않는다.
export async function create(input: unknown): Promise<CreateTeamResult> {
  return createTeam(input);
}
