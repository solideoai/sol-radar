---
title: "P0-0 외부 의존성 점검 체크리스트"
status: draft
tags:
  - sol-radar
  - ops
  - hackathon
updated: 2026-10-19
---

# P0-0 외부 의존성 점검

규칙은 [[11-TESTING|11 테스트]] §3.3, 순서는 [[12-ROADMAP|12 로드맵]] C1. 항목마다 날짜·실행한 명령·결과(통과 / 막힘 / 대기)·막힌 이유·보고 시각을 적는다. 막힌 항목은 즉시 사용자에게 보고하고 "막힘"으로 남긴다. 통과한 것처럼 적지 않는다.

**2026-10-19 10:08 KST 기준 ① 공공 API(A1~A9)와 ② 첨부 다운로드(B1~B4)를 실행해 전부 통과했다. ③ GPU 서버·④ 첨부 파싱은 아직 실행하지 않았다(대기).** 호출 로그·마스킹 필드·첨부 표·설계 문서와 다른 점은 [[external-deps-api-20261019|API 호출 증거(2026-10-19)]]에 있다.

보호 규칙: 서비스키 4개 값, 모델 엔드포인트 인증 키(`QWEN_API_KEY`·`KEV_API_KEY`)와 `Authorization` 헤더 값은 이 파일·로그·증거·요청 URL에 적지 않는다. 실제 응답을 저장할 때는 담당자 이름·전화·이메일을 마스킹하고 `serviceKey`가 든 URL은 남기지 않는다. 실제 RFP 원문은 저장소에 넣지 않는다.

## 선행 조건 (사용자)

| # | 조건 | 상태 |
|---|---|---|
| P1 | `infra/.env`에 `G2B_BID_NOTICE_SERVICE_KEY`·`G2B_PRE_SPEC_SERVICE_KEY`·`G2B_ORDER_PLAN_SERVICE_KEY`·`G2B_INDUSTRY_MASTER_SERVICE_KEY`(포털 Encoding 키 그대로. worker 가 한 번 디코딩한다) 입력 | 통과 (2026-10-19. `infra/.env`에 네 이름 존재, 각 94자, 네 값 동일. `%XX`가 든 Encoding 키를 1회 디코드 뒤 1회 인코딩해 첫 호출부터 `resultCode "00"` — A1) |
| P2 | 회사가 엔드포인트 경로(라우터 기준 `/sol-radar/qwen`·`/sol-radar/kev`, `infra/gpu/README.md`)와 인증 방식(Bearer 키 외 회사 프록시 추가 인증 여부)을 알려 줌. 2026-10-19 기준 엔드포인트 제공 전([[16-DECISIONS\|ADR-025]]) | 대기 |
| P3 | 회사 측 모델 기동(vLLM `Qwen/Qwen3.5-9B`·`kev.serve` Kev-9B@v1.0) 완료 통보. 우리 쪽 "모델 기동·GPU 점유 승인" 항목은 ADR-025로 폐기 | 대기 |

