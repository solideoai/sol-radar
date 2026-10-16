---
title: "05. NestJS REST API 명세"
doc: "05"
status: review
tags:
  - sol-radar
  - api
updated: 2026-10-16
---

# 05. NestJS REST API 명세

OpenAPI(Swagger 생성, `apps/api` → `packages/contracts`)가 계약의 단일 원천이다. 이 문서는 그 OpenAPI가 담아야 할 내용을 사람이 읽는 형태로 적은 것이며, 둘이 다르면 OpenAPI를 고치고 이 문서를 맞춘다. CI는 생성된 클라이언트의 diff를 검사한다.

## 1. 규칙

|항목|규칙|
|---|---|
|기본 경로|`/api/v1`. 헬스체크만 `/health/live`, `/health/ready`|
|표현|JSON camelCase. 시각 ISO8601 UTC(`2026-10-16T02:00:00Z`). ID는 UUID. 금액은 KRW 정수 **문자열**(`"450000000"`)|
|인증|로그인 시 `sol_access`(HttpOnly, Secure, SameSite=Lax, 15분)와 `sol_refresh`(HttpOnly, Secure, SameSite=Strict, `Path=/api/v1/auth`, 7일) 쿠키 발급. 본문·헤더로 토큰을 내려 주지 않는다([[09-SECURITY\|09 보안]])|
|CSRF|상태 변경 요청(POST/PUT/PATCH/DELETE)은 헤더 `X-Requested-With: sol-radar` 필수. 없으면 `403 CSRF_REJECTED`|
|테넌트|`organizationId`는 항상 토큰 컨텍스트에서 가져온다. 요청 본문·쿼리의 조직 ID는 무시한다. 다른 조직 자원은 `403`이 아니라 `404`|
|권한|표의 권한 열은 **허용 역할 나열**이다. `ADMIN`이 다른 역할을 포함하는 순서 관계가 아니다([[09-SECURITY\|09 보안]] RBAC)|
|오류|`{"error":{"code":"...","message":"...","details":{...},"requestId":"..."}}`. 코드 전체는 §5|
|목록|`{"items":[...],"pageInfo":{"cursor":"...","nextCursor":"...|null","hasNext":true}}`. 커서는 불투명 문자열|
|멱등|`POST /bids/:id/analyses`, `POST /admin/ingestion/runs`는 `Idempotency-Key` 헤더(UUID)를 받는다. 같은 키 + 같은 본문이면 첫 응답을 다시 준다. 같은 키 + 다른 본문이면 `409 IDEMPOTENCY_KEY_REUSED`. 키 보존 24시간|
|요청 ID|모든 응답에 `X-Request-Id`. 로그·감사·오류 본문에 같은 값|
|속도 제한|`/auth/login` IP당 10회/분, `/bids/:id/analyses` 조직당 30회/분, `/admin/ingestion/runs` 조직당 5회/분. 초과 `429` + `Retry-After`|
|문서|`/api/docs`(Swagger UI), `/api/docs-json`은 개발 환경에서만|

## 2. 엔드포인트

