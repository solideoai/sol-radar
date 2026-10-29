---
title: "IT 공고만 보이기 구현 계획"
status: draft
tags: [sol-radar, plan, bids, ingestion, analysis, hackathon]
updated: 2026-10-29
---

# IT 공고만 보이기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT가 아닌 공고를 모든 목록·집계에서 숨기고, `/bids` 에 분야 키워드 칩·"AI·SI 우선" 묶음·추천순(SOL Score) 정렬을 넣고, 마감 전 IT 공고를 한 번 일괄 분석한다.

**Architecture:** IT 범위 판정은 DB 함수 하나(`public.it_scope_of`)에 두고, 목록 뷰 `opportunity_list_items` 의 새 열 `it_scope`·`tags`·`recommend_key` 와 `bid_notices` 계산 열 `it_scope` 로 모든 화면이 같은 판정을 읽는다. 수집·저장은 바꾸지 않는다(회사 ingest Worker 재배포 없음). 일괄 분석은 `demo-preanalyze` 모양의 새 CLI 가 회사 Worker 컨테이너에서 analysis 큐에 넣는다.

**Tech Stack:** Supabase Postgres(뷰·SQL 함수, PGlite 정책 시험 `scripts/database.test.mjs`), Next.js 16 `web/`(서버 도메인 `web/server/opportunities`·`calendar`·`gaps`·`market`·`program-notices`·`analysis`), BullMQ worker CLI(`web/worker`), Vitest.

**Spec:** [`polaris/specs/in-progress/2026-10-29-it-bid-scope.md`](../../polaris/specs/in-progress/2026-10-29-it-bid-scope.md)

## Global Constraints

