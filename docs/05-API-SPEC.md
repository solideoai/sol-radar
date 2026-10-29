---
title: "05. REST API 명세 (Next.js Route Handler)"
doc: "05"
status: review
tags:
  - sol-radar
  - api
updated: 2026-10-29
---

# 05. REST API 명세 (Next.js Route Handler)

외부 API 계약의 단일 원천은 **zod 스키마**(`web/server/<도메인>/*.model.ts`, [[16-DECISIONS|16 ADR]] ADR-016)다. Route Handler(`web/app/api/v1/**/route.ts`)는 요청을 이 스키마로 검증하고, 응답 타입도 같은 스키마에서 얻는다(`z.infer`). 이 문서는 그 스키마가 담아야 할 내용을 사람이 읽는 형태로 적은 것이며, 둘이 다르면 zod 스키마를 고치고 이 문서를 맞춘다. 상태 코드와 응답 형태는 Route Handler 계약 시험(Vitest, [[11-TESTING|11 테스트]])이 검사한다. 구조 결정은 ADR-017(Next.js + Supabase)이다.

## 1. 규칙

|항목|규칙|
|---|---|
|기본 경로|`/api/v1`. Next.js Route Handler(`web/app/api/v1/**/route.ts`)로 구현하고, §2 표의 경로는 `/api/v1` 뒤에 붙는다(예: `/me` = `/api/v1/me`). 헬스체크만 `/health/live`, `/health/ready`이며 같은 Next 앱의 라우트(`web/app/health/{live,ready}/route.ts`)다. `/health`(`web/app/health/route.ts`)는 회사 `redis-api` 역할에서만 열리는 readiness이고(서비스 token 필요, 다른 배포 역할은 404) 아래 "Redis HTTPS 접수 경계" 절이 정본이다. 별도 API 서버는 없다|
|표현|JSON camelCase. 시각 ISO8601 UTC(`2026-10-16T02:00:00Z`). ID는 UUID. 금액은 KRW 정수 **문자열**(`"450000000"`)|
|인증|Supabase Auth 세션. 브라우저는 `@supabase/ssr`가 관리하는 세션 쿠키(HttpOnly 아님, 이유는 [[09-SECURITY\|09 보안]] 인증), 스크립트·시연(S7 격리 시연, 스모크)은 `Authorization: Bearer <Supabase access token>`. 서버는 둘 다 Supabase로 서명·만료를 검증하고, DB는 그 사용자 권한(anon 키 + 사용자 토큰)으로 불러 RLS가 적용된다. 로그인·세션 갱신은 §2 표 아래 문단|
|CSRF|쿠키로 인증한 상태 변경 요청(POST/PUT/PATCH/DELETE)은 헤더 `X-Requested-With: sol-radar` 필수. 없으면 `403 CSRF_REJECTED`. `Authorization: Bearer` 요청은 쿠키를 쓰지 않으므로 제외. Server Action은 Next의 Origin 검사를 따른다|
|테넌트|`orgId`는 서버가 세션 사용자의 멤버십(`memberships`)에서 정한다. 요청 본문·쿼리의 조직 ID는 무시한다. 조직 데이터는 RLS(`org_id in (select public.my_org_ids())`)가 거르므로 다른 조직 자원은 행이 보이지 않아 `403`이 아니라 `404`|
|현재 조직|서버가 세션 사용자의 업무 멤버십(`organizations.personal_owner_id is null`인 조직)으로 정한다. 요청 본문·쿼리·헤더로 조직 ID를 받지 않는다. 업무 멤버십이 0개면 업무 API를 열지 않고(화면은 조직 초대 안내), 2개 이상이면 `403 UNSUPPORTED_ACCOUNT_STATE`. 경로에 조직 주소가 없고 조직 전환 UI도 없다. 개인 조직은 업무 멤버십 수에 들지 않는다([[16-DECISIONS\|ADR-021]])|
|권한|표의 권한 열은 `memberships.sol_role`의 **허용 역할 나열**이다. `ADMIN`이 다른 역할을 포함하는 순서 관계가 아니다([[09-SECURITY\|09 보안]] RBAC). `EXECUTIVE`(임원, ADR-052)는 VIEWER와 같은 읽기 권한에 회사 역량 조회를 더한 역할이다. 이 표에서 `VIEWER`가 있는 읽기 행은 `EXECUTIVE`에게도 열려 있고(행마다 따로 적지 않는다), 쓰기 행에는 `EXECUTIVE`가 없다. `auth` = 로그인한 조직 구성원(역할 무관), `public` = 인증 없음. `org_role`(owner·member)은 템플릿 호환용이라 이 열에 쓰지 않는다. 구성원 관리도 `sol_role=ADMIN`이다(RLS 정책은 `20261019000001`, [[16-DECISIONS\|ADR-021]]). `session`은 활동 중 Supabase 로그인 사용자로 조직 멤버십을 요구하지 않으며 가입 정보 보완 경로에만 사용|
|오류|`{"error":{"code":"...","message":"...","details":{...},"requestId":"..."}}`. 코드 전체는 §5|
|목록|`{"items":[...],"pageInfo":{"cursor":"...","nextCursor":"...\|null","hasNext":true}}`. 커서는 불투명 문자열|
|멱등|`POST /bids/:id/analyses`, `POST /admin/ingestion/runs`는 `Idempotency-Key` 헤더를 받는다. 같은 키 + 같은 본문이면 첫 응답을 다시 준다. 같은 키 + 다른 본문이면 `409 IDEMPOTENCY_KEY_REUSED`. 키 보존 24시간. 두 엔드포인트 모두 키가 없으면 서버가 UUID를 만든다(분석 [[16-DECISIONS\|ADR-030]] B20, 수동 수집 [[16-DECISIONS\|ADR-035]] F1. 서버가 만든 키는 클라이언트가 모르므로 재현되지 않는다). requestId(`Idempotency-Key` 값 또는 서버가 만든 UUID)는 `^[A-Za-z0-9_-]{1,128}$`만 받는다. 헤더 형식 검사는 엔드포인트마다 다르다. 분석은 UUID가 아니면, 수동 수집은 위 패턴이 아니면 `400 VALIDATION_ERROR`다. 분석의 저장 멱등 키는 `<org_id>:<requestId>`이고, DB check `score_runs_idempotency_key_org_check`가 `<org_id>:`로 시작하는지 강제한다([[04-DATABASE\|04 DB]] §3.4, [[16-DECISIONS\|ADR-031]] C5). 수동 수집의 저장 멱등 키(`ingest_runs.idempotency_key`)는 `<orgId>:<requestId>`, jobKey는 `manual:<orgId>:<requestId>`다. 같은 키 판정은 Redis `idem:ingest:<orgId>:<requestId>`(SET NX, 24시간)로 하고, 큐에 넣다 실패하면 그 키를 지워 같은 키로 다시 받게 한다|
|요청 ID|모든 응답에 `X-Request-Id`. 오류 본문의 `requestId`와 같은 값이다. 지금 구현은 응답마다 새 UUID를 만든다(`web/app/api/v1/_lib/http.ts`). 요청 헤더 값을 이어받지 않고, Supabase 호출에 넘기지 않아 `audit_logs.request_id`는 null이다. 500 오류 로그에만 같은 값이 남는다. 로그·감사까지 같은 값으로 잇는 것은 코드 후속이다([[16-DECISIONS\|16 ADR]] 미결정 26-4, 할 일은 [[PROGRESS]])|
|속도 제한|로그인·토큰 갱신은 Supabase Auth의 요청 제한을 쓴다(값은 Supabase 대시보드 설정으로 정하고 확인한다, 미검증). `/bids/:id/analyses` 조직당 30회/분, `POST /admin/ingestion/runs` 조직당 5회/분, `POST /bids/:id/analyses/:runId/insight` 사용자당 3회/분(§4.5 "추천 분석")은 Redis로 센다. 수동 수집은 `POST`만 센다(목록·단건 `GET`과 화면 polling은 세지 않는다). 초과 `429` + `Retry-After`. 횟수를 세는 Redis에 닿지 못하면 세 엔드포인트 모두 `503 SERVICE_UNAVAILABLE {component:"redis"}`|
|문서|계약의 원천은 zod 스키마다. OpenAPI 문서는 선택이며, 만들면 zod 스키마에서 생성하고 개발 환경에서만 노출한다|

## 2. 엔드포인트