|Method|Path|권한|기능|요청 → 응답|
|---|---|---|---|---|
|GET|`/health/live`|public|프로세스 생존|`200 {status:"ok"}`|
|GET|`/health/ready`|public|의존성 상태|`200 {status:"ok"\|"degraded", checks:{db,redis,storage,ai}}`. `checks.ai ∈ "mock"\|"local"\|"hosted"\|"unavailable"`. DB 또는 Redis 불가 = `503`(같은 본문), AI만 불가 = `200` + `status:"degraded"`|
|POST|`/auth/login`|public|쿠키 발급|`LoginInput` → `200 Me` + Set-Cookie|
|POST|`/auth/refresh`|refresh 쿠키|토큰 회전|`204` + Set-Cookie. 재사용 탐지 시 `401 REFRESH_TOKEN_INVALID` + 패밀리 폐기|
|POST|`/auth/logout`|auth|refresh 폐기, 쿠키 삭제|`204`|
|GET|`/me`|auth|내 정보·역할|`Me`|
|GET|`/bids`|`ADMIN, SALES, ANALYST, VIEWER`|목록·검색·필터·커서|§3 → `Page<BidListItem>`|
|GET|`/bids/:id`|`ADMIN, SALES, ANALYST, VIEWER`|상세(최신 revision, 추출, 최신 분석, 검토)|`BidDetail`|
|GET|`/bids/:id/revisions`|`ADMIN, SALES, ANALYST, VIEWER`|revision 목록·변경 필드|`BidRevisionSummary[]`|
|GET|`/bids/:id/revisions/:rev`|`ADMIN, SALES, ANALYST, VIEWER`|특정 revision 정규화 본문|`NormalizedBid`|
|GET|`/bids/:id/documents/:docId/download`|`ADMIN, SALES, ANALYST, VIEWER`|첨부 다운로드|`302` → 60초 presigned URL([[09-SECURITY\|09 보안]])|
|GET|`/company-profile`|`ADMIN, SALES, ANALYST, VIEWER`|현재 프로필(최신 revision)|`CompanyProfile`|
|GET|`/company-profile/revisions`|`ADMIN, SALES, ANALYST, VIEWER`|revision 이력|`CompanyProfileSummary[]`|
|PUT|`/company-profile`|`ADMIN`|새 revision 생성|`CompanyProfileInput` → `201 CompanyProfile`|
|POST|`/bids/:id/analyses`|`ADMIN, SALES, ANALYST`|분석 요청(비동기)|`AnalysisRequest` → `202 AnalysisAccepted`|
|GET|`/bids/:id/analyses`|`ADMIN, SALES, ANALYST, VIEWER`|이 공고의 분석 이력|`Page<AnalysisResult>`|
|GET|`/analyses/:id`|`ADMIN, SALES, ANALYST, VIEWER`|분석 상태·결과(polling)|`AnalysisResult`|
|GET|`/bids/:id/qualification-checks`|`ADMIN, SALES, ANALYST, VIEWER`|최신 분석의 자격 판정|`QualificationCheck[]`|
|GET|`/bids/:id/reviews`|`ADMIN, SALES, ANALYST, VIEWER`|검토 이력|`Review[]`|
|POST|`/bids/:id/reviews`|`ADMIN, SALES`|사람 최종 결정 기록|`ReviewInput` → `201 Review`|
|GET|`/dashboard/summary`|`ADMIN, SALES, ANALYST, VIEWER`|대시보드 요약|`DashboardSummary`|
|GET|`/notifications`|auth|내 알림 목록|`?unreadOnly&cursor&limit` → `Page<Notification>`|
|PATCH|`/notifications/:id/read`|auth(본인)|읽음 처리|`200 Notification`. 남의 알림은 `404`|
|GET|`/admin/users`|`ADMIN`|구성원 목록|`User[]`|
|POST|`/admin/users/invite`|`ADMIN`|초대(이메일·역할)|`InviteInput` → `201 User`|
|PATCH|`/admin/users/:id`|`ADMIN`|역할 변경·비활성화|`UserPatch` → `200 User`|
|POST|`/admin/ingestion/runs`|`ADMIN`|수동 수집(멱등)|`IngestionRunInput` → `202 IngestionRun`|
|GET|`/admin/ingestion/runs`|`ADMIN`|수집 이력|`Page<IngestionRun>`|
|GET|`/admin/ingestion/runs/:id`|`ADMIN`|수집 결과·오류|`IngestionRun`|
|GET|`/admin/ai/status`|`ADMIN`|AI 공급자·Kev 상태|`AiStatus`|

범위 밖(이번 해커톤에서 만들지 않음): 인력 배정 API(P1), 카카오 발송 설정, 경쟁사 분석.

## 3. `GET /bids` 쿼리 파라미터

|파라미터|타입|기본|검증|의미|
|---|---|---|---|---|
|`q`|string|—|1~100자|제목·기관·공고번호 검색(trigram). 비어 있으면 전체|
|`stage`|`PLAN\|PRE_SPEC\|NOTICE`, 반복 가능|전체|ENUM|단계 필터|
|`status`|`OPEN\|AMENDED\|CANCELLED\|CLOSED`, 반복 가능|`OPEN,AMENDED`|ENUM|상태 필터. 명시하면 그 값만|
|`agencies`|string, 반복 가능(`agencies=a&agencies=b`)|—|각 1~100자, 최대 10개|발주기관 정확 일치|
|`budgetMin`, `budgetMax`|KRW 정수 문자열|—|`>= 0`, `min <= max`|예산 범위. 예산 `null`인 공고는 범위 필터에 걸리지 않고 제외된다|
|`deadlineFrom`, `deadlineTo`|ISO8601|—|`from <= to`|마감 범위. 마감 `null`은 제외|
|`scoreMin`|int|—|0~100|최신 분석(`COMPLETED`/`PARTIAL`)의 SOL Score 이상. 분석 없는 공고는 제외|
|`recommendation`|`BID\|WATCH\|NO_BID`, 반복 가능|—|ENUM|최신 분석의 시스템 권고|
|`decision`|`BID\|WATCH\|NO_BID\|NONE`, 반복 가능|—|ENUM|최신 사람 결정. `NONE` = 미결정|
|`hasAnalysis`|boolean|—|—|분석 존재 여부|
|`isDemo`|boolean|—|—|DEMO 공고만/제외. 생략 시 둘 다|
|`sort`|`publishedAt:desc\|publishedAt:asc\|deadlineAt:asc\|deadlineAt:desc\|score:desc\|budgetKrw:desc`|`publishedAt:desc`|ENUM|정렬. `score:desc`는 분석 없는 공고를 뒤로|
|`cursor`|string|—|서버 발급 값|이전 응답의 `nextCursor`. 변조는 `400 INVALID_CURSOR`|
|`limit`|int|20|1~100|페이지 크기|

