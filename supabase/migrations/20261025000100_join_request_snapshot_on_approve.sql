-- 보안 검토(2026-10-25, 중간) 수정: 신규 입사자 승인은 신청 당시 값으로 명부에 등록한다.
-- 20261024000300 의 decide_join_request 는 승인 순간의 프로필(display_name·declared_*)을 먼저 썼다.
-- 신청자가 ADMIN 이 신청을 본 뒤 프로필을 바꾸면 ADMIN 이 보지 않은 이름·부서·직급이 명부에 들어갔다.
-- 이 파일은 그 함수 본문을 그대로 다시 정의하고 두 곳만 바꾼다(서명·반환형·security definer·search_path·권한 그대로).
--   1. NEW_HIRE 명부 행의 이름·부서·직급은 신청 행의 스냅숏(applicant_name·department_id·job_title_id)만 쓴다.
--   2. NEW_HIRE 승인 뒤 프로필의 부서·직급을 명부 값으로 맞춘다(LINK 승인의 U6 규칙과 같다). display_name 은 바꾸지 않는다.
-- 사진은 그대로 프로필 값을 쓴다. set_my_photo 가 대기 신청의 applicant_photo_path 도 함께 바꾸므로 ADMIN 이 보는 사진과 같다.
-- 되돌리기: 이 파일을 지우지 않는다(append-only). 새 migration 에 20261024000300 의 함수 본문을 다시 정의한다.

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
    -- 이름·부서·직급은 ADMIN 이 본 신청 스냅숏이다. 승인 순간의 프로필 값은 쓰지 않는다.
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
      profile.photo_path
    );
    -- 승인되면 부서·직급은 명부 값을 따른다(U6).
    update public.profiles
    set declared_department_id = req.department_id, declared_job_title_id = req.job_title_id
    where id = req.user_id;
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
