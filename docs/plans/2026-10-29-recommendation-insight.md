---
title: "추천 분석 단계 계획"
doc: "plan-20261029-recommendation-insight"
status: active
tags:
  - sol-radar
  - ai
  - qwen
  - bosun
  - hackathon
updated: 2026-10-29
---

# 추천 분석 단계 계획

> **에이전트 작업자에게:** 이 계획은 작업자 4명(09·ac·0f·df)이 자기 Task 를 차례로 실행한다. 단계는 체크박스(`- [ ]`)다. superpowers:executing-plans 로 자기 Task 만 실행한다. 시험 먼저(superpowers:test-driven-development).

**목표:** 공고 상세의 [추천 분석] 버튼으로 Qwen3.8-Flash-Next가 판단 이유·강점·보완할 점을 근거 인용과 함께 쓰게 하고, Bosun 입력에 인력 가용을 넣는다.

**구조:** 분석과 같은 비동기 흐름이다. 화면 POST → (Vercel relay) → redis-api가 `recommendation_insights` PENDING 행과 BullMQ `insight` job → Analysis Worker가 gateway `POST /insight` → 행을 DONE·FAILED로 닫는다. 화면은 GET으로 묻는다. 공통 이름과 모양은 Task 0의 `web/server/insight/insight.model.ts`가 정본이다.

**기술:** Next.js 16 Route Handler · Supabase RLS · BullMQ · FastAPI(uv·pytest) · vLLM guided JSON · Vitest(브라우저 포함) · PGlite 정책 시험. 새 패키지 없음.

**스펙:** `polaris/specs/in-progress/2026-10-29-recommendation-insight.md`(사용자 결정 2026-10-29 R1~R8). 계획과 스펙이 다르면 스펙을 따르고 45 에 알린다.

## 전역 제약

- 판정(점수·`recommendation`·필수 자격·`score_runs.explanation`)을 바꾸지 않는다. 기존 `/explain`·`/health` 응답 모양을 바꾸지 않는다(`test_health.py` 는 정확히 같은지 본다).
- 분석 job(`web/worker/analysis-job.ts`)에서 Qwen 설명을 부르지 않는다. `web/worker/analysis-only-main.ts` 는 회사 원본이라 고치지 않는다(조립은 `analysis-runtime.ts`).
- 금지어: 승률·확률·가능성·수주 금액·점유율·경쟁사·%. 새 화면 문구와 gateway 출력 검증 둘 다. 기존 "수주 확률이 아닙니다" 고지는 그대로 둔다.
- 판정 이름: 화면은 BID=추천·WATCH=보류·NO_BID=비추천. 모델 출력은 다른 판정의 이름을 쓰면 안 된다(Task 1).
- service role 키는 worker 만 쓴다. Route Handler·서버 컴포넌트·클라이언트 번들에서 쓰지 않는다.
- 마이그레이션은 새 파일로만. 생성물(`web/lib/database.types.ts`)은 `pnpm db:types` 로 만들고 마이그레이션과 같은 커밋에 넣는다.
- gateway 로그에 프롬프트·모델 출력을 남기지 않는다(`test_local_security.py`).
- 유료 hosted 모델·회사 API·실모델을 부르지 않는다. 시험은 mock·`FakeModelServer` 만. SSH·운영 DB 쓰기·`db:push`·push·main 병합은 하지 않는다.
- 화면 확인은 1440·1280 두 폭. 1280 미만 배치 없음. 색은 토큰만(`pnpm check:colors`).
- `eslint-disable`·`any`·`@ts-ignore`·`.skip`·`.only`·`--no-verify`·`HUSKY=0` 금지. 단언을 약하게 바꾸지 않는다. **훅·가드·권한 거부에 막히면 다른 길로 돌아가지 말고 멈춰 45 에 보고한다.**
- `.env*` 파일은 어떤 도구로도 읽지 않는다. env 이름을 문자열로 이어 붙이지 않는다.
- 프로세스는 자기 PID 만 끈다(`pkill`·`killall` 금지). 백그라운드는 `run_in_background`. 다른 세션 스택과 Supabase 54321 을 건드리지 않는다.
- 무거운 명령(`pnpm verify*`·`test:browser`·`test:e2e*`·`next build`·`services/ai/verify.sh`·`git commit`)은 슬롯으로 감싼다: `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh <명령>`.
- 개발 중 검증은 `pnpm verify:changed`(gateway 는 `services/ai/verify.sh`). 전체 `pnpm verify` 는 45 가 통합 때 돌린다.
- 커밋은 자기 branch 에만, 파일을 지정해 스테이징한다(`git add -A` 금지). 메시지 `feat(<범위>): 한국어 설명`(첫 줄 50자 이내). 쓰기 git 은 `git -C <절대경로>` 와 `&&` 만, 파이프로 잇지 않는다.

## Review Focus

