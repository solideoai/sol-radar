-- 2026-10-24 N4b 조직·인력 ADMIN 편집(추가·부서/직급 이동·퇴사).
-- 근거: docs/plans/2026-10-16-sidebar-ia-design.md §3.2 P1-5·260행·284행, M16, docs/04-DATABASE.md §3.5(employment_status).
--
-- 화면 역할에는 team_members 쓰기 권한을 주지 않는다. 아래 security definer 함수 두 개만 쓴다.
-- 함수가 세션 조직과 sol_role ADMIN 을 확인하고, 같은 트랜잭션에서 audit_logs 를 남긴다.
-- 점수 계산 속성(team_member_scoring)은 받지도 바꾸지도 않는다. 퇴사해도 그 행은 지우지 않는다(M16 ①).
-- 저장된 score_runs 는 입력 스냅샷이라 이 파일의 어떤 함수도 건드리지 않는다(M16 ③).
-- 퇴사자는 화면 역할의 읽기에서 빠진다(04 §3.5). worker 의 다음 분석은 web/server/analysis 가 LEFT 를 뺀다(M16 ⑤).
--
-- 되돌리기(새 마이그레이션으로): 두 함수와 두 restrictive 정책을 drop 하고, TEAM_MEMBER_* 감사 행을 지운 뒤
-- audit_logs_action_check 를 20261022000300 목록으로 다시 만들고, employment_status 열을 drop 한다.

-- ── 1. 재직 상태 ─────────────────────────────────────────────

alter table public.team_members
  add column if not exists employment_status text not null default 'ACTIVE';
alter table public.team_members drop constraint if exists team_members_employment_status_check;
alter table public.team_members
  add constraint team_members_employment_status_check check (employment_status in ('ACTIVE', 'LEFT'));
comment on column public.team_members.employment_status is
  'ACTIVE or LEFT. LEFT rows stay for history; screen roles do not read them and the next analysis excludes them.';

-- 퇴사자에게는 계정을 연결하지 않는다(가입 신청 승인, 20261024000300). 연결 해제(null)는 막지 않는다.
create or replace function public.reject_left_member_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null and new.employment_status <> 'ACTIVE' then
    raise exception 'member_left' using errcode = 'P0001', hint = 'member_left';
  end if;
  return new;
end;
$$;
revoke execute on function public.reject_left_member_link() from public, anon, authenticated;
drop trigger if exists team_members_reject_left_link on public.team_members;
create trigger team_members_reject_left_link
  before update of user_id on public.team_members
  for each row execute function public.reject_left_member_link();

-- ── 2. 감사 action ───────────────────────────────────────────
-- 20261022000300 목록에 두 값을 더한다. 다른 값은 그대로다.

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'LOGIN', 'LOGOUT', 'PROFILE_CREATE_REVISION', 'ANALYSIS_REQUEST', 'REVIEW_DECIDE', 'USER_INVITE',
    'USER_DISABLE', 'INGEST_MANUAL', 'NOTIFICATION_READ', 'SEED', 'USER_ROLE_CHANGE',
    'PROJECT_OPEN', 'PROJECT_STATUS_CHANGE', 'PROJECT_RESULT_RECORD',
    'TEAM_MEMBER_CREATE', 'TEAM_MEMBER_UPDATE'
  ));

-- ── 3. 퇴사자는 화면 역할이 읽지 못한다 ──────────────────────
-- 기존 "조직 명부 읽기"(조직 전원) 위에 restrictive 로 좁힌다. 기존 정책은 그대로다.
-- 명부·조직도·회사 프로필 인원 수·인력 시뮬레이션이 모두 이 표를 사용자 JWT 로 읽으므로 한곳에서 뺀다.

drop policy if exists "재직 직원만 명부 읽기" on public.team_members;
create policy "재직 직원만 명부 읽기"
  on public.team_members as restrictive for select
  to authenticated
  using (employment_status = 'ACTIVE');

-- 점수 계산 속성도 재직 직원의 것만 보인다. 하위 질의는 team_members 의 RLS(조직·재직)를 그대로 탄다.
drop policy if exists "재직 직원의 점수 속성만 읽기" on public.team_member_scoring;
create policy "재직 직원의 점수 속성만 읽기"
  on public.team_member_scoring as restrictive for select
  to authenticated
  using (
    exists (
      select 1 from public.team_members m
      where m.id = team_member_scoring.member_id
        and m.org_id = team_member_scoring.org_id
        and m.employment_status = 'ACTIVE'
    )
  );

-- ── 4. 편집 함수 ─────────────────────────────────────────────
-- 거절은 raise exception '<코드>' using errcode = 'P0001' 이다(N6 과 같은 방식). 웹이 코드를 HTTP 상태로 옮긴다.
--   NOT_FOUND            세션 조직이 아니거나 없는 직원(다른 조직은 존재를 드러내지 않는다)
--   FORBIDDEN            같은 조직이지만 sol_role ADMIN 이 아니다
--   DEPARTMENT_NOT_FOUND 그 조직의 부서가 아니다
--   DEPARTMENT_NOT_TEAM  팀이 아닌 부서(본부·그룹)
--   JOB_TITLE_NOT_FOUND  그 조직의 직급이 아니다
--   EMAIL_TAKEN          그 조직에서 이미 쓰는 메일
--   INVALID_INPUT        이름·메일·재직 상태가 표 제약에 맞지 않는다

