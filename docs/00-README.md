---
title: "00. SOL RADAR 문서 인덱스 (MOC)"
doc: "00"
status: draft
tags:
  - sol-radar
  - moc
updated: 2026-10-16
---

# SOL RADAR — 구현 문서 인덱스

> 최종 아키텍처: Next.js App Router(`web/` — 화면·Route Handler `/api/v1`·서버 도메인 `web/server/<도메인>`) + Supabase(Postgres·RLS·Auth) + Redis/BullMQ(worker `web/worker`) + Qdrant + MinIO + Python AI Service(Qwen, Kev) + Docker Compose ([[16-DECISIONS|ADR-017]]).

## 10줄 요약

1. SOL RADAR는 공공 SI·AX 기업 영업팀이 **"이 입찰에 참여해야 하는가"** 를 근거와 함께 판단하도록 돕는 의사결정 지원 플랫폼이다.
2. 공고(발주계획·사전규격·입찰공고)를 수집하고 변경을 revision으로 추적한다.
3. Qwen이 공고문에서 요구조건을 **원문 인용과 함께** JSON으로 추출한다. 인용이 원문과 맞지 않으면 무효다.
4. 회사 프로필과 대조해 필수 자격을 `SATISFIED / NOT_SATISFIED / NEEDS_REVIEW`로 판정한다. 법적 자격을 자동 확정하지 않는다.
5. SOL Score(0~100)는 **결정론적 규칙**으로 계산하고 5개 요소·입력 스냅샷·알고리즘 버전을 저장한다. 낙찰 확률이 아니다.
6. Kev(소형 결정 모델)는 BID/WATCH/NO_BID 보조 의견만 낸다. 규칙 판정을 뒤집을 수 없고, 분포는 수주확률이 아니라고 UI에 고지한다.
7. 시스템은 **권고**만 하고, 최종 결정은 사람이 사유와 함께 `bid_reviews`에 기록한다.
8. 모델이 꺼져도 규칙만으로 `PARTIAL` 결과를 낸다. 조달 외부 API가 없어도 fixture 20건과 `DEMO_MODE`로 전 기능이 돈다. DEMO 데이터는 DEMO로 표시한다.
9. 테넌트 격리(`org_id` + Supabase RLS), Supabase Auth 세션, 외부 문서 불신 처리, 감사 로그를 기본으로 한다.
10. 해커톤 범위: 결제·모바일·자동 투찰·승률 예측은 **범위 외**. 데스크톱 전용.

## 읽는 순서

| 독자 | 순서 |
|---|---|
| 심사위원(사람) | [[18-HACKATHON]] → [[01-PRD]] → [[19-DEMO-SCENARIO]] → [[08-SCORING]] → [[03-AI-PIPELINE]] → [[11-TESTING]] |
| 심사(AI) | 이 문서의 §주장과 근거 → [[16-DECISIONS]] → [[15-DATA-CONTRACTS]] → [[11-TESTING]] → 나머지 번호 순 |
| 구현자(Claude Code) | [[CLAUDE]] → 이 문서 → [[17-CLAUDE-IMPLEMENTATION]] → 01~05 계약 확정 → [[12-ROADMAP]] 해커톤 컷 순서 |

## 구현 규칙

