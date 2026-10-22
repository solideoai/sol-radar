import "server-only";
import { z } from "zod";
import { nameOf } from "@/server/shared";

// ── 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 현재 업무 조직은 실제 업무 멤버십으로만 정한다. 과거 개인 조직은 보존하되 선택하지 않는다.
// 역할 owner·member 는 서비스 전체 운영자(profiles.is_admin)와 다르다. 누가 무엇을 읽고 쓰는지는 DB 정책이 정한다.

export type OrgRole = "owner" | "member";

export const ORG_ROLE_LABELS: Record<OrgRole, string> = { owner: "소유자", member: "멤버" };

export type MyOrgRow = {
  orgId: string;
  slug: string;
  name: string;
  isPersonal: boolean;
  role: OrgRole;
};

export type OrgSummary = { slug: string; name: string; isPersonal: boolean };

export type CurrentOrg = OrgSummary & { id: string; myRole: OrgRole };

export type MyWorkspace =
  | { status: "no-org"; userId: string }
  | { status: "multiple-orgs"; userId: string }
  | { status: "no-database" }
  | { status: "signed-out" }
  // 그 주소의 조직이 없거나 내가 멤버가 아니다. 둘을 구분하지 않는다(남의 조직이 있는지 알려 주지 않는다).
  | { status: "not-found" }
  | {
      status: "ready";
      userId: string;
      current: CurrentOrg;
      orgs: OrgSummary[];
      pendingInvitationCount: number;
    };

export type CurrentOrganizationResult =
  | { status: "no-database" | "signed-out" }
  | { status: "no-org"; userId: string }
  | { status: "multiple-orgs"; userId: string }
  | { status: "ready"; userId: string; current: CurrentOrg };
export type MyHome = CurrentOrganizationResult;

export function resolveCurrentOrganization(
  rows: readonly MyOrgRow[],
): { status: "no-org" } | { status: "multiple-orgs" } | { status: "ready"; current: CurrentOrg } {
  const business = [
    ...new Map(rows.filter((row) => !row.isPersonal).map((row) => [row.orgId, row])).values(),
  ];
  if (business.length === 0) return { status: "no-org" };
  if (business.length !== 1) return { status: "multiple-orgs" };
  return { status: "ready", current: toCurrentOrg(business[0]) };
}

export function sortOrgs(rows: MyOrgRow[]): MyOrgRow[] {
  return rows.toSorted((a, b) =>
    a.isPersonal === b.isPersonal ? a.name.localeCompare(b.name, "ko") : a.isPersonal ? -1 : 1,
  );
}

export const toOrgSummary = (row: MyOrgRow): OrgSummary => ({
  slug: row.slug,
  name: row.name,
  isPersonal: row.isPersonal,
});

export const toCurrentOrg = (row: MyOrgRow): CurrentOrg => ({
  ...toOrgSummary(row),
  id: row.orgId,
  myRole: row.role,
});

// ── 입력 규칙 ──
// 같은 규칙을 DB 제약(organizations_slug_check·organizations_name_check·invitations_email_check)이 한 번 더 지킨다.

// 최상위 경로 이름. 주소의 첫 마디가 조직 주소라서 겹치면 그 화면을 못 연다. 마이그레이션의 목록과 같다.
export const RESERVED_SLUGS = [
  "account",
  "admin",
  "api",
  "auth",
  "dashboard",
  "invitations",
  "memos",
  "settings",
  "teams",
] as const;

const slugSchema = z
  .string("주소는 글자여야 합니다")
  .trim()
  .min(3, "주소는 3자 이상입니다")
  .max(32, "주소는 32자 이하입니다")
  .regex(/^[a-z0-9-]+$/, "주소에는 영문 소문자·숫자·하이픈(-)만 씁니다")
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), "쓸 수 없는 주소입니다");

const teamNameSchema = z
  .string("팀 이름은 글자여야 합니다")
  .trim()
  .min(1, "팀 이름을 입력하세요")
  .max(40, "팀 이름은 40자 이하입니다");

