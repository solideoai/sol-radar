import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "./test-support.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const runner = join(source, "verify-changed.mjs");
const config = JSON.parse(readFileSync(join(source, "../verify.config.json"), "utf8"));
// 커밋 훅의 Git 저장소/index 선택값을 임시 저장소로 넘기지 않는다.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const sandbox = (t) => {
  const root = tempDir("verify-changed-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const project of config.verification.projects) {
    mkdirSync(join(root, project.directory), { recursive: true });
    writeFileSync(join(root, project.directory, project.marker), "");
  }
  return root;
};

const plan = async (t, files) => {
  const { changedVerificationCommands } = await import("./verify-changed.mjs");
  return changedVerificationCommands(sandbox(t), config, files);
};

it("웹 변경에는 웹 검사만 실행하고 루트 DB·Python 검사를 넣지 않는다", async (t) => {
  assert.deepEqual(await plan(t, ["web/components/bid-card.tsx"]), [
    { command: "pnpm", args: ["verify:quick"], cwd: "web" },
  ]);
});

it("Python 변경에는 해당 서비스 검사만 실행한다", async (t) => {
  for (const name of ["ai", "decision"])
    assert.deepEqual(await plan(t, [`services/${name}/src/handler.py`]), [
      { command: "bash", args: ["verify.sh"], cwd: `services/${name}` },
    ]);
});

it("실행 중 읽는 Markdown 프롬프트는 AI 서비스 검사를 실행한다", async (t) => {
  assert.deepEqual(await plan(t, ["services/ai/prompts/req-extract.v0.1.md"]), [
    { command: "bash", args: ["verify.sh"], cwd: "services/ai" },
  ]);
});

it("AI 결정 모델 계약 변경은 decision의 서비스 간 호환 시험도 실행한다", async (t) => {
  for (const file of [
    "services/ai/src/sol_ai/adapters/kev_wire.py",
    "services/ai/kev/question-sets/v0.2.json",
    "services/ai/models/registry.yaml",
    "services/ai/src/sol_ai/contracts.py",
  ]) {
    const steps = await plan(t, [file]);
    assert.ok(steps.some((step) => step.cwd === "services/ai"));
    assert.ok(steps.some((step) => step.cwd === "services/decision"));
  }
});

it("결정 서버의 worker 응답 fixture 변경은 웹 wire 호환 시험도 실행한다", async (t) => {
  const steps = await plan(t, ["services/decision/tests/fixtures/worker-wire-sample.json"]);
  assert.ok(steps.some((step) => step.cwd === "web"));
  assert.ok(steps.some((step) => step.cwd === "services/decision"));
});

it("실행 모드 계약 변경은 Node 환경변수·승인 정책 시험도 실행한다", async (t) => {
  const steps = await plan(t, ["infra/run-modes.json"]);
  assert.ok(steps.some((step) => step.command === "pnpm" && step.args[0] === "test"));
});

it("새 마이그레이션은 DB 정책·타입과 의존 프로젝트 검사를 포함한다", async (t) => {
  const steps = await plan(t, ["supabase/migrations/20261021000001.sql"]);
  assert.ok(steps.some((step) => step.args[0] === "test"));
  assert.ok(steps.some((step) => step.args[0] === "check:db-types"));
  assert.ok(steps.some((step) => step.cwd === "web"));
});

it("DB 타입 생성물을 직접 바꿔도 정본 일치 검사를 실행한다", async (t) => {
  const steps = await plan(t, ["web/lib/database.types.ts"]);
  assert.ok(steps.some((step) => step.args[0] === "check:db-types"));
});

it("파서 입력 PDF fixture는 문서로 제외하지 않고 의존 검사를 실행한다", async (t) => {
  const steps = await plan(t, ["fixtures/documents/rfp.pdf"]);
  assert.ok(steps.some((step) => step.args[0] === "test"));
  assert.ok(steps.some((step) => step.cwd === "web"));
  assert.ok(steps.some((step) => step.cwd === "services/ai"));
});

it("문서·증거·발표자료만 바뀌면 코드 검사를 실행하지 않는다", async (t) => {
  assert.deepEqual(
    await plan(t, ["AGENTS.md", "docs/evidence/result.json", "polaris/specs/new.md", "deck.pptx"]),
    [],
  );
});

