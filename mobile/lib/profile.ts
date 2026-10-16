import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

// 웹(web/server/profile)과 같은 규칙이지만 두 폴더는 코드를 나누지 않는 독립 프로젝트라 따로 둔다.

export type ProfileView = { email: string; displayName: string | null; role: "운영자" | "회원" };

export const toProfileView = (
  row: Pick<Tables<"profiles">, "email" | "is_admin" | "display_name">,
): ProfileView => ({
  email: row.email ?? "(이메일 없음)",
  displayName: row.display_name,
  role: row.is_admin ? "운영자" : "회원",
});

// EXPO_PUBLIC_ 값은 번들 때 박히므로 이름을 그대로 적어 읽는다(lib/supabase.ts 와 같은 이유).
export const isDatabaseConfigured = (): boolean =>
  Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

// 화면의 입력 검사는 편의다. 맞는 비밀번호인지는 Supabase Auth 가 판단한다.
export const emailProblem = (email: string): string | null =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : "이메일 형식이 아닙니다";

export const passwordProblem = (password: string): string | null =>
  password.length < 6 ? "비밀번호는 6자 이상입니다" : null;

export function credentialsProblem(email: string, password: string): string | null {
  return emailProblem(email) ?? passwordProblem(password);
}

// 어느 칸의 문제인지 알아야 화면이 그 칸 아래에 띄우고 포커스를 옮긴다.
export type FieldProblem = { field: "email" | "password"; message: string };

export function credentialsFieldProblem(email: string, password: string): FieldProblem | null {
  const emailIssue = emailProblem(email);
  if (emailIssue) return { field: "email", message: emailIssue };
  const passwordIssue = passwordProblem(password);
  return passwordIssue ? { field: "password", message: passwordIssue } : null;
}

export const signInMessage = (error: { code?: string; message: string }): string =>
  error.code === "invalid_credentials"
    ? "이메일 또는 비밀번호가 맞지 않습니다"
    : `로그인하지 못했습니다: ${error.message}`;

// 메일 확인을 켠 프로젝트는 가입해도 세션 없이 확인 메일만 간다. 메일의 링크는 웹(/auth/confirm)이 받으므로
// 앱은 딥링크 없이 "확인한 뒤 로그인"만 안내한다.
export const SIGN_UP_MAIL_SENT = "확인 메일을 보냈습니다. 메일의 링크를 연 뒤 로그인하세요.";

export const signUpMessage = (error: { code?: string; message: string }): string =>
  error.code === "user_already_exists"
    ? "이미 가입된 이메일입니다"
    : `가입하지 못했습니다: ${error.message}`;

export const signOutMessage = (reason: string): string => `로그아웃하지 못했습니다: ${reason}`;

// 로그인·로그아웃은 화면만 바뀌고 알림 문구가 없어 스크린 리더에 따로 알린다.
export const SIGNED_IN_ANNOUNCEMENT = "로그인했습니다";
export const SIGNED_OUT_ANNOUNCEMENT = "로그아웃했습니다";

// RLS 는 운영자에게 모든 행을 연다. "내 프로필"은 id 로 좁혀야 운영자에게도 한 행이다.
// 클라이언트를 인자로 받아 시험에서 가짜를 넘긴다.
export async function loadMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<ProfileView | null> {
  const { data, error } = await client
    .from("profiles")
    .select("email, is_admin, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data && toProfileView(data);
}

// 표시 이름은 웹 web/server/profile/profile.model.ts 와 같은 규칙·문구를 쓴다.

export const DISPLAY_NAME_MAX = 40;

// DB 제약(profiles_display_name_check)이 같은 규칙을 한 번 더 지킨다.
export function parseDisplayName(
  input: string,
): { ok: true; displayName: string } | { ok: false; message: string } {
  const displayName = input.trim();
  if (displayName.length === 0) return { ok: false, message: "표시 이름을 입력하세요" };
  if (displayName.length > DISPLAY_NAME_MAX) {
    return { ok: false, message: `표시 이름은 ${DISPLAY_NAME_MAX}자 이하입니다` };
  }
  return { ok: true, displayName };
}

export const DISPLAY_NAME_SAVED = "표시 이름을 저장했습니다";

export const displayNameSaveMessage = (reason: string): string =>
  `표시 이름을 저장하지 못했습니다: ${reason}`;

export type SaveDisplayNameResult =
  { ok: true; displayName: string } | { ok: false; message: string };

// 남의 id 를 넘기면 RLS 가 걸러 오류 없이 0행이 되므로 고친 행이 있었는지 본다.
// 오류는 던지지 않고 값으로 돌려준다 — 화면이 입력값을 그대로 둔 채 문구만 띄운다.
export async function saveDisplayName(
  client: SupabaseClient<Database>,
  userId: string,
  input: string,
): Promise<SaveDisplayNameResult> {
  const parsed = parseDisplayName(input);
  if (!parsed.ok) return parsed;
  const { data, error } = await client
    .from("profiles")
    .update({ display_name: parsed.displayName })
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, message: displayNameSaveMessage(error.message) };
  if (data.length === 0) {
    return { ok: false, message: displayNameSaveMessage("고칠 수 있는 프로필 행이 없습니다") };
  }
  return { ok: true, displayName: parsed.displayName };
}

// 비밀번호 재설정: 앱은 메일 요청만 하고, 메일의 링크는 웹(/auth/confirm → /auth/password)이 받아 새 비밀번호를 정한다.

// 가입된 주소인지는 드러내지 않는다 — Supabase 도 없는 주소에 오류를 주지 않으므로 성공 문구는 하나다.
export const PASSWORD_RESET_SENT =
  "가입된 주소라면 재설정 메일을 보냈습니다. 메일의 링크를 열어 새 비밀번호를 정한 뒤 여기서 로그인하세요.";

export const passwordResetMessage = (reason: string): string =>
  `메일을 보내지 못했습니다: ${reason}`;

export type PasswordResetResult = { ok: true } | { ok: false; message: string };

export async function requestPasswordReset(
  client: SupabaseClient<Database>,
  email: string,
): Promise<PasswordResetResult> {
  const { error } = await client.auth.resetPasswordForEmail(email.trim());
  return error ? { ok: false, message: passwordResetMessage(error.message) } : { ok: true };
}
