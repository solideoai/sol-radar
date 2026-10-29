---
title: "목록 화면 지연 줄이기 구현 계획"
status: draft
tags: [sol-radar, plan, performance, bids, dashboard, hackathon]
updated: 2026-10-29
---

# 목록 화면 지연 줄이기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영에서 사이드바로 `/bids`·`/watchlist`·`/dashboard` 를 열 때 걸리는 5~7초를 2초 안팎으로 줄인다.

**Architecture:** 목록 커서의 데이터 버전 `public.procurement_dataset_version(p_org_id)` 를 뷰 `opportunity_list_items` 전체 해시에서 원본 표의 가벼운 해시로 바꾼다(서명·반환형·권한 그대로라 웹 코드는 바뀌지 않는다). 모든 활동 회원에게 같은 값인 필터 선택지 `procurement_filter_options` 는 Next 서버 데이터 캐시(`unstable_cache`, 10분)로 돌려준다. 대시보드 요약·지표 캐시와 클라이언트 라우터 캐시(`staleTimes`)는 쓰지 않는다(아래 "검토했지만 하지 않는 것").

**Tech Stack:** Supabase Postgres(SQL 함수, PGlite 정책 시험 `scripts/database.test.mjs`), Next.js 16.4.1 `web/`(`unstable_cache`, Cache Components 꺼짐), Vitest.

**Spec:** 별도 스펙 없음. 근거는 2026-10-29 운영 측정(이 문서 "원인 측정값")과 사용자 결정 "1번(가벼운 버전 확인)으로 하자, 캐싱도 고려해봐"다. 직전 조치 기록은 `docs/evidence/deployment/20261028-region-latency.md`.

## 원인 측정값 (2026-10-29, 운영 Supabase `brtysdocxemrqhdezzqg`)

- 함수 지역은 `syd1`이고 Supabase 호출 p50 은 14ms(SYD·authenticated 1.9만 건)다. 지역은 원인이 아니다.
- `/bids` 이동 한 번(23:00:44 KST 로그): `procurement_dataset_version` 2.6초 → 목록 `opportunity_list_items` 2.1초 → `procurement_dataset_version` 2.6초가 차례로 돈다. 그동안 `procurement_filter_options` 가 6.1초 걸린다.
- 같은 함수를 authenticated 역할로 하나씩 재면 version 921ms·summary 585ms·live_metrics 345ms·filter_options 1,685ms 다. 운영에서는 동시에 돌아 더 느리다.
- 시간대별 p50(KST)은 10-28 23시 version 263ms·filter 23ms, 10-29 16시 1.8초·3.3초, 10-29 23시 2.6초·6.1초였다. filter_options 는 `20261029000300_it_bid_scope` 뒤 공고마다 `it_scope()` 하위 조회 2개를 돈다.
- 사업기회는 3,309건이고 하루 800~1,200건씩 는다. 뷰 전체를 계산하는 비용은 건수에 비례해 커진다.
- 원본 표 해시 시제품을 authenticated 로 재면 18.6ms 다(뷰 해시 921ms).

## Global Constraints

- 화면 동결 2026-11-01, 제출 11-03, 발표 11-04. 운영 반영은 동결 전에 끝낸다.
- 운영 변경은 각각 사용자 승인 뒤에 한다: `pnpm db:push`(운영 DB), main push(Vercel 배포). 회사 서버·Worker 는 건드리지 않는다.
- 마이그레이션은 새 파일로만 쌓는다. 이미 있는 파일은 고치지 않는다. 새 파일 번호는 `20261029000500` 이다.
- 서명 유지: `public.procurement_dataset_version(p_org_id uuid) returns text`, `language sql stable`, `set search_path=''`, security invoker, `revoke all … from public,anon,authenticated` 뒤 `grant execute … to authenticated`.
- 웹 서버는 service role 키를 쓰지 않는다. 캐시 함수 안에서도 요청 사용자의 Supabase client 를 쓴다.
- Cache Components(`cacheComponents`)를 켜지 않는다. `"use cache"` 를 쓰지 않는다. 앱 전체 렌더링 방식이 바뀌어 동결 전에 다 확인할 수 없다.
- 시험은 핵심 동작만 더한다(`docs/evidence/verification/20261021-pruned-tests.json` 기준). 개발 중 `pnpm verify:changed`, 통합 때 `pnpm verify`.

