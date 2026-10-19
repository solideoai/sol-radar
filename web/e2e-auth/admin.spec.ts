import { expect, type Page, test } from "@playwright/test";
import {
  cellsOf,
  expectDialogFitsWidth,
  expectListFitsWidth,
  expectRowCells,
  type ListedUser,
  rowText,
  today,
  userRowOf,
  userRows,
  usersTable,
} from "./support/admin-page";
import { BUSINESS_DASHBOARD } from "./support/account-page";
import { SEED_ACCOUNTS, SEED_ROLES, type SeedRole, authFileOf } from "./support/seed";

// 관리자 화면(/admin) — 시드 운영자(정운영)는 사용자 목록·검색·쪽을 보고, 운영자가 아닌 시드 계정과 로그아웃한 사람에게는 404 다.
// 운영자에게만 사용자 메뉴에 관리자 링크가 있다. 화면이 쓰는 일은 회원 정지·해제 하나다 — 이 시험은 읽기만 하고
// (정지 대화상자는 열었다가 취소만 한다), 정지·해제는 admin-status.write.spec.ts 가 2단계에 시험 안에서 만든 계정으로 한다.
// 전체 사용자 수는 로컬 DB 마다 다르다(손으로 만든 계정). 고정된 수·순서는 시드 계정만 걸리는 검색어(seed-)로 보고,
// 전체 목록은 머리 줄의 수에서 쪽 수를 계산해 본다. 계정을 만드는 시험(admin-status.write)은 2단계라 이 시험이 도는 동안 수가 바뀌지 않는다.
// 스펙: polaris/specs/done/google-login-and-admin.md 3.4·4.2·5장, polaris/specs/done/social-auth-and-account.md 4.4

const SEED_SEARCH = "seed-";
const PAGE_SIZE = 20;
// 최근 가입 순 — 시드가 만든 순서의 거꾸로다(운영자가 맨 위).
const NEWEST_FIRST: readonly SeedRole[] = [...SEED_ROLES].reverse();
const NON_ADMIN_ROLES = SEED_ROLES.filter((role) => role !== "admin");

// 시드 계정이 목록에 보이는 모양. 운영자(정운영)가 보는 화면이라 운영자 줄이 나다. 시드 계정은 아무도 정지돼 있지 않다.
const listedSeed = (role: SeedRole): ListedUser => ({
  name: SEED_ACCOUNTS[role].name,
  email: SEED_ACCOUNTS[role].email,
  isMe: role === "admin",
  isAdmin: role === "admin",
});
const rowPattern = (role: SeedRole): RegExp => rowText(listedSeed(role));

// 검색·쪽이 바뀌면 화면 낭독기에 읽어 주는 글. 예: "사용자 5명 중 1–5번째를 보여 줍니다."
const listStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^(사용자 \d|검색 결과|가입한 사용자)/ });

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "검색" });
const pager = (page: Page) => page.getByRole("navigation", { name: "쪽 이동" });
const queryOf = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);

const expectEmptySearch = async (page: Page) => {
  await expect(page.getByText("검색 결과가 없습니다", { exact: true })).toBeVisible();
  await expect(listStatus(page)).toHaveText("검색 결과가 없습니다.");
  await expect(page.getByText("0명", { exact: true })).toBeVisible();
  await expect(userRows(page)).toHaveCount(0);
  await expect(pager(page)).toHaveCount(0);
};

