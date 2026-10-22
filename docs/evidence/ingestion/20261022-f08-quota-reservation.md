---
title: "F08 호출 예산 원자적 예약 — 구현 및 검증"
status: verified-local
tags:
  - sol-radar
  - ingestion
  - quota
updated: 2026-10-22
---

# F08 호출 예산 원자적 예약 — 구현 및 검증

> 후속(2026-10-22): 아래는 최초 구현 당시의 기록이다. 이후 기능 브랜치에 최신 origin/main을 반영하고 일회용 실제 Redis 검증 및 전송 재실행/보조 조회 장애 수정까지 수행했다. 현재 결과·명령·출력·커밋 제외 범위는 [격리 Redis 검증 기록](20261022-f08-isolated-redis.md)을 따른다. 아래 실제 Redis 미실행/미병합 서술은 최초 시점에 해당한다.

기준: [외부 수집 완성 계획](../../plans/2026-10-22-external-ingestion-completion-plan.md)의 F07/F08/F13/F14와 P0-B를 읽고 **F08 일일 호출 예산만** 구현했다. 브랜치는 `fix/ingestion-quota-reservation`, 기준 HEAD는 `20cb79fa61df2e1d4ebf430e2bd8e9f65f484ceb`다. 기존 미커밋 계획 문서는 보존했다. 커밋·Push·Merge·배포는 수행하지 않았다.

## 1. 기존 결함의 정확한 원인

`pullPages()`는 페이지 재시도 묶음 전에 quota를 조회하고, `fetchPageWithRetry()`가 끝난 뒤 `retried + 1`을 합산했다. G2B 보조 조회도 전체 `fetchAux()`가 끝난 뒤 합산했다. 따라서 재시도와 동시 Worker의 다음 HTTP 전에는 한도 검사/차감이 없었다. Redis의 사후 INCRBY 자체는 원자적이어도 이미 전송한 초과 HTTP를 막을 수 없었다.

RED 확인: 예산 1회에서 503→성공 경로가 HTTP 2회, 동시 수동/자동 run도 HTTP 2회를 보냈다. 기대값 1회인 회귀 테스트 두 개가 모두 실패했다. 추가로 live quota 의존성 누락 시 Connector가 생성되는 회귀를 RED로 확인한 뒤 차단했다.

## 2. 수정/추가 파일

| 파일 | 변경 목적 |
| --- | --- |
| `web/server/ingestion/quota-store.ts` | `reserve()` 포트 및 메모리 원자 예약, 안전 정수 한도 검증 |
| `web/worker/quota-store.ts` | Redis 예약/소진 처리 Lua EVAL, 기존 키와 TTL 유지 |
| `web/server/ingestion/connector.model.ts` | 내부 송신 전 hook 및 예약 저장소 장애 분류 |
| `web/server/ingestion/g2b-http.ts` | 실제 목록/보조 HTTP 직전 hook 실행 |
| `web/server/ingestion/official-api-connector.ts` | G2B 목록 hook 전달 |
| `web/server/ingestion/external-api-connector.ts` | 검증된 요청의 HTTP 직전 hook 실행 |
| `web/server/ingestion/g2b-aux.ts` | 각 보조 페이지/재시도 예약, 실제 송신 수 집계, 예약 실패 시 남은 operation 중단 |
| `web/server/ingestion/ingestion.service.ts` | run별 공유 예약 경계, KST 날짜 재확인, 사후 add 제거, 실제 송신 수만 quota_used에 반영 |
| `web/worker/ingest-queue.ts` | live quota 의존성 누락 시 Connector 생성 전 차단 |
| `web/server/ingestion/quota-ingestion.test.ts` (신규) | 핵심 예산/재시도/동시성/날짜/G2B 공유 통합 시험 12개 |
| `web/worker/quota-store.test.ts` (신규) | Redis 포트 계약 시험 5개 |
| `web/worker/external-ingest.test.ts` | mock/fixture 무호출 및 live quota 누락 시험 3개 추가 |
| `docs/PROGRESS.md` | 진행 기록 추가; 기존 항목 보존 |
| 이 보고서 (신규) | 결과와 운영 전 한계 기록 |

제품 코드 9개, 테스트 3개, 기록 2개다. 기존 계획 문서는 이번 작업의 수정 파일에 포함하지 않는다. `retry.ts`의 재시도/backoff 정책은 그대로 재사용하며 각 실제 HTTP 경계에 같은 예약 hook이 적용된다.

