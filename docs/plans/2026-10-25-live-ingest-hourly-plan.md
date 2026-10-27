---
title: "10-25 운영 실데이터 1시간 주기 수집 전환 계획"
doc: "plan-20261025-live-ingest-hourly"
status: done
tags:
  - sol-radar
  - hackathon
  - ops
  - ingestion
updated: 2026-10-25
---

# 10-25 운영 실데이터 1시간 주기 수집 전환 계획

> [!todo] 한눈에 (기준 2026-10-25 16:00 KST, main 4e84e084 · 구현 완료 release-1025 @04b4bf3a)
> 목표: 회사 서버에 **Ingest 전용 Worker** 를 따로 띄워 나라장터 입찰공고(`g2b-bid-notice`)와 보조 조회 3종을 60분마다 실제로 수집한다. Vercel 화면은 실행 모드·데이터 출처·데모 여부를 따로 보여 준다.
> 보안 수정(가입 승인, `integration/freeze-1024` 0e956774)과 코드·배포를 섞지 않는다. 이 작업은 별도 브랜치에서 한다.
> 운영 상태를 바꾸는 명령(회사 컨테이너 기동, 실제 API 첫 호출, DB migration, Vercel env·배포)은 모두 사용자 승인 뒤에 한다. 승인 지점은 §6 의 **[승인]** 표시다.

## 0. 범위와 금지

- 활성화: `g2b-bid-notice`(목록) + `g2b-bid-license-limit`·`g2b-bid-region`·`g2b-bid-eorder-attach`(보조). registry 에서 이미 APPROVED·fieldMapping 있음.
- 활성화하지 않음: §8 미검증 소스 전부. registry 를 고치지 않는다.
- 금지(사용자 원문): 전체 Docker 컨테이너 재시작, `docker compose down -v`, Redis 데이터 초기화, Supabase 테이블 초기화, 기존 Analysis Worker 중단, 운영 Nginx 설정 변경, 모든 Worker 를 무조건 함께 실행, 외부 API 호출 제한 우회, API 키·비밀번호 로그 출력. 정상 운영 중인 Analysis Worker·Redis·AI Gateway 는 중단·재시작하지 않는다.
- 기존 DEMO 공고·분석 이력은 지우지 않는다. `mock` 을 `live` 로 문자열만 바꾸지 않는다. 원본 URL 이 없으면 만들지 않는다.

## 1. 조사 결과 (Phase A)