- 화면 동결 2026-11-01, 제출 11-03, 발표 11-04. 운영 반영과 D1 촬영 화면 확인은 동결 전.
- 운영 변경은 각각 사용자 승인 뒤: `pnpm db:push`, main push(Vercel 배포), 회사 컨테이너 변경, 일괄 분석 실행.
- 회사 서버: 나라장터 ingest Worker 재시작 금지. `sol-radar-app` checkout HEAD 를 옮기지 않는다(22:15 `sol-refill-20261029` 가 HEAD==`cbb3831e86da` 를 확인).
- 수집 단계에서 공고를 버리지 않는다(ADR-047 보존 원칙). 숨김은 읽기에서만.
- SOL Score 계산식·가중치·임계값(`sol-v0.1.0`)·관련성 분류기 `relevance-v0.1`(TS) 은 바꾸지 않는다.
- 데모(FX, `is_demo`)는 항상 IT 범위 안. FX 재분석 금지(FX-01 은 언제나, FX-02 는 촬영 전).
- 금지 문구: 승률·확률·가능성·수주 금액·점유율·경쟁사·%. 칩·정렬·빈 상태·로그에 쓰지 않는다.
- 마이그레이션은 새 파일로만. `web/lib/database.types.ts` 는 `pnpm db:types` 로만 만들고 같은 커밋에 넣는다.
- 도메인 import 는 배럴(`@/server/<도메인>`)로만, `../` 대신 `@/`. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip` 금지.
- 화면은 데스크톱 1440·1280 두 폭만 확인한다. 개발 중 `pnpm verify:changed`, 통합 전 `pnpm verify`. 무거운 검증·`git commit` 은 슬롯 스크립트로 감싼다.
- `.env*` 는 어떤 도구로도 읽지 않는다. 막히면 우회하지 말고 보고한다.

## Review Focus

1. 데모 경로(`?origin=demo`)에서 FX 19건이 그대로 보여야 한다. `raw_payload` 에 공식 분류가 없는 fixture 가 숨겨지면 발표 촬영이 깨진다 → Task 1 시험 `fixture 공고는 늘 IT 범위다`.
2. 일괄 분석 run 이 카카오 `BID_RECOMMENDED` outbox 를 만들면, 알림 Worker 를 나중에 켤 때 수백 통이 나간다. `finish_score_run` 은 `requested_by` 가 있을 때만 outbox 를 쓴다(`20261023000701`) → Task 5 시험 `일괄 분석 run 행에는 requested_by 가 없다`.
3. 관심 공고(`watched=me`)는 IT 밖이어도 보여야 한다 → Task 2 시험 `관심 목록에는 IT 범위 조건을 걸지 않는다`.
4. 추천순 두 번째 쪽에서 공고가 겹치거나 빠지면 안 된다(키셋 커서) → Task 2 시험 `추천순 커서는 recommend_key 오름차순으로 이어 간다`.
5. 일괄 분석이 analysis 큐를 몇 시간 막으면 사람의 [분석]이 기다린다 → Task 5 시험 `동시에 넣는 run 은 maxInFlight 를 넘지 않는다`.

---

## 파일 지도

| 파일 | 역할 | Task |
|---|---|---|
| `supabase/migrations/20261029000300_it_bid_scope.sql` (새) | 판정 함수·정렬 키 함수·계산 열, 뷰·집계 함수 재정의 | 1 |
| `scripts/database.test.mjs` | IT 범위 시험 추가, 기존 live 공고 시험의 `raw_payload` 보강 | 1 |
| `web/lib/database.types.ts` | 생성물 | 1 |
| `web/server/opportunities/keywords.ts` (새) | 칩 8개 정의·PostgREST 조건 | 2 |
| `web/server/opportunities/query.ts`·`repo.ts`·`model.ts`·`index.ts` | `keyword`·`recommended` 정렬·`it_scope` 조건 | 2 |
| `web/components/work/opportunities-filters.tsx`·`opportunities-copy.ts`, `web/app/(app)/(work)/bids/page.tsx`·`bid-list-view.tsx` | 칩 줄·"AI·SI 우선"·추천순·개수 문구 | 3 |
| `web/server/calendar/*`·`gaps/*`·`market/*` | 관련성 상태 대신 `it_scope` | 4 |
| `web/server/program-notices/program-notice.model.ts`·`list.service.ts` | 지원사업 IT 판정 | 4 |
| `web/server/analysis/it-batch.model.ts` (새)·`analysis.repo.ts`·`index.ts` | 대상 선택·멱등 키·run 행·저장 port | 5 |
| `web/worker/it-batch-analyze.ts` (새)·`web/package.json` | 일괄 분석 CLI | 5 |
| `docs/16-DECISIONS.md`·`docs/PROGRESS.md`·스펙 | ADR-069·기록 | 6 |

작업 분배 제안(마스터 45 가 병합): Task 1 → 0f, Task 2·3 → df, Task 4 → ac, Task 5 → 09, Task 6·7 → 45. Task 2~5 는 Task 1 의 생성 타입이 main 에 들어간 뒤 시작한다. 작업자는 각자 `sol-radar-worktrees/it-scope-<n>` worktree·`feat/it-scope-<n>` 브랜치에서 일하고, main 병합은 45 가 diff·시험을 확인한 뒤 한다.

---

### Task 1: IT 범위 판정·정렬 키(DB)

**Files:**
- Create: `supabase/migrations/20261029000300_it_bid_scope.sql`
- Modify: `scripts/database.test.mjs` (새 describe + 기존 live 공고 시험 seed)
- Generate: `web/lib/database.types.ts`

**Interfaces:**
- Produces (SQL, `authenticated`·`service_role` 실행 권한):
  - `public.it_scope_ai_title(p_title text) returns boolean` immutable
  - `public.it_scope_of(p_source text, p_is_demo boolean, p_title text, p_procurement_class text, p_relevance_state text) returns boolean` immutable
  - `public.opportunity_priority_tier(p_categories text[], p_title text) returns integer` immutable — 1 AI·AX, 2 SI, 3 나머지
  - `public.opportunity_recommend_key(p_score numeric, p_recommendation text, p_deadline_at timestamptz, p_published_at timestamptz) returns text` immutable
  - 계산 열 `public.it_scope(public.bid_notices) returns boolean` stable — PostgREST 에서 `select=...,it_scope` 와 `it_scope=eq.true` 로 쓴다
  - 뷰 `opportunity_list_items`: `categories` 는 유효 분류, `relevance_rank` 는 이제 우선 묶음(1/2/3), 끝에 `tags text[]`·`it_scope boolean`·`recommend_key text` 추가. `watched_opportunity_list_items` 도 새 열을 갖게 다시 만든다
  - `procurement_summary`·`procurement_live_metrics` 는 `it_scope` 행만 센다. `procurement_filter_options` 는 IT 범위 공고의 기관·회사만 돌려준다
- Consumes: 없음

정해 둔 값:

- AI 제목 정규식(대소문자 무시): `(^|[^a-z0-9_])(ai|ax|llm|rag)([^a-z0-9_]|$)|인공지능|생성형|챗봇|머신러닝|딥러닝|초거대`. "지능형"은 넣지 않는다.
- 공식 IT 분류 정규식: `정보시스템|소프트웨어|데이터|정보인프라|클라우드|공간정보DB|정보통신|네트워크|전산|정보화`.
- `it_scope_of` 순서: ① `p_is_demo` 또는 `p_source = 'fixture'` → true. ② `p_source = 'g2b-bid-notice'` 이고 `nullif(btrim(p_procurement_class),'')` 가 있으면 → (공식 IT 분류) 또는 (AI 제목 이고 분류에 `연구조사`). ③ 그 밖 → `p_relevance_state in ('RELEVANT','CANDIDATE')`.
- 뷰의 분류 값: `p_procurement_class = rev.raw_payload->>'pubPrcrmntClsfcNm'`, `p_relevance_state = coalesce(rel.state,'UNCLASSIFIED')`.
- 유효 `categories` = `rel.categories` ∪ (`AI_AX` — AI 제목일 때) ∪ (`SI_SW` — 공식 IT 분류이고 `rel.categories` 가 비었을 때). 중복 없이.
- `tags` = `rel.tags` ∪ (`maintenance` — 공식 분류에 `유지` 가 있을 때).
- `opportunity_priority_tier`: 유효 categories 에 `AI_AX` 가 있거나 AI 제목 → 1, `SI_SW` → 2, 그 밖 → 3.
- `opportunity_recommend_key`(오름차순이 추천순):
  - 분석됨(`p_score` not null): 앞자리 `0`(비추천 아님) 또는 `1`(`p_recommendation = 'NO_BID'`) + `lpad((1000 - round(p_score*10))::int::text, 4, '0')` + 마감 `to_char(p_deadline_at at time zone 'UTC','YYYYMMDDHH24MISS')`(null 이면 `99999999999999`).
  - 분석 안 됨: `2` + `0000` + `lpad((9999999999 - floor(extract(epoch from p_published_at)))::bigint::text, 10, '0')`(null 이면 `9999999999`).
- 뷰 열 순서는 그대로 두고 새 열만 끝에 붙인다(`create or replace view` 가 쓸 수 있게). `relevance_rank` 이름을 바꾸지 않는 이유가 이것이다. 마이그레이션 머리 주석에 적는다.

- [ ] **Step 1: 실패하는 시험을 쓴다** — `scripts/database.test.mjs` 에 `describe("IT 범위(ADR-069)")`:

```js
it("나라장터 공식 분류·AI 연구·행사 제외·지능형 오탐·분류 없음을 판정한다", async (t) => {
  const db = await migratedDb(t);
  const cases = [
    ["g2b-bid-notice", false, "2027년 남북교류협력시스템 유지관리", "정보시스템유지관리서비스", "UNCLASSIFIED", true],
    ["g2b-bid-notice", false, "건설폐기물 처리용역", "건설폐기물처리서비스", "UNCLASSIFIED", false],
    ["g2b-bid-notice", false, "익산시 인공지능산업 기본계획 수립 연구용역", "기타연구조사서비스", "CANDIDATE", true],
    ["g2b-bid-notice", false, "CES 2027 AI 혁신 포럼 행사대행", "전시회기획및대행서비스", "CANDIDATE", false],
    ["g2b-bid-notice", false, "지능형교통시스템(ITS) 통합운영 연구", "기타연구조사서비스", "UNCLASSIFIED", false],
    ["g2b-bid-notice", false, "사전규격 정보화 사업", null, "RELEVANT", true],
    ["kepco-ebid-contract", false, "철탑 제작", null, "UNCLASSIFIED", false],
    ["kepco-ebid-contract", false, "배전 정보시스템 고도화", null, "CANDIDATE", true],
    ["fixture", true, "FX-01", null, "UNCLASSIFIED", true],
  ];
  for (const [source, isDemo, title, cls, state, expected] of cases) {
    const r = await db.query("select public.it_scope_of($1,$2,$3,$4,$5) v", [source, isDemo, title, cls, state]);
    assert.equal(r.rows[0].v, expected, title);
  }
});
it("fixture 공고는 늘 IT 범위다", async (t) => { /* solDb seed 의 데모 2건이 opportunity_list_items 에서 it_scope=true */ });
it("목록 뷰와 집계 함수는 IT 범위 밖 live 공고를 세지 않는다", async (t) => {
  /* live G2B 2건: raw_payload {"pubPrcrmntClsfcNm":"정보시스템개발서비스"} 과 {"pubPrcrmntClsfcNm":"건설장비임대서비스"}.
     assert: 뷰의 it_scope 는 true·false, procurement_summary(origin live).totalOpportunities == 1,
     select ... from bid_notices b where public.it_scope(b) 가 IT 1건만 돌려준다 */
});
it("AI·SI 우선 묶음과 추천순 키가 정한 순서를 만든다", async (t) => {
  /* tier: (['AI_AX','SI_SW'],'x')=1, ([],'생성형 AI 플랫폼')=1, (['SI_SW'],'x')=2, (['CLOUD'],'x')=3.
     key 오름차순 정렬 결과: score 80 BID < score 70 WATCH < score 90 NO_BID < 미분석(published 10-29) < 미분석(published 10-20) */
});
```

- [ ] **Step 2: 실패를 확인한다** — Run: `node --test --test-name-pattern "IT 범위" scripts/database.test.mjs` · Expected: FAIL `function public.it_scope_of(...) does not exist`

- [ ] **Step 3: 마이그레이션을 쓴다** — 위 Interfaces·정해 둔 값 그대로. 뷰 본문은 `20261023000200_procurement_reads.sql:3-47` 을, 두 집계 함수 본문은 `20261025000200_procurement_live_metrics.sql:28-93` 을 복사해 `it_scope` 조건만 더한다. `watched_opportunity_list_items` 는 `20261023000300_watched_opportunities.sql:3-11` 을 다시 만든다. 새 함수 모두 `revoke all ... from public, anon` 뒤 필요한 역할에만 grant.

- [ ] **Step 4: 기존 시험의 seed 를 보강한다** — 기존 live 공고 시험(B3 실수집 지표 L1113, ADR047 L917·L1034, B2 origin L1238, 관심 L2070 근처)의 live `bid_revisions` 삽입 `raw_payload '{}'` 를 `'{"pubPrcrmntClsfcNm":"정보시스템개발서비스"}'` 로 바꾼다. 단언은 바꾸지 않는다.

- [ ] **Step 5: 통과를 확인한다** — Run: `node --test scripts/database.test.mjs` · Expected: 전부 PASS

- [ ] **Step 6: 타입을 만든다** — Run: `pnpm db:types` · Expected: `database.types.ts` 의 `opportunity_list_items` Row 에 `it_scope`·`tags`·`recommend_key`, Functions 에 `it_scope_of` 등

- [ ] **Step 7: 커밋** — `git add supabase/migrations/20261029000300_it_bid_scope.sql scripts/database.test.mjs web/lib/database.types.ts` → `feat(db): IT 범위 판정과 추천순 키 추가`

### Task 2: 목록 조회 — 키워드·추천순·IT 범위

**Files:**
- Create: `web/server/opportunities/keywords.ts`, `web/server/opportunities/keywords.test.ts`
- Modify: `web/server/opportunities/query.ts`, `repo.ts`, `index.ts`, `query.test.ts`

**Interfaces:**
- Consumes: Task 1 뷰 열 `it_scope`·`tags`·`recommend_key`·`relevance_rank`(묶음)
- Produces:
  - `export const OPPORTUNITY_KEYWORD_IDS = ["AI_AX","SI_SW","CLOUD","DATA","SECURITY","DIGITAL_TWIN","MAINTENANCE","ISP_ISMP"] as const`, `type OpportunityKeyword`
  - `export const OPPORTUNITY_KEYWORDS: Record<OpportunityKeyword, { categories: string[]; tags: string[] }>` — AI_AX→cat AI_AX · SI_SW→cat SI_SW · CLOUD→cat CLOUD · DATA→cat DATA · SECURITY→cat SECURITY · DIGITAL_TWIN→cat DIGITAL_TWIN + tags BIM·smartcity · MAINTENANCE→tag maintenance · ISP_ISMP→tags ISP·ISMP
  - `export function keywordFilterOf(ids: readonly OpportunityKeyword[]): string | null` — PostgREST `or` 식, 빈 배열이면 null
  - `OpportunityQuery.keyword: OpportunityKeyword[]`, 주소 파라미터 `keyword`(반복)
  - `OPPORTUNITY_SORTS = ["recommended","publishedAt:desc","deadlineAt:asc","score:desc","budgetKrw:desc"]`, 기본값 `"recommended"`
  - 배럴에서 `OPPORTUNITY_KEYWORD_IDS`·`OpportunityKeyword` 를 내보낸다(Task 3 이 쓴다)

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
// keywords.test.ts
it("고른 칩을 분류·태그 OR 식으로 바꾼다", () => {
  expect(keywordFilterOf([])).toBeNull();
  expect(keywordFilterOf(["AI_AX", "MAINTENANCE"])).toBe("categories.ov.{AI_AX},tags.ov.{maintenance}");
  expect(keywordFilterOf(["DIGITAL_TWIN"])).toBe("categories.ov.{DIGITAL_TWIN},tags.ov.{BIM,smartcity}");
});
// query.test.ts
it("기본 정렬은 추천순이고 키워드를 복귀 URL에 보존한다", () => {
  const q = parse({ keyword: ["AI_AX", "ISP_ISMP"] });
  expect(q.sort).toBe("recommended");
  expect(q.sortExplicit).toBe(false);
  expect(new URLSearchParams(serializeOpportunityQuery(q)).getAll("keyword")).toEqual(["AI_AX", "ISP_ISMP"]);
  expect(parseOpportunityQuery({ keyword: "NOPE" }, "live").ok).toBe(false);
});
it("추천순 커서는 recommend_key 오름차순으로 이어 간다", () => {
  const q = { ...parse({}), sort: "recommended" as const, siAiFirst: false, sortExplicit: true };
  const cursor = { ...baseCursor, id: "00000000-0000-4000-8000-000000000001", rank: 2, value: "00200" };
  const expr = opportunityKeyset(q, cursor);
  expect(expr).toContain('recommend_key.gt."00200"');
  expect(expr).not.toContain("recommend_key.lt.");
}); // baseCursor 는 query.test.ts 의 기존 커서 시험 값(scope·version·asOf·issuedAt)을 쓴다
it("관심 목록에는 IT 범위 조건을 걸지 않는다", () => { /* filtered 를 가짜 client 로 불러 watched=me 일 때 eq("it_scope",true) 호출이 없고, 아니면 있다 */ });
```

