-- 20261015000002_team_settings — 팀 설정: owner 가 팀 이름을 바꾸고 팀을 지운다.
--
-- 스펙: polaris/specs/done/team-settings-mail-csp-errors.md (3장 1번, 5장 엣지 케이스)
--
-- 이 파일에 든 것:
--   1. organizations 의 이름 바꾸기(열 단위 update (name))·지우기(delete) 권한과 정책.
--      팀(개인 조직이 아닌 조직)의 활동 회원 owner 만 한다. 개인 조직은 계정과 함께만 없어진다.
--   2. 마지막 owner 보호가 팀을 지울 때의 연쇄 삭제를 막지 않게 한다.
--
-- 팀을 지우면 멤버십·초대·작업·활동이 함께 지워진다(모두 org_id 의 on delete cascade).
-- 활동 기록 트리거는 조직이 이미 없으면(지워지는 중이면) 아무것도 남기지 않는다(20261014000004 의 5절).
-- 주소(slug)는 바꾸지 않는다. 공유된 링크가 깨진다(스펙 2장).
-- 모든 문장은 다시 적용해도 결과가 같다.

-- ────────────────────────────────────────────────────────────────
-- 1. 권한과 정책
--
-- 이름 말고 다른 열(slug·personal_owner_id)은 쓰기 권한이 없어 바꾸지 못한다. 이름 규칙(앞뒤 공백 없이 1~40자)은
-- organizations_name_check 제약이 지킨다(20261014000001).
-- my_owner_org_ids() 는 정지된 사람에게 빈 목록이다(20261015000001). 그래서 member·조직 밖의 사람·운영자·
-- 정지된 owner 의 시도는 오류 없이 0행이다(WHERE 로 고른 행이 정책에 걸러진다).
-- ────────────────────────────────────────────────────────────────
grant update (name) on table public.organizations to authenticated;
grant delete on table public.organizations to authenticated;

-- personal_owner_id 는 열 권한이 없어 바뀌지 않는다. with check 의 같은 조건은 그 위의 두 번째 잠금이다.
drop policy if exists "팀 owner 는 이름 바꾸기" on public.organizations;
create policy "팀 owner 는 이름 바꾸기"
  on public.organizations for update
  to authenticated
  using (personal_owner_id is null and id in (select public.my_owner_org_ids()))
  with check (personal_owner_id is null and id in (select public.my_owner_org_ids()));

drop policy if exists "팀 owner 는 팀 지우기" on public.organizations;
create policy "팀 owner 는 팀 지우기"
  on public.organizations for delete
  to authenticated
  using (personal_owner_id is null and id in (select public.my_owner_org_ids()));

-- ────────────────────────────────────────────────────────────────
-- 2. 마지막 owner 보호 — 지워지는 조직은 지키지 않는다
--
-- 20261014000001 의 것과 같고, 조직 행이 이미 없으면 통과시킨다. owner 가 팀을 지우면 같은 문장 안에서 조직 행이
-- 먼저 지워지고 멤버십이 연쇄로 지워진다. 그때 마지막 owner 의 멤버십이 이 보호에 걸리면 팀 삭제가 통째로 실패한다.
-- JWT 를 비우는 관리 작업(탈퇴 delete_my_account)과 달리, 화면은 정책을 거쳐 조직 행을 바로 지우므로 여기서 비킨다.
--
-- 조직 행이 보이지 않는 경우는 둘뿐이다: 같은 문장이 그 조직을 지우는 중이거나, 다른 트랜잭션이 지우고 확정했다
-- (그러면 멤버십도 이미 함께 지워졌다). 조직이 남아 있는 한 마지막 owner 는 그대로 나가지도 내려가지도 못한다.
-- 조직 행을 읽는 것은 함수 주인 권한이라 정책과 상관없이 보인다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_role = 'owner'
     and (tg_op = 'DELETE' or new.org_role <> 'owner')
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    perform 1 from public.organizations where id = old.org_id for update;
    if not found then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if not exists (
      select 1 from public.memberships
      where org_id = old.org_id and org_role = 'owner' and user_id <> old.user_id
    ) then
      raise exception '조직에는 owner 가 한 명 이상 있어야 합니다'
        using errcode = 'P0001', hint = 'last_owner';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
