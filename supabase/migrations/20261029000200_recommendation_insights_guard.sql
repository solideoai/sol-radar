-- 20261029000200_recommendation_insights_guard — 추천 분석(ADR-066) 보안 리뷰 반영: 직접 insert 로 모델 호출을 다시 만들지 못하게 막고,
-- 대체 이유 INJECTION_SUSPECTED 를 받는다.
--
-- 근거: 보안 리뷰 중-1(화면 역할이 PostgREST 로 PENDING 을 직접 넣으면 Route Handler 의 중복 판정을 건너 모델 호출이 다시 생긴다),
-- 중-2(gateway 가 인젝션 의심 입력이면 모델을 부르지 않고 TEMPLATE·INJECTION_SUSPECTED 로 닫는다), web/server/insight/insight.model.ts.
-- 20261029000100 은 고치지 않는다(append-only).
--
-- 이 파일에 든 것:
--   1. 제외 제약 — 같은 run 에서 PENDING 과 검증을 통과한 모델 설명(DONE·MODEL)은 합쳐 하나만 있을 수 있다.
--      모델 설명이 있는 run 에는 PENDING 을 넣지 못하고(23P01), DONE·TEMPLATE·FAILED 뒤의 다시 요청은 그대로 된다.
--      insert 정책에 같은 표를 읽는 not exists 를 넣으면 PostgreSQL 이 정책 재귀(infinite recursion)로 거절하고,
--      보안 정의자 함수는 두지 않으므로 제약으로 막는다. worker(service role)도 이 규칙을 넘지 못한다.
--      직접 넣은 PENDING 의 enqueue 는 서비스가 속도 제한을 센다(insight.service.ts).
--   2. fallback_reason check — INJECTION_SUSPECTED 를 더한다. TEMPLATE 일 때만 붙는 조건은 그대로다.
--
-- 되돌리기(새 마이그레이션으로): alter table public.recommendation_insights
--   drop constraint recommendation_insights_pending_or_model_once; 와 20261029000100 의 fallback_reason check 정의로 다시 만들기.

-- ────────────────────────────────────────────────────────────────
-- 1. run 당 PENDING·DONE·MODEL 합쳐 하나
--
-- PENDING 끼리의 충돌은 먼저 만든 유일 색인(recommendation_insights_one_pending, 23505)이 먼저 잡는다.
-- 이 제약은 PENDING 과 DONE·MODEL 이 만나는 경우(23P01)를 막는다. 서버는 두 오류 모두 "있던 행"으로 읽어 돌려준다.
-- ────────────────────────────────────────────────────────────────
alter table public.recommendation_insights
  add constraint recommendation_insights_pending_or_model_once
  exclude using btree (score_run_id with =)
  where (status = 'PENDING' or (status = 'DONE' and source = 'MODEL'));

-- ────────────────────────────────────────────────────────────────
-- 2. fallback_reason check
-- ────────────────────────────────────────────────────────────────
alter table public.recommendation_insights
  drop constraint recommendation_insights_fallback_reason_check;
alter table public.recommendation_insights
  add constraint recommendation_insights_fallback_reason_check check (
    fallback_reason is null
    or (
      fallback_reason in (
        'MODEL_UNAVAILABLE', 'INVALID_OUTPUT', 'FORBIDDEN_WORD', 'UNKNOWN_NUMBER', 'UNKNOWN_REF',
        'LABEL_CONFLICT', 'INJECTION_SUSPECTED'
      )
      and source = 'TEMPLATE'
    )
  );
