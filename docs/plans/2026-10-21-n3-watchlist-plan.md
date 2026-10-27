---
title: "N3 관심 공고 — 구현 계획"
status: done
tags:
  - sol-radar
  - plan
updated: 2026-10-21
---

# N3 관심 공고 구현 계획

> **작업자에게:** superpowers:subagent-driven-development 로 과제마다 구현 → 메인 세션(fa)이 diff·시험으로 확인한다. 단계는 체크박스(`- [ ]`)로 쫓는다.

**Goal:** ★로 공고를 관심 등록·해제하고, `/watchlist` 에서 그것만 보고, 마감 D-3·D-1 09:00 KST 에 인앱 알림을 받는다.

**Architecture:** 새 표 `bid_watches`(본인 행 RLS) + 관심 인원 수 집계 함수 + 관심 공고만 거르는 security_invoker 뷰. 서버 도메인 `web/server/watchlist/`(등록·해제·인원 수·내 관심 id). 목록은 기존 `GET /bids` 에 `watched=me` 하나를 더해 뷰만 바꿔 읽는다. 마감 알림은 DB 함수가 계산·삽입하고 worker 주기 작업이 5분마다 부른다(outbox 안 거침, 12 판단 Q1 ①).

**Tech Stack:** Supabase Postgres(RLS·security definer)·PGlite 정책 시험, Next.js 16 Route Handler·서버 컴포넌트, React 19 클라이언트 부품, Vitest(단위·브라우저), BullMQ worker 등록.

**Spec:** [N3 스펙](../../polaris/specs/done/2026-10-21-n3-watchlist.md) · 화면은 [N3 디자인 스펙](2026-10-21-n3-watchlist-design.md)(web-designer, D 항목 추천 ①) · 설계 [사이드바 정보 구조](2026-10-16-sidebar-ia-design.md) §2.2·§2.5·§3.2 P1-1·D6·D7.

## Global Constraints

- 마이그레이션은 새 파일만: `supabase/migrations/20261022000100_bid_watches.sql`, `supabase/migrations/20261022000110_deadline_reminders.sql`. 기준점 직전 main 최대 번호 이하이면 더 큰 번호로 바꾸고 같은 커밋에서 `pnpm db:types`.
- 표는 만들자마자 RLS 로 잠근다. 정책 시험은 `scripts/database.test.mjs` 의 "SOL RADAR 표 정책" describe 안에 더한다(`solDb`·`as`·`asWorker`·`rowsOf`·`countOf`·`WHO`·`ORG1`·`ORG2`·`BID1`·`BID2` 재사용).
- `bid_list_items` 뷰·`BidListItem`·`ingest_save_revision`·분석 job·`outbox.model.ts`·`outbox.service.ts`·`notify-outbox.ts` 는 고치지 않는다(ADR-042 ②, 12 Q1·Q2).
- 조직은 서버가 정한다(M17). 요청 본문·쿼리로 조직 id 를 받지 않는다. 다른 조직 자원은 404.
- 마감 알림: 채널 `IN_APP` 만, 키 `<bidId>:<userId>:DEADLINE_APPROACHING:D-<n>`, n ∈ {3, 1}, 09:00 KST 이후 그날만. 수신자 = 조직마다 최신 `bid_reviews.assignee_id` ∪ 그 조직 `bid_watches.user_id`, 사용자 id 중복 제거, 그 조직 구성원이고 `profiles.status = 'active'` 인 사람만.
- KST 는 고정 +9시간(일광 절약 없음): `(p_now at time zone 'UTC') + interval '9 hours'`. 'Asia/Seoul' 이름에 기대지 않는다(PGlite).
- security definer 함수는 `set search_path = ''`, 전체 이름(`public.`)으로 부르고, `revoke execute … from public, anon, authenticated` 뒤 필요한 역할에만 `grant`.
- 웹 서버 코드는 `import "server-only";`, 도메인은 배럴(`@/server/watchlist`)로만, `../` 금지, `any`·`eslint-disable`·`@ts-ignore`·테스트 `.only`·`.skip` 금지. 색은 토큰 클래스만.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 가드·훅에 막히면 멈추고 보고한다. 무거운 검증·커밋은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 으로 감싼다. 서브에이전트는 git 상태를 바꾸지 않는다(커밋은 fa).
- 화면 문구·크기는 디자인 스펙을 따른다. 확인 폭 1440·1280.

