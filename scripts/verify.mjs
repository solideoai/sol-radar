#!/usr/bin/env node
// 루트 검증 — `pnpm verify` · `pnpm verify:quick`(각 폴더의 빌드 빼고)
//
// 순서: 게이트 테스트 → 디자인 토큰 → 색 → 등록된 프로젝트(web). 하나라도 실패하면 거기서 멈춘다.
// 표시 파일(package.json 등)이 없는 프로젝트 폴더는 건너뛴다.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCommandSync } from "./command.mjs";
import {
  loadConfig,
  presentProjects,
  projectCommands,
  verificationCommands,
} from "./project-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");
const config = loadConfig(root);

const APP_FOLDERS = config.verification.projects;
const isPresent = (project) => existsSync(join(root, project.directory, project.marker));

APP_FOLDERS.filter((folder) => !isPresent(folder)).forEach((folder) =>
  console.log(`- ${folder.directory}/ 가 없어 건너뜁니다`),
);

const staged = process.argv.includes("--staged");
const changed = staged
  ? spawnSync("git", ["diff", "--cached", "--name-only", "--no-renames", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
  : undefined;
if (changed && changed.status !== 0) throw new Error("스테이징 상태를 읽을 수 없습니다");
const files = changed?.stdout.split("\0").filter(Boolean);
const projectName = process.argv.includes("--project")
  ? process.argv[process.argv.indexOf("--project") + 1]
  : undefined;
const selected = projectName
  ? presentProjects(root, config).find((project) => project.name === projectName)
  : undefined;
if (projectName && !selected) throw new Error(`설치된 프로젝트를 찾을 수 없습니다: ${projectName}`);
const options = { quick, files: files?.includes("verify.config.json") ? undefined : files };
const steps = selected
  ? [
      ...(process.argv.includes("--setup") && selected.setup
        ? [{ ...selected.setup, cwd: selected.directory }]
        : []),
      { ...selected[quick ? "quick" : "verify"], cwd: selected.directory },
      ...(process.argv.includes("--ci")
        ? [selected.prepareE2e, selected.e2e]
            .filter(Boolean)
            .map((command) => ({ ...command, cwd: selected.directory }))
        : []),
    ]
  : process.argv.includes("--common")
    ? config.verification.common
    : staged
      ? projectCommands(root, config, options)
      : verificationCommands(root, config, options);
if (staged) {
  const missing = steps.find(
    (step) =>
      existsSync(join(root, step.cwd, "package.json")) &&
      !existsSync(join(root, step.cwd, "node_modules")),
  );
  if (missing)
    throw new Error(
      `${missing.cwd} 의 의존성이 설치되지 않았습니다. pnpm -C ${missing.cwd} install 을 먼저 실행하세요.`,
    );
}

// 처음 실패한 단계에서 멈춘다 — 그 뒤 단계는 돌리지 않는다.
// 실행 자체가 안 된 경우(명령 없음 등)는 검사 실패와 구분해 원인을 함께 알린다.
const run = (check) =>
  spawnCommandSync(check.command, check.args, {
    cwd: join(root, check.cwd ?? "."),
    stdio: "inherit",
  });
const failure = steps
  .values()
  .map((check) => ({ check, result: run(check) }))
  .find(({ result }) => result.status !== 0);

if (failure) {
  const { check, result } = failure;
  const reason = result.error ? ` (실행할 수 없습니다: ${result.error.message})` : "";
  console.error(`✗ 검증 실패: ${check.command} ${check.args.join(" ")}${reason}`);
  process.exit(1);
}
