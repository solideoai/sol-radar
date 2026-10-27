---
name: database
description: Supabase로 데이터를 저장하고 접근 권한을 RLS 정책으로 잠그는 가이드. "저장", "DB 연결", "Supabase", "로그인", "남의 데이터가 보여요", "테이블 추가" 같은 요청 시 사용. 마이그레이션은 새 파일로만, 표는 만들자마자 잠근다.
---

# database — Supabase로 저장하고, 정책으로 잠근다

이 프로젝트는 처음부터 Supabase 를 쓴다. 접근 통로는 **anon 키 하나**이고, 누가 무엇을 읽고
쓸 수 있는지는 **DB의 RLS 정책**이 정한다. 코드가 판단하지 않는다.

## 왜 anon 키인가

`service_role` 키는 RLS 를 통째로 무시한다. 그 키로 다니면 "남의 데이터를 막는 일"이 전부
코드의 책임이 되고, 코드가 한 군데라도 틀리면 막을 방법이 없다.

anon 키로 다니면 정책이 DB 안에서 지켜진다. 브라우저에서 들어오든 서버에서 들어오든, 화면을 잘못
만들었든 상관없이 같은 답이 나온다.

| 키 | 어디에 | RLS |
|---|---|---|
| anon | 웹 브라우저 `getSupabaseBrowser()`(`web/lib/supabase-browser.ts`) · 웹 서버 `await getSupabase()`(`web/server/supabase`) | 적용된다 (기본 통로) |
| service_role | `getSupabaseAdmin()` | **무시한다.** 관리 작업에만, 꼭 필요할 때만 |

⚠️ 어드민 화면을 만들 때도 `service_role` 을 쓰지 않는다. 운영자 판단은 `profiles.is_admin` 과
관리자 정책이 한다.

## 1. DB 고르기 — 로컬 또는 클라우드

둘 다 같은 Supabase 이고 같은 마이그레이션을 쓴다. 계정 없이 시작하려면 로컬, 배포하려면 클라우드.

### 1-A. 로컬 (계정 없이, Docker)

준비물: **Docker Desktop**(켜져 있어야 한다) + **Supabase CLI**(macOS `brew install supabase/tap/supabase`,
Windows 는 scoop — CLI 가 없으면 `pnpm db:start` 가 OS 별 설치법을 출력한다). 저장소 의존성이 아니라 직접 설치한다.

```bash
pnpm db:start              # 켜기 → 새 마이그레이션 적용 → web/.env.local 에 주소·anon 키 기록
pnpm db:stop               # 끄기. 데이터는 Docker 볼륨에 남는다
```

- 첫 실행은 Docker 이미지를 받느라 몇 분 걸린다. 설정은 `supabase/config.toml`(바꾼 값만 적고 나머지는 CLI 기본값).
  이 템플릿으로 프로젝트를 여럿 만들면 `project_id` 를 프로젝트마다 바꾼다.
- env 파일은 URL·anon 키 두 줄만 고치고 다른 줄은 둔다. 파일이 없으면 `.env.example` 을 바탕으로 만든다.
  키 값은 화면에 찍지 않는다. 값이 바뀌면 켜 둔 개발 서버를 다시 켠다.
- 포트: API `54321` · DB `54322` · Studio `54323`(표·데이터·SQL 편집기) · 메일함 `54324`. 주소는 `db:start` 가 끝에 출력한다.
- 로컬에서는 메일(매직 링크·비밀번호 재설정 등)이 실제로 나가지 않고 **메일함**으로 온다. 링크도 거기서 누른다.
  가입도 확인 메일의 링크를 열어야 끝난다(`supabase/config.toml` 의 `enable_confirmations` — 클라우드 기본값과 같게 켜 뒀다).
- **클라우드 값 보호**: 그 파일의 URL 에 이미 클라우드 주소가 있으면 덮지 않고 건너뛰며 실패한다.
  로컬로 바꾸려면 그 파일을 같은 폴더의 `.env.cloud.local` 로 옮기고 다시 돌린다(웹이 읽지 않는 이름이라 보관만 된다).
- ⚠️ `web/.env.development.local` 에 클라우드 값이 있으면 Next 가 그쪽을 먼저 읽는다.
  `db:start` 는 그 파일들을 보지 않으므로, 성공했다고 나와도 화면은 클라우드에 붙는다. 로컬로 쓰려면 그 파일을 `.env.cloud.local` 로 옮긴다.