## Review Focus

1. 같은 사용자가 두 창에서 동시에 ★ → PUT 두 번이 모두 200, 행 1개(PK 충돌을 오류로 내지 않는다). → Task 1 DB 시험, Task 3 서비스 시험.
2. 남의 조직이 관심 등록한 같은 공고의 "관심 N명"에 내 조직 수만 나온다. 비활성(`status <> 'active'`) 호출자는 0. → Task 1 DB 시험(45 요청).
3. 담당자이면서 관심 등록자인 사람은 마감 알림 1건, 함수를 같은 날 두 번·세 번 돌려도 1건. → Task 2 DB 시험.
4. 09:00 KST 직전(08:59:59) 회차 0건, 직후(09:00:00) 1건, 놓친 D-3 을 D-2 에 늦게 내지 않는다. → Task 2 DB 시험.
5. `/watchlist` 에서 "더 보기"·상세의 "← 목록"이 `/watchlist` 로 돌아온다(`/bids?watched=me` 로 새지 않는다). → Task 4 `back-href.test.ts`, Task 6 브라우저 시험.

---

### Task 1: `bid_watches` 표·RLS·관심 인원 수·관심 공고 뷰

**Files:**
- Create: `supabase/migrations/20261022000100_bid_watches.sql`
- Modify: `scripts/database.test.mjs`(SOL RADAR 표 정책 describe 끝, 그리고 `ORG_TABLES` 등 표 목록에 `bid_watches` 를 넣어야 잠금 시험이 돈다면 거기에도)
- Regenerate: `web/lib/database.types.ts`(`pnpm db:types`)

**Interfaces:**
- Produces: 표 `public.bid_watches(org_id uuid, user_id uuid, bid_id uuid, created_at timestamptz default now())` PK(`org_id`,`user_id`,`bid_id`), FK (`org_id`,`user_id`) → `memberships(org_id, user_id)` on delete cascade, `bid_id` → `bid_notices(id)` on delete cascade, 인덱스 `bid_watches_org_id_bid_id_idx (org_id, bid_id)`.
- Produces: `public.bid_watch_count(p_bid_id uuid) returns integer` — stable, security definer, `search_path = ''`, `count(*)` where `bid_id = p_bid_id and org_id in (select public.my_org_ids())`. `my_org_ids()` 가 이미 active 만 내므로 비활성 호출자는 0. authenticated 실행.
- Produces: 뷰 `public.watched_bid_list_items` with (security_invoker = true) = `select i.* from public.bid_list_items i where exists (select 1 from public.bid_watches w where w.bid_id = i.id)`. authenticated select 만. 머리 주석에 "bid_list_items 열을 바꾸는 마이그레이션은 이 뷰도 다시 만든다"를 적는다.
- 권한: authenticated 에 `select, insert (org_id, user_id, bid_id), delete` 만. update 없음. anon 없음.
- 정책 셋: select·insert·delete 모두 `user_id = (select auth.uid()) and org_id in (select public.my_org_ids())`.

