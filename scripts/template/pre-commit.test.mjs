// 커밋 게이트(.husky/pre-commit) 자체 테스트. 실행: 루트에서 `pnpm test`
//
// 게이트가 망가지면 아무것도 막지 않으면서 초록불을 띄운다. 그래서 "무엇을 스테이징하면
// 무엇을 돌리고 무엇을 막는가"를 여기서 고정한다.
//
// 임시 git 저장소에 게이트와 guard.sh 를 복사해 돌린다. pnpm 은 호출 인자만 적어 두는
// 가짜로 바꿔 끼운다 — web·mobile 검사 자체가 맞는지는 각 폴더의 verify 가 본다.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pathWith, writeExecutable } from "../test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// 게이트는 커밋 도중에 이 테스트를 부른다. 그때 git 이 넘겨준 GIT_INDEX_FILE 등이 남아 있으면
// 임시 저장소의 git 명령이 바깥 저장소의 인덱스를 건드린다. GIT_ 로 시작하는 값과 HUSKY 는 전부 걷어내고,
// 사용자 전역·시스템 git 설정 대신 임시 전역 설정과 임시 XDG_CONFIG_HOME 을 쓴다.
const isolation = mkdtempSync(join(tmpdir(), "pre-commit-config-"));
after(() => rmSync(isolation, { recursive: true, force: true }));
writeFileSync(
  join(isolation, "gitconfig"),
  "[user]\n\tname = gate-test\n\temail = gate-test@example.invalid\n[commit]\n\tgpgsign = false\n",
);
const cleanEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "HUSKY"),
  ),
  XDG_CONFIG_HOME: join(isolation, "config"),
  GIT_CONFIG_GLOBAL: join(isolation, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};

// 사용자 전역 설정(서명·전역 훅)이 테스트 커밋에 끼어들지 않게 막는다.
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

const git = (repo, ...args) =>
  execFileSync("git", [...gitConfig, ...args], { cwd: repo, env: cleanEnv, stdio: "pipe" });

const FAKE_PNPM = `#!/bin/sh
case "$PWD" in
  */web) set -- -C web "$@" ;;
  */mobile) set -- -C mobile "$@" ;;
esac
echo "$*" >> "$PNPM_LOG"
[ "$FAKE_PNPM_FAIL" = 1 ] && exit 1
[ -n "$FAKE_PNPM_FAIL_ON" ] && [ "$*" = "$FAKE_PNPM_FAIL_ON" ] && exit 1
exit 0
`;

const writeFiles = (repo, files) =>
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  });

const stage = (repo, files) => {
  writeFiles(repo, files);
  git(repo, "add", "--", ...Object.keys(files));
};

const commit = (repo) => git(repo, "commit", "-q", "-m", "base");

