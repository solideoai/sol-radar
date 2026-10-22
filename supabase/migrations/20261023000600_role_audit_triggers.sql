-- N2 업무 역할 변경과 재초대를 감사한다. 기존 감사 action 제약과 RLS를 유지한다.
-- JWT 없는 관리 작업은 기록하지 않고 요청 ID는 추적 정보로만 취급한다.

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
