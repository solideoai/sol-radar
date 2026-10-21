import { defineConfig, devices } from "@playwright/test";

// 부처 지원사업 공고 /bids/programs 로그인 뒤 E2E — 전용 격리 로컬 Supabase 위에서 Compose·worker 컨테이너·demo:preanalyze 없이 돈다.
// 실행: `pnpm -C web test:e2e:programs`. 같은 env 로 만든 빌드(`pnpm -C web build`)가 먼저 있어야 한다.
// globalSetup(e2e-auth/support/programs-setup.ts)이 대상(격리 Supabase·웹 서버 env·빌드)을 확인한 뒤
// demo:reset 하나를 넣고, program_notices 를 비운 다음 중기부 녹음을 worker 등록 함수(mock 모드)로 한 번 적재한다.
// 필요한 env 목록은 programs-setup.ts 머리에 있다(PROGRAMS_SUPABASE_WORKDIR·NEXT_PUBLIC_SUPABASE_URL·
// NEXT_PUBLIC_SUPABASE_ANON_KEY·API_CURSOR_SECRET·SOL_RUN_MODE=fixture, SUPABASE_SERVICE_ROLE_KEY 는 넣지 않는다).
// 웹 서버(webServer)는 이 프로세스의 env 를 그대로 받는다.
// 격리 DB 를 다시 seed 하므로 verify·CI·test:e2e:auth·test:e2e:work·test:e2e:ingestion 에는 넣지 않는다.
//
// 포트는 3230 이다(격리 Supabase 의 site_url 이 http://localhost:3230). 바꾸려면 E2E_PORT.
const port = Number(process.env.E2E_PORT) || 3230;
const hostname = "localhost";
const baseURL = `http://${hostname}:${port}`;

// 화면 상태·스크린샷은 1440×900·1280×800 두 폭에서 한 번씩 돈다(06 §12, 디자인 스펙 §11).
// 이 시험은 읽기만 한다(부처 공고 적재는 globalSetup 이 한 번 한다). 그래서 두 폭이 함께 돌아도 서로의 단언을 깨지 않는다.
const desktop = (width: 1440 | 1280) => ({
  ...devices["Desktop Chrome"],
  viewport: width === 1440 ? { width: 1440, height: 900 } : { width: 1280, height: 800 },
});

export default defineConfig({
  // Shared Node tooling uses native ESM (including import.meta for checkout-root cwd).
  build: { external: ["**/scripts/local-test-target.mjs"] },
  testDir: "./e2e-auth",
  testMatch: /program-notices\.spec\.ts$/,
  globalSetup: "./e2e-auth/support/programs-setup.ts",
  outputDir: "test-results/programs",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 공용 기계라 작업자를 둘로 묶는다(폭마다 하나).
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/programs" }]],
  // 날짜는 서울로 보인다(kstDate·D-n). 브라우저도 서울에 둔다.
  use: { baseURL, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    { name: "programs-1440", use: desktop(1440) },
    { name: "programs-1280", use: desktop(1280) },
  ],
  webServer: {
    command: `pnpm start --hostname ${hostname} --port ${port}`,
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
