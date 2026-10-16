import { expect, test } from "@playwright/test";
import { SEED_ACCOUNTS, SEED_TEAM, authFileOf, escapeRegExp } from "./support/seed";

// 초대받은 사람(최초대)이 받은 초대 화면에서 시드 팀 초대를 수락해 팀에 들어온다.
// 시드의 초대는 하나뿐이고 수락하면 시드 팀의 멤버·활동이 바뀐다. 그래서 2단계(시드를 읽는 시험이 끝난 뒤)에서 이 시험 하나만 한다.
// 다시 돌리면 `pnpm db:seed` 가 초대를 다시 만든다.
test.use({ storageState: authFileOf("invitee") });

const { invitee } = SEED_ACCOUNTS;

test("받은 초대를 수락하면 시드 팀의 대시보드로 가고, 팀의 멤버가 되며, 받은 초대가 비어 있다", async ({
  page,
}) => {
  await page.goto("/auth/organization-state");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("조직 초대가 필요합니다");
  await page.getByRole("link", { name: "받은 초대 보기" }).click();

  await expect(page).toHaveURL(/\/invitations$/);
  await expect(page.getByRole("heading", { level: 1, name: "받은 초대" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText(`${invitee.email} 으로 받은 초대입니다.`),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: SEED_TEAM.name })).toBeVisible();
  await expect(page.getByRole("main").getByText("멤버로 초대받았습니다.")).toBeVisible();

  await page.getByRole("button", { name: `수락 ${SEED_TEAM.name} 초대`, exact: true }).click();

  await expect(page.getByText(`${SEED_TEAM.name}에 들어왔습니다`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${SEED_TEAM.slug}/dashboard$`));
  await expect(
    page.getByRole("main").getByText("시드 팀의 작업 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
  // 들어오자마자 팀의 작업이 보인다.
  await expect(
    page.getByRole("table", { name: "기한이 가까운 작업" }).getByText("분기 보고서 초안"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "최근 활동" })
      .getByText(`${invitee.name} 님이 팀에 들어왔습니다.`),
  ).toBeVisible();
  // 남은 초대가 없어 사이드바의 받은 초대 항목이 사라진다.
  await expect(page.getByRole("link", { name: "받은 초대", exact: true })).toHaveCount(0);

  // 저장된 효과: 새로 연 멤버 화면에 내가 멤버로 있고, 받은 초대 화면은 비어 있다.
  await page.goto(`/${SEED_TEAM.slug}/settings/members`);
  await expect(
    page.getByRole("table", { name: "멤버" }).getByRole("row").filter({ hasText: invitee.email }),
  ).toHaveText(new RegExp(`${invitee.name}\\(나\\)${escapeRegExp(invitee.email)}멤버$`));

  await page.goto("/invitations");
  await expect(page.getByRole("main").getByText("받은 초대가 없습니다")).toBeVisible();
});