## 3. 인터페이스 변경

- `QuotaStore.reserve(serviceId: string, at: Date): Promise<boolean>` 추가. 한도/잘못된 카운터는 거절하고 저장소 통신 실패는 예외를 반환한다. 기존 get/add/markExhausted는 유지한다. 수집 코드에서 예약 후 add는 호출하지 않는다.
- 내부 `FetchPageInput`과 `G2bAuxRequest`에 선택적 `beforeRequest` hook을 추가했다. G2B HTTP의 내부 `fetchEnvelope()`에도 선택 인자로 전달한다. hook은 실패 분류 또는 null을 반환하며 URL/키를 받지 않는다. 공개 API JSON이나 Redis job data에는 함수를 넣지 않는다.
- 내부 실패 종류 `QUOTA_UNAVAILABLE`을 추가하고 기존 오류 코드 `QUOTA_STORE_UNAVAILABLE`로 기록한다. 해당 실패는 재시도하지 않는다.
- `QuotaRedis` 포트에 eval이 필요하다. Repository의 실제 IORedis 연결과 메모리 구현을 갱신했으며 기존 get/add의 진단용 사용은 호환된다.
- 테스트/녹음용 `runIngest()`의 optional quota는 유지한다. 제품 live Worker는 quota가 없으면 HTTP Connector를 만들지 않는다.

## 4. Redis 원자성 및 호출 수 처리

동일 serviceId와 KST 날짜가 `quota:{serviceId}:{YYYYMMDD}` 하나를 공유한다. 목록/면허제한/참가지역/e발주 첨부와 그 재시도가 모두 이 키를 사용한다.

하나의 EVAL 안에서 `GET → 숫자/한도 검사 → INCR → EXPIRE(172800초)`를 수행한다. 여러 Worker가 한도를 동시에 읽더라도 승인된 예약만 증가한다. 공급자 코드22의 소진 처리도 별도 EVAL로 현재 값과 한도의 최대값을 유지한다. Lua 검토상 검사와 갱신 사이에 다른 요청이 끼어들지 않는다.

HTTP마다 날짜를 새로 읽는다. 예약 응답을 기다리는 동안 KST 날짜가 바뀌면 새 날짜에도 예약한 후 보낸다. 예약 응답을 확인하지 못하면 전송하지 않는다. 모호한 예약/중단된 요청의 슬롯은 환불하지 않아 예산이 보수적으로 소모될 수 있다. 실제 전송 직전까지 승인된 요청 수로 run의 quota_used를 집계하고, 로컬 거절이나 공급자 소진 마커를 HTTP 수로 더하지 않는다.

기존 재시도 최대3회/backoff, G2B 보조 조회 90% 중단 정책, 인증/URL/redirect/크기/개인정보 정책은 변경하지 않았다. TPS 제한은 이번 F08 일일 한도 구현 범위에 포함하지 않았다.

## 5. 검증 결과

| 검증 | 결과 |
| --- | --- |
| F08 최초 RED 2개 | 두 경로 모두 실제 모의 HTTP2/기대1로 실패 확인 |
| F08 신규 회귀 | 20개 통과: 도메인 통합12 + Redis 포트5 + Worker3 |
| 관련 집중 시험 | 신규20 + 기존 관련20, 합계40 통과 |
| 최종 `pnpm verify:changed` | 웹 `verify:quick` 통과: 54파일/468테스트, TypeScript·ESLint·Prettier·린트 가드·아키텍처/순환 의존성·토큰/색 검사 통과 |
| diff 검토 | 제품9개/테스트3개 파일별 검토, `git diff --check` 통과 |
| 독립 코드 검토 | 마지막 슬롯 경합·hook 전파·보조 재시도/페이지·code22·KST·누락 quota 검토. Critical/Important 없음 |
| 실제 API/DB/Redis | 실행하지 않음. fetch 주입/메모리 저장소/모의 Redis 포트 사용 |
| 실제 Redis Lua/TTL/다중 프로세스 | 별도 테스트 인스턴스와 redis-server 실행 파일이 없어 미실행. 운영 Redis를 대체 사용하지 않음 |
| 전체 저장소 빌드/운영 E2E | 이번 변경 범위 검사에 포함되지 않아 미실행 |

G2B 목록+보조 조회는 예산4에서 목록1/면허 재시도2/지역1 뒤 첨부 조회를 차단하고, 예산5에서는 첨부까지 성공했다. 둘 모두 Redis 포트의 예약 수와 run의 HTTP 집계가 일치하는 것을 확인했다. 별도 정상 retry 시험에서는 503 후 성공이 2회로만 집계되고 add가 호출되지 않았다.

