# 입찰 일정 공고 분야 색 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입찰 일정(`/calendar`)의 일정마다 공고 분야를 왼쪽 색 띠와 분야 이름 색 글자로 보이고, 범례의 "DEMO 데모용 가상 공고" 항목을 분야 색 범례로 바꾼다.

**Architecture:** 분야는 새로 저장하지 않는다. 달력 저장(`calendar.repo`)이 이미 읽는 최신 revision 에 관련성 평가(`bid_relevance_assessments.categories`)와 공공조달분류명(`raw_payload->>pubPrcrmntClsfcNm`)을 더 읽고, 모델의 순수 함수 `primaryFieldOf` 가 목록 뷰(`opportunity_list_items.categories`)와 같은 규칙으로 유효 분야를 만든 뒤 우선순위로 대표 분야 하나를 고른다. 화면은 대표 분야를 토큰 색 띠·글자로 그린다.

**Tech Stack:** Next.js 16 · React 19 · Tailwind v4(토큰은 `design/tokens.json` → `pnpm tokens`) · Supabase(PostgREST 임베드, 사용자 세션 + RLS) · Vitest(단위) · Vitest Browser Mode(화면).

**Spec:** 2026-11-03 사용자와 채팅으로 확정한 설명(브레인스토밍, 시안 C안 선택). 아래 "확정한 설계"에 그대로 옮겼다.

## 확정한 설계

사용자가 정한 것:
- 칩이 모두 같은 회색이라 무슨 공고인지 모른다. 공고 분야로 색을 나눈다.
- 방식은 C안: 칩 왼쪽 색 띠 + 칩 윗줄 오른쪽에 분야 이름을 같은 색 글자로.
- 범례의 "DEMO 데모용 가상 공고" 문구를 지운다.

메인 세션이 정하고 사용자가 확인한 것:
- 분야는 `/bids` 분야 6개(AI·AX, SI·SW, 클라우드, 데이터, 보안, 디지털트윈)와 "분야 없음". 유지관리·ISP 는 태그라 색에서 뺀다.
- 분야가 둘 이상이면 대표 하나: AI·AX → 보안 → 클라우드 → 데이터 → 디지털트윈 → SI·SW 순서로 앞의 것.
- SI·SW(운영 IT 공고의 84%)는 차분한 회색 계열, 나머지는 뚜렷한 색. 글자 대비 4.5:1 이상.
- 달력 칩, "+n건 더" 메뉴, 다가오는 14일 목록, 모바일 일정 목록에 같은 띠·글자를 둔다.
- 범례: DEMO 항목을 지우고 분야 색 범례를 둔다.
- 칩·메뉴의 DEMO 글자와 다가오는 목록의 DEMO 배지는 남긴다(`docs/06-UI-UX.md` §15 "모든 가상 데이터에 DEMO 배지").
- 일정 종류(마감·개찰 등)는 지금처럼 아이콘 + 글자다.

## Global Constraints

- 색은 `design/tokens.json` 에만 적는다. `web/app/globals.css` 는 `pnpm tokens` 생성물이라 손으로 고치지 않는다. 화면 코드에 hex·기본 팔레트 클래스 금지(`pnpm check:colors`).
- 색만으로 의미를 전달하지 않는다. 분야는 늘 띠와 글자(접근 이름 포함)를 함께 쓴다.
- Tailwind 클래스는 완전한 문자열 맵으로 둔다(`border-l-${x}` 같은 조합 금지).
- 마이그레이션·`pnpm db:push` 없다. 분야는 읽기만 더한다.
- 화면은 도메인을 배럴(`@/server/calendar`)로만, 그것도 타입만 부른다(브라우저 시험이 그대로 그린다).
- 분야 이름 글자는 `/bids` 분야 이름(`web/components/work/opportunities-copy.ts` `OPPORTUNITY_CATEGORIES`)과 같다: `AI·AX` `SI·SW` `클라우드` `데이터` `보안` `디지털트윈`, 없음은 `분야 없음`.
- 무거운 검증(`verify:changed`·`test:browser`·`git commit`)은 `verify-slot.sh` 로 감싼다(메모리 heavy-verify-slots). 경로가 없으면 짐작하지 말고 멈춰 보고한다.
- 커밋은 사용자가 요청할 때만 한다. 파일을 지정해 스테이징한다(`git add -A` 금지).
- 운영 반영(main push = Vercel 배포)은 사용자 승인 뒤다. 오늘(11-03)은 화면 동결·제출일이다.

## Review Focus

