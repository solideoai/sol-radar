-- ADR-063: 본부·그룹에도 직원을 직접 둔다(ADR-021의 "직원은 팀에만" 조항 개정).
-- 계층 규칙(본부 > 그룹 > 팀, 팀 아래 부서 없음)과 본부·그룹의 인원 칸(null)은 그대로다.

drop trigger if exists team_members_check_department on public.team_members;
drop function if exists public.check_employee_department();

-- 종류를 바꿀 때 소속 직원이 있으면 막던 조항만 뺀다. 나머지는 20261016000003과 같다.
create or replace function public.check_department_hierarchy()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_kind text;
  child_kind text := coalesce(new.kind, 'TEAM');
begin
  if new.parent_id is not null then
    if new.parent_id = new.id or child_kind = 'DIVISION' then
      raise exception 'department_hierarchy' using errcode = '23514';
    end if;
    select coalesce(d.kind, 'TEAM') into parent_kind from public.departments d
      where d.id = new.parent_id and d.org_id = new.org_id for share;
    -- 없는 부모/다른 조직은 복합 FK가 거절한다.
    if found and (parent_kind = 'TEAM' or (child_kind = 'GROUP' and parent_kind <> 'DIVISION')) then
      raise exception 'department_hierarchy' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    if exists (select 1 from public.departments d where d.parent_id = new.id and d.org_id = new.org_id
      and (child_kind = 'TEAM' or (coalesce(d.kind, 'TEAM') = 'GROUP' and child_kind <> 'DIVISION'))) then
      raise exception 'department_hierarchy' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_department_hierarchy() from public, anon, authenticated;

-- 직원 추가·이동 RPC: 본부·그룹도 받는다. 부서·직급이 이 조직의 것인지만 본다.
create or replace function public.assert_team_member_placement(
  p_org_id uuid,
  p_department_id uuid,
  p_job_title_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id and d.org_id = p_org_id
  ) then
    raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_job_title_id is not null and not exists (
    select 1 from public.job_titles j where j.id = p_job_title_id and j.org_id = p_org_id
  ) then
    raise exception 'JOB_TITLE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.assert_team_member_placement(uuid, uuid, uuid) from public, anon, authenticated;
