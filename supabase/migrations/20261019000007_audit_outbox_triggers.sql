-- 20261019000007_audit_outbox_triggers — 감사(audit_logs)·outbox 를 남기는 트리거.
--
-- 근거: docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 트리거로 한 트랜잭션에), §3.4 bid_reviews, §3.6 audit_logs.action 표,
-- §7 순서 7. docs/05-API-SPEC.md POST /bids/:id/reviews(REVIEW_ASSIGNED idempotency = reviewId+assigneeUserId+REVIEW_ASSIGNED).
--
-- 화면 역할에는 audit_logs·outbox_events 의 쓰기 권한이 없다. 트리거 함수가 security definer 라 함수 주인 권한으로 넣는다
-- (템플릿 activities 트리거와 같은 방식). 행위자는 요청한 사람(auth.uid())이고 JWT 가 없는 seed·worker 면 비어 있다.
-- 트리거 함수는 /rpc 로도 SQL 로도 직접 부를 수 없지만 실행 권한도 거둔다.
--
-- 이 파일에 든 것:
--   1. audit_request_id() — 요청 헤더 x-request-id(PostgREST 의 request.headers). 없으면 null.
--   2. PROFILE_CREATE_REVISION — company_profiles insert.
--   3. ANALYSIS_REQUEST — score_runs insert.
--   4. bid_reviews — BEFORE INSERT 가 system_recommendation·disagreement_flag 를 score_run 에서 채우고,
--      AFTER INSERT 가 REVIEW_DECIDE 감사와(담당자가 있을 때) REVIEW_ASSIGNED outbox 1건을 같은 트랜잭션에 쓴다.
--   5. USER_INVITE — invitations insert.
--   6. NOTIFICATION_READ — notifications.read_at 변경.
--
-- 남기지 않는 것: LOGIN·LOGOUT(지점 미정, 04 §3.1 Phase 1 결정 4), USER_DISABLE(경로 미정, 결정 3), INGEST_MANUAL 과 SEED 는
-- worker·seed 가 service role 로 직접 넣는다.
-- 되돌리기(새 마이그레이션으로): 아래 트리거와 함수를 drop 한다.

-- ────────────────────────────────────────────────────────────────
-- 1. audit_request_id()
--
-- PostgREST 는 요청 헤더를 request.headers 설정에 JSON 으로 싣는다. 헤더가 없거나(worker·seed·시험) 설정이 없으면 null 이다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.audit_request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id';
$$;

revoke execute on function public.audit_request_id() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. PROFILE_CREATE_REVISION
-- ────────────────────────────────────────────────────────────────
create or replace function public.log_company_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, auth.uid(), 'PROFILE_CREATE_REVISION', 'company_profile', new.id,
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'revision', new.revision, 'name', new.name, 'effectiveAt', new.effective_at, 'isDemo', new.is_demo,
        'technologiesComplete', new.technologies_complete
      )
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_company_profile_audit() from public, anon, authenticated;

drop trigger if exists company_profiles_log_audit on public.company_profiles;
create trigger company_profiles_log_audit
  after insert on public.company_profiles
  for each row execute function public.log_company_profile_audit();

-- ────────────────────────────────────────────────────────────────
-- 3. ANALYSIS_REQUEST
-- ────────────────────────────────────────────────────────────────
create or replace function public.log_score_run_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, auth.uid(), 'ANALYSIS_REQUEST', 'score_run', new.id,
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'bidId', new.bid_id, 'revisionId', new.revision_id, 'companyProfileId', new.company_profile_id,
        'profileRevision', new.profile_revision, 'extractionId', new.extraction_id,
        'algorithmVersion', new.algorithm_version, 'runMode', new.run_mode, 'aiProvider', new.ai_provider,
        'status', new.status, 'idempotencyKey', new.idempotency_key
      )
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_score_run_audit() from public, anon, authenticated;

drop trigger if exists score_runs_log_audit on public.score_runs;
create trigger score_runs_log_audit
  after insert on public.score_runs
  for each row execute function public.log_score_run_audit();

