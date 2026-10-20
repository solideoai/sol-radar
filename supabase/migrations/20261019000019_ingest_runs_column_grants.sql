-- 20261019000019_ingest_runs_column_grants — 화면 역할의 ingest_runs 읽기를 열 단위로 줄인다(N8 보안 점검 W1).
--
-- 근거: docs/plans/2026-10-20-n8-admin-ingestion-plan.md §5(e8 판정 2026-10-20), docs/04-DATABASE.md §3.6(ingest_runs).
-- 왜: ingest_runs 는 조직 구분 없는 공용 운영 표라 어느 조직의 ADMIN 이든 모든 행을 읽는다(20261019000006 §6 정책
-- "ADMIN 은 수집 run 읽기"). 그런데 N8 수동 수집은 job_key(manual:<orgId>:<requestId>)·idempotency_key(<orgId>:<requestId>)에
-- 요청한 조직 id 를, requested_by 에 요청한 사람 id 를 남긴다. 표 단위 select 가 열려 있으면 다른 조직 ADMIN 이 PostgREST 를
-- 직접 불러(select=* 또는 ?requested_by=eq.<id> 같은 필터) 그 값들을 읽어 조직 간에 새어 나간다. params 도 같은 이유로 닫는다.
--
-- 이 파일에 든 것: authenticated 의 표 단위 SELECT 를 거두고, 화면이 쓰는 열 열한 개(id, source, run_mode, trigger, batch,
-- cursor, status, summary, quota_used, started_at, finished_at)에만 열 단위 SELECT 를 준다.
-- 바꾸지 않는 것: 행 정책(그대로 ADMIN 만 행을 본다), anon(아무 권한도 주지 않는다), worker·seed 의 service role 쓰기,
-- latest_ingest_run(security definer 라 열 권한과 상관없이 돈다). 요청자는 이제 조직 소유 감사(audit_logs action INGEST_MANUAL,
-- target_type ingest_run)의 actor_id 로 읽는다(web/server/ingestion/ingestion-admin.repo.ts findManualRequesters).
--
-- 재실행에 안전하다: 표 단위 revoke 는 열 단위 권한도 함께 거두므로(PostgreSQL REVOKE), 두 번 적용해도 결과는 같은 열 열한 개다.
-- 20261019000006 을 다시 돌리면 표 단위 select 가 잠시 돌아오지만 이 파일이 뒤에 돌아 다시 줄인다.
--
-- 되돌리기(새 마이그레이션으로): grant select on table public.ingest_runs to authenticated;
-- 이 파일은 고치지 않는다(append-only).

revoke select on table public.ingest_runs from authenticated;

grant select (
  id,
  source,
  run_mode,
  trigger,
  batch,
  cursor,
  status,
  summary,
  quota_used,
  started_at,
  finished_at
) on table public.ingest_runs to authenticated;
