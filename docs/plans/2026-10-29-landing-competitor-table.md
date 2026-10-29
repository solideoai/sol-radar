# 랜딩 비교 표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 랜딩 서비스 소개 구역(`#about`)의 "지금은 / SOL RADAR에서는" 표를, 공고 수집 서비스 4곳(가림 이름)과 SOL RADAR의 8행 기능 비교 표로 바꾸고 근거 증거 파일을 남긴다.

**Architecture:** 정적 구역 컴포넌트 하나(`ComparisonSection`)가 상수 배열로 표를 그린다. 데이터·API·DB 변경은 없다. 칸 값의 근거는 `docs/evidence/competitors/2026-10-29-competitors.md`이고, 기존 랜딩 E2E가 구역 제목·열·행·화면 낭독기 글자·1280 넘침·금지 문구를 단언한다.

**Tech Stack:** Next.js 16(App Router, 서버 컴포넌트) · React 19 · Tailwind v4(토큰 유틸리티) · Playwright E2E

**Spec:** `polaris/specs/done/2026-10-29-landing-competitor-table.md` (D1~D9, §4 확정 내용, §7 화면 규칙)

## Global Constraints

- 작업 위치: worktree `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/landing-compare`, 브랜치 `feat/landing-compare`(main HEAD에서). 쓰기 git 은 `git -C <절대경로> … && …`로만, 파이프 없이.
- worktree `pnpm install`의 prepare 훅 exit 1 은 무시한다(의존성은 설치됨). `HUSKY=0`·`--no-verify` 금지.
- 무거운 명령(`pnpm -C web build`, Playwright, `pnpm verify*`, `git commit`)은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh <명령>`으로 감싼다. 아래 단계의 `<verify-slot.sh>`는 이 경로, `<worktree>`는 위 worktree 절대경로다.
- 스펙·이 계획·`docs/07-DATA-PIPELINE.md` D9 메모는 메인 폴더에 미커밋으로 있다. Task 1 Step 0에서 worktree로 옮긴다. 메인 폴더의 `docs/12-ROADMAP.md`·`docs/PROGRESS.md` 알림 Worker 일정 수정은 다른 주제라 옮기지 않는다.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 막히면 멈추고 보고한다.
- 타사 이름은 화면에 `인XX`·`비XX`·`모XX`·`클XX`만. 실명(인포21C·비드폼·모두입찰·클라이원트)·로고·링크·`title` 툴팁 금지.
- 표 기호: 타사 ✓ "공개 페이지에서 확인" · △ "일부만 확인" · — "공개 페이지에서 확인되지 않음". SOL RADAR ✓ "제공" · — "제공하지 않음". ✕·"안 됨" 금지.
- 금지 문구: 승률·확률·가능성·수주 금액·점유율·경쟁사·%. "유일"·"최초"·"SOL RADAR만" 금지.
- 색·글꼴·글자 눈금은 토큰 유틸리티만(손 hex 금지). SOL RADAR 열만 `bg-brand/5`·`text-brand`(06 §3.4 brand 규칙의 사용자 결정 예외).
- 화면 확인 폭은 1440·1280 두 개. 모바일 변형을 만들지 않는다.
- 커밋 메시지 `타입: 한국어 설명`, 첫 줄 50자 이내, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 파일을 지정해 스테이징한다. 커밋은 사용자가 요청했을 때만, push·main 병합·Vercel 배포는 사용자 확인 뒤.

## Review Focus

1. 1280 폭에서 6열 표가 단 폭(1200px - 좌우 80px)을 넘쳐 가로 스크롤이 생김 → 표가 부모 폭 안에 들어간다. Task 2 Step 1의 1280 넘침 시험이 잡는다.
2. 화면 낭독기가 기호(✓·△·—)만 읽음 → 칸마다 뜻 글자를 읽는다. Task 2 Step 1의 칸 글자 시험이 잡는다.
3. 타사 실명이 주석·`title`·`alt`로 새어 나감 → 페이지 어디에도 실명이 없다. Task 2 Step 1의 실명 시험이 잡는다.
4. 금지 문구가 행 설명·각주에 섞임 → 구역 글자에 금지 문구가 없다. Task 2 Step 1의 금지 문구 시험이 잡는다.
5. 표 상수 값이 증거 파일 판정과 어긋남 → 자동 시험이 없다. Task 2 Step 5에서 증거 파일 §표와 한 칸씩 대조하고, 어긋나면 멈추고 사용자에게 묻는다(스펙 §5).

---

### Task 1: 2026-10-29 경쟁 서비스 증거 파일

**누가:** 메인 세션. 바탕은 메인 세션 대화에 있는 2026-10-29 조사 보고 전문(서브에이전트에게는 없다).

**Files:**
- Create: `docs/evidence/competitors/2026-10-29-competitors.md`

**Interfaces:**
- Produces: Task 2가 대조할 "랜딩 표 대응" 절(가림 이름 × 8행 판정 표)

- [ ] **Step 0: worktree 준비** — `git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add <worktree> -b feat/landing-compare main` → 루트·`web`에서 `pnpm install`. 메인 폴더의 `polaris/specs/done/2026-10-29-landing-competitor-table.md`·`docs/plans/2026-10-29-landing-competitor-table.md`를 worktree 같은 경로로 복사하고, `docs/07-DATA-PIPELINE.md`는 메인 폴더 `git diff` 한 줄을 worktree에 같은 내용으로 고친다. 메인 폴더 원본은 커밋이 끝난 뒤 사용자 확인을 받고 정리한다.
- [ ] **Step 1: 파일을 쓴다** — frontmatter(`title: "경쟁 서비스 재조사 (2026-10-29)"`, `status: draft`, `tags: [sol-radar, hackathon]`, `updated: 2026-10-29`). 절 순서는 10-19 파일을 따른다: 1 조사 방법·범위(공개 페이지만, 판정 규칙, 항목 ①~⑬ 정의) → 2 서비스별 표(인포21C·비드폼·모두입찰·클라이원트, 대안·보류 후보 산군·디마툴즈·비딩이 요약) → 3 매트릭스 → 4 **랜딩 표 대응**(가림 이름 대응표, 스펙 §4 8행 표와 각 칸의 근거 항목 번호) → 5 10-19 대비 바뀐 점 → 6 열람 못 한 페이지 → 7 출처 URL(접속 2026-10-29). 원문 문장은 따옴표 그대로, 제3자 출처는 표시. 타사 HTML 원본은 넣지 않는다. 끝에 `## 관련 문서`(`[[18-HACKATHON|18 해커톤]]`, 10-19 파일, 스펙 경로).
- [ ] **Step 2: 대조한다** — 4절 표의 32칸(타사 4 × 8행)이 스펙 §4 표와 같은지 한 칸씩 본다. 다르면 멈추고 사용자에게 묻는다.
- [ ] **Step 3: 검증** — Run: `bash <verify-slot.sh> pnpm verify:changed` (worktree 루트) · Expected: exit 0(문서 검사)
- [ ] **Step 4: 커밋** — `git -C <worktree> add docs/evidence/competitors/2026-10-29-competitors.md polaris/specs/done/2026-10-29-landing-competitor-table.md docs/plans/2026-10-29-landing-competitor-table.md docs/07-DATA-PIPELINE.md && bash <verify-slot.sh> git -C <worktree> commit -m "docs: 랜딩 비교 표 스펙·계획·경쟁 재조사 증거"`

