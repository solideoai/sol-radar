-- 20261103000100_recommendation_insights_prompt_version — 추천 분석 상세화(ADR-078): 결과 행에 출력 형식 버전을 남기고,
-- 중복 제약이 지금 버전(insight/v0.2)의 모델 설명만 막게 한다.
--
-- 근거: docs/16-DECISIONS.md ADR-078, docs/plans/2026-11-03-recommendation-insight-detail.md
-- 공통 계약 C1, web/server/insight/insight.model.ts 의 INSIGHT_PROMPT_VERSION(버전 글자의 정본).
-- 옛 형식(v0.1) 모델 설명이 있는 run 도 새 형식으로 다시 요청할 수 있어야 한다. prompt_hash 는 쓸 수 없다.
-- 화면이 넣는 PENDING 행은 해시가 비어 있고(worker 가 완료 때 채운다), 해시는 프롬프트 글자 하나만 바뀌어도 달라진다.
-- 20261029000100·20261029000200 은 고치지 않는다(append-only).
--
-- 이 파일에 든 것:
--   1. prompt_version 열 — null 허용. worker(service role)가 DONE 때 쓴다. 화면 역할(authenticated)에는 열 권한을 주지 않는다.
--      표 권한은 20261029000100 이 거두었고 insert 는 org_id·score_run_id 열에만 열려 있어, 새 열은 화면이 넣거나 고치지 못한다.
--      그래서 사용자가 버전을 꾸며 아래 제약을 피할 수 없다. 읽기(select)는 표 권한 그대로 조직 전원이다.
--   2. 기존 행 — prompt_hash 가 있는(모델·템플릿 출력이 있던) 행을 insight/v0.1 로 채운다. 빈 값만 채운다.
--   3. 제외 제약 — 같은 이름으로 다시 만든다(insight.repo.ts 의 23P01 처리가 이름을 본다).
--      run 당 PENDING 과 지금 버전의 모델 설명(DONE·MODEL·insight/v0.2)은 합쳐 하나다. 옛 버전·버전 없는 모델 설명은 막지 않는다.
--      PENDING 은 run 당 하나(recommendation_insights_one_pending, 23505)인 규칙은 그대로다.
--
-- 운영에는 이 SQL 을 직접 실행한다(계획 Task 6 a). 다시 돌려도 결과가 같게 if not exists·if exists·빈 값만 채우기로 쓴다.
-- 다음에 버전을 올릴 때는 새 마이그레이션으로 이 제약의 버전 글자를 바꾼다(scripts/insight-prompt-version.test.mjs 가 본다).
--
-- 되돌리기(새 마이그레이션으로): 제약을 20261029000200 정의(status = 'PENDING' or (status = 'DONE' and source = 'MODEL'))로
-- 다시 만든다. 열은 남겨 둔다.

-- ────────────────────────────────────────────────────────────────
-- 1. prompt_version 열
-- ────────────────────────────────────────────────────────────────
alter table public.recommendation_insights
  add column if not exists prompt_version text;

-- ────────────────────────────────────────────────────────────────
-- 2. 기존 행
-- ────────────────────────────────────────────────────────────────
update public.recommendation_insights
  set prompt_version = 'insight/v0.1'
  where prompt_hash is not null and prompt_version is null;

-- ────────────────────────────────────────────────────────────────
-- 3. run 당 PENDING·지금 버전 모델 설명 합쳐 하나
-- ────────────────────────────────────────────────────────────────
alter table public.recommendation_insights
  drop constraint if exists recommendation_insights_pending_or_model_once;
alter table public.recommendation_insights
  add constraint recommendation_insights_pending_or_model_once
  exclude using btree (score_run_id with =)
  where (status = 'PENDING' or (status = 'DONE' and source = 'MODEL' and prompt_version = 'insight/v0.2'));
