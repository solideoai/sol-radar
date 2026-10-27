---
title: "10-27 외부 수집 서비스별 격리 확인 — 키 없음·인증 실패·창 상한·KEPCO cursor·서비스별 증분 수집"
status: done
tags: [sol-radar, evidence, ingestion, scheduler, browser]
updated: 2026-10-27
---

# 10-27 외부 수집 서비스별 격리 확인

브랜치 `feat/ingest-source-isolation`(worktree `sol-radar-worktrees/ingest-source-isolation`, main `26efefc1` 기준, 커밋 전)의 0순위 안전 작업을 운영 DB·회사 서버·Redis·공공 API 없이 확인한 기록이다. 모든 시험은 녹음 응답과 모의 객체로만 돌았다. 외부 API 호출 0회다.

## 무엇을 바꿨나

| 요구 | 구현 |
|---|---|
| 한 서비스의 키 없음·인증 실패가 Worker 를 멈추지 않는다 | `worker/env.ts` `inspectExternalServiceKey`(던지지 않음). `worker/main.ts` 서비스별 상태 `READY`·`NOT_CALLABLE(이유)`·`QUOTA_UNVERIFIED`·`KEY_MISSING`·`KEY_INVALID`·`OPERATION_UNVERIFIED`. 운영 중 resultCode 30·31 은 `withAuthCircuit` 가 그 서비스만 `AUTH_FAILED` 로 막는다 |
| 나라장터 입찰공고는 예전과 같다 | `resolveG2bSource` 는 그대로 fail-fast. `g2b-scheduled` id·cron·창 규칙 변경 없음 |
| 서비스별 [증분 수집]은 웹 `SOL_RUN_MODE` 가 아니라 서버 상태로 판단 | 화면 `service-collect.ts`(수집 모드·registry·정기 일정·Worker 서비스 상태·같은 출처 실행 중·수동 제한). 서버 `ingestion-admin.service.ts` 가 `ingest:source-readiness` 로 503 `source` 를 돌려준다 |
| 창 상한·cursor 진행 | 외부 정기 창 최대 24시간(`EXTERNAL_WINDOW_CAP_MS`), 불완전 창만 24시간 안에서 재사용, 잘리면 `ingest.window.capped`·`params.windowCap` |
| KEPCO PARTIAL 반복·한도 미정 | 응답 범위 미검증 PARTIAL 이어도 다음 90일 조각으로 cursor 진행. `quota.daily: null` 은 `QUOTA_UNVERIFIED` 로 부르지 않는다(값을 지어내지 않음) |
| 업종·근거법규 분리 | `role: "REFERENCE"`(15129467). 서비스 표에서 빼고 "참조 데이터" 절로 보인다. 활성 서비스 수에 세지 않는다 |
| 수동 60분·정기 3시간 유지 | gate·cron 변경 없음 |
| 서비스별 일정 중복 없음 | `<key>-scheduled` 를 같은 id 로 upsert, 준비 안 된 서비스는 remove. 재기동 6회 upsert 뒤 일정 3개 시험. 외부 회차는 priority 10 이라 같은 정각의 나라장터가 먼저 돈다 |

## 시험

| 시험 | 결과 |
|---|---|
| `worker/external-ingest.test.ts` + `server/ingestion/external-ingestion.test.ts` | 통과. 키 없음·인증 실패·한도 미정·DISABLED gate, 창 상한 6종, 겹침 재사용, PARTIAL 재시도, KEPCO 조각 진행·재시도 재개, resultCode 22 예산 소진이 다른 서비스에 번지지 않음 |
| `worker/ingest-only-main.test.ts` | 통과. 여러 서비스 일정 동시 등록·재기동 중복 없음, 키 없는 서비스만 빠지는 격리, Redis 상태 기록 실패에도 기동 유지, `--unschedule` 전체 삭제, 인증 회로 |
| `server/ingestion/external-admin.test.ts`·`manual-ingest-gate.test.ts` | 통과. `WORKER_NOT_READY`·`KEY_MISSING`·`AUTH_FAILED`·`QUOTA_UNVERIFIED` 503(claim·job 없음), READY 202, 상태 읽기 실패 503 redis |
| `app/_lib/redis-api-client.test.ts` | 통과. 503 source 사유 전달, 판정 `services` 전달 |
| `admin/ingestion/service-collect.test.ts`(새) | 통과. 판정 없음·mock 모드·registry 꺼짐·일정 꺼짐·Worker 상태 3종·Worker 상태 없음(나라장터는 열림)·같은 출처 실행 중·쿨다운 |
| 관련 묶음 전체(23파일) | 342 통과(독립 리뷰 반영 뒤) |
| 독립 리뷰 | 상·중 0. 하 2건 반영: 검증된 다른 조회 방식의 수동 요청을 `OPERATION_UNVERIFIED` 로 막던 것, 모르는 서비스·상태가 섞이면 상태 묶음·판정 응답 전체를 거절하던 것(버전이 어긋나도 아는 서비스만 남기고 판정은 그대로) |
| 전체 `pnpm verify` | exit 0(web 80파일 727시험·Next 빌드·AI pytest 153·결정 57) |

## 화면(1440·1280)

부품만 실제 Chromium 에 그려 찍었다(임시 브라우저 시험, 저장소에 남기지 않음). 위 A 는 지금 운영 registry, 아래 B 는 가정(K-water 입찰 READY·LH 입찰 키 없음·KEPCO 한도 미정·나라장터 실행 중)이다. 두 폭 모두 문서 가로 넘침 0.

- [1440](services-1440.png) · [1280](services-1280.png)
- A: 나라장터 입찰공고만 [증분 수집] 열림. 나머지는 연결/인증 칸의 registry 이유("활성화 대기"·"필드 매핑 미구현")로 막힘. 업종·근거법규는 아래 "참조 데이터" 절에 따로.
- B: 나라장터는 "수집이 진행 중입니다", K-water 입찰은 열림(다른 출처 실행 중이어도 막지 않음), LH 는 "API 키 없음", KEPCO 는 "호출 한도 미확정".

## Worker `--check`(현재 registry, 더미 env, 네트워크 없음)

[check-current-registry.txt](check-current-registry.txt): 외부 6종 모두 `NOT_CALLABLE(DISABLED) · 정기 수집 제외`, 확인 통과 exit 0. 현재 registry 로 새 이미지를 띄워도 일정은 `g2b-scheduled` 하나다.

## 확인하지 않은 것

- 회사 Redis·redis-api·ingest Worker 위 동작(재시작·이미지 교체는 승인 대상이라 하지 않았다)
- 로그인 뒤 `/admin/ingestion` 전체 화면 E2E(격리 Supabase 필요). 부품 화면과 단위·계약 시험으로 대신했다
- 실제 공공 API 응답(녹음 응답만 사용)
