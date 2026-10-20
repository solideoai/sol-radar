---
title: "15. 데이터 계약·품질·근거"
doc: "15"
status: review
tags:
  - sol-radar
  - pipeline
  - db
updated: 2026-10-20
---

# 15. 데이터 계약·품질·근거

이 문서는 수집(07) → 추출(03) → 저장(04) → API(05) 사이를 오가는 **공통 데이터 타입의 단일 정의**다. 다른 문서는 여기 이름을 그대로 쓴다.

> [!tip] 심사 포인트
> AI가 만든 모든 값은 `state`(알고 있음/모름/해당 없음/상충)와 원문 인용(`EvidenceRef`)을 함께 가진다. 인용은 원문과 문자열 대조로 검증하고, 실패하면 값을 버린다. 공공 API의 구조화 필드를 근거로 쓰면 원본 응답의 필드 값과 대조한다. 회사 쪽 근거(`CompanyEvidenceRef`)와 Kev 입력 줄의 출처(`KevStateTrace`)도 남긴다. "근거 없는 값은 없다"가 이 계약의 핵심이다.

## 1. 계약 이름과 정의 위치

|계약|정의 위치|생산자|소비자|
|---|---|---|---|
|`FieldState`, `EvidenceRef`, `ExtractedField<T>`|이 문서 §2|AI gateway(`kind=TEXT`), worker·규칙 엔진(`kind=API_FIELD`)|규칙 엔진, API, UI|
|`CompanyEvidenceRef`, `KevStateTrace`|이 문서 §2.1|규칙 엔진(worker), AI gateway Kev 어댑터(state 빌더)|API, UI, `score_runs.kev_output`, 평가셋|
|`NormalizedBid`, `StructuredRequirement`|이 문서 §3|Connector(07, `web/server/ingestion`)|DB `bid_revisions.normalized`·`bid_structured_requirements`, 추출기, 규칙 엔진|
|`ParseResult`(gateway `POST /parse` 응답)|[[03-AI-PIPELINE\|03 AI 파이프라인]]|AI gateway 문서 파서|worker documents job, 추출기, 인용 검증(§5.1)|
|`RequirementExtraction`|[[03-AI-PIPELINE\|03 AI 파이프라인]] §4.1|Qwen 추출기|규칙 엔진, `requirement_extractions.payload`|
|판정 라벨(`SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW`)과 `NEEDS_REVIEW` 사유 코드|[[08-SCORING\|08 점수]] §5.1|규칙 엔진, Kev 어댑터|API, UI, 평가셋|
|`AnalysisInput`|[[04-DATABASE\|04 DB]] `score_runs.input_snapshot`|worker(`web/worker`)|재현·백테스트|
|`AnalysisResult`, `BidDetail` 등 API 응답·요청 스키마|[[05-API-SPEC\|05 API 명세]] §4|Route Handler(`web/app/api/v1`)|화면(`web/app`), 스크립트|
|`EvalItem`(평가셋 정본 형식)|[[21-MODEL-TRAINING\|21 모델 학습]] §3.7|데이터셋 빌더(`pnpm dataset:build`, 예정)|평가 하네스, 학습셋 내보내기|
|소스 registry|이 문서 §8|운영자|Connector|

다른 문서가 정본인 계약(`ParseResult`·`RequirementExtraction`·판정 라벨·`EvalItem`)은 여기에 타입을 복사하지 않는다. 이 문서의 `EvidenceRef`·`CompanyEvidenceRef`를 그 계약들이 그대로 쓴다.

스키마 버전 문자열은 `"<이름>/v<major>.<minor>"` 형식이다. 필드를 지우거나 의미를 바꾸면 major를 올리고, 선택 필드 추가는 minor를 올린다. 저장된 JSONB에는 항상 `schemaVersion`이 들어간다.

코드 정의: TypeScript 쪽 계약의 단일 원천은 zod 스키마(`web/server/<도메인>/*.model.ts`)이고, 타입은 스키마에서 얻는다([[16-DECISIONS|16 ADR]] ADR-016). 이 문서의 `interface` 표기는 설명용이며 필드 이름·뜻은 zod 스키마와 같아야 한다. Route Handler·worker·화면이 같은 스키마를 import한다. DB 행 타입은 생성물 `web/lib/database.types.ts`이고, JSONB 열 안의 구조는 이 문서의 계약을 zod로 검증한다([[04-DATABASE|04 DB]] §1).

이름 규칙: DB 열은 snake_case, JSON 필드는 camelCase다. 조직 소유 데이터의 조직 열은 DB `org_id`, JSON `orgId`다.

## 2. 공통 타입

