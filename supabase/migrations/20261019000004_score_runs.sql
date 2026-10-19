-- 20261019000004_score_runs — 분석 결과(조직별) 네 표: score_runs·score_factors·qualification_checks·requirement_assessments.
--
-- 근거: docs/04-DATABASE.md §3.4(열·제약), §4(값 집합), §5(인덱스·부분 UNIQUE·복합 FK), §7 순서 4. ADR-020 의 열
-- (run_mode·kev_calibration·fallback_reason·reason_code·company_evidence·basis)과 표(requirement_assessments)를 처음부터 넣는다.
--
-- AI·점수 결과는 덮어쓰지 않고 새 score_runs 행으로 쌓는다. 재현에 필요한 입력은 input_snapshot(AnalysisInput)에 넣는다.
-- 요청 행(status=QUEUED)은 역할 ADMIN·SALES·ANALYST 가 사용자 세션으로 넣고(열 단위 권한으로 결과 열 제외),
-- 상태 전이와 결과 열은 worker(service role)만 갱신한다. 자식 세 표는 worker 만 쓴다.
-- worker 는 RLS 없이 쓰므로 자식 행의 org_id 가 부모와 다르면 복합 FK 가 거절한다(테넌트 혼입 방지).
-- Kev 의 분포·라벨(requirement_assessments.kev_*)은 참고 지표다. rule_status·점수·권고를 바꾸지 않는다(ADR-004·020).
--
-- 이 파일에 든 것:
--   1. score_runs — 분석 run. 부분 UNIQUE 로 같은 입력의 진행 중 job 을 하나로 묶는다.
--   2. score_factors — 요소별 점수 분해(다섯 요소).
--   3. qualification_checks — 필수 자격 판정.
--   4. requirement_assessments — 요구사항 항목별 규칙 판정·근거·Kev 참고 지표.
--   5. 권한·정책.
--
-- 감사 기록(ANALYSIS_REQUEST)은 audit_logs 가 생긴 뒤 20261019000007 의 트리거가 남긴다.
-- 되돌리기(새 마이그레이션으로): bid_reviews.score_run_id FK 를 먼저 지운 뒤 네 표를 자식부터 drop 한다.

