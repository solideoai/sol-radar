-- 20261014000001_organizations — 조직·멤버십·초대(멀티테넌시 견본)와 메모의 조직 단위 이전.
--
-- 모든 데이터는 조직에 속한다. 가입하면 개인 조직이 생기고(혼자만 쓴다), 협업은 팀 조직을 만들어 초대한다.
-- 사용자별 데이터 표는 user_id 가 아니라 org_id 로 거른다 — 이 파일의 memos 가 그 본보기다.
-- 스펙: polaris/specs/in-progress/organizations-and-memberships.md
--
-- 이 파일에 든 것:
--   1. organizations — 조직. 개인 조직은 personal_owner_id 에 주인이 있다.
--   2. memberships — 누가 어느 조직에 어떤 역할(owner·member)로 있는가.
--   3. 정책용 도우미 — 내 조직·내가 owner 인 조직의 id 목록.
--   4. invitations — 이메일 지정 초대.
--   5. 가입·팀 만들기·초대 수락이 남기는 행, 마지막 owner 보호.
--   6. 정책 — 조직·멤버십·초대, 그리고 같은 조직 멤버의 프로필 읽기.
--   7. memos 를 조직 단위로 옮긴다.
--   8. 이미 가입한 계정과 메모를 채운다.
--
-- 역할 열 이름은 org_role 이다. 서비스 전체 운영자(profiles.is_admin)와 다르다. 운영자도 남의 조직은 읽지 못한다.
-- 역할 값은 enum 이 아니라 check 제약으로 묶는다. create type 은 다시 적용하면 실패한다(이 파일은 재실행에 안전해야 한다).

-- ────────────────────────────────────────────────────────────────
-- 1. organizations
-- ────────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  -- 주소의 첫 마디(/acme/dashboard). 팀은 만들 때 받고 개인 조직은 무작위 8자다.
  -- 최상위 경로 이름은 쓰지 못한다. 같은 목록을 웹 도메인(web/server/organization)이 먼저 보고 안내한다.
  slug text not null,
  name text not null,
  -- 개인 조직이면 주인, 팀 조직이면 null. 한 사람에 개인 조직은 하나다.
  personal_owner_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_personal_owner_id_key unique (personal_owner_id),
  constraint organizations_slug_check check (
    slug ~ '^[a-z0-9-]{3,32}$'
    and slug not in ('account', 'admin', 'api', 'auth', 'dashboard', 'invitations', 'memos', 'settings', 'teams')
  ),
  constraint organizations_name_check check (name = btrim(name) and char_length(name) between 1 and 40)
);

alter table public.organizations enable row level security;

-- ────────────────────────────────────────────────────────────────
-- 2. memberships
--
-- user_id 는 auth.users 가 아니라 profiles 를 가리킨다. 그래야 멤버 목록이 이름·이메일을 한 질의로 붙여 읽는다
-- (외래 키가 public 표끼리여야 생성 타입에 관계가 생긴다). profiles 는 auth.users 와 함께 지워진다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint memberships_org_role_check check (org_role in ('owner', 'member'))
);

alter table public.memberships enable row level security;

-- 기본 키가 (org_id, user_id) 라 org_id 로 거르는 것은 이미 빠르다. "내 조직"은 user_id 로 찾는다.
create index if not exists memberships_user_id_idx on public.memberships (user_id);

-- ────────────────────────────────────────────────────────────────
-- 3. 정책용 도우미
--
-- memberships 의 정책이 memberships 를 다시 읽으면 PostgreSQL 이 무한 재귀로 멈춘다. security definer 함수는
-- 정책을 거치지 않고 읽어 그 고리를 끊는다. 부른 사람 자신의 조직만 돌려주므로 /rpc 로 불려도 남의 것이 나가지 않는다.
-- scripts/db-verify.mjs 의 허용 목록에 이유와 함께 올라 있다.
--
-- 정책에서는 org_id in (select public.my_org_ids()) 로 쓴다. 바깥 행과 상관없는 하위 질의라 질의마다 한 번 계산된다.
-- org_id 를 인자로 받는 함수(is_member(org_id))는 행마다 다시 불린다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.memberships where user_id = auth.uid();
$$;

