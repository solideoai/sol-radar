// db:verify CLI 가 외부 오류의 접속 주소·토큰·행 데이터를 출력하지 않는지 실제 CLI 를 돌려 확인한다.
// 원본 코드를 임시 폴더에 복사하고 pg 만 가짜로 바꾼다. 네트워크·실제 DB·실제 키는 쓰지 않는다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SYNTHETIC_URL =
  "postgres://synthetic:synthetic-token-DO-NOT-PRINT@db.example.invalid:5432/postgres";
// 합성 비밀값. 어떤 실행에서도 stdout·stderr 에 나오면 안 된다.
const LEAKS =
  /postgres:\/\/|synthetic-token-DO-NOT-PRINT|synthetic-row-DO-NOT-PRINT|example\.invalid/;

// pg 이름만 fixture 의 fake-pg.mjs 로 바꾸고, 나머지는 원래 해석에 맡긴다.
const LOADER = `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "pg")
    return { url: new URL("./fake-pg.mjs", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
`;

// FAKE_PG_MODE 로 실패 자리를 고르는 가짜 pg. FAKE_PG_LOG 가 있으면 생성·커밋·종료를 적는다.
const FAKE_PG = `import { appendFileSync, readdirSync } from "node:fs";
import { collectMigrations } from "./scripts/migrations.mjs";

const SECRET = "synthetic-token-DO-NOT-PRINT";
const ROW = "synthetic-row-DO-NOT-PRINT";
const mode = process.env.FAKE_PG_MODE ?? "connect";
const record = (event) =>
  process.env.FAKE_PG_LOG && appendFileSync(process.env.FAKE_PG_LOG, event + "\\n");
const { migrations } = collectMigrations(
  readdirSync(new URL("./supabase/migrations/", import.meta.url)),
);
const failure = (message, extra) => Object.assign(new Error(message), extra);

const answer = (sql) => {
  if (sql.includes("to_regclass('supabase_migrations"))
    return [{ history: "supabase_migrations.schema_migrations" }];
  if (sql.includes("from supabase_migrations.schema_migrations"))
    return migrations.map((migration) => ({ version: migration.version }));
  if (sql.includes("relrowsecurity")) return [];
  if (sql.includes("server_version_num")) return [{ version: 170004 }];
  if (sql.includes("prosecdef"))
    return mode === "bypasses"
      ? [{ schema_name: "public", name: "profile_emails", kind: "view", role: "anon", problem: "SELECT" }]
      : [];
  if (sql.includes("has_table_privilege"))
    return mode === "privileges"
      ? [{ table_schema: "public", table_name: "notes", role: "anon", privilege: "TRUNCATE" }]
      : [];
  if (sql.includes("pg_roles")) return [{ rolname: "anon" }, { rolname: "authenticated" }];
  return [];
};

class Client {
  constructor(options) {
    this.options = options;
    record("new");
  }
  async connect() {
    if (mode === "connect")
      throw new Error("upstream failure includes " + this.options.connectionString + " " + SECRET);
    if (mode === "connect-code")
      throw failure("connect ECONNREFUSED " + this.options.connectionString + " " + SECRET, {
        code: "ECONNREFUSED",
      });
  }
  async query(sql) {
    if (sql === "commit") record("commit");
    if (mode === "query" && sql.includes("has_table_privilege"))
      throw failure("permission denied near " + this.options.connectionString, {
        code: "42501",
        detail: "Failing row contains (" + ROW + ", " + SECRET + ")",
        hint: "retry with " + SECRET,
        cause: new Error(this.options.connectionString),
      });
    if (mode === "plain" && sql.includes("schema_migrations"))
      throw failure("bad value " + SECRET + " in row " + ROW, {
        code: "SYN7K",
        detail: ROW,
      });
    if (mode === "untrusted-code" && sql.includes("schema_migrations"))
      throw failure(ROW, { code: SECRET });
    return { rows: answer(sql) };
  }
  async end() {
    record("end");
  }
}

export default { Client };
`;

// 원본 db-verify.mjs·migrations.mjs·마이그레이션을 읽어 복사한 fixture 에서 fn 을 돌리고, 끝나면 지운다.
// CLI 는 argv[1] 과 실제 모듈 경로를 비교하므로 임시 폴더의 symlink(macOS /var → /private/var)를 푼다.
const withFixture = (fn) => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "db-verify-privacy-")));
  try {
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "supabase", "migrations"), { recursive: true });
    for (const file of ["db-verify.mjs", "migrations.mjs"])
      writeFileSync(
        join(fixture, "scripts", file),
        readFileSync(join(root, "scripts", file), "utf8"),
      );
    const migrations = join(root, "supabase", "migrations");
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")))
      copyFileSync(join(migrations, file), join(fixture, "supabase", "migrations", file));
    writeFileSync(join(fixture, "privacy-loader.mjs"), LOADER);
    writeFileSync(join(fixture, "fake-pg.mjs"), FAKE_PG);
    return fn(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
};

