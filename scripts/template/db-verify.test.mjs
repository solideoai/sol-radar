// 배포 전 DB 검증을 실제 네트워크 없이 주입한 Client 로 확인한다.
// 실제 PostgreSQL 엔진에서의 권한 판정은 database.test.mjs 가 본다.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DbVerifyError,
  assertNoDangerousPrivileges,
  assertNoRlsBypasses,
  describeFailure,
  findDangerousPrivileges,
  findRlsBypasses,
  runDbVerification,
} from "../db-verify.mjs";
import { collectMigrations } from "../migrations.mjs";

const { migrations } = collectMigrations(
  await readdir(new URL("../../supabase/migrations/", import.meta.url)),
);
const SECRET_URL = "postgres://user:very-secret-token@db.example.invalid:5432/postgres";

// 쿼리 문장으로 응답을 고르는 가짜 Client. fail 에 준 조각이 들어간 쿼리(또는 "connect")는 실패한다.
// 뷰·함수 쿼리는 표 권한 쿼리와 같은 함수 이름을 품을 수 있어 prosecdef 로 먼저 고른다.
const fakeDb = ({
  version = 170004,
  roles = ["anon", "authenticated"],
  privileges = [],
  bypasses = [],
  unlocked = [],
  fail,
} = {}) => {
  const log = { options: undefined, queries: [], ended: false };
  const answer = (sql) => {
    if (sql.includes("to_regclass('supabase_migrations"))
      return [{ history: "supabase_migrations.schema_migrations" }];
    if (sql.includes("from supabase_migrations.schema_migrations"))
      return migrations.map((migration) => ({ version: migration.version }));
    if (sql.includes("relrowsecurity")) return unlocked.map((relname) => ({ relname }));
    if (sql.includes("server_version_num")) return [{ version }];
    if (sql.includes("prosecdef")) return bypasses;
    if (sql.includes("has_table_privilege")) return privileges;
    if (sql.includes("pg_roles")) return roles.map((rolname) => ({ rolname }));
    return [];
  };
  class Client {
    constructor(options) {
      log.options = options;
    }
    async connect() {
      if (fail === "connect") throw new Error("connect refused");
    }
    async query(sql) {
      log.queries.push(sql);
      if (fail && fail !== "connect" && sql.includes(fail)) throw new Error("query failed");
      return { rows: answer(sql) };
    }
    async end() {
      log.ended = true;
    }
  }
  return { Client, log };
};

// 검사기를 바로 부를 때 쓰는 연결된 가짜 Client.
const fakeClient = (options) => {
  const { Client, log } = fakeDb(options);
  return { client: new Client(), log };
};

const privilegeQuery = (log) =>
  log.queries.find((sql) => sql.includes("has_table_privilege") && !sql.includes("prosecdef"));
const bypassQuery = (log) => log.queries.find((sql) => sql.includes("prosecdef"));
// 버전 확인·화면 역할 확인 쿼리를 몇 번 보냈는지 센다.
const versionChecks = (log) => log.queries.filter((sql) => sql.includes("server_version_num"));
const roleChecks = (log) => log.queries.filter((sql) => sql.startsWith("select rolname"));

// 뷰·함수 쿼리가 돌려주는 행 한 줄.
const bypassRow = (name, kind, role, problem, schema = "public") => ({
  schema_name: schema,
  name,
  kind,
  role,
  problem,
});

