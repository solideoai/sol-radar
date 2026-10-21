import { defineConfig, devices } from "@playwright/test";

// 기본 포트는 3100 이다. 다른 서버가 그 포트를 쓰고 있으면 E2E_PORT 로 바꾼다(예: E2E_PORT=3111 pnpm test:e2e).
const port = Number(process.env.E2E_PORT) || 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure" },
  // 데스크톱 chromium 하나로 돈다. 휴대폰 기기 프로젝트는 두지 않는다(모바일 범위 외, docs/16-DECISIONS.md ADR-007).
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
    // 로컬 E2E 서버는 화면과 API를 함께 실행한다. 운영 배포 역할과 분리한다.
    env: { SOL_DEPLOYMENT_ROLE: "standalone" },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