1. **두 번 누르기·relay 재시도**(502·503·504 에 같은 Idempotency-Key 로 다시 보냄): 행·job 이 하나이고 두 번째 응답은 같은 `insightId`·`deduplicated: true`. → Task 6 DB 시험(PENDING 부분 유일), Task 7 service 시험.
2. **모델 출력이 규칙을 어김**(금지어, 입력에 없는 숫자, 다른 판정 이름, 없는 근거 번호, JSON 깨짐): TEMPLATE 로 대체되고 `fallbackReason` 이 맞다. → Task 1 시험 이유별 1개씩.
3. **worker·gateway 가 죽음**: gateway 실패면 FAILED(`GATEWAY_UNAVAILABLE`) 후 [다시 요청]이 새 행을 만든다. worker 가 없으면 화면은 3분 뒤 늦음 안내, worker 는 10분 넘은 PENDING 을 FAILED(`STALE`). → Task 5 시험, Task 7 service 시험(FAILED 뒤 새 행), Task 8 브라우저 시험(늦음 안내).
4. **읽기 전용 역할(EXECUTIVE·VIEWER)·다른 조직**: 버튼 없음, POST 403 `FORBIDDEN`, 다른 조직 run 404 `NOT_FOUND`, 결과 읽기는 된다. → Task 6 정책 시험, Task 7 route 시험, Task 8 브라우저 시험.
5. **재분석 뒤**: 새 run 에는 옛 run 의 설명이 붙지 않는다. 분석 run 이 QUEUED·RUNNING·FAILED 이면 패널이 없고 POST 는 404. → Task 7 repo·service 시험(run 기준 조회, run 상태 거절), Task 8 브라우저 시험.

---

## 공통 계약

### C1 표 `recommendation_insights` (Task 6 이 만든다)

| 열 | 타입 | 규칙 |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `org_id` | uuid not null | `organizations(id)` |
| `score_run_id` | uuid not null | `(score_run_id, org_id)` → `score_runs(id, org_id)` on delete cascade |
| `status` | text not null default `'PENDING'` | `PENDING`·`DONE`·`FAILED` |
| `source` | text | `MODEL`·`TEMPLATE`. DONE 만 not null |
| `payload` | jsonb | `insightPayloadSchema` 모양. DONE 만 not null |
| `fallback_reason` | text | `insightFallbackReasonSchema` 값. TEMPLATE 일 때만 |
| `model_name` | text | gateway 응답 `model` |
| `prompt_hash` | text | gateway 응답 `promptHash` |
| `error_code` | text | `insightErrorCodeSchema` 값. FAILED 만 not null |
| `requested_by` | uuid not null default `auth.uid()` | 요청한 사용자 |
| `created_at` | timestamptz not null default `now()` | |
| `finished_at` | timestamptz | DONE·FAILED 만 not null |

- 상태 check: PENDING 이면 `source`·`payload`·`error_code`·`finished_at` 모두 null. DONE 이면 `source`·`payload`·`finished_at` not null, `error_code` null. FAILED 이면 `error_code`·`finished_at` not null, `payload` null.
- 부분 유일 색인 `recommendation_insights_one_pending` on `(score_run_id) where status = 'PENDING'`. 조회 색인 `(org_id, score_run_id, created_at desc)`.
- 권한: `revoke all` from `anon, authenticated`. `grant select` to `authenticated`. `grant insert (org_id, score_run_id)` to `authenticated`. update·delete 권한 없음.
- select 정책: `org_id in (select public.my_org_ids())`.
- insert 정책: `org_id in (select public.my_sol_org_ids(array['ADMIN','SALES','ANALYST']))` and `requested_by = (select auth.uid())` and `status = 'PENDING'` and `exists (select 1 from public.score_runs r where r.id = score_run_id and r.org_id = recommendation_insights.org_id and r.status in ('COMPLETED','PARTIAL'))`.
- 마감(DONE·FAILED)은 worker 가 service role 로 `update … where id = $1 and status = 'PENDING'` 한다. 보안 정의자 함수는 만들지 않는다.

### C2 경로 (Task 7 이 만든다)

| 메서드·경로 | 역할 | 응답 |
|---|---|---|
| `POST /api/v1/bids/{bidId}/analyses/{runId}/insight` | ADMIN·SALES·ANALYST | 202 `InsightAccepted`. frontend 는 relay op `insight-submit`, redis-api·standalone 은 직접 처리 |
| `GET /api/v1/bids/{bidId}/analyses/{runId}/insight` | 조직 구성원 전부 | 200 `{ insight: InsightView \| null }`(그 run 의 최신 1건). 모든 역할에서 RLS 로 직접 읽는다(relay 없음) |

- 본문 없음. Idempotency-Key 는 받아도 쓰지 않는다(중복은 run 기준으로 막는다).
- 오류: 403 `FORBIDDEN`(역할), 404 `NOT_FOUND`(run 이 없음·다른 조직·다른 공고·COMPLETED·PARTIAL 아님), 429 `RATE_LIMITED`(사용자당 분당 3회, `createAnalysisRateLimiter({ keyPrefix: "insight", limitPerMinute: 3 })`). 새 오류 코드는 만들지 않는다.
- `pollUrl` = 같은 경로(GET).

### C3 gateway `POST /insight` (Task 1·2 가 만들고 Task 4 가 부른다)

요청(JSON, camelCase, 크기 상한은 기존 `SizeLimitedModel`):

```json
{
  "requestId": "uuid",
  "bid": { "title": "string", "agency": "string|null", "budgetKrw": "string|null", "deadline": "YYYY-MM-DD|null" },
  "rules": {
    "score": 0,
    "recommendation": "BID|WATCH|NO_BID",
    "recommendationBasis": "string",
    "factors": [{ "factor": "string", "label": "string", "points": 0, "maxPoints": 0, "reason": "string" }],
    "qualificationChecks": [{ "label": "string", "status": "SATISFIED|NOT_SATISFIED|NEEDS_REVIEW|NOT_APPLICABLE", "reason": "string" }],
    "reviewFlags": ["string"],
    "missingFactors": ["string"]
  },
  "bosun": { "reviewFlags": ["string"] },
  "company": {
    "name": "string|null",
    "technologies": ["string"],
    "staff": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "availableFte": 0, "eligibleStaff": 0 }
  },
  "refs": [{ "id": "B1", "kind": "BID|COMPANY", "label": "string", "quotedText": "string" }]
}
```

