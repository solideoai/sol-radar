---
title: "17. Claude Code 구현 운영 규칙"
doc: "17"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-11-02
---

# 17. Claude Code 구현 운영 규칙

## 시작 명령
Claude Code에 다음을 요청한다: [[00-README|00 인덱스]]부터 읽고 그 문서 표에 있는 설계 문서 전부를 읽은 뒤 Phase 0부터 구현하라. [[12-ROADMAP|12 로드맵]] 해커톤 컷의 핵심 컷(Critical Path C0~C9)을 우선한다. **각 Phase마다 계획 → 코드 → 테스트 → 증거 저장 → 결과 보고 → 다음 단계**를 따르라. 문서와 실제 구현이 충돌하면 코드 전에 [[16-DECISIONS|16 ADR]]과 문서를 갱신하라. 열린 질문은 [[16-DECISIONS|16 ADR]] 미결정 표에 제안하라. 지금 단계는 [[PROGRESS]]와 [[12-ROADMAP|12 로드맵]] 남은 일정 제안 표를 먼저 본다.

## 절대 규칙
- 스택은 [[16-DECISIONS|16 ADR]] ADR-017을 따른다. 화면·Route Handler(`/api/v1`)·서버 도메인은 Next.js(`web/`, `web/server/<도메인>`)로만 만든다. 다른 웹 프레임워크나 별도 API 서버·ORM을 들이지 않는다. Worker는 `web/worker` 진입점(BullMQ)이다. 해커톤 뒤 API·worker의 NestJS 전환은 ADR-028이고, 그 전에는 NestJS 코드를 만들지 않는다.
- DB·Auth·첨부 원본은 Supabase(Postgres·RLS·Auth·Storage)다(ADR-048), 작업 큐는 Supabase Queues가 아니라 Redis/BullMQ, 벡터 검색은 pgvector가 아니라 Qdrant를 쓴다.
- service role 키(`SUPABASE_SERVICE_ROLE_KEY`, RLS 무시)는 worker·seed 스크립트와 사람이 로컬에서 직접 실행하는 운영자 CLI(`scripts/ops/`)만 쓴다. 운영자 CLI의 클라우드 변경 적용은 사용자 확인 뒤다. Next의 요청 처리 경로는 사용자 세션(anon 키 + 로그인 쿠키 또는 Bearer 토큰)으로 DB를 부르고 권한은 RLS가 정한다. service role 키를 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 넣지 않는다 ([[09-SECURITY|09 보안]]).
- 새 표는 만들자마자 RLS를 켜고 필요한 권한·정책만 연다. 조직 데이터는 `org_id` + `org_id in (select public.my_org_ids())`, 업무 역할은 `memberships.sol_role`. 마이그레이션은 `supabase/migrations/`에 새 파일로만 쌓고(이미 있는 파일 수정 금지), 클라우드 적용(`pnpm db:push`)은 사용자 확인 뒤에만 한다.
- 결정 모델(Bosun. `KEV_*`·`/kev` 이름은 호환 유지, ADR-034) 대신 Laya 적용 금지. 결정 모델을 낙찰 확률 모델로 오용 금지. 결정 모델 호출은 AI gateway만 한다. Worker·Next 서버의 직접 호출 금지 ([[02-ARCHITECTURE|02 아키텍처]]).
- **모바일 웹 기본 대응 허용, 네이티브 앱은 금지.** 2026-10-30 사용자 승인(ADR-072)으로 ADR-007의 웹 폭 제한을 개정했다. 1280px 이상 기존 배치를 유지하고 좁은 폭은 재배치한다. 360·390·768·1280·1440px를 확인한다.
- **결제·구독·요금제·결제 게이트웨이 코드 작성 금지.** 관련 패키지 설치도 금지 (ADR-007).
- **hosted 모델 API 호출 전 사용자 명시 승인 필수.** 승인은 `AI_HOSTED_APPROVED=true`로만 표현하고, 승인 전에는 `AI_PROVIDER=hosted` 설정·키 입력·호출 코드 실행 금지. 승인 없이 hosted면 gateway는 기동 거부. 테스트·CI·골든은 항상 `SOL_RUN_MODE=mock`(`AI_PROVIDER=mock`) (ADR-010).
- **클라우드 GPU 임대도 비용 승인 대상이다.** 해커톤 실추론·평가는 회사가 HTTPS로 제공하는 GPU 추론 엔드포인트에 붙여 한다([[16-DECISIONS|ADR-025]]). 클라우드 GPU를 빌리는 일은 hosted API와 같이 사용자 명시 승인 전에는 하지 않는다 ([[16-DECISIONS|ADR-020]], ADR-010).
- **결정 모델(Bosun) 운영 입력은 영어 템플릿 state만이다.** 운영 경로는 `en` 템플릿만 쓰고, 자유 텍스트는 `/extract`가 돌려준 `translations`(숫자 보존 검사 통과분)로 채운다. 한국어 state(`ko` 템플릿)는 **평가 전용**이다. gateway env `KEV_ALLOW_KO_STATE=true`일 때만 받고(없으면 `422 KO_STATE_NOT_ALLOWED`) `SOL_RUN_MODE=live`와 함께 쓰면 gateway가 기동을 거부한다. 한국어 운영 사용은 평가 결과를 보고 다시 검토한다 (ADR-012 개정, ADR-020, [[03-AI-PIPELINE|03 AI 파이프라인]] §5).
- **결정 모델(Bosun) 출력은 `review_flags` 추가와 "모델 참고 지표 (점수 미반영)" 표시에만 쓴다.** 자격·점수·권고를 바꾸는 코드 경로를 만들지 않는다. 결정 모델 확률을 충족 확률·낙찰 확률·수주확률로 보이게 쓰지 않는다. 결정 모델을 점수에 반영하려면 평가셋 기준 통과 → 새 알고리즘 버전(`sol-v0.3.0` 이후) → ADR 순서를 밟고, 그 전에는 반영 코드를 만들지 않는다 (ADR-004 개정, ADR-020, [[08-SCORING|08 스코어링]]).
- **정보 부족을 `미충족`으로 판정하지 않는다.** `NOT_SATISFIED`에는 공고 근거와 회사 쪽 명시적 부정 근거가 둘 다 있어야 하고, 정보가 없으면 `NEEDS_REVIEW` + 사유 코드다 ([[08-SCORING|08 스코어링]]).
- **실행 모드(`SOL_RUN_MODE=live|fixture|mock`)와 모순된 env는 기동을 거부한다.** 값을 조용히 바꾸지 않는다. 분석마다 실행 모드·AI 공급자·모델 이름을, 공고마다 출처(`source`·`is_demo`)를 기록하고 화면에 표시한다.
- **mock으로 자동 대체하지 않는다.** 데이터 출처(live → fixture)도 AI(local → mock)도 자동으로 바꾸지 않고, 모델이 안 되면 `PARTIAL`·`RULES_ONLY`로 끝낸다. `AI_FALLBACK_TO_MOCK=true`는 해커톤 동안 구현하지 않아 세 모드 모두 켜면 기동 거부다([[16-DECISIONS|ADR-030]] B11, `infra/run-modes.json`). 나중에 구현하면 실제 대체 때 `ai_provider=MOCK`·`fallback_reason`·`MOCK_FALLBACK` 플래그와 "실제 모델 결과 아님" 배너로 명시한다.
- **실패 유형을 섞지 않는다.** 공공 API 실패, 첨부 다운로드 불가, 파싱 실패, 모델 서버 미접속(Qwen·Bosun 따로), gateway 미접속을 각각의 코드로 기록하고 따로 보여 준다.
- **파싱에 실패한 내용을 AI가 추측하지 않는다.** Qwen에는 파싱된 텍스트만 넣고 "첨부가 있었다"로 내용을 추정하게 하는 지시를 넣지 않는다. 결정 모델 state에는 첨부를 읽지 못했다는 사실 한 줄만 넣고 읽지 못한 문서로 질문을 만들지 않는다. `/explain`은 파싱 실패를 문장에 밝힌다.
- **외부 의존성은 조기에 점검한다(P0-0).** 서비스키·회사 GPU 추론 엔드포인트가 준비되면 다른 작업보다 먼저 실제 API 응답·첨부 다운로드·엔드포인트 접속(`GET /v1/models`·지연)·파서 후보를 확인하고 `docs/evidence/phase-0/external-deps.md`에 남긴다. 막히면 즉시 사용자에게 보고한다. 기다리는 동안은 인터페이스(`BidSourceConnector`·`AttachmentFetcher`·`DocumentParser`·`ModelClient`)로 진행하고, 저장 응답·문서 예시를 실제 응답인 것처럼 표시하지 않는다.
- **나라장터 서비스키 4개(`G2B_*_SERVICE_KEY`, 서비스마다 하나, [[16-DECISIONS|ADR-022]])는 서버 전용이다.** `OfficialApiConnector`(worker)만 읽고, 소스마다 registry `serviceKeyEnv`가 가리키는 키만 쓴다. `NEXT_PUBLIC_` 변수·브라우저 번들·로그·오류 메시지·`docs/evidence/`에 넣지 않고, 쿼리 파라미터로 붙으므로 요청 URL 로그에서도 가린다. 응답의 담당자 이름·전화·이메일은 `NormalizedBid`·데이터셋·모델 입력에 넣지 않는다 ([[09-SECURITY|09 보안]]).
- **첨부 다운로드는 allowlist로만 한다.** `https://www.g2b.go.kr`만 허용하고, 리다이렉트는 allowlist 안에서만 따르며, DNS를 다시 확인해 사설 IP를 거부한다. timeout 30 s, 최대 50 MB, 형식은 확장자가 아니라 내용으로 판단한다 ([[09-SECURITY|09 보안]] SSRF).
- 외부 API 필드/URL, 실제 기업 수주실적, 카카오 승인 상태, 벤치마크 수치, 모델 성능을 지어내지 말 것. 공공 API 엔드포인트는 `infra/sources/registry.yaml`에 등록한 것만 부른다. 모르면 `> [!warning] 미검증 가정` + mock.
- DEMO 데이터는 `is_demo=true`로 저장하고 UI에 DEMO 배지. 실데이터처럼 표시 금지. live 공고는 `is_demo=false`로 fixture 공고와 같은 DB에 있을 수 있으므로 `source`·`is_demo`로 구분해 표시한다. 회사 프로필은 로컬·시험·`demo:reset`에서 가상 솔리데오 프로필(`is_demo=true`)이고 분석 화면에 "가상 회사 프로필로 분석" 배지를 붙인다. 운영 DB는 공개 자료 프로필(`is_demo=false`)에 회사가 확인한 보유 자격(`COMPANY_CONFIRMED` 출처)만 더하고, 배지는 "공개 자료 회사 프로필로 분석"이다. 비공개 자료를 넣으려면 그 전에 DB 수준 잠금을 다시 정한다 ([[16-DECISIONS|ADR-052]]·ADR-059, [[09-SECURITY|09 보안]]).
- 새로 추가하거나 바꾼 계산·권한·저장·외부 입력 계약과 실제 결함에는 테스트를 추가한다. 새 표·정책에는 `scripts/database.test.mjs`(PGlite)에 RLS 정책 시험을 더한다. 단순 문구·표시·타입·기존 로직 전달만 하는 코드에 중복 시험을 일률적으로 추가하지 않는다 ([[11-TESTING|11 테스트]], ADR-046).
- `.env`를 읽어서 출력하거나 Git에 넣지 말 것. credential은 `.env.example` placeholder만.
- 작업을 묶어 대량 변경하기 전에 변경 파일 및 검증 명령 계획부터 정리할 것.

