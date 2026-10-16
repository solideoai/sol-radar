---
title: "랜딩 재설계 구현 계획 — 큰 글자·제품 화면 판·새 로고"
doc: "plan-landing-redesign"
status: final
tags:
  - sol-radar
  - ui
  - hackathon
updated: 2026-10-16
---

# 랜딩 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 아트 디렉션대로 첫 화면을 다시 짠다 — 큰 글자(본문 18px·메뉴 17px), Ramp 식 왼쪽 정렬 히어로 + 3단 제품 화면 판(공고문 인용·결재란), 카드 없는 구역 구성, 직접 그린 로고 A안.

**Architecture:** 글자 눈금과 색은 `design/tokens.json` 에 더하고 `pnpm tokens` 로 만든다(랜딩 전용 새 눈금, 앱 눈금은 그대로). 랜딩 부품은 지금 자리(`web/components/landing/`)에서 구역별로 다시 쓰고, 마케팅 틀(`site-header.tsx`·`site-footer.tsx`·`logo.tsx`)을 바꾼다. 스크롤 등장 효과(`reveal.tsx`, 커밋 `b39b26e`)는 새 구성의 덩어리마다 다시 건다.

**Tech Stack:** Next.js 16.4 · React 19.3 · Tailwind v4.3 · shadcn(base-nova) · `@base-ui/react` 1.9(Tabs) · `lucide-react` · Vitest 4(node + browser) · Playwright 1.64 · impeccable 4.6(검출·비평)

**Spec:** [[2026-10-16-landing-redesign-design|아트 디렉션 — 첫 화면 재설계]](`docs/plans/2026-10-16-landing-redesign-design.md`, 승인됨). 구역별 클래스·문구·치수는 그 문서가 정본이고, 이 계획은 그 문서의 절 번호로 가리킨다. 실행자는 두 문서를 함께 읽는다. 이전 랜딩 계획 [[2026-10-16-landing-page]] 의 Global Constraints(정직성·문구)도 그대로 적용된다.

## Global Constraints

- 데스크톱 전용(1280~1920px). 확인 폭 1440·1280. 1280 미만 레이아웃·모바일 메뉴를 만들지 않는다(ADR-007).
- 가독성 바닥(랜딩 전체): 본문 18px(`type-body-lg`)·설명 20px(`type-lead`), 메뉴·버튼·판 주요 글자 17px(`type-ui-lg`), 라벨·배지·인용 15px(`type-label-lg`), 가장 작은 글자 14px(`type-body`). **13px 미만 0개.** 버튼 높이 `lg` 44px·`xl` 56px.
- 색은 `design/tokens.json` 에만. 화면 코드에 hex·rgba·기본 팔레트·그라데이션 금지(`check:colors`). `web/app/globals.css` 는 생성물이라 손으로 고치지 않는다.
- `brand` 파랑은 다섯 자리에만: 로고 점, 판의 선택 막대, 점수 막대, 인용 강조 바탕(`bg-brand/8`), 안내 아이콘(ⓘ)·포커스 링. 파란 글자 머리글·단계 번호 금지.
- AI 티 금지: 제목 위 머리글(eyebrow), 아이콘 칩, 같은 크기 카드 격자, 카드 속 카드, 유리·흐림, 유니코드 기호 아이콘, 문장 속 색 강조.
- 정직성(이전 계획 그대로): "예시 데이터" 배지(판에 하나), 기관 이름 `가상 ` 시작, 기능마다 "개발 예정", 히어로·기능·권유의 "MVP 개발 중" 안내, 점수 옆 "SOL Score는 사업 적합도이며 수주 확률이 아닙니다.", BID·WATCH·NO-BID 는 "권고", 결정은 "담당자". 판 안 링크 0개, `href="#"` 0개. 공고문 인용은 가상이며 법령 조항 번호를 쓰지 않는다.
- 문구는 디자인 문서가 정본이다(M3). 구역 `h2` 문구는 바꾸지 않는다(시험이 이 글자로 찾는다).
- 한글 줄바꿈: 랜딩 루트(`main`·머리말·바닥글)에 `break-keep`. `h2` 에 `<br>` 금지(히어로 `h1` 의 `<br>` 는 유지).
- 움직임: 새 연출 금지. `Reveal`(`@/components/landing/reveal`) 을 구역 제목 묶음 하나 + 내용 덩어리마다 건다(M2). 모두 `motion-safe` 에서만.
- 새 의존성 설치 금지. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip` 금지. import 는 `@/` 별칭.
- 주석은 한국어, "왜"만. 식별자는 영어. 지금 파일의 주석은 그 코드가 남는 한 지우지 않는다.
- 웹 코드를 쓰기 전에 `web/node_modules/next/dist/docs/` 의 관련 안내(app icon 규약: `01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`)를 읽는다.
- 로컬 e2e 는 Supabase 값이 없으면 `/` 가 500 이다. CI 와 같은 가짜 값으로 돌린다: `NEXT_PUBLIC_SUPABASE_URL=https://ci-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key-not-a-secret`.
- 커밋: 태스크마다 그 태스크의 파일만 지정해 `main` 에 커밋한다(`git add -A`·`.` 금지). 메시지 `타입(범위): 한국어 설명`(50자 이내) + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시하지 않는다. 커밋 게이트를 우회하지 않는다. 다른 Claude 세션이 같은 저장소의 `docs/` 를 고치고 있다 — 그 파일들을 스테이징하지 않는다. 서브에이전트는 git 상태를 바꾸지 않고, 커밋은 메인 세션이 한다.