- [ ] **Step 2: 실패를 확인한다** — Run: `pnpm -C web exec vitest run server/opportunities` · Expected: FAIL(`keywordFilterOf` 없음, 기본 sort `publishedAt:desc`)

- [ ] **Step 3: 구현한다**
  - `keywords.ts` 에 위 상수와 `keywordFilterOf`. 같은 칩이 두 번 와도 식에 한 번만.
  - `query.ts`: `keyword: z.array(z.enum(OPPORTUNITY_KEYWORD_IDS))`, `repeated(raw.keyword)`, serialize 목록에 `"keyword"` 추가, 기본 sort `"recommended"`. 기존 `category` 파라미터는 API 호환으로 남긴다.
  - `repo.ts`: `SORT_COLUMNS.recommended = "recommend_key"`. 오름차순 정렬 = `deadlineAt:asc`·`recommended` 두 개(정렬 방향과 `opportunityKeyset` 의 `dir` 둘 다). 커서 `value` 는 `last.recommend_key`. `filtered()` 는 `q.watched !== "me"` 일 때 `.eq("it_scope", true)`, `keywordFilterOf(q.keyword)` 가 있으면 `.or(그 식)`.

- [ ] **Step 4: 통과를 확인한다** — Run: `pnpm -C web exec vitest run server/opportunities` · Expected: PASS

