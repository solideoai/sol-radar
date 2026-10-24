import { defineConfig, devices } from "@playwright/test";

// C6 업무 화면(/dashboard·/bids·/bids/[id]·/notifications) 로그인 뒤 E2E — 실제 로컬 스택 위에서 돈다.
// 실행: `pnpm -C web test:e2e:work`. 빌드(`pnpm -C web build`)가 먼저 있어야 한다.
// globalSetup(e2e-auth/support/work-setup.ts)이 데모 상태를 다시 만든다: demo:reset → 모드 확인 → demo:preanalyze(18건).
// 그래서 로컬 Supabase·Compose(redis·ai-gateway mock·worker)와 웹 서버 env 가 필요하다(목록은 work-setup.ts 머리).
// 공용 로컬 DB 를 다시 seed 하므로 verify·CI·test:e2e:auth 에는 넣지 않는다.
//
// globalSetup 이 돌려준 globalTeardown 은 끝에 axe 보고를 모으고 공용 DB 를 다시 기준선(demo:reset → demo:preanalyze 18/18)으로 되돌린다.
//
// 쓰기 프로젝트(work-write)는 두 읽기 프로젝트에 의존한다(dependencies). 읽기 시험이 하나라도 실패하면 쓰기 시험은
// "did not run" 으로 건너뛰어진다 — 읽기 화면이 바뀐 데이터를 보지 않게 하려는 순서 보장이다.
// 새 쓰기 흐름도 이 의존성을 유지한다.
//
// 포트는 3200 이다(test:e2e:auth 와 같다. 둘을 동시에 돌리지 않는다). 바꾸려면 E2E_PORT.
const port = Number(process.env.E2E_PORT) || 3200;
const hostname = "localhost";
const baseURL = `http://${hostname}:${port}`;

// 화면 상태·스크린샷 spec 은 1440×900·1280×800 두 폭에서 한 번씩 돈다(06 §12). 데이터를 읽기만 한다.
const READ = /(demo-badge|run-mode-badge|no-evidence|bid-isolation|work-screens)\.spec\.ts$/;
// 데이터를 바꾸는 spec(분석 실행·결정 기록·알림 읽음·취소 공고). 읽기 spec 이 모두 끝난 뒤 한 작업자로 차례로 돈다.
// 두 폭 증거는 시험 안에서 폭을 바꿔 찍는다(같은 데이터 상태를 두 번 만들 수 없어서).
const WRITE =
  /(bid-decision|fx01-flow|notifications|what-if|p1-navigation|profile-photo)\.write\.spec\.ts$/;

const desktop = (width: 1440 | 1280) => ({
  ...devices["Desktop Chrome"],
  viewport: width === 1440 ? { width: 1440, height: 900 } : { width: 1280, height: 800 },
});

export default defineConfig({
  // Shared Node tooling uses native ESM (including import.meta for checkout-root cwd).
  build: { external: ["**/scripts/local-test-target.mjs"] },
  testDir: "./e2e-auth",
  globalSetup: "./e2e-auth/support/work-setup.ts",
  outputDir: "test-results/work",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 공용 기계라 작업자를 둘로 묶는다(무거운 검증 2개 규칙과 별개로 브라우저 수를 줄인다).
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/work" }]],
  // 시드의 날짜·D-n 은 서울 날짜로 센다. 브라우저도 서울에 둔다.
  use: { baseURL, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    // 보안 가드(L7)의 순수 함수 시험. 브라우저·데이터를 쓰지 않는다.
    { name: "work-guard", testMatch: /work-guard\.spec\.ts$/ },
    { name: "work-1440", use: desktop(1440), testMatch: READ },
    { name: "work-1280", use: desktop(1280), testMatch: READ },
    {
      name: "work-write",
      use: desktop(1440),
      testMatch: WRITE,
      dependencies: ["work-1440", "work-1280"],
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    command: `pnpm start --hostname ${hostname} --port ${port}`,
    env: { SOL_DEPLOYMENT_ROLE: "standalone" },
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