export type TeamField = "name" | "slug";

// 팀을 만들 때와 이름을 바꿀 때 같은 규칙이다(앞뒤 공백을 떼고 1~40자).
export function parseTeamName(
  input: unknown,
): { ok: true; name: string } | { ok: false; message: string } {
  const fields = z.object({ name: z.unknown() }).safeParse(input);
  const name = teamNameSchema.safeParse(fields.success ? fields.data.name : undefined);
  return name.success
    ? { ok: true, name: name.data }
    : { ok: false, message: name.error.issues[0].message };
}

// 팀을 지우기 전에 사용자가 적은 확인용 이름. 지금 팀 이름과 같은지는 서비스가 DB 에서 읽은 이름과 견준다.
// 앞뒤 공백만 뗀다(휴대폰 자동 입력이 끝에 붙이는 공백). 팀 이름은 앞뒤 공백이 없으므로 가운데 글자는 정확히 같아야 한다.
export function parseDeleteConfirmation(
  input: unknown,
): { ok: true; confirmName: string } | { ok: false; message: string } {
  const parsed = z
    .object(
      { confirmName: z.string("팀 이름을 입력하세요").trim().min(1, "팀 이름을 입력하세요") },
      "팀 이름을 입력하세요",
    )
    .safeParse(input);
  return parsed.success
    ? { ok: true, confirmName: parsed.data.confirmName }
    : { ok: false, message: parsed.error.issues[0].message };
}

export const DELETE_CONFIRM_MISMATCH = "팀 이름이 맞지 않습니다. 위 이름을 그대로 입력해 주세요";

export function parseNewTeam(
  input: unknown,
): { ok: true; name: string; slug: string } | { ok: false; field: TeamField; message: string } {
  const fields = z.object({ name: z.unknown(), slug: z.unknown() }).safeParse(input);
  const name = teamNameSchema.safeParse(fields.success ? fields.data.name : undefined);
  if (!name.success) return { ok: false, field: "name", message: name.error.issues[0].message };
  const slug = slugSchema.safeParse(fields.success ? fields.data.slug : undefined);
  if (!slug.success) return { ok: false, field: "slug", message: slug.error.issues[0].message };
  return { ok: true, name: name.data, slug: slug.data };
}

const roleSchema = z.enum(["owner", "member"], "역할을 고르세요");

// 초대 비교가 대소문자를 가리지 않도록 소문자로 맞춘다.
export const emailSchema = z
  .string("이메일은 글자여야 합니다")
  .trim()
  .toLowerCase()
  .pipe(z.email("이메일 형식이 아닙니다").max(254, "이메일이 너무 깁니다"));

export function parseInvite(
  input: unknown,
): { ok: true; email: string; role: OrgRole } | { ok: false; message: string } {
  const parsed = z.object({ email: emailSchema, role: roleSchema }).safeParse(input);
  return parsed.success
    ? { ok: true, email: parsed.data.email, role: parsed.data.role }
    : { ok: false, message: parsed.error.issues[0].message };
}

export function parseRole(input: unknown): { ok: true; role: OrgRole } | { ok: false } {
  const parsed = roleSchema.safeParse(input);
  return parsed.success ? { ok: true, role: parsed.data } : { ok: false };
}

export function parseId(input: unknown): { ok: true; id: string } | { ok: false } {
  const parsed = z.uuid().safeParse(input);
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false };
}

// ── 멤버·초대 화면 ──

export type MemberRow = {
  userId: string;
  role: OrgRole;
  email: string | null;
  displayName: string | null;
};

export type MemberView = {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  isMe: boolean;
};

export const toMemberView = (row: MemberRow, myUserId: string): MemberView => ({
  userId: row.userId,
  name: nameOf(row.displayName, row.email),
  email: row.email ?? "",
  role: row.role,
  roleLabel: ORG_ROLE_LABELS[row.role],
  isMe: row.userId === myUserId,
});

