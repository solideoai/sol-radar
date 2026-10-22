---
title: "00. SOL RADAR 문서 인덱스 (MOC)"
doc: "00"
status: draft
tags:
  - sol-radar
  - moc
updated: 2026-10-21
---

# SOL RADAR — 구현 문서 인덱스

커밋된 미통합 브랜치의 현재 기능/이력 대응과 운영 미적용 경계는 [2026-10-22 통합 기록](evidence/committed-integrations/integration.md)을 따른다. 과거 브랜치의 설계/화면 증거는 당시 기록으로 보존한다.

> [!note] 2026-10-22 배포 기준 (ADR-049)
> Vercel은 web 하나, 회사는 기존 Redis·redis-api·AI gateway·Worker를 맡는다. web의 AI binding은 제거하며 관리자 AI 상태는 인증된 회사 API로 조회한다. [회사 실행서](../infra/company/README.md)와 [[10-DEPLOYMENT]]를 따른다. 코드 준비와 회사 기동·실추론 완료는 구분한다. 아래 날짜가 붙은 web/AI Vercel 구성은 이전 실행 이력이다.

> 해커톤 구조([[16-DECISIONS|ADR-017]]): Next.js App Router(`web/` — 화면·Route Handler `/api/v1`·서버 도메인 `web/server/<도메인>`) + Supabase(Postgres·RLS·Auth) + Redis/BullMQ(worker `web/worker`) + Qdrant + Supabase Storage + Python AI Service(Qwen3.8-Flash-Next, Bosun 결정 모델) + Docker Compose. 해커톤 뒤에는 API·worker를 NestJS로 옮긴다([[16-DECISIONS|ADR-028]]).

## 10줄 요약

1. SOL RADAR는 공공 SI·AX 기업 영업팀이 **"이 입찰에 참여해야 하는가"** 를 근거와 함께 판단하도록 돕는 의사결정 지원 플랫폼이다.
2. 나라장터 공식 Open API로 실제 공고(발주계획·사전규격·입찰공고)와 RFP 첨부를 수집·파싱하고 변경을 revision으로 추적한다. 실행 모드는 `live`(실제 API + 실제 AI)·`fixture`(저장 공고 + 실제 AI)·`mock`(저장 공고 + mock AI) 셋이다([[16-DECISIONS|ADR-020]]).
3. Qwen이 공고문에서 요구조건을 **원문 인용과 함께** JSON으로 추출한다. 인용이 원문과 맞지 않으면 무효다.
4. 회사 프로필과 대조해 필수 자격을 `SATISFIED / NOT_SATISFIED / NEEDS_REVIEW`로 판정한다. 법적 자격을 자동 확정하지 않는다.
5. SOL Score(0~100)는 **결정론적 규칙**으로 계산하고 5개 요소·입력 스냅샷·알고리즘 버전을 저장한다. 낙찰 확률이 아니다.
6. Bosun v3.1 0.6B(소형 결정 모델, [[16-DECISIONS|ADR-034]]. 이름 `KEV_*`·`/kev`는 호환 유지)는 요구사항별 충족 분류·기술 적합성·실적 연관성·수행 리스크를 확률로 내는 **참고 지표**다. 점수에 넣지 않고 규칙 판정을 뒤집을 수 없으며, 분포는 충족 확률·수주확률이 아니라고 UI에 고지한다. 성능은 실제 공고 평가셋으로 잰다([[21-MODEL-TRAINING]]).
7. 시스템은 **권고**만 하고, 최종 결정은 사람이 사유와 함께 `bid_reviews`에 기록한다.
8. 모델이 꺼져도 규칙만으로 `PARTIAL` 결과를 낸다. 공공 API·모델 서버에 장애가 나도 `fixture`·`mock` 모드로 전 기능이 돈다. 실패 유형(API·첨부 다운로드·파싱·모델 서버)은 따로 표시하고, mock으로 바꾼 결과는 반드시 mock이라고 표시한다. DEMO 데이터는 DEMO로 표시한다.
9. 테넌트 격리(`org_id` + Supabase RLS), Supabase Auth 세션, 외부 문서 불신 처리, 감사 로그를 기본으로 한다.
10. 해커톤 범위: 결제·모바일·자동 투찰·승률 예측은 **범위 외**. 데스크톱 전용.