- [ ] **Step 5: 커밋** — `feat(web): 사업기회 목록 키워드·추천순·IT 범위 조회`

### Task 3: `/bids` 화면 — 칩 줄·AI·SI 우선·추천순

**Files:**
- Modify: `web/components/work/opportunities-filters.tsx`, `web/components/work/opportunities-copy.ts`, `web/app/(app)/(work)/bids/page.tsx`, `web/app/(app)/(work)/bids/bid-list-view.tsx`

**Interfaces:**
- Consumes: Task 2 `OPPORTUNITY_KEYWORD_IDS`, 주소 파라미터 `keyword`·`sort=recommended`·`siAiFirst`

정해 둔 값:

- `opportunities-copy.ts`: `OPPORTUNITY_KEYWORD_LABELS = { AI_AX: "AI·AX", SI_SW: "SI·SW", CLOUD: "클라우드", DATA: "데이터", SECURITY: "보안", DIGITAL_TWIN: "디지털트윈·BIM", MAINTENANCE: "유지관리", ISP_ISMP: "ISP·ISMP" }`. 정렬 이름: `recommended: "추천순"`, `publishedAt:desc: "최신순"`, `deadlineAt:asc: "마감 임박순"`, `score:desc`(기존 이름 유지), `budgetKrw:desc: "예산 큰 순"`.
- 스위치 문구 `공공 SI·AI 우선` → `AI·SI 우선`(id `opportunity-si-ai`, 기본 켬은 그대로).
- 칩 줄은 검색 조건 카드의 맨 위 줄, `role="group" aria-label="분야 키워드"`. 맨 앞 `전체` 버튼(선택 없음), 이어서 칩 8개. 누름 상태는 기존 출처 빠른 선택의 `aria-pressed`·`PRESSED` 관례를 그대로 쓴다. 여러 개 선택 가능.
- 상세 조건의 `분야` 다중 선택(`id="opportunity-category"`)은 없앤다(칩과 겹친다).
- 정렬 Select 기본값 `recommended`, 선택지 맨 앞 `추천순`. `go({ sort: value === "recommended" ? null : value })`.
- `isDefault`·`page.tsx` 의 `hasFilters` 에 `keyword` 를 넣는다(`query.category` 는 그대로 둔다).
- 개수 문구는 "IT 공고 n건". 빈 상태는 "조건에 맞는 IT 공고가 없습니다".