export const sortMembers = (members: MemberView[]): MemberView[] =>
  members.toSorted((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name, "ko") : a.role === "owner" ? -1 : 1,
  );

export type InvitationRow = { id: string; email: string; role: OrgRole; expiresAt: string };

export type InvitationView = {
  id: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  expiresAt: string;
  expiresAtText: string;
  isExpired: boolean;
};

// 서버의 시간대와 상관없이 같은 글자가 나오도록 시간대를 고정한다.
const expiresAtFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});

export const toInvitationView = (row: InvitationRow, now: Date): InvitationView => ({
  id: row.id,
  email: row.email,
  role: row.role,
  roleLabel: ORG_ROLE_LABELS[row.role],
  expiresAt: row.expiresAt,
  expiresAtText: expiresAtFormat.format(new Date(row.expiresAt)),
  isExpired: new Date(row.expiresAt).getTime() <= now.getTime(),
});

export type MembersPage =
  | { status: "personal" }
  | {
      status: "team";
      canManage: boolean;
      members: MemberView[];
      // owner 만 본다. member 에게는 빈 목록이다.
      invitations: InvitationView[];
      ownerCount: number;
    };

export type ReceivedInvitationRow = InvitationRow & { orgName: string; orgSlug: string };

export type ReceivedInvitationView = InvitationView & { orgName: string; orgSlug: string };

export type ReceivedInvitations =
  | { status: "no-database" }
  | { status: "signed-out" }
  | { status: "ready"; invitations: ReceivedInvitationView[] };

// ── 쓰기 결과 ──
// 예상한 실패(로그인 안 함·틀린 입력·권한 없음·마지막 소유자)는 던지지 않고 값으로 돌려준다.

export type CreateTeamResult =
  | { status: "created"; slug: string }
  | { status: "signed-out" }
  | { status: "invalid"; field: TeamField; message: string };

// 초대 메일의 결과. 메일이 어떻게 됐든 초대는 저장돼 있다(실패해도 되돌리지 않는다).
//   sent           SMTP 서버가 받았다.
//   not-configured 서버에 메일 설정(SMTP·보내는 주소·사이트 주소)이 없다. 초대한 사람이 직접 알린다.
//   failed         보내지 못했다(접속 실패·거절·시간 초과). 초대한 사람이 직접 알린다.
export type InvitationMailStatus = "sent" | "not-configured" | "failed";

export type InviteResult =
  | { status: "invited"; mail: InvitationMailStatus }
  // 같은 이메일의 초대가 이미 있었다. 만료를 7일로 새로 늘리고 메일을 다시 보냈다.
  | { status: "renewed"; mail: InvitationMailStatus }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string };

export type RenameTeamResult =
  | { status: "renamed"; name: string }
  | { status: "signed-out" }
  // 그 팀의 활동 회원 owner 가 아니다(member·조직 밖의 사람·운영자·정지된 사람). 정책이 걸러 바뀐 행이 없다.
  | { status: "forbidden" }
  // 개인 조직은 이름을 바꾸지 않는다(계정과 함께만 없어진다).
  | { status: "personal-org" }
  | { status: "invalid"; field: "name"; message: string };

export type DeleteTeamResult =
  | { status: "deleted" }
  | { status: "signed-out" }
  // forbidden 은 위와 같고, 이미 지워진 팀도 여기 든다.
  | { status: "forbidden" }
  | { status: "personal-org" }
  // 확인용 이름이 비었거나 지금 팀 이름과 다르다.
  | { status: "invalid"; field: "confirmName"; message: string };

export type MembershipChangeResult =
  | { status: "saved" }
  | { status: "signed-out" }
  // 소유자가 아니거나 이미 없는 멤버다(정책이 걸러 바뀐 행이 없다).
  | { status: "forbidden" }
  | { status: "last-owner" }
  | { status: "last-admin" };

export type InvitationChangeResult = { status: "done" } | { status: "signed-out" };