## 읽는 순서

| 독자 | 순서 |
|---|---|
| 심사위원(사람) | [[18-HACKATHON]] → [[01-PRD]] → [[19-DEMO-SCENARIO]] → [[08-SCORING]] → [[03-AI-PIPELINE]] → [[21-MODEL-TRAINING]] → [[11-TESTING]] |
| 심사(AI) | 이 문서의 §주장과 근거 → [[16-DECISIONS]] → [[15-DATA-CONTRACTS]] → [[11-TESTING]] → 나머지 번호 순 |
| 구현자(Claude Code) | [[CLAUDE]] → 이 문서 → [[17-CLAUDE-IMPLEMENTATION]] → 01~05 계약 확정 → [[12-ROADMAP]] 해커톤 컷 순서 |

## 구현 규칙

절대 규칙(스택·코드 위치·RLS·결제·모바일 금지·hosted 모델과 클라우드 GPU 승인·실행 모드와 mock 표시·DEMO 표시)과 해커톤 우선순위, 단계마다 계획 → 코드 → 테스트 → 증거 → 보고 순서는 [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]이 정본이다. 실행 지침은 [[CLAUDE]], 폴더 구조는 [[02-ARCHITECTURE|02 아키텍처]] monorepo 절이다. 아래는 17에 없는 원칙만 둔다.

1. 01~05의 계약부터 확정한다. 미결정 사항은 [[16-DECISIONS|16 ADR]]에 기록한다.
2. MVP의 end-to-end 세로 기능은 **실제 공고 수집 → 첨부 파싱 → Qwen 추출 → 자격 검증 → 결정 모델 참고 지표 → SOL Score → BID/WATCH/NO-BID → 대시보드 → 알림 이벤트**다. 첫 단계는 외부 의존성(실제 API 응답·첨부 다운로드·회사 GPU 추론 엔드포인트 접속) 조기 점검이다([[12-ROADMAP|12 로드맵]]).
3. 정확하지 않은 수주확률, 평가위원 점수, 미래 발주예측은 만들어내지 않는다. 근거 미확보 시 `INSUFFICIENT_DATA`로 표시한다.

## 문서

