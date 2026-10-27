---
title: "외부 공공데이터 수집 파이프라인 — 현황 분석 및 완성 계획"
status: active
tags:
  - sol-radar
  - ingestion
  - implementation-plan
updated: 2026-10-22
---

# 외부 공공데이터 수집 파이프라인 — 현황 분석 및 완성 계획

> 계획 문서만 작성한 상태다. 아래 체크박스는 향후 작업이며 구현·실호출·운영 활성화 완료를 뜻하지 않는다. 기존 확장 계획의 I2/I4를 실제 코드에 맞춰 구체화한 후속 계획이다.

**목표:** 기존 공통 Connector·증거·revision 저장을 재사용하여 신규 6종과 기존 나라장터 미완성 3종을 검증 가능한 수집 경로로 완성한다.

**구조:** 서비스/operation별 요청·응답 계약과 기관별 정규화만 확장한다. `PLAN`, `PRE_SPEC`, `PROCUREMENT_REQUEST`, `NOTICE`를 유지하며 업종정보는 공고가 아닌 참조 데이터로 취급한다. 실응답과 의미가 확인되지 않은 항목은 활성화하거나 추정 매핑하지 않는다.

**기술:** 현재 TypeScript 서버 도메인, BullMQ Worker, Supabase 저장 포트, JSON/XML 공통 파서, Vitest를 유지한다.

**관련 스펙:** [공공 입찰 확장 스펙](../../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md), [기존 구현 계획](2026-10-21-public-procurement-expansion-plan.md), [[07-DATA-PIPELINE]], [[15-DATA-CONTRACTS]], [[17-CLAUDE-IMPLEMENTATION]].

## 1. 분석 기준과 안전 경계

- 로컬 분석 기준: `20cb79fa61df2e1d4ebf430e2bd8e9f65f484ceb`. 문서 작업 브랜치: `docs/external-ingestion-completion-plan`.
- 서버의 키 10종 등록, 나라장터 목록+보조 조회 3종 CALLABLE, 신규 6종 DISABLED, Worker 미시작, Redis 큐 4종/미처리 문서 0건, AI 관련 서비스 정상은 **사용자 제공 상태**다. 이번 작업에서 서버에 접속하거나 재확인하지 않았다.
- 이 문서의 `verifiedOperations`는 현재 코드의 상수 이름이다. [기존 조사 metadata](../evidence/procurement-expansion/20261021-api-metadata.json)는 신규 6종을 문서 확인 또는 사용자 제공 명세 확인으로 기록하며 `liveCallPerformed: false`다. 실인증·실응답 검증 완료와 혼동하지 않는다.
- 키 원문·실제 환경 파일을 읽거나 기록하지 않는다. 인증 query string, 담당자·연락처·개인정보를 로그/문서/fixture에 저장하지 않는다.
- 이번에는 소스 코드, Registry, 운영 환경변수, DB/migration, Redis, Docker, Qwen/Bosun/AI Gateway/Dependency Reporter/Redis API Gateway를 변경하지 않는다. 전체 Worker, 수집 scheduler, 문서 reconciler도 실행하지 않는다.
- 과거 다른 작업의 배포 승인은 이번 신규 실호출·수집 승인이 아니다. 실호출, 로컬 구현, 운영 DB 변경, scheduler 활성화는 각각 별도 승인 단위다.

## 2. API별 현재 구현 완성도

단계 표기: **요청 골격**은 URL 생성 코드가 있다는 뜻이고, **정규화 가능**은 코드가 일부 입력을 받아들인다는 뜻이다. 둘 모두 운영 검증 완료를 뜻하지 않는다. 백분율로 완성도를 추정하지 않는다.

| API / Registry key | Registry 및 차단 사유 | 기본 operation → `verifiedOperations` | 정규화 / DB 연결 / 일정 | 판정 |
| --- | --- | --- | --- | --- |
| K-water 입찰공고 15101635 / `kwater-bid-notice` | `enabled:false`, NOT_VERIFIED, NOT_REQUESTED, 매핑 비어 있음 | `servcList` → `dmscptList` **불일치** | 정상 행도 `PROVIDER_STATUS_NOT_VERIFIED`로 격리. 공통 DB 경로는 있음. 기본 operation으로 일정 후보에도 들지 못함 | 요청 골격만 있음; 실용 수집 불가 |
| K-water 발주계획 15102588 / `kwater-procurement-plan` | 위와 동일 | `servc` → `gds` **불일치** | `IDENTITY_NOT_VERIFIED`로 격리. PLAN 모델은 있음. 기본 일정 제외 | 요청 골격 + 단계 모델만 있음 |
| LH 입찰공고 15159012 / `lh-bid-notice` | 위와 동일 | `getOpenBidInfo` → 동일 | `PROVIDER_STATUS_NOT_VERIFIED`로 격리. 활성화 조건을 만족시키면 일정 후보가 되는 구조이나 현재 DISABLED | 전송/파싱 골격; 정규화 없음 |
| LH 사전규격 15159011 / `lh-pre-specification` | 위와 동일 | `getOpenAdvcinfoReqList` → 동일 | `IDENTITY_NOT_VERIFIED`로 격리. PRE_SPEC 모델은 있음. 현재 일정 없음 | 전송/파싱 골격; 정규화 없음 |
| 나라장터 조달요청 15129468 / `g2b-procurement-request` | 위와 동일 | `getPrcrmntReqInfoListGnrlServc` → `getPrcrmntReqInfoListThngDetail` **불일치** | 명시적 상세 operation+요청번호가 있어야 HTTP 가능. 행은 `OPERATION_INPUTS_NOT_VERIFIED`로 격리. 현재 일정 없음 | 상세 조회 골격만 있음; 목록 발견 경로 없음 |
| 한전 전자입찰계약 15148223 / `kepco-ebid-contract` | DISABLED, NOT_VERIFIED, NOT_REQUESTED, `keyIssuance:ISSUED`, 제한적 매핑 있음, quota.daily 미확인 | `electContract` → 동일 | COM 회사 코드·No·Name·알려진 상태가 있으면 v0.3 NOTICE 생성 가능. 공통 저장 연결. 응답은 항상 PARTIAL. quota 미설정으로 Registry만 켜도 Worker 기동 차단 | 가장 많은 어댑터 구현; 운영 준비 미완료 |
| 나라장터 사전규격 15129437 / `g2b-pre-spec` | APPROVED이나 `NO_FIELD_MAPPING`; enabled/verification은 생략 | `getPublicPrcureThngInfoServc`; 외부 6종 상수에 미등록 | recorded 10행 있음. source/stage enum만 있고 실제 정규화·job schema·scheduler 없음 | 기존 자료 재사용 가능; 수집 구현 미완성 |
| 나라장터 발주계획 15129462 / `g2b-order-plan` | APPROVED이나 `NO_FIELD_MAPPING` | `getOrderPlanSttusListServc`; 외부 6종 상수에 미등록 | recorded 10행 및 오류08 있음. PLAN enum만 있고 실제 정규화·job schema·scheduler 없음 | 기존 자료 재사용 가능; 수집 구현 미완성 |
| 나라장터 업종정보 15129467 / `g2b-industry-master` | APPROVED이나 `NO_FIELD_MAPPING` | `getIndstrytyBaseLawrgltInfoList`; 외부 6종 상수에 미등록 | recorded 999+999+918행 있음. 공고 source enum에도 없음. 참조 데이터 적재 포트/일정 없음 | 자료 확보; 업종 마스터 경로 미구현 |
| 대조군: 나라장터 입찰공고 15129394 + 면허제한/참가지역/e발주 첨부 | APPROVED, 매핑 있음. 실제 키 유효성은 별도 | 목록 `getBidPblancListInfoServc`; 보조 operation 3종 별도 | `OfficialApiConnector`·G2B 정규화·보조 조회·revision·문서 job·live 30분 기본 일정 연결 | 기존 경로를 재사용하고 회귀 보호 |

