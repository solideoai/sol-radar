import "server-only";
import { z } from "zod";
import { employmentNameSchema, type EmploymentInfo, type EmploymentState } from "@/server/shared";
// 타입만 가져온다. 생성물(pnpm db:types)은 lib 층에 있고, 층 규칙(lodestar)은 타입 import 만 넘게 해 준다.
import type { Database } from "@/lib/database.types";

// ── 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──

// 계정 화면이 읽는 열만. 표의 다른 열이 늘어도 이 도메인은 바뀌지 않는다.
export type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  | "id"
  | "email"
  | "is_admin"
  | "display_name"
  | "avatar_url"
  | "photo_path"
  | "status"
  | "created_at"
> & {
  employment: EmploymentInfo | null;
  // 가입 신청 승인으로 연결된 명부 행(team_members.user_id). 연결 전이면 null.
  linked_member: LinkedMember | null;
};
export type LinkedMember = Pick<
  Database["public"]["Tables"]["team_members"]["Row"],
  "photo_path" | "person_code" | "portrait_path" | "is_demo"
>;

// 화면이 그리는 모양. DB 행을 그대로 내보내지 않는다.
// isAdmin 은 관리자 화면 링크를 보일지만 정한다. 관리자 화면은 따로 다시 확인한다(@/server/admin).
export type ProfileView = {
  userId: string;
  // 이메일을 주지 않는 제공자(카카오 비즈 앱이 아님·네이버)로 가입하면 없다.
  email: string | null;
  displayName: string | null;
  // 화면에 그릴 사진 주소(설계 C10): 올린 사진의 signed URL → 연결된 데모 직원의 정장 사진 → 제공자 사진(https).
  // 없으면 화면이 이름 첫 글자를 그린다.
  avatarUrl: string | null;
  // 직접 올린 사진이 있는가(사진 지우기 버튼을 보일지).
  hasOwnPhoto: boolean;
  // 조직도 명부에 연결됐는가. 연결되면 내 사진이 조직도 사진이다(설계 C9).
  orgChartLinked: boolean;
  role: "운영자" | "회원";
  isAdmin: boolean;
  joinedAt: string;
  employment: EmploymentInfo | null;
  profileComplete: boolean;
};

// 무엇을 보여 줄지는 화면이 아니라 서비스가 정한다.
export type MyProfile =
  | { status: "no-database" }
  | { status: "signed-out" }
  // 로그인은 했는데 행이 없다 — 가입 트리거가 생기기 전에 만든 계정, 또는 탈퇴 직후 아직 만료되지 않은 토큰
  | { status: "missing" }
  // 운영자가 정지했다. 정지 안내만 보이고 다른 화면·데이터는 닫힌다.
  | { status: "suspended" }
  | { status: "ready"; profile: ProfileView };

/** 내 사진의 Storage 경로. 명부에 연결되면 조직도 사진이 곧 내 사진이다. */
export const ownPhotoPathOf = (row: ProfileRow): string | null =>
  row.linked_member ? row.linked_member.photo_path : row.photo_path;

const linkedPortraitOf = (member: LinkedMember | null): string | null =>
  member?.is_demo &&
  /^SOL-P\d{4}$/.test(member.person_code) &&
  member.portrait_path === `/demo/people/${member.person_code}.png`
    ? member.portrait_path
    : null;

/** photoUrl 은 ownPhotoPathOf 를 서명한 주소다. 서명하지 못했으면 null 이고 다음 순위로 내려간다. */
export const toProfileView = (row: ProfileRow, photoUrl: string | null = null): ProfileView => ({
  userId: row.id,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: photoUrl ?? linkedPortraitOf(row.linked_member) ?? row.avatar_url,
  hasOwnPhoto: ownPhotoPathOf(row) !== null,
  orgChartLinked: row.linked_member !== null,
  role: row.is_admin ? "운영자" : "회원",
  isAdmin: row.is_admin,
  joinedAt: row.created_at,
  employment: row.employment,
  profileComplete: toEmploymentState(row).profileComplete,
});

export const toMyProfile = (row: ProfileRow | null, photoUrl: string | null = null): MyProfile => {
  if (!row) return { status: "missing" };
  return row.status === "active"
    ? { status: "ready", profile: toProfileView(row, photoUrl) }
    : { status: "suspended" };
};

// 예상한 실패(로그인 안 함·틀린 입력)는 던지지 않고 값으로 돌려준다 — 운영에서 서버 함수가 던진 오류의 message 는 브라우저로 가지 않는다.
export type DisplayNameResult =
  { status: "saved" } | { status: "signed-out" } | { status: "invalid"; message: string };

// 화면이 이미 검사했어도 여기서 다시 본다. 화면의 검증은 편의이고 이쪽이 보안이다. DB 제약(profiles_display_name_check)이 한 번 더 지킨다.
const displayNameSchema = z
  .string("표시 이름은 글자여야 합니다")
  .trim()
  .min(1, "표시 이름을 입력하세요")
  .max(40, "표시 이름은 40자 이하입니다");

export function parseDisplayName(
  input: unknown,
): { ok: true; displayName: string } | { ok: false; message: string } {
  const parsed = displayNameSchema.safeParse(input);
  return parsed.success
    ? { ok: true, displayName: parsed.data }
    : { ok: false, message: parsed.error.issues[0].message };
}

// 탈퇴. 지우면 되돌릴 수 없다(즉시 삭제, supabase/migrations/20261015000001 의 delete_my_account).
//   sole-owner — 다른 멤버가 있는 팀의 유일한 owner. owner 를 넘기거나 팀을 나간 뒤 다시 한다.
//   suspended  — 정지된 회원. 지우고 다시 가입해 정지를 빠져나가지 못하게 막는다.
export type DeleteAccountResult =
  | { status: "deleted" }
  | { status: "signed-out" }
  | { status: "sole-owner" }
  | { status: "sole-admin" }
  | { status: "suspended" };

export type EmploymentResult =
  | { status: "ready"; state: EmploymentState }
  | { status: "signed-out" | "suspended" | "missing" | "no-database" }
  | { status: "invalid"; fields: Record<string, string> };

export const toEmploymentState = (row: ProfileRow): EmploymentState => ({
  name: row.display_name,
  employment: row.employment,
  profileComplete:
    employmentNameSchema.safeParse(row.display_name).success && row.employment !== null,
});