|Method|Path|권한|기능|요청 → 응답|
|---|---|---|---|---|
|GET|`/health/live`|public|프로세스 생존|`200 {status:"ok"}`|
|GET|`/health/ready`|public|의존성 상태|`200 {status:"ok"\|"degraded", checks:{db,redis,storage,ai}}`. `checks.db` = Supabase(Postgres) 연결, `checks.storage` = Supabase Storage, `checks.ai ∈ "mock"\|"local"\|"hosted"\|"unavailable"`. db·redis·storage 중 하나라도 불가 = `503` + `status:"unavailable"`(같은 형태의 본문), AI만 불가 = `200` + `status:"degraded"`. `checks.storage`는 Worker의 private Storage 실검사 보고(Redis TTL 120초, DB URL·모드·bucket scope 검사)이고 보고가 없거나 만료되면 불가다. Vercel `frontend`는 Redis가 없어 회사 `redis-api`의 `/health` 결과를 그대로 낸다(`web/app/_lib/application-health.ts`)|
|GET|`/signup-options`|public|솔리데오 고정 가입 선택 목록(ID·표시명·버전만)|`SignupOptions`|
|GET|`/me/employment`|session(본인)|조직 합류 전에도 가입 신고 정보·완료 여부 조회|`EmploymentState`|
|PATCH|`/me/employment`|session(본인)|부서·직급/직책 필수 보완|`EmploymentInput` → `200 EmploymentState`|
|GET|`/me`|auth|**(미구현)** 세션 사용자·현재 조직·역할(`orgRole`·`solRole`)|`Me`|
|GET|`/me/kakao-notify`|session(본인)|개인 설정 "카카오톡 알림" 칸 상태([[16-DECISIONS\|ADR-038]], §9)|`KakaoNotifyView`|
|PATCH|`/me/kakao-notify`|session(본인)|카카오톡 알림 켜기·끄기|`KakaoNotifyEnabledInput` → `204`. 연결 전 켜기는 `409 KAKAO_NOT_CONNECTED`|
|DELETE|`/me/kakao-notify`|session(본인)|연결 해제(본인 연결 행을 지운다. 카카오 `unlink`는 부르지 않는다)|`204`|
|GET|`/me/kakao-notify/connect`|session(본인)|`state`를 만들어 카카오 인가 주소(`scope=talk_message`)로 보낸다|`307` 카카오 인가. 로그인이 아니거나 다른 사이트에서 온 이동이거나 카카오 설정이 없으면 `307 /settings?kakao=failed`|
|GET|`/me/kakao-notify/callback`|session(본인)|`state` 확인 → 코드를 토큰으로 → `talk_message` 동의 확인 → 암호화 저장|`307 /settings?kakao=connected\|consent_denied\|state_mismatch\|failed`|
|POST|`/me/kakao-notify/test`|session(본인)|시험 메시지 이벤트(`KAKAO_TEST`)를 쌓는다|`202 {queued:true}`. 연결·켬이 아니면 `409 KAKAO_NOT_READY`, 1분에 한 번·24시간 10회를 넘으면 `429 KAKAO_TEST_THROTTLED`|
|GET|`/bids`|`ADMIN, SALES, ANALYST, VIEWER`|목록·검색·필터·커서. 출처 필터 `origin=live\|demo\|all`. `watched=me`([[16-DECISIONS\|ADR-021]])|§3 → `Page<BidListItem>`|
|GET|`/bids/:id`|`ADMIN, SALES, ANALYST, VIEWER`|상세(최신 revision, 추출, 최신 분석, 검토, 첨부 다운로드·파싱 상태, 단계 연결, API 구조화 자격 필드, 분석 원문 준비)|`BidDetail`|
|GET|`/bids/:id/revisions`|`ADMIN, SALES, ANALYST, VIEWER`|revision 목록·변경 필드(최신 먼저)|`BidRevisionSummary[]`|
|GET|`/bids/:id/revisions/:rev`|`ADMIN, SALES, ANALYST, VIEWER`|특정 revision 정규화 본문|`NormalizedBid`|
|GET|`/bids/:id/documents/:documentId/download-url`|`ADMIN, SALES, ANALYST, VIEWER`|원본 첨부 서명 URL(ADR-048). 사용자 JWT+RLS로 문서와 공고 연결을 확인하고, download OK이며 Storage 원장 참조가 있는 문서만 발급한다. bucket·path는 요청에서 받지 않는다([[09-SECURITY\|09 보안]])|`200 {url, expiresIn:60}` + `Cache-Control: no-store`, 파일명 attachment. 없거나 읽을 수 없는 문서 `404`, Storage 오류 `503 {component:"storage"}`. 서명 URL은 로그에 남기지 않는다|
|GET|`/opportunities`|`ADMIN, SALES, ANALYST, VIEWER`|사업기회 목록(ADR-047). 검색어(`q`)·출처 계열(`sourceFamily`)·기관·회사·분야·단계·상태·권고·결정·`origin`·`watched=me` 필터, 정렬 4종, SI·AI 우선(기본 켬)·`includeEarly`(기본 끔), 커서·limit 기본 20·최대 100. `/bids`의 source record DTO와 `origin` 필터를 대체하지 않는다|`web/server/opportunities/query.ts` 쿼리 → `OpportunityPage`|
|GET|`/dashboard/opportunity-summary`|`ADMIN, SALES, ANALYST, VIEWER`|사업기회 집계. 현재 페이지와 독립적으로 DB 전체 범위를 센다|`?origin&asOf` → `OpportunitySummary`|
|GET|`/ingestion/source-summary`|`ADMIN, SALES, ANALYST, VIEWER`|출처(source family)별 수집 상태 요약|`?origin` → `SourceSummary`|
|GET|`/admin/ingestion/services`|`ADMIN`|외부 서비스별 수집 상태(관리자 화면)|`SourceSummary`. ADMIN이 아니면 `403`|
|GET|`/program-notices`|`ADMIN, SALES, ANALYST, VIEWER`|부처 지원사업 공고 목록([[16-DECISIONS\|ADR-040]]). SOL Score·권고·분석 대상이 아니다. 마감 판정의 오늘은 KST 날짜|`?source&q&sort&includeClosed` → 목록 JSON|
|GET|`/company-profile`|`ADMIN, EXECUTIVE`|현재 프로필(최신 revision). 그 밖의 역할은 `403 FORBIDDEN` "회사 역량은 ADMIN·EXECUTIVE만 조회할 수 있습니다"(ADR-052)|`CompanyProfile`|
|GET|`/company-profile/revisions`|`ADMIN, EXECUTIVE`|revision 이력. 역할 제한은 위와 같다(ADR-052)|`CompanyProfileSummary[]`|
|PUT|`/company-profile`|`ADMIN`|**(만들지 않음)** 새 revision 생성. [[16-DECISIONS\|ADR-052]] 8번이 비목표로 정했다. 새 revision은 운영자 CLI `pnpm ops:company-profile`만 넣는다(§4.4)|`CompanyProfileInput` → `201 CompanyProfile`|
|POST|`/bids/:id/analyses`|`ADMIN, SALES, ANALYST`|분석 요청(비동기). 중복·큐 계약은 §4.5|`AnalysisRequest` → `202 AnalysisAccepted`|
|GET|`/bids/:id/analyses`|`ADMIN, SALES, ANALYST, VIEWER`|이 공고의 분석 이력|`Page<AnalysisResult>`|
|GET|`/analyses/:id`|`ADMIN, SALES, ANALYST, VIEWER`|분석 상태·결과(polling)|`AnalysisResult`|
|POST|`/analyses/:id/what-if`|`ADMIN, SALES, ANALYST, VIEWER`|가정 재계산([[16-DECISIONS\|ADR-037]], 데모 강화 컷). 저장된 입력 스냅샷에 보유 가정을 얹어 규칙 엔진으로 다시 계산하고 아무것도 저장하지 않는다. 읽기 계산이라 역할 제한이 없다. 계약은 §4.5 "가정 재계산"|`WhatIfRequest` → `200 WhatIfResult`|
|POST|`/bids/:id/analyses/:runId/insight`|`ADMIN, SALES, ANALYST`|추천 분석 요청([[16-DECISIONS\|ADR-066]], 비동기). 본문 없음. 계약은 §4.5 "추천 분석"|`202 InsightAccepted`|
|GET|`/bids/:id/analyses/:runId/insight`|`ADMIN, SALES, ANALYST, VIEWER`|그 run 의 최신 추천 분석 1건(polling)|`{ insight: InsightView \| null }`|
|GET|`/bids/:id/qualification-checks`|`ADMIN, SALES, ANALYST, VIEWER`|최신 분석의 자격 판정(항목마다 사유 코드·회사 근거·값 출처)|`QualificationCheck[]`|
|GET|`/bids/:id/reviews`|`ADMIN, SALES, ANALYST, VIEWER`|검토 이력|`Review[]`|
|POST|`/bids/:id/reviews`|`ADMIN, SALES`|사람 최종 결정 기록|`ReviewInput` → `201 Review`|
|GET|`/dashboard/summary`|`ADMIN, SALES, ANALYST, VIEWER`|대시보드 요약. `origin` 쿼리를 받고 기본값은 `/bids`와 같다(`SOL_DEFAULT_ORIGIN`, 없으면 실행 모드, §3)|`?origin` → `DashboardSummary`|
|GET|`/notifications`|auth|내 알림 목록|`?unreadOnly&cursor&limit` → `Page<Notification>`|
|PATCH|`/notifications/:id/read`|auth(본인)|읽음 처리. 핵심 컷 Route Handler 10번째([[16-DECISIONS\|ADR-029]] A6 D8)|`200 Notification`. 남의 알림은 `404`|
|GET|`/departments`|`ADMIN, SALES, ANALYST, VIEWER`|조직도 트리([[16-DECISIONS\|ADR-021]]). 상위 없는 부서는 `parentId:null`. 부서마다 `memberCount`(그 부서 직속과 하위 부서의 재직 인원 합, 직원 ID 중복 제거. 본부·그룹 직속은 [[16-DECISIONS\|ADR-063]])와 `targetCount`(팀만, 본부·그룹은 null)|`Department[]`(§4.7)|
|GET|`/job-titles`|`ADMIN, SALES, ANALYST, VIEWER`|현재 조직 직급 카탈로그. UUID와 표시 코드 분리|`{id:string,code:string,label:string}[]`(§4.7)|
|GET|`/team-members`|`ADMIN, SALES, ANALYST, VIEWER`|가상 직원 명부(ADR-021). 사진 경로(없으면 null)와 점수 계산 대상 여부. 연락처 없음|`?q&departmentId&jobTitleId&scoring&cursor` → `Page<TeamMemberListItem>`(§4.7)|
|GET|`/team-members/:id`|`ADMIN, SALES, ANALYST, VIEWER`|개인 상세(ADR-021). 점수 계산 대상이면 직무·등급·스킬·가용성|`TeamMemberDetail`(§4.7)|
|PUT·DELETE|`/bids/:id/watch`|auth(본인)|관심 등록·해제. 멱등(P1, ADR-021)|`200 {bidId, watched, watcherCount}`. 조직·사용자는 세션에서 결정한다|
|GET|`/analyses`|`ADMIN, SALES, ANALYST, VIEWER`|조직 분석 이력. 비교는 `GET /analyses/:id`를 최대 4번 부른다(P1, ADR-021)|`?bidId&status&recommendation&runMode&cursor&limit` → `Page<AnalysisHistoryItem>`|
|GET|`/workforce/simulation`|auth|인력 배치 시뮬레이션. 공고 1~3건, 점수 계산 대상 200명 안의 후보, 저장 없음(P1, ADR-021)|`?bidIds=<UUID,...>` → `WorkforceResult` (중복 없는 1~3건)|
|POST·PATCH|`/team-members`, `/team-members/:id`|`ADMIN`|직원 운영 정보 편집(추가·부서/직급 이동·퇴사, N4b). 점수 속성은 받지 않는다(ADR-021). 계약은 §4.7.1|POST `{name,departmentId,jobTitleId,email?}` → `201 EditedTeamMember`, PATCH `{departmentId?,jobTitleId?,employmentStatus?}` → `200 EditedTeamMember`|
|GET·POST|`/projects`|조회 `ADMIN, SALES, ANALYST, VIEWER` / 생성 `ADMIN, SALES`|입찰 프로젝트 목록·생성. 생성은 추천(`BID`) 결정(`reviewId`) 필수(P1, ADR-021)|추천 결정이 없으면 `409 PROJECT_REQUIRES_BID_DECISION`|
|GET·PATCH|`/projects/:id`|조회 `ADMIN, SALES, ANALYST, VIEWER` / 변경 `ADMIN, SALES`|상세, 상태·담당자·마감 덮어쓰기(P1, ADR-021)|최신 결정이 추천(`BID`)이 아니면 상태 전진 `409 LATEST_DECISION_NOT_BID`|
|POST|`/projects/:id/result`|`ADMIN, SALES`|결과 기록(수동). 점수·결정 모델·학습에 쓰지 않는다(P1, ADR-021)|`{result, note?}` → `200 ProjectDetail`. `WON, LOST, CANCELLED, NOT_SUBMITTED`; 메모 최대 2000자|
|GET|`/admin/users`|`ADMIN`|**(만들지 않음)** 이 조직의 구성원 목록(템플릿 `memberships` + `profiles`)|`User[]`|
|POST|`/admin/users/invite`|`ADMIN`|**(만들지 않음)** 초대(이메일·업무 역할). 템플릿 조직 초대 기능: `invitations` 행 + 초대 메일(SMTP 설정이 없으면 메일 없이 초대만 저장)|`InviteInput` → `201 Invitation`|
|PATCH|`/admin/users/:id`|`ADMIN`|**(만들지 않음)** 업무 역할 변경(`memberships.sol_role`). `:id`는 구성원의 사용자 ID(`profiles.id`). 이 조직 구성원이 아니면 `404`|`UserPatch` → `200 User`|
|DELETE|`/admin/users/:id`|`ADMIN`|**(만들지 않음)** 비활성화 = 이 조직에서 내보내기(`memberships` 행 삭제, 템플릿 구성원 기능). 계정 자체 정지(`profiles.status='suspended'`)는 서비스 운영자(`profiles.is_admin`) 기능이라 이 API에 없다|`204`|
|POST|`/admin/ingestion/runs`|`ADMIN`|수동 수집(멱등, §1). 소스는 `g2b`(나라장터 Open API), 외부 서비스 `kwater`·`lh`·`kepco`([[16-DECISIONS\|ADR-047]]) 또는 `fixture`. 실행 모드와 맞지 않는 소스는 `409 RUN_MODE_MISMATCH`. 검사 순서: 역할 → `Idempotency-Key` 형식 → 본문 크기(16KB) → 속도 제한 → 본문 검증(`window.to`가 지금보다 5분 넘게 미래면 400) → 실행 모드 → 멱등 재현 → 서비스 준비(나라장터 입찰공고 밖 서비스, 즉 조달요청·K-water·LH·KEPCO만. Worker가 남긴 서비스 상태가 준비가 아니면 `503 {component:"source"}`) → 진행 중(같은 source의 `RUNNING` 행이면 `409 INGESTION_IN_PROGRESS {runId}`. 큐에만 있는 job은 막지 않는다. worker가 jobKey로 멱등 처리한다) → (fixture 밖 공공 API 소스만) 정기 일정 등록 확인(없으면 `503 {component:"ingest-worker"}`) → 수동 gate(§5 `MANUAL_*`) → 키 잡기 → 큐. Route Handler는 job만 넣는다. run id를 만들어 job data `runId`로 넘기고, worker가 그 id로 `ingest_runs` 행을 만든다. 202 본문은 행이 생기기 전 모습(`status:"RUNNING"`, summary 0)을 합성한 것이다(§6.5)|`IngestionRunInput` → `202 IngestionRun`|
|GET|`/admin/ingestion/runs`|`ADMIN`|수집 이력. `started_at desc, id desc` keyset, 조직에 묶인 HMAC 커서(커서 비밀이 없으면 `503 {component:"cursor"}`)|`?cursor&limit` → `Page<IngestionRun>`|
|GET|`/admin/ingestion/runs/:id`|`ADMIN`|수집 결과·오류. id가 UUID가 아니거나 행이 없으면 `404 {resource:"ingestionRun"}`. 202 뒤 worker가 행을 만들기 전에도 404이고, 화면은 이력 표를 polling한다|`IngestionRun`|
|GET|`/admin/ingestion/manual-gate`|`ADMIN`|수동 수집 gate 상태. 화면의 [지금 불러오기]·다음 가능 시각·정기 일정 줄이 쓴다. frontend(Vercel)는 권한을 먼저 보고 회사 redis-api로 중계한다(같은 403). Redis를 읽지 못하면 `503 {component:"redis"}`. 규칙: 같은 사용자 60분 쿨다운, 누가 했든 전역 공유 실행 10분, KST 하루 20회(`web/server/ingestion/manual-ingest-gate.model.ts`)|`ManualIngestGateView` `{cooldownMinutes, nextAvailableAt, sharedRun:{runId,requestedAt,until,mine}\|null, daily:{used,limit,resetsAt}, schedule:{pattern,timezone,slotHoursKst,active,nextRunAt}, ingestMode, services}`. `schedule.active`·`nextRunAt`은 ingest 큐 Job Scheduler `g2b-scheduled`의 실제 등록 상태, `ingestMode`는 redis-api의 `SOL_INGEST_MODE`(없으면 `SOL_RUN_MODE`), `services`는 Worker가 남긴 외부 서비스별 상태(없으면 null)|
|GET|`/admin/sources`|`ADMIN`|**(미구현)** 수집 소스 registry 항목별 승인·호출량·최근 성공/오류|`SourceStatus[]`|
|GET|`/admin/ai/status`|`ADMIN`|실행 모드, AI 공급자, Qwen·결정 모델(Bosun) 상태, 레지스트리 일치, 파서 목록|`AiStatus`|
|GET|`/admin/ai/models`|`ADMIN`|**(미구현)** 모델 레지스트리 항목과 현재 활성 항목(gateway `/health`에서 읽음)|`ModelRegistryStatus`|
|GET|`/admin/ai/eval-runs`|`ADMIN`|**(미구현)** 평가 실행 요약 목록|`?cursor&limit` → `Page<EvalRunSummary>`|
|GET|`/admin/ai/eval-runs/:id`|`ADMIN`|**(미구현)** 평가 리포트 전체|`EvalRunReport`|

**(미구현)**·**(만들지 않음)**을 붙인 행은 Route Handler가 없어 404다. `/admin/sources`가 없으므로 [[11-TESTING|11]] §5.2 4번의 오늘 호출량은 Redis 예산 카운터와 `/admin/ingestion` 실행 상세의 호출 수로 본다. `/admin/users*`는 만들지 않는다([[16-DECISIONS|ADR-068]] 2번). 업무 역할 변경·초대·초대 취소·가입 승인은 업무 화면 `/settings/organization`의 서버 액션(`web/app/(app)/(work)/settings/organization/actions.ts`, [[16-DECISIONS|ADR-021]] N2)이 맡는다. 템플릿 구성원 화면(`/[slug]/settings/members`)과 계정 정지 템플릿 API(`/api/admin/users/:id/status`, 서비스 운영자 전용)도 남아 있다.

로그인·로그아웃·비밀번호 재설정·초대 수락·토큰 갱신은 이 API에 없다. Supabase Auth가 맡고, 화면은 템플릿의 `/auth/login`·`/auth/reset`·`/auth/password`와 조직 초대 수락 화면이다(§6.1, [[09-SECURITY|09 보안]] 인증). Auth 콜백 Route Handler `/auth/callback`·`/auth/confirm`도 템플릿 것이고 이 계약 밖이다. 세션 갱신은 `@supabase/ssr`가 한다(화면 요청은 `web/proxy.ts`).

범위 밖(이번 해커톤에서 만들지 않음): 인력 배치 저장·배정 확정 API(해커톤 이후), 경쟁사 분석, 알림 모두 읽음·알림 유형 필터(API가 없고 핵심 컷 화면에서도 뺀다, [[16-DECISIONS|ADR-029]] A6 D7). 인력 배치 시뮬레이션 조회(`GET /workforce/simulation`)는 P1이다([[16-DECISIONS|ADR-021]]).

[[16-DECISIONS|ADR-020]]으로 더하거나 넓힌 것: `/bids`(`origin` 필터·`origin`·`documentsStatus`), `/bids/:id`(첨부 상태·`stageLinks`·`structuredQualifications`), `/analyses/:id`(`runMode`·`requirementAssessments`·결정 모델 v0.2·`fallbackReason`), `/bids/:id/qualification-checks`(`reasonCode`·`companyEvidence`·`basis`), `/admin/ingestion/runs`(본문 확장), `/admin/sources`·`/admin/ai/models`·`/admin/ai/eval-runs`(새로), `/admin/ai/status`(응답 확장). 데이터셋 빌드·내보내기와 평가 실행은 운영자 CLI가 한다([[21-MODEL-TRAINING|21 모델 학습]] §6). 웹에서 이것들을 시작하는 엔드포인트는 해커톤에 두지 않는다. 평가 결과는 `pnpm eval:publish`(미구현, `package.json`에 없다)가 `eval_runs` 표([[04-DATABASE|04 DB]] §3.7)에 올리고 웹은 읽기만 한다. 평가 실험(E0~E4)은 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이고, 회사 서버에서 돌린 평가 기록은 없다.

[[16-DECISIONS|ADR-021]]으로 더하거나 넓힌 것: `/departments`·`/team-members`·`/team-members/:id`(데모 필수, 조직·인력 조회), `/dashboard/summary`(`analyses.latestByStatus`), §1 현재 조직 규칙과 `403 UNSUPPORTED_ACCOUNT_STATE`.

API가 없는 화면(의도한 예외): [[16-DECISIONS|ADR-060]]의 새 메뉴 자격 갭 레이더(`/gaps`)·발주 현황(`/market`)·입찰 일정(`/calendar`)은 서버 컴포넌트가 사용자 세션(RLS)으로 도메인 함수(`@/server/gaps` `getGapRadar`·`@/server/market` `getMarketOverview`·`@/server/calendar` `getCalendarEvents`)를 직접 부른다. `/api/v1` 경로는 없다. 화면 계약은 [[06-UI-UX|06 UI]]다.

### P1 조회·저장 계약

구현 기준은 `polaris/specs/done/`의 N5·N7 스펙이다.

- 관심 PUT·DELETE는 멱등이며 본인 행만 저장한다. `watched=me` 커서는 조직·사용자·필터에 묶는다. 현재 `/opportunities`도 같은 본인 범위를 지원한다.
- 분석 이력은 `created_at desc, id desc`, limit 기본20·최대100이다. 항목은 공고 제목·DEMO와 분석 ID/revision/프로필 revision/상태/모드/점수/권고/실패 사유/reviewFlags/시각/알고리즘 버전이며 입력 스냅샷은 싣지 않는다. 커서는 조직·필터에 묶는다. 비교는 기존 단건 조회 2~4회, 분석 실행·저장 없음이다.
- 프로젝트 POST `{reviewId}`는 새로 열면 `201`, 닫힌 프로젝트를 다시 열면 `200`으로 상세를 반환한다. PATCH는 상태·담당자·제출 마감 변경을 원자적으로 처리한다. 다른 조직 자원404, 읽기 전용 역할의 변경403, 최신 결정이 추천이 아닐 때 전진409다. 종료는 허용한다. 수동 결과는 점수·모델·학습 입력에 연결하지 않는다. 체크리스트는 인증된 서버 액션과 기존 task 서비스/RLS를 쓴다.
- 인력 시뮬레이션은 검증된 최신 완료/부분 분석 스냅샷의 FTE·기준 시각과 현재 배정의 기준 시각·과부하·공유 후보를 분리한다. 스냅샷이 없으면 분석 필요로 표시한다. 연락처·성별을 응답하지 않고 배정·분석·점수를 저장하지 않는다.
- `DashboardSummary.projects.active`는 현재 origin과 같은 범위에서 종료를 제외한 프로젝트 수다. 기존 분석 요약 필드는 유지한다.

