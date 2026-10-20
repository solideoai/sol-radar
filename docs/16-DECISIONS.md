---
title: "16. 아키텍처 결정 기록 (ADR)"
doc: "16"
status: draft
tags:
  - sol-radar
  - decision
updated: 2026-10-20
---

# 16. 아키텍처 결정 기록 (ADR)

상태 값: `제안` → `채택` → `검증됨`(근거 URL·날짜 필수). 외부 사실 확인 전이면 `미검증`, 철회는 `폐기`. 검증 결과는 날짜·근거 URL·결정자와 함께 이 문서에 갱신한다. 폐기한 결정도 행을 지우지 않고 상태만 바꿔 이력으로 남긴다.

## 결정 사항
|ID|결정|상태|날짜|근거|
|---|---|---|---|---|
|ADR-001|Next.js App Router(UI)와 NestJS(API·Worker) 역할 분리|폐기 (ADR-017로 대체)|2026-10-14|UI/도메인 로직 분리, OpenAPI 단일 원천 ([[02-ARCHITECTURE\|02 아키텍처]])|
|ADR-002|self-managed PostgreSQL + Prisma. Supabase 서비스 미사용|폐기 (ADR-017로 대체)|2026-10-14|테넌트 격리·감사 로그를 스키마로 통제, Compose 단일 배포|
|ADR-003|Docker Compose 배포. Kubernetes는 MVP 대상 아님|채택|2026-10-14|노트북 1대 데모와 GPU 호스트를 같은 Compose 프로필로 커버 ([[10-DEPLOYMENT\|10 배포]]). Supabase(DB·Auth)는 Compose 밖(클라우드 프로젝트)이고, Compose는 redis·minio·qdrant·ai-gateway·worker(+ 선택 web)를 띄운다(ADR-017, 2026-10-16). 2026-10-19 현재 GPU 호스트는 회사가 운영하고(ADR-025), 그 참고 구성은 별도 파일 `infra/compose.gpu.yaml`(모델 라우터)이다|
|ADR-004|Kev는 의사결정 보조, Qwen은 추출·설명, 점수는 규칙 엔진이 최종|채택 (ADR-020으로 개정)|2026-10-14|설명 가능성·감사 가능성. Kev는 텍스트 생성 없이 확률만 반환하므로 보조 신호에 적합 ([[03-AI-PIPELINE\|03 AI 파이프라인]], [[08-SCORING\|08 스코어링]]). 2026-10-16 ADR-020: Kev 결과를 "참고 지표"로 표시하는 것을 명시적으로 허용. 점수·자격·권고를 바꾸지 못하는 것은 그대로|
|ADR-005|MinIO 사설 객체 저장소, Qdrant는 재생성 가능한 검색 보조|채택|2026-10-14|원본 보존과 파생 인덱스 분리|
|ADR-006|인앱 알림 P0, 카카오톡 P1 (승인 전 mock)|채택|2026-10-14|비즈메시지 계약·템플릿 승인 미확보 ([[13-NOTIFICATIONS\|13 알림]])|
|ADR-007|모바일(레이아웃·네이티브 앱)·결제/구독 기능을 구현하지 않는다(해커톤 이후 포함). 데스크톱 1280~1920 전용|채택|2026-10-16|사용자 제약(해커톤 이후도 제외, 2026-10-16 사용자 확인). 5분 데모는 데스크톱 1대. 범위를 줄여 자격·점수·결정 기록 완성도에 집중 ([[01-PRD\|01 PRD]])|
|ADR-008|데모 기본 실행은 `AI_PROVIDER=mock`. 실모델은 `ai-local` / `ai-hosted` 선택 프로필|채택 (ADR-020으로 개정: 해커톤 MVP 목표는 `live`, `mock`은 CI·골든·장애 대체 모드로 유지)|2026-10-16|데모 노트북에 GPU 없음. 모델 호출의 네트워크 의존 제거(DB·Auth는 Supabase 클라우드라 데모 중에도 인터넷이 필요하다, ADR-017). mock은 fixture 기반 결정적 응답으로 재현 가능 ([[10-DEPLOYMENT\|10 배포]], [[03-AI-PIPELINE\|03 AI 파이프라인]])|
|ADR-009|설계 문서는 Obsidian vault로 관리. YAML frontmatter, 위키링크, `## 관련 문서`, 콜아웃 규약|채택|2026-10-16|사람 심사위원 열람성·그래프 뷰. AI 심사가 주장→근거 위치를 따라갈 수 있다 ([[00-README\|00 인덱스]])|
|ADR-010|hosted 모델 API(공급자 미정) 호출은 사용자 명시 승인 후에만. 승인은 env `AI_HOSTED_APPROVED=true`로 표현. 기본 `false`|채택|2026-10-16|비용 발생. 승인 없는 과금 금지. `AI_PROVIDER=hosted`는 env로만 켜고 CI·테스트에서 금지 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §3, [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-011|요구조건 추출은 공고 **revision 단위**(조직 무관)로 1회 실행해 `requirement_extractions`에 저장·재사용. 자격 판정·점수·Kev는 **조직 × revision × 프로필 revision** 단위로 `score_runs`|채택|2026-10-16|추출은 공고 원문만 보므로 조직과 무관. 비용·지연 절감, 조직별 결과는 분리 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §2, [[04-DATABASE\|04 DB]] §3.3·§3.4)|
|ADR-012|Kev 입력은 어댑터가 만든 **영어 템플릿 state**만. 한국어 원문 전체를 Kev에 넣지 않는다. Kev는 `review_flags` 추가만 가능|채택 (효과 미검증, ADR-020으로 개정: 운영은 영어 템플릿 유지, 같은 구조의 한국어 템플릿 state는 평가 전용 `KEV_ALLOW_KO_STATE=true`에서만. 참고 지표 표시 허용. 한국어 운영 사용은 평가 결과로 재검토)|2026-10-16|모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않는다고 명시 (2026-10-16, https://github.com/jaredpalmer/kev/blob/1f04cfa/docs/model-cards/kev-4b.md). 변환 효과는 미검증이라 처음에는 `KEV_ENABLED` 기본을 `false`로 정했다. 지금 기본은 `true`이고 세 실행 모드 모두 `false`를 허용한다(`infra/run-modes.json`, ADR-024 D6·ADR-029 A5) ([[03-AI-PIPELINE\|03 AI 파이프라인]] §5.6, [[09-SECURITY\|09 보안]])|
|ADR-013|골든 시나리오는 `G1`~`G10`, 데모 장면은 `S0`~`S7` 번호 규약. 테스트·fixture·데모 문서가 같은 ID로 서로 참조|채택|2026-10-16|11·19·07 간 교차 참조를 ID로 고정해 심사 중 "어디서 검증했나"에 바로 답한다 ([[11-TESTING\|11 테스트]], [[19-DEMO-SCENARIO\|19 데모 시나리오]])|
|ADR-014|fixture 날짜는 상대 표기(예: `+21d`), seed 시 KST 18:00 기준 절대값으로 변환|채택|2026-10-16|데모 날짜가 바뀌어도 마감 D-3·D-1 장면이 유지된다 ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|ADR-015|저장소 지침 우선순위: `docs/CLAUDE.md`와 설계 문서(00~20)가 출발 템플릿(agentic-boilerplate)의 `AGENTS.md`·`docs/boilerplate/`·`.claude/` 스킬보다 우선. 루트 `CLAUDE.md`가 `@docs/CLAUDE.md`를 먼저 불러온다|채택|2026-10-16|사용자 결정. 저장소가 Supabase·Expo 템플릿에서 시작했다. ADR-017 이후 템플릿의 Supabase(인증·DB·RLS·anon 키)·`web/server/<도메인>` 구조 규칙은 설계와 일치하므로 따른다. 여전히 따르지 않는 것: Expo(`mobile/`, 이미 삭제, ADR-007), Vercel·EAS 배포 전제(미결정, 아래 미결정 8번). 템플릿 견본 도메인 정리는 Phase 3 N1에서 한다(아래 ADR-024 D15) ([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-016|웹 클라이언트 공유 상태는 zustand, 입력 검증 스키마는 zod(4.x). Next.js 앱 `web/`에 설치(zustand 5.0.15, zod 4.6.5). 외부 API 계약(`/api/v1` Route Handler)의 DTO도 같은 zod 스키마(`web/server/<도메인>/*.model.ts`)가 단일 원천이고, worker(`web/worker`)도 같은 스키마를 쓴다|채택|2026-10-16|사용자 결정. zod는 DTO 단일 원천([[05-API-SPEC\|05 API]] §7)과 같은 라이브러리라 화면·Route Handler·worker가 스키마 표현을 공유한다. zustand는 여러 클라이언트 컴포넌트가 함께 쓰는 UI 상태만 담고, 서버 데이터와 URL 쿼리 필터는 담지 않는다 ([[06-UI-UX\|06 UI]] §11)|
|ADR-017|아키텍처 전환: Next.js(`web/`, 화면·Route Handler·서버 도메인 `web/server/<도메인>`) + **Supabase(Postgres·RLS·Auth)**. NestJS·Prisma·자체 JWT 인증은 쓰지 않는다. Worker는 `web/worker` 진입점(같은 코드베이스의 별도 프로세스, BullMQ). MinIO·Qdrant·Redis/BullMQ·Python AI gateway·Docker Compose는 유지. 조직 데이터 열은 `org_id`, 업무 역할은 `memberships.sol_role`(ADMIN·SALES·ANALYST·VIEWER). service role 키는 worker·seed만. 개발 DB·Auth는 Supabase 클라우드 프로젝트(Pro)|채택 (해커톤 동안 유지. ADR-028로 해커톤 뒤 API·worker는 NestJS로 옮긴다)|2026-10-16|사용자 결정(2026-10-16). 출발 템플릿(agentic-boilerplate)이 Next.js + Supabase(조직·역할·RLS·인증 견본, 정책 시험·타입 생성 게이트)라 그대로 쓰면 인증·격리를 새로 만들지 않는다. ADR-001·002를 대체한다([[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]])|
|ADR-018|가입·로그인 방식: 공개 가입 + 초대. 누구나 이메일 + 비밀번호(`/auth/sign-up`) 또는 간편 로그인(구글·카카오·네이버)으로 계정을 만들고, 업무 조직 합류는 초대 수락으로 한다. 간편 로그인 제공자 설정은 해커톤 안에서 하되 다른 기능을 모두 끝낸 뒤 한다(후순위)|채택 (ADR-021로 개정: 가입 시 개인 조직 생성 중단, 이미 있는 개인 조직은 보존)|2026-10-16|사용자 결정(2026-10-16). 랜딩의 시작하기가 이미 `/auth/sign-up`으로 가고, 버튼·콜백·계정 연결 코드가 템플릿에 있어 새로 만들 것이 없다. 미결정 13번을 닫는다 ([[09-SECURITY\|09 보안]], [[12-ROADMAP\|12 로드맵]])|
|ADR-019|회사 솔리데오 고정, 가상 직원 명부 200명(남녀 100/100)·고유 정장 사진 200장, 엑셀 팀명 합산·비례 배분·자연스러운 세 글자 가상 이름, 가입 부서·직급/직책 필수|채택 (데이터·DB·가입 구현됨, 2026-10-17 main `42a4ead`. 화면 `/people`·`/org-chart`와 클라우드 DB 적용은 미완. ADR-021로 개정: 인력 표를 운영 `team_members`와 점수 `team_member_scoring`으로 분리, 사람이 고르는 규칙 매칭 후보 표시 허용)|2026-10-16|사용자 인터뷰 및 저장 경로 최종 승인. 상세는 아래 ADR-019·[[07-DATA-PIPELINE\|07 데이터]]·[[06-UI-UX\|06 UI]]·[[PROGRESS]]|
|ADR-020|실데이터 MVP와 AI 파이프라인 v0.2: 실행 모드 `live`·`fixture`·`mock`, 나라장터 Open API 실수집·첨부 파싱, Qwen3.5-9B·Kev-9B 실추론(회사 GPU 서버), Kev `kev-qs/v0.2` 참고 지표(SOL Score 미반영), 평가셋·평가 체계, Kev-9B LoRA 는 오류 분석 뒤 후속|채택 (설계 승인. 구현 일부 `15f5214`·`caf0abd`, 구현 상태는 [[PROGRESS]]. **ADR-023으로 해커톤 범위 재배치: live 실수집·실추론 1건·E3는 핵심 컷, P0-8·전체 평가셋·P0-11은 확장 컷. 설계는 불변**. ADR-027으로 Kev-9B LoRA 학습·E4 비교는 해커톤 X6.)|2026-10-16|사용자 결정(2026-10-16): "해커톤 시연용 가짜 AI가 아니라, 실제 공공입찰 데이터를 대상으로 끝까지 동작하는 SOL RADAR MVP". ADR-004·008·012를 개정한다. 상세는 아래 ADR-020·[[21-MODEL-TRAINING\|21 모델 학습]]·[[03-AI-PIPELINE\|03 AI 파이프라인]]·[[07-DATA-PIPELINE\|07 수집]]. 승인 설계: [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)|
|ADR-022|data.go.kr 서비스키를 서비스마다 따로 둔다: env 4개(`G2B_BID_NOTICE_SERVICE_KEY` 15129394·`G2B_PRE_SPEC_SERVICE_KEY` 15129437·`G2B_ORDER_PLAN_SERVICE_KEY` 15129462·`G2B_INDUSTRY_MASTER_SERVICE_KEY` 15129467). 소스 registry의 `serviceKeyEnv`가 소스별 env 이름을 가리킨다. 단일 `G2B_SERVICE_KEY`는 쓰지 않는다|채택 (구현 일부 `15f5214`, 구현 상태는 [[PROGRESS]])|2026-10-18|사용자 결정(2026-10-18): 서비스 4개에 키를 각각 받았고 API마다 키를 나눈다. 서비스별로 키를 바꾸거나 폐기할 수 있고, 호출 예산 카운터(`quota:{serviceId}:{YYYYMMDD}`)와 단위가 같다. ADR-020 승인 설계의 단일 키 표기를 대체한다. 상세는 아래 ADR-022·[[07-DATA-PIPELINE\|07 수집]] §2.2·[[15-DATA-CONTRACTS\|15 데이터 계약]] §8|
|ADR-021|사이드바 정보 구조와 입찰 업무 확장: 데모 필수 화면(앱 셸·설정·조직·인력 조회·데이터 수집 관리·대시보드 카드 5개)과 P1(관심 공고·분석 결과 비교·입찰 프로젝트·인력 배치 시뮬레이션·조직·인력 편집), 조직 주소 없는 경로, 서비스 운영자 `/ops` 분리|채택 (설계 승인. 구현 일부 main `42a4ead`, 구현 상태는 [[PROGRESS]]. **ADR-023으로 해커톤 범위 재배치: 데모 필수 화면이 확장 컷으로 이동, 설계는 불변**)|2026-10-16|사용자 승인 4차(2026-10-16). ADR-018·019를 개정하고 미결정 11·12번을 닫는다. 상세는 아래 ADR-021·[사이드바 정보 구조 설계](plans/2026-10-16-sidebar-ia-design.md)|
|ADR-023|해커톤 데모 컷 재정의(3단): **핵심 컷**(S2·S3·S4·S-LIVE·S6·S7과 그에 필요한 Phase 0~6 기능) → **확장 컷**(S5 변경 감지, ADR-021 데모 필수 화면, P0-8, 전체 평가셋·P0-11) → **P1**(ADR-021 P1, 변경 없음). 실제 AI 추론 1건(S-LIVE) 필수, E3 대조 실험 필수(축소 규모), 10-21 외부 의존성 컷 규칙 4갈래, 네트워크 대체 경로 결정(미결정 8번 종결)|채택 (2026-10-19 사용자 승인, 구현 전)|2026-10-19|마감 2026-10-27, 공식 배점 실용성 30 + 완성도 25 = 55가 "실제 데이터로 돌아가고 흐름이 완결되는가". 2026-10-18 기준 "이 입찰에 들어가야 하는가" 코드가 0이라 Phase 0~7 전부를 데모 필수로 두면 완결이 불가능. ADR-020·021의 설계는 보존하고 우선순위·노출 범위만 바꾼다. 상세는 아래 ADR-023·[수상 전략·최소 데모 컷](plans/2026-10-18-hackathon-award-plan.md)|
|ADR-024|Phase 0 실행 환경 결정: web 호스트 실행(Compose에 web 없음), worker 실행 명령·heartbeat health, hosted 승인 게이트, 서비스키 live 전용, mock `KEV_ENABLED=true`, 실행 모드 규칙 원천 `infra/run-modes.json`, 호스트 포트·Compose 프로젝트 이름, 비밀값 취급 규칙, fixture 범위(상세 D1~D15와 구현 시 정한 값은 아래 ADR-024 상세)|제안 (구현됨 `88afb79`·`1b824c8`·`9b2bdf1`, 사람 채택 전)|2026-10-19|계획 [Phase 0 계획](plans/2026-10-18-phase-0-infra.md) D1~D15를 사용자가 "1번으로 진행"(2026-10-18)으로 추천안 전제 확정, redis 호스트 포트 6380은 사용자 결정(2026-10-18). 구현 [[10-DEPLOYMENT\|10 배포]]·[[07-DATA-PIPELINE\|07 수집]] §6.5, 증거 `docs/evidence/phase-0/`|
|ADR-025|회사 GPU 추론 엔드포인트 — HTTPS 제공(터널 폐기). 회사 GPU 서버는 외부 접근이 안 되므로 회사가 모델 런타임(vLLM Qwen3.5-9B, `kev.serve` Kev-9B@v1.0)을 `https://acropolissg.com/sol-radar` 아래로 제공하고 노트북 ai-gateway가 HTTPS로 붙는다. GPU 서버 안 nginx 모델 라우터(`infra/gpu/model-router.conf`)가 경로를 나눈다. env 이름·아키텍처·실행 모드·장애 처리·데이터 경계는 그대로다. 상세는 아래 ADR-025|채택 (사용자 결정 2026-10-19 + 라우터 추가 결정 2026-10-19. 엔드포인트는 회사가 제공 예정이며 2026-10-19 기준 응답 미확인. 경로는 라우터 기준으로 결정, 바깥 nginx 접두어 처리·추가 인증은 미확인)|2026-10-19|사용자 결정(2026-10-19): "회사 GPU 서버는 외부 접근 불가. 회사가 HTTPS 엔드포인트 `https://acropolissg.com/sol-radar`로 모델 런타임을 제공한다". ADR-020 실추론 위치의 연결 방식만 바꾼다. 상세는 아래 ADR-025 ([[10-DEPLOYMENT\|10 배포]], [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9, [[02-ARCHITECTURE\|02 아키텍처]], [[09-SECURITY\|09 보안]])|
|ADR-026|팀(조직) 만들기는 서비스 운영자(`profiles.is_admin`)만 한다. 템플릿 "팀 만들기" 정책(authenticated 누구나)을 `is_admin()`으로 좁힌다(`20261019000008_team_creation_operator_only.sql`). 업무 조직 합류는 초대로만(ADR-018·021), 데모 조직 2개는 `pnpm demo:reset`이 service role로 만든다|채택 (2026-10-19 사용자 결정. 마이그레이션 main 병합 `48b20a5`)|2026-10-19|팀 만들기가 열려 있으면 가입만 한 사람이 자기 팀 ADMIN이 되어 운영 표를 읽는다. 상세는 아래 ADR-026|
|ADR-027|Kev-9B LoRA 파인튜닝을 해커톤 안에서 비교 실험으로 하고(X6), 핵심 컷 일정을 2일 당긴다. 평가셋 v0.1(P0-9)·학습셋 번들(P0-11)을 확장 컷에서 X6로 올린다. F1·F2·F3은 회사가 실행하고(ADR-025), E4를 E1과 같은 test 분할에서 비교한다. 데모·S-LIVE 모델은 Kev-9B@v1.0 그대로, Qwen 파인튜닝은 범위 밖 그대로. Critical Path 각 작업 −2일(10-19 이전으로는 못 당김), 외부 의존성 컷 10-21 → 10-20 저녁, 기능 freeze 10-25 → 10-23, 최종 리허설 10-26 → 10-24, 제출 10-27 그대로. **개정(같은 날 저녁)**: 회사 GPU 학습은 주말 10-24~25에 하고, E4 평가는 서버 안 오프라인 `kev.benchmark` 채점으로 한다([[23-WEEKEND-FINETUNE\|23]])|채택 (2026-10-19 사용자 결정, 같은 날 저녁 개정)|2026-10-19|사용자 원문: "파인튜닝도 해야해서 일정 이틀씩 당겨야 해". 선택: Kev-9B LoRA만, 결과는 비교로 제출(목표 미달·회사 미실행이면 v1.0 유지). E4 평가는 처음 평가 전용 `kev.serve` + `/sol-radar/kev-lora/`였으나 회사 nginx 가 location 하나만 등록할 수 있어 오프라인 채점으로 개정(10번), 사람 라벨은 사용자가 직접. [변경안](plans/2026-10-19-finetune-schedule-pull.md)|
|ADR-028|해커톤 뒤 API·worker를 NestJS로 옮긴다: `/api/v1` Route Handler와 worker(BullMQ 소비자)를 NestJS 앱으로 옮기고 Next.js(`web/`)는 화면만 맡는다. Supabase(Postgres·RLS·Auth)·MinIO·Qdrant·Redis/BullMQ·AI gateway·Docker Compose는 그대로, Prisma·자체 JWT는 여전히 쓰지 않는다. 해커톤(제출 2026-10-27) 동안은 ADR-017 구조로 구현한다|채택 (2026-10-19 사용자 결정, 해커톤 뒤 착수)|2026-10-19|사용자 결정. 지금 옮기면 핵심 컷 일정이 깨져 해커톤 뒤로 미룬다. 상세는 아래 ADR-028|
|ADR-029|Critical Path 1차 분담 중 사용자가 정한 계약·범위 7건(A1~A7): `FX-13` 인용 검증 실패 처리, `FX-05` `PENDING_REVIEW` 조건, `AI_FAULT_INJECT` 5값과 `gateway_down` 시험 전용 503, 정보화사업 수집 필터 확대, `KEV_ENABLED=false` 세 모드 허용(기본 `true`), C6 화면 스펙 D1~D30 추천안 일괄 승인, 목록 기본 상태 필터와 취소 공고 표시. 상세는 아래 ADR-029 상세|채택 (2026-10-19 사용자 결정)|2026-10-19|사용자 결정(2026-10-19, 조정 세션 sol-radar-e8 기록). [Phase 0 정본 불일치 목록](plans/2026-10-19-phase-0-doc-inconsistencies.md) #1(b)·#2(a)·#3(a)·#4·#7을 닫는다. 반영 문서 [[03-AI-PIPELINE\|03]]·[[05-API-SPEC\|05]]·[[06-UI-UX\|06]]·[[07-DATA-PIPELINE\|07]]·[[10-DEPLOYMENT\|10]]·[[11-TESTING\|11]]·[[19-DEMO-SCENARIO\|19]]·[[20-GLOSSARY\|20]]|
|ADR-030|Critical Path 1차 분담 조정 세션(sol-radar-e8)이 레인 사이 계약으로 정한 26건(B1~B26): gateway 전송 실패·오류 분류, `KevResponse.errorCode`, fixtureId 형식, `/kev`·`/explain`·`/parse`·`/health` 형태, 기동 거부 조건, 추출 경고 코드, `seq`, 공고 상태 매핑, ingest run 상태, registry URL, data.go.kr 오류 봉투, 원자 저장 RPC, 인력 기간 배정 접기, 분석 요청 멱등·큐 계약, 멈춘 분석 복구, 사전 분석 명령, 알림 링크 검증, 설명 출처, 대시보드·사이드바 글자 +3px. 처음에는 제안으로 올려 해당 절에 콜아웃만 달았고, 같은 날 사용자가 일괄 채택해 정본 본문으로 옮겼다|채택 (2026-10-19 사용자 결정)|2026-10-19|조정 기록부의 판정(K1~K13·C3-1~3 등)과 사용자 일괄 채택(2026-10-19). 항목별 근거는 아래 ADR-030 상세|
|ADR-031|정본 반영 2차(조정 세션 sol-radar-e8) 16건(C1~C16). 사용자 결정 4건(C1~C3·C16): 사이드바 글자 +3px 기준 정정, `Review.reviewer.role` null 허용, S3 목록 절차의 필터를 권고 `BID`로, `pnpm demo:reset`의 추출 seed 제거. e8 판정 12건(C4~C15): 멈춘 분석 복구 축소, 결과 저장 RPC·멱등 키 check, worker 실패 분류, Kev score 답 필수 필드, mock Kev 고정값 규칙, `FX-07` r2 77점, `FX-17` 자격 표기, 사전 분석 기대 플래그, C5-B 후보, 수집 주기 env, 분석 jobId, 목록 `CLOSED`·S5 재분석. C1~C3은 먼저 채택해 본문에 반영했다. C4~C15는 처음에 해당 절에 제안 콜아웃으로 달았고, 같은 날 사용자가 일괄 채택해 본문으로 옮기고 콜아웃은 지웠다|채택 (2026-10-19 사용자 결정, 일괄)|2026-10-19|사용자 결정(2026-10-19, 조정 세션 sol-radar-e8 전달)과 e8 판정. 항목별 근거는 아래 ADR-031 상세|
|ADR-032|정본 반영 3차(조정 세션 sol-radar-e8). e8 판정 9건(D1~D9): gateway 요청 하나의 마감 시계(`KEV_TIMEOUT_MS`·`AI_TIMEOUT_MS`), 모델 레지스트리 `allowedHosts`, 클라우드 `pnpm db:push` 전 멱등 키 접두어 사전 질의, ADR-030 B1 주석, 분석 실패 코드·복구, 계정이 지워진 결정자 표시, `requirement_assessments.kev_distribution` 모양, web env 3개, `KEV_UNAVAILABLE` 화면 라벨 확인. 처음에는 해당 절에 제안 콜아웃으로 달았고, 같은 날 사용자가 일괄 채택해 본문으로 옮기고 콜아웃은 지웠다(D6은 ① 센티널). 함께 main에 이미 들어간 코드·마이그레이션·fixture와 다른 정본 문장을 사실 정정 F1~F8로 본문에서 고쳤다|채택 (2026-10-19 사용자 결정, 일괄). F1~F8은 결정이 아니라 사실 정정이다|2026-10-19|조정 세션 sol-radar-e8의 정본 반영 3차 지시(7d·3e 전달 포함)와 사용자 일괄 채택. 항목별 근거는 아래 ADR-032 상세|

### ADR-007 ~ 014 구현 결과
- **ADR-007**: `web/`에 1280px 미만 breakpoint·결제 모듈·요금 화면 없음. UI 토큰·그리드는 1280~1920만 ([[06-UI-UX|06 UI]]). 17 절대 규칙으로 강제.
- **ADR-008**: `infra/env/demo.env.example` 기본값 `SOL_RUN_MODE=mock`(→ `AI_PROVIDER=mock`, `KEV_ENABLED=true`로 mock adapter가 응답, `DEMO_MODE=true`, ADR-020). `KEV_ENABLED`는 기본값이 `true`일 뿐이고 세 모드 모두 `false`를 허용한다(ADR-029 A5). mock adapter는 `services/ai/src/sol_ai/adapters/mock.py`, fixture ID별 고정 응답. 프로필 전환에 코드 변경 없음.
- **ADR-009**: 모든 md에 frontmatter. 파일 이름 변경 금지(링크가 파일명 기준). 00이 MOC. 저장소의 `docs/` 폴더가 이 vault.
- **ADR-010**: `AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED=false`면 gateway가 기동을 거부한다(조용히 mock으로 바꾸지 않는다). Route Handler `GET /api/v1/admin/ai/status`는 `422 HOSTED_NOT_APPROVED`. 호출 시 provider·모델·토큰 수를 로그에 기록(키는 기록 금지). 승인 기록은 [[PROGRESS]] 작업 로그에 남긴다.
- **ADR-011**: extract job(`web/worker`, ADR-020 이후 ingest → documents → extract 순서)이 `/extract`를 호출하고 `requirement_extractions`에 UNIQUE(`revision_id`, `model_name`, `prompt_hash`)로 저장. analysis job은 이것을 읽어 `/kev`와 규칙 엔진을 돈다 ([[02-ARCHITECTURE|02 아키텍처]] 흐름).
- **ADR-012**: state 빌더는 `services/ai/src/sol_ai/adapters/kev.py`, 템플릿은 `services/ai/kev/state-templates/{en,ko}.v0.2.txt`에만 둔다(ADR-020). 한국어/영어 비교는 평가셋 E1·E2([[21-MODEL-TRAINING|21 모델 학습]]), `permute` 순서 민감도는 03 §5.9. 발표의 고정 장면은 mock Kev, `live`·`fixture` 모드는 Kev-9B 실추론(참고 지표).
- **ADR-013**: 11의 골든 시나리오 표, 07의 fixture 표, 19의 장면 표가 `G`·`S`·`FX` ID로 서로 가리킨다. 시험 이름(`describe`)에 ID를 넣는다(예: `describe("G3 필수 자격 미충족 → NO-BID")`). 시험 파일은 [[11-TESTING|11 테스트]] §3 표가 ID 행으로 가리킨다(예: G3 → `web/server/scoring/decision-policy.golden.test.ts`).
- **ADR-014**: `fixtures/*.json`의 날짜 필드는 `+Nd` 문자열. seed 스크립트(`pnpm demo:reset`)가 실행 시각의 KST 18:00을 기준으로 절대 ISO8601로 바꿔 적재한다. 테스트는 기준 시각을 고정해 결정적으로 돈다.

### ADR-017 구현 결과
- **코드 위치**: 화면·Route Handler·서버 도메인은 `web/` 하나에 둔다. 서버 도메인은 `web/server/<도메인>/`(model·repo·service·index 배럴, `import "server-only"`, 예: `bids`·`ingestion`·`scoring`·`analysis`·`review`·`notifications`·`company-profile`·`health`), 외부 계약은 `web/app/api/v1/**/route.ts`(경로 `/api/v1/...` 그대로), 헬스체크는 `web/app/health/{live,ready}/route.ts`. pnpm workspace·`apps/`·공유 계약 패키지는 만들지 않고, `web/`은 템플릿처럼 독립 설치한다(`pnpm -C web …`). 계약의 단일 원천은 zod 스키마(ADR-016)이고 OpenAPI 문서는 필요하면 zod에서 생성한다(선택).
- **DB**: Supabase Postgres + RLS. 스키마·RLS·함수는 `supabase/migrations/*.sql`에 새 파일로만 쌓는다(append-only). 타입은 생성물 `web/lib/database.types.ts`(`pnpm db:types`, 마이그레이션과 같은 커밋). 클라우드 적용은 `pnpm db:push`(운영 DB를 바꾸므로 사용자 확인 뒤에만), 정책 시험은 `pnpm test:db`(`scripts/database.test.mjs`, PGlite).
- **조직·권한**: 조직 소유 데이터의 열은 `org_id`이고 RLS `org_id in (select public.my_org_ids())`로 거른다. 템플릿 표 `profiles`(`auth.users`와 1:1, 서비스 운영자 `is_admin`, 계정 상태 `status`)·`organizations`·`memberships`·`invitations`·`activities`를 재사용한다. ADR-021로 템플릿 견본 `tasks`는 지우지 않고 입찰 프로젝트 체크리스트로 재사용한다(P1). 업무 역할은 `memberships.sol_role`(text + check `ADMIN`·`SALES`·`ANALYST`·`VIEWER`, 기본 `VIEWER`)이고 [[05-API-SPEC|05 API]]의 권한 열이 이 값을 본다. `org_role`(owner·member)은 초대·구성원 관리 같은 조직 관리에만 쓴다. ADR-021로 구성원 관리도 `sol_role=ADMIN` 기준이 되고 `org_role`은 템플릿 호환용으로 남는다. 운영자 `profiles.is_admin`도 남의 조직 데이터는 못 읽는다. 다른 조직 자원은 RLS로 행이 안 보여 `404`가 된다.
- **공용 데이터**: `bid_notices`·`bid_revisions`·`bid_documents`·`requirement_extractions` 등 조직 소유가 없는 표는 `authenticated`가 읽기만 하고, 쓰기는 worker(service role)만 한다.
- **Auth**: Supabase Auth(이메일 + 비밀번호와 간편 로그인 구글·카카오·네이버, 공개 가입 + 초대로 조직 합류, ADR-018). 가입·로그인·로그아웃·비밀번호 재설정·초대 수락은 템플릿 `/auth/*` 화면과 `web/server/auth`가 맡고, 자체 로그인·토큰 갱신·로그아웃 엔드포인트는 두지 않는다. 세션 쿠키는 `@supabase/ssr`가 관리한다(브라우저 클라이언트가 같은 쿠키를 읽어야 해서 HttpOnly가 아니다. SameSite=Lax, 운영에서 Secure). XSS 방어는 CSP nonce(`web/proxy.ts`·`web/server/csp`)가 맡는다. Route Handler는 세션 쿠키 또는 `Authorization: Bearer <Supabase access token>`을 받고, 쿠키 인증의 상태 변경 요청에는 `X-Requested-With: sol-radar`를 요구한다. 토큰 만료·refresh 재사용 탐지·로그인 제한·비밀번호 정책은 Supabase Auth 설정이다(아래 미결정 10번).
- **service role**: `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 무시하므로 worker와 seed 스크립트(서버 전용)만 쓴다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키)으로 DB를 부르고 RLS가 권한을 정한다. worker는 쓸 때 `org_id`를 직접 지정하고, 테넌트 혼입을 막는 시험을 둔다. 이 키는 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다.
- **Worker**: `web/worker/`가 BullMQ 소비자 진입점(ingest job·analysis job)이다. `web/server` 도메인 코드를 같이 쓰는 별도 Node(TypeScript) 프로세스이고, 도메인 모듈이 `import "server-only"`라 `node --conditions=react-server --import tsx worker/main.ts`로 띄운다(검증됨 2026-10-18, 아래 미결정 9번). Kev·Qwen 호출은 여전히 AI gateway만 한다.
- **Compose**: `infra/compose.yaml`은 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(+ 선택 `web`. Compose에 정의 없음, [[10-DEPLOYMENT|10 배포]] 표 참조)를 띄운다. `postgres`·`api` 서비스는 없다. 데모 seed는 Compose 서비스가 아니라 스크립트 `pnpm demo:reset`(service role로 Supabase 프로젝트에 적재, 멱등)이다. env에서 자체 JWT 서명 비밀·Postgres 비밀번호가 빠지고 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_DB_URL`이 들어온다([[10-DEPLOYMENT|10 배포]]).
- **유지(바꾸지 않음)**: MinIO(첨부 원본), Qdrant(임베딩 검색), Redis + BullMQ(작업 큐), Python AI gateway(FastAPI, `AI_PROVIDER=mock|local|hosted`), Docker Compose. Supabase Storage·pgvector·Supabase Queues는 쓰지 않는다.
- **시험**: 웹·서버 도메인·Route Handler·골든·worker는 Vitest, DB 정책은 `node --test` + PGlite(`pnpm test:db`), E2E는 Playwright(`web/e2e/`, 로그인 뒤 `web/e2e-auth/`), AI gateway는 pytest, 인프라는 `infra/smoke.sh`. G5(조직 격리)는 RLS 정책 시험 + Route Handler 시험 + E2E로 본다([[11-TESTING|11 테스트]]).
- **데모 네트워크**: 개발 DB·Auth가 Supabase 클라우드라 데모 중 인터넷이 필요하다. 대체 경로(로컬 Supabase CLI `pnpm db:start`, 사전 녹화 영상)는 아래 미결정 8번이다. AI 장애 대체 시연(`docker compose stop ai-gateway` → `PARTIAL`)은 그대로다.

### ADR-018 구현 결과
- **코드**: 템플릿 그대로다. 버튼은 `web/app/auth/social-sign-in.tsx`(로그인·가입 화면의 가는 선 아래), 켤 제공자 판단은 `web/lib/auth-providers.ts`, 콜백은 `web/app/auth/callback/route.ts`(받은 코드를 세션으로 바꾼다). 마이페이지의 로그인 수단 연결(템플릿 `/api/auth/*`)을 남길지는 Phase 3 N1 템플릿 정리(ADR-024 D15)에서 정한다([[05-API-SPEC|05 API]]).
- **버튼 켜기**: `web/.env.local`의 `NEXT_PUBLIC_AUTH_GOOGLE`·`NEXT_PUBLIC_AUTH_KAKAO`·`NEXT_PUBLIC_AUTH_NAVER`가 `true`인 제공자만 보인다(빌드 때 코드에 박힌다). Supabase에 제공자를 설정하기 전에 켜면 누를 때 Supabase가 `provider is not enabled`를 보이고 사이트로 돌아오지 않는다. 데모·배포 환경에서는 설정을 마친 제공자만 켠다.
- **제공자 설정(후순위)**: 구글·카카오는 Supabase 기본 제공자, 네이버는 사용자 정의 OIDC 제공자 `custom:naver`다. Client ID·Secret은 Supabase 쪽(클라우드는 대시보드, 로컬은 `supabase/config.toml` + 깃 제외 `supabase/.env`)에만 두고 웹 env에는 넣지 않는다. 절차는 `docs/boilerplate/OAUTH-PROVIDERS.md`.
- **가입이 여는 범위**: 가입하면 계정과 `profiles` 행이 생긴다(템플릿 가입 트리거는 개인 조직도 만들었지만 ADR-021로 새 마이그레이션에서 중단했다. 이미 있는 개인 조직은 지우지 않는다). 업무 조직(예: 솔리데오) 데이터는 멤버십이 있어야 RLS(`my_org_ids()`)가 보여 주므로 가입만으로는 보이지 않는다. 공용 표(`bid_notices` 등)는 `authenticated` 읽기라 가입한 사용자도 읽는다.
- **데모**: 로그인은 seed 계정의 이메일 + 비밀번호다([[19-DEMO-SCENARIO|19 데모 시나리오]] S0). 간편 로그인은 데모 장면에 쓰지 않는다.

## 반드시 검증할 미결정 사항
|#|항목|상태|검증일|근거 / 다음 행동|
|---|---|---|---|---|
|1|data.go.kr 사용 API별 서비스키·트래픽·페이지네이션·실제 응답 스키마|부분 검증|2026-10-19|**검증됨**(data.go.kr 서비스 페이지 Swagger·참고문서, 2026-10-16): 입찰공고정보서비스 15129394(`/1230000/ad/BidPublicInfoService`), 사전규격 15129437, 발주계획 15129462, 업종 및 근거법규 15129467의 오퍼레이션·요청 파라미터·응답 필드 이름, 무료·자동승인, 개발계정 1,000(사용자정보·개방표준 10,000), JSON/XML, 이용허락범위 제한 없음. 서비스키는 서비스별 env 4개(ADR-022, 값은 저장소 밖). **검증됨**(C1 실호출, 2026-10-19, 4 서비스 37회): 오퍼레이션별 실제 응답(마스킹 14건 `fixtures/recorded/`), `infoBizYn`은 요청 파라미터로 주면 무시돼 클라이언트 필터만 가능(빈값이 많아 필터를 넓힌다, ADR-029 A4), 보조 조회는 `inqryDiv` 필수, 구조화 자격 필드는 보조 조회에만 있다. **미검증**: 조회 기간 상한(8일까지만 확인), 면허제한 여러 행의 의미(19번), 키 오류 응답(resultCode 30·31·22) 형식. 증거 [API 호출 증거](evidence/phase-0/external-deps-api-20261019.md) ([[07-DATA-PIPELINE\|07 수집 파이프라인]], [[15-DATA-CONTRACTS\|15 데이터 계약]])|
|2|Kev v1.0 체크포인트 가용성·추론 API·라이선스·메모리·한국어 성능|부분 검증|2026-10-16|**검증됨** (https://github.com/jaredpalmer/kev README 및 https://github.com/jaredpalmer/kev/blob/1f04cfa/docs/model-cards/kev-4b.md): 체크포인트 4종(0.8B/4B/9B/27B) 공개, Hub 태그 `v1.0`로 가중치 고정(`--run jaredpalmer/kev-4b@v1.0`, README 명시), GitHub 태그 `kev-1.0`, API `POST /v1/systemone`(noul/choice/score) + `GET /v1/models`, Apache-2.0, Python 3.12/3.13 + uv 소스 설치, `--device cpu\|cuda\|mps\|auto`. 모델 카드 `Languages: English`, 영어 외 언어는 잘 동작하지 않음. **미검증**: 한국어 → 영어 state 변환의 효과(ADR-012), VRAM 요구량, Kev-0.8B CPU 실행, 자체 보고 수치의 독립 재현. hosted 공급자 존재·포맷·가격은 전부 미확인. 다음: [[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9 절차로 `ai-local`에서 fixture 20건 측정. **2026-10-16 추가 검증**(main `1f04cfa`): `kev.train`(LoRA·full FT, QLoRA 없음, `--init_from`), `kev.benchmark`, `kev.compare`, Kev-9B@v1.0 = `db029f08`, 9B 추론 메모리는 모델 카드 21.9 GB·README 약 17 GB로 불일치. ADR-020으로 기본 모델을 Kev-9B로 바꾸고 한국어 성능은 평가셋 E2로 측정 ([[21-MODEL-TRAINING\|21 모델 학습]])|
|3|Qwen 런타임(vLLM 등) 선택 및 GPU 메모리 분배|결정 (ADR-020·025. vLLM guided JSON 동작은 C1 ③ G4 미검증)|2026-10-19|ADR-020: 해커톤 실추론은 회사 GPU 서버, Qwen 런타임은 vLLM(guided JSON·logprob). **2026-10-19 ADR-025**: GPU 메모리 배분(동시 적재·GPU 장수·양자화)은 회사 측 결정으로 이관했다. 우리 쪽 남은 결정은 없다. 회사가 알려 주는 GPU 모델·VRAM·점유 값이 있으면 C1 ③ G5로 기록하고, 없으면 "회사 운영, 측정 불가"로 남긴다. **2026-10-20 서버 확인(G5)**: NVIDIA A40 46,068 MiB ×3. GPU 0·2는 회사 서비스 사용 중, SOL RADAR 학습·채점은 물리 GPU 1만([[22-FINETUNE-RUNBOOK\|22]] §3.1). 추론 런타임(vLLM·`kev.serve`)을 띄울 GPU는 미확인 ([[10-DEPLOYMENT\|10 배포]] GPU 메모리 배분·학습 전용 GPU)|
|4|HWP/HWPX parser 라이브러리·라이선스·안전성|진행 (ADR-020)|2026-10-16|형식별 `DocumentParser` 인터페이스(HWP·HWPX·PDF)를 두고, 오픈소스 후보의 라이선스와 추출 품질(본문·표·금액·자격 조건·요구사항 누락)을 실제 RFP 샘플로 비교한 뒤 형식마다 정한다. 후보·절차는 [[03-AI-PIPELINE\|03 AI 파이프라인]] §10(요약은 [[07-DATA-PIPELINE\|07 수집]] §2.5). 결정 전까지 처리할 수 없는 첨부는 `PARSE_UNSUPPORTED` → 확인 필요|
|5|카카오 비즈메시지 발신 계약과 승인된 템플릿|미검증|-|해커톤 범위 밖. mock provider ([[13-NOTIFICATIONS\|13 알림]])|
|6|한국어 검색 품질(Qdrant 임베딩과 PostgreSQL full text 병행)|미검증|-|데모 필수 아님. 키워드 검색 fallback이 기본|
|7|초기 스코어 가중치와 결정 임계값(75/50), 조직별 판정 기준|미검증|-|[[08-SCORING\|08 스코어링]] worked example로 fixture 3건 일치 확인. 조직별 config versioning|
|8|데모·배포 실행 환경: Supabase 클라우드 그대로 / 로컬 Supabase CLI(`pnpm db:start`) 대체 / 웹 배포처|결정 (ADR-023, 데모 부분)|2026-10-19|데모 기본은 Supabase 클라우드 + 정상 네트워크. 대체 경로 6종을 [[19-DEMO-SCENARIO\|19 데모 시나리오]] §5에 고정: 인터넷 실패 → 로컬 Supabase CLI(`pnpm db:start` + `pnpm demo:reset`, D-1 리허설), 공공 API 장애 → `fixture`, GPU 접속 실패 → `mock` 또는 사전 실행 run 조회, Supabase 클라우드 장애 → 로컬 CLI, 첨부 실패 → `DOCUMENT_DOWNLOAD_FAILED` 화면 그대로, 추론 시간 초과 → `PARTIAL`. 자동 fallback 없음, 화면에 모드·출처 표시, 발표에서 밝힌다. 웹 배포처는 여전히 미결정(해커톤은 노트북 1대) ([[10-DEPLOYMENT\|10 배포]])|
|9|worker가 `server-only` 도메인 코드를 쓰는 실행 방식(`node --conditions=react-server` 또는 같은 효과의 방식)|검증됨|2026-10-18|`node --conditions=react-server --import tsx worker/main.ts`로 띄운다(조건이 없으면 `server-only` 오류로 멈춘다). 2026-10-19에 Compose worker 이미지 안 기동·큐 왕복·정상 종료까지 확인해 종결했다(이미지 CMD는 ADR-024 D2). 증거 `docs/evidence/phase-0/worker-conditions.txt`·`smoke.txt`·`worker-stop.txt`·`c0-integration-20261019.md`, 커밋 `fa92254`·`d170aba` ([[02-ARCHITECTURE\|02 아키텍처]], [[10-DEPLOYMENT\|10 배포]])|
|10|Supabase Auth 세부 설정값(토큰 만료·refresh 재사용 탐지·로그인 시도 제한·비밀번호 정책)|미검증|-|Supabase 대시보드 설정으로 정하고 확인한다. 확인 전에는 값을 문서에 적지 않는다(지어내지 않는다) ([[09-SECURITY\|09 보안]])|
|11|현재 조직 고르기: 템플릿 가입 트리거는 계정마다 개인 조직을 만들고 화면은 `/[slug]/…`로 조직을 고른다. 05 `Me`·06 경로(`/dashboard`·`/bids`)는 업무 조직 하나와 slug 없는 경로를 전제한다|결정 (ADR-021)|2026-10-16|조직 주소 없는 경로. 서버가 현재 조직을 정한다(업무 멤버십 0개 안내 / 1개 진입 / 2개 이상 지원 안 함). 조직 전환 UI 없음. 가입 시 개인 조직 생성 중단, 기존 개인 조직은 보존 ([[05-API-SPEC\|05 API]] §1)|
|12|구성원 관리 권한 기준: 템플릿 RLS는 초대·역할 변경·내보내기를 `org_role=owner`만 허용, 05는 `sol_role=ADMIN`을 요구|결정 (ADR-021)|2026-10-16|구성원 관리는 `sol_role=ADMIN`. 템플릿 owner 기준 정책을 새 마이그레이션으로 바꾼다 ([[05-API-SPEC\|05 API]] §2)|
|13|가입 방식: 템플릿에는 공개 가입(`/auth/sign-up`)·간편 로그인이 있고, 설계 초안은 초대 기반이었다|채택 (ADR-018)|2026-10-16|사용자 결정: 공개 가입과 간편 로그인(구글·카카오·네이버)을 쓰고 업무 조직 합류는 초대로 한다. 공개 가입은 끄지 않는다. 개인 조직 생성은 ADR-021로 중단(11번). 남은 것: 간편 로그인 제공자 설정(후순위, [[12-ROADMAP\|12 로드맵]]) ([[09-SECURITY\|09 보안]])|
|14|로그인·로그아웃 감사 기록 지점: 로그인은 브라우저가 Supabase Auth에 직접 한다|미결정|-|`audit_logs`의 `LOGIN`·`LOGOUT`을 남길 곳(Supabase Auth Hook 등)을 정하거나 기록 대상에서 뺀다 ([[04-DATABASE\|04 DB]] §3.6)|
|15|`pg_trgm` 확장을 Supabase와 PGlite 양쪽에서 켤 수 있는지|부분 검증|2026-10-19|**PGlite 해결**: `scripts/supabase-pglite.mjs`가 `pg_trgm`을 싣고, `20261019000002_bid_notices.sql`은 확장을 깔 수 있을 때만 켠다(없으면 trigram 인덱스만 건너뛴다). C2 `pnpm test:db` 168/168 통과(`docs/evidence/phase-1/test-db.txt`). **남은 것**: Supabase 클라우드 프로젝트에서 켜지는지. 클라우드 적용(`pnpm db:push`, 사용자 확인 뒤) 때 확인 ([[04-DATABASE\|04 DB]] §5)|
|16|g2b 첨부 자동 다운로드 가능 여부(로그인·세션 요구, 이용약관상 제한)|부분 검증|2026-10-19|**검증됨**(C1 B1~B4, 2026-10-19): 공고 3건의 첨부(공고문·e발주 제안요청서)가 로그인·세션 없이 `www.g2b.go.kr` 익명 GET 200으로 받아진다. 리다이렉트·막힘 0건. **남은 것**: 나라장터 이용약관상 자동 다운로드 허용 여부(18번과 함께 법적 확인), HWP 5.0 표본. 증거 [API 호출 증거](evidence/phase-0/external-deps-api-20261019.md) §9. 막히면 본문·API 필드만으로 진행하고 `DOCUMENT_DOWNLOAD_FAILED`를 표시한다 ([[07-DATA-PIPELINE\|07 수집 파이프라인]])|
|17|회사 GPU 추론 엔드포인트의 경로·인증 방식·`/v1/models` 응답·지연|미검증|2026-10-19|ADR-025로 재정의(이전 항목 "터널 허용 여부·GPU 모델·VRAM·공유 여부"는 터널 폐기와 함께 종결. GPU 사양·배분은 회사 운영으로 이관, 3번). **결정(라우터 기준, 2026-10-19 추가 결정)**: `QWEN_BASE_URL=https://acropolissg.com/sol-radar/qwen`, `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev` — GPU 서버 안 nginx 모델 라우터(`infra/gpu/model-router.conf`)가 정한 경로. 인증은 각 런타임의 Bearer 키(`QWEN_API_KEY`·`KEV_API_KEY`). **남은 미확인**: 바깥(회사) nginx의 `/sol-radar` 접두어 처리(떼고 넘겨도 라우터가 받게 했다), 회사 측 추가 인증 여부, 실제 응답·지연. 2026-10-19 기준 엔드포인트 응답 미확인. 다음: 선행 조건 P2(회사가 경로·인증 방식 통보)·P3(회사 측 모델 기동 완료 통보) 뒤 C1 ③ G1~G6([[03-AI-PIPELINE\|03 AI 파이프라인]] §5.9)로 확인하고 이 행과 ADR-025 상세를 갱신. 막히면 사용자 보고 ([[10-DEPLOYMENT\|10 배포]])|
|18|공고 첨부 원문(공고문·제안요청서)의 저작권·재배포·학습 사용 권리|미검증|-|내부 분석·사내 학습에만 사용. 외부 공개·데이터셋 배포 전 법무 확인 ([[21-MODEL-TRAINING\|21 모델 학습]], [[09-SECURITY\|09 보안]])|
|19|면허제한 오퍼레이션의 여러 행이 AND인지 OR인지|미검증|-|실제 응답 확인 전에는 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`) ([[08-SCORING\|08 점수]])|
|20|문서 파서 형식별 선택(HWP·HWPX·PDF)|미결정|-|미결정 4번과 같은 절차. 실제 RFP 샘플 비교 결과로 형식마다 정하고 이 행을 갱신 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §10)|
|21|Phase 0 중 발견한 정본 불일치 목록 정리(26건)|제안|2026-10-19|[Phase 0 정본 불일치 목록](plans/2026-10-19-phase-0-doc-inconsistencies.md). 항목마다 사람이 어느 쪽이 맞는지 정한 뒤 해당 정본을 고친다. 구현은 항목별 "구현 방식" 열에 적었다. 일부는 Phase 4·5 골든 확정과 함께 정한다. #1·#2·#3·#4·#7은 ADR-029(2026-10-19 사용자 결정, #7은 A6 D2)로 해결했다|
|22|회사 GPU에서 Kev-9B LoRA 학습(F1·F2·F3) 실행 가능 여부·주말(10-24~25) 시간대·추론과 동시 점유·일요일 서버 안 채점 4회 실행과 출력 폴더 전송|일부 확인 (2026-10-20 서버 환경. 실행 가능 여부는 F1 전까지 미검증)|2026-10-20|ADR-027(개정). **2026-10-20 확인**(ADR-027 상세 부록): A40 46,068 MiB ×3 중 물리 GPU 1(가용 44.16 GiB)이 SOL RADAR 전용이고 GPU 0·2는 회사 서비스. venv `.venv-kev`(Python 3.12.3)·torch 2.8.0+cu128·CUDA·bf16 확인. **남은 미검증**: Kev 설치·커널·F1 실행 가능 여부(F1 결과로만 확정), 토·일 GPU 1 독점 가능 여부·시간대, 추론 런타임을 띄울 GPU, 외부망(Hugging Face·GitHub·PyPI), 일요일 채점 실행·출력 전송. C1 P2·P3 요청과 함께 회사에 묻는다(질문 목록은 [[23-WEEKEND-FINETUNE\|23]] §8, 기한 10-22). E4 평가 방식은 오프라인 채점으로 개정됐다(ADR-027 10번. 평가 전용 `kev.serve` 8010·`/kev-lora` 경로는 필요 없다)|

검증 전에는 명세 가정으로 표시하고 기능 플래그·mock·fixture로 개발한다.

## ADR-019 상세 — 솔리데오 고정·가상 인력·가입 신고 정보

2026-10-16 인터뷰 후 사용자 최종 승인. 아래는 **설계 결정**이다. 구현 상태는 위 행과 [[PROGRESS]]에 있다. 승인 스펙은 [솔리데오 인력·가입](../polaris/specs/planned/2026-10-16-solideo-people-signup.md)이다.

- 사용자 회사명은 솔리데오로 고정하고 회사 선택을 만들지 않는다. `org-01`은 해당 업무 조직, `org-02`는 숨겨진 RLS 격리 시험용이다. 공개 가입 + 초대 합류(ADR-018), 조직 격리는 유지한다. ADR-021로 가입 시 개인 조직 생성은 중단하고, 이미 있는 개인 조직은 지우지 않는다.
- 직원 명부는 가상 200명(남성 100·여성 100), Auth 5계정과 분리한다. 엑셀의 같은 팀명은 합산하고 원본 인원 비율에 따라 각 팀 최소 1명, 총 200명으로 배분한다.
- 한국 이름은 실제 사용되는 이름 통계를 참고한 한글 세 글자로, 내부 중복·원본 이름 일치는 0이다. 원본 엑셀은 저장소 밖이며 원본 실명·연락처·대응표는 저장하지 않는다.
- 부서·직급·인물·사진 manifest의 정본은 `fixtures/people/solideo.{departments,job-titles,people,portraits}.json`이다. 사진은 imagegen 기본 내장 도구로 서로 다른 가상 정장 얼굴 200장을 만들고 `web/public/demo/people/<personId>.png`에 둔다. 공개 사진은 가상 자산만이며 MinIO 사설 첨부 정책은 유지한다.
- 이메일 가입은 솔리데오 부서와 엑셀 표현 그대로인 `직급/직책`을 필수로 고른다. 간편 가입·기존 미완료 계정은 첫 로그인에 보완한다. 신고 정보는 `profiles`에 검증해 저장하고 부서·직급 선택으로 멤버십·권한을 만들지 않는다. 직무·기술등급·업무 권한과도 구분한다.
- 기존 점수·데모 수치의 정합성을 위해 전체 200명 안의 가상 계산 하위 27명·가용 20 FTE를 명시하고 골든 94/72/68을 유지한다. 회사명·부서/직급 외의 직원·자격·실적·재무는 실제 회사 정보로 소개하지 않는다.
- 검증은 [[11-TESTING]] PPL-01~07. PPL-01~06은 통과 기록이 있고([[11-TESTING]] §8·§9.1·§10), PPL-07의 전체 점수 파이프라인 골든은 Phase 4에 남아 있다.

## ADR-020 상세 — 실데이터 MVP와 AI 파이프라인 v0.2

2026-10-16 사용자 대화로 정했고 승인 설계는 [실데이터 AI 파이프라인 v0.2](plans/2026-10-16-ai-pipeline-finetune-design.md)다. 아래는 **설계 결정**이다.

- **실행 모드**: `SOL_RUN_MODE=live|fixture|mock`(기본 `mock`). `live` = 나라장터 Open API + 실제 AI, `fixture` = fixture 20건 + 실제 AI, `mock` = fixture 20건 + mock AI. 모드와 모순된 env는 기동 거부. 데이터 출처(`source`·`is_demo`)와 분석 모드(`score_runs.run_mode`·`ai_provider`·모델 이름)를 기록하고 화면에 표시한다. 골든은 `mock` 모드에서만 단언한다 ([[03-AI-PIPELINE|03]], [[10-DEPLOYMENT|10]]).
- **회사 프로필**: 모든 모드에서 가상 솔리데오 프로필(`is_demo=true`)이다. live 분석은 "실제 공고 × 가상 회사 프로필"이고 화면에 배지를 붙인다(ADR-019, [[09-SECURITY|09 보안]]).
- **수집**: 입찰공고정보서비스(용역, `infoBizYn=Y` 정보화사업. 2026-10-19 ADR-029 A4로 정보화사업 필터를 넓혔다)·면허제한·참가가능지역·e발주 첨부, 사전규격, 발주계획, 업종 코드 마스터. 첨부는 `www.g2b.go.kr` allowlist로 내려받고, 형식별 `DocumentParser`로 파싱한다. 같은 조건이면 API 구조화 필드가 Qwen 추출보다 우선이고, 다르면 `CONFLICTED`다 ([[07-DATA-PIPELINE|07]], [[15-DATA-CONTRACTS|15]]).
- **실패 유형**: 공공 API 실패·첨부 다운로드 불가·파싱 실패·모델 서버 미접속(Qwen·Kev 따로)을 구분해 기록·표시한다. 실패한 단계의 내용을 AI가 추측해 채우지 않는다. mock 자동 대체는 기본 금지이고, `AI_FALLBACK_TO_MOCK=true`(live 금지)로 켰을 때만 `MOCK_FALLBACK`과 배너로 명시한다.
- **모델 역할**: Qwen3.5-9B = 구조화 추출·영어 표기·근거 설명(`/explain`). Kev-9B@v1.0 = 요구사항별 충족/미충족/확인 필요, 기술 적합성, 실적 연관성, 수행 리스크(`kev-qs/v0.2`, v0.1 유지). 규칙 엔진 = 명시 조건. SOL Score = `sol-v0.1.0` 그대로. **Kev 확률은 점수 입력이 아니며** 참고 지표와 `reviewFlags`로만 표시한다. 점수 반영은 평가셋 검증 뒤 `sol-v0.2.x`와 새 ADR로 정한다 ([[08-SCORING|08]]).
- **근거 추적**: 공고 쪽 `EvidenceRef`에 회사 쪽 `CompanyEvidenceRef`를 더하고, Kev state 줄마다 출처를 기록하는 `KevStateTrace`를 저장한다 ([[15-DATA-CONTRACTS|15]]).
- **라벨**: `SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW` + 사유 코드. 미충족에는 공고·회사 양쪽 근거가 필요하고, 정보 부족은 미충족이 아니다 ([[08-SCORING|08]]).
- **실추론 위치**: 회사 GPU 서버(vLLM + `kev.serve`)이고, 노트북 gateway는 회사가 제공하는 HTTPS 엔드포인트 `https://acropolissg.com/sol-radar`에 붙는다(ADR-025, 2026-10-19. 처음 정한 터널·`127.0.0.1` 바인딩 연결은 폐기). 클라우드 GPU 임대는 ADR-010과 같은 비용 승인 대상이다 ([[10-DEPLOYMENT|10]]).
- **평가·파인튜닝**: 평가셋은 실제 공고 × 가상 기업 원형 6개, test 20·dev 10 사업, 사업 단위 분할. 지표·오류 분석·내보내기·LoRA 메모리 검증은 [[21-MODEL-TRAINING|21 모델 학습]]. 초기 목표(Macro-F1 0.80, 정보부족→미충족 혼동률 5%, 보정 후 ECE 0.08)에 미달해도 자동으로 파인튜닝하지 않는다. 오류 분석에서 모델 판단 오류가 주된 원인일 때 사람이 결정한다. Kev-9B LoRA 운영 반영은 해커톤 완료 조건이 아니다(학습·E4 비교 실험은 ADR-027 X6). 실제 낙찰 결과는 학습 목표로 쓰지 않는다.
- **모델 버전**: `services/ai/models/registry.yaml` + sha256 + 기동 시 `/v1/models` 대조. 불일치면 gateway 기동 거부(`kev.serve`가 경로 오류를 `runs/smoke`로 조용히 대체하기 때문).
- **해커톤 순서**: P0-0 외부 의존성 조기 점검(실제 API 응답·첨부 다운로드·GPU 엔드포인트·파서 비교) → P0-1~P0-11을 Phase 0~7에 배치([[12-ROADMAP|12 로드맵]]). 서비스키·GPU가 준비되기 전에는 인터페이스(`BidSourceConnector`·`AttachmentFetcher`·`DocumentParser`·`ModelClient`)로 나머지를 진행한다.
- 개정한 결정: ADR-004(참고 지표 표시 허용), ADR-008(해커톤 목표는 `live`), ADR-012(한국어 state는 평가 전용). 영향 받은 미결정: 1·3·4번 갱신, 16~20번 추가.

## ADR-021 상세 — 사이드바 정보 구조와 입찰 업무 확장

2026-10-16 사용자가 네 차례에 걸쳐 승인했고 승인 설계는 [사이드바 정보 구조와 입찰 업무 확장](plans/2026-10-16-sidebar-ia-design.md)이다. 입력은 사용자 계획서 [[SIDEBAR-PLAN]]이다. 아래는 **설계 결정**이다.

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

2026-10-18 사용자 결정이다. 아래는 **설계 결정**이다.

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
- **값 형식**: 포털이 Encoding 키(URL 인코딩된 값)만 제공하므로(2026-10-19 사용자 확인) env에는 Encoding 키를 그대로 넣는다. worker의 `readG2bServiceKey`(`web/worker/env.ts`)가 `decodeURIComponent`로 한 번 디코딩해 Decoding 키로 만들고, Connector가 그 값을 URL 인코딩 한 번만 한다. Decoding 키를 넣어도 결과는 같다. Encoding 키 경로는 C1 실제 호출(2026-10-19)에서 확인했다([API 호출 증거](evidence/phase-0/external-deps-api-20261019.md) §1). 2026-10-18 채택 당시의 "Decoding 키를 넣는다"를 대체한다.
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
- **외부 의존성 컷 규칙**(10-20 저녁, C1 결과 기준. ADR-027으로 하루 당겼다. 핵심 기능 개발은 계속한다): API·GPU 모두 정상 → 실공고·실추론 유지 / API 정상·GPU 불가 → 실공고에 규칙만 `PARTIAL` / API 불가·GPU 정상 → 검증된 fixture로 실추론 시연 / 둘 다 불가 → fixture·mock 시연과 사전 확보한 검증 증거만. 어느 경우든 실행 모드와 출처를 화면·발표에 표시한다.
- **네트워크 대체 경로**: 미결정 8번 참조. 자동 fallback·원본 위조 기능은 추가하지 않는다.
- **제출물**: 슬라이드·3분 영상·기술 자료 구조를 지금부터 병렬로 준비한다(`docs/submission/`). 미구현 화면을 완성품으로, 미검증 수치를 성과로 쓰지 않는다.
- 영향 받은 문서: 01·06·10·11·12·17·18·19·21. 05는 `feat/people-read` 병합 뒤 반영한다.

## ADR-024 상세 — Phase 0 실행 환경 결정

상태는 **제안**이다. [Phase 0 계획](plans/2026-10-18-phase-0-infra.md)의 결정 D1~D15를 추천안으로 두고 구현했고(사용자 "1번으로 진행", 2026-10-18), 구현 중 정해진 값을 같이 적는다. 코드는 main `1b824c8`(최종 `88afb79`), Compose 프로젝트 이름 변경은 `9b2bdf1`이다. 채택·수정·폐기는 사람이 정한다. 결과 문서는 [[10-DEPLOYMENT|10 배포]]·[[07-DATA-PIPELINE|07 수집]] §6.5다.

|ID|결정|구현 결과|
|---|---|---|
|D1|web은 호스트에서 `pnpm -C web start`로 띄운다. Compose에 `web` 서비스는 없다|`infra/compose.yaml`은 redis·minio·qdrant·ai-gateway·worker 5개|
|D2|worker 실행은 `node --conditions=react-server --import tsx worker/main.ts`|이미지 CMD도 `node` 직접(pnpm 은 마지막 줄을 덮고 SIGTERM 전달이 불확실), Compose `init: true`|
|D3|worker health는 heartbeat 파일|`WORKER_HEARTBEAT_FILE`(기본 `/tmp/sol-worker-heartbeat`), 10초마다 갱신, healthcheck가 30초 이내인지 판정|
|D4|`AI_PROVIDER=hosted`는 `live`·`fixture`에서 `AI_HOSTED_APPROVED=true`일 때만|`infra/run-modes.json`과 gateway가 같이 거부. 정본 03 모드 표에는 hosted가 없어 보충한 규칙이다|
|D5|서비스키 4개(ADR-022)는 `live`에서만 필수|demo env 예시에는 줄이 없고 ai-local 예시에 `CHANGE_ME`. worker의 빠진 키 알림은 Phase 2|
|D6|mock 모드의 `KEV_ENABLED=true`(mock adapter가 응답)|10 프로필 표와 일치. 기본값이 `true`이고, 세 모드 모두 `false`도 허용한다(`infra/run-modes.json` main `daf07a6`). 불일치 목록 4번은 ADR-029 A5로 해결|
|D7|실행 모드 규칙 원천은 `infra/run-modes.json` 하나|Node `scripts/run-mode.mjs`와 Python `services/ai`가 같이 읽는다(판정 19,440 입력 불일치 0). gateway 이미지는 저장소 루트를 빌드 컨텍스트로 쓰고 `SOL_RUN_MODES_FILE`로 복사본을 가리킨다. 실행 모드 env의 빈 문자열은 미지정(모드 기본값)|
|D8|`infra/compose.gpu.yaml`과 ai-local 실기동은 P0-0 때|Phase 0은 `infra/env/ai-local.env.example`과 터널 절차만(2026-10-19 ADR-025로 터널 전제를 폐기. `compose.gpu.yaml`은 회사 GPU 서버용 참고 구성으로 남고, ai-local 실기동은 회사 엔드포인트 접속 확인으로 바뀐다)|
|D9|첨부 샘플 `fixtures/docs/`는 Phase 2|Phase 0 추출의 인용은 공고 본문만 가리킨다|
|D10|mock Kev 4건·골든 3건|나머지 Kev 16건·골든 17건은 Phase 4|
|D11|추출 fixture는 20개 파일(19건 + `FX-07.r01`)|계획은 19건이었으나 `FX-07` r1 추출을 더했다(19 S5 사전 분석과 맞춤). 처음에는 04 `requirement_extractions` seed 20행과 맞췄으나, ADR-031 C16으로 seed가 추출을 넣지 않게 되어 seed 행 수는 0이다. 파일 20개는 gateway mock이 읽는 정본으로 그대로다|
|D12|`FX-20`은 `SEED` 배치|19:44의 `LIVE` 표기는 불일치 목록 9번|
|D13|CI는 `astral-sh/setup-uv`(SHA 고정) 단계|`.github/workflows/ci.yml`에 넣었다. 실제 실행 통과는 미확인([[PROGRESS]])|
|D14|lodestar `worker` 층(`worker/**` → domain·infra·shared)|`web/lodestar.config.ts`|
|D15|템플릿 정리는 Phase 3 N1에서|Phase 0에서는 지우지 않는다(`/health`와 slug `health` 조직의 경로 겹침 포함)|
|-|redis 호스트 포트 기본 6380|사용자 결정. 호스트에 다른 redis가 6379를 쓴다. 호스트 포트는 `REDIS_HOST_PORT`·`MINIO_HOST_PORT`·`QDRANT_HOST_PORT`·`AI_GATEWAY_HOST_PORT`로 바꿀 수 있고 항상 `127.0.0.1`에만 열린다|
|-|Compose 프로젝트 이름 `sol-radar-stack`|로컬 Supabase CLI가 `supabase/config.toml`의 `project_id`(`sol-radar`)를 같은 Compose 라벨로 써서, 같은 이름이면 서로를 orphan으로 보고 `--remove-orphans`가 상대 컨테이너를 지울 수 있다(`9b2bdf1`)|
|-|placeholder 토큰은 `CHANGE_ME` 하나, `minioadmin` 금지, Redis 비밀번호는 영숫자만|`pnpm check:env`가 검사. MinIO 사용자 3자 이상·비밀번호 8자 이상|
|-|Redis 비밀번호는 argv·`docker inspect`에 남기지 않는다|`requirepass`는 stdin 설정으로, healthcheck·smoke는 `REDISCLI_AUTH`로 전달. redis는 `setpriv`로 `redis` 사용자로 내려 실행(root 실행 방지)|

> [!warning] 미검증 가정
> - `checks.db`는 로컬 Supabase CLI 스택 기준으로만 확인했다. Supabase 클라우드 프로젝트 연결은 확인하지 않았다.
> - GitHub Actions CI(`setup-uv` 포함)의 실제 통과는 D13과 같이 미확인이다.
> - ai-local 실기동(D8)은 ADR-025로 터널 전제를 폐기했다. 노트북 gateway 컨테이너에서 회사 HTTPS 엔드포인트로 나가는 경로와 `/v1/models` 응답은 C1 ③ G1·G2에서 확인한다.

## ADR-025 상세 — 회사 GPU 추론 엔드포인트

상태는 **채택**이다(사용자 결정 2026-10-19). 엔드포인트는 회사가 제공 예정이며 2026-10-19 기준 응답을 아직 확인하지 않았다. ADR-020의 "실추론 위치" 중 연결 방식만 바꾸고, 아키텍처·실행 모드·장애 처리·데이터 경계는 그대로다. 반영 문서는 [[10-DEPLOYMENT|10 배포]]·[[03-AI-PIPELINE|03 AI 파이프라인]] §5.9·[[02-ARCHITECTURE|02 아키텍처]]·[[09-SECURITY|09 보안]]이다.

1. **연결 방식**: 회사 GPU 서버는 외부에서 접근할 수 없다(SSH·VPN 터널 불가). 회사가 모델 런타임(vLLM Qwen3.5-9B, `kev.serve` Kev-9B@v1.0)을 HTTPS 엔드포인트 **`https://acropolissg.com/sol-radar`** 아래로 제공한다. 데모 노트북의 ai-gateway는 이 엔드포인트에 HTTPS로 붙는다. SSH 로컬 포트포워딩, GPU 서버 `127.0.0.1:8001`·`127.0.0.1:8009` 바인딩, 노트북 `host.docker.internal` 끝점 전제는 폐기한다. 아키텍처(Worker → gateway → 모델)와 실행 모드(`live`·`fixture`·`mock`)·`AI_PROVIDER=local`은 그대로다.
2. **env**: 이름은 유지한다 — `QWEN_BASE_URL`·`KEV_BASE_URL`·`QWEN_API_KEY`·`KEV_API_KEY`. 값은 엔드포인트 아래 경로다. vLLM과 `kev.serve`가 각각 `/v1/models`를 가지므로 경로를 나눈다 — `QWEN_BASE_URL=https://acropolissg.com/sol-radar/qwen`, `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev`. 이 경로는 아래 2-1의 모델 라우터가 정하므로 **결정(라우터 기준)**이다(처음엔 가정이었다, 2026-10-19 추가 결정). 남은 미확인은 바깥 nginx의 접두어 처리·회사 측 추가 인증 여부(Bearer 키 외)·실제 응답이고, 회사가 알려 주는 값이 다르면 그때 이 절을 갱신한다.
   - **2-1. 모델 라우터(추가 결정 2026-10-19)**: 회사 nginx는 location 하나(`https://acropolissg.com/sol-radar`)만 등록할 수 있어, GPU 서버 안에 경로 분기용 nginx 라우터를 둔다. 설정은 `infra/gpu/model-router.conf`(`127.0.0.1:8080` 바인딩). `/sol-radar/qwen/<path>` → vLLM `127.0.0.1:8001/<path>`, `/sol-radar/kev/<path>` → `kev.serve` `127.0.0.1:8009/<path>`. 바깥 nginx가 `/sol-radar` 접두어를 떼고 넘겨도(`/qwen/…`·`/kev/…`) 같은 곳으로 간다. `/sol-radar/healthz`(인증 없음)는 라우터 자체 확인용으로 `200 ok`, 그 외 404. 인증은 라우터가 아니라 각 런타임이 한다(`Authorization` 헤더 통과, 로그에는 `$uri`만 기록).
   - **2-2. 실행**: `infra/compose.gpu.yaml`(`name: sol-radar-gpu`, 서비스 `model-router` = `nginx:1.27-alpine`, `network_mode: host`, Linux 전용). vLLM·`kev.serve`는 [[10-DEPLOYMENT|10 배포]]의 명령으로 호스트 `127.0.0.1:8001`·`127.0.0.1:8009`에 직접 띄운다. 두 런타임의 컨테이너 구성(kev·qwen-runtime)은 빌드 검증 전이라 `compose.gpu.yaml`에 넣지 않았다(10의 참고 스케치는 2026-10-19 문서 정리에서 지웠다).
   - **2-3. 회사 nginx에 요청할 설정**: `location /sol-radar/ { proxy_pass http://127.0.0.1:8080; }` + `Authorization` 헤더 통과, `proxy_read_timeout 300s`(기본 60s면 긴 RFP 추출이 504), `client_max_body_size 20m`(기본 1m면 413), `proxy_buffering off`. 인수 문서는 `infra/gpu/README.md`.
   - 검증(2026-10-19): `docker run --rm -v "$PWD/infra/gpu/model-router.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t` 통과, `docker compose -f infra/compose.gpu.yaml config --quiet` 통과. 실제 GPU 서버 기동은 미실행.
3. **운영 책임**: 모델 런타임 기동·GPU 메모리 배분·가중치 sha256 대조·`nvidia-smi` 실측은 회사 측이 한다. 우리는 하지 않는다. 우리가 하는 검증은 gateway 기동 시 Kev `GET /v1/models`의 `run`·`base`·`lora`·`temperature`와 vLLM `GET /v1/models`의 모델 이름을 레지스트리(`services/ai/models/registry.yaml`)와 대조하는 것([[03-AI-PIPELINE|03]] §11, 그대로)과 지연 실측이다. VRAM·가중치 다운로드 시간은 회사가 주는 값이 있으면 적고 없으면 "회사 운영, 측정 불가"로 남긴다. `infra/compose.gpu.yaml`(모델 라우터)·`infra/gpu/`·Kev Dockerfile 스케치·vLLM 기동 명령은 회사 GPU 서버용 **참고 구성**으로 남기되 우리가 기동하지 않는다. 사용자 승인 항목이던 "모델 기동·GPU 점유 승인"은 회사 운영이라 더 이상 필요 없다.
4. **장애 처리**: 엔드포인트 미접속의 처리는 터널 때와 같다 — gateway가 `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록하고 `PARTIAL`·`RULES_ONLY`로 끝낸다. 자동 mock 대체 없음, 필요하면 사람이 `mock`으로 전환. 리허설은 엔드포인트 재접속 확인(`GET /v1/models` curl)이다([[20-GLOSSARY|20 용어집]]).
5. **보안**: 엔드포인트는 공개 인터넷에 있으므로 TLS 필수(인증서 검증을 끄지 않는다), API 키(`QWEN_API_KEY`·`KEV_API_KEY`) 필수, 키는 `infra/.env`에만 둔다. 회사 GPU로 가는 데이터 경계(실제 공고의 개인정보 마스킹 + 가상 회사 프로필만, Supabase 키·사용자 정보 없음)는 그대로다. 엔드포인트 URL은 비밀이 아니라 문서에 적어도 되지만 키 값은 적지 않는다([[09-SECURITY|09 보안]]).
6. **평가·학습([[21-MODEL-TRAINING|21]])**: `sol_eval`은 GPU 서버가 아니라 노트북에서 엔드포인트(Kev는 `KEV_BASE_URL` 직접 또는 평가용 gateway)에 붙여 돌린다. LoRA 메모리 검증(F1 `probe-train`)은 GPU 서버 셸이 필요하므로 회사 측 실행 요청 사항으로 남긴다(해커톤에는 ADR-027 X6로 F1·F2·F3을 회사에 요청한다).
7. **C1 ③ 재정의**: G1 엔드포인트 HTTPS 접속(`GET /sol-radar/healthz` 200 + TLS 유효, `-k` 금지) → G2 Qwen·Kev `GET /v1/models` 응답과 레지스트리 대조 → G3 지연 실측(Kev state 약 500토큰 10회 p50·p95, Qwen 추출 1회, 왕복 포함) → G4 vLLM guided JSON 동작 → G5 회사 제공 GPU 정보(모델·VRAM·점유)가 있으면 기록 → G6 엔드포인트 차단 시 `PARTIAL` 경로 확인. 선행 조건: P2 = 회사가 엔드포인트 경로·인증 방식을 알려 줌, P3 = 회사 측 모델 기동 완료 통보. 외부 의존성 컷 규칙(ADR-023·027)의 "GPU 정상" = G2·G3 통과.
8. **미결정 갱신**: 17번을 "회사 엔드포인트 경로·인증·`/v1/models` 응답·지연"으로 재정의했다. 3번의 GPU 메모리 배분은 회사 측 결정으로 이관했고 우리 쪽 남은 결정은 없다.

> [!warning] 미검증 가정 (2026-10-19)
> - 엔드포인트 응답 미확인. 경로(`/qwen`·`/kev`)는 우리 라우터 기준으로 정했고, 바깥 nginx의 접두어 처리·회사 측 추가 인증 여부(Bearer 키 외)·실제 응답은 미확인이다. 회사가 알려 주는 값이 다르면 바꾼다.
> - 노트북 `ai-gateway` 컨테이너에서 공개 인터넷 HTTPS로 나가는 경로(데모 장소 회선·프록시)는 C1 ③ G1에서 확인한다.

## ADR-026 상세 — 팀 만들기는 서비스 운영자만

- **결정**(사용자 2026-10-19, 추천안 채택): `organizations` insert 정책 "팀 만들기"를 `with check (personal_owner_id is null and public.is_admin())`로 바꾼다(`supabase/migrations/20261019000008_team_creation_operator_only.sql`). 정지된 운영자는 `is_admin()`이 false라 만들지 못한다. 열 권한(`slug`·`name`), `add_team_owner`(만든 사람 owner+ADMIN, ADR-021), 개인 조직 금지 검사는 그대로다.
- **이유**: 04 §3.6의 운영 표(`ingest_runs`·`ingest_errors`·`eval_runs`)는 조직 데이터가 아니라 "어느 조직에서든 ADMIN"이 읽는다. 템플릿처럼 누구나 팀을 만들면 가입만 한 사람이 자기 팀의 ADMIN이 되어 운영 표를 읽는다. 업무 조직 합류는 초대로만 하므로(ADR-018·021) 일반 회원이 팀을 만들 이유가 없다. 대안(운영 표 읽기를 `is_demo` 조직 ADMIN으로 좁히기, 위험 수용)보다 단순하고 되돌리기 쉽다.
- **영향**: 템플릿 "팀 만들기" 화면(`/teams/new`)은 운영자가 아니면 RLS 거절을 받는다. 해커톤 화면 범위에 없으니 메뉴에서 빼거나 안내만 한다(C6에서 정한다). 템플릿 로컬 seed(`scripts/db-seed.mjs`)처럼 사용자 토큰으로 팀을 만드는 경로는 막히므로 `pnpm demo:reset`은 service role로 조직을 만들고, `pnpm db:seed`도 시드 팀을 관리 키로 만든 뒤 소유자 멤버십(owner+ADMIN)을 직접 넣는다(빈 DB에서 RLS 403이 나던 결함을 2026-10-19에 고침, 회귀 시험 `scripts/db-seed.test.mjs`). 로그인 뒤 E2E(`web/e2e-auth`)의 팀 만들기 시나리오는 운영자 계정으로 바꾼다(확장 컷·P1).
- **되돌리기**: 새 마이그레이션으로 정책을 템플릿 본문(`with check (personal_owner_id is null)`)으로 다시 만든다.
- **검증**: C2 2단계 정책 시험 — 일반 회원 팀 insert 거절, 운영자 통과(owner+ADMIN), 정지된 운영자 거절, 마이그레이션 재실행 스냅샷 유지([[11-TESTING|11 테스트]] §4 Phase 1).

## ADR-027 상세 — Kev-9B LoRA 해커톤 파인튜닝과 일정 2일 당김

상태는 **채택**이다(사용자 결정 2026-10-19). E4 서빙 경로(10번)와 라벨 담당(11번)도 같은 날 사용자가 정했다. **개정(2026-10-19 저녁, 사용자 결정)**: 회사 nginx 가 `https://acropolissg.com/sol-radar` location 하나만 등록할 수 있다는 제약을 확인하고, 10번(E4 서빙)을 서버 안 오프라인 채점으로 바꾸고 5번 일정에 주말 실행(10-24~25)을 더했다. 계획은 [[23-WEEKEND-FINETUNE|23 주말 파인튜닝 계획]]이다. 근거와 교체안은 [변경안](plans/2026-10-19-finetune-schedule-pull.md)에 있다. ADR-023의 3단 컷(핵심·확장·P1)과 ADR-025의 실행 책임은 그대로 둔다. 이 ADR은 파인튜닝 트랙 X6를 더하고 일정을 당긴다.

1. **범위**: Kev-9B@v1.0에서 이어 학습하는 LoRA(`--init_from jaredpalmer/kev-9b@v1.0`, `en` state)만 한다. 순서는 X6a 평가셋 v0.1(test 20·dev 10 사업, P0-9) → X6b 학습셋 번들(train 1,000 레코드 이상)·학습 요청서(P0-11) → X6c F1 메모리 검증 → X6d F2 학습 → X6e F3 dev 온도 보정과 E4 평가 → X6f 제출물 반영. Qwen 파인튜닝과 `ko` LoRA는 후속이다.
2. **위상**: E4 비교 결과를 제출한다. 데모·S-LIVE 모델과 레지스트리 서빙 항목은 Kev-9B@v1.0 그대로다. 우리 쪽 산출물(평가셋·번들·요청서·E4 하네스)은 완료 조건이다. 회사의 학습 결과는 받으면 E4로 보고하고, 못 받으면 받지 못한 단계와 이유를 적는다. 결과 수치에는 통과 기준을 두지 않는다. E4가 E1보다 낫다고 말하려면 Δ의 95% CI가 0을 포함하지 않아야 한다.
3. **21 §4.4와의 관계**: X6의 학습은 사용자 결정으로 하는 비교 실험이다. 그래서 §4.4의 착수 조건(목표 미달, `MODEL` 원인 비중, 학습 데이터로 보완 가능)을 기다리지 않는다. 운영 반영(레지스트리 서빙 항목 교체, 데모 모델 교체, SOL Score 반영)은 §4.4와 별도 ADR을 그대로 따른다. 학습셋에는 test·dev 클러스터를 넣지 않는다(누수 0건).
4. **실행 위치**: ADR-025 §3·§6 그대로다. F1·F2·F3 실행과 GPU 배분은 회사가 한다. 우리는 번들·명령·요청서를 넘기고 노트북에서 평가한다. 회사 GPU로 가는 데이터의 경계(공공 공고는 개인정보 마스킹, 회사는 가상 기업만)도 그대로다. 클라우드 GPU 임대는 ADR-010대로 사용자 승인 전에는 하지 않는다.
5. **일정**: [[12-ROADMAP|12 로드맵]] Critical Path 표가 정본이다. 10-19 이전으로는 당기지 않는다. C1 ③은 회사 응답을 기다리므로 그대로 두고, 외부 의존성 컷 판단만 10-21 저녁에서 10-20 저녁으로 하루 당긴다. 이름도 날짜 없는 "외부 의존성 컷 규칙"으로 바꾼다. **개정(2026-10-19 저녁)**: 회사 GPU 학습은 주말에 한다 — X6c F1·X6d F2 10-24(토), X6e F3·서버 안 채점·E4 10-25(일), X6f 10-26(월). X6b 번들 마감은 10-22(수). 12 간트를 이에 맞춘다([[23-WEEKEND-FINETUNE|23]] §1).
6. **게이트**: X6는 ADR-023 3단 게이트의 확장 컷이 아니다. 핵심 컷과 나란히 돌고, 작업자가 겹치면 핵심 컷이 먼저다. 핵심 컷 green 판정은 X6 결과를 기다리지 않는다.
7. **freeze 예외**: 10-23 freeze 뒤에도 E4 학습본 레지스트리 항목(체크포인트 sha256·리포트 경로 기록용)은 더할 수 있다. 데모 gateway 설정과 `kev-9b-v1.0` 항목은 바꾸지 않는다.
8. **대체되는 문서**: [수상 전략 계획](plans/2026-10-18-hackathon-award-plan.md)의 §4 일정과 §6 "Kev LoRA" 줄은 이 ADR로 대체한다. 승인된 그 문서는 고치지 않는다.
9. **미결정**: 22번을 더한다(회사 GPU의 학습 실행 가능 여부·주말 시간대·동시 점유·일요일 서버 안 채점 실행과 출력 전송).
10. **E4 평가 방식(개정 2026-10-19 저녁. 처음 결정 "평가 전용 `kev.serve` 8010 + 라우터 `/sol-radar/kev-lora/`"를 대체)**: 회사 nginx 는 location 하나(`https://acropolissg.com/sol-radar`)만 등록할 수 있다. 학습본은 HTTPS 로 서빙하지 않는다. 회사가 일요일에 서버 안에서 학습본과 v1.0 을 같은 test 파일로 `kev.benchmark`(`--rotations 6`) 채점하고 `kev.compare`·`decision-v7` regression 까지 돌린 뒤 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`)를 통째로 넘긴다. 우리 `sol_eval` 은 그 출력을 읽어 오프라인으로 지표·Δ·95% CI 를 낸다. 평가 전용 `kev.serve`(`127.0.0.1:8010`)·라우터 `/sol-radar/kev-lora/` 경로·추가 GPU 메모리는 **필요 없다**. 지연·`permute` 실측이 꼭 필요할 때만 B안으로 우리 `infra/gpu/model-router.conf` 에 경로를 더하고 8010 을 띄운다(회사 nginx 는 손대지 않는다). 요청당 지연은 E4 에서 재지 않고 순서 민감도는 `--rotations` 로 잰다. 돌려받은 `report.json` 의 체크포인트 id·test 파일 sha256 을 번들 manifest 와 대조하고 다르면 쓰지 않는다. 데모 gateway 의 `KEV_BASE_URL`(`/kev`, v1.0)과 레지스트리 서빙 항목은 바꾸지 않는다. 상세는 [[23-WEEKEND-FINETUNE|23]] §2.
11. **라벨 담당**: X6a 사람 라벨(test 20 추출 정답, 의미 대응 150건 이상)은 사용자가 직접 한다. 두 번째 라벨러가 없으면 Cohen κ가 빠졌다고 리포트에 적는다.

**부록 — 회사 GPU 환경 확인(2026-10-20, 운영 사실 기록. 결정 1~11은 바뀌지 않는다)**: 사용자가 회사 GPU 서버 셸(호스트 `sol-NF5280M6`, 계정 `bim`, 경로 `/data/www/ai_workspace/sol-radar`)에서 확인했다. NVIDIA A40 46,068 MiB **3장**(드라이버 580.173.02, CUDA Toolkit 12.8). GPU 0(4,747 MiB 사용 중)·GPU 2(9,240 MiB 사용 중)는 회사 기존 서비스가 써서 **쓰지 않고 그 프로세스를 종료·이동·설정 변경하지 않는다**. GPU 1(5 MiB 사용 중, Compute Capability 8.6)이 SOL RADAR 학습·채점(F1·F2·F3·E4) 전용이고, `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`로 프로세스 안 `cuda:0`으로 쓴다. venv `.venv-kev`(Python 3.12.3)에 torch 2.8.0+cu128·triton 3.4.0이 있고 CUDA·bf16·가용 44.16 GiB(총 44.42 GiB)를 확인했다. 3장의 VRAM을 합산하지 않고 다중 GPU 학습·80 GB GPU·H100/H200을 전제하지 않는다. 이 사실은 4번(실행 위치·GPU 배분은 회사)을 바꾸지 않고 구체화한다. Kev 설치·커널·모델 다운로드·F1~E4는 **미실행**이고 학습 가능 여부는 F1 결과로만 확정한다. F1 실패 시 Kev-4B 전환·다중 GPU·클라우드 GPU는 자동이 아니라 사용자 승인 대상이다([[22-FINETUNE-RUNBOOK|22]] §3.1·§4.2, [[23-WEEKEND-FINETUNE|23]] §2.4, [F1 기록](evidence/kev-train-feasibility.md) §0, 스크립트 `infra/gpu/kev-preflight.sh`·`infra/gpu/kev-f1.sh`).

학습 실행 절차(모델 출처·환경·데이터 제작·명령·반입)는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]에 있다. Qwen 파인튜닝은 방법만 22 §5에 두고 실행은 21 §5.6 조건과 별도 결정을 따른다.

> [!warning] 미검증 가정 (2026-10-19, 2026-10-20 갱신)
> - 서버 셸·venv·torch·CUDA는 확인했지만(위 부록) Kev 설치·커널·F1은 미실행이다. 학습 실행 가능 여부는 F1 결과로 확정하고, 토·일 GPU 1 독점 가능 여부·시간대는 미확인이다.
> - ~~회사 GPU 사양을 확인하지 않았다.~~ 2026-10-20 서버 확인으로 종결(위 부록). [C1 절차](plans/2026-10-19-c1-external-deps-procedure.md)의 "A40×2" 가정은 틀렸다 — A40 3장이고 그중 1장만 쓴다.
> - 추론 런타임(vLLM·`kev.serve`)을 어느 GPU에 띄울지 확인하지 않았다. GPU 1에 뜨면 학습과 동시에 돌릴 수 없다(두 런타임 약 41 GB + 학습, 23 §2.4).
> - 9B LoRA 메모리는 23 §2.4 추정치(30~45 GB)다. 학습 시간은 A40에서 재지 않았고 F1 실측 전 **미확정**이다(공식 H200 1장 2.6시간은 쓰지 않는다).
> - train 1,000 레코드 확보는 live 수집·첨부 파싱(C3)과 Qwen 추출(C5 `local`, C1 ③)이 되는 것을 전제로 한다. 10-22 까지 안 되면 구조화 필드만 쓰는 갈래 ①(23 §4.4)로 번들을 만든다.
> - `kev.benchmark` 출력(`rows.json`·`predictions.jsonl`) 스키마가 `sol_eval` 입력으로 충분한지, `--rotations` 가 `permute n_perm=6` 과 같은 뜻인지는 10-24 F1 출력으로 확인한다(23 §10).

## ADR-028 상세 — 해커톤 뒤 API·worker NestJS 전환

상태는 **채택**이다(사용자 결정 2026-10-19, 원문: "서버는 Nest.js인데 Next.js로 되어 있어"). 사용자는 범위를 API·worker만으로, 시점을 해커톤 뒤로 골랐다. 마감까지 8일이고 C3·C5 서버 작업이 Next.js 구조 위에 있어 지금 옮기면 핵심 컷 일정이 깨진다. 착수는 해커톤 제출(2026-10-27) 뒤다. 그 전까지는 ADR-017과 그 구현 결과 절이 현재 구조의 정본이다.

- **바뀌는 것**: `/api/v1/**` Route Handler와 헬스체크, 서버 도메인의 repo·service, worker(`web/worker`, BullMQ 소비자)를 NestJS 앱으로 옮긴다. Next.js(`web/`)는 화면만 맡는다. ADR-017의 "NestJS는 쓰지 않는다"는 이 범위에서만 바뀐다.
- **바뀌지 않는 것**: Supabase(Postgres·RLS·Auth), 조직 격리(`org_id` + RLS), `memberships.sol_role`, append-only 마이그레이션·정책 시험(`pnpm test:db`)·타입 생성, service role은 worker·seed만, MinIO·Qdrant·Redis/BullMQ·Python AI gateway·Docker Compose, `/api/v1` 경로와 DTO 계약([[05-API-SPEC|05 API]]). Prisma·자체 JWT 인증은 쓰지 않는다(ADR-002 폐기 그대로).
- **인증·권한(목표)**: NestJS는 요청의 Supabase access token(`Authorization: Bearer`)을 검증하고, 요청마다 그 토큰으로 Supabase 클라이언트를 만들어 RLS가 권한을 정하게 한다. 요청 처리 경로의 기본 통로는 anon 키 + 사용자 토큰이고, service role 키는 쓰지 않는다.
- **해커톤 동안**: NestJS 코드·의존성을 만들지 않는다. 현재 구조를 설명하는 문서(02·04·05·07·10·11·17·20, `.claude` 에이전트·스킬, `docs/boilerplate/`)는 Next.js 기준 그대로 둔다.
- **착수 때 할 일**: 목표 구조 스펙(앱 위치 초안은 루트 `api/`로 `web/`처럼 독립 설치, 모듈 구조, 화면이 데이터를 NestJS로 읽을지 Supabase를 직접 부를지) → 사용자 승인 → `verify.config.json`에 새 프로젝트와 계층 규칙 등록 → Compose `api` 서비스 → 도메인별 이전(시험 먼저) → 문서 갱신(ADR-017 구현 결과 절, 위 문서들, `CLAUDE.md`·`AGENTS.md`·`docs/CLAUDE.md`) → CI(`.github/`는 에이전트 편집 금지라 사람이 고친다).
- **남은 결정**: NestJS 버전과 모듈 구조, worker를 NestJS 앱의 별도 진입점으로 둘지 별도 앱으로 둘지, 화면의 데이터 경로. 착수 스펙에서 정한다.
- **되돌리기**: 착수 전이면 이 ADR을 폐기하면 된다.

## ADR-029 상세 — Critical Path 1차 분담의 사용자 결정 (A1~A7)

상태는 **채택**이다(사용자 결정 2026-10-19). 조정 세션 sol-radar-e8이 핵심 컷 레인(C3 수집, C5 gateway·분석 클라이언트, C6 화면)을 나누면서 정본 불일치와 계약 빈틈을 사용자에게 물었고, 사용자가 추천안을 골랐다. 같은 날 사용자가 정본 반영을 승인했다. 근거 출처는 조정 기록부 `.superpowers/sdd/2026-10-19-critical-path-wave1/progress.md`(커밋되지 않는 작업 파일)이고, 아래 근거 열의 K·C 번호는 그 기록부의 판정 번호다.

|#|결정|정본 반영 위치|근거 (누가·언제·무엇을 보고)|
|---|---|---|---|
|A1|인용 검증으로 유효 근거가 0개가 된 필드(`FX-13`)는 `UNKNOWN` + `note="CITATION_FAILED"`다. 실패한 인용은 `match=FAILED`로 `evidence`에 남기고 화면에는 보이지 않는다. 추출 `warnings`에 `CITATION_FAILED:<field>`(`FX-13`은 `qualifications`), 분석 `reviewFlags`에 `CITATION_FAILED`. `CONFLICTED`가 아니다([[15-DATA-CONTRACTS\|15]] §2: `CONFLICTED`는 서로 다른 값의 근거가 2개 이상일 때)|03 §4.4·§9, 07 §6.2·§6.3, 11 §3 G9·§3.1. 15 §5.3은 원래 같은 규칙이라 고치지 않았다|사용자, 2026-10-19. 불일치 목록 #1에서 (b)를 골랐다(K1). 03·15가 필드 상태의 원천이라는 목록의 제안을 보고 정했다|
|A2|추출 `warnings`에 `ATTACHMENT_PARSE_FAILED:*`가 있거나 FAILED 인용 비율이 50%를 넘으면 `ExtractResponse.status=PENDING_REVIEW`다. 실패 문서 목록 같은 새 필드는 두지 않는다|03 §2.1·§4.4(9단계, 경고 표), 07 §6.2·§6.3 `FX-05`. 15 §5.3의 50% 규칙과 같다|사용자, 2026-10-19. 불일치 #2에서 (a)를 골랐다(K2)|
|A3|`AI_FAULT_INJECT` 값은 정본 5개(`kev_timeout`·`qwen_error`·`qwen_unreachable`·`kev_unreachable`·`gateway_down`)다. `gateway_down`은 `AI_PROVIDER=mock` + 주입일 때만 `/extract`·`/kev`·`/explain`이 `503 {"errorCode":"AI_UNAVAILABLE","message"}`를 내 gateway 연결 불가를 흉내 낸다(시험 전용 예외)|03 §2.1(200이 아닌 경우)·§3 env 표, 11 §3 장애 주입 표, `.claude/agents/ai-gateway-developer.md`·`test-ai.md`의 값 목록 줄|사용자, 2026-10-19. 불일치 #3에서 (a)를 골랐다(K3). 10·11이 이미 5개를 써서 고칠 곳이 적다는 목록의 제안을 보고 정했다|
|A4|정보화사업 수집 필터를 넓힌다: `infoBizYn='Y'` 또는 `sucsfbidMthdNm`에 "SW사업" 포함 또는 `pubPrcrmntClsfcNm`이 정보시스템·SW 분류. 교체할 수 있는 순수 함수로 둔다|07 §1·§2.2, 03 §2 흐름도·§10.5 "정보화사업이 아닌 공고" 행, [[20-GLOSSARY\|20 용어집]]|사용자, 2026-10-19 "조건을 넓힌다"(C3-1). 7일 100건 표본에서 `infoBizYn` 빈값이 약 93%였다는 실측([API 호출 증거](evidence/phase-0/external-deps-api-20261019.md) §10-4)을 보고 정했다|
|A5|`KEV_ENABLED=false`를 세 실행 모드 모두 허용하고 기본값은 `true`다(`infra/run-modes.json`, main `daf07a6`). 그래서 03 §9의 "`KEV_ENABLED=false`와 Kev timeout 두 경우 모두 `COMPLETED`/`RULES_ONLY`"가 실제 설정으로 성립한다|03 §3, 10 실행 모드·프로필 표, 20 용어집, 이 문서 ADR-008·012 행과 ADR-024 D6|사용자, 2026-10-19 "`KEV_ENABLED=false` 허용, 기본 `true`"(기록부). 불일치 #4를 닫는다. 설정 파일은 C5-A 레인(sol-radar-3b)이 `KEV_ENABLED` 줄만 고쳤다(`3a813dd`, main `daf07a6`에 병합)|
|A6|C6 화면 스펙의 결정 항목 D1~D30을 모두 추천안(①)대로 승인한다. 스펙은 `docs/plans/2026-10-19-c6-screens-design.md`(브랜치 `c6/screens` `d43e471`, main 병합 전)다. 정본에 들어가는 항목은 아래 목록이다|아래 목록|사용자, 2026-10-19 "D1~D30 추천안 일괄 승인"(C6-D). D1의 옛 리다이렉트 파일 삭제와 D20의 `feat/people-read` 공용 변경 3건 가져오기도 포함한다|
|A7|공고 목록(`/bids`)의 기본 상태 필터는 [[05-API-SPEC\|05]] §3대로 `OPEN`·`AMENDED`이고 취소 공고는 숨긴다. 상태 필터에 "취소 포함" 선택지를 두고, 고르면 목록에 "취소됨"을 표시한다. 공고 상세는 상태와 상관없이 언제나 열린다. S2·S3의 19건 기대값은 바뀌지 않는다|05 §3 `status` 행, 06 §5.4 목록 필터·§5.5 취소 공고 행. C6 핵심 컷 목록에도 이 선택지를 둔다|사용자, 2026-10-19(조정 세션 sol-radar-e8 전달). ADR-030 B14를 채택할 때 남은 한 가지(05 §3 기본값은 취소 공고를 숨기는데 C6 스펙 §5.3은 목록에 "취소됨"을 보인다)를 보고 정했다|

A6 중 정본에 반영한 항목:
- [[05-API-SPEC|05 API]]: D16 `AnalysisResult` DTO의 `missingFactors: {factor, reason}[]`, `ScoreFactor.missingReason`, `profileEvidence[].type`의 `INDUSTRY_CODE`(§4.1·§4.5). D10 `analyses.byRecommendation`은 공고별 최신 분석 1건 기준, D11 `reviews.pending`은 최신 분석이 있고 사람 결정이 없는 공고 수, D9 `DashboardSummary.recentChanges`(§4.6). D8 `PATCH /notifications/:id/read`를 핵심 컷 Route Handler 10번째로(§2, [[12-ROADMAP|12 로드맵]] C6 행). D7 알림 모두 읽음·유형 필터는 핵심 컷에서 뺀다(06 §5.7).
- [[06-UI-UX|06 UI]]: D15 §3 토큰 대응(바탕 흰색 `background`, danger = `destructive`, `info`·`neutral`·`-soft`는 있는 토큰으로 대신, 사이드바 256px, 화면 제목 `type-title` 30/36). D14 큰 점수 `type-title`. D3 `DEMO` 배지는 Topbar 실행 모드 바로 앞. D4 AI 지표는 30초 주기 + 창 초점·분석 종료 때 즉시. D17 상태 이름(`RUNNING`, 분석 없음 = `latestAnalysis=null`). D12 분석 출처 "분석 실행 모드: live" + 받은 모델 식별자 그대로(03·11·18·19 문구도 맞춤). D13 Kev 구역 제목 "Kev 참고 지표" + 꼬리 글자 "모델 참고 지표 (점수 미반영)". D22 결정 권한 문구 "ADMIN·SALES 역할만". D18 §12 S7 스크린샷 행. D19 목록 예산 줄인 표기와 출처 열 80px(스펙의 64px에서 `DEMO` 칩이 잘린다는 조정 판정으로 넓혔다. 1280px·사이드바 펼침에서 제목 열 184px). D2 `RunModeIndicator` 값 출처(§8).
- [[10-DEPLOYMENT|10 배포]]: D2 web 서버 env `SOL_RUN_MODE`(기본 `mock`)를 web env 예시와 `pnpm check:env`에 등록한다. 구현은 C6 B단계다.
- [[11-TESTING|11 테스트]]·[[18-HACKATHON|18 해커톤]]·[[19-DEMO-SCENARIO|19 데모 시나리오]]: D5 S4 알림 벨 기대값(발표자를 담당자로 지정, 벨에 `REVIEW_ASSIGNED` 포함, 분석 요청자에게 가는 `ANALYSIS_COMPLETE`도 올 수 있다).
- 06·[[02-ARCHITECTURE|02 아키텍처]]: D1 업무 화면은 조직 주소 없는 `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`이고 `web/app/(app)/(work)/` 경로 묶음에 둔다. D30 템플릿 `/{slug}/tasks`·`/{slug}/dashboard`는 이번에 그대로 두고 확장 컷(N1)에서 정리한다.
- 나머지 D항목(D6 담당자 목록, D20 브랜치 공용 변경, D21 결정 라디오 기본값, D23 근거 하이라이트 범위, D24 첨부 원문 열기, D25 1280px 미만 안내, D28 발주계획 자격 표시, D29 알림 제목, D-오류)은 화면 구현 규칙이라 C6 스펙에만 둔다.

## ADR-030 상세 — Critical Path 1차 분담의 조정 결정 (B1~B26)

상태는 **채택**이다(2026-10-19 사용자 결정, 일괄). 조정 세션 sol-radar-e8이 병렬 레인 사이의 계약 빈틈을 메우려고 정했고, 처음에는 제안으로 올려 각 절에 콜아웃만 달았다. 같은 날 사용자가 B1~B26을 일괄 채택해 콜아웃 내용을 아래 "반영 위치"의 정본 본문으로 옮기고 콜아웃은 지웠다. B14 가운데 목록 기본 상태 필터와 취소 공고 표시는 사용자가 따로 정했다(ADR-029 A7). 근거 출처는 ADR-029와 같은 조정 기록부다. B25·B26은 사용자 선택을 세션 sol-radar-54가 전달한 것이다.

|#|결정|반영 위치|근거 (누가·언제·무엇을 보고)|
|---|---|---|---|
|B1|worker → gateway `/kev` 전송 실패(연결 거부·timeout·5xx 소진·circuit open·503 주입)는 `AI_UNAVAILABLE` → `PARTIAL`·`RULES_ONLY`다. `KEV_UNAVAILABLE`(분석 `COMPLETED`)은 gateway가 200 + `errorCode`를 줄 때만이다. (주석, ADR-032 D4: 둘째 문장은 ADR-031 C6로 넓어졌다. gateway가 응답했지만 쓸 수 없는 `/kev`(4xx·봉투 오류·wire 스키마 위반)도 `KEV_UNAVAILABLE`이다)|03 §8|e8 판정 K3'(2026-10-19). C5-B(sol-radar-b3)가 03 §8 표와 §9를 근거로 정정을 요청|
|B2|`KEV_ENABLED=false`에서 gateway가 죽으면 `/explain` 전송 실패는 템플릿 문장으로 대체하고 `PARTIAL` 사유가 아니다. `AI_UNAVAILABLE`은 `/extract`·`/kev` 전송 실패만이다|03 §8|e8 판정 K11. b3가 정본 빈틈으로 보고|
|B3|`KevResponse` 최상위에 `errorCode: "KEV_UNAVAILABLE" \| "INJECTION_SUSPECTED" \| null`. 인젝션이 의심되면 Kev 호출을 생략한다(`kev.enabled=false`, 분석은 `COMPLETED`·`RULES_ONLY`)|03 §2.1·§5.7|e8 판정 K4·K4'. K4'는 security-auditor의 인젝션 가드 지적 뒤 3b 보안 처리안을 승인한 것|
|B4|fixtureId는 `FX-NN` 또는 `FX-NN.rNN`이다. worker는 늘 `.rNN`을 보내고, gateway mock은 그 파일이 없으면 `FX-NN`으로 대체한다. 형식이 어긋나면(ASCII 숫자가 아닌 경우 포함) 거절한다. 응답 id는 요청 값으로 바꾼다|03 §2.1, 07 §6.5|e8 판정 K5·K5'(b3 제안 승인). ASCII 조건은 security-auditor 지적(`\d`)|
|B5|`/kev`의 `profileSummary`는 회사 프로필 전체 + 선택 `staffAvailability`다. 05의 `CompanyProfileSummary`(revision 목록용)와 이름이 겹친다. 이름은 바꾸지 않고 두 곳에 서로 다른 것이라고 적었다|03 §5.7, 05 §4.4|e8 판정 K6|
|B6|`/parse` 어댑터 미설정 응답: 형식은 매직 바이트로 판정, 50 MB 초과는 `TOO_LARGE`, 모르는 형식·어댑터 미설정은 `UNSUPPORTED_FORMAT` + `warnings`의 `PARSER_NOT_CONFIGURED:<fmt>`, `parserId "none"`|03 §10.1·§10.5|e8 판정 K7(C5-A sol-radar-3b 제안 승인)|
|B7|`/explain` 요청은 최상위가 03 이름이고 안쪽은 규칙 엔진 `AnalysisResult` 이름이다. mock 응답은 `fallback=true`(템플릿)다|03 §2.1|e8 판정 K8, 3b의 mock 값 통보|
|B8|200이 아닌 응답 본문은 `{errorCode, message}`다. 대상은 422 `KO_STATE_NOT_ALLOWED`와 ADR-029 A3의 시험 전용 503뿐이다. hosted 미승인은 기동 거부(exit 78)이고 요청 단계 503은 없다(불일치 #12의 구현 방식)|03 §2.1|e8 판정 K9|
|B9|`/health`: `qwen {model, promptHash} \| null`, `kev {modelId, registryMatch} \| null`, `questionSets: string[]`, `parsers: {format, parserId}[]`. mock이면 qwen은 fixture 고정 값(`model:"fixture"`, fixture 공통 `promptHash`)이다. worker의 추출 캐시 키(revision, model_name, prompt_hash)가 seed와 맞게 하려는 것이다(ADR-031 C16 뒤로 seed는 추출을 넣지 않아, 사전 분석이 저장한 추출과 맞춘다)|03 §2.1·§11|e8 판정 K10·K13(3b 구현)|
|B10|`/health`를 읽지 못하면(gateway 정지) worker는 그 revision의 가장 최근 성공 추출을 키와 상관없이 쓴다. S6에서 "점수·자격이 직전 run과 같다"를 지키려는 것이다. FAILED 추출은 저장하지 않는다|03 §7·§8|b3의 S6 규칙(03 §8·§9를 보고), e8 판정(FAILED 추출 미저장)|
|B11|`AI_PROVIDER=hosted` + `KEV_ALLOW_KO_STATE=true`는 모든 모드에서 기동 거부(`KEV_ALLOW_KO_STATE(FORBIDDEN_WITH_HOSTED)`). `AI_FALLBACK_TO_MOCK`은 미구현이라 켜면 기동 거부|03 §3·§5.11, [[09-SECURITY\|09]], [[10-DEPLOYMENT\|10]]|e8 판정. security-auditor가 `c5/gateway-mock` 검토에서 hosted + 한국어 state를 지적한 뒤, local 어댑터 판정 L3|
|B12|03 §4.4 `STATE_FIXED`의 뜻을 넓힌다(KNOWN이 아닌 필드의 non-null 값을 null로 고칠 때도). `KevAssist.questionSetVersion` null 허용. 추출 경고 코드 `MOCK_FIXTURE_NOT_FOUND`·`ADAPTER_NOT_IMPLEMENTED`·`EXTRACTION_LOW_CONFIDENCE`(`CITATION_FAILED:<field>`는 ADR-029 A1로 본문에 넣었다)|03 §4.4·§5.7|3b의 정본 반영 요청을 e8이 반영 목록에 올림|
|B13|`StructuredRequirement`의 `seq`: 수집은 15 §3대로 seq 없이 내고 순서는 결정적(안정 정렬)으로 한다. 분석 변환이 배열 index(0부터)로 seq를 채운다|[[15-DATA-CONTRACTS\|15]] §3|e8 판정 K12|
|B14|공고 상태: 등록·재공고 → `OPEN`, 변경 → `AMENDED`, 취소 → `CANCELLED`. `CLOSED`는 정규화가 만들지 않고 조회할 때 `deadlineAt`으로 계산한다. 매핑에 없는 값은 15 §6 격리. fixture 레코드에 `status`가 없고 revision ≥ 2면 `AMENDED`. 목록 기본 상태 필터와 취소 공고 표시는 ADR-029 A7|15 §3, 07 §3.1·§6.5, 05 §3|e8 판정 C3-3(checksum이 시간에 따라 바뀌지 않게), C3·seed 경계 판정(sol-radar-ee·2f)|
|B15|ingest run 상태: SEED(격리 1건)는 `PARTIAL`, LIVE는 `SUCCEEDED`, connector 중단은 `FAILED`. seed 직후 `bid_revisions` 19, LIVE 배치 4건 뒤 23|07 §6.4, 04 §6|e8 판정(C3 sol-radar-ee 중간 보고)|
|B16|registry 기본 URL은 `https://apis.data.go.kr`이다(서비스키가 쿼리로 가고, 실측도 https). `infra/sources/registry.yaml`은 C3 worker 연결 단계에서 만든다. Connector는 endpoint를 생성자로 받는다|15 §8, 07 §1.1|e8 판정. C1 실호출(sol-radar-2f)이 https였다|
|B17|data.go.kr XML 오류 봉투: `returnReasonCode` 22 = `QUOTA_EXCEEDED`(그 서비스의 그날 호출 중단), 30·31 = 키 오류(재시도 없음). 실측 표본이 없어 미검증 가정이다|07 §2.2|e8 판정(ee 제안)|
|B18|ingest 저장은 RPC `ingest_save_revision`(마이그레이션 `20261019000009`, service_role 전용)으로 원자적으로 한다. `pnpm demo:reset`은 `runIngest`를 부르고 결정적 id(uuid v5) 옵션을 넘긴다. 하위 job은 outbox와 `documents` 큐만 만든다. 새 공고 자동 분석은 해커톤 컷에 없다. live 수집 주기는 07 값(없으면 30분, env)|07 §2·§4, [[12-ROADMAP\|12]]|e8 판정(ee Stage 6, 2f의 리허설 간 id 보존 요구)|
|B19|기존 사업 투입 7명은 `team_member_scoring.availability`의 해당 기간 fte를 낮춰 표현한다(창을 나누고 덧붙이지 않는다). `assignments`는 데모 2건만. FX-01·02·03 기간 가용 20 FTE(main `3e181b7`)|[[04-DATABASE\|04]] §6, [[08-SCORING\|08]] §6.1|e8 판정(b3가 인력 가용성 공백을 제기, 선택지 2). 2f가 main `3e181b7`로 구현|
|B20|분석 요청 계약: 같은 입력 = (revision, 회사 프로필, 알고리즘 버전). `force:false` + 같은 입력 진행 중 → `202 deduplicated:true`(그 run). `force:true` + 진행 중 → `409 ANALYSIS_IN_PROGRESS {analysisId}`. 큐 등록에 실패하면 run을 `FAILED`(`ENQUEUE_FAILED`)로 바꾸고 멱등 키를 풀어 503. `Idempotency-Key`가 없으면 서버가 UUID를 만든다. 큐 `analysis`, job `analyze`, jobId `analysis_<orgId>_<scoreRunId>`(BullMQ는 `:` 금지), payload `{orgId, scoreRunId, idempotencyKey}`. `score_runs` 멱등 키는 `<org_id>:<requestId>`|[[05-API-SPEC\|05]] §2·§4.5·§5|e8 판정(C6 B1 계약 고정, b3 큐 계약, 2f 멱등 키 회신)|
|B21|멈춘 분석 복구: 오래된 `QUEUED`·`RUNNING` run(기본 10분, env)은 job이 없으면 같은 jobId로 다시 넣고, 시도를 다 썼으면 `STALE_RUN`으로 실패 처리한다. ADR-031 C4로 줄였다: `QUEUED`는 다시 넣지 않고 `FAILED`(`STALE_RUN`)로 닫는다|03 §8|e8 제안, b3 수용(Codex 브랜치의 analysis-reconcile 아이디어)|
|B22|데모 사전 분석은 별도 명령 `pnpm demo:preanalyze`. 대상 18건(SEED 19 − FX-02, FX-18 포함), mock·gateway 필수, 18건 모두 `COMPLETED`. 기동 순서: Compose → `pnpm demo:reset` → 모드 확인 → `pnpm demo:preanalyze` → S2. ADR-031 C12(f)로 "모드 확인·mock 복귀"를 명시하고 10 기동 절차를 12~14번으로 다시 매겼다|10 기동 절차, [[19-DEMO-SCENARIO\|19]] §3 5번|e8 판정(b3 제안 승인). 실행은 사용자 확인 뒤|
|B23|알림 `payload.link`의 열린 리다이렉트 방지는 서버(알림 목록 서비스)가 맡는다. 앱 안 경로만 허용하고, 그 밖이면 `/bids/{bidId}`로 바꾼다|05 §4.6, [[13-NOTIFICATIONS\|13]], 09|조정 세션 e8(정본 반영 지시서). 기록부에 따로 적힌 판정 줄은 없다|
|B24|규칙 엔진의 `explanation`에는 파이프라인 플래그(`CITATION_FAILED` 등)가 반영되지 않는다. 화면 설명은 `meta.explanation`(gateway `/explain` 문장 또는 템플릿)이다|08 §7, 03 §2.1|e8의 반영 목록 후보, b3 2단계 출력(`meta.explanation{text,source}`) 승인|
|B25|`/dashboard` 본문(`AppPage` 안)만 글자 눈금 +3px(body 14→17, label 13→16, caption 12→15, heading 16→19, title 30→33, 줄 높이 +3px, 굵기·자간 그대로). 사이드바·Topbar·다른 화면은 그대로다. 정본은 `design/tokens.json`의 대시보드 범위 변형이고 `pnpm tokens`가 범위 CSS를 만든다. design-system 스킬의 디자인 규칙 3번("같은 역할의 글자는 어느 화면에서나 같은 크기")의 예외다. 구현은 C6 B단계|[[06-UI-UX\|06]] §3.3|사용자 선택(세션 sol-radar-54가 전달, 2026-10-19)|
|B26|앱 틀 사이드바 전체(조직 표시·메뉴·묶음 줄·맨 아래 사용자 칸)의 글자 +3px, 모든 화면 공통. B25와 같은 방식(tokens.json 범위 변형). 실제 사이드바 눈금에 +3px 한다: 메뉴 `type-label` 13→16px, caption 12→15px(처음 적은 기준은 ADR-031 C1로 정정). 항목 높이는 글자에 맞춰 늘 수 있다(C6 B2에서 확정)|06 §4.1|사용자 원문 "사이드 바 글씨도 작은데 같이 올려"(세션 sol-radar-54가 전달, 2026-10-19)|

구현 상태는 이 ADR이 판정하지 않는다. main `daf07a6`의 gateway mock 코드에서 확인한 것만 적는다(2026-10-19): 200이 아닌 본문 `{errorCode, message}`와 `gateway_down` 503(B8·ADR-029 A3), `/health`의 `registryMatch`·`questionSets`(B9), `/parse`의 `PARSER_NOT_CONFIGURED:<fmt>`(B6), `/explain` mock `fallback=true`(B7)는 들어가 있다. `KevResponse.errorCode`는 `KEV_UNAVAILABLE`만 있고(B3 일부), fixtureId 형식 검사는 ASCII 숫자 제한 전이다(B4 일부). 나머지는 각 레인 브랜치(main 병합 전)의 일이다.

결정 경과: B5의 이름 겹침은 이름을 바꾸지 않고 03 §5.7·05 §4.4에 서로 다르다고 적었다. B17은 채택했지만 실측 표본이 없어 07 §2.2에 미검증 가정으로 표시한다. B25·B26은 design-system 스킬의 디자인 규칙 3번 예외로 06에 적었다(스킬 파일은 고치지 않았다). B26의 사이드바 글자 기준은 ADR-031 C1(2026-10-19 사용자 결정)로 정정했다.

## ADR-031 상세 — 정본 반영 2차 (C1~C16)

상태는 **채택**이다(2026-10-19 사용자 결정, 일괄). 조정 세션 sol-radar-e8이 Critical Path 1차 분담 뒤 정본 반영 2차 묶음으로 정리했다. 근거 출처는 ADR-029·030과 같은 조정 기록부다(커밋되지 않는 작업 파일).
- C1~C3과 C16은 사용자 결정(e8이 전달)이라 처음부터 아래 "반영 위치"의 본문에 반영했다. C16은 일괄 채택 때 함께 정했다.
- C4~C15는 e8 판정이다. ADR-030처럼 처음에는 제안으로 올려 근거 문서의 해당 절에 콜아웃만 달았다. 같은 날 사용자가 일괄 채택해 콜아웃 내용을 "반영 위치"의 본문으로 옮기고 콜아웃은 지웠다.

|#|결정|반영 위치|상태|근거 (누가·언제·무엇을 보고)|
|---|---|---|---|---|
|C1|사이드바 글자 +3px의 기준을 고친다(ADR-030 B26): 실제 사이드바 눈금에 +3px 한다. 메뉴 `type-label` 13→16px, caption 12→15px. B26과 06 §4.1이 적었던 "글자 14→17px"은 실제 사이드바 눈금과 다른 기준이었다. B25(대시보드)와 같은 규칙이다|[[06-UI-UX\|06]] §4.1, 이 문서 B26 행|채택|사용자, 2026-10-19(e8 전달). `design/tokens.json`의 `label` 13·`caption` 12를 확인|
|C2|`Review.reviewer.role`은 `Role \| null`이다. 결정한 사람이 조직을 떠나 멤버십이 없으면 업무 역할을 알 수 없어 null이고, 화면은 역할 괄호를 빼고 이름만 보인다|[[05-API-SPEC\|05]] §4.6. 06에는 결정자 역할 표기가 없어 고치지 않았다|채택|사용자, 2026-10-19(e8 전달)|
|C3|19 S3 1번 목록 절차를 "필터 권고 `BID`, 정렬 `점수 내림차순`"으로 고친다. 상단 순서 `FX-01`(94)·`FX-18`(82)·`FX-06`(78)은 그대로다. 단계 `입찰공고` 필터는 PRE_SPEC인 `FX-18`을 빼고, 엔진 점수로는 NOTICE·WATCH인 `FX-11` 89·`FX-13` 85·`FX-05` 83이 78보다 높다|[[19-DEMO-SCENARIO\|19]] §4 S3 1번·4번("권고 필터를 풀고"), [[11-TESTING\|11]] §5 7번·9번, `docs/submission/video-storyboard.md` 22행|채택|사용자, 2026-10-19(e8 전달). 엔진 점수는 e8 판정|
|C4|멈춘 분석 복구를 줄인다(B21 변경): 큐에 job이 없는 run 중 `RUNNING`은 같은 jobId로 다시 넣고, `QUEUED`는 다시 넣지 않고 `FAILED`(`STALE_RUN`)로 닫는다. 화면 경로는 enqueue가 실패하면 `FAILED`(`ENQUEUE_FAILED`)로 닫고 키를 푼다|[[03-AI-PIPELINE\|03]] §8|채택|e8 판정. 사용자가 PostgREST로 직접 넣은 `QUEUED` run이 속도 제한을 우회하는 통로가 된다는 security-auditor 지적. b3가 구현해 main `cfe8f0a`(마이그레이션 `20261019000011`과 같은 묶음)에 들어갔다|
|C5|C5-B 보안 후속: 결과 저장은 RPC `finish_score_run(p jsonb)` 하나로 한다(service_role만). 같은 시도(markRunning이 쓴 `started_at`)가 잡은 `RUNNING`일 때만 마감하고, 아니면 `SCORE_RUN_NOT_RUNNING`이다. check `score_runs_idempotency_key_org_check`: 멱등 키는 `<org_id>:`로 시작한다. requestId는 `^[A-Za-z0-9_-]{1,128}$`다|[[04-DATABASE\|04]] §3.4, 03 §7, 05 §1|채택|e8 판정(b3 C5-B, `20261019000011`, main `cfe8f0a`)|
|C6|worker 실패 분류의 기준은 "gateway가 응답했는가"다. 전송 실패(연결 거부·timeout·재시도 뒤 5xx·circuit open·시험 503)만 `AI_UNAVAILABLE`(`PARTIAL`)이다. 응답했지만 쓸 수 없는 `/kev`(4xx·봉투 오류·wire 스키마 위반)는 `kev.enabled=false`·`KEV_UNAVAILABLE` 플래그·`COMPLETED`·`RULES_ONLY`다. 응답했지만 쓸 수 없는 `/extract`는 `EXTRACTION_FAILED`(`PARTIAL`)다. 진단(zod issue 경로·코드, failure kind)은 worker 로그에만 남기고 값과 DB에는 남기지 않는다. 그래서 `KEV_UNAVAILABLE`의 뜻이 "Kev 미접속·timeout + Kev 응답 형식 오류"로 넓어진다. 화면 문구는 "Kev 사용 불가"다|03 §5.7·§8, 05 §4.1·§5, 06 §6|채택|e8 판정|
|C7|Kev wire score 질문의 응답은 `score`·`legend`·`probabilities`·`confidence`를 모두 가진다. `score`는 분포 기대 등급(Σ i·p_i)이고 차이가 0.05를 넘으면 형식 오류다. `confidence`는 최대 확률이다. mock 공식(03 §5.7)의 `fit`은 세 분기 모두 `{"0":0,"1":0.2,"2":0.6,"3":0.2,"4":0}`, `confidence` 0.6, `score` 2.0이다|03 §5.4·§5.7|채택|e8 판정. 3b가 구현해 main `9da17c4`(`13fcb96`)에 들어갔다|
|C8|`fixtures/kev` 고정값 규칙을 명확히 한다: 16건의 `fit`·`needsHumanReview`·권고는 규칙 엔진 출력에서 정하고 골든이 바뀌면 다시 맞춘다. "나머지 0.25·0.15"는 BID–WATCH–NO_BID 순서에서 규칙 권고와 이웃한 선택지가 0.25다(WATCH 권고면 BID 0.25, NO_BID 권고면 WATCH 0.25·BID 0.15). `fit` 분포는 정수가 아니면 floor·ceil 두 등급, 1~3 정수 s면 {s−1:0.2, s:0.6, s+1:0.2}, 0·4면 {s:1.0}. 개정판 전용 파일 `FX-07.r01.json`(WATCH 0.60, fit 68/20)을 둔다. `FX-12`는 생략한다(격리)|[[07-DATA-PIPELINE\|07]] §6.3|채택|e8 판정. ee 구현 중(브랜치 `fixtures/kev-complete`)|
|C9|`FX-07` r2 점수를 76에서 77로 고친다(엔진 77.3, 화면 77). manifest `designScore`는 fixture라 ee 몫이다|07 §6.2, 19 §2·S5 3번, 11 §5 12번|채택|e8 판정(엔진 출력)|
|C10|`FX-17` 자격 표기 `NOT_APPLICABLE`을 엔진 결과 `NEEDS_REVIEW`(사유 `STAGE_NOT_APPLICABLE`)로 고친다. 04 §3.4·06 §3.2·08 §5.1 본문과 같은 값이다|07 §6.2, 19 §2|채택|e8 판정|
|C11|사전 분석 18건의 기대 플래그(fixtures/kev 20건 기준): `MODEL_RULE_DISAGREEMENT`는 `FX-03`에만 붙는다. `KEV_NEEDS_REVIEW`는 `FX-04`·`05`·`11`·`13`·`17`·`19`·`20`에 붙는다(needsHumanReview 0.70 ≥ 임계 0.7)|07 §6.2, 19 §2, 11 §5 4a|채택|e8 판정|
|C12|C5-B 후보 6건. (a) `score_runs.fallback_reason`은 지금 늘 null이다(gateway 계약에 mock 자동 대체를 알리는 필드가 없다, 알려진 한계). (b) `KEV_ENABLED=false`에서 gateway가 멈췄을 때 `PARTIAL` 사유가 없다(03 §8 B2 문장과 같아 확인만 했다). (c) `explanation` 문장에 파이프라인 플래그(`CITATION_FAILED` 등)가 반영되지 않는다(알려진 한계). (d) `qualification_checks`에 (`score_run_id`, 항목) UNIQUE를 둘지는 후보다. (e) worker env `ANALYSIS_STALE_QUEUED_MS`(기본 600000)·`ANALYSIS_STALE_RUNNING_MS`(600000)·`ANALYSIS_RECONCILE_INTERVAL_MS`(60000), 값은 1~3600000 정수이고 선택값이다. (f) 데모 기동 순서: Compose → `pnpm demo:reset` → 모드 확인·mock 복귀 → `pnpm demo:preanalyze` → S2|03 §2.1·§3·§7, 04 §3.4, [[10-DEPLOYMENT\|10]] env 파일 위치·기동 절차 12~15번(번호를 다시 매겨 1~15, [[12-ROADMAP\|12]]·[[17-CLAUDE-IMPLEMENTATION\|17]]의 "1~15"), 19 §3 5번·§6, 11 §5 4a·15번|채택|b3 C5-B 보고와 e8 판정. (e)의 기본값·범위는 main `9da17c4` `web/worker/analysis-reconcile.ts`와 같다|
|C13|수집 주기 env `G2B_INGEST_INTERVAL_MINUTES`를 env 표에 올린다. 코드 기본값 30(분), 양의 정수만 받는다|07 §2.2, 10 env 파일 위치 표|채택|e8 판정. 기본값은 main `9da17c4` `web/worker/ingest-queue.ts`(`DEFAULT_G2B_INGEST_INTERVAL_MINUTES = 30`)|
|C14|분석 jobId는 `analysis_<orgId>_<scoreRunId>`다. BullMQ가 jobId에 `:`를 금지해서 `_`로 잇는다. 저장 멱등 키 `<orgId>:<requestId>`와 다르다|03 §2.1, 05 §4.5|채택|e8 판정. 05 §4.5 본문(B20)에 두 값이 이미 따로 적혀 있다|
|C15|(a) 목록 기본 상태 필터 `OPEN,AMENDED`는 조회 때 계산한 `CLOSED`(마감 지남)를 뺀다. "취소 포함" 필터는 `CANCELLED`만 더한다(ADR-029 A7). (b) S5 `FX-07`: 수집이 분석을 자동으로 넣지 않으므로(B18) r2 재분석은 사람이 상세 화면 [재분석]을 눌러야 보인다. 점수는 C9(77)와 함께 본다|05 §3, 19 S5, 11 §5 12번|채택|e8 판정|
|C16|`pnpm demo:reset`은 추출(`requirement_extractions`)을 넣지 않는다. 원칙은 "seed는 gateway 출력을 지어내지 않는다"다. 검증된 추출은 `pnpm demo:preanalyze`가 worker → gateway `/extract`로 저장하고, `FX-02`는 S4 라이브 분석 때 저장한다. `fixtures/extractions/` 파일은 gateway mock이 읽는 정본이라 그대로다|[[04-DATABASE\|04]] §6 seed 표, 07 §6.5, 10 seed 절, 03 §2.1 `/health` 문단, 이 문서 ADR-024 D11·ADR-030 B9 행|채택|사용자, 2026-10-19(e8 전달). 지금까지 seed가 `fixtures/extractions` 원본을 `requirement_extractions`에 `COMPLETED`·`MOCK`으로 넣었고, worker가 그 행을 캐시로 써서 gateway 인용 검증을 건너뛰었다. 그래서 3e 실DB 재실행에서 `FX-13`이 `UNKNOWN` + `CITATION_FAILED`(ADR-029 A1, 11 G4)가 되지 않고 BID 85가 됐다. 코드는 ee(브랜치 `fix/demo-extraction-seed`)가 고친다|

결정 경과: 일괄 채택과 함께 사용자가 세 가지를 더 정했다(2026-10-19, e8 전달). ① 19 S3 4번은 "권고 필터를 풀고" 결정 `NO-BID`를 고른다(1번의 권고 `BID` 필터가 `FX-03`을 거른다). ② 10 기동 절차는 C12(f) 순서로 번호를 다시 매긴다(`pnpm demo:reset`이 사전 분석을 지워 S2 "완료 18"이 깨진다). ③ 범위를 그 한 파일만 넓혀 `docs/submission/video-storyboard.md` 22행의 필터도 권고 `BID`로 고친다. `docs/plans/2026-10-18-org-chart-sidebar-design.md`는 지난 기록이라 고치지 않는다.

구현 상태는 이 ADR이 판정하지 않는다. C7(main `9da17c4`)과 C12(e)·C13의 코드 기본값(main `9da17c4`)은 main에 있다. C4·C5는 C5-B 보안 후속(마이그레이션 `20261019000011`)으로 main `cfe8f0a`에, C8·C9의 fixture 값(`fixtures/kev` 20건, manifest `FX-07` `designScore` 77)은 main `ca3b878`에, C16의 seed 변경은 ee 브랜치 `fix/demo-extraction-seed`로 main `219d273`에 들어갔다(2026-10-19 main git log로 확인). C4의 화면 경로(`ENQUEUE_FAILED`)는 C6 브랜치 `c6/screens`의 일이다.

하지 않은 것: 04 `requirement_extractions.status`의 `FAILED` 의미 정리(ADR-030 B10)는 마이그레이션과 묶여 있어 이번 묶음에 넣지 않았다.

## ADR-032 상세 — 정본 반영 3차 (D1~D9, 사실 정정 F1~F8)

조정 세션 sol-radar-e8이 main `8f33caa`(C5-A local 어댑터·C5-B 보안 후속·7d 점검 정리·ADR-027 개정이 들어간 뒤) 기준으로 정리했다. 근거 출처는 ADR-029~031과 같은 조정 기록부다(커밋되지 않는 작업 파일).
- D1~D9는 **채택**이다(2026-10-19 사용자 결정, 일괄). e8 판정이라 처음에는 근거 문서의 해당 절에 `제안 — ADR-032` 콜아웃만 달았다. 같은 날 사용자가 일괄 채택해 콜아웃 내용을 아래 "반영 위치"의 본문으로 옮기고 콜아웃은 지웠다. D6은 선택지 두 개 중 ① 센티널로 정했다.
- F1~F8은 결정이 아니라 사실 정정이다. main에 이미 들어간 코드·마이그레이션·fixture·병합 상태와 정본이 달라 본문을 바로 고쳤다. F6~F8은 처음에 범위 밖으로 두었다가 사용자 결정(2026-10-19)으로 고쳤다. 여기에는 목록만 남긴다.

|#|결정|반영 위치|상태|근거 (누가·언제·무엇을 보고)|
|---|---|---|---|---|
|D1|`KEV_TIMEOUT_MS`·`AI_TIMEOUT_MS`는 요청 하나의 단조 시계 마감이다("분할 요청마다"·"Qwen 호출 1회"가 아니다). `/kev`는 레지스트리 대조와 모든 묶음을 `KEV_TIMEOUT_MS` 안에 끝내고, 넘으면 `KEV_UNAVAILABLE`이다. `/extract`는 첫 호출과 재시도를 `AI_TIMEOUT_MS` 안에 끝낸다. 호출이 시간을 넘기면 `QWEN_UNAVAILABLE`, 재시도할 시간이 없으면 `EXTRACTION_FAILED`다. 기본값 `5000`이 v0.2 묶음 2개를 담는지는 실측이 없어 C1 ③ G3에서 다시 본다|[[03-AI-PIPELINE\|03]] §3 env 표(`AI_TIMEOUT_MS`·`KEV_TIMEOUT_MS` 행과 표 아래 줄)·§2.1 worker 순서·§4.3 재시도 정책·§5.9 G3|채택|e8 판정(3b C5-A 보안 후속, 브랜치 `c5/gateway-hardening`, main 미병합). worker 시간 제한(KEV+2초·AI+5초)이 gateway 실제 소요보다 커야 ADR-031 C6 분류가 성립한다|
|D2|모델 레지스트리에 `allowedHosts`를 둔다. 호스트 이름이 정확히 같아야 하고 하위 도메인은 안 된다. 루프백은 시험용으로 허용한다. 목록 밖이면 기동 거부(`HOST_NOT_ALLOWED`). 값은 `acropolissg.com`이다|03 §11 "호스트 허용 목록", [[09-SECURITY\|09]] 회사 GPU 추론 엔드포인트 연결|채택|e8 판정(3b, 브랜치 `c5/gateway-hardening`, main 미병합). 값은 ADR-025 엔드포인트·`infra/env/ai-local.env.example`의 호스트와 같다|
|D3|클라우드 `pnpm db:push` 전 사전 질의: `20261019000011`의 check `score_runs_idempotency_key_org_check`는 `NOT VALID`다. 조직 접두어 없는 `idempotency_key` 행을 상태와 상관없이 세어 0행일 때만 push한다. 행이 있으면 정리한 뒤 `validate constraint`를 새 마이그레이션(번호는 e8 배정)으로 둔다. 0행이면 validate는 필요 없다. 클라우드 push는 C6(`20261019000012`)가 main에 들어온 뒤 한 번에 한다|[[10-DEPLOYMENT\|10]] 운영 "클라우드 `pnpm db:push` 전 멱등 키 사전 질의"|채택|e8 판정(b3 C5-B 보안 후속, 병합 `cfe8f0a` 때 security-auditor가 "db:push 전 접두어 없는 행 0 확인 필요"). 상태 무관 이유: `score_runs`의 FK 두 개(`extraction_id`·`requested_by`)가 on delete set null이라 끝난 행도 UPDATE되어 23514가 난다. push 시점은 3e 권고|
|D4|ADR-030 B1 둘째 문장("`KEV_UNAVAILABLE`은 200 + `errorCode`일 때만")에 "ADR-031 C6로 넓어짐(응답했지만 쓸 수 없는 `/kev`도 `KEV_UNAVAILABLE`)" 주석을 단다|이 문서 ADR-030 B1 행|채택|e8 판정. ADR-031 C6(채택)이 넓힌 뜻이 B1 문장에는 없었다|
|D5|분석 실패 코드·복구. `ANALYSIS_RUN_SUPERSEDED`(영구 실패)는 늦게 온 마감(finish `SCORE_RUN_NOT_RUNNING`)과 run 잡기 실패(markRunning 0행, compare-and-set) 두 경우에 나온다. `finish_score_run`의 거절 코드는 `SCORE_RUN_NOT_FOUND`·`SCORE_RUN_NOT_RUNNING`·`SCORE_RUN_INVALID_STATUS`이고 마감 status는 `COMPLETED`·`PARTIAL`만이다. 시도 식별자는 `started_at = max(now, 앞 started_at + 1ms)`. 멈춘 run 복구는 id keyset으로 읽고 처리 순서는 오래된 순이 아니다. 진단 failure 이름 8개는 로그에만 남기고, 경로 조각이 숫자나 `[A-Za-z0-9_]{1,40}`가 아니면 `*`로 바꾼다|03 §7 `finish_score_run` 문단, §8 멈춘 분석 행·실패 분류 줄|채택|b3 C5-B 보안 2·3차(main `8f33caa`, 마이그레이션 `20261019000013`)와 e8 판정. 거절 코드·마감 status는 04 §3.4·§7에 사실 정정(F2·F3)으로도 들어갔다|
|D6|계정이 지워진 결정자: `bid_reviews.reviewer_id`는 on delete set null이다. 계정이 삭제된 결정자는 센티널 `{ id: "deleted-user", name: "탈퇴한 사용자", role: null }`로 내보낸다. DTO 타입은 바꾸지 않는다. 대안이던 `reviewer.id` nullable(DTO 변경)은 고르지 않았다|[[05-API-SPEC\|05]] §4.6 끝|채택(① 센티널, 사용자 결정 2026-10-19)|e8 판정(C6, 브랜치 `c6/screens` `web/server/bids/bid-row.mapper.ts`, main 미병합)|
|D7|`requirement_assessments.kev_distribution`의 모양은 `{qid, distribution, label}`이다. 05 `RequirementAssessment.kev`, gateway 응답 `{itemId, qid, distribution, label}`과 같다. 지금 C5-B는 null을 쓰고 v0.2에서 채운다|[[04-DATABASE\|04]] §3.4 표의 열 정의와 열 설명|채택|e8 판정. `web/server/analysis/analysis-store.model.ts`(null)·`services/ai/src/sol_ai/contracts.py` `RequirementDistribution` 확인|
|D8|web env 표에 더한다: `SOL_RUN_MODE`(없으면 `mock`, infra 모드와 다르면 check-env `CONTRADICTS_MODE`, ADR-029 A6 D2), `API_CURSOR_SECRET`(32자 이상, 아니면 목록 API 503 `{component:"cursor"}`), web `REDIS_URL`(분석 요청 큐·속도 제한). C6 병합 때부터다|10 env 파일 위치 표 `web/.env.local` 행|채택|e8 판정(7d 후보). C6 브랜치 `scripts/check-env.mjs`·`web/app/_lib/work-deps.ts`·`analysis-queue.ts`·`rate-limit.ts`|
|D9|`KEV_UNAVAILABLE`의 화면 문구는 "Kev 사용 불가"다(ADR-031 C6, 03 §8). 06에 "Kev 서버 미접속" 라벨이 남아 있으면 고친다|[[06-UI-UX\|06]] §6(확인만)|채택. 확인 결과 06에는 그 라벨이 없어 고친 곳이 없다|e8 판정. 06 §6 상태별 변형 표가 이미 "Kev 사용 불가"다. "Kev 서버 미접속"은 05 §5 실패 유형 표의 유형 이름과 C6 설계서(브랜치 `c6/screens`)에만 남아 있다|

사실 정정(본문 반영, 목록만):
- F1 [[04-DATABASE|04]] §3.4·§4: `score_factors.missing_reason`(check 8값, null 허용)·`score_runs.kev_assist` 열과 열 설명, 값 집합 `missing_reason` 행. DB check 값 집합 수를 32→33개(P1 뒤 35→36개)로. 근거 `20261019000010`(main `c2b12d3`).
- F2 04 §7: 마이그레이션 `20261019000009`~`20261019000013` 목록. `20261019000012`는 브랜치 `c6/screens`에만 있어 "C6 병합 때 main에 들어온다"고 적었다. 근거는 main 파일 머리 주석(`d933c9e`·`c2b12d3`·`cfe8f0a`·`8f33caa`).
- F3 04: §3.4 `finish_score_run` 줄의 "main 병합 전"을 병합 커밋으로 고치고 `20261019000013`(`SCORE_RUN_INVALID_STATUS`)을 더했다. §3.1 정책 이름을 "ADMIN 은 역할 변경"으로, owner 정책 설명을 `20261019000001`이 "owner 는 역할 변경"을 지운 사실로 고쳤다. `pnpm eval:publish`를 "(예정)"으로 적었다(§1·§3.7·§6). 같은 표기를 03 §7("main 병합 전")·05 §2(`eval:publish`)·22 §4.1·23 §4.3(`dataset:build`)에도 맞췄다. 두 스크립트는 루트·web `package.json`에 없다.
- F4 [[07-DATA-PIPELINE|07]] §6.5: fixture 파일 건수를 지금 값(`kev/` 20·`extractions/` 20·`goldens/` 3)으로. `fixtures/`를 세어 확인했다.
- F5 [[PROGRESS]]: Phase 5·C5 줄의 "`local` 어댑터 main 미병합"을 main `b4a23fc`·`cfe8f0a`·`8f33caa` 병합으로, kev fixture 행의 추출 시드 제거 "진행 중"을 main `219d273` 병합으로 고쳤다. ADR-025 행이 깨진 링크라고 적은 `SIDEBAR-PLAN…` 링크 모양 표기와 "미커밋"을 고쳤다(대상 `plans/SIDEBAR-PLAN.md`는 있다). 같은 표기를 인용한 Critical Path 1차 분담 행도 링크 모양을 뺐다.
- F6 이 문서 ADR-031: C4·C5 행과 구현 상태 문단의 "main 병합 전"을 실제 병합 커밋(`cfe8f0a`·`ca3b878`·`219d273`)으로 고쳤다. main git log로 확인했다.
- F7 [[03-AI-PIPELINE|03]] §3·[[07-DATA-PIPELINE|07]] §2.2·[[10-DEPLOYMENT|10]] env 파일 위치: "`compose.yaml`이 worker에 env를 넘기지 않는다"를 main `4895010`부터 키를 넘긴다로 고쳤다. `infra/compose.yaml`의 worker `environment`에 `G2B_INGEST_INTERVAL_MINUTES`·`ANALYSIS_*` 3키가 값 없이 있고, 값이 없으면 코드 기본값이 쓰인다. 10 표의 `infra/.env` worker 키 목록에도 넣었다.
- F8 [[23-WEEKEND-FINETUNE|23]] §4.4: v0.2 질문 세트·state 템플릿이 `c5/gateway-mock` 브랜치에만 있다는 문장을 main에 있다로 고쳤다(질문 세트 `85a30c6`, state 템플릿 `51ad173`, main 병합 `b4a23fc`). 질문 세트 status는 "초안 — 사용자 검토 전"이다.

결정 경과: 2026-10-19 사용자가 D1~D9를 일괄 채택했고(e8 전달), D6은 ① 센티널을 골랐다. 같은 결정으로 처음 보고에서 범위 밖으로 남긴 낡은 문장 세 곳(F6~F8)도 고쳤다.

구현 상태는 이 ADR이 판정하지 않는다. D5는 main `8f33caa`에 있다. D1·D2는 3b 브랜치 `c5/gateway-hardening`, D6·D8은 C6 브랜치 `c6/screens`의 일이고 main 병합 전이다. D3은 클라우드 `pnpm db:push`(사용자 확인 뒤) 때 할 일이다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[01-PRD|01 PRD]]
- [[02-ARCHITECTURE|02 아키텍처]]
- [[05-API-SPEC|05 API]]
- [[06-UI-UX|06 UI]]
- [[11-TESTING|11 테스트]]
- [[12-ROADMAP|12 로드맵]]
- [[15-DATA-CONTRACTS|15 데이터 계약]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[09-SECURITY|09 보안]]
- [[07-DATA-PIPELINE|07 수집 파이프라인]]
- [[10-DEPLOYMENT|10 배포]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]
- [[PROGRESS]]