커서는 `(sort 키 값, id)`를 base64url로 인코딩하고 HMAC을 붙인다. 필터·정렬이 바뀌면 커서를 버리고 처음부터 요청한다.

## 4. DTO

`packages/contracts`가 OpenAPI에서 생성한 TS 타입이 실제 소스다. 아래는 같은 내용이다. `EvidenceRef`, `FieldState`, `ExtractedField`, `NormalizedBid`는 [[15-DATA-CONTRACTS|15 데이터 계약]], `RequirementExtraction`·`KevAssist`는 [[03-AI-PIPELINE|03 AI 파이프라인]]과 같다.

### 4.1 공통

```ts
interface PageInfo { cursor: string | null; nextCursor: string | null; hasNext: boolean }
interface Page<T> { items: T[]; pageInfo: PageInfo }
interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string }
}
type Role = "ADMIN" | "SALES" | "ANALYST" | "VIEWER";
type BidStage = "PLAN" | "PRE_SPEC" | "NOTICE";
type BidStatus = "OPEN" | "AMENDED" | "CANCELLED" | "CLOSED";
type Recommendation = "BID" | "WATCH" | "NO_BID";
type RecommendationBasis = "RULES_ONLY" | "RULES_WITH_KEV_ASSIST";
type AnalysisStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
type QualificationOutcome = "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW";
type ReviewFlag = "MODEL_RULE_DISAGREEMENT" | "KEV_MANDATORY_RISK" | "KEV_NEEDS_REVIEW" | "CITATION_FAILED"
  | "EXTRACTION_FAILED" | "EXTRACTION_LOW_CONFIDENCE" | "AI_UNAVAILABLE" | "INSUFFICIENT_DATA" | "INJECTION_SUSPECTED" | "SCALE_LIMIT_EXCEEDED";
type FactorKey = "skillMatch" | "pastPerformance" | "staffAvailability" | "scaleFit" | "strategicPreference";
```

### 4.2 인증·사용자

```ts
interface LoginInput { email: string; password: string }
interface Me {
  id: string; email: string; name: string; role: Role;
  organization: { id: string; name: string; slug: string; isDemo: boolean };
  permissions: string[];           // 예: ["bids:read","analyses:create","reviews:create"]. 리소스별 정책에서 파생
  sessionExpiresAt: string;        // access 쿠키 만료
}
interface User { id: string; email: string; name: string; role: Role; disabledAt: string | null; lastLoginAt: string | null; createdAt: string }
interface InviteInput { email: string; name: string; role: Role }
interface UserPatch { role?: Role; disabled?: boolean }
```

### 4.3 공고

