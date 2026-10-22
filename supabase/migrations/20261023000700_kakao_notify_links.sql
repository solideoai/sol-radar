-- 20261023000700_kakao_notify_links — 카카오톡 추천 공고 알림(나에게 보내기)의 사용자별 연결 표와 화면이 부르는 RPC 넷.
--
-- 근거: docs/plans/2026-10-20-kakao-memo-notify-design.md §7(데이터·RLS·권한·RPC)·§5.2(받는 사람)·§9(시험 메시지),
-- docs/plans/2026-10-20-kakao-memo-notify-plan.md Task 1 Interfaces, docs/16-DECISIONS.md ADR-038(채택)·ADR-018 예외(카카오 키·
-- 토큰 암호화 키를 웹 서버·worker env 에 둔다, 사용자 승인 2026-10-20 조정 세션 sol-radar-12 전달).
-- 카카오 연결은 Supabase 로그인과 따로 하는 OAuth(scope=talk_message)다. 토큰은 웹 서버가 AES-256-GCM 으로 암호화해 이 표에
-- 넣고 worker(service role)만 복호화한다. DB 에는 평문 토큰을 두지 않는다.
--
-- 이 파일에 든 것:
--   1. kakao_notify_links — 사용자 개인 설정이라 조직 표가 아니다. profiles 처럼 user_id 로 소유한다(PK, profiles 삭제 시 함께 지운다).
--      status 는 CONNECTED·EXPIRED, last_result 는 SENT·FAILED·EXPIRED. updated_at 은 DB 가 채운다(touch_updated_at, 20261015000001).
--   2. 권한·정책 — 화면 역할(authenticated)은 본인 행만, 열 여섯 개(user_id, enabled, status, last_sent_at, last_result, updated_at)만
--      읽는다. 토큰·만료·created_at 열은 읽지 못하고, 표에 직접 insert·update·delete 하지 못한다. anon 은 아무 권한도 없다.
--      worker 의 service_role 은 전부(읽기·상태·토큰 갱신·last_* 기록).
--   3. RPC 넷 — 화면 역할의 쓰기는 이것으로만 한다. 모두 security definer·search_path = ''·로그인 역할만 실행하고,
--      auth.uid() 가 없으면 UNAUTHENTICATED 로 거절한다. 다루는 행은 부른 사람(auth.uid()) 자신의 것 하나뿐이다.
--        save_kakao_notify_link(암호문 둘, 만료 둘)  — 콜백이 부른다. 본인 행 upsert, status CONNECTED, enabled true.
--        set_kakao_notify_enabled(boolean)          — 켜기는 행이 있고 CONNECTED 일 때만(아니면 KAKAO_NOT_CONNECTED).
--                                                     끄기는 행이 있으면 늘 된다(행이 없으면 아무것도 하지 않는다).
--        disconnect_kakao_notify()                  — 본인 행을 지운다(카카오 unlink 는 부르지 않는다).
--        request_kakao_notify_test()                — 본인 행이 CONNECTED·켬이면 outbox KAKAO_TEST 1건(org_id null,
--                                                     aggregate kakao_notify_link·uid, payload {userId}, 키 '<uid>:<UTC 분>:KAKAO_TEST').
--                                                     같은 분의 같은 키면 넣지 않고 false. 준비가 안 됐으면 KAKAO_NOT_READY.
--      화면 역할은 outbox_events 에 권한이 없으므로(20261019000006 §6) 시험 메시지는 이 RPC 가 본인 것만 넣는다.
--      outbox_events 의 KAKAO_TEST 종류는 20261023000701 가 check 에 더한다. 이 파일만 적용한 DB 에서 request_kakao_notify_test 는
--      check 위반으로 실패한다(두 파일은 함께 적용한다).
--      네 함수는 scripts/db-verify.mjs 의 허용 목록(ALLOWED_DEFINER_FUNCTIONS)에 이유와 함께 올라 있다.
--
-- 바꾸지 않는 것: 다른 표의 권한·정책, outbox_events·notifications 의 열.
--
-- 되돌리기(새 마이그레이션으로): 네 함수(save_kakao_notify_link(text, text, timestamptz, timestamptz)·set_kakao_notify_enabled(boolean)·
-- disconnect_kakao_notify()·request_kakao_notify_test())를 drop 하고 kakao_notify_links 를 drop 한다. 이미 쌓인 KAKAO_TEST outbox 는
-- 그대로 둔다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. kakao_notify_links
--
-- 토큰 열은 서버가 암호화한 값(text)이다. 만료 시각은 카카오 응답의 초 값으로 서버가 계산한다. 연결 해제는 행을 지우므로
-- 토큰 열이 null 인 CONNECTED 행은 RPC 로는 생기지 않는다(worker 가 갱신 실패로 토큰을 비울 수는 있어 null 을 허용한다).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.kakao_notify_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  status text not null,
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_sent_at timestamptz,
  last_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kakao_notify_links_status_check check (status in ('CONNECTED', 'EXPIRED')),
  constraint kakao_notify_links_last_result_check check (last_result in ('SENT', 'FAILED', 'EXPIRED'))
);

