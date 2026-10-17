---
title: "11. 검증·테스트 전략과 데모 수용 기준"
doc: "11"
status: review
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-10-17
---

# 11. 검증·테스트 전략

> [!tip] 심사 포인트
> "어떻게 검증했나"에 파일 단위로 답한다. 골든 시나리오 `G1`~`G8`과 계약 수용 기준 `G9`·`G10`은 각각 fixture ID·테스트 파일·실행 명령·증거 파일로 묶여 있고(§3), 데모 당일은 §5 체크리스트를 순서대로 통과한 기록이 `docs/evidence/`에 남는다(§6). 통과하지 못한 항목은 통과한 것처럼 적지 않는다. `S1`~`S7`은 [[19-DEMO-SCENARIO|19 데모 시나리오]]의 장면 번호다.

## 1. 자동 테스트 매트릭스

시험 도구와 위치는 출발 템플릿의 관례를 그대로 쓴다([[16-DECISIONS|16 ADR]] ADR-017). 서버 도메인·Route Handler·수집·점수·worker는 모두 `web/` 안의 TypeScript라 Vitest 하나로 돌고, DB 권한은 PGlite 위의 정책 시험이 맡는다.

| 영역 | 도구 | 위치 | 필수 케이스 |
|---|---|---|---|
| Frontend 단위 | Vitest (화면 부품은 브라우저 모드 `*.browser.test.tsx`) | 대상 파일 옆 `*.test.ts(x)` — `web/app/**`, `web/components/**` (템플릿 관례) | 필터 ↔ URL 동기화, 상태 배지 아이콘+텍스트, 오류 화면 `requestId`, 결정 패널 역할별 활성 |
| 서버 도메인·Route Handler 계약 | Vitest | `web/server/<도메인>/*.test.ts`, `web/app/api/v1/**/route.test.ts` | `sol_role`별 허용·거부([[05-API-SPEC\|05 API]] 권한 열), 다른 조직 자원 404, zod 스키마 오류 코드, 쿠키 요청의 CSRF 헤더(`X-Requested-With`)와 Bearer 인증, `Idempotency-Key`, 커서 페이지네이션 |
| DB 정책 | `node --test` + PGlite | `scripts/database.test.mjs` (`pnpm test:db`) | RLS 조직 격리(`org_id in (select public.my_org_ids())`, 남의 조직 행 0건), 공용 공고 표는 `authenticated` 읽기만·쓰기 거부, `memberships.sol_role` CHECK, UNIQUE·CHECK 제약, 마이그레이션 재실행, seed 멱등 |
| E2E | Playwright + axe | `web/e2e/`(로그인 전), `web/e2e-auth/`(로그인 뒤) | 로그인 → 목록 → 상세 → 분석 → 결정, PARTIAL 배너, DEMO 배지, 격리, 변경 알림, a11y 위반 0 |
| Pipeline | Vitest + fixtures | `web/server/ingestion/*.test.ts`, `web/worker/*.test.ts` | 정정/취소/중복/차수/429/누락/금액·타임존 정규화, worker(service role) 쓰기의 `org_id` 직접 지정·테넌트 혼입 0 |
| Scoring | Vitest goldens | `web/server/scoring/*.test.ts` | 0~100, 결정론, 요소별 missing 정책, 자격 override, Kev 승격 금지 |
| AI service | pytest | `services/ai/tests/` | `RequirementExtraction` JSON Schema, 인용 원문 대조, Kev adapter mock, timeout → fallback |
| Infra | Compose smoke (shell) | `infra/smoke.sh` | 최초 부팅, 재부팅 후 volume 유지, `/health/ready`(`checks.db` = Supabase 연결) |

조직 격리(G5)는 세 겹으로 확인한다: DB 정책 시험(PGlite, RLS가 행을 숨기는지) → Route Handler 시험(숨겨진 행을 `404`·빈 목록으로 바꾸는지) → E2E(실제 세션으로 화면·API에 안 보이는지). 앞의 둘은 `pnpm verify`에 들어가고, E2E는 Phase 끝과 데모 전에 돌린다.

## 2. 실행 명령

```bash
pnpm verify                                       # 공통 검사 + web(서식·타입·린트·Vitest·lodestar·토큰·빌드). 정본 verify.config.json
pnpm -C web test                                  # Vitest: 서버 도메인·Route Handler·scoring goldens·ingestion·worker
pnpm test:db                                      # DB 정책: supabase/migrations를 PGlite에 올려 RLS·제약·seed 멱등 (scripts/database.test.mjs)
pnpm -C web test:e2e                              # Playwright 로그인 전(web/e2e) + 부품 브라우저 시험
pnpm -C web test:e2e:auth                         # Playwright 로그인 뒤(web/e2e-auth)
uv run --project services/ai pytest               # AI gateway
bash infra/smoke.sh                               # compose ps + health + 큐 왕복
```

