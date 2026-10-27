---
title: "10-27 LH 입찰공고 실응답 10건 정규화 독립 검증"
doc: "evidence-20261027-lh-bid-notice-normalization-check"
status: done
tags: [sol-radar, evidence, ingestion, lh]
updated: 2026-10-27
---

# 10-27 LH 입찰공고 실응답 10건 정규화 독립 검증

[[evidence/ingestion/20261027-lh-bid-notice/first-call|첫 실호출 증거]]의 다시 녹음(15:47 KST) 파일을, 그 기록을 만든 세션과 다른 세션에서 다시 확인한 기록이다. LH API 는 부르지 않았다. 회사 서버·Redis·Supabase·registry 의 `enabled`·`verification` 은 건드리지 않았다.

## 1. 대상

- 파일 `fixtures/recorded/15159012/getOpenBidInfo.20261026.p1.masked.json`(sha256 `d0db121e…`, `fetchedAt 2026-10-27T06:47:18.641Z`, `rawSha256 81971ca5…`).
- 코드 `feat/lh-bid-notice` `602d7c2d`(EUC-KR 읽기·`YYYY/MM/DD HH:mm` 일시·금액 원 단위 반영본).
- 방법: 제품 `parseExternalPayload`·`normalizeExternalNotice("lh-bid-notice")` 결과를, 제품 코드를 쓰지 않고 XML 원문에서 정규식으로 따로 읽은 값과 칸마다 맞췄다(공고번호·차수·공고명·추정가격·마감·입찰 시작·공고일 원문·지역본부·`providerRecordKey`).

## 2. 결과 — 10건 중 10건 정규화, 어긋난 칸 0

`totalCount 12`, 받은 항목 10, `<item>` 블록 10. 격리 0, 경고 0(`DATE_UNPARSED`·`BUDGET_UNPARSED`·`DATE_ORDER` 없음), 상태·마감 메모 0.

| # | 공고번호 `bidNum` | 차수 `bidDegree` | 공고명 `bidnmKor` | 마감 `tndrdocAcptEndDtm` → `deadlineAt` | 추정가격 `presmtPrc` → `budgetKrw` | 상태 |
|---|---|---|---|---|---|---|
| 1 | 2603833 | 00 | (자활용사촌)양주회천 택지개발사업 조성공사(2단계) 디자인형울타리 제작 및 설치 | 2026/11/02 16:00 → `2026-11-02T07:00Z` | 607,100,000 | 일반공고·입찰진행중 → OPEN |
| 2 | 2603815 | 00 | (재공고)(장애인기업)원주무실 A-1BL 공동주택 전기공사 경관조명설비 제작 및 설치 | 2026/11/03 14:00 → `05:00Z` | 40,056,028 | OPEN |
| 3 | 2603802 | 00 | 용인 국가산단 조성공사 1공구 지정폐기물(원형,부스러기) 위탁처리용역 | 2026/11/03 10:00 → `01:00Z` | 55,380,000 | OPEN |
| 4 | 2603800 | 00 | 경북영천 마을정비형 공공주택사업 석면 해체ㆍ제거공사 | 2026/11/03 10:00 → `01:00Z` | 80,850,000 | OPEN |
| 5 | 2603792 | 00 | 남양주왕숙2 A-2BL 아파트 정보통신공사 2공구 | 2026/11/02 14:00 → `05:00Z` | 5,816,318,000 | OPEN |
| 6 | 2603789 | 00 | 인천계양 A6BL 레미콘 제조 및 납품 | 2026/11/03 10:00 → `01:00Z` | 10,575,494,674 | OPEN |
| 7 | 2603787 | 01 | 고양창릉 S-5BL 아파트 전기공사 2공구-디젤발전기 제작 및 설치 | 2026/11/02 16:00 → `07:00Z` | 297,022,490 | 정정공고 → AMENDED |
| 8 | 2603774 | 00 | 인천송림4 금속제창 제조 및 납품 | 2026/11/03 10:00 → `01:00Z` | 93,034,474 | OPEN |
| 9 | 2603750 | 00 | 천안쌍용(고령자) 1BL 아파트 전기공사 주택용분전반 제작 및 납품 | 2026/11/03 10:00 → `01:00Z` | 37,317,012 | OPEN |
| 10 | 2603734 | 00 | (기술개발제품)대전둔곡 A4BL 아파트 전기공사 1공구 디젤발전기 제작 및 설치 | 2026/11/03 10:00 → `01:00Z` | 451,747,273 | OPEN |

