---
title: "C1 P0-0 공공 API 4종 실제 호출·첨부 3건 다운로드 (2026-10-19)"
status: done
tags:
  - sol-radar
  - test
  - phase-0
  - evidence
updated: 2026-10-19
---

# C1 P0-0 공공 API 호출·첨부 다운로드 증거

- 실행: 스크래치 폴더의 Node 스크립트 `c1/scripts/{a2,batch1,a7probe,orderplan2,a5,a5b,a7pages,a5c,orderplan3,dl,fixture}.mjs` (Node v24.16.0 내장 `fetch`, 타임아웃 15 s, 패키지 설치 없음) · 커밋 main `67877a1` (C1 지시 기준 `cfc534d`, 그 사이 커밋은 docs·Compose 프로젝트 이름뿐) · 2026-10-19 09:58:08 ~ 10:08:40 KST
- 실행자: C1 서브에이전트. 저장소 코드·설정·다른 문서는 고치지 않았다. git 상태(add·commit·stash·checkout)를 바꾸지 않았다. 만든 파일은 이 문서, `external-deps.md` 갱신, `fixtures/recorded/**` 14건뿐이다.
- 판정: **① 공공 API A1~A9 통과, ② 첨부 B1~B4 통과**(막힌 건 0). ③ GPU·④ 파서는 이번 범위 밖(대기 유지). 설계 가정과 다른 점 8건은 §10.
- 비밀값: 서비스키 4개는 `infra/.env`를 `fs.readFileSync`로 읽어 메모리에만 두었다(셸 `cat`·`source`·`grep`·`curl` 미사용, `set -x` 미사용). 모든 저장 파일·로그에서 키 원문·디코드값·재인코딩값의 앞뒤 24자를 검색해 0건을 확인했다(§8).

## 1. 키 형식 (A1)

| env 이름 | 존재 | 길이 | `%XX` 포함 | 디코드 1회 길이 |
|---|---|---|---|---|
| `G2B_BID_NOTICE_SERVICE_KEY` | 있음 | 94 | 예 | 88 |
| `G2B_PRE_SPEC_SERVICE_KEY` | 있음 | 94 | 예 | 88 |
| `G2B_ORDER_PLAN_SERVICE_KEY` | 있음 | 94 | 예 | 88 |
| `G2B_INDUSTRY_MASTER_SERVICE_KEY` | 있음 | 94 | 예 | 88 |

- 네 값은 서로 같다(한 계정의 일반 인증키). 값에 `%XX` 시퀀스가 있어 data.go.kr **Encoding 키**다(절차 문서 §1은 Decoding 키를 전제).
- 처리: `decodeURIComponent` 1회 → `URLSearchParams`로 1회 인코딩. **첫 호출부터 `resultCode "00"`** 이라 원문 그대로 재시도(resultCode 30 대비)는 발생하지 않았다. 결론: **"디코드 1회"가 통했다.** Encoding 키를 그대로 `URLSearchParams`에 넣으면 `%`가 `%25`로 두 번 인코딩되므로 Connector는 (1) `infra/.env`에 Decoding 키를 넣게 하거나 (2) 값에 `%XX`가 있으면 1회 디코드하는 규칙 중 하나를 택해야 한다(§10 제안 1).
- `pnpm check:env`(10:10 KST): `G2B_*` 4개 이름에 대한 `MISSING_KEY`·`PLACEHOLDER`·`FORBIDDEN_KEY` 0건(현재 `SOL_RUN_MODE=mock`이라 필수 검사 대상은 아님). 같은 출력에 다른 키의 placeholder 5건·형식 오류 1건·`web/.env.local` 누락 3건이 있으나 C1 범위 밖이다.

## 2. 호출 로그 (서비스키 제외, 시각은 KST)