시험 하나만 돌릴 때는 `pnpm -C web exec vitest run <파일 또는 경로 조각> -t "<이름>"`(예: `pnpm -C web exec vitest run server/scoring`). 루트 `pnpm test`는 `scripts/**/*.test.mjs` 전체라 `pnpm verify`의 공통 검사에 DB 정책 시험이 이미 들어 있다.

> [!warning] 미검증 가정
> - 템플릿의 `pnpm -C web test:e2e:auth`는 로컬 Supabase(`pnpm db:start`)와 템플릿 시드 `scripts/db-seed.mjs`(로컬 전용)를 전제로 한다. SOL RADAR 데모 seed(`pnpm demo:reset`)와 Supabase 클라우드 개발 프로젝트에서 로그인 뒤 E2E를 어떻게 돌릴지는 Phase 1에서 정한다.
> - `services/ai` pytest와 `infra/smoke.sh`는 아직 `verify.config.json`에 등록돼 있지 않다. Phase 0에서 등록하거나 CI 단계로 따로 둔다.

CI는 템플릿 방식(`verify.config.json`을 읽는 `pnpm verify`)으로 돌리고, 위 명령 중 어느 하나라도 실패하면 Phase 완료로 보고하지 않는다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]).

## 3. 골든 시나리오 ↔ fixture ↔ 테스트 ↔ 명령

fixture ID는 [[07-DATA-PIPELINE|07 수집]] §6.2. 테스트 파일 경로는 **예정**이며 Phase 1~6에서 만든다. 경로는 저장소 루트 기준이고, Vitest 서버 시험은 템플릿 관례대로 `.test.ts`, Playwright E2E는 `.spec.ts`다. 명령 열의 `vitest <경로>`는 `pnpm -C web exec vitest run <경로>`의 줄임, `e2e:auth`는 `pnpm -C web test:e2e:auth`의 줄임이다. 증거 열은 §6의 저장 위치.