## ① data.go.kr 공식 API (읽기 전용 GET, 키만 있으면 안전)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| A1 | 서비스키 환경변수 4개 존재(값은 출력하지 않음) | `pnpm check:env`(이름·placeholder 여부만 출력) | 통과 | 네 이름 존재, 각 94자, 네 값 동일(한 계정). `%XX` 포함 → Encoding 키. **디코드 1회 + `URLSearchParams` 1회 인코딩**이 첫 호출부터 통해 원문 재시도 없음. `pnpm check:env`에서 `G2B_*` 관련 FAIL 0건(mock 모드) | 2026-10-19 |
| A2 | 입찰공고정보서비스 15129394 `getBidPblancListInfoServc` 호출 성공(`resultCode`, HTTP 상태) | `inqryDiv=1`, 최근 1일, `numOfRows=10`, `type=json`. 응답 3건 저장(마스킹) | 통과 | http·https 둘 다 HTTP 200, `resultCode "00"`·`resultMsg "정상"`, `totalCount 84`, 10건(응답 본문 동일, 600/662 ms). 이후 https 사용. 최상위 구조 `response.header{resultCode,resultMsg}` / `response.body{items[배열],numOfRows,pageNo,totalCount}` | 2026-10-19 |
| A3 | 응답 스키마가 [[07-DATA-PIPELINE\|07]] §3.1 매핑표와 일치하는지(`bidNtceNo`·`bidNtceOrd`·`bidNtceNm`·`dminsttNm`·`asignBdgtAmt`·`presmptPrce`·`bidClseDt`·`bidNtceDtlUrl`·`infoBizYn`·`ntceSpecDocUrl1~10`) | 필드 이름 대조표. 다르면 07·15 갱신 항목으로 보고 | 통과(차이 있음) | 매핑표의 목록 필드는 전부 있음(113개 필드). 구조화 자격 `lcnsLmtNm`·`permsnIndstrytyList`·`prtcptPsblRgnNm`은 목록에 없고 보조 조회에만 있음. 담당자 필드 5개 확정. 아래 대조표 | 2026-10-19 |
| A4 | 정보화사업(`infoBizYn=Y`) 공고 1건 조회 가능 여부, 요청 파라미터 필터 가능 여부(미결정 1번) | A2 응답에서 선별 | 통과(부분) | 요청 파라미터 `infoBizYn=Y`는 오류 없이 **무시됨**(항목 값 그대로, Swagger에도 없음). 1일 10건은 전부 빈값, 7일 100건(1페이지)에서 `Y` 6·`N` 1·빈값 93 → 클라이언트 필터만 가능하고 빈값이 대부분이라 `Y`만 수집하면 놓침. 선별 3건: R26BK01756112·R26BK01758084·R26BK01763500(전부 "협상에의한계약(SW사업)"·정보시스템유지관리서비스) | 2026-10-19 |
| A5 | 보조 조회 3종(면허제한·참가가능지역·e발주 첨부) `bidNtceNo`+`bidNtceOrd`로 1건씩, 면허제한 여러 행의 의미(미결정 19번) | 각 1회 | 통과(설계 가정과 다름) | `bidNtceNo`+`bidNtceOrd`만 → `08 필수값 입력 에러`(`inqryDiv` 필수). `inqryDiv=1`+기간이면 `bidNtceNo` 무시, 기간 내 전체(7일 면허제한 10,207·지역 8,968·e발주 618행, 업무구분 전체). **`inqryDiv=2`+`bidNtceNo`로 공고 1건 조회됨**(R26BK01756112 면허제한 4행). `inqryDiv=3`은 `07 입력범위값 초과`. 면허제한 여러 행: `lmtGrpNo`·`lmtSno`만 있고 AND/OR 표현 필드 없음 — 그룹1 {정보통신공사업/0036, 소프트웨어사업자(컴퓨터관련서비스사업)/1468}, 그룹2 {정보통신공사업/0036, 소프트웨어사업자(패키지소프트웨어개발.공급사업)/1426}. "그룹 안 AND·그룹 간 OR"로 읽히나 미검증 가정(`AMBIGUOUS_MATCH` 유지). 참가가능지역: 3건 모두 행 없음(`bidPrtcptLmtYn=N`). e발주 첨부: 3건 모두 제안요청서 hwpx 행 있음(`downloadRfpFile.do`) | 2026-10-19 |
| A6 | 사전규격 15129437·발주계획 15129462 각 1페이지, `bidNtceNoList`·`orderPlanUntyNo`·`bfSpecRgstNo` 연결 가능 여부 | 각 1회 | 통과 | 사전규격: `inqryDiv=1`+기간 1회 성공(44건), 필드 `bfSpecRgstNo`·`bidNtceNoList`(10건 모두 빈값)·`swBizObjYn`(모두 N)·`specDocFileUrl1~5`·`ofclNm`·`ofclTelNo`. 발주계획: §2 가정(`inqryDiv`+`inqryBgnDt/EndDt`)은 `08`, data.go.kr Swagger 확인 뒤 **`inqryDiv=1`+`orderBgnYm=202610`+`orderEndYm=202612`** 로 성공(82건, 3회째). 필드 `orderPlanUntyNo`·`bidNtceNoList`·`orderPlanDtlUrl`·`ofclNm`·`telNo`. 공고 3건의 `bfSpecRgstNo`·`orderPlanUntyNo`는 표본 기간에 없어 연결은 미확인(실패 아님, P0-8) | 2026-10-19 |
| A7 | 업종 및 근거법규 15129467 전체 1회 수신(사전 저장용) | 1회 | 통과 | `numOfRows=999` 3페이지로 2,916행 전부 수신(999+999+918, 코드 고유 2,916, `indstrytyUseYn` 전부 Y). `numOfRows=1000`은 오류 없이 10건으로 축소. 담당자 필드·전화·이메일 패턴 0. SW 코드: `1468` 소프트웨어사업자(컴퓨터관련서비스사업), `1426` (패키지소프트웨어개발.공급사업), `1469` (디지털콘텐츠개발서비스사업), `1470` (데이터베이스제작및검색서비스사업), `0036` 정보통신공사업, `1542` 정보보호 전문서비스 기업 | 2026-10-19 |
| A8 | 오류 응답·호출 제한: 잘못된 파라미터 응답 형식, `Retry-After`, 에러코드 22 형식(의도적으로 한도를 소진하지 않는다), 개발계정 1,000건/일 카운트 | 응답 헤더·본문 기록 | 통과 | `inqryDiv=9` → HTTP 200 + `{"nkoneps.com.response.ResponseError":{"header":{"resultCode":"07","resultMsg":"입력범위값 초과 에러"}}}`(data.go.kr 공통 `response.header` 아님). 필수값 누락은 `08 필수값 입력 에러`. `Retry-After` 없음. 헤더 `x-ratelimit-limit: 1000`·`x-ratelimit-remaining`·`x-ratelimit-requested: 1`, 오퍼레이션별로 감소하는 것으로 관찰(오류 응답도 소모). 코드 22·30은 발생시키지 않음. 총 호출: 15129394 28, 15129437 1, 15129462 3, 15129467 5 | 2026-10-19 |
| A9 | 저장한 응답을 `RecordedApiConnector` fixture로 쓸 수 있는지(`fixtures/recorded/<serviceId>/<op>.masked.json`), 출처·수집 시각(`fetchedAt`)·`rawPayload` 해시 추적 | 파일 생성 + 검증기 | 통과 | `fixtures/recorded/` 14파일(§3 형식, `params`에 키 없음, `fetchedAt`·`rawSha256`). 15129394: 목록 1일(`00`/84/10, `79a19388e4bd…`)·7일 1페이지(`00`/3555/100, `43723e148ada…`)·오류 표본 07·변경이력(0건)·면허제한 단건(`00`/4/4)·면허제한 창(219)·참가가능지역 창(323)·e발주 창(19). 15129437 사전규격(`00`/44/10, `d5bc546f5d7b…`). 15129462 발주계획(`00`/82/10, `8dc2c5da6ffd…`)·오류 표본 08. 15129467 p1~p3(999/999/918). 마스킹 필드: 15129394 `ntceInsttOfclNm`·`exctvNm`·`crdtrNm`·`ntceInsttOfclTelNo`·`ntceInsttOfclEmailAdrs`·`dminsttOfclEmailAdrs`, 15129437 `ofclNm`·`ofclTelNo`, 15129462 `ofclNm`·`telNo`, 15129467 없음. 저장 뒤 `serviceKey`·이메일·전화 패턴 grep 각 0건. `infra/sources/registry.yaml`은 아직 없어 경로만 기록(C3에서 `sampleResponses`·`lastVerifiedAt=2026-10-19`·`APPROVED`) | 2026-10-19 |

