---
title: "화면 UI 전체 개편 단계 계획"
doc: "plan-20261028-ui-refresh"
status: active
tags:
  - sol-radar
  - ui
  - landing
  - hackathon
updated: 2026-10-28
---

# 화면 UI 전체 개편 단계 계획

> **에이전트 작업자에게:** 이 계획은 작업자 4명(0f·ac·09·df)이 자기 묶음의 Task 를 차례로 실행한다. 단계는 체크박스(`- [ ]`)로 표시한다. superpowers:executing-plans 로 자기 Task 만 실행한다.

**목표:** 레퍼런스(granter User Guide)처럼 파스텔 선택색·묶음 사이드바·경로 표시 머리로 모든 업무 화면을 맞추고, 랜딩에 녹화 영상과 흐르는 줄 둘(솔리데오 수행 서비스, 데이터 출처 로고)을 넣는다.

**구조:** 색은 `design/tokens.json` 에서만 바꾼다. 앱 틀·공통 부품(W1)이 먼저 들어가고, 화면 본문(W2·W3)은 그 부품을 따른다. 랜딩(W4)은 앱 틀과 독립이라 바로 시작한다. 작업자마다 자기 worktree·branch 에서 커밋하고, 45 가 통합 branch `feat/ui-refresh` 로 합친다.

**기술:** Next.js 16 · Tailwind v4 · shadcn(Base UI) · lucide-react · Vitest 브라우저 시험 · Playwright E2E. 새 패키지 없음.

**스펙:** `polaris/specs/done/2026-10-28-ui-refresh.md`(사용자 승인 2026-10-28). 계획과 스펙이 다르면 스펙을 따르고 45 에 알린다.

## 전역 제약

