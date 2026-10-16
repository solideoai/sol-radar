-- 20261013000001_init — 시작 스키마(baseline).
--
-- 스키마 변경은 대시보드에 직접 붙여넣지 않고, 마이그레이션 한 장씩 이력으로 남긴다.
-- 이 파일이 그 이력의 첫 장이다. 이미 있는 파일을 고치거나 지우면 커밋 게이트가 막는다(append-only).
-- 바꿀 것은 새 파일로 쌓는다.
--
-- 원칙: 표는 만드는 즉시 잠근다. RLS를 켜면 기본이 전부 차단이고, 거기서 필요한 만큼만
-- 권한과 정책으로 연다. "켜는 것이 먼저, 여는 것이 나중"이다.
--
-- 모든 문장은 다시 적용해도 결과가 같게 쓴다(if not exists·drop ... if exists 뒤 create·create or replace).
-- db-push 는 파일 하나를 트랜잭션 하나로 돌리므로 트랜잭션 밖에서만 도는 문장은 쓰지 않는다.
--
-- 이 파일에 든 것:
--   1. profiles — 로그인한 사람 한 명당 한 행("내 행 하나"의 기준). 화면은 읽기만 한다.
--   2. 표시 이름 — 쓰기 견본. 사용자가 고칠 열 하나만 연다.
--   3. memos — 목록형 견본("내 행 여러 개"의 기준).

-- ────────────────────────────────────────────────────────────────
-- 1. profiles — 로그인한 사람 한 명당 한 행. 운영자 여부(is_admin)가 여기 있다.
--
-- 운영자 판단을 코드가 아니라 DB가 한다. 코드로 판단하면 그 판단이 틀렸을 때 막을 방법이
-- 없지만, 정책으로 두면 어떤 화면에서 접근해도 DB가 같은 답을 준다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 화면(anon·authenticated)은 읽기만 한다. 행은 가입 트리거가 만들고, 값은 아래 트리거와 관리 작업(SQL 편집기)이 바꾼다.
--
-- Supabase 는 새 표에 화면 역할의 권한을 전부(all) 기본으로 준다. 쓰기(insert·update·delete)만이 아니라
-- RLS 를 무시하는 truncate, 그리고 references·trigger(PostgreSQL 17 부터는 maintain 도)까지다.
-- 그래서 하나씩 골라 거두지 않고 전부 거둔 뒤 읽기만 다시 준다. maintain 처럼 버전마다 다른 권한을
-- 이름으로 적으면 그 권한이 없는 버전에서 파일 전체가 실패한다.
-- 읽기는 아래 정책이 행을 거른다. 로그아웃한 사람(anon)은 읽기 권한이 있어도 맞는 정책이 없어
-- 빈 결과를 받는다(권한 오류가 아니다).
--
-- email 은 가입 정보(auth.users)를 그대로 비춘 값이다. 본인도 바꿀 수 없다. 바꿀 수 있으면
-- 남의 이메일을 적어 두고 그 이메일로 하는 일(운영자 지정 등)에 끼어들 수 있다.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

-- 도우미: 지금 로그인한 사람이 운영자인가.
--
-- 아래 운영자 정책이 이 함수를 부른다. 정책을 만드는 순간 함수가 있어야 하므로 정책보다 먼저 만든다.
-- security definer 라 정책 안에서 profiles 를 다시 읽어도 정책이 또 걸리지 않는다
-- (그대로 두면 자기를 호출하는 무한 재귀가 된다).
-- search_path 를 고정하는 건 이 함수가 엉뚱한 스키마의 같은 이름 표를 보지 않게 하려는 것이다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 정책의 auth.uid()·is_admin() 은 (select ...) 로 감싼다. 그대로 부르면 PostgreSQL 이 행마다 다시 부르고,
-- is_admin() 은 부를 때마다 profiles 를 한 번 더 읽어 행이 늘수록 느려진다. 감싸면 질의마다 한 번
-- 계산해 두고(InitPlan) 모든 행에 같은 값을 쓴다.
--   https://supabase.com/docs/guides/database/postgres/row-level-security

-- 본인 행만 읽는다.
drop policy if exists "본인 프로필 읽기" on public.profiles;
create policy "본인 프로필 읽기"
  on public.profiles for select
  using ((select auth.uid()) = id);

-- 운영자는 모든 프로필을 읽는다. 어드민 화면을 만들면 이 정책 위에 세운다(화면은 템플릿에 없다).
drop policy if exists "운영자는 전체 프로필 읽기" on public.profiles;
create policy "운영자는 전체 프로필 읽기"
  on public.profiles for select
  using ((select public.is_admin()));

