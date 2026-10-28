import "server-only";
import { z } from "zod";

// N4b 조직·인력 ADMIN 편집(추가·부서/직급 이동·퇴사). 점수 계산 속성(team_member_scoring)은 받지 않는다.
// DB 함수 create_team_member·update_team_member(20261024000400)가 권한·조직·감사를 다시 확인한다.

/** 업무 경로 입구(businessRoute)가 넘기는 세션 조직·사용자·업무 역할. */
export type TeamMemberEditor = { orgId: string; userId: string; role: string };

// DB 의 team_members_email_format 과 같은 규칙이다(20261024000100).
const EMAIL_PATTERN = /^[a-z0-9]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export const createTeamMemberSchema = z.strictObject({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(40, "이름은 40자 이하입니다."),
  departmentId: z.uuid("부서를 고르세요."),
  jobTitleId: z.uuid("직급을 고르세요."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(EMAIL_PATTERN, "영문 소문자·숫자 메일 주소를 입력하세요.")
    .nullable()
    .optional(),
});
export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = z
  .strictObject({
    departmentId: z.uuid("부서를 고르세요.").optional(),
    jobTitleId: z.uuid("직급을 고르세요.").optional(),
    employmentStatus: z.enum(["ACTIVE", "LEFT"]).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "바꿀 항목을 하나 이상 보내세요.",
  });
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

// DB 함수가 돌려주는 직원(team_member_edit_json).
export const editedTeamMemberSchema = z.object({
  id: z.uuid(),
  personCode: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  departmentId: z.uuid(),
  jobTitleId: z.uuid(),
  employmentStatus: z.enum(["ACTIVE", "LEFT"]),
  isDemo: z.boolean(),
});
export type EditedTeamMember = z.infer<typeof editedTeamMemberSchema>;

// DB 함수 거절 코드(raise exception '<코드>' using errcode = 'P0001').
export const TEAM_MEMBER_DB_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "DEPARTMENT_NOT_FOUND",
  "JOB_TITLE_NOT_FOUND",
  "EMAIL_TAKEN",
  "INVALID_INPUT",
] as const;
export type TeamMemberDbCode = (typeof TEAM_MEMBER_DB_CODES)[number];
export const isTeamMemberDbCode = (value: string): value is TeamMemberDbCode =>
  (TEAM_MEMBER_DB_CODES as readonly string[]).includes(value);

export type TeamMemberRpcResult =
  { ok: true; value: unknown } | { ok: false; code: TeamMemberDbCode };

type Issue = { path: string; message: string };
export type TeamMemberEditOutcome =
  | { ok: true; status: 200 | 201; data: EditedTeamMember }
  | {
      ok: false;
      status: 400 | 403 | 404;
      code: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND";
      message: string;
      details?: Record<string, unknown>;
    };

export const editForbidden = (): TeamMemberEditOutcome => ({
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  message: "조직·인력 편집은 ADMIN 만 할 수 있습니다.",
});
export const memberNotFound = (): TeamMemberEditOutcome => ({
  ok: false,
  status: 404,
  code: "NOT_FOUND",
  message: "직원을 찾을 수 없습니다.",
  details: { resource: "teamMember" },
});
const invalid = (issues: Issue[]): TeamMemberEditOutcome => ({
  ok: false,
  status: 400,
  code: "VALIDATION_ERROR",
  message: "입력값을 확인하세요.",
  details: { issues },
});
// 상세 GET 과 같다: 경로 ID 형식이 틀리면 400, 형식은 맞는데 이 조직에 없으면 404(05 §4.7.1).
export const invalidMemberId = (): TeamMemberEditOutcome =>
  invalid([{ path: "id", message: "UUID가 필요합니다." }]);
export const invalidBody = (error: z.ZodError): TeamMemberEditOutcome =>
  invalid(
    error.issues.map((issue) => ({
      path: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );

/** DB 거절 코드 → v1 응답. 다른 조직의 직원·없는 직원은 같은 404 다. */
export function fromDbCode(code: TeamMemberDbCode): TeamMemberEditOutcome {
  switch (code) {
    case "NOT_FOUND":
      return memberNotFound();
    case "FORBIDDEN":
      return editForbidden();
    case "DEPARTMENT_NOT_FOUND":
      return invalid([{ path: "departmentId", message: "이 조직의 부서를 고르세요." }]);
    case "JOB_TITLE_NOT_FOUND":
      return invalid([{ path: "jobTitleId", message: "이 조직의 직급을 고르세요." }]);
    case "EMAIL_TAKEN":
      return invalid([{ path: "email", message: "이미 등록된 메일입니다." }]);
    case "INVALID_INPUT":
      return invalid([{ path: "body", message: "입력값이 명부 규칙에 맞지 않습니다." }]);
  }
}
