---
title: "N6 입찰 프로젝트 구현 계획 (2026-10-21)"
doc: "plan-20261021-n6-bid-projects"
status: done
tags:
  - sol-radar
  - plan
updated: 2026-10-21
---

# N6 입찰 프로젝트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BID 결정 뒤의 입찰 업무(담당자·체크리스트·제출 마감·상태·결과 기록)를 `/projects` 보드와 상세 화면으로 만들고, 대시보드 슬롯 5 를 "진행 중 입찰 프로젝트"로 바꾼다.

**Architecture:** 새 표 `bid_projects`·`bid_project_events` 와 `tasks.bid_project_id` 를 새 마이그레이션 하나로 만든다. 상태·결과·열기는 security definer DB 함수 3개가 이력·감사와 한 트랜잭션에 쓰고, 담당자·마감 덮어쓰기만 열 권한 + RLS 로 직접 쓴다. 서버 도메인 `web/server/projects/` 가 읽기·검증·오류 변환을 맡고 Route Handler `/api/v1/projects*` 와 서버 컴포넌트가 같은 서비스를 부른다.

**Tech Stack:** Supabase Postgres(RLS·PGlite 시험), Next.js 16 Route Handler·서버 컴포넌트, zod, Vitest(단위·브라우저).

**Spec:** [N6 스펙](../../polaris/specs/done/2026-10-21-n6-bid-projects.md). UI 는 [N6 UI 스펙](2026-10-21-n6-bid-projects-ui-spec.md)(web-designer 작성 중).

## Global Constraints

- 브랜치 `feat/n6-bid-projects`, worktree `sol-radar-worktrees/n6-bid-projects`. 한 브랜치는 한 작업자.
- 마이그레이션은 새 파일 `supabase/migrations/20261022000300_bid_projects.sql` 하나. 기존 파일은 고치지 않는다. 같은 커밋에 `pnpm db:types`.
- `audit_logs_action_check` 값 목록은 N2(`20261021000300`, fa)의 11개 + `PROJECT_OPEN`·`PROJECT_STATUS_CHANGE`·`PROJECT_RESULT_RECORD` 14개로 다시 만든다(12 지시 2026-10-21).
- 새 표는 만들자마자 RLS 로 잠그고 정책 시험을 `scripts/database.test.mjs` 에 더한다.
- service role 키는 웹 서버에서 쓰지 않는다. 모든 읽기·쓰기는 사용자 세션(anon 키) + RLS.
- 조직 ID 는 요청에서 받지 않는다(M17). 다른 조직 자원은 404.
- 결과(`result`)는 점수·결정 모델·평가셋·학습셋에 쓰지 않는다(D4).
- 확률·승률·"수주 가능성" 문구 금지. 1280px 이상, 확인은 1440·1280.
- 핵심 컷 경로(`ingest_save_revision`·analysis job·`analyze()`·골든 94/72/68)와 `bid_reviews`·`GET /bids/:id` 계약을 바꾸지 않는다.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 훅·가드·린트에 막히면 우회하지 않고 멈춰 보고한다.
- 무거운 검증(`pnpm verify`·verify:quick·test:browser·e2e·build·`git commit`)은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 으로 감싼다.
- 작업자(서브에이전트)는 git 상태를 바꾸지 않는다. 커밋은 메인 세션(sol-radar-30)이 한다.
- freeze 2026-10-24 22:00 까지 green 이 아니면 사이드바 "준비 중" 그대로(ADR-042 조건 3).

## Review Focus

1. 같은 BID 결정으로 "만들기"를 두 번 누름(두 탭·두 사람) → 프로젝트는 1개, 두 번째는 409 `PROJECT_ALREADY_OPEN` 에 그 프로젝트 id. Task 1 시험 `open_bid_project 를 두 번 부르면 두 번째는 PROJECT_ALREADY_OPEN`.
2. 프로젝트를 연 뒤 WATCH·NO_BID 결정이 들어옴 → 상세에 경고, 앞으로 가기 409, 종료는 된다, 자동 종료 없음. Task 1·2 시험.
3. VIEWER·ANALYST 가 화면을 거치지 않고 `/rest/v1/tasks` 에 `bid_project_id` 행을 넣거나 고침 → RLS 거부, 같은 사람의 일반 작업은 그대로 된다. Task 1 시험.
4. 다른 조직의 프로젝트 id 로 GET·PATCH·결과 기록·체크리스트 추가 → 404, DB 행 불변. Task 1·2 시험.
5. 공고 마감이 없음(`deadline_at` null)·덮어쓰기를 지움(null) → 실효 마감 null, 화면은 "마감 미정". Task 2 시험 `effectiveDueAt`.

