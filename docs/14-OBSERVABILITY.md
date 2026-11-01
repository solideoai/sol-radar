---
title: "14. 관측성·운영"
doc: "14"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-11-01
---

# 14. 관측성·운영

## 로그/메트릭
- 목표: `requestId`, `jobId`, `orgId`(내부 pseudonymous, DB 열 `org_id`), `bidId`, `elapsedMs`를 구조적 JSON 로그로 남긴다. 토큰(Supabase access token·refresh token)·`SUPABASE_SERVICE_ROLE_KEY`·원문·비밀번호는 로깅하지 않는다.
- 현재: Worker는 이벤트마다 JSON 한 줄을 남긴다. AI gateway는 키=값 텍스트 한 줄이다(`services/ai/src/sol_ai/app.py`, 예 `extract requestId=… ms=…`). Route Handler 요청 ID를 Worker·gateway 로그에 잇는 일은 해커톤 뒤다(미결정 26-4, [[16-DECISIONS|16]]).
- 지표 후보: 수집 마지막 성공 시각, 호출 실패/429 비율, 지연, 큐 적체, 분석 실패/재시도/timeout, 추천 분포, 사람 판정과 AI 차이, 알림 중복. GPU VRAM은 회사가 운영하므로 우리가 재지 않고, 회사가 주는 값이 있으면 기록만 한다([[16-DECISIONS|ADR-025]]).

## 관리자 화면 지표 (5개)
이 화면은 데이터 수집 관리 `/admin/ingestion`이다(화면 명세는 [[06-UI-UX|06 UI]] §5.8, [[16-DECISIONS|ADR-021]]).

> [!note] 구현 상태
> `/admin/ingestion`에 수집 실행 이력·실행 상세(적재·격리·오류·호출 수)·수동 수집·서비스별 수집 현황이 있다(1번). 2·3번은 대시보드 "공공조달 요약" 띠의 분석 대기·추천(`BID`) 권고로 일부 보인다. 4·5번과 metrics endpoint는 없다.

관리자 화면은 `memberships.sol_role=ADMIN` 사용자의 세션으로 읽고, 조직 데이터는 RLS(`org_id in (select public.my_org_ids())`)가 그 조직 행만 보여 준다. `outbox_events`는 화면 역할에 권한·정책이 없다(`20261019000006`). 5번 적체 건수를 화면에 어떻게 집계할지는 정하지 않았다([[04-DATABASE|04 DB]], [[09-SECURITY|09 보안]]).

|#|지표|원천|범위|구현|
|---|---|---|---|---|
|1|소스별 마지막 수집 성공 시각·상태|`ingest_runs` 소스별 최근 1건 (`status`, `finished_at`, `summary`)|공용 (`org_id` 없음)|있음. 격리가 1건 이상이면 `PARTIAL`(화면 `부분 완료`). 로컬 `demo:reset` 기준 값은 소스 `fixture`, `summary.quarantined=1`(FX-12)|
|2|분석 상태 분포 (최근 24시간)|`score_runs.status` group by|`score_runs.org_id`|일부(대시보드 띠). 로컬 리허설에서는 `COMPLETED`가 사전 분석 건수([[19-DEMO-SCENARIO\|19]] §3 5번)와 맞는다|
|3|권고 분포|`score_runs.recommendation`|`score_runs.org_id`|일부(대시보드 띠). 추천(`BID`)·보류(`WATCH`)·비추천(`NO_BID`) 건수가 fixture 기대 라벨([[07-DATA-PIPELINE\|07]])과 맞는다|
|4|사람 결정 vs 권고 불일치율|`bid_reviews.decision` vs `score_runs.recommendation`. `review_flags`의 `MODEL_RULE_DISAGREEMENT` 건수 별도|`bid_reviews.org_id`|없음. 책임 있는 AI 모니터링 지표([[09-SECURITY\|09 보안]])|
|5|알림 outbox 적체·중복|`outbox_events.status=PENDING` 건수(소비 대상 네 종 `NOTIFY_EVENT_TYPES`만 센다. 공고 이벤트 `BID_*`는 소비자가 없어 `PENDING`으로 쌓이므로 넣지 않는다, [[13-NOTIFICATIONS\|13 알림]]), `notifications` idempotency 위반 시도 수|`notifications.org_id`. `outbox_events.org_id`는 nullable|없음|

테이블·컬럼 이름의 원천은 [[04-DATABASE|04 DB]].

