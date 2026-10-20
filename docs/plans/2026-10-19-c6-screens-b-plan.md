---
title: "구현 계획 — C6 화면 B단계 (main 병합 뒤)"
doc: "plan-c6-screens-b"
status: active
tags:
  - sol-radar
  - ui
  - hackathon
created: 2026-10-19
updated: 2026-10-20
---

# C6 화면 B단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A단계 부품·서비스 규칙 위에 Supabase 저장소·분석 큐 producer·Route Handler 10개(B1), 업무 화면 네 개와 앱 셸(B2), 로그인 뒤 E2E·axe·1440/1280 증거(B3)를 붙여 `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`가 실제 데이터로 동작하게 한다.

**Architecture:** 화면의 첫 그리기는 서버 컴포넌트가 `@/server/bids` 서비스를 직접 부르고, Route Handler는 같은 서비스를 감싼다(스펙 §6). 저장소 구현은 bids 도메인 안(`*.supabase.ts`)에 두고 사용자 세션 + RLS로만 읽고 쓴다. 다른 도메인(scoring·analysis·health)과 Redis(BullMQ·ioredis)를 잇는 일은 app 층의 `web/app/_lib/work-deps.ts` 한 곳이 맡는다. lodestar가 도메인 → 도메인 런타임 호출을 막기 때문이다(`web/lodestar.config.ts` domain `canImport: ["infra","shared"]`). 목록 정렬·필터는 새 마이그레이션 `20261019000012`의 `security_invoker` 뷰가 맡는다.

**Tech Stack:** Next.js 16.4.1 · React 19 · Tailwind v4 · Supabase(supabase-js·RLS) · BullMQ 6.3.16 · ioredis 6 · zod 4 · zustand · Vitest(node·browser) · PGlite(`pnpm test:db`) · Playwright 1.64 · axe-core(eslint-plugin-jsx-a11y 경유, people-read 관례)

**Spec:** [디자인 스펙 — C6](2026-10-19-c6-screens-design.md)(D1~D30 승인, ADR-029 A6). 형식·A단계 산출물은 [C6 A단계 계획](2026-10-19-c6-screens-plan.md), A단계 판정·의무는 `.superpowers/sdd/2026-10-19-c6-screens-plan/progress.md`(Ruling 1~14, `OBLIGATION(B1)`·`OBLIGATION(B2)`). 정본 추가 결정: ADR-029 A7(취소 공고), ADR-030 B14(CLOSED 계산)·B20(분석 요청 계약)·B22(사전 분석)·B23(알림 링크)·B25·B26(글자 +3px).

