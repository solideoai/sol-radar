#!/usr/bin/env node
// 환경 점검 — `pnpm run doctor` · `pnpm run doctor --json`
// (`pnpm doctor` 는 pnpm 자체의 설정 점검이라 이 스크립트를 부르려면 `run` 을 붙인다.)
//
// 읽기만 한다. 설치·정리·서식·파일 생성·git 설정 변경·네트워크·DB 접속을 하지 않고, 검증을 대신하지도 않는다.
// 보는 것:
// - 실행 중인 Node 가 루트 package.json 의 engines.node 범위 안인가. 범위 안이어도 .nvmrc 에 적은 자리수까지
//   (22 → 주 버전, 22.11 → 부 버전까지) 다르면 경고만 낸다. .nvmrc 는 CI·배포가 쓰는 고정값이다.
//   engines 가 없으면 .nvmrc 와 같아야 통과다.
// - 실행 중인 pnpm 이 루트 packageManager 의 pnpm@<버전> 과 같은가, 있는 Node 프로젝트도 같은 버전을 고정했는가
// - 루트와 있는 프로젝트의 락파일, 선언한 직접 의존성이 node_modules 에서 실제로 풀리는가, 스크립트가 부르는 실행 파일
//   (락파일과 importer 가 정확히 맞는지는 `pnpm install --frozen-lockfile` 이 본다)
// - 커밋 게이트가 켜져 있는가 (scripts/git-hooks.mjs 의 탐침 — 설치기와 같은 기준)
// - husky 가 원본 훅보다 먼저 실행하는 사용자 파일(init.sh)이 없는가 (경로만 본다. 내용은 읽지 않는다)
// - 생성물이 정본과 맞는가 (tokens-gen·db-types-gen 의 --check. DB 타입은 PGlite 메모리 DB 만 쓴다)
// Supabase 설정·env 파일·실제 DB 는 보지 않는다. 설정이 없어도 웹·앱 시작 화면은 열린다.
//
// 종료: 0 통과(경고 포함) · 1 선행 조건·생성물·훅 문제 · 2 잘못된 인자
// --json: { version: 1, ok, checks: [{ id, status: "passed"|"warning"|"failed"|"skipped", message, remedy? }] }
// warning 은 통과로 치되(ok 는 그대로) 해결 방법을 붙인다.
import { spawnCommandSync } from "./command.mjs";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findHuskyInit,
  HOOKS_PATH,
  HUSKY_DIR,
  huskyInitPath,
  inspectGitHooks,
} from "./git-hooks.mjs";
import { loadConfig, presentProjects } from "./project-config.mjs";

const USAGE = "사용법: pnpm run doctor [--json]";
const ROOT_INSTALL = "루트에서 `pnpm install`";

const passed = (id, message) => ({ id, status: "passed", message });
const warning = (id, message, remedy) => ({ id, status: "warning", message, remedy });
const failed = (id, message, remedy) => ({ id, status: "failed", message, remedy });
const skipped = (id, message) => ({ id, status: "skipped", message });
// 선행 조건이 없어 돌리지 못한 검사. 건너뛰었지만 통과로 치지 않는다.
const blocked = (id, message, remedy) => ({ ...skipped(id, message), remedy, blocking: true });

const defaultRun = (command, args, { cwd, env }) =>
  spawnCommandSync(command, args, { cwd, env, encoding: "utf8" });

// 일반 파일의 내용. 없음·디렉터리·권한 없음은 그 이유를 error 로 돌려준다(던지지 않는다).
const readText = (path) => {
  try {
    if (!statSync(path).isFile()) return { error: "일반 파일이 아닙니다" };
    return { value: readFileSync(path, "utf8") };
  } catch (error) {
    return { error: error.code === "ENOENT" ? "파일이 없습니다" : (error.code ?? error.message) };
  }
};

// package.json 은 JSON 객체여야 한다. null·배열·문자열은 구문이 맞아도 쓸 수 없다.
const readJson = (path) => {
  const text = readText(path);
  if (text.error) return text;
  try {
    const value = JSON.parse(text.value);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? { value }
      : {
          error: `JSON 객체가 아닙니다 (${value === null ? "null" : Array.isArray(value) ? "배열" : typeof value})`,
        };
  } catch (error) {
    return { error: error.message };
  }
};

