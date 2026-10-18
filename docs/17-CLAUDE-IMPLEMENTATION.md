---
title: "17. Claude Code 구현 운영 규칙"
doc: "17"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-10-18
---

# 17. Claude Code 구현 운영 규칙

## 시작 명령
Claude Code에 다음을 요청한다: [[00-README|00 인덱스]]부터 읽고 [[01-PRD|01 PRD]]~[[20-GLOSSARY|20 용어집]]과 [[21-MODEL-TRAINING|21 모델 학습]]을 읽은 뒤 Phase 0부터 구현하라. [[12-ROADMAP|12 로드맵]] 해커톤 컷의 "데모 필수"를 우선한다. **각 Phase마다 계획 → 코드 → 테스트 → 증거 저장 → 결과 보고 → 다음 단계**를 따르라. 문서와 실제 구현이 충돌하면 코드 전에 [[16-DECISIONS|16 ADR]]과 문서를 갱신하라.

## 절대 규칙
- 스택은 [[16-DECISIONS|16 ADR]] ADR-017을 따른다. 화면·Route Handler(`/api/v1`)·서버 도메인은 Next.js(`web/`, `web/server/<도메인>`)로만 만든다. 다른 웹 프레임워크나 별도 API 서버·ORM을 들이지 않는다. Worker는 `web/worker` 진입점(BullMQ)이다.
- DB와 Auth만 Supabase(Postgres·RLS·Auth)다. 첨부 원본은 Supabase Storage가 아니라 MinIO(ADR-005), 작업 큐는 Supabase Queues가 아니라 Redis/BullMQ, 벡터 검색은 pgvector가 아니라 Qdrant를 쓴다.
- service role 키(`SUPABASE_SERVICE_ROLE_KEY`, RLS 무시)는 worker와 seed 스크립트(서버 전용)만 쓴다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키 또는 Bearer 토큰)으로 DB를 부르고 권한은 RLS가 정한다. service role 키를 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다 ([[09-SECURITY|09 보안]]).
- 새 표는 만들자마자 RLS를 켜고 필요한 권한·정책만 연다. 조직 데이터는 `org_id` + `org_id in (select public.my_org_ids())`, 업무 역할은 `memberships.sol_role`. 마이그레이션은 `supabase/migrations/`에 새 파일로만 쌓고(이미 있는 파일 수정 금지), 클라우드 적용(`pnpm db:push`)은 사용자 확인 뒤에만 한다.
- Kev 대신 Laya 적용 금지. Kev를 낙찰 확률 모델로 오용 금지. Kev 호출은 AI gateway만 한다. Worker·Next 서버의 직접 호출 금지 ([[02-ARCHITECTURE|02 아키텍처]]).
- **모바일 레이아웃·1280px 미만 breakpoint·네이티브 앱 코드 작성 금지.** 데스크톱 1280~1920만 ([[16-DECISIONS|16 ADR]] ADR-007).
- **결제·구독·요금제·결제 게이트웨이 코드 작성 금지.** 관련 패키지 설치도 금지 (ADR-007).
- **hosted 모델 API 호출 전 사용자 명시 승인 필수.** 승인은 `AI_HOSTED_APPROVED=true`로만 표현하고, 승인 전에는 `AI_PROVIDER=hosted` 설정·키 입력·호출 코드 실행 금지. 승인 없이 hosted면 gateway는 기동 거부. 테스트·CI·골든은 항상 `SOL_RUN_MODE=mock`(`AI_PROVIDER=mock`) (ADR-010).
- **클라우드 GPU 임대도 비용 승인 대상이다.** 해커톤 실추론·평가는 회사 GPU 서버에서 한다. 클라우드 GPU를 빌리는 일은 hosted API와 같이 사용자 명시 승인 전에는 하지 않는다 ([[16-DECISIONS|ADR-020]], ADR-010).
- **Kev 운영 입력은 영어 템플릿 state만이다.** 운영 경로는 `en` 템플릿만 쓰고, 자유 텍스트는 `/extract`가 돌려준 `translations`(숫자 보존 검사 통과분)로 채운다. 한국어 state(`ko` 템플릿)는 **평가 전용**이다. gateway env `KEV_ALLOW_KO_STATE=true`일 때만 받고(없으면 `422 KO_STATE_NOT_ALLOWED`) `SOL_RUN_MODE=live`와 함께 쓰면 gateway가 기동을 거부한다. 한국어 운영 사용은 평가 결과를 보고 다시 검토한다 (ADR-012 개정, ADR-020, [[03-AI-PIPELINE|03 AI 파이프라인]] §5).
- **Kev 출력은 `review_flags` 추가와 "모델 참고 지표 (점수 미반영)" 표시에만 쓴다.** 자격·점수·권고를 바꾸는 코드 경로를 만들지 않는다. Kev 확률을 충족 확률·낙찰 확률·수주확률로 보이게 쓰지 않는다. Kev를 점수에 반영하려면 평가셋 기준 통과 → 새 알고리즘 버전 `sol-v0.2.x` → ADR 순서를 밟고, 그 전에는 반영 코드를 만들지 않는다 (ADR-004 개정, ADR-020, [[08-SCORING|08 스코어링]]).
- **정보 부족을 `미충족`으로 판정하지 않는다.** `NOT_SATISFIED`에는 공고 근거와 회사 쪽 명시적 부정 근거가 둘 다 있어야 하고, 정보가 없으면 `NEEDS_REVIEW` + 사유 코드다 ([[08-SCORING|08 스코어링]]).
- **실행 모드(`SOL_RUN_MODE=live|fixture|mock`)와 모순된 env는 기동을 거부한다.** 값을 조용히 바꾸지 않는다. 분석마다 실행 모드·AI 공급자·모델 이름을, 공고마다 출처(`source`·`is_demo`)를 기록하고 화면에 표시한다.
- **mock으로 자동 대체하지 않는다.** 데이터 출처(live → fixture)도 AI(local → mock)도 자동으로 바꾸지 않고, 모델이 안 되면 `PARTIAL`·`RULES_ONLY`로 끝낸다. 시연용 `AI_FALLBACK_TO_MOCK=true`는 기본 `false`이고 `live`에서는 켤 수 없다(기동 거부). 켜서 실제로 대체되면 `ai_provider=MOCK`·`fallback_reason`·`MOCK_FALLBACK` 플래그와 "실제 모델 결과 아님" 배너로 명시한다.
- **실패 유형을 섞지 않는다.** 공공 API 실패, 첨부 다운로드 불가, 파싱 실패, 모델 서버 미접속(Qwen·Kev 따로), gateway 미접속을 각각의 코드로 기록하고 따로 보여 준다.
- **파싱에 실패한 내용을 AI가 추측하지 않는다.** Qwen에는 파싱된 텍스트만 넣고 "첨부가 있었다"로 내용을 추정하게 하는 지시를 넣지 않는다. Kev state에는 첨부를 읽지 못했다는 사실 한 줄만 넣고 읽지 못한 문서로 질문을 만들지 않는다. `/explain`은 파싱 실패를 문장에 밝힌다.
- **외부 의존성은 조기에 점검한다(P0-0).** 서비스키·회사 GPU가 준비되면 다른 작업보다 먼저 실제 API 응답·첨부 다운로드·GPU 터널·파서 후보를 확인하고 `docs/evidence/phase-0/external-deps.md`에 남긴다. 막히면 즉시 사용자에게 보고한다. 기다리는 동안은 인터페이스(`BidSourceConnector`·`AttachmentFetcher`·`DocumentParser`·`ModelClient`)로 진행하고, 저장 응답·문서 예시를 실제 응답인 것처럼 표시하지 않는다.
- **나라장터 서비스키 4개(`G2B_*_SERVICE_KEY`, 서비스마다 하나, [[16-DECISIONS|ADR-022]])는 서버 전용이다.** `OfficialApiConnector`(worker)만 읽고, 소스마다 registry `serviceKeyEnv`가 가리키는 키만 쓴다. `NEXT_PUBLIC_` 변수·브라우저 번들·로그·오류 메시지·`docs/evidence/`에 넣지 않고, 쿼리 파라미터로 붙으므로 요청 URL 로그에서도 가린다. 응답의 담당자 이름·전화·이메일은 `NormalizedBid`·데이터셋·모델 입력에 넣지 않는다 ([[09-SECURITY|09 보안]]).
- **첨부 다운로드는 allowlist로만 한다.** `https://www.g2b.go.kr`만 허용하고, 리다이렉트는 allowlist 안에서만 따르며, DNS를 다시 확인해 사설 IP를 거부한다. timeout 30 s, 최대 50 MB, 형식은 확장자가 아니라 내용으로 판단한다 ([[09-SECURITY|09 보안]] SSRF).
- 외부 API 필드/URL, 실제 기업 수주실적, 카카오 승인 상태, 벤치마크 수치, 모델 성능을 지어내지 말 것. 공공 API 엔드포인트는 `infra/sources/registry.yaml`에 등록한 것만 부른다. 모르면 `> [!warning] 미검증 가정` + mock.
- DEMO 데이터는 `is_demo=true`로 저장하고 UI에 DEMO 배지. 실데이터처럼 표시 금지. live 공고는 `is_demo=false`로 fixture 공고와 같은 DB에 있을 수 있으므로 `source`·`is_demo`로 구분해 표시한다. 회사 프로필은 모든 모드에서 가상 솔리데오 프로필(`is_demo=true`)이고 분석 화면에 "가상 회사 프로필로 분석" 배지를 붙인다. 실제 회사 자료를 쓰려면 ADR과 [[09-SECURITY|09 보안]] 개정이 먼저다 (ADR-019, ADR-020).
- 모든 새 Route Handler·zod 스키마·Supabase migration에는 테스트 추가. 새 표·정책에는 `scripts/database.test.mjs`(PGlite)에 RLS 정책 시험을 더한다 ([[11-TESTING|11 테스트]]).
- `.env`를 읽어서 출력하거나 Git에 넣지 말 것. credential은 `.env.example` placeholder만.
- 작업을 묶어 대량 변경하기 전에 변경 파일 및 검증 명령 계획부터 정리할 것.