-- ────────────────────────────────────────────────────────────────
-- 1. score_runs
--
-- input_snapshot·input_snapshot_hash 는 worker 가 계산을 시작할 때 채운다(요청 시점에는 없다). 그래서 null 을 허용하되
-- COMPLETED·PARTIAL 로 끝난 run 에는 반드시 있어야 한다(check). fallback_reason 이 있으면 ai_provider=MOCK, run_mode<>LIVE,
-- review_flags 에 MOCK_FALLBACK 이 함께 있어야 한다(ADR-020 check).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.score_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  company_profile_id uuid not null,
  profile_revision integer not null,
  extraction_id uuid references public.requirement_extractions (id) on delete set null,
  algorithm_version text not null,
  -- 그 분석을 돌린 실행 모드와 AI 공급자·모델. 요청 행은 서버가 env 값으로 넣고, worker 가 계산을 시작하며 자기 값으로 다시 적는다.
  run_mode text not null,
  ai_provider text not null,
  qwen_model text,
  kev_model text,
  question_set_version text,
  -- Kev 임계값의 보정 상태. Kev 를 쓰지 않은 run 은 null.
  kev_calibration text,
  prompt_hash text,
  -- sha256(canonical input_snapshot)
  input_snapshot_hash text,
  injection_suspected boolean not null default false,
  status text not null default 'QUEUED',
  score smallint,
  recommendation text,
  recommendation_basis text,
  explanation text,
  review_flags text[] not null default '{}',
  missing_factors text[] not null default '{}',
  -- AnalysisInput: {schemaVersion:"analysis-input/v0.1", bid, extractionId, profile, team:{members, assignments, asOf}, config}
  input_snapshot jsonb,
  -- Kev 응답 원문 + KevStateTrace(state 줄마다의 공고 인용·회사 증빙, stateHash)
  kev_output jsonb,
  model_metadata jsonb not null default '{}'::jsonb,
  -- AI_FALLBACK_TO_MOCK=true 에서 mock 자동 대체가 실제로 일어났을 때만 그 원인.
  fallback_reason text,
  idempotency_key text,
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  error_code text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint score_runs_id_org_id_key unique (id, org_id),
  constraint score_runs_idempotency_key_key unique (idempotency_key),
  constraint score_runs_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  constraint score_runs_company_profile_fkey foreign key (company_profile_id, org_id)
    references public.company_profiles (id, org_id) on delete cascade,
  constraint score_runs_run_mode_check check (run_mode in ('LIVE', 'FIXTURE', 'MOCK')),
  constraint score_runs_ai_provider_check check (ai_provider in ('MOCK', 'LOCAL', 'HOSTED')),
  constraint score_runs_kev_calibration_check check (kev_calibration in ('UNCALIBRATED', 'CALIBRATED')),
  constraint score_runs_status_check check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  constraint score_runs_score_check check (score between 0 and 100),
  constraint score_runs_recommendation_check check (recommendation in ('BID', 'WATCH', 'NO_BID')),
  constraint score_runs_recommendation_basis_check
    check (recommendation_basis in ('RULES_ONLY', 'RULES_WITH_KEV_ASSIST')),
  constraint score_runs_review_flags_check check (review_flags <@ array[
    'MODEL_RULE_DISAGREEMENT', 'KEV_MANDATORY_RISK', 'KEV_NEEDS_REVIEW', 'KEV_REQUIREMENT_DISAGREEMENT',
    'KEV_DELIVERY_RISK', 'CITATION_FAILED', 'EXTRACTION_FAILED', 'EXTRACTION_LOW_CONFIDENCE', 'AI_UNAVAILABLE',
    'QWEN_UNAVAILABLE', 'KEV_UNAVAILABLE', 'MOCK_FALLBACK', 'PARSE_UNSUPPORTED', 'DOCUMENT_DOWNLOAD_FAILED',
    'INSUFFICIENT_DATA', 'INJECTION_SUSPECTED', 'SCALE_LIMIT_EXCEEDED'
  ]::text[]),
  constraint score_runs_missing_factors_check check (missing_factors <@ array[
    'skillMatch', 'pastPerformance', 'staffAvailability', 'scaleFit', 'strategicPreference'
  ]::text[]),
  constraint score_runs_fallback_reason_check check (fallback_reason in ('QWEN_UNAVAILABLE', 'KEV_UNAVAILABLE')),
  constraint score_runs_fallback_check check (
    fallback_reason is null
    or (ai_provider = 'MOCK' and run_mode <> 'LIVE' and 'MOCK_FALLBACK' = any(review_flags))
  ),
  constraint score_runs_finished_snapshot_check check (
    status not in ('COMPLETED', 'PARTIAL') or (input_snapshot is not null and input_snapshot_hash is not null)
  )
);

alter table public.score_runs enable row level security;

-- 정책이 거르는 org_id 를 앞에 둔다. 공고별 최근 run, 상태별 대기열.
create index if not exists score_runs_org_id_bid_id_created_at_idx on public.score_runs (org_id, bid_id, created_at desc);
create index if not exists score_runs_org_id_status_idx on public.score_runs (org_id, status);
-- 외래 키가 찾는 열.
create index if not exists score_runs_revision_id_idx on public.score_runs (revision_id);
create index if not exists score_runs_company_profile_id_idx on public.score_runs (company_profile_id);
create index if not exists score_runs_extraction_id_idx on public.score_runs (extraction_id);
create index if not exists score_runs_requested_by_idx on public.score_runs (requested_by);
-- 같은 입력의 진행 중 job 은 하나다. 완료된 run 은 이력으로 여러 개 허용한다.
create unique index if not exists score_runs_active_input_key
  on public.score_runs (org_id, bid_id, revision_id, company_profile_id, algorithm_version)
  where status in ('QUEUED', 'RUNNING');

-- ────────────────────────────────────────────────────────────────
-- 2. score_factors — 요소는 08 의 순서와 같은 다섯 개.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.score_factors (
  id uuid primary key default gen_random_uuid(),
  score_run_id uuid not null,
  -- 부모 score_runs.org_id 와 같아야 한다(복합 FK). RLS 를 다른 조직 표와 같은 식으로 쓰려고 둔다.
  org_id uuid not null references public.organizations (id) on delete cascade,
  factor text not null,
  raw_value jsonb,
  normalized numeric(5, 4),
  points numeric(5, 1) not null,
  max_points numeric(5, 1) not null,
  missing boolean not null default false,
  -- EvidenceRef[]
  evidence jsonb not null default '[]'::jsonb,
  note text,
  constraint score_factors_score_run_fkey foreign key (score_run_id, org_id)
    references public.score_runs (id, org_id) on delete cascade,
  constraint score_factors_score_run_id_factor_key unique (score_run_id, factor),
  constraint score_factors_factor_check
    check (factor in ('skillMatch', 'pastPerformance', 'staffAvailability', 'scaleFit', 'strategicPreference')),
  constraint score_factors_points_check check (points >= 0 and points <= max_points),
  constraint score_factors_normalized_check check (normalized between 0 and 1)
);

