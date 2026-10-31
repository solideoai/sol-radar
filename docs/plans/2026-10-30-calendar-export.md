---
title: "입찰 일정 구글 캘린더·.ics 내보내기 구현 계획"
status: superseded
tags: [sol-radar, plan, calendar, hackathon]
updated: 2026-10-30
---

# 입찰 일정 구글 캘린더·.ics 내보내기 Implementation Plan

> [!warning] 퇴역 (2026-10-30, [[16-DECISIONS|ADR-073]] 예약)
> `.ics` 내려받기와 `GET /api/v1/calendar/ics`는 2026-10-30 사용자 결정(ADR-073)으로 퇴역한다. 일정별 "구글 캘린더에 추가" 링크(Task 1 `googleCalendarUrl`·Task 3 `UpcomingItem`)는 유지한다. 후속은 `polaris/specs/planned/2026-10-30-google-calendar-sync.md`다. 아래 본문은 당시 계획 기록이라 지우지 않는다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/calendar` 의 일정을 일정 하나씩 "구글 캘린더에 추가" 링크로, 지금 보는 달 전체를 `.ics` 파일로 내보낸다.

**Architecture:** OAuth·Google API 키·토큰 저장 없이 한다. 구글 링크는 Google Calendar 일정 만들기 주소(`calendar.google.com/calendar/render?action=TEMPLATE`)다. `.ics` 는 로그인한 사용자의 세션(RLS)으로 기존 `getCalendarEvents` 를 다시 불러 만드는 새 Route Handler `GET /api/v1/calendar/ics` 가 내려준다. 글자 만들기(요약·설명·RFC 5545 줄 접기·이스케이프)는 화면과 Route Handler 가 같이 쓰는 순수 함수 파일 하나에 둔다.

**Tech Stack:** Next.js 16 `web/`(서버 컴포넌트·Route Handler), 서버 도메인 `web/server/calendar`, Vitest(노드·브라우저).

**Spec:** [[2026-10-29-feature-backlog|기능 백로그]] "7. Google Calendar integration" 과 결정 D3 1안(일정 링크 + `.ics` 내려받기).

## Global Constraints

- OAuth·Google API 호출·토큰 저장·새 표 없음. 구독형 ICS 주소(비밀 토큰 공개 주소)도 만들지 않는다(백로그 "Not recommended before the freeze").
- 일정 길이는 30분(`EVENT_DURATION_MS = 30 * 60 * 1000`). 시각은 UTC(`YYYYMMDDTHHMMSSZ`)로 싣는다. 원래 일정은 KST 시각이다.
- `.ics` 는 RFC 5545: 줄 끝 CRLF, 한 줄 75옥텟(UTF-8 바이트) 넘으면 접기, TEXT 의 `\` `;` `,` 줄바꿈 이스케이프, `DTSTAMP`·`UID` 필수.
- `.ics` 응답: `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="sol-radar-calendar-YYYY-MM.ics"`(내 일정 보기는 `-mine` 을 붙인다), `Cache-Control: no-store`.
- 화면 부품(`calendar-view.tsx`)은 `@/server/calendar` 를 값으로 부르지 않는다(브라우저 시험이 그대로 그린다). 그래서 새 순수 함수 파일도 서버 모듈을 값으로 부르지 않는다.
- 금지 문구: 승률·확률·가능성·수주 금액·점유율·경쟁사.
- 화면 확인은 1440px·1280px 두 폭. 모바일 폭은 확인하지 않는다.
- 도메인 import 는 배럴로만, `@/`. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip` 금지. 사용자에게 보이는 글자·주석은 한국어.
- 화면 동결 2026-11-01 전에 main 에 들어가야 한다. push(=Vercel 운영 배포)는 사용자 승인 뒤 메인 세션이 한다.

## Review Focus