| 항목 | 결과 | 근거 |
|---|---|---|
| 60분 설정 | 기존 env `G2B_INGEST_INTERVAL_MINUTES` 가 있다(기본 30, 양의 정수, 상한 없음). 코드 변경 없이 `60` 으로 된다 | `web/worker/ingest-queue.ts:24,34,47-54` |
| 일정 | BullMQ Job Scheduler `upsertJobScheduler("g2b-scheduled", {every})`. 같은 id upsert 라 재기동해도 중복이 없다. DB `ingest_runs.job_key` UNIQUE 가 한 겹 더 막는다 | `web/worker/main.ts:140-168` |
| mock·fixture 에서 | 같은 등록이 `g2b-scheduled` 를 **지운다** | `main.ts:157-168` |
| 재사용할 것 | `ingestWorkerRegistration` 하나에 `createIngestWorker`·`syncG2bSchedule`·`startDocumentsReconciler`·F08 quota 연결이 다 들어 있다 | `main.ts:445-499` |
| 넣지 말 것 | dependency health reporter. Redis 키 하나에 runMode 가 scope 로 들어가 live 보고가 다른 보고를 덮으면 redis-api readiness 가 503 이 된다. analysis·notify·deadline·program·storage 등록도 넣지 않는다 | `server/health/dependency-report.ts:34-39` |
| 호출 예산 | Lua 예약, 일 1000(목록·보조 공유 카운터 `quota:15129394:YYYYMMDD`), 900 부터 보조 중단, 소진 시 목록도 0회, 결과코드 22 면 소진 처리 | `server/ingestion/quota.ts`, `worker/quota-store.ts` |
| 첫 회차 | 일정이 처음 생기면 **즉시 1회** 돈다. 이전 SCHEDULED 성공 run 이 없으면 창은 24시간. 필터 없이 용역 공고 전부라 하루 약 444건 기준 보조 약 1300회가 필요해 첫 회차에 900 에 닿아 보조가 멈출 것으로 추정한다 | BullMQ 6.3.16 lua, `docs/evidence/phase-0/external-deps-api-20261019.md:39` |
| 창 상한 | 이전 성공 run 끝 → 지금. **상한이 없다.** 운영 DB 에 옛 SCHEDULED 성공 run 이 있으면 첫 창이 며칠이 된다 | `ingest-queue.ts:108-124` |
| 공고 소속 | `bid_notices` 에 org_id 가 없고 활동 회원 전원이 읽는다. 분석·결정만 조직별(RLS) | `20261019000002…sql:277-287` |
| DEMO 표시 원인 | 상단 DEMO 배지·"실행 모드: mock"·기본 출처 demo 는 전부 **Vercel env `SOL_RUN_MODE=mock`** 하나에서 나온다. 행의 DEMO 배지(`is_demo`)는 정확하다 | `web/components/topbar-status.tsx:154-166,417`, `web/server/bids/bid-query.ts:85-86` |
| 기본 출처 하드코딩 | `bid-query.ts` 의 `defaultOrigin` 외에 4곳이 같은 규칙을 직접 쓴다 | `opportunities/query.ts:63`, `dashboard/dashboard-queries.ts:11`, `admin/ingestion/page.tsx:38`, `api/v1/admin/ingestion/services/route.ts:12` |
| 수집 지연 표시 | 상단바는 origin=demo 의 마지막 run(5일 전 fixture). 60분 넘으면 "지연". 소스 상태 HEALTHY 도 60분 기준이라 60분 주기면 자주 DEGRADED 가 된다 | `topbar-status.tsx:32,200-227`, `opportunities/repo.ts:227-232` |
| 기관 표시 | 상세 "발주기관" 라벨에 실제로는 수요기관(`dminsttNm`)이 나온다. 공고기관(`ntceInsttNm`)은 원본에만 있다 | `normalize-g2b.ts:164-165`, `bid-detail-view.tsx:385` |
| 대시보드 9지표 | 있음 4(24h 신규·AI 대기·BID·7일 마감), 부분 3(전체 수·WATCH·마지막 성공), 없음 2(다음 예정·기관별 수) | `20261023000200_procurement_reads.sql:50-105` |
| 회사 Analysis Worker | `web/worker/analysis-only-main.ts`·`infra/compose.analysis-only.company.yaml` 은 **저장소에 없다**(모든 브랜치 확인). 내용을 모르면 ingest 등록·dependency reporter 포함 여부를 판단할 수 없다 | 사용자 제공 필요 → 10-25 제공받아 16e1ab6b 에 넣음(§2 D3) |

## 2. 사용자 결정 (10-25 최종 지시로 확정)

1. **D1 발표 경로:** 1안. 회사는 `SOL_RUN_MODE=live` 를 유지하고, 발표는 운영 DB 의 기존 DEMO 데이터를 `?origin=demo` 로 본다. 발표 전 `demo:reset` 은 하지 않는다. 즉석 분석(FX-02, S4)은 실모델 결과로 설명한다. 운영 DB 의 FX-02 72 존재는 [[20261025-release-runbook|실행서]] §10 SQL 로 확인한다.
2. **D2 기본 출처:** 새 env `SOL_DEFAULT_ORIGIN`(live·demo·all). 상단 DEMO 배지는 보는 출처가 demo 일 때만, 실행 모드 라벨은 런타임 설정만 뜻한다. Vercel `SOL_RUN_MODE` 는 Ingest Worker 기동 뒤 `live` 로 바꾼다(실행서 §6).
3. **D3 회사 전용 파일:** 사용자가 원문을 줬다. 저장소에 원문(머리 주석 1줄·Prettier 줄바꿈만 차이)으로 넣었다. `analysis-only-main.ts` 는 `startAnalysisRuntime()` 만 쓰고 ingest 등록·dependency reporter 가 없다. 배포 때 원본 보존·대조 절차는 `infra/company/README.md` §7.2 다.

## 3. 브랜치