alter table public.score_factors enable row level security;

create index if not exists score_factors_org_id_idx on public.score_factors (org_id);

-- ────────────────────────────────────────────────────────────────
-- 3. qualification_checks
--
-- NOT_SATISFIED 에는 공고 쪽 근거와 회사 쪽 명시적 부정 근거가 둘 다 있어야 한다. JSONB 안이라 DB check 로 걸지 않고
-- 규칙 엔진·zod·단위 시험이 강제한다(04 §3.4). NEEDS_REVIEW 면 reason_code 가 있고 아니면 없다(check).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.qualification_checks (
  id uuid primary key default gen_random_uuid(),
  score_run_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  bid_id uuid not null references public.bid_notices (id) on delete cascade,
  revision_id uuid not null,
  requirement_code text,
  requirement_name text not null,
  mandatory boolean not null default true,
  outcome text not null,
  reason_code text,
  reason text not null,
  -- 공고 쪽 값의 출처. 둘 다 있으면 API_FIELD 가 우선이다(08 §5.1).
  basis text not null,
  -- EvidenceRef[] (공고 쪽)
  evidence jsonb not null default '[]'::jsonb,
  -- {type, ref, label} 표시용(기존 모양 그대로)
  profile_evidence jsonb,
  -- CompanyEvidenceRef[] (회사 쪽)
  company_evidence jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  constraint qualification_checks_score_run_fkey foreign key (score_run_id, org_id)
    references public.score_runs (id, org_id) on delete cascade,
  constraint qualification_checks_revision_fkey foreign key (revision_id, bid_id)
    references public.bid_revisions (id, bid_id) on delete cascade,
  constraint qualification_checks_outcome_check check (outcome in ('SATISFIED', 'NOT_SATISFIED', 'NEEDS_REVIEW')),
  constraint qualification_checks_reason_code_check check (reason_code in (
    'NOTICE_INFO_MISSING', 'NOTICE_CONFLICTED', 'COMPANY_EVIDENCE_MISSING', 'AMBIGUOUS_MATCH', 'PARSE_UNSUPPORTED', 'STAGE_NOT_APPLICABLE'
  )),
  constraint qualification_checks_basis_check check (basis in ('API_FIELD', 'EXTRACTION')),
  constraint qualification_checks_needs_review_check check ((outcome = 'NEEDS_REVIEW') = (reason_code is not null)),
  -- 요구사항 코드를 모르면 자동 판정하지 않는다.
  constraint qualification_checks_requirement_code_check check (requirement_code is not null or outcome = 'NEEDS_REVIEW')
);

alter table public.qualification_checks enable row level security;

create index if not exists qualification_checks_org_id_score_run_id_idx on public.qualification_checks (org_id, score_run_id);
create index if not exists qualification_checks_bid_id_idx on public.qualification_checks (bid_id);
create index if not exists qualification_checks_revision_id_idx on public.qualification_checks (revision_id);

