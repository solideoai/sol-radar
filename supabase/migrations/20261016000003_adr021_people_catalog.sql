-- ADR-021: 기존 TEAM/직원 식별자는 보존하고 운영 명부와 점수 입력을 분리한다.
alter table public.departments add column if not exists kind text default 'TEAM';
alter table public.departments add column if not exists parent_id uuid;
alter table public.departments alter column source_count drop not null;
alter table public.departments alter column target_count drop not null;
alter table public.departments drop constraint if exists departments_kind_check;
alter table public.departments add constraint departments_kind_check
  check (kind is null or kind in ('DIVISION', 'GROUP', 'TEAM'));
alter table public.departments drop constraint if exists departments_kind_counts_check;
alter table public.departments add constraint departments_kind_counts_check check (
  (coalesce(kind, 'TEAM') = 'TEAM' and target_count is not null and target_count >= 1
    and source_count is not null and source_count >= 0)
  or (coalesce(kind, 'TEAM') in ('DIVISION', 'GROUP') and target_count is null and source_count is null)
);
alter table public.departments drop constraint if exists departments_parent_org_fkey;
alter table public.departments add constraint departments_parent_org_fkey
  foreign key (parent_id, org_id) references public.departments(id, org_id);
create index if not exists departments_parent_idx on public.departments(parent_id, org_id);

-- 부모뿐 아니라 부모의 종류 변경도 검사한다. 종류가 항상 상향하므로 순환/깊이4도 불가능하다.
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
    if child_kind in ('DIVISION', 'GROUP') and exists (
      select 1 from public.team_members m where m.department_id = new.id and m.org_id = new.org_id
    ) then
      raise exception 'employee_requires_team' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_department_hierarchy() from public, anon, authenticated;
drop trigger if exists departments_check_hierarchy on public.departments;
create trigger departments_check_hierarchy before insert or update of kind, parent_id, org_id, id
  on public.departments for each row execute function public.check_department_hierarchy();

create or replace function public.check_employee_department()
returns trigger language plpgsql set search_path = '' as $$
declare department_kind text;
begin
  select coalesce(d.kind, 'TEAM') into department_kind from public.departments d
    where d.id = new.department_id and d.org_id = new.org_id for share;
  if found and department_kind <> 'TEAM' then
    raise exception 'employee_requires_team' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_employee_department() from public, anon, authenticated;
drop trigger if exists team_members_check_department on public.team_members;
create trigger team_members_check_department before insert or update of department_id, org_id
  on public.team_members for each row execute function public.check_employee_department();

alter table public.team_members add column if not exists updated_at timestamptz not null default now();
drop trigger if exists team_members_touch_updated_at on public.team_members;
create trigger team_members_touch_updated_at before update on public.team_members
  for each row execute function public.touch_updated_at();

create table if not exists public.team_member_scoring (
  member_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  grade text,
  skills jsonb not null default '[]'::jsonb,
  availability jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (member_id, org_id) references public.team_members(id, org_id) on delete cascade
);
alter table public.team_member_scoring enable row level security;
revoke all on public.team_member_scoring from anon, authenticated, public;
grant select on public.team_member_scoring to authenticated;
create index if not exists team_member_scoring_org_idx on public.team_member_scoring(org_id);
drop policy if exists "조직 점수 인력 읽기" on public.team_member_scoring;
create policy "조직 점수 인력 읽기" on public.team_member_scoring for select to authenticated
  using (org_id in (select public.my_org_ids()));

-- 마이그레이션 실행기는 파일 전체를 한 트랜잭션으로 실행한다.
-- 재실행에서는 옛 컬럼이 없으므로 backfill을 생략한다. 충돌은 덮지 않고 동일성 검사로 실패시킨다.
do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'team_members' and column_name = 'scoring_eligible') then
    insert into public.team_member_scoring(member_id, org_id, role, grade, skills, availability, created_at)
      select id, org_id, role, grade, skills, availability, created_at
      from public.team_members where scoring_eligible
      on conflict (member_id) do nothing;
    if exists (
      (select id, org_id, role, grade, skills, availability, created_at from public.team_members where scoring_eligible
       except select member_id, org_id, role, grade, skills, availability, created_at from public.team_member_scoring)
      union all
      (select member_id, org_id, role, grade, skills, availability, created_at from public.team_member_scoring
       except select id, org_id, role, grade, skills, availability, created_at from public.team_members where scoring_eligible)
    ) then
      raise exception 'people_scoring_backfill_mismatch';
    end if;
    alter table public.team_members drop column scoring_eligible, drop column role, drop column grade,
      drop column skills, drop column availability;
  end if;
end;
$$;
