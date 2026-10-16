---
title: "05. REST API 명세 (Next.js Route Handler)"
doc: "05"
status: review
tags:
  - sol-radar
  - api
updated: 2026-10-16
---

# 05. REST API 명세 (Next.js Route Handler)

외부 API 계약의 단일 원천은 **zod 스키마**(`web/server/<도메인>/*.model.ts`, [[16-DECISIONS|16 ADR]] ADR-016)다. Route Handler(`web/app/api/v1/**/route.ts`)는 요청을 이 스키마로 검증하고, 응답 타입도 같은 스키마에서 얻는다(`z.infer`). 이 문서는 그 스키마가 담아야 할 내용을 사람이 읽는 형태로 적은 것이며, 둘이 다르면 zod 스키마를 고치고 이 문서를 맞춘다. 상태 코드와 응답 형태는 Route Handler 계약 시험(Vitest, [[11-TESTING|11 테스트]])이 검사한다. 구조 결정은 ADR-017(Next.js + Supabase)이다.

## 1. 규칙

|항목|규칙|
|---|---|
|기본 경로|`/api/v1`. Next.js Route Handler(`web/app/api/v1/**/route.ts`)로 구현하고, §2 표의 경로는 `/api/v1` 뒤에 붙는다(예: `/me` = `/api/v1/me`). 헬스체크만 `/health/live`, `/health/ready`이며 같은 Next 앱의 라우트(`web/app/health/{live,ready}/route.ts`)다. 별도 API 서버는 없다|
|표현|JSON camelCase. 시각 ISO8601 UTC(`2026-10-16T02:00:00Z`). ID는 UUID. 금액은 KRW 정수 **문자열**(`"450000000"`)|
|인증|Supabase Auth 세션. 브라우저는 `@supabase/ssr`가 관리하는 세션 쿠키(HttpOnly 아님, 이유는 [[09-SECURITY\|09 보안]] 인증), 스크립트·시연(S7 격리 시연, 스모크)은 `Authorization: Bearer <Supabase access token>`. 서버는 둘 다 Supabase로 서명·만료를 검증하고, DB는 그 사용자 권한(anon 키 + 사용자 토큰)으로 불러 RLS가 적용된다. 로그인·로그아웃·토큰 갱신 엔드포인트는 이 API에 없다(§2 아래 참고)|
|CSRF|쿠키로 인증한 상태 변경 요청(POST/PUT/PATCH/DELETE)은 헤더 `X-Requested-With: sol-radar` 필수. 없으면 `403 CSRF_REJECTED`. `Authorization: Bearer` 요청은 쿠키를 쓰지 않으므로 제외. Server Action은 Next의 Origin 검사를 따른다|
|테넌트|`orgId`는 서버가 세션 사용자의 멤버십(`memberships`)에서 정한다. 요청 본문·쿼리의 조직 ID는 무시한다. 조직 데이터는 RLS(`org_id in (select public.my_org_ids())`)가 거르므로 다른 조직 자원은 행이 보이지 않아 `403`이 아니라 `404`|
|권한|표의 권한 열은 `memberships.sol_role`의 **허용 역할 나열**이다. `ADMIN`이 다른 역할을 포함하는 순서 관계가 아니다([[09-SECURITY\|09 보안]] RBAC). `auth` = 로그인한 조직 구성원(역할 무관), `public` = 인증 없음. `org_role`(owner·member)은 조직 관리용이라 이 열에 쓰지 않는다. `session`은 활동 중 Supabase 로그인 사용자로 조직 멤버십을 요구하지 않으며 가입 정보 보완 경로에만 사용|
|오류|`{"error":{"code":"...","message":"...","details":{...},"requestId":"..."}}`. 코드 전체는 §5|
|목록|`{"items":[...],"pageInfo":{"cursor":"...","nextCursor":"...\|null","hasNext":true}}`. 커서는 불투명 문자열|
|멱등|`POST /bids/:id/analyses`, `POST /admin/ingestion/runs`는 `Idempotency-Key` 헤더(UUID)를 받는다. 같은 키 + 같은 본문이면 첫 응답을 다시 준다. 같은 키 + 다른 본문이면 `409 IDEMPOTENCY_KEY_REUSED`. 키 보존 24시간|
|요청 ID|모든 응답에 `X-Request-Id`. 로그·감사·오류 본문에 같은 값|
|속도 제한|로그인·토큰 갱신은 Supabase Auth의 요청 제한을 쓴다(값은 Supabase 대시보드 설정으로 정하고 확인한다, 미검증). `/bids/:id/analyses` 조직당 30회/분, `/admin/ingestion/runs` 조직당 5회/분은 Redis로 센다. 초과 `429` + `Retry-After`|
|문서|계약의 원천은 zod 스키마다. OpenAPI 문서는 선택이며, 만들면 zod 스키마에서 생성하고 개발 환경에서만 노출한다|