// 게이트·가드·가짜 pnpm 을 갖춘 임시 저장소. web·mobile 은 설치된 상태(package.json·node_modules 있음)로 시작한다.
const createSandbox = (t) => {
  const base = mkdtempSync(join(tmpdir(), "pre-commit-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const repo = join(base, "repo");
  const bin = join(base, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  git(repo, "init", "-q", "-b", "main");

  [
    ".husky/pre-commit",
    ".claude/hooks/guard.sh",
    "verify.config.json",
    "scripts/verify.mjs",
    "scripts/project-config.mjs",
    "scripts/check-policy.mjs",
    "scripts/command.mjs",
  ].forEach((path) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    copyFileSync(join(root, path), join(repo, path));
  });
  ["web", "mobile"].forEach((folder) => {
    mkdirSync(join(repo, folder, "node_modules"), { recursive: true });
    writeFileSync(join(repo, folder, "package.json"), "{}\n");
  });
  writeExecutable(join(bin, "pnpm"), FAKE_PNPM);

  return { repo, bin, log: join(base, "pnpm.log") };
};

// failOn: 그 인자로 불린 pnpm 만 실패시킨다(예: "check:db-types").
const runGate = ({ repo, bin, log }, { failPnpm = false, failOn = "" } = {}) => {
  const result = spawnSync("sh", ["-e", ".husky/pre-commit"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...cleanEnv,
      PATH: pathWith(bin, cleanEnv.PATH),
      PNPM_LOG: log,
      FAKE_PNPM_FAIL: failPnpm ? "1" : "",
      FAKE_PNPM_FAIL_ON: failOn,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { code: result.status, output: `${result.stdout}${result.stderr}`, calls };
};

describe("바뀐 폴더만 검사한다", () => {
  it("web 만 바뀌면 web 의 verify:quick 만 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "web/app/page.tsx": "export default 1;\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick"]);
  });

  it("mobile 만 바뀌면 mobile 의 verify:quick 만 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "mobile/app/index.tsx": "export default 1;\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C mobile verify:quick"]);
  });

  it("web·mobile 이 함께 바뀌면 둘 다 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/app/page.tsx": "export default 1;\n",
      "mobile/app/index.tsx": "export default 1;\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick", "-C mobile verify:quick"]);
  });

  it("파일을 지운 것도 바뀐 것으로 본다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, { "web/server/shared/errors.ts": "export const a = 1;\n" });
    git(sandbox.repo, "add", "web/server/shared/errors.ts");
    commit(sandbox.repo);
    git(sandbox.repo, "rm", "-q", "web/server/shared/errors.ts");

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick"]);
  });

  it("디자인 토큰 정본이 바뀌면 루트에서 서식·토큰·색 검사를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "design/tokens.json": "{}\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "check:tokens", "check:colors"]);
  });

  it("검사 대상이 아닌 파일만 바뀌면 아무 검사도 돌리지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "README.md": "# hello\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, []);
  });

  it("검사가 실패하면 커밋을 막는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "web/app/page.tsx": "export default 1;\n" });

    const { code, output } = runGate(sandbox, { failPnpm: true });

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\]/);
  });

  it("바뀐 폴더에 의존성이 없으면 설치하라고 안내하며 막는다", (t) => {
    const sandbox = createSandbox(t);
    rmSync(join(sandbox.repo, "web/node_modules"), { recursive: true });
    stage(sandbox.repo, { "web/app/page.tsx": "export default 1;\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /pnpm -C web install/);
    assert.deepEqual(calls, []);
  });

  it("게이트 파일이 바뀌면 게이트 자체 테스트를 돈다", (t) => {
    const sandbox = createSandbox(t);
    git(sandbox.repo, "add", ".husky/pre-commit");

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["test"]);
  });

  it("커밋 메시지 훅이나 그 규칙이 바뀌어도 게이트 테스트를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      ".husky/commit-msg": 'node scripts/check-commit-msg.mjs "$1"\n',
      "scripts/commit-message.mjs": "export {};\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });

  it("스크립트 폴더의 스크립트가 바뀌면 서식 검사와 게이트 테스트를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "scripts/verify.mjs": "export {};\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });

  it("폴더를 통째로 지운 커밋은 그 폴더 검사를 건너뛴다 — package.json 이 빠지므로 package.json 시험만 돈다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, {
      "web/package.json": "{}\n",
      "web/app/page.tsx": "export default 1;\n",
    });
    git(sandbox.repo, "add", "web/package.json", "web/app/page.tsx");
    commit(sandbox.repo);
    git(sandbox.repo, "rm", "-rq", "web");
    rmSync(join(sandbox.repo, "web"), { recursive: true, force: true });

    const { code, calls, output } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["test:package"]);
    assert.match(output, /web.*건너뜁니다/);
  });

  it("스크립트 폴더의 다른 테스트 파일이 바뀌어도 게이트 테스트를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "scripts/template/commit-message.test.mjs": "export {};\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });
});