- [ ] **Step 1: 구현한다** — 위 값 그대로. 칩 줄은 1280px 에서 줄바꿈(`flex-wrap`)으로 넘치지 않게.
- [ ] **Step 2: 화면을 본다** — 로컬 dev(`pnpm -C web dev`, 격리 로컬 Supabase)에서 `/bids` 를 1440·1280 두 폭으로 연다. 확인: 칩 8개+전체가 한 카드 안, 칩을 누르면 주소에 `keyword=` 가 붙고 목록이 줄어든다, 정렬 기본이 추천순, 스위치 문구 `AI·SI 우선`, 가로 넘침 없음. 스크린샷을 `docs/evidence/it-scope/` 에 저장.
- [ ] **Step 3: 검증** — Run: `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh pnpm verify:changed` · Expected: exit 0
- [ ] **Step 4: 커밋** — `feat(web): 입찰 공고 분야 키워드 칩과 추천순`

### Task 4: 다른 화면 — 달력·공백·시장·지원사업

**Files:**
- Modify: `web/server/calendar/calendar.repo.ts`·`calendar.model.ts`, `web/server/gaps/gaps.repo.ts`·`gaps.model.ts`, `web/server/market/market.repo.ts`·`market.service.ts`·`market.model.ts`, 각 화면의 "전체/관련" 전환 UI(있으면), `web/server/program-notices/program-notice.model.ts`·`list.service.ts`
- Test: 각 도메인의 기존 `*.test.ts` 에 한 건씩

