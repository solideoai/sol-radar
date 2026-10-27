-- 임원(EXECUTIVE) 업무 역할과 회사 프로필 출처 열.
-- EXECUTIVE = VIEWER 읽기 권한 + 회사 역량 열람. 쓰기 역할 목록(분석 실행·결정·프로젝트 관리)에는 넣지 않는다.
-- 이 파일이 바꾸는 것:
--   1. sol_role CHECK 제약 3개(memberships·invitations·member_join_requests)에 EXECUTIVE 추가.
--   2. 'VIEWER' 가 들어 있는 읽기 함수·정책에 EXECUTIVE 추가. 본문은 각 함수의 최신 정의 그대로다.
--      latest_ingest_run·procurement_source_health: 20261023000200 / procurement_last_scheduled_ingest: 20261025000200 /
--      decide_join_request: 20261025000300 / storage 정책 sol_raw_documents_read: 20261021000701.
--   3. company_profiles 에 sources·public_history(jsonb 배열) 열 추가. 실제 공개 출처 프로필의 인용을 담는다.
-- 그대로인 것: 반환형·security definer·search_path·grant·revoke.
-- 되돌리기: 이 파일을 지우지 않는다(append-only). 새 migration 에서 EXECUTIVE 행을 바꾼 뒤 제약·함수를 이전 정의로 되돌린다.

-- ────────────────────────────────────────────────────────────────
-- 1. sol_role CHECK 제약
-- ────────────────────────────────────────────────────────────────
alter table public.memberships drop constraint memberships_sol_role_check;
alter table public.memberships
  add constraint memberships_sol_role_check
  check (sol_role in ('VIEWER', 'EXECUTIVE', 'ANALYST', 'SALES', 'ADMIN'));

alter table public.invitations drop constraint invitations_sol_role_check;
alter table public.invitations
  add constraint invitations_sol_role_check
  check (sol_role in ('ADMIN', 'SALES', 'ANALYST', 'EXECUTIVE', 'VIEWER'));

alter table public.member_join_requests drop constraint member_join_requests_sol_role_check;
alter table public.member_join_requests
  add constraint member_join_requests_sol_role_check
  check (sol_role in ('VIEWER', 'EXECUTIVE', 'ANALYST', 'SALES', 'ADMIN'));

-- ────────────────────────────────────────────────────────────────
-- 2. 읽기 함수
-- ────────────────────────────────────────────────────────────────
create or replace function public.latest_ingest_run(p_origin text)
returns table(status text,started_at timestamptz,finished_at timestamptz,summary jsonb)
language sql stable security definer set search_path='' as $$
select r.status,r.started_at,r.finished_at,r.summary from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','EXECUTIVE','VIEWER']))
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'))
order by r.started_at desc,r.id desc limit 1;
$$;
revoke all on function public.latest_ingest_run(text) from public,anon,authenticated;
grant execute on function public.latest_ingest_run(text) to authenticated;

create or replace function public.procurement_source_health(p_origin text)
returns table(service_key text,source text,status text,completeness text,started_at timestamptz,
 finished_at timestamptz,last_success_at timestamptz,summary jsonb,fetched_count integer,auth_status text,error_count integer)
language sql stable security definer set search_path='' as $$
select distinct on (coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end))
 coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end),r.source,r.status,r.completeness,
 r.started_at,r.finished_at,
 (select max(s.finished_at) from public.ingest_runs s where s.source=r.source
 and s.service_key is not distinct from r.service_key and s.status='SUCCEEDED' and s.completeness='COMPLETE'),r.summary,r.fetched_count,
 case when exists(select 1 from public.ingest_errors e where e.ingest_run_id=r.id and e.error_code='API_SERVICE_KEY_INVALID') then 'FAILED'
 when r.source<>'fixture' and r.status='SUCCEEDED' and r.completeness='COMPLETE' then 'VERIFIED' else 'NOT_VERIFIED' end,
 (select count(*)::int from public.ingest_errors e where e.ingest_run_id=r.id)
from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','EXECUTIVE','VIEWER']))
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'))
order by coalesce(r.service_key,case r.source when 'g2b' then 'g2b-bid-notice' else 'fixture' end),r.started_at desc,r.id desc;
$$;
revoke all on function public.procurement_source_health(text) from public,anon,authenticated;
grant execute on function public.procurement_source_health(text) to authenticated;