### Task 2: 서비스 소개 구역을 비교 표로 교체

**Files:**
- Create: `web/components/landing/comparison-section.tsx`
- Modify: `web/app/page.tsx`(import·`<ProblemSection />` 자리)
- Delete: `web/components/landing/problem-section.tsx`
- Test: `web/e2e/landing-sections.spec.ts`(`SECTIONS[2].title`, "서비스 소개는 지금 방식과…" 시험 교체, 새 시험 2개)

**Interfaces:**
- Consumes: `SectionHeading`(`@/components/landing/section-heading`), `cn`(`"cn"`)
- Produces: `export function ComparisonSection(): JSX.Element` — `section#about`, `aria-labelledby="about-title"`

- [ ] **Step 1: 실패하는 시험을 쓴다** — `landing-sections.spec.ts`:
  - `SECTIONS[2].title` 을 `"찾아 주는 서비스는 많습니다. 판단까지 하는 곳은 드뭅니다."`로 바꾼다(제목의 줄바꿈은 `<br>` 대신 문장 사이 공백, 접근 이름이 이 문자열과 같아야 한다).
  - "서비스 소개는 지금 방식과…" 시험을 아래로 바꾼다.

```ts
const COMPARISON_ROWS = [
  "공고 찾기 · 읽기",
  /^공고 수집 · 조건 검색/,
  /^AI 공고 요약/,
  /^우리 회사 기준 참가자격 판정/,
  /^판단 근거 원문 인용/,
  "참여 판단",
  /^보유 인력 반영/,
  /^추천 · 보류 · 비추천 권고/,
  /^검토 결정 · 사유 기록/,
  "가격",
  /^투찰 가격 분석/,
];

test("서비스 소개는 공고 수집 서비스 네 곳과 SOL RADAR 의 기능 비교 표다", async ({ page }) => {
  await page.goto("/");
  const about = page.getByRole("region", { name: SECTIONS[2].title });
  await expect(about.getByRole("columnheader")).toHaveText(["기능", "인XX", "비XX", "모XX", "클XX", "SOL RADAR"]);
  await expect(about.getByRole("rowheader")).toHaveText(COMPARISON_ROWS);
  // 기호만이 아니라 뜻을 읽는다. 타사 칸과 SOL RADAR 칸의 뜻은 다르다.
  await expect(about.getByRole("row", { name: /^추천 · 보류 · 비추천 권고/ }).getByRole("cell")).toHaveText([
    /공개 페이지에서 확인되지 않음$/, /공개 페이지에서 확인되지 않음$/, /공개 페이지에서 확인되지 않음$/, /공개 페이지에서 확인되지 않음$/, /제공$/,
  ]);
  await expect(about.getByRole("row", { name: /^투찰 가격 분석/ }).getByRole("cell")).toHaveText([
    /공개 페이지에서 확인$/, /공개 페이지에서 확인$/, /공개 페이지에서 확인$/, /일부만 확인$/, /제공하지 않음$/,
  ]);
  await expect(about.getByText(/2026년 10월 29일 각 서비스 공개 웹페이지 기준/)).toBeVisible();
  await expect(about.getByText("서비스 소개", { exact: true })).toHaveCount(0);
});

test("비교 표는 타사 실명과 금지 문구를 쓰지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toContainText(/인포21C|비드폼|모두입찰|클라이원트/);
  const about = page.getByRole("region", { name: SECTIONS[2].title });
  await expect(about).not.toContainText(/승률|확률|가능성|수주 금액|점유율|경쟁사|%|유일|최초/);
});

test.describe("1280 폭", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("비교 표가 단 폭 안에 들어간다", async ({ page }) => {
    await page.goto("/");
    const table = page.getByRole("region", { name: SECTIONS[2].title }).getByRole("table");
    expect(await table.evaluate((element) => element.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다** — Run: `bash <verify-slot.sh> pnpm -C web build && bash <verify-slot.sh> pnpm -C web exec playwright test e2e/landing-sections.spec.ts` · Expected: FAIL(제목 region 없음). 빌드가 env 부족으로 막히면 `.env*`를 읽지 말고 멈추고 보고한다.
- [ ] **Step 3: `ComparisonSection` 을 만든다** — `comparison-section.tsx`. 구역 틀·`SectionHeading`·선 스타일은 `problem-section.tsx` 그대로(`mx-auto w-full max-w-300 scroll-mt-24 px-10 pt-28`, `border-t border-border`, 바닥 `border-b`). 제목·설명·각주 문구는 스펙 §4 그대로. 표 구조:
  - 상수: `SERVICES = ["인XX", "비XX", "모XX", "클XX"] as const`, `type Mark = "yes" | "partial" | "no"`, 묶음 3개(`"공고 찾기 · 읽기"`·`"참여 판단"`·`"가격"`)마다 `{ label: string; hint?: string; others: readonly [Mark, Mark, Mark, Mark]; sol: "yes" | "no" }[]`. 값은 스펙 §4 8행(투찰 가격 분석 행은 hint "사정율 · 낙찰예측가", 공고 수집 행은 hint 없음). 상수 위 주석에 근거 `docs/evidence/competitors/2026-10-29-competitors.md` 와 "칸 값을 바꾸면 증거 파일부터" 한 줄.
  - 묶음마다 `<tbody>`, 첫 줄은 `<th scope="rowgroup" colSpan={6}>` 묶음 이름(`type-label-lg font-semibold text-muted-foreground`). 행 이름은 `<th scope="row">` 안에 label과 `block` hint(`text-muted-foreground`, 작은 본문 눈금).
  - 칸: `<td>` 안에 `<span aria-hidden>`(✓·△·—)과 `<span className="sr-only">`(Global Constraints 뜻 글자). 타사 ✓는 `text-foreground font-semibold`, △는 `text-muted-foreground`, —는 흐린 글자(`text-muted-foreground/50` 정도). SOL RADAR 열 머리·칸은 `bg-brand/5 text-brand font-bold`, SOL RADAR —는 `text-muted-foreground`.
  - 설명 글의 따옴표 구절은 문장 그대로 넣는다(제목 `max-w-200`, 설명 `max-w-190`은 `SectionHeading` 기본).
- [ ] **Step 4: 갈아 끼운다** — `page.tsx` 에서 `ProblemSection` import·사용을 `ComparisonSection` 으로 바꾸고, `git -C <worktree> rm web/components/landing/problem-section.tsx`. `grep -rn "problem-section\|ProblemSection" <worktree>/web --include=*.ts --include=*.tsx --exclude-dir=node_modules` 결과 0건.
- [ ] **Step 5: 증거와 대조한다** — 상수의 32칸(타사 4 × 8행)과 SOL RADAR 8칸을 Task 1 증거 파일 4절 표와 한 칸씩 대조한다. 어긋나면 멈추고 사용자에게 묻는다.
- [ ] **Step 6: 통과를 확인한다** — Run: Step 2와 같은 두 명령 · Expected: `landing-sections.spec.ts` 전부 PASS
- [ ] **Step 7: 변경 범위 검증** — Run: `bash <verify-slot.sh> pnpm verify:changed` · Expected: exit 0(서식은 `pnpm -C web format`으로 맞춘다)
- [ ] **Step 8: 커밋** — `git -C <worktree> add web/components/landing/comparison-section.tsx web/app/page.tsx web/e2e/landing-sections.spec.ts && bash <verify-slot.sh> git -C <worktree> commit -m "feat(web): 랜딩 서비스 소개를 기능 비교 표로 교체"`(삭제는 Step 4의 `git rm`으로 이미 스테이징됨)

### Task 3: 화면 확인과 문서 반영

**Files:**
- Create: `docs/evidence/landing-comparison/20261029-landing-home-comparison-1440.png`, `…-1280.png`, `docs/evidence/landing-comparison/README.md`
- Modify: `docs/06-UI-UX.md` §3.4(기능 4개·원칙 4개 줄 앞에 한 줄), `docs/PROGRESS.md`(최근 작업 로그 맨 위 한 줄, 10줄 유지), 스펙 frontmatter `updated`

**Interfaces:**
- Consumes: Task 2의 `ComparisonSection`

- [ ] **Step 1: 화면을 본다** — Task 2 빌드 그대로 `pnpm -C web start --hostname 127.0.0.1 --port 3100`(`SOL_DEPLOYMENT_ROLE=standalone`)을 백그라운드로 띄우고, playwright MCP로 `/#about`을 1440×900·1280×800에서 연다. 확인: 가로 넘침 없음, 행 설명이 잘리지 않음, SOL RADAR 열만 옅은 파랑, 각주 두 줄, 접근성 트리에 칸 뜻 글자. 구역 스크린샷 두 장을 위 이름으로 저장한다(web/ 밖 저장이 막히면 `web/test-results`에 찍고 복사). 띄운 서버는 자기 PID만 끈다.
- [ ] **Step 2: 증거 README** — 무엇을 증명하는지, 두 스크린샷, Task 2 Step 6 Playwright 출력 요약(명령·커밋 해시·통과 수), 근거 증거 파일 링크.
- [ ] **Step 3: 06 §3.4 한 줄** — "**비교 표**(2026-10-29, [랜딩 비교 표 스펙](../../polaris/specs/done/2026-10-29-landing-competitor-table.md)): 서비스 소개(`#about`)는 공고 수집 서비스 네 곳(첫 글자 + XX)과 SOL RADAR의 8행 기능 비교 표다. 칸은 ✓·△·—와 화면 낭독기 뜻 글자. SOL RADAR 열의 옅은 `brand` 바탕·글자는 위 brand 규칙의 예외다(사용자 결정)."
- [ ] **Step 4: PROGRESS 로그** — `2026-10-29 · 랜딩 서비스 소개를 공고 수집 서비스 4곳 비교 표로 교체(스펙 링크) · <실행한 명령과 결과>`. 가장 오래된 줄 하나를 지워 10줄 유지.
- [ ] **Step 5: 검증·커밋** — `bash <verify-slot.sh> pnpm verify:changed` exit 0 → `git -C <worktree> add docs/evidence/landing-comparison docs/06-UI-UX.md docs/PROGRESS.md polaris/specs/done/2026-10-29-landing-competitor-table.md && bash <verify-slot.sh> git -C <worktree> commit -m "docs: 랜딩 비교 표 화면 확인·기록"`
- [ ] **Step 6: 보고하고 멈춘다** — 브랜치·커밋 해시·검증 결과·스크린샷 경로를 보고한다. main 병합·push·Vercel 배포는 사용자 확인 뒤(화면 동결 11-01 전에 끝나야 촬영에 들어간다).