**Interfaces:**
- Consumes: Task 1 계산 열 `it_scope`(bid_notices)·뷰 열 `it_scope`, `classifyProcurementRelevance` (`@/server/ingestion`)
- Produces: `export function isItProgramNotice(row: { title: string; summary: string | null }): boolean` (`program-notice.model.ts`)

정해 둔 값:

- 달력: 관련성 공고 조회의 select 에 `it_scope` 를 더하고 `isRelevantState(latestRelevanceState(...))` 대신 `it_scope === true` 로 거른다. 관심(`bid_watches`)·프로젝트(`bid_projects`) 일정은 거르지 않는다.
- 공백(gaps)·시장(market): `RELEVANT_STATES` 비교를 지우고 `it_scope` 로 거른다(gaps 는 계산 열, market 은 뷰 열 `.eq("it_scope", true)`). "전체" 범위(`scope=all`·`relevance=all`)도 IT 범위 안만 보인다. 두 값이 같아지므로 화면의 전체/관련 전환이 있으면 없앤다. 파라미터는 받아도 무시한다.
- 지원사업: `isItProgramNotice` = `classifyProcurementRelevance({ title, body: summary }).categories.length > 0`. `list.service.ts` 는 행을 이 함수로 거른 뒤 개수(`total`·`hasAnyNotice`·`isCapped`)를 센다.

