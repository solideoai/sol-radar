// DB 접속에 더해 코드가 요구하는 마이그레이션·RLS·화면 역할 권한·뷰·함수 상태를 읽기 전용으로 검사한다.
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMigrations, pendingMigrations } from "./migrations.mjs";

// 화면(웹·앱)이 anon 키로 들어올 때 쓰는 역할.
export const SCREEN_ROLES = ["anon", "authenticated"];

// 이 파일이 직접 판정한 검증 실패. 메시지에는 마이그레이션 파일·스키마/표·역할·권한 이름만 담아
// CLI 가 그대로 보여 줘도 된다. 이 밖의 오류(접속·쿼리·드라이버)는 원문을 믿지 않는다.
export class DbVerifyError extends Error {
  name = "DbVerifyError";
}

// 외부 오류에서 보여 줄 수 있는 것은 아래 목록에 있는 오류 코드뿐이다. 모양만 맞는 임의 문자열은 버린다.
const KNOWN_ERROR_CODES = new Set([
  // 네트워크(Node)
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  // TLS 인증서
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  // PostgreSQL SQLSTATE
  "08001",
  "08006",
  "25006",
  "28000",
  "28P01",
  "3D000",
  "42501",
  "42P01",
  "53300",
  "57014",
]);

// CLI 에 찍을 실패 안내. 외부 오류의 message·detail·hint·cause·stack 에는 접속 주소·토큰·행 데이터가
// 섞일 수 있어 어느 것도 옮기지 않고, 고정 안내와 목록에 있는 코드만 보여 준다.
export function describeFailure(error) {
  if (error instanceof DbVerifyError) return `DB 검증 실패: ${error.message}`;
  const code =
    typeof error?.code === "string" && KNOWN_ERROR_CODES.has(error.code) ? error.code : undefined;
  return [
    `DB 검증 실패: DB 접속 또는 조회 중 오류가 났습니다${code ? ` (코드 ${code})` : ""}.`,
    "접속 주소·비밀값이 섞일 수 있어 오류 원문은 출력하지 않습니다.",
    "SUPABASE_DB_URL(주소·비밀번호·TLS)·네트워크·DB 권한을 확인한 뒤 다시 실행하세요.",
  ].join("\n");
}

// 읽기·쓰기(select·insert·update·delete)는 RLS 정책이 행을 거른다. 아래 권한은 정책을 거치지 않거나
// (truncate·maintain) 표 구조에 기대는 길(trigger·references)을 화면 역할에 연다.
// maintain 은 PostgreSQL 17 부터 있다. 그 이전 서버에 이름을 보내면 쿼리 자체가 실패한다.
const MAINTAIN_SINCE = 170000;
const tablePrivilegesFor = (version) =>
  version >= MAINTAIN_SINCE ? ["TRUNCATE", "TRIGGER", "MAINTAIN"] : ["TRUNCATE", "TRIGGER"];

// 아래 목록은 이 파일의 상수만 넣는다(바깥 입력을 SQL 에 이어 붙이지 않는다).
const sqlList = (values) => values.map((value) => `'${value}'`).join(", ");

// has_*_privilege 는 직접 받은 권한·PUBLIC·역할 상속을 모두 따진다. references 는 열 단위로도 줄 수 있어
// has_any_column_privilege 로 본다(표 단위 권한도 함께 잡는다). 일반 표·파티션 부모(p)·리프(r) 모두 본다.
const privilegesQuery = (tablePrivileges) => `
  with tables as materialized (
    select c.oid, n.nspname as table_schema, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ), roles as materialized (
    select r.oid, r.rolname as role
    from pg_catalog.pg_roles r
    where r.rolname in (${sqlList(SCREEN_ROLES)})
  )
  select t.table_schema, t.table_name, r.role, p.privilege
  from tables t
  cross join roles r
  cross join unnest(array[${sqlList([...tablePrivileges, "REFERENCES"])}]::text[]) as p(privilege)
  where case
    when p.privilege = 'REFERENCES' then pg_catalog.has_any_column_privilege(r.oid, t.oid, p.privilege)
    else pg_catalog.has_table_privilege(r.oid, t.oid, p.privilege)
  end`;

// DB 정렬 규칙(collation)에 기대지 않고 key 가 돌려준 값 순서대로 정렬한다.
const compareBy = (key) => (a, b) => {
  const [left, right] = [key(a), key(b)];
  const i = left.findIndex((value, j) => value !== right[j]);
  return i < 0 ? 0 : left[i] < right[i] ? -1 : 1;
};
const compareFinding = compareBy((finding) => [
  finding.schema,
  finding.table,
  finding.role,
  finding.privilege,
]);

