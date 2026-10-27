---
title: "10-27 LH 입찰공고(15159012) 연동 로컬 구현 — 합성 응답 시험"
doc: "evidence-20261027-lh-bid-notice"
status: done
tags: [sol-radar, evidence, ingestion, lh]
updated: 2026-10-27
---

# 10-27 LH 입찰공고(15159012) 연동 로컬 구현

브랜치 `feat/lh-bid-notice`(worktree `sol-radar-worktrees/ingest-source-isolation`, 기준 main `8cfaac31`)의 로컬 구현 기록이다.

> [!warning] 실응답으로 검증하지 않았다
> LH API 를 한 번도 부르지 않았다. 시험은 공개 명세로 만든 **합성 응답**(`fixtures/synthetic/15159012/`)으로만 돌았다. 그래서 registry 는 `enabled: false`·`verification: NOT_VERIFIED`·`approvalStatus: NOT_REQUESTED`·`keyIssuance: UNKNOWN`·`sampleResponses: []` 그대로다. 운영 Worker 의 LH 상태는 계속 `NOT_CALLABLE(DISABLED)` 다.

## 1. 공개 명세 — 2026-10-27 열람

data.go.kr 서비스 설명 페이지 `https://www.data.go.kr/data/15159012/openapi.do` 와 그 페이지가 싣는 Swagger(JSON sha256 앞 16자 `d9581cd1dcfede93`)를 읽었다. 이것은 문서 열람이고 API 호출이 아니다.

| 항목 | 명세 |
|---|---|
| 주소 | `https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo` (GET, XML) |
| 요청 변수 | `serviceKey`(필수), `pageNo`, `numOfRows`, `tndrbidRegDtStart`·`tndrbidRegDtEnd`(입찰등록일 범위, 필수), `bidNum`(선택) |
| 응답 필드 | 공고 `bidNum`·`bidDegree`·`bidnmKor`·`bidKind`·`bidProgrsStatus`·`zoneHqCd`·`cstrtnJobGbNm`·`tndrCtrctMedCd`, 일시 `tndrbidRegDt`·`cooperdocAcptEndDtm`·`tndrdocAcptBgninDtm`·`tndrdocAcptEndDtm`·`openDtm`, 금액 `presmtPrc`·`addtTax`·`designPrc`·`fdmtlAmt`·`prcscoreExclusAmt`, 그 밖 `sunjungNm`·`gongdongNm`·`zoneRstrct1~4`·`vndrrstrctNm1~4`·업종별 요구면허 칸 |
| 없는 것 | 상세 페이지 URL, 첨부, 발주기관 칸 |
| 결과 코드 | 00 정상, 03 데이터없음, 20 접근거부, 22 한도초과, 23 TPS 초과, 30 미등록 키, 32 미등록 IP |
| 한도 | 개발계정 하루 1,000회. 개발·운영 단계 모두 자동 승인 |

명세가 정하지 않은 것: 날짜 자릿수, 금액 단위·부가세 포함 여부, `bidKind`·`bidProgrsStatus` 값 목록, 03 을 실제로 돌려주는지, 우리 계정의 활용신청 상태.

## 2. 요구 사항별 구현

| # | 요구 | 구현 | 시험 |
|---|---|---|---|
| 1 | 요청 변수·응답 구조 | 요청은 기존 `external-request.ts`(등록일 시작·끝 한 조각)를 그대로 쓴다. 응답은 공통 XML 파서 | 정규화·수집 시험 전부 |
| 2 | fixture 와 실녹음 분리 | 합성은 `fixtures/synthetic/15159012/*.synthetic.xml`(README 에 "실응답 아님"). 실녹음 자리는 `fixtures/recorded/15159012/`(비어 있음) | 녹음 스크립트 시험 |
| 3 | 필드 매핑 | `external-normalize-lh.ts`. 공고번호 `bidNum`, 공고명 `bidnmKor`, 발주기관 "한국토지주택공사" 고정(지역본부 `zoneHqCd` 는 `agencyCode`), 공고일 `tndrbidRegDt`, 마감 `tndrdocAcptEndDtm`(시각이 있을 때만), 예산 `presmtPrc`(추정가격, 부가세 별도·원 단위 미검증 메모), URL 은 응답에 없어 서비스 설명 페이지(`SERVICE_DOCUMENTATION`) | "명세 필드를 … 옮긴다" |
| 4 | 안정 ID | `lh-bid-notice:<bidNum>`. `bidNum` 이 공백 없는 64자 이하가 아니면 격리. 차수 `bidDegree` 가 없거나 숫자가 아니면 그 행도 격리(차수 없이는 늦게 온 옛 사본을 막지 못한다) | "공고번호·공고명·차수가 없거나 …" |
| 5 | 중복 제거 | 같은 공고번호·같은 내용은 `skippedDuplicate` | "여러 쪽을 cursor 로 …" |
| 6 | 정정·취소 | `bidDegree` 가 차수. 높은 차수는 변경, 늦게 온 낮은 차수는 STALE. `bidKind`·`bidProgrsStatus` 에 "취소"면 CANCELLED, "정정·변경"이면 AMENDED, "유찰·낙찰·개찰·마감·종료·완료"면 CLOSED. 모르는 값은 OPEN + 정규화 메모 | "정정 차수는 …", "14자리 일시와 …" |
| 7 | 출처 값 | `source = lh-bid-notice`, `sourceFamily = LH`, `serviceId = 15159012` | 정규화 시험 |
| 8 | LH 실패가 나라장터에 번지지 않음 | LH 의 인증 실패(20·30·31·32, 결과 코드 없는 401·403)는 `SERVICE_KEY_INVALID` → `withAuthCircuit` 가 LH 만 `AUTH_FAILED` 로 막는다. 이 넓힌 판정은 LH 에만 적용하고 다른 외부 서비스는 예전 그대로(30·31 만 인증 실패, 401·403 은 `HTTP_ERROR`)다. 나라장터는 이 커넥터를 타지 않는다(`createOfficialApiConnector`) | `ingest-only-main.test.ts` "같은 정각의 LH 인증 실패는 LH 만 막고, 나라장터 job·예산은 그대로다", "LH 전용 판정은 다른 외부 서비스로 번지지 않는다" 7개 |
| 9 | 별도 한도 | Redis `quota:15159012:<KST 날짜>`. 22 를 받으면 LH 예산만 소진 | "한도 초과(22)는 LH 예산만 …" |
| 10 | 백필·증분·cursor | cursor `조각:쪽`. 끊긴 run 은 같은 jobKey 로 그 쪽부터. 수동 백필 창은 정기 수집 위치를 옮기지 않는다 | "2쪽에서 끊긴 run …", "수동 백필 창은 …", "행 수가 모자란 쪽은 PARTIAL …" |
| 11 | 장애 격리 | 필수 칸 없는 행·형식 틀린 행은 그 행만 격리(run PARTIAL). 데이터 없음 03·`totalCount` 0 은 빈 COMPLETE | "필수 칸이 빠진 행만 …", "형식이 틀린 행 …", "데이터 없음(03) …" |
| 12 | 관리자 화면 | 바꾸지 않았다. 기존 서비스 표(`ingestion-services.tsx`)가 서비스별 상태·인증(`VERIFIED`·`FAILED`·대기)·마지막 성공을 보여 주고 LH 상태 조합은 `service-collect.test.ts` 가 덮는다. 인증 `VERIFIED` 는 실제 성공 run 뒤에만 나온다 | 기존 시험, [격리 확인 스크린샷](../20261027-source-isolation/summary.md) |