Redis 포트 시험은 EVAL 1회·인자·KST 키·TTL172800·정상/거절/비정상 응답·연결 오류·누락/잘못된 카운터 계약을 확인한다. **실제 Redis의 Lua 실행, 물리적 TTL 만료, 네트워크 분할 및 실서버 Worker 경합을 증명한 시험은 아니다.**

최초 웹 전체 검사에서는 새 도메인 테스트의 Worker import가 아키텍처 규칙에 걸렸다. Worker 케이스를 기존 Worker 시험 파일로 이동했고 검사 규칙 변경 없이 최종 검사를 통과했다.

## 6. 운영 배포 전 호환성과 남은 위험

- 키 형식/카운터 정수/TTL을 유지하므로 데이터 변환이나 DB migration이 필요하지 않다. 카운터를 초기화하지 않는다.
- 기존 QuotaStore 사용자 구현에는 reserve, QuotaRedis 대체 포트에는 eval이 필요하다. 공개 HTTP 계약은 유지되지만 이 내부 포트 변경은 같은 Worker 버전으로 배포해야 한다.
- **이전 방식의 Worker와 혼합 운용하면 초과 방지가 보장되지 않는다.** 기존 ingest consumer를 안전하게 정지/드레인한 뒤 모두 새 버전으로 바꾸는 별도 운영 절차가 필요하다. 이번에는 수행하지 않았다.
- Redis ACL/환경에서 EVAL과 Lua가 호출하는 GET/INCR/EXPIRE/SET을 허용해야 한다. 허용 여부는 테스트 Redis 및 별도 승인된 운영 점검으로 확인해야 한다.
- Redis 응답 유실/Worker 중단으로 슬롯이 소모됐지만 HTTP는 전송되지 않을 수 있다. 안전을 위해 자동 환불하지 않는다. Redis 자체 데이터 유실/과거 값 복원에 대한 전역 한도 보장까지 추가한 것은 아니다.
- 기존 페이지 사전 quota 조회가 자정 이전 값을 읽다가 자정 이후 EXHAUSTED를 반환하면 해당 run을 보수적으로 중단할 수 있다. 다음 동일 창 재시도에서 복구하며 초과 호출을 허용하는 문제는 아니다.
- 저장 실패 후 재개·실제 Redis 만료/동시성·혼합 버전 배포는 별도 테스트 Redis가 있는 환경에서 추가 검증해야 한다. 현 결과만으로 운영 활성화 완료라고 판단하지 않는다.
- 작업 중 별도 세션이 main을 갱신했다. 읽기 전용 reflog에서 17:47:09 `integration/committed-work-20261022` fast-forward, 17:49:09 최종 `02fc7c930ebe3cd06eedc986bb9dbac08bc5904f`를 확인했고 현재 main은 clean이다. 기존 보존 manifest의 d57fcae/미커밋40/옛 index와 같다고 주장하지 않는다. 이 작업에서는 main에 쓰기 명령을 실행하지 않았다. F08 수정 제품/기존 시험 경로는 기준20cb79f와 새 main 사이에 차이가 없지만, 최신 main 전체와의 통합 검증은 별도 단계다.

## 7. 남은 P0-B 작업

- F07: 신규 외부 Connector의 Retry-After/rate-limit 헤더 연결. 이번에는 미수정.
- F13: 수신20MiB와 증거 저장2MiB의 불일치 및 구조적인 저장 실패/복구 처리. 이번에는 미수정.
- F14: 기관별 새 필드/자유 본문 개인정보 정제와 증거 정책 보강. 이번에는 미수정.

Registry DISABLED, .env, 운영 Redis/DB, migration, Docker, 전체 Worker, Qwen/Bosun/AI Gateway/Dependency Reporter/Redis API Gateway는 변경하지 않았다. main에는 읽기 전용 확인만 수행했으며 위 별도 세션의 변경을 복원/초기화/덮어쓰지 않았다.

## 8. 다음 단계

먼저 별도 테스트 Redis에서 실제 EVAL/TTL/다중 클라이언트 경합과 연결 중단을 검증한다. 그 결과와 F07/F13/F14를 각각 별도 작업으로 진행한 후 운영 승인 여부를 검토한다. 이번 작업은 F08 로컬 구현·검증에서 종료한다.
