import { expect, test } from "@playwright/test";
import {
  createTeamWithMember,
  createTestAccount,
  removeTestAccounts,
} from "./support/account-admin";
import { signInThroughForm } from "./support/account-page";

// owner 가 팀 이름을 입력해 팀을 지운다. 멤버까지 있는 팀이 필요한데 시드 계정을 다른 팀에 넣으면 같은 실행의 다른 시험이 깨진다.
// 그래서 owner·member 계정을 따로 만들고(support/account-admin.ts) 끝나면 지운다. 계정 수가 바뀌므로
// 계정을 세는 관리자 시험(1단계)이 끝난 뒤인 2단계에서 돈다. 이름을 틀리게 넣는 경우는 team-settings.spec.ts 가 본다.
// 스펙: polaris/specs/done/team-settings-mail-csp-errors.md 3.3·5장("팀이 지워진 뒤 다른 멤버의 화면은 다음 요청에서 404")

const NO_ORG = "조직 초대가 필요합니다";

test("소유자가 팀 이름을 입력해 지우면 조직 안내로 가서 토스트가 뜨고, 그 팀 데이터는 소유자·멤버 모두 볼 수 없다", async ({
  page,
  browser,
  baseURL,
  locale,
  timezoneId,
}) => {
  const owner = await createTestAccount();
  const member = await createTestAccount();
  // 멤버의 브라우저. 손으로 연 컨텍스트에는 설정의 use 가 붙지 않아 주소·언어·시간대를 넘긴다.
  const memberContext = await browser.newContext({ baseURL, locale, timezoneId });
  try {
    const team = await createTeamWithMember(owner, member, "E2E 삭제 팀");
    const teamDashboard = `/${team.slug}/dashboard`;
    const memberPage = await memberContext.newPage();
    await signInThroughForm(memberPage, member);
    await memberPage.goto(teamDashboard);
    await expect(memberPage.getByRole("heading", { level: 1 })).toHaveText("대시보드");

    await signInThroughForm(page, owner);
    await page.goto(`/${team.slug}/settings/team`);
    await page
      .getByRole("main")
      .getByRole("region", { name: "팀 삭제", exact: true })
      .getByRole("button", { name: "팀 삭제" })
      .click();
    const dialog = page.getByRole("dialog", { name: "팀을 지울까요?" });
    await dialog
      .getByRole("textbox", { name: "확인하려면 위 팀 이름을 그대로 입력해 주세요" })
      .fill(team.name);
    await dialog.getByRole("button", { name: "팀 삭제", exact: true }).click();

    await expect(page.getByText("팀을 지웠습니다")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/organization-state$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NO_ORG);
    await expect(page.getByText(team.name, { exact: true })).toHaveCount(0);
    // Current state takes precedence after the sole membership is deleted.
    await page.goto(teamDashboard);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NO_ORG);
    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { level: 1 })).toHaveText(NO_ORG);
    await expect(memberPage.getByText(team.name, { exact: true })).toHaveCount(0);
  } finally {
    await memberContext.close();
    await removeTestAccounts([owner, member]);
  }
});