```ts
/** 값의 인식 상태. UI는 네 상태를 색이 아닌 아이콘+텍스트로 구분한다 */
type FieldState = "KNOWN" | "UNKNOWN" | "NOT_APPLICABLE" | "CONFLICTED";

/** 인용 검증 결과 (§5) */
type CitationMatch = "EXACT" | "NORMALIZED" | "FUZZY" | "FAILED";

/** 근거의 출처 종류. TEXT = 공고 본문·첨부 텍스트의 인용, API_FIELD = 공공 API 응답의 구조화 필드 값 */
type EvidenceKind = "TEXT" | "API_FIELD";

interface EvidenceRef {
  kind?: EvidenceKind;        // 없으면 "TEXT"
  documentId: string | null;  // TEXT: bid_documents.id. null이면 공고 본문(bid_revisions.normalized.content). API_FIELD: 항상 null
  revisionId: string;         // bid_revisions.id. 인용이 가리키는 원문 버전
  page?: number | null;       // TEXT: 1부터. 페이지 구분이 있는 첨부(PDF)만. API_FIELD: null
  charStart?: number | null;  // TEXT: 정규화 텍스트(§5.1) 기준 0-based, 구간은 [charStart, charEnd). API_FIELD: null
  charEnd?: number | null;
  apiField?: string;          // API_FIELD만. 응답 필드 이름. 예: "lcnsLmtNm"
  apiSource?: string;         // API_FIELD만. registry key(§8). 예: "g2b-bid-license-limit"
  quotedText: string;         // TEXT: 원문 그대로 5~300자, 요약·의역 금지. API_FIELD: 필드 값 원문
  sourceUrl?: string;         // 원문 재확인 링크
  fetchedAt: string;          // ISO8601 UTC. 원문을 가져온 시각
  match?: CitationMatch;      // 검증 단계가 채운다. AI 출력에는 없다
}

/** AI가 추출한 모든 값의 포장. 값 하나에 근거 0개 이상 */
interface ExtractedField<T> {
  value: T | null;            // state가 KNOWN일 때만 non-null
  state: FieldState;
  evidence: EvidenceRef[];    // KNOWN이면 match가 FAILED가 아닌 항목이 1개 이상
  note?: string;              // 200자 이내. CONFLICTED 사유, 단위 환산 설명 등
}
```

상태 규칙:

|state|value|evidence|언제|
|---|---|---|---|
|`KNOWN`|non-null|1개 이상, 검증 통과|원문에 값이 명시됨|
|`UNKNOWN`|null|유효 근거 0개. 인용 검증 실패 시 `match=FAILED`인 ref는 보존(§5.3)|원문에 없음, 또는 인용 검증 전부 실패|
|`NOT_APPLICABLE`|null|0~1개|해당 항목이 이 공고 유형에 없음(예: 발주계획에는 마감 없음)|
|`CONFLICTED`|null|2개 이상|원문 내 두 값이 다름(본문 예산 ≠ 첨부 예산). `note`에 두 값을 적는다|

`UNKNOWN`을 0, 빈 문자열, 미래 날짜, 기본값으로 바꾸지 않는다. 규칙 엔진은 `UNKNOWN`·`CONFLICTED`를 `NEEDS_REVIEW` 또는 `missingFactors`로 처리한다([[08-SCORING|08 점수]]).

근거의 출처 종류([[16-DECISIONS|ADR-020]]):

|`kind`|채우는 필드|누가 만드나|검증|
|---|---|---|---|
|`TEXT`(기본)|`documentId`(본문이면 null), `page`·`charStart`·`charEnd`(선택), `quotedText` 5~300자|Qwen 추출(gateway). AI 출력의 근거는 언제나 `TEXT`다|§5.2 인용 검증 알고리즘|
|`API_FIELD`|`apiField`, `apiSource`, `quotedText`(필드 값 원문). `documentId`·`page`·`charStart`·`charEnd`는 null|worker·규칙 엔진. API 구조화 필드(면허제한 `lcnsLmtNm`, 참가가능지역 `prtcptPsblRgnNm`, 금액 `presmptPrce`·`asignBdgtAmt`, 마감 `bidClseDt` 등)로 판정할 때(`basis=API_FIELD`, [[04-DATABASE\|04 DB]] `qualification_checks`)|§5.4 원본 응답 필드 대조|

판정 라벨: 규칙 판정·Kev 요구사항 질문(`req.{itemId}.status`)·평가셋 라벨은 같은 3값(`SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW`)과 `NEEDS_REVIEW` 사유 코드를 쓴다. 조건과 사유 코드의 정본은 [[08-SCORING|08 점수]] §5.1이다. 이 문서가 정하는 것은 근거 형식이다: `NOT_SATISFIED`에는 검증을 통과한 공고 쪽 `EvidenceRef` 1개 이상과 회사 쪽 명시적 부정 근거 `CompanyEvidenceRef`(§2.1) 1개 이상이 함께 있어야 한다. 정보가 없다는 사실만으로는 미충족이 될 수 없다.

### 2.1 회사 쪽 근거 `CompanyEvidenceRef`와 Kev state 추적 `KevStateTrace`

`EvidenceRef`는 공고 쪽만 가리킨다. 판정의 다른 한쪽인 회사 기록과, 인용을 만들지 못하는 Kev의 입력 줄을 추적하려고 두 타입을 둔다([[16-DECISIONS|ADR-020]]). [[05-API-SPEC|05 API 명세]]·[[21-MODEL-TRAINING|21 모델 학습]]의 같은 이름 타입은 이 정의를 따른다.

```ts
/** 회사 쪽 근거 위치. 회사 프로필 revision의 기록 하나 또는 회사 증빙 파일을 가리킨다 */
interface CompanyEvidenceRef {
  profileRevision: number;
  kind: "LICENSE" | "INDUSTRY_CODE" | "TECHNOLOGY" | "PROJECT" | "STAFF" | "FINANCIAL";
  recordKey: string;                       // 예: "licenses[2]", "past_projects[0]"
  documentId: string | null;               // 회사 증빙 파일(MinIO)이 있으면
  quotedText: string | null;
}

/** Kev state를 만들 때 줄마다 남기는 출처. Kev는 인용을 만들지 못한다 */
interface KevStateTrace {
  stateHash: string;                       // sha256(state 텍스트)
  template: "en.v0.2" | "ko.v0.2";
  lines: {
    lineNo: number;
    text: string;
    noticeEvidence: EvidenceRef[];         // §2. 추출 필드의 검증된 인용
    companyEvidence: CompanyEvidenceRef[];
    itemIds: string[];                     // 이 줄이 다루는 요구사항 항목
  }[];
}
```

