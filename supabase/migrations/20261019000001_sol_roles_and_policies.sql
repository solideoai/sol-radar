-- 20261019000001_sol_roles_and_policies — 업무 역할(sol_role)을 초대·정책·보호 트리거까지 넓힌다.
--
-- 근거: docs/04-DATABASE.md §3.1·§7 순서 1 나머지, docs/09-SECURITY.md RBAC, docs/16-DECISIONS.md ADR-021
-- (구성원·초대 정책을 owner 기준에서 sol_role='ADMIN' 기준으로 바꾼다).
-- 전제: 20261018000001_people_business_roles 가 memberships.sol_role 을 만들었다(feat/people-read 브랜치의 파일 그대로).
--
-- 이 파일에 든 것:
--   1. invitations.sol_role — 초대할 때 업무 역할을 정한다. 기본 VIEWER. ADMIN 이 넣고 고친다.
--   2. my_sol_org_ids(roles) — 내가 roles 중 하나의 업무 역할로 속한 조직 id 목록. 정책 도우미(security definer).
--   3. 팀을 만든 사람은 owner + ADMIN 이 된다. ADMIN 이 한 명도 없는 팀 조직은 owner 를 ADMIN 으로 채운다(한 번).
--   4. 구성원·초대 정책을 ADMIN 기준으로 바꾼다. 초대 수락은 초대의 sol_role 을 멤버십으로 옮긴다
--      (BEFORE INSERT 트리거가 채우고, 정책이 초대와 같은지 다시 확인한다).
--   5. protect_sol_role — 그 조직 ADMIN 이 아닌 사람의 업무 역할 변경을 거절한다. service role·JWT 없는 관리 작업은 통과.
--
-- 바꾸지 않는 것: organizations 의 이름 바꾸기·팀 지우기(owner, 20261015000002)와 tasks 삭제(만든 사람·owner)는
-- 템플릿 정책 그대로다(04 §3.1 "템플릿 정책 그대로"). 마지막 owner 보호(protect_last_owner)도 그대로다.
--
-- 되돌리기(새 마이그레이션으로): 아래 정책을 20261014000001·20261015000001 의 owner 기준 본문으로 다시 만들고,
-- 트리거 memberships_apply_invitation_sol_role·memberships_protect_sol_role 과 함수 apply_invitation_sol_role()·
-- protect_sol_role()·my_sol_org_ids(text[]) 를 지우고, add_team_owner()·check_invitation() 을 이전 본문으로 되돌리고,
-- invitations.sol_role 열을 drop 한다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. invitations.sol_role
-- ────────────────────────────────────────────────────────────────
alter table public.invitations add column if not exists sol_role text not null default 'VIEWER';
alter table public.invitations drop constraint if exists invitations_sol_role_check;
alter table public.invitations
  add constraint invitations_sol_role_check check (sol_role in ('ADMIN', 'SALES', 'ANALYST', 'VIEWER'));