## 3. `GET /bids` 쿼리 파라미터

|파라미터|타입|기본|검증|의미|
|---|---|---|---|---|
|`q`|string|—|1~100자|제목·기관·공고번호 검색(trigram). 비어 있으면 전체|
|`stage`|`PLAN\|PROCUREMENT_REQUEST\|PRE_SPEC\|NOTICE\|OPENING\|AWARD\|CONTRACT`, 반복 가능|전체|ENUM|단계 필터|
|`status`|`OPEN\|AMENDED\|CANCELLED\|CLOSED`, 반복 가능|`OPEN,AMENDED`|ENUM|상태 필터. 명시하면 그 값만. 기본값은 취소 공고(`CANCELLED`)를 숨긴다. 화면 `/bids`의 상태 필터에는 "취소 포함" 선택지가 있고, 고르면 `CANCELLED`도 함께 읽어 그 행에 "취소됨"을 표시한다. 공고 상세(`GET /bids/:id`)는 상태와 상관없이 열린다([[16-DECISIONS\|ADR-029]] A7). 저장 상태는 `OPEN`·`AMENDED`·`CANCELLED`이고, `CLOSED`는 수집 정규화가 만들지 않고 조회할 때 `deadlineAt`으로 계산한다([[15-DATA-CONTRACTS\|15]] §3, [[16-DECISIONS\|ADR-030]] B14). 기본값 `OPEN,AMENDED`는 이렇게 계산한 `CLOSED`(마감 지남)도 뺀다. "취소 포함"은 `CANCELLED`만 더하고 `CLOSED`는 더하지 않는다([[16-DECISIONS\|ADR-031]] C15)|
|`agencies`|string, 반복 가능(`agencies=a&agencies=b`)|—|각 1~100자, 최대 10개|**(미구현)** 발주기관 정확 일치|
|`budgetMin`, `budgetMax`|KRW 정수 문자열|—|`>= 0`, `min <= max`|**(미구현)** 예산 범위. 예산 `null`인 공고는 범위 필터에 걸리지 않고 제외된다|
|`deadlineFrom`, `deadlineTo`|ISO8601|—|`from <= to`|마감 범위. 마감 `null`은 제외|
|`scoreMin`|int|—|0~100|**(미구현)** 최신 분석(`COMPLETED`/`PARTIAL`)의 SOL Score 이상. 분석 없는 공고는 제외|
|`recommendation`|`BID\|WATCH\|NO_BID`, 반복 가능|—|ENUM|최신 분석의 시스템 권고. 화면 표기는 추천(`BID`)·보류(`WATCH`)·비추천(`NO_BID`)|
|`decision`|`BID\|WATCH\|NO_BID\|NONE`, 반복 가능|—|ENUM|최신 사람 결정. `NONE` = 미결정|
|`hasAnalysis`|boolean|—|—|**(미구현)** 분석 존재 여부|
|`origin`|`live\|demo\|all`|서버 env `SOL_DEFAULT_ORIGIN`(`live`·`demo`·`all`). 없거나 틀리면 실행 모드: `live`면 `live`, `fixture`·`mock`이면 `demo`(`web/server/bids/bid-query.ts` `defaultOrigin`)|ENUM|출처 필터([[16-DECISIONS\|ADR-020]]). 실행 모드와 따로 둔 이유는 회사 런타임이 `live`여도 화면 기본 출처를 정할 수 있게 하려는 것이다). 운영 Production은 `SOL_DEFAULT_ORIGIN=live`라 기본이 실공고다. 원래 기본값이 실행 모드를 따르는 이유는 모드마다 그 모드의 데이터만 기본으로 보여 live 공고와 fixture 공고가 섞이지 않게 하려는 것이다. 둘 다 보려면 `all`([[19-DEMO-SCENARIO\|19 데모]] §2.1). `live` = 나라장터에서 수집한 공고(`is_demo=false`), `demo` = fixture 등 가상 공고(`is_demo=true`)|
|`isDemo`|boolean|—|—|DEMO 공고만/제외. 생략 시 둘 다. `isDemo=true`는 `origin=demo`, `false`는 `origin=live`와 같다. 둘을 함께 주고 뜻이 다르면 `400 VALIDATION_ERROR`|
|`sort`|`publishedAt:desc\|publishedAt:asc\|deadlineAt:asc\|deadlineAt:desc\|score:desc\|budgetKrw:desc`|`publishedAt:desc`|ENUM|정렬. `score:desc`는 분석 없는 공고를 뒤로|
|`cursor`|string|—|서버 발급 값|이전 응답의 `nextCursor`. 변조는 `400 INVALID_CURSOR`|
|`limit`|int|20|1~100|페이지 크기|
|`watched`|`me`|—|ENUM|본인 관심 공고만(P1, [[16-DECISIONS\|ADR-021]])|

**(미구현)**을 붙인 필터 5개(`agencies`·`budgetMin`·`budgetMax`·`scoreMin`·`hasAnalysis`)는 지금 파서(`web/server/bids/bid-query.ts` `parseBidListQuery`)가 읽지 않는다. 보내도 400이 아니라 무시되고 필터 없이 200이다(파서는 정해 둔 키만 꺼내 검증한다). 화면도 이 필터를 보내지 않는다.

커서는 `(sort 키 값, id)`를 base64url로 인코딩하고 HMAC(키: 서버 전용 env `API_CURSOR_SECRET`, [[10-DEPLOYMENT|10 배포]])을 붙인다. 필터·정렬이 바뀌면 커서를 버리고 처음부터 요청한다.

## 4. DTO

실제 소스는 `web/server/<도메인>/*.model.ts`의 zod 스키마이고, TS 타입은 `z.infer`로 얻는다([[16-DECISIONS|16 ADR]] ADR-016). 아래는 같은 내용을 TS 인터페이스로 적은 것이다. 아래에 다시 적지 않는 타입의 정본: `EvidenceRef`, `FieldState`, `ExtractedField`, `NormalizedBid`는 [[15-DATA-CONTRACTS|15 데이터 계약]], `CompanyEvidenceRef`·`KevStateTrace`는 15 §2.1, `RequirementExtraction`·`KevAssist`(v0.2 필드 포함)는 [[03-AI-PIPELINE|03 AI 파이프라인]](`KevAssist`는 §5.7)이다.

### 4.1 공통

```ts
interface PageInfo { cursor: string | null; nextCursor: string | null; hasNext: boolean }
interface Page<T> { items: T[]; pageInfo: PageInfo }
interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string }
}
type Role = "ADMIN" | "SALES" | "ANALYST" | "EXECUTIVE" | "VIEWER";   // memberships.sol_role. §2 권한 열이 보는 값. EXECUTIVE = VIEWER + 회사 역량 조회(ADR-052)
type OrgRole = "owner" | "member";                      // memberships.org_role. 조직 관리(초대·구성원)용, 템플릿 값
type BidStage = "PLAN" | "PROCUREMENT_REQUEST" | "PRE_SPEC" | "NOTICE" | "OPENING" | "AWARD" | "CONTRACT";
type BidStatus = "OPEN" | "AMENDED" | "CANCELLED" | "CLOSED";
type Recommendation = "BID" | "WATCH" | "NO_BID";
type RecommendationBasis = "RULES_ONLY" | "RULES_WITH_KEV_ASSIST";
type AnalysisStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
type QualificationOutcome = "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW";   // 규칙 판정·결정 모델 항목 질문·평가셋 라벨이 같은 3값(08 §5.1)
type NeedsReviewReason = "NOTICE_INFO_MISSING" | "NOTICE_CONFLICTED" | "COMPANY_EVIDENCE_MISSING"
  | "AMBIGUOUS_MATCH" | "PARSE_UNSUPPORTED" | "STAGE_NOT_APPLICABLE";       // NEEDS_REVIEW 사유(08 §5.1)
type RequirementBasis = "API_FIELD" | "EXTRACTION";                         // 공고 쪽 값의 출처. 둘 다 있으면 API_FIELD 우선
type RequirementItemKind = "SKILL" | "PAST_PERFORMANCE" | "STAFFING" | "QUALIFICATION";
type ReviewFlag = "MODEL_RULE_DISAGREEMENT" | "KEV_MANDATORY_RISK" | "KEV_NEEDS_REVIEW"
  | "KEV_REQUIREMENT_DISAGREEMENT" | "KEV_DELIVERY_RISK" | "CITATION_FAILED"
  | "EXTRACTION_FAILED" | "EXTRACTION_LOW_CONFIDENCE" | "AI_UNAVAILABLE" | "QWEN_UNAVAILABLE" | "KEV_UNAVAILABLE"
  | "MOCK_FALLBACK" | "PARSE_UNSUPPORTED" | "DOCUMENT_DOWNLOAD_FAILED"
  | "INSUFFICIENT_DATA" | "INJECTION_SUSPECTED" | "SCALE_LIMIT_EXCEEDED" | "TRANSLATION_INCOMPLETE";    // 조건은 08 §5.3·§5.4. KEV_UNAVAILABLE = 결정 모델 미접속·timeout + 결정 모델 응답 형식 오류(§5, ADR-031 C6)
type FactorKey = "skillMatch" | "pastPerformance" | "staffAvailability" | "scaleFit" | "strategicPreference";
type MissingReason = "NO_REQUIREMENTS_EXTRACTED" | "PROFILE_TECHNOLOGIES_EMPTY" | "BID_DOMAIN_UNKNOWN" | "PROFILE_PROJECTS_EMPTY"
  | "REQUIRED_FTE_UNKNOWN" | "TEAM_EMPTY" | "BUDGET_UNKNOWN" | "PREFERENCES_NOT_SET";   // 요소가 missing인 사유(08 §4 표, ADR-029 A6 D16)
type RunMode = "live" | "fixture" | "mock";        // env SOL_RUN_MODE와 같은 소문자. DB는 대문자(04 run_mode)
type BidOrigin = "live" | "demo";                  // is_demo=false → live, true → demo
// CompanyEvidenceRef(회사 쪽 근거)는 15 §2.1 정본
```

### 4.2 인증·사용자

로그인 입력·토큰 DTO는 없다(§2 표 아래 문단).

```ts
interface Me {
  id: string; email: string; name: string;   // profiles.id(= auth.users.id)·email·display_name
  employment: EmploymentInfo | null; profileComplete: boolean;  // 가입 신고 정보, 권한 아님
  orgRole: OrgRole;                // 현재 조직의 memberships.org_role
  solRole: Role;                   // 현재 조직의 memberships.sol_role
  organization: { id: string; name: string; slug: string; isDemo: boolean };
  permissions: string[];           // 예: ["bids:read","analyses:create","reviews:create"]. solRole과 리소스별 정책에서 파생
  sessionExpiresAt: string;        // Supabase access token 만료 시각(JWT exp)
  accountState: "READY" | "NO_ORG" | "MULTIPLE_ORGS";  // 업무 멤버십 1개 / 0개 / 2개 이상(ADR-021, §1 현재 조직). READY가 아닐 때 organization·orgRole·solRole 값과 필드 이름은 구현 때 zod 모델과 맞춘다
}
interface User {                   // 조직 구성원 = memberships + profiles
  id: string; email: string; name: string;
  orgRole: OrgRole; solRole: Role;
  employment: EmploymentInfo | null; profileComplete: boolean;
  status: "active" | "suspended";  // profiles.status. suspended = 서비스 운영자가 정지(로그인과 조직 데이터가 막힌다)
  joinedAt: string;                // memberships.created_at
}
interface InviteInput { email: string; solRole: Role }   // 수락하면 이 업무 역할로 구성원이 된다
interface Invitation {             // 템플릿 invitations 행 + sol_role 열
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
  origin: BidOrigin;               // isDemo에서 파생. 목록 출처 배지
  documentsStatus: {               // 최신 revision 첨부(bid_documents) 집계. 첨부가 없으면 total 0
    total: number; pending: number; parsed: number; partial: number;
    unsupported: number; failed: number; downloadFailed: number;
  };                               // downloadFailed > 0 → DOCUMENT_DOWNLOAD_FAILED 배지, partial·unsupported·failed > 0 → PARSE_UNSUPPORTED 배지
  latestAnalysis: {                // 이 조직의 최신 run. 없으면 null
    id: string; status: AnalysisStatus; solScore: number | null; recommendation: Recommendation | null;
    recommendationBasis: RecommendationBasis | null; reviewFlags: ReviewFlag[]; createdAt: string;
  } | null;
  latestReview: { decision: Recommendation; decidedAt: string; reviewerName: string } | null;
}
interface BidRevisionSummary { id: string; revision: number; amendmentNo: string | null; fetchedAt: string; checksum: string; changedFields: string[] }
interface BidDocument {
  id: string; name: string; mimeType: string | null; sizeBytes: number | null;   // 다운로드 전·실패면 null
  format: string | null;           // 내용(매직 바이트)으로 판정한 형식. gateway /parse 응답 값
  downloadStatus: "PENDING" | "OK" | "FAILED";
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "UNSUPPORTED" | "FAILED" | null;  // 다운로드 전·실패면 null
  downloadErrorCode: "AUTH_REQUIRED" | "HTTP_4XX" | "HTTP_5XX" | "REDIRECT_BLOCKED" | "HOST_NOT_ALLOWED" | "TOO_LARGE" | "TIMEOUT" | null;
  pageCount: number | null;
  parseErrorCode: "UNSUPPORTED_FORMAT" | "NO_TEXT_LAYER" | "ENCRYPTED" | "DISTRIBUTION_PROTECTED" | "TOO_LARGE" | "CORRUPTED" | "PARSER_ERROR" | null;
  downloadPath: string | null;     // 항상 null(bids.supabase.ts). 화면은 GET /bids/:id/documents/:documentId/download-url 을 부른다
}
interface StructuredRequirement {  // 공고 API가 구조화 필드로 준 자격 조건(04 bid_structured_requirements)
  kind: "LICENSE_LIMIT" | "PERMITTED_INDUSTRY" | "PARTICIPATION_REGION" | "REGIONAL_JOINT_CONTRACT";
  code: string | null; name: string | null; value: Record<string, unknown>; sourceOperation: string;
}
interface BidDetail extends BidListItem {
  content: string;                 // 최신 revision 정규화 본문
  noticeAgency: string | null;     // 공고기관(G2B ntceInsttNm). 원본에 있을 때만. agency 는 수요기관이다
  sourceUrlKind: "NOTICE" | "SERVICE_DOCUMENTATION";   // SERVICE_DOCUMENTATION = 저장된 sourceUrl 이 원본 공고가 아니라 공공데이터 서비스 안내 페이지
  original: NormalizedBid["original"];
  revisions: BidRevisionSummary[];
  documents: BidDocument[];
  stageLinks: { planRef: string | null; preSpecRef: string | null };   // 발주계획 orderPlanUntyNo · 사전규격 bfSpecRgstNo
  structuredQualifications: StructuredRequirement[];                    // fixture 공고는 비어 있을 수 있다
  extraction: RequirementExtraction | null;   // 최신 revision의 COMPLETED/PENDING_REVIEW 추출
  extractionStatus: "PENDING" | "COMPLETED" | "PENDING_REVIEW" | "FAILED" | "NONE";
  latestAnalysis: AnalysisResult | null;      // 목록의 요약 대신 전체
  reviews: Review[];
  analysisReadiness: { ready: boolean; reason: "SOURCE_TEXT_MISSING" | null };   // 분석 원문(최신 revision 본문·파싱된 첨부 텍스트) 준비. ready=false 면 분석 요청은 409 ANALYSIS_SOURCE_MISSING
}
```