|타입|저장 위치|규칙|
|---|---|---|
|`CompanyEvidenceRef`|`qualification_checks.company_evidence`, `requirement_assessments.company_evidence`([[04-DATABASE\|04 DB]]), `KevStateTrace.lines[].companyEvidence`, 평가셋 `EvalItem.labels[].companyEvidence`|`profileRevision`은 판정에 쓴 회사 프로필 revision이다. 회사 프로필은 모든 실행 모드에서 가상이다(ADR-019·020)|
|`KevStateTrace`|`score_runs.kev_output`(Kev 응답 원문과 함께), API `KevAssist.stateTrace`([[05-API-SPEC\|05 API]])|운영 state는 `en.v0.2`만이다. `ko.v0.2`는 평가 전용(`KEV_ALLOW_KO_STATE=true`)이고 `SOL_RUN_MODE=live`와 함께 쓰면 gateway가 기동을 거부한다([[03-AI-PIPELINE\|03 AI 파이프라인]], [[09-SECURITY\|09 보안]])|

- 근거가 하나도 없는 줄(예: `(unknown)`)도 state에 들어갈 수 있다. 그 줄만으로 나온 Kev 판단은 `NEEDS_REVIEW` 쪽 근거로만 표시한다.
- 화면에서 Kev 질문 결과를 누르면 그 질문의 `itemIds`를 다룬 줄과 그 줄의 공고 인용·회사 증빙이 열린다([[06-UI-UX|06 UI]]).
- 첨부를 읽지 못했으면 state에는 그 사실 한 줄만 들어가고, 읽지 못한 문서의 요구사항으로 줄을 만들지 않는다([[07-DATA-PIPELINE|07 수집]] §2.6).

## 3. `NormalizedBid`

Connector가 원본 응답을 그대로 보존한 뒤(`bid_revisions.raw_payload`, MinIO 원본) 만든 통일 형태. [[07-DATA-PIPELINE|07 수집]]의 통일 필드와 이름이 같다.

```ts
interface NormalizedBid {
  schemaVersion: "normalized-bid/v0.2";
  source: string;               // 공고를 만드는 registry 키(§8): "fixture" | "g2b-bid-notice" | "g2b-pre-spec" | "g2b-order-plan"
  noticeId: string;             // 차수를 뺀 공고번호. fixture 예: "DEMO-2026-0010", live: bidNtceNo
  revision: number;             // 1부터. 정정·차수·내용 변경마다 +1 (07 변경 감지)
  amendmentNo?: string;         // 원본의 차수. 예: "02" (원본 공고번호 "DEMO-2026-0010-02"). live: bidNtceOrd
  planRef?: string;             // 발주계획 공개 식별자. fixture 예: "DEMO-PLAN-0042", live: orderPlanUntyNo. PLAN↔PRE_SPEC↔NOTICE 연결 키
  preSpecRef?: string;          // 사전규격 등록번호. live: bfSpecRgstNo. planRef와 함께 단계를 잇는다(07 §4)
  stage: "PLAN" | "PRE_SPEC" | "NOTICE";
  status: "OPEN" | "AMENDED" | "CANCELLED" | "CLOSED";
  title: string;
  agency: string | null;
  budgetKrw: string | null;     // KRW 정수 문자열. 단위 환산 후
  noticeDate: string | null;    // ISO8601 UTC (원본 Asia/Seoul → UTC)
  deadlineAt: string | null;    // ISO8601 UTC
  sourceUrl: string;            // fixture 예: "https://demo.sol-radar.invalid/notices/FX-02"
  content: string;              // 본문 텍스트. §5.1 정규화 적용
  attachments: { name: string; url: string; mimeType?: string; sizeBytes?: number }[];
  structuredQualifications: StructuredRequirement[];  // 공고 API 구조화 자격. fixture·사전규격·발주계획은 빈 배열일 수 있다
  original: {                   // 정규화 전 원본 문자열. 감사·디버그용
    noticeNo?: string; budget?: string; noticeDate?: string; deadline?: string; stage?: string; status?: string;
  };
  normalizationNotes?: string[];  // 정규화 가정 기록. 예: 시각 없는 날짜를 KST 18:00으로 간주, budgetKrw에 asignBdgtAmt를 씀(07 §3)
  isDemo: boolean;              // fixture 출처면 true, live(g2b-*)면 false. UI에 DEMO 배지
  fetchedAt: string;            // ISO8601 UTC
  checksum: string;             // sha256(canonical JSON, fetchedAt·checksum 제외)
}

/** 공고 API가 구조화 필드로 준 자격 조건 한 행. 04 bid_structured_requirements 한 행과 같다 */
interface StructuredRequirement {
  kind: "LICENSE_LIMIT" | "PERMITTED_INDUSTRY" | "PARTICIPATION_REGION" | "REGIONAL_JOINT_CONTRACT";
  code: string | null;          // 업종 코드 등. 업종 코드 마스터(g2b-industry-master) 사전으로 이름과 잇는다
  name: string | null;          // 예: 면허제한명(lcnsLmtNm), 참가가능지역명(prtcptPsblRgnNm)
  value: Record<string, unknown>;  // 그 행의 원본 필드. 담당자 필드는 넣지 않는다
  sourceOperation: string;      // 값을 받은 오퍼레이션. 예: "getBidPblancListInfoLicenseLimit"
}
```

필수/선택:

|구분|필드|비어 있을 때|
|---|---|---|
|필수|`source`, `noticeId`, `title`, `sourceUrl`, `stage`, `fetchedAt`|레코드 격리(`ingest_errors`), 적재하지 않음|
|nullable|`budgetKrw`, `deadlineAt`, `noticeDate`, `agency`|값이 없으면 null. `original`에 원본 문자열은 남긴다|
|빈 값 허용|`content`, `attachments`|본문이 없으면 빈 문자열, 첨부가 없으면 빈 배열|
|선택 키|`amendmentNo`, `planRef`, `preSpecRef`, `normalizationNotes`|값이 없으면 키 생략(null을 넣지 않는다)|
|선택(빈 배열)|`structuredQualifications`|빈 배열. 규칙 엔진은 추출값으로 판정한다|