1. 한글 제목이 길다 → `.ics` 줄 접기가 UTF-8 글자 가운데를 자르지 않고, 모든 줄이 75옥텟 이하다. (Task 1 시험)
2. 제목·기관에 `,` `;` `\` 줄바꿈이 있다 → 이스케이프되어 캘린더 앱이 칸을 잘못 나누지 않는다. (Task 1 시험)
3. 조직 전체 보기에서 IT 공고 읽기가 실패했다 → 일부만 담긴 파일을 내려주지 않고 503 이다. (Task 2 시험)
4. 종류 거르기(`kinds`)를 켠 채 내려받는다 → 화면에 보이는 종류만 파일에 담긴다. 다른 달 일정은 담지 않는다. (Task 2 시험)
5. 로그인하지 않았거나 다른 조직 id 를 주소에 붙였다 → 401, 또는 세션 조직만 읽는다. (Task 2 시험)

---

### Task 1: 내보내기 글자 만들기(순수 함수)

**Files:**
- Create: `web/app/(app)/(work)/calendar/calendar-export.ts`
- Create: `web/app/(app)/(work)/calendar/calendar-export.test.ts`

**Interfaces:**
- Consumes: `type CalendarEvent`(`@/server/calendar`, 타입만), `KIND_LABELS`(`./calendar-copy`)
- Produces:
  - `EVENT_DURATION_MS: number`
  - `exportSummaryOf(event: CalendarEvent): string` — `[${KIND_LABELS[kind]}] ${title}`, 취소 공고는 앞에 `(공고 취소) `
  - `exportDescriptionOf(event: CalendarEvent, siteOrigin: string | null): string` — 줄마다 `기관: …`(없으면 "기관 미정"), 프로젝트가 있으면 `담당: …`(없으면 "없음"), 장소가 있으면 `장소: …`, `siteOrigin` 이 있으면 마지막 줄 `SOL RADAR: ${siteOrigin}${event.href}`. 줄 사이는 `\n`.
  - `googleCalendarUrl(event: CalendarEvent, siteOrigin: string | null): string` — `https://calendar.google.com/calendar/render?` + `URLSearchParams({ action: "TEMPLATE", text, dates: "<시작>/<끝>", details, location? })`. `location` 은 장소가 있을 때만.
  - `icsCalendar(events: readonly CalendarEvent[], options: { siteOrigin: string | null; now: string; name: string }): string`
  - `siteOriginOf(headers: { get(name: string): string | null }): string | null` — 호스트는 `x-forwarded-host` → `host` 순, 없으면 `null`. 프로토콜은 `x-forwarded-proto`, 없으면 호스트가 `localhost`·`127.0.0.1` 로 시작할 때 `http`, 아니면 `https`.