it("미분류 코드와 검증 설정 변경은 전체 quick 검사로 넓힌다", async (t) => {
  for (const file of ["new-tool.js", "verify.config.json"])
    assert.deepEqual(
      (await plan(t, [file])).map((step) => [step.command, step.args, step.cwd ?? "."]),
      [
        ["pnpm", ["format:check"], "."],
        ["pnpm", ["test"], "."],
        ["pnpm", ["check:tokens"], "."],
        ["pnpm", ["check:colors"], "."],
        ["pnpm", ["check:db-types"], "."],
        ["pnpm", ["verify:quick"], "web"],
        ["bash", ["verify.sh"], "services/ai"],
        ["bash", ["verify.sh"], "services/decision"],
      ],
    );
});

const gitRepo = (t) => {
  const root = sandbox(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, env: gitEnv, encoding: "utf8" });
  git("init", "-q");
  for (const name of ["edit.ts", "old.ts", "delete.ts"]) writeFileSync(join(root, name), name);
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "chore: baseline",
  );
  return { root, git };
};

// changedFiles 내부의 Git 호출도 같은 격리 환경에서 실제로 실행한다.
const changedFiles = (root, base) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { changedFiles } from ${JSON.stringify(new URL("./verify-changed.mjs", import.meta.url).href)};
process.stdout.write(JSON.stringify(changedFiles(process.argv[1], process.argv[2])));`,
        root,
        ...(base === undefined ? [] : [base]),
      ],
      { env: gitEnv, encoding: "utf8" },
    ),
  );

it("커밋 훅의 Git 환경에서도 임시 저장소 시험은 호출 저장소를 바꾸지 않는다", (t) => {
  const { root, git } = gitRepo(t);
  const snapshot = () => [
    git("rev-parse", "HEAD"),
    git("ls-files", "--stage"),
    git("config", "--local", "--list"),
  ];
  const before = snapshot();
  const child = spawnSync(
    process.execPath,
    ["--test", "--test-name-pattern=^실제 Git에서", fileURLToPath(import.meta.url)],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith("GIT_") && key !== "NODE_TEST_CONTEXT",
          ),
        ),
        GIT_DIR: join(root, ".git"),
        GIT_COMMON_DIR: join(root, ".git"),
        GIT_WORK_TREE: root,
        GIT_INDEX_FILE: join(root, ".git", "index"),
      },
    },
  );
  assert.deepEqual(
    snapshot(),
    before,
    "임시 저장소 시험이 호출 저장소의 HEAD/index/config를 바꿨습니다",
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /실제 Git에서 staged/, child.stdout + child.stderr);
});

it("실제 Git에서 staged·unstaged·새 파일·삭제·이름 변경 양쪽을 수집한다", (t) => {
  const { root, git } = gitRepo(t);
  writeFileSync(join(root, "edit.ts"), "changed");
  git("mv", "old.ts", "renamed.ts");
  rmSync(join(root, "delete.ts"));
  writeFileSync(join(root, "한글 새 파일.ts"), "new");
  assert.deepEqual(changedFiles(root), [
    "delete.ts",
    "edit.ts",
    "old.ts",
    "renamed.ts",
    "한글 새 파일.ts",
  ]);
  assert.throws(() => changedFiles(root, "missing-branch"), /변경 파일/);
});

it("기준 커밋을 지정하면 이미 커밋한 변경도 검사한다", (t) => {
  const { root, git } = gitRepo(t);
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(root, "edit.ts"), "committed");
  git("add", "edit.ts");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "chore: change",
  );
  assert.deepEqual(changedFiles(root), []);
  assert.deepEqual(changedFiles(root, base), ["edit.ts"]);
});

it("CLI dry-run은 실행 없이 명령을 보여 주고 실제 실행은 첫 실패에서 멈춘다", (t) => {
  const { root } = gitRepo(t);
  mkdirSync(join(root, "scripts"));
  for (const name of ["verify-changed.mjs", "project-config.mjs", "command.mjs"])
    cpSync(join(source, name), join(root, "scripts", name));
  const marker = join(root, "should-not-run");
  writeFileSync(
    join(root, "verify.config.json"),
    JSON.stringify({
      version: 1,
      verification: {
        common: [
          { command: process.execPath, args: ["-e", "process.exit(7)"] },
          {
            command: process.execPath,
            args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`],
          },
        ],
        projects: [],
      },
      migrationDirectories: [],
    }),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, "scripts", "verify-changed.mjs"), ...args], {
      env: gitEnv,
      encoding: "utf8",
    });
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).steps.length, 2);
  assert.equal(run().status, 7);
  assert.throws(() => readFileSync(marker), /ENOENT/);
  assert.notEqual(run("--base").status, 0);
  assert.notEqual(run("--base", "missing-branch").status, 0);
  assert.notEqual(run("--unknown").status, 0);
});
