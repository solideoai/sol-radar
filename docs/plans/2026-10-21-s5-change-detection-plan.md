---
title: "S5 변경 감지 — 구현 계획"
status: draft
tags:
  - sol-radar
  - plan
updated: 2026-10-21
---

# S5 변경 감지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고 정정이 들어오면 revision 전/후를 나란히 보여 주는 화면·API 와, 그 공고를 다루는 조직 사람에게 가는 `BID_CHANGED` 인앱 알림을 만들어 데모 S5(FX-06·07·08·09·10)를 끝까지 돌게 한다.

**Architecture:** 수집 도메인이 저장할 때 이미 적는 `bid_revisions.changed_fields`·`normalized` 를 bids 도메인이 읽어 전/후 비교 뷰를 만든다(수집 도메인 코드는 고치지 않는다). 화면 `/bids/[id]/revisions` 는 서버 컴포넌트가 서비스를 바로 부르고, 05 계약의 두 GET 은 같은 서비스를 Route Handler 로 연다. 알림은 dc 의 outbox 처리기(52adabb 모양) 위에 `BID_CHANGED` 분기 하나를 더해, 이벤트 하나를 조직별 수신자 여럿에게 펼친다.

**Tech Stack:** Next.js 16(App Router, 서버 컴포넌트) · Supabase(Postgres·RLS) · zod · Vitest(단위·브라우저) · Playwright(격리 E2E) · PGlite(`scripts/database.test.mjs`).

**Spec:** 별도 스펙 파일은 없다. 정본 절이 스펙이다 — `docs/19-DEMO-SCENARIO.md` S5(159행~), `docs/07-DATA-PIPELINE.md` §5, `docs/13-NOTIFICATIONS.md` "이벤트와 전달" 표, `docs/06-UI-UX.md` §8 "변경 diff" 줄, `docs/05-API-SPEC.md` §2(`GET /bids/:id/revisions`·`/:rev`)·§4.3(`BidRevisionSummary`). 배정 조건은 12 의 지시(2026-10-21, ADR-037 과 같은 확장 컷 예외)다.

## Global Constraints

- 덧붙이기만 한다. 핵심 컷 경로·계약(`GET /bids/:id` 응답, 수집 저장 함수 `ingest_save_revision`, 분석 흐름)은 바꾸지 않는다.
- freeze 10-23 까지 green 이 아니면 데모에서 뺀다. 화면 진입점(상세의 링크)은 그때 함께 빠질 수 있게 작게 둔다.
- 승률·확률·모바일·결제 코드 금지. 화면 확인은 1440·1280 두 폭만.
- `AI_PROVIDER=mock`. 공공 API·live 실호출 금지. fixture(`batch:"live"`)만 쓴다.
- 마이그레이션은 새 파일만. 처음 이름은 `20261021000100_…`. 기준점을 3e 에 보내기 전에 main 을 합치고, main 최대 번호보다 작거나 같으면 main 에 없는 내 파일만 더 큰 번호로 다시 붙인 뒤 `pnpm db:types` 를 같은 커밋에 넣는다(3e 요청).
- 도메인 경계(lodestar): `server/bids` 는 `server/ingestion` 을 런타임 import 하지 않는다. 바뀐 항목 목록은 저장된 `changed_fields` 를 쓴다.
- 서버 파일은 `import "server-only";` 로 시작한다. 데이터는 anon 키 + RLS 로 읽는다. service role 은 worker(알림 처리기)만.
- `.env` 이름 파일은 어떤 도구로도 읽지 않는다. `node --env-file` 금지. 가드·훅에 막히면 돌아가지 말고 보고한다. `eslint-disable`·`any`·`.skip` 금지.
- 무거운 검증(`pnpm verify`·`verify:quick`·`test:browser`·e2e·build)은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 로 감싼다.
- E2E 는 격리 Supabase·격리 compose 에서만. 54321·클라우드·남의 compose 금지. 백그라운드는 run_in_background, `&` 금지. 프로세스 종료는 자기 PID 만.
- 작업자는 git 상태를 바꾸지 않는다(add·commit 은 각 Task 의 커밋 단계에서만, 이 worktree 안에서만). main 병합·push 금지.
- 문구는 아래 그대로 쓴다.
  - 알림: 정정 `공고가 변경되었습니다.` · 취소 `공고가 취소되었습니다.`
  - 화면 제목: `변경 이력`
  - revision 하나뿐: `처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다.`

## 판정(이 계획이 정한 것 — 12·45 에 알린다)