// 실제 `git commit` 으로 게이트를 부른다. git 이 넘기는 환경(commit -a·commit <경로> 의 임시 인덱스 등)까지 같게 본다.
const commitThroughGate = ({ repo, bin, log }, ...args) => {
  const hooks = join(dirname(repo), "hooks");
  mkdirSync(hooks, { recursive: true });
  writeExecutable(join(hooks, "pre-commit"), "#!/bin/sh\nexec sh -e .husky/pre-commit\n");
  const result = spawnSync(
    "git",
    [...gitConfig, "-c", `core.hooksPath=${hooks}`, "commit", ...args],
    {
      cwd: repo,
      encoding: "utf8",
      env: { ...cleanEnv, PATH: `${bin}:${cleanEnv.PATH}`, PNPM_LOG: log },
    },
  );
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("부분 스테이징을 막는다 — 검사는 작업 폴더를 읽으므로 커밋될 내용과 같아야 한다", () => {
  const BLOCKED = /\[차단\] 스테이징한 파일에 스테이징하지 않은 수정이 남아 있습니다/;

  it("틀린 서식을 스테이징하고 작업 폴더만 고치면 비싼 검사 전에 막고 파일과 해결법을 알린다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { ".github/workflows/demo.yml": "name:   demo\n" });
    writeFiles(sandbox.repo, { ".github/workflows/demo.yml": "name: demo\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, BLOCKED);
    assert.match(output, /- \.github\/workflows\/demo\.yml$/m);
    assert.match(output, /git add[\s\S]*git stash/);
    assert.deepEqual(calls, []);
  });

  it("새로 추가한 뒤 또 고친 파일, 스테이징한 뒤 작업 폴더에서 지운 파일도 막는다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, { "web/app/kept.tsx": "export default 1;\n" });
    git(sandbox.repo, "add", "web/app/kept.tsx");
    commit(sandbox.repo);
    stage(sandbox.repo, {
      "web/app/new.tsx": "export default 1;\n",
      "web/app/kept.tsx": "export default 2;\n",
    });
    writeFiles(sandbox.repo, { "web/app/new.tsx": "export default 3;\n" });
    rmSync(join(sandbox.repo, "web/app/kept.tsx"));

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, BLOCKED);
    assert.match(output, /- web\/app\/kept\.tsx$/m);
    assert.match(output, /- web\/app\/new\.tsx$/m);
    assert.deepEqual(calls, []);
  });

  it("한글·공백 파일명도 깨지지 않은 이름으로 짚는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "design/새 토큰 초안.json": '{ "a": 1 }\n' });
    writeFiles(sandbox.repo, { "design/새 토큰 초안.json": '{ "a": 2 }\n' });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, BLOCKED);
    assert.match(output, /- design\/새 토큰 초안\.json$/m);
    assert.deepEqual(calls, []);
  });

  it("이름의 대괄호·별표는 글자 그대로 비교하고, git 이 따옴표로 감싼 이름도 같은 모양으로 맞춘다", (t) => {
    const sandbox = createSandbox(t);
    // Windows 는 파일 이름에 " 와 * 를 쓸 수 없어 따옴표로 감싼 이름은 만들지 못한다. 거기서는 대괄호만 본다.
    const quotable = process.platform !== "win32";
    writeFiles(sandbox.repo, {
      "web/app/i/page.tsx": "export default 1;\n",
      "web/app/[id]/page.tsx": "export default 1;\n",
      ...(quotable ? { 'web/app/a"b*.tsx': "export default 1;\n" } : {}),
    });
    git(sandbox.repo, "add", "web/app");
    commit(sandbox.repo);

    // [id] 를 글롭으로 읽으면 i/page.tsx 와 맞아 버린다. 어느 쪽을 스테이징해도 전부 스테이징했으니 통과해야 한다.
    stage(sandbox.repo, { "web/app/i/page.tsx": "export default 2;\n" });
    writeFiles(sandbox.repo, { "web/app/[id]/page.tsx": "export default 2;\n" });
    const unstagedGlob = runGate(sandbox);
    assert.equal(unstagedGlob.code, 0, unstagedGlob.output);
    commit(sandbox.repo);

    git(sandbox.repo, "--literal-pathspecs", "add", "--", "web/app/[id]/page.tsx");
    writeFiles(sandbox.repo, { "web/app/i/page.tsx": "export default 3;\n" });
    const stagedGlob = runGate(sandbox);
    assert.equal(stagedGlob.code, 0, stagedGlob.output);
    commit(sandbox.repo);
    git(sandbox.repo, "add", "--", "web/app/i/page.tsx");
    commit(sandbox.repo);
    if (!quotable) return;

    stage(sandbox.repo, { 'web/app/a"b*.tsx': "export default 2;\n" });
    writeFiles(sandbox.repo, { 'web/app/a"b*.tsx': "export default 3;\n" });
    const quoted = runGate(sandbox);
    assert.notEqual(quoted.code, 0);
    assert.match(quoted.output, BLOCKED);
    assert.match(quoted.output, /- "web\/app\/a\\"b\*\.tsx"$/m);
    assert.doesNotMatch(quoted.output, /- web\/app\/(i|\[id\])\/page\.tsx$/m);
  });

  it("스테이징한 파일과 같은 이름이 아니면 남은 수정·새 파일은 상관없다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, {
      "README.md": "# 처음\n",
      "web/app/page.tsx": "export default 1;\n",
    });
    git(sandbox.repo, "add", "README.md", "web/app/page.tsx");
    commit(sandbox.repo);
    stage(sandbox.repo, { "web/app/page.tsx": "export default 2;\n" });
    writeFiles(sandbox.repo, { "README.md": "# 아직 쓰는 중\n", "notes.txt": "메모\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.equal(code, 0, output);
    assert.deepEqual(calls, ["-C web verify:quick"]);
  });

  it("스테이징으로 지운 파일(git rm)·추적만 끊은 파일(git rm --cached)·이름 바꾸기(git mv)는 막지 않는다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, {
      "web/lib/a.ts": "export const a = 1;\n",
      "web/lib/b.ts": "export const b = 1;\n",
      "web/lib/c.ts": "export const c = 1;\n",
    });
    git(sandbox.repo, "add", "web/lib");
    commit(sandbox.repo);
    git(sandbox.repo, "rm", "-q", "web/lib/a.ts");
    git(sandbox.repo, "rm", "-q", "--cached", "web/lib/b.ts");
    git(sandbox.repo, "mv", "web/lib/c.ts", "web/lib/d.ts");

    const { code, output } = runGate(sandbox);

    assert.equal(code, 0, output);
    assert.doesNotMatch(output, BLOCKED);
  });

  it("이름을 바꾼 뒤 새 이름의 파일을 또 고치면 막는다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, { "web/lib/c.ts": "export const c = 1;\n" });
    git(sandbox.repo, "add", "web/lib/c.ts");
    commit(sandbox.repo);
    git(sandbox.repo, "mv", "web/lib/c.ts", "web/lib/d.ts");
    writeFiles(sandbox.repo, { "web/lib/d.ts": "export const d = 1;\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /- web\/lib\/d\.ts$/m);
    assert.doesNotMatch(output, /- web\/lib\/c\.ts$/m);
    assert.deepEqual(calls, []);
  });

  it("스테이징 뒤 시각만 바뀌고 내용이 같으면 막지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "web/app/page.tsx": "export default 1;\n" });
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(sandbox.repo, "web/app/page.tsx"), later, later);

    const { code, output } = runGate(sandbox);

    assert.equal(code, 0, output);
  });

  it("실제 git commit 에서도 같다 — 부분 스테이징은 막고, commit -a·commit <경로> 는 통과한다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, {
      "web/app/page.tsx": "export default 1;\n",
      "web/app/other.tsx": "export default 1;\n",
    });
    git(sandbox.repo, "add", "web/app");
    commit(sandbox.repo);
    stage(sandbox.repo, { "web/app/page.tsx": "export default 2;\n" });
    writeFiles(sandbox.repo, {
      "web/app/page.tsx": "export default 3;\n",
      "web/app/other.tsx": "export default 2;\n",
    });

    const partial = commitThroughGate(sandbox, "-q", "-m", "test: 부분");
    assert.notEqual(partial.code, 0);
    assert.match(partial.output, BLOCKED);
    assert.match(partial.output, /- web\/app\/page\.tsx$/m);

    // git commit <경로>: git 이 HEAD + 그 경로로 임시 인덱스를 만들어 게이트에 넘긴다.
    const only = commitThroughGate(sandbox, "-q", "-m", "test: 경로만", "--", "web/app/other.tsx");
    assert.equal(only.code, 0, only.output);

    // git commit -a: 추적 중인 수정을 모두 담은 인덱스로 게이트를 부른다.
    const all = commitThroughGate(sandbox, "-q", "-a", "-m", "test: 전부");
    assert.equal(all.code, 0, all.output);
    assert.equal(git(sandbox.repo, "status", "--porcelain", "--untracked-files=no").toString(), "");
  });
});