## 해커톤 모드
### 우선순위
1. P0-0 외부 의존성 조기 점검은 서비스키·회사 GPU가 준비되는 즉시 다른 작업보다 먼저 한다. 막힌 항목은 즉시 사용자에게 보고한다.
2. [[12-ROADMAP|12 로드맵]] 해커톤 컷의 "데모 필수" 항목을 Phase 순서로 끝낸다. P0-1~P0-11은 12의 Phase 배치대로 각 Phase 안에서 한다(평가 트랙 P0-9~P0-11은 Phase 5 실추론이 동작한 뒤 Phase 6·7과 나란히). 같은 Phase 안에서는 P0 번호 순서로 하고, P0 번호 순서는 시간이 모자랄 때 잘라낼 순서다. 번호를 엄격한 게이트로 볼지는 12의 "결정 필요" 콜아웃대로 사용자가 정한다.
3. Phase 5는 mock adapter(CI용)를 먼저 만들고, 그다음 Qwen 실추출(P0-4) → Kev v0.2 실추론(P0-6) → `/explain` 순서다. 시험과 CI는 계속 `SOL_RUN_MODE=mock`으로 돈다.
4. 데모 필수가 전부 green(테스트 + [[10-DEPLOYMENT|10 배포]] 기동 절차 리허설)이기 전에는 "있으면 좋음"에 착수하지 않는다.
5. 시간이 부족해도 범위를 임의로 줄이지 않는다. 보고 형식의 "해커톤 컷 영향" 줄에 선택지를 적고 사용자가 결정한다.
6. Phase 0 완료 시점부터 `--profile demo` 기동이 항상 되어야 한다. 매 Phase 끝에 기동 절차 1~7을 실행한다. Phase 7에는 세 실행 모드(`live`·`fixture`·`mock`) 기동 리허설과 터널 재연결 리허설을 넣는다.