create or replace function public.team_member_edit_json(m public.team_members)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'personCode', m.person_code, 'name', m.name, 'email', m.email,
    'departmentId', m.department_id, 'jobTitleId', m.job_title_id,
    'employmentStatus', m.employment_status, 'isDemo', m.is_demo
  );
$$;
revoke execute on function public.team_member_edit_json(public.team_members) from public, anon, authenticated;

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
declare
  v_kind text;
begin
  if p_department_id is not null then
    select coalesce(d.kind, 'TEAM') into v_kind
    from public.departments d
    where d.id = p_department_id and d.org_id = p_org_id;
    if not found then
      raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_kind <> 'TEAM' then
      raise exception 'DEPARTMENT_NOT_TEAM' using errcode = 'P0001';
    end if;
  end if;
  if p_job_title_id is not null and not exists (
    select 1 from public.job_titles j where j.id = p_job_title_id and j.org_id = p_org_id
  ) then
    raise exception 'JOB_TITLE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.assert_team_member_placement(uuid, uuid, uuid) from public, anon, authenticated;

-- 직원 추가. 새 직원은 실제 운영 행이라 is_demo=false 이고 번호는 SOL-N####(20261024000200)이다.
-- 사진·성별은 비워 둔다(데모 행만 필수, 20261024000200). 계정 연결(user_id)은 가입 신청 승인 몫이다.
create or replace function public.create_team_member(
  p_org_id uuid,
  p_name text,
  p_department_id uuid,
  p_job_title_id uuid,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members%rowtype;
  v_constraint text;
begin
  if auth.uid() is null or p_org_id is null
    or p_org_id not in (select public.my_org_ids())
    or not exists (
      select 1 from public.organizations o where o.id = p_org_id and o.personal_owner_id is null
    ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_org_id not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_department_id is null or p_job_title_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform public.assert_team_member_placement(p_org_id, p_department_id, p_job_title_id);

  begin
    insert into public.team_members (
      org_id, person_code, name, email, department_id, job_title_id, is_demo, employment_status
    )
    values (
      p_org_id, public.next_new_hire_person_code(p_org_id), btrim(p_name), p_email,
      p_department_id, p_job_title_id, false, 'ACTIVE'
    )
    returning * into v_member;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'team_members_org_email_key' then
        raise exception 'EMAIL_TAKEN' using errcode = 'P0001';
      end if;
      raise;
    when check_violation or not_null_violation then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    p_org_id, auth.uid(), 'TEAM_MEMBER_CREATE', 'team_member', v_member.id,
    jsonb_build_object('before', null, 'after', public.team_member_edit_json(v_member)),
    public.audit_request_id()
  );
  return public.team_member_edit_json(v_member);
end;
$$;
revoke execute on function public.create_team_member(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_team_member(uuid, text, uuid, uuid, text) to authenticated;

-- 부서·직급 이동과 퇴사(또는 재직 복귀). null 인자는 바꾸지 않는다. 바뀐 것이 없으면 감사 없이 지금 값을 돌려준다.
create or replace function public.update_team_member(
  p_member_id uuid,
  p_department_id uuid default null,
  p_job_title_id uuid default null,
  p_employment_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.team_members%rowtype;
  v_after public.team_members%rowtype;
begin
  select m.* into v_before
  from public.team_members m
  where m.id = p_member_id and m.org_id in (select public.my_org_ids())
  for update;
  if not found or auth.uid() is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_before.org_id not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_employment_status is not null and p_employment_status not in ('ACTIVE', 'LEFT') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform public.assert_team_member_placement(v_before.org_id, p_department_id, p_job_title_id);

  if coalesce(p_department_id, v_before.department_id) = v_before.department_id
    and coalesce(p_job_title_id, v_before.job_title_id) = v_before.job_title_id
    and coalesce(p_employment_status, v_before.employment_status) = v_before.employment_status then
    return public.team_member_edit_json(v_before);
  end if;

  update public.team_members set
    department_id = coalesce(p_department_id, department_id),
    job_title_id = coalesce(p_job_title_id, job_title_id),
    employment_status = coalesce(p_employment_status, employment_status)
  where id = v_before.id
  returning * into v_after;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    v_after.org_id, auth.uid(), 'TEAM_MEMBER_UPDATE', 'team_member', v_after.id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'departmentId', v_before.department_id, 'jobTitleId', v_before.job_title_id,
        'employmentStatus', v_before.employment_status
      ),
      'after', jsonb_build_object(
        'departmentId', v_after.department_id, 'jobTitleId', v_after.job_title_id,
        'employmentStatus', v_after.employment_status
      )
    ),
    public.audit_request_id()
  );
  return public.team_member_edit_json(v_after);
end;
$$;
revoke execute on function public.update_team_member(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.update_team_member(uuid, uuid, uuid, text) to authenticated;