// 화면 역할이 없으면 has_*_privilege 로 물을 역할이 없어 결과가 비고, 빈 결과는 통과로 읽힌다. 그래서 먼저 실패시킨다.
const assertScreenRoles = async (client) => {
  const { rows } = await client.query(
    `select rolname from pg_catalog.pg_roles where rolname in (${sqlList(SCREEN_ROLES)})`,
  );
  const present = new Set(rows.map((row) => row.rolname));
  const missing = SCREEN_ROLES.filter((role) => !present.has(role));
  if (missing.length) throw new DbVerifyError(`화면 역할이 없습니다: ${missing.join(", ")}`);
};

// 서버 버전을 읽고 화면 역할을 확인한다. 공개 검사기는 따로 불려도 화면 역할을 각자 확인하고,
// verifyDatabase 는 이것을 한 번만 거쳐 두 검사에 넘긴다.
const readServer = async (client) => {
  const { rows } = await client.query(
    "select current_setting('server_version_num')::int as version",
  );
  const version = Number(rows[0]?.version);
  if (!Number.isInteger(version) || version <= 0)
    throw new DbVerifyError("PostgreSQL 버전을 확인하지 못했습니다");
  await assertScreenRoles(client);
  return { version };
};

const queryPrivileges = async (client, { version }) => {
  const { rows } = await client.query(privilegesQuery(tablePrivilegesFor(version)));
  return rows
    .map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      role: row.role,
      privilege: row.privilege,
    }))
    .sort(compareFinding);
};

// public 표마다 화면 역할이 실제로 가진 위험 권한을 { schema, table, role, privilege } 로 정렬해 돌려준다.
export async function findDangerousPrivileges(client) {
  return queryPrivileges(client, await readServer(client));
}

const failOnPrivileges = (findings) => {
  if (!findings.length) return;
  const lines = findings.map(
    (finding) => `  ${finding.schema}.${finding.table} ${finding.role} ${finding.privilege}`,
  );
  throw new DbVerifyError(
    [
      `화면 역할(${SCREEN_ROLES.join("·")})에 위험한 표 권한이 남아 있습니다:`,
      ...lines,
      "새 마이그레이션에서 revoke all on <표> from anon, authenticated, public; 뒤 필요한 select·insert·update·delete 만 다시 grant 하세요.",
    ].join("\n"),
  );
};

export async function assertNoDangerousPrivileges(client) {
  failOnPrivileges(await findDangerousPrivileges(client));
}

