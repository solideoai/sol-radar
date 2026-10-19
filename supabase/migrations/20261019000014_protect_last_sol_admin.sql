-- 사용자 요청이 마지막 업무 ADMIN을 없애 조직 관리를 잠그지 않도록 한다.
-- 기존 owner 보호와 별개다. 조직 행 잠금은 역할 변경·멤버 삭제·계정 탈퇴가 공유한다.
-- JWT 없는 관리 작업·service_role은 seed/관리 경로를 유지한다.
-- 되돌리기는 새 migration에서 트리거/함수를 제거하고 delete_my_account를 이전 정의로 복원한다.
create or replace function public.protect_last_sol_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.sol_role = 'ADMIN'
     and (tg_op = 'DELETE' or new.sol_role <> 'ADMIN')
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    perform 1 from public.organizations where id = old.org_id for update;
    -- 조직 삭제의 cascade는 남겨 둘 조직이 없으므로 보호 대상이 아니다.
    if found and not exists (
      select 1 from public.memberships
      where org_id = old.org_id and sol_role = 'ADMIN' and user_id <> old.user_id
    ) then
      raise exception '조직에는 업무 ADMIN이 한 명 이상 있어야 합니다'
        using errcode = 'P0001', hint = 'last_admin';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.protect_last_sol_admin() from public, anon, authenticated;
drop trigger if exists memberships_protect_last_sol_admin on public.memberships;
create trigger memberships_protect_last_sol_admin
  before update or delete on public.memberships
  for each row execute function public.protect_last_sol_admin();

-- 계정 탈퇴는 아래 검사 뒤 JWT를 비우므로 트리거만으로는 보호할 수 없다.
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
  -- Auth의 삭제 순서와 맞춘다. profiles FK의 KEY SHARE도 막아 검사 뒤 새 조직 가입이 끼어들지 못하게 한다.
  perform 1 from auth.users where id = me for update;
  perform 1 from public.profiles where id = me for update;
  if exists (select 1 from public.profiles where id = me and status = 'suspended') then
    raise exception '정지된 회원은 탈퇴하지 못합니다' using errcode = 'P0001', hint = 'suspended';
  end if;

  -- 여러 조직의 계정 탈퇴도 같은 순서로 잠가 서로 엇갈린 잠금을 피한다.
  perform o.id from public.organizations o
  where o.id in (select m.org_id from public.memberships m where m.user_id = me)
  order by o.id for update;

  if exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = me and m.org_role = 'owner' and o.personal_owner_id is null
      and exists (select 1 from public.memberships other where other.org_id = m.org_id and other.user_id <> me)
      and not exists (
        select 1 from public.memberships other
        where other.org_id = m.org_id and other.user_id <> me and other.org_role = 'owner'
      )
  ) then
    raise exception '다른 멤버가 있는 팀의 유일한 owner 는 탈퇴하지 못합니다'
      using errcode = 'P0001', hint = 'sole_owner';
  end if;
  if exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = me and m.sol_role = 'ADMIN' and o.personal_owner_id is null
      and exists (select 1 from public.memberships other where other.org_id = m.org_id and other.user_id <> me)
      and not exists (
        select 1 from public.memberships other
        where other.org_id = m.org_id and other.user_id <> me and other.sol_role = 'ADMIN'
      )
  ) then
    raise exception '다른 멤버가 있는 팀의 유일한 ADMIN은 탈퇴하지 못합니다'
      using errcode = 'P0001', hint = 'last_admin';
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
