---
title: "기업마당 정기 수집 — 실응답 녹음·전용 Worker 로컬 검증 (2026-10-28)"
status: done
tags:
  - sol-radar
  - evidence
  - program-notices
updated: 2026-10-28
---

# 기업마당 정기 수집 증거 (2026-10-28)

- 근거: [[16-DECISIONS|16]] ADR-040(부처 공고 수집·`program_notices` 표), 2026-10-28 사용자 요청(기업마당 자동 수집, KST 3시간 간격)과 사용자 결정 4개(전용 Worker, 기업마당만, 회사 녹음 1회로 실응답 검증, `program_notices` 유지).
- 브랜치 `feat/bizinfo-schedule`(worktree `sol-radar-worktrees/bizinfo-schedule`), 기점 main `c9319df3`.
- 회사 반영은 하지 않았다. 운영 Worker·DB는 바꾸지 않았다. 운영 DB에는 읽기 SELECT만 했다(§1).

## 1. 시작 전 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 수집 코드 | 있음. 기업마당 응답 해석·정규화·`(source, source_notice_id)` upsert·회차 기록(ADR-040, 10-21) | `web/server/program-notices/` |
| 일정 | 전체 Worker(`web/worker/main.ts`)에만 등록, 기동 때 1회 + 60분마다(`setInterval`). KST 정각 일정이 아니다 | `web/worker/program-notices.ts` |
| 회사 운영 | 전체 Worker가 없다(ingest·analysis·documents·notify 전용만). 그래서 돌지 않았다 | `infra/company/README.md` §7~§9 |
| 운영 DB | `program_notices` 0행, `program_notice_runs` 0행. 같은 DB의 최근 하루 `ingest_runs`는 g2b 8회·lh 1회 `SUCCEEDED`(운영 DB임을 확인) | 2026-10-28 16:1x KST 읽기 SELECT 3회 |
| 재시도 | 없음(실패하면 그 회차 `FAILED`, 다음 회차가 다시 부름) | `collect.service.ts` |
| 실응답 | 받은 적 없음. 합성 샘플로만 시험했다 | `fixtures/recorded/program-notices/`에 중기부만 있었다 |

## 2. 실응답 녹음 (실호출 1회)

- 다른 세션(`sol-radar-e3`)이 회사 서버의 일회용 컨테이너에서 `scripts/recorded/record-program-notices.mjs --source bizinfo`를 1회 실행했다(사용자 승인). 2026-10-28 16:05:18 KST, 시도 표식으로 재호출을 막았다. 이 세션은 기업마당을 부르지 않았다.
- 요청 `params` `{dataType: json, searchCnt: 100, searchLclasId: 02}`(키는 `params`에 없다). 응답 HTTP 200, `application/json; charset=UTF-8`, 100건(분야 02 전체 `totCnt` 279 중 최신 100).
- 가림: `refrncNm`(문의처) 통째로, `reqstMthPapersCn` 안 연락처 패턴. 녹음 CLI 저장 전·뒤 흔적 검사 0(e3 보고).

이 세션이 따로 확인한 것:

| 검사 | 결과 |
|---|---|
| 받은 파일 sha256 | `63c5dd87fc3dfc5e4add194acc30af9f6d505125f3a25b705dc772fbcd448fa9`(e3 보고·회사 원본과 같음) |
| 저장소 사본 | Prettier 서식만 맞췄다. `body` 문자열 sha256 `a11f718421b5baa7ef9b8d4aee31b98523fcb558797132f45d064b1a2578aff9`는 서식 전·뒤 같다 |
| 흔적(파일 전체) | 이메일 0, 전화 `\d{2,4}-\d{3,4}-\d{4}` 0, 대표번호 0, `crtfckey`(대소문자 무관) 0 |
| 녹음 형식 | `sol-program-recorded/v0.1`, `loadProgramRecordings`가 건너뛰지 않고 읽는다 |

## 3. 명세와 다른 실제 모양

공식 명세: `https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi`(2026-10-28 확인). 명세에는 오류 응답 형식과 호출 한도가 없다.