## Review Focus

1. **1280px(스크롤바 포함)에서 커진 글자가 가로로 넘친다** — 판 3단(280·가변·288px)과 기능 줄 8칸 조각이 넘치지 않아야 한다 → 기존 `landing.spec.ts` 넘침 시험(1280·1440·1920) + Task 6 브라우저 시험(1280 판 넘침 0)을 유지·확장한다.
2. **한글이 낱말 중간에서 줄바꿈된다**("요구사/항") → Task 4 e2e: `main`·머리말·바닥글의 계산된 `word-break` 가 `keep-all`.
3. **어딘가에 13px 미만 글자가 남는다**(판 조각·배지·캡션) → Task 9 e2e: 1440 에서 보이는 글자 요소의 `font-size` 최솟값 ≥ 13px.
4. **머리말이 72px 로 커져 메뉴·`/#faq` 진입 뒤 구역 제목을 가린다** → 기존 `expectBelowHeader` 시험(메뉴 세 링크·`/#faq`·분석 예시 보기)이 그대로 통과해야 하고, 구역은 `scroll-mt-24`(96px).
5. **관리자 머리 막대(48px)에 새 로고가 들어가지 않는다**(M6, 로컬에서 관리자 화면을 못 연다) → Task 3 브라우저 시험: 48px 막대 안에 그린 `Logo` 의 높이 ≤ 28px, 가로 넘침 0.

---

### Task 1: 작업 도구·설계 문서 커밋

**Files:**
- Commit only: `.claude/agents/landing-art-director.md`, `.claude/skills/impeccable/`(복사한 외부 스킬, Apache-2.0 `LICENSE` 포함), `PRODUCT.md`, `docs/plans/2026-10-16-landing-redesign-design.md`, `docs/plans/2026-10-16-landing-redesign.md`(이 계획)

- [ ] **Step 1: 검사** — Run: `pnpm format:check` (루트). Expected: `All matched files use Prettier code style!`
- [ ] **Step 2: Commit**

```bash
git add .claude/agents/landing-art-director.md .claude/skills/impeccable PRODUCT.md docs/plans/2026-10-16-landing-redesign-design.md docs/plans/2026-10-16-landing-redesign.md
git commit -m "docs: 랜딩 재설계 아트 디렉션·계획과 도구 추가"
```

### Task 2: 글자 눈금·보조 글자색·버튼 크기 (T1·T2·T3)

**Files:**
- Modify: `design/tokens.json`(`typography`, `colors.muted-foreground`, `$comment` 한 문장)
- Generate: `web/app/globals.css`(`pnpm tokens`)
- Modify: `web/components/ui/button.tsx`(`size.lg`, 새 `size.xl`, 머리 주석의 높이 목록)
- Modify: `.claude/skills/design-system/SKILL.md`(웹 글자 눈금 표, "웹 틀" 표의 마케팅 줄, 방향 5번의 `brand` 자리)

**Interfaces:**
- Produces: 유틸리티 `type-display`(64/76 700 −0.03em), `type-headline`(44/56 700 −0.025em), `type-subhead`(28/38 700 −0.02em), `type-heading-lg`(24/34 600 −0.015em), `type-lead`(20/32, −0.005em), `type-body-lg`(18/30), `type-ui-lg`(17/26), `type-label-lg`(15/22), `type-wordmark`(20/20 800 +0.02em). `buttonVariants({ size: "lg" })` = 44px·`type-ui-lg`, `buttonVariants({ size: "xl" })` = 56px(`h-14`)·`px-7`·`type-ui-lg font-semibold`. `text-muted-foreground` = #4E5968.