### 4.4 회사 프로필

```ts
interface CompanyProfile {
  id: string; orgId: string; revision: number; name: string;
  isDemo: boolean;                 // true = 가상 프로필(로컬·시험·demo:reset, ADR-020). false = 운영 DB의 공개 자료 프로필(ADR-052). 공고 상세 배지는 분석에 쓴 프로필의 이 값으로 고른다(true면 "가상 회사 프로필로 분석", false면 "공개 자료 회사 프로필로 분석"). 회사 역량 화면(`/company`)은 false일 때 "공개 자료 기준 · 확인일 …"
  technologies: { name: string; level?: "BASIC" | "INTERMEDIATE" | "EXPERT"; yearsOfExperience?: number; sourceIds?: string[] }[];   // sourceIds: sources[].id (ADR-052). licenses·industryCodes·pastProjects·financials 항목에도 같은 선택 필드
  technologiesComplete: boolean;   // true면 technologies가 전체 목록. 목록에 없는 기술이 명시적 부정 근거가 된다. 기본 false
  licenses: { code: string; name: string; status: "HELD" | "NOT_HELD"; validUntil?: string }[];  // code는 qualification-codes.yaml 키. NOT_HELD = 보유하지 않음을 확인
  industryCodes: { code: string; name: string; status: "HELD" | "NOT_HELD" }[];                  // 나라장터 업종 마스터 코드
  pastProjects: { title: string; agency?: string; amountKrw: string | null; startedAt: string; endedAt: string | null; domain: string; isPublicSector: boolean }[];   // null = 공개 자료에 없음(추정하지 않는다, ADR-052). 구현 모양은 아래 주석 참고
  financials: { fiscalYear: number; annualRevenueKrw?: string; capitalKrw?: string; employeeCount?: number; creditRating?: string; maxContractKrw?: string } | null;  // maxContractKrw: 단일 사업 수행 상한(scaleFit 입력)
  preferences: { agencies: string[]; agencyTypes: string[]; domains: string[]; excludedDomains: string[]; excludedKeywords: string[] } | null;  // agencyTypes 예: "교육청"; excludedDomains 예: "국방"
  sources: ProfileSource[];        // 프로필 값의 출처. 없으면 [] (ADR-052)
  publicHistory: PublicHistoryEntry[];   // 점수에 쓰지 않는 인증·등록·수상 연혁. 없으면 []
  effectiveAt: string; createdBy: { id: string; name: string }; createdAt: string; note: string | null;
}
interface ProfileSource { id: string; kind: "PUBLIC" | "COMPANY_CONFIRMED"; title: string; url: string | null; retrievedAt: string; confirmedBy?: string; quote?: string }   // COMPANY_CONFIRMED = 공개 조회로 확인하지 못해 회사가 보유를 확인한 자격
interface PublicHistoryEntry { year: number; kind: "CERTIFICATION" | "REGISTRATION" | "AWARD"; name: string; sourceIds: string[] }
type CompanyProfileSummary = Pick<CompanyProfile, "id" | "revision" | "effectiveAt" | "createdBy" | "createdAt" | "note">;   // revision 목록 요약. gateway /kev의 profileSummary(03 §5.7, CompanyProfile 전체 + 선택 staffAvailability)와 이름만 같고 다른 것이다(ADR-030 B5)
interface CompanyProfileInput extends Omit<CompanyProfile, "id" | "orgId" | "revision" | "isDemo" | "createdBy" | "createdAt"> {
  baseRevision: number;            // 현재 최신 revision. 다르면 409 PROFILE_REVISION_CONFLICT
}
```

명시적 부정 필드(`licenses[].status`, `industryCodes[].status`, `technologiesComplete`)가 있는 이유: 자격 판정의 미충족(`NOT_SATISFIED`)에는 회사 쪽 명시적 부정 근거가 필요하다. 목록에 없다는 사실만으로는 미충족이 아니라 `NEEDS_REVIEW`(`COMPANY_EVIDENCE_MISSING`)다([[08-SCORING|08 점수]] §5.1). `isDemo`는 입력에서 받지 않는다. 가상(`true`) revision은 `pnpm demo:reset`(`scripts/demo-reset.mjs`)이, 공개 자료(`false`) revision은 운영자 CLI(`pnpm ops:company-profile`, service role)가 넣는다. 화면·API로 넣는 길은 없다([[16-DECISIONS|ADR-052]] 8번). `CompanyProfileInput`은 만들지 않는 `PUT /company-profile`의 입력 모양으로 남겨 둔 설계다.

ADR-052 반영 사항(코드 정본은 `web/server/company-profile/company-profile.model.ts`와 `web/server/scoring/analysis-input.model.ts`):

- 실적의 `amountKrw`와 완료일(구현 이름 `completedAt`)은 `null`일 수 있다. `null`은 "공개 자료에 없음"이고 점수는 중립값을 쓴다([[08-SCORING|08 점수]] §3.2). 구현의 `pastProjects[]`는 08 §3.2 모양(`id`·`name`·`domain`·`amountKrw`·`completedAt`·`evidenceRef` + 선택 `note`·`sourceIds`)이고 위 `title`·`startedAt`·`endedAt` 표기와 다르다(ADR-030 C4). `financials`에도 선택 `note`가 있다.
- 응답에 `sources`와 `publicHistory`(`publicHistory`는 DB 열 `public_history`)가 있다. 가상 fixture 프로필은 둘 다 빈 배열이다.
- 두 GET은 `ADMIN`·`EXECUTIVE`만 읽는다. 다른 역할은 `403 FORBIDDEN`이다. DB RLS는 조직 전원 읽기 그대로다. 분석 요청은 사용자 세션으로 프로필의 `id`·`revision`을 읽고 `score_runs.input_snapshot`에 사본이 남기 때문이다([[16-DECISIONS|ADR-052]]).

### 4.5 분석

분석 결과는 규칙 엔진(`web/server/scoring`) 출력을 파이프라인이 저장·변환해 만든다. 이름이 다른 곳은 API가 이 문서의 이름을 쓴다(`score` → `solScore`, `factors` → `scoreBreakdown`, `qualificationStatus`·`qualificationChecks` → `qualification`). `missingFactors`의 모양(`{factor, reason}`), `ScoreFactor.missingReason`, `profileEvidence[].type`의 `INDUSTRY_CODE`는 규칙 엔진을 따른다([[16-DECISIONS|ADR-029]] A6 D16).

```ts
interface AnalysisRequest {
  profileRevision?: number;        // 생략 시 최신
  force?: boolean;                 // true: 같은 입력(revision·프로필·알고리즘)에 완료된 run이 있어도 새 run 생성. 이전 run은 보존. 진행 중 run이 있으면 409 ANALYSIS_IN_PROGRESS
                                   // false(기본): 같은 입력의 완료 run 또는 진행 중 run이 있으면 그 run을 돌려준다(202, deduplicated=true)
}
interface AnalysisAccepted { analysisId: string; status: AnalysisStatus; deduplicated: boolean; pollUrl: string }

interface ScoreFactor {
  factor: FactorKey; rawValue: unknown; normalized: number | null; points: number; maxPoints: number;
  missing: boolean; missingReason: MissingReason | null;   // missing=true일 때만 값이 있다(화면의 "미확인" 사유)
  evidence: EvidenceRef[]; note: string | null;
}
interface QualificationCheck {
  id: string; requirementCode: string | null; requirementName: string; mandatory: boolean;
  outcome: QualificationOutcome; reason: string;
  reasonCode: NeedsReviewReason | null;                          // outcome=NEEDS_REVIEW일 때만 값이 있다
  basis: RequirementBasis;                                       // 공고 쪽 값이 API 구조화 필드에서 왔는지, Qwen 추출에서 왔는지
  evidence: EvidenceRef[];                                       // 공고 쪽 근거
  profileEvidence: { type: "LICENSE" | "INDUSTRY_CODE" | "PAST_PROJECT" | "TECHNOLOGY" | "FINANCIAL"; ref: string; label: string }[];  // 프로필 쪽 근거(표시용 요약). INDUSTRY_CODE 예: FX-03 정보통신공사업
  companyEvidence: CompanyEvidenceRef[];                         // 회사 쪽 근거(추적용). NOT_SATISFIED면 명시적 부정 근거가 1개 이상
  checkedAt: string;
}
interface RequirementAssessment {                                // 요구사항 항목 하나(04 requirement_assessments)
  itemId: string;                                                // 추출 필드 경로. 예: "requiredSkills[2]". 항목 문구는 BidDetail.extraction에서 이 경로로 찾는다
  itemKind: RequirementItemKind;
  ruleStatus: QualificationOutcome; ruleReason: NeedsReviewReason | null; basis: RequirementBasis;
  noticeEvidence: EvidenceRef[]; companyEvidence: CompanyEvidenceRef[];
  kev: {                                                         // 참고 지표. ruleStatus·점수·권고를 바꾸지 않는다. 결정 모델 담당 항목이 아니거나 결정 모델이 없으면 null
    qid: string;                                                 // "req.{itemId}.status"
    distribution: Record<QualificationOutcome, number>;
    label: QualificationOutcome;                                 // 분포의 최댓값 선택지
  } | null;
  flags: ReviewFlag[];                                           // 예: KEV_REQUIREMENT_DISAGREEMENT, PARSE_UNSUPPORTED
}
interface AnalysisResult {
  id: string; bidId: string; revisionId: string; revision: number; profileRevision: number; profileIsDemo: boolean; // 분석에 쓴 프로필의 is_demo. 알 수 없으면 true
  runMode: RunMode;                                              // 이 분석을 돌린 실행 모드(04 score_runs.run_mode)
  status: AnalysisStatus;
  solScore: number | null;                                       // 0~100. 내부 적합도. 낙찰 확률 아님
  recommendation: Recommendation | null;
  recommendationBasis: RecommendationBasis | null;
  explanation: string | null;                                    // gateway /explain(Qwen) 설명, 또는 입력 밖 숫자·Qwen 불가 시 템플릿 문장. 첨부를 읽지 못했으면 그 사실을 밝힌다
  qualification: { status: QualificationOutcome; checks: QualificationCheck[] };
  requirementAssessments: RequirementAssessment[];               // 항목별 규칙 판정·사유·양쪽 근거·결정 모델 참고 분포·플래그
  scoreBreakdown: ScoreFactor[];
  missingFactors: { factor: FactorKey; reason: MissingReason }[];   // ADR-029 A6 D16
  reviewFlags: ReviewFlag[];
  injectionSuspected: boolean;                                   // 추출 단계 지시문 패턴 탐지. true면 자격 종합은 NEEDS_REVIEW
  kev: KevAssist;                                                // 03 §5.7 정본. kev-qs/v0.1 run(mock 모드·데모 S3)이면 v0.2 필드(scores·risks·calibration·stateTrace)가 null, enabled=false면 값은 null. 화면 "모델 참고 지표 (점수 미반영)" 영역에만 표시
  fallbackReason: "QWEN_UNAVAILABLE" | "KEV_UNAVAILABLE" | null; // mock 자동 대체가 일어났을 때만. 이때 model.provider="mock", reviewFlags에 MOCK_FALLBACK, 화면 배너
  evidence: EvidenceRef[];                                       // 검증 통과한 인용만(match != FAILED)
  model: { provider: "mock" | "local" | "hosted"; qwen: { name: string; promptVersion: string; promptHash: string } | null;
           kev: { model: string; questionSetVersion: string } | null; algorithmVersion: string };
  errorCode: string | null;                                      // PARTIAL/FAILED 사유. 예: "AI_UNAVAILABLE"
  queuedAt: string; startedAt: string | null; finishedAt: string | null;
  disclaimer: "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.";
}
```

분석 요청 계약([[16-DECISIONS|ADR-030]] B20):
- 같은 입력 = (revision, 회사 프로필 revision, 알고리즘 버전). `force:false`이고 같은 입력의 run이 진행 중이면 `202 deduplicated:true`로 그 run을 돌려준다. `force:true`이고 진행 중이면 `409 ANALYSIS_IN_PROGRESS {analysisId}`.
- 큐 등록에 실패하면 run을 `FAILED`(`errorCode=ENQUEUE_FAILED`)로 바꾸고 멱등 키를 풀어 `503`을 준다.
- `Idempotency-Key`가 없으면 서버가 UUID를 만든다. `score_runs`의 멱등 키는 `<org_id>:<requestId>`다.
- 큐 `analysis`, job 이름 `analyze`, jobId `analysis_<orgId>_<scoreRunId>`(BullMQ jobId에는 `:`를 쓰지 않아 `_`로 잇는다), payload `{orgId, scoreRunId, idempotencyKey}`. jobId와 저장 멱등 키 `<orgId>:<requestId>`는 다른 값이고 서로 바꿔 쓰지 않는다([[16-DECISIONS|ADR-031]] C14).

**가정 재계산**(`POST /analyses/:id/what-if`, [[16-DECISIONS|ADR-037]] 데모 강화 컷): 저장된 run의 `input_snapshot`에 "보유 가정"을 얹어 규칙 엔진을 다시 돌리고 원래 결과와 가정 결과를 함께 돌려준다. 계산 규칙은 [[08-SCORING|08]] §5.6, 화면은 [[06-UI-UX|06]] §6.1이다. 화면은 상세 진입 때 빈 가정으로 한 번 불러 `assumable`을 받고, 스위치가 바뀔 때마다 다시 부른다.

```ts
interface WhatIfRequest {
  assumptions: { kind: "QUALIFICATION"; code: string }[];  // strict 객체. code 1~64자, 최대 10개. 빈 배열 = 가정 없이 원래만 다시 계산(가정 가능 목록 받기)
}
interface WhatIfSummary {                                   // 규칙 엔진 출력 요약. 이름은 엔진 이름 그대로다(아래 목록)
  score: number;                                            // 0~100. AnalysisResult.solScore와 같은 규칙 엔진 값. 낙찰 확률 아님
  recommendation: Recommendation;
  qualificationStatus: QualificationOutcome;
  factors: { factor: FactorKey; points: number; maxPoints: number }[];
  checks: { id: string; requirementName: string; requirementCode: string | null; outcome: QualificationOutcome; reasonCode: string | null }[];
}
interface WhatIfResult {                                    // 200 본문(그대로, 감싸지 않는다)
  assumable: string[];                                      // 이 run에서 가정할 수 있는 자격 코드(중복 제거)
  before: WhatIfSummary;                                    // 스냅샷을 kev=null로 다시 계산한 원래 값
  after: WhatIfSummary;                                     // 가정을 적용한 값. 가정이 0개면 before와 같다
}
```

- 이 응답은 규칙 엔진 이름(`score`·`factors`·`qualificationStatus`·`checks`)을 그대로 쓴다. 이 절 첫 문단의 이름 바꾸기(`score` → `solScore` 등)를 따르지 않는다.
- 가정 가능 = `kev=null`로 다시 계산한 원래 결과의 필수 항목 가운데 `requirementCode`가 자격 코드 사전(`QUALIFICATION_CODES`)에 있고 `outcome`이 `NOT_SATISFIED`이거나 `NEEDS_REVIEW`이면서 `reasonCode`가 `COMPANY_EVIDENCE_MISSING`인 것. 하나라도 가정 불가면 계산하지 않고 400이다.
- 처리 순서: 인증·CSRF(§1) → 경로 id가 UUID가 아니면 저장소를 부르지 않고 `404 {resource:"analysis"}` → 본문 16KB 초과 `400`(`path:"body"`) → 본문 zod 검증 `400` → run 읽기(사용자 세션·RLS, `status`·`input_snapshot`만) → 없음·다른 조직 `404 {resource:"analysis"}` → `QUEUED`·`RUNNING`이면 `409 ANALYSIS_IN_PROGRESS`(`details` 없음) → `FAILED`이거나 스냅샷이 `AnalysisInput` 스키마에 맞지 않으면(null 포함) `404 {resource:"analysis", reason:"NO_SNAPSHOT"}` → 가정 불가 코드가 있으면 `400 VALIDATION_ERROR {issues:[{path:"assumptions",message}], rejected:[{kind,code}]}` → `200 WhatIfResult`.
- DB에 아무것도 쓰지 않는다(`score_runs`·`bid_reviews`·`audit_logs`·알림·outbox 불변). 결정 모델·gateway·큐를 부르지 않는다. 속도 제한·`Idempotency-Key` 대상이 아니다. 권한은 4개 업무 역할 모두다.
- 구현: `web/server/scoring/what-if.ts`(`whatIf`), `web/server/bids/what-if.service.ts`(`computeWhatIf`), `web/app/api/v1/analyses/[id]/what-if/route.ts`.