1. 문서 번호 순서로 읽되 01~05의 계약부터 확정한다. 미결정 사항은 [[16-DECISIONS|16 ADR]]에 기록한다.
2. 코드는 `web/`(화면·Route Handler `web/app/api/v1`·서버 도메인 `web/server/<도메인>`), `web/worker/`(BullMQ 소비자), `supabase/migrations/`(스키마·RLS, append-only), `services/ai/`, `infra/`, `fixtures/`에 둔다. 외부 API 계약은 zod 스키마(`web/server/<도메인>/*.model.ts`)를 단일 원천으로 사용한다([[16-DECISIONS|ADR-016·017]]).
3. MVP의 end-to-end 세로 기능은 **샘플 공고 수집 → 자격 검증 → SOL Score → BID/WATCH/NO-BID → 대시보드 → 알림 이벤트**다.
4. 공식 API 접근 실패, 모델 오프라인, 파일 없음에서도 데모가 가능하도록 fixture와 명시적 `DEMO_MODE`를 제공한다. 데모 데이터는 실데이터처럼 표시하지 않는다.
5. 정확하지 않은 수주확률, 평가위원 점수, 미래 발주예측은 만들어내지 않는다. 근거 미확보 시 `INSUFFICIENT_DATA`로 표시한다.
6. 각 단계에서 테스트·lint·typecheck를 통과시킨 후 다음 단계로 진행한다. [[CLAUDE]]를 실행 지침으로 사용한다.
7. 결제·구독·모바일 레이아웃 코드는 작성하지 않는다. 화면은 데스크톱 1280px 이상 기준이다 ([[16-DECISIONS|ADR-007]]).
8. 유료 외부 모델 API(hosted)는 사용자 승인 전에 호출하지 않는다. 기본은 `AI_PROVIDER=mock`이다.

## 문서

| 번호 | 문서 | 목적 |
|---|---|---|
| 01 | [[01-PRD]] | 제품 요구사항 / MVP 범위 / 차별점 / 성공 지표 |
| 02 | [[02-ARCHITECTURE]] | 서비스 경계·흐름·데모 토폴로지 |
| 03 | [[03-AI-PIPELINE]] | env 플래그(`AI_PROVIDER`) / Qwen `RequirementExtraction` 스키마·프롬프트 / Kev 질문 세트 `kev-qs/v0.1`·mock adapter / 장애·수용 기준 |
| 04 | [[04-DATABASE]] | Supabase Postgres 스키마·RLS 정책·ERD·ENUM·seed 범위·식별자 규칙 |
| 05 | [[05-API-SPEC]] | Route Handler(`/api/v1`) 계약·Supabase Auth·DTO(zod)·오류 코드·예시 |
| 06 | [[06-UI-UX]] | 데스크톱 전용 화면 명세·디자인 토큰·라우트별 상태 표·상세 와이어프레임·분석 상태 머신 |
| 07 | [[07-DATA-PIPELINE]] | Connector·정규화·변경 감지 / fixture 20건 명세(`FX-01`~`FX-20`)·mock 추출·mock Kev 값 |
| 08 | [[08-SCORING]] | SOL Score 정규화 함수·missing 정책·결정 정책·솔리데오 프로필(단일 원천)·worked example 3건 |
| 09 | [[09-SECURITY]] | 인증(Supabase Auth)·RLS·RBAC 표(`sol_role`)·위협 대응·책임 있는 AI(HITL·고지 문구·프롬프트 인젝션·감사 필드) |
| 10 | [[10-DEPLOYMENT]] | Docker Compose(redis·minio·qdrant·ai-gateway·worker) 실행 프로필(demo / ai-local / ai-hosted)·Supabase 클라우드 연결·데모 당일 기동 절차·장애 주입 |
| 11 | [[11-TESTING]] | 테스트 매트릭스·골든 `G1`~`G10` ↔ fixture ↔ 테스트 파일·데모 수용 체크리스트·`docs/evidence/` |
| 12 | [[12-ROADMAP]] | Phase 순서·해커톤 컷(데모 필수 / 있으면 좋음 / 이후)·D-2~D-day |
| 13 | [[13-NOTIFICATIONS]] | 알림 outbox / 인앱 P0 / 카카오 P1(mock) |
| 14 | [[14-OBSERVABILITY]] | 모니터링·운영·데모 지표 |
| 15 | [[15-DATA-CONTRACTS]] | `EvidenceRef`·`FieldState`·`NormalizedBid` 정식 정의 / 인용 검증 알고리즘 / 격리 규칙 / registry 키 |
| 16 | [[16-DECISIONS]] | ADR / 검증 상태 / 미결정 사항 |
| 17 | [[17-CLAUDE-IMPLEMENTATION]] | Claude Code 작업 패턴 / 해커톤 모드 |
| 18 | [[18-HACKATHON]] | 피치·차별점·심사 기준 매핑·데모 스크립트·Q&A·정직성 표 |
| 19 | [[19-DEMO-SCENARIO]] | 데모 기업·fixture 스토리·클릭 경로·장애 대체 시연 |
| 20 | [[20-GLOSSARY]] | 용어집 (단일 원천) |
| — | [[CLAUDE]] | Claude Code 지침 (루트 `CLAUDE.md`가 `@docs/CLAUDE.md`로 먼저 불러온다, ADR-015) |
| — | [[PROGRESS]] | 진행 상황·작업 로그 (저장소 경로 `docs/PROGRESS.md`) |