-- 가입하면 프로필이 자동으로 생긴다. 화면에서 만들게 하면 빠뜨리는 경로가 생긴다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 가입 이메일을 바꾸면(이메일 변경 확인이 끝나면) 프로필의 email 도 따라 바꾼다.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- is_admin 은 본인이 못 바꾼다. 첫 잠금은 위의 권한이다(화면 역할에는 이 열의 update 권한이 없다).
-- 이 트리거는 나중에 update 권한을 넓혔을 때(예: 표 전체 update 를 실수로 줬을 때)를 대비한 두 번째 잠금이다.
--
-- 되돌리는 대상은 웹·앱에서 들어온 요청(JWT 가 있고 service_role 이 아닌 것) 가운데 운영자가
-- 아닌 사람의 변경이다. JWT 가 없는 직접 접속(대시보드 SQL 편집기·마이그레이션)과 service_role 은
-- 관리 작업이라 통과시킨다. 이 길까지 막으면 첫 운영자를 지정할 방법이 사라진다.
--
-- 누가 운영자인지는 스키마가 아니라 데이터라서 마이그레이션에 적지 않는다.
-- 첫 운영자는 대시보드 SQL 편집기에서 지정한다. 기준은 가입 정보(auth.users)의 이메일이다:
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = '<운영자 이메일>');
create or replace function public.protect_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_is_admin on public.profiles;
create trigger profiles_protect_is_admin
  before update on public.profiles
  for each row execute function public.protect_is_admin();

-- ────────────────────────────────────────────────────────────────
-- 2. 표시 이름 — 쓰기 견본: 본인이 자기 프로필의 표시 이름(display_name)만 고친다.
--
-- 사용자가 고칠 열을 더할 때는 그 열만 연다. 새 기능의 쓰기는 이 세 겹을 본보기로 삼는다:
--   1. 권한 — 열 단위 grant. 표 전체에 update 를 주면 email·is_admin 까지 열린다.
--   2. 정책 — 본인 행만. using 은 고칠 수 있는 행을, with check 는 고친 뒤의 행을 본다.
--   3. 제약 — 값의 규칙. 화면·서버의 검증(web/server/profile)을 건너뛴 요청(앱·직접 호출)도 DB 가 막는다.
-- ────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists display_name text;

-- 앞뒤 공백 없이 1~40자. 비어 있는 값(null)은 아직 정하지 않았다는 뜻이라 통과한다.
alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles
  add constraint profiles_display_name_check
  check (display_name = btrim(display_name) and char_length(display_name) between 1 and 40);

grant update (display_name) on public.profiles to authenticated;

-- 운영자도 남의 표시 이름은 고치지 못한다("운영자는 전체 프로필 읽기"는 읽기 정책이다).
drop policy if exists "본인 프로필 수정" on public.profiles;
create policy "본인 프로필 수정"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ────────────────────────────────────────────────────────────────
-- 3. memos — 목록형 견본: 로그인한 사람이 자기 메모를 여러 개 읽고, 추가하고, 지운다.
--
-- profiles 가 "내 행 하나"라면 이 표는 "내 행 여러 개"의 기준이다. 사용자별 데이터 표는 이 모양을 따른다:
--   1. 잠금 — 만들자마자 RLS 를 켜고, 화면 역할의 기본 권한을 전부 거둔 뒤 필요한 것만 다시 준다.
--   2. 권한 — select·insert·delete 만 authenticated 에 준다. update 는 주지 않는다(메모는 고치지 않고 지운다).
--   3. 정책 — 본인 것만 읽기·추가·삭제. 운영자 정책은 만들지 않는다(운영자도 남의 메모를 읽지 못한다).
--   4. 제약 — 본문은 앞뒤 공백 없이 1~500자. 화면·서버의 검증을 건너뛴 요청(앱·직접 호출)도 DB 가 막는다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint memos_body_check
    check (body = btrim(body) and char_length(body) between 1 and 500)
);

alter table public.memos enable row level security;

-- 정책이 거르는 열에 인덱스를 단다. 없으면 읽을 때마다 표 전체를 훑는다.
create index if not exists memos_user_id_idx on public.memos (user_id);

-- 기본 권한을 먼저 거두고, 읽기·추가·삭제만 로그인 역할에 준다. anon(로그아웃)은 아무것도 못 한다.
revoke all on table public.memos from anon, authenticated, public;
grant select, insert, delete on table public.memos to authenticated;

drop policy if exists "본인 메모 읽기" on public.memos;
create policy "본인 메모 읽기"
  on public.memos for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 남의 user_id 로는 넣지 못한다. with check 가 넣는 행을 본다.
drop policy if exists "본인 메모 추가" on public.memos;
create policy "본인 메모 추가"
  on public.memos for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 남의 행은 using 이 걸러 지울 행이 없다(오류가 아니라 0행이다).
drop policy if exists "본인 메모 삭제" on public.memos;
create policy "본인 메모 삭제"
  on public.memos for delete
  to authenticated
  using ((select auth.uid()) = user_id);
