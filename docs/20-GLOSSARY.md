---
title: "20. 용어집"
doc: "20"
status: draft
tags:
  - sol-radar
  - glossary
updated: 2026-10-21
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
| 추천 공고 | 사람이 요청한 분석에서 권고가 BID 또는 WATCH로 처음 나온 공고. 조직·공고마다 한 번 outbox `BID_RECOMMENDED`가 생기고, 카카오톡 알림을 켠 구성원에게 보낸다. 데모 사전 분석은 제외한다. 권고이지 결정이 아니다([[16-DECISIONS]] ADR-038) | [[13-NOTIFICATIONS]] |
| `MODEL_RULE_DISAGREEMENT` | 결정 모델 참고 지표(`recommendation`)와 규칙 판정이 상충할 때 발생. 사람 검토 필수 | [[08-SCORING]] |
| `INSUFFICIENT_DATA` | 근거가 없어 값을 표시하지 않는 상태. 임의 값으로 채우지 않는다 | [[00-README]] |
| 분석 상태 | `QUEUED → RUNNING → COMPLETED / PARTIAL / FAILED`. 분석이 없는 공고는 상태 값이 아니라 `latestAnalysis=null`(화면 `미분석`). `PARTIAL`은 AI 없이 규칙만으로 완결한 결과([[16-DECISIONS\|ADR-029]] A6 D17) | [[06-UI-UX]] |
| 골든셋 / 골든 시나리오 | 기대 결과가 사람에 의해 확정된 테스트 입력. 회귀 기준 | [[11-TESTING]] |
| precision@K | 추천 상위 K개 중 실제 적합 공고 비율 | [[01-PRD]] |
| 백테스트 / 시점 일치 | 과거 데이터로 검증할 때 의사결정 시점 이후 정보(낙찰 결과 등)를 쓰지 않는 원칙 | [[15-DATA-CONTRACTS]] |

## AI

