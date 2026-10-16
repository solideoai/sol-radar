import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { watchSupabase } from "./watch-supabase";

// 로그인 견본(/auth/login)을 실제 인증 없이 본다. 실제 로그인은 docs/database.md 의 수동 확인이 맡는다.
// DB 설정이 없으면 연결이 없다고 알리고, 있으면(CI 는 가짜 주소) 로그인 폼을 그린다.
// 어느 쪽이든 화면을 열기만 해서는 Supabase 에 요청하지 않는다.

test("계정 화면은 로그인 전 상태를 오류 없이 그리고, 열기만 해서는 Supabase 에 요청하지 않는다", async ({
  page,
}) => {
  const errors: string[] = [];
  const supabaseRequests = watchSupabase(page);
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/auth/login");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: /^(로그인|DB 가 연결되지 않았습니다)$/ }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(supabaseRequests).toEqual([]);
});

test("로그인 폼은 잘못된 입력을 Supabase 에 보내지 않고 바로 알려 준다", async ({ page }) => {
  const supabaseRequests = watchSupabase(page);
  await page.goto("/auth/login");
  const submit = page.getByRole("button", { name: "로그인", exact: true });
  // DB 설정이 없는 빌드는 폼 대신 연결 안내를 그린다. 그때는 안내가 맞는지만 보고 끝낸다.
  // 건너뛰지 않는다 — 폼도 안내도 없으면 실패한다. CI 는 가짜 주소로 폼을 그려 아래 검증까지 본다.
  if (!(await submit.isVisible())) {
    await expect(
      page.getByRole("heading", { level: 1, name: "DB 가 연결되지 않았습니다" }),
    ).toBeVisible();
    return;
  }
  await page.getByLabel("이메일").fill("not-an-email");
  await submit.click();
  await expect(page.getByText("이메일 형식이 아닙니다")).toBeVisible();
  await expect(page.getByText("비밀번호는 6자 이상입니다")).toBeVisible();
  expect(supabaseRequests).toEqual([]);
});

// 가입·재설정·새 비밀번호 화면도 열기만 해서는 Supabase 에 요청하지 않고, 틀린 입력은 보내지 않는다.
// DB 설정이 없는 빌드는 세 화면 모두 연결 안내를 그린다.
const NO_DATABASE = "DB 가 연결되지 않았습니다";
[
  { path: "/auth/sign-up", heading: "회원가입", submit: "회원가입" },
  { path: "/auth/reset", heading: "비밀번호 재설정", submit: "재설정 메일 받기" },
].forEach(({ path, heading, submit }) =>
  test(`${path} 는 틀린 입력을 Supabase 에 보내지 않고 바로 알려 준다`, async ({ page }) => {
    const supabaseRequests = watchSupabase(page);
    await page.goto(path);
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText(new RegExp(`^(${heading}|${NO_DATABASE})$`));
    if ((await title.textContent()) === NO_DATABASE) return;
    await page.getByLabel("이메일").fill("not-an-email");
    await page.getByRole("button", { name: submit, exact: true }).click();
    await expect(page.getByText("이메일 형식이 아닙니다")).toBeVisible();
    expect(supabaseRequests).toEqual([]);
  }),
);

test("로그인하지 않고 새 비밀번호 화면을 열면 폼 대신 재설정 안내를 보여 준다", async ({
  page,
}) => {
  await page.goto("/auth/password");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    new RegExp(`^(로그인이 필요합니다|${NO_DATABASE})$`),
  );
  await expect(page.getByLabel("새 비밀번호")).toHaveCount(0);
});

test("토큰 없는 메일 링크는 바깥 주소가 아니라 계정 화면의 안내로 보낸다", async ({ page }) => {
  await page.goto("/auth/confirm?type=email&next=//evil.example");
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    "/auth/login?link=invalid",
  );
});

test("간편 로그인이 오류로 돌아오면 Supabase 에 묻지 않고 로그인 화면의 안내로 보낸다", async ({
  page,
}) => {
  await page.goto("/auth/callback?error=access_denied&next=//evil.example");
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    "/auth/login?link=oauth-failed",
  );
});

// 간편 로그인 버튼은 NEXT_PUBLIC_AUTH_GOOGLE·KAKAO·NAVER=true 로 빌드한 프로젝트에서만 보인다.
// 빌드는 이 값을 코드에 박으므로, 빌드가 읽는 것과 같은 자리(환경 변수, 그다음 web/ 의 env 파일)에서 읽어 기대값을 정한다.
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
const SOCIAL = [
  { name: "구글", flag: "NEXT_PUBLIC_AUTH_GOOGLE" },
  { name: "카카오", flag: "NEXT_PUBLIC_AUTH_KAKAO" },
  { name: "네이버", flag: "NEXT_PUBLIC_AUTH_NAVER" },
];

test("간편 로그인 버튼은 켠 회사 것만 보인다", async ({ page }) => {
  for (const path of ["/auth/login", "/auth/sign-up"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // DB 설정이 없는 빌드는 폼 대신 연결 안내를 그려 버튼도 없다.
    if (!(await page.getByLabel("이메일").isVisible())) continue;
    for (const { name, flag } of SOCIAL) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(
        buildFlag(flag) ? 1 : 0,
      );
    }
  }
});

// 계정 화면은 /auth 아래로 옮겼다. 옛 주소(이미 보낸 메일 링크·북마크)는 검색어를 지닌 채 새 주소로 영구 이동한다(next.config.ts).
[
  { from: "/account?link=invalid", to: "/auth/login?link=invalid" },
  { from: "/account/sign-up", to: "/auth/sign-up" },
  { from: "/account/reset", to: "/auth/reset" },
  { from: "/account/password", to: "/auth/password" },
].forEach(({ from, to }) =>
  test(`옛 주소 ${from} 는 ${to} 로 영구 이동한다`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(to);
  }),
);