## 해커톤 모드

운영 배포는 Vercel web 단독(함수 지역 `syd1`, `vercel.json`)과 회사 Compose다. 회사 Compose는 기존 Redis에 붙는 redis-api·AI gateway와 ingest·analysis·documents·기업마당 전용 Worker를 띄운다. 알림 전용 Worker는 2026-10-30부터 인앱·마감 알림을 처리하고 카카오 발송은 꺼 두었다([[16-DECISIONS|ADR-049]], [회사 실행서](../infra/company/README.md) §7~§10, [[10-DEPLOYMENT|10 배포]], [기동 기록](evidence/company-rollout/20261030/notify-worker-rollout.md)). 지금 운영 상태는 [[PROGRESS]]다. Vercel 배포·회사 컨테이너 교체·`pnpm db:push` 같은 운영 변경은 검증 결과를 준비한 뒤 사용자 승인을 받고 한다. 로컬 Compose는 대체 경로·녹화·시험용이다.

### 우선순위 (ADR-023·042·054)
1. [[12-ROADMAP|12 로드맵]] **Critical Path C0~C9**를 순서와 선행 조건대로 끝낸다. 독립 작업은 병렬, 같은 파일은 한 작업자. P0-0(C1)은 서비스키·GPU 접속 정보가 들어오는 즉시 다른 작업과 나란히 시작하고, 막힌 항목은 즉시 사용자에게 보고한다. 회사 GPU의 모델 기동·GPU 메모리 배분은 회사 운영이라 우리는 하지 않는다([[16-DECISIONS|ADR-025]]).
2. 핵심 컷(S2·S3·S4·S-LIVE·S6·S7)이 전부 green(테스트 + [[10-DEPLOYMENT|10 배포]] 기동 절차 리허설)이기 전에는 확장 컷에 착수하지 않는다. 핵심 + 확장이 green이기 전에는 P1에 착수하지 않는다 — 예외는 9번이고, P1 다섯 화면([[16-DECISIONS|ADR-042]])은 모두 끝났다. 공식 제출은 2026-11-03, 발표는 2026-11-05다([[16-DECISIONS|ADR-054]]·[[16-DECISIONS|ADR-076]]). 남은 날은 [[12-ROADMAP|12 로드맵]] 남은 일정 제안 표(사용자 확인 전)다. 이미 구현된 코드와 진행 중인 브랜치는 지우거나 중단하지 않는다.
3. Phase 5는 mock adapter(CI용)를 먼저 만들고, 그다음 Qwen3.8-Flash-Next 실추출(P0-4) → Bosun 실추론(P0-6) → `/explain` 순서다. E3 실험을 포함한 평가 실험 E0~E3는 발표 뒤 진행 예정이다([[16-DECISIONS|ADR-067]]). 시험과 CI는 계속 `SOL_RUN_MODE=mock`으로 돈다.
4. S-LIVE는 운영 실공고 run으로 보인다([[16-DECISIONS|ADR-054]]). 첨부 처리(Documents Worker)는 회사에서 운영 중이고, 운영 실공고 분석은 2026-10-29 회사 AI gateway 교체 뒤 돌았다([기록](evidence/company-rollout/20261029/ai-gateway-rollout.md)). S-LIVE 녹화는 남았다. 어느 갈래인지는 12 로드맵 외부 의존성 컷 규칙으로 밝힌다. 녹화·fixture 결과를 live라고 표시하지 않는다.
5. 시간이 부족해도 범위를 임의로 줄이지 않는다. 보고 형식의 "해커톤 컷 영향" 줄에 선택지를 적고 사용자가 결정한다.
6. Phase 0 완료(C0) 시점부터 `mock` 모드 Compose 기동(`docker compose -f infra/compose.yaml up -d --build`, [[10-DEPLOYMENT|10 배포]] 기동 절차)이 항상 되어야 한다. 기동 절차 1~7은 Compose·Dockerfile·환경변수 계약·런타임 의존성·컨테이너 진입점을 바꾸거나 데모 스택을 통합할 때 실행한다. 일반 화면·문구·순수 계산 변경마다 다시 기동하지 않는다(ADR-046). C9에는 세 실행 모드 기동 리허설, 엔드포인트 재접속 확인, 로컬 Supabase CLI 전환 리허설을 넣는다.
7. 제출물(`docs/submission/`) 구조는 지금부터 병렬로 채우되, 미구현 화면을 완성품으로, 미검증 수치를 성과로 쓰지 않는다.
8. 파인튜닝 트랙 X6([[16-DECISIONS|ADR-034]])는 발표 뒤 진행 예정이다([[16-DECISIONS|ADR-067]]). 해커톤 안 일정에 넣지 않고, 발표 뒤 날짜도 정하지 않았다. 회사 GPU에서 학습을 시작하는 일은 실행 직전에 사용자 확인을 받는다. 학습(F1·F2·F3)은 회사가 실행하고, 우리는 평가셋·학습셋 번들·학습 요청서·E4 평가를 맡는다. Bosun LoRA는 E4로 공개 Bosun(E1')과 비교만 한다. 데모 앱과 레지스트리 서빙 항목(`bosun-v3.1-0.6b`)은 바꾸지 않고, 데모·S-LIVE 모델은 공개 Bosun v3.1 0.6B 그대로다. Qwen 파인튜닝은 하지 않는다(2026-10-20 사용자 결정). 실행 절차는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]다.
9. 데모 강화 컷([[16-DECISIONS|ADR-037]] BOOST-2), 확장 컷 4건([[16-DECISIONS|ADR-039]]), 부처 지원사업 공고([[16-DECISIONS|ADR-040]]), 카카오톡 추천 공고([[16-DECISIONS|ADR-038]]), P1 다섯 화면([[16-DECISIONS|ADR-042]]), 새 메뉴 3개([[16-DECISIONS|ADR-060]]), 추천 분석([[16-DECISIONS|ADR-066]])은 핵심 컷과 나란히 진행했고 모두 main에 들어갔다. 메일 알림([[16-DECISIONS|ADR-041]])은 해커톤에서 뺐다. 이 영역을 고칠 때도 추가형으로만 만든다: 핵심 컷 코드 경로와 계약(수집 저장 RPC, analysis job, `analyze()` 계산식, 골든 94/72/68)을 바꾸지 않는다. 새 띠·스위치에 확률·승률·"수주 가능성"처럼 읽히는 수치·문구를 두지 않는다(ADR-007).

### 해커톤 검증 정책 (ADR-046, 2026-10-21 사용자 승인)

**사용자 추가 지시 반영:** 실행 빈도뿐 아니라 시험 자체를 줄인다. 웹 단위 6,830개를 286개로, AI 1,511개를 101개로, 결정 서버 152개를 57개로 축소하고 DB는 핵심 21개를 남겼다. 중복 계층·상수/목업 값 고정·광범위한 오류 조합·템플릿 CRUD·확장 회귀의 시험 파일/케이스를 실제 삭제했다. `skip`이나 탐색 제외로 숨기지 않는다. 실행 명령과 게이트·CI·린트는 유지하며 남은 시험을 모두 발견해 실행한다. 현재 목록은 [[11-TESTING|11 테스트]] "현재 MVP 자동 시험"과 `docs/evidence/verification/20261021-pruned-tests.json`이다. 이전 전수 시험 표를 근거로 삭제한 시험을 일괄 복구하지 않는다.

개발 속도를 위해 실행 시점과 범위를 나눈다. 아래 정책은 템플릿·개별 스킬의 매 단계 전체 검증 및 다중 리뷰 지시보다 우선한다. 커밋 게이트·CI·린트의 필수 검사는 유지한다.

| 시점 / 변경 | 실행 |
|---|---|
| 개발 중 작업 종료 | `pnpm verify:changed`. HEAD 대비 staged·unstaged·untracked를 수집해 `verify.config.json`의 `changedPaths`에 해당하는 검사만 실행한다. 웹은 전체 웹 quick, Python은 해당 서비스 검사다. 빌드는 통합 시 실행한다 |
| 이미 커밋한 브랜치 전체 확인 | `pnpm verify:changed --base <작업 시작 커밋 또는 origin/main>`. 기본 HEAD 비교는 이전 커밋을 포함하지 않는다. `--dry-run`으로 실행 계획을 볼 수 있다 |
| DB·seed·루트 도구·공유 fixture 변경 | 경로 규칙에 따라 공통 검사와 의존 프로젝트 검사도 실행한다. 마이그레이션·DB 생성 타입·생성기 변경은 DB 타입 일치를 검사한다. 미분류 코드·검증 설정 변경은 전체 quick으로 넓힌다 |
| 문서·증거·발표자료만 변경 | 코드 검사를 실행하지 않는다. 문서의 경로·계약·사실관계는 직접 확인한다 |
| 통합 직전 / 제출 전 최종 코드 | 전체 `pnpm verify` 1회 + 변경한 사용자 흐름 E2E. 전체 E2E·핵심 데모 리허설은 제출 전 최종 코드에서 확인한다 |

- `verify:quick`은 빌드만 빠진 **전체** 검사다. 개발 중 기본 명령은 `verify:changed`다. 변경 범위 검사 성공을 전체 검사 성공이라고 보고하지 않는다.
- 실패한 검사는 먼저 해당 명령으로 재검증한다. 성공 후 바뀐 입력에 의존하는 검사를 다시 실행한다. 같은 코드·테스트·설정·fixture·환경의 성공 결과는 실행 커밋과 범위를 밝혀 재사용한다. 이전 실행의 실패는 숨기지 않는다.
- 전체 `pnpm verify`에 루트 DB 시험과 두 Python 서비스 pytest가 포함된다. 해당 입력이 그대로면 뒤에 `pnpm test:db`·pytest를 별도로 반복하지 않는다. `test:e2e`에는 `test:browser`가 포함된다.
- 개발 중 E2E는 변경한 spec·역할·흐름을 선택한다. `tasks-crud`·초대·팀 설정 등 템플릿 전체 회귀는 해당 기능 변경 때 또는 제출 전 통합 검사에서 실행한다. DB를 다시 seed하는 auth/work/ingestion suite는 각 전용 설정과 격리 대상 규칙을 지킨다.
- 기능 E2E는 1440을 중심으로 실행하고, 변경 화면의 1280 배치·가로 넘침을 별도로 확인한다. 제출 전에는 대표 데모 흐름을 1440·1280 두 폭에서 확인한다. 폭과 무관한 API·권한 단언을 두 폭에서 매번 반복하지 않는다. work-write의 선행 프로젝트를 강제로 생략하지 않는다.
- 작은 작업은 구현자가 관련 검증을 맡고, 독립 리뷰는 통합 단위로 한 번 실행한다. 같은 변경을 test/e2e/qa 에이전트·Superpowers task review·여러 predeploy 프로필로 중복 심사하지 않는다. 배포 전 리뷰는 변경 관련 프로필을 한 번 선택한다.
- 새 테스트는 계산·권한·저장·외부 입력 계약·실제 결함 재현에 집중한다. RLS·조직 격리·골든 94/72/68·정보 부족·모델 장애·DEMO 표시·사람 결정 저장은 유지한다.

### 증거 저장 (`docs/evidence/`)
작업 단위 폴더 아래에 저장한다. Phase 증거는 `phase-N/`, 기능·운영 기록은 주제 폴더(`deployment/`, `company-rollout/` 등)이고, 날짜가 있는 기록은 `YYYYMMDD` 하위 폴더를 쓴다(`docs/evidence/README.md`). 구조 예:
```text
docs/evidence/
  phase-0/
    compose-ps.txt            # docker compose ps 출력
    health-ready.json         # GET /health/ready 응답
    test-report.txt           # 실행 명령 + pnpm verify(서식·타입·린트·단위) 결과 마지막 20줄
    external-deps.md          # P0-0 외부 의존성 점검 항목별 결과 (11 §3.3)
    screenshots/
  phase-3/
    YYYYMMDD-phase3-bids-list-loaded-1440.png
    YYYYMMDD-phase3-bid-detail-completed-1280.png
  <주제>/YYYYMMDD/            # 예: company-rollout/20261029/ — 운영 반영·확인 기록
  eval/                       # 평가 리포트 숫자 요약·오류 분석 요약 (21 §4). RFP 원문 금지
  bosun-train-feasibility.md  # LoRA 메모리 검증 결과 (22 §4.2, X6(발표 뒤)를 회사가 실행한 뒤)
  demo-day/
    <날짜 폴더>/              # compose ps·health 응답·화면 확인
    rehearsal-log.md
```
전체 목록과 파일명은 [[11-TESTING|11 테스트]] §6을 따른다. LoRA 메모리 검증 절차는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] §4.2다. 서비스키 값·엔드포인트 인증 키·실제 RFP 원문·공공 API 응답의 담당자 개인정보는 증거에 넣지 않는다.
스크린샷 파일명 규칙: `YYYYMMDD-phaseN-<route>-<state>-<width>.png`
- `route`: 경로를 하이픈으로. `/auth/login`(Supabase Auth 로그인 화면) → `login`, `/bids` → `bids-list`, `/bids/[id]` → `bid-detail`, `/notifications` → `notifications`, `/admin/ingestion` → `admin-ingestion`.
- `state`: `loaded | empty | loading | error | forbidden | partial | demo-badge | what-if`([[06-UI-UX|06 UI]] §12).
- `width`: `1440` 기본. 목록과 상세 화면은 `1280`도 1장.
- 비밀값·토큰이 화면에 보이면 저장 금지.
- evidence 파일은 커밋 대상. Phase당 10MB 이하(PNG 압축).