## Review Focus

1. 목록에 보이는 값이 바뀌었는데 버전이 그대로면 "더 보기"가 행을 건너뛰거나 겹친다. 관련성 재판정·공고 갱신·결정 기록·분석 완료마다 버전이 바뀌어야 한다 → Task 1 시험이 고정한다.
2. 다른 조직의 분석·결정이 바뀌어도 내 조직 버전은 그대로여야 한다(불필요한 커서 무효화, 조직 정보 유출 신호) → Task 1 시험이 고정한다.
3. 필터 선택지 캐시는 사용자끼리 공유된다. 공유해도 되는 근거는 원천 표(`bid_notices`·`procurement_agencies`·`bid_revisions`·`bid_relevance_assessments`)의 RLS 가 모두 `is_active_user()` 라서 조직과 무관하게 같은 값이라는 점과, 호출하는 두 화면(`/bids`·`/watchlist`)이 먼저 `requireWork` 를 통과한다는 점이다. 같은 출처면 client 가 달라도 한 번만 읽고, 출처가 다르면 따로 읽어야 한다 → Task 2 시험이 고정한다.
4. RPC 오류가 캐시에 남으면 10분 동안 필터가 비거나 화면이 깨진다. `unstable_cache` 는 throw 를 캐시하지 않는다. 시험의 가짜 캐시로는 증명되지 않으므로 Task 4 배포 확인에서 본다.
5. Vercel `services` 배포(`vercel.json`)에서 서버 데이터 캐시가 실제로 인스턴스 사이에 공유되는지 확인되지 않았다(같은 배포에서 `/_next/image` 가 404 였다). Task 4 에서 배포 뒤 로그로 `/bids` 방문 수 대비 `procurement_filter_options` 호출 수를 센다.

## 검토했지만 하지 않는 것

- 대시보드 `procurement_summary`·`procurement_live_metrics` 캐시: 대시보드 규칙 M4("BID 권고" 카드와 BID 표 숫자가 갈라지지 않는다)와 화면의 새로 고침 버튼(`OpportunityRefresh`)이 캐시 동안 깨진다. 버전 확인 4번이 빠지면 동시 부하도 준다.
- `experimental.staleTimes.dynamic`(클라이언트 라우터 캐시): `router.refresh()` 는 지금 경로의 캐시만 지운다(`web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`). `/bids` 에서 관심 등록 뒤 30초 안에 `/watchlist` 로 가면 옛 목록이 보인다. 라이브 시연에서 틀린 화면이 더 나쁘다.
- 목록 뷰 자체(1~2초)를 미리 계산해 두기: 수집 Worker 까지 바꿔야 한다. 사용자가 이번 범위에서 고르지 않았다.
- Supabase 서울 이전: 원인이 네트워크가 아니다. 발표 뒤 일정 그대로다.

## 배분

| 작업 | 세션 | worktree | 브랜치 |
|---|---|---|---|
| Task 1 목록 버전 함수 | `sol-radar-85 [e166f9]` | `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/list-version` | `perf/list-version` |
| Task 2 필터 선택지 캐시 | `sol-radar-81` | `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/filter-cache` | `perf/filter-cache` |
| Task 3 증거·ADR·PROGRESS 초안, 1·2 읽기 검토 | `sol-radar-e8` | `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/latency-docs` | `docs/list-latency` |
| Task 4 통합·검증·운영 반영·실측 | `sol-radar-85 [2cf2c8]`(조정) | `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/list-latency` | `perf/list-latency` |

세 worktree 는 조정 세션이 main `9276215c` 에서 만든다. Task 1·2·3 은 서로 다른 파일만 고쳐 동시에 진행한다.

### 작업자 공통 규칙

