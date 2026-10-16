import { expect, test } from "@playwright/test";
import { watchSupabase } from "./watch-supabase";

// 첫 화면과 404 는 DB 설정 없이도 열리고, Supabase(인증·데이터 API)에 요청하지 않는다.

test("첫 화면이 정상 응답하고 클라이언트 오류 없이 표시된다", async ({ page }) => {
  const errors: string[] = [];
  const supabaseRequests = watchSupabase(page);
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("/setup");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(supabaseRequests).toEqual([]);
});

// 한 마디 주소(/<이름>)는 조직 주소(/[slug])라 로그인 전에는 "로그인이 필요합니다" 안내를 그린다. 없는 주소는 조직 아래의 없는 화면으로 쓴다.
test("없는 주소는 정상적인 404로 응답한다", async ({ page }) => {
  const supabaseRequests = watchSupabase(page);
  const response = await page.goto("/acme/route-that-does-not-exist");
  expect(response?.status()).toBe(404);
  await page.waitForLoadState("networkidle");
  expect(supabaseRequests).toEqual([]);
});