## 주장과 근거 (AI 심사 보조)

| 주장 | 어디서 확인하나 | 검증 수단 |
|---|---|---|
| 수주확률을 표시하지 않는다 | [[03-AI-PIPELINE]] 품질 가드레일, [[06-UI-UX]] 상세 화면 상태, [[18-HACKATHON]] §7 | G4 ([[11-TESTING]]) |
| 점수는 결정론적이고 재현 가능하다 | [[08-SCORING]] 점수표·정규화 함수, [[04-DATABASE]] `score_runs.input_snapshot`, `algorithm_version` | Scoring Vitest goldens |
| Kev는 규칙 판정을 뒤집을 수 없다 | [[08-SCORING]] Kev 처리, [[03-AI-PIPELINE]] 가드레일 | G3 |
| AI 없이도 결과가 나온다 | [[02-ARCHITECTURE]] 장애 원칙, [[10-DEPLOYMENT]] demo 프로필 | G6 |
| 근거 인용은 원문과 대조된다 | [[15-DATA-CONTRACTS]] `EvidenceRef` 검증 | AI pytest citations |
| 사람이 최종 결정하고 기록이 남는다 | [[08-SCORING]] 결정 정책, [[04-DATABASE]] `bid_reviews`, `audit_logs` | E2E 로그인→공고→분석→검토 |
| 같은 공고를 두 번 수집해도 중복이 없다 | [[07-DATA-PIPELINE]] 변경 감지, [[04-DATABASE]] UNIQUE 제약 | G1·G2, Pipeline Vitest |
| 다른 조직 데이터를 볼 수 없다 | [[09-SECURITY]] RBAC·IDOR·RLS, [[04-DATABASE]] `org_id` RLS 정책, [[05-API-SPEC]] `orgId` 세션 결정 | G5, RLS 정책 시험(PGlite)·Route Handler 시험·E2E |
| 데모 데이터는 가상이며 그렇게 표시된다 | [[04-DATABASE]] `is_demo`, [[06-UI-UX]] DEMO 배지, [[18-HACKATHON]] §7 | G8 |
| 근거 없는 값은 만들지 않는다 (`UNKNOWN`·`CONFLICTED`로 남긴다) | [[15-DATA-CONTRACTS]] §2 `FieldState`, §5 인용 검증 | AI pytest schema·citations |
| 분석은 재현 가능한 키로 식별된다 | [[04-DATABASE]] `score_runs`(revision_id, company_profile_id, algorithm_version, prompt_hash, input_snapshot) | `pnpm test:db` (제약·정책 시험, PGlite) |
| Kev는 보수적 방향으로만 영향을 준다 | [[03-AI-PIPELINE]] §5.5 질문별 사용처·규칙 충돌 처리 | G3, AI pytest adapter |
| Kev는 실재하는 Apache-2.0 모델이다. 영어 모델이며 한국어 성능은 미검증이다 | 아래 §출처, [[16-DECISIONS]] 미결정 2번, [[03-AI-PIPELINE]] §5.6 영어 템플릿 | 2026-10-16 README·모델 카드 확인 |
| 외부 API 필드를 지어내지 않았다 | [[07-DATA-PIPELINE]] registry 절, [[16-DECISIONS]] 미결정 1번 | `> [!warning] 미검증 가정` 콜아웃 전수 |

## Obsidian 규약