describe("runDbVerification", () => {
  const saved = process.env.SUPABASE_DB_URL;
  beforeEach(() => {
    process.env.SUPABASE_DB_URL = SECRET_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = saved;
  });

  it("주소가 없으면 접속하지 않고 실패한다", async () => {
    delete process.env.SUPABASE_DB_URL;
    const { Client, log } = fakeDb();
    await assert.rejects(runDbVerification(Client), /SUPABASE_DB_URL/);
    assert.equal(log.options, undefined);
  });

  it("TLS 검증·시간 제한을 걸고 읽기 전용 트랜잭션에서 검사한 뒤 연결을 닫는다", async (t) => {
    t.mock.method(console, "log", () => {});
    const { Client, log } = fakeDb();
    await runDbVerification(Client);
    assert.equal(log.options.ssl.rejectUnauthorized, true);
    assert.equal(log.options.connectionTimeoutMillis, 10_000);
    assert.equal(log.options.statement_timeout, 30_000);
    assert.equal(log.queries[0], "begin read only");
    assert.equal(log.queries.at(-1), "commit");
    assert.ok(privilegeQuery(log), "권한 검사를 돌린다");
    assert.ok(bypassQuery(log), "뷰·함수 검사를 돌린다");
    assert.equal(log.ended, true);
  });

  it("PostgreSQL 버전과 화면 역할은 두 검사기가 같이 쓰도록 한 번씩만 확인한다", async (t) => {
    t.mock.method(console, "log", () => {});
    const { Client, log } = fakeDb();
    await runDbVerification(Client);
    assert.equal(versionChecks(log).length, 1);
    assert.equal(roleChecks(log).length, 1);
  });

  it("위험 권한이 있으면 정렬해 안내하고, 커밋하지 않고 연결을 닫는다", async () => {
    const { Client, log } = fakeDb({
      privileges: [
        {
          table_schema: "public",
          table_name: "things",
          role: "authenticated",
          privilege: "TRUNCATE",
        },
        { table_schema: "public", table_name: "notes", role: "anon", privilege: "TRUNCATE" },
        { table_schema: "public", table_name: "notes", role: "anon", privilege: "REFERENCES" },
      ],
    });
    const error = await runDbVerification(Client).then(
      () => assert.fail("성공하면 안 된다"),
      (caught) => caught,
    );
    const lines = error.message.split("\n").filter((line) => line.startsWith("  "));
    assert.deepEqual(lines, [
      "  public.notes anon REFERENCES",
      "  public.notes anon TRUNCATE",
      "  public.things authenticated TRUNCATE",
    ]);
    assert.ok(!error.message.includes("very-secret-token"), "접속 주소를 출력하지 않는다");
    assert.ok(!log.queries.includes("commit"));
    assert.equal(log.ended, true);
  });

  it("뷰·함수 길이 있으면 정렬해 안내하고, 나온 문제의 고치는 법만 붙이고, 커밋하지 않는다", async () => {
    const { Client, log } = fakeDb({
      bypasses: [
        bypassRow("z_view", "view", "authenticated", "SELECT"),
        bypassRow("leak()", "function", "anon", "EXECUTE"),
        bypassRow("z_view", "view", "anon", "SELECT"),
        bypassRow("leak()", "function", null, "search_path"),
      ],
    });
    const error = await runDbVerification(Client).then(
      () => assert.fail("성공하면 안 된다"),
      (caught) => caught,
    );
    assert.ok(error instanceof DbVerifyError);
    const lines = error.message.split("\n");
    assert.match(lines[0], /RLS 를 거치지 않고 화면 역할\(anon·authenticated\)에 열려 있습니다/);
    assert.deepEqual(lines.slice(1, 5), [
      "  public.leak() SECURITY DEFINER 함수 search_path 미고정",
      "  public.leak() SECURITY DEFINER 함수 anon EXECUTE",
      "  public.z_view 뷰 anon SELECT",
      "  public.z_view 뷰 authenticated SELECT",
    ]);
    const fixes = lines.slice(lines.indexOf("새 마이그레이션에서 고치세요:") + 1);
    assert.deepEqual(
      fixes.map((line) => line.trim().split(":")[0]),
      ["뷰", "함수 실행", "함수 search_path"],
    );
    assert.match(error.message, /security_invoker = true/);
    assert.doesNotMatch(error.message, /머티리얼라이즈드/);
    assert.ok(!error.message.includes("very-secret-token"), "접속 주소를 출력하지 않는다");
    assert.ok(!log.queries.includes("commit"));
    assert.equal(log.ended, true);
  });

  // public 에 깐 확장(PostGIS 의 spatial_ref_sys 등)의 표는 RLS 가 꺼져 있고 확장 소유라 마이그레이션이 고치지 못한다.
  // 막는 것은 그대로 두고(화면 역할이 실제로 쓸 수 있다), 확장을 extensions 스키마에 까는 길을 안내한다.
  it("RLS 가 꺼진 표가 있으면 막고, 확장이 public 에 만든 표일 때 고치는 길도 알려 준다", async () => {
    const { Client } = fakeDb({ unlocked: ["spatial_ref_sys"] });
    const error = await runDbVerification(Client).then(
      () => assert.fail("성공하면 안 된다"),
      (caught) => caught,
    );
    assert.match(error.message, /RLS가 꺼진 테이블: spatial_ref_sys/);
    assert.match(error.message, /create extension <이름> with schema extensions/);
  });

  it("PostgreSQL 15 미만에는 security_invoker 가 없어 뷰는 화면 역할 권한을 거두라고 안내한다 — 판정은 같다", async () => {
    const viewFixOf = async (version) => {
      const { Client } = fakeDb({
        version,
        bypasses: [bypassRow("z_view", "view", "anon", "SELECT")],
      });
      const error = await runDbVerification(Client).then(
        () => assert.fail("성공하면 안 된다"),
        (caught) => caught,
      );
      const lines = error.message.split("\n");
      assert.ok(
        lines.includes("  public.z_view 뷰 anon SELECT"),
        `${version}: 누출은 그대로 잡는다`,
      );
      return lines.filter((line) => line.startsWith("  뷰:"));
    };
    for (const version of [140012, 149999]) {
      const [fix, ...rest] = await viewFixOf(version);
      assert.deepEqual(rest, []);
      assert.match(fix, /revoke all on <뷰> from anon, authenticated, public;/);
      assert.doesNotMatch(fix, /alter view|security_invoker = true/);
    }
    const [fix] = await viewFixOf(150000);
    assert.match(fix, /alter view <뷰> set \(security_invoker = true\);/);
  });

  it("뷰·함수 쿼리가 실패하면 성공으로 숨기지 않고 연결을 닫는다", async () => {
    const { Client, log } = fakeDb({ fail: "prosecdef" });
    await assert.rejects(runDbVerification(Client), /query failed/);
    assert.ok(!log.queries.includes("commit"));
    assert.equal(log.ended, true);
  });

  it("권한 쿼리가 실패하면 성공으로 숨기지 않고 연결을 닫는다", async () => {
    const { Client, log } = fakeDb({ fail: "has_table_privilege" });
    await assert.rejects(runDbVerification(Client), /query failed/);
    assert.equal(log.ended, true);
  });

  it("접속에 실패해도 연결을 정리한다", async () => {
    const { Client, log } = fakeDb({ fail: "connect" });
    await assert.rejects(runDbVerification(Client), /connect refused/);
    assert.equal(log.ended, true);
  });
});

