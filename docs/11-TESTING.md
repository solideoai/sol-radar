---
title: "11. 검증·테스트 전략과 데모 수용 기준"
doc: "11"
status: review
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-10-20
---

# 11. 검증·테스트 전략

> [!tip] 심사 포인트
> "어떻게 검증했나"에 파일 단위로 답한다. 골든 시나리오 `G1`~`G8`과 계약 수용 기준 `G9`·`G10`은 각각 fixture ID·테스트 파일·실행 명령·증거 파일로 묶여 있고(§3), 데모 당일은 §5 체크리스트를 순서대로 통과한 기록이 `docs/evidence/`에 남는다(§6). 통과하지 못한 항목은 통과한 것처럼 적지 않는다. `S1`~`S7`은 [[19-DEMO-SCENARIO|19 데모 시나리오]]의 장면 번호다.
>
> 골든을 단언하는 실행 모드는 §3에 정한다. 실모델이 얼마나 맞히는지는 [[21-MODEL-TRAINING|21 모델 학습]]의 평가 체계가 잰다(§3.4). 평가 비교 대상은 `E0`~`E4`(21 §4.2)로 부르며 데모 장면 번호 `S0`~`S7`과 다르다.

## 1. 자동 테스트 매트릭스

시험 도구와 위치는 출발 템플릿의 관례를 그대로 쓴다([[16-DECISIONS|16 ADR]] ADR-017). 서버 도메인·Route Handler·수집·점수·worker는 모두 `web/` 안의 TypeScript라 Vitest 하나로 돌고, DB 권한은 PGlite 위의 정책 시험이 맡는다.

| 영역 | 도구 | 위치 | 필수 케이스 |
|---|---|---|---|
| Frontend 단위 | Vitest (화면 부품은 브라우저 모드 `*.browser.test.tsx`) | 대상 파일 옆 `*.test.ts(x)` — `web/app/**`, `web/components/**` (템플릿 관례) | 필터 ↔ URL 동기화, 상태 배지 아이콘+텍스트, 오류 화면 `requestId`, 결정 패널 역할별 활성 |
| 서버 도메인·Route Handler 계약 | Vitest | `web/server/<도메인>/*.test.ts`, `web/app/api/v1/**/route.test.ts` | `sol_role`별 허용·거부([[05-API-SPEC\|05 API]] 권한 열), 다른 조직 자원 404, zod 스키마 오류 코드, 쿠키 요청의 CSRF 헤더(`X-Requested-With`)와 Bearer 인증, `Idempotency-Key`, 커서 페이지네이션 |
| DB 정책 | `node --test` + PGlite | `scripts/database.test.mjs` (`pnpm test:db`) | RLS 조직 격리(`org_id in (select public.my_org_ids())`, 남의 조직 행 0건), 공용 공고 표는 `authenticated` 읽기만·쓰기 거부, `memberships.sol_role` CHECK, UNIQUE·CHECK 제약, 마이그레이션 재실행, seed 멱등 |
| E2E | Playwright + axe | `web/e2e/`(로그인 전), `web/e2e-auth/`(로그인 뒤) | 로그인 → 목록 → 상세 → 분석 → 결정, PARTIAL 배너, DEMO 배지, 격리, 변경 알림, a11y 위반 0 |
| Pipeline | Vitest + fixtures | `web/server/ingestion/*.test.ts`, `web/worker/*.test.ts` | 정정/취소/중복/차수/429/누락/금액·타임존 정규화, worker(service role) 쓰기의 `org_id` 직접 지정·테넌트 혼입 0. `OfficialApiConnector` 계약(저장한 응답 재생), 호출 예산·에러코드 22, 첨부 다운로드 allowlist, 실패 유형별 기록(§3.2) |
| Scoring | Vitest goldens | `web/server/scoring/*.test.ts` | 0~100, 결정론, 요소별 missing 정책, 자격 override, Kev 승격 금지. 3값·사유 코드, 정보 부족 ≠ 미충족, API 구조화 필드 우선, Kev `kev-qs/v0.2` 불변(§3.2) |
| AI service | pytest | `services/ai/tests/` | `RequirementExtraction` JSON Schema, 인용 원문 대조, Kev adapter mock, timeout → fallback. `/parse` 형식별 결과·사유 코드, 실행 모드 모순·한국어 state·레지스트리 불일치 기동 거부, mock 대체 표시, `/explain` 숫자 검사(§3.2) |
| Infra | Compose smoke (shell) | `infra/smoke.sh` | 최초 부팅, 재부팅 후 volume 유지, `/health/ready`(`checks.db` = Supabase 연결). `pnpm check:env` 실행 모드 모순 거부(§3.2 V2-01) |

조직 격리(G5)는 세 겹으로 확인한다: DB 정책 시험(PGlite, RLS가 행을 숨기는지) → Route Handler 시험(숨겨진 행을 `404`·빈 목록으로 바꾸는지) → E2E(실제 세션으로 화면·API에 안 보이는지). 앞의 둘은 `pnpm verify`에 들어가고, E2E는 Phase 끝과 데모 전에 돌린다.

모델 평가(추출 정확도, Macro-F1, 보정, 한국어/영어 차이, 지연·GPU 메모리)는 이 매트릭스에 없다. 통과/실패를 가르는 결정적 회귀가 아니라 측정이므로 `pnpm verify`·CI에 넣지 않고 노트북에서 회사 GPU 추론 엔드포인트에 붙여 돌린다(§3.4, [[21-MODEL-TRAINING|21 모델 학습]] §4).

## 2. 실행 명령

```bash
pnpm verify                                       # 공통 검사 + web(서식·타입·린트·Vitest·lodestar·토큰·빌드). 정본 verify.config.json
pnpm -C web test                                  # Vitest: 서버 도메인·Route Handler·scoring goldens·ingestion·worker
pnpm test:db                                      # DB 정책: supabase/migrations를 PGlite에 올려 RLS·제약·seed 멱등 (scripts/database.test.mjs)
pnpm -C web test:e2e                              # Playwright 로그인 전(web/e2e) + 부품 브라우저 시험
pnpm -C web test:e2e:auth                         # Playwright 로그인 뒤(web/e2e-auth, 템플릿 시드)
pnpm -C web test:e2e:work                         # Playwright C6 업무 화면(web/e2e-auth, demo:reset·demo:preanalyze, 1440·1280)
uv run --project services/ai pytest               # AI gateway
bash infra/smoke.sh                               # compose ps + health + 큐 왕복
```

시험 하나만 돌릴 때는 `pnpm -C web exec vitest run <파일 또는 경로 조각> -t "<이름>"`(예: `pnpm -C web exec vitest run server/scoring`). 루트 `pnpm test`는 `scripts/**/*.test.mjs` 전체라 `pnpm verify`의 공통 검사에 DB 정책 시험이 이미 들어 있다.

위 자동 시험은 모두 `SOL_RUN_MODE=mock`으로 돌고 실제 공공 API·회사 GPU 추론 엔드포인트를 부르지 않는다. 공공 API 응답은 저장한 응답을 재생하는 `RecordedApiConnector`로, 첨부는 `FixtureAttachmentFetcher`로, 모델은 mock `ModelClient`로 대신한다. 실제 외부 의존성 확인은 §3.3, 모델 측정은 §3.4에서 따로 한다.

> [!warning] 미검증 가정
> - 템플릿의 `pnpm -C web test:e2e:auth`는 로컬 Supabase(`pnpm db:start`)와 템플릿 시드 `scripts/db-seed.mjs`(로컬 전용)를 전제로 한다. C6(main `4ae09f9`)은 업무 화면 E2E를 따로 `pnpm -C web test:e2e:work`(`web/playwright.work.config.ts`)로 두었다. 이 명령도 로컬 Supabase·Compose(redis·ai-gateway mock·worker) 위에서 돌고, globalSetup이 `pnpm demo:reset` → 모드 확인 → `pnpm demo:preanalyze`(18건)로 데모 상태를 다시 만든다. 공용 DB를 다시 seed하므로 verify·CI에는 넣지 않는다. Supabase 클라우드 개발 프로젝트에서 로그인 뒤 E2E를 돌리는 방법은 아직 정하지 않았다.
> - 로그인 뒤 E2E를 띄우는 웹 서버에는 메일 env 4개(`SMTP_HOST`·`SMTP_PORT`·`MAIL_FROM`·`SITE_URL`)가 있어야 한다. 초대 메일 시험이 로컬 메일함(Mailpit)을 읽기 때문이다. `pnpm db:start`가 비어 있을 때만 `web/.env.local`에 로컬 메일함 값을 적는다(`scripts/local-env.mjs`). 셸 env로 웹 서버를 띄우는 실행 템플릿에도 이 4개를 넣는다([[16-DECISIONS|ADR-033]] E5).
> - `services/ai` pytest는 `verify.config.json`의 `ai` 프로젝트로 등록돼 `pnpm verify`가 돌린다(`uv` 필요, Phase 0). `infra/smoke.sh`는 Docker가 필요해 `pnpm verify` 밖에서 수동으로 돌린다. CI(GitHub Actions)의 `astral-sh/setup-uv` 단계는 실행 확인 전이다([[PROGRESS]]).

CI는 템플릿 방식(`verify.config.json`을 읽는 `pnpm verify`)으로 돌리고, 위 명령 중 어느 하나라도 실패하면 Phase 완료로 보고하지 않는다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]).

## 3. 골든 시나리오 ↔ fixture ↔ 테스트 ↔ 명령

골든 G1~G10은 `SOL_RUN_MODE=mock`에서만 단언한다. `fixture` 모드는 같은 fixture를 쓰지만 실모델(Qwen3.5-9B·Kev-9B) 추출·분포가 mock과 다를 수 있으므로 골든 수치(`FX-01` 94·`FX-02` 72·`FX-03` 68, Kev 71/24/5·36/52/12)를 단언하지 않는다([[16-DECISIONS|ADR-020]]).

fixture ID는 [[07-DATA-PIPELINE|07 수집]] §6.2. 테스트 파일은 Phase 1~6에서 만든다. 2026-10-19 기준 `web/server/ingestion`(Vitest 36개)·`web/server/scoring`(13개)·`web/server/analysis`(11개)·`web/worker`(12개)·`services/ai/tests`(pytest 21개)·`scripts/database.test.mjs`(G5 RLS 정책 겹)가 있어, G1·G3·G7·G9 전부와 G2·G4·G5·G6·G10의 서버·gateway·DB 쪽 파일은 있다. 2026-10-20 C6(main `4ae09f9`)·C7(main `841b064`) 병합으로 `web/server/notifications`(G2), `web/app/api/v1/tenant-isolation.test.ts`, `web/e2e-auth/`의 `bid-isolation`·`demo-badge`·`no-evidence` spec이 생겼다. 아래 표에서 아직 없는 파일(`web/e2e-auth/partial-analysis.spec.ts`·`cancelled-bid.spec.ts`·`admin-ingestion.spec.ts`, `web/server/dashboard/deadline-summary.test.ts`, `web/server/notifications/deadline.test.ts`)과 `EvidenceRef` 계약(G10)은 **예정**이다. 경로는 저장소 루트 기준이고, Vitest 서버 시험은 템플릿 관례대로 `.test.ts`, Playwright E2E는 `.spec.ts`다. 명령 열의 `vitest <경로>`는 `pnpm -C web exec vitest run <경로>`의 줄임, `e2e:auth`는 `pnpm -C web test:e2e:auth`의 줄임이다. 증거 열은 §6의 저장 위치.