| # | 시각 | 서비스 | 오퍼레이션 | scheme | 파라미터 | HTTP | resultCode | totalCount | items | ms | `x-ratelimit-remaining` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 09:58:08 | 15129394 | `getBidPblancListInfoServc` | http | type=json pageNo=1 numOfRows=10 inqryDiv=1 inqryBgnDt=202610180000 inqryEndDt=202610192359 | 200 | 00 | 84 | 10 | 600 | 999 |
| 2 | 09:58:08 | 15129394 | `getBidPblancListInfoServc` | https | 같음 | 200 | 00 | 84 | 10 | 662 | 998 |
| 3 | 09:59:59 | 15129394 | `getBidPblancListInfoServc` | https | 1번 + infoBizYn=Y | 200 | 00 | 87 | 10 | 862 | 997 |
| 4 | 10:00:00 | 15129394 | `getBidPblancListInfoServc` | https | type=json pageNo=1 numOfRows=100 inqryDiv=1 inqryBgnDt=202610120000 inqryEndDt=202610192359 | 200 | 00 | 3555 | 100 | 1378 | 996 |
| 5 | 10:00:01 | 15129394 | `getBidPblancListInfoChgHstryServc` | https | type=json pageNo=1 numOfRows=10 inqryDiv=1 inqryBgnDt=202610180000 inqryEndDt=202610192359 | 200 | 00 | 0 | 0 | 1331 | 999 |
| 6 | 10:00:02 | 15129394 | `getBidPblancListInfoServc` | https | 1번에서 inqryDiv=9 (A8 오류 유도) | 200 | 07 | — | — | 2549 | 995 |
| 7 | 10:00:05 | 15129437 | `getPublicPrcureThngInfoServc` | https | type=json pageNo=1 numOfRows=10 inqryDiv=1 inqryBgnDt=202610180000 inqryEndDt=202610192359 | 200 | 00 | 44 | 10 | 110 | 999 |
| 8 | 10:00:05 | 15129462 | `getOrderPlanSttusListServc` | https | type=json pageNo=1 numOfRows=10 inqryDiv=1 inqryBgnDt=202610180000 inqryEndDt=202610192359 | 200 | 08 | — | — | 62 | 996 |
| 9 | 10:00:05 | 15129467 | `getIndstrytyBaseLawrgltInfoList` | https | type=json pageNo=1 numOfRows=100 | 200 | 00 | 2916 | 100 | 114 | 996 |
| 10 | 10:01:28 | 15129467 | `getIndstrytyBaseLawrgltInfoList` | https | numOfRows=1000 | 200 | 00 | 2916 | 10 | 150 | 995 |
| 11 | 10:02:44 | 15129467 | `getIndstrytyBaseLawrgltInfoList` | https | numOfRows=999 pageNo=1 | 200 | 00 | 2916 | 999 | 529 | 994 |
| 12 | 10:02:44 | 15129462 | `getOrderPlanSttusListServc` | https | inqryDiv=1 inqryBgnDt=202610 inqryEndDt=202612 | 200 | 08 | — | — | 106 | 995 |
| 13 | 10:02:45 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | bidNtceNo=R26BK01756112 bidNtceOrd=000 (type·pageNo·numOfRows=10) | 200 | 08 | — | — | 106 | 999 |
| 14 | 10:02:45 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | 13번 + inqryDiv=3 | 200 | 08 | — | — | 61 | 998 |
| 15 | 10:02:45 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | 14번 + inqryBgnDt=202610110000 inqryEndDt=202610192359 | 200 | 07 | — | — | 53 | 997 |
| 16 | 10:02:45 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | 13번과 같음 | 200 | 08 | — | — | 29 | 999 |
| 17 | 10:02:45 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | 14번과 같음 | 200 | 08 | — | — | 41 | 998 |
| 18 | 10:02:45 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | 15번과 같음 | 200 | 07 | — | — | 26 | 997 |
| 19 | 10:02:45 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | 13번과 같음 | 200 | 08 | — | — | 31 | 999 |
| 20 | 10:02:45 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | 14번과 같음 | 200 | 08 | — | — | 41 | 998 |
| 21 | 10:02:45 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | 15번과 같음 | 200 | 07 | — | — | 31 | 997 |
| 22 | 10:03:40 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | inqryDiv=1 inqryBgnDt=202610120000 inqryEndDt=202610192359 bidNtceNo=R26BK01756112 bidNtceOrd=000 numOfRows=10 | 200 | 00 | 10207 | 10 | 911 | 996 |
| 23 | 10:03:40 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | 22번과 같음 | 200 | 00 | 8968 | 10 | 497 | 996 |
| 24 | 10:03:41 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | 22번과 같음 | 200 | 00 | 618 | 10 | 1878 | 996 |
| 25 | 10:03:43 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | 22번에서 bidNtceNo=R26BK01758084 | 200 | 00 | 10207 | 10 | 979 | 995 |
| 26 | 10:03:44 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | 22번에서 bidNtceNo=R26BK01763500 | 200 | 00 | 10207 | 10 | 688 | 994 |
| 27 | 10:03:45 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | bidNtceNo=R26BK01758084 | 200 | 00 | 8968 | 10 | 422 | 995 |
| 28 | 10:03:45 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | bidNtceNo=R26BK01763500 | 200 | 00 | 8968 | 10 | 385 | 994 |
| 29 | 10:03:45 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | bidNtceNo=R26BK01758084 | 200 | 00 | 618 | 10 | 2291 | 995 |
| 30 | 10:03:48 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | bidNtceNo=R26BK01763500 | 200 | 00 | 618 | 10 | 2404 | 994 |
| 31 | 10:03:50 | 15129467 | `getIndstrytyBaseLawrgltInfoList` | https | numOfRows=999 pageNo=2 | 200 | 00 | 2916 | 999 | 806 | 992 |
| 32 | 10:03:51 | 15129467 | `getIndstrytyBaseLawrgltInfoList` | https | numOfRows=999 pageNo=3 | 200 | 00 | 2916 | 918 | 717 | 991 |
| 33 | 10:05:12 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | inqryDiv=2 inqryBgnDt=202610120000 inqryEndDt=202610192359 bidNtceNo=R26BK01756112 bidNtceOrd=000 numOfRows=10 | 200 | 00 | 4 | 4 | 126 | 993 |
| 34 | 10:05:12 | 15129394 | `getBidPblancListInfoLicenseLimit` | https | inqryDiv=1 inqryBgnDt=202610120900 inqryEndDt=202610121011 numOfRows=999 | 200 | 00 | 219 | 219 | 3752 | 992 |
| 35 | 10:05:16 | 15129394 | `getBidPblancListInfoPrtcptPsblRgn` | https | 34번과 같음 | 200 | 00 | 323 | 323 | 119 | 993 |
| 36 | 10:05:16 | 15129394 | `getBidPblancListInfoEorderAtchFileInfo` | https | 34번과 같음 | 200 | 00 | 19 | 19 | 2193 | 993 |
| 37 | 10:08:40 | 15129462 | `getOrderPlanSttusListServc` | https | type=json pageNo=1 numOfRows=10 inqryDiv=1 orderBgnYm=202610 orderEndYm=202612 | 200 | 00 | 82 | 10 | 200 | 993 |

