import { expect, type Page, test } from "@playwright/test";
import {
  ENABLED_SOCIAL,
  PERSONAL_DASHBOARD,
  SETTINGS_SECTIONS,
  fillSignInForm,
  horizontalOverflow,
  sectionOf,
} from "./support/account-page";
import { SEED_ACCOUNTS, SEED_PASSWORD, SEED_TEAM, authFileOf, escapeRegExp } from "./support/seed";

// 마이페이지(/[slug]/settings 의 계정 탭)와 로그인 화면의 ?next=·?link= — 시드 계정으로 읽기만 한다.
// 로그아웃(모든 기기)·탈퇴처럼 계정을 바꾸는 일은 settings-account.write.spec.ts 가 따로 만든 계정으로 한다.
// 간편 로그인 줄은 빌드에 켠 제공자(NEXT_PUBLIC_AUTH_*)만큼 있다. 로컬 Supabase 에는 제공자를 설정하지 않아(supabase/config.toml)
// "연결"을 누르면 Supabase 가 거절한다 — 실제 OAuth 는 자동 시험 범위 밖이다(docs/AUTH-TESTING.md).
// 스펙: polaris/specs/done/social-auth-and-account.md 3·4.4·5장

const SETTINGS = `/${SEED_TEAM.slug}/settings`;
const { owner } = SEED_ACCOUNTS;

const loginMethodRows = (page: Page) => sectionOf(page, "로그인 수단").getByRole("listitem");
const pathOf = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

// 돌아온 연결 결과(?link=…)의 안내. 화면의 문구(login-methods.tsx)를 옮겨 적는다.
const LINK_FAILURES = [
  {
    outcome: "identity_already_exists",
    notice:
      "연결하려는 계정은 이미 다른 회원의 로그인 수단이라 연결하지 못했습니다. 그 회원 계정에서 연결을 해제하거나 탈퇴한 뒤 다시 시도해 주세요.",
  },
  {
    outcome: "manual_linking_disabled",
    notice:
      "지금은 로그인 수단을 연결할 수 없습니다. 운영자가 Supabase 대시보드의 Authentication → Sign In / Providers 에서 “Allow manual linking”을 켜야 합니다.",
  },
  { outcome: "failed", notice: "로그인 수단을 연결하지 못했습니다. 다시 시도해 주세요." },
] as const;