| # | 시나리오 | fixture | 테스트 파일 | 명령 | 통과 기준 | 증거 |
|---|---|---|---|---|---|---|
| G1 | 같은 공고 2회 수집 → bid 1건, revision 1, 이벤트 0 | `FX-09` (+`FX-10` 차수) | `web/server/ingestion/idempotent-upsert.test.ts` | `pnpm -C web exec vitest run server/ingestion` | `bid_notices` 1행, `bid_revisions` 1행, `notifications` 추가 0 | `phase-2/test-ingestion.txt` |
| G2 | 마감일 변경 → revision diff 저장, 알림 정확히 1건 | `FX-06` (+`FX-07` 예산·요구사항) | `web/server/ingestion/revision-diff.test.ts`, `web/server/notifications/outbox.service.test.ts`·`outbox-dedupe.test.ts` | 위와 동일 + `vitest server/notifications` | 해커톤은 **이벤트 단위 + 알림 멱등**으로 본다([[16-DECISIONS\|ADR-033]] E3, 공고 알림 펼치기는 S5·확장 컷): revision 2, diff에 `deadlineAt` 전/후, `BID_CHANGED` outbox 1건(다시 수집해도 1건). 같은 outbox 이벤트를 다시·동시에 처리해도 알림 1건(`<outboxEventId>:<userId>:IN_APP` UNIQUE) | `phase-2/test-ingestion.txt`, `phase-6/test-notifications.txt` |
| G3 | 필수 업종 자격 부족 → NO-BID, Kev BID 무시 | `FX-03` (+`FX-16` 일치 사례) | `web/server/scoring/decision-policy.golden.test.ts`, `web/server/scoring/kev-no-override.test.ts` | `pnpm -C web exec vitest run server/scoring` | 권고 `NO-BID`, `reviewFlags` 포함 `MODEL_RULE_DISAGREEMENT`, 점수 68 참고 표시 | `phase-4/goldens-report.txt` |
| G4 | 근거 문서 없음 → NEEDS_REVIEW/WATCH, 수주확률 문구 없음 | `FX-04` (+`FX-05` 파싱 실패) | `web/server/scoring/needs-review.test.ts`, `services/ai/tests/test_extraction_schema.py`, `web/e2e-auth/no-evidence.spec.ts` | `vitest server/scoring`, `pytest`, `e2e:auth` | 자격 `NEEDS_REVIEW`, 권고 `WATCH`, 응답·화면에 "수주 확률" 문자열이 "아님" 없이 단독 등장 0회 | `phase-4/goldens-report.txt`, `phase-5/test-ai.txt`, `phase-3/e2e/no-evidence.png` |
| G5 | 다른 orgId로 조회 → 404 | `FX-01` + `org-02` VIEWER `viewer@other.invalid` 세션(Bearer 토큰) | `scripts/database.test.mjs`(RLS 정책), `web/app/api/v1/tenant-isolation.test.ts`(Route Handler), `web/e2e-auth/bid-isolation.spec.ts` | `pnpm test:db`, `vitest app/api/v1`, `e2e:auth` | `GET /bids/{FX-01}/qualification-checks` 404, `GET /analyses/{org-01 분석 id}` 404, `GET /bids/{FX-01}/reviews` 빈 목록, `GET /company-profile`은 org-02 revision 1. 응답 본문에 org-01 데이터 0건. DB 정책 시험: org-02 사용자 세션으로 org-01의 `company_profiles`·`score_runs`·`qualification_checks`·`bid_reviews` 0행 | `phase-1/test-isolation.txt`, `demo-day/*/isolation-404.json` |
| G6 | Kev/Qwen 장애 → PARTIAL + 규칙만, 사용자에게 설명 | `FX-01` + 테스트 전용 장애 주입(`AI_FAULT_INJECT` 또는 장애 fixture) | `web/server/analysis/fallback.model.test.ts`, `services/ai/tests/test_gateway_fallback.py`, `web/e2e-auth/partial-analysis.spec.ts` | `vitest server/analysis`, `pytest`, `e2e:auth` | `status=PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags` 포함 `AI_UNAVAILABLE`, 점수·자격 존재, 배너 문구가 09 고지와 일치 | `phase-5/ai-fallback.txt`, `phase-5/e2e/partial.png` |
| G7 | API 429 → 지수 재시도 후 성공, 체크포인트 복구 | `FX-20` | `web/server/ingestion/rate-limit-retry.test.ts` | `vitest server/ingestion` | 재시도 2회 로그, `Retry-After` 대기 준수, `ingest_runs.cursor` 복구, 적재 1건 | `phase-2/ingest-run-FX-20.json` |
| G8 | 가상 DEMO 데이터는 가상 표시, 실제 모드와 혼동 없음 | 전체 (`FX-01` 대표) | `web/server/bids/demo-flag.test.ts`, `web/e2e-auth/demo-badge.spec.ts` | `vitest server/bids`, `e2e:auth` | 모든 응답 `isDemo=true`, 목록·상세·Topbar에 `DEMO` 배지, `DEMO_MODE=false`에서 fixture 미적재 | `phase-3/e2e/demo-badge.png` |
| G9 | AI 파이프라인 수용 기준 전체 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §9) | `fixtures/extractions/FX-01·02·03·04·05·13`, `fixtures/kev/*` | `services/ai/tests/test_extraction_schema.py`, `test_citation_verify.py`, `test_kev_adapter.py`, `test_gateway_fallback.py` | `pytest` | 03 §9의 각 항목 통과. 인용 검증 실패(`FX-13`) → 해당 필드 `UNKNOWN` + `note="CITATION_FAILED"`, 실패 인용 `match=FAILED`, `warnings`에 `CITATION_FAILED:qualifications`(`CONFLICTED` 아님, [[16-DECISIONS\|ADR-029]] A1). 파싱 실패(`FX-05`) → `warnings`의 `ATTACHMENT_PARSE_FAILED:*`로 추출 `PENDING_REVIEW`(A2). Kev 질문 4종 스키마 일치 | `phase-5/test-ai.txt` |
| G10 | 데이터 계약 수용 기준 전체 ([[15-DATA-CONTRACTS\|15 데이터 계약]] §9) | `FX-11`, `FX-12`, `FX-13`, `FX-14` | `web/server/ingestion/normalized-bid.contract.test.ts`(`EvidenceRef` 계약 시험은 예정) | `vitest contract` | 15 §9의 각 항목 통과. `NormalizedBid` 스키마, `fieldState` 4종, 원본·정규화 값 병기, null 대체 금지 | `phase-2/test-contracts.txt` |

`web/e2e-auth/isolation.spec.ts`는 템플릿이 이미 가진 조직 화면 격리 시험이라 이름이 겹치지 않게 G5 E2E는 `bid-isolation.spec.ts`로 둔다.

장애 주입은 두 가지를 구분한다([[10-DEPLOYMENT|10 배포]] "장애 주입" 절).

| 용도 | 방법 | 비고 |
|---|---|---|
| 자동 테스트(G6) | `AI_PROVIDER=mock` + `AI_FAULT_INJECT=kev_timeout\|qwen_error\|gateway_down\|qwen_unreachable\|kev_unreachable`(테스트 전용 env, 5값) 또는 mock 어댑터의 장애 fixture. `gateway_down`이면 gateway의 `/extract`·`/kev`·`/explain`이 `503 {"errorCode":"AI_UNAVAILABLE","message"}`로 응답해 gateway 연결 불가를 흉내 낸다(시험 전용 예외, [[16-DECISIONS\|ADR-029]] A3) | 컨테이너 없이 Vitest·pytest에서 재현 |
| 데모 S6 | `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` 재분석 → `docker compose -f infra/compose.yaml start ai-gateway` | 10이 확정. 데모에서는 이 방법만 쓴다 |

`AI_FAULT_INJECT`의 값(`kev_timeout` / `qwen_error` / `gateway_down` / `qwen_unreachable` / `kev_unreachable`)과 "테스트 전용, 데모·운영 금지" 규칙은 [[03-AI-PIPELINE|03 AI 파이프라인]] §3 env 표가 원천이다.

### 3.1 골든 외 회귀 케이스

2026-10-19 기준 `web/server/scoring/`의 `missing-policy`·`scale-limit`·`worked-examples.golden`·`reproducibility`(C4), `web/server/ingestion/`의 `cancel`·`quarantine`·`normalize-amount`·`normalize-date`·`stage-link`, `services/ai/tests/test_citation_verify.py`가 있다. `web/server/notifications`는 C7(main `841b064`), 화면 E2E 일부는 C6(main `4ae09f9`)로 생겼다. `web/server/dashboard`와 아래 표의 `cancelled-bid`·`admin-ingestion` spec은 예정이다.

| fixture | 검증 대상 | 테스트 파일 |
|---|---|---|
| `FX-08` | 취소 → 재분석 없음, 검토 기록 보존, 버튼 비활성 | `web/server/ingestion/cancel.test.ts`, `web/e2e-auth/cancelled-bid.spec.ts` |
| `FX-11` | 예산·마감 null → `missingFactors` 1건, 마감 집계 제외 | `web/server/scoring/missing-policy.test.ts`, `web/server/dashboard/deadline-summary.test.ts` |
| `FX-12` | 필수 필드 누락 → 격리, 관리자 화면 노출 | `web/server/ingestion/quarantine.test.ts`, `web/e2e-auth/admin-ingestion.spec.ts` |
| `FX-13` | 금액 텍스트 정규화, 원본 보존. 인용 검증 실패 → 해당 필드 `UNKNOWN` + `CITATION_FAILED`(`CONFLICTED` 아님, ADR-029 A1) | `web/server/ingestion/normalize-amount.test.ts`, `services/ai/tests/test_citation_verify.py` |
| `FX-14` | KST→UTC, 마감 임박 카드, `DEADLINE_APPROACHING` 하루 1회 | `web/server/ingestion/normalize-date.test.ts`, `web/server/notifications/deadline.test.ts` |
| `FX-15` | 수행 상한 초과 → `scaleFit` 0점 + `SCALE_LIMIT_EXCEEDED` | `web/server/scoring/scale-limit.test.ts` |
| `FX-17`, `FX-18` | `planRef` 기반 단계 연결 | `web/server/ingestion/stage-link.test.ts` |
| `FX-19` | 제목 유사도만 → 후보 표시, 병합 없음 | `web/server/ingestion/stage-link.test.ts` |
| `FX-01`~`FX-03` | [[08-SCORING\|08 SOL Score]] §6 worked example 수치 일치 | `web/server/scoring/worked-examples.golden.test.ts` |
| 전체 | 재현성: 같은 `input_snapshot_hash` + `algorithm_version` → 같은 `score`·같은 요소별 `points`(두 번 계산 byte-동일) | `web/server/scoring/reproducibility.test.ts` |

### 3.2 실데이터·실행 모드 시험 (ADR-020)