| 용어 | 정의 | 주 문서 |
|---|---|---|
| Qwen | 오픈 가중치 LLM 계열. 공고문에서 요구조건을 JSON으로 추출하고 한국어 설명을 생성 | [[03-AI-PIPELINE]] |
| Kev | **퇴역(2026-10-20 ADR-034, Bosun으로 교체)**. Jared Palmer의 Apache-2.0 소형 결정 모델(Qwen3.5 기반 0.8B/4B/9B, Qwen3.8 기반 27B). 타입이 정해진 질문에 텍스트 생성 없이 캘리브레이션된 확률을 돌려준다. 모델 카드 기준 영어 전용. 저장소 https://github.com/jaredpalmer/kev. 이름 `KEV_*`·`kev_*`·`/kev`·`kev-qs`는 호환 레이어로 남는다 | [[16-DECISIONS\|ADR-034]] |
| Bosun | Hanno Labs의 Apache-2.0 소형 결정 모델 `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`(백본 `Qwen/Qwen3-0.6B`, LoRA r=16 + decision token 256개). 2026-10-20 ADR-034로 Kev-9B를 대체한 **결정 모델**. 우리 `sol_decision` 서버(`127.0.0.1:8009`)가 Kev wire 호환으로 띄운다. 학습 데이터(DecisionBench)가 영어라 한국어 성능은 미검증 | [[03-AI-PIPELINE]], [[16-DECISIONS\|ADR-034]] |
| decision token | Bosun이 후보마다 하나씩 쓰는 특수 토큰 256개(`decision_000`~`decision_255`). 모델은 텍스트 대신 이 토큰들 위의 분포를 내고, 그것이 질문별 확률이 된다 | [[03-AI-PIPELINE]] |
| `presented_slot` | Bosun의 decision token 배정 방식. 후보를 seed로 섞어 제시한 슬롯 순서대로 토큰을 배정하고 `candidate_to_slot`으로 원래 후보에 되돌린다. 제시 순서 민감도는 seed 여러 개로 잰다 | [[21-MODEL-TRAINING]] |
| E1' | 공개 Bosun v3.1 0.6B zero-shot(영어 state)을 E4와 같은 test 세트에서 돌린 기준선. Kev-9B의 E1은 미측정 | [[21-MODEL-TRAINING]] |
| System One (TypeSafe) | Kev wire가 따르는 API 프로토콜. 우리 `sol_decision` 서버(Bosun)도 호환한다. 엔드포인트 `POST /v1/systemone` | [[03-AI-PIPELINE]] |
| `noul` / `choice` / `score` | 결정 모델 질문 타입(Kev wire): yes/no, 다지선다, 등급 평가 | [[03-AI-PIPELINE]] |
| 결정 모델 분포(옛 표현 Kev 분포) | 선택지에 대한 모델 확률 분포. **충족 확률·수주확률이 아니다.** UI에 항상 고지 | [[06-UI-UX]] |
| 규칙 엔진 | 필수 자격·점수·결정 정책을 계산하는 결정론적 코드. 최종 권고의 주체 | [[08-SCORING]] |
| 임베딩 / Qdrant | 근거 문단을 벡터로 저장·검색. 재생성 가능한 파생 인덱스 | [[02-ARCHITECTURE]] |
| `EvidenceRef` | 근거 인용 구조 `{kind, documentId, revisionId, page?, charStart?, charEnd?, apiField?, apiSource?, quotedText, sourceUrl?, fetchedAt}`. `kind=TEXT`는 본문·첨부 텍스트 인용, `kind=API_FIELD`는 공공 API 구조화 필드 값. 검증 실패 시 무효 | [[15-DATA-CONTRACTS]] |
| `fieldState` | 필드 상태 `KNOWN / UNKNOWN / NOT_APPLICABLE / CONFLICTED` | [[15-DATA-CONTRACTS]] |
| 프롬프트 인젝션 | 외부 문서 안의 지시문이 모델을 조종하려는 공격. 외부 문서는 데이터로만 취급 | [[09-SECURITY]] |
| HITL (Human-in-the-loop) | 사람이 반드시 개입하는 지점. 최종 결정, `NEEDS_REVIEW`, `MODEL_RULE_DISAGREEMENT` | [[09-SECURITY]] |
| `AI_PROVIDER` | `mock` / `local` / `hosted`. 데모 기본은 `mock` | [[03-AI-PIPELINE]], [[10-DEPLOYMENT]] |
| `KEV_ENABLED` | 결정 모델(Bosun) 사용 플래그(이름은 호환 유지, ADR-034). 세 실행 모드 모두 기본 `true`(`live`·`fixture` → 실모델, `mock` → mock adapter)이고 `false`도 허용한다. `false`면 결정 모델 없이 `RULES_ONLY`, 분석은 `COMPLETED`([[16-DECISIONS\|ADR-029]] A5) | [[03-AI-PIPELINE]] |

## 데이터·플랫폼

