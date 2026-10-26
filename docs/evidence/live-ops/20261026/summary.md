---
title: "10-26 실운영 전환 격리 확인 — 3시간 정기 수집·수동 불러오기·분석 차단"
status: done
tags: [sol-radar, evidence, ingestion, scheduler, browser]
updated: 2026-10-26
---

# 10-26 실운영 전환 격리 확인

브랜치 `feat/live-ops-schedule`(main 52fcc271 기준)의 변경을 운영 DB·회사 서버·공공 API 없이 확인한 기록이다.
실행서는 [[../../../plans/2026-10-26-live-ops-cutover|10-26 실운영 전환 실행서]], DEMO 정리는 [[../../demo-cleanup/20261026/summary|DEMO 공고 정리 실행서]]다.

## 환경

| 부분 | 값 |
|---|---|
| Supabase | 격리 로컬 스택 `sol-radar-live78`(API 127.0.0.1:57421). 데모 seed 19건 + 녹화 응답으로 넣은 실공고 97건 + 보존 확인용 3건 |
| Redis | 일회용 컨테이너 `sol-radar-live78-redis`(127.0.0.1:6479) |
| 웹 | `next dev` standalone(포트 3279). `SOL_RUN_MODE=mock`, `SOL_INGEST_MODE=live`, `SOL_DEFAULT_ORIGIN=live` |
| ingest worker | 실제 `createIngestWorker`(일정 등록·수동/정기 처리·예산·timing). g2b connector·보조 조회만 녹화 응답(`fixtures/recorded/15129394`) 재생, `fetch` 는 127.0.0.1 만 허용 |
| 공공 API 호출 | 0회 |

녹화 응답의 목록은 1쪽(100건)만 있고 totalCount 가 3555 라, 화면 확인용 worker 는 메모리 사본의 totalCount 를 100 으로 두고 `numOfRows: 100` 을 준다. 제품 코드와 녹음 파일은 바꾸지 않았다.
처음 두 회차는 이 설정이 없어 2쪽 요청이 404 로 멈춰 FAILED 로 남았다(재생기의 의도된 동작). 그 기록도 격리 DB 에 그대로 있다.

## 브라우저 확인 결과

`browser-result.json`: 29개 확인 모두 통과(failed 0). 화면은 `screens/`.

| 확인 | 결과 |
|---|---|
| 상단바(1440·1280) | "수집 n분 전"과 알림만 보인다. "실행 모드"·"AI" 문구 없음 |
| 접수 전 판정(GET manual-gate) | `nextAvailableAt: null`, 일정 `0 */3 * * *`·`Asia/Seoul`·`active: true`·다음 18:00 KST, `ingestMode: live` |
| [지금 불러오기] | 202 접수 → 같은 run 이 SUCCEEDED(중복 100, 공공 API 호출 1회 = 보조 조회 생략), 큐 대기 12ms |
| 쿨다운 | 단추 막힘 + "다음 불러오기 가능: 16:45"(KST). 판정 `sharedRun.mine: true`, 하루 1/20 |
| 같은 사용자 다른 탭 | 단추 막힘, 같은 안내. 단추를 거치지 않은 직접 POST 는 429 `MANUAL_COOLDOWN`, `Retry-After: 3591` |
| run 수 | 위 시도 전체에서 ingest_runs 는 1행만 늘었다 |
| 다른 관리자 | 단추 막힘 "다음 불러오기 가능: 15:55"(공유 10분). 직접 POST 는 409 `MANUAL_SHARED_RUN`, `mine: false`. 확인용으로 잠시 바꾼 analyst 역할은 ANALYST 로 되돌렸다 |
| 본문 없는 실공고 상세 | "분석 실행" 비활성 + "공고 본문 미확보 · 분석 준비 중". 직접 POST 는 409 `ANALYSIS_SOURCE_MISSING`(`SOURCE_TEXT_MISSING`), score_runs 0건 |
| DEMO 공고 상세 | "분석 실행" 활성, 미확보 안내 없음 |
| 공고 목록 기본 | 실공고만 20행 표시, DEMO 행 0 |
| 1280 넘침 | 대시보드·수집 관리·공고 상세 모두 가로 넘침 없음 |

콘솔 오류는 의도한 직접 요청의 429·409 와 `/health/ready` 503 뿐이다. 503 은 격리 환경에 AI gateway·분석 worker 가 없어서다.

### 확인 중 고친 것