[[16-DECISIONS|ADR-020]]의 파이프라인 v0.2(세 실행 모드, 나라장터 실수집·첨부 파싱, 실추론, Kev `kev-qs/v0.2`)에 필요한 시험이다. 골든과 구분해 `V2` 번호를 쓴다. 2026-10-19 기준 V2-01·V2-03·V2-05·V2-06·V2-07·V2-08·V2-10·V2-11·V2-12·V2-13의 서버·gateway 파일은 있고, V2-02의 화면·`web/server/bids` 쪽, V2-04의 `web/server/analysis` 쪽, V2-09의 대체 동작 시험은 구현 때 추가한다. 표에 있다고 통과했다는 뜻이 아니다. 모두 `SOL_RUN_MODE=mock`이나 저장 응답·스텁으로 돌고 실제 네트워크를 쓰지 않는다. 장애 주입 값은 [[03-AI-PIPELINE|03 AI 파이프라인]] §3 env 표를 따른다. P0 번호는 [[12-ROADMAP|12 로드맵]]의 해커톤 우선순위다.

| ID | 자동 검증할 조건 | 테스트 파일 | 명령 | P0 |
|---|---|---|---|---|
| V2-01 | **실행 모드 모순 기동 거부.** `SOL_RUN_MODE`와 직접 준 `DEMO_MODE`·`AI_PROVIDER`·`KEV_ENABLED`가 모순되면 `pnpm check:env`와 gateway가 기동을 거부하고 모순된 키 이름을 알린다. 예: `live` + `AI_PROVIDER=mock`, `live` + `AI_FALLBACK_TO_MOCK=true`. 값을 조용히 바꾸지 않는다. 미지정이면 `mock`. 정상 세 모드 조합은 통과. `pnpm check:env`는 `process.env`가 아니라 `infra/.env`·`web/.env*` **파일**을 읽으므로 시험과 수동 확인은 파일(또는 `--root`로 가리킨 임시 트리)에 모순 값을 적어 한다 | `scripts/check-env.test.mjs`, `services/ai/tests/test_run_mode.py` (둘 다 Phase 0에서 작성됨) | `node --test scripts/check-env.test.mjs`, `pytest` | P0-1 |
| V2-02 | **출처·모드 기록과 표시.** 분석마다 `score_runs.run_mode`(`LIVE`·`FIXTURE`·`MOCK`)·`ai_provider`·`qwen_model`·`kev_model`·`question_set_version`, 추출마다 `provider`·`model_name`, 수집마다 `ingest_runs.run_mode`·`source`가 저장된다. 화면: 머리말 "실행 모드", 분석 요약 띠 "분석 실행 모드: live\|fixture\|mock"과 "AI: mock" 또는 "AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0"(받은 모델 식별자 그대로, [[16-DECISIONS\|ADR-029]] A6 D12), `is_demo` 공고의 `DEMO` 배지, 공고 목록 `origin=live\|demo\|all` 필터, 모든 모드의 "가상 회사 프로필로 분석" 배지 | `web/server/analysis/analysis-store.model.test.ts`, `web/server/bids/origin-filter.test.ts`, `web/e2e-auth/run-mode-badge.spec.ts` | `vitest server/analysis`, `vitest server/bids`, `e2e:auth` | P0-1, P0-7 |
| V2-03 | **실패 유형 4종 구분.** 공공 API 실패(HTTP 오류·`resultCode` 비정상·에러코드 22·timeout) → `ingest_runs.status`·`ingest_errors`, 기존 공고 유지. 첨부 다운로드 불가(인증 요구·4xx·5xx·allowlist 밖 리다이렉트·크기 초과) → `download_status=FAILED` + 사유, 본문만 추출, `DOCUMENT_DOWNLOAD_FAILED`. 파싱 실패·부분 파싱 → `parse_status`·`parse_error_code`, `PARSE_UNSUPPORTED`. 모델 서버 미접속 → `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록(Qwen 불가: 캐시된 추출, 없으면 `UNKNOWN` → `PARTIAL` / Kev 불가: `RULES_ONLY`). 한 유형을 다른 유형의 코드로 기록하면 실패. gateway 미접속은 G6 | `web/server/ingestion/official-api-errors.test.ts`, `web/server/ingestion/attachment-fetcher.test.ts`, `web/server/analysis/fallback.model.test.ts`, `web/server/analysis/analysis.service.test.ts`, `services/ai/tests/test_model_unavailable.py` | `vitest server/ingestion`, `vitest server/analysis`, `pytest` | P0-2~P0-4, P0-6 |
| V2-04 | **파싱 실패 내용을 AI가 추측하지 않는다.** 첨부가 `FAILED`·`UNSUPPORTED`인 공고에서 Qwen 입력에는 파싱된 텍스트만 들어가고 "첨부가 있었다"로 내용을 추정하게 하는 지시가 없다. 근거가 파싱 텍스트에 없는 값은 인용 검증에서 `UNKNOWN`. Kev state에는 "RFP attachment could not be read; requirements may be incomplete" 한 줄만 들어가고, 읽지 못한 문서로 만든 Kev 질문은 0개. `/explain` 문장에 파싱 실패가 밝혀진다 | `services/ai/tests/test_extraction_schema.py`(`ATTACHMENT_PARSE_FAILED:*` → `PENDING_REVIEW`. Kev state 한 줄·`/explain` 문장 시험은 예정), `web/server/analysis/parse-failure.test.ts`(예정) | `pytest`, `vitest server/analysis` | P0-3, P0-4 |
| V2-05 | **정보 부족 ≠ 미충족.** 공고 쪽 `UNKNOWN`·`CONFLICTED` → `NEEDS_REVIEW` + `NOTICE_INFO_MISSING`·`NOTICE_CONFLICTED`. 회사 기록·증빙 없음 또는 `complete=false` → `NEEDS_REVIEW` + `COMPANY_EVIDENCE_MISSING`. 모든 `NOT_SATISFIED`에 공고 근거 1건 이상과 회사 쪽 명시적 부정 근거(`NOT_HELD`, 요구치 미만 수치, `complete=true` 목록에 없음) 1건 이상. API 구조화 필드가 추출보다 우선이고 두 값이 다르면 `CONFLICTED`. 면허제한이 여러 행이면 `AMBIGUOUS_MATCH` | `web/server/scoring/requirement-status.test.ts`, `web/server/scoring/structured-field-priority.test.ts` | `vitest server/scoring` | P0-5 |
| V2-06 | **Kev v0.2는 규칙·점수·권고를 바꾸지 못한다.** 같은 입력에 Kev `kev-qs/v0.2` 응답을 극단값(모든 확률 1.0·0.0)·누락·오류로 바꿔도 규칙 판정·`qualification_checks`·점수·요소별 `points`·권고가 byte-동일. 바뀌는 것은 `reviewFlags`(`KEV_REQUIREMENT_DISAGREEMENT`·`KEV_DELIVERY_RISK`, τ=0.70 "미보정")와 참고 지표뿐. 응답에 `KevAssist.disclaimer`와 보정 상태 `UNCALIBRATED`. "충족 확률"·"수주 확률"이 "아님" 없이 단독 등장 0회 | `web/server/scoring/kev-no-override.test.ts`(describe "G3·V2-06"), `web/server/scoring/review.independent.test.ts` | `vitest server/scoring` | P0-6 |
| V2-07 | **한국어 state 운영 거부.** `/kev`에 `stateLanguage:"ko"`가 `KEV_ALLOW_KO_STATE=true` 없이 오면 `422 KO_STATE_NOT_ALLOWED`. `SOL_RUN_MODE=live`와 함께 쓰면 gateway가 기동을 거부한다. `en`·`ko` 템플릿의 줄 순서·항목 id·숫자가 같다. 운영 `en` state에 한글 0자(자유 텍스트는 `translations`, 숫자 보존에 실패한 값은 `(untranslated)`). 규칙 결과는 state에 0건 | `services/ai/tests/test_kev_adapter.py`·`services/ai/tests/test_local_kev_v02.py`(`KO_STATE_NOT_ALLOWED`), `services/ai/tests/test_run_mode.py`(`live` + `KEV_ALLOW_KO_STATE=true` 기동 거부) | `pytest` | P0-6 |
| V2-08 | **레지스트리 불일치 기동 거부.** Kev `GET /v1/models`의 `run`·`base`·`lora`·`temperature`가 `services/ai/models/registry.yaml`의 `KEV_MODEL_ID` 항목과 다르면(예: `run`이 `runs/smoke`) gateway가 기동을 거부한다. 레지스트리의 `questionSet`·`stateTemplate`이 gateway 설정과 달라도 거부. Kev는 스텁 서버로 대신한다. 가중치 sha256 대조는 회사가 기동 전에 한다(ADR-025, [[22-FINETUNE-RUNBOOK\|22]] §2.2)라 이 시험 범위 밖이다 | `services/ai/tests/test_model_registry.py` | `pytest` | P0-6 |
| V2-09 | **mock 대체는 명시한다.** 기본 `AI_FALLBACK_TO_MOCK=false`에서 모델 불가 → `PARTIAL`·`RULES_ONLY`이고 mock 결과 0건. 해커톤 동안은 자동 대체를 구현하지 않아 `true`면 기동 거부다([[16-DECISIONS\|ADR-030]] B11). 아래 대체 동작 시험은 구현할 때 쓴다. `true`(`fixture` 모드)에서 실제로 대체되면 그 run의 `ai_provider=MOCK`, `fallback_reason`(`QWEN_UNAVAILABLE` 등), `reviewFlags`에 `MOCK_FALLBACK`, 배너 "모델 서버에 연결하지 못해 Mock 결과를 표시합니다. (실제 모델 결과 아님)". `live`에서 켜면 기동 거부(V2-01). 지금은 `mock`·`fixture` 모드도 `true`면 기동 거부다(`infra/run-modes.json` 세 모드 모두 `forbidden`). 공공 API가 실패해도 `FixtureConnector`로 바뀌지 않는다 | 기동 거부: `services/ai/tests/test_run_mode.py`(mock·fixture·live 세 모드), `services/ai/tests/test_local_startup.py`(`FORBIDDEN_IN_MODE`). `scripts/check-env.test.mjs`는 `live` 케이스만이고 mock·fixture 케이스는 예정. 대체 동작(예정): `web/server/analysis/mock-fallback.test.ts`, `services/ai/tests/test_mock_fallback.py`, `web/e2e-auth/mock-fallback.spec.ts` | `node --test scripts/check-env.test.mjs`, `pytest`, `vitest server/analysis`, `e2e:auth` | P0-1 |
| V2-10 | **파서 결과와 품질.** 형식별 `DocumentParser`: fixture PDF(텍스트 레이어)·HWPX·HWP 샘플 → `PARSED` + 페이지별 `charOffset`. 부분 파싱 → `PARTIAL` + 품질 신호. 스캔 PDF·zip·xlsx·암호 문서·배포용 HWP·50 MB 초과 → `UNSUPPORTED` + `errorCode`(`NO_TEXT_LAYER`·`UNSUPPORTED_FORMAT`·`ENCRYPTED`·`DISTRIBUTION_PROTECTED`·`TOO_LARGE`·`CORRUPTED`). 형식은 확장자가 아니라 내용(매직 바이트)으로 판단. 파서 후보 비교와 실공고 파싱 성공률은 자동 시험이 아니라 측정이다(아래) | `services/ai/tests/test_parse.py` | `pytest` | P0-3 |
| V2-11 | **공공 API 호출 예산과 서비스키 보호.** Redis 카운터 `quota:{serviceId}:{YYYYMMDD}`(KST)가 한도의 90%에 닿으면 보조 조회를 멈추고 그 공고는 `NEEDS_REVIEW`(정보 부족). 에러코드 22를 받으면 그 서비스의 그날 호출만 중단(다른 서비스는 계속). 초당 30 tps를 넘지 않는다. 서비스키 4개(`G2B_*_SERVICE_KEY`) 값이 각각 로그·오류 메시지·`ingest_errors`·응답 본문에 0회(쿼리 파라미터라 요청 URL도 가린다). 소스는 registry `serviceKeyEnv`의 키만 쓰고 다른 서비스의 키로 대체하지 않는다 | `web/server/ingestion/quota.test.ts`, `web/server/ingestion/service-key-redaction.test.ts` | `vitest server/ingestion` | P0-2 |
| V2-12 | **첨부 다운로드 allowlist.** `https://www.g2b.go.kr`만 허용, 리다이렉트는 allowlist 안에서만, DNS 재확인 후 사설 IP 거부, timeout 30 s, 최대 50 MB([[09-SECURITY\|09 보안]] SSRF). 저장 키 `raw/bids/{bidId}/{revisionId}/{sha256}.{ext}` | `web/server/ingestion/attachment-fetcher.test.ts` | `vitest server/ingestion` | P0-3 |
| V2-13 | **`/explain` 숫자 검사.** 설명에 입력(규칙 판정·점수 분해·인용·Kev 참고 요약)에 없는 숫자가 있으면 템플릿 문장으로 바꾸고 `fallback:true` | `services/ai/tests/test_explain.py` | `pytest` | P0-7 |