- 자기 worktree 안에서만 고친다. git 상태 변경(add·commit·stash·checkout·merge)은 하지 않는다. 커밋은 조정 세션이 diff 를 확인한 뒤 한다.
- worktree 에서 루트 `pnpm install` 의 prepare 실패(core.hooksPath)는 무시한다. node_modules 가 생겼는지만 본다. `HUSKY=0` 으로 돌아가지 않는다. `web/` 은 `pnpm -C web install`.
- 무거운 검증(`pnpm verify`·`verify:quick`·`test:browser`·`test:e2e*`·`next build`)은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh timeout -k 30 1200 <명령>` 으로 감싼다. 경로가 없으면 짐작하지 말고 멈춰 보고한다.
- 훅·가드·권한 거부에 막히면 다른 길(env 이름 문자열 조립, node·python 으로 `.env` 읽기 등)로 돌아가지 말고 멈춰 보고한다.
- 운영 DB·회사 서버·유료 API 를 호출하지 않는다. `pnpm db:push` 를 실행하지 않는다.
- 패턴으로 프로세스를 끄지 않는다(`pkill`·`killall` 금지). 자기가 띄운 PID 만 끈다.
- 끝나면 바꾼 파일, 실행한 명령과 결과(통과 수·exit code), 못 돌린 검사를 조정 세션(`sol-radar-85 [2cf2c8]`)에 SendMessage 로 보낸다. 답은 한국어로 쓴다.

## File Structure

- Create `supabase/migrations/20261029000500_list_dataset_version.sql` — `procurement_dataset_version` 본문만 원본 표 해시로 바꾼다(Task 1).
- Modify `scripts/database.test.mjs` — "목록 버전" 시험 하나를 "IT 범위(ADR-069)" describe 뒤에 더한다(Task 1).
- Modify `web/app/_lib/opportunity-data.ts` — `loadOpportunityFilters` 만 캐시로 감싼다(Task 2).
- Create `web/app/_lib/opportunity-data.test.ts` — 캐시 키 시험(Task 2).
- Create `docs/evidence/deployment/20261029-list-rpc-latency.md`, Modify `docs/16-DECISIONS.md`(ADR-070), `docs/PROGRESS.md`(Task 3).
- Modify `docs/plans/2026-10-29-list-latency.md` 상태(Task 4).

---

### Task 1: 목록 버전을 원본 표 해시로

**Files:**
- Create: `supabase/migrations/20261029000500_list_dataset_version.sql`
- Test: `scripts/database.test.mjs`(describe "SOL RADAR 표 정책 — 업무 역할·조직 격리" 안, `describe("IT 범위(ADR-069)")` 바로 뒤)

**Interfaces:**
- Consumes: 없음
- Produces: `public.procurement_dataset_version(p_org_id uuid) returns text` — 서명·권한 그대로. 웹 `web/server/opportunities/repo.ts:140` `versionOf` 가 그대로 부른다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
it("목록 버전 — 뷰를 계산하지 않고 목록에 보이는 변경마다 바뀐다(20261029000500)", async (t) => {
  const db = await solDb(t);
  const version = async () =>
    (await rowsOf(db, "select public.procurement_dataset_version($1) v", [ORG1]))[0].v;
  await as(db, "viewer");
  const [src] = await rowsOf(db,
    "select prosrc from pg_proc where proname='procurement_dataset_version'");
  assert.doesNotMatch(src.prosrc, /opportunity_list_items/);   // 원인 재발 방지
  const v0 = await version();
  assert.equal(await version(), v0);                          // 바뀐 것이 없으면 같다
  // 1) 공고 갱신  2) 관련성 재판정  3) 사람 결정  4) 다른 조직 분석 변경 순으로 바꾼다.
  //    1~3 은 매번 직전 값과 달라야 하고(assert.notEqual), 4 는 직전 값과 같아야 한다(assert.equal).
  //    쓰기는 asWorker(db) 로, 읽기는 as(db, "viewer") 로 한다. 4 는 ORG2 소유 score_run(RUN2 가 ORG2 것인지 먼저 확인)의 status 를 바꾼다.
});
```