- 모든 호출 HTTP 200, 네트워크 오류·타임아웃 0건, `Retry-After` 헤더 0건. 오류는 전부 본문 `resultCode`(07·08)로 왔다.
- 22~30번(`inqryDiv=1` + `bidNtceNo`)은 `bidNtceNo`가 무시되어 공고 3건 모두 같은 totalCount·같은 행이 돌아왔다(§10 제안 3). 33~36번이 그 보완이다.

## 3. 서비스별 호출 수와 한도 관찰

| 서비스 | 호출 수 | 상한 | 마지막 `x-ratelimit-remaining`(오퍼레이션별) |
|---|---|---|---|
| 15129394 입찰공고 | 28 | 30 | 목록 995 · 변경이력 999 · 면허제한 992 · 참가가능지역 993 · e발주 첨부 993 |
| 15129437 사전규격 | 1 | 30 | 999 |
| 15129462 발주계획 | 3 | 30 | 993 |
| 15129467 업종 마스터 | 5 | 30 | 991 |

- 응답 헤더 `x-ratelimit-limit: 1000`, `x-ratelimit-remaining`, `x-ratelimit-requested: 1`. `remaining`은 **오퍼레이션마다 따로** 줄어드는 것으로 보인다(목록이 995일 때 변경이력 첫 호출이 999). 오류 응답(07·08)도 1씩 소모한다.
- 15129462·15129467은 첫 호출 전에 이미 996이었고, 15129462는 995→993, 15129467은 994→992로 1씩 건너뛴 구간이 있다. 이 세션 밖의 호출(사용자의 data.go.kr 미리보기 등)이 있었거나 집계 단위가 다를 수 있다 — 미확인.
- 남은 일일 한도 추정(오퍼레이션별 1,000 기준): 위 표의 `remaining` 값. 서비스 단위로 합산된다고 보수적으로 가정해도 15129394 ≥ 972, 15129437 ≥ 999, 15129462 ≥ 993, 15129467 ≥ 991.
- 호출 간격: 가장 촘촘한 구간(13~21번)이 약 30~100 ms 간격 9회였고 초당 제한 오류(23)는 없었다.

## 4. 응답 구조와 오류 형식

- 정상: `{"response":{"header":{"resultCode":"00","resultMsg":"정상"},"body":{"items":[...],"numOfRows":10,"pageNo":1,"totalCount":84}}}`. `items`는 **배열**이다(`items.item` 형태 아님). 0건이면 `items: []`, `totalCount: 0`. `numOfRows`·`pageNo`·`totalCount`는 숫자, 항목 값은 전부 문자열(금액·날짜 포함).
- 오류(조달청 쪽, HTTP 200): `{"nkoneps.com.response.ResponseError":{"header":{"resultCode":"07","resultMsg":"입력범위값 초과 에러"}}}`. 관찰한 코드: `07` 입력범위값 초과(`inqryDiv=9`·`inqryDiv=3`), `08` 필수값 입력 에러(`inqryDiv` 누락, 발주계획의 `orderBgnYm/EndYm` 누락). data.go.kr 게이트웨이 공통 형식(`response.header` 또는 XML `OpenAPI_ServiceResponse`)과 다르고, 절차 문서 §4.2 표의 `10`·`11`·`12`와도 다르다. 키 오류(30 등)는 발생하지 않아 그 형식은 관찰하지 못했다.
- `numOfRows`: 999까지 그대로 적용, 1000은 오류 없이 10건(기본값)으로 축소됐다(10·11번).
- 조회 기간: 8일(10-11 00:00 ~ 10-19 23:59)까지 오류 없음. 상한은 더 넓혀 보지 않았다.
- 날짜 값 형식: `YYYY-MM-DD HH:mm:ss`(`rgstDt`·`bidNtceDt`·`bidClseDt`·`opengDt`·`chgDt`). 요청 파라미터는 `YYYYMMDDHHMM`.
- data.go.kr 서비스 페이지의 Swagger(페이지 인라인 JSON, 2026-10-19 확인)에서 읽은 요청 파라미터(`*` 필수 표시): 목록 `getBidPblancListInfoServc` = `serviceKey* pageNo* numOfRows* type inqryDiv* inqryBgnDt inqryEndDt bidNtceNo`. 보조 3종 = 위 + `bidNtceOrd*`(e발주 첨부에는 없음). `infoBizYn`은 어느 오퍼레이션에도 없다. 발주계획 `getOrderPlanSttusListServc` = `serviceKey* pageNo* numOfRows* inqryDiv* orderBgnYm orderEndYm inqryBgnDt inqryEndDt orderPlanUntyNo orderInsttCd orderInsttNm type`. Swagger의 필수 표시와 실제 검사는 다르다(`bidNtceOrd` 없이도 성공, `inqryDiv`만 있어도 `08`).

