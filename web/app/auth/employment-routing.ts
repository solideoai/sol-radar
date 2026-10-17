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

export function businessLayoutNext(value: string | null, slug: string): string {
  const path = safeEmploymentNext(value);
  const prefix = `/${encodeURIComponent(slug)}/`;
  const pathname = path.split("?")[0];
  return pathname.startsWith(prefix) &&
    /^(?:dashboard|tasks|settings(?:\/(?:members|team))?)\/?$/.test(pathname.slice(prefix.length))
    ? path
    : `${prefix}dashboard`;
}

export function safeBusinessNext(value: unknown): string {
  const path = safeEmploymentNext(value);
  const pathname = path.split("?")[0];
  return /^(?:\/(?:dashboard|memos|settings)|\/[^/]+\/(?:dashboard|tasks|settings(?:\/(?:members|team))?))\/?$/.test(
    pathname,
  )
    ? path
    : "/dashboard";
}
export function organizationStatePath(next?: unknown): string {
  const path = safeBusinessNext(next);
  return path === "/dashboard"
    ? "/auth/organization-state"
    : `/auth/organization-state?next=${encodeURIComponent(path)}`;
}