- [ ] **Step 1: 실패하는 DB 시험을 쓴다.** 한 `it` 에 하나씩:
  - "관심 공고(20261022000100) — 본인 행만 읽고 넣고 지운다": admin 이 BID1 넣기 → admin 이 읽으면 1행, sales 가 읽으면 0행, outsider(ORG2) 0행.
  - "남의 user_id·남의 조직으로 넣으면 RLS 거부": sales 가 `user_id = WHO.admin` 행 넣기 → `POLICY`, admin 이 `org_id = ORG2` 넣기 → `POLICY`, anon 넣기·읽기 → `PERMISSION`.
  - "같은 행을 두 번 넣으면 PK 충돌(23505), `on conflict do nothing` 은 0행" — 서비스가 쓰는 모양 그대로 검사.
  - "update 권한이 없다" → `PERMISSION`.
  - "구성원이 빠지면 관심 행도 지워진다"(asWorker 로 memberships delete 뒤 0행).
  - "bid_watch_count — 조직 안 수만 센다": ORG1 의 admin·sales 가 BID1 관심, ORG2 outsider 도 BID1 관심 → admin 호출 2, outsider 호출 1, 없는 공고 0, ORG1 viewer 를 `profiles.status = 'suspended'`(그 표의 허용 값으로) 로 바꾼 뒤 viewer 호출 0, anon 실행 → `permission denied for function`.
  - "watched_bid_list_items — 내 관심 공고만, 남의 조직 관심은 안 보임": admin 이 BID1 관심, outsider 가 BID2 관심 → admin 은 [BID1], outsider 는 [BID2], sales 는 [].
  - 기존 "뷰·함수로 RLS 를 거치지 않는 길"·"화면 역할의 위험한 표 권한"·"마이그레이션 재실행" 시험이 새 객체로 깨지지 않는지 함께 돈다.
- [ ] **Step 2: 실패를 확인한다.** Run: `node --test --test-name-pattern="20261022000100|bid_watch_count|watched_bid_list_items" scripts/database.test.mjs` → 표가 없어 FAIL.
- [ ] **Step 3: 마이그레이션을 쓴다.** 머리 주석은 다른 마이그레이션 형식(근거·이 파일에 든 것·되돌리기)을 따른다.
- [ ] **Step 4: 통과를 확인한다.** Run: 같은 명령 → PASS. 이어서 `node --test scripts/database.test.mjs` 전체 PASS.
- [ ] **Step 5: 타입을 만든다.** Run: `pnpm db:types` → `web/lib/database.types.ts` 에 `bid_watches`·`watched_bid_list_items`·`bid_watch_count` 가 생긴다. `pnpm check:db-types`(있으면) 통과.
- [ ] **Step 6: 커밋(fa).** `feat(db): 관심 공고 표와 인원 수 집계 추가`

### Task 2: 마감 알림 DB 함수

**Files:**
- Create: `supabase/migrations/20261022000110_deadline_reminders.sql`
- Modify: `scripts/database.test.mjs`
- Regenerate: `web/lib/database.types.ts`

**Interfaces:**
- Consumes: Task 1 의 `bid_watches`.
- Produces: `public.send_deadline_reminders(p_now timestamptz) returns integer`(넣은 행 수). security definer, `search_path = ''`, service_role 만 실행(authenticated·anon·public 은 revoke).
- 규칙:
  - `kst_now = (p_now at time zone 'UTC') + interval '9 hours'`(timestamp). `kst_now::time < time '09:00'` 이면 0 을 돌려준다.
  - 대상 공고: `deadline_at is not null and deadline_at > p_now and status in ('OPEN','AMENDED')`, 그리고 `((deadline_at at time zone 'UTC') + interval '9 hours')::date - kst_now::date` 가 3 또는 1. 그 차이가 n.
  - 수신자(조직마다): 그 조직의 최신 `bid_reviews`(decided_at desc, id desc) 의 `assignee_id`(null 제외) ∪ 그 조직·공고의 `bid_watches.user_id`. `distinct (org_id, user_id)`. `memberships` 에 (org_id, user_id) 가 있고 `profiles.status = 'active'` 인 사람만.
  - 넣는 행: `org_id`, `user_id`, `type 'DEADLINE_APPROACHING'`, `channel 'IN_APP'`, `status 'SENT'`, `sent_at p_now`, `idempotency_key bid_id || ':' || user_id || ':DEADLINE_APPROACHING:D-' || n`, `payload jsonb_build_object('bidId', bid_id, 'title', title, 'message', <문구>, 'link', '/bids/' || bid_id)`. 문구 n=3 "마감 3일 전입니다.", n=1 "마감 하루 전입니다.". `on conflict (idempotency_key) do nothing`.

