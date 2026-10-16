// 로그인 쿠키의 옵션. 서버(server/supabase)와 브라우저(lib/supabase-browser.ts)가 같은 값을 써야 서로의 쿠키를 덮지 않는다.
// @supabase/ssr 의 기본값(path=/, SameSite=Lax, 400일)에 Secure 만 더한다 — 운영 빌드에서는 https 로만 오간다.
// HttpOnly 는 켜지 않는다. 브라우저 클라이언트가 같은 쿠키를 읽어 로그인·로그아웃·연결을 하기 때문이다(docs/AUTH-SECURITY.md).
// 개발 서버(http://localhost)는 Secure 쿠키를 받지 않는 브라우저(사파리)가 있어 끈다.
export const AUTH_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === "production",
} as const;
