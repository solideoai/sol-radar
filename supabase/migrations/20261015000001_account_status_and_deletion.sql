-- 20261015000001_account_status_and_deletion — 회원 상태(정지)·탈퇴·제공자 프로필.
--
-- 로그인·세션·토큰·연결된 로그인 수단(auth.identities)은 Supabase Auth 가 맡는다. 이 파일은 그 위에 회원 관리만 더한다:
--   1. profiles 의 새 열 — 이미지(avatar_url)·상태(status)·고친 시각(updated_at). 화면 역할은 셋 다 고치지 못한다.
--   2. 가입 때 제공자(구글·카카오·네이버)가 준 이름·이미지로 프로필을 채운다.
--   3. 정지 — 운영자 함수 하나가 상태·로그인 차단(auth.users.banned_until)·세션 끊기를 함께 한다.
--      정지된 사람에게는 정책 도우미가 아무 조직도 돌려주지 않는다(이미 받은 토큰이 만료되기 전에도 데이터가 닫힌다).
--   4. 탈퇴 — 즉시 삭제. 본인 함수 하나가 auth.users 행을 지우고, 프로필·멤버십·개인 조직·세션·연결된 로그인이 연쇄로 지워진다.
--
-- 탈퇴는 지우기만 하고 남겨 두지 않는다(소프트 삭제·유예 기간 없음). 그래서 status 에 deleted 를 두지 않는다.
-- 운영자 여부는 그대로 is_admin 이 정한다. API·화면은 이 값을 role(user·admin)로 바꿔 보인다.

-- ────────────────────────────────────────────────────────────────
-- 1. profiles 의 새 열
-- ────────────────────────────────────────────────────────────────

-- 제공자가 준 이미지 주소. 화면이 그대로 그리므로 https 주소만 받는다(javascript:·data: 같은 값이 들어오지 않게).
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048);

-- 정지(suspended)는 운영자가 정한다. enum 이 아니라 check 제약이다(memberships.org_role 과 같다 — 값을 더할 때 마이그레이션이 가볍다).
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'suspended'));

alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- 화면 역할의 권한은 그대로다: 표 전체 읽기와 display_name 열 하나의 수정뿐(20261013000001). 새 열은 읽기만 열린다.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- status 의 두 번째 잠금. 첫 잠금은 권한이다(화면 역할에 이 열의 update 권한이 없다).
-- protect_is_admin 과 같은 기준이다: 웹·앱의 요청 가운데 운영자가 아닌 사람의 변경은 되돌리고,
-- JWT 가 없는 관리 작업(SQL 편집기·마이그레이션)과 service_role 은 통과시킨다.
create or replace function public.protect_profile_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_admin() then
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_status on public.profiles;
create trigger profiles_protect_status
  before update on public.profiles
  for each row execute function public.protect_profile_status();