### 1-B. 클라우드 (supabase.com, 무료)

1. supabase.com 가입 → New project.
2. Project Settings → **API** 에서 `Project URL`, `anon` 키, `service_role` 키를 확인한다.
3. Project Settings → **Database** → Connection string → **Session pooler** URI 를 복사한다.
4. 로컬도 같이 쓰면 `supabase/config.toml` 의 `major_version` 을 클라우드 Postgres 메이저 버전에 맞춘다.

## 2. 환경변수

클라우드면 각 폴더의 `.env.example` 을 보고 두 파일(루트 `.env.local`·`web/.env.local`)을 만든다. 값은 **그 값을 읽는 프로그램의 폴더**에 둔다.
파일마다 넣는 변수와 읽는 쪽은 `docs/boilerplate/database.md` 의 "환경변수 파일 두 개" 표가 정본이다.

로컬(1-A)이면 `pnpm db:start` 가 `web/.env.local` 의 URL·anon 키만 채운다(`SUPABASE_SERVICE_ROLE_KEY` 는 적지 않는다).
루트 `.env.local` 은 클라우드 전용이다 — `db:push`·`db:verify` 는 TLS 인증서를 검사해서 로컬 DB 에 붙지 않는다.

`NEXT_PUBLIC_` 로 시작하는 값은 브라우저 번들에 그대로 박힌다.
anon 키는 그래도 된다(정책이 지킨다). **service_role 키는 절대 안 된다.** 접두어 없는 이름으로
`web/.env.local` 에 두면 서버 코드만 읽고 번들에는 들어가지 않는다.

환경별 파일을 더 만들 때는 이름을 `.env.<환경>.local` 로 짓는다(예: `.env.staging.local`).
이 모양이어야 깃(`.gitignore`)과 클로드 읽기 차단(`.claude/settings.json`)에 함께 걸린다.

## 3. 테이블 만들기 — 마이그레이션, 대시보드 직접 실행 금지

- 스키마 변경은 `supabase/migrations/` 에 **새 파일**로 남긴다. 파일명이 시간순으로 정렬되게
  (예: `20260101120000_add_subscription.sql`).
- 대시보드(로컬은 Studio) **SQL Editor** 에 직접 붙여넣지 않는다. 이력이 안 남는다. 커밋 게이트가 기존
  마이그레이션의 수정·삭제를 막는다.
- 표는 **만드는 그 파일에서 즉시** `enable row level security` 로 잠근다.
- 같은 파일에서 `REVOKE ALL` 로 `anon`·`authenticated`·`PUBLIC` 의 표 권한을 회수한 뒤,
  필요한 역할에 필요한 `SELECT`·`INSERT`·`UPDATE`·`DELETE` 만 명시적으로 `GRANT` 한다.
  `GRANT ALL` 을 새 표의 기본 안내로 쓰지 않는다. RLS 만 켜도 `TRUNCATE` 는 행 정책을 거치지 않고,
  `TRIGGER`·`REFERENCES` 는 표 구조에 기대는 권한을 연다. PostgreSQL 17 이상에서는 `MAINTAIN` 도 회수해야 한다.
- 재실행에 안전하게 쓴다: `create table if not exists`·`create index if not exists`, 정책은 `drop policy if exists` 후 `create policy`.
- `supabase/` 아래가 바뀐 커밋에서는 커밋 게이트가 **DB 정책 테스트**(`pnpm test:db`)를 돈다. 실제 DB 없이
  PGlite(PostgreSQL 엔진)에 마이그레이션 전체를 적용해 RLS·권한·트리거를 확인하고(`scripts/database.test.mjs`),
  깨지면 커밋을 막는다. 새 표의 정책을 만들었으면 "남의 행이 안 보인다"는 시험을 이 파일에 함께 더한다.