test.describe("운영자(정운영)", () => {
  test.use({ storageState: authFileOf("admin") });

  test("시드 계정을 최근 가입 순으로 보이고, 표시 이름·이메일·계정 유형·상태·가입일과 자기 줄을, 회원 줄에만 정지 버튼을 둔다", async ({
    page,
  }) => {
    const response = await page.goto(`/admin?q=${SEED_SEARCH}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("사용자 관리");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("사용자 관리");
    // 로그인 뒤 화면처럼 검색에 올리지 않는다.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(searchBox(page)).toHaveValue(SEED_SEARCH);
    await expect(listStatus(page)).toHaveText("사용자 5명 중 1–5번째를 보여 줍니다.");
    await expect(page.getByText("5명", { exact: true })).toBeVisible();
    await expect(userRows(page)).toHaveText(NEWEST_FIRST.map(rowPattern));
    // 관리 칸의 머리는 화면 낭독기에만 읽힌다(sr-only).
    await expect(usersTable(page).getByRole("columnheader")).toHaveText([
      "사용자",
      "계정 유형",
      "상태",
      "가입일",
      "관리",
    ]);
    // 나(운영자) 줄에는 정지 버튼이 없다. 회원 줄의 버튼은 누구를 정지하는지 이름으로 읽힌다.
    for (const role of NEWEST_FIRST) {
      await expectRowCells(userRowOf(page, SEED_ACCOUNTS[role].email), listedSeed(role));
    }

    // 쪽이 하나여도 쪽 줄은 있다. 이전·다음은 꺼진 단추다(링크가 아니다).
    await expect(pager(page).getByRole("button", { name: "이전" })).toBeDisabled();
    await expect(pager(page).getByRole("button", { name: "다음" })).toBeDisabled();
    await expect(page.getByText("1쪽 중 1쪽")).toBeAttached();
  });

  test("표시 이름·이메일의 일부로 대소문자 없이 찾고, 특수 글자는 글자 그대로 찾는다", async ({
    page,
  }) => {
    await page.goto("/admin");

    // 표시 이름 일부. Enter 로 검색하면 주소에 남고 쪽은 1이다.
    await searchBox(page).fill("김소");
    await searchBox(page).press("Enter");
    await expect.poll(() => queryOf(page, "q")).toBe("김소");
    await expect(userRows(page)).toHaveText([rowPattern("owner")]);
    // 검색한 뒤에도 초점은 입력칸에 남는다(이어서 고쳐 친다).
    await expect(searchBox(page)).toBeFocused();

    // 이메일 일부, 대문자로. 검색 단추로도 된다.
    await searchBox(page).fill("SEED-ADMIN");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect.poll(() => queryOf(page, "q")).toBe("SEED-ADMIN");
    await expect(userRows(page)).toHaveText([rowPattern("admin")]);

    // 질의 문법으로 읽히면 결과가 생기는 검색어들 — _ 와 % 는 ilike 의 아무 글자, * 는 PostgREST 가 % 로 바꾸고,
    // , ( ) 는 or 조건을 나눈다. 글자 그대로 찾으면 어느 시드 계정과도 맞지 않는다.
    for (const q of ["seed_owner", "%", "seed-o*", "seed-%", "a,email.ilike.*", "(", "\\"]) {
      const response = await page.goto(`/admin?q=${encodeURIComponent(q)}`);
      expect(response?.status(), q).toBe(200);
      await expect(searchBox(page)).toHaveValue(q);
      await expectEmptySearch(page);
    }

    // 검색 지우기 — 전체 목록으로 가고, 입력칸을 비워 초점을 둔다.
    await page.getByRole("link", { name: "검색 지우기" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
    await expect(page.getByRole("link", { name: "검색 지우기" })).toHaveCount(0);
    await expect(userRows(page).first()).toBeVisible();
  });

  test("전체 목록은 20명씩 쪽을 나누고, 범위를 넘거나 잘못된 쪽은 첫 쪽을 보여 준다", async ({
    page,
  }) => {
    await page.goto("/admin");
    const totalText = await page.getByText(/^\d+명$/).textContent();
    const total = Number(totalText?.replace("명", ""));
    // 시드 계정 다섯은 늘 있다.
    expect(total).toBeGreaterThanOrEqual(5);
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const firstPageRows = Math.min(PAGE_SIZE, total);

    await expect(userRows(page)).toHaveCount(firstPageRows);
    await expect(listStatus(page)).toHaveText(
      `사용자 ${total}명 중 1–${firstPageRows}번째를 보여 줍니다.`,
    );
    await expect(page.getByText(`${pageCount}쪽 중 1쪽`)).toBeAttached();
    // 맨 위는 가장 최근에 가입한 시드 운영자다.
    await expect(userRows(page).first()).toHaveText(rowPattern("admin"));

    for (const requested of ["999", "abc", "0", "-1"]) {
      await page.goto(`/admin?page=${requested}`);
      await expect(page.getByText(`${pageCount}쪽 중 1쪽`), requested).toBeAttached();
      await expect(userRows(page)).toHaveCount(firstPageRows);
    }

    // 마지막 쪽은 남은 사람만큼이다.
    await page.goto(`/admin?page=${pageCount}`);
    await expect(page.getByText(`${pageCount}쪽 중 ${pageCount}쪽`)).toBeAttached();
    await expect(userRows(page)).toHaveCount(total - PAGE_SIZE * (pageCount - 1));
    await expect(pager(page).getByRole("button", { name: "다음" })).toBeDisabled();
  });

  test("platform admin with no business membership retains admin access and returns through state", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("사용자 관리");
    await page.getByRole("link", { name: "앱으로 돌아가기" }).click();
    await expect(page).toHaveURL(/\/auth\/organization-state$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("조직 초대가 필요합니다");
  });

  // 칸을 숨기는 기준은 화면이 아니라 카드의 폭이다(@container). 계정 유형·상태 칸은 @xl(576px), 가입일 칸은 @2xl(672px)부터 있다.
  // 카드 폭 = 화면 폭 − 본문 좌우 여백(640px 미만 16px, 1024px 미만 24px, 그 위 32px, 최대 1024px):
  // 320·375px 은 좁은 단(288·343), 640px 은 가운데 단(592), 768·1280px 은 넓은 단(720·1024)이다.
  const LAYOUTS = [
    { width: 320, layout: "narrow" },
    { width: 375, layout: "narrow" },
    { width: 640, layout: "middle" },
    { width: 768, layout: "wide" },
    { width: 1280, layout: "wide" },
  ] as const;
  const LAYOUT_TEXT = {
    narrow: "계정 유형·상태·가입일 칸 대신 사용자 칸의 셋째 줄에 계정 유형과 가입일을 적는다",
    middle: "계정 유형·상태 칸이 생기고 가입일만 사용자 칸의 셋째 줄에 적는다",
    wide: "계정 유형·상태·가입일을 모두 칸에 적고 셋째 줄이 없다",
  } as const;

  for (const { width, layout } of LAYOUTS) {
    test(`${width}px 폭에서 목록과 정지 대화상자가 가로로 넘치지 않고, ${LAYOUT_TEXT[layout]}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/admin?q=${SEED_SEARCH}`);
      await expect(userRows(page)).toHaveCount(SEED_ROLES.length);
      await expectListFitsWidth(page);

      const hasTypeAndStatus = layout !== "narrow";
      const hasJoinedColumn = layout === "wide";
      const table = usersTable(page);
      await expect(table.getByRole("columnheader", { name: "계정 유형" })).toBeVisible({
        visible: hasTypeAndStatus,
      });
      await expect(table.getByRole("columnheader", { name: "상태" })).toBeVisible({
        visible: hasTypeAndStatus,
      });
      await expect(table.getByRole("columnheader", { name: "가입일" })).toBeVisible({
        visible: hasJoinedColumn,
      });
      await expect(table.getByRole("columnheader", { name: "관리" })).toBeAttached();

      // 셋째 줄: 좁은 단은 "운영자 · 가입 날짜", 가운데 단은 "가입 날짜"(계정 유형은 칸에 있다), 넓은 단은 없다.
      const adminRow = userRowOf(page, SEED_ACCOUNTS.admin.email);
      await expect(adminRow.getByText(`가입 ${today}`)).toBeVisible({ visible: !hasJoinedColumn });
      await expect(adminRow.getByText("운영자 ·")).toBeVisible({ visible: !hasTypeAndStatus });
      const adminCells = cellsOf(adminRow);
      await expect(adminCells.nth(1)).toBeVisible({ visible: hasTypeAndStatus });
      await expect(adminCells.nth(2)).toBeVisible({ visible: hasTypeAndStatus });
      await expect(adminCells.nth(3)).toBeVisible({ visible: hasJoinedColumn });

      // 관리 칸은 어느 폭에서나 있고, 회원 줄의 정지 버튼은 화면 안에 다 보인다.
      const { owner } = SEED_ACCOUNTS;
      const suspend = page.getByRole("button", { name: `${owner.name} 정지`, exact: true });
      await expect(suspend).toBeInViewport({ ratio: 1 });

      // 정지 대화상자는 열어서 화면 안에 들어오는지만 보고 취소한다. 취소하면 아무것도 바뀌지 않는다.
      await suspend.click();
      const dialog = page.getByRole("dialog", { name: `${owner.name} 님을 정지할까요?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(owner.email);
      await expectDialogFitsWidth(page, dialog);
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(suspend).toBeFocused();
      await page.reload();
      await expectRowCells(userRowOf(page, owner.email), listedSeed("owner"));
    });
  }
});

