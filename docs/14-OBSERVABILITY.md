---
title: "14. 관측성·운영"
doc: "14"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-10-16
---

# 14. 관측성·운영

## 로그/메트릭
구조적 JSON 로그에 `requestId`, `jobId`, `organizationId`(내부 pseudonymous), `bidId`, `elapsedMs`; 토큰/원문/비밀번호 로깅 금지. 지표: 수집 마지막 성공 시각, 호출 실패/429 비율, 지연, 큐 적체, 분석 실패/재시도/timeout, GPU VRAM(`ai-local`만), 추천 분포, 사람 판정과 AI 차이, 알림 중복.

## 데모 관리자 화면 지표 (5개)
데모에서 보여주는 관리자 화면은 아래 5개만 다룬다. 나머지 지표는 metrics endpoint로만 제공한다.

|#|지표|원천|데모에서 보이는 값|
|---|---|---|---|
|1|소스별 마지막 수집 성공 시각·상태|`ingest_runs` 소스별 최근 1건 (`status`, `finished_at`, `summary`)|소스 `fixture`, 기동 직후 시각, 상태 성공, `summary.quarantined=1`(FX-12, `ingest_errors` 1건). 목록 화면 신선도 배너와 같은 값|
|2|분석 상태 분포 (최근 24시간)|`score_runs.status` group by|`COMPLETED` 건수가 사전 분석 건수([[10-DEPLOYMENT\|10 배포]] 기동 절차에서 돌린 수)와 일치, 장애 리허설 후 `PARTIAL` 1건|
|3|권고 분포|`score_runs.recommendation`|BID / WATCH / NO-BID 건수가 fixture 기대 라벨([[07-DATA-PIPELINE\|07 수집 파이프라인]])과 일치|
|4|사람 결정 vs 권고 불일치율|`bid_reviews.decision` vs 해당 `score_runs.recommendation`. `score_runs.review_flags`의 `MODEL_RULE_DISAGREEMENT` 건수 별도|리뷰 기록 직후 갱신. 책임 있는 AI 모니터링 지표 ([[09-SECURITY\|09 보안]])|
|5|알림 outbox 적체·중복|`outbox_events.status=PENDING` 건수, `notifications` idempotency 위반 시도 수|적체 0, 중복 0|

테이블·컬럼 이름의 원천은 [[04-DATABASE|04 DB]].

## 상태 기준
- `/health/live`: 프로세스 살아있음.
- `/health/ready`: DB/Redis/스토리지 필수 연결 → 불가 시 `503`. 응답 `{status, checks:{db, redis, storage, ai}}` ([[05-API-SPEC|05 API]]). AI는 선택 의존성: `checks.ai`는 `mock | local | hosted | unavailable`이고, AI만 불가면 `status: degraded`(HTTP 200), 나머지는 `ok`. 같은 값이 화면 우상단 `AI: …` 표시에 쓰인다 ([[06-UI-UX|06 UI]]).
- 관리자 화면: 위 5개 지표 + 오류 원인(민감정보 제거).

## 장애 대응
수집 오류: 이전 데이터 + freshness 배너. AI 불가: 규칙 점수로 처리(`PARTIAL`). PG 장애: 쓰기 불가 및 명확한 503. 큐 backlog: rate 제한. 장애별 사용자 노출은 [[02-ARCHITECTURE|02 아키텍처]] 장애 원칙 표. Sentry/Prometheus/Grafana 도입은 해커톤 이후, 표준 metrics endpoint부터 제공. 월 1회 복구 테스트 및 마이그레이션 롤백 문서화.

## 관련 문서
- [[02-ARCHITECTURE|02 아키텍처]]
- [[04-DATABASE|04 DB]]
- [[09-SECURITY|09 보안]]
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
