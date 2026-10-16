// 환경 점검(scripts/doctor.mjs) 시험. 실행: 루트에서 `pnpm test`
//
// 임시 폴더(경로에 공백 포함)에 점검기와 그 의존 스크립트·정본·생성물을 복사한 작은 저장소를 만든다.
// web·mobile 은 가짜 의존성 하나와 가짜 실행 파일 하나로 "설치된 상태"를 흉내 낸다. 루트 의존성은
// 이 저장소의 node_modules 를 링크해 생성물 검사(--check)를 실제로 돌린다. pnpm 은 버전만 말하는 가짜다.
// 전역 git 설정은 임시 파일로 바꿔 끼워 사용자 설정을 건드리지 않는다.
//
// Node·pnpm 버전과 생성물 결과처럼 바꿔 끼울 수 있는 것은 runDoctor 에 주입해 빠르게 보고,
// 종료 코드·JSON·읽기 전용은 CLI 로 본다.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { nodeRangeAllows, runDoctor } from "../doctor.mjs";
import { GATE_HOOKS, HOOKS_PATH } from "../git-hooks.mjs";
import { pathWith, permissionSkip, signalSkip, writeExecutable } from "../test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PIN = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager.replace(
  "pnpm@",
  "",
);
const NODE_MAJOR = process.versions.node.split(".")[0];

const SCRIPTS = [
  "doctor.mjs",
  "git-hooks.mjs",
  "project-config.mjs",
  "tokens-gen.mjs",
  "db-types-gen.mjs",
  "supabase-pglite.mjs",
  "migrations.mjs",
  "command.mjs",
];
const GENERATED = {
  web: ["web/app/globals.css", "web/lib/database.types.ts"],
  mobile: ["mobile/theme/tokens.ts", "mobile/lib/database.types.ts"],
};
// 래퍼는 husky 가 쓰는 바이트에 끝 줄바꿈 하나를 더한 모양(같은 래퍼로 본다), 디스패처는 설치된 husky 의 원본 그대로다.
const WRAPPER = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';
const DISPATCHER = readFileSync(
  join(dirname(fileURLToPath(import.meta.resolve("husky"))), "husky"),
  "utf8",
);

// 커밋 게이트 안에서 돌 때 git 이 넘긴 GIT_*, CI 의 HUSKY=0, `pnpm test` 가 남긴 user agent 를 걷어낸다.
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("GIT_") && key !== "HUSKY" && key !== "npm_config_user_agent",
  ),
);

const git = (env, cwd, ...args) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

// doctor 가 보는 실행 파일 자리. Windows 는 pnpm 이 심는 <이름>.cmd 를 본다(scripts/doctor.mjs).
const fakeCli = (dir) =>
  join(dir, "node_modules/.bin", process.platform === "win32" ? "fake-cli.cmd" : "fake-cli");

const write = (path, content, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
};

