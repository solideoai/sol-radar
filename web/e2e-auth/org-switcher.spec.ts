import { expect, type Page, test } from "@playwright/test";
import { PERSONAL_ORG_NAME, SEED_TEAM, authFileOf } from "./support/seed";
import { expectTaskTitles } from "./support/tasks-page";

// 조직 전환기로 개인 공간과 시드 팀을 오간다. 소유자(김소유)는 둘 다의 owner 다. 읽기만 한다.
test.use({ storageState: authFileOf("owner") });

const openOrgSwitcher = async (page: Page) => {
  await page.getByRole("button", { name: "조직 전환" }).click();
  return page.getByRole("menu");
};

test("조직 전환기로 시드 팀에서 개인 공간으로 가고 다시 팀으로 돌아온다", async ({ page }) => {
  await page.goto(`/${SEED_TEAM.slug}/dashboard`);
  await expect(
    page.getByRole("main").getByText("시드 팀의 작업 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();

  const menu = await openOrgSwitcher(page);
  // 지금 조직에는 표시가 붙는다.
  await expect(menu.getByRole("menuitem", { name: SEED_TEAM.name })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await menu.getByRole("menuitem", { name: PERSONAL_ORG_NAME }).click();

  await expect(page).toHaveURL(/\/[a-z0-9]{8}\/dashboard$/);
  await expect(
    page.getByRole("main").getByText("내 작업의 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();
  // 개인 공간의 작업에는 시드 팀의 작업이 섞이지 않는다.
  const personalTasks = page.url().replace(/\/dashboard$/, "/tasks");
  await page.goto(personalTasks);
  await expect(page.getByRole("main").getByText("나만 보는 작업입니다.")).toBeVisible();
  await expectTaskTitles(page, ["읽을 글 고르기", "개인 메모 정리"]);

  const back = await openOrgSwitcher(page);
  await expect(back.getByRole("menuitem", { name: PERSONAL_ORG_NAME })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await back.getByRole("menuitem", { name: SEED_TEAM.name }).click();
  await expect(page).toHaveURL(new RegExp(`/${SEED_TEAM.slug}/dashboard$`));
  await expect(
    page.getByRole("main").getByText("시드 팀의 작업 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();
});