```sql
create table if not exists public.things (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.things enable row level security;

-- 정책이 거르는 열에 인덱스를 단다. 없으면 읽을 때마다 표 전체를 훑는다.
create index if not exists things_user_id_idx on public.things (user_id);

-- 기본 권한을 먼저 거두고, 이 예제에 필요한 읽기·추가만 로그인 역할에 준다.
revoke all on table public.things from anon, authenticated, public;
grant select, insert on table public.things to authenticated;

-- 켜는 것이 먼저, 여는 것이 나중. 필요한 만큼만 연다.
-- auth.uid() 는 (select auth.uid()) 로 감싼다. 질의마다 한 번만 부르고 모든 행에 같은 값을 쓴다.
drop policy if exists "본인 것만 읽기" on public.things;
create policy "본인 것만 읽기"
  on public.things for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "본인 것만 쓰기" on public.things;
create policy "본인 것만 쓰기"
  on public.things for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
```

**거르는 열을 안 넣으면 정책을 쓸 수 없다.** 위 본보기는 정책의 모양(켜기 → 거두기 → 필요한 만큼 열기)을 보이는 최소 예라 `user_id` 로 거른다.
`profiles` 처럼 사람 하나에 딸린 값이면 그대로 쓴다.

**사람이나 팀이 만드는 데이터는 조직에 속한다 — `org_id` 로 거른다.** 가입하면 개인 조직이 생기므로 혼자 쓰는 데이터도 조직 단위로 둔다.
본보기는 `supabase/migrations/20261014000004_tasks_and_activity.sql` 의 `tasks`(2절 표, 6절 권한·정책)이고, 설명은 `docs/boilerplate/database.md` 의 조직 견본과 작업·활동 견본이다.

- 표에 `org_id uuid not null references public.organizations (id) on delete cascade` 와 그 인덱스를 둔다.
  누가 만들었는지가 필요하면 만든 사람 열을 함께 둔다(`tasks.created_by` — 기본값 `auth.uid()`, `profiles` 를 가리키고 `on delete set null`, 화면 역할에 그 열의 쓰기 권한을 주지 않는다).
- 정책은 `org_id in (select public.my_org_ids())`(멤버 전원)이고, owner 만 하는 일은 `org_id in (select public.my_owner_org_ids())` 다.
  넣기는 `with check` 에 만든 사람이 `(select auth.uid())` 인지도 건다. 두 도우미는 바깥 행과 상관없는 하위 질의라 질의마다 한 번 계산된다.
- RLS 는 내가 멤버인 조직의 행을 모두 연다. 화면이 지금 조직 하나만 보이려면 코드에서 `org_id` 로 좁힌다.
- ⚠️ 정책 안에서 `memberships` 를 직접 읽지 않는다. memberships 의 정책이 다시 memberships 를 읽어 무한 재귀 오류가 난다 — 그래서 도우미가 `security definer` 다.
  정책끼리 서로를 부르는 고리(invitations → organizations → invitations)도 같은 재귀다. 그런 규칙은 트리거로 막는다(같은 파일의 `check_invitation`).
- 서비스 운영자(`profiles.is_admin`)는 조직 역할(`memberships.org_role`)이 아니다. 운영자에게 조직을 넘어 읽는 정책을 주지 않는다.
- 정책 시험은 `scripts/database.test.mjs` 의 "조직·멤버십·초대 정책" 묶음에 더한다. "조직 밖의 사람(운영자 포함)은 못 읽는다"를 꼭 본다.

**정책은 빠르게 쓴다.** 정책 식은 읽는 행마다 계산된다. 근거: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

- `auth.uid()`·`auth.jwt()`·`public.is_admin()`·`current_setting()` 처럼 질의 하나 동안 값이 같은 호출은
  `(select auth.uid())`·`(select public.is_admin())` 로 감싼다. 감싸지 않으면 행마다 다시 부르고, `is_admin()` 은
  부를 때마다 `profiles` 를 한 번 더 읽는다. 행의 열에 따라 값이 달라지는 호출은 감싸도 행마다 계산된다.
- 정책이 거르는 열(`org_id`·`user_id` 등)에는 인덱스를 단다. 기본 키(`id`)는 이미 인덱스가 있다.
- 정책에 `to authenticated` 처럼 역할을 적는다. 해당하지 않는 역할에는 정책 식을 계산하지 않는다.
- `pnpm test:db`(`scripts/database.test.mjs`)가 public 의 모든 정책에서 감싸지 않은 호출을 찾으면 실패한다(Supabase 린터 0003 을 따른다).
  위 본보기 SQL 도 그 시험이 문서에서 그대로 꺼내 적용해 본다. 본보기를 고칠 때 `create table if not exists public.things` 줄은 남긴다.

### 뷰·함수 — 표를 잠가도 옆으로 새는 길