> [!warning] 미결정 — 현재 조직을 고르는 방법
> 템플릿은 가입할 때 개인 조직을 하나 만들고(`public.create_personal_org`), 화면의 현재 조직을 주소의 slug(`web/app/(app)/[slug]/`)로 고른다. 그래서 한 사용자가 멤버십을 여러 개 가질 수 있다. 이 API는 "세션 사용자의 업무 조직 하나"를 전제한다. 업무 조직을 정하는 규칙(SOL RADAR 조직 멤버십 하나로 제한 / 개인 조직 생성 끄기 / 요청에 slug 받기 등)은 Phase 1에서 정한다. 어느 쪽이든 요청에 실린 조직 값은 그대로 믿지 않고 멤버십으로 확인한다.

## 2. 엔드포인트

|Method|Path|권한|기능|요청 → 응답|
|---|---|---|---|---|
|GET|`/health/live`|public|프로세스 생존|`200 {status:"ok"}`|
|GET|`/health/ready`|public|의존성 상태|`200 {status:"ok"\|"degraded", checks:{db,redis,storage,ai}}`. `checks.db` = Supabase(Postgres) 연결, `checks.storage` = MinIO, `checks.ai ∈ "mock"\|"local"\|"hosted"\|"unavailable"`. db·redis·storage 중 하나라도 불가 = `503` + `status:"unavailable"`(같은 형태의 본문), AI만 불가 = `200` + `status:"degraded"`|
|GET|`/signup-options`|public|솔리데오 고정 가입 선택 목록(ID·표시명·버전만)|`SignupOptions`|
|GET|`/me/employment`|session(본인)|조직 합류 전에도 가입 신고 정보·완료 여부 조회|`EmploymentState`|
|PATCH|`/me/employment`|session(본인)|부서·직급/직책 필수 보완|`EmploymentInput` → `200 EmploymentState`|
|GET|`/me`|auth|세션 사용자·현재 조직·역할(`orgRole`·`solRole`)|`Me`|
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
|GET|`/admin/users`|`ADMIN`|이 조직의 구성원 목록(템플릿 `memberships` + `profiles`)|`User[]`|
|POST|`/admin/users/invite`|`ADMIN`|초대(이메일·업무 역할). 템플릿 조직 초대 기능: `invitations` 행 + 초대 메일(SMTP 설정이 없으면 메일 없이 초대만 저장)|`InviteInput` → `201 Invitation`|
|PATCH|`/admin/users/:id`|`ADMIN`|업무 역할 변경(`memberships.sol_role`). `:id`는 구성원의 사용자 ID(`profiles.id`). 이 조직 구성원이 아니면 `404`|`UserPatch` → `200 User`|
|DELETE|`/admin/users/:id`|`ADMIN`|비활성화 = 이 조직에서 내보내기(`memberships` 행 삭제, 템플릿 구성원 기능). 계정 자체 정지(`profiles.status='suspended'`)는 서비스 운영자(`profiles.is_admin`) 기능이라 이 API에 없다|`204`|
|POST|`/admin/ingestion/runs`|`ADMIN`|수동 수집(멱등)|`IngestionRunInput` → `202 IngestionRun`|
|GET|`/admin/ingestion/runs`|`ADMIN`|수집 이력|`Page<IngestionRun>`|
|GET|`/admin/ingestion/runs/:id`|`ADMIN`|수집 결과·오류|`IngestionRun`|
|GET|`/admin/ai/status`|`ADMIN`|AI 공급자·Kev 상태|`AiStatus`|

로그인·로그아웃·비밀번호 재설정·초대 수락·토큰 갱신은 이 API에 없다. Supabase Auth가 맡고, 화면은 템플릿의 `/auth/login`·`/auth/reset`·`/auth/password`와 조직 초대 수락 화면이다(§6.1, [[09-SECURITY|09 보안]] 인증). 세션 갱신은 `@supabase/ssr`가 한다(화면 요청은 `web/proxy.ts`).