**측정 항목 (자동 시험 아님, 증거로 남긴다)**

- 파서 후보 비교(U13): 실제 RFP 샘플로 후보마다 본문·표·금액·자격 조건·요구사항 누락과 라이선스를 비교해 형식별로 정한다. 결정 전까지 처리할 수 없는 첨부는 `PARSE_UNSUPPORTED` → 확인 필요. 후보와 절차는 [[07-DATA-PIPELINE|07 수집]]을 따른다.
- 실공고 파싱 성공률(P0-3): 실제 공고 30건의 첨부에서 PDF·HWPX·HWP 형식별 성공률. 처음 재는 값이라 목표치를 두지 않는다. 증거 `phase-2/parse-success-rate.md`.
- Qwen 실추출 인용 검증 통과율과 실공고 1건 E2E 로그(P0-4), Kev-9B@v1.0 `kev-qs/v0.2` 응답 원문·`stateTrace` 저장(P0-6). 증거는 `phase-5/`.

### 3.3 외부 의존성 점검 (P0-0)

서비스키·회사 GPU 추론 엔드포인트([[16-DECISIONS|ADR-025]])가 준비되는 대로 다른 작업보다 먼저 한다. 결과는 `docs/evidence/phase-0/external-deps.md`에 항목마다 날짜·실행한 명령·결과(통과 / 막힘 / 대기)·막힌 이유·사용자에게 보고한 시각으로 적는다. 막힌 항목은 즉시 사용자에게 보고하고 "막힘"으로 남긴다. 통과한 것처럼 적지 않는다.

| # | 확인할 것 | 남길 것 |
|---|---|---|
| ① | data.go.kr 오퍼레이션별 실제 응답 3건 저장, 필드 매핑 확인 | 오퍼레이션·`resultCode`·확인한 필드. 저장한 응답은 담당자 이름·전화·이메일을 마스킹한 뒤 `RecordedApiConnector` 계약 시험에 쓴다(그 전의 시험 자료는 "문서 예시"라고 표시) |
| ② | 공고 3건의 첨부 실제 다운로드 | 로그인·세션 필요 여부, HTTP 상태, 받은 형식. 막히면 본문·API 필드만으로 진행하고 `DOCUMENT_DOWNLOAD_FAILED` 표시([[16-DECISIONS\|16 ADR]] 미결정 16) |
| ③ | 회사 GPU 추론 엔드포인트(`https://acropolissg.com/sol-radar`)의 vLLM(Qwen3.5-9B)·`kev.serve`(Kev-9B@v1.0). 단계 G1~G6와 선행 조건 P2·P3는 [[16-DECISIONS\|ADR-025]] 상세 7번이 정본이다 | G1~G6 결과. `/v1/models` 응답·레지스트리 대조, 지연 p50·p95, guided JSON 결과. GPU 모델·VRAM·실측 추론 메모리는 회사가 주는 값이 있으면 적고 없으면 "회사 운영, 측정 불가"(Kev-9B 문서 값 17 GB와 21.9 GB가 다르다). 미결정 3·17(회사 엔드포인트 경로·인증·응답 미검증) |
| ④ | 실제 RFP 샘플로 파서 후보 비교 시작 | 후보·라이선스·샘플별 누락 관찰(§3.2 측정 항목) |

서비스키 값, 엔드포인트 인증 키(`QWEN_API_KEY`·`KEV_API_KEY`)는 적지 않는다. 준비되기 전에는 "대기(사유)"로 적고, 나머지 개발은 인터페이스(`RecordedApiConnector`·`FixtureAttachmentFetcher`·mock `ModelClient`)로 진행한다.

### 3.4 모델 평가 ([[21-MODEL-TRAINING|21 모델 학습]]에 위임)

모델 평가는 이 문서의 골든·V2 시험과 목적이 다르다. 골든은 통과/실패를 가르는 결정적 회귀이고, 평가는 실제 공고에서 모델이 얼마나 맞히는지를 재는 측정이다. 지표 정의·비교 대상·오류 분석 절차·수용 기준의 정본은 [[21-MODEL-TRAINING|21]] §4·§7이고 여기에는 요약만 둔다.

- 평가셋: 실제 공고 × 가상 기업 원형 6개, test 20·dev 10 사업(사업 단위 분할), 사람 검수는 추출 정답 20건과 의미 대응 라벨 150건 이상.
- 비교: E0(규칙만)·E1(Kev-9B@v1.0, 영어 state)·E2(같은 모델, 한국어 state)·**E3(Qwen 분류 대조군)** 모두 필수. 해커톤에서는 축소 규모(fixture 20건 + 실공고 5건, ADR-023 X1)로 돌리고 전체 평가셋(test 20·dev 10 사업)은 X6(ADR-027)에서 만들어 E1·E4 비교에 쓴다. 설계는 [E3 실험 설계](plans/2026-10-19-e3-experiment-design.md). 표본이 작아 신뢰구간이 넓다는 것을 리포트에 적는다.
- 지표 영역: 추출, 분류, 보정, 일관성, 한국어/영어 차이, 성능. 표본이 작아 모든 지표에 부트스트랩 95% 신뢰구간과 표본 수를 함께 적는다.
- 초기 목표(Macro-F1 0.80, 정보부족→미충족 혼동률 5%, 보정 후 ECE 0.08)에 못 미쳐도 자동으로 파인튜닝하지 않는다. 오류 분석으로 원인 단계를 가른 뒤 사람이 정한다. 해커톤 X6의 Kev-9B LoRA는 사용자 결정으로 하는 E4 비교 실험이고(ADR-027), 운영 반영은 이 절차를 그대로 따른다.
- 실행 위치는 노트북이고 회사 GPU 추론 엔드포인트(Kev는 `KEV_BASE_URL` 직접 또는 평가용 gateway, [[16-DECISIONS|ADR-025]])에 붙인다. 명령은 `uv run python -m sol_eval …`. `pnpm verify`·CI에는 넣지 않는다. 숫자 요약만 `docs/evidence/eval/`에 두고 실제 RFP 원문은 넣지 않는다.

## 4. 수용 기준 (Phase별)

| Phase | 통과 조건 | 증거 |
|---|---|---|
| 0 | `docker compose -f infra/compose.yaml ps`에서 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(web을 Compose로 띄우면 `web` 포함) 전부 healthy(`postgres`·`api` 서비스는 없다). web의 `/health/live`·`/health/ready` 200, `checks.db` = Supabase 클라우드 프로젝트 연결 ok. worker가 `web/server` 도메인 코드를 불러 기동(`server-only` 실행 방식 `--conditions=react-server`, [[16-DECISIONS\|16 ADR]] 미결정 9 검증됨). `pnpm verify` 통과. `pnpm check:env` 실행 모드 모순 거부(V2-01), 서비스키 4개(`G2B_*_SERVICE_KEY`) placeholder 자리(서버 전용), 회사 GPU 추론 엔드포인트에 HTTPS로 붙는 `ai-local` 연결 방식([[16-DECISIONS\|ADR-025]]) 정리. P0-0 외부 의존성 점검 결과를 항목별로 기록(막힌 항목은 막힘으로, §3.3) | `phase-0/compose-ps.txt`, `phase-0/health-ready.json`, `phase-0/test-report.txt`, `phase-0/run-mode-check.txt`, `phase-0/worker-stop.txt`(`docker compose stop worker` ExitCode 0), `phase-0/health-ready-degraded.json`(gateway 정지 시 `status: degraded`·`checks.ai: unavailable`), `phase-0/external-deps.md`(P0-0 ①② 통과, ③④ 대기) |
| 1 | `pnpm test:db` 통과(SOL RADAR 표의 RLS·`sol_role` CHECK·조직 격리 정책 시험, 마이그레이션 재실행). ADR-020 저장 변경(새 표 `requirement_assessments`·`bid_structured_requirements`·`eval_runs` 포함)이 첫 SOL 마이그레이션에 들어가고 새 표마다 정책 시험이 있다. 클라우드 적용 `pnpm db:push`는 사용자 확인 뒤. seed(`pnpm demo:reset`) 2회 실행 멱등. G5 통과 | `phase-1/test-db.txt`, `phase-1/migrate.log`(`pnpm db:push` 출력), `phase-1/test-isolation.txt` |
| 2 | G1·G2·G7·G10 + §3.1 ingestion 케이스 통과, `SEED` summary `{created:19, quarantined:1, retried:2}`. V2-03(공고·첨부 쪽)·V2-10·V2-11·V2-12, `OfficialApiConnector` 계약 시험, 사전규격·발주계획 단계 연결(P0-8). 서비스키·첨부 다운로드가 되면 live 수집 `ingest_runs` 요약(P0-2)과 실공고 형식별 파싱 성공률(P0-3) | `phase-2/test-ingestion.txt`, `phase-2/test-contracts.txt`, `phase-2/seed-summary.json`, `phase-2/ingest-run-live-<일시>.json`, `phase-2/parse-success-rate.md` |
| 3 | E2E 로그인 → 목록 → 상세, axe 위반 0, G8. V2-02 화면 부분(실행 모드·출처·가상 회사 프로필 배지, `origin` 필터). NAV-01~NAV-09(§9, [[16-DECISIONS\|ADR-021]]) | `phase-3/e2e/*.png`, `phase-3/axe-report.json` |
| 4 | G3·G4 + worked example 3건 수치 일치, missing 정책 9행, 재현성 테스트 통과(골든은 `mock` 모드). V2-05, V2-06 점수 부분 | `phase-4/goldens-report.txt`, `phase-4/coverage-summary.txt` |
| 5 | G6·G9, V2-04·V2-06~V2-09·V2-13, `SOL_RUN_MODE=mock` 전체 흐름(mock adapter 먼저). 실추론: Qwen `/extract` local의 인용 검증 통과율과 실공고 1건 E2E 로그(P0-4), Kev-9B@v1.0 `kev-qs/v0.2` 응답 원문·`stateTrace` 저장(P0-6). 실추론 증거가 없는 항목은 미검증으로 표시 | `phase-5/ai-fallback.txt`, `phase-5/test-ai.txt`, `phase-5/` 실추론 로그 |
| 6 | 결정 기록 → 감사로그, 알림 1건 규칙, E2E 전체 | `phase-6/e2e/*.png`, `phase-6/test-notifications.txt` |
| 7 | §5 데모 체크리스트 전 항목, 비밀값 로그 유출 0(`SUPABASE_SERVICE_ROLE_KEY`·서비스키 4개 `G2B_*_SERVICE_KEY` 포함), `pnpm verify`·`pnpm test:db`·E2E·pytest·smoke 전부 PASS. 세 모드(`live`·`fixture`·`mock`) 기동 리허설, 엔드포인트 미접속 → `PARTIAL`·`RULES_ONLY` → 재접속 확인(`GET /v1/models`) 리허설 | `demo-day/<일시>/checklist.md`, `demo-day/<일시>/run-modes.md` |
| 평가 트랙 | P0-9~P0-11. 평가셋 라벨은 10-19부터, 학습셋 번들은 Phase 5 `local`이 동작한 뒤. P0-9·P0-11과 Kev-9B LoRA 학습(F1·F2·F3, 회사 측 실행)은 X6([[16-DECISIONS\|ADR-027]]). 기준은 [[21-MODEL-TRAINING\|21 모델 학습]] §7(평가셋 v0.1 manifest·라벨 검증, E0·E1·E2 리포트와 오류 분석, 학습셋 번들 sha256, 메모리 검증 스크립트·절차) | `eval/`, `kev-train-feasibility.md`(회사 측 실행 뒤) |