create or replace function public.procurement_last_scheduled_ingest(p_origin text)
returns timestamptz language sql stable security definer set search_path='' as $$
select max(r.started_at) from public.ingest_runs r
where exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','EXECUTIVE','VIEWER']))
 and r.trigger='SCHEDULED'
 and (p_origin='all' or (p_origin='demo' and r.source='fixture') or (p_origin='live' and r.source<>'fixture'));
$$;
revoke all on function public.procurement_last_scheduled_ingest(text) from public,anon,authenticated;
grant execute on function public.procurement_last_scheduled_ingest(text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. 가입 신청 결정 — 승인할 수 있는 역할에 EXECUTIVE 추가 (본문은 20261025000300 과 같다)
-- ────────────────────────────────────────────────────────────────
create or replace function public.decide_join_request(
  p_request uuid,
  p_approve boolean,
  p_seen_updated_at timestamptz,
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
  -- ADMIN 이 본 뒤 신청자가 다시 신청하거나 사진을 바꿨다. 화면을 새로 읽어야 한다.
  if p_seen_updated_at is null or req.updated_at is distinct from p_seen_updated_at then
    raise exception 'request_changed' using errcode = 'P0001', hint = 'request_changed';
  end if;

  if not coalesce(p_approve, false) then
    update public.member_join_requests
    set status = 'REJECTED', decided_by = uid, decided_at = now()
    where id = req.id;
    return 'REJECTED';
  end if;

  if p_sol_role is null or p_sol_role not in ('VIEWER', 'EXECUTIVE', 'ANALYST', 'SALES', 'ADMIN') then
    raise exception 'invalid_sol_role' using errcode = 'P0001', hint = 'invalid_sol_role';
  end if;
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
    -- 이름·부서·직급·사진은 ADMIN 이 본 신청 스냅숏이다. 승인 순간의 프로필 값은 쓰지 않는다.
    insert into public.team_members (
      org_id, person_code, name, department_id, job_title_id, is_demo, user_id, photo_path
    ) values (
      req.org_id,
      public.next_new_hire_person_code(req.org_id),
      req.applicant_name,
      req.department_id,
      req.job_title_id,
      false,
      req.user_id,
      req.applicant_photo_path
    );
    -- 승인되면 부서·직급은 명부 값을 따른다(U6).
    update public.profiles
    set declared_department_id = req.department_id, declared_job_title_id = req.job_title_id
    where id = req.user_id;
  else
    -- 같은 직원에게 대기 신청이 둘이면 먼저 승인된 것만 연결된다.
    update public.team_members m
    set user_id = req.user_id, photo_path = coalesce(m.photo_path, req.applicant_photo_path)
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
revoke execute on function public.decide_join_request(uuid, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.decide_join_request(uuid, boolean, timestamptz, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. storage 정책 — 원본 문서 읽기 (본문은 20261021000701 과 같다)
-- ────────────────────────────────────────────────────────────────
drop policy "sol_raw_documents_read" on storage.objects;
create policy "sol_raw_documents_read" on storage.objects for select to authenticated
using (
  (select public.is_active_user())
  and (select exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','EXECUTIVE','VIEWER'])))
  and exists (
    select 1 from public.bid_documents d
    where d.storage_bucket=storage.objects.bucket_id and d.object_key=storage.objects.name
      and d.download_status='OK' and d.raw_storage_id is not null
  )
);

-- ────────────────────────────────────────────────────────────────
-- 5. company_profiles 출처 열
-- ────────────────────────────────────────────────────────────────
-- sources: {id, title, url, publisher?, retrievedAt}[] — 프로필 값이 기대는 공개 출처.
-- public_history: {year, text, sourceId}[] — 공개 자료로 확인한 연혁.
alter table public.company_profiles
  add column sources jsonb not null default '[]'::jsonb,
  add column public_history jsonb not null default '[]'::jsonb,
  add constraint company_profiles_sources_check check (jsonb_typeof(sources) = 'array'),
  add constraint company_profiles_public_history_check check (jsonb_typeof(public_history) = 'array');