- 색·글꼴·글자 눈금은 `design/tokens.json` 에만 적고 `pnpm tokens` 로 `web/app/globals.css` 를 만든다. 화면 코드에 색 값(#·rgb·oklch)이나 Tailwind 기본 팔레트 클래스를 쓰지 않는다(`pnpm check:colors`).
- 서버·DB·API·계산·문구의 뜻을 바꾸지 않는다. 고지 문구("수주 확률이 아닙니다" 등)·데이터 출처 표시·DEMO 표시·앵커·경로·권한은 그대로다.
- 새 문구에 금지어를 쓰지 않는다: 승률·확률·가능성·수주 금액·점유율·경쟁사·%.
- 화면 확인은 1440·1280 두 폭만. 1280 미만 배치는 만들지 않는다. 결제 화면 없음.
- 새 차트·애니메이션 패키지를 설치하지 않는다. 흐르는 줄은 CSS 만으로 만든다.
- 래스터 이미지는 `next/image` 최적화 경로가 Vercel 운영에서 404 다(`679dc3c8`). `<img>` 또는 `unoptimized` 를 쓴다.
- 랜딩 첫 화면의 보이는 글자는 모두 13px 이상이다(기존 E2E "1440 첫 화면의 보이는 글자는 모두 13px 이상이다"). 랜딩에 `type-caption`(12px)을 쓰지 않는다.
- 단언을 약하게 바꾸지 않는다. `eslint-disable`·`any`·`@ts-ignore`·`.skip`·`.only`·`--no-verify` 금지. 훅·가드·권한에 막히면 돌아가지 말고 45 에 알린다.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 비밀번호를 스크립트·파일에 넣지 않는다.
- Supabase 54321 과 다른 세션의 스택(live78·rh1025·photo81·dashboard-43f8 등)을 건드리지 않는다. 프로세스는 자기 PID 만 끈다(`pkill`·`killall` 금지). 백그라운드 실행은 `run_in_background`.
- 무거운 명령(`pnpm verify*`·`test:browser`·`test:e2e*`·`next build`·`git commit`)은 슬롯으로 감싼다: `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh <명령>`.
- 개발 중 검증은 `pnpm verify:changed`, 전체 `pnpm verify` 는 45 가 통합 때 돌린다.
- 커밋은 자기 branch 에만, 파일을 지정해 스테이징한다. 메시지 `feat(web): 한국어 설명`(첫 줄 50자 이내). push·main 병합은 하지 않는다.

## 작업 폴더

| 작업자 | worktree | branch | 시작 |
|---|---|---|---|
| 45(통합) | `sol-radar-worktrees/ui-refresh` | `feat/ui-refresh` | — |
| W1 0f | `sol-radar-worktrees/ui-refresh-shell` | `feat/ui-refresh-shell` | 지금 |
| W2 ac | `sol-radar-worktrees/ui-refresh-work` | `feat/ui-refresh-work` | 지금은 Task 0(읽기만). Task 1 부터는 45 가 "W1 통합" 알림 뒤 `feat/ui-refresh` 를 자기 branch 에 합치고 시작 |
| W3 09 | `sol-radar-worktrees/ui-refresh-analysis` | `feat/ui-refresh-analysis` | W2 와 같음 |
| W4 df | `sol-radar-worktrees/ui-refresh-landing` | `feat/ui-refresh-landing` | 지금 |

- 각 worktree 에서 루트·`web` 두 곳에 `pnpm install`. `prepare` 의 exit 1 은 무시해도 된다(의존성은 설치됨). `HUSKY=0` 은 쓰지 않는다.
- 로그인 화면 확인: 격리 로컬 Supabase(예: 입찰 일정 작업의 `sol-radar-df-qa` 방식, `docs/evidence/calendar/20261028/README.md`)와 자기 포트의 `next dev`. 포트는 W1 3101 · W2 3102 · W3 3103 · W4 3104. 이미 띄운 자기 격리 스택이 있으면 다시 쓴다. 다 쓰면 자기 스택을 끈다.
- 증거 스크린샷은 `docs/evidence/ui-refresh/<작업자>-<화면>-<폭>.png`(예: `w2-bids-1440.png`). 증거 README 는 45 가 쓴다.

## 파일 소유

| 작업자 | 소유 |
|---|---|
| W1 | `design/tokens.json`, `web/app/globals.css`(생성물), `web/components/{app-shell.tsx,app-nav.ts,app-page.tsx,app-breadcrumb.tsx,logo.tsx,stat-card.tsx,bar-chart.tsx,pagination.tsx,provider-mark.tsx,topbar-status.tsx,topbar-demo-indicator.tsx}`, `web/components/ui/**`, `web/app/(app)/(work)/layout.tsx`, 이 파일들의 시험, 위 막대 화면 이름을 단언하는 `web/e2e-auth/**` 줄 |
| W2 | `web/app/(app)/(work)/{dashboard,bids,watchlist,projects,calendar,notifications}/**`, `web/app/(app)/(work)/*.tsx·*.ts`(묶음 공용: `empty-state`·`load-more`·`work-error`·`watch-toggle` 등, `layout.tsx` 제외), `web/components/{bids,projects,work}/**` |
| W3 | `web/app/(app)/(work)/{gaps,market,analysis,workforce,company,settings,admin}/**`, `web/app/(app)/{people,org-chart,memos,settings}/**`, `web/app/(app)/[slug]/{settings,tasks}/**`, `web/app/_lib/people-*`, `web/components/{company,people,photo}/**` |
| W4 | `web/app/page.tsx`, `web/components/landing/**`, `web/components/{site-header,site-footer}.tsx`, `web/public/landing/**`, `web/e2e/{landing,landing-sections,landing-showcase}.spec.ts` |

로그인·가입(`/auth/*`, `web/components/auth-frame.tsx`)은 아무도 고치지 않는다. 색 토큰 변화만 따라간다.

## 검토 초점

시험이 직접 다루지 않지만 사람이 먼저 부딪힐 것. 각 줄의 시험은 맡은 Task 에 넣었다.

1. 1280 폭에서 긴 공고명·조직 이름이 경로·제목·위 막대를 밀어 가로로 넘친다 → W2 Task 3, 45 Task 9 의 두 폭 스크린샷.
2. 역할별 메뉴: VIEWER 는 회사 묶음 일부가 없고 ADMIN 만 데이터 수집 관리가 있다. 메뉴가 다 빠진 묶음은 머리(아이콘 포함)까지 사라져야 한다 → W1 Task 2 시험.
3. 접은 64px 줄: 묶음 머리는 숨고 메뉴별 아이콘·툴팁이 보이며, 파스텔 바탕 위 키보드 초점 고리가 보인다 → W1 Task 2 시험.
4. 움직임 줄이기: 흐르는 줄이 멈추고 둘째 사본이 사라지며(화면 읽기 프로그램이 두 번 읽지 않음), 영상은 자동 재생하지 않는다 → W4 Task 2·5 시험.
5. 이미 테두리가 있는 상자 안의 표가 테두리 두 겹이 된다 → W1 Task 3 의 `containerClassName`, W2·W3 각 Task 체크리스트 c.

---

## W1 0f — 토큰·앱 틀·공통 부품

### Task 1: 선택색 토큰

**Files:**
- Modify: `design/tokens.json`(`colors`)
- 생성: `web/app/globals.css`(`pnpm tokens`)

**Interfaces:**
- Produces: 토큰 `selected` = `#EAF2FE`, `selected-foreground` = `#1B64DA` → 클래스 `bg-selected`·`text-selected-foreground`. `sidebar-accent` = `#EAF2FE`, `sidebar-accent-foreground` = `#1B64DA`. 대비 4.8:1(4.5:1 이상, 45 계산).
- `accent`(드롭다운·고스트 버튼 hover)·`brand`·`primary`·상태색·`source-*`·`demo` 는 바꾸지 않는다.

- [ ] **Step 1:** `tokens.json` 에 네 값을 넣고 `pnpm tokens` 실행.
- [ ] **Step 2:** `pnpm tokens --check`(또는 `pnpm verify:changed` 의 토큰 검사)와 `pnpm check:colors` 통과 확인.
- [ ] **Step 3:** 커밋 `feat(design): 선택 상태 파스텔 토큰 추가`.

### Task 2: 묶음 사이드바와 위 막대

**Files:**
- Modify: `web/components/app-nav.ts`, `web/components/app-shell.tsx`
- Create: `web/components/app-shell-nav.browser.test.tsx`
- Modify(필요하면): 위 막대 화면 이름을 단언하는 `web/e2e-auth/**` 줄(`grep -rn "위 막대\|banner" web/e2e-auth` 로 찾는다)

**Interfaces:**
- Produces: `NavGroup` 에 `icon: LucideIcon` 추가. 업무 `BriefcaseIcon`, 분석 `ChartNoAxesColumnIcon`, 회사 `Building2Icon`(설치된 lucide-react 에 있음을 45 가 확인).
- Produces: `breadcrumbOf(pathname: string): { group: string; screen: string } | null` — `NAV_GROUPS` 의 출시 메뉴 중 `pathname` 이 그 `href` 이거나 그 아래(`/bids/123`)면 묶음 이름·메뉴 이름, 아니면 `null`(아래 고정 칸·템플릿 화면은 `null`).
- Removes: `screenLabelOf`·`TEMPLATE_SCREENS`(다른 사용처가 없으면).

- [ ] **Step 1: 실패하는 시험 쓰기** — `app-nav.test.ts` 에 `breadcrumbOf` 경우:
  - `"/bids"` → `{ group: "업무", screen: "입찰 공고" }`
  - `"/bids/abc/revisions"` → `{ group: "업무", screen: "입찰 공고" }`
  - `"/gaps"` → `{ group: "분석", screen: "자격 갭 레이더" }`
  - `"/company"` → `{ group: "회사", screen: "회사 역량" }`
  - `"/settings"`·`"/acme/tasks"`·`"/"` → `null`
- [ ] **Step 2:** `pnpm -C web exec vitest run components/app-nav.test.ts` → `breadcrumbOf` 없음으로 실패.
- [ ] **Step 3:** `app-nav.ts` 에 `icon` 과 `breadcrumbOf` 구현 → Step 2 명령 통과.
- [ ] **Step 4: 실패하는 브라우저 시험 쓰기** — `app-shell-nav.browser.test.tsx`(`app-shell-origin.browser.test.tsx` 의 `next/navigation`·`next/link` 흉내를 따른다), 1440 폭, pathname `/bids`:
  - 펼친 사이드바: 묶음 버튼 3개 각각 안에 `svg` 1개와 묶음 이름, `aria-expanded="true"`.
  - "주요 메뉴" 안 메뉴 링크의 `svg` 는 보이지 않는다(`getComputedStyle(svg).display === "none"`).
  - "입찰 공고" 링크에 `aria-current="page"`, 바탕색 `rgb(234, 242, 254)`, 글자색 `rgb(27, 100, 218)`, 굵기 `600`.
  - 위 막대(`banner`)에 "입찰 공고" 글자가 없다.
  - `solRole: "VIEWER"` 로 그리면 "회사 역량"·"데이터 수집 관리" 링크가 없고, "회사" 묶음 버튼(아이콘 포함)과 "조직·인력" 링크는 있다.
  - `defaultSidebarOpen: false`(64px): 묶음 버튼이 없고, 메뉴 링크 `svg` 가 보이며, Tab 으로 링크에 초점을 옮기면 `outline`·`box-shadow` 중 하나가 생긴다.
  - 조직 이름: 접었을 때 위 막대에 조직 이름이 있다.
- [ ] **Step 5:** `bash <슬롯> pnpm -C web exec vitest run --config vitest.browser.config.ts components/app-shell-nav` → 실패 확인.
- [ ] **Step 6:** `app-shell.tsx` 구현.
  - 묶음 줄: 아이콘 + 묶음 이름(굵기 600, 본문 색) + 접기 화살표(펼침 ⌄·접힘 ›, 늘 보임). 접기 동작·`aria-controls`·`localStorage` 저장·지금 화면 묶음 펼침은 그대로.
  - 메뉴: 펼친 상태에서는 아이콘을 숨기고(`group-data-[collapsible=icon]` 일 때만 보임) 묶음 아이콘 폭만큼 들여 쓴다. 활성 `data-active:font-semibold`.
  - 아래 고정 칸(설정·데이터 수집 관리)·사용자 칸·받은 초대·로고·알림 배지·글자 +3px(`data-type-scale="sidebar"`)는 그대로.
  - `AppTopBar`: 화면 이름을 뺀다. 사이드바를 접었을 때(그리고 서랍 폭일 때) 조직 이름은 남기고, 그 앞 구분선은 조직 이름이 있을 때만. 상태 묶음·알림 종 그대로.
- [ ] **Step 7:** Step 5 명령 통과, `components/app-shell-origin.browser.test.tsx` 도 통과.
- [ ] **Step 8:** 1440·1280 스크린샷(펼침·접힘, 격리 스택 + `next dev --port 3101` 의 `/bids`) → `docs/evidence/ui-refresh/w1-sidebar-{1440,1280,collapsed}.png`. **45 에 먼저 보낸다.** 45 가 사용자 확인을 받기 전에는 Task 3 을 커밋하지 않는다(Task 3 작업은 계속해도 된다).
- [ ] **Step 9:** `pnpm verify:changed` 통과 → 커밋 `feat(web): 묶음 사이드바와 파스텔 선택색`.

### Task 3: 화면 머리·표·칩

**Files:**
- Create: `web/components/app-breadcrumb.tsx`("use client"), `web/components/ui/chip.tsx`
- Modify: `web/components/app-page.tsx`, `web/components/ui/table.tsx`
- Test: `web/components/app-shell-nav.browser.test.tsx`(같은 파일에 `describe("AppPage 머리")` 추가)

**Interfaces:**
- Consumes: Task 2 의 `breadcrumbOf`.
- Produces: `AppBreadcrumb()` — `usePathname()` 으로 `breadcrumbOf` 를 불러 `<nav aria-label="경로">` 안에 `묶음 / 화면`(회색 `type-label`)을 그린다. 결과가 `null` 이면 아무것도 그리지 않는다. 화면 이름은 링크가 아니다.
- Produces: `AppPage` 의 props 는 그대로. 머리 순서: `AppBreadcrumb` → `eyebrow` → 제목(`type-title`) → 설명 → 머리 아래 1px 구분선(`border-b border-border` + 아래 여백). `actions` 자리 그대로.
- Produces: `Table` 에 `containerClassName?: string`. 기본 바깥 상자 `rounded-lg border border-border overflow-x-auto`. 이미 테두리 상자 안에 있는 표는 `containerClassName="rounded-none border-0"` 으로 끈다. `TableHeader` 바탕 `bg-muted/50`.
- Produces: `Chip({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: "neutral" | "brand" })` — neutral: `rounded-md bg-secondary px-2 py-0.5 type-label text-secondary-foreground`, brand: `rounded-md border border-brand px-1.5 py-0.5 type-label font-semibold text-brand`. 상태색 배지(충족·확인 필요·미충족, BID·WATCH·NO-BID)는 이 부품으로 바꾸지 않는다.

- [ ] **Step 1: 실패하는 시험 쓰기** — pathname `/gaps` 로 `AppPage title="자격 갭 레이더"` 를 그리면 `nav[aria-label="경로"]` 글자가 "분석" 과 "자격 갭 레이더" 를 차례로 담고, 제목 `h1` 이 그 뒤에 있다. pathname `/settings` 면 경로 `nav` 가 없다. 머리 상자 `border-bottom-width` 가 `1px`.
- [ ] **Step 2:** 브라우저 시험 실행 → 실패 확인.
- [ ] **Step 3:** `app-breadcrumb.tsx`·`app-page.tsx`·`table.tsx`·`chip.tsx` 구현.
- [ ] **Step 4:** 브라우저 시험 통과. `pnpm -C web exec vitest run --config vitest.browser.config.ts` 중 `AppPage`·`Table` 을 그리는 기존 시험(`grep -rl "AppPage\|ui/table" web --include='*.browser.test.tsx'`)도 통과.
- [ ] **Step 5:** `/bids`·`/gaps`·`/settings` 1440·1280 스크린샷 → `docs/evidence/ui-refresh/w1-page-head-*.png`. 45 의 사이드바 확인 회신 뒤 `pnpm verify:changed` → 커밋 `feat(web): 화면 머리 경로와 표 테두리`. 45 에 "W1 끝, 해시" 보고.

### Task 4: 공용 부품 다듬기

**Files:** `web/components/{stat-card,bar-chart,pagination,provider-mark,topbar-status,topbar-demo-indicator,logo}.tsx`

- [ ] **Step 1:** 선택·켜짐 상태가 있으면 `bg-selected text-selected-foreground`, 회색 칩은 `Chip`. 뜻·문구·크기는 그대로. 바꿀 것이 없으면 건너뛰고 그렇게 보고.
- [ ] **Step 2:** 관련 시험 + `pnpm verify:changed` → 커밋 `style(web): 공용 부품 선택색 맞춤`.

---

## W2 ac · W3 09 — 화면 본문 공통 절차

**Task 0(지금, 읽기만):** 자기 화면을 모두 열어 아래 체크리스트 a~f 에 걸리는 곳을 화면별로 적는다(저장소 밖 메모). 코드는 아직 고치지 않는다.

**Task 1 시작 조건:** 45 가 "W1 통합(해시)" 을 알리면 자기 branch 에 `feat/ui-refresh` 를 합친다(`git -C <자기 worktree 절대경로> merge feat/ui-refresh`, 파이프 없이).

**화면마다 체크리스트(4.3 적용):**
- a. 머리는 `AppPage` 가 그린다. 경로(묶음 / 화면)와 같은 내용만 담은 `eyebrow` 는 뺀다. 뒤로 링크 같은 기능이 있는 `eyebrow` 는 둔다.
- b. 표는 `ui/table`. 손으로 만든 `<table>` 은 바꾸기 쉬우면 바꾸고, 어려우면 머리 줄 `bg-muted/50`·바깥 `rounded-lg border` 만 맞춘다.
- c. 표를 감싼 `Card`·테두리 상자는 걷어 낸다. 걷을 수 없으면 `Table containerClassName="rounded-none border-0"`.
- d. 선택·켜짐(탭·보기 전환·거르기 칩·분할 버튼)은 `bg-selected text-selected-foreground font-semibold`. 상태색(충족·미충족·BID 등)·DEMO·출처 배지는 그대로.
- e. 회색 칩은 `Chip`, 강조 배지는 `Chip tone="brand"`.
- f. 보이는 값·문구·링크·`aria-*`·`data-*` 는 바꾸지 않는다. 시험의 단언을 바꿔야 하면 바꾸기 전에 45 에 이유와 함께 묻는다.

**Task 마다 단계:**
- [ ] **Step 1:** 체크리스트 a~f 적용.
- [ ] **Step 2:** 그 화면의 기존 시험 실행(아래 표의 명령) → 통과.
- [ ] **Step 3:** 격리 스택 + 자기 포트 `next dev` 로 로그인 화면을 1440·1280 에서 열어 넘침·잘림·겹침 없음 확인, 스크린샷 `docs/evidence/ui-refresh/<w>-<화면>-<폭>.png`.
- [ ] **Step 4:** `pnpm verify:changed` 통과 → 커밋 `style(web): <화면> 새 화면 규칙 적용`. 45 에 해시 보고.

## W2 ac — 업무 묶음

| Task | 화면·파일 | 기존 시험 |
|---|---|---|
| 1 | `/dashboard` | `vitest run app/(app)/(work)/dashboard` |
| 2 | `/bids`·`/bids/programs`, `components/work/**`, `components/bids/bid-table.tsx`·`bid-filters.tsx` | `vitest run components/work components/bids app/(app)/(work)/bids` |
| 3 | `/bids/[id]`·`/bids/[id]/revisions`, 나머지 `components/bids/**`. **1280 에서 띄어쓰기 없는 긴 공고명이 경로·제목·버튼을 밀지 않는지** 스크린샷으로 확인(검토 초점 1) | `decision.browser.test.tsx` 외 `components/bids` 브라우저 시험 |
| 4 | `/watchlist`·`/projects`·`/projects/[id]`, `components/projects/**` | `watch-toggle.browser.test.tsx`, `vitest run components/projects app/(app)/(work)/projects` |
| 5 | `/calendar`·`/notifications`, `(work)` 묶음 공용 파일 | `calendar-view.browser.test.tsx`, `vitest run server/calendar app/(app)/(work)/notifications` |

## W3 09 — 분석·회사·기타

| Task | 화면·파일 | 기존 시험 |
|---|---|---|
| 1 | `/gaps`·`/market` | `vitest run app/(app)/(work)/gaps app/(app)/(work)/market` |
| 2 | `/analysis`·`/workforce` | `vitest run app/(app)/(work)/analysis app/(app)/(work)/workforce` |
| 3 | `/company`, `components/company/**` | `vitest run components/company app/(app)/(work)/company` |
| 4 | `/people`·`/org-chart`, `components/{people,photo}/**`, `app/_lib/people-*` | `vitest run components/people components/photo app/(app)/people app/(app)/org-chart` |
| 5 | `(work)/settings`·`/settings/organization`·`/admin/ingestion`·`/memos`·`/settings`, `[slug]/settings`·`[slug]/tasks` | `vitest run app/(app)/(work)/settings app/(app)/(work)/admin app/(app)/settings` |

`vitest run …` 은 `pnpm -C web exec vitest run …`, 브라우저 시험은 `--config vitest.browser.config.ts` 를 붙이고 슬롯으로 감싼다. 괄호가 든 경로는 따옴표로 감싼다(`"app/(app)/(work)/gaps"`). 경로에 시험이 없으면 "없음" 으로 보고한다.

---

## W4 df — 랜딩

### Task 1: 자료 받기와 목록 상수

**Files:**
- Create: `web/components/landing/showcase-data.ts`, `web/public/landing/services/*.webp`, `web/public/landing/sources/*.{svg,png}`

**Interfaces:**
- Produces:
  ```ts
  export type SolideoService = { name: string; image: string };
  export type DataSource = { name: string; logo: string | null; status: "collecting" | "planned" };
  export const SOLIDEO_SERVICES: readonly SolideoService[]; // 스펙 4.5 의 17개, 그 순서
  export const DATA_SOURCES: readonly DataSource[]; // 스펙 4.5 후보 9곳, 나라장터만 "collecting"
  export const LANDING_VIDEO: { webm: string; mp4: string; poster: string } | null; // 지금은 null
  ```
- 서비스 이미지: `https://www.solideos.com/portal/govSM.do` 의 서비스 이미지를 받아 webp(가로 480px 이하)로 줄인다. 받은 파일은 새 빈 폴더에 두고 열어서 내용을 확인한 뒤 옮긴다.
- 로고: 각 기관 공식 CI 안내 페이지의 파일(svg 우선). 공식 파일을 못 구하면 `logo: null` 로 두고 화면은 기관 이름 글자만 그린다. 비슷한 로고를 그리거나 만들지 않는다.
- 공공데이터포털은 넣지 않는다. 받은 출처 URL 은 45 에 보고(증거 README 용).

- [ ] **Step 1:** 자료 받기·확인·줄이기, `showcase-data.ts` 작성.
- [ ] **Step 2:** `pnpm verify:changed` → 커밋 `feat(web): 랜딩 수행 서비스·데이터 출처 자료`.

### Task 2: 흐르는 줄

**Files:**
- Create: `web/components/landing/marquee.tsx`, `web/components/landing/marquee.module.css`(keyframes 만, 색 없음), `web/components/landing/showcase-marquees.tsx`, `web/e2e/landing-showcase.spec.ts`
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: Task 1 상수.
- Produces: `Marquee({ label, reverse, children }: { label: string; reverse?: boolean; children: React.ReactNode })` — `<section aria-label={label}>` 안에 회색 제목 한 줄(`type-label` 이상) + 목록을 두 번 이어 붙여 `translateX(-50%)` 반복. 둘째 사본 `aria-hidden`. 마우스 hover·`focus-within` 에서 `animation-play-state: paused`. `prefers-reduced-motion: reduce` 에서 애니메이션 없음·둘째 사본 `display: none`·줄바꿈. 양 끝 흐림 마스크. 바깥 상자 `overflow: hidden` 으로 페이지 가로 넘침 0.
- Produces: `ServicesMarquee()`(제목 "솔리데오가 수행한 공공 서비스", 카드 = 이미지 + 이름), `SourcesMarquee()`(제목 "SOL RADAR 가 공고를 가져오는 곳", 칩 = 로고(회색조, hover 원색) + 기관 이름, `planned` 는 점선 테두리·흐린 글자·"연결 예정" 꼬리표, 줄 아래 "기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다.").
- `page.tsx` 순서: `Hero` → (영상, Task 5) → `ServicesMarquee` → `SourcesMarquee` → `ProductPreviewSection` → 나머지 그대로.

- [ ] **Step 1: 실패하는 E2E 쓰기** — `landing-showcase.spec.ts`(1440×900):
  - "솔리데오가 수행한 공공 서비스" 구역에서 `aria-hidden` 이 아닌 목록 항목이 17개이고 첫 항목 글자가 "정부24".
  - "SOL RADAR 가 공고를 가져오는 곳" 구역의 보이는 목록 항목이 `DATA_SOURCES.length`, "연결 예정" 글자 수가 `DATA_SOURCES.filter(s => s.status === "planned").length`(상수는 상대 경로로 가져온다), "공공데이터포털" 글자 없음.
  - 줄 위에 마우스를 올리면 트랙의 `animationPlayState` 가 `"paused"`.
  - `reducedMotion: "reduce"` 에서 둘째 사본이 보이지 않는다(`toBeHidden`).
  - 면책 문구가 보인다.
- [ ] **Step 2:** `bash <슬롯> pnpm -C web exec playwright test e2e/landing-showcase.spec.ts` → 실패 확인.
- [ ] **Step 3:** `marquee.tsx`·`marquee.module.css`·`showcase-marquees.tsx`·`page.tsx` 구현.
- [ ] **Step 4:** Step 2 통과. 기존 `e2e/landing.spec.ts`·`landing-sections.spec.ts`·`home.spec.ts` 도 통과(특히 13px 이상·가로 넘침·움직임 줄이기·빈 링크 시험). 아래 Task 3 의 시험 변경 전에는 "스크롤 없이 점수와 고지" 시험이 실패할 수 있다 — Task 3 에서 고친다.
- [ ] **Step 5:** 1440·1280 스크린샷 `docs/evidence/ui-refresh/w4-landing-{1440,1280}.png` → `pnpm verify:changed` → 커밋 `feat(web): 랜딩 수행 서비스·데이터 출처 흐르는 줄`.

### Task 3: 첫 화면 시험 바꾸기와 기존 구역 다듬기

**Files:** `web/e2e/landing.spec.ts`, `web/components/landing/*`(기존 구역), `site-header.tsx`·`site-footer.tsx`(필요할 때만)

- [ ] **Step 1:** `landing.spec.ts` 의 "`${w}×${h}` 첫 화면에서 스크롤 없이 점수와 수주 확률 고지가 보인다" 를 "`${w}×${h}` 분석 예시 보기를 누르면 점수와 수주 확률 고지가 함께 화면 안에 보인다" 로 바꾼다: 두 폭에서 `/` → "분석 예시 보기" 클릭 → `meter "SOL Score"` 와 고지 글자 모두 `toBeInViewport({ ratio: 1 })`. 다른 단언은 그대로(스펙 4.5, 45 판단).
- [ ] **Step 2:** 기존 구역의 선택 상태(분석 예시 탭 등)를 `bg-selected text-selected-foreground`, 회색 칩을 `Chip` 으로. 문구·앵커(`#features`·`#analysis`·`#about`·`#faq`)·머리말 메뉴 그대로.
- [ ] **Step 3:** 랜딩 E2E 전부(`e2e/landing*.spec.ts`·`home.spec.ts`)와 `product-preview.browser.test.tsx` 통과 → 커밋 `style(web): 랜딩 기존 구역 새 색 규칙`.

### Task 4: (45 의 1차 운영 배포 뒤) 영상 녹화

- [ ] **Step 1:** 녹화 스크립트는 저장소 밖(자기 scratchpad)에 둔다. Playwright headed + `recordVideo`(1440×900), 사용자가 그 브라우저에서 직접 로그인한 뒤 스크립트가 `/bids` → `/gaps` → `/calendar` 를 천천히 이동. 비밀번호를 코드·파일·명령에 넣지 않는다. 회사 역량·조직·인력 화면은 찍지 않는다.
- [ ] **Step 2:** `ffmpeg` 로 15~30초 자르기 → `web/public/landing/demo.webm`(VP9)·`demo.mp4`(H.264)·`demo-poster.webp`, 합계 4MB 이하. 결과 파일을 직접 재생·열어 확인.
- [ ] **Step 3:** 45 에 영상 경로·길이·크기 보고. 45 가 사용자 확인을 받는다.

### Task 5: 영상 구역

**Files:** Create `web/components/landing/landing-video.tsx`("use client"); Modify `showcase-data.ts`(`LANDING_VIDEO` 채움), `page.tsx`, `e2e/landing-showcase.spec.ts`

**Interfaces:**
- Produces: `LandingVideo({ video }: { video: NonNullable<typeof LANDING_VIDEO> })` — `<video muted loop playsInline preload="metadata" poster>` + `<source>` webm·mp4. 자동 재생 속성은 두지 않고 마운트 때 `matchMedia("(prefers-reduced-motion: reduce)")` 가 아니면 `play()`. 움직임 줄이기면 `controls` 를 보이고 멈춘 채 둔다. `page.tsx` 는 `LANDING_VIDEO` 가 `null` 이 아닐 때만 그린다.

- [ ] **Step 1: 실패하는 E2E 쓰기** — `video` 가 `muted`·`loop`·`playsInline` 이고 1초 뒤 `paused === false`. `reducedMotion: "reduce"` 로 새로 열면 `paused === true`, `controls === true`.
- [ ] **Step 2:** 실패 확인 → 구현 → 통과. 랜딩 E2E 전부 통과.
- [ ] **Step 3:** `pnpm verify:changed` → 커밋 `feat(web): 랜딩 녹화 영상`.

---

## 45 — 통합

### Task 6: W1 통합과 사용자 확인
- [ ] W1 Task 2 스크린샷을 사용자에게 보여 확인. 승인되면 W1 branch 를 `feat/ui-refresh` 로 합치고 `pnpm verify:changed` → W2·W3 에 "W1 통합(해시)" 알림.

### Task 7: 본문·랜딩 통합
- [ ] W2·W3·W4 의 Task 해시를 받을 때마다 diff 를 직접 읽고 소유 파일 밖 변경이 없는지 확인한 뒤 합친다.

### Task 8: U6 운영 수집 상태
- [ ] 사용자 승인 뒤 운영 DB 읽기 SELECT(출처별 최근 7일 새 공고 수) → `DATA_SOURCES` 의 `status` 를 W4 에 알려 고치게 한다.

### Task 9: 통합 검증과 1차 배포
- [ ] 전체 `pnpm verify`, 랜딩 E2E, 격리 스택의 `test:e2e:work`(읽기 프로젝트, 두 폭 스크린샷), 4.4 전 화면 1440·1280 스크린샷 확인(검토 초점 1·5), 독립 리뷰 1회.
- [ ] 정본: `docs/06-UI-UX.md` §3·§4.1·랜딩 절, `docs/16-DECISIONS.md` 새 ADR(다음 번호), `docs/PROGRESS.md`, `docs/evidence/ui-refresh/README.md`.
- [ ] 사용자 승인 뒤 main 병합·push, Vercel 배포 확인, 비로그인 랜딩 자원 200 확인(수용 기준 6).

### Task 10: 2차 배포
- [ ] W4 Task 4·5 뒤 같은 절차로 영상 넣어 배포(사용자 승인 뒤). 11-01 부터 화면 동결, 덱 클립 촬영.

## 통합 때 바뀐 것 (2026-10-28 기록)

계획을 쓴 뒤 진행 중에 바뀐 것이다. 위 본문은 처음 계획 그대로 둔다.

- 소유 이동:
  - W3 Task 5(설정·관리)·W2 Task 5(입찰 일정·알림)·W2 Task 4(관심 공고·입찰 프로젝트)는 0f 가 했다.
  - W3 Task 4(조직·인력·조직도)는 df, W3 Task 3(회사 역량)은 ac 가 했다.
  - 독립 리뷰 후속(`app-shell.tsx`·`app-breadcrumb.tsx`·`app-nav.ts`·`market-view.tsx`·`[slug]/dashboard`·`admin/user-list`)은 df 가 한 번 맡았다.
- 인터페이스:
  - `Chip` 에 `size="md"|"sm"` 가 있다.
  - `DataSource` 는 `{name, logo:{src,width,height}}` 이고 `status` 가 없다(U8).
  - `AppBreadcrumb` 는 앱 틀이 넣는 `AppPathnameProvider` 문맥에서 주소를 읽는다. `aria-current` 는 메뉴 주소와 정확히 같을 때만 단다(`isMenuPage`). 경로 줄은 머리 flex 줄 위에 있어, `actions` 가 제목 줄 높이에서 시작한다.
  - `AppPage` 본문 위 여백은 `pt-4` 다.
- 선택 표시 3종 규칙(화면 이동 탭·하나 고르기 전환·여러 개 켜는 거르기 칩)을 정해 모든 작업자에게 같게 적용했다([[06-UI-UX|06]] §3.5).
- Task 8(U6 운영 수집 상태 SELECT)은 U8 로 없어졌다. 대신 2026-11-02 에 9곳 수집을 확인한다([출처 연결 목록](2026-10-28-landing-sources-to-connect.md)).
- 출처 로고: 나라장터·LH·한국전력공사는 사용자 선택으로 마크 + 국문 이름 시그니처를 쓴다. 9곳은 넓이가 같아지는 높이로 맞췄다.

### 1차 배포 뒤 (2026-10-28)

- Task 9 1차 배포 완료: main `14bfc514`, Vercel success, 운영 랜딩 자원 200.
- W4 Task 4·5(녹화 영상) 대체: 운영 녹화 21초는 실공고 점수 칸이 비어 쓰지 않았다. 사용자 지시로 granter.biz 히어로처럼 HTML 로 그린 업무 데모(`work-demo.tsx`, `721afe8f`)를 영상 자리에 둔다. 영상 구역 커밋(`cc26fcd1`·`5143d5e6`)은 `6fc5a414` 로 되돌렸고 영상 파일은 저장소에 넣지 않았다.
- Task 10 은 "업무 데모를 넣어 2차 배포"로 바뀐다.
