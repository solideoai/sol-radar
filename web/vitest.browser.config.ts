import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";

// 부품 레이아웃 시험 — 진짜 Chromium 에 부품을 그려 위치·크기를 잰다(`*.browser.test.tsx`).
// 시험용 경로를 앱에 두지 않으려고 Next 대신 Vitest 가 부품만 따로 묶는다. CSS 는 globals.css 를 그대로 쓴다(setupFiles).
// 브라우저가 필요해 `pnpm test`(커밋 게이트) 대신 `pnpm test:e2e` 에서 돈다. Playwright e2e 와 같은 Chromium 을 쓴다.
export default defineConfig({
  test: {
    include: ["**/*.browser.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**", "e2e-auth/**"],
    setupFiles: ["./test/browser-setup.ts"],
    // 실패 화면·첨부는 깃이 무시하는 test-results/ 에 남긴다. CI 는 실패하면 이 폴더를 올린다
    attachmentsDir: "test-results/vitest-attachments",
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotDirectory: "test-results/vitest-screenshots",
    },
  },
  // 시험 파일을 미리 훑어 의존성을 한 번에 묶는다. 이 줄이 없으면 경로 묶음 폴더(`app/(app)/…`) 안의 시험은 미리 훑이지 않아,
  // 캐시가 없는 첫 실행(CI·새 복제본)에서 의존성을 뒤늦게 묶고 화면을 다시 불러온다. 그 사이 React 가 둘이 되어 시험이 실패한다.
  // 캐시가 이미 있는 복제본은 미리 훑기를 건너뛰어, 새로 들인 의존성(switch)을 실행 중에 묶고 다시 불러온다. 그 사이 React 가 둘이 된다.
  // 그래서 뒤늦게 들어온 부품의 의존성은 include 에 적어 처음부터 묶는다.
  optimizeDeps: {
    entries: ["**/*.browser.test.tsx"],
    include: ["@base-ui/react/switch"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