`icsCalendar` 의 출력(줄 순서 고정, CRLF 로 잇고 마지막에도 CRLF):

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SOL RADAR//입찰 일정//KO
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:<name>
X-WR-TIMEZONE:Asia/Seoul
(일정마다)
BEGIN:VEVENT
UID:<event.key>@sol-radar
DTSTAMP:<now UTC>
DTSTART:<at UTC>
DTEND:<at + 30분 UTC>
SUMMARY:<exportSummaryOf 이스케이프>
DESCRIPTION:<exportDescriptionOf 이스케이프>
LOCATION:<장소 이스케이프>        ← 장소가 있을 때만
URL:<siteOrigin + href>          ← siteOrigin 이 있을 때만
END:VEVENT
END:VCALENDAR
```

줄 접기: 한 줄이 75옥텟을 넘으면 75옥텟 안에서 **글자 경계**로 끊고, 다음 줄은 공백 한 칸으로 시작한다(이어진 줄은 공백 포함 75옥텟 이하).

- [ ] **Step 1: 실패하는 시험 쓰기** — `calendar-export.test.ts`

```ts
it("구글 링크는 TEMPLATE·UTC 30분·설명을 싣는다", () => {
  const url = new URL(googleCalendarUrl(event({ at: "2026-11-03T01:00:00.000Z" }), "https://sol.example"));
  expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
  expect(url.searchParams.get("action")).toBe("TEMPLATE");
  expect(url.searchParams.get("dates")).toBe("20261103T010000Z/20261103T013000Z");
  expect(url.searchParams.get("text")).toBe("[공고 마감] 가상 정보시스템 구축");
  expect(url.searchParams.get("details")).toContain("SOL RADAR: https://sol.example/bids/");
});
it(".ics 는 CRLF·필수 칸·이스케이프를 지킨다", () => {
  const text = icsCalendar([event({ title: "가상; 정보,시스템\\구축" })], { siteOrigin: null, now: NOW, name: "SOL RADAR 입찰 일정" });
  expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text).toContain("SUMMARY:[공고 마감] 가상\\; 정보\\,시스템\\\\구축");
  expect(text).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
  expect(text).not.toContain("URL:");
});
it("긴 한글 줄은 75옥텟 이하로 글자 경계에서 접는다", () => {
  const text = icsCalendar([event({ title: "가".repeat(80) })], { siteOrigin: null, now: NOW, name: "x" });
  const lines = text.split("\r\n");
  expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  expect(text.replaceAll("\r\n ", "")).toContain(`SUMMARY:[공고 마감] ${"가".repeat(80)}`);
});
it("취소 공고·장소·호스트 헤더", () => {
  expect(exportSummaryOf(event({ cancelled: true }))).toMatch(/^\(공고 취소\) \[/);
  expect(siteOriginOf(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  expect(siteOriginOf(new Headers({ "x-forwarded-host": "sol.example", "x-forwarded-proto": "https", host: "x" }))).toBe("https://sol.example");
  expect(siteOriginOf(new Headers())).toBeNull();
});
```

(`event()` 는 시험 안의 작은 생성 함수. `calendar-view.browser.test.tsx` 의 `event` 생성 모양을 따른다.)

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run "app/(app)/(work)/calendar/calendar-export.test.ts"` → FAIL
- [ ] **Step 3: 구현** — 줄 접기는 `TextEncoder` 로 바이트를 재고 `Array.from(line)`(코드 포인트) 단위로 쌓는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 보고** — 텍스트로. 커밋은 메인 세션.

### Task 2: `GET /api/v1/calendar/ics`

**Files:**
- Create: `web/app/api/v1/calendar/ics/route.ts`
- Create: `web/app/api/v1/calendar-ics-contract.test.ts`
- Modify: `docs/05-API-SPEC.md` (엔드포인트 표에 한 줄, 109행 "API가 없는 화면" 문장에 `/calendar` 는 내려받기 `GET /calendar/ics` 하나만 있다고 고침)

**Interfaces:**
- Consumes: `getCalendarEvents`, `calendarRepo`, `parseMonth`, `parseView`, `parseKinds`, `filterKinds`, `monthKey`, `monthOfDateKey`, `monthWeeks`, `kstDateKey`, `relevantDeadlineWindow`(`@/server/calendar`); `businessRoute`(`@/app/api/v1/_lib/work-route`); `apiError`(`@/app/api/v1/_lib/http`); Task 1 의 `icsCalendar`. Route Handler 의 `siteOrigin` 은 `siteOriginOf` 가 아니라 `new URL(request.url).origin` 이다.
- Produces: `GET ?month=YYYY-MM&view=org|mine&kinds=<쉼표 목록>` → `.ics` 본문. 쿼리 해석은 `page.tsx` 와 같다(틀린 `month` 는 이번 달, 틀린 `view` 는 `org`, `kinds` 없으면 전부).

처리 순서: `businessRoute` → 오늘(`kstDateKey(now)`)·달·보기·종류 해석 → `monthWeeks(month)` 마지막 칸 날짜로 `relevantDeadlineWindow` → `getCalendarEvents({ orgId: ctx.orgId, userId: ctx.userId }, view, { window }, { repo: calendarRepo })`(시험이 저장소를 바꿀 수 있게 **명시해서 넘긴다**) → `relevantFailed` 면 `apiError(503, "SERVICE_UNAVAILABLE", "IT 공고 일정을 불러오지 못했습니다. 잠시 뒤 다시 내려받으세요.", { component: "calendar-relevant" })` → `filterKinds` → `event.date.startsWith(monthKey(month))` 인 것만 → `icsCalendar(…, { siteOrigin: new URL(request.url).origin, now, name: "SOL RADAR 입찰 일정" })` → 위 Global Constraints 헤더와 `X-Request-Id` 로 응답.

- [ ] **Step 1: 실패하는 계약 시험 쓰기** — `workforce-contract.test.ts` 의 가짜 세션·`vi.mock` 모양을 그대로 따른다. `@/server/calendar` 의 `calendarRepo` 를 가짜로 바꾼다.

```ts
it("미인증은 401", async () => expect((await route.GET(fakeRequest("/api/v1/calendar/ics"))).status).toBe(401));
it("세션 조직의 이 달 일정만, 고른 종류만 .ics 로 내려준다", async () => {
  // 가짜 repo: 2026-11 공고 마감 1건, 2026-11 개찰 1건(원본 일정), 2026-12 공고 마감 1건
  const response = await route.GET(request("month=2026-11&kinds=BID_DEADLINE&orgId=forged"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
  expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="sol-radar-calendar-2026-11.ics"');
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.text();
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(state.loadedOrg).toBe(ORG_01);
});
it("조직 전체 보기에서 IT 공고 읽기가 실패하면 503", async () => {
  // 가짜 repo.loadRelevant 가 throw
  expect((await route.GET(request("month=2026-11"))).status).toBe(503);
});
```

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run app/api/v1/calendar-ics-contract.test.ts` → FAIL
- [ ] **Step 3: Route Handler 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `pnpm -C web exec vitest run server/calendar` PASS
- [ ] **Step 5: 문서** — `docs/05-API-SPEC.md` 두 곳(frontmatter `updated` 갱신)
- [ ] **Step 6: 보고** — 텍스트로. 커밋은 메인 세션.

### Task 3: 화면 — 내려받기 버튼, 일정별 구글 링크

**Files:**
- Modify: `web/app/(app)/(work)/calendar/page.tsx` (`siteOrigin`, `links.ics`)
- Modify: `web/app/(app)/(work)/calendar/calendar-view.tsx` (`CalendarLinks.ics`, `BidCalendar` 의 `siteOrigin` prop, 툴바 링크, `UpcomingItem` 구글 링크)
- Modify: `web/app/(app)/(work)/calendar/calendar-copy.ts` (문구)
- Modify: `web/app/(app)/(work)/calendar/calendar-view.browser.test.tsx` (props 추가, 시험 2건)
- Modify: `docs/06-UI-UX.md` 의 `/calendar` 절
- Evidence: `docs/evidence/calendar/20261030-export/` (1440·1280 스크린샷, 내려받은 `.ics` 를 구글 캘린더 가져오기로 확인한 결과는 README 에 글로)

**Interfaces:**
- Consumes: Task 1 `googleCalendarUrl`·`siteOriginOf`, Task 2 경로
- Produces: `CalendarLinks` 에 `ics: string`, `BidCalendar` props 에 `siteOrigin: string | null`
- 문구(`calendar-copy.ts`): `ICS_DOWNLOAD = "이 달 일정 내려받기(.ics)"`, `ICS_HINT = "구글 캘린더·아웃룩에서 가져오기로 추가합니다. 자동으로 갱신되지 않습니다."`, `GOOGLE_ADD = "구글 캘린더에 추가"`

화면 규칙:
- `page.tsx`: `siteOrigin = siteOriginOf(await headers())`(`next/headers`). `links.ics` 는 `calendarHref` 와 같은 방식으로 `/api/v1/calendar/ics?month=…&view=…&kinds=…` 를 만든다(기본 보기·전부 보이는 종류는 적지 않되 `month` 는 늘 적는다).
- 툴바(보기 전환 옆): `<a href={links.ics} download>` 를 `buttonVariants({ variant: "outline", size: "sm" })`, `DownloadIcon`, 글자 `ICS_DOWNLOAD`, `title={ICS_HINT}`.
- `UpcomingItem`: 기관 줄 끝에 `<a href={googleCalendarUrl(event, siteOrigin)} target="_blank" rel="noopener noreferrer">` 글자 `GOOGLE_ADD`, 접근 이름 `${event.bid.title} ${KIND_LABELS[event.kind]} ${GOOGLE_ADD}(새 창)`. 달력 칸의 칩과 "+n건" 메뉴에는 넣지 않는다(칸 높이).

- [ ] **Step 1: 실패하는 브라우저 시험 추가** — `calendar-view.browser.test.tsx`

```ts
it("툴바에 이 달 .ics 내려받기 링크가 있다", async () => {
  // links.ics = "/api/v1/calendar/ics?month=2026-10"
  // 링크 이름 "이 달 일정 내려받기(.ics)", href 그대로, download 속성 있음
});
it("다가오는 일정마다 구글 캘린더에 추가 링크가 새 창으로 열린다", async () => {
  // siteOrigin = "https://sol.example", 다가오는 일정 1건
  // href 가 https://calendar.google.com/calendar/render?action=TEMPLATE 로 시작, target=_blank, rel 에 noopener
});
```

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/calendar"` → 새 2건 FAIL
- [ ] **Step 3: 화면 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS(기존 시험 포함)
- [ ] **Step 5: 변경 범위 검증** — `bash <verify-slot.sh> pnpm verify:changed` exit 0(슬롯 스크립트 경로는 메모 [[heavy-verify-slots]])
- [ ] **Step 6: 화면 확인** — 격리 로컬 스택(메모 [[isolated-e2e-stacks]])에서 `/calendar` 1440·1280 스크린샷, 툴바가 1280 에서 줄바꿈되더라도 겹치지 않음. `.ics` 를 내려받아 줄 수·`BEGIN:VEVENT` 개수가 화면의 이 달 일정 수와 같은지 적는다. 구글 계정 가져오기는 사람이 할 수 있으면 하고, 못 했으면 "미확인"으로 적는다.
- [ ] **Step 7: 문서** — `docs/06-UI-UX.md` `/calendar` 절에 내려받기·구글 링크(frontmatter `updated` 갱신). `docs/PROGRESS.md` 는 메인 세션이 고친다.
- [ ] **Step 8: 보고** — 텍스트로. 커밋은 메인 세션.