// RLS 는 표에만 걸린다. 아래 객체는 표 권한 검사에 보이지 않으면서 화면 역할에 행을 내주거나 바꾸게 한다.
// 판정은 Supabase 린터(0010·0016·0017·0028·0029·0011)를 따른다: https://github.com/supabase/splinter/tree/main/lints
// - 뷰: security_invoker 가 켜지지 않으면 뷰 소유자(postgres) 권한으로 밑 표를 읽고 써서 RLS 를 거치지 않는다.
//   읽기만이 아니다. select 를 거둬도 insert·update·delete 가 남으면 정책 없이 남의 행을 바꾸고 지운다.
//   켜졌는지는 PostgreSQL 이 불리언 옵션을 읽는 규칙(::boolean — true·on·yes·1·t, 대소문자 무관)으로 본다.
//   security_barrier 는 이름만 비슷한 다른 옵션이다. PostgreSQL 15 미만에는 이 옵션이 없어 모든 뷰가 잡힌다.
//   린터(0010)는 15 미만을 건너뛰지만 누출은 같으니 여기서는 잡고, 고치는 법만 권한 회수로 바꾼다(viewFix).
// - 머티리얼라이즈드 뷰·외부 표(foreign table): RLS 를 켤 수 없다. 머티리얼라이즈드 뷰는 쓰기가 안 되니 읽기만,
//   외부 표는 읽기·쓰기 모두 본다.
// - SECURITY DEFINER 함수: 소유자 권한으로 돌아 /rpc 로 부르면 RLS 를 거치지 않는다. 트리거 함수(trigger·
//   event_trigger 반환)는 /rpc 로도 SQL 로도 직접 부를 수 없어 실행 권한은 보지 않는다.
//   prokind 는 거르지 않는다(0011·0028·0029 와 같다). 프로시저도 SECURITY DEFINER 일 수 있다.
// - 모든 SECURITY DEFINER 함수는 search_path 를 고정해야 한다(빈 값 '' 도 고정이다). 고정하지 않으면 부른 쪽의
//   search_path 에 놓인 같은 이름 객체가 소유자 권한으로 실행된다.
// - 확장이 깐 객체(pg_depend deptype 'e' — 예: public 에 깐 PostGIS 의 geometry_columns 뷰)는 뺀다. Supabase 에서는
//   supabase_admin 소유라 마이그레이션이 고치지 못하고(must be owner), 잡으면 그 확장을 쓰는 프로젝트의 배포가
//   늘 막힌다. 0010·0011·0016·0017 과 같은 조건이다. 0028·0029(함수 실행)는 확장 함수를 빼지 않지만, 린터는
//   경고에 그치고 이 검사는 배포를 막으므로 같은 이유로 뺀다. alter extension ... add 로 넣은 객체도 빠진다
//   (확장과 객체를 모두 가진 역할만 할 수 있다).
//   https://github.com/supabase/splinter/blob/main/lints/0010_security_definer_view.sql
//   https://github.com/supabase/splinter/blob/main/lints/0028_anon_security_definer_function_executable.sql
// 권한은 직접 부여·PUBLIC·상속을 모두 따지는 has_*_privilege 로 본다. 옵션 값은 case 안에서만 boolean 으로
// 바꾼다(check_option=local 같은 다른 옵션 값을 바꾸다 쿼리가 깨지지 않게).
const bypassesQuery = `
  with roles as materialized (
    select r.oid, r.rolname as role
    from pg_catalog.pg_roles r
    where r.rolname in (${sqlList(SCREEN_ROLES)})
  ), relations as materialized (
    select c.oid, n.nspname as schema_name, c.relname as name, c.relkind,
      exists (
        select 1 from pg_catalog.pg_options_to_table(c.reloptions) o
        where case when o.option_name = 'security_invoker' then o.option_value::boolean else false end
      ) as security_invoker
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm', 'f')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e'
      )
  ), definers as materialized (
    select p.oid, n.nspname as schema_name,
      p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as name,
      p.prorettype in ('pg_catalog.trigger'::pg_catalog.regtype,
                       'pg_catalog.event_trigger'::pg_catalog.regtype) as trigger_function,
      exists (
        select 1 from pg_catalog.unnest(p.proconfig) as setting
        where pg_catalog.split_part(setting, '=', 1) = 'search_path'
      ) as pinned_search_path
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e'
      )
  )
  -- select·insert·update 는 열 단위로도 줄 수 있어 has_any_column_privilege 로 본다(표 단위도 함께 잡는다).
  -- delete 는 표 단위뿐이라 has_table_privilege 로 본다.
  select l.schema_name, l.name,
    case l.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'foreign table' end as kind,
    r.role, p.privilege as problem
  from relations l
  cross join roles r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as p(privilege)
  where case l.relkind
      when 'v' then not l.security_invoker
      when 'm' then p.privilege = 'SELECT'
      else true
    end
    and case
      when p.privilege = 'DELETE' then pg_catalog.has_table_privilege(r.oid, l.oid, p.privilege)
      else pg_catalog.has_any_column_privilege(r.oid, l.oid, p.privilege)
    end
  union all
  select d.schema_name, d.name, 'function', r.role, 'EXECUTE'
  from definers d
  cross join roles r
  where not d.trigger_function and pg_catalog.has_function_privilege(r.oid, d.oid, 'EXECUTE')
  union all
  select d.schema_name, d.name, 'function', null, 'search_path'
  from definers d
  where not d.pinned_search_path`;

