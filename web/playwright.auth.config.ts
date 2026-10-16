import { defineConfig, devices } from "@playwright/test";

// 로그인 뒤 E2E — 로컬 Supabase 의 시드 계정으로 로그인해 대시보드·작업·멤버·초대 화면을 본다.
// 실행은 `pnpm -C web test:e2e:auth` 하나다: 시드(scripts/db-seed.mjs)를 넣고 이 설정으로 돈다. 빌드(`pnpm -C web build`)가 먼저 있어야 한다.
// 로컬 Supabase 가 있어야 해서 verify·test:e2e·CI 에는 넣지 않는다(스펙 polaris/specs/done/seed-and-auth-e2e.md 2장).
//
// 기본 포트는 3200 이다(기존 E2E 는 3100). 다른 서버가 쓰고 있으면 E2E_PORT 로 바꾼다(예: E2E_PORT=3211 pnpm test:e2e:auth).
const port = Number(process.env.E2E_PORT) || 3200;
const baseURL = `http://127.0.0.1:${port}`;

// 시드는 명령 한 번에 한 번만 들어간다. 시험이 서로의 단언을 깨지 않도록 두 단계로 나눈다.
//   1단계(chromium) — 시드 팀을 읽기만 한다. 바꿔야 하면 시드 팀 밖(자기가 만든 팀)에서 바꾼다.
//   2단계(chromium-write) — 시드 팀을 바꾸는 시험(*.write.spec.ts). 1단계가 모두 끝난 뒤에 돈다.
//     자기가 만든 이름이 겹치지 않는 작업만 다루고, 초대 수락처럼 한 번뿐인 일은 이 단계의 한 시험만 한다.
const WRITE = /\.write\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e-auth",
  testMatch: /\.spec\.ts$/,
  // 기존 E2E 의 산출물(test-results·playwright-report)과 섞이지 않게 한 칸 아래에 둔다. 둘 다 깃에서 빠져 있다.
  outputDir: "test-results/auth",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/auth" }]],
  // 시드의 날짜·대시보드 수치는 서울 날짜로 센다. 브라우저도 서울에 둔다.
  use: { baseURL, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    // 역할마다 계정 화면(/account)으로 로그인해 로그인 상태를 e2e-auth/.auth/ 에 저장한다(깃에서 뺀다).
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: WRITE,
    },
    {
      name: "chromium-write",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium"],
      testMatch: WRITE,
    },
  ],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
