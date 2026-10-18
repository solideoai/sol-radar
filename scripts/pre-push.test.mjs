// push 전 검사(scripts/pre-push.mjs·.husky/pre-push) 시험. 실행: 루트에서 `pnpm test`
//
// 무엇을 언제 돌리고 무엇을 막는지 고정한다. 임시 저장소에 실제 pre-push.mjs 와 그것이 쓰는 모듈을 넣고,
// 검사 스크립트(check-commits·check-policy·verify)와 pnpm 은 호출만 적는 가짜로 바꿔 끼운다.
// 검사 자체가 맞는지는 각 검사의 시험과 verify 가 본다.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PLACEHOLDER_ENV, isDoc, parseRefs, projectsToCheck } from "./pre-push.mjs";
import { jobBlock, pathWith, tempDir, writeExecutable } from "./test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

describe("push 참조 읽기", () => {
  it("git 이 넘긴 줄에서 로컬·원격 SHA 를 읽고, 지우는 push 와 같은 커밋 중복을 뺀다", () => {
    const input = [
      `refs/heads/main ${A} refs/heads/main ${B}`,
      `refs/heads/copy ${A} refs/heads/copy ${ZERO}`,
      `(delete) ${ZERO} refs/heads/old ${B}`,
      "",
    ].join("\n");
    assert.deepEqual(parseRefs(input), [{ local: A, remote: B }]);
    assert.deepEqual(parseRefs(""), []);
  });
});

describe("검사할 프로젝트 고르기", () => {
  const web = { name: "web", directory: "web" };
  const api = { name: "api", directory: "api" };
  const projects = [web, api];

  it("비교할 커밋이 없으면(files 가 null) 전부 돈다", () => {
    assert.deepEqual(projectsToCheck(projects, null), projects);
  });

  it("바뀐 프로젝트 폴더만 돈다", () => {
    assert.deepEqual(projectsToCheck(projects, ["web/app/page.tsx"]), [web]);
    assert.deepEqual(projectsToCheck(projects, ["api/src/index.ts"]), [api]);
  });

  it("프로젝트 폴더 밖의 문서 아닌 파일은 모든 프로젝트에 걸린다", () => {
    ["design/tokens.json", "supabase/migrations/1_x.sql", "package.json", "scripts/x.mjs"].forEach(
      (file) => assert.deepEqual(projectsToCheck(projects, [file]), projects, file),
    );
  });

  it("문서만 바뀌면 프로젝트 검사는 돌지 않는다", () => {
    assert.deepEqual(
      projectsToCheck(projects, ["docs/a.md", "polaris/specs/x.md", "web/README.md"]),
      [],
    );
    assert.ok(isDoc("AGENTS.md") && isDoc("docs/guardrails.md") && !isDoc("docs.json"));
  });

  it("폴더 이름이 앞부분만 같은 경로(web-old/)는 그 프로젝트로 치지 않는다", () => {
    assert.deepEqual(
      projectsToCheck([web, { name: "x", directory: "web-old" }], ["web-old/a.ts"]),
      [{ name: "x", directory: "web-old" }],
    );
  });
});

