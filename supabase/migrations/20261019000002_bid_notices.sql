-- 20261019000002_bid_notices — 공고(공용) 다섯 표: bid_notices·bid_revisions·bid_documents·bid_structured_requirements·requirement_extractions.
--
-- 근거: docs/04-DATABASE.md §3.3(열·제약), §4(값 집합), §5(인덱스), §7 순서 2. ADR-020 의 열(pre_spec_ref·source 값·
-- 첨부 다운로드/파싱 열·bid_structured_requirements·translations)을 처음부터 넣는다.
--
-- 공고는 조직 소유가 아니다(org_id 없음). 로그인한 활동 중 회원은 읽기만 하고, 쓰기는 worker·seed(service role)만 한다.
-- 나라장터 live 공고(source=g2b-*, is_demo=false)와 fixture 공고(source=fixture, is_demo=true)가 같은 표에 함께 있다.
-- 값 집합은 enum 이 아니라 check 제약이다(이름은 <표>_<열>_check). 원본·추출 텍스트는 MinIO 에 두고 여기엔 키만 적는다.
--
-- 이 파일에 든 것:
--   1. pg_trgm — 제목·기관 trigram 검색용 확장. 확장을 깔 수 있는 서버에서만 extensions 스키마에 깔고, 없으면 인덱스만 건너뛴다.
--      (PGlite 정책 시험·타입 생성은 scripts/supabase-pglite.mjs 가 pg_trgm 을 싣는다. 04 §5 미검증 가정의 검증 경로.)
--   2. bid_notices — 공고 한 건. source+notice_id 로 유일. updated_at 은 DB 가 채운다.
--   3. bid_revisions — 원본·정규화 본문의 버전. 기존 revision 은 고치지 않는다. (id, bid_id) 가 유일해 자식 표가 복합 FK 로 잇는다.
--   4. bid_documents — 첨부. 다운로드와 파싱을 따로 기록한다(한 유형의 실패를 다른 유형으로 뭉뚱그리지 않는다).
--   5. bid_structured_requirements — 공고 API 가 구조화 필드로 준 자격 조건 한 행.
--   6. requirement_extractions — Qwen 추출 결과(revision 단위, 조직과 무관, 재사용).
--   7. 권한·정책 — 다섯 표 모두 활동 중 회원 읽기만. 화면 역할에 쓰기 권한이 없다.
--
-- 되돌리기(새 마이그레이션으로): requirement_extractions → bid_structured_requirements → bid_documents → bid_revisions →
-- bid_notices 순으로 drop 한다. 확장은 다른 표가 쓸 수 있어 지우지 않는다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. pg_trgm
--
-- Supabase 는 확장을 public 이 아니라 extensions 스키마에 깐다(database 스킬). 확장을 제공하지 않는 서버(확장을 싣지 않은
-- PGlite)에서는 건너뛰어 표 생성을 막지 않는다. 인덱스는 확장이 실제로 깔린 스키마의 연산자 클래스를 쓴다.
-- ────────────────────────────────────────────────────────────────
create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    create extension if not exists pg_trgm with schema extensions;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. bid_notices
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_notices (
  id uuid primary key default gen_random_uuid(),
  -- 수집 소스 registry 의 key 와 같은 값(15 §8). fixture 는 가상, g2b-* 는 나라장터.
  source text not null,
  -- 차수를 뺀 공고번호(live 는 bidNtceNo). 차수는 bid_revisions.amendment_no.
  notice_id text not null,
  plan_ref text,
  pre_spec_ref text,
  title text not null,
  agency text,
  stage text not null,
  status text not null,
  -- KRW 정수. API 는 문자열로 내보낸다(04 §1).
  budget_krw numeric(18, 0),
  published_at timestamptz,
  deadline_at timestamptz,
  source_url text not null,
  latest_revision integer not null default 1,
  content_hash text not null,
  is_demo boolean not null default false,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_notices_source_notice_id_key unique (source, notice_id),
  constraint bid_notices_source_check check (source in ('fixture', 'g2b-bid-notice', 'g2b-pre-spec', 'g2b-order-plan')),
  constraint bid_notices_stage_check check (stage in ('PLAN', 'PRE_SPEC', 'NOTICE')),
  constraint bid_notices_status_check check (status in ('OPEN', 'AMENDED', 'CANCELLED', 'CLOSED')),
  constraint bid_notices_budget_krw_check check (budget_krw >= 0),
  constraint bid_notices_latest_revision_check check (latest_revision >= 1)
);

alter table public.bid_notices enable row level security;

-- 목록(단계·상태·게시일), 마감 임박, 출처 필터(origin 은 is_demo, source 는 수집 소스).
create index if not exists bid_notices_stage_status_published_at_idx on public.bid_notices (stage, status, published_at desc);
create index if not exists bid_notices_deadline_at_idx on public.bid_notices (deadline_at);
create index if not exists bid_notices_is_demo_idx on public.bid_notices (is_demo);
create index if not exists bid_notices_source_idx on public.bid_notices (source);

