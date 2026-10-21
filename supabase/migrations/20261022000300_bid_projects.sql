-- 20261022000300_bid_projects — 입찰 프로젝트(ADR-021 P1 N6): BID 결정 뒤의 입찰 업무.
--
-- 근거: docs/plans/2026-10-16-sidebar-ia-design.md §2.4·§2.5·D3·D4·D12·M9·M12·M13(2026-10-16 사용자 승인),
-- docs/04-DATABASE.md §3.1 tasks P1 행·§3.8·§4, docs/05-API-SPEC.md §2 /projects·§5, docs/16-DECISIONS.md ADR-021·ADR-042,
-- 스펙 polaris/specs/in-progress/2026-10-21-n6-bid-projects.md, 계획 docs/plans/2026-10-21-n6-bid-projects-plan.md Task 1.
--
-- 사람 결정의 정본은 bid_reviews 다. 프로젝트는 결정을 복제하지 않고 opened_by_review_id 로 가리킨다.
-- 상태·결과·열기는 아래 세 함수만 바꾼다. 같은 함수가 상태 이력(bid_project_events)과 감사(audit_logs)를 같은 트랜잭션에
-- 쓴다(M9). 화면 역할이 직접 바꿀 수 있는 열은 담당자(owner_id)와 제출 마감 덮어쓰기(submission_due_override)뿐이다.
-- 결과(result)는 수동 기록이고 점수·결정 모델·평가셋·학습셋에 쓰지 않는다(D4). 점수·분석 코드는 이 표를 읽지 않는다.
--
-- 이 파일에 든 것:
--   1. bid_reviews UNIQUE(id, org_id) — 프로젝트가 같은 조직의 결정만 가리키게 하는 복합 FK 대상.
--   2. bid_projects — 조직·공고당 하나(UNIQUE(org_id, bid_id)).
--   3. bid_project_events — 상태 이력. 추가만.
--   4. tasks.bid_project_id — 체크리스트는 템플릿 작업을 재사용한다(M11).
--   5. audit_logs.action — PROJECT_OPEN·PROJECT_STATUS_CHANGE·PROJECT_RESULT_RECORD 를 더한다.
--      목록은 N2(20261021000300_sol_role_change_audit.sql)의 11개(USER_ROLE_CHANGE 포함) + 3개다.
--      번호가 그 파일보다 뒤라 둘 다 적용되면 이 목록이 최종이다(sol-radar-12 지시 2026-10-21).
--   6. updated_at 트리거.
--   7. open_bid_project(review_id) — 열기·다시 열기(M12 ③).
--   8. change_bid_project_status(project_id, to_status, note) — 상태 전이(D3·M12 ①).
--   9. record_bid_project_result(project_id, result, note) — 결과 기록(D4).
--  10. 권한과 정책 — 읽기 조직 전원, 쓰기 ADMIN·SALES(체크리스트 포함, M13).
--
-- 함수 거절은 raise exception '<코드>' using errcode = 'P0001' 이다(메시지가 곧 코드, finish_score_run 과 같다).
-- 코드: NOT_FOUND, FORBIDDEN, PROJECT_REQUIRES_BID_DECISION, PROJECT_ALREADY_OPEN(detail = 프로젝트 id),
-- LATEST_DECISION_NOT_BID(detail = 최신 결정 값), INVALID_PROJECT_TRANSITION(detail = "전>후").
-- 최신 결정은 그 조직·그 공고의 bid_reviews 를 decided_at desc, created_at desc, id desc 로 본 첫 행이다.
--
-- 모든 문장은 다시 적용해도 결과가 같다. 상태·결과 값은 enum 이 아니라 check 제약으로 묶는다.
-- 되돌리기(새 마이그레이션으로): 세 함수·트리거 함수를 drop, tasks 의 새 정책·열을 drop, 두 표를 drop,
-- audit_logs_action_check 를 이전 목록으로 다시 만들고(PROJECT_* 행을 먼저 지운다), bid_reviews_id_org_id_key 를 drop.

