---
title: "14. 관측성·운영"
doc: "14"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-10-20
---

# 14. 관측성·운영

## 로그/메트릭
구조적 JSON 로그에 `requestId`, `jobId`, `orgId`(내부 pseudonymous, DB 열 `org_id`), `bidId`, `elapsedMs`; 토큰(Supabase access token·refresh token)/`SUPABASE_SERVICE_ROLE_KEY`/원문/비밀번호 로깅 금지. 로그는 Next 서버(`web/`)·worker(`web/worker`)·AI gateway가 같은 필드 이름으로 남긴다. 지표: 수집 마지막 성공 시각, 호출 실패/429 비율, 지연, 큐 적체, 분석 실패/재시도/timeout, 추천 분포, 사람 판정과 AI 차이, 알림 중복. GPU VRAM은 회사 GPU 서버를 회사가 운영하므로 우리가 재지 않는다. 회사가 주는 값이 있으면 기록만 한다([[16-DECISIONS|ADR-025]], [[10-DEPLOYMENT|10 배포]] GPU 메모리 배분).

## 데모 관리자 화면 지표 (5개)
이 화면은 데이터 수집 관리 `/admin/ingestion`이고 [[16-DECISIONS|ADR-021]]로 데모 필수다(화면 명세는 [[06-UI-UX|06 UI]] §5.8).

> [!warning] 구현 상태 (2026-10-20, main `554b34c`)
> `/admin/ingestion`(N8, `81249f0`)은 수집 run 목록·실행 상세(적재·격리·오류·호출 수)·수동 실행만 보인다. 아래 1번(소스별 수집 상태)만 이 화면에 있고, 2~5번 지표와 metrics endpoint는 미구현이다. 2·3번 값은 대시보드 분석 현황·BID 권고 카드로 일부 볼 수 있다.

데모에서 보여주는 관리자 화면은 아래 5개만 다룬다(설계. 2~5번 미구현). 나머지 지표는 metrics endpoint로만 제공한다(미구현). 관리자 화면은 `memberships.sol_role=ADMIN` 사용자의 세션으로 읽고, 조직 데이터는 RLS(`org_id in (select public.my_org_ids())`)가 그 조직 행만 보여 준다. `outbox_events`는 화면 역할에 권한·정책이 하나도 없다(마이그레이션 `20261019000006`). 남은 미정은 5번 지표의 적체 건수를 화면에 어떻게 집계해 보여 줄지뿐이다([[04-DATABASE|04 DB]], [[09-SECURITY|09 보안]]).

|#|지표|원천|범위|데모에서 보이는 값|
|---|---|---|---|---|
|1|소스별 마지막 수집 성공 시각·상태|`ingest_runs` 소스별 최근 1건 (`status`, `finished_at`, `summary`)|공용 (조직 무관, `org_id` 없음)|소스 `fixture`, 기동 직후 시각, 상태 `PARTIAL`(격리가 1건 이상이면 `PARTIAL`, 화면 `부분 완료`), `summary.quarantined=1`(FX-12, `ingest_errors` 1건). 목록 화면 신선도 배너와 같은 값|
|2|분석 상태 분포 (최근 24시간)|`score_runs.status` group by|`score_runs.org_id`|`COMPLETED` 건수가 사전 분석 건수([[19-DEMO-SCENARIO\|19 데모 시나리오]] §3 5번, FX-02를 뺀 18건)와 일치, 장애 리허설 후 `PARTIAL` 1건|
|3|권고 분포|`score_runs.recommendation`|`score_runs.org_id`|BID / WATCH / NO-BID 건수가 fixture 기대 라벨([[07-DATA-PIPELINE\|07 수집 파이프라인]])과 일치|
|4|사람 결정 vs 권고 불일치율|`bid_reviews.decision` vs 해당 `score_runs.recommendation`. `score_runs.review_flags`의 `MODEL_RULE_DISAGREEMENT` 건수 별도|`bid_reviews.org_id`|리뷰 기록 직후 갱신. 책임 있는 AI 모니터링 지표 ([[09-SECURITY\|09 보안]])|
|5|알림 outbox 적체·중복|`outbox_events.status=PENDING` 건수(알림을 만드는 두 종 `REVIEW_ASSIGNED`·`ANALYSIS_COMPLETE`만 센다. 공고 이벤트 `BID_*`는 해커톤에 소비자가 없어 `PENDING`으로 쌓이므로 적체에 넣지 않는다, [[13-NOTIFICATIONS\|13 알림]] "인앱 알림 2종"), `notifications` idempotency 위반 시도 수|`notifications.org_id`. `outbox_events.org_id`는 nullable(공고 이벤트는 공용)|두 종 기준 적체 0, 중복 0|

테이블·컬럼 이름의 원천은 [[04-DATABASE|04 DB]].

## 상태 기준
- `/health/live`: Next.js 프로세스 살아있음(`web/app/health/live/route.ts`).
- `/health/ready`(`web/app/health/ready/route.ts`): 응답 `{status, checks:{db, redis, storage, ai}}` ([[05-API-SPEC|05 API]]). `db` = Supabase(Postgres) 연결, `redis` = Redis, `storage` = Supabase Storage, `ai` ∈ `mock | local | hosted | unavailable`.
  - db·redis·storage 중 하나라도 불가 → HTTP `503`, `status: "unavailable"`.
  - AI만 불가 → HTTP 200, `status: "degraded"`, `checks.ai: "unavailable"`. AI는 선택 의존성이다.
  - 모두 정상 → HTTP 200, `status: "ok"`.
  - 같은 `checks.ai` 값이 화면 우상단 `AI: …` 표시에 쓰인다 ([[06-UI-UX|06 UI]]).
- worker(`web/worker`)는 HTTP 엔드포인트가 없다. 상태는 Compose healthcheck로 본다. worker가 heartbeat 파일(`WORKER_HEARTBEAT_FILE`, 기본 `/tmp/sol-worker-heartbeat`)을 10초마다 갱신하고, healthcheck는 수정 시각이 30초 이내인지 판정한다([[16-DECISIONS|ADR-024]] D3, [[10-DEPLOYMENT|10 배포]]).
- 관리자 화면: 위 5개 지표 + 오류 원인(민감정보 제거). 지금은 1번과 오류 원인(실행 상세)만 있다.

## 장애 대응
수집 오류: 이전 데이터 + freshness 배너. AI 불가: 규칙 점수로 처리(`PARTIAL`). Supabase(Postgres) 장애·네트워크 끊김: 조회·쓰기 불가 및 명확한 503(`component: db`), Supabase Auth도 같은 프로젝트라 로그인 불가. 큐 backlog: rate 제한. 장애별 사용자 노출은 [[02-ARCHITECTURE|02 아키텍처]] 장애 원칙 표. Sentry/Prometheus/Grafana 도입은 해커톤 이후, 표준 metrics endpoint부터 제공(지금은 endpoint가 없다). DB 백업·복구는 Supabase가 관리한다(세부 미검증, [[10-DEPLOYMENT|10 배포]] 운영 절). Compose 볼륨(redis·qdrant·minio) 복구 테스트는 월 1회. 마이그레이션은 append-only라 되돌리기도 새 마이그레이션 파일로 하고, 그 절차를 문서화한다.

## 관련 문서
- [[02-ARCHITECTURE|02 아키텍처]]
- [[04-DATABASE|04 DB]]
- [[09-SECURITY|09 보안]]
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[13-NOTIFICATIONS|13 알림]]
