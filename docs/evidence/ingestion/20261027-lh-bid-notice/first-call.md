---
title: "10-27 LH 입찰공고(15159012) 첫 실호출 1회 — 결과와 고친 것"
doc: "evidence-20261027-lh-bid-notice-first-call"
status: done
tags: [sol-radar, evidence, ingestion, lh]
updated: 2026-10-27
---

# 10-27 LH 입찰공고(15159012) 첫 실호출 1회

[[plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]] §3 ①~④를 사용자 승인으로 실행한 기록이다. 호출은 **1회**였다. 운영 Worker·redis-api 는 재시작하지 않았고, registry 는 바꾸지 않았다.

## 1. 실행

| 단계 | 결과 |
|---|---|
| ① 전송 | `record-lh-bid-notice.mjs`·`program-notices-lib.mjs`·`masking.mjs` 세 파일을 회사 서버 `/tmp/sol-lh-rec/src` 로. 서버 sha256 이 계획 값과 같았다(`6fa89295…`·`c96b1c88…`·`bb879d7b…`) |
| ② 사전 검증(호출 0) | 15:10 KST. 운영 Worker 이미지 `sol-radar-ingest-worker:43e4e02465c2`, 재시작 0·healthy, Job Scheduler `g2b-scheduled` 1개(`failed=0`). 키 `{"lh":"SET","form":"ENCODED","decodable":true}`. dry-run `calls 0`·`outWritable true`, 저장 폴더 빈 채 |
| ③ 호출 1회 | 15:13:15 KST(`fetchedAt 2026-10-27T06:13:15.447Z`), `--date 20261026 --page 1 --rows 10`. HTTP 200, `resultCode 00`(NORMAL SERVICE), `totalCount 12`, 항목 10 |
| ④ 보안 검사(호출 0) | `/tmp/sol-lh-rec` 아래 9개 파일 모두 `keyHits 0`·`serviceKeyParam 0`·`email 0`. `worker unchanged`·`status unchanged`. 일회용 컨테이너 남지 않음 |

- 회사 저장소는 `/data/www/ai_workspace/sol-radar-app`(HEAD `f0ad424`)다. 운영 ingest Worker 의 compose 작업 폴더 라벨로 확인했다. `/data/www/ai_workspace/sol-radar-deploy`(HEAD `4750a18`)는 지난 배포 폴더다.
- 처음 실행은 2-3 뒤에서 끊겼다. 원격 `bash -s` 로 넘긴 스크립트의 나머지를 `docker compose run` 이 stdin 으로 먹었다(`--status` 는 stdin 을 읽지 않아 영향 없음). 2-4·2-5 는 docker 명령마다 `</dev/null` 을 붙여 다시 돌렸다.
- 시도 표식(`getOpenBidInfo.attempt.json`)이 서버에 남아 있어 같은 명령을 다시 실행해도 부르지 않는다.

## 2. 응답에서 확인한 것

녹음(`sol-external-recorded/v0.1`, `contentType text/xml;charset=EUC-KR`, `rawSha256 5933c7a2…`)을 개발 PC 에서 실제 파서·정규화(`parseExternalPayload`·`normalizeLhBidNotice`, 브랜치 `d8763223`)에 넣었다. 파싱 10/10, 정규화 10/10 이 격리 없이 지나갔다.

| 항목 | 실응답 |
|---|---|
| 문자 인코딩 | `text/xml;charset=EUC-KR`, XML 선언도 `encoding="EUC-KR"` |
| 구조 | `<body>` 아래 `<items>` 없이 `<item>` 이 바로 온다. 명세 밖 태그 0개 |
| 공고명 | `<bidnmKor><![CDATA[…]]> </bidnmKor>` — CDATA 뒤에 공백 |
| 값 | 거의 모든 값 뒤에 공백 한 칸(파서가 다듬는다) |
| 공고번호·차수 | `bidNum` 7자리, `bidDegree` 2자리(`00`·`01`) |
| 일시 | 등록일 `tndrbidRegDt` 8자리(`20261026`). 접수 시작·마감·개찰은 `2026/11/02 16:00` 꼴. 공동수급 마감 `cooperdocAcptEndDtm` 은 비거나 같은 꼴 |
| 금액 | 10건 모두 원 단위 정수, `presmtPrc + addtTax = designPrc`. 9건은 부가세가 추정가격의 10%, 1건(`prcscoreExclusAmt` 있음)은 아니다. `fdmtlAmt` 는 `designPrc` 와 같거나 천 원 단위로 올린 값 |

## 3. 운영 전에 막혔을 결함 — 고쳤다

