---
title: "20. 용어집"
doc: "20"
status: draft
tags:
  - sol-radar
  - glossary
updated: 2026-10-16
---

# 20. 용어집

문서 전체에서 같은 뜻으로 쓰는 용어. 코드 식별자는 영어 그대로 쓴다. 정의가 바뀌면 이 문서를 먼저 고치고 다른 문서를 맞춘다.

## 제품·도메인

| 용어 | 정의 | 주 문서 |
|---|---|---|
| SOL RADAR | 공공 SI·AX 기업용 입찰 참여 의사결정 지원 플랫폼. 자동 투찰은 하지 않는다 | [[01-PRD]] |
| 공공 SI | 공공기관 발주 시스템 통합 사업을 수행하는 IT 기업 | [[01-PRD]] |
| AX | AI Transformation. AI를 적용한 업무·서비스 전환 사업 | [[01-PRD]] |
| 조달청 (PPS) | 대한민국 공공조달 주관 기관 | [[07-DATA-PIPELINE]] |
| 나라장터 (KONEPS) | 조달청이 운영하는 국가종합전자조달 시스템. 공고·입찰·계약이 공개된다 | [[07-DATA-PIPELINE]] |
| 공공데이터포털 (data.go.kr) | 공공 API를 신청·사용하는 포털. 조달 공고 API의 출처 | [[07-DATA-PIPELINE]] |
| 발주계획 | 기관이 연간·분기 발주 예정 사업을 미리 공개하는 단계 (`stage=PLAN`) | [[07-DATA-PIPELINE]] |
| 사전규격 | 입찰공고 전 규격서를 공개하고 의견을 받는 단계 (`stage=PRE_SPEC`) | [[07-DATA-PIPELINE]] |
| 입찰공고 | 실제 입찰 참가를 받는 공고 (`stage=NOTICE`) | [[07-DATA-PIPELINE]] |
| 정정공고 / 차수 | 같은 공고의 내용(예산·마감·자격)이 바뀐 재공고. 같은 bid의 새 revision으로 관리 | [[07-DATA-PIPELINE]] |
| 입찰참가자격 (필수 자격) | 공고가 요구하는 업종·면허·실적·인증 등. 하나라도 미충족이면 참여 불가 | [[08-SCORING]] |
| 회사 프로필 | 우리 회사의 기술·자격·실적·인력 정보. revision으로 버전화 | [[04-DATABASE]] |
| 솔리데오 데모 조직 | 사용자 회사명 솔리데오·원본 부서/직급을 사용하되 직원 200명·사진·자격·실적·재무·가용성은 가상인 데모 조직. 회사 선택은 고정 | [[19-DEMO-SCENARIO]] |

## 판정·점수·결정

| 용어 | 정의 | 주 문서 |
|---|---|---|
| 자격 판정 (`qualification_checks`) | 필수 항목별 `SATISFIED` / `NOT_SATISFIED` / `NEEDS_REVIEW`. 증빙 없으면 `NEEDS_REVIEW`. 법적 자격 자동 확정 안 함 | [[08-SCORING]] |
| SOL Score | 우리 회사와 특정 공고의 내부 적합도 0~100. **낙찰 확률이 아니다.** 결정론적 규칙으로 계산 | [[08-SCORING]] |
| 점수 요소 (`score_factors`) | 기술 스택 적합 30, 유사 실적 25, 인력 가용성 20, 규모 적합성 15, 전략 선호 10 | [[08-SCORING]] |
| `missingFactors` | 데이터가 없어 중립·보수 정책으로 처리한 요소 목록 | [[08-SCORING]] |
| 권고 (recommendation) | 시스템이 내는 `BID` / `WATCH` / `NO_BID`. 결정이 아니다 | [[08-SCORING]] |
| 결정 (decision, `bid_reviews`) | 사람이 사유와 함께 기록하는 최종 참여 판단 | [[08-SCORING]] |
| BID / WATCH / NO-BID | 참여 / 관망·추가 검토 / 불참 | [[08-SCORING]] |
| `MODEL_RULE_DISAGREEMENT` | Kev 보조 의견과 규칙 판정이 상충할 때 발생. 사람 검토 필수 | [[08-SCORING]] |
| `INSUFFICIENT_DATA` | 근거가 없어 값을 표시하지 않는 상태. 임의 값으로 채우지 않는다 | [[00-README]] |
| 분석 상태 | `NOT_ANALYZED → QUEUED → PROCESSING → COMPLETED / PARTIAL / FAILED`. `PARTIAL`은 AI 없이 규칙만으로 완결한 결과 | [[06-UI-UX]] |
| 골든셋 / 골든 시나리오 | 기대 결과가 사람에 의해 확정된 테스트 입력. 회귀 기준 | [[11-TESTING]] |
| precision@K | 추천 상위 K개 중 실제 적합 공고 비율 | [[01-PRD]] |
| 백테스트 / 시점 일치 | 과거 데이터로 검증할 때 의사결정 시점 이후 정보(낙찰 결과 등)를 쓰지 않는 원칙 | [[15-DATA-CONTRACTS]] |