-- ────────────────────────────────────────────────────────────────
-- 1. bid_reviews UNIQUE(id, org_id)
-- ────────────────────────────────────────────────────────────────
-- 다시 적용할 때는 아래 2절의 외래 키가 이 제약에 기대고 있어 먼저 그 키를 지운다(2절에서 다시 건다).
alter table if exists public.bid_projects drop constraint if exists bid_projects_opened_by_review_fkey;
alter table public.bid_reviews drop constraint if exists bid_reviews_id_org_id_key;
alter table public.bid_reviews add constraint bid_reviews_id_org_id_key unique (id, org_id);

-- ────────────────────────────────────────────────────────────────
-- 2. bid_projects
--
-- 공고(bid_notices)는 조직 공용이라 org_id 가 없다. 조직 구분은 org_id 열과 정책이 한다.
-- 담당자(owner_id)는 로그인 계정이다(D12). (org_id, owner_id) 로 memberships 를 가리켜 다른 조직 사람은 담당자가 되지 못하고,
-- 멤버십이 지워지면 담당자만 비운다(템플릿 tasks_assignee_fkey 와 같다).
-- 여는 결정은 같은 조직의 것만이다. 결정은 화면에서 지워지지 않고, 공고·조직이 지워질 때 함께 지워지도록 기본(no action)이다.
-- 마감은 공고 deadline_at 을 읽는다. 덮어쓸 때만 submission_due_override 를 쓴다(복제 금지).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  opened_by_review_id uuid not null,
  status text not null default 'PREPARING',
  owner_id uuid,
  submission_due_override timestamptz,
  result text,
  result_note text,
  result_recorded_at timestamptz,
  closed_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_projects_org_id_bid_id_key unique (org_id, bid_id),
  constraint bid_projects_id_org_id_key unique (id, org_id),
  constraint bid_projects_owner_fkey foreign key (org_id, owner_id)
    references public.memberships (org_id, user_id) on delete set null (owner_id),
  constraint bid_projects_status_check check (status in ('PREPARING', 'SUBMITTED', 'AWAITING_RESULT', 'CLOSED')),
  constraint bid_projects_result_check check (result in ('WON', 'LOST', 'CANCELLED', 'NOT_SUBMITTED')),
  constraint bid_projects_result_note_check
    check (result_note = btrim(result_note) and char_length(result_note) between 1 and 2000),
  -- 함수가 지키는 규칙의 두 번째 잠금.
  constraint bid_projects_closed_at_check check ((status = 'CLOSED') = (closed_at is not null)),
  constraint bid_projects_result_recorded_check check ((result is null) = (result_recorded_at is null)),
  constraint bid_projects_result_note_needs_result_check check (result is not null or result_note is null)
);

-- 여는 결정의 외래 키는 표 밖에서 건다. 1절이 다시 적용될 때 지웠다가 여기서 다시 건다.
alter table public.bid_projects drop constraint if exists bid_projects_opened_by_review_fkey;
alter table public.bid_projects
  add constraint bid_projects_opened_by_review_fkey foreign key (opened_by_review_id, org_id)
    references public.bid_reviews (id, org_id);

alter table public.bid_projects enable row level security;

-- 보드는 조직의 프로젝트를 상태로 나눠 읽는다. 정책이 거르는 org_id 가 앞에 온다.
create index if not exists bid_projects_org_id_status_idx on public.bid_projects (org_id, status);
-- 외래 키가 찾는 열(공고·결정·멤버십·계정이 지워질 때).
create index if not exists bid_projects_bid_id_idx on public.bid_projects (bid_id);
create index if not exists bid_projects_opened_by_review_id_idx on public.bid_projects (opened_by_review_id, org_id);
create index if not exists bid_projects_org_id_owner_id_idx on public.bid_projects (org_id, owner_id);
create index if not exists bid_projects_created_by_idx on public.bid_projects (created_by);