### 증거 저장 (`docs/evidence/`)
각 Phase 끝에 저장한다. 구조:
```text
docs/evidence/
  phase-0/
    compose-ps.txt            # docker compose ps 출력
    health-ready.json         # GET /health/ready 응답
    test-report.txt           # 실행 명령 + pnpm verify(서식·타입·린트·단위) 결과 마지막 20줄
    external-deps.md          # P0-0 외부 의존성 점검 항목별 결과 (11 §3.3)
    screenshots/
  phase-3/
    screenshots/
      20261016-phase3-bids-list-loaded-1440.png
      20261016-phase3-bids-list-empty-1440.png
      20261016-phase3-bid-detail-completed-1440.png
      20261016-phase3-bid-detail-completed-1280.png
  eval/                       # 평가 리포트 숫자 요약·오류 분석 요약 (21 §4). RFP 원문 금지
  kev-train-feasibility.md    # LoRA 메모리 검증 결과 (21 §5.2, 회사 GPU 접근 뒤)
  demo-day/
    compose-ps.txt
    health-ready.json
    rehearsal-log.md
```
전체 목록과 파일명은 [[11-TESTING|11 테스트]] §6을 따른다. 서비스키 값·GPU 서버 주소·실제 RFP 원문·공공 API 응답의 담당자 개인정보는 증거에 넣지 않는다.
스크린샷 파일명 규칙: `YYYYMMDD-phaseN-<route>-<state>-<width>.png`
- `route`: 경로를 하이픈으로. `/auth/login`(Supabase Auth 로그인 화면) → `login`, `/bids` → `bids-list`, `/bids/[id]` → `bid-detail`, `/notifications` → `notifications`, `/admin/ingestion` → `admin-ingestion`.
- `state`: `loaded | empty | loading | error | forbidden | partial | demo-badge`.
- `width`: `1440` 기본. 목록과 상세 화면은 `1280`도 1장.
- 비밀값·토큰이 화면에 보이면 저장 금지.
- evidence 파일은 커밋 대상. Phase당 10MB 이하(PNG 압축).