alter table public.kakao_notify_links enable row level security;

-- 정책이 거르는 user_id 는 기본 키라 인덱스가 이미 있다.

drop trigger if exists kakao_notify_links_touch_updated_at on public.kakao_notify_links;
create trigger kakao_notify_links_touch_updated_at
  before update on public.kakao_notify_links
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 2. 권한과 정책
--
-- 표 단위 revoke 는 열 단위 권한도 함께 거두므로(PostgreSQL REVOKE) 다시 적용해도 결과는 같은 열 여섯 개다.
-- service_role 역할이 없는 DB(PGlite 정책 시험·타입 생성)에서는 grant 를 건너뛴다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.kakao_notify_links from anon, authenticated, public;

grant select (
  user_id,
  enabled,
  status,
  last_sent_at,
  last_result,
  updated_at
) on table public.kakao_notify_links to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.kakao_notify_links to service_role;
  end if;
end;
$$;

-- 본인 행만. 서비스 운영자(is_admin)도 남의 행은 읽지 못한다.
drop policy if exists "본인 카카오 알림 연결 읽기" on public.kakao_notify_links;
create policy "본인 카카오 알림 연결 읽기"
  on public.kakao_notify_links for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ────────────────────────────────────────────────────────────────
-- 3. RPC 넷
--
-- 화면 역할에는 표의 쓰기 권한이 없어 security definer 로 정해진 전이만 연다. 대상은 늘 auth.uid() 의 행 하나다.
-- ────────────────────────────────────────────────────────────────

-- 3-1. 연결 저장 — 카카오 콜백(웹 서버)이 토큰을 암호화한 뒤 부른다. 재연결이면 같은 행을 바꾼다.
-- last_sent_at·last_result 는 지난 발송 기록이라 그대로 둔다.
create or replace function public.save_kakao_notify_link(
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  insert into public.kakao_notify_links as k (
    user_id, enabled, status, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at
  )
  values (v_uid, true, 'CONNECTED', p_access_token_enc, p_refresh_token_enc, p_access_expires_at, p_refresh_expires_at)
  on conflict (user_id) do update
  set enabled = true,
      status = 'CONNECTED',
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      access_expires_at = excluded.access_expires_at,
      refresh_expires_at = excluded.refresh_expires_at;
end;
$$;

-- 3-2. 켜기·끄기 — 켜기는 연결이 정상(CONNECTED)일 때만. 끄기는 만료된 행에서도 된다.
-- p_enabled 가 null 이면 끄기 쪽으로 가서 enabled not null 위반(23502)으로 거절된다(행이 없으면 아무것도 하지 않는다).
create or replace function public.set_kakao_notify_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_enabled then
    update public.kakao_notify_links k
    set enabled = true
    where k.user_id = v_uid
      and k.status = 'CONNECTED';
    if not found then
      raise exception 'KAKAO_NOT_CONNECTED';
    end if;
  else
    update public.kakao_notify_links k
    set enabled = p_enabled
    where k.user_id = v_uid;
  end if;
end;
$$;

-- 3-3. 연결 해제 — 본인 행을 지운다. 행이 없어도 오류가 아니다.
create or replace function public.disconnect_kakao_notify()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  delete from public.kakao_notify_links k
  where k.user_id = v_uid;
end;
$$;

-- 3-4. 시험 메시지 요청 — worker 의 알림 소비자가 KAKAO_TEST 를 받아 본인에게 한 통 보내고 결과를 last_result 에 적는다.
-- 키는 UTC 분 단위라 같은 분에 여러 번 눌러도 한 건이다(now() 는 트랜잭션 시작 시각).
create or replace function public.request_kakao_notify_test()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not exists (
    select 1
    from public.kakao_notify_links k
    where k.user_id = v_uid
      and k.status = 'CONNECTED'
      and k.enabled
  ) then
    raise exception 'KAKAO_NOT_READY';
  end if;

  insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (
    null,
    'kakao_notify_link',
    v_uid,
    'KAKAO_TEST',
    jsonb_build_object('userId', v_uid),
    v_uid::text || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') || ':KAKAO_TEST'
  )
  on conflict (idempotency_key) do nothing;

  return found;
end;
$$;

-- 화면 역할과 PUBLIC 에서 모두 거두고 로그인 역할에만 준다(Supabase 는 public 의 새 함수에 화면 역할 실행 권한을 따로 준다).
revoke execute on function public.save_kakao_notify_link(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_kakao_notify_enabled(boolean) from public, anon, authenticated;
revoke execute on function public.disconnect_kakao_notify() from public, anon, authenticated;
revoke execute on function public.request_kakao_notify_test() from public, anon, authenticated;

grant execute on function public.save_kakao_notify_link(text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_kakao_notify_enabled(boolean) to authenticated;
grant execute on function public.disconnect_kakao_notify() to authenticated;
grant execute on function public.request_kakao_notify_test() to authenticated;