- **J1 수신자.** 조직별로 그 공고의 결정 담당자·작성자(`bid_reviews.assignee_id`·`reviewer_id`) ∪ 그 공고에 `score_runs` 가 있는 조직의 ADMIN·SALES·ANALYST 회원. 각자 그 조직의 회원이고 활동 계정일 때만 보낸다. 근거: 13 "해당 공고 담당자 + 검토 참여자" + 19 S5 벨 기대(seed 의 결정은 FX-01·FX-03 뿐이라 담당자 규칙만으로는 0건). 틀리면: 수신자 조회 한 함수만 바꾼다.
- **J2 취소도 알린다.** FX-08 `CANCELLED` 는 `BID_CHANGED` 이벤트(07 표)라 `공고가 취소되었습니다.` 로 보낸다. 19 S5 4단계 목록에 FX-08 을 더하는 것은 45 에 요청한다.
- **J3 link** 는 `/bids/<bidId>/revisions`.
- **J4 `BID_CREATED` 는 펼치지 않는다**(PENDING 그대로, 13 해커톤 범위).
- **J5 바뀐 항목은 저장값 `changed_fields`** 를 쓴다. 알 수 없는 이름은 버린다. `amendmentNo` 는 항목 표에 넣지 않고 머리말(차수)에 보인다.
- **J6 순서.** dc(feat/kakao-notify)가 먼저 main 에 들어간다. Task 1~3 은 지금 base(4e62170)에서 하고, Task 4 는 dc 가 main 에 들어간 뒤 main 을 합치고 시작한다. 10-22 12:00 까지 dc 가 main 에 없으면 `feat/kakao-notify` 끝 커밋을 합쳐 시작하고 3e 에 병합 순서 dc → 93 을 알린다. Task 4 가 10-22 안에 green 이 될 것 같지 않으면 Task 1~3(비교 화면)만으로 먼저 기준점을 3e 에 보낸다(12 동의, 판단은 93).
- **J7 API.** 05 의 두 GET 을 구현한다. 화면은 서비스를 직접 부른다(서버 컴포넌트). 전/후 비교 API 는 새로 열지 않는다.

## Review Focus

1. revision 이 하나뿐인 공고(FX-01 등)로 변경 이력에 들어오면 → 빈 상태 문구, 오류 없음. (Task 1 `compareBidRevision` 시험, Task 3 브라우저 시험)
2. `?rev=`·`/:rev` 가 숫자가 아님·0·없는 번호 → 화면은 404, API 는 404 `NOT_FOUND`. (Task 1 계약 시험, Task 3 page 단위 판정)
3. 같은 `BID_CHANGED` 이벤트를 다시·동시에 처리 → 수신자마다 알림 1건. (Task 4 dedupe 시험)
4. 수신자 후보가 정지 계정·조직을 떠난 사람·VIEWER·다른 조직 → 알림 없음. (Task 4 서비스·repo 시험)
5. 긴 본문(live 공고 수천 자) → diff 가 상한을 넘으면 통째 교체로 접고, 1280 폭에서 넘침 없음. (Task 1 `diffText` 상한 시험, Task 3 1280 브라우저 시험)

---

### Task 1: revision 비교 도메인 + 05 GET 두 개

**Files:**
- Create: `web/server/bids/revision.model.ts` (스냅샷 스키마·뷰 타입)
- Create: `web/server/bids/revision-diff.ts` (순수 함수) · Test: `web/server/bids/revision-diff.test.ts`
- Create: `web/server/bids/revision.service.ts` · Test: `web/server/bids/revision.service.test.ts`
- Modify: `web/server/bids/bids.repo.ts` (`BidsRepo` 에 메서드 둘), `web/server/bids/bids.supabase.ts` (구현, `REVISION_COLUMNS`·`toRevisionSummary` 재사용), `web/server/bids/index.ts` (배럴), `web/server/bids/supabase-fake.test-data.ts`·`bids.supabase.test.ts` (가짜·repo 시험)
- Create: `web/app/api/v1/bids/[id]/revisions/route.ts`, `web/app/api/v1/bids/[id]/revisions/[rev]/route.ts`
- Test: `web/app/api/v1/revisions-contract.test.ts` (`what-if-contract.test.ts` 모양을 따른다)