- [ ] **Step 1: 실패하는 DB 시험을 쓴다.** 시각은 모두 고정 값(`p_now` 인자)이다. 공고 마감은 시험 안에서 asWorker 로 `bid_notices.deadline_at` 을 바꿔 맞춘다. `it` 하나씩:
  - "D-3 09:00 KST 이후 첫 회차에 담당자 ∪ 관심 등록자에게 1건씩": BID1 마감 = 2026-10-25T09:00:00Z(KST 18:00), `p_now = 2026-10-22T00:00:00Z`(KST 09:00) → admin(담당자이며 관심), sales(관심) 2행, 키 `…:D-3`, 반환 2.
  - "같은 날 다시 돌리면 0건": 위 뒤 `p_now = 2026-10-22T05:00:00Z` → 반환 0, 행 수 그대로 2.
  - "09:00 KST 직전은 0건": `p_now = 2026-10-21T23:59:59Z` → 0.
  - "놓친 D-3 은 D-2 에 내지 않는다": `p_now = 2026-10-23T01:00:00Z`(D-2) → 0.
  - "D-1 은 따로 1건": `p_now = 2026-10-24T00:30:00Z` → admin·sales 각각 `…:D-1` 1행.
  - "취소·마감 지난 공고는 보내지 않는다": BID1 `status = 'CANCELLED'` → 0. 마감이 p_now 보다 앞이면 0.
  - "비활성 계정·구성원 아닌 사람은 받지 않는다": sales `profiles.status` 비활성 → admin 만. 담당자가 다른 조직 사람이 될 수는 없으니(FK) 관심 행만 본다.
  - "조직마다 따로 센다": ORG2 outsider 가 BID1 관심 → ORG2 행 1개(org_id = ORG2), ORG1 행과 키가 다르다(user 가 다르다).
  - "담당자 없는 공고는 관심 등록자에게만, 둘 다 없으면 0".
  - "authenticated·anon 은 실행 못 한다" → `permission denied for function`.
- [ ] **Step 2: 실패 확인.** Run: `node --test --test-name-pattern="send_deadline_reminders|20261022000110" scripts/database.test.mjs` → FAIL.
- [ ] **Step 3: 함수를 쓴다.**
- [ ] **Step 4: 통과 확인.** 같은 명령 PASS, 이어서 전체 `node --test scripts/database.test.mjs` PASS.
- [ ] **Step 5: `pnpm db:types`.**
- [ ] **Step 6: 커밋(fa).** `feat(db): 관심 공고 마감 알림 함수 추가`

### Task 3: 서버 도메인 `web/server/watchlist/`

**Files:**
- Create: `web/server/watchlist/watchlist.model.ts`, `watchlist.repo.ts`, `watchlist.service.ts`, `watchlist.service.test.ts`, `index.ts`
- Modify: `web/lodestar.config.ts` 는 고치지 못한다(편집 금지). 새 도메인이 기존 규칙(`server/<도메인>`)으로 잡히는지 `pnpm -C web lint:arch`(있는 이름으로) 로 확인하고, 막히면 멈추고 보고.

