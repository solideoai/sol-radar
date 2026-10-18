import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 테스트를 골라 돌리거나(.only) 건너뛰어(.skip·.fixme) 초록불을 만드는 길을 막는다.
const focusOrSkip = ["describe", "it", "test"].flatMap((object) =>
  ["only", "skip", "fixme"].map((property) => ({
    object,
    property,
    message: "테스트를 골라 돌리거나 건너뛰지 마세요. 실패하면 원인을 고치세요.",
  })),
);

// 이 파일의 가드레일이 빠지면 pnpm check:lint-guards(scripts/check-lint-guards.mjs)가 실패한다.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 빌드·시험 산출물(깃에서도 빠져 있다). E2E 가 실패하면 playwright-report 에 trace 뷰어의 압축된 JS 가 남는다.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  // 주석(eslint-disable 등)으로 규칙을 끄지 못한다. any·@ts-ignore 금지(nextTs)도 주석 한 줄로 풀리지 않게 한다.
  // 예외가 꼭 필요하면 사람이 이 파일에 files 를 좁힌 규칙으로 연다.
  { linterOptions: { noInlineConfig: true } },
  {
    // ── 아키텍처 가드레일 ──
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "prefer-const": "error",
      "no-restricted-properties": ["error", ...focusOrSkip],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 도메인 내부 딥임포트 금지 → 배럴(@/server/<도메인>, @/server/shared)만
              group: ["@/server/*/*"],
              message:
                "도메인 내부 파일을 직접 import하지 마세요. 배럴(@/server/<도메인> 또는 @/server/shared)을 쓰세요.",
            },
            {
              // 부모 상대경로 금지 → @/ 별칭
              group: ["../*"],
              message: "부모 상대경로(../) 대신 @/ 경로 별칭을 쓰세요.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