-- 제목·기관 trigram 인덱스. 확장이 깔린 스키마를 찾아 그 연산자 클래스로 만든다. 확장이 없으면 건너뛴다.
do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if ext_schema is not null then
    execute format(
      'create index if not exists bid_notices_title_trgm_idx on public.bid_notices using gin (title %I.gin_trgm_ops)',
      ext_schema
    );
    execute format(
      'create index if not exists bid_notices_agency_trgm_idx on public.bid_notices using gin (agency %I.gin_trgm_ops)',
      ext_schema
    );
  end if;
end;
$$;

-- updated_at 은 DB 가 채운다(템플릿 touch_updated_at, 20261015000001).
drop trigger if exists bid_notices_touch_updated_at on public.bid_notices;
create trigger bid_notices_touch_updated_at
  before update on public.bid_notices
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────
-- 3. bid_revisions
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_revisions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision integer not null,
  -- 차수(live 는 bidNtceOrd). fixture 예: DEMO-2026-0010-02 → "02".
  amendment_no text,
  -- 원본 응답. 담당자 이름·전화·이메일은 넣지 않는다(09 보안).
  raw_payload jsonb not null,
  -- NormalizedBid(15 §3).
  normalized jsonb not null,
  -- NormalizedBid.checksum
  checksum text not null,
  changed_fields text[] not null default '{}',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bid_revisions_bid_id_revision_key unique (bid_id, revision),
  -- 자식 표(첨부·구조화 자격·추출·분석)가 (revision_id, bid_id) 복합 FK 로 가리켜, revision 이 그 공고의 것임을 DB 가 지킨다.
  constraint bid_revisions_id_bid_id_key unique (id, bid_id),
  constraint bid_revisions_revision_check check (revision >= 1)
);

alter table public.bid_revisions enable row level security;

create index if not exists bid_revisions_bid_id_revision_idx on public.bid_revisions (bid_id, revision desc);

-- ────────────────────────────────────────────────────────────────
-- 4. bid_documents
--
-- download_status: PENDING → OK 또는 FAILED. FAILED 면 download_error_code 에 사유(AUTH_REQUIRED·HTTP_4XX·HTTP_5XX·
-- REDIRECT_BLOCKED·HOST_NOT_ALLOWED·TOO_LARGE·TIMEOUT, 값 집합 check 없이 text)를 적고 파일 열은 비운다.
-- parse_status·parse_error_code: gateway POST /parse 결과. 다운로드가 OK 가 되면 PENDING, 그 전(PENDING·FAILED)에는 NULL.
-- format: 확장자가 아니라 내용(매직 바이트)으로 판정한 형식.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_documents (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  name text not null,
  original_url text not null,
  download_status text not null default 'PENDING',
  download_error_code text,
  format text,
  object_key text,
  sha256 text,
  mime_type text,
  size_bytes bigint,
  parse_status text,
  parse_error_code text,
  parser_id text,
  parse_quality jsonb,
  text_object_key text,
  page_count integer,
  created_at timestamptz not null default now(),
  constraint bid_documents_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  -- 다운로드 전·실패 행은 sha256 이 null 이라 걸리지 않는다.
  constraint bid_documents_revision_id_sha256_key unique (revision_id, sha256),
  constraint bid_documents_download_status_check check (download_status in ('PENDING', 'OK', 'FAILED')),
  constraint bid_documents_parse_status_check
    check (parse_status in ('PENDING', 'PARSED', 'PARTIAL', 'UNSUPPORTED', 'FAILED')),
  constraint bid_documents_parse_error_code_check check (parse_error_code in (
    'UNSUPPORTED_FORMAT', 'NO_TEXT_LAYER', 'ENCRYPTED', 'DISTRIBUTION_PROTECTED', 'TOO_LARGE', 'CORRUPTED', 'PARSER_ERROR'
  )),
  -- ADR-020 check: 다운로드 OK 면 파일 열이 있고, 파싱 UNSUPPORTED·FAILED 면 사유가 있다. 파싱은 다운로드 OK 뒤에만 기록한다.
  constraint bid_documents_download_ok_check
    check (download_status <> 'OK' or (object_key is not null and sha256 is not null and size_bytes is not null)),
  constraint bid_documents_parse_failed_check
    check (parse_status not in ('UNSUPPORTED', 'FAILED') or parse_error_code is not null),
  constraint bid_documents_parse_after_download_check check (download_status = 'OK' or parse_status is null),
  constraint bid_documents_size_bytes_check check (size_bytes >= 0),
  constraint bid_documents_page_count_check check (page_count >= 0)
);

alter table public.bid_documents enable row level security;

create index if not exists bid_documents_revision_id_idx on public.bid_documents (revision_id);
create index if not exists bid_documents_bid_id_idx on public.bid_documents (bid_id);
-- documents job 이 재시도 대상(다운로드 대기·파싱 대기)을 찾는다.
create index if not exists bid_documents_download_parse_status_idx on public.bid_documents (download_status, parse_status);