### 데모 리허설
발표 리허설은 [[19-DEMO-SCENARIO|19 데모 시나리오]]의 D1 사전 준비를 따른다. 로컬 Compose(대체 경로·S5·S6 녹화)는 데모 스택 입력이 바뀌는 통합과 제출 전 최종 리허설에서 [[10-DEPLOYMENT|10 배포]] 기동 절차 1~15를 실행하고 `docs/evidence/demo-day/rehearsal-log.md`에 날짜·소요 시간·실패 단계를 기록한다. 입력이 그대로면 매 작업·매일 반복하지 않는다(ADR-046). 리허설 항목(세 실행 모드 기동, 엔드포인트 미접속 → 재접속 확인과 소요 시간, 공공 API 일일 호출 한도, 로컬 Supabase CLI 전환)은 [[19-DEMO-SCENARIO|19 데모 시나리오]] §6 체크리스트를 따른다.

## 각 Phase 결과 보고 형식
```text
Phase:
해커톤 컷: (핵심 / 확장 / P1 / 이후. 파인튜닝 트랙이면 X6)
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

## 작업 순서
작업 순서와 선행 조건은 [[12-ROADMAP|12 로드맵]] Phase 표와 Critical Path 표(C0~C9·X1~X6), 그리고 위 우선순위가 정본이다. 코드 위치(workspace·공유 계약 패키지 없음)는 [[16-DECISIONS|16 ADR]] ADR-017, 계약 단일 원천(zod)은 ADR-016, job 순서(ingest → documents → extract, analysis job 분리)는 [[02-ARCHITECTURE|02 아키텍처]]·[[03-AI-PIPELINE|03 AI 파이프라인]] §2, 가상 인력 사진 준비는 [[10-DEPLOYMENT|10 배포]]를 따른다.

## 구현 성공 증거
별도 리포트가 아닌 실행 로그로 `docker compose ps`, 마이그레이션 적용·정책 시험(`pnpm test:db`) 결과, 테스트 결과, 화면 E2E 스크린샷, 장애 시 fallback 결과, 외부 의존성 점검 결과(`phase-0/external-deps.md`), 평가 리포트 요약(`eval/`)을 `docs/evidence/`에 저장해 제출한다. 매 Phase 후 [[PROGRESS]] 체크리스트를 갱신한다.

## 관련 문서
- [[00-README|00 인덱스]]
- [[09-SECURITY|09 보안]] — service role 키·세션·RLS
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[12-ROADMAP|12 로드맵]]
- [[16-DECISIONS|16 ADR]] — ADR-010·012·017·020·023·025·034·049·054
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 리허설 체크리스트
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가 트랙·파인튜닝 착수 판단
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — X6 실행 절차
- [[PROGRESS]]