근거: [Registry:122](../../infra/sources/registry.yaml#L122), [Registry:215](../../infra/sources/registry.yaml#L215), [callableSource:109](../../web/server/ingestion/source-registry.ts#L109), [서비스 상수:42](../../web/server/ingestion/external-connector.model.ts#L42), [정규화 차단:138](../../web/server/ingestion/external-normalize.ts#L138), [Worker 설정:272](../../web/worker/main.ts#L272).

### 2.1 요청·인증·응답 계약 추적

아래 파라미터는 **현재 코드 또는 로컬 recorded 근거**다. 실제 서비스의 최신 필수값/한도로 확정한 표가 아니다. 키는 이름만 표시한다.

| 서비스 | 인증 / 현재 요청 파라미터 | 조회·페이지 범위 | 응답 처리 및 남은 확인 |
| --- | --- | --- | --- |
| K-water 입찰 | GET `serviceKey`; `pageNo`, `numOfRows`, `_type=json`, `searchDt=YYYYMM` | 코드가 월별 분할. 기본 servcList는 요청 전 거절. 문서 근거 있는 dmscptList만 명시 가능 | 공통 JSON/XML 파서. dmscptList 확인을 용역 servcList의 입력·필드·상태 확인으로 전용하면 안 됨 |
| K-water 발주계획 | 위와 동일; 현재 문서 입력 확인은 gds | 월별; servc 기본 거절 | 공통 파서. gds를 servc로 바꾸거나 상품 발주계획을 용역으로 간주하지 않음 |
| LH 입찰 | GET `serviceKey`; `pageNo`, `numOfRows`, `tndrbidRegDtStart/End=YYYYMMDD` | KST 날짜 범위, 공통 page cursor | 형식 강제 파라미터 없음. XML 실형태, 성공 코드, totalCount·row envelope 확인 필요 |
| LH 사전규격 | GET `serviceKey`; `pageNo`, `numOfRows`, `opinionRegEndDtmStart/End=YYYYMMDD` | **의견등록 마감 기준**; 게시일/수정일 기준으로 오해 금지 | 공통 JSON/XML 파서. 마감일 없는 진행 사전규격의 조회 포함 여부와 증분 발견 방식 미검증 |
| G2B 조달요청 | GET `serviceKey`; 명시적 ThngDetail에서 `prcrmntReqNo`, `pageNo`, `numOfRows`, `type=json` | 상세 식별자 필요. from/to는 형식 검증되지만 이 상세 요청에는 날짜 필터로 전송되지 않음 | 목록 GnrlServc의 입력·발견 방식은 확인 안 됨. 상세 성공만으로 기간 목록 완전성을 주장할 수 없음 |
| KEPCO | GET `apiKey`; `noticeBeginDate/EndDate=YYYYMMDD`, `returnType=json`, 선택 `companyId` | 코드가 최대 90일 포함 범위로 분할; pageNo 전송 금지, 회사 생략 시 코드상 `all` | 40자 키 길이 검사 있음. 실제 키 형식/유효성·전체 회사 범위·결과 cap·누락/추가 조회 방법 미검증 |
| G2B 사전규격 | recorded: `serviceKey` 인증, `type=json`, `pageNo`, `numOfRows`, `inqryDiv`, `inqryBgnDt/EndDt` | recorded는 일부 페이지. 이 조합을 보내는 현행 Worker 없음 | recorded는 수집 wrapper이며 transport 원문 그대로가 아님. parser 시험용 재구성 envelope임을 구분 |
| G2B 발주계획 | recorded 성공: `type=json`, `pageNo`, `numOfRows`, `inqryDiv`, `orderBgnYm/EndYm` | 발주 연월과 게시/변경일 조회 기준 구별 필요 | 과거 inqryBgnDt/EndDt 조합의 오류08 근거가 있음. G2B 입찰 파라미터를 그대로 복제하지 않음 |
| G2B 업종정보 | recorded: `type=json`, `pageNo`, `numOfRows`; `serviceKey` 인증 | 과거 999행 × 3페이지, 총 2916행. 1000행 요청이 10행만 반환된 관측도 있음 | 과거 건수/상한을 현재 상한으로 고정하지 않음. 코드·근거법규·사용 여부를 마스터로 파싱 |

근거: [요청 생성:73](../../web/server/ingestion/external-request.ts#L73), [과거 실측:43](../evidence/phase-0/external-deps-api-20261019.md#L43), [발주계획 성공 요청:72](../evidence/phase-0/external-deps-api-20261019.md#L72), [공개 문서 조사 metadata](../evidence/procurement-expansion/20261021-api-metadata.json).

Registry 일일 quota는 K-water 각 10000, LH 각 1000, G2B 각 1000, KEPCO null이다. 신규 TPS는 모두 null이다. 이는 **설정에 적힌 값**이며 현재 계정의 활용승인 한도 확인을 대체하지 않는다. 기본 numOfRows=100, 코드 입력 상한 1000도 서비스별 실제 상한과 다를 수 있다.

### 2.2 이미 구현되어 재사용할 경로

1. `callableSource()`가 DISABLED → NOT_VERIFIED → NOT_APPROVED → endpoint/매핑/env 이름 순으로 차단한다. 실제 키 값의 존재/유효성은 여기서 검사하지 않으며 Worker 설정 해석 단계가 키를 읽는다. `fieldMapping`은 gate/설명이며 매핑 실행 엔진이 아니다.
2. `buildExternalRequest()` → `createExternalApiConnector()` → `createExternalSourceConnector()`가 요청 제한, 15초 기본 timeout, redirect 거절, 20MiB bounded UTF-8 응답, JSON/XML 파싱, 정제 증거, `SourceRecord` 변환을 수행한다. 별도 기관별 HTTP 클라이언트를 다시 만들지 않는다.
3. `runIngest()` → `normalizeRecord()` → `normalizeExternalNotice()` → `decideRevision()` → `repo.saveRevision()` → `ingest_save_revision` RPC로 기존 `bid_notices`, `bid_revisions`, 첨부 행을 저장한다. 후속 `projectProcurementRevision()`도 이미 연결되어 있다.
4. `recordPayload()`의 `ingest_payloads` 및 `recordRunItem()`의 `ingest_run_items`, 오류 기록, 체크포인트/재개, DUPLICATE/STALE/개정 판정을 재사용한다. 현재 정규화 실패의 실제 저장 outcome은 **QUARANTINED**이며 `REJECTED` enum은 없다.
5. PARTIAL/UNKNOWN 페이지는 증거 및 유효 행을 저장할 수 있지만 완료 watermark를 전진시키지 않는다. 이를 임의로 COMPLETE로 바꾸면 안 된다.
6. `createIngestWorker()`는 시작만 해도 G2B 일정 및 신규 6종 일정을 등록/삭제한다. `ingestWorkerRegistration`은 미처리 문서 reconciler도 시작한다. 지금 전체 Worker를 시험 실행하지 않는다.
7. 인증은 `worker/env.ts:30–64`의 기존 reader를 재사용한다. data.go.kr 키는 한 번 decode한 뒤 요청에서 `URLSearchParams`로 한 번 encode하며, KEPCO는 별도 40자 키/허용 env 이름을 검사한다. 기존 G2B 초기 서비스 2종을 external dispatch에 연결할 때 reader의 허용 이름 집합도 함께 확장해야 한다. 키 fallback·인증 로직을 새로 복제하지 않는다.
8. 녹음 도구의 `scripts/recorded/masking.mjs`에 문자열 이메일/전화 마스킹과 `scanLeaks()`가 이미 있다. 새 검증 CLI는 이를 재사용·기관별 확장한다. 기존 `record-g2b.mjs`는 15129394 대량 녹음 전용이므로 실행하지 않으며, 새 도구는 공통 Connector를 감싸는 작은 진입점으로 만든다. `recording-file.mjs`/`recorded-api.ts`의 기존 G2B envelope/totalCount 계약을 신규 XML·count 미상 응답에 억지 적용하지 않는다.

저장 연결 근거: [ingestion.service:178](../../web/server/ingestion/ingestion.service.ts#L178), [:372](../../web/server/ingestion/ingestion.service.ts#L372), [:466](../../web/server/ingestion/ingestion.service.ts#L466), [:641](../../web/server/ingestion/ingestion.service.ts#L641), [repo:226](../../web/server/ingestion/ingestion.repo.ts#L226), [:295](../../web/server/ingestion/ingestion.repo.ts#L295), [Worker 일정:183](../../web/worker/main.ts#L183), [:463](../../web/worker/main.ts#L463).

## 3. 실제 결함과 검증 공백

**확정 결함**과 **의도적인 안전 차단/미검증 항목**을 구분한다. 후자는 차단을 제거하는 방식으로 수정하지 않는다.

| ID / 우선순위 | 코드 위치와 관측 | 영향 / 해결 방향 |
| --- | --- | --- |
| F01 / P0 | `external-connector.model.ts:43–76`, `external-request.ts:78–80`, `main.ts:325–345`: 기본 operation 3종이 허용 집합 밖 | 수동 기본 요청은 HTTP 전 실패, 자동 일정 후보에서도 빠짐. operation별 증거를 확보하고 기본/허용/Registry를 함께 정합화. 이름만 다른 허용 operation으로 교체하지 않음 |
| F02 / P0 | `external-normalize.ts:143–148`: 신규 5종 무조건 거부 | 정상 전송과 정상 수집이 분리됨. 이 안전 차단을 기관 어댑터가 증명된 필드를 검사하는 분기로 대체해야 함 |
| F03 / P1 | `registry.yaml:122–177`, `source-keys.ts:3–9`, `ingestion-admin.model.ts:89–96`, `main.ts:277`: 기존 3종은 매핑/dispatch/job/일정 경로 없음 | Registry 매핑만 채워도 구현되지 않음. G2B 초기 단계 서비스 2종과 별도 업종 마스터 경로가 필요 |
| F04 / P0 | `main.ts:300–307`, `external-request.ts:142–146`: 조달요청 일정에는 requestId가 없고 현재 허용 상세 operation은 requestId 필수 | 기본 operation 불일치를 고쳐도 단순 상세 operation 일정은 실패함. 목록 발견→상세 또는 승인된 요청번호 단위 수동 조회를 구분 |
| F05 / P0 | `external-payload.ts:141–178`: 공통 envelope 후보, case-insensitive 첫 필드, 전역 성공 코드 목록에 의존 | 기관별 root/result/error 구조가 다르면 정상 응답 거부 또는 잘못된 정상 판단 가능. 신규 실응답 없음. 서비스별 확인된 envelope/성공·인증·quota 코드만 profile로 명시; 알 수 없는 구조는 격리 |
| F06 / P0 | `external-api-connector.ts:98–112`: COMPLETE는 성공 코드+totalCount+정확한 page 길이가 있어야 함. KEPCO는 항상 PARTIAL, nextCursor=null | 안전 차단은 타당함. KEPCO는 90일 slice를 만들어도 첫 slice 이후 전진하지 못함. 응답 cap/회사 범위를 확인하거나 명시적 부분 범위를 유지해야 함 |
| F07 / P0 | `external-api-connector.ts:53–55,124`, `retry.ts:35–38`: 외부 Connector는 Retry-After를 읽지 않고 rateLimitInfo=null | 공통 retry가 지킬 서버 대기시간이 전달되지 않음. HTTP 날짜/초 형태를 안전 파싱해 연결하고 과도한 값은 기존 상한 정책으로 중단 |
| F08 / P0 | `ingestion.service.ts:605–618`, `retry.ts:59–72`, `worker/quota-store.ts:40–46`: quota 확인은 재시도 묶음 전, 합산은 묶음 후 | 남은 예산 1회에서 HTTP 모의 503 세 번+성공 한 번으로 **4회 호출, quota=4, SUCCEEDED** 재현. 호출 전 원자적 예약과 실제 HTTP attempt별 계수, 동시 Worker 경합 보호 필요. TPS 필드는 런타임에서 제한하지 않음 |
| F09 / P0 | `external-normalize.ts:104–136,234`, `checksum.ts:7,36–38`, `revision.ts:15–30,135–142`: fetchedAt으로 계산한 participationStatus도 checksum에 포함, 변경 목록에서는 sourceMetadata 제외 | 동일 provider 행을 KST 08:59/09:01에 정규화하면 NOT_STARTED→APPLICATION_OPEN, **CHANGED인데 changes=[]** 재현. 파생 시간 상태와 사업 변경 hash/표시를 분리해야 함 |
| F10 / P0 | `external-normalize.ts:89–102,177–178,263`, `normalize-date.ts:125–128`: DATE도 공통 파서는 KST 18시로 변환; KEPCO top noticeDate에는 이 값 사용 | DATE 마감은 현재 null을 지키지만 게시 날짜의 가정 시각이 실제 시각처럼 저장될 수 있음. MONTH/DATE/정확 시각을 분리하고 외부 필드의 미확인 시각을 만들지 않음. 기존 fixture 상대 날짜 정책은 유지 |
| F11 / P0 | `external-normalize.ts:58–66,161–164,179–195`: KEPCO의 알려진 6상태만 처리, 금액은 UNVERIFIED/null | Fail/OpenTimed/Final을 취소/낙찰로 해석하지 않는 기존 정책 유지. 신규 상태·기관 상태 및 금액 종류/원·백만원·VAT를 실증 전 추정하지 않음 |
| F12 / P0 | `attachment-allowlist.ts:7–29`, `external-normalize.ts:198–210`: 현재 https www.g2b.go.kr/pn/만 허용 | K-water/LH/KEPCO의 정상 첨부도 차단됨. 이는 보안 정책의 미확장이지 허용 목록 전체 완화 사유가 아님. 기관별 HTTPS host/path/공인 DNS/redirect/다운로드 정책 증거가 필요; HTTP는 계속 차단 |
| F13 / P0 | `external-payload.ts:7`, `ingestion.repo.ts:301–302`, migration `20261023000100:106–119`: 수신 20MiB vs DB 정제 증거 2MiB | 파싱 성공 후 저장 단계 예외·RUNNING 잔류/같은 페이지 반복 가능. 저장 가능한 크기를 사전 검증하고 구조적 실패로 닫아야 함. 기존 object_ref 활용은 별도 Storage 계약 검토 후 결정 |
| F14 / P0 | `external-payload.ts:9–24`: 키 이름 기반 연락처/비밀 필터 | 알려진 이름은 제거하지만 새 기관 필드·자유 본문 속 개인정보 비노출을 보장하지 못함. 실응답은 메모리에서 기관별 허용 필드/마스킹을 거친 뒤만 증거화; 요청 URL/query는 아예 기록하지 않음 |
| F15 / P1 | `external-normalize.ts:164`, `ingestion.repo.ts:146–163`, `revision.ts:64–75`, DB unique(source,notice_id) | KEPCO 회사 namespace는 구현됨. 다른 기관의 연도/업무구분/번호/차수 안정 ID 미확인. source별 ID 분리와 공식 교차참조를 보존; 단순 제목·번호 유사로 합치지 않음. 숫자가 아닌 개정·업데이트 시각에는 기존 숫자 차수 역전 방지가 적용되지 않음 |
| F16 / P1 | `external-request.ts:99–103,128–140`, `ingest-queue.ts:150–162`, `main.ts:206`: K-water는 월 전체, LH 사전규격은 의견마감 기준; 모든 신규 일정에 공통 30분 간격 | 초회 약 90일 창과 1일 overlap도 월/의견마감 API에서는 게시·변경 증분 의미가 아님. 월 전체 재조회 비용·지난 월 수정·마감 없는 행 누락을 고려한 소스별 발견/재검증 정책 필요 |

F01–F04는 코드 추적, F08/F09는 실제 외부 연결 없이 실행한 모의 재현 근거다. F05/F10–F16은 코드가 보이는 제한과 검증 공백을 설명하며, 해당 서비스의 실제 장애가 이미 발생했다고 주장하지 않는다.

## 4. 데이터 모델과 필드 매핑 결정

### 4.1 기존 모델로 표현할 부분

- `normalized-bid.model.ts:8–30`에 초기 단계 source 및 PLAN/PRE_SPEC/PROCUREMENT_REQUEST enum이 이미 있다. v0.3 `sourceMetadata`에는 원본 날짜·정밀도·금액 종류·단위/VAT·기관 namespace를 담을 수 있다. nullable 날짜·예산을 억지로 채우지 않는다.
- 저장소에는 [확장 migration](../../supabase/migrations/20261023000100_procurement_opportunities.sql#L4)의 source/stage 제약 확장이 있다. 새 동일 migration을 만들지 않는다. 다만 운영 적용 여부는 이번에 확인하지 않았으므로 향후 승인된 읽기 전용 schema 점검을 활성화 조건으로 둔다. 파일 날짜만 보고 적용 여부를 단정하지 않는다.
- PLAN은 예정 발주 시기, PRE_SPEC은 의견 제출 시기, PROCUREMENT_REQUEST는 조달요청 사실이다. 모두 입찰 접수 마감과 다르므로 `deadlineAt`에 의견마감·발주월·납품기한을 대입하지 않는다. 별도 원본 이름으로 sourceMetadata.dates/attributes에 보존한다.
- 상태는 기관별 공식 의미가 기존 OPEN/AMENDED/CANCELLED/CLOSED에 대응할 때만 매핑한다. 의미 불명 상태를 OPEN으로 기본 처리하지 않는다. 공식 취소 근거 없이 실패/개찰/종료를 CANCELLED/AWARD로 만들지 않는다.
- 공식 stage 간 참조는 검증된 namespace와 함께 연결한다. `stage-link.ts:72–89`의 참조 연결과 `procurement-projection.ts`를 재사용한다. 기존 단계 순서가 없는 PROCUREMENT_REQUEST를 PLAN/PRE_SPEC 사이의 특정 시간 순서로 추정하지 않는다.

### 4.2 기존 recorded에서 실제 확인한 필드와 한계

| 서비스 | 필드 존재를 확인한 후보 | 아직 확정하면 안 되는 의미 |
| --- | --- | --- |
| G2B 사전규격 | `bfSpecRgstNo`, `refNo`, `orderInsttNm`, `rlDminsttNm`, `prdctClsfcNoNm`, `asignBdgtAmt`, `rcptDt`, `opninRgstClseDt`, `rgstDt`, `chgDt`, `bidNtceNoList`, `specDocFileUrl1..5` | 10행에서 bfSpecRgstNo 후보는 서로 다르지만 전체 unique 증명 아님. prdctClsfcNoNm을 실제 사업 제목이라고 단정하지 않음. 의견마감≠입찰마감, 기관 역할·예산 단위·첨부 접근정책 확인 필요 |
| G2B 발주계획 | `orderPlanUntyNo`, `orderPlanSno`, `orderYear`, `orderMnth`, `bizNm`, `orderInsttCd/Nm`, `sumOrderAmt`, 종류별 금액, `nticeDt`, `chgDt`, `orderPlanDtlUrl`, `bidNtceNoList` | 10행의 후보 ID는 서로 다름. 발주월은 게시일/입찰마감이 아님. 총액·당해/계약/자재 금액과 환율·VAT를 섞지 않음; 세부 여러 행 여부 확인 필요 |
| G2B 업종정보 | `indstrytyCd/Nm`, `indstrytyClsfcCd/Nm`, `baseLawordNm`, `baseLawordArtclClauseNm`, `baseLawordUrl`, `rltnRgltCntnts`, `inclsnLcns`, `indstrytyUseYn`, 등록/변경일 | 코드 앞자리 0 보존. 사용 여부의 정확한 enum/폐지 의미, 다중 법규·면허 관계를 확인한 후 catalog key 설계. 공고나 기업의 자격 보유 사실로 저장하지 않음 |

근거는 [사전규격 녹음](../../fixtures/recorded/15129437/getPublicPrcureThngInfoServc.20261019.masked.json), [발주계획 녹음](../../fixtures/recorded/15129462/getOrderPlanSttusListServc.20261019.masked.json), [업종 녹음 p1](../../fixtures/recorded/15129467/getIndstrytyBaseLawrgltInfoList.20261019.p1.masked.json)이다. 신규 6종은 실제 행이 없으므로 위와 같은 원본→정규화 필드 매핑표를 지금 만들지 않는다. KEPCO는 현행 어댑터의 필드 해석과 사용자 명세가 있을 뿐 실응답 검증은 별도다.

### 4.3 별도 승인할 DB/계약 변경안

| 안건 | 기존 모델의 부족 | 최소 제안 / 승인 조건 |
| --- | --- | --- |
| 업종 마스터 | 공고의 identity/stage/title/revision 계약과 맞지 않고 참조 데이터 전용 저장 없음 | `procurement_industry_codes` 및 필요 시 법규 child 테이블: namespace+공식 code, 명칭, 확인된 사용 상태, 원본 등록/변경일, 정제 증거 참조, payload hash/수집 시각. 복수 법규를 강제 1행으로 축약하지 않음. 공용 읽기/Worker 쓰기 RLS·이력 정책을 별도 스펙/새 migration으로 승인 |
| 초기 단계의 미확인 상태/제목 | 현재 status enum에 UNKNOWN 없음; 필수 title이 실제 응답에 없을 수 있음 | 정식 제목 또는 상태 의미를 못 얻으면 우선 QUARANTINED. 필요가 입증되면 초기 단계 전용 nullable 제목/표시명 구분과 상태 계약을 제안. 임시 제목 생성·OPEN 대입으로 제약 우회 금지 |
| MONTH 정밀도·별도 기한 | dates.precision은 DATE/MINUTE/SECOND/UNKNOWN만 지원 | 우선 원본 값은 attributes/dates UNKNOWN+utc:null로 보존. 검색/정렬에 발주월·의견마감이 필요하면 `MONTH` 또는 명명된 별도 날짜 계약을 추가. top deadlineAt 의미는 유지; TS/JSON/DB 읽기 계약 영향 별도 검토 |
| 구조적 실패 상세 | 현재 run item은 error_code만, ingest_errors는 요약 detail; provider field/path와 버전은 별도 열 없음 | 먼저 기존 코드+안전한 reason/path 요약과 payload 참조 재사용. 조회 가능한 `reason_code`, field paths, adapter version이 필요하면 run item/오류 metadata의 additive 변경안 승인. 원본 값은 넣지 않음 |
| 큰 정제 증거 | ingest_payloads 2MiB 제약, object_ref 열은 있으나 큰 증거 저장 구현 없음 | 1차는 한도를 넘기기 전 구조적 실패/페이지 크기 조정. 객체 저장이 필요하면 기존 Storage 경계·권한·수명·정제 후 hash/ref 계약을 승인받아 object_ref 사용. 운영 제약을 즉시 올리거나 원문을 임의 잘라 저장하지 않음 |

운영 DB 변경은 이번 산출물에 포함하지 않는다. 기존 `bidId`, `revisionId`, review/watch/project FK 및 기존 v0.2 읽기 계약은 유지한다.

## 5. 별도 승인 후 최소 실호출 검증 절차

### 5.1 실행 경계와 호출 예산

전체 Worker 대신 **scheduler·큐·DB 저장이 없는 일회성 검증 도구**를 향후 작성한다. 허용 source/operation/기간/company/requestId/maxCalls를 인자로 고정하고 dry-run이 기본이어야 한다. CLI 인자에는 키를 받지 않는다. 현재 Worker 프로세스를 통해 검증하지 않는다.

1. 담당자가 서비스별 활용승인, 키 등록 여부, 허용 operation, 계정별 일일/TPS 한도를 값 비공개로 확인한다. 등록 여부와 유효성을 구분한다.
2. 공식 명세와 기존 조사 자료로 필수 입력을 재확인한다. 문서만으로 불명확한 입력을 임의로 보내지 않는다.
3. 승인 대상마다 아래 **1회** 정상 조회를 수행한다. 한 source에서 인증/구조 오류가 나오면 해당 source는 즉시 중단한다. 자동 재시도는 0회다.
4. 첫 응답이 비어 있으면 인증/성공 envelope/빈 응답만 확인된 것이다. identity·상태·금액·개정 매핑을 완료 처리하지 않는다.
5. 추가로 정상 행이 있는 좁은 기간, 빈 기간, 2페이지, 다른 포맷을 확인할 때는 각각 1회씩 **사전 승인한 항목만** 실행한다. JSON/XML을 지원한다고 추정해 포맷 파라미터를 추가하지 않는다.

| 대상 | 1차 승인 요청의 최소 범위 | 1회 성공으로 증명할 수 없는 것 |
| --- | --- | --- |
| 15101635 | dmscptList 또는 문서 검토를 마친 목표 servcList 중 **승인된 operation 하나**, 한 월, page1/소량 | 다른 업무 operation, 월 전체 완전성·상태·첨부 |
| 15102588 | gds 또는 검토 완료한 목표 servc 중 하나, 한 월, page1/소량 | 용역/물품 공통 필드·발주계획 stable ID/단위 |
| 15159012 | KST 하루의 등록일 범위, page1/소량 | 변경·취소 발견 범위, XML/JSON 양쪽 동일성 |
| 15159011 | KST 하루의 의견등록 마감 범위, page1/소량 | 게시일 증분·마감 미정 행 포함·개정 |
| 15129468 | 승인된 실제 요청번호 1건의 ThngDetail; 목록 명세가 먼저 확정되면 별도 승인한 목록1회 | 상세 성공은 GnrlServc 목록 발견·기간 수집 증명이 아님 |
| 15148223 | 명시적 회사 COM01, KST 하루, 날짜 필터만 사용; page 인자를 만들지 않음 | 회사 생략 all 범위, 다른 회사 전체, cap/페이지/완전성 |
| 15129437 | 과거 성공 형식을 재확인한 짧은 기간, page1/소량 | 전체 필드·제목 의미·수정 누락 |
| 15129462 | 과거 성공한 발주 연월 기준 최소 한 월, page1/소량 | 게시일 기준 쿼리 지원·금액 의미·개정 |
| 15129467 | page1/소량 | 전체 사전 완전성·현재 page 상한/코드 상태 의미 |

전부를 승인한 경우 첫 단계 상한은 **9회**다. 서비스별 추가 확인은 정상 비어 있지 않은 응답/빈 응답/다음 페이지/다른 공식 포맷별 최대 각 1회로 명시한다. 실패 때문에 자동으로 9회 이상 호출하거나 기간을 계속 넓히지 않는다. 실제 인증 실패·quota 소진·5xx 유발은 운영 API에서 시험하지 않고 모의 transport로 검증한다. 1초당 1회 이하 직렬 호출은 내부 검증 상한 제안이며 공급자 한도가 더 엄격하면 그 값을 따른다.

### 5.2 저장할 검증 근거

- sourceKey, serviceId, operation, 비인증 조회 범위의 구조화 값, 형식, HTTP status, 공급자 결과 코드의 허용된 분류, pageNo/pageSize/total/수신 건수, 정제 후 byte 수/hash, 확인 시각, parser/adapter version, 마스킹 버전만 남긴다. 공급자 resultMsg·예외 원문은 저장하지 않는다.
- raw transport는 메모리에서만 취급한다. 키/URL echo/담당자 필드/자유 텍스트를 확인하고, 허용된 구조와 비개인 필드만 fixture로 쓴다. 문서/fixture에는 키를 제거한 전체 요청 URL도 저장하지 않고 endpoint와 파라미터 **이름 및 허용 비민감 값**을 분리한다.
- `PageCapture.serviceKey`는 비밀키가 아니라 Registry key라는 기존 계약을 유지한다. credentials는 캡처 객체에 포함하지 않는다.
- 새 실응답 필드는 존재·타입·단위·시각 기준·nullable·근거 문서/응답 위치를 기록하고 확인된 것만 매핑한다. 공식 문서 확인과 실응답 관측을 각각 표시한다. 재구성 fixture와 실제 정제 transport도 구분한다.
- 신원·차수·공식 연결을 시험할 때는 의미 관계를 유지한 합성 ID를 쓰고, 개인정보가 fixture/history/오류 요약에 남지 않는지 정책 검사 후 저장한다. 마스킹 검토를 통과하지 못하면 캡처를 버리고 메타데이터 결과만 남긴다.

## 6. 우선순위별 구현 계획 — 승인 후 실행

각 작업은 실패하는 핵심 회귀 시험 → 최소 구현 → 관련 시험 통과 순서다. 상수 복사/전수 조합 시험을 늘리지 않고 기존 시험을 재사용한다. 아래 함수/파일 이름의 **신규** 표시는 미래 설계다.

### P0-A. operation 계약 및 검증 도구

**파일:** `external-connector.model.ts`, `external-request.ts`, `source-registry.ts`, `external-adapters.test.ts`; 기존 `scripts/recorded/masking.mjs`와 그 시험 재사용·확장, 신규 `scripts/recorded/verify-external-contracts.ts`.

**인터페이스:** 기존 `buildExternalRequest(options, FetchPageInput): ExternalRequest` 유지. 서비스 상수의 operation별 계약에 query 기준·허용 입력·문서/실측 검증 구분을 둔다. CLI는 runtime 인증 검사 권한을 가지되 Registry 활성화 권한은 갖지 않는다.

- [ ] 기본 operation 불일치 3종 및 requestId 없는 상세 조회를 HTTP 0회로 차단하는 현재 동작을 고정한다.
- [ ] 검증할 목표 업무 operation을 명시하고 §5의 dry-run/호출 상한/정제 절차를 구현한다. 검증 결과 없이 verifiedOperations를 넓히지 않는다.
- [ ] 실호출은 별도 승인 후 수행하고, 서비스별 요청·응답 매핑 근거표를 만든다. dmscptList/gds를 용역 기본 operation으로 무조건 대체하지 않는다.

**완료 기준:** 미확인 operation은 DISABLED/NOT_VERIFIED 유지, dry-run의 HTTP/Redis/DB 호출 0회, 명시적 승인 실행은 maxCalls를 초과하지 않음.

### P0-B. 전송·파싱·예산·증거 안전성

**파일:** `external-api-connector.ts`, `external-payload.ts`, `connector.model.ts`, `retry.ts`, `quota-store.ts`, `worker/quota-store.ts`, `ingestion.service.ts`, `ingestion.repo.ts`, 관련 기존 시험.

**인터페이스:** `ExternalFetchOutcome`, `FetchPageOutcome`의 성공/실패 계약 유지. 새로운 이유가 필요하면 공통 코드와 안전한 하위 reason을 명시한다. `QuotaStore`에 실제 HTTP 직전 원자적 예약 연산을 추가하고 일일 예산·TPS 미확인/저장소 장애는 호출 전 실패로 반환한다.

- [ ] F08 재현을 회귀 시험으로 고정: 잔여 1회에서 모의 HTTP 최대 1회, 추가 retry/동시 Worker는 요청 전 거절. KST 자정 경계와 G2B 목록+보조의 공유 serviceId 카운터 유지, 이중 계수 방지.
- [ ] `Retry-After` 초/HTTP-date 및 429/5xx/timeout 정책을 연결한다. 인증 실패/잘못된 입력/unknown schema는 무차별 재시도하지 않는다.
- [ ] 서비스별 확인된 envelope/result-code profile을 공통 파서에 연결한다. XML 단건/다건/빈 응답, 코드 앞 0·큰 정수 문자열, 20MiB/깊이32/DOCTYPE·ENTITY 거부를 유지한다.
- [ ] 증거 2MiB 사전 한도 및 정제 후 크기를 검사하고, 초과는 payload를 자르거나 체크포인트를 전진시키지 않은 구조적 실패로 기록한다. 저장 실패/중단 시 run과 cursor의 복구 가능한 상태를 남긴다.
- [ ] 기관별 개인정보 허용/제거 규칙을 추가하고 캡처·오류·job data에 인증 URL/query·키/연락처가 없음을 검증한다.

**완료 기준:** C1/C2/C3/C8/C9/C10(§7) 통과. 사전 요청 거절은 호출 0회, 실제 retry만 예약/계수. 기존 mock/fixture 외부 호출 0회 유지.

### P0-C. KEPCO 기존 어댑터의 revision·정밀도·부분성 보완

**파일:** `external-normalize.ts`, `normalized-bid.model.ts`, `checksum.ts`, `revision.ts`, 필요 시 읽기 시점 상태 계산 모듈, `external-adapters.test.ts`, `external-ingestion.test.ts`.

**인터페이스:** 기존 `normalizeExternalNotice(sourceKey, item, context): NormalizeOutcome` dispatcher 유지. business 변경에 해당하는 공급자 상태/날짜/금액과 현재 시각에 따른 파생 참여 상태를 구분한다.

- [ ] F09 재현을 고정: 같은 provider 행+다른 관측 시각은 DUPLICATE, 공급자 실제 필드 변경은 CHANGED이며 변경 근거가 비어 있지 않음.
- [ ] 파생 participationStatus를 business checksum 입력에서 분리하고 읽기 시점 계산 경계를 정한다. 기존 v0.2 checksum/golden을 바꾸지 않는다. 기존 v0.3와 비교 시 새 checksum 정책만으로 가짜 revision이 생기지 않는 전환 시험을 포함한다.
- [ ] DATE/MONTH에는 실제 시간값을 만들지 않는다. 정확한 입찰마감과 신청마감 분리를 유지하고, `-`/누락/불가능 날짜는 null+원인 또는 필수 항목 격리로 처리한다.
- [ ] 회사 namespace·별칭 충돌·알려지지 않은 상태 격리를 유지한다. 금액은 단위/VAT 증거 확보 전 대표 예산 null을 유지한다.
- [ ] KEPCO의 all 범위/회사별 범위/cap 검증 전에는 PARTIAL을 유지한다. 확인된 회사·짧은 범위만 대상으로 하는 canary와 전체 수집 완료를 구분한다.

**완료 기준:** C4–C7/C10 통과, 시간 경과만으로 revision 증가 0, cap 불명 응답으로 완료 watermark 이동 0.

### P1-A. 기관별 정규화 어댑터 및 기존 G2B 초기 단계 완성

**파일:** `external-normalize.ts` dispatcher; 신규 `normalize-kwater.ts`, `normalize-lh.ts`, `normalize-g2b-early.ts`; `source-keys.ts`, `external-connector.model.ts`, `external-request.ts`, `connector.model.ts`, `ingestion-admin.model.ts`, `worker/env.ts`, 기존 시험.

**인터페이스:** 신규 기관 모듈은 `(sourceKey, item: ExternalItem, context): NormalizeOutcome` 형태로 dispatcher에 연결한다. SourceRecord의 기존 `external` 분기·공통 저장 경로를 재사용하고, 기존 G2B 초기 2종은 실제로 job/dispatch를 통과하도록 서비스 key 타입을 확장한다. 업종 마스터는 여기에 넣지 않는다.

- [ ] 검증된 정상/빈 응답과 identity/title/status/date/amount/첨부 매핑을 서비스별 핵심 시험으로 고정한다. 실제 근거 없는 필드는 fixture 기대값으로 창작하지 않는다.
- [ ] K-water와 LH는 기관별 ID namespace·단계·원본 상태를 보존한다. G2B 초기 2종은 §4.2 후보를 의미 확인 후 확정한다.
- [ ] G2B 조달요청은 목록 발견 입력이 확인되면 목록→상세를 분리한다. 미확인이면 요청번호 단위 명시 수동 조회만 허용하고 자동 목록 일정은 만들지 않는다.
- [ ] `reason`, field path, source/service/operation, 안전한 record key, payload hash/ref로 실패를 추적한다. QUARANTINED 행은 bid/revision/project/분석 자료로 적재하지 않는다.
- [ ] Registry fieldMapping에 실제 코드 매핑과 같은 근거를 반영하되 enabled=false를 유지한다. 기본 operation/허용 operation/worker gate 간 정합성 시험을 추가한다.

**완료 기준:** 8개 공고성 서비스 각각 C1–C10의 적용 항목 통과. PLAN/PRE_SPEC/PROCUREMENT_REQUEST가 NOTICE로 저장되는 사례 0, 무근거 대표 예산·기한·제목/상태 생성 0.

### P1-B. 업종 마스터와 조건부 DB/계약 변경

**파일:** 신규 `industry-master.model.ts`, `industry-master.repo.ts`, 해당 수집 서비스/시험; 승인 시에만 새 migration·DB 타입. 공고 ingestion과 공통 HTTP/parser/quota를 공유한다.

- [ ] 기존 recorded 3페이지로 코드 문자열/앞자리0/중복/변경/사용상태·복수 법규 보존 시험을 작성한다.
- [ ] §4.3 마스터 스키마·RLS·이력/폐지 정책을 별도 승인받는다. 기존 migration을 수정하지 않는다.
- [ ] 공고/bid_documents/자동 AI 분석을 생성하지 않는 catalog 전용 저장을 구현한다. snapshot 완전성 미확인 또는 페이지 장애 시 누락 코드를 폐지 처리하지 않는다.
- [ ] 사전/마스터 갱신 주기·일일 예산을 입찰공고 30분 일정과 분리한다. 운영 등록은 P2 승인 전 하지 않는다.

**완료 기준:** 업종정보 C1–C10 변형 시험 통과, 모의 DB에서 기존 공고/기업 자격 보유 상태에 변경 0. DB 변경이 승인되지 않으면 이 소스는 미완료/비활성 유지.

### P2. 소스별 수집 창·일정·제한 canary

**파일:** `worker/main.ts`, `worker/ingest-queue.ts`, `ingestion-admin.model.ts`, Registry, Worker/관리 API 기존 시험. 관련성·사업기회 투영은 기존 경로를 유지한다.

- [ ] 시작 시 자동 등록과 분리된 dry-run schedule manifest를 만든다. service/operation/company/request/기간/최대 페이지·호출·간격을 승인 가능한 형태로 보여준다.
- [ ] 소스별 목록/상세·월별·의견마감·회사 partition과 변경 재조회 창을 정한다. 초회 공통 90일 수집 대신 승인된 최소 한 창으로 시작한다. cursor 반복/공급자 잘림/도중 totalCount 변화는 PARTIAL로 중단하고 건너뛰지 않는다.
- [ ] 검증된 operation마다 실행 scope/watermark를 분리하고, 지연 정정·과거 월 수정·일정 재시작을 시험한다. 회사 전체/전체 operation을 단일 all 성공으로 묶지 않는다.
- [ ] 후속 documents·analysis 생성 범위를 명시한다. 수집 canary가 전체 자동 AI 분석/전체 첨부 다운로드를 승인한 것은 아니다.
- [ ] §8을 만족한 소스 한 개씩 별도 운영 승인 후 제한 수집→대조→일정 등록한다. 나머지는 DISABLED 유지.

**완료 기준:** 승인된 범위 밖 HTTP/큐/DB 쓰기 0, 장애 재개 시 중복 revision/카운트 증가 0, 미완전 run watermark 이동 0.

## 7. 테스트 및 검증 기준

### 7.1 모든 서비스에 적용할 공통 계약

| ID | 시험 | 통과 기준 |
| --- | --- | --- |
| C1 | 인증 실패 | HTTP401/403 및 서비스별 확인된 인증 오류 envelope; 재시도 0, 키/query/PII 비노출, 저장/완료 watermark 이동 0. 합성 키의 원문/Encoding 입력에서 HTTP 경계의 인코딩 1회 검증 |
| C2 | 정상·빈 응답 | 기관별 실제 확인 구조 또는 명확히 표시한 합성 fixture로 정상/0건 구별. 빈 응답을 매핑 검증 완료로 표시하지 않음; HTML·모르는 구조는 실패 |
| C3 | 페이지네이션 | 단건·다건·마지막·중간 누락·total 변화·반복 페이지·월/회사 partition 경계. unknown cap/count는 PARTIAL, cursor 건너뜀 0 |
| C4 | 중복 공고/레코드 | 같은 행 재수집·겹치는 창·다른 회사 동일번호. source+공식 namespace 구별, 불필요 revision/기회 통합/계수 증가 0 |
| C5 | 개정 이력 | 수정→새 revision, 같은 내용→DUPLICATE, 검증된 예전 차수/변경 시각→최신 덮어쓰기 방지. 취소·재공고·개찰/종료의 의미 구별 |
| C6 | 날짜 | 누락/불가능 날짜/시간대/KST 자정·월말·윤일/DATE·MONTH·정확 시각/조회 기준 차이. 임의 18시·마감 생성 0, 원본 정밀도 보존 |
| C7 | 금액 | 정수 문자열/안전정수 밖/0·대시/확인된 단위·VAT·금액 종류. 불명 단위의 원화/대표예산 변환 0, float 반올림 손실 0 |
| C8 | 첨부 URL | 확인된 기관 host/path만 통과, HTTP·userinfo·IP·사설 DNS·외부 redirect 차단. 첨부 없는 서비스는 documents job 0 및 URL 필드 억지 생성 0 |
| C9 | 호출 예산 | 일일 한도 직전+최대 retry+동시성+TPS+KST 자정+카운터 장애. 실제 HTTP 전 예약, 허용 횟수 초과 0, 미확인 quota 활성화 0 |
| C10 | 재시도·복구 | 429 Retry-After/5xx/timeout/2MiB 초과/DB 실패/처리 중 중단. 같은 job/scope/window에서 저장된 cursor 재개, 증거-행 연결 유지, 중복 저장/계수 증가 0 |

### 7.2 서비스별 추가 초점

아래 각 행은 C1–C10을 기본 적용한다. 서비스에 해당하지 않는 데이터는 “없음” 계약을 시험하며 가짜 필드를 만들어 시험을 통과시키지 않는다.

| 서비스 | 반드시 포함할 차이 |
| --- | --- |
| K-water 입찰 | 목표 업무 operation 입력 검증, 월 재조회/연말 경계, 그 operation의 실제 ID/개정/상태/금액/첨부, 잘못된 기본 operation의 HTTP0 |
| K-water 발주계획 | gds/servc 근거 분리, 발주월 정밀도, PLAN 저장, 기재 금액 종류, 실제 입찰 마감 생성0 |
| LH 입찰 | XML singleton/array/empty/error, 등록일과 변경일 범위, bidNum 안정성, 정정/취소 상태 증거 |
| LH 사전규격 | 의견마감 기준 조회, PRE_SPEC 저장, 마감 없는/수정된 행의 발견 정책, 의견마감이 deadlineAt으로 복사되지 않음 |
| G2B 조달요청 | requestId 필수 상세와 목록 발견 분리, 미확인 목록/자동 상세 job 호출0, PROCUREMENT_REQUEST 저장, 공식 요청번호·연결 보존 |
| KEPCO | 회사별 동일 No 분리, case alias 충돌, 숫자 문자열, 신청/투찰 기한 구별, 시간 경과만의 revision0, Fail/OpenTimed/Final 의미 보존, cap 불명 PARTIAL |
| G2B 사전규격 | recorded 필드 존재와 의미 구별, ID/공식 공고 연결, 문서 제목 근거, 의견마감·납품기한·입찰마감 분리 |
| G2B 발주계획 | orderBgnYm/EndYm 성공과 오류08, orderPlanUntyNo/세부행 identity, 발주월·여러 금액 종류 보존, PLAN 저장 |
| G2B 업종정보 | C4는 code 중복, C5는 명칭/법규/사용상태 이력. 큰 페이지 요청 잘림 검출, 누락≠폐지, 앞0·복수 법규, 공고·첨부·기업 보유자격 생성0 |

### 7.3 현재 확인한 결과와 향후 검증 명령

이번 분석에서 수행한 기존 시험:

```text
pnpm -C web exec vitest run server/ingestion/external-adapters.test.ts server/ingestion/external-ingestion.test.ts worker/external-ingest.test.ts
3 files passed / 20 tests passed
```

세 파일은 fetch 주입 및 메모리/모의 Supabase transport를 사용한다. 외부 API, 실제 Redis·Supabase에 연결하지 않았다. 이 결과는 현재 안전 차단/공통 계약의 기준선이며 신규 API 운영 수집 성공을 뜻하지 않는다.

추가 모의 재현: 동일 KEPCO 행의 관측 시각만 변경 시 `NOT_STARTED → APPLICATION_OPEN`, `CHANGED`, `changes=[]`; 일일 한도1+모의503 재시도 시 실제 모의 HTTP4, 기록 quota4, run SUCCEEDED. 소스/테스트 파일 수정 없이 인메모리 실행했다.

향후 구현 후에는 해당 기존 시험 파일에 결함 회귀를 먼저 추가하고, 영향에 따라 `service-key-redaction.test.ts`, `external-admin.test.ts`, `idempotent-upsert.test.ts`, `revision-diff.test.ts`, `attachment-security.test.ts`, `worker/readiness.test.ts`, `scripts/recorded/masking.test.mjs`를 실행한다. 별도 Worker 일정/quota 전수 시험을 복구하지 않고 필요한 회귀를 기존 external 시험 파일에 추가한다. 개발 중 `pnpm verify:changed`, 통합·제출 전 `pnpm verify`로 타입 검사·린트·전체 시험·빌드를 수행한다. 운영 E2E/전체 Worker/DB 연동 검증은 별도 승인 전 실행하지 않는다. 이번 문서 작업에서 전체 빌드·운영 검증은 실행하지 않았다.

## 8. 운영 활성화 체크리스트 — 모두 미래 작업

- [ ] 서비스별 활용승인·키 유효성·실제 quota/TPS를 값 비공개로 확인했다. 키 등록만으로 완료 처리하지 않았다.
- [ ] 대상 operation의 요청/응답/identity/status/date/amount/첨부 의미가 근거와 일치한다. 기본 operation·허용 집합·Registry가 일치한다.
- [ ] 정상 비어 있지 않은 응답과 빈 응답을 구별했다. 누락·잘림·미확인 회사/페이지를 COMPLETE로 표시하지 않는다.
- [ ] 정제 fixture/오류/증거에 키·인증 query string·개인정보가 없다. 기관 첨부 보안 정책 및 사용 조건이 확인되었다.
- [ ] C1–C10과 기존 mock/fixture/G2B 회귀, 타입·린트·빌드 검증이 통과했다. F08/F09/F13의 회귀가 직접 포함됐다.
- [ ] 운영에 필요한 기존 source/stage/증거 테이블·RPC/타입이 실제 적용돼 있는지 승인된 읽기 전용 점검으로 확인했다. 미적용 시 별도 DB 승인 전 활성화하지 않는다.
- [ ] 업종 마스터 또는 상태/정밀도 계약 확장이 필요하다면 별도 DB/스펙 승인을 받았다. 과거 migration은 수정하지 않았다.
- [ ] 소스 1개·operation 1개·회사/기간·최대 호출/페이지·저장 범위·문서/분석 후속 동작을 적은 canary 계획을 승인받았다.
- [ ] canary를 scheduler 없는 일회성 실행으로 대조했다. 오류/중복/revision/증거/완료 watermark 및 호출 수를 확인했다.
- [ ] 검증된 소스만 enabled/verification/approval/mapping/quota를 갱신하는 별도 변경을 승인받았다. 미검증 소스는 DISABLED다.
- [ ] 별도 scheduler 등록 승인을 받은 뒤 검토된 schedule manifest만 적용한다. 전체 Worker 시작에 따른 G2B 자동 일정·기존 큐/문서 reconciler 부작용을 확인했다.
- [ ] 중지 조건은 인증 오류1회, quota 불명/초과, schema/PII/증거 크기 위반, 잘못된 ID/단계/단위/개정, 예상 밖 호출/큐 증가다. 부분 run은 완료 처리하지 않는다.
- [ ] 롤백은 해당 소스의 추가 수집/일정만 정지하고 증거·revision·체크포인트를 보존한다. DB/Redis 초기화·전체 큐 삭제·모델/인프라 재시작은 하지 않는다.

## 9. 수정 대상 파일 목록과 종료 지점

| 묶음 | 향후 수정/추가 대상 |
| --- | --- |
| Registry/서비스 계약 | `infra/sources/registry.yaml`; `source-registry.ts`, `source-keys.ts`, `external-connector.model.ts`, `external-request.ts`, `connector.model.ts`, `ingestion-admin.model.ts` |
| 공통 전송/증거/예산 | `external-api-connector.ts`, `external-payload.ts`, `retry.ts`, `quota-store.ts`, `ingestion.service.ts`, `ingestion.repo.ts`, `validation.ts`, `worker/quota-store.ts` |
| 정규화/개정 | `external-normalize.ts`, `normalized-bid.model.ts`, `checksum.ts`, `revision.ts`; 신규 기관별 `normalize-kwater.ts`, `normalize-lh.ts`, `normalize-g2b-early.ts`; 필요 시 `procurement-projection.ts`의 실제 metadata 변경 표시 |
| Worker/관리 계약 | `worker/main.ts`, `worker/ingest-queue.ts`, `worker/env.ts`, `ingestion-admin.service.ts` 및 공통 배럴 `ingestion/index.ts`; 소스별 일정 계획/허용 범위 계약 |
| 검증 도구/자료 | 신규 `scripts/recorded/verify-external-contracts.ts`; 기존 `scripts/recorded/masking.mjs` 재사용·확장, 승인 후 정제된 `fixtures/recorded/<serviceId>/...`, operation별 매핑/호출 예산 근거 |
| 시험 | 기존 `external-adapters.test.ts`, `external-ingestion.test.ts`, `external-admin.test.ts`, `service-key-redaction.test.ts`, `worker/external-ingest.test.ts`와 §7.3의 영향 시험. 새 실패만 필요한 곳에 추가 |
| 별도 DB 승인 시 | 업종 마스터 모델/repo/수집 시험; 신규 `supabase/migrations/<승인 시각>_...sql`, 생성 DB 타입. 과거 SQL 수정 없음 |

경로를 생략한 TS 파일은 `web/server/ingestion/` 기준이다. 범위와 실제 근거를 확인한 파일만 수정하고, Qwen/Bosun/AI Gateway/Dependency Reporter/Redis API Gateway 설정은 대상에서 제외한다.

**이번 종료 상태:** 분석과 이 계획 문서 작성까지다. 신규 실호출/필드 매핑/코드 구현/Registry 활성화/DB 변경/Worker·scheduler 시작은 하지 않았다. 다음 결정은 먼저 P0-A/P0-B/P0-C 로컬 구현 승인과 §5의 소스별 소량 실호출 승인을 구분하는 것이다.