-- 초대를 만들고 다시 적는 사람(아래 4절의 ADMIN 정책)이 업무 역할도 정한다.
grant insert (sol_role), update (sol_role) on public.invitations to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. my_sol_org_ids(roles) — 정책 도우미
--
-- 템플릿 my_org_ids() 와 같은 모양이다: security definer 라 memberships 의 정책을 다시 거치지 않고(재귀 차단),
-- 부른 사람 자신의 조직만 돌려주며, 정지된 사용자에게는 빈 목록이다. 로그인 역할만 부른다.
-- 정책에서는 org_id in (select public.my_sol_org_ids(array['ADMIN'])) 로 쓴다. 바깥 행과 상관없는 하위 질의라
-- 질의마다 한 번 계산된다. scripts/db-verify.mjs 의 허용 목록에 이유와 함께 올라 있다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.my_sol_org_ids(roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.status = 'active' and m.sol_role = any(roles);
$$;

revoke execute on function public.my_sol_org_ids(text[]) from public, anon, authenticated;
grant execute on function public.my_sol_org_ids(text[]) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. 팀을 만든 사람은 ADMIN
--
-- 구성원 관리가 ADMIN 기준이 되므로, 새 팀에 ADMIN 이 없으면 아무도 초대하지 못하는 조직이 된다.
-- 그래서 팀을 만든 사람(첫 owner)에게 ADMIN 을 함께 준다. 20261014000001 의 add_team_owner 에 sol_role 만 더한다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.add_team_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    insert into public.memberships (org_id, user_id, org_role, sol_role)
    values (new.id, auth.uid(), 'owner', 'ADMIN');
  end if;
  return new;
end;
$$;

revoke execute on function public.add_team_owner() from public, anon, authenticated;

-- 이미 있는 팀 조직 가운데 ADMIN 이 한 명도 없는 곳은 owner 를 ADMIN 으로 채운다. 정책이 바뀐 뒤에도 그 팀을
-- 관리할 사람이 남게 하려는 한 번의 채우기다. 개인 조직(personal_owner_id 가 있는 조직)은 건드리지 않는다.
-- 다시 돌리면 ADMIN 이 이미 있어 아무것도 바꾸지 않는다.
update public.memberships m
set sol_role = 'ADMIN'
from public.organizations o
where o.id = m.org_id
  and o.personal_owner_id is null
  and m.org_role = 'owner'
  and not exists (select 1 from public.memberships a where a.org_id = m.org_id and a.sol_role = 'ADMIN');

-- ────────────────────────────────────────────────────────────────
-- 4. 구성원·초대 정책 — ADMIN 기준 (ADR-021)
--
-- 20261014000001 의 owner 정책을 지우고 같은 모양으로 ADMIN 정책을 만든다. 받은 사람 쪽(받은 초대 읽기·거절·
-- 스스로 나가기)은 그대로다.
-- ────────────────────────────────────────────────────────────────

-- memberships: ADMIN 이 조직 역할(org_role)과 업무 역할(sol_role)을 바꾸고 내보낸다.
-- 20261018000001 이 거둔 sol_role 의 update 권한을 다시 준다(insert 권한은 계속 없다 — 초대 수락 트리거가 채운다).
grant update (sol_role) on public.memberships to authenticated;

drop policy if exists "owner 는 역할 변경" on public.memberships;
drop policy if exists "ADMIN 은 역할 변경" on public.memberships;
create policy "ADMIN 은 역할 변경"
  on public.memberships for update
  to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN'])))
  with check (org_id in (select public.my_sol_org_ids(array['ADMIN'])));

drop policy if exists "owner 는 내보내고 멤버는 스스로 나가기" on public.memberships;
drop policy if exists "ADMIN 은 내보내고 멤버는 스스로 나가기" on public.memberships;
create policy "ADMIN 은 내보내고 멤버는 스스로 나가기"
  on public.memberships for delete
  to authenticated
  using (user_id = (select auth.uid()) or org_id in (select public.my_sol_org_ids(array['ADMIN'])));

-- 초대 수락: 초대의 sol_role 이 멤버십으로 옮겨진다. 화면 역할에는 sol_role 의 insert 권한이 없으므로 값은 아래
-- 트리거가 초대에서 읽어 채운다. 정책은 그 값이 초대와 같은지 한 번 더 본다(두 번째 잠금).
create or replace function public.apply_invitation_sol_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_role text;
begin
  -- 웹·앱에서 온 요청(JWT 가 있고 service_role 이 아닌 것)만 초대를 본다. 관리 작업·seed·worker 는 넣는 값을 그대로 쓴다.
  if auth.jwt() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    select i.sol_role into invited_role
    from public.invitations i
    where i.org_id = new.org_id
      and i.org_role = new.org_role
      and i.email = lower(auth.jwt() ->> 'email')
      and i.expires_at > now();
    -- 초대가 없으면 값을 바꾸지 않는다. 팀을 만든 사람의 첫 멤버십(add_team_owner)은 여기를 그대로 지나고,
    -- 그 밖의 넣기는 "초대 수락" 정책이 거절한다.
    if found then
      new.sol_role := invited_role;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.apply_invitation_sol_role() from public, anon, authenticated;

drop trigger if exists memberships_apply_invitation_sol_role on public.memberships;
create trigger memberships_apply_invitation_sol_role
  before insert on public.memberships
  for each row execute function public.apply_invitation_sol_role();

-- 20261015000001 의 "초대 수락" 과 같고, 초대의 sol_role 과 같은지도 본다.
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
        and i.sol_role = memberships.sol_role
        and i.email = lower((select auth.jwt() ->> 'email'))
        and i.expires_at > now()
    )
  );