- `bosun` 은 run 에서 Bosun 을 쓰지 않았으면 null. `company.staff` 는 기간을 정할 수 없으면 null.
- 상한: `factors` ≤ 8, `qualificationChecks` ≤ 20, `technologies` ≤ 10, `refs` ≤ 24, `refs[].quotedText` ≤ 300자, `label` ≤ 80자.

응답 200(언제나. 모델이 실패해도 템플릿):

```json
{
  "summary": "string(≤400)",
  "strengths": [{ "text": "string(≤200)", "refIds": ["B1"] }],
  "improvements": [{ "text": "string(≤200)", "refIds": ["C2"] }],
  "fallback": false,
  "fallbackReason": "MODEL_UNAVAILABLE|INVALID_OUTPUT|FORBIDDEN_WORD|UNKNOWN_NUMBER|UNKNOWN_REF|LABEL_CONFLICT|null",
  "model": "string|null",
  "promptHash": "sha256 hex"
}
```

- `strengths`·`improvements` 는 각각 0~4개, `refIds` 는 항목당 0~4개.
- `fallback: false` 면 `fallbackReason: null`, `model` 은 adapter 의 모델 이름. `fallback: true` 면 `model: null`.

### C4 큐

`INSIGHT_QUEUE = "insight"`, `INSIGHT_JOB = "explain"`, 데이터 `{ insightId, orgId }`, jobId `insightJobId(insightId)`. 옵션 `attempts: 1`, `removeOnComplete: true`, `removeOnFail: 100`. 모두 `@/server/insight`(Task 0).

## 작업 폴더

| 작업자 | worktree | branch | 시작 |
|---|---|---|---|
| 45(통합) | `sol-radar-worktrees/rec-insight` | `feat/rec-insight` | — |
| 09 | `sol-radar-worktrees/rec-insight-gateway` | `feat/rec-insight-gateway` | 지금 |
| ac | `sol-radar-worktrees/rec-insight-worker` | `feat/rec-insight-worker` | 지금(Task 3·4). Task 5 는 45 의 "Task 6 통합" 알림 뒤 `feat/rec-insight` 를 합치고 시작 |
| 0f | `sol-radar-worktrees/rec-insight-db` | `feat/rec-insight-db` | 지금. Task 6 을 먼저 커밋하고 45 에 알린다 |
| df | `sol-radar-worktrees/rec-insight-ui` | `feat/rec-insight-ui` | 지금 |

- 만들기: `git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/<폴더> -b <branch> feat/rec-insight`.
- 각 worktree 에서 루트·`web` 두 곳에 `pnpm install --frozen-lockfile`(gateway 는 `services/ai` 에서 `uv sync`). `prepare` 의 exit 1 은 무시해도 된다.
- 끝나면 커밋 해시·실행한 검증 명령과 결과·남은 것을 45 에 보낸다. 45 가 diff 와 시험을 직접 확인하고 `feat/rec-insight` 로 합친다.

## 파일 소유

| 작업자 | 소유 |
|---|---|
| 45 | `web/server/insight/insight.model.ts`·`index.ts`(Task 0, 이후 0f 가 export 를 더한다), `docs/**`, `polaris/specs/**` |
| 09 | `services/ai/**` |
| ac | `web/server/scoring/**`, `web/server/analysis/**`, `web/worker/insight-job.ts`·`insight-job.test.ts`, `web/worker/analysis-runtime.ts`(+시험) |
| 0f | `supabase/migrations/20261029000100_recommendation_insights.sql`, `web/lib/database.types.ts`, `scripts/database.test.mjs`, `web/server/insight/**`(model 이외 새 파일과 `index.ts` export 추가), `web/app/api/v1/bids/[id]/analyses/[runId]/insight/**`, `web/app/_lib/{redis-api-path,redis-api-client,redis-api-contract,insight-queue}.ts`(+시험), `web/app/api/v1/redis-gateway-contract.test.ts`, `web/app/_lib/deployment-role.test.ts`, `web/proxy.test.ts` |
| df | `web/components/bids/recommendation-insight.tsx`·`use-insight-request.ts`·`recommendation-insight.browser.test.tsx`, `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx`, `web/app/(app)/(work)/bids/[id]/page.tsx` |

`insight.model.ts` 를 바꿔야 하면 고치지 말고 45 에 알린다(계약이 흔들리면 세 작업자가 함께 깨진다).

---

### Task 0: 공통 계약 (45, 끝남)

**Files:** Create `web/server/insight/insight.model.ts`, `web/server/insight/index.ts`, Test `web/server/insight/insight.model.test.ts`

**Produces:** `INSIGHT_QUEUE`·`INSIGHT_JOB`·`INSIGHT_STALE_MS`(10분)·`INSIGHT_POLL_LIMIT_MS`(3분)·`INSIGHT_REQUEST_ROLES`, `insightStatusSchema`·`insightSourceSchema`·`insightFallbackReasonSchema`·`insightErrorCodeSchema`·`insightRefIdSchema`(`^[BC][1-9]\d?$`)·`insightRefSchema`·`insightItemSchema`·`insightPayloadSchema`(refIds 가 refs 에 있는지 검사)·`insightJobDataSchema`·`insightJobId(id) = "insight-" + id`, 타입 `InsightView`·`InsightAccepted`·`InsightPayload`·`InsightRef`·`InsightItem`.

