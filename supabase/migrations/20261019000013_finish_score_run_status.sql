-- 20261019000013_finish_score_run_status — finish_score_run 이 마감 status 를 COMPLETED·PARTIAL 로만 쓰게 한다.
--
-- 근거: docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 한 트랜잭션에)·§3.4 score_runs, docs/03-AI-PIPELINE.md §7(저장).
-- 20261019000011_finish_score_run 의 함수는 p.run.status 를 그대로 썼다. 결과 저장(sink)은 COMPLETED·PARTIAL 만 넘기지만,
-- 함수가 FAILED·RUNNING·QUEUED 같은 값도 받아 마감 열과 자식 행을 써 버릴 수 있었다(보안 검토 후속, e8 번호 배정 2026-10-19).
-- FAILED 마감은 markFailed(PostgREST update)가 맡고, 이 함수는 결과를 저장하는 마감만 한다.
--
-- 이 파일에 든 것:
--   1. finish_score_run(p) 를 create or replace 한다. 000011 과 다른 점은 하나다 — 자식 표를 쓰기 전에 마감 뒤 status 를 계산해
--      COMPLETED·PARTIAL 이 아니면 거절한다. p.run 에 status 가 없으면 지금 값(RUNNING)이 남으므로 거절된다.
--      거절(raise exception, 메시지가 곧 코드). 검사 순서는 이 표의 순서다:
--        SCORE_RUN_NOT_FOUND      그 조직(p.org_id)에 그 run(p.score_run_id)이 없다
--        SCORE_RUN_NOT_RUNNING    status 가 RUNNING 이 아니거나, attempt_started_at 이 없거나(null),
--                                 started_at 이 attempt_started_at 과 다르다
--        SCORE_RUN_INVALID_STATUS 마감 뒤 status 가 COMPLETED·PARTIAL 이 아니다
--      거절이면 자식 표를 건드리지 않는다. 나머지(인자·돌려주는 값·자식 행·마감 열·search_path·security invoker)는 000011 과 같다.
--   2. 권한 — create or replace 는 권한을 그대로 두지만, 000011 과 같은 상태를 이 파일만 보고도 알 수 있게 다시 건다.
--
-- 되돌리기(새 마이그레이션으로): 000011 의 함수 본문으로 create or replace 한다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. finish_score_run(p)
--
-- 설명은 000011 의 1절과 같다. 달라진 것은 마감 열을 얹은 v_next 를 자식 표보다 먼저 계산하고, 그 status 를 검사하는 순서뿐이다.
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

  -- 결과를 저장하는 마감만 받는다. status 가 null(p.run.status = null)이어도 거절한다.
  if v_next.status is null or v_next.status not in ('COMPLETED', 'PARTIAL') then
    raise exception 'SCORE_RUN_INVALID_STATUS';
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
-- 2. 권한
--
-- 000011 과 같다. 화면 역할과 PUBLIC 에서 모두 거두고 worker 의 service_role 에만 준다. service_role 역할이 없는 DB(PGlite
-- 정책 시험·타입 생성)에서는 grant 를 건너뛴다.
-- ────────────────────────────────────────────────────────────────
revoke all on function public.finish_score_run(jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.finish_score_run(jsonb) to service_role;
  end if;
end;
$$;
