import "server-only";
import { teamMemberEditRepo, type TeamMemberEditRepo } from "./people-edit.repo";
import {
  createTeamMemberSchema,
  editedTeamMemberSchema,
  editForbidden,
  fromDbCode,
  invalidBody,
  invalidMemberId,
  updateTeamMemberSchema,
  type TeamMemberEditOutcome,
  type TeamMemberEditor,
  type TeamMemberRpcResult,
} from "./people-edit.model";
import { isPeopleId } from "./people.model";
export type { EditedTeamMember } from "./people-edit.model";

// 검사 순서: 업무 역할(ADMIN) → 경로 ID·본문 → DB 함수(조직·역할·부서·직급을 다시 확인하고 감사를 남긴다).
const toOutcome = (result: TeamMemberRpcResult, status: 200 | 201): TeamMemberEditOutcome =>
  result.ok
    ? { ok: true, status, data: editedTeamMemberSchema.parse(result.value) }
    : fromDbCode(result.code);

export async function createTeamMember(
  editor: TeamMemberEditor,
  body: unknown,
  repo: TeamMemberEditRepo = teamMemberEditRepo,
): Promise<TeamMemberEditOutcome> {
  if (editor.role !== "ADMIN") return editForbidden();
  const parsed = createTeamMemberSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return toOutcome(await repo.create(editor.orgId, parsed.data), 201);
}

export async function updateTeamMember(
  editor: TeamMemberEditor,
  id: string,
  body: unknown,
  repo: TeamMemberEditRepo = teamMemberEditRepo,
): Promise<TeamMemberEditOutcome> {
  if (editor.role !== "ADMIN") return editForbidden();
  if (!isPeopleId(id)) return invalidMemberId();
  const parsed = updateTeamMemberSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return toOutcome(await repo.update(id, parsed.data), 200);
}