1)은 `update public.bid_notices set title=title||' (정정)' where id=$1` [BID1], 2)는 이 파일 1423행 모양의 `insert into public.bid_relevance_assessments(revision_id,policy_version,input_hash,state,categories)` [REV1, 새 input_hash], 3)은 2640행 모양의 `insert into public.bid_reviews(org_id,bid_id,revision_id,decision,reason,decided_at)` [ORG1, BID1, REV1]다. 기존 시험 "ADR047 — 재분석·단계 연결…"의 score_run 완료 검사는 그대로 통과해야 한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test --test-name-pattern="목록 버전" scripts/database.test.mjs`
Expected: FAIL — `doesNotMatch` 가 `opportunity_list_items` 를 찾는다.

- [ ] **Step 3: 마이그레이션을 쓴다**

머리 주석은 `20261029000300_it_bid_scope.sql` 모양(근거·바꾸는 것·바꾸지 않는 것·되돌리기·append-only)으로 쓴다. 되돌리기는 `20261023000200_procurement_reads.sql` 본문으로 다시 만드는 것이다. 본문은 아래 9개 값을 `concat_ws('|', …)` 로 이은 `md5` 다. 각 값은 `count(*)||':'||coalesce(bit_xor(hashtextextended(<열 묶음>,0)),0)` 꼴이다.

| 표 | 범위 | 해시할 열 |
|---|---|---|
| `bid_opportunities` | 전체 | `id, canonical_notice_id, superseded_by, first_seen_at` |
| `bid_notices` | 전체 | `id, updated_at, status, deadline_at, latest_revision`(`updated_at` 은 `bid_notices_touch_updated_at` 트리거가 모든 갱신에 바꾼다) |
| `bid_notices` | 전체 | 해시 대신 `count(*) filter (where status in ('OPEN','AMENDED') and deadline_at<now())` — 뷰가 `now()` 로 CLOSED 를 만들기 때문이다 |
| `bid_revisions` | 전체 | `id` |
| `bid_relevance_assessments` | 전체 | `id` |
| `opportunity_notice_links` | 전체 | `opportunity_id, bid_id, decided_at` |
| `score_runs` | `org_id=p_org_id` | `id, status, finished_at, score, recommendation` |
| `bid_reviews` | `org_id=p_org_id` | `id, decision, decided_at` |
| `company_profiles` | `org_id=p_org_id` | 해시 대신 `count(*)||':'||coalesce(max(revision),0)` |

열 묶음은 `concat_ws(',', …)` 로 만든다. `create or replace function` 뒤에 Global Constraints 의 revoke·grant 두 줄을 다시 쓴다.

- [ ] **Step 4: 시험이 통과하는지 본다**

Run: `node --test --test-name-pattern="목록 버전|ADR047" scripts/database.test.mjs`
Expected: PASS(목록 버전 1, ADR047 2)

- [ ] **Step 5: 생성 타입과 변경 범위 검사**

Run: `pnpm db:types && git -C /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/list-version diff --stat -- web/lib/database.types.ts`
Expected: 서명이 같아 `web/lib/database.types.ts` 변경 없음.
Run: `pnpm verify:changed`
Expected: exit 0

- [ ] **Step 6: 보고** — 조정 세션이 diff 를 보고 `perf: 목록 버전을 원본 표 해시로` 로 커밋한다.

---

### Task 2: 필터 선택지를 서버 캐시로

**Files:**
- Modify: `web/app/_lib/opportunity-data.ts`(`loadOpportunityFilters` 만)
- Test: `web/app/_lib/opportunity-data.test.ts`

**Interfaces:**
- Consumes: `getOpportunityClient()`·`getOpportunityFilterOptions(client, origin)`(`@/server/opportunities`), `unstable_cache`(`next/cache`)
- Produces: `loadOpportunityFilters(origin: OpportunityQuery["origin"]): Promise<{ agencies: {id,name}[]; companies: {id,name}[] }>` — 서명 그대로. 호출처 `web/app/(app)/(work)/bids/page.tsx:26`·`watchlist/page.tsx` 는 바꾸지 않는다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`vi.mock("next/cache")` 의 `unstable_cache` 는 `keyParts` 와 `JSON.stringify(args)` 로 결과를 `Map` 에 담는 가짜다(옵션은 받은 그대로 기록). `vi.mock("@/server/opportunities")` 의 `getOpportunityClient` 는 부를 때마다 새 객체를 돌려주고 `getOpportunityFilterOptions` 는 `vi.fn` 이다. `@/server/bids`·`@/app/_lib/opportunity-sources` 도 빈 mock 으로 막는다.

```ts
it("같은 출처는 사용자(client)가 달라도 한 번만 읽고, 출처가 다르면 따로 읽는다", async () => {
  await loadOpportunityFilters("live");
  await loadOpportunityFilters("live");
  await loadOpportunityFilters("demo");
  expect(getOpportunityFilterOptions).toHaveBeenCalledTimes(2);
  expect(getOpportunityFilterOptions.mock.calls.map((c) => c[1])).toEqual(["live", "demo"]);
  expect(cacheOptions.at(-1)).toEqual({ revalidate: 600, tags: ["opportunity-filter-options"] });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm -C web exec vitest run app/_lib/opportunity-data.test.ts`
Expected: FAIL — `toHaveBeenCalledTimes(2)` 에서 3 이 나온다.

- [ ] **Step 3: `loadOpportunityFilters` 를 캐시로 감싼다**

요청마다 `opportunityClient()` 로 client 를 만든 뒤 `unstable_cache((o) => getOpportunityFilterOptions(client, o), ["opportunity-filter-options"], { revalidate: 600, tags: ["opportunity-filter-options"] })(origin)` 을 돌려준다. client 를 캐시 키에 넣지 않는 이유를 주석 두 줄로 남긴다: 원천 표 RLS 가 모두 `is_active_user()` 라 활동 회원 누구에게나 같은 값이고, 호출 화면이 먼저 `requireWork` 를 통과한다. 문서 근거는 `web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`.

- [ ] **Step 4: 시험이 통과하는지 본다**

Run: `pnpm -C web exec vitest run app/_lib/opportunity-data.test.ts`
Expected: PASS(1)
Run: `pnpm verify:changed`
Expected: exit 0(lodestar 계층 검사 포함)

- [ ] **Step 5: 보고** — 조정 세션이 diff 를 보고 `perf(web): 필터 선택지를 서버 캐시로` 로 커밋한다.

---

### Task 3: 증거·ADR-070·PROGRESS 초안, 그리고 Task 1·2 읽기 검토

**Files:**
- Create: `docs/evidence/deployment/20261029-list-rpc-latency.md`
- Modify: `docs/16-DECISIONS.md`(표 한 줄 + `## ADR-070` 본문), `docs/PROGRESS.md`(최근 작업 로그 한 줄)

**Interfaces:**
- Consumes: 이 계획의 "원인 측정값"·"검토했지만 하지 않는 것"
- Produces: 증거 문서의 "조치 뒤" 표. 칸은 비워 두고 Task 4 가 채운다.

- [ ] **Step 1: 증거 문서를 쓴다** — 틀은 `docs/evidence/deployment/20261028-region-latency.md` 를 따른다(frontmatter `status: draft`, 사용자 보고 → 원인 표 → 조치 → 조치 뒤 → 남은 것). 원인 표에는 이 계획 "원인 측정값"의 숫자를 그대로 쓴다. 조치는 Task 1·2 를 한 줄씩 쓴다. 조치 뒤 표 머리는 `| 항목 | 조치 전 | 조치 뒤 |` 이고 행은 version p50·filter_options p50·`/bids` 이동 한 번의 Supabase 대기 셋이다. 남은 것에는 목록 뷰 1~2초와 "검토했지만 하지 않는 것"을 옮긴다. 10-28 문서를 위키링크로 잇는다.
- [ ] **Step 2: ADR-070 을 쓴다** — 제목 "목록 버전은 원본 표 해시, 필터 선택지는 서버 데이터 캐시". 상태 `채택`, 날짜 2026-10-29. 근거는 사용자 결정(1번 + 캐싱 검토)과 이 계획의 사용자 승인이다. 대안과 버린 이유는 "검토했지만 하지 않는 것" 네 줄을 쓴다. ADR-069 표 행 뒤에 표 한 줄을 더하고, 본문은 ADR-069 본문 앞에 둔다(파일이 최신 ADR 을 위에 둔다).
- [ ] **Step 3: PROGRESS 를 쓴다** — 최근 작업 로그 맨 위에 한 줄: 날짜·원인 한 줄·조치(Task 1·2)·"운영 반영 대기".
- [ ] **Step 4: 문서 검사** — Run: `pnpm verify:changed` / Expected: exit 0(frontmatter·위키링크 검사 포함)
- [ ] **Step 5: Task 1·2 읽기 검토** — 두 worktree 의 `git diff` 를 읽고 Review Focus 1~5 와 아래를 본다. 고치지 않고 조정 세션에 결과만 보낸다.
  - 버전 해시가 목록 뷰가 읽는 열 중 빠뜨린 것이 있는가(`20261029000300_it_bid_scope.sql` 뷰 본문과 대조)
  - 캐시 함수 안에서 `cookies()`·`headers()`·`connection()` 을 부르지 않는가
  - service role 이나 새 env 를 쓰지 않는가
- [ ] **Step 6: 보고** — 조정 세션이 `docs: 목록 지연 원인·ADR-070 기록` 으로 커밋한다.

---

### Task 4: 통합·검증·운영 반영·실측 (조정 세션)

**Files:**
- Modify: `docs/evidence/deployment/20261029-list-rpc-latency.md`(조치 뒤 숫자), `docs/plans/2026-10-29-list-latency.md`(status)

**Interfaces:**
- Consumes: Task 1·2·3 커밋
- Produces: main 병합 커밋, 운영 반영

- [ ] **Step 1:** worktree 4개를 만들고(`git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add <경로> -b <브랜치> 9276215c`) 작업자 세 명에게 Task 와 공통 규칙을 보낸다.
- [ ] **Step 2:** 보고가 오면 diff 와 시험을 직접 다시 돌려 확인하고, 각 worktree 에서 슬롯으로 감싼 `git -C <worktree> commit` 을 한다.
- [ ] **Step 3:** `perf/list-latency` 에 세 브랜치를 병합하고 `pnpm verify` 를 슬롯으로 돌린다. Expected: exit 0.
- [ ] **Step 4:** 사용자 승인을 받아 `NODE_EXTRA_CA_CERTS=~/.supabase/prod-ca-2021.crt pnpm db:push` 를 한다. 운영에서 authenticated 로 version 을 재서 50ms 이하인지 본다. 같은 서명이라 웹 배포 전이어도 기존 코드가 그대로 동작한다.
- [ ] **Step 5:** 사용자 승인을 받아 main 에 병합하고 push 한다(Vercel 배포). 배포 성공 뒤 `/bids` 를 한 번 열어 캐시를 채운다(사용자 브라우저).
- [ ] **Step 6:** 사용자가 사이드바로 `/dashboard`·`/bids`·`/watchlist` 를 오간 뒤 Supabase edge 로그(`request.cf.colo='SYD'`)로 잰다. 완료 기준: version p50 50ms 이하, `/bids` 이동 한 번의 Supabase 대기 2.5초 이하, 같은 10분 안 두 번째 `/bids` 방문에서 `procurement_filter_options` 호출 없음. 마지막 기준이 안 맞으면(Review Focus 5) 결과를 사용자에게 알리고 다음 수를 고른다.
- [ ] **Step 7:** 증거 문서 숫자를 채우고 `status: done`, 이 계획 `status: done` 으로 바꿔 커밋·push 한다. 메모리 `prod-region-latency-20261028` 을 갱신한다.