## AI

| 용어 | 정의 | 주 문서 |
|---|---|---|
| Qwen | 오픈 가중치 LLM 계열. 공고문에서 요구조건을 JSON으로 추출하고 한국어 설명을 생성 | [[03-AI-PIPELINE]] |
| Kev | Jared Palmer의 Apache-2.0 소형 결정 모델(Qwen3.5 기반 0.8B/4B/9B, Qwen3.8 기반 27B). 타입이 정해진 질문에 텍스트 생성 없이 캘리브레이션된 확률을 돌려준다. 모델 카드 기준 영어 전용. 저장소 https://github.com/jaredpalmer/kev | [[03-AI-PIPELINE]] |
| System One (TypeSafe) | Kev 서버가 호환하는 API 프로토콜. 엔드포인트 `POST /v1/systemone` | [[03-AI-PIPELINE]] |
| `noul` / `choice` / `score` | Kev 질문 타입: yes/no, 다지선다, 등급 평가 | [[03-AI-PIPELINE]] |
| Kev 분포 | 선택지에 대한 모델 확률 분포. **수주확률이 아니다.** UI에 항상 고지 | [[06-UI-UX]] |
| 규칙 엔진 | 필수 자격·점수·결정 정책을 계산하는 결정론적 코드. 최종 권고의 주체 | [[08-SCORING]] |
| 임베딩 / Qdrant | 근거 문단을 벡터로 저장·검색. 재생성 가능한 파생 인덱스 | [[02-ARCHITECTURE]] |
| `EvidenceRef` | 근거 인용 구조 `{documentId, revisionId, page?, charStart?, charEnd?, quotedText?, sourceUrl?, fetchedAt}`. 원문과 매칭 검증 실패 시 무효 | [[15-DATA-CONTRACTS]] |
| `fieldState` | 필드 상태 `KNOWN / UNKNOWN / NOT_APPLICABLE / CONFLICTED` | [[15-DATA-CONTRACTS]] |
| 프롬프트 인젝션 | 외부 문서 안의 지시문이 모델을 조종하려는 공격. 외부 문서는 데이터로만 취급 | [[09-SECURITY]] |
| HITL (Human-in-the-loop) | 사람이 반드시 개입하는 지점. 최종 결정, `NEEDS_REVIEW`, `MODEL_RULE_DISAGREEMENT` | [[09-SECURITY]] |
| `AI_PROVIDER` | `mock` / `local` / `hosted`. 데모 기본은 `mock` | [[03-AI-PIPELINE]], [[10-DEPLOYMENT]] |
| `KEV_ENABLED` | Kev 실모델 사용 플래그. 한국어 도메인 검증 전 기본 `false` | [[03-AI-PIPELINE]] |

## 데이터·플랫폼

