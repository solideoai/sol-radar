-- 보안 검토(2026-10-25 통합 2차, 중간) 수정: 가입 신청 결정은 ADMIN 이 본 신청 버전으로만 한다.
-- 20261025000100 은 승인 때 신청 스냅숏을 쓰게 했지만, 대기 중 재신청(submit_join_request)이 같은 신청 행을
-- 새 프로필 값·새 연결 대상으로 덮어쓰고, set_my_photo 가 대기 신청 사진을 바꾼다. ADMIN 이 새로 고치지 않은 화면에서
-- 승인하면 본 적 없는 이름·부서·직급·연결 직원·사진이 명부에 들어갔다.
-- 이 파일이 바꾸는 것:
--   1. decide_join_request 가 p_seen_updated_at(ADMIN 화면이 읽은 신청 행의 updated_at)을 꼭 받는다.
--      신청 행의 updated_at 과 다르면 request_changed 로 거부한다. 신청 행은 고칠 때마다 touch 트리거가 updated_at 을 바꾼다.
--      검사 순서: 권한(forbidden) → 대기 상태(request_not_pending) → 버전(request_changed). 없는 신청·남의 조직 신청은 여전히 같은 답이다.
--   2. 버전을 받지 않는 옛 서명 (uuid, boolean, text) 은 지운다. 운영 DB 에는 아직 없는 함수다(20261024000300 미적용).
--   3. 명부 사진은 프로필이 아니라 신청 행의 사진 사본(applicant_photo_path)을 쓴다. ADMIN 이 승인 표에서 본 사진이다.
-- 그대로인 것: 반환형·volatile·security definer·search_path=''·ADMIN 전용·FOR UPDATE 잠금·신청 스냅숏(이름·부서·직급)·U6 규칙.
-- 되돌리기: 이 파일을 지우지 않는다(append-only). 새 migration 에서 이 함수를 지우고 20261025000100 의 본문으로 옛 서명을 다시 만든다.

drop function if exists public.decide_join_request(uuid, boolean, text);

create function public.decide_join_request(
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

  if p_sol_role is null or p_sol_role not in ('VIEWER', 'ANALYST', 'SALES', 'ADMIN') then
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
