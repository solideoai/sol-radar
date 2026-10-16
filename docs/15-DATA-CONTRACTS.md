---
title: "15. 데이터 계약·품질·근거"
doc: "15"
status: review
tags:
  - sol-radar
  - pipeline
  - db
updated: 2026-10-16
---

# 15. 데이터 계약·품질·근거

이 문서는 수집(07) → 추출(03) → 저장(04) → API(05) 사이를 오가는 **공통 데이터 타입의 단일 정의**다. 다른 문서는 여기 이름을 그대로 쓴다.

> [!tip] 심사 포인트
> AI가 만든 모든 값은 `state`(알고 있음/모름/해당 없음/상충)와 원문 인용(`EvidenceRef`)을 함께 가진다. 인용은 원문과 문자열 대조로 검증하고, 실패하면 값을 버린다. "근거 없는 값은 없다"가 이 계약의 핵심이다.

## 1. 계약 이름과 정의 위치

|계약|정의 위치|생산자|소비자|
|---|---|---|---|
|`FieldState`, `EvidenceRef`, `ExtractedField<T>`|이 문서 §2|AI gateway|규칙 엔진, API, UI|
|`NormalizedBid`|이 문서 §3|Connector(07)|DB `bid_revisions.normalized`, 추출기|
|`RequirementExtraction`|[[03-AI-PIPELINE\|03 AI 파이프라인]] §4.1|Qwen 추출기|규칙 엔진, `requirement_extractions.payload`|
|`AnalysisInput`|[[04-DATABASE\|04 DB]] `score_runs.input_snapshot`|Worker|재현·백테스트|
|`AnalysisResult`, `BidDetail` 등 API DTO|[[05-API-SPEC\|05 API 명세]] §4|NestJS|Next.js|
|소스 registry|이 문서 §8|운영자|Connector|

스키마 버전 문자열은 `"<이름>/v<major>.<minor>"` 형식이다. 필드를 지우거나 의미를 바꾸면 major를 올리고, 선택 필드 추가는 minor를 올린다. 저장된 JSONB에는 항상 `schemaVersion`이 들어간다.

## 2. 공통 타입

