// DB 정책 시험이 함께 쓰는 준비 코드 — 전체 마이그레이션을 적용한 새 DB, 가입자, 정책 성능 판정, 실행 계획.
// scripts/database.test.mjs 와 scripts/template/docs-sql.test.mjs(템플릿 전용)가 쓴다.
import { fileURLToPath } from "node:url";
import { applyMigrations, createSupabaseDb, loadMigrations } from "./supabase-pglite.mjs";

export const migrations = await loadMigrations(
  fileURLToPath(new URL("../supabase/migrations/", import.meta.url)),
);

// 정책 식에서 질의 하나 동안 값이 같은 호출. (select ...) 로 감싸야 PostgreSQL 이 질의마다 한 번(InitPlan)만
// 부르고, 감싸지 않으면 행마다 다시 부른다(is_admin() 은 부를 때마다 profiles 를 다시 읽는다).
// 판정은 Supabase 린터 0003 을 따르되, 감싼 호출과 감싸지 않은 호출이 한 식에 섞여도 잡는다.
//   https://github.com/supabase/splinter/blob/main/lints/0003_auth_rls_initplan.sql
const PER_STATEMENT_CALLS = [
  String.raw`\bauth\.(?:uid|jwt|role|email)\(\)`,
  String.raw`\b(?:public\.)?is_admin\(\)`,
  String.raw`\bcurrent_setting\(`,
];
const countOf = (text, pattern) => (text.match(new RegExp(pattern, "gi")) ?? []).length;
const hasUnwrappedCall = (expression) =>
  Boolean(expression) &&
  PER_STATEMENT_CALLS.some(
    (call) => countOf(expression, call) > countOf(expression, String.raw`SELECT\s+\(*${call}`),
  );
// public 정책 가운데 위 호출을 감싸지 않은 것("표.정책" 이름순). table 을 주면 그 표만 본다.
export const slowPolicies = async (pglite, table = null) =>
  (
    await pglite.query(
      "select tablename, policyname, qual, with_check from pg_policies where schemaname='public' and ($1::text is null or tablename = $1) order by 1, 2",
      [table],
    )
  ).rows
    .filter((row) => hasUnwrappedCall(row.qual) || hasUnwrappedCall(row.with_check))
    .map((row) => `${row.tablename}.${row.policyname}`);

// 질의 하나의 실행 계획(costs off). 부른 쪽의 역할·JWT claim 으로 짠다.
export const planOf = async (pglite, sql) =>
  (await pglite.query(`explain (costs off) ${sql}`)).rows
    .map((row) => row["QUERY PLAN"])
    .join("\n");

// 시험 하나만 쓰는 DB. 다른 시험의 DB 상태에 기대지도, 그것을 바꾸지도 않는다.
export const freshDb = async (t) => {
  const pglite = await createSupabaseDb();
  t.after(() => pglite.close());
  return pglite;
};

export const users = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
];

// db:verify 가 이력 오류에서 멈추지 않도록 폴더의 마이그레이션을 모두 적용한 것으로 적는다.
export const recordHistory = async (pglite) => {
  await pglite.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)",
  );
  for (const migration of migrations)
    await pglite.query("insert into supabase_migrations.schema_migrations values ($1)", [
      migration.version,
    ]);
};

// 전체 마이그레이션·가입자 셋·적용 이력을 갖춘 새 DB. 누출을 실제로 읽어 보고 verifyDatabase 도 끝까지 돈다.
export const migratedDb = async (t) => {
  const fresh = await freshDb(t);
  await applyMigrations(fresh, migrations);
  for (const [i, id] of users.entries())
    await fresh.query("insert into auth.users values ($1, $2)", [id, `user${i}@example.invalid`]);
  await recordHistory(fresh);
  return fresh;
};

// 이전 가입 흐름의 개인 공간이 필요한 보존·격리 시험에서만 명시적으로 호출한다.
// migratedDb 의 신규 가입자는 조직·멤버십 없이 남긴다.
export const prepareLegacyPersonalOrgs = async (pglite, ownerIds) => {
  for (const ownerId of ownerIds)
    await pglite.query("select public.create_personal_org($1)", [ownerId]);
};