| 용어 | 정의 | 주 문서 |
|---|---|---|
| revision (`bid_revisions`) | 공고 내용의 버전. `sha256(canonical normalized payload)` 변화로 생성 | [[07-DATA-PIPELINE]] |
| 입력 스냅샷 (`input_snapshot`) | 점수 계산 시점의 입력 전체 복사본. 재현용 | [[04-DATABASE]] |
| 알고리즘 버전 (`algorithm_version`) | 점수 규칙 버전 식별자 (예: `sol-v0.1.0`) | [[08-SCORING]] |
| outbox 패턴 | 도메인 변경과 알림 이벤트를 같은 트랜잭션에 기록하고 worker(`web/worker`)가 전달 | [[13-NOTIFICATIONS]] |
| 멱등키 (idempotency key) | 같은 요청·이벤트를 두 번 처리하지 않게 하는 고유 키 | [[05-API-SPEC]], [[13-NOTIFICATIONS]] |
| 커서 페이지네이션 | `{items, pageInfo:{cursor,nextCursor,hasNext}}` 형식의 목록 응답 | [[05-API-SPEC]] |
| fixture | 외부 API 없이 쓰는 가상 공고 데이터 `FX-01`~`FX-20` | [[07-DATA-PIPELINE]] |
| `DEMO_MODE` / DEMO 데이터 | 외부 호출 없이 fixture로 동작하는 모드. 화면에 가상임을 표시 | [[00-README]] |
| Connector | 수집 소스 어댑터 `fetchPage({from,to,cursor})` | [[07-DATA-PIPELINE]] |
| 격리 (quarantine) | 검증 실패 레코드를 적재하지 않고 따로 보관 | [[07-DATA-PIPELINE]] |
| DLQ | Dead-letter queue. 재시도 소진 작업 보관 | [[02-ARCHITECTURE]] |
| circuit breaker | 연속 실패 시 외부 호출을 잠시 끊는 보호 장치 | [[02-ARCHITECTURE]] |
| BullMQ | Redis 기반 작업 큐. 수집·분석·알림 job. 소비자는 worker 진입점 `web/worker` | [[02-ARCHITECTURE]] |
| MinIO | S3 호환 사설 객체 저장소. 첨부 원본 | [[02-ARCHITECTURE]] |
| presigned URL | 서버가 권한 검사 후 발급하는 짧은 수명의 파일 접근 URL | [[09-SECURITY]] |
| HWP / HWPX | 한국 공공 문서 형식. 파서 선택은 미결정 | [[16-DECISIONS]] |

## 아키텍처·실행

