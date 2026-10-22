-- 20261023000702_kakao_notify_hardening — 카카오톡 알림 연결 RPC 보강(보안 검토 2026-10-21): 저장 입력 검사와 시험 메시지 하루 상한.
--
-- 근거: docs/plans/2026-10-20-kakao-memo-notify-design.md §7(데이터·RPC)·§9(시험 메시지), docs/16-DECISIONS.md ADR-038,
-- 보안 검토(세션 54, 읽기 전용) 지적 4번. 20261023000700 은 고치지 않는다(append-only).
--
-- 이 파일에 든 것:
--   1. save_kakao_notify_link 를 다시 만든다(시그니처·security definer·search_path·권한 그대로). 들어오는 값을 검사한다 —
--      토큰 둘·만료 둘이 not null, 토큰 둘이 'v1.' 로 시작(kakao-token.crypto 의 v1.<kid>.<iv>.<tag>.<ciphertext>),
--      각 토큰 길이 4096자 이하. 아니면 KAKAO_LINK_INVALID 로 거절하고 행을 바꾸지 않는다(이미 있는 연결도 그대로다).
--      로그인 확인(UNAUTHENTICATED)이 먼저다. 이제 20261023000700 §1 주석의 "토큰 열이 null 인 CONNECTED 행은 RPC 로는
--      생기지 않는다" 가 참이 된다(전에는 null 을 넘기면 생겼다). 표는 여전히 null 을 허용한다 — worker(service role)는 RPC 를
--      거치지 않는다.
--   2. request_kakao_notify_test 를 다시 만든다. 같은 사용자(aggregate_id = auth.uid())의 KAKAO_TEST outbox 가 최근 24시간에
--      10건 이상이면(상태와 상관없이) 넣지 않고 false 를 돌려준다. API 는 false 를 429 KAKAO_TEST_THROTTLED 로 바꾼다
--      (같은 분 중복이 false 인 것은 그대로다). 세기 전에 본인 연결 행을 잠가(for update) 같은 사용자의 동시 요청이 상한을
--      함께 넘지 못하게 한다. 준비 확인(KAKAO_NOT_READY)·키·payload 는 20261023000700 과 같다.
--   3. 두 함수의 권한 줄(revoke/grant)을 20261023000700 과 같게 다시 쓴다. create or replace 는 권한을 지키지만 다시 적어도 같다.
--
-- 바꾸지 않는 것: kakao_notify_links 의 열·권한·정책, set_kakao_notify_enabled·disconnect_kakao_notify, outbox_events,
-- 함수 시그니처(scripts/db-verify.mjs 의 ALLOWED_DEFINER_FUNCTIONS 와 web/lib/database.types.ts 가 그대로다).
--
-- 되돌리기(새 마이그레이션으로): 두 함수를 20261023000700 의 본문으로 다시 create or replace 하고 같은 권한 줄을 적는다.
-- 이미 쌓인 outbox 와 연결 행은 그대로 둔다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. 연결 저장 — 카카오 콜백(웹 서버)이 토큰을 암호화한 뒤 부른다. 재연결이면 같은 행을 바꾼다.
-- last_sent_at·last_result 는 지난 발송 기록이라 그대로 둔다.
-- ────────────────────────────────────────────────────────────────
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
  -- 암호문 한 개의 최대 길이. v1 암호문은 고정 머리 55자(v1·kid·iv·tag 와 점)와 원문의 4/3 배다.
  -- 넉넉한 상한으로 큰 값이 표를 불리지 않게 막는다.
  c_max_token_length constant integer := 4096;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_access_token_enc is null
    or p_refresh_token_enc is null
    or p_access_expires_at is null
    or p_refresh_expires_at is null
    or p_access_token_enc not like 'v1.%'
    or p_refresh_token_enc not like 'v1.%'
    or length(p_access_token_enc) > c_max_token_length
    or length(p_refresh_token_enc) > c_max_token_length
  then
    raise exception 'KAKAO_LINK_INVALID';
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

-- ────────────────────────────────────────────────────────────────
-- 2. 시험 메시지 요청 — worker 의 알림 소비자가 KAKAO_TEST 를 받아 본인에게 한 통 보내고 결과를 last_result 에 적는다.
-- 키는 UTC 분 단위라 같은 분에 여러 번 눌러도 한 건이다(now() 는 트랜잭션 시작 시각). 최근 24시간에 10건이면 더 넣지 않는다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.request_kakao_notify_test()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
  -- 한 사용자가 24시간에 넣을 수 있는 시험 메시지 수.
  c_daily_limit constant integer := 10;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- 본인 행을 잠근다. 같은 사용자의 동시 요청은 여기서 줄을 서고, 뒤 요청은 앞 요청이 넣은 행까지 센다.
  perform 1
  from public.kakao_notify_links k
  where k.user_id = v_uid
    and k.status = 'CONNECTED'
    and k.enabled
  for update;
  if not found then
    raise exception 'KAKAO_NOT_READY';
  end if;

  select count(*)
  into v_recent
  from public.outbox_events o
  where o.aggregate_id = v_uid
    and o.event_type = 'KAKAO_TEST'
    and o.created_at > now() - interval '24 hours';
  if v_recent >= c_daily_limit then
    return false;
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
revoke execute on function public.request_kakao_notify_test() from public, anon, authenticated;

grant execute on function public.save_kakao_notify_link(text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.request_kakao_notify_test() to authenticated;