describe("findDangerousPrivileges 버전 분기", () => {
  it("PostgreSQL 17 이상에는 MAINTAIN 을 함께 묻는다", async () => {
    const { client, log } = fakeClient({ version: 170004 });
    assert.deepEqual(await findDangerousPrivileges(client), []);
    assert.match(privilegeQuery(log), /'MAINTAIN'/);
  });

  it("PostgreSQL 17 미만에는 MAINTAIN 을 보내지 않는다", async () => {
    const { client, log } = fakeClient({ version: 160004 });
    assert.deepEqual(await findDangerousPrivileges(client), []);
    assert.doesNotMatch(privilegeQuery(log), /MAINTAIN/);
    assert.match(privilegeQuery(log), /'TRUNCATE'/);
  });

  it("버전을 읽지 못하면 실패한다", async () => {
    const { client, log } = fakeClient({ version: null });
    await assert.rejects(findDangerousPrivileges(client), /버전/);
    assert.equal(privilegeQuery(log), undefined);
  });

  it("버전 쿼리가 실패하면 실패한다", async () => {
    const { client } = fakeClient({ fail: "server_version_num" });
    await assert.rejects(findDangerousPrivileges(client), /query failed/);
  });

  it("화면 역할이 없으면 실패한다 — 검사기를 따로 불러도 같다", async () => {
    for (const check of [findDangerousPrivileges, assertNoDangerousPrivileges]) {
      const { client, log } = fakeClient({ roles: ["anon"] });
      await assert.rejects(check(client), /화면 역할이 없습니다: authenticated/, check.name);
      assert.equal(privilegeQuery(log), undefined);
    }
  });
});