const outputLines = (result) =>
  `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const listed = (items, limit = 5) =>
  items.length > limit
    ? `${items.slice(0, limit).join(", ")} 외 ${items.length - limit}개`
    : items.join(", ");

// ── Node · pnpm ─────────────────────────────────────────────────

// .nvmrc 는 22 · 22.11 · 22.11.0 처럼 숫자 버전만 받는다. 적은 자리수까지만 비교한다.
// engines.node 의 버전 한 칸도 같은 모양이다(빠진 자리는 "그 아래 아무거나").
const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

// 1~3 자리 숫자 → 그 버전이 덮는 반열린 구간 [low, high). 22 → [22.0.0, 23.0.0), 22.13.0 → [22.13.0, 22.13.1)
const span = (match) => {
  const parts = match
    .slice(1)
    .filter((part) => part !== undefined)
    .map(Number);
  const pad = (numbers) => [...numbers, 0, 0, 0].slice(0, 3);
  return {
    low: pad(parts),
    high: pad([...parts.slice(0, -1), parts.at(-1) + 1]),
  };
};

const compare = (a, b) => a.map((n, i) => n - b[i]).find((d) => d !== 0) ?? 0;

// 비교식 하나 → 버전 판정 함수. 모르는 모양이면 null.
const COMPARATOR = /^(\^|>=|<=|>|<|=)?(v?[\d.]+)$/;
const comparator = (token) => {
  const [, operator = "=", version = ""] = COMPARATOR.exec(token) ?? [];
  const match = VERSION.exec(version);
  if (!match) return null;
  const { low, high } = span(match);
  const tests = {
    "=": (v) => compare(v, low) >= 0 && compare(v, high) < 0,
    ">=": (v) => compare(v, low) >= 0,
    ">": (v) => compare(v, high) >= 0,
    "<": (v) => compare(v, low) < 0,
    "<=": (v) => compare(v, high) < 0,
    // ^0.x 는 semver 에서 뜻이 달라 읽지 않는다
    "^": low[0] > 0 ? (v) => compare(v, low) >= 0 && v[0] === low[0] : null,
  };
  return tests[operator];
};

// package.json engines.node 의 작은 판정기. 이 저장소가 쓰는 형식만 읽는다(새 의존성 없이):
// `||` 로 나눈 묶음 중 하나라도 맞으면 된다. 묶음 안은 공백으로 나눈 비교식(^ >= > <= < = 또는 기호 없는 버전)이 모두 맞아야 한다.
// ~·x·*·하이픈 범위·프리릴리스·^0.x 처럼 읽지 못하는 형식이면 참·거짓 대신 null 을 돌려준다.
export const nodeRangeAllows = (range, version) => {
  const running = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (typeof range !== "string" || !running) return null;
  const sets = range.split("||").map((set) =>
    set
      .trim()
      .replace(/(\^|[<>]=?|=)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean)
      .map(comparator),
  );
  if (sets.some((set) => set.length === 0 || set.includes(null))) return null;
  const actual = running.slice(1).map(Number);
  return sets.some((set) => set.every((test) => test(actual)));
};

const RANGE_EXAMPLE = '"^22.13.0 || ^24.3.0"';

const checkNode = (root, nodeVersion, engines) => {
  const nvmrc = readText(join(root, ".nvmrc"));
  if (nvmrc.error)
    return failed(
      "node",
      `.nvmrc 를 읽지 못해(${nvmrc.error}) 이 저장소가 기대하는 Node 버전을 알 수 없습니다.`,
      "루트 .nvmrc 를 Node 버전(예: 22) 한 줄만 적은 일반 파일로 두세요.",
    );
  const wanted = nvmrc.value.trim();
  const match = VERSION.exec(wanted);
  if (!match)
    return failed(
      "node",
      `.nvmrc 의 값 ${JSON.stringify(wanted)} 를 버전으로 읽지 못했습니다.`,
      ".nvmrc 에 22 · 22.11 · 22.11.0 처럼 숫자 버전만 적으세요.",
    );
  const parts = match.slice(1).filter((part) => part !== undefined);
  const actual = nodeVersion.replace(/^v/, "").split(".");
  const pinned = parts.every((part, i) => Number(part) === Number(actual[i]));

  if (engines === undefined)
    return pinned
      ? passed("node", `실행 중인 Node ${nodeVersion} 이 .nvmrc(${wanted})와 맞습니다.`)
      : failed(
          "node",
          `실행 중인 Node 는 ${nodeVersion} 이고, .nvmrc 는 ${wanted} 입니다.`,
          `\`nvm use\`(또는 쓰는 버전 관리자)로 Node ${wanted} 로 바꾼 뒤 다시 실행하세요.`,
        );

  const allowed = nodeRangeAllows(engines, nodeVersion);
  if (allowed === null)
    return failed(
      "node",
      `루트 package.json 의 engines.node ${JSON.stringify(engines)} 를 읽지 못했습니다. doctor 는 ||·^·>=·>·<=·<·= 와 숫자 버전만 읽습니다.`,
      `engines.node 를 ${RANGE_EXAMPLE} 처럼 그 형식으로 적으세요. 다른 형식이 꼭 필요하면 scripts/doctor.mjs 의 nodeRangeAllows 를 넓히고 시험을 더하세요.`,
    );
  if (!allowed)
    return failed(
      "node",
      `실행 중인 Node ${nodeVersion} 은 루트 package.json 의 engines.node(${engines}) 범위 밖입니다.`,
      `\`nvm use\`(또는 쓰는 버전 관리자)로 .nvmrc 의 Node ${wanted} 로 바꾼 뒤 다시 실행하세요. 범위 안의 다른 Node 도 됩니다.`,
    );
  return pinned
    ? passed(
        "node",
        `실행 중인 Node ${nodeVersion} 이 engines.node(${engines})를 만족하고 .nvmrc(${wanted})와 맞습니다.`,
      )
    : warning(
        "node",
        `실행 중인 Node ${nodeVersion} 은 engines.node(${engines}) 안이라 통과합니다. 다만 .nvmrc(${wanted})와 달라 CI·배포와 결과가 다를 수 있습니다.`,
        `CI 와 같은 Node 로 확인하려면 \`nvm use\`(또는 쓰는 버전 관리자)로 Node ${wanted} 로 바꾸세요.`,
      );
};

