-- 20261019000006_ingest_outbox_notifications_audit — 수집·알림·감사·평가 여섯 표:
-- ingest_runs·ingest_errors·outbox_events·notifications·audit_logs·eval_runs.
--
-- 근거: docs/04-DATABASE.md §3.6·§3.7(열·제약·RLS), §4(값 집합), §5(인덱스), §7 순서 6. ADR-020 의 열
-- (ingest_runs.run_mode·quota_used, eval_runs)을 처음부터 넣는다. docs/13-NOTIFICATIONS.md(알림 idempotency).
--
-- 네 표(ingest_runs·ingest_errors·outbox_events·eval_runs)는 조직 소유가 아니다. ingest_runs·ingest_errors·eval_runs 는
-- 어느 조직에서든 역할 ADMIN 인 사용자가 읽고, outbox_events 는 화면 역할이 읽지도 쓰지도 못하는 내부 표다.
-- notifications 는 본인 것만 읽고 read_at 만 고친다. audit_logs 는 그 조직의 ADMIN 만 읽는다.
-- 쓰기는 모두 worker·seed(service role)와 20261019000007 의 security definer 트리거뿐이다.
--
-- 이 파일에 든 것:
--   1. ingest_runs·ingest_errors — 수집 run 과 격리·오류(PII 없음).
--   2. outbox_events — 알림 팬아웃의 출발점(내부 표).
--   3. notifications — 사용자별 알림. (org_id, user_id) 복합 FK 로 같은 조직 멤버에게만.
--   4. audit_logs — 업무 감사(append-only). 템플릿 activities(조직 피드)와 합치지 않는다.
--   5. eval_runs — 모델 평가 리포트(플랫폼 표, 외래 키 없음).
--   6. 권한·정책.
--
-- 되돌리기(새 마이그레이션으로): 20261019000007 의 트리거를 먼저 지운 뒤 여섯 표를 drop 한다(ingest_errors 가 ingest_runs 보다 먼저).

-- ────────────────────────────────────────────────────────────────
-- 1. ingest_runs · ingest_errors
--
-- source 는 요청한 소스(fixture·g2b). g2b run 하나가 여러 registry 키를 부르므로 키별 오류는 ingest_errors.source_key 에
-- registry 키로 남긴다. batch(SEED·LIVE)는 fixture 에만 있다. quota_used 는 이 run 이 쓴 공공 API 호출 수(fixture 는 0).
-- 수동 수집도 Route Handler 는 job 만 넣고 행은 worker 가 만든다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  run_mode text not null,
  job_key text not null,
  trigger text not null,
  batch text,
  -- g2b run 의 {window:{from,to}, stages:[…]}. 요청이 생략하면 실제 적용한 기본값.
  params jsonb,
  cursor text,
  status text not null default 'RUNNING',
  -- {created, changed, cancelled, skippedDuplicate, quarantined, retried}
  summary jsonb not null default '{}'::jsonb,
  quota_used integer not null default 0,
  requested_by uuid references public.profiles (id) on delete set null,
  idempotency_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ingest_runs_job_key_key unique (job_key),
  constraint ingest_runs_idempotency_key_key unique (idempotency_key),
  constraint ingest_runs_source_check check (source in ('fixture', 'g2b')),
  constraint ingest_runs_run_mode_check check (run_mode in ('LIVE', 'FIXTURE', 'MOCK')),
  constraint ingest_runs_trigger_check check (trigger in ('SCHEDULED', 'MANUAL', 'DEMO')),
  constraint ingest_runs_batch_check check (batch in ('SEED', 'LIVE')),
  constraint ingest_runs_batch_source_check check (batch is null or source = 'fixture'),
  constraint ingest_runs_status_check check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  constraint ingest_runs_quota_used_check check (quota_used >= 0)
);

alter table public.ingest_runs enable row level security;

create index if not exists ingest_runs_started_at_idx on public.ingest_runs (started_at desc);
create index if not exists ingest_runs_requested_by_idx on public.ingest_runs (requested_by);

