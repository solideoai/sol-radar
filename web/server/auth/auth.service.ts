import "server-only";
import {
  type Authentication,
  canUnlink,
  INVALID_LINK_PATH,
  type MyLoginMethods,
  oauthFailurePath,
  oauthSuccessPath,
  parseConfirmLink,
  parseIdentityId,
  parseOAuthCallback,
  toAuthentication,
  toLoginMethods,
  type UnlinkResult,
} from "./auth.model";
import { authRepo, type AuthRepo } from "./auth.repo";

// ── 서비스: 메일 링크·간편 로그인을 확인하고 다음에 갈 경로를 정한다 ──
// 돌려주는 값은 늘 이 사이트 안의 경로다. 라우트 핸들러는 그 경로로 보내기만 한다.
export async function confirmEmailLink(
  params: URLSearchParams,
  repo: AuthRepo = authRepo,
): Promise<string> {
  const link = parseConfirmLink(params);
  if (!link || !repo.isConfigured()) return INVALID_LINK_PATH;
  return (await repo.verifyLink(link.tokenHash, link.type)) ? link.next : INVALID_LINK_PATH;
}

// 로그인과 마이페이지의 "연결하기"가 같은 주소로 돌아온다. 연결도 코드를 세션으로 바꾸는 것으로 끝난다.
export async function completeOAuthSignIn(
  params: URLSearchParams,
  repo: AuthRepo = authRepo,
): Promise<string> {
  const callback = parseOAuthCallback(params);
  if (callback.status === "error") return oauthFailurePath(callback);
  const exchanged = repo.isConfigured() && (await repo.exchangeCode(callback.code));
  return exchanged
    ? oauthSuccessPath(callback)
    : oauthFailurePath({ ...callback, errorCode: null });
}

// ── 요청한 사람 ──

/**
 * 지금 요청을 보낸 사람. API 의 문지기(requireUser·requireAdmin)와 아래 도메인 함수가 같은 판정을 쓴다.
 * 토큰은 서명·만료·발급자를 확인한 것만 믿고, 역할·상태는 요청마다 DB 에서 읽는다(화면·API 가 보낸 값을 믿지 않는다).
 * source "bearer" 는 Authorization 헤더의 토큰만 받는다(API). 화면(쿠키)은 기본값 "request" 다.
 */
export async function authenticate(
  source: "bearer" | "request" = "request",
  repo: AuthRepo = authRepo,
): Promise<Authentication> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const session = await repo.currentSession(source);
  if (!session) return { status: "unauthenticated" };
  return toAuthentication(session.claims, await repo.accountOf(session.claims.userId));
}

// 정지된 사람·탈퇴 직후의 토큰은 로그인 수단도 세션도 다루지 못한다.
async function activeSession(repo: AuthRepo) {
  if (!repo.isConfigured()) return null;
  const session = await repo.currentSession();
  if (!session) return null;
  const auth = toAuthentication(session.claims, await repo.accountOf(session.claims.userId));
  return auth.status === "ready" ? session : null;
}

export async function getMyLoginMethods(repo: AuthRepo = authRepo): Promise<MyLoginMethods> {
  const session = await activeSession(repo);
  if (!session) return { status: "signed-out" };
  const methods = toLoginMethods(await repo.listIdentities(session.accessToken));
  return { status: "ready", methods, canUnlink: canUnlink(methods) };
}

// 서버 함수·API 가 화면 밖에서 직접 불릴 수 있어 입력을 믿지 않는다. 남의 로그인 수단 id 는 Auth 가 not-found 로 거절한다.
export async function unlinkMyLoginMethod(
  input: unknown,
  repo: AuthRepo = authRepo,
): Promise<UnlinkResult> {
  const identityId = parseIdentityId(input);
  if (!identityId) return { status: "invalid" };
  const session = await activeSession(repo);
  if (!session) return { status: "signed-out" };
  // 화면이 버튼을 감췄어도 다시 본다. Auth 도 마지막 하나는 거절한다.
  const methods = toLoginMethods(await repo.listIdentities(session.accessToken));
  if (!methods.some((method) => method.identityId === identityId)) return { status: "not-found" };
  if (!canUnlink(methods)) return { status: "last-method" };
  return { status: await repo.unlinkIdentity(session.accessToken, identityId) };
}

export async function signOutEverywhere(
  repo: AuthRepo = authRepo,
): Promise<{ status: "signed-out" } | { status: "done" }> {
  if (!repo.isConfigured()) return { status: "signed-out" };
  // 정지된 사람도 자기 세션은 끊을 수 있다(정지할 때 이미 끊겼다).
  const session = await repo.currentSession();
  if (!session) return { status: "signed-out" };
  await repo.signOutEverywhere(session.accessToken);
  return { status: "done" };
}