| # | 시나리오 | fixture | 테스트 파일 (예정) | 명령 | 통과 기준 | 증거 |
|---|---|---|---|---|---|---|
| G1 | 같은 공고 2회 수집 → bid 1건, revision 1, 이벤트 0 | `FX-09` (+`FX-10` 차수) | `web/server/ingestion/idempotent-upsert.test.ts` | `pnpm -C web exec vitest run server/ingestion` | `bid_notices` 1행, `bid_revisions` 1행, `notifications` 추가 0 | `phase-2/test-ingestion.txt` |
| G2 | 마감일 변경 → revision diff 저장, 알림 정확히 1건 | `FX-06` (+`FX-07` 예산·요구사항) | `web/server/ingestion/revision-diff.test.ts`, `web/server/notifications/outbox-dedupe.test.ts` | 위와 동일 + `vitest server/notifications` | revision 2, diff에 `deadlineAt` 전/후, `BID_CHANGED` 1건, 재전송해도 1건 | `phase-2/test-ingestion.txt`, `phase-6/test-notifications.txt` |
| G3 | 필수 업종 자격 부족 → NO-BID, Kev BID 무시 | `FX-03` (+`FX-16` 일치 사례) | `web/server/scoring/decision-policy.golden.test.ts`, `web/server/scoring/kev-no-override.test.ts` | `pnpm -C web exec vitest run server/scoring` | 권고 `NO-BID`, `reviewFlags` 포함 `MODEL_RULE_DISAGREEMENT`, 점수 68 참고 표시 | `phase-4/goldens-report.txt` |
| G4 | 근거 문서 없음 → NEEDS_REVIEW/WATCH, 수주확률 문구 없음 | `FX-04` (+`FX-05` 파싱 실패) | `web/server/scoring/needs-review.test.ts`, `services/ai/tests/test_extraction_schema.py`, `web/e2e-auth/no-evidence.spec.ts` | `vitest server/scoring`, `pytest`, `e2e:auth` | 자격 `NEEDS_REVIEW`, 권고 `WATCH`, 응답·화면에 "수주 확률" 문자열이 "아님" 없이 단독 등장 0회 | `phase-4/goldens-report.txt`, `phase-5/test-ai.txt`, `phase-3/e2e/no-evidence.png` |
| G5 | 다른 orgId로 조회 → 404 | `FX-01` + `org-02` VIEWER `viewer@other.invalid` 세션(Bearer 토큰) | `scripts/database.test.mjs`(RLS 정책), `web/app/api/v1/tenant-isolation.test.ts`(Route Handler), `web/e2e-auth/bid-isolation.spec.ts` | `pnpm test:db`, `vitest app/api/v1`, `e2e:auth` | `GET /bids/{FX-01}/qualification-checks` 404, `GET /analyses/{org-01 분석 id}` 404, `GET /bids/{FX-01}/reviews` 빈 목록, `GET /company-profile`은 org-02 revision 1. 응답 본문에 org-01 데이터 0건. DB 정책 시험: org-02 사용자 세션으로 org-01의 `company_profiles`·`score_runs`·`qualification_checks`·`bid_reviews` 0행 | `phase-1/test-isolation.txt`, `demo-day/*/isolation-404.json` |
| G6 | Kev/Qwen 장애 → PARTIAL + 규칙만, 사용자에게 설명 | `FX-01` + 테스트 전용 장애 주입(`AI_FAULT_INJECT` 또는 장애 fixture) | `web/server/analysis/ai-fallback.test.ts`, `services/ai/tests/test_gateway_fallback.py`, `web/e2e-auth/partial-analysis.spec.ts` | `vitest server/analysis`, `pytest`, `e2e:auth` | `status=PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags` 포함 `AI_UNAVAILABLE`, 점수·자격 존재, 배너 문구가 09 고지와 일치 | `phase-5/ai-fallback.txt`, `phase-5/e2e/partial.png` |
| G7 | API 429 → 지수 재시도 후 성공, 체크포인트 복구 | `FX-20` | `web/server/ingestion/rate-limit-retry.test.ts` | `vitest server/ingestion` | 재시도 2회 로그, `Retry-After` 대기 준수, `ingest_runs.cursor` 복구, 적재 1건 | `phase-2/ingest-run-FX-20.json` |
| G8 | 가상 DEMO 데이터는 가상 표시, 실제 모드와 혼동 없음 | 전체 (`FX-01` 대표) | `web/server/bids/demo-flag.test.ts`, `web/e2e-auth/demo-badge.spec.ts` | `vitest server/bids`, `e2e:auth` | 모든 응답 `isDemo=true`, 목록·상세·Topbar에 `DEMO` 배지, `DEMO_MODE=false`에서 fixture 미적재 | `phase-3/e2e/demo-badge.png` |
| G9 | AI 파이프라인 수용 기준 전체 ([[03-AI-PIPELINE\|03 AI 파이프라인]] §9) | `fixtures/extractions/FX-01·02·03·04·05·13`, `fixtures/kev/*` | `services/ai/tests/test_extraction_schema.py`, `test_citation_verify.py`, `test_kev_adapter.py`, `test_gateway_fallback.py` | `pytest` | 03 §9의 각 항목 통과. 인용 검증 실패(`FX-13`) → `CONFLICTED`, 파싱 실패(`FX-05`) → `PENDING_REVIEW`, Kev 질문 4종 스키마 일치 | `phase-5/test-ai.txt` |
| G10 | 데이터 계약 수용 기준 전체 ([[15-DATA-CONTRACTS\|15 데이터 계약]] §9) | `FX-11`, `FX-12`, `FX-13`, `FX-14` | `web/server/ingestion/normalized-bid.contract.test.ts`, `web/server/ingestion/evidence-ref.contract.test.ts` | `vitest contract` | 15 §9의 각 항목 통과. `NormalizedBid` 스키마, `fieldState` 4종, 원본·정규화 값 병기, null 대체 금지 | `phase-2/test-contracts.txt` |

`web/e2e-auth/isolation.spec.ts`는 템플릿이 이미 가진 조직 화면 격리 시험이라 이름이 겹치지 않게 G5 E2E는 `bid-isolation.spec.ts`로 둔다.

장애 주입은 두 가지를 구분한다([[10-DEPLOYMENT|10 배포]] "장애 주입" 절).

| 용도 | 방법 | 비고 |
|---|---|---|
| 자동 테스트(G6) | `AI_PROVIDER=mock` + `AI_FAULT_INJECT=kev_timeout\|qwen_error\|gateway_down`(테스트 전용 env) 또는 mock 어댑터의 장애 fixture | 컨테이너 없이 Vitest·pytest에서 재현 |
| 데모 S6 | `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` 재분석 → `docker compose -f infra/compose.yaml start ai-gateway` | 10이 확정. 데모에서는 이 방법만 쓴다 |

`AI_FAULT_INJECT`의 값(`kev_timeout` / `qwen_error` / `gateway_down`)과 "테스트 전용, 데모·운영 금지" 규칙은 [[03-AI-PIPELINE|03 AI 파이프라인]] §3 env 표가 원천이다.

### 3.1 골든 외 회귀 케이스