RLS 는 표에만 걸린다. 뷰와 함수는 잠근 표의 행을 정책 없이 내주거나 바꾸게 할 수 있다.

- **뷰**는 `create view ... with (security_invoker = true) as ...` 로 만든다. 없으면 뷰 주인(postgres) 권한으로
  밑 표를 읽고 써서 정책을 건너뛴다(읽기를 거둬도 남은 쓰기 권한으로 남의 행을 지운다). `security_barrier` 는 다른 옵션이다.
- **머티리얼라이즈드 뷰·외부 표(foreign table)**에는 RLS 를 걸 수 없다. 화면 역할에 내주지 않는다(`revoke all on ... from anon, authenticated, public`).
- **함수**는 `revoke execute on function <함수>(<인자>) from anon, authenticated, public;` 뒤 필요한 역할에만 `grant` 한다.
  Supabase 는 public 의 새 함수에 화면 역할 실행 권한을 따로 주므로 `from public` 만 거두면 `/rpc` 로 그대로 불린다.
- **`security definer`** 함수는 정책을 건너뛴다. 꼭 필요할 때만 쓰고 `set search_path = ''` 로 고정한다(본문은 `public.<표>` 처럼 스키마까지 적는다).

`pnpm test:db`·`pnpm db:verify` 가 같은 검사기(`scripts/db-verify.mjs` 의 `findRlsBypasses`)로 이 넷을 확인한다.
화면 역할이 실행해야 하는 `security definer` 함수는 그 파일의 허용 목록에 이유와 함께 적는다(지금은 정책이 부르는 `public.is_admin()`·`public.my_org_ids()`·`public.my_owner_org_ids()` 셋).
확장이 깐 뷰·함수는 확장 주인 소유라 마이그레이션이 고칠 수 없어 이 검사에서 뺀다. 확장은 `public` 이 아니라
`extensions` 스키마에 깐다(`create extension ... with schema extensions`). `public` 에 깔면 확장의 표(PostGIS 의 `spatial_ref_sys` 등)가 RLS 검사에 걸린다.

## 4. 적용

로컬은 `pnpm db:start` 를 다시 돌린다(켜져 있어도 된다). 아직 적용 안 된 마이그레이션만 적용한다. 클라우드는:

```bash
pnpm db:push     # supabase/migrations/ 중 아직 적용 안 된 것만 순서대로 적용
pnpm db:verify   # 읽기 전용 검사: 연결·마이그레이션 이력·public 표의 RLS·화면 역할의 실효 위험 권한
```

`db:verify` 는 아무것도 바꾸지 않는다(읽기 전용 트랜잭션). 이력 표가 없거나, 적용 안 된 마이그레이션이
있거나, RLS 가 꺼진 public 표가 있으면 그 이름을 대며 실패한다. public 일반 표·파티션 부모·리프에서
`anon`·`authenticated` 의 실효 `TRUNCATE`·`TRIGGER`·`REFERENCES` 와 PostgreSQL 17 이상의 `MAINTAIN` 도 검사한다.
직접 부여·`PUBLIC`·상속 권한을 함께 보고, `REFERENCES` 는 열 단위 부여도 검사한다. 위험 권한은
스키마·표·역할·권한으로 안내하며, 역할 누락이나 검사 쿼리 오류를 통과로 처리하지 않는다.

검사는 아무것도 고치지 않는다. 실패하면 실제 부여 경로(열 권한·상속 역할 포함)를 확인해 **새 마이그레이션**으로
필요한 권한만 남긴다. 이미 적용한 마이그레이션은 수정하지 않는다. 권한을 거둘 때 `CASCADE` 는 쓰지 않는다 —
그 권한을 바탕으로 남에게 다시 준 권한이 있으면 조용히 함께 지우지 않고 실패하게 둔다.

적용한 파일은 이력 표(`supabase_migrations.schema_migrations`)에 버전이 남아 다음부터 건너뛴다.
로컬(`db:start`)과 클라우드(`db:push`)가 같은 이력 표를 쓴다. `db:push` 는 파일 하나가 트랜잭션 하나라서, 실패하면 그 파일만 통째로 되돌아간다. 그래서 트랜잭션 안에서
못 도는 문장(`create index concurrently` 등)은 쓰지 않는다.

