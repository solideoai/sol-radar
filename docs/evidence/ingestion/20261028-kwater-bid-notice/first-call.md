---
title: "10-28 K-water 입찰공고(15101635) 실호출 2회 — 결과와 반영"
doc: "evidence-20261028-kwater-bid-notice-first-call"
status: done
tags: [sol-radar, evidence, ingestion, kwater]
updated: 2026-10-28
---

# 10-28 K-water 입찰공고(15101635) 실호출 2회

[[plans/2026-10-28-all-sources-activation|10종 수집 계획]] 1순위 K-water 입찰공고를 사용자 승인으로 녹음한 기록이다. 호출은 **2회**였다(10행 1회, 진행상태 값을 다 보려고 100행 1회). 운영 ingest Worker 는 재시작하지 않았다.

## 1. 실행 (회사 서버, `/data/www/ai_workspace/sol-datagokr-rec`)

| 회 | 때 | 요청 | 결과 |
|---|---|---|---|
| 1 | 10:54 KST | `servcList`, `searchDt=202610`, 10행 | HTTP 200, `resultCode 00`, `totalCount 144`, 항목 10 |
| 2 | 12:18:57 KST | 같은 달, 100행(녹음 스크립트 상한), 새 폴더 `out/kwater-bid-servc-full` | HTTP 200, `resultCode 00`, `totalCount 147`, 항목 100 |

- 두 번 모두 운영 ingest Worker 이미지의 일회용 컨테이너로 불렀다. 녹음 폴더의 모든 파일이 `keyHits 0`·`serviceKeyParam 0`·`email 0`, `worker unchanged`, 일회용 컨테이너 남지 않음.
- 2회째 직전 Worker 는 LH 반영으로 12:15:34 에 새로 만든 컨테이너다(기준 상태를 다시 남긴 뒤 비교했다).

## 2. 응답에서 확인한 것 (100행)

| 항목 | 실응답 |
|---|---|
| 구조 | `response.header`·`response.body.items.item[]`, 명세 칸만 온다(명세 밖 칸 0). 담당자 `intnChargerNm` 은 녹음에서 가렸다 |
| 식별 | `tndrPbanno` 100/100, 모두 `B` + 10자리, 겹침 없음 |
| 공고일 | `tndrPblancDe` 8자리 날짜, 100행 모두 202610 |
| 진행상태 | 참가신청 32·입찰완료 26·적격신청 18·수의시담 6·PQ신청 5·가격입찰 4·서류제출 4·결과발표 2·공동분담·예가추첨·제안서평가 각 1 |
| 신청마감일 | `tndrPblancEnddt` 날짜 59행, `-` 41행. 참가신청 32행은 모두 10-28 이후, 적격신청 18·PQ신청 5행은 모두 지났다. `-` 는 뒤 단계에서만 나온다 |
| 금액 | `tndrPlnprc`(명세 "금액(원)") 0보다 큰 행 53, 0 인 행 47. 참가신청 32행은 모두 0 |

## 3. 정한 것 (사용자 결정 2026-10-28)

- 상태: **참가신청만 OPEN**, 확인한 나머지 10개 값은 CLOSED. 처음 보는 값은 격리한다. 처음 추천은 신청 단계 5개였으나, 녹음의 마감일·금액을 보고 두 번 좁혔다(서류제출·공동분담 → CLOSED, 적격신청·PQ신청 → CLOSED).
- 예산: 금액이 0보다 클 때만 `budgetKrw`(원, 부가세 포함 여부 미확인). 0 은 비운다.
- 마감: 날짜만 있어 `deadlineAt` 은 비운다. 원문은 `sourceMetadata.dates`.

## 4. 실제 파서·정규화로 확인 (개발 PC, 호출 0)

파싱 100/100, 정규화 100/100, 격리 0, 경고 0. OPEN 32(모두 참가신청, 참여 상태 `APPLICATION_OPEN`)·CLOSED 68, 예산 53/100, `deadlineAt` 0/100.

## 5. 이번에 바꾼 것

- `web/server/ingestion/external-normalize-kwater.ts`(새 정규화), `servcList` 를 검증한 조회 방식에 더함.
- 정기 수집은 창의 첫 달 **앞 한 달도 함께** 받는다. 공고월로만 조회되어 지난달 공고의 상태 변화가 이번 달 조회에 없고, 마감 시각도 없어 목록에서 걸러지지 않기 때문이다. 회차당 약 4회(지난달·이번 달 각 1~2쪽), 하루 약 32회(한도 10000).
- 참가자수·투찰자수는 수집할 때마다 바뀌어 revision 만 늘리므로 저장하지 않는다.
- fixture `fixtures/recorded/15101635/servcList.202610.p1.masked.json`, 재생 시험 2개("K-water 실응답 녹음 재생"), 앞 달 조회 시험 1개. 상태 매핑·예산 0 규칙을 바꾸면 시험이 실패하는 것을 확인했다.
- 미검증 조회 방식 시험 2개(`quota-ingestion`·`external-admin`)는 기본 조회 방식이 미검증이라는 데 기대고 있었다. 아직 미검증인 공사 목록(`cntrwkList`)으로 바꿨다.
- registry: `enabled: true`·`VERIFIED`·`APPROVED`, fieldMapping 채움. 가짜 키로 준비 상태를 보면 `READY · 정기 수집` 이다.

## 6. 남은 것

- 녹음은 147건 중 100건이다. 남은 47건에 처음 보는 진행상태가 있으면 그 행은 격리된다. 운영의 격리 건수를 보고 매핑을 더한다.
- 공사·물품(`cntrwkList`·`gdsList`) 목록은 녹음하지 않았다. 정기 수집은 용역(`servcList`)만 한다.

## 관련 문서

- [[plans/2026-10-28-all-sources-activation|10종 수집 계획]]
- [[evidence/ingestion/20261028-kepco-contract/first-call|KEPCO 첫 실호출]]
- [[PROGRESS|진행 상황]]