- 공고일 `tndrbidRegDt` 는 10건 모두 `20261026`(날짜만)이고 `noticeDate 2026-10-26T09:00:00.000Z` 다. 날짜만 있는 값은 KST 18:00 으로 두는 공용 규칙(`normalize-date.ts` `ASSUMED_HOUR_KST`)과 같다.
- 금액: 10건 모두 `presmtPrc + addtTax = designPrc`, `fdmtlAmt` 는 `designPrc` 를 천 원 단위로 올린 값. 부가세는 9건이 추정가격 10%(원 미만 버림)이고, 가격점수 제외금액(`prcscoreExclusAmt 402489761`)이 있는 5번만 다르다. 그래서 추정가격을 부가세 별도 예산으로 쓰는 매핑이 맞다.
- 정정공고(7번)는 차수 `01` 이고 `AMENDED` 다. 나라장터 `변경공고 → AMENDED` 와 뜻이 같다.

## 3. 매핑 비교 — 잘못된 매핑 없음

| 원문 칸 | 정규화 | 판단 |
|---|---|---|
| `bidNum` | `noticeId` | 맞음. 7자리 숫자, 공백 없음 |
| `bidDegree` | `amendmentNo` | 맞음. `00`·`01` 숫자 문자열 |
| `bidnmKor`(CDATA, 뒤 공백) | `title` | 맞음. 10/10 읽음 |
| `tndrbidRegDt` | `noticeDate` | 맞음(공용 날짜 규칙) |
| `tndrdocAcptEndDtm` | `deadlineAt`·`biddingEndsAt` | 맞음. 10/10 채워짐 |
| `tndrdocAcptBgninDtm` | `biddingStartsAt` | 맞음 |
| `presmtPrc` | `budgetKrw` | 맞음(부가세 별도, 원) |
| `bidKind`·`bidProgrsStatus` | `status` | 맞음. 본 값은 일반공고·정정공고·입찰진행중뿐 |
| `zoneHqCd` | `agencyCode`(`LH_ZONE_HQ`) | 맞음 |

코드는 바꾸지 않았다. 낡은 설명만 고쳤다: `external-normalize-lh.ts` 주석(상태 값 "미검증" → 본 값 명시), `registry.yaml` LH `fieldMapping` 문구("원 단위 미검증" 등)와 `sampleResponses` 에 녹음 경로.

## 4. 합성·실응답 fixture 구분

- 실응답: `fixtures/recorded/15159012/`(README 에 받은 때·sha256·가림·첫 녹음 제외 이유). 재생 시험 `lh-bid-notice.test.ts` "LH 실응답 녹음 재생" 한 곳에서만 읽는다.
- 합성: `fixtures/synthetic/15159012/*.synthetic.xml` 그대로. README 에 실응답과 다른 지어낸 값(공고번호 10자리, 차수 `0`, 12자리 일시, `<items>`, UTF-8, `공고중`)을 적었다.
- 15:13 첫 녹음(한글 `U+FFFD` 1,016자)은 저장소에 넣지 않았다.
- 재생 시험이 정말 실패하는지: 일시 꼴 해석 제거, 예산을 `designPrc` 로, 정정 낱말 제거 — 세 변형 모두 시험이 실패했고 코드는 원래대로 되돌렸다.

## 5. 개인정보·인증키

| 검사 | 결과 |
|---|---|
| 회사 서버(사용자 실행 ④ 4-1) | `out`·`out-1` 포함 12개 파일 모두 키 형태 6가지 0·값이 붙은 `serviceKey=` 0·이메일 0 |
| 개발 PC 녹음 파일 | 이메일·전화·주민번호·사업자번호·URL·`servicekey` 낱말 0, `U+FFFD` 0. 40자 넘는 긴 문자열 1개는 `rawSha256`, `***` 1개는 `note` 설명문 |
| 녹음 스크립트 흔적 검사(`scanProgramLeaks`) | email·phone·representative·crtfcKey·secret 0 |
| 응답 태그 | 179종, 담당자·연락처 태그 없음(`maskedFields: []`) |

개발 PC 에는 LH 키 값이 없어서 키 값 자체 대조는 회사 서버 검사 결과를 따른다.

## 6. 회귀

- `pnpm -C web exec vitest run server/ingestion worker`: 28파일 351개 통과(나라장터 일정·예산·보조 조회·첨부·revision·LH 격리 포함).
- `pnpm verify:changed` exit 0: 서식, 루트 시험 249개, web 린트·타입·86파일 770개, AI·결정 검사. 첫 실행은 새 재생 시험의 타입 오류(`normalizationNotes` 가 선택 칸) 1건으로 멈췄고, 고친 뒤 다시 돌렸다. 전체 `pnpm verify` 는 돌리지 않았다.

## 7. 남은 것

- 다른 진행 상태 값(취소·마감·유찰)과 2쪽(나머지 2건)·빈 날짜 응답. 실호출이 필요하다.
- registry `approvalStatus`·`keyIssuance`·`verification`·`lastVerifiedAt`·`enabled` 갱신, main 병합·push, 회사 Worker 반영은 [[plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]] §4 순서대로 승인 뒤다.

## 관련 문서

- [[evidence/ingestion/20261027-lh-bid-notice/first-call|첫 실호출 증거]]
- [[plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]]
- [[PROGRESS|진행 상황]]