- 막힌 [지금 불러오기] 단추가 흐려지지 않았다. `focusableWhenDisabled` 는 native `disabled` 대신 `aria-disabled`·`data-disabled` 를 달아 Button 의 `disabled:opacity-50` 이 걸리지 않는다.
  `live-ingest-control.tsx` 단추에 `data-disabled:opacity-50` 을 더했다(`03b-…-dimmed-1440.png`, opacity 0.5). `02`·`03` 화면은 고치기 전에 찍었다.
- 같은 패턴을 쓰는 기존 단추(`load-more.tsx` 등)는 이번 범위가 아니라 그대로 두었다.

### 남은 관찰

- 수집 관리 화면의 "API 서비스별 수집 현황" 표는 1440 에서 마지막 열(증분 수집)이 표 상자 안에서 잘려 보인다. 이번 브랜치가 바꾸지 않은 `ingestion-services.tsx` 의 기존 모습이다.

## 일정·예산·gate 통합 확인(실 Redis)

| 파일 | 내용 |
|---|---|
| `schedule-it-result.json` | BullMQ 6.3.17 실 Redis 11개 확인 통과: 옛 every 일정 → 같은 id cron 교체(즉시 회차 없음), 재기동 두 번에 일정 1개·대기 1개, 정각 전후 수동/정기 직렬 처리, 정기 실패 뒤 일정 유지, 예정 시각 = job id millis, 수동 800·정기 1000 예약 거절 |
| `manual-gate-it-result.json` | Lua gate: 다른 사용자 20건 동시 → CLAIMED 1·SHARED_RUN 19, 같은 사용자 20건 동시 → CLAIMED 1, 21번째 → DAILY_LIMIT(거절 때 키 기록 0), 손상 값·연결 실패는 닫힌 쪽(거절), 일정 등록 전 active false |
| `worker-start.log` | 기동 즉시 수집하지 않고 다음 정각(18:00 KST = 09:00Z)부터 돈다는 기동 줄과 수동 job timing 줄. 격리 Redis 에서 worker 를 세 번 다시 띄운 뒤에도 일정 1개·대기 회차 1개(`repeat:g2b-scheduled:1793005200000`)였다 |

## 독립 리뷰 반영(4영역)

worker·서버·화면·DEMO SQL 을 영역별로 따로 검토받았다. 메인 세션이 diff 와 시험으로 다시 확인한 뒤 받아들였다.

| 영역 | 고친 것 | 고치지 않은 것(이유) |
|---|---|---|
| worker | ingest Worker `concurrency: 1` 을 명시. 실행서에 보조 조회가 하루 902(수동 722)까지 갈 수 있음과 정각 직후 재기동 주의를 적었다 | `--once` 가 SCHEDULED 로 세는 것(의도), 첨부 job 종료 처리(이번 변경 전부터 있던 동작) |
| 서버 | claim 이 Redis 에 반영된 뒤 응답만 시간 초과돼도 503 을 주고 쿨다운을 되돌린다. 최신 revision 행이 없으면 500 대신 원문 미확보로 본다. 시험 2개 추가 | release 까지 실패하는 이중 장애(쿨다운은 1시간 뒤 풀린다), frontend POST 의 역할 확인(회사 API 가 막는다) |
| 화면 | 막힌 단추 흐림(`data-disabled:opacity-50`, 수동·fixture·"상태 확인 중" 단추), 접수 요청 중 두 번 누름 막기 | 클라이언트 fetch 시간 제한(서버가 relay 15초·Redis 3초로 끊는다) |
| DEMO SQL | C57(비 fixture run 의 수집 항목) 추가, 03 잠금을 차단 검사 앞으로, 알림·outbox 사후 검사를 조건으로, 04 Storage 보호 가드, 02b 한 트랜잭션 + `service_role` 권한 회수 | 없음. 격리 스택 r2 리허설에서 음성 시험 5종이 모두 막혔다([[../../demo-cleanup/20261026/summary|DEMO 실행서]] r2 절) |

리뷰 반영 뒤 `pnpm verify:changed` 는 exit 0 이다. 별도 격리 스택(n8e2e)에서 수집 관리 E2E 30/30 이 통과했다. 그 spec 이 찍은 화면은 `docs/evidence/phase-3/admin-ingestion/20261026-*` 에 있다.
Compose 가 필요한 `run-mode-badge`·`what-if.write` E2E 는 돌리지 않았다.

## 관련 문서

- [[../../../plans/2026-10-26-live-ops-cutover|10-26 실운영 전환 실행서]]
- [[../../demo-cleanup/20261026/summary|DEMO 공고 정리 실행서]]
- [[../../../PROGRESS|진행 상황]]