**ADR-023 핵심 컷과의 대응**(2026-10-19): 핵심 컷의 통과 조건은 Phase 0(C0·C1), Phase 1(C2), Phase 2 중 fixture 수집·revision·격리와 live 1건 수집·파싱(C3), Phase 3 중 `/dashboard`·`/bids`·`/bids/[id]`·`/notifications` E2E·G8·V2-02(C6), Phase 4 전부(C4), Phase 5 중 G6·G9·V2-04·V2-07·V2-08·V2-13과 실추론 1건 증거(C5·C8), Phase 6(C7), Phase 7 중 §5 체크리스트·세 모드·대체 경로 리허설(C9), 평가 트랙 중 E0·E1·E2·E3 축소 규모 리포트(X1)다. NAV-01~NAV-09, S5(G2 변경 감지 화면), P0-8은 확장 컷이다. 전체 평가셋·P0-11·E4는 X6(ADR-027)이고 핵심 컷 통과 조건에 들어가지 않는다([[12-ROADMAP\|12 로드맵]]).

## 5. 데모 당일 수용 체크리스트

데모 시작 전 한 번, 리허설 때 한 번 통과시킨다. 결과는 `docs/evidence/demo-day/YYYYMMDD-HHMM/checklist.md`에 ✅/❌와 스크린샷 이름으로 기록한다. 장면 번호는 [[19-DEMO-SCENARIO|19 데모 시나리오]]와 같다: `S0` 사전 준비(§3), `S1` 문제 슬라이드(조작 없음, 체크리스트 대상 아님), `S2`~`S7` 클릭 경로(§4). 데모 계정은 `admin@soltech.invalid`, `sales@soltech.invalid`, `analyst@soltech.invalid`, `viewer@soltech.invalid`(`org-01`), `viewer@other.invalid`(`org-02`). 비밀번호는 루트 `.env.local`의 `DEMO_SEED_PASSWORD`(`pnpm demo:reset`이 읽는다, [[10-DEPLOYMENT|10 배포]])에만 두고 문서·저장소에 실제 값을 쓰지 않는다.

시연 기본 모드는 `mock`이다. 아래 기대 수치(94·72·68, Kev 71/24/5·36/52/12 등)는 `mock` 모드 기준이다([[19-DEMO-SCENARIO|19 데모 시나리오]] §2.1). `live`·`fixture` 모드는 S0에서 기동만 확인하고(4번), 시연 중 장애 대체 순서는 `live` → `fixture` → `mock`이다. 모드 전환은 env를 바꾸고 worker·ai-gateway를 재시작해서 한다. 자동 대체는 하지 않는다.

