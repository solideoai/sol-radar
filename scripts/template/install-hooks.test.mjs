// 커밋 게이트 설치기(scripts/install-hooks.mjs)와 상태 탐침(scripts/git-hooks.mjs) 시험. 실행: 루트에서 `pnpm test`
//
// 설치기가 조용히 실패하면 게이트 없이 커밋이 통과한다. 그래서 "켜졌다고 말하면 정말 켜졌는가",
// "못 켰으면 실패로 끝나는가", "남의 hooksPath 를 덮지 않는가"를 여기서 고정한다.
//
// 모든 시험은 임시 폴더(경로에 공백 포함)의 git 저장소에서 돈다. 전역 설정은 임시 파일로 바꿔 끼워
// 사용자 git 설정·훅과 이 저장소의 설정을 건드리지 않는다.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GATE_HOOKS,
  HOOKS_PATH,
  HUSKY_DISPATCHER,
  HUSKY_WRAPPER,
  inspectGitHooks,
  readHuskyDispatcher,
} from "../git-hooks.mjs";
import { installHooks } from "../install-hooks.mjs";
import { permissionSkip } from "../test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const installer = join(root, "scripts/install-hooks.mjs");
// 설치기가 불러오는 로컬 husky 패키지와 그 디스패처 원본
const huskyPackage = dirname(fileURLToPath(import.meta.resolve("husky")));
const huskySource = (file) => readFileSync(join(huskyPackage, file), "utf8");

// 원본이 실행되지 않는데도 git 이 0 을 돌려받게 만드는 가짜 shim 들
const INACTIVE_DISPATCHER = "#!/bin/sh\nexit 0\n";
const INACTIVE_WRAPPER = '#!/bin/sh\nexit 0\n. "$(dirname "$0")/h"\n';

// 커밋 게이트 안에서 돌 때 git 이 넘긴 GIT_* 와, CI 가 거는 HUSKY=0 을 걷어낸다.
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "HUSKY"),
);

