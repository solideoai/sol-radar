import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, signInThroughForm } from "./support/account-page";
import { createTestAccount, createOwnedTeam, removeTestAccounts } from "./support/account-admin";
import { SEED_TEAM, authFileOf, uniqueTag } from "./support/seed";

// 설정의 팀 탭(/<slug>/settings/team). 팀 조직에서만 보이고, owner 는 이름 폼과 팀 삭제를, member 는 이름과 주소만 본다.
// 시드 팀은 읽기만 한다(1단계). 이름 바꾸기와 삭제 거절은 이 시험이 REST 로 만든 팀(owner 김소유)에서 하고 끝나면 지운다.
// 실제로 지우는 시험은 멤버까지 있는 팀이 필요해 따로 만든 계정으로 2단계(team-settings.write.spec.ts)에서 한다.
// 숨기는 것은 화면 요구이고, 누가 바꾸고 지우는지는 DB 정책이 강제한다(scripts/database.test.mjs).
// 스펙: polaris/specs/done/team-settings-mail-csp-errors.md 3.3, 디자인 스펙 team-settings-mail-csp-errors.design.md

const teamSettingsOf = (slug: string) => `/${slug}/settings/team`;
const settingsNavOf = (page: Page) => page.getByRole("navigation", { name: "설정 메뉴" });
const regionOf = (page: Page, name: "팀 이름" | "팀 삭제") =>
  page.getByRole("main").getByRole("region", { name, exact: true });
// getByLabel("팀 이름") 은 같은 이름의 구역(region)까지 잡는다. 입력칸은 역할로 찾는다.
const nameInputOf = (page: Page) => page.getByRole("textbox", { name: "팀 이름", exact: true });

const CONFIRM_LABEL = "확인하려면 위 팀 이름을 그대로 입력해 주세요";

// 시험만의 팀(owner 김소유)을 만들어 run 에 넘기고, 끝나면(실패해도) 지운다. 주소는 실행마다 다르다.
// 이름에는 부르는 쪽이 uniqueTag 를 붙인다 — 조직 전환기에 같은 이름이 둘 보이지 않게 한다.
const withOwnTeam = async (
  page: Page,
  name: string,
  run: (team: { name: string; slug: string }) => Promise<void>,
) => {
  const account = await createTestAccount();
  try {
    const team = await createOwnedTeam(account, name);
    await page.context().clearCookies();
    await signInThroughForm(page, account);
    await run(team);
  } finally {
    await removeTestAccounts([account]);
  }
};