-- ────────────────────────────────────────────────────────────────
-- 2. 제공자가 준 이름·이미지
--
-- 간편 로그인으로 가입하면 Supabase Auth 가 제공자의 사용자 정보를 auth.users.raw_user_meta_data 에 적는다
-- (구글 full_name·name·avatar_url·picture, 카카오 name·nickname·avatar_url·picture). 이메일 가입은 이름이 없어 비어 있다.
-- 표시 이름의 규칙(앞뒤 공백 없이 1~40자, profiles_display_name_check)에 맞게 다듬고, 맞출 수 없으면 비워 둔다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.display_name_from_metadata(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(left(btrim(candidate), 40)), '')
  from unnest(array[meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname'])
    with ordinality as c(candidate, position)
  where nullif(btrim(candidate), '') is not null
  order by position
  limit 1;
$$;

-- picture 가 객체(JSON)인 제공자도 있다. 글자로 꺼냈을 때 https 주소가 아니면 건너뛴다.
create or replace function public.avatar_url_from_metadata(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select candidate
  from unnest(array[meta ->> 'avatar_url', meta ->> 'picture'])
    with ordinality as c(candidate, position)
  where candidate ~ '^https://' and char_length(candidate) <= 2048
  order by position
  limit 1;
$$;

-- 가입 트리거와 아래 채우기만 부른다. 화면 역할이 /rpc 로 부를 일이 없다.
revoke execute on function public.display_name_from_metadata(jsonb) from public, anon, authenticated;
revoke execute on function public.avatar_url_from_metadata(jsonb) from public, anon, authenticated;

-- 가입 트리거를 넓힌다(20261014000001 의 것에 이름·이미지만 더한다).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    public.display_name_from_metadata(new.raw_user_meta_data),
    public.avatar_url_from_metadata(new.raw_user_meta_data)
  )
  on conflict (id) do nothing;
  perform public.create_personal_org(new.id);
  return new;
end;
$$;

-- 이미 가입한 사람도 비어 있는 칸만 채운다. 본인이 정한 표시 이름은 그대로 둔다.
update public.profiles p
set
  display_name = coalesce(p.display_name, public.display_name_from_metadata(u.raw_user_meta_data)),
  avatar_url = coalesce(p.avatar_url, public.avatar_url_from_metadata(u.raw_user_meta_data))
from auth.users u
where u.id = p.id
  and (p.display_name is null or p.avatar_url is null)
  and (
    public.display_name_from_metadata(u.raw_user_meta_data) is not null
    or public.avatar_url_from_metadata(u.raw_user_meta_data) is not null
  );

-- ────────────────────────────────────────────────────────────────
-- 3. 정지
--
-- 정지된 사람은 Supabase Auth 에서 새로 로그인하지도, 토큰을 갱신하지도 못한다(banned_until).
-- 이미 받은 access token 은 만료(기본 1시간)까지 서명이 맞으므로, DB 에서도 닫는다:
--   - 정책 도우미 my_org_ids()·my_owner_org_ids() 가 아무 조직도 돌려주지 않는다 → 조직의 모든 표가 닫힌다.
--   - 조직에 새로 들어가는 두 길(팀 만들기·초대 수락)도 닫는다. 위 도우미는 이미 속한 조직만 보기 때문이다.
--   - is_admin() 이 false 다 → 운영자 정책이 닫힌다.
--   - 본인 프로필의 표시 이름을 고치지 못한다. 본인 프로필은 읽는다(화면이 정지 안내를 보이려고).
--   팀에서 스스로 나가기·초대 거절은 그대로 둔다(빠져나가는 일이라 막을 이유가 없다).
-- ────────────────────────────────────────────────────────────────

-- 20261013000001 의 것과 같고, 정지된 운영자는 운영자가 아니다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin and status = 'active' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- 20261014000001 의 것과 같고, 정지된 사람에게는 빈 목록이다. 멤버십은 프로필을 가리키므로 같은 키로 붙여 읽는다.
create or replace function public.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.status = 'active';
$$;

create or replace function public.my_owner_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and m.org_role = 'owner' and p.status = 'active';
$$;

-- 지금 로그인한 사람이 활동 중(active)인 회원인가. 아래 두 insert 정책이 부른다.
-- security definer 인 이유는 is_admin() 과 같다(정책 안에서 profiles 를 다시 읽으면 profiles 의 정책이 또 걸린다).
-- 부른 사람 자신의 상태만 돌려주고, 로그인 역할만 실행한다.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select status = 'active' from public.profiles where id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_active_user() from public, anon, authenticated;
grant execute on function public.is_active_user() to authenticated;

-- 20261014000001 의 "팀 만들기"·"초대 수락" 과 같고, 정지된 사람은 막는다.
drop policy if exists "팀 만들기" on public.organizations;
create policy "팀 만들기"
  on public.organizations for insert
  to authenticated
  with check (personal_owner_id is null and (select public.is_active_user()));

drop policy if exists "초대 수락" on public.memberships;
create policy "초대 수락"
  on public.memberships for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and exists (
      select 1 from public.invitations i
      where i.org_id = memberships.org_id
        and i.org_role = memberships.org_role
        and i.email = lower((select auth.jwt() ->> 'email'))
        and i.expires_at > now()
    )
  );

drop policy if exists "본인 프로필 수정" on public.profiles;
create policy "본인 프로필 수정"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id and status = 'active')
  with check ((select auth.uid()) = id and status = 'active');