`checksum`은 canonical JSON(키 정렬, 공백 없음, `fetchedAt`·`checksum` 제외)의 sha256이다. 같은 `source+noticeId`에서 checksum이 바뀌면 새 revision이다.

- live 공고의 원본 필드 → `NormalizedBid` 매핑은 [[07-DATA-PIPELINE|07 수집]] §3.1이다.
- **개인정보**: 공공 API 응답의 담당자 필드(이름·전화·이메일)는 `NormalizedBid`·`StructuredRequirement.value`에 넣지 않는다. 담당자 필드가 든 원본 응답은 사설 MinIO에만 보관한다([[04-DATABASE|04 DB]], [[09-SECURITY|09 보안]]).
- **`seq`**: `StructuredRequirement`에는 `seq`가 없다. 수집(Connector)은 `seq` 없이 내고 `structuredQualifications`의 순서를 결정적으로(안정 정렬) 만든다. 분석 쪽 변환이 배열 index(0부터)로 `seq`([[04-DATABASE|04 DB]] `bid_structured_requirements.seq`)를 채운다([[16-DECISIONS|ADR-030]] B13).
- **`status` 매핑**: 등록·재공고 → `OPEN`, 변경 → `AMENDED`, 취소 → `CANCELLED`. `CLOSED`는 정규화가 만들지 않고(checksum이 시간에 따라 바뀌지 않게) 조회할 때 `deadlineAt`으로 계산한다. 매핑에 없는 원본 값은 §6 격리다. fixture 레코드에 `status`가 없고 revision ≥ 2면 `AMENDED`다([[07-DATA-PIPELINE|07 수집]] §3.1·§6.5, [[16-DECISIONS|ADR-030]] B14). 목록의 기본 상태 필터와 취소 공고 표시는 [[05-API-SPEC|05 API]] §3이다.
- **API 구조화 필드 우선**: 같은 조건을 API 구조화 필드(`structuredQualifications`, 금액 `budgetKrw`, 마감 `deadlineAt`)와 Qwen 추출이 둘 다 주면 API 구조화 필드가 우선이다. 두 값이 다르면 그 필드를 `CONFLICTED`로 두고 사람이 본다(§4). 이때 API 쪽 근거는 `EvidenceRef(kind=API_FIELD)`로 남긴다(§2). 규칙 엔진의 판정 방식은 [[08-SCORING|08 점수]] §5.1.

