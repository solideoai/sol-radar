// supabase-pglite.mjs — 실제 DB 없이 마이그레이션을 돌려 보는 Supabase 흉내 DB.
//
// PGlite(WASM 으로 옮긴 PostgreSQL)에 마이그레이션이 기대는 Supabase 의 바탕만 깔고, 마이그레이션을
// db-push.mjs 와 같은 방식으로 적용한다. DB 정책 시험(database.test.mjs)과 DB 타입 생성기
// (db-types-gen.mjs)가 함께 쓴다. 흉내가 두 벌이면 "시험이 본 DB"와 "타입을 뽑은 DB"가 조용히
// 갈라지므로 여기 한 곳에만 둔다.
//
// 흉내 내는 것은 화면 역할(anon·authenticated), auth 스키마(users·sessions 표·jwt()·uid()), public 의 새 표·함수·
// 시퀀스에 붙는 기본 권한뿐이다. Supabase Auth 서비스 자체는 재현하지 않는다.
// auth 표에는 마이그레이션이 읽고 쓰는 열만 둔다(가입 정보의 메타데이터, 정지 기한, 세션의 주인).
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { collectMigrations } from "./migrations.mjs";

export const mimicSupabase = async (pglite) => {
  await pglite.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id), name text not null,
      unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant all on storage.objects, storage.buckets to service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb,
      banned_until timestamptz
    );
    create table auth.sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid;
    $$;
    -- Supabase 는 확장을 public 이 아니라 extensions 스키마에 깔고 화면 역할에 usage 를 준다(database 스킬).
    create schema extensions;
    grant usage on schema public, auth, extensions to anon, authenticated;
    grant usage on schema public, auth, extensions to service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role;
    -- Supabase 처럼 public 의 새 표·함수·시퀀스에 화면 역할의 권한이 전부(all) 기본으로 붙게 한다.
    -- 마이그레이션이 거둔 권한만 빠진다. 출처(초기화 SQL·그 SQL 을 postgres 역할로 돌리는 스크립트·문서):
    --   https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql
    --   https://github.com/supabase/postgres/blob/develop/migrations/db/migrate.sh
    --   https://supabase.com/docs/guides/database/hardening-data-api
    -- 마이그레이션(db:push·db:start)은 postgres 역할로 돌므로 postgres 가 만드는 객체의 기본 권한을 흉내 낸다.
    -- Supabase 는 내부 역할 supabase_admin 몫도 따로 주지만 마이그레이션과 상관없어 흉내 내지 않는다.
    -- - 표: 읽기·쓰기 네 가지만 주면 RLS 를 무시하는 truncate 등이 남는 것을 시험이 못 본다(실제로는 남는다).
    -- - 함수: PostgreSQL 기본(PUBLIC 실행)에 더해 화면 역할에 실행 권한을 명시적으로 준다. 그래서 운영에서는
    --   revoke execute ... from public 만으로는 /rpc 가 막히지 않는다. 흉내가 이것을 빼면 시험만 통과한다.
    -- - 시퀀스: 없으면 bigserial 표의 insert 가 시험에서만 permission denied 로 실패한다.
    alter default privileges for role postgres in schema public
      grant all on tables to anon, authenticated;
    alter default privileges for role postgres in schema public
      grant all on functions to anon, authenticated;
    alter default privileges for role postgres in schema public
      grant all on sequences to anon, authenticated;
  `);
  return pglite;
};

// 흉내를 깐 빈 DB. 닫는 것은 부른 쪽 몫이다.
// pg_trgm 은 공고 제목·기관의 trigram 인덱스(20261019000002)가 쓴다. Supabase 가 제공하는 확장이라 여기서도 싣는다 —
// 마이그레이션은 확장이 있을 때만 깔고 인덱스를 만들므로, 싣지 않은 PGlite 에서도 깨지지는 않지만 그 경로는 검증되지 않는다.
export const createSupabaseDb = () => mimicSupabase(new PGlite({ extensions: { pg_trgm } }));

// 웹에서 들어온 요청처럼 JWT claim 을 싣고 화면 역할로 바꾼다.
// email 은 Supabase 토큰의 email 클레임이다. 초대 정책처럼 로그인 이메일을 읽는 정책을 시험할 때 넘긴다.
export const actAs = async (pglite, id, role = "authenticated", email = undefined) => {
  await pglite.exec("reset role");
  await pglite.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id, role, email }),
  ]);
  await pglite.exec(role === "anon" ? "set role anon" : "set role authenticated");
};

// 폴더의 마이그레이션을 버전 순으로 읽는다. 이름 규칙이 어긋나면 db-push 처럼 아무것도 적용하지 않고 멈춘다.
export const loadMigrations = async (dir) => {
  const { migrations, problems } = collectMigrations(await readdir(dir));
  if (problems.length > 0)
    throw new Error(`마이그레이션 폴더에 문제가 있습니다:\n${problems.join("\n")}`);
  return Promise.all(
    migrations.map(async (migration) => ({
      ...migration,
      sql: await readFile(join(dir, migration.file), "utf8"),
    })),
  );
};

// db-push.mjs 처럼 파일 하나를 트랜잭션 하나로 적용한다. 트랜잭션 안에서 못 도는 문장이 섞이면 여기서 깨진다.
export const applyMigration = async (pglite, migration, options) => {
  await pglite.exec("begin");
  try {
    await pglite.exec(migration.sql, options);
    await pglite.exec("commit");
  } catch (error) {
    await pglite.exec("rollback");
    throw new Error(`${migration.file}: ${error.message}`, { cause: error });
  }
};

// 순서가 곧 이력이라 하나씩 차례로 적용한다(병렬로 돌리면 뒤 파일이 앞 파일의 표를 못 본다).
export const applyMigrations = (pglite, migrations) =>
  migrations.reduce(
    (done, migration) => done.then(() => applyMigration(pglite, migration)),
    Promise.resolve(),
  );
