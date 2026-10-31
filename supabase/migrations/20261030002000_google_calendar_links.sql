-- 20261030002000_google_calendar_links — 입찰 일정(/calendar)의 구글 캘린더 연동(ADR-073, 2026-10-30 사용자 결정).
--
-- 근거: polaris/specs/planned/2026-10-30-google-calendar-sync.md, docs/16-DECISIONS.md ADR-073(ADR-018 예외를 구글로 확장).
-- 구글 권한은 Supabase 로그인 연결(linkIdentity)에 캘린더 범위를 얹어 받는다. /auth/callback(flow=google-calendar)이 세션의
-- provider_refresh_token 을 AES-256-GCM 으로 암호화해 이 표에 넣고, 밀어넣기(POST /api/v1/calendar/google/sync)를 처리하는
-- 웹 서버가 같은 사용자 세션으로 암호문을 읽어 복호화한다. DB 에는 평문 토큰을 두지 않는다.
--
-- 카카오 연결(20261023000700)과 다른 점: 카카오는 worker(service role)만 토큰을 읽어 토큰 열을 화면 역할에서 감췄다.
-- 구글은 밀어넣기가 웹 Route Handler(사용자 세션 + RLS)에서 돌므로 본인 행의 암호문을 사용자 세션이 읽는다.
-- 암호문은 서버 전용 키(GOOGLE_TOKEN_ENC_KEY)와 사용자 ID(AAD)에 묶여 있어 브라우저가 그 값을 받아도 풀 수 없고,
-- 다른 사용자 행으로 옮겨도 풀리지 않는다. 쓰기도 본인 행만 RLS 로 연다(security definer RPC 를 늘리지 않는다).
--
-- 이 파일에 든 것:
--   1. google_calendar_links — 사용자 개인 설정이라 조직 표가 아니다. profiles 처럼 user_id 로 소유한다(PK, profiles 삭제 시 함께 지운다).
--      status 는 CONNECTED·EXPIRED(구글 refresh token 이 거부되면 EXPIRED), last_result 는 SYNCED·FAILED·EXPIRED.
--      calendar_id 는 첫 밀어넣기 때 만드는 전용 보조 캘린더("SOL RADAR 입찰 일정")의 id 다. updated_at 은 DB 가 채운다.
--   2. google_calendar_events — 밀어넣은 일정의 매핑(일정 key ↔ 구글 event id). 같은 일정을 두 번 넣지 않고(갱신),
--      그 달에서 사라진 일정을 지우는 데 쓴다. event_date 는 일정의 KST 날짜다(어느 달의 매핑인지 고른다).
--      연결을 해제하면(links 행 삭제) 매핑도 함께 지운다.
--   3. 권한·정책 — 화면 역할(authenticated)은 두 표 모두 본인 행만 읽고 쓴다. anon 은 아무 권한도 없다.
--      서비스 운영자(is_admin)도 남의 행은 못 본다. service_role 은 전부(운영 점검·되돌리기용. 지금 Worker 는 쓰지 않는다).
--
-- 바꾸지 않는 것: kakao_notify_links·다른 표의 권한·정책, auth.identities(구글 로그인 연결 자체는 Supabase Auth 가 가진다).
--
-- 되돌리기(새 마이그레이션으로): google_calendar_events 를 drop 한 뒤 google_calendar_links 를 drop 한다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. google_calendar_links
-- ────────────────────────────────────────────────────────────────
create table if not exists public.google_calendar_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'CONNECTED',
  -- 연결한 구글 계정의 이메일(설정 화면 표시용). 구글이 주지 않으면 null.
  google_email text,
  -- 서버가 암호화한 구글 refresh token. 평문을 넣지 않는다.
  refresh_token_enc text not null,
  -- 전용 보조 캘린더 id. 첫 밀어넣기 전에는 null.
  calendar_id text,
  last_synced_at timestamptz,
  last_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_links_status_check check (status in ('CONNECTED', 'EXPIRED')),
  constraint google_calendar_links_last_result_check check (last_result in ('SYNCED', 'FAILED', 'EXPIRED')),
  constraint google_calendar_links_refresh_token_enc_check check (refresh_token_enc <> '')
);

alter table public.google_calendar_links enable row level security;

drop trigger if exists google_calendar_links_touch_updated_at on public.google_calendar_links;
create trigger google_calendar_links_touch_updated_at
  before update on public.google_calendar_links
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 2. google_calendar_events
-- ────────────────────────────────────────────────────────────────
create table if not exists public.google_calendar_events (
  user_id uuid not null references public.google_calendar_links (user_id) on delete cascade,
  -- 입찰 일정의 key("<종류>:<공고 id|프로젝트 id>")
  event_key text not null,
  google_event_id text not null,
  -- 일정의 KST 날짜. 밀어넣은 달의 매핑만 고르는 데 쓴다.
  event_date date not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, event_key),
  constraint google_calendar_events_event_key_check check (event_key <> ''),
  constraint google_calendar_events_google_event_id_check check (google_event_id <> '')
);

alter table public.google_calendar_events enable row level security;

-- 밀어넣기는 "그 사용자의 그 달" 매핑을 읽는다.
create index if not exists google_calendar_events_user_date_idx
  on public.google_calendar_events (user_id, event_date);

-- ────────────────────────────────────────────────────────────────
-- 3. 권한과 정책
--
-- service_role 역할이 없는 DB(PGlite 정책 시험·타입 생성)에서는 grant 를 건너뛴다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.google_calendar_links from public, anon, authenticated;
revoke all on table public.google_calendar_events from public, anon, authenticated;

grant select, insert, update, delete on table public.google_calendar_links to authenticated;
grant select, insert, update, delete on table public.google_calendar_events to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.google_calendar_links to service_role;
    grant all on table public.google_calendar_events to service_role;
  end if;
end;
$$;

-- 본인 행만. 넣을 때도 user_id 가 본인이어야 한다(남의 user_id 로 행을 만들 수 없다).
drop policy if exists "본인 구글 캘린더 연결 읽기" on public.google_calendar_links;
create policy "본인 구글 캘린더 연결 읽기"
  on public.google_calendar_links for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 연결 만들기" on public.google_calendar_links;
create policy "본인 구글 캘린더 연결 만들기"
  on public.google_calendar_links for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 연결 바꾸기" on public.google_calendar_links;
create policy "본인 구글 캘린더 연결 바꾸기"
  on public.google_calendar_links for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 연결 지우기" on public.google_calendar_links;
create policy "본인 구글 캘린더 연결 지우기"
  on public.google_calendar_links for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 매핑 읽기" on public.google_calendar_events;
create policy "본인 구글 캘린더 매핑 읽기"
  on public.google_calendar_events for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 매핑 만들기" on public.google_calendar_events;
create policy "본인 구글 캘린더 매핑 만들기"
  on public.google_calendar_events for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 매핑 바꾸기" on public.google_calendar_events;
create policy "본인 구글 캘린더 매핑 바꾸기"
  on public.google_calendar_events for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "본인 구글 캘린더 매핑 지우기" on public.google_calendar_events;
create policy "본인 구글 캘린더 매핑 지우기"
  on public.google_calendar_events for delete
  to authenticated
  using (user_id = (select auth.uid()));