⚠️ `supabase db push`(CLI)는 무료 티어 Session pooler 에서 인증이 막힌다. 그래서 pg 로 직접
접속하는 `pnpm db:push` 를 쓴다.

⚠️ 잘못된 마이그레이션은 새 파일로 고친다. DB 를 비우고 다시 적용하는 `supabase db reset` 은 가드(`.claude/hooks/guard.sh`)가 막는다.

## 5. 코드에서 쓰기

**화면에서 직접** (대부분의 경우):

```ts
// 웹 클라이언트 컴포넌트
import { getSupabaseBrowser } from "@/lib/supabase-browser";
const { data, error } = await getSupabaseBrowser().from("things").select("*");

// 앱
import { supabase } from "@/lib/supabase";
const { data, error } = await supabase.from("things").select("*");
```

로그인한 사람이 읽을 수 있는 것(내 행·내가 멤버인 조직의 행)만 돌아온다. 남의 것은 `where` 를 안 써도 정책이 걸러 준다.
조직이 여럿이면 모두 열리므로, 지금 조직 하나만 보일 때는 `.eq("org_id", orgId)` 로 좁힌다.

**서버의 도메인을 거칠 때** (계산·검증이 얽힐 때): `web/server/<도메인>/` 에 어댑터를 만들고
`await getSupabase()` 를 쓴다. 요청한 사람의 로그인 쿠키가 실려 있어서 서버에서도 정책이 그 사람
기준으로 걸린다. **요청마다 부르고, 만든 클라이언트를 모듈 변수에 담아 두지 않는다**(다른 사람의
요청에 로그인이 섞인다). 구조는 `architecture` 스킬의 파일 규약을 따른다.

## DB 타입 — 마이그레이션에서 생성한다

표·열 이름과 결과 행의 타입은 손으로 적지 않고 마이그레이션에서 만든다. 디자인 토큰과 같은 '정본 → 생성물' 방식이다.

```bash
pnpm db:types        # web/lib/database.types.ts 를 다시 만든다
pnpm check:db-types  # 생성물이 마이그레이션과 어긋나면 실패 (커밋 게이트·CI 가 돈다)
```

- **마이그레이션을 추가하면 `pnpm db:types` 를 돌려 생성물을 갱신하고 같은 커밋에 넣는다.** 빠뜨리면
  커밋 게이트(`supabase/` 가 바뀐 커밋)와 CI 공통 검증의 `check:db-types` 가 막는다.
- 생성물은 손으로 고치지 않는다. 타입이 틀렸다면 새 마이그레이션으로 스키마를 바로잡고 다시 생성한다.
- 실제 DB·Docker·Supabase CLI 없이 PGlite 에 마이그레이션을 적용해 만든다. 그래서 `db:push` 전에도 돈다.
  모양은 `supabase gen types typescript` 출력과 같다(`Database`·`Tables<"표">`·`TablesInsert`·`TablesUpdate`·`Enums`).

코드에서는 이미 타입이 붙은 클라이언트(`getSupabaseBrowser()`·`await getSupabase()`)를 쓴다.
없는 표·열 이름은 컴파일에서 걸리고, `select` 결과에 행 타입이 붙는다.

```ts
import type { Tables } from "@/lib/database.types";

const { data } = await getSupabaseBrowser().from("profiles").select("id, email, is_admin");
// data: { id: string; email: string | null; is_admin: boolean }[] | null

type Profile = Tables<"profiles">; // 행 하나의 타입이 필요할 때
```

⚠️ PGlite 는 Supabase 의 바탕 중 화면 역할(anon·authenticated)과 `auth.users`·`auth.uid()`·`auth.jwt()` 만
흉내 낸다(`scripts/supabase-pglite.mjs`). 마이그레이션이 여기 없는 것(`create extension`, `extensions`·`storage`
스키마 등)에 기대면 `pnpm test:db` 와 `pnpm db:types` 가 그 파일 이름과 함께 실패한다(예: `extension "pgcrypto"
is not available`). 그때는 흉내를 그 파일 한 곳에서 넓힌다(PGlite 가 제공하는 확장이면 거기서 싣는다) —
정책 시험과 타입 생성기가 같은 흉내를 쓰므로 두 벌로 고치지 않는다.

## 로그인