// 생성물은 web·mobile 이 모두 있는 임시 사본에서 실제 생성기를 한 번 돌려 만든다.
// 한쪽 플랫폼을 지운 프로젝트에서도 두 플랫폼의 fixture 를 만들 수 있다.
const generatedSource = mkdtempSync(join(tmpdir(), "doctor-generated-"));
after(() => rmSync(generatedSource, { recursive: true, force: true }));
SCRIPTS.forEach((file) =>
  write(join(generatedSource, "scripts", file), readFileSync(join(root, "scripts", file))),
);
["verify.config.json", "package.json", "design/tokens.json"].forEach((rel) =>
  write(join(generatedSource, rel), readFileSync(join(root, rel))),
);
cpSync(join(root, "supabase/migrations"), join(generatedSource, "supabase/migrations"), {
  recursive: true,
});
Object.keys(GENERATED).forEach((name) =>
  write(join(generatedSource, name, "package.json"), "{}\n"),
);
symlinkSync(join(root, "node_modules"), join(generatedSource, "node_modules"), "junction");
["tokens-gen.mjs", "db-types-gen.mjs"].forEach((file) => {
  const result = spawnSync(process.execPath, [join("scripts", file)], {
    cwd: generatedSource,
    env: inheritedEnv,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${file} 실패\n${result.stdout}${result.stderr}`);
});

// 설치된 Node 프로젝트 하나. 스크립트는 가짜 실행 파일(fake-cli)과 pnpm 을 부른다.
const createPlatform = (project, name) => {
  const dir = join(project, name);
  write(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        private: true,
        packageManager: `pnpm@${PIN}`,
        scripts: { dev: "fake-cli dev", verify: "pnpm format:check && fake-cli check" },
        dependencies: { "dep-a": "1.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  write(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  write(join(dir, "node_modules/dep-a/package.json"), '{ "name": "dep-a" }\n');
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
  writeExecutable(join(dir, "node_modules/.bin/fake-cli"), "#!/bin/sh\nexit 0\n");
  GENERATED[name].forEach((rel) => {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    copyFileSync(join(generatedSource, rel), join(project, rel));
  });
};

const writeGateFiles = (project) => {
  write(join(project, HOOKS_PATH, "h"), DISPATCHER);
  GATE_HOOKS.forEach((hook) => {
    write(join(project, HOOKS_PATH, hook), WRAPPER, 0o755);
    write(join(project, ".husky", hook), `echo ${hook}\n`);
  });
};

const enableGate = (env, project) => git(env, project, "config", "core.hooksPath", HOOKS_PATH);

// platforms: 둘 앱 폴더. rootModules: 루트 의존성 설치 여부. gitState: none(zip) · repo(init 만) · gate(게이트 켜짐)
const createFixture = (
  t,
  { platforms = ["web", "mobile"], rootModules = true, gitState = "gate" } = {},
) => {
  const base = mkdtempSync(join(tmpdir(), "doctor test "));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const globalConfig = join(base, "global gitconfig");
  const bin = join(base, "fake bin");
  writeFileSync(
    globalConfig,
    "[user]\n\tname = doctor-test\n\temail = doctor-test@example.invalid\n[commit]\n\tgpgsign = false\n",
  );
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, "pnpm"), `#!/bin/sh\necho "\${FAKE_PNPM_VERSION:-${PIN}}"\n`);
  const env = {
    ...inheritedEnv,
    PATH: pathWith(bin, inheritedEnv.PATH),
    XDG_CONFIG_HOME: join(base, "xdg config"),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };

  const project = join(base, "my project");
  mkdirSync(join(project, "scripts"), { recursive: true });
  SCRIPTS.forEach((file) =>
    copyFileSync(join(root, "scripts", file), join(project, "scripts", file)),
  );
  ["verify.config.json", "package.json", "design/tokens.json"].forEach((rel) => {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    copyFileSync(join(root, rel), join(project, rel));
  });
  cpSync(join(root, "supabase/migrations"), join(project, "supabase/migrations"), {
    recursive: true,
  });
  write(join(project, ".nvmrc"), `${NODE_MAJOR}\n`);
  write(join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  if (rootModules)
    symlinkSync(join(root, "node_modules"), join(project, "node_modules"), "junction");
  platforms.forEach((name) => createPlatform(project, name));

  if (gitState !== "none") {
    git(env, project, "init", "-q", "-b", "main");
    writeGateFiles(project);
    if (gitState === "gate") enableGate(env, project);
  }
  return { base, bin, env, globalConfig, project };
};

const runCli = (cwd, env, args = [], script = join(cwd, "scripts/doctor.mjs")) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const runJson = (cwd, env, script) => {
  const result = runCli(cwd, env, ["--json"], script);
  return { ...result, report: JSON.parse(result.stdout) };
};

// 생성물 검사를 실제로 돌리지 않는 실행기. pnpm 은 주어진 버전을 말하고, 생성기는 통과로 끝난다.
const fakeRun =
  ({ pnpm = PIN } = {}) =>
  (command) =>
    command === "pnpm"
      ? { status: 0, stdout: `${pnpm}\n`, stderr: "" }
      : { status: 0, stdout: "✓ 일치\n", stderr: "" };

const doctor = (fixture, options = {}) =>
  runDoctor({ root: fixture.project, env: fixture.env, run: fakeRun(), ...options });

const byId = (report, id) => report.checks.find((check) => check.id === id);

// XDG_CONFIG_HOME 을 뺀 환경. husky 디스패처가 $HOME/.config 로 돌아가는 경우를 만든다.
const withoutXdg = (env) =>
  Object.fromEntries(Object.entries(env).filter(([key]) => key !== "XDG_CONFIG_HOME"));
const notPassed = (report) =>
  report.checks
    .filter((check) => check.status !== "passed")
    .map((check) => `${check.id}:${check.status}`);

// 폴더 안 모든 항목의 종류·권한·내용. 링크는 따라가지 않는다.
const snapshot = (dir) => {
  const walk = (path) => {
    const stat = lstatSync(path);
    const rel = relative(dir, path) || ".";
    if (stat.isSymbolicLink()) return [[rel, `link:${readlinkSync(path)}`]];
    if (stat.isDirectory())
      return [
        [rel, `dir:${stat.mode}`],
        ...readdirSync(path)
          .sort()
          .flatMap((name) => walk(join(path, name))),
      ];
    return [
      [rel, `file:${stat.mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`],
    ];
  };
  return walk(dir);
};

describe("인자와 JSON 형식", () => {
  it("모르는 인자는 아무것도 검사하지 않고 종료 2 와 사용법을 낸다", (t) => {
    const fixture = createFixture(t, { platforms: [], gitState: "none" });
    const before = snapshot(fixture.project);

    for (const args of [["--fix"], ["--json", "--verbose"], ["json"]]) {
      const { code, stdout, stderr } = runCli(fixture.project, fixture.env, args);
      assert.equal(code, 2, args.join(" "));
      assert.equal(stdout, "");
      assert.match(stderr, /알 수 없는 인자[\s\S]*사용법: pnpm run doctor \[--json\]/);
    }
    assert.deepEqual(snapshot(fixture.project), before);
  });

  it("--json 은 version·ok·checks 만 담고, 상태는 네 가지이며 해결 방법은 문제·경고에만 붙는다", (t) => {
    const fixture = createFixture(t, { rootModules: false });
    const { code, report, stdout } = runJson(fixture.project, fixture.env);

    assert.equal(code, 1);
    assert.deepEqual(Object.keys(report), ["version", "ok", "checks"]);
    assert.equal(report.version, 1);
    assert.equal(report.ok, false);
    report.checks.forEach((check) => {
      assert.ok(["passed", "warning", "failed", "skipped"].includes(check.status), check.id);
      assert.equal(typeof check.id, "string");
      assert.equal(typeof check.message, "string");
      assert.deepEqual(Object.keys(check).slice(0, 3), ["id", "status", "message"]);
      if (check.status === "passed") assert.equal(check.remedy, undefined, check.id);
      if (check.status !== "passed" && check.status !== "skipped")
        assert.equal(typeof check.remedy, "string", check.id);
    });
    assert.doesNotMatch(stdout, /blocking/);
  });
});

describe("DB 설정 없이 설치된 구성은 통과한다", () => {
  it("web·mobile 둘 다 — 생성물 검사까지 실제로 돌고, env 파일 내용은 읽지 않으며, 아무것도 바꾸지 않는다", (t) => {
    const fixture = createFixture(t);
    write(join(fixture.project, "web/.env.local"), "SUPABASE_SERVICE_ROLE_KEY=never-print-me\n");
    const before = snapshot(fixture.project);

    const { code, report, stdout } = runJson(fixture.project, fixture.env);
    const human = runCli(fixture.project, fixture.env);

    assert.equal(code, 0, stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(notPassed(report), ["database:skipped"]);
    assert.deepEqual(
      report.checks.map((check) => check.id),
      [
        "config",
        "node",
        "pnpm",
        "root.lockfile",
        "root.dependencies",
        "root.executables",
        "web.packageManager",
        "web.lockfile",
        "web.dependencies",
        "web.executables",
        "mobile.packageManager",
        "mobile.lockfile",
        "mobile.dependencies",
        "mobile.executables",
        "git.hooks",
        "git.husky-init",
        "generated.tokens",
        "generated.db-types",
        "database",
      ],
    );
    assert.match(byId(report, "web.executables").message, /fake-cli/);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /✅ 환경 점검 통과/);
    assert.doesNotMatch(`${stdout}${human.stdout}${human.stderr}`, /never-print-me/);
    assert.deepEqual(snapshot(fixture.project), before);
  });

  it("mobile 을 지운 web 단독 구성", (t) => {
    const fixture = createFixture(t, { platforms: ["web"] });

    const { code, report, stdout } = runJson(fixture.project, fixture.env);

    assert.equal(code, 0, stdout);
    assert.deepEqual(notPassed(report), ["mobile:skipped", "database:skipped"]);
    assert.match(byId(report, "mobile").message, /mobile\/ 가 없어 건너뜁니다/);
  });

  it("web 을 지운 mobile 단독 구성", (t) => {
    const fixture = createFixture(t, { platforms: ["mobile"] });

    const { code, report, stdout } = runJson(fixture.project, fixture.env);

    assert.equal(code, 0, stdout);
    assert.deepEqual(notPassed(report), ["web:skipped", "database:skipped"]);
  });

  it("linked worktree(.git 이 파일)에서도 같은 기준으로 통과한다", (t) => {
    const fixture = createFixture(t, { gitState: "repo" });
    git(fixture.env, fixture.project, "add", "-A");
    git(fixture.env, fixture.project, "commit", "-q", "-m", "base");
    enableGate(fixture.env, fixture.project);
    const worktree = join(fixture.base, "linked work tree");
    git(fixture.env, fixture.project, "worktree", "add", "-q", "--detach", worktree);

    const { code, report, stdout } = runJson(worktree, fixture.env);

    assert.equal(statSync(join(worktree, ".git")).isFile(), true);
    assert.equal(code, 0, stdout);
    assert.equal(byId(report, "git.hooks").status, "passed");
  });

  it("다른 스택(marker 가 package.json 이 아닌 프로젝트)은 Node 패키지로 보지 않고 건너뛴다", (t) => {
    const fixture = createFixture(t, { platforms: ["web"] });
    const configPath = join(fixture.project, "verify.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.verification.projects.push({
      name: "backend",
      directory: "backend",
      marker: "pyproject.toml",
      verify: { command: "uv", args: ["run", "pytest"] },
      quick: { command: "uv", args: ["run", "pytest"] },
    });
    writeFileSync(configPath, JSON.stringify(config));
    write(join(fixture.project, "backend/pyproject.toml"), "[project]\n");

    const { code, report } = doctor(fixture);

    assert.equal(code, 0);
    assert.equal(byId(report, "backend").status, "skipped");
    assert.match(
      byId(report, "backend").message,
      /Node 프로젝트가 아니라\(marker: pyproject\.toml\)/,
    );
    assert.equal(
      report.checks.some((check) => check.id.startsWith("backend.")),
      false,
    );
  });
});

describe("engines.node 판정기는 이 저장소가 쓰는 범위 형식만 읽는다", () => {
  const ALLOWS = [
    [
      "^22.13.0 || ^24.3.0",
      {
        "20.19.4": false,
        "22.12.9": false,
        "22.13.0": true,
        "22.23.1": true,
        "23.5.0": false,
        "24.2.9": false,
        "24.3.0": true,
        "24.16.0": true,
        "25.0.0": false,
      },
    ],
    [">=22 <25", { "21.9.9": false, "22.0.0": true, "24.99.0": true, "25.0.0": false }],
    [">= 22.13.0", { "22.12.0": false, "22.13.0": true, "26.0.0": true }],
    [
      "^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0",
      { "20.19.3": false, "20.19.4": true, "21.0.0": false, "25.1.0": true },
    ],
    ["22", { "21.99.0": false, "22.0.0": true, "22.99.1": true, "23.0.0": false }],
    ["22.13", { "22.12.9": false, "22.13.5": true, "22.14.0": false }],
    ["=22.13.0", { "22.13.0": true, "22.13.1": false }],
    ["v22.13.0", { "22.13.0": true, "22.13.1": false }],
    ["^22", { "22.0.0": true, "22.50.0": true, "23.0.0": false }],
    [">22", { "22.99.0": false, "23.0.0": true }],
    ["<=22", { "22.99.0": true, "23.0.0": false }],
    [">22.13", { "22.13.9": false, "22.14.0": true }],
    ["<22.13", { "22.12.9": true, "22.13.0": false }],
  ];
  for (const [range, versions] of ALLOWS)
    it(`${range}`, () => {
      for (const [version, expected] of Object.entries(versions)) {
        assert.equal(nodeRangeAllows(range, version), expected, `${range} ∋ ${version}`);
        assert.equal(nodeRangeAllows(range, `v${version}`), expected, `${range} ∋ v${version}`);
      }
    });

  it("모르는 형식은 참·거짓 대신 null 로 돌려준다", () => {
    const unreadable = [
      "",
      "  ",
      "||",
      "^22 ||",
      "~22.13.0",
      "22.x",
      "*",
      "22 - 24",
      "^0.12.0",
      ">=22 <",
      "latest",
      "lts/*",
      "22.13.0-rc.1",
      "22.13.0.1",
    ];
    for (const range of unreadable) assert.equal(nodeRangeAllows(range, "22.13.0"), null, range);
  });
});

describe("Node 는 루트 engines.node 범위로 보고, .nvmrc 와 다르면 경고만 한다", () => {
  const RANGE = "^22.13.0 || ^24.3.0";
  // engines 를 주면 그 값을 engines.node 로 적고(undefined 면 engines 를 지운다), 안 주면 RANGE 다.
  const withNode = (t, options = {}) => {
    const { nvmrc = "22\n" } = options;
    const engines = "engines" in options ? options.engines : RANGE;
    const fixture = createFixture(t, { platforms: [] });
    const path = join(fixture.project, "package.json");
    const rest = Object.fromEntries(
      Object.entries(JSON.parse(readFileSync(path, "utf8"))).filter(([key]) => key !== "engines"),
    );
    const pkg = engines === undefined ? rest : { ...rest, engines: { node: engines } };
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    write(join(fixture.project, ".nvmrc"), nvmrc);
    return fixture;
  };

  it("범위 안이고 .nvmrc 와 주 버전이 같으면 통과한다", (t) => {
    const { code, report } = doctor(withNode(t), { nodeVersion: "22.20.1" });

    assert.equal(code, 0);
    assert.deepEqual(byId(report, "node"), {
      id: "node",
      status: "passed",
      message: `실행 중인 Node 22.20.1 이 engines.node(${RANGE})를 만족하고 .nvmrc(22)와 맞습니다.`,
    });
  });

  it("Node 24 는 범위 안이면 통과하고, .nvmrc(22)와 다르다는 경고만 낸다", (t) => {
    const fixture = withNode(t);

    const { code, report, stdout } = doctor(fixture, { nodeVersion: "24.16.0" });

    assert.equal(code, 0);
    assert.equal(report.ok, true);
    assert.deepEqual(byId(report, "node"), {
      id: "node",
      status: "warning",
      message: `실행 중인 Node 24.16.0 은 engines.node(${RANGE}) 안이라 통과합니다. 다만 .nvmrc(22)와 달라 CI·배포와 결과가 다를 수 있습니다.`,
      remedy:
        "CI 와 같은 Node 로 확인하려면 `nvm use`(또는 쓰는 버전 관리자)로 Node 22 로 바꾸세요.",
    });
    assert.match(stdout, /^! node — /m);
    assert.match(stdout, /✅ 환경 점검 통과 \(경고 1건/);
  });

  it("범위 밖이면 실패하고 .nvmrc 의 Node 로 바꾸라고 알린다", (t) => {
    const fixture = withNode(t);

    for (const version of ["20.19.4", "22.12.0", "23.1.0", "24.2.0", "25.0.0"]) {
      const { code, report } = doctor(fixture, { nodeVersion: version });
      assert.equal(code, 1, version);
      assert.deepEqual(byId(report, "node"), {
        id: "node",
        status: "failed",
        message: `실행 중인 Node ${version} 은 루트 package.json 의 engines.node(${RANGE}) 범위 밖입니다.`,
        remedy:
          "`nvm use`(또는 쓰는 버전 관리자)로 .nvmrc 의 Node 22 로 바꾼 뒤 다시 실행하세요. 범위 안의 다른 Node 도 됩니다.",
      });
    }
  });

  it("부 버전까지 적은 .nvmrc 는 부 버전까지 같아야 경고가 없다", (t) => {
    const fixture = withNode(t, { nvmrc: "v22.13\n" });

    assert.equal(byId(doctor(fixture, { nodeVersion: "22.13.4" }).report, "node").status, "passed");
    assert.equal(
      byId(doctor(fixture, { nodeVersion: "22.14.0" }).report, "node").status,
      "warning",
    );
  });

  it("못 읽는 engines.node 는 통과시키지 않고 읽는 형식을 알린다", (t) => {
    for (const engines of ["~22.13.0", "22.x", "*", "22 - 24", ""]) {
      const { code, report } = doctor(withNode(t, { engines }), { nodeVersion: "22.20.1" });
      const check = byId(report, "node");
      assert.equal(code, 1, engines);
      assert.equal(check.status, "failed", engines);
      assert.equal(
        check.message,
        `루트 package.json 의 engines.node ${JSON.stringify(engines)} 를 읽지 못했습니다. doctor 는 ||·^·>=·>·<=·<·= 와 숫자 버전만 읽습니다.`,
      );
      assert.match(check.remedy, /"\^22\.13\.0 \|\| \^24\.3\.0"/);
    }

    const number = doctor(withNode(t, { engines: 22 }), { nodeVersion: "22.20.1" });
    assert.equal(number.code, 1);
    assert.match(byId(number.report, "node").message, /engines\.node 22 를 읽지 못했습니다/);
  });

  it("engines 가 없으면 .nvmrc 에 적은 자리수까지 같아야 한다", (t) => {
    const fixture = withNode(t, { engines: undefined });

    const { code, report } = doctor(fixture, { nodeVersion: "24.1.0" });

    assert.equal(code, 1);
    assert.deepEqual(byId(report, "node"), {
      id: "node",
      status: "failed",
      message: "실행 중인 Node 는 24.1.0 이고, .nvmrc 는 22 입니다.",
      remedy: "`nvm use`(또는 쓰는 버전 관리자)로 Node 22 로 바꾼 뒤 다시 실행하세요.",
    });
    assert.equal(byId(doctor(fixture, { nodeVersion: "22.20.1" }).report, "node").status, "passed");
  });

  it("숫자 버전이 아니거나 .nvmrc 가 없으면 범위 안이어도 실패한다", (t) => {
    const alias = doctor(withNode(t, { nvmrc: "lts/*\n" }), { nodeVersion: "22.20.1" });
    assert.equal(alias.code, 1);
    assert.match(byId(alias.report, "node").message, /버전으로 읽지 못했습니다/);

    const fixture = withNode(t);
    rmSync(join(fixture.project, ".nvmrc"));
    const missing = doctor(fixture, { nodeVersion: "22.20.1" });
    assert.equal(missing.code, 1);
    assert.match(byId(missing.report, "node").remedy, /\.nvmrc/);
  });
});

describe("템플릿의 Node 범위는 설치된 프레임워크가 받는 범위 안이다", () => {
  const readPkg = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
  const range = readPkg("package.json").engines?.node;
  // 주 버전 18~26 의 부 버전 0~30, 수 버전 0·1·4·9 를 훑는다.
  const samples = Array.from({ length: 9 }, (_, i) => i + 18).flatMap((major) =>
    Array.from({ length: 31 }, (_, minor) => minor).flatMap((minor) =>
      [0, 1, 4, 9].map((patch) => `${major}.${minor}.${patch}`),
    ),
  );

  it("루트 engines.node 가 있고 판정기가 읽는 형식이다", () => {
    assert.equal(typeof range, "string");
    assert.notEqual(nodeRangeAllows(range, "22.0.0"), null, range);
  });

  it(".nvmrc 의 주 버전 최근 릴리스가 범위 안이다 (CI 가 그 Node 로 돈다)", () => {
    const major = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0];
    assert.equal(nodeRangeAllows(range, `${major}.30.0`), true, `${range} ∌ ${major}.30.0`);
  });

  for (const [dir, dep] of [
    ["web", "next"],
    ["mobile", "react-native"],
  ])
    it(`${dir} 의 ${dep} 가 요구하는 Node 를 넘지 않는다`, (t) => {
      const manifest = join(root, dir, "node_modules", dep, "package.json");
      if (!existsSync(manifest)) return t.skip(`${dir}/node_modules/${dep} 가 없다`);
      const wanted = JSON.parse(readFileSync(manifest, "utf8")).engines?.node;
      assert.notEqual(nodeRangeAllows(wanted, "22.13.0"), null, `${dep} engines ${wanted}`);
      const outside = samples.filter(
        (version) => nodeRangeAllows(range, version) && !nodeRangeAllows(wanted, version),
      );
      assert.deepEqual(outside.slice(0, 5), [], `${range} 가 ${dep}(${wanted}) 밖을 받는다`);
    });

  it("mobile/package.json 의 engines.node 는 루트와 같다", (t) => {
    if (!existsSync(join(root, "mobile/package.json"))) return t.skip("mobile 이 없는 복사본");
    assert.equal(readPkg("mobile/package.json").engines?.node, range);
  });

  // Vercel 은 Root Directory(web)의 engines.node 가 있으면 프로젝트 설정의 Node 를 덮고, 범위 안의 가장 높은
  // 주 버전을 고른다(>=20.0.0 → 24.x). 범위를 넣으면 .nvmrc·CI 의 22 와 배포 Node 가 갈라진다.
  it("web/package.json 에는 engines 를 두지 않는다 (Vercel 의 Node 는 프로젝트 설정이 정한다)", (t) => {
    if (!existsSync(join(root, "web/package.json"))) return t.skip("web 이 없는 복사본");
    assert.equal(
      readPkg("web/package.json").engines?.node,
      undefined,
      "web/package.json 의 engines.node 는 Vercel 의 Node 를 바꾼다. Node 는 Vercel 프로젝트 설정(22.x)에서 정한다",
    );
  });
});

describe("pnpm 은 packageManager 의 고정 버전과 같아야 한다", () => {
  it("다른 pnpm 이 돌면 실패하고 corepack 을 안내한다", (t) => {
    const fixture = createFixture(t, { platforms: [] });

    const { code, report } = doctor(fixture, { run: fakeRun({ pnpm: "10.0.0" }) });

    assert.equal(code, 1);
    assert.equal(byId(report, "pnpm").status, "failed");
    assert.match(byId(report, "pnpm").message, new RegExp(`10\\.0\\.0.*pnpm@${PIN}`));
    assert.match(byId(report, "pnpm").remedy, /corepack enable/);
  });

  it("`pnpm run doctor` 로 불렸으면 user agent 의 버전을 믿고 pnpm 을 다시 부르지 않는다", (t) => {
    const fixture = createFixture(t, { platforms: [] });
    const calls = [];
    const run = (command, args, options) => {
      calls.push(command);
      return fakeRun({ pnpm: "1.0.0" })(command, args, options);
    };

    const { report } = doctor(fixture, {
      env: { ...fixture.env, npm_config_user_agent: `pnpm/${PIN} npm/? node/v22.0.0 darwin arm64` },
      run,
    });

    assert.equal(byId(report, "pnpm").status, "passed");
    assert.equal(calls.includes("pnpm"), false);
  });

  it("가짜 pnpm 을 PATH 에서 찾아 버전을 묻는다 (CLI)", (t) => {
    const fixture = createFixture(t, { platforms: [] });

    const { code, report } = runJson(fixture.project, {
      ...fixture.env,
      FAKE_PNPM_VERSION: "8.15.0",
    });

    assert.equal(code, 1);
    assert.match(byId(report, "pnpm").message, /실행 중인 pnpm 은 8\.15\.0/);
  });

  it("pnpm 이 없으면 실패한다", (t) => {
    const fixture = createFixture(t, { platforms: [] });
    const run = (command, args, options) =>
      command === "pnpm"
        ? { error: Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }) }
        : fakeRun()(command, args, options);

    const { report } = doctor(fixture, { run });

    assert.match(byId(report, "pnpm").message, /pnpm 명령을 찾을 수 없습니다/);
    assert.match(byId(report, "pnpm").remedy, /corepack enable/);
  });

  it("있는 프로젝트의 packageManager 가 루트와 다르거나 없으면 그 프로젝트를 짚는다", (t) => {
    const fixture = createFixture(t);
    const edit = (name, change) => {
      const path = join(fixture.project, name, "package.json");
      writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8")))));
    };
    edit("web", (pkg) => ({ ...pkg, packageManager: "pnpm@8.0.0" }));
    edit("mobile", ({ packageManager, ...pkg }) => pkg);

    const { code, report } = doctor(fixture);

    assert.equal(code, 1);
    assert.deepEqual(notPassed(report), [
      "web.packageManager:failed",
      "mobile.packageManager:failed",
      "database:skipped",
    ]);
    assert.match(byId(report, "web.packageManager").message, /pnpm@8\.0\.0/);
    assert.match(byId(report, "mobile.packageManager").remedy, new RegExp(`pnpm@${PIN}`));
  });
});

describe("락파일·의존성·실행 파일", () => {
  it("프로젝트 node_modules 가 없으면 설치를 안내하고 실행 파일 검사는 미룬다", (t) => {
    const fixture = createFixture(t);
    rmSync(join(fixture.project, "web/node_modules"), { recursive: true });

    const { code, report } = doctor(fixture);

    assert.equal(code, 1);
    assert.deepEqual(notPassed(report), [
      "web.dependencies:failed",
      "web.executables:skipped",
      "database:skipped",
    ]);
    assert.match(byId(report, "web.dependencies").remedy, /`pnpm -C web install`/);
  });

  it("깨진 링크·빠진 의존성·빠진 실행 파일을 각각 짚는다", (t) => {
    const fixture = createFixture(t);
    const mobile = join(fixture.project, "mobile");
    rmSync(join(mobile, "node_modules/dep-a"), { recursive: true });
    symlinkSync(join(fixture.base, "nowhere"), join(mobile, "node_modules/dep-a"), "junction");
    const web = join(fixture.project, "web");
    rmSync(join(web, "node_modules/dep-a"), { recursive: true });
    rmSync(fakeCli(web));

    const { report } = doctor(fixture);

    assert.match(byId(report, "mobile.dependencies").message, /dep-a\(깨진 링크\)/);
    assert.match(byId(report, "web.dependencies").message, /dep-a\(없음\)/);
    assert.match(byId(report, "web.executables").message, /fake-cli/);
    assert.match(byId(report, "web.executables").remedy, /`pnpm -C web install`/);
  });

  it("실행 파일이 실행 비트 없는 파일이거나 디렉터리면 실행할 수 없다고 짚는다 (CLI)", (t) => {
    const breakages = [
      ["실행 권한 없음", (path) => chmodSync(path, 0o644)],
      [
        "일반 파일 아님",
        (path) => {
          rmSync(path);
          mkdirSync(path);
        },
      ],
    ];
    const applicable = breakages.filter(
      ([problem]) => !(permissionSkip && problem === "실행 권한 없음"),
    );
    for (const [problem, breakBin] of applicable) {
      const fixture = createFixture(t, { platforms: ["web"] });
      breakBin(fakeCli(join(fixture.project, "web")));

      const r = runJson(fixture.project, fixture.env);

      assert.equal(r.code, 1);
      assert.equal(byId(r.report, "web.executables").status, "failed");
      assert.match(
        byId(r.report, "web.executables").message,
        new RegExp(`fake-cli\\(${problem}\\)`),
      );
      assert.match(
        byId(r.report, "web.executables").remedy,
        /web\/ node_modules 를 지운 뒤 `pnpm -C web install`/,
      );
    }
  });

  it("락파일이 없으면 루트·프로젝트를 각각 짚는다", (t) => {
    const fixture = createFixture(t);
    rmSync(join(fixture.project, "pnpm-lock.yaml"));
    rmSync(join(fixture.project, "mobile/pnpm-lock.yaml"));

    const { code, report } = doctor(fixture);

    assert.equal(code, 1);
    assert.deepEqual(notPassed(report), [
      "root.lockfile:failed",
      "mobile.lockfile:failed",
      "database:skipped",
    ]);
    assert.match(byId(report, "root.lockfile").remedy, /루트에서 `pnpm install`/);
  });

  it("루트 의존성이 없으면 DB 타입 검사는 건너뛰지만 전체는 실패다 (CLI)", (t) => {
    const fixture = createFixture(t, { rootModules: false });

    const { code, report } = runJson(fixture.project, fixture.env);

    assert.equal(code, 1);
    assert.equal(report.ok, false);
    assert.deepEqual(notPassed(report), [
      "root.dependencies:failed",
      "root.executables:skipped",
      "generated.db-types:skipped",
      "database:skipped",
    ]);
    assert.match(byId(report, "generated.db-types").message, /@electric-sql\/pglite/);
    assert.match(byId(report, "generated.db-types").remedy, /루트에서 `pnpm install`/);
    assert.equal(byId(report, "generated.tokens").status, "passed");
  });
});

describe("설정과 생성물", () => {
  it("verify.config.json 이 잘못되면 실패(종료 1)하고 프로젝트 검사는 하지 않는다", (t) => {
    const fixture = createFixture(t);
    const configPath = join(fixture.project, "verify.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), version: 2 }),
    );

    const { code, report } = runJson(fixture.project, fixture.env);

    assert.equal(code, 1);
    assert.equal(byId(report, "config").status, "failed");
    assert.match(byId(report, "config").message, /version/);
    assert.equal(
      report.checks.some((check) => /^(web|mobile)\b/.test(check.id)),
      false,
    );
  });

  it("생성물이 정본과 어긋나면 그 파일을 짚고 다시 만드는 명령을 알린다 — 고치지는 않는다 (CLI)", (t) => {
    const fixture = createFixture(t);
    write(join(fixture.project, "web/app/globals.css"), "/* 손으로 고침 */\n");
    rmSync(join(fixture.project, "mobile/lib/database.types.ts"));
    const before = snapshot(fixture.project);

    const { code, report } = runJson(fixture.project, fixture.env);

    assert.equal(code, 1);
    assert.match(byId(report, "generated.tokens").message, /web\/app\/globals\.css/);
    assert.match(byId(report, "generated.tokens").remedy, /`pnpm tokens`/);
    assert.match(byId(report, "generated.db-types").message, /mobile\/lib\/database\.types\.ts/);
    assert.match(byId(report, "generated.db-types").remedy, /`pnpm db:types`/);
    assert.deepEqual(snapshot(fixture.project), before);
  });

  it("생성기가 출력 없이 신호로 죽으면 생성기 이름과 신호를 적는다 (주입)", (t) => {
    const fixture = createFixture(t, { platforms: [] });
    const run = (command, args, options) =>
      command === "pnpm"
        ? fakeRun()(command, args, options)
        : { status: null, signal: "SIGTERM", stdout: "", stderr: "" };

    const { code, report } = doctor(fixture, { run });
    const check = byId(report, "generated.tokens");

    assert.equal(code, 1);
    assert.equal(check.status, "failed");
    assert.ok(check.message.trim().length > 0);
    assert.match(check.message, /scripts\/tokens-gen\.mjs --check.*SIGTERM/);
    assert.match(check.remedy, /`pnpm tokens`/);
  });

  it("생성기를 실행하지 못했거나 출력 없이 0 이 아닌 코드로 끝나도 실패로 적는다 (주입)", (t) => {
    const fixture = createFixture(t, { platforms: [] });
    const results = [
      [
        { error: Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }) },
        /실행하지 못했습니다 \(ENOENT\)/,
      ],
      [
        { status: 3, signal: null, stdout: "", stderr: "" },
        /종료 코드 3 로 실패했습니다 \(출력 없음\)/,
      ],
    ];
    for (const [result, message] of results) {
      const run = (command, args, options) =>
        command === "pnpm" ? fakeRun()(command, args, options) : result;

      const { code, report } = doctor(fixture, { run });

      assert.equal(code, 1);
      assert.equal(byId(report, "generated.tokens").status, "failed");
      assert.match(byId(report, "generated.tokens").message, message);
      assert.match(byId(report, "generated.db-types").message, /scripts\/db-types-gen\.mjs/);
    }
  });

  it(
    "실제 생성기가 스스로 SIGTERM 으로 죽어도 빈 안내가 아니다 (CLI, 임시 사본의 생성기만 바꾼다)",
    { skip: signalSkip },
    (t) => {
      const fixture = createFixture(t);
      write(
        join(fixture.project, "scripts/tokens-gen.mjs"),
        'process.kill(process.pid, "SIGTERM");\n',
      );

      const r = runJson(fixture.project, fixture.env);
      const check = byId(r.report, "generated.tokens");

      assert.equal(r.code, 1);
      assert.equal(check.status, "failed");
      assert.ok(check.message.trim().length > 0);
      assert.match(check.message, /SIGTERM/);
      assert.match(check.remedy, /`pnpm tokens`/);
    },
  );
});

