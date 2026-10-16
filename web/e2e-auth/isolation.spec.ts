import { expect, test } from "@playwright/test";
import { SEED_TEAM, authFileOf } from "./support/seed";

// 조직 밖 사람(박외부)에게 시드 팀의 주소는 404 다. 남의 조직이 있는지조차 알려 주지 않는다(없는 조직과 같은 응답).
// 로그인 전 안내(200)가 아니라 로그인한 사람의 404 라서 로그인 상태로 본다.
test.use({ storageState: authFileOf("outsider") });

for (const screen of ["dashboard", "tasks", "settings/members"]) {
  const path = `/${SEED_TEAM.slug}/${screen}`;
  test(`조직 밖 사람이 ${path} 를 열면 404 이고 팀의 내용이 보이지 않는다`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
    await expect(page.getByText(SEED_TEAM.name)).toHaveCount(0);
    await expect(page.getByText("분기 보고서 초안")).toHaveCount(0);
  });
}

test("조직 밖 사람의 조직 전환기에는 시드 팀이 없다", async ({ page }) => {
  // 로그인한 사람은 계정 화면에서 개인 조직의 대시보드로 간다.
  await page.goto("/auth/login");
  await expect(page).toHaveURL(/\/[a-z0-9]{8}\/dashboard$/);
  await page.getByRole("button", { name: "조직 전환" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "개인 공간" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: SEED_TEAM.name })).toHaveCount(0);
});
