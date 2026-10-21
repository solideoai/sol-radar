// 실제 PostgreSQL 엔진에서 마이그레이션·RLS·트리거를 실행한다.
// Supabase Auth 서비스 대신 JWT claim 함수·auth.users 계약만 준비한다(흉내는 supabase-pglite.mjs 한 곳에 있다).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_buffercache } from "@electric-sql/pglite/contrib/pg_buffercache";
import {
  freshDb,
  migratedDb,
  migrations,
  planOf,
  prepareLegacyPersonalOrgs,
  recordHistory,
  slowPolicies,
  users,
} from "./database-test-support.mjs";
import {
  assertNoDangerousPrivileges,
  findDangerousPrivileges,
  findRlsBypasses,
  verifyDatabase,
} from "./db-verify.mjs";
import { actAs, applyMigrations, createSupabaseDb, mimicSupabase } from "./supabase-pglite.mjs";

// 화면 역할이 무엇을 할 수 있는지를 정하는 카탈로그 상태. 같은 마이그레이션을 다시 돌려도 이것이 그대로여야 한다.
const accessSnapshot = async (pglite) => ({
  tables: (
    await pglite.query(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 1",
    )
  ).rows,
  grants: (
    await pglite.query(
      "select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3",
    )
  ).rows,
  // 열 단위 권한은 표 권한 목록에 나오지 않는다. 표의 revoke all 은 열 권한도 함께 거두므로 따로 본다.
  columnGrants: (
    await pglite.query(
      "select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3,4",
    )
  ).rows,
  policies: (
    await pglite.query(
      "select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by 1,2",
    )
  ).rows,
  triggers: (
    await pglite.query(
      "select tgname, pg_get_triggerdef(oid) as def from pg_trigger where not tgisinternal order by 1",
    )
  ).rows,
});

const db = await createSupabaseDb();
const asUser = (id, role) => actAs(db, id, role);

describe("마지막 업무 ADMIN 보호", () => {
  const orgId = "adc00000-0000-4000-8000-000000000001";
  const prepare = async (t, secondAdmin = false) => {
    const fresh = await migratedDb(t);
    await fresh.query(
      "insert into public.organizations (id,slug,name) values ($1,'admin-guard','관리자 보호')",
      [orgId],
    );
    // owner 보호와 업무 ADMIN 보호를 독립적으로 검증한다.
    for (const [index, role] of ["ADMIN", secondAdmin ? "ADMIN" : "VIEWER", "VIEWER"].entries()) {
      await fresh.query(
        "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,$3,$4)",
        [orgId, users[index], index === 2 ? "owner" : "member", role],
      );
    }
    await actAs(fresh, users[0]);
    return fresh;
  };
  const lastAdmin = (error) => error.code === "P0001" && error.hint === "last_admin";

  it("마지막 ADMIN은 자기 업무 역할을 내리지 못한다", async (t) => {
    const fresh = await prepare(t);
    await assert.rejects(
      fresh.query(
        "update public.memberships set sol_role='VIEWER' where org_id=$1 and user_id=$2",
        [orgId, users[0]],
      ),
      lastAdmin,
    );
    assert.equal(
      (
        await fresh.query(
          "select sol_role from public.memberships where org_id=$1 and user_id=$2",
          [orgId, users[0]],
        )
      ).rows[0].sol_role,
      "ADMIN",
    );
  });

  it("다른 멤버가 남는 조직의 마지막 ADMIN은 스스로 나가지 못한다", async (t) => {
    const fresh = await prepare(t);
    await assert.rejects(
      fresh.query("delete from public.memberships where org_id=$1 and user_id=$2", [
        orgId,
        users[0],
      ]),
      lastAdmin,
    );
  });

  for (const operation of ["update", "delete"]) {
    it(`ADMIN 둘을 한 문장으로 ${operation}해도 마지막 ADMIN을 없애지 못한다`, async (t) => {
      const fresh = await prepare(t, true);
      const sql =
        operation === "update"
          ? "update public.memberships set sol_role='VIEWER' where org_id=$1 and sol_role='ADMIN'"
          : "delete from public.memberships where org_id=$1 and sol_role='ADMIN'";
      await assert.rejects(fresh.query(sql, [orgId]), lastAdmin);
      assert.equal(
        (
          await fresh.query(
            "select count(*)::int n from public.memberships where org_id=$1 and sol_role='ADMIN'",
            [orgId],
          )
        ).rows[0].n,
        2,
      );
    });
  }

  it("다른 ADMIN이 있으면 자기 강등·탈퇴를 허용하고 남은 마지막 ADMIN은 보호한다", async (t) => {
    const fresh = await prepare(t, true);
    await fresh.query(
      "update public.memberships set sol_role='VIEWER' where org_id=$1 and user_id=$2",
      [orgId, users[0]],
    );
    await fresh.query("select public.delete_my_account()");
    await actAs(fresh, users[1]);
    await assert.rejects(
      fresh.query(
        "update public.memberships set sol_role='VIEWER' where org_id=$1 and user_id=$2",
        [orgId, users[1]],
      ),
      lastAdmin,
    );
  });

  it("계정 탈퇴가 JWT를 비우기 전에 마지막 ADMIN을 보호하고 계정·멤버십·JWT를 보존한다", async (t) => {
    const fresh = await prepare(t);
    await assert.rejects(fresh.query("select public.delete_my_account()"), lastAdmin);
    assert.equal((await fresh.query("select auth.uid() id")).rows[0].id, users[0]);
    assert.equal(
      (
        await fresh.query(
          "select count(*)::int n from public.memberships where org_id=$1 and user_id=$2",
          [orgId, users[0]],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await fresh.query("select count(*)::int n from public.profiles where id=$1", [users[0]]))
        .rows[0].n,
      1,
    );
  });

  it("다른 멤버에게 ADMIN을 넘기면 기존 ADMIN은 나갈 수 있다", async (t) => {
    const fresh = await prepare(t);
    await fresh.query(
      "update public.memberships set sol_role='ADMIN' where org_id=$1 and user_id=$2",
      [orgId, users[1]],
    );
    await fresh.query("delete from public.memberships where org_id=$1 and user_id=$2", [
      orgId,
      users[0],
    ]);
    await actAs(fresh, users[1]);
    assert.equal(
      (
        await fresh.query(
          "select count(*)::int n from public.memberships where org_id=$1 and sol_role='ADMIN'",
          [orgId],
        )
      ).rows[0].n,
      1,
    );
  });

  it("혼자인 조직은 계정 탈퇴와 함께 지울 수 있다", async (t) => {
    const fresh = await prepare(t);
    await fresh.exec("reset role");
    await fresh.query("select set_config('request.jwt.claims','',false)");
    await fresh.query("delete from public.memberships where org_id=$1 and user_id<>$2", [
      orgId,
      users[0],
    ]);
    await fresh.query("update public.memberships set org_role='owner' where org_id=$1", [orgId]);
    await actAs(fresh, users[0]);
    await fresh.query("select public.delete_my_account()");
    assert.equal(
      (await fresh.query("select count(*)::int n from public.organizations where id=$1", [orgId]))
        .rows[0].n,
      0,
    );
  });
});

// 흉내 DB 의 PostgreSQL 버전. maintain 권한은 17 부터 있다.
const pgVersion = (await db.query("select current_setting('server_version_num')::int as version"))
  .rows[0].version;
const TABLE_DANGERS =
  pgVersion >= 170000 ? ["MAINTAIN", "TRUNCATE", "TRIGGER"] : ["TRUNCATE", "TRIGGER"];
const ALL_DANGERS = [...TABLE_DANGERS, "REFERENCES"].sort();
const finding = (table, role, privilege) => ({ schema: "public", table, role, privilege });

// 뷰·함수 검사기(findRlsBypasses)의 결과 한 줄. search_path 미고정은 역할과 상관없어 role 이 null 이다.
const bypass = (name, kind, role, problem) => ({ schema: "public", name, kind, role, problem });
// 역할마다 problems 를 검사기의 정렬 순서로 늘어놓는다.
const opened = (name, kind, problems, roles = ["anon", "authenticated"]) =>
  roles.flatMap((role) => problems.map((problem) => bypass(name, kind, role, problem)));
// 기본 권한(all)을 그대로 둔 뷰·외부 표가 화면 역할에 여는 읽기·쓰기(이름순).
const READ_WRITE = ["DELETE", "INSERT", "SELECT", "UPDATE"];

// 위험 권한 시험용 새 표. RLS 를 켜고 흉내 DB 가 준 기본 권한(all)을 전부 거둔 깨끗한 상태로 시작한다.
const lockedTable = async (pglite, name) => {
  await pglite.exec(`
    create table public.${name} (id int primary key, body text);
    alter table public.${name} enable row level security;
    revoke all on public.${name} from anon, authenticated, public;
  `);
};

before(async () => {
  await applyMigrations(db, migrations);
  for (const [i, id] of users.entries())
    await db.query("insert into auth.users values ($1, $2)", [id, `user${i}@example.invalid`]);
  await db.query("update public.profiles set is_admin = true where id = $1", [users[2]]);
});
after(async () => {
  await db.close();
});

describe("DB 접근 정책", () => {
  it("public의 모든 일반 테이블에 RLS가 켜져 있다", async () => {
    const { rows } = await db.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity",
    );
    assert.deepEqual(rows, []);
  });
  it("로그아웃한 사용자는 프로필을 읽지도 만들지도 못한다", async () => {
    await asUser(null, "anon");
    assert.deepEqual((await db.query("select * from public.profiles")).rows, []);
    await assert.rejects(
      db.query("insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000009')"),
      /permission denied|row-level security/,
    );
  });
  it("로그인한 사용자는 본인 프로필만 읽고 남의 행을 수정하지 못한다", async () => {
    await asUser(users[0]);
    assert.deepEqual((await db.query("select id from public.profiles")).rows, [{ id: users[0] }]);
    await assert.rejects(
      db.query("update public.profiles set email='changed' where id=$1", [users[1]]),
      /permission denied/,
    );
  });
  it("본인 프로필의 email 과 is_admin 도 바꾸지 못한다", async () => {
    await asUser(users[0]);
    // email 을 남의 것으로 바꿀 수 있으면, 이메일로 운영자를 지정할 때 공격자 행도 같이 승격된다.
    await assert.rejects(
      db.query("update public.profiles set email='user2@example.invalid' where id=$1", [users[0]]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.profiles set is_admin=true where id=$1", [users[0]]),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select email, is_admin from public.profiles where id=$1", [users[0]])).rows,
      [{ email: "user0@example.invalid", is_admin: false }],
    );
  });
  it("본인 프로필의 표시 이름은 고치고, 남의 것은 운영자도 고치지 못한다", async () => {
    const rename = (id, name) =>
      db.query("update public.profiles set display_name=$2 where id=$1 returning id", [id, name]);
    await asUser(users[0]);
    assert.deepEqual((await rename(users[0], "첫째")).rows, [{ id: users[0] }]);
    // 남의 행은 정책이 걸러 고칠 행이 없다(오류가 아니라 0행이다).
    assert.deepEqual((await rename(users[1], "남의 이름")).rows, []);
    await asUser(users[2]);
    assert.deepEqual((await rename(users[0], "운영자가 바꿈")).rows, []);
    await asUser(null, "anon");
    await assert.rejects(rename(users[0], "익명"), /permission denied/);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select id, display_name from public.profiles order by id")).rows,
      [
        { id: users[0], display_name: "첫째" },
        { id: users[1], display_name: null },
        { id: users[2], display_name: null },
      ],
    );
  });
  it("표시 이름은 앞뒤 공백 없이 1~40자다 — 서버 검증을 건너뛴 요청도 DB 가 막는다", async () => {
    await asUser(users[0]);
    for (const name of ["", "   ", " 앞 공백", "뒤 공백 ", "가".repeat(41)])
      await assert.rejects(
        db.query("update public.profiles set display_name=$2 where id=$1", [users[0], name]),
        /profiles_display_name_check/,
        JSON.stringify(name),
      );
    await db.query("update public.profiles set display_name=$2 where id=$1", [
      users[0],
      "가".repeat(40),
    ]);
    await db.exec("reset role");
  });
  it("화면 역할의 profiles 표 권한은 읽기(SELECT)뿐이고, 열 권한은 이름·신고 FK 수정뿐이다 — RLS 를 무시하는 TRUNCATE 도 없다", async () => {
    await db.exec("reset role");
    // 흉내 DB 는 Supabase 처럼 새 표에 권한을 전부 준다. 마이그레이션이 하나라도 남기면 여기 보인다.
    assert.deepEqual(
      (
        await db.query(
          "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated') order by 1,2",
        )
      ).rows,
      [
        { grantee: "anon", privilege_type: "SELECT" },
        { grantee: "authenticated", privilege_type: "SELECT" },
      ],
    );
    // 열 단위 권한은 표 권한 목록에 나오지 않는다. 표 권한(SELECT)이 모든 열에 비치는 것은 뺀다.
    assert.deepEqual(
      (
        await db.query(
          "select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT' order by 1,2,3",
        )
      ).rows,
      ["declared_department_id", "declared_job_title_id", "display_name"].map((column_name) => ({
        grantee: "authenticated",
        column_name,
        privilege_type: "UPDATE",
      })),
    );
    await asUser(users[0]);
    await assert.rejects(db.query("truncate public.profiles"), /permission denied/);
    await db.exec("reset role");
    assert.equal((await db.query("select id from public.profiles")).rows.length, 3);
  });
  it("가입 이메일이 바뀌면 프로필 email 도 따라간다", async () => {
    await db.exec("reset role");
    await db.query("update auth.users set email='renamed@example.invalid' where id=$1", [users[1]]);
    assert.deepEqual(
      (await db.query("select email from public.profiles where id=$1", [users[1]])).rows,
      [{ email: "renamed@example.invalid" }],
    );
  });
  it("운영자는 전체 프로필을 조회할 수 있다", async () => {
    await asUser(users[2]);
    assert.equal((await db.query("select id from public.profiles")).rows.length, 3);
  });

  // 작업 시험은 앞에서 뒤로 이어진다. 같은 DB 를 같이 쓰므로 각 시험이 시작할 때 seedTasks 로 상태를 새로 깐다.
  // 기본 장면: user0·user1 의 개인 조직에 작업이 하나씩 있다. user2 는 운영자다.
  //
  // JWT 가 없는 관리 작업. reset role 만 하면 앞 요청의 JWT 가 남아 created_by·actor_id 의 기본값이 그 사람이 된다.
  const asAdminTool = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  };
  // 관리 작업으로 읽으므로 정책을 거치지 않는다.
  const personalOrgOf = async (id) =>
    (await db.query("select id from public.organizations where personal_owner_id = $1", [id]))
      .rows[0].id;
  const seedTasks = async () => {
    await asAdminTool();
    await prepareLegacyPersonalOrgs(db, users.slice(0, 2));
    // 작업을 지우면 트리거가 '지움' 활동을 남기므로 활동은 그 뒤에 지운다.
    await db.query("delete from public.tasks");
    await db.query("delete from public.activities");
    await db.query(
      `insert into public.tasks (org_id, created_by, title)
       select o.id, o.personal_owner_id, case o.personal_owner_id when $1 then '첫째 것' else '둘째 것' end
       from public.organizations o where o.personal_owner_id in ($1, $2)`,
      [users[0], users[1]],
    );
  };
  const visibleTo = async (id, role = "authenticated") => {
    await asUser(id, role);
    const { rows } = await db.query(
      `select
         (select coalesce(json_agg(title order by title), '[]') from public.tasks) as tasks,
         (select count(*)::int from public.activities) as activities`,
    );
    await asAdminTool();
    return rows[0];
  };

  it("메모 견본은 지워졌다 — memos 표와 그 기본값 함수 personal_org_id() 가 없다", async () => {
    await asAdminTool();
    assert.deepEqual(
      (
        await db.query(
          "select to_regclass('public.memos') as memos, to_regprocedure('public.personal_org_id()') as fn",
        )
      ).rows,
      [{ memos: null, fn: null }],
    );
  });
  it("로그인한 사용자는 자기 조직의 작업·활동만 읽는다 — 운영자도 남의 조직 것은 못 읽는다", async () => {
    await seedTasks();
    // 시드가 넣은 작업마다 '만듦' 활동이 그 조직에 하나씩 남았다.
    assert.deepEqual(await visibleTo(users[0]), { tasks: ["첫째 것"], activities: 1 });
    assert.deepEqual(await visibleTo(users[1]), { tasks: ["둘째 것"], activities: 1 });
    // 운영자 읽기 정책은 profiles 에만 있다. tasks·activities 에는 운영자 정책이 없다.
    assert.deepEqual(await visibleTo(users[2]), { tasks: [], activities: 0 });
  });
  it("작업을 넣으면 만든 사람은 DB 가 로그인한 사람으로 채우고, 남의 조직이나 남의 이름으로는 넣지 못한다", async () => {
    await seedTasks();
    const mine = await personalOrgOf(users[0]);
    const theirs = await personalOrgOf(users[1]);
    await asUser(users[0]);
    await db.query("insert into public.tasks (org_id, title) values ($1, '새 작업')", [mine]);
    await assert.rejects(
      db.query("insert into public.tasks (org_id, title) values ($1, '남의 조직에')", [theirs]),
      /row-level security/,
    );
    // 만든 사람 열에는 화면 역할의 쓰기 권한이 없다.
    await assert.rejects(
      db.query(
        "insert into public.tasks (org_id, title, created_by) values ($1, '남의 이름으로', $2)",
        [mine, users[1]],
      ),
      /permission denied/,
    );
    await asAdminTool();
    assert.deepEqual(
      (
        await db.query(
          'select org_id, created_by, title from public.tasks order by title collate "C"',
        )
      ).rows,
      [
        { org_id: theirs, created_by: users[1], title: "둘째 것" },
        { org_id: mine, created_by: users[0], title: "새 작업" },
        { org_id: mine, created_by: users[0], title: "첫째 것" },
      ],
    );
  });
  it("남의 작업은 지워지지 않고(오류가 아니라 0행) 본인 것은 지워진다", async () => {
    await seedTasks();
    const remove = (title) =>
      db.query("delete from public.tasks where title=$1 returning title", [title]);
    await asUser(users[0]);
    assert.deepEqual((await remove("둘째 것")).rows, []);
    await asUser(users[2]);
    assert.deepEqual((await remove("둘째 것")).rows, []);
    await asUser(users[0]);
    assert.deepEqual((await remove("첫째 것")).rows, [{ title: "첫째 것" }]);
    await asAdminTool();
    assert.deepEqual((await db.query("select created_by, title from public.tasks")).rows, [
      { created_by: users[1], title: "둘째 것" },
    ]);
  });
  it("로그아웃한 사용자는 작업·활동을 읽지도 쓰지도 못하고 대시보드 집계도 부르지 못한다 — 모두 권한 오류다", async () => {
    await seedTasks();
    const org = await personalOrgOf(users[0]);
    await asUser(null, "anon");
    for (const [sql, params] of [
      ["select * from public.tasks", []],
      ["select * from public.activities", []],
      ["insert into public.tasks (org_id, title) values ($1, '익명')", [org]],
      ["update public.tasks set title = '익명'", []],
      ["delete from public.tasks", []],
      ["select * from public.task_dashboard_stats($1)", [org]],
    ])
      await assert.rejects(db.query(sql, params), /permission denied/, sql);
    await asAdminTool();
    assert.equal((await db.query("select id from public.tasks")).rows.length, 2);
  });
  it("작업 제목은 앞뒤 공백 없이 1~120자, 설명은 비우거나(null) 1~2000자, 상태는 셋 중 하나다 — 서버 검증을 건너뛴 요청도 DB 가 막는다", async () => {
    await seedTasks();
    const org = await personalOrgOf(users[0]);
    await asUser(users[0]);
    const add = (title, description = null, status = "todo") =>
      db.query(
        "insert into public.tasks (org_id, title, description, status) values ($1, $2, $3, $4)",
        [org, title, description, status],
      );
    for (const title of ["", "   ", " 앞 공백", "뒤 공백 ", "가".repeat(121)])
      await assert.rejects(add(title), /tasks_title_check/, JSON.stringify(title));
    for (const description of ["", "가".repeat(2001)])
      await assert.rejects(
        add("제목", description),
        /tasks_description_check/,
        JSON.stringify(description),
      );
    for (const status of ["", "archived", "DONE"])
      await assert.rejects(add("제목", null, status), /tasks_status_check/, status);
    await add("가".repeat(120), "가".repeat(2000), "in_progress");
    await add("설명 없음");
    await asAdminTool();
  });
  it("화면 역할의 tasks 권한은 로그인 역할의 읽기·지우기와 열 단위 넣기·고치기뿐이고, activities 는 읽기뿐이다 — 활동을 직접 넣거나 고치거나 지우지 못한다", async () => {
    await seedTasks();
    // 흉내 DB 는 Supabase 처럼 새 표에 권한을 전부 준다. 마이그레이션이 하나라도 남기면 여기 보인다.
    assert.deepEqual(
      (
        await db.query(
          "select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('tasks','activities') and grantee in ('anon','authenticated') order by 1,2,3",
        )
      ).rows,
      [
        { table_name: "activities", grantee: "authenticated", privilege_type: "SELECT" },
        { table_name: "tasks", grantee: "authenticated", privilege_type: "DELETE" },
        { table_name: "tasks", grantee: "authenticated", privilege_type: "SELECT" },
      ],
    );
    // 열 단위 권한. 표 권한(SELECT)이 모든 열에 비치는 것은 뺀다. 만든 사람·완료 시각·만든 시각은 DB 가 채운다.
    assert.deepEqual(
      (
        await db.query(
          "select table_name, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name in ('tasks','activities') and grantee in ('anon','authenticated') and privilege_type <> 'SELECT' order by 1,2,3",
        )
      ).rows,
      [
        ["assignee_id", "INSERT"],
        ["assignee_id", "UPDATE"],
        ["description", "INSERT"],
        ["description", "UPDATE"],
        ["due_date", "INSERT"],
        ["due_date", "UPDATE"],
        ["org_id", "INSERT"],
        ["status", "INSERT"],
        ["status", "UPDATE"],
        ["title", "INSERT"],
        ["title", "UPDATE"],
      ].map(([column_name, privilege_type]) => ({
        table_name: "tasks",
        column_name,
        privilege_type,
      })),
    );
    const org = await personalOrgOf(users[0]);
    await asUser(users[0]);
    // 작업을 다른 조직으로 옮기거나, 만든 사람·시각을 바꾸지 못한다.
    for (const column of ["org_id", "created_by", "completed_at", "created_at", "updated_at"])
      await assert.rejects(
        db.query(`update public.tasks set ${column} = ${column}`),
        /permission denied/,
        column,
      );
    // 활동은 트리거만 쓴다. 자기 조직의 기록이라도 화면 역할은 넣지도 고치지도 지우지도 못한다.
    for (const [sql, params] of [
      [
        "insert into public.activities (org_id, kind, task_title) values ($1, 'task_created', '가짜 기록')",
        [org],
      ],
      ["update public.activities set task_title = '고침'", []],
      ["delete from public.activities", []],
      ["truncate public.activities", []],
      ["truncate public.tasks", []],
    ])
      await assert.rejects(db.query(sql, params), /permission denied/, sql);
    await asAdminTool();
    assert.deepEqual(
      (await db.query("select kind, task_title from public.activities order by task_title")).rows,
      [
        { kind: "task_created", task_title: "둘째 것" },
        { kind: "task_created", task_title: "첫째 것" },
      ],
    );
    assert.equal((await db.query("select id from public.tasks")).rows.length, 2);
  });
  it("대시보드 집계 함수는 부른 사람의 권한으로 돌고(security invoker) 로그인 역할만 부르며, 활동의 이름 사본 함수는 어느 화면 역할도 부르지 못한다", async () => {
    await asAdminTool();
    assert.deepEqual(
      (
        await db.query(
          `select p.proname, p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('activity_name_of', 'task_dashboard_stats')
           order by 1`,
        )
      ).rows,
      [
        { proname: "activity_name_of", prosecdef: false, anon: false, authenticated: false },
        { proname: "task_dashboard_stats", prosecdef: false, anon: false, authenticated: true },
      ],
    );
    // 부를 수 있으면 아무 사람의 이름이나 읽는다. 트리거만 부른다.
    await asUser(users[0]);
    await assert.rejects(
      db.query("select public.activity_name_of($1)", [users[1]]),
      /permission denied for function activity_name_of/,
    );
    await asAdminTool();
  });
});

// 조직 시험은 시험마다 새 DB 를 쓴다(위의 공유 DB 는 가입자 수·행 수를 세는 시험이 있어 건드리지 않는다).
// 기본 장면: user0 이 팀 acme 를 만들어 owner 이고, user1 은 초대를 받아 member 가 됐다. user2 는 밖의 사람이고 운영자다.
describe("조직·멤버십·초대 정책", () => {
  const emailOf = (i) => `user${i}@example.invalid`;
  // 로그인 이메일(JWT 의 email 클레임)까지 실은 요청. 초대 정책이 이 값을 읽는다.
  const as = (pglite, i) => actAs(pglite, users[i], "authenticated", emailOf(i));
  // JWT 가 없는 관리 작업(SQL 편집기·마이그레이션·계정 삭제)
  const asAdminTool = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', '', false)");
  };
  const rowsOf = async (pglite, sql, params = []) => (await pglite.query(sql, params)).rows;
  // 20261019000008(ADR-026): 팀은 서비스 운영자(profiles.is_admin)만 만든다. 팀을 만드는 동안만 그 사람을 운영자로
  // 올렸다가 내린다 — 만든 사람은 add_team_owner 로 owner+ADMIN 이 되고, 그 뒤의 시험은 그 사람을
  // "운영자가 아닌 팀 owner" 로 본다(운영자 장면은 user2 가 맡는다).
  const createTeamAs = async (pglite, i, slug, name) => {
    await asAdminTool(pglite);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [users[i]]);
    await as(pglite, i);
    await pglite.query("insert into public.organizations (slug, name) values ($1, $2)", [
      slug,
      name,
    ]);
    await asAdminTool(pglite);
    await pglite.query("update public.profiles set is_admin = false where id = $1", [users[i]]);
  };
  const teamDb = async (t) => {
    const pglite = await migratedDb(t);
    await prepareLegacyPersonalOrgs(pglite, users);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [users[2]]);
    await createTeamAs(pglite, 0, "acme", "에이크미");
    await as(pglite, 0);
    await pglite.query(
      "insert into public.invitations (org_id, email) select id, $1 from public.organizations where slug = 'acme'",
      [emailOf(1)],
    );
    await as(pglite, 1);
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role) select id, $1, 'member' from public.organizations where slug = 'acme'",
      [users[1]],
    );
    await asAdminTool(pglite);
    const [{ id: acme }] = await rowsOf(
      pglite,
      "select id from public.organizations where slug = 'acme'",
    );
    const personal = Object.fromEntries(
      (
        await rowsOf(
          pglite,
          "select personal_owner_id, id from public.organizations where personal_owner_id is not null",
        )
      ).map((row) => [row.personal_owner_id, row.id]),
    );
    return { pglite, acme, personal };
  };
  const membersOf = (pglite, org) =>
    rowsOf(
      pglite,
      "select user_id, org_role from public.memberships where org_id = $1 order by user_id",
      [org],
    );
  // 활동 기록은 순서를 보지 않고 견준다. PGlite 의 시계는 밀리초 단위라 잇따른 두 문장의 created_at 이 같을 수 있다.
  // 그래서 읽은 기록과 기대값(log)을 같은 기준(열 값)으로 줄 세운다. 기대값은 일어난 순서로 적는다.
  const ACTIVITY_COLUMNS = [
    "kind",
    "actor_id",
    "task_title",
    "target_user_id",
    "target_name",
    "old_role",
    "new_role",
  ];
  const keyOf = (row) => JSON.stringify(ACTIVITY_COLUMNS.map((column) => row[column]));
  const log = (rows) => rows.toSorted((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
  const activitiesOf = async (pglite, org) =>
    log(
      await rowsOf(
        pglite,
        `select ${ACTIVITY_COLUMNS.join(", ")} from public.activities where org_id = $1`,
        [org],
      ),
    );
  // 활동 한 줄의 기대값. 적지 않은 열은 비어 있다(null).
  const activity = (kind, actor, fields = {}) => ({
    kind,
    actor_id: actor,
    task_title: null,
    target_user_id: null,
    target_name: null,
    old_role: null,
    new_role: null,
    ...fields,
  });
  // teamDb 가 남긴 acme 의 기록: owner 가 user1 을 초대했고 user1 이 수락했다. 팀을 만든 owner 의 첫 멤버십은 남지 않는다.
  // 이름 사본은 표시 이름, 없으면 이메일 @ 앞이다.
  const TEAM_LOG = [
    activity("invitation_sent", users[0], { new_role: "member" }),
    activity("member_joined", users[1], { target_user_id: users[1], target_name: "user1" }),
  ];
  // 지금 역할로 작업 하나를 넣고 id 를 돌려준다. fields 는 열 이름 그대로다(description·status·due_date·assignee_id).
  const addTask = async (pglite, org, title, fields = {}) => {
    const columns = ["org_id", "title", ...Object.keys(fields)];
    const values = [org, title, ...Object.values(fields)];
    const [{ id }] = await rowsOf(
      pglite,
      `insert into public.tasks (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      values,
    );
    return id;
  };
  const taskOf = async (pglite, id) =>
    (
      await rowsOf(
        pglite,
        "select org_id, title, status, assignee_id, created_by, completed_at, updated_at from public.tasks where id = $1",
        [id],
      )
    )[0];

  it("새 가입은 프로필만 만들고 조직·멤버십은 만들지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    assert.deepEqual(
      await rowsOf(pglite, "select id from public.profiles order by id"),
      users.map((id) => ({ id })),
    );
    assert.deepEqual(await rowsOf(pglite, "select id from public.organizations"), []);
    assert.deepEqual(await rowsOf(pglite, "select * from public.memberships"), []);
  });

  it("팀을 만든 사람은 owner 가 되고, 개인 조직의 주인은 화면에서 지정하지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    assert.deepEqual(await membersOf(pglite, acme), [
      { user_id: users[0], org_role: "owner" },
      { user_id: users[1], org_role: "member" },
    ]);
    await as(pglite, 2);
    await assert.rejects(
      pglite.query(
        "insert into public.organizations (slug, name, personal_owner_id) values ('mine', '내 것', $1)",
        [users[2]],
      ),
      /permission denied/,
    );
    await asAdminTool(pglite);
  });

  // 20261019000008(ADR-026): 팀 만들기는 운영자만. 열 권한(slug·name)·add_team_owner·개인 조직 금지는 그대로다.
  it("팀은 운영자(profiles.is_admin)만 만든다 — 팀의 owner+ADMIN·member·조직 없는 가입자의 넣기는 정책 오류(42501)이고 행이 남지 않으며, 운영자는 만들고 add_team_owner 로 owner+ADMIN 이 된다", async (t) => {
    const { pglite } = await teamDb(t);
    const newcomer = "00000000-0000-0000-0000-000000000009";
    await pglite.query("insert into auth.users values ($1, 'newcomer@example.invalid')", [
      newcomer,
    ]);
    const create = (slug) =>
      pglite.query("insert into public.organizations (slug, name) values ($1, '새 팀')", [slug]);
    // user0 은 acme 의 owner+ADMIN, user1 은 member, newcomer 는 어느 조직에도 없다 — 셋 다 운영자가 아니다.
    for (const [id, slug] of [
      [users[0], "by-owner"],
      [users[1], "by-member"],
      [newcomer, "by-newcomer"],
    ]) {
      await actAs(pglite, id, "authenticated", "x@example.invalid");
      await assert.rejects(create(slug), { code: "42501" }, slug);
      await assert.rejects(create(slug), /row-level security/, slug);
    }
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select slug from public.organizations where slug in ('by-owner', 'by-member', 'by-newcomer')",
      ),
      [],
    );
    assert.deepEqual(
      await rowsOf(pglite, "select user_id from public.memberships where user_id = $1", [newcomer]),
      [],
    );
    // 운영자(user2, active)는 만들고 첫 멤버십으로 owner+ADMIN 이 된다. 운영자도 개인 조직 주인 열은 못 쓴다(열 권한).
    await as(pglite, 2);
    await create("by-operator");
    await assert.rejects(
      pglite.query(
        "insert into public.organizations (slug, name, personal_owner_id) values ('by-operator-personal', '개인', $1)",
        [users[2]],
      ),
      /permission denied for table organizations/,
    );
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select m.user_id, m.org_role, m.sol_role from public.memberships m join public.organizations o on o.id = m.org_id where o.slug = 'by-operator'",
      ),
      [{ user_id: users[2], org_role: "owner", sol_role: "ADMIN" }],
    );
  });

  it("정지된 운영자는 팀을 만들지 못한다 — is_admin() 이 false 라 정책 오류(42501)이고 행이 남지 않으며, 정지를 풀면 다시 만든다", async (t) => {
    const { pglite } = await teamDb(t);
    const create = (slug) =>
      pglite.query("insert into public.organizations (slug, name) values ($1, '새 팀')", [slug]);
    await pglite.query("update public.profiles set status = 'suspended' where id = $1", [users[2]]);
    await as(pglite, 2);
    await assert.rejects(create("while-suspended"), { code: "42501" });
    await assert.rejects(create("while-suspended"), /row-level security/);
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(pglite, "select slug from public.organizations where slug = 'while-suspended'"),
      [],
    );
    await pglite.query("update public.profiles set status = 'active' where id = $1", [users[2]]);
    await as(pglite, 2);
    await create("after-restore");
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select m.org_role, m.sol_role from public.memberships m join public.organizations o on o.id = m.org_id where o.slug = 'after-restore'",
      ),
      [{ org_role: "owner", sol_role: "ADMIN" }],
    );
  });

  it("주소 이름은 소문자·숫자·하이픈 3~32자이고, 최상위 경로 이름과 이미 쓰는 이름은 못 쓴다", async (t) => {
    const { pglite } = await teamDb(t);
    await as(pglite, 2);
    const create = (slug) =>
      pglite.query("insert into public.organizations (slug, name) values ($1, '팀')", [slug]);
    for (const slug of [
      "ab",
      "Acme",
      "acme_1",
      "에이크미",
      "a".repeat(33),
      // 최상위 경로 이름 전부. 웹(RESERVED_SLUGS)이 먼저 막지만, 하나라도 빠지면 그 화면을 못 연다.
      "account",
      "admin",
      "api",
      "auth",
      "dashboard",
      "invitations",
      "memos",
      "settings",
      "teams",
    ])
      await assert.rejects(create(slug), /organizations_slug_check/, slug);
    await assert.rejects(create("acme"), /organizations_slug_key/);
    await create("a-1");
    await create("z".repeat(32));
    await asAdminTool(pglite);
  });

  it("조직 밖의 사람은 운영자라도 그 조직의 조직·멤버십·초대·작업·활동을 읽지 못하고, 멤버는 읽는다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await pglite.query(
      "insert into public.invitations (org_id, email, invited_by) values ($1, 'later@example.invalid', $2)",
      [acme, users[0]],
    );
    await pglite.query(
      "insert into public.tasks (org_id, title, created_by) values ($1, '팀 작업', $2)",
      [acme, users[0]],
    );
    const visible = async (i) => {
      await as(pglite, i);
      const counts = await rowsOf(
        pglite,
        `select
           (select count(*)::int from public.organizations where id = $1) as orgs,
           (select count(*)::int from public.memberships where org_id = $1) as members,
           (select count(*)::int from public.invitations where org_id = $1) as invitations,
           (select count(*)::int from public.tasks where org_id = $1) as tasks,
           (select count(*)::int from public.activities where org_id = $1) as activities`,
        [acme],
      );
      await asAdminTool(pglite);
      return counts[0];
    };
    // 초대 목록은 owner 만 본다. 활동은 초대 보냄 둘·들어옴·작업 만듦의 네 줄이다.
    const team = { orgs: 1, members: 2, tasks: 1, activities: 4 };
    assert.deepEqual(await visible(0), { ...team, invitations: 1 });
    assert.deepEqual(await visible(1), { ...team, invitations: 0 });
    assert.deepEqual(await visible(2), {
      orgs: 0,
      members: 0,
      invitations: 0,
      tasks: 0,
      activities: 0,
    });
  });

  it("조직 밖의 사람은 운영자라도 그 조직의 조직·멤버십·초대·작업·활동을 쓰지 못한다 — 넣기는 정책 오류, 바꾸기·지우기는 0행, 활동은 권한 오류다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await pglite.query(
      "insert into public.invitations (org_id, email, invited_by) values ($1, 'later@example.invalid', $2)",
      [acme, users[0]],
    );
    await pglite.query(
      "insert into public.tasks (org_id, title, created_by, assignee_id) values ($1, '팀 작업', $2, $3)",
      [acme, users[0], users[1]],
    );
    // 만료 시각까지 본다: 초대 갱신이 새면 트리거가 만료를 다시 적는다.
    const stateOf = async () =>
      (
        await rowsOf(
          pglite,
          `select
             (select json_agg(json_build_object('slug', slug, 'name', name)) from public.organizations where id = $1) as orgs,
             (select json_agg(json_build_object('user_id', user_id, 'org_role', org_role) order by user_id) from public.memberships where org_id = $1) as members,
             (select json_agg(json_build_object('email', email, 'org_role', org_role, 'expires_at', expires_at) order by email) from public.invitations where org_id = $1) as invitations,
             (select json_agg(json_build_object('title', title, 'status', status, 'assignee_id', assignee_id, 'updated_at', updated_at) order by title) from public.tasks where org_id = $1) as tasks,
             (select json_agg(json_build_object('kind', kind, 'task_title', task_title) order by created_at, kind) from public.activities where org_id = $1) as activities`,
          [acme],
        )
      )[0];
    const before = await stateOf();
    // user2 는 acme 밖의 사람이고 운영자다.
    await as(pglite, 2);
    const changedRows = async (sql) => (await pglite.query(sql, [acme])).rows.length;
    await assert.rejects(
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
        [acme, users[2]],
      ),
      /row-level security/,
    );
    assert.equal(
      await changedRows(
        "update public.memberships set org_role = 'member' where org_id = $1 returning user_id",
      ),
      0,
    );
    assert.equal(
      await changedRows("delete from public.memberships where org_id = $1 returning user_id"),
      0,
    );
    await assert.rejects(
      pglite.query(
        "insert into public.invitations (org_id, email) values ($1, 'friend@example.invalid')",
        [acme],
      ),
      /row-level security/,
    );
    assert.equal(
      await changedRows(
        "update public.invitations set org_role = 'owner' where org_id = $1 returning email",
      ),
      0,
    );
    assert.equal(
      await changedRows("delete from public.invitations where org_id = $1 returning email"),
      0,
    );
    // 담당자를 실어 넣어 봐도 외래 키보다 정책이 먼저 거절한다 — 누가 그 조직의 멤버인지 알려 주지 않는다.
    for (const assignee of [null, users[1], users[2]])
      await assert.rejects(
        pglite.query(
          "insert into public.tasks (org_id, title, assignee_id) values ($1, '밖에서 씀', $2)",
          [acme, assignee],
        ),
        /row-level security/,
        String(assignee),
      );
    assert.equal(
      await changedRows(
        "update public.tasks set title = '빼앗음', status = 'done', assignee_id = null where org_id = $1 returning id",
      ),
      0,
    );
    assert.equal(await changedRows("delete from public.tasks where org_id = $1 returning id"), 0);
    // WHERE·RETURNING 없이 값만 적는 고치기·지우기는 읽기 정책을 거치지 않는다. 고치기·지우기 정책이 따로 막아야 한다.
    await pglite.query("update public.tasks set title = '빼앗음'");
    await pglite.query("delete from public.tasks");
    // 활동에는 화면 역할의 쓰기 권한이 없다.
    await assert.rejects(
      pglite.query(
        "insert into public.activities (org_id, kind, task_title) values ($1, 'task_created', '가짜 기록')",
        [acme],
      ),
      /permission denied/,
    );
    await assert.rejects(
      pglite.query("delete from public.activities where org_id = $1", [acme]),
      /permission denied/,
    );
    // 조직 이름 바꾸기·지우기는 팀 owner 만 한다(20261015000002). 조직 밖의 운영자의 시도는 0행이다.
    assert.equal(
      await changedRows(
        "update public.organizations set name = '빼앗음' where id = $1 returning id",
      ),
      0,
    );
    assert.equal(
      await changedRows("delete from public.organizations where id = $1 returning id"),
      0,
    );
    await asAdminTool(pglite);
    assert.deepEqual(await stateOf(), before);
  });

  it("로그아웃한 사람은 조직 표를 읽지도 쓰지도 못한다 — 모두 권한 오류다", async (t) => {
    const { pglite } = await teamDb(t);
    await actAs(pglite, null, "anon");
    for (const table of ["organizations", "memberships", "invitations"])
      await assert.rejects(
        pglite.query(`select * from public.${table}`),
        /permission denied/,
        table,
      );
    await assert.rejects(
      pglite.query("insert into public.organizations (slug, name) values ('anon-team', '익명')"),
      /permission denied/,
    );
    await asAdminTool(pglite);
  });

  it("멤버는 조직의 작업을 읽고 추가하고, 남이 만든 작업의 제목·설명·상태·마감일·담당자를 고친다 — 남의 조직에는 넣지 못한다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await as(pglite, 0);
    const ownerTask = await addTask(pglite, acme, "owner 가 만듦");
    await as(pglite, 1);
    const memberTask = await addTask(pglite, acme, "멤버가 만듦");
    await assert.rejects(
      addTask(pglite, personal[users[0]], "남의 개인 조직"),
      /row-level security/,
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select title, created_by from public.tasks where org_id = $1 order by created_at",
        [acme],
      ),
      [
        { title: "owner 가 만듦", created_by: users[0] },
        { title: "멤버가 만듦", created_by: users[1] },
      ],
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "update public.tasks set title = '멤버가 고침', description = '설명', status = 'in_progress', due_date = '2026-10-21', assignee_id = $2 where id = $1 returning title, description, status, due_date::text as due_date, assignee_id, created_by",
        [ownerTask, users[1]],
      ),
      [
        {
          title: "멤버가 고침",
          description: "설명",
          status: "in_progress",
          due_date: "2026-10-21",
          assignee_id: users[1],
          // 고친 사람이 아니라 처음 만든 사람이다.
          created_by: users[0],
        },
      ],
    );
    await as(pglite, 0);
    assert.deepEqual(
      await rowsOf(pglite, "select title from public.tasks where id = $1", [memberTask]),
      [{ title: "멤버가 만듦" }],
    );
    await asAdminTool(pglite);
  });

  it("작업은 만든 사람이나 owner 가 지운다 — member 는 남이 만든 작업을, 나간 사람은 자기가 만든 작업도 지우지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await pglite.query(
      "insert into public.tasks (org_id, title, created_by) values ($1, 'owner 작업', $2), ($1, 'member 작업', $3), ($1, 'member 둘째', $3)",
      [acme, users[0], users[1]],
    );
    const remove = async (i, title) => {
      await as(pglite, i);
      const { rows } = await pglite.query(
        "delete from public.tasks where title = $1 returning title",
        [title],
      );
      await asAdminTool(pglite);
      return rows.length;
    };
    assert.equal(await remove(1, "owner 작업"), 0);
    assert.equal(await remove(1, "member 작업"), 1);
    assert.equal(await remove(0, "member 둘째"), 1);
    await pglite.query(
      "insert into public.tasks (org_id, title, created_by) values ($1, '나가기 전', $2)",
      [acme, users[1]],
    );
    await as(pglite, 1);
    await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
      acme,
      users[1],
    ]);
    assert.equal(await remove(1, "나가기 전"), 0);
    // WHERE·RETURNING 이 없는 지우기는 읽기 정책을 거치지 않고 지우기 정책만 본다. "아직 멤버일 때"가 여기서 막는다.
    await as(pglite, 1);
    await pglite.query("delete from public.tasks");
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        'select title from public.tasks where org_id = $1 order by title collate "C"',
        [acme],
      ),
      [{ title: "owner 작업" }, { title: "나가기 전" }],
    );
  });

  it("담당자는 그 조직의 멤버만 된다 — 다른 조직 사람은 넣을 때도 고칠 때도 외래 키가 거절한다(23503, tasks_assignee_fkey)", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    const rejectsAssignee = (promise, label) =>
      assert.rejects(
        promise,
        (error) => error.code === "23503" && error.message.includes("tasks_assignee_fkey"),
        label,
      );
    await as(pglite, 1);
    // user2 는 acme 밖의 사람이다. 없는 사람도 같다.
    for (const outsider of [users[2], "00000000-0000-0000-0000-000000000009"])
      await rejectsAssignee(
        addTask(pglite, acme, "밖의 사람에게", { assignee_id: outsider }),
        outsider,
      );
    const id = await addTask(pglite, acme, "멤버에게", { assignee_id: users[0] });
    await rejectsAssignee(
      pglite.query("update public.tasks set assignee_id = $2 where id = $1", [id, users[2]]),
      "update",
    );
    // 개인 조직에는 주인 한 명뿐이다. 팀의 동료도 담당자가 되지 못한다.
    await as(pglite, 0);
    await rejectsAssignee(
      addTask(pglite, personal[users[0]], "개인 작업", { assignee_id: users[1] }),
      "personal",
    );
    await addTask(pglite, personal[users[0]], "내 개인 작업", { assignee_id: users[0] });
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(pglite, "select title, assignee_id from public.tasks order by title"),
      [
        { title: "내 개인 작업", assignee_id: users[0] },
        { title: "멤버에게", assignee_id: users[0] },
      ],
    );
  });

  it("상태가 완료로 바뀌면 완료 시각을 DB 가 채우고 완료에서 벗어나면 비운다 — 할 일↔진행 중은 빈 채, 완료인 채 다른 칸을 고치면 그대로다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 1);
    const id = await addTask(pglite, acme, "완료 시각");
    const setStatus = (status) =>
      pglite.query("update public.tasks set status = $2 where id = $1", [id, status]);
    const completedAt = async () =>
      (await rowsOf(pglite, "select completed_at as at from public.tasks where id = $1", [id]))[0]
        .at;
    assert.equal(await completedAt(), null);
    await setStatus("in_progress");
    assert.equal(await completedAt(), null);
    await setStatus("todo");
    assert.equal(await completedAt(), null);
    await setStatus("done");
    assert.notEqual(await completedAt(), null);
    // 완료 시각을 지난 날로 옮겨 둔다(관리 작업). 완료인 채 제목을 고치거나 같은 상태를 다시 적어도 그대로다.
    // PGlite 의 시계는 밀리초 단위라 바로 앞의 완료 시각과 견주면 "다시 적었는지"를 가르지 못한다.
    await asAdminTool(pglite);
    await pglite.query(
      "update public.tasks set completed_at = '2026-10-01T00:00:00Z' where id = $1",
      [id],
    );
    await as(pglite, 1);
    await pglite.query(
      "update public.tasks set title = '제목 고침', status = 'done' where id = $1",
      [id],
    );
    assert.deepEqual(await completedAt(), new Date("2026-10-01T00:00:00Z"));
    await setStatus("todo");
    assert.equal(await completedAt(), null);
    await setStatus("done");
    const reopenedAndDone = await completedAt();
    assert.ok(reopenedAndDone > new Date("2026-10-02T00:00:00Z"), String(reopenedAndDone));
    await setStatus("in_progress");
    assert.equal(await completedAt(), null);
    // 처음부터 완료로 넣으면 넣은 때가 완료 시각이다.
    const doneAtStart = await addTask(pglite, acme, "처음부터 완료", { status: "done" });
    assert.ok((await taskOf(pglite, doneAtStart)).completed_at instanceof Date);
    await asAdminTool(pglite);
    // 관리 작업이 완료가 아닌 작업에 완료 시각을 실어도 DB 가 비운다(완료일 때만 시각이 있다).
    await pglite.query(
      "insert into public.tasks (org_id, title, status, completed_at) values ($1, '관리 작업', 'todo', now())",
      [acme],
    );
    assert.deepEqual(
      await rowsOf(pglite, "select completed_at from public.tasks where title = '관리 작업'"),
      [{ completed_at: null }],
    );
  });

  it("역할 바꾸기와 내보내기는 owner 만 한다 — member 의 시도는 0행이다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 1);
    assert.deepEqual(
      (
        await pglite.query(
          "update public.memberships set org_role = 'owner' where org_id = $1 returning user_id",
          [acme],
        )
      ).rows,
      [],
    );
    assert.deepEqual(
      (
        await pglite.query(
          "delete from public.memberships where org_id = $1 and user_id = $2 returning user_id",
          [acme, users[0]],
        )
      ).rows,
      [],
    );
    await as(pglite, 0);
    await pglite.query(
      "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
      [acme, users[1]],
    );
    await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
      acme,
      users[1],
    ]);
    await asAdminTool(pglite);
    assert.deepEqual(await membersOf(pglite, acme), [{ user_id: users[0], org_role: "owner" }]);
  });

  it("마지막 owner 는 나가거나 member 로 내려가지 못하고, owner 가 둘이면 한 명은 나간다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await as(pglite, 0);
    const leave = () =>
      pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
        acme,
        users[0],
      ]);
    const demoteSelf = () =>
      pglite.query(
        "update public.memberships set org_role = 'member' where org_id = $1 and user_id = $2",
        [acme, users[0]],
      );
    await assert.rejects(leave(), /owner 가 한 명 이상/);
    await assert.rejects(demoteSelf(), /owner 가 한 명 이상/);
    // 개인 조직도 같은 규칙으로 나갈 수 없다.
    await assert.rejects(
      pglite.query("delete from public.memberships where org_id = $1", [personal[users[0]]]),
      /owner 가 한 명 이상/,
    );
    await pglite.query(
      "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
      [acme, users[1]],
    );
    // owner 가 둘이면 한 명이 내려가는 것은 되지만, 남은 한 명은 다시 막힌다.
    await demoteSelf();
    await as(pglite, 1);
    await assert.rejects(
      pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
        acme,
        users[1],
      ]),
      /owner 가 한 명 이상/,
    );
    await asAdminTool(pglite);
    assert.deepEqual(await membersOf(pglite, acme), [
      { user_id: users[0], org_role: "member" },
      { user_id: users[1], org_role: "owner" },
    ]);
  });

  // 20261019000001(ADR-021): 역할 변경은 그 조직의 업무 역할 ADMIN 만 한다. 개인 조직의 주인은 owner 이지만 ADMIN 이 아니라
  // 정책이 행을 보여 주지 않는다(오류가 아니라 0행). 마지막 owner 보호(protect_last_owner)는 그대로 있고, 팀의 owner 가
  // ADMIN 으로서 내려가는 경우는 위 시험("마지막 owner 는 …")이 본다.
  it("개인 조직의 주인은 자기 역할을 member 로 내리지 못한다", async (t) => {
    const { pglite, personal } = await teamDb(t);
    await as(pglite, 0);
    assert.deepEqual(
      (
        await pglite.query(
          "update public.memberships set org_role = 'member' where org_id = $1 and user_id = $2 returning user_id",
          [personal[users[0]], users[0]],
        )
      ).rows,
      [],
    );
    await asAdminTool(pglite);
    assert.deepEqual(await membersOf(pglite, personal[users[0]]), [
      { user_id: users[0], org_role: "owner" },
    ]);
  });

  // 두 연결이 동시에 서로를 내리는 경우의 대역이다. PGlite 는 연결이 하나라 진짜 동시 실행은 재현하지 못한다
  // (그 경우는 트리거가 조직 행을 잠가 막는다). 여기서는 한 문장 안에서 앞 행의 변경을 뒤 행의 검사가 보는지 본다.
  it("owner 둘을 한 문장으로 함께 내리거나 내보내도 owner 가 0명이 되지 않는다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    // ADMIN도 둘이어야 첫 삭제는 통과하고 마지막 owner 보호를 독립적으로 검증한다.
    await pglite.query(
      "update public.memberships set org_role = 'owner', sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
      [acme, users[1]],
    );
    await assert.rejects(
      pglite.query("update public.memberships set org_role = 'member' where org_id = $1", [acme]),
      /owner 가 한 명 이상/,
    );
    await assert.rejects(
      pglite.query("delete from public.memberships where org_id = $1", [acme]),
      /owner 가 한 명 이상/,
    );
    await asAdminTool(pglite);
    assert.deepEqual(await membersOf(pglite, acme), [
      { user_id: users[0], org_role: "owner" },
      { user_id: users[1], org_role: "owner" },
    ]);
  });

  it("들어오는 길은 본인의 초대 수락뿐이다 — owner 도 초대받은 사람을 대신 넣지 못하고, 개인 조직에는 아무도 못 들어온다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
      acme,
      emailOf(2),
    ]);
    const add = (org, user) =>
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
        [org, user],
      );
    // 초대가 있어도 owner 가 대신 넣지는 못한다.
    await assert.rejects(add(acme, users[2]), /row-level security/);
    await assert.rejects(add(personal[users[0]], users[2]), /row-level security/);
    await as(pglite, 2);
    await assert.rejects(add(personal[users[0]], users[2]), /row-level security/);
    await asAdminTool(pglite);
    assert.deepEqual(await membersOf(pglite, acme), [
      { user_id: users[0], org_role: "owner" },
      { user_id: users[1], org_role: "member" },
    ]);
    assert.deepEqual(await membersOf(pglite, personal[users[0]]), [
      { user_id: users[0], org_role: "owner" },
    ]);
  });

  it("초대는 owner 가 팀에만 한다 — member·개인 조직·이미 멤버인 이메일(자기 이메일 포함)은 막는다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    const invite = (org, email) =>
      pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [org, email]);
    await as(pglite, 1);
    await assert.rejects(invite(acme, "new@example.invalid"), /row-level security/);
    await as(pglite, 0);
    await assert.rejects(
      invite(personal[users[0]], "new@example.invalid"),
      /개인 조직에는 초대할 수 없습니다/,
    );
    await assert.rejects(invite(acme, emailOf(1)), /이미 멤버입니다/);
    await assert.rejects(invite(acme, emailOf(0)), /이미 멤버입니다/);
    // 이메일은 소문자로만 저장한다(비교를 소문자로 하므로).
    await assert.rejects(invite(acme, "New@Example.invalid"), /invitations_email_check/);
    await invite(acme, "new@example.invalid");
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select email, org_role, invited_by from public.invitations where org_id = $1",
        [acme],
      ),
      [{ email: "new@example.invalid", org_role: "member", invited_by: users[0] }],
    );
  });

  it("초대받은 이메일로 로그인한 사람만 받은 초대와 그 조직을 보고, 만료 전에 초대받은 역할로만 수락한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
      acme,
      emailOf(2),
    ]);
    const accept = (i, role = "member") =>
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, $3)",
        [acme, users[i], role],
      );
    // 다른 사람(member 인 user1)은 남의 초대로 user2 를 들이지 못한다.
    await as(pglite, 1);
    await assert.rejects(
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
        [acme, users[2]],
      ),
      /row-level security/,
    );
    await as(pglite, 2);
    assert.deepEqual(
      await rowsOf(pglite, "select slug from public.organizations where id = $1", [acme]),
      [{ slug: "acme" }],
    );
    assert.deepEqual(await rowsOf(pglite, "select email from public.invitations"), [
      { email: emailOf(2) },
    ]);
    // 초대받은 역할보다 높은 역할로는 들어오지 못한다.
    await assert.rejects(accept(2, "owner"), /row-level security/);
    // 로그인 이메일의 대소문자는 가리지 않는다.
    await actAs(pglite, users[2], "authenticated", "USER2@Example.invalid");
    await accept(2);
    await asAdminTool(pglite);
    // 수락하면 초대는 지워진다.
    assert.deepEqual(
      await rowsOf(pglite, "select email from public.invitations where org_id = $1", [acme]),
      [],
    );
    assert.deepEqual((await membersOf(pglite, acme)).at(-1), {
      user_id: users[2],
      org_role: "member",
    });
  });

  it("다른 이메일로 온 초대는 수락하지 못한다 — 로그인 이메일이 초대 이메일과 같을 때만 들어온다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query(
      "insert into public.invitations (org_id, email) values ($1, 'other@example.invalid')",
      [acme],
    );
    const join = () =>
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
        [acme, users[2]],
      );
    // 조직 id 를 알아도 내 이메일로 온 초대가 없으면 막힌다. 이메일은 두 곳이 본다: 수락 정책의 조건과,
    // 그 정책이 읽는 초대 표의 읽기 정책(받은 초대 읽기). 하나만 빠져서는 이 시험이 깨지지 않는다.
    await as(pglite, 2);
    await assert.rejects(join(), /row-level security/);
    // 같은 계정이라도 로그인 이메일(JWT 의 email)이 초대 이메일이면 들어온다 — 가르는 것은 이메일이다.
    await actAs(pglite, users[2], "authenticated", "other@example.invalid");
    await join();
    await asAdminTool(pglite);
    assert.deepEqual((await membersOf(pglite, acme)).at(-1), {
      user_id: users[2],
      org_role: "member",
    });
  });

  it("초대받은 사람은 수락 전에 그 조직의 이름만 본다 — 멤버·다른 초대·작업·활동·팀원 프로필은 읽지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    // 운영자 읽기 정책(전체 프로필)이 끼지 않게 user2 를 보통 사용자로 둔다.
    await pglite.query("update public.profiles set is_admin = false where id = $1", [users[2]]);
    await as(pglite, 0);
    await pglite.query(
      "insert into public.invitations (org_id, email) values ($1, $2), ($1, 'later@example.invalid')",
      [acme, emailOf(2)],
    );
    await addTask(pglite, acme, "팀 작업");
    await as(pglite, 2);
    assert.deepEqual(
      (
        await rowsOf(
          pglite,
          `select
             (select count(*)::int from public.organizations where id = $1) as orgs,
             (select count(*)::int from public.memberships where org_id = $1) as members,
             (select count(*)::int from public.tasks where org_id = $1) as tasks,
             (select count(*)::int from public.activities where org_id = $1) as activities`,
          [acme],
        )
      )[0],
      { orgs: 1, members: 0, tasks: 0, activities: 0 },
    );
    assert.deepEqual(await rowsOf(pglite, "select email from public.invitations"), [
      { email: emailOf(2) },
    ]);
    assert.deepEqual(await rowsOf(pglite, "select id from public.profiles"), [{ id: users[2] }]);
    // 거절하면(초대가 없어지면) 조직도 다시 보이지 않는다.
    await pglite.query("delete from public.invitations where org_id = $1", [acme]);
    assert.deepEqual(
      await rowsOf(pglite, "select id from public.organizations where id = $1", [acme]),
      [],
    );
    await asAdminTool(pglite);
  });

  it("초대의 역할은 owner 만 다시 적는다 — 받은 사람이 자기 초대를 owner 로 올려 들어오지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
      acme,
      emailOf(2),
    ]);
    const promote = async (i) => {
      await as(pglite, i);
      const { rows } = await pglite.query(
        "update public.invitations set org_role = 'owner' where org_id = $1 returning email",
        [acme],
      );
      return rows.length;
    };
    // 받은 사람도, 같은 조직의 member 도 올리지 못한다.
    assert.equal(await promote(2), 0);
    assert.equal(await promote(1), 0);
    await as(pglite, 2);
    await assert.rejects(
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'owner')",
        [acme, users[2]],
      ),
      /row-level security/,
    );
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(pglite, "select email, org_role from public.invitations where org_id = $1", [
        acme,
      ]),
      [{ email: emailOf(2), org_role: "member" }],
    );
  });

  it("만료된 초대는 수락하지 못하고, 같은 이메일을 다시 초대하면 만료가 7일로 새로 늘어난다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await pglite.query(
      "insert into public.invitations (org_id, email, invited_by, expires_at) values ($1, $2, $3, now() - interval '1 minute')",
      [acme, emailOf(2), users[0]],
    );
    await as(pglite, 2);
    await assert.rejects(
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
        [acme, users[2]],
      ),
      /row-level security/,
    );
    // 다시 초대: 이미 있는 초대에 역할을 다시 적으면 만료가 갱신된다.
    await as(pglite, 0);
    await pglite.query(
      "update public.invitations set org_role = 'member' where org_id = $1 and email = $2",
      [acme, emailOf(2)],
    );
    await asAdminTool(pglite);
    const [{ days }] = await rowsOf(
      pglite,
      "select round(extract(epoch from expires_at - now()) / 86400)::int as days from public.invitations where email = $1",
      [emailOf(2)],
    );
    assert.equal(days, 7);
  });

  it("받은 사람은 초대를 거절하고, owner 는 취소한다 — 상관없는 사람은 지우지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query(
      "insert into public.invitations (org_id, email) values ($1, $2), ($1, 'other@example.invalid')",
      [acme, emailOf(2)],
    );
    const remove = async (i, email) => {
      await as(pglite, i);
      const { rows } = await pglite.query(
        "delete from public.invitations where email = $1 returning email",
        [email],
      );
      await asAdminTool(pglite);
      return rows.length;
    };
    assert.equal(await remove(1, emailOf(2)), 0);
    assert.equal(await remove(2, emailOf(2)), 1);
    assert.equal(await remove(2, "other@example.invalid"), 0);
    assert.equal(await remove(0, "other@example.invalid"), 1);
  });

  it("같은 조직의 멤버끼리는 프로필을 읽고, 조직 밖의 프로필은 읽지 못한다", async (t) => {
    const { pglite } = await teamDb(t);
    const profileIds = async (i) => {
      await as(pglite, i);
      const ids = (await rowsOf(pglite, "select id from public.profiles order by id")).map(
        (row) => row.id,
      );
      await asAdminTool(pglite);
      return ids;
    };
    assert.deepEqual(await profileIds(0), [users[0], users[1]]);
    assert.deepEqual(await profileIds(1), [users[0], users[1]]);
  });

  it("팀을 나가거나 내보내지면 그 조직의 멤버·작업·활동과 서로의 프로필이 닫히고, 같은 초대로 다시 들어오지 못한다", async (t) => {
    // 1: user1 이 스스로 나간다. 0: owner 인 user0 이 user1 을 내보낸다.
    for (const by of [1, 0]) {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 1);
      await addTask(pglite, acme, "떠난 사람의 작업");
      await as(pglite, by);
      await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
        acme,
        users[1],
      ]);
      await as(pglite, 1);
      assert.deepEqual(
        (
          await rowsOf(
            pglite,
            `select
               (select count(*)::int from public.organizations where id = $1) as orgs,
               (select count(*)::int from public.memberships where org_id = $1) as members,
               (select count(*)::int from public.tasks where org_id = $1) as tasks,
               (select count(*)::int from public.activities where org_id = $1) as activities`,
            [acme],
          )
        )[0],
        { orgs: 0, members: 0, tasks: 0, activities: 0 },
        `by=${by}`,
      );
      assert.deepEqual(
        await rowsOf(pglite, "select id from public.profiles"),
        [{ id: users[1] }],
        `by=${by}`,
      );
      // 수락한 초대는 지워졌다. 다시 들어오려면 새 초대가 있어야 한다.
      await assert.rejects(
        pglite.query(
          "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
          [acme, users[1]],
        ),
        /row-level security/,
        `by=${by}`,
      );
      await as(pglite, 0);
      assert.deepEqual(
        await rowsOf(pglite, "select id from public.profiles"),
        [{ id: users[0] }],
        `by=${by}`,
      );
      // 작업은 남고 만든 사람의 프로필은 읽지 못한다(화면은 "떠난 멤버"로 보인다).
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select t.title, t.created_by, p.id as creator from public.tasks t left join public.profiles p on p.id = t.created_by where t.org_id = $1",
          [acme],
        ),
        [{ title: "떠난 사람의 작업", created_by: users[1], creator: null }],
        `by=${by}`,
      );
      await asAdminTool(pglite);
    }
  });

  it("멤버가 나가거나 내보내지면 맡던 작업의 담당자만 비고 작업은 남는다 — 활동은 나감·내보냄 한 줄뿐이고 담당자 비움은 남지 않는다", async (t) => {
    // 1: user1 이 스스로 나간다(member_left). 0: owner 인 user0 이 user1 을 내보낸다(member_removed).
    for (const [by, kind] of [
      [1, "member_left"],
      [0, "member_removed"],
    ]) {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 0);
      const assigned = await addTask(pglite, acme, "맡긴 작업", { assignee_id: users[1] });
      const ownersOwn = await addTask(pglite, acme, "owner 가 맡음", { assignee_id: users[0] });
      await as(pglite, by);
      await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
        acme,
        users[1],
      ]);
      await asAdminTool(pglite);
      // 담당자만 비고 조직·제목·만든 사람은 그대로다. 남은 멤버가 맡은 작업은 건드리지 않는다.
      const kept = await Promise.all([assigned, ownersOwn].map((id) => taskOf(pglite, id)));
      assert.deepEqual(
        kept.map(({ org_id, title, assignee_id, created_by }) => ({
          org_id,
          title,
          assignee_id,
          created_by,
        })),
        [
          { org_id: acme, title: "맡긴 작업", assignee_id: null, created_by: users[0] },
          { org_id: acme, title: "owner 가 맡음", assignee_id: users[0], created_by: users[0] },
        ],
        `by=${by}`,
      );
      assert.deepEqual(
        await activitiesOf(pglite, acme),
        log([
          ...TEAM_LOG,
          activity("task_created", users[0], { task_title: "맡긴 작업" }),
          activity("task_created", users[0], { task_title: "owner 가 맡음" }),
          activity(kind, users[by], { target_user_id: users[1], target_name: "user1" }),
        ]),
        `by=${by}`,
      );
    }
  });

  it("계정을 지우는 관리 작업은 마지막 owner 보호를 통과하고, 팀의 작업은 만든 사람·담당자만 비운 채 남는다 — 연쇄로 지워지는 행은 활동을 남기지 않는다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await pglite.query("update public.profiles set display_name = '홍길동' where id = $1", [
      users[0],
    ]);
    await as(pglite, 0);
    const made = await addTask(pglite, acme, "팀에 남는 작업");
    // 개인 조직의 작업·활동은 조직과 함께 사라진다.
    await addTask(pglite, personal[users[0]], "개인 작업");
    await as(pglite, 1);
    const assigned = await addTask(pglite, acme, "owner 에게 맡김");
    await pglite.query("update public.tasks set assignee_id = $2 where id = $1", [
      assigned,
      users[0],
    ]);
    await asAdminTool(pglite);
    assert.deepEqual(
      await activitiesOf(pglite, acme),
      log([
        ...TEAM_LOG,
        activity("task_created", users[0], { task_title: "팀에 남는 작업" }),
        activity("task_created", users[1], { task_title: "owner 에게 맡김" }),
        activity("task_assigned", users[1], {
          task_title: "owner 에게 맡김",
          target_user_id: users[0],
          target_name: "홍길동",
        }),
      ]),
    );

    await pglite.query("delete from auth.users where id = $1", [users[0]]);
    assert.deepEqual(
      [await taskOf(pglite, made), await taskOf(pglite, assigned)].map(
        ({ org_id, title, assignee_id, created_by }) => ({
          org_id,
          title,
          assignee_id,
          created_by,
        }),
      ),
      [
        { org_id: acme, title: "팀에 남는 작업", assignee_id: null, created_by: null },
        { org_id: acme, title: "owner 에게 맡김", assignee_id: null, created_by: users[1] },
      ],
    );
    // 개인 조직은 주인과 함께 사라진다. 그 조직의 작업·활동도 없다.
    assert.deepEqual(
      await rowsOf(
        pglite,
        `select
           (select count(*)::int from public.organizations where id = $1) as orgs,
           (select count(*)::int from public.tasks where org_id = $1) as tasks,
           (select count(*)::int from public.activities where org_id = $1) as activities`,
        [personal[users[0]]],
      ),
      [{ orgs: 0, tasks: 0, activities: 0 }],
    );
    assert.deepEqual(await membersOf(pglite, acme), [{ user_id: users[1], org_role: "member" }]);
    // 새 기록(나감·내보냄·담당자 비움)은 없다. 지운 사람을 가리키던 행위자·대상은 비고, 대상 이름 사본도 지워진다.
    assert.deepEqual(
      await activitiesOf(pglite, acme),
      log([
        activity("invitation_sent", null, { new_role: "member" }),
        TEAM_LOG[1],
        activity("task_created", null, { task_title: "팀에 남는 작업" }),
        activity("task_created", users[1], { task_title: "owner 에게 맡김" }),
        activity("task_assigned", users[1], { task_title: "owner 에게 맡김" }),
      ]),
    );
  });

  it("조직을 지우는 관리 작업은 작업·멤버십·초대·활동이 있어도 실패하지 않고, 지우는 동안 아무 기록도 남기지 않는다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
      acme,
      emailOf(2),
    ]);
    await addTask(pglite, acme, "맡긴 작업", { assignee_id: users[1] });
    await addTask(pglite, acme, "완료한 작업", { status: "done" });
    await addTask(pglite, personal[users[0]], "다른 조직의 작업");
    await asAdminTool(pglite);
    const othersBefore = await rowsOf(
      pglite,
      "select org_id, kind, task_title from public.activities where org_id <> $1 order by org_id, created_at",
      [acme],
    );
    await pglite.query("delete from public.organizations where id = $1", [acme]);
    assert.deepEqual(
      await rowsOf(
        pglite,
        `select
           (select count(*)::int from public.tasks where org_id = $1) as tasks,
           (select count(*)::int from public.memberships where org_id = $1) as members,
           (select count(*)::int from public.invitations where org_id = $1) as invitations,
           (select count(*)::int from public.activities where org_id = $1) as activities`,
        [acme],
      ),
      [{ tasks: 0, members: 0, invitations: 0, activities: 0 }],
    );
    // 다른 조직의 기록은 그대로다(지워지는 조직의 일이 다른 곳에 남지 않는다).
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, kind, task_title from public.activities order by org_id, created_at",
      ),
      othersBefore,
    );
    assert.deepEqual(othersBefore, [
      { org_id: personal[users[0]], kind: "task_created", task_title: "다른 조직의 작업" },
    ]);
  });

  it("정책 도우미는 부른 사람의 조직만 돌려주고, 로그아웃한 사람은 부르지 못하며, 개인 조직 만들기는 화면 역할이 못 부른다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    const idsFrom = async (i, fn) => {
      await as(pglite, i);
      const ids = (await rowsOf(pglite, `select id from public.${fn}() as id`)).map(
        (row) => row.id,
      );
      await asAdminTool(pglite);
      return ids.toSorted();
    };
    assert.deepEqual(await idsFrom(1, "my_org_ids"), [acme, personal[users[1]]].toSorted());
    assert.deepEqual(await idsFrom(1, "my_owner_org_ids"), [personal[users[1]]]);
    // 운영자라도 남의 조직 id 는 나오지 않는다.
    assert.deepEqual(await idsFrom(2, "my_org_ids"), [personal[users[2]]]);
    await actAs(pglite, null, "anon");
    for (const fn of ["my_org_ids", "my_owner_org_ids"])
      await assert.rejects(
        pglite.query(`select public.${fn}()`),
        new RegExp(`permission denied for function ${fn}`),
      );
    // 남의 개인 조직을 만들어 주거나 찾아 주는 길이 화면에 열려 있지 않다.
    await as(pglite, 2);
    await assert.rejects(
      pglite.query("select public.create_personal_org($1)", [users[1]]),
      /permission denied for function create_personal_org/,
    );
    await asAdminTool(pglite);
  });

  it("화면 역할의 조직 표 권한은 로그인 역할의 읽기·지우기와 열 단위 쓰기뿐이다 — anon 에는 없다", async (t) => {
    const { pglite } = await teamDb(t);
    const tables = ["invitations", "memberships", "organizations"];
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated') order by 1,2,3",
        [tables],
      ),
      [
        { table_name: "invitations", grantee: "authenticated", privilege_type: "DELETE" },
        { table_name: "invitations", grantee: "authenticated", privilege_type: "SELECT" },
        { table_name: "memberships", grantee: "authenticated", privilege_type: "DELETE" },
        { table_name: "memberships", grantee: "authenticated", privilege_type: "SELECT" },
        // 팀 지우기(20261015000002). 누가 지우는지는 정책이 정한다(팀 owner 만).
        { table_name: "organizations", grantee: "authenticated", privilege_type: "DELETE" },
        { table_name: "organizations", grantee: "authenticated", privilege_type: "SELECT" },
      ],
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select table_name, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated') and privilege_type not in ('SELECT') order by 1,2,3",
        [tables],
      ),
      [
        { table_name: "invitations", column_name: "email", privilege_type: "INSERT" },
        { table_name: "invitations", column_name: "org_id", privilege_type: "INSERT" },
        { table_name: "invitations", column_name: "org_role", privilege_type: "INSERT" },
        { table_name: "invitations", column_name: "org_role", privilege_type: "UPDATE" },
        // 업무 역할(20261019000001). 초대의 sol_role 은 ADMIN 이 적고, 멤버십의 sol_role 은 ADMIN 이 바꾼다(insert 는 트리거가 채운다).
        { table_name: "invitations", column_name: "sol_role", privilege_type: "INSERT" },
        { table_name: "invitations", column_name: "sol_role", privilege_type: "UPDATE" },
        { table_name: "memberships", column_name: "org_id", privilege_type: "INSERT" },
        { table_name: "memberships", column_name: "org_role", privilege_type: "INSERT" },
        { table_name: "memberships", column_name: "org_role", privilege_type: "UPDATE" },
        { table_name: "memberships", column_name: "sol_role", privilege_type: "UPDATE" },
        { table_name: "memberships", column_name: "user_id", privilege_type: "INSERT" },
        { table_name: "organizations", column_name: "name", privilege_type: "INSERT" },
        // 팀 이름 바꾸기(20261015000002). 주소(slug)·개인 조직 주인은 바꾸는 권한이 없다.
        { table_name: "organizations", column_name: "name", privilege_type: "UPDATE" },
        { table_name: "organizations", column_name: "slug", privilege_type: "INSERT" },
      ],
    );
  });

  // 재현 시험(20261014000003): 초대를 막는 트리거가 정책보다 먼저 돌아 조직 밖 사람에게 다른 문구를 보였다.
  it("조직 밖의 사람이 초대를 넣어 보면 이유와 상관없이 같은 정책 오류다 — 멤버 여부·개인 조직 여부를 알려 주지 않는다", async (t) => {
    const { pglite, acme, personal } = await teamDb(t);
    await as(pglite, 2);
    const invite = (org, email) =>
      pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [org, email]);
    for (const [org, email] of [
      [acme, emailOf(1)], // 이미 멤버
      [acme, "new@example.invalid"], // 새 이메일
      [personal[users[0]], "new@example.invalid"], // 남의 개인 조직
    ])
      await assert.rejects(invite(org, email), /row-level security/, `${org} ${email}`);
    await asAdminTool(pglite);
  });

  // 재현 시험(20261014000003): 수락은 로그인 이메일(JWT)로 보는데 초대 지우기는 프로필 이메일로 찾아, 둘이 다르면 초대가 남았다.
  it("로그인 이메일이 프로필 이메일과 달라도 수락한 초대는 지워진다 — 남은 초대로 다시 들어오지 못한다", async (t) => {
    const { pglite, acme } = await teamDb(t);
    await as(pglite, 0);
    await pglite.query(
      "insert into public.invitations (org_id, email) values ($1, 'renamed@example.invalid')",
      [acme],
    );
    // 이메일을 바꾼 직후처럼 토큰의 이메일과 프로필의 이메일이 다르다.
    await actAs(pglite, users[2], "authenticated", "renamed@example.invalid");
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
      [acme, users[2]],
    );
    await asAdminTool(pglite);
    assert.deepEqual(
      await rowsOf(pglite, "select email from public.invitations where org_id = $1", [acme]),
      [],
    );
  });

  it("마이그레이션 전에 가입한 계정(프로필이 없는 계정 포함)을 개인 조직으로 채운다", async (t) => {
    const pglite = await freshDb(t);
    const index = migrations.findIndex((migration) => migration.version === "20261014000001");
    await applyMigrations(pglite, migrations.slice(0, index));
    for (const [i, id] of users.entries())
      await pglite.query("insert into auth.users values ($1, $2)", [id, emailOf(i)]);
    // 가입 트리거보다 먼저 만든 계정처럼 user2 의 프로필을 지운다.
    await pglite.query("delete from public.profiles where id = $1", [users[2]]);
    await applyMigrations(pglite, migrations.slice(index));
    // 계정마다 프로필(지웠던 user2 도 다시)과 개인 조직이 하나씩 있다.
    assert.deepEqual(
      (
        await rowsOf(
          pglite,
          "select o.personal_owner_id from public.organizations o join public.profiles p on p.id = o.personal_owner_id order by 1",
        )
      ).map((row) => row.personal_owner_id),
      users,
    );
  });

  // 활동은 트리거만 남긴다(스펙 4.3). 행위자는 요청한 사람(auth.uid())이고, 표시할 값(작업 제목·대상 이름·역할)은 기록 시점의 사본이다.
  describe("작업·활동 기록", () => {
    it("작업을 만들고·완료하고·다시 열고·지우면 활동이 남는다 — 만들 때 정한 담당자, 할 일↔진행 중, 제목·설명·마감일 고치기는 남지 않는다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 1);
      const id = await addTask(pglite, acme, "회의록 공유", { assignee_id: users[0] });
      const update = (assignments) =>
        pglite.query(`update public.tasks set ${assignments} where id = $1`, [id]);
      await update("status = 'in_progress'");
      await update("status = 'todo'");
      await update(
        "title = '회의록 공유하기', description = '금요일까지', due_date = '2026-10-21'",
      );
      await as(pglite, 0);
      await update("status = 'done'");
      // 완료인 채 제목을 고친다. 다시 엶·지움 기록은 그때의 제목을 남긴다.
      await update("title = '회의록 보내기'");
      await as(pglite, 1);
      await update("status = 'in_progress'");
      await as(pglite, 0);
      await pglite.query("delete from public.tasks where id = $1", [id]);
      await asAdminTool(pglite);
      assert.deepEqual(
        await activitiesOf(pglite, acme),
        log([
          ...TEAM_LOG,
          activity("task_created", users[1], { task_title: "회의록 공유" }),
          activity("task_completed", users[0], { task_title: "회의록 공유하기" }),
          activity("task_reopened", users[1], { task_title: "회의록 보내기" }),
          activity("task_deleted", users[0], { task_title: "회의록 보내기" }),
        ]),
      );
    });

    it("담당자를 바꾸면 새 담당자의 이름 사본이 남고, 스스로 맡으면 행위자와 대상이 같으며, 비우면 담당자 비움이 남는다 — 같은 값을 다시 적으면 남지 않는다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await pglite.query("update public.profiles set display_name = '홍길동' where id = $1", [
        users[0],
      ]);
      await as(pglite, 0);
      const id = await addTask(pglite, acme, "디자인 검토");
      const assign = (assignee) =>
        pglite.query("update public.tasks set assignee_id = $2 where id = $1", [id, assignee]);
      await assign(users[1]);
      await assign(users[1]);
      await as(pglite, 1);
      await assign(null);
      await assign(null);
      await as(pglite, 0);
      await assign(users[0]);
      await asAdminTool(pglite);
      const expected = log([
        ...TEAM_LOG,
        activity("task_created", users[0], { task_title: "디자인 검토" }),
        // 표시 이름이 없으면 이메일 @ 앞을 이름으로 남긴다.
        activity("task_assigned", users[0], {
          task_title: "디자인 검토",
          target_user_id: users[1],
          target_name: "user1",
        }),
        activity("task_unassigned", users[1], { task_title: "디자인 검토" }),
        activity("task_assigned", users[0], {
          task_title: "디자인 검토",
          target_user_id: users[0],
          target_name: "홍길동",
        }),
      ]);
      assert.deepEqual(await activitiesOf(pglite, acme), expected);
      // 이름 사본은 그 뒤 이름을 바꿔도 그대로다.
      await pglite.query("update public.profiles set display_name = '새 이름' where id = $1", [
        users[0],
      ]);
      assert.deepEqual(await activitiesOf(pglite, acme), expected);
    });

    it("초대를 보내면 역할만 남고(이메일 없음), 수락하면 들어옴, 역할을 바꾸면 전후 역할이 남는다 — 가입·팀 만들기의 첫 멤버는 남지 않는다", async (t) => {
      const { pglite, acme, personal } = await teamDb(t);
      // teamDb 의 기록은 초대 보냄·들어옴 둘뿐이다. 개인 조직(가입)에는 기록이 없다.
      assert.deepEqual(await activitiesOf(pglite, acme), log(TEAM_LOG));
      for (const org of Object.values(personal))
        assert.deepEqual(await activitiesOf(pglite, org), [], org);
      await as(pglite, 0);
      await pglite.query(
        "insert into public.invitations (org_id, email, org_role) values ($1, $2, 'owner')",
        [acme, emailOf(2)],
      );
      await pglite.query(
        "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
        [acme, users[1]],
      );
      // 20261019000001(ADR-021): 역할 변경은 ADMIN 만 한다. owner 가 된 user1 은 ADMIN 이 아니라 스스로 내리지 못하고(0행),
      // 팀을 만든 ADMIN(user0)이 내린다.
      await as(pglite, 1);
      assert.deepEqual(
        (
          await pglite.query(
            "update public.memberships set org_role = 'member' where org_id = $1 and user_id = $2 returning user_id",
            [acme, users[1]],
          )
        ).rows,
        [],
      );
      await as(pglite, 0);
      await pglite.query(
        "update public.memberships set org_role = 'member' where org_id = $1 and user_id = $2",
        [acme, users[1]],
      );
      await as(pglite, 2);
      await pglite.query(
        "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'owner')",
        [acme, users[2]],
      );
      await asAdminTool(pglite);
      assert.deepEqual(
        await activitiesOf(pglite, acme),
        log([
          ...TEAM_LOG,
          activity("invitation_sent", users[0], { new_role: "owner" }),
          activity("member_role_changed", users[0], {
            target_user_id: users[1],
            target_name: "user1",
            old_role: "member",
            new_role: "owner",
          }),
          activity("member_role_changed", users[0], {
            target_user_id: users[1],
            target_name: "user1",
            old_role: "owner",
            new_role: "member",
          }),
          activity("member_joined", users[2], { target_user_id: users[2], target_name: "user2" }),
        ]),
      );
      // 활동은 멤버 모두가 읽고 초대 목록은 owner 만 읽는다. 어느 기록에도 이메일이 없다.
      for (const { row } of await rowsOf(
        pglite,
        "select to_jsonb(a)::text as row from public.activities a",
      ))
        assert.doesNotMatch(row, /@/, row);
    });

    // 기준 시각: 서울 2026-10-14(수) 12:00. 그 주 월요일은 10-12, 최근 14일은 10-01 ~ 10-14 다.
    const AS_OF = "2026-10-14T03:00:00Z";
    const DAYS = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const statsOf = async (pglite, i, org, asOf = AS_OF) => {
      await as(pglite, i);
      const rows = await rowsOf(
        pglite,
        `select today::text, week_start::text, open_count, overdue_count, completed_this_week, my_open_count,
           daily_dates::text[] as daily_dates, daily_added, daily_completed
         from public.task_dashboard_stats($1, $2)`,
        [org, asOf],
      );
      await asAdminTool(pglite);
      // 서버는 rpc(...).single() 로 읽는다. 늘 한 줄이어야 한다.
      assert.equal(rows.length, 1);
      return rows[0];
    };
    // 관리 작업으로 만든 시각·완료 시각을 정해 넣는다. 날짜를 가르는 경계(서울 0시 = UTC 15시)를 일부러 걸친다.
    const dashboardDb = async (t) => {
      const team = await teamDb(t);
      const { pglite, acme, personal } = team;
      const insert = (org, title, status, due, assignee, createdAt, completedAt = null) =>
        rowsOf(
          pglite,
          "insert into public.tasks (org_id, title, status, due_date, assignee_id, created_by, created_at, completed_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
          [org, title, status, due, assignee, users[0], createdAt, completedAt],
        );
      // 서울 10-14 00:30 에 만듦(UTC 로는 10-13). 마감이 어제라 기한 지남.
      await insert(acme, "지난 마감", "todo", "2026-10-13", users[1], "2026-10-13T15:30:00Z");
      // 서울 10-13 23:59 에 만듦. 오늘 마감은 기한 지남이 아니다.
      await insert(
        acme,
        "오늘 마감",
        "in_progress",
        "2026-10-14",
        users[0],
        "2026-10-13T14:59:00Z",
      );
      // 서울 10-01 00:00(14일의 첫날)에 만들고 10-12(월) 00:00 에 완료. 마감이 지났어도 완료라 기한 지남이 아니다.
      await insert(
        acme,
        "월요일 0시 완료",
        "done",
        "2026-10-01",
        null,
        "2026-09-30T15:00:00Z",
        "2026-10-11T15:00:00Z",
      );
      // 서울 9-30 23:59:59(14일 밖)에 만들고 10-11(일) 23:59:59 에 완료 — 지난주 완료다.
      await insert(
        acme,
        "일요일 밤 완료",
        "done",
        null,
        null,
        "2026-09-30T14:59:59Z",
        "2026-10-11T14:59:59Z",
      );
      await insert(acme, "마감 없음", "todo", null, users[1], "2026-10-14T02:00:00Z");
      // 완료했다가 다시 연 작업은 완료에서 빠진다.
      const [{ id: reopened }] = await insert(
        acme,
        "다시 연 작업",
        "done",
        null,
        null,
        "2026-10-05T00:00:00Z",
        "2026-10-13T01:00:00Z",
      );
      await pglite.query("update public.tasks set status = 'todo' where id = $1", [reopened]);
      // 지운 작업은 어디에도 세지 않는다.
      const [{ id: removed }] = await insert(
        acme,
        "지운 작업",
        "done",
        "2026-10-02",
        users[1],
        "2026-10-14T01:00:00Z",
        "2026-10-14T01:30:00Z",
      );
      await pglite.query("delete from public.tasks where id = $1", [removed]);
      // 다른 조직의 작업은 acme 에 세지 않는다.
      await insert(
        personal[users[1]],
        "개인 작업",
        "todo",
        "2026-10-01",
        users[1],
        "2026-10-14T01:00:00Z",
      );
      return team;
    };
    const zeros = Array(14).fill(0);
    const at = (entries) => {
      const counts = [...zeros];
      for (const [date, count] of Object.entries(entries)) counts[DAYS.indexOf(date)] = count;
      return counts;
    };

    it("대시보드 집계는 서울 날짜로 오늘·이번 주 월요일을 잡고, 지금 남은 작업으로 열린·기한 지남·이번 주 완료·내 담당과 최근 14일의 추가·완료를 센다", async (t) => {
      const { pglite, acme, personal } = await dashboardDb(t);
      const team = {
        today: "2026-10-14",
        week_start: "2026-10-12",
        open_count: 4,
        overdue_count: 1,
        completed_this_week: 1,
        daily_dates: DAYS,
        daily_added: at({ "2026-10-01": 1, "2026-10-05": 1, "2026-10-13": 1, "2026-10-14": 2 }),
        daily_completed: at({ "2026-10-11": 1, "2026-10-12": 1 }),
      };
      // 내 담당은 부른 사람에게 맡겨진 열린 작업이다.
      assert.deepEqual(await statsOf(pglite, 1, acme), { ...team, my_open_count: 2 });
      assert.deepEqual(await statsOf(pglite, 0, acme), { ...team, my_open_count: 1 });
      assert.deepEqual(await statsOf(pglite, 1, personal[users[1]]), {
        today: "2026-10-14",
        week_start: "2026-10-12",
        open_count: 1,
        overdue_count: 1,
        completed_this_week: 0,
        my_open_count: 1,
        daily_dates: DAYS,
        daily_added: at({ "2026-10-14": 1 }),
        daily_completed: zeros,
      });
    });

    it("대시보드 집계는 부른 사람의 권한으로 돈다 — 조직 밖의 사람은 운영자라도 모두 0 이다", async (t) => {
      const { pglite, acme } = await dashboardDb(t);
      assert.deepEqual(await statsOf(pglite, 2, acme), {
        today: "2026-10-14",
        week_start: "2026-10-12",
        open_count: 0,
        overdue_count: 0,
        completed_this_week: 0,
        my_open_count: 0,
        daily_dates: DAYS,
        daily_added: zeros,
        daily_completed: zeros,
      });
    });

    it("대시보드 집계의 오늘과 이번 주는 서울 0시에 바뀐다 — 일요일 밤은 지난주, 월요일 0시부터 이번 주다", async (t) => {
      const { pglite, acme } = await dashboardDb(t);
      const weekOf = async (asOf) => {
        const stats = await statsOf(pglite, 1, acme, asOf);
        return [stats.today, stats.week_start, stats.completed_this_week, stats.daily_dates.at(-1)];
      };
      // 서울 10-11(일) 23:59:59: 그 주는 10-05 부터이고 일요일 밤 완료가 그 주의 완료다.
      assert.deepEqual(await weekOf("2026-10-11T14:59:59Z"), [
        "2026-10-11",
        "2026-10-05",
        1,
        "2026-10-11",
      ]);
      // 서울 10-12(월) 00:00: 새 주가 시작되고 월요일 0시 완료만 이번 주다.
      assert.deepEqual(await weekOf("2026-10-11T15:00:00Z"), [
        "2026-10-12",
        "2026-10-12",
        1,
        "2026-10-12",
      ]);
      // 서울 10-18(일) 23:59:59: 아직 10-12 부터의 주다.
      assert.deepEqual(await weekOf("2026-10-18T14:59:59Z"), [
        "2026-10-18",
        "2026-10-12",
        1,
        "2026-10-18",
      ]);
    });
  });

  // 회원 상태(정지)·탈퇴·제공자 프로필(20261015000001, 스펙 4.2). 정지·탈퇴가 조직 데이터와 얽혀 teamDb 의 장면을 쓴다:
  // user0 은 acme 의 owner, user1 은 member, user2 는 운영자다.
  describe("회원 상태·탈퇴·제공자 프로필", () => {
    const https = (length) => `https://${"a".repeat(length - "https://".length)}`;
    // 관리 작업으로 읽으므로 정책을 거치지 않는다.
    const profileOf = async (pglite, id) =>
      (
        await rowsOf(
          pglite,
          "select display_name, avatar_url, status from public.profiles where id = $1",
          [id],
        )
      )[0];
    // 간편 로그인 가입처럼 Supabase Auth 가 제공자 정보를 메타데이터에 적어 계정을 만든다(이메일을 주지 않는 제공자도 있다).
    const signUp = async (pglite, meta) => {
      const [{ id }] = await rowsOf(
        pglite,
        "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), null, $1::jsonb) returning id",
        [meta === null ? null : JSON.stringify(meta)],
      );
      return id;
    };
    const setStatus = (pglite, target, next) =>
      pglite.query("select public.admin_set_user_status($1, $2)", [target, next]);
    // 운영자(user2)가 화면에서 회원 상태를 바꾼다.
    const adminSets = async (pglite, target, next) => {
      await as(pglite, 2);
      await setStatus(pglite, target, next);
      await asAdminTool(pglite);
    };
    const addSessions = (pglite, owners) =>
      pglite.query("insert into auth.sessions (user_id) select unnest($1::uuid[])", [owners]);
    // 회원마다 상태·로그인 차단·세션 수. 로그인 차단은 100년 뒤면 '100y', 없으면 null 이고 그 밖의 값은 그대로 보인다.
    const accountsOf = (pglite) =>
      rowsOf(
        pglite,
        `select u.id, p.status,
           case
             when u.banned_until is null then null
             when u.banned_until between now() + interval '99 years' and now() + interval '101 years' then '100y'
             else u.banned_until::text
           end as banned,
           (select count(*)::int from auth.sessions s where s.user_id = u.id) as sessions
         from auth.users u join public.profiles p on p.id = u.id
         order by u.id`,
      );
    // 탈퇴가 지울 수 있는 행 전부. 관리 작업으로 읽는다.
    const accountRows = async (pglite) =>
      (
        await rowsOf(
          pglite,
          `select
             (select json_agg(id order by id) from auth.users) as users,
             (select json_agg(id order by id) from public.profiles) as profiles,
             (select json_agg(id order by id) from public.organizations) as orgs,
             (select json_agg(json_build_array(org_id, user_id, org_role) order by org_id, user_id)
                from public.memberships) as members,
             (select json_agg(json_build_array(user_id, id) order by user_id, id) from auth.sessions) as sessions,
             (select json_agg(json_build_array(id, org_id, created_by, assignee_id) order by id)
                from public.tasks) as tasks`,
        )
      )[0];
    const deleteMe = (pglite) => pglite.query("select public.delete_my_account()");

    it("가입하면 제공자의 full_name·name·nickname 순으로 처음 비지 않은 값을 앞뒤 공백 없이 40자 안으로 다듬어 표시 이름으로 쓴다", async (t) => {
      const pglite = await migratedDb(t);
      for (const [meta, expected] of [
        // jsonb 는 키를 짧은 것부터 저장한다(name·nickname·full_name). 저장 순서가 아니라 정한 순서다.
        [{ full_name: "홍길동", name: "길동", nickname: "gd" }, "홍길동"],
        [{ nickname: "gd", name: "길동" }, "길동"],
        [{ full_name: "   ", name: "", nickname: "  닉네임  " }, "닉네임"],
        [{ full_name: null, name: " 길동 " }, "길동"],
        [{ full_name: "가".repeat(40) }, "가".repeat(40)],
        [{ full_name: "가".repeat(41) }, "가".repeat(40)],
        [{ nickname: "가".repeat(100) }, "가".repeat(40)],
        // 40자에서 자른 끝이 공백이면 그것도 걷는다. 남기면 표시 이름 제약에 걸려 가입 자체가 실패한다.
        [{ full_name: `${"가".repeat(39)} 나` }, "가".repeat(39)],
        [{ full_name: " ", name: "   ", nickname: "" }, null],
        [{ avatar_url: "https://example.invalid/a.png" }, null],
        [{}, null],
      ])
        assert.equal(
          (await profileOf(pglite, await signUp(pglite, meta))).display_name,
          expected,
          JSON.stringify(meta),
        );
    });

    it("가입하면 제공자의 avatar_url·picture 순으로 https 이고 2048자 이하인 첫 값을 이미지로 쓴다 — http·javascript:·data:·객체·2049자는 건너뛴다", async (t) => {
      const pglite = await migratedDb(t);
      const a = "https://example.invalid/a.png";
      const b = "https://example.invalid/b.png";
      for (const [meta, expected] of [
        [{ avatar_url: a, picture: b }, a],
        [{ picture: b }, b],
        [{ avatar_url: "http://example.invalid/a.png", picture: b }, b],
        [{ avatar_url: "javascript:alert(1)", picture: b }, b],
        [{ avatar_url: "data:image/png;base64,AAAA" }, null],
        // 이미지를 객체로 주는 제공자: 글자로 꺼내면 JSON 이라 https 주소가 아니다.
        [{ picture: { data: { url: b } } }, null],
        [{ avatar_url: https(2048) }, https(2048)],
        [{ avatar_url: https(2049), picture: b }, b],
        [{ avatar_url: https(2049) }, null],
        [{ full_name: "이름만" }, null],
        [{}, null],
      ])
        assert.equal(
          (await profileOf(pglite, await signUp(pglite, meta))).avatar_url,
          expected,
          JSON.stringify(meta).slice(0, 80),
        );
    });

    it("메타데이터가 없어도(null) 가입은 실패하지 않는다 — 표시 이름·이미지가 빈 활성 프로필만 생긴다", async (t) => {
      const pglite = await migratedDb(t);
      const id = await signUp(pglite, null);
      assert.deepEqual(await profileOf(pglite, id), {
        display_name: null,
        avatar_url: null,
        status: "active",
      });
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select m.org_role from public.organizations o join public.memberships m on m.org_id = o.id where o.personal_owner_id = $1",
          [id],
        ),
        [],
      );
    });

    it("이미 가입한 사람은 마이그레이션이 비어 있는 표시 이름·이미지만 제공자 정보로 채운다 — 본인이 정한 이름은 그대로다", async (t) => {
      const pglite = await freshDb(t);
      const index = migrations.findIndex((migration) => migration.version === "20261015000001");
      await applyMigrations(pglite, migrations.slice(0, index));
      const meta = JSON.stringify({
        full_name: "제공자 이름",
        picture: "https://example.invalid/a.png",
      });
      for (const [i, id] of users.entries())
        await pglite.query(
          "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
          [id, emailOf(i), i === 2 ? null : meta],
        );
      await pglite.query(
        "update public.profiles set display_name = '내가 정한 이름' where id = $1",
        [users[0]],
      );
      await applyMigrations(pglite, migrations.slice(index));
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select id, display_name, avatar_url from public.profiles order by id",
        ),
        [
          {
            id: users[0],
            display_name: "내가 정한 이름",
            avatar_url: "https://example.invalid/a.png",
          },
          {
            id: users[1],
            display_name: "제공자 이름",
            avatar_url: "https://example.invalid/a.png",
          },
          { id: users[2], display_name: null, avatar_url: null },
        ],
      );
    });

    it("이미지는 https 로 시작하는 2048자 이하이거나 비어 있고, 상태는 active·suspended 둘뿐이다 — 관리 작업이 넣어도 DB 가 막는다", async (t) => {
      const pglite = await migratedDb(t);
      const update = (column, value) =>
        pglite.query(`update public.profiles set ${column} = $2 where id = $1`, [users[0], value]);
      for (const url of [
        "http://example.invalid/a.png",
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        " https://example.invalid/a.png",
        https(2049),
      ])
        await assert.rejects(
          update("avatar_url", url),
          /profiles_avatar_url_check/,
          url.slice(0, 40),
        );
      await update("avatar_url", https(2048));
      await update("avatar_url", null);
      for (const status of ["deleted", "Active", ""])
        await assert.rejects(update("status", status), /profiles_status_check/, status);
      await assert.rejects(update("status", null), /null value in column "status"/);
      assert.deepEqual(await profileOf(pglite, users[0]), {
        display_name: null,
        avatar_url: null,
        status: "active",
      });
    });

    it("화면 역할은 본인 행이라도 상태·이미지·고친 시각을 고치지 못한다 — 권한 오류(42501)이고 값은 그대로다", async (t) => {
      const pglite = await migratedDb(t);
      await as(pglite, 0);
      for (const [column, value] of [
        ["status", "suspended"],
        ["avatar_url", "https://example.invalid/a.png"],
        ["updated_at", "2000-01-01T00:00:00Z"],
      ])
        await assert.rejects(
          pglite.query(`update public.profiles set ${column} = $2 where id = $1`, [
            users[0],
            value,
          ]),
          { code: "42501", message: /permission denied for table profiles/ },
          column,
        );
      await asAdminTool(pglite);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select status, avatar_url, updated_at > now() - interval '1 hour' as recent from public.profiles where id = $1",
          [users[0]],
        ),
        [{ status: "active", avatar_url: null, recent: true }],
      );
    });

    it("표시 이름을 고치면 고친 시각이 바뀌고, 다른 사람의 고친 시각은 그대로다", async (t) => {
      const pglite = await migratedDb(t);
      // 고친 시각을 지난 시각으로 돌려 둔다. 트리거가 모든 수정에 지금 시각을 적으므로 이 수정만 트리거를 끄고 한다.
      await pglite.exec("alter table public.profiles disable trigger profiles_touch_updated_at");
      await pglite.query("update public.profiles set updated_at = '2000-01-01T00:00:00Z'");
      await pglite.exec("alter table public.profiles enable trigger profiles_touch_updated_at");
      await as(pglite, 0);
      await pglite.query("update public.profiles set display_name = '첫째' where id = $1", [
        users[0],
      ]);
      await asAdminTool(pglite);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select id, updated_at > now() - interval '1 hour' as touched from public.profiles order by id",
        ),
        [
          { id: users[0], touched: true },
          { id: users[1], touched: false },
          { id: users[2], touched: false },
        ],
      );
    });

    it("상태 열의 수정 권한이 열려도 운영자가 아닌 사람의 변경은 트리거가 되돌린다 — 정지된 사람은 스스로 풀지 못하고, JWT 없는 관리 작업과 service_role 은 바꾼다", async (t) => {
      const { pglite } = await teamDb(t);
      // 첫 잠금(열 권한)이 실수로 열린 상황이다. 두 번째 잠금(트리거)만 남는다.
      await pglite.exec("grant update (status) on public.profiles to authenticated");
      const setOwn = async (i, status) => {
        await as(pglite, i);
        const rows = await rowsOf(
          pglite,
          "update public.profiles set status = $2 where id = $1 returning status",
          [users[i], status],
        );
        await asAdminTool(pglite);
        return rows;
      };
      // 오류가 아니라 수정이 통과하고 상태만 그대로다.
      assert.deepEqual(await setOwn(0, "suspended"), [{ status: "active" }]);
      // JWT 없는 관리 작업(SQL 편집기)은 바꾼다.
      await pglite.query("update public.profiles set status = 'suspended' where id = $1", [
        users[1],
      ]);
      assert.equal((await profileOf(pglite, users[1])).status, "suspended");
      // 정지된 사람은 정책이 본인 행 수정을 막는다(오류가 아니라 0행).
      assert.deepEqual(await setOwn(1, "active"), []);
      // service_role 키로 온 서버 작업은 바꾼다.
      await pglite.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await pglite.query("update public.profiles set status = 'active' where id = $1", [users[1]]);
      await asAdminTool(pglite);
      assert.deepEqual(
        (await rowsOf(pglite, "select status from public.profiles order by id")).map(
          (row) => row.status,
        ),
        ["active", "active", "active"],
      );
    });

    it("제공자 정보 도우미는 어느 화면 역할도 부르지 못한다 — 가입 트리거와 마이그레이션만 쓴다", async (t) => {
      const pglite = await migratedDb(t);
      for (const role of ["anon", "authenticated"]) {
        await actAs(pglite, role === "anon" ? null : users[0], role);
        for (const fn of ["display_name_from_metadata", "avatar_url_from_metadata"])
          await assert.rejects(
            pglite.query(`select public.${fn}('{}'::jsonb)`),
            new RegExp(`permission denied for function ${fn}`),
            `${role} ${fn}`,
          );
      }
      await asAdminTool(pglite);
    });

    it("회원 상태는 운영자만 바꾼다 — 운영자가 아니면 권한 오류(42501)이고 로그아웃한 사람은 실행 권한이 없다", async (t) => {
      const { pglite } = await teamDb(t);
      const before = await accountsOf(pglite);
      // 팀의 owner 라도 운영자는 아니다.
      await as(pglite, 0);
      await assert.rejects(setStatus(pglite, users[1], "suspended"), {
        code: "42501",
        message: /운영자만/,
      });
      await actAs(pglite, null, "anon");
      await assert.rejects(
        setStatus(pglite, users[1], "suspended"),
        /permission denied for function admin_set_user_status/,
      );
      // JWT 없는 관리 작업도 운영자가 아니다(SQL 편집기에서는 열을 직접 고친다).
      await asAdminTool(pglite);
      await assert.rejects(setStatus(pglite, users[1], "suspended"), { code: "42501" });
      assert.deepEqual(await accountsOf(pglite), before);
    });

    it("자기 자신·다른 운영자·없는 회원·잘못된 상태는 hint 로 이유를 알리고 아무것도 바꾸지 않는다", async (t) => {
      const { pglite } = await teamDb(t);
      // 운영자가 둘이다. user2 가 부른다.
      await pglite.query("update public.profiles set is_admin = true where id = $1", [users[0]]);
      await addSessions(pglite, users);
      const before = await accountsOf(pglite);
      await as(pglite, 2);
      for (const [target, next, code, hint] of [
        [users[2], "suspended", "P0001", "self"],
        [users[0], "suspended", "P0001", "admin_target"],
        ["00000000-0000-0000-0000-000000000009", "suspended", "P0002", "not_found"],
        [null, "suspended", "P0002", "not_found"],
        [users[1], "deleted", "22023", "invalid_status"],
        [users[1], "SUSPENDED", "22023", "invalid_status"],
        [users[1], "", "22023", "invalid_status"],
        [users[1], null, "22023", "invalid_status"],
      ])
        await assert.rejects(setStatus(pglite, target, next), { code, hint }, `${target} ${next}`);
      await asAdminTool(pglite);
      assert.deepEqual(await accountsOf(pglite), before);
    });

    it("정지하면 상태·로그인 차단(100년 뒤)·그 사람의 세션 삭제를 한꺼번에 하고, 풀면 상태와 로그인 차단을 되돌린다 — 다른 사람의 세션은 남는다", async (t) => {
      const { pglite } = await teamDb(t);
      await addSessions(pglite, [users[0], users[0], users[1], users[2]]);
      await adminSets(pglite, users[0], "suspended");
      assert.deepEqual(await accountsOf(pglite), [
        { id: users[0], status: "suspended", banned: "100y", sessions: 0 },
        { id: users[1], status: "active", banned: null, sessions: 1 },
        { id: users[2], status: "active", banned: null, sessions: 1 },
      ]);
      await adminSets(pglite, users[0], "active");
      // 지운 세션은 돌아오지 않는다. 다시 로그인해야 한다.
      assert.deepEqual(await accountsOf(pglite), [
        { id: users[0], status: "active", banned: null, sessions: 0 },
        { id: users[1], status: "active", banned: null, sessions: 1 },
        { id: users[2], status: "active", banned: null, sessions: 1 },
      ]);
    });

    it("정지된 운영자는 운영자가 아니다 — is_admin() 이 false 라 남의 프로필을 읽지 못하고 회원 상태도 바꾸지 못하며, 풀면 다시 운영자다", async (t) => {
      const { pglite } = await teamDb(t);
      const adminView = async () => {
        await as(pglite, 2);
        const [row] = await rowsOf(
          pglite,
          "select public.is_admin() as admin, (select count(*)::int from public.profiles) as profiles",
        );
        await asAdminTool(pglite);
        return row;
      };
      assert.deepEqual(await adminView(), { admin: true, profiles: 3 });
      // 운영자 함수는 운영자를 정지하지 못하므로 SQL 편집기(JWT 없는 관리 작업)에서 바꾼다.
      await pglite.query("update public.profiles set status = 'suspended' where id = $1", [
        users[2],
      ]);
      assert.deepEqual(await adminView(), { admin: false, profiles: 1 });
      await as(pglite, 2);
      await assert.rejects(setStatus(pglite, users[1], "suspended"), { code: "42501" });
      await asAdminTool(pglite);
      assert.equal((await profileOf(pglite, users[1])).status, "active");
      await pglite.query("update public.profiles set status = 'active' where id = $1", [users[2]]);
      assert.deepEqual(await adminView(), { admin: true, profiles: 3 });
    });

    it("정지된 사람에게 정책 도우미는 빈 목록이다 — 자기 조직의 조직·멤버십·초대·작업·활동과 팀원 프로필을 읽지도 쓰지도 못하고, 본인 프로필만 읽는다", async (t) => {
      const { pglite, acme, personal } = await teamDb(t);
      await as(pglite, 0);
      await addTask(pglite, acme, "팀 작업");
      await pglite.query(
        "insert into public.invitations (org_id, email) values ($1, 'later@example.invalid')",
        [acme],
      );
      await asAdminTool(pglite);
      const view = async () => {
        await as(pglite, 0);
        const [row] = await rowsOf(
          pglite,
          `select
             (select count(*)::int from public.my_org_ids()) as my_orgs,
             (select count(*)::int from public.my_owner_org_ids()) as my_owner_orgs,
             (select count(*)::int from public.organizations) as orgs,
             (select count(*)::int from public.memberships) as members,
             (select count(*)::int from public.invitations) as invitations,
             (select count(*)::int from public.tasks) as tasks,
             (select count(*)::int from public.activities) as activities,
             (select json_agg(id order by id) from public.profiles) as profiles`,
        );
        await asAdminTool(pglite);
        return row;
      };
      // owner 인 user0 은 팀과 개인 조직을 본다. 활동은 초대 보냄 둘·들어옴·작업 만듦의 네 줄이다.
      assert.deepEqual(await view(), {
        my_orgs: 2,
        my_owner_orgs: 2,
        orgs: 2,
        members: 3,
        invitations: 1,
        tasks: 1,
        activities: 4,
        profiles: [users[0], users[1]],
      });
      await adminSets(pglite, users[0], "suspended");
      assert.deepEqual(await view(), {
        my_orgs: 0,
        my_owner_orgs: 0,
        orgs: 0,
        members: 0,
        invitations: 0,
        tasks: 0,
        activities: 0,
        profiles: [users[0]],
      });
      await as(pglite, 0);
      for (const org of [acme, personal[users[0]]])
        await assert.rejects(addTask(pglite, org, "정지 뒤 작업"), /row-level security/, org);
      for (const sql of [
        "update public.tasks set title = '정지 뒤 고침' returning id",
        "delete from public.tasks returning id",
        "delete from public.invitations returning id",
        "update public.memberships set org_role = 'owner' returning user_id",
        "delete from public.memberships where user_id <> $1 returning user_id",
      ])
        assert.deepEqual(await rowsOf(pglite, sql, sql.includes("$1") ? [users[0]] : []), [], sql);
      await asAdminTool(pglite);
      assert.deepEqual(
        await rowsOf(pglite, "select title from public.tasks where org_id = $1", [acme]),
        [{ title: "팀 작업" }],
      );
      assert.deepEqual(await membersOf(pglite, acme), [
        { user_id: users[0], org_role: "owner" },
        { user_id: users[1], org_role: "member" },
      ]);
    });

    it("정지된 사람은 본인 표시 이름을 고치지 못한다 — 오류가 아니라 0행이고 이름은 그대로다", async (t) => {
      const { pglite } = await teamDb(t);
      await adminSets(pglite, users[1], "suspended");
      await as(pglite, 1);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "update public.profiles set display_name = '정지 중' where id = $1 returning id",
          [users[1]],
        ),
        [],
      );
      await asAdminTool(pglite);
      assert.equal((await profileOf(pglite, users[1])).display_name, null);
    });

    it("정지를 풀면 정책 도우미가 다시 조직을 돌려주고 본인 표시 이름도 다시 고친다", async (t) => {
      const { pglite, acme, personal } = await teamDb(t);
      await adminSets(pglite, users[1], "suspended");
      await adminSets(pglite, users[1], "active");
      await as(pglite, 1);
      assert.deepEqual(
        (await rowsOf(pglite, "select id from public.my_org_ids() as id order by id")).map(
          (row) => row.id,
        ),
        [acme, personal[users[1]]].toSorted(),
      );
      assert.deepEqual(
        await rowsOf(
          pglite,
          "update public.profiles set display_name = '돌아옴' where id = $1 returning display_name",
          [users[1]],
        ),
        [{ display_name: "돌아옴" }],
      );
      await asAdminTool(pglite);
    });

    // 정지된 사람의 access token 은 만료 전까지 서명이 맞다(스펙 5). 정책 도우미가 닫는 것은 이미 속한 조직뿐이라
    // 조직에 새로 들어가는 길(팀 만들기·초대 수락)은 따로 본다. 스펙 3.5: 정지된 사람은 조직 데이터에 닿지 못한다.
    it("정지된 사람은 팀을 새로 만들지 못한다 — 주소 이름을 차지하고 owner 가 되는 길이 닫힌다", async (t) => {
      const { pglite } = await teamDb(t);
      await adminSets(pglite, users[1], "suspended");
      await as(pglite, 1);
      // 만든 행을 돌려받는(returning) 요청은 읽기 정책에 걸린다. 돌려받지 않는 요청도 막혀야 한다.
      await assert.rejects(
        pglite.query("insert into public.organizations (slug, name) values ('squat', '차지')"),
        /row-level security/,
      );
      await asAdminTool(pglite);
      assert.deepEqual(
        await rowsOf(pglite, "select slug from public.organizations where slug = 'squat'"),
        [],
      );
    });

    it("정지된 사람은 받은 초대를 수락하지 못한다", async (t) => {
      const pglite = await migratedDb(t);
      await pglite.query("update public.profiles set is_admin = true where id = $1", [users[2]]);
      await createTeamAs(pglite, 0, "acme", "에이크미");
      const [{ id: acme }] = await rowsOf(
        pglite,
        "select id from public.organizations where slug = 'acme'",
      );
      await as(pglite, 0);
      await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
        acme,
        emailOf(1),
      ]);
      await asAdminTool(pglite);
      await adminSets(pglite, users[1], "suspended");
      await as(pglite, 1);
      await assert.rejects(
        pglite.query(
          "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
          [acme, users[1]],
        ),
        /row-level security/,
      );
      await asAdminTool(pglite);
      assert.deepEqual(await membersOf(pglite, acme), [{ user_id: users[0], org_role: "owner" }]);
    });

    it("탈퇴는 로그인한 사람만 한다 — 로그아웃한 사람은 실행 권한이 없고, JWT 에 본인 id 가 없으면 권한 오류(42501)다", async (t) => {
      const { pglite } = await teamDb(t);
      await addSessions(pglite, users);
      const before = await accountRows(pglite);
      await actAs(pglite, null, "anon");
      await assert.rejects(deleteMe(pglite), /permission denied for function delete_my_account/);
      await actAs(pglite, null);
      await assert.rejects(deleteMe(pglite), { code: "42501", message: /로그인한 사람만/ });
      await asAdminTool(pglite);
      assert.deepEqual(await accountRows(pglite), before);
    });

    it("정지된 사람은 탈퇴하지 못한다 — hint suspended 로 거절하고 아무것도 지우지 않으며, 다른 멤버가 있는 팀의 유일한 owner 여도 정지를 먼저 알린다", async (t) => {
      const { pglite } = await teamDb(t);
      await adminSets(pglite, users[0], "suspended");
      await adminSets(pglite, users[1], "suspended");
      const before = await accountRows(pglite);
      // user1 은 팀의 member 이고, user0 은 다른 멤버가 있는 팀의 유일한 owner 다.
      for (const i of [1, 0]) {
        await as(pglite, i);
        await assert.rejects(deleteMe(pglite), { code: "P0001", hint: "suspended" }, `user${i}`);
        await asAdminTool(pglite);
      }
      assert.deepEqual(await accountRows(pglite), before);
    });

    it("다른 멤버가 있는 팀의 유일한 owner 는 탈퇴하지 못한다 — hint sole_owner 로 거절하고 아무것도 지우지 않는다", async (t) => {
      const { pglite } = await teamDb(t);
      await addSessions(pglite, users);
      const before = await accountRows(pglite);
      await as(pglite, 0);
      await assert.rejects(deleteMe(pglite), { code: "P0001", hint: "sole_owner" });
      await asAdminTool(pglite);
      assert.deepEqual(await accountRows(pglite), before);
    });

    it("member 로 있는 팀은 탈퇴를 막지 않는다 — 팀과 owner 는 그대로다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 1);
      await deleteMe(pglite);
      await asAdminTool(pglite);
      assert.deepEqual(await rowsOf(pglite, "select id from auth.users order by id"), [
        { id: users[0] },
        { id: users[2] },
      ]);
      assert.deepEqual(await membersOf(pglite, acme), [{ user_id: users[0], org_role: "owner" }]);
    });

    it("owner 가 둘인 팀은 한 owner 의 탈퇴를 막지 않는다 — 팀은 남은 owner 와 그대로다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 0);
      // 계정을 지우기 전에 남은 owner에게 업무 ADMIN도 인계한다.
      await pglite.query(
        "update public.memberships set org_role = 'owner', sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
        [acme, users[1]],
      );
      await deleteMe(pglite);
      await asAdminTool(pglite);
      assert.deepEqual(await rowsOf(pglite, "select id from auth.users order by id"), [
        { id: users[1] },
        { id: users[2] },
      ]);
      assert.deepEqual(await membersOf(pglite, acme), [{ user_id: users[1], org_role: "owner" }]);
    });

    it("혼자인 팀은 함께 지워지고 본인의 계정·프로필·개인 조직·멤버십·세션이 지워진다 — 다른 사람의 행은 그대로이고 팀에 남은 작업은 만든 사람·담당자만 빈다", async (t) => {
      const { pglite, acme, personal } = await teamDb(t);
      await createTeamAs(pglite, 1, "solo", "혼자");
      const [{ id: solo }] = await rowsOf(
        pglite,
        "select id from public.organizations where slug = 'solo'",
      );
      await as(pglite, 1);
      await addTask(pglite, solo, "혼자인 팀의 작업");
      await addTask(pglite, personal[users[1]], "개인 작업");
      const own = await addTask(pglite, acme, "스스로 맡은 작업", { assignee_id: users[1] });
      await as(pglite, 0);
      const given = await addTask(pglite, acme, "owner 가 맡긴 작업", { assignee_id: users[1] });
      await asAdminTool(pglite);
      await addSessions(pglite, [users[0], users[1], users[1], users[2]]);
      const before = await accountRows(pglite);

      await as(pglite, 1);
      await deleteMe(pglite);
      await asAdminTool(pglite);
      // 지워지는 것: user1 을 가리키는 행, 혼자인 팀, 개인 조직(과 그 조직의 멤버십·작업). 팀에 남은 작업의 user1 은 빈다.
      const gone = new Set([users[1], solo, personal[users[1]]]);
      const left = (id) => (gone.has(id) ? null : id);
      assert.deepEqual(await accountRows(pglite), {
        users: before.users.filter((id) => !gone.has(id)),
        profiles: before.profiles.filter((id) => !gone.has(id)),
        orgs: before.orgs.filter((id) => !gone.has(id)),
        members: before.members.filter(([org, user]) => !gone.has(org) && !gone.has(user)),
        sessions: before.sessions.filter(([user]) => !gone.has(user)),
        tasks: before.tasks
          .filter(([, org]) => !gone.has(org))
          .map(([id, org, by, to]) => [id, org, left(by), left(to)]),
      });
      // 위의 기대값이 빈 비교가 되지 않게, 지워질 것과 남을 것이 실제로 있었는지도 본다.
      assert.deepEqual(
        { orgs: before.orgs.length, sessions: before.sessions.length, tasks: before.tasks.length },
        { orgs: 5, sessions: 4, tasks: 4 },
      );
      assert.deepEqual(
        [await taskOf(pglite, own), await taskOf(pglite, given)].map(
          ({ org_id, title, assignee_id, created_by }) => ({
            org_id,
            title,
            assignee_id,
            created_by,
          }),
        ),
        [
          { org_id: acme, title: "스스로 맡은 작업", assignee_id: null, created_by: null },
          { org_id: acme, title: "owner 가 맡긴 작업", assignee_id: null, created_by: users[0] },
        ],
      );
    });

    it("탈퇴 함수가 비운 JWT claim 은 그 트랜잭션에서만 빈다 — 호출 뒤 같은 연결의 claim 은 원래대로다", async (t) => {
      const { pglite } = await teamDb(t);
      const claimsNow = async () =>
        (
          await rowsOf(
            pglite,
            "select current_setting('request.jwt.claims', true) as claims, auth.uid() as uid, current_user as role",
          )
        )[0];
      await as(pglite, 1);
      const before = await claimsNow();
      assert.equal(before.uid, users[1]);
      await deleteMe(pglite);
      assert.deepEqual(await claimsNow(), before);
      await asAdminTool(pglite);
    });
  });

  // 스펙: polaris/specs/done/team-settings-mail-csp-errors.md 3장 1번·5장. 마이그레이션 20261015000002.
  describe("팀 설정 — 이름 바꾸기·지우기", () => {
    // 관리 작업으로 읽으므로 정책을 거치지 않는다.
    const orgOf = async (pglite, id) =>
      (
        await rowsOf(
          pglite,
          "select slug, name, personal_owner_id from public.organizations where id = $1",
          [id],
        )
      )[0] ?? null;
    // i 번 사람으로 문장 하나를 돌려 RETURNING 행 수를 센다. 끝나면 관리 작업으로 돌아온다.
    const changedAs = async (pglite, i, sql, params) => {
      await as(pglite, i);
      const rows = await rowsOf(pglite, sql, params);
      await asAdminTool(pglite);
      return rows.length;
    };
    const rename = (pglite, i, org, name) =>
      changedAs(pglite, i, "update public.organizations set name = $2 where id = $1 returning id", [
        org,
        name,
      ]);
    const remove = (pglite, i, org) =>
      changedAs(pglite, i, "delete from public.organizations where id = $1 returning id", [org]);
    // 그 조직에 딸린 행 수. 관리 작업으로 센다 — 멤버십이 지워진 뒤 owner 로 세면 정책 때문에 늘 0 이라 아무것도 증명하지 못한다.
    const countsOf = async (pglite, org) =>
      (
        await rowsOf(
          pglite,
          `select
             (select count(*)::int from public.organizations where id = $1) as orgs,
             (select count(*)::int from public.memberships where org_id = $1) as members,
             (select count(*)::int from public.invitations where org_id = $1) as invitations,
             (select count(*)::int from public.tasks where org_id = $1) as tasks,
             (select count(*)::int from public.activities where org_id = $1) as activities`,
          [org],
        )
      )[0];
    const NOTHING = { orgs: 0, members: 0, invitations: 0, tasks: 0, activities: 0 };
    const ACME = { slug: "acme", name: "에이크미", personal_owner_id: null };

    it("팀 owner 는 팀 이름을 바꾼다 — 1행이고 주소는 그대로다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      assert.equal(await rename(pglite, 0, acme, "새 이름"), 1);
      assert.deepEqual(await orgOf(pglite, acme), { ...ACME, name: "새 이름" });
    });

    it("member·조직 밖의 운영자(초대받아 이름은 읽는다)의 이름 바꾸기·지우기는 오류 없이 0행이고 팀은 그대로다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      // user2(운영자)를 초대해 둔다. 수락 전에도 조직 행은 읽는다 — 보이는 행이라도 바꾸지 못해야 한다.
      await as(pglite, 0);
      await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
        acme,
        emailOf(2),
      ]);
      await addTask(pglite, acme, "팀 작업");
      await as(pglite, 2);
      assert.deepEqual(
        await rowsOf(pglite, "select name from public.organizations where id = $1", [acme]),
        [{ name: "에이크미" }],
      );
      await asAdminTool(pglite);
      const before = await countsOf(pglite, acme);
      for (const i of [1, 2]) {
        assert.equal(await rename(pglite, i, acme, "빼앗음"), 0, `user${i} 이름 바꾸기`);
        assert.equal(await remove(pglite, i, acme), 0, `user${i} 지우기`);
      }
      // WHERE·RETURNING 없이 값만 적는 문장은 읽기 정책을 거치지 않는다. 고치기·지우기 정책이 따로 막아야 한다.
      // 두 사람 모두 자기 개인 조직의 owner 다 — 개인 조직도 함께 지켜진다.
      for (const i of [1, 2]) {
        await as(pglite, i);
        await pglite.query("update public.organizations set name = '빼앗음'");
        await pglite.query("delete from public.organizations");
        await asAdminTool(pglite);
      }
      assert.deepEqual(await orgOf(pglite, acme), ACME);
      assert.deepEqual(await countsOf(pglite, acme), before);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select name, count(*)::int as n from public.organizations group by name order by name",
        ),
        [
          { name: "개인 공간", n: 3 },
          { name: "에이크미", n: 1 },
        ],
      );
    });

    it("정지된 owner 는 이름을 바꾸지도 팀을 지우지도 못하고(0행), 다시 활동하면 바꾼다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await pglite.query("update public.profiles set status = 'suspended' where id = $1", [
        users[0],
      ]);
      assert.equal(await rename(pglite, 0, acme, "정지 중"), 0);
      assert.equal(await remove(pglite, 0, acme), 0);
      assert.deepEqual(await orgOf(pglite, acme), ACME);
      // 대조군: 같은 사람이 활동 중이면 같은 문장이 통과한다(0행의 이유가 정지임을 보인다).
      await pglite.query("update public.profiles set status = 'active' where id = $1", [users[0]]);
      assert.equal(await rename(pglite, 0, acme, "돌아옴"), 1);
    });

    it("개인 조직은 주인도 이름을 바꾸거나 지우지 못한다(0행)", async (t) => {
      const { pglite, personal } = await teamDb(t);
      const mine = personal[users[0]];
      const before = await orgOf(pglite, mine);
      assert.equal(before.personal_owner_id, users[0]);
      assert.equal(await rename(pglite, 0, mine, "내 공간"), 0);
      assert.equal(await remove(pglite, 0, mine), 0);
      assert.deepEqual(await orgOf(pglite, mine), before);
      assert.deepEqual(await countsOf(pglite, mine), { ...NOTHING, orgs: 1, members: 1 });
    });

    it("이름 말고 다른 열(주소·개인 조직 주인·id·만든 시각)은 owner 도 바꾸지 못한다 — 권한 오류다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 0);
      for (const set of [
        "slug = 'acme-2'",
        `personal_owner_id = '${users[0]}'`,
        "id = gen_random_uuid()",
        "created_at = now()",
        // 이름과 함께 적어도 문장 전체가 거절된다.
        "name = '새 이름', slug = 'acme-2'",
      ])
        await assert.rejects(
          pglite.query(`update public.organizations set ${set} where id = $1`, [acme]),
          /permission denied/,
          set,
        );
      await asAdminTool(pglite);
      assert.deepEqual(await orgOf(pglite, acme), ACME);
    });

    it("팀 이름은 앞뒤 공백 없이 1~40자다 — owner 의 바꾸기도 DB 제약이 막는다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await as(pglite, 0);
      for (const name of [" x ", "x ", " x", "", "가".repeat(41)])
        await assert.rejects(
          pglite.query("update public.organizations set name = $2 where id = $1", [acme, name]),
          /organizations_name_check/,
          JSON.stringify(name),
        );
      await assert.rejects(
        pglite.query("update public.organizations set name = null where id = $1", [acme]),
        /null value in column "name"/,
      );
      await asAdminTool(pglite);
      assert.deepEqual(await orgOf(pglite, acme), ACME);
      assert.equal(await rename(pglite, 0, acme, "가".repeat(40)), 1);
    });

    it("owner 가 팀을 지우면 멤버십·초대·작업·활동이 함께 지워지고 실패하지 않는다 — 마지막 owner 보호·활동 기록에 걸리지 않고 다른 조직은 그대로다", async (t) => {
      const { pglite, acme, personal } = await teamDb(t);
      await as(pglite, 0);
      await pglite.query("insert into public.invitations (org_id, email) values ($1, $2)", [
        acme,
        emailOf(2),
      ]);
      await addTask(pglite, acme, "맡긴 작업", { assignee_id: users[1] });
      await addTask(pglite, acme, "완료한 작업", { status: "done" });
      await addTask(pglite, personal[users[0]], "owner 개인 작업");
      await as(pglite, 1);
      await addTask(pglite, acme, "멤버가 만든 작업");
      await addTask(pglite, personal[users[1]], "멤버 개인 작업");
      await asAdminTool(pglite);
      const others = async () => ({
        orgs: await rowsOf(
          pglite,
          "select id, slug, name from public.organizations where id <> $1 order by id",
          [acme],
        ),
        members: await rowsOf(
          pglite,
          "select org_id, user_id, org_role from public.memberships where org_id <> $1 order by org_id, user_id",
          [acme],
        ),
        tasks: await rowsOf(
          pglite,
          "select org_id, title from public.tasks where org_id <> $1 order by org_id, title",
          [acme],
        ),
        activities: await rowsOf(
          pglite,
          "select org_id, kind, actor_id, task_title from public.activities where org_id <> $1 order by org_id, kind, task_title",
          [acme],
        ),
      });
      const othersBefore = await others();
      // 지울 것이 실제로 있어야 0 이 의미를 갖는다. owner 는 user0 한 명뿐이다(마지막 owner 보호가 걸리는 모양).
      const before = await countsOf(pglite, acme);
      assert.deepEqual(
        { ...before, activities: before.activities > 0 },
        { orgs: 1, members: 2, invitations: 1, tasks: 3, activities: true },
      );
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select user_id from public.memberships where org_id = $1 and org_role = 'owner'",
          [acme],
        ),
        [{ user_id: users[0] }],
      );

      assert.equal(await remove(pglite, 0, acme), 1);

      assert.deepEqual(await countsOf(pglite, acme), NOTHING);
      // 다른 조직의 행·기록은 한 줄도 바뀌지 않는다(지우는 동안 남긴 기록도 없다).
      assert.deepEqual(await others(), othersBefore);
      assert.equal(othersBefore.orgs.length, 3);
      // 남은 조직에서는 마지막 owner 보호가 그대로다.
      await as(pglite, 0);
      await assert.rejects(
        pglite.query("delete from public.memberships where org_id = $1", [personal[users[0]]]),
        /owner 가 한 명 이상/,
      );
      await asAdminTool(pglite);
    });

    it("owner 가 둘이면 어느 owner 든 팀을 지운다", async (t) => {
      for (const deleter of [0, 1]) {
        const { pglite, acme } = await teamDb(t);
        await as(pglite, 0);
        await pglite.query(
          "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
          [acme, users[1]],
        );
        await asAdminTool(pglite);
        assert.equal(await remove(pglite, deleter, acme), 1, `user${deleter}`);
        assert.deepEqual(await countsOf(pglite, acme), NOTHING, `user${deleter}`);
      }
    });

    it("이름까지 맞춰 지우면 그새 바뀐 이름으로는 지워지지 않는다(0행) — 서버의 deleteTeam 이 쓰는 모양", async (t) => {
      const { pglite, acme } = await teamDb(t);
      assert.equal(await rename(pglite, 0, acme, "바뀐 이름"), 1);
      const removeNamed = (name) =>
        changedAs(
          pglite,
          0,
          "delete from public.organizations where id = $1 and name = $2 returning id",
          [acme, name],
        );
      assert.equal(await removeNamed("에이크미"), 0);
      assert.equal((await countsOf(pglite, acme)).orgs, 1);
      assert.equal(await removeNamed("바뀐 이름"), 1);
    });

    it("로그아웃한 사람은 팀 이름을 바꾸거나 팀을 지우지 못한다 — 권한 오류다", async (t) => {
      const { pglite, acme } = await teamDb(t);
      await actAs(pglite, null, "anon");
      await assert.rejects(
        pglite.query("update public.organizations set name = '익명' where id = $1", [acme]),
        /permission denied/,
      );
      await assert.rejects(
        pglite.query("delete from public.organizations where id = $1", [acme]),
        /permission denied/,
      );
      await asAdminTool(pglite);
      assert.deepEqual(await orgOf(pglite, acme), ACME);
    });
  });
});

// 마이그레이션은 재실행에 안전하게 쓴다(if not exists·drop ... if exists 뒤 create). 이력 표 없이 적용한 DB 는
// db-push 가 모든 파일을 한 번 더 돌리므로, 두 번 적용해도 실패하지 않고 화면 역할의 접근이 그대로여야 한다.
// ────────────────────────────────────────────────────────────────
// SOL RADAR 표(20261018000001·20261019000001~07) — 업무 역할(sol_role)·조직 격리(G5)·복합 FK·감사 트리거.
// 근거: docs/04-DATABASE.md §3 권한 열·§5, docs/09-SECURITY.md RBAC, docs/11-TESTING.md §3 G5·§4 Phase 1.
// 장면(G5 조합): org-01 {ADMIN(owner)·SALES·ANALYST·VIEWER}, org-02 {owner 이지만 VIEWER}, 운영자(is_admin, 비멤버), anon.
// PGlite 에는 service_role 이 없다. worker·seed 는 JWT 없는 관리 작업(reset role + 빈 claims)으로 흉내 낸다 —
// 트리거는 JWT 가 없으면 관리 작업으로 보고 넣는 값을 그대로 쓴다(20261019000001 §4·§5, 20261019000007).
// ────────────────────────────────────────────────────────────────
describe("SOL RADAR 표 정책 — 업무 역할·조직 격리 (Phase 1)", () => {
  const ORG1 = "0e000000-0000-0000-0000-000000000001"; // org-01 솔리데오
  const ORG2 = "0e000000-0000-0000-0000-000000000002"; // org-02 격리 조직
  const WHO = {
    admin: users[0], // org-01 owner + ADMIN(데모 admin@soltech.invalid 과 같은 조합)
    sales: users[1], // org-01 SALES
    operator: users[2], // 운영자(profiles.is_admin). 어느 조직에도 없다
    analyst: "00000000-0000-0000-0000-000000000004", // org-01 ANALYST
    viewer: "00000000-0000-0000-0000-000000000005", // org-01 VIEWER
    outsider: "00000000-0000-0000-0000-000000000006", // org-02 owner + VIEWER
    invitee: "00000000-0000-0000-0000-000000000007", // 아직 어느 조직에도 없다
  };
  const EMAIL = {
    admin: "user0@example.invalid",
    sales: "user1@example.invalid",
    operator: "user2@example.invalid",
    analyst: "analyst@example.invalid",
    viewer: "viewer@example.invalid",
    outsider: "viewer@other.invalid",
    invitee: "invitee@example.invalid",
  };
  const BID1 = "b1d00000-0000-0000-0000-000000000001";
  const BID2 = "b1d00000-0000-0000-0000-000000000002";
  const REV1 = "be500000-0000-0000-0000-000000000001"; // BID1 의 revision 1
  const REV2 = "be500000-0000-0000-0000-000000000002"; // BID2 의 revision 1
  const EXT1 = "e0000000-0000-0000-0000-000000000001";
  const PROFILE1 = "c0000000-0000-0000-0000-000000000001"; // org-01 revision 1
  const PROFILE2 = "c0000000-0000-0000-0000-000000000002"; // org-02 revision 1
  const RUN1 = "a0000000-0000-0000-0000-000000000001"; // org-01 완료 run(권고 BID)
  const RUN2 = "a0000000-0000-0000-0000-000000000002"; // org-02 완료 run
  const DEPT1 = "d0000000-0000-0000-0000-000000000011";
  const TITLE1 = "d0000000-0000-0000-0000-000000000021";
  const MEMBER1 = "d0000000-0000-0000-0000-000000000001"; // org-01 직원
  const REVIEW1 = "f0000000-0000-0000-0000-000000000001";
  const REVIEW2 = "f0000000-0000-0000-0000-000000000002";
  const NOTE_ADMIN = "e1000000-0000-0000-0000-000000000001";
  const NOTE_VIEWER = "e1000000-0000-0000-0000-000000000002";
  const NOTE_OUTSIDER = "e1000000-0000-0000-0000-000000000003";
  const INGEST1 = "e2000000-0000-0000-0000-000000000001";

  const BID_TABLES = [
    "bid_notices",
    "bid_revisions",
    "bid_documents",
    "bid_structured_requirements",
    "requirement_extractions",
  ];
  const ORG_TABLES = [
    "company_profiles",
    "score_runs",
    "score_factors",
    "qualification_checks",
    "requirement_assessments",
    "bid_reviews",
    "assignments",
    "audit_logs",
    "notifications",
  ];
  const OPS_TABLES = ["ingest_runs", "ingest_errors", "eval_runs"];
  const SOL_TABLES = [...BID_TABLES, ...ORG_TABLES, ...OPS_TABLES, "outbox_events"];

  const as = (pglite, who) => actAs(pglite, WHO[who], "authenticated", EMAIL[who]);
  const asAnon = (pglite) => actAs(pglite, null, "anon");
  // JWT 없는 관리 작업 — worker·seed(service role)·SQL 편집기의 자리. RLS 를 거치지 않는다.
  const asWorker = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', '', false)");
  };
  const rowsOf = async (pglite, sql, params = []) => (await pglite.query(sql, params)).rows;
  const countOf = async (pglite, table, where = "true", params = []) =>
    (
      await rowsOf(pglite, `select count(*)::int as n from public.${table} where ${where}`, params)
    )[0].n;
  const rejectsWith = (promise, constraint, message) =>
    assert.rejects(promise, new RegExp(constraint), message);
  const PERMISSION = /permission denied for table/;
  const POLICY = /violates row-level security policy/;

  // 두 조직·공고 두 건·완료 run·결정·배정·운영 표·알림을 seed 처럼 넣는다(JWT 없음 → 감사의 행위자는 비어 있다).
  const seed = async (pglite) => {
    await asWorker(pglite);
    for (const who of ["analyst", "viewer", "outsider", "invitee"])
      await pglite.query("insert into auth.users values ($1, $2)", [WHO[who], EMAIL[who]]);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [WHO.operator]);
    await pglite.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'org-01', '솔리데오', true), ($2, 'org-02', '격리 조직', true)",
      [ORG1, ORG2],
    );
    await pglite.query(
      `insert into public.memberships (org_id, user_id, org_role, sol_role) values
         ($1, $3, 'owner', 'ADMIN'), ($1, $4, 'member', 'SALES'), ($1, $5, 'member', 'ANALYST'),
         ($1, $6, 'member', 'VIEWER'), ($2, $7, 'owner', 'VIEWER')`,
      [ORG1, ORG2, WHO.admin, WHO.sales, WHO.analyst, WHO.viewer, WHO.outsider],
    );
    // 인력(배정의 복합 FK 대상). "솔리데오 카탈로그·가입 신고" 시험과 같은 최소 행이다.
    await pglite.query(
      "insert into public.departments (id, org_id, code, name, source_count, target_count, is_demo) values ($1, $2, 'SOL-D001', '시험부서', 1, 1, true)",
      [DEPT1, ORG1],
    );
    await pglite.query(
      "insert into public.job_titles (id, org_id, code, label, sort_order) values ($1, $2, 'SOL-J007', '팀장', 7)",
      [TITLE1, ORG1],
    );
    await pglite.query(
      "insert into public.team_members (id, org_id, person_code, name, gender, department_id, job_title_id, portrait_path, is_demo) values ($1, $2, 'SOL-P0001', '김민준', 'MALE', $3, $4, '/demo/people/SOL-P0001.png', true)",
      [MEMBER1, ORG1, DEPT1, TITLE1],
    );
    // 공고(공용) 두 건과 첫 revision. 첨부·구조화 자격·추출은 BID1 에만.
    await pglite.query(
      `insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, source_url, content_hash, is_demo) values
         ($1, 'fixture', 'DEMO-2026-0001', '클라우드 통합 플랫폼 구축', '시험기관', 'NOTICE', 'OPEN', 1200000000, 'https://fixture.invalid/0001', 'hash-0001', true),
         ($2, 'fixture', 'DEMO-2026-0002', '데이터 분석 시스템 고도화', '시험기관', 'NOTICE', 'OPEN', 800000000, 'https://fixture.invalid/0002', 'hash-0002', true)`,
      [BID1, BID2],
    );
    await pglite.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $3, 1, '{}', '{}', 'sum-0001'), ($2, $4, 1, '{}', '{}', 'sum-0002')",
      [REV1, REV2, BID1, BID2],
    );
    await pglite.query(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url) values ($1, $2, '제안요청서.pdf', 'https://www.g2b.go.kr/doc/0001')",
      [BID1, REV1],
    );
    await pglite.query(
      "insert into public.bid_structured_requirements (bid_id, revision_id, kind, seq, code, name, value, source_operation) values ($1, $2, 'LICENSE_LIMIT', 0, '1468', '소프트웨어사업자', '{}', 'getBidPblancListInfoServcPPSSrch')",
      [BID1, REV1],
    );
    await pglite.query(
      "insert into public.requirement_extractions (id, bid_id, revision_id, provider, model_name, prompt_version, prompt_hash, schema_version, status) values ($1, $2, $3, 'MOCK', 'mock', 'v0.1', 'p-0001', 'requirement-extraction/v0.1', 'COMPLETED')",
      [EXT1, BID1, REV1],
    );
    // 회사 프로필 — 두 조직의 revision 1.
    await pglite.query(
      "insert into public.company_profiles (id, org_id, revision, name) values ($1, $3, 1, '솔리데오'), ($2, $4, 1, '격리 조직')",
      [PROFILE1, PROFILE2, ORG1, ORG2],
    );
    // 분석 — 두 조직의 완료 run 하나씩과 자식 행 하나씩.
    for (const [run, org, profile] of [
      [RUN1, ORG1, PROFILE1],
      [RUN2, ORG2, PROFILE2],
    ]) {
      await pglite.query(
        `insert into public.score_runs (id, org_id, bid_id, revision_id, company_profile_id, profile_revision, extraction_id, algorithm_version,
           run_mode, ai_provider, status, score, recommendation, recommendation_basis, input_snapshot, input_snapshot_hash)
         values ($1, $2, $3, $4, $5, 1, $6, 'sol-v0.1.0', 'MOCK', 'MOCK', 'COMPLETED', 82, 'BID', 'RULES_ONLY',
           '{"schemaVersion":"analysis-input/v0.1"}', 'snap-0001')`,
        [run, org, BID1, REV1, profile, EXT1],
      );
      await pglite.query(
        "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'skillMatch', 25, 30)",
        [run, org],
      );
      await pglite.query(
        "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'LICENSE_1468', '소프트웨어사업자', 'SATISFIED', '보유 면허와 일치', 'API_FIELD')",
        [run, org, BID1, REV1],
      );
      await pglite.query(
        "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'qualifications[0]', 'QUALIFICATION', 'SATISFIED', 'API_FIELD')",
        [run, org],
      );
    }
    // 결정 이력(검토자 없음) — 트리거가 run 의 권고를 옮겨 적는다.
    await pglite.query(
      `insert into public.bid_reviews (id, org_id, bid_id, revision_id, score_run_id, decision, reason) values
         ($1, $3, $5, $6, $7, 'BID', '시드 결정 — 권고와 같다'), ($2, $4, $5, $6, $8, 'WATCH', '시드 결정 — 권고와 다르다')`,
      [REVIEW1, REVIEW2, ORG1, ORG2, BID1, REV1, RUN1, RUN2],
    );
    await pglite.query(
      "insert into public.assignments (org_id, bid_id, member_id, starts_at, ends_at, allocation_percent) values ($1, $2, $3, '2026-11-01', '2027-04-30', 50)",
      [ORG1, BID1, MEMBER1],
    );
    // 운영 표·outbox·알림·감사(SEED)·평가.
    await pglite.query(
      "insert into public.ingest_runs (id, source, run_mode, job_key, trigger, batch, status, finished_at) values ($1, 'fixture', 'MOCK', 'ingest:fixture:seed', 'DEMO', 'SEED', 'PARTIAL', now())",
      [INGEST1],
    );
    await pglite.query(
      "insert into public.ingest_errors (ingest_run_id, source_key, error_code, redacted_detail) values ($1, 'fixture', 'SCHEMA_INVALID', 'FX-12 격리')",
      [INGEST1],
    );
    await pglite.query(
      "insert into public.eval_runs (dataset_version, dataset_sha256, system_id, split, git_commit) values ('v0.1', 'sha-eval', 'E0', 'dev', '654c6b1')",
    );
    await pglite.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values (null, 'bid_notice', $1, 'BID_CREATED', 'fixture:DEMO-2026-0001:1:BID_CREATED')",
      [BID1],
    );
    await pglite.query(
      `insert into public.notifications (id, org_id, user_id, type, idempotency_key) values
         ($1, $4, $6, 'BID_CREATED', 'n-admin'), ($2, $4, $7, 'BID_CREATED', 'n-viewer'), ($3, $5, $8, 'BID_CREATED', 'n-outsider')`,
      [NOTE_ADMIN, NOTE_VIEWER, NOTE_OUTSIDER, ORG1, ORG2, WHO.admin, WHO.viewer, WHO.outsider],
    );
    await pglite.query(
      "insert into public.audit_logs (org_id, action, target_type, target_id) values ($1, 'SEED', 'organization', $1), ($2, 'SEED', 'organization', $2)",
      [ORG1, ORG2],
    );
    return pglite;
  };
  const solDb = async (t) => seed(await migratedDb(t));

  // 분석 요청 한 줄. fields 는 열 이름 그대로 덧붙인다.
  const requestRun = (pglite, org, profile, version, fields = {}) => {
    const columns = [
      "org_id",
      "bid_id",
      "revision_id",
      "company_profile_id",
      "profile_revision",
      "algorithm_version",
      "run_mode",
      "ai_provider",
      ...Object.keys(fields),
    ];
    const values = [org, BID1, REV1, profile, 1, version, "MOCK", "MOCK", ...Object.values(fields)];
    return rowsOf(
      pglite,
      `insert into public.score_runs (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id, status, requested_by`,
      values,
    );
  };
  // 결정 한 줄. 기본은 org-01·BID1·REV1·run 없음·BID.
  const decide = (pglite, fields = {}) => {
    const row = {
      org_id: ORG1,
      bid_id: BID1,
      revision_id: REV1,
      decision: "BID",
      reason: "시험용 결정 사유 — 열 글자 이상",
      ...fields,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    return rowsOf(
      pglite,
      `insert into public.bid_reviews (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      values,
    );
  };

  it("G5 — org-02 VIEWER 는 org-01 의 조직 표 아홉 개를 0행으로 보고 자기 조직 행만 읽는다 — 회사 프로필·분석 run·점수 요소·자격 판정·항목 판정·결정 이력·인력 배정·감사·알림", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "outsider");
    const seen = {};
    for (const table of ORG_TABLES) {
      assert.equal(await countOf(pglite, table, "org_id = $1", [ORG1]), 0, `${table}: org-01 행`);
      assert.equal(
        await countOf(pglite, table, "org_id <> $1", [ORG2]),
        0,
        `${table}: 다른 조직 행`,
      );
      seen[table] = await countOf(pglite, table);
    }
    assert.deepEqual(seen, {
      company_profiles: 1,
      score_runs: 1,
      score_factors: 1,
      qualification_checks: 1,
      requirement_assessments: 1,
      bid_reviews: 1,
      assignments: 0,
      // VIEWER 라 자기 조직의 감사도 못 본다. 알림은 본인 것 하나.
      audit_logs: 0,
      notifications: 1,
    });
  });

  it("G5 — org-01 의 네 역할은 자기 조직의 조직 표를 같은 만큼 읽고 org-02 행은 0행이다 — 감사는 ADMIN 만, 알림은 본인 것만", async (t) => {
    const pglite = await solDb(t);
    const shared = ORG_TABLES.filter((table) => !["audit_logs", "notifications"].includes(table));
    for (const who of ["admin", "sales", "analyst", "viewer"]) {
      await as(pglite, who);
      for (const table of shared) {
        assert.equal(await countOf(pglite, table, "org_id = $1", [ORG1]), 1, `${who} ${table}`);
        assert.equal(
          await countOf(pglite, table, "org_id = $1", [ORG2]),
          0,
          `${who} ${table} org-02`,
        );
      }
      assert.equal(
        await countOf(pglite, "audit_logs"),
        who === "admin" ? 4 : 0,
        `${who} audit_logs`,
      );
      assert.equal(
        await countOf(pglite, "notifications"),
        ["admin", "viewer"].includes(who) ? 1 : 0,
        `${who} notifications`,
      );
    }
  });

  it("공고 다섯 표는 조직 소유가 아니다 — org-02 VIEWER 와 비멤버 운영자도 활동 중이면 읽고, ADMIN 이라도 넣기·고치기·지우기는 권한 오류다", async (t) => {
    const pglite = await solDb(t);
    const expected = {
      bid_notices: 2,
      bid_revisions: 2,
      bid_documents: 1,
      bid_structured_requirements: 1,
      requirement_extractions: 1,
    };
    for (const who of ["outsider", "operator", "viewer", "admin"]) {
      await as(pglite, who);
      for (const table of BID_TABLES)
        assert.equal(await countOf(pglite, table), expected[table], `${who} ${table}`);
    }
    await as(pglite, "admin");
    for (const table of BID_TABLES)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set created_at = now()`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });

  it("운영자(profiles.is_admin)는 멤버가 아닌 조직의 SOL 표를 하나도 읽지 못한다 — 조직 표 아홉 개와 운영 표 셋 모두 0행이고 정책 도우미도 빈 목록이다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "operator");
    for (const table of [...ORG_TABLES, ...OPS_TABLES])
      assert.equal(await countOf(pglite, table), 0, table);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST', 'VIEWER']) as org",
      ),
      [],
    );
  });

  it("outbox_events 는 내부 표다 — ADMIN·VIEWER·org-02·로그아웃 누구도 읽지도 쓰지도 못한다(권한 오류)", async (t) => {
    const pglite = await solDb(t);
    for (const who of ["admin", "viewer", "outsider", "anon"]) {
      if (who === "anon") await asAnon(pglite);
      else await as(pglite, who);
      for (const sql of [
        "select * from public.outbox_events",
        "insert into public.outbox_events (aggregate_type, aggregate_id, event_type, idempotency_key) values ('bid_notice', gen_random_uuid(), 'BID_CREATED', 'k')",
        "update public.outbox_events set status = 'PROCESSED'",
        "delete from public.outbox_events",
      ])
        await assert.rejects(
          pglite.query(sql),
          /permission denied for table outbox_events/,
          `${who}: ${sql}`,
        );
    }
  });

  it("로그아웃한 사람(anon)은 SOL 표 열여덟 개를 읽지도 쓰지도 못하고 정책 도우미 my_sol_org_ids 도 부르지 못한다 — 모두 권한 오류", async (t) => {
    const pglite = await solDb(t);
    await asAnon(pglite);
    for (const table of SOL_TABLES)
      await assert.rejects(
        pglite.query(`select * from public.${table}`),
        new RegExp(`permission denied for table ${table}`),
      );
    await assert.rejects(
      pglite.query("select public.my_sol_org_ids(array['ADMIN'])"),
      /permission denied for function my_sol_org_ids/,
    );
    for (const [sql, params] of [
      [
        "insert into public.company_profiles (org_id, revision, name) values ($1, 2, '로그아웃 개정')",
        [ORG1],
      ],
      [
        "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
        [ORG1, BID1, REV1, PROFILE1],
      ],
      [
        "insert into public.bid_reviews (org_id, bid_id, revision_id, decision, reason) values ($1, $2, $3, 'BID', '로그아웃 상태의 결정 시도')",
        [ORG1, BID1, REV1],
      ],
      ["update public.notifications set read_at = now()", []],
      [
        "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
        [ORG1, WHO.viewer],
      ],
    ])
      await assert.rejects(pglite.query(sql, params), PERMISSION, sql);
  });

  it("정지된 회원(profiles.status='suspended')은 공고도 조직 표도 운영 표도 0행이고 my_sol_org_ids 는 빈 목록이다 — 쓰기는 정책 오류이고 정지를 풀면 다시 읽는다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    await pglite.query("update public.profiles set status = 'suspended' where id = $1", [
      WHO.admin,
    ]);
    await as(pglite, "admin");
    for (const table of [...BID_TABLES, ...ORG_TABLES, ...OPS_TABLES])
      assert.equal(await countOf(pglite, table), 0, table);
    assert.deepEqual(
      await rowsOf(pglite, "select public.my_sol_org_ids(array['ADMIN']) as org"),
      [],
    );
    await assert.rejects(
      pglite.query(
        "insert into public.company_profiles (org_id, revision, name) values ($1, 2, '정지 중 개정')",
        [ORG1],
      ),
      POLICY,
    );
    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.1"), POLICY);
    await asWorker(pglite);
    await pglite.query("update public.profiles set status = 'active' where id = $1", [WHO.admin]);
    await as(pglite, "admin");
    assert.equal(await countOf(pglite, "bid_notices"), 2);
    assert.equal(await countOf(pglite, "company_profiles"), 1);
    assert.equal(await countOf(pglite, "ingest_runs"), 1);
    assert.deepEqual(await rowsOf(pglite, "select public.my_sol_org_ids(array['ADMIN']) as org"), [
      { org: ORG1 },
    ]);
  });

  it("my_sol_org_ids(roles) 는 부른 사람이 그 역할 중 하나로 속한 조직만 돌려준다 — owner 여도 역할이 다르면 빈 목록이다", async (t) => {
    const pglite = await solDb(t);
    const orgsOf = async (who, roles) => {
      await as(pglite, who);
      return (await rowsOf(pglite, "select public.my_sol_org_ids($1::text[]) as org", [roles])).map(
        (row) => row.org,
      );
    };
    assert.deepEqual(await orgsOf("admin", ["ADMIN"]), [ORG1]);
    assert.deepEqual(await orgsOf("admin", ["SALES", "ANALYST", "VIEWER"]), []);
    assert.deepEqual(await orgsOf("sales", ["ADMIN", "SALES"]), [ORG1]);
    assert.deepEqual(await orgsOf("sales", ["ADMIN"]), []);
    assert.deepEqual(await orgsOf("analyst", ["ADMIN", "SALES", "ANALYST"]), [ORG1]);
    assert.deepEqual(await orgsOf("viewer", ["ADMIN", "SALES", "ANALYST"]), []);
    assert.deepEqual(await orgsOf("outsider", ["VIEWER"]), [ORG2]);
    // org-02 의 owner 지만 ADMIN 이 아니다(ADR-021: 구성원 관리는 owner 가 아니라 ADMIN 기준).
    assert.deepEqual(await orgsOf("outsider", ["ADMIN"]), []);
    assert.deepEqual(await orgsOf("operator", ["ADMIN", "SALES", "ANALYST", "VIEWER"]), []);
  });

  it("운영 표(수집 run·수집 오류·평가 결과)는 어느 조직에서든 ADMIN 인 사람만 읽는다 — SALES·ANALYST·VIEWER·org-02 는 0행이고 ADMIN 도 쓰지는 못한다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "admin");
    for (const table of OPS_TABLES) assert.equal(await countOf(pglite, table), 1, table);
    for (const who of ["sales", "analyst", "viewer", "outsider"]) {
      await as(pglite, who);
      for (const table of OPS_TABLES)
        assert.equal(await countOf(pglite, table), 0, `${who} ${table}`);
    }
    // 공용 표라 org-02 의 ADMIN 도 읽는다.
    await asWorker(pglite);
    await pglite.query(
      "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
      [ORG2, WHO.outsider],
    );
    await as(pglite, "outsider");
    for (const table of OPS_TABLES)
      assert.equal(await countOf(pglite, table), 1, `org-02 ADMIN ${table}`);
    await as(pglite, "admin");
    for (const table of OPS_TABLES)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set id = id`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });

  // 20261019000019(N8 보안 점검 W1, 계획 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §5): ingest_runs 는 조직 구분 없는
  // 공용 표라 어느 조직의 ADMIN 이든 행을 읽는다. 그래서 다른 조직이 남긴 job_key·idempotency_key(조직 id 가 들어 있다)·
  // requested_by(사람 id)·params 가 보였다. 화면 역할의 SELECT 를 열 단위로 줄여 그 넷을 닫는다. 행 정책은 그대로다.
  // 요청자는 이제 조직 소유 감사(audit_logs INGEST_MANUAL)의 actor_id 로 읽는다(ingestion-admin.repo findManualRequesters).
  describe("수집 run 열 단위 읽기 (20261019000019, N8 W1)", () => {
    const INGEST_RUN_VISIBLE = [
      "id",
      "source",
      "run_mode",
      "trigger",
      "batch",
      "cursor",
      "status",
      "summary",
      "quota_used",
      "started_at",
      "finished_at",
    ];
    const INGEST_RUN_HIDDEN = ["job_key", "idempotency_key", "requested_by", "params"];
    const INGEST_DENIED = { code: "42501", message: /permission denied for table ingest_runs/ };
    const MANUAL1 = "e2000000-0000-0000-0000-000000000002";
    const VISIBLE_SQL = `select ${INGEST_RUN_VISIBLE.join(", ")} from public.ingest_runs order by started_at, id`;

    // 숨길 열을 모두 채운 org-01 수동 run 하나와 그 감사(INGEST_MANUAL, 행위자 SALES). 다른 조직 ADMIN 이 읽는 대상이다.
    const seedManualRun = async (pglite) => {
      await asWorker(pglite);
      await pglite.query(
        `insert into public.ingest_runs (id, source, run_mode, job_key, trigger, batch, params, status, requested_by, idempotency_key, started_at)
         values ($1, 'fixture', 'MOCK', $2, 'MANUAL', 'SEED', '{"note":"hidden"}', 'RUNNING', $3, $4, now() + interval '1 minute')`,
        [MANUAL1, `manual:${ORG1}:req-w1`, WHO.sales, `${ORG1}:req-w1`],
      );
      await pglite.query(
        "insert into public.audit_logs (org_id, actor_id, action, target_type, target_id) values ($1, $2, 'INGEST_MANUAL', 'ingest_run', $3)",
        [ORG1, WHO.sales, MANUAL1],
      );
    };
    // org-02 owner(VIEWER)를 org-02 의 ADMIN 으로 올린다. 공용 표라 이 사람도 org-01 run 행을 읽는다.
    const promoteOrg2Admin = async (pglite) => {
      await asWorker(pglite);
      await pglite.query(
        "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
        [ORG2, WHO.outsider],
      );
    };
    const w1Db = async (t) => {
      const pglite = await solDb(t);
      await seedManualRun(pglite);
      await promoteOrg2Admin(pglite);
      return pglite;
    };
    const ADMINS = [
      ["org-01 ADMIN", "admin"],
      ["org-02 ADMIN", "outsider"],
    ];

    it("① 허용 열 열한 개만 고르면 org-01 ADMIN 과 org-02 ADMIN 모두 두 run 을 그 열 그대로 읽는다 — 행 정책은 그대로라 SALES·ANALYST·VIEWER 는 같은 질의가 오류 없이 0행이다", async (t) => {
      const pglite = await w1Db(t);
      await asWorker(pglite);
      const expected = await rowsOf(pglite, VISIBLE_SQL);
      assert.deepEqual(
        expected.map((row) => row.id),
        [INGEST1, MANUAL1],
      );
      for (const [label, who] of ADMINS) {
        await as(pglite, who);
        const rows = await rowsOf(pglite, VISIBLE_SQL);
        assert.deepEqual(rows, expected, label);
        assert.deepEqual(Object.keys(rows[0]), INGEST_RUN_VISIBLE, `${label} 열`);
      }
      for (const who of ["sales", "analyst", "viewer"]) {
        await as(pglite, who);
        assert.deepEqual(await rowsOf(pglite, VISIBLE_SQL), [], who);
      }
    });

    it("② 숨긴 열(job_key·idempotency_key·requested_by·params)은 org-01·org-02 ADMIN 모두 하나씩 고르면 권한 오류(42501)이고, 그 열로 거르기와 select * 도 권한 오류다", async (t) => {
      const pglite = await w1Db(t);
      for (const [label, who] of ADMINS) {
        await as(pglite, who);
        for (const column of INGEST_RUN_HIDDEN) {
          await assert.rejects(
            pglite.query(`select ${column} from public.ingest_runs`),
            INGEST_DENIED,
            `${label} select ${column}`,
          );
          await assert.rejects(
            pglite.query(`select id, ${column} from public.ingest_runs where id = $1`, [MANUAL1]),
            INGEST_DENIED,
            `${label} select id, ${column}`,
          );
          // PostgREST 의 ?<열>=eq.<값> 필터 자리. 숨긴 열 값을 짐작해 맞혀 보는 길도 닫힌다.
          await assert.rejects(
            pglite.query(`select id from public.ingest_runs where ${column} is not null`),
            INGEST_DENIED,
            `${label} where ${column}`,
          );
        }
        await assert.rejects(
          pglite.query("select * from public.ingest_runs"),
          INGEST_DENIED,
          `${label} select *`,
        );
      }
    });

    it("② 화면 역할의 ingest_runs 권한은 authenticated 의 열 단위 SELECT 열한 개뿐이다 — 표 단위 권한은 없고 anon 에는 아무것도 없다", async (t) => {
      const pglite = await solDb(t);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='ingest_runs' and grantee in ('anon','authenticated')",
        ),
        [],
      );
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name='ingest_runs' and grantee in ('anon','authenticated') order by 1,2,3",
        ),
        [...INGEST_RUN_VISIBLE].sort().map((column_name) => ({
          grantee: "authenticated",
          column_name,
          privilege_type: "SELECT",
        })),
      );
    });

    it("③ latest_ingest_run(security definer)은 열 권한과 상관없이 그대로 돈다 — org-01 ADMIN·org-02 ADMIN·SALES 모두 최신 fixture run 한 줄의 상태·시각·요약을 받는다", async (t) => {
      const pglite = await w1Db(t);
      await asWorker(pglite);
      const [latest] = await rowsOf(
        pglite,
        "select status, started_at, finished_at, summary from public.ingest_runs where id = $1",
        [MANUAL1],
      );
      for (const who of ["admin", "outsider", "sales"]) {
        await as(pglite, who);
        assert.deepEqual(
          await rowsOf(pglite, "select * from public.latest_ingest_run('demo')"),
          [latest],
          who,
        );
      }
    });

    it("④ 로그아웃(anon)은 ingest_runs 를 허용 열로도 숨긴 열로도 읽지 못한다 — 모두 권한 오류(42501)다", async (t) => {
      const pglite = await w1Db(t);
      await asAnon(pglite);
      for (const sql of [
        VISIBLE_SQL,
        "select id from public.ingest_runs",
        "select count(*) from public.ingest_runs",
        "select * from public.ingest_runs",
        ...INGEST_RUN_HIDDEN.map((column) => `select ${column} from public.ingest_runs`),
      ])
        await assert.rejects(pglite.query(sql), INGEST_DENIED, sql);
    });

    it("요청자는 조직 소유 감사(INGEST_MANUAL·ingest_run)로 읽는다 — org-01 ADMIN 은 그 run 의 actor_id 를 읽고, org-02 ADMIN·org-01 SALES·운영자는 0행이다", async (t) => {
      const pglite = await w1Db(t);
      const AUDIT_SQL =
        "select target_id, actor_id from public.audit_logs where org_id = $1 and action = 'INGEST_MANUAL' and target_type = 'ingest_run' and target_id = any($2::uuid[])";
      await as(pglite, "admin");
      assert.deepEqual(await rowsOf(pglite, AUDIT_SQL, [ORG1, [MANUAL1, INGEST1]]), [
        { target_id: MANUAL1, actor_id: WHO.sales },
      ]);
      for (const [who, org] of [
        ["outsider", ORG1],
        ["outsider", ORG2],
        ["sales", ORG1],
        ["operator", ORG1],
      ]) {
        await as(pglite, who);
        assert.deepEqual(await rowsOf(pglite, AUDIT_SQL, [org, [MANUAL1]]), [], `${who} ${org}`);
      }
    });
  });

  it("감사 기록은 그 조직의 ADMIN 만 읽는다 — SALES·ANALYST·VIEWER·org-02·운영자는 0행이고, ADMIN 도 org-02 것은 보지 못하며 아무도 직접 쓰지 못한다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "admin");
    assert.deepEqual(
      (await rowsOf(pglite, "select org_id, action from public.audit_logs order by action")).map(
        (row) => `${row.org_id}:${row.action}`,
      ),
      ["ANALYSIS_REQUEST", "PROFILE_CREATE_REVISION", "REVIEW_DECIDE", "SEED"].map(
        (action) => `${ORG1}:${action}`,
      ),
    );
    for (const who of ["sales", "analyst", "viewer", "outsider", "operator"]) {
      await as(pglite, who);
      assert.equal(await countOf(pglite, "audit_logs"), 0, who);
    }
    await as(pglite, "admin");
    for (const sql of [
      `insert into public.audit_logs (org_id, action, target_type, target_id) values ('${ORG1}', 'SEED', 'organization', '${ORG1}')`,
      "update public.audit_logs set action = 'LOGIN'",
      "delete from public.audit_logs",
    ])
      await assert.rejects(pglite.query(sql), /permission denied for table audit_logs/, sql);
  });

  it("알림은 본인 것만 읽는다 — 같은 조직 ADMIN 도 남의 알림은 0행이고, 조직을 나가면 알림도 함께 지워진다", async (t) => {
    const pglite = await solDb(t);
    for (const [who, ids] of [
      ["admin", [NOTE_ADMIN]],
      ["sales", []],
      ["analyst", []],
      ["viewer", [NOTE_VIEWER]],
      ["outsider", [NOTE_OUTSIDER]],
      ["operator", []],
    ]) {
      await as(pglite, who);
      assert.deepEqual(
        (await rowsOf(pglite, "select id from public.notifications order by id")).map(
          (row) => row.id,
        ),
        ids,
        who,
      );
    }
    await asWorker(pglite);
    await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
      ORG1,
      WHO.viewer,
    ]);
    assert.equal(await countOf(pglite, "notifications", "id = $1", [NOTE_VIEWER]), 0);
  });

  it("회사 프로필 개정은 ADMIN 만 넣는다 — SALES·ANALYST·VIEWER·org-02 는 정책 오류, ADMIN 도 다른 조직에는 못 넣고 is_demo·created_by 는 열 권한이 없으며, 행은 불변이고 PROFILE_CREATE_REVISION 감사가 남는다", async (t) => {
    const pglite = await solDb(t);
    const revise = (org, revision) =>
      rowsOf(
        pglite,
        "insert into public.company_profiles (org_id, revision, name, technologies_complete) values ($1, $2, '개정 프로필', true) returning id",
        [org, revision],
      );
    for (const who of ["sales", "analyst", "viewer"]) {
      await as(pglite, who);
      await assert.rejects(revise(ORG1, 2), POLICY, who);
    }
    await as(pglite, "outsider");
    for (const org of [ORG1, ORG2]) await assert.rejects(revise(org, 2), POLICY, org);
    await as(pglite, "admin");
    await assert.rejects(revise(ORG2, 2), POLICY, "다른 조직");
    await assert.rejects(
      pglite.query(
        "insert into public.company_profiles (org_id, revision, name, is_demo) values ($1, 2, '개정 프로필', false)",
        [ORG1],
      ),
      /permission denied for table company_profiles/,
      "is_demo",
    );
    await assert.rejects(
      pglite.query(
        "insert into public.company_profiles (org_id, revision, name, created_by) values ($1, 2, '개정 프로필', $2)",
        [ORG1, WHO.sales],
      ),
      /permission denied for table company_profiles/,
      "created_by",
    );
    const [{ id }] = await revise(ORG1, 2);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select revision, created_by, is_demo, technologies_complete from public.company_profiles where id = $1",
        [id],
      ),
      [{ revision: 2, created_by: WHO.admin, is_demo: true, technologies_complete: true }],
    );
    // 같은 revision 을 다시 넣으면(동시 요청) UNIQUE 가 거절한다.
    await rejectsWith(revise(ORG1, 2), "company_profiles_org_id_revision_key");
    // 행은 불변이다 — 고치기·지우기는 권한이 없다.
    await assert.rejects(
      pglite.query("update public.company_profiles set name = '고친 이름'"),
      /permission denied for table company_profiles/,
    );
    await assert.rejects(
      pglite.query("delete from public.company_profiles"),
      /permission denied for table company_profiles/,
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select actor_id, action, target_type, before_after -> 'after' ->> 'revision' as revision, before_after -> 'after' ->> 'technologiesComplete' as complete from public.audit_logs where target_id = $1",
        [id],
      ),
      [
        {
          actor_id: WHO.admin,
          action: "PROFILE_CREATE_REVISION",
          target_type: "company_profile",
          revision: "2",
          complete: "true",
        },
      ],
    );
  });

  it("분석 요청은 ADMIN·SALES·ANALYST 가 QUEUED 행으로만 넣는다 — VIEWER·org-02 는 정책 오류, 상태·결과·요청자·스냅샷 열은 권한이 없고, 상태 전이·지우기는 worker 몫이며 ANALYSIS_REQUEST 감사가 남는다", async (t) => {
    const pglite = await solDb(t);
    const requested = [];
    for (const [i, who] of ["admin", "sales", "analyst"].entries()) {
      await as(pglite, who);
      const rows = await requestRun(pglite, ORG1, PROFILE1, `sol-v0.1.${i + 1}`);
      assert.deepEqual(
        rows.map(({ status, requested_by }) => ({ status, requested_by })),
        [{ status: "QUEUED", requested_by: WHO[who] }],
        who,
      );
      requested.push([rows[0].id, WHO[who]]);
    }
    await as(pglite, "viewer");
    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9"), POLICY, "VIEWER");
    await as(pglite, "outsider");
    // org-02 VIEWER 는 자기 조직에도, org-01 에도 못 넣는다.
    await assert.rejects(requestRun(pglite, ORG2, PROFILE2, "sol-v0.1.9"), POLICY);
    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9"), POLICY);
    await as(pglite, "sales");
    await assert.rejects(requestRun(pglite, ORG2, PROFILE2, "sol-v0.1.9"), POLICY, "다른 조직");
    for (const fields of [
      { status: "COMPLETED" },
      { score: 90 },
      { recommendation: "BID" },
      { requested_by: WHO.admin },
      { input_snapshot: "{}" },
    ])
      await assert.rejects(
        requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9", fields),
        /permission denied for table score_runs/,
        JSON.stringify(fields),
      );
    await assert.rejects(
      pglite.query("update public.score_runs set status = 'RUNNING'"),
      /permission denied for table score_runs/,
    );
    await assert.rejects(
      pglite.query("delete from public.score_runs"),
      /permission denied for table score_runs/,
    );
    await as(pglite, "admin");
    for (const [id, actor] of requested)
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select actor_id, action, before_after -> 'after' ->> 'status' as status from public.audit_logs where target_type = 'score_run' and target_id = $1",
          [id],
        ),
        [{ actor_id: actor, action: "ANALYSIS_REQUEST", status: "QUEUED" }],
      );
  });

  it("같은 입력(조직·공고·revision·프로필·알고리즘)의 진행 중 요청은 하나다 — 두 번째 QUEUED 와 RUNNING 중의 요청은 23505(score_runs_active_input_key)이고 완료된 뒤에는 다시 요청한다", async (t) => {
    const pglite = await solDb(t);
    const request = () => requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.0");
    await as(pglite, "sales");
    const [{ id: first }] = await request();
    await assert.rejects(request(), { code: "23505" });
    await rejectsWith(request(), "score_runs_active_input_key");
    await asWorker(pglite);
    await pglite.query("update public.score_runs set status = 'RUNNING' where id = $1", [first]);
    await as(pglite, "sales");
    await rejectsWith(request(), "score_runs_active_input_key");
    await asWorker(pglite);
    await pglite.query(
      "update public.score_runs set status = 'COMPLETED', input_snapshot = '{}', input_snapshot_hash = 'snap-0002', finished_at = now() where id = $1",
      [first],
    );
    await as(pglite, "sales");
    const [{ id: second }] = await request();
    assert.notEqual(second, first);
    // seed 의 완료 run + first(완료) + second(대기) — 완료된 run 은 이력으로 여러 개다.
    assert.equal(
      await countOf(pglite, "score_runs", "org_id = $1 and algorithm_version = 'sol-v0.1.0'", [
        ORG1,
      ]),
      3,
    );
  });

  it("결정 기록은 ADMIN·SALES 만 넣는다 — ANALYST·VIEWER·org-02 는 정책 오류, 권고·불일치 플래그·검토자·시각은 열 권한이 없고 트리거가 채우며, REVIEW_DECIDE 감사와 담당자가 있을 때 REVIEW_ASSIGNED outbox 1건이 같은 트랜잭션에 남는다", async (t) => {
    const pglite = await solDb(t);
    for (const who of ["analyst", "viewer"]) {
      await as(pglite, who);
      await assert.rejects(decide(pglite, { score_run_id: RUN1 }), POLICY, who);
    }
    await as(pglite, "outsider");
    await assert.rejects(decide(pglite), POLICY, "org-02 → org-01");
    await assert.rejects(decide(pglite, { org_id: ORG2, score_run_id: RUN2 }), POLICY, "org-02");
    await as(pglite, "sales");
    await assert.rejects(decide(pglite, { org_id: ORG2, score_run_id: RUN2 }), POLICY, "다른 조직");
    for (const fields of [
      { system_recommendation: "BID" },
      { disagreement_flag: true },
      { reviewer_id: WHO.admin },
      { decided_at: "2026-01-01T00:00:00Z" },
    ])
      await assert.rejects(
        decide(pglite, fields),
        /permission denied for table bid_reviews/,
        JSON.stringify(fields),
      );
    // SALES: 권고 BID 인 run 에 WATCH → 권고 사본과 불일치 플래그.
    const [{ id: watch }] = await decide(pglite, {
      score_run_id: RUN1,
      decision: "WATCH",
      reason: "예산 대비 인력 여유가 부족해 지켜본다",
    });
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select reviewer_id, system_recommendation, disagreement_flag from public.bid_reviews where id = $1",
        [watch],
      ),
      [{ reviewer_id: WHO.sales, system_recommendation: "BID", disagreement_flag: true }],
    );
    // ADMIN: run 없이 BID, 담당자 viewer → 권고 없음·불일치 false·outbox 1건.
    await as(pglite, "admin");
    const [{ id: assigned }] = await decide(pglite, {
      assignee_id: WHO.viewer,
      reason: "담당자를 정해 제안 준비를 시작한다",
    });
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select reviewer_id, system_recommendation, disagreement_flag, assignee_id from public.bid_reviews where id = $1",
        [assigned],
      ),
      [
        {
          reviewer_id: WHO.admin,
          system_recommendation: null,
          disagreement_flag: false,
          assignee_id: WHO.viewer,
        },
      ],
    );
    // append-only — 고치기·지우기는 권한이 없다.
    await assert.rejects(
      pglite.query("update public.bid_reviews set decision = 'NO_BID'"),
      /permission denied for table bid_reviews/,
    );
    await assert.rejects(
      pglite.query("delete from public.bid_reviews"),
      /permission denied for table bid_reviews/,
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        `select actor_id, before_after -> 'after' ->> 'decision' as decision, before_after -> 'after' ->> 'systemRecommendation' as recommendation,
           (before_after -> 'after' ->> 'disagreementFlag')::boolean as disagreement
         from public.audit_logs where action = 'REVIEW_DECIDE' and target_id in ($1, $2) order by actor_id`,
        [watch, assigned],
      ),
      [
        { actor_id: WHO.admin, decision: "BID", recommendation: null, disagreement: false },
        { actor_id: WHO.sales, decision: "WATCH", recommendation: "BID", disagreement: true },
      ],
    );
    // outbox 는 화면 역할이 못 읽으므로 관리 작업으로 본다.
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, aggregate_type, aggregate_id, status, idempotency_key, payload ->> 'assigneeUserId' as assignee, payload ->> 'reviewerId' as reviewer from public.outbox_events where event_type = 'REVIEW_ASSIGNED'",
      ),
      [
        {
          org_id: ORG1,
          aggregate_type: "bid_review",
          aggregate_id: assigned,
          status: "PENDING",
          idempotency_key: `${assigned}:${WHO.viewer}:REVIEW_ASSIGNED`,
          assignee: WHO.viewer,
          reviewer: WHO.admin,
        },
      ],
    );
    // 같은 키가 이미 있으면 outbox 는 한 건만 남고 결정은 들어간다(on conflict do nothing).
    const fixed = "f0000000-0000-0000-0000-000000000099";
    const key = `${fixed}:${WHO.viewer}:REVIEW_ASSIGNED`;
    await pglite.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values ($1, 'bid_review', $2, 'REVIEW_ASSIGNED', $3)",
      [ORG1, fixed, key],
    );
    await pglite.query(
      "insert into public.bid_reviews (id, org_id, bid_id, revision_id, assignee_id, decision, reason) values ($1, $2, $3, $4, $5, 'BID', '같은 담당자에게 다시 배정한다')",
      [fixed, ORG1, BID1, REV1, WHO.viewer],
    );
    assert.equal(await countOf(pglite, "outbox_events", "idempotency_key = $1", [key]), 1);
  });

  it("결정의 분석 run 은 같은 조직·같은 공고의 것만이고(score_run_mismatch) 담당자는 같은 조직 멤버만이다(bid_reviews_assignee_fkey) — 담당자가 조직을 나가면 담당자만 비고 결정은 남는다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "sales");
    const mismatch = { code: "23503", hint: "score_run_mismatch" };
    // 같은 조직, 다른 공고의 run.
    await assert.rejects(
      decide(pglite, { bid_id: BID2, revision_id: REV2, score_run_id: RUN1 }),
      mismatch,
      "다른 공고",
    );
    // org-02 의 run — 복합 FK 보다 먼저 트리거가 본다.
    await assert.rejects(decide(pglite, { score_run_id: RUN2 }), mismatch, "org-02 run");
    await assert.rejects(
      decide(pglite, { score_run_id: "a0000000-0000-0000-0000-0000000000ff" }),
      mismatch,
      "없는 run",
    );
    for (const assignee of [WHO.outsider, WHO.operator, WHO.invitee])
      await rejectsWith(decide(pglite, { assignee_id: assignee }), "bid_reviews_assignee_fkey");
    await rejectsWith(decide(pglite, { revision_id: REV2 }), "bid_reviews_revision_fkey");
    const [{ id }] = await decide(pglite, { assignee_id: WHO.analyst, score_run_id: RUN1 });
    await asWorker(pglite);
    await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
      ORG1,
      WHO.analyst,
    ]);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select assignee_id, decision, system_recommendation from public.bid_reviews where id = $1",
        [id],
      ),
      [{ assignee_id: null, decision: "BID", system_recommendation: "BID" }],
    );
  });

  it("알림은 본인의 read_at 만 고친다 — 남의 알림은 0행, 다른 열·넣기·지우기는 권한 오류, 읽음 처리는 NOTIFICATION_READ 감사를 남기고 같은 값은 다시 남기지 않는다", async (t) => {
    const pglite = await solDb(t);
    const at = "2026-10-19T09:00:00+09:00";
    await as(pglite, "viewer");
    assert.deepEqual(
      await rowsOf(
        pglite,
        "update public.notifications set read_at = $2 where id = $1 returning id",
        [NOTE_VIEWER, at],
      ),
      [{ id: NOTE_VIEWER }],
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "update public.notifications set read_at = $2 where id = $1 returning id",
        [NOTE_ADMIN, at],
      ),
      [],
    );
    // where 없이 전부 읽음 처리해도 본인 것 하나뿐이고, 같은 값이라 감사는 남지 않는다.
    assert.deepEqual(
      await rowsOf(pglite, "update public.notifications set read_at = $1 returning id", [at]),
      [{ id: NOTE_VIEWER }],
    );
    for (const sql of [
      "update public.notifications set status = 'SENT'",
      "update public.notifications set payload = '{}'",
      `update public.notifications set user_id = '${WHO.admin}'`,
      `insert into public.notifications (org_id, user_id, type, idempotency_key) values ('${ORG1}', '${WHO.viewer}', 'BID_CREATED', 'n-self')`,
      "delete from public.notifications",
    ])
      await assert.rejects(pglite.query(sql), /permission denied for table notifications/, sql);
    await as(pglite, "admin");
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select actor_id, target_id, before_after -> 'before' ->> 'readAt' as before_at, (before_after -> 'after' ->> 'readAt') is not null as after_set from public.audit_logs where action = 'NOTIFICATION_READ'",
      ),
      [{ actor_id: WHO.viewer, target_id: NOTE_VIEWER, before_at: null, after_set: true }],
    );
    // 읽음을 되돌리면 다시 남는다.
    await as(pglite, "viewer");
    await pglite.query("update public.notifications set read_at = null where id = $1", [
      NOTE_VIEWER,
    ]);
    await as(pglite, "admin");
    assert.equal(await countOf(pglite, "audit_logs", "action = 'NOTIFICATION_READ'"), 2);
  });

  it("업무 역할 변경은 그 조직의 ADMIN 만 한다 — SALES 의 시도와 org-02 owner(VIEWER)의 시도는 0행, ADMIN 은 자기 조직만 바꾸고 org-02 에는 0행이다", async (t) => {
    const pglite = await solDb(t);
    const setRole = (org, user, role) =>
      rowsOf(
        pglite,
        "update public.memberships set sol_role = $3 where org_id = $1 and user_id = $2 returning user_id, sol_role",
        [org, user, role],
      );
    await as(pglite, "sales");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), []);
    assert.deepEqual(await setRole(ORG1, WHO.sales, "ADMIN"), [], "자기 역할");
    await as(pglite, "outsider");
    // org-02 의 owner 지만 ADMIN 이 아니다(ADR-021).
    assert.deepEqual(await setRole(ORG2, WHO.outsider, "ADMIN"), []);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ADMIN"), []);
    await as(pglite, "admin");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), [
      { user_id: WHO.viewer, sol_role: "ANALYST" },
    ]);
    assert.deepEqual(await setRole(ORG2, WHO.outsider, "ADMIN"), []);
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, user_id, sol_role from public.memberships order by org_id, user_id",
      ),
      [
        { org_id: ORG1, user_id: WHO.admin, sol_role: "ADMIN" },
        { org_id: ORG1, user_id: WHO.sales, sol_role: "SALES" },
        { org_id: ORG1, user_id: WHO.analyst, sol_role: "ANALYST" },
        { org_id: ORG1, user_id: WHO.viewer, sol_role: "ANALYST" },
        { org_id: ORG2, user_id: WHO.outsider, sol_role: "VIEWER" },
      ],
    );
  });

  it("업무 역할 보호 트리거 — update 정책이 실수로 열려도 ADMIN 이 아닌 사람의 sol_role 변경은 42501(sol_role_admin_only)이고, 같은 값·ADMIN·JWT 없는 관리 작업·service_role 은 통과한다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    // 첫 잠금(정책)이 열린 상황: 멤버 전원이 자기 조직 멤버십을 고친다. 두 번째 잠금(트리거)만 남는다.
    await pglite.exec(
      'create policy "시험 — 멤버 전원 수정" on public.memberships for update to authenticated using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()))',
    );
    const setRole = (org, user, role) =>
      rowsOf(
        pglite,
        "update public.memberships set sol_role = $3 where org_id = $1 and user_id = $2 returning sol_role",
        [org, user, role],
      );
    await as(pglite, "sales");
    await assert.rejects(setRole(ORG1, WHO.sales, "ADMIN"), {
      code: "42501",
      hint: "sol_role_admin_only",
    });
    await assert.rejects(setRole(ORG1, WHO.viewer, "ADMIN"), {
      code: "42501",
      hint: "sol_role_admin_only",
    });
    // 값이 그대로면 트리거는 거절하지 않는다(열린 정책대로 통과).
    assert.deepEqual(await setRole(ORG1, WHO.sales, "SALES"), [{ sol_role: "SALES" }]);
    await as(pglite, "admin");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), [{ sol_role: "ANALYST" }]);
    await asWorker(pglite);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "SALES"), [{ sol_role: "SALES" }]);
    await pglite.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "VIEWER"), [{ sol_role: "VIEWER" }]);
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select sol_role from public.memberships where org_id = $1 and user_id = $2",
        [ORG1, WHO.sales],
      ),
      [{ sol_role: "SALES" }],
    );
  });

  it("초대의 업무 역할은 수락할 때 멤버십으로 옮겨진다 — ADMIN 이 ANALYST 로 초대하면 수락한 멤버십이 ANALYST 이고 USER_INVITE 감사가 남는다; 초대는 owner 가 아니라 ADMIN 이 하고(SALES·VIEWER·org-02 owner 는 정책 오류), 받은 사람은 sol_role 을 직접 쓰지 못한다", async (t) => {
    const pglite = await solDb(t);
    const invite = (org, email, role) =>
      rowsOf(
        pglite,
        "insert into public.invitations (org_id, email, sol_role) values ($1, $2, $3) returning id",
        [org, email, role],
      );
    for (const who of ["sales", "viewer"]) {
      await as(pglite, who);
      await assert.rejects(invite(ORG1, EMAIL.invitee, "ANALYST"), POLICY, who);
    }
    await as(pglite, "outsider");
    await assert.rejects(invite(ORG2, EMAIL.invitee, "VIEWER"), POLICY, "org-02 owner(VIEWER)");
    await as(pglite, "admin");
    const [{ id: invitation }] = await invite(ORG1, EMAIL.invitee, "ANALYST");
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select actor_id, action, target_type, before_after -> 'after' ->> 'email' as email, before_after -> 'after' ->> 'solRole' as sol_role from public.audit_logs where target_id = $1",
        [invitation],
      ),
      [
        {
          actor_id: WHO.admin,
          action: "USER_INVITE",
          target_type: "invitation",
          email: EMAIL.invitee,
          sol_role: "ANALYST",
        },
      ],
    );
    await as(pglite, "invitee");
    // sol_role 을 직접 적으면 열 권한 오류. 적지 않으면 트리거가 초대의 값을 채운다
    // (returning 없이 — 넣는 문장 안에서는 새 조직이 아직 읽기 정책에 보이지 않는다).
    await assert.rejects(
      pglite.query(
        "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'ADMIN')",
        [ORG1, WHO.invitee],
      ),
      /permission denied for table memberships/,
    );
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role) values ($1, $2, 'member')",
      [ORG1, WHO.invitee],
    );
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_role, sol_role from public.memberships where org_id = $1 and user_id = $2",
        [ORG1, WHO.invitee],
      ),
      [{ org_role: "member", sol_role: "ANALYST" }],
    );
    assert.equal(await countOf(pglite, "invitations", "id = $1", [invitation]), 0, "수락한 초대");
    // ADMIN 이지만 owner 가 아닌 사람도 초대한다(ADR-021).
    await pglite.query(
      "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
      [ORG1, WHO.sales],
    );
    await as(pglite, "sales");
    assert.equal((await invite(ORG1, "second@example.invalid", "SALES")).length, 1);
  });

  it("worker 전용 표(점수 요소·자격 판정·항목 판정·인력 배정)는 조직 전원이 읽고 ADMIN 도 넣기·고치기·지우기는 권한 오류다", async (t) => {
    const pglite = await solDb(t);
    const tables = [
      "score_factors",
      "qualification_checks",
      "requirement_assessments",
      "assignments",
    ];
    for (const who of ["admin", "sales", "analyst", "viewer"]) {
      await as(pglite, who);
      for (const table of tables)
        assert.equal(await countOf(pglite, table, "org_id = $1", [ORG1]), 1, `${who} ${table}`);
    }
    await as(pglite, "admin");
    for (const table of tables)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set org_id = '${ORG1}'`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });

  it("테넌트 혼입은 복합 외래 키가 거절한다(23503) — worker 가 RLS 없이 써도 다른 조직 프로필의 run, run 과 다른 org_id 의 요소·자격·항목 판정, 다른 조직 직원의 배정, 비멤버 수신자의 알림, 다른 공고의 revision 은 들어가지 않는다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const rejects = async (sql, params, constraint) => {
      await assert.rejects(pglite.query(sql, params), { code: "23503" }, constraint);
      await rejectsWith(pglite.query(sql, params), constraint);
    };
    await rejects(
      "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
      [ORG1, BID1, REV1, PROFILE2],
      "score_runs_company_profile_fkey",
    );
    await rejects(
      "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
      [ORG1, BID2, REV1, PROFILE1],
      "score_runs_revision_fkey",
    );
    await rejects(
      "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'pastPerformance', 10, 25)",
      [RUN1, ORG2],
      "score_factors_score_run_fkey",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'SATISFIED', '사유', 'API_FIELD')",
      [RUN1, ORG2, BID1, REV1],
      "qualification_checks_score_run_fkey",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'SATISFIED', '사유', 'API_FIELD')",
      [RUN1, ORG1, BID2, REV1],
      "qualification_checks_revision_fkey",
    );
    await rejects(
      "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'requiredSkills[0]', 'SKILL', 'SATISFIED', 'EXTRACTION')",
      [RUN1, ORG2],
      "requirement_assessments_score_run_fkey",
    );
    await rejects(
      "insert into public.assignments (org_id, bid_id, member_id, starts_at, ends_at, allocation_percent) values ($1, $2, $3, '2026-11-01', '2026-12-01', 10)",
      [ORG2, BID1, MEMBER1],
      "assignments_member_fkey",
    );
    await rejects(
      "insert into public.notifications (org_id, user_id, type, idempotency_key) values ($1, $2, 'BID_CREATED', 'n-mixed')",
      [ORG2, WHO.admin],
      "notifications_recipient_fkey",
    );
    await rejects(
      "insert into public.bid_reviews (org_id, bid_id, revision_id, assignee_id, decision, reason) values ($1, $2, $3, $4, 'BID', '다른 조직 사람을 담당자로')",
      [ORG2, BID1, REV1, WHO.admin],
      "bid_reviews_assignee_fkey",
    );
    await rejects(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url) values ($1, $2, 'x', 'https://www.g2b.go.kr/x')",
      [BID2, REV1],
      "bid_documents_revision_fkey",
    );
    await rejects(
      "insert into public.bid_structured_requirements (bid_id, revision_id, kind, seq, value, source_operation) values ($1, $2, 'LICENSE_LIMIT', 1, '{}', 'op')",
      [BID2, REV1],
      "bid_structured_requirements_revision_fkey",
    );
    await rejects(
      "insert into public.requirement_extractions (bid_id, revision_id, provider, model_name, prompt_version, prompt_hash, schema_version) values ($1, $2, 'MOCK', 'mock', 'v0.1', 'p-0002', 's')",
      [BID2, REV1],
      "requirement_extractions_revision_fkey",
    );
    // 혼입이 없으면 들어간다.
    await pglite.query(
      "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'pastPerformance', 10, 25)",
      [RUN1, ORG1],
    );
    assert.equal(await countOf(pglite, "score_factors", "score_run_id = $1", [RUN1]), 2);
  });

  it("ADR-020 check 제약 — 완료 run 의 스냅샷, mock 대체 사유, 점수 범위·플래그 값, 첨부 다운로드·파싱 상태, NEEDS_REVIEW 의 사유 코드, 결정 사유 길이, 업무 역할 값은 관리 작업이 넣어도 DB 가 막는다(23514)", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const rejects = async (sql, params, constraint) => {
      await assert.rejects(pglite.query(sql, params), { code: "23514" }, constraint);
      await rejectsWith(pglite.query(sql, params), constraint);
    };
    const [{ id: run }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.1");
    await rejects(
      "update public.score_runs set status = 'COMPLETED' where id = $1",
      [run],
      "score_runs_finished_snapshot_check",
    );
    await rejects(
      "update public.score_runs set status = 'PARTIAL', input_snapshot = '{}' where id = $1",
      [run],
      "score_runs_finished_snapshot_check",
    );
    await rejects(
      "update public.score_runs set fallback_reason = 'QWEN_UNAVAILABLE' where id = $1",
      [run],
      "score_runs_fallback_check",
    );
    await rejects(
      "update public.score_runs set fallback_reason = 'QWEN_UNAVAILABLE', review_flags = '{MOCK_FALLBACK}', run_mode = 'LIVE' where id = $1",
      [run],
      "score_runs_fallback_check",
    );
    await rejects(
      "update public.score_runs set fallback_reason = 'QWEN_UNAVAILABLE', review_flags = '{MOCK_FALLBACK}', ai_provider = 'LOCAL' where id = $1",
      [run],
      "score_runs_fallback_check",
    );
    await rejects(
      "update public.score_runs set score = 101 where id = $1",
      [run],
      "score_runs_score_check",
    );
    await rejects(
      "update public.score_runs set review_flags = '{NOT_A_FLAG}' where id = $1",
      [run],
      "score_runs_review_flags_check",
    );
    await rejects(
      "update public.score_runs set missing_factors = '{winProbability}' where id = $1",
      [run],
      "score_runs_missing_factors_check",
    );
    await pglite.query(
      "update public.score_runs set fallback_reason = 'QWEN_UNAVAILABLE', review_flags = '{MOCK_FALLBACK}', status = 'PARTIAL', input_snapshot = '{}', input_snapshot_hash = 'snap-0003' where id = $1",
      [run],
    );
    await rejects(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url, download_status) values ($1, $2, 'x', 'https://www.g2b.go.kr/x', 'OK')",
      [BID1, REV1],
      "bid_documents_download_ok_check",
    );
    await rejects(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url, download_status, parse_status) values ($1, $2, 'x', 'https://www.g2b.go.kr/x', 'PENDING', 'PENDING')",
      [BID1, REV1],
      "bid_documents_parse_after_download_check",
    );
    await rejects(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url, download_status, object_key, sha256, size_bytes, parse_status) values ($1, $2, 'x', 'https://www.g2b.go.kr/x', 'OK', 'k', 's-1', 1, 'FAILED')",
      [BID1, REV1],
      "bid_documents_parse_failed_check",
    );
    await pglite.query(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url, download_status, object_key, sha256, size_bytes, parse_status, parse_error_code) values ($1, $2, 'x', 'https://www.g2b.go.kr/x', 'OK', 'k', 's-1', 1, 'FAILED', 'PARSER_ERROR')",
      [BID1, REV1],
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'NEEDS_REVIEW', '사유', 'API_FIELD')",
      [RUN1, ORG1, BID1, REV1],
      "qualification_checks_needs_review_check",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason_code, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'SATISFIED', 'NOTICE_INFO_MISSING', '사유', 'API_FIELD')",
      [RUN1, ORG1, BID1, REV1],
      "qualification_checks_needs_review_check",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, '코드 없는 조건', 'SATISFIED', '사유', 'API_FIELD')",
      [RUN1, ORG1, BID1, REV1],
      "qualification_checks_requirement_code_check",
    );
    await rejects(
      "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'requiredSkills[1]', 'SKILL', 'NEEDS_REVIEW', 'EXTRACTION')",
      [RUN1, ORG1],
      "requirement_assessments_needs_review_check",
    );
    for (const reason of ["아홉글자사유입니다", " 앞뒤 공백이 있는 사유 ", "x".repeat(2001)])
      await rejects(
        "insert into public.bid_reviews (org_id, bid_id, revision_id, decision, reason) values ($1, $2, $3, 'BID', $4)",
        [ORG1, BID1, REV1, reason],
        "bid_reviews_reason_check",
      );
    await rejects(
      "update public.memberships set sol_role = 'OWNER' where org_id = $1 and user_id = $2",
      [ORG1, WHO.viewer],
      "memberships_sol_role_check",
    );
    await rejects(
      "insert into public.invitations (org_id, email, sol_role) values ($1, 'boss@example.invalid', 'BOSS')",
      [ORG1],
      "invitations_sol_role_check",
    );
  });

  it("idempotency 키와 자연 키는 유일하다 — outbox·알림·수집 run 의 같은 키, 같은 공고 번호·revision, 분석 요청의 같은 Idempotency-Key 는 23505", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const rejects = async (sql, params, constraint) => {
      await assert.rejects(pglite.query(sql, params), { code: "23505" }, constraint);
      await rejectsWith(pglite.query(sql, params), constraint);
    };
    await rejects(
      "insert into public.outbox_events (aggregate_type, aggregate_id, event_type, idempotency_key) values ('bid_notice', $1, 'BID_CREATED', 'fixture:DEMO-2026-0001:1:BID_CREATED')",
      [BID1],
      "outbox_events_idempotency_key_key",
    );
    await rejects(
      "insert into public.notifications (org_id, user_id, type, idempotency_key) values ($1, $2, 'BID_CREATED', 'n-admin')",
      [ORG1, WHO.admin],
      "notifications_idempotency_key_key",
    );
    await rejects(
      "insert into public.ingest_runs (source, run_mode, job_key, trigger) values ('fixture', 'MOCK', 'ingest:fixture:seed', 'DEMO')",
      [],
      "ingest_runs_job_key_key",
    );
    await rejects(
      "insert into public.bid_notices (source, notice_id, title, stage, status, source_url, content_hash) values ('fixture', 'DEMO-2026-0001', '같은 공고 번호', 'NOTICE', 'OPEN', 'https://fixture.invalid/x', 'h')",
      [],
      "bid_notices_source_notice_id_key",
    );
    await rejects(
      "insert into public.bid_revisions (bid_id, revision, raw_payload, normalized, checksum) values ($1, 1, '{}', '{}', 'c')",
      [BID1],
      "bid_revisions_bid_id_revision_key",
    );
    // C5-B 보안 후속 (a): 키는 `<org_id>:` 로 시작해야 한다(score_runs_idempotency_key_org_check, 20261019000011).
    // 예전 키 "idem-1" 은 그 check 에 먼저 걸려 이 시험이 보려는 UNIQUE 를 못 보므로 조직 접두어를 붙였다.
    const idem = `${ORG1}:idem-1`;
    await as(pglite, "sales");
    await requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.1", { idempotency_key: idem });
    await assert.rejects(
      requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.2", { idempotency_key: idem }),
      { code: "23505" },
    );
    await rejectsWith(
      requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.2", { idempotency_key: idem }),
      "score_runs_idempotency_key_key",
    );
  });

  it("화면 역할의 SOL 표 권한은 로그인 역할의 읽기(수집 run 은 열 단위)와 열 단위 넣기(회사 프로필·분석 요청·결정)·알림 read_at 고치기뿐이다 — anon 에는 없고 outbox_events 에는 아무것도 없다", async (t) => {
    const pglite = await solDb(t);
    const tables = [...SOL_TABLES].sort();
    // ingest_runs 의 읽기는 20261019000019(N8 W1)부터 표 단위가 아니라 열 단위다. 열 목록은 "수집 run 열 단위 읽기" 시험이 본다.
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated') order by 1,2,3",
        [tables],
      ),
      tables
        .filter((table) => table !== "outbox_events" && table !== "ingest_runs")
        .map((table_name) => ({ table_name, grantee: "authenticated", privilege_type: "SELECT" })),
    );
    const columns = (table_name, privilege_type, names) =>
      names.map((column_name) => ({ table_name, column_name, privilege_type }));
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select table_name, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated') and privilege_type <> 'SELECT' order by 1,2,3",
        [tables],
      ),
      [
        // reviewer_id·system_recommendation·disagreement_flag·decided_at 은 트리거·기본값만 채운다.
        ...columns("bid_reviews", "INSERT", [
          "assignee_id",
          "bid_id",
          "decision",
          "org_id",
          "reason",
          "revision_id",
          "score_run_id",
        ]),
        // is_demo·created_by·created_at 은 기본값만 들어간다.
        ...columns("company_profiles", "INSERT", [
          "effective_at",
          "financials",
          "industry_codes",
          "licenses",
          "name",
          "note",
          "org_id",
          "past_projects",
          "preferences",
          "revision",
          "technologies",
          "technologies_complete",
        ]),
        ...columns("notifications", "UPDATE", ["read_at"]),
        // 상태·결과·요청자·시각은 worker 가 채운다. request_hash 는 20261019000012 가 더한 요청 지문이다.
        ...columns("score_runs", "INSERT", [
          "ai_provider",
          "algorithm_version",
          "bid_id",
          "company_profile_id",
          "extraction_id",
          "idempotency_key",
          "org_id",
          "profile_revision",
          "request_hash",
          "revision_id",
          "run_mode",
        ]),
      ],
    );
  });

  // 20261019000010: 화면(C6)이 DB 에서 분석을 다시 읽을 때 쓰는 두 열. score_factors.missing_reason 은 C4 ScoreFactor.missingReason,
  // score_runs.kev_assist 는 C4 AnalysisResult.kev(KevAssist)다. 쓰기는 worker(service role)만 하고 권한·정책은 바꾸지 않는다.
  describe("화면 표시용 저장 열(20261019000010) — score_factors.missing_reason·score_runs.kev_assist", () => {
    // C4 MissingReason(web/server/scoring/analysis-result.model.ts) 8값.
    const MISSING_REASONS = [
      "NO_REQUIREMENTS_EXTRACTED",
      "PROFILE_TECHNOLOGIES_EMPTY",
      "BID_DOMAIN_UNKNOWN",
      "PROFILE_PROJECTS_EMPTY",
      "REQUIRED_FTE_UNKNOWN",
      "TEAM_EMPTY",
      "BUDGET_UNKNOWN",
      "PREFERENCES_NOT_SET",
    ];
    // C4 KevAssist 모양의 값. 값 형식은 앱 zod·시험이 지키고 DB 는 jsonb 로 그대로 둔다.
    const kevAssist = (suggestedOption, probabilities) => ({
      enabled: true,
      provider: "mock",
      model: "mock",
      questionSetVersion: "kev-qs/v0.1",
      suggestedOption,
      probabilities,
      confidence: probabilities[suggestedOption],
      mandatoryRisk: 0.05,
      needsHumanReview: 0.12,
      fit: { score: 3.5, legend: { 0: "Very poor", 4: "Very good" } },
      scores: null,
      risks: null,
      calibration: null,
      stateTrace: null,
      latencyMs: 37,
      requestId: null,
      disclaimer: "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.",
    });
    const KEV1 = kevAssist("BID", { BID: 0.71, WATCH: 0.24, NO_BID: 0.05 });
    const KEV2 = kevAssist("WATCH", { BID: 0.2, WATCH: 0.7, NO_BID: 0.1 });
    const NEW_COLUMNS = "(('score_factors', 'missing_reason'), ('score_runs', 'kev_assist'))";

    it("score_factors.missing_reason 은 null 허용 text, score_runs.kev_assist 는 null 허용 jsonb 이고 기본값이 없어 두 열 없이 넣은 행은 null 이다", async (t) => {
      const pglite = await solDb(t);
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
           where table_schema = 'public' and (table_name, column_name) in ${NEW_COLUMNS} order by 1, 2`,
        ),
        [
          {
            table_name: "score_factors",
            column_name: "missing_reason",
            data_type: "text",
            is_nullable: "YES",
            column_default: null,
          },
          {
            table_name: "score_runs",
            column_name: "kev_assist",
            data_type: "jsonb",
            is_nullable: "YES",
            column_default: null,
          },
        ],
      );
      // seed 는 두 열 없이 넣었다(마이그레이션 전에 쌓인 행과 같다).
      assert.deepEqual(
        await rowsOf(pglite, "select missing_reason from public.score_factors order by org_id"),
        [{ missing_reason: null }, { missing_reason: null }],
      );
      assert.deepEqual(
        await rowsOf(pglite, "select kev_assist from public.score_runs order by org_id"),
        [{ kev_assist: null }, { kev_assist: null }],
      );
    });

    it("missing_reason 은 C4 MissingReason 8값과 null 만 받는다 — 모르는 값·소문자·빈 문자열·뒤 공백은 관리 작업이 넣어도 23514(score_factors_missing_reason_check)다", async (t) => {
      const pglite = await solDb(t);
      await asWorker(pglite);
      const setReason = async (reason) =>
        rowsOf(
          pglite,
          "update public.score_factors set missing_reason = $1 where score_run_id = $2 returning missing_reason",
          [reason, RUN1],
        );
      for (const reason of MISSING_REASONS)
        assert.deepEqual(await setReason(reason), [{ missing_reason: reason }], reason);
      assert.deepEqual(await setReason(null), [{ missing_reason: null }], "null");
      for (const reason of ["WIN_PROBABILITY_UNKNOWN", "budget_unknown", "", "BUDGET_UNKNOWN "]) {
        await assert.rejects(setReason(reason), { code: "23514" }, JSON.stringify(reason));
        await rejectsWith(
          setReason(reason),
          "score_factors_missing_reason_check",
          JSON.stringify(reason),
        );
      }
      // worker 의 넣기 경로(요소 행 insert)도 같은 제약이다.
      const insertFactor = (factor, reason) =>
        rowsOf(
          pglite,
          "insert into public.score_factors (score_run_id, org_id, factor, points, max_points, missing, missing_reason) values ($1, $2, $3, 0, 15, true, $4) returning missing_reason",
          [RUN1, ORG1, factor, reason],
        );
      assert.deepEqual(await insertFactor("scaleFit", "BUDGET_UNKNOWN"), [
        { missing_reason: "BUDGET_UNKNOWN" },
      ]);
      await rejectsWith(
        insertFactor("strategicPreference", "NOT_A_REASON"),
        "score_factors_missing_reason_check",
      );
    });

    it("org-01 의 네 역할은 자기 조직 run 의 kev_assist·요소의 missing_reason 을 읽고 org-02 행은 0행이다 — org-02 VIEWER 는 org-01 것을, 비멤버 운영자는 둘 다 0행으로 보고 로그아웃은 권한 오류다", async (t) => {
      const pglite = await solDb(t);
      await asWorker(pglite);
      for (const [run, kev, reason] of [
        [RUN1, KEV1, "BUDGET_UNKNOWN"],
        [RUN2, KEV2, "TEAM_EMPTY"],
      ]) {
        await pglite.query("update public.score_runs set kev_assist = $1 where id = $2", [
          JSON.stringify(kev),
          run,
        ]);
        await pglite.query(
          "update public.score_factors set missing_reason = $1 where score_run_id = $2",
          [reason, run],
        );
      }
      const runsSeen = () =>
        rowsOf(pglite, "select id, kev_assist from public.score_runs order by id");
      const factorsSeen = () =>
        rowsOf(
          pglite,
          "select score_run_id, missing_reason from public.score_factors order by score_run_id",
        );
      for (const who of ["admin", "sales", "analyst", "viewer"]) {
        await as(pglite, who);
        assert.deepEqual(await runsSeen(), [{ id: RUN1, kev_assist: KEV1 }], `${who} score_runs`);
        assert.deepEqual(
          await factorsSeen(),
          [{ score_run_id: RUN1, missing_reason: "BUDGET_UNKNOWN" }],
          `${who} score_factors`,
        );
      }
      await as(pglite, "outsider");
      assert.deepEqual(await runsSeen(), [{ id: RUN2, kev_assist: KEV2 }], "outsider score_runs");
      assert.deepEqual(
        await factorsSeen(),
        [{ score_run_id: RUN2, missing_reason: "TEAM_EMPTY" }],
        "outsider score_factors",
      );
      await as(pglite, "operator");
      assert.deepEqual(await runsSeen(), [], "operator score_runs");
      assert.deepEqual(await factorsSeen(), [], "operator score_factors");
      await asAnon(pglite);
      await assert.rejects(runsSeen(), PERMISSION, "anon score_runs");
      await assert.rejects(factorsSeen(), PERMISSION, "anon score_factors");
    });

    it("두 열은 worker 만 쓴다 — 분석 요청 insert 에 kev_assist 를 넣으면 권한 오류이고 열 목록 그대로의 요청은 QUEUED·kev_assist null 로 들어가며, ADMIN 도 두 열을 고치거나 넣지 못하고 화면 역할의 열 권한은 authenticated 의 SELECT 뿐이다", async (t) => {
      const pglite = await solDb(t);
      for (const who of ["admin", "sales", "analyst"]) {
        await as(pglite, who);
        await assert.rejects(
          requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9", { kev_assist: JSON.stringify(KEV1) }),
          /permission denied for table score_runs/,
          who,
        );
      }
      await as(pglite, "sales");
      const [{ id }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9");
      assert.deepEqual(
        await rowsOf(pglite, "select status, kev_assist from public.score_runs where id = $1", [
          id,
        ]),
        [{ status: "QUEUED", kev_assist: null }],
      );
      await as(pglite, "admin");
      for (const sql of [
        "update public.score_runs set kev_assist = '{}'::jsonb",
        "update public.score_factors set missing_reason = 'BUDGET_UNKNOWN'",
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
      await assert.rejects(
        pglite.query(
          "insert into public.score_factors (score_run_id, org_id, factor, points, max_points, missing_reason) values ($1, $2, 'scaleFit', 0, 15, 'BUDGET_UNKNOWN')",
          [RUN1, ORG1],
        ),
        PERMISSION,
        "score_factors insert",
      );
      // 표 단위 SELECT 가 새 열에도 걸리고, 열 단위 넣기·고치기 권한은 없다. anon 에는 아무것도 없다.
      // information_schema 는 지금 역할이 받은 권한만 보여 주므로 관리 역할로 돌아가 읽는다.
      await asWorker(pglite);
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
           where table_schema = 'public' and grantee in ('anon', 'authenticated') and (table_name, column_name) in ${NEW_COLUMNS}
           order by 1, 2, 3, 4`,
        ),
        [
          {
            table_name: "score_factors",
            column_name: "missing_reason",
            grantee: "authenticated",
            privilege_type: "SELECT",
          },
          {
            table_name: "score_runs",
            column_name: "kev_assist",
            grantee: "authenticated",
            privilege_type: "SELECT",
          },
        ],
      );
    });
  });

  // 20261019000012: 화면(C6)의 읽기·분석 요청 보조. score_runs.request_hash(같은 키 + 다른 본문 409 의 지문),
  // release_unqueued_score_run(큐 등록 실패 → 요청자 본인의 QUEUED run 을 FAILED 로 풀고 멱등 키를 비운다),
  // latest_ingest_run(업무 역할이 있는 사용자의 수집 신선도 한 줄), 뷰 bid_list_items(공고 + 조직의 최신 분석·결정 +
  // 최신 revision 첨부 집계, security_invoker). 멱등 키는 <org_id>:<uuid> 형식이다(20261019000011 의 조직 접두 check 와 맞춘다).
  describe("C6 화면 읽기·분석 요청 보조 (20261019000012)", () => {
    const KEY1 = `${ORG1}:5a1e0000-0000-4000-8000-000000000001`;
    const KEY2 = `${ORG1}:5a1e0000-0000-4000-8000-000000000002`;
    const KEY_ORG2 = `${ORG2}:5a1e0000-0000-4000-8000-000000000003`;
    const HASH1 = "a".repeat(64);
    const HASH2 = "b".repeat(64);
    const MISSING_RUN = "a0000000-0000-0000-0000-0000000000ff";
    const functionDenied = (name) => ({
      code: "42501",
      message: new RegExp(`permission denied for function ${name}`),
    });

    const release = (pglite, id) =>
      rowsOf(pglite, "select public.release_unqueued_score_run($1) as released", [id]);
    const latestIngest = (pglite, origin) =>
      rowsOf(pglite, "select * from public.latest_ingest_run($1)", [origin]);
    // 화면이 읽는 열. 시각·금액(numeric)은 따로 본다.
    const LIST_COLUMNS = [
      "id",
      "status",
      "budget_krw_text",
      "latest_run_id",
      "latest_run_status",
      "latest_run_score",
      "latest_run_recommendation",
      "latest_run_basis",
      "latest_run_flags",
      "scored_score",
      "scored_recommendation",
      "latest_decision",
      "latest_reviewer_display_name",
      "latest_reviewer_email",
      "docs_total",
      "docs_pending",
      "docs_parsed",
      "docs_partial",
      "docs_unsupported",
      "docs_failed",
      "docs_download_failed",
    ];
    const listOf = (pglite) =>
      rowsOf(pglite, `select ${LIST_COLUMNS.join(", ")} from public.bid_list_items order by id`);
    const NO_DOCS = {
      docs_total: 0,
      docs_pending: 0,
      docs_parsed: 0,
      docs_partial: 0,
      docs_unsupported: 0,
      docs_failed: 0,
      docs_download_failed: 0,
    };
    const NO_ORG_DATA = {
      latest_run_id: null,
      latest_run_status: null,
      latest_run_score: null,
      latest_run_recommendation: null,
      latest_run_basis: null,
      latest_run_flags: null,
      scored_score: null,
      scored_recommendation: null,
      latest_decision: null,
      latest_reviewer_display_name: null,
      latest_reviewer_email: null,
    };
    // seed 의 BID1·BID2 공고 열(마감 없음 → 저장 상태 그대로). BID1 에는 최신 revision 의 PENDING 첨부가 하나 있다.
    const BID1_ROW = {
      id: BID1,
      status: "OPEN",
      budget_krw_text: "1200000000",
      ...NO_DOCS,
      docs_total: 1,
      docs_pending: 1,
    };
    const BID2_ROW = { id: BID2, status: "OPEN", budget_krw_text: "800000000", ...NO_DOCS };
    // 완료 run(RUN1·RUN2 seed) 의 열.
    const completedRun = (run) => ({
      latest_run_id: run,
      latest_run_status: "COMPLETED",
      latest_run_score: 82,
      latest_run_recommendation: "BID",
      latest_run_basis: "RULES_ONLY",
      latest_run_flags: [],
      scored_score: 82,
      scored_recommendation: "BID",
    });

    it("분석 요청은 request_hash(null 허용 text, 기본값 없음)를 함께 넣고, 넣은 뒤에는 ADMIN·SALES 도 고치지 못한다(42501)", async (t) => {
      const pglite = await solDb(t);
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select data_type, is_nullable, column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'score_runs' and column_name = 'request_hash'`,
        ),
        [{ data_type: "text", is_nullable: "YES", column_default: null }],
      );
      await as(pglite, "sales");
      const [{ id, status, requested_by }] = await requestRun(
        pglite,
        ORG1,
        PROFILE1,
        "sol-v0.2.0",
        { idempotency_key: KEY1, request_hash: HASH1 },
      );
      assert.deepEqual({ status, requested_by }, { status: "QUEUED", requested_by: WHO.sales });
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select idempotency_key, request_hash from public.score_runs where id = $1",
          [id],
        ),
        [{ idempotency_key: KEY1, request_hash: HASH1 }],
      );
      for (const who of ["sales", "admin"]) {
        await as(pglite, who);
        await assert.rejects(
          pglite.query("update public.score_runs set request_hash = $1 where id = $2", [HASH2, id]),
          { code: "42501", message: /permission denied for table score_runs/ },
          who,
        );
      }
      // seed run 은 request_hash 없이 넣었다(마이그레이션 전에 쌓인 행과 같다).
      await asWorker(pglite);
      assert.deepEqual(
        await rowsOf(pglite, "select request_hash from public.score_runs where id = any($1)", [
          [RUN1, RUN2],
        ]),
        [{ request_hash: null }, { request_hash: null }],
      );
    });

    it("같은 입력의 두 번째 QUEUED 요청은 23505(score_runs_active_input_key), 같은 멱등 키의 두 번째 요청은 다른 입력·다른 요청자라도 23505(score_runs_idempotency_key_key)다", async (t) => {
      const pglite = await solDb(t);
      await as(pglite, "sales");
      await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
        idempotency_key: KEY1,
        request_hash: HASH1,
      });
      await assert.rejects(
        requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
          idempotency_key: KEY2,
          request_hash: HASH1,
        }),
        { code: "23505", message: /score_runs_active_input_key/ },
        "같은 입력",
      );
      for (const who of ["sales", "analyst"]) {
        await as(pglite, who);
        await assert.rejects(
          requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.1", {
            idempotency_key: KEY1,
            request_hash: HASH2,
          }),
          { code: "23505", message: /score_runs_idempotency_key_key/ },
          `${who} 같은 키`,
        );
      }
    });

    it("요청자는 자기 QUEUED run 을 release_unqueued_score_run 으로 푼다 — true 이고 FAILED·ENQUEUE_FAILED·멱등 키 null·finished_at 만 바뀌며, 두 번째 호출은 false, 같은 키·같은 입력의 새 QUEUED run 은 들어간다", async (t) => {
      const pglite = await solDb(t);
      await as(pglite, "sales");
      const [{ id }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
        idempotency_key: KEY1,
        request_hash: HASH1,
      });
      assert.deepEqual(await release(pglite, id), [{ released: true }]);
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select status, error_code, idempotency_key, request_hash, requested_by, started_at, score,
             finished_at is not null as finished
           from public.score_runs where id = $1`,
          [id],
        ),
        [
          {
            status: "FAILED",
            error_code: "ENQUEUE_FAILED",
            idempotency_key: null,
            request_hash: HASH1,
            requested_by: WHO.sales,
            started_at: null,
            score: null,
            finished: true,
          },
        ],
      );
      assert.deepEqual(await release(pglite, id), [{ released: false }], "두 번째 호출");
      const [again] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
        idempotency_key: KEY1,
        request_hash: HASH1,
      });
      assert.notEqual(again.id, id);
      assert.equal(again.status, "QUEUED");
    });

    it("남의 run·RUNNING run·업무 역할이 VIEWER 인 요청자·org-02 사용자·없는 run 은 false 이고 행이 그대로다 — 로그아웃은 실행 권한 오류다", async (t) => {
      const pglite = await solDb(t);
      await as(pglite, "sales");
      const [{ id: queued }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
        idempotency_key: KEY1,
      });
      const [{ id: running }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.1", {
        idempotency_key: KEY2,
      });
      await asWorker(pglite);
      await pglite.query(
        "update public.score_runs set status = 'RUNNING', started_at = now() where id = $1",
        [running],
      );
      // org-02 VIEWER 가 요청자로 적힌 QUEUED run(관리 작업으로 넣는다). 요청자라도 업무 역할이 VIEWER 라 풀지 못한다.
      const [{ id: viewerRun }] = await rowsOf(
        pglite,
        `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
           run_mode, ai_provider, idempotency_key, requested_by)
         values ($1, $2, $3, $4, 1, 'sol-v0.2.0', 'MOCK', 'MOCK', $5, $6) returning id`,
        [ORG2, BID1, REV1, PROFILE2, KEY_ORG2, WHO.outsider],
      );
      const snapshot = () =>
        rowsOf(
          pglite,
          "select id, status, error_code, idempotency_key, started_at, finished_at from public.score_runs order by id",
        );
      const before = await snapshot();
      for (const [who, id, why] of [
        ["analyst", queued, "같은 조직의 남의 run"],
        ["admin", queued, "ADMIN 도 남의 run 은 못 푼다"],
        ["sales", running, "RUNNING"],
        ["outsider", queued, "다른 조직"],
        ["outsider", viewerRun, "요청자지만 VIEWER"],
        ["viewer", queued, "VIEWER"],
        ["operator", queued, "비멤버 운영자"],
        ["sales", MISSING_RUN, "없는 run"],
      ]) {
        await as(pglite, who);
        assert.deepEqual(await release(pglite, id), [{ released: false }], `${who}: ${why}`);
      }
      await asAnon(pglite);
      await assert.rejects(release(pglite, queued), functionDenied("release_unqueued_score_run"));
      await asWorker(pglite);
      assert.deepEqual(await snapshot(), before);
    });

    it("latest_ingest_run 은 업무 역할이 있는 사용자(다른 조직 포함)에게 출처별 최신 수집 run 한 줄의 상태·시각·요약만 준다 — demo 는 fixture, live 는 g2b, all 은 전부이고, 조직 없는 사용자는 0행, 로그아웃은 실행 권한 오류다", async (t) => {
      const pglite = await solDb(t);
      await asWorker(pglite);
      const SUMMARY = {
        created: 19,
        changed: 0,
        cancelled: 0,
        skippedDuplicate: 0,
        quarantined: 1,
        retried: 0,
      };
      await pglite.query(
        "update public.ingest_runs set summary = $1, started_at = now() - interval '2 hours' where id = $2",
        [JSON.stringify(SUMMARY), INGEST1],
      );
      // 더 오래된 fixture run. 최신 한 줄에 나오지 않는다.
      await pglite.query(
        `insert into public.ingest_runs (source, run_mode, job_key, trigger, batch, status, summary, started_at, finished_at)
         values ('fixture', 'MOCK', 'ingest:fixture:old', 'DEMO', 'SEED', 'SUCCEEDED', '{"created":1}',
           now() - interval '1 day', now() - interval '1 day')`,
      );
      const runOf = async (where) =>
        (
          await rowsOf(
            pglite,
            `select status, started_at, finished_at, summary from public.ingest_runs where ${where}`,
          )
        )[0];
      const demoRun = await runOf(`id = '${INGEST1}'`);
      assert.deepEqual(demoRun.summary, SUMMARY);
      const MEMBERS = ["admin", "sales", "analyst", "viewer", "outsider"];
      for (const who of MEMBERS) {
        await as(pglite, who);
        const rows = await latestIngest(pglite, "demo");
        assert.deepEqual(rows, [demoRun], `${who} demo`);
        assert.deepEqual(
          Object.keys(rows[0]),
          ["status", "started_at", "finished_at", "summary"],
          `${who} 열`,
        );
        assert.deepEqual(
          await latestIngest(pglite, "live"),
          [],
          `${who} live 는 fixture 를 주지 않는다`,
        );
        assert.deepEqual(await latestIngest(pglite, "all"), [demoRun], `${who} all`);
      }

      // g2b run 이 생기면 live 는 그것을, all 은 가장 최근 것을 준다. demo 는 그대로 fixture 다.
      await asWorker(pglite);
      await pglite.query(
        `insert into public.ingest_runs (source, run_mode, job_key, trigger, status, summary, quota_used, started_at)
         values ('g2b', 'LIVE', 'ingest:g2b:1', 'SCHEDULED', 'RUNNING', '{"created":3}', 3, now() - interval '1 hour')`,
      );
      const liveRun = await runOf("source = 'g2b'");
      for (const who of MEMBERS) {
        await as(pglite, who);
        assert.deepEqual(await latestIngest(pglite, "live"), [liveRun], `${who} live`);
        assert.deepEqual(await latestIngest(pglite, "all"), [liveRun], `${who} all`);
        assert.deepEqual(await latestIngest(pglite, "demo"), [demoRun], `${who} demo`);
        assert.deepEqual(await latestIngest(pglite, "unknown"), [], `${who} 모르는 출처`);
      }

      for (const who of ["invitee", "operator"]) {
        await as(pglite, who);
        for (const origin of ["demo", "live", "all"])
          assert.deepEqual(await latestIngest(pglite, origin), [], `${who} ${origin}`);
      }
      await asAnon(pglite);
      await assert.rejects(latestIngest(pglite, "demo"), functionDenied("latest_ingest_run"));
    });

    it("bid_list_items 의 열 이름·타입은 화면 계약 그대로이고, 화면 역할 권한은 authenticated 의 SELECT 하나다 — 로그아웃은 권한 오류다", async (t) => {
      const pglite = await solDb(t);
      assert.deepEqual(
        (
          await rowsOf(
            pglite,
            `select column_name, data_type from information_schema.columns
             where table_schema = 'public' and table_name = 'bid_list_items' order by ordinal_position`,
          )
        ).map(({ column_name, data_type }) => `${column_name} ${data_type}`),
        [
          "id uuid",
          "source text",
          "notice_id text",
          "title text",
          "agency text",
          "stage text",
          "budget_krw numeric",
          "budget_krw_text text",
          "published_at timestamp with time zone",
          "deadline_at timestamp with time zone",
          "latest_revision integer",
          "plan_ref text",
          "is_demo boolean",
          "source_url text",
          "last_synced_at timestamp with time zone",
          "status text",
          "latest_run_id uuid",
          "latest_run_status text",
          "latest_run_score smallint",
          "latest_run_recommendation text",
          "latest_run_basis text",
          "latest_run_flags ARRAY",
          "latest_run_created_at timestamp with time zone",
          "scored_score smallint",
          "scored_recommendation text",
          "latest_decision text",
          "latest_decided_at timestamp with time zone",
          "latest_reviewer_display_name text",
          "latest_reviewer_email text",
          "docs_total integer",
          "docs_pending integer",
          "docs_parsed integer",
          "docs_partial integer",
          "docs_unsupported integer",
          "docs_failed integer",
          "docs_download_failed integer",
        ],
      );
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'bid_list_items' and grantee in ('anon', 'authenticated', 'PUBLIC')
           order by 1, 2`,
        ),
        [{ grantee: "authenticated", privilege_type: "SELECT" }],
      );
      await asAnon(pglite);
      await assert.rejects(
        rowsOf(pglite, "select id from public.bid_list_items"),
        /permission denied for view bid_list_items/,
      );
    });

    it("bid_list_items — org-01 VIEWER 는 BID1 의 최신 run RUN1·점수·결정을 보고, 새 QUEUED run 이 생기면 최신 run 은 그것이지만 점수는 마지막 완료 run 의 것이며, 최신 결정은 검토자 이름·이메일과 함께 나온다", async (t) => {
      const pglite = await solDb(t);
      await as(pglite, "viewer");
      assert.deepEqual(await listOf(pglite), [
        { ...BID1_ROW, ...NO_ORG_DATA, ...completedRun(RUN1), latest_decision: "BID" },
        { ...BID2_ROW, ...NO_ORG_DATA },
      ]);

      await as(pglite, "sales");
      const [{ id: queued }] = await requestRun(pglite, ORG1, PROFILE1, "sol-v0.2.0", {
        idempotency_key: KEY1,
      });
      await decide(pglite, { decision: "WATCH", reason: "새 분석을 기다리며 지켜본다" });
      await asWorker(pglite);
      const [reviewer] = await rowsOf(
        pglite,
        "select display_name, email from public.profiles where id = $1",
        [WHO.sales],
      );
      assert.equal(reviewer.email, EMAIL.sales);
      for (const who of ["admin", "sales", "analyst", "viewer"]) {
        await as(pglite, who);
        const [bid1] = await listOf(pglite);
        assert.deepEqual(
          bid1,
          {
            ...BID1_ROW,
            latest_run_id: queued,
            latest_run_status: "QUEUED",
            latest_run_score: null,
            latest_run_recommendation: null,
            latest_run_basis: null,
            latest_run_flags: [],
            scored_score: 82,
            scored_recommendation: "BID",
            latest_decision: "WATCH",
            latest_reviewer_display_name: reviewer.display_name,
            latest_reviewer_email: reviewer.email,
          },
          who,
        );
      }
    });

    it("bid_list_items 는 security_invoker 다 — org-02 VIEWER 는 공고를 모두 보지만 org-01 의 run·결정은 보지 않고(자기 조직 것만), 비멤버 운영자는 조직 열이 모두 비어 있다", async (t) => {
      const pglite = await solDb(t);
      // org-01 만 BID2 를 분석·결정한다.
      await as(pglite, "sales");
      const [{ id: bid2Run }] = await rowsOf(
        pglite,
        `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
           run_mode, ai_provider, idempotency_key)
         values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK', $5) returning id`,
        [ORG1, BID2, REV2, PROFILE1, KEY1],
      );
      await decide(pglite, { bid_id: BID2, revision_id: REV2, decision: "NO_BID" });

      await as(pglite, "viewer");
      const [, bid2] = await listOf(pglite);
      assert.equal(bid2.latest_run_id, bid2Run);
      assert.equal(bid2.latest_decision, "NO_BID");

      // BID1 은 두 조직이 모두 분석·결정했다(seed). org-02 는 RUN2·WATCH 를, org-01 은 RUN1·BID 를 본다.
      await as(pglite, "outsider");
      assert.deepEqual(await listOf(pglite), [
        { ...BID1_ROW, ...NO_ORG_DATA, ...completedRun(RUN2), latest_decision: "WATCH" },
        { ...BID2_ROW, ...NO_ORG_DATA },
      ]);
      await as(pglite, "operator");
      assert.deepEqual(await listOf(pglite), [
        { ...BID1_ROW, ...NO_ORG_DATA },
        { ...BID2_ROW, ...NO_ORG_DATA },
      ]);
    });

    it("bid_list_items 의 status 는 OPEN·AMENDED 이고 마감이 지났으면 CLOSED, 아니면 저장 값이다(B14) — 마감 없음·남은 마감·CANCELLED 는 그대로다", async (t) => {
      const pglite = await solDb(t);
      const statusOf = async (stored, deadline) => {
        await asWorker(pglite);
        await pglite.query(
          `update public.bid_notices set status = $1, deadline_at = now() + $2::interval where id = $3`,
          [stored, deadline, BID2],
        );
        await as(pglite, "viewer");
        return (
          await rowsOf(pglite, "select status from public.bid_list_items where id = $1", [BID2])
        )[0].status;
      };
      for (const [stored, deadline, expected] of [
        ["OPEN", "-1 minute", "CLOSED"],
        ["AMENDED", "-1 day", "CLOSED"],
        ["OPEN", "1 day", "OPEN"],
        ["AMENDED", "1 day", "AMENDED"],
        ["CANCELLED", "-1 day", "CANCELLED"],
        ["CLOSED", "1 day", "CLOSED"],
      ])
        assert.equal(await statusOf(stored, deadline), expected, `${stored} ${deadline}`);
      // 마감이 없으면 저장 값 그대로다(BID1).
      assert.deepEqual(
        await rowsOf(pglite, "select status from public.bid_list_items where id = $1", [BID1]),
        [{ status: "OPEN" }],
      );
      // CLOSED 는 조회할 때만 계산한다. 저장 값은 OPEN 그대로다.
      assert.equal(await statusOf("OPEN", "-1 minute"), "CLOSED");
      await asWorker(pglite);
      assert.deepEqual(
        await rowsOf(pglite, "select status from public.bid_notices where id = $1", [BID2]),
        [{ status: "OPEN" }],
      );
    });

    it("bid_list_items 의 첨부 집계는 최신 revision 의 첨부만 센다 — 대기(다운로드 PENDING 또는 OK + 파싱 null·PENDING)·PARSED·PARTIAL·UNSUPPORTED·파싱 FAILED·다운로드 FAILED", async (t) => {
      const pglite = await solDb(t);
      await asWorker(pglite);
      const REV1_2 = "be500000-0000-0000-0000-000000000011";
      await pglite.query(
        "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $2, 2, '{}', '{}', 'sum-0001-2')",
        [REV1_2, BID1],
      );
      await pglite.query("update public.bid_notices set latest_revision = 2 where id = $1", [BID1]);
      const documents = [
        ["PENDING", null, null, null],
        ["OK", null, null, null],
        ["OK", "PENDING", null, null],
        ["OK", "PARSED", null, null],
        ["OK", "PARTIAL", null, null],
        ["OK", "UNSUPPORTED", "UNSUPPORTED_FORMAT", null],
        ["OK", "FAILED", "PARSER_ERROR", null],
        ["FAILED", null, null, "HTTP_5XX"],
      ];
      for (const [i, [download, parse, parseError, downloadError]] of documents.entries()) {
        const ok = download === "OK";
        await pglite.query(
          `insert into public.bid_documents (bid_id, revision_id, name, original_url, download_status, download_error_code,
             object_key, sha256, size_bytes, parse_status, parse_error_code)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            BID1,
            REV1_2,
            `첨부-${i}.pdf`,
            `https://www.g2b.go.kr/doc/r2-${i}`,
            download,
            downloadError,
            ok ? `bids/${BID1}/r2-${i}` : null,
            ok ? `sha-r2-${i}` : null,
            ok ? 1024 : null,
            parse,
            parseError,
          ],
        );
      }
      await as(pglite, "viewer");
      assert.deepEqual(
        await rowsOf(
          pglite,
          `select docs_total, docs_pending, docs_parsed, docs_partial, docs_unsupported, docs_failed, docs_download_failed
           from public.bid_list_items where id = $1`,
          [BID1],
        ),
        [
          {
            docs_total: 8,
            docs_pending: 3,
            docs_parsed: 1,
            docs_partial: 1,
            docs_unsupported: 1,
            docs_failed: 1,
            docs_download_failed: 1,
          },
        ],
      );
    });
  });
});

// ────────────────────────────────────────────────────────────────
// 수집 저장 함수 ingest_save_revision(p jsonb)(20261019000009) — 공고·revision·첨부·outbox 이벤트를 함수 하나(한 트랜잭션)로 쓴다.
// 근거: C3 계약 Stage 6 › 6-1, docs/04-DATABASE.md §3.3·§3.6, docs/07-DATA-PIPELINE.md §5.
// worker(service role)만 부른다. PGlite 에는 service_role 역할이 없어, 호출은 위 Phase 1 묶음처럼 화면 역할을 벗고
// service_role claim 을 싣는 것으로 흉내 낸다. 실행 권한(grant)은 service_role 역할을 먼저 만든 DB 에서 따로 본다.
// 모든 시험은 자기만 쓰는 새 DB 에서 돈다.
// ────────────────────────────────────────────────────────────────
describe("수집 저장 함수 — ingest_save_revision (C3 Stage 6)", () => {
  const NOTICE_ID = "DEMO-2026-0101";
  const BID = "b1d00000-0000-0000-0000-000000000101";
  const OTHER_BID = "b1d00000-0000-0000-0000-000000000199";
  const REV_1 = "be500000-0000-0000-0000-000000000101";
  const REV_2 = "be500000-0000-0000-0000-000000000102";
  const TABLES = ["bid_notices", "bid_revisions", "bid_documents", "outbox_events"];
  const EMPTY = Object.fromEntries(TABLES.map((table) => [table, 0]));
  const FUNCTION = "public.ingest_save_revision(jsonb)";
  const DENIED = { code: "42501", message: /permission denied for function ingest_save_revision/ };

  const NOTICE = {
    source: "fixture",
    notice_id: NOTICE_ID,
    plan_ref: "PLAN-2026-0101",
    pre_spec_ref: "PRE-2026-0101",
    title: "클라우드 전환 컨설팅",
    agency: "시험기관",
    stage: "NOTICE",
    status: "OPEN",
    budget_krw: "1200000000",
    published_at: "2026-10-19T00:00:00.000Z",
    deadline_at: "2026-11-02T09:00:00.000Z",
    source_url: "https://fixture.invalid/0101",
    is_demo: true,
  };
  // original_url 순서로 둔다(읽을 때 그 순서로 정렬한다).
  const DOCUMENTS = [
    { name: "제안요청서.pdf", original_url: "https://fixture.invalid/0101/rfp.pdf" },
    { name: "과업지시서.hwp", original_url: "https://fixture.invalid/0101/sow.hwp" },
  ];
  const eventTypeOf = (revision) => (revision === 1 ? "BID_CREATED" : "BID_CHANGED");
  // 07 §5 의 멱등키 source+noticeId+revision+eventType.
  const keyOf = (revision, source = NOTICE.source) =>
    `${source}:${NOTICE_ID}:${revision}:${eventTypeOf(revision)}`;
  const changedFieldsOf = (revision) => (revision === 1 ? [] : ["deadlineAt"]);

  // 6-1 의 p. 차수마다 checksum·fetched_at·이벤트가 다르고, 시험마다 고칠 부분만 덮어쓴다.
  const paramsOf = (
    revision,
    { ids = {}, notice = {}, rev = {}, documents = DOCUMENTS, event = {} } = {},
  ) => ({
    ...ids,
    notice: { ...NOTICE, ...notice },
    revision: {
      revision,
      amendment_no: revision === 1 ? null : String(revision - 1).padStart(2, "0"),
      raw_payload: { fixtureId: "FX-01", noticeId: NOTICE_ID, revision },
      normalized: { noticeId: NOTICE_ID, revision, title: notice.title ?? NOTICE.title },
      checksum: `sum-0101-${revision}`,
      changed_fields: changedFieldsOf(revision),
      fetched_at: `2026-10-${18 + revision}T01:00:00.000Z`,
      ...rev,
    },
    documents,
    event: {
      event_type: eventTypeOf(revision),
      idempotency_key: keyOf(revision),
      payload: {
        source: NOTICE.source,
        noticeId: NOTICE_ID,
        revision,
        kind: revision === 1 ? "CREATED" : "CHANGED",
        changedFields: changedFieldsOf(revision),
      },
      ...event,
    },
  });

  // worker 자리 — 화면 역할을 벗고 service_role claim 을 싣는다(Phase 1 묶음의 service_role 흉내와 같다).
  const asServiceRole = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
  };
  // 지금 역할 그대로 부른다.
  const call = async (pglite, p) =>
    (
      await pglite.query("select bid_id, revision_id from public.ingest_save_revision($1::jsonb)", [
        JSON.stringify(p),
      ])
    ).rows;
  const save = async (pglite, p) => {
    await asServiceRole(pglite);
    return call(pglite, p);
  };
  // 읽기는 화면 역할을 벗고 RLS 없이 본다.
  const rowsOf = async (pglite, sql, params = []) => {
    await pglite.exec("reset role");
    return (await pglite.query(sql, params)).rows;
  };
  const countsOf = async (pglite) =>
    (
      await rowsOf(
        pglite,
        `select ${TABLES.map((table) => `(select count(*)::int from public.${table}) as ${table}`).join(", ")}`,
      )
    )[0];
  const iso = (value) => (value === null ? null : value.toISOString());
  const noticeRowsOf = async (pglite) =>
    (
      await rowsOf(
        pglite,
        `select id, source, notice_id, plan_ref, pre_spec_ref, title, agency, stage, status, budget_krw::text as budget_krw,
           published_at, deadline_at, source_url, is_demo, latest_revision, content_hash, last_synced_at
         from public.bid_notices order by source, notice_id`,
      )
    ).map((row) => ({
      ...row,
      published_at: iso(row.published_at),
      deadline_at: iso(row.deadline_at),
      last_synced_at: iso(row.last_synced_at),
    }));
  // 오류 시험의 "아무것도 바뀌지 않았다" 기준 — 네 표의 행 수와 공고 행 전체.
  const snapshotOf = async (pglite) => ({
    counts: await countsOf(pglite),
    notices: await noticeRowsOf(pglite),
  });

  it("실행 권한은 service_role 에만 있다 — anon·authenticated·PUBLIC 은 없다", async (t) => {
    // 실제 Supabase 에는 service_role 역할이 있다. 흉내 DB 에 없으면 마이그레이션 전에 만들어 같은 조건에서 grant 를 본다.
    const fresh = await freshDb(t);
    await fresh.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin;
        end if;
      end $$;
    `);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(
      (
        await fresh.query(
          `select
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
           from pg_proc p where p.oid = to_regprocedure($1)`,
          [FUNCTION],
        )
      ).rows,
      [{ public: false, anon: false, authenticated: false, service_role: true }],
    );
  });

  it("함수는 security invoker 이고 search_path 를 빈 값으로 고정한다", async (t) => {
    const pglite = await migratedDb(t);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select prosecdef, proconfig from pg_proc where oid = to_regprocedure($1)",
        [FUNCTION],
      ),
      [{ prosecdef: false, proconfig: ['search_path=""'] }],
    );
  });

  it("로그아웃한 사용자(anon)가 부르면 권한 오류이고 아무 행도 생기지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await actAs(pglite, null, "anon");
    await assert.rejects(call(pglite, paramsOf(1)), DENIED);
    assert.deepEqual(await countsOf(pglite), EMPTY);
  });

  it("로그인한 사용자(authenticated)는 운영자라도 부르면 권한 오류이고 아무 행도 생기지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [users[2]]);
    for (const id of [users[0], users[2]]) {
      await actAs(pglite, id);
      await assert.rejects(call(pglite, paramsOf(1)), DENIED, id);
    }
    assert.deepEqual(await countsOf(pglite), EMPTY);
  });

  it("service_role 한 번 호출로 공고·revision·첨부 2개·outbox 이벤트를 함께 쓰고 그것을 잇는 (bid_id, revision_id) 한 행을 돌려준다", async (t) => {
    const pglite = await migratedDb(t);
    const returned = await save(pglite, paramsOf(1));
    assert.equal(returned.length, 1);
    const [{ bid_id: bidId, revision_id: revisionId }] = returned;
    assert.deepEqual(await countsOf(pglite), {
      bid_notices: 1,
      bid_revisions: 1,
      bid_documents: 2,
      outbox_events: 1,
    });
    assert.deepEqual(await rowsOf(pglite, "select id from public.bid_notices"), [{ id: bidId }]);
    assert.deepEqual(await rowsOf(pglite, "select id, bid_id from public.bid_revisions"), [
      { id: revisionId, bid_id: bidId },
    ]);
    assert.deepEqual(
      await rowsOf(pglite, "select distinct bid_id, revision_id from public.bid_documents"),
      [{ bid_id: bidId, revision_id: revisionId }],
    );
    assert.deepEqual(await rowsOf(pglite, "select aggregate_id from public.outbox_events"), [
      { aggregate_id: bidId },
    ]);
  });

  it("revision 1 의 공고 행은 notice 필드를 그대로 담고 latest_revision 은 1, content_hash 는 checksum, last_synced_at 은 fetched_at 이다", async (t) => {
    const pglite = await migratedDb(t);
    const p = paramsOf(1);
    const [{ bid_id: bidId }] = await save(pglite, p);
    assert.deepEqual(await noticeRowsOf(pglite), [
      {
        id: bidId,
        ...NOTICE,
        latest_revision: 1,
        content_hash: p.revision.checksum,
        last_synced_at: p.revision.fetched_at,
      },
    ]);
  });

  it("notice 의 빈 값(plan_ref·pre_spec_ref·agency·budget_krw·published_at·deadline_at 이 null)은 null 로 저장한다", async (t) => {
    const pglite = await migratedDb(t);
    const blanks = {
      plan_ref: null,
      pre_spec_ref: null,
      agency: null,
      budget_krw: null,
      published_at: null,
      deadline_at: null,
    };
    const p = paramsOf(1, { notice: blanks });
    const [{ bid_id: bidId }] = await save(pglite, p);
    assert.deepEqual(await noticeRowsOf(pglite), [
      {
        id: bidId,
        ...NOTICE,
        ...blanks,
        latest_revision: 1,
        content_hash: p.revision.checksum,
        last_synced_at: p.revision.fetched_at,
      },
    ]);
  });

  it("revision 행은 p.revision 의 차수·amendment_no·원본·정규화·checksum·changed_fields·fetched_at 을 그대로 담는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    const p = paramsOf(2);
    const [{ bid_id: bidId, revision_id: revisionId }] = await save(pglite, p);
    const rows = await rowsOf(
      pglite,
      "select id, bid_id, revision, amendment_no, raw_payload, normalized, checksum, changed_fields, fetched_at from public.bid_revisions where revision = 2",
    );
    assert.deepEqual(
      rows.map((row) => ({ ...row, fetched_at: iso(row.fetched_at) })),
      [{ id: revisionId, bid_id: bidId, ...p.revision }],
    );
  });

  it("첨부 2개는 그 revision 에 묶인 bid_documents 2행이 되고 download_status 는 PENDING 이다", async (t) => {
    const pglite = await migratedDb(t);
    const [{ bid_id: bidId, revision_id: revisionId }] = await save(pglite, paramsOf(1));
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select bid_id, revision_id, name, original_url, download_status from public.bid_documents order by original_url",
      ),
      DOCUMENTS.map((document) => ({
        bid_id: bidId,
        revision_id: revisionId,
        ...document,
        download_status: "PENDING",
      })),
    );
  });

  it("첨부가 없으면 bid_documents 행 없이 공고·revision·outbox 이벤트만 쓴다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1, { documents: [] }));
    assert.deepEqual(await countsOf(pglite), {
      bid_notices: 1,
      bid_revisions: 1,
      bid_documents: 0,
      outbox_events: 1,
    });
  });

  it("outbox 이벤트는 org_id null·aggregate_type bid_notice·aggregate_id 공고 id 로 event_type·payload·idempotency_key 를 그대로 담고 PENDING 이다", async (t) => {
    const pglite = await migratedDb(t);
    const p = paramsOf(1);
    const [{ bid_id: bidId }] = await save(pglite, p);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status from public.outbox_events",
      ),
      [
        {
          org_id: null,
          aggregate_type: "bid_notice",
          aggregate_id: bidId,
          ...p.event,
          status: "PENDING",
        },
      ],
    );
  });

  it("bid_id·revision_id 를 주면 그 id 로 저장하고 그대로 돌려준다 — revision 2 도 같은 bid_id 와 새 revision_id 로", async (t) => {
    const pglite = await migratedDb(t);
    assert.deepEqual(
      await save(pglite, paramsOf(1, { ids: { bid_id: BID, revision_id: REV_1 } })),
      [{ bid_id: BID, revision_id: REV_1 }],
    );
    assert.deepEqual(
      await save(pglite, paramsOf(2, { ids: { bid_id: BID, revision_id: REV_2 } })),
      [{ bid_id: BID, revision_id: REV_2 }],
    );
    assert.deepEqual(await rowsOf(pglite, "select id from public.bid_notices"), [{ id: BID }]);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select id, bid_id, revision from public.bid_revisions order by revision",
      ),
      [
        { id: REV_1, bid_id: BID, revision: 1 },
        { id: REV_2, bid_id: BID, revision: 2 },
      ],
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select distinct bid_id, revision_id from public.bid_documents order by revision_id",
      ),
      [
        { bid_id: BID, revision_id: REV_1 },
        { bid_id: BID, revision_id: REV_2 },
      ],
    );
  });

  it("revision 2 는 같은 공고 행의 필드·latest_revision·content_hash·last_synced_at 을 갱신하고 revision 행이 2개가 된다", async (t) => {
    const pglite = await migratedDb(t);
    const [first] = await save(pglite, paramsOf(1));
    const changed = {
      title: "클라우드 전환 컨설팅(정정)",
      agency: "시험기관 정보화담당관",
      status: "AMENDED",
      budget_krw: "1500000000",
      published_at: "2026-10-20T00:00:00.000Z",
      deadline_at: "2026-11-09T09:00:00.000Z",
      source_url: "https://fixture.invalid/0101-01",
    };
    const p = paramsOf(2, { notice: changed });
    const [second] = await save(pglite, p);
    assert.equal(second.bid_id, first.bid_id);
    assert.notEqual(second.revision_id, first.revision_id);
    assert.deepEqual(await noticeRowsOf(pglite), [
      {
        id: first.bid_id,
        ...NOTICE,
        ...changed,
        latest_revision: 2,
        content_hash: p.revision.checksum,
        last_synced_at: p.revision.fetched_at,
      },
    ]);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select id, revision, checksum from public.bid_revisions order by revision",
      ),
      [
        { id: first.revision_id, revision: 1, checksum: "sum-0101-1" },
        { id: second.revision_id, revision: 2, checksum: "sum-0101-2" },
      ],
    );
  });

  it("revision 2 는 (source, notice_id) 로 공고를 찾는다 — notice_id 가 같아도 source 가 다른 공고는 그대로다", async (t) => {
    const pglite = await migratedDb(t);
    const g2b = {
      source: "g2b-bid-notice",
      is_demo: false,
      source_url: "https://www.g2b.go.kr/0101",
    };
    const [fixtureBid] = await save(pglite, paramsOf(1));
    const [g2bBid] = await save(
      pglite,
      paramsOf(1, { notice: g2b, event: { idempotency_key: keyOf(1, g2b.source) } }),
    );
    assert.notEqual(g2bBid.bid_id, fixtureBid.bid_id);
    const [second] = await save(
      pglite,
      paramsOf(2, {
        notice: { ...g2b, title: "정정 공고" },
        event: { idempotency_key: keyOf(2, g2b.source) },
      }),
    );
    assert.equal(second.bid_id, g2bBid.bid_id);
    assert.deepEqual(
      (await noticeRowsOf(pglite)).map(({ id, source, title, latest_revision }) => ({
        id,
        source,
        title,
        latest_revision,
      })),
      [
        { id: fixtureBid.bid_id, source: "fixture", title: NOTICE.title, latest_revision: 1 },
        { id: g2bBid.bid_id, source: "g2b-bid-notice", title: "정정 공고", latest_revision: 2 },
      ],
    );
  });

  it("같은 idempotency_key 의 outbox 이벤트는 무시하지만 그 revision 은 저장한다 — 이벤트 행은 처음 것 하나 그대로다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    const [second] = await save(pglite, paramsOf(2, { event: { idempotency_key: keyOf(1) } }));
    assert.deepEqual(await countsOf(pglite), {
      bid_notices: 1,
      bid_revisions: 2,
      bid_documents: 4,
      outbox_events: 1,
    });
    assert.deepEqual(
      await rowsOf(pglite, "select id from public.bid_revisions where revision = 2"),
      [{ id: second.revision_id }],
    );
    assert.equal((await noticeRowsOf(pglite))[0].latest_revision, 2);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select event_type, idempotency_key, payload ->> 'revision' as revision from public.outbox_events",
      ),
      [{ event_type: "BID_CREATED", idempotency_key: keyOf(1), revision: "1" }],
    );
  });

  it("같은 (source, notice_id) 에 revision 1 을 다시 주면 INGEST_BID_EXISTS 이고 덮어쓰지도 행을 늘리지도 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    const before = await snapshotOf(pglite);
    await assert.rejects(
      save(
        pglite,
        paramsOf(1, {
          notice: { title: "다른 제목" },
          rev: { checksum: "sum-other" },
          event: { idempotency_key: `${keyOf(1)}-again` },
        }),
      ),
      { message: "INGEST_BID_EXISTS" },
    );
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("revision 2 인데 bid_id 가 저장된 공고와 다르면 INGEST_BID_ID_MISMATCH 이고 아무 행도 늘지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1, { ids: { bid_id: BID } }));
    const before = await snapshotOf(pglite);
    await assert.rejects(save(pglite, paramsOf(2, { ids: { bid_id: OTHER_BID } })), {
      message: "INGEST_BID_ID_MISMATCH",
    });
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("latest_revision 이 1 인데 revision 3 을 주면 INGEST_REVISION_CONFLICT 이고 아무 행도 늘지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    const before = await snapshotOf(pglite);
    await assert.rejects(save(pglite, paramsOf(3)), { message: "INGEST_REVISION_CONFLICT" });
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("이미 저장한 revision 2 를 다시 주면 INGEST_REVISION_CONFLICT 이고 아무 행도 늘지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    await save(pglite, paramsOf(2));
    const before = await snapshotOf(pglite);
    await assert.rejects(save(pglite, paramsOf(2)), { message: "INGEST_REVISION_CONFLICT" });
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("저장된 적 없는 공고에 revision 2 를 주면 INGEST_BID_NOT_FOUND 이고 아무 행도 생기지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await assert.rejects(save(pglite, paramsOf(2)), { message: "INGEST_BID_NOT_FOUND" });
    assert.deepEqual(await countsOf(pglite), EMPTY);
  });

  it("첨부 원소의 name 이 null 이면 NOT NULL 위반으로 실패하고 네 표 모두 롤백된다 — 행 수 0 그대로", async (t) => {
    const pglite = await migratedDb(t);
    await assert.rejects(
      save(pglite, paramsOf(1, { documents: [DOCUMENTS[0], { ...DOCUMENTS[1], name: null }] })),
      { code: "23502" },
    );
    assert.deepEqual(await countsOf(pglite), EMPTY);
  });

  it("revision 2 저장 중 첨부 name 이 null 이면 공고 갱신까지 되돌아간다 — 공고 행·네 표 행 수가 revision 1 그대로다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, paramsOf(1));
    const before = await snapshotOf(pglite);
    await assert.rejects(
      save(
        pglite,
        paramsOf(2, {
          notice: { title: "클라우드 전환 컨설팅(정정)", status: "AMENDED" },
          documents: [DOCUMENTS[0], { ...DOCUMENTS[1], name: null }],
        }),
      ),
      { code: "23502" },
    );
    assert.deepEqual(await snapshotOf(pglite), before);
  });
});

// ────────────────────────────────────────────────────────────────
// 분석 마감 함수 finish_score_run(p jsonb)와 score_runs.idempotency_key 조직 접두어 check(20261019000011) — C5-B 보안 후속.
// 근거: C5-B 보안 검토 후속(e8 판정: 번호 20261019000011·finish_score_run RPC·키 형식 `<orgId>:<Idempotency-Key>`),
// docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 한 트랜잭션에)·§3.4. 선례는 위 ingest_save_revision(20261019000009)이다.
// worker 의 sink 가 자식 3표(score_factors·requirement_assessments·qualification_checks)와 score_runs 마감을 함수 한 번으로 쓴다.
// 그 조직의 그 run 이 RUNNING 이고 started_at 이 이 시도의 시작 시각(attempt_started_at)일 때만 쓴다. 늦게 끝난 시도가 이미 끝난
// run(COMPLETED·PARTIAL·FAILED)이나 다른 시도가 다시 잡은 run 을 덮지 못한다. 거절은 raise exception 이고 메시지가 곧 코드다:
//   SCORE_RUN_NOT_FOUND   그 조직(p.org_id)에 그 run(p.score_run_id)이 없다
//   SCORE_RUN_NOT_RUNNING RUNNING 이 아니거나 started_at 이 attempt_started_at 과 다르다(자식 표를 건드리지 않는다)
// 마감 열은 저장 매핑 toScoreRunResultUpdate 의 키에서 started_at 을 뺀 24개다. 호출은 ingest_save_revision 묶음처럼 화면 역할을 벗고
// service_role claim 을 싣는 것으로 흉내 내고, 실행 권한(grant)은 service_role 역할을 먼저 만든 DB 에서 따로 본다. 모든 시험은 새 DB 에서 돈다.
// ────────────────────────────────────────────────────────────────
describe("분석 마감 함수 — finish_score_run (C5-B 보안 후속)", () => {
  const ORG1 = "0f000000-0000-4000-8000-000000000301";
  const ORG2 = "0f000000-0000-4000-8000-000000000302";
  const BID = "b1d00000-0000-0000-0000-000000000301";
  const REV = "be500000-0000-0000-0000-000000000301";
  const PROFILE1 = "c0000000-0000-0000-0000-000000000301"; // ORG1
  const PROFILE2 = "c0000000-0000-0000-0000-000000000302"; // ORG2
  const RUN = "a0000000-0000-4000-8000-000000000301"; // ORG1, 시험 대상 run
  const SIBLING = "a0000000-0000-4000-8000-000000000302"; // ORG1 의 다른 run(건드리면 안 된다)
  const ORG2_RUN = "a0000000-0000-4000-8000-000000000303"; // ORG2 의 run
  const MISSING = "a0000000-0000-4000-8000-0000000003ff"; // 어디에도 없는 run
  const ATTEMPT = "2026-10-19T09:00:00.000Z"; // 이 시도의 시작 시각(markRunning 의 started_at)
  const OTHER_ATTEMPT = "2026-10-19T09:00:00.001Z"; // 다른 시도
  const ADMIN = users[0]; // ORG1 owner + ADMIN
  const OPERATOR = users[2]; // 운영자(profiles.is_admin). 어느 조직에도 없다
  const FUNCTION = "public.finish_score_run(jsonb)";
  const DENIED = { code: "42501", message: /permission denied for function finish_score_run/ };
  const NOT_RUNNING = { message: "SCORE_RUN_NOT_RUNNING" };
  const NOT_FOUND = { message: "SCORE_RUN_NOT_FOUND" };
  const KEY_CHECK = { code: "23514", message: /score_runs_idempotency_key_org_check/ };

  // JWT 없는 관리 작업(seed 자리). RLS 를 거치지 않는다.
  const asWorker = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', '', false)");
  };
  // worker 자리 — 화면 역할을 벗고 service_role claim 을 싣는다(ingest_save_revision 묶음과 같다).
  const asServiceRole = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
  };
  // 읽기는 화면 역할을 벗고 RLS 없이 본다.
  const rowsOf = async (pglite, sql, params = []) => {
    await pglite.exec("reset role");
    return (await pglite.query(sql, params)).rows;
  };
  const iso = (value) => (value === null ? null : value.toISOString());
  const sortBy = (rows, key) => rows.toSorted((a, b) => (`${a[key]}` < `${b[key]}` ? -1 : 1));

  // 두 조직·공고 하나·회사 프로필 두 개. ORG1 에는 ADMIN(owner) 한 명이 있다.
  const seed = async (pglite) => {
    await asWorker(pglite);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [OPERATOR]);
    await pglite.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'org-finish-1', '마감 시험 조직', true), ($2, 'org-finish-2', '격리 조직', true)",
      [ORG1, ORG2],
    );
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'owner', 'ADMIN')",
      [ORG1, ADMIN],
    );
    await pglite.query(
      "insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, source_url, content_hash, is_demo) values ($1, 'fixture', 'DEMO-2026-0301', '분석 마감 시험 공고', '시험기관', 'NOTICE', 'OPEN', 500000000, 'https://fixture.invalid/0301', 'hash-0301', true)",
      [BID],
    );
    await pglite.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $2, 1, '{}', '{}', 'sum-0301')",
      [REV, BID],
    );
    await pglite.query(
      "insert into public.company_profiles (id, org_id, revision, name) values ($1, $3, 1, '마감 시험 조직'), ($2, $4, 1, '격리 조직')",
      [PROFILE1, PROFILE2, ORG1, ORG2],
    );
    return pglite;
  };
  const finishDb = async (t) => seed(await migratedDb(t));
  const profileOf = (org) => (org === ORG1 ? PROFILE1 : PROFILE2);

  // run 한 행을 seed 자리에서 넣는다. 진행 중 run 은 같은 입력에 하나뿐이라(score_runs_active_input_key) run 마다 알고리즘 버전을 다르게 둔다.
  // 끝난 run 은 앞 시도의 결과를 갖는다(COMPLETED·PARTIAL 은 입력 스냅샷이 있어야 한다, score_runs_finished_snapshot_check).
  const insertRun = async (
    pglite,
    id,
    { org = ORG1, status = "RUNNING", startedAt = ATTEMPT } = {},
  ) => {
    await asWorker(pglite);
    const done = ["COMPLETED", "PARTIAL"].includes(status);
    await pglite.query(
      `insert into public.score_runs (id, org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
         run_mode, ai_provider, status, started_at, finished_at, idempotency_key, score, recommendation, input_snapshot,
         input_snapshot_hash, error_code)
       values ($1, $2, $3, $4, $5, 1, $6, 'MOCK', 'MOCK', $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        org,
        BID,
        REV,
        profileOf(org),
        `sol-v0.1.0-${id.slice(-3)}`,
        status,
        startedAt,
        status === "QUEUED" || status === "RUNNING" ? null : "2026-10-19T08:59:00.000Z",
        `${org}:req-${id.slice(-3)}`,
        done ? 61 : null,
        done ? "WATCH" : null,
        done ? JSON.stringify({ schemaVersion: "analysis-input/v0.1", from: "앞 시도" }) : null,
        done ? "snap-earlier" : null,
        status === "FAILED" ? "STALE_RUN" : null,
      ],
    );
  };

  // 앞 시도가 남긴 자식 행 — 요소 하나(skillMatch, 다른 점수)·옛 항목 판정·옛 자격 판정.
  const insertEarlierChildren = async (pglite, run, org = ORG1) => {
    await asWorker(pglite);
    await pglite.query(
      "insert into public.score_factors (score_run_id, org_id, factor, points, max_points, note) values ($1, $2, 'skillMatch', 1, 30, '앞 시도')",
      [run, org],
    );
    await pglite.query(
      "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'requiredSkills[9]', 'SKILL', 'SATISFIED', 'EXTRACTION')",
      [run, org],
    );
    await pglite.query(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'LICENSE_OLD', '앞 시도의 자격', 'SATISFIED', '앞 시도', 'API_FIELD')",
      [run, org, BID, REV],
    );
  };

  // 마감 열 — 저장 매핑 toScoreRunResultUpdate 의 키에서 started_at 을 뺀 24개(설계 §2.1·§2.2).
  const RESULT = {
    status: "COMPLETED",
    score: 82,
    recommendation: "BID",
    recommendation_basis: "RULES_WITH_KEV_ASSIST",
    error_code: null,
    injection_suspected: false,
    explanation: "마감 시험 설명",
    review_flags: ["KEV_NEEDS_REVIEW"],
    missing_factors: ["scaleFit"],
    input_snapshot: { schemaVersion: "analysis-input/v0.1", bid: { noticeId: "DEMO-2026-0301" } },
    input_snapshot_hash: "snap-finish-0301",
    kev_output: { questionSetVersion: "kev-qs/v0.1", wire: [] },
    kev_assist: { enabled: true, suggestedOption: "BID" },
    model_metadata: { provider: "mock", explanationSource: "TEMPLATE" },
    qwen_model: "fixture",
    prompt_hash: "p-0301",
    kev_model: "mock",
    question_set_version: "kev-qs/v0.1",
    run_mode: "MOCK",
    ai_provider: "MOCK",
    extraction_id: null,
    finished_at: "2026-10-19T09:00:05.000Z",
    kev_calibration: null,
    fallback_reason: null,
  };
  const FACTORS = [
    "skillMatch",
    "pastPerformance",
    "staffAvailability",
    "scaleFit",
    "strategicPreference",
  ];
  // 저장 매핑(toScoreFactorRows·toRequirementAssessmentRows·toQualificationCheckRows)의 출력과 같은 열의 행.
  const factorRows = (run, org) =>
    FACTORS.map((factor, index) => ({
      score_run_id: run,
      org_id: org,
      factor,
      raw_value: { index },
      normalized: factor === "scaleFit" ? null : 0.5,
      points: factor === "scaleFit" ? 0 : 10 + index,
      max_points: 20,
      missing: factor === "scaleFit",
      missing_reason: factor === "scaleFit" ? "BUDGET_UNKNOWN" : null,
      evidence: [],
      note: `요소 ${index}`,
    }));
  const assessmentRows = (run, org) => [
    {
      score_run_id: run,
      org_id: org,
      item_id: "qualifications[0]",
      item_kind: "QUALIFICATION",
      rule_status: "SATISFIED",
      rule_reason: null,
      basis: "API_FIELD",
      notice_evidence: [],
      company_evidence: [],
      kev_distribution: null,
      kev_label: null,
      flags: [],
    },
    {
      score_run_id: run,
      org_id: org,
      item_id: "requiredSkills[0]",
      item_kind: "SKILL",
      rule_status: "NEEDS_REVIEW",
      rule_reason: "COMPANY_EVIDENCE_MISSING",
      basis: "EXTRACTION",
      notice_evidence: [{ kind: "TEXT", quotedText: "클라우드 전환" }],
      company_evidence: [],
      kev_distribution: null,
      kev_label: null,
      flags: ["KEV_NEEDS_REVIEW"],
    },
  ];
  const checkRows = (run, org) => [
    {
      score_run_id: run,
      org_id: org,
      bid_id: BID,
      revision_id: REV,
      requirement_code: "LICENSE_1468",
      requirement_name: "소프트웨어사업자",
      mandatory: true,
      outcome: "SATISFIED",
      reason_code: null,
      reason: "보유 면허와 일치",
      basis: "API_FIELD",
      evidence: [],
      profile_evidence: null,
      company_evidence: [],
    },
    {
      score_run_id: run,
      org_id: org,
      bid_id: BID,
      revision_id: REV,
      requirement_code: null,
      requirement_name: "실적 요건",
      mandatory: true,
      outcome: "NEEDS_REVIEW",
      reason_code: "NOTICE_INFO_MISSING",
      reason: "공고에 실적 기준이 없다",
      basis: "EXTRACTION",
      evidence: [],
      profile_evidence: { type: "TEXT", ref: "profile", label: "회사 실적" },
      company_evidence: [],
    },
  ];
  // 설계 §2.2 의 p. 시험마다 고칠 부분만 덮어쓴다.
  const payloadOf = (run, { org = ORG1, attempt = ATTEMPT, result = {}, ...rows } = {}) => ({
    score_run_id: run,
    org_id: org,
    attempt_started_at: attempt,
    run: { ...RESULT, ...result },
    factors: rows.factors ?? factorRows(run, org),
    assessments: rows.assessments ?? assessmentRows(run, org),
    checks: rows.checks ?? checkRows(run, org),
  });

  // 지금 역할 그대로 부른다.
  const call = async (pglite, p) =>
    (await pglite.query("select public.finish_score_run($1::jsonb) as id", [JSON.stringify(p)]))
      .rows;
  const finish = async (pglite, p) => {
    await asServiceRole(pglite);
    return call(pglite, p);
  };

  const resultOf = async (pglite, run) => {
    const [row] = await rowsOf(
      pglite,
      `select ${[...Object.keys(RESULT), "started_at"].join(", ")} from public.score_runs where id = $1`,
      [run],
    );
    return { ...row, finished_at: iso(row.finished_at), started_at: iso(row.started_at) };
  };
  const factorsOf = async (pglite, run) =>
    sortBy(
      await rowsOf(
        pglite,
        `select score_run_id, org_id, factor, raw_value, normalized::float8 as normalized, points::float8 as points,
           max_points::float8 as max_points, missing, missing_reason, evidence, note
         from public.score_factors where score_run_id = $1`,
        [run],
      ),
      "factor",
    );
  const assessmentsOf = async (pglite, run) =>
    sortBy(
      await rowsOf(
        pglite,
        `select score_run_id, org_id, item_id, item_kind, rule_status, rule_reason, basis, notice_evidence, company_evidence,
           kev_distribution, kev_label, flags
         from public.requirement_assessments where score_run_id = $1`,
        [run],
      ),
      "item_id",
    );
  const checksOf = async (pglite, run) =>
    sortBy(
      await rowsOf(
        pglite,
        `select score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, mandatory, outcome, reason_code,
           reason, basis, evidence, profile_evidence, company_evidence
         from public.qualification_checks where score_run_id = $1`,
        [run],
      ),
      "requirement_name",
    );
  // "아무것도 바뀌지 않았다"의 기준 — score_runs 와 자식 3표의 모든 행·모든 열(id·시각 포함).
  const snapshotOf = async (pglite) => ({
    score_runs: await rowsOf(pglite, "select * from public.score_runs order by id"),
    score_factors: await rowsOf(pglite, "select * from public.score_factors order by id"),
    requirement_assessments: await rowsOf(
      pglite,
      "select * from public.requirement_assessments order by id",
    ),
    qualification_checks: await rowsOf(
      pglite,
      "select * from public.qualification_checks order by id",
    ),
  });

  it("실행 권한은 service_role 에만 있다 — anon·authenticated·PUBLIC 은 없다", async (t) => {
    // 실제 Supabase 에는 service_role 역할이 있다. 흉내 DB 에 없으면 마이그레이션 전에 만들어 같은 조건에서 grant 를 본다.
    const fresh = await freshDb(t);
    await fresh.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin;
        end if;
      end $$;
    `);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(
      (
        await fresh.query(
          `select
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
           from pg_proc p where p.oid = to_regprocedure($1)`,
          [FUNCTION],
        )
      ).rows,
      [{ public: false, anon: false, authenticated: false, service_role: true }],
    );
  });

  it("함수는 security invoker 이고 search_path 를 빈 값으로 고정하며 uuid 를 돌려준다", async (t) => {
    const pglite = await migratedDb(t);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select prosecdef, proconfig, prorettype::regtype::text as returns from pg_proc where oid = to_regprocedure($1)",
        [FUNCTION],
      ),
      [{ prosecdef: false, proconfig: ['search_path=""'], returns: "uuid" }],
    );
  });

  it("로그아웃한 사용자(anon)가 부르면 권한 오류이고 run·자식 행이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    const before = await snapshotOf(pglite);
    await actAs(pglite, null, "anon");
    await assert.rejects(call(pglite, payloadOf(RUN)), DENIED);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("로그인한 사용자(authenticated)는 그 조직의 ADMIN·운영자라도 부르면 권한 오류이고 run·자식 행이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    const before = await snapshotOf(pglite);
    for (const id of [ADMIN, OPERATOR]) {
      await actAs(pglite, id);
      await assert.rejects(call(pglite, payloadOf(RUN)), DENIED, id);
    }
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("service_role 이 RUNNING·같은 시도의 run 에 부르면 그 run id 한 행을 돌려준다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    assert.deepEqual(await finish(pglite, payloadOf(RUN)), [{ id: RUN }]);
  });

  it("마감 열 24개를 p.run 값으로 쓰고 started_at 은 이 시도의 시작 시각 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await finish(pglite, payloadOf(RUN));
    assert.deepEqual(await resultOf(pglite, RUN), { ...RESULT, started_at: ATTEMPT });
  });

  it("요소 다섯 행·항목 판정·자격 판정을 p 의 행 그대로 그 run·조직에 쓴다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await finish(pglite, payloadOf(RUN));
    assert.deepEqual(await factorsOf(pglite, RUN), sortBy(factorRows(RUN, ORG1), "factor"));
    assert.deepEqual(
      await assessmentsOf(pglite, RUN),
      sortBy(assessmentRows(RUN, ORG1), "item_id"),
    );
    assert.deepEqual(await checksOf(pglite, RUN), sortBy(checkRows(RUN, ORG1), "requirement_name"));
  });

  it("앞 시도가 남긴 자식 행이 있으면 요소는 (score_run_id, factor) 로 고쳐 쓰고(중복 없음) 항목·자격 판정은 지운 뒤 p 의 행만 남긴다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertEarlierChildren(pglite, RUN);
    await finish(pglite, payloadOf(RUN));
    assert.deepEqual(await factorsOf(pglite, RUN), sortBy(factorRows(RUN, ORG1), "factor"));
    assert.deepEqual(
      await assessmentsOf(pglite, RUN),
      sortBy(assessmentRows(RUN, ORG1), "item_id"),
    );
    assert.deepEqual(await checksOf(pglite, RUN), sortBy(checkRows(RUN, ORG1), "requirement_name"));
  });

  it("항목·자격 판정이 빈 배열이면 그 run 의 옛 행을 지우고 넣지 않는다 — 요소와 마감은 쓴다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertEarlierChildren(pglite, RUN);
    await finish(pglite, payloadOf(RUN, { assessments: [], checks: [] }));
    assert.deepEqual(await assessmentsOf(pglite, RUN), []);
    assert.deepEqual(await checksOf(pglite, RUN), []);
    assert.deepEqual(await factorsOf(pglite, RUN), sortBy(factorRows(RUN, ORG1), "factor"));
    assert.equal((await resultOf(pglite, RUN)).status, "COMPLETED");
  });

  it("같은 조직의 다른 run 과 그 자식 행은 건드리지 않는다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertRun(pglite, SIBLING);
    await insertEarlierChildren(pglite, SIBLING);
    const siblingOf = async () => ({
      run: await rowsOf(pglite, "select * from public.score_runs where id = $1", [SIBLING]),
      factors: await rowsOf(pglite, "select * from public.score_factors where score_run_id = $1", [
        SIBLING,
      ]),
      assessments: await rowsOf(
        pglite,
        "select * from public.requirement_assessments where score_run_id = $1",
        [SIBLING],
      ),
      checks: await rowsOf(
        pglite,
        "select * from public.qualification_checks where score_run_id = $1",
        [SIBLING],
      ),
    });
    const before = await siblingOf();
    await finish(pglite, payloadOf(RUN));
    assert.deepEqual(await siblingOf(), before);
  });

  // 설계(§2.2)는 score_factors 의 org_id 를 p.org_id 로 쓴다고만 하고, 자식 행에 다른 run·조직 값이 들어왔을 때 덮어쓸지
  // 거절할지는 정하지 않았다. 어느 쪽이든 다른 조직의 run 에 자식 행이 생기면 안 된다 — p 의 run 에 덮어쓰거나 복합 FK(23503)로 거절한다.
  it("자식 행이 다른 조직의 run 을 가리켜도 그 run 에는 자식 행이 생기지 않는다(p 의 run 으로 쓰거나 23503 으로 거절)", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertRun(pglite, ORG2_RUN, { org: ORG2 });
    const foreignCounts = async () =>
      (
        await rowsOf(
          pglite,
          `select (select count(*)::int from public.score_factors where score_run_id = $1) as score_factors,
             (select count(*)::int from public.requirement_assessments where score_run_id = $1) as requirement_assessments,
             (select count(*)::int from public.qualification_checks where score_run_id = $1) as qualification_checks`,
          [ORG2_RUN],
        )
      )[0];
    const outcome = await finish(
      pglite,
      payloadOf(RUN, {
        factors: factorRows(ORG2_RUN, ORG2),
        assessments: assessmentRows(ORG2_RUN, ORG2),
        checks: checkRows(ORG2_RUN, ORG2),
      }),
    ).then(
      () => "written",
      (error) => error.code,
    );
    assert.ok(["written", "23503"].includes(outcome), `${outcome}`);
    assert.deepEqual(await foreignCounts(), {
      score_factors: 0,
      requirement_assessments: 0,
      qualification_checks: 0,
    });
  });

  // 자격 판정 행의 공고·revision 은 받은 행의 값이 아니라 그 run 의 값이다. 다른 공고를 가리키는 판정이 run 에 섞이지 않는다.
  it("자격 판정 행이 다른 공고·revision 을 가리켜도 그 run 의 bid_id·revision_id 로 저장한다", async (t) => {
    const pglite = await finishDb(t);
    const OTHER_BID = "b1d00000-0000-0000-0000-000000000399";
    const OTHER_REV = "be500000-0000-0000-0000-000000000399";
    await pglite.query(
      "insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, source_url, content_hash, is_demo) values ($1, 'fixture', 'DEMO-2026-0399', '다른 공고', '시험기관', 'NOTICE', 'OPEN', 100000000, 'https://fixture.invalid/0399', 'hash-0399', true)",
      [OTHER_BID],
    );
    await pglite.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $2, 1, '{}', '{}', 'sum-0399')",
      [OTHER_REV, OTHER_BID],
    );
    await insertRun(pglite, RUN);
    const foreignChecks = checkRows(RUN, ORG1).map((row) => ({
      ...row,
      bid_id: OTHER_BID,
      revision_id: OTHER_REV,
    }));
    await finish(pglite, payloadOf(RUN, { checks: foreignChecks }));
    const stored = await rowsOf(
      pglite,
      "select bid_id, revision_id from public.qualification_checks where score_run_id = $1",
      [RUN],
    );
    assert.ok(stored.length > 0);
    for (const row of stored) assert.deepEqual(row, { bid_id: BID, revision_id: REV });
  });

  it("p.run 에 마감 밖 열(started_at·org_id·idempotency_key·company_profile_id·queued_at·requested_by)을 넣어도 그 열은 바뀌지 않는다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    const KEEP =
      "select id, org_id, bid_id, company_profile_id, idempotency_key, started_at, queued_at, requested_by, created_at from public.score_runs where id = $1";
    const before = await rowsOf(pglite, KEEP, [RUN]);
    const hijack = {
      started_at: "2030-01-01T00:00:00.000Z",
      org_id: ORG2,
      idempotency_key: `${ORG2}:hijack`,
      company_profile_id: PROFILE2,
      queued_at: "2030-01-01T00:00:00.000Z",
      requested_by: ADMIN,
    };
    assert.deepEqual(await finish(pglite, payloadOf(RUN, { result: hijack })), [{ id: RUN }]);
    assert.deepEqual(await rowsOf(pglite, KEEP, [RUN]), before);
    assert.equal((await resultOf(pglite, RUN)).status, "COMPLETED");
  });

  for (const status of ["COMPLETED", "PARTIAL", "FAILED"]) {
    it(`끝난 run(${status})에 늦은 시도가 같은 시도 식별자로 부르면 SCORE_RUN_NOT_RUNNING 이고 run·자식 행이 그대로다(행 수·값)`, async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN, { status });
      await insertEarlierChildren(pglite, RUN);
      const before = await snapshotOf(pglite);
      await assert.rejects(finish(pglite, payloadOf(RUN)), NOT_RUNNING);
      assert.deepEqual(await snapshotOf(pglite), before);
    });
  }

  it("아무 시도도 잡지 않은 QUEUED run 이면 SCORE_RUN_NOT_RUNNING 이고 run 이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN, { status: "QUEUED", startedAt: null });
    const before = await snapshotOf(pglite);
    await assert.rejects(finish(pglite, payloadOf(RUN)), NOT_RUNNING);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("다른 시도가 다시 잡은 RUNNING run(started_at 이 1ms 다르다)이면 SCORE_RUN_NOT_RUNNING 이고 그 시도의 자식 행·run 이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN, { startedAt: OTHER_ATTEMPT });
    await insertEarlierChildren(pglite, RUN);
    const before = await snapshotOf(pglite);
    await assert.rejects(finish(pglite, payloadOf(RUN, { attempt: ATTEMPT })), NOT_RUNNING);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("attempt_started_at 이 없거나 null 이면 SCORE_RUN_NOT_RUNNING 이고 run 이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    const before = await snapshotOf(pglite);
    const withoutAttempt = Object.fromEntries(
      Object.entries(payloadOf(RUN)).filter(([key]) => key !== "attempt_started_at"),
    );
    await assert.rejects(finish(pglite, withoutAttempt), NOT_RUNNING);
    await assert.rejects(finish(pglite, payloadOf(RUN, { attempt: null })), NOT_RUNNING);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("같은 시도로 두 번 부르면 두 번째는 SCORE_RUN_NOT_RUNNING 이고 첫 결과가 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await finish(pglite, payloadOf(RUN));
    const before = await snapshotOf(pglite);
    await assert.rejects(
      finish(
        pglite,
        payloadOf(RUN, {
          result: { score: 10, recommendation: "NO_BID" },
          assessments: [],
          checks: [],
        }),
      ),
      NOT_RUNNING,
    );
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("p.org_id 가 그 run 의 조직이 아니면 SCORE_RUN_NOT_FOUND 이고 두 조직의 run·자식 행이 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertRun(pglite, ORG2_RUN, { org: ORG2 });
    await insertEarlierChildren(pglite, ORG2_RUN, ORG2);
    const before = await snapshotOf(pglite);
    await assert.rejects(finish(pglite, payloadOf(ORG2_RUN, { org: ORG1 })), NOT_FOUND);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("없는 run 이면 SCORE_RUN_NOT_FOUND 이고 아무 행도 생기지 않는다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    const before = await snapshotOf(pglite);
    await assert.rejects(finish(pglite, payloadOf(MISSING)), NOT_FOUND);
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("자격 판정 한 행이 check 위반이면 23514 로 실패하고 앞서 쓴 요소·항목 판정과 옛 행 지우기까지 모두 되돌아간다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertEarlierChildren(pglite, RUN);
    const before = await snapshotOf(pglite);
    const [satisfied, review] = checkRows(RUN, ORG1);
    await assert.rejects(
      finish(pglite, payloadOf(RUN, { checks: [satisfied, { ...review, reason_code: null }] })),
      { code: "23514", message: /qualification_checks_needs_review_check/ },
    );
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  it("마감 열이 check 위반이면(COMPLETED 인데 입력 스냅샷 없음) 자식 3표 쓰기가 모두 되돌아가고 run 은 RUNNING 그대로다", async (t) => {
    const pglite = await finishDb(t);
    await insertRun(pglite, RUN);
    await insertEarlierChildren(pglite, RUN);
    const before = await snapshotOf(pglite);
    await assert.rejects(finish(pglite, payloadOf(RUN, { result: { input_snapshot: null } })), {
      code: "23514",
      message: /score_runs_finished_snapshot_check/,
    });
    assert.deepEqual(await snapshotOf(pglite), before);
  });

  // 마감 status 는 COMPLETED·PARTIAL 만이다. 실패 닫기(FAILED)는 markFailed 의 몫이고, RUNNING·QUEUED 로 되돌리거나 status 없이
  // (지금 값 RUNNING 그대로) 결과만 쓰는 마감은 끝나지 않은 run 에 결과를 남긴다. 자식 표를 쓰기 전에 거절하고 아무것도 바꾸지 않는다.
  // 거절 코드는 SCORE_RUN_INVALID_STATUS(raise exception, 메시지가 곧 코드)다. FAILED 값은 마감 열 check 를 모두 지켜 status 만 거절 이유가 되게 한다.
  const INVALID_STATUS = { message: "SCORE_RUN_INVALID_STATUS" };
  const withoutStatus = (p) => ({
    ...p,
    run: Object.fromEntries(Object.entries(p.run).filter(([key]) => key !== "status")),
  });
  for (const [label, payload] of [
    [
      "FAILED",
      () => payloadOf(RUN, { result: { status: "FAILED", error_code: "ANALYSIS_JOB_FAILED" } }),
    ],
    ["RUNNING", () => payloadOf(RUN, { result: { status: "RUNNING" } })],
    ["QUEUED", () => payloadOf(RUN, { result: { status: "QUEUED" } })],
    ["없음(지금 값 RUNNING 그대로)", () => withoutStatus(payloadOf(RUN))],
  ]) {
    it(`p.run.status 가 ${label} 이면 SCORE_RUN_INVALID_STATUS 이고 자식 3표·score_runs 가 그대로다`, async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await insertEarlierChildren(pglite, RUN);
      const before = await snapshotOf(pglite);
      await assert.rejects(finish(pglite, payload()), INVALID_STATUS);
      assert.deepEqual(await snapshotOf(pglite), before);
    });
  }

  for (const [status, result] of [
    ["COMPLETED", {}],
    [
      "PARTIAL",
      { status: "PARTIAL", error_code: "AI_UNAVAILABLE", review_flags: ["AI_UNAVAILABLE"] },
    ],
  ]) {
    it(`p.run.status 가 ${status} 이면 지금처럼 마감하고 그 run id 를 돌려준다`, async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      assert.deepEqual(await finish(pglite, payloadOf(RUN, { result })), [{ id: RUN }]);
      assert.equal((await resultOf(pglite, RUN)).status, status);
    });
  }

  // 낮음 (a): idempotency_key 는 null 이거나 `<org_id>:` 로 시작한다. 다른 조직의 접두어로 남의 run 을 가리키는 키를 DB 가 막는다.
  describe("score_runs.idempotency_key 조직 접두어 check", () => {
    // 진행 중 run 은 같은 입력에 하나뿐이라 넣을 때마다 알고리즘 버전을 바꾼다.
    let version = 0;
    const insertKey = async (pglite, key, org = ORG1) => {
      await asWorker(pglite);
      version += 1;
      return pglite.query(
        "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider, idempotency_key) values ($1, $2, $3, $4, 1, $5, 'MOCK', 'MOCK', $6) returning id",
        [org, BID, REV, profileOf(org), `sol-v0.1.0-key-${version}`, key],
      );
    };
    const C6_REQUEST = "7d9f5c2e-4b1a-4e8f-9c3d-2a6b8e0f1c4d";

    it("제약 score_runs_idempotency_key_org_check 가 score_runs 의 check 로 있다", async (t) => {
      const pglite = await migratedDb(t);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select conname, contype from pg_constraint where conrelid = 'public.score_runs'::regclass and conname = 'score_runs_idempotency_key_org_check'",
        ),
        [{ conname: "score_runs_idempotency_key_org_check", contype: "c" }],
      );
    });

    for (const [label, keyOf] of [
      ["다른 조직의 접두어", () => `${ORG2}:req-1`],
      ["조직 접두어가 없다", () => "req-1"],
      ["org_id 뒤에 ':' 가 없다", () => `${ORG1}req-1`],
      ["접두어가 맨 앞이 아니다", () => `x${ORG1}:req-1`],
    ]) {
      it(`${label} 키는 23514(score_runs_idempotency_key_org_check)로 거절한다`, async (t) => {
        const pglite = await finishDb(t);
        await assert.rejects(insertKey(pglite, keyOf()), KEY_CHECK);
        assert.equal(
          (await rowsOf(pglite, "select count(*)::int as n from public.score_runs"))[0].n,
          0,
        );
      });
    }

    it("null·`<org>:demo-pre-FX-01-r01`·`<org>:<uuid>` 키는 넣을 수 있다", async (t) => {
      const pglite = await finishDb(t);
      for (const key of [null, `${ORG1}:demo-pre-FX-01-r01`, `${ORG1}:${C6_REQUEST}`])
        assert.equal((await insertKey(pglite, key)).rows.length, 1, `${key}`);
      assert.equal((await insertKey(pglite, `${ORG2}:${C6_REQUEST}`, ORG2)).rows.length, 1);
    });

    it("C6 요청(로그인 ADMIN 의 열 단위 insert)은 `<org>:<uuid>` 면 통과하고 다른 조직 접두어면 23514 다", async (t) => {
      const pglite = await finishDb(t);
      const request = (key, version) =>
        pglite.query(
          "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider, idempotency_key) values ($1, $2, $3, $4, 1, $5, 'MOCK', 'MOCK', $6) returning status",
          [ORG1, BID, REV, PROFILE1, version, key],
        );
      await actAs(pglite, ADMIN);
      assert.deepEqual((await request(`${ORG1}:${C6_REQUEST}`, "sol-v0.1.0-c6-1")).rows, [
        { status: "QUEUED" },
      ]);
      await actAs(pglite, ADMIN);
      await assert.rejects(request(`${ORG2}:${C6_REQUEST}`, "sol-v0.1.0-c6-2"), KEY_CHECK);
    });

    it("이미 있는 run 의 키를 다른 조직 접두어로 바꾸면 23514 로 거절하고 키가 그대로다", async (t) => {
      const pglite = await finishDb(t);
      const [{ id }] = (await insertKey(pglite, `${ORG1}:req-update`)).rows;
      await asWorker(pglite);
      await assert.rejects(
        pglite.query("update public.score_runs set idempotency_key = $1 where id = $2", [
          `${ORG2}:req-update`,
          id,
        ]),
        KEY_CHECK,
      );
      assert.deepEqual(
        await rowsOf(pglite, "select idempotency_key from public.score_runs where id = $1", [id]),
        [{ idempotency_key: `${ORG1}:req-update` }],
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // C7 인앱 알림 producer — finish_score_run 이 마감과 같은 트랜잭션에 ANALYSIS_COMPLETE outbox 를 쓴다(20261019000016).
  // 근거: docs/13-NOTIFICATIONS.md(ANALYSIS_COMPLETE 는 score_run COMPLETED·PARTIAL, 수신자는 분석 요청자; 데이터 변경과 outbox 를
  // 한 트랜잭션에; 두 단계 멱등), docs/04-DATABASE.md §1·§3.6. 키는 `<scoreRunId>:<requestedBy>:ANALYSIS_COMPLETE` 이고
  // 같은 키가 이미 있으면 on conflict do nothing 으로 흡수한다. 요청자(requested_by)가 없는 run(seed·사전 분석)은 알릴 사람이 없어 쓰지 않는다.
  // 거절(SCORE_RUN_NOT_FOUND·NOT_RUNNING·INVALID_STATUS)이면 아무것도 쓰지 않는다. outbox 는 화면 역할이 못 읽으므로 관리 작업으로 본다.
  // ──────────────────────────────────────────────────────────────
  describe("ANALYSIS_COMPLETE outbox (C7)", () => {
    const keyOf = (run, requester = ADMIN) => `${run}:${requester}:ANALYSIS_COMPLETE`;
    // 화면에서 들어온 분석 요청처럼 요청자를 채운다(C6 insert 는 requested_by 기본값 auth.uid()).
    const setRequester = async (pglite, run, requester = ADMIN) => {
      await asWorker(pglite);
      await pglite.query("update public.score_runs set requested_by = $2 where id = $1", [
        run,
        requester,
      ]);
    };
    const outboxOf = async (pglite) =>
      rowsOf(
        pglite,
        `select org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status, attempts, next_attempt_at
         from public.outbox_events where event_type = 'ANALYSIS_COMPLETE' order by created_at, id`,
      );
    const PARTIAL = {
      status: "PARTIAL",
      error_code: "AI_UNAVAILABLE",
      review_flags: ["AI_UNAVAILABLE"],
    };

    it("요청자가 있는 run 을 COMPLETED 로 마감하면 ANALYSIS_COMPLETE outbox 1건을 org_id·aggregate·payload·키 그대로 PENDING 으로 쓴다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN));
      assert.deepEqual(await outboxOf(pglite), [
        {
          org_id: ORG1,
          aggregate_type: "score_run",
          aggregate_id: RUN,
          event_type: "ANALYSIS_COMPLETE",
          payload: {
            scoreRunId: RUN,
            bidId: BID,
            orgId: ORG1,
            requestedBy: ADMIN,
            status: "COMPLETED",
          },
          idempotency_key: keyOf(RUN),
          status: "PENDING",
          attempts: 0,
          next_attempt_at: null,
        },
      ]);
    });

    it("PARTIAL 로 마감하면 payload.status 가 PARTIAL 이다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN, { result: PARTIAL }));
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => [row.payload.status, row.idempotency_key]),
        [["PARTIAL", keyOf(RUN)]],
      );
    });

    it("outbox 의 payload 키는 scoreRunId·bidId·orgId·requestedBy·status 다섯 개뿐이다(결과·점수·스냅샷을 싣지 않는다)", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN));
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => Object.keys(row.payload).toSorted()),
        [["bidId", "orgId", "requestedBy", "scoreRunId", "status"]],
      );
    });

    it("다른 조직의 run 을 마감하면 그 run 의 조직(org_id)으로 쓴다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, ORG2_RUN, { org: ORG2 });
      await setRequester(pglite, ORG2_RUN, OPERATOR);
      await finish(pglite, payloadOf(ORG2_RUN, { org: ORG2 }));
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => [row.org_id, row.payload.orgId, row.idempotency_key]),
        [[ORG2, ORG2, keyOf(ORG2_RUN, OPERATOR)]],
      );
    });

    it("요청자가 없는 run(requested_by null)은 마감해도 outbox 를 쓰지 않는다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      assert.deepEqual(await finish(pglite, payloadOf(RUN)), [{ id: RUN }]);
      assert.deepEqual(await outboxOf(pglite), []);
    });

    for (const [label, prepare, payload, rejected] of [
      [
        "끝난 run(COMPLETED) — SCORE_RUN_NOT_RUNNING",
        (pglite) => insertRun(pglite, RUN, { status: "COMPLETED" }),
        () => payloadOf(RUN),
        NOT_RUNNING,
      ],
      [
        "QUEUED run — SCORE_RUN_NOT_RUNNING",
        (pglite) => insertRun(pglite, RUN, { status: "QUEUED", startedAt: null }),
        () => payloadOf(RUN),
        NOT_RUNNING,
      ],
      [
        "다른 시도 — SCORE_RUN_NOT_RUNNING",
        (pglite) => insertRun(pglite, RUN, { startedAt: OTHER_ATTEMPT }),
        () => payloadOf(RUN),
        NOT_RUNNING,
      ],
      [
        "마감 status FAILED — SCORE_RUN_INVALID_STATUS",
        (pglite) => insertRun(pglite, RUN),
        () => payloadOf(RUN, { result: { status: "FAILED", error_code: "ANALYSIS_JOB_FAILED" } }),
        { message: "SCORE_RUN_INVALID_STATUS" },
      ],
      [
        "다른 조직의 p.org_id — SCORE_RUN_NOT_FOUND",
        (pglite) => insertRun(pglite, RUN),
        () => payloadOf(RUN, { org: ORG2 }),
        NOT_FOUND,
      ],
      [
        "마감 열 check 위반(COMPLETED 인데 입력 스냅샷 없음) — 23514",
        (pglite) => insertRun(pglite, RUN),
        () => payloadOf(RUN, { result: { input_snapshot: null } }),
        { code: "23514" },
      ],
    ]) {
      it(`거절되면(${label}) 요청자가 있어도 outbox 를 쓰지 않는다`, async (t) => {
        const pglite = await finishDb(t);
        await prepare(pglite);
        await setRequester(pglite, RUN);
        await assert.rejects(finish(pglite, payload()), rejected);
        assert.deepEqual(await outboxOf(pglite), []);
      });
    }

    it("같은 시도로 두 번 부르면 두 번째는 거절되고 outbox 는 첫 마감의 1건 그대로다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN));
      await assert.rejects(finish(pglite, payloadOf(RUN, { result: PARTIAL })), NOT_RUNNING);
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => [row.payload.status, row.idempotency_key]),
        [["COMPLETED", keyOf(RUN)]],
      );
    });

    it("같은 키의 outbox 행이 이미 있으면 마감은 성공하고 그 행이 그대로 1건이다(on conflict do nothing)", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await asWorker(pglite);
      await pglite.query(
        "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key) values ($1, 'score_run', $2, 'ANALYSIS_COMPLETE', $3, $4)",
        [ORG1, RUN, JSON.stringify({ marker: "먼저 쓴 이벤트" }), keyOf(RUN)],
      );
      assert.deepEqual(await finish(pglite, payloadOf(RUN)), [{ id: RUN }]);
      assert.equal((await resultOf(pglite, RUN)).status, "COMPLETED");
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => [row.payload, row.idempotency_key]),
        [[{ marker: "먼저 쓴 이벤트" }, keyOf(RUN)]],
      );
    });

    it("같은 조직의 다른 run 마감은 그 run 의 키로 따로 1건씩이다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await insertRun(pglite, SIBLING);
      await setRequester(pglite, RUN);
      await setRequester(pglite, SIBLING);
      await finish(pglite, payloadOf(RUN));
      await finish(pglite, payloadOf(SIBLING));
      assert.deepEqual(
        (await outboxOf(pglite)).map((row) => row.idempotency_key).toSorted(),
        [keyOf(RUN), keyOf(SIBLING)].toSorted(),
      );
    });

    // 알림 단계 멱등(docs/13): notifications.idempotency_key = outboxEventId + userId + channel 은 UNIQUE 다.
    // worker 는 같은 키를 on conflict do nothing 으로 넣어 같은 이벤트를 다시 처리해도 알림을 늘리지 않는다.
    it("notifications 에 같은 idempotency_key 를 두 번 on conflict do nothing 으로 넣으면 1건이고 처음 행이 그대로다", async (t) => {
      const pglite = await finishDb(t);
      await asWorker(pglite);
      const key = `${RUN}:${ADMIN}:IN_APP`;
      const insert = (title) =>
        pglite.query(
          `insert into public.notifications (org_id, user_id, type, channel, status, sent_at, idempotency_key, payload)
           values ($1, $2, 'ANALYSIS_COMPLETE', 'IN_APP', 'SENT', now(), $3, $4)
           on conflict (idempotency_key) do nothing returning id`,
          [
            ORG1,
            ADMIN,
            key,
            JSON.stringify({
              bidId: BID,
              title,
              message: "분석이 끝났습니다.",
              link: `/bids/${BID}`,
            }),
          ],
        );
      assert.equal((await insert("처음")).rows.length, 1);
      assert.equal((await insert("다시")).rows.length, 0);
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select payload ->> 'title' as title from public.notifications where idempotency_key = $1",
          [key],
        ),
        [{ title: "처음" }],
      );
    });
  });

  // 추천 공고 outbox(20261021000002, ADR-038). 사람이 요청한 분석이 BID·WATCH 로 끝나면 finish_score_run 이 결과와 같은
  // 트랜잭션에 BID_RECOMMENDED 1건을 쓴다. 키는 조직·공고마다 하나라 다시 분석해도 늘지 않는다(처음 한 번만).
  // 근거: docs/plans/2026-10-20-kakao-memo-notify-plan.md Task 1, 설계 docs/plans/2026-10-20-kakao-memo-notify-design.md §5.1·§7.
  describe("추천 공고 outbox — BID_RECOMMENDED", () => {
    const VERSION = "20261021000002";
    const INDEX = "outbox_events_notify_due_idx";
    const keyOf = (org = ORG1) => `${org}:${BID}:BID_RECOMMENDED`;
    // 화면에서 들어온 분석 요청처럼 요청자를 채운다(C6 insert 는 requested_by 기본값 auth.uid()).
    const setRequester = async (pglite, run, requester = ADMIN) => {
      await asWorker(pglite);
      await pglite.query("update public.score_runs set requested_by = $2 where id = $1", [
        run,
        requester,
      ]);
    };
    const recommendedOf = async (pglite) =>
      rowsOf(
        pglite,
        `select org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status, attempts, next_attempt_at
         from public.outbox_events where event_type = 'BID_RECOMMENDED' order by created_at, id`,
      );
    const eventTypesOf = async (pglite) =>
      (await rowsOf(pglite, "select event_type from public.outbox_events order by event_type")).map(
        (row) => row.event_type,
      );
    const PARTIAL_WATCH = {
      status: "PARTIAL",
      recommendation: "WATCH",
      error_code: "AI_UNAVAILABLE",
      review_flags: ["AI_UNAVAILABLE"],
    };
    // 부분 인덱스의 WHERE 식(카탈로그 값). 없으면 null.
    const predicateOf = async (pglite) =>
      (
        await pglite.query(
          `select pg_get_expr(i.indpred, i.indrelid) as predicate,
                  array(select a.attname::text
                          from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
                          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                         order by k.ord) as columns
             from pg_index i
             join pg_class c on c.oid = i.indexrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = $1`,
          [INDEX],
        )
      ).rows[0] ?? null;
    // WHERE 식을 상태 4 × 종류 7 의 모든 조합에 그대로 적용해 덮는 조합을 고른다(글자 모양에 기대지 않는다).
    const coveredBy = async (pglite, predicate) =>
      (
        await pglite.query(
          `select status, event_type
             from (values ('PENDING'), ('PROCESSED'), ('FAILED'), ('DEAD')) as s(status)
            cross join (values ('BID_CREATED'), ('BID_CHANGED'), ('DEADLINE_APPROACHING'), ('ANALYSIS_COMPLETE'),
                               ('REVIEW_ASSIGNED'), ('BID_RECOMMENDED'), ('KAKAO_TEST')) as e(event_type)
            where ${predicate}
            order by 1, 2`,
        )
      ).rows;

    it("⑨ 요청자가 있는 run 이 BID 로 마감되면 BID_RECOMMENDED 1건을 org_id·aggregate·payload·키 그대로 PENDING 으로 쓴다 — ANALYSIS_COMPLETE 도 그대로 함께 쓴다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN));
      assert.deepEqual(await recommendedOf(pglite), [
        {
          org_id: ORG1,
          aggregate_type: "score_run",
          aggregate_id: RUN,
          event_type: "BID_RECOMMENDED",
          payload: {
            scoreRunId: RUN,
            bidId: BID,
            orgId: ORG1,
            recommendation: "BID",
            status: "COMPLETED",
          },
          idempotency_key: keyOf(),
          status: "PENDING",
          attempts: 0,
          next_attempt_at: null,
        },
      ]);
      assert.deepEqual(await eventTypesOf(pglite), ["ANALYSIS_COMPLETE", "BID_RECOMMENDED"]);
    });

    it("⑨ PARTIAL(규칙만 분석)로 끝난 WATCH 도 쓴다 — payload 는 recommendation WATCH·status PARTIAL 이다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN, { result: PARTIAL_WATCH }));
      assert.deepEqual(
        (await recommendedOf(pglite)).map((row) => [row.payload, row.idempotency_key]),
        [
          [
            {
              scoreRunId: RUN,
              bidId: BID,
              orgId: ORG1,
              recommendation: "WATCH",
              status: "PARTIAL",
            },
            keyOf(),
          ],
        ],
      );
    });

    it("⑩ 같은 공고를 다시 분석해 WATCH 로 마감해도 BID_RECOMMENDED 는 처음 run 의 1건 그대로다 — ANALYSIS_COMPLETE 는 run 마다 1건씩이다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await insertRun(pglite, SIBLING);
      await setRequester(pglite, RUN);
      await setRequester(pglite, SIBLING);
      await finish(pglite, payloadOf(RUN));
      assert.deepEqual(
        await finish(pglite, payloadOf(SIBLING, { result: { recommendation: "WATCH" } })),
        [{ id: SIBLING }],
      );
      assert.deepEqual(
        (await recommendedOf(pglite)).map((row) => [
          row.aggregate_id,
          row.payload.scoreRunId,
          row.payload.recommendation,
          row.idempotency_key,
        ]),
        [[RUN, RUN, "BID", keyOf()]],
      );
      assert.deepEqual(await eventTypesOf(pglite), [
        "ANALYSIS_COMPLETE",
        "ANALYSIS_COMPLETE",
        "BID_RECOMMENDED",
      ]);
    });

    it("⑩ 다른 조직이 같은 공고를 BID 로 마감하면 그 조직의 키(<orgId>:<bidId>:BID_RECOMMENDED)로 따로 1건이다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await insertRun(pglite, ORG2_RUN, { org: ORG2 });
      await setRequester(pglite, RUN);
      await setRequester(pglite, ORG2_RUN, OPERATOR);
      await finish(pglite, payloadOf(RUN));
      await finish(pglite, payloadOf(ORG2_RUN, { org: ORG2 }));
      assert.deepEqual(
        (await recommendedOf(pglite))
          .map((row) => [row.org_id, row.payload.orgId, row.idempotency_key])
          .toSorted((a, b) => (a[2] < b[2] ? -1 : 1)),
        [
          [ORG1, ORG1, keyOf(ORG1)],
          [ORG2, ORG2, keyOf(ORG2)],
        ].toSorted((a, b) => (a[2] < b[2] ? -1 : 1)),
      );
    });

    it("⑪ 요청자가 없는 run(requested_by null, 데모 사전 분석)은 BID 로 마감해도 쓰지 않는다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      assert.deepEqual(await finish(pglite, payloadOf(RUN)), [{ id: RUN }]);
      assert.deepEqual(await recommendedOf(pglite), []);
      assert.deepEqual(await eventTypesOf(pglite), []);
    });

    it("⑫ NO_BID 로 마감하면 쓰지 않고, 같은 공고를 나중에 다시 분석해 BID 가 나오면 그때 처음 1건이 생긴다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await insertRun(pglite, SIBLING);
      await setRequester(pglite, RUN);
      await setRequester(pglite, SIBLING);
      await finish(pglite, payloadOf(RUN, { result: { recommendation: "NO_BID" } }));
      assert.deepEqual(await recommendedOf(pglite), []);
      assert.deepEqual(await eventTypesOf(pglite), ["ANALYSIS_COMPLETE"]);
      await finish(pglite, payloadOf(SIBLING));
      assert.deepEqual(
        (await recommendedOf(pglite)).map((row) => [
          row.aggregate_id,
          row.payload.recommendation,
          row.idempotency_key,
        ]),
        [[SIBLING, "BID", keyOf()]],
      );
    });

    it("⑫ 권고가 없는 마감(recommendation null)도 쓰지 않는다", async (t) => {
      const pglite = await finishDb(t);
      await insertRun(pglite, RUN);
      await setRequester(pglite, RUN);
      await finish(pglite, payloadOf(RUN, { result: { ...PARTIAL_WATCH, recommendation: null } }));
      assert.deepEqual(await recommendedOf(pglite), []);
    });

    it("⑬ 부분 인덱스 outbox_events_notify_due_idx 의 WHERE 는 새 종류 BID_RECOMMENDED·KAKAO_TEST 의 PENDING·FAILED 도 덮는다 — 키 열은 그대로 (created_at, id)", async (t) => {
      const fresh = await freshDb(t);
      await applyMigrations(fresh, migrations);
      const index = await predicateOf(fresh);
      assert.ok(index?.predicate, `${INDEX} 는 부분 인덱스(WHERE)여야 한다`);
      assert.deepEqual(index.columns, ["created_at", "id"]);
      assert.deepEqual(await coveredBy(fresh, index.predicate), [
        { status: "FAILED", event_type: "ANALYSIS_COMPLETE" },
        { status: "FAILED", event_type: "BID_RECOMMENDED" },
        { status: "FAILED", event_type: "KAKAO_TEST" },
        { status: "FAILED", event_type: "REVIEW_ASSIGNED" },
        { status: "PENDING", event_type: "ANALYSIS_COMPLETE" },
        { status: "PENDING", event_type: "BID_RECOMMENDED" },
        { status: "PENDING", event_type: "KAKAO_TEST" },
        { status: "PENDING", event_type: "REVIEW_ASSIGNED" },
      ]);
    });

    it(`⑬ 새 종류는 ${VERSION} 이 더한다 — 그 앞까지 적용한 인덱스는 BID_RECOMMENDED·KAKAO_TEST 를 덮지 않는다`, async (t) => {
      const fresh = await freshDb(t);
      await applyMigrations(
        fresh,
        migrations.filter((migration) => migration.version < VERSION),
      );
      const before = await predicateOf(fresh);
      assert.ok(before?.predicate, `${VERSION} 앞에도 ${INDEX} 가 있어야 한다(20261019000017)`);
      assert.deepEqual(
        (await coveredBy(fresh, before.predicate)).filter((row) =>
          ["BID_RECOMMENDED", "KAKAO_TEST"].includes(row.event_type),
        ),
        [],
      );
    });

    it("⑬ check 제약이 새 종류를 받는다 — outbox 는 BID_RECOMMENDED·KAKAO_TEST, notifications 는 BID_RECOMMENDED·KAKAO_EXPIRED. 목록 밖 종류는 그대로 거절(23514)한다", async (t) => {
      const pglite = await finishDb(t);
      await asWorker(pglite);
      const outbox = (type, key) =>
        pglite.query(
          "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values (null, 'kakao_notify_link', $1, $2, $3)",
          [ADMIN, type, key],
        );
      const notification = (type, channel, key) =>
        pglite.query(
          "insert into public.notifications (org_id, user_id, type, channel, idempotency_key, payload) values ($1, $2, $3, $4, $5, $6)",
          [ORG1, ADMIN, type, channel, key, JSON.stringify({ bidId: BID })],
        );
      await outbox("BID_RECOMMENDED", "check-outbox-1");
      await outbox("KAKAO_TEST", "check-outbox-2");
      await notification("BID_RECOMMENDED", "KAKAO", "check-notification-1");
      await notification("KAKAO_EXPIRED", "IN_APP", "check-notification-2");
      await assert.rejects(outbox("KAKAO_EXPIRED", "check-outbox-3"), {
        code: "23514",
        message: /outbox_events_event_type_check/,
      });
      await assert.rejects(notification("KAKAO_TEST", "IN_APP", "check-notification-3"), {
        code: "23514",
        message: /notifications_type_check/,
      });
    });
  });
});

// C7 알림 outbox 소비자의 부분 인덱스(20261019000017). 소비자가 없는 공고 이벤트(BID_*)의 PENDING 이 쌓여도
// findDue(event_type 두 종·status PENDING|FAILED, 정렬 created_at·id)가 그 행을 훑지 않게 한다.
// 근거: docs/13-NOTIFICATIONS.md "pending polling", docs/04-DATABASE.md §5(인덱스는 만드는 마이그레이션이 정본).
// 이미 있는 000016 은 고치지 않고 새 파일로 더한다(append-only).
describe("알림 outbox 부분 인덱스 — outbox_events_notify_due_idx (C7)", () => {
  const INDEX = "outbox_events_notify_due_idx";
  const VERSION = "20261019000017";
  const indexRow = async (pglite) =>
    (
      await pglite.query(
        `select t.relname as table_name, am.amname as method, i.indisunique as is_unique,
                pg_get_expr(i.indpred, i.indrelid) as predicate,
                array(select a.attname::text
                        from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
                        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                       order by k.ord) as columns
           from pg_index i
           join pg_class c on c.oid = i.indexrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_class t on t.oid = i.indrelid
           join pg_am am on am.oid = c.relam
          where n.nspname = 'public' and c.relname = $1`,
        [INDEX],
      )
    ).rows;
  const migratedIndex = async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    return { fresh, rows: await indexRow(fresh) };
  };

  it("pg_indexes 에 public.outbox_events 의 outbox_events_notify_due_idx 가 있다", async (t) => {
    const { fresh } = await migratedIndex(t);
    assert.deepEqual(
      (
        await fresh.query(
          "select tablename from pg_indexes where schemaname = 'public' and indexname = $1",
          [INDEX],
        )
      ).rows,
      [{ tablename: "outbox_events" }],
    );
  });

  it("btree 이고 unique 가 아니며 키 열은 (created_at, id) 순서다(findDue 의 정렬과 같다)", async (t) => {
    const { rows } = await migratedIndex(t);
    assert.deepEqual(
      rows.map(({ table_name, method, is_unique, columns }) => ({
        table_name,
        method,
        is_unique,
        columns,
      })),
      [
        {
          table_name: "outbox_events",
          method: "btree",
          is_unique: false,
          columns: ["created_at", "id"],
        },
      ],
    );
  });

  it("WHERE 는 status PENDING·FAILED 이면서 event_type REVIEW_ASSIGNED·ANALYSIS_COMPLETE 인 행만 덮는다", async (t) => {
    const { fresh, rows } = await migratedIndex(t);
    assert.equal(rows.length, 1, `${INDEX} 가 없다`);
    const [{ predicate }] = rows;
    assert.ok(predicate, `${INDEX} 는 부분 인덱스(WHERE)여야 한다`);
    // 카탈로그의 WHERE 식을 상태 4 × 종류 5 의 모든 조합에 그대로 적용해 덮는 조합을 고른다(글자 모양에 기대지 않는다).
    const covered = (
      await fresh.query(
        `select status, event_type
           from (values ('PENDING'), ('PROCESSED'), ('FAILED'), ('DEAD')) as s(status)
          cross join (values ('BID_CREATED'), ('BID_CHANGED'), ('DEADLINE_APPROACHING'),
                             ('ANALYSIS_COMPLETE'), ('REVIEW_ASSIGNED')) as e(event_type)
          where ${predicate}
          order by 1, 2`,
      )
    ).rows;
    assert.deepEqual(covered, [
      { status: "FAILED", event_type: "ANALYSIS_COMPLETE" },
      { status: "FAILED", event_type: "REVIEW_ASSIGNED" },
      { status: "PENDING", event_type: "ANALYSIS_COMPLETE" },
      { status: "PENDING", event_type: "REVIEW_ASSIGNED" },
    ]);
  });

  it(`인덱스는 ${VERSION} 마이그레이션이 만든다 — 그 앞까지 적용하면 없고, 그 파일을 적용하면 생긴다`, async (t) => {
    const fresh = await freshDb(t);
    const before = migrations.filter((migration) => migration.version < VERSION);
    const target = migrations.filter((migration) => migration.version === VERSION);
    await applyMigrations(fresh, before);
    const absent = (await indexRow(fresh)).length;
    await applyMigrations(fresh, target);
    assert.deepEqual(
      { absent, files: target.length, present: (await indexRow(fresh)).length },
      { absent: 0, files: 1, present: 1 },
    );
  });
});

// 카카오톡 알림 연결(20261021000001, ADR-038). 사용자 개인 설정이라 조직 표가 아니고 user_id 로 소유한다(profiles 처럼).
// 화면 역할은 본인 행의 여섯 열만 읽고(토큰·만료 열은 못 읽는다), 쓰기는 security definer RPC 넷으로만 한다.
// 20261021000003(보안 검토 보강)이 저장 RPC 의 입력 검사(KAKAO_LINK_INVALID)와 시험 메시지 하루 상한(24시간 10건)을 더한다(⑨·⑩).
// 근거: docs/plans/2026-10-20-kakao-memo-notify-plan.md Task 1, 설계 docs/plans/2026-10-20-kakao-memo-notify-design.md §7.
describe("카카오톡 알림 연결 — kakao_notify_links", () => {
  const [ME, OTHER, OPERATOR] = users;
  const VISIBLE = ["user_id", "enabled", "status", "last_sent_at", "last_result", "updated_at"];
  const HIDDEN = [
    "access_token_enc",
    "refresh_token_enc",
    "access_expires_at",
    "refresh_expires_at",
    "created_at",
  ];
  const TABLE_DENIED = { code: "42501", message: /permission denied for table kakao_notify_links/ };
  const fnDenied = (name) => ({
    code: "42501",
    message: new RegExp(`permission denied for function ${name}`),
  });
  const NOT_CONNECTED = { message: "KAKAO_NOT_CONNECTED" };
  const NOT_READY = { message: "KAKAO_NOT_READY" };
  const LINK_INVALID = { message: "KAKAO_LINK_INVALID" };
  const ACCESS_AT = "2026-10-21T16:00:00.000Z";
  const REFRESH_AT = "2026-12-20T10:00:00.000Z";
  const RPCS = [
    [
      "save_kakao_notify_link",
      "select public.save_kakao_notify_link('v1.enc-access', 'v1.enc-refresh', now(), now())",
    ],
    ["set_kakao_notify_enabled", "select public.set_kakao_notify_enabled(true)"],
    ["disconnect_kakao_notify", "select public.disconnect_kakao_notify()"],
    ["request_kakao_notify_test", "select public.request_kakao_notify_test()"],
  ];

  // JWT 없는 관리 작업(worker·seed 자리). RLS 를 거치지 않고 본다·고친다.
  const asWorker = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', '', false)");
  };
  const workerRows = async (pglite, sql, params = []) => {
    await asWorker(pglite);
    return (await pglite.query(sql, params)).rows;
  };
  const iso = (value) => (value === null ? null : value.toISOString());
  // 본인 행 전체(토큰 열 포함)를 worker 자리에서 읽는다.
  const linkOf = async (pglite, who) =>
    (
      await workerRows(
        pglite,
        `select user_id, enabled, status, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at,
           last_sent_at, last_result
         from public.kakao_notify_links where user_id = $1`,
        [who],
      )
    ).map((row) => ({
      ...row,
      access_expires_at: iso(row.access_expires_at),
      refresh_expires_at: iso(row.refresh_expires_at),
    }));
  // 콜백(웹 서버)이 부르는 자리 — 그 사람으로 로그인해 RPC 를 부른다.
  const save = async (
    pglite,
    who,
    access = `v1.enc-access-${who}`,
    refresh = `v1.enc-refresh-${who}`,
  ) => {
    await actAs(pglite, who);
    await pglite.query("select public.save_kakao_notify_link($1, $2, $3, $4)", [
      access,
      refresh,
      ACCESS_AT,
      REFRESH_AT,
    ]);
  };
  const setEnabled = async (pglite, who, enabled) => {
    await actAs(pglite, who);
    return pglite.query("select public.set_kakao_notify_enabled($1)", [enabled]);
  };
  // worker 가 갱신 실패(invalid_grant)로 연결을 만료시키는 자리.
  const expire = async (pglite, who) => {
    await asWorker(pglite);
    await pglite.query(
      "update public.kakao_notify_links set status = 'EXPIRED', last_result = 'EXPIRED' where user_id = $1",
      [who],
    );
  };
  const testOutboxOf = async (pglite) =>
    workerRows(
      pglite,
      `select org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status
       from public.outbox_events where event_type = 'KAKAO_TEST' order by created_at, id`,
    );

  it("① 본인은 자기 행의 허용 열 여섯 개만 읽는다 — 토큰·만료·created_at 열은 하나씩 골라도, 그 열로 걸러도, select * 도 권한 오류(42501)다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await actAs(pglite, ME);
    const rows = (await pglite.query(`select ${VISIBLE.join(", ")} from public.kakao_notify_links`))
      .rows;
    assert.deepEqual(Object.keys(rows[0] ?? {}), VISIBLE);
    assert.deepEqual(
      rows.map(({ updated_at, ...row }) => ({
        ...row,
        has_updated_at: updated_at instanceof Date,
      })),
      [
        {
          user_id: ME,
          enabled: true,
          status: "CONNECTED",
          last_sent_at: null,
          last_result: null,
          has_updated_at: true,
        },
      ],
    );
    for (const column of HIDDEN) {
      await assert.rejects(
        pglite.query(`select ${column} from public.kakao_notify_links`),
        TABLE_DENIED,
        `select ${column}`,
      );
      // PostgREST 의 ?<열>=eq.<값> 필터 자리. 숨긴 열 값을 짐작해 맞혀 보는 길도 닫힌다.
      await assert.rejects(
        pglite.query(`select user_id from public.kakao_notify_links where ${column} is not null`),
        TABLE_DENIED,
        `where ${column}`,
      );
    }
    await assert.rejects(pglite.query("select * from public.kakao_notify_links"), TABLE_DENIED);
  });

  it("① 화면 역할의 kakao_notify_links 권한은 authenticated 의 열 단위 SELECT 여섯 개뿐이다 — 표 단위 권한은 없고 anon 에는 아무것도 없다", async (t) => {
    const pglite = await migratedDb(t);
    assert.deepEqual(
      await workerRows(
        pglite,
        "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='kakao_notify_links' and grantee in ('anon','authenticated')",
      ),
      [],
    );
    assert.deepEqual(
      await workerRows(
        pglite,
        "select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name='kakao_notify_links' and grantee in ('anon','authenticated') order by 1,2,3",
      ),
      [...VISIBLE].sort().map((column_name) => ({
        grantee: "authenticated",
        column_name,
        privilege_type: "SELECT",
      })),
    );
  });

  it("② 남의 행은 0행이다 — 두 사람이 모두 연결해도 각자 자기 행 하나만 보이고, 남의 user_id 로 걸러도 0행이며 운영자(is_admin)도 남의 행을 못 본다", async (t) => {
    const pglite = await migratedDb(t);
    await asWorker(pglite);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [OPERATOR]);
    await save(pglite, ME);
    await save(pglite, OTHER);
    for (const [who, other] of [
      [ME, OTHER],
      [OTHER, ME],
    ]) {
      await actAs(pglite, who);
      assert.deepEqual(
        (await pglite.query("select user_id from public.kakao_notify_links")).rows,
        [{ user_id: who }],
        who,
      );
      assert.deepEqual(
        (
          await pglite.query("select user_id from public.kakao_notify_links where user_id = $1", [
            other,
          ])
        ).rows,
        [],
        `${who} → ${other}`,
      );
    }
    await actAs(pglite, OPERATOR);
    assert.deepEqual(
      (await pglite.query("select user_id from public.kakao_notify_links")).rows,
      [],
    );
  });

  it("③ anon 은 표 읽기·쓰기와 RPC 넷 모두 권한 오류(42501)이고 행은 그대로다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    const before = await linkOf(pglite, ME);
    await actAs(pglite, null, "anon");
    await assert.rejects(
      pglite.query("select user_id from public.kakao_notify_links"),
      TABLE_DENIED,
    );
    await assert.rejects(
      pglite.query("update public.kakao_notify_links set enabled = false where user_id = $1", [ME]),
      TABLE_DENIED,
    );
    await assert.rejects(
      pglite.query("delete from public.kakao_notify_links where user_id = $1", [ME]),
      TABLE_DENIED,
    );
    for (const [name, sql] of RPCS) await assert.rejects(pglite.query(sql), fnDenied(name), name);
    assert.deepEqual(await linkOf(pglite, ME), before);
  });

  it("③ 로그인 역할이어도 JWT 에 사용자(sub)가 없으면 RPC 넷 모두 UNAUTHENTICATED 다", async (t) => {
    const pglite = await migratedDb(t);
    await actAs(pglite, null);
    for (const [name, sql] of RPCS)
      await assert.rejects(pglite.query(sql), { message: "UNAUTHENTICATED" }, name);
    assert.deepEqual(await workerRows(pglite, "select user_id from public.kakao_notify_links"), []);
  });

  it("④ set_kakao_notify_enabled(true) 는 행이 없으면 KAKAO_NOT_CONNECTED 다 — 끄기(false)는 행이 없어도 오류 없이 아무것도 만들지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await assert.rejects(setEnabled(pglite, ME, true), NOT_CONNECTED);
    await setEnabled(pglite, ME, false);
    assert.deepEqual(await linkOf(pglite, ME), []);
  });

  it("④ CONNECTED 행은 끄고 다시 켤 수 있고, EXPIRED 행은 켤 수 없지만(KAKAO_NOT_CONNECTED) 끌 수는 있다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    const stateOf = async () =>
      (await linkOf(pglite, ME)).map(({ enabled, status }) => ({ enabled, status }));
    await setEnabled(pglite, ME, false);
    assert.deepEqual(await stateOf(), [{ enabled: false, status: "CONNECTED" }]);
    await setEnabled(pglite, ME, true);
    assert.deepEqual(await stateOf(), [{ enabled: true, status: "CONNECTED" }]);
    await expire(pglite, ME);
    await assert.rejects(setEnabled(pglite, ME, true), NOT_CONNECTED);
    await setEnabled(pglite, ME, false);
    assert.deepEqual(await stateOf(), [{ enabled: false, status: "EXPIRED" }]);
    await assert.rejects(setEnabled(pglite, ME, true), NOT_CONNECTED);
    assert.deepEqual(await stateOf(), [{ enabled: false, status: "EXPIRED" }]);
  });

  it("⑤ save_kakao_notify_link 뒤 본인 행은 enabled=true·status='CONNECTED' 이고 암호문·만료 시각이 그대로 들어간다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME, "v1.enc-access-1", "v1.enc-refresh-1");
    assert.deepEqual(await linkOf(pglite, ME), [
      {
        user_id: ME,
        enabled: true,
        status: "CONNECTED",
        access_token_enc: "v1.enc-access-1",
        refresh_token_enc: "v1.enc-refresh-1",
        access_expires_at: ACCESS_AT,
        refresh_expires_at: REFRESH_AT,
        last_sent_at: null,
        last_result: null,
      },
    ]);
  });

  it("⑤ 다시 저장하면(재연결) 같은 행을 바꾼다 — EXPIRED·끔이 CONNECTED·켬으로 돌아오고 암호문이 바뀌며 행은 1개다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME, "v1.enc-access-1", "v1.enc-refresh-1");
    await expire(pglite, ME);
    await setEnabled(pglite, ME, false);
    await save(pglite, ME, "v1.enc-access-2", "v1.enc-refresh-2");
    assert.deepEqual(
      (await linkOf(pglite, ME)).map(
        ({ enabled, status, access_token_enc, refresh_token_enc }) => ({
          enabled,
          status,
          access_token_enc,
          refresh_token_enc,
        }),
      ),
      [
        {
          enabled: true,
          status: "CONNECTED",
          access_token_enc: "v1.enc-access-2",
          refresh_token_enc: "v1.enc-refresh-2",
        },
      ],
    );
  });

  it("⑥ disconnect_kakao_notify 뒤 본인 행은 0행이고 남의 행은 그대로다 — 행이 없을 때 다시 불러도 오류가 없다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await save(pglite, OTHER);
    const otherBefore = await linkOf(pglite, OTHER);
    await actAs(pglite, ME);
    await pglite.query("select public.disconnect_kakao_notify()");
    assert.deepEqual(await linkOf(pglite, ME), []);
    assert.deepEqual(await linkOf(pglite, OTHER), otherBefore);
    await actAs(pglite, ME);
    await pglite.query("select public.disconnect_kakao_notify()");
    assert.deepEqual(await linkOf(pglite, ME), []);
  });

  it("⑦ request_kakao_notify_test() 를 같은 분에 두 번 부르면 true, false 이고 outbox 에는 KAKAO_TEST 1행이다(org_id null·aggregate·payload·키 <userId>:<UTC 분>:KAKAO_TEST)", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await actAs(pglite, ME);
    // 한 트랜잭션 안의 now() 는 같아서 분 경계에 걸려도 두 번이 같은 분이다.
    await pglite.exec("begin");
    const first = (await pglite.query("select public.request_kakao_notify_test() as queued")).rows;
    const second = (await pglite.query("select public.request_kakao_notify_test() as queued")).rows;
    const [{ minute }] = (
      await pglite.query(
        `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as minute`,
      )
    ).rows;
    await pglite.exec("commit");
    assert.deepEqual([first, second], [[{ queued: true }], [{ queued: false }]]);
    assert.match(minute, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.deepEqual(await testOutboxOf(pglite), [
      {
        org_id: null,
        aggregate_type: "kakao_notify_link",
        aggregate_id: ME,
        event_type: "KAKAO_TEST",
        payload: { userId: ME },
        idempotency_key: `${ME}:${minute}:KAKAO_TEST`,
        status: "PENDING",
      },
    ]);
  });

  it("⑦ 연결이 없거나, 꺼져 있거나, EXPIRED 이면 request_kakao_notify_test() 는 KAKAO_NOT_READY 이고 outbox 를 쓰지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    const request = async () => {
      await actAs(pglite, ME);
      return pglite.query("select public.request_kakao_notify_test()");
    };
    await assert.rejects(request(), NOT_READY, "연결 없음");
    await save(pglite, ME);
    await setEnabled(pglite, ME, false);
    await assert.rejects(request(), NOT_READY, "꺼짐");
    await setEnabled(pglite, ME, true);
    await expire(pglite, ME);
    await assert.rejects(request(), NOT_READY, "EXPIRED");
    assert.deepEqual(await testOutboxOf(pglite), []);
  });

  it("⑧ authenticated 가 kakao_notify_links 를 직접 update·insert·delete 하면 권한 오류(42501)이고, outbox_events 에 직접 넣는 길도 막혀 있다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await expire(pglite, ME);
    const before = await linkOf(pglite, ME);
    await actAs(pglite, ME);
    for (const sql of [
      "update public.kakao_notify_links set status = 'CONNECTED' where user_id = $1",
      "update public.kakao_notify_links set enabled = true where user_id = $1",
      "update public.kakao_notify_links set access_token_enc = 'forged' where user_id = $1",
    ])
      await assert.rejects(pglite.query(sql, [ME]), TABLE_DENIED, sql);
    await assert.rejects(
      pglite.query(
        "insert into public.kakao_notify_links (user_id, enabled, status) values ($1, true, 'CONNECTED')",
        [OTHER],
      ),
      TABLE_DENIED,
    );
    await assert.rejects(
      pglite.query("delete from public.kakao_notify_links where user_id = $1", [ME]),
      TABLE_DENIED,
    );
    await assert.rejects(
      pglite.query(
        "insert into public.outbox_events (aggregate_type, aggregate_id, event_type, idempotency_key) values ('kakao_notify_link', $1, 'KAKAO_TEST', 'forged')",
        [ME],
      ),
      { code: "42501", message: /permission denied for table outbox_events/ },
    );
    assert.deepEqual(await linkOf(pglite, ME), before);
    assert.deepEqual(await linkOf(pglite, OTHER), []);
  });

  // ── ⑨·⑩ 20261021000003 보강 ──

  // 저장 RPC 를 값 그대로 부른다(null 도 넘긴다). save 와 달리 기본값을 채우지 않는다.
  const saveRaw = async (pglite, who, access, refresh, accessAt, refreshAt) => {
    await actAs(pglite, who);
    return pglite.query("select public.save_kakao_notify_link($1, $2, $3, $4)", [
      access,
      refresh,
      accessAt,
      refreshAt,
    ]);
  };
  // worker 자리에서 그 사용자의 KAKAO_TEST outbox 를 created_at 이 now() - minutesAgo 분인 행으로 count 건 넣는다.
  const seedTestOutbox = async (pglite, who, count, minutesAgo, keyPrefix = "seed") => {
    await asWorker(pglite);
    for (let index = 0; index < count; index += 1) {
      await pglite.query(
        `insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status, created_at)
         values (null, 'kakao_notify_link', $1::uuid, 'KAKAO_TEST', jsonb_build_object('userId', $1::uuid), $2, 'PROCESSED',
                 now() - make_interval(mins => $3::int))`,
        [who, `${who}:${keyPrefix}-${index}:KAKAO_TEST`, minutesAgo],
      );
    }
  };
  const testOutboxCountOf = async (pglite, who) =>
    (
      await workerRows(
        pglite,
        "select count(*)::int as count from public.outbox_events where event_type = 'KAKAO_TEST' and aggregate_id = $1",
        [who],
      )
    )[0].count;
  const requestTest = async (pglite, who) => {
    await actAs(pglite, who);
    return (await pglite.query("select public.request_kakao_notify_test() as queued")).rows[0]
      .queued;
  };

  it("⑨ save_kakao_notify_link 는 토큰 둘·만료 둘 중 하나라도 null 이면 KAKAO_LINK_INVALID 이고 행을 만들지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    const valid = ["v1.access", "v1.refresh", ACCESS_AT, REFRESH_AT];
    for (let index = 0; index < valid.length; index += 1) {
      const args = valid.map((value, position) => (position === index ? null : value));
      await assert.rejects(saveRaw(pglite, ME, ...args), LINK_INVALID, `null 자리 ${index}`);
    }
    assert.deepEqual(await linkOf(pglite, ME), []);
  });

  it("⑨ 토큰이 'v1.' 로 시작하지 않으면 KAKAO_LINK_INVALID 다(접두어 틀림·대문자·v2·앞 공백·빈 값)", async (t) => {
    const pglite = await migratedDb(t);
    for (const wrong of ["enc-access", "V1.access", "v2.access", " v1.access", "v1", ""]) {
      await assert.rejects(
        saveRaw(pglite, ME, wrong, "v1.refresh", ACCESS_AT, REFRESH_AT),
        LINK_INVALID,
        `access ${JSON.stringify(wrong)}`,
      );
      await assert.rejects(
        saveRaw(pglite, ME, "v1.access", wrong, ACCESS_AT, REFRESH_AT),
        LINK_INVALID,
        `refresh ${JSON.stringify(wrong)}`,
      );
    }
    assert.deepEqual(await linkOf(pglite, ME), []);
  });

  it("⑨ 토큰이 4097자면 KAKAO_LINK_INVALID 이고, 4096자는 저장한다", async (t) => {
    const pglite = await migratedDb(t);
    const ofLength = (length) => `v1.${"a".repeat(length - "v1.".length)}`;
    await assert.rejects(
      saveRaw(pglite, ME, ofLength(4097), "v1.refresh", ACCESS_AT, REFRESH_AT),
      LINK_INVALID,
      "access 4097",
    );
    await assert.rejects(
      saveRaw(pglite, ME, "v1.access", ofLength(4097), ACCESS_AT, REFRESH_AT),
      LINK_INVALID,
      "refresh 4097",
    );
    assert.deepEqual(await linkOf(pglite, ME), []);
    await saveRaw(pglite, ME, ofLength(4096), ofLength(4096), ACCESS_AT, REFRESH_AT);
    assert.deepEqual(
      (await linkOf(pglite, ME)).map(({ status, access_token_enc, refresh_token_enc }) => ({
        status,
        access: access_token_enc.length,
        refresh: refresh_token_enc.length,
      })),
      [{ status: "CONNECTED", access: 4096, refresh: 4096 }],
    );
  });

  it("⑨ 정상 값은 그대로 저장하고, 거절된 재연결은 이미 있는 연결을 바꾸지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await saveRaw(
      pglite,
      ME,
      "v1.kid.iv.tag.access",
      "v1.kid.iv.tag.refresh",
      ACCESS_AT,
      REFRESH_AT,
    );
    const before = await linkOf(pglite, ME);
    assert.deepEqual(
      before.map(({ status, access_token_enc, refresh_token_enc, access_expires_at }) => ({
        status,
        access_token_enc,
        refresh_token_enc,
        access_expires_at,
      })),
      [
        {
          status: "CONNECTED",
          access_token_enc: "v1.kid.iv.tag.access",
          refresh_token_enc: "v1.kid.iv.tag.refresh",
          access_expires_at: ACCESS_AT,
        },
      ],
    );
    await assert.rejects(saveRaw(pglite, ME, null, null, null, null), LINK_INVALID);
    await assert.rejects(
      saveRaw(pglite, ME, "plain-token", "v1.r", ACCESS_AT, REFRESH_AT),
      LINK_INVALID,
    );
    assert.deepEqual(await linkOf(pglite, ME), before);
  });

  it("⑨ 사용자(sub)가 없으면 입력이 틀려도 UNAUTHENTICATED 가 먼저다", async (t) => {
    const pglite = await migratedDb(t);
    await actAs(pglite, null);
    await assert.rejects(
      pglite.query("select public.save_kakao_notify_link(null, null, null, null)"),
      { message: "UNAUTHENTICATED" },
    );
  });

  it("⑩ request_kakao_notify_test 는 최근 24시간에 그 사람의 KAKAO_TEST 가 10건이면 11번째를 넣지 않고 false 다 — outbox 가 늘지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await seedTestOutbox(pglite, ME, 10, 23 * 60 + 59);
    assert.equal(await testOutboxCountOf(pglite, ME), 10);
    assert.equal(await requestTest(pglite, ME), false);
    assert.equal(await testOutboxCountOf(pglite, ME), 10);
  });

  it("⑩ 9건이면 10번째는 넣고(true) 그다음은 false 다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await seedTestOutbox(pglite, ME, 9, 60);
    assert.equal(await requestTest(pglite, ME), true);
    assert.equal(await testOutboxCountOf(pglite, ME), 10);
    // 같은 분 키 중복(⑦)과 섞이지 않게 방금 넣은 행의 키를 바꾸고 한 분 앞으로 민다. 상한이 없으면 다음 요청은 true 다.
    await asWorker(pglite);
    await pglite.query(
      "update public.outbox_events set created_at = now() - interval '1 minute', idempotency_key = idempotency_key || ':moved' where aggregate_id = $1 and status = 'PENDING'",
      [ME],
    );
    assert.equal(await requestTest(pglite, ME), false);
    assert.equal(await testOutboxCountOf(pglite, ME), 10);
  });

  it("⑩ 24시간보다 오래된 KAKAO_TEST 와 다른 사람의 KAKAO_TEST 는 세지 않는다", async (t) => {
    const pglite = await migratedDb(t);
    await save(pglite, ME);
    await seedTestOutbox(pglite, ME, 10, 24 * 60 + 1, "old");
    await seedTestOutbox(pglite, OTHER, 10, 30, "other");
    assert.equal(await requestTest(pglite, ME), true);
    assert.equal(await testOutboxCountOf(pglite, ME), 11);
  });

  // ── ⑪ 20261021000004: 상한을 세는 질의가 outbox 전체를 읽지 않는다(보안 검토 하) ──
  it("⑪ outbox_events_kakao_test_idx 는 (aggregate_id, created_at) 이고 KAKAO_TEST 행만 덮는다", async (t) => {
    const pglite = await migratedDb(t);
    const { rows } = await pglite.query(
      "select tablename, indexdef from pg_indexes where schemaname = 'public' and indexname = 'outbox_events_kakao_test_idx'",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tablename, "outbox_events");
    assert.match(rows[0].indexdef, /\(aggregate_id, created_at\)/);
    assert.match(rows[0].indexdef, /WHERE \(event_type = 'KAKAO_TEST'::text\)/);
  });

  it("⑪ request_kakao_notify_test 의 상한 세기 질의는 순차 읽기를 끄면 그 인덱스를 쓴다", async (t) => {
    const pglite = await migratedDb(t);
    await seedTestOutbox(pglite, ME, 10, 30);
    await pglite.query("set enable_seqscan = off");
    const { rows } = await pglite.query(
      `explain select count(*) from public.outbox_events o
       where o.aggregate_id = $1 and o.event_type = 'KAKAO_TEST'
         and o.created_at > now() - interval '24 hours'`,
      [ME],
    );
    const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(plan, /outbox_events_kakao_test_idx/);
  });
});

describe("마이그레이션 재실행", () => {
  it("전체를 두 번 적용해도 실패하지 않고 RLS·권한·정책·트리거가 같다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    const once = await accessSnapshot(fresh);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(await accessSnapshot(fresh), once);
  });
});

describe("배포 전 DB 검증", () => {
  it("연결되더라도 적용 이력이 없으면 실패한다", async () => {
    await db.exec("reset role");
    await assert.rejects(verifyDatabase(db), /적용 이력/);
  });
  it("이력이 있지만 필요한 마이그레이션이 빠졌으면 실패한다", async () => {
    await db.exec(
      "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)",
    );
    await assert.rejects(verifyDatabase(db), /미적용/);
    for (const migration of migrations)
      await db.query("insert into supabase_migrations.schema_migrations values ($1)", [
        migration.version,
      ]);
    assert.equal((await verifyDatabase(db)).applied, migrations.length);
  });
  it("RLS가 빠진 테이블이 생기면 실패한다", async () => {
    await db.exec("create table public.unprotected(id int)");
    await assert.rejects(verifyDatabase(db), /unprotected/);
    await db.exec("drop table public.unprotected");
  });
});

// 로컬 정책 시험과 배포 검증(verifyDatabase)이 같은 검사기(findDangerousPrivileges)를 쓴다.
// 모든 시험은 자기만 쓰는 새 DB 에서 돈다.
describe("화면 역할의 위험한 표 권한", () => {
  it("전체 마이그레이션을 적용한 새 DB 에는 위험 권한이 없다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(await findDangerousPrivileges(fresh), []);
  });

  it("새 표에 RLS 만 켜고 기본 권한(all)을 남기면 실패하고, 필요한 CRUD 만 남기면 통과한다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create table public.things (id int primary key);
      alter table public.things enable row level security;
    `);
    assert.deepEqual(
      await findDangerousPrivileges(fresh),
      ["anon", "authenticated"].flatMap((role) =>
        ALL_DANGERS.map((privilege) => finding("things", role, privilege)),
      ),
    );
    await assert.rejects(
      assertNoDangerousPrivileges(fresh),
      /public\.things anon REFERENCES\n {2}public\.things anon TRIGGER/,
    );
    await fresh.exec(`
      revoke all on public.things from anon, authenticated, public;
      grant select, insert, update, delete on public.things to anon, authenticated;
    `);
    assert.deepEqual(await findDangerousPrivileges(fresh), []);
  });

  it("역할마다 위험 권한 하나만 줘도 그 역할·권한을 짚는다", async (t) => {
    const fresh = await freshDb(t);
    for (const role of ["anon", "authenticated"])
      for (const privilege of ALL_DANGERS) {
        await lockedTable(fresh, "probe");
        await fresh.exec(`grant ${privilege} on public.probe to ${role}`);
        assert.deepEqual(await findDangerousPrivileges(fresh), [finding("probe", role, privilege)]);
        await fresh.exec("drop table public.probe");
      }
  });

  it("PUBLIC 에 준 권한은 두 화면 역할 모두에 잡힌다", async (t) => {
    const fresh = await freshDb(t);
    await lockedTable(fresh, "shared");
    await fresh.exec("grant truncate on public.shared to public");
    assert.deepEqual(await findDangerousPrivileges(fresh), [
      finding("shared", "anon", "TRUNCATE"),
      finding("shared", "authenticated", "TRUNCATE"),
    ]);
  });

  it("다른 역할에서 상속받은 권한도 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await lockedTable(fresh, "inherited");
    await fresh.exec(`
      create role screen_helper nologin;
      grant trigger on public.inherited to screen_helper;
      grant screen_helper to anon;
    `);
    assert.deepEqual(await findDangerousPrivileges(fresh), [
      finding("inherited", "anon", "TRIGGER"),
    ]);
  });

  it("열 단위 REFERENCES 는 잡고, 열 단위 읽기·쓰기는 허용한다", async (t) => {
    const fresh = await freshDb(t);
    await lockedTable(fresh, "columns");
    await fresh.exec(`
      grant select (id, body), insert (body), update (body) on public.columns to authenticated;
      grant references (body) on public.columns to authenticated;
    `);
    assert.deepEqual(await findDangerousPrivileges(fresh), [
      finding("columns", "authenticated", "REFERENCES"),
    ]);
    await fresh.exec("revoke references (body) on public.columns from authenticated");
    assert.deepEqual(await findDangerousPrivileges(fresh), []);
  });

  it("파티션 부모와 리프를 각각 본다", async (t) => {
    const fresh = await freshDb(t);
    await fresh.exec(`
      create table public.events (id int, at date not null) partition by range (at);
      create table public.events_2026 partition of public.events
        for values from ('2026-01-01') to ('2027-01-01');
      alter table public.events enable row level security;
      alter table public.events_2026 enable row level security;
      revoke all on public.events, public.events_2026 from anon, authenticated, public;
      grant select, insert on public.events, public.events_2026 to authenticated;
      grant trigger on public.events to authenticated;
      grant truncate on public.events_2026 to anon;
    `);
    assert.deepEqual(await findDangerousPrivileges(fresh), [
      finding("events", "authenticated", "TRIGGER"),
      finding("events_2026", "anon", "TRUNCATE"),
    ]);
  });
});

// 운영 Supabase 는 public 의 새 함수·시퀀스에도 화면 역할 권한을 명시적으로 준다. 흉내가 이것을 빼면
// 시험만 통과하고 운영에서 새는 길(함수)과, 시험만 실패하고 운영에서는 되는 길(시퀀스)이 생긴다.
describe("Supabase 흉내 — public 의 새 함수·시퀀스 기본 권한", () => {
  it("bigserial 표에 정책이 허용한 insert 는 시퀀스 권한에 막히지 않는다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(`
      create table public.items (
        id bigserial primary key,
        owner uuid not null default auth.uid(),
        body text
      );
      alter table public.items enable row level security;
      revoke all on public.items from anon, authenticated, public;
      grant select, insert on public.items to authenticated;
      create policy "본인 것 쓰기" on public.items for insert to authenticated
        with check (auth.uid() = owner);
      create policy "본인 것 읽기" on public.items for select to authenticated
        using (auth.uid() = owner);
    `);
    await actAs(fresh, users[0]);
    await fresh.query("insert into public.items (body) values ('first')");
    assert.deepEqual((await fresh.query("select id::int, body from public.items")).rows, [
      { id: 1, body: "first" },
    ]);
  });

  it("새 함수는 PUBLIC 만 거둬도 화면 역할에 실행 권한이 남는다", async (t) => {
    const fresh = await freshDb(t);
    await fresh.exec(`
      create function public.probe() returns int language sql as 'select 1';
      revoke execute on function public.probe() from public;
    `);
    assert.deepEqual(
      (
        await fresh.query(
          "select rolname, has_function_privilege(oid, 'public.probe()', 'EXECUTE') as can from pg_roles where rolname in ('anon','authenticated') order by 1",
        )
      ).rows,
      [
        { rolname: "anon", can: true },
        { rolname: "authenticated", can: true },
      ],
    );
  });
});

// RLS 는 표에만 걸린다. 뷰·머티리얼라이즈드 뷰·SECURITY DEFINER 함수는 표 권한 검사기(findDangerousPrivileges)에
// 보이지 않으면서 화면 역할에 행을 내줄 수 있다. 로컬 정책 시험과 배포 검증이 같은 검사기(findRlsBypasses)를 쓴다.
describe("뷰·함수로 RLS 를 거치지 않는 길", () => {
  it("전체 마이그레이션을 적용한 새 DB 에는 없다 — 허용 목록의 함수(정책 도우미·탈퇴·회원 상태)는 통과한다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(await findRlsBypasses(fresh), []);
    // 허용 목록이 실제로 쓰인다: 여섯 함수 모두 SECURITY DEFINER 이고 화면 역할이 실행할 수 있다.
    // anon 이 부를 수 있는 것은 정책이 부르는 is_admin() 하나다.
    assert.deepEqual(
      (
        await fresh.query(
          `select p.oid::regprocedure::text as fn, p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
           from pg_proc p
           where p.oid = any(array[
             'public.is_admin()', 'public.my_org_ids()', 'public.my_owner_org_ids()',
             'public.is_active_user()', 'public.delete_my_account()',
             'public.admin_set_user_status(uuid, text)'
           ]::regprocedure[])
           order by 1`,
        )
      ).rows,
      [
        {
          fn: "admin_set_user_status(uuid,text)",
          prosecdef: true,
          anon: false,
          authenticated: true,
        },
        { fn: "delete_my_account()", prosecdef: true, anon: false, authenticated: true },
        { fn: "is_active_user()", prosecdef: true, anon: false, authenticated: true },
        { fn: "is_admin()", prosecdef: true, anon: true, authenticated: true },
        { fn: "my_org_ids()", prosecdef: true, anon: false, authenticated: true },
        { fn: "my_owner_org_ids()", prosecdef: true, anon: false, authenticated: true },
      ],
    );
  });

  it("security_invoker 가 아닌 뷰는 anon 에게 모든 이메일을 보여 주고, 검사기와 배포 검증이 잡는다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(
      "create view public.profile_emails as select id, email, is_admin from public.profiles",
    );
    // 재현: 로그아웃한 사람이 모든 사용자의 이메일을 읽는다. 표 권한 검사기는 이것을 보지 못한다.
    await actAs(fresh, null, "anon");
    assert.equal((await fresh.query("select email from public.profile_emails")).rows.length, 3);
    await fresh.exec("reset role");
    assert.deepEqual(await findDangerousPrivileges(fresh), []);

    assert.deepEqual(await findRlsBypasses(fresh), opened("profile_emails", "view", READ_WRITE));
    await assert.rejects(
      verifyDatabase(fresh),
      /public\.profile_emails 뷰 anon SELECT[\s\S]*security_invoker = true/,
    );

    await fresh.exec("alter view public.profile_emails set (security_invoker = true)");
    assert.deepEqual(await findRlsBypasses(fresh), []);
    await actAs(fresh, null, "anon");
    assert.deepEqual((await fresh.query("select email from public.profile_emails")).rows, []);
    await fresh.exec("reset role");
    assert.equal((await verifyDatabase(fresh)).applied, migrations.length);
  });

  it("security_invoker 의 값 변형은 켜진 것으로 보고, security_barrier 만 켜거나 끈 뷰는 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    const check = async (options) => {
      const clause = options ? `with (${options})` : "";
      await fresh.exec(`create view public.probe ${clause} as select id from public.profiles`);
      const found = await findRlsBypasses(fresh);
      await fresh.exec("drop view public.probe");
      return found;
    };
    for (const options of [
      "security_invoker = true",
      "security_invoker = TRUE",
      "security_invoker = 'ON'",
      "security_invoker = yes",
      "security_invoker = 1",
      "security_invoker = t",
      "security_invoker",
      "check_option = local, security_barrier = true, security_invoker = on",
    ])
      assert.deepEqual(await check(options), [], options);
    for (const options of [
      "",
      "security_barrier = true",
      "security_invoker = false",
      "security_invoker = OFF, security_barrier",
      "check_option = cascaded",
    ])
      assert.deepEqual(await check(options), opened("probe", "view", READ_WRITE), options);
  });

  it("화면 역할이 못 읽는 뷰는 통과하고, 열 하나·PUBLIC 으로만 읽어도 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create view public.admin_emails as select id, email from public.profiles;
      revoke all on public.admin_emails from anon, authenticated, public;
    `);
    assert.deepEqual(await findRlsBypasses(fresh), []);
    await fresh.exec("grant select (email) on public.admin_emails to authenticated");
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("admin_emails", "view", "authenticated", "SELECT"),
    ]);
    await fresh.exec(`
      revoke all on public.admin_emails from authenticated;
      grant select on public.admin_emails to public;
    `);
    assert.deepEqual(await findRlsBypasses(fresh), opened("admin_emails", "view", ["SELECT"]));
  });

  it("읽기를 거둬도 쓰기 권한이 남은 security_invoker 아닌 뷰는 정책 없이 남의 행을 바꾼다 — 검사기가 잡는다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(`
      create view public.profile_rows as select id, email from public.profiles;
      revoke select on public.profile_rows from anon, authenticated, public;
    `);
    assert.deepEqual(
      await findRlsBypasses(fresh),
      opened("profile_rows", "view", ["DELETE", "INSERT", "UPDATE"]),
    );
    // 재현: profiles 의 email 에는 update 권한도 정책도 없지만 뷰를 거치면 소유자 권한으로 모든 행이 바뀐다.
    // (지우기로 재현하면 개인 조직의 마지막 owner 보호가 먼저 막는다. 보호가 없는 표였다면 그대로 지워진다.)
    await actAs(fresh, users[0]);
    await fresh.query("update public.profile_rows set email = 'taken@example.invalid'");
    await fresh.exec("reset role");
    assert.deepEqual((await fresh.query("select distinct email from public.profiles")).rows, [
      { email: "taken@example.invalid" },
    ]);

    // 열 하나의 update 만 남아도 잡는다.
    await fresh.exec(`
      revoke all on public.profile_rows from anon, authenticated, public;
      grant update (email) on public.profile_rows to authenticated;
    `);
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("profile_rows", "view", "authenticated", "UPDATE"),
    ]);
  });

  it("외부 표(foreign table)는 RLS 를 켤 수 없으니 화면 역할이 읽거나 쓸 수 있으면 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create foreign data wrapper probe_wrapper;
      create server probe_server foreign data wrapper probe_wrapper;
      create foreign table public.remote_rows (id int) server probe_server;
    `);
    assert.deepEqual(
      await findRlsBypasses(fresh),
      opened("remote_rows", "foreign table", READ_WRITE),
    );
    await fresh.exec("revoke all on public.remote_rows from anon, authenticated, public");
    assert.deepEqual(await findRlsBypasses(fresh), []);
  });

  it("머티리얼라이즈드 뷰는 화면 역할이 읽을 수 있으면 잡는다(RLS 를 걸 수 없다)", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(
      "create materialized view public.profile_counts as select count(*)::int as total from public.profiles",
    );
    assert.deepEqual(
      await findRlsBypasses(fresh),
      opened("profile_counts", "materialized view", ["SELECT"]),
    );
    await assert.rejects(verifyDatabase(fresh), /public\.profile_counts 머티리얼라이즈드 뷰 anon/);
    await fresh.exec("revoke select on public.profile_counts from anon, authenticated, public");
    assert.deepEqual(await findRlsBypasses(fresh), []);
    await fresh.exec("grant select (total) on public.profile_counts to anon");
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("profile_counts", "materialized view", "anon", "SELECT"),
    ]);
  });

  it("PUBLIC 만 거둔 SECURITY DEFINER 함수는 화면 역할이 여전히 부르고, 검사기와 배포 검증이 잡는다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(`
      create function public.all_emails() returns setof text
        language sql stable security definer set search_path = ''
        as $$ select email from public.profiles $$;
      revoke execute on function public.all_emails() from public;
    `);
    // 재현: 소유자 권한으로 돌아 RLS 를 거치지 않는다. /rpc/all_emails 와 같다.
    await actAs(fresh, null, "anon");
    assert.equal((await fresh.query("select public.all_emails()")).rows.length, 3);
    await fresh.exec("reset role");

    assert.deepEqual(await findRlsBypasses(fresh), opened("all_emails()", "function", ["EXECUTE"]));
    await assert.rejects(
      verifyDatabase(fresh),
      /public\.all_emails\(\) SECURITY DEFINER 함수 anon EXECUTE[\s\S]*revoke execute on function/,
    );
    await fresh.exec("revoke execute on function public.all_emails() from anon, authenticated");
    assert.deepEqual(await findRlsBypasses(fresh), []);
    // PUBLIC 에 주면 두 역할 모두 상속한다.
    await fresh.exec("grant execute on function public.all_emails() to public");
    assert.deepEqual(await findRlsBypasses(fresh), opened("all_emails()", "function", ["EXECUTE"]));
    await fresh.exec(`
      revoke execute on function public.all_emails() from public;
      grant execute on function public.all_emails() to authenticated;
    `);
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("all_emails()", "function", "authenticated", "EXECUTE"),
    ]);
  });

  it("허용 목록은 이름이 아니라 시그니처로 맞춘다 — 허용한 함수와 이름이 같아도 인자가 다르면 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create function public.is_admin(target uuid) returns boolean
        language sql stable security definer set search_path = ''
        as $$ select false $$;
      create function public.delete_my_account(target uuid) returns void
        language sql security definer set search_path = ''
        as $$ select $$;
      create function public.admin_set_user_status(target uuid) returns void
        language sql security definer set search_path = ''
        as $$ select $$;
    `);
    assert.deepEqual(await findRlsBypasses(fresh), [
      ...opened("admin_set_user_status(uuid)", "function", ["EXECUTE"]),
      ...opened("delete_my_account(uuid)", "function", ["EXECUTE"]),
      ...opened("is_admin(uuid)", "function", ["EXECUTE"]),
    ]);
  });

  // 회귀: 결과의 name 열은 뷰 갈래(pg_class.relname, name 형)와 함수 갈래를 union 한다. 첫 갈래가 name 형이면 함수 시그니처가
  // 63바이트에서 잘려 허용 목록과 맞지 않고, 앞 63자가 같은 다른 함수와 구별되지 않는다(20261021000001 의 save_kakao_notify_link).
  it("64자를 넘는 함수 시그니처도 잘리지 않고 그대로 나온다 — 허용한 긴 시그니처는 통과하고, 인자 하나만 다른 오버로드는 전체 이름으로 잡는다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create function public.save_kakao_notify_link(text, text, timestamptz, timestamptz, text) returns void
        language sql security definer set search_path = ''
        as $$ select $$;
    `);
    const overload =
      "save_kakao_notify_link(text, text, timestamp with time zone, timestamp with time zone, text)";
    assert.ok(overload.length > 64, `${overload.length}자`);
    assert.deepEqual(await findRlsBypasses(fresh), opened(overload, "function", ["EXECUTE"]));
  });

  it("모든 SECURITY DEFINER 함수는 search_path 를 고정해야 한다 — 허용 목록도 예외가 아니다", async (t) => {
    const fresh = await migratedDb(t);
    await fresh.exec(`
      create function public.unpinned() returns int language sql security definer as 'select 1';
      revoke execute on function public.unpinned() from anon, authenticated, public;
      create function public.invoker_unpinned() returns int language sql as 'select 1';
    `);
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("unpinned()", "function", null, "search_path"),
    ]);
    await assert.rejects(
      verifyDatabase(fresh),
      /public\.unpinned\(\) SECURITY DEFINER 함수 search_path 미고정[\s\S]*set search_path = ''/,
    );
    // 빈 search_path('') 도 고정이다.
    await fresh.exec("alter function public.unpinned() set search_path = ''");
    assert.deepEqual(await findRlsBypasses(fresh), []);
    await fresh.exec("alter function public.is_admin() reset search_path");
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("is_admin()", "function", null, "search_path"),
    ]);
  });

  it("트리거 함수는 /rpc 로 못 부르니 실행 권한은 보지 않지만 search_path 는 본다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create function public.touch() returns trigger language plpgsql security definer
        as $$ begin return new; end; $$;
    `);
    assert.equal(
      (
        await fresh.query(
          "select has_function_privilege('anon', 'public.touch()', 'EXECUTE') as can",
        )
      ).rows[0].can,
      true,
    );
    assert.deepEqual(await findRlsBypasses(fresh), [
      bypass("touch()", "function", null, "search_path"),
    ]);
    await fresh.exec("alter function public.touch() set search_path = ''");
    assert.deepEqual(await findRlsBypasses(fresh), []);
  });

  it("화면 역할이 없는 DB 는 통과로 처리하지 않는다", async (t) => {
    const bare = new PGlite();
    t.after(() => bare.close());
    await bare.exec("create view public.anything as select 1 as one");
    await assert.rejects(findRlsBypasses(bare), /화면 역할이 없습니다: anon, authenticated/);
  });
});

// 확장이 public 에 깐 객체(예: PostGIS 의 geometry_columns 뷰)는 확장 주인 소유라 마이그레이션이 고칠 수 없다.
// 검사기가 이것을 잡으면 그 확장을 쓰는 프로젝트의 배포 검증이 늘 실패한다.
describe("확장이 깐 객체", () => {
  // 확장 pg_buffercache 를 실을 수 있는 흉내 DB. 이 확장은 깐 스키마(public)에 security_invoker 없는 뷰를 만든다.
  const extensionDb = async (t) => {
    const pglite = await mimicSupabase(new PGlite({ extensions: { pg_buffercache } }));
    t.after(() => pglite.close());
    await applyMigrations(pglite, migrations);
    return pglite;
  };

  it("확장이 public 에 깐 뷰는 화면 역할이 읽어도 잡지 않아 배포 검증이 통과하고, 그 옆에 만든 뷰는 잡는다", async (t) => {
    const fresh = await extensionDb(t);
    await fresh.exec("create extension pg_buffercache");
    // 전제: 확장의 뷰도 기본 권한으로 화면 역할에 열리고 security_invoker 가 없는 확장 구성원이다.
    assert.deepEqual(
      (
        await fresh.query(`
          select c.reloptions, has_table_privilege('anon', c.oid, 'SELECT') as anon,
            exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e') as member
          from pg_class c where c.oid = 'public.pg_buffercache'::regclass`)
      ).rows,
      [{ reloptions: null, anon: true, member: true }],
    );
    assert.deepEqual(await findRlsBypasses(fresh), []);
    await recordHistory(fresh);
    assert.equal((await verifyDatabase(fresh)).applied, migrations.length);

    await fresh.exec("create view public.my_buffers as select * from public.pg_buffercache");
    assert.deepEqual(await findRlsBypasses(fresh), opened("my_buffers", "view", READ_WRITE));
  });

  it("확장 구성원이 된(alter extension ... add) 머티리얼라이즈드 뷰·외부 표·SECURITY DEFINER 함수는 빠지고, 빼면 다시 잡힌다", async (t) => {
    // plpgsql 은 어느 DB 에나 깔린 확장이다. add 는 확장 스크립트가 만든 객체와 같은 pg_depend('e') 줄을 남긴다.
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create materialized view public.counts as select 1 as total;
      create foreign data wrapper probe_wrapper;
      create server probe_server foreign data wrapper probe_wrapper;
      create foreign table public.remote_rows (id int) server probe_server;
      create function public.leak() returns int language sql security definer as 'select 1';
    `);
    const members = [
      "materialized view public.counts",
      "foreign table public.remote_rows",
      "function public.leak()",
    ];
    const found = [
      ...opened("counts", "materialized view", ["SELECT"]),
      bypass("leak()", "function", null, "search_path"),
      ...opened("leak()", "function", ["EXECUTE"]),
      ...opened("remote_rows", "foreign table", READ_WRITE),
    ];
    assert.deepEqual(await findRlsBypasses(fresh), found);
    for (const member of members) await fresh.exec(`alter extension plpgsql add ${member}`);
    assert.deepEqual(await findRlsBypasses(fresh), []);
    for (const member of members) await fresh.exec(`alter extension plpgsql drop ${member}`);
    assert.deepEqual(await findRlsBypasses(fresh), found);
  });
});

// 정책 식에서 질의마다 값이 같은 호출(auth.uid()·is_admin() 등)을 감싸지 않으면 행마다 다시 부른다.
// 새 표는 database 스킬의 본보기를 베끼므로, 느린 모양이 하나라도 들어오면 여기서 막는다.
describe("RLS 정책 성능 — 질의마다 값이 같은 호출은 (select ...) 로 감싼다", () => {
  it("전체 마이그레이션을 적용한 DB 의 public 정책은 모두 감쌌다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    assert.deepEqual(
      await slowPolicies(fresh),
      [],
      "정책의 auth.uid()·is_admin() 은 (select auth.uid()) 처럼 감싼다 — database 스킬의 새 표 본보기를 따른다",
    );
  });

  it("프로필 읽기는 is_admin()·auth.uid() 를 행마다가 아니라 질의마다 한 번 부른다(InitPlan)", async (t) => {
    const fresh = await migratedDb(t);
    await actAs(fresh, users[0]);
    const plan = await planOf(fresh, "select id from public.profiles");
    await fresh.exec("reset role");
    assert.match(plan, /InitPlan/, plan);
    assert.doesNotMatch(plan, /is_admin\(\)|current_setting\(/, plan);
  });

  it("감싸지 않은 호출은 잡고, 감싼 호출은 통과시킨다", async (t) => {
    const fresh = await freshDb(t);
    await applyMigrations(fresh, migrations);
    await fresh.exec(`
      create table public.probe (id int primary key, owner uuid, other uuid);
      alter table public.probe enable row level security;
    `);
    const check = async (clause) => {
      await fresh.exec(`create policy "probe" on public.probe for all to authenticated ${clause}`);
      const found = await slowPolicies(fresh, "probe");
      await fresh.exec(`drop policy "probe" on public.probe`);
      return found;
    };
    for (const clause of [
      "using ((select auth.uid()) = owner)",
      "using ((select public.is_admin()))",
      "using ((select auth.jwt() ->> 'role') = 'admin')",
      "using ((select auth.jwt()) ->> 'role' = 'admin')",
      "using ((select current_setting('app.tenant', true)) = 'a')",
      "using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner)",
      "using (owner is not null)",
    ])
      assert.deepEqual(await check(clause), [], clause);
    for (const clause of [
      "using (auth.uid() = owner)",
      "using (public.is_admin())",
      "using (auth.jwt() ->> 'role' = 'admin')",
      "using (current_setting('app.tenant', true) = 'a')",
      "using ((select auth.uid()) = owner or auth.uid() = other)",
      "using ((select auth.uid()) = owner) with check (auth.uid() = owner)",
      "using (exists (select 1 from public.profiles p where p.id = auth.uid()))",
    ])
      assert.deepEqual(await check(clause), ["probe.probe"], clause);
  });
});

describe("솔리데오 카탈로그·가입 신고", () => {
  const solideo = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  const other = "33a80d95-1a64-5fe0-ad6d-e768657e9034";
  const department = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
  const title = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
  const otherDepartment = "10000000-0000-0000-0000-000000000001";
  const otherTitle = "10000000-0000-0000-0000-000000000002";
  const setup = async (t) => {
    const fresh = await migratedDb(t);
    await fresh.query(
      "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오'),($2,'org-02','격리 조직')",
      [solideo, other],
    );
    await fresh.query(
      "insert into public.departments (id,org_id,code,name,source_count,target_count,is_demo) values ($1,$2,'SOL-D001','시험부서',3,4,true),($3,$4,'OTHER-D001','다른부서',1,1,true)",
      [department, solideo, otherDepartment, other],
    );
    await fresh.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J007','팀장',7),($3,$4,'OTHER-J001','다른직급',1)",
      [title, solideo, otherTitle, other],
    );
    await fresh.query(
      "insert into public.memberships (org_id,user_id,org_role) values ($1,$2,'member'),($3,$4,'member')",
      [solideo, users[0], other, users[1]],
    );
    await fresh.query(
      "insert into public.team_members (org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,'SOL-P0001','김민준','MALE',$2,$3,'/demo/people/SOL-P0001.png',true)",
      [solideo, department, title],
    );
    return fresh;
  };
  describe("people business roles", () => {
    // JWT 없는 관리 작업으로 멤버십 전체를 읽는다 — 화면 역할의 시도가 실제로 아무것도 바꾸지 않았는지 정책을 거치지 않고 본다.
    const membershipsOf = async (fresh) => {
      await fresh.exec("reset role");
      await fresh.query("select set_config('request.jwt.claims', '', false)");
      return (
        await fresh.query(
          "select org_id,user_id,org_role,sol_role from public.memberships order by org_id,user_id",
        )
      ).rows;
    };
    // 20261018000001 하나의 계약만 본다. 바로 다음 20261019000001(C2)은 팀 owner 에게 ADMIN 을 채우고 구성원 정책을
    // ADMIN 기준으로 바꾸므로(정책·열 권한·트리거가 달라진다) 적용 범위를 그 앞에서 끊는다. C2 의 채우기는 다음 시험이 본다.
    it("upgrades existing memberships with VIEWER while preserving all prior policies and grants", async (t) => {
      const fresh = await freshDb(t);
      await applyMigrations(
        fresh,
        migrations.filter((migration) => migration.version < "20261018000001"),
      );
      for (const [i, id] of users.entries())
        await fresh.query("insert into auth.users values ($1,$2)", [
          id,
          `user${i}@example.invalid`,
        ]);
      await fresh.query(
        "insert into public.organizations(id,slug,name) values ($1,'role-upgrade','업무 역할')",
        [solideo],
      );
      await fresh.query(
        "insert into public.memberships(org_id,user_id,org_role) values ($1,$2,'owner'),($1,$3,'member')",
        [solideo, users[0], users[1]],
      );
      const before = await accessSnapshot(fresh);
      await applyMigrations(
        fresh,
        migrations.filter(
          (migration) =>
            migration.version >= "20261018000001" && migration.version < "20261019000001",
        ),
      );
      assert.deepEqual(
        (await fresh.query("select org_role,sol_role from public.memberships order by org_role"))
          .rows,
        [
          { org_role: "member", sol_role: "VIEWER" },
          { org_role: "owner", sol_role: "VIEWER" },
        ],
      );
      const after = await accessSnapshot(fresh);
      assert.deepEqual(after.policies, before.policies);
      assert.deepEqual(after.grants, before.grants);
      assert.deepEqual(
        after.columnGrants.filter((grant) => grant.column_name !== "sol_role"),
        before.columnGrants,
      );
      // 새 열은 읽기만 열린다 — 넣기·고치기 열 권한은 거둔다(20261018000001 8행).
      assert.deepEqual(
        after.columnGrants.filter((grant) => grant.column_name === "sol_role"),
        [
          {
            table_name: "memberships",
            column_name: "sol_role",
            grantee: "authenticated",
            privilege_type: "SELECT",
          },
        ],
      );
      assert.deepEqual(after.triggers, before.triggers);
    });
    // 20261019000001 3절(85~90행): 구성원 관리가 ADMIN 기준이 되므로, ADMIN 이 한 명도 없는 팀 조직은 owner 를 ADMIN 으로
    // 한 번 채운다. member·개인 조직(personal_owner_id 가 있는 조직)의 owner·이미 ADMIN 이 있는 팀의 owner 는 그대로다.
    it("20261019000001 backfills ADMIN only for the owner of a team organization that has no ADMIN", async (t) => {
      const fresh = await freshDb(t);
      await applyMigrations(
        fresh,
        migrations.filter((migration) => migration.version < "20261019000001"),
      );
      for (const [i, id] of users.entries())
        await fresh.query("insert into auth.users values ($1,$2)", [
          id,
          `user${i}@example.invalid`,
        ]);
      await fresh.query(
        "insert into public.organizations(id,slug,name) values ($1,'team-a','ADMIN 없는 팀'),($2,'team-b','ADMIN 있는 팀')",
        [solideo, other],
      );
      await fresh.query(
        "insert into public.memberships(org_id,user_id,org_role) values ($1,$3,'owner'),($1,$4,'member'),($2,$4,'owner'),($2,$3,'member')",
        [solideo, other, users[0], users[1]],
      );
      // team-b 는 owner 가 아닌 ADMIN 이 이미 있다. user2 는 이전 가입 흐름의 개인 조직 주인(owner)이다.
      await fresh.query(
        "update public.memberships set sol_role='ADMIN' where org_id=$1 and user_id=$2",
        [other, users[0]],
      );
      await fresh.query("select public.create_personal_org($1)", [users[2]]);
      await applyMigrations(
        fresh,
        migrations.filter((migration) => migration.version >= "20261019000001"),
      );
      assert.deepEqual(
        (
          await fresh.query(
            "select case when o.personal_owner_id is null then o.slug else 'personal' end as org, m.user_id, m.org_role, m.sol_role from public.memberships m join public.organizations o on o.id = m.org_id order by 1, 2",
          )
        ).rows,
        [
          { org: "personal", user_id: users[2], org_role: "owner", sol_role: "VIEWER" },
          { org: "team-a", user_id: users[0], org_role: "owner", sol_role: "ADMIN" },
          { org: "team-a", user_id: users[1], org_role: "member", sol_role: "VIEWER" },
          { org: "team-b", user_id: users[0], org_role: "member", sol_role: "ADMIN" },
          { org: "team-b", user_id: users[1], org_role: "owner", sol_role: "VIEWER" },
        ],
      );
    });
    it("defaults every existing owner/member to VIEWER without granting business ADMIN", async (t) => {
      const fresh = await setup(t);
      await fresh.query("update public.memberships set org_role='owner' where user_id=$1", [
        users[0],
      ]);
      assert.deepEqual(
        (await fresh.query("select org_role,sol_role from public.memberships order by org_role"))
          .rows,
        [
          { org_role: "member", sol_role: "VIEWER" },
          { org_role: "owner", sol_role: "VIEWER" },
        ],
      );
      for (const value of [null, "owner", "admin", "SUPER_ADMIN", ""]) {
        await assert.rejects(
          fresh.query("update public.memberships set sol_role=$1 where user_id=$2", [
            value,
            users[0],
          ]),
          /not-null constraint|check constraint/,
        );
      }
    });
    // 업무 역할과 상관없이 같은 경계: 카탈로그 3표는 자기 조직 것만 읽고 아무도 쓰지 못한다. 다른 조직에는 멤버십을
    // 넣지도(sol_role 열 권한이 없다) 고치지도(읽히지 않으니 0행) 못한다 — ADMIN 이라도 그 조직의 ADMIN 일 뿐이다.
    const assertCatalogReadOnlyAndIsolated = async (fresh) => {
      for (const table of ["departments", "job_titles", "team_members"]) {
        assert.equal(
          (await fresh.query(`select * from public.${table} where org_id=$1`, [solideo])).rows
            .length,
          1,
        );
        assert.deepEqual(
          (await fresh.query(`select * from public.${table} where org_id=$1`, [other])).rows,
          [],
        );
        for (const sql of [
          `insert into public.${table} (org_id) values ($1)`,
          `update public.${table} set org_id=$1`,
          `delete from public.${table} where org_id=$1`,
        ])
          await assert.rejects(fresh.query(sql, [solideo]), /permission denied/);
      }
      await assert.rejects(
        fresh.query(
          "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'member','ADMIN')",
          [other, users[0]],
        ),
        /permission denied/,
      );
      for (const set of ["sol_role='ADMIN'", "org_role='owner'"])
        assert.deepEqual(
          (
            await fresh.query(
              `update public.memberships set ${set} where org_id=$1 returning user_id`,
              [other],
            )
          ).rows,
          [],
          set,
        );
    };
    // 20261019000001(ADR-021): sol_role 의 update 열 권한은 다시 열렸지만 "ADMIN 은 역할 변경" 정책이 ADMIN 이 아닌
    // 사람의 update 대상에 멤버십 행을 넣지 않는다. 그래서 자기 승격(sol_role·org_role)은 오류가 아니라 0행이고 값이 그대로다.
    // ADMIN 이 아닌 사람의 sol_role 변경을 42501 로 거절하는 두 번째 잠금(protect_sol_role)은 "업무 역할 보호 트리거" 시험이 본다.
    for (const role of ["VIEWER", "ANALYST", "SALES"]) {
      it(`${role} can read its catalog but cannot write people or promote itself`, async (t) => {
        const fresh = await setup(t);
        await fresh.query("update public.memberships set sol_role=$1 where user_id=$2", [
          role,
          users[0],
        ]);
        await actAs(fresh, users[0]);
        assert.deepEqual(
          (
            await fresh.query(
              "select sol_role from public.memberships where org_id=$1 and user_id=$2",
              [solideo, users[0]],
            )
          ).rows,
          [{ sol_role: role }],
        );
        await assertCatalogReadOnlyAndIsolated(fresh);
        for (const set of ["sol_role='ADMIN'", "org_role='owner'"])
          assert.deepEqual(
            (
              await fresh.query(
                `update public.memberships set ${set} where org_id=$1 and user_id=$2 returning user_id`,
                [solideo, users[0]],
              )
            ).rows,
            [],
            set,
          );
        assert.deepEqual(await membershipsOf(fresh), [
          { org_id: other, user_id: users[1], org_role: "member", sol_role: "VIEWER" },
          { org_id: solideo, user_id: users[0], org_role: "member", sol_role: role },
        ]);
      });
    }
    // ADMIN 은 자기 조직의 역할(org_role·sol_role)을 바꾸는 사람이다(docs/04-DATABASE.md §3.1 memberships 행, 09 RBAC).
    // 그 허용은 아래 org_role 시험과 "업무 역할 변경은 그 조직의 ADMIN 만 한다" 시험이 본다. 여기서는 ADMIN 에게도 닫힌 것 —
    // 카탈로그 쓰기, 다른 조직 멤버십, sol_role 을 직접 적은 멤버십 넣기(초대 수락 트리거만 채운다) — 을 본다.
    it("ADMIN can read its catalog but cannot write people, reach another organization, or insert a sol_role directly", async (t) => {
      const fresh = await setup(t);
      await fresh.query("update public.memberships set sol_role='ADMIN' where user_id=$1", [
        users[0],
      ]);
      await actAs(fresh, users[0]);
      assert.deepEqual(
        (
          await fresh.query(
            "select sol_role from public.memberships where org_id=$1 and user_id=$2",
            [solideo, users[0]],
          )
        ).rows,
        [{ sol_role: "ADMIN" }],
      );
      await assertCatalogReadOnlyAndIsolated(fresh);
      await assert.rejects(
        fresh.query(
          "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'member','VIEWER')",
          [solideo, users[2]],
        ),
        /permission denied/,
      );
      assert.deepEqual(await membershipsOf(fresh), [
        { org_id: other, user_id: users[1], org_role: "member", sol_role: "VIEWER" },
        { org_id: solideo, user_id: users[0], org_role: "member", sol_role: "ADMIN" },
      ]);
    });
    // 20261019000001(ADR-021): 역할 변경의 기준은 org_role 이 아니라 sol_role='ADMIN' 이다. owner 라도 ADMIN 이 아니면
    // 아무 역할도 바꾸지 못하고(0행), owner 가 아닌 ADMIN 이 같은 조직 구성원의 org_role 을 바꾼다. 두 역할은 서로를
    // 끌고 가지 않는다 — owner 가 된 사람의 sol_role 은 VIEWER 그대로이고, ADMIN 은 그 조직에서만 ADMIN 이다.
    it("an owner without ADMIN cannot change roles, while a member with ADMIN changes org_role and sol_role stays", async (t) => {
      const fresh = await setup(t);
      await fresh.query("update public.memberships set org_role='owner' where org_id=$1", [
        solideo,
      ]);
      await fresh.query(
        "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'member','ADMIN'),($1,$3,'member','VIEWER')",
        [solideo, users[1], users[2]],
      );
      await actAs(fresh, users[0]);
      for (const [set, userId] of [
        ["org_role='owner'", users[2]],
        ["sol_role='ANALYST'", users[2]],
        ["org_role='member'", users[1]],
        ["sol_role='VIEWER'", users[1]],
        ["sol_role='ADMIN'", users[0]],
      ])
        assert.deepEqual(
          (
            await fresh.query(
              `update public.memberships set ${set} where org_id=$1 and user_id=$2 returning user_id`,
              [solideo, userId],
            )
          ).rows,
          [],
          `${set} ${userId}`,
        );
      await assert.rejects(
        fresh.query(
          "insert into public.memberships(org_id,user_id,org_role,sol_role) values ($1,$2,'member','ADMIN')",
          [solideo, users[2]],
        ),
        /permission denied/,
      );
      await actAs(fresh, users[1]);
      assert.deepEqual(
        (
          await fresh.query(
            "update public.memberships set org_role='owner' where org_id=$1 and user_id=$2 returning org_role,sol_role",
            [solideo, users[2]],
          )
        ).rows,
        [{ org_role: "owner", sol_role: "VIEWER" }],
      );
      // user1 은 other 에서는 VIEWER 다 — solideo 의 ADMIN 이 other 의 자기 역할을 올리지 못한다.
      assert.deepEqual(
        (
          await fresh.query(
            "update public.memberships set sol_role='ADMIN' where org_id=$1 and user_id=$2 returning user_id",
            [other, users[1]],
          )
        ).rows,
        [],
      );
      assert.deepEqual(await membershipsOf(fresh), [
        { org_id: other, user_id: users[1], org_role: "member", sol_role: "VIEWER" },
        { org_id: solideo, user_id: users[0], org_role: "owner", sol_role: "VIEWER" },
        { org_id: solideo, user_id: users[1], org_role: "member", sol_role: "ADMIN" },
        { org_id: solideo, user_id: users[2], org_role: "owner", sol_role: "VIEWER" },
      ]);
    });
    it("other-organization users and platform admins cannot read the roster; anonymous is denied", async (t) => {
      const fresh = await setup(t);
      await fresh.query("update public.profiles set is_admin=true where id=$1", [users[2]]);
      for (const userId of [users[1], users[2]]) {
        await actAs(fresh, userId);
        for (const table of ["departments", "job_titles", "team_members", "memberships"]) {
          assert.deepEqual(
            (await fresh.query(`select * from public.${table} where org_id=$1`, [solideo])).rows,
            [],
          );
        }
      }
      await actAs(fresh, null, "anon");
      for (const table of ["departments", "job_titles", "team_members", "memberships"]) {
        await assert.rejects(fresh.query(`select * from public.${table}`), /permission denied/);
      }
    });
  });
  const resolve = (fresh, dept = "SOL-D001", job = "SOL-J007") =>
    fresh.query("select * from public.resolve_solideo_employment($1,$2)", [dept, job]);
  it("회원만 자기 조직 카탈로그·명부를 읽고 일반 사용자 쓰기는 전부 거부한다", async (t) => {
    const fresh = await setup(t);
    await actAs(fresh, users[0]);
    for (const table of ["departments", "job_titles", "team_members"]) {
      assert.equal((await fresh.query(`select * from public.${table}`)).rows.length, 1);
      assert.equal(
        (await fresh.query(`select * from public.${table} where org_id=$1`, [other])).rows.length,
        0,
      );
      for (const sql of [
        `insert into public.${table} (org_id) values ($1)`,
        `update public.${table} set org_id=$1`,
        `delete from public.${table} where org_id=$1`,
      ])
        await assert.rejects(fresh.query(sql, [solideo]), /permission denied/);
    }
    await actAs(fresh, users[1]);
    assert.equal((await fresh.query("select * from public.team_members")).rows.length, 0);
    await actAs(fresh, null, "anon");
    await assert.rejects(resolve(fresh), /permission denied/);
  });
  it("비멤버는 공개 필드만 변환하고 본인 이름·신고 FK를 한 번에 갱신한다", async (t) => {
    const fresh = await setup(t);
    assert.deepEqual(
      (await fresh.query("select * from public.memberships where user_id=$1", [users[2]])).rows,
      [],
    );
    await actAs(fresh, users[2]);
    const expected = [
      {
        department_id: department,
        department_code: "SOL-D001",
        department_name: "시험부서",
        job_title_id: title,
        job_title_code: "SOL-J007",
        job_title_label: "팀장",
      },
    ];
    assert.deepEqual((await resolve(fresh)).rows, expected);
    assert.deepEqual((await resolve(fresh, department, title)).rows, expected);
    for (const table of ["departments", "job_titles", "team_members"])
      assert.deepEqual((await fresh.query(`select * from public.${table}`)).rows, []);
    assert.deepEqual(
      (await fresh.query("select id from public.organizations where id=$1", [solideo])).rows,
      [],
    );
    const update = (id) =>
      fresh.query(
        "update public.profiles set display_name='일반가입자',declared_department_id=$2,declared_job_title_id=$3 where id=$1 returning id",
        [id, department, title],
      );
    assert.deepEqual((await update(users[2])).rows, [{ id: users[2] }]);
    assert.deepEqual((await update(users[0])).rows, []);
    await fresh.exec("reset role");
    assert.equal(
      (
        await fresh.query("select * from public.memberships where org_id=$1 and user_id=$2", [
          solideo,
          users[2],
        ])
      ).rows.length,
      0,
    );
    await fresh.query("select set_config('request.jwt.claims', '', false)");
    await fresh.query("update public.profiles set status='suspended' where id=$1", [users[2]]);
    await actAs(fresh, users[2]);
    assert.deepEqual((await update(users[2])).rows, []);
    await assert.rejects(resolve(fresh), /authentication_required/);
  });
  it("다른 회사·미지 코드 및 UUID는 resolver와 본인 UPDATE 모두 거절한다", async (t) => {
    const fresh = await setup(t);
    await actAs(fresh, users[2]);
    for (const [dept, job] of [
      ["unknown", "SOL-J007"],
      ["SOL-D001", ""],
      [null, "SOL-J007"],
      [otherDepartment, title],
      [department, otherTitle],
      ["OTHER-D001", "OTHER-J001"],
    ])
      await assert.rejects(resolve(fresh, dept, job), /invalid_employment/);
    for (const [dept, job] of [
      [otherDepartment, title],
      [department, otherTitle],
      [users[0], title],
    ])
      await assert.rejects(
        fresh.query(
          "update public.profiles set declared_department_id=$2,declared_job_title_id=$3 where id=$1",
          [users[2], dept, job],
        ),
        /invalid_employment/,
      );
  });
  for (const kind of ["DIVISION", "GROUP"]) {
    for (const entrance of ["signup", "RPC", "UPDATE"]) {
      it(`${kind}은 ${entrance}에서 거절한다`, async (t) => {
        const fresh = await setup(t);
        const division = "20000000-0000-0000-0000-000000000001";
        const group = "20000000-0000-0000-0000-000000000002";
        await fresh.query(
          "insert into public.departments(id,org_id,code,name,kind,parent_id) values ($1,$3,'UPPER-D','본부','DIVISION',null),($2,$3,'UPPER-G','그룹','GROUP',$1)",
          [division, group, solideo],
        );
        const id = kind === "DIVISION" ? division : group;
        const code = kind === "DIVISION" ? "UPPER-D" : "UPPER-G";
        if (entrance === "signup") {
          await assert.rejects(
            fresh.query(
              "insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),$1)",
              [{ name: "가입자", department_code: code, job_title_code: "SOL-J007" }],
            ),
            /invalid_employment/,
          );
          assert.equal(
            (await fresh.query("select count(*)::int as count from auth.users")).rows[0].count,
            3,
          );
        } else {
          await actAs(fresh, users[2]);
          if (entrance === "RPC") {
            for (const value of [code, id])
              await assert.rejects(resolve(fresh, value), /invalid_employment/);
          } else {
            await assert.rejects(
              fresh.query(
                "update public.profiles set declared_department_id=$2,declared_job_title_id=$3 where id=$1",
                [users[2], id, title],
              ),
              /invalid_employment/,
            );
          }
        }
      });
    }
  }
  for (const kind of ["TEAM", null]) {
    it(`${kind ?? "legacy null"}은 조직 없는 계정의 가입·RPC·직접 UPDATE를 허용한다`, async (t) => {
      const fresh = await setup(t);
      await fresh.query("update public.departments set kind=$1 where id=$2", [kind, department]);
      const {
        rows: [{ id }],
      } = await fresh.query(
        "insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),$1) returning id",
        [{ name: "가입자", department_code: "SOL-D001", job_title_code: "SOL-J007" }],
      );
      assert.deepEqual(
        (await fresh.query("select * from public.memberships where user_id=$1", [id])).rows,
        [],
      );
      assert.deepEqual(
        (await fresh.query("select id from public.organizations where personal_owner_id=$1", [id]))
          .rows,
        [],
      );
      await actAs(fresh, users[2]);
      assert.equal((await resolve(fresh)).rows[0].department_id, department);
      assert.equal((await resolve(fresh, department, title)).rows[0].department_id, department);
      assert.deepEqual(
        (
          await fresh.query(
            "update public.profiles set declared_department_id=$2,declared_job_title_id=$3 where id=$1 returning id",
            [users[2], department, title],
          )
        ).rows,
        [{ id: users[2] }],
      );
    });
  }
  it("명부의 복합 FK·이름·성별·카탈로그 최소 인원 제약을 강제한다", async (t) => {
    const fresh = await setup(t);
    await assert.rejects(
      fresh.query("update public.team_members set department_id=$1", [otherDepartment]),
      /foreign key/,
    );
    await assert.rejects(
      fresh.query("update public.team_members set job_title_id=$1", [otherTitle]),
      /foreign key/,
    );
    for (const sql of [
      "update public.team_members set gender='UNKNOWN'",
      "update public.team_members set name='두글'",
      "update public.departments set target_count=0",
    ])
      await assert.rejects(fresh.query(sql), /check constraint/);
  });
  it("유효 메타데이터만 신고 FK로 옮기며 관리자·멤버십을 부여하지 않는다", async (t) => {
    const fresh = await setup(t);
    const organizationsBefore = (
      await fresh.query("select id from public.organizations order by id")
    ).rows;
    const {
      rows: [{ id }],
    } = await fresh.query(
      "insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'signup@example.test',$1) returning id",
      [
        {
          name: "새가입자",
          department_code: "SOL-D001",
          job_title_code: "SOL-J007",
          is_admin: true,
          org_role: "owner",
          sol_role: "ADMIN",
          org_id: solideo,
          organization_id: solideo,
          slug: "org-01",
        },
      ],
    );
    assert.deepEqual(
      (
        await fresh.query(
          "select display_name,declared_department_id,declared_job_title_id,is_admin from public.profiles where id=$1",
          [id],
        )
      ).rows,
      [
        {
          display_name: "새가입자",
          declared_department_id: department,
          declared_job_title_id: title,
          is_admin: false,
        },
      ],
    );
    assert.deepEqual(
      (
        await fresh.query(
          "select o.personal_owner_id,m.org_role from public.memberships m join public.organizations o on o.id=m.org_id where m.user_id=$1",
          [id],
        )
      ).rows,
      [],
    );
    assert.deepEqual(
      (await fresh.query("select id from public.organizations order by id")).rows,
      organizationsBefore,
    );
    for (const meta of [
      { department_code: "SOL-D001" },
      { job_title_code: "SOL-J007" },
      { department_code: "", job_title_code: "SOL-J007" },
      { department_code: null, job_title_code: null },
      { department_code: "unknown", job_title_code: "SOL-J007" },
      { department_code: "OTHER-D001", job_title_code: "OTHER-J001" },
    ])
      await assert.rejects(
        fresh.query(
          "insert into auth.users (id,raw_user_meta_data) values (gen_random_uuid(),$1)",
          [meta],
        ),
        /invalid_employment/,
      );
  });
  it("신고 키가 모두 없는 OAuth는 nullable이며 HTTPS 사진·이름만 보존한다", async (t) => {
    const fresh = await setup(t);
    const {
      rows: [{ id }],
    } = await fresh.query(
      "insert into auth.users (id,raw_user_meta_data) values (gen_random_uuid(),$1) returning id",
      [
        {
          full_name: "OAuth 가입자",
          avatar_url: "https://example.test/avatar.png",
          is_admin: true,
          org_role: "owner",
          sol_role: "ADMIN",
          org_id: solideo,
        },
      ],
    );
    assert.deepEqual(
      (
        await fresh.query(
          "select display_name,avatar_url,declared_department_id,declared_job_title_id from public.profiles where id=$1",
          [id],
        )
      ).rows,
      [
        {
          display_name: "OAuth 가입자",
          avatar_url: "https://example.test/avatar.png",
          declared_department_id: null,
          declared_job_title_id: null,
        },
      ],
    );
    assert.equal(
      (await fresh.query("select * from public.organizations where personal_owner_id=$1", [id]))
        .rows.length,
      0,
    );
    assert.deepEqual(
      (await fresh.query("select * from public.memberships where user_id=$1", [id])).rows,
      [],
    );
  });
  it("ADR021 점수는 같은 조직만 읽고 owner·운영자·일반회원·익명은 쓰지 못한다", async (t) => {
    const fresh = await setup(t);
    await fresh.exec(
      "insert into public.team_member_scoring(member_id,org_id,role) select id,org_id,'DEV' from public.team_members",
    );
    await fresh.query("update public.profiles set is_admin=true where id=$1", [users[2]]);
    await fresh.query(
      "update public.memberships set org_role='owner' where org_id=$1 and user_id=$2",
      [solideo, users[0]],
    );
    for (const [user, role, count] of [
      [users[0], "authenticated", 1],
      [users[1], "authenticated", 0],
      [users[2], "authenticated", 0],
      [null, "anon", null],
    ]) {
      await actAs(fresh, user, role);
      if (count === null)
        await assert.rejects(
          fresh.query("select * from public.team_member_scoring"),
          /permission denied/,
        );
      else
        assert.equal(
          (await fresh.query("select * from public.team_member_scoring")).rows.length,
          count,
        );
      for (const sql of [
        "insert into public.team_member_scoring(member_id,org_id,role) values (gen_random_uuid(),$1,'DEV')",
        "update public.team_member_scoring set org_id=$1",
        "delete from public.team_member_scoring where org_id=$1",
      ])
        await assert.rejects(fresh.query(sql, [solideo]), /permission denied/);
    }
    await fresh.exec("reset role");
    // An ordinary member has the same read-only scoring access.
    await fresh.query(
      "insert into public.memberships(org_id,user_id,org_role) values ($1,$2,'member')",
      [solideo, users[1]],
    );
    await actAs(fresh, users[1]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 1);
    await assert.rejects(
      fresh.query("delete from public.team_member_scoring"),
      /permission denied/,
    );
  });

  it("ADR021 점수 복합 FK는 조직 혼입을 막고 직원·조직 삭제는 점수도 삭제한다", async (t) => {
    const fresh = await setup(t);
    const member = (await fresh.query("select id from public.team_members")).rows[0].id;
    await assert.rejects(
      fresh.query(
        "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
        [member, other],
      ),
      /foreign key/,
    );
    await fresh.query(
      "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
      [member, solideo],
    );
    await assert.rejects(
      fresh.query("update public.team_member_scoring set org_id=$1", [other]),
      /foreign key/,
    );
    await fresh.query("delete from public.team_members where id=$1", [member]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 0);
    await fresh.query(
      "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path) values ($1,$2,'SOL-P0001','김민준','MALE',$3,$4,'/demo/people/SOL-P0001.png')",
      [member, solideo, department, title],
    );
    await fresh.query(
      "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
      [member, solideo],
    );
    await fresh.query("delete from public.organizations where id=$1", [solideo]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 0);
    assert.equal((await fresh.query("select * from public.team_members")).rows.length, 0);
  });

  it("ADR021 legacy null kind도 팀의 null 인원을 허용하지 않는다", async (t) => {
    const fresh = await setup(t);
    await fresh.query("update public.departments set kind=null");
    await assert.rejects(
      fresh.query("update public.departments set source_count=null,target_count=null"),
      /check constraint/,
    );
    for (const column of ["source_count", "target_count"])
      await assert.rejects(
        fresh.query(`update public.departments set ${column}=null`),
        /check constraint/,
      );
  });

  it("ADR021 계층은 부모 조직·종류·인원 제약과 양방향 TEAM 소속을 강제한다", async (t) => {
    const fresh = await setup(t);
    const division = "20000000-0000-0000-0000-000000000001";
    const group = "20000000-0000-0000-0000-000000000002";
    await fresh.query(
      "insert into public.departments(id,org_id,code,name,kind) values ($1,$3,'DIV','본부','DIVISION'),($2,$3,'GROUP','그룹','GROUP')",
      [division, group, solideo],
    );
    await fresh.query("update public.departments set parent_id=$1 where id=$2", [division, group]);
    await fresh.query("update public.departments set parent_id=$1 where id=$2", [
      group,
      department,
    ]);
    for (const parent of [division, group]) {
      await assert.rejects(
        fresh.query("update public.team_members set department_id=$1", [parent]),
        /employee_requires_team/,
      );
      await assert.rejects(
        fresh.query(
          "insert into public.team_members(org_id,person_code,name,gender,department_id,job_title_id,portrait_path) values ($1,'SOL-P9999','이가상','FEMALE',$2,$3,'/demo/people/SOL-P9999.png')",
          [solideo, parent, title],
        ),
        /employee_requires_team/,
      );
    }
    await assert.rejects(
      fresh.query("update public.departments set parent_id=$1 where id=$2", [
        otherDepartment,
        department,
      ]),
      /foreign key/,
    );
    for (const [parent, child] of [
      [department, group],
      [group, division],
      [division, division],
      [department, department],
    ])
      await assert.rejects(
        fresh.query("update public.departments set parent_id=$1 where id=$2", [parent, child]),
        /department_hierarchy/,
      );
    await assert.rejects(
      fresh.query("update public.departments set kind='GROUP' where id=$1", [division]),
      /department_hierarchy/,
    );
    await assert.rejects(
      fresh.query(
        "update public.departments set kind='GROUP',target_count=null,source_count=null,parent_id=$2 where id=$1",
        [department, division],
      ),
      /employee_requires_team/,
    );
    await assert.rejects(
      fresh.query(
        "update public.departments set kind='TEAM',target_count=1,source_count=1 where id=$1",
        [group],
      ),
      /department_hierarchy/,
    );
    for (const sql of [
      "update public.departments set target_count=null where code='SOL-D001'",
      "update public.departments set source_count=null where code='SOL-D001'",
      "update public.departments set source_count=-1 where code='SOL-D001'",
      "update public.departments set target_count=1 where kind='DIVISION'",
      "update public.departments set source_count=1 where kind='GROUP'",
      "update public.departments set kind='UNKNOWN' where code='SOL-D001'",
    ])
      await assert.rejects(fresh.query(sql), /check constraint/);
    // Null kind is a legacy TEAM, still valid for existing employees.
    await fresh.query("update public.departments set kind=null,parent_id=$1 where id=$2", [
      division,
      department,
    ]);
    await fresh.query("update public.team_members set department_id=$1", [department]);
    await fresh.query("update public.team_members set updated_at='2000-01-01'::timestamptz");
    const row = (
      await fresh.query(
        "select updated_at > '2000-01-01'::timestamptz as touched from public.team_members",
      )
    ).rows[0];
    assert.equal(row.touched, true);
  });

  it("카탈로그 삭제는 일반 Auth 계정을 남기고 신고 FK만 null로 만든다", async (t) => {
    const fresh = await setup(t);
    await fresh.query(
      "update public.profiles set declared_department_id=$2,declared_job_title_id=$3 where id=$1",
      [users[2], department, title],
    );
    await fresh.query("delete from public.team_members where org_id=$1", [solideo]);
    await fresh.query("delete from public.departments where org_id=$1", [solideo]);
    await fresh.query("delete from public.job_titles where org_id=$1", [solideo]);
    assert.deepEqual(
      (
        await fresh.query(
          "select declared_department_id,declared_job_title_id from public.profiles where id=$1",
          [users[2]],
        )
      ).rows,
      [{ declared_department_id: null, declared_job_title_id: null }],
    );
    assert.equal(
      (await fresh.query("select id from auth.users where id=$1", [users[2]])).rows.length,
      1,
    );
  });
});

it("솔리데오 조직 삭제도 신고한 일반 계정·개인 조직을 보존한다", async (t) => {
  const fresh = await migratedDb(t);
  await prepareLegacyPersonalOrgs(fresh, [users[0]]);
  const org = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  await fresh.query(
    "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오')",
    [org],
  );
  const {
    rows: [{ id: department }],
  } = await fresh.query(
    "insert into public.departments (org_id,code,name,source_count,target_count) values ($1,'SOL-D001','부서',1,1) returning id",
    [org],
  );
  const {
    rows: [{ id: title }],
  } = await fresh.query(
    "insert into public.job_titles (org_id,code,label,sort_order) values ($1,'SOL-J007','팀장',1) returning id",
    [org],
  );
  await fresh.query(
    "update public.profiles set declared_department_id=$1,declared_job_title_id=$2 where id=$3",
    [department, title, users[0]],
  );
  await fresh.query("delete from public.organizations where id=$1", [org]);
  assert.deepEqual(
    (
      await fresh.query(
        "select declared_department_id,declared_job_title_id from public.profiles where id=$1",
        [users[0]],
      )
    ).rows,
    [{ declared_department_id: null, declared_job_title_id: null }],
  );
  assert.equal(
    (await fresh.query("select id from auth.users where id=$1", [users[0]])).rows.length,
    1,
  );
  assert.equal(
    (
      await fresh.query("select id from public.organizations where personal_owner_id=$1", [
        users[0],
      ])
    ).rows.length,
    1,
  );
});

it("ADR021 가입 변경은 이전 개인 조직·소유권·작업을 그대로 보존한다", async (t) => {
  const fresh = await freshDb(t);
  const preceding = migrations.filter((migration) => migration.version < "20261016000004");
  await applyMigrations(fresh, preceding);
  await fresh.query("insert into auth.users(id,email) values($1,'legacy@example.invalid')", [
    users[0],
  ]);
  const organizations = (await fresh.query("select * from public.organizations")).rows;
  const memberships = (await fresh.query("select * from public.memberships")).rows;
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].personal_owner_id, users[0]);
  assert.equal(memberships[0].org_role, "owner");
  await fresh.query("insert into public.tasks(org_id,title) values($1,'기존 개인 작업')", [
    organizations[0].id,
  ]);
  const tasks = (await fresh.query("select * from public.tasks")).rows;
  await applyMigrations(
    fresh,
    migrations.filter((migration) => migration.version >= "20261016000004"),
  );
  await fresh.query("insert into auth.users(id,email) values($1,'new@example.invalid')", [
    users[1],
  ]);
  assert.deepEqual((await fresh.query("select * from public.organizations")).rows, organizations);
  assert.deepEqual(
    (await fresh.query("select * from public.memberships")).rows,
    memberships.map((membership) => ({ ...membership, sol_role: "VIEWER" })),
  );
  assert.deepEqual((await fresh.query("select * from public.tasks")).rows, tasks);
  assert.deepEqual(
    (await fresh.query("select id from public.profiles order by id")).rows,
    users.slice(0, 2).map((id) => ({ id })),
  );
});