#### 추천 분석 (ADR-066)

공고 상세의 [추천 분석]이 부른다. Qwen 이 판단 이유·강점·보완할 점을 근거 번호와 함께 쓰고, 판정(`score`·`recommendation`)은 바꾸지 않는다. 타입 정본은 `web/server/insight/insight.model.ts`(`InsightView`·`InsightAccepted`·`insightPayloadSchema`)다.

- POST 처리 순서: 인증·CSRF(§1) → 경로 id 가 UUID 가 아니면 `404` → 역할(`ADMIN`·`SALES`·`ANALYST` 아니면 `403 FORBIDDEN`) → run(없음·다른 조직·다른 공고·`COMPLETED`·`PARTIAL` 아님이면 `404 {resource:"analysis"}`) → 그 run 의 최신 행이 `DONE`·`MODEL` 이면 큐 없이 그대로 돌려준다(`deduplicated: true`, 횟수를 세지 않는다) → 속도 제한(사용자당 분당 3회, 큐에 넣는 요청은 모두 센다, `429 RATE_LIMITED`) → 최신 행이 `PENDING` 이면 같은 행을 다시 큐에 넣는다(`deduplicated: true`) → 아니면 `PENDING` insert(같은 run 의 `PENDING` 이 먼저 들어가 23505 이거나 모델 설명이 먼저 생겨 23P01 이면 그 행을 돌려준다) → BullMQ `insight` job → `202 {insightId, status, deduplicated, pollUrl}`. 큐·Redis 장애는 `503`. frontend relay 는 202 의 `pollUrl` 이 요청 경로와 같을 때만 받는다.
- `Idempotency-Key` 는 쓰지 않는다. 중복은 run 기준으로 막는다(relay 재시도도 같은 행이 된다).
- GET 은 모든 배포 역할에서 사용자 세션(RLS)으로 직접 읽는다(relay 없음). run 이 `COMPLETED`·`PARTIAL` 이 아니면 `404`.
- `InsightView`: `id`, `scoreRunId`, `status`, `source`(`MODEL`·`TEMPLATE`·null), `payload`(`summary`·`strengths[{text, refIds}]`·`improvements[]`·`refs[{id, kind, label, quotedText}]`, DONE 만), `fallbackReason`, `modelName`, `errorCode`(`GATEWAY_UNAVAILABLE`·`GATEWAY_INVALID`·`SOURCE_INVALID`·`STALE`), `createdAt`, `finishedAt`.
- 구현: `web/app/api/v1/bids/[id]/analyses/[runId]/insight/route.ts`, `web/server/insight/insight.service.ts`, 큐 생산자 `web/app/_lib/insight-queue.ts`.

### 4.6 검토·알림·대시보드·수집

이메일 추천 공고 알림(ADR-041)은 코드에 없다. 메일 설정의 경로·DTO는 구현 계약이 확정될 때 반영한다([[13-NOTIFICATIONS|13 알림]]).

```ts
interface ReviewInput {
  decision: Recommendation; reason: string /* 10~2000자 */; scoreRunId?: string;
  assigneeUserId?: string;         // 담당자 지정. 같은 조직 사용자만(아니면 404). 지정되면 그 사용자에게 REVIEW_ASSIGNED outbox 이벤트 1건(13)
}
interface Review {
  id: string; bidId: string; revisionId: string; scoreRunId: string | null;
  reviewer: { id: string; name: string; role: Role | null /* memberships.sol_role. 결정한 사람이 조직을 떠나 멤버십이 없으면 null이고 화면은 역할 괄호를 빼고 이름만 보인다(ADR-031 C2) */ }; decision: Recommendation; reason: string; decidedAt: string;
  assignee: { id: string; name: string } | null;                 // bid_reviews.assignee_id
  systemRecommendationAtDecision: Recommendation | null;         // 결정 당시 시스템 권고. 불일치 통계용
  disagreementFlag: boolean;                                     // decision !== systemRecommendationAtDecision. bid_reviews.disagreement_flag
}
interface Notification {
  id: string; type: "BID_CREATED" | "BID_CHANGED" | "DEADLINE_APPROACHING" | "ANALYSIS_COMPLETE" | "REVIEW_ASSIGNED" | "BID_RECOMMENDED" | "KAKAO_EXPIRED";   // 뒤의 둘은 ADR-038. 인앱 목록·안 읽음 수는 channel IN_APP만 세므로 목록에 나오는 새 종류는 KAKAO_EXPIRED(link /settings) 하나다
  channel: "IN_APP" | "KAKAO"; status: "PENDING" | "SENT" | "FAILED" | "DEAD";
  payload: { bidId: string; title: string; message: string; link: string; changedFields?: string[] };   // link는 앱 안 경로만. 알림 목록 서비스(서버)가 검사하고 그 밖의 값이면 /bids/{bidId}로 바꾼다(열린 리다이렉트 방지, ADR-030 B23)
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
  analyses: { total: number;
    byRecommendation: Record<Recommendation, number>;   // 공고별 최신 분석 1건 기준. force 재분석으로 이중 집계하지 않는다(ADR-029 A6 D10)
    partial: number; withReviewFlags: number;
    latestByStatus: { completed: number; partial: number; failed: number } };  // ADR-021 분석 현황 카드. 공고별로 끝난 score_runs(COMPLETED·PARTIAL·FAILED) 가운데 최신(created_at) 1건 기준. 진행 중(QUEUED·RUNNING) run 은 건너뛰고 그 앞의 끝난 분석을 센다(web/server/bids/dashboard.service.ts). origin 필터를 따른다
  reviews: { pending: number;     // 최신 분석이 있고 사람 결정이 없는 공고 수(ADR-029 A6 D11)
    byDecision: Record<Recommendation, number>; disagreementWithSystem: number };
  projects: { active: number };    // 현재 origin 범위에서 종료를 제외한 입찰 프로젝트 수
  upcoming: { bidId: string; title: string; deadlineAt: string; recommendation: Recommendation | null; decision: Recommendation | null }[];  // 마감 임박 10건
  recentChanges: { bidId: string; title: string; revision: number; changedFields: string[]; changedAt: string }[];  // (미구현) 최근 revision 변경 10건(06 §5.3 ④, ADR-029 A6 D9). 지금 응답 스키마(dashboard.model.ts, strict)에 이 필드가 없다
  unreadNotifications: number;
}
interface IngestionRunInput {
  source: "g2b" | "fixture" | "kwater" | "lh" | "kepco";   // g2b = 나라장터 Open API(OfficialApiConnector), fixture = fixture 20건(FixtureConnector), 나머지는 외부 서비스(ADR-047)
  serviceKey?: string;             // registry 키. g2b: "g2b-bid-notice"(기본)|"g2b-procurement-request". kwater("kwater-bid-notice"|"kwater-procurement-plan")·lh("lh-bid-notice"|"lh-pre-specification")·kepco("kepco-ebid-contract")는 필수
  companyId?: string;              // kepco 전용(선택), 확인된 회사 코드
  operation?: string;              // fixture 밖 소스, 1~100자. 생략하면 서비스 기본 기능
  requestId?: string;              // g2b 전용(선택), 1~200자. 조달요청번호(prcrmntReqNo)
  batch?: "seed" | "live";         // fixture 전용이며 fixture에서는 필수. seed: 기동 시 revision 1 적재. live: 데모 중 변경분(정정·취소·기한변경) 투입
  window?: { from: string; to: string };             // fixture 밖 소스. from < to, to 는 지금 + 5분까지. g2b 입찰공고(기본 serviceKey)는 최대 7일, 그 밖은 최대 90일. g2b는 생략하면 07 §2.2 기본 창이고 worker 가 1일 단위로 나눠 조회
  stages?: ["NOTICE"];             // g2b 전용. 생략하거나 ["NOTICE"]만 받는다(그 밖 400). worker 가 지금 공고 단계만 수집하기 때문이다(ADR-035 F1). 실제 적용값은 ingest_runs.params 에 저장
}
interface IngestionRun {
  id: string;                      // 수동 수집이면 Route Handler 가 만들어 job data runId 로 넘긴 값(worker 가 이 id 로 행을 만든다)
  source: "g2b" | "fixture" | "kwater" | "lh" | "kepco"; runMode: RunMode;
  serviceKey?: string; completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN"; fetchedCount?: number;
  batch: "seed" | "live" | null; trigger: "SCHEDULED" | "MANUAL" | "DEMO";
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  summary: { created: number; changed: number; cancelled: number; skippedDuplicate: number; quarantined: number; retried: number };
  quotaUsed: number;               // 이 run이 쓴 공공 API 호출 수(fixture는 0)
  errors: { sourceKey: string; errorCode: string; resultCode: string | null; detail: string }[];   // redacted. sourceKey는 registry 키, resultCode는 공공 API resultCode
  cursor: string | null;
  requestedBy: { id: string; name: string } | null;   // 202 본문(같은 키 재현 포함)은 첫 요청자다. 목록·단건은 요청한 조직의 감사(audit_logs INGEST_MANUAL, worker 가 run 을 끝낸 뒤 남긴다)의 actor 로 찾는다. 지금 조직 구성원이면 {id,name}, 다른 조직이 요청했거나 감사가 남기 전(실행 중)이거나 일정·데모 수집이면 null(id 도 내보내지 않는다)
  startedAt: string; finishedAt: string | null;
}
interface SourceStatus {           // 수집 소스 registry 항목 하나(15 §8)
  key: string;                     // 예: "g2b-bid-notice", "g2b-attachment", "fixture"
  approvalStatus: "NOT_REQUESTED" | "PENDING" | "APPROVED";
  quotaUsedToday: number;          // Redis 카운터(KST 날짜). 목록은 quota:{serviceId}:{YYYYMMDD}, 보조 조회는 기능마다 quota:{serviceId}:{registryKey}:{YYYYMMDD}로 따로 센다(web/server/ingestion/quota.ts, 07)
  quotaLimit: number | null;       // 일일 호출 한도. 모르면 null
  lastSuccessAt: string | null; lastErrorCode: string | null;
  lastVerifiedAt: string | null;   // registry 검증일. 90일 지나면 경고(15 §8)
}
interface AiStatus {
  runMode: RunMode;                // SOL_RUN_MODE
  provider: "mock" | "local" | "hosted"; hostedApproved: boolean;
  gateway: { url: string; healthy: boolean; checkedAt: string;
    runMode: RunMode | null };     // gateway /health 가 알린 실행 모드. gateway 가 죽어 있으면 null. web 의 runMode 와 어긋나면 보인다
  qwen: { model: string | null; runtime: string | null; healthy: boolean | null };   // healthy = gateway 생존 + Qwen 모델 설정(gateway 가 죽어 있으면 null). runtime 은 해커톤 동안 null
  kev: {
    enabled: boolean;
    healthy: boolean | null;       // gateway 기동 때 잰 registryMatch. mock 의 null 은 true, local·hosted 의 null 은 null. gateway 가 죽었거나 결정 모델이 꺼져 있으면 null
    model: string | null;          // 해커톤 동안 null
    modelId: string | null;        // 레지스트리 항목 id(KEV_MODEL_ID)
    run: string | null; base: string | null; lora: number | null; temperature: number | null;   // 결정 모델 서버(sol_decision, Bosun) GET /v1/models 값. 필드 이름은 Kev wire 호환(ADR-034). gateway /health 가 주지 않아 해커톤 동안 null
    registryMatch: boolean | null; // 위 값이 레지스트리 항목과 같은가. false면 gateway가 기동을 거부한다
  };
  questionSetVersion: string | null;                  // 예: "kev-qs/v0.2"
  parsers: { format: string; parserId: string }[];    // gateway /health 의 parsers(/parse가 지원하는 형식과 어댑터·버전). parserId 가 null(어댑터 없음)인 형식은 뺀다. 기본 설정이면 PDF(pdfplumber)·HWPX(sol-hwpx)·HWP(sol-hwp5+olefile) 3개(services/ai/src/sol_ai/parsers/__init__.py)
}
interface ModelRegistryEntry {     // services/ai/models/registry.yaml 항목(21 §5.4). 가중치는 없다. 아래 ADR-034 필드는 파일·gateway `registry.py`에 있다. 이 응답을 내는 `/admin/ai/models`는 미구현
  id: string; kind: "decision" | "qwen" | "kev";   // ADR-034: 결정 모델은 kind=decision(Bosun). kev 는 퇴역 항목 읽기 호환
  run: string; base: string | null; baseRevision: string | null; initFrom: string | null;
  revision: string | null;         // ADR-034: 모델 저장소 커밋 sha 전체(run 의 @뒤는 앞 8자). 회사 운영 Qwen API 는 null
  status: "active" | "retired" | "backup" | null;   // ADR-034: retired(kev-9b-v1.0·qwen3.5-27b·qwen3.5-9b)·backup(qwen3-4b-instruct-2507)은 기동 대조 대상에서 제외
  lora: string | number | null;    // Bosun 은 어댑터 safetensors sha256(문자열), Kev 이력 항목은 rank(숫자)
  weightsSha256: string | null; headSha256: string | null; decisionEmbeddingsSha256: string | null;   // 마지막 필드는 Bosun decision_embeddings.safetensors
  temperature: number | null;
  dataset: { version: string; sha256: string } | null;
  questionSet: string | null; stateTemplate: string | null; requestModel: string | null; reports: string[];
}
interface ModelRegistryStatus {
  entries: ModelRegistryEntry[];
  active: { kevModelId: string | null; qwenModel: string | null; registryMatch: boolean | null };
  checkedAt: string;               // gateway /health를 읽은 시각
}
interface MetricValue {            // 평가 지표 하나. 작은 평가셋이라 신뢰구간과 표본 수를 함께 낸다(21 §4.3)
  value: number | null;            // 채우지 못한 칸은 null + note
  ci95: [number, number] | null;   // 부트스트랩 95% 신뢰구간
  n: number; note: string | null;
}
interface EvalRunSummary {         // 04 eval_runs
  id: string; datasetVersion: string; datasetSha256: string;
  systemId: string;                // 비교 대상 ID. 예: "E0"(규칙만), "E1'"(공개 Bosun 영어 state zero-shot), "E2"(Bosun 한국어 state, 평가 전용), "E3"(Qwen3.8-Flash-Next logprob 분류), "E4"(Bosun + LoRA)
  split: "train" | "dev" | "test";
  keyMetrics: { macroF1: MetricValue; needsReviewToNotSatisfiedRate: MetricValue; ece: MetricValue };   // 21 §4.4 초기 목표 지표 세 개
  gitCommit: string; createdAt: string;
}
interface EvalRunReport extends EvalRunSummary {
  metrics: Record<string, MetricValue>;   // 21 §4.3 지표 표 전체. 키는 지표 이름
  errorAnalysis: { cause: "PARSE" | "EXTRACTION" | "TRANSLATION" | "STATE" | "RULE" | "LABEL" | "MODEL"; count: number; ratio: number }[];  // 원인 코드별 건수(21 §4.4)
}
```