> [!warning] 미결정 — 구성원 관리 권한의 기준
> 템플릿의 RLS 정책은 초대·역할 변경·내보내기를 `org_role = 'owner'`(`public.my_owner_org_ids()`)에게만 연다. 이 API의 권한은 `sol_role = ADMIN`이다. 데모 `admin@soltech.invalid`는 `org_role=owner` + `sol_role=ADMIN`이라 데모 흐름은 영향이 없다. owner가 아닌 ADMIN을 어떻게 다룰지(정책을 `sol_role` 기준으로 새 마이그레이션에서 바꾸기 / ADMIN 부여 시 owner도 함께 부여)와 `sol_role` 열의 쓰기 권한·정책은 Phase 1에서 정한다([[04-DATABASE|04 DB]]).

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

커서는 `(sort 키 값, id)`를 base64url로 인코딩하고 HMAC(키: 서버 전용 env `API_CURSOR_SECRET`, [[10-DEPLOYMENT|10 배포]])을 붙인다. 필터·정렬이 바뀌면 커서를 버리고 처음부터 요청한다.

## 4. DTO

실제 소스는 `web/server/<도메인>/*.model.ts`의 zod 스키마이고, TS 타입은 `z.infer`로 얻는다([[16-DECISIONS|16 ADR]] ADR-016). 아래는 같은 내용을 TS 인터페이스로 적은 것이다. `EvidenceRef`, `FieldState`, `ExtractedField`, `NormalizedBid`는 [[15-DATA-CONTRACTS|15 데이터 계약]], `RequirementExtraction`·`KevAssist`는 [[03-AI-PIPELINE|03 AI 파이프라인]]과 같다.

### 4.1 공통