---

### Task 1: 마이그레이션과 DB 정책 시험

**Files:**
- Create: `supabase/migrations/20261022000300_bid_projects.sql`
- Modify: `web/lib/database.types.ts` (`pnpm db:types` 생성물)
- Modify: `scripts/database.test.mjs` (새 `describe("입찰 프로젝트 — bid_projects·bid_project_events·체크리스트 (P1 N6)")`)
- Modify: `scripts/db-verify.mjs` (`ALLOWED_DEFINER_FUNCTIONS` 에 3개 + 근거 주석. 기존 항목·검사는 그대로)
- Modify: `scripts/database.test.mjs` 의 "뷰·함수로 RLS 를 거치지 않는 길" 허용 목록 단언(새 함수 3개)과 "화면 역할의 위험한 표 권한" 단언이 새 표를 요구하면 그 목록

**Interfaces:**
- Produces (SQL):
  - 표 `public.bid_projects(id uuid pk, org_id uuid, bid_id uuid, opened_by_review_id uuid, status text, owner_id uuid null, submission_due_override timestamptz null, result text null, result_note text null, result_recorded_at timestamptz null, closed_at timestamptz null, created_by uuid default auth.uid(), created_at, updated_at)`. status check `PREPARING·SUBMITTED·AWAITING_RESULT·CLOSED`, result check `WON·LOST·CANCELLED·NOT_SUBMITTED`, `result_note` 1~2000자(trim), `(status='CLOSED') = (closed_at is not null)`.
  - 표 `public.bid_project_events(id, org_id, bid_project_id, actor_id null, from_status text null, to_status text, note text null(1~500자 trim), created_at)`.
  - 열 `public.tasks.bid_project_id uuid null`, FK `(bid_project_id, org_id) → bid_projects(id, org_id) on delete cascade`, 인덱스 `(org_id, bid_project_id)`.
  - `public.open_bid_project(p_review_id uuid) returns table(project_id uuid, reopened boolean)`
  - `public.change_bid_project_status(p_project_id uuid, p_to_status text, p_note text) returns void`
  - `public.record_bid_project_result(p_project_id uuid, p_result text, p_note text) returns void`
  - 함수 거절은 `raise exception '<CODE>' using errcode = 'P0001'`(메시지가 코드, `finish_score_run` 과 같은 방식). 코드: `NOT_FOUND`, `FORBIDDEN`, `PROJECT_REQUIRES_BID_DECISION`, `PROJECT_ALREADY_OPEN`(detail = 프로젝트 id), `LATEST_DECISION_NOT_BID`(detail = 최신 결정 값), `INVALID_PROJECT_TRANSITION`.