`IngestionRunInput` 검증: 본문은 `source`로 나뉜 strict 객체다. `source=fixture`에 `batch`가 없거나 `window`·`stages`가 있으면, `source=g2b`에 `batch`가 있거나 입찰공고 `window`가 7일을 넘으면, 외부 서비스에 `serviceKey`가 없거나 `window`가 90일을 넘으면 `400 VALIDATION_ERROR`다. 소스와 실행 모드가 맞지 않으면 `409 RUN_MODE_MISMATCH`다. `live` 모드는 `fixture`가 아닌 소스(`g2b`·`kwater`·`lh`·`kepco`)만, `fixture`·`mock` 모드는 `fixture`만 받는다([[16-DECISIONS|ADR-020]], `web/server/ingestion/ingestion-admin.model.ts` `acceptsSourceForMode`). `stages`는 생략하거나 `["NOTICE"]`만 받고 그 밖은 `400 VALIDATION_ERROR`다. worker가 지금 공고 단계만 수집하기 때문이다. 실제 적용값(`{window, stages:["NOTICE"]}`)은 `ingest_runs.params`에 남는다([[16-DECISIONS|ADR-035]] F1). 사전규격·발주계획 수집이 생기면 받는 값을 넓힌다.

`AiStatus`의 값은 gateway `/health` 한 번에서만 읽는다(Route Handler가 Qwen·결정 모델을 직접 부르지 않는다, §7). `qwen.healthy`는 "gateway 생존 + Qwen 모델 설정"이고 `kev.healthy`는 gateway 기동 때 잰 `registryMatch`다. 둘 다 실시간 탐침이 아니므로 화면은 "gateway 기준 정상"으로 쓴다. `qwen.runtime`·`kev.model`·`run`·`base`·`lora`·`temperature`는 gateway `/health`가 주지 않아 해커톤 동안 null이다. 응답의 `gateway.url`(내부 주소)이 조직 ADMIN에게 보이는 것은 해커톤 동안 받아들인 위험이다([[09-SECURITY|09 보안]] "해커톤 동안 수용한 위험" ⑦). 공공 API 서비스키(`G2B_*_SERVICE_KEY` 5개와 `KWATER_*`·`LH_*`·`KEPCO_*_SERVICE_KEY`, `infra/sources/registry.yaml`·[[07-DATA-PIPELINE|07 수집]] §2.2)는 서버 전용이며 어떤 응답·오류 본문·로그에도 싣지 않는다([[09-SECURITY|09 보안]]).

`Review.reviewer`와 계정 삭제: 결정한 사람의 계정이 지워지면 `bid_reviews.reviewer_id`는 null이 된다(on delete set null, [[04-DATABASE|04 DB]] §3.4). 계정이 삭제된 결정자는 `{ id: "deleted-user", name: "탈퇴한 사용자", role: null }`로 내보낸다. DTO 타입은 바꾸지 않는다([[16-DECISIONS|ADR-032]] D6, 사용자 결정 2026-10-19).

### 4.7 조직·인력 (ADR-021)

가상 직원 명부를 읽는 DTO다. 연락처 필드는 없다([[09-SECURITY|09 보안]] 솔리데오 명부 절).

```ts
interface Department {
  id: string; code: string; name: string;
  kind: "DIVISION" | "GROUP" | "TEAM" | null;   // 본부·그룹·팀. 없으면 null
  parentId: string | null;                      // 상위 부서. null이면 최상위(화면은 한 목록에 놓는다)
  targetCount: number | null;                   // 팀만. 본부·그룹은 null(오류 아님)
  memberCount: number;                          // 그 부서 직속과 하위 부서의 재직 인원 합, 직원 ID 중복 제거(ADR-063). 따로 저장하지 않고 계산
}
interface TeamMemberListItem {
  id: string; personCode: string; name: string;  // personCode = SOL-P0001~SOL-P0200
  departmentId: string; jobTitleId: string;      // 소속은 팀 또는 본부·그룹 직속(ADR-063)
  portraitUrl: string | null;                    // 없으면 이니셜로 대신 표시
  scoringEligible: boolean;                      // team_member_scoring 행이 있는 200명
  isDemo: true;
}
interface TeamMemberDetail extends TeamMemberListItem {
  scoring: { role: string; grade: string | null; skills: unknown[]; availability: unknown[]; certifications?: unknown[]; pastProjects?: unknown[]; capabilitySource?: "UNSPECIFIED" | "SYNTHETIC"; capabilityVersion?: string | null } | null;  // 점수 계산 대상만. 원소 형태는 SOL Score 입력 `AnalysisInput.team.members`(15)·`TeamAvailability`(08 §3.3)와 같은 zod 스키마를 쓴다. 조직 구성원 누구나 읽는다(RLS로 다른 조직 0행)
}
```

### 4.7.1 인력 조회 계약 보완

네 GET 경로는 쿠키·Bearer 인증, 활성 계정, 가입 정보 완료, 현재 업무 조직 하나와 네 업무 역할을 각각 확인한다. Authorization 헤더가 있으면 유효하지 않은 Bearer를 쿠키로 대체하지 않는다. 업무 조직이 없으면 `403 FORBIDDEN`, `details={reason:"ORGANIZATION_REQUIRED",organizationStatePath:"/auth/organization-state"}`다. 두 개 이상은 `403 UNSUPPORTED_ACCOUNT_STATE`, 역할 없음은 `403 FORBIDDEN`이다. 조직 ID 헤더는 조직 선택에 쓰지 않으며 `orgId` 쿼리는 `400 VALIDATION_ERROR`다. 조회는 재직(`employment_status=ACTIVE`) 직원만 돌려준다. 퇴사(`LEFT`) 직원은 RLS 제한 정책이 숨겨 목록·상세·조직도·인원 수에 나오지 않는다.

N4b 편집(`POST /team-members`, `PATCH /team-members/:id`)은 같은 업무 경로 입구를 쓴다(쿠키 요청은 `X-Requested-With: sol-radar` 필요, 없으면 `403 CSRF_REJECTED`). `ADMIN`이 아니면 본문 검사 전에 `403 FORBIDDEN`이다. 조직은 세션의 업무 조직이고 본문의 `orgId`를 받지 않는다. 본문은 엄격 객체라 알 수 없는 키(점수 속성 `skills`·`role` 등 포함)는 `400 VALIDATION_ERROR`다. POST 본문은 `name`(trim 1~40자)·`departmentId`(이 조직 부서 UUID. 팀뿐 아니라 본부·그룹 직속도 된다, [[16-DECISIONS|ADR-063]])·`jobTitleId`(UUID)·`email`(선택, 소문자 형식)이다. PATCH 본문은 `departmentId`·`jobTitleId`·`employmentStatus`(`ACTIVE`·`LEFT`) 중 하나 이상이다. 경로 ID 형식 오류는 400, 현재 조직에 없거나 다른 조직의 직원은 `404 NOT_FOUND`다. 다른 조직의 부서·직급은 `400 VALIDATION_ERROR`(`details.issues[].path`가 `departmentId`·`jobTitleId`)다. 이미 쓰는 메일은 `400`(`path=email`)이다. 응답 `EditedTeamMember`는 `{id,personCode,name,email,departmentId,jobTitleId,employmentStatus,isDemo}`다. 바뀐 값이 없는 PATCH는 감사 행 없이 `200`이다.

`Department.id`·`TeamMemberListItem.id`·`departmentId`·`jobTitleId`와 `JobTitle.id`는 DB UUID다. 표시 코드는 `Department.code=SOL-Dxxx`, `JobTitle.code=SOL-Jxxx`, `personCode=SOL-Pxxxx`다. `GET /job-titles`는 `{id,code,label}[]`를 직급 순서로 반환한다. 본부의 `parentId:null`은 정상 루트이고, 그룹·팀의 null은 원본에서 상위를 확인하지 못한 것이다(화면은 따로 묶지 않고 최상위 목록에 놓는다). `memberCount`는 전체 명부의 하위 직원 ID 중복을 제거해 계산한다.

`GET /team-members`는 `q`(trim, 최대 40자), `departmentId`(팀 UUID), `jobTitleId`(UUID), `scoring=1|0`, `cursor`, `limit`(기본 20, 1~100)을 받는다. 알 수 없는 조건·중복 조건·잘못된 값은 `400 VALIDATION_ERROR`, 현재 조직에서 찾을 수 없는 부서·직급은 `404 NOT_FOUND`, 상위 본부·그룹 필터는 `400 VALIDATION_ERROR`다. 다른 세 경로는 쿼리 조건을 받지 않는다. 상세 경로 ID 형식은 UUID이며 잘못된 형식은 400, 현재 조직에 없거나 다른 조직의 직원은 404다.

```ts
interface PeoplePage {
  items: TeamMemberListItem[];
  pageInfo: {
    cursor: string | null; nextCursor: string | null;
    previousCursor: string | null; hasNext: boolean; startIndex: number;
  };
  totalCount: number; // 필터 결과 전체 수
  summary: { totalCount: number; scoringCount: number }; // 필터 전 현재 조직 전체
}
```

정렬은 `personCode ASC, id ASC`로 고정한다. `startIndex`는 0부터 시작한다. 이전 페이지는 `startIndex>0`일 때 제공하며, 첫 페이지로 돌아가는 `previousCursor:null`은 cursor 쿼리를 제거하라는 뜻이다. 그 외 이전 커서는 해당 페이지 앞 직원의 키를 담는다. 필터 변경 때 cursor를 제거한다. 조직도는 페이지의 20명이 아닌 전체 명부를 쓴다. 목록에는 `scoring` 상세 속성이 없으며, 상세에는 점수 행이 없는 직원도 `scoring:null`로 보존한다. 연락처·계정 연결 필드는 반환하지 않는다.

커서는 버전·마지막 `personCode`/UUID·현재 orgId·정규화 필터/limit·발급시각을 base64url로 인코딩하고 HMAC-SHA256으로 서명한다. 서버 전용 `API_CURSOR_SECRET`은 32자 이상이며 기본값이나 다른 키로 대체하지 않는다. 발급 후 24시간 이상, 미래 발급시각, 조직·필터 불일치, 변조·잘못된 인코딩은 `400 INVALID_CURSOR`다. 서명은 `timingSafeEqual`로 비교한다. 키 미설정·길이 부족은 `503 SERVICE_UNAVAILABLE`, `details={component:"cursor"}`다. 사진은 해당 `personCode`와 정확히 일치하는 `/demo/people/<personCode>.png`만 공개하며 없거나 안전하지 않은 경로는 `portraitUrl:null`이다.

## 5. 오류 코드

|HTTP|code|언제|`details`|
|---:|---|---|---|
|400|`VALIDATION_ERROR`|DTO·쿼리 검증 실패. 가정 재계산의 가정 불가 코드도 이 코드다(§4.5 "가정 재계산", [[16-DECISIONS\|ADR-037]])|`{issues:[{path,message}]}`. 가정 불가면 `rejected:[{kind,code}]`를 더한다|
|400|`INVALID_CURSOR`|커서 변조·만료|—|
|401|`UNAUTHENTICATED`|세션 쿠키·Bearer 토큰 없음, 서명이 틀림, 만료. 브라우저는 Supabase 클라이언트가 세션을 갱신한 뒤 다시 시도하고, 그래도 401이면 `/auth/login`으로 보낸다|—|
|403|`FORBIDDEN`|`sol_role`이 허용 목록에 없음|`{required:[Role]}`|
|403|`CSRF_REJECTED`|쿠키 인증의 상태 변경 요청에 `X-Requested-With` 누락|—|
|403|`PROFILE_INCOMPLETE`|이름·부서·직급/직책 보완 전 업무 API 요청|`{completionPath:"/auth/complete-profile"}`|
|403|`ACCOUNT_DISABLED`|`profiles.status='suspended'`인 사용자(토큰이 아직 유효해도)|—|
|403|`UNSUPPORTED_ACCOUNT_STATE`|업무 조직 멤버십이 2개 이상인 사용자의 업무 API 요청. 해커톤 MVP는 업무 조직 하나만 지원한다([[16-DECISIONS\|ADR-021]])|—|
|404|`NOT_FOUND`|자원 없음 **또는 다른 조직 자원**(RLS로 행이 보이지 않음). 로그인 사용자의 아직 출시하지 않은 경로도 404다(메뉴 노출과 무관, [[16-DECISIONS\|ADR-021]]). 가정 재계산은 run이 `FAILED`이거나 입력 스냅샷이 스키마에 맞지 않을 때도 404다([[16-DECISIONS\|ADR-037]])|`{resource:"bid"\|"analysis"\|...}`. 가정 재계산의 스냅샷 없음은 `{resource:"analysis", reason:"NO_SNAPSHOT"}`|
|409|`PROFILE_REVISION_CONFLICT`|(만들지 않음. `PUT /company-profile`과 함께 ADR-052 8번 비목표) `baseRevision` ≠ 최신|`{currentRevision}`|
|409|`ANALYSIS_IN_PROGRESS`|같은 입력의 run이 `QUEUED`/`RUNNING`인데 `force=true`. 또는 `POST /analyses/:id/what-if`의 run이 `QUEUED`·`RUNNING`(스냅샷이 아직 없다, [[16-DECISIONS\|ADR-037]])|`{analysisId}`. 가정 재계산은 `details` 없음|
|409|`IDEMPOTENCY_KEY_REUSED`|같은 키, 다른 본문|—|
|409|`INGESTION_IN_PROGRESS`|`POST /admin/ingestion/runs`에서 같은 소스의 `ingest_runs` 행이 `RUNNING`. 멱등 재현(같은 키·같은 본문이면 첫 202) 뒤에 판정하고, 큐에만 있는 job은 막지 않는다. 오래 남은 g2b `RUNNING` 행은 운영자 명령 `pnpm ops:close-stale-runs`로 닫는다([[07-DATA-PIPELINE\|07]] §2.7, [[16-DECISIONS\|16 ADR]] 미결정 25번)|`{runId}`|
|409|`PROJECT_REQUIRES_BID_DECISION`|P1. `POST /projects`의 `reviewId`가 추천(`BID`) 결정이 아님([[16-DECISIONS\|ADR-021]])|`{reviewId}`|
|409|`PROJECT_ALREADY_OPEN`|`POST /projects`인데 그 공고에 열린 입찰 프로젝트가 이미 있음|`{projectId}`|
|409|`INVALID_PROJECT_TRANSITION`|`PATCH /projects/:id`의 상태 전이가 허용되지 않음|`{from, to}`|
|409|`LATEST_DECISION_NOT_BID`|P1. 입찰 프로젝트를 연 뒤 최신 결정이 추천(`BID`)이 아니어서 상태 전진을 막음. 자동 종료하지 않는다([[16-DECISIONS\|ADR-021]])|`{bidId, latestDecision}`|
|409|`RUN_MODE_MISMATCH`|`POST /admin/ingestion/runs`의 `source`가 현재 실행 모드(`SOL_RUN_MODE`)와 맞지 않음(`live`에 `fixture`, `fixture`·`mock`에 `g2b`). 서버가 조용히 소스를 바꾸지 않는다([[16-DECISIONS\|ADR-020]])|`{runMode, source}`|
|409|`ANALYSIS_SOURCE_MISSING`|`POST /bids/:id/analyses`인데 최신 revision 본문·분석 가능한 첨부 텍스트가 없음. 화면도 분석 단추를 막는다("공고 본문 미확보 · 분석 준비 중", `web/server/bids/bids.service.ts`). 나라장터 목록 API는 본문을 비워 두므로 실공고는 Documents Worker가 첨부를 파싱하기 전까지 이 응답이다. 준비 상태는 `BidDetail.analysisReadiness`가 보인다. Vercel `frontend`는 중계 전에 같은 판정을 한다|`{reason:"SOURCE_TEXT_MISSING"}`|
|409|`MANUAL_SHARED_RUN`|`POST /admin/ingestion/runs`(fixture 밖 공공 API 수동 수집)인데 최근 10분 안에 누가 수동 수집을 접수함(전역 공유 실행). `Retry-After` 없음|`{runId, requestedAt, nextAvailableAt, retryAfterSeconds, mine}`|
|409|`KAKAO_NOT_CONNECTED`|[[16-DECISIONS\|ADR-038]]. `PATCH /me/kakao-notify`로 켜려는데 카카오톡 알림 연결이 없거나 `CONNECTED`가 아님|—|
|409|`KAKAO_NOT_READY`|ADR-038. `POST /me/kakao-notify/test`인데 연결·켬 상태가 아님|—|
|422|`HOSTED_NOT_APPROVED`|`AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=true`가 아님. hosted는 gateway와 web **둘 다** `AI_HOSTED_APPROVED=true`여야 한다(gateway는 승인 없이 기동을 거부하고, web env에 승인 값이 없어도 이 응답이다, [[10-DEPLOYMENT\|10 배포]] env 표). `/admin/ai/status`에서만|—|
|429|`RATE_LIMITED`|속도 제한(Redis로 세는 §1의 API 제한)|`Retry-After` 헤더|
|429|`MANUAL_COOLDOWN`|같은 사용자가 60분 안에 수동 수집을 다시 요청. `Retry-After` 헤더|`{nextAvailableAt, retryAfterSeconds}`|
|429|`MANUAL_DAILY_LIMIT`|KST 하루 수동 수집 20회(전역)를 다 씀. `Retry-After` 헤더|`{limit, nextAvailableAt, retryAfterSeconds}`|
|429|`KAKAO_TEST_THROTTLED`|[[16-DECISIONS\|ADR-038]]. 시험 메시지를 1분 안에 다시 요청하거나 24시간 10회를 넘김(§9)|`{retryAfterSeconds:60}` + `Retry-After: 60`|
|500|`INTERNAL_ERROR`|미처리 예외. 메시지는 일반 문구, 상세는 로그에만|—|
|503|`SERVICE_UNAVAILABLE`|큐(Redis/BullMQ)·DB(Supabase)·스토리지(Supabase Storage) 연결 불가로 요청을 받을 수 없음. 분석 요청의 큐 등록이 실패하면 run을 `FAILED`(`ENQUEUE_FAILED`)로 바꾸고 멱등 키를 푼 뒤 이 응답을 준다([[16-DECISIONS\|ADR-030]] B20). 수동 수집의 큐 등록이 실패하면 잡은 Redis 멱등 키를 지운 뒤 이 응답을 준다. `redis`는 속도 제한·멱등 저장소에 닿지 못함, `cursor`는 커서 서명 비밀(`API_CURSOR_SECRET`)이 없거나 짧음이다. 수동 수집(fixture 밖 소스)인데 정기 수집 Job Scheduler가 없으면(ingest Worker 미기동) `{component:"ingest-worker", reason:"SCHEDULER_INACTIVE"}`다. 나라장터 입찰공고 밖 서비스(조달요청·K-water·LH·KEPCO) 수동 수집인데 Worker가 남긴 서비스 상태가 준비가 아니면(키 없음·한도 미정·인증 실패 등) `{component:"source", source, serviceKey, reason}`이다. `redis-api`는 Vercel `frontend`가 회사 `redis-api`에 닿지 못했거나 응답이 잘못됐을 때다(아래 "Redis HTTPS 접수 경계")|`{component:"queue"\|"db"\|"storage"\|"redis"\|"cursor"\|"ingest-worker"\|"source"\|"redis-api"}`|

