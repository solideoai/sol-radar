// 배포 wrapper(web/scripts/vercel-build.sh) 시험 — 운영 배포가 DB 검사를 통과한 뒤에만 빌드하는지 본다.
// 실행: 루트에서 `pnpm test`
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, presentProjects } from "../project-config.mjs";
import { pathWith, systemPath, writeExecutable } from "../test-support.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const real = (path) => readFileSync(join(REPO, path));
// 웹이 없는 프로젝트에서는 건너뛴다. 판정은 verify 와 같은 marker 기준이다.
const PRESENT = new Set(
  presentProjects(REPO, loadConfig(REPO)).map((project) => project.directory),
);
const skipUnless = (dir) => (PRESENT.has(dir) ? false : `${dir}/ 가 없는 프로젝트`);
const scratch = mkdtempSync(join(tmpdir(), "vercel-build-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const fresh = (name) => mkdtempSync(join(scratch, `${name}-`));

const put = (root, files) => {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
};

// ── 배포 wrapper ──
// 실제 wrapper·DB 검증 스크립트를 임시 폴더의 같은 상대 위치에 두고 바깥 프로그램만 바꾼다.
// node 는 호출을 기록한 뒤 진짜 node 로 넘기고, pnpm 은 기록만 하고, pg 는 정해 둔 답을 하는 가짜다.
const WRAPPER_FILES = [
  "web/package.json",
  "web/scripts/vercel-build.sh",
  "web/scripts/verify-db.mjs",
  "scripts/db-verify.mjs",
  "scripts/migrations.mjs",
];

const FAKE_NODE = `#!/bin/sh
printf 'node %s\\n' "$*" >> "$DEPLOY_LOG"
exec "$REAL_NODE" "$@"
`;
const FAKE_PNPM = `#!/bin/sh
printf 'pnpm %s\\n' "$*" >> "$DEPLOY_LOG"
exit "\${FAKE_PNPM_EXIT:-0}"
`;
// FAKE_PG: ok(모든 검사 통과) · refuse(접속 실패) · pending(적용 이력이 비어 있음)
const FAKE_PG = `const { appendFileSync, readdirSync } = require("node:fs");
const log = (line) => appendFileSync(process.env.DEPLOY_LOG, line + "\\n");
const versions = () =>
  readdirSync(process.env.FAKE_MIGRATIONS)
    .map((file) => /^(\\d+)_.+\\.sql$/.exec(file)?.[1])
    .filter(Boolean);
class Client {
  async connect() {
    log("pg connect");
    if (process.env.FAKE_PG === "refuse")
      throw Object.assign(new Error("password authentication failed: postgres://user:leaked-pass@db"), { code: "28P01" });
  }
  async query(sql) {
    const text = sql.replace(/\\s+/g, " ").trim();
    if (text === "begin read only") return { rows: [] };
    if (text === "commit") {
      log("pg commit");
      return { rows: [] };
    }
    if (text.includes("to_regclass")) return { rows: [{ history: "supabase_migrations.schema_migrations" }] };
    if (text.startsWith("select version from supabase_migrations"))
      return { rows: process.env.FAKE_PG === "pending" ? [] : versions().map((version) => ({ version })) };
    if (text.includes("server_version_num")) return { rows: [{ version: 170004 }] };
    if (text.includes("has_table_privilege")) return { rows: [] };
    if (text.startsWith("select rolname")) return { rows: [{ rolname: "anon" }, { rolname: "authenticated" }] };
    if (text.includes("relrowsecurity")) return { rows: [] };
    throw new Error("예상하지 못한 쿼리: " + text);
  }
  async end() {
    log("pg end");
  }
}
module.exports = { Client };
`;

function makeDeployment() {
  const root = fresh("deploy");
  put(root, Object.fromEntries(WRAPPER_FILES.map((path) => [path, real(path)])));
  const migrations = readdirSync(join(REPO, "supabase/migrations")).filter((file) =>
    file.endsWith(".sql"),
  );
  assert.ok(migrations.length, "마이그레이션이 하나 이상 있어야 한다");
  put(
    root,
    Object.fromEntries(
      migrations.map((file) => [
        `supabase/migrations/${file}`,
        real(`supabase/migrations/${file}`),
      ]),
    ),
  );
  put(root, {
    "web/node_modules/pg/package.json": JSON.stringify({ name: "pg", main: "index.js" }),
    "web/node_modules/pg/index.js": FAKE_PG,
  });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeExecutable(join(root, "bin/node"), FAKE_NODE);
  writeExecutable(join(root, "bin/pnpm"), FAKE_PNPM);
  return root;
}

// pnpm vercel-build 가 부르는 web/package.json 의 스크립트를 그대로 실행한다(셸 없이 argv 로).
function vercelBuild(env) {
  const root = makeDeployment();
  const log = join(root, "deploy.log");
  writeFileSync(log, "");
  const script = JSON.parse(real("web/package.json")).scripts["vercel-build"];
  assert.ok(script, "web/package.json 에 vercel-build 스크립트가 있어야 한다");
  const [command, ...args] = script.split(" ");
  const result = spawnSync(command, args, {
    cwd: join(root, "web"),
    encoding: "utf8",
    // 테스트를 돌리는 셸의 VERCEL_ENV·DB 값이 섞이지 않게 환경을 새로 만든다
    env: {
      PATH: pathWith(join(root, "bin"), systemPath),
      DEPLOY_LOG: log,
      REAL_NODE: process.execPath,
      FAKE_MIGRATIONS: join(root, "supabase/migrations"),
      ...env,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: result.status, calls, output: result.stdout + result.stderr };
}

const DB_CHECK = "node scripts/verify-db.mjs";
const BUILD = "pnpm build";
const DB = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.example",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_DB_URL: "postgres://user:pass@db.example.test:5432/postgres",
};

describe(
  "배포 wrapper(pnpm vercel-build) — 운영 DB 검사가 빌드보다 먼저다",
  { skip: skipUnless("web") },
  () => {
    test("운영 + DB 값: DB 검사가 통과한 뒤에만 빌드한다", () => {
      const run = vercelBuild({ VERCEL_ENV: "production", ...DB, FAKE_PG: "ok" });
      assert.equal(run.status, 0, run.output);
      assert.deepEqual(run.calls, [DB_CHECK, "pg connect", "pg commit", "pg end", BUILD]);
    });

    test("운영 + 미적용 마이그레이션: 커밋·빌드 없이 실패한다", () => {
      const run = vercelBuild({ VERCEL_ENV: "production", ...DB, FAKE_PG: "pending" });
      assert.notEqual(run.status, 0);
      assert.deepEqual(run.calls, [DB_CHECK, "pg connect", "pg end"]);
    });

    test("운영 + DB 접속 실패: 빌드하지 않고, 빌드 로그에 오류 원문 대신 코드만 남긴다", () => {
      const run = vercelBuild({ VERCEL_ENV: "production", ...DB, FAKE_PG: "refuse" });
      assert.notEqual(run.status, 0);
      assert.deepEqual(run.calls, [DB_CHECK, "pg connect", "pg end"]);
      // 드라이버 오류 원문에는 접속 주소·비밀번호가 섞일 수 있다. 빌드 로그는 남으므로 옮기지 않는다.
      assert.ok(!run.output.includes("leaked-pass"), run.output);
      assert.match(run.output, /코드 28P01/);
    });

    for (const [label, env] of [
      ["공개 URL 만", { NEXT_PUBLIC_SUPABASE_URL: DB.NEXT_PUBLIC_SUPABASE_URL }],
      ["REQUIRE_DATABASE=1 만", { REQUIRE_DATABASE: "1" }],
    ])
      test(`운영 + ${label} 있고 SUPABASE_DB_URL 이 없으면 접속하지 않고 빌드도 하지 않는다`, () => {
        const run = vercelBuild({ VERCEL_ENV: "production", ...env, FAKE_PG: "ok" });
        assert.notEqual(run.status, 0);
        assert.deepEqual(run.calls, [DB_CHECK]);
      });

    test("운영 + SUPABASE_DB_URL 만 있어도 검사한다", () => {
      const run = vercelBuild({
        VERCEL_ENV: "production",
        SUPABASE_DB_URL: DB.SUPABASE_DB_URL,
        FAKE_PG: "ok",
      });
      assert.equal(run.status, 0, run.output);
      assert.deepEqual(run.calls, [DB_CHECK, "pg connect", "pg commit", "pg end", BUILD]);
    });

    test("운영 + DB 값이 하나도 없으면(DB 미사용) 검사 없이 빌드한다", () => {
      const run = vercelBuild({ VERCEL_ENV: "production" });
      assert.equal(run.status, 0, run.output);
      assert.deepEqual(run.calls, [BUILD]);
    });

    test("Preview 는 DB 값이 있어도 검사 없이 빌드한다(현재 계약)", () => {
      const run = vercelBuild({ VERCEL_ENV: "preview", ...DB, REQUIRE_DATABASE: "1" });
      assert.equal(run.status, 0, run.output);
      assert.deepEqual(run.calls, [BUILD]);
    });

    test("빌드가 실패하면 wrapper 도 실패한다", () => {
      const run = vercelBuild({ VERCEL_ENV: "production", FAKE_PNPM_EXIT: "1" });
      assert.notEqual(run.status, 0);
      assert.deepEqual(run.calls, [BUILD]);
    });
  },
);