### A3 대조표 (2026-10-19, 목록 응답 1일 10건 + 7일 100건 기준)

| `NormalizedBid` 필드 | 기대 원본 필드 | 존재 | 비고 |
|---|---|---|---|
| `noticeId`·`amendmentNo` | `bidNtceNo`·`bidNtceOrd` | ✓ | 예 `R26BK01756112`/`000`, 취소공고는 차수 `001` |
| `title` | `bidNtceNm` | ✓ | |
| `agency` | `dminsttNm`(수요기관), `ntceInsttNm`(공고기관) | ✓ | 코드 `dminsttCd`·`ntceInsttCd`도 있음 |
| `budgetKrw` | `asignBdgtAmt`, `presmptPrce` | ✓ | 100건 모두 둘 다 채워짐(문자열, 원 단위). 배정예산 ≥ 추정가격 |
| `deadlineAt` | `bidClseDt` | ✓ | `YYYY-MM-DD HH:mm:ss`(KST). 100건 중 19건 빈 문자열 → null 허용 필요 |
| `sourceUrl` | `bidNtceDtlUrl`, `bidNtceUrl` | ✓ | 둘 다 100건 모두, 호스트 `www.g2b.go.kr` |
| 상태·정정 | `ntceKindNm`, `chgNtceRsn`, `reNtceYn`, `befBidBbancNo` | ✓ | `ntceKindNm` 값: 등록공고·변경공고·취소공고·재공고. `chgDt`도 있음 |
| `planRef`·`preSpecRef` | `orderPlanUntyNo`, `bfSpecRgstNo` | ✓ | 100건 중 76건·64건 채워짐 |
| 첨부 | `ntceSpecDocUrl1~10`, `ntceSpecFileNm1~10` | ✓ | 10번 슬롯까지 쓰는 공고 있음. 추가 `stdNtceDocUrl`(표준공고문, 81건) |
| 구조화 자격 | `lcnsLmtNm`, `permsnIndstrytyList` | ✗(목록) | 면허제한 보조 조회에만: `lcnsLmtNm`("이름/코드")·`permsnIndstrytyList`·`lmtGrpNo`·`lmtSno`·`indstrytyMfrcFldList`·`bsnsDivNm` |
| | `prtcptPsblRgnNm` | ✗(목록) | 참가가능지역 보조 조회에만: `prtcptPsblRgnNm`·`lmtSno`·`bsnsDivNm` |
| | `indstrytyLmtYn`, `bidPrtcptLmtYn`, `rgnDutyJntcontrctRt` | ✓ | 목록에 있음. `rgnDutyJntcontrctRt`는 100건 모두 빈값, `jntcontrctDutyRgnNm1~3` 추가 |
| 정보화사업 | `infoBizYn` | ✓ | 값 `""`·`Y`·`N`, 93%가 빈값 |
| 계약 방식 | `cntrctCnclsMthdNm`, `sucsfbidMthdNm` | ✓ | `sucsfbidMthdCd`도 있음. SW사업은 `sucsfbidMthdNm`에 "(SW사업)" 접미 |
| 담당자(마스킹) | `ntceInsttOfclNm`·`ntceInsttOfclTelNo`·`ntceInsttOfclEmailAdrs` | ✓ | 추가 `dminsttOfclEmailAdrs`·`exctvNm`(집행관명)·`crdtrNm`(채권자명, 개인 이름 형태 섞임) |