- [ ] **Step 1: 토큰 수정** — `typography` 의 `display`·`headline`·`lead` 값을 위 값으로 바꾸고 `subhead`·`heading-lg`·`body-lg`·`ui-lg`·`label-lg`·`wordmark` 를 더한다(항목 형식 `{ "size", "lineHeight", "weight"?, "tracking"? }`, 자간은 `"-0.03em"` 같은 문자열). `title`·`heading`·`body`·`label`·`caption` 은 그대로. `colors.muted-foreground` 를 `"#4E5968"` 로. `$comment` 끝에 "display·headline·lead 와 *-lg·subhead·wordmark 는 첫 화면 전용 눈금이다(docs/plans/2026-10-16-landing-redesign-design.md). 앱 화면은 title·heading·body·label·caption 만 쓴다." 를 더한다.
- [ ] **Step 2: 생성·검사** — Run: `pnpm tokens && grep -c "@utility type-" web/app/globals.css && pnpm -C web check:tokens`. Expected: 유틸리티 14개, `✓ 디자인 토큰 일치`.
- [ ] **Step 3: 버튼** — `lg`: `"h-11 gap-2 px-5 type-ui-lg has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4"`(15px 주석 줄은 지운다 — 그 15px 이 사라진다). `xl`: `"h-14 gap-2 px-7 type-ui-lg font-semibold has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5"`. 머리 주석의 높이 목록에 "· xl 56px(첫 화면 전용)" 을 더한다.
- [ ] **Step 4: 스킬 표** — 웹 눈금 표에 바뀐 값과 새 여섯 줄을 "첫 화면 전용" 쓰임으로 적는다. "웹 틀" 마케팅 줄을: "단 폭 `max-w-320` + `px-10`(글줄 1200px). 머리말 72px 단색 흰 바탕. 본문 바탕 흰색, 제품 화면 무대·권유 띠만 `bg-muted`. 글자는 첫 화면 눈금(`*-lg`·`subhead`·`wordmark`)을 쓰고 13px 미만을 쓰지 않는다. 바닥글은 어두운 바탕(`bg-foreground`·`text-background`, 로고는 `<Logo inverted />`)" 으로 바꾼다. 방향 5번에 "첫 화면에서는 로고 점·선택 막대·점수 막대·인용 바탕·안내 아이콘에도 쓴다" 를 더한다.
- [ ] **Step 5: 앱 화면 영향(T2) 확인** — 프로덕션 빌드(`pnpm -C web build`, 가짜 값)로 띄운 `/auth/login`·`/auth/sign-up` 을 1440 에서 찍어 바뀐 것이 보조 글자색뿐인지 본다(로그인 뒤 화면은 로컬 DB 가 없어 못 연다 — 보고에 적는다). 스크린샷은 저장소 밖 임시 폴더에 둔다.
- [ ] **Step 6: 검증** — Run: `pnpm -C web verify:quick`. Expected: 통과(`check:colors` 포함).
- [ ] **Step 7: Commit**

```bash
git add design/tokens.json web/app/globals.css web/components/ui/button.tsx .claude/skills/design-system/SKILL.md
git commit -m "feat(web): 첫 화면 글자 눈금·버튼 크기와 보조 글자색 조정"
```

### Task 3: 로고 A안·파비콘·브랜드 원본 (T5·M5·M6·U4라)

**Files:**
- Create: `design/brand/sol-radar-lockup.svg`, `sol-radar-lockup-mono.svg`, `sol-radar-lockup-white.svg`, `sol-radar-mark.svg`, `sol-radar-favicon.svg` — 각각 임시 폴더 `/private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/fc8fe270-b7ab-45f7-8b5a-97adc8f8ef75/scratchpad/art/logo/` 의 `a-lockup.svg`·`a-lockup-mono.svg`·`a-lockup-white.svg`·`a-mark.svg`·`a-favicon.svg` 를 그대로 복사(없으면 멈추고 보고)
- Create: `web/app/icon.svg`(= `a-favicon.svg`)
- Delete: `web/app/favicon.ico`
- Modify: `web/components/logo.tsx`
- Modify: `web/e2e/operations.spec.ts:8`(`"/favicon.ico"` → `"/icon.svg"`)
- Test: `web/components/logo.browser.test.tsx`(새 파일. 렌더는 `product-preview.browser.test.tsx` 의 `createRoot` + `afterEach` 정리 패턴을 따라 `renderLogo(node: React.ReactNode)` 도우미로 쓴다)

**Interfaces:**
- Produces: `Logo({ className?: string; inverted?: boolean })` — 시그니처는 그대로. 마크는 인라인 SVG(`viewBox="0 0 24 24"`, `size-6.5`, `aria-hidden`), 워드마크는 글자 `{project.title}` + `type-wordmark`. `inverted` 면 세 도형·글자 모두 `currentColor`(`text-background`), 아니면 낫표 `text-foreground`·점 `fill-brand`.

- [ ] **Step 1: 실패하는 시험 쓰기** — `logo.browser.test.tsx`:

```tsx
it("마크는 장식이고, 이름은 글자로 읽힌다", async () => {
  await renderLogo(<Logo />);
  await expect.element(page.getByText("SOL RADAR", { exact: true })).toBeVisible();
  expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelectorAll("svg path")).toHaveLength(2);
  expect(document.querySelectorAll("svg circle")).toHaveLength(1);
});

it("관리자 머리 막대(48px) 안에 들어가고 넘치지 않는다", async () => {
  await renderLogo(<div className="flex min-h-12 w-80 items-center"><Logo className="min-w-0" /></div>);
  const logo = document.querySelector("span")!;
  expect(logo.getBoundingClientRect().height).toBeLessThanOrEqual(28);
  expect(logo.scrollWidth).toBeLessThanOrEqual(logo.clientWidth + 1);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run --config vitest.browser.config.ts components/logo.browser.test.tsx`. Expected: FAIL(지금 마크는 lucide `RadarIcon` 이라 `path` 수가 다르다).