```ts
interface BidListItem {
  id: string; source: string; noticeId: string; title: string; agency: string | null;
  stage: BidStage; status: BidStatus;
  budgetKrw: string | null; publishedAt: string | null; deadlineAt: string | null;
  latestRevision: number; planRef: string | null; isDemo: boolean; sourceUrl: string; lastSyncedAt: string;
  latestAnalysis: {                // 이 조직의 최신 run. 없으면 null
    id: string; status: AnalysisStatus; solScore: number | null; recommendation: Recommendation | null;
    recommendationBasis: RecommendationBasis | null; reviewFlags: ReviewFlag[]; createdAt: string;
  } | null;
  latestReview: { decision: Recommendation; decidedAt: string; reviewerName: string } | null;
}
interface BidRevisionSummary { id: string; revision: number; amendmentNo: string | null; fetchedAt: string; checksum: string; changedFields: string[] }
interface BidDocument {
  id: string; name: string; mimeType: string; sizeBytes: number;
  parseStatus: "PENDING" | "PARSED" | "FAILED" | "SKIPPED"; pageCount: number | null;
  downloadPath: string;            // "/api/v1/bids/:id/documents/:docId/download"
}
interface BidDetail extends BidListItem {
  content: string;                 // 최신 revision 정규화 본문
  original: NormalizedBid["original"];
  revisions: BidRevisionSummary[];
  documents: BidDocument[];
  extraction: RequirementExtraction | null;   // 최신 revision의 COMPLETED/PENDING_REVIEW 추출
  extractionStatus: "PENDING" | "COMPLETED" | "PENDING_REVIEW" | "FAILED" | "NONE";
  latestAnalysis: AnalysisResult | null;      // 목록의 요약 대신 전체
  reviews: Review[];
}
```

### 4.4 회사 프로필

```ts
interface CompanyProfile {
  id: string; organizationId: string; revision: number; name: string;
  technologies: { name: string; level?: "BASIC" | "INTERMEDIATE" | "EXPERT"; yearsOfExperience?: number }[];
  licenses: { code: string; name: string; validUntil?: string }[];        // code는 qualification-codes.yaml 키
  pastProjects: { title: string; agency?: string; amountKrw: string; startedAt: string; endedAt: string; domain: string; isPublicSector: boolean }[];
  financials: { fiscalYear: number; annualRevenueKrw?: string; capitalKrw?: string; employeeCount?: number; creditRating?: string; maxContractKrw?: string } | null;  // maxContractKrw: 단일 사업 수행 상한(scaleFit 입력)
  preferences: { agencies: string[]; agencyTypes: string[]; domains: string[]; excludedDomains: string[]; excludedKeywords: string[] } | null;  // agencyTypes 예: "교육청"; excludedDomains 예: "국방"
  effectiveAt: string; createdBy: { id: string; name: string }; createdAt: string; note: string | null;
}
type CompanyProfileSummary = Pick<CompanyProfile, "id" | "revision" | "effectiveAt" | "createdBy" | "createdAt" | "note">;
interface CompanyProfileInput extends Omit<CompanyProfile, "id" | "organizationId" | "revision" | "createdBy" | "createdAt"> {
  baseRevision: number;            // 현재 최신 revision. 다르면 409 PROFILE_REVISION_CONFLICT
}
```

### 4.5 분석

```ts
interface AnalysisRequest {
  profileRevision?: number;        // 생략 시 최신
  force?: boolean;                 // true: 같은 입력(revision·프로필·알고리즘)에 완료된 run이 있어도 새 run 생성. 이전 run은 보존.
                                   // false(기본): 같은 입력의 완료 run이 있으면 그 run을 돌려준다(deduplicated=true)
}
interface AnalysisAccepted { analysisId: string; status: AnalysisStatus; deduplicated: boolean; pollUrl: string }

interface ScoreFactor {
  factor: FactorKey; rawValue: unknown; normalized: number | null; points: number; maxPoints: number;
  missing: boolean; evidence: EvidenceRef[]; note: string | null;
}
interface QualificationCheck {
  id: string; requirementCode: string | null; requirementName: string; mandatory: boolean;
  outcome: QualificationOutcome; reason: string;
  evidence: EvidenceRef[];                                       // 공고 쪽 근거
  profileEvidence: { type: "LICENSE" | "PAST_PROJECT" | "TECHNOLOGY" | "FINANCIAL"; ref: string; label: string }[];  // 프로필 쪽 근거
  checkedAt: string;
}
interface AnalysisResult {
  id: string; bidId: string; revisionId: string; revision: number; profileRevision: number;
  status: AnalysisStatus;
  solScore: number | null;                                       // 0~100. 내부 적합도. 낙찰 확률 아님
  recommendation: Recommendation | null;
  recommendationBasis: RecommendationBasis | null;
  explanation: string | null;                                    // Qwen 설명 또는 템플릿 문장
  qualification: { status: QualificationOutcome; checks: QualificationCheck[] };
  scoreBreakdown: ScoreFactor[];
  missingFactors: FactorKey[];
  reviewFlags: ReviewFlag[];
  injectionSuspected: boolean;                                   // 추출 단계 지시문 패턴 탐지. true면 자격 종합은 NEEDS_REVIEW
  kev: KevAssist;                                                // 03 §5.7. enabled=false면 값은 null
  evidence: EvidenceRef[];                                       // 검증 통과한 인용만(match != FAILED)
  model: { provider: "mock" | "local" | "hosted"; qwen: { name: string; promptVersion: string; promptHash: string } | null;
           kev: { model: string; questionSetVersion: string } | null; algorithmVersion: string };
  errorCode: string | null;                                      // PARTIAL/FAILED 사유. 예: "AI_UNAVAILABLE"
  queuedAt: string; startedAt: string | null; finishedAt: string | null;
  disclaimer: "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.";
}
```