-- error_code 는 15 §6·04 §3.6 의 코드(MISSING_REQUIRED_FIELD … DUPLICATE, API_HTTP_ERROR … API_TIMEOUT)를 쓴다.
-- P0-0 에서 실제 응답을 본 뒤 세분하므로 check 로 묶지 않는다. result_code 는 공공 API 응답의 resultCode 원문.
-- redacted_detail 에는 담당자 개인정보·서비스키가 들어가지 않는다(worker 가 가린다).
create table if not exists public.ingest_errors (
  id uuid primary key default gen_random_uuid(),
  ingest_run_id uuid not null references public.ingest_runs (id) on delete cascade,
  source_key text not null,
  error_code text not null,
  result_code text,
  redacted_detail text not null default '',
  created_at timestamptz not null default now()
);

alter table public.ingest_errors enable row level security;

create index if not exists ingest_errors_ingest_run_id_idx on public.ingest_errors (ingest_run_id);

-- ────────────────────────────────────────────────────────────────
-- 2. outbox_events
--
-- idempotency_key 는 공고 이벤트면 source+noticeId+revision+eventType(07), 검토 배정이면 reviewId+assigneeUserId+REVIEW_ASSIGNED(05).
-- 같은 키가 다시 오면 UNIQUE 가 거절한다(쓰는 쪽이 on conflict do nothing 으로 흡수한다).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'PENDING',
  attempts smallint not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint outbox_events_idempotency_key_key unique (idempotency_key),
  constraint outbox_events_event_type_check check (event_type in (
    'BID_CREATED', 'BID_CHANGED', 'DEADLINE_APPROACHING', 'ANALYSIS_COMPLETE', 'REVIEW_ASSIGNED'
  )),
  constraint outbox_events_status_check check (status in ('PENDING', 'PROCESSED', 'FAILED', 'DEAD')),
  constraint outbox_events_attempts_check check (attempts >= 0)
);

alter table public.outbox_events enable row level security;

-- worker 가 보낼 것을 찾는다.
create index if not exists outbox_events_status_next_attempt_at_idx on public.outbox_events (status, next_attempt_at);
create index if not exists outbox_events_org_id_idx on public.outbox_events (org_id);

-- ────────────────────────────────────────────────────────────────
-- 3. notifications
--
-- idempotency_key = outboxEventId+userId+channel(13). 수신자는 (org_id, user_id) 복합 FK 로 같은 조직 멤버만이고,
-- 멤버십이 지워지면 알림도 지워진다. 남의 알림은 보이지 않으므로 API 는 404 다. KAKAO 채널은 mock provider 만.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  type text not null,
  channel text not null default 'IN_APP',
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  provider_message_id text,
  error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_recipient_fkey foreign key (org_id, user_id)
    references public.memberships (org_id, user_id) on delete cascade,
  constraint notifications_idempotency_key_key unique (idempotency_key),
  constraint notifications_type_check check (type in (
    'BID_CREATED', 'BID_CHANGED', 'DEADLINE_APPROACHING', 'ANALYSIS_COMPLETE', 'REVIEW_ASSIGNED'
  )),
  constraint notifications_channel_check check (channel in ('IN_APP', 'KAKAO')),
  constraint notifications_status_check check (status in ('PENDING', 'SENT', 'FAILED', 'DEAD'))
);

alter table public.notifications enable row level security;

-- 내 알림을 안 읽은 것부터 최근순으로. 멤버십이 지워질 때 외래 키가 수신자를 찾는 일.
create index if not exists notifications_user_id_read_at_created_at_idx
  on public.notifications (user_id, read_at nulls first, created_at desc);
create index if not exists notifications_org_id_user_id_idx on public.notifications (org_id, user_id);

-- ────────────────────────────────────────────────────────────────
-- 4. audit_logs — append-only. IP·토큰·원문은 적지 않는다.
--
-- action 값과 쓰는 곳은 04 §3.6 표. request_id 는 요청 헤더 x-request-id(14 관측성의 requestId)이고 없으면 null 이다.
-- actor_id 는 요청한 사람(auth.uid()). seed·worker 처럼 JWT 가 없으면 null 이다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  before_after jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_check check (action in (
    'LOGIN', 'LOGOUT', 'PROFILE_CREATE_REVISION', 'ANALYSIS_REQUEST', 'REVIEW_DECIDE', 'USER_INVITE',
    'USER_DISABLE', 'INGEST_MANUAL', 'NOTIFICATION_READ', 'SEED'
  ))
);

