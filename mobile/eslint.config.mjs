import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

// 테스트를 골라 돌리거나(.only) 건너뛰어(.skip·.fixme) 초록불을 만드는 길을 막는다. 웹(web)과 같은 목록이다.
const focusOrSkip = ["describe", "it", "test"].flatMap((object) =>
  ["only", "skip", "fixme"].map((property) => ({
    object,
    property,
    message: "테스트를 골라 돌리거나 건너뛰지 마세요. 실패하면 원인을 고치세요.",
  })),
);

// 이 파일의 가드레일이 빠지면 pnpm check:lint-guards(scripts/check-lint-guards.mjs)가 실패한다.
export default defineConfig([
  ...expoConfig,
  { ignores: ["dist/**", ".expo/**", "theme/tokens.ts"] },
  // 주석(eslint-disable 등)으로 규칙을 끄지 못한다. 예외가 꼭 필요하면 사람이 이 파일에 files 를 좁힌 규칙으로 연다.
  { linterOptions: { noInlineConfig: true } },
  {
    // ── 웹과 같은 결의 규칙 ──
    // 딥임포트 룰(@/server/*/*)은 웹 전용이다. 앱에는 server/ 가 없다 —
    // 서버 코드는 전부 web/server 에 두고, 앱은 Supabase 를 직접 부른다.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "prefer-const": "error",
      "no-restricted-properties": ["error", ...focusOrSkip],
      // 웹은 eslint-config-next 가 켜 둔다. 앱의 expo 설정에는 없어 여기서 켠다.
      // @ts-expect-error 는 설명을 붙이면 쓸 수 있다(없는 표·열이 타입 오류인지 보는 시험이 쓴다).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message: "부모 상대경로(../) 대신 @/ 경로 별칭을 쓰세요.",
            },
          ],
        },
      ],
    },
  },
]);