### 4.6 검토·알림·대시보드·수집

```ts
interface ReviewInput {
  decision: Recommendation; reason: string /* 10~2000자 */; scoreRunId?: string;
  assigneeUserId?: string;         // 담당자 지정. 같은 조직 사용자만(아니면 404). 지정되면 그 사용자에게 REVIEW_ASSIGNED outbox 이벤트 1건(13)
}
interface Review {
  id: string; bidId: string; revisionId: string; scoreRunId: string | null;
  reviewer: { id: string; name: string; role: Role }; decision: Recommendation; reason: string; decidedAt: string;
  assignee: { id: string; name: string } | null;                 // bid_reviews.assignee_id
  systemRecommendationAtDecision: Recommendation | null;         // 결정 당시 시스템 권고. 불일치 통계용
  disagreementFlag: boolean;                                     // decision !== systemRecommendationAtDecision. bid_reviews.disagreement_flag
}
interface Notification {
  id: string; type: "BID_CREATED" | "BID_CHANGED" | "DEADLINE_APPROACHING" | "ANALYSIS_COMPLETE" | "REVIEW_ASSIGNED";
  channel: "IN_APP" | "KAKAO"; status: "PENDING" | "SENT" | "FAILED" | "DEAD";
  payload: { bidId: string; title: string; message: string; link: string; changedFields?: string[] };
  readAt: string | null; createdAt: string;
}
interface DashboardSummary {
  generatedAt: string;
  dataFreshness: {
    lastIngestAt: string | null; lastIngestStatus: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | null; isDemo: boolean;
    lastIngestSummary: { created: number; changed: number; cancelled: number; skippedDuplicate: number; quarantined: number; retried: number } | null;  // 수집 카드 "격리 1건(FX-12)"
  };
  ai: { provider: "mock" | "local" | "hosted"; kevEnabled: boolean; lastGatewayCheckAt: string | null; healthy: boolean };
  bids: { total: number; byStage: Record<BidStage, number>; byStatus: Record<BidStatus, number>; deadlineWithin7Days: number };
  analyses: { total: number; byRecommendation: Record<Recommendation, number>; partial: number; withReviewFlags: number };
  reviews: { pending: number; byDecision: Record<Recommendation, number>; disagreementWithSystem: number };
  upcoming: { bidId: string; title: string; deadlineAt: string; recommendation: Recommendation | null; decision: Recommendation | null }[];  // 마감 임박 10건
  unreadNotifications: number;
}
interface IngestionRunInput {
  source: string;                  // "fixture" 또는 registry 키(15 §8). 데모는 "fixture"
  batch: "seed" | "live";          // seed: 기동 시 revision 1 적재. live: 데모 중 변경분(정정·취소·기한변경) 투입
  from?: string; to?: string;      // live 소스용 기간. fixture는 무시
}
interface IngestionRun {
  id: string; source: string; batch: "seed" | "live" | null; trigger: "SCHEDULED" | "MANUAL" | "DEMO";
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  summary: { created: number; changed: number; cancelled: number; skippedDuplicate: number; quarantined: number; retried: number };
  errors: { sourceKey: string; errorCode: string; detail: string }[];   // redacted
  cursor: string | null; requestedBy: { id: string; name: string } | null;
  startedAt: string; finishedAt: string | null;
}
interface AiStatus {
  provider: "mock" | "local" | "hosted"; hostedApproved: boolean;
  gateway: { url: string; healthy: boolean; checkedAt: string };
  kev: { enabled: boolean; healthy: boolean | null; model: string | null };
  qwen: { model: string | null; healthy: boolean | null };
}
```

## 5. 오류 코드

