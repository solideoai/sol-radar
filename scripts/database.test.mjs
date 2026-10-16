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
  it("화면 역할의 profiles 표 권한은 읽기(SELECT)뿐이고, 열 권한은 display_name 수정 하나다 — RLS 를 무시하는 TRUNCATE 도 없다", async () => {
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
      [{ grantee: "authenticated", column_name: "display_name", privilege_type: "UPDATE" }],
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
  const teamDb = async (t) => {
    const pglite = await migratedDb(t);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [users[2]]);
    await as(pglite, 0);
    await pglite.query("insert into public.organizations (slug, name) values ('acme', '에이크미')");
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

  it("가입하면 개인 조직(무작위 8자 주소)과 owner 멤버십이 하나씩 생긴다", async (t) => {
    const pglite = await migratedDb(t);
    const orgs = await rowsOf(
      pglite,
      "select o.slug, o.name, o.personal_owner_id, m.user_id, m.org_role from public.organizations o join public.memberships m on m.org_id = o.id order by o.personal_owner_id",
    );
    assert.equal(orgs.length, users.length);
    for (const [i, org] of orgs.entries()) {
      assert.match(org.slug, /^[0-9a-f]{8}$/);
      assert.deepEqual(
        { ...org, slug: undefined },
        {
          slug: undefined,
          name: "개인 공간",
          personal_owner_id: users[i],
          user_id: users[i],
          org_role: "owner",
        },
      );
    }
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

  it("개인 조직의 주인은 자기 역할을 member 로 내리지 못한다", async (t) => {
    const { pglite, personal } = await teamDb(t);
    await as(pglite, 0);
    await assert.rejects(
      pglite.query(
        "update public.memberships set org_role = 'member' where org_id = $1 and user_id = $2",
        [personal[users[0]], users[0]],
      ),
      /owner 가 한 명 이상/,
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
    await pglite.query(
      "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
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
        { table_name: "memberships", column_name: "org_id", privilege_type: "INSERT" },
        { table_name: "memberships", column_name: "org_role", privilege_type: "INSERT" },
        { table_name: "memberships", column_name: "org_role", privilege_type: "UPDATE" },
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
      await as(pglite, 1);
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
          activity("member_role_changed", users[1], {
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

    it("메타데이터가 없어도(null) 가입은 실패하지 않는다 — 표시 이름·이미지가 빈 활성 프로필과 개인 조직이 생긴다", async (t) => {
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
        [{ org_role: "owner" }],
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
      await as(pglite, 0);
      await pglite.query(
        "insert into public.organizations (slug, name) values ('acme', '에이크미')",
      );
      await asAdminTool(pglite);
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
      await pglite.query(
        "update public.memberships set org_role = 'owner' where org_id = $1 and user_id = $2",
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
      await as(pglite, 1);
      await pglite.query("insert into public.organizations (slug, name) values ('solo', '혼자')");
      await asAdminTool(pglite);
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