> [!warning] 미검증 가정
> `structuredQualifications`의 원천 필드는 2026-10-19 C1 ①에서 실제 응답으로 확인했다([C1 API 증거](evidence/phase-0/external-deps-api-20261019.md) §5·§10, 녹음 응답 `fixtures/recorded/15129394/`). 면허제한·참가가능지역 필드는 목록 응답에 없고 보조 조회에만 있다. 여부 플래그 `indstrytyLmtYn`·`bidPrtcptLmtYn`은 목록 응답에 있다. 남은 것은 두 가지다. 여부 플래그를 어느 `kind`·필드에 담을지 정하지 않았다. 면허제한이 여러 행일 때의 뜻도 미검증이다. 응답에 AND/OR 필드는 없고 `lmtGrpNo`(그룹)·`lmtSno`(일련번호)만 있으며, "그룹 안은 AND, 그룹끼리는 OR"로 읽히지만 확인하지 않았다([[16-DECISIONS|16 ADR]] 미결정 19번). 확인 전에는 면허제한이 여러 행이면 규칙이 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`)로 둔다.

## 4. `RequirementExtraction` 요약

전체 스키마와 예시는 [[03-AI-PIPELINE|03 AI 파이프라인]] §4.1. 여기서는 규칙 엔진이 읽는 필드만 적는다.

|필드|타입|규칙 엔진 사용처|
|---|---|---|
|`requiredSkills`, `preferredSkills`|`ExtractedField<string[]>`|기술 스택 적합 요소|
|`qualifications[]`|`ExtractedField<QualificationRequirement[]>`|필수자격 판정(`qualification_checks`). 같은 조건의 `NormalizedBid.structuredQualifications`가 있으면 그것이 우선(`basis=API_FIELD`)|
|`pastPerformance[]`|`ExtractedField<PastPerformanceRequirement[]>`|유사 수행 실적 요소|
|`staffing[]`|`ExtractedField<StaffingRequirement[]>`|인력 가용성 요소|
|`budgetKrw`|`ExtractedField<string>`|규모 적합성. `NormalizedBid.budgetKrw`와 다르면 `CONFLICTED`|
|`deadlineAt`|`ExtractedField<string>`|마감 알림. `NormalizedBid.deadlineAt` 우선|
|`restrictions[]`|`ExtractedField<string[]>`|지역·기업규모 제한 → 필수자격 후보. 참가가능지역·지역의무공동도급은 `structuredQualifications`가 있으면 그것이 우선|

## 5. 인용 검증 알고리즘

AI gateway가 `RequirementExtraction`의 모든 `EvidenceRef`에 대해 실행한다. 결과는 `match`에 기록한다. §5.1~§5.3은 `kind=TEXT` 근거에만 적용하고, `kind=API_FIELD` 근거는 §5.4로 검증한다.

### 5.1 텍스트 정규화 `norm(s)`
1. 유니코드 NFKC.
2. 제로폭 문자(U+200B~U+200D, U+FEFF) 제거.
3. 연속 공백·줄바꿈·탭을 공백 1개로. 앞뒤 공백 제거.
4. 전각 괄호·따옴표·쉼표를 반각으로. 숫자 사이 쉼표(`450,000,000`)는 유지.

`charStart`·`charEnd`는 `norm(문서 전체)` 기준 오프셋이다. 추출기 입력도 같은 정규화 텍스트를 쓰므로 오프셋이 일치한다.

"문서 전체"는 근거의 출처마다 다르다.
- 공고 본문(`documentId=null`): `NormalizedBid.content`.
- 첨부(`documentId` 있음): gateway `POST /parse`가 돌려준 `ParseResult.text`([[03-AI-PIPELINE|03 AI 파이프라인]]). 블록을 순서대로 직렬화한 평문이고, 표는 행마다 한 줄로 셀 사이에 ` | `(공백·세로 막대·공백)를 넣어 직렬화되어 있다. 그래서 표 안 문장도 같은 절차로 검증한다. `page`의 범위는 `ParseResult.pages[].charOffset`으로 정한다.
- 파싱에 실패했거나(`FAILED`·`UNSUPPORTED`) 다운로드하지 못한 첨부는 텍스트가 없다. 그 문서를 가리키는 인용은 검증을 통과할 수 없으므로 값은 `UNKNOWN`이 된다. 실패한 문서의 내용을 추측해 채우지 않는다([[07-DATA-PIPELINE|07 수집]] §2.6).
- 데이터셋 내보내기의 개인정보 마스킹은 전화·이메일 패턴을 같은 길이의 문자로 바꾸므로 오프셋이 바뀌지 않는다([[21-MODEL-TRAINING|21 모델 학습]] §3.6).

**`ParseResult` 오프셋 규칙** ([[16-DECISIONS|ADR-020]]): `/parse`는 블록마다 위 `norm`을 적용한 뒤 직렬화해 `text`를 만든다. 그래서 `ParseResult.text`는 이미 정규화된 텍스트이고(`norm(text) = text`), `pages[].charOffset`·`blocks`·표 셀의 `charStart/charEnd`는 모두 이 텍스트 기준이다. 별도 변환 표는 두지 않는다. 표의 행 구분 줄바꿈은 3단계에서 공백이 되지만 셀 구분자 ` | `와 `blocks`의 셀 오프셋으로 구조를 유지한다. 원본 파일은 MinIO에 그대로 둔다.

### 5.2 절차

```text
입력: ref(EvidenceRef), doc = norm(해당 revision·document 텍스트), q = norm(ref.quotedText)
0. len(q) < 5 또는 len(q) > 300           → FAILED (사유 QUOTE_LENGTH)
1. ref.page 있음 → 검색 범위를 해당 페이지 텍스트로 제한. 실패 시 2~4를 문서 전체로 재시도하고 note "PAGE_MISMATCH"
2. charStart/charEnd 있음 and doc[charStart:charEnd] == q → EXACT
3. doc.find(q)
     1회 발견        → NORMALIZED (charStart/charEnd를 찾은 위치로 채움)
     2회 이상 발견    → NORMALIZED, 첫 위치 채움, note "MULTIPLE_OCCURRENCES"
4. 창(window) 탐색: 길이 len(q)±10% 구간을 1자씩 이동하며 유사도 계산
     ratio = 1 - levenshtein(q, window) / max(len(q), len(window))
     최대 ratio >= CITATION_FUZZY_MIN_RATIO(기본 0.92) → FUZZY (오프셋 채움)
5. 그 외 → FAILED (사유 NOT_FOUND)
```

- 4단계는 비용이 크다. `len(doc) > 200,000`자면 3단계까지만 하고, 4단계는 `q`의 앞 20자를 `find`로 먼저 좁힌 뒤 ±2,000자 범위에서만 수행한다.
- 임계값은 env `CITATION_FUZZY_MIN_RATIO`로 조정하고 값은 `score_runs.model_metadata.citation.fuzzyMinRatio`에 기록한다.

### 5.3 실패 시 상태 전이

|상황|처리|
|---|---|
|어떤 `EvidenceRef`가 `FAILED`|해당 ref는 `evidence`에 남기되 `match=FAILED`. UI는 표시하지 않고 카운트만 보여 준다|
|필드의 유효 근거(`match != FAILED`)가 0개가 됨|`value=null`, `state=UNKNOWN`, `note="CITATION_FAILED"`. 분석 결과 `reviewFlags`에 `CITATION_FAILED` 추가|
|필드 유효 근거가 1개 이상 남음|`KNOWN` 유지|
|한 추출의 전체 ref 중 FAILED 비율 > 50%|`requirement_extractions.status=PENDING_REVIEW`, 분석은 진행하되 `reviewFlags`에 `EXTRACTION_LOW_CONFIDENCE`|

인용 검증은 결정론적이다. 같은 입력에 같은 결과가 나오며, 단위 테스트로 EXACT/NORMALIZED/FUZZY/FAILED 각 경로를 고정한다([[11-TESTING|11 테스트]]).

> [!warning] 미검증 가정
> 임계값 0.92와 창 크기 ±10%는 한국어 공고 텍스트로 측정한 값이 아니다. 검증 방법: fixture 20건의 추출 결과에서 사람이 맞다고 표시한 인용 50건 이상을 모아 FUZZY 판정의 정밀도를 재고, 오탐이 생기면 임계값을 올린다.

### 5.4 API 구조화 필드 근거 검증 (`kind=API_FIELD`)

API 구조화 필드를 근거로 쓴 판정(`basis=API_FIELD`)은 텍스트 위치가 없으므로 §5.2를 쓰지 않는다. 대신 해당 revision의 `rawPayload`(보조 조회 응답의 필드는 [[04-DATABASE|04 DB]] `bid_structured_requirements.value`에 보존)에서 `apiSource`·`apiField`가 가리키는 필드 값이 `quotedText`와 같은지 확인한다.

- 같으면 `match=EXACT`, 다르거나 필드가 없으면 `match=FAILED`다. 실패했을 때의 상태 전이는 §5.3과 같다.
- `documentId`·`page`·`charStart`·`charEnd`가 null이 아니거나 `apiField`·`apiSource`가 비어 있으면 형식 오류로 `FAILED`다.
- §5.2 0단계의 길이 규칙(5~300자)은 적용하지 않는다. 필드 값은 짧을 수 있다(예: 지역명).
- 검증은 원본 응답을 가진 worker가 한다. gateway는 DB·MinIO에 접근하지 않는다.
- 면허제한처럼 응답이 여러 행이면 행마다 `EvidenceRef` 하나를 만들고 행 단위로 대조한다. 여러 행의 의미(AND·OR)는 미검증이라 그 판정은 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`)로 둔다([[16-DECISIONS|16 ADR]] 미결정 19번).
- 이 검증도 결정론적이고 단위 테스트로 고정한다.

