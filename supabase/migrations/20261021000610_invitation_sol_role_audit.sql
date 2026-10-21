-- 20261021000610_invitation_sol_role_audit — 다시 초대해 초대의 업무 역할(sol_role)이 바뀌면 업무 감사(audit_logs)에 남긴다.
--
-- 근거: 3e 보안 검토 Medium(2026-10-21, N2 기준점 cd6fc96) — 같은 이메일을 다시 초대하면 renewInvitation 이
-- invitations.sol_role 을 update 하는데, USER_INVITE 감사(20261019000007 log_invitation_audit)는 insert 에만 남는다.
-- 그래서 VIEWER 로 초대한 뒤 ADMIN 으로 다시 초대하고 수락하면 ADMIN 멤버십이 감사 없이 생길 수 있었다
-- (멤버십은 insert 로 생겨 20261021000300 의 memberships update 트리거도 걸리지 않는다).
-- 사용자 결정(3e 세션 전달, 2026-10-21): N2 병합 전에 고친다. 재초대 자체는 막지 않는다.
--
-- 이 파일에 든 것:
--   1. log_invitation_sol_role_audit() — invitations.sol_role 이 실제로 바뀐 update(재초대)마다 USER_INVITE 감사 한 행.
--      action 은 insert 감사와 같은 USER_INVITE 다. 재초대는 초대를 새 역할로 다시 보내는 일이고, 조직 설정 화면의
--      "최근 변경 기록"(toOrgAuditView)이 USER_INVITE 를 "초대 · 이메일 · 역할"로 그대로 읽는다. USER_ROLE_CHANGE 는
--      대상이 구성원(membership)이라 쓰지 않는다. 그래서 audit_logs_action_check 도 바꾸지 않는다(N6 이 같은 제약을 다시 만든다).
--      before_after = {before:{solRole: 이전 역할}, after:{email, orgRole, solRole, expiresAt}} — after 는 insert 감사와 같은 모양이다.
--      insert 감사는 before 가 null 이라, before 가 있으면 재초대다.
--      행위자는 auth.uid() 다. JWT 없는 관리 작업·service role(seed·pnpm demo:reset)은 행위자가 없어 남기지 않는다(000300 과 같다).
--      감사는 그 조직 ADMIN 만 읽는다(20261019000006).
--
-- request_id(audit_request_id())는 요청 헤더 x-request-id 를 그대로 옮긴 값이다. 부른 사람이 정할 수 있어 신뢰하지 않는다.
-- 요청 추적에만 쓰고, 누가 했는지는 actor_id(auth.uid())로만 판단한다(3e 보안 검토 Low 1).
--
-- 바꾸지 않는 것: 초대 권한(정책 "ADMIN 은 초대 갱신", 20261019000001), 만료 연장(renew_invitation), insert 감사
-- (log_invitation_audit), org_role 변경(템플릿 범위).
--
-- 되돌리기(새 마이그레이션으로): 트리거 invitations_log_sol_role_audit 와 함수 log_invitation_sol_role_audit() 를 지운다.
-- 이 파일은 고치지 않는다(append-only).

create or replace function public.log_invitation_sol_role_audit()
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
    new.org_id, auth.uid(), 'USER_INVITE', 'invitation', new.id,
    jsonb_build_object(
      'before', jsonb_build_object('solRole', old.sol_role),
      'after', jsonb_build_object(
        'email', new.email, 'orgRole', new.org_role, 'solRole', new.sol_role, 'expiresAt', new.expires_at
      )
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_invitation_sol_role_audit() from public, anon, authenticated;

-- after 트리거라 정책이 거른 update(0행)와 before 트리거가 거절한 update 는 남지 않는다.
drop trigger if exists invitations_log_sol_role_audit on public.invitations;
create trigger invitations_log_sol_role_audit
  after update of sol_role on public.invitations
  for each row
  when (old.sol_role is distinct from new.sol_role)
  execute function public.log_invitation_sol_role_audit();