- 웹: 로그인·로그아웃은 클라이언트 컴포넌트에서 `getSupabaseBrowser().auth.*` 로 한다. 세션은 쿠키에
  남고, `web/proxy.ts` 가 요청마다 만료된 토큰을 갱신한다. 서버에서 누가 로그인했는지는
  `(await getSupabase()).auth.getClaims()` 로 본다(`getSession()` 은 서버에서 믿지 않는다).
- 화면을 가리는 것(로그인 안 하면 이동)은 편의일 뿐이다. 데이터를 지키는 것은 RLS 정책이다.
- 견본의 코드 자리(도메인·화면)는 `architecture` 스킬의 "서버 코드라면", 화면별 동작은 `docs/boilerplate/database.md` 의 로그인·조직·작업·활동 견본에 있다.
  여기에는 DB 쪽 본보기만 적는다. 로그인 견본은 가입 → 이메일·비밀번호 로그인 → 본인 `profiles` 읽기 → 로그아웃을 실제로 한다.
  운영자는 정책상 모든 행을 읽으므로 "내 것"은 로그인한 id 로 좁혀 읽는다.
- 데이터 표(조직의 행 여러 개): `supabase/migrations/20261014000004_tasks_and_activity.sql` 의 `tasks`(열 단위 `insert`·`update` 권한, 조직 단위 정책,
  같은 조직 멤버만 담당자가 되는 복합 외래 키, DB 가 채우는 시각). 같은 파일의 `activities` 는 화면 역할이 읽기만 하고 트리거(`security definer`)만 쓰는 기록 표,
  `task_dashboard_stats` 는 호출한 사람 권한(`security invoker`)으로 도는 집계 함수의 본보기다. 앱에는 없다.
- 조직: `supabase/migrations/20261014000001_organizations.sql`(조직·멤버십·초대, 도우미, 트리거, 정책). 초대 수락은 JWT 의 `email` 클레임으로 판단하는 정책이다.
- 메일 링크(가입 확인·비밀번호 재설정)는 웹의 `web/app/auth/confirm/route.ts` 가 받아 `@/server/auth` 로 확인한다. 링크 모양은 `supabase/templates/` 가 정하고,
  클라우드는 대시보드에 Site URL 과 같은 템플릿을 넣어야 한다(`docs/boilerplate/database.md`). 새 메일 종류(초대·이메일 변경)를 더하면 `auth.model.ts` 의 종류 목록과 템플릿을 같이 더한다.
- 쓰기 견본: 웹의 표시 이름 고치기. `supabase/migrations/20261013000001_init.sql` 의 "표시 이름" 절이 열 단위 `grant update (display_name)`·
  본인 행 수정 정책·값 제약을 한자리에 둔다. 기존 표에 사용자가 고칠 열을 더할 때 이 모양을 따르고, 표 전체에 `update` 를 주지 않는다.

**운영자 지정**은 마이그레이션이 아니라 데이터다. 대시보드 SQL 편집기에서 가입 정보 기준으로 한다:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = '<운영자 이메일>');
```

로컬은 Studio(`db:start` 가 출력한 주소)의 SQL 편집기에서 한다.
`profiles.email` 은 사용자가 바꿀 수 없고 가입 이메일을 따라간다. 그래도 기준은 `auth.users` 로 둔다.

## 6. 잠긴 게 맞는지 확인하기

정책을 썼으면 **뚫리는지 직접 해 본다.** 안 새는 걸 눈으로 봐야 믿을 수 있다.

1. 로그인해서 데이터를 하나 만든다.
2. 로그아웃한다.
3. 그 데이터를 주소로 직접 요청한다 → 안 나와야 정상이다.

나온다면 정책이 없거나, `service_role` 로 다니고 있거나, 정책 조건이 틀린 것이다.

## 7. 실행 환경에도 환경변수 넣기

실행 환경(Docker Compose + Supabase 클라우드)에 넣을 값과 자리는 `docs/10-DEPLOYMENT.md`("env 파일 위치", `infra/env/*.env.example`)가 정본이다.
Vercel 배포는 web 하나만 배포하며(ADR-049) 안내는 `docs/boilerplate/first-deployment.md`다.
하나만 기억한다 — 앱·worker 가 도는 환경에 루트 `.env.local` 의 `SUPABASE_DB_URL`(DDL 권한)을 넣지 않는다. 배포 검사(`pnpm db:verify`)가 필요하면 읽기 전용 역할의 연결 문자열을 쓴다.