create or replace function public.my_owner_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.memberships where user_id = auth.uid() and org_role = 'owner';
$$;

-- Supabase 는 public 의 새 함수에 화면 역할의 실행 권한을 따로 준다. 다 거두고 로그인 역할에만 준다(정책이 로그인 역할만 본다).
revoke execute on function public.my_org_ids() from public, anon, authenticated;
revoke execute on function public.my_owner_org_ids() from public, anon, authenticated;
grant execute on function public.my_org_ids() to authenticated;
grant execute on function public.my_owner_org_ids() to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. invitations — 이메일 지정 초대
--
-- owner 가 이메일을 적어 초대하고, 그 이메일로 로그인한 사람만 받은 초대를 보고 수락한다. 판단은 정책이 하고,
-- 로그인 이메일은 서명된 JWT 의 email 클레임에서 읽는다. 메일은 보내지 않는다(초대한 사람이 직접 알린다).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- 소문자로 저장한다. 비교도 소문자로 한다(대소문자를 무시한다).
  email text not null,
  org_role text not null default 'member',
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  constraint invitations_org_id_email_key unique (org_id, email),
  constraint invitations_email_check check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  constraint invitations_org_role_check check (org_role in ('owner', 'member'))
);

alter table public.invitations enable row level security;

-- 받은 초대는 이메일로 찾는다.
create index if not exists invitations_email_idx on public.invitations (email);

-- ────────────────────────────────────────────────────────────────
-- 5. 행을 남기는 트리거와 마지막 owner 보호
-- ────────────────────────────────────────────────────────────────