describe("선행 파일이 잘못돼도 JSON 진단을 낸다", () => {
  it("web/package.json 이 JSON null 이면 그 검사가 실패하고 stdout 은 유효한 JSON 이다 (CLI)", (t) => {
    const fixture = createFixture(t);
    writeFileSync(join(fixture.project, "web/package.json"), "null\n");

    const result = runCli(fixture.project, fixture.env, ["--json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.version, 1);
    assert.equal(byId(parsed, "web.package").status, "failed");
    assert.match(byId(parsed, "web.package").message, /JSON 객체가 아닙니다 \(null\)/);
    assert.match(byId(parsed, "web.package").remedy, /web\/package\.json/);
    assert.equal(byId(parsed, "mobile.packageManager").status, "passed");
  });

  it("루트 package.json 이 배열이면 루트 검사가 실패한다 (CLI)", (t) => {
    const fixture = createFixture(t, { platforms: [] });
    writeFileSync(join(fixture.project, "package.json"), "[]\n");

    const result = runCli(fixture.project, fixture.env, ["--json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(parsed.ok, false);
    assert.equal(byId(parsed, "root.package").status, "failed");
    assert.match(byId(parsed, "root.package").message, /JSON 객체가 아닙니다 \(배열\)/);
    assert.equal(byId(parsed, "pnpm").status, "failed");
  });

  it(".nvmrc 가 디렉터리면 node 검사가 실패하고 stdout 은 유효한 JSON 이다 (CLI)", (t) => {
    const fixture = createFixture(t);
    rmSync(join(fixture.project, ".nvmrc"));
    mkdirSync(join(fixture.project, ".nvmrc"));

    const result = runCli(fixture.project, fixture.env, ["--json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(parsed.ok, false);
    assert.equal(byId(parsed, "node").status, "failed");
    assert.match(byId(parsed, "node").message, /\.nvmrc 를 읽지 못해\(일반 파일이 아닙니다\)/);
    assert.match(byId(parsed, "node").remedy, /\.nvmrc/);
  });
});

describe("커밋 게이트", () => {
  it("zip 으로 받은 폴더(.git 없음)는 git init 과 설치를 안내하며 실패하고 .git 을 만들지 않는다", (t) => {
    const fixture = createFixture(t, { gitState: "none" });

    const { code, report } = doctor(fixture);

    assert.equal(code, 1);
    assert.deepEqual(notPassed(report), ["git.hooks:failed", "database:skipped"]);
    assert.match(byId(report, "git.hooks").remedy, /`git init` 뒤 루트에서 `pnpm install`/);
    assert.equal(existsSync(join(fixture.project, ".git")), false);
  });

  it("HUSKY=0 이면 명시적으로 건너뛰고, 나머지가 맞으면 통과다", (t) => {
    const fixture = createFixture(t, { gitState: "none" });

    const { code, report } = doctor(fixture, { env: { ...fixture.env, HUSKY: "0" } });

    assert.equal(code, 0);
    assert.equal(byId(report, "git.hooks").status, "skipped");
    assert.match(byId(report, "git.hooks").message, /HUSKY=0/);
  });

  it("로컬 custom hooksPath 는 덮지 않고, 지우는 법을 알리며 실패한다", (t) => {
    const fixture = createFixture(t, { gitState: "repo" });
    git(fixture.env, fixture.project, "config", "core.hooksPath", ".githooks");

    const { code, report } = runJson(fixture.project, fixture.env);

    assert.equal(code, 1);
    assert.match(byId(report, "git.hooks").message, /\.githooks \(local\)/);
    assert.match(byId(report, "git.hooks").remedy, /git config --local --unset core\.hooksPath/);
    assert.equal(
      git(fixture.env, fixture.project, "config", "--local", "core.hooksPath"),
      ".githooks",
    );
  });

  it("전역 hooksPath 가 이기면 이 저장소만 게이트를 쓰는 법을 알린다", (t) => {
    const fixture = createFixture(t, { gitState: "repo" });
    git(fixture.env, fixture.project, "config", "--global", "core.hooksPath", "/opt/team hooks");
    const globalBefore = readFileSync(fixture.globalConfig, "utf8");

    const { report } = doctor(fixture);

    assert.match(byId(report, "git.hooks").message, /\/opt\/team hooks \(global\)/);
    assert.match(byId(report, "git.hooks").remedy, /git config --local core\.hooksPath \.husky\/_/);
    assert.equal(readFileSync(fixture.globalConfig, "utf8"), globalBefore);
  });

  it("래퍼가 실행 비트를 잃으면 다시 설치하라고 안내한다", { skip: permissionSkip }, (t) => {
    const fixture = createFixture(t);
    chmodSync(join(fixture.project, HOOKS_PATH, "pre-commit"), 0o644);

    const { report } = doctor(fixture);

    assert.match(byId(report, "git.hooks").message, /pre-commit\(실행 래퍼\)/);
    assert.match(byId(report, "git.hooks").remedy, /node scripts\/install-hooks\.mjs/);
  });

  it("원본 훅을 부르지 않는 디스패처·래퍼는 켜진 것이 아니다 — 루트 의존성이 없어도 같다 (CLI, 읽기 전용)", (t) => {
    const shims = [
      ["h", "#!/bin/sh\nexit 0\n", /\.husky\/_\/h\(husky 디스패처\)/],
      ["pre-commit", '#!/bin/sh\nexit 0\n. "$(dirname "$0")/h"\n', /pre-commit\(실행 래퍼\)/],
    ];
    for (const rootModules of [true, false])
      for (const [file, content, problem] of shims) {
        const fixture = createFixture(t, { rootModules });
        write(join(fixture.project, HOOKS_PATH, file), content);
        const before = snapshot(fixture.project);

        const r = runJson(fixture.project, fixture.env);

        assert.equal(r.code, 1);
        assert.equal(byId(r.report, "git.hooks").status, "failed");
        assert.match(byId(r.report, "git.hooks").message, problem);
        assert.match(byId(r.report, "git.hooks").remedy, /node scripts\/install-hooks\.mjs/);
        assert.deepEqual(snapshot(fixture.project), before);
      }
  });

  it("husky 가 훅보다 먼저 실행하는 init.sh 가 있으면 경로만 짚고, 내용은 읽지도 내지도 않는다 (CLI, 읽기 전용)", (t) => {
    const fixture = createFixture(t);
    const init = join(fixture.env.XDG_CONFIG_HOME, "husky/init.sh");
    write(init, "exit 0 # never-print-me\n");
    // 읽기 권한을 빼 둔다. 점검이 내용을 읽으려 했다면 실패 이유가 달라진다.
    chmodSync(init, 0o000);
    const before = snapshot(fixture.project);

    const json = runJson(fixture.project, fixture.env);
    const human = runCli(fixture.project, fixture.env);

    assert.equal(json.code, 1);
    assert.equal(human.code, 1);
    const check = byId(json.report, "git.husky-init");
    assert.equal(check.status, "failed");
    assert.ok(check.message.includes(init), check.message);
    assert.match(check.message, /husky 가 훅보다 먼저 실행하는 파일/);
    assert.match(check.remedy, /지우거나[\s\S]*옮기/);
    assert.equal(byId(json.report, "git.hooks").status, "passed");
    assert.ok(human.stdout.includes(init));
    assert.doesNotMatch(`${json.stdout}${human.stdout}${human.stderr}`, /never-print-me/);
    assert.deepEqual(snapshot(fixture.project), before);
    chmodSync(init, 0o644);
    assert.equal(readFileSync(init, "utf8"), "exit 0 # never-print-me\n");
  });

  it("XDG_CONFIG_HOME 이 비었거나 없으면 HOME/.config 아래를 보고, 있으면 그쪽만 본다 (디스패처와 같은 규칙)", (t) => {
    const fixture = createFixture(t);
    const home = join(fixture.base, "home dir");
    const init = join(home, ".config/husky/init.sh");
    write(init, "true\n");

    for (const env of [
      { ...withoutXdg(fixture.env), HOME: home },
      { ...fixture.env, HOME: home, XDG_CONFIG_HOME: "" },
    ]) {
      const check = byId(doctor(fixture, { env }).report, "git.husky-init");
      assert.equal(check.status, "failed", JSON.stringify(env.XDG_CONFIG_HOME));
      assert.ok(check.message.includes(init), check.message);
    }
    const xdgWins = doctor(fixture, { env: { ...fixture.env, HOME: home } });
    assert.equal(byId(xdgWins.report, "git.husky-init").status, "passed");
    assert.equal(xdgWins.code, 0);
  });

  it("init.sh 이름의 디렉터리는 디스패처가 source 하지 않으므로 문제가 아니다", (t) => {
    const fixture = createFixture(t);
    mkdirSync(join(fixture.env.XDG_CONFIG_HOME, "husky/init.sh"), { recursive: true });

    const { code, report } = doctor(fixture);

    assert.equal(code, 0);
    assert.equal(byId(report, "git.husky-init").status, "passed");
  });

  it("점검이 보는 경로는 husky 디스패처가 실제로 source 하는 경로다 — 거기 exit 0 한 줄이면 훅이 꺼진다", (t) => {
    const fixture = createFixture(t);
    write(join(fixture.project, ".husky/pre-commit"), "echo 원본 훅이 막음\nexit 1\n");
    const home = join(fixture.base, "home dir");
    mkdirSync(home);
    const cases = [
      [fixture.env, join(fixture.env.XDG_CONFIG_HOME, "husky/init.sh")],
      [{ ...withoutXdg(fixture.env), HOME: home }, join(home, ".config/husky/init.sh")],
      [{ ...fixture.env, HOME: home, XDG_CONFIG_HOME: "" }, join(home, ".config/husky/init.sh")],
    ];
    const hook = (env) =>
      spawnSync("sh", [join(HOOKS_PATH, "pre-commit")], {
        cwd: fixture.project,
        env,
        encoding: "utf8",
      }).status;

    for (const [env, init] of cases) {
      assert.notEqual(hook(env), 0, "원본 훅이 돌아 막아야 한다");
      assert.equal(byId(doctor(fixture, { env }).report, "git.husky-init").status, "passed");

      write(init, "exit 0\n");
      assert.equal(hook(env), 0, `${init} 가 원본 훅을 건너뛰게 했다`);
      const check = byId(doctor(fixture, { env }).report, "git.husky-init");
      assert.equal(check.status, "failed");
      assert.ok(check.message.includes(init), check.message);
      rmSync(init);
    }
  });

  it("HUSKY=0 이면 init.sh 도 확인하지 않고 건너뛴다", (t) => {
    const fixture = createFixture(t);
    write(join(fixture.env.XDG_CONFIG_HOME, "husky/init.sh"), "true\n");

    const { code, report } = doctor(fixture, { env: { ...fixture.env, HUSKY: "0" } });

    assert.equal(code, 0);
    assert.equal(byId(report, "git.husky-init").status, "skipped");
    assert.match(byId(report, "git.husky-init").message, /HUSKY=0/);
  });

  it("git 명령이 없으면 git 설치를 안내한다", (t) => {
    const fixture = createFixture(t);

    const { report } = doctor(fixture, { env: { ...fixture.env, PATH: fixture.bin } });

    assert.match(byId(report, "git.hooks").message, /git 명령을 찾을 수 없습니다/);
    assert.match(byId(report, "git.hooks").remedy, /git 을 설치한 뒤/);
  });
});

describe("읽기 전용", () => {
  it("문제가 여럿이어도 파일·git 설정을 하나도 바꾸지 않는다 (CLI, 사람용·JSON 둘 다)", (t) => {
    const fixture = createFixture(t, { rootModules: false, gitState: "repo" });
    rmSync(join(fixture.project, "web/node_modules"), { recursive: true });
    rmSync(join(fixture.project, "mobile/pnpm-lock.yaml"));
    write(join(fixture.project, "mobile/theme/tokens.ts"), "// 어긋남\n");
    const before = snapshot(fixture.project);
    const globalBefore = readFileSync(fixture.globalConfig, "utf8");

    const human = runCli(fixture.project, fixture.env);
    const json = runCli(fixture.project, fixture.env, ["--json"]);

    assert.equal(human.code, 1);
    assert.equal(json.code, 1);
    assert.match(human.stdout, /❌ 환경 점검 실패/);
    assert.match(human.stdout, /→ /);
    assert.deepEqual(snapshot(fixture.project), before);
    assert.equal(readFileSync(fixture.globalConfig, "utf8"), globalBefore);
  });
});