## 5. 선별한 공고 3건 (A4·A5·B)

7일 100건(4번 호출)에서 `infoBizYn='Y'`인 6건 중 첨부 URL이 있고 e발주 제안요청서가 있는 3건.

| 공고 | 차수 | `infoBizYn` | 수요기관 | 제목(앞부분) | 추정가격 | 마감 | 목록 첨부 | e발주 제안요청서 |
|---|---|---|---|---|---|---|---|---|
| R26BK01756112 | 000 | Y | 해양경찰청 해양경찰교육원 | 2027년 시뮬레이션시스템 유지관리 용역 | 157,308,182 | 2026-10-28 10:00 | hwpx·pdf | hwpx(atchSno 26) + 산출내역서 hwpx |
| R26BK01758084 | 000 | Y | 질병관리청 | [정보,003] 2027년 결핵통합관리시스템 유지관리사업 | 490,909,091 | 2026-11-24 10:00 | pdf | hwpx(atchSno 5) |
| R26BK01763500 | 000 | Y | 질병관리청 | [정보,009] 2027년도 손상예방정책과 소관 시스템 유지관리 | 102,727,273 | 2026-10-27 10:00 | hwpx·pdf | hwpx(atchSno 7) |

- 세 건 모두 `sucsfbidMthdNm`="협상에의한계약-협상에 의한 낙찰자 결정(SW사업)", `pubPrcrmntClsfcNm`="정보시스템유지관리서비스", `indstrytyLmtYn=Y`, `bidPrtcptLmtYn=N`, `orderPlanUntyNo`·`bfSpecRgstNo` 채워짐.
- 면허제한(33번, `inqryDiv=2`) R26BK01756112: 4행 — `lmtGrpNo 1`: {정보통신공사업/0036 (lmtSno 1), 소프트웨어사업자(컴퓨터관련서비스사업)/1468 (lmtSno 2)}, `lmtGrpNo 2`: {정보통신공사업/0036 (lmtSno 3), 소프트웨어사업자(패키지소프트웨어개발.공급사업)/1426 (lmtSno 4)}. `permsnIndstrytyList`·`indstrytyMfrcFldList`는 빈값. R26BK01758084·R26BK01763500(34번 창 조회에서 추출): 각 1행, 소프트웨어사업자(컴퓨터관련서비스사업)/1468.
- 면허제한 여러 행의 의미(미결정 19번): AND/OR를 적는 필드는 없고 `lmtGrpNo`(그룹)·`lmtSno`(일련번호)만 있다. 위 4행은 "그룹 안은 AND, 그룹끼리는 OR"로 읽히지만 **미검증 가정**이다. 창 조회 219행(공고 113건)에서 2행 이상인 공고 39건, `lmtGrpNo`가 2개 이상인 공고 31건. 규칙 엔진의 `AMBIGUOUS_MATCH` 처리는 그대로 둔다.
- 참가가능지역: 세 건 모두 행 없음(`bidPrtcptLmtYn=N`과 일치). 창 조회 323행의 필드는 `bidNtceNo bidNtceOrd bsnsDivNm lmtSno prtcptPsblRgnNm rgstDt`.
- e발주 첨부(36번): 19행, `eorderDocDivNm` 분포 제안요청서 14·기타문서 5, 확장자 hwpx 7·hwp 7·pdf 3·이름 없음 2. URL 호스트는 전부 `www.g2b.go.kr`, 경로 `/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do`, 쿼리 `rfpNo·rfpOrd·rfpUntyAtchFileNo`. 이 오퍼레이션 행에는 `rgstDt`가 없다.