-- invitations: ADMIN 이 만들고 읽고 갱신하고 취소한다. 초대받은 사람은 자기 것을 읽고 거절한다(그대로).
drop policy if exists "owner 는 초대 읽기" on public.invitations;
drop policy if exists "ADMIN 은 초대 읽기" on public.invitations;
create policy "ADMIN 은 초대 읽기"
  on public.invitations for select
  to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN'])));

-- invited_by 는 열 권한이 없어 기본값(auth.uid())이 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "owner 는 초대" on public.invitations;
drop policy if exists "ADMIN 은 초대" on public.invitations;
create policy "ADMIN 은 초대"
  on public.invitations for insert
  to authenticated
  with check (org_id in (select public.my_sol_org_ids(array['ADMIN'])) and invited_by = (select auth.uid()));

drop policy if exists "owner 는 초대 갱신" on public.invitations;
drop policy if exists "ADMIN 은 초대 갱신" on public.invitations;
create policy "ADMIN 은 초대 갱신"
  on public.invitations for update
  to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN'])))
  with check (org_id in (select public.my_sol_org_ids(array['ADMIN'])));

drop policy if exists "owner 는 취소하고 받은 사람은 거절" on public.invitations;
drop policy if exists "ADMIN 은 취소하고 받은 사람은 거절" on public.invitations;
create policy "ADMIN 은 취소하고 받은 사람은 거절"
  on public.invitations for delete
  to authenticated
  using (
    org_id in (select public.my_sol_org_ids(array['ADMIN']))
    or email = lower((select auth.jwt() ->> 'email'))
  );

-- 20261014000003 의 check_invitation 과 같고, 이유를 말해 주는 대상을 "그 조직의 owner 또는 ADMIN" 으로 넓힌다.
-- 둘 다 아닌 요청은 판단하지 않고 넘겨 정책이 같은 오류로 거절하게 한다(멤버 여부·개인 조직 여부를 알려 주지 않는다).
create or replace function public.check_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and new.org_id not in (select public.my_owner_org_ids())
     and new.org_id not in (select public.my_sol_org_ids(array['ADMIN'])) then
    return new;
  end if;
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

-- ────────────────────────────────────────────────────────────────
-- 5. protect_sol_role — 업무 역할 변경의 두 번째 잠금
--
-- 첫 잠금은 위의 정책(ADMIN 만 update)이다. 이 트리거는 다른 정책이 같은 표의 update 를 열어 두었을 때를 대비한다.
-- 템플릿 protect_is_admin 과 같은 기준이다: JWT 가 있는 요청 중 service_role 이 아니고 그 조직 ADMIN 이 아닌 사람의
-- 변경은 거절하고, JWT 가 없는 관리 작업(SQL 편집기·마이그레이션·seed)과 service_role(worker)은 통과시킨다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.protect_sol_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sol_role is distinct from old.sol_role
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and old.org_id not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception '업무 역할은 그 조직의 ADMIN 만 바꿉니다'
      using errcode = '42501', hint = 'sol_role_admin_only';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_sol_role() from public, anon, authenticated;

drop trigger if exists memberships_protect_sol_role on public.memberships;
create trigger memberships_protect_sol_role
  before update of sol_role on public.memberships
  for each row execute function public.protect_sol_role();
