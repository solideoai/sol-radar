---
title: "N8 /admin/ingestion — 검증 보고(2026-10-20)"
tags:
  - sol-radar
  - evidence
updated: 2026-10-20
---

# N8 `/admin/ingestion` — 검증 보고

배정: sol-radar-aa(사용자 지시) → sol-radar-54. 판정: sol-radar-e8. 브랜치 `n8/admin-ingestion`(base main `301f2a5`).
계획·판정 기록은 [구현 계획](../../../plans/2026-10-20-n8-admin-ingestion-plan.md), 화면 명세는 [디자인 스펙](../../../plans/2026-10-20-n8-admin-ingestion-design.md)이다.

## 1. 만든 것

- Route Handler 3개(05 §2 :75-77): `GET·POST /api/v1/admin/ingestion/runs`, `GET /api/v1/admin/ingestion/runs/:id`. 근무 조직 `sol_role = ADMIN` 만, 그 밖은 403.
- POST 는 권한 → `Idempotency-Key` → 16KB → 속도 제한(조직당 5회/분) → 본문 → 실행 모드(409 `RUN_MODE_MISMATCH`) → 멱등 재현(Redis) → 진행 중(409 `INGESTION_IN_PROGRESS`) → 키 잡기 → 큐 → 202. `ingest_runs` 행은 worker 가 Route Handler 가 만든 `runId` 로 만든다.
- 화면 `web/app/(app)/(work)/admin/ingestion/`: 실행 이력 표(커서 더 보기), 수동 수집 대화상자, 실행 상세 서랍(`?run=`), polling, 403 안내.
- 마이그레이션 `20261019000019_ingest_runs_column_grants.sql`(보안 점검 W1): `ingest_runs` 의 화면 역할 select 를 열 11개로 줄였다. 요청자는 조직 소유 감사(`audit_logs` INGEST_MANUAL)로 찾는다.
- 하지 않은 것: 소스별 카드(D3), 시도별 재시도 로그(D4), 사이드바 줄(ADR-021 노출 조건 뒤, N8·C6 B2 중 늦게 병합되는 쪽).

## 2. 검증 결과

| 검사 | 결과 | 명령 |
|---|---|---|
| `pnpm verify` | exit 0. 루트 node 729/729, web vitest 197 파일 6327/6327, web build 통과, AI pytest 1369/1369 | `verify-slot.sh pnpm verify` |
| N8 E2E | 30/30(1440·1280 두 폭). 반복 확인 60/60(`--repeat-each=2`) | `pnpm -C web test:e2e:ingestion`(아래 환경) |
| DB 정책(PGlite) | 284/284. W1 열 권한 ①~④, 감사 경로, 두 번 적용 포함 | `node --test scripts/database.test.mjs` |
| 보안 점검(security-auditor) | 차단 0. 경고 W1 → 마이그레이션 000019 로 해결. 참고 I1 해결, I2·C1·I3 는 판정대로 유지 | 계획서 §5 |

시험은 구현보다 먼저 RED 로 썼고(test-server), 조건을 하나씩 뒤집는 변형 확인을 거쳤다. 구현 전후로 시험 파일 sha256 이 같았다.

## 3. E2E 환경(격리)

공용 로컬 DB(54321)는 다른 세션의 기준선이라 쓰지 않았다. N8 전용 격리 Supabase 를 띄웠다.

- project_id `sol-radar-54-n8`, API `127.0.0.1:59731`, DB `59732`(studio·realtime·storage 끔). 마이그레이션 000001~000019 적용.
- Redis 는 호스트 redis 의 DB 5(`redis://127.0.0.1:6379/5`). 끝난 뒤 N8 키(`idem:ingest:*`·`rate:ingest:*`·`bull:ingest:*`)만 지운다.
- compose·worker·preanalyze 를 부르지 않는다. seed 는 `demo:reset` 하나이고 주소·service role 은 격리 status 값으로만 넘긴다.
- 웹 env: `SOL_RUN_MODE=fixture`, `API_CURSOR_SECRET`(실행마다 무작위), MinIO·AI gateway 없음(상단바 AI 지표는 "확인 중" + 실패 툴팁이 이 환경의 기대값이다).

## 4. 화면 증거

| 상태 | 1440 | 1280 |
|---|---|---|
| 목록(SEED run: 부분 완료, 신규 19, 격리 1, 재시도 2) | `20261020-phase3-admin-ingestion-loaded-1440.png` | `…-loaded-1280.png` |
| 서랍(격리 `fixture:DEMO-2026-0012` `MISSING_REQUIRED_FIELD` `missing: title`, 재시도 2회 — 11 §5 17번) | `…-drawer-seed-1440.png` | `…-drawer-seed-1280.png` |
| 수동 수집 대화상자(g2b 비활성 + 이유) | `…-dialog-1440.png` | `…-dialog-1280.png` |
| 202 뒤 접수됨 행 | `…-accepted-1440.png` | `…-accepted-1280.png` |
| 403(VIEWER) | `…-forbidden-1440.png` | `…-forbidden-1280.png` |

두 폭 모두 가로 넘침 0, 콘솔 오류 0(`/health/ready` 503 한 줄은 이 환경의 기대값이라 감시에서 뺐다).

## 5. 알려진 한계

- 요청자는 worker 가 감사를 남긴 뒤에 보인다. 그 전의 run 은 `requestedBy: null` 이다.
- 같은 `Idempotency-Key` 를 24시간 뒤 다시 쓰면 Redis 기록이 없어 재현·409 를 판정하지 못한다(05:28 키 보존 24시간, 판정 I2).
- 큐에만 있는 수동 g2b job 은 진행 중 판정에 걸리지 않는다. 공용 G2B 할당량 문제는 해커톤 뒤 보안 후속(판정 C1).
- polling 주기 전환(60초 뒤 5초, 300초 상한)은 훅 안에 있어 단위 시험이 상수만 고정한다.
- 마이그레이션 000019 는 격리 DB 에만 적용했다. 공용 로컬 DB 는 병합 때 3e 와, 클라우드는 사용자 승인 뒤 3e 가 적용한다.

## 관련 문서

- [[05-API-SPEC|05 API]] §2 수집 관리
- [[06-UI-UX|06 UI/UX]] §5.8
- [[11-TESTING|11 테스트]] §5 17번
- [[16-DECISIONS|16 결정]] ADR-021·023·030