## 6. 데이터 검증·격리

|검사|실패 시|
|---|---|
|필수 필드 누락(§3)|레코드 격리. `ingest_errors`에 `error_code=MISSING_REQUIRED_FIELD`, `source_key=source:noticeId`|
|`NormalizedBid` 스키마 위반(타입·ENUM)|레코드 격리. `error_code=SCHEMA_INVALID`|
|금액 파싱 실패(숫자 아님, 단위 불명)|`budgetKrw=null`, `original.budget` 보존, `error_code=BUDGET_UNPARSED`(경고, 적재는 함)|
|날짜 파싱 실패|`deadlineAt=null`, `original.deadline` 보존, 경고 `DATE_UNPARSED`|
|마감이 공고일보다 이전|적재하되 `status` 그대로, 경고 `DATE_ORDER`|
|본문 인코딩 깨짐(치환 문자 비율 > 5%)|`content` 보존, 경고 `ENCODING_DEGRADED`, 추출 상태 `PENDING_REVIEW`|
|외부 API 429|Retry-After 후 재시도, `summary.retried` +1. 소진 시 `error_code=RATE_LIMITED`|
|같은 checksum 재수집|적재 생략, `summary.skippedDuplicate` +1 (오류 아님)|

첨부 다운로드·파싱 실패와 공공 API 오류·호출 예산(90% 도달 시 보조 조회 중단)의 처리는 [[07-DATA-PIPELINE|07 수집]] §2.2·§2.6과 [[03-AI-PIPELINE|03 AI 파이프라인]] §8·§10.5가 정본이다. 이때 `ingest_errors.error_code`는 파싱 실패면 `ATTACHMENT_PARSE_FAILED`, 정책상 다운로드 거부(allowlist·크기·MIME, [[09-SECURITY|09 보안]])면 `ATTACHMENT_REJECTED`다. 값 목록은 [[04-DATABASE|04 DB]] `ingest_errors`다.

격리된 레코드는 삭제하지 않고 `ingest_errors.redacted_detail`에 PII 없는 요약만 남긴다. 공공 API 응답의 담당자 필드와 서비스키(`G2B_*_SERVICE_KEY` 4개, 요청 URL의 쿼리 파라미터 포함)는 `redacted_detail`·로그에 넣지 않는다. 재실행하면 같은 `job_key`로 멱등 처리한다. 수집 결과 집계는 `ingest_runs.summary = {created, changed, cancelled, skippedDuplicate, quarantined, retried}`이며 [[05-API-SPEC|05 API 명세]] `IngestionRun.summary`와 같다. 검증·격리와 `ingest_runs`·`ingest_errors` 쓰기는 수집 worker(`web/worker`)가 service role로 한다([[07-DATA-PIPELINE|07 수집]]).

여기서 "격리"는 잘못된 레코드를 적재하지 않고 따로 두는 것(quarantine)이다. 조직 간 데이터 격리는 다른 장치다. 조직 소유 데이터는 `org_id`를 갖고, DB의 RLS 정책(`org_id in (select public.my_org_ids())`)이 다른 조직의 행을 보이지 않게 한다. 그래서 API는 다른 조직 자원에 `404`를 낸다. 공고와 이 절의 수집 기록은 조직 소유가 없는 공용 데이터다([[04-DATABASE|04 DB]] §1·§3, [[09-SECURITY|09 보안]]).

## 7. 시점 일치

- 백테스트는 의사결정 시점 이전에 발행·수집된 revision만 쓴다. `bid_revisions.fetched_at <= 결정 시각`.
- 낙찰·계약 결과를 특징량에 합치지 않는다. 결과 라벨은 별도 테이블로 두고 조인은 평가 코드에서만 한다.
- 모델·프롬프트·점수 규칙이 바뀌면 기존 `score_runs`를 덮어쓰지 않고 새 run을 만든다. 비교는 `algorithm_version`, `prompt_hash`로 한다.
- `AnalysisInput` 스냅샷에는 사용한 `revisionId`, `profileRevision`, `extractionId`와 점수 계산 대상 인력·기간 배정·기준 시각(`team.members`, `team.assignments`, `team.asOf`)이 들어가므로 같은 입력으로 재실행할 수 있다. 인력 이름·성별·사진은 입력에서 제외한다([[04-DATABASE]]·[[08-SCORING]], ADR-019).

## 8. 수집 소스 registry