-- 개인 조직 하나와 owner 멤버십을 만든다. 이미 있으면 그 조직을 돌려준다. 가입 트리거와 아래 8절의 채우기가 함께 쓴다.
-- 화면 역할은 부르지 못한다(실행 권한을 거둔다). 주소 이름은 무작위 8자이고, 겹치면(약 43억 분의 1) 다시 뽑는다.
create or replace function public.create_personal_org(owner_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid;
begin
  select id into org from public.organizations where personal_owner_id = owner_id;
  if org is not null then
    return org;
  end if;
  loop
    begin
      insert into public.organizations (slug, name, personal_owner_id)
      values (substr(md5(gen_random_uuid()::text), 1, 8), '개인 공간', owner_id)
      returning id into org;
      exit;
    exception when unique_violation then
      -- slug 가 겹쳤다. 새로 뽑는다.
    end;
  end loop;
  insert into public.memberships (org_id, user_id, org_role) values (org, owner_id, 'owner');
  return org;
end;
$$;

revoke execute on function public.create_personal_org(uuid) from public, anon, authenticated;

-- 가입 트리거를 넓힌다: 프로필에 이어 개인 조직도 만든다. 화면에서 만들게 하면 빠뜨리는 경로가 생긴다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  perform public.create_personal_org(new.id);
  return new;
end;
$$;

-- 팀을 만든 사람이 그 팀의 owner 가 된다. 만든 사람은 아직 멤버가 아니라 정책으로는 이 행을 넣을 수 없다.
-- JWT 가 없는 관리 작업(SQL 편집기)으로 만든 팀은 owner 를 직접 넣는다.
create or replace function public.add_team_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    insert into public.memberships (org_id, user_id, org_role) values (new.id, auth.uid(), 'owner');
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_add_team_owner on public.organizations;
create trigger organizations_add_team_owner
  after insert on public.organizations
  for each row
  when (new.personal_owner_id is null)
  execute function public.add_team_owner();

-- 조직에 owner 가 한 명은 남게 한다. 마지막 owner 는 나가지도, member 로 내려가지도 못한다.
-- 개인 조직은 owner 가 한 명뿐이라 같은 규칙으로 나갈 수 없다.
--
-- 두 owner 가 동시에 서로를 내리면 둘 다 "다른 owner 가 있다"를 보고 통과해 0명이 될 수 있다. 그래서 조직 행을 잠가
-- 같은 조직의 owner 변경을 한 줄로 세운다. 뒤에 온 쪽은 앞의 결과가 확정된 뒤에 다시 센다.
--
-- JWT 가 없는 관리 작업과 service_role 은 통과시킨다(protect_is_admin 과 같은 기준). 계정을 지우면 멤버십이 같이
-- 지워지는데, 이 길까지 막으면 마지막 owner 인 계정은 지울 수 없다.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_role = 'owner'
     and (tg_op = 'DELETE' or new.org_role <> 'owner')
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    perform 1 from public.organizations where id = old.org_id for update;
    if not exists (
      select 1 from public.memberships
      where org_id = old.org_id and org_role = 'owner' and user_id <> old.user_id
    ) then
      raise exception '조직에는 owner 가 한 명 이상 있어야 합니다'
        using errcode = 'P0001', hint = 'last_owner';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists memberships_protect_last_owner on public.memberships;
create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function public.protect_last_owner();

-- 초대를 넣기 전에 본다: 개인 조직에는 초대하지 않고, 이미 멤버인 이메일(자기 이메일 포함)도 초대하지 않는다.
-- 정책으로 쓰면 invitations → organizations → invitations 로 정책이 서로를 불러 재귀가 된다. 그래서 트리거로 막는다.
create or replace function public.check_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations where id = new.org_id and personal_owner_id is not null) then
    raise exception '개인 조직에는 초대할 수 없습니다'
      using errcode = 'P0001', hint = 'personal_org';
  end if;
  if exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = new.org_id and lower(p.email) = new.email
  ) then
    raise exception '이미 멤버입니다'
      using errcode = 'P0001', hint = 'already_member';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_check on public.invitations;
create trigger invitations_check
  before insert on public.invitations
  for each row execute function public.check_invitation();

-- 같은 이메일을 다시 초대하면(역할을 다시 적는 update) 만료를 7일로 새로 늘린다. 화면은 만료일을 보내지 않는다.
create or replace function public.renew_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.expires_at := now() + interval '7 days';
  return new;
end;
$$;

drop trigger if exists invitations_renew on public.invitations;
create trigger invitations_renew
  before update on public.invitations
  for each row execute function public.renew_invitation();

-- 초대를 수락해 멤버가 되면 그 초대를 지운다. 수락(멤버십 넣기)과 같은 트랜잭션이라 둘 중 하나만 남는 일이 없다.
create or replace function public.clear_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.invitations i
  using public.profiles p
  where p.id = new.user_id and i.org_id = new.org_id and i.email = lower(p.email);
  return new;
end;
$$;

drop trigger if exists memberships_clear_accepted_invitation on public.memberships;
create trigger memberships_clear_accepted_invitation
  after insert on public.memberships
  for each row execute function public.clear_accepted_invitation();

-- ────────────────────────────────────────────────────────────────
-- 6. 권한과 정책
--
-- 표마다 기본 권한을 전부 거두고 필요한 것만 다시 준다. 쓰기는 열 단위로 연다(memos·profiles 견본과 같다).
-- 로그아웃한 사람(anon)은 아무것도 못 한다.
-- ────────────────────────────────────────────────────────────────

-- organizations: 멤버와 초대받은 사람이 읽고, 누구나 팀을 만든다. 이름 바꾸기·삭제는 이번 견본에 없다.
revoke all on table public.organizations from anon, authenticated, public;
grant select on table public.organizations to authenticated;
grant insert (slug, name) on table public.organizations to authenticated;