// 화면 역할이 실행해도 되는 SECURITY DEFINER 함수. "스키마.이름(인자 타입)" 시그니처로 적는다.
// 실행 권한 검사만 건너뛰고 search_path 고정 검사는 그대로 받는다.
// - public.is_admin(): profiles 의 "운영자는 전체 프로필 읽기" 정책이 부른다. 정책 식은 조회한 역할의 권한으로
//   돌아서 anon·authenticated 모두 실행 권한이 있어야 profiles 를 읽을 수 있다(없으면 permission denied).
//   부른 사람 자신이 운영자인지만 돌려주므로 /rpc 로 불려도 남의 데이터가 나가지 않는다.
//   security definer 인 이유(정책 안에서 profiles 를 다시 읽을 때의 재귀)는 0001 마이그레이션 주석에 있다.
// - public.my_org_ids()·public.my_owner_org_ids(): 조직 표들의 정책이 부른다(org_id in (select public.my_org_ids())).
//   memberships 의 정책이 memberships 를 다시 읽는 재귀를 끊으려고 security definer 다. 로그인 역할(authenticated)만
//   실행할 수 있고, 부른 사람 자신이 속한(owner 인) 조직의 id 만 돌려준다. 이유는 20261014000001 마이그레이션 주석에 있다.
// - public.is_active_user(): 조직에 들어가는 insert 정책(팀 만들기·초대 수락)이 부른다. 정책 안에서 profiles 를 다시 읽는
//   재귀를 끊으려고 security definer 다. 로그인 역할만 실행하고, 부른 사람 자신이 활동 중인지만 돌려준다(20261015000001).
// - public.delete_my_account(): 본인 탈퇴. auth.users 를 지워야 해서 security definer 다. 로그인 역할만 실행하고,
//   지우는 대상은 JWT 의 본인 id 하나다. 이유는 20261015000001 마이그레이션 주석에 있다.
// - public.admin_set_user_status(uuid, text): 회원 정지·해제. auth.users·auth.sessions 를 고쳐야 해서 security definer 다.
//   로그인 역할만 실행하고, 함수 안에서 운영자(is_admin())가 아니면 권한 오류를 낸다. 이유는 같은 마이그레이션에 있다.
const ALLOWED_DEFINER_FUNCTIONS = new Set([
  "public.is_admin()",
  "public.my_org_ids()",
  "public.my_owner_org_ids()",
  "public.is_active_user()",
  "public.delete_my_account()",
  "public.admin_set_user_status(uuid, text)",
]);

const compareBypass = compareBy((finding) => [
  finding.schema,
  finding.name,
  finding.kind,
  finding.role ?? "",
  finding.problem,
]);

const queryBypasses = async (client) => {
  const { rows } = await client.query(bypassesQuery);
  return rows
    .map((row) => ({
      schema: row.schema_name,
      name: row.name,
      kind: row.kind,
      role: row.role ?? null,
      problem: row.problem,
    }))
    .filter(
      (finding) =>
        !(
          finding.problem === "EXECUTE" &&
          ALLOWED_DEFINER_FUNCTIONS.has(`${finding.schema}.${finding.name}`)
        ),
    )
    .sort(compareBypass);
};

// public 의 뷰·머티리얼라이즈드 뷰·외부 표·SECURITY DEFINER 함수가 RLS 를 거치지 않고 여는 길을
// { schema, name, kind, role, problem } 으로 정렬해 돌려준다. problem 은 권한 이름(SELECT·…·EXECUTE)이거나
// search_path 다. search_path 미고정은 역할과 상관없어 role 이 null 이다.
export async function findRlsBypasses(client) {
  await assertScreenRoles(client);
  return queryBypasses(client);
}

const BYPASS_LABELS = {
  view: "뷰",
  "materialized view": "머티리얼라이즈드 뷰",
  "foreign table": "외부 표",
  function: "SECURITY DEFINER 함수",
};

// 나온 문제의 고치는 법만 붙인다. 뷰·표는 종류마다, 함수는 문제마다 고치는 법이 하나다.
const fixKey = (finding) =>
  finding.kind === "function" ? `function ${finding.problem}` : finding.kind;
// security_invoker 는 PostgreSQL 15 부터 있다. 그 미만에서는 뷰를 화면 역할에 내주지 않는 것이 고치는 길이다.
const SECURITY_INVOKER_SINCE = 150000;
const viewFix = (version) =>
  version >= SECURITY_INVOKER_SINCE
    ? "뷰: alter view <뷰> set (security_invoker = true); — 새 뷰는 create view <뷰> with (security_invoker = true) as ..."
    : "뷰: PostgreSQL 15 미만이라 security_invoker 를 쓸 수 없으니 revoke all on <뷰> from anon, authenticated, public; (화면이 읽어야 하면 15 이상으로 올린 뒤 security_invoker 를 켠다)";
const bypassFixes = (version) => [
  ["view", viewFix(version)],
  [
    "materialized view",
    "머티리얼라이즈드 뷰: RLS 를 걸 수 없으니 revoke select on <뷰> from anon, authenticated, public;",
  ],
  [
    "foreign table",
    "외부 표: RLS 를 걸 수 없으니 public 밖 스키마로 옮기거나 revoke all on <표> from anon, authenticated, public;",
  ],
  [
    "function EXECUTE",
    "함수 실행: revoke execute on function <함수>(<인자>) from anon, authenticated, public; 뒤 필요한 역할에만 grant",
  ],
  [
    "function search_path",
    "함수 search_path: alter function <함수>(<인자>) set search_path = ''; (본문의 이름은 public.<표> 처럼 스키마까지 적는다)",
  ],
];