-- ────────────────────────────────────────────────────────────────
-- 3. bid_project_events — 상태 이력. 추가만 한다. 행위자 계정이 지워져도 이력은 남는다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_project_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_project_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint bid_project_events_project_fkey foreign key (bid_project_id, org_id)
    references public.bid_projects (id, org_id) on delete cascade,
  constraint bid_project_events_from_status_check
    check (from_status in ('PREPARING', 'SUBMITTED', 'AWAITING_RESULT', 'CLOSED')),
  constraint bid_project_events_to_status_check
    check (to_status in ('PREPARING', 'SUBMITTED', 'AWAITING_RESULT', 'CLOSED')),
  constraint bid_project_events_note_check check (note = btrim(note) and char_length(note) between 1 and 500)
);

alter table public.bid_project_events enable row level security;

create index if not exists bid_project_events_project_created_at_idx
  on public.bid_project_events (bid_project_id, org_id, created_at);
create index if not exists bid_project_events_org_id_idx on public.bid_project_events (org_id);
create index if not exists bid_project_events_actor_id_idx on public.bid_project_events (actor_id);

-- ────────────────────────────────────────────────────────────────
-- 4. tasks.bid_project_id — 체크리스트(M11). 프로젝트가 지워지면 체크리스트도 지운다.
-- ────────────────────────────────────────────────────────────────
alter table public.tasks add column if not exists bid_project_id uuid;
alter table public.tasks drop constraint if exists tasks_bid_project_fkey;
alter table public.tasks
  add constraint tasks_bid_project_fkey foreign key (bid_project_id, org_id)
    references public.bid_projects (id, org_id) on delete cascade;
create index if not exists tasks_bid_project_id_org_id_idx on public.tasks (bid_project_id, org_id);

-- ────────────────────────────────────────────────────────────────
-- 5. audit_logs.action 값 목록
-- ────────────────────────────────────────────────────────────────
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'LOGIN', 'LOGOUT', 'PROFILE_CREATE_REVISION', 'ANALYSIS_REQUEST', 'REVIEW_DECIDE', 'USER_INVITE',
    'USER_DISABLE', 'INGEST_MANUAL', 'NOTIFICATION_READ', 'SEED', 'USER_ROLE_CHANGE',
    'PROJECT_OPEN', 'PROJECT_STATUS_CHANGE', 'PROJECT_RESULT_RECORD'
  ));

-- ────────────────────────────────────────────────────────────────
-- 6. updated_at — 함수·직접 update 모두 DB 가 채운다. 화면 역할에는 이 열의 쓰기 권한이 없다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.set_bid_project_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_bid_project_updated_at() from public, anon, authenticated;

drop trigger if exists bid_projects_set_updated_at on public.bid_projects;
create trigger bid_projects_set_updated_at
  before update on public.bid_projects
  for each row execute function public.set_bid_project_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 7. open_bid_project(review_id) — 열기·다시 열기