- [ ] **Step 1: 실패하는 시험을 쓴다** — 각 한 건:
  - calendar: `IT 범위 밖 공고는 마감 일정에서 빠지고 관심 공고는 남는다`
  - gaps: `scope=all 이어도 it_scope=false 공고는 빠진다`
  - market: `relevance=all 이어도 IT 범위 밖 공고를 세지 않는다`
  - program-notices: `isItProgramNotice` — `{ title: "2026 AI 바우처 지원사업 공고", summary: null }` → true, `{ title: "[전남] 2026년 드론기업 역량강화 지원사업 공고(R&D)", summary: null }` → false, `{ title: "소상공인 지원", summary: "클라우드 전환 비용 지원" }` → true
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/calendar server/gaps server/market server/program-notices` · Expected: 새 시험 FAIL
- [ ] **Step 3: 구현한다** — 위 값 그대로.
- [ ] **Step 4: 통과 확인** — 같은 명령 · Expected: PASS
- [ ] **Step 5: 화면을 본다** — `/calendar`·`/gaps`·`/market`·`/bids/programs` 1440·1280, 넘침·빈 상태 문구 확인
- [ ] **Step 6: 커밋** — `feat(web): 달력·공백·시장·지원사업도 IT 공고만`

### Task 5: IT 공고 일괄 분석 CLI

**Files:**
- Create: `web/server/analysis/it-batch.model.ts`, `web/server/analysis/it-batch.model.test.ts`, `web/worker/it-batch-analyze.ts`, `web/worker/it-batch-analyze.test.ts`
- Modify: `web/server/analysis/analysis.repo.ts`(저장 port 추가), `web/server/analysis/index.ts`, `web/package.json`(script)

**Interfaces:**
- Consumes: Task 1 뷰 열 `it_scope`. 기존 `ANALYSIS_JOB`·`ANALYSIS_JOB_OPTIONS`·`ANALYSIS_QUEUE`·`toAnalysisJobId`·`AnalysisJobData`·`createGatewayClient`·`readGatewayConfig`(`@/server/analysis`), 분석 원문 판정 `hasSourceBody`·`isAnalyzableDocument` 와 같은 조건
- Produces:
  - `type ItBatchTarget = { bidId: string; revisionId: string; revision: number }`
  - `itBatchIdempotencyKey(orgId: string, target: ItBatchTarget, profileRevision: number): string` → `${orgId}:it-batch-${bidId}-r${NN}-p${profileRevision}`
  - `toItBatchRunRow(input): TablesInsert<"score_runs">` — `run_mode: "LIVE"`, `ai_provider: "LOCAL"`, `requested_by` 없음, `extraction_id: null`, `algorithm_version: ALGORITHM_VERSION`
  - `type ItBatchStore = { findOrgBySlug(slug): Promise<string|null>; latestProfile(orgId): Promise<{id;revision}|null>; listTargets(orgId): Promise<{ ready: ItBatchTarget[]; skippedNoSource: number }>; ensureQueuedRun(input): Promise<{ id: string; status: RunState }>; readStatuses(orgId, ids): Promise<{ id; status }[]> }`
  - `createItBatchStore(client: SupabaseClient<Database>): ItBatchStore`
  - `runItBatch(deps: ItBatchDeps, options: { orgSlug: string; maxInFlight: number; limit: number | null; dryRun: boolean; deadlineMs: number }): Promise<{ exitCode: 0|1|2; line: string }>`
  - package script `"it:batch-analyze": "node --conditions=react-server --import tsx worker/it-batch-analyze.ts"`. 인자 `--org-slug <slug>`(필수) `--max-in-flight`(기본 2) `--limit`(기본 없음) `--dry-run` `--deadline-min`(기본 240)

정해 둔 값:

- `listTargets`: `opportunity_list_items` 에서 `org_id`, `it_scope = true`, `is_demo = false`, `source <> 'fixture'`, `stage = 'NOTICE'`, `status in ('OPEN','AMENDED')`, `deadline_at > now`, `sol_score is null`, `latest_run_status is null or = 'FAILED'`. 그 revision 에 정규화 본문(`normalized->>'content'` 공백 아님) 또는 `parse_status in ('PARSED','PARTIAL')`·`text_object_key is not null` 첨부가 있으면 `ready`, 없으면 `skippedNoSource` 로 센다. 마감 임박 순.
- health: `runMode === "live"` 이고 `provider === "local"` 이 아니면 exit 2(`it-batch: live·local 이 아니다(runMode=…, provider=…)`). mock 이나 hosted 로는 돌지 않는다.
- 넣는 방식: 한 번에 하나씩 넣되, 이 CLI 가 넣은 run 중 끝나지 않은(QUEUED·RUNNING) 것이 `maxInFlight` 이상이면 5초마다 상태를 읽으며 기다린다. `deadlineMs` 가 지나면 더 넣지 않고 요약을 낸다.
- 멱등: 같은 키의 run 이 이미 있으면 다시 넣지 않는다. 같은 입력의 진행 중 run 충돌(unique)도 "이미 있음"으로 센다.
- 마지막 줄: `it-batch: targets=N skipped_no_source=M enqueued=E existing=X completed=C partial=P failed=F unfinished=U`. 제목·점수·원문·오류 message 는 찍지 않는다. `--dry-run` 은 `targets`·`skipped_no_source` 만 찍고 아무것도 넣지 않는다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
// it-batch.model.test.ts
it("일괄 분석 run 행에는 requested_by 가 없다", () => {
  const row = toItBatchRunRow({ orgId: "o", bidId: "b", revisionId: "r", companyProfileId: "p", profileRevision: 5, idempotencyKey: "k" });
  expect(row).not.toHaveProperty("requested_by");
  expect(row.run_mode).toBe("LIVE");
  expect(row.ai_provider).toBe("LOCAL");
});
it("멱등 키에 revision 과 프로필 revision 이 들어간다", () => {
  expect(itBatchIdempotencyKey("o", { bidId: "b", revisionId: "r", revision: 3 }, 5)).toBe("o:it-batch-b-r03-p5");
});
// it-batch-analyze.test.ts (가짜 deps)
it("mock·hosted 에서는 넣지 않고 exit 2", …);
it("원문 없는 공고는 넣지 않고 skipped_no_source 로 센다", …);
it("동시에 넣는 run 은 maxInFlight 를 넘지 않는다", …); // 가짜 store 가 상태를 늦게 COMPLETED 로 바꾸고, queue.add 시점마다 미완료 수 ≤ 2
it("--dry-run 은 queue.add 를 부르지 않는다", …);
it("이미 같은 키의 run 이 있으면 다시 넣지 않는다", …);
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/analysis/it-batch.model.test.ts worker/it-batch-analyze.test.ts` · Expected: FAIL(모듈 없음)
- [ ] **Step 3: 구현한다** — `demo-preanalyze.ts` 의 구조(deps 주입·prepare·wait·요약)를 따른다. 단 원문 확인·live 확인·maxInFlight 가 다르다. 진입부는 `REDIS_URL`·service role·`AI_GATEWAY_URL` 을 worker 컨테이너 환경에서 읽는다(값을 로그에 찍지 않는다).
- [ ] **Step 4: 통과 확인** — 같은 명령 · Expected: PASS
- [ ] **Step 5: 커밋** — `feat(worker): IT 공고 1회 일괄 분석 CLI`