1. 분야가 둘 이상인 공고(운영 약 10%): 우선순위 첫 분야 하나만 색·글자로 보인다. → Task 1 시험 `여러 분야면 우선순위 첫 분야`.
2. 관련성 평가가 없거나 `OTHER` 만 있는 공고(DEMO 공고 14건 중 13건): 띠는 `input` 회색, 분야 글자는 없다. → Task 1 `OTHER·모르는 값은 버린다`, Task 4 `분야 없는 칩`.
3. 한 revision 에 관련성 평가가 여러 행: 가장 최근(`created_at` 내림차순, 같으면 `id` 내림차순) 하나로 정한다. 옛 revision 의 평가는 쓰지 않는다. → Task 2 시험.
4. 좁은 칩(1440px·사이드바 펼침, 칩 약 100px)에 ★ + 가장 긴 분야 이름(디지털트윈) + DEMO 가 함께 있을 때 글자가 칩 밖으로 넘치거나 잘리지 않고 페이지가 가로로 넘치지 않는다. → Task 4 1440·1280 시험.
5. 제목 AI 단어 판정이 SQL 과 어긋나는 경우("MAIL", "지능형교통시스템"은 AI 아님, "RAG" 는 AI). → Task 1 `제목 AI 단어면 AI_AX`.

---

### Task 1: 대표 분야 판정(모델)

**Files:**
- Modify: `web/server/calendar/calendar.model.ts` (상수·타입·`primaryFieldOf` 추가, `CalendarBid`·`eventOf` 에 `field`)
- Modify: `web/server/calendar/index.ts` (배럴에 `CALENDAR_FIELDS`·`primaryFieldOf`·`type CalendarField` 추가)
- Test: `web/server/calendar/calendar.model.test.ts`
- Modify: `web/app/api/v1/calendar-google-sync-contract.test.ts:30` 근처 공고 조각에 `field: null` (타입 맞추기)

**Interfaces:**
- Produces:
  - `export const CALENDAR_FIELDS = ["AI_AX", "SECURITY", "CLOUD", "DATA", "DIGITAL_TWIN", "SI_SW"] as const;` (대표 분야 우선순위 순서)
  - `export type CalendarField = (typeof CALENDAR_FIELDS)[number];`
  - `export function primaryFieldOf(input: { categories: readonly string[]; title: string; procurementClass: string | null }): CalendarField | null`
  - `CalendarBid.field: CalendarField | null`, 따라서 `CalendarEvent.bid.field` 도 같다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`calendar.model.test.ts` 의 `bid()` 조각 기본값에 `field: null` 을 더하고 `describe("primaryFieldOf — 대표 분야")` 를 추가한다.

```ts
const of = (categories: string[], title = "공고", procurementClass: string | null = null) =>
  primaryFieldOf({ categories, title, procurementClass });

it("여러 분야면 우선순위 첫 분야(AI·AX → 보안 → 클라우드 → 데이터 → 디지털트윈 → SI·SW)", () => {
  expect(of(["SI_SW", "SECURITY"])).toBe("SECURITY");
  expect(of(["DATA", "CLOUD", "SI_SW"])).toBe("CLOUD");
  expect(of(["DIGITAL_TWIN", "SI_SW"])).toBe("DIGITAL_TWIN");
});
it("OTHER·모르는 값은 버린다", () => {
  expect(of(["OTHER"], "청사 시설 보수")).toBeNull();
  expect(of(["OTHER", "BIM"], "청사 시설 보수")).toBeNull();
});
it("제목 AI 단어면 AI_AX 를 더한다(SQL it_scope_ai_title 과 같은 식)", () => {
  expect(of(["SI_SW"], "생성형 AI 민원 상담 구축")).toBe("AI_AX");
  expect(of(["SI_SW"], "RAG 기반 문서 검색 고도화")).toBe("AI_AX");
  expect(of(["SI_SW"], "MAIL 서버 교체")).toBe("SI_SW");
  expect(of(["SI_SW"], "지능형교통시스템 유지관리")).toBe("SI_SW");
});
it("관련성 분야가 없고 공식 IT 분류면 SI_SW, 아니면 분야 없음", () => {
  expect(of([], "통합 유지관리", "정보시스템유지관리서비스")).toBe("SI_SW");
  expect(of(["OTHER"], "통합 유지관리", "소프트웨어유지및지원서비스")).toBe("SI_SW");
  expect(of([], "청사 설계", "건축설계서비스")).toBeNull();
});
it("일정은 공고의 대표 분야를 그대로 싣는다", () => {
  const [event] = collectCalendarEvents(
    { watchedBids: [bid("a", "2026-11-10T01:00:00Z", { field: "AI_AX" })], projects: [], relevantBids: [] },
    { userId: ME, view: "org" },
  );
  expect(event?.bid.field).toBe("AI_AX");
});
```