const createSandbox = (t) => {
  const base = mkdtempSync(join(tmpdir(), "install hooks "));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const globalConfig = join(base, "global gitconfig");
  writeFileSync(
    globalConfig,
    "[user]\n\tname = hook-test\n\temail = hook-test@example.invalid\n[commit]\n\tgpgsign = false\n",
  );
  const env = {
    ...inheritedEnv,
    XDG_CONFIG_HOME: join(base, "xdg config"),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  return { base, env, globalConfig };
};

const git = (env, cwd, ...args) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();

const localHooksPath = (env, cwd) => {
  const result = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], {
    cwd,
    env,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

// 저장소의 원본 훅을 그대로 담은 git 저장소. commit-msg 는 실행 비트 없이 둔다.
const createRepo = ({ base, env }, name = "my repo") => {
  const repo = join(base, name);
  mkdirSync(join(repo, ".husky"), { recursive: true });
  git(env, repo, "init", "-q", "-b", "main");
  GATE_HOOKS.forEach((hook) =>
    copyFileSync(join(root, ".husky", hook), join(repo, ".husky", hook)),
  );
  chmodSync(join(repo, ".husky/commit-msg"), 0o644);
  return repo;
};

const runInstaller = (cwd, env) => {
  const result = spawnSync(process.execPath, [installer], { cwd, env, encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

const originals = (repo) =>
  Object.fromEntries(
    GATE_HOOKS.map((hook) => [hook, readFileSync(join(repo, ".husky", hook), "utf8")]),
  );

const rootOriginals = () =>
  Object.fromEntries(
    GATE_HOOKS.map((hook) => [hook, readFileSync(join(root, ".husky", hook), "utf8")]),
  );

describe("설치하지 않고 건너뛰는 경우 (종료 0)", () => {
  it("git 이 없는 zip 폴더는 이유를 알리고 아무것도 만들지 않는다", (t) => {
    const sandbox = createSandbox(t);
    const folder = join(sandbox.base, "unzipped template");
    mkdirSync(join(folder, ".husky"), { recursive: true });

    const { code, output } = runInstaller(folder, sandbox.env);

    assert.equal(code, 0);
    assert.match(output, /아직 git 저장소가 아니라/);
    assert.match(output, /git init/);
    assert.doesNotMatch(output, /✅/);
    assert.equal(existsSync(join(folder, HOOKS_PATH)), false);
  });

  it("HUSKY=0 이면 명시적으로 건너뛰고 hooksPath 를 바꾸지 않는다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const { code, output } = runInstaller(repo, { ...sandbox.env, HUSKY: "0" });

    assert.equal(code, 0);
    assert.match(output, /HUSKY=0/);
    assert.doesNotMatch(output, /✅/);
    assert.equal(localHooksPath(sandbox.env, repo), null);
    assert.equal(existsSync(join(repo, HOOKS_PATH)), false);
  });
});

describe("실제 git 저장소에 설치한다", () => {
  it(".git 디렉터리 저장소(경로에 공백)에 래퍼를 심고, 두 번 돌려도 원본 훅은 그대로다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const first = runInstaller(repo, sandbox.env);

    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /✅ 커밋 게이트 켜짐/);
    assert.equal(localHooksPath(sandbox.env, repo), HOOKS_PATH);
    assert.deepEqual(inspectGitHooks({ cwd: repo, env: sandbox.env }).problems, []);
    assert.deepEqual(originals(repo), rootOriginals());

    const second = runInstaller(repo, sandbox.env);

    assert.equal(second.code, 0, second.output);
    assert.match(second.output, /✅ 커밋 게이트 켜짐/);
    assert.deepEqual(inspectGitHooks({ cwd: repo, env: sandbox.env }).problems, []);
    assert.deepEqual(originals(repo), rootOriginals());
    assert.equal(statSync(join(repo, ".husky/commit-msg")).mode & 0o111, 0);
  });

  it("linked worktree(.git 이 파일)에서도 설치·검증된다", (t) => {
    const sandbox = createSandbox(t);
    const main = createRepo(sandbox, "main repo");
    git(sandbox.env, main, "add", ".husky");
    git(sandbox.env, main, "commit", "-q", "-m", "base");
    const worktree = join(sandbox.base, "linked work tree");
    git(sandbox.env, main, "worktree", "add", "-q", "--detach", worktree);

    const { code, output } = runInstaller(worktree, sandbox.env);

    assert.equal(statSync(join(worktree, ".git")).isFile(), true);
    assert.equal(code, 0, output);
    assert.match(output, /✅ 커밋 게이트 켜짐/);
    assert.deepEqual(inspectGitHooks({ cwd: worktree, env: sandbox.env }).problems, []);
    assert.deepEqual(originals(worktree), rootOriginals());
  });

  it("설치된 래퍼로 git commit 이 실행 비트 없는 원본 훅을 실제로 부른다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    const log = join(sandbox.base, "hook log");
    GATE_HOOKS.forEach((hook) => {
      writeFileSync(join(repo, ".husky", hook), `echo ${hook} >> "$HOOK_LOG"\n`);
      chmodSync(join(repo, ".husky", hook), 0o644);
    });
    assert.equal(runInstaller(repo, sandbox.env).code, 0);

    writeFileSync(join(repo, "file.txt"), "hello\n");
    git(sandbox.env, repo, "add", "file.txt");
    git({ ...sandbox.env, HOOK_LOG: log }, repo, "commit", "-q", "-m", "test: 훅 확인");

    assert.deepEqual(readFileSync(log, "utf8").split("\n").filter(Boolean), [
      "pre-commit",
      "commit-msg",
    ]);
  });
});

describe("사용자의 hooksPath 를 덮어쓰지 않는다 (종료 1)", () => {
  it("로컬 hooksPath 가 다르면 그대로 두고, 지우는 법을 알리며 실패한다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    git(sandbox.env, repo, "config", "core.hooksPath", ".githooks");

    const { code, output } = runInstaller(repo, sandbox.env);

    assert.equal(code, 1);
    assert.match(output, /\.githooks \(local\)/);
    assert.match(output, /git config --local --unset core\.hooksPath/);
    assert.doesNotMatch(output, /✅/);
    assert.equal(localHooksPath(sandbox.env, repo), ".githooks");
    assert.equal(existsSync(join(repo, HOOKS_PATH)), false);
  });

  it("전역 hooksPath 가 있으면 전역 설정을 건드리지 않고 이 저장소만 쓰는 법을 알린다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    git(sandbox.env, repo, "config", "--global", "core.hooksPath", "/opt/team hooks");
    const globalBefore = readFileSync(sandbox.globalConfig, "utf8");

    const { code, output } = runInstaller(repo, sandbox.env);

    assert.equal(code, 1);
    assert.match(output, /\/opt\/team hooks \(global\)/);
    assert.match(output, /git config --local core\.hooksPath \.husky\/_/);
    assert.equal(readFileSync(sandbox.globalConfig, "utf8"), globalBefore);
    assert.equal(localHooksPath(sandbox.env, repo), null);
  });

  it("이미 .husky/_ 를 가리키는 절대 경로는 충돌이 아니다", (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    git(sandbox.env, repo, "config", "core.hooksPath", join(repo, HOOKS_PATH));

    const { code, output } = runInstaller(repo, sandbox.env);

    assert.equal(code, 0, output);
  });
});