|HTTP|code|언제|`details`|
|---:|---|---|---|
|400|`VALIDATION_ERROR`|DTO·쿼리 검증 실패|`{issues:[{path,message}]}`|
|400|`INVALID_CURSOR`|커서 변조·만료|—|
|401|`UNAUTHENTICATED`|access 쿠키 없음·위조|—|
|401|`TOKEN_EXPIRED`|access 만료. 클라이언트는 `/auth/refresh` 후 재시도|—|
|401|`INVALID_CREDENTIALS`|로그인 실패. 이메일 존재 여부를 구분하지 않는다|—|
|401|`REFRESH_TOKEN_INVALID`|refresh 없음·폐기·재사용. 재사용이면 패밀리 전체 폐기|—|
|403|`FORBIDDEN`|역할이 허용 목록에 없음|`{required:[Role]}`|
|403|`CSRF_REJECTED`|`X-Requested-With` 누락|—|
|403|`ACCOUNT_DISABLED`|`disabledAt` 설정된 사용자|—|
|404|`NOT_FOUND`|자원 없음 **또는 다른 조직 자원**|`{resource:"bid"\|"analysis"\|...}`|
|409|`PROFILE_REVISION_CONFLICT`|`baseRevision` ≠ 최신|`{currentRevision}`|
|409|`ANALYSIS_IN_PROGRESS`|같은 입력의 run이 `QUEUED`/`RUNNING`인데 `force=true`|`{analysisId}`|
|409|`IDEMPOTENCY_KEY_REUSED`|같은 키, 다른 본문|—|
|409|`INGESTION_IN_PROGRESS`|같은 소스 수집이 `RUNNING`|`{runId}`|
|422|`INVALID_SOURCE_DOCUMENT`|분석 대상 revision에 본문·첨부 텍스트가 전혀 없음, 또는 수집 fixture 파일이 스키마 위반|`{revisionId}` 또는 `{file, issues}`|
|422|`HOSTED_NOT_APPROVED`|`AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`. `/admin/ai/status`에서만|—|
|423|`ACCOUNT_LOCKED`|로그인 실패 누적 잠금|`{retryAfterSec}`|
|429|`RATE_LIMITED`|속도 제한|`Retry-After` 헤더|
|500|`INTERNAL_ERROR`|미처리 예외. 메시지는 일반 문구, 상세는 로그에만|—|
|503|`SERVICE_UNAVAILABLE`|큐(Redis/BullMQ)·DB·스토리지 연결 불가로 요청을 받을 수 없음|`{component:"queue"\|"db"\|"storage"}`|

`AI_UNAVAILABLE`, `EXTRACTION_FAILED`는 HTTP 오류가 아니다. 분석은 비동기이므로 AI 장애는 `AnalysisResult.status=PARTIAL` + `errorCode`로 나타난다. API가 503을 내는 경우는 요청 자체를 큐에 넣지 못할 때뿐이다.

## 6. 예시

### 6.1 로그인

```json
POST /api/v1/auth/login
{"email":"sales@soltech.invalid","password":"********"}
```
`200` + `Set-Cookie: sol_access=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900` + `Set-Cookie: sol_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`
```json
{"id":"...","email":"sales@soltech.invalid","name":"김영업","role":"SALES",
 "organization":{"id":"...","name":"SOL테크","slug":"org-01","isDemo":true},
 "permissions":["bids:read","analyses:create","reviews:create","notifications:read"],
 "sessionExpiresAt":"2026-10-16T02:15:00Z"}
```

seed 계정 규약: `admin@soltech.invalid`, `sales@soltech.invalid`, `analyst@soltech.invalid`, `viewer@soltech.invalid`(org-01), `viewer@other.invalid`(org-02, 격리 시연). 비밀번호는 `.env.example`의 seed 변수.

### 6.2 분석 요청

```json
POST /api/v1/bids/27f3.../analyses
Idempotency-Key: 6a1e...
X-Requested-With: sol-radar
{"profileRevision":2,"force":false}
```
`202 Accepted`:
```json
{"analysisId":"7d2c...","status":"QUEUED","deduplicated":false,"pollUrl":"/api/v1/analyses/7d2c..."}
```

### 6.3 분석 결과 (FX-02, DEMO)