| 용어 | 정의 | 주 문서 |
|---|---|---|
| Supabase | DB(Postgres)와 인증(Auth)을 맡는 관리형 서비스. SOL RADAR는 이 둘만 쓴다. Storage·pgvector·Queues는 쓰지 않는다(첨부는 MinIO, 검색은 Qdrant, 큐는 Redis/BullMQ). 개발은 Supabase 클라우드 프로젝트. 데모·배포 실행 환경은 미결정 | [[02-ARCHITECTURE]], [[16-DECISIONS]] |
| Supabase Auth | 이메일 + 비밀번호·간편 로그인, 공개 가입(업무 조직 합류는 초대), 토큰 발급·갱신을 맡는 Supabase 인증 기능. 사용자 원본은 `auth.users`. 자체 로그인·토큰 엔드포인트는 두지 않는다. 토큰 만료·로그인 제한 같은 세부 값은 대시보드 설정이고 미검증 | [[09-SECURITY]] |
| 간편 로그인 | 구글·카카오·네이버 계정으로 가입·로그인하는 방식. Supabase Auth 제공자로 받는다(구글·카카오는 기본 제공자, 네이버는 사용자 정의 OIDC `custom:naver`). 버튼은 `NEXT_PUBLIC_AUTH_GOOGLE`·`KAKAO`·`NAVER`로 켜고, 제공자 설정은 해커톤 후순위다 | [[16-DECISIONS]] |
| Route Handler | Next.js App Router의 서버 HTTP 핸들러(`web/app/api/v1/**/route.ts`). 외부 API 계약 `/api/v1/...`과 헬스체크 `/health/live`·`/health/ready`를 낸다 | [[05-API-SPEC]] |
| 서버 도메인 (`web/server/<도메인>`) | 서버 전용 업무 코드. model·repo·service·index(배럴)로 나누고 `import "server-only"`로 시작한다. 다른 코드는 배럴(`@/server/<도메인>`)로만 부른다. 예: `bids`·`ingestion`·`scoring`·`analysis`·`review`·`notifications`·`company-profile`·`health` | [[02-ARCHITECTURE]] |
| zod 스키마 (계약 단일 원천) | `web/server/<도메인>/*.model.ts`의 zod 스키마. 화면 폼·Route Handler·worker가 같은 스키마로 입력을 검증한다. OpenAPI 문서는 필요하면 여기서 생성한다(선택) | [[05-API-SPEC]], [[16-DECISIONS]] |
| worker 진입점 (`web/worker`) | BullMQ 소비자(ingest job·analysis job)를 띄우는 별도 Node(TypeScript) 프로세스. `web/server` 도메인 코드를 같이 쓴다. `server-only` 모듈을 불러오는 실행 방식(`node --conditions=react-server`)은 Phase 0 검증 항목 | [[02-ARCHITECTURE]], [[16-DECISIONS]] |
| AI gateway | Python FastAPI 서비스(`services/ai/`, :8000). Qwen·Kev 호출은 이것만 한다. Next 서버와 worker는 Kev에 직접 접근하지 않는다 | [[03-AI-PIPELINE]] |
| 마이그레이션 (`supabase/migrations/`) | 스키마·RLS 정책·DB 함수를 담는 SQL 파일. 새 파일로만 쌓는다(append-only). 클라우드 적용은 `pnpm db:push`(사용자 확인 뒤에만) | [[04-DATABASE]] |
| 생성 타입 (`web/lib/database.types.ts`) | 마이그레이션에서 만든 DB 타입(`pnpm db:types`). 손으로 고치지 않고 마이그레이션과 같은 커밋에 넣는다 | [[04-DATABASE]] |
| 정책 시험 (PGlite) | `scripts/database.test.mjs`를 `node --test` + PGlite로 돌려 RLS·권한·제약·seed 멱등을 본다(`pnpm test:db`) | [[11-TESTING]] |
| `pnpm demo:reset` | 데모 seed 스크립트. service role로 Supabase 프로젝트에 조직 2·계정 5·fixture를 `is_demo=true`로 멱등 적재한다 | [[10-DEPLOYMENT]], [[19-DEMO-SCENARIO]] |
| Compose 서비스 | `infra/compose.yaml`의 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(+ 선택 `web`). DB는 Supabase라 Compose에 없다. 프로필 `demo` / `ai-local` / `ai-hosted` | [[10-DEPLOYMENT]] |

## 권한·보안