| 번호 | 문서 | 목적 |
|---|---|---|
| 01 | [[01-PRD]] | 제품 요구사항 / MVP 범위 / 차별점 / 성공 지표 |
| 02 | [[02-ARCHITECTURE]] | 서비스 경계·흐름·데모 토폴로지 |
| 03 | [[03-AI-PIPELINE]] | 실행 모드·env 플래그 / 파이프라인 v0.2(`/parse`·`/extract`·`/kev`·`/explain`) / Qwen `RequirementExtraction` 스키마·프롬프트 / 결정 모델(Bosun) 질문 세트 `kev-qs/v0.1`·`v0.2`·state 추적·mock adapter / 모델 레지스트리 / 장애·수용 기준 |
| 04 | [[04-DATABASE]] | Supabase Postgres 스키마·RLS 정책·ERD·ENUM·seed 범위·식별자 규칙 |
| 05 | [[05-API-SPEC]] | Route Handler(`/api/v1`) 계약·Supabase Auth·DTO(zod)·오류 코드·예시 |
| 06 | [[06-UI-UX]] | 데스크톱 전용 화면 명세·디자인 토큰·라우트별 상태 표·상세 와이어프레임·분석 상태 머신 |
| 07 | [[07-DATA-PIPELINE]] | 나라장터 Open API 수집·첨부 다운로드·문서 파서 / Connector·정규화·변경 감지 / fixture 20건 명세(`FX-01`~`FX-20`)·mock 추출·mock Kev 값 |
| 08 | [[08-SCORING]] | SOL Score 정규화 함수·missing 정책·결정 정책·솔리데오 프로필(단일 원천)·worked example 3건 |
| 09 | [[09-SECURITY]] | 인증(Supabase Auth)·RLS·RBAC 표(`sol_role`)·위협 대응·책임 있는 AI(HITL·고지 문구·프롬프트 인젝션·감사 필드) |
| 10 | [[10-DEPLOYMENT]] | Vercel 웹·AI 다중 서비스 구성 / Docker Compose(redis·qdrant·ai-gateway·worker) 실행 프로필(demo / ai-local / ai-hosted)·Supabase 클라우드 연결·데모 당일 기동 절차·장애 주입 |
| 11 | [[11-TESTING]] | 테스트 매트릭스·골든 `G1`~`G10` ↔ fixture ↔ 테스트 파일·데모 수용 체크리스트·`docs/evidence/` |
| 12 | [[12-ROADMAP]] | Phase 순서·해커톤 컷(핵심 컷 / 확장 컷 / P1 / 이후)·파인튜닝 트랙 X6·Critical Path·D-day까지 일정 |
| 13 | [[13-NOTIFICATIONS]] | 알림 outbox / 인앱 P0 / 카카오톡 나에게 보내기(ADR-038, 구현 중)·알림톡 P1 |
| 14 | [[14-OBSERVABILITY]] | 모니터링·운영·데모 지표 |
| 15 | [[15-DATA-CONTRACTS]] | `EvidenceRef`·`FieldState`·`NormalizedBid` 정식 정의 / 인용 검증 알고리즘 / 격리 규칙 / registry 키 |
| 16 | [[16-DECISIONS]] | ADR / 검증 상태 / 미결정 사항 |
| 17 | [[17-CLAUDE-IMPLEMENTATION]] | Claude Code 작업 패턴 / 해커톤 모드 |
| 18 | [[18-HACKATHON]] | 피치·차별점·심사 기준 매핑·데모 스크립트·Q&A·정직성 표 |
| 19 | [[19-DEMO-SCENARIO]] | 데모 기업·fixture 스토리·클릭 경로·장애 대체 시연 |
| 20 | [[20-GLOSSARY]] | 용어집 (단일 원천) |
| 21 | [[21-MODEL-TRAINING]] | 평가셋(실제 공고 × 가상 기업)·평가 지표·오류 분석·Bosun LoRA 파인튜닝 전략(착수 판단·E4 비교. 실행 절차는 22)·모델 레지스트리 |
| 22 | [[22-FINETUNE-RUNBOOK]] | 회사 GPU 파인튜닝 실행서: 모델 출처(Hugging Face·GitHub 리비전)·학습 환경·Bosun 학습 데이터 제작·학습·보정·병합·반입 명령(Qwen 파인튜닝은 하지 않는다) |
| 23 | [[23-WEEKEND-FINETUNE]] | 주말(10-24~25) 회사 GPU 파인튜닝 계획: 엔드포인트(등록 location 하나, 학습본은 서버 안 오프라인 채점)·오픈 데이터 출처(나라장터 API × 가상 기업 구성 라벨. Kev 공개 replay 는 퇴역)·Hugging Face 모델(Bosun v3.1 0.6B, Qwen 은 회사 API) 선택·시간표·대체 경로 |
| — | [[CLAUDE]] | Claude Code 지침 (루트 `CLAUDE.md`가 `@docs/CLAUDE.md`로 먼저 불러온다, ADR-015) |
| — | [[PROGRESS]] | 진행 상황·작업 로그 (저장소 경로 `docs/PROGRESS.md`) |

## 주장과 근거 (AI 심사 보조)