### 데모 리허설
Phase 6 완료 후부터 [[10-DEPLOYMENT|10 배포]] 기동 절차 1~12를 매일 1회 실행하고 `docs/evidence/demo-day/rehearsal-log.md`에 날짜·소요 시간·실패 단계를 기록한다. 세 실행 모드 기동과 회사 GPU 서버 터널 단절 → `PARTIAL`·`RULES_ONLY` → 재연결도 리허설하고 재연결 소요 시간을 같은 파일에 적는다. live 리허설은 공공 API 일일 호출 한도(개발계정 서비스당 1,000건/일) 안에서 한다.

## 각 Phase 결과 보고 형식
```text
Phase:
해커톤 컷: (데모 필수 / 있으면 좋음 / 이후)
P0 항목: (이번에 다룬 P0 번호, 없으면 없음)
완료 기능:
변경 파일:
명령 및 테스트 결과:
실제로 돌린 실행 모드: (mock / fixture / live 중. 돌리지 않은 모드는 미검증)
증거 경로: docs/evidence/phase-N/
미구현 / 위험 / 외부 의존성:
해커톤 컷 영향: (없음 / 선택지)
다음 Phase:
```

## 권장 작업 순서
1. docs 읽기 + open questions를 [[16-DECISIONS|16 ADR]] 미결정 표에 제안.
2. 템플릿 정리: Supabase·`web/`은 유지하고, 견본 도메인(`tasks`·팀 화면 등. `memos`는 템플릿 마이그레이션이 이미 지웠다) 중 정리할 범위를 정한다. Python uv 프로젝트(`services/ai`) 생성. pnpm workspace·`apps/`·`packages/contracts`는 만들지 않는다(ADR-017).
3. Docker Compose 기본 인프라(`infra/compose.yaml`: redis·minio·qdrant·ai-gateway·worker, web은 선택), `web/worker` 진입점(`server-only` 도메인 코드를 쓰는 실행 방식 `--conditions=react-server` 검증), healthcheck와 `/health/live`·`/health/ready`, Supabase 클라우드 프로젝트 연결·env, `.env.example`, `infra/env/demo.env.example`, `pnpm check:env`, CI(`verify.config.json`). 실행 모드 `SOL_RUN_MODE`와 모드 모순 검사, 서비스키 4개(`G2B_*_SERVICE_KEY`) placeholder(서버 전용), 회사 GPU 서버에 터널로 붙는 `ai-local` 연결 방식. 서비스키·회사 GPU가 준비되면 이 시점에 P0-0 외부 의존성 점검을 먼저 한다([[11-TESTING|11 테스트]] §3.3).
4. `supabase/migrations`로 SOL RADAR 초기 스키마([[04-DATABASE|04 DB]])·RLS·`memberships.sol_role` + 정책 시험(`pnpm test:db`). seed는 스크립트 `pnpm demo:reset`(service role로 Supabase 프로젝트에 적재): 조직 2개(`org-01` 솔리데오, `org-02` 격리 확인용), 계정 5개(`org-01` 역할별 4, `org-02` VIEWER 1), FX-01~FX-20 중 19건 적재 + FX-12 격리(`ingest_errors`), 별도 가상 직원 명부 200명(남녀 100/100, Auth 계정 아님)·부서/직급 카탈로그, `is_demo=true`, 멱등(ADR-019). ADR-020 저장 변경(실행 모드·출처, 첨부 다운로드·파싱 상태, 새 표 `requirement_assessments`·`bid_structured_requirements`·`eval_runs`)은 [[04-DATABASE|04 DB]]를 먼저 고친 뒤 첫 SOL 마이그레이션에 넣는다.
5. Supabase Auth 연결(템플릿 로그인·초대) + `sol_role` RBAC. 외부 API 계약은 zod 스키마(`web/server/<도메인>/*.model.ts`, ADR-016)가 단일 원천이다.
6. ADR-019의 가입 부서·직급 필수 선택·간편 가입 정보 보완, 가상 프로필 200장 연결을 명세·시험과 함께 구현한다. 이미지 생성은 imagegen 기본 도구로 별도 준비하며 CI·앱 기동에서 생성하지 않는다.
7. Connector 인터페이스로 fixture·live 수집을 함께 만든다(`web/server/ingestion`, `web/worker`): `FixtureConnector`, `OfficialApiConnector`(나라장터 입찰공고 용역 중 정보화사업, 면허제한·참가가능지역·e발주 첨부), documents job·첨부 다운로드·`/parse`, 사전규격·발주계획. 조회 Route Handler(`/api/v1`) + Next UI (1440 기준, 실행 모드·출처·가상 회사 프로필 배지).
8. rules/qualification + scores + review + worked example 골든 테스트(`web/server/scoring`, [[08-SCORING|08 스코어링]]).
9. AI gateway mock adapter 먼저 (`AI_PROVIDER=mock`), 장애 대체(`PARTIAL`). `/extract`(extract job, revision 단위, ingest → documents → extract 순서)와 `/kev`(analysis job) 분리 (ADR-011·020). 그다음 Qwen3.5-9B `/extract` local(+`translations`) → Kev-9B@v1.0 `kev-qs/v0.2`(참고 지표·`stateTrace`·레지스트리 검증) → `/explain`. 실모델은 회사 GPU 서버의 `ai-local`(터널) + `KEV_ENABLED`. hosted는 `AI_HOSTED_APPROVED=true` 승인 후.
10. 인앱 outbox, Playwright, release smoke, 세 실행 모드·터널 재연결 리허설, demo-day evidence.
11. 평가 트랙(Phase 5 실추론이 동작한 뒤, Phase 6·7과 나란히): 평가셋 v0.1, 평가 하네스와 E0·E1·E2 리포트, 학습셋 번들 내보내기, LoRA 메모리 검증 스크립트·절차([[21-MODEL-TRAINING|21 모델 학습]]). 파인튜닝은 하지 않는다(해커톤 범위 밖).

## 구현 성공 증거
별도 리포트가 아닌 실행 로그로 `docker compose ps`, 마이그레이션 적용·정책 시험(`pnpm test:db`) 결과, 테스트 결과, 화면 E2E 스크린샷, 장애 시 fallback 결과, 외부 의존성 점검 결과(`phase-0/external-deps.md`), 평가 리포트 요약(`eval/`)을 `docs/evidence/`에 저장해 제출한다. 매 Phase 후 [[PROGRESS]] 체크리스트를 갱신한다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[09-SECURITY|09 보안]] — service role 키·세션·RLS
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[12-ROADMAP|12 로드맵]]
- [[16-DECISIONS|16 ADR]] — ADR-010·012·017·020
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가 트랙·파인튜닝 착수 판단
- [[PROGRESS]]