- 기준: main 4e84e084. 통합 브랜치가 main 에 들어가면 rebase 한다.
- Worker: `feat/live-ingest-worker`(worktree `sol-radar-worktrees/live-ingest-worker`).
- 웹: `feat/live-ingest-web`(worktree `sol-radar-worktrees/live-ingest-web`).
- 두 브랜치는 파일이 겹치지 않는다. 검증 뒤 `feat/live-ingest-hourly` 로 합친다. 새 migration 번호는 `20261025000200` 부터(보안 수정이 `20261025000100`).

## 4. 구현 (Phase B)

### B1. Ingest 전용 Worker (`feat/live-ingest-worker`)

- `web/worker/main.ts`: 등록 목록으로 Worker 를 만드는 부분(`defaultWorkerDeps.createWorker`, 약 20줄)을 `createRegisteredWorker(registrations)` 로 export 해 두 진입점이 같이 쓴다. 동작은 그대로.
- 새 `web/worker/ingest-only-main.ts`
  - 등록은 `[ingestWorkerRegistration]` 하나.
  - `SOL_RUN_MODE !== "live"` 면 Redis 연결 전에 종료(exit 1). mock 으로 뜨면 일정을 지우기 때문이다.
  - `--check`: import·env 이름 확인만. `--unschedule`: `g2b-scheduled` 일정만 지우고 끝(되돌리기용).
  - SIGTERM·SIGINT 한 번 → close → exit. 자동 기동 조건은 자기 파일 이름.
- 새 `infra/compose.ingest-only.company.yaml`
  - `name: sol-radar-ingest`(회사 `sol-radar-gateway` 프로젝트와 분리, 같은 프로젝트의 컨테이너를 건드리지 않는다).
  - 서비스 `ingest-worker` 하나: 같은 이미지(`../web`, `worker/Dockerfile`), `command` 만 `worker/ingest-only-main.ts`.
  - `environment`: `SOL_RUN_MODE: live`, `G2B_INGEST_INTERVAL_MINUTES: "60"`, `SOURCES_REGISTRY_FILE`, `FIXTURES_DIR`. `env_file: .env.worker.local`(키 값은 파일에만).
  - 네트워크 `redis-existing`(external), healthcheck heartbeat, `restart: on-failure:3`, `stop_grace_period: 180s`. ai-gateway 의존 없음.
- 시험 `web/worker/ingest-only-main.test.ts`
  - 등록이 ingest 하나뿐이고 dependency reporter 가 없다.
  - live 가 아니면 Redis 연결 없이 실패한다.
  - live + 60 이면 `upsertJobScheduler("g2b-scheduled", {every: 3_600_000})`, 두 번 기동해도 같은 id.
  - `--unschedule` 은 `removeJobScheduler("g2b-scheduled")` 만 부른다.
  - SIGTERM 에 close 한 번, exit 0.
- `infra/company/README.md` 에 Ingest 전용 절 추가(기동·확인·되돌리기, §6 명령).

### B2. 화면 출처·DEMO 분리 (`feat/live-ingest-web`)

- 기본 출처 함수 하나(`web/server/bids/bid-query.ts`): `SOL_DEFAULT_ORIGIN` 이 있으면 그 값, 없으면 지금 규칙. 하드코딩 4곳이 이 함수를 쓴다.
- 대시보드가 `?origin=` 을 받는다(발표 북마크용).
- 상단 DEMO 배지는 "기본 출처가 demo" 일 때만. 행 배지는 그대로.
- 수집 신선도는 기본 출처 기준, 지연 기준은 `G2B_INGEST_INTERVAL_MINUTES`(같은 이름, Vercel 에도 넣음)의 2배, 없으면 지금 60분. 소스 HEALTHY 기준도 같다.
- 상세: "발주기관" 라벨을 실제 값에 맞춰 "수요기관" 으로, 공고기관은 기존 데이터에서 읽을 수 있을 때만 표시. 목록: 공고번호·게시일(보조 줄), 마지막 변경 시각(`changed_at`) 매핑.
- 시험: 기본 출처 함수(env 없음·live·demo·잘못된 값), 대시보드 origin 파라미터, 바뀐 열 수에 맞춘 `procurement.browser.test.tsx`. env 가 없을 때 기존 e2e 단언은 그대로 통과해야 한다.