`infra/sources/registry.yaml`에 소스마다 아래 항목을 둔다([[16-DECISIONS|ADR-020]]). `OfficialApiConnector`는 이 파일에 등록한 엔드포인트만 부르고, 어디서도 엔드포인트를 지어내지 않는다. 등록이 끝나지 않은 소스(`approvalStatus`가 `APPROVED`가 아니거나 `endpoint`·`fieldMapping`이 비어 있음)는 부르지 않는다. 관리자 화면 `GET /api/v1/admin/sources`(`SourceStatus`, [[05-API-SPEC|05 API 명세]])가 키별 상태·오늘 호출량·최근 오류를 보여 준다.

|키|예시|비고|
|---|---|---|
|`key`|`g2b-bid-notice`|아래 표의 9개. 공고를 만드는 키(`fixture`·`g2b-bid-notice`·`g2b-pre-spec`·`g2b-order-plan`)만 `NormalizedBid.source`·`bid_notices.source`에 들어간다([[04-DATABASE\|04 DB]] `bid_source`). 나머지는 보조 조회·코드 마스터·첨부 다운로드 키로 `ingest_errors.source_key`와 호출 예산에 쓴다|
|`displayName`|나라장터 입찰공고정보서비스|서비스 이름 수준만 적는다|
|`provider`|조달청 / data.go.kr|—|
|`serviceId`|`15129394`|data.go.kr 서비스 ID. 호출 예산 카운터 `quota:{serviceId}:{YYYYMMDD}`의 키([[07-DATA-PIPELINE\|07 수집]] §2.2)|
|`serviceKeyEnv`|`G2B_BID_NOTICE_SERVICE_KEY`|그 소스가 쓰는 서비스키의 env **이름**(값이 아니다). 같은 data.go.kr 서비스의 소스는 같은 env를 쓴다. `OfficialApiConnector`는 이 env만 읽고 다른 서비스의 키로 대체하지 않는다([[07-DATA-PIPELINE\|07 수집]] §2.2, [[16-DECISIONS\|ADR-022]]). `g2b-attachment`·`fixture`는 비운다|
|`approvalStatus`|`NOT_REQUESTED` / `PENDING` / `APPROVED`|활용신청 상태. data.go.kr 4개 서비스는 2026-10-18 서비스키를 받아 `APPROVED`다(2026-10-19 C1 ① 실호출 `resultCode 00`)|
|`endpoint`|기본 URL + 오퍼레이션|data.go.kr 명세로 확인한 값(아래 표)|
|`method`|`GET`|입찰공고정보서비스 참고문서 v1.2의 인터페이스 표준 "REST (GET)"(2026-10-16 확인). 2026-10-19 C1 ①에서 4개 서비스 모두 GET으로 실제 응답을 받았다|
|`quota`|개발계정 1,000/일, 30 tps|일 한도는 명세로 확인. 30 tps는 참고문서 값. 부족하면 운영계정(자동승인)|
|`fieldMapping`|원본 필드 → `NormalizedBid` 필드|초안은 [[07-DATA-PIPELINE\|07 수집]] §3.1. C1 ① 실제 응답(설계와 다른 점은 [C1 API 증거](evidence/phase-0/external-deps-api-20261019.md) §10)으로 C3에서 확정|
|`changeNoticeUrl`|—|명세 변경 공지|
|`redistributionLimit`|API 데이터: 이용허락범위 제한 없음 / 첨부 원문: 미확인|첨부 원문의 저작권·재배포·학습 사용은 [[16-DECISIONS\|16 ADR]] 미결정 18번|
|`sampleResponses`|`fixtures/recorded/<serviceId>/*.masked.json` 경로|C1 ①(2026-10-19)에서 받은 실제 응답의 녹음본(14파일). 저장소에는 담당자 필드를 마스킹한 사본만 둔다([[09-SECURITY\|09 보안]])|
|`lastVerifiedAt`|`2026-10-19`|검증일. 90일 지나면 경고. C1 ① 실제 응답 확인일이다|

등록할 소스(설계 확정값 2026-10-16, `approvalStatus` 2026-10-19 갱신):

|`key`|서비스 (ID)|`endpoint` (기본 URL + 오퍼레이션)|호출 시점|`approvalStatus`|`serviceKeyEnv`|
|---|---|---|---|---|---|
|`g2b-bid-notice`|입찰공고정보서비스 (15129394)|`https://apis.data.go.kr/1230000/ad/BidPublicInfoService` + `getBidPblancListInfoServc`, `getBidPblancListInfoChgHstryServc`|일정 실행·수동 실행|`APPROVED`|`G2B_BID_NOTICE_SERVICE_KEY`|
|`g2b-bid-license-limit`|입찰공고정보서비스 (15129394)|같은 기본 URL + `getBidPblancListInfoLicenseLimit`|새 revision마다|`APPROVED`|`G2B_BID_NOTICE_SERVICE_KEY`|
|`g2b-bid-region`|입찰공고정보서비스 (15129394)|같은 기본 URL + `getBidPblancListInfoPrtcptPsblRgn`|새 revision마다|`APPROVED`|`G2B_BID_NOTICE_SERVICE_KEY`|
|`g2b-bid-eorder-attach`|입찰공고정보서비스 (15129394)|같은 기본 URL + `getBidPblancListInfoEorderAtchFileInfo`|새 revision마다|`APPROVED`|`G2B_BID_NOTICE_SERVICE_KEY`|
|`g2b-pre-spec`|사전규격정보서비스 (15129437)|`/1230000/ao/HrcspSsstndrdInfoService` + `getPublicPrcureThngInfoServc`|일정 실행|`APPROVED`|`G2B_PRE_SPEC_SERVICE_KEY`|
|`g2b-order-plan`|발주계획현황서비스 (15129462)|`/1230000/ao/OrderPlanSttusService` + `getOrderPlanSttusListServc`|하루 1회|`APPROVED`|`G2B_ORDER_PLAN_SERVICE_KEY`|
|`g2b-industry-master`|업종 및 근거법규 (15129467)|`/1230000/ao/IndstrytyBaseLawrgltInfoService` + `getIndstrytyBaseLawrgltInfoList`|수동(사전 갱신)|`APPROVED`|`G2B_INDUSTRY_MASTER_SERVICE_KEY`|
|`g2b-attachment`|g2b 첨부 다운로드(data.go.kr 서비스 아님)|`https://www.g2b.go.kr`의 `/pn/` 아래 다운로드 엔드포인트(공식 문서 예시, [[07-DATA-PIPELINE\|07 수집]] §2.4)|documents job|`NOT_REQUESTED`|—|
|`fixture`|fixture 20건(`FX-01`~`FX-20`)|— (네트워크 호출 없음)|seed·수동 수집|`APPROVED`|—|

