import { expect, test } from "@playwright/test";
import { watchSupabase } from "./watch-supabase";

// 작업 화면(/[slug]/tasks)을 로그인 없이 본다. 로그인한 뒤의 표·대화상자·상태 바꾸기·삭제는 로컬 Supabase 로 손으로 확인한다(CI 에는 DB 가 없다).
// 대화상자 폼과 상태 메뉴는 부품 브라우저 시험(app/(app)/[slug]/tasks/*.browser.test.tsx)이 가짜 서버 함수로 본다.
// 로그인 전에는 조직이 있는지 묻지 않고 안내부터 그리므로 조직 주소(slug)는 아무것이나 쓴다. 옛 주소 /memos 는 protected.spec.ts 가 본다.
// DB 설정이 없으면 연결이 없다고 알리고, 있으면(CI 는 가짜 주소) 로그인이 필요하다고 알린다.
// 어느 쪽이든 표·추가 단추 대신 계정 화면으로 가는 링크를 보이고, 화면을 열기만 해서는 Supabase 에 요청하지 않는다.
const TASKS_PATH = "/acme/tasks";

test("작업 화면은 로그인 전 상태를 오류 없이 그리고, 열기만 해서는 Supabase 에 요청하지 않는다", async ({
  page,
}) => {
  const errors: string[] = [];
  const supabaseRequests = watchSupabase(page);
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(TASKS_PATH);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /^(로그인이 필요합니다|DB 가 연결되지 않았습니다)$/,
    }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(supabaseRequests).toEqual([]);
});

test("로그인하지 않고 작업 화면을 열면 표·추가 단추 없이 계정 화면으로 가는 링크를 보여 준다", async ({
  page,
}) => {
  await page.goto(TASKS_PATH);
  await expect(page.getByRole("heading", { name: "작업 목록", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(작업 추가|첫 작업 추가)$/ })).toHaveCount(0);
  const link = page.getByRole("link", { name: /^(로그인하러 가기|계정 화면으로 가기)$/ });
  await expect(link).toHaveAttribute("href", "/auth/login");
});

// 메모 화면은 작업 화면으로 바뀌며 없어졌다(스펙 4.4). 조직 아래의 메모 주소는 로그인 안내가 아니라 404 다.
// 옛 주소 /memos(조직 없음)는 지금도 서버가 판정한 업무 조직의 작업 화면으로 보낸다 — protected.spec.ts 가 본다.
test("없앤 메모 화면 /acme/memos 는 로그인 안내 대신 404 로 응답한다", async ({ page }) => {
  const supabaseRequests = watchSupabase(page);
  const response = await page.goto("/acme/memos");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
  await page.waitForLoadState("networkidle");
  expect(supabaseRequests).toEqual([]);
});
