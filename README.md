# SOL RADAR

> 우리 회사가 참여할 공공사업을 찾는 AI 입찰 의사결정 지원 플랫폼

SOL RADAR는 공공 SI·AX 기업을 위해 공공 발주·입찰 정보를 수집하고,
기업의 기술력·자격·사업 실적을 공고 요구사항과 비교하여
참여할 만한 사업과 검토 근거를 제공하는 서비스입니다.

`agentic-boilerplate`에서 출발했습니다. 설계 문서의 정본은 `docs/`([문서 인덱스](docs/00-README.md))이고,
이 README는 그 인덱스로 가는 입구입니다. 여기 적힌 기능은 목표 범위이며, 구현·검증 여부는 [진행 상황](docs/PROGRESS.md)을 따릅니다.

## 현재 상태 (2026-10-27)

- 일정: 해커톤 공식 제출 **2026-11-03**, 발표 **2026-11-04**입니다([결정 기록](docs/16-DECISIONS.md) ADR-054, 2026-10-27 사용자 결정). 옛 일정(10-24 freeze·10-26 완료 목표·10-27 마감)은 지난 일정입니다. 남은 날의 세부 일정은 [로드맵](docs/12-ROADMAP.md)의 제안(사용자 확인 전)입니다.
- main에 병합됨
  - DB 스키마·RLS·`sol_role`·`pnpm demo:reset`(C2), 공고 수집·정규화·revision(C3), 규칙 엔진·SOL Score·골든 시험(C4), AI gateway mock·`local` 어댑터와 worker 분석 클라이언트(C5).
  - 대시보드·공고 목록·상세·알림 화면과 Route Handler `/api/v1`(C6), 담당자 결정 기록·인앱 알림(C7), 가정 재계산(ADR-037, `d48c7a2`).
  - 2026-10-22 기능 묶음 통합(`6b4ff0a4`·`73eac5a8`): 변경 감지(S5), 부처 지원사업 공고(ADR-040), 사전규격·발주계획 단계 연결(P0-8), 카카오톡 "나에게 보내기" 추천 공고 알림(ADR-038), 회사 Gateway·Worker 배포 묶음.
  - P1 화면 다섯 개: N3 관심 공고·N5 분석 결과 비교·N6 입찰 프로젝트·N7 인력 배치 시뮬레이션(`546a997d`), N4b 조직·인력 ADMIN 편집(`d209eec3`, 운영 배포). 가상 인력 200명·고정 기간 가용 95.5 FTE(ADR-043).
  - 2026-10-26: 3시간 정기 수집(BullMQ cron `0 */3 * * *` Asia/Seoul)과 관리자 [지금 불러오기]·서버 gate, 상단바의 실행 모드·AI 표시 제거, 기본 출처 env `SOL_DEFAULT_ORIGIN`, 사이드바 묶음 3개·트리·아이콘, 대시보드 "공공조달 요약" 숫자 띠.