test.describe("소유자(김소유)", () => {
  test.use({ storageState: authFileOf("owner") });

  test("팀 설정의 하위 메뉴는 계정·멤버·팀 순서이고, 팀 탭에는 팀 이름 폼과 팀 삭제 버튼이 있다", async ({
    page,
  }) => {
    await page.goto(`/${SEED_TEAM.slug}/settings`);
    const nav = settingsNavOf(page);
    await expect(nav.getByRole("link")).toHaveText(["계정", "멤버", "팀"]);

    await nav.getByRole("link", { name: "팀", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${teamSettingsOf(SEED_TEAM.slug)}$`));
    await expect(nav.getByRole("link", { name: "팀", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "계정", exact: true })).not.toHaveAttribute(
      "aria-current",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("설정");
    await expect(
      page.getByRole("main").getByText(`${SEED_TEAM.name}의 이름을 바꾸거나 팀을 지웁니다.`),
    ).toBeVisible();

    const nameRegion = regionOf(page, "팀 이름");
    await expect(nameInputOf(page)).toHaveValue(SEED_TEAM.name);
    await expect(nameRegion.getByText(`/${SEED_TEAM.slug}`)).toBeVisible();
    await expect(nameRegion.getByRole("button", { name: "저장" })).toBeEnabled();
    await expect(regionOf(page, "팀 삭제").getByRole("button", { name: "팀 삭제" })).toBeVisible();
  });

  test("retired creation entry is 404 for a READY business owner", async ({ page }) => {
    const response = await page.goto("/teams/new");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
    await expect(nameInputOf(page)).toHaveCount(0);
  });

  test("팀 이름을 바꾸면 저장 토스트가 뜨고, 설명 줄과 조직 표시가 새 이름이 되며, 새로 고쳐도 남고 주소는 그대로다", async ({
    page,
  }) => {
    await withOwnTeam(page, `E2E 이름 바꾸기 ${uniqueTag()}`, async (team) => {
      const renamed = `E2E 바뀐 이름 ${uniqueTag()}`;
      await page.goto(teamSettingsOf(team.slug));
      await expect(nameInputOf(page)).toHaveValue(team.name);

      // 앞뒤 공백은 떼고 저장한다.
      await nameInputOf(page).fill(`  ${renamed}  `);
      await page.getByRole("button", { name: "저장", exact: true }).click();

      await expect(page.getByText("팀 이름을 저장했습니다")).toBeVisible();
      await expect(nameInputOf(page)).toHaveValue(renamed);
      await expect(
        page.getByRole("main").getByText(`${renamed}의 이름을 바꾸거나 팀을 지웁니다.`),
      ).toBeVisible();
      const banner = page.getByRole("banner");
      await banner.getByRole("button", { name: "사이드바 여닫기" }).click();
      await expect(banner.getByText(renamed, { exact: true })).toBeVisible();

      // 저장된 효과: 새로 고쳐도 새 이름이고, 팀 주소는 바뀌지 않는다.
      await page.reload();
      await expect(nameInputOf(page)).toHaveValue(renamed);
      expect(new URL(page.url()).pathname).toBe(teamSettingsOf(team.slug));
      await expect(banner.getByText(renamed, { exact: true })).toBeVisible();
    });
  });

  test("빈 이름이나 41자 이름은 저장하지 않고, 칸 아래에 이유를 보이며 칸에 초점을 둔다", async ({
    page,
  }) => {
    await withOwnTeam(page, `E2E 이름 규칙 ${uniqueTag()}`, async (team) => {
      await page.goto(teamSettingsOf(team.slug));
      const input = nameInputOf(page);
      const cases = [
        { typed: "   ", message: "팀 이름을 입력하세요" },
        { typed: "가".repeat(41), message: "팀 이름은 40자 이하입니다" },
      ];
      for (const { typed, message } of cases) {
        await input.fill(typed);
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(regionOf(page, "팀 이름").getByText(message, { exact: true })).toBeVisible();
        await expect(input, message).toBeFocused();
        await expect(input).toHaveAttribute("aria-invalid", "true");
      }

      // 저장된 효과: 이름은 처음 그대로다.
      await page.reload();
      await expect(nameInputOf(page)).toHaveValue(team.name);
    });
  });

  test("팀 삭제 대화상자에서 팀 이름을 비우거나 틀리게 입력하면 지우지 않고, 이유를 보이며 입력칸에 초점을 돌린다", async ({
    page,
  }) => {
    await withOwnTeam(page, `E2E 삭제 거절 ${uniqueTag()}`, async (team) => {
      await page.goto(teamSettingsOf(team.slug));
      await regionOf(page, "팀 삭제").getByRole("button", { name: "팀 삭제" }).click();
      const dialog = page.getByRole("dialog", { name: "팀을 지울까요?" });
      // 무엇을 지우는지 이름과 주소로 보여 준다.
      await expect(dialog.getByText(team.name, { exact: true })).toBeVisible();
      await expect(dialog.getByText(`/${team.slug}`, { exact: true })).toBeVisible();
      const input = dialog.getByRole("textbox", { name: CONFIRM_LABEL });
      await expect(input).toBeFocused();

      const cases = [
        { typed: "", message: "팀 이름을 입력하세요" },
        { typed: "다른 팀", message: "팀 이름이 맞지 않습니다. 위 이름을 그대로 입력해 주세요" },
        // 대소문자도 정확히 같아야 한다.
        {
          typed: team.name.toLowerCase(),
          message: "팀 이름이 맞지 않습니다. 위 이름을 그대로 입력해 주세요",
        },
      ];
      for (const { typed, message } of cases) {
        await input.fill(typed);
        await dialog.getByRole("button", { name: "팀 삭제", exact: true }).click();
        await expect(dialog.getByText(message, { exact: true })).toBeVisible();
        await expect(input, typed).toBeFocused();
        await expect(input).toHaveAttribute("aria-invalid", "true");
      }

      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(dialog).toHaveCount(0);
      // 저장된 효과: 팀이 그대로 있다.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("설정");
      await expect(nameInputOf(page)).toHaveValue(team.name);
    });
  });

  test("띄어쓰기 없는 40자 팀 이름도 1280px 폭의 팀 화면에서 가로로 넘치지 않는다", async ({
    page,
  }) => {
    const longName = `E2E${uniqueTag()}`.padEnd(40, "가");
    await withOwnTeam(page, longName, async (team) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(teamSettingsOf(team.slug));
      await expect(nameInputOf(page)).toHaveValue(longName);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  });
});

test.describe("멤버(이멤버)", () => {
  test.use({ storageState: authFileOf("member") });

  test("멤버는 팀 탭에서 팀 이름과 주소만 보고, 이름을 바꾸거나 팀을 지울 입력칸·버튼이 없다", async ({
    page,
  }) => {
    await page.goto(`/${SEED_TEAM.slug}/settings`);
    const nav = settingsNavOf(page);
    await expect(nav.getByRole("link")).toHaveText(["계정", "멤버", "팀"]);
    await nav.getByRole("link", { name: "팀", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${teamSettingsOf(SEED_TEAM.slug)}$`));

    await expect(
      page
        .getByRole("main")
        .getByText(`${SEED_TEAM.name}의 정보입니다. 이름 바꾸기와 삭제는 소유자만 합니다.`),
    ).toBeVisible();
    const nameRegion = regionOf(page, "팀 이름");
    await expect(nameRegion.getByRole("term")).toHaveText(["팀 이름", "주소"]);
    await expect(nameRegion.getByRole("definition")).toHaveText([
      SEED_TEAM.name,
      `/${SEED_TEAM.slug}`,
    ]);

    const main = page.getByRole("main");
    await expect(main.getByRole("textbox")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "저장" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "팀 삭제" })).toHaveCount(0);
    await expect(regionOf(page, "팀 삭제")).toHaveCount(0);
  });
});
