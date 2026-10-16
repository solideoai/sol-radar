---
title: "17. Claude Code 구현 운영 규칙"
doc: "17"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-10-16
---

# 17. Claude Code 구현 운영 규칙

## 시작 명령
Claude Code에 다음을 요청한다: [[00-README|00 인덱스]]부터 읽고 [[01-PRD|01 PRD]]~[[20-GLOSSARY|20 용어집]]을 읽은 뒤 Phase 0부터 구현하라. [[12-ROADMAP|12 로드맵]] 해커톤 컷의 "데모 필수"를 우선한다. **각 Phase마다 계획 → 코드 → 테스트 → 증거 저장 → 결과 보고 → 다음 단계**를 따르라. 문서와 실제 구현이 충돌하면 코드 전에 [[16-DECISIONS|16 ADR]]과 문서를 갱신하라.

## 절대 규칙
- 스택은 [[16-DECISIONS|16 ADR]] ADR-017을 따른다. 화면·Route Handler(`/api/v1`)·서버 도메인은 Next.js(`web/`, `web/server/<도메인>`)로만 만든다. 다른 웹 프레임워크나 별도 API 서버·ORM을 들이지 않는다. Worker는 `web/worker` 진입점(BullMQ)이다.
- DB와 Auth만 Supabase(Postgres·RLS·Auth)다. 첨부 원본은 Supabase Storage가 아니라 MinIO(ADR-005), 작업 큐는 Supabase Queues가 아니라 Redis/BullMQ, 벡터 검색은 pgvector가 아니라 Qdrant를 쓴다.
- service role 키(`SUPABASE_SERVICE_ROLE_KEY`, RLS 무시)는 worker와 seed 스크립트(서버 전용)만 쓴다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키 또는 Bearer 토큰)으로 DB를 부르고 권한은 RLS가 정한다. service role 키를 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다 ([[09-SECURITY|09 보안]]).
- 새 표는 만들자마자 RLS를 켜고 필요한 권한·정책만 연다. 조직 데이터는 `org_id` + `org_id in (select public.my_org_ids())`, 업무 역할은 `memberships.sol_role`. 마이그레이션은 `supabase/migrations/`에 새 파일로만 쌓고(이미 있는 파일 수정 금지), 클라우드 적용(`pnpm db:push`)은 사용자 확인 뒤에만 한다.
- Kev 대신 Laya 적용 금지. Kev를 낙찰 확률 모델로 오용 금지. Kev 호출은 AI gateway만 한다. Worker·Next 서버의 직접 호출 금지 ([[02-ARCHITECTURE|02 아키텍처]]).
- **모바일 레이아웃·1280px 미만 breakpoint·네이티브 앱 코드 작성 금지.** 데스크톱 1280~1920만 ([[16-DECISIONS|16 ADR]] ADR-007).
- **결제·구독·요금제·결제 게이트웨이 코드 작성 금지.** 관련 패키지 설치도 금지 (ADR-007).
- **hosted 모델 API 호출 전 사용자 명시 승인 필수.** 승인은 `AI_HOSTED_APPROVED=true`로만 표현하고, 승인 전에는 `AI_PROVIDER=hosted` 설정·키 입력·호출 코드 실행 금지. 승인 없이 hosted면 gateway는 기동 거부. 테스트·CI는 항상 `mock` (ADR-010).
- **Kev에는 영어 템플릿 state만 보낸다.** 한국어 원문·자유 텍스트를 Kev 입력에 넣지 않는다. Kev 출력은 `review_flags` 추가에만 쓰고 자격·점수·권고를 바꾸는 코드 경로를 만들지 않는다 (ADR-012, [[03-AI-PIPELINE|03 AI 파이프라인]] §5.5).
- 외부 API 필드/URL, 실제 기업 수주실적, 카카오 승인 상태, 벤치마크 수치를 지어내지 말 것. 모르면 `> [!warning] 미검증 가정` + mock.
- DEMO 데이터는 `is_demo=true`로 저장하고 UI에 DEMO 배지. 실데이터처럼 표시 금지.
- 모든 새 Route Handler·zod 스키마·Supabase migration에는 테스트 추가. 새 표·정책에는 `scripts/database.test.mjs`(PGlite)에 RLS 정책 시험을 더한다 ([[11-TESTING|11 테스트]]).
- `.env`를 읽어서 출력하거나 Git에 넣지 말 것. credential은 `.env.example` placeholder만.
- 작업을 묶어 대량 변경하기 전에 변경 파일 및 검증 명령 계획부터 정리할 것.

## 해커톤 모드
### 우선순위
1. [[12-ROADMAP|12 로드맵]] 해커톤 컷의 "데모 필수" 항목을 Phase 순서로 끝낸다.
2. 데모 필수가 전부 green(테스트 + [[10-DEPLOYMENT|10 배포]] 기동 절차 리허설)이기 전에는 "있으면 좋음"에 착수하지 않는다.
3. 시간이 부족해도 범위를 임의로 줄이지 않는다. 보고 형식의 "해커톤 컷 영향" 줄에 선택지를 적고 사용자가 결정한다.
4. Phase 0 완료 시점부터 `--profile demo` 기동이 항상 되어야 한다. 매 Phase 끝에 기동 절차 1~7을 실행한다.