const describeBypass = (finding) =>
  `  ${finding.schema}.${finding.name} ${BYPASS_LABELS[finding.kind]} ${
    finding.problem === "search_path" ? "search_path 미고정" : `${finding.role} ${finding.problem}`
  }`;

const failOnBypasses = (findings, { version }) => {
  if (!findings.length) return;
  const present = new Set(findings.map(fixKey));
  throw new DbVerifyError(
    [
      `public 의 뷰·함수가 RLS 를 거치지 않고 화면 역할(${SCREEN_ROLES.join("·")})에 열려 있습니다:`,
      ...findings.map(describeBypass),
      "새 마이그레이션에서 고치세요:",
      ...bypassFixes(version)
        .filter(([key]) => present.has(key))
        .map(([, fix]) => `  ${fix}`),
    ].join("\n"),
  );
};

// 고치는 법이 서버 버전에 따라 달라서 버전도 읽는다(화면 역할 확인은 readServer 가 한다).
export async function assertNoRlsBypasses(client) {
  const server = await readServer(client);
  failOnBypasses(await queryBypasses(client), server);
}

export async function verifyDatabase(
  client,
  dir = new URL("../supabase/migrations/", import.meta.url),
) {
  const { migrations, problems } = collectMigrations(await readdir(dir));
  if (problems.length || !migrations.length)
    throw new DbVerifyError(problems.join("\n") || "마이그레이션 파일이 없습니다");
  const history = await client.query(
    "select to_regclass('supabase_migrations.schema_migrations') as history",
  );
  if (!history.rows[0]?.history)
    throw new DbVerifyError(
      "마이그레이션 적용 이력이 없습니다. 승인된 환경에서 pnpm db:push 로 적용하세요.",
    );
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
  const pending = pendingMigrations(
    migrations,
    rows.map((row) => row.version),
  );
  if (pending.length)
    throw new DbVerifyError(
      `미적용 마이그레이션: ${pending.map((migration) => migration.file).join(", ")}`,
    );
  const unlocked = await client.query(
    "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity",
  );
  // 확장이 public 에 만든 표(PostGIS 의 spatial_ref_sys 등)도 화면 역할이 쓸 수 있으니 막는다. 다만 확장 소유라
  // 마이그레이션으로 RLS 를 켜지 못하므로(must be owner) 확장을 extensions 스키마로 옮기는 길을 같이 알린다.
  if (unlocked.rows.length)
    throw new DbVerifyError(
      [
        `RLS가 꺼진 테이블: ${unlocked.rows.map((row) => row.relname).join(", ")}`,
        "  내 표라면 마이그레이션에서 alter table <표> enable row level security; 로 잠급니다.",
        "  확장이 public 에 만든 표라면(PostGIS 의 spatial_ref_sys 등) 마이그레이션으로 고칠 수 없습니다.",
        "  확장은 create extension <이름> with schema extensions; 로 깝니다. 이미 데이터가 있으면 확장을",
        "  지우지 마세요(그 타입을 쓰는 열까지 지워집니다). 옮기는 방법은 Supabase 확장 문서를 따릅니다.",
      ].join("\n"),
    );
  // 버전·화면 역할은 한 번만 확인하고 두 검사가 같이 쓴다.
  const server = await readServer(client);
  failOnPrivileges(await queryPrivileges(client, server));
  failOnBypasses(await queryBypasses(client), server);
  return { applied: migrations.length };
}

export async function runDbVerification(Client) {
  const url = process.env.SUPABASE_DB_URL;
  if (!url)
    throw new DbVerifyError(
      "SUPABASE_DB_URL 이 없습니다. 운영 DB를 사용하는 배포는 검증이 필요합니다.",
    );
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
    await client.query("begin read only");
    const result = await verifyDatabase(client);
    await client.query("commit");
    console.log(
      `✓ DB 연결·마이그레이션 ${result.applied}개·RLS 활성화·화면 역할 권한·뷰·함수 확인`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runDbVerification((await import("pg")).default.Client);
  } catch (error) {
    console.error(describeFailure(error));
    process.exitCode = 1;
  }
}