export type AcceptResult =
  | { status: "accepted"; slug: string }
  | { status: "signed-out" }
  // 초대가 없거나(취소됨·이미 수락함) 만료됐다.
  | { status: "unavailable" };

// ── 초대 메일 ──
// 메일을 보내는 일은 organization.mail.ts 가 하고, 여기는 내용만 만든다(순수 함수).

// 메일에 넣을 값을 DB 에서 읽은 그대로. 초대한 사람은 지금 초대(다시 초대)를 누른 사람이다.
export type InvitationMailRow = {
  orgName: string;
  role: OrgRole;
  expiresAt: string;
  inviterDisplayName: string | null;
  inviterEmail: string | null;
};

export type InvitationMail = {
  to: string;
  orgName: string;
  inviterName: string;
  role: OrgRole;
  expiresAt: string;
};

export type InvitationMailContent = { subject: string; text: string; html: string };

export const toInvitationMail = (
  row: InvitationMailRow,
  to: string,
  inviterLoginEmail: string,
): InvitationMail => ({
  to,
  orgName: row.orgName,
  inviterName: nameOf(row.inviterDisplayName, row.inviterEmail ?? inviterLoginEmail),
  role: row.role,
  expiresAt: row.expiresAt,
});

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// 조직 이름·표시 이름은 사용자가 정한 글자다. HTML 판에 그대로 넣으면 태그·링크가 끼어든다.
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// 메일 제목은 머리글(header) 한 줄이다. 이름에 든 줄바꿈·제어 문자를 공백으로 바꿔 머리글이 끼어들지 못하게 한다.
const singleLine = (value: string): string => value.replace(/\p{Cc}+/gu, " ");

// 링크는 받은 초대 화면 하나다. 받는 사람이 가입했든 안 했든 같은 링크로 로그인(없으면 가입)한 뒤 수락한다.
export function toInvitationMailContent(
  mail: InvitationMail,
  siteUrl: string,
): InvitationMailContent {
  const link = `${siteUrl.replace(/\/+$/, "")}/invitations`;
  const roleLabel = ORG_ROLE_LABELS[mail.role];
  const expiresText = expiresAtFormat.format(new Date(mail.expiresAt));
  const orgName = singleLine(mail.orgName);
  const inviterName = singleLine(mail.inviterName);
  const text = [
    `${inviterName} 님이 "${orgName}" 팀에 초대했습니다.`,
    "",
    `역할: ${roleLabel}`,
    `초대 기한: ${expiresText}까지`,
    "",
    "아래 주소를 열고 이 이메일로 로그인(계정이 없으면 가입)한 뒤 ‘받은 초대’에서 수락하세요.",
    link,
    "",
    "초대를 예상하지 못했다면 이 메일은 무시해도 됩니다.",
  ].join("\n");
  // 색·글꼴을 적지 않는다. 메일 앱이 제 기본 글꼴·색(어두운 모드 포함)으로 그린다. 바깥 자원(이미지·글꼴)도 싣지 않는다.
  const html = [
    "<!doctype html>",
    '<html lang="ko">',
    `<head><meta charset="utf-8"><title>${escapeHtml(`${orgName} 팀 초대`)}</title></head>`,
    "<body>",
    `<p><strong>${escapeHtml(inviterName)}</strong> 님이 <strong>${escapeHtml(orgName)}</strong> 팀에 초대했습니다.</p>`,
    `<p>역할: ${escapeHtml(roleLabel)}<br>초대 기한: ${escapeHtml(expiresText)}까지</p>`,
    "<p>아래 링크를 열고 이 이메일로 로그인(계정이 없으면 가입)한 뒤 ‘받은 초대’에서 수락하세요.</p>",
    `<p><a href="${escapeHtml(link)}">받은 초대 열기</a><br>${escapeHtml(link)}</p>`,
    "<p>초대를 예상하지 못했다면 이 메일은 무시해도 됩니다.</p>",
    "</body>",
    "</html>",
  ].join("\n");
  return { subject: `${orgName} 팀에 초대받았습니다`, text, html };
}