- 규칙:
  - FK: `bid_id` → `bid_notices(id) on delete cascade`(공고는 조직 공용이라 org_id 가 없다), `(opened_by_review_id, org_id)` → `bid_reviews(id, org_id)`(지금 `bid_reviews` 에 UNIQUE(id, org_id) 가 없으므로 이 마이그레이션이 `bid_reviews_id_org_id_key` 로 더한다. 결정 행은 화면에서 지워지지 않는다. 공고·조직이 지워질 때 함께 지워지도록 기본 `no action` 으로 둔다 — `restrict` 는 같은 문장의 cascade 를 막는다), `(org_id, owner_id)` → `memberships(org_id, user_id) on delete set null (owner_id)`, `(bid_project_id, org_id)` → `bid_projects(id, org_id)`.
  - 최신 결정 = 그 조직·그 공고의 `bid_reviews` 를 `decided_at desc, created_at desc, id desc` 로 본 첫 행.
  - 함수 안 권한: 대상이 `my_org_ids()` 조직이 아니면 `NOT_FOUND`, 그 조직의 `my_sol_org_ids(array['ADMIN','SALES'])` 가 아니면 `FORBIDDEN`. `search_path = ''`. `revoke execute ... from public, anon` 뒤 `grant execute ... to authenticated`.
  - 열기: 결정이 BID 가 아니거나 최신 결정이 아니면 `PROJECT_REQUIRES_BID_DECISION`. 프로젝트 없음 → `PREPARING` 으로 insert(`owner_id = auth.uid()`), 이력 `null→PREPARING`, 감사 `PROJECT_OPEN`, `reopened=false`. `CLOSED` 프로젝트가 있고 결정의 `decided_at > closed_at` → `PREPARING`·`opened_by_review_id` 갱신·`closed_at`·`result`·`result_note`·`result_recorded_at` 비움, 이력 `CLOSED→PREPARING`, 감사 `PROJECT_OPEN`(before 에 이전 값), `reopened=true`. `CLOSED` 인데 결정이 종료 전 → `PROJECT_REQUIRES_BID_DECISION`. 열린 프로젝트 있음 → `PROJECT_ALREADY_OPEN`.
  - 상태 전이(행을 `for update` 로 잠근다): 앞으로 한 칸(`PREPARING→SUBMITTED→AWAITING_RESULT→CLOSED`)은 최신 결정이 BID 일 때만(아니면 `LATEST_DECISION_NOT_BID`). 뒤로 한 칸(`SUBMITTED→PREPARING`, `AWAITING_RESULT→SUBMITTED`)과 열린 상태→`CLOSED` 는 결정 검사 없음. 그 밖(같은 상태·두 칸·`CLOSED` 에서 나가기)은 `INVALID_PROJECT_TRANSITION`. `CLOSED` 로 가면 `closed_at = now()`. 이력 1행 + 감사 `PROJECT_STATUS_CHANGE` 1행.
  - 결과: 어느 상태에서나 기록·덮어쓰기. `result_recorded_at = now()`. 상태 불변. 감사 `PROJECT_RESULT_RECORD`(before·after 에 result·note).
  - 감사 행: `target_type = 'bid_project'`, `target_id = 프로젝트 id`, `actor_id = auth.uid()`, `request_id = public.audit_request_id()`, `before_after` 는 REVIEW_DECIDE 트리거와 같은 `{"before":…,"after":…}` 꼴.
  - `updated_at` 은 update 트리거가 채운다.
  - 권한: 세 표 `revoke all ... from anon, authenticated, public`. `bid_projects`·`bid_project_events` 는 `grant select to authenticated` + 정책 "조직 전원 읽기". `bid_projects` 는 `grant update (owner_id, submission_due_override)` + update 정책 `org_id in (select public.my_sol_org_ids(array['ADMIN','SALES']))`(using·with check). insert·delete 권한 없음.
  - `tasks`: `grant insert (org_id, title, description, status, due_date, assignee_id, bid_project_id)` 로 다시 연다(update 열 목록은 그대로라 `bid_project_id` 는 못 바꾼다). restrictive 정책 3개(insert with check / update using·with check / delete using): `bid_project_id is null or org_id in (select public.my_sol_org_ids(array['ADMIN','SALES']))`.