- [x] 시험 3개 통과(`pnpm -C web exec vitest run server/insight/insight.model.test.ts`). `feat/rec-insight` 에 커밋.

---

### Task 1: gateway 검증·템플릿 (09)

**Files:**
- Modify: `services/ai/src/sol_ai/contracts.py`(`ExplainRequest` 아래)
- Create: `services/ai/src/sol_ai/insight.py`
- Modify: `services/ai/tests/support.py`(`insight_request()` 추가)
- Test: `services/ai/tests/test_insight.py`

**Interfaces:**
- Produces: `InsightRequest`·`InsightResponse`·`InsightItem`·`InsightRef`(C3 모양, `SizeLimitedModel`·alias camelCase), `validate_insight(raw: str, request: InsightRequest) -> tuple[InsightBody | None, FallbackReason | None]`, `template_insight(request: InsightRequest) -> InsightBody`, `FORBIDDEN_WORDS = ("승률", "확률", "가능성", "수주 금액", "점유율", "경쟁사", "%")`. `InsightBody` = summary·strengths·improvements.

- [ ] **Step 1: 실패하는 시험을 쓴다.** `test_insight.py`:
  - `test_valid_model_output_passes` — 입력 숫자·refIds 만 쓴 JSON → `(body, None)`.
  - `test_forbidden_word_falls_back` — summary 에 "수주 확률" → `FORBIDDEN_WORD`.
  - `test_unknown_number_falls_back` — 입력에 없는 "37억" → `UNKNOWN_NUMBER`(`explain.number_tokens`·`allowed_numbers` 를 요청 JSON 전체에 쓴다).
  - `test_other_label_falls_back` — WATCH 요청에 "비추천"·"추천"(앞에 "비" 없음) 또는 영문 `BID`·`NO_BID`·`NO-BID`·`WATCH` → `LABEL_CONFLICT`. 같은 판정의 한국어 이름(WATCH 의 "보류")은 통과.
  - `test_unknown_ref_falls_back` — `refIds: ["B9"]`(요청 refs 에 없음) → `UNKNOWN_REF`.
  - `test_broken_json_falls_back` — 잘린 JSON·상한 넘는 개수·글자 → `INVALID_OUTPUT`.
  - `test_template_is_deterministic_and_clean` — 같은 요청 두 번 → 같은 결과. 템플릿 문장도 위 검증을 통과한다(금지어·판정 이름 없음). 강점은 `points/maxPoints ≥ 0.6` 요소 최대 3개, 보완할 점은 `NOT_SATISFIED`·`NEEDS_REVIEW` 자격 최대 2개 + `points/maxPoints < 0.4` 요소 최대 2개, summary 는 `SOL Score {score}점. {recommendationBasis}` 로 시작.
- [ ] **Step 2:** `uv run --directory services/ai pytest tests/test_insight.py -q` → FAIL(import 오류).
- [ ] **Step 3: 구현.** 판정 이름 규칙: BID="추천", WATCH="보류", NO_BID="비추천". "비추천"은 NO_BID 로 세고, "비"가 앞에 없는 "추천"은 BID 로 센다. 영문 판정 토큰은 판정과 상관없이 늘 거절한다. 검증 순서: JSON·모양(INVALID_OUTPUT) → 근거 번호 → 금지어 → 판정 이름 → 숫자.
- [ ] **Step 4:** 같은 명령 → PASS.
- [ ] **Step 5: 커밋** `feat(ai): 추천 분석 계약·출력 검증·템플릿`.

### Task 2: gateway 경로·어댑터·프롬프트 (09)

**Files:**
- Create: `services/ai/prompts/insight.v0.1.md`, `services/ai/schemas/insight.v0.1.json`
- Modify: `services/ai/src/sol_ai/adapters/base.py`(`InsightAdapter` protocol), `adapters/qwen.py`(`LocalQwen.insight`), `adapters/mock.py`(`MockQwen.insight`), `src/sol_ai/app.py`(경로)
- Test: `services/ai/tests/test_insight.py`(경로 시험 추가)

**Interfaces:**
- Consumes: Task 1 전부.
- Produces: `@runtime_checkable class InsightAdapter(Protocol): def insight(self, request: InsightRequest, *, deadline: Deadline) -> str` (모델 원문 JSON 문자열). `POST /insight` → `InsightResponse`.

- [ ] **Step 1: 실패하는 시험.**
  - `test_insight_endpoint_model_path` — `local_models` + `FakeModelServer.respond_with(chat_completion(<유효 JSON>))` → 200, `fallback: false`, `model` 이 registry 의 Qwen 이름, `promptHash` 가 64자 hex.
  - `test_insight_endpoint_falls_back_on_model_error` — 모델 서버 500·timeout → 200, `fallback: true`, `fallbackReason: "MODEL_UNAVAILABLE"`.
  - `test_insight_endpoint_mock_is_deterministic` — mock 두 번 같은 응답, `fallback: false`.
  - `test_insight_does_not_log_prompt_or_output` — caplog 에 요청 `quotedText`·모델 응답 글자가 없다.
  - `test_health_unchanged` — 기존 `test_health.py` 를 고치지 않고 통과.