-- ────────────────────────────────────────────────────────────────
-- 4. bid_reviews
--
-- BEFORE INSERT: score_run_id 가 있으면 그 run 이 같은 조직·같은 공고의 것인지 보고(복합 FK 는 조직만 본다) 권고를 옮겨 적는다.
-- 권고와 다른 결정이면 disagreement_flag = true, 권고가 없으면 false. 화면 역할은 두 열을 쓰지 못하므로 늘 이 값이다.
-- seed·worker 가 run 없이 system_recommendation 을 직접 넣으면 그 값을 쓴다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.prepare_bid_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run record;
begin
  if new.score_run_id is not null then
    select s.org_id, s.bid_id, s.recommendation into run
    from public.score_runs s
    where s.id = new.score_run_id;
    if not found or run.org_id <> new.org_id or run.bid_id <> new.bid_id then
      raise exception '분석 run 이 이 조직·공고의 것이 아닙니다'
        using errcode = '23503', hint = 'score_run_mismatch';
    end if;
    new.system_recommendation := run.recommendation;
  end if;
  new.disagreement_flag := coalesce(new.decision <> new.system_recommendation, false);
  return new;
end;
$$;

revoke execute on function public.prepare_bid_review() from public, anon, authenticated;

drop trigger if exists bid_reviews_prepare on public.bid_reviews;
create trigger bid_reviews_prepare
  before insert on public.bid_reviews
  for each row execute function public.prepare_bid_review();

-- AFTER INSERT: REVIEW_DECIDE 감사 + 담당자가 있을 때 REVIEW_ASSIGNED outbox 1건. 같은 키가 다시 오면 outbox 는 한 건만 남는다.
create or replace function public.log_bid_review_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, auth.uid(), 'REVIEW_DECIDE', 'bid_review', new.id,
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'bidId', new.bid_id, 'revisionId', new.revision_id, 'scoreRunId', new.score_run_id,
        'decision', new.decision, 'systemRecommendation', new.system_recommendation,
        'disagreementFlag', new.disagreement_flag, 'assigneeId', new.assignee_id, 'reason', new.reason
      )
    ),
    public.audit_request_id()
  );
  if new.assignee_id is not null then
    insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
    values (
      new.org_id, 'bid_review', new.id, 'REVIEW_ASSIGNED',
      jsonb_build_object(
        'reviewId', new.id, 'bidId', new.bid_id, 'orgId', new.org_id, 'assigneeUserId', new.assignee_id,
        'reviewerId', new.reviewer_id, 'decision', new.decision
      ),
      new.id::text || ':' || new.assignee_id::text || ':REVIEW_ASSIGNED'
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.log_bid_review_audit() from public, anon, authenticated;

drop trigger if exists bid_reviews_log_audit on public.bid_reviews;
create trigger bid_reviews_log_audit
  after insert on public.bid_reviews
  for each row execute function public.log_bid_review_audit();

-- ────────────────────────────────────────────────────────────────
-- 5. USER_INVITE — 초대한 사람(invited_by)이 행위자다. 감사는 그 조직의 ADMIN 만 읽으므로 초대 이메일을 남긴다
-- (템플릿 activities 는 멤버 모두가 읽어 이메일을 남기지 않는다).
-- ────────────────────────────────────────────────────────────────
create or replace function public.log_invitation_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, coalesce(auth.uid(), new.invited_by), 'USER_INVITE', 'invitation', new.id,
    jsonb_build_object(
      'before', null,
      'after', jsonb_build_object(
        'email', new.email, 'orgRole', new.org_role, 'solRole', new.sol_role, 'expiresAt', new.expires_at
      )
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_invitation_audit() from public, anon, authenticated;

drop trigger if exists invitations_log_audit on public.invitations;
create trigger invitations_log_audit
  after insert on public.invitations
  for each row execute function public.log_invitation_audit();

-- ────────────────────────────────────────────────────────────────
-- 6. NOTIFICATION_READ — read_at 이 바뀔 때만.
-- ────────────────────────────────────────────────────────────────
create or replace function public.log_notification_read_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
  values (
    new.org_id, auth.uid(), 'NOTIFICATION_READ', 'notification', new.id,
    jsonb_build_object(
      'before', jsonb_build_object('readAt', old.read_at),
      'after', jsonb_build_object('readAt', new.read_at)
    ),
    public.audit_request_id()
  );
  return null;
end;
$$;

revoke execute on function public.log_notification_read_audit() from public, anon, authenticated;

drop trigger if exists notifications_log_read_audit on public.notifications;
create trigger notifications_log_read_audit
  after update of read_at on public.notifications
  for each row
  when (old.read_at is distinct from new.read_at)
  execute function public.log_notification_read_audit();
