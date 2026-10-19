-- 20261019000005_bid_reviews_assignments — 사람의 최종 결정(bid_reviews)과 인력 배정(assignments).
--
-- 근거: docs/04-DATABASE.md §3.4 bid_reviews·§3.5 assignments·§5·§7 순서 5 나머지, docs/09-SECURITY.md RBAC
-- (결정 기록은 ADMIN·SALES), docs/05-API-SPEC.md POST /bids/:id/reviews(reason 10~2000자).
--
-- bid_reviews 는 append-only 다. 최신 행이 현재 결정이다. system_recommendation·disagreement_flag 는 화면 역할이 쓰지 못하고
-- 20261019000007 의 BEFORE INSERT 트리거가 score_run_id 에서 채운다. 같은 트리거 묶음이 audit_logs(REVIEW_DECIDE)와
-- 담당자가 있을 때의 REVIEW_ASSIGNED outbox 를 같은 트랜잭션에 쓴다.
-- assignments 는 seed(service role)만 쓴다. 점수 계산의 team.assignments 입력이다.
--
-- 이 파일에 든 것:
--   1. bid_reviews — 표·복합 FK(담당자는 같은 조직 멤버, 분석 run 은 같은 조직)·인덱스.
--   2. assignments — 표·복합 FK(직원은 같은 조직)·인덱스.
--   3. 권한·정책 — 둘 다 조직 전원 읽기. bid_reviews 는 ADMIN·SALES 의 insert 만.
--
-- 되돌리기(새 마이그레이션으로): drop table public.assignments; drop table public.bid_reviews;

-- ────────────────────────────────────────────────────────────────
-- 1. bid_reviews
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  score_run_id uuid,
  reviewer_id uuid default auth.uid() references public.profiles (id) on delete set null,
  assignee_id uuid,
  decision text not null,
  system_recommendation text,
  disagreement_flag boolean not null default false,
  reason text not null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bid_reviews_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  -- 분석 run 은 같은 조직의 것만. run 이 지워지면 결정은 남고 참조만 비운다.
  constraint bid_reviews_score_run_fkey foreign key (score_run_id, org_id)
    references public.score_runs (id, org_id) on delete set null (score_run_id),
  -- 담당자는 같은 조직의 멤버만. 멤버십이 지워지면 담당자만 비운다(템플릿 tasks_assignee_fkey 와 같다).
  constraint bid_reviews_assignee_fkey foreign key (org_id, assignee_id)
    references public.memberships (org_id, user_id) on delete set null (assignee_id),
  constraint bid_reviews_decision_check check (decision in ('BID', 'WATCH', 'NO_BID')),
  constraint bid_reviews_system_recommendation_check check (system_recommendation in ('BID', 'WATCH', 'NO_BID')),
  -- 사유는 필수다(05: 10~2000자). 서버 검증을 건너뛴 요청도 DB 가 막는다.
  constraint bid_reviews_reason_check check (reason = btrim(reason) and char_length(reason) between 10 and 2000),
  -- 트리거가 지키는 규칙의 두 번째 잠금: 권고와 다른 결정이면 true, 권고가 없으면 false.
  constraint bid_reviews_disagreement_flag_check
    check (disagreement_flag = coalesce(decision <> system_recommendation, false))
);

alter table public.bid_reviews enable row level security;

-- 공고별 최신 결정. 정책이 거르는 org_id 가 앞에 온다.
create index if not exists bid_reviews_org_id_bid_id_decided_at_idx on public.bid_reviews (org_id, bid_id, decided_at desc);
-- 외래 키가 찾는 열(계정 삭제·멤버십 삭제·run 삭제·revision 삭제).
create index if not exists bid_reviews_reviewer_id_idx on public.bid_reviews (reviewer_id);
create index if not exists bid_reviews_org_id_assignee_id_idx on public.bid_reviews (org_id, assignee_id);
create index if not exists bid_reviews_score_run_id_idx on public.bid_reviews (score_run_id);
create index if not exists bid_reviews_revision_id_idx on public.bid_reviews (revision_id);

-- ────────────────────────────────────────────────────────────────
-- 2. assignments — 기간은 시각(timestamptz)이다. 점수 엔진(web/server/scoring)의 startsAt·endsAt 이 ISO 시각을 받는다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  member_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  allocation_percent smallint not null,
  created_at timestamptz not null default now(),
  constraint assignments_member_fkey foreign key (member_id, org_id)
    references public.team_members (id, org_id) on delete cascade,
  constraint assignments_allocation_percent_check check (allocation_percent between 0 and 100),
  constraint assignments_period_check check (ends_at > starts_at)
);

alter table public.assignments enable row level security;

create index if not exists assignments_org_id_member_id_idx on public.assignments (org_id, member_id);
create index if not exists assignments_org_id_bid_id_idx on public.assignments (org_id, bid_id);
create index if not exists assignments_member_id_org_id_idx on public.assignments (member_id, org_id);

-- ────────────────────────────────────────────────────────────────
-- 3. 권한과 정책
-- ────────────────────────────────────────────────────────────────
revoke all on table public.bid_reviews from anon, authenticated, public;
revoke all on table public.assignments from anon, authenticated, public;

grant select on table public.bid_reviews to authenticated;
grant select on table public.assignments to authenticated;
-- reviewer_id·system_recommendation·disagreement_flag·decided_at 은 열 권한이 없어 기본값·트리거 값만 들어간다.
grant insert (org_id, bid_id, revision_id, score_run_id, assignee_id, decision, reason)
  on table public.bid_reviews to authenticated;

drop policy if exists "조직 결정 이력 읽기" on public.bid_reviews;
create policy "조직 결정 이력 읽기"
  on public.bid_reviews for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- reviewer_id 는 열 권한이 없어 기본값(auth.uid())이 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "ADMIN·SALES 는 결정 기록" on public.bid_reviews;
create policy "ADMIN·SALES 는 결정 기록"
  on public.bid_reviews for insert
  to authenticated
  with check (
    org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES']))
    and reviewer_id = (select auth.uid())
  );

drop policy if exists "조직 인력 배정 읽기" on public.assignments;
create policy "조직 인력 배정 읽기"
  on public.assignments for select
  to authenticated
  using (org_id in (select public.my_org_ids()));
