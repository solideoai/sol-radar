import "server-only";
import { z } from "zod";
import type { SolRole } from "@/server/organization";

// ── 모델: 가입 신청(신규 입사자·기존 직원 연결)의 입력·결과·화면 모양. 저장·화면을 모른다 ──
// 신청·결정은 DB 함수(submit_join_request·decide_join_request, 20261024000300)가 한다. 여기서는 입력 모양만 거르고,
// DB 가 올린 오류(hint)를 화면이 알릴 수 있는 결과로 바꾼다.

export type JoinKind = "NEW_HIRE" | "EXISTING";

export type MyJoinRequest =
  | { status: "signed-out" }
  | { status: "none" }
  | { status: "pending" | "rejected" | "approved"; kind: JoinKind; memberName: string | null };

export type SubmitJoinResult = {
  status:
    | "submitted"
    | "already-linked"
    | "invalid-member"
    | "profile-incomplete"
    | "invalid"
    | "signed-out";
};

export type FoundMember = { id: string; personCode: string; name: string; jobTitleLabel: string };
export type FindMemberResult =
  { status: "found"; member: FoundMember } | { status: "not-found" | "invalid" | "signed-out" };

export type DecideJoinResult = {
  status:
    | "approved"
    | "rejected"
    | "member-taken"
    | "member-left"
    | "already-linked"
    | "already-decided"
    | "forbidden"
    | "invalid"
    | "signed-out";
};

export type JoinRequestView = {
  id: string;
  kind: JoinKind;
  applicantName: string;
  applicantEmail: string;
  departmentName: string;
  jobTitleLabel: string;
  memberName: string | null;
  memberPersonCode: string | null;
  /** 기존 직원 신청인데 연결 직원이 보이지 않는다. 신청 뒤 퇴사 처리되면 RLS 가 그 직원을 숨긴다(N4b). */
  memberUnavailable: boolean;
  photoUrl: string | null;
  createdAt: string;
};

/** DB 함수가 올린 오류. 무엇인지는 hint 로 가른다. */
export type JoinDbError = { code: string; hint: string };

/** 대기 신청 목록의 한 행. 신청자 이름·이메일·사진은 신청 행 사본이다(대기 신청자의 profiles 는 관리자가 못 읽는다). */
export type JoinRequestRow = {
  id: string;
  kind: string;
  applicant_name: string;
  applicant_email: string;
  applicant_photo_path: string | null;
  created_at: string;
  department: { name: string } | null;
  job_title: { label: string } | null;
  member: { name: string; person_code: string } | null;
};

/** 내 최근 신청. 대기 신청자는 아직 명부를 못 읽어 연결 대상 이름이 비어 올 수 있다. */
export type MyJoinRequestRow = {
  kind: string;
  status: string;
  member: { name: string } | null;
};

// ── 입력 ──

const nameInput = z.string().trim().min(1).max(40);

export const submitJoinInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NEW_HIRE") }),
  z.object({ kind: z.literal("EXISTING"), teamMemberId: z.uuid(), name: nameInput }),
]);
export type SubmitJoinInput = z.infer<typeof submitJoinInput>;

export const findMemberInput = z.object({
  departmentId: z.string().regex(/^SOL-D\d{3}$/),
  name: nameInput,
});

export const decideJoinInput = z.object({
  requestId: z.uuid(),
  approve: z.boolean(),
  solRole: z.enum(["VIEWER", "ANALYST", "SALES", "ADMIN"] satisfies SolRole[]).default("VIEWER"),
});
export type DecideJoinInput = { requestId: string; approve: boolean; solRole: SolRole };

// ── DB 오류 → 결과 ──

const RAISED = "P0001";

const unexpected = (what: string, error: JoinDbError) =>
  Object.assign(new Error(`${what} DB 함수가 예상하지 못한 오류를 냈습니다`), { cause: error });

const SUBMIT_BY_HINT: Record<string, SubmitJoinResult["status"]> = {
  not_active: "signed-out",
  profile_incomplete: "profile-incomplete",
  already_linked: "already-linked",
  invalid_member: "invalid-member",
  // N4b(a2) 의 퇴사 직원 연결 거절. 화면에는 "찾을 수 없는 직원"과 같은 안내를 쓴다.
  member_left: "invalid-member",
  invalid_kind: "invalid",
};

/** 오류가 없으면 submitted. 아는 hint 는 결과로, 모르는 오류는 그대로 던진다. */
export function toSubmitJoinResult(error: JoinDbError | null): SubmitJoinResult {
  if (!error) return { status: "submitted" };
  const known = error.code === RAISED ? SUBMIT_BY_HINT[error.hint] : undefined;
  if (known) return { status: known };
  throw unexpected("가입 신청", error);
}

const DECIDE_BY_HINT: Record<string, DecideJoinResult["status"]> = {
  not_active: "signed-out",
  forbidden: "forbidden",
  request_not_pending: "already-decided",
  member_taken: "member-taken",
  member_left: "member-left",
  already_linked: "already-linked",
  invalid_sol_role: "invalid",
};

/** DB 함수의 반환값('APPROVED'|'REJECTED') 또는 오류를 결과로 바꾼다. */
export function toDecideJoinResult(
  result: string | null,
  error: JoinDbError | null,
): DecideJoinResult {
  if (!error && result === "APPROVED") return { status: "approved" };
  if (!error && result === "REJECTED") return { status: "rejected" };
  const known = error?.code === RAISED ? DECIDE_BY_HINT[error.hint] : undefined;
  if (known) return { status: known };
  throw unexpected("가입 신청 결정", error ?? { code: "", hint: String(result) });
}

const asKind = (kind: string): JoinKind => (kind === "EXISTING" ? "EXISTING" : "NEW_HIRE");

const STATUS: Record<string, "pending" | "rejected" | "approved"> = {
  PENDING: "pending",
  REJECTED: "rejected",
  APPROVED: "approved",
};

export function toMyJoinRequest(row: MyJoinRequestRow | null): MyJoinRequest {
  const status = row ? STATUS[row.status] : undefined;
  if (!row || !status) return { status: "none" };
  return { status, kind: asKind(row.kind), memberName: row.member?.name ?? null };
}

export function toJoinRequestView(
  row: JoinRequestRow,
  photoUrls: ReadonlyMap<string, string>,
): JoinRequestView {
  const kind = asKind(row.kind);
  return {
    id: row.id,
    kind,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    departmentName: row.department?.name ?? "",
    jobTitleLabel: row.job_title?.label ?? "",
    memberName: row.member?.name ?? null,
    memberPersonCode: row.member?.person_code ?? null,
    memberUnavailable: kind === "EXISTING" && row.member === null,
    photoUrl: row.applicant_photo_path ? (photoUrls.get(row.applicant_photo_path) ?? null) : null,
    createdAt: row.created_at,
  };
}
