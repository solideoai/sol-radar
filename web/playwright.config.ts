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
  // 모든 e2e 가 데스크톱과 휴대폰에서 한 번씩 돈다. CI 는 chromium 만 설치하므로
  // 휴대폰도 chromium 기반 기기(Pixel)만 쓴다. webkit 기기(iPhone)를 쓰려면 CI 설치부터 바꾼다.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