- [ ] **Step 2:** `uv run --directory services/ai pytest tests/test_insight.py -q` → FAIL.
- [ ] **Step 3: 구현.**
  - 경로는 `/extract`·`/kev` 처럼 동기 `def`, `Deadline(settings.AI_TIMEOUT_MS)`. adapter 가 `InsightAdapter` 가 아니면(hosted 의 `UnavailableQwen`) 바로 템플릿.
  - `LocalQwen.insight` 는 `translate`(qwen.py:327-364) 를 본뜬다. guided JSON(`schemas/insight.v0.1.json`) 먼저, 실패하면 unguided 1회. `max_tokens` 1024, 나머지 `INFERENCE`·`enable_thinking: False` 그대로. 실패는 `ModelUnavailable`·`ExtractionFailed` 로 던지고 경로가 `MODEL_UNAVAILABLE`·`INVALID_OUTPUT` 템플릿으로 바꾼다.
  - 프롬프트(한국어): 역할(공공 SI 입찰 검토 보조), 입력 사실만 쓴다, 숫자는 입력에 적힌 그대로, 항목마다 근거 번호, 판정 이름과 금지어를 쓰지 않는다, "~습니다" 체, summary 2~3문장. 사용자 메시지는 요청 JSON 에서 `requestId` 를 뺀 것.
  - `promptHash` = `schema.prompt_hash(<프롬프트 파일>, <스키마 글>, "insight/v0.1")`.
  - `MockQwen.insight` 는 `template_insight(request)` 를 JSON 으로 돌려준다(같은 검증을 거친다). `AI_FAULT_INJECT` 가 켜져 있으면 다른 메서드와 같은 규칙으로 실패한다.
- [ ] **Step 4:** `bash $SLOT bash services/ai/verify.sh` → 통과.
- [ ] **Step 5: 커밋** `feat(ai): 추천 분석 경로 /insight 와 Qwen 프롬프트`.

---

### Task 3: Bosun 인력 입력 (ac)

**Files:**
- Modify: `web/server/scoring/factors.ts:245`(인력 요소가 새 함수를 쓰게), `web/server/scoring/index.ts`(export)
- Modify: `web/server/analysis/analysis.model.ts:371-404`(`profileSummary.staffAvailability`)
- Test: 기존 scoring·analysis 시험 파일에 추가

**Interfaces:**
- Produces: `export type StaffAvailabilityInput = { from: string; to: string; availableFte: number; eligibleStaff: number }`, `export function staffAvailabilityInput(bid, extraction, team, today): StaffAvailabilityInput | null` (`@/server/scoring`). 인력 요소(K6)의 `rawValue.period.startsAt/endsAt`·`availableFte`·`teamMembers` 와 같은 값이다.

- [ ] **Step 1: 실패하는 시험.** `staffAvailabilityInput` 이 인력 요소 `rawValue` 와 같은 from·to·availableFte·eligibleStaff 를 내는 시험(기간이 있는 fixture 1개), 기간을 정할 수 없으면 null 시험. `toKevRequest` 가 그 값을 `profileSummary.staffAvailability` 에 넣는 시험.
- [ ] **Step 2:** `pnpm -C web exec vitest run <두 시험 파일>` → FAIL.
- [ ] **Step 3: 구현.** 타입 `profileSummary: CompanyProfile & { staffAvailability: null }` 와 주석 "인력 가용(K6)은 아직 채우지 않는다"를 고친다. gateway `StaffAvailability`(contracts.py:152) 모양과 같은지 본다.
- [ ] **Step 4:** 같은 명령 PASS, 골든 시험(`pnpm -C web exec vitest run server/scoring`) PASS — 점수가 그대로여야 한다.
- [ ] **Step 5: 커밋** `feat(analysis): Bosun 입력에 인력 가용 채우기`.

### Task 4: gateway 클라이언트·요청 조립 (ac)

**Files:**
- Modify: `web/server/analysis/gateway.model.ts`(`InsightGatewayRequest` 타입·`insightResponseSchema`), `gateway.client.ts`(`insight`)
- Create: `web/server/analysis/insight-request.model.ts`
- Modify: `web/server/analysis/index.ts`(export)
- Test: `web/server/analysis/insight-request.model.test.ts`, 기존 gateway client 시험에 1개

**Interfaces:**
- Consumes: Task 0 `InsightRef`·`insightFallbackReasonSchema`, Task 3 `staffAvailabilityInput`.
- Produces:
  - `GatewayClient.insight(request: InsightGatewayRequest): Promise<GatewayResult<InsightGatewayResponse>>` — 경로 `/insight`, timeout `config.explainTimeoutMs`(새 env 없음), 같은 breaker·1회 재시도.
  - `export type InsightRunSource = { scoreRunId: string; orgId: string; input: AnalysisInput; score: number; recommendation: "BID" | "WATCH" | "NO_BID"; recommendationBasis: string; reviewFlags: string[]; missingFactors: string[]; kevEnabled: boolean; kevReviewFlags: string[]; factors: { factor: string; points: number; maxPoints: number; reason: string }[]; checks: { label: string; status: QualificationStatus; reason: string }[] }`
  - `export function toInsightRequest(source: InsightRunSource, requestId: string): { request: InsightGatewayRequest; refs: InsightRef[] }` — 순수 함수.
  - `export function toInsightPayload(response: InsightGatewayResponse, refs: InsightRef[]): InsightPayload` — 항목이 가리킨 refs 만 남기고 `insightPayloadSchema.parse`.