| 주장 | 어디서 확인하나 | 검증 수단 |
|---|---|---|
| 수주확률을 표시하지 않는다 | [[03-AI-PIPELINE]] 품질 가드레일, [[06-UI-UX]] 상세 화면 상태, [[18-HACKATHON]] §7 | G4 ([[11-TESTING]]) |
| 점수는 결정론적이고 재현 가능하다 | [[08-SCORING]] 점수표·정규화 함수, [[04-DATABASE]] `score_runs.input_snapshot`, `algorithm_version` | Scoring Vitest goldens |
| 결정 모델(Bosun)은 규칙 판정을 뒤집을 수 없다 | [[08-SCORING]] 결정 모델 처리, [[03-AI-PIPELINE]] 가드레일 | G3 |
| AI 없이도 결과가 나온다 | [[02-ARCHITECTURE]] 장애 원칙, [[10-DEPLOYMENT]] demo 프로필 | G6 |
| 근거 인용은 원문과 대조된다 | [[15-DATA-CONTRACTS]] `EvidenceRef` 검증 | AI pytest citations |
| 사람이 최종 결정하고 기록이 남는다 | [[08-SCORING]] 결정 정책, [[04-DATABASE]] `bid_reviews`, `audit_logs` | E2E 로그인→공고→분석→검토 |
| 같은 공고를 두 번 수집해도 중복이 없다 | [[07-DATA-PIPELINE]] 변경 감지, [[04-DATABASE]] UNIQUE 제약 | G1·G2, Pipeline Vitest |
| 다른 조직 데이터를 볼 수 없다 | [[09-SECURITY]] RBAC·IDOR·RLS, [[04-DATABASE]] `org_id` RLS 정책, [[05-API-SPEC]] `orgId` 세션 결정 | G5, RLS 정책 시험(PGlite)·Route Handler 시험·E2E |
| 데모 데이터는 가상이며 그렇게 표시된다 | [[04-DATABASE]] `is_demo`, [[06-UI-UX]] DEMO 배지, [[18-HACKATHON]] §7 | G8 |
| 근거 없는 값은 만들지 않는다 (`UNKNOWN`·`CONFLICTED`로 남긴다) | [[15-DATA-CONTRACTS]] §2 `FieldState`, §5 인용 검증 | AI pytest schema·citations |
| 분석은 재현 가능한 키로 식별된다 | [[04-DATABASE]] `score_runs`(revision_id, company_profile_id, algorithm_version, prompt_hash, input_snapshot) | `pnpm test:db` (제약·정책 시험, PGlite) |
| 결정 모델은 보수적 방향으로만 영향을 준다 | [[03-AI-PIPELINE]] §5.5 질문별 사용처·규칙 충돌 처리 | G3, AI pytest adapter |
| 결정 모델 Bosun v3.1 0.6B는 실재하는 Apache-2.0 모델이다. 학습 데이터가 영어이며 한국어 성능은 미검증이다 | 아래 §출처, [[16-DECISIONS]] 미결정 24번, [[03-AI-PIPELINE]] §5.6 영어 템플릿 | 2026-10-20 Hugging Face 리비전 `5e78a37c` 확인(ADR-034). 한국어/영어 비교는 평가셋 E1'·E2([[21-MODEL-TRAINING]]) |
| 외부 API 필드를 지어내지 않았다 | [[07-DATA-PIPELINE]] registry 절, [[16-DECISIONS]] 미결정 1번 | data.go.kr 명세 확인(2026-10-16), 실응답 확인(2026-10-19 C1, `fixtures/recorded/`, `docs/evidence/phase-0/external-deps-api-20261019.md`. 설계 가정과 다른 점은 같은 문서 §10) |
| 모델 성능 주장은 평가셋 숫자로만 한다 | [[21-MODEL-TRAINING]] 지표·신뢰구간·오류 분석 | `docs/evidence/eval/` 리포트 |
| 파싱에 실패한 내용을 AI가 추측해 채우지 않는다 | [[03-AI-PIPELINE]] 장애와 대체, [[15-DATA-CONTRACTS]] 인용 검증 | 파싱 실패 fixture 시험([[11-TESTING]]) |