describe("게이트를 이루는 파일이 바뀌면 게이트 시험(pnpm test)을 돈다", () => {
  it("web·mobile 의 package.json(verify 스크립트)만 바뀌면 폴더 검사와 package.json 을 읽는 시험만 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/package.json": '{ "scripts": {} }\n',
      "mobile/package.json": '{ "scripts": {} }\n',
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick", "-C mobile verify:quick", "test:package"]);
  });

  it("루트 package.json 만 바뀌어도 package.json 을 읽는 시험만 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "package.json": '{ "scripts": {} }\n' });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test:package"]);
  });

  it("package.json 과 게이트 파일이 함께 바뀌면 전체 게이트 시험을 한 번만 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/package.json": '{ "scripts": {} }\n',
      "scripts/commit-message.mjs": "export {};\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick", "format:check", "test"]);
  });

  it("CI 설정(.github/)이 바뀌면 서식 검사와 게이트 시험을 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      ".github/workflows/ci.yml": "name: ci\n",
      ".github/dependabot.yml": "version: 2\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });

  it("Claude 설정(.claude/settings.json — 가드 훅을 거는 곳)이 바뀌면 게이트 시험을 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { ".claude/settings.json": "{}\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });

  it("scripts/ 아래 하위 폴더의 파일이 바뀌어도 게이트 시험을 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "scripts/hooks/helper.mjs": "export {};\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "test"]);
  });

  it("Claude 의 명령·스킬 문서만 바뀌면 게이트 시험을 돌리지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { ".claude/commands/demo.md": "# 데모\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, []);
  });
});