- [ ] **Step 1: 실패하는 시험.**
  - `refs 는 공고 인용 B·회사 자료 C 로 번호를 매긴다` — 추출 KNOWN 필드의 첫 근거 `quotedText` 를 B1… (최대 12, 300자에서 자름), 회사 자료는 인력 요소·유사 실적·기술 요소가 쓴 과거 사업(최대 5)·기술(최대 5)·인력(1)을 C1… (최대 12).
  - `요소 이름은 화면과 같은 한국어 이름이다` — `label` 이 화면 요소 이름 표와 같다(기존 표를 찾아 쓴다. 새로 만들지 않는다).
  - `Bosun 을 쓰지 않았으면 bosun 은 null` / `인력 기간이 없으면 company.staff 는 null`.
  - `상한을 넘는 입력을 자른다` — factors ≤ 8, checks ≤ 20, technologies ≤ 10.
  - `toInsightPayload 는 가리키지 않은 refs 를 뺀다`.
- [ ] **Step 2:** `pnpm -C web exec vitest run server/analysis/insight-request.model.test.ts` → FAIL.
- [ ] **Step 3: 구현.** `insightResponseSchema` 는 C3 응답 모양(`fallbackReason` 은 `insightFallbackReasonSchema.nullable()`). 회사 자료 label 예: "과거 수행 사업", "보유 기술", "투입 가능 인력". quotedText 는 이름·분야·완료일·금액을 한 줄로.
- [ ] **Step 4:** 같은 명령 PASS, `pnpm -C web exec vitest run server/analysis` PASS.
- [ ] **Step 5: 커밋** `feat(analysis): 추천 분석 요청 조립과 gateway 호출`.

### Task 5: worker insight job (ac, Task 6 통합 뒤)

**Files:**
- Create: `web/server/analysis/insight-store.ts`(service role 저장 port), `web/worker/insight-job.ts`
- Modify: `web/worker/analysis-runtime.ts`(insight Worker·주기 정리 조립), `web/server/analysis/index.ts`
- Test: `web/worker/insight-job.test.ts`, `web/worker/analysis-runtime.test.ts`(있으면 1개 추가)

**Interfaces:**
- Consumes: Task 0 계약, Task 4 `toInsightRequest`·`toInsightPayload`·`GatewayClient.insight`, Task 6 표 타입.
- Produces:
  - `createInsightStore(supabase: SupabaseClient<Database>): InsightStore`, `InsightStore = { loadPending(insightId: string, orgId: string): Promise<{ scoreRunId: string } | null>; loadRunSource(scoreRunId: string, orgId: string): Promise<InsightRunSource | null>; finishDone(input: { insightId: string; source: InsightSource; payload: InsightPayload; fallbackReason: InsightFallbackReason | null; modelName: string | null; promptHash: string; finishedAt: string }): Promise<boolean>; finishFailed(input: { insightId: string; errorCode: InsightErrorCode; finishedAt: string }): Promise<boolean>; sweepStale(before: string): Promise<number> }`. `finish*` 는 `status = 'PENDING'` 인 행만 바꾸고, 바꿨으면 true.
  - `processInsightJob(data: InsightJobData, deps: { store: InsightStore; gateway: Pick<GatewayClient, "insight">; now: () => Date }): Promise<void>`
  - `createInsightWorker(connection: IORedis, deps): Worker` — `INSIGHT_QUEUE`, concurrency 1.

- [ ] **Step 1: 실패하는 시험** (`insight-job.test.ts`, 가짜 store·gateway):
  - `PENDING 이 아니면 아무것도 하지 않는다` — `loadPending` null → gateway 안 부름.
  - `모델 응답이면 DONE·MODEL 로 닫는다` / `fallback 이면 DONE·TEMPLATE 와 fallbackReason`.
  - `gateway 실패면 FAILED GATEWAY_UNAVAILABLE` / `응답이 계약과 다르면 FAILED GATEWAY_INVALID`(`toInsightPayload` 가 던짐).
  - `input_snapshot 을 읽지 못하면 FAILED SOURCE_INVALID`(`loadRunSource` null).
  - `정리는 10분 넘은 PENDING 을 FAILED STALE 로 닫는다` — `sweepStale(now - INSIGHT_STALE_MS)`.
  - `job 은 다시 던지지 않는다` — 모든 실패는 행으로 닫고 resolve(attempts 1).
- [ ] **Step 2:** `pnpm -C web exec vitest run worker/insight-job.test.ts` → FAIL.
- [ ] **Step 3: 구현.** `loadRunSource` 는 `score_runs`(status COMPLETED·PARTIAL 인 run 만, `input_snapshot`·`score`·`recommendation`·`recommendation_basis`·`review_flags`·`missing_factors`·`kev_assist`) + `score_factors` + `qualification_checks` 를 `org_id` 로 거르고, `input_snapshot` 은 `analysisInputSchema.safeParse` 로 읽는다. `analysis-runtime.ts` 에서 insight Worker 를 같은 gateway 클라이언트(`deps`)로 만들고, 정리를 기동 때 한 번 + 5분마다 돌린다. close 순서에 넣는다(정리 → Worker → 연결).
- [ ] **Step 4:** 같은 명령 PASS, `pnpm -C web exec vitest run worker` PASS.
- [ ] **Step 5: 커밋** `feat(worker): 추천 분석 job 과 오래된 요청 정리`.

---

### Task 6: 표·RLS·타입 (0f, 먼저)

**Files:**
- Create: `supabase/migrations/20261029000100_recommendation_insights.sql`
- Modify: `web/lib/database.types.ts`(`pnpm db:types`), `scripts/database.test.mjs`(`ORG_TABLES` :47-57 에 표 추가, 정책 시험)

**Interfaces:** Produces C1 표.