```ts
/** 값의 인식 상태. UI는 네 상태를 색이 아닌 아이콘+텍스트로 구분한다 */
type FieldState = "KNOWN" | "UNKNOWN" | "NOT_APPLICABLE" | "CONFLICTED";

/** 인용 검증 결과 (§5) */
type CitationMatch = "EXACT" | "NORMALIZED" | "FUZZY" | "FAILED";

interface EvidenceRef {
  documentId: string | null;  // bid_documents.id. null이면 공고 본문(bid_revisions.normalized.content)
  revisionId: string;         // bid_revisions.id. 인용이 가리키는 원문 버전
  page?: number;              // 1부터. 페이지 구분이 있는 첨부(PDF)만
  charStart?: number;         // 정규화 텍스트(§5.1) 기준 0-based, 구간은 [charStart, charEnd)
  charEnd?: number;
  quotedText: string;         // 원문 그대로 5~300자. 요약·의역 금지
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
|`UNKNOWN`|null|0개|원문에 없음, 또는 인용 검증 전부 실패|
|`NOT_APPLICABLE`|null|0~1개|해당 항목이 이 공고 유형에 없음(예: 발주계획에는 마감 없음)|
|`CONFLICTED`|null|2개 이상|원문 내 두 값이 다름(본문 예산 ≠ 첨부 예산). `note`에 두 값을 적는다|

`UNKNOWN`을 0, 빈 문자열, 미래 날짜, 기본값으로 바꾸지 않는다. 규칙 엔진은 `UNKNOWN`·`CONFLICTED`를 `NEEDS_REVIEW` 또는 `missingFactors`로 처리한다([[08-SCORING|08 점수]]).

## 3. `NormalizedBid`

Connector가 원본 응답을 그대로 보존한 뒤(`bid_revisions.raw_payload`, MinIO 원본) 만든 통일 형태. [[07-DATA-PIPELINE|07 수집]]의 통일 필드와 이름이 같다.

```ts
interface NormalizedBid {
  schemaVersion: "normalized-bid/v0.1";
  source: string;               // "fixture"(데모) 또는 registry 키. 예: "g2b-bid-notice"
  noticeId: string;             // 차수를 뺀 공고번호. 예: "DEMO-2026-0010"
  revision: number;             // 1부터. 정정·차수·내용 변경마다 +1 (07 변경 감지)
  amendmentNo?: string;         // 원본의 차수. 예: "02" (원본 공고번호 "DEMO-2026-0010-02")
  planRef?: string;             // 발주계획 공개 식별자. 예: "DEMO-PLAN-0042". PLAN↔PRE_SPEC↔NOTICE 연결 키
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
  original: {                   // 정규화 전 원본 문자열. 감사·디버그용
    noticeNo?: string; budget?: string; noticeDate?: string; deadline?: string; stage?: string; status?: string;
  };
  isDemo: boolean;              // fixture 출처면 true. UI에 DEMO 배지
  fetchedAt: string;            // ISO8601 UTC
  checksum: string;             // sha256(canonical JSON, fetchedAt·checksum 제외)
}
```

필수/선택:

|구분|필드|비어 있을 때|
|---|---|---|
|필수|`source`, `noticeId`, `title`, `sourceUrl`, `stage`, `fetchedAt`|레코드 격리(`ingest_errors`), 적재하지 않음|
|선택|`budgetKrw`, `deadlineAt`, `noticeDate`, `agency`, `content`, `attachments`|null 유지. `original`에 원본 문자열은 남긴다|

`checksum`은 canonical JSON(키 정렬, 공백 없음, `fetchedAt`·`checksum` 제외)의 sha256이다. 같은 `source+noticeId`에서 checksum이 바뀌면 새 revision이다.

## 4. `RequirementExtraction` 요약

전체 스키마와 예시는 [[03-AI-PIPELINE|03 AI 파이프라인]] §4.1. 여기서는 규칙 엔진이 읽는 필드만 적는다.

|필드|타입|규칙 엔진 사용처|
|---|---|---|
|`requiredSkills`, `preferredSkills`|`ExtractedField<string[]>`|기술 스택 적합 요소|
|`qualifications[]`|`ExtractedField<QualificationRequirement[]>`|필수자격 판정(`qualification_checks`)|
|`pastPerformance[]`|`ExtractedField<PastPerformanceRequirement[]>`|유사 수행 실적 요소|
|`staffing[]`|`ExtractedField<StaffingRequirement[]>`|인력 가용성 요소|
|`budgetKrw`|`ExtractedField<string>`|규모 적합성. `NormalizedBid.budgetKrw`와 다르면 `CONFLICTED`|
|`deadlineAt`|`ExtractedField<string>`|마감 알림. `NormalizedBid.deadlineAt` 우선|
|`restrictions[]`|`ExtractedField<string[]>`|지역·기업규모 제한 → 필수자격 후보|

구조화 메타데이터(`NormalizedBid`)와 추출값이 다르면 구조화 값이 우선하고, 추출 필드는 `CONFLICTED`로 남겨 사람이 본다.

## 5. 인용 검증 알고리즘

AI gateway가 `RequirementExtraction`의 모든 `EvidenceRef`에 대해 실행한다. 결과는 `match`에 기록한다.

### 5.1 텍스트 정규화 `norm(s)`
1. 유니코드 NFKC.
2. 제로폭 문자(U+200B~U+200D, U+FEFF) 제거.
3. 연속 공백·줄바꿈·탭을 공백 1개로. 앞뒤 공백 제거.
4. 전각 괄호·따옴표·쉼표를 반각으로. 숫자 사이 쉼표(`450,000,000`)는 유지.

`charStart`·`charEnd`는 `norm(문서 전체)` 기준 오프셋이다. 추출기 입력도 같은 정규화 텍스트를 쓰므로 오프셋이 일치한다.

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

## 6. 데이터 검증·격리

|검사|실패 시|
|---|---|
|필수 필드 누락(§3)|레코드 격리. `ingest_errors`에 `error_code=MISSING_REQUIRED_FIELD`, `source_key=source:noticeId`|
|`NormalizedBid` 스키마 위반(타입·ENUM)|레코드 격리. `error_code=SCHEMA_INVALID`|
|금액 파싱 실패(숫자 아님, 단위 불명)|`budgetKrw=null`, `original.budget` 보존, `error_code=BUDGET_UNPARSED`(경고, 적재는 함)|
|날짜 파싱 실패|`deadlineAt=null`, `original.deadline` 보존, 경고 `DATE_UNPARSED`|
|마감이 공고일보다 이전|적재하되 `status` 그대로, 경고 `DATE_ORDER`|
|본문 인코딩 깨짐(치환 문자 비율 > 5%)|`content` 보존, 경고 `ENCODING_DEGRADED`, 추출 상태 `PENDING_REVIEW`|
|HWP/HWPX/PDF 텍스트 추출 실패|원본 다운로드는 유지(`bid_documents.parse_status=FAILED`), `error_code=ATTACHMENT_PARSE_FAILED`, 추출은 본문만으로 진행하고 `warnings`에 기록|
|첨부 크기·MIME 위반([[09-SECURITY\|09 보안]])|다운로드 거부, `parse_status=SKIPPED`, `error_code=ATTACHMENT_REJECTED`|
|외부 API 429|Retry-After 후 재시도, `summary.retried` +1. 소진 시 `error_code=RATE_LIMITED`|
|같은 checksum 재수집|적재 생략, `summary.skippedDuplicate` +1 (오류 아님)|

격리된 레코드는 삭제하지 않고 `ingest_errors.redacted_detail`에 PII 없는 요약만 남긴다. 재실행하면 같은 `job_key`로 멱등 처리한다. 수집 결과 집계는 `ingest_runs.summary = {created, changed, cancelled, skippedDuplicate, quarantined, retried}`이며 [[05-API-SPEC|05 API 명세]] `IngestionRun.summary`와 같다.

## 7. 시점 일치

- 백테스트는 의사결정 시점 이전에 발행·수집된 revision만 쓴다. `bid_revisions.fetched_at <= 결정 시각`.
- 낙찰·계약 결과를 특징량에 합치지 않는다. 결과 라벨은 별도 테이블로 두고 조인은 평가 코드에서만 한다.
- 모델·프롬프트·점수 규칙이 바뀌면 기존 `score_runs`를 덮어쓰지 않고 새 run을 만든다. 비교는 `algorithm_version`, `prompt_hash`로 한다.
- `AnalysisInput` 스냅샷에는 사용한 `revisionId`, `profileRevision`, `extractionId`가 들어가므로 같은 입력으로 재실행할 수 있다.

## 8. 수집 소스 registry

`infra/sources/registry.yaml`에 소스마다 아래 항목을 둔다. 값이 비어 있는 소스는 `DEMO_MODE` 밖에서 호출하지 않는다.

|키|예시|비고|
|---|---|---|
|`key`|`g2b-bid-notice`|`NormalizedBid.source`에 들어가는 값|
|`displayName`|나라장터 입찰공고정보서비스|서비스 이름 수준만 적는다|
|`provider`|조달청 / data.go.kr|—|
|`approvalStatus`|`NOT_REQUESTED` / `PENDING` / `APPROVED`|신청 상태|
|`endpoint`, `method`|(미검증, 비움)|공식 문서 확인 후 채운다|
|`quota`|(미검증)|일/초 호출 한도|
|`fieldMapping`|원본 필드 → `NormalizedBid` 필드|확인 전 비움|
|`changeNoticeUrl`|—|명세 변경 공지|
|`redistributionLimit`|—|재배포 제한 조건|
|`sampleResponses`|경로 3건|테스트 응답 원본|
|`lastVerifiedAt`|`2026-10-16`|검증일. 90일 지나면 경고|

> [!warning] 미검증 가정
> 조달청 공공데이터 API의 엔드포인트·필드·쿼터는 아직 확인하지 않았다. 해커톤 범위에서는 `fixture` 소스만 `APPROVED`이며 나머지는 `NOT_REQUESTED`다. 검증 방법: data.go.kr에서 활용신청 후 샘플 응답 3건을 저장하고 `fieldMapping`을 채운 뒤 Connector 통합 테스트를 통과시킨다.

## 9. 수용 기준

- `NormalizedBid` 스키마 검증(Zod)을 fixture 20건 전부 통과하고, 같은 fixture를 두 번 적재해도 revision이 늘지 않는다.
- `ExtractedField`의 `KNOWN`은 유효 근거 없이 저장될 수 없다(DB 적재 전 gateway 검증 + API 응답 검증 테스트).
- 인용 검증 4경로(EXACT/NORMALIZED/FUZZY/FAILED)와 §5.3 전이가 단위 테스트로 고정된다.
- `UNKNOWN`이 0이나 기본값으로 바뀌는 경로가 코드에 없다(리뷰 체크리스트 항목).

## 관련 문서

- [[03-AI-PIPELINE|03 AI 파이프라인]] — `RequirementExtraction` 전체 스키마, 프롬프트
- [[04-DATABASE|04 DB]] — 저장 테이블과 ENUM
- [[05-API-SPEC|05 API 명세]] — API DTO
- [[07-DATA-PIPELINE|07 수집]] — Connector와 fixture
- [[08-SCORING|08 점수]] — missing 정책
- [[11-TESTING|11 테스트]] — 골든 시나리오