로그인 실패·시도 제한·토큰 갱신 실패는 이 API가 아니라 Supabase Auth의 응답이고(예: 템플릿 로그인 폼 `web/app/auth/login/sign-in-form.tsx`가 구분하는 `invalid_credentials`·`user_banned`), 화면이 그 응답을 [[06-UI-UX|06 UI]] §5.2의 문구로 바꾼다. 이메일 존재 여부를 구분하는 문구는 쓰지 않는다.

`AI_UNAVAILABLE`, `EXTRACTION_FAILED`는 HTTP 오류가 아니다. 분석은 비동기이므로 AI 장애는 `AnalysisResult.status=PARTIAL` + `errorCode`로 나타난다. API가 503을 내는 경우는 요청 자체를 큐에 넣지 못할 때뿐이다.

[[16-DECISIONS|ADR-020]]의 실패 유형도 HTTP 오류가 아니다. 유형마다 따로 기록하고 따로 보여 주며, 한 유형을 다른 유형으로 뭉뚱그리지 않는다.

|유형|나타나는 곳|
|---|---|
|공공 API 실패|`IngestionRun.status`·`errors[].errorCode`·`resultCode`, `SourceStatus.lastErrorCode`|
|첨부 다운로드 불가|`BidDocument.downloadStatus=FAILED`, `reviewFlags`의 `DOCUMENT_DOWNLOAD_FAILED`, 관련 항목 `NEEDS_REVIEW`|
|파싱 실패·부분 파싱·미지원 형식|`BidDocument.parseStatus`·`parseErrorCode`, `reviewFlags`의 `PARSE_UNSUPPORTED`, 관련 항목 `NEEDS_REVIEW`(`PARSE_UNSUPPORTED`)|
|Qwen 서버 미접속|`reviewFlags`의 `QWEN_UNAVAILABLE`. 캐시된 추출이 없으면 `status=PARTIAL`|
|결정 모델 서버 미접속·응답 형식 오류(gateway가 응답했지만 쓸 수 없는 `/kev`: 4xx·봉투 오류·wire 스키마 위반)|`reviewFlags`의 `KEV_UNAVAILABLE`, `kev.enabled=false`, `recommendationBasis=RULES_ONLY`, `status=COMPLETED`|
|추출 응답 형식 오류(gateway가 응답했지만 쓸 수 없는 `/extract`)|`errorCode=EXTRACTION_FAILED`, `status=PARTIAL`|
|gateway 미접속(전송 실패: 연결 거부·timeout·재시도 뒤 5xx·circuit open·시험 503)|`errorCode=AI_UNAVAILABLE`, `status=PARTIAL`(위 문단과 같다)|
|mock 자동 대체(`AI_FALLBACK_TO_MOCK=true`일 때만)|`fallbackReason`, `model.provider="mock"`, `reviewFlags`의 `MOCK_FALLBACK`|

분류 기준은 "gateway가 응답했는가"다. gateway에 닿지 못한 전송 실패만 `AI_UNAVAILABLE`이고, 응답했지만 쓸 수 없으면 `/kev`는 `KEV_UNAVAILABLE`, `/extract`는 `EXTRACTION_FAILED`다. 그래서 `KEV_UNAVAILABLE`은 "결정 모델 미접속·timeout + 결정 모델 응답 형식 오류"를 뜻한다. 진단(zod issue 경로·코드, failure kind)은 worker 로그에만 남고 이 API와 DB에는 나오지 않는다([[16-DECISIONS|ADR-031]] C6).

gateway 내부 오류 코드(예: 한국어 state를 허용하지 않을 때의 `KO_STATE_NOT_ALLOWED`)는 Compose 내부 계약이라 이 API로 나오지 않는다([[03-AI-PIPELINE|03 AI 파이프라인]]).

## 6. 예시

예시의 인증 정보는 생략했다. 브라우저는 세션 쿠키를 싣고 상태 변경 요청에 `X-Requested-With: sol-radar`를 붙인다. 스크립트는 `Authorization: Bearer <Supabase access token>`을 붙인다(§1).

### 6.1 로그인 (Supabase Auth, 이 API 밖)

화면은 템플릿 `/auth/login`이고, 브라우저 Supabase 클라이언트가 Supabase Auth에 직접 로그인한다(§2 표 아래 문단).

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

seed 계정 목록·역할·비밀번호 규칙은 [[04-DATABASE|04 DB]] §6이다.

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
 "id":"7d2c...","bidId":"27f3...","revisionId":"9b7c...","revision":1,"profileRevision":2,"profileIsDemo":true,
 "runMode":"mock",
 "status":"COMPLETED","solScore":72,
 "recommendation":"WATCH","recommendationBasis":"RULES_WITH_KEV_ASSIST",
 "explanation":"필수자격은 모두 충족했습니다. 요구기술 6개 중 3개(Java, Spring Boot, PostgreSQL)를 보유하고 Vue.js·SCORM·WebRTC는 없습니다. 마감까지 영업일이 짧아 인력 가용 계수를 0.7로 낮췄습니다. 점수 72점으로 사람 검토 구간(50~75)입니다.",
 "qualification":{"status":"SATISFIED","checks":[
   {"id":"...","requirementCode":"SW_BUSINESS_REG","requirementName":"소프트웨어사업자 신고확인서","mandatory":true,
    "outcome":"SATISFIED","reason":"프로필 등록 SW_BUSINESS_REG 유효","reasonCode":null,"basis":"EXTRACTION",
    "evidence":[{"documentId":"7a2b...","revisionId":"9b7c...","page":2,"charStart":980,"charEnd":1012,
                 "quotedText":"소프트웨어사업자 신고확인서를 제출하여야 한다","fetchedAt":"2026-10-16T01:00:00Z","match":"EXACT"}],
    "profileEvidence":[{"type":"LICENSE","ref":"SW_BUSINESS_REG","label":"소프트웨어사업자 신고확인서"}],
    "companyEvidence":[{"profileRevision":2,"kind":"LICENSE","recordKey":"licenses[0]","documentId":null,"quotedText":null}],
    "checkedAt":"2026-10-16T02:00:05Z"}
 ]},
 "requirementAssessments":[],
 "scoreBreakdown":[
   {"factor":"skillMatch","rawValue":{"required":6,"matched":3,"matchedNames":["Java","Spring Boot","PostgreSQL"],"missingNames":["Vue.js","SCORM","WebRTC"],"preferred":2,"preferredMatched":1},"normalized":0.5,"points":15.0,"maxPoints":30,"missing":false,"missingReason":null,"evidence":[],"note":null},
   {"factor":"pastPerformance","rawValue":{"similarProjects":2},"normalized":0.732,"points":18.3,"maxPoints":25,"missing":false,"missingReason":null,"evidence":[],"note":null},
   {"factor":"staffAvailability","rawValue":{"availableRatio":1.0,"scheduleFactor":0.7},"normalized":0.7,"points":14.0,"maxPoints":20,"missing":false,"missingReason":null,"evidence":[],"note":"마감 촉박 일정 계수 0.7"},
   {"factor":"scaleFit","rawValue":{"budgetKrw":"450000000","maxContractKrw":"5000000000","largestPastKrw":"2800000000"},"normalized":1.0,"points":15.0,"maxPoints":15,"missing":false,"missingReason":null,"evidence":[],"note":null},
   {"factor":"strategicPreference","rawValue":{"agencyTypeMatch":true,"domainMatch":true},"normalized":1.0,"points":10.0,"maxPoints":10,"missing":false,"missingReason":null,"evidence":[],"note":"교육 분야·교육청 선호 일치"}
 ],
 "missingFactors":[],
 "reviewFlags":["KEV_NEEDS_REVIEW"],
 "injectionSuspected":false,
 "kev":{"enabled":true,"provider":"mock","model":"mock","questionSetVersion":"kev-qs/v0.1",
        "suggestedOption":"WATCH","probabilities":{"BID":0.36,"WATCH":0.52,"NO_BID":0.12},"confidence":0.52,
        "mandatoryRisk":0.10,"needsHumanReview":0.74,"fit":{"score":2.2,"legend":{"0":"Very poor","1":"Poor","2":"Moderate","3":"Good","4":"Very good"}},
        "latencyMs":0,"requestId":null,
        "scores":null,"risks":null,"calibration":null,"stateTrace":null,
        "disclaimer":"Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."},
 "fallbackReason":null,
 "evidence":[],
 "model":{"provider":"mock","qwen":{"name":"fixture","promptVersion":"req-extract/v0.1","promptHash":"sha256:3f1c..."},
          "kev":{"model":"mock","questionSetVersion":"kev-qs/v0.1"},"algorithmVersion":"sol-v0.1.0"},
 "errorCode":null,
 "queuedAt":"2026-10-16T02:00:00Z","startedAt":"2026-10-16T02:00:01Z","finishedAt":"2026-10-16T02:00:06Z",
 "disclaimer":"SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다."
}
```

위 값은 **DEMO fixture FX-02의 가상 데이터**이며 [[08-SCORING|08 점수]] worked example과 같은 숫자다. 요소 합 15.0+18.3+14.0+15.0+10.0 = 72.3 → `solScore` 72(정수 반올림). 자격은 전부 충족이고 보류(`WATCH`)는 점수가 50~75 구간이기 때문이다. `kev.needsHumanReview=0.74`가 임계값 0.7 이상이라 `reviewFlags`에 `KEV_NEEDS_REVIEW`가 들어갔고, 결정 모델 권고(`WATCH`)가 규칙 권고와 같아 `MODEL_RULE_DISAGREEMENT`는 없다. 다른 fixture의 mock Kev 값은 [[07-DATA-PIPELINE|07 수집]] §6.3. 예시의 `scoreBreakdown.evidence`와 `requirementAssessments`는 지면상 비웠다.

이 예시는 `mock` 실행 모드(`runMode:"mock"`)의 결과다. 골든 수치(94/72/68)는 mock 모드에서만 단언한다. mock 모드와 데모 S3는 Kev 질문 세트 `kev-qs/v0.1`을 계속 쓰므로 v0.2 필드(`scores`·`risks`·`calibration`·`stateTrace`)가 null이다. `fixture`·`live` 모드는 실모델(Qwen3.8-Flash-Next·Bosun v3.1 0.6B, `kev-qs/v0.2`)을 쓰므로 추출과 결정 모델 값이 이 예시와 다를 수 있다([[16-DECISIONS|ADR-020]]).

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
POST /api/v1/admin/ingestion/runs            (SEED 배치, SOL_RUN_MODE=mock)
Idempotency-Key: 1b2c...
{"source":"fixture","batch":"seed"}
→ 202 {"id":"<Route Handler 가 만든 runId>","source":"fixture","runMode":"mock","batch":"seed","trigger":"MANUAL","status":"RUNNING",
       "summary":{"created":0,"changed":0,"cancelled":0,"skippedDuplicate":0,"quarantined":0,"retried":0},
       "quotaUsed":0,"errors":[],"cursor":null,"requestedBy":{"id":"...","name":"..."},"startedAt":"...","finishedAt":null}
GET /api/v1/admin/ingestion/runs/:id (worker 가 행을 만들기 전)
→ 404 {"error":{"code":"NOT_FOUND","message":"...","details":{"resource":"ingestionRun"},"requestId":"..."}}
GET /api/v1/admin/ingestion/runs/:id (완료 후)
→ {"status":"PARTIAL","summary":{"created":19,"changed":0,"cancelled":0,"skippedDuplicate":0,"quarantined":1,"retried":2},
   "errors":[{"sourceKey":"fixture:DEMO-2026-0012","errorCode":"MISSING_REQUIRED_FIELD","resultCode":null,"detail":"missing: title"}], ...}

POST /api/v1/admin/ingestion/runs            (데모 중 LIVE 배치)
{"source":"fixture","batch":"live"}
→ 완료 후 {"status":"SUCCEEDED","summary":{"created":0,"changed":3,"cancelled":1,"skippedDuplicate":1,"quarantined":0,"retried":0},"errors":[], ...}
```

SEED의 `retried: 2`는 FX-20(429 Retry-After 재시도) 케이스, `quarantined: 1`은 FX-12. 값은 [[07-DATA-PIPELINE|07 수집]] fixture 표 기준. 재시도는 `summary.retried` 횟수만 남고 시도별 기록은 저장하지 않는다. 격리 오류의 `sourceKey`는 `<source>:<noticeId>`라 FX-12는 `fixture:DEMO-2026-0012`이고, `detail`은 값 없이 필드 이름만 담는다(`missing: title`, [[15-DATA-CONTRACTS|15 데이터 계약]] §6). 화면은 `errorCode`를 한국어 라벨(`필수 필드 누락`)과 함께 보인다([[06-UI-UX|06 UI]] §5.8). 데모 기동의 SEED는 보통 `pnpm demo:reset`(trigger `DEMO`)이 넣는다.

### 6.6 live 모드 수집 (나라장터)