작업 폴더는 `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/c6-screens`, 브랜치는 `c6/screens`다. 이 계획은 `feat/people-read`(PR #6, origin/main `98101e8`)와 C5-B(`c5/analysis-client` `015ed24`)가 main에 들어온 뒤를 전제로 한다.

## Global Constraints

- 범위 밖: 1280px 미만 레이아웃·모바일, 결제·구독, 자동 투찰, 승률 예측, `/people`·`/org-chart`·`/admin/ingestion`·`/company`·`/ops` 화면. 이 화면들의 파일은 B0 병합과 `app-shell.tsx`의 `NAV` 한 줄 외에는 고치지 않는다.
- 화면은 1440·1280 두 폭만 본다. 1280px·사이드바 펼침(본문 960px)에서 가로 넘침 0.
- 색·글꼴·글자 눈금은 `design/tokens.json`에서만 온다. `web/app/globals.css`는 `pnpm tokens`로만 만든다. 새 눈금은 B25(대시보드 본문)·B26(사이드바) 범위 변형뿐이다.
- 09 고정 문구는 바꾸지 않는다. "수주 확률"·"낙찰 확률"은 "아님"·"아닙니다"와 같은 문장 안에서만 나온다.
- `web/server/<도메인>/` 파일은 `import "server-only";`로 시작한다. 바깥에서는 배럴(`@/server/<도메인>`)로만 부른다. `../` 대신 `@/`. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip` 금지.
- 도메인은 다른 도메인을 런타임으로 부르지 않는다(타입 전용은 된다). scoring·analysis·health·organization을 잇는 일은 app 층(`web/app/**`)이 한다.
- `web/server/analysis/**`·`scoring/**`·`ingestion/**`·`people/**`는 고치지 않는다. 예외: `web/server/health`에 `getAiState()` 하나를 더한다(Task 5).
- 마이그레이션은 새 파일 `supabase/migrations/20261019000012_c6_screen_reads.sql` 하나만 만든다(e8 배정). 000011은 b3의 C5-B 보안 후속이다(`finish_score_run`, `score_runs_idempotency_key_org_check`: 키는 `<org_id>:`로 시작). C6 DB 시험의 멱등 키도 이 형식을 쓴다. 기존 파일은 고치지 않는다. `web/lib/database.types.ts`는 `pnpm db:types`로 만들어 같은 커밋에 넣는다. `pnpm db:push`는 하지 않는다.
- web 요청 경로는 anon 키 + 사용자 세션만 쓴다. service role은 E2E 지원 코드(로컬 Supabase, people-read 관례)에서만 쓴다.
- 정본(`docs/00~22`)과 `docs/PROGRESS.md`는 고치지 않는다(e8 몫). 증거는 `docs/evidence/phase-3/`에 둔다.
- 고정 값: 오류 봉투 `{error:{code,message,details,requestId}}` + `X-Request-Id`, CSRF 헤더 `X-Requested-With: sol-radar`, `Idempotency-Key`는 UUID, 분석 요청 조직당 30회/분(초과 `429` + `Retry-After`), `API_CURSOR_SECRET` 32자 이상(아니면 `503 {component:"cursor"}`), 큐 `analysis`·job `analyze`·jobId `analysis_<orgId>_<scoreRunId>`, 저장 멱등 키 `<orgId>:<Idempotency-Key>`(ADR-030 B20).
- Next 16: 동적 `params`는 `Promise`다. `RouteContext<'/api/v1/…'>`·`LayoutProps`·`PageProps`는 `next typegen` 뒤 전역 도우미다(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` 107~121행, `layout.md` 93~110행). `error.tsx`는 클라이언트 부품이고 다시 시도는 `retry()`다(16.3 안정, `reset()`은 권하지 않음 — `error.md` 117~157·331행). 스펙 §3.5의 `reset()`을 이것으로 바꾼다. `not-found.tsx`는 같은 구간의 `loading`·`error` 경계 안에서 그려진다(`not-found.md` 45행).
- 커밋은 `타입(범위): 한국어 설명`, 첫 줄 50자 이내, 파일 지정 스테이징, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push·merge·rebase·stash 금지(B0만 e8이 병합한다).
- `pkill`·`killall` 금지. 자기가 띄운 PID만 끈다. 시간초과·신호로 끊긴 검증은 통과·실패로 적지 않고 다시 돌린다. `AI_PROVIDER=mock`, 유료 API 호출 없음.

## Review Focus

- 검색어 `q`에 PostgREST 예약 문자(`,` `(` `)` `"` `\`)와 LIKE 문자(`%` `_`)가 들어와도 `500`이 나거나 필터가 바뀌지 않고, 글자 그대로 찾는다. 시험: Task 4 `postgrest.test.ts`·`bids.supabase.test.ts` "q 예약 문자".
- 경로 ID가 UUID가 아니면(`/bids/abc`, `/api/v1/analyses/abc`) DB를 부르지 않고 `404`다(화면은 `not-found`). 시험: Task 6 계약 시험 9번, Task 12 `work-screens.spec.ts` "잘못된 공고 주소".
- Redis·큐가 죽었을 때: `POST analyses`는 `503`이고 QUEUED 행이 풀린다. 같은 `Idempotency-Key`로 다시 보내면 FAILED run을 재생하지 않고 새 run을 만든다. 시험: Task 1 DB 시험 "release", Task 2 서비스 시험, Task 6 계약 시험 7번.
- 분석 polling: 화면을 떠나면 polling이 멈추고, 5분이 지나면 지연 배너로 멈추며, `401`이면 멈추고 안내한다. 두 번 눌러도 POST는 한 번이다. 시험: Task 10 `use-analysis-run.browser.test.tsx`.
- payload가 비었거나 모양이 틀린 알림 행이 있어도 목록·벨이 `500`이나 화면 오류가 되지 않고 그 행만 빠진다. 시험: Task 3 `bid-row.mapper.test.ts`, Task 4 `notification.supabase.test.ts`, Task 6 계약 시험 11번.

---

## B단계에서 내린 판단

e8의 지시(b-plan-brief)와 정본·코드 확인을 근거로 한 판단이다.

1. **새 마이그레이션 `20261019000012`이 필요하다.** 네 가지 이유가 있다.
   - `score_runs`에 요청 지문 열이 없다(04 §3.4). 같은 키 + 다른 본문 `409`(05 §1)를 지키려면 `request_hash` 열과 insert 열 권한이 필요하다. `OBLIGATION(B1)` 102행이다.
   - 화면 역할은 `score_runs`를 update할 수 없다(20261019000004 §5: "상태 전이와 결과 열은 worker만"). 그런데 B20은 "큐 등록 실패 → FAILED(`ENQUEUE_FAILED`) + 멱등 키 해제"를 요구한다. 그래서 요청자 본인의 QUEUED run만 푸는 좁은 `security definer` 함수를 둔다.
   - `ingest_runs`는 ADMIN만 읽는다(20261019000006 "ADMIN 은 수집 run 읽기"). S2 발표 계정은 SALES라 수집 신선도가 안 보인다. 그래서 최신 run 한 건의 상태·요약만 주는 함수를 둔다.
   - "점수 높은 순"·권고·결정 필터는 조직별 최신 분석·결정과 공고를 함께 정렬해야 한다. supabase-js 질의로는 커서 정렬을 할 수 없어 `security_invoker` 뷰를 둔다.
   - 알림 읽음 처리는 마이그레이션이 필요 없다. `grant update (read_at)`와 "본인 알림 읽음 처리" 정책이 이미 있다(20261019000006 213·244~249행). 감사는 000007 6번 트리거가 남긴다.
2. **멱등 키 보존**: 05 §1 "키 보존 24시간"을 하한으로 보고, 키는 그 run 행이 있는 동안 남긴다. 정리 job은 두지 않는다. 행에 남은 키(24시간이 지나도)를 같은 본문으로 다시 보내면 그 run을 재생하고, 다른 본문이면 `409 IDEMPOTENCY_KEY_REUSED`다. 큐 등록 실패로 풀린 키(`ENQUEUE_FAILED`, `idempotency_key = null`)는 다시 쓸 수 있고 새 run을 만든다(ADR-030 B20, Review Focus 3, 결정됨 5).
3. **producer 위치**: `web/app/_lib/analysis-queue.ts`(app 층)에 둔다. C5-B 배럴(`@/server/analysis`)이 큐 계약 상수(`ANALYSIS_QUEUE`·`ANALYSIS_JOB`·`ANALYSIS_JOB_OPTIONS`·`toAnalysisJobId`·`analysisJobDataSchema`)를 "Route Handler(C6)와 worker가 함께 쓴다"며 내보낸다. bids 도메인은 analysis를 런타임으로 부를 수 없어서, app 층이 `AnalysisQueue` 포트를 구현해 서비스에 주입한다.
4. **Redis env는 `REDIS_URL`이다.** `web/.env.example` 61행과 `/health/ready`의 `probeRedis(process.env.REDIS_URL)`가 이미 같은 이름을 쓴다. worker도 `REDIS_URL`이다(`web/worker/env.ts`).
5. **`serverExternalPackages: ["bullmq"]`를 둔다.** bullmq는 Next 기본 외부 목록에 없다(`serverExternalPackages.md`). bullmq 6.3.16의 `dist/cjs/postgres/`는 선택 의존 `pg`와 SQL 파일 읽기를 포함해서 번들하면 깨질 수 있다. ioredis는 health 경로가 이미 번들로 써서 그대로 둔다. `pnpm -C web build` 성공으로 확인한다.
6. **분석 결과는 저장 행에서 다시 만든다**(Ruling 13, 다시 계산 금지). 자격 종합 상태는 저장 열이 없어 C4 규칙(`web/server/scoring/qualification.ts` 452~486행: 지시문 의심 → `NEEDS_REVIEW`, 필수 `NOT_SATISFIED` → `NOT_SATISFIED`, 필수 `NEEDS_REVIEW` → `NEEDS_REVIEW`, 나머지 `SATISFIED`)을 mapper에 옮긴다. `rule_path`는 없으므로(장부 126행) `ruleReasonOf(analysis)`는 자격 상태로만 계산한다.
7. **`kev_assist`가 null이면** `kev.enabled=false`로 옮기고, 화면은 `model.kev`가 있는데 Kev 플래그가 없으면 "기록 없음"이라고 쓴다(05의 `kev`는 null이 될 수 없어 DTO는 바꾸지 않는다). `missing_reason`이 null이면 `missingFactors`에서 빼고 요소 행에 "사유 기록 없음"을 쓴다.

## 파일 지도

| 파일 | 맡는 것 | Task |
|---|---|---|
| `supabase/migrations/20261019000012_c6_screen_reads.sql` | `request_hash`, `release_unqueued_score_run`, `latest_ingest_run`, `bid_list_items` 뷰 | 1 |
| `scripts/database.test.mjs`, `web/lib/database.types.ts`(생성) | 정책 시험, 타입 | 1 |
| `web/server/bids/bid-query.ts`·`bid.model.ts`·`bids.repo.ts`·`*.service.ts`·`review.model.ts` | 쿼리·커서·포트·서비스 계약 보강 | 2 |
| `web/server/bids/analysis-row.mapper.ts`·`bid-row.mapper.ts` | 저장 행 → 05 DTO | 3 |
| `web/server/bids/postgrest.ts`·`bids.supabase.ts`·`review.supabase.ts`·`notification.supabase.ts`·`dashboard.supabase.ts` | 저장소 구현 | 4 |
| `web/app/_lib/run-mode.ts`·`analysis-queue.ts`·`rate-limit.ts`·`work-deps.ts`, `web/app/api/v1/_lib/http.ts`, `web/server/health/*`, `web/next.config.ts`, `scripts/check-env.mjs` | app 층 연결, producer, 속도 제한 | 5 |
| `web/app/api/v1/bids/**`·`analyses/[id]`·`dashboard/summary`·`notifications/**` route + 계약 시험 | Route Handler 10개 | 6 |
| `design/tokens.json`, `scripts/tokens-gen.mjs`, `web/app/globals.css`(생성), `web/components/app-shell.tsx`·`app-page.tsx`·`topbar-status.tsx` | 글자 범위 변형, 셸 | 7 |
| `web/app/(app)/(work)/layout.tsx`·`work.ts`, `web/app/_lib/work-data.ts`, `web/app/auth/*`, `web/app/(app)/dashboard/page.tsx`(삭제) | 업무 틀·가드·주소 | 8 |
| `web/app/(app)/(work)/dashboard/*`·`bids/*`, `web/components/bids/bid-table.tsx`·`bid-filters.tsx`·`analysis-banner.tsx` | 대시보드·목록 | 9 |
| `web/app/(app)/(work)/bids/[id]/*`, `web/components/bids/kev-opinion.tsx`·`score-factors.tsx`·`labels.ts`·`decision-panel.tsx` | 상세 | 10 |
| `web/app/(app)/(work)/notifications/*` | 알림 | 11 |
| `web/playwright.work.config.ts`, `web/e2e-auth/*.spec.ts`·`support/work-*.ts`, `docs/evidence/phase-3/**` | E2E·증거 | 12 |

---

### Task 0 (B0, e8 직접): main을 `c6/screens`에 합치기

구현자에게 맡기지 않는다. e8이 people-read·C5-B가 들어간 main을 합친 뒤, 아래 기준을 통과한 커밋을 B1 기준점으로 알린다.

| 충돌 파일 | 해소 규칙 |
|---|---|
| `web/app/api/v1/_lib/http.ts` | main의 `import type { PeopleResult }`와 `peopleResponse`를 살린다. `ApiErrorCode`는 c6 쪽 그대로 둔다(main 3개가 같은 자리, C6 3개는 `NOT_FOUND` 앞). |
| `web/components/app-page.tsx`, `web/server/organization/business-access.model.ts` | 두 쪽 내용이 같다. main 쪽을 쓰고 `git diff main -- <파일>`이 비었는지 본다. |
| `web/server/organization/index.ts` | c6가 22행에 넣은 `export type { MyBusinessAccess, SolRole } from "./business-access.model";`를 지운다. main 끝의 같은 줄과 `export { getMyBusinessAccess }`만 남긴다(중복 export는 TS 오류). |
| `web/lib/database.types.ts` | main 쪽을 쓰고 `pnpm db:types`로 다시 만든 결과가 같아야 한다. |
| `web/.env.example` | main 쪽을 쓴다(`API_CURSOR_SECRET=` 줄 포함). |
| `web/components/app-shell.tsx` | c6는 A단계에서 고치지 않았다. 충돌이 없어야 하고 main(people-read) 판이 남는다. B2(Task 7)가 그 위에서 고친다. |

- [ ] **병합 뒤 확인**: 루트·`web`에서 `pnpm install` → `pnpm verify` exit 0, `pnpm test:db` PASS, `pnpm -C web test:browser` PASS.
- [ ] `grep -c "MyBusinessAccess, SolRole" web/server/organization/index.ts`가 `1`이다. `git diff main...HEAD --stat`에 C6 파일만 보인다.
- [ ] `ls supabase/migrations | tail -2`가 `20261019000010_score_run_display_fields.sql`로 끝난다(C5-B 포함 확인).

---

### Task 1: 마이그레이션 `20261019000012` — 화면 읽기·분석 요청 보조

**Files:**
- Create: `supabase/migrations/20261019000012_c6_screen_reads.sql`
- Modify: `scripts/database.test.mjs`(Phase 1 묶음 안, C5-B의 "화면 표시용 저장 열(20261019000010)" 묶음 다음)
- Modify(생성): `web/lib/database.types.ts`

**Interfaces:**
- Produces(SQL):
  - `score_runs.request_hash text` (null 허용) + `grant insert (request_hash) on public.score_runs to authenticated`
  - `public.release_unqueued_score_run(p_score_run_id uuid) returns boolean` — `security definer`, `set search_path = ''`. `status='QUEUED' and requested_by = auth.uid() and org_id in (select public.my_sol_org_ids(array['ADMIN','SALES','ANALYST']))`인 행만 `status='FAILED'`, `error_code='ENQUEUE_FAILED'`, `idempotency_key=null`, `finished_at=now()`로 바꾸고 바꿨으면 true. `revoke execute … from public, anon`, `grant execute … to authenticated`.
  - `public.latest_ingest_run(p_origin text) returns table (status text, started_at timestamptz, finished_at timestamptz, summary jsonb)` — `security definer`, `stable`. 업무 역할 4개 중 하나가 있는 사용자에게만 1행. `p_origin`: `'demo'` → `source='fixture'`, `'live'` → `source='g2b'`, `'all'` → 전부. `started_at desc` 첫 행.
  - 뷰 `public.bid_list_items with (security_invoker = true)` — 열(이름 고정):
    - 공고: `id, source, notice_id, title, agency, stage, budget_krw`(numeric, 정렬용)`, budget_krw_text`(`budget_krw::text`)`, published_at, deadline_at, latest_revision, plan_ref, is_demo, source_url, last_synced_at`
    - `status` = 저장 상태가 `OPEN`·`AMENDED`이고 `deadline_at < now()`면 `'CLOSED'`, 아니면 저장 값(ADR-030 B14)
    - 최신 run(상태 무관, `created_at desc, id desc`): `latest_run_id, latest_run_status, latest_run_score, latest_run_recommendation, latest_run_basis, latest_run_flags, latest_run_created_at`
    - 최신 점수 run(`COMPLETED`·`PARTIAL`): `scored_score, scored_recommendation`
    - 최신 결정(`decided_at desc, id desc`): `latest_decision, latest_decided_at, latest_reviewer_display_name, latest_reviewer_email`(profiles 조인)
    - 최신 revision 첨부 집계: `docs_total, docs_pending`(download `PENDING` 또는 download `OK` + parse `null`·`PENDING`)`, docs_parsed, docs_partial, docs_unsupported, docs_failed`(parse `FAILED`)`, docs_download_failed`
  - `revoke all on public.bid_list_items from anon, public`, `grant select … to authenticated`

- [ ] **Step 1: 실패하는 DB 시험을 쓴다.** 새 `describe("C6 화면 읽기·분석 요청 보조 (20261019000012)")`. Phase 1 묶음의 `as`·`asWorker`·`rowsOf`·`ORG1`·`BID1`·`REV1`·`PROFILE1`·`RUN1` 시드를 쓴다.
  - `sales`가 `request_hash`를 넣은 QUEUED run을 만들 수 있다. `update score_runs set request_hash=…`는 `42501`이다.
  - 같은 입력의 두 번째 QUEUED insert는 `23505`이고 메시지에 `score_runs_active_input_key`가 있다. 같은 `idempotency_key`의 두 번째 insert는 `23505`이고 메시지에 `score_runs_idempotency_key_key`가 있다(의무 O7a의 DB 쪽).
  - `sales`가 자기 QUEUED run에 `release_unqueued_score_run`을 부르면 `true`다. 행은 `FAILED`·`ENQUEUE_FAILED`·`idempotency_key is null`·`finished_at is not null`이다. 그 뒤 같은 키로 새 QUEUED run을 넣을 수 있다(O4·O7b).
  - 남의 run(`analyst`가 부름), RUNNING run, org-02 사용자(`outsider`)는 `false`이고 행이 그대로다. `anon`은 `permission denied for function release_unqueued_score_run`이다.
  - `latest_ingest_run('demo')`: org-01 `viewer`는 1행이고 `summary`가 있다. `outsider`(org-02 VIEWER)도 1행이다(조직 소유 표가 아니다). `invitee`는 0행, `anon`은 권한 오류다. `'live'`는 fixture run을 돌려주지 않는다.
  - `bid_list_items`: org-01 `viewer`는 `BID1`의 `latest_run_id = RUN1`과 점수를 본다. `outsider`는 `BID1` 행을 보지만 `latest_run_id`·`latest_decision`이 null이다(security_invoker 확인). `deadline_at`이 지난 `OPEN` 공고는 `status='CLOSED'`다. `anon`은 select 권한 오류다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm test:db` — 새 묶음이 FAIL(함수·뷰 없음).
- [ ] **Step 3: 마이그레이션을 쓴다.** 머리 주석은 000010 형식(근거·이 파일에 든 것·바꾸지 않는 것·되돌리기)을 따른다. 근거로 04 §3.4·§3.6, 05 §1·§3, ADR-030 B14·B20을 적는다.
- [ ] **Step 4: 통과와 생성물을 확인한다.** `pnpm test:db` PASS → `pnpm db:types` → `pnpm check:db-types` PASS.
- [ ] **Step 5: 커밋한다.** `feat(db): C6 화면 읽기 보조 마이그레이션 추가`

### Task 2: 도메인 계약 보강 — 쿼리·커서·포트·서비스

**Files:**
- Modify: `web/server/bids/bid-query.ts`, `bid.model.ts`, `bids.repo.ts`, `bids.service.ts`, `review.service.ts`, `review.model.ts`, `notification.service.ts`, `index.ts`
- Test: `web/server/bids/bid-query.test.ts`, `bids.service.test.ts`, `review.service.test.ts`, `notification.service.test.ts`(기존 파일에 더한다)

**Interfaces:**
- Produces:
  - `bid.model.ts`: `isUuid(value: string): boolean`, `effectiveStatus(status: BidStatus, deadlineAt: string | null, now: Date): BidStatus`(B14, 뷰와 같은 규칙)
  - `BidListQuery`에 `status: BidStatus[]`(기본 `["OPEN","AMENDED"]`, 05 §3), `deadlineFrom: string | null`, `deadlineTo: string | null`(ISO8601 offset, `from <= to` 아니면 issue `path: "deadlineFrom"`)를 더한다. 지문에 셋 다 넣는다(O8).
  - `type CursorKind = "bids" | "analyses" | "notifications"`, `cursorScope(kind: CursorKind, parts: readonly unknown[]): string`. `fingerprintOf(query)`는 `cursorScope("bids", …)`다. `verifyCursor(cursor: string, fingerprint: string, secret: string)`로 바꾼다(알림 커서의 `scopeOf` 우회를 없앤다 — Task 9 minor).
  - `readCursorSecret(value: string | undefined): string | null` — trim 뒤 32자 미만이면 null(O9).
  - `type PageQuery = { cursor: string | null; limit: number }`. `parsePageQuery(raw: RawQuery)`, `parseNotificationQuery(raw: RawQuery)`(`unreadOnly`: `"true"`·`"false"`), `parseOriginQuery(raw: RawQuery, runMode: RunMode)`. 셋 다 `{ ok: true; value } | { ok: false; issues: QueryIssue[] }`를 돌려준다.
  - `bids.repo.ts` 포트:
    - `AnalysisInput`에 `companyProfileId: string`(O6)
    - `CreateRunResult = { created: RunRef } | { conflict: "ACTIVE_INPUT"; run: RunRef } | { conflict: "IDEMPOTENCY_KEY" }`
    - `BidsRepo`에 `bidExists(orgId, bidId): Promise<boolean>`, `getLatestScoredAnalysis(orgId, bidId): Promise<AnalysisView | null>`를 더한다. `listAnalyses(orgId, bidId, limit: number, after: ListAfter)`로 바꾼다.
    - `ReviewRepo`에 `listReviews(orgId, bidId): Promise<Review[] | null>`(공고 없음 = null)
    - `interface AnalysisRateLimiter { hit(orgId: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> }`
  - 서비스:
    - `type AnalysisDeps = { repo: BidsRepo; queue: AnalysisQueue; limiter: AnalysisRateLimiter; onQueueError: (error: unknown) => void }`, `requestAnalysis(ctx, bidId, input, idempotencyKey, deps: AnalysisDeps)`. 순서: 역할 403 → 키 UUID 검사 → 속도 제한 → 본문 → (A단계 순서 그대로).
    - `listBids(orgId, query, cursorSecret: string | null, deps)`, `listBidAnalyses(orgId: string, bidId: string, query: PageQuery, cursorSecret: string | null, deps: { repo: BidsRepo }): Promise<ServiceResult<Page<AnalysisView>>>`, `listNotifications(userId, query: PageQuery & { unreadOnly: boolean }, cursorSecret: string | null, deps)`. 비밀이 null이면 `503 SERVICE_UNAVAILABLE {component:"cursor"}`.
    - `getQualificationChecks(orgId, bidId, deps: { repo: BidsRepo }): Promise<ServiceResult<QualificationCheckView[]>>`. 공고 없음 `404 {resource:"bid"}`, 이 조직의 점수 run 없음 `404 {resource:"analysis"}`(11 G5).
    - `listReviews(orgId, bidId, deps: { repo: ReviewRepo }): Promise<ServiceResult<Review[]>>`. 다른 조직이면 `200 []`(G5).
  - `review.model.ts`: `reviewSchema.reviewer.role`을 `roleSchema.nullable()`로 넓힌다. 결정한 사람이 조직을 떠나면 역할을 알 수 없다(결정됨 6).

- [ ] **Step 1: 실패하는 시험을 더한다.**
  - `bid-query.test.ts`
    - `parseBidListQuery({}, "mock").value.status`가 `["OPEN","AMENDED"]`다. `status=CANCELLED&status=OPEN`은 그 두 값이다. `status=bogus`는 `path: "status"`다.
    - `deadlineFrom=2026-11-01T00:00:00Z&deadlineTo=2026-10-01T00:00:00Z`는 `path: "deadlineFrom"`이다.
    - `status`나 `deadlineTo`만 바꾼 쿼리로 검증한 커서는 `INVALID_CURSOR`다.
    - `cursorScope("notifications",[true]) !== cursorScope("analyses",[true])`다.
    - `readCursorSecret("a".repeat(31)) === null`, `readCursorSecret(" ".repeat(40)) === null`, 32자는 그대로다.
  - `bids.service.test.ts`(가짜 repo·queue·limiter)
    - 키 `"abc"`면 `400 VALIDATION_ERROR`이고 `details.issues[0].path === "Idempotency-Key"`이며 limiter가 불리지 않는다(O10).
    - limiter가 `{allowed:false, retryAfterSeconds:17}`이면 `429 RATE_LIMITED`이고 `details.retryAfterSeconds === 17`이며 repo가 불리지 않는다.
    - limiter가 던지면 `503 {component:"redis"}`다.
    - enqueue가 던지면 `onQueueError`가 그 오류로 1회 불리고 `markRunFailed(…, "ENQUEUE_FAILED")`가 1회 불린다(O12).
    - `createAnalysisRun`이 `{conflict:"IDEMPOTENCY_KEY"}`이고 `findIdempotency`가 null이면 `409 IDEMPOTENCY_KEY_REUSED`다(O5).
    - `findRunningAnalysis`·`findCompletedSameInput`이 받은 `input.companyProfileId`가 `resolveAnalysisInput`의 값과 같다(O6).
    - `listBids`에 `cursorSecret=null`이면 `503`이고 `details.component === "cursor"`다.
    - `getQualificationChecks`: `bidExists=false`면 `404 bid`, 점수 run이 없으면 `404 analysis`다.
  - `review.service.test.ts`: `listReviews`가 repo null이면 `404`, `[]`면 `200 []`이다.
  - `notification.service.test.ts`: unreadOnly true로 발급한 커서를 false로 검증하면 `INVALID_CURSOR`다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run server/bids` — FAIL.
- [ ] **Step 3: 구현한다.** A단계 시험 가운데 바뀐 시그니처(`verifyCursor`, `deps`, `listAnalyses`)를 쓰는 곳은 새 시그니처로 고친다. 단언은 약하게 만들지 않는다.
- [ ] **Step 4: 통과를 확인한다.** 같은 명령 PASS, `pnpm -C web type-check`·`pnpm -C web lodestar` PASS.
- [ ] **Step 5: 커밋한다.** `feat(web): 공고 쿼리·커서·분석 요청 계약 보강`

### Task 3: 저장 행 → 05 DTO 변환

**Files:**
- Create: `web/server/bids/analysis-row.mapper.ts`, `web/server/bids/bid-row.mapper.ts`
- Test: `web/server/bids/analysis-row.mapper.test.ts`, `web/server/bids/bid-row.mapper.test.ts`

**Interfaces:**
- Consumes: Task 1 생성 타입(`import type { Database } from "@/lib/database.types"`, 타입 전용), A단계 스키마.
- Produces:
  - `type AnalysisRows = { run: ScoreRunRow; revision: number; factors: ScoreFactorRow[]; checks: QualificationCheckRow[]; assessments: RequirementAssessmentRow[] }`. 행 타입은 `Database["public"]["Tables"][…]["Row"]`에서 고른다.
  - `toAnalysisViewFromRows(rows: AnalysisRows): AnalysisView` — 끝에서 `analysisViewSchema.parse`. 규칙:
    - 대문자 저장 값은 소문자 DTO로 옮긴다(`run_mode`, `ai_provider`).
    - `model.qwen`은 `qwen_model`이 없으면 null이다. 있으면 `promptHash: prompt_hash ?? ""`, `promptVersion`은 `model_metadata.promptVersion`이 문자열일 때 그 값, 아니면 `""`.
    - `model.kev`는 `kev_model`·`question_set_version`이 둘 다 있을 때만 만든다.
    - 점수 run(`COMPLETED`·`PARTIAL`)이 아니면 `qualification = { status: "NEEDS_REVIEW", checks: [] }`이고 점수·분해는 비운다.
    - 자격 종합 상태는 `qualificationStatusOf(checks: QualificationCheckView[], injectionSuspected: boolean): QualificationOutcome`(판단 6의 규칙)로 계산한다.
    - `scoreBreakdown`은 `factorKeySchema.options` 순서다. `points`·`max_points`·`normalized`는 `Number`로 바꾼다.
    - `missingFactors`는 `missing && missing_reason !== null`인 요소만 담는다(O13).
    - `kev`: `kev_assist`가 null이면 `{ enabled: false, …나머지 null, disclaimer: KEV_DISCLAIMER }`다. 있으면 `kevViewSchema.safeParse`로 읽고, 실패하면 같은 꺼짐 값을 쓰고 `console.error(JSON.stringify({ event: "kev_assist_invalid", scoreRunId }))`를 1회 남긴다(O13).
    - `evidence`는 자격 → 요소 → 항목 근거 순서로 모은다. `match === "FAILED"`는 빼고, `(documentId, page, charStart, charEnd, apiField, quotedText)`가 같으면 하나만 남긴다.
  - `toBidListItem(row: BidListItemRow): BidListItem` — `budgetKrw = budget_krw_text`, `origin = is_demo ? "demo" : "live"`, `latestAnalysis`는 `latest_run_id`가 null이면 null, `latestReview.reviewerName = nameOf(display_name, email)`(`@/server/shared`).
  - `toBidDetail(parts: BidDetailParts): BidDetail`. `BidDetailParts = { notice; revisions; latestRevisionBody: unknown; documents; structured; extraction: { id: string; status: string; result: unknown } | null; latestAnalysis: AnalysisView | null; reviews: Review[]; now: Date }`. `content`·`original`은 `latestRevisionBody`를 지역 zod `z.looseObject({ content: z.string(), original: bidOriginalSchema })`로 읽고, `status`는 `effectiveStatus`로 계산한다.
  - `toReview(row: ReviewRow): Review`(조직을 떠난 결정자는 `role: null`), `toNotification(row: NotificationRow): Notification | null` — `notificationSchema.safeParse`가 실패하면 null(O11).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `analysis-row.mapper.test.ts` — 행은 `fixtures/goldens/FX-01.json`·`FX-03.json`으로 만든다(A단계 `analysis-view.model.test.ts`의 경로 방식).
    - FX-01 행이면 `solScore === 94`이고 `scoreBreakdown.map(f => f.points)`가 골든과 같고 순서가 `factorKeySchema.options`다. `qualification.status === "SATISFIED"`다.
    - FX-03 행이면 `qualification.status === "NOT_SATISFIED"`다. `injection_suspected=true`면 `NEEDS_REVIEW`다.
    - `kev_assist=null` + `kev_model="jaredpalmer/kev-9b@v1.0"`이면 `kev.enabled === false`이고 `model.kev.model`이 그 값이다.
    - `kev_assist={bad:1}`이면 `kev.enabled === false`이고 `console.error`가 1회 불린다.
    - `missing=true, missing_reason=null`인 요소는 `missingFactors`에 없고 `scoreBreakdown` 행의 `missing === true`, `missingReason === null`이다.
    - `match:"FAILED"` 근거는 `evidence`에 없고, 같은 인용 두 개는 하나가 된다.
    - `status="QUEUED"` run은 `solScore === null`이고 `qualification`이 `{status:"NEEDS_REVIEW", checks:[]}`다.
  - `bid-row.mapper.test.ts`
    - `budget_krw_text: "1200000000"`이면 `budgetKrw === "1200000000"`(문자열)이다.
    - `is_demo=false`이면 `origin === "live"`이고, `docs_download_failed=1`이면 `documentsStatus.downloadFailed === 1`이다.
    - `latest_run_id=null`이면 `latestAnalysis === null`이고, `display_name=null`이면 reviewerName이 이메일 앞부분이다(`nameOf` 규칙).
    - `toNotification({ …, payload: {} })`과 모르는 `type`이면 null이다.
    - 마감이 지난 `OPEN` 상세는 `status === "CLOSED"`다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run server/bids/analysis-row.mapper.test.ts server/bids/bid-row.mapper.test.ts`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** 같은 명령과 `pnpm -C web lodestar`.
- [ ] **Step 4: 커밋한다.** `feat(web): 분석·공고 저장 행 변환 추가`

### Task 4: Supabase 저장소 구현

**Files:**
- Create: `web/server/bids/postgrest.ts`, `bids.supabase.ts`, `review.supabase.ts`, `notification.supabase.ts`, `dashboard.supabase.ts`
- Modify: `web/server/bids/index.ts`(아래 이름만 더한다)
- Test: `web/server/bids/postgrest.test.ts`, `bids.supabase.test.ts`, `review.supabase.test.ts`, `notification.supabase.test.ts`, `dashboard.supabase.test.ts`, `demo-flag.test.ts`(11 G8), `origin-filter.test.ts`(11 V2-02)

**Interfaces:**
- Consumes: Task 2 포트, Task 3 mapper, `getSupabase()`(`@/server/supabase`)
- Produces:
  - `postgrest.ts`: `quoteValue(value: string): string`(큰따옴표로 감싸고 `"`·`\`를 `\`로), `likePattern(q: string): string`(`\`·`%`·`_`를 escape한 뒤 `*q*`), `keysetFilter(column: string, direction: "asc" | "desc", after: CursorPayload): string`, `uniqueViolation(error: { code?: string; message?: string }): "ACTIVE_INPUT" | "IDEMPOTENCY_KEY" | null`(`23505` + 제약 이름 `score_runs_active_input_key`·`score_runs_idempotency_key_key`)
  - `createBidsRepo(config: { runMode: RunMode; algorithmVersion: string }): BidsRepo`, `reviewRepo: ReviewRepo`, `notificationRepo: NotificationRepo`, `createDashboardRepo(config: { aiStatus: () => Promise<DashboardSource["ai"]> }): DashboardRepo`

키셋 필터는 정렬 열마다 nulls last, 동률은 `id asc`다. 시그니처만으로 정해지지 않으므로 규칙을 고정한다.

```ts
// .or(keysetFilter(...)) 로 붙인다. c = column.
const q = quoteValue;
if (after.sortValue === null) return `and(${c}.is.null,id.gt.${q(after.id)})`;
const op = direction === "desc" ? "lt" : "gt";
const v = q(String(after.sortValue));
return `${c}.${op}.${v},and(${c}.eq.${v},id.gt.${q(after.id)}),${c}.is.null`;
```

정렬 열은 다음과 같다. `publishedAt:*` → `published_at`, `deadlineAt:*` → `deadline_at`, `score:desc` → `scored_score`, `budgetKrw:desc` → `budget_krw`. `limit + 1`행을 읽어 `hasNext`를 정한다.

저장소별 규칙:
- `listBids`(뷰 `bid_list_items`): `origin` → `is_demo`, `stage`·`status` → `in`, `q` → `or(title.ilike…,agency.ilike…,notice_id.ilike…)`, `deadlineFrom/To` → `gte/lte deadline_at`, `recommendation` → `scored_recommendation in`, `decision`의 `NONE` → `latest_decision.is.null`과 or.
- `createAnalysisRun`: insert 열은 `org_id, bid_id, revision_id, company_profile_id, profile_revision, extraction_id, algorithm_version, run_mode`(대문자)`, ai_provider`(`mock` → `MOCK`, 나머지 → `LOCAL`)`, idempotency_key, request_hash`다. `23505`는 `uniqueViolation`으로 바꾼다. `ACTIVE_INPUT`이면 `findRunningAnalysis`로 run을 다시 읽고, 그래도 없으면 던진다.
- `markRunFailed`: `errorCode !== "ENQUEUE_FAILED"`면 던진다. `rpc("release_unqueued_score_run", { p_score_run_id })`를 부르고, false면 `console.error` 1회만 남긴다.
- `findRunningAnalysis`·`findCompletedSameInput`: `revision_id`·`company_profile_id`·`algorithm_version`이 모두 같은 행을 찾는다. 앞쪽은 `status in (QUEUED,RUNNING)`, 뒤쪽은 `in (COMPLETED,PARTIAL)`이고 최신 1건이다(O7c).
- `resolveAnalysisInput`: 조직의 `company_profiles`(주어진 revision, 없으면 최신)와 공고 `latest_revision`의 revision을 읽는다. 추출은 그 revision에서 `status in (COMPLETED, PENDING_REVIEW)`인 최신 행이고, 없으면 null이다.
- `getBid`: `budget_krw::text`로 읽는다. revision·첨부·구조화 자격·추출·최신 run과 자식 표·결정을 `Promise.all`로 읽는다.
- `reviewRepo.createReview`: insert 열은 `org_id, bid_id, revision_id, score_run_id, assignee_id, decision, reason`뿐이다(`system_recommendation`·`disagreement_flag`는 BEFORE INSERT 트리거가 채운다, O2). 응답은 `returning` 행으로 만든다.
- `notificationRepo.markRead`: `.update({read_at}).eq("id").is("read_at", null)`. 0행이면 id로 다시 읽어 이미 읽은 행을 돌려주고, 없으면 null이다(감사 중복 방지).
- `list`: 행마다 `toNotification`을 쓰고 null은 빼고 `console.error({event:"notification_row_invalid", id})`를 남긴다.
- `dashboard.load`: `bid_notices`(origin 필터)에 `score_runs(id,status,recommendation,review_flags,created_at)`·`bid_reviews(decision,disagreement_flag,decided_at)`를 붙여 읽는다. 상태는 `effectiveStatus`로 바꾼다. 신선도는 `rpc("latest_ingest_run",{p_origin})`, 안 읽은 수는 `notifications` `count: "exact", head: true` + `read_at is null`, `ai`는 `config.aiStatus()`다.

- [ ] **Step 1: 실패하는 시험을 쓴다.** `vi.mock("@/server/supabase")`로 호출을 기록하는 가짜 클라이언트를 쓴다(체인 메서드를 `{method,args}` 배열로 남기고 정해 둔 응답을 준다).
  - `postgrest.test.ts`: `likePattern('a,b)"c%')`를 `quoteValue`로 감싼 값이 `"*a,b)\"c\\%*"`다. `uniqueViolation({code:"23505", message:'… "score_runs_active_input_key"'}) === "ACTIVE_INPUT"`, `code:"23503"`이면 null이다. `keysetFilter("scored_score","desc",{sortValue:null,id:"x",…})`가 `and(scored_score.is.null,id.gt."x")`다.
  - `bids.supabase.test.ts`
    - "q 예약 문자": `q="a,b)"`의 `or` 인자가 정확히 세 조건이다.
    - `createAnalysisRun`의 insert 열 집합이 위 목록과 같다.
    - 23505 메시지 두 가지가 `ACTIVE_INPUT`·`IDEMPOTENCY_KEY` conflict가 된다(O7a).
    - `findRunningAnalysis` 기록에 `eq revision_id`·`eq company_profile_id`·`eq algorithm_version`·`in status [QUEUED,RUNNING]`이 모두 있다(O7c).
    - `markRunFailed`가 `rpc("release_unqueued_score_run")`을 부른다(O4).
    - `score:desc`는 `order("scored_score",{ascending:false,nullsFirst:false})` 다음 `order("id",{ascending:true})`다.
  - `review.supabase.test.ts`: insert 열에 `system_recommendation`·`disagreement_flag`가 없다(O2).
  - `notification.supabase.test.ts`: payload `{}` 행이 섞인 3행 응답이면 `items.length === 2`이고 `console.error`가 1회다. `markRead`가 이미 읽은 행을 그대로 돌려준다.
  - `dashboard.supabase.test.ts`: `rpc("latest_ingest_run",{p_origin:"demo"})`가 불리고 `lastIngestSummary.created === 19`가 옮겨진다.
  - `demo-flag.test.ts`(G8): `origin=demo` 목록 응답의 모든 항목이 `isDemo === true`다.
  - `origin-filter.test.ts`(V2-02): `demo`→`eq is_demo true`, `live`→`eq is_demo false`, `all`→`is_demo` 조건 없음이다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run server/bids`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** 같은 명령, `pnpm -C web type-check`, `pnpm -C web lodestar`.
- [ ] **Step 4: 커밋한다.** `feat(web): 공고·분석·결정·알림 Supabase 저장소 추가`

### Task 5: app 층 연결 — 실행 모드, 큐 producer, 속도 제한, HTTP 도우미

**Files:**
- Create: `web/app/_lib/run-mode.ts`, `web/app/_lib/analysis-queue.ts`, `web/app/_lib/rate-limit.ts`, `web/app/_lib/work-deps.ts`
- Modify: `web/app/api/v1/_lib/http.ts`, `web/server/health/health.service.ts`·`index.ts`, `web/next.config.ts`, `scripts/check-env.mjs`, `web/.env.example`(`API_CURSOR_SECRET` 주석을 "목록 HMAC 커서(인력·공고·분석·알림)"로), `infra/env/demo.env.example`
- worker 선택 env 등록: C5-B가 읽는 `ANALYSIS_STALE_QUEUED_MS`(기본 600000)·`ANALYSIS_STALE_RUNNING_MS`(기본 600000)·`ANALYSIS_RECONCILE_INTERVAL_MS`(기본 60000)를 `web/.env.example`·`infra/env/demo.env.example`에 주석 처리한 선택 줄로 적는다. 값 범위는 `web/worker/analysis-reconcile.ts`(1~3600000 정수)다. 2f 종료 뒤 e8 배정이다. check-env 필수 키에는 넣지 않는다.
- Test: `web/app/_lib/analysis-queue.test.ts`, `web/app/_lib/rate-limit.test.ts`, `web/app/api/v1/_lib/http.test.ts`, `web/server/health/health.service.test.ts`(더함), `scripts/check-env.test.mjs`(더함)

**Interfaces:**
- Consumes: `readRunMode`, `ANALYSIS_QUEUE`, `ANALYSIS_JOB`, `ANALYSIS_JOB_OPTIONS`, `toAnalysisJobId`, `analysisJobDataSchema`(`@/server/analysis`), `ALGORITHM_VERSION`(`@/server/scoring`), `getMyBusinessAccess`(`@/server/organization`)
- Produces:
  - `currentRunMode(): RunMode` — `readRunMode(process.env).runMode`. 잘못된 값이면 던진다.
  - `createAnalysisQueue(options: { redisUrl: string | undefined; timeoutMs?: number; addJob?: (name: string, data: AnalysisJobData, opts: JobsOptions) => Promise<unknown> }): AnalysisQueue`. 기본 `timeoutMs` 3000. `addJob`이 없으면 lazily 만든 `new Queue(ANALYSIS_QUEUE, { connection: new IORedis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 }) })`의 `add`를 쓴다. `enqueue`는 `analysisJobDataSchema.parse` 뒤 `add(ANALYSIS_JOB, data, { ...ANALYSIS_JOB_OPTIONS, jobId: toAnalysisJobId(data) })`를 부른다. URL이 없으면 던진다.
  - `describeQueueError(error: unknown): string` — 메시지 안 `//사용자:비밀@`을 `//***@`로 바꾼다(09 비밀 로그 금지).
  - `createAnalysisRateLimiter(options: { redisUrl: string | undefined; limitPerMinute?: number; now?: () => number; counter?: (key: string, ttlSeconds: number) => Promise<number> }): AnalysisRateLimiter`. 기본 30. 키는 `rate:analysis:<orgId>:<floor(now/60000)>`, `retryAfterSeconds = 60 - floor((now % 60000) / 1000)`. 기본 `counter`는 ioredis `INCR`이고 첫 증가에 `EXPIRE 60`을 건다.
  - `type WorkDeps = { bids: BidsRepo; reviews: ReviewRepo; notifications: NotificationRepo; dashboard: DashboardRepo; queue: AnalysisQueue; limiter: AnalysisRateLimiter; cursorSecret: string | null; runMode: RunMode; onQueueError: (error: unknown) => void }`, `workDeps(): WorkDeps`. Redis 클라이언트는 프로세스에 하나다. env는 부를 때 읽는다(health 서비스 관례). `dashboard`의 `aiStatus`는 `getAiState()`를 `{ provider: 상태가 unavailable이면 runMode==="mock" ? "mock" : "local", 아니면 그 값; kevEnabled: process.env.KEV_ENABLED !== "false"; lastGatewayCheckAt: 지금 ISO; healthy: 상태 !== "unavailable" }`로 옮긴다. `onQueueError`는 `{event:"analysis_enqueue_failed", message: describeQueueError(e)}`를 남긴다.
  - `http.ts`:
    - `json(body: unknown, status = 200): Response`, `apiError(status, code, message, details = {}, headers: Record<string, string> = {})`.
    - `serviceResponse<T>(result: ServiceResult<T>): Response` — 429면 `Retry-After: String(details.retryAfterSeconds)`. 같은 파일이라 `ServiceErrorCode ⊂ ApiErrorCode`를 tsc가 검사한다(Ruling 2).
    - `requireBusinessUser(request: Request): Promise<{ ok: true; ctx: AnalysisContext } | { ok: false; response: Response }>` — `requireCompleteUser` 뒤 `getMyBusinessAccess()`. `no-org` → `403 FORBIDDEN {reason:"ORGANIZATION_REQUIRED", organizationStatePath:"/auth/organization-state"}`, `multiple-orgs` → `403 UNSUPPORTED_ACCOUNT_STATE`, `forbidden`·개인 조직·`userId` 불일치 → `403 FORBIDDEN`, `no-database` → `503 {component:"db"}`(people 서비스 매핑과 같다).
  - `health`: `getAiState(): Promise<AiState>` — AI 검사 하나만 같은 제한 시간으로 돈다.
  - `next.config.ts`: `serverExternalPackages: ["bullmq"]`(판단 5).
  - `check-env.mjs`: `WEB_REQUIRED`에 `API_CURSOR_SECRET`을 더한다. 32자 미만이면 `INVALID_FORMAT`이다(O9).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `analysis-queue.test.ts`
    - `addJob`이 `("analyze", {orgId, scoreRunId, idempotencyKey:`${orgId}:${uuid}`}, opts)`로 1회 불린다. `opts.jobId === "analysis_<orgId>_<scoreRunId>"`이고 `opts.attempts === 3`이다.
    - 접두어가 다른 키는 reject이고 `addJob`이 불리지 않는다.
    - `addJob`이 5초 걸리면 `timeoutMs: 50`에서 reject다. `redisUrl` undefined면 reject다.
    - `describeQueueError(new Error("connect redis://:pw123@h:6380"))`에 `pw123`이 없다.
  - `rate-limit.test.ts`: 31번째 `hit`이 `{allowed:false}`다. `now=60_000*5+43_000`이면 `retryAfterSeconds === 17`이다. 다음 분 첫 호출은 allowed다.
  - `http.test.ts`
    - `serviceResponse({ok:true,status:202,data:{a:1}})`가 202다.
    - 429 실패는 `Retry-After: 17` 헤더가 붙고 본문이 오류 봉투다. 봉투의 `requestId`가 `X-Request-Id`와 같다.
  - `health.service.test.ts`: `getAiState`가 AI 검사만 부른다(가짜 probes로 확인).
  - `check-env.test.mjs`: web에 `API_CURSOR_SECRET` 없음 → `MISSING_KEY`, 31자 → `INVALID_FORMAT`이다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run app/_lib app/api/v1/_lib server/health`, `node --test scripts/check-env.test.mjs`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** 이어서 `pnpm -C web build`가 성공해야 한다(bullmq 외부 패키지 확인).
- [ ] **Step 4: 커밋한다.** `feat(web): 분석 큐 producer·속도 제한·업무 연결 추가`

### Task 6: Route Handler 10개와 계약 시험

**Files:**
- Create:
  - `web/app/api/v1/bids/route.ts`(GET)
  - `web/app/api/v1/bids/[id]/route.ts`(GET)
  - `web/app/api/v1/bids/[id]/analyses/route.ts`(GET·POST)
  - `web/app/api/v1/analyses/[id]/route.ts`(GET)
  - `web/app/api/v1/bids/[id]/qualification-checks/route.ts`(GET)
  - `web/app/api/v1/bids/[id]/reviews/route.ts`(GET·POST)
  - `web/app/api/v1/dashboard/summary/route.ts`(GET)
  - `web/app/api/v1/notifications/route.ts`(GET)
  - `web/app/api/v1/notifications/[id]/read/route.ts`(PATCH, D8)
  - `/health/*`는 이미 있다(9번째).
- Create(시험 지원): `web/app/api/v1/_lib/fake-session.ts` — people `team-members/route.test.ts` 180~235행 방식의 SDK 전송 가짜(`getClaims`·`profiles`·`memberships`(+`sol_role`))
- Test: `web/app/api/v1/bids-contract.test.ts`, `web/app/api/v1/tenant-isolation.test.ts`(11 G5 Route Handler 겹)

**Interfaces:**
- Consumes: Task 2 서비스·파서, Task 5 `workDeps`·`requireBusinessUser`·`serviceResponse`·`currentRunMode`
- 모든 handler의 순서: `handleApiRequest` → `requireBusinessUser` → 경로 id `isUuid`(아니면 `404 NOT_FOUND {resource}`, repo 호출 없음) → 쿼리 파서(`400 VALIDATION_ERROR {issues}`) → 서비스 → `serviceResponse`.
- `POST analyses`는 `Idempotency-Key` 헤더(없으면 null)와 `request.json()`(본문이 비면 `{}`)을 넘긴다. `GET dashboard/summary`는 `getDashboardSummary(orgId, origin, { repo }, new Date())`를 `json`으로 준다.

- [ ] **Step 1: 실패하는 계약 시험을 쓴다.** `vi.mock("@supabase/ssr")`·`vi.mock("next/headers")`는 `fake-session.ts`로, `vi.mock("@/app/_lib/work-deps")`는 시험마다 가짜 repo·queue·limiter로 바꾼다.
  1. 세션 없이 `GET /bids`는 `401 UNAUTHENTICATED`다. 봉투 `requestId`가 `X-Request-Id`와 같다.
  2. 쿠키 세션 + `X-Requested-With` 없는 `POST analyses`·`POST reviews`·`PATCH read`는 `403 CSRF_REJECTED`다. Bearer는 헤더 없이 통과한다.
  3. VIEWER의 `POST analyses`와 ANALYST의 `POST reviews`는 `403 FORBIDDEN`이다.
  4. `Idempotency-Key: abc`는 `400`이고 `issues[0].path === "Idempotency-Key"`다.
  5. 정상 `POST analyses`는 `202`이고 본문이 `{analysisId, status:"QUEUED", deduplicated:false, pollUrl:"/api/v1/analyses/<id>"}`다.
  6. limiter 거절은 `429 RATE_LIMITED` + `Retry-After: 17`이다.
  7. queue가 던지면 `503`이고 `details.component === "queue"`다. `markRunFailed`·`onQueueError`가 불린다.
  8. `GET /bids?sort=bogus`는 `400`, 변조 커서는 `400 INVALID_CURSOR`, `cursorSecret=null`은 `503 {component:"cursor"}`다.
  9. `/bids/abc`·`/analyses/abc`·`/notifications/abc/read`는 `404`이고 repo 호출이 0회다.
  10. `POST reviews` 정상은 `201 Review`다. 사유 9자는 `400 path reason`, 조직 밖 담당자는 `404 {resource:"assignee"}`다.
  11. `GET /notifications?limit=5`의 링크 `https://evil.example`이 `/bids/<bidId>`로 바뀐다(O1). 본문 키가 `items`·`pageInfo{cursor,nextCursor,hasNext}`다(Task 8 minor). repo가 빈 payload 행을 빼고 2행을 주면 `items.length === 2`다.
  12. 남의 알림 `PATCH read`는 `404`다.
  13. 업무 조직 2개는 `403 UNSUPPORTED_ACCOUNT_STATE`, 0개는 `403 FORBIDDEN`이고 `details.reason === "ORGANIZATION_REQUIRED"`다.
  14. 각 route 모듈이 내보내는 메서드가 위 목록과 정확히 같다.
  15. repo가 `{code:"XX000", message:"private database details"}`를 던지면 `500 INTERNAL_ERROR`이고 본문에 `private`가 없다.
  - `tenant-isolation.test.ts`(G5): 가짜 repo는 orgId로 거른다. org-02 VIEWER 세션(`viewer@other.invalid`)으로 다음을 확인한다.
    - `GET /bids/{FX-01}/qualification-checks` → `404`
    - `GET /analyses/{org-01 run}` → `404`
    - `GET /bids/{FX-01}/reviews` → `200 []`
    - `GET /bids/{FX-01}` → `200`이고 `latestAnalysis === null`
    - 응답 본문 어디에도 org-01 run id가 없다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run app/api/v1`
- [ ] **Step 3: handler를 구현하고 PASS를 확인한다.** 이어서 `pnpm verify` exit 0.
- [ ] **Step 4: 커밋한다.** `feat(web): 공고·분석·결정·알림 Route Handler 추가`

---

### Task 7: 글자 범위 변형(B25·B26)과 앱 셸

**Files:**
- Modify: `design/tokens.json`, `scripts/tokens-gen.mjs`, `web/app/globals.css`(생성), `web/components/app-page.tsx`, `web/components/app-shell.tsx`, `web/components/topbar-status.tsx`
- Test: `scripts/tokens-gen.test.mjs`(새), `web/components/app-shell.browser.test.tsx`(더함), `web/components/app-page.browser.test.tsx`(새)

**Interfaces:**
- Produces:
  - `tokens.json` 새 키 `typographyScales`. 항목은 기존 `typography` 이름만 쓰고 `size`·`lineHeight`만 둔다(굵기·자간은 그대로, B25).
    - `dashboard`(B25): `title 33/39`, `heading 19/27`, `body 17/25`, `label 16/23`, `caption 15/19`
    - `sidebar`(B26, 결정됨 1): 같은 다섯 값
  - 생성 CSS: `@layer utilities { [data-type-scale="<이름>"] .type-<눈금> { font-size: <rem>; line-height: calc(<lh> / <size>); } }`. 기존 `@utility type-*`(0,1,0)보다 명시도(0,2,0)가 높다.
  - `tokens-gen.mjs` 검증: 범위 이름은 `^[a-z][a-z-]*$`, 눈금 이름은 `typography`에 있어야 하고, `size`·`lineHeight` 외 키는 거절한다(기존 메시지 형식).
  - `AppPage({ …, typeScale?: "dashboard" })` → `<main data-type-scale="dashboard">`
  - `export type TopbarStatusProps = Parameters<typeof TopbarStatus>[0]`. 334행 주석을 코드와 맞춘다(final minor).
  - `AppShell({ user, workspace, defaultSidebarOpen, status?: TopbarStatusProps, children })`
    - `NAV`는 `{ href, label, icon }` 네 줄이다: `/dashboard` 대시보드 `LayoutDashboardIcon`, `/bids` 입찰 공고 `FileTextIcon`, `/notifications` 알림 `BellIcon`, `/people` 조직·인력 `UsersIcon`(스펙 §8 해소법 "C6 3줄 + people"). 템플릿의 작업·설정 줄은 뺀다(D30).
    - 알림 줄 `SidebarMenuBadge`는 `useTopbarStore(s => s.summary?.unreadNotifications)`가 1 이상일 때만 숫자 + sr-only "건"을 보인다.
    - `<Sidebar data-type-scale="sidebar" …>`. people-read가 더한 `role`·`aria-label`·`SidebarFooter` 조직도 링크는 그대로 둔다.
    - `AppTopBar`: `status`가 있으면 오른쪽에 `<TopbarStatus {...status} />` 한 줄을 넣는다. `screen` 찾기는 `/org-chart` 특례 + `NAV.find(item => isCurrent(pathname, item.href))`다.
    - 1280 미만 안내(D25): Topbar 아래 `min-[1280px]:hidden` 한 줄 "데스크톱 화면에서 이용하세요"(`TriangleAlertIcon`, `text-warning`).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `tokens-gen.test.mjs`: 임시 사본으로 생성하면 CSS에 `[data-type-scale="dashboard"] .type-body`와 `font-size: 1.0625rem`이 있다. `typographyScales.dashboard.nope`는 exit 1이고 메시지에 `typographyScales.dashboard.nope`가 있다. `weight` 키는 거절한다.
  - `app-page.browser.test.tsx`: `typeScale="dashboard"` 안 `type-body`의 computed `font-size`는 `17px`, `type-title`은 `33px`다. 속성이 없으면 `14px`·`30px`다.
  - `app-shell.browser.test.tsx`
    - 주요 메뉴 링크가 순서대로 `/dashboard`·`/bids`·`/notifications`·`/people`다. `/bids/x`에서 "입찰 공고"가 `aria-current="page"`이고 Topbar 화면 이름이 "입찰 공고"다.
    - 사이드바 메뉴 글자 computed `font-size`가 `16px`이고, 본문 `type-label`은 `13px` 그대로다.
    - `status`를 주면 `[data-slot="topbar-status"]`가 1개다. 안 읽음 3이면 알림 줄에 `3`이 있다.
    - 1280px 폭에서 안내 줄이 보이지 않는다.
- [ ] **Step 2: 실패를 확인한다.** `node --test scripts/tokens-gen.test.mjs`, `pnpm -C web exec vitest run --config vitest.browser.config.ts components/app-shell.browser.test.tsx components/app-page.browser.test.tsx`
- [ ] **Step 3: 구현한다.** `pnpm tokens`로 `globals.css`를 만들고, 손으로 고치지 않는다.
- [ ] **Step 4: PASS를 확인한다.** 같은 명령, `pnpm check:tokens`, `pnpm -C web check:colors`.
- [ ] **Step 5: 커밋한다.** `feat(web): 대시보드·사이드바 글자 범위와 셸 메뉴 추가`

### Task 8: `(work)` 틀, `requireWork()`, 주소 정리

**Files:**
- Create: `web/app/(app)/(work)/layout.tsx`, `web/app/(app)/(work)/work.ts`, `web/app/_lib/work-data.ts`
- Delete: `web/app/(app)/dashboard/page.tsx`(D1 승인. 같은 URL을 두 경로가 가질 수 없다 — `route-groups.md`)
- Modify:
  - `web/app/auth/login/page.tsx:37`: 로그인 뒤 기본 이동을 `"/dashboard"`로(스펙 §2 흐름)
  - `web/app/auth/employment-routing.ts`의 `safeBusinessNext`: `/bids`, `/bids/<uuid>`, `/notifications`를 받는다
  - `scripts/check-env.mjs`: web `SOL_RUN_MODE`(없으면 `mock`)가 infra 모드와 다르면 `web/.env.local SOL_RUN_MODE CONTRADICTS_MODE`(D2)
  - `web/.env.example`: `SOL_RUN_MODE=mock` 줄과 주석
- Test: `web/app/(app)/(work)/work.test.ts`, `web/app/auth/employment-routing.test.ts`·`login/page.test.ts`(더함), `scripts/check-env.test.mjs`(더함)

**Interfaces:**
- Consumes: Task 5 `currentRunMode`·`workDeps`, `getMyBusinessAccess`·`getMyWorkspace`(organization), `getMyProfile`(profile), `completionPath`·`organizationStatePath`
- Produces:
  - `type WorkContext = { orgId: string; userId: string; role: SolRole; runMode: RunMode; org: CurrentOrg }`, `requireWork(next: string): Promise<WorkContext>`. 프로필 `signed-out`·`suspended` → `redirect("/auth/login")`, 가입 미완료 → `completionPath(next)`, `no-org`·`multiple-orgs`·`forbidden` → `organizationStatePath(next)`, `no-database` → 던진다(→ `error.tsx`).
  - `loadDashboardSummary = cache((orgId: string, origin: BidListOrigin) => getDashboardSummary(orgId, origin, { repo: workDeps().dashboard }, new Date()))`(layout과 page가 한 요청에서 나눠 쓴다)
  - `(work)/layout.tsx`: `connection()` → `PeopleReadLayout`과 같은 방식으로 셸 데이터를 읽는다 → `AppShell status={{ runMode, initialSummary, initialAi: null }}`. `initialSummary`는 `loadDashboardSummary`의 `dataFreshness`·`unreadNotifications`이고, 실패하면 null(셸은 남긴다). AI는 마운트 때 읽는다(스펙 §4.2 "확인 중"). layout은 화면 실행을 막지 못하므로 화면마다 `requireWork`를 다시 부른다(템플릿 `[slug]/layout.tsx` 주석).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `work.test.ts`(`vi.mock` organization·profile·`next/navigation`, people `layout.test.ts` 방식)
    - 로그아웃이면 `redirect("/auth/login")`이다.
    - 미완료면 `"/auth/complete-profile?next=%2Fbids%2F<uuid>"`이다.
    - 업무 조직 2개면 `"/auth/organization-state?next=%2Fnotifications"`이다.
    - SALES + `SOL_RUN_MODE=live`면 `{role:"SALES", runMode:"live"}`다.
  - `employment-routing.test.ts`: `safeBusinessNext("/bids/<uuid>")`는 그대로, `"/bids/../admin"`은 `"/dashboard"`다.
  - `login/page.test.ts`: 준비된 사용자는 `redirect("/dashboard")`다.
  - `check-env.test.mjs`: infra `fixture` + web `SOL_RUN_MODE` 없음이면 `CONTRADICTS_MODE`다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run "app/(app)/(work)/work.test.ts" app/auth`, `node --test scripts/check-env.test.mjs`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** 옛 파일 삭제 뒤 `pnpm -C web build`가 경로 충돌 없이 성공해야 한다.
- [ ] **Step 4: 커밋한다.** `feat(web): 업무 화면 틀과 접근 가드 추가`

### Task 9: `/dashboard`·`/bids` 화면

**Files:**
- Create:
  - `web/app/(app)/(work)/work-error.tsx`(공용 오류 부품)
  - `web/app/(app)/(work)/dashboard/page.tsx`·`loading.tsx`·`error.tsx`·`dashboard-queries.ts`·`dashboard-ai-banner.tsx`
  - `web/app/(app)/(work)/bids/page.tsx`·`loading.tsx`·`error.tsx`·`bid-list-more.tsx`
- Modify: `web/components/bids/bid-table.tsx`, `bid-filters.tsx`, `analysis-banner.tsx`
- Test: `web/app/(app)/(work)/dashboard/dashboard-queries.test.ts`, `web/app/(app)/(work)/work-error.browser.test.tsx`, `web/components/bids/bid-list.browser.test.tsx`(더함), `web/app/(app)/(work)/bids/bid-list-more.browser.test.tsx`

**Interfaces:**
- Consumes: Task 8 `requireWork`·`loadDashboardSummary`, `listBids`·`parseBidListQuery`, A단계 `StatCard`·`BidTable`·`BidFilters`
- Produces:
  - `WorkError({ error, retry, title }: { error: Error & { digest?: string }; retry: () => void; title: string })` — 제목 "불러오지 못했습니다", `error.message`, "오류 ID {digest}"(D-오류), [다시 시도] → `retry()`
  - `dashboardQueries(now: Date, runMode: RunMode): { bid: BidListQuery; deadline: BidListQuery }`
    - `bid` = `recommendation:["BID"]`, `sort:"score:desc"`, `limit:5`
    - `deadline` = `deadlineFrom: now`, `deadlineTo: now+7일`, `sort:"deadlineAt:asc"`, `limit:5`
    - 둘 다 실행 모드 기본 origin
  - `BidTable`: `now: Date`를 필수로 바꾼다(P1). `listQuery?: string`이면 제목 링크를 `/bids/{id}?list=<encodeURIComponent(listQuery)>`로 만든다. 첨부 경고 아이콘은 2줄 말줄임 상자 밖 형제로 둔다(P3).
  - `BidFilters`: "상태" `Select` — `진행 중 (기본)`(키 없음) / `취소 포함`(`status=OPEN&status=AMENDED&status=CANCELLED`). `FILTER_KEYS`에 `status`를 더한다(ADR-029 A7).
  - `analysis-banner.tsx`에서 `AiUnavailableNotice()`를 내보낸다(09 고정 PARTIAL 문장, warning 테두리, `role="status"`). `DashboardAiBanner`는 `useTopbarStore(s => s.ai) === "unavailable"`일 때만 그것을 그린다.
  - `BidListMore({ initialNextCursor: string | null, query: string, now: string })` — `GET /api/v1/bids?{query}&cursor=` 결과를 아래에 붙인다. `INVALID_CURSOR`면 "목록이 바뀌었습니다 · [처음부터 보기]", 그 밖은 "더 불러오지 못했습니다 · [다시 시도]"(스펙 §5.3).
  - `dashboard/page.tsx`: `AppPage typeScale="dashboard" contentClassName="max-w-360"`, 카드 5개(스펙 §5.2 표), 표 두 개(`compactKind`), 빈 상태 문구(§5.2 상태표). `bids/page.tsx`: `AppPage contentClassName="max-w-360"`, 결과 줄 `role="status"`, `aria-describedby` 숨은 DEMO 설명. 두 화면 모두 `now`를 서버에서 한 번 만들어 내린다.

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `dashboard-queries.test.ts`
    - `now=2026-10-19T00:00:00Z`면 `deadline.deadlineTo === "2026-10-26T00:00:00.000Z"`이고 `bid.recommendation`이 `["BID"]`다.
    - `runMode="live"`면 두 쿼리의 origin이 `"live"`다.
  - `work-error.browser.test.tsx`: `digest:"abc123"`이면 "오류 ID abc123"이 보이고, [다시 시도]를 누르면 `retry`가 1회 불린다.
  - `bid-list.browser.test.tsx`
    - "취소 포함"을 고르면 URL `status` 값이 세 개다. 기본으로 돌리면 `status` 키가 없다.
    - `status:"CANCELLED"` 행 단계 칸에 `취소됨`이 있다.
    - 첨부 경고 아이콘이 `line-clamp` 요소 밖에 있고 보인다.
    - `listQuery="sort=score%3Adesc"`면 링크가 `?list=sort%3Dscore%253Adesc`로 끝난다.
  - `bid-list-more.browser.test.tsx`
    - [더 보기]를 누르면 fetch URL에 `cursor=`가 있고 행이 늘어난다.
    - 응답이 400 `INVALID_CURSOR`면 "목록이 바뀌었습니다"가 보이고, [처음부터 보기]가 `/bids?{query}`로 간다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run "app/(app)/(work)/dashboard"`, 브라우저 시험 `pnpm -C web exec vitest run --config vitest.browser.config.ts components/bids "app/(app)/(work)"`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** `loading.tsx`는 스펙 §5.2·§5.3 skeleton(`role="status"` + "…불러오는 중", `motion-reduce:animate-none`)이다.
- [ ] **Step 4: 커밋한다.** `feat(web): 대시보드와 공고 목록 화면 연결`

### Task 10: `/bids/[id]` 상세

**Files:**
- Create: `web/app/(app)/(work)/bids/[id]/page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `bid-detail-view.tsx`, `use-analysis-run.ts`, `submit-review.ts`, `assessment-labels.ts`
- Modify: `web/components/bids/kev-opinion.tsx`(`notRecorded?: boolean`), `score-factors.tsx`(missing + 사유 null → "사유 기록 없음"), `labels.ts`(`kevRecordMissing`), `decision-panel.tsx`(역할 null이면 괄호 생략)
- 문구 변경(e8 판정, 2026-10-19): `KEV_UNAVAILABLE`은 이제 "Kev 미접속"과 "Kev 응답 형식 오류"를 둘 다 뜻한다(b3 분류 변경, 03 :595·:727). 그래서 플래그 라벨과 KevOpinion "Kev 미접속" 줄의 "Kev 서버 미접속"을 "Kev 사용 불가"로 바꾼다. `analysis-display.browser.test.tsx`에 단언을 더한다.
- Test: `use-analysis-run.browser.test.tsx`, `submit-review.test.ts`, `assessment-labels.test.ts`, `bid-detail-view.browser.test.tsx`(모두 같은 폴더), `web/components/bids/analysis-display.browser.test.tsx`(더함)

**Interfaces:**
- Consumes:
  - 서비스: `getBid`, `listBidAnalyses`, `canRequestAnalysis`, `canRecordReview`
  - organization: `getMembersPage({ org, userId })`(D6, `MemberView.userId`·`name`)
  - A단계 부품 전부와 `useEvidenceStore`, `refreshTopbarStatus`, `ruleReasonOf`
- Produces:
  - `page.tsx`
    - `requireWork(\`/bids/${id}\`)` 다음 `isUuid(id)`가 아니면 `notFound()`, `getBid` `404`도 `notFound()`, 그 밖의 실패는 던진다.
    - `?list=` 값이 `parseBidListQuery`를 통과할 때만 뒤로 링크를 `/bids?{list}`로 만들고, 아니면 `/bids`다.
    - `canAnalyze = canRequestAnalysis(role)`, `canDecide = canRecordReview(role)`를 boolean props로 넘긴다.
  - `kevRecordMissing(view: AnalysisView): boolean` = `!view.kev.enabled && view.model.kev !== null && !view.reviewFlags.some(f => f === "KEV_UNAVAILABLE" || f === "AI_UNAVAILABLE")`(판단 7)
  - `assessmentLabel(extraction: unknown, itemId: string): string` — `"requiredSkills[2]"` 같은 경로로 값을 찾는다. 값이 `{value}`면 `value`, 문자열이면 그대로, 못 찾으면 `itemId`를 쓴다(Task 5 minor "assessments label 호출부").
  - `type RunState = { phase: "idle" } | { phase: "requesting" } | { phase: "polling"; status: "QUEUED" | "RUNNING"; delayed: boolean } | { phase: "error"; code: string; message: string; requestId?: string }`, `useAnalysisRun(bidId: string): { state: RunState; start: (force: boolean) => Promise<void> }`
    - 클릭마다 `crypto.randomUUID()` 키를 만든다. 네트워크 오류는 같은 키로 1회만 다시 보낸다.
    - `202`면 `pollUrl`을 60초 동안 2초 간격, 그 뒤 5초 간격으로 읽고, 300초가 지나면 `delayed: true`로 멈춘다.
    - 종료(`COMPLETED`·`PARTIAL`·`FAILED`)면 `router.refresh()`. `PARTIAL`·`FAILED`면 `refreshTopbarStatus()`도 부른다.
    - `deduplicated` + 종료 상태면 토스트 "같은 입력으로 끝난 분석을 보여 줍니다"를 띄운다.
    - `409 ANALYSIS_IN_PROGRESS`면 `details.analysisId`를 polling한다. `401`·`403`·`404`면 멈추고 `error` 상태가 된다.
    - 진행 중에는 `start`를 무시한다. 언마운트하면 타이머를 지운다.
  - `submitReview(bidId: string, input: ReviewInputValues): Promise<SubmitResult>`
    - `POST`에 `X-Requested-With`를 붙인다. `201` → `{ok:true}`.
    - 오류 봉투 → `{ok:false, status, code, message, requestId}`. `VALIDATION_ERROR`의 첫 issue path가 `reason`이거나 `404 {resource:"assignee"}`면 `field`를 채운다.
  - `BidDetailView`(클라이언트)
    - 스펙 §5.4 순서로 A단계 부품을 놓는다.
    - `DecisionPanel key={analysis?.id ?? "none"}`(P2), `scoreRunId`는 직전 점수 run이다(§5.4.10).
    - `KevOpinion ruleReason={ruleReasonOf(analysis)} notRecorded={kevRecordMissing(analysis)} assessments={…assessmentLabel}`(P4)
    - polling 중에는 ④~⑦과 레일 위를 skeleton으로 바꾸고, 상태 전이를 `role="status" aria-live="polite"` 한 곳에서 읽는다.
    - `AnalysisBanner`에 `onReanalyze`(권한·취소 아님일 때만)와 `onRefresh`(`router.refresh`)를 넘기고, `delayed`는 `state.delayed`다(Ruling 8).
    - 분석 이력: `listBidAnalyses` 첫 쪽(limit 20)이 2건 이상이면 띠 안 `details` "분석 이력 N건"에 시각·상태·점수·권고·분석 실행 모드를 최신 위로 보인다(스펙 §5.4.2, 목록만).
    - 결정 성공 뒤 토스트 "결정을 기록했습니다" → `router.refresh()` → `refreshTopbarStatus()`를 지금 한 번, 5초 뒤 한 번 더 부른다(D5).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `use-analysis-run.browser.test.tsx`(가짜 타이머, `vi.stubGlobal("fetch")`)
    - `start(false)`의 POST 헤더에 `X-Requested-With: sol-radar`와 UUID 형식 키가 있고 본문이 `{"force":false}`다.
    - 첫 POST가 네트워크 오류이고 두 번째가 성공하면 두 요청의 키가 같다.
    - 진행 중에 `start`를 두 번 불러도 POST는 1회다.
    - 59초 동안 poll이 29~30회이고 이후 간격이 5초다. 300초 뒤 `delayed === true`이고 추가 fetch가 0회다.
    - `COMPLETED`면 `router.refresh`가 1회이고, `PARTIAL`이면 `refreshTopbarStatus`가 1회다.
    - poll이 `401`이면 멈추고 `state.code === "UNAUTHENTICATED"`다. 언마운트 뒤 fetch가 0회다.
  - `submit-review.test.ts`
    - `400 {issues:[{path:"reason"}]}` → `field === "reason"`
    - `404 {resource:"assignee"}` → `field === "assigneeUserId"`
    - `500` → `requestId`가 옮겨진다.
  - `assessment-labels.test.ts`: `{requiredSkills:[{value:"Java"},{value:"Spring"},{value:"Kotlin"}]}`과 `"requiredSkills[2]"`이면 `"Kotlin"`이다. 없는 경로면 그 경로 문자열이다.
  - `analysis-display.browser.test.tsx`: `KevOpinion notRecorded`는 "기록 없음"을 보이고 "사용 안 함"은 없다. missing + 사유 null 요소 행은 "사유 기록 없음"이다.
  - `bid-detail-view.browser.test.tsx`(1280·사이드바 펼침 주 영역 616px + 레일 320px)
    - FX-02 미분석이면 [분석 실행]이 default 버튼이고 결정 버튼은 outline이다.
    - VIEWER면 분석 버튼이 disabled이고 "분석 요청은 ADMIN·SALES·ANALYST 역할만 할 수 있습니다"가 보인다.
    - 취소 공고는 두 버튼이 disabled이다.
    - 가로 넘침이 0이다.
    - `analysis.id`를 바꿔 다시 그리면 라디오 기본값이 새 권고다(P2).
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run "app/(app)/(work)/bids/[id]"`, 같은 경로 브라우저 시험, `components/bids/analysis-display.browser.test.tsx`
- [ ] **Step 3: 구현하고 PASS를 확인한다.** `not-found.tsx`는 스펙 §3.5 문구 그대로("공고를 찾을 수 없습니다", "주소가 맞는지 확인하세요.", [공고 목록으로]).
- [ ] **Step 4: 커밋한다.** `feat(web): 공고 상세 화면과 분석 실행 연결`

### Task 11: `/notifications`

**Files:**
- Create: `web/app/(app)/(work)/notifications/page.tsx`, `loading.tsx`, `error.tsx`, `notification-list.tsx`
- Test: `web/app/(app)/(work)/notifications/notification-list.browser.test.tsx`

**Interfaces:**
- Consumes: `listNotifications`(서버가 `safeNotificationLink`를 이미 적용한다, O1), `NOTIFICATION_TYPE_LABEL`·`NOTIFICATION_ICON`, `formatRelative`
- Produces:
  - `page.tsx`: `?unread=1` → `unreadOnly: true`. 링크 줄 `전체 · 안 읽음`(`aria-current="page"`), `AppPage` 기본 폭.
  - `NotificationList({ items: Notification[]; nextCursor: string | null; unreadOnly: boolean; now: string })`
    - 행 전체가 링크다.
    - 안 읽은 행을 누르면 `fetch(\`/api/v1/notifications/${id}/read\`, { method: "PATCH", keepalive: true, headers: { "X-Requested-With": "sol-radar" } })`를 보내고 결과와 상관없이 `router.push(item.payload.link)`한다.
    - PATCH가 실패하면 토스트 "읽음으로 표시하지 못했습니다"를 띄운다.
    - [더 보기]는 Task 9 `BidListMore`와 같은 오류 처리다.

- [ ] **Step 1: 실패하는 브라우저 시험을 쓴다.**
  - 안 읽은 행을 누르면 PATCH가 1회이고 `init.keepalive === true`다. 그 뒤 `push("/bids/<id>")`다.
  - 읽은 행은 PATCH가 0회다.
  - PATCH가 500이어도 `push`가 불리고 토스트 글자가 보인다.
  - `items=[]`이고 `unreadOnly`면 "안 읽은 알림이 없습니다"와 "전체 보기" 링크다. 아니면 "알림이 없습니다. 공고가 바뀌면 여기에 표시됩니다"(06 원문)다.
  - 안 읽은 점에 sr-only "안 읽음"이 있다.
- [ ] **Step 2: 실패를 확인하고, 구현한 뒤 PASS를 확인한다.** `pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/notifications"`. 이어서 `pnpm verify` exit 0.
- [ ] **Step 3: 커밋한다.** `feat(web): 알림 화면과 읽음 처리 연결`

---

### Task 12 (B3): 로그인 뒤 E2E·axe·1440/1280 증거

**Files:**
- Create:
  - 설정: `web/playwright.work.config.ts`
  - 지원: `web/e2e-auth/support/work-setup.ts`(globalSetup), `web/e2e-auth/support/work-fixtures.ts`
  - 11 정본 이름: `web/e2e-auth/demo-badge.spec.ts`(G8), `run-mode-badge.spec.ts`(V2-02), `no-evidence.spec.ts`(G4), `bid-isolation.spec.ts`(G5)
  - 화면 상태·스크린샷: `web/e2e-auth/work-screens.spec.ts`
  - S3·S4 흐름: `web/e2e-auth/bid-decision.write.spec.ts`
- Modify: `web/package.json`(`"test:e2e:work": "playwright test -c playwright.work.config.ts"`), `web/playwright.auth.config.ts`(위 C6 spec을 `testIgnore`에 더한다. 그 설정은 템플릿 seed를 쓴다)
- Create(증거): `docs/evidence/phase-3/e2e/YYYYMMDD-phase3-<route>-<state>-<width>.png`, `docs/evidence/phase-3/axe-report.json`, `docs/evidence/phase-3/c6-b-test-report.txt`

**Interfaces:**
- Consumes: `readLocalStatus`(`support/local-status.ts`), `readInstalledAxeSource`(`support/people-fixtures.ts`), 데모 계정(`scripts/demo/plan.mjs` `DEMO_ACCOUNTS`: `sales@soltech.invalid`·`analyst@`·`viewer@`·`viewer@other.invalid`)
- Produces:
  - `work-setup.ts`
    - 로컬 Supabase 상태를 확인한다. 없으면 이유를 적고 실패한다(건너뛰지 않는다).
    - `pnpm demo:reset -- --env-file <로컬 status로 만든 임시 파일(scratch)>`를 돌린다.
    - `pnpm demo:preanalyze`(B22, C5-B `7d79e57`)로 사전 분석 18건을 만든다. 모드가 mock이 아니거나 gateway에 닿지 않으면 이유를 적고 실패한다.
    - sales에게 알림 2건(`REVIEW_ASSIGNED`, 링크 `https://evil.example` 1건)을 로컬 service role로 넣는다.
    - 역할별 storage state를 `e2e-auth/.auth/work-<role>.json`에 저장한다.
  - `work-fixtures.ts`: `assertNoAxe(page: Page, state: string): Promise<void>`(people `assertAxe` 방식, 위반을 `axe-report.json`에 모은다), `shot(page: Page, route: string, state: string, width: 1440 | 1280): Promise<void>`(06 §12 파일명)

- [ ] **Step 1: 환경을 준비한다.** e8이 로컬 DB 실행 창을 잡은 뒤에 돌린다(결정됨 3).
  - 로컬 Supabase: `pnpm db:start`
  - Compose `redis`·`ai-gateway`(mock)
  - host worker: `pnpm -C web worker`(로컬 env)
  - 웹: `pnpm -C web build`. 띄운 PID를 적어 두고 끝나면 그 PID만 끈다.
- [ ] **Step 2: spec을 쓴다.** 모든 화면 spec은 1440×900과 1280×800 두 폭에서 돈다.
  - `demo-badge.spec.ts`: `/bids` 모든 행에 `DEMO`가 있고 Topbar에 `DEMO`가 있다. 배지에 초점을 주면 09 툴팁이 보인다. 상세 제목 앞에도 `DEMO`가 있다. 스크린샷 `bids-list-demo-badge`.
  - `run-mode-badge.spec.ts`
    - Topbar `실행 모드: mock`과 `AI: mock`이 보인다.
    - FX-01 상세 띠에 `분석 실행 모드: mock`과 `가상 회사 프로필로 분석`이 보인다.
    - `/bids?origin=all` 출처 필터 값이 "전체"다.
  - `no-evidence.spec.ts`(FX-04)
    - 자격 `확인 필요`, 권고 `WATCH`가 보이고 09 고정 INSUFFICIENT_DATA 문장이 보인다.
    - `document.body.innerText`에 `/수주\s?확률(?![^.]*아)/`가 0건이다.
  - `bid-isolation.spec.ts`(org-02 VIEWER)
    - FX-01 상세가 200이고 "아직 분석하지 않았습니다"가 보이며 org-01 점수 94가 없다.
    - `request.get` `/api/v1/bids/{FX-01}/qualification-checks`가 404다. 응답을 `docs/evidence/phase-3/isolation-404.json`으로 저장한다(06 §12 S7).
  - `work-screens.spec.ts`
    - S2 값(11 #6~#9): 대시보드 BID 3, 분석 완료 18, 수집 `적재 19 · 격리 1`, BID 표 첫 세 행 FX-01 94·FX-18 82·FX-06 78.
    - 권고 `BID` + `점수 높은 순`이면 첫 세 행이 FX-01 94·FX-18 82·FX-06 78이다(19 S3 1번, 사용자 결정 2026-10-19 — 단계 `입찰공고` 필터가 아니다). 결정 `NO-BID` 필터면 FX-03이 보인다.
    - "취소 포함"을 고를 때만 취소 공고가 보인다.
    - 글자 크기: `/dashboard` h1 `33px`·본문 `17px`, `/bids` h1 `30px`, 사이드바 메뉴 `16px`.
    - 네 화면 모두 `document.documentElement.scrollWidth <= clientWidth`다.
    - 상태별 스크린샷과 axe를 남긴다: `dashboard-loaded`, `bids-list-loaded`, `bids-list-empty`(필터 0건), `bid-detail-loaded`(FX-01), `notifications-loaded`, `notifications-empty`(`?unread=1`을 다 읽은 뒤).
    - 알림 행 `https://evil.example`을 누르면 `/bids/…`로 간다.
    - "잘못된 공고 주소": `/bids/not-a-uuid`는 "공고를 찾을 수 없습니다"와 [공고 목록으로]를 보인다.
  - `bid-decision.write.spec.ts`(S4, sales)
    1. FX-02 `미분석` → [분석 실행]
    2. `대기 중`·`분석 중` 동안 스크린샷 `bid-detail-loading`. `page.route`로 poll 응답 하나를 2초 늦춘다.
    3. 10초 안에 완료 72, 분해 `15.0 / 18.3 / 14.0 / 15.0 / 10.0`, `사람 검토 권장`
    4. WATCH + 사유 + 담당자 = 나 → [결정 기록] → 토스트, 이력 +1, "마지막 결정: WATCH"
    5. 저장 실패 상태: `page.route`로 `POST reviews`에 `500` 봉투를 주면 `INTERNAL_ERROR`와 `requestId`가 보이고 입력이 남는다. 스크린샷 `bid-detail-error`.
- [ ] **Step 3: 실행한다.** `pnpm -C web test:e2e:work`가 PASS이고 `axe-report.json`의 위반 수 합이 0이다. 실패하면 원인을 고치고 단언은 약하게 만들지 않는다. 이미 있던 E2E 실패의 수리는 `e2e-healer` 몫이다.
- [ ] **Step 4: 전체 검증과 증거를 남긴다.**
  - `pnpm verify`, `pnpm test:db`, `pnpm -C web test:browser`, `pnpm -C web test:e2e:work`의 마지막 요약 줄과 시각을 `c6-b-test-report.txt`에 적는다.
  - 찍지 않은 상태(`partial`: S6·G6은 Phase 5)를 이유와 함께 적는다.
- [ ] **Step 5: 독립 검증을 받는다.** `security-auditor`(B1 diff: RLS·service role·CSRF·비밀 로그)와 `qa-web`(1440·1280)의 지적을 고친다.
- [ ] **Step 6: 커밋한다.** `test(web): C6 화면 E2E와 접근성 증거 추가`

---

## 의무 추적

| 장부 줄 | 의무 | Task · 시험 |
|---|---|---|
| 92 O1 | 알림 목록·서버 렌더가 `safeNotificationLink`를 거친 링크를 낸다 | 6 계약 11번, 11(서버 렌더는 `listNotifications` 경유), 12 `work-screens` evil 링크 |
| 102 O2 | 결정 insert는 `system_recommendation`·`disagreement_flag`를 쓰지 않는다(트리거) | 4 `review.supabase.test.ts` |
| 102 O3 | `requestHash` 저장 위치·키 보존 결정 | 1 `request_hash` 열 + DB 시험, 판단 2, 결정됨 5 |
| 103 O4 | `markRunFailed`는 `idempotency_key`를 null로 | 1 DB "release", 4 rpc 호출 시험 |
| 103 O5 | KEY 충돌 뒤 `findIdempotency` null → 409 재확인 | 2 `bids.service.test.ts` |
| 103 O6 | 중복 판정 입력의 프로필을 `company_profile_id`로 | 2 포트·서비스 시험, 4 필터 시험 |
| 106 O7 | repo 시험 (a) 23505 이름별 변환 (b) 키 해제 (c) 입력 전체 필터 | (a) 1 DB + 4 `postgrest`·`bids.supabase`, (b) 1 DB, (c) 4 `bids.supabase` |
| 117 O8 | `status`·`deadlineFrom`·`deadlineTo`(지문 포함) | 2 `bid-query.test.ts` |
| 117 O9 | 커서 비밀 길이 하한·env 등록 | 2 `readCursorSecret`, 5 `check-env`, 6 계약 8번 |
| 117 O10 | `Idempotency-Key` UUID 검증 | 2 서비스, 6 계약 4번 |
| 117 O11 | 알림 행 `notificationSchema` parse(빈 payload) | 3 `toNotification`, 4 `notification.supabase`, 6 계약 11번 |
| 117 O12 | 큐 실패 원인 `onError` 전달 | 2 `onQueueError`, 5 `describeQueueError`, 6 계약 7번 |
| 125 O13 | `kev_assist` zod 검증, 000010 이전 행 "기록 없음" | 3 mapper 시험, 10 `kevRecordMissing`·"사유 기록 없음" |
| 118 P1 | `BidTable` `now` 필수 | 9(타입 + 서버 `now` 전달) |
| 118 P2 | `DecisionPanel key={analysis?.id}` | 10 `bid-detail-view` 라디오 시험 |
| 118 P3 | 경고 아이콘 clamp 밖 | 9 `bid-list.browser.test.tsx` |
| 118·121 P4 | `ruleReason` 연결(`rule_path` 없음 → 자격 상태) | 10 `BidDetailView`, 판단 6 |
| 119 USER-DECISION | 목록 기본 상태·취소 공고 | 2 기본 `status`, 9 "취소 포함", 12 `work-screens`(ADR-029 A7) |
| 70 minor | 항목별 분포 라벨 호출부 | 10 `assessmentLabel` |
| 77·84 minor | `defaultValues` 갱신, `now` 하이드레이션 | P2·P1과 같다 |
| 94 minor | `Page<Notification>` 계약 확인 | 6 계약 11번 |
| 101 minor | `listAnalyses` 서비스, 알림 커서 kind | 2 `listBidAnalyses`·`cursorScope` |
| 126 minor | `topbar-status.tsx:334` 주석 | 7 |

## 결정됨

계획 초안의 "결정 필요" 6건이다. 사용자가 계획을 승인했다(2026-10-19). 1·6은 사용자가 고르고, 2는 정본 쪽에서 풀리고, 3~5는 e8 판정이다.

1. **사이드바 글자 크기(B26) — 사용자 결정 ①.** 실제 눈금에 +3px를 더한다. 메뉴 `type-label` 13→16px, caption 12→15px로 B25와 같은 규칙이다. ADR-030 B26·06 §4.1의 "14→17" 문구는 e8이 다음 정본 반영 묶음에서 "13→16"으로 고친다.
2. **E2E 사전 분석 — 풀림.** `pnpm demo:preanalyze`가 C5-B에 들어왔다(`c5/analysis-client` `7d79e57`, 병합 기준점 `fdfe050`). `work-setup.ts`는 이 명령을 쓴다. 필요 조건은 mock 모드와 닿는 gateway이고, 순서는 B22 "Compose → `demo:reset` → 모드 확인 → `demo:preanalyze`"다. service role로 `score_runs`를 직접 넣지 않는다.
3. **공유 로컬 Supabase — e8 판정 ①.** e8이 B3 실행 창을 잡는다. 실행 전에 병합 게이트(3e)와 다른 세션에 로컬 DB 사용 중지를 알리고, 끝나면 푼다.
4. **Topbar 지표 범위 — e8 판정 ①.** C6 네 화면(`(work)` 틀)에만 둔다. people 틀은 스펙 §0 범위 밖이라 그대로 둔다.
5. **멱등 키 보존 — e8 판정 ①.** 키는 행이 있는 동안 남기고(24시간 이상) 정리 job은 두지 않는다. 남은 키 + 다른 본문은 409다. 큐 등록 실패로 풀린 키는 다시 쓸 수 있다(새 run). 초안의 "풀린 키를 다시 쓰면 409"는 B20·Review Focus 3과 모순이라 고쳤다(Task 2 리뷰, 2026-10-19).
6. **조직을 떠난 결정자의 역할 — 사용자 결정 ①.** `Review.reviewer.role`을 nullable로 넓히고 화면에서 역할 괄호를 뺀다. 05 DTO 변경은 e8이 다음 정본 반영 묶음에 넣는다.

## 관련 문서

- [디자인 스펙 — C6](2026-10-19-c6-screens-design.md)
- [C6 A단계 계획](2026-10-19-c6-screens-plan.md)
- [[04-DATABASE|04 DB]] — `score_runs`·알림·수집 표 권한
- [[05-API-SPEC|05 API]] — Route Handler·DTO·오류 코드·멱등·속도 제한
- [[06-UI-UX|06 UI·UX]] — 화면 상태·§12 스크린샷 이름
- [[09-SECURITY|09 보안]] — CSRF·404·비밀 로그
- [[11-TESTING|11 테스트]] — G4·G5·G8·V2-02, Phase 3 수용 기준
- [[16-DECISIONS|16 ADR]] — ADR-029 A6·A7, ADR-030 B14·B20·B22·B23·B25·B26
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — S2~S4·S7