- [ ] **Step 1: 실패하는 정책 시험을 쓴다** — 새 `describe` 안에 아래 `it` 를 쓴다(이름 그대로).
  - `BID 최신 결정이면 SALES 가 열고 PREPARING·이력 1행·감사 PROJECT_OPEN 1행이 생긴다`
  - `WATCH·NO_BID 결정이나 최신이 아닌 BID 결정이면 PROJECT_REQUIRES_BID_DECISION 이고 행이 없다`
  - `open_bid_project 를 두 번 부르면 두 번째는 PROJECT_ALREADY_OPEN 이고 프로젝트는 1개다`
  - `VIEWER·ANALYST 는 열기·상태·결과 함수가 FORBIDDEN 이고 bid_projects 를 직접 insert·update 하지 못한다`
  - `다른 조직 사용자는 프로젝트·이력을 0행으로 보고 함수는 NOT_FOUND 다`
  - `앞으로 한 칸은 최신 결정이 BID 일 때만, 아니면 LATEST_DECISION_NOT_BID 이고 상태가 그대로다`
  - `최신 결정이 NO_BID 여도 CLOSED 로 바꿀 수 있고 closed_at 이 채워진다(자동 종료 없음: 결정만 넣으면 상태 그대로)`
  - `같은 상태·두 칸 건너뛰기·CLOSED 에서 PATCH 로 나가기는 INVALID_PROJECT_TRANSITION`
  - `종료 뒤 새 BID 결정으로 열면 같은 프로젝트가 PREPARING 으로 다시 열리고 result 가 비며 이전 값은 감사 before 에 있다`
  - `종료 전에 내린 BID 결정으로 다시 열면 PROJECT_REQUIRES_BID_DECISION`
  - `결과 기록은 상태를 바꾸지 않고 덮어쓰면 감사 PROJECT_RESULT_RECORD 가 2행이다`
  - `SALES 는 owner_id·submission_due_override 를 바꾸고 status·result 열은 직접 바꾸지 못한다`
  - `owner_id 에 다른 조직 사람을 넣으면 FK 가 거절하고, 멤버십이 지워지면 owner_id 만 비운다`
  - `체크리스트: SALES·ADMIN 은 bid_project_id 행을 넣고 고치고 지운다. VIEWER·ANALYST 는 못 하고 같은 사람의 일반 tasks 는 된다`
  - `tasks.bid_project_id 는 update 로 바꾸지 못하고, 다른 조직 프로젝트 id 로 넣으면 FK 가 거절한다`
  - `audit_logs_action_check 는 USER_ROLE_CHANGE 와 PROJECT_OPEN·PROJECT_STATUS_CHANGE·PROJECT_RESULT_RECORD 를 모두 받는다`
  - `화면 역할은 bid_project_events·audit_logs 에 직접 insert 하지 못한다`
- [ ] **Step 2: 실패를 확인한다** — `node --test --test-name-pattern "입찰 프로젝트" scripts/database.test.mjs` → 표·함수가 없어 FAIL.
- [ ] **Step 3: 마이그레이션을 쓴다** — 위 Interfaces 규칙대로. 머리 주석에 근거(설계 §2.5·04 §3.8·M9·M12·M13·D3·D4·D12)·들어 있는 것·되돌리기(새 마이그레이션으로 drop)를 쓴다. `db-verify.mjs` 허용 목록에 세 함수 시그니처를 근거 주석과 함께 더한다(`release_unqueued_score_run` 항목과 같은 형식: 왜 definer 인지, 누가 실행하는지, 바꾸는 행이 무엇인지).
- [ ] **Step 4: 통과를 확인한다** — `node --test --test-name-pattern "입찰 프로젝트|RLS 를 거치지|위험한 표 권한|마이그레이션 재실행" scripts/database.test.mjs` → PASS. 이어서 `pnpm db:types` 로 `web/lib/database.types.ts` 를 만든다.
- [ ] **Step 5: 변형 확인** — restrictive 정책 하나를 지우면 체크리스트 시험이, 함수의 최신 결정 검사를 지우면 `LATEST_DECISION_NOT_BID` 시험이 실패하는지 본 뒤 되돌린다.
- [ ] **Step 6: 커밋** — `feat(db): N6 입찰 프로젝트 표·함수·정책` (마이그레이션·타입·시험·db-verify).

### Task 2: 서버 도메인 `web/server/projects` 와 API