alter table public.audit_logs enable row level security;

create index if not exists audit_logs_org_id_created_at_idx on public.audit_logs (org_id, created_at desc);
create index if not exists audit_logs_target_type_target_id_idx on public.audit_logs (target_type, target_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);

-- ────────────────────────────────────────────────────────────────
-- 5. eval_runs — 평가셋 원문(실제 RFP)은 넣지 않는다. metrics 는 지표마다 값·95% 신뢰구간·표본 수.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null,
  dataset_sha256 text not null,
  -- 비교 대상 ID(E0 규칙만, E1 Kev-9B 영어 state, E2 한국어 state, E3 Qwen 분류 …, 21 §4.2)
  system_id text not null,
  split text not null,
  metrics jsonb not null default '{}'::jsonb,
  -- 예약어 commit 을 피한 이름.
  git_commit text not null,
  created_at timestamptz not null default now(),
  constraint eval_runs_split_check check (split in ('train', 'dev', 'test'))
);

alter table public.eval_runs enable row level security;

create index if not exists eval_runs_dataset_version_system_id_split_idx on public.eval_runs (dataset_version, system_id, split);
create index if not exists eval_runs_created_at_idx on public.eval_runs (created_at desc);

-- ────────────────────────────────────────────────────────────────
-- 6. 권한과 정책
-- ────────────────────────────────────────────────────────────────
revoke all on table public.ingest_runs from anon, authenticated, public;
revoke all on table public.ingest_errors from anon, authenticated, public;
revoke all on table public.outbox_events from anon, authenticated, public;
revoke all on table public.notifications from anon, authenticated, public;
revoke all on table public.audit_logs from anon, authenticated, public;
revoke all on table public.eval_runs from anon, authenticated, public;

grant select on table public.ingest_runs to authenticated;
grant select on table public.ingest_errors to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.eval_runs to authenticated;
-- outbox_events: 화면 역할에 아무 권한도 주지 않는다(정책도 없다).

-- 공용 운영 표: 어느 조직에서든 ADMIN 이면 읽는다. 바깥 행과 상관없는 하위 질의라 질의마다 한 번 계산된다.
drop policy if exists "ADMIN 은 수집 run 읽기" on public.ingest_runs;
create policy "ADMIN 은 수집 run 읽기"
  on public.ingest_runs for select
  to authenticated
  using (exists (select 1 from public.my_sol_org_ids(array['ADMIN'])));

drop policy if exists "ADMIN 은 수집 오류 읽기" on public.ingest_errors;
create policy "ADMIN 은 수집 오류 읽기"
  on public.ingest_errors for select
  to authenticated
  using (exists (select 1 from public.my_sol_org_ids(array['ADMIN'])));

drop policy if exists "ADMIN 은 평가 결과 읽기" on public.eval_runs;
create policy "ADMIN 은 평가 결과 읽기"
  on public.eval_runs for select
  to authenticated
  using (exists (select 1 from public.my_sol_org_ids(array['ADMIN'])));

-- 알림: 본인 것만, 그리고 아직 그 조직의 멤버일 때만. 고칠 수 있는 열은 read_at 뿐이다(열 권한).
drop policy if exists "본인 알림 읽기" on public.notifications;
create policy "본인 알림 읽기"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()));

drop policy if exists "본인 알림 읽음 처리" on public.notifications;
create policy "본인 알림 읽음 처리"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()))
  with check (user_id = (select auth.uid()) and org_id in (select public.my_org_ids()));

-- 감사: 그 조직의 ADMIN 만 읽는다. 운영자(is_admin)도 남의 조직 것은 읽지 못한다.
drop policy if exists "ADMIN 은 조직 감사 읽기" on public.audit_logs;
create policy "ADMIN 은 조직 감사 읽기"
  on public.audit_logs for select
  to authenticated
  using (org_id in (select public.my_sol_org_ids(array['ADMIN'])));
