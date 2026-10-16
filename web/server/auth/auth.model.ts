import "server-only";

// ── 모델: 메일 링크(/auth/confirm)·간편 로그인(/auth/callback)·로그인 수단의 순수 규칙. 저장·화면을 모른다 ──

// 가입 확인(email)과 비밀번호 재설정(recovery).
const LINK_TYPES = ["email", "recovery"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export type ConfirmLink = { tokenHash: string; type: LinkType; next: string };

export const INVALID_LINK_PATH = "/auth/login?link=invalid";
const DEFAULT_NEXT = "/auth/login";
// 주소를 풀어 보기 위한 가짜 출처. 결과가 이 출처를 벗어나면 바깥 주소다.
const ORIGIN = "http://internal.invalid";

/**
 * 메일 링크의 next 는 누구나 바꿔 보낼 수 있으므로 이 사이트 안의 경로만 받는다(open redirect 방지).
 * 브라우저는 `//evil.example`·`/\evil.example` 과 탭·줄바꿈이 낀 주소도 바깥 주소로 읽으므로, 글자가 아니라 주소로 풀어 본다.
 */
export function safeNextPath(next: string | null): string {
  if (!next?.startsWith("/")) return DEFAULT_NEXT;
  const url = URL.parse(next, ORIGIN);
  if (!url || url.origin !== ORIGIN) return DEFAULT_NEXT;
  const path = url.pathname + url.search;
  // `/.//evil.example` 은 풀고 나면 `//evil.example` 이 된다.
  return path.startsWith("//") ? DEFAULT_NEXT : path;
}

export const OAUTH_FAILED_PATH = "/auth/login?link=oauth-failed";
export const SUSPENDED_PATH = "/auth/login?link=suspended";

// 마이페이지에서 로그인 수단을 연결한 결과. 마이페이지가 ?link=<결과> 로 받아 안내한다.
const LINK_FAILURES = ["identity_already_exists", "manual_linking_disabled"] as const;
export type LinkFailure = (typeof LINK_FAILURES)[number] | "failed";
export type LinkOutcome = LinkFailure | "linked";

// next 는 safeNextPath 를 거친 사이트 안 경로다. 검색어가 이미 있으면 거기에 더한다.
const withLinkOutcome = (next: string, outcome: LinkOutcome): string => {
  const url = new URL(next, ORIGIN);
  url.searchParams.set("link", outcome);
  return url.pathname + url.search;
};

/** 코드 교환에 성공한 뒤 갈 곳. 연결 흐름이면 마이페이지가 "연결했습니다"를 알리게 표시를 붙인다. */
export const oauthSuccessPath = (callback: { next: string; isLinking: boolean }): string =>
  callback.isLinking ? withLinkOutcome(callback.next, "linked") : callback.next;

// 제공자나 Supabase 가 오류로 돌려보냈거나 코드 교환이 실패했다. error_code 는 Supabase Auth 의 오류 코드다(user_banned 등).
export type OAuthFailure = { errorCode: string | null; next: string; isLinking: boolean };

export type OAuthCallback =
  | { status: "code"; code: string; next: string; isLinking: boolean }
  | ({ status: "error" } & OAuthFailure);

/**
 * /auth/callback 의 검색어. 코드가 없거나 제공자가 오류(error)를 돌려줬으면 오류다.
 * flow=link 는 마이페이지의 "연결하기"가 붙인다. 그때는 실패해도 마이페이지(next)로 돌아가 이유를 보인다.
 */
export function parseOAuthCallback(params: URLSearchParams): OAuthCallback {
  const code = params.get("code");
  const next = safeNextPath(params.get("next"));
  const isLinking = params.get("flow") === "link";
  if (code && !params.has("error")) return { status: "code", code, next, isLinking };
  return { status: "error", errorCode: params.get("error_code"), next, isLinking };
}

/** 실패한 간편 로그인·연결 뒤에 갈 곳. 정지된 계정은 어느 흐름이든 로그인 화면이 안내한다. */
export function oauthFailurePath(failure: OAuthFailure): string {
  if (failure.errorCode === "user_banned") return SUSPENDED_PATH;
  if (!failure.isLinking) return OAUTH_FAILED_PATH;
  const reason: LinkFailure =
    LINK_FAILURES.find((known) => known === failure.errorCode) ?? "failed";
  return withLinkOutcome(failure.next, reason);
}

/** 토큰이 없거나 모르는 종류면 null. */
export function parseConfirmLink(params: URLSearchParams): ConfirmLink | null {
  const tokenHash = params.get("token_hash");
  const type = LINK_TYPES.find((known) => known === params.get("type"));
  if (!tokenHash || !type) return null;
  return { tokenHash, type, next: safeNextPath(params.get("next")) };
}

// ── 요청한 사람 ──

// 서버가 믿는 요청자. 역할·상태는 화면·API 가 보낸 값이 아니라 DB(profiles)에서 읽는다.
export type AuthUser = { id: string; email: string | null; role: "user" | "admin" };

// 로그인 수단·세션을 다루는 도메인 함수와 API 의 문지기(requireUser)가 같은 판정을 쓴다.
//   unauthenticated — 토큰이 없거나, 서명·만료·발급자가 틀렸거나, 프로필 행이 없다(탈퇴 직후의 토큰 등)
//   suspended       — 운영자가 정지했다. 토큰이 아직 유효해도 막는다
export type Authentication =
  | { status: "no-database" }
  | { status: "unauthenticated" }
  | { status: "suspended" }
  | { status: "ready"; user: AuthUser };

export type AccountRow = { is_admin: boolean; status: string };

export function toAuthentication(
  claims: { userId: string; email: string | null },
  account: AccountRow | null,
): Authentication {
  if (!account) return { status: "unauthenticated" };
  if (account.status !== "active") return { status: "suspended" };
  return {
    status: "ready",
    user: { id: claims.userId, email: claims.email, role: account.is_admin ? "admin" : "user" },
  };
}

// ── 로그인 수단(Supabase Auth 의 identities) ──

// Supabase 의 제공자 이름. 네이버는 사용자 정의 제공자라 custom: 이 붙는다.
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  email: "이메일",
  google: "구글",
  kakao: "카카오",
  "custom:naver": "네이버",
};