--
-- 그 결정이 BID 이고 그 공고의 최신 결정이어야 한다. 아니면 PROJECT_REQUIRES_BID_DECISION.
--   - 프로젝트 없음: PREPARING 으로 만든다. 담당자는 그 결정의 담당자(bid_reviews.assignee_id), 없으면 연 사람이다
--     (UI 스펙 §11-1 추천안). 이력 null→PREPARING, 감사 PROJECT_OPEN. reopened=false.
--   - CLOSED 이고 결정이 종료 뒤: 같은 행을 PREPARING 으로 다시 연다(M12 ③). 여는 결정을 이 결정으로 바꾸고 종료 시각·결과를
--     비운다. 이전 값은 감사 before 에 남는다. 이력 CLOSED→PREPARING. reopened=true.
--   - CLOSED 이고 결정이 종료 전: PROJECT_REQUIRES_BID_DECISION.
--   - 열린 프로젝트 있음: PROJECT_ALREADY_OPEN(detail = 그 id).
-- 결정이 보이지 않는 조직(다른 조직·없는 id)이면 NOT_FOUND, 보이지만 ADMIN·SALES 가 아니면 FORBIDDEN.
-- ────────────────────────────────────────────────────────────────
create or replace function public.open_bid_project(p_review_id uuid)
returns table (project_id uuid, reopened boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.bid_reviews%rowtype;
  v_latest_id uuid;
  v_project public.bid_projects%rowtype;
  v_new_id uuid;
begin
  select r.* into v_review
  from public.bid_reviews r
  where r.id = p_review_id and r.org_id in (select public.my_org_ids());
  if not found or v_uid is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_review.org_id not in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select r.id into v_latest_id
  from public.bid_reviews r
  where r.org_id = v_review.org_id and r.bid_id = v_review.bid_id
  order by r.decided_at desc, r.created_at desc, r.id desc
  limit 1;
  if v_review.decision <> 'BID' or v_latest_id <> v_review.id then
    raise exception 'PROJECT_REQUIRES_BID_DECISION' using errcode = 'P0001';
  end if;

  select p.* into v_project
  from public.bid_projects p
  where p.org_id = v_review.org_id and p.bid_id = v_review.bid_id
  for update;

  if not found then
    insert into public.bid_projects (org_id, bid_id, opened_by_review_id, status, owner_id, created_by)
    values (v_review.org_id, v_review.bid_id, v_review.id, 'PREPARING', coalesce(v_review.assignee_id, v_uid), v_uid)
    on conflict (org_id, bid_id) do nothing
    returning id into v_new_id;
    -- 동시에 다른 요청이 먼저 만들었다.
    if v_new_id is null then
      select p.id into v_new_id from public.bid_projects p
      where p.org_id = v_review.org_id and p.bid_id = v_review.bid_id;
      raise exception 'PROJECT_ALREADY_OPEN' using errcode = 'P0001', detail = v_new_id::text;
    end if;
    insert into public.bid_project_events (org_id, bid_project_id, actor_id, from_status, to_status)
    values (v_review.org_id, v_new_id, v_uid, null, 'PREPARING');
    insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
    values (
      v_review.org_id, v_uid, 'PROJECT_OPEN', 'bid_project', v_new_id,
      jsonb_build_object(
        'before', null,
        'after', jsonb_build_object(
          'bidId', v_review.bid_id, 'openedByReviewId', v_review.id, 'status', 'PREPARING',
          'ownerId', coalesce(v_review.assignee_id, v_uid)
        )
      ),
      public.audit_request_id()
    );
    project_id := v_new_id;
    reopened := false;
    return next;
    return;
  end if;

  if v_project.status <> 'CLOSED' then
    raise exception 'PROJECT_ALREADY_OPEN' using errcode = 'P0001', detail = v_project.id::text;
  end if;
  if v_review.decided_at <= v_project.closed_at then
    raise exception 'PROJECT_REQUIRES_BID_DECISION' using errcode = 'P0001';
  end if;

  update public.bid_projects
  set status = 'PREPARING', opened_by_review_id = v_review.id, closed_at = null,
      result = null, result_note = null, result_recorded_at = null
  where id = v_project.id;
  insert into public.bid_project_events (org_id, bid_project_id, actor_id, from_status, to_status)
  values (v_project.org_id, v_project.id, v_uid, 'CLOSED', 'PREPARING');
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    v_project.org_id, v_uid, 'PROJECT_OPEN', 'bid_project', v_project.id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'status', v_project.status, 'openedByReviewId', v_project.opened_by_review_id,
        'closedAt', v_project.closed_at, 'result', v_project.result, 'resultNote', v_project.result_note,
        'resultRecordedAt', v_project.result_recorded_at
      ),
      'after', jsonb_build_object('status', 'PREPARING', 'openedByReviewId', v_review.id)
    ),
    public.audit_request_id()
  );
  project_id := v_project.id;
  reopened := true;
  return next;
end;
$$;

