-- ADR-019: 가상 명부는 Auth 계정과 분리한다. 신고 소속은 조직 접근 권한이 아니다.
alter table public.organizations add column if not exists is_demo boolean not null default false;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  source_count integer not null check (source_count >= 0),
  target_count integer not null check (target_count >= 1),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, name),
  unique (id, org_id)
);
alter table public.departments enable row level security;
revoke all on public.departments from anon, authenticated, public;
grant select on public.departments to authenticated;
drop policy if exists "조직 부서 읽기" on public.departments;
create policy "조직 부서 읽기" on public.departments for select to authenticated
  using (org_id in (select public.my_org_ids()));

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, label),
  unique (id, org_id)
);
alter table public.job_titles enable row level security;
revoke all on public.job_titles from anon, authenticated, public;
grant select on public.job_titles to authenticated;
drop policy if exists "조직 직급 읽기" on public.job_titles;
create policy "조직 직급 읽기" on public.job_titles for select to authenticated
  using (org_id in (select public.my_org_ids()));

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_code text not null,
  name text not null check (name ~ '^[가-힣]{3}$'),
  gender text not null check (gender in ('MALE', 'FEMALE')),
  department_id uuid not null,
  job_title_id uuid not null,
  portrait_path text not null,
  is_demo boolean not null default false,
  scoring_eligible boolean not null default false,
  role text not null,
  grade text,
  skills jsonb not null default '[]'::jsonb,
  availability jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, person_code),
  unique (org_id, name),
  foreign key (department_id, org_id) references public.departments(id, org_id),
  foreign key (job_title_id, org_id) references public.job_titles(id, org_id)
);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated, public;
grant select on public.team_members to authenticated;
create index if not exists team_members_department_idx on public.team_members(department_id, org_id);
create index if not exists team_members_job_title_idx on public.team_members(job_title_id, org_id);
drop policy if exists "조직 명부 읽기" on public.team_members;
create policy "조직 명부 읽기" on public.team_members for select to authenticated
  using (org_id in (select public.my_org_ids()));

alter table public.profiles add column if not exists declared_department_id uuid;
alter table public.profiles add column if not exists declared_job_title_id uuid;
alter table public.profiles drop constraint if exists profiles_declared_department_id_fkey;
alter table public.profiles add constraint profiles_declared_department_id_fkey
  foreign key (declared_department_id) references public.departments(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_declared_job_title_id_fkey;
alter table public.profiles add constraint profiles_declared_job_title_id_fkey
  foreign key (declared_job_title_id) references public.job_titles(id) on delete set null;
create index if not exists profiles_declared_department_idx on public.profiles(declared_department_id);
create index if not exists profiles_declared_job_title_idx on public.profiles(declared_job_title_id);
grant update (declared_department_id, declared_job_title_id) on public.profiles to authenticated;

-- 비멤버의 신고도 허용하므로 표 RLS 대신 고정 회사 카탈로그만 조회한다.
-- 이 트리거는 쓰기 권한을 넓히지 않는다. 실제 UPDATE는 기존 본인·active RLS를 거친다.
create or replace function public.check_declared_employment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.declared_department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.declared_department_id
      and d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
  ) then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
  if new.declared_job_title_id is not null and not exists (
    select 1 from public.job_titles j where j.id = new.declared_job_title_id
      and j.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
  ) then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_declared_employment() from public, anon, authenticated;
drop trigger if exists profiles_check_declared_employment on public.profiles;
create trigger profiles_check_declared_employment
  before insert or update of declared_department_id, declared_job_title_id on public.profiles
  for each row execute function public.check_declared_employment();

-- org-01 UUID는 DNS UUIDv5('sol-radar:org-01')다. 임의 조직·인원·권한은 받거나 반환하지 않는다.
create or replace function public.resolve_solideo_employment(p_department text, p_job_title text)
returns table (department_id uuid, department_code text, department_name text,
  job_title_id uuid, job_title_code text, job_title_label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  return query
    select d.id, d.code, d.name, j.id, j.code, j.label
    from public.departments d join public.job_titles j on j.org_id = d.org_id
    where d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and (d.code = p_department or d.id::text = p_department)
      and (j.code = p_job_title or j.id::text = p_job_title);
  if not found then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.resolve_solideo_employment(text, text) from public, anon, authenticated;
grant execute on function public.resolve_solideo_employment(text, text) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  department uuid;
  job_title uuid;
begin
  -- 키가 둘 다 없는 OAuth만 미완료로 생성한다. null·빈 값·일부 키는 잘못된 신고다.
  if new.raw_user_meta_data ? 'department_code' or new.raw_user_meta_data ? 'job_title_code' then
    select d.id, j.id into department, job_title
    from public.departments d join public.job_titles j on j.org_id = d.org_id
    where d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and d.code = new.raw_user_meta_data ->> 'department_code'
      and j.code = new.raw_user_meta_data ->> 'job_title_code';
    if not found then
      raise exception 'invalid_employment' using errcode = '22023';
    end if;
  end if;
  insert into public.profiles (id, email, display_name, avatar_url, declared_department_id, declared_job_title_id)
  values (new.id, new.email, public.display_name_from_metadata(new.raw_user_meta_data),
    public.avatar_url_from_metadata(new.raw_user_meta_data), department, job_title)
  on conflict (id) do nothing;
  perform public.create_personal_org(new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