describe("설치 실패와 거짓 성공은 실패다 (종료 1)", () => {
  const huskyThatSetsPath = (sandbox, repo) => () => () => {
    git(sandbox.env, repo, "config", "core.hooksPath", HOOKS_PATH);
    return "";
  };

  it("git 명령이 없으면 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    const emptyBin = join(sandbox.base, "empty bin");
    mkdirSync(emptyBin);

    const result = await installHooks({ cwd: repo, env: { ...sandbox.env, PATH: emptyBin } });

    assert.equal(result.code, 1);
    assert.match(result.lines.join("\n"), /git 명령을 찾을 수 없습니다/);
  });

  it("husky 를 불러오지 못하면 설치하라고 안내하며 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    const missing = Object.assign(new Error("Cannot find package 'husky'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    const result = await installHooks({
      cwd: repo,
      env: sandbox.env,
      load: () => Promise.reject(missing),
    });

    assert.equal(result.code, 1);
    assert.match(result.lines.join("\n"), /ERR_MODULE_NOT_FOUND[\s\S]*pnpm install/);
  });

  it("husky 가 진단 문자열을 돌려주면 그 내용을 보이며 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const result = await installHooks({
      cwd: repo,
      env: sandbox.env,
      load: async () => () => "fatal: could not lock config file",
    });

    assert.equal(result.code, 1);
    assert.match(result.lines.join("\n"), /fatal: could not lock config file/);
    assert.doesNotMatch(result.lines.join("\n"), /✅/);
  });

  it("husky 가 던지면 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const result = await installHooks({
      cwd: repo,
      env: sandbox.env,
      load: async () => () => {
        throw new Error("EACCES: permission denied");
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.lines.join("\n"), /EACCES/);
  });

  it("husky 가 성공이라 해도 hooksPath 가 그대로면 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const result = await installHooks({ cwd: repo, env: sandbox.env, load: async () => () => "" });

    assert.equal(result.code, 1);
    assert.match(
      result.lines.join("\n"),
      /설치 뒤 확인에 실패[\s\S]*core\.hooksPath 가 설정되지 않았습니다/,
    );
    assert.doesNotMatch(result.lines.join("\n"), /✅/);
  });

  it("hooksPath 만 바꾸고 래퍼·디스패처를 만들지 않았으면 실패한다", async (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);

    const result = await installHooks({
      cwd: repo,
      env: sandbox.env,
      load: huskyThatSetsPath(sandbox, repo),
    });
    const output = result.lines.join("\n");

    assert.equal(result.code, 1);
    assert.match(output, /\.husky\/_\/h\(husky 디스패처\)/);
    assert.match(output, /\.husky\/_\/pre-commit\(실행 래퍼\)/);
    assert.match(output, /\.husky\/_\/commit-msg\(실행 래퍼\)/);
  });
});