revoke execute on function public.open_bid_project(uuid) from public, anon, authenticated;
grant execute on function public.open_bid_project(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 8. change_bid_project_status(project_id, to_status, note)
--
-- 전이(D3·M12 ①):
--   - 앞으로 한 칸 PREPARING→SUBMITTED→AWAITING_RESULT: 최신 결정이 BID 일 때만. 아니면 LATEST_DECISION_NOT_BID.
--   - 뒤로 한 칸 SUBMITTED→PREPARING, AWAITING_RESULT→SUBMITTED: 잘못 누른 것을 되돌린다. 결정 검사 없음.
--   - 열린 상태→CLOSED: 언제나(종료는 사람이 한다. 결정이 바뀌어도 자동 종료하지 않는다). closed_at 을 채운다.
--   - 그 밖(같은 상태·두 칸 이상·CLOSED 에서 나가기·모르는 값): INVALID_PROJECT_TRANSITION. 다시 열기는 open_bid_project 다.
-- 메모는 앞뒤 공백을 지우고 비면 null 이다. 1~500자는 표의 check 가 지킨다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.change_bid_project_status(p_project_id uuid, p_to_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.bid_projects%rowtype;
  v_forward text;
  v_back text;
  v_latest text;
  v_note text := nullif(btrim(p_note), '');
begin
  select p.* into v_project
  from public.bid_projects p
  where p.id = p_project_id and p.org_id in (select public.my_org_ids())
  for update;
  if not found or v_uid is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_project.org_id not in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_forward := case v_project.status
    when 'PREPARING' then 'SUBMITTED'
    when 'SUBMITTED' then 'AWAITING_RESULT'
    when 'AWAITING_RESULT' then 'CLOSED'
  end;
  v_back := case v_project.status
    when 'SUBMITTED' then 'PREPARING'
    when 'AWAITING_RESULT' then 'SUBMITTED'
  end;
  -- v_back 은 PREPARING 에서 null 이다. = 로 견주면 null 이 섞여 조건 전체가 null(거짓)이 되므로 is not distinct from 을 쓴다.
  if v_project.status = 'CLOSED'
     or p_to_status is null
     or not (
       p_to_status = 'CLOSED'
       or p_to_status is not distinct from v_forward
       or p_to_status is not distinct from v_back
     ) then
    raise exception 'INVALID_PROJECT_TRANSITION' using errcode = 'P0001',
      detail = v_project.status || '>' || coalesce(p_to_status, '');
  end if;

  if p_to_status = v_forward and p_to_status <> 'CLOSED' then
    select r.decision into v_latest
    from public.bid_reviews r
    where r.org_id = v_project.org_id and r.bid_id = v_project.bid_id
    order by r.decided_at desc, r.created_at desc, r.id desc
    limit 1;
    if v_latest is distinct from 'BID' then
      raise exception 'LATEST_DECISION_NOT_BID' using errcode = 'P0001', detail = coalesce(v_latest, '');
    end if;
  end if;

  update public.bid_projects
  set status = p_to_status,
      closed_at = case when p_to_status = 'CLOSED' then now() else null end
  where id = v_project.id;
  insert into public.bid_project_events (org_id, bid_project_id, actor_id, from_status, to_status, note)
  values (v_project.org_id, v_project.id, v_uid, v_project.status, p_to_status, v_note);
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    v_project.org_id, v_uid, 'PROJECT_STATUS_CHANGE', 'bid_project', v_project.id,
    jsonb_build_object(
      'before', jsonb_build_object('status', v_project.status),
      'after', jsonb_build_object('status', p_to_status, 'note', v_note)
    ),
    public.audit_request_id()
  );
end;
$$;

revoke execute on function public.change_bid_project_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_bid_project_status(uuid, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 9. record_bid_project_result(project_id, result, note) — 결과 기록(D4)
--
-- 어느 상태에서나 기록하고 덮어쓴다. 상태는 바꾸지 않는다. 값 집합·메모 길이는 표의 check 가 지킨다.
-- 이 값은 점수·결정 모델·평가셋·학습셋에 쓰지 않는다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.record_bid_project_result(p_project_id uuid, p_result text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.bid_projects%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  select p.* into v_project
  from public.bid_projects p
  where p.id = p_project_id and p.org_id in (select public.my_org_ids())
  for update;
  if not found or v_uid is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_project.org_id not in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.bid_projects
  set result = p_result, result_note = v_note, result_recorded_at = now()
  where id = v_project.id;
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    v_project.org_id, v_uid, 'PROJECT_RESULT_RECORD', 'bid_project', v_project.id,
    jsonb_build_object(
      'before', jsonb_build_object('result', v_project.result, 'resultNote', v_project.result_note),
      'after', jsonb_build_object('result', p_result, 'resultNote', v_note)
    ),
    public.audit_request_id()
  );
end;
$$;

revoke execute on function public.record_bid_project_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_bid_project_result(uuid, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 10. 권한과 정책
-- ────────────────────────────────────────────────────────────────
revoke all on table public.bid_projects from anon, authenticated, public;
revoke all on table public.bid_project_events from anon, authenticated, public;

grant select on table public.bid_projects to authenticated;
grant select on table public.bid_project_events to authenticated;
-- 상태·결과·여는 결정·시각 열은 쓰기 권한이 없다. 위 함수만 바꾼다.
grant update (owner_id, submission_due_override) on table public.bid_projects to authenticated;

drop policy if exists "조직 입찰 프로젝트 읽기" on public.bid_projects;
create policy "조직 입찰 프로젝트 읽기"
  on public.bid_projects for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

drop policy if exists "ADMIN·SALES 는 입찰 프로젝트 담당자·마감 수정" on public.bid_projects;
create policy "ADMIN·SALES 는 입찰 프로젝트 담당자·마감 수정"
  on public.bid_projects for update
  to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])))
  with check (org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])));