## 6. 마스킹 필드 확정

첫 응답(1·2번)의 항목 113개 필드 중 이름에 `Ofcl`·`Nm`·`TelNo`·`Email`·`Adrs`가 든 38개를 전부 나열해 판정했다.

| 판정 | 필드 | 근거 |
|---|---|---|
| **마스킹(이름 → `***`)** | `ntceInsttOfclNm`, `exctvNm`(집행관명), `crdtrNm`(채권자명) | 10건 모두 2~4자 한글 이름 형태. `crdtrNm`은 대부분 기관장 직함("OO시장"·"조달청장")이지만 개인 이름 형태 값이 섞여 있어 통째로 가린다 |
| **마스킹(연락처 → 같은 길이 `*`)** | `ntceInsttOfclTelNo`, `ntceInsttOfclEmailAdrs`, `dminsttOfclEmailAdrs` | 전화 12자 형식. 이메일 두 필드는 표본 110건에서 전부 빈값이지만 이름상 마스킹 대상 |
| 남김(기관·분류·방식·파일 이름) | `bidNtceNm`, `dminsttNm`, `ntceInsttNm`, `ntceKindNm`, `bidMethdNm`, `cntrctCnclsMthdNm`, `sucsfbidMthdNm`, `srvceDivNm`, `pubPrcrmntClsfcNm`, `pubPrcrmntLrgClsfcNm`, `pubPrcrmntMidClsfcNm`, `rgstTyNm`, `prearngPrceDcsnMthdNm`, `rsrvtnPrceReMkngMthdNm`, `cmmnSpldmdMethdNm`, `arsltApplDocRcptMthdNm`, `pqApplDocRcptMthdNm`, `tpEvalApplMthdNm`, `jntcontrctDutyRgnNm1~3`, `rgnLmtBidLocplcJdgmBssNm`, `ntceSpecFileNm1~10` | 기관명·코드명·방식명·첨부 파일명. 개인정보 아님 |
| 사전규격(15129437) 마스킹 | `ofclNm`(이름), `ofclTelNo`(전화) | 남김: `orderInsttNm`, `rlDminsttNm`, `bsnsDivNm`, `prdctClsfcNoNm` |
| 발주계획(15129462) 마스킹 | `ofclNm`(이름), `telNo`(전화) | 남김: `orderInsttNm`, `totlmngInsttNm`, `jrsdctnDivNm`, `deptNm`(부서명), `bizNm`, `cnsttyDivNm`, `cntrctMthdNm`, `specItemNm1~5`, `dtilPrdctClsfcNoNm`, `dsgnDocRdngPlceNm` |
| 업종 마스터(15129467) | 없음 | 2,916행 전부 코드·법령명. 전화·이메일 패턴 0건 |
| 보조 조회 3종 | 없음 | 면허제한·참가가능지역·e발주 첨부 행에 담당자 필드 없음 |

마스킹 외에 모든 문자열 값에 이메일·전화 정규식을 다시 돌려 남은 패턴을 같은 길이로 가리고 `maskedFields`에 `(pattern)` 표시로 기록하게 했다(이번 실행에서는 추가 적중 0건).

## 7. 저장한 fixture (A9) — `fixtures/recorded/<serviceId>/`

`schemaVersion: sol-recorded/v0.1`, `params`에 `serviceKey` 없음, `masked: true`, `rawSha256`은 스크래치 원본(마스킹 전)의 해시. 아래 해시는 앞 12자이고 전체는 파일 안에 있다.

| 파일 | resultCode | totalCount | items | maskedFields(값이 있어 가린 것) | rawSha256 |
|---|---|---|---|---|---|
| `15129394/getBidPblancListInfoServc.20261019.masked.json` | 00 | 84 | 10 | crdtrNm·exctvNm·ntceInsttOfclNm·ntceInsttOfclTelNo | `79a19388e4bd` |
| `15129394/getBidPblancListInfoServc.20261019.7d-p1.masked.json` | 00 | 3555 | 100 | 같음 | `43723e148ada` |
| `15129394/getBidPblancListInfoServc.20261019.error07.masked.json` | 07 | — | 0 | — (오류 표본) | `8715db67fd32` |
| `15129394/getBidPblancListInfoChgHstryServc.20261019.masked.json` | 00 | 0 | 0 | — | `8247b4cb9cf1` |
| `15129394/getBidPblancListInfoLicenseLimit.20261019.masked.json` | 00 | 4 | 4 | — (`inqryDiv=2` 공고 1건) | `0bd125814f70` |
| `15129394/getBidPblancListInfoLicenseLimit.20261019.window.masked.json` | 00 | 219 | 219 | — | `e904dc913053` |
| `15129394/getBidPblancListInfoPrtcptPsblRgn.20261019.masked.json` | 00 | 323 | 323 | — | `a6841a590157` |
| `15129394/getBidPblancListInfoEorderAtchFileInfo.20261019.masked.json` | 00 | 19 | 19 | — | `ae70d65dcacf` |
| `15129437/getPublicPrcureThngInfoServc.20261019.masked.json` | 00 | 44 | 10 | ofclNm·ofclTelNo | `d5bc546f5d7b` |
| `15129462/getOrderPlanSttusListServc.20261019.masked.json` | 00 | 82 | 10 | ofclNm·telNo | `8dc2c5da6ffd` |
| `15129462/getOrderPlanSttusListServc.20261019.error08.masked.json` | 08 | — | 0 | — (오류 표본) | `1bfde9ddd47d` |
| `15129467/getIndstrytyBaseLawrgltInfoList.20261019.p1.masked.json` | 00 | 2916 | 999 | — | `833fe9ba7dc3` |
| `15129467/getIndstrytyBaseLawrgltInfoList.20261019.p2.masked.json` | 00 | 2916 | 999 | — | `02c63be7928f` |
| `15129467/getIndstrytyBaseLawrgltInfoList.20261019.p3.masked.json` | 00 | 2916 | 918 | — | `4a6ffd85b19e` |