drop policy if exists "멤버는 조직 읽기" on public.organizations;
create policy "멤버는 조직 읽기"
  on public.organizations for select
  to authenticated
  using (id in (select public.my_org_ids()));

-- 수락하기 전에 어느 조직의 초대인지 보여 주려고 연다.
drop policy if exists "초대받은 사람은 조직 읽기" on public.organizations;
create policy "초대받은 사람은 조직 읽기"
  on public.organizations for select
  to authenticated
  using (
    id in (
      select i.org_id from public.invitations i
      where i.email = lower((select auth.jwt() ->> 'email'))
    )
  );

-- personal_owner_id 는 열 권한이 없어 넣을 수 없다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "팀 만들기" on public.organizations;
create policy "팀 만들기"
  on public.organizations for insert
  to authenticated
  with check (personal_owner_id is null);

-- memberships: 같은 조직의 멤버끼리 읽고, 초대받은 사람만 스스로 들어오고, owner 가 역할을 바꾸고 내보낸다.
revoke all on table public.memberships from anon, authenticated, public;
grant select, delete on table public.memberships to authenticated;
grant insert (org_id, user_id, org_role) on table public.memberships to authenticated;
grant update (org_role) on table public.memberships to authenticated;

drop policy if exists "같은 조직 멤버십 읽기" on public.memberships;
create policy "같은 조직 멤버십 읽기"
  on public.memberships for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- 들어오는 길은 초대 수락 하나다. 내 이메일로 온, 만료되지 않은 초대가 있는 조직에 그 역할로만 들어온다.
drop policy if exists "초대 수락" on public.memberships;
create policy "초대 수락"
  on public.memberships for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.invitations i
      where i.org_id = memberships.org_id
        and i.org_role = memberships.org_role
        and i.email = lower((select auth.jwt() ->> 'email'))
        and i.expires_at > now()
    )
  );

drop policy if exists "owner 는 역할 변경" on public.memberships;
create policy "owner 는 역할 변경"
  on public.memberships for update
  to authenticated
  using (org_id in (select public.my_owner_org_ids()))
  with check (org_id in (select public.my_owner_org_ids()));

drop policy if exists "owner 는 내보내고 멤버는 스스로 나가기" on public.memberships;
create policy "owner 는 내보내고 멤버는 스스로 나가기"
  on public.memberships for delete
  to authenticated
  using (user_id = (select auth.uid()) or org_id in (select public.my_owner_org_ids()));

-- invitations: owner 가 만들고 읽고 갱신하고 취소한다. 초대받은 사람은 자기 것을 읽고 거절한다(수락은 memberships 의 insert).
revoke all on table public.invitations from anon, authenticated, public;
grant select, delete on table public.invitations to authenticated;
grant insert (org_id, email, org_role) on table public.invitations to authenticated;
grant update (org_role) on table public.invitations to authenticated;

drop policy if exists "owner 는 초대 읽기" on public.invitations;
create policy "owner 는 초대 읽기"
  on public.invitations for select
  to authenticated
  using (org_id in (select public.my_owner_org_ids()));

drop policy if exists "받은 초대 읽기" on public.invitations;
create policy "받은 초대 읽기"
  on public.invitations for select
  to authenticated
  using (email = lower((select auth.jwt() ->> 'email')));

-- invited_by 는 열 권한이 없어 기본값(auth.uid())이 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "owner 는 초대" on public.invitations;
create policy "owner 는 초대"
  on public.invitations for insert
  to authenticated
  with check (org_id in (select public.my_owner_org_ids()) and invited_by = (select auth.uid()));

drop policy if exists "owner 는 초대 갱신" on public.invitations;
create policy "owner 는 초대 갱신"
  on public.invitations for update
  to authenticated
  using (org_id in (select public.my_owner_org_ids()))
  with check (org_id in (select public.my_owner_org_ids()));