```json
GET /api/v1/analyses/7d2c...
{
 "id":"7d2c...","bidId":"27f3...","revisionId":"9b7c...","revision":1,"profileRevision":2,
 "status":"COMPLETED","solScore":72,
 "recommendation":"WATCH","recommendationBasis":"RULES_WITH_KEV_ASSIST",
 "explanation":"필수자격은 모두 충족했습니다. 요구기술 6개 중 3개(Java, Spring Boot, PostgreSQL)를 보유하고 Vue.js·SCORM·WebRTC는 없습니다. 마감까지 영업일이 짧아 인력 가용 계수를 0.7로 낮췄습니다. 점수 72점으로 사람 검토 구간(50~75)입니다.",
 "qualification":{"status":"SATISFIED","checks":[
   {"id":"...","requirementCode":"SW_BUSINESS_REG","requirementName":"소프트웨어사업자 신고확인서","mandatory":true,
    "outcome":"SATISFIED","reason":"프로필 등록 SW_BUSINESS_REG 유효",
    "evidence":[{"documentId":"7a2b...","revisionId":"9b7c...","page":2,"charStart":980,"charEnd":1012,
                 "quotedText":"소프트웨어사업자 신고확인서를 제출하여야 한다","fetchedAt":"2026-10-16T01:00:00Z","match":"EXACT"}],
    "profileEvidence":[{"type":"LICENSE","ref":"SW_BUSINESS_REG","label":"소프트웨어사업자 신고확인서"}],
    "checkedAt":"2026-10-16T02:00:05Z"}
 ]},
 "scoreBreakdown":[
   {"factor":"skillMatch","rawValue":{"required":6,"matched":3,"matchedNames":["Java","Spring Boot","PostgreSQL"],"missingNames":["Vue.js","SCORM","WebRTC"],"preferred":2,"preferredMatched":1},"normalized":0.5,"points":15.0,"maxPoints":30,"missing":false,"evidence":[],"note":null},
   {"factor":"pastPerformance","rawValue":{"similarProjects":2},"normalized":0.732,"points":18.3,"maxPoints":25,"missing":false,"evidence":[],"note":null},
   {"factor":"staffAvailability","rawValue":{"availableRatio":1.0,"scheduleFactor":0.7},"normalized":0.7,"points":14.0,"maxPoints":20,"missing":false,"evidence":[],"note":"마감 촉박 일정 계수 0.7"},
   {"factor":"scaleFit","rawValue":{"budgetKrw":"450000000","maxContractKrw":"5000000000","largestPastKrw":"2800000000"},"normalized":1.0,"points":15.0,"maxPoints":15,"missing":false,"evidence":[],"note":null},
   {"factor":"strategicPreference","rawValue":{"agencyTypeMatch":true,"domainMatch":true},"normalized":1.0,"points":10.0,"maxPoints":10,"missing":false,"evidence":[],"note":"교육 분야·교육청 선호 일치"}
 ],
 "missingFactors":[],
 "reviewFlags":["KEV_NEEDS_REVIEW"],
 "injectionSuspected":false,
 "kev":{"enabled":true,"provider":"mock","model":"jaredpalmer/kev-4b@v1.0","questionSetVersion":"kev-qs/v0.1",
        "suggestedOption":"WATCH","probabilities":{"BID":0.36,"WATCH":0.52,"NO_BID":0.12},"confidence":0.28,
        "mandatoryRisk":0.10,"needsHumanReview":0.74,"fit":{"score":3.2,"legend":{"0":"Very poor","1":"Poor","2":"Moderate","3":"Good","4":"Very good"}},
        "latencyMs":3,"requestId":"mock-7d2c",
        "disclaimer":"Kev 확률은 선택지에 대한 모델 분포이며 수주확률이 아닙니다."},
 "evidence":[],
 "model":{"provider":"mock","qwen":{"name":"fixture","promptVersion":"req-extract/v0.1","promptHash":"sha256:3f1c..."},
          "kev":{"model":"jaredpalmer/kev-4b@v1.0","questionSetVersion":"kev-qs/v0.1"},"algorithmVersion":"sol-v0.1.0"},
 "errorCode":null,
 "queuedAt":"2026-10-16T02:00:00Z","startedAt":"2026-10-16T02:00:01Z","finishedAt":"2026-10-16T02:00:06Z",
 "disclaimer":"SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다."
}
```

위 값은 **DEMO fixture FX-02의 가상 데이터**이며 [[08-SCORING|08 점수]] worked example과 같은 숫자다. 요소 합 15.0+18.3+14.0+15.0+10.0 = 72.3 → `solScore` 72(정수 반올림). 자격은 전부 충족이고 WATCH는 점수가 50~75 구간이기 때문이다. `kev.needsHumanReview=0.74`가 임계값 0.7 이상이라 `reviewFlags`에 `KEV_NEEDS_REVIEW`가 들어갔고, Kev 권고(WATCH)가 규칙 권고와 같아 `MODEL_RULE_DISAGREEMENT`는 없다. 다른 fixture의 mock Kev 값은 [[07-DATA-PIPELINE|07 수집]] §6.3. 예시의 `scoreBreakdown.evidence`는 지면상 비웠다.