for (const role of NON_ADMIN_ROLES) {
  test.describe(`운영자가 아닌 ${SEED_ACCOUNTS[role].name}(${role})`, () => {
    test.use({ storageState: authFileOf(role) });

    test("/admin 은 404 이고 사용자 목록이 보이지 않는다", async ({ page }) => {
      const response = await page.goto(`/admin?q=${SEED_SEARCH}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
      await expect(page.getByText("사용자 관리")).toHaveCount(0);
      await expect(page.getByText(SEED_ACCOUNTS.admin.email)).toHaveCount(0);
    });

    test("사용자 메뉴에 관리자 링크가 없다", async ({ page }) => {
      await page.goto("/auth/login");
      if (role === "outsider" || role === "invitee") {
        await expect(page).toHaveURL(/\/auth\/organization-state$/);
        await expect(page.getByRole("link", { name: "관리자", exact: true })).toHaveCount(0);
        return;
      }
      await expect(page).toHaveURL(BUSINESS_DASHBOARD);
      await page.getByRole("button", { name: "사용자 메뉴" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "설정" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "관리자" })).toHaveCount(0);
    });
  });
}

test.describe("로그아웃한 사람", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/admin 은 로그인 안내가 아니라 404 다(관리자 화면이 있는지 알리지 않는다)", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
    await expect(page.getByText("로그인이 필요합니다")).toHaveCount(0);
  });
});