- 합계 14파일 약 2.1 MB(업종 마스터 3파일이 약 1.5 MB). 루트 Prettier 설정으로 서식을 맞췄다(`pnpm exec prettier --write "fixtures/recorded/**/*.json"`).
- `maskedFields`가 비어 있을 수 있는 응답(담당자 필드 없음·0건)에는 그 서비스의 마스킹 대상 목록을 그대로 적고 `maskedFieldsNote`로 구분했다. 15129467은 빈 배열이다 — C3 검증기가 "비어 있지 않음"을 요구하면 이 서비스는 예외로 둔다.
- `infra/sources/registry.yaml`은 아직 없다(C3). `sampleResponses`에 적을 경로는 위 표 그대로이고, `lastVerifiedAt`은 `2026-10-19`, `approvalStatus`는 네 서비스 모두 `APPROVED`로 바꿀 수 있다.

## 8. 개인정보·키 0건 확인

저장소 루트에서 실행(10:12 KST):

```text
grep -rc 'serviceKey' fixtures/recorded | awk -F: '{s+=$2} END{print s}'                                → 0
grep -rcE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' fixtures/recorded | awk -F: '{s+=$2} END{print s}' → 0
grep -rcE '[0-9]{2,4}-[0-9]{3,4}-[0-9]{4}' fixtures/recorded | awk -F: '{s+=$2} END{print s}'            → 0
node 검사(14파일): params 에 serviceKey 0건, rawSha256 64자·masked:true 14/14, 마스킹 대상 8개 필드 중 값이 남은 것 0건
node 검사: 키 원문·디코드값·재인코딩값의 앞 24자·뒤 24자·전체를 fixtures/recorded + 스크래치(raw·scripts·calllog·dl-log)에서 검색 → 0건
```

## 9. 첨부 3건 (B1~B4)

allowlist `www.g2b.go.kr`(https)만 허용, DNS 재확인(사설 IP 거부), 타임아웃 30 s, 50 MB 상한, 리다이렉트는 같은 호스트에서 최대 2회(`login`·`sso` 경로면 `AUTH_REQUIRED`). 세션·쿠키·로그인 없이 호출했다. 파일은 스크래치 `c1/att/`에만 두었고 저장소에 넣지 않았다.

| 공고 | 출처 필드 | 호스트 | 경로 | 쿼리 키 | HTTP | Content-Type | Content-Disposition(디코드) | 크기 | 리다이렉트 | 매직 바이트 | 판정 | 사유 코드 | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R26BK01756112 | `ntceSpecDocUrl1` | `www.g2b.go.kr` | `/pn/pnp/pnpe/UntyAtchFile/downloadFile.do` | `bidPbancNo bidPbancOrd fileType fileSeq prcmBsneSeCd` | 200 | `application/octet-stream` | `attachment;filename=공고서_국가_서면_하도급계획적정성.hwpx` | 139,977 B | 없음 | `504B0304` | HWPX (`mimetype`=`application/hwp+zip`, `Contents/content.hpf` 있음) | OK | 226 |
| R26BK01758084 | `ntceSpecDocUrl1` | `www.g2b.go.kr` | 같음 | 같음 | 200 | `application/pdf` | `attachment;filename=(공고서) 2027년 결핵통합관리시스템 유지관리사업.pdf` | 395,593 B | 없음 | `255044462D312E36` (`%PDF-1.6`) | PDF | OK | 791 |
| R26BK01763500 | e발주 제안요청서 `eorderAtchFileUrl`(atchSno 7) | `www.g2b.go.kr` | `/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do` | `rfpNo rfpOrd rfpUntyAtchFileNo` | 200 | `application/octet-stream` | `attachment;filename=4. 제안요청서_최종(수정).hwpx` | 649,371 B | 없음 | `504B0304` | HWPX (같은 표식) | OK | 343 |