**Interfaces:**
- Consumes: Task 1 의 표·함수 타입.
- Produces(배럴에서):
  - `type WatchScope = { orgId: string; userId: string }`
  - `type WatchState = { bidId: string; watched: boolean; watcherCount: number }`
  - `type WatchlistRepo = { bidExists(bidId: string): Promise<boolean>; addWatch(scope: WatchScope, bidId: string): Promise<void>; removeWatch(scope: WatchScope, bidId: string): Promise<void>; isWatching(scope: WatchScope, bidId: string): Promise<boolean>; countWatchers(bidId: string): Promise<number>; listMyWatchedBidIds(scope: WatchScope): Promise<string[]> }`
  - `const watchlistRepo: WatchlistRepo`(요청마다 `await getSupabase()`. `addWatch` 는 `upsert(…, { onConflict: "org_id,user_id,bid_id", ignoreDuplicates: true })`, `countWatchers` 는 `rpc("bid_watch_count")`)
  - `watchBid(scope, bidId, deps?: { repo: WatchlistRepo }): Promise<WatchResult>` / `unwatchBid(...)`: `WatchResult = { ok: true; status: 200; data: WatchState } | { ok: false; status: 404; code: "NOT_FOUND"; message: "공고를 찾을 수 없습니다"; details: { resource: "bid" } }`
  - `getWatchSummary(scope, bidId, deps?): Promise<{ watched: boolean; watcherCount: number }>`(상세 화면용)
  - `listMyWatchedBidIds(scope, deps?): Promise<string[]>`(목록 화면용)
- 다른 도메인(bids 등)을 import 하지 않는다.

- [ ] **Step 1: 실패하는 단위 시험(`watchlist.service.test.ts`, 가짜 repo):** "없는 공고 → 404 NOT_FOUND, 저장 안 부름" · "watchBid 두 번 → 두 번 다 200 { watched: true }, addWatch 2회 호출, 오류 없음" · "unwatchBid 이미 없음 → 200 { watched: false }" · "응답 watcherCount 는 저장 뒤 countWatchers 값" · "addWatch 가 던지면 그대로 던진다(500 은 입구가 만든다)".
- [ ] **Step 2: 실패 확인.** Run: `pnpm -C web exec vitest run server/watchlist` → FAIL(모듈 없음).
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** 같은 명령 PASS, `pnpm -C web typecheck`(스크립트 이름은 package.json 확인) PASS.
- [ ] **Step 5: 커밋(fa).** `feat(web): 관심 공고 도메인 추가`

### Task 4: 목록 `watched=me` 와 돌아가기 주소

**Files:**
- Modify: `web/server/bids/bid-query.ts`(`BidListQuery.watched: "me" | null`, 스키마 `watched: z.literal("me").optional()`, `fingerprintOf` 는 `query.watched === "me"` 일 때만 끝에 `"watched:me"` 를 더한다), `web/server/bids/bid-query.test.ts`
- Modify: `web/server/bids/bids.supabase.ts`(`filteredBids` 가 `query.watched === "me"` 이면 `watched_bid_list_items`, 아니면 `bid_list_items` 에서 같은 필터를 건다. 타입 단언 없이 — 필터 적용을 두 원본에 같이 쓰는 작은 제네릭 함수로), `web/server/bids/bids.supabase.test.ts`
- Modify: `web/app/api/v1/bids-contract.test.ts`(`watched=me` 200, `watched=all` 400 VALIDATION_ERROR, 커서 지문에 watched 포함 — watched 없는 커서를 watched=me 로 쓰면 기존 커서 거절 규칙대로)
- Modify: `web/app/(app)/(work)/bids/[id]/back-href.ts`·`back-href.test.ts`: `list` 를 읽은 결과 `watched === "me"` 이면 `/watchlist` + (watched 를 뺀 나머지 조건), 아니면 지금 그대로.

**Interfaces:**
- Produces: `parseBidListQuery` 결과에 `watched`. 화면 쪽 `/bids` 의 `list-query.ts` LIST_KEYS 는 바꾸지 않는다(`/bids?watched=me` 는 무시 → `/bids` 는 늘 전체). `/watchlist` 는 Task 6 에서 자기 쿼리 변환을 쓴다.