drop policy if exists "owner 는 취소하고 받은 사람은 거절" on public.invitations;
create policy "owner 는 취소하고 받은 사람은 거절"
  on public.invitations for delete
  to authenticated
  using (
    org_id in (select public.my_owner_org_ids())
    or email = lower((select auth.jwt() ->> 'email'))
  );

-- profiles: 같은 조직의 멤버끼리 이메일·표시 이름을 읽는다(멤버 목록). is_admin 열도 함께 보인다 —
-- 열 단위로 막으면 본인 화면이 자기 is_admin 을 못 읽는다. 기존 정책(본인·운영자 읽기)은 그대로다.
drop policy if exists "같은 조직 멤버 프로필 읽기" on public.profiles;
create policy "같은 조직 멤버 프로필 읽기"
  on public.profiles for select
  to authenticated
  using (
    id in (
      select m.user_id from public.memberships m
      where m.org_id in (select public.my_org_ids())
    )
  );

-- ────────────────────────────────────────────────────────────────
-- 7. memos 를 조직 단위로
--
-- 이제 메모는 조직의 것이다. 멤버 전원이 읽고 추가하고, 작성자나 owner 가 지운다. user_id 는 작성자를 가리키고,
-- 작성자 계정이 지워져도 팀의 메모는 남는다(on delete set null).
--
-- org_id 의 기본값은 작성자의 개인 조직이다. org_id 를 모르는 옛 앱 빌드도 계속 개인 메모를 추가한다.
-- 기본값은 넣는 사람의 권한으로 계산되고, 자기 개인 조직은 멤버로서 읽을 수 있다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.personal_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.organizations where personal_owner_id = auth.uid();
$$;

revoke execute on function public.personal_org_id() from public, anon, authenticated;
grant execute on function public.personal_org_id() to authenticated;

alter table public.memos
  add column if not exists org_id uuid references public.organizations (id) on delete cascade;

create index if not exists memos_org_id_idx on public.memos (org_id);

alter table public.memos alter column user_id drop not null;
alter table public.memos drop constraint if exists memos_user_id_fkey;
alter table public.memos
  add constraint memos_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

drop policy if exists "본인 메모 읽기" on public.memos;
drop policy if exists "본인 메모 추가" on public.memos;
drop policy if exists "본인 메모 삭제" on public.memos;

drop policy if exists "조직 메모 읽기" on public.memos;
create policy "조직 메모 읽기"
  on public.memos for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- 내 조직에, 내 이름으로만 넣는다.
drop policy if exists "조직 메모 추가" on public.memos;
create policy "조직 메모 추가"
  on public.memos for insert
  to authenticated
  with check (org_id in (select public.my_org_ids()) and user_id = (select auth.uid()));

-- 작성자는 아직 멤버인 조직에서 자기 메모를 지우고, owner 는 자기 조직의 메모를 모두 지운다.
drop policy if exists "작성자나 owner 는 메모 삭제" on public.memos;
create policy "작성자나 owner 는 메모 삭제"
  on public.memos for delete
  to authenticated
  using (
    (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()))
    or org_id in (select public.my_owner_org_ids())
  );

-- ────────────────────────────────────────────────────────────────
-- 8. 이미 있던 계정·메모 채우기
--
-- 가입 트리거보다 먼저 만든 계정(프로필이 없는 계정)의 프로필부터 채운다. 그다음 모든 프로필에 개인 조직을 만들고,
-- 조직이 없는 메모를 작성자의 개인 조직으로 옮긴다. 다시 돌려도 이미 있는 것은 건너뛴다.
-- ────────────────────────────────────────────────────────────────
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

select public.create_personal_org(id) from public.profiles;

update public.memos m
set org_id = o.id
from public.organizations o
where m.org_id is null and o.personal_owner_id = m.user_id;

alter table public.memos alter column org_id set not null;
alter table public.memos alter column org_id set default public.personal_org_id();
