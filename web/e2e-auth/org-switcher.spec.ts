import { expect, test } from "@playwright/test";
import { SEED_TEAM, authFileOf } from "./support/seed";
test.use({ storageState: authFileOf("owner") });
test("server chooses the sole business and offers no company switch or creation", async ({
  page,
}) => {
  await page.goto("/dashboard");
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