```ts
interface PageInfo { cursor: string | null; nextCursor: string | null; hasNext: boolean }
interface Page<T> { items: T[]; pageInfo: PageInfo }
interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string }
}
type Role = "ADMIN" | "SALES" | "ANALYST" | "VIEWER";   // memberships.sol_role. §2 권한 열이 보는 값
type OrgRole = "owner" | "member";                      // memberships.org_role. 조직 관리(초대·구성원)용, 템플릿 값
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

로그인 입력·토큰 DTO는 없다. 로그인은 Supabase Auth가 받는다(§6.1).

```ts
interface Me {
  id: string; email: string; name: string;   // profiles.id(= auth.users.id)·email·display_name
  employment: EmploymentInfo | null; profileComplete: boolean;  // 가입 신고 정보, 권한 아님
  orgRole: OrgRole;                // 현재 조직의 memberships.org_role
  solRole: Role;                   // 현재 조직의 memberships.sol_role
  organization: { id: string; name: string; slug: string; isDemo: boolean };
  permissions: string[];           // 예: ["bids:read","analyses:create","reviews:create"]. solRole과 리소스별 정책에서 파생
  sessionExpiresAt: string;        // Supabase access token 만료 시각(JWT exp)
}
interface User {                   // 조직 구성원 = memberships + profiles
  id: string; email: string; name: string;
  orgRole: OrgRole; solRole: Role;
  employment: EmploymentInfo | null; profileComplete: boolean;
  status: "active" | "suspended";  // profiles.status. suspended = 서비스 운영자가 정지(로그인과 조직 데이터가 막힌다)
  joinedAt: string;                // memberships.created_at
}
interface InviteInput { email: string; solRole: Role }   // 수락하면 이 업무 역할로 구성원이 된다
interface Invitation {             // 템플릿 invitations 행. solRole을 담을 열(sol_role)은 Phase 1 마이그레이션에서 더한다
  id: string; email: string; orgRole: OrgRole; solRole: Role;
  invitedBy: { id: string; name: string } | null; expiresAt: string; createdAt: string;
}
interface UserPatch { solRole: Role }
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
  id: string; orgId: string; revision: number; name: string;
  technologies: { name: string; level?: "BASIC" | "INTERMEDIATE" | "EXPERT"; yearsOfExperience?: number }[];
  licenses: { code: string; name: string; validUntil?: string }[];        // code는 qualification-codes.yaml 키
  pastProjects: { title: string; agency?: string; amountKrw: string; startedAt: string; endedAt: string; domain: string; isPublicSector: boolean }[];
  financials: { fiscalYear: number; annualRevenueKrw?: string; capitalKrw?: string; employeeCount?: number; creditRating?: string; maxContractKrw?: string } | null;  // maxContractKrw: 단일 사업 수행 상한(scaleFit 입력)
  preferences: { agencies: string[]; agencyTypes: string[]; domains: string[]; excludedDomains: string[]; excludedKeywords: string[] } | null;  // agencyTypes 예: "교육청"; excludedDomains 예: "국방"
  effectiveAt: string; createdBy: { id: string; name: string }; createdAt: string; note: string | null;
}
type CompanyProfileSummary = Pick<CompanyProfile, "id" | "revision" | "effectiveAt" | "createdBy" | "createdAt" | "note">;
interface CompanyProfileInput extends Omit<CompanyProfile, "id" | "orgId" | "revision" | "createdBy" | "createdAt"> {
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
  reviewer: { id: string; name: string; role: Role /* memberships.sol_role */ }; decision: Recommendation; reason: string; decidedAt: string;
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
|401|`UNAUTHENTICATED`|세션 쿠키·Bearer 토큰 없음, 서명이 틀림, 만료. 브라우저는 Supabase 클라이언트가 세션을 갱신한 뒤 다시 시도하고, 그래도 401이면 `/auth/login`으로 보낸다|—|
|403|`FORBIDDEN`|`sol_role`이 허용 목록에 없음|`{required:[Role]}`|
|403|`CSRF_REJECTED`|쿠키 인증의 상태 변경 요청에 `X-Requested-With` 누락|—|
|403|`PROFILE_INCOMPLETE`|이름·부서·직급/직책 보완 전 업무 API 요청|`{completionPath:"/auth/complete-profile"}`|
|403|`ACCOUNT_DISABLED`|`profiles.status='suspended'`인 사용자(토큰이 아직 유효해도)|—|
|404|`NOT_FOUND`|자원 없음 **또는 다른 조직 자원**(RLS로 행이 보이지 않음)|`{resource:"bid"\|"analysis"\|...}`|
|409|`PROFILE_REVISION_CONFLICT`|`baseRevision` ≠ 최신|`{currentRevision}`|
|409|`ANALYSIS_IN_PROGRESS`|같은 입력의 run이 `QUEUED`/`RUNNING`인데 `force=true`|`{analysisId}`|
|409|`IDEMPOTENCY_KEY_REUSED`|같은 키, 다른 본문|—|
|409|`INGESTION_IN_PROGRESS`|같은 소스 수집이 `RUNNING`|`{runId}`|
|422|`INVALID_SOURCE_DOCUMENT`|분석 대상 revision에 본문·첨부 텍스트가 전혀 없음, 또는 수집 fixture 파일이 스키마 위반|`{revisionId}` 또는 `{file, issues}`|
|422|`HOSTED_NOT_APPROVED`|`AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`. `/admin/ai/status`에서만|—|
|429|`RATE_LIMITED`|속도 제한(Redis로 세는 §1의 API 제한)|`Retry-After` 헤더|
|500|`INTERNAL_ERROR`|미처리 예외. 메시지는 일반 문구, 상세는 로그에만|—|
|503|`SERVICE_UNAVAILABLE`|큐(Redis/BullMQ)·DB(Supabase)·스토리지(MinIO) 연결 불가로 요청을 받을 수 없음|`{component:"queue"\|"db"\|"storage"}`|

`TOKEN_EXPIRED`·`INVALID_CREDENTIALS`·`REFRESH_TOKEN_INVALID`·`ACCOUNT_LOCKED`는 이 API가 내지 않는다. 로그인 실패·시도 제한·토큰 갱신 실패는 Supabase Auth의 응답이고(예: 템플릿 로그인 폼 `web/app/auth/login/sign-in-form.tsx`가 구분하는 `invalid_credentials`·`user_banned`), 화면이 그 응답을 [[06-UI-UX|06 UI]] §5.2의 문구로 바꾼다. 이메일 존재 여부를 구분하는 문구는 쓰지 않는다.

`AI_UNAVAILABLE`, `EXTRACTION_FAILED`는 HTTP 오류가 아니다. 분석은 비동기이므로 AI 장애는 `AnalysisResult.status=PARTIAL` + `errorCode`로 나타난다. API가 503을 내는 경우는 요청 자체를 큐에 넣지 못할 때뿐이다.

## 6. 예시

예시의 인증 정보는 생략했다. 브라우저는 세션 쿠키를 싣고 상태 변경 요청에 `X-Requested-With: sol-radar`를 붙인다. 스크립트는 `Authorization: Bearer <Supabase access token>`을 붙인다(§1).

### 6.1 로그인 (Supabase Auth, 이 API 밖)

로그인은 자체 엔드포인트가 아니라 Supabase Auth가 받는다. 화면은 템플릿 `/auth/login`이고, 브라우저 Supabase 클라이언트가 Supabase Auth에 직접 로그인한다.

```ts
// web/app/auth/login/sign-in-form.tsx (템플릿)
const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password });
// 성공하면 @supabase/ssr가 세션 쿠키를 쓰고, 화면을 다시 그리면 서버가 그 쿠키로 사용자를 확인한다.
// 실패하면 error.code(invalid_credentials·user_banned 등)를 화면 문구로 바꾼다(§5 아래).
```

스크립트·시연(S7)은 Supabase Auth의 비밀번호 로그인으로 access token을 받아 Bearer로 쓴다. 비밀번호는 환경 변수에서 읽고 명령에 직접 쓰지 않는다([[19-DEMO-SCENARIO|19 데모 시나리오]] S0).

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"sales@soltech.invalid\",\"password\":\"$DEMO_SEED_PASSWORD\"}" | jq -r .access_token
```

로그인 뒤 세션 사용자 정보:

```json
GET /api/v1/me
{"id":"...","email":"sales@soltech.invalid","name":"김영업","orgRole":"member","solRole":"SALES",
 "organization":{"id":"...","name":"솔리데오","slug":"org-01","isDemo":true},
 "permissions":["bids:read","analyses:create","reviews:create","notifications:read"],
 "sessionExpiresAt":"2026-10-16T02:15:00Z"}
```

seed 계정 규약: `admin@soltech.invalid`, `sales@soltech.invalid`, `analyst@soltech.invalid`, `viewer@soltech.invalid`(org-01), `viewer@other.invalid`(org-02, 격리 시연). `admin@soltech.invalid`는 `orgRole=owner` + `solRole=ADMIN`이다. 계정은 `pnpm demo:reset`(service role로 Supabase 프로젝트에 seed)이 만들고, 비밀번호는 `.env`의 `DEMO_SEED_PASSWORD`(`.env.example`에는 placeholder만)다.

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

- Route Handler는 얇게 둔다: 인증(세션 쿠키 또는 Bearer, Supabase로 검증) → CSRF 검사(쿠키 인증의 상태 변경 요청) → `sol_role` 확인 → zod 검증 → `@/server/<도메인>` 배럴의 service 호출 → 오류를 §5 형식으로 바꾼다. 업무 로직은 `web/server/<도메인>/`(model·repo·service·index, `import "server-only"`)에 두고 Route Handler·Server Action·서버 컴포넌트가 같이 쓴다.
- 모든 DTO·쿼리·본문은 zod 스키마 하나에서 검증과 타입(`z.infer`)을 얻는다. 화면 폼(react-hook-form)도 같은 스키마를 쓴다. 손으로 두 번 쓰지 않는다.
- 요청 처리 경로의 DB 호출은 사용자 세션(anon 키 + 사용자 토큰)으로만 한다. 조직 범위는 RLS(`org_id in (select public.my_org_ids())`)가 강제하므로 코드가 조건을 빠뜨려도 다른 조직 행은 보이지 않고 404가 된다. 쓰기 권한도 RLS 정책으로 한 번 더 막고, 정책 시험은 `scripts/database.test.mjs`(`pnpm test:db`)에 둔다. `SUPABASE_SERVICE_ROLE_KEY`는 Route Handler에서 쓰지 않는다(worker·seed만, [[09-SECURITY|09 보안]]).
- worker(`web/worker`)는 service role이라 RLS를 거치지 않는다. 조직 데이터를 쓸 때 `org_id`를 직접 지정하고, 테넌트 혼입을 막는 시험을 둔다.
- `POST /bids/:id/analyses`의 중복 방지는 [[04-DATABASE|04 DB]]의 부분 UNIQUE 인덱스와 `Idempotency-Key` 둘로 한다. `force=false`에서 같은 입력의 완료 run이 있으면 새 job을 만들지 않고 `deduplicated:true`로 그 run을 돌려준다.
- `POST /bids/:id/reviews`는 한 트랜잭션 안에서 `bid_reviews` insert + `audit_logs` insert를 쓰고, `assigneeUserId`가 있을 때만 `REVIEW_ASSIGNED` outbox(수신자 = 담당자, idempotency `reviewId+assigneeUserId+REVIEW_ASSIGNED`)를 함께 쓴다. supabase-js 질의 빌더는 여러 문장을 한 트랜잭션으로 묶지 못하므로, 이런 쓰기는 `supabase/migrations`의 DB 함수로 만들고 `rpc`로 부른다.
- 응답에 Kev 값이 있을 때마다 `disclaimer` 문자열을 내려 보내고, UI는 그 문자열을 그대로 보여 준다.
- 계약 변경은 zod 스키마 diff와 Route Handler 계약 시험으로 PR에서 보이게 한다. OpenAPI 문서는 선택이며, 만들면 zod 스키마에서 생성한다.
- 템플릿의 `/api/auth/*`·`/api/users/me`·`/api/admin/users/[id]/status`는 템플릿 기능(로그인 수단 연결·운영자 정지 등)이며 이 계약(`/api/v1`) 밖이다. 남길지는 Phase 0 템플릿 정리에서 정한다.

## 8. 솔리데오 가입 정보 계약 (ADR-019, 구현 예정)

회원가입·로그인 자체는 계속 Supabase Auth다. 자체 비밀번호/토큰 API를 추가하지 않는다. 아래 타입은 외부 계약 설명이며 구현 시 `web/server/profile` 등 해당 도메인의 zod 스키마에서 타입을 얻는다.

```ts
interface OptionItem { id: string; label: string } // 승인 fixture의 안정적인 코드
interface SignupOptions {
  companyName: "솔리데오";
  catalogVersion: "solideo-organization/v1.0";
  departments: OptionItem[];
  jobTitles: OptionItem[];
}
interface EmploymentSelection { departmentId: string; jobTitleId: string }
interface EmploymentInput extends EmploymentSelection { name: string } // 기존과 같은 1~40자 표시 이름
interface EmploymentInfo extends EmploymentSelection {
  companyName: "솔리데오";
  departmentName: string;
  jobTitleLabel: string;
}
interface EmploymentState { name: string | null; employment: EmploymentInfo | null; profileComplete: boolean }
```

`id`·`departmentId`·`jobTitleId`는 공개 카탈로그 코드이고 DB UUID는 서버가 매핑한다. 이메일 가입은 `options.data`에 `name`, `department_code`, `job_title_code`를 담는다. 새 가입 트리거가 검증 후 `profiles`의 신고 정보 FK로 저장한다([[04-DATABASE]]). 빈 값·없는 코드·다른 회사 카탈로그는 거절하고 필드별 `VALIDATION_ERROR`를 반환한다. Supabase Auth가 직접 거절한 가입 오류는 Auth 응답을 화면에서 필드 오류로 바꾸며, 위 HTTP 오류 형태를 Supabase가 반환한다고 가정하지 않는다.

`GET /signup-options`는 원본 인원·배분 인원·직원 이름·성별·사진 manifest·연락처를 노출하지 않는다. `PATCH /me/employment`는 로그인한 본인의 이름·부서·직급 신고 정보를 하나의 profiles 갱신으로 원자적으로 저장하며, 쿠키 요청은 §1 CSRF 헤더를 요구한다. 요청에 userId/orgId/역할을 받아 다른 사람이나 업무 권한을 바꾸지 않는다. `GET /me`·`User`의 employment도 자기 신고 정보이지 검증된 소속 증명은 아니다.

`profileComplete`는 이름·두 신고 값의 현재 유효성으로 서버에서 계산하며 클라이언트의 boolean을 신뢰하지 않는다. OAuth 콜백·기존 미완료 계정 로그인은 `/auth/complete-profile`로 보낸다. 업무 화면과 업무 API에서 모두 보완 전 접근을 막는다. Auth 콜백·가입 옵션·본인 신고 정보 조회/저장·로그아웃·초대 안내는 보완 전에도 허용해 반복 이동을 막는다. 보완을 끝내도 멤버십·RLS 확인과 기존 초대 정책은 그대로 적용한다.

## 관련 문서

- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `NormalizedBid`
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `RequirementExtraction`, `KevAssist`
- [[04-DATABASE|04 DB]] — 테이블·ENUM 대응
- [[06-UI-UX|06 UI]] — 화면별 사용 엔드포인트
- [[08-SCORING|08 점수]] — `scoreBreakdown` 계산
- [[09-SECURITY|09 보안]] — 세션 쿠키·CSRF·RBAC·RLS
- [[13-NOTIFICATIONS|13 알림]] — `Notification` 이벤트
- [[11-TESTING|11 테스트]] — Route Handler 계약 시험·RLS 정책 시험
- [[16-DECISIONS|16 ADR]] — ADR-016(zod), ADR-017(Next.js + Supabase)