- [ ] **Step 1: 실패하는 시험:** 회귀(12 조건, ADR-042 ②) "watched 가 없으면 bid_list_items 를 읽고 응답·정렬·필터·커서 지문이 지금과 같다"(기존 계약 시험의 기대 본문 그대로 + `fingerprintOf` 가 watched null 일 때 바뀌기 전 값과 같음 — 이미 발급된 커서가 깨지지 않게 watched 가 null 이면 지문 입력에 넣지 않는다); bid-query "watched 없음 → null, me → 'me', 반복·다른 값 → issue path 'watched'", "fingerprint 가 watched me 로 달라진다"; bids.supabase "watched=me 면 watched_bid_list_items 를 읽는다(가짜 클라이언트가 받은 from 이름)"; back-href "list=watched=me&q=클라우드 → /watchlist?q=클라우드", "list=watched=me → /watchlist", "list=q=x → /bids?q=x(기존)".
- [ ] **Step 2: 실패 확인.** Run: `pnpm -C web exec vitest run server/bids/bid-query.test.ts server/bids/bids.supabase.test.ts "app/(app)/(work)/bids/[id]/back-href.test.ts" app/api/v1/bids-contract.test.ts` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** 같은 명령 PASS.
- [ ] **Step 5: 커밋(fa).** `feat(web): 공고 목록 관심 공고 조건 추가`

### Task 5: `PUT·DELETE /api/v1/bids/:id/watch`

**Files:**
- Create: `web/app/api/v1/bids/[id]/watch/route.ts`, `web/app/_lib/watch-deps.ts`(시험이 바꿔 끼우는 저장 주입 자리), `web/app/api/v1/watch-contract.test.ts`(11 G5 다른 조직 범위 시험 포함 — 공유 파일 `tenant-isolation.test.ts` 는 고치지 않는다)

**Interfaces:**
- Consumes: Task 3 `watchBid`·`unwatchBid`·`watchlistRepo`.
- Produces: `PUT`·`DELETE` 둘 다 `businessRoute(request, ctx => …)`, `isUuid(id)` 아니면 `pathNotFound("bid")`, 본문을 읽지 않는다. 응답 200 `{ bidId, watched, watcherCount }`.

- [ ] **Step 1: 실패하는 계약 시험:** "PUT 200 { watched: true, watcherCount }" · "PUT 두 번 → 둘 다 200 같은 본문" · "DELETE 없던 관심 → 200 { watched: false }" · "UUID 아님 → 404 NOT_FOUND resource bid, 저장 안 부름" · "없는 공고 → 404" · "로그인 없음·CSRF 실패는 기존 입구와 같은 응답"(기존 계약 시험의 도우미 재사용) · "VIEWER 도 200".
- [ ] **Step 2: 실패 확인.** Run: `pnpm -C web exec vitest run app/api/v1/watch-contract.test.ts app/api/v1/tenant-isolation.test.ts` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** PASS.
- [ ] **Step 5: 커밋(fa).** `feat(web): 관심 등록·해제 API 추가`

### Task 6: 화면 — ★ 토글·`/bids`·`/watchlist`·상세 머리·사이드바

**Files:**(이름은 디자인 스펙이 다르게 정하면 그쪽을 따른다)
- Create: `web/components/bids/watch-toggle.tsx`(클라이언트 ★ 버튼), `web/app/(app)/(work)/bids/watch-bid.ts`(fetch PUT/DELETE, `api-envelope` 의 `failureOf`·`NETWORK_*` 재사용), `web/app/(app)/(work)/watchlist/page.tsx`·`loading.tsx`·`error.tsx`·`watchlist-copy.ts`·`list-query.ts`(+`list-query.test.ts`), 브라우저 시험 `web/components/bids/watch-toggle.browser.test.tsx`·`web/app/(app)/(work)/watchlist/watchlist.browser.test.tsx`
- Modify: `web/components/bids/bid-table.tsx`(★ 열은 선택 prop 이 있을 때만. compact(대시보드)에는 없다), `web/app/(app)/(work)/bids/bid-list-view.tsx`·`bid-list-more.tsx`(관심 id 목록·빈 상태 바꿔 끼우기 prop), `web/app/(app)/(work)/bids/page.tsx`(본인 관심 id 를 읽어 넘김), `web/app/(app)/(work)/bids/[id]/page.tsx`·`bid-detail-view.tsx`(머리에 ★·"관심 N명"), `web/app/_lib/work-data.ts`(로더 `loadMyWatchedBidIds(scope)`·`loadWatchSummary(scope, bidId)`), `web/components/app-nav.ts`(관심 공고 줄의 `status: "planned"` 만 지움)·`app-nav.test.ts`(관심 공고 기대값)
- 9c 의 `bids/page.tsx`·`loading.tsx` 덧붙임(`BidsSourceNav`)과 93 의 `bid-detail-view.tsx` 덧붙임(`revisionsHref`)은 줄이 다르다. 먼저 병합된 쪽 위에 맞춘다.

