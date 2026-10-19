-- 업무 역할은 조직 소유권(org_role)과 독립이다. 기존 owner도 VIEWER로 시작한다.
alter table public.memberships
  add column if not exists sol_role text not null default 'VIEWER'
  constraint memberships_sol_role_check check (sol_role in ('VIEWER', 'ANALYST', 'SALES', 'ADMIN'));

-- 기존 INSERT(org_id,user_id,org_role)·UPDATE(org_role)와 RLS는 유지한다.
-- 역할 부여는 관리 경로에서만 하며 화면 역할은 자기 역할도 바꿀 수 없다.
revoke insert (sol_role), update (sol_role) on public.memberships from anon, authenticated, public;