### B3. 대시보드 9지표 (`feat/live-ingest-web`, B2 다음)

- 새 migration `20261025000200_procurement_live_metrics.sql`: 기관별 공고 수 RPC, 진행 중 WATCH 수. 호출자 RLS(security invoker), 정책 시험은 `scripts/database.test.mjs`.
- 카드: 전체 수집 수·진행 중 WATCH·마지막 수집 성공 시각(절대 시각)·다음 수집 예정(마지막 SCHEDULED run + 주기, "예정" 표기)·기관별 상위 N.
- DEMO 데이터는 origin=live 집계에 섞이지 않는다(시험으로 확인).

## 5. 검증 (Phase C)

- 각 브랜치 `pnpm verify:changed`, 합친 뒤 전체 `pnpm verify` 1회(슬롯).
- Worker: `--check` 를 로컬에서 실행(외부 API 호출 없음). 로컬 live 실행은 운영 일일 한도를 쓰므로 하지 않는다.
- 웹: 격리 스택(rh1025)에서 env 없음(지금과 같음)·`SOL_DEFAULT_ORIGIN=live` 두 경우 1440·1280 화면 확인.
- 독립 리뷰 1회(security-auditor: service role·키 로그·조직 격리).

## 6. 배포 (Phase D) — 순서와 승인

정본은 `infra/company/README.md` §7(회사 Worker)과 [[20261025-release-runbook|10-25 운영 반영 실행서]](migration·버킷·main·Vercel·되돌리기)다. 처음 계획과 달라진 점:

- 첫 실제 호출은 일정 기동(`up -d`)이 아니라 `--once --window-minutes 60` 1회다. 일정 기동은 그 결과를 본 뒤 따로 승인받는다.
- 정기 창은 `max(직전 SCHEDULED 성공 창 끝, 지금 − 2×주기)` 로 잘린다. 24시간 첫 창은 생기지 않는다.
- `--status`(읽기 전용 큐 판독)를 기동 전·후에 본다. Job Scheduler 가 이미 있으면 멈춘다.
- 이미지는 `sol-radar-ingest-worker:<git SHA>` 다. `sol-radar-ai-worker-worker:latest` 를 만들거나 덮지 않는다.
- 처음 표의 D0 SQL(`window_to`·`created_at`)은 `ingest_runs` 에 없는 열이었다. README §7.1 의 `params->'window'`·`started_at` 판으로 바꿨다.

## 7. 알려진 위험

- 하루 보조 조회 필요량(약 1330회)이 내부 예산을 넘어 매일 900회에서 보조가 멈춘다. 그 뒤 공고는 면허·지역·첨부 없이 저장된다(실행서 §8).
- run 도중 예외면 RUNNING 행이 남는다. 긴 run 이 `stop_grace_period 180s` 를 넘기면 SIGKILL 로 같은 일이 생긴다.
- documents 큐에는 소비자가 없다. Ingest 전용 Worker 는 documents job 을 넣지 않는다. 첨부 행은 `download_status = 'PENDING'` 으로만 남는다(첨부 파이프라인 미동작).
- live 공고는 자동 분석이 없어 "AI 분석 대기" 수가 계속 커진다.
- 상단바 30초 폴링의 `/api/v1/dashboard/summary` 는 origin 공고를 limit 없이 읽는다. live 가 쌓이면 부하가 커진다.

## 8. 미검증 API (활성화하지 않음)

G2B 사전규격(`g2b-pre-spec`)·발주계획(`g2b-order-plan`)·업종 마스터(`g2b-industry-master`)·첨부(`g2b-attachment`): fieldMapping 없음. K-water 입찰·발주계획, LH 입찰·사전규격, G2B 조달요청, KEPCO 계약: `enabled: false`·`NOT_VERIFIED`. 출처: `infra/sources/registry.yaml`.

## 관련 문서

- [[2026-10-25-integration-finish-plan|10-25 통합 마무리 계획]]
- [[20261025-release-runbook|10-25 운영 반영 실행서]]
- [[07-DATA-PIPELINE|07 수집 파이프라인]]
- [[10-DEPLOYMENT|10 배포]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
