-- 20261019000011_finish_score_run — 분석 마감 함수 finish_score_run(p jsonb)와 score_runs.idempotency_key 조직 접두어 check.
--
-- 근거: docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 한 트랜잭션에), §3.4 score_runs·score_factors·
-- qualification_checks·requirement_assessments. C5-B 보안 후속 설계 §2(e8 판정 2026-10-19: 번호 20261019000011,
-- finish_score_run RPC, idempotency 키 형식 `<orgId>:<Idempotency-Key>`). 선례는 20261019000009_ingest_save_revision.
--
-- worker 의 결과 저장(sink)이 자식 3표와 score_runs 마감을 함수 한 번(한 트랜잭션)으로 쓴다. 예전처럼 표마다 따로 쓰면
-- 늦게 끝난 시도가 이미 끝난 run(COMPLETED·PARTIAL·FAILED)이나 다른 시도가 다시 잡은 run 의 자식 행을 덮을 수 있었다.
-- 이 함수는 run 행을 잠그고, 그 run 이 RUNNING 이며 started_at 이 이 시도의 시작 시각(markRunning 이 쓴 값)일 때만 쓴다.
--
-- 이 파일에 든 것:
--   1. finish_score_run(p) — security invoker. 부른 역할의 권한으로 쓴다(service_role 은 RLS 를 무시하고 표 권한이 있다).
--      p = { score_run_id, org_id, attempt_started_at, run: {마감 열…}, factors: [...], assessments: [...], checks: [...] }
--      열 이름은 저장 매핑(toScoreRunResultUpdate·toScoreFactorRows·toRequirementAssessmentRows·toQualificationCheckRows)의
--      출력 그대로다. 돌려주는 것은 그 run 의 id.
--      거절(raise exception, 메시지가 곧 코드):
--        SCORE_RUN_NOT_FOUND   그 조직(p.org_id)에 그 run(p.score_run_id)이 없다
--        SCORE_RUN_NOT_RUNNING status 가 RUNNING 이 아니거나, attempt_started_at 이 없거나(null),
--                              started_at 이 attempt_started_at 과 다르다
--      검사 순서는 위 표의 순서다. 거절이면 자식 표를 건드리지 않는다.
--      값 검증은 표의 check·FK·NOT NULL 이 한다. 어느 단계든 실패하면 앞서 쓴 자식 행까지 함께 되돌아간다.
--   2. score_runs_idempotency_key_org_check — idempotency_key 는 null 이거나 `<org_id>:` 로 시작한다(not valid 로 건다).
--   3. 권한 — 화면 역할(anon·authenticated)과 PUBLIC 의 실행 권한을 거두고 service_role(worker)에만 준다.
--
-- 되돌리기(새 마이그레이션으로): drop function if exists public.finish_score_run(jsonb);
-- alter table public.score_runs drop constraint if exists score_runs_idempotency_key_org_check; 표는 건드리지 않는다.
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. finish_score_run(p)
--
-- run 과 조직: 자식 행의 score_run_id·org_id 는 받은 행의 값이 아니라 p.score_run_id·p.org_id 로 쓴다. 자식 행이 다른 run·조직을
-- 가리켜도 그 run 에는 쓰지 않는다(테넌트 혼입 방지). qualification_checks 의 bid_id·revision_id 도 받은 행이 아니라 그 run 행의
-- 값으로 쓴다(다른 공고의 판정이 섞이지 않게).
--
-- 마감 열: toScoreRunResultUpdate 의 키에서 started_at 을 뺀 24개만 쓴다. 마감은 시도의 시작 시각을 바꾸지 않는다.
-- p.run 에 그 밖의 키(started_at·org_id·idempotency_key·requested_by 등)가 있으면 읽지 않고 버린다(메인 세션 결정 2).
-- p.run 에 빠진 마감 열은 지금 값을 그대로 둔다 — 이 함수가 대신하는 PostgREST update(PATCH)와 같은 동작이다.
-- 값이 null 인 열은 null 로 쓴다.
--
-- 자식 행: jsonb_populate_recordset 으로 표의 행 타입에 맞춰 읽고, id·created_at·checked_at 은 기본값이 들어가게 열을 골라 넣는다.
--   score_factors          (score_run_id, factor) 로 고쳐 쓴다(on conflict do update). 요소는 run 마다 다섯 개로 정해져 있다.
--   requirement_assessments 그 run 의 행을 지운 뒤 p 의 행만 넣는다.
--   qualification_checks   그 run 의 행을 지운 뒤 p 의 행만 넣는다.
-- 빠진 배열(키 없음)은 빈 배열로 본다.
--
-- 동시 호출: run 행을 for update 로 잠그므로 같은 run 의 두 번째 호출은 첫 호출이 끝날 때까지 기다린 뒤 바뀐 status 를 보고
-- SCORE_RUN_NOT_RUNNING 으로 거절된다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.finish_score_run(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid := (p ->> 'score_run_id')::uuid;
  v_org_id uuid := (p ->> 'org_id')::uuid;
  v_attempt_started_at timestamptz := (p ->> 'attempt_started_at')::timestamptz;
  v_current public.score_runs;
  v_next public.score_runs;
  v_finish_fields jsonb;
begin
  select s.*
    into v_current
  from public.score_runs s
  where s.id = v_run_id
    and s.org_id = v_org_id
  for update;

  if not found then
    raise exception 'SCORE_RUN_NOT_FOUND';
  end if;
  if v_attempt_started_at is null
    or v_current.status <> 'RUNNING'
    or v_current.started_at is distinct from v_attempt_started_at then
    raise exception 'SCORE_RUN_NOT_RUNNING';
  end if;

  insert into public.score_factors as sf (
    score_run_id, org_id, factor, raw_value, normalized, points, max_points, missing, missing_reason, evidence, note
  )
  select
    v_run_id, v_org_id, r.factor, r.raw_value, r.normalized, r.points, r.max_points, r.missing, r.missing_reason,
    r.evidence, r.note
  from jsonb_populate_recordset(null::public.score_factors, coalesce(p -> 'factors', '[]'::jsonb)) as r
  on conflict (score_run_id, factor) do update
  set raw_value = excluded.raw_value,
      normalized = excluded.normalized,
      points = excluded.points,
      max_points = excluded.max_points,
      missing = excluded.missing,
      missing_reason = excluded.missing_reason,
      evidence = excluded.evidence,
      note = excluded.note;

  delete from public.requirement_assessments ra
  where ra.score_run_id = v_run_id
    and ra.org_id = v_org_id;

  insert into public.requirement_assessments (
    score_run_id, org_id, item_id, item_kind, rule_status, rule_reason, basis, notice_evidence, company_evidence,
    kev_distribution, kev_label, flags
  )
  select
    v_run_id, v_org_id, r.item_id, r.item_kind, r.rule_status, r.rule_reason, r.basis, r.notice_evidence,
    r.company_evidence, r.kev_distribution, r.kev_label, r.flags
  from jsonb_populate_recordset(null::public.requirement_assessments, coalesce(p -> 'assessments', '[]'::jsonb)) as r;

  delete from public.qualification_checks qc
  where qc.score_run_id = v_run_id
    and qc.org_id = v_org_id;

  insert into public.qualification_checks (
    score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, mandatory, outcome, reason_code,
    reason, basis, evidence, profile_evidence, company_evidence
  )
  select
    v_run_id, v_org_id, v_current.bid_id, v_current.revision_id, r.requirement_code, r.requirement_name, r.mandatory, r.outcome,
    r.reason_code, r.reason, r.basis, r.evidence, r.profile_evidence, r.company_evidence
  from jsonb_populate_recordset(null::public.qualification_checks, coalesce(p -> 'checks', '[]'::jsonb)) as r;

  -- 마감 열만 남겨 지금 행 위에 얹는다. 남긴 키만 v_next 에서 바뀌고 나머지 열은 지금 값이다.
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
    into v_finish_fields
  from jsonb_each(coalesce(p -> 'run', '{}'::jsonb)) as f(key, value)
  where f.key = any (array[
    'status', 'score', 'recommendation', 'recommendation_basis', 'error_code', 'injection_suspected', 'explanation',
    'review_flags', 'missing_factors', 'input_snapshot', 'input_snapshot_hash', 'kev_output', 'kev_assist',
    'model_metadata', 'qwen_model', 'prompt_hash', 'kev_model', 'question_set_version', 'run_mode', 'ai_provider',
    'extraction_id', 'finished_at', 'kev_calibration', 'fallback_reason'
  ]);

  v_next := jsonb_populate_record(v_current, v_finish_fields);

  update public.score_runs as s
  set status = v_next.status,
      score = v_next.score,
      recommendation = v_next.recommendation,
      recommendation_basis = v_next.recommendation_basis,
      error_code = v_next.error_code,
      injection_suspected = v_next.injection_suspected,
      explanation = v_next.explanation,
      review_flags = v_next.review_flags,
      missing_factors = v_next.missing_factors,
      input_snapshot = v_next.input_snapshot,
      input_snapshot_hash = v_next.input_snapshot_hash,
      kev_output = v_next.kev_output,
      kev_assist = v_next.kev_assist,
      model_metadata = v_next.model_metadata,
      qwen_model = v_next.qwen_model,
      prompt_hash = v_next.prompt_hash,
      kev_model = v_next.kev_model,
      question_set_version = v_next.question_set_version,
      run_mode = v_next.run_mode,
      ai_provider = v_next.ai_provider,
      extraction_id = v_next.extraction_id,
      finished_at = v_next.finished_at,
      kev_calibration = v_next.kev_calibration,
      fallback_reason = v_next.fallback_reason
  where s.id = v_run_id
    and s.org_id = v_org_id;

  return v_run_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. score_runs_idempotency_key_org_check
--
-- idempotency 키 형식은 `<org_id>:<Idempotency-Key>` 다(e8 판정). 다른 조직의 접두어로 남의 run 을 가리키는 키를 DB 가 막는다.
-- not valid 로 거는 이유: 운영 DB 에 접두어 없는 옛 행이 남아 있어도 이 마이그레이션이 실패하지 않게 한다(db:push 는 파일 하나가
-- 트랜잭션 하나라 검사가 실패하면 함수까지 함께 되돌아간다). not valid 는 이미 있는 행만 검사하지 않는다 — 새 행 insert 와
-- 행 update 는 어느 열을 바꾸든 검사된다. 그래서 접두어 없는 옛 행이 진행 중(QUEUED·RUNNING)이면 worker 의 markRunning·
-- markFailed·finish_score_run 이 그 행에서 23514 로 실패한다. 적용 전에 그런 행이 없는지 확인한다.
-- 옛 행을 고친 뒤에는 새 마이그레이션에서 validate constraint 로 검사를 끝낼 수 있다.
-- ────────────────────────────────────────────────────────────────
alter table public.score_runs drop constraint if exists score_runs_idempotency_key_org_check;
alter table public.score_runs
  add constraint score_runs_idempotency_key_org_check
  check (idempotency_key is null or starts_with(idempotency_key, org_id::text || ':'))
  not valid;

-- ────────────────────────────────────────────────────────────────
-- 3. 권한
--
-- Supabase 는 public 의 새 함수에 화면 역할 실행 권한을 따로 주므로 PUBLIC 만 거두면 /rpc 로 그대로 불린다(database 스킬).
-- 화면 역할에서 모두 거두고 worker 의 service_role 에만 준다. service_role 역할이 없는 DB(PGlite 정책 시험·타입 생성)에서는
-- grant 를 건너뛴다.
-- ────────────────────────────────────────────────────────────────
revoke all on function public.finish_score_run(jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.finish_score_run(jsonb) to service_role;
  end if;
end;
$$;