**Interfaces:**
- Produces (배럴 `@/server/bids`):
  ```ts
  // revision.model.ts
  export const revisionSnapshotSchema: z.ZodType<RevisionSnapshot>; // z.looseObject, 아래 키만 본다. 모두 optional·nullable 허용
  export type RevisionSnapshot = {
    title?: string; agency?: string; stage?: string; status?: string; amendmentNo?: string | null;
    budgetKrw?: string | null; noticeDate?: string | null; deadlineAt?: string | null; sourceUrl?: string | null;
    planRef?: string | null; preSpecRef?: string | null; content?: string;
    attachments?: { name: string }[]; structuredQualifications?: { name: string; value?: string | null }[];
  };
  export const SCALAR_FIELDS = ["budgetKrw","deadlineAt","status","title","agency","noticeDate","stage","sourceUrl","planRef","preSpecRef"] as const;
  export const LIST_FIELDS = ["structuredQualifications","attachments"] as const;
  export type TextSegment = { op: "same" | "added" | "removed"; text: string };
  export type RevisionFieldChange =
    | { field: (typeof SCALAR_FIELDS)[number]; kind: "scalar"; before: string | null; after: string | null }
    | { field: (typeof LIST_FIELDS)[number]; kind: "list"; added: string[]; removed: string[]; kept: string[] }
    | { field: "content"; kind: "text"; segments: TextSegment[] };
  export type RevisionRef = { revision: number; amendmentNo: string | null; fetchedAt: string };
  export type RevisionComparison = {
    bidId: string; title: string;
    revisions: BidRevisionSummary[];      // revision 내림차순
    current: RevisionRef; previous: RevisionRef | null;   // previous 는 current.revision - 1
    cancelled: boolean;                   // current 스냅샷 status === "CANCELLED"
    changes: RevisionFieldChange[];       // DISPLAY_ORDER 순
  };
  // revision-diff.ts
  export const DIFF_CELL_LIMIT = 1_000_000;
  export function diffText(before: string, after: string): TextSegment[];
  export function toRevisionChanges(changedFields: readonly string[], before: RevisionSnapshot, after: RevisionSnapshot): RevisionFieldChange[];
  // bids.repo.ts (BidsRepo 에 추가)
  getRevisionHistory(bidId: string): Promise<{ title: string; revisions: BidRevisionSummary[] } | null>; // 공고 없으면 null
  getRevisionSnapshots(bidId: string, revisions: number[]): Promise<{ revision: number; normalized: unknown }[]>;
  // revision.service.ts
  export function listBidRevisions(orgId: string, bidId: string, deps: { repo: BidsRepo }): Promise<ServiceResult<BidRevisionSummary[]>>;
  export function getBidRevision(orgId: string, bidId: string, revision: number, deps: { repo: BidsRepo }): Promise<ServiceResult<RevisionSnapshot>>;
  export function compareBidRevision(orgId: string, bidId: string, revision: number | null, deps: { repo: BidsRepo }): Promise<ServiceResult<RevisionComparison>>;
  export function parseRevisionParam(value: string | undefined): number | null; // /^[1-9]\d{0,5}$/ 만 숫자, 나머지 null
  ```
- `DISPLAY_ORDER`: `budgetKrw, deadlineAt, structuredQualifications, attachments, content, status, title, agency, noticeDate, stage, sourceUrl, planRef, preSpecRef`.
- 404 는 `fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" })` 와 revision 없음 `fail(404, "NOT_FOUND", "변경 이력을 찾을 수 없습니다", { resource: "revision" })`.

- [ ] **Step 1: `diffText`·`toRevisionChanges` 시험을 쓴다** (`revision-diff.test.ts`)
  - `diffText("a b c", "a x c")` → `[{op:"same",text:"a "},{op:"removed",text:"b"},{op:"added",text:"x"},{op:"same",text:" c"}]` (같은 자리면 removed 가 added 앞).
  - 불변식(여러 입력): `same+removed` 를 이으면 before, `same+added` 를 이으면 after. 이웃한 조각의 op 는 서로 다르다.
  - FX-07 꼴: after 에만 `Kubernetes` 가 있으면 added 조각 하나가 `Kubernetes` 를 담고 removed 조각은 없다.
  - 같은 글 → `[{op:"same",text}]`. `""` → `"x y"` 는 `[{op:"added",text:"x y"}]`. 둘 다 `""` 이면 `[]`.
  - 상한: 서로 다른 토큰 1001개씩(토큰 곱 > `DIFF_CELL_LIMIT`) → 정확히 `[{op:"removed",text:before},{op:"added",text:after}]`.
  - `toRevisionChanges(["amendmentNo","budgetKrw","content"], {budgetKrw:"1800000000",content:"A"}, {budgetKrw:"2160000000",content:"A B"})` → 길이 2, 첫째 `{field:"budgetKrw",kind:"scalar",before:"1800000000",after:"2160000000"}`, 둘째 `field:"content"`, `kind:"text"`. amendmentNo 없음.
  - 순서: `["content","deadlineAt"]` → deadlineAt 이 먼저.
  - 모르는 이름 `["foo"]` → `[]`. 값이 없으면 `null`(undefined 아님).
  - 첨부 `[{name:"과업지시서.hwp"}]` → `[{name:"과업지시서.hwp"},{name:"제안요청서.pdf"}]` 는 `added:["제안요청서.pdf"], removed:[], kept:["과업지시서.hwp"]`. 자격 항목의 표시 문자열은 `value` 가 있으면 `` `${name} ${value}` ``, 없으면 `name`.