| 용어 | 정의 | 주 문서 |
|---|---|---|
| revision (`bid_revisions`) | 공고 내용의 버전. `sha256(canonical normalized payload)` 변화로 생성 | [[07-DATA-PIPELINE]] |
| 입력 스냅샷 (`input_snapshot`) | 점수 계산 시점의 입력 전체 복사본. 재현용 | [[04-DATABASE]] |
| 알고리즘 버전 (`algorithm_version`) | 점수 규칙 버전 식별자 (예: `sol-v0.1.0`) | [[08-SCORING]] |
| outbox 패턴 | 도메인 변경과 알림 이벤트를 같은 트랜잭션에 기록하고 worker(`web/worker`)가 전달 | [[13-NOTIFICATIONS]] |
| 나에게 보내기 | 카카오톡 메시지 API 가운데 사용자 본인의 "나와의 채팅"으로 보내는 기능(`talk_message` 동의 필요). 사업자·템플릿 검수 없이 쓸 수 있어 해커톤 카카오톡 실발송에 쓴다(`NOTIFY_KAKAO_PROVIDER=memo`, 기본 `mock`). 시연용이고 운영 경로는 알림톡이다([[16-DECISIONS]] ADR-038) | [[13-NOTIFICATIONS]] |
| 카카오톡 알림 연결 | 개인 설정에서 본인 카카오 계정에 "카카오톡 메시지 전송" 동의를 받아 토큰을 저장하는 것. Supabase 간편 로그인의 카카오 연결과 따로다. 화면 상태는 연결 전·연결됨(꺼짐)·켜짐·연결 만료 4가지이고, 토큰은 웹 서버가 암호화해 본인 행(`kakao_notify_links`)에 저장한다. 구현 중(`feat/kakao-notify`) | [[06-UI-UX]], [[13-NOTIFICATIONS]] |
| 멱등키 (idempotency key) | 같은 요청·이벤트를 두 번 처리하지 않게 하는 고유 키 | [[05-API-SPEC]], [[13-NOTIFICATIONS]] |
| 커서 페이지네이션 | `{items, pageInfo:{cursor,nextCursor,hasNext}}` 형식의 목록 응답 | [[05-API-SPEC]] |
| fixture | 외부 API 없이 쓰는 가상 공고 데이터 `FX-01`~`FX-20` | [[07-DATA-PIPELINE]] |
| `DEMO_MODE` / DEMO 데이터 | `SOL_RUN_MODE`에서 파생되는 호환용 값(`fixture`·`mock` → `true`, `live` → `false`). `true`면 외부 공공 API 없이 fixture로 수집한다. DEMO 데이터(`is_demo=true`)는 화면에 가상임을 표시 | [[07-DATA-PIPELINE]] |
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
| Supabase | DB(Postgres)와 인증(Auth)을 맡는 관리형 서비스. SOL RADAR는 이 둘만 쓴다. Storage·pgvector·Queues는 쓰지 않는다(첨부는 MinIO, 검색은 Qdrant, 큐는 Redis/BullMQ). 개발·데모 기본은 Supabase 클라우드 프로젝트. 웹 배포처는 미결정(데모 대체 경로는 [[19-DEMO-SCENARIO\|19]] §5) | [[02-ARCHITECTURE]], [[16-DECISIONS]] |
| Supabase Auth | 이메일 + 비밀번호·간편 로그인, 공개 가입(업무 조직 합류는 초대), 토큰 발급·갱신을 맡는 Supabase 인증 기능. 사용자 원본은 `auth.users`. 자체 로그인·토큰 엔드포인트는 두지 않는다. 토큰 만료·로그인 제한 같은 세부 값은 대시보드 설정이고 미검증 | [[09-SECURITY]] |
| 간편 로그인 | 구글·카카오·네이버 계정으로 가입·로그인하는 방식. Supabase Auth 제공자로 받는다(구글·카카오는 기본 제공자, 네이버는 사용자 정의 OIDC `custom:naver`). 버튼은 `NEXT_PUBLIC_AUTH_GOOGLE`·`KAKAO`·`NAVER`로 켜고, 제공자 설정은 해커톤 후순위다 | [[16-DECISIONS]] |
| Route Handler | Next.js App Router의 서버 HTTP 핸들러(`web/app/api/v1/**/route.ts`). 외부 API 계약 `/api/v1/...`과 헬스체크 `/health/live`·`/health/ready`를 낸다 | [[05-API-SPEC]] |
| 서버 도메인 (`web/server/<도메인>`) | 서버 전용 업무 코드. model·repo·service·index(배럴)로 나누고 `import "server-only"`로 시작한다. 다른 코드는 배럴(`@/server/<도메인>`)로만 부른다. 예: `bids`·`ingestion`·`scoring`·`analysis`·`review`·`notifications`·`company-profile`·`health` | [[02-ARCHITECTURE]] |
| zod 스키마 (계약 단일 원천) | `web/server/<도메인>/*.model.ts`의 zod 스키마. 화면 폼·Route Handler·worker가 같은 스키마로 입력을 검증한다. OpenAPI 문서는 필요하면 여기서 생성한다(선택) | [[05-API-SPEC]], [[16-DECISIONS]] |
| worker 진입점 (`web/worker`) | BullMQ 소비자를 띄우는 별도 Node(TypeScript) 프로세스. 지금 소비자는 system·ingest·analysis이고, documents 큐는 생산만 하며, `/extract`는 analysis job 안에서 부른다(설계의 documents·extract job 소비자는 미구현). `web/server` 도메인 코드를 같이 쓴다. `server-only` 모듈은 `node --conditions=react-server --import tsx worker/main.ts`로 불러온다(2026-10-18 검증, 16 미결정 9번) | [[02-ARCHITECTURE]], [[16-DECISIONS]] |
| AI gateway | Python FastAPI 서비스(`services/ai/`, :8000). Qwen·결정 모델(Bosun) 호출은 이것만 한다. Next 서버와 worker는 결정 모델에 직접 접근하지 않는다 | [[03-AI-PIPELINE]] |
| 마이그레이션 (`supabase/migrations/`) | 스키마·RLS 정책·DB 함수를 담는 SQL 파일. 새 파일로만 쌓는다(append-only). 클라우드 적용은 `pnpm db:push`(사용자 확인 뒤에만) | [[04-DATABASE]] |
| 생성 타입 (`web/lib/database.types.ts`) | 마이그레이션에서 만든 DB 타입(`pnpm db:types`). 손으로 고치지 않고 마이그레이션과 같은 커밋에 넣는다 | [[04-DATABASE]] |
| 정책 시험 (PGlite) | `scripts/database.test.mjs`를 `node --test` + PGlite로 돌려 RLS·권한·제약·seed 멱등을 본다(`pnpm test:db`) | [[11-TESTING]] |
| `pnpm demo:reset` | 데모 seed 스크립트. service role로 Supabase 프로젝트에 데모 데이터를 `is_demo=true`로 멱등 적재한다. 적재 내용(조직·계정·공고 fixture·명부 200·사진 검증·사전 리뷰)은 [[10-DEPLOYMENT]] seed 절 | [[10-DEPLOYMENT]], [[19-DEMO-SCENARIO]] |
| Compose 서비스 | `infra/compose.yaml`의 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(+ 선택 `web`. Compose에 정의 없음, [[10-DEPLOYMENT]] 표 참조). DB는 Supabase라 Compose에 없다. 실행 프로필은 env 묶음(`demo`·`ai-local`. `ai-hosted`는 미구현)이고 Compose `profiles`는 쓰지 않는다 | [[10-DEPLOYMENT]] |