drop policy if exists "조직 입찰 프로젝트 이력 읽기" on public.bid_project_events;
create policy "조직 입찰 프로젝트 이력 읽기"
  on public.bid_project_events for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- tasks: 체크리스트 행(bid_project_id 가 있는 행)은 ADMIN·SALES 만 쓴다(M13).
-- 템플릿 정책(구성원 누구나)은 그대로 두고 restrictive 정책으로 좁힌다. 일반 작업(bid_project_id 없음)은 바뀌지 않는다.
-- bid_project_id 는 insert 때만 정한다. update 열 권한 목록(20261014000004)에 없어 바꾸지 못한다.
grant insert (org_id, title, description, status, due_date, assignee_id, bid_project_id)
  on table public.tasks to authenticated;

drop policy if exists "입찰 프로젝트 체크리스트 추가는 ADMIN·SALES" on public.tasks;
create policy "입찰 프로젝트 체크리스트 추가는 ADMIN·SALES"
  on public.tasks as restrictive for insert
  to authenticated
  with check (bid_project_id is null or org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])));

drop policy if exists "입찰 프로젝트 체크리스트 수정은 ADMIN·SALES" on public.tasks;
create policy "입찰 프로젝트 체크리스트 수정은 ADMIN·SALES"
  on public.tasks as restrictive for update
  to authenticated
  using (bid_project_id is null or org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])))
  with check (bid_project_id is null or org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])));

drop policy if exists "입찰 프로젝트 체크리스트 삭제는 ADMIN·SALES" on public.tasks;
create policy "입찰 프로젝트 체크리스트 삭제는 ADMIN·SALES"
  on public.tasks as restrictive for delete
  to authenticated
  using (bid_project_id is null or org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])));

-- 템플릿 삭제 정책은 만든 사람이나 owner 만이다. 체크리스트는 ADMIN·SALES 가 누가 만든 행이든 지운다.
drop policy if exists "ADMIN·SALES 는 입찰 프로젝트 체크리스트 삭제" on public.tasks;
create policy "ADMIN·SALES 는 입찰 프로젝트 체크리스트 삭제"
  on public.tasks for delete
  to authenticated
  using (bid_project_id is not null and org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])));