- 이 폴더가 vault이자 저장소의 `docs/` 폴더다. 파일 이름은 바꾸지 않는다 (위키링크가 파일명 기준).
- `boilerplate/`는 저장소를 시작한 템플릿(agentic-boilerplate)의 문서다. vault 규약 대상이 아니며 검색·그래프에서 제외한다(`.obsidian/app.json`). ADR-017 이후 Supabase(DB·RLS·인증)와 `web/server/<도메인>` 구조를 다루는 템플릿 문서는 SOL RADAR에도 적용된다. Expo(`mobile/`) 문서는 적용하지 않고, Vercel·EAS 배포 문서는 배포처가 정해질 때까지 보류한다([[16-DECISIONS|16 ADR]] 미결정 8번). 이 vault의 문서와 다르면 이 vault의 문서가 우선한다. 분류는 `boilerplate/README.md`.
- 모든 문서에 frontmatter(`title`, `doc`, `status`, `tags`, `updated`)를 둔다. `status`는 `draft → review → final`. 태그는 `sol-radar` + 주제 1~3개(`product`, `architecture`, `ai`, `pipeline`, `db`, `api`, `ui`, `scoring`, `security`, `ops`, `test`, `decision`, `hackathon`, `demo`, `glossary`, `moc`).
- 문서 간 참조는 `[[05-API-SPEC|05 API 명세]]` 형식의 위키링크. 문서 끝에 `## 관련 문서`를 둔다.
- 콜아웃: `> [!warning] 미검증 가정`, `> [!success] 검증됨 (날짜, URL)`, `> [!todo]`, `> [!tip] 심사 포인트`.
- 다이어그램은 Mermaid. 용어는 [[20-GLOSSARY]]를 따른다.

## 출처 및 주의

> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev)
> Kev는 Jared Palmer가 공개한 Apache-2.0 소형 결정 모델이다. Qwen3.5 기반 Kev-0.8B / 4B(권장) / 9B, Qwen3.8 기반 Kev-27B가 "Kev 1.0"으로 함께 릴리즈되었다(GitHub 태그 `kev-1.0`, Hub 태그 `v1.0`). 서버 실행은 `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0 --port 8009` (README: `@v1.0`은 항상 같은 가중치를 로드. quickstart는 태그 없이 적혀 있다). API는 TypeSafe System One 호환 `POST /v1/systemone`, 질문 타입 `noul` / `choice` / `score`. `pip install kev`는 무관한 패키지이므로 소스에서 설치한다. 모델 카드(`docs/model-cards/kev-4b.md`)는 `Languages: English`이며 영어 외 언어는 잘 동작하지 않는다고 명시한다. 따라서 한국어 입찰 도메인 성능은 미검증이고, 입력은 영어 템플릿 state로 변환해 전달한다([[03-AI-PIPELINE]] §5.6). 호스팅 제공처(OpenRouter 등) 가용성은 확인되지 않았다(2026-10-16 페이지 404).

- 조달청 데이터: https://www.data.go.kr/ — API별 신청 및 문서 기반으로 endpoint/필드/제한을 확인한다. 확인 전에는 fixture만 사용한다.
- 현재 문서는 구현용 설계안이다. 외부 API 필드/호출 한도, 모델 성능, 카카오 발송 조건은 검증 전 확정 사실로 취급하지 않는다. 검증 상태는 [[16-DECISIONS|16 ADR]]에 날짜와 함께 기록한다.

## 솔리데오 가상 인력·가입 결정

ADR-019에 따라 회사는 솔리데오로 고정하고 가상 직원 200명·남녀 100/100·고유 정장 사진 200장·가입 부서/직급 필수 선택을 설계했다. 원본 실명은 재사용하지 않는다. 이름·사진 경로와 생성/검증 규칙은 [[07-DATA-PIPELINE]], 가입 화면은 [[06-UI-UX]], 검증은 [[11-TESTING]] PPL-01~07, [승인 스펙](../polaris/specs/planned/2026-10-16-solideo-people-signup.md)에 있다. 현재는 문서 반영 단계이며 JSON·사진·DB·폼은 후속 구현 대상이다.

## 관련 문서

- [[18-HACKATHON|18 해커톤 전략]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[16-DECISIONS|16 ADR]]
- [[20-GLOSSARY|20 용어집]]
- [[PROGRESS|진행 상황]]