- [ ] **Step 1: 실패하는 정책 시험** (`database.test.mjs`, :1457 근처 시험 모양):
  - `ANALYST 는 자기 조직 COMPLETED run 에 PENDING 을 넣는다`.
  - `EXECUTIVE·VIEWER 는 넣지 못한다` / `다른 조직 run·QUEUED run 에는 넣지 못한다` / `requested_by 를 남으로 넣지 못한다` / `status 를 DONE 으로 넣지 못한다`(열 권한).
  - `같은 run 에 PENDING 두 번째는 유일 위반` / `FAILED 뒤에는 새 PENDING 을 넣는다`.
  - `조직 구성원은 읽고, 다른 조직은 못 읽는다` / `사용자는 update·delete 못 한다`.
  - `상태 check: DONE 인데 payload 가 null 이면 거절`(service role 쪽).
- [ ] **Step 2:** `node --test scripts/database.test.mjs` → FAIL.
- [ ] **Step 3: 구현.** 견본 `supabase/migrations/20261019000005_bid_reviews_assignments.sql`. 보안 정의자 함수 없음(`scripts/db-verify.mjs` 허용 목록을 건드리지 않는다).
- [ ] **Step 4:** 같은 명령 PASS. `pnpm db:types` 로 타입 생성, `git diff --stat web/lib/database.types.ts` 에 새 표만.
- [ ] **Step 5: 커밋** `feat(db): 추천 분석 표와 RLS` → **45 에 해시를 알린다**(ac Task 5 가 기다린다).

### Task 7: 도메인·경로·relay·큐 생산자 (0f)

**Files:**
- Create: `web/server/insight/insight.repo.ts`, `insight.service.ts`(+시험), `web/app/_lib/insight-queue.ts`, `web/app/api/v1/bids/[id]/analyses/[runId]/insight/route.ts`(+시험)
- Modify: `web/server/insight/index.ts`(export 추가), `web/app/_lib/redis-api-path.ts`(op `insight-submit`), `redis-api-client.ts`(allowlist :79-86), `redis-api-contract.ts`(`insightAcceptedSchema`), 계약 시험 4개(`redis-gateway-contract.test.ts`·`redis-api-client.test.ts`·`deployment-role.test.ts`·`web/proxy.test.ts`)

**Interfaces:**
- Consumes: Task 0, Task 6.
- Produces:
  - `requestInsight(ctx: { orgId: string; userId: string; role: SolRole }, bidId: string, runId: string, deps: { repo: InsightRepo; enqueue: (data: InsightJobData) => Promise<void> }): Promise<InsightRequestResult>` — 결과는 `{ ok: true; status: 202; data: InsightAccepted } | { ok: false; status: 403 | 404; code: "FORBIDDEN" | "NOT_FOUND"; ... }`(watchlist 의 결과 모양).
  - `getInsight(ctx, bidId: string, runId: string): Promise<InsightView | null>` — 그 run 의 최신 1건. df 의 `page.tsx` 가 첫 화면에 쓴다.
  - `insightAcceptedSchema = z.object({ insightId: z.uuid(), status: insightStatusSchema, deduplicated: z.boolean(), pollUrl: z.string() })`.

- [ ] **Step 1: 실패하는 시험.**
  - service: `PENDING 이 있으면 새로 만들지 않고 다시 넣는다(deduplicated true, enqueue 같은 id)`, `DONE·MODEL 이 있으면 그대로 돌려준다(enqueue 없음)`, `FAILED·TEMPLATE 뒤에는 새 행`, `insert 가 유일 위반(23505)이면 있던 PENDING 을 읽어 돌려준다`, `run 이 다른 공고·COMPLETED·PARTIAL 아님이면 404`, `EXECUTIVE 는 403`.
  - repo: `getInsight 는 그 run 의 최신 1건만 본다(다른 run 행을 무시)`.
  - route: frontend 역할 POST 는 relay op `insight-submit` 으로 보내고 202 를 그대로 돌려준다. GET 은 어느 역할이든 relay 하지 않는다.
  - relay 계약: 202 본문이 `insightAcceptedSchema` 와 다르면 relay 가 502 로 막는다(기존 analysis-submit 시험 모양).
- [ ] **Step 2:** `pnpm -C web exec vitest run server/insight app/api/v1/bids app/_lib` → FAIL.
- [ ] **Step 3: 구현.** 템플릿은 `web/app/api/v1/bids/[id]/analyses/route.ts:43-75`(`businessRoute`·`deploymentRole()`·`relayRedisApi`). 큐 생산자는 `analysis-queue.ts` 의 `createBullQueue` 모양, C4 옵션. 사용자 JWT 클라이언트(`getSupabase()`)만 쓴다. 속도 제한은 C2.
- [ ] **Step 4:** 같은 명령 PASS, `bash $SLOT pnpm verify:changed` 통과.
- [ ] **Step 5: 커밋** `feat(web): 추천 분석 요청·조회 경로와 relay`.

---

### Task 8: 화면 (df)

**Files:**
- Create: `web/components/bids/recommendation-insight.tsx`, `web/components/bids/use-insight-request.ts`, `web/components/bids/recommendation-insight.browser.test.tsx`
- Modify: `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx:833-844`(KevOpinion 다음), `web/app/(app)/(work)/bids/[id]/page.tsx`(첫 값)

**Interfaces:**
- Consumes: Task 0 `InsightView`·`InsightAccepted`·`INSIGHT_POLL_LIMIT_MS`(type import 와 상수), C2 경로. Task 7 의 `getInsight` 는 통합 뒤 `page.tsx` 에서 부른다(그 전에는 `initialInsight={null}` 로 둔다).
- Produces: `<RecommendationInsight bidId runId canRequest initialInsight />` — `canRequest` = 역할이 ADMIN·SALES·ANALYST. run 이 COMPLETED·PARTIAL 일 때만 그린다.