- [ ] **Step 3: `logo.tsx` 다시 쓰기** — 디자인 문서 "A안 치수"의 SVG 좌표 그대로. 마크 `size-6.5`, 마크와 글자 간격 `gap-1.25`, 세로 가운데 정렬. 둥근 사각형 상자·lucide import 를 지운다. 기존 주석 세 줄(project.json·Link·min-w-0)은 남긴다.
- [ ] **Step 4: 파비콘·원본** — 위 복사, `favicon.ico` 삭제, `operations.spec.ts` 경로 수정.
- [ ] **Step 5: 통과 확인** — Run: Step 2 명령 → PASS. 그리고 `pnpm -C web build` 뒤 서버를 띄워 `curl -sI http://127.0.0.1:<port>/icon.svg | head -1` → `200`, 첫 화면 HTML 에 `rel="icon"` 이 `icon.svg` 를 가리키고 `favicon.ico` 가 없는지 `curl -s / | grep -o 'rel="icon"[^>]*'` 로 본다.
- [ ] **Step 6: 눈으로 비교** — 1440 머리말과 바닥글의 로고를 찍어 `design/brand/sol-radar-lockup.svg`(같은 높이로 렌더)와 나란히 보아 비율·간격이 1px 안인지 본다.
- [ ] **Step 7: Commit**

```bash
git add design/brand web/app/icon.svg web/app/favicon.ico web/components/logo.tsx web/components/logo.browser.test.tsx web/e2e/operations.spec.ts
git commit -m "feat(web): 로고를 인용 표식 A안으로 바꾸고 파비콘 교체"
```

### Task 4: 마케팅 틀 — 머리말·바닥글·본문 바탕 (T4)

**Files:**
- Modify: `web/components/site-header.tsx`, `web/components/site-footer.tsx`, `web/app/page.tsx:39`
- Test: `web/e2e/site-header.spec.ts`(시험 추가), `web/e2e/landing.spec.ts`(시험 추가)

**Interfaces:**
- Consumes: Task 2 의 `type-ui-lg`·`type-body`, `buttonVariants({ size: "lg" })`, Task 3 의 `Logo`.
- Produces: 머리말 높이 72px(+아래 선 1px), 마케팅 단 `mx-auto w-full max-w-320 px-10`(이후 구역이 같은 클래스를 쓴다).

- [ ] **Step 1: 실패하는 시험 쓰기** — `site-header.spec.ts`:

```ts
test("머리말은 72px 단색이고 메뉴 글자는 17px 이다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const { height } = await boxOf(header);
  expect(height).toBeGreaterThanOrEqual(72);
  expect(height).toBeLessThanOrEqual(73);
  await expect(header).toHaveCSS("backdrop-filter", "none");
  await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(
    header.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link").first(),
  ).toHaveCSS("font-size", "17px");
});
```

`landing.spec.ts`:

```ts
test("첫 화면 본문·머리말·바닥글은 낱말 단위로 줄을 바꾸고 바탕은 흰색이다", async ({ page }) => {
  await page.goto("/");
  for (const role of ["main", "banner", "contentinfo"] as const) {
    await expect(page.getByRole(role)).toHaveCSS("word-break", "keep-all");
  }
  await expect(page.getByRole("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec playwright test e2e/site-header.spec.ts e2e/landing.spec.ts -g "72px|낱말"`(가짜 Supabase 값). Expected: FAIL(지금 64px·흐림·13px, `bg-muted/50`).
- [ ] **Step 3: 구현** — 디자인 문서 0절(머리말)·9절(바닥글)·"공통 틀"대로. 머리말: `bg-background`(흐림 제거), `min-h-18`, 메뉴는 버튼 변형이 아닌 링크 클래스(`rounded-lg px-3.5 py-2.5 type-ui-lg font-medium text-foreground hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50`), 로그인 `ghost`·`lg`, 시작하기 `outline`·`lg` + `border-foreground`(M1). 바닥글: `pt-16 pb-10`, 설명·링크 `type-ui-lg text-background/72`, 저작권 `type-body text-background/72`. `page.tsx` 의 `main`: `bg-muted/50` → `bg-background`, `break-keep selection:bg-brand/15` 추가(주석의 "바탕(muted 의 절반)" 문장은 새 이유로 고친다). 머리말·바닥글 루트에도 `break-keep`.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. 이어서 `e2e/site-header.spec.ts` 전체(1280 한 줄·sticky·건너뛰기)와 `e2e/landing-sections.spec.ts` 의 머리말 이동 시험 → PASS.
- [ ] **Step 5: 검증·Commit** — Run: `pnpm -C web verify:quick` → 통과.

```bash
git add web/components/site-header.tsx web/components/site-footer.tsx web/app/page.tsx web/e2e/site-header.spec.ts web/e2e/landing.spec.ts
git commit -m "feat(web): 첫 화면 머리말·바닥글을 크게, 바탕을 흰색으로"
```