-- ────────────────────────────────────────────────────────────────
-- 4. requirement_assessments — item_id 는 추출 필드 경로(예: requiredSkills[2], qualifications[0]).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.requirement_assessments (
  id uuid primary key default gen_random_uuid(),
  score_run_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  item_id text not null,
  item_kind text not null,
  rule_status text not null,
  rule_reason text,
  basis text not null,
  -- EvidenceRef[] (공고 쪽)
  notice_evidence jsonb not null default '[]'::jsonb,
  -- CompanyEvidenceRef[] (회사 쪽)
  company_evidence jsonb not null default '[]'::jsonb,
  -- Kev 참고 지표. rule_status 를 바꾸지 않는다.
  kev_distribution jsonb,
  kev_label text,
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint requirement_assessments_score_run_fkey foreign key (score_run_id, org_id)
    references public.score_runs (id, org_id) on delete cascade,
  constraint requirement_assessments_score_run_id_item_id_key unique (score_run_id, item_id),
  constraint requirement_assessments_item_kind_check
    check (item_kind in ('SKILL', 'PAST_PERFORMANCE', 'STAFFING', 'QUALIFICATION')),
  constraint requirement_assessments_rule_status_check
    check (rule_status in ('SATISFIED', 'NOT_SATISFIED', 'NEEDS_REVIEW')),
  constraint requirement_assessments_rule_reason_check check (rule_reason in (
    'NOTICE_INFO_MISSING', 'NOTICE_CONFLICTED', 'COMPANY_EVIDENCE_MISSING', 'AMBIGUOUS_MATCH', 'PARSE_UNSUPPORTED', 'STAGE_NOT_APPLICABLE'
  )),
  constraint requirement_assessments_basis_check check (basis in ('API_FIELD', 'EXTRACTION')),
  constraint requirement_assessments_kev_label_check
    check (kev_label in ('SATISFIED', 'NOT_SATISFIED', 'NEEDS_REVIEW')),
  constraint requirement_assessments_needs_review_check
    check ((rule_status = 'NEEDS_REVIEW') = (rule_reason is not null)),
  constraint requirement_assessments_flags_check check (flags <@ array[
    'MODEL_RULE_DISAGREEMENT', 'KEV_MANDATORY_RISK', 'KEV_NEEDS_REVIEW', 'KEV_REQUIREMENT_DISAGREEMENT',
    'KEV_DELIVERY_RISK', 'CITATION_FAILED', 'EXTRACTION_FAILED', 'EXTRACTION_LOW_CONFIDENCE', 'AI_UNAVAILABLE',
    'QWEN_UNAVAILABLE', 'KEV_UNAVAILABLE', 'MOCK_FALLBACK', 'PARSE_UNSUPPORTED', 'DOCUMENT_DOWNLOAD_FAILED',
    'INSUFFICIENT_DATA', 'INJECTION_SUSPECTED', 'SCALE_LIMIT_EXCEEDED'
  ]::text[])
);

alter table public.requirement_assessments enable row level security;

create index if not exists requirement_assessments_org_id_score_run_id_idx
  on public.requirement_assessments (org_id, score_run_id);

-- ────────────────────────────────────────────────────────────────
-- 5. 권한과 정책
--
-- 네 표 모두 조직 전원이 읽는다. score_runs 의 요청 행만 ADMIN·SALES·ANALYST 가 넣는다. 결과 열·상태·요청자·시각은
-- 열 권한이 없어 기본값(QUEUED·auth.uid()·now())만 들어가고, 그 뒤는 worker 가 갱신한다. delete 권한은 없다.
-- ────────────────────────────────────────────────────────────────
revoke all on table public.score_runs from anon, authenticated, public;
revoke all on table public.score_factors from anon, authenticated, public;
revoke all on table public.qualification_checks from anon, authenticated, public;
revoke all on table public.requirement_assessments from anon, authenticated, public;

grant select on table public.score_runs to authenticated;
grant select on table public.score_factors to authenticated;
grant select on table public.qualification_checks to authenticated;
grant select on table public.requirement_assessments to authenticated;
grant insert (
  org_id, bid_id, revision_id, company_profile_id, profile_revision, extraction_id,
  algorithm_version, run_mode, ai_provider, idempotency_key
) on table public.score_runs to authenticated;

drop policy if exists "조직 분석 run 읽기" on public.score_runs;
create policy "조직 분석 run 읽기"
  on public.score_runs for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- requested_by 는 열 권한이 없어 기본값(auth.uid())이, status 는 QUEUED 가 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "분석 요청" on public.score_runs;
create policy "분석 요청"
  on public.score_runs for insert
  to authenticated
  with check (
    org_id in (select public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST']))
    and requested_by = (select auth.uid())
    and status = 'QUEUED'
  );

drop policy if exists "조직 점수 요소 읽기" on public.score_factors;
create policy "조직 점수 요소 읽기"
  on public.score_factors for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

drop policy if exists "조직 자격 판정 읽기" on public.qualification_checks;
create policy "조직 자격 판정 읽기"
  on public.qualification_checks for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

drop policy if exists "조직 항목 판정 읽기" on public.requirement_assessments;
create policy "조직 항목 판정 읽기"
  on public.requirement_assessments for select
  to authenticated
  using (org_id in (select public.my_org_ids()));