**Interfaces:**
- Consumes: Task 3 `listMyWatchedBidIds`·`getWatchSummary`, Task 4 `watched` 쿼리, Task 5 API.
- `/watchlist` 의 `list-query.ts`: `/bids` 의 `listQueryOf` 와 같은 규칙에 `watched=me` 를 고정으로 더한다. 돌려주는 `search` 에는 `watched=me` 가 들어간다(더 보기 API 가 같은 조건을 읽게). 필터 막대·[필터 초기화]는 `/watchlist` 로 간다.

- [ ] **Step 1: 실패하는 시험:** watchlist `list-query.test.ts`("조건 없음 → watched me + 기본 상태", "잘못된 키는 버림", "search 에 watched=me 포함"); 브라우저 시험(디자인 스펙의 측정 항목 그대로): ★ `aria-pressed` 바뀜, 이름 "관심 공고에 추가"/"관심 공고에서 빼기", 실패 응답이면 되돌리고 토스트, 진행 중 두 번 누르기 막음, ★ 클릭이 행 열기를 부르지 않음, `/watchlist` 빈 상태 두 종류, 1440·1280 표 넘침 없음, 상세 머리 "관심 N명" 이 응답 watcherCount 로 바뀜. app-nav 시험: `/watchlist` 링크(planned 아님), `currentNavGroupId("/watchlist") = "work"`, `screenLabelOf("/watchlist") = "관심 공고"`.
- [ ] **Step 2: 실패 확인.** Run: `pnpm -C web exec vitest run "app/(app)/(work)/watchlist" components/app-nav.test.ts` 와 `bash …/verify-slot.sh pnpm -C web test:browser -- <새 브라우저 시험 파일들>` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** 같은 명령 PASS. 기존 `bid-list.browser.test.tsx`·`bid-detail-view.browser.test.tsx`·`bid-table-font.browser.test.tsx` 도 PASS.
- [ ] **Step 5: 커밋(fa).** 화면 묶음 1~2개: `feat(web): 관심 공고 화면과 별 토글 추가`

### Task 7: worker 마감 알림 주기 작업

**Files:**
- Create: `web/server/notifications/deadline.ts`(store 포트·`runDeadlineReminders`), `web/server/notifications/deadline.test.ts`, `web/worker/deadline-reminders.ts`, `web/worker/deadline-reminders.test.ts`
- Modify: `web/server/notifications/index.ts`(끝에 export 덧붙임만), `web/worker/main.ts`(import 1줄 + `WORKER_REGISTRATIONS` 끝에 `deadlineWorkerRegistration`), `web/worker/main.test.ts`("WORKER_REGISTRATIONS" 기대 목록에 더함)

