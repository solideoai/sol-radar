-- 20261019000016_analysis_complete_outbox — finish_score_run 이 결과 저장과 같은 트랜잭션에 ANALYSIS_COMPLETE outbox 1건을 쓴다.
--
-- 근거: docs/13-NOTIFICATIONS.md(이벤트 ANALYSIS_COMPLETE = score_run COMPLETED 또는 PARTIAL, 수신자 = 분석 요청자,
-- 멱등 키·상태 전이), docs/02-ARCHITECTURE.md(score_runs 저장 → outbox_events(ANALYSIS_COMPLETE) → notifications),
-- docs/04-DATABASE.md §1(여러 표를 한 번에 쓰는 일은 한 트랜잭션에)·outbox_events. C7 판정(e8 2026-10-20: 인앱 알림 2종은
-- REVIEW_ASSIGNED·ANALYSIS_COMPLETE, ANALYSIS_COMPLETE 는 finish_score_run 이 같은 트랜잭션에 쓴다, 번호 20261019000016).
-- REVIEW_ASSIGNED 는 20261019000007 의 bid_reviews 트리거가 이미 쓴다. 이 파일은 그것을 바꾸지 않는다.
--
-- 이 파일에 든 것:
--   1. finish_score_run(p) 를 create or replace 한다. 20261019000013 과 다른 점은 하나다 — score_runs 마감 뒤에
--      그 run 의 requested_by 가 있으면 outbox_events 에 ANALYSIS_COMPLETE 1건을 넣는다.
--        org_id          = run 의 조직
--        aggregate_type  = 'score_run', aggregate_id = run id
--        payload         = { scoreRunId, bidId, orgId, requestedBy, status(COMPLETED|PARTIAL) }
--        idempotency_key = '<scoreRunId>:<requestedBy>:ANALYSIS_COMPLETE' (REVIEW_ASSIGNED 키 '<reviewId>:<assigneeId>:REVIEW_ASSIGNED' 와
--                          같은 모양). 같은 키가 이미 있으면 아무것도 하지 않는다(on conflict do nothing).
--      requested_by 가 없는 run(사전 분석)은 받을 사람이 없어 쓰지 않는다. 거절(SCORE_RUN_NOT_FOUND·SCORE_RUN_NOT_RUNNING·
--      SCORE_RUN_INVALID_STATUS)이면 트랜잭션 전체가 되돌아가 이벤트도 남지 않는다. 나머지(인자·돌려주는 값·거절·자식 행·
--      마감 열·search_path·security invoker)는 20261019000013 과 같다. outbox_events 쓰기는 부른 역할(service_role)의 표 권한으로 한다.
--   2. 권한 — 20261019000013 과 같은 상태를 이 파일만 보고도 알 수 있게 다시 건다.
--
-- 되돌리기(새 마이그레이션으로): 20261019000013 의 함수 본문으로 create or replace 한다. 이미 쌓인 이벤트는 그대로 둔다.
-- 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. finish_score_run(p)
--
-- 설명은 20261019000011 의 1절과 20261019000013 의 1절과 같다. 달라진 것은 마감 뒤 outbox 쓰기 하나다.
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

  -- 분석 요청자에게 갈 ANALYSIS_COMPLETE 이벤트(docs/13-NOTIFICATIONS.md, 02 :119). 결과와 같은 트랜잭션이라 결과만 남고
  -- 이벤트가 빠지는 일이 없다. 요청자가 없는 run(사전 분석)은 받을 사람이 없어 쓰지 않는다.
  -- status 는 위 검사로 COMPLETED·PARTIAL 만 여기까지 온다. 같은 키가 이미 있으면 그대로 둔다.
  if v_current.requested_by is not null then
    insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
    values (
      v_org_id,
      'score_run',
      v_run_id,
      'ANALYSIS_COMPLETE',
      jsonb_build_object(
        'scoreRunId', v_run_id,
        'bidId', v_current.bid_id,
        'orgId', v_org_id,
        'requestedBy', v_current.requested_by,
        'status', v_next.status
      ),
      v_run_id::text || ':' || v_current.requested_by::text || ':ANALYSIS_COMPLETE'
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_run_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. 권한
--
-- 20261019000011 과 같다. 화면 역할과 PUBLIC 에서 모두 거두고 worker 의 service_role 에만 준다. service_role 역할이 없는 DB(PGlite
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