describe("상태 탐침 (inspectGitHooks)", () => {
  const installed = (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    assert.equal(runInstaller(repo, sandbox.env).code, 0);
    return { sandbox, repo };
  };

  it("git 저장소가 아니면 repo: false 이고 문제를 만들지 않는다", (t) => {
    const sandbox = createSandbox(t);
    const folder = join(sandbox.base, "plain");
    mkdirSync(folder);

    assert.deepEqual(inspectGitHooks({ cwd: folder, env: sandbox.env }), {
      repo: false,
      error: null,
      hooksPath: null,
      active: false,
      problems: [],
    });
  });

  it("실행 비트를 잃은 래퍼를 짚는다", { skip: permissionSkip }, (t) => {
    const { sandbox, repo } = installed(t);
    chmodSync(join(repo, HOOKS_PATH, "pre-commit"), 0o644);

    const state = inspectGitHooks({ cwd: repo, env: sandbox.env });

    assert.equal(state.active, true);
    assert.deepEqual(state.problems, [
      ".husky/_/pre-commit(실행 래퍼)가 없거나 실행할 수 없습니다.",
    ]);
  });

  it("디스패처를 부르지 않는 래퍼를 짚는다", (t) => {
    const { sandbox, repo } = installed(t);
    writeFileSync(join(repo, HOOKS_PATH, "commit-msg"), "#!/usr/bin/env sh\nexit 0\n");

    const state = inspectGitHooks({ cwd: repo, env: sandbox.env });

    assert.deepEqual(state.problems, [
      ".husky/_/commit-msg(실행 래퍼)가 .husky/_/h 를 부르지 않습니다.",
    ]);
  });

  it("원본 훅이 없으면 짚는다", (t) => {
    const { sandbox, repo } = installed(t);
    rmSync(join(repo, ".husky/commit-msg"));

    const state = inspectGitHooks({ cwd: repo, env: sandbox.env });

    assert.deepEqual(state.problems, [".husky/commit-msg(원본 훅)이 없거나 읽을 수 없습니다."]);
  });

  it("디스패처가 디렉터리면 종류를 짚고, 원본 훅이 디렉터리여도 짚는다", (t) => {
    const { sandbox, repo } = installed(t);
    rmSync(join(repo, HOOKS_PATH, "h"));
    mkdirSync(join(repo, HOOKS_PATH, "h"));
    rmSync(join(repo, ".husky/pre-commit"));
    mkdirSync(join(repo, ".husky/pre-commit"));

    const state = inspectGitHooks({ cwd: repo, env: sandbox.env });

    assert.deepEqual(state.problems, [
      ".husky/_/h(husky 디스패처)가 일반 파일이 아닙니다.",
      ".husky/pre-commit(원본 훅)이 일반 파일이 아닙니다.",
    ]);
  });

  it("디스패처를 읽을 수 없으면 짚는다", { skip: permissionSkip }, (t) => {
    const { sandbox, repo } = installed(t);
    // 정리(rmSync)는 파일 권한이 아니라 폴더 쓰기 권한만 필요해 권한을 되돌리지 않는다.
    // t.after 는 등록 순서대로 돌아 되돌리는 훅을 더하면 폴더가 지워진 뒤 ENOENT 로 실패한다.
    chmodSync(join(repo, HOOKS_PATH, "h"), 0o000);

    const state = inspectGitHooks({ cwd: repo, env: sandbox.env });

    // root 로 돌면 권한과 상관없이 읽히므로 그때는 문제가 없어야 한다
    assert.deepEqual(
      state.problems,
      process.getuid?.() === 0
        ? []
        : [".husky/_/h(husky 디스패처)가 없거나 읽을 수 없습니다 (읽기 권한 없음)."],
    );
  });
});

