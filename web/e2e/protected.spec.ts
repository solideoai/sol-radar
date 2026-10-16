import { expect, test } from "@playwright/test";
import { watchSupabase } from "./watch-supabase";

// 로그인 뒤 화면을 로그인 없이 본다. 로그인한 뒤의 화면은 로컬 Supabase 로 손으로 확인한다(CI 에는 DB 가 없다).
// 앱 틀 안의 화면(/[slug]/...)은 로그인 전이면 앱 틀(사이드바·위 막대)과 화면 대신 안내 카드를 그린다.
// 로그인 전에는 조직이 있는지 묻지 않고 안내부터 그리므로 조직 주소(slug)는 아무것이나 쓴다.
// 지금 조직이 필요 없는 화면(/teams/new·/invitations)은 인증 틀에서 같은 안내를 그린다.
// DB 설정이 없으면 연결이 없다고 알리고, 있으면(CI 는 가짜 주소) 로그인이 필요하다고 알린다.
// 어느 쪽이든 계정 화면으로 가는 링크를 보이고, 화면을 열기만 해서는 Supabase 에 요청하지 않는다. 작업 화면은 tasks.spec.ts 가 본다.
const SLUG = "acme";
const GUIDES = [
  { heading: "로그인이 필요합니다", link: "로그인하러 가기" },
  { heading: "DB 가 연결되지 않았습니다", link: "계정 화면으로 가기" },
];
const GUIDE_HEADING = new RegExp(`^(${GUIDES.map(({ heading }) => heading).join("|")})$`);
const ACCOUNT_HEADING = /^(로그인|DB 가 연결되지 않았습니다)$/;

// content 는 로그인한 사람에게만 보이는 것 — 화면 제목과 그 화면의 구역 제목들이다.
const SCREENS = [
  {
    path: `/${SLUG}/dashboard`,
    content: ["대시보드", "최근 14일", "기한이 가까운 작업", "최근 활동"],
  },
  { path: `/${SLUG}/settings`, content: ["설정", "프로필", "비밀번호", "세션"] },
  { path: `/${SLUG}/settings/members`, content: ["설정", "멤버", "초대하기"] },
  { path: "/teams/new", content: ["새 팀 만들기"] },
  { path: "/invitations", content: ["받은 초대"] },
];

SCREENS.forEach(({ path, content }) => {
  test(`${path} 는 로그인 전 상태를 오류 없이 그리고, 열기만 해서는 Supabase 에 요청하지 않는다`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const supabaseRequests = watchSupabase(page);
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: GUIDE_HEADING })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    expect(supabaseRequests).toEqual([]);
  });

  test(`로그인하지 않고 ${path} 를 열면 앱 틀과 화면 내용 없이 계정 화면으로 가는 링크를 보여 준다`, async ({
    page,
  }) => {
    await page.goto(path);
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText(GUIDE_HEADING);
    // 앱 틀의 위 막대는 어느 폭에서나 사이드바 여닫기 버튼을 그린다. 안내 화면에는 없어야 한다.
    await expect(page.getByRole("button", { name: "사이드바 여닫기" })).toHaveCount(0);
    for (const name of content) {
      await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
    }
    // 링크의 이름은 안내 제목과 짝이다 — 로그인 전이면 로그인하러, DB 가 없으면 계정 화면의 안내로.
    const titleText = await title.textContent();
    const guide = GUIDES.find(({ heading }) => heading === titleText);
    if (!guide) throw new Error(`안내 제목이 아니다: ${titleText}`);
    const link = page.getByRole("link", { name: guide.link, exact: true });
    await expect(link).toHaveAttribute("href", "/auth/login");
    await link.click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ACCOUNT_HEADING);
  });
});

// 로그인 전에는 조직이 있는지 묻지 않고 안내(200)를 그려서 없는 한 마디 주소도 안내 화면이 된다.
// 검색 로봇이 정상 페이지로 모으지 않게(soft 404) 조직 틀은 색인하지 말라고 알린다.
[`/${SLUG}/dashboard`, "/route-that-does-not-exist"].forEach((path) =>
  test(`${path} 는 로그인 전 안내 화면을 검색 로봇이 색인하지 않게 한다`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }),
);

// 조직이 주소에 들어가기 전의 옛 주소는 서버가 판정한 업무 조직의 같은 화면으로 보낸다(조직 견본 스펙 4.3).
// 메모 화면은 없어져 옛 /memos 는 그 자리를 이은 작업 화면(/<서버가 판정한 업무 조직>/tasks)으로 보낸다(작업 견본 스펙 4.4).
// 로그인 전이거나 DB 가 없으면 갈 서버가 판정한 업무 조직이 없어 계정 화면으로 보낸다.
["/dashboard", "/memos", "/settings"].forEach((path) =>
  test(`옛 주소 ${path} 는 로그인 전이면 계정 화면으로 보낸다`, async ({ page }) => {
    const response = await page.goto(path);
    // 화면을 그린 뒤 옮기는 것이 아니라 서버가 바로 보낸다.
    expect(response?.request().redirectedFrom()?.url()).toMatch(new RegExp(`${path}$`));
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ACCOUNT_HEADING);
  }),
);