```json
POST /api/v1/admin/ingestion/runs            (SOL_RUN_MODE=live)
Idempotency-Key: 4c5d...
X-Requested-With: sol-radar
{"source":"g2b","window":{"from":"2026-10-15T00:00:00Z","to":"2026-10-16T00:00:00Z"},"stages":["NOTICE"]}
→ 202 {"id":"...","source":"g2b","runMode":"live","batch":null,"trigger":"MANUAL","status":"RUNNING","quotaUsed":0, ...}

POST /api/v1/admin/ingestion/runs            (SOL_RUN_MODE=mock)
{"source":"g2b"}
→ 409 {"error":{"code":"RUN_MODE_MISMATCH","message":"...","details":{"runMode":"mock","source":"g2b"},"requestId":"..."}}
```

live 수집 결과의 건수는 실제 공고에 따라 달라지므로 예시에 적지 않는다. 수집된 공고는 `origin:"live"`, `isDemo:false`로 목록에 나온다. 회사 프로필은 실행 모드가 아니라 DB의 최신 revision을 따른다. 로컬·시험·`demo:reset`은 가상 프로필(`isDemo:true`)이고, 운영 DB는 공개 자료 프로필(`isDemo:false`) revision을 쌓는다([[16-DECISIONS|ADR-052]], §4.4).

## 7. 구현 유의

- Route Handler는 얇게 둔다: 인증(세션 쿠키 또는 Bearer, Supabase로 검증) → CSRF 검사(쿠키 인증의 상태 변경 요청) → `sol_role` 확인 → zod 검증 → `@/server/<도메인>` 배럴의 service 호출 → 오류를 §5 형식으로 바꾼다. 업무 로직은 `web/server/<도메인>/`(model·repo·service·index, `import "server-only"`)에 두고 Route Handler·Server Action·서버 컴포넌트가 같이 쓴다.
- 모든 DTO·쿼리·본문은 zod 스키마 하나에서 검증과 타입(`z.infer`)을 얻는다. 화면 폼(react-hook-form)도 같은 스키마를 쓴다. 손으로 두 번 쓰지 않는다.
- 요청 처리 경로의 DB 호출은 사용자 세션(anon 키 + 사용자 토큰)으로만 한다. 조직 범위는 RLS(`org_id in (select public.my_org_ids())`)가 강제하므로 코드가 조건을 빠뜨려도 다른 조직 행은 보이지 않고 404가 된다. 쓰기 권한도 RLS 정책으로 한 번 더 막고, 정책 시험은 `scripts/database.test.mjs`(`pnpm test:db`)에 둔다. `SUPABASE_SERVICE_ROLE_KEY`는 Route Handler에서 쓰지 않는다(worker·seed만, [[09-SECURITY|09 보안]]).
- worker(`web/worker`)는 service role이라 RLS를 거치지 않는다. 조직 데이터를 쓸 때 `org_id`를 직접 지정하고, 테넌트 혼입을 막는 시험을 둔다.
- `POST /bids/:id/analyses`의 중복 방지는 [[04-DATABASE|04 DB]]의 부분 UNIQUE 인덱스와 `Idempotency-Key` 둘로 한다. `force=false`에서 같은 입력의 완료 run이나 진행 중 run이 있으면 새 job을 만들지 않고 `deduplicated:true`로 그 run을 돌려준다(§4.5 분석 요청 계약).
- `POST /bids/:id/reviews`는 한 트랜잭션 안에서 `bid_reviews` insert + `audit_logs` insert를 쓰고, `assigneeUserId`가 있을 때만 `REVIEW_ASSIGNED` outbox(수신자 = 담당자, idempotency `reviewId+assigneeUserId+REVIEW_ASSIGNED`)를 함께 쓴다. supabase-js 질의 빌더는 여러 문장을 한 트랜잭션으로 묶지 못하므로, 이런 쓰기는 `supabase/migrations`의 DB 함수로 만들고 `rpc`로 부른다.
- 응답에 결정 모델 값이 있을 때마다 `disclaimer` 문자열("Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다." — literal 유지, ADR-034)을 내려 보내고, UI는 그 문자열을 그대로 보여 준다. 결정 모델 값(v0.1 분포, v0.2 `scores`·`risks`, 항목별 `requirementAssessments[].kev`)은 화면의 "모델 참고 지표 (점수 미반영)" 영역에만 둔다. 충족 확률·낙찰 확률·수주확률로 읽힐 표현을 쓰지 않는다([[16-DECISIONS|ADR-020]]).
- 실행 모드는 서버가 env `SOL_RUN_MODE`로 정한다. 요청으로 바꿀 수 없다. 소스·모드가 맞지 않는 요청은 조용히 고치지 않고 `409 RUN_MODE_MISMATCH`로 거절한다.
- live 공고 응답(`BidDetail.original`, `structuredQualifications` 등)에는 나라장터 응답의 담당자 필드(이름·전화·이메일)를 넣지 않는다. 이 필드는 정규화 단계에서 이미 빠진다([[07-DATA-PIPELINE|07 수집]], [[09-SECURITY|09 보안]]).
- `/admin/ai/models`·`/admin/ai/status`의 레지스트리 값은 gateway `/health`에서 읽는다. Route Handler가 결정 모델·Qwen 서버를 직접 부르지 않는다.
- 계약 변경은 zod 스키마 diff와 Route Handler 계약 시험으로 PR에서 보이게 한다. OpenAPI 문서는 선택이며, 만들면 zod 스키마에서 생성한다.
- 템플릿의 `/api/auth/*`(`me`·`providers`·`logout-all`·`identities/[id]`)·`/api/users/me`·`/api/admin/users/[id]/status`는 템플릿 기능(로그인 수단 연결·운영자 정지 등)이며 이 계약(`/api/v1`) 밖이다. 지금도 `web/app/api/` 아래에 남아 있다(의도한 예외). 템플릿 운영자 API를 `/api/ops/users/:id/status`로 옮기는 `/ops` 분리([[16-DECISIONS|ADR-021]])는 해커톤 이후다([[16-DECISIONS|ADR-023]]). 옮긴 뒤에도 `profiles.is_admin`만 부른다. 조직 ADMIN의 `/api/v1/admin/*`와 다르다. 조직 ADMIN은 `/ops`에 들어가지 못한다(404).

## 8. 솔리데오 가입 정보 계약 (ADR-019, 구현됨: `GET /api/v1/signup-options`, `GET·PATCH /api/v1/me/employment`)

가입·로그인 자체는 §2 표 아래 문단과 같고, 이 절은 가입 신고 정보만 다룬다. 아래 타입은 외부 계약 설명이며 구현 시 `web/server/profile` 등 해당 도메인의 zod 스키마에서 타입을 얻는다.

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

`GET /signup-options`는 원본 인원·배분 인원·직원 이름·성별·사진 manifest·연락처를 노출하지 않는다. `PATCH /me/employment`는 로그인한 본인의 이름·부서·직급 신고 정보를 하나의 profiles 갱신으로 원자적으로 저장하며, 쿠키 요청은 §1 CSRF 헤더를 요구한다. 요청에 userId/orgId/역할을 받아 다른 사람이나 업무 권한을 바꾸지 않는다. `GET /me`·`User`의 employment도 자기 신고 정보이지 검증된 소속 증명은 아니다. `GET /signup-options`의 부서 목록은 팀(`kind`가 `TEAM`이거나 없음)만 돌려준다. 본부·그룹은 조직도 표시용이다([[16-DECISIONS|ADR-021]]).

`profileComplete`는 이름·두 신고 값의 현재 유효성으로 서버에서 계산하며 클라이언트의 boolean을 신뢰하지 않는다. OAuth 콜백·기존 미완료 계정 로그인은 `/auth/complete-profile`로 보낸다. 업무 화면과 업무 API에서 모두 보완 전 접근을 막는다. Auth 콜백·가입 옵션·본인 신고 정보 조회/저장·로그아웃·초대 안내는 보완 전에도 허용해 반복 이동을 막는다. 보완을 끝내도 멤버십·RLS 확인과 기존 초대 정책은 그대로 적용한다.

## 9. 카카오톡 알림 설정 계약 ([[16-DECISIONS|ADR-038]], 기본 `mock`)

개인 설정의 "카카오톡 알림" 칸([[06-UI-UX|06 UI]])이 쓰는 본인 전용 경로다. 설계는 [카카오 알림 설계](plans/2026-10-20-kakao-memo-notify-design.md) §6·§9·§10, 동작은 [[13-NOTIFICATIONS|13 알림]] "카카오톡 추천 공고"다. 화면 상태 모양(`KakaoNotifyView`)은 `web/server/kakao-notify`에, Route Handler는 `web/app/api/v1/me/kakao-notify/` 아래 `route.ts`·`connect`·`callback`·`test`에 있다. 실발송(`memo`)은 확인하지 않았다. 발송을 맡는 회사 알림(Notify) Worker는 준비만 했고 기동하지 않았다(`infra/company/README.md` §9). 운영 카카오 연결은 0건이다. 세션 쿠키 + 상태 변경에 `X-Requested-With: sol-radar`(§1 CSRF)다. 남의 연결은 다루지 않는다. 경로마다 본인 것만이다.

```ts
interface KakaoNotifyView {
  state: "DISCONNECTED" | "OFF" | "ON" | "EXPIRED";   // 연결 전 · 연결됨·꺼짐 · 켜짐 · 연결 만료. 만료는 켬·끔보다 먼저 본다
  lastSentAt: string | null;                          // 마지막 발송 시각(kakao_notify_links.last_sent_at)
  lastResult: "SENT" | "FAILED" | "EXPIRED" | null;   // 마지막 발송 결과. 토큰은 이 모양에 없다
}
interface KakaoNotifyEnabledInput { enabled: boolean }
```

- 연결: `GET /me/kakao-notify/connect`가 짧은 수명의 `state`(CSRF 방지)를 만들고 카카오 인가로 보낸다. 콜백은 `state`를 확인하고, 코드를 토큰으로 바꾸고, 응답 `scope`에 `talk_message`가 없으면 저장하지 않는다. 결과는 `/settings?kakao=connected|consent_denied|state_mismatch|failed`로 돌려 보내고 설정 화면이 문구로 보인다. 토큰은 서버에서 암호화해 RPC `save_kakao_notify_link`로 저장하고 연결과 함께 켠다([[04-DATABASE|04 DB]] §3.1, [[09-SECURITY|09 보안]]).
- 켜기·끄기·해제는 RPC `set_kakao_notify_enabled`·`disconnect_kakao_notify`를 부른다. 시험 메시지는 `request_kakao_notify_test`가 outbox `KAKAO_TEST`를 넣고 worker가 보낸다(1분에 한 번).
- 응답 코드(204·202·307·409·429)의 정본은 `web/app/api/v1/me/kakao-notify/**`다. 연결·콜백의 이동은 `NextResponse.redirect` 기본값인 307이다.

## Redis HTTPS 접수 경계 (ADR-045)

사용자용 `/api/v1` 경로·Supabase 세션·업무 RBAC/RLS 계약은 유지한다. Vercel `frontend`는 분석·추천 분석·수동 수집 접수(POST), 수동 수집 gate 읽기, 관리자 AI 상태(ADR-049)와 `/health/ready`만 회사 Next.js `redis-api`로 중계한다(`relayRedisApi`, `readRedisApiReadiness`). 분석 요청은 중계 전에 분석 원문을 확인해 `409 ANALYSIS_SOURCE_MISSING`으로 막고, gate·AI 상태는 중계 전에 ADMIN을 확인한다(같은 403). 분석·수집 실행 결과 읽기(`GET /analyses/{id}`·`GET /admin/ingestion/runs/{id}`)와 추천 분석 GET은 frontend가 사용자 세션(RLS)으로 직접 읽는다. `redis-api`의 허용 경로는 아래 8개이고 그 밖은 404다(`web/app/_lib/redis-api-path.ts`). 이 표는 회사 Gateway 쪽 경로라 `web/app/api/v1/**/route.ts` 목록과 따로 둔다(의도한 예외). 외부 prefix는 `https://acropolissg.com/redis`, Nginx는 `/redis/`를 제거하며 설정을 변경하지 않는다.

| 회사 Gateway 외부 경로 | 메서드 | 인증 | 응답 |
| --- | --- | --- | --- |
| `/redis/health` | GET | `X-Sol-Service-Token` | 기존 readiness 상태, 200/503; 토큰 실패401 |
| `/redis/api/v1/bids/{id}/analyses` | POST | 서비스 token + 사용자 Bearer | 기존202 AnalysisAccepted·pollUrl |
| `/redis/api/v1/bids/{id}/analyses/{runId}/insight` | POST | 서비스 token + 사용자 Bearer | 202 InsightAccepted·pollUrl(ADR-066, op `insight-submit`). GET 은 중계하지 않는다 |
| `/redis/api/v1/analyses/{id}` | GET | 동일 | 기존 분석 상태/결과·타 조직404 |
| `/redis/api/v1/admin/ingestion/runs` | POST | 동일 + 업무 ADMIN | 기존202 IngestionRun |
| `/redis/api/v1/admin/ingestion/runs/{id}` | GET | 동일 + 업무 ADMIN | 기존 수집 실행, Worker 행 생성 전404 가능 |
| `/redis/api/v1/admin/ingestion/manual-gate` | GET | 동일 + 업무 ADMIN | 수동 수집 gate·정기 일정 상태 |
| `/redis/api/v1/admin/ai/status` | GET | 동일 + 업무 ADMIN | `AiStatus` |

서비스 token은 서버 전용32바이트 이상 난수이며 사용자 JWT와 별도다. token만으로 업무 권한을 만들지 않는다. 비허용 경로·임의 Redis 명령은404다. Cookie·refresh token·신뢰되지 않은 org/role 헤더는 전달하지 않는다. 요청16KiB, 접수 HTTP 전체15초 상한, 최대1회 재시도 시 동일 Idempotency-Key/본문을 쓴다. 429/Retry-After·409는 보존하고 upstream 502/HTML/잘못된 응답은503 `SERVICE_UNAVAILABLE`(`component:redis-api`)로 정규화한다.

현재 수집/분석의 Redis·DB crash 경계는 기존대로다. 공공 API 호출 예산은 Worker가 외부 HTTP 직전에 예약한다(`infra/company/README.md` §6 F08). 큐 등록의 durable dispatch는 없으므로 무손실/정확히1회 실행을 이 API의 검증 결과로 주장하지 않는다. 자세한 운영·승인 경계는 [[10-DEPLOYMENT|10 배포]]와 [[2026-10-21-redis-gateway-supabase-storage-migration|전환 계획]]을 따른다.

Next 설정의 기존 별칭(`/account`, `/favicon.ico`)과 trailing slash 정규화는 Proxy 이전308일 수 있으며 목적지에서 허용 경로·인증을 다시 적용한다. Gateway client는 redirect를 따라가지 않는다. Readiness는 backend2초 probe에 전송 여유를 준 별도5초 상한이며 AI만 지연되면200/degraded를 유지한다.

## 관련 문서

- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `NormalizedBid`
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `RequirementExtraction`, `KevAssist`
- [[04-DATABASE|04 DB]] — 테이블·ENUM 대응
- [[06-UI-UX|06 UI]] — 화면별 사용 엔드포인트
- [[08-SCORING|08 점수]] — `scoreBreakdown` 계산
- [[09-SECURITY|09 보안]] — 세션 쿠키·CSRF·RBAC·RLS
- [[13-NOTIFICATIONS|13 알림]] — `Notification` 이벤트, 카카오톡 추천 공고
- [[11-TESTING|11 테스트]] — Route Handler 계약 시험·RLS 정책 시험
- [[16-DECISIONS|16 ADR]] — ADR-052(회사 공개 프로필·EXECUTIVE 역할), ADR-016(zod), ADR-017(Next.js + Supabase), ADR-020(실행 모드·나라장터 수집·결정 모델 v0.2·평가 API), ADR-034(결정 모델 Bosun v3.1 0.6B·추출 Qwen3.8-Flash-Next), ADR-035(수동 수집 계약·`AiStatus` 보완)
- [[21-MODEL-TRAINING|21 모델 학습]] — `EvalRunReport` 지표, 모델 레지스트리, 운영자 CLI
- [[07-DATA-PIPELINE|07 수집]] — `IngestionRunInput` 소스, 나라장터 Connector·정규화
