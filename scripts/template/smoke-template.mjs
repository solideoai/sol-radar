#!/usr/bin/env node
// 템플릿 스모크 — `pnpm smoke:template [--mode web|mobile|both] [--evidence <폴더>]`
//
// bootstrap 과 같은 복사 계획(scripts/template/bootstrap.mjs)으로 임시 폴더에 새 프로젝트를 만들고, 사용자가 처음 하는
// 순서를 실제로 돌린다: git init → 루트·있는 폴더 frozen 설치(훅 설치 포함) → pnpm run doctor → pnpm verify →
// (web) Playwright 브라우저 준비 → E2E · (mobile) NODE_PATH 없는 Jest 직접 실행 →
// 훅이 타입 오류·색·잘못된 메시지를 막고 작은 유효 변경의 첫 커밋을 통과시키는지.
// mode 를 적지 않으면 web·mobile·both 를 차례로 돈다.
//
// - 원본은 읽기만 한다. 추적 파일의 현재 bytes(커밋 전 수정 포함)를 복사한다. 새 파일은 git add 한 뒤에 들어간다.
// - 자식 명령에서 실행 환경의 DB·배포 변수(SUPABASE·NEXT_PUBLIC·EXPO_PUBLIC·VERCEL), Git 주입 변수, HUSKY 를 지우고
//   빈 fixture 전역 Git 설정·빈 XDG_CONFIG_HOME·fixture 작성자·서명 끔을 건다. HOME 등 시스템 변수는 그대로 둔다.
// - 네트워크는 패키지·Playwright 브라우저 설치에만 쓴다. DB·Auth·배포 요청은 하지 않는다.
//   mobile 의 iOS·Android 확인은 verify 안의 JS export 까지다(네이티브 빌드가 아니다).
// - 실패를 건너뜀으로 숨기지 않는다. 처음 실패한 단계에서 멈추고 그 단계를 알린 뒤, 자기 임시 폴더만 지운다.
// - pnpm test·verify 안에서 다시 부르지 않는다(SMOKE_TEMPLATE_ACTIVE 가 있으면 종료 2).
//
// 종료: 0 성공 · 1 스모크 실패 · 2 잘못된 인자·재호출
import { spawnCommandSync } from "../command.mjs";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap.mjs";

const USAGE = "사용법: pnpm smoke:template [--mode web|mobile|both] [--evidence <실패 기록 폴더>]";

export const MODES = ["web", "mobile", "both"];
const PLATFORMS = { web: ["web"], mobile: ["mobile"], both: ["web", "mobile"] };
const PLATFORM_DIRS = ["web", "mobile"];
export const GUARD = "SMOKE_TEMPLATE_ACTIVE";
const GENERATED = {
  web: ["web/app/globals.css", "web/lib/database.types.ts"],
  mobile: ["mobile/theme/tokens.ts", "mobile/lib/database.types.ts"],
};

// 자식 명령에 넘기지 않는 변수: DB·배포 설정, Git 저장소·설정 주입, 훅 끄기, 숨은 의존성 경로
const DROPPED_ENV =
  /^(GIT_|SUPABASE_|NEXT_PUBLIC_|EXPO_PUBLIC_|VERCEL|REQUIRE_DATABASE$|HUSKY$|NODE_PATH$|PLAYWRIGHT_BROWSERS_PATH$)/;

export class SmokeError extends Error {
  constructor(phase, message, output = "") {
    super(message);
    this.phase = phase;
    this.output = output;
  }
}

// fixture 의 모든 자손 명령이 쓰는 환경. 사용자 전역 Git 설정·Husky 시작 스크립트·서명이 끼어들지 않는다.
export function fixtureEnv(base, { xdg, gitConfig, browsers }) {
  const kept = Object.fromEntries(Object.entries(base).filter(([key]) => !DROPPED_ENV.test(key)));
  return {
    ...kept,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "tag.gpgsign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_AUTHOR_NAME: "Template Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.invalid",
    GIT_COMMITTER_NAME: "Template Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.invalid",
    [GUARD]: "1",
    ...(browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}),
  };
}