| # | 장면 | 단계 | 행동 | 기대 화면·응답 | 실패 시 대체 |
|---|---|---|---|---|---|
| 0 | S0 | 환경 | env에 `SOL_RUN_MODE=mock`(이 값이 `DEMO_MODE=true`·`AI_PROVIDER=mock`의 기본값을 정한다), `AI_FALLBACK_TO_MOCK=false`, 기본 비밀값 아님 확인. `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`가 채워져 있고 모드 모순이 없는지 `pnpm check:env`로 확인(값은 출력하지 않는다). 인터넷 연결(Supabase 클라우드 프로젝트 접속). 포트 3000 비어 있음 | — | 포트 충돌 프로세스 종료. 네트워크 불가면 2번의 대체로 |
| 1 | S0 | 엔드포인트 | 회사 GPU 추론 엔드포인트(`QWEN_BASE_URL`·`KEV_BASE_URL`, HTTPS + API 키, [[16-DECISIONS\|ADR-025]]) 접속을 확인한다(방식은 [[10-DEPLOYMENT\|10 배포]]) | 노트북에서 `GET /v1/models`로 vLLM·`kev.serve` 응답과 레지스트리 대조 | 엔드포인트 미접속이면 `live`·`fixture`를 빼고 `mock`만으로 진행하고 사실대로 말한다 |
| 2 | S0 | 기동 | `docker compose -f infra/compose.yaml up -d --build` 후 `docker compose -f infra/compose.yaml ps` | `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(web을 Compose로 띄우면 `web` 포함) 전부 `healthy`. web `GET /health/ready` 200, `checks.db: ok`(Supabase 연결), `checks.ai: mock` | 1회 재기동. `checks.db` 불가(503)면 네트워크·Supabase 프로젝트 상태 확인. 그래도 실패면 [[19-DEMO-SCENARIO\|19 데모 시나리오]] §5 대체 경로 ①(로컬 Supabase CLI), 그것도 안 되면 사전 녹화 영상 |
| 3 | S0 | seed | `pnpm demo:reset` (스크립트. service role로 Supabase 프로젝트에 seed, 멱등, [[10-DEPLOYMENT\|10 배포]]) | 로그 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`. `ingest_runs.summary` `{created:19, quarantined:1, retried:2}`. `GET /api/v1/bids` 총 19건. `bid_reviews` 2건(`FX-01` BID, `FX-03` NO-BID). 조직·인력 편집(ADR-021 P1)이 생긴 뒤에는 점수 계산 대상 27명이 모두 재직(`ACTIVE`)인지 확인 | seed 재실행(멱등) |
| 4 | S0 | 세 모드 | `SOL_RUN_MODE`를 `live` → `fixture` → `mock` 순으로 바꾸며 worker·ai-gateway 재시작. `live`에만 서비스키 4개(`G2B_*_SERVICE_KEY`)가 필요하다([[16-DECISIONS\|ADR-024]] D5). 모드마다 `GET /api/v1/admin/ai/status`(ADMIN)와 머리말 확인. 마지막은 `mock` | 각 모드에서 기동 거부 없음, 머리말 "실행 모드: live\|fixture\|mock", `runMode` 일치. `live`·`fixture`는 `qwen.healthy: true`, `kev.registryMatch: true`. `live`에서 `/admin/sources`의 오늘 호출량(`quotaUsedToday`/`quotaLimit`, 개발계정 서비스당 1,000건/일)이 리허설·시연 예상 호출 수보다 넉넉하다. 결과를 `run-modes.md`에 기록 | 기동 거부면 거부 메시지의 모순 키를 고친다. 실패한 모드는 시연에서 빼고 기록한다. 한도 부족이면 `live` 장면을 빼거나 `fixture`로. live 공고가 DB에 남아 6·7번 수치가 달라지면 기록한다([[19-DEMO-SCENARIO\|19]] §2.1 결정 필요) |
| 4a | S0 | 사전 분석 | 세 모드 확인이 `mock`으로 끝난 뒤 `pnpm demo:preanalyze`(`mock`·gateway 필수, 실행은 사용자 확인 뒤, [[19-DEMO-SCENARIO\|19]] §3 5번). 이 뒤로 `pnpm demo:reset`을 돌렸으면 다시 한다([[16-DECISIONS\|ADR-031]] C12(f)) | 대상 18건(`FX-02`·격리 `FX-12` 제외) 모두 `COMPLETED`. 기대 플래그: `MODEL_RULE_DISAGREEMENT`는 `FX-03`에만, `KEV_NEEDS_REVIEW`는 `FX-04`·`05`·`11`·`13`·`17`·`19`·`20`(mock Kev needsHumanReview 0.70 ≥ 임계 0.7, ADR-031 C11). 11번의 `FX-02` `KEV_NEEDS_REVIEW`(0.74)는 S4 라이브 분석 결과다 | 실패한 건은 기록하고 S2 기대값(6번) 차이를 함께 적는다 |
| 5 | S0 | 로그인 | `sales@soltech.invalid`로 `/auth/login`(Supabase Auth) | `/dashboard` 이동. Topbar에 "실행 모드: mock"·`DEMO` 배지·`AI: mock`·수집 시각·🔔 | `admin@soltech.invalid`로 대체 |
| 6 | S2 | 대시보드 | — | BID 권고 3건(`FX-01` 94, `FX-18` 82, `FX-06` 78), 마감 임박 카드에 `FX-14`(D-2), 수집 카드에 "격리 1건"(`FX-12`), 최근 변경 목록 | 숫자 불일치는 기록만 하고 진행 |
| 7 | S2 | 목록 | `/bids`, 권고 `BID` 필터, 점수 내림차순([[16-DECISIONS\|ADR-031]] C3. 단계 NOTICE 필터는 사전규격 `FX-18`을 뺀다) | `FX-01` 최상단 94, `FX-12` 미노출, 모든 행 `DEMO` 칩, 1280px에서 가로 스크롤 없음 | — |
| 8 | S3 | 상세 BID | `FX-01` 열기 | 자격 3건 `충족`, 점수 94, 분해 5행(24.0/25.0/20.0/15.0/10.0), Kev 71/24/5 + 09 고지 문구, 분석 패널 "AI: mock"·"가상 회사 프로필로 분석" 배지, 근거 3건 → 드로어에 원문 하이라이트, 결정 패널 "마지막 결정: BID"(seed 리뷰) | 드로어 실패 시 원문 링크 새 탭 |
| 9 | S3 | 규칙 우선 | 권고 필터를 풀고 결정 `NO-BID` 필터 → `FX-03` 열기 | 권고 `NO-BID`, 자격 1건 `미충족` + 근거 문장, 점수 68 "참고" 표시, Kev 섹션 `규칙 우선` 배지와 "Kev는 BID를 제시했지만…" 문구, "마지막 결정: NO-BID"(seed 리뷰) | — |
| 10 | S4 | 라이브 분석 | `FX-02` → [분석 재실행] | 202 → `대기 중` → `분석 중` → `완료` 10초 이내. 점수 72, WATCH, 분해 15.0/18.3/14.0/15.0/10.0, Kev 36/52/12 | 60초 초과 시 새로고침, 사유 기록 |
| 11 | S4 | 사람 결정 | `FX-02` 결정 패널에서 WATCH 유지 또는 BID 선택 + 사유 + 담당자에 발표자 자신(`sales@soltech.invalid`) 지정 → [결정 기록] | "마지막 결정: … · 담당자 · 시각", 결정 패널 상단 "사람 검토 권장"(`KEV_NEEDS_REVIEW`). `bid_reviews` +1(총 3건), 감사로그 1건. Topbar 알림 벨에 `REVIEW_ASSIGNED`가 들어 있다. 분석 요청자에게 가는 `ANALYSIS_COMPLETE`도 올 수 있어 벨은 1~2건이다([[16-DECISIONS\|ADR-029]] A6 D5). `analyst@soltech.invalid`로 보면 패널 읽기 전용 | — |
| 11a | S-LIVE | 실제 공고 | `/bids?origin=all` → S0 4번에서 기록한 실제 공고 1건 열기 | `DEMO` 배지 없음, 출처 `g2b-bid-notice`, 원문 링크 실제 URL. 분석 요약 띠 "분석 실행 모드: live"·"AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0"(받은 모델 식별자, ADR-029 A6 D12)·"가상 회사 프로필로 분석". Topbar는 `실행 모드: mock` 그대로다. 자격 3값 + 사유 코드, 점수 분해 5행, Kev `UNCALIBRATED` + 고지 문구, 근거 서랍 실제 첨부 인용. 외부 의존성 컷 규칙 갈래가 `run-modes.md`와 같다 | 녹화 영상으로 대체하고 "녹화"라고 말한다. 녹화도 없으면 장면 제외 |
| 12 | S5 (확장 컷) | 변경 수집 | `/admin/ingestion`(`admin@soltech.invalid`) → 수동 수집 `LIVE`(API `batch:"live"`). fixture의 live 배치이며 실행 모드 `live`와 다르다(`SOL_RUN_MODE=live`에서는 `409 RUN_MODE_MISMATCH`). 이어서 `FX-07` 상세에서 [재분석]을 누른다(수집은 분석을 자동으로 넣지 않는다, ADR-030 B18, [[16-DECISIONS\|ADR-031]] C15). S5가 구현되지 않았으면 이 행은 "미구현"으로 적고 건너뛴다 | 🔔 증가. `FX-07` revision 2 → 재분석 68 → 77(엔진 77.3, ADR-031 C9), 권고 WATCH → BID. `FX-06` diff 마감 +14 → +28, 알림 1건. `FX-09` 재전송으로 알림 추가 0. `FX-08` `취소됨`(목록에서는 상태 필터 "취소 포함"을 골라야 보이고, 상세는 언제나 열린다, [[16-DECISIONS\|ADR-029]] A7). summary `{changed:3, cancelled:1, skippedDuplicate:1}` | 수집 실패 시 이력 표 오류를 보여 주고 다음 장면 |
| 13 | S6 | 장애 대체 | `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` [분석 재실행] `force=true` | 1~2초 안에 `부분 완료 (규칙만)`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)", `recommendationBasis: RULES_ONLY`, Topbar `AI: unavailable`, `/health/ready` `status: degraded`. 점수 94·자격 3건 그대로 | 사전 녹화 영상 |
| 14 | S6 | 복구 | `docker compose -f infra/compose.yaml start ai-gateway` → `ps`에서 ai-gateway `healthy` → `FX-01` 재실행 | `완료`로 복귀, Topbar `AI: mock`, Kev 분포 다시 표시 | — |
| 15 | S6 (리허설) | 엔드포인트 재접속 확인 | 리허설에서만. `fixture` 모드로 전환 → 회사 GPU 추론 엔드포인트를 노트북 쪽에서 차단한다(방식은 [[10-DEPLOYMENT\|10 배포]] 장애 주입 절) → `FX-01` [분석 재실행] `force=true` → 차단 해제 → 재접속 확인(`GET /v1/models`) → 재분석 → `mock`으로 되돌리고 `pnpm demo:reset`으로 초기화(fixture 모드 분석 run이 S3 화면에 남지 않게) → `pnpm demo:preanalyze`로 사전 분석을 다시 만든다(reset이 지운다, 4a) | 끊긴 동안: `PARTIAL`·`RULES_ONLY`, `reviewFlags`에 `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`(gateway는 살아 있으므로 `AI_UNAVAILABLE`이 아니다), [[09-SECURITY\|09 보안]] PARTIAL 배너, mock 결과 0건, 점수·자격은 직전 run과 같다. 재접속 뒤: `qwen.healthy: true`·`kev.registryMatch: true`, 재분석 `완료`. 재접속 확인 소요 시간을 `rehearsal-log.md`에 기록 | 재접속이 안 되면 시연은 `mock`만으로 하고 사실대로 말한다 |
| 16 | S7 | 격리 | `viewer@other.invalid`(`org-02`)로 로그인해 받은 Supabase access token을 `Authorization: Bearer`로 붙여 `GET /api/v1/bids/{FX-01}/qualification-checks`, `GET /api/v1/analyses/{org-01 분석 id}` | 둘 다 404([[09-SECURITY\|09 보안]] IDOR 정책, RLS로 행이 안 보여 404). 화면에서는 `FX-01` 공고 본문은 보이되 점수·자격·검토 없음 | API 응답 JSON으로 대체 시연 |
| 17 | S7 | 관리자 | `/admin/ingestion` | `SEED` run에 격리 1건(`FX-12`, 사유 `title` 누락), `FX-20` 재시도 로그 2회 + `Retry-After` 대기 | — |
| 18 | 마감 | 증거 | 각 단계 스크린샷 저장 | `demo-day/<일시>/screenshots/` 15장 이상 | — |

체크리스트에서 ❌가 하나라도 있으면 그 항목은 데모에서 "미구현"으로 말한다. 통과한 척하지 않는다.

## 6. 심사용 증거 산출물 (`docs/evidence/`)

```text
docs/evidence/
  README.md                         # 주장 → 증거 파일 색인 (심사위원용, 아래 표)
  phase-0/  compose-ps.txt  health-ready.json  test-report.txt
            run-mode-check.txt             # V2-01 모드 모순 기동 거부 시험 출력
            worker-stop.txt  health-ready-degraded.json   # worker 정상 종료 exit 0, AI 장애 리허설
            external-deps.md               # P0-0 외부 의존성 점검 (§3.3, ①② 통과·③④ 대기)
  phase-1/  test-db.txt  migrate.log  test-isolation.txt  seed-summary.json
  phase-2/  test-ingestion.txt  ingest-run-FX-20.json
            ingest-run-live-<일시>.json    # P0-2 live 수집 요약 (담당자 개인정보 제외)
            parse-success-rate.md          # P0-3 실공고 30건 형식별 파싱 성공률·파서 후보 비교
  phase-3/  e2e/*.png  axe-report.json   # people·settings·admin-ingestion·ops(forbidden) 포함(ADR-021)
  phase-4/  goldens-report.txt  coverage-summary.txt
  phase-5/  test-ai.txt  ai-fallback.txt  e2e/partial.png
            (실추론 로그)                  # P0-4 인용 검증 통과율·실공고 1건 E2E, P0-6 Kev 응답·stateTrace 표본
  phase-6/  test-notifications.txt  e2e/*.png
  eval/                                    # E0·E1·E2 리포트 숫자 요약·오류 분석 요약 (21 §4, RFP 원문 금지)
  kev-train-feasibility.md                 # LoRA 메모리 검증 결과 (22 §4.2, 회사 측 실행 뒤)
  demo-day/ rehearsal-log.md               # 17: 매일 리허설 날짜·소요 시간·실패 단계·엔드포인트 재접속 확인 소요 시간
  demo-day/ YYYYMMDD-HHMM/  checklist.md  run-modes.md  screenshots/*.png  isolation-404.json  compose-ps.txt
```

규칙:

- 테스트 출력은 명령 전체 stdout을 그대로 저장한다(요약 금지). 첫 줄에 실행 명령과 커밋 해시 또는 날짜.
- 스크린샷 파일명은 [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]]과 동일: `YYYYMMDD-phaseN-<route>-<state>-<width>.png`. `state`는 `loaded | empty | loading | error | forbidden | partial | demo-badge`([[06-UI-UX\|06 UI]] §12), `width`는 1440·1280. 데모 당일 촬영은 `phaseN` 자리에 `demo`를 쓴다. 예: `20261020-phase3-bid-detail-partial-1440.png`, `20261020-demo-bid-detail-partial-1440.png`.
- 커버리지는 요약만(`coverage-summary.txt`). 전체 HTML은 저장하지 않는다.
- 실패한 실행도 저장한다. 파일명 끝에 `-FAIL`. 다음 실행에서 통과하면 둘 다 남긴다.
- 비밀값·토큰·원문 전체가 들어간 로그는 저장 전에 마스킹한다([[09-SECURITY|09 보안]]).
- 실제 공공 API 응답을 남길 때는 담당자 이름·전화·이메일을 빼거나 마스킹한다. 서비스키(`G2B_*_SERVICE_KEY` 4개 중 어느 것이든)가 들어간 요청 URL은 남기지 않는다.
- 실제 RFP 원문(첨부 텍스트)은 증거 폴더에 넣지 않는다. 숫자·건수·형식만 적는다(첨부 저작권 미확인, [[16-DECISIONS|16 ADR]] 미결정 18).

심사위원용 색인(`docs/evidence/README.md`)의 표 형식:

| 주장 | 어디서 확인 | 증거 파일 |
|---|---|---|
| 같은 입력이면 같은 점수 | [[08-SCORING\|08 SOL Score]] §6 | `phase-4/goldens-report.txt` |
| 규칙이 Kev를 뒤집지 못한다 | G3 | `phase-4/goldens-report.txt`, `demo-day/*/screenshots/*-demo-bid-detail-loaded-1440.png`(FX-03) |
| AI 없이도 완결된다 | G6 | `phase-5/ai-fallback.txt`, `*-demo-bid-detail-partial-1440.png` |
| 조직 간 데이터 격리 | G5 | `phase-1/test-db.txt`(RLS 정책 시험), `demo-day/*/isolation-404.json` |
| 중복 수집·중복 알림 없음 | G1, G2 | `phase-2/test-ingestion.txt`, `phase-6/test-notifications.txt` |
| 가상 데이터를 가상이라고 표시 | G8 | `phase-3/e2e/demo-badge.png` |
| 자동 시험은 실제 외부 API·모델을 호출하지 않는다 | §2, 07 §2 | `phase-2/test-ingestion.txt`의 네트워크 호출 0 assert |
| 실제 나라장터 공고를 수집해 분석한다(`live`) | P0-0·P0-2, §3.3 | `phase-0/external-deps.md`, `phase-2/ingest-run-live-*.json` |
| 처리할 수 없는 첨부는 확인 필요로 표시한다 | V2-03·V2-10, P0-3 | `phase-2/parse-success-rate.md`, `phase-2/test-ingestion.txt` |
| 정보 부족을 미충족으로 판정하지 않는다 | V2-05 | `phase-4/goldens-report.txt` |
| Kev는 점수·자격·권고를 바꾸지 못한다 | G3, V2-06 | `phase-4/goldens-report.txt` |
| mock 결과를 실제 모델 결과처럼 보이지 않는다 | V2-02, V2-09 | `phase-5/ai-fallback.txt`, `phase-3/e2e/*.png` |
| 모델 성능을 숫자로 잰다(한국어/영어 비교 포함) | §3.4, [[21-MODEL-TRAINING\|21 모델 학습]] §4 | `eval/` |
| 보유 GPU에서 LoRA 학습이 가능한지 잰다 | [[22-FINETUNE-RUNBOOK\|22 파인튜닝 실행서]] §4.2 | `kev-train-feasibility.md`(회사 측 실행 뒤) |

## 7. MVP 완료 조건

`pnpm verify`(서식·타입·린트·단위)·`pnpm test:db`·E2E·pytest·smoke 모두 PASS. fixture 기반 시연 플로우(§5) 100% 통과. API 비밀 로그 유출 없음. 수집 중복 없음. 모든 스코어에 근거·`algorithm_version`·프로필 revision 존재. 사람 최종 결정이 `bid_reviews`와 감사로그에 기록. 성능 목표는 실측치를 기록하고 비현실적인 수치를 성공으로 주장하지 않는다.

ADR-020 이후 해커톤 MVP는 실제 나라장터 수집과 회사 GPU 추론 엔드포인트의 실추론(Qwen3.5-9B·Kev-9B@v1.0, [[16-DECISIONS|ADR-025]])까지 포함한다. 데모 필수 P0-0~P0-11의 완료 기준은 [[12-ROADMAP|12 로드맵]] 해커톤 컷, 평가 트랙의 기준은 [[21-MODEL-TRAINING|21 모델 학습]] §7이다. 세 실행 모드 기동 리허설을 통과해야 한다. 실모델 경로는 증거(로그·리포트)가 있는 항목만 검증됨으로 적고, 없는 항목은 **미검증**으로 표시한다. hosted 경로는 사용자 승인 전에는 쓰지 않으므로 해커톤 범위에서 미검증이다. Kev-9B LoRA는 X6(ADR-027)이다. 우리 쪽 산출물(평가셋·학습셋 번들·학습 요청서·E4 하네스)은 완료 조건이다. 회사 측 학습 결과는 받으면 E4로 보고하고, 받지 못하면 미실행으로 적는다.

## 8. 솔리데오 인력·가입 수용 기준 (ADR-019)

기존 골든 G1~G10과 구분해 PPL 번호를 사용한다. 명부·카탈로그, DB/RLS·가입/보완 가드와 순수 인력 계산 회귀는 구현되었다. 기존 계획의 독립 코드 QA는 verify·E2E(공개·브라우저·인증)와 실제 로컬 seed·1440·1280 검사를 통과했다(실행 수는 아래 통합 검증 기록). 이후 ADR-021의 가입·인력 저장 정합화도 별도 환경에서 검증했다(아래 §9.1). 사진은 2026-10-17 사람 APPROVED200/READY200·원본 대조 release·실제 Next 접근 검증을 통과했다. 전체 점수 파이프라인과 전체 ADR-021 후속 범위는 남아 있으며 아래 기준 전체를 통과했다는 뜻이 아니다. [통합 검증 기록](evidence/people/20261016-people-integration.md)에 실행과 미실행을 구분한다.

| ID | 자동 검증할 조건 | 위치 / 명령 |
|---|---|---|
| PPL-01 | 명부 200명·고유 ID/이름 200·남녀 100/100·한글 세 글자·원본 정규화 이름과 교집합 0. 입력 원본이 없으면 실패. 부서 계층 검증([[16-DECISIONS\|ADR-021]]): 순환·없는 `parentId`·자기 참조·깊이 3 초과·팀이 아닌 직원 소속은 실패, 본부·그룹 `targetCount` 없음은 통과. 팀별 목표·실제·차이 보고(정본 JSON에서는 차이 0) | `scripts/demo-people.test.mjs`, `node --test scripts/demo-people.test.mjs`. 실제 원본 검사는 아래 로컬 절차 |
| PPL-02 | 같은 팀명 합산·표시명 보존·모든 팀 1명 이상·목표 합 200·최대 나머지 배분·동률 ID 순·직급/부서 참조 유효·재실행 결정론 | 같은 fixture 시험. 원본 팀/직급 대조는 아래 로컬 절차 |
| PPL-03 | portrait manifest READY 200·고유 경로/해시 200·PNG 파일 존재·정사각형·남녀 100/100·인물당 한 장 | 같은 fixture 시험 + 정장·서로 다른 얼굴·품질 사람 검수표 |
| PPL-04 | 인력 200명 seed 2회 멱등·기존 템플릿5계정 ID 유지·명부 seed의 추가 Auth 생성0·카탈로그/인력 RLS 격리·다른 회사 코드 거부·가입 신고 정보로 권한 상승 불가 | `scripts/database.test.mjs`, `pnpm test:db` |
| PPL-05 | 이메일 가입의 부서·직급 필수·위조 코드 거부·본인 정보만 저장·재로그인 후 유지·기존 이름/약관 검증 유지 | `web/app/auth/sign-up/sign-up-schema.test.ts`, profile 도메인·신고 정보 Route Handler 계약 시험 |
| PPL-06 | 간편 가입·기존 미완료 사용자의 필수 정보 보완·업무 화면/API 우회 차단·로그아웃/보완 접근·저장 실패 재시도·가입이 자동 조직 합류를 만들지 않음 | `web/e2e-auth/signup-employment.spec.ts`·`signup-employment.write.spec.ts` 및 Route Handler 시험. UI는 1440·1280·키보드 확인 |
| PPL-07 | 완료: 명부200/계산27 분리·고정 창20FTE·기간 경계/동시 배정·계산 용량과 §6 별도 요소값의 순수94/72/68 회귀. 후속 수용 기준: `team_member_scoring` 분리 뒤 전체 골든94/72/68 및 운영 편집 뒤 기존 `score_runs` 불변(ADR-021·Phase4 미검증) | `web/server/scoring/*.test.ts`, `pnpm -C web exec vitest run server/scoring` |

CI에는 원본 엑셀·실명 제외 집합을 넣지 않는다. 루트 `pnpm test`는 `scripts/**/*.test.mjs` 전체를 자동 실행하며 합성 입력으로 추출/제외 알고리즘과 저장 fixture 검증을 검사한다. 데이터 검증 진입점은 다음 세 가지다.

| 명령 | 검사 범위 / 원본 대조 표시 |
|---|---|
| `pnpm people:check:fixtures` | 저장된 카탈로그·공개 투영·명부·manifest 구조, 승인 배분·참조·남녀 100/100·27명 역할·기존 가상 100% 배정 7건·20 FTE 기간 검사. PLANNED 허용, 원본과 이미지 파일은 요구하지 않으며 `sourceComparison: "not-run"` |
| `pnpm people:check -- --input /절대경로/people.xlsx` | fixture 검사 + 원본 해시·250행(팀 가중치 175 + 제외 75)·미분류/범위·정확한 팀명/직급 가중치·ID/명부 재현·정규화 원본 이름 일치 0. 성공 시 `sourceComparison: "passed"`. 원본 누락은 `SOURCE_REQUIRED` 실패 |
| `pnpm people:check:release -- --input /절대경로/people.xlsx` | 원본 필수 대조 + READY 200·고유 경로/해시 200·생성 metadata·PNG 파일/정사각형/실제 SHA-256 검사. PLANNED는 `PORTRAITS_INCOMPLETE` 실패 |

데이터 단계에서는 앞의 두 명령과 `pnpm verify`가 통과해야 한다. release 검사의 READY 요건은 낮추지 않는다. 사진은 2026-10-17 사람 승인으로 READY 200이 됐다(§10). 사진 뒤에는 release 검사와 별도의 정장·서로 다른 얼굴·품질 사람 검수까지 통과해야 PPL-03 완료다. 이미지 해시가 다르다는 사실만으로 서로 다른 얼굴을 보장하지 않는다. PPL-07의 순수 snapshot/FTE 및 별도 worked-example 요소 회귀는 실제 점수 파이프라인의94/72/68 골든 시험을 대신하지 않는다. 기간은 반개구간이며 개인별 최소 잔여 용량을 합산하는 보수적인 보장 FTE다. 시간 평균이나 직원 교대 최적화가 아니다. 전체 pipeline 골든은 Phase4에 남긴다.

원본이 없는 CI 초록불은 로컬 원본 대조 완료가 아니다. 검증 결과는 오류 코드와 안전한 인물 ID만 출력하며 원본 이름·제외 집합·경로·연락처를 출력하지 않는다. 로컬 원본 통과 증거는 [20261016-people-data.json](evidence/people/20261016-people-data.json)에 건수·입력 해시·이름 출처·AI 검토 결과로 남긴다. 사람의 이름/얼굴 검수 승인을 수행한 것처럼 기록하지 않는다. 이미지 생성은 시험·CI에서 호출하지 않는다.

### 배분 가중치 제외 검사

명시된 팀 구역과 사용자 승인 비팀 제외 구역이 원본 인력 행을 중복 없이 모두 분류해야 한다. 제외 구역의 이름도 원본 이름 제외 집합에 포함한다. 팀 범위·제외 범위에 동시에 걸리거나 어디에도 없는 행은 실패한다. 이 분류 검사와 200명 목표 배분 검사를 함께 수행한다.

## 9. 사이드바·업무 확장 수용 기준 (ADR-021, 후속 구현 시험)

아래 시험은 구현 때 추가할 예정이며 현재 시험을 실행/통과했다는 뜻이 아니다. NAV-01~NAV-09는 [[16-DECISIONS|ADR-023]]으로 확장 컷(핵심 컷 green 뒤)이 됐다. 핵심 컷의 Phase 3 수용 기준(§4)에는 들어가지 않고 확장 컷 착수 때 Phase 3 기준에 더한다. 근거는 ADR-021이다.