**Files:**
- Create: `web/server/projects/project.model.ts` (zod 스키마·타입·순수 함수), `project.model.test.ts`
- Create: `web/server/projects/project.repo.ts` (저장 인터페이스), `project.supabase.ts` (구현), `project.supabase.test.ts`
- Create: `web/server/projects/project.service.ts`, `project.service.test.ts`
- Create: `web/server/projects/index.ts` (배럴, `import "server-only"`)
- Create: `web/server/bids/review-pending.ts`, `review-pending.test.ts` (검토 대기 공고 계산. `bids/index.ts` 에 한 줄 export — 93 과 겹치는 파일이라 줄 단위로 알린다)
- Create: `web/app/api/v1/projects/route.ts`, `web/app/api/v1/projects/[id]/route.ts`, `web/app/api/v1/projects/[id]/result/route.ts`, 각 `route.test.ts`
- Modify: `web/app/_lib/work-deps.ts` (`projects: ProjectRepo` 추가), `web/app/api/v1/_lib/work-route.ts` (`PathResource` 에 `"project"`)
- Create: `web/server/projects/isolation.test.ts` (D4 구조 시험)

**Interfaces:**
- Consumes: Task 1 의 표·함수, `AnalysisContext`(`@/server/bids`: `{orgId, userId, role}`), `ServiceResult<T>`·`fail`(bids 서비스와 같은 봉투), `DashboardRepo`(`@/server/bids`).
- Produces (배럴 `@/server/projects`): **화면용 꼴은 [UI 스펙](2026-10-21-n6-bid-projects-ui-spec.md) §4.0 을 이름까지 그대로 쓴다**(`ProjectStatus`·`ProjectResult`·`PendingBidCard`·`ProjectCard`·`ProjectBoard`·`ProjectDetail`). 서버 모델이 실효 마감·경고 셋(`latestDecision`·`bidAmended`·`bidCancelled`)·`reopenAvailable`·칸 안 순서(UI 스펙 U18)를 정하고 화면은 계산하지 않는다. 경고는 열린 프로젝트에만 채운다(U13, 종료면 `latestDecision:null`·`bidAmended:false`·`bidCancelled:false`). `ProjectDetail.checklist` 는 Task 3 의 `TaskView[]`(만든 순). `ProjectDetail.events` 는 새것부터. 사람 이름이 없으면(떠난 사람) 표시 이름 규칙은 기존 결정 읽기와 같다.
  - 입력 스키마: `createProjectInputSchema = z.strictObject({reviewId: uuid})`, `projectPatchSchema = z.strictObject({status?, note?(trim 1~500, status 와 함께만), ownerId?: uuid|null, submissionDueOverride?: ISO 시각|null})` 빈 객체 거절, `projectResultInputSchema = z.strictObject({result, note?(trim 1~2000)})`
  - 순수 함수: `effectiveDueAt(bidDeadlineAt: string|null, override: string|null): string|null`, `nextStatuses(status): {forward: ProjectStatus|null, back: ProjectStatus|null, canClose: boolean}`, `warningsOf(input:{status, latestDecision, openedRevisionId, latestRevisionId, bidStatus}): ProjectCard["warnings"]`, `canManageProjects(role): boolean`(ADMIN·SALES)
  - 서비스(모두 `Promise<ServiceResult<…>>`): `getProjectBoard(ctx, deps:{repo, dashboard, origin})`, `getProject(ctx, id, deps)`, `openProject(ctx, input, deps)`(201 새로·200 다시 열기, 본문은 `ProjectDetail`), `updateProject(ctx, id, input, deps)`, `recordProjectResult(ctx, id, input, deps)`, `getProjectEntry(ctx, bidId, deps): ProjectEntryState`(Task 4 가 쓴다. 꼴은 UI 스펙 §4.3.2 표의 상태를 그대로: 만들기·보기·다시 열기·숨김과 그 판단에 쓴 최신 결정 id), `countActiveProjects(orgId, deps): number`(Task 5 가 쓴다)
  - DB 오류 → 응답: `NOT_FOUND`→404, `FORBIDDEN`→403 `{required:["ADMIN","SALES"]}`, `PROJECT_REQUIRES_BID_DECISION`→409 `{reviewId}`, `PROJECT_ALREADY_OPEN`→409 `{projectId}`, `LATEST_DECISION_NOT_BID`→409 `{bidId, latestDecision}`, `INVALID_PROJECT_TRANSITION`→409 `{from, to}`, FK 위반(담당자 다른 조직)→404 `{resource:"owner"}`. 그 밖은 던진다(500 봉투).
  - `reviewPendingBids(source): PendingBidCard[]` (`web/server/bids/review-pending.ts`, 배럴 export) — 대시보드 `reviews.pending` 과 같은 정의(공고별 끝난 최신 분석이 COMPLETED·PARTIAL 이고 결정 없음), 순서는 UI 스펙 U18. 칸 안 접기(6장 뒤 `<details>`)는 화면이 한다(U3).