## 권한·보안

| 용어 | 정의 | 주 문서 |
|---|---|---|
| ADMIN / SALES / ANALYST / VIEWER | SOL RADAR 업무 역할. `memberships.sol_role` 값이다. 리소스별 정책으로 적용되며 단순 상하 관계가 아니다 | [[09-SECURITY]] |
| `sol_role` | `memberships`의 업무 역할 열. text + check(`ADMIN`·`SALES`·`ANALYST`·`VIEWER`), 기본 `VIEWER`. API 권한 열(허용 역할 나열)이 이 값을 본다 | [[04-DATABASE]], [[05-API-SPEC]], [[09-SECURITY]] |
| `org_role` | `memberships`의 조직 역할(`owner`·`member`, 템플릿에서 가져옴). 템플릿 호환용으로 남고, 구성원 관리를 포함한 업무 권한은 `sol_role`이 정한다([[16-DECISIONS\|ADR-021]]). 데모 `admin@soltech.invalid`는 `owner` + `ADMIN` | [[04-DATABASE]], [[09-SECURITY]] |
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
| NestJS API·Worker | Route Handler(`web/app/api/v1`)·서버 도메인(`web/server`)·worker 진입점(`web/worker`). 해커톤 뒤 API·worker는 다시 NestJS로 옮긴다(ADR-028) | [[02-ARCHITECTURE]] |
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
| 해커톤 컷 | [[16-DECISIONS\|ADR-023]] 3단 범위: 핵심 컷(데모 필수) / 확장 컷 / P1(ADR-021 P1). 파인튜닝 트랙 X6은 핵심 컷과 나란히 돈다(ADR-034. ADR-027 폐기) | [[12-ROADMAP]] |
| `docs/evidence/` | 테스트 리포트·스크린샷·기동 로그를 두는 증거 폴더 | [[11-TESTING]], [[17-CLAUDE-IMPLEMENTATION]] |

## 솔리데오 인력·가입 용어 (ADR-019)

