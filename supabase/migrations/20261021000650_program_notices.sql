-- 20261021000650_program_notices — 부처 지원사업 공고(공용) 두 표: program_notices·program_notice_runs.
--
-- 근거: polaris/specs/in-progress/2026-10-21-agency-program-notices.md §4·§5, docs/plans/2026-10-21-program-notices-plan.md Task 3.
-- 기업마당 지원사업 API(bizinfo)·중소벤처기업부 사업공고 RSS(mss)를 worker 가 모아 두는 자리다.
-- 나라장터 공고 표(bid_notices·bid_revisions)와 수집 run 표(ingest_runs)를 재사용하지 않고 새 표로 둔다. 기존 표에 넣으려면
-- source 값 집합·분석 트리거·ingest_save_revision·ingest_runs 계약을 바꿔야 해서 핵심 컷 경로를 건드리지 않는다는
-- ADR-039 조건 ①에 걸린다.
--
-- 공개 공고라 조직 소유가 아니다(org_id 없음). 로그인한 활동 중 회원은 읽기만 하고, 쓰기는 worker(service role)만 한다.
-- 문의처(기업마당 refrncNm)는 담당자 개인정보라 열을 두지 않는다. summary·apply_method·target 은 worker 가 저장 전에 전화·이메일을
-- 가린 평문이다(09 보안). 원본 응답 전체는 넣지 않는다.
-- 값 집합은 enum 이 아니라 check 제약이다(이름은 <표>_<열>_check, 20261019000002·20261019000006 관례).
--
-- 이 파일에 든 것:
--   1. program_notices — 공고 한 건. (source, source_notice_id) 로 유일해 같은 소스 안의 재수집은 upsert 다. updated_at 은 DB 가 채운다.
--   2. program_notice_runs — 소스별 수집 회차 하나(ingest_runs 와 같은 run_mode·상태 표기). 화면 역할에 열지 않는 내부 표다.
--   3. 권한·정책 — program_notices 는 활동 중 회원 읽기만, program_notice_runs 는 화면 역할에 아무 권한도 없다.
--
-- 되돌리기(새 마이그레이션으로): worker 의 부처 수집 등록(web/worker/main.ts)을 먼저 뺀 뒤 program_notice_runs → program_notices
-- 순으로 drop 한다(두 표 사이 외래 키는 없다). touch_updated_at 함수는 다른 표가 쓰므로 지우지 않는다.
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. program_notices
-- ────────────────────────────────────────────────────────────────
create table if not exists public.program_notices (
  id uuid primary key default gen_random_uuid(),
  -- 부처 소스 설정(infra/sources/program-notices.yaml)의 키. bizinfo = 기업마당, mss = 중소벤처기업부.
  source text not null,
  -- 소스 안의 고유 키. 기업마당 pblancId(없으면 seq), 중기부는 링크의 bcIdx(없으면 링크 sha256 앞 16자).
  source_notice_id text not null,
  title text not null,
  -- 소관기관. 기업마당 jrsdInsttNm, 중기부는 상수 "중소벤처기업부".
  agency text,
  source_url text not null,
  published_at timestamptz,
  -- 신청 기간(KST 날짜). 원문이 "상시"·빈 값 등 날짜가 아니면 null 이다.
  apply_start_on date,
  apply_end_on date,
  summary text,
  apply_method text,
  target text,
  -- 지원분야 대분류 + 해시태그(정규화·중복 제거).
  tags text[] not null default '{}',
  -- 두 소스 사이 같은 공고를 묶는 정규화 키(정규화 제목 + 소관기관). 유일하지 않다 — 묶기는 목록 조회가 한다.
  dedupe_key text not null,
  fetched_at timestamptz not null,
  -- 실제 공고(실호출·녹음 재생)는 false. 나라장터 normalize-g2b 관례를 따른다.
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_notices_source_source_notice_id_key unique (source, source_notice_id),
  constraint program_notices_source_check check (source in ('bizinfo', 'mss')),
  -- 화면이 새 창으로 여는 원문 링크다. javascript:·http: 등을 DB 에서 막는다.
  constraint program_notices_source_url_check check (source_url ~ '^https://')
);

alter table public.program_notices enable row level security;

-- 목록 정렬(마감 빠른 순·등록일 최신 순)과 두 소스 사이 묶기.
create index if not exists program_notices_apply_end_on_idx on public.program_notices (apply_end_on);
create index if not exists program_notices_published_at_idx on public.program_notices (published_at desc);
create index if not exists program_notices_dedupe_key_idx on public.program_notices (dedupe_key);

-- updated_at 은 DB 가 채운다(템플릿 touch_updated_at, 20261015000001).
drop trigger if exists program_notices_touch_updated_at on public.program_notices;
create trigger program_notices_touch_updated_at
  before update on public.program_notices
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 2. program_notice_runs
--
-- 한 회차에서 소스마다 한 행. 한 소스가 실패해도 다른 소스의 행은 따로 남는다.
-- error_code 는 계획 "이름과 값"의 실패 코드(KEY_MISSING·NO_RECORDING·HOST_NOT_ALLOWED·REDIRECT_BLOCKED·HTTP_ERROR·TIMEOUT·
-- TOO_LARGE·RESPONSE_SHAPE·XML_DTD_REJECTED·STORE_FAILED·CONFIG_INVALID)를 쓴다. ingest_errors.error_code 처럼 실제 응답을 본 뒤
-- 늘 수 있어 check 로 묶지 않는다. 요청 URL·키·응답 본문은 남기지 않는다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.program_notice_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  run_mode text not null,
  status text not null,
  error_code text,
  -- 응답에서 읽은 항목 수 · 저장(upsert)한 수 · 필수 필드가 없어 버린 수.
  fetched_count integer not null default 0,
  saved_count integer not null default 0,
  dropped_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint program_notice_runs_source_check check (source in ('bizinfo', 'mss')),
  constraint program_notice_runs_run_mode_check check (run_mode in ('LIVE', 'FIXTURE', 'MOCK')),
  constraint program_notice_runs_status_check check (status in ('SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  constraint program_notice_runs_fetched_count_check check (fetched_count >= 0),
  constraint program_notice_runs_saved_count_check check (saved_count >= 0),
  constraint program_notice_runs_dropped_count_check check (dropped_count >= 0)
);

alter table public.program_notice_runs enable row level security;

-- 소스별 최근 회차.
create index if not exists program_notice_runs_source_started_at_idx
  on public.program_notice_runs (source, started_at desc);

-- ────────────────────────────────────────────────────────────────
-- 3. 권한과 정책
--
-- 기본 권한을 전부 거둔다. program_notices 는 로그인 역할의 읽기만 다시 주고, 행은 활동 중 회원에게만 열린다
-- (bid_notices 의 "활동 중 회원은 공고 읽기"와 같은 대상). 로그아웃한 사람(anon)은 아무것도 못 한다.
-- program_notice_runs 는 화면 역할에 아무것도 주지 않는다(정책도 없다). 쓰기는 두 표 모두 worker(service role, RLS 무시)만 한다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.program_notices from anon, authenticated, public;
revoke all on table public.program_notice_runs from anon, authenticated, public;

grant select on table public.program_notices to authenticated;

drop policy if exists "활동 중 회원은 부처 공고 읽기" on public.program_notices;
create policy "활동 중 회원은 부처 공고 읽기"
  on public.program_notices for select
  to authenticated
  using ((select public.is_active_user()));