| # | 결함 | 운영에 켰다면 | 고친 것 | 시험 |
|---|---|---|---|---|
| 1 | Worker 가 응답을 `TextDecoder("utf-8", { fatal: true })` 로 읽었다 | 한글이 든 LH 쪽은 전부 디코딩 예외 → `HTTP_ERROR`, 회차마다 실패하며 한도만 씀 | `external-api-connector.ts`: `Content-Type` charset 이 EUC-KR 계열(`euc-kr`·`ks_c_5601-1987`·`windows-949`)이면 EUC-KR 로, 나머지는 예전처럼 UTF-8 로 읽는다. 둘 다 fatal | `lh-bid-notice.test.ts` "EUC-KR 응답(Content-Type charset)을 한글 그대로 읽어 저장한다" |
| 2 | `2026/11/02 16:00` 꼴 일시를 읽지 못했다 | 마감(`deadlineAt`)·입찰 시작·종료가 빈 채로 저장 | `external-normalize-lh.ts` `lhDate` 가 이 꼴을 KST 로 읽는다(공용 날짜 해석기는 그대로) | "실응답의 YYYY/MM/DD HH:mm 일시를 KST 로 읽어 …" |
| 3 | 금액 단위가 `UNVERIFIED` 였다 | 예산 외 금액이 쓰이지 않음 | 원 정수면 `unit/currency KRW`·`amountKrw`. 추정가격 부가세 별도, 설계·기초금액 포함, 부가세·가격점수 제외금액은 `UNVERIFIED` | "금액은 원 단위로 남기고 …" |
| 4 | 녹음 스크립트가 응답을 UTF-8(깨진 글자 허용)로 읽었다 | 이번 녹음의 한글이 `U+FFFD` 로 바뀌어 상태값·공고명을 판독할 수 없다. 원본 바이트는 남기지 않아 되살릴 수 없다 | `record-lh-bid-notice.mjs` 가 Worker 와 같은 규칙으로 charset 대로 읽는다. 읽지 못하면 저장하지 않고 멈춘다 | "EUC-KR 응답을 charset 대로 …", "charset 과 맞지 않는 바이트는 …" |
| 5 | 녹음 스크립트가 CDATA 뒤 공백이 있는 공고명을 못 읽어 `bidnmKor 0/10`·`FORMAT_ISSUE` 로 판정했다 | 판정만 틀림(Worker 파서는 읽었다) | 요약의 태그 읽기가 CDATA 앞뒤 공백을 허용 | "공고명이 CDATA 뒤에 공백을 두고 와도 …" |

- 다섯 시험 모두 고치기 전에 실패하는 것을 먼저 봤다.
- 운영 Worker 이미지(Node 22.23.4, ICU 78.3)에서 `new TextDecoder("euc-kr", { fatal: true })` 가 `한글` 을 디코드했다(`docker run --network none`, env 없음).
- `pnpm verify:changed` exit 0(루트 249·web 86파일 769개). 전체 `pnpm verify` 는 돌리지 않았다.

## 4. 다시 녹음 1회 — 15:47 KST (사용자 승인)

`602d7c2d` 의 녹음 스크립트(sha256 `c5cead2a…`)로 계획 §3 "다시 녹음"을 했다. 1회차 결과는 서버 `/tmp/sol-lh-rec/out-1`·`run-output-1.txt` 로 옮겨 두었다(지우지 않음). 오늘 LH 호출은 이것까지 **2회**다.

| 단계 | 결과 |
|---|---|
| ② 사전 검증 | 해시 3개 `성공`, 이미지 `43e4e02465c2`, 재시작 0·healthy, Scheduler `g2b-scheduled` 1개(`failed=0`), 키 SET·decodable, dry-run `calls 0`·`outWritable true` |
| ③ 호출 1회 | HTTP 200, `00`, `totalCount 12`, 항목 10. 판정 **`SUCCESS`**. `bidnmKor 10/10`, 정규화 가능 10/10, 명세 밖 태그 0, 빠진 명세 태그 0 |
| ④ 보안 검사 | `out`·`out-1` 포함 12개 파일 모두 `keyHits 0`·`serviceKeyParam 0`·`email 0`. `worker unchanged`·`status unchanged`. 일회용 컨테이너 없음 |

녹음 `contentType text/xml;charset=EUC-KR`, `U+FFFD` 0개. 한글 상태류 값:

| 칸 | 값 |
|---|---|
| `bidKind` | 일반공고, 정정공고 |
| `bidProgrsStatus` | 입찰진행중 |
| `zoneHqCd` | 강원·경기남부·경기북부·대구경북·대전충남·인천 지역본부 |
| `cstrtnJobGbNm` | 시설공사, 용역, 지급자재 |
| `tndrCtrctMedCd` | 수의공고, 일반경쟁, 제한경쟁 |

개발 PC 에서 `602d7c2d` 의 `parseExternalPayload`·`normalizeLhBidNotice` 에 넣었다. 10/10 정규화, 격리 0. 마감(`deadlineAt`) 10/10 채워짐(예: `2026/11/02 16:00` → `2026-11-02T07:00:00.000Z`). 상태는 9건 `OPEN`(입찰진행중), 정정공고 1건(`2603787`, 차수 `01`)은 `AMENDED`. "상태 값을 읽지 못해" 메모 0건. 지금 `statusOf` 그대로 맞는다.

## 5. 아직 모르는 것

- 취소·마감·유찰 같은 다른 `bidProgrsStatus` 값. 이번 10건은 모두 "입찰진행중"이었다.
- 2쪽(`totalCount 12` 의 나머지 2건)과 빈 날짜의 응답.
- 녹음을 `fixtures/recorded/15159012/` 에 넣는 것, 재생 시험, registry 갱신(계획 §4 4-1)은 승인 뒤다.

## 관련 문서

- [[plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]]
- [로컬 구현 증거](summary.md)
- [[PROGRESS|진행 상황]]
