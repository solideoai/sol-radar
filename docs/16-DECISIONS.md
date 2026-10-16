---
title: "16. 아키텍처 결정 기록 (ADR)"
doc: "16"
status: draft
tags:
  - sol-radar
  - decision
updated: 2026-10-16
---

# 16. 아키텍처 결정 기록 (ADR)

상태 값: `제안` → `채택` → `검증됨`(근거 URL·날짜 필수). 외부 사실 확인 전이면 `미검증`, 철회는 `폐기`. 검증 결과는 날짜·근거 URL·결정자와 함께 이 문서에 갱신한다. 폐기한 결정도 행을 지우지 않고 상태만 바꿔 이력으로 남긴다.

## 결정 사항
|ID|결정|상태|날짜|근거|
|---|---|---|---|---|
|ADR-001|Next.js App Router(UI)와 NestJS(API·Worker) 역할 분리|폐기 (ADR-017로 대체)|2026-10-14|UI/도메인 로직 분리, OpenAPI 단일 원천 ([[02-ARCHITECTURE\|02 아키텍처]])|
|ADR-002|self-managed PostgreSQL + Prisma. Supabase 서비스 미사용|폐기 (ADR-017로 대체)|2026-10-14|테넌트 격리·감사 로그를 스키마로 통제, Compose 단일 배포|
|ADR-003|Docker Compose 배포. Kubernetes는 MVP 대상 아님|채택|2026-10-14|노트북 1대 데모와 GPU 호스트를 같은 Compose 프로필로 커버 ([[10-DEPLOYMENT\|10 배포]]). Supabase(DB·Auth)는 Compose 밖(클라우드 프로젝트)이고, Compose는 redis·minio·qdrant·ai-gateway·worker(+ 선택 web)를 띄운다(ADR-017, 2026-10-16)|
|ADR-004|Kev는 의사결정 보조, Qwen은 추출·설명, 점수는 규칙 엔진이 최종|채택|2026-10-14|설명 가능성·감사 가능성. Kev는 텍스트 생성 없이 확률만 반환하므로 보조 신호에 적합 ([[03-AI-PIPELINE\|03 AI 파이프라인]], [[08-SCORING\|08 스코어링]])|
|ADR-005|MinIO 사설 객체 저장소, Qdrant는 재생성 가능한 검색 보조|채택|2026-10-14|원본 보존과 파생 인덱스 분리|
|ADR-006|인앱 알림 P0, 카카오톡 P1 (승인 전 mock)|채택|2026-10-14|비즈메시지 계약·템플릿 승인 미확보 ([[13-NOTIFICATIONS\|13 알림]])|
|ADR-007|모바일(레이아웃·네이티브 앱)·결제/구독 기능을 구현하지 않는다(해커톤 이후 포함). 데스크톱 1280~1920 전용|채택|2026-10-16|사용자 제약(해커톤 이후도 제외, 2026-10-16 사용자 확인). 5분 데모는 데스크톱 1대. 범위를 줄여 자격·점수·결정 기록 완성도에 집중 ([[01-PRD\|01 PRD]])|
|ADR-008|데모 기본 실행은 `AI_PROVIDER=mock`. 실모델은 `ai-local` / `ai-hosted` 선택 프로필|채택|2026-10-16|데모 노트북에 GPU 없음. 모델 호출의 네트워크 의존 제거(DB·Auth는 Supabase 클라우드라 데모 중에도 인터넷이 필요하다, ADR-017). mock은 fixture 기반 결정적 응답으로 재현 가능 ([[10-DEPLOYMENT\|10 배포]], [[03-AI-PIPELINE\|03 AI 파이프라인]])|
|ADR-009|설계 문서는 Obsidian vault로 관리. YAML frontmatter, 위키링크, `## 관련 문서`, 콜아웃 규약|채택|2026-10-16|사람 심사위원 열람성·그래프 뷰. AI 심사가 주장→근거 위치를 따라갈 수 있다 ([[00-README\|00 인덱스]])|
|ADR-010|hosted 모델 API(공급자 미정) 호출은 사용자 명시 승인 후에만. 승인은 env `AI_HOSTED_APPROVED=true`로 표현. 기본 `false`|채택|2026-10-16|비용 발생. 승인 없는 과금 금지. `AI_PROVIDER=hosted`는 env로만 켜고 CI·테스트에서 금지 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §3, [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-011|요구조건 추출은 공고 **revision 단위**(조직 무관)로 1회 실행해 `requirement_extractions`에 저장·재사용. 자격 판정·점수·Kev는 **조직 × revision × 프로필 revision** 단위로 `score_runs`|채택|2026-10-16|추출은 공고 원문만 보므로 조직과 무관. 비용·지연 절감, 조직별 결과는 분리 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §2, [[04-DATABASE\|04 DB]] §3.3·§3.4)|
|ADR-012|Kev 입력은 어댑터가 만든 **영어 템플릿 state**만. 한국어 원문 전체를 Kev에 넣지 않는다. Kev는 `review_flags` 추가만 가능|채택 (효과 미검증)|2026-10-16|모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않는다고 명시 (2026-10-16, docs/model-cards/kev-4b.md). 변환 효과는 미검증이라 `KEV_ENABLED` 기본 `false` ([[03-AI-PIPELINE\|03 AI 파이프라인]] §5.6, [[09-SECURITY\|09 보안]])|
|ADR-013|골든 시나리오는 `G1`~`G10`, 데모 장면은 `S0`~`S7` 번호 규약. 테스트·fixture·데모 문서가 같은 ID로 서로 참조|채택|2026-10-16|a3 제안. 11·19·07 간 교차 참조를 ID로 고정해 심사 중 "어디서 검증했나"에 바로 답한다 ([[11-TESTING\|11 테스트]], [[19-DEMO-SCENARIO\|19 데모 시나리오]])|
|ADR-014|fixture 날짜는 상대 표기(예: `+21d`), seed 시 KST 18:00 기준 절대값으로 변환|채택|2026-10-16|a3 제안. 데모 날짜가 바뀌어도 마감 D-3·D-1 장면이 유지된다 ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|ADR-015|저장소 지침 우선순위: `docs/CLAUDE.md`와 설계 문서(00~20)가 출발 템플릿(agentic-boilerplate)의 `AGENTS.md`·`docs/boilerplate/`·`.claude/` 스킬보다 우선. 루트 `CLAUDE.md`가 `@docs/CLAUDE.md`를 먼저 불러온다|채택|2026-10-16|사용자 결정. 저장소가 Supabase·Expo 템플릿에서 시작했다. ADR-017 이후 템플릿의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>` 구조 규칙은 설계와 일치하므로 따른다. 여전히 따르지 않는 것: Expo(`mobile/`, 이미 삭제, ADR-007), Vercel·EAS 배포 전제(미결정, 아래 미결정 8번). 템플릿 견본 도메인 정리 범위는 Phase 0에서 정한다 ([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-016|웹 클라이언트 공유 상태는 zustand, 입력 검증 스키마는 zod(4.x). Next.js 앱 `web/`에 설치(zustand 5.0.15, zod 4.6.5). 외부 API 계약(`/api/v1` Route Handler)의 DTO도 같은 zod 스키마(`web/server/<도메인>/*.model.ts`)가 단일 원천이고, worker(`web/worker`)도 같은 스키마를 쓴다|채택|2026-10-16|사용자 결정. zod는 DTO 단일 원천([[05-API-SPEC\|05 API]] §7)과 같은 라이브러리라 화면·Route Handler·worker가 스키마 표현을 공유한다. zustand는 여러 클라이언트 컴포넌트가 함께 쓰는 UI 상태만 담고, 서버 데이터와 URL 쿼리 필터는 담지 않는다 ([[06-UI-UX\|06 UI]] §11)|
|ADR-017|아키텍처 전환: Next.js(`web/`, 화면·Route Handler·서버 도메인 `web/server/<도메인>`) + **Supabase(Postgres·RLS·Auth)**. NestJS·Prisma·자체 JWT 인증은 쓰지 않는다. Worker는 `web/worker` 진입점(같은 코드베이스의 별도 프로세스, BullMQ). MinIO·Qdrant·Redis/BullMQ·Python AI gateway·Docker Compose는 유지. 조직 데이터 열은 `org_id`, 업무 역할은 `memberships.sol_role`(ADMIN·SALES·ANALYST·VIEWER). service role 키는 worker·seed만. 개발 DB·Auth는 Supabase 클라우드 프로젝트(Pro)|채택|2026-10-16|사용자 결정(2026-10-16). 출발 템플릿(agentic-boilerplate)이 Next.js + Supabase(조직·역할·RLS·인증 견본, 정책 시험·타입 생성 게이트)라 그대로 쓰면 인증·격리를 새로 만들지 않는다. ADR-001·002를 대체한다([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-018|가입·로그인 방식: 공개 가입 + 초대. 누구나 이메일 + 비밀번호(`/auth/sign-up`) 또는 간편 로그인(구글·카카오·네이버)으로 계정을 만들고, 업무 조직 합류는 초대 수락으로 한다. 간편 로그인 제공자 설정은 해커톤 안에서 하되 다른 기능을 모두 끝낸 뒤 한다(후순위)|채택|2026-10-16|사용자 결정(2026-10-16). 랜딩의 시작하기가 이미 `/auth/sign-up`으로 가고, 버튼·콜백·계정 연결 코드가 템플릿에 있어 새로 만들 것이 없다. 미결정 13번을 닫는다 ([[09-SECURITY\|09 보안]], [[12-ROADMAP\|12 로드맵]])|
|ADR-019|회사 솔리데오 고정, 가상 직원 명부 200명(남녀 100/100)·고유 정장 사진 200장, 엑셀 팀명 합산·비례 배분·자연스러운 세 글자 가상 이름, 가입 부서·직급/직책 필수|채택 (설계 승인, 구현 전)|2026-10-16|사용자 인터뷰 및 저장 경로 최종 승인. 상세는 아래 ADR-019·[[07-DATA-PIPELINE\|07 데이터]]·[[06-UI-UX\|06 UI]]|

### ADR-007 ~ 014 구현 결과
- **ADR-007**: `web/`에 1280px 미만 breakpoint·결제 모듈·요금 화면 없음. UI 토큰·그리드는 1280~1920만 ([[06-UI-UX|06 UI]]). 17 절대 규칙으로 강제.
- **ADR-008**: `infra/env/demo.env.example` 기본값 `AI_PROVIDER=mock`, `KEV_ENABLED=false`, `DEMO_MODE=true`. mock adapter는 `services/ai/adapters/mock.py`, fixture ID별 고정 응답. 프로필 전환에 코드 변경 없음.
- **ADR-009**: 모든 md에 frontmatter. 파일 이름 변경 금지(링크가 파일명 기준). 00이 MOC. 저장소의 `docs/` 폴더가 이 vault.
- **ADR-010**: `AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`면 gateway가 기동을 거부한다(조용히 mock으로 바꾸지 않는다). Route Handler `GET /api/v1/admin/ai/status`는 `422 HOSTED_NOT_APPROVED`. 호출 시 provider·모델·토큰 수를 로그에 기록(키는 기록 금지). 승인 기록은 [[PROGRESS]] 작업 로그에 남긴다.
- **ADR-011**: ingest job(`web/worker`)이 `/extract`를 호출하고 `requirement_extractions`에 UNIQUE(`revision_id`, `model_name`, `prompt_hash`)로 저장. analysis job은 이것을 읽어 `/kev`와 규칙 엔진을 돈다 ([[02-ARCHITECTURE|02 아키텍처]] 흐름).
- **ADR-012**: state 템플릿은 `services/ai/adapters/kev.py`에만. 검증 절차(fixture 20건 영어 state 일치율, `permute` 순서 민감도)는 03 §5.9. 결과가 나오기 전까지 데모는 mock Kev.
- **ADR-013**: 11의 골든 시나리오 표, 07의 fixture 표, 19의 장면 표가 `G`·`S`·`FX` ID로 서로 가리킨다. 시험 이름(`describe`)에 ID를 넣는다(예: `describe("G3 필수 자격 미충족 → NO-BID")`). 시험 파일은 [[11-TESTING|11 테스트]] §3 표가 ID 행으로 가리킨다(예: G3 → `web/server/scoring/decision-policy.golden.test.ts`).
- **ADR-014**: `fixtures/*.json`의 날짜 필드는 `+Nd` 문자열. seed 스크립트(`pnpm demo:reset`)가 실행 시각의 KST 18:00을 기준으로 절대 ISO8601로 바꿔 적재한다. 테스트는 기준 시각을 고정해 결정적으로 돈다.

### ADR-017 구현 결과
- **코드 위치**: 화면·Route Handler·서버 도메인은 `web/` 하나에 둔다. 서버 도메인은 `web/server/<도메인>/`(model·repo·service·index 배럴, `import "server-only"`, 예: `bids`·`ingestion`·`scoring`·`analysis`·`review`·`notifications`·`company-profile`·`health`), 외부 계약은 `web/app/api/v1/**/route.ts`(경로 `/api/v1/...` 그대로), 헬스체크는 `web/app/health/{live,ready}/route.ts`. pnpm workspace·`apps/`·공유 계약 패키지는 만들지 않고, `web/`은 템플릿처럼 독립 설치한다(`pnpm -C web …`). 계약의 단일 원천은 zod 스키마(ADR-016)이고 OpenAPI 문서는 필요하면 zod에서 생성한다(선택).
- **DB**: Supabase Postgres + RLS. 스키마·RLS·함수는 `supabase/migrations/*.sql`에 새 파일로만 쌓는다(append-only). 타입은 생성물 `web/lib/database.types.ts`(`pnpm db:types`, 마이그레이션과 같은 커밋). 클라우드 적용은 `pnpm db:push`(운영 DB를 바꾸므로 사용자 확인 뒤에만), 정책 시험은 `pnpm test:db`(`scripts/database.test.mjs`, PGlite).
- **조직·권한**: 조직 소유 데이터의 열은 `org_id`이고 RLS `org_id in (select public.my_org_ids())`로 거른다. 템플릿 표 `profiles`(`auth.users`와 1:1, 서비스 운영자 `is_admin`, 계정 상태 `status`)·`organizations`·`memberships`·`invitations`·`activities`를 재사용한다. 템플릿 견본 `tasks`는 쓰지 않는다(정리는 새 마이그레이션으로, Phase 0·1에서 범위 결정). 업무 역할은 `memberships.sol_role`(text + check `ADMIN`·`SALES`·`ANALYST`·`VIEWER`, 기본 `VIEWER`)이고 [[05-API-SPEC|05 API]]의 권한 열이 이 값을 본다. `org_role`(owner·member)은 초대·구성원 관리 같은 조직 관리에만 쓴다. 운영자 `profiles.is_admin`도 남의 조직 데이터는 못 읽는다. 다른 조직 자원은 RLS로 행이 안 보여 `404`가 된다.
- **공용 데이터**: `bid_notices`·`bid_revisions`·`bid_documents`·`requirement_extractions` 등 조직 소유가 없는 표는 `authenticated`가 읽기만 하고, 쓰기는 worker(service role)만 한다.
- **Auth**: Supabase Auth(이메일 + 비밀번호와 간편 로그인 구글·카카오·네이버, 공개 가입 + 초대로 조직 합류, ADR-018). 가입·로그인·로그아웃·비밀번호 재설정·초대 수락은 템플릿 `/auth/*` 화면과 `web/server/auth`가 맡고, 자체 로그인·토큰 갱신·로그아웃 엔드포인트는 두지 않는다. 세션 쿠키는 `@supabase/ssr`가 관리한다(브라우저 클라이언트가 같은 쿠키를 읽어야 해서 HttpOnly가 아니다. SameSite=Lax, 운영에서 Secure). XSS 방어는 CSP nonce(`web/proxy.ts`·`web/server/csp`)가 맡는다. Route Handler는 세션 쿠키 또는 `Authorization: Bearer <Supabase access token>`을 받고, 쿠키 인증의 상태 변경 요청에는 `X-Requested-With: sol-radar`를 요구한다. 토큰 만료·refresh 재사용 탐지·로그인 제한·비밀번호 정책은 Supabase Auth 설정이다(아래 미결정 10번).
- **service role**: `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 무시하므로 worker와 seed 스크립트(서버 전용)만 쓴다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키)으로 DB를 부르고 RLS가 권한을 정한다. worker는 쓸 때 `org_id`를 직접 지정하고, 테넌트 혼입을 막는 시험을 둔다. 이 키는 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다.
- **Worker**: `web/worker/`가 BullMQ 소비자 진입점(ingest job·analysis job)이다. `web/server` 도메인 코드를 같이 쓰는 별도 Node(TypeScript) 프로세스이고, 도메인 모듈이 `import "server-only"`라 `node --conditions=react-server`(또는 같은 효과의 방식)로 띄워야 한다(미검증, 아래 미결정 9번). Kev·Qwen 호출은 여전히 AI gateway만 한다.
- **Compose**: `infra/compose.yaml`은 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(+ 선택 `web`)를 띄운다. `postgres`·`api` 서비스는 없다. 데모 seed는 Compose 서비스가 아니라 스크립트 `pnpm demo:reset`(service role로 Supabase 프로젝트에 적재, 멱등)이다. env에서 자체 JWT 서명 비밀·Postgres 비밀번호가 빠지고 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_DB_URL`이 들어온다([[10-DEPLOYMENT|10 배포]]).
- **유지(바꾸지 않음)**: MinIO(첨부 원본), Qdrant(임베딩 검색), Redis + BullMQ(작업 큐), Python AI gateway(FastAPI, `AI_PROVIDER=mock|local|hosted`), Docker Compose. Supabase Storage·pgvector·Supabase Queues는 쓰지 않는다.
- **시험**: 웹·서버 도메인·Route Handler·골든·worker는 Vitest, DB 정책은 `node --test` + PGlite(`pnpm test:db`), E2E는 Playwright(`web/e2e/`, 로그인 뒤 `web/e2e-auth/`), AI gateway는 pytest, 인프라는 `infra/smoke.sh`. G5(조직 격리)는 RLS 정책 시험 + Route Handler 시험 + E2E로 본다([[11-TESTING|11 테스트]]).
- **데모 네트워크**: 개발 DB·Auth가 Supabase 클라우드라 데모 중 인터넷이 필요하다. 대체 경로(로컬 Supabase CLI `pnpm db:start`, 사전 녹화 영상)는 아래 미결정 8번이다. AI 장애 대체 시연(`docker compose stop ai-gateway` → `PARTIAL`)은 그대로다.

### ADR-018 구현 결과
- **코드**: 템플릿 그대로다. 버튼은 `web/app/auth/social-sign-in.tsx`(로그인·가입 화면의 가는 선 아래), 켤 제공자 판단은 `web/lib/auth-providers.ts`, 콜백은 `web/app/auth/callback/route.ts`(받은 코드를 세션으로 바꾼다). 마이페이지의 로그인 수단 연결(템플릿 `/api/auth/*`)을 남길지는 Phase 0 템플릿 정리에서 정한다([[05-API-SPEC|05 API]]).
- **버튼 켜기**: `web/.env.local`의 `NEXT_PUBLIC_AUTH_GOOGLE`·`NEXT_PUBLIC_AUTH_KAKAO`·`NEXT_PUBLIC_AUTH_NAVER`가 `true`인 제공자만 보인다(빌드 때 코드에 박힌다). Supabase에 제공자를 설정하기 전에 켜면 누를 때 Supabase가 `provider is not enabled`를 보이고 사이트로 돌아오지 않는다. 데모·배포 환경에서는 설정을 마친 제공자만 켠다.
- **제공자 설정(후순위)**: 구글·카카오는 Supabase 기본 제공자, 네이버는 사용자 정의 OIDC 제공자 `custom:naver`다. Client ID·Secret은 Supabase 쪽(클라우드는 대시보드, 로컬은 `supabase/config.toml` + 깃 제외 `supabase/.env`)에만 두고 웹 env에는 넣지 않는다. 절차는 `docs/boilerplate/OAUTH-PROVIDERS.md`.
- **가입이 여는 범위**: 가입하면 계정과 `profiles` 행이 생긴다(템플릿 가입 트리거는 개인 조직도 만든다. 유지 여부는 미결정 11번). 업무 조직(예: 솔리데오) 데이터는 멤버십이 있어야 RLS(`my_org_ids()`)가 보여 주므로 가입만으로는 보이지 않는다. 공용 표(`bid_notices` 등)는 `authenticated` 읽기라 가입한 사용자도 읽는다.
- **데모**: 로그인은 seed 계정의 이메일 + 비밀번호다([[19-DEMO-SCENARIO|19 데모 시나리오]] S0). 간편 로그인은 데모 장면에 쓰지 않는다.

## 반드시 검증할 미결정 사항
|#|항목|상태|검증일|근거 / 다음 행동|
|---|---|---|---|---|
|1|data.go.kr 사용 API별 서비스키·트래픽·페이지네이션·실제 응답 스키마|미검증|-|서비스 이름 수준만 기록. 승인 후 테스트 응답 3건을 registry에 저장 ([[07-DATA-PIPELINE\|07 수집 파이프라인]], [[15-DATA-CONTRACTS\|15 데이터 계약]])|
|2|Kev v1.0 체크포인트 가용성·추론 API·라이선스·메모리·한국어 성능|부분 검증|2026-10-16|**검증됨** (https://github.com/jaredpalmer/kev README 및 docs/model-cards/kev-4b.md): 체크포인트 4종(0.8B/4B/9B/27B) 공개, Hub 태그 `v1.0`로 가중치 고정(`--run jaredpalmer/kev-4b@v1.0`, README 명시), GitHub 태그 `kev-1.0`, API `POST /v1/systemone`(noul/choice/score) + `GET /v1/models`, Apache-2.0, Python 3.12/3.13 + uv 소스 설치, `--device cpu\|cuda\|mps\|auto`. 모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않음. **미검증**: 한국어 → 영어 state 변환의 효과(ADR-012), VRAM 요구량, Kev-0.8B CPU 실행, 자체 보고 수치의 독립 재현. hosted 공급자 존재·포맷·가격은 전부 미확인. 다음: [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9 절차로 `ai-local`에서 fixture 20건 측정|
|3|Qwen 런타임(vLLM 등) 선택 및 GPU 메모리 분배|미검증|-|후보만 03에 기록. `ai-local` 프로필에서 측정|
|4|HWP/HWPX parser 라이브러리·라이선스·안전성|미검증|-|데모 fixture는 PDF/텍스트만. HWP는 `PENDING_REVIEW` 경로 유지|
|5|카카오 비즈메시지 발신 계약과 승인된 템플릿|미검증|-|해커톤 범위 밖. mock provider ([[13-NOTIFICATIONS\|13 알림]])|
|6|한국어 검색 품질(Qdrant 임베딩과 PostgreSQL full text 병행)|미검증|-|데모 필수 아님. 키워드 검색 fallback이 기본|
|7|초기 스코어 가중치와 결정 임계값(75/50), 조직별 판정 기준|미검증|-|[[08-SCORING\|08 스코어링]] worked example로 fixture 3건 일치 확인. 조직별 config versioning|
|8|데모·배포 실행 환경: Supabase 클라우드 그대로 / 로컬 Supabase CLI(`pnpm db:start`) 대체 / 웹 배포처|미결정|-|개발은 Supabase 클라우드 프로젝트(사용자 Pro 구독, ADR-017). 사용자 원문: "일단 개발은 Supabase에 하고 추후에 Supabase Pro 구독 중이라 바꿀 거야." 클라우드면 데모 중 인터넷이 필요하다. 네트워크 장애 대체(로컬 CLI, 사전 녹화 영상)와 웹 배포처(Vercel 전제 여부 포함)를 사용자가 정한다 ([[10-DEPLOYMENT\|10 배포]], [[19-DEMO-SCENARIO\|19 데모 시나리오]])|
|9|worker가 `server-only` 도메인 코드를 쓰는 실행 방식(`node --conditions=react-server` 또는 같은 효과의 방식)|미검증|-|`web/server` 모듈이 `import "server-only"`라 일반 Node 실행에서는 불러오지 못할 수 있다. Phase 0에서 `web/worker` 진입점으로 job 하나를 실제로 돌려 확인하고 결과를 여기에 적는다 ([[02-ARCHITECTURE\|02 아키텍처]], [[12-ROADMAP\|12 로드맵]])|
|10|Supabase Auth 세부 설정값(토큰 만료·refresh 재사용 탐지·로그인 시도 제한·비밀번호 정책)|미검증|-|Supabase 대시보드 설정으로 정하고 확인한다. 확인 전에는 값을 문서에 적지 않는다(지어내지 않는다) ([[09-SECURITY\|09 보안]])|
|11|현재 조직 고르기: 템플릿 가입 트리거는 계정마다 개인 조직을 만들고 화면은 `/[slug]/…`로 조직을 고른다. 05 `Me`·06 경로(`/dashboard`·`/bids`)는 업무 조직 하나와 slug 없는 경로를 전제한다|미결정|-|seed를 돌리면 개인 조직 5개가 더 생긴다([[04-DATABASE\|04 DB]] §6). Phase 1에서 개인 조직 생성 유지 여부와 경로 방식을 정한다 ([[05-API-SPEC\|05 API]] §1 콜아웃)|
|12|구성원 관리 권한 기준: 템플릿 RLS는 초대·역할 변경·내보내기를 `org_role=owner`만 허용, 05는 `sol_role=ADMIN`을 요구|미결정|-|데모 admin은 둘 다 가져 동작은 같다. Phase 1에서 하나로 맞출지(정책을 `sol_role` 기준으로 바꾸기 / API를 owner 기준으로) 정한다 ([[05-API-SPEC\|05 API]] §2 콜아웃)|
|13|가입 방식: 템플릿에는 공개 가입(`/auth/sign-up`)·간편 로그인이 있고, 설계 초안은 초대 기반이었다|채택 (ADR-018)|2026-10-16|사용자 결정: 공개 가입과 간편 로그인(구글·카카오·네이버)을 쓰고 업무 조직 합류는 초대로 한다. 공개 가입은 끄지 않는다. 남은 것: 개인 조직 생성 유지 여부(11번), 간편 로그인 제공자 설정(후순위, [[12-ROADMAP\|12 로드맵]]) ([[09-SECURITY\|09 보안]])|
|14|로그인·로그아웃 감사 기록 지점: 로그인은 브라우저가 Supabase Auth에 직접 한다|미결정|-|`audit_logs`의 `LOGIN`·`LOGOUT`을 남길 곳(Supabase Auth Hook 등)을 정하거나 기록 대상에서 뺀다 ([[04-DATABASE\|04 DB]] §3.6)|
|15|`pg_trgm` 확장을 Supabase와 PGlite 양쪽에서 켤 수 있는지|미검증|-|PGlite에서 안 되면 정책 시험·타입 생성 게이트가 깨진다. Phase 1 첫 마이그레이션 전에 확인 ([[04-DATABASE\|04 DB]] §5)|

검증 전에는 명세 가정으로 표시하고 기능 플래그·mock·fixture로 개발한다.

## ADR-019 상세 — 솔리데오 고정·가상 인력·가입 신고 정보

2026-10-16 인터뷰 후 사용자 최종 승인. 아래는 **설계 결정**이며 JSON·사진 생성·migration·가입 폼 구현은 아직 전이다. 승인 스펙은 [솔리데오 인력·가입](../polaris/specs/planned/2026-10-16-solideo-people-signup.md)이다.

- 사용자 회사명은 솔리데오로 고정하고 회사 선택을 만들지 않는다. `org-01`은 해당 업무 조직, `org-02`는 숨겨진 RLS 격리 시험용이다. 공개 가입 + 초대 합류(ADR-018), 조직 격리는 유지한다. 템플릿 개인 조직의 물리적 정리는 기존 미결정 11의 Phase 1 검토에 남긴다.
- 직원 명부는 가상 200명(남성 100·여성 100), Auth 5계정과 분리한다. 엑셀의 같은 팀명은 합산하고 원본 인원 비율에 따라 각 팀 최소 1명, 총 200명으로 배분한다.
- 한국 이름은 실제 사용되는 이름 통계를 참고한 한글 세 글자로, 내부 중복·원본 이름 일치는 0이다. 원본 엑셀은 저장소 밖이며 원본 실명·연락처·대응표는 저장하지 않는다.
- 부서·직급·인물·사진 manifest의 정본은 `fixtures/people/solideo.{departments,job-titles,people,portraits}.json`이다. 사진은 imagegen 기본 내장 도구로 서로 다른 가상 정장 얼굴 200장을 만들고 `web/public/demo/people/<personId>.png`에 둔다. 공개 사진은 가상 자산만이며 MinIO 사설 첨부 정책은 유지한다.
- 이메일 가입은 솔리데오 부서와 엑셀 표현 그대로인 `직급/직책`을 필수로 고른다. 간편 가입·기존 미완료 계정은 첫 로그인에 보완한다. 신고 정보는 `profiles`에 검증해 저장하고 부서·직급 선택으로 멤버십·권한을 만들지 않는다. 직무·기술등급·업무 권한과도 구분한다.
- 기존 점수·데모 수치의 정합성을 위해 전체 200명 안의 가상 계산 하위 27명·가용 20 FTE를 명시하고 골든 94/72/68을 유지한다. 회사명·부서/직급 외의 직원·자격·실적·재무는 실제 회사 정보로 소개하지 않는다.
- 검증은 [[11-TESTING]] PPL-01~07. 명부·이미지 생성/검수·가입 구현 완료 전에는 생성/구현된 것으로 보고하지 않는다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[01-PRD|01 PRD]]
- [[02-ARCHITECTURE|02 아키텍처]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[09-SECURITY|09 보안]]
- [[10-DEPLOYMENT|10 배포]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[PROGRESS]]