### 6.4 AI 장애 시 재분석 (데모 장면)

```json
POST /api/v1/bids/27f3.../analyses  {"force":true}
→ 202 {"analysisId":"8e3d...","status":"QUEUED","deduplicated":false,"pollUrl":"..."}
GET /api/v1/analyses/8e3d...
→ {"status":"PARTIAL","recommendationBasis":"RULES_ONLY","errorCode":"AI_UNAVAILABLE",
   "reviewFlags":["AI_UNAVAILABLE"],"kev":{"enabled":false,"provider":"mock","model":null, ...},
   "explanation":"AI 서비스를 사용할 수 없어 규칙 기반 결과만 제공합니다. ...", "solScore":72, "recommendation":"WATCH", ...}
```

이전 run(`7d2c...`)은 그대로 남고 `GET /bids/:id/analyses`에 둘 다 보인다.

### 6.5 수동 수집

```json
POST /api/v1/admin/ingestion/runs            (기동 시 SEED 배치)
Idempotency-Key: 1b2c...
{"source":"fixture","batch":"seed"}
→ 202 {"id":"...","source":"fixture","batch":"seed","trigger":"MANUAL","status":"RUNNING",
       "summary":{"created":0,"changed":0,"cancelled":0,"skippedDuplicate":0,"quarantined":0,"retried":0}, ...}
GET /api/v1/admin/ingestion/runs/:id (완료 후)
→ {"status":"PARTIAL","summary":{"created":19,"changed":0,"cancelled":0,"skippedDuplicate":0,"quarantined":1,"retried":2},
   "errors":[{"sourceKey":"fixture:FX-12","errorCode":"MISSING_REQUIRED_FIELD","detail":"title 누락"}], ...}

POST /api/v1/admin/ingestion/runs            (데모 중 LIVE 배치)
{"source":"fixture","batch":"live"}
→ 완료 후 {"status":"SUCCEEDED","summary":{"created":0,"changed":3,"cancelled":1,"skippedDuplicate":1,"quarantined":0,"retried":0},"errors":[], ...}
```

SEED의 `retried: 2`는 FX-20(429 Retry-After 재시도) 케이스, `quarantined: 1`은 FX-12. 값은 [[07-DATA-PIPELINE|07 수집]] fixture 표 기준.

## 7. 구현 유의

- 모든 DTO는 Zod 스키마에서 OpenAPI와 NestJS ValidationPipe 양쪽을 만든다. 손으로 두 번 쓰지 않는다.
- 조직 범위 조회는 Prisma 미들웨어 또는 리포지토리 계층에서 강제하고, `organizationId` 없는 조직 테이블 query를 lint 규칙으로 막는다.
- `POST /bids/:id/analyses`의 중복 방지는 [[04-DATABASE|04 DB]]의 부분 UNIQUE 인덱스와 `Idempotency-Key` 둘로 한다. `force=false`에서 같은 입력의 완료 run이 있으면 새 job을 만들지 않고 `deduplicated:true`로 그 run을 돌려준다.
- `POST /bids/:id/reviews`는 트랜잭션 안에서 `bid_reviews` insert + `audit_logs` insert를 쓰고, `assigneeUserId`가 있을 때만 `REVIEW_ASSIGNED` outbox(수신자 = 담당자, idempotency `reviewId+assigneeUserId+REVIEW_ASSIGNED`)를 함께 쓴다.
- 응답에 Kev 값이 있을 때마다 `disclaimer` 문자열을 내려 보내고, UI는 그 문자열을 그대로 보여 준다.
- OpenAPI JSON은 CI에서 생성해 `packages/contracts/openapi.json`과 diff가 없어야 한다. 바뀌면 PR에서 보이게 한다.

## 관련 문서

- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `NormalizedBid`
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `RequirementExtraction`, `KevAssist`
- [[04-DATABASE|04 DB]] — 테이블·ENUM 대응
- [[06-UI-UX|06 UI]] — 화면별 사용 엔드포인트
- [[08-SCORING|08 점수]] — `scoreBreakdown` 계산
- [[09-SECURITY|09 보안]] — 쿠키·CSRF·RBAC
- [[13-NOTIFICATIONS|13 알림]] — `Notification` 이벤트