test.describe("소유자(김소유)의 마이페이지", () => {
  test.use({ storageState: authFileOf("owner") });

  test("구역이 프로필·로그인 수단·비밀번호·세션·회원 탈퇴 순서로 있고, 프로필에 이메일·계정 유형·표시 이름이 보인다", async ({
    page,
  }) => {
    await page.goto(SETTINGS);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("설정");
    await expect(
      page.getByRole("navigation", { name: "설정 메뉴" }).getByRole("link", { name: "계정" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
      ...SETTINGS_SECTIONS,
    ]);

    const profile = sectionOf(page, "프로필");
    await expect(profile.getByText(owner.name, { exact: true })).toBeVisible();
    await expect(
      profile.getByText("사진은 처음 가입한 로그인 수단의 것을 쓰며, 여기서 바꿀 수 없습니다."),
    ).toBeVisible();
    // 이메일·계정 유형(dt·dd). 조직 안 역할(소유자)이 아니라 서비스의 계정 유형(회원)이다.
    await expect(profile.getByRole("term")).toHaveText(["이메일", "계정 유형"]);
    await expect(profile.getByRole("definition")).toHaveText([owner.email, "회원"]);
    await expect(profile.getByLabel("표시 이름")).toHaveValue(owner.name);
  });

  test("로그인 수단은 이메일 한 줄과 켠 간편 로그인의 연결 버튼이고, 하나뿐이라 해제 버튼 대신 이유를 적는다", async ({
    page,
  }) => {
    await page.goto(SETTINGS);
    const section = sectionOf(page, "로그인 수단");
    // 줄의 글자: 이름 · 이메일이나 "연결되지 않음" · 버튼. 회사 표시는 장식이라 글자가 없다.
    await expect(loginMethodRows(page)).toHaveText([
      new RegExp(`^이메일${escapeRegExp(owner.email)}$`),
      ...ENABLED_SOCIAL.map((name) => new RegExp(`^${name}연결되지 않음연결$`)),
    ]);
    for (const name of ENABLED_SOCIAL) {
      await expect(
        section.getByRole("button", { name: `${name} 연결`, exact: true }),
      ).toBeEnabled();
    }
    await expect(section.getByRole("button", { name: /연결 해제$/ })).toHaveCount(0);
    await expect(section.getByText(/^로그인 수단이 하나뿐이라/)).toHaveText(
      ENABLED_SOCIAL.length > 0
        ? "로그인 수단이 하나뿐이라 해제할 수 없습니다. 다른 수단을 연결하면 해제할 수 있습니다."
        : "로그인 수단이 하나뿐이라 해제할 수 없습니다.",
    );
  });

  test("비밀번호 구역의 링크로 재설정 화면에 간다", async ({ page }) => {
    await page.goto(SETTINGS);
    const section = sectionOf(page, "비밀번호");
    await expect(
      section.getByText("가입한 이메일로 재설정 링크를 받아 새 비밀번호를 정합니다."),
    ).toBeVisible();
    await section.getByRole("link", { name: "재설정 메일 받으러 가기" }).click();
    await expect(page).toHaveURL(/\/auth\/reset$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("비밀번호 재설정");
  });

  for (const name of ENABLED_SOCIAL) {
    test(`${name} 연결을 시작하지 못하면(로컬에 제공자 설정 없음) 구역에 이유를 알리고 이 화면에 머문다`, async ({
      page,
    }) => {
      await page.goto(SETTINGS);
      const section = sectionOf(page, "로그인 수단");
      await section.getByRole("button", { name: `${name} 연결`, exact: true }).click();

      await expect(section.getByRole("alert")).toHaveText(
        new RegExp(`^${name} 연결을 시작하지 못했습니다: .+`),
      );
      expect(pathOf(page)).toBe(SETTINGS);
      // 다시 누를 수 있다. 목록은 그대로다.
      await expect(section.getByRole("button", { name: `${name} 연결`, exact: true })).toHaveText(
        "연결",
      );
      await expect(
        section.getByRole("button", { name: `${name} 연결`, exact: true }),
      ).toBeEnabled();
      await expect(loginMethodRows(page)).toHaveCount(1 + ENABLED_SOCIAL.length);
    });
  }

  for (const { outcome, notice } of LINK_FAILURES) {
    test(`연결하러 갔다 ?link=${outcome} 로 돌아오면 구역 위 안내가 초점을 받고, 주소에서 link 가 지워진다`, async ({
      page,
    }) => {
      await page.goto(`${SETTINGS}?link=${outcome}`);
      const message = sectionOf(page, "로그인 수단").getByText(notice, { exact: true });
      await expect(message).toBeVisible();
      await expect(message).toBeFocused();
      // 새로 고쳐도 다시 나오지 않게 주소에서 지운다. 안내 글자는 이 화면에 남는다.
      await expect.poll(() => pathOf(page)).toBe(SETTINGS);
      await expect(message).toBeVisible();

      await page.reload();
      await expect(sectionOf(page, "로그인 수단").getByRole("listitem").first()).toBeVisible();
      await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
    });
  }

  test("연결하고 ?link=linked 로 돌아오면 연결했다고 알리고, 구역 제목에 초점을 두고, 주소에서 link 가 지워진다", async ({
    page,
  }) => {
    await page.goto(`${SETTINGS}?link=linked`);
    await expect(page.getByText("로그인 수단을 연결했습니다", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("heading", { level: 2, name: "로그인 수단" }),
    ).toBeFocused();
    await expect.poll(() => pathOf(page)).toBe(SETTINGS);
    // 실패 안내는 없다.
    for (const { notice } of LINK_FAILURES) {
      await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
    }
  });

  for (const width of [375, 1280]) {
    test(`${width}px 폭에서 마이페이지가 가로로 넘치지 않는다(긴 연결 안내가 있어도)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(SETTINGS);
      await expect(
        sectionOf(page, "회원 탈퇴").getByRole("button", { name: "회원 탈퇴" }),
      ).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);

      // 가장 긴 안내(설정법)가 구역 위에 뜬 상태.
      await page.goto(`${SETTINGS}?link=manual_linking_disabled`);
      await expect(sectionOf(page, "로그인 수단").getByText(LINK_FAILURES[1].notice)).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});

test.describe("로그아웃한 사람의 로그인 화면", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const ownerLogin = { email: owner.email, password: SEED_PASSWORD };

  test("?next= 의 사이트 안 경로로 로그인하면 그 화면으로 간다", async ({ page }) => {
    const next = `/${SEED_TEAM.slug}/tasks`;
    await fillSignInForm(page, ownerLogin, `/auth/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(next)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("작업");
  });

  for (const next of ["https://evil.example", "//evil.example", "/auth/sign-up"]) {
    test(`?next=${next} 는 버리고 개인 대시보드로 간다`, async ({ page, baseURL }) => {
      await fillSignInForm(page, ownerLogin, `/auth/login?next=${encodeURIComponent(next)}`);
      await expect(page).toHaveURL(PERSONAL_DASHBOARD);
      expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? "").origin);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("대시보드");
    });
  }

  test("?link=suspended 로 오면 정지된 계정이라 로그인할 수 없다고 알린다", async ({ page }) => {
    await page.goto("/auth/login?link=suspended");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("로그인");
    await expect(page.getByRole("alert").filter({ hasText: "정지된 계정" })).toHaveText(
      "정지된 계정이라 로그인할 수 없습니다. 운영자에게 문의해 주세요.",
    );
    // 안내만 더하고 로그인 폼은 그대로다.
    await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
  });
});
