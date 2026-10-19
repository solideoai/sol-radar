import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 테스트 설정.
// - server/** 는 `import "server-only"` 를 쓰는데, 이는 Next 빌드 전용 가드라 테스트 환경에선 빈 모듈로 바꿔치기한다.
// - `@/` 경로 별칭을 루트로 매핑한다.
// - `@test-harness/*` 는 시험만 부르는 루트 scripts/ 모듈이다(제품 코드는 부르지 않는다).
//   analysis 저장 port 시험이 데모 seed 행 계획(demo-plan·demo-bid-notices·people-seed)과 PGlite(supabase-pglite)를 쓴다.
// - 브라우저가 필요한 부품 레이아웃 시험(`*.browser.test.tsx`)은 vitest.browser.config.ts 가 돌린다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**", "e2e-auth/**", "**/*.browser.test.tsx"],
  },
  resolve: {
    alias: {
      "@test-harness/local-test-target.mjs": fileURLToPath(
        new URL("../scripts/local-test-target.mjs", import.meta.url),
      ),
      "@test-harness/supabase-pglite.mjs": fileURLToPath(
        new URL("../scripts/supabase-pglite.mjs", import.meta.url),
      ),
      "@test-harness/demo-plan.mjs": fileURLToPath(
        new URL("../scripts/demo/plan.mjs", import.meta.url),
      ),
      "@test-harness/demo-bid-notices.mjs": fileURLToPath(
        new URL("../scripts/demo/bid-notices.mjs", import.meta.url),
      ),
      "@test-harness/people-seed.mjs": fileURLToPath(
        new URL("../scripts/people/seed.mjs", import.meta.url),
      ),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