### Task 6: 결정·기록 문서

**Files:**
- Modify: `docs/16-DECISIONS.md`(색인 행 + `## ADR-069` 본문), `docs/PROGRESS.md`(최근 작업 로그 한 줄, 10줄 유지), `polaris/specs/in-progress/2026-10-29-it-bid-scope.md`(구현 상태)

- [ ] **Step 1: ADR-069 을 쓴다** — 제목 "IT 공고만 보이기(ADR-047 '숨김 아님' 개정)·분야 키워드·AI·SI 우선·추천순·1회 일괄 분석". 사용자 원문(스펙 §2 D1~D8과 8번 수정 "AI를 가장 최우선, 그 다음 SI")과 반영 문서를 적는다. ADR-047 색인 행 상태에 "(숨김은 ADR-069로 개정)" 을 덧붙인다. 상태는 채택(사용자 결정이 이미 있다).
- [ ] **Step 2: 발표 문서 영향 확인** — `docs/submission/slides-spec.md`·`docs/19-DEMO-SCENARIO.md` 에서 `/bids` 목록·대시보드 숫자가 나오는 장면을 찾아 숫자·문구가 바뀌는 곳만 고친다(바뀌는 곳이 없으면 고치지 않는다).
- [ ] **Step 3: 검증·커밋** — `pnpm verify:changed` → `docs: ADR-069 IT 공고만 보이기`

### Task 7: 통합·운영 반영(45, 단계마다 사용자 승인)

- [ ] **Step 1: 통합 검증** — main 에 Task 1~6 병합 뒤 Run: `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh pnpm verify` · Expected: exit 0. 독립 리뷰 1회(변경 diff 전체).
- [ ] **Step 2: 운영 DB 적용(승인)** — `NODE_EXTRA_CA_CERTS=~/.supabase/prod-ca-2021.crt pnpm db:push`. 적용 뒤 읽기 전용 확인 SQL: 마감 전 `opportunity_list_items` live `it_scope` 건수가 약 393(±신규), 데모 19건 `it_scope=true`.
- [ ] **Step 3: 배포(승인)** — main push → Vercel 배포 success 확인.
- [ ] **Step 4: D1 확인** — 로그인 상태로 `/bids`·`/bids?origin=demo`·`/dashboard`·`/calendar`·`/market`·`/gaps`·`/bids/programs` 를 1440·1280 으로 본다. FX-01 상세의 저장된 추천 분석이 그대로인지 본다(버튼 누르지 않음). 스크린샷 `docs/evidence/it-scope/`.
- [ ] **Step 5: 회사 반영(승인)** — Worker 이미지에 CLI 가 들어가도록 HEAD 를 옮기지 않는 빌드 context 덮어쓰기 방식으로 analysis 용 컨테이너만 준비한다. ingest Worker 는 재시작하지 않는다. 22:15 예약 작업과 겹치지 않는 시간에 한다.
- [ ] **Step 6: 일괄 분석 실행(승인)** — 먼저 `pnpm -C web it:batch-analyze -- --org-slug <솔리데오 slug> --dry-run` 으로 대상 수를 보고 사용자에게 알린 뒤, 승인을 받아 `--max-in-flight 2` 로 실행한다. 마지막 요약 줄과 시각을 `docs/evidence/it-scope/batch-analyze-<날짜>.md` 에 남긴다.
- [ ] **Step 7: 기록** — PROGRESS 운영 상태 표·로그, 스펙 상태를 `done` 으로 옮길지 사용자에게 묻는다.

## 관련 문서

- [[16-DECISIONS|결정 기록]] ADR-047·059·066
- [[PROGRESS|진행 상황]]