| fixture | 검증 대상 | 테스트 파일 (예정) |
|---|---|---|
| `FX-08` | 취소 → 재분석 없음, 검토 기록 보존, 버튼 비활성 | `web/server/ingestion/cancel.test.ts`, `web/e2e-auth/cancelled-bid.spec.ts` |
| `FX-11` | 예산·마감 null → `missingFactors` 1건, 마감 집계 제외 | `web/server/scoring/missing-policy.test.ts`, `web/server/dashboard/deadline-summary.test.ts` |
| `FX-12` | 필수 필드 누락 → 격리, 관리자 화면 노출 | `web/server/ingestion/quarantine.test.ts`, `web/e2e-auth/admin-ingestion.spec.ts` |
| `FX-13` | 금액 텍스트 정규화, 원본 보존. 인용 검증 실패 → `CONFLICTED` | `web/server/ingestion/normalize-amount.test.ts`, `services/ai/tests/test_citation_verify.py` |
| `FX-14` | KST→UTC, 마감 임박 카드, `DEADLINE_APPROACHING` 하루 1회 | `web/server/ingestion/normalize-date.test.ts`, `web/server/notifications/deadline.test.ts` |
| `FX-15` | 수행 상한 초과 → `scaleFit` 0점 + `SCALE_LIMIT_EXCEEDED` | `web/server/scoring/scale-limit.test.ts` |
| `FX-17`, `FX-18` | `planRef` 기반 단계 연결 | `web/server/ingestion/stage-link.test.ts` |
| `FX-19` | 제목 유사도만 → 후보 표시, 병합 없음 | `web/server/ingestion/stage-link.test.ts` |
| `FX-01`~`FX-03` | [[08-SCORING\|08 SOL Score]] §6 worked example 수치 일치 | `web/server/scoring/worked-examples.golden.test.ts` |
| 전체 | 재현성: 같은 `input_snapshot_hash` + `algorithm_version` → 같은 `score`·같은 요소별 `points`(두 번 계산 byte-동일) | `web/server/scoring/reproducibility.test.ts` |

## 4. 수용 기준 (Phase별)

| Phase | 통과 조건 | 증거 |
|---|---|---|
| 0 | `docker compose -f infra/compose.yaml ps`에서 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(web을 Compose로 띄우면 `web` 포함) 전부 healthy(`postgres`·`api` 서비스는 없다). web의 `/health/live`·`/health/ready` 200, `checks.db` = Supabase 클라우드 프로젝트 연결 ok. worker가 `web/server` 도메인 코드를 불러 기동(`server-only` 실행 방식 `--conditions=react-server` 검증, [[16-DECISIONS\|16 ADR]] 미결정). `pnpm verify` 통과 | `phase-0/compose-ps.txt`, `phase-0/health-ready.json`, `phase-0/test-report.txt` |
| 1 | `pnpm test:db` 통과(SOL RADAR 표의 RLS·`sol_role` CHECK·조직 격리 정책 시험, 마이그레이션 재실행). 클라우드 적용 `pnpm db:push`는 사용자 확인 뒤. seed(`pnpm demo:reset`) 2회 실행 멱등. G5 통과 | `phase-1/test-db.txt`, `phase-1/migrate.log`(`pnpm db:push` 출력), `phase-1/test-isolation.txt` |
| 2 | G1·G2·G7·G10 + §3.1 ingestion 케이스 통과, `SEED` summary `{created:19, quarantined:1, retried:2}` | `phase-2/test-ingestion.txt`, `phase-2/test-contracts.txt`, `phase-2/seed-summary.json` |
| 3 | E2E 로그인 → 목록 → 상세, axe 위반 0, G8 | `phase-3/e2e/*.png`, `phase-3/axe-report.json` |
| 4 | G3·G4 + worked example 3건 수치 일치, missing 정책 9행, 재현성 테스트 통과 | `phase-4/goldens-report.txt`, `phase-4/coverage-summary.txt` |
| 5 | G6·G9, `AI_PROVIDER=mock` 전체 흐름, 실모델 플래그는 미검증 표시 | `phase-5/ai-fallback.txt`, `phase-5/test-ai.txt` |
| 6 | 결정 기록 → 감사로그, 알림 1건 규칙, E2E 전체 | `phase-6/e2e/*.png`, `phase-6/test-notifications.txt` |
| 7 | §5 데모 체크리스트 전 항목, 비밀값 로그 유출 0(`SUPABASE_SERVICE_ROLE_KEY` 포함), `pnpm verify`·`pnpm test:db`·E2E·pytest·smoke 전부 PASS | `demo-day/<일시>/checklist.md` |

## 5. 데모 당일 수용 체크리스트