- 기본 URL은 `https://apis.data.go.kr`이다(서비스키가 쿼리 파라미터로 가고 2026-10-19 실호출도 https였다, [[16-DECISIONS|ADR-030]] B16). 경로만 적은 기본 URL은 명세에 기록된 경로 그대로다.
- `infra/sources/registry.yaml`은 구현돼 있다. worker(`web/worker/main.ts`)가 수집 도메인의 `loadSourceRegistry`로 읽고 승인·필드 매핑·서비스키를 확인한 뒤 Connector에 등록 endpoint를 전달한다. Connector는 endpoint를 생성자로 받아 registry 로딩과 떼어 둔다(B16).
- `g2b-attachment`는 data.go.kr 활용신청 대상이 아니다. 로그인·세션 없이 익명 GET으로 받아진다(C1 ② B2, 2026-10-19 공고 3건, 리다이렉트 0회). 남은 것은 이용약관상 자동 다운로드가 허용되는지다(미결정 16번). 그 확인 뒤 `approvalStatus`와 `quota`의 뜻을 정한다.

> [!success] 검증됨 (명세 2026-10-16, 실제 응답 2026-10-19 — data.go.kr 서비스 페이지 Swagger·참고문서, C1 ① 실호출)
> 서비스 ID·기본 URL·오퍼레이션·개발계정 일 1,000 한도는 아래 서비스 페이지의 명세에서 확인했다. 2026-10-19 C1 ①에서 4개 서비스 모두 서비스키로 실제 응답(`resultCode 00`)을 받았고, 마스킹한 녹음 응답을 `fixtures/recorded/`에 두었다. 호출 로그와 설계와 다른 점 8건(키 형식, 오류 봉투, 보조 조회의 `inqryDiv=2`, `infoBizYn` 요청 필터 무시 등)은 [C1 API 증거](evidence/phase-0/external-deps-api-20261019.md)에 있다. 이 콜아웃이 data.go.kr 검증 사실의 정본이다.
> - 입찰공고: https://www.data.go.kr/data/15129394/openapi.do
> - 사전규격: https://www.data.go.kr/data/15129437/openapi.do
> - 발주계획: https://www.data.go.kr/data/15129462/openapi.do
> - 업종 및 근거법규: https://www.data.go.kr/data/15129467/openapi.do

> [!warning] 미검증 가정
> 조회 기간 상한(8일까지만 확인), 키 오류 응답(`resultCode` 30·31·22)의 형식, 면허제한 여러 행의 뜻(§3), `g2b-attachment` 자동 다운로드의 약관상 허용 여부는 확인하지 않았다. `infra/sources/registry.yaml`(녹음 응답으로 채운 `fieldMapping`·`sampleResponses`)과 `OfficialApiConnector` 계약 시험(`web/server/ingestion/official-api-connector.test.ts`·`source-registry.test.ts`)은 있다([[16-DECISIONS|16 ADR]] 미결정 1·16번).

## 9. 수용 기준

- `NormalizedBid` 스키마 검증(zod)을 fixture 20건 전부 통과하고, 같은 fixture를 두 번 적재해도 revision이 늘지 않는다(Vitest, `web/server/ingestion/*.test.ts`).
- `ExtractedField`의 `KNOWN`은 유효 근거 없이 저장될 수 없다(DB 적재 전 gateway 검증 + API 응답 검증 테스트).
- 인용 검증 4경로(EXACT/NORMALIZED/FUZZY/FAILED)와 §5.3 전이가 단위 테스트로 고정된다. `kind=API_FIELD` 근거의 원본 필드 대조(§5.4)도 일치·불일치·형식 오류 경로를 단위 테스트로 고정한다.
- `NOT_SATISFIED` 판정은 공고 쪽 `EvidenceRef`와 회사 쪽 `CompanyEvidenceRef`가 둘 다 있어야 저장된다(§2).
- `UNKNOWN`이 0이나 기본값으로 바뀌는 경로가 코드에 없다(리뷰 체크리스트 항목).

## 관련 문서

- [[03-AI-PIPELINE|03 AI 파이프라인]] — `RequirementExtraction` 전체 스키마, 프롬프트
- [[04-DATABASE|04 DB]] — 저장 테이블과 ENUM
- [[05-API-SPEC|05 API 명세]] — API 요청·응답 스키마(zod)
- [[07-DATA-PIPELINE|07 수집]] — Connector와 fixture
- [[08-SCORING|08 점수]] — missing 정책, 판정 라벨·사유 코드
- [[09-SECURITY|09 보안]] — 공공 API 응답 개인정보, 서비스키
- [[11-TESTING|11 테스트]] — 골든 시나리오
- [[16-DECISIONS|16 ADR]] — ADR-020, 미결정 1·16·18·19번
- [[21-MODEL-TRAINING|21 모델 학습]] — `EvalItem`, 데이터셋 마스킹