| # | 실제 | 명세 | 조치 |
|---|---|---|---|
| 1 | `jsonArray`가 바로 항목 배열이다 | `jsonArray` 아래 채널 칸과 `item` 배열 | 해석기가 이미 세 모양을 받는다. 고칠 것 없음 |
| 2 | 해시태그 칸 이름이 `hashtags` | `hashTags` | **고쳤다.** 전에는 태그가 분야 1개("기술")만 남았다. 이제 `hashtags`를 먼저, `hashTags`를 다음으로 읽는다 |
| 3 | 100건 중 56건이 지역 해시태그 16개를 모두 붙인다 | — | **정규화를 더했다.** 16개가 모두 있으면 "전국" 하나로 줄인다. 줄이지 않으면 태그 상한 20개를 지역이 채워 부처·주제 태그가 잘린다 |
| 4 | 신청 기간 30건이 날짜가 아닌 문구다(예산 소진시까지 15, 상시 접수 8, 모집 완료시까지 4, 세부사업별 상이 2, 모집 완료시 1) | — | 스펙대로 `apply_start_on`·`apply_end_on` null. 고치지 않았다 |
| 5 | 명세에 없는 칸 `updtPnttm`(100)·`pldirSportRealmMlsfcCodeNm`(중분류 6종)·`rceptEngnHmpgUrl`(47)·`fileNm`·`flpthNm`(87) | — | 읽지 않는다(문의처·신청 사이트는 ADR-040대로 저장하지 않는다) |
| 6 | 공고 주소가 `https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=…` | 경로 예시 다름 | 호스트가 같아 `toSourceLink`를 통과한다 |

## 4. 바꾼 것

| 파일 | 내용 |
|---|---|
| `web/worker/program-notices-only-main.ts`(새로) | 부처 공고 전용 Worker. 자기 큐 `program-notices`에 Job Scheduler `bizinfo-scheduled`(Asia/Seoul `0 */3 * * *`, 나라장터와 같은 상수)를 건다. 소스는 기업마당만. 명령 `--check`·`--status`·`--once`·`--unschedule`. live에서만 뜨고 `BIZINFO_API_KEY`가 비면 이름만 출력하고 exit 1 |
| `infra/compose.program-notices-only.company.yaml`(새로) | 프로젝트 `sol-radar-program-notices`, 서비스 `program-notices-worker`, 이미지 `sol-radar-program-notices-worker:${PROGRAM_NOTICES_WORKER_TAG}`, `redis_default` network, `infra/sources` 읽기 전용 마운트 |
| `web/server/program-notices/collect.service.ts` | live 요청에 수집과 같은 재시도(`withRetry`: 시간 초과·429·5xx, 최대 3번 더). 회차에서 돌 소스를 고를 수 있다(`sources`) |
| `web/server/program-notices/bizinfo.ts` | §3의 2·3 |
| `web/worker/program-notices.ts` | 전체 Worker도 같은 재시도를 쓴다. 실행 모드·경로 읽기를 전용 Worker와 나눠 쓴다(60분 주기는 그대로) |
| `fixtures/recorded/program-notices/bizinfo/api.20261028.masked.json`(새로) | §2 녹음. mock·fixture 모드가 재생한다 |
| `web/worker/program-notices-only-main.test.ts`(새로), `web/worker/committed-features.test.ts` | §5 |
| `infra/company/README.md` §10 | 회사 반영 실행서(빌드 → `--check`·`--status` → [승인] `--once` → [승인] `up` → 확인 → 되돌리기) |

바꾸지 않은 것: ingest 큐·일정·quota, `infra/sources/registry.yaml`·`program-notices.yaml`, 마이그레이션, 화면, G2B·LH·KEPCO·K-water 코드.

## 5. 검증

### 5.1 시험

- `web/worker/program-notices-only-main.test.ts` 3개: 일정(id·cron·시간대, ingest 큐와 다른 큐), live 회차(첫 요청 503 → 1초 뒤 재시도 → 녹음 본문 200, 기업마당만 2회 호출·중기부 0회, 100건 저장, 로그에 키 없음, "전국" 태그), `--check`(키 있으면 `BIZINFO_API_KEY SET`·exit 0·키 값 출력 없음, 비면 exit 1).
- `committed-features.test.ts`: mock 재생에서 기업마당이 `NO_RECORDING`이 아니라 `SUCCEEDED`·100건 저장이 된다.
- 변형 확인(각각 되돌림): 해시태그 칸을 `hashTags`만 읽게 → 1개 실패, 재시도 판정을 비재시도로 → 1개 실패(호출 1회), `sources` 무시 → 1개 실패(중기부 호출), cron을 `0 * * * *`로 → 1개 실패.

### 5.2 로컬 DB 저장 (격리 Supabase, 네트워크 0회)

