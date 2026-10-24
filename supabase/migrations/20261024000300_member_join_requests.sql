-- 2026-10-24 프로필 사진·명부 연결 2단계(설계 polaris/specs/in-progress/2026-10-24-profile-photo-member-link.md).
-- 가입 신청: 신규 입사자(NEW_HIRE) 또는 기존 가상 직원 연결(EXISTING)을 신청하고, 그 조직 ADMIN 이 승인·거절한다.
-- 신청 대상 조직은 솔리데오(org-01) 하나다(ADR-019 고정 회사). 쓰기는 아래 security definer 함수로만 한다.
-- 감사 기록은 신청 행 자체다(결정자·시각·상태). audit_logs action 은 늘리지 않는다.

-- ── 1. 신청 표 ───────────────────────────────────────────────

create table if not exists public.member_join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('NEW_HIRE', 'EXISTING')),
  team_member_id uuid references public.team_members(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  sol_role text check (sol_role in ('VIEWER', 'ANALYST', 'SALES', 'ADMIN')),
  -- 신청자 사본. 대기 신청자는 아직 조직 멤버가 아니라 관리자가 profiles 를 읽지 못한다(20261014000001 정책).
  applicant_name text not null,
  applicant_email text not null,
  applicant_photo_path text,
  department_id uuid not null,
  job_title_id uuid not null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_join_requests_target check ((kind = 'EXISTING') = (team_member_id is not null)),
  constraint member_join_requests_department_fkey
    foreign key (department_id, org_id) references public.departments(id, org_id),
  constraint member_join_requests_job_title_fkey
    foreign key (job_title_id, org_id) references public.job_titles(id, org_id)
);
comment on table public.member_join_requests is
  'Join requests to the fixed company roster; written only by submit/decide functions.';

create unique index if not exists member_join_requests_pending_key
  on public.member_join_requests(org_id, user_id) where status = 'PENDING';
create index if not exists member_join_requests_user_idx on public.member_join_requests(user_id);
create index if not exists member_join_requests_member_idx
  on public.member_join_requests(team_member_id);
create index if not exists member_join_requests_department_idx
  on public.member_join_requests(department_id, org_id);
create index if not exists member_join_requests_job_title_idx
  on public.member_join_requests(job_title_id, org_id);
create index if not exists member_join_requests_decided_by_idx
  on public.member_join_requests(decided_by);

drop trigger if exists member_join_requests_touch_updated_at on public.member_join_requests;
create trigger member_join_requests_touch_updated_at
  before update on public.member_join_requests
  for each row execute function public.touch_updated_at();

alter table public.member_join_requests enable row level security;
revoke all on public.member_join_requests from anon, authenticated, public;
grant select on public.member_join_requests to authenticated;

drop policy if exists "본인 가입 신청 읽기" on public.member_join_requests;
create policy "본인 가입 신청 읽기" on public.member_join_requests for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "ADMIN 은 조직 가입 신청 읽기" on public.member_join_requests;
create policy "ADMIN 은 조직 가입 신청 읽기" on public.member_join_requests for select to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN'])));

-- ── 2. 기존 직원 찾기 ────────────────────────────────────────
-- 부서 명부 전체를 보여 주지 않는다(설계 C3). 부서·이름이 정확히 맞는 미연결 가상 직원 하나만 돌려준다.

