-- 20261014000003_invitation_fixes — 초대 트리거 두 개를 고친다(독립 검토에서 찾은 결함).
--
-- 1. check_invitation 은 BEFORE INSERT 트리거라 정책(owner 만 초대)보다 먼저 돈다. 그래서 조직 밖의 사람이 초대를
--    넣어 보면 막히는 문구가 달랐다("이미 멤버입니다"·"개인 조직에는…"·정책 오류). 그 차이로 그 이메일이 멤버인지,
--    그 조직이 개인 조직인지 알아낼 수 있었다. 이제 그 조직의 owner 가 아닌 요청은 판단하지 않고 넘겨 정책이 거절하게 한다.
-- 2. clear_accepted_invitation 은 수락한 초대를 프로필 이메일로 찾았는데, 수락 정책은 로그인 이메일(JWT 의 email)로 본다.
--    둘이 다르면(이메일을 바꾼 직후의 옛 토큰) 초대가 남아 만료 전까지 다시 들어올 수 있었다. 이제 둘 다로 찾는다.
--
-- 20261014000001 은 고치지 않는다(append-only). 함수만 다시 정의하고 트리거는 그대로 쓴다.
-- 재현 시험: scripts/database.test.mjs 의 "조직·멤버십·초대 정책" 묶음.

create or replace function public.check_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 화면에서 온 요청인데 그 조직의 owner 가 아니면 여기서 이유를 말하지 않는다. 정책이 같은 오류로 거절한다.
  -- JWT 가 없는 관리 작업과 service_role 은 정책을 거치지 않으므로 아래 규칙을 그대로 받는다.
  if auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and new.org_id not in (select public.my_owner_org_ids()) then
    return new;
  end if;
  if exists (select 1 from public.organizations where id = new.org_id and personal_owner_id is not null) then
    raise exception '개인 조직에는 초대할 수 없습니다'
      using errcode = 'P0001', hint = 'personal_org';
  end if;
  if exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = new.org_id and lower(p.email) = new.email
  ) then
    raise exception '이미 멤버입니다'
      using errcode = 'P0001', hint = 'already_member';
  end if;
  return new;
end;
$$;

create or replace function public.clear_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 수락 정책이 본 로그인 이메일과 프로필 이메일, 둘 중 어느 쪽으로 온 초대든 지운다.
  delete from public.invitations i
  where i.org_id = new.org_id
    and i.email in (
      lower(auth.jwt() ->> 'email'),
      (select lower(p.email) from public.profiles p where p.id = new.user_id)
    );
  return new;
end;
$$;
