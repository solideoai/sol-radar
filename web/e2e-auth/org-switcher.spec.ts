import { expect, test } from "@playwright/test";
import { BUSINESS_DASHBOARD } from "./support/account-page";
import { SEED_TEAM, authFileOf } from "./support/seed";
test.use({ storageState: authFileOf("owner") });
test("server chooses the sole business and offers no company switch or creation", async ({
  page,
}) => {
  // 업무 첫 화면(/dashboard)은 주소에 조직이 없다. 서버가 하나뿐인 업무 조직을 골라 그 조직으로 그린다.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(BUSINESS_DASHBOARD);
  await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "앱 사이드바" }).getByText(SEED_TEAM.name, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
  // 템플릿 대시보드는 /{slug}/dashboard 에 남아 있다(D30).
  await page.goto(`/${SEED_TEAM.slug}/dashboard`);
  await expect(page).toHaveURL(new RegExp(`/${SEED_TEAM.slug}/dashboard$`));
  await expect(
    page.getByRole("main").getByText("시드 팀의 작업 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "새 팀 만들기" })).toHaveCount(0);
  const response = await page.goto("/teams/new");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
});