- [ ] **Step 1: 실패하는 시험을 쓴다**
  - `project.model.test.ts`: `effectiveDueAt` (null·null→null, 공고값만, override 우선), `nextStatuses` 네 상태 표, `warningsOf`(최신 WATCH → `LATEST_DECISION_NOT_BID`, revision 다름 → `NOTICE_REVISED`, 둘 다), 입력 스키마(빈 PATCH 거절, note 만 거절, 알 수 없는 키 거절, 조직 id 키 거절).
  - `review-pending.test.ts`: `같은 원본이면 total 이 getDashboardSummary 의 reviews.pending 과 같다`, 진행 중 분석만 있는 공고 제외, FAILED 최신 제외, 결정 있는 공고 제외.
  - `project.service.test.ts`(가짜 repo): VIEWER `openProject` 403 이고 repo 를 부르지 않는다, 잘못된 본문 400, DB 코드별 응답 변환 6개, `getProject` 다른 조직 404, `canManage` 는 역할로.
  - `project.supabase.test.ts`: 질의가 `.eq("org_id", …)` 로 거르고 RPC 이름·인자가 Task 1 과 같다, 체크리스트 진행 수 계산.
  - `route.test.ts` 3개: 401, CSRF 헤더 없는 POST·PATCH 403 `CSRF_REJECTED`, UUID 아닌 id 404 `{resource:"project"}`, 16KB 넘는 본문 400, 정상 201·200.
  - `isolation.test.ts`: `web/server/scoring`·`web/server/analysis`·`web/worker`·`services/` 의 소스 파일에 `bid_projects`·`@/server/projects` 문자열이 없다(D4).
- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/projects server/bids/review-pending.test.ts app/api/v1/projects` → FAIL.
- [ ] **Step 3: 구현** — 견본은 `web/server/bids/review.*`·`app/api/v1/bids/[id]/reviews/route.ts`. 읽기는 RLS 연결 하나로 프로젝트·공고·결정·이력·체크리스트를 읽는다. 사람 이름은 기존 결정 읽기와 같은 `profiles` 조인 규칙(표시 이름, 없으면 이메일 @ 앞, 떠난 사람은 null). 상태 변경과 담당자·마감 변경이 한 PATCH 에 같이 오면 상태 함수를 먼저 부르고 성공한 뒤 update 한다.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. `pnpm -C web exec tsc --noEmit` 오류 0, `pnpm -C web lint` 0.
- [ ] **Step 5: 변형 확인** — `canManageProjects` 를 항상 true 로 바꾸면 403 시험이, `isolation.test.ts` 대상에 `bid_projects` 를 한 줄 넣으면 구조 시험이 실패하는지 본다.
- [ ] **Step 6: 커밋** — `feat(web): N6 입찰 프로젝트 서버·API`.

### Task 3: 체크리스트(작업 재사용)

**Files:**
- Modify: `web/server/task/task.model.ts`·`task.repo.ts`·`task.service.ts`·`index.ts` (프로젝트 체크리스트 함수 추가. 기존 함수 시그니처는 그대로)
- Modify: `web/server/task/task.service.test.ts`·`task.model.test.ts`
- Create: `web/app/(app)/(work)/projects/[id]/checklist-actions.ts` (server action)

**Interfaces:**
- Consumes: Task 1 `tasks.bid_project_id`, 템플릿 `parseNewTask`·`changeTaskStatus`·`deleteTask`·`updateTask`.
- Produces: `listProjectChecklist(scope: TaskScope, projectId: string): Promise<ChecklistItem[]>`(생성 순), `addProjectChecklistItem(scope: TaskScope, projectId: string, form: FormData): Promise<AddTaskResult>`. 완료 토글·삭제·고치기는 기존 `changeTaskStatus`·`deleteTask`·`updateTask` 를 그대로 쓴다(권한은 restrictive 정책).
- server action: `addChecklistItemAction(projectId, form)`, `toggleChecklistItemAction(taskId, done)`, `deleteChecklistItemAction(taskId)` — 끝나면 `revalidatePath("/projects/" + projectId)`. RLS 거부는 "체크리스트를 고칠 권한이 없습니다" 결과로 돌린다(던지지 않는다).

- [ ] **Step 1: 실패 시험** — `addProjectChecklistItem 은 insert 에 bid_project_id 를 넣는다`, `listProjectChecklist 는 그 프로젝트 행만 읽는다`, `RLS 거부(42501)는 권한 없음 결과다`, 기존 `getTaskList` 시험은 그대로 통과.
- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/task` → 새 시험 FAIL.
- [ ] **Step 3: 구현** — 템플릿 검증(`parseNewTask`)을 그대로 쓰고 `bid_project_id` 만 더한다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 기존 시험 전부 PASS.
- [ ] **Step 5: 커밋** — `feat(web): N6 체크리스트를 작업으로 재사용`.