create or replace function public.find_unlinked_member(p_department text, p_name text)
returns table (id uuid, person_code text, name text, job_title_label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  return query
    select m.id, m.person_code, m.name, j.label
    from public.team_members m
    join public.departments d on d.id = m.department_id and d.org_id = m.org_id
    join public.job_titles j on j.id = m.job_title_id and j.org_id = m.org_id
    where m.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and m.is_demo
      and m.user_id is null
      and d.code = p_department
      and m.name = btrim(p_name)
    order by m.person_code
    limit 1;
end;
$$;
revoke execute on function public.find_unlinked_member(text, text) from public, anon, authenticated;
grant execute on function public.find_unlinked_member(text, text) to authenticated;

-- ── 3. 신청하기 ──────────────────────────────────────────────
-- 대기 중인 내 신청이 있으면 그 행을 새 값으로 고친다. 반려된 뒤에는 새 행으로 다시 신청한다(설계 C5).

create or replace function public.submit_join_request(
  p_kind text,
  p_team_member uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  solideo constant uuid := 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid;
  profile public.profiles%rowtype;
  request_id uuid;
begin
  if uid is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  if p_kind is null or p_kind not in ('NEW_HIRE', 'EXISTING') then
    raise exception 'invalid_kind' using errcode = 'P0001', hint = 'invalid_kind';
  end if;
  select * into profile from public.profiles p where p.id = uid;
  if profile.display_name is null
    or profile.declared_department_id is null
    or profile.declared_job_title_id is null then
    raise exception 'profile_incomplete' using errcode = 'P0001', hint = 'profile_incomplete';
  end if;
  if exists (select 1 from public.team_members m where m.user_id = uid) then
    raise exception 'already_linked' using errcode = 'P0001', hint = 'already_linked';
  end if;
  if p_kind = 'EXISTING' and not exists (
    select 1 from public.team_members m
    where m.id = p_team_member
      and m.org_id = solideo
      and m.is_demo
      and m.user_id is null
      and m.name = btrim(p_name)
  ) then
    raise exception 'invalid_member' using errcode = 'P0001', hint = 'invalid_member';
  end if;

  update public.member_join_requests r
  set kind = p_kind,
      team_member_id = case when p_kind = 'EXISTING' then p_team_member end,
      applicant_name = profile.display_name,
      applicant_email = coalesce(profile.email, ''),
      applicant_photo_path = profile.photo_path,
      department_id = profile.declared_department_id,
      job_title_id = profile.declared_job_title_id
  where r.org_id = solideo and r.user_id = uid and r.status = 'PENDING'
  returning r.id into request_id;
  if request_id is null then
    insert into public.member_join_requests (
      org_id, user_id, kind, team_member_id, applicant_name, applicant_email,
      applicant_photo_path, department_id, job_title_id
    ) values (
      solideo, uid, p_kind, case when p_kind = 'EXISTING' then p_team_member end,
      profile.display_name, coalesce(profile.email, ''), profile.photo_path,
      profile.declared_department_id, profile.declared_job_title_id
    )
    returning id into request_id;
  end if;
  return request_id;
end;
$$;
revoke execute on function public.submit_join_request(text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_join_request(text, uuid, text) to authenticated;

-- ── 4. 승인·거절 ─────────────────────────────────────────────
-- 한 트랜잭션: 멤버십(없을 때만) → 명부 연결 또는 새 직원 → 신청 상태. 하나라도 실패하면 아무것도 남지 않는다.
-- 이미 멤버인 계정(U10)은 멤버십·업무 역할을 바꾸지 않고 연결만 한다.

create or replace function public.decide_join_request(
  p_request uuid,
  p_approve boolean,
  p_sol_role text default 'VIEWER'
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  req public.member_join_requests%rowtype;
  profile public.profiles%rowtype;
  target public.team_members%rowtype;
  role_after text;
begin
  if uid is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  select * into req from public.member_join_requests r where r.id = p_request for update;
  -- 없는 신청과 남의 조직 신청은 같은 답을 준다(존재를 드러내지 않는다).
  if req.id is null
    or req.org_id not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception 'forbidden' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if req.status <> 'PENDING' then
    raise exception 'request_not_pending' using errcode = 'P0001', hint = 'request_not_pending';
  end if;

  if not coalesce(p_approve, false) then
    update public.member_join_requests
    set status = 'REJECTED', decided_by = uid, decided_at = now()
    where id = req.id;
    return 'REJECTED';
  end if;

  if p_sol_role is null or p_sol_role not in ('VIEWER', 'ANALYST', 'SALES', 'ADMIN') then
    raise exception 'invalid_sol_role' using errcode = 'P0001', hint = 'invalid_sol_role';
  end if;
  select * into profile from public.profiles p where p.id = req.user_id;
  if exists (select 1 from public.team_members m where m.user_id = req.user_id) then
    raise exception 'already_linked' using errcode = 'P0001', hint = 'already_linked';
  end if;

  if not exists (
    select 1 from public.memberships ms
    where ms.org_id = req.org_id and ms.user_id = req.user_id
  ) then
    insert into public.memberships (org_id, user_id, org_role, sol_role)
    values (req.org_id, req.user_id, 'member', p_sol_role);
  end if;

  if req.kind = 'NEW_HIRE' then
    -- next_new_hire_person_code 가 번호 잠금(pg_advisory_xact_lock)을 잡는다.
    insert into public.team_members (
      org_id, person_code, name, department_id, job_title_id, is_demo, user_id, photo_path
    ) values (
      req.org_id,
      public.next_new_hire_person_code(req.org_id),
      coalesce(profile.display_name, req.applicant_name),
      coalesce(profile.declared_department_id, req.department_id),
      coalesce(profile.declared_job_title_id, req.job_title_id),
      false,
      req.user_id,
      profile.photo_path
    );
  else
    -- 같은 직원에게 대기 신청이 둘이면 먼저 승인된 것만 연결된다.
    update public.team_members m
    set user_id = req.user_id, photo_path = coalesce(m.photo_path, profile.photo_path)
    where m.id = req.team_member_id and m.user_id is null
    returning * into target;
    if target.id is null then
      raise exception 'member_taken' using errcode = 'P0001', hint = 'member_taken';
    end if;
    -- 승인되면 부서·직급은 명부 값을 따른다(U6).
    update public.profiles
    set declared_department_id = target.department_id, declared_job_title_id = target.job_title_id
    where id = req.user_id;
  end if;

  select ms.sol_role into role_after from public.memberships ms
  where ms.org_id = req.org_id and ms.user_id = req.user_id;
  update public.member_join_requests
  set status = 'APPROVED', sol_role = role_after, decided_by = uid, decided_at = now()
  where id = req.id;
  return 'APPROVED';
end;
$$;
revoke execute on function public.decide_join_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_join_request(uuid, boolean, text) to authenticated;

-- ── 5. 사진 ──────────────────────────────────────────────────

-- 신청 뒤에 사진을 바꿔도 관리자 승인 표가 따라가도록 내 대기 신청의 사진 사본도 바꾼다.
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
  update public.member_join_requests set applicant_photo_path = p_path
  where user_id = uid and status = 'PENDING';
end;
$$;
revoke execute on function public.set_my_photo(text) from public, anon, authenticated;
grant execute on function public.set_my_photo(text) to authenticated;

-- 대기 신청자의 사진은 그 조직 ADMIN 이 승인 표에서 본다(설계 C14).
drop policy if exists "profile_photos_read" on storage.objects;
create policy "profile_photos_read" on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (select public.is_active_user())
  and (
    (split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text)
    or exists (
      select 1 from public.team_members m
      where m.photo_path = storage.objects.name
        and m.org_id in (select public.my_org_ids())
    )
    or exists (
      select 1 from public.member_join_requests r
      where r.applicant_photo_path = storage.objects.name
        and r.status = 'PENDING'
        and r.org_id in (select public.my_sol_org_ids(array['ADMIN']))
    )
  )
);