## 상태 기준
- `/health/live`: Next.js 프로세스 살아있음(`web/app/health/live/route.ts`).
- `/health/ready`(`web/app/health/ready/route.ts`): 응답 `{status, checks:{db, redis, storage, ai}}` ([[05-API-SPEC|05 API]]). `db` = Supabase(Postgres) 연결, `redis` = Redis, `storage` = Supabase Storage, `ai` ∈ `mock | local | hosted | unavailable`.
  - `storage`·`ai`는 web이 직접 재지 않는다. Worker가 Redis 키 `sol-radar:dependency-health`에 남긴 보고를 읽는다. 보고가 120초보다 오래됐거나, 보고의 실행 모드·Supabase URL·버킷(`bid-documents`·`bid-parsed`)이 이 web의 설정과 다르면 쓰지 않는다. 쓸 보고가 없으면 `unavailable`이다(`web/server/health/health.service.ts`, `dependency-report.ts`).
  - Vercel(frontend)의 `/health/ready`는 자체 검사를 하지 않고 회사 redis-api의 readiness를 그대로 전달한다(`web/app/_lib/application-health.ts`, [[16-DECISIONS|ADR-049]]).
  - db·redis·storage 중 하나라도 불가 → HTTP `503`, `status: "unavailable"`.
  - AI만 불가 → HTTP 200, `status: "degraded"`, `checks.ai: "unavailable"`. AI는 선택 의존성이다.
  - 모두 정상 → HTTP 200, `status: "ok"`.
- 관리자 AI 상태: `GET /api/v1/admin/ai/status`(`web/app/api/v1/admin/ai/status/route.ts`, ADMIN). 필드는 [[05-API-SPEC|05 API]]를 따른다.
- Worker(`web/worker`)는 HTTP 엔드포인트가 없다. 상태는 Compose healthcheck로 본다. Worker가 heartbeat 파일(`WORKER_HEARTBEAT_FILE`, 기본 `/tmp/sol-worker-heartbeat`)을 10초마다 갱신하고, healthcheck는 수정 시각이 30초 이내인지 판정한다([[16-DECISIONS|ADR-024]] D3). 회사 ingest·기업마당 전용 Worker는 `--check`(설정 확인)·`--status`(큐 상태 읽기)가 있고, documents·알림 전용 Worker는 `--check`만, analysis 전용 Worker는 둘 다 없다(`web/worker/*-only-main.ts`, `infra/company/README.md`).
- 관리자 화면: 위 5개 지표 + 오류 원인(민감정보 제거). 지금은 1번과 오류 원인(실행 상세)이 있다.

## 장애 대응
수집 오류: 이전 데이터 + freshness 배너. AI 불가: 규칙 점수로 처리(`PARTIAL`). Supabase(Postgres) 장애·네트워크 끊김: 조회·쓰기 불가 및 명확한 503(`component: db`), Supabase Auth도 같은 프로젝트라 로그인 불가. 큐 backlog: rate 제한. 장애별 사용자 노출은 [[02-ARCHITECTURE|02 아키텍처]] 장애 원칙 표. Sentry/Prometheus/Grafana 도입과 표준 metrics endpoint는 해커톤 뒤다(지금은 endpoint가 없다). DB 백업·복구는 Supabase가 관리한다(세부 미검증, [[10-DEPLOYMENT|10 배포]] 운영 절). Compose 볼륨(`redisdata`·`qdrantdata`) 복구 시험은 해커톤 뒤 계획이고 실행 기록은 없다. 마이그레이션은 append-only라 되돌리기도 새 마이그레이션 파일로 한다.

## 기관 요약과 API별 수집 현황

[[16-DECISIONS|ADR-047]]로 채택됐고 구현돼 있다(`web/app/(app)/(work)/admin/ingestion/ingestion-services.tsx`, `GET /api/v1/admin/ingestion/services`). 설계는 [공공조달 확대 스펙](../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md) §10·12다.

- 4 Source 요약과 10 API 서비스(partition)별로 연결·인증·마지막 수집/성공·fetched/new/updated/duplicate/error/quarantine을 구분한다. 인증키 발급·인증 성공·정상 0건·장애·미검증은 별개 상태다. 상태 값은 레지스트리와 화면이 정본이다.
- 통계 GET은 저장된 DB 결과만 읽고 수집·탐침을 실행하지 않는다. 마지막 run 하나를 기관 전체 정상으로 표시하지 않는다. source별 고유 공고·고유 사업기회·반복 fetched·HTTP 호출 수는 다른 지표다.
- 정상(`HEALTHY`)은 마지막 수집이 `SUCCEEDED`·`COMPLETE`이고 정기 간격 + 30분(지금 180 + 30 = 210분) 안에 끝났을 때다(`web/server/opportunities/freshness.ts`·`repo.ts`). 기관 요약은 비활성·미완료 서비스도 반영한다. 서비스별 장애 격리(한 서비스의 인증 오류·한도 소진이 다른 서비스를 멈추지 않음)는 구현돼 있다([[07-DATA-PIPELINE|07 수집]]).
- 구현·적용 기록: [격리 구현 보고](evidence/procurement-expansion/20261021-implementation.md), [main 통합·운영 적용 기록](evidence/procurement-expansion/20261022-release.md).

## 관련 문서
- [[02-ARCHITECTURE|02 아키텍처]]
- [[04-DATABASE|04 DB]]
- [[09-SECURITY|09 보안]]
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[13-NOTIFICATIONS|13 알림]]
