// 템플릿 전용 워크플로(.github/workflows/template.yml) 시험 — 스모크·Windows 검증이 주 1회 예약과 수동 실행에서만 도는지 본다.
// 실행: 루트에서 `pnpm test`. 새 프로젝트(pnpm bootstrap)에는 이 시험도 워크플로도 복사하지 않는다.
// 액션 SHA 고정·checkout 토큰 규칙은 scripts/template/ci-required.test.mjs 가 워크플로 전부를 대상으로 본다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { excludedReason } from "./bootstrap.mjs";
import { jobBlock } from "../test-support.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = ".github/workflows/template.yml";
const template = readFileSync(join(REPO, WORKFLOW), "utf8");

describe("템플릿 전용 워크플로", () => {
  test("직접 실행과 주 1회 예약에서만 돈다 — PR·push 에서는 돌지 않는다", () => {
    assert.match(template, /^on:\n {2}workflow_dispatch:\n/m);
    // 요일을 하나로 고정한 cron 이어야 주 1회다. 예약이 빠지면 새 복사본이 도는지 아무도 모르게 된다.
    assert.match(template, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* [0-6]"\n/m);
    assert.doesNotMatch(template, /^ {2}(pull_request|push):/m);
  });

  test("스모크는 세 mode matrix 로 scripts/template 의 스모크를 부른다", () => {
    const smoke = jobBlock(template, "smoke");
    assert.ok(smoke, "smoke 잡이 없습니다");
    assert.match(smoke, /mode: \[web, mobile, both\]/);
    assert.match(smoke, /node scripts\/template\/smoke-template\.mjs --mode "\$SMOKE_MODE"/);
    assert.ok(existsSync(join(REPO, "scripts/template/smoke-template.mjs")));
    assert.ok(!template.includes("continue-on-error"));
    assert.ok(!template.includes("|| true"));
  });

  test("Windows 는 Git Bash 로 설치와 공통 검증을 돈다", () => {
    const windows = jobBlock(template, "windows");
    assert.ok(windows, "windows 잡이 없습니다");
    assert.match(windows, /runs-on: windows-latest/);
    assert.match(windows, /shell: bash/);
    assert.match(windows, /pnpm install --frozen-lockfile/);
    assert.match(windows, /node scripts\/verify\.mjs --common/);
  });

  test("새 프로젝트로 복사하지 않는다", () => {
    assert.equal(excludedReason(WORKFLOW), "템플릿 관리용");
    assert.equal(excludedReason(".github/workflows/ci.yml"), null);
  });
});
