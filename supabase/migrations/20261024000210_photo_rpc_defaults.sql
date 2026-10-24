-- 2026-10-24 프로필 사진 RPC 의 p_path 에 default null 을 더한다(20261024000200 의 본문 그대로).
-- 생성 타입(pnpm db:types)은 기본값 있는 인자만 생략 가능(?:)으로 적는다. 웹은 사진 지우기를 p_path 생략으로 부른다.
-- create or replace 는 기본값을 더할 수 있고 서명(set_my_photo(text)·set_member_photo(uuid, text))은 그대로다.

create or replace function public.set_my_photo(p_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  if p_path is not null
    and p_path !~ ('^users/' || uid::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_photo_path' using errcode = 'P0001', hint = 'invalid_photo_path';
  end if;
  update public.team_members set photo_path = p_path where user_id = uid;
  if not found then
    update public.profiles set photo_path = p_path where id = uid;
  end if;
end;
$$;
revoke execute on function public.set_my_photo(text) from public, anon, authenticated;
grant execute on function public.set_my_photo(text) to authenticated;

-- 관리자의 직원 사진 변경. 그 직원 조직의 ADMIN 만 한다. 없는 직원도 forbidden 으로 답해 존재를 드러내지 않는다.
create or replace function public.set_member_photo(p_member uuid, p_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  select m.org_id into target_org from public.team_members m where m.id = p_member;
  if target_org is null
    or target_org not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception 'forbidden' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_path is not null
    and p_path !~ ('^members/' || p_member::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_photo_path' using errcode = 'P0001', hint = 'invalid_photo_path';
  end if;
  update public.team_members set photo_path = p_path where id = p_member;
end;
$$;
revoke execute on function public.set_member_photo(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_photo(uuid, text) to authenticated;
