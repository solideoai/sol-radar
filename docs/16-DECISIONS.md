---
title: "16. 아키텍처 결정 기록 (ADR)"
doc: "16"
status: draft
tags:
  - sol-radar
  - decision
updated: 2026-10-19
---

# 16. 아키텍처 결정 기록 (ADR)

상태 값: `제안` → `채택` → `검증됨`(근거 URL·날짜 필수). 외부 사실 확인 전이면 `미검증`, 철회는 `폐기`. 검증 결과는 날짜·근거 URL·결정자와 함께 이 문서에 갱신한다. 폐기한 결정도 행을 지우지 않고 상태만 바꿔 이력으로 남긴다.

## 결정 사항
|ID|결정|상태|날짜|근거|
|---|---|---|---|---|
|ADR-001|Next.js App Router(UI)와 NestJS(API·Worker) 역할 분리|폐기 (ADR-017로 대체)|2026-10-14|UI/도메인 로직 분리, OpenAPI 단일 원천 ([[02-ARCHITECTURE\|02 아키텍처]])|
|ADR-002|self-managed PostgreSQL + Prisma. Supabase 서비스 미사용|폐기 (ADR-017로 대체)|2026-10-14|테넌트 격리·감사 로그를 스키마로 통제, Compose 단일 배포|
|ADR-003|Docker Compose 배포. Kubernetes는 MVP 대상 아님|채택|2026-10-14|노트북 1대 데모와 GPU 호스트를 같은 Compose 프로필로 커버 ([[10-DEPLOYMENT\|10 배포]]). Supabase(DB·Auth)는 Compose 밖(클라우드 프로젝트)이고, Compose는 redis·minio·qdrant·ai-gateway·worker(+ 선택 web)를 띄운다(ADR-017, 2026-10-16)|
|ADR-004|Kev는 의사결정 보조, Qwen은 추출·설명, 점수는 규칙 엔진이 최종|채택 (ADR-020으로 개정)|2026-10-14|설명 가능성·감사 가능성. Kev는 텍스트 생성 없이 확률만 반환하므로 보조 신호에 적합 ([[03-AI-PIPELINE\|03 AI 파이프라인]], [[08-SCORING\|08 스코어링]]). 2026-10-16 ADR-020: Kev 결과를 "참고 지표"로 표시하는 것을 명시적으로 허용. 점수·자격·권고를 바꾸지 못하는 것은 그대로|
|ADR-005|MinIO 사설 객체 저장소, Qdrant는 재생성 가능한 검색 보조|채택|2026-10-14|원본 보존과 파생 인덱스 분리|
|ADR-006|인앱 알림 P0, 카카오톡 P1 (승인 전 mock)|채택|2026-10-14|비즈메시지 계약·템플릿 승인 미확보 ([[13-NOTIFICATIONS\|13 알림]])|
|ADR-007|모바일(레이아웃·네이티브 앱)·결제/구독 기능을 구현하지 않는다(해커톤 이후 포함). 데스크톱 1280~1920 전용|채택|2026-10-16|사용자 제약(해커톤 이후도 제외, 2026-10-16 사용자 확인). 5분 데모는 데스크톱 1대. 범위를 줄여 자격·점수·결정 기록 완성도에 집중 ([[01-PRD\|01 PRD]])|
|ADR-008|데모 기본 실행은 `AI_PROVIDER=mock`. 실모델은 `ai-local` / `ai-hosted` 선택 프로필|채택 (ADR-020으로 개정: 해커톤 MVP 목표는 `live`, `mock`은 CI·골든·장애 대체 모드로 유지)|2026-10-16|데모 노트북에 GPU 없음. 모델 호출의 네트워크 의존 제거(DB·Auth는 Supabase 클라우드라 데모 중에도 인터넷이 필요하다, ADR-017). mock은 fixture 기반 결정적 응답으로 재현 가능 ([[10-DEPLOYMENT\|10 배포]], [[03-AI-PIPELINE\|03 AI 파이프라인]])|
|ADR-009|설계 문서는 Obsidian vault로 관리. YAML frontmatter, 위키링크, `## 관련 문서`, 콜아웃 규약|채택|2026-10-16|사람 심사위원 열람성·그래프 뷰. AI 심사가 주장→근거 위치를 따라갈 수 있다 ([[00-README\|00 인덱스]])|
|ADR-010|hosted 모델 API(공급자 미정) 호출은 사용자 명시 승인 후에만. 승인은 env `AI_HOSTED_APPROVED=true`로 표현. 기본 `false`|채택|2026-10-16|비용 발생. 승인 없는 과금 금지. `AI_PROVIDER=hosted`는 env로만 켜고 CI·테스트에서 금지 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §3, [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-011|요구조건 추출은 공고 **revision 단위**(조직 무관)로 1회 실행해 `requirement_extractions`에 저장·재사용. 자격 판정·점수·Kev는 **조직 × revision × 프로필 revision** 단위로 `score_runs`|채택|2026-10-16|추출은 공고 원문만 보므로 조직과 무관. 비용·지연 절감, 조직별 결과는 분리 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §2, [[04-DATABASE\|04 DB]] §3.3·§3.4)|
|ADR-012|Kev 입력은 어댑터가 만든 **영어 템플릿 state**만. 한국어 원문 전체를 Kev에 넣지 않는다. Kev는 `review_flags` 추가만 가능|채택 (효과 미검증, ADR-020으로 개정: 운영은 영어 템플릿 유지, 같은 구조의 한국어 템플릿 state는 평가 전용 `KEV_ALLOW_KO_STATE=true`에서만. 참고 지표 표시 허용. 한국어 운영 사용은 평가 결과로 재검토)|2026-10-16|모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않는다고 명시 (2026-10-16, docs/model-cards/kev-4b.md). 변환 효과는 미검증이라 `KEV_ENABLED` 기본 `false` ([[03-AI-PIPELINE\|03 AI 파이프라인]] §5.6, [[09-SECURITY\|09 보안]])|
|ADR-013|골든 시나리오는 `G1`~`G10`, 데모 장면은 `S0`~`S7` 번호 규약. 테스트·fixture·데모 문서가 같은 ID로 서로 참조|채택|2026-10-16|a3 제안. 11·19·07 간 교차 참조를 ID로 고정해 심사 중 "어디서 검증했나"에 바로 답한다 ([[11-TESTING\|11 테스트]], [[19-DEMO-SCENARIO\|19 데모 시나리오]])|
|ADR-014|fixture 날짜는 상대 표기(예: `+21d`), seed 시 KST 18:00 기준 절대값으로 변환|채택|2026-10-16|a3 제안. 데모 날짜가 바뀌어도 마감 D-3·D-1 장면이 유지된다 ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|ADR-015|저장소 지침 우선순위: `docs/CLAUDE.md`와 설계 문서(00~20)가 출발 템플릿(agentic-boilerplate)의 `AGENTS.md`·`docs/boilerplate/`·`.claude/` 스킬보다 우선. 루트 `CLAUDE.md`가 `@docs/CLAUDE.md`를 먼저 불러온다|채택|2026-10-16|사용자 결정. 저장소가 Supabase·Expo 템플릿에서 시작했다. ADR-017 이후 템플릿의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>` 구조 규칙은 설계와 일치하므로 따른다. 여전히 따르지 않는 것: Expo(`mobile/`, 이미 삭제, ADR-007), Vercel·EAS 배포 전제(미결정, 아래 미결정 8번). 템플릿 견본 도메인 정리 범위는 Phase 0에서 정한다 ([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-016|웹 클라이언트 공유 상태는 zustand, 입력 검증 스키마는 zod(4.x). Next.js 앱 `web/`에 설치(zustand 5.0.15, zod 4.6.5). 외부 API 계약(`/api/v1` Route Handler)의 DTO도 같은 zod 스키마(`web/server/<도메인>/*.model.ts`)가 단일 원천이고, worker(`web/worker`)도 같은 스키마를 쓴다|채택|2026-10-16|사용자 결정. zod는 DTO 단일 원천([[05-API-SPEC\|05 API]] §7)과 같은 라이브러리라 화면·Route Handler·worker가 스키마 표현을 공유한다. zustand는 여러 클라이언트 컴포넌트가 함께 쓰는 UI 상태만 담고, 서버 데이터와 URL 쿼리 필터는 담지 않는다 ([[06-UI-UX\|06 UI]] §11)|
|ADR-017|아키텍처 전환: Next.js(`web/`, 화면·Route Handler·서버 도메인 `web/server/<도메인>`) + **Supabase(Postgres·RLS·Auth)**. NestJS·Prisma·자체 JWT 인증은 쓰지 않는다. Worker는 `web/worker` 진입점(같은 코드베이스의 별도 프로세스, BullMQ). MinIO·Qdrant·Redis/BullMQ·Python AI gateway·Docker Compose는 유지. 조직 데이터 열은 `org_id`, 업무 역할은 `memberships.sol_role`(ADMIN·SALES·ANALYST·VIEWER). service role 키는 worker·seed만. 개발 DB·Auth는 Supabase 클라우드 프로젝트(Pro)|채택|2026-10-16|사용자 결정(2026-10-16). 출발 템플릿(agentic-boilerplate)이 Next.js + Supabase(조직·역할·RLS·인증 견본, 정책 시험·타입 생성 게이트)라 그대로 쓰면 인증·격리를 새로 만들지 않는다. ADR-001·002를 대체한다([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-018|가입·로그인 방식: 공개 가입 + 초대. 누구나 이메일 + 비밀번호(`/auth/sign-up`) 또는 간편 로그인(구글·카카오·네이버)으로 계정을 만들고, 업무 조직 합류는 초대 수락으로 한다. 간편 로그인 제공자 설정은 해커톤 안에서 하되 다른 기능을 모두 끝낸 뒤 한다(후순위)|채택 (ADR-021로 개정: 가입 시 개인 조직 생성 중단, 이미 있는 개인 조직은 보존)|2026-10-16|사용자 결정(2026-10-16). 랜딩의 시작하기가 이미 `/auth/sign-up`으로 가고, 버튼·콜백·계정 연결 코드가 템플릿에 있어 새로 만들 것이 없다. 미결정 13번을 닫는다 ([[09-SECURITY\|09 보안]], [[12-ROADMAP\|12 로드맵]])|
|ADR-019|회사 솔리데오 고정, 가상 직원 명부 200명(남녀 100/100)·고유 정장 사진 200장, 엑셀 팀명 합산·비례 배분·자연스러운 세 글자 가상 이름, 가입 부서·직급/직책 필수|채택 (데이터·DB·가입 구현됨, 2026-10-17 main `42a4ead`. 화면 `/people`·`/org-chart`와 클라우드 DB 적용은 미완. ADR-021로 개정: 인력 표를 운영 `team_members`와 점수 `team_member_scoring`으로 분리, 사람이 고르는 규칙 매칭 후보 표시 허용)|2026-10-16|사용자 인터뷰 및 저장 경로 최종 승인. 상세는 아래 ADR-019·[[07-DATA-PIPELINE\|07 데이터]]·[[06-UI-UX\|06 UI]]·[[PROGRESS]]|
|ADR-020|실데이터 MVP와 AI 파이프라인 v0.2: 실행 모드 `live`·`fixture`·`mock`, 나라장터 Open API 실수집·첨부 파싱, Qwen3.5-9B·Kev-9B 실추론(회사 GPU 서버), Kev `kev-qs/v0.2` 참고 지표(SOL Score 미반영), 평가셋·평가 체계, Kev-9B LoRA 는 오류 분석 뒤 후속|채택 (설계 승인. 구현 일부 2026-10-18: 실행 모드 규칙 `infra/run-modes.json`·`pnpm check:env`(`15f5214`), 공고 fixture 20건·검증기(`caf0abd`). 수집·파싱·실추론·평가는 Phase 1~7. **ADR-023으로 해커톤 범위 재배치: live 실수집·실추론 1건·E3는 핵심 컷, P0-8·전체 평가셋·P0-11은 확장 컷. 설계는 불변**)|2026-10-16|사용자 결정(2026-10-16): "해커톤 시연용 가짜 AI가 아니라, 실제 공공입찰 데이터를 대상으로 끝까지 동작하는 SOL RADAR MVP". ADR-004·008·012를 개정한다. 상세는 아래 ADR-020·[[21-MODEL-TRAINING\|21 모델 학습]]·[[03-AI-PIPELINE\|03 AI 파이프라인]]·[[07-DATA-PIPELINE\|07 수집]]. 승인 설계: [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)|
|ADR-022|data.go.kr 서비스키를 서비스마다 따로 둔다: env 4개(`G2B_BID_NOTICE_SERVICE_KEY` 15129394·`G2B_PRE_SPEC_SERVICE_KEY` 15129437·`G2B_ORDER_PLAN_SERVICE_KEY` 15129462·`G2B_INDUSTRY_MASTER_SERVICE_KEY` 15129467). 소스 registry의 `serviceKeyEnv`가 소스별 env 이름을 가리킨다. 단일 `G2B_SERVICE_KEY`는 쓰지 않는다|채택 (구현 일부: `infra/run-modes.json`·`pnpm check:env`가 네 키 이름을 `live` 필수로 검사한다(`15f5214`). registry `serviceKeyEnv`와 `OfficialApiConnector`는 Phase 2)|2026-10-18|사용자 결정(2026-10-18): 서비스 4개에 키를 각각 받았고 API마다 키를 나눈다. 서비스별로 키를 바꾸거나 폐기할 수 있고, 호출 예산 카운터(`quota:{serviceId}:{YYYYMMDD}`)와 단위가 같다. ADR-020 승인 설계의 단일 키 표기를 대체한다. 상세는 아래 ADR-022·[[07-DATA-PIPELINE\|07 수집]] §2.2·[[15-DATA-CONTRACTS\|15 데이터 계약]] §8|
|ADR-021|사이드바 정보 구조와 입찰 업무 확장: 데모 필수 화면(앱 셸·설정·조직·인력 조회·데이터 수집 관리·대시보드 카드 5개)과 P1(관심 공고·분석 결과 비교·입찰 프로젝트·인력 배치 시뮬레이션·조직·인력 편집), 조직 주소 없는 경로, 서비스 운영자 `/ops` 분리|채택 (설계 승인. 구현 일부 2026-10-17 main `42a4ead`: 부서 계층 `parent_id`·`kind`, `team_member_scoring` 분리, 가입 시 개인 조직 생성 중단, 업무 멤버십 0/1/복수로 현재 조직 판단. 앱 셸 N1·설정 N2·`/people`·`/org-chart`·`/admin/ingestion`·대시보드 카드·`/ops` 분리·P1은 미구현. **ADR-023으로 해커톤 범위 재배치: 데모 필수 화면이 확장 컷으로 이동, 설계는 불변**)|2026-10-16|사용자 승인 4차(2026-10-16). ADR-018·019를 개정하고 미결정 11·12번을 닫는다. 상세는 아래 ADR-021·[사이드바 정보 구조 설계](plans/2026-10-16-sidebar-ia-design.md)|
|ADR-023|해커톤 데모 컷 재정의(3단): **핵심 컷**(S2·S3·S4·S-LIVE·S6·S7과 그에 필요한 Phase 0~6 기능) → **확장 컷**(S5 변경 감지, ADR-021 데모 필수 화면, P0-8, 전체 평가셋·P0-11) → **P1**(ADR-021 P1, 변경 없음). 실제 AI 추론 1건(S-LIVE) 필수, E3 대조 실험 필수(축소 규모), 10-21 외부 의존성 컷 규칙 4갈래, 네트워크 대체 경로 결정(미결정 8번 종결)|채택 (2026-10-19 사용자 승인, 구현 전)|2026-10-19|마감 2026-10-27, 공식 배점 실용성 30 + 완성도 25 = 55가 "실제 데이터로 돌아가고 흐름이 완결되는가". 2026-10-18 기준 "이 입찰에 들어가야 하는가" 코드가 0이라 Phase 0~7 전부를 데모 필수로 두면 완결이 불가능. ADR-020·021의 설계는 보존하고 우선순위·노출 범위만 바꾼다. 상세는 아래 ADR-023·[수상 전략·최소 데모 컷](plans/2026-10-18-hackathon-award-plan.md)|

### ADR-007 ~ 014 구현 결과
- **ADR-007**: `web/`에 1280px 미만 breakpoint·결제 모듈·요금 화면 없음. UI 토큰·그리드는 1280~1920만 ([[06-UI-UX|06 UI]]). 17 절대 규칙으로 강제.
- **ADR-008**: `infra/env/demo.env.example` 기본값 `SOL_RUN_MODE=mock`(→ `AI_PROVIDER=mock`, `KEV_ENABLED=true`로 mock adapter가 응답, `DEMO_MODE=true`, ADR-020). mock adapter는 `services/ai/adapters/mock.py`, fixture ID별 고정 응답. 프로필 전환에 코드 변경 없음.
- **ADR-009**: 모든 md에 frontmatter. 파일 이름 변경 금지(링크가 파일명 기준). 00이 MOC. 저장소의 `docs/` 폴더가 이 vault.
- **ADR-010**: `AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`면 gateway가 기동을 거부한다(조용히 mock으로 바꾸지 않는다). Route Handler `GET /api/v1/admin/ai/status`는 `422 HOSTED_NOT_APPROVED`. 호출 시 provider·모델·토큰 수를 로그에 기록(키는 기록 금지). 승인 기록은 [[PROGRESS]] 작업 로그에 남긴다.
- **ADR-011**: extract job(`web/worker`, ADR-020 이후 ingest → documents → extract 순서)이 `/extract`를 호출하고 `requirement_extractions`에 UNIQUE(`revision_id`, `model_name`, `prompt_hash`)로 저장. analysis job은 이것을 읽어 `/kev`와 규칙 엔진을 돈다 ([[02-ARCHITECTURE|02 아키텍처]] 흐름).
- **ADR-012**: state 빌더는 `services/ai/adapters/kev.py`, 템플릿은 `services/ai/kev/state-templates/{en,ko}.v0.2.txt`에만 둔다(ADR-020). 한국어/영어 비교는 평가셋 E1·E2([[21-MODEL-TRAINING|21 모델 학습]]), `permute` 순서 민감도는 03 §5.9. 발표의 고정 장면은 mock Kev, `live`·`fixture` 모드는 Kev-9B 실추론(참고 지표).
- **ADR-013**: 11의 골든 시나리오 표, 07의 fixture 표, 19의 장면 표가 `G`·`S`·`FX` ID로 서로 가리킨다. 시험 이름(`describe`)에 ID를 넣는다(예: `describe("G3 필수 자격 미충족 → NO-BID")`). 시험 파일은 [[11-TESTING|11 테스트]] §3 표가 ID 행으로 가리킨다(예: G3 → `web/server/scoring/decision-policy.golden.test.ts`).
- **ADR-014**: `fixtures/*.json`의 날짜 필드는 `+Nd` 문자열. seed 스크립트(`pnpm demo:reset`)가 실행 시각의 KST 18:00을 기준으로 절대 ISO8601로 바꿔 적재한다. 테스트는 기준 시각을 고정해 결정적으로 돈다.

### ADR-017 구현 결과
- **코드 위치**: 화면·Route Handler·서버 도메인은 `web/` 하나에 둔다. 서버 도메인은 `web/server/<도메인>/`(model·repo·service·index 배럴, `import "server-only"`, 예: `bids`·`ingestion`·`scoring`·`analysis`·`review`·`notifications`·`company-profile`·`health`), 외부 계약은 `web/app/api/v1/**/route.ts`(경로 `/api/v1/...` 그대로), 헬스체크는 `web/app/health/{live,ready}/route.ts`. pnpm workspace·`apps/`·공유 계약 패키지는 만들지 않고, `web/`은 템플릿처럼 독립 설치한다(`pnpm -C web …`). 계약의 단일 원천은 zod 스키마(ADR-016)이고 OpenAPI 문서는 필요하면 zod에서 생성한다(선택).
- **DB**: Supabase Postgres + RLS. 스키마·RLS·함수는 `supabase/migrations/*.sql`에 새 파일로만 쌓는다(append-only). 타입은 생성물 `web/lib/database.types.ts`(`pnpm db:types`, 마이그레이션과 같은 커밋). 클라우드 적용은 `pnpm db:push`(운영 DB를 바꾸므로 사용자 확인 뒤에만), 정책 시험은 `pnpm test:db`(`scripts/database.test.mjs`, PGlite).
- **조직·권한**: 조직 소유 데이터의 열은 `org_id`이고 RLS `org_id in (select public.my_org_ids())`로 거른다. 템플릿 표 `profiles`(`auth.users`와 1:1, 서비스 운영자 `is_admin`, 계정 상태 `status`)·`organizations`·`memberships`·`invitations`·`activities`를 재사용한다. 템플릿 견본 `tasks`는 쓰지 않는다(정리는 새 마이그레이션으로, Phase 0·1에서 범위 결정). ADR-021로 `tasks`는 지우지 않고 입찰 프로젝트 체크리스트로 재사용한다(P1). 업무 역할은 `memberships.sol_role`(text + check `ADMIN`·`SALES`·`ANALYST`·`VIEWER`, 기본 `VIEWER`)이고 [[05-API-SPEC|05 API]]의 권한 열이 이 값을 본다. `org_role`(owner·member)은 초대·구성원 관리 같은 조직 관리에만 쓴다. ADR-021로 구성원 관리도 `sol_role=ADMIN` 기준이 되고 `org_role`은 템플릿 호환용으로 남는다. 운영자 `profiles.is_admin`도 남의 조직 데이터는 못 읽는다. 다른 조직 자원은 RLS로 행이 안 보여 `404`가 된다.
- **공용 데이터**: `bid_notices`·`bid_revisions`·`bid_documents`·`requirement_extractions` 등 조직 소유가 없는 표는 `authenticated`가 읽기만 하고, 쓰기는 worker(service role)만 한다.
- **Auth**: Supabase Auth(이메일 + 비밀번호와 간편 로그인 구글·카카오·네이버, 공개 가입 + 초대로 조직 합류, ADR-018). 가입·로그인·로그아웃·비밀번호 재설정·초대 수락은 템플릿 `/auth/*` 화면과 `web/server/auth`가 맡고, 자체 로그인·토큰 갱신·로그아웃 엔드포인트는 두지 않는다. 세션 쿠키는 `@supabase/ssr`가 관리한다(브라우저 클라이언트가 같은 쿠키를 읽어야 해서 HttpOnly가 아니다. SameSite=Lax, 운영에서 Secure). XSS 방어는 CSP nonce(`web/proxy.ts`·`web/server/csp`)가 맡는다. Route Handler는 세션 쿠키 또는 `Authorization: Bearer <Supabase access token>`을 받고, 쿠키 인증의 상태 변경 요청에는 `X-Requested-With: sol-radar`를 요구한다. 토큰 만료·refresh 재사용 탐지·로그인 제한·비밀번호 정책은 Supabase Auth 설정이다(아래 미결정 10번).
- **service role**: `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 무시하므로 worker와 seed 스크립트(서버 전용)만 쓴다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키)으로 DB를 부르고 RLS가 권한을 정한다. worker는 쓸 때 `org_id`를 직접 지정하고, 테넌트 혼입을 막는 시험을 둔다. 이 키는 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다.
- **Worker**: `web/worker/`가 BullMQ 소비자 진입점(ingest job·analysis job)이다. `web/server` 도메인 코드를 같이 쓰는 별도 Node(TypeScript) 프로세스이고, 도메인 모듈이 `import "server-only"`라 `node --conditions=react-server --import tsx worker/main.ts`로 띄운다(검증됨 2026-10-18, 아래 미결정 9번). Kev·Qwen 호출은 여전히 AI gateway만 한다.
- **Compose**: `infra/compose.yaml`은 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(+ 선택 `web`)를 띄운다. `postgres`·`api` 서비스는 없다. 데모 seed는 Compose 서비스가 아니라 스크립트 `pnpm demo:reset`(service role로 Supabase 프로젝트에 적재, 멱등)이다. env에서 자체 JWT 서명 비밀·Postgres 비밀번호가 빠지고 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_DB_URL`이 들어온다([[10-DEPLOYMENT|10 배포]]).
- **유지(바꾸지 않음)**: MinIO(첨부 원본), Qdrant(임베딩 검색), Redis + BullMQ(작업 큐), Python AI gateway(FastAPI, `AI_PROVIDER=mock|local|hosted`), Docker Compose. Supabase Storage·pgvector·Supabase Queues는 쓰지 않는다.
- **시험**: 웹·서버 도메인·Route Handler·골든·worker는 Vitest, DB 정책은 `node --test` + PGlite(`pnpm test:db`), E2E는 Playwright(`web/e2e/`, 로그인 뒤 `web/e2e-auth/`), AI gateway는 pytest, 인프라는 `infra/smoke.sh`. G5(조직 격리)는 RLS 정책 시험 + Route Handler 시험 + E2E로 본다([[11-TESTING|11 테스트]]).
- **데모 네트워크**: 개발 DB·Auth가 Supabase 클라우드라 데모 중 인터넷이 필요하다. 대체 경로(로컬 Supabase CLI `pnpm db:start`, 사전 녹화 영상)는 아래 미결정 8번이다. AI 장애 대체 시연(`docker compose stop ai-gateway` → `PARTIAL`)은 그대로다.

### ADR-018 구현 결과
- **코드**: 템플릿 그대로다. 버튼은 `web/app/auth/social-sign-in.tsx`(로그인·가입 화면의 가는 선 아래), 켤 제공자 판단은 `web/lib/auth-providers.ts`, 콜백은 `web/app/auth/callback/route.ts`(받은 코드를 세션으로 바꾼다). 마이페이지의 로그인 수단 연결(템플릿 `/api/auth/*`)을 남길지는 Phase 0 템플릿 정리에서 정한다([[05-API-SPEC|05 API]]).
- **버튼 켜기**: `web/.env.local`의 `NEXT_PUBLIC_AUTH_GOOGLE`·`NEXT_PUBLIC_AUTH_KAKAO`·`NEXT_PUBLIC_AUTH_NAVER`가 `true`인 제공자만 보인다(빌드 때 코드에 박힌다). Supabase에 제공자를 설정하기 전에 켜면 누를 때 Supabase가 `provider is not enabled`를 보이고 사이트로 돌아오지 않는다. 데모·배포 환경에서는 설정을 마친 제공자만 켠다.
- **제공자 설정(후순위)**: 구글·카카오는 Supabase 기본 제공자, 네이버는 사용자 정의 OIDC 제공자 `custom:naver`다. Client ID·Secret은 Supabase 쪽(클라우드는 대시보드, 로컬은 `supabase/config.toml` + 깃 제외 `supabase/.env`)에만 두고 웹 env에는 넣지 않는다. 절차는 `docs/boilerplate/OAUTH-PROVIDERS.md`.
- **가입이 여는 범위**: 가입하면 계정과 `profiles` 행이 생긴다(템플릿 가입 트리거는 개인 조직도 만든다. 유지 여부는 미결정 11번. ADR-021로 새 마이그레이션에서 중단하고, 이미 있는 개인 조직은 지우지 않는다). 업무 조직(예: 솔리데오) 데이터는 멤버십이 있어야 RLS(`my_org_ids()`)가 보여 주므로 가입만으로는 보이지 않는다. 공용 표(`bid_notices` 등)는 `authenticated` 읽기라 가입한 사용자도 읽는다.
- **데모**: 로그인은 seed 계정의 이메일 + 비밀번호다([[19-DEMO-SCENARIO|19 데모 시나리오]] S0). 간편 로그인은 데모 장면에 쓰지 않는다.

## 반드시 검증할 미결정 사항
|#|항목|상태|검증일|근거 / 다음 행동|
|---|---|---|---|---|
|1|data.go.kr 사용 API별 서비스키·트래픽·페이지네이션·실제 응답 스키마|부분 검증|2026-10-16|**검증됨**(data.go.kr 서비스 페이지 Swagger·참고문서): 입찰공고정보서비스 15129394(`/1230000/ad/BidPublicInfoService`), 사전규격 15129437, 발주계획 15129462, 업종 및 근거법규 15129467의 오퍼레이션·요청 파라미터·응답 필드 이름, 무료·자동승인, 개발계정 1,000(사용자정보·개방표준 10,000), JSON/XML, 이용허락범위 제한 없음. **미검증**: 서비스키로 받은 실제 응답, 조회 기간 상한, `infoBizYn` 요청 필터 가능 여부, 면허제한 여러 행의 의미. **2026-10-18**: 사용자가 4개 서비스의 서비스키를 받았다(값은 저장소 밖). 서비스별 env로 나눈다(ADR-022). 다음: ADR-020 P0-0에서 오퍼레이션별 실제 응답 3건 저장 ([[07-DATA-PIPELINE\|07 수집 파이프라인]], [[15-DATA-CONTRACTS\|15 데이터 계약]])|
|2|Kev v1.0 체크포인트 가용성·추론 API·라이선스·메모리·한국어 성능|부분 검증|2026-10-16|**검증됨** (https://github.com/jaredpalmer/kev README 및 docs/model-cards/kev-4b.md): 체크포인트 4종(0.8B/4B/9B/27B) 공개, Hub 태그 `v1.0`로 가중치 고정(`--run jaredpalmer/kev-4b@v1.0`, README 명시), GitHub 태그 `kev-1.0`, API `POST /v1/systemone`(noul/choice/score) + `GET /v1/models`, Apache-2.0, Python 3.12/3.13 + uv 소스 설치, `--device cpu\|cuda\|mps\|auto`. 모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않음. **미검증**: 한국어 → 영어 state 변환의 효과(ADR-012), VRAM 요구량, Kev-0.8B CPU 실행, 자체 보고 수치의 독립 재현. hosted 공급자 존재·포맷·가격은 전부 미확인. 다음: [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9 절차로 `ai-local`에서 fixture 20건 측정. **2026-10-16 추가 검증**(main `1f04cfa`): `kev.train`(LoRA·full FT, QLoRA 없음, `--init_from`), `kev.benchmark`, `kev.compare`, Kev-9B@v1.0 = `db029f08`, 9B 추론 메모리는 모델 카드 21.9 GB·README 약 17 GB로 불일치. ADR-020으로 기본 모델을 Kev-9B로 바꾸고 한국어 성능은 평가셋 E2로 측정 ([[21-MODEL-TRAINING\|21 모델 학습]])|
|3|Qwen 런타임(vLLM 등) 선택 및 GPU 메모리 분배|부분 결정|2026-10-16|ADR-020: 해커톤 실추론은 회사 GPU 서버, Qwen 런타임은 vLLM(guided JSON·logprob). **미결정**: GPU 모델·VRAM 확인 후 메모리 배분(48 GB 이상 1장이면 동시 적재, 24 GB 2장이면 모델당 1장, 24 GB 1장이면 Qwen FP8/AWQ). P0-0에서 확인 ([[10-DEPLOYMENT\|10 배포]])|
|4|HWP/HWPX parser 라이브러리·라이선스·안전성|진행 (ADR-020)|2026-10-16|형식별 `DocumentParser` 인터페이스(HWP·HWPX·PDF)를 두고, 오픈소스 후보의 라이선스와 추출 품질(본문·표·금액·자격 조건·요구사항 누락)을 실제 RFP 샘플로 비교한 뒤 형식마다 정한다. 후보·절차는 [[03-AI-PIPELINE\|03 AI 파이프라인]] §10(요약은 [[07-DATA-PIPELINE\|07 수집]] §2.5). 결정 전까지 처리할 수 없는 첨부는 `PARSE_UNSUPPORTED` → 확인 필요|
|5|카카오 비즈메시지 발신 계약과 승인된 템플릿|미검증|-|해커톤 범위 밖. mock provider ([[13-NOTIFICATIONS\|13 알림]])|
|6|한국어 검색 품질(Qdrant 임베딩과 PostgreSQL full text 병행)|미검증|-|데모 필수 아님. 키워드 검색 fallback이 기본|
|7|초기 스코어 가중치와 결정 임계값(75/50), 조직별 판정 기준|미검증|-|[[08-SCORING\|08 스코어링]] worked example로 fixture 3건 일치 확인. 조직별 config versioning|
|8|데모·배포 실행 환경: Supabase 클라우드 그대로 / 로컬 Supabase CLI(`pnpm db:start`) 대체 / 웹 배포처|결정 (ADR-023, 데모 부분)|2026-10-19|데모 기본은 Supabase 클라우드 + 정상 네트워크. 대체 경로 6종을 [[19-DEMO-SCENARIO\|19 데모 시나리오]] §5에 고정: 인터넷 실패 → 로컬 Supabase CLI(`pnpm db:start` + `pnpm demo:reset`, D-1 리허설), 공공 API 장애 → `fixture`, GPU 접속 실패 → `mock` 또는 사전 실행 run 조회, Supabase 클라우드 장애 → 로컬 CLI, 첨부 실패 → `DOCUMENT_DOWNLOAD_FAILED` 화면 그대로, 추론 시간 초과 → `PARTIAL`. 자동 fallback 없음, 화면에 모드·출처 표시, 발표에서 밝힌다. 웹 배포처는 여전히 미결정(해커톤은 노트북 1대) ([[10-DEPLOYMENT\|10 배포]])|
|9|worker가 `server-only` 도메인 코드를 쓰는 실행 방식(`node --conditions=react-server` 또는 같은 효과의 방식)|검증됨|2026-10-18|`node --conditions=react-server --import tsx worker/main.ts --check`가 `worker modules loaded`로 끝나고, `--conditions` 없이는 `server-only`가 "This module cannot be imported from a Client Component module" 오류로 멈춘다. 증거 `docs/evidence/phase-0/worker-conditions.txt`, 커밋 `fa92254`. `web/worker/main.ts`가 BullMQ `system` 큐의 `ping` job을 처리한다. Compose worker entrypoint도 같은 명령 ([[02-ARCHITECTURE\|02 아키텍처]], [[10-DEPLOYMENT\|10 배포]])|
|10|Supabase Auth 세부 설정값(토큰 만료·refresh 재사용 탐지·로그인 시도 제한·비밀번호 정책)|미검증|-|Supabase 대시보드 설정으로 정하고 확인한다. 확인 전에는 값을 문서에 적지 않는다(지어내지 않는다) ([[09-SECURITY\|09 보안]])|
|11|현재 조직 고르기: 템플릿 가입 트리거는 계정마다 개인 조직을 만들고 화면은 `/[slug]/…`로 조직을 고른다. 05 `Me`·06 경로(`/dashboard`·`/bids`)는 업무 조직 하나와 slug 없는 경로를 전제한다|결정 (ADR-021)|2026-10-16|조직 주소 없는 경로. 서버가 현재 조직을 정한다(업무 멤버십 0개 안내 / 1개 진입 / 2개 이상 지원 안 함). 조직 전환 UI 없음. 가입 시 개인 조직 생성 중단, 기존 개인 조직은 보존 ([[05-API-SPEC\|05 API]] §1)|
|12|구성원 관리 권한 기준: 템플릿 RLS는 초대·역할 변경·내보내기를 `org_role=owner`만 허용, 05는 `sol_role=ADMIN`을 요구|결정 (ADR-021)|2026-10-16|구성원 관리는 `sol_role=ADMIN`. 템플릿 owner 기준 정책을 새 마이그레이션으로 바꾼다 ([[05-API-SPEC\|05 API]] §2)|
|13|가입 방식: 템플릿에는 공개 가입(`/auth/sign-up`)·간편 로그인이 있고, 설계 초안은 초대 기반이었다|채택 (ADR-018)|2026-10-16|사용자 결정: 공개 가입과 간편 로그인(구글·카카오·네이버)을 쓰고 업무 조직 합류는 초대로 한다. 공개 가입은 끄지 않는다. 개인 조직 생성은 ADR-021로 중단(11번). 남은 것: 간편 로그인 제공자 설정(후순위, [[12-ROADMAP\|12 로드맵]]) ([[09-SECURITY\|09 보안]])|
|14|로그인·로그아웃 감사 기록 지점: 로그인은 브라우저가 Supabase Auth에 직접 한다|미결정|-|`audit_logs`의 `LOGIN`·`LOGOUT`을 남길 곳(Supabase Auth Hook 등)을 정하거나 기록 대상에서 뺀다 ([[04-DATABASE\|04 DB]] §3.6)|
|15|`pg_trgm` 확장을 Supabase와 PGlite 양쪽에서 켤 수 있는지|미검증|-|PGlite에서 안 되면 정책 시험·타입 생성 게이트가 깨진다. Phase 1 첫 마이그레이션 전에 확인 ([[04-DATABASE\|04 DB]] §5)|
|16|g2b 첨부 자동 다운로드 가능 여부(로그인·세션 요구, 이용약관상 제한)|미검증|-|ADR-020 P0-0에서 공고 3건의 첨부를 실제로 받아 본다. 막히면 본문·API 필드만으로 진행하고 `DOCUMENT_DOWNLOAD_FAILED`를 표시하며 사용자에게 보고(RFP 파싱은 MVP 핵심) ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|17|회사 GPU 서버 접속(터널 허용 여부)·GPU 모델·VRAM·공유 여부|미검증|-|ADR-020 P0-0에서 확인. 모델 런타임은 GPU 서버 `127.0.0.1` 바인딩 + 터널. 막히면 사용자 보고 ([[10-DEPLOYMENT\|10 배포]])|
|18|공고 첨부 원문(공고문·제안요청서)의 저작권·재배포·학습 사용 권리|미검증|-|내부 분석·사내 학습에만 사용. 외부 공개·데이터셋 배포 전 법무 확인 ([[21-MODEL-TRAINING\|21 모델 학습]], [[09-SECURITY\|09 보안]])|
|19|면허제한 오퍼레이션의 여러 행이 AND인지 OR인지|미검증|-|실제 응답 확인 전에는 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`) ([[08-SCORING\|08 점수]])|
|20|문서 파서 형식별 선택(HWP·HWPX·PDF)|미결정|-|미결정 4번과 같은 절차. 실제 RFP 샘플 비교 결과로 형식마다 정하고 이 행을 갱신 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §10)|

검증 전에는 명세 가정으로 표시하고 기능 플래그·mock·fixture로 개발한다.

## ADR-019 상세 — 솔리데오 고정·가상 인력·가입 신고 정보

2026-10-16 인터뷰 후 사용자 최종 승인. 아래는 **설계 결정**이다. 구현 상태(2026-10-17, main `42a4ead`): JSON 4개·사진 200장·마이그레이션 4개(`20261016000001`~`04`)·가입 폼·`/auth/complete-profile`·`pnpm people:seed`는 구현됐고, `/people`·`/org-chart` 화면과 클라우드 DB 적용은 아직이다([[PROGRESS]]). 승인 스펙은 [솔리데오 인력·가입](../polaris/specs/planned/2026-10-16-solideo-people-signup.md)이다.

- 사용자 회사명은 솔리데오로 고정하고 회사 선택을 만들지 않는다. `org-01`은 해당 업무 조직, `org-02`는 숨겨진 RLS 격리 시험용이다. 공개 가입 + 초대 합류(ADR-018), 조직 격리는 유지한다. 템플릿 개인 조직의 물리적 정리는 기존 미결정 11의 Phase 1 검토에 남긴다. ADR-021로 가입 시 개인 조직 생성은 중단하고, 이미 있는 개인 조직은 지우지 않는다.
- 직원 명부는 가상 200명(남성 100·여성 100), Auth 5계정과 분리한다. 엑셀의 같은 팀명은 합산하고 원본 인원 비율에 따라 각 팀 최소 1명, 총 200명으로 배분한다.
- 한국 이름은 실제 사용되는 이름 통계를 참고한 한글 세 글자로, 내부 중복·원본 이름 일치는 0이다. 원본 엑셀은 저장소 밖이며 원본 실명·연락처·대응표는 저장하지 않는다.
- 부서·직급·인물·사진 manifest의 정본은 `fixtures/people/solideo.{departments,job-titles,people,portraits}.json`이다. 사진은 imagegen 기본 내장 도구로 서로 다른 가상 정장 얼굴 200장을 만들고 `web/public/demo/people/<personId>.png`에 둔다. 공개 사진은 가상 자산만이며 MinIO 사설 첨부 정책은 유지한다.
- 이메일 가입은 솔리데오 부서와 엑셀 표현 그대로인 `직급/직책`을 필수로 고른다. 간편 가입·기존 미완료 계정은 첫 로그인에 보완한다. 신고 정보는 `profiles`에 검증해 저장하고 부서·직급 선택으로 멤버십·권한을 만들지 않는다. 직무·기술등급·업무 권한과도 구분한다.
- 기존 점수·데모 수치의 정합성을 위해 전체 200명 안의 가상 계산 하위 27명·가용 20 FTE를 명시하고 골든 94/72/68을 유지한다. 회사명·부서/직급 외의 직원·자격·실적·재무는 실제 회사 정보로 소개하지 않는다.
- 검증은 [[11-TESTING]] PPL-01~07. PPL-01~06은 통과 기록이 있고([[11-TESTING]] §8·§9.1·§10), PPL-07의 전체 점수 파이프라인 골든은 Phase 4에 남아 있다.

## ADR-020 상세 — 실데이터 MVP와 AI 파이프라인 v0.2

2026-10-16 사용자 대화로 정했고 승인 설계는 [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)다. 아래는 **설계 결정**이며 구현은 아직 전이다.

- **실행 모드**: `SOL_RUN_MODE=live|fixture|mock`(기본 `mock`). `live` = 나라장터 Open API + 실제 AI, `fixture` = fixture 20건 + 실제 AI, `mock` = fixture 20건 + mock AI. 모드와 모순된 env는 기동 거부. 데이터 출처(`source`·`is_demo`)와 분석 모드(`score_runs.run_mode`·`ai_provider`·모델 이름)를 기록하고 화면에 표시한다. 골든은 `mock` 모드에서만 단언한다 ([[03-AI-PIPELINE|03]], [[10-DEPLOYMENT|10]]).
- **회사 프로필**: 모든 모드에서 가상 솔리데오 프로필(`is_demo=true`)이다. live 분석은 "실제 공고 × 가상 회사 프로필"이고 화면에 배지를 붙인다(ADR-019, [[09-SECURITY|09 보안]]).
- **수집**: 입찰공고정보서비스(용역, `infoBizYn=Y` 정보화사업)·면허제한·참가가능지역·e발주 첨부, 사전규격, 발주계획, 업종 코드 마스터. 첨부는 `www.g2b.go.kr` allowlist로 내려받고, 형식별 `DocumentParser`로 파싱한다. 같은 조건이면 API 구조화 필드가 Qwen 추출보다 우선이고, 다르면 `CONFLICTED`다 ([[07-DATA-PIPELINE|07]], [[15-DATA-CONTRACTS|15]]).
- **실패 유형**: 공공 API 실패·첨부 다운로드 불가·파싱 실패·모델 서버 미접속(Qwen·Kev 따로)을 구분해 기록·표시한다. 실패한 단계의 내용을 AI가 추측해 채우지 않는다. mock 자동 대체는 기본 금지이고, `AI_FALLBACK_TO_MOCK=true`(live 금지)로 켰을 때만 `MOCK_FALLBACK`과 배너로 명시한다.
- **모델 역할**: Qwen3.5-9B = 구조화 추출·영어 표기·근거 설명(`/explain`). Kev-9B@v1.0 = 요구사항별 충족/미충족/확인 필요, 기술 적합성, 실적 연관성, 수행 리스크(`kev-qs/v0.2`, v0.1 유지). 규칙 엔진 = 명시 조건. SOL Score = `sol-v0.1.0` 그대로. **Kev 확률은 점수 입력이 아니며** 참고 지표와 `reviewFlags`로만 표시한다. 점수 반영은 평가셋 검증 뒤 `sol-v0.2.x`와 새 ADR로 정한다 ([[08-SCORING|08]]).
- **근거 추적**: 공고 쪽 `EvidenceRef`에 회사 쪽 `CompanyEvidenceRef`를 더하고, Kev state 줄마다 출처를 기록하는 `KevStateTrace`를 저장한다 ([[15-DATA-CONTRACTS|15]]).
- **라벨**: `SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW` + 사유 코드. 미충족에는 공고·회사 양쪽 근거가 필요하고, 정보 부족은 미충족이 아니다 ([[08-SCORING|08]]).
- **실추론 위치**: 회사 GPU 서버(vLLM + `kev.serve`, `127.0.0.1` 바인딩)에 노트북 gateway가 터널로 연결한다. 클라우드 GPU 임대는 ADR-010과 같은 비용 승인 대상이다 ([[10-DEPLOYMENT|10]]).
- **평가·파인튜닝**: 평가셋은 실제 공고 × 가상 기업 원형 6개, test 20·dev 10 사업, 사업 단위 분할. 지표·오류 분석·내보내기·LoRA 메모리 검증은 [[21-MODEL-TRAINING|21 모델 학습]]. 초기 목표(Macro-F1 0.80, 정보부족→미충족 혼동률 5%, 보정 후 ECE 0.08)에 미달해도 자동으로 파인튜닝하지 않는다. 오류 분석에서 모델 판단 오류가 주된 원인일 때 사람이 결정한다. Kev-9B LoRA는 해커톤 완료 조건이 아니다. 실제 낙찰 결과는 학습 목표로 쓰지 않는다.
- **모델 버전**: `services/ai/models/registry.yaml` + sha256 + 기동 시 `/v1/models` 대조. 불일치면 gateway 기동 거부(`kev.serve`가 경로 오류를 `runs/smoke`로 조용히 대체하기 때문).
- **해커톤 순서**: P0-0 외부 의존성 조기 점검(실제 API 응답·첨부 다운로드·GPU 터널·파서 비교) → P0-1~P0-11을 Phase 0~7에 배치([[12-ROADMAP|12 로드맵]]). 서비스키·GPU가 준비되기 전에는 인터페이스(`BidSourceConnector`·`AttachmentFetcher`·`DocumentParser`·`ModelClient`)로 나머지를 진행한다.
- 개정한 결정: ADR-004(참고 지표 표시 허용), ADR-008(해커톤 목표는 `live`), ADR-012(한국어 state는 평가 전용). 영향 받은 미결정: 1·3·4번 갱신, 16~20번 추가.

## ADR-021 상세 — 사이드바 정보 구조와 입찰 업무 확장

2026-10-16 사용자가 네 차례에 걸쳐 승인했고 승인 설계는 [사이드바 정보 구조와 입찰 업무 확장](plans/2026-10-16-sidebar-ia-design.md)이다. 입력은 사용자 계획서 [[SIDEBAR-PLAN]]이다. 아래는 **설계 결정**이며 구현은 아직 전이다.

- **사이드바**: 업무(대시보드·입찰 공고·관심 공고·알림) / AI 분석(분석 결과 비교·인력 배치 시뮬레이션) / 입찰 관리(입찰 프로젝트) / 조직(회사 역량·조직·인력) / 시스템(설정·데이터 수집 관리). 구현과 검증이 끝난 메뉴만 보인다. 노출 조건은 5개다: 핵심 기능 구현, API 연동, 권한 검사(서버 가드 + RLS), 시험 통과, 완료 기준 충족. 메뉴 노출과 라우트 접근은 따로 관리하며, 서버 권한 검사는 메뉴와 무관하게 항상 한다. 응답: 미인증은 기존 인증 정책, 미출시 경로 404, 출시 경로에 권한 없음 403, 다른 조직 자원 404. 메뉴 미노출을 접근 제어로 보지 않는다 ([[06-UI-UX|06 UI]] §4).
- **범위 3단**: 데모 필수 = Phase 0~7 + 앱 셸·설정·조직·인력 조회·`/admin/ingestion`·대시보드 카드 5개. P1([[12-ROADMAP|12 로드맵]] "있으면 좋음" 최상단, 데모 필수 완료·핵심 시험 통과 뒤) = 관심 공고 → 분석 결과 비교 → 입찰 프로젝트 → 인력 배치 시뮬레이션 → 조직·인력 편집. 해커톤 이후 = 수주 전략·시장 분석, 입찰 일정 등. 이 문서의 P1은 [[01-PRD|01 PRD]]의 P1(해커톤 이후)과 다르다.
- **결정 경계**: `/bids/[id]` = 개별 공고 분석·결정, `/analysis` = 여러 공고 비교·이력, `/projects` = BID 결정 이후 업무. 사람 결정의 정본은 `bid_reviews`다. GO/NO-GO 용어를 만들지 않는다.
- **입찰 프로젝트(P1)**: BID 결정이 있어야 생성한다. 저장 상태는 4개다. 결정이 바뀌면 경고만 하고 자동 종료하지 않는다. 이력은 `bid_project_events`다. 결과는 수동 기록이고 점수·Kev·학습에 쓰지 않는다. 담당자는 로그인 계정이다.
- **부서 계층**: 본부 → 그룹 → 팀. 본부·그룹은 `targetCount`가 없고(오류 아님) 팀만 `targetCount`를 가진다. 가입 목록과 200명 배분 검사는 팀만 대상이다. 상위 부서의 표시 인원은 하위 팀 실제 인원(재직, 직원 ID 중복 제거)의 합이다. 팀 목표·실제 차이는 검증 결과에 보인다. 순환·없는 `parentId`는 검증 오류다.
- **인력**: `team_members`(운영)와 `team_member_scoring`(점수, seed 전용)을 나누고 같은 직원 식별자로 잇는다. 시뮬레이션 후보는 점수 계산 대상 27명 안에서만 보이며, 사람이 고르고 저장하지 않는다. 골든 94/72/68은 고정 입력 순수 함수 시험·입력 스냅샷·멱등 seed로 지킨다. 퇴사 처리 임시 제한은 두지 않으며, 도입하려면 사용자의 별도 명시 승인이 필요하다.
- **조직**: 서버가 현재 조직을 정하고 요청의 조직 ID를 받지 않는다. 멀티 조직은 지원하지 않는다(업무 멤버십 2개 이상이면 `403 UNSUPPORTED_ACCOUNT_STATE`). RLS·`sol_role` 가드·404 정책은 그대로다.
- **서비스 운영자**: `/ops`·`/api/ops/*`·`web/server/ops`. 조직 ADMIN(`/admin/*`·`/api/v1/admin/*`)과 서로의 화면에 들어가지 않는다. DB 객체 이름(`profiles.is_admin` 등)은 바꾸지 않는다.
- 개정한 결정: ADR-019(사람이 고르는 후보 표시 허용, 인력 표 분리), ADR-018(가입 시 개인 조직 생성 중단). 종결한 미결정: 11·12번.

## ADR-022 상세 — 서비스별 data.go.kr 서비스키

2026-10-18 사용자 결정이다. 아래는 **설계 결정**이며 구현은 아직 전이다.

|서비스 (ID)|env|쓰는 registry 키|
|---|---|---|
|입찰공고정보서비스 (15129394)|`G2B_BID_NOTICE_SERVICE_KEY`|`g2b-bid-notice`·`g2b-bid-license-limit`·`g2b-bid-region`·`g2b-bid-eorder-attach`|
|사전규격정보서비스 (15129437)|`G2B_PRE_SPEC_SERVICE_KEY`|`g2b-pre-spec`|
|발주계획현황서비스 (15129462)|`G2B_ORDER_PLAN_SERVICE_KEY`|`g2b-order-plan`|
|업종 및 근거법규 (15129467)|`G2B_INDUSTRY_MASTER_SERVICE_KEY`|`g2b-industry-master`|

- **연결**: registry 항목의 `serviceKeyEnv`가 env **이름**을 가리킨다. 값은 `infra/.env`(깃 제외)에만 둔다 ([[15-DATA-CONTRACTS|15 데이터 계약]] §8, [[10-DEPLOYMENT|10 배포]]).
- **읽는 쪽**: worker의 `OfficialApiConnector`만 읽는다. web·gateway·`NEXT_PUBLIC_` 변수·`web/.env.local`·루트 `.env.local`에는 두지 않는다.
- **빠졌을 때**: `live`에서 4개 모두 필수다. `pnpm check:env`는 빠진 키마다 그 이름으로 `MISSING_KEY`를 낸다. worker는 기동할 때 빠진 env 이름을 알리고 멈춘다. 다른 서비스의 키로 대신 부르지 않는다. `fixture`·`mock`에는 필요 없다.
- **호출 예산**: 서비스마다 따로 센다. 에러코드 22를 받으면 그 서비스의 그날 호출만 멈추고, 다른 서비스의 수집은 계속한다 ([[07-DATA-PIPELINE|07 수집]] §2.2).
- **값 형식**: data.go.kr Decoding 키(인코딩 전 원문)를 넣고 Connector가 URL 인코딩을 한 번만 한다. P0-0 실제 호출로 확인한다.
- **비밀 보호**: 네 값을 모두 로그·오류 메시지·`ingest_errors`·응답 본문·증거에서 가린다(V2-11, [[11-TESTING|11 테스트]]). 네 값이 같아도 env는 나눈다.
- 승인 설계 [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)는 고치지 않는다. 그 문서의 단일 `G2B_SERVICE_KEY` 표기는 이 ADR이 대체한다.

## ADR-023 상세 — 해커톤 데모 컷 재정의

2026-10-19 사용자 승인. 보고서는 [수상 전략·최소 데모 컷](plans/2026-10-18-hackathon-award-plan.md)이다. ADR-020·021의 기술 설계와 결정 이력은 그대로이고, 바뀌는 것은 **해커톤 기간의 우선순위와 데모 노출 범위**뿐이다. 이미 구현된 코드와 진행 중인 브랜치(`feat/people-read` 등)는 삭제·중단하지 않는다.

- **근거**: 마감 2026-10-27. 공식 배점 실용성 30 + 완성도 25 = 55가 "실제 데이터로 돌아가고 흐름이 끊기지 않는가"다. 2026-10-18 기준 공고 스키마·수집·점수 엔진·AI gateway 엔드포인트·화면이 모두 설계만이라, Phase 0~7과 ADR-021 데모 필수 화면 전부를 데모 필수로 유지하면 완결된 흐름이 나오지 않는다.
- **3단 컷**
  - 핵심 컷(데모 필수): S2 대시보드, S3 FX-01 충족·근거·94 / FX-03 NO-BID·Kev 상충, S4 FX-02 분석·72·사람 결정·알림, **S-LIVE 실제 공고 1건 AI 분석 결과**, S6 `PARTIAL`, S7 격리 404. 필요한 기능은 [[12-ROADMAP|12 로드맵]] Critical Path C0~C9.
  - 확장 컷(핵심 컷 green 뒤, 순서대로): S5 변경 감지 → `feat/people-read` 병합과 `/people`·`/org-chart` 노출 → `/admin/ingestion` → 설정 조직 탭 → P0-8 사전규격·발주계획 단계 연결 → 전체 평가셋(test 20·dev 10)·P0-11 학습셋 내보내기.
  - P1(ADR-021 P1, 변경 없음): 관심 공고 → 분석 결과 비교 → 입찰 프로젝트 → 인력 배치 시뮬레이션 → 조직·인력 편집. 착수 게이트는 "핵심 컷 + 확장 컷 전부 green"으로 읽는다(기존 "데모 필수 전부 green"과 같은 뜻).
  - 해커톤 이후: 기존 12 "해커톤 이후" 칸 그대로. 카카오 실발송, `/ops` 분리, 직원 편집, 인력 배치 저장은 해커톤 안에 두지 않는다.
- **인력 데이터**: 명부 200·점수 계산 대상 27명·20 FTE는 보존하고 SOL Score `staffAvailability` 입력으로 쓴다. 조직도 화면 없이도 점수 입력은 동작해야 한다.
- **S-LIVE**: 실제 나라장터 공고 1건을 `live` 모드로 사전 수집·파싱·추출·규칙·점수·Kev까지 돌린 run을 발표 중 `mock` 모드 앱에서 `origin=all`로 조회한다(분석마다 `run_mode`·모델을 기록하므로 표시가 그대로다, [[03-AI-PIPELINE|03]] §3.3). 발표 중 모드 전환·재시작은 하지 않는다. 실시간 추론을 못 했으면 같은 입력의 실행 로그 기반 녹화 영상을 쓰고 "녹화"라고 말한다. 녹화·fixture 결과를 live라고 표시하지 않는다.
- **E3 필수**: [[21-MODEL-TRAINING|21 모델 학습]] §4.2의 E3(Qwen 분류 대조군)를 해커톤 축소 규모(fixture 20 + 실공고 5)로 필수 실행한다. 골든 94/72/68·가중치·Kev 미반영 구조는 결과와 무관하게 불변. 효과가 없으면 개선을 주장하지 않고 3안(유지·축소·제외)을 제안한다. 설계는 [E3 실험 설계](plans/2026-10-19-e3-experiment-design.md).
- **10-21 컷 규칙**(저녁, C1 결과 기준. 핵심 기능 개발은 계속한다): API·GPU 모두 정상 → 실공고·실추론 유지 / API 정상·GPU 불가 → 실공고에 규칙만 `PARTIAL` / API 불가·GPU 정상 → 검증된 fixture로 실추론 시연 / 둘 다 불가 → fixture·mock 시연과 사전 확보한 검증 증거만. 어느 경우든 실행 모드와 출처를 화면·발표에 표시한다.
- **네트워크 대체 경로**: 미결정 8번 참조. 자동 fallback·원본 위조 기능은 추가하지 않는다.
- **제출물**: 슬라이드·3분 영상·기술 자료 구조를 지금부터 병렬로 준비한다(`docs/submission/`). 미구현 화면을 완성품으로, 미검증 수치를 성과로 쓰지 않는다.
- 영향 받은 문서: 01·11·12·17·18·19·21. 05는 `feat/people-read` 병합 뒤, 06·10은 후속.

## 관련 문서
- [[00-README|00 인덱스]]
- [[01-PRD|01 PRD]]
- [[02-ARCHITECTURE|02 아키텍처]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[09-SECURITY|09 보안]]
- [[10-DEPLOYMENT|10 배포]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[PROGRESS]]
