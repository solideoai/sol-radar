import { expect, test } from "@playwright/test";

// 공개 경로가 데스크톱 확인 폭(1280·1440px)에서 가로로 넘치지 않는지 본다.
// 화면은 데스크톱 1280px 이상만 지원하고 모바일 폭은 확인하지 않는다(docs/16-DECISIONS.md ADR-007).
// 첫 화면(/)은 여기서 재지 않는다. 1280·1440·1920px 넘침은 landing.spec.ts 가 본다.
// 공개 경로를 새로 만들면 이 목록에 더한다.
// 로그인이 필요한 경로(/[slug]/...·/teams/new·/invitations)는 로그인 없이 열어, 앱 틀 대신 나오는 안내 화면을 잰다.
// 로그인 전에는 조직이 있는지 묻지 않고 안내부터 그리므로 조직 주소(slug)는 아무것이나 쓴다.
// 옛 주소(/dashboard·/memos·/settings)는 로그인 전이면 /auth/login 으로 보내므로 따로 재지 않는다.
// 한 마디 주소(/<이름>)는 조직 주소라 404 가 아니다. 없는 주소는 조직 아래의 없는 화면으로 쓴다.
// 관리자 화면(/admin)은 로그인 전이면 404 화면이다. 운영자로 본 화면의 넘침은 로그인 E2E(e2e-auth/admin.spec.ts)가 잰다.
const PATHS = [
  "/auth/login",
  "/auth/sign-up",
  "/auth/reset",
  "/auth/password",
  "/acme/dashboard",
  "/acme/tasks",
  "/acme/settings",
  "/acme/settings/members",
  "/acme/settings/team",
  "/teams/new",
  "/invitations",
  "/admin",
  "/acme/route-that-does-not-exist",
];
const WIDTHS = [1280, 1440];

PATHS.forEach((path) =>
  WIDTHS.forEach((width) =>
    test(`${path} 는 ${width}px 폭에서 가로로 넘치지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    }),
  ),
);