## Obsidian 규약

- 이 폴더가 vault이자 저장소의 `docs/` 폴더다. 파일 이름은 바꾸지 않는다 (위키링크가 파일명 기준).
- `boilerplate/`는 저장소를 시작한 템플릿(agentic-boilerplate)의 문서다. vault 규약 대상이 아니며 검색·그래프에서 제외한다(`.obsidian/app.json`). ADR-017 이후 Supabase(DB·RLS·인증)와 `web/server/<도메인>` 구조를 다루는 템플릿 문서는 SOL RADAR에도 적용된다. Expo(`mobile/`)·EAS 문서는 적용하지 않는다. Vercel 웹·AI 구성은 2026-10-21 승인됐고 실행 기준은 [[10-DEPLOYMENT|10 배포]] Vercel 절이다. Compose 데모와 Vercel 구성의 로컬 검증·실제 클라우드 배포 상태를 구분한다. 이 vault의 문서와 다르면 이 vault의 문서가 우선한다. 분류는 `boilerplate/README.md`.
- 모든 문서에 frontmatter(`title`, `doc`, `status`, `tags`, `updated`)를 둔다. `status`는 `draft → review → final`. 태그는 `sol-radar` + 주제 1~3개(`product`, `architecture`, `ai`, `pipeline`, `db`, `api`, `ui`, `scoring`, `security`, `ops`, `test`, `decision`, `hackathon`, `demo`, `glossary`, `moc`).
- 문서 간 참조는 `[[05-API-SPEC|05 API 명세]]` 형식의 위키링크. 문서 끝에 `## 관련 문서`를 둔다.
- 콜아웃: `> [!warning] 미검증 가정`, `> [!success] 검증됨 (날짜, URL)`, `> [!todo]`, `> [!tip] 심사 포인트`.
- 다이어그램은 Mermaid. 용어는 [[20-GLOSSARY]]를 따른다.

## 출처 및 주의

> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev)
> Kev는 Jared Palmer가 공개한 Apache-2.0 소형 결정 모델이다. Qwen3.5 기반 Kev-0.8B / 4B(권장) / 9B, Qwen3.8 기반 Kev-27B가 "Kev 1.0"으로 함께 릴리즈되었다(GitHub 태그 `kev-1.0`, Hub 태그 `v1.0`). 서버 실행은 `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0 --port 8009` (README: `@v1.0`은 항상 같은 가중치를 로드. quickstart는 태그 없이 적혀 있다). API는 TypeSafe System One 호환 `POST /v1/systemone`, 질문 타입 `noul` / `choice` / `score`. `pip install kev`는 무관한 패키지이므로 소스에서 설치한다. 모델 카드(`docs/model-cards/kev-4b.md`)는 `Languages: English`이며 영어 외 언어는 잘 동작하지 않는다고 명시한다. 따라서 한국어 입찰 도메인 성능은 미검증이고, 입력은 영어 템플릿 state로 변환해 전달한다([[03-AI-PIPELINE]] §5.6). 호스팅 제공처(OpenRouter 등) 가용성은 확인되지 않았다(2026-10-16 페이지 404).
> 퇴역(2026-10-20 ADR-034). 현재 결정 모델은 Bosun v3.1 0.6B(`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`), 검증은 [계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §1. 위는 Kev 당시 기록이다.

- 조달청 데이터: https://www.data.go.kr/ — 입찰공고정보서비스(15129394)·사전규격(15129437)·발주계획(15129462)·업종 및 근거법규(15129467)의 오퍼레이션·필드 이름은 2026-10-16 서비스 페이지 명세로 확인했다. 서비스키로 받은 실제 응답은 2026-10-19 C1 ①(공공 API A1~A9)·②(첨부 B1~B4)에서 확인했다. 마스킹한 응답 14건은 `fixtures/recorded/`, 호출 기록과 설계 가정과 다른 점 8건은 `docs/evidence/phase-0/external-deps-api-20261019.md`에 있다([[16-DECISIONS]] 미결정 1번).
- Kev 학습·평가 도구(`kev.train`·`kev.benchmark`·`kev.compare`, `--init_from`)는 2026-10-16 저장소 main `1f04cfa`에서 확인했다([[22-FINETUNE-RUNBOOK]] §2). 기본 모델은 Kev-9B@v1.0이었다(ADR-020, 당시 기록). **퇴역(2026-10-20 ADR-034)**: 결정 모델은 Bosun v3.1 0.6B, 학습·채점 도구는 우리 `sol_decision.train`(학습)·`sol_eval.bosun_score`(채점)이고 main `1b68f9b`(B1)에 있다. 회사 서버에서 실모델로 돈 기록은 아직 없다. 추출·설명은 회사 운영 vLLM API의 Qwen3.8-Flash-Next다.
- 현재 문서는 구현용 설계안이다. 외부 API 필드/호출 한도, 모델 성능, 카카오 발송 조건은 검증 전 확정 사실로 취급하지 않는다. 검증 상태는 [[16-DECISIONS|16 ADR]]에 날짜와 함께 기록한다.

## 솔리데오 가상 인력·가입 결정

ADR-019에 따라 회사는 솔리데오로 고정하고 가상 직원 200명·남녀 100/100·고유 정장 사진 200장·가입 부서/직급 필수 선택을 설계했다. 원본 실명은 재사용하지 않는다. 이름·사진 경로와 생성/검증 규칙은 [[07-DATA-PIPELINE]], 가입 화면은 [[06-UI-UX]], 검증은 [[11-TESTING]] PPL-01~07, [승인 스펙](../polaris/specs/done/2026-10-16-solideo-people-signup.md)에 있다. 구현 상태와 남은 일은 [[PROGRESS]]의 솔리데오 절을 따른다.

## 검토 중: 공공 입찰 수집 확장·업무 UI (2026-10-21)

기존 조달청4서비스 유지와 신규6서비스, Source/발주기관/단계/분야 분리, 고유 사업기회 집계, 대시보드·입찰 공고·수집 운영 화면을 [승인용 설계](../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md)에 정리했다. [[2026-10-21-public-procurement-expansion-plan|Phase0~8 계획]], [[20261021-review|구현/공식 API 조사]]와 [[16-DECISIONS|ADR-047 제안]]을 함께 읽는다.

**현재 계약의 교체나 기능 완료가 아니다.** 정본과 충돌하는 모델·원본보존·넓은 수집·UI 스크롤 정책은 승인 전 제안이다. KEPCO 키는 발급 완료(사용자 확인), 실호출 미검증이다. Redis Gateway/Storage/인력200명 작업은 해당 branch와 현재 main을 구분한다. 구현·DB 적용·배포·운영 재수집은 시작하지 않았다.

## 관련 문서

- [[18-HACKATHON|18 해커톤 전략]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[16-DECISIONS|16 ADR]]
- [[20-GLOSSARY|20 용어집]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]
- [[PROGRESS|진행 상황]]


ADR-047은 2026-10-21 후속 구현 승인으로 채택됐다. 위 확장 절의 “제안/미구현/승인 전”과 병렬 작업 설명은 최초 설계 시점 기록이다. [격리 구현 보고](evidence/procurement-expansion/20261021-implementation.md)와 2026-10-22 추가 승인에 따른 [main 통합·운영 적용 기록](evidence/procurement-expansion/20261022-release.md)에서 현재 코드·검증·실제 적용 여부를 구분한다. 기존 모델·점수·권한·DEMO 정책은 유지한다.