호출 예산: 이 점검 전체에 서비스당 30회 이하. 리허설 전 `quotaUsedToday`를 기록한다. **2026-10-19 실제: 15129394 28회, 15129437 1회, 15129462 3회, 15129467 5회(합 37회).** 마지막 `x-ratelimit-remaining`(오퍼레이션별): 목록 995·변경이력 999·면허제한 992·참가가능지역 993·e발주 993·사전규격 999·발주계획 993·업종 991.

## ② g2b 첨부 다운로드 (읽기 전용 GET)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| B1 | A2에서 고른 공고 3건의 `ntceSpecDocUrl*` 호스트가 `www.g2b.go.kr`인지 | URL 검사 | 통과 | 3건 모두 `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do`(쿼리 `bidPbancNo·bidPbancOrd·fileType·fileSeq·prcmBsneSeCd`, 토큰 없음). e발주 제안요청서는 같은 호스트 `/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do`(`rfpNo·rfpOrd·rfpUntyAtchFileNo`). 7일 100건 전체에서도 첨부·상세·표준문서 URL 호스트는 `www.g2b.go.kr`뿐 | 2026-10-19 |
| B2 | 다운로드 성공 여부: 로그인·세션 요구, HTTP 상태, 리다이렉트 호스트, `Content-Type`, 크기 | allowlist·30 s·50 MB 규칙으로 1건씩 | 통과 | 세션·쿠키 없이 3건 모두 HTTP 200, 리다이렉트 0회, 로그인 페이지 0건. R26BK01756112 공고서: `application/octet-stream` 139,977 B(226 ms) · R26BK01758084 공고서: `application/pdf` 395,593 B(791 ms) · R26BK01763500 e발주 제안요청서: `application/octet-stream` 649,371 B(343 ms). `Content-Disposition: attachment;filename=<URL 인코딩 파일명>` | 2026-10-19 |
| B3 | 받은 파일의 실제 형식(매직 바이트: PDF·HWP 5.0·HWPX·zip·기타) | 파일 서명 검사 | 통과 | 1건 `504B0304` + `mimetype`=`application/hwp+zip` + `Contents/content.hpf` → HWPX · 1건 `%PDF-1.6` → PDF · 1건 HWPX(같은 표식). 확장자와 내용 일치. hwpx의 `Content-Type`이 `octet-stream`이라 내용 판정 필수. HWP 5.0(OLE) 표본은 이번 3건에 없음 | 2026-10-19 |
| B4 | 막혔을 때: 사유 코드(`AUTH_REQUIRED`·`HTTP_4XX`·`REDIRECT_BLOCKED`·`TOO_LARGE`…)와 보고 시각 | — | 통과(막힌 건 없음) | 사유 코드 발생 0건. 파일은 스크래치에만 두고 저장소에 넣지 않음 | 2026-10-19 |

## ③ 회사 GPU 추론 엔드포인트 (ADR-025, HTTPS `https://acropolissg.com/sol-radar`)