### Task 5: 예시 공고의 공고문 인용 데이터 (T7)

**Files:**
- Modify: `web/components/landing/demo-bids.ts`
- Test: `web/components/landing/demo-bids.test.ts`

**Interfaces:**
- Produces: `export type Evidence = { page: number; quote: string }`, `export type DemoCheck = QualificationCheck & { evidence: Evidence }`. `DemoBid["checks"]` 는 `DemoCheck[]`. `quote` 에는 낫표를 넣지 않는다(그리는 쪽이 「」 를 붙인다). `analysis.ts` 의 `QualificationCheck` 는 바꾸지 않는다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
it("자격 항목마다 공고문 쪽수와 인용이 있고, 인용에는 낫표·조항 번호가 없다", () => {
  DEMO_BIDS.flatMap((bid) => bid.checks).forEach((check) => {
    expect(check.evidence.page).toBeGreaterThan(0);
    expect(check.evidence.quote).not.toMatch(/[「」]|제\s*\d+\s*조/);
  });
});

it("대표 예시의 인용은 디자인 문서의 값이다", () => {
  expect(DEMO_BIDS[0].checks.map((check) => check.evidence)).toEqual([
    { page: 2, quote: "소프트웨어사업자로 신고한 자" },
    { page: 2, quote: "중소기업자 간 제한경쟁입찰" },
    { page: 4, quote: "입찰 마감일 기준 유효한 인증서 사본" },
  ]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run components/landing/demo-bids.test.ts`. Expected: FAIL(`evidence` 없음 — 타입 오류 또는 `undefined`).
- [ ] **Step 3: 구현** — `SOFTWARE_BUSINESS` p.2 「소프트웨어사업자로 신고한 자」, `SME_ONLY` p.2 「중소기업자 간 제한경쟁입찰」, demo-1 필수 증빙 p.4 「입찰 마감일 기준 유효한 인증서 사본」, demo-2 직접생산확인증명 p.3 「직접생산확인증명서를 보유한 자」, demo-3 원격교육 실적 p.3 「원격교육 분야 수행 실적 1건 이상」. 파일 머리 주석에 "인용문도 지어낸 것이다"를 더한다.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. `pnpm -C web type-check` → 통과.
- [ ] **Step 5: Commit**

```bash
git add web/components/landing/demo-bids.ts web/components/landing/demo-bids.test.ts
git commit -m "feat(web): 예시 공고 자격 항목에 공고문 인용 추가"
```

### Task 6: 히어로·제품 화면 판

**Files:**
- Modify: `web/components/landing/hero.tsx`, `product-preview-section.tsx`, `product-preview.tsx`, `status-badges.tsx`
- Test: `web/components/landing/product-preview.browser.test.tsx`, `web/e2e/landing.spec.ts`

**Interfaces:**
- Consumes: Task 5 의 `DemoCheck.evidence`, Task 2 눈금·`buttonVariants({ size: "xl" })`.
- Produces: `RecommendationBadge({ value, className? })`·`DemoBadge({ className? })`·`PlannedBadge()` — 크기는 하나(`px-2 py-1 type-label-lg [&_svg]:size-4`), `size` 속성과 `sm` 을 없앤다(첫 화면에 12px 배지를 두지 않는다). `QualificationLabel({ status })` 는 `type-ui-lg font-semibold`, 아이콘 `size-4.5`. 새 부품 `EvidenceQuote({ evidence }: { evidence: Evidence })` 를 `status-badges.tsx` 에서 내보낸다(Task 7 이 다시 쓴다): "공고문 p.{page}"(`font-semibold text-foreground`) + `「{quote}」`(`rounded-sm bg-brand/8 px-0.5`), 전체 `type-label-lg`.

- [ ] **Step 1: 실패하는 시험 쓰기** — 브라우저 시험의 "공고 원문 자리는 링크가 아니라…" 를 바꾼다:

```tsx
it("자격 항목마다 공고문 쪽수와 인용이 보이고, 판에는 링크가 없다", async () => {
  await render();
  const panel = page.getByRole("tabpanel");
  await expect.element(panel.getByText("「소프트웨어사업자로 신고한 자」")).toBeVisible();
  await expect.element(panel.getByText("공고문 p.4")).toBeVisible();
  expect(document.querySelectorAll("a")).toHaveLength(0);
});

it("결재란에 시스템 권고와 담당자 결정 대기가 나란히 있다", async () => {
  await render();
  const panel = page.getByRole("tabpanel");
  await expect.element(panel.getByText("시스템 권고")).toBeVisible();
  await expect.element(panel.getByText("담당자 결정")).toBeVisible();
  await expect.element(panel.getByText("대기", { exact: true })).toBeVisible();
});
```

(렌더 도우미는 그 파일의 `render()` 다. 그 안의 감싸개를 랜딩과 같은 새 단 `<main className="mx-auto w-full max-w-320 px-10">` 으로 바꾼다 — 1280 넘침 시험이 실제 폭을 재게 한다.) `landing.spec.ts`: 히어로 시험에서 머리글 단언을 `hero.getByText(/공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 서비스입니다/)` 로, 약속 줄 단언을 `await expect(hero.getByRole("listitem")).toHaveCount(0);` 로 바꾼다. 미리보기 시험에서 `유사 사업 실적 보유`·`주요 기술 요구사항 부합` 두 줄을 지우고 `panel.getByText("공고문 p.2").first()`·`panel.getByText("담당자 결정")` 확인을 더한다. 새 시험:

```ts
test("1440×900 첫 화면에서 스크롤 없이 점수와 수주 확률 고지가 보인다", async ({ page }) => {
  await page.goto("/");
  const panel = previewOf(page).getByRole("tabpanel");
  await expect(panel.getByRole("meter", { name: "SOL Score" })).toBeInViewport();
  await expect(panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다.")).toBeInViewport();
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run --config vitest.browser.config.ts components/landing/product-preview.browser.test.tsx` 와 `pnpm -C web exec playwright test e2e/landing.spec.ts`(가짜 값). Expected: 새·바꾼 시험 FAIL.
- [ ] **Step 3: 히어로** — 디자인 문서 1절. 머리글 `p` 와 `PROMISES` 를 지우고 그 문구를 설명 첫 문장으로("공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 서비스입니다. 기업의 기술·자격·실적과 공고 요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 한눈에 확인하세요."), 버튼 `xl`(분석 예시 보기는 `outline` + `border-foreground`), 안내 `type-ui-lg` + `InfoIcon size-5 text-brand`. 히어로 섹션과 판 섹션은 마케팅 단(`max-w-320 px-10`)을 쓴다. 로드 애니메이션(`motion-safe:animate-in …`)은 유지.
- [ ] **Step 4: 판** — 디자인 문서 2절 그대로. 구조: 창 머리(DemoBadge 하나) → `Tabs.Root` 를 `grid-cols-[280px_minmax(0,1fr)_288px]` 로, 왼쪽 목록 칸 + `Tabs.Panel` 은 `col-span-2 grid grid-cols-[minmax(0,1fr)_288px]`(가운데·오른쪽 레일). 지우는 것: 패널의 `DemoBadge`, 사실 상자 테두리, `ScoreBlock`·`RecommendationBlock`·`ListBlock`·`SourceBlock` 카드 틀, `Link2OffIcon`·`RadarIcon`. 자격 목록은 선으로만(`border-t`), 항목마다 `EvidenceQuote`. 추가 확인은 `followUps[0]` 이 있을 때만 `TriangleAlertIcon size-5 text-warning` + 한 줄. 결재란은 `dl` 2칸. `role="meter"`·`aria-describedby`·`activateOnFocus`·패널 `fade-in` 은 유지. figcaption 문구를 "가상의 공고와 기업 정보로 만든 예시 화면입니다. 실제 공고·기관과 관계없고, 인용문과 숫자는 화면 설명을 위한 값입니다." 로, 섹션 `scroll-mt-24`.
- [ ] **Step 5: 통과 확인** — Step 2 두 명령 → PASS(방향키·Tab 초점·1280 넘침 시험 포함). `pnpm -C web exec playwright test e2e/landing.spec.ts e2e/landing-reveal.spec.ts` → PASS.
- [ ] **Step 6: 눈으로 확인** — 1440×900·1280×800 첫 화면을 찍어 목업 `…/scratchpad/art/mockup/landing-1440-view.png`·`board.png` 와 비교한다(구성·위계가 같고, 판 안 12px 글자가 없는지).
- [ ] **Step 7: 검증·Commit** — `pnpm -C web verify:quick` → 통과.

```bash
git add web/components/landing/hero.tsx web/components/landing/product-preview-section.tsx web/components/landing/product-preview.tsx web/components/landing/status-badges.tsx web/components/landing/product-preview.browser.test.tsx web/e2e/landing.spec.ts
git commit -m "feat(web): 히어로와 3단 제품 화면 판으로 재구성"
```

### Task 7: 서비스 소개 비교표·주요 기능 줄

**Files:**
- Modify: `web/components/landing/section-heading.tsx`, `problem-section.tsx`, `features-section.tsx`, `feature-previews.tsx`
- Delete: `web/components/landing/icon-chip.tsx`(사용처 0 확인 뒤, U4다)
- Test: `web/e2e/landing-sections.spec.ts`

**Interfaces:**
- Consumes: Task 6 의 `EvidenceQuote`·`PlannedBadge`·`QualificationLabel`, `Reveal`.
- Produces: `SectionHeading({ id, title, description?, className? })` — `eyebrow` 를 없앤다. `h2` 는 `type-headline text-balance max-w-220`, 설명 `mt-5 max-w-190 type-lead text-muted-foreground`. Task 8 도 이 부품을 쓴다.

- [ ] **Step 1: 실패하는 시험 쓰기** — "문제 공감 구역에 세 상황이 있다" 를 바꾼다:

```ts
test("서비스 소개는 지금 방식과 SOL RADAR 를 비교하는 표다", async ({ page }) => {
  await page.goto("/");
  const about = page.getByRole("region", { name: SECTIONS[2].title });
  await expect(about.getByRole("columnheader")).toHaveText(["검토 단계", "지금은", /SOL RADAR에서는/]);
  await expect(about.getByRole("rowheader")).toHaveText(["요구사항 파악", "자격·실적 대조", "판단 기록"]);
  await expect(about.getByText("서비스 소개", { exact: true })).toHaveCount(0);
});

test("구역 제목 위에 작은 머리글이 없다", async ({ page }) => {
  await page.goto("/");
  const h2s = page.getByRole("main").locator("h2:not(.sr-only)");
  await expect(h2s).not.toHaveCount(0);
  for (const h2 of await h2s.all()) {
    expect(await h2.evaluate((element) => element.previousElementSibling)).toBeNull();
  }
});
```

주요 기능 시험에 `await expect(features.getByText(/필수 실적 요건 미충족/)).toBeVisible();`(점수 조각이 demo-3 의 근거를 보인다)를 더한다.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec playwright test e2e/landing-sections.spec.ts`(가짜 값). Expected: 새 시험 FAIL.
- [ ] **Step 3: 구현** — 디자인 문서 3절(비교표 — 세 줄 문구는 3절 표, "지금은" 칸은 지금 `PAINS` 의 `body`)·4절(기능 줄 네 개, 왼쪽 4칸 `type-subhead` + 설명 `type-body-lg` + `PlannedBadge`, 오른쪽 8칸 조각). 조각: 수집 = 표 4열 3줄 마감순, 자격 = 세 상태 줄 + `EvidenceQuote`, 점수 = demo-3(`DEMO_BIDS[2]`) 요소 5줄 + `reasons` 두 줄 + "적합도 지표입니다. 수주 확률이 아닙니다.", 이력 = 두 줄(변경 알림·참여 결정, "검토 의견" 삭제). 조각은 지금처럼 `aria-hidden` + `inert` 로 감싸고 글자는 15px 이상. `Reveal`: 구역 제목 묶음 하나, 비교표 하나, 기능 줄 하나씩(M2). 섹션 `scroll-mt-24`, 마케팅 단. `IconChip` import 를 모두 지우고 `icon-chip.tsx` 를 지운다.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS. `pnpm -C web exec playwright test e2e/landing-reveal.spec.ts` → PASS(주요 기능 제목 묶음은 여전히 `data-reveal` 블록이다).
- [ ] **Step 5: 검증·Commit** — `pnpm -C web verify:quick` → 통과.

```bash
git add web/components/landing/section-heading.tsx web/components/landing/problem-section.tsx web/components/landing/features-section.tsx web/components/landing/feature-previews.tsx web/components/landing/icon-chip.tsx web/e2e/landing-sections.spec.ts
git commit -m "feat(web): 서비스 소개 비교표와 주요 기능 줄로 재구성"
```

### Task 8: 분석 방식 띠·원칙 격자·펼친 FAQ·권유 띠

**Files:**
- Modify: `web/components/landing/how-it-works-section.tsx`, `principles-section.tsx`, `faq-section.tsx`, `final-cta-section.tsx`
- Delete: `web/components/ui/accordion.tsx`(사용처 0 확인 뒤, U4나)
- Test: `web/e2e/landing-sections.spec.ts`

**Interfaces:**
- Consumes: `SectionHeading`(Task 7), `EvidenceQuote`·`QualificationLabel`·`RecommendationBadge`(Task 6), `buttonVariants({ size: "xl" })`, `Reveal`.

- [ ] **Step 1: 실패하는 시험 쓰기** — FAQ 시험을 바꾼다:

```ts
test("FAQ 는 질문 다섯 개와 답이 처음부터 펼쳐져 있다", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "자주 묻는 질문" });
  await expect(faq.locator("dt")).toHaveText(FAQ_QUESTIONS);
  await expect(faq.locator("dd")).toHaveCount(5);
  await expect(faq.getByText(/실제 수주 확률을 의미하지 않습니다/)).toBeVisible();
  await expect(faq.getByRole("button")).toHaveCount(0);
});
```

분석 원칙 시험에 `await expect(principles.getByText("화면에서", { exact: true })).toHaveCount(4);` 와 `await expect(principles.getByText(/「소프트웨어사업자로 신고한 자」/)).toBeVisible();` 를 더한다. 마지막 구역 시험에 `await expect(cta.getByRole("link", { name: "시작하기", exact: true })).toHaveCSS("height", "56px");` 를 더한다.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec playwright test e2e/landing-sections.spec.ts`(가짜 값). Expected: 바꾼 세 시험 FAIL.
- [ ] **Step 3: 구현** — 디자인 문서 5절(단계 띠 — "1단계" 는 `text-foreground`, 파랑 아님), 6절(2×2 선 격자 + "화면에서" 줄: 원칙 1 = `EvidenceQuote`(demo-1 첫 항목), 2 = `QualificationLabel` 세 개, 3 = "SOL Score **82** / 100 · 수주 확률이 아닙니다", 4 = `RecommendationBadge` WATCH + "권고 · 담당자 결정 대기"), 7절(`dl` 펼친 목록, 질문·답 문구 그대로), 8절(화면 폭 `bg-muted` 띠, 카드 없음, 버튼 `xl`, 안내 `role="note"`). `Reveal`: 각 구역 제목 묶음 하나 + 내용 하나(단계 띠 / 원칙 격자 / 질문 목록 / 권유 띠 안쪽). 섹션 `scroll-mt-24`, 마케팅 단. `Accordion` import 를 지우고 `ui/accordion.tsx` 를 지운다.
- [ ] **Step 4: 통과 확인** — Run: `rg -n "Card\b|IconChip|ui/accordion" web/components/landing` → 결과 없음. Step 2 명령 → PASS. `e2e/landing-reveal.spec.ts` → PASS(`/#faq` 회귀 시험 포함).
- [ ] **Step 5: 검증·Commit** — `pnpm -C web verify:quick` → 통과.

```bash
git add web/components/landing/how-it-works-section.tsx web/components/landing/principles-section.tsx web/components/landing/faq-section.tsx web/components/landing/final-cta-section.tsx web/components/ui/accordion.tsx web/e2e/landing-sections.spec.ts
git commit -m "feat(web): 분석 방식·원칙·FAQ·권유 구역을 카드 없이 재구성"
```

### Task 9: 마감 — 가독성 시험·검출·비평·증거

**Files:**
- Test: `web/e2e/landing.spec.ts`(시험 추가)
- Create: `docs/evidence/landing/20261016-redesign-{view,full}-{1440,1280}.png`, `docs/evidence/landing/20261016-redesign-test-report.txt`
- Modify: `docs/PROGRESS.md`(작업 로그 한 줄 — 다른 세션의 변경과 겹치지 않게 자기 줄만 더한다), `docs/plans/2026-10-16-landing-redesign.md`(`status: final`)

- [ ] **Step 1: 시험 쓰기**

```ts
test("1440 첫 화면의 보이는 글자는 모두 13px 이상이다", async ({ page }) => {
  await page.goto("/");
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()))
      .filter((element) => element.getClientRects().length > 0 && !element.closest(".sr-only"))
      .map((element) => parseFloat(getComputedStyle(element).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(50);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
});
```

- [ ] **Step 2: 실행** — Run: 위 시험(가짜 값) → PASS. 실패하면 지목된 요소를 눈금으로 고친다(시험을 약하게 하지 않는다).
- [ ] **Step 3: impeccable 검출** — Run: `.claude/skills/impeccable/scripts/impeccable detect --json web/components/landing web/components/logo.tsx web/components/site-header.tsx web/components/site-footer.tsx web/app/page.tsx`. Expected: 0건.
- [ ] **Step 4: 비평** — `landing-art-director` 에이전트에게 1440·1280 첫 화면·전체 스크린샷과 디자인 문서를 주고 대조를 맡긴다. 어긋난 곳만 고치고, 고친 뒤 Step 2·3 을 다시 돈다.
- [ ] **Step 5: 전체 검증** — Run: 루트 `pnpm verify`, 그리고 `pnpm -C web test:e2e`(가짜 값) 출력을 `docs/evidence/landing/20261016-redesign-test-report.txt` 에 저장. Expected: 모두 통과.
- [ ] **Step 6: 증거** — 프로덕션 서버를 띄워 1440×900·1280×800 첫 화면(`-view`)과 맨 위부터 화면 높이씩 내린 뒤 찍은 전체 화면(`-full`)을 `docs/evidence/landing/` 에 저장한다. 콘솔 오류·경고 0건을 확인한다.
- [ ] **Step 7: 기록·Commit** — `docs/PROGRESS.md` 작업 로그에 한 줄(무엇·검증·남은 것), 계획 `status: final`.

```bash
git add web/e2e/landing.spec.ts docs/evidence/landing/20261016-redesign-view-1440.png docs/evidence/landing/20261016-redesign-view-1280.png docs/evidence/landing/20261016-redesign-full-1440.png docs/evidence/landing/20261016-redesign-full-1280.png docs/evidence/landing/20261016-redesign-test-report.txt docs/PROGRESS.md docs/plans/2026-10-16-landing-redesign.md
git commit -m "test(web): 랜딩 가독성 시험과 재설계 증거 추가"
```

## 관련 문서

- [[2026-10-16-landing-redesign-design|아트 디렉션 — 첫 화면 재설계]] — 이 계획의 정본
- [[2026-10-16-landing-page|이전 랜딩 계획]] — Global Constraints(정직성·문구)
- [[06-UI-UX|06 UI]] — 데스크톱 원칙·접근성
- [[16-DECISIONS|16 ADR]] — ADR-007
