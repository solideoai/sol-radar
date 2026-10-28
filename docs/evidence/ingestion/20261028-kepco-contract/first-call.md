---
title: "10-28 KEPCO 전자입찰계약정보(15148223) 첫 실호출 1회 — 결과와 반영"
doc: "evidence-20261028-kepco-contract-first-call"
status: done
tags: [sol-radar, evidence, ingestion, kepco]
updated: 2026-10-28
---

# 10-28 KEPCO 전자입찰계약정보(15148223) 첫 실호출 1회

[[plans/2026-10-28-all-sources-activation|10종 수집 계획]] 1순위 KEPCO 를 사용자 승인("1회 호출 승인")으로 실행한 기록이다. 호출은 **1회**였다. 운영 ingest Worker·redis-api 는 재시작하지 않았다.

## 1. 실행 (회사 서버, `/data/www/ai_workspace` 안에서만)

| 단계 | 결과 |
|---|---|
| 사전 검증(호출 0) | 10:46:28 KST. 녹음 파일 3개 sha256 일치. 운영 Worker 이미지 `1646e7d033a1`, 시작 `2026-10-28T00:15:36Z`·재시작 0. ingest 큐 `waiting=0 active=0 failed=0`, Job Scheduler `g2b-scheduled` 1개. 키 `{"kepco":"SET","length40":true}`(값 출력 없음). dry-run `calls 0` |
| 호출 1회 | 10:46:48 KST(`fetchedAt 2026-10-28T01:46:48.786Z`), 공고일 2026-10-27 하루, `returnType=json`. HTTP 200, 358,660 바이트, 항목 71, 판정 `SUCCESS` |
| 보안 검사(호출 0) | 녹음 폴더 9개 파일 모두 `keyHits 0`·`apiKeyParam 0`·`email 0`. `worker unchanged`. 일회용 컨테이너 남지 않음 |

- 녹음 폴더는 `/data/www/ai_workspace/sol-kepco-rec` 다. 시도 표식(`electContract.attempt.json`)이 남아 있어 같은 명령을 다시 돌려도 부르지 않는다.
- 실행은 운영 ingest Worker 이미지의 일회용 컨테이너(`compose run --rm --no-deps`)로 했다.

## 2. 응답에서 확인한 것

| 항목 | 실응답 |
|---|---|
| 구조 | 최상위 `{"data":[…]}`. 결과 코드(`resultCode`)·건수(`totalCount`) 칸이 없다 |
| 행 | 71행, 행마다 52칸. 명세 칸은 모두 있다(`absentSpecFields: []`). 명세 밖 22칸 중 값이 있던 20칸은 녹음에서 `***` 로 지웠다 |
| 식별 | `no`·`name`·`companyId`·`progressState` 71/71. 회사 `COM01` 42·`COM08` 7·`COM06` 6·`COM04`·`COM05` 4·`COM09`·`COM10` 3·`COM02` 2 |
| 상태 | `progressState` 는 `AttendProgress`·`PreAttendProgress` 두 값뿐 |
| 일시 | `noticeDate` 는 8자리 날짜(`20261027`). 나머지 일시는 `YYYY-MM-DD HH:mm:ss` |
| 금액 | 모두 원 단위 정수. `presumedPrice` 69/71. 추정가격·추정금액이 둘 다 있는 29행 중 19행이 추정금액 = 추정가격 × 1.1, 2행은 1.0, 8행은 1.08~3.39 |
| 첨부 | `filenlink1~5` 는 `http://srm.kepco.net/printDownloadAttachment.do?id=…` |

## 3. 실제 파서·정규화로 확인 (개발 PC, 호출 0)

`parseExternalPayload`·`normalizeExternalNotice("kepco-ebid-contract")` 에 녹음을 넣었다.

- 파싱 71/71, 정규화 71/71, 격리 0, 공고 ID(`COM01:G012606031` 꼴) 71개 모두 다르다.
- `status` 71건 모두 `OPEN`. 참여 상태는 입찰 진행 49·참가 신청 21·마감 1.
- `deadlineAt` 71/71, `budgetKrw` 69/71(추정가격이 빈 2건만 없음).
- 첨부 0/71. 모든 첨부 주소가 허용 목록 밖이라 `ATTACHMENT_URL_BLOCKED` 로 막혔다. 그 밖의 경고는 없다.

## 4. 이번에 바꾼 것

- `budgetKrw` 를 `presumedPrice`(추정가격, 부가세 별도)로 채운다. 원 단위 정수(15자리 이하)로 읽힌 값만 쓰고, 못 읽으면 예산을 비우고 `BUDGET_UNPARSED` 경고를 남긴다. `sourceMetadata.amounts` 는 원 단위로 적고, 추정가격만 부가세 별도로 표시한다. 추정금액·예비가격기초금액의 부가세 포함 여부는 정하지 않았다(배수가 갈림).
- `fixtures/recorded/15148223/electContract.20261027.masked.json` 와 재생 시험("KEPCO 실응답 녹음 재생")을 더했다. 예산 매핑이나 경고를 빼면 시험이 실패하는 것을 확인했다.
- `web/worker/ingest-only-main.test.ts` 의 "한도 미정" 경우는 실제 registry 의 KEPCO `quota.daily: null` 에 기대고 있었다. 이제 시험 안 registry 사본에서 비운다.
- registry KEPCO: `enabled: true`·`VERIFIED`·`APPROVED`, `quota.daily: 100`(공급자 한도가 아니라 자체 상한, 사용자 결정), `lastVerifiedAt 2026-10-28`. 가짜 키로 준비 상태를 보면 `외부 소스 kepco-ebid-contract: READY · 정기 수집` 이다.
- 정기 수집은 3시간마다 1회 부른다. 24시간 창은 90일 조각 하나라 회차마다 호출 1회, 하루 약 8회다.

## 5. 남은 것

- 첨부: `http://srm.kepco.net` 은 http 이고 허용 목록 밖이다. KEPCO 공고는 첨부 없이 제목·본문(`etc`·참가 자격)만으로 분석한다. 허용 여부는 따로 정한다(F12).
- `noticeDate` 는 날짜만 있어 KST 18:00 으로 저장된다(F10). LH 등록일과 같은 동작이다.
- 공고가 없는 날의 응답 모양은 확인하지 않았다.
- 건수 칸이 없어 수집 회차는 늘 `PARTIAL` 이다(`COVERAGE_UNVERIFIED_SOURCES`).

## 관련 문서

- [[plans/2026-10-28-all-sources-activation|10종 수집 계획]]
- [[evidence/ingestion/20261027-lh-bid-notice/first-call|LH 첫 실호출]]
- [[PROGRESS|진행 상황]]