scratchpad의 격리 Supabase(API 59321, 마이그레이션 전부 적용)에 fixture 모드로 녹음을 재생하고 service role 저장소(`createSupabaseProgramNoticesStore`)로 저장했다. 같은 회차를 여러 번 돌렸다.

| 항목 | 값 |
|---|---|
| 회차마다 | `bizinfo` `FIXTURE` `SUCCEEDED`, fetched 100·saved 100·dropped 0 |
| `program_notices` 행 수 | 1회차 뒤 100, 다시 돌려도 100(upsert 중복 제거) |
| 고유 `source_notice_id`·`dedupe_key` | 100·100 |
| 채운 칸 | 기관·등록일·개요·신청 방법·대상 100, 신청 시작·마감 70 |
| `is_demo` | 모두 false |
| 원문 주소 호스트 | `www.bizinfo.go.kr`만 |
| 등록일 범위 | 2026-09-10 09:21:40 ~ 2026-10-28 14:10:15 KST |
| 태그 | 최대 20개, "전국" 56건 |
| 네트워크 호출 | 0 |

### 5.3 전용 Worker 일정 (임시 Redis 컨테이너)

`redis:7-alpine`을 `127.0.0.1:16590`에 잠깐 띄우고, 격리 Supabase를 가리켜 Worker를 실제로 실행했다(16:20 KST). `BIZINFO_API_KEY`는 가짜 값이고, 기동 즉시 부르지 않으므로 기업마당 호출은 0회다.

```text
== --check
부처 공고 설정: …/infra/sources/program-notices.yaml
기업마당: 분야 02 · 최대 100건 · BIZINFO_API_KEY SET
정기 수집: 매일 KST 00·03·06·09·12·15·18·21시 정각(Asia/Seoul), 큐 program-notices, 일정 bizinfo-scheduled
program-notices-only worker 확인 통과: SOL_RUN_MODE=live
== 기동(15초 뒤 SIGTERM)
bizinfo-scheduled 일정: 매일 KST 00·03·06·09·12·15·18·21시 정각(Asia/Seoul). 기동 즉시 수집하지 않고 다음 정각 2026-10-28T09:00:00.000Z 부터 돈다(즉시 수집은 --once)
program-notices-only worker started: SOL_RUN_MODE=live
exit=0
== --status
Job Scheduler 1개
- bizinfo-scheduled 0 */3 * * * Asia/Seoul 다음 2026-10-28T09:00:00.000Z
job: waiting=0 delayed=1 active=0 completed=0 failed=0
== 다시 기동 뒤 --status
Job Scheduler 1개
== --unschedule → --status
program-notices 큐의 정기 일정을 지웠다: bizinfo-scheduled
Job Scheduler 0개
```

다음 회차 `09:00Z`는 18:00 KST다. 다시 기동해도 일정은 1개다. 이 Redis에 `bull:ingest*` 키는 생기지 않았다. 임시 Redis는 확인 뒤 멈췄다.

### 5.4 변경 범위 검사

`pnpm verify:changed`(검증 슬롯 안) exit 0: 루트 `format:check`·`test` 286 통과, web `verify:quick`(타입·린트·구조·토큰, Vitest 99파일 886 통과), `services/ai` 170 통과, `services/decision` 57 통과. 전체 `pnpm verify`(빌드 포함)는 돌리지 않았다.

## 6. 남은 것

- 회사 반영(실행서 §10)은 2026-10-28에 끝났다(e3, 사용자 승인). 16:42 회사 HEAD `db442be1` ff·이미지 `db442be15481`·`--check` 통과, 16:43:24 `--once` `SUCCEEDED` 100/100, 16:43:41 `up`(Job Scheduler 1개). 18:00 첫 정기 회차 `SUCCEEDED` 100/100. 운영 `program_notices` 기업마당 100행([[../company-rollout/20261028/sources-rollout|회사 반영 기록]]).
- `/bids` "부처 지원사업" 탭 화면 확인은 남았다.
- 신청 기간 문구(상시 접수 등)를 화면에 보일지는 정하지 않았다(지금은 기간 없음으로 보인다).
- 기업마당 호출 한도는 명세에 없다. 하루 8회 × (1 + 재시도 최대 3)회다.

## 관련 문서

- [[16-DECISIONS|16 결정 기록]] — ADR-040
- [[recording-20261021|중기부 RSS 녹음 증거]]
- `infra/company/README.md` §10
- `scripts/recorded/README.md` "부처 공고 녹음"