- B1: 7일 100건 전체에서 `ntceSpecDocUrl1~10`·`bidNtceDtlUrl`·`bidNtceUrl`·`stdNtceDocUrl`·e발주 `eorderAtchFileUrl`·사전규격 `specDocFileUrl1~5`의 호스트는 **모두 `www.g2b.go.kr`** 이었다(다른 호스트 0건). 쿼리에 토큰·세션 값은 없다(공고번호·차수·파일 순번·구분 코드뿐).
- B2: 3건 모두 HTTP 200, 리다이렉트 0회, HTML·로그인 페이지 0건. **로그인·세션 없이 다운로드된다**(미결정 16번 → 공고 첨부·e발주 제안요청서 둘 다 익명 GET 가능, 2026-10-19 관찰).
- B3: 확장자와 내용이 일치했다. `Content-Type`은 hwpx에 `application/octet-stream`이라 형식 판정은 매직 바이트 + zip 안의 `mimetype`/`Contents/content.hpf`로 해야 한다. HWP 5.0(OLE `D0CF11E0`) 표본은 이번 3건에 없다(e발주 창 조회에 `.hwp` 7건이 있으나 다운로드하지 않았다).
- B4: 막힌 건 0. `AUTH_REQUIRED`·`HTTP_4XX`·`REDIRECT_BLOCKED`·`TOO_LARGE`·`TIMEOUT` 발생 없음.

## 10. 설계 문서·절차 문서 가정과 실제가 다른 점 (갱신 제안, 직접 고치지 않음)

1. **키 형식** — [[16-DECISIONS|ADR-022]]·[[07-DATA-PIPELINE|07]] §2.2·절차 §1: "Decoding 키". 실제 `infra/.env` 값은 Encoding 키(`%XX`)이고 디코드 1회 뒤 1회 인코딩이 통했다. 제안: Connector에 "`%XX`가 있으면 `decodeURIComponent` 1회" 규칙을 두거나, 사용자가 Decoding 키로 바꿔 넣고 `check:env`가 `%` 포함 여부를 경고한다.
2. **응답 최상위 구조** — 절차 §2·§6: `items` 또는 `items.item`. 실제는 항상 배열 `response.body.items`. 오류는 `response`가 아니라 `nkoneps.com.response.ResponseError.header.resultCode`(07·08)로 온다. 절차 §4.2 오류 표(10·11·12 등)는 data.go.kr 게이트웨이 코드이고 조달청 서비스 자체 오류는 별도 코드다. Connector는 두 봉투를 모두 읽어야 한다.
3. **보조 조회 3종의 호출 방식** — 07 §2.2·15 §8·절차 §2: "`bidNtceNo`+`bidNtceOrd`로 공고마다 1회". 실제: `inqryDiv`가 필수이고, `inqryDiv=1`(기간)에서는 `bidNtceNo`가 무시되어 기간 내 전체(업무구분 물품·공사·용역 전부)가 돌아온다. 공고 1건 조회는 **`inqryDiv=2` + `bidNtceNo`**(+기간)로 된다(33번, 4행 모두 해당 공고). `inqryDiv=3`은 범위 초과. 선택지: (a) 공고마다 `inqryDiv=2` 1회(설계와 호출 수 같음), (b) 목록 수집 창과 같은 기간으로 `inqryDiv=1` 1~2회 받아 `bidNtceNo+bidNtceOrd`로 클라이언트 조인(호출 수 급감, 7일 면허제한 10,207행이라 999행 페이지로 11회). 추천 (b)를 일정 실행에, (a)를 수동 단건 재수집에.
4. **`infoBizYn` 요청 필터**(미결정 1번) — 요청 파라미터로 줘도 오류 없이 무시된다(3번 호출: 항목 값 여전히 빈값). 응답 값은 `""`(93%)·`Y`·`N`이라 "`Y`만 수집"하면 대부분을 놓친다. 제안: 1차 필터를 `sucsfbidMthdNm`에 "SW사업" 포함 또는 `pubPrcrmntClsfcNm`이 정보시스템·소프트웨어 분류이거나 `infoBizYn='Y'`인 공고로 넓히고, `getBidPblancListInfoServcPPSSrch`의 `indstrytyCd`(업종코드 1468 등) 필터를 P0-2에서 1회 검증한다(이번에 호출하지 않음).
5. **구조화 자격 필드 위치** — 07 §3.1: `lcnsLmtNm`·`permsnIndstrytyList`·`prtcptPsblRgnNm`을 목록 응답에서 기대. 실제 목록에는 없고 보조 조회에만 있다(`indstrytyLmtYn`·`bidPrtcptLmtYn`·`rgnDutyJntcontrctRt`는 목록에 있음). 면허제한 행에 `lmtGrpNo`·`lmtSno`·`indstrytyMfrcFldList`·`bsnsDivNm`이 추가로 있다.
6. **발주계획 파라미터** — 절차 §2 "조회 연도·기간(명세 확인 필요)". 실제: `inqryDiv=1` + `orderBgnYm`·`orderEndYm`(`YYYYMM`). `inqryDiv=1` + `inqryBgnDt/EndDt`만 주면 `08`. 응답 필드에 `orderPlanUntyNo`·`bidNtceNoList`·`orderPlanDtlUrl`(`https://www.g2b.go.kr/link/PRPA015_01/single/?oderPlanNo=…`)·`ofclNm`·`telNo`·`deptNm`이 있다. 사전규격 응답 필드는 `bfSpecRgstNo`·`bidNtceNoList`·`swBizObjYn`·`specDocFileUrl1~5`(`/pn/pnz/pnza/UntyAtchFile/downloadFile.do?bfSpecRegNo=…&fileType=BFD`)·`ofclNm`·`ofclTelNo`.
7. **마스킹 대상** — 절차 §3: `ntceInsttOfclNm`·`TelNo`·`EmailAdrs` 3개. 실제 5개(+`exctvNm`·`crdtrNm`·`dminsttOfclEmailAdrs`) + 사전규격 `ofclNm`·`ofclTelNo` + 발주계획 `ofclNm`·`telNo`. [[09-SECURITY|09]]·[[15-DATA-CONTRACTS|15]] §3의 "담당자 필드" 목록에 반영.
8. **업종 마스터** — 07 §3.1 "소프트웨어사업자 코드 미확인". 실제: `1468` 소프트웨어사업자(컴퓨터관련서비스사업), `1426` (패키지소프트웨어개발.공급사업), `1469` (디지털콘텐츠개발서비스사업), `1470` (데이터베이스제작및검색서비스사업) — 분류 `61 정보통신`, 근거 소프트웨어진흥법 제58조. `0036` 정보통신공사업(정보통신공사업법 제14조), `1542` 정보보호 전문서비스 기업. 면허제한 `lcnsLmtNm`은 "이름/코드" 문자열이라 `/` 뒤 4자리가 이 마스터의 `indstrytyCd`다. 전체 2,916행, 코드 고유, `indstrytyUseYn` 전부 Y. `numOfRows` 최대 999.