### Task 4: 화면 `/projects`·`/projects/[id]`·공고 상세 버튼·사이드바

**Files:** (최종 목록은 UI 스펙을 따른다)
- Create: `web/app/(app)/(work)/projects/page.tsx`·`loading.tsx`·`error.tsx`·`project-board.tsx`·`project-board.browser.test.tsx`
- Create: `web/app/(app)/(work)/projects/[id]/page.tsx`·`not-found.tsx`·`project-detail-view.tsx`·`project-detail-view.browser.test.tsx`·`project-actions.ts`(Route Handler 호출, `X-Requested-With`)
- Create: `web/components/projects/bid-project-entry.tsx`·`bid-project-entry.browser.test.tsx` (공고 상세의 만들기·보기·다시 열기 부품)
- Modify: `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx` (슬롯 prop `projectEntry` 하나, 추가 4줄), `web/app/(app)/(work)/bids/[id]/page.tsx` (`getProjectEntry` 읽기, 실패해도 상세는 그린다)
- Modify: `web/components/app-nav.ts` (`/projects` `status: "released"`), 그 시험
- Create: `docs/evidence/p1-n6/*.png` (1440·1280)

**Interfaces:**
- Consumes: Task 2 배럴(`getProjectBoard`·`getProject`·`getProjectEntry`·타입), Task 3 server action, UI 스펙.
- Produces: 화면. 공고 상세는 슬롯 prop `projectEntry?: React.ReactNode` 하나(UI 스펙 U14, 추가 4줄).

- [ ] **Step 1: 실패하는 브라우저 시험** — UI 스펙 "브라우저 시험이 단언할 항목"을 그대로 시험 이름으로 옮긴다. 최소: 보드 5열 순서, 검토 대기 카드 링크가 `/bids/<id>`, 경고 배지 2종, VIEWER 는 쓰기 버튼 없음, 앞으로 가기 버튼이 경고 때 비활성, 409 응답 문구, 결과 기록 뒤 새로고침, 공고 상세의 만들기·보기·다시 열기 세 상태.
- [ ] **Step 2: 실패 확인** — `bash <slot> pnpm -C web exec vitest run --project browser "app/(app)/(work)/projects" components/projects` → FAIL.
- [ ] **Step 3: 구현** — UI 스펙대로. 서버 컴포넌트는 `requireWork("/projects")` 뒤 서비스 호출, 404 는 `notFound()`.
- [ ] **Step 4: 통과 확인 + 스크린샷** — 같은 명령 PASS. 브라우저 시험에서 1440·1280 스크린샷을 `web/test-results/` 에 찍어 `docs/evidence/p1-n6/` 로 복사한다(Vitest 는 `web/` 밖에 못 쓴다).
- [ ] **Step 5: 커밋** — `feat(web): N6 입찰 프로젝트 화면`.