| 용어 | 뜻 | 원천 |
|---|---|---|
| 가상 직원 명부 | 솔리데오 부서에 배치한 인력 200명(남녀 100/100). 로그인 계정 명단과 별개 | [[07-DATA-PIPELINE]] |
| 직급/직책 | 엑셀에서 이름 오른쪽의 표현을 그대로 쓰는 단일 선택 항목. PM 등 직무·기술등급·업무 권한과 구분 | [[04-DATABASE]] |
| 가입 신고 정보 | 가입자가 선택한 부서·직급. 검증해 저장하지만 멤버십·권한·실제 재직 증명으로 사용하지 않음 | [[05-API-SPEC]] |
| 프로필 보완 | OAuth·기존 계정의 미완료 필수 가입 정보를 첫 업무 진입 전에 채우는 흐름 | [[06-UI-UX]] |
| personId | 가상 직원의 `SOL-P0001`~`SOL-P0200` 고정 ID. 이름·소속·사진을 연결 | [[07-DATA-PIPELINE]] |
| scoringEligible | 전체 200명 중 가상 점수 계산에 포함할 27명을 명시하는 값. 가입 권한·재직 여부와 무관. DB에서는 `team_member_scoring` 행이 있는지로 정하고, 가용 인력 입력은 재직자만이다([[16-DECISIONS\|ADR-021]] P1) | [[08-SCORING]] |

## 실데이터 파이프라인·모델 평가 용어 (ADR-020)

| 용어 | 뜻 | 원천 |
|---|---|---|
| 실행 모드 (`SOL_RUN_MODE`) | `live`(나라장터 Open API + 실제 AI), `fixture`(fixture 20건 + 실제 AI), `mock`(fixture 20건 + mock AI). 분석마다 `score_runs.run_mode`로 기록 | [[03-AI-PIPELINE]] |
| 정보화사업 (`infoBizYn`) | 입찰공고 응답의 정보화사업 여부. 빈값이 많아 수집 필터는 `infoBizYn='Y'` 또는 `sucsfbidMthdNm`에 "SW사업" 또는 `pubPrcrmntClsfcNm` 정보시스템·SW 분류인 용역 공고로 넓혔다([[16-DECISIONS\|ADR-029]] A4) | [[07-DATA-PIPELINE]] |
| API 구조화 필드 | 면허제한·참가가능지역·금액·마감처럼 공공 API가 필드로 주는 조건. 같은 조건이면 Qwen 추출보다 우선 | [[08-SCORING]] |
| `DocumentParser` | HWP·HWPX·PDF 형식별 파서 어댑터 인터페이스. 결과는 `PARSED`·`PARTIAL`·`UNSUPPORTED`·`FAILED`. 계약 정본은 03 §10 | [[03-AI-PIPELINE]] |
| 실패 유형 | 공공 API 실패·첨부 다운로드 불가·파싱 실패·모델 서버 미접속(Qwen·Bosun 따로). 서로 섞지 않고 따로 기록·표시 | [[03-AI-PIPELINE]] |
| `MOCK_FALLBACK` | `AI_FALLBACK_TO_MOCK=true`(live 금지)일 때 실제 모델 대신 mock 결과를 낸 run의 플래그. 화면에 "실제 모델 결과 아님" 배너. 해커톤 동안은 자동 대체를 구현하지 않아 `true`면 기동 거부다([[16-DECISIONS\|ADR-030]] B11) | [[03-AI-PIPELINE]] |
| 참고 지표 | 결정 모델 결과를 보여 주는 화면 영역. SOL Score·자격·권고에 반영하지 않는다 | [[08-SCORING]] |
| `kev-qs/v0.2` | 결정 모델 질문 세트 v0.2(이름은 호환 유지, 문구 불변). 요구사항별 `SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW`, `techFit`, `perfRelevance`, `risk.*`. v0.1과 함께 쓴다 | [[03-AI-PIPELINE]] |
| 사유 코드 | `NEEDS_REVIEW`의 이유. `NOTICE_INFO_MISSING`·`NOTICE_CONFLICTED`·`COMPANY_EVIDENCE_MISSING`·`AMBIGUOUS_MATCH`·`PARSE_UNSUPPORTED`·`STAGE_NOT_APPLICABLE` | [[08-SCORING]] |
| 명시적 부정 근거 | 회사가 조건을 충족하지 않는다는 기록(`NOT_HELD`, 요구치 미만 수치, 완결된 기술 목록에 없음). 미충족 판정에 필요 | [[08-SCORING]] |
| `CompanyEvidenceRef` | 회사 쪽 근거 위치(프로필 revision·기록 키·증빙 문서) | [[15-DATA-CONTRACTS]] |
| `KevStateTrace` | 결정 모델 state 줄마다 공고 인용·회사 증빙·요구사항 항목을 기록한 추적표 | [[15-DATA-CONTRACTS]] |
| 모델 레지스트리 | `services/ai/models/registry.yaml`. 모델 id·run·base·sha256·데이터셋 버전. gateway가 기동할 때 대조 | [[21-MODEL-TRAINING]] |
| 평가셋 | 실제 공고 × 가상 기업 원형 6개로 만든 라벨 데이터. test 20·dev 10 사업(해커톤) | [[21-MODEL-TRAINING]] |
| 사업 클러스터 | 같은 사업의 발주계획·사전규격·공고·재공고를 묶은 단위. 평가셋 분할 단위 | [[21-MODEL-TRAINING]] |
| 대조 변형 | 같은 공고에 대해 기업 기록만 바꿔 충족·미충족·정보 부족 사례를 만든 가상 기업 | [[21-MODEL-TRAINING]] |
| 라벨 출처 | `CONSTRUCTED`(변형으로 정해짐), `HUMAN`(사람 검수 확정), `RULE_SILVER`(규칙 계산, 학습셋 전용) | [[21-MODEL-TRAINING]] |
| 오류 원인 코드 | 오답의 원인 단계. `PARSE`·`EXTRACTION`·`TRANSLATION`·`STATE`·`RULE`·`LABEL`·`MODEL`. `MODEL`이 주된 원인일 때만 파인튜닝 검토 | [[21-MODEL-TRAINING]] |
| E0~E4 | 평가 비교 대상. E0 규칙만, E1 Kev-9B 영어(퇴역, 미측정), E1' 공개 Bosun 영어 state zero-shot, E2 Bosun 한국어 state(평가 전용), E3 Qwen3.5-27B logprob 분류(필수, 축소 규모), E4 Bosun + LoRA(해커톤 X6 비교 실험, ADR-034). 데모 장면 S0~S7과 다른 번호 | [[21-MODEL-TRAINING]] |
| EX0 | 회사 운영 Qwen3.5-27B API 추출 품질의 기준 측정(추출 지표·인용 충실도·`(untranslated)` 비율). EX1(파인튜닝 뒤 비교)은 삭제 — Qwen 파인튜닝은 하지 않는다(2026-10-20 사용자 결정, ADR-034) | [[21-MODEL-TRAINING]] |
| 파인튜닝 실행서 | 회사 GPU 서버에서 Bosun LoRA(X6)를 **어떻게** 돌리는지 적은 절차서. 모델·자료 출처와 가중치 sha256 확인, 학습 환경, F1~F3, 회사에 넘기는 학습 요청서를 담는다. Qwen 파인튜닝은 하지 않는다(2026-10-20 사용자 결정). 무엇을 왜 학습하는지는 [[21-MODEL-TRAINING\|21]] | [[22-FINETUNE-RUNBOOK]] |
| fixture 배치 `live` vs 실행 모드 `live` | fixture 두 번째 배치(`batch:"live"`, 데모 S5 변경분)와 실제 공공 API 실행 모드(`SOL_RUN_MODE=live`)는 다르다. 실행 모드 `live`에서 fixture 수집을 부르면 `409 RUN_MODE_MISMATCH` | [[19-DEMO-SCENARIO]] |
| P0-0 | 외부 의존성 조기 점검. 실제 API 응답·첨부 다운로드·회사 GPU 추론 엔드포인트 접속·파서 비교 | [[12-ROADMAP]] |