그 밖의 관찰: `bidClseDt`는 100건 중 19건 빈값(마감이 없는 수의·협상 공고 등, 원인 미확인 → `deadlineAt` null 허용 필요). `asignBdgtAmt`·`presmptPrce`는 100건 모두 채워짐. `orderPlanUntyNo` 76건·`bfSpecRgstNo` 64건. 첨부 슬롯은 10번까지 쓰는 공고가 있고 `stdNtceDocUrl`(표준공고문) 81건. 1일 목록 84건은 `srvceDivNm` 전부 "일반용역"(이 오퍼레이션이 용역만 돌려준다).

## 11. 검증하지 못한 것

- 키 오류 응답(resultCode 30·31·22) 형식 — 발생시키지 않았다.
- 조회 기간 상한(8일까지만 확인), `numOfRows` 999와 1000 사이의 정확한 최대값, 초당 제한(23)의 실제 임계.
- `getBidPblancListInfoServcPPSSrch`(`indstrytyCd`·`bidNtceNm` 필터)·사전규격 `getPublicPrcureThngInfoServcPPSSrch`(`swBizObjYn`) — 호출하지 않았다.
- 면허제한 `lmtGrpNo` 그룹의 AND/OR 의미 — 문서 근거 없음, 가정만 기록.
- `bidNtceNoList`로 사전규격·발주계획 → 공고 연결 — 표본 기간이 달라 공고 3건과 맞물리는 행이 없었다(실패 아님, P0-8).
- 첨부: HWP 5.0(OLE) 표본, 50 MB 초과·리다이렉트·인증 요구 경로(발생하지 않아 코드 경로만 있음), 나라장터 이용약관상 자동 다운로드 허용 여부(미결정 16·18번의 법적 부분).
- `x-ratelimit-remaining`의 집계 단위(오퍼레이션별로 보이나 건너뛴 값이 있음).
- 저장한 fixture를 `RecordedApiConnector`로 재생하는 시험 — C3에서 구현한다.

## 관련 문서

- [[external-deps|P0-0 외부 의존성 점검 체크리스트]]
- [[2026-10-19-c1-external-deps-procedure|C1 P0-0 외부 의존성 검증 절차]]
- [[07-DATA-PIPELINE|07 수집]] §1.1·§2.2·§2.4·§3.1
- [[15-DATA-CONTRACTS|15 데이터 계약]] §8
- [[09-SECURITY|09 보안]] — 공공 API 응답의 개인정보
- [[16-DECISIONS|16 ADR]] — ADR-022, 미결정 1·16·18·19
