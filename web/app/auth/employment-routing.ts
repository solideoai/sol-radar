import "server-only";
import { safeNextPath } from "@/server/auth";
import { getMyProfile } from "@/server/profile";

export function safeEmploymentNext(value: unknown): string {
  const path = safeNextPath(typeof value === "string" ? value : null);
  try {
    const pathname = decodeURIComponent(
      new URL(path, "http://internal.invalid").pathname,
    ).replaceAll("\\", "/");
    if (pathname === "/auth" || pathname.startsWith("/auth/") || pathname.startsWith("//"))
      return "/auth/login";
  } catch {
    return "/auth/login";
  }
  return path;
}
export function completionPath(next?: string): string {
  const path = safeEmploymentNext(next);
  return path === "/auth/login"
    ? "/auth/complete-profile"
    : `/auth/complete-profile?next=${encodeURIComponent(path)}`;
}
export async function afterEmploymentAuthentication(next: string): Promise<string> {
  const me = await getMyProfile();
  return me.status === "ready" && !me.profile.profileComplete ? completionPath(next) : next;
}

// 템플릿 조직 화면(/{slug}/…)에서 보완·조직 상태 뒤 돌아올 곳. 현재 조직의 템플릿 화면이 아니면(없거나 잘못되면)
// 로그인·초대 수락과 같은 업무 첫 화면(/dashboard)이다(Ruling 16). 템플릿 경로 자체는 남긴다(D30).
export function businessLayoutNext(value: string | null, slug: string): string {
  const path = safeEmploymentNext(value);
  const prefix = `/${encodeURIComponent(slug)}/`;
  const pathname = path.split("?")[0];
  return pathname.startsWith(prefix) &&
    /^(?:dashboard|tasks|settings(?:\/(?:members|team))?)\/?$/.test(pathname.slice(prefix.length))
    ? path
    : "/dashboard";
}

// 업무 화면(/dashboard·/bids·/bids/<uuid>·/notifications)과 템플릿 경로. 공고 상세는 UUID 한 단계만 받는다.
const BUSINESS_PATH =
  /^(?:\/(?:dashboard|memos|settings|bids|notifications)|\/bids\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/[^/]+\/(?:dashboard|tasks|settings(?:\/(?:members|team))?))\/?$/i;

export function safeBusinessNext(value: unknown): string {
  const path = safeEmploymentNext(value);
  const pathname = path.split("?")[0];
  return BUSINESS_PATH.test(pathname) ? path : "/dashboard";
}
export function organizationStatePath(next?: unknown): string {
  const path = safeBusinessNext(next);
  return path === "/dashboard"
    ? "/auth/organization-state"
    : `/auth/organization-state?next=${encodeURIComponent(path)}`;
}
