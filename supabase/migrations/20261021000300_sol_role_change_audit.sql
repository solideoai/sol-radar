-- 20261021000300_sol_role_change_audit — 업무 역할(sol_role) 변경을 업무 감사(audit_logs)에 남긴다.
--
-- 근거: docs/09-SECURITY.md "감사 가능성"(업무 역할 변경 감사 미구현), docs/04-DATABASE.md §3.6 audit_logs,
-- docs/16-DECISIONS.md ADR-021·미결정 26-5, docs/plans/2026-10-21-n2-org-settings-plan.md §2-5(N2 설정 조직 탭).
-- 미결정 26-5 는 2026-10-20 "해커톤 뒤"로 미뤘던 항목이다. 2026-10-21 N2 확장 컷에서 추천안(넣는다)으로 진행하고,
-- 사용자 확인은 조정 세션 sol-radar-12 가 따로 받는다. 이 파일만 담은 커밋을 빼면 되돌린 것과 같다.
--
-- 이 파일에 든 것:
--   1. audit_logs.action check 에 USER_ROLE_CHANGE 를 더한다. 기존 값 10개는 그대로 둔다.
--   2. log_membership_sol_role_audit() — memberships.sol_role 이 실제로 바뀐 update 마다 감사 한 행.
--      행위자는 auth.uid() 다. JWT 없는 관리 작업·service role(seed·pnpm demo:reset)은 행위자가 없어 남기지 않는다.
--      before_after = {before:{solRole}, after:{solRole}}, target_type 'membership', target_id 는 대상 사용자 id.
--      감사는 그 조직 ADMIN 만 읽는다(정책 "ADMIN 은 조직 감사 읽기", 20261019000006).
--
-- 바꾸지 않는 것: 역할 변경 권한(정책 "ADMIN 은 역할 변경"·protect_sol_role, 20261019000001), 마지막 ADMIN 보호
-- (protect_last_sol_admin, 20261019000014), 템플릿 activities(org_role 변경 피드).
--
-- 되돌리기(새 마이그레이션으로): 트리거 memberships_log_sol_role_audit 와 함수 log_membership_sol_role_audit() 를 지우고,
-- USER_ROLE_CHANGE 행을 지운 뒤 audit_logs_action_check 를 20261019000006 의 값 목록으로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. action 값 목록
-- ────────────────────────────────────────────────────────────────
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'LOGIN', 'LOGOUT', 'PROFILE_CREATE_REVISION', 'ANALYSIS_REQUEST', 'REVIEW_DECIDE', 'USER_INVITE',
    'USER_DISABLE', 'INGEST_MANUAL', 'NOTIFICATION_READ', 'SEED', 'USER_ROLE_CHANGE'
  ));

-- ────────────────────────────────────────────────────────────────
-- 2. USER_ROLE_CHANGE — sol_role 이 바뀐 update 만(같은 값 update·다른 열 update 는 남기지 않는다).
-- 화면 역할에는 audit_logs 쓰기 권한이 없어 security definer 로 함수 주인 권한으로 넣는다(20261019000007 과 같다).
-- after 트리거라 protect_sol_role·protect_last_sol_admin(before)이 거절한 변경은 남지 않는다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.log_membership_sol_role_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, auth.uid(), 'USER_ROLE_CHANGE', 'membership', new.user_id,
    jsonb_build_object(
      'before', jsonb_build_object('solRole', old.sol_role),
      'after', jsonb_build_object('solRole', new.sol_role)
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_membership_sol_role_audit() from public, anon, authenticated;

drop trigger if exists memberships_log_sol_role_audit on public.memberships;
create trigger memberships_log_sol_role_audit
  after update of sol_role on public.memberships
  for each row
  when (old.sol_role is distinct from new.sol_role)
  execute function public.log_membership_sol_role_audit();
