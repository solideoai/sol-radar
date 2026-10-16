// 문서의 SQL 시험(템플릿 전용) — 사람이 문서에서 베껴 칠 SQL 을 문서 그대로 PGlite 에 돌려 본다.
// 실행: 루트에서 `pnpm test`. 새 프로젝트(pnpm bootstrap)에는 복사하지 않는다 — 제품의 문서는 제품이 고쳐 쓴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { migratedDb, migrations, planOf, slowPolicies, users } from "../database-test-support.mjs";
import { describeFailure, verifyDatabase } from "../db-verify.mjs";
import { actAs } from "../supabase-pglite.mjs";

// 문서의 ```sql 블록 가운데 marker 를 담은 것 하나. 사람이 따라 칠 SQL 을 문서 그대로 시험한다.
const sqlBlockIn = (path, marker) => {
  const blocks = [
    ...readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").matchAll(
      /```sql\r?\n([\s\S]*?)```/g,
    ),
  ]
    .map((match) => match[1])
    .filter((sql) => sql.includes(marker));
  assert.equal(blocks.length, 1, `${path} 에 "${marker}" 를 담은 sql 블록이 하나 있어야 한다`);
  return blocks[0];
};

// 새 표는 database 스킬의 본보기를 그대로 베낀다. 본보기가 느리거나 새면 그 모양이 모든 표로 복제된다.
describe("database 스킬의 새 표 본보기", () => {
  it("그대로 적용하면 본인 행만 읽고 쓰고, user_id 인덱스가 있고, auth.uid() 를 질의마다 한 번 부르며, 배포 검증을 통과한다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(
      sqlBlockIn(".claude/skills/database/SKILL.md", "create table if not exists public.things"),
    );
    assert.deepEqual(await slowPolicies(fresh, "things"), []);
    // 정책이 거르는 열(user_id)로 시작하는 인덱스가 있다.
    assert.deepEqual(
      (
        await fresh.query(`
          select a.attname from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = 'public.things'::regclass and a.attname = 'user_id'`)
      ).rows,
      [{ attname: "user_id" }],
    );
    assert.equal((await verifyDatabase(fresh)).applied, migrations.length);

    await actAs(fresh, users[0]);
    await fresh.query("insert into public.things (user_id) values ($1)", [users[0]]);
    await assert.rejects(
      fresh.query("insert into public.things (user_id) values ($1)", [users[1]]),
      /row-level security/,
    );
    await actAs(fresh, users[1]);
    await fresh.query("insert into public.things (user_id) values ($1)", [users[1]]);
    assert.deepEqual((await fresh.query("select user_id from public.things")).rows, [
      { user_id: users[1] },
    ]);
    const plan = await planOf(fresh, "select id from public.things");
    assert.doesNotMatch(plan, /current_setting\(/, plan);
    await actAs(fresh, null, "anon");
    await assert.rejects(fresh.query("select id from public.things"), /permission denied/);
    await fresh.exec("reset role");
  });
});

// Vercel 의 환경 변수는 빌드와 함수 실행 양쪽에 들어간다. 그래서 운영 Vercel 에는 DDL 권한이 있는 연결 문자열 대신
// 배포 검사만 하는 역할의 것을 넣는다. 문서의 SQL 을 그대로 돌리고 그 역할로 바꿔 검증이 끝까지 도는지,
// 그 밖의 일은 못 하는지 본다.
describe("배포 검사 전용 읽기 전용 역할 — docs/first-deployment.md", () => {
  const verifierDb = async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(sqlBlockIn("docs/first-deployment.md", "create role deploy_verifier"));
    return fresh;
  };
  // runDbVerification 처럼 읽기 전용 트랜잭션 안에서 그 역할로 검증한다.
  const verifyAsVerifier = async (pglite) => {
    await pglite.exec("set role deploy_verifier");
    await pglite.exec("begin read only");
    try {
      return await verifyDatabase(pglite);
    } finally {
      await pglite.exec("rollback");
      await pglite.exec("reset role");
    }
  };

  it("문서의 SQL 로 만든 역할로 배포 검증이 끝까지 통과한다", async (t) => {
    const fresh = await verifierDb(t);
    assert.equal((await verifyAsVerifier(fresh)).applied, migrations.length);
  });

  it("문서가 주는 이력 표 권한 둘은 하나만 빠져도 검증이 권한 오류(코드 42501)로 실패한다", async (t) => {
    for (const revoke of [
      "revoke usage on schema supabase_migrations from deploy_verifier",
      "revoke select (version) on supabase_migrations.schema_migrations from deploy_verifier",
    ]) {
      const fresh = await verifierDb(t);
      await fresh.exec(revoke);
      await assert.rejects(
        verifyAsVerifier(fresh),
        (error) => {
          assert.match(error.message, /permission denied/, revoke);
          // 빌드 로그·pnpm db:verify 는 원문 대신 이 안내만 찍는다. 문서의 고장 안내가 이 코드를 가리킨다.
          assert.match(describeFailure(error), /코드 42501/, revoke);
          return true;
        },
        revoke,
      );
    }
  });

  it("그 역할은 로그인만 할 수 있고, 접속 기본값이 읽기 전용이며, 표를 읽거나 이력을 바꾸지 못한다", async (t) => {
    const fresh = await verifierDb(t);
    assert.deepEqual(
      (
        await fresh.query(
          "select rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls from pg_roles where rolname = 'deploy_verifier'",
        )
      ).rows,
      [
        {
          rolcanlogin: true,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
        },
      ],
    );
    assert.deepEqual(
      (
        await fresh.query(
          "select roleid::regrole::text as role from pg_auth_members where member = 'deploy_verifier'::regrole",
        )
      ).rows,
      [],
      "다른 역할의 권한을 물려받지 않는다",
    );
    assert.deepEqual(
      (
        await fresh.query(
          "select setconfig from pg_db_role_setting where setrole = 'deploy_verifier'::regrole",
        )
      ).rows,
      [{ setconfig: ["default_transaction_read_only=on"] }],
    );
    await fresh.exec("set role deploy_verifier");
    for (const sql of [
      "select id from public.profiles",
      "insert into supabase_migrations.schema_migrations (version) values ('99999999999999')",
      "delete from supabase_migrations.schema_migrations",
    ])
      await assert.rejects(fresh.query(sql), /permission denied/, sql);
    await fresh.exec("reset role");
  });
});