-- ────────────────────────────────────────────────────────────────
-- 5. bid_structured_requirements
--
-- 면허제한·허용 업종·참가가능지역·지역의무공동도급 행. 같은 조건을 Qwen 추출도 주면 이 표가 우선이고, 다르면 CONFLICTED 다(08 §5.1).
-- value 는 그 행의 원본 필드(담당자 필드는 넣지 않는다), source_operation 은 값을 받은 오퍼레이션 이름이다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.bid_structured_requirements (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  kind text not null,
  seq smallint not null,
  code text,
  name text,
  value jsonb not null,
  source_operation text not null,
  created_at timestamptz not null default now(),
  constraint bid_structured_requirements_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  constraint bid_structured_requirements_revision_id_kind_seq_key unique (revision_id, kind, seq),
  constraint bid_structured_requirements_kind_check
    check (kind in ('LICENSE_LIMIT', 'PERMITTED_INDUSTRY', 'PARTICIPATION_REGION', 'REGIONAL_JOINT_CONTRACT')),
  constraint bid_structured_requirements_seq_check check (seq >= 0)
);

alter table public.bid_structured_requirements enable row level security;

create index if not exists bid_structured_requirements_revision_id_idx on public.bid_structured_requirements (revision_id);
create index if not exists bid_structured_requirements_bid_id_idx on public.bid_structured_requirements (bid_id);

-- ────────────────────────────────────────────────────────────────
-- 6. requirement_extractions
--
-- payload 는 RequirementExtraction(03 §4.1), translations 는 자유 텍스트 값의 영어 표기(Record<fieldPath, string>,
-- 숫자 보존 검사를 통과한 것만), warnings 는 03 §4.4 의 코드 목록. PENDING_REVIEW = 인용 실패율 > 50% 또는 파싱 품질 저하.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.requirement_extractions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  provider text not null,
  model_name text not null,
  prompt_version text not null,
  prompt_hash text not null,
  schema_version text not null,
  status text not null default 'PENDING',
  payload jsonb not null default '{}'::jsonb,
  translations jsonb,
  warnings jsonb not null default '[]'::jsonb,
  latency_ms integer not null default 0,
  retries smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint requirement_extractions_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  constraint requirement_extractions_revision_model_prompt_key unique (revision_id, model_name, prompt_hash),
  constraint requirement_extractions_provider_check check (provider in ('MOCK', 'LOCAL', 'HOSTED')),
  constraint requirement_extractions_status_check check (status in ('PENDING', 'COMPLETED', 'PENDING_REVIEW', 'FAILED')),
  constraint requirement_extractions_latency_ms_check check (latency_ms >= 0),
  constraint requirement_extractions_retries_check check (retries >= 0)
);

alter table public.requirement_extractions enable row level security;

create index if not exists requirement_extractions_revision_id_created_at_idx
  on public.requirement_extractions (revision_id, created_at desc);
create index if not exists requirement_extractions_bid_id_idx on public.requirement_extractions (bid_id);

-- ────────────────────────────────────────────────────────────────
-- 7. 권한과 정책
--
-- 기본 권한을 전부 거두고 로그인 역할의 읽기만 다시 준다. 행은 활동 중 회원에게만 열린다(정지되면 공고도 닫힌다).
-- 로그아웃한 사람(anon)은 아무것도 못 한다. 쓰기는 worker·seed(service role, RLS 무시)만 한다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.bid_notices from anon, authenticated, public;
revoke all on table public.bid_revisions from anon, authenticated, public;
revoke all on table public.bid_documents from anon, authenticated, public;
revoke all on table public.bid_structured_requirements from anon, authenticated, public;
revoke all on table public.requirement_extractions from anon, authenticated, public;

grant select on table public.bid_notices to authenticated;
grant select on table public.bid_revisions to authenticated;
grant select on table public.bid_documents to authenticated;
grant select on table public.bid_structured_requirements to authenticated;
grant select on table public.requirement_extractions to authenticated;

drop policy if exists "활동 중 회원은 공고 읽기" on public.bid_notices;
create policy "활동 중 회원은 공고 읽기"
  on public.bid_notices for select
  to authenticated
  using ((select public.is_active_user()));

drop policy if exists "활동 중 회원은 공고 revision 읽기" on public.bid_revisions;
create policy "활동 중 회원은 공고 revision 읽기"
  on public.bid_revisions for select
  to authenticated
  using ((select public.is_active_user()));

drop policy if exists "활동 중 회원은 첨부 읽기" on public.bid_documents;
create policy "활동 중 회원은 첨부 읽기"
  on public.bid_documents for select
  to authenticated
  using ((select public.is_active_user()));

drop policy if exists "활동 중 회원은 구조화 자격 읽기" on public.bid_structured_requirements;
create policy "활동 중 회원은 구조화 자격 읽기"
  on public.bid_structured_requirements for select
  to authenticated
  using ((select public.is_active_user()));

drop policy if exists "활동 중 회원은 추출 읽기" on public.requirement_extractions;
create policy "활동 중 회원은 추출 읽기"
  on public.requirement_extractions for select
  to authenticated
  using ((select public.is_active_user()));