export type IdentityRow = {
  identity_id: string;
  provider: string;
  identity_data?: Readonly<Record<string, unknown>>;
  created_at?: string;
  last_sign_in_at?: string;
};

export type LoginMethod = {
  identityId: string;
  provider: string;
  label: string;
  // 그 제공자 계정의 이메일. 주지 않는 제공자면 없다.
  email: string | null;
  linkedAt: string | null;
  lastSignInAt: string | null;
};

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

// 연결한 순서대로. 같은 시각이면 id 로 순서를 고정한다.
export function toLoginMethods(identities: readonly IdentityRow[]): LoginMethod[] {
  return identities
    .map((identity) => ({
      identityId: identity.identity_id,
      provider: identity.provider,
      label: PROVIDER_LABELS[identity.provider] ?? identity.provider,
      email: textOf(identity.identity_data?.email),
      linkedAt: identity.created_at ?? null,
      lastSignInAt: identity.last_sign_in_at ?? null,
    }))
    .toSorted(
      (a, b) =>
        (a.linkedAt ?? "").localeCompare(b.linkedAt ?? "") ||
        a.identityId.localeCompare(b.identityId),
    );
}

// 마지막 로그인 수단은 해제하지 않는다 — 다시 로그인할 길이 없어진다(Supabase Auth 도 같은 이유로 거절한다).
export const canUnlink = (methods: readonly LoginMethod[]): boolean => methods.length > 1;

export type MyLoginMethods =
  { status: "signed-out" } | { status: "ready"; methods: LoginMethod[]; canUnlink: boolean };

export type UnlinkResult =
  | { status: "unlinked" }
  | { status: "signed-out" }
  | { status: "invalid" }
  | { status: "not-found" }
  | { status: "last-method" };

// identity_id 는 Supabase 가 만든 uuid 다. 다른 모양은 Auth 에 묻지 않는다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const parseIdentityId = (input: unknown): string | null =>
  typeof input === "string" && UUID.test(input) ? input.toLowerCase() : null;