- [ ] **Step 2: 시험이 실패하는지 본다**

Run: `pnpm -C web exec vitest run server/calendar/calendar.model.test.ts -t "대표 분야"`
Expected: FAIL (`primaryFieldOf` 가 없다는 import 오류)

- [ ] **Step 3: `primaryFieldOf` 와 `field` 를 구현한다**

`calendar.model.ts` 에 위 Interfaces 의 상수·타입·함수를 둔다. 규칙은 `supabase/migrations/20261029000300_it_bid_scope.sql` 목록 뷰의 `cls`·`eff`·`cat` 과 같다(주석으로 출처를 적는다):
1. `found` = `categories` 가운데 `CALENDAR_FIELDS` 에 있는 값(`OTHER`·모르는 값 제외).
2. 제목이 AI 정규식에 맞으면 `AI_AX` 를 더한다.
3. 1의 `found` 가 비었고 분류명이 IT 정규식에 맞으면 `SI_SW` 를 더한다.
4. `CALENDAR_FIELDS` 순서로 처음 들어 있는 값, 없으면 `null`.

정규식은 `supabase/migrations/20261030000100_inline_it_scope.sql` 의 두 함수 본문을 그대로 옮긴다:
- AI 제목: `/(^|[^a-z0-9_])(ai|ax|llm|rag)([^a-z0-9_]|$)|인공지능|생성형|챗봇|머신러닝|딥러닝|초거대/i`
- IT 분류: `/정보시스템|소프트웨어|데이터|정보인프라|클라우드|공간정보DB|정보통신|네트워크|전산|정보화/`

`CalendarBid` 에 `field: CalendarField | null` 을 더하고, `eventOf` 가 만드는 `bid` 에 `field: bid.field` 를 싣는다. 배럴에 내보낸다. 구글 동기화 계약 시험의 공고 조각에 `field: null` 을 더한다.

- [ ] **Step 4: 시험이 통과하는지 본다**

Run: `pnpm -C web exec vitest run server/calendar/calendar.model.test.ts app/api/v1/calendar-google-sync-contract.test.ts`
Expected: PASS (기존 시험 포함 전부)

- [ ] **Step 5: 커밋(사용자가 요청한 경우만)**

```bash
git add web/server/calendar/calendar.model.ts web/server/calendar/index.ts web/server/calendar/calendar.model.test.ts web/app/api/v1/calendar-google-sync-contract.test.ts
git commit -m "feat(calendar): 일정 공고의 대표 분야 판정"
```

---

### Task 2: 저장에서 분야 재료 읽기

**Files:**
- Modify: `web/server/calendar/calendar.repo.ts:23-31` (`RAW_FIELDS`·`REVISIONS`), `:42-64` (`StoredRevision`), `:83-91` (`toBid`)
- Test: `web/server/calendar/calendar.repo.test.ts`

**Interfaces:**
- Consumes: `primaryFieldOf`, `CalendarBid.field` (Task 1)
- Produces: 저장이 돌려주는 모든 `CalendarBid`(관심·프로젝트·관련 공고)에 `field` 가 채워진다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

시험의 `revision()` 조각에 `procurementClass: null`, `relevance: []` 기본값을 더하고(옵션 인자로 바꿀 수 있게) 다음을 추가한다.

```ts
it("공고 분야: 최신 revision 의 가장 최근 관련성 평가로 대표 분야를 정한다", async () => {
  pages.bid_notices = [[notice("n1", [
    { ...revision(1), relevance: [{ categories: ["AI_AX"], created_at: "2026-10-03T00:00:00Z", id: "c" }] },
    { ...revision(2), relevance: [
      { categories: ["SI_SW"], created_at: "2026-10-01T00:00:00Z", id: "a" },
      { categories: ["SECURITY", "SI_SW"], created_at: "2026-10-02T00:00:00Z", id: "b" },
    ] },
  ])]];
  const { events } = await getCalendarEvents(SCOPE, "org", { window: WINDOW });
  expect(events.length).toBeGreaterThan(0); // 공고 마감 + 개찰
  expect(events.every((event) => event.bid.field === "SECURITY")).toBe(true);
});
it("평가가 없으면 분류명으로 SI·SW, 둘 다 없으면 분야 없음", async () => { /* n2: procurementClass "정보시스템유지관리서비스" → "SI_SW", n3: 둘 다 없음 → null */ });
it("revision 임베드는 분류명과 관련성 평가를 함께 고른다", async () => {
  await getCalendarEvents(SCOPE, "org", { window: WINDOW });
  const select = String(noticeRequests()[0]?.find(([method]) => method === "select")?.[1]);
  expect(select).toContain("procurementClass:raw_payload->>pubPrcrmntClsfcNm");
  expect(select).toContain("relevance:bid_relevance_assessments(categories,created_at,id)");
});
```

