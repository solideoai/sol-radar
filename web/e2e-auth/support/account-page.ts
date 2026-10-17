import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page } from "@playwright/test";
import { z } from "zod";

// 마이페이지(/[slug]/settings)와 로그인 화면을 보는 도구. settings-account 의 두 시험이 같은 방법으로 본다.

// 구역 순서(page.tsx). 구역은 제목을 이름으로 가진 영역(section aria-labelledby)이다.
export const SETTINGS_SECTIONS = [
  "프로필",
  "로그인 수단",
  "비밀번호",
  "세션",
  "회원 탈퇴",
] as const;
export const sectionOf = (page: Page, name: (typeof SETTINGS_SECTIONS)[number]) =>
  page.getByRole("main").getByRole("region", { name, exact: true });

// 간편 로그인 버튼은 NEXT_PUBLIC_AUTH_GOOGLE·KAKAO·NAVER=true 로 빌드한 프로젝트에서만 보인다(마이페이지의 연결 줄도 같다).
// 빌드는 이 값을 코드에 박으므로, 빌드가 읽는 것과 같은 자리(환경 변수, 그다음 web/ 의 env 파일)에서 읽어 기대값을 정한다.
// 로그인 전 E2E(e2e/account.spec.ts 의 buildFlag)와 같은 규칙이다.
const buildFlag = (name: string): boolean => {
  if (process.env[name] !== undefined) return process.env[name] === "true";
  for (const file of [".env.production.local", ".env.local", ".env.production", ".env"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((text) => text.startsWith(`${name}=`));
    if (line !== undefined) return line.slice(name.length + 1).trim() === "true";
  }
  return false;
};

// 화면에 놓는 순서(구글 → 카카오 → 네이버) 그대로다.
export const ENABLED_SOCIAL = [
  { name: "구글", flag: "NEXT_PUBLIC_AUTH_GOOGLE" },
  { name: "카카오", flag: "NEXT_PUBLIC_AUTH_KAKAO" },
  { name: "네이버", flag: "NEXT_PUBLIC_AUTH_NAVER" },
]
  .filter(({ flag }) => buildFlag(flag))
  .map(({ name }) => name);

// 가로 넘침(px). 0 이어야 한다.
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Explicitly prepared sole-business fixture destination.
export const BUSINESS_DASHBOARD = /\/[^/]+\/dashboard$/;

// 로그인 화면의 폼으로 로그인한다. path 는 ?next= 같은 검색어를 붙인 로그인 주소.
export const fillSignInForm = async (
  page: Page,
  { email, password }: { email: string; password: string },
  path = "/auth/login",
) => {
  await page.goto(path);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
};

// Caller explicitly provisions one business membership before using this helper.
export const signInThroughForm = async (
  page: Page,
  account: { email: string; password: string },
): Promise<string> => {
  await fillSignInForm(page, account);
  await expect(page).toHaveURL(BUSINESS_DASHBOARD);
  await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[1];
};

// 이 브라우저의 Supabase 로그인 쿠키(@supabase/ssr: sb-<참조>-auth-token, 길면 .0·.1… 로 나뉜다).
const AUTH_COOKIE = /^sb-.+-auth-token(?:\.(\d+))?$/;
const BASE64_PREFIX = "base64-";
const storedSessionSchema = z.object({ access_token: z.string(), refresh_token: z.string() });

export const authCookiesOf = async (context: BrowserContext) =>
  (await context.cookies()).filter((cookie) => AUTH_COOKIE.test(cookie.name));

// 쿠키에 든 세션을 읽는다. 다른 기기의 세션이 서버에서 끊겼는지 refresh token 으로 확인하려고 쓴다.
// 읽은 토큰의 주인(sub)도 돌려준다 — 엉뚱한 값을 읽어 갱신이 "실패"하는 헛시험을 막는다. 토큰은 출력하지 않는다.
export const storedSessionOf = async (
  context: BrowserContext,
): Promise<{ refreshToken: string; userId: string }> => {
  const chunks = (await authCookiesOf(context))
    .map((cookie) => ({
      index: Number(AUTH_COOKIE.exec(cookie.name)?.[1] ?? 0),
      value: cookie.value,
    }))
    .toSorted((a, b) => a.index - b.index);
  const raw = chunks.map((chunk) => chunk.value).join("");
  if (!raw.startsWith(BASE64_PREFIX)) throw new Error("로그인 쿠키가 없거나 모양이 다릅니다.");
  const session = storedSessionSchema.parse(
    JSON.parse(Buffer.from(raw.slice(BASE64_PREFIX.length), "base64url").toString("utf8")),
  );
  const [, payload] = session.access_token.split(".");
  const claims = z
    .object({ sub: z.string() })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  return { refreshToken: session.refresh_token, userId: claims.sub };
};

export const signInWithoutOrganization = async (
  page: Page,
  account: { email: string; password: string },
) => {
  await fillSignInForm(page, account);
  await expect(page).toHaveURL(/\/auth\/organization-state$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("조직 초대가 필요합니다");
};