공통 코드 변경:

- `external-payload.ts`: 서비스별 "데이터 없음" 결과 코드(LH `03` 만)를 빈 쪽으로 받는다. 명세에 없는 코드(예: `3`)는 `RESULT_CODE` 로 멈춘다.
- `external-api-connector.ts`·`external-connector.model.ts`: 서비스별 인증 판정 표(`AUTH_FAILURE_POLICY`). LH 만 20·32·HTTP 401·403 을 더하고, 표에 없는 서비스는 기본값(30·31)이다.
- `external-dates.ts`: 날짜 정밀도 함수를 `external-normalize.ts` 에서 떼어 냈다(동작 같음).
- `infra/sources/registry.yaml`: LH `fieldMapping` 을 채웠다. 활성화 관련 값은 그대로다.
- `scripts/recorded/record-lh-bid-notice.mjs`: 승인 뒤 첫 실호출용 녹음 스크립트(한 번 실행 = 1회 호출). 명세에 없는 태그는 값을 가리고, 응답은 받은 바이트를 세며 2 MiB 에서 끊는다. [[../../../plans/2026-10-27-lh-bid-notice-activation|활성화 계획]] §3.

## 3. 시험 결과

| 시험 | 결과 |
|---|---|
| `web/server/ingestion/lh-bid-notice.test.ts` | 22개 통과(정규화 3·수집 12·다른 서비스 회귀 7) |
| 외부 수집 시험 5파일(위 + `external-ingestion`·`external-adapters`·`worker/ingest-only-main`·`worker/external-ingest`) | 99개 통과(main `8cfaac31` 위) |
| `scripts/recorded/record-lh-bid-notice.test.mjs` | 5개 통과. 가짜 fetch 로 정확히 1회 호출, 키의 원문·디코드·인코딩 형태가 녹음에 없음, 명세 밖 태그(`rprsntvNm`)·담당자 태그·본문 전화 가림, 같은 녹음이 있으면 부르기 전에 멈춤, 키 없음·`--dry-run`·리다이렉트·2 MiB 초과(content-length 없음)는 저장하지 않음 |
| 변형 확인 | 처음 4곳(데이터 없음 처리, 인증 코드 목록, 취소 판정, 공고번호 검사)과 리뷰 반영 5곳(HTTP 401·403 판정 범위, 기본 인증 코드, 데이터 없음 `3`, 차수 필수, 녹음 허용 목록)을 하나씩 망가뜨리면 각각 시험이 실패했다. 원래대로 되돌렸다 |
| 독립 리뷰 | 상 0·중 7·하 2. 반영: 401·403·20·32 판정을 LH 로 한정, `3` 제거, 차수 필수, 녹음 2 MiB 를 읽는 중에 끊기, 명세 밖 태그 가림, 다른 서비스 회귀 시험, 날짜만 있는 마감 메모, 3xx 본문 취소. 녹음 저장 경로는 그대로 `fixtures/recorded/15159012/`(나라장터 녹음처럼 사람이 확인한 뒤 커밋한다) |
| 전체 `pnpm verify` | [[../../../PROGRESS|PROGRESS]] 에 적는다 |

## 4. 아직 모르는 것

- 실응답의 날짜 자릿수·금액 단위·상태 값 목록. 첫 녹음의 `fieldShapes`·`enumValues` 로 확인하고 `statusOf` 표를 고친다.
- 우리 계정의 15159012 활용신청 여부와 키(`LH_BID_NOTICE_SERVICE_KEY`)가 회사 Worker env 에 있는지.
- 03 이 실제로 오는지, 빈 창에서 `totalCount` 0 이 오는지.
- 한 날짜에 공고가 몇 건인지(쪽 수·하루 호출 수 추정에 필요).