### Task 5: 대시보드 슬롯 5 교체 (N9 main 병합 뒤)

**Files:**
- Modify: `web/app/(app)/(work)/dashboard/dashboard-card-slots.ts`(N9 가 만든 파일. 슬롯 정의 한 줄), `web/server/bids/dashboard.model.ts`(DTO 필드 `projects: {active: number}` 하나), 대시보드 서비스·시험(그 필드를 채움)

**Interfaces:**
- Consumes: Task 2 `countActiveProjects(orgId, deps)`.
- Produces: `DashboardSummary.projects.active` — `status <> 'CLOSED'` 수. 슬롯 5 제목 "진행 중 입찰 프로젝트", 누르면 `/projects`.

- [ ] **Step 1** — N9(`feat/n9-analysis-card`)가 main 에 들어갔는지 본다. 안 들어갔으면 이 Task 를 미루고 Task 6 으로 간다. 들어갔으면 54 에 고칠 줄을 먼저 알린다.
- [ ] **Step 2: 실패 시험** — `슬롯 5 는 진행 중 입찰 프로젝트이고 CLOSED 는 세지 않는다`, 0 이면 빈 문구, 분석 현황 카드 시험은 슬롯 5 가 아니라는 기대로 바꾼다.
- [ ] **Step 3: 구현 → 통과 확인** — `pnpm -C web exec vitest run "app/(app)/(work)/dashboard" server/bids/dashboard` PASS.
- [ ] **Step 4: 커밋** — `feat(web): 대시보드 슬롯 5 를 입찰 프로젝트로`.

### Task 6: 증거·PROGRESS·정본 반영 목록·기준점

**Files:**
- Create: `docs/evidence/p1-n6/README.md`
- Modify: `docs/PROGRESS.md` (작업 로그 끝에 한 행)
- Move: 스펙을 `polaris/specs/in-progress/` 에 둔 채로 둔다(병합 뒤 45 가 done 으로)

- [ ] **Step 1** — 최신 origin/main 을 병합한다. main 최대 마이그레이션 번호가 `20261022000300` 이상이면 그보다 큰 번호로 파일 이름을 바꾸고 `pnpm db:types` 를 다시 만들어 같은 커밋에 넣는다.
- [ ] **Step 2** — `bash <slot> pnpm verify` exit 0. 루트·web·ai·decision 시험 수를 적는다.
- [ ] **Step 3** — 격리 스택(격리 compose·격리 Supabase, 54321 금지)에서 SALES 계정으로 FX 공고 BID 결정 → 만들기 → 상태 두 칸 → 결과 기록, VIEWER 계정으로 읽기만을 1440·1280 에서 확인하고 스크린샷을 남긴다. 못 하면 미검증으로 적는다.
- [ ] **Step 4** — 커밋 후 3e 에 기준점(브랜치·해시·병합한 main·verify 수·작업 트리 깨끗·마이그레이션 번호·겹치는 파일), 45 에 정본 반영 목록(아래), 12 에 기준점 한 줄.

## 정본 문서에 반영할 것 (45 에 넘긴다)

- 04 §3.6 `audit_logs.action` 표에 `PROJECT_OPEN`·`PROJECT_STATUS_CHANGE`·`PROJECT_RESULT_RECORD`(쓰는 곳: 세 DB 함수), §3.8 함수 3개와 전이 규칙, §3.1 `tasks` restrictive 정책.
- 05 §2 `/projects` 세 행의 본문·응답 형태(Task 2 타입), §5 오류 표에 `PROJECT_ALREADY_OPEN`·`INVALID_PROJECT_TRANSITION`.
- 06 §4.1 입찰 프로젝트 노출 열, §5 `/projects` 화면, §9 부품 표(UI 스펙의 새 부품).
- 09 감사 절(입찰 프로젝트 감사 구현됨).
- 11 NAV-P1-02 시험 위치.
- 설계 §8 변경 기록: 스펙 §5 의 7건.

## 관련 문서

- [[16-DECISIONS|16 결정]]
- [[04-DATABASE|04 DB]]
- [[05-API-SPEC|05 API]]
- [[PROGRESS|진행 상황]]