| ID | 자동 검증할 조건 |
|---|---|
| NAV-01 | 역할 4개(ADMIN·SALES·ANALYST·VIEWER)별 사이드바 노출과 URL 직접 접근 거부(403·404) |
| NAV-02 | `/ops`: 비운영자·조직 ADMIN 모두 404, 운영자 정지 기능 회귀 없음 |
| NAV-03 | 현재 조직: 업무 멤버십 0개 초대 안내 / 1개 진입 / 2개 이상 `403 UNSUPPORTED_ACCOUNT_STATE`. 요청에 실은 조직 ID는 무시·거부. S7 격리 404 유지 |
| NAV-04 | 조직·인력 조회: 200명·27명 수 일치, 3단 트리, 본부·그룹 표시 인원 = 하위 팀 실제 인원 합(중복 없음), 본부·그룹 `targetCount` 없음이 정상, 상위 부서 없음·사진 없음에서 오류 없음, 검색·필터, 다른 조직 0행 |
| NAV-05 | 데이터 수집 관리: ADMIN 외 403(서버 가드 + RLS), 기록이 없는 항목은 빈 상태, 출처·실행 모드 표시 |
| NAV-06 | 대시보드 분석 현황: 공고별 최신 1건 집계, 같은 공고 `force` 재분석 뒤 이중 집계 없음 |
| NAV-07 | 설정 조직 탭: 비ADMIN 403·RLS 거부, 업무 역할 변경 감사 기록 |
| NAV-08 | 템플릿 설정·가입 정보 보완(PPL-05·06) 회귀 없음 |
| NAV-09 | 메뉴 노출과 라우트 접근 분리: 미인증 요청은 출시 여부와 관계없이 기존 인증 정책(화면 로그인 안내, API `401`), 로그인 사용자의 미출시 경로 직접 접근 404, 출시 경로라도 권한 없는 역할 403, 메뉴에 없는 출시 경로도 서버 권한 검사 적용, 메뉴 정의의 출시 표시만으로 메뉴가 바뀜 |

P1([[12-ROADMAP|12 로드맵]] "있으면 좋음" 최상단, 데모 필수가 모두 끝난 뒤):

| ID | 자동 검증할 조건 |
|---|---|
| NAV-P1-01 | 관심 공고: RLS(본인만·다른 조직 0행), 멱등 토글, 관심 인원 수 집계만 공개, 담당자 겸 관심 등록자에게 마감 알림 1건(중복 0) |
| NAV-P1-02 | 입찰 프로젝트: BID 결정 없이 생성 거부, 수명 규칙(결정 변경 시 경고·상태 전진 차단, 자동 종료 없음), 상태 이력·감사 기록, 체크리스트 쓰기는 SALES·ADMIN만(정책 시험), 결과가 점수·Kev에 쓰이지 않음 |
| NAV-P1-03 | 인력 배치 시뮬레이션: 단일 공고 가용 FTE = 그 공고 최신 `score_runs` 스냅샷 값, 기간 충돌 1건 탐지, 후보는 27명 안에서만, 저장 없음 |
| NAV-P1-04 | 조직·인력 편집: ADMIN만(다른 역할 403·RLS 거부), 감사 기록, 편집 뒤 골든 94/72/68 그대로, 기존 `score_runs` 불변 |

### 9.1 ADR-021 가입·인력 저장 정합화 검증 (2026-10-17)

운영200/평가27 분리·본부6/그룹4/팀38 계층·상위 인원 수NULL·신규 가입 개인 조직 생성 중단·실제 멤버십0/1/복수 정책을 독립 검증했다. 공개 부서 선택은TEAM38개, 직급12개로 유지한다. 신규 신고 정보는 권한·조직 합류를 만들지 않는다.

전체 `pnpm verify`(루트347/웹865/새 빌드), 공개130/포함 브라우저99, 정상 Auth95 실행은 `e465438`의 증거다. Auth는93통과·중복 조직명 선택자2실패였고 실제 키보드 초점 결함을 추가 발견했다. 최종 `21c8b97`에서 세 결함 수정·독립 리뷰 후 정상 웹 게이트865, 새 빌드, 관련 브라우저12, 로그인 준비5와 기존 실패Auth2 및1440/1280 실제 초점·계정 화면 검증이 통과했다. 변경 없는 성공 증거를 최종 SHA에서 재실행했다고 표기하지 않는다.

전용 Supabase에서 기존00002의200/27·과거 개인 조직 표본을 변경 없는00003/4로 전환해 ID·평가 튜플·과거 데이터 보존을 확인했다. 실제 신규 Auth는profile1/org0/membership0, 정상seed2회는200/27/기존5계정ID 보존, 원본 필수 검사는passed다. 최종 임시 사용자·조직을 제거하고 전용 스택만 정리했다. 공유 DB 적용·main 병합은 하지 않았다.

[실행·실패·재검증·한계](evidence/people/20261016-adr021-people-integration.md)와 [독립 QA 원본](evidence/people/20261017-adr021-qa-report.md)을 따른다. 실제 REST 중단의 초기 조회 안내는30초 timeout으로 live-PASS가 아니며, RSC 응답을 보류한 동안의 즉시 화면 이동도 미확립이다. 사진은 별도 생성200/READY0로 사람 승인·통합 전이다. N1/N2·/people·/ops·전체 Phase4·실제 외부 OAuth는 이 완료 범위에 포함하지 않는다.

## 10. 승인 사진 통합 검증 (2026-10-17)

사진200장 사람 APPROVED/manifest READY와 기존 personId·SHA-256을 유지해 b3ef `a05217a05f0fb9adb3553c02978f0e2d531e9610`에 통합했다. 같은 고정 HEAD에서 새 `pnpm verify`(루트349·웹879·빌드), 정상 Auth95, 브라우저106, 실제 Next GET·승인 SHA·브라우저 decode200을 통과했다. 원본 필수 release 대조도 Task1에서 passed였다. 상세 명령·한계·원래 실패 기록은 [통합 결과](evidence/people/20261017-portraits-integration.md)와 [독립 QA 원문](evidence/people/20261017-portraits-integration-qa.md)에 있다.

조직 종류/직원TEAM/상위target NULL/팀 합200 제약은 통과했으나 TEAM25·GROUP4의 부모는 미확정으로 보존했다. 완전히 연결된 본부→그룹→팀 조직도는 미검증이다. 조직도·운영 직원 목록·직원 상세 제품 화면과 전체 G1~G10은 미구현/미검증이며, 일반 RLS 통과를 전체 G5로 올리지 않는다. 외부 OAuth 실연결·이번 전체 공개 E2E도 미검증이다. 공유 DB 적용·main 병합·push는 수행하지 않았다.

최종 리뷰 보존 수정 `ca719cf`에서 새 전체 verify(루트350·웹879·빌드)와 실제 비시드 팀 거절/전체 tuple 보존·정상 seed2회를 통과했다. 초기 a052의 Auth95·브라우저106·Next200 증거는 해당 SHA로 보존한다. [최종 QA](evidence/people/20261017-portraits-integration/final-fix/final-fix-qa-report.md).

## 11. 조직·인력 조회와 독립 조직도 검증 (2026-10-19)

`feat/people-read`의 최종 제품 코드 `cd4a91c673fcd411a31e8f86086a5bb429918fde`에서 `/people` 명부와 `/org-chart` 별도 화면, 공통 PersonDrawer·Avatar, 사이드바 하단 링크를 구현했다. `view` 쿼리는 무시한다. 업무 역할 4종, 서버 측 현재 조직 결정, 조회 API와 RLS는 ADR-021을 따른다. 부모 미확정 29개는 정상 데이터로 표시하며 근거 없이 연결하지 않았다.

| 검사 | 실제 결과와 실행 기준 |
|---|---|
| 최종 코드 전체 `pnpm verify` | 새 실행 PASS: 루트 358/358·웹 998/998, 서식·타입·린트·가드·DB 타입·Next 프로덕션 빌드 |
| 최종 코드 컴포넌트 브라우저 | 새 실행 PASS: 18파일·167/167, 조직도 33건 포함 |
| 이전 실패 인력 E2E 4건 | 최종 코드에서 한 번 실행해 4/4 PASS. 직원 200명 상세·1440 조직도·1280 명부·1280 조직도. 기존 제한 시간과 전체 문서 axe 규칙 유지 |
| 조직·인력 고유 시나리오 30건 | 최신 30 PASS = `f579a2a`의 26 PASS + 최종 코드 4 PASS. 최종 코드에서 30건 전체를 새로 실행한 결과는 아님 |
| 기존 인증·가입 E2E 95건 | **최신 91 PASS / 4 FAIL** (`f579a2a`, 복구 실행 포함). 가입·정보 보완·삭제 후 차단의 로그인 이동 단언에서 실패. 전체 회귀 통과로 표시하지 않음 |
| 공개 E2E·실제 사진·권한 | `f579a2a`의 공개 138 PASS, 실제 사진 200 GET/MIME/승인 SHA/decode, 4역할 RLS·다른 조직 0행, 정지 세션 SSR·커서 8건 결과 재사용. 이후 변경은 조직도 컴포넌트와 그 시험 두 파일뿐임을 확인 |
| 1440·1280 화면 | 최종 실제 패널 독립 스크롤·가로 넘침 0·480px 서랍 측정, 화면 8장 보존. 양폭 조직도와 1280 명부/서랍 axe 0은 최종 실행, 1440 명부/서랍은 이전 결과 |
| 데이터 보존 | 직원 200·평가 27·일반 173, 본부 6·그룹 4·팀 38, 목표 합 200. 확정 13팀 81명·상위 미지정 25팀 119명과 빈 그룹 4개. 실제 38팀 선택에서 고유 직원 200명 확인 |

사진·명부·기존 마이그레이션·점수 입력 등 보호 파일 219개의 승인 기준 해시를 보존했다. 새 업무 역할 마이그레이션은 전용 로컬 QA DB에서만 적용했다. 위 결과는 전체 G1~G10·운영 변경 뒤 `score_runs` 불변·외부 OAuth·최신 main 결합 검증을 대체하지 않는다. 기존 PPL-06·07의 전체 수용 조건은 유지한다.

원래 실패 기록, 실행 SHA, 재사용 범위, 접근성·화면 증거 및 남은 Auth 4건은 [최종 구현·검증 보고](evidence/people/20261019-people-read.md)와 그 원본 증거 묶음을 따른다. main 병합·공유 DB 적용·push·배포는 수행하지 않았다.

## 관련 문서

- [[07-DATA-PIPELINE|07 수집]] — fixture `FX-01`~`FX-20` 명세
- [[08-SCORING|08 SOL Score]] — worked example과 missing 정책 (골든 입력)
- [[06-UI-UX|06 UI]] — E2E가 검사하는 화면 상태·문구
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — Phase 보고 형식, 증거 저장
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 데모 당일 서사와 계정
- [[12-ROADMAP|12 로드맵]] — Phase별 해커톤 컷
- [[16-DECISIONS|16 ADR]] — ADR-017(Next.js + Supabase 전환, 시험 도구·위치의 근거), ADR-020(실행 모드·실데이터·평가, §3.2~§3.4의 근거)
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가셋·지표·오류 분석·파인튜닝 착수 판단
- [[03-AI-PIPELINE|03 AI 파이프라인]] — 실행 모드 env, 장애 주입 값, Kev `kev-qs/v0.2`
- [[10-DEPLOYMENT|10 배포]] — 기동 절차, 회사 GPU 추론 엔드포인트 연결