## 사이드바·업무 확장 용어 (ADR-021)

| 용어 | 뜻 | 원천 |
|---|---|---|
| 서비스 운영자 vs 조직 ADMIN | 서비스 운영자는 `profiles.is_admin`이고 운영자 화면만 쓴다(지금은 템플릿 `/admin`, 비운영자는 404. `/ops` 분리는 해커톤 뒤). 조직 ADMIN은 `memberships.sol_role=ADMIN`이고 그 조직의 `/admin/*`·설정 조직 탭을 쓴다. 서로의 화면에 들어가지 않는다 | [[09-SECURITY]] |
| 현재 조직 | 요청을 처리할 업무 조직. 서버가 세션 사용자의 업무 멤버십으로 정하고 요청의 조직 ID를 받지 않는다. 멤버십 2개 이상은 지원하지 않는다 | [[05-API-SPEC]] |
| 조직·인력 | 가상 직원 200명의 명부·개인 상세 화면 `/people`. 조직도는 별도 화면 `/org-chart`다(2026-10-18) | [[06-UI-UX]] |
| 조직도 | 가상 직원 200명을 부서 트리(본부 → 그룹 → 팀)와 고른 팀의 사진 카드로 보는 화면 `/org-chart`. 사이드바 맨 아래 고정 칸에서 연다. 원본에서 상위 부서가 확인되지 않은 부서는 "상위 미지정" 구역에 따로 보인다 | [[06-UI-UX]] |
| 맨 아래 고정 칸 | 사이드바 묶음 아래를 선으로 나눈 칸. 메뉴가 늘어도 자리가 바뀌지 않는다. 지금은 조직도 하나만 둔다 | [[06-UI-UX]] |
| 점수 계산 대상 인력 | 명부 200명 중 `team_member_scoring` 행이 있는 27명. SOL Score 인력 가용성과 인력 배치 시뮬레이션은 이 27명만 쓴다 | [[08-SCORING]] |
| 분석 현황 카드 | 대시보드 다섯 번째 카드. 공고별 최신 분석 1건 기준 완료·부분·실패 건수. 입찰 프로젝트(P1)가 들어오면 "진행 중 입찰 프로젝트"로 바뀐다 | [[06-UI-UX]] |
| 관심 공고 | 사용자가 본인용으로 표시한 공고(P1). 조직에는 공고별 관심 인원 수만 보인다 | [[05-API-SPEC]] |
| 입찰 프로젝트 | BID 결정 뒤 제안 준비·제출·결과 확인을 관리하는 단위(P1). 사람 결정의 정본은 여전히 `bid_reviews`다 | [[04-DATABASE]] |
| 체크리스트 | 입찰 프로젝트에 묶인 작업. 템플릿 `tasks`에 `bid_project_id`를 더해 쓴다(P1) | [[04-DATABASE]] |
| ADR-021 P1 | [[12-ROADMAP]] 해커톤 컷의 P1 단(ADR-023)에 둔 해커톤 기간 기능. [[01-PRD]]의 P1(해커톤 이후)과 다르다 | [[16-DECISIONS]] |