- [ ] **Step 2: 시험이 실패하는지 본다**

Run: `pnpm -C web exec vitest run server/calendar/calendar.repo.test.ts -t "분야|분류명"`
Expected: FAIL (`field` 가 `undefined`, select 에 임베드 없음)

- [ ] **Step 3: 임베드와 `toBid` 를 고친다**

- `RAW_FIELDS` 에 `procurementClass:raw_payload->>pubPrcrmntClsfcNm` 과 `relevance:bid_relevance_assessments(categories,created_at,id)` 를 더한다. 관심·프로젝트·관련 공고가 같은 `REVISIONS` 를 쓰므로 셋 다 따라온다. 관련성 평가 표는 활동 중 회원 읽기 정책이 있다(`20261023000100_procurement_opportunities.sql:237-241`).
- `StoredRevision` 에 `procurementClass: string | null; relevance: { categories: string[]; created_at: string; id: string }[]`.
- `toBid` 는 최신 revision 의 평가를 `created_at` 내림차순, 같으면 `id` 내림차순으로 골라 `primaryFieldOf({ categories: 평가?.categories ?? [], title: row.title, procurementClass: 최신 revision?.procurementClass ?? null })` 를 `field` 로 싣는다.
- 파일 머리 주석에 "분야는 목록 뷰와 같은 규칙으로 화면에서 계산한다(마이그레이션 없음)"를 한 줄 더한다.

- [ ] **Step 4: 시험이 통과하는지 본다**

Run: `pnpm -C web exec vitest run server/calendar/calendar.repo.test.ts`
Expected: PASS (기존 시험 포함)

- [ ] **Step 5: 커밋(사용자가 요청한 경우만)**

```bash
git add web/server/calendar/calendar.repo.ts web/server/calendar/calendar.repo.test.ts
git commit -m "feat(calendar): 일정 공고의 분류명·관련성 분야 읽기"
```

---

### Task 3: 분야 색 토큰

**Files:**
- Modify: `design/tokens.json` (`colors` 에 6개, `$comment` 에 한 문장)
- Generated: `web/app/globals.css` (`pnpm tokens`)

**Interfaces:**
- Produces: Tailwind 토큰 클래스 `border-l-field-ai` `text-field-ai` `bg-field-ai` 와 `si` `cloud` `data` `security` `twin` 같은 꼴. 분야 없음은 기존 `input` 토큰(`#D1D6DB`)을 쓴다.

- [ ] **Step 1: 토큰을 더한다**