describe("findRlsBypasses", () => {
  it("허용 목록은 public.is_admin() 의 실행 권한만 건너뛴다 — 다른 인자·스키마와 search_path 는 남는다", async () => {
    const { client } = fakeClient({
      bypasses: [
        bypassRow("is_admin()", "function", "anon", "EXECUTE"),
        bypassRow("is_admin()", "function", "authenticated", "EXECUTE"),
        bypassRow("is_admin(uuid)", "function", "anon", "EXECUTE"),
        bypassRow("is_admin()", "function", "anon", "EXECUTE", "private"),
        bypassRow("is_admin()", "function", null, "search_path"),
      ],
    });
    assert.deepEqual(await findRlsBypasses(client), [
      { schema: "private", name: "is_admin()", kind: "function", role: "anon", problem: "EXECUTE" },
      {
        schema: "public",
        name: "is_admin()",
        kind: "function",
        role: null,
        problem: "search_path",
      },
      {
        schema: "public",
        name: "is_admin(uuid)",
        kind: "function",
        role: "anon",
        problem: "EXECUTE",
      },
    ]);
  });

  it("화면 역할이 없으면 뷰·함수 쿼리를 보내지 않고 실패한다 — 검사기를 따로 불러도 같다", async () => {
    for (const check of [findRlsBypasses, assertNoRlsBypasses]) {
      const { client, log } = fakeClient({ roles: ["authenticated"] });
      await assert.rejects(check(client), /화면 역할이 없습니다: anon/, check.name);
      assert.equal(bypassQuery(log), undefined);
    }
  });
});

describe("실패 안내(describeFailure)", () => {
  const SECRET = "synthetic-token-DO-NOT-PRINT";
  const saved = process.env.SUPABASE_DB_URL;
  beforeEach(() => {
    process.env.SUPABASE_DB_URL = SECRET_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = saved;
  });

  it("이 파일이 판정한 검증 실패는 진단을 그대로 보여 준다", async () => {
    const { Client } = fakeDb({
      privileges: [
        { table_schema: "public", table_name: "notes", role: "anon", privilege: "TRUNCATE" },
      ],
    });
    const error = await runDbVerification(Client).then(
      () => assert.fail("성공하면 안 된다"),
      (caught) => caught,
    );
    assert.ok(error instanceof DbVerifyError);
    const text = describeFailure(error);
    assert.match(text, /public\.notes anon TRUNCATE/);
    assert.match(text, /revoke all on/);
  });

  it("외부 오류는 message·detail·hint·cause 를 옮기지 않고 고정 안내만 보여 준다", () => {
    const error = Object.assign(new Error(`${SECRET} ${SECRET_URL}`), {
      detail: `row ${SECRET}`,
      hint: SECRET,
      cause: new Error(SECRET_URL),
    });
    const text = describeFailure(error);
    assert.match(text, /^DB 검증 실패: DB 접속 또는 조회 중 오류가 났습니다\./);
    assert.match(text, /SUPABASE_DB_URL/);
    assert.ok(!text.includes(SECRET) && !text.includes("very-secret-token"));
  });

  it("목록에 있는 오류 코드만 보여 주고, 모양만 맞는 코드는 버린다", () => {
    assert.match(
      describeFailure(Object.assign(new Error(SECRET), { code: "28P01" })),
      /코드 28P01/,
    );
    for (const code of ["ZZ9Q1", SECRET, 42501, undefined])
      assert.doesNotMatch(describeFailure(Object.assign(new Error(SECRET), { code })), /코드/);
  });

  it("Error 가 아닌 값을 던져도 고정 안내를 낸다", () => {
    assert.match(describeFailure(SECRET), /^DB 검증 실패: DB 접속 또는 조회 중/);
    assert.match(describeFailure(null), /^DB 검증 실패: DB 접속 또는 조회 중/);
    assert.ok(!describeFailure(SECRET).includes(SECRET));
  });

  it("외부 오류는 함수 밖으로 원래 오류 그대로 나간다(호출자 진단 유지)", async () => {
    const { Client } = fakeDb({ fail: "connect" });
    const error = await runDbVerification(Client).then(
      () => assert.fail("성공하면 안 된다"),
      (caught) => caught,
    );
    assert.ok(!(error instanceof DbVerifyError));
    assert.equal(error.message, "connect refused");
  });
});