describe("원본 훅을 부르지 않는 shim 은 켜진 것이 아니다", () => {
  const installed = (t) => {
    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    writeFileSync(join(repo, ".husky/pre-commit"), "exit 17\n");
    chmodSync(join(repo, ".husky/pre-commit"), 0o644);
    const install = runInstaller(repo, sandbox.env);
    assert.equal(install.code, 0, install.output);
    return { sandbox, repo };
  };
  const runHook = ({ sandbox, repo }) =>
    spawnSync("git", ["hook", "run", "pre-commit"], {
      cwd: repo,
      env: sandbox.env,
      encoding: "utf8",
    }).status;

  it("내장 기준은 설치된 husky 의 디스패처·래퍼와 바이트까지 같다", (t) => {
    assert.equal(HUSKY_DISPATCHER, huskySource("husky"));
    assert.deepEqual(readHuskyDispatcher(), { value: huskySource("husky") });
    assert.ok(huskySource("index.js").includes('`#!/usr/bin/env sh\\n. "\\$(dirname "\\$0")/h"`'));

    const sandbox = createSandbox(t);
    const repo = createRepo(sandbox);
    assert.equal(runInstaller(repo, sandbox.env).code, 0);
    assert.equal(readFileSync(join(repo, HOOKS_PATH, "h"), "utf8"), HUSKY_DISPATCHER);
    GATE_HOOKS.forEach((hook) =>
      assert.equal(readFileSync(join(repo, HOOKS_PATH, hook), "utf8"), HUSKY_WRAPPER),
    );
  });

  it("정상 설치에서는 실행 비트 없는 원본의 exit 17 이 git 에 그대로 전해진다", (t) => {
    const fixture = installed(t);

    assert.equal(statSync(join(fixture.repo, ".husky/pre-commit")).mode & 0o111, 0);
    assert.equal(runHook(fixture), 17);
    assert.deepEqual(inspectGitHooks({ cwd: fixture.repo, env: fixture.sandbox.env }).problems, []);
  });

  it("디스패처만 exit 0 으로 바꾸면 git 은 0 이지만 탐침은 실패로 짚는다", (t) => {
    const fixture = installed(t);
    writeFileSync(join(fixture.repo, HOOKS_PATH, "h"), INACTIVE_DISPATCHER);

    assert.equal(runHook(fixture), 0);
    const state = inspectGitHooks({ cwd: fixture.repo, env: fixture.sandbox.env });
    assert.equal(state.active, true);
    assert.deepEqual(state.problems, [
      ".husky/_/h(husky 디스패처)가 husky 디스패처와 달라 원본 훅을 부른다고 볼 수 없습니다.",
    ]);
  });

  it("래퍼 앞에 exit 0 을 끼우면 git 은 0 이지만 탐침은 실패로 짚는다", (t) => {
    const fixture = installed(t);
    writeFileSync(join(fixture.repo, HOOKS_PATH, "pre-commit"), INACTIVE_WRAPPER);

    assert.equal(runHook(fixture), 0);
    assert.deepEqual(inspectGitHooks({ cwd: fixture.repo, env: fixture.sandbox.env }).problems, [
      ".husky/_/pre-commit(실행 래퍼)가 .husky/_/h 를 부르지 않습니다.",
    ]);
  });

  it("husky 가 원본을 부르지 않는 shim 을 심고 성공이라 해도 설치기는 실패(종료 1)한다", async (t) => {
    const cases = [
      {
        h: INACTIVE_DISPATCHER,
        wrapper: HUSKY_WRAPPER,
        problem: /\.husky\/_\/h\(husky 디스패처\)가 husky 디스패처와 달라/,
      },
      {
        h: HUSKY_DISPATCHER,
        wrapper: INACTIVE_WRAPPER,
        problem: /\.husky\/_\/pre-commit\(실행 래퍼\)가 \.husky\/_\/h 를 부르지 않습니다/,
      },
    ];
    for (const { h, wrapper, problem } of cases) {
      const sandbox = createSandbox(t);
      const repo = createRepo(sandbox);
      const fakeHusky = async () => () => {
        git(sandbox.env, repo, "config", "core.hooksPath", HOOKS_PATH);
        mkdirSync(join(repo, HOOKS_PATH), { recursive: true });
        writeFileSync(join(repo, HOOKS_PATH, "h"), h);
        GATE_HOOKS.forEach((hook) =>
          writeFileSync(join(repo, HOOKS_PATH, hook), wrapper, { mode: 0o755 }),
        );
        return "";
      };

      const r = await installHooks({ cwd: repo, env: sandbox.env, load: fakeHusky });

      assert.equal(r.code, 1);
      assert.match(r.lines.join("\n"), problem);
      assert.doesNotMatch(r.lines.join("\n"), /✅/);
    }
  });

  it("끝 줄바꿈 하나가 더 붙은 래퍼는 같은 래퍼로 본다", (t) => {
    const fixture = installed(t);
    writeFileSync(join(fixture.repo, HOOKS_PATH, "pre-commit"), `${HUSKY_WRAPPER}\n`);

    assert.deepEqual(inspectGitHooks({ cwd: fixture.repo, env: fixture.sandbox.env }).problems, []);
    assert.equal(runHook(fixture), 17);
  });
});