| 용어 | 정의 | 주 문서 |
|---|---|---|
| ADMIN / SALES / ANALYST / VIEWER | SOL RADAR 업무 역할. `memberships.sol_role` 값이다. 리소스별 정책으로 적용되며 단순 상하 관계가 아니다 | [[09-SECURITY]] |
| `sol_role` | `memberships`의 업무 역할 열. text + check(`ADMIN`·`SALES`·`ANALYST`·`VIEWER`), 기본 `VIEWER`. API 권한 열(허용 역할 나열)이 이 값을 본다 | [[04-DATABASE]], [[05-API-SPEC]], [[09-SECURITY]] |
| `org_role` | `memberships`의 조직 관리 역할(`owner`·`member`, 템플릿에서 가져옴). 초대·구성원 관리에만 쓰고 업무 권한은 `sol_role`이 정한다. 데모 `admin@soltech.invalid`는 `owner` + `ADMIN` | [[04-DATABASE]], [[09-SECURITY]] |
| 서비스 운영자 (`profiles.is_admin`) | 서비스 전체 운영자 플래그. 조직 역할과 별개이며, 운영자도 남의 조직 데이터는 읽지 못한다 | [[09-SECURITY]] |
| `org_id` | 조직 소유 데이터 표의 조직 열 이름. JSON 필드는 `orgId`. 요청 본문·쿼리의 조직 ID는 믿지 않고 세션 사용자의 멤버십으로 정한다 | [[04-DATABASE]] |
| `my_org_ids()` | `public.my_org_ids()`. 로그인한 사용자가 멤버인 조직 id 목록을 돌려주는 DB 함수(`security definer`). RLS 정책은 `org_id in (select public.my_org_ids())`로 쓴다 | [[04-DATABASE]], [[09-SECURITY]] |
| RLS (Row Level Security) | Postgres 행 단위 접근 정책. 누가 어떤 행을 읽고 쓰는지를 코드가 아니라 DB가 정한다. 새 표는 만들자마자 켜고 필요한 권한·정책만 연다 | [[04-DATABASE]], [[09-SECURITY]] |
| 테넌트 격리 | 조직 소유 데이터에 `org_id`를 두고 RLS로 내 조직 행만 보이게 한다. 다른 조직 자원은 행이 안 보여 `404`(403 아님). 공용 공고 표는 `authenticated` 읽기 전용 | [[04-DATABASE]], [[09-SECURITY]] |
| 공용 데이터 / 조직 데이터 | 공용: 조직 소유가 없는 공고 표(`bid_notices`·`bid_revisions`·`bid_documents`·`requirement_extractions` 등), 쓰기는 worker만. 조직: `company_profiles`·`score_runs`·`qualification_checks`·`bid_reviews`·`notifications`·`audit_logs` 등, `org_id` + RLS | [[04-DATABASE]] |
| anon 키 | `NEXT_PUBLIC_SUPABASE_ANON_KEY`. 브라우저에 나가도 되는 공개 키이고 권한은 RLS가 정한다. Next 요청 처리는 anon 키 + 사용자 세션으로 DB를 부른다 | [[09-SECURITY]], [[10-DEPLOYMENT]] |
| service role 키 | `SUPABASE_SERVICE_ROLE_KEY`. RLS를 무시하는 비밀 키. worker와 seed 스크립트(서버 전용)만 쓰고, 쓸 때 `org_id`를 직접 지정한다. `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다 | [[09-SECURITY]], [[10-DEPLOYMENT]] |
| 세션 쿠키 | `@supabase/ssr`가 관리하는 Supabase 로그인 쿠키. 브라우저 클라이언트가 같은 쿠키를 읽어야 해서 HttpOnly가 아니다. SameSite=Lax, 운영에서 Secure. XSS 방어는 CSP nonce가 맡는다 | [[09-SECURITY]] |
| Bearer access token | `Authorization: Bearer <Supabase access token>`. 스크립트·시연(격리 시연, 스모크)이 Route Handler를 부를 때 쓴다. 서버가 Supabase로 검증하고 그 사용자 권한으로 RLS가 적용된다 | [[05-API-SPEC]], [[09-SECURITY]] |
| CSRF 헤더 | 쿠키 인증의 상태 변경 요청(POST/PUT/PATCH/DELETE)에 필요한 `X-Requested-With: sol-radar`. 없으면 `403 CSRF_REJECTED`. Bearer 요청은 제외 | [[05-API-SPEC]], [[09-SECURITY]] |
| IDOR | 다른 조직 자원을 ID만 바꿔 조회하는 공격. 조직 검사로 차단 | [[09-SECURITY]] |
| SSRF | 서버가 내부 자원으로 요청하게 유도하는 공격. 첨부 다운로드 allowlist로 차단 | [[09-SECURITY]] |
| 감사 로그 (`audit_logs`) | 누가 무엇을 바꿨는지 before/after와 함께 기록 | [[04-DATABASE]] |

## 바뀐 용어 (ADR-017)

ADR-017(2026-10-16) 전 문서·코드에서 이 왼쪽 표현을 보면 오른쪽으로 읽고 고친다. 이력 서술(ADR-001·002) 말고는 왼쪽 표현을 새로 쓰지 않는다.

| 이전 표현 | 지금 쓰는 표현 | 주 문서 |
|---|---|---|
| `organization_id` / `organizationId` | `org_id` / `orgId` | [[04-DATABASE]] |
| NestJS API·Worker | Route Handler(`web/app/api/v1`)·서버 도메인(`web/server`)·worker 진입점(`web/worker`) | [[02-ARCHITECTURE]] |
| Prisma schema·migration | `supabase/migrations/*.sql` + 생성 타입 `web/lib/database.types.ts` | [[04-DATABASE]] |
| 자체 JWT 쿠키(`sol_access`·`sol_refresh`)·refresh 회전 구현 | Supabase Auth 세션 쿠키(`@supabase/ssr`)·Supabase Auth 설정 | [[09-SECURITY]] |
| `users` 표·비밀번호 해시·계정 잠금 열 | `auth.users`(Supabase Auth) + `profiles`(계정 상태 `status`) | [[04-DATABASE]] |
| OpenAPI 계약 단일 원천 | zod 스키마 단일 원천(OpenAPI는 선택 생성물) | [[05-API-SPEC]] |
| `seed-demo` Compose 서비스 | `pnpm demo:reset` 스크립트 | [[10-DEPLOYMENT]] |
| Jest·Supertest | Vitest(웹·서버·Route Handler), `node --test` + PGlite(DB 정책) | [[11-TESTING]] |

## 문서 운영

| 용어 | 정의 | 주 문서 |
|---|---|---|
| ADR | Architecture Decision Record. 결정·상태·날짜·근거 기록 | [[16-DECISIONS]] |
| MOC | Map of Content. Obsidian에서 허브 역할을 하는 문서. 이 vault는 [[00-README]] | [[00-README]] |
| 콜아웃 | `> [!warning] 미검증 가정`, `> [!success] 검증됨`, `> [!todo]`, `> [!tip] 심사 포인트` | [[00-README]] |
| 해커톤 컷 | 데모 필수 / 있으면 좋음 / 해커톤 이후로 나눈 범위 | [[12-ROADMAP]] |
| `docs/evidence/` | 테스트 리포트·스크린샷·기동 로그를 두는 증거 폴더 | [[11-TESTING]], [[17-CLAUDE-IMPLEMENTATION]] |

## 솔리데오 인력·가입 용어 (ADR-019)

| 용어 | 뜻 | 원천 |
|---|---|---|
| 가상 직원 명부 | 솔리데오 부서에 배치한 인력 200명(남녀 100/100). 로그인 계정 명단과 별개 | [[07-DATA-PIPELINE]] |
| 직급/직책 | 엑셀에서 이름 오른쪽의 표현을 그대로 쓰는 단일 선택 항목. PM 등 직무·기술등급·업무 권한과 구분 | [[04-DATABASE]] |
| 가입 신고 정보 | 가입자가 선택한 부서·직급. 검증해 저장하지만 멤버십·권한·실제 재직 증명으로 사용하지 않음 | [[05-API-SPEC]] |
| 프로필 보완 | OAuth·기존 계정의 미완료 필수 가입 정보를 첫 업무 진입 전에 채우는 흐름 | [[06-UI-UX]] |
| personId | 가상 직원의 `SOL-P0001`~`SOL-P0200` 고정 ID. 이름·소속·사진을 연결 | [[07-DATA-PIPELINE]] |
| scoringEligible | 전체 200명 중 가상 점수 계산에 포함할 27명을 명시하는 값. 가입 권한·재직 여부와 무관 | [[08-SCORING]] |

## 관련 문서

- [[00-README|00 인덱스]]
- [[15-DATA-CONTRACTS|15 데이터 계약]]
- [[08-SCORING|08 SOL Score]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[18-HACKATHON|18 해커톤 전략]]
- [[16-DECISIONS|16 ADR]]
- [[09-SECURITY|09 보안]]