데모 시작 전 한 번, 리허설 때 한 번 통과시킨다. 결과는 `docs/evidence/demo-day/YYYYMMDD-HHMM/checklist.md`에 ✅/❌와 스크린샷 이름으로 기록한다. 장면 번호는 [[19-DEMO-SCENARIO|19 데모 시나리오]]와 같다: `S0` 사전 준비(§3), `S1` 문제 슬라이드(조작 없음, 체크리스트 대상 아님), `S2`~`S7` 클릭 경로(§4). 데모 계정은 `admin@soltech.invalid`, `sales@soltech.invalid`, `analyst@soltech.invalid`, `viewer@soltech.invalid`(`org-01`), `viewer@other.invalid`(`org-02`). 비밀번호는 `.env.example`의 `DEMO_SEED_PASSWORD` placeholder만 두고 실제 값은 seed 시 입력한다.

| # | 장면 | 단계 | 행동 | 기대 화면·응답 | 실패 시 대체 |
|---|---|---|---|---|---|
| 0 | S0 | 환경 | env에 `DEMO_MODE=true`, `AI_PROVIDER=mock`, 기본 비밀값 아님 확인. `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`가 채워져 있는지 `pnpm check:env`로 확인(값은 출력하지 않는다). 인터넷 연결(Supabase 클라우드 프로젝트 접속). 포트 3000 비어 있음 | — | 포트 충돌 프로세스 종료. 네트워크 불가면 1번의 대체로 |
| 1 | S0 | 기동 | `docker compose -f infra/compose.yaml --profile demo up -d --build` 후 `docker compose -f infra/compose.yaml ps` | `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`(web을 Compose로 띄우면 `web` 포함) 전부 `healthy`. web `GET /health/ready` 200, `checks.db: ok`(Supabase 연결), `checks.ai: mock` | 1회 재기동. `checks.db` 불가(503)면 네트워크·Supabase 프로젝트 상태 확인. 그래도 실패면 사전 녹화 영상(네트워크 없는 대체 경로는 미결정, [[16-DECISIONS\|16 ADR]]) |
| 2 | S0 | seed | `pnpm demo:reset` (스크립트. service role로 Supabase 프로젝트에 seed, 멱등, [[10-DEPLOYMENT\|10 배포]]) | 로그 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`. `ingest_runs.summary` `{created:19, quarantined:1, retried:2}`. `GET /api/v1/bids` 총 19건. `bid_reviews` 2건(`FX-01` BID, `FX-03` NO-BID) | seed 재실행(멱등) |
| 3 | S0 | 로그인 | `sales@soltech.invalid`로 `/auth/login`(Supabase Auth) | `/dashboard` 이동. Topbar에 `DEMO` 배지·`AI: mock`·수집 시각·🔔 | `admin@soltech.invalid`로 대체 |
| 4 | S2 | 대시보드 | — | BID 권고 3건(`FX-01` 94, `FX-18` 82, `FX-06` 78), 마감 임박 카드에 `FX-14`(D-2), 수집 카드에 "격리 1건"(`FX-12`), 최근 변경 목록 | 숫자 불일치는 기록만 하고 진행 |
| 5 | S2 | 목록 | `/bids`, 단계 NOTICE 필터, 점수 내림차순 | `FX-01` 최상단 94, `FX-12` 미노출, 모든 행 `DEMO` 칩, 1280px에서 가로 스크롤 없음 | — |
| 6 | S3 | 상세 BID | `FX-01` 열기 | 자격 3건 `충족`, 점수 94, 분해 5행(24.0/25.0/20.0/15.0/10.0), Kev 71/24/5 + 09 고지 문구, 근거 3건 → 드로어에 원문 하이라이트, 결정 패널 "마지막 결정: BID"(seed 리뷰) | 드로어 실패 시 원문 링크 새 탭 |
| 7 | S3 | 규칙 우선 | `FX-03` 열기 | 권고 `NO-BID`, 자격 1건 `미충족` + 근거 문장, 점수 68 "참고" 표시, Kev 섹션 `규칙 우선` 배지와 "Kev는 BID를 제시했지만…" 문구, "마지막 결정: NO-BID"(seed 리뷰) | — |
| 8 | S4 | 라이브 분석 | `FX-02` → [분석 재실행] | 202 → `대기 중` → `분석 중` → `완료` 10초 이내. 점수 72, WATCH, 분해 15.0/18.3/14.0/15.0/10.0, Kev 36/52/12 | 60초 초과 시 새로고침, 사유 기록 |
| 9 | S4 | 사람 결정 | `FX-02` 결정 패널에서 WATCH 유지 또는 BID 선택 + 사유 → [결정 기록] | "마지막 결정: … · 담당자 · 시각", 결정 패널 상단 "사람 검토 권장"(`KEV_NEEDS_REVIEW`). `bid_reviews` +1(총 3건), 감사로그 1건. `analyst@soltech.invalid`로 보면 패널 읽기 전용 | — |
| 10 | S5 | 변경 수집 | `/admin/ingestion`(`admin@soltech.invalid`) → 수동 수집 `LIVE`(API `batch:"live"`) | 🔔 증가. `FX-07` revision 2 → 재분석 68 → 76, 권고 WATCH → BID. `FX-06` diff 마감 +14 → +28, 알림 1건. `FX-09` 재전송으로 알림 추가 0. `FX-08` `취소됨`. summary `{changed:3, cancelled:1, skippedDuplicate:1}` | 수집 실패 시 이력 표 오류를 보여 주고 다음 장면 |
| 11 | S6 | 장애 대체 | `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` [분석 재실행] `force=true` | 1~2초 안에 `부분 완료 (규칙만)`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)", `recommendationBasis: RULES_ONLY`, Topbar `AI: unavailable`, `/health/ready` `status: degraded`. 점수 94·자격 3건 그대로 | 사전 녹화 영상 |
| 12 | S6 | 복구 | `docker compose -f infra/compose.yaml start ai-gateway` → `ps`에서 ai-gateway `healthy` → `FX-01` 재실행 | `완료`로 복귀, Topbar `AI: mock`, Kev 분포 다시 표시 | — |
| 13 | S7 | 격리 | `viewer@other.invalid`(`org-02`)로 로그인해 받은 Supabase access token을 `Authorization: Bearer`로 붙여 `GET /api/v1/bids/{FX-01}/qualification-checks`, `GET /api/v1/analyses/{org-01 분석 id}` | 둘 다 404([[09-SECURITY\|09 보안]] IDOR 정책, RLS로 행이 안 보여 404). 화면에서는 `FX-01` 공고 본문은 보이되 점수·자격·검토 없음 | API 응답 JSON으로 대체 시연 |
| 14 | S7 | 관리자 | `/admin/ingestion` | `SEED` run에 격리 1건(`FX-12`, 사유 `title` 누락), `FX-20` 재시도 로그 2회 + `Retry-After` 대기 | — |
| 15 | 마감 | 증거 | 각 단계 스크린샷 저장 | `demo-day/<일시>/screenshots/` 15장 이상 | — |

체크리스트에서 ❌가 하나라도 있으면 그 항목은 데모에서 "미구현"으로 말한다. 통과한 척하지 않는다.

## 6. 심사용 증거 산출물 (`docs/evidence/`)

> [!todo]
> 저장 위치와 파일명 규칙은 제안이다. [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]의 "해커톤 모드" 절과 같은 규칙을 쓰도록 17 담당 세션에 제안함.

```text
docs/evidence/
  README.md                         # 주장 → 증거 파일 색인 (심사위원용, 아래 표)
  phase-0/  compose-ps.txt  health-ready.json  test-report.txt
  phase-1/  test-db.txt  migrate.log  test-isolation.txt  seed-summary.json
  phase-2/  test-ingestion.txt  ingest-run-FX-20.json
  phase-3/  e2e/*.png  axe-report.json
  phase-4/  goldens-report.txt  coverage-summary.txt
  phase-5/  test-ai.txt  ai-fallback.txt  e2e/partial.png
  phase-6/  test-notifications.txt  e2e/*.png
  demo-day/ rehearsal-log.md               # 17: 매일 리허설 날짜·소요 시간·실패 단계
  demo-day/ YYYYMMDD-HHMM/  checklist.md  screenshots/*.png  isolation-404.json  compose-ps.txt
```

규칙:

- 테스트 출력은 명령 전체 stdout을 그대로 저장한다(요약 금지). 첫 줄에 실행 명령과 커밋 해시(git 도입 후) 또는 날짜.
- 스크린샷 파일명은 [[17-CLAUDE-IMPLEMENTATION\|17 구현 규칙]]과 동일: `YYYYMMDD-phaseN-<route>-<state>-<width>.png`. `state`는 `loaded | empty | loading | error | forbidden | partial | demo-badge`([[06-UI-UX\|06 UI]] §12), `width`는 1440·1280. 데모 당일 촬영은 `phaseN` 자리에 `demo`를 쓴다. 예: `20261020-phase3-bid-detail-partial-1440.png`, `20261020-demo-bid-detail-partial-1440.png`.
- 커버리지는 요약만(`coverage-summary.txt`). 전체 HTML은 저장하지 않는다.
- 실패한 실행도 저장한다. 파일명 끝에 `-FAIL`. 다음 실행에서 통과하면 둘 다 남긴다.
- 비밀값·토큰·원문 전체가 들어간 로그는 저장 전에 마스킹한다([[09-SECURITY|09 보안]]).

심사위원용 색인(`docs/evidence/README.md`)의 표 형식:

| 주장 | 어디서 확인 | 증거 파일 |
|---|---|---|
| 같은 입력이면 같은 점수 | [[08-SCORING\|08 SOL Score]] §6 | `phase-4/goldens-report.txt` |
| 규칙이 Kev를 뒤집지 못한다 | G3 | `phase-4/goldens-report.txt`, `demo-day/*/screenshots/*-demo-bid-detail-loaded-1440.png`(FX-03) |
| AI 없이도 완결된다 | G6 | `phase-5/ai-fallback.txt`, `*-demo-bid-detail-partial-1440.png` |
| 조직 간 데이터 격리 | G5 | `phase-1/test-isolation.txt`, `demo-day/*/isolation-404.json` |
| 중복 수집·중복 알림 없음 | G1, G2 | `phase-2/test-ingestion.txt`, `phase-6/test-notifications.txt` |
| 가상 데이터를 가상이라고 표시 | G8 | `phase-3/e2e/demo-badge.png` |
| 실제 외부 API를 호출하지 않았다 | 07 §2 | `phase-2/test-ingestion.txt`의 네트워크 호출 0 assert |

## 7. MVP 완료 조건

`pnpm verify`(서식·타입·린트·단위)·`pnpm test:db`·E2E·pytest·smoke 모두 PASS. fixture 기반 시연 플로우(§5) 100% 통과. API 비밀 로그 유출 없음. 수집 중복 없음. 모든 스코어에 근거·`algorithm_version`·프로필 revision 존재. 사람 최종 결정이 `bid_reviews`와 감사로그에 기록. 성능 목표는 실측치를 기록하고 비현실적인 수치를 성공으로 주장하지 않는다. 실모델(Qwen·Kev 로컬/hosted) 경로는 해커톤 범위에서 **미검증**으로 표시한다.

## 8. 솔리데오 인력·가입 수용 기준 (ADR-019)

기존 골든 G1~G10과 구분해 PPL 번호를 사용한다. 명부·카탈로그, DB/RLS·가입/보완 가드와 순수 인력 계산 회귀는 구현되었다. 기존 계획의 독립 코드 QA는 verify·공개130·브라우저89·인증92 및 실제 로컬 seed/1440·1280 검사를 통과했다. 이후 ADR-021의 가입·인력 저장 정합화도 별도 환경에서 검증했다(아래 §9). 사진은 2026-10-17 사람 APPROVED200/READY200·원본 대조 release·실제 Next 접근 검증을 통과했다. 전체 점수 파이프라인과 전체 ADR-021 후속 범위는 남아 있으며 아래 기준 전체를 통과했다는 뜻이 아니다. [통합 검증 기록](evidence/people/20261016-people-integration.md)에 실행과 미실행을 구분한다.

| ID | 자동 검증할 조건 | 위치 / 명령 |
|---|---|---|
| PPL-01 | 명부 200명·고유 ID/이름 200·남녀 100/100·한글 세 글자·원본 정규화 이름과 교집합 0. 입력 원본이 없으면 실패 | `scripts/demo-people.test.mjs`, `node --test scripts/demo-people.test.mjs`. 실제 원본 검사는 아래 로컬 절차 |
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

사진 전 데이터 단계에서는 앞의 두 명령과 `pnpm verify`가 통과해야 한다. release 검사는 사진 미완료로 반드시 실패해야 하며 데이터 단계 검증을 위해 READY 요건을 낮추지 않는다. 사진 후에는 release 검사와 별도의 정장·서로 다른 얼굴·품질 사람 검수까지 통과해야 PPL-03 완료다. 이미지 해시가 다르다는 사실만으로 서로 다른 얼굴을 보장하지 않는다. PPL-07의 순수 snapshot/FTE 및 별도 worked-example 요소 회귀는 실제 점수 파이프라인의94/72/68 골든 시험을 대신하지 않는다. 기간은 반개구간이며 개인별 최소 잔여 용량을 합산하는 보수적인 보장 FTE다. 시간 평균이나 직원 교대 최적화가 아니다. 전체 pipeline 골든은 Phase4에 남긴다.

원본이 없는 CI 초록불은 로컬 원본 대조 완료가 아니다. 검증 결과는 오류 코드와 안전한 인물 ID만 출력하며 원본 이름·제외 집합·경로·연락처를 출력하지 않는다. 로컬 원본 통과 증거는 [20261016-people-data.json](evidence/people/20261016-people-data.json)에 건수·입력 해시·이름 출처·AI 검토 결과로 남긴다. 사람의 이름/얼굴 검수 승인을 수행한 것처럼 기록하지 않는다. 이미지 생성은 시험·CI에서 호출하지 않는다.

### 배분 가중치 제외 검사 (추가 인터뷰)

명시된 팀 구역과 사용자 승인 비팀 제외 구역이 원본 인력 행을 중복 없이 모두 분류해야 한다. 제외 구역의 이름도 원본 이름 제외 집합에 포함한다. 팀 범위·제외 범위에 동시에 걸리거나 어디에도 없는 행은 실패한다. 이 분류 검사와 200명 목표 배분 검사를 함께 수행한다.

## 9. ADR-021 가입·인력 저장 정합화 검증 (2026-10-17)

운영200/평가27 분리·본부6/그룹4/팀38 계층·상위 인원 수NULL·신규 가입 개인 조직 생성 중단·실제 멤버십0/1/복수 정책을 독립 검증했다. 공개 부서 선택은TEAM38개, 직급12개로 유지한다. 신규 신고 정보는 권한·조직 합류를 만들지 않는다.

전체 `pnpm verify`(루트347/웹865/새 빌드), 공개130/포함 브라우저99, 정상 Auth95 실행은 `e465438`의 증거다. Auth는93통과·중복 조직명 선택자2실패였고 실제 키보드 초점 결함을 추가 발견했다. 최종 `21c8b97`에서 세 결함 수정·독립 리뷰 후 정상 웹 게이트865, 새 빌드, 관련 브라우저12, 로그인 준비5와 기존 실패Auth2 및1440/1280 실제 초점·계정 화면 검증이 통과했다. 변경 없는 성공 증거를 최종 SHA에서 재실행했다고 표기하지 않는다.

전용 Supabase에서 기존00002의200/27·과거 개인 조직 표본을 변경 없는00003/4로 전환해 ID·평가 튜플·과거 데이터 보존을 확인했다. 실제 신규 Auth는profile1/org0/membership0, 정상seed2회는200/27/기존5계정ID 보존, 원본 필수 검사는passed다. 최종 임시 사용자·조직을 제거하고 전용 스택만 정리했다. 공유 DB 적용·main 병합은 하지 않았다.

[실행·실패·재검증·한계](evidence/people/20261016-adr021-people-integration.md)와 [독립 QA 원본](evidence/people/20261017-adr021-qa-report.md)을 따른다. 실제 REST 중단의 초기 조회 안내는30초 timeout으로 live-PASS가 아니며, RSC 응답을 보류한 동안의 즉시 화면 이동도 미확립이다. 사진은 별도 생성200/READY0로 사람 승인·통합 전이다. N1/N2·/people·/ops·전체 Phase4·실제 외부 OAuth는 이 완료 범위에 포함하지 않는다.

## 관련 문서

- [[07-DATA-PIPELINE|07 수집]] — fixture `FX-01`~`FX-20` 명세
- [[08-SCORING|08 SOL Score]] — worked example과 missing 정책 (골든 입력)
- [[06-UI-UX|06 UI]] — E2E가 검사하는 화면 상태·문구
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — Phase 보고 형식, 증거 저장
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 데모 당일 서사와 계정
- [[12-ROADMAP|12 로드맵]] — Phase별 해커톤 컷
- [[16-DECISIONS|16 ADR]] — ADR-017(Next.js + Supabase 전환, 시험 도구·위치의 근거)

## 10. 승인 사진 통합 검증 (2026-10-17)

사진200장 사람 APPROVED/manifest READY와 기존 personId·SHA-256을 유지해 b3ef `a05217a05f0fb9adb3553c02978f0e2d531e9610`에 통합했다. 같은 고정 HEAD에서 새 `pnpm verify`(루트349·웹879·빌드), 정상 Auth95, 브라우저106, 실제 Next GET·승인 SHA·브라우저 decode200을 통과했다. 원본 필수 release 대조도 Task1에서 passed였다. 상세 명령·한계·원래 실패 기록은 [통합 결과](evidence/people/20261017-portraits-integration.md)와 [독립 QA 원문](evidence/people/20261017-portraits-integration-qa.md)에 있다.

조직 종류/직원TEAM/상위target NULL/팀 합200 제약은 통과했으나 TEAM25·GROUP4의 부모는 미확정으로 보존했다. 완전히 연결된 본부→그룹→팀 조직도는 미검증이다. 조직도·운영 직원 목록·직원 상세 제품 화면과 전체 G1~G10은 미구현/미검증이며, 일반 RLS 통과를 전체 G5로 올리지 않는다. 외부 OAuth 실연결·이번 전체 공개 E2E도 미검증이다. 공유 DB 적용·main 병합·push는 수행하지 않았다.

최종 리뷰 보존 수정 `ca719cf`에서 새 전체 verify(루트350·웹879·빌드)와 실제 비시드 팀 거절/전체 tuple 보존·정상 seed2회를 통과했다. 초기 a052의 Auth95·브라우저106·Next200 증거는 해당 SHA로 보존한다. [최종 QA](evidence/people/20261017-portraits-integration/final-fix/final-fix-qa-report.md).