**Interfaces:**
- Consumes: Task 2 의 `send_deadline_reminders`.
- Produces:
  - `type DeadlineReminderStore = { sendDue(now: Date): Promise<number> }`, `createDeadlineReminderStore(admin: SupabaseAdmin): DeadlineReminderStore`(`rpc("send_deadline_reminders", { p_now: now.toISOString() })`)
  - `runDeadlineReminders(deps: { store; now: () => Date; log: (line: string) => void }): Promise<number>` — 넣은 수를 JSON 한 줄 `{"event":"deadline_reminders","inserted":n}` 로 남긴다. 0 이면 남기지 않는다.
  - worker: `readDeadlineSettings(env)` — `DEADLINE_REMINDER_INTERVAL_MS` 빈 값 기본 300000, 60000~3600000 10진 정수만, 틀리면 `worker env 오류: DEADLINE_REMINDER_INTERVAL_MS`(값은 싣지 않는다). `startDeadlineReminders(deps, timers?)` — 기동 때 한 번, 그 뒤 interval 마다, 겹치지 않고, 오류는 로그 한 줄로 삼키고, stop 은 진행 중 회차를 최대 5초 기다린다(`notify-outbox.ts` 의 `startNotifier` 와 같은 모양). `deadlineWorkerRegistration: WorkerRegistration` — 1단계에서 env 검증, 2단계에서 `getSupabaseAdmin()`, Redis 연결은 쓰지 않는다.
  - 새 env 이름 `DEADLINE_REMINDER_INTERVAL_MS` 는 `.env.example`·`infra/env/*.env.example` 에 키 이름과 기본값만 더한다(값 읽기 금지 파일 규칙 지킴: 예시 파일을 Read 로 열지 않고 `grep -n NOTIFY_POLL_INTERVAL_MS` 로 줄 위치만 찾아 그 옆에 더한다 — `.env.example` 읽기가 가드에 막히면 멈추고 보고).

- [ ] **Step 1: 실패하는 시험:** deadline.test.ts "store 반환 수를 돌려주고 n>0 이면 로그 한 줄, 0 이면 로그 없음", "now() 를 그대로 넘긴다", "FX-14 하루 1회: 같은 날 두 번 부르면 store 가 0 을 돌려 로그 없음"(가짜 store 가 키 집합으로 흉내); deadline-reminders.test.ts "설정 기본·경계·잘못된 값", "기동 때 한 번, interval 뒤 한 번", "회차가 겹치지 않음", "회차 오류는 로그 한 줄, 다음 회차는 돈다", "stop 은 진행 중 회차를 기다린다"; main.test.ts 목록에 `deadlineWorkerRegistration`.
- [ ] **Step 2: 실패 확인.** Run: `pnpm -C web exec vitest run server/notifications/deadline.test.ts worker/deadline-reminders.test.ts worker/main.test.ts` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인.** PASS.
- [ ] **Step 5: 커밋(fa).** `feat(worker): 관심 공고 마감 알림 주기 작업 추가`

### Task 8: 검증·실앱·증거

**Files:**
- Create: `docs/evidence/phase-3/n3-watchlist/20261022-n3-watchlist-report.md` + 스크린샷(1440·1280: `/bids` ★, `/watchlist` 채운 화면·빈 화면, 상세 머리 "관심 N명"), 브라우저 시험 기록 txt
- Modify: `docs/PROGRESS.md`(작업 로그 한 행), 스펙 상태

- [ ] **Step 1:** `bash …/verify-slot.sh pnpm verify` → exit 0. 루트·web·AI·decision 개수를 적는다.
- [ ] **Step 2:** 격리 Supabase(`supabase start --workdir` 다른 project_id, 54321 금지)·`AI_PROVIDER=mock` 로 web 만 띄워 ★ 등록 → `/watchlist` → 해제 → 상세 "관심 N명" 을 1440·1280 에서 본다. 다 보면 내 dev 서버·격리 스택만 끈다(내 PID).
- [ ] **Step 3:** 마감 알림 실앱 1회: 격리 DB 에서 asWorker 로 `select public.send_deadline_reminders('<KST 09:00 이후 고정 시각>')` → 알림 목록(`/notifications`)에 1건, 다시 불러도 1건.
- [ ] **Step 4:** 증거·PROGRESS 커밋(fa) `docs: N3 관심 공고 검증 기록 추가`. 기준점(브랜치 해시·병합한 main 해시·verify 개수·트리 깨끗)을 3e 에, 사본을 45 에(마이그레이션 두 파일명·함수 이름·권한·`bid_watch_count` 본문 sha256, 05 `GET /bids` 새 선택 파라미터 `watched=me`·`PUT·DELETE /bids/:id/watch` 응답 모양, 13 마감 알림 직접 삽입 예외), 12 에 한 줄.
