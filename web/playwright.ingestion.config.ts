import { defineConfig, devices } from "@playwright/test";

// N8 /admin/ingestion 로그인 뒤 E2E — N8 전용 격리 로컬 Supabase 위에서 Compose·worker·demo:preanalyze 없이 돈다.
// 실행: `pnpm -C web test:e2e:ingestion`. 같은 env 로 만든 빌드(`pnpm -C web build`)가 먼저 있어야 한다.
// globalSetup(e2e-auth/support/ingestion-setup.ts)이 대상(N8 Supabase·웹 서버 env·빌드·Redis DB 번호)을 확인한 뒤
// demo:reset 하나만 넣고 analyst 를 이 실행 동안 운영자로 켠다. 끝에 운영자 표시를 되돌리고 Redis 의 N8 키만 지운다.
// 필요한 env 목록은 ingestion-setup.ts 머리에 있다. 웹 서버(webServer)는 이 프로세스의 env 를 그대로 받는다.
// 격리 DB 를 다시 seed 하므로 verify·CI·test:e2e:auth·test:e2e:work 에는 넣지 않는다.
//
// 포트는 3210 이다(N8 Supabase 의 site_url 이 http://localhost:3210). 바꾸려면 E2E_PORT.
const port = Number(process.env.E2E_PORT) || 3210;
const hostname = "localhost";
const baseURL = `http://${hostname}:${port}`;

// 화면 상태·스크린샷은 1440×900·1280×800 두 폭에서 한 번씩 돈다(06 §12).
// 이 시험은 ingest_runs 행을 만들지 않는다(수동 수집은 Redis 에 job 만 넣는다). 그래서 두 폭이 함께 돌아도 서로의 단언을 깨지 않는다.
const desktop = (width: 1440 | 1280) => ({
  ...devices["Desktop Chrome"],
  viewport: width === 1440 ? { width: 1440, height: 900 } : { width: 1280, height: 800 },
});

export default defineConfig({
  // Shared Node tooling uses native ESM (including import.meta for checkout-root cwd).
  build: { external: ["**/scripts/local-test-target.mjs"] },
  testDir: "./e2e-auth",
  testMatch: /admin-ingestion\.spec\.ts$/,
  globalSetup: "./e2e-auth/support/ingestion-setup.ts",
  outputDir: "test-results/ingestion",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 공용 기계라 작업자를 둘로 묶는다(폭마다 하나).
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/ingestion" }]],
  // 시각은 서울로 보인다(formatKst). 브라우저도 서울에 둔다.
  use: { baseURL, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    { name: "ingestion-1440", use: desktop(1440) },
    { name: "ingestion-1280", use: desktop(1280) },
  ],
  webServer: {
    command: `pnpm start --hostname ${hostname} --port ${port}`,
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
