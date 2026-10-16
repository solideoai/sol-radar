// 시험 공용 도구 — 가짜 실행 파일·PATH 를 운영체제와 상관없이 다룬다.
//
// Windows 는 실행 비트와 shebang 을 모른다. 그래서 가짜 실행 파일 옆에 같은 이름의 .cmd 를 둔다.
// scripts/command.mjs 는 .cmd 를 찾아 cmd.exe 로 부르고, Git 의 sh 는 확장자 없는 원본을 shebang 으로 부른다.
// #!/bin/sh 원본은 Git for Windows 의 sh.exe 로, #!/usr/bin/env node 원본은 지금 도는 node 로 돌린다.
// Windows 시험은 Git Bash 에서 돌린다(PATH 이름이 PATH 로 하나다). CI 도 같다.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

export const isWindows = process.platform === "win32";

// Windows 에서 돌지 않는 시험의 건너뛰기 사유. 같은 동작은 macOS·Linux CI 가 본다.
export const symlinkSkip =
  isWindows && "Windows 는 심볼릭 링크에 권한이 필요하다(POSIX CI 가 본다)";
export const permissionSkip =
  isWindows && "Windows 에는 POSIX 파일 권한(실행 비트·읽기 금지)이 없다(POSIX CI 가 본다)";
export const signalSkip = isWindows && "Windows 에는 POSIX 신호가 없다(POSIX CI 가 본다)";

const sh = isWindows
  ? resolve(
      execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
      "../../../usr/bin/sh.exe",
    )
  : "sh";

export function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  if (!isWindows) return;
  const runner = /^#!.*\bnode\b/.test(content) ? process.execPath : sh;
  writeFileSync(`${path}.cmd`, `@"${runner}" "%~dp0${basename(path)}" %*\r\n`);
}

// 정식 경로의 임시 폴더. Windows 의 임시 폴더는 8.3 짧은 이름(RUNNER~1)일 수 있는데 git·제품 코드는 긴 이름을 준다.
// 경로를 비교하는 시험은 이것으로 고정물을 만든다(macOS 의 /var → /private/var 도 푼다).
export const tempDir = (prefix) =>
  (isWindows ? realpathSync.native : realpathSync)(mkdtempSync(join(tmpdir(), prefix)));

// PATH 를 좁힌 시험이 쓰는 기본 셸 도구 자리(Windows 는 Git 의 usr/bin).
export const systemPath = isWindows ? dirname(sh) : "/usr/bin:/bin";

// dir 을 맨 앞에 둔 PATH 값.
export const pathWith = (dir, path = process.env.PATH) =>
  [dir, path].filter(Boolean).join(delimiter);

// 워크플로(.github/workflows/*.yml)에서 잡 하나의 본문 — `  <이름>:` 줄부터 다음 잡 줄 앞까지. 없으면 null.
export function jobBlock(text, name) {
  const start = text.indexOf(`\n  ${name}:\n`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 2);
}
