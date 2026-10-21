#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCommandSync } from "./command.mjs";
import { loadConfig, presentProjects, verificationCommands } from "./project-config.mjs";

const script = fileURLToPath(import.meta.url);

export const changedFiles = (root, base = "HEAD") => {
  if (!base || base.startsWith("-")) throw new Error("변경 파일 기준 커밋이 필요합니다");
  // Git hooks export repository-local variables. Explicit root must always win over the caller's repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const read = (args) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    if (result.error || result.status !== 0)
      throw new Error(
        `변경 파일을 읽을 수 없습니다: ${result.error?.message ?? result.stderr.trim()}`,
      );
    return result.stdout.split("\0").filter(Boolean);
  };
  return [
    ...new Set([
      ...read(["diff", "--name-only", "--no-renames", "-z", base, "--"]),
      ...read(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ].sort();
};

const documentation = (file) =>
  /^(docs|polaris)\//.test(file) ||
  /^[^/]+\.(md|pdf|pptx)$/.test(file) ||
  /(^|\/)(README|AGENTS|CLAUDE|CHANGELOG)\.md$/.test(file) ||
  /^\.claude\/.*\.md$/.test(file);

const patternsOf = ({ changedPaths = ["^"] }) => {
  if (
    !Array.isArray(changedPaths) ||
    changedPaths.length === 0 ||
    changedPaths.some((pattern) => typeof pattern !== "string" || !pattern.startsWith("^"))
  )
    throw new Error("changedPaths는 ^로 시작하는 정규식 배열이어야 합니다");
  return changedPaths.map((pattern) => new RegExp(pattern));
};

export const changedVerificationCommands = (root, config, files) => {
  const checks = [
    ...config.verification.common.map(({ changedPaths, ...command }) => ({
      command,
      patterns: patternsOf({ changedPaths }),
    })),
    ...presentProjects(root, config).map((project) => ({
      command: { ...project.quick, cwd: project.directory },
      patterns: patternsOf(project),
    })),
  ];
  const code = files.filter((file) => !documentation(file));
  if (code.length === 0) return [];
  // 새 영역을 등록하기 전에도 검사가 빠지지 않게 보수적으로 넓힌다.
  if (
    code.includes("verify.config.json") ||
    code.some(
      (file) => !checks.some(({ patterns }) => patterns.some((pattern) => pattern.test(file))),
    )
  )
    return verificationCommands(root, config, { quick: true }).map(
      ({ changedPaths, ...command }) => command,
    );
  return checks
    .filter(({ patterns }) => code.some((file) => patterns.some((pattern) => pattern.test(file))))
    .map(({ command }) => command);
};

const main = () => {
  const args = process.argv.slice(2);
  let base = "HEAD";
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--dry-run") dryRun = true;
    else if (args[index] === "--base" && args[index + 1] && !args[index + 1].startsWith("-"))
      base = args[++index];
    else throw new Error("사용법: pnpm verify:changed [--base <기준 커밋>] [--dry-run]");
  }
  const root = join(dirname(script), "..");
  const files = changedFiles(root, base);
  const steps = changedVerificationCommands(root, loadConfig(root), files);
  if (dryRun) {
    console.log(JSON.stringify({ base, files, steps }, null, 2));
    return;
  }
  console.log(`변경 ${files.length}개 · 검사 ${steps.length}개 (기준 ${base})`);
  if (steps.length === 0) console.log("이번 변경에 실행할 코드 검사가 없습니다.");
  for (const step of steps) {
    const label = `${step.cwd ?? "."}: ${step.command} ${step.args.join(" ")}`;
    console.log(`▶ ${label}`);
    const started = performance.now();
    const result = spawnCommandSync(step.command, step.args, {
      cwd: join(root, step.cwd ?? "."),
      stdio: "inherit",
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (result.error || result.status !== 0) {
      console.error(`✗ ${label} (${seconds}초)${result.error ? `: ${result.error.message}` : ""}`);
      process.exitCode = result.status || 1;
      return;
    }
    console.log(`✓ ${label} (${seconds}초)`);
  }
  console.log("변경 범위 검사 종료. 전체 검증은 통합·제출 전에 pnpm verify로 실행합니다.");
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(script)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
