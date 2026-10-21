import { defineConfig, devices } from "@playwright/test";

// S5 공고 변경 감지(/bids/[id]/revisions) 로그인 뒤 E2E — 격리 로컬 스택 위에서 돈다(19 S5, 화면 스펙
// docs/plans/2026-10-21-s5-revisions-ui-spec.md §4.7·§7·§10). 실행: `pnpm -C web test:e2e:s5`.
// 같은 env 로 만든 빌드(`pnpm -C web build`)가 먼저 있어야 한다.
//
// globalSetup 은 C6 업무 E2E 와 같은 support/work-setup.ts 다: demo:reset → 모드 확인 → demo:preanalyze(18건),
// 끝에 같은 기준선으로 되돌린다. 그래서 격리 Supabase·격리 Compose(redis·minio·ai-gateway mock·worker)와
// 웹 서버 env 가 필요하다(목록은 work-setup.ts 머리). 수동 수집 job 은 그 Compose worker 가 소비한다
// (웹 서버의 REDIS_URL 이 그 redis 다). 공용 로컬 DB(54321)·클라우드에는 쓰지 않는다:
// SOL_RADAR_TEST_SUPABASE_WORKDIR·SOL_RADAR_TEST_SUPABASE_API_URL 로 격리 Supabase 를 가리키고,
// COMPOSE_PROJECT_NAME 으로 격리 Compose 를 가리킨다(work-setup 이 worker 의 Supabase 주소를 먼저 비교한다).
// verify·CI·test:e2e:auth·test:e2e:work 에는 넣지 않는다.
//
// 프로젝트(모두 한 작업자로 차례로 돈다. 셋이 같은 DB 상태를 본다):
//   - s5-ingest: 데이터를 바꾸는 시험(@ingest). 배치 LIVE 수동 수집 → API → 같은 수집 한 번 더(멱등). 1440×900.
//   - s5-1440·s5-1280: 수집 뒤 화면(읽기만). s5-ingest 가 끝난 뒤 두 폭에서 한 번씩 돈다.
//     수집은 한 번만 "변경 3" 을 만들 수 있어(두 번째부터는 중복) 폭마다 다시 돌리지 않는다.
//     s5-ingest 의 시험이 하나라도 실패하면 두 폭 프로젝트는 "did not run" 이다(바뀐 데이터가 없으면 화면 단언이 뜻이 없다).
//
// 포트는 3200 이 기본이다(test:e2e:auth·test:e2e:work 와 같다. 함께 돌리지 않는다). 격리 Supabase 의
// site_url 에 맞춰 E2E_PORT 로 바꾼다.
const port = Number(process.env.E2E_PORT) || 3200;
const hostname = "localhost";
const baseURL = `http://${hostname}:${port}`;

const desktop = (width: 1440 | 1280) => ({
  ...devices["Desktop Chrome"],
  viewport: width === 1440 ? { width: 1440, height: 900 } : { width: 1280, height: 800 },
});

const INGEST = /@ingest/;

export default defineConfig({
  // Shared Node tooling uses native ESM (including import.meta for checkout-root cwd).
  build: { external: ["**/scripts/local-test-target.mjs"] },
  testDir: "./e2e-auth",
  testMatch: /s5-change-detection\.write\.spec\.ts$/,
  globalSetup: "./e2e-auth/support/work-setup.ts",
  outputDir: "test-results/s5",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 세 프로젝트가 같은 데이터 상태를 보므로 직렬이다.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/s5" }]],
  // 시각은 서울로 보인다(formatKst). 브라우저도 서울에 둔다.
  use: { baseURL, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    { name: "s5-ingest", use: desktop(1440), grep: INGEST },
    { name: "s5-1440", use: desktop(1440), grepInvert: INGEST, dependencies: ["s5-ingest"] },
    { name: "s5-1280", use: desktop(1280), grepInvert: INGEST, dependencies: ["s5-ingest"] },
  ],
  webServer: {
    command: `pnpm start --hostname ${hostname} --port ${port}`,
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