## 회사 GPU 추론 엔드포인트 용어 (ADR-025)

| 용어 | 뜻 | 원천 |
|---|---|---|
| 회사 GPU 추론 엔드포인트 | 회사가 HTTPS로 제공하는 모델 런타임 접속점 `https://acropolissg.com/sol-radar`. ai-gateway가 그 아래 `/kev`(결정 모델, GPU 서버 안 모델 라우터 `infra/gpu/model-router.conf`)에 Bearer 키로 붙는다. `/qwen`은 백업 경로이고 쓰지 않는다. Qwen은 이 엔드포인트가 아니라 회사가 운영하는 vLLM API `https://acropolissg.com/vllm/v1`(`QWEN_BASE_URL`)에 붙는다([[16-DECISIONS\|ADR-034]]). 연결 방식·운영 책임·미확인 항목은 ADR-025 상세 | [[16-DECISIONS\|ADR-025]], [[10-DEPLOYMENT]] |
| 엔드포인트 미접속 | `live`·`fixture`에서 gateway는 살아 있는데 회사 GPU 추론 엔드포인트에 닿지 않는 상태(옛 표현 "터널 단절"). `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록하고 `PARTIAL`·`RULES_ONLY`로 끝낸다. mock 결과로 몰래 바꾸지 않고, 필요하면 사람이 `mock` 모드로 전환 | [[19-DEMO-SCENARIO]], [[03-AI-PIPELINE]] |
| 엔드포인트 재접속 확인 | 미접속 뒤 `GET /v1/models`로 Qwen·Bosun 응답과 레지스트리 대조를 다시 확인하는 것(옛 표현 "터널 재연결"). 리허설에서 소요 시간을 `rehearsal-log.md`에 적는다 | [[11-TESTING]] |

## 관련 문서

- [[00-README|00 인덱스]]
- [[15-DATA-CONTRACTS|15 데이터 계약]]
- [[08-SCORING|08 SOL Score]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[18-HACKATHON|18 해커톤 전략]]
- [[16-DECISIONS|16 ADR]]
- [[09-SECURITY|09 보안]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]