- 웹은 Vercel 운영 주소 https://www.solideos-radar.com 에서 돌고, DB·Auth·Storage는 Supabase 클라우드입니다. 2026-10-27 `/health/ready` 200(`db`·`redis`·`storage` ok, `ai: local`). 3시간 정기 수집이 2026-10-26 13:51부터 7회 모두 성공했고 실공고 592건이 쌓였습니다(최신 10-27 09:03).
- 골든 수치는 `mock` 기준입니다(FX-01 94 BID · FX-02 72 WATCH · FX-03 68 NO-BID). 운영 회사 모델로 돌린 분석은 2026-10-24 1건뿐입니다: 가상 공고 FX-02, 66점 WATCH(`Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, 대체 없음). 두 숫자는 서로 다른 실행이라 섞지 않습니다.
- 발표는 운영 사이트에서 `?origin=demo`로 운영 DB의 DEMO 데이터를 보입니다(D1, `demo:reset` 안 함). 운영 DEMO 19건 삭제는 발표 뒤로 미뤘습니다.
- 진행 중: 첨부 처리(다운로드·파서·documents worker) 구현(2026-10-27 착수). 실제 나라장터 공고 분석은 아직 0건입니다(본문이 비어 `409 ANALYSIS_SOURCE_MISSING`). S-LIVE와 카카오 실수신 녹화(카카오 연결 0건)는 첨부 처리 구현 뒤입니다.
- 미구현·미측정: Qwen 설명 생성(설명은 템플릿). 모델 비교 E1'~E4는 미측정이고, 회사 GPU 학습(X6) 실행 여부는 미결정입니다. 메일 알림(ADR-041)은 해커톤에서 뺐습니다.
- 검증: main `26efefc1`에서 전체 `pnpm verify` exit 0(루트 230·web 689·AI 153·결정 57·빌드). GitHub Actions는 2026-10-24부터 계정 결제 문제로 job이 시작되지 않아 로컬 pre-push 게이트로 검사합니다.

### 실제인 것과 mock인 것 (요약)

정본은 [해커톤 문서 §7 정직성 표](docs/18-HACKATHON.md)이고, 기술적 한계와 실행 모드 구분은 [제출물 한계 문서](docs/submission/limitations.md)에 있습니다. 둘과 다르면 그쪽이 맞습니다.

| 영역 | 상태 |
| --- | --- |
| 공고 데이터 | `live`는 실제 나라장터 공고, `fixture`·`mock`은 가상 공고 20건(`DEMO` 배지) |
| 회사 프로필 | 모든 모드에서 가상 솔리데오(회사명·부서/직급만 실제, 인물 200명·사진·자격·실적·재무는 가상) |
| 자격 판정·SOL Score·권고 | 실제 구현(결정론적 규칙, 골든 시험). 골든 94/72/68은 `mock`에서만 단언 |
| Qwen 요구조건 추출 | `mock`은 고정 응답. 회사 vLLM API probe 통과(2026-10-21, served id `Qwen3.8-Flash-Next-AWQ-INT4`). 운영 앱 경로 실추론 1건(2026-10-24, 가상 공고 FX-02) |
| 결정 모델 Bosun v3.1 0.6B | `mock`은 고정 응답. 운영 실추론 1건(2026-10-24, FX-02). 참고 지표이며 점수·자격·권고에 반영하지 않음 |
| 첨부(RFP) 다운로드·파싱 | 구현 중(2026-10-27 착수). 지금 운영은 첨부 목록만 저장하고, 분석은 공고 본문과 API 구조화 필드로만 함 |
| 카카오톡 알림 | main 병합(`73eac5a8`), 기본 `mock` 발송. 카카오 연결 0건, 실제 공고 수신 녹화는 첨부 처리 구현 뒤 |
| S-LIVE 실제 공고 장면 | 사전 run 조회 방식. 운영 실공고 분석 0건, 첨부 처리 구현 뒤 실행 |
| 모델 평가 E1'~E4 | 미측정. 회사 GPU 학습(X6) 실행 여부 미결정 |
| 결제·모바일·자동 투찰·승률 예측 | 범위 외 |

## 해결하려는 문제

입찰 검토 담당자는 여러 공고를 확인하면서 다음 사항을 반복적으로 판단해야 합니다.

- 우리 회사가 참가 자격을 충족하는가?
- 보유 기술과 사업 실적이 요구사항에 부합하는가?
- 어떤 공고를 먼저 검토해야 하는가?
- 참여 판단의 근거와 추가 확인 사항은 무엇인가?

SOL RADAR는 이 검토 과정을 데이터와 AI 분석으로 지원합니다.
최종 입찰 참여 여부는 사용자가 결정합니다.

## 핵심 기능

| 기능 | 설명 |
| --- | --- |
| 공공사업 정보 수집 | 공식 API를 통한 발주계획·사전규격·입찰공고 수집 |
| 공고 탐색 | 키워드·기간·사업 단계 등으로 검색 및 필터링 |
| 기업 프로필 관리 | 보유 기술·자격·사업 수행 실적 관리 |
| 참가 자격 검토 | 공고 요구사항과 기업 정보를 비교하여 충족·미충족·확인 필요 표시 |
| SOL Score | 규칙 기반 적합도 점수와 항목별 산정 근거 제공 |
| AI 분석 | 요구사항 구조화, 참여 권고, 판단 근거 및 확인 사항 제공 |
| 검토 이력 관리 | 담당자의 검토 의견과 최종 참여 결정 기록 |
| 변경 알림 | 관심 공고의 변경 사항과 검토 필요 사항 안내 |

## MVP 범위

첫 번째 MVP는 한 기업을 기준으로 다음 흐름을 구현합니다.

공고 수집 → 기업 프로필 대조 → 자격 검토 → SOL Score 산정
→ 참여 권고 → 담당자 검토 및 최종 결정

참여 권고는 다음 세 가지로 구분합니다.

- **BID**: 참여 검토를 우선 진행할 사업
- **WATCH**: 추가 정보 확인이나 조건 검토가 필요한 사업
- **NO-BID**: 참가 자격 또는 수행 조건상 참여를 권고하지 않는 사업

확인이 필요한 필수 자격이 남아 있으면 자동으로 BID를 권고하지 않습니다.

경쟁사·낙찰 이력 분석, 인력 배치 확정·AI 추천은 후속 단계에서 확장합니다. 인력 배치는 저장하지 않는 규칙 매칭 시뮬레이션(N7)까지 들어가 있습니다.

외부 메시지 알림은 카카오톡 "나에게 보내기"로 추천 공고(BID·WATCH 권고)를 보내는 기능이 main에 병합돼 있습니다(ADR-038, `73eac5a8`). 기본은 `mock` 발송이고, 실제 수신은 아직 확인하지 않았습니다(카카오 연결 0건, 2026-10-27). 운영 경로인 카카오 알림톡과 메일 알림(ADR-041, 해커톤 제외)은 후속입니다.

## 솔리데오 가상 직원·가입 정보

사용 회사는 솔리데오로 고정합니다. 원본 조직도 팀명·직급/직책은 유지하고 가상 직원 명부 200명(남성 100·여성 100)을 비례 배치합니다. 이름은 실제 사용되는 한글 세 글자 이름을 참고하되 원본 이름과 중복하지 않으며, 고유 정장 프로필 이미지 200장을 연결합니다. 이메일 가입은 부서·직급/직책 필수, 간편 가입자는 첫 로그인 때 입력합니다.

구현돼 있습니다. 명부·선택 목록·이미지 manifest는 `fixtures/people/solideo.*.json`(생성 스크립트 `scripts/people/`), 사진은 `web/public/demo/people/<personId>.png` 200장, 가입 폼·DB는 `supabase/migrations/20261016000001_solideo_people_signup.sql`입니다. 실제 회사명·부서/직급을 제외한 인물·사진·실적·재무 등은 가상 데모 설정입니다. [승인 스펙](polaris/specs/done/2026-10-16-solideo-people-signup.md)과 [결정 기록 ADR-019](docs/16-DECISIONS.md)를 참고하세요.

## 기술 스택

다음은 목표 아키텍처이며, 실제 적용 상태는 구현에 따라 갱신합니다.

| 영역 | 기술 | 역할 |
| --- | --- | --- |
| 기반 프로젝트 | agentic-boilerplate | 초기 개발 환경 및 공통 기능(조직·역할·인증 견본, 검증 게이트) |
| 웹·서버 | Next.js · TypeScript | 서비스 화면, API(Route Handler `/api/v1`), 서버 도메인 로직(`web/server`) |
| 데이터베이스·인증 | Supabase (Postgres · RLS · Auth) | 공고·기업·분석·검토 이력 저장, 조직별 접근 제어(RLS), 로그인 |
| 큐·캐시 | Redis · BullMQ | 비동기 수집 및 분석 작업(worker `web/worker`) |
| AI 서비스 | Python · FastAPI | AI 모델 연동 및 분석 파이프라인(`services/ai`) |
| AI 모델 | Qwen3.8-Flash-Next(회사 운영 vLLM API) · Bosun v3.1 0.6B(결정 모델) | 요구사항 구조화 및 의사결정 보조. `KEV_*`·`/kev` 이름은 호환 유지(ADR-034) |
| 벡터 검색 | Qdrant | 관련 문서 및 근거 검색 |
| 파일 저장 | Supabase Storage | 공고 첨부파일 및 원본 문서 보관 |
| 웹 배포 | Vercel | 운영 web(`https://www.solideos-radar.com`). ADR-049에 따라 web만 실행 |
| 회사 분석 런타임 | Docker Compose(`infra/compose.company.yaml`) | 회사 서버의 redis-api·AI gateway·Worker. 회사의 기존 Redis를 재사용 |
| 로컬 데모 실행 환경 | Docker Compose(`infra/compose.yaml`) | redis·qdrant·ai-gateway·worker 4개. DB·Auth·Storage는 Supabase, 웹은 호스트에서 `pnpm -C web start` |

DB·인증·Storage는 Supabase 클라우드 프로젝트를 씁니다. 웹은 Vercel 운영 주소 https://www.solideos-radar.com 입니다(첫 운영 배포 2026-10-22 READY, 이후 main push 때 자동 배포). [결정 기록](docs/16-DECISIONS.md) ADR-049에 따라 Vercel은 web만 실행하고, 분석·수집 요청은 서비스 token과 사용자 JWT를 붙여 HTTPS로 회사 Gateway(redis-api)에 넘깁니다. 회사 Compose의 Worker가 큐를 처리하고 AI gateway가 모델을 부릅니다. 수집은 회사의 수집 전용 Worker가 3시간마다 돌립니다. 로컬 데모 Compose 경로는 대체 경로로 유지합니다([배포](docs/10-DEPLOYMENT.md)).
모델은 추출·설명용 Qwen3.8-Flash-Next(회사 운영 vLLM API)와 결정 모델 Bosun v3.1 0.6B로 확정했습니다(ADR-034). 운영 앱 경로의 실추론은 2026-10-24 가상 공고 1건으로 확인했고, 실제 공고 분석은 첨부 처리 구현 뒤입니다.

## 데이터와 분석 원칙

- 공공데이터는 공식 API를 우선 사용합니다.
- 분석 결과에는 원문 출처와 판단 근거를 연결합니다.
- SOL Score는 기업과 사업의 적합도 지표이며, 수주 확률을 의미하지 않습니다.
- 근거가 부족한 항목은 추측하여 채우지 않고 확인 필요 상태로 표시합니다.
- AI를 사용할 수 없어도 규칙 기반 자격 검토와 점수 산정이 가능하도록 구성합니다.
- 샘플 데이터와 실제 수집 데이터는 화면에서 구분합니다.
- 기업 정보와 첨부파일은 권한에 따라 접근을 제한합니다.

## 개발 시작

명령의 정본은 `AGENTS.md`입니다. 요약하면 다음과 같습니다.

- Node 버전은 루트 `package.json`의 `engines` 범위, 패키지 매니저는 pnpm입니다.
- 설치: 루트와 `web/`에서 각각 `pnpm install`.
- 로컬 DB: `pnpm db:start`(Docker·Supabase CLI 필요. 마이그레이션을 적용하고 `web/.env.local`을 채웁니다). 시험 계정은 `pnpm db:seed`, 데모 데이터는 `pnpm demo:reset`.
- 웹 실행: `pnpm -C web dev`.
- Compose(redis·qdrant·ai-gateway·worker)와 데모 당일 기동 절차: [배포](docs/10-DEPLOYMENT.md). 환경변수 키 이름은 `.env.example`·`web/.env.example`·`infra/env/*.env.example`.
- 검증: 개발 중 `pnpm verify:changed`, 통합·제출 전 `pnpm verify`(빌드를 뺀 전체 검사는 `pnpm verify:quick`).

### `mock` 데모 기동 요약

정본은 [배포 문서의 "데모 당일 기동 절차"](docs/10-DEPLOYMENT.md#데모-당일-기동-절차)입니다. 단계마다 통과 기준과 저장할 증거가 거기 있습니다.

1. env 준비: `cp infra/env/demo.env.example infra/.env` 뒤 값을 채우고 `web/.env.local`·루트 `.env.local`도 채웁니다. `pnpm check:env`가 placeholder 0건이면 통과.
2. DB 확인: `pnpm db:verify`(마이그레이션·RLS 확인. 당일에 `pnpm db:push`로 고치지 않습니다).
3. 서비스 기동: `docker compose -f infra/compose.yaml up -d --build` → redis·qdrant·ai-gateway·worker 4개 `healthy`.
4. 웹 기동: `pnpm -C web build` 뒤 `pnpm -C web start`(:3000).
5. 데모 데이터: `pnpm demo:reset`(마지막 줄 `seed: orgs=2 … people=200 … bids=19 …` 확인).
6. 상태 확인: `curl -s http://localhost:3000/health/ready`에서 `checks.ai`가 `mock`.
7. 사전 분석: `pnpm demo:preanalyze`(18건 `COMPLETED`, 사용자 확인 뒤).

API 키, Supabase service role 키, 데이터베이스 연결 문자열 등 비밀 값은 Git에 커밋하지 않습니다.

## 프로젝트 문서

기획·설계·진행 기록은 `docs/`에 있습니다. 이 폴더가 Obsidian Vault이므로 Obsidian에서 `docs/`를 Vault로 엽니다.

- [문서 인덱스](docs/00-README.md)의 문서 표에 있는 설계 문서가 정본입니다. 독자별 읽는 순서도 거기에 있습니다.
- `docs/PROGRESS.md`: 진행 상황과 작업 로그
- `docs/boilerplate/`: 저장소를 시작한 템플릿(agentic-boilerplate)의 문서. 설계 문서와 다르면 설계 문서가 우선합니다.

| 문서 | 내용 |
| --- | --- |
| [문서 인덱스](docs/00-README.md) | 전체 문서 표와 읽는 순서 |
| [PRD](docs/01-PRD.md) | 제품 요구사항 및 MVP 범위 |
| [아키텍처](docs/02-ARCHITECTURE.md) | 서비스 구성 및 역할 |
| [AI 파이프라인](docs/03-AI-PIPELINE.md) | 실행 모드, 모델 연동 및 분석 흐름 |
| [데이터베이스](docs/04-DATABASE.md) | Supabase 스키마·RLS 정책 및 ERD |
| [API 명세](docs/05-API-SPEC.md) | API 계약(`/api/v1`) |
| [UI·UX](docs/06-UI-UX.md) | 데스크톱 전용 화면 및 사용자 흐름 |
| [데이터 수집](docs/07-DATA-PIPELINE.md) | 공식 API 수집 및 정규화, fixture 20건 |
| [점수 산정](docs/08-SCORING.md) | SOL Score 및 권고 기준 |
| [보안](docs/09-SECURITY.md) | 인증·권한·정보 보호·책임 있는 AI |
| [배포](docs/10-DEPLOYMENT.md) | Vercel·회사 Compose·Supabase 실행 환경, 로컬 Compose 기동 절차 |
| [테스트](docs/11-TESTING.md) | 검증 및 수용 기준, `docs/evidence/` |
| [로드맵](docs/12-ROADMAP.md) | 구현 순서 및 해커톤 컷 |
| [결정 기록](docs/16-DECISIONS.md) | ADR·미결정 사항 |
| [해커톤](docs/18-HACKATHON.md) | 피치·심사 기준 매핑·정직성 표 |
| [데모 시나리오](docs/19-DEMO-SCENARIO.md) | 클릭 경로·장애 대체 시연 |
| [진행 상황](docs/PROGRESS.md) | Phase 체크리스트 및 작업 로그 |

## AI와 함께 개발하기

작업 지침은 루트 `CLAUDE.md`(`docs/CLAUDE.md`를 먼저 불러옵니다)와 `AGENTS.md`, 구현 규칙은 [17 구현 규칙](docs/17-CLAUDE-IMPLEMENTATION.md)입니다.
기능 구현 전 관련 요구사항과 API·데이터 계약을 확인하고, 변경에 맞는 검증을 수행합니다. 설계 변경과 미결정 사항은 [결정 기록](docs/16-DECISIONS.md)에 기록합니다.