`colors` 의 `demo` 다음에 넣는다. 값은 흰 바탕·`muted`(#F2F4F6, 칩 hover) 위 글자 대비를 계산해 정했다.

| 토큰 | 값 | 흰 바탕 | muted |
|---|---|---|---|
| `field-ai` | `#1D4ED8` | 6.70 | 6.08 |
| `field-si` | `#5B6B7F` | 5.45 | 4.94 |
| `field-cloud` | `#0E7490` | 5.36 | 4.86 |
| `field-data` | `#94600A` | 5.33 | 4.84 |
| `field-security` | `#BE123C` | 6.29 | 5.70 |
| `field-twin` | `#047857` | 5.48 | 4.97 |

`$comment` 에 더할 문장: "field-* 는 입찰 일정(/calendar)의 공고 분야 표시 전용이다(칩 왼쪽 띠·분야 이름 글자·범례 색 칸, 2026-11-03 사용자 결정). 흰 바탕과 muted 위 글자 대비 4.5:1 이상이고 다른 곳에 쓰지 않는다. 분야 없음은 input 색 띠다."

- [ ] **Step 2: 생성하고 검사한다**

Run: `pnpm tokens && pnpm check:tokens && pnpm check:colors`
Expected: 셋 다 0 으로 끝나고 `web/app/globals.css` 에 `--color-field-ai: var(--field-ai);` 등 6쌍이 생긴다.

- [ ] **Step 3: 커밋(사용자가 요청한 경우만)**

```bash
git add design/tokens.json web/app/globals.css
git commit -m "style(tokens): 입찰 일정 공고 분야 색 추가"
```

---

### Task 4: 달력 화면에 분야 띠·글자·범례

**Files:**
- Modify: `web/app/(app)/(work)/calendar/calendar-copy.ts` (분야 이름·범례 순서·없음 글자)
- Create: `web/app/(app)/(work)/calendar/calendar-fields.ts` (분야 → 클래스 맵, `calendar-kinds.ts` 와 같은 자리)
- Modify: `web/app/(app)/(work)/calendar/calendar-view.tsx` (`chipTitle`·`chipName` 89-129, `EventChip` 138-169, `MoreEvents` 172-229, `UpcomingItem` 285-341, `Legend` 343-363, 머리 주석 70)
- Test: `web/app/(app)/(work)/calendar/calendar-view.browser.test.tsx`

**Interfaces:**
- Consumes: `type CalendarField` (Task 1 배럴), 토큰 클래스 (Task 3)
- Produces:
  - `calendar-copy.ts`: `FIELD_LABELS: Record<CalendarField, string>`(위 Global Constraints 글자), `FIELD_LEGEND_ORDER: readonly CalendarField[] = ["AI_AX", "SI_SW", "CLOUD", "DATA", "SECURITY", "DIGITAL_TWIN"]`(`/bids` 칩 순서), `FIELD_NONE = "분야 없음"`
  - `calendar-fields.ts`: `type FieldKey = CalendarField | "NONE"`, `fieldKeyOf(field: CalendarField | null): FieldKey`, `FIELD_BAND: Record<FieldKey, string>`(`"border-l-field-ai"` … `NONE: "border-l-input"`), `FIELD_TEXT: Record<CalendarField, string>`(`"text-field-ai"` …), `FIELD_SWATCH: Record<FieldKey, string>`(`"bg-field-ai"` … `NONE: "bg-input"`)

- [ ] **Step 1: 실패하는 시험을 쓴다**

- `event()` 조각의 `bid` 기본값에 `field: null`. `busy-1`(DEMO·관심, 제목 "스마트 물관리 디지털트윈…")에 `field: "DIGITAL_TWIN"`, `today` 에 `field: "AI_AX"` 를 준다.
- 1440·1280 시험(197행~):
  - 이름 정규식을 `/스마트 물관리.*디지털트윈 내 관심 DEMO$/` 로 바꾼다(분야 이름은 제목 뒤, 표시 앞).
  - `demoChip.getByText("디지털트윈", { exact: true })` 가 보인다. `getComputedStyle(demoChip.element())` 의 `borderLeftWidth` 는 `"4px"`, `borderLeftColor` 는 `"rgb(4, 120, 87)"`.
  - 분야 없는 칩(`busy-2`)은 분야 글자가 없고 `borderLeftColor` 가 `"rgb(209, 214, 219)"`.
  - 좁은 칩 넘침(Review Focus 4): `demoChip` 안 `DEMO` 글자의 `getBoundingClientRect().right` ≤ 칩의 `right`, 분야 글자도 같다. 기존 `scrollWidth ≤ innerWidth` 는 그대로.
  - 다가오는 14일의 `today` 항목에 `AI·AX` 글자가 보인다.
- 종류 거르기 시험(326행~)의 범례: `legend.getByText("AI·AX")`·`legend.getByText("분야 없음")` 이 보이고, `legend.element().textContent` 에 `"데모용 가상 공고"` 와 `"DEMO"` 가 없다.
- 390px 시험(164행~): 모바일 일정 목록의 `today` 항목에 `AI·AX` 글자가 보인다.

- [ ] **Step 2: 시험이 실패하는지 본다**

Run: `bash <verify-slot.sh> timeout -k 30 600 pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/calendar/calendar-view.browser.test.tsx"`
Expected: FAIL (분야 글자·띠·범례 단언)

- [ ] **Step 3: 문구·클래스 맵·화면을 고친다**

- `calendar-copy.ts`·`calendar-fields.ts`: 위 Interfaces 그대로. 클래스 값은 완전한 문자열로 적는다.
- `chipTitle`·`chipName`: 제목 다음, `markersOf` 앞에 `FIELD_LABELS[field]` (분야 없음이면 넣지 않는다).
- `EventChip`: 링크에 `border-l-4` + `FIELD_BAND[fieldKeyOf(field)]`. 윗줄에 `overflow-hidden`, 오른쪽 묶음 순서는 ★ → 분야 글자(`font-semibold` + `FIELD_TEXT`) → DEMO. 칩이 좁으면(`@min-[7rem]` 아래) 지금처럼 종류 이름이 먼저 숨는다.
- `MoreEvents` 항목: `border-l-4` + 띠 클래스, 윗줄 글자 끝에 ` · ` + 색 분야 글자.
- `UpcomingItem`(다가오는 14일·모바일 목록 공용): `li` 에 `border-l-4 pl-3` + 띠 클래스, 기관 줄 맨 앞에 색 분야 글자.
- `Legend`: DEMO 항목을 지우고 `FIELD_LEGEND_ORDER` 순서로 색 칸(`size-2.5 rounded-xs` + `FIELD_SWATCH`) + 이름, 끝에 `분야 없음`. `내 관심`·`같은 날 일정 2건 이상` 은 둔다.
- 머리 주석(70행)·칩 주석(137행)에 "공고 분야는 왼쪽 띠 + 분야 이름 글자"를 한 줄 더한다. DEMO 표시를 다루는 주석(184행)은 그대로 맞다.

- [ ] **Step 4: 시험이 통과하는지 본다**

Run: Step 2 와 같은 명령
Expected: PASS. 시험이 남긴 1440·1280·390 스크린샷(`web/test-results/` 아래, 메모리 vitest-browser-screenshot-path)을 열어 띠·글자·범례가 시안 C와 같은지 눈으로 본다.

- [ ] **Step 5: 커밋(사용자가 요청한 경우만)**

```bash
git add "web/app/(app)/(work)/calendar/calendar-copy.ts" "web/app/(app)/(work)/calendar/calendar-fields.ts" "web/app/(app)/(work)/calendar/calendar-view.tsx" "web/app/(app)/(work)/calendar/calendar-view.browser.test.tsx"
git commit -m "feat(calendar): 일정 칩에 공고 분야 띠·이름 표시"
```

---

### Task 5: 문서·증거·변경 범위 검증

**Files:**
- Modify: `docs/06-UI-UX.md:506` (일정 행 끝 문장)
- Modify: `docs/PROGRESS.md` (최근 작업 로그 한 줄, 기능 상태 표의 입찰 일정 행)
- Create: `docs/evidence/calendar/20261103-field-colors-{1440,1280,390}.png` (Task 4 스크린샷 복사)

- [ ] **Step 1: 정본을 고친다**

`docs/06-UI-UX.md:506` 의 "종류는 색이 아니라 아이콘 + 글자로 나눈다" 뒤에 "공고 분야는 칩·더 보기 메뉴·다가오는 목록의 왼쪽 색 띠와 분야 이름 글자로 보인다(대표 분야 우선순위 AI·AX → 보안 → 클라우드 → 데이터 → 디지털트윈 → SI·SW, 분야 없음은 회색 띠. 범례에 분야 색을 두고 DEMO 항목은 두지 않는다. 칩의 DEMO 글자는 남는다. 2026-11-03 사용자 결정)"를 붙인다. frontmatter·위키링크 규약을 지킨다. 고치기 전에 두 파일이 다른 세션의 미커밋 변경 중인지 `git status` 로 보고, 그렇다면 손대지 않고 보고한다(메모리 concurrent-session-docs).

- [ ] **Step 2: 변경 범위 검증**

Run: `bash <verify-slot.sh> pnpm verify:changed`
Expected: 0 으로 끝난다. 실패하면 원인을 고치고 다시 돈다(검사를 끄거나 건너뛰지 않는다).

- [ ] **Step 3: 커밋(사용자가 요청한 경우만)**

```bash
git add docs/06-UI-UX.md docs/PROGRESS.md docs/evidence/calendar/20261103-field-colors-1440.png docs/evidence/calendar/20261103-field-colors-1280.png docs/evidence/calendar/20261103-field-colors-390.png
git commit -m "docs: 입찰 일정 공고 분야 색 기록"
```

## 운영 반영(이 계획 밖, 사용자 승인 필요)

- DB 변경이 없어 main push(Vercel 배포)만으로 반영된다. push 는 사용자 승인 뒤에 한다.
- 반영 뒤 운영 `/calendar` 를 1440·390 폭으로 열어 띠·범례를 확인하고, 관련 공고 읽기에 임베드가 늘었으므로 페이지가 눈에 띄게 느려지지 않았는지 본다.