- [ ] **Step 2: 실행해 실패를 본다** — `pnpm -C web exec vitest run server/bids/revision-diff.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 두 함수를 구현한다.** 토큰은 `text.match(/\s+|\S+/g) ?? []`. 토큰 LCS(`Uint32Array` 표, 곱이 상한을 넘으면 통째 교체), 뒤에서부터 되짚어 같은 op 를 합친다. `scalar` 비교는 하지 않는다(저장된 changed_fields 를 믿는다).
- [ ] **Step 4: 통과를 본다** — 같은 명령 → PASS.
- [ ] **Step 5: 서비스 시험을 쓴다** (`revision.service.test.ts`, 가짜 repo)
  - 공고 없음 → 세 함수 모두 404 `resource:"bid"`.
  - revision 1 만 → `compareBidRevision(…, null)` 은 200, `current.revision===1`, `previous===null`, `changes` `[]`.
  - revision 1·2(r2 changed_fields `["amendmentNo","budgetKrw","content"]`) → `null` 이면 r2 대 r1, `changes[0].field==="budgetKrw"`. `1` 을 주면 previous null.
  - 없는 번호 `3` → 404 `resource:"revision"`. r2 스냅샷 status `"CANCELLED"` → `cancelled:true`.
  - 스냅샷이 스키마에 안 맞으면(예: content 가 숫자) 던진다(500 은 Route 공통 처리).
  - `parseRevisionParam`: `"2"`→2, `"0"`·`"01"`·`"-1"`·`"a"`·`"1.5"`·`undefined`·`"1234567"`→null.
- [ ] **Step 6: 서비스·repo 를 구현한다.** repo 는 `bid_list_items`(제목)·`bid_revisions`(REVISION_COLUMNS, 내림차순)·`bid_revisions.normalized`(`.in("revision", revisions)`) 를 anon 키로 읽는다. 공고 행이 없으면 `null`. `bids.supabase.test.ts` 에 두 메서드 가짜 시험을 더한다.
- [ ] **Step 7: 계약 시험을 쓰고 Route 를 만든다** (`revisions-contract.test.ts`)
  - `GET /api/v1/bids/<uuid>/revisions` 200 → `BidRevisionSummary[]` 모양(`bidRevisionSummarySchema` 로 parse), 내림차순.
  - `GET …/revisions/2` 200 → 스냅샷. `…/revisions/0`·`…/abc`·없는 번호 → 404 `NOT_FOUND`. id 가 uuid 아님 → 404.
  - 로그인 없음 401, 조직 없음은 기존 `businessRoute` 규칙 그대로. VIEWER 는 200(공고는 모든 조직이 같이 본다).
  - Route 는 `web/app/api/v1/bids/[id]/route.ts` 와 같은 꼴(`businessRoute`·`isUuid`·`pathNotFound`·`serviceResponse`).
- [ ] **Step 8: 통과를 본다** — `pnpm -C web exec vitest run server/bids/revision-diff.test.ts server/bids/revision.service.test.ts server/bids/bids.supabase.test.ts app/api/v1/revisions-contract.test.ts` → PASS. 그다음 슬롯으로 `pnpm verify:quick` → exit 0.
- [ ] **Step 9: 커밋** — 고친 파일만 지정해 스테이징. `feat(web): 공고 변경 이력 비교 도메인과 API 추가`

### Task 2: 변경 이력 화면 디자인 스펙 (web-designer)

**Files:**
- Create: `docs/plans/2026-10-21-s5-revisions-ui-spec.md` (frontmatter·위키링크는 `docs/00-README.md` Obsidian 규약)

**Interfaces:**
- Consumes: Task 1 의 `RevisionComparison`·`RevisionFieldChange`·`TextSegment` (그대로 쓴다. 모양을 바꿔야 하면 스펙에 사유를 적고 컨트롤러에 알린다).
- Produces: 화면 구조·부품 매핑(shadcn `web/components/ui/`, `design/tokens.json` 토큰)·문구·상태 목록. Task 3 이 이 문서만 보고 짠다.

- [ ] **Step 1: 스펙을 쓴다.** 꼭 정할 것:
  - 경로 `/bids/[id]/revisions?rev=N`. 머리말: 공고명, `변경 이력`, 상세로 돌아가는 링크, `rN-1 → rN`·차수·수집 시각(KST).
  - revision 목록(rN·차수·수집 시각·바뀐 항목 수, 고른 것 표시, 각 항목은 `?rev=` 링크).
  - 바뀐 항목 표(항목 | 이전 | 이후). 예산은 `formatKrwCompact`(`18억`·`21.6억`), 마감은 KST 날짜·시각, 상태는 기존 라벨. 목록 항목은 추가·삭제·유지.
  - 본문 diff: 추가·삭제를 색만으로 구분하지 않는다(밑줄·취소선 + 화면 낭독용 `추가됨`·`삭제됨`). 긴 본문은 접고 펼치기.
  - 상태: revision 하나뿐(Global Constraints 문구), 취소 공고 띠, changed_fields 가 비었을 때, 404, 로딩·오류 경계.
  - 진입점: 상세 "단계 이력" 의 `r{latestRevision}` 을 revision 이 2개 이상일 때 링크로. 알림 link 는 J3.
  - 1440·1280 두 폭 배치. 모바일 폭은 다루지 않는다.
  - 데모 FX-07 화면에서 무엇이 한눈에 보여야 하는지(18억 → 21.6억, 본문 Kubernetes 추가).
- [ ] **Step 2: 컨트롤러가 스펙을 Task 1 타입과 대조한다.** 어긋나면 스펙을 고친다.
- [ ] **Step 3: 커밋** — `docs: S5 변경 이력 화면 디자인 스펙 추가`

### Task 3: 변경 이력 화면 + 상세 진입점

**Files:**
- Create: `web/app/(app)/(work)/bids/[id]/revisions/page.tsx`, `…/revisions/revisions-view.tsx`, `…/revisions/loading.tsx`, `…/revisions/not-found.tsx` (상세 폴더의 같은 파일 꼴을 따른다)
- Create: `web/components/bids/text-diff.tsx` (본문 diff 표시), `web/components/bids/revision-field-labels.ts` (항목 이름, 기존 `labels.ts` 와 겹치면 거기에 더한다)
- Modify: `web/components/bids/stage-timeline.tsx` (r 번호 링크, 새 prop `revisionsHref: string | null`), `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx` (prop 전달)
- Test: `web/app/(app)/(work)/bids/[id]/revisions/revisions-view.browser.test.tsx`, `web/components/bids/stage-timeline` 관련 기존 브라우저 시험에 링크 단언 추가

**Interfaces:**
- Consumes: `compareBidRevision`·`parseRevisionParam`·`RevisionComparison` (Task 1), 스펙(Task 2).
- `page.tsx` 는 `requireWork(\`/bids/${id}/revisions\`)` → `isUuid` → `parseRevisionParam(searchParams.rev)`(값이 있는데 null 이면 `notFound()`) → `compareBidRevision(work.orgId, id, rev, { repo: workDeps().bids })`. 404 면 `notFound()`, 그 밖 실패는 던진다. `await connection()` 은 상세 page 와 같다.

- [ ] **Step 1: 브라우저 시험을 쓴다** (`revisions-view.browser.test.tsx`, 1440·1280 두 폭)
  - FX-07 꼴 데이터: 예산 행에 이전 `18억`·이후 `21.6억` 문자열(스펙의 표기 그대로), 본문에 `Kubernetes` 가 추가 표시(`ins` 또는 스펙이 정한 역할)로, 화면 낭독 텍스트 `추가됨` 존재.
  - revision 하나뿐 → `처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다.` 표시, 표 없음.
  - `cancelled:true` → 취소 띠 문구(스펙) 표시.
  - revision 목록의 각 항목이 `?rev=N` 링크, 고른 것에 `aria-current`.
  - 1280 폭에서 `document.documentElement.scrollWidth <= 1280`.
  - 단계 이력: revisions 2개 이상이면 `r2` 가 `/bids/<id>/revisions` 링크, 1개면 링크 아님.
- [ ] **Step 2: 실패를 본다** — 슬롯으로 `pnpm -C web test:browser -- revisions-view` → FAIL.
- [ ] **Step 3: 스펙대로 구현한다.** 색·글꼴은 토큰만. 금액·시각 표시는 `web/components/bids/format.ts` 를 쓴다.
- [ ] **Step 4: 통과를 본다** — 같은 명령 → PASS. 그다음 슬롯으로 `pnpm verify` → exit 0.
- [ ] **Step 5: 1440·1280 스크린샷**을 로컬 dev 로 찍어 `docs/evidence/s5/` 에 둔다(격리 Supabase 가 없으면 이 단계는 Task 5 로 미루고 보고에 적는다).
- [ ] **Step 6: 커밋** — `feat(web): 공고 변경 이력 화면 추가`

### Task 4: BID_CHANGED 조직 펼치기 (dc 병합 뒤, J6)

**Files:**
- Modify: `web/server/notifications/outbox.model.ts` (`NOTIFY_EVENT_TYPES` 다섯째 `"BID_CHANGED"`, `OutboxEventRow.aggregate_id: string | null`, `NotificationRow.type` 에 `"BID_CHANGED"`)
- Modify: `web/server/notifications/outbox.repo.ts` (`OUTBOX_COLUMNS` 에 `aggregate_id`, 새 store 메서드), `outbox.service.ts` (`processEvent` 분기 한 줄 + 닫기), `outbox.test-support.ts`·`outbox-db.test-support.ts` (새 메서드·열)
- Create: `web/server/notifications/bid-changed.model.ts` · Test: `bid-changed.model.test.ts`
- Create: `web/server/notifications/bid-changed.service.ts` · Test: `outbox.service.test.ts`·`outbox-dedupe.test.ts` 에 사례 추가
- Create: `supabase/migrations/20261021000100_outbox_notify_due_bid_changed.sql` (Global Constraints 의 번호 규칙)
- Test: `scripts/database.test.mjs` 의 "알림 outbox 부분 인덱스" describe 에 BID_CHANGED 조건 단언 추가

**Interfaces:**
- Consumes (dc 52adabb 모양): `Outcome` 의 `"SKIPPED_NO_RECIPIENT"`, `EventResult.sent?`, `closeForRetry`, `toDeadUpdate`·`toRetryUpdate`, `storeError`(outbox.repo export), `processEvent` 첫 줄의 카카오 분기.
- Produces:
  ```ts
  // bid-changed.model.ts
  export type BidChangedEvent = { bidId: string; kind: "CHANGED" | "CANCELLED" };
  export function readBidChangedEvent(event: OutboxEventRow): BidChangedEvent | null; // event_type 이 BID_CHANGED, org_id null, aggregate_id uuid, payload.kind 가 CHANGED|CANCELLED 일 때만
  export const MESSAGE_BID_CHANGED = "공고가 변경되었습니다.";
  export const MESSAGE_BID_CANCELLED = "공고가 취소되었습니다.";
  export type BidRecipient = { orgId: string; userId: string };
  export function uniqueRecipients(list: readonly BidRecipient[]): BidRecipient[]; // (orgId,userId) 중복 제거, 입력 순서 유지
  export function toBidChangedRow(input: { recipient: BidRecipient; bidId: string; kind: BidChangedEvent["kind"]; title: string; outboxEventId: string; now: Date }): NotificationRow;
  //   idempotency_key `${outboxEventId}:${userId}:IN_APP`, type "BID_CHANGED", link `/bids/${bidId}/revisions`
  // NotificationOutboxStore 에 추가
  listBidRecipients(bidId: string): Promise<BidRecipient[]>; // J1 후보(회원·활동 확인 전)
  // bid-changed.service.ts
  export function processBidChangedEvent(store: NotificationOutboxStore, event: OutboxEventRow, now: Date):
    Promise<{ outcome: "SENT" | "SKIPPED_NO_RECIPIENT" | "SKIPPED_NO_BID"; sent: number } | { outcome: "INVALID" }>;
  //   저장 실패는 던진다(부르는 쪽이 closeForRetry). 알림을 넣은 뒤 markProcessed 한 번.
  ```
- `listBidRecipients` 는 service role 로 세 번 읽는다: `bid_reviews(org_id, reviewer_id, assignee_id) where bid_id`, `score_runs(org_id) where bid_id`(조직 목록), `memberships(org_id, user_id) where org_id in (…) and sol_role in ('ADMIN','SALES','ANALYST')`. null 사용자는 버린다.
- 서비스는 후보마다 `isMember(orgId,userId)` → `isActive(userId)` 를 통과한 사람에게만 넣는다. 공고 제목은 `readBidTitle` 한 번. 제목 null → `SKIPPED_NO_BID`. 통과자 0 → `SKIPPED_NO_RECIPIENT`. 둘 다 `markProcessed`.

- [ ] **Step 1: main(dc 포함)을 합친다** — `git -C <worktree> merge --no-edit main` (J6). 충돌이 나면 멈추고 보고한다. 합친 뒤 Task 1~3 시험이 그대로 PASS 인지 Task 3 Step 4 명령으로 본다.
- [ ] **Step 2: 모델 시험을 쓴다** (`bid-changed.model.test.ts`)
  - payload `{kind:"CHANGED",changedFields:["budgetKrw"]}`, org_id null, aggregate_id uuid → `{bidId, kind:"CHANGED"}`. `CANCELLED` 도 같다.
  - org_id 가 있음·aggregate_id null·uuid 아님·kind `"CREATED"`·event_type `BID_CREATED` → null.
  - `toBidChangedRow` → `type:"BID_CHANGED"`, `channel:"IN_APP"`, `payload.link === "/bids/<bidId>/revisions"`, `payload.message` 가 kind 별 문구, 키 `<eventId>:<userId>:IN_APP`.
  - `uniqueRecipients` 가 같은 (org,user) 를 하나로.
- [ ] **Step 3: 처리기 시험을 쓴다** (`outbox.service.test.ts` 가짜 store)
  - 후보 3명(ADMIN·SALES·ANALYST, 같은 조직) → 알림 3건, 결과 `SENT`·`sent:3`, 이벤트 PROCESSED, summary `sent` 1 증가.
  - 후보에 정지 계정 1·비회원 1 → 그 둘은 빠진다. 전원 빠지면 `SKIPPED_NO_RECIPIENT`.
  - 다른 조직의 후보는 그 조직 org_id 로만 행이 생긴다(행 org_id = recipient.orgId).
  - 제목 null → `SKIPPED_NO_BID`. 잘못된 payload → DEAD(재시도 없음). 두 번째 insert 가 던지면 FAILED 재시도, attempts+1.
  - 카카오·인앱 기존 사례가 그대로 PASS.
- [ ] **Step 4: 멱등·격리 시험** (`outbox-dedupe.test.ts`, PGlite)
  - 같은 BID_CHANGED 이벤트를 두 회차·동시에 처리해도 수신자마다 1건.
  - 조직 2개: A 는 그 공고에 score_run, B 는 그 공고에 결정(담당자 1명). 처리 뒤 A 사람의 행은 org_id A, B 사람의 행은 org_id B 다. A 사용자로 RLS 를 걸고 `notifications` 를 읽으면 A 행만 보이고, payload 키는 정확히 `bidId·title·message·link` 넷이다(다른 조직의 담당자·분석 유무가 내용에 없다).
- [ ] **Step 5: 실패를 본다** — `pnpm -C web exec vitest run server/notifications` → 새 사례 FAIL.
- [ ] **Step 6: 구현한다.** `processEvent` 의 카카오 분기 아래·`toNotificationIntent` 위에 `if (event.event_type === "BID_CHANGED") return processBidChanged(deps, event);`. `OutboxBatchDeps` 에 필수 필드를 더하지 않는다(worker `notify-outbox.ts` 를 건드리지 않는다).
- [ ] **Step 7: 마이그레이션** — `outbox_events_notify_due_idx` 를 drop·create, 조건 `event_type in ('REVIEW_ASSIGNED','ANALYSIS_COMPLETE','BID_RECOMMENDED','KAKAO_TEST','BID_CHANGED')`, 키·상태 조건은 dc 의 20261021000002 와 같게. 머리 주석에 세 곳(목록·findDue·인덱스)이 같아야 한다고 적는다. `scripts/database.test.mjs` 단언을 더하고 `node --test scripts/database.test.mjs` → PASS. `pnpm db:types` 를 돌려 차이가 있으면 같은 커밋에 넣는다.
- [ ] **Step 8: 통과를 본다** — `pnpm -C web exec vitest run server/notifications worker/notify-outbox.test.ts` → PASS. 슬롯으로 `pnpm verify` → exit 0.
- [ ] **Step 9: 커밋** — `feat(web): BID_CHANGED 알림을 조직 수신자에게 펼침`

### Task 5: S5 격리 E2E + 증거

**Files:**
- Create: `web/e2e-auth/s5-change-detection.write.spec.ts`, `web/playwright.s5.config.ts` (`playwright.work.config.ts` 를 바탕으로 testMatch 를 이 spec 하나로, globalSetup 은 `./e2e-auth/support/work-setup.ts` 재사용)
- Modify: `web/package.json` 에 `"test:e2e:s5": "playwright test -c playwright.s5.config.ts"` (기존 검사는 빼지 않는다)
- Create: `docs/evidence/s5/` (리포트·1440·1280 스크린샷·기동 로그·`summary.md`)

**Interfaces:**
- Consumes: Task 3 화면, Task 4 알림, 기존 `/admin/ingestion` 수동 수집(배치 `live`), work E2E 의 globalSetup(demo:reset → mock 확인 → demo:preanalyze).

- [ ] **Step 1: 격리 스택을 띄운다.** 격리 Supabase(새 포트·새 project_id) + 격리 compose 프로젝트(redis·ai-gateway mock·worker, 이 worktree 빌드). 키는 `supabase status -o env --workdir …` 치환으로 자식 env 에만 넘긴다. 실행 모드는 `fixture`(19 S5).
- [ ] **Step 2: spec 을 쓴다.** 순서(두 폭 각각, 작업자 1개로 직렬):
  1. admin@soltech.invalid → `/admin/ingestion` → 배치 `live` 수동 수집. 결과가 `created 0, changed 3, cancelled 1, skippedDuplicate 1, quarantined 0` 이 될 때까지 기다린다(19 S5).
  2. FX-07 상세 → 단계 이력 `r2` 링크 → `/bids/<FX-07>/revisions`. 예산 이전 `18억`·이후 `21.6억`, 본문 추가 `Kubernetes` 단언.
  3. 알림 벨(sales@soltech.invalid): `공고 변경` 이 FX-06·FX-07·FX-10 에 각 1건, FX-08 은 `공고가 취소되었습니다.` 1건, FX-09 는 0건. 알림 클릭 → `/bids/<id>/revisions` 로 간다.
  4. 같은 수동 수집을 한 번 더 → 벨 건수 그대로(멱등).
  5. viewer@soltech.invalid 와 다른 조직 VIEWER 의 벨에는 BID_CHANGED 0건(J1). 조직 격리: 다른 조직 사용자의 벨·`GET /api/v1/notifications` 에 org-01 알림이 없다.
  6. 각 단계 1440·1280 스크린샷을 `docs/evidence/s5/` 에.
- [ ] **Step 3: 실행** — 슬롯으로 `pnpm -C web test:e2e:s5` → 모두 PASS. 실패하면 앱 결함인지 시험 결함인지 나눠 보고한다(단언을 약하게 하지 않는다).
- [ ] **Step 4: 격리 스택을 내린다**(자기 compose 프로젝트·자기 Supabase 만). 비밀이 든 임시 파일은 이름을 지정해 지운다. 증거에 키가 없는지 `grep -rn "eyJ" docs/evidence/s5` → 0건.
- [ ] **Step 5: 커밋** — `test(web): S5 변경 감지 격리 E2E 와 증거 추가`

### 마무리 (컨트롤러)

- [ ] main 을 다시 합치고 마이그레이션 번호 규칙(Global Constraints)·`pnpm db:types` 를 맞춘다. 슬롯으로 `pnpm verify` 와 `pnpm -C web test:browser` → exit 0.
- [ ] 기준점(브랜치·해시·verify 수치·E2E 수치·증거 경로)을 3e 에 보낸다. 병합 승인은 사용자가 3e 창에서 한다.
- [ ] 정본 변경 요청을 45 에 보낸다: 05 두 GET "미구현" 해제, 06 §8 화면 절, 13 BID_CHANGED 펼치기(J1·J2·J3, ADR-033 E3 의 "펼치기 없음" 문장), 19 S5 4단계에 FX-08 취소 알림, 12 확장 컷 S5 상태, 16 확장 컷 예외 ADR, PROGRESS.
- [ ] 10-23 freeze 판정: Task 1~4 green 이 아니면 상세의 진입 링크를 빼는 쪽으로 12 에 보고한다.

## 관련 문서

- [[19-DEMO-SCENARIO|19 데모 시나리오]] S5
- [[07-DATA-PIPELINE|07 데이터 파이프라인]] §5
- [[13-NOTIFICATIONS|13 알림]]
- [[06-UI-UX|06 UI/UX]] §8
- [[05-API-SPEC|05 API]] §2·§4.3
- [[16-DECISIONS|16 결정]] ADR-023·033·037