describe("서식(Prettier) — 루트 파일은 루트가, web·mobile 은 각 폴더가 본다", () => {
  it("루트가 가진 설정 파일이 바뀌면 루트 서식 검사를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      ".vscode/settings.json": "{}\n",
      "vercel.json": "{}\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check"]);
  });

  it("web·mobile 아래 파일은 루트 서식 검사를 돌리지 않는다 — 각 폴더 verify:quick 이 본다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/components.json": "{}\n",
      "mobile/app.json": "{}\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C web verify:quick", "-C mobile verify:quick"]);
  });

  it("서식 대상이 아닌 파일(마크다운·셸·Polaris)만 바뀌면 서식 검사를 돌리지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "docs/guide.md": "# 안내\n",
      "tools/run.sh": "echo hi\n",
      "polaris/specs/planned/demo.json": "{}\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, []);
  });

  it("서식이 어긋나면 고치는 법과 함께 막고 뒤 검사는 돌리지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "design/tokens.json": "{}\n" });

    const { code, output, calls } = runGate(sandbox, { failOn: "format:check" });

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\] 서식[\s\S]*pnpm format/);
    assert.deepEqual(calls, ["format:check"]);
  });

  it("서식 설정이 바뀌면 루트와 web·mobile 서식을 모두 본다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { ".prettierrc.json": "{}\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "-C web format:check", "-C mobile format:check"]);
  });

  it("무시 목록만 바뀌어도 같고, 없는 폴더는 건너뛴다", (t) => {
    const sandbox = createSandbox(t);
    rmSync(join(sandbox.repo, "mobile"), { recursive: true });
    stage(sandbox.repo, { ".prettierignore": "*.md\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "-C web format:check"]);
  });

  it("서식 설정이 바뀌었는데 폴더 의존성이 없으면 설치하라고 안내하며 막는다", (t) => {
    const sandbox = createSandbox(t);
    rmSync(join(sandbox.repo, "web/node_modules"), { recursive: true });
    stage(sandbox.repo, { ".prettierrc.json": "{}\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /pnpm -C web install/);
    assert.deepEqual(calls, ["format:check"]);
  });

  it("서식 설정 때문에 폴더 서식이 어긋나면 그 폴더를 짚어 막는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { ".prettierrc.json": "{}\n" });

    const { code, output, calls } = runGate(sandbox, { failOn: "-C mobile format:check" });

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\][\s\S]*pnpm -C mobile format/);
    assert.deepEqual(calls, ["format:check", "-C web format:check", "-C mobile format:check"]);
  });
});

describe("마이그레이션은 쌓기만 한다 (append-only)", () => {
  const INIT = "supabase/migrations/20260101000001_init.sql";

  const withAppliedMigration = (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, { [INIT]: "create table a (id int);\n" });
    git(sandbox.repo, "add", INIT);
    commit(sandbox.repo);
    return sandbox;
  };

  it("새 마이그레이션 파일 추가는 통과한다", (t) => {
    const sandbox = withAppliedMigration(t);
    stage(sandbox.repo, {
      "supabase/migrations/20260102000001_add_b.sql": "create table b (id int);\n",
    });

    const { code } = runGate(sandbox);

    assert.equal(code, 0);
  });

  it("이미 있는 마이그레이션을 고치면 막는다", (t) => {
    const sandbox = withAppliedMigration(t);
    stage(sandbox.repo, { [INIT]: "create table a (id bigint);\n" });

    const { code, output } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /20260101000001_init\.sql/);
  });

  it("이미 있는 마이그레이션을 지우면 막는다", (t) => {
    const sandbox = withAppliedMigration(t);
    git(sandbox.repo, "rm", "-q", INIT);

    const { code, output } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /20260101000001_init\.sql/);
  });

  it("이미 있는 마이그레이션의 이름을 바꾸면 막는다", (t) => {
    const sandbox = withAppliedMigration(t);
    git(sandbox.repo, "mv", INIT, "supabase/migrations/20260101000002_init.sql");

    const { code, output } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /20260101000001_init\.sql/);
  });
});