-- 운영자가 회원을 정지하거나 되돌린다. 자기 자신과 다른 운영자는 바꾸지 못한다(운영자를 멈추려면 먼저 SQL 편집기에서 is_admin 을 끈다).
--
-- 정지하면 세 가지를 한 트랜잭션에 한다: profiles.status, 로그인 차단(auth.users.banned_until), 세션 삭제.
-- 세션을 지우면 그 세션의 refresh token 이 함께 지워져(auth.refresh_tokens → sessions, on delete cascade) 모든 기기의 갱신이 끊긴다.
-- banned_until 은 Supabase 대시보드의 "Ban user" 와 같은 열이다. 무기한(infinity)은 Auth 서버가 읽지 못할 수 있어 100년 뒤로 둔다.
--
-- 오류의 hint 로 이유를 알린다: invalid_status·self·admin_target·not_found. 운영자가 아니면 권한 오류(42501)다.
create or replace function public.admin_set_user_status(target uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '운영자만 회원 상태를 바꿉니다' using errcode = '42501';
  end if;
  if next_status is null or next_status not in ('active', 'suspended') then
    raise exception '회원 상태는 active 나 suspended 입니다'
      using errcode = '22023', hint = 'invalid_status';
  end if;
  if target = auth.uid() then
    raise exception '자기 자신의 상태는 바꾸지 못합니다' using errcode = 'P0001', hint = 'self';
  end if;
  if exists (select 1 from public.profiles where id = target and is_admin) then
    raise exception '운영자의 상태는 바꾸지 못합니다' using errcode = 'P0001', hint = 'admin_target';
  end if;

  update public.profiles set status = next_status where id = target;
  if not found then
    raise exception '회원을 찾지 못했습니다' using errcode = 'P0002', hint = 'not_found';
  end if;

  update auth.users
  set banned_until = case when next_status = 'suspended' then now() + interval '100 years' end
  where id = target;
  if next_status = 'suspended' then
    delete from auth.sessions where user_id = target;
  end if;
end;
$$;

revoke execute on function public.admin_set_user_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. 탈퇴 — 즉시 삭제
--
-- 본인이 부른다. auth.users 행을 지우면 Supabase 의 외래 키가 연결된 로그인(identities)·세션·refresh token 을,
-- 이 저장소의 외래 키가 프로필·멤버십·개인 조직을 함께 지운다. 팀의 작업은 만든 사람·담당자만 비운 채 남는다(20261014000004).
--
-- 다른 멤버가 남는 팀의 유일한 owner 면 거절한다(hint sole_owner) — owner 가 없는 팀이 생긴다. owner 를 넘기거나 팀에서 나간 뒤 다시 한다.
-- 혼자 남은 팀은 넘길 사람이 없으므로 함께 지운다.
-- 정지된 사람도 거절한다(hint suspended). 지우고 같은 소셜 계정으로 다시 가입하면 정지를 빠져나간다.
--
-- 지우는 문장은 JWT 없는 관리 작업으로 돌린다. 마지막 owner 보호(protect_last_owner)는 JWT 가 있는 요청만 막는데,
-- 본인 요청 그대로 지우면 개인 조직의 owner 멤버십이 그 보호에 걸린다. 계정을 지우는 관리 작업과 같은 길이고(20261014000001),
-- 누구를 지울지는 그 전에 JWT 에서 읽어 둔 본인 id 하나뿐이다. set_config 의 세 번째 인자(true)라 이 트랜잭션에서만 비워진다.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception '로그인한 사람만 탈퇴합니다' using errcode = '42501';
  end if;

  if exists (select 1 from public.profiles where id = me and status = 'suspended') then
    raise exception '정지된 회원은 탈퇴하지 못합니다' using errcode = 'P0001', hint = 'suspended';
  end if;

  if exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = me
      and m.org_role = 'owner'
      and o.personal_owner_id is null
      and exists (
        select 1 from public.memberships other where other.org_id = m.org_id and other.user_id <> me
      )
      and not exists (
        select 1 from public.memberships other
        where other.org_id = m.org_id and other.user_id <> me and other.org_role = 'owner'
      )
  ) then
    raise exception '다른 멤버가 있는 팀의 유일한 owner 는 탈퇴하지 못합니다'
      using errcode = 'P0001', hint = 'sole_owner';
  end if;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.organizations o
  where o.personal_owner_id is null
    and exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id = me)
    and not exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id <> me);

  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