// 기본 실행기: 출력은 모아 두었다가 실패할 때만 보여 준다.
export function spawnExec({ command, args, cwd, env }) {
  const result = spawnCommandSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.error ? 127 : (result.status ?? 1),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? result.error.message : ""}`,
  };
}

// 실패 기록에서 임시 폴더·홈 경로를 지운다. 환경변수 값은 애초에 출력하지 않는다.
export const sanitize = (text, { work, home = homedir() }) =>
  [
    [work, "<fixture>"],
    [home, "~"],
  ]
    .filter(([from]) => from)
    .reduce((out, [from, to]) => out.split(from).join(to), text);

const tail = (text, lines = 80) => text.trimEnd().split("\n").slice(-lines).join("\n");
// 긴 시험 출력에서 꼬리만 보이면 실패한 시험 이름이 잘린다. 실패 줄은 따로 앞에 둔다.
const failedTests = (text) =>
  text
    .split("\n")
    .filter((line) => /^\s*not ok\b|^\s*✕ |^\s*FAIL /.test(line))
    .join("\n");
const sameBytes = (a, b) => Buffer.compare(a, b) === 0;

export function runSmoke({
  mode,
  source,
  exec = spawnExec,
  bootstrap = runBootstrap,
  baseEnv = process.env,
  tmp = tmpdir(),
  log = console.log,
  evidence,
}) {
  if (!PLATFORMS[mode])
    throw new SmokeError("args", `--mode 는 web·mobile·both 중 하나입니다: ${mode}`);
  const platforms = PLATFORMS[mode];
  const absent = PLATFORM_DIRS.filter((dir) => !platforms.includes(dir));
  const work = mkdtempSync(join(tmp, `template-smoke-${mode}-`));
  const app = join(work, "app");
  const xdg = join(work, "xdg");
  const gitConfig = join(work, "gitconfig");
  const browsers = platforms.includes("web") ? join(work, "ms-playwright") : undefined;
  const env = fixtureEnv(baseEnv, { xdg, gitConfig, browsers });
  const evidenceLines = [];
  const note = (line) => {
    evidenceLines.push(line);
    log(`  ✓ ${line}`);
  };

  const step = (phase, command, args, { cwd = app, expectFail = false, stepEnv = env } = {}) => {
    const started = Date.now();
    const { status, output } = exec({ command, args, cwd, env: stepEnv, phase });
    const failed = status !== 0;
    if (failed !== expectFail)
      throw new SmokeError(
        phase,
        expectFail
          ? `${command} ${args.join(" ")} 가 막혀야 하는데 통과했습니다`
          : `${command} ${args.join(" ")} 가 실패했습니다(종료 ${status})`,
        output,
      );
    note(
      `${phase}: ${command} ${args.join(" ")} (${((Date.now() - started) / 1000).toFixed(0)}초)`,
    );
    return output;
  };
  const check = (phase, ok, message) => {
    if (!ok) throw new SmokeError(phase, message);
  };
  const read = (root, path) => readFileSync(join(root, path));
  const json = (root, path) => JSON.parse(read(root, path).toString("utf8"));
  const absentCheck = (phase) =>
    absent.forEach((dir) =>
      check(phase, !existsSync(join(app, dir)), `고르지 않은 ${dir}/ 가 다시 생겼습니다`),
    );

  // 커밋 시도 전후의 HEAD·인덱스. 막힌 커밋은 둘 다 바꾸지 않아야 한다.
  const gitState = () => {
    const head = exec({
      command: "git",
      args: ["rev-parse", "--verify", "-q", "HEAD"],
      cwd: app,
      env,
      phase: "git-state",
    });
    const index = exec({
      command: "git",
      args: ["ls-files", "--stage", "-z"],
      cwd: app,
      env,
      phase: "git-state",
    });
    if (index.status !== 0)
      throw new SmokeError("git-state", "인덱스를 읽지 못했습니다", index.output);
    return { head: head.status === 0 ? head.output.trim() : null, index: index.output };
  };
  const blockedCommit = (phase, message, expected, extra = []) => {
    step(phase, "git", ["add", "-A"]);
    const before = gitState();
    const output = step(phase, "git", ["commit", ...extra, "-m", message], { expectFail: true });
    check(
      phase,
      expected.test(output),
      `훅이 예상한 이유(${expected})로 막지 않았습니다\n${tail(output)}`,
    );
    const after = gitState();
    check(phase, after.head === before.head, "막힌 커밋 뒤 HEAD 가 바뀌었습니다");
    check(phase, after.index === before.index, "막힌 커밋 뒤 인덱스가 바뀌었습니다");
    return output;
  };
  const brokenFile = (phase, path, text, expected) => {
    writeFileSync(join(app, path), text);
    blockedCommit(phase, "test: 스모크 차단 확인", expected);
    step(phase, "git", ["rm", "-q", "--cached", "--", path]);
    unlinkSync(join(app, path));
  };

  try {
    log(`▶ 템플릿 스모크 (${mode})`);
    mkdirSync(xdg);
    writeFileSync(gitConfig, "");

    // 1. 새 프로젝트 — bootstrap 과 같은 원본 목록·플랫폼 선택
    const out = [];
    const code = bootstrap([app, "--name", `smoke-${mode}`, "--mode", mode], {
      root: source,
      cwd: work,
      stdout: (line) => out.push(line),
      stderr: (line) => out.push(line),
    });
    check("bootstrap", code === 0, `bootstrap 이 종료 ${code} 로 실패했습니다\n${out.join("\n")}`);
    note(`bootstrap: --mode ${mode}`);

    // 2. Node·pnpm 고정값과 고르지 않은 플랫폼
    check(
      "pins",
      sameBytes(read(app, ".nvmrc"), read(source, ".nvmrc")),
      ".nvmrc 가 원본과 다릅니다",
    );
    for (const dir of [".", ...platforms])
      check(
        "pins",
        json(app, join(dir, "package.json")).packageManager ===
          json(source, join(dir, "package.json")).packageManager,
        `${dir}/package.json 의 packageManager 가 원본과 다릅니다`,
      );
    absentCheck("pins");
    note(`pins: .nvmrc·packageManager 원본과 같음, 없는 플랫폼 ${absent.join(",") || "없음"}`);

    // 3. git init → 설치(루트 prepare 가 훅을 켠다)
    step("git-init", "git", ["init", "-q"]);
    step("install", "pnpm", ["install", "--frozen-lockfile"]);
    const hooksPath = step("hooks", "git", ["config", "--get", "core.hooksPath"]).trim();
    check(
      "hooks",
      hooksPath === ".husky/_",
      `core.hooksPath 가 .husky/_ 가 아닙니다: ${hooksPath}`,
    );
    for (const dir of platforms)
      step("install", "pnpm", ["install", "--frozen-lockfile"], { cwd: join(app, dir) });
    for (const dir of [".", ...platforms])
      check(
        "lockfile",
        sameBytes(
          read(app, join(dir, "pnpm-lock.yaml")),
          read(source, join(dir, "pnpm-lock.yaml")),
        ),
        `${dir}/pnpm-lock.yaml 이 설치 뒤 원본과 다릅니다`,
      );
    note("lockfile: 설치 뒤에도 락파일 bytes 가 원본과 같음");

    // 4. CI 가 고를 프로젝트
    const ciOutput = step("ci-projects", "node", ["scripts/ci-projects.mjs"]);
    const projectsLine = ciOutput.split("\n").find((line) => line.startsWith("projects="));
    const selected = projectsLine
      ? JSON.parse(projectsLine.slice("projects=".length)).map((project) => project.name)
      : [];
    check(
      "ci-projects",
      JSON.stringify(selected) === JSON.stringify(platforms),
      `CI 프로젝트 선택이 ${JSON.stringify(selected)} 입니다(기대 ${JSON.stringify(platforms)})`,
    );

    // 5. 점검과 전체 검증(공통 + 있는 폴더, web 은 production 빌드, mobile 은 iOS·Android JS export)
    step("doctor", "pnpm", ["run", "doctor"]);
    step("verify", "pnpm", ["verify"]);
    for (const path of platforms.flatMap((dir) => GENERATED[dir]))
      check(
        "generated",
        sameBytes(read(app, path), read(source, path)),
        `${path} 가 정본 생성물과 다릅니다`,
      );
    absentCheck("generated");
    note("generated: 생성물이 원본과 같음");

    // 6. 앱 테스트를 pnpm 의 NODE_PATH 없이 직접 — 숨은 전이 의존성에 기대지 않는지
    if (platforms.includes("mobile"))
      step(
        "jest-direct",
        "node",
        ["node_modules/jest/bin/jest.js", "--runInBand", "--no-cache", "--watchman=false"],
        { cwd: join(app, "mobile") },
      );

    // 7. 웹 E2E — fixture 전용 브라우저 폴더에 chromium 을 받은 뒤 production 서버로 두 시험
    if (platforms.includes("web")) {
      step("playwright-install", "pnpm", [
        "-C",
        "web",
        "exec",
        "playwright",
        "install",
        "chromium",
      ]);
      step("e2e", "pnpm", ["-C", "web", "test:e2e"]);
    }

    // 8. 실제 훅 — 타입 오류·직접 적은 색은 막히고, 작은 유효 변경의 첫 커밋은 통과하고, 잘못된 메시지는 막힌다.
    // 메시지는 첫 커밋 뒤 빈 커밋으로 본다. 첫 커밋 앞에서 보면 프로젝트 전체가 올라가 pre-commit 전체 검증이 한 번 더 돈다.
    const [first] = platforms;
    brokenFile(
      "hook-type",
      `${first}/lib/smoke-type-error.ts`,
      'export const smokeTypeError: number = "not a number";\n',
      /smoke-type-error/,
    );
    brokenFile(
      "hook-color",
      `${first}/lib/smoke-color.ts`,
      'export const smokeColor = "#ff0000";\n',
      /smoke-color/,
    );
    appendFileSync(join(app, "README.md"), "\n<!-- 템플릿 스모크 첫 커밋 -->\n");
    step("hook-commit", "git", ["add", "-A"]);
    const commitOutput = step("hook-commit", "git", [
      "commit",
      "-q",
      "-m",
      "chore: 템플릿 첫 커밋",
    ]);
    check(
      "hook-commit",
      /\[통과\] 커밋 게이트 통과/.test(commitOutput),
      "pre-commit 통과 기록이 없습니다",
    );
    const { head } = gitState();
    check("hook-commit", head !== null, "첫 커밋이 만들어지지 않았습니다");
    absentCheck("hook-commit");
    note(`hook-commit: 첫 커밋 ${head.slice(0, 12)} — 타입·색 차단 뒤 통과`);
    const messageOutput = blockedCommit(
      "hook-message",
      "bad commit message",
      /커밋 메시지가 규칙에 맞지 않습니다/,
      ["--allow-empty"],
    );
    check(
      "hook-message",
      /\[통과\] 커밋 게이트 통과/.test(messageOutput),
      "pre-commit 이 통과한 뒤 메시지에서 막혀야 합니다",
    );

    log(`✓ 템플릿 스모크 통과 (${mode})`);
    return { ok: true, mode, evidence: evidenceLines };
  } catch (error) {
    if (!(error instanceof SmokeError)) throw error;
    const detail = sanitize(
      [error.message, failedTests(error.output), tail(error.output)]
        .filter(Boolean)
        .join("\n")
        .trimEnd(),
      { work },
    );
    log(`✗ 템플릿 스모크 실패 (${mode}) — 단계 ${error.phase}\n${detail}`);
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      const file = join(evidence, `smoke-${mode}-failure.log`);
      writeFileSync(
        file,
        sanitize(
          [
            `mode: ${mode}`,
            `phase: ${error.phase}`,
            ...evidenceLines.map((line) => `ok: ${line}`),
            "",
            error.message,
            "",
            error.output,
          ].join("\n"),
          { work },
        ),
      );
      log(`  실패 기록: ${file}`);
    }
    return { ok: false, mode, phase: error.phase, evidence: evidenceLines };
  } finally {
    // 스모크가 끝난 뒤에도 .git/objects 에 쓰는 프로세스가 남아 ENOTEMPTY 가 난다. 다시 지워 보고,
    // 그래도 안 되면 경고만 한다. 임시 폴더를 못 지운 것이 스모크 결과를 뒤집으면 안 된다.
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      log(`  경고: 임시 폴더를 지우지 못했습니다 — ${work} (${error.code})`);
    }
  }
}

export function parseArgs(argv) {
  const options = { modes: [...MODES] };
  const queue = [...argv];
  const seen = new Set();
  while (queue.length) {
    const flag = queue.shift();
    if (flag !== "--mode" && flag !== "--evidence") throw new Error(`모르는 인자입니다: ${flag}`);
    if (seen.has(flag)) throw new Error(`${flag} 를 두 번 적었습니다`);
    seen.add(flag);
    const value = queue.shift();
    if (value === undefined || value.startsWith("-")) throw new Error(`${flag} 에 값이 없습니다`);
    if (flag === "--mode") {
      if (!MODES.includes(value))
        throw new Error(`--mode 는 web·mobile·both 중 하나입니다: ${value}`);
      options.modes = [value];
    } else options.evidence = resolve(value);
  }
  return options;
}

export function main(
  argv,
  { env = process.env, log = console.log, error = console.error, ...deps } = {},
) {
  if (env[GUARD]) {
    error(`✗ 템플릿 스모크 안에서 스모크를 다시 부를 수 없습니다(${GUARD}).`);
    return 2;
  }
  const options = (() => {
    try {
      return parseArgs(argv);
    } catch (problem) {
      error(`✗ ${problem.message}\n${USAGE}`);
      return null;
    }
  })();
  if (!options) return 2;
  const source = deps.source ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  // 처음 실패한 mode 에서 멈춘다.
  const failed = options.modes.find(
    (mode) =>
      !runSmoke({ ...deps, mode, source, baseEnv: env, log, evidence: options.evidence }).ok,
  );
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