describe("DB 가 바뀌면 정책 시험과 타입 검사를 돈다", () => {
  const NEW_MIGRATION = "supabase/migrations/20260102000001_add_b.sql";

  it("새 마이그레이션을 스테이징하면 DB 정책 시험과 DB 타입 검사를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { [NEW_MIGRATION]: "create table b (id int);\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["test:db", "check:db-types"]);
  });

  it("supabase/ 아래 파일을 지워도 돈다", (t) => {
    const sandbox = createSandbox(t);
    writeFiles(sandbox.repo, { "supabase/seed.sql": "select 1;\n" });
    git(sandbox.repo, "add", "supabase/seed.sql");
    commit(sandbox.repo);
    git(sandbox.repo, "rm", "-q", "supabase/seed.sql");

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["test:db", "check:db-types"]);
  });

  it("DB 정책 시험이 실패하면 타입 검사 전에 막는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { [NEW_MIGRATION]: "create table b (id int);\n" });

    const { code, output, calls } = runGate(sandbox, { failOn: "test:db" });

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\] DB 정책 테스트/);
    assert.deepEqual(calls, ["test:db"]);
  });

  it("DB 타입 생성물이 어긋나면 고치는 법과 함께 막는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { [NEW_MIGRATION]: "create table b (id int);\n" });

    const { code, output } = runGate(sandbox, { failOn: "check:db-types" });

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\] DB 타입[\s\S]*pnpm db:types/);
  });

  it("타입 생성기나 흉내 DB 를 고치면 서식·DB 타입 검사와 게이트 테스트를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "scripts/db-types-gen.mjs": "export {};\n",
      "scripts/supabase-pglite.mjs": "export {};\n",
    });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["format:check", "check:db-types", "test"]);
  });

  it("DB 타입 생성물을 직접 고쳐 스테이징해도 DB 타입 검사를 돈다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "mobile/lib/database.types.ts": "export type Database = {};\n" });

    const { code, calls } = runGate(sandbox);

    assert.equal(code, 0);
    assert.deepEqual(calls, ["-C mobile verify:quick", "check:db-types"]);
  });
});

describe("비밀 값을 막는다", () => {
  it(".env 실파일을 스테이징하면 검사 전에 막는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "web/.env.local": "NEXT_PUBLIC_SUPABASE_URL=x\n" });

    const { code, output, calls } = runGate(sandbox);

    assert.notEqual(code, 0);
    assert.match(output, /\.env/);
    assert.deepEqual(calls, []);
  });
});

describe("새 로직 파일의 테스트 경고 (막지 않는다)", () => {
  it("web/server 에 테스트 없는 새 모델을 추가하면 경고하고 통과한다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "web/server/post/post.model.ts": "export const a = 1;\n" });

    const { code, output } = runGate(sandbox);

    assert.equal(code, 0);
    assert.match(output, /\[경고\][\s\S]*web\/server\/post\/post\.model\.ts/);
  });

  it("mobile/lib 에 테스트 없는 새 파일을 추가해도 경고한다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, { "mobile/lib/dday.ts": "export const a = 1;\n" });

    const { output } = runGate(sandbox);

    assert.match(output, /\[경고\][\s\S]*mobile\/lib\/dday\.ts/);
  });

  it("옆에 테스트가 함께 있으면 경고하지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/server/post/post.model.ts": "export const a = 1;\n",
      "web/server/post/post.model.test.ts": "export {};\n",
    });

    const { output } = runGate(sandbox);

    assert.doesNotMatch(output, /\[경고\]/);
  });

  it("DB 타입 생성물(*.types.ts)은 로직이 아니라서 경고하지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/lib/database.types.ts": "export type Database = {};\n",
      "mobile/lib/database.types.ts": "export type Database = {};\n",
    });

    const { code, output } = runGate(sandbox);

    assert.equal(code, 0);
    assert.doesNotMatch(output, /\[경고\]/);
  });

  it("배럴·저장소 파일은 로직이 아니라서 경고하지 않는다", (t) => {
    const sandbox = createSandbox(t);
    stage(sandbox.repo, {
      "web/server/post/index.ts": "export {};\n",
      "web/server/post/post.repo.ts": "export {};\n",
      "web/server/post/post.repo.supabase.ts": "export {};\n",
    });

    const { output } = runGate(sandbox);

    assert.doesNotMatch(output, /\[경고\]/);
  });
});
