-- 20261022000100_bid_watches — N3 관심 공고: 본인의 관심 표시(bid_watches)·조직 안 관심 인원 수·관심 공고 목록 뷰.
--
-- 근거: polaris/specs/in-progress/2026-10-21-n3-watchlist.md §3·§9, docs/plans/2026-10-21-n3-watchlist-plan.md Task 1,
-- 사이드바 정보 구조 설계(docs/plans/2026-10-16-sidebar-ia-design.md) §2.2·§2.5·D6, ADR-021·ADR-042.
-- 공고마다 본인이 ★ 로 표시한다. 남이 무엇을 표시했는지는 보이지 않고, 조직에는 "관심 N명"(수)만 보인다(D6).
-- ADMIN 도 본인 것만 본다. 마감 알림(20261022000110)이 이 표를 수신자로 읽는다.
--
-- 이 파일에 든 것:
--   1. bid_watches — 표·복합 FK(구성원이 빠지면 함께 지운다)·공고 FK(공고가 지워지면 함께 지운다)·인덱스.
--   2. 권한·정책 — authenticated 에 select·delete 와 org_id·user_id·bid_id 열 insert 만. update 없음, anon 없음.
--      셋 다 본인 행(user_id = auth.uid())이고 내가 활동 중인 구성원인 조직(my_org_ids)의 행이다.
--   3. bid_watch_count(uuid) — 부른 사람 조직 안에서 그 공고를 관심 등록한 사람 수(정수 하나). security definer 다.
--   4. 뷰 watched_bid_list_items(security_invoker) — bid_list_items 중 부른 사람이 관심 등록한 공고만.
--
-- 바꾸지 않는 것: bid_list_items 뷰·BidListItem 계약·다른 표의 정책(ADR-042 ②). 덧붙이기만 한다.
--
-- 되돌리기(새 마이그레이션으로): drop view if exists public.watched_bid_list_items;
-- drop function if exists public.bid_watch_count(uuid); drop table if exists public.bid_watches;
-- (마감 알림 함수 20261022000110 이 이 표를 읽으므로 그 함수를 먼저 지운다.)
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. bid_watches
--
-- 기본 키(org_id, user_id, bid_id)가 "한 사람이 한 공고에 한 번"을 지킨다. 두 창에서 동시에 ★ 해도 서버는
-- on conflict do nothing 으로 넣어 두 번째 요청도 오류 없이 끝난다(스펙 §9).
-- (org_id, user_id) 는 memberships 를 가리킨다 — 조직 구성원만 관심 등록하고, 멤버십이 지워지면 관심 행도 함께 지운다.
-- 공고가 지워지면 관심 행도 지운다. 공고가 취소·마감돼도 행은 남는다(알림만 멈춘다).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_watches (
  org_id uuid not null,
  user_id uuid not null,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint bid_watches_pkey primary key (org_id, user_id, bid_id),
  constraint bid_watches_member_fkey foreign key (org_id, user_id)
    references public.memberships (org_id, user_id) on delete cascade
);

alter table public.bid_watches enable row level security;

-- 관심 인원 수(bid_watch_count)와 마감 알림 수신자가 (조직, 공고)로 찾는다. 공고가 지워질 때 외래 키도 bid_id 로 찾는다.
-- 본인 행 정책(org_id·user_id)은 기본 키의 앞 두 열이 받는다.
create index if not exists bid_watches_org_id_bid_id_idx on public.bid_watches (org_id, bid_id);

-- ────────────────────────────────────────────────────────────────
-- 2. 권한과 정책
--
-- 기본 권한을 거두고 필요한 것만 연다. created_at 은 열 권한이 없어 기본값(now())만 들어간다.
-- 관심 표시는 켜기·끄기뿐이라 update 는 주지 않는다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.bid_watches from anon, authenticated, public;

grant select, delete on table public.bid_watches to authenticated;
grant insert (org_id, user_id, bid_id) on table public.bid_watches to authenticated;

drop policy if exists "본인 관심 공고 읽기" on public.bid_watches;
create policy "본인 관심 공고 읽기"
  on public.bid_watches for select
  to authenticated
  using (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()));

drop policy if exists "본인 관심 공고 넣기" on public.bid_watches;
create policy "본인 관심 공고 넣기"
  on public.bid_watches for insert
  to authenticated
  with check (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()));

drop policy if exists "본인 관심 공고 지우기" on public.bid_watches;
create policy "본인 관심 공고 지우기"
  on public.bid_watches for delete
  to authenticated
  using (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()));

-- ────────────────────────────────────────────────────────────────
-- 3. bid_watch_count(p_bid_id)
--
-- 정책은 본인 행만 열기 때문에 같은 조직 사람들의 관심 수는 화면 역할로 셀 수 없다. 그래서 security definer 로 세되,
-- 대상을 부른 사람이 활동 중인 구성원인 조직(my_org_ids — 정지된 계정이면 빈 목록이라 0)으로 다시 좁히고
-- 누가 표시했는지는 돌려주지 않는다(정수 하나). 없는 공고·관심 없는 공고는 0 이다.
-- 로그인 역할만 실행한다. scripts/db-verify.mjs 의 허용 목록에 이유와 함께 올라 있다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.bid_watch_count(p_bid_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.bid_watches w
  where w.bid_id = p_bid_id
    and w.org_id in (select public.my_org_ids());
$$;

revoke execute on function public.bid_watch_count(uuid) from public, anon, authenticated;
grant execute on function public.bid_watch_count(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. watched_bid_list_items — /watchlist 와 GET /bids?watched=me 가 읽는 한 줄
--
-- bid_list_items 의 행·열 그대로에서 부른 사람이 관심 등록한 공고만 남긴다. security_invoker 라 부른 사람의 RLS 로
-- 밑 표를 읽는다 — bid_watches 는 본인 행만, 목록 뷰의 분석·결정 열은 자기 조직 것만 나온다.
-- 관심 행을 본인 것으로 한 번 더 좁힌다(user_id = auth.uid()). 정책과 같은 조건이지만, 정책을 거치지 않는 역할
-- (service role·SQL 편집기)이 읽어도 "내 관심 공고"라는 뜻이 바뀌지 않게 둔다.
--
-- ⚠️ select i.* 는 만들 때의 열 목록으로 굳는다. bid_list_items 의 열을 바꾸는(더하거나 고치는) 마이그레이션은
-- 이 뷰도 다시 만든다(create or replace view). 이 뷰가 bid_list_items 에 기대므로 bid_list_items 를 drop 하려면
-- 이 뷰를 먼저 지운다. 화면 역할은 읽기만 한다.
-- ────────────────────────────────────────────────────────────────
create or replace view public.watched_bid_list_items
with (security_invoker = true)
as
select i.*
from public.bid_list_items i
where exists (
  select 1
  from public.bid_watches w
  where w.bid_id = i.id
    and w.user_id = (select auth.uid())
);

revoke all on table public.watched_bid_list_items from anon, authenticated, public;
grant select on table public.watched_bid_list_items to authenticated;