### 증거 저장 (`docs/evidence/`)
각 Phase 끝에 저장한다. 구조:
```text
docs/evidence/
  phase-0/
    compose-ps.txt            # docker compose ps 출력
    health-ready.json         # GET /health/ready 응답
    test-report.txt           # 실행 명령 + pnpm verify(서식·타입·린트·단위) 결과 마지막 20줄
    screenshots/
  phase-3/
    screenshots/
      20261016-phase3-bids-list-loaded-1440.png
      20261016-phase3-bids-list-empty-1440.png
      20261016-phase3-bid-detail-completed-1440.png
      20261016-phase3-bid-detail-completed-1280.png
  demo-day/
    compose-ps.txt
    health-ready.json
    rehearsal-log.md
```
스크린샷 파일명 규칙: `YYYYMMDD-phaseN-<route>-<state>-<width>.png`
- `route`: 경로를 하이픈으로. `/auth/login`(Supabase Auth 로그인 화면) → `login`, `/bids` → `bids-list`, `/bids/[id]` → `bid-detail`, `/notifications` → `notifications`, `/admin/ingestion` → `admin-ingestion`.
- `state`: `loaded | empty | loading | error | forbidden | partial | demo-badge`.
- `width`: `1440` 기본. 목록과 상세 화면은 `1280`도 1장.
- 비밀값·토큰이 화면에 보이면 저장 금지.
- evidence 파일은 커밋 대상. Phase당 10MB 이하(PNG 압축).

### 데모 리허설
Phase 6 완료 후부터 [[10-DEPLOYMENT|10 배포]] 기동 절차 1~12를 매일 1회 실행하고 `docs/evidence/demo-day/rehearsal-log.md`에 날짜·소요 시간·실패 단계를 기록한다.

## 각 Phase 결과 보고 형식
```text
Phase:
해커톤 컷: (데모 필수 / 있으면 좋음 / 이후)
완료 기능:
변경 파일:
명령 및 테스트 결과:
증거 경로: docs/evidence/phase-N/
미구현 / 위험 / 외부 의존성:
해커톤 컷 영향: (없음 / 선택지)
다음 Phase:
```

## 권장 작업 순서
1. docs 읽기 + open questions를 [[16-DECISIONS|16 ADR]] 미결정 표에 제안.
2. 템플릿 정리: Supabase·`web/`은 유지하고, 견본 도메인(`tasks`·팀 화면 등. `memos`는 템플릿 마이그레이션이 이미 지웠다) 중 정리할 범위를 정한다. Python uv 프로젝트(`services/ai`) 생성. pnpm workspace·`apps/`·`packages/contracts`는 만들지 않는다(ADR-017).
3. Docker Compose 기본 인프라(`infra/compose.yaml`: redis·minio·qdrant·ai-gateway·worker, web은 선택), `web/worker` 진입점(`server-only` 도메인 코드를 쓰는 실행 방식 `--conditions=react-server` 검증), healthcheck와 `/health/live`·`/health/ready`, Supabase 클라우드 프로젝트 연결·env, `.env.example`, `infra/env/demo.env.example`, `pnpm check:env`, CI(`verify.config.json`).
4. `supabase/migrations`로 SOL RADAR 초기 스키마([[04-DATABASE|04 DB]])·RLS·`memberships.sol_role` + 정책 시험(`pnpm test:db`). seed는 스크립트 `pnpm demo:reset`(service role로 Supabase 프로젝트에 적재): 조직 2개(`org-01` 솔리데오, `org-02` 격리 확인용), 계정 5개(`org-01` 역할별 4, `org-02` VIEWER 1), FX-01~FX-20 중 19건 적재 + FX-12 격리(`ingest_errors`), 별도 가상 직원 명부 200명(남녀 100/100, Auth 계정 아님)·부서/직급 카탈로그, `is_demo=true`, 멱등(ADR-019).
5. Supabase Auth 연결(템플릿 로그인·초대) + `sol_role` RBAC. 외부 API 계약은 zod 스키마(`web/server/<도메인>/*.model.ts`, ADR-016)가 단일 원천이다.
6. ADR-019의 가입 부서·직급 필수 선택·간편 가입 정보 보완, 가상 프로필 200장 연결을 명세·시험과 함께 구현한다. 이미지 생성은 imagegen 기본 도구로 별도 준비하며 CI·앱 기동에서 생성하지 않는다.
7. fixture ingestion(`web/server/ingestion`, `web/worker`) + 조회 Route Handler(`/api/v1`) + Next UI (1440 기준).
8. rules/qualification + scores + review + worked example 골든 테스트(`web/server/scoring`, [[08-SCORING|08 스코어링]]).
9. AI gateway mock adapter 먼저 (`AI_PROVIDER=mock`), 장애 대체(`PARTIAL`). `/extract`(ingest job, revision 단위)와 `/kev`(analysis job) 분리 (ADR-011). 실모델은 `ai-local` 프로필 + `KEV_ENABLED`. hosted는 `AI_HOSTED_APPROVED=true` 승인 후.
10. 인앱 outbox, Playwright, release smoke, demo-day evidence.

## 구현 성공 증거
별도 리포트가 아닌 실행 로그로 `docker compose ps`, 마이그레이션 적용·정책 시험(`pnpm test:db`) 결과, 테스트 결과, 화면 E2E 스크린샷, 장애 시 fallback 결과를 `docs/evidence/`에 저장해 제출한다. 매 Phase 후 [[PROGRESS]] 체크리스트를 갱신한다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[09-SECURITY|09 보안]] — service role 키·세션·RLS
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[12-ROADMAP|12 로드맵]]
- [[16-DECISIONS|16 ADR]]
- [[PROGRESS]]