// --loader 는 URL 을 받는다. Windows 의 C: 경로를 그대로 넘기면 c: 스킴으로 읽힌다.
const loaderUrl = (fixture) => pathToFileURL(join(fixture, "privacy-loader.mjs")).href;

const runCli = (fixture, env) =>
  spawnSync(
    process.execPath,
    ["--loader", loaderUrl(fixture), join(fixture, "scripts/db-verify.mjs")],
    { encoding: "utf8", env },
  );

// mode 로 CLI 를 돌리고 결과와 가짜 pg 기록(생성·커밋·종료)을 돌려준다.
const runMode = (fixture, mode, { url = SYNTHETIC_URL } = {}) => {
  const log = join(fixture, "pg.log");
  rmSync(log, { force: true });
  const env = { FAKE_PG_MODE: mode, FAKE_PG_LOG: log };
  if (url) env.SUPABASE_DB_URL = url;
  const result = runCli(fixture, env);
  const events = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { result, events };
};

const assertNoLeak = (result) => {
  assert.doesNotMatch(result.stderr, LEAKS);
  assert.doesNotMatch(result.stdout, LEAKS);
};

describe("db:verify CLI 는 외부 오류 원문을 출력하지 않는다", () => {
  it("접속 오류의 합성 URL·토큰을 출력하지 않고 1로 끝난다 (독립 재현)", () => {
    withFixture((fixture) => {
      const result = spawnSync(
        process.execPath,
        ["--loader", loaderUrl(fixture), join(fixture, "scripts/db-verify.mjs")],
        {
          encoding: "utf8",
          env: {
            SUPABASE_DB_URL:
              "postgres://synthetic:synthetic-token-DO-NOT-PRINT@db.example.invalid:5432/postgres",
          },
        },
      );
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stderr, /postgres:\/\/|synthetic-token-DO-NOT-PRINT/);
    });
  });

  it("접속 오류는 고정 안내만 보여 주고 연결을 정리한다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "connect");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.match(result.stderr, /DB 검증 실패: DB 접속 또는 조회 중 오류가 났습니다\./);
      assert.doesNotMatch(result.stderr, /코드/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("목록에 있는 접속 오류 코드는 보여 주되 메시지는 옮기지 않는다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "connect-code");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.match(result.stderr, /코드 ECONNREFUSED/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("쿼리 오류의 message·detail·hint·cause 를 옮기지 않고, 커밋하지 않고 연결을 닫는다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "query");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.match(result.stderr, /코드 42501/);
      assert.doesNotMatch(result.stderr, /Failing row|retry with|permission denied/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("URL 형식 없이 토큰·행 문자열만 담은 오류도, 목록에 없는 코드도 출력하지 않는다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "plain");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.doesNotMatch(result.stderr, /SYN7K|bad value|코드/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("오류 코드 자리에 든 비밀 문자열을 믿지 않는다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "untrusted-code");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.doesNotMatch(result.stderr, /코드/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });
});

describe("db:verify CLI 는 안전한 검증 안내를 유지한다", () => {
  it("위험 권한은 표·역할·권한과 해결 안내를 보여 주고 1로 끝난다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "privileges");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.match(
        result.stderr,
        /화면 역할\(anon·authenticated\)에 위험한 표 권한이 남아 있습니다/,
      );
      assert.match(result.stderr, /^ {2}public\.notes anon TRUNCATE$/m);
      assert.match(result.stderr, /revoke all on <표> from anon, authenticated, public;/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("뷰·함수 길은 객체·역할·문제와 고치는 법을 보여 주고 1로 끝난다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "bypasses");
      assert.equal(result.status, 1);
      assertNoLeak(result);
      assert.match(
        result.stderr,
        /RLS 를 거치지 않고 화면 역할\(anon·authenticated\)에 열려 있습니다/,
      );
      assert.match(result.stderr, /^ {2}public\.profile_emails 뷰 anon SELECT$/m);
      assert.match(result.stderr, /alter view <뷰> set \(security_invoker = true\);/);
      assert.deepEqual(events, ["new", "end"]);
    });
  });

  it("SUPABASE_DB_URL 이 없으면 접속하지 않고 안내와 함께 1로 끝난다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "ok", { url: "" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DB 검증 실패: SUPABASE_DB_URL 이 없습니다/);
      assert.deepEqual(events, []);
    });
  });

  it("모든 검사를 통과하면 커밋하고 연결을 닫은 뒤 0으로 끝난다", () => {
    withFixture((fixture) => {
      const { result, events } = runMode(fixture, "ok");
      assert.equal(result.status, 0, result.stderr);
      assertNoLeak(result);
      assert.match(
        result.stdout,
        /✓ DB 연결·마이그레이션 \d+개·RLS 활성화·화면 역할 권한·뷰·함수 확인/,
      );
      assert.deepEqual(events, ["new", "commit", "end"]);
    });
  });
});