- [ ] **Step 1: 실패하는 브라우저 시험** (`recommendation-insight.browser.test.tsx`, fetch 가짜):
  - `요청 가능하면 [추천 분석] 을 누르면 POST 하고 진행 표시를 보인다`.
  - `DONE·MODEL 이면 판단 이유·강점·보완할 점과 근거 칩을 보인다` — 칩을 누르면 인용문(label·quotedText)이 보인다.
  - `DONE·TEMPLATE 이면 "모델 설명을 쓰지 못해 규칙 결과로 정리했습니다" 와 [다시 요청]`.
  - `FAILED 이면 "추천 분석을 만들지 못했습니다" 와 [다시 요청]`.
  - `3분 넘게 PENDING 이면 "응답이 늦어지고 있습니다" 와 [다시 확인]`(가짜 시계).
  - `canRequest false 면 버튼이 없고 "아직 추천 분석이 없습니다."`.
  - `늘 "판정은 규칙 엔진이 하고, 최종 참여 결정은 사람이 합니다." 를 보인다`. 화면 글자에 금지어가 없다.
- [ ] **Step 2:** `bash $SLOT pnpm -C web test:browser -- components/bids/recommendation-insight.browser.test.tsx` → FAIL.
- [ ] **Step 3: 구현.** 호출은 `api-envelope.ts`(`JSON_HEADERS`·`readJson`·`failureOf`), 폴링은 `use-analysis-run.ts` 모양(2초 → 5초, `INSIGHT_POLL_LIMIT_MS` 에서 멈춤). 오류는 sonner toast. 패널 제목 "추천 분석", 모델 이름과 만든 시각은 바닥 한 줄. 부품은 `web/components/ui/` 만, 색은 토큰만.
- [ ] **Step 4:** 같은 명령 PASS, `bash $SLOT pnpm verify:changed` 통과. 1440·1280 스크린샷 `docs/evidence/rec-insight/df-<상태>-<폭>.png`(브라우저 시험 스크린샷은 `web/test-results` 에 찍고 복사).
- [ ] **Step 5: 커밋** `feat(web): 공고 상세 추천 분석 패널`.

---

### Task 9: 문서 (45)

**Files:** `docs/16-DECISIONS.md`(ADR-066 + ADR-034 §10 개정), `docs/03-AI-PIPELINE.md`(:29·84·133·144·229 "Qwen 설명 미구현" → `/insight` 온디맨드), `docs/04-DATABASE.md`(표), `docs/05-API-SPEC.md`(C2), `docs/06-UI-UX.md`(패널 상태), `docs/15-DATA-CONTRACTS.md`(C3), `docs/21-MODEL-TRAINING.md`·`docs/22-FINETUNE-RUNBOOK.md`(스펙 4.5 재학습 구조, §3.1 GPU 문구), `docs/PROGRESS.md`

- [ ] ADR-066: 온디맨드 추천 분석·인력 입력·연 1회 재학습 구조·PaddleOCR 조항 개정. 색인 표 줄 + 본문(최신이 위).
- [ ] ADR-034 §10: "GPU 1 PaddleOCR 공유" 전제를 지우고 "회사 컨테이너는 멈추지 않는다·학습 전 GPU 1 메모리 확인"으로 고친다. 10-20 기록 문장은 남긴다.
- [ ] frontmatter `updated`·위키링크 규약 유지. 커밋 `docs: 추천 분석 ADR-066 과 설계 문서 반영`.

### Task 10: 통합·배포 (45)

- [ ] 각 branch 를 받을 때 diff·시험을 직접 확인하고 `feat/rec-insight` 로 합친다(순서: 6 → 1·2 → 3·4 → 7 → 5 → 8).
- [ ] 전체 `bash $SLOT pnpm verify` + `bash $SLOT bash services/ai/verify.sh` 통과.
- [ ] 격리 로컬 스택(mock)에서 [추천 분석] → DONE 을 1440·1280 으로 확인, 증거 `docs/evidence/rec-insight/README.md`.
- [ ] 독립 리뷰 1회(security-auditor: RLS·service role·로그·금지어).
- [ ] **사용자 승인 뒤**: `pnpm db:push`(마이그레이션 1개) → main push(Vercel) → 회사 gateway·Analysis Worker·redis-api 교체(`infra/company/README.md`, 배포 커밋 해시 고정). Vercel 이 먼저 올라가도 redis-api 가 옛 것이면 POST 가 404 로 오고 화면은 오류 안내만 낸다(데이터 손상 없음).
- [ ] 운영에서 DEMO 1건·실공고 1건 추천 분석(승인 뒤), 스펙 9절 결과·PROGRESS 갱신, 스펙을 `done/` 으로.

## 자체 점검

- 스펙 대응: G1 → Task 7·8, G2 → Task 1·2·4·5, G3 → Task 3, G4 → Task 9. A1~A9 → Task 1~10 시험·Task 10 확인.
- 이름 일치: `insightJobId`·`InsightRunSource`·`toInsightRequest`·`toInsightPayload`·`InsightStore`·`requestInsight`·`getInsight`·`staffAvailabilityInput` 은 정의한 Task 와 쓰는 Task 에서 같다. 판정 값은 `NO_BID`(밑줄)다.
- 의존: Task 5 는 Task 6 표 타입, Task 8 의 `page.tsx` 첫 값은 Task 7 `getInsight` 를 기다린다. 나머지는 Task 0 만 있으면 동시에 간다.
