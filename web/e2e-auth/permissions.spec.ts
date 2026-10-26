import { expect, type Page, test } from "@playwright/test";
import { SEED_ACCOUNTS, SEED_TEAM, authFileOf, escapeRegExp } from "./support/seed";

// 같은 팀이라도 역할에 따라 보이는 메뉴가 다르다. 숨기는 것은 화면 요구이고 권한은 DB 정책이 강제한다 —
// 여기서는 사람이 보는 결과(메뉴 항목·관리 카드가 있는지)만 본다. 메뉴는 열어 보기만 하고 누르지 않는다(시드 팀을 바꾸지 않는다).

const TASKS = `/${SEED_TEAM.slug}/tasks`;
const MEMBERS = `/${SEED_TEAM.slug}/settings/members`;

// 작업 줄의 관리 메뉴(⋯)를 열고 그 메뉴를 돌려준다.
const openTaskMenu = async (page: Page, title: string) => {
  await page.getByRole("button", { name: `${title} 관리`, exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "편집" })).toBeVisible();
  return menu;
};

test.describe("멤버(이멤버)", () => {
  test.use({ storageState: authFileOf("member") });

  test("남이 만든 작업의 관리 메뉴에는 삭제가 없고, 자기가 만든 작업에는 있다", async ({
    page,
  }) => {
    await page.goto(TASKS);

    // 분기 보고서 초안 — 소유자가 만들었다.
    const othersMenu = await openTaskMenu(page, "분기 보고서 초안");
    await expect(othersMenu.getByRole("menuitem", { name: "삭제" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(othersMenu).toHaveCount(0);

    // 고객 인터뷰 정리 — 멤버 자신이 만들었다.
    const ownMenu = await openTaskMenu(page, "고객 인터뷰 정리");
    await expect(ownMenu.getByRole("menuitem", { name: "삭제" })).toBeVisible();
  });

  test("멤버 설정 화면에는 초대·역할 변경·내보내기 같은 관리 메뉴가 없다", async ({ page }) => {
    await page.goto(MEMBERS);
    await expect(
      page.getByRole("main").getByText("시드 팀의 멤버입니다. 초대와 역할 변경은 소유자만 합니다."),
    ).toBeVisible();

    // 줄의 글자: 아바타 머리글자 · 이름 · (나) · 이메일 · 역할.
    const { owner, member } = SEED_ACCOUNTS;
    const members = page.getByRole("table", { name: "멤버" });
    await expect(members.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText([
      new RegExp(`${owner.name}${escapeRegExp(owner.email)}소유자$`),
      new RegExp(`${member.name}\\(나\\)${escapeRegExp(member.email)}멤버$`),
    ]);
    await expect(page.getByRole("heading", { name: "초대하기" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "대기 중인 초대" })).toHaveCount(0);
    // 본문(main)에서만 센다. 사이드바·위 막대의 메뉴는 이 시험의 대상이 아니다.
    // 회원 관리 버튼이 본문에 있다는 것은 소유자 시험이 같은 범위로 확인한다.
    await expect(page.getByRole("main").getByRole("button", { name: / 관리$/ })).toHaveCount(0);
    // 나가기는 멤버도 할 수 있다.
    await expect(page.getByRole("heading", { name: "팀 나가기" })).toBeVisible();
    // 조직 전환기의 둘째 줄이 역할을 알려 준다.
    await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
  });
});

test.describe("소유자(김소유)", () => {
  test.use({ storageState: authFileOf("owner") });

  test("남(멤버)이 만든 작업도 관리 메뉴에 삭제가 있다", async ({ page }) => {
    await page.goto(TASKS);
    const menu = await openTaskMenu(page, "고객 인터뷰 정리");
    await expect(menu.getByRole("menuitem", { name: "삭제" })).toBeVisible();
  });

  test("멤버 설정 화면에 초대 폼·멤버 관리 메뉴·대기 중인 초대가 있다", async ({ page }) => {
    await page.goto(MEMBERS);
    await expect(
      page.getByRole("main").getByText("시드 팀의 멤버를 초대하고 역할을 관리합니다."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "초대하기" })).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByRole("button", { name: `${SEED_ACCOUNTS.member.name} 관리`, exact: true }),
    ).toBeVisible();
    // 초대받은 사람은 아직 수락하지 않았다(수락은 invitation.write.spec.ts 가 이 시험 뒤에 한다).
    const invitations = page.getByRole("table", { name: "대기 중인 초대" });
    await expect(invitations.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText([
      new RegExp(`^${escapeRegExp(SEED_ACCOUNTS.invitee.email)}`),
    ]);
    await expect(page.getByRole("button", { name: "조직 전환" })).toHaveCount(0);
  });
});
