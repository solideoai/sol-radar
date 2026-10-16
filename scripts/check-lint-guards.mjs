#!/usr/bin/env node
// 린트 가드레일 검사 — 검사를 끄는 길이 그 폴더의 eslint.config.mjs 에서 다시 열리면 실패한다.
//
// 규칙을 설정에서 빼도 lint 는 초록불이라, 설정이 약해진 것을 아무도 모르게 된다. 그래서 막혀야 할 코드를
// 그 폴더의 ESLint 에 직접 넣어 보고, 기대한 오류가 그대로 나는지 본다. web·mobile 의 verify 가 각 폴더에서
// 부른다(check:lint-guards). 그 폴더에 설치된 eslint 를 쓴다.
import { createRequire } from "node:module";
import { join } from "node:path";

// 막혀야 하는 것: 주석으로 규칙 끄기(줄 1), any(2), @ts-ignore(3), 설명 없는 @ts-expect-error(5),
// 테스트 .only·.skip·.fixme(11~13). 설명을 붙인 @ts-expect-error(7)는 통과한다 — DB 타입 시험이 쓴다.
const probe = [
  "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
  "export const a: any = 1;",
  "// @ts-ignore",
  'export const b: number = "x";',
  "// @ts-expect-error",
  'export const c: number = "y";',
  "// @ts-expect-error: 설명이 있으면 허용",
  'export const d: number = "z";',
  "declare const it: { only: (n: string) => void; skip: (n: string) => void };",
  "declare const test: { fixme: (n: string) => void };",
  'it.only("x");',
  'it.skip("y");',
  'test.fixme("z");',
  "export let counter = 0;",
  "counter += 1;",
  "export let unchanged = 1;",
].join("\n");

const expected = [
  "2:@typescript-eslint/no-explicit-any",
  "3:@typescript-eslint/ban-ts-comment",
  "5:@typescript-eslint/ban-ts-comment",
  "11:no-restricted-properties",
  "12:no-restricted-properties",
  "13:no-restricted-properties",
  "16:prefer-const",
];

const { ESLint } = createRequire(join(process.cwd(), "package.json"))("eslint");
const [result] = await new ESLint().lintText(probe, { filePath: "lib/escape.test.ts" });
const errors = result.messages
  .filter((message) => message.severity === 2)
  .map((message) => `${message.line}:${message.ruleId}`);

if (JSON.stringify(errors) !== JSON.stringify(expected)) {
  console.error(
    "✗ 린트 가드레일이 약해졌습니다. eslint.config.mjs 에서 빠진 규칙을 되돌리세요\n" +
      "  (linterOptions.noInlineConfig · no-explicit-any · ban-ts-comment · no-restricted-properties · prefer-const).\n" +
      `  기대: ${expected.join(", ")}\n  실제: ${errors.join(", ") || "없음"}`,
  );
  process.exit(1);
}
console.log("✓ 린트 가드레일 유지 — 주석·any·@ts-ignore·.only·.skip 으로 검사를 끌 수 없습니다");