const PNPM_PIN = /^pnpm@(\d+\.\d+\.\d+)(?:\+\S+)?$/;
const pinOf = (pkg) => PNPM_PIN.exec(pkg?.packageManager ?? "")?.[1] ?? null;

// `pnpm run doctor` 로 불렸으면 pnpm 이 남긴 user agent 가 지금 도는 pnpm 이다. 아니면 직접 묻는다.
// corepack 이 고정 버전을 내려받지 않게 네트워크를 막는다 — 점검은 아무것도 받아 오지 않는다.
const runningPnpm = (root, env, run) => {
  const agent = /(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/.exec(env.npm_config_user_agent ?? "");
  if (agent) return { version: agent[1] };
  const result = run("pnpm", ["--version"], {
    cwd: root,
    env: { ...env, COREPACK_ENABLE_NETWORK: "0" },
  });
  if (result.error || result.status !== 0)
    return {
      error:
        result.error?.code === "ENOENT"
          ? "pnpm 명령을 찾을 수 없습니다"
          : (outputLines(result)[0] ?? `종료 코드 ${result.status}`),
    };
  return { version: result.stdout.trim() };
};

const checkPnpm = (root, pin, env, run) => {
  if (!pin)
    return failed(
      "pnpm",
      "루트 package.json 의 packageManager 가 pnpm@<버전> 형식이 아닙니다.",
      '루트 package.json 에 "packageManager": "pnpm@9.15.9" 처럼 고정 버전을 적으세요.',
    );
  const running = runningPnpm(root, env, run);
  if (running.error)
    return failed(
      "pnpm",
      `pnpm 을 실행하지 못했습니다 (${running.error}).`,
      `\`corepack enable\` 로 packageManager 의 pnpm@${pin} 을 켠 뒤 다시 실행하세요.`,
    );
  return running.version === pin
    ? passed("pnpm", `실행 중인 pnpm ${running.version} 이 packageManager 와 맞습니다.`)
    : failed(
        "pnpm",
        `실행 중인 pnpm 은 ${running.version} 이고, packageManager 는 pnpm@${pin} 입니다.`,
        `\`corepack enable\` 뒤 새 터미널에서 다시 실행하세요 (packageManager 의 pnpm@${pin} 을 씁니다).`,
      );
};

const checkProjectPin = (id, label, pkg, pin) => {
  if (!pin) return skipped(id, "루트 packageManager 를 읽지 못해 비교하지 않습니다.");
  const own = pinOf(pkg);
  if (own === pin) return passed(id, `${label} 도 pnpm@${pin} 을 고정합니다.`);
  return failed(
    id,
    pkg.packageManager
      ? `${label} 의 packageManager 는 ${pkg.packageManager} 이고, 루트는 pnpm@${pin} 입니다.`
      : `${label} package.json 에 packageManager 가 없습니다.`,
    `${label} package.json 의 packageManager 를 루트와 같은 "pnpm@${pin}" 으로 맞추세요.`,
  );
};

// ── 락파일 · 의존성 · 실행 파일 ─────────────────────────────────

// 선언한 이름이 node_modules 에서 실제 패키지(package.json 이 있는 폴더)로 풀리는가. 문제가 없으면 null.
const dependencyProblem = (dir, name) => {
  const path = join(dir, "node_modules", name);
  try {
    lstatSync(path);
  } catch {
    return "없음";
  }
  try {
    return existsSync(join(realpathSync(path), "package.json")) ? null : "package.json 없음";
  } catch {
    return "깨진 링크";
  }
};

// 스크립트가 맨 앞에 부르는 명령 중 node_modules/.bin 에서 와야 하는 것. 셸·런타임·경로는 뺀다.
const SYSTEM_COMMANDS = new Set(["pnpm", "npm", "npx", "node", "bash", "sh", "corepack", "git"]);
const scriptCommands = (pkg) =>
  [
    ...new Set(
      Object.values(pkg.scripts ?? {}).flatMap((script) =>
        String(script)
          .split(/&&|\|\||[;|]/)
          .map((part) =>
            part
              .trim()
              .split(/\s+/)
              .find((word) => !/^\w+=/.test(word)),
          )
          .filter((word) => word && !SYSTEM_COMMANDS.has(word) && !word.includes("/")),
      ),
    ),
  ].sort();

// node_modules/.bin 의 실행 파일이 실제로 실행 가능한가. 문제가 없으면 null. 실행해 보지는 않는다.
// POSIX 는 pnpm 이 심는 실행 비트 있는 일반 파일(또는 그리로 가는 링크)을, Windows 는 <이름>.cmd 를 본다.
const binProblem = (dir, command) => {
  const path = join(
    dir,
    "node_modules/.bin",
    process.platform === "win32" ? `${command}.cmd` : command,
  );
  try {
    lstatSync(path);
  } catch {
    return "없음";
  }
  try {
    if (!statSync(path).isFile()) return "일반 파일 아님";
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return null;
  } catch (error) {
    return error.code === "ENOENT" ? "깨진 링크" : "실행 권한 없음";
  }
};

const packageChecks = (scope, label, dir, pkg, install) => {
  const lockfile = existsSync(join(dir, "pnpm-lock.yaml"))
    ? passed(`${scope}.lockfile`, `${label} pnpm-lock.yaml 이 있습니다.`)
    : failed(
        `${scope}.lockfile`,
        `${label} pnpm-lock.yaml 이 없습니다.`,
        `${install} 로 락파일을 만들고 함께 커밋하세요.`,
      );

  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
  if (!existsSync(join(dir, "node_modules")))
    return [
      lockfile,
      failed(
        `${scope}.dependencies`,
        `${label} 의존성이 설치되지 않았습니다 (node_modules 없음).`,
        `${install} 을 실행하세요.`,
      ),
      skipped(`${scope}.executables`, "의존성을 설치한 뒤 확인합니다."),
    ];

  const problems = names
    .map((name) => [name, dependencyProblem(dir, name)])
    .filter(([, problem]) => problem)
    .map(([name, problem]) => `${name}(${problem})`);
  const dependencies =
    problems.length === 0
      ? passed(`${scope}.dependencies`, `${label} 직접 의존성 ${names.length}개가 모두 풀립니다.`)
      : failed(
          `${scope}.dependencies`,
          `${label} 직접 의존성 중 풀리지 않는 것: ${listed(problems)}.`,
          `${install} 을 다시 실행하세요.`,
        );

  const commands = scriptCommands(pkg);
  const broken = commands
    .map((command) => [command, binProblem(dir, command)])
    .filter(([, problem]) => problem);
  const executables =
    broken.length === 0
      ? passed(
          `${scope}.executables`,
          commands.length === 0
            ? `${label} 스크립트가 부르는 실행 파일이 없습니다.`
            : `${label} 실행 파일을 찾았습니다: ${commands.join(", ")}.`,
        )
      : failed(
          `${scope}.executables`,
          `${label} node_modules/.bin 에서 실행할 수 없는 파일: ${listed(broken.map(([command, problem]) => `${command}(${problem})`))}.`,
          broken.every(([, problem]) => problem === "없음")
            ? `${install} 을 다시 실행하세요.`
            : `${label} node_modules 를 지운 뒤 ${install} 로 다시 설치하세요 (설치된 실행 파일의 종류·권한이 깨졌습니다).`,
        );

  return [lockfile, dependencies, executables];
};

const rootChecks = (root, rootPkg) =>
  rootPkg.error
    ? [
        failed(
          "root.package",
          `루트 package.json 을 읽지 못했습니다 (${rootPkg.error}).`,
          "루트 package.json 을 올바른 JSON 으로 되돌리세요.",
        ),
      ]
    : packageChecks("root", "루트", root, rootPkg.value, ROOT_INSTALL);

// 설정에 등록한 프로젝트 중 marker 가 package.json 인 것만 Node(pnpm) 프로젝트로 본다.
const projectChecks = (root, config, pin) => {
  const present = new Set(presentProjects(root, config).map((project) => project.name));
  return config.verification.projects.flatMap((project) => {
    const label = `${project.directory}/`;
    if (!present.has(project.name)) return [skipped(project.name, `${label} 가 없어 건너뜁니다.`)];
    if (project.marker !== "package.json")
      return [
        skipped(
          project.name,
          `${label} 는 Node 프로젝트가 아니라(marker: ${project.marker}) 건너뜁니다. 그 스택의 설치 명령으로 확인하세요.`,
        ),
      ];
    const dir = join(root, project.directory);
    const pkg = readJson(join(dir, "package.json"));
    if (pkg.error)
      return [
        failed(
          `${project.name}.package`,
          `${label}package.json 을 읽지 못했습니다 (${pkg.error}).`,
          `${label}package.json 을 올바른 JSON 으로 되돌리세요.`,
        ),
      ];
    return [
      checkProjectPin(`${project.name}.packageManager`, label, pkg.value, pin),
      ...packageChecks(
        project.name,
        label,
        dir,
        pkg.value,
        `\`pnpm -C ${project.directory} install\``,
      ),
    ];
  });
};

// ── 커밋 게이트 ─────────────────────────────────────────────────

const REINSTALL_HOOKS =
  "루트에서 `node scripts/install-hooks.mjs`(또는 `pnpm install`)를 다시 돌리세요.";

const checkHooks = (root, env) => {
  if (env.HUSKY === "0")
    return skipped(
      "git.hooks",
      "HUSKY=0 이라 커밋 게이트를 확인하지 않습니다. 이 상태로는 커밋을 검사하지 않습니다.",
    );
  const state = inspectGitHooks({ cwd: root, env });
  if (!state.repo)
    return failed(
      "git.hooks",
      "아직 git 저장소가 아니라 커밋 게이트가 꺼져 있습니다.",
      "`git init` 뒤 루트에서 `pnpm install` 을 다시 돌리면 켜집니다.",
    );
  if (state.error)
    return failed(
      "git.hooks",
      state.error,
      state.error.includes("git 명령을 찾을 수 없습니다")
        ? "git 을 설치한 뒤 루트에서 `pnpm install` 을 다시 돌리세요."
        : "이 저장소의 최상위 폴더에서 `node scripts/install-hooks.mjs`(또는 `pnpm install`)를 다시 돌리세요.",
    );
  if (state.problems.length === 0)
    return passed("git.hooks", `커밋 게이트가 켜져 있습니다 (core.hooksPath=${HOOKS_PATH}).`);

  const { value, scope } = state.hooksPath;
  const conflict = value !== null && !state.active;
  return failed(
    "git.hooks",
    state.problems.join(" "),
    !conflict
      ? REINSTALL_HOOKS
      : scope === "local" || scope === "worktree"
        ? `기존 훅을 ${HUSKY_DIR}/ 로 옮기고 \`git config --${scope} --unset core.hooksPath\` 로 지운 뒤 ${REINSTALL_HOOKS}`
        : `\`git config --local core.hooksPath ${HOOKS_PATH}\` 로 이 저장소만 게이트를 쓰게 한 뒤 ${REINSTALL_HOOKS}`,
  );
};

// husky 디스패처가 원본 훅보다 먼저 source 하는 사용자 파일. 있으면 훅이 실제로 돈다고 볼 수 없다.
// git 저장소 여부와 상관없이 본다(그 PC 의 모든 husky 저장소에 걸린다). 내용은 읽지도 출력하지도 않는다.
const checkHuskyInit = (root, env) => {
  if (env.HUSKY === "0")
    return skipped(
      "git.husky-init",
      "HUSKY=0 이라 husky 가 훅보다 먼저 실행하는 파일(init.sh)을 확인하지 않습니다.",
    );
  const found = findHuskyInit({ cwd: root, env });
  return found === null
    ? passed(
        "git.husky-init",
        `husky 가 훅보다 먼저 실행하는 파일이 없습니다 (${huskyInitPath({ cwd: root, env })}).`,
      )
    : failed(
        "git.husky-init",
        `husky 가 훅보다 먼저 실행하는 파일이 있습니다: ${found}. 저장소 밖 파일이라 게이트가 보지 못하고, 그 안의 exit 나 HUSKY=0 한 줄이면 커밋 게이트가 돌지 않습니다.`,
        "내용을 직접 확인한 뒤 그 파일을 지우거나 다른 이름으로 옮기세요. 훅에 필요한 PATH(nvm 등)를 넣어 둔 것이면 셸 시작 파일로 옮기고 터미널에서 커밋하세요.",
      );
};

// ── 생성물 ──────────────────────────────────────────────────────

const GENERATORS = [
  {
    id: "generated.tokens",
    script: "scripts/tokens-gen.mjs",
    needs: [],
    remedy:
      "`pnpm tokens` 로 다시 만드세요 (생성물을 직접 고쳤다면 그 수정을 design/tokens.json 으로 옮기세요).",
  },
  {
    id: "generated.db-types",
    script: "scripts/db-types-gen.mjs",
    needs: ["@electric-sql/pglite"],
    remedy:
      "`pnpm db:types` 로 다시 만드세요 (생성물을 직접 고쳤다면 그 수정을 새 마이그레이션으로 옮기세요).",
  },
];

const checkGenerator = (root, env, run, generator) => {
  const missing = generator.needs.filter((name) => dependencyProblem(root, name));
  if (missing.length > 0)
    return blocked(
      generator.id,
      `루트 의존성(${missing.join(", ")})이 없어 검사하지 못했습니다.`,
      `${ROOT_INSTALL} 을 실행하세요.`,
    );
  // 생성기는 argv[1] 과 자기 경로를 비교해 직접 실행됐는지 안다. 심볼릭 링크(/var → /private/var 등)를
  // 낀 경로로 부르면 그 비교가 어긋나 아무것도 검사하지 않고 0 으로 끝나므로, 실제 경로로 부른다.
  const script = (() => {
    try {
      return realpathSync(join(root, generator.script));
    } catch {
      return null;
    }
  })();
  if (!script)
    return failed(
      generator.id,
      `${generator.script} 가 없어 생성물을 검사하지 못했습니다.`,
      `${generator.script} 를 되살린 뒤 다시 실행하세요.`,
    );
  const result = run(process.execPath, [script, "--check"], { cwd: root, env });
  const lines = outputLines(result);
  if (!result.error && result.status === 0)
    return passed(generator.id, lines.at(-1) ?? "생성물이 정본과 맞습니다.");
  return failed(generator.id, generatorFailure(generator, result, lines), generator.remedy);
};

// 생성기가 아무것도 말하지 않고 죽어도(신호·출력 없는 종료) 무엇이 어떻게 끝났는지 적는다.
const generatorFailure = (generator, result, lines) => {
  const name = `\`node ${generator.script} --check\``;
  const ending = result.error
    ? `${name} 를 실행하지 못했습니다 (${result.error.code ?? result.error.message})`
    : result.signal
      ? `${name} 가 신호 ${result.signal} 로 중단됐습니다`
      : `${name} 가 종료 코드 ${result.status ?? "없음"} 로 실패했습니다`;
  return lines.length > 0 ? `${ending}: ${lines.join(" ")}` : `${ending} (출력 없음).`;
};

// ── 모으기 · 출력 ───────────────────────────────────────────────

const loadProjectConfig = (root) => {
  try {
    const config = loadConfig(root);
    return {
      config,
      check: passed(
        "config",
        `verify.config.json 을 읽었습니다 (프로젝트: ${config.verification.projects.map((project) => project.name).join("·") || "없음"}).`,
      ),
    };
  } catch (error) {
    return {
      config: null,
      check: failed(
        "config",
        `verify.config.json 을 읽지 못했습니다: ${error.message}`,
        "verify.config.json 을 고친 뒤 다시 실행하세요 (형식은 README 의 '내 프로젝트에 맞추기').",
      ),
    };
  }
};

const collectChecks = ({ root, env, nodeVersion, run }) => {
  const { config, check: configCheck } = loadProjectConfig(root);
  const rootPkg = readJson(join(root, "package.json"));
  const pin = pinOf(rootPkg.value);
  return [
    configCheck,
    checkNode(root, nodeVersion, rootPkg.value?.engines?.node),
    checkPnpm(root, pin, env, run),
    ...rootChecks(root, rootPkg),
    ...(config ? projectChecks(root, config, pin) : []),
    checkHooks(root, env),
    checkHuskyInit(root, env),
    ...GENERATORS.map((generator) => checkGenerator(root, env, run, generator)),
    skipped(
      "database",
      "Supabase 설정·env 파일·실제 DB 는 검사하지 않습니다. 설정이 없어도 웹·앱 시작 화면은 열립니다.",
    ),
  ];
};

const MARK = { passed: "✓", warning: "!", failed: "✗", skipped: "-" };

const verdict = (report) => {
  const warnings = report.checks.filter((check) => check.status === "warning").length;
  if (!report.ok)
    return "❌ 환경 점검 실패 — 위의 → 해결 방법을 따른 뒤 `pnpm run doctor` 를 다시 돌리세요.";
  return warnings === 0
    ? "✅ 환경 점검 통과"
    : `✅ 환경 점검 통과 (경고 ${warnings}건 — 위의 → 를 확인하세요)`;
};

export const formatReport = (report) =>
  [
    ...report.checks.flatMap((check) => [
      `${MARK[check.status]} ${check.id} — ${check.message}`,
      ...(check.remedy ? [`    → ${check.remedy}`] : []),
    ]),
    "",
    verdict(report),
  ].join("\n");

// 결과만 돌려주고 출력하지 않는다. 시험은 env·nodeVersion·run(명령 실행)을 바꿔 끼운다.
export const runDoctor = ({
  root = join(dirname(fileURLToPath(import.meta.url)), ".."),
  args = [],
  env = process.env,
  nodeVersion = process.versions.node,
  run = defaultRun,
} = {}) => {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0)
    return { code: 2, stdout: "", stderr: `알 수 없는 인자: ${unknown.join(" ")}\n${USAGE}` };

  const checks = collectChecks({ root, env, nodeVersion, run });
  const ok = checks.every((check) => check.status !== "failed" && !check.blocking);
  const report = {
    version: 1,
    ok,
    checks: checks.map(({ blocking, ...check }) => check),
  };
  return {
    code: ok ? 0 : 1,
    report,
    stdout: args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report),
    stderr: "",
  };
};

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (process.argv[1] && isMain()) {
  const { code, stdout, stderr } = runDoctor({ args: process.argv.slice(2) });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  process.exitCode = code;
}