회사 GPU 서버는 외부 접근이 안 돼 SSH·터널 항목(옛 G1~G8)은 폐기했다([[16-DECISIONS|ADR-025]]). 모델 기동·GPU 메모리 배분·`nvidia-smi` 실측은 회사 측 운영이다. 절차는 [C1 절차](../../plans/2026-10-19-c1-external-deps-procedure.md) §7·§8, 라우터 구성과 회사 nginx 요청 사항은 `infra/gpu/README.md`.

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| G1 | 엔드포인트 HTTPS 접속: `GET /sol-radar/healthz` 200, TLS 인증서 유효(`-k` 금지), 인증 없는 `GET /sol-radar/kev/v1/models`는 401 또는 403 | curl. 키·`Authorization` 헤더는 로그에 남기지 않음 | 대기(선행 P2·P3) | — | — |
| G2 | Qwen·Kev `GET /v1/models`(Bearer) 응답을 `endpoint-models.json`에 저장 → Kev `run`·`base`·`lora`·`temperature`와 vLLM 모델 id `Qwen/Qwen3.5-9B`를 `services/ai/models/registry.yaml`(C5에서 생성)과 대조 | 각 1회 | 대기 | — | — |
| G3 | 지연 실측: Kev `/v1/systemone` 영어 state 약 500토큰 10회 p50·p95, vLLM 추출 1회 왕복 → `KEV_TIMEOUT_MS`·Qwen 타임아웃 권고값 | 절차 §7 | 대기 | — | — |
| G4 | vLLM guided JSON 동작 1회 | 절차 §7 | 대기 | — | — |
| G5 | 회사 제공 GPU 정보(모델·VRAM·점유·가중치 sha256)가 있으면 기록, 없으면 "회사 운영, 미제공" | 회사 전달 | 대기 | — | — |
| G6 | 엔드포인트 차단(잘못된 URL 1회) 시 gateway가 `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 기록하고 `PARTIAL`로 끝나는지 | C5 `local` 어댑터 뒤 | 대기(C5) | — | — |

호출 예산: 이 점검 전체 Kev 20회·Qwen 5회 이하. 10-21 컷 규칙의 "GPU 정상"은 G2·G3 통과다.

## ④ 첨부 파싱 (실제 공고 1건 기준)

| # | 확인할 것 | 방법 | 상태 | 결과 | 날짜 |
|---|---|---|---|---|---|
| D1 | 공고 API → 첨부 URL → 다운로드 → `/parse` → `ParseResult` 흐름 1건 | B2 파일 + gateway `/parse`(C5) | 대기 | — | — |
| D2 | 형식별 후보 비교 시작(PDF pdfplumber, HWPX python-hwpx, HWP kordoc/rhwp): 본문·표·금액·자격 조항·요구사항 번호 재현율 | [[03-AI-PIPELINE\|03]] §10.3 기준표. 결과는 `parser-benchmark.md` | 대기 | — | — |
| D3 | 실제로 검증한 형식만 "지원"으로 표시. 미검증 형식은 `PARTIAL`·`UNSUPPORTED` | — | 대기 | — | — |

## 상태표 (한눈에)

| 영역 | 상태 | 막힘 사유 | 보고 |
|---|---|---|---|
| ① 공공 API 4종 | **통과**(A1~A9, 2026-10-19 09:58~10:08 KST) | — | 2026-10-19 (설계와 다른 점 8건: [[external-deps-api-20261019\|API 증거]] §10) |
| ② 첨부 다운로드 | **통과**(B1~B4, 3건 모두 익명 GET 200) | — | 2026-10-19 |
| ③ 회사 GPU 추론 엔드포인트 | 대기(선행 P2·P3, 엔드포인트 제공 전. 옛 터널 항목은 ADR-025로 폐기) | — | — |
| ④ 첨부 파싱 | 대기(②·C5 뒤) | — | — |

10-21 저녁 컷 규칙([[12-ROADMAP|12 로드맵]])은 이 표의 ①·③ 상태로 정한다. 2026-10-19 기준 입력값 ①(A2·A3·B2) = **API 정상**. ③은 아직 대기.

## 관련 문서

- [[external-deps-api-20261019|C1 P0-0 공공 API 호출·첨부 다운로드 증거 (2026-10-19)]]
- [[11-TESTING|11 테스트]] §3.3
- [[12-ROADMAP|12 로드맵]] — C1, 10-21 컷 규칙
- [[16-DECISIONS|16 ADR]] — 미결정 1·3·16·17·19·20, ADR-022·023
- [[07-DATA-PIPELINE|07 수집]] §2.2·§3.1
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 추론 엔드포인트, 모델 라우터