describe("CI 와 같은 자리값", () => {
  it("Supabase 자리값이 ci.yml 의 프로젝트 검증 단계와 같다", () => {
    const job = jobBlock(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"), "project");
    assert.ok(job, "ci.yml 에 project 잡이 없습니다");
    const fromCi = Object.fromEntries(
      [...job.matchAll(/^\s+([A-Z_]*SUPABASE_[A-Z_]+): (\S+)$/gm)].map(([, key, value]) => [
        key,
        value,
      ]),
    );
    assert.deepEqual(fromCi, PLACEHOLDER_ENV);
  });
});

// ── 임시 저장소에서 실제로 돌린다 ──

const sandbox = tempDir("pre-push-test-");
after(() => rmSync(sandbox, { recursive: true, force: true }));

const gitConfig = [
  "-c",
  "user.name=gate-test",
  "-c",
  "user.email=gate-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "HUSKY"),
);
const git = (repo, ...args) =>
  execFileSync("git", [...gitConfig, ...args], {
    cwd: repo,
    env: baseEnv,
    encoding: "utf8",
  }).trim();

// 가짜 검사 스크립트: 이름·인자·작업 폴더 이름을 로그에 적고, PRE_PUSH_FAIL 이 그 줄에 들어 있으면 실패한다.
const fakeScript = (name, extra = "") => `import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const line = "${name} " + process.argv.slice(2).join(" ") + " @" + basename(process.cwd());
appendFileSync(process.env.PRE_PUSH_LOG, line + "\\n");
${extra}
process.exit(process.env.PRE_PUSH_FAIL && line.includes(process.env.PRE_PUSH_FAIL) ? 1 : 0);
`;

const fakePnpm = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { basename } = require("node:path");
const line = "pnpm " + process.argv.slice(2).join(" ") + " @" + basename(process.cwd());
appendFileSync(process.env.PRE_PUSH_LOG, line + "\\n");
if (process.argv[2] === "test:e2e")
  appendFileSync(
    process.env.PRE_PUSH_LOG,
    "e2e-env E2E_PORT=" + process.env.E2E_PORT + " URL=" + process.env.NEXT_PUBLIC_SUPABASE_URL +
      " CI=" + process.env.CI + "\\n",
  );
process.exit(process.env.PRE_PUSH_FAIL && line.includes(process.env.PRE_PUSH_FAIL) ? 1 : 0);
`;

const bin = join(sandbox, "bin");
mkdirSync(bin);
writeExecutable(join(bin, "pnpm"), fakePnpm);

const CONFIG = {
  version: 1,
  verification: {
    common: [{ command: "pnpm", args: ["test"] }],
    projects: ["web", "api"].map((name) => ({
      name,
      directory: name,
      marker: "package.json",
      setup: { command: "pnpm", args: ["install", "--frozen-lockfile"] },
      verify: { command: "pnpm", args: ["verify"] },
      quick: { command: "pnpm", args: ["verify:quick"] },
      ...(name === "web" ? { e2e: { command: "pnpm", args: ["test:e2e"] } } : {}),
    })),
  },
  migrationDirectories: ["supabase/migrations/"],
};

let repoCount = 0;

// 원격 하나와 그 원격에 올라간 첫 커밋이 있는 저장소. gate.prePush 는 켠 상태로 시작한다.
function makeRepo() {
  const dir = join(sandbox, `case-${(repoCount += 1)}`);
  const repo = join(dir, "repo");
  const remote = join(dir, "remote.git");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  ["pre-push.mjs", "command.mjs", "project-config.mjs"].forEach((file) =>
    copyFileSync(join(root, "scripts", file), join(repo, "scripts", file)),
  );
  writeFileSync(
    join(repo, "scripts/check-commits.mjs"),
    fakeScript(
      "check-commits",
      'appendFileSync(process.env.PRE_PUSH_LOG, "commits-env " + process.env.EVENT_NAME + " " + process.env.BASE_SHA + " " + process.env.HEAD_SHA + "\\n");',
    ),
  );
  writeFileSync(join(repo, "scripts/check-policy.mjs"), fakeScript("check-policy"));
  writeFileSync(join(repo, "scripts/verify.mjs"), fakeScript("verify"));
  mkdirSync(join(repo, ".husky"));
  copyFileSync(join(root, ".husky/pre-push"), join(repo, ".husky/pre-push"));
  writeFileSync(join(repo, "verify.config.json"), JSON.stringify(CONFIG, null, 2));
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  ["web", "api"].forEach((name) => {
    mkdirSync(join(repo, name));
    writeFileSync(join(repo, name, "package.json"), "{}\n");
  });
  writeFileSync(join(repo, "web/pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs/a.md"), "# a\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: 처음");
  execFileSync("git", ["init", "-q", "--bare", remote], { env: baseEnv });
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "config", "gate.prePush", "true");
  return { dir, repo, base: git(repo, "rev-parse", "HEAD") };
}

const commitChange = (repo, file, content = "x\n") => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: 바꾼다");
  return git(repo, "rev-parse", "HEAD");
};

// pre-push.mjs 를 git 처럼 부른다. 임시 폴더(TMPDIR)를 사례마다 따로 두어 남은 것을 셀 수 있게 한다.
function runPrePush({ dir, repo }, stdin, env = {}) {
  const log = join(dir, "calls.log");
  const tmp = join(dir, "tmp");
  mkdirSync(tmp, { recursive: true });
  rmSync(log, { force: true });
  const result = spawnSync(process.execPath, ["scripts/pre-push.mjs", "origin", "url"], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: {
      ...baseEnv,
      PATH: pathWith(bin),
      TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
      PRE_PUSH_LOG: log,
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { ...result, calls, tmp };
}

const worktrees = (repo) =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;

describe("push 전 검사 실행", () => {
  it("gate.prePush 를 켜지 않으면 아무것도 돌리지 않고 통과한다", () => {
    const fixture = makeRepo();
    git(fixture.repo, "config", "--unset", "gate.prePush");
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.calls, []);
    assert.equal(run.stdout, "");
  });

  it("gate.prePush 값이 불리언이 아니면 막는다", () => {
    const fixture = makeRepo();
    git(fixture.repo, "config", "gate.prePush", "maybe");
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /gate\.prePush/);
  });

  it("web 만 바뀌면 커밋·정책·설치 뒤 공통·감사·web 을 돌리고, api 는 건너뛴다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    // 앞의 셋은 차례로 돈다
    assert.deepEqual(run.calls.slice(0, 4), [
      "check-commits  @repo",
      `commits-env push ${fixture.base} ${head}`,
      `check-policy --base ${fixture.base} @repo`,
      "pnpm install --frozen-lockfile @repo",
    ]);
    // 뒤는 동시에 돈다. 순서 대신 집합과 프로젝트 안의 순서를 본다
    const rest = run.calls.slice(4);
    const e2eEnv = rest.find((line) => line.startsWith("e2e-env "));
    assert.match(
      e2eEnv ?? "",
      new RegExp(`^e2e-env E2E_PORT=\\d+ URL=${PLACEHOLDER_ENV.NEXT_PUBLIC_SUPABASE_URL} CI=true$`),
    );
    assert.deepEqual(
      rest.filter((line) => line !== e2eEnv).sort(),
      [
        "pnpm audit --audit-level critical @repo",
        "pnpm audit --audit-level critical @web",
        "pnpm test:e2e @web",
        "verify --common @repo",
        "verify --project web --setup @repo",
      ].sort(),
    );
    const web = rest.filter((line) => /@web$|--project web/.test(line));
    assert.deepEqual(web, [
      "verify --project web --setup @repo",
      "pnpm test:e2e @web",
      "pnpm audit --audit-level critical @web",
    ]);
    assert.match(run.stdout, /api: 바뀐 파일이 없어 건너뜁니다/);
    assert.match(run.stdout, /\[통과\]/);
    assert.equal(worktrees(fixture.repo), 1, "임시 worktree 가 남았습니다");
    assert.deepEqual(readdirSync(run.tmp), [], "임시 폴더가 남았습니다");
  });

  it("문서만 바뀌면 프로젝트 검사 없이 공통 검사와 루트 감사만 돈다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "docs/b.md");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(!run.calls.some((line) => line.includes("--project")), run.calls.join("\n"));
    assert.ok(run.calls.includes("verify --common @repo"));
  });

  it("공유 파일이 바뀌거나 새 브랜치면 모든 프로젝트를 돈다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "design/tokens.json", "{}\n");
    [fixture.base, ZERO].forEach((remote) => {
      const run = runPrePush(fixture, `refs/heads/x ${head} refs/heads/x ${remote}\n`);
      assert.equal(run.status, 0, run.stderr);
      assert.ok(run.calls.includes("verify --project web --setup @repo"), remote);
      assert.ok(run.calls.includes("verify --project api --setup @repo"), remote);
    });
  });

  it("검사가 하나라도 실패하면 막고, 로그를 남기고, worktree 는 지운다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`, {
      PRE_PUSH_FAIL: "pnpm test:e2e",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /✗ web .*실패한 단계: pnpm test:e2e/);
    assert.match(run.stderr, /\[차단\]/);
    const log = /전체 로그: (.+)$/m.exec(run.stderr)?.[1];
    assert.ok(log && existsSync(log), "실패 로그가 남아야 합니다");
    assert.ok(
      !run.calls.includes("pnpm audit --audit-level critical @web"),
      "실패 뒤 단계는 돌지 않는다",
    );
    assert.equal(worktrees(fixture.repo), 1);
  });

  it("앞 단계(커밋 메시지)가 실패하면 설치와 나머지 검사를 돌리지 않는다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${fixture.base}\n`, {
      PRE_PUSH_FAIL: "check-commits",
    });
    assert.equal(run.status, 1);
    assert.ok(!run.calls.some((line) => line.startsWith("pnpm ")), run.calls.join("\n"));
    assert.equal(worktrees(fixture.repo), 1);
  });

  it("원격 커밋이 로컬 이력에 없으면 fetch 하라고 알리고 막는다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "web/a.ts");
    const run = runPrePush(fixture, `refs/heads/main ${head} refs/heads/main ${B}\n`);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /git fetch/);
    assert.deepEqual(run.calls, []);
  });

  it("원격 참조를 지우는 push 는 검사할 커밋이 없어 통과한다", () => {
    const fixture = makeRepo();
    const run = runPrePush(fixture, `(delete) ${ZERO} refs/heads/old ${fixture.base}\n`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.calls, []);
  });

  it("실제 git push 에서 .husky/pre-push 가 참조 목록을 넘기고, 실패하면 push 를 막는다", () => {
    const fixture = makeRepo();
    const head = commitChange(fixture.repo, "web/a.ts");
    const hooks = join(fixture.dir, "hooks");
    mkdirSync(hooks);
    // husky 디스패처처럼 원본 훅을 `sh -e` 로 돌린다
    writeExecutable(join(hooks, "pre-push"), '#!/bin/sh\nexec sh -e .husky/pre-push "$@"\n');
    // 실패한 push 는 로그를 임시 폴더에 남긴다. 사례 폴더 안을 쓰게 해서 시험 뒤에 함께 지운다
    const tmp = join(fixture.dir, "tmp");
    mkdirSync(tmp);
    const push = (env) =>
      spawnSync(
        "git",
        [...gitConfig, "-c", `core.hooksPath=${hooks}`, "push", "-q", "origin", "main"],
        {
          cwd: fixture.repo,
          encoding: "utf8",
          env: {
            ...baseEnv,
            PATH: pathWith(bin),
            PRE_PUSH_LOG: join(fixture.dir, "calls.log"),
            TMPDIR: tmp,
            TMP: tmp,
            TEMP: tmp,
            ...env,
          },
        },
      );
    const remoteHead = () =>
      git(fixture.repo, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0];

    const blocked = push({ PRE_PUSH_FAIL: "verify --common" });
    assert.notEqual(blocked.status, 0);
    assert.equal(remoteHead(), fixture.base, "실패했는데 push 가 됐습니다");

    const passed = push({});
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(remoteHead(), head);
  });
});
