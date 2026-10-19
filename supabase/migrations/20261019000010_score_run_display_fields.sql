-- 20261019000010_score_run_display_fields — 화면이 분석을 DB 에서 다시 읽을 때 쓰는 두 열을 더한다.
--
-- 근거: docs/04-DATABASE.md §3.4(score_runs·score_factors), docs/03-AI-PIPELINE.md §5.7(KevAssist)·§7(저장),
-- C4 결과 타입 web/server/scoring/analysis-result.model.ts 의 MissingReason·ScoreFactor.missingReason·KevAssist.
-- 화면(C6) 도메인은 scoring 을 부를 수 없어, 저장된 행만으로 요소별 missing 사유와 Kev 참고 지표를 보여야 한다.
-- score_runs.missing_factors 는 요소 이름만, kev_output 은 gateway wire 원문뿐이라 둘 다 이 일을 하지 못한다.
--
-- 이 파일에 든 것:
--   1. score_factors.missing_reason — 요소별 missing 사유(C4 MissingReason 8값, null 허용). 값 집합은 check 로 잠근다.
--   2. score_runs.kev_assist — C4 AnalysisResult.kev(KevAssist). 값 형식은 앱 zod·시험이 지키고 DB 는 jsonb 로 둔다.
--      wire 원문(kev_output)은 그대로 둔다. Kev 지표는 참고 값이라 점수·권고를 바꾸지 않는다(ADR-004·020).
--
-- 바꾸지 않는 것: 권한·정책. 두 표의 authenticated select 는 표 단위라 새 열도 조직 읽기 정책("조직 분석 run 읽기"·
-- "조직 점수 요소 읽기")을 그대로 따른다. score_runs 의 authenticated insert 는 열 단위 목록(20261019000004)이라
-- kev_assist 는 들어 있지 않고, score_factors 에는 화면 역할의 쓰기 권한이 없다. 두 열은 worker(service role)만 쓴다.
-- 마이그레이션 전에 쌓인 행은 두 열이 null 이다(기본값을 두지 않는다).
--
-- 되돌리기(새 마이그레이션으로): score_factors 의 제약 score_factors_missing_reason_check 와 열 missing_reason,
-- score_runs 의 열 kev_assist 를 drop 한다. 이 파일은 고치지 않는다(append-only).

-- ────────────────────────────────────────────────────────────────
-- 1. score_factors.missing_reason
-- ────────────────────────────────────────────────────────────────
alter table public.score_factors add column if not exists missing_reason text;
alter table public.score_factors drop constraint if exists score_factors_missing_reason_check;
alter table public.score_factors
  add constraint score_factors_missing_reason_check check (missing_reason in (
    'NO_REQUIREMENTS_EXTRACTED', 'PROFILE_TECHNOLOGIES_EMPTY', 'BID_DOMAIN_UNKNOWN', 'PROFILE_PROJECTS_EMPTY',
    'REQUIRED_FTE_UNKNOWN', 'TEAM_EMPTY', 'BUDGET_UNKNOWN', 'PREFERENCES_NOT_SET'
  ));

-- ────────────────────────────────────────────────────────────────
-- 2. score_runs.kev_assist
-- ────────────────────────────────────────────────────────────────
alter table public.score_runs add column if not exists kev_assist jsonb;
