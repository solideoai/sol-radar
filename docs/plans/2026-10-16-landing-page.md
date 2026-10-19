---
title: "랜딩페이지 구현 계획 — SOL RADAR 첫 화면"
doc: "plan-landing-page"
status: final
tags:
  - sol-radar
  - ui
  - hackathon
updated: 2026-10-19
---

# 랜딩페이지 Implementation Plan — SOL RADAR 첫 화면

> [!success] 보관 (2026-10-19)
> 이 설계안은 정본에 반영됐다(근거: 커밋 `a82bc63`·`e2d5215`·`e68d39a`·`8c80724`·`e0969cf` 첫 화면을 SOL RADAR 랜딩으로 교체, `b39b26e` 스크롤 등장 효과, [[PROGRESS|진행 상황]] 작업 로그 2026-10-16 "화면" 행 2건, 증거 `evidence/landing/20261016-landing-*.png`·`test-report.txt`). 이후 [[2026-10-16-landing-redesign|랜딩 재설계]]로 대체됐다. 수정하지 않고 보관한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 템플릿 랜딩(`web/app/page.tsx`)을 SOL RADAR 첫 화면으로 바꾼다. 히어로·제품 분석 미리보기(가상 공고 3건, 목록 선택 시 분석 전환)·문제 공감·주요 기능·작동 방식·분석 원칙·FAQ·마지막 CTA·바닥글을 데스크톱(1280px 이상) 기준으로 만든다.

**Architecture:** 랜딩 전용 부품은 `web/components/landing/`에 모은다(Phase 0에서 `apps/web`으로 옮기기 쉽게). 권고는 손으로 적지 않고 `analysis.ts`의 순수 함수가 [[08-SCORING|08 SOL Score]] §5.2 결정 정책 v0.1로 계산한다. 그래서 데모의 점수·자격 상태·권고가 어긋날 수 없다. 마케팅 틀(`site-header.tsx`·`site-footer.tsx`)과 shadcn 부품(`button`·`card`)은 그대로 다시 쓰고, 목록↔분석은 Base UI Tabs, FAQ는 Base UI Accordion으로 만든다(둘 다 설치된 `@base-ui/react` 1.9.0). 시작하기의 목적지만 `app/page.tsx`가 로그인 상태(`getMyHome`)로 정한다.

**Tech Stack:** Next.js 16.4.0 · React 19.3 · Tailwind v4 · shadcn(base-nova) · `@base-ui/react` 1.9.0 · `lucide-react` 1.54 · `tw-animate-css` · Vitest 4(node + browser) · Playwright 1.64

**Spec:** 2026-10-16 사용자 요청(이 대화. 아래 "요구사항 대조"에 항목별로 옮겨 적었다) + 범위 수정 "모바일과 결제는 빼"(같은 날). 제품 의도 [[01-PRD|01 PRD]], 화면 원칙 [[06-UI-UX|06 UI]] §1·§3·§10, 권고 규칙 [[08-SCORING|08 SOL Score]] §5.2, 책임 있는 AI 문구 [[09-SECURITY|09 보안]], 범위 [[16-DECISIONS|ADR-007]]. 실행자는 이 계획과 함께 이 문서들을 읽는다.

## Global Constraints

- 화면은 **데스크톱 전용**. 1280~1920px만 맞추고 확인 폭은 1440·1280px다. 1280px 미만 레이아웃·모바일 메뉴·햄버거를 만들지 않는다. 1280px 미만에서는 안내 한 줄(`DesktopNotice`)만 띄운다 ([[16-DECISIONS|ADR-007]], [[06-UI-UX|06]] §1).
- 결제·구독·요금제·가격표를 만들지 않는다 (ADR-007).
- 색은 `design/tokens.json`에만 적고 `pnpm tokens`로 `web/app/globals.css`를 만든다. 화면 코드에 `#hex`·`rgb()`·Tailwind 기본 팔레트(`bg-red-500` 등)·그라데이션을 쓰지 않는다(`check:colors`).
- 상태 색 글자(`text-success`·`text-warning`·`text-destructive`·`text-demo`)는 흰 바탕(`bg-background`·`bg-card`) 위에만 둔다. 상태는 아이콘 + 글자 + 색을 함께 쓴다 ([[06-UI-UX|06]] §3.2).
- 문구 원칙: "SOL Score는 사업 적합도이며 수주 확률이 아닙니다"를 점수 옆에 둔다. BID/WATCH/NO-BID는 "권고", 최종 참여 여부는 "담당자가 결정"으로 쓴다. 필수 자격에 확인 필요·미충족이 있으면 BID로 표시하지 않는다.
- 넣지 않는 것: 고객사 로고, 후기, 사용자 수, 성과·정확도·성능 수치, 보안 인증, 수주 실적, 가격표, 회사 주소·사업자번호·고객지원 이메일·SNS, 이용약관·개인정보처리방침 링크(그 화면이 없다), 정책 본문.
- 구현되지 않은 기능은 이용 가능한 것처럼 쓰지 않는다. 지금 SOL RADAR 기능은 하나도 구현되지 않았다(Phase 0 전). 주요 기능 카드마다 "개발 예정" 배지, 기능 구역과 마지막 CTA에 "MVP 개발 중" 안내를 둔다.
- 예시 데이터: 미리보기 위에 "예시 데이터" 배지. 기관 이름은 `가상 `으로 시작한다. 공고 원문 자리는 링크가 아니다(가짜 주소·`href="#"` 금지).
- 의미 없는 `href="#"`, 반응 없는 버튼을 만들지 않는다.
- 새 의존성을 설치하지 않는다(Base UI Tabs·Accordion, lucide, tw-animate-css 모두 설치돼 있다).
- 애니메이션은 `motion-safe:` 변형에만 둔다. `prefers-reduced-motion: reduce`면 등장 애니메이션이 하나도 돌지 않아야 한다. 스크롤에 따라 나타나는 효과는 쓰지 않는다(아래 결정 D9. 구현 뒤 사용자 결정으로 바뀌었다).
- 린트 가드: `eslint-disable`·`any`·`@ts-ignore`·테스트 `.only`·`.skip`·`.fixme` 금지. import는 `@/` 별칭(부모 상대경로 `../` 금지), 도메인은 배럴(`@/server/organization`)로만.
- 생성물 `web/app/globals.css`는 손으로 고치지 않는다.
- 주석은 한국어, "왜"만. 식별자는 영어.
- 커밋: 태스크마다 그 태스크의 파일만 지정해 `main`에 커밋한다(`git add -A`·`git add .` 금지). 메시지 `타입(범위): 한국어 설명`(첫 줄 50자 이내) + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시하지 않는다. 커밋 게이트(`.husky/`)를 우회하지 않는다. 서브에이전트로 실행하면 커밋은 메인 세션이 한다.
- 작업 시작 전부터 있던 무관한 변경(`docs/plans/` 안의 다른 파일 등)은 스테이징하지 않는다.
- Next.js 16은 학습 데이터와 다르다. 웹 코드를 쓰기 전에 Task 4 Step 1의 문서를 읽는다.

## Review Focus

1. **머리말이 구역 제목을 가림**: 머리말이 화면 위에 붙어 있어(sticky) 메뉴·버튼·`/#faq` 직접 진입으로 옮겨 간 뒤 구역 제목이 머리말 밑에 깔릴 수 있다. 제목은 머리말 아래에서 시작해야 한다 → Task 4 `분석 예시 보기` 시험, Task 5 메뉴 세 링크 시험, Task 6 `/#faq` 직접 진입·CTA 시험(`expectBelowHeader`).
2. **로그인 상태별 시작하기 목적지**: 로그인해 개인 조직이 있으면 그 대시보드(`/<slug>/dashboard`), 로그인 전·DB 없음·개인 조직 없음이면 가입 화면 → Task 4 `startHrefFor` 단위 시험(네 상태 전부).
3. **키보드만으로 미리보기 조작**: Tab으로 목록에 들어와 방향키로 공고를 옮기면 분석이 같이 바뀌고 초점이 보여야 한다 → Task 3 브라우저 시험(`ArrowDown`).
4. **움직임 줄이기 설정**: `prefers-reduced-motion: reduce`에서 등장 애니메이션이 남으면 안 된다 → Task 4 e2e(애니메이션이 걸린 요소 수 0, 끄기 전에는 1 이상인지 먼저 확인).
5. **정확히 1280px(스크롤바 포함)과 1920px에서 가로 넘침**: 데스크톱 최소 폭에서 머리말 한 줄·미리보기 두 단이 가로 스크롤을 만들면 안 된다 → Task 4 e2e(1280·1440·1920 넘침 0, 1280 머리말 한 줄) + Task 3 브라우저 시험(1280 넘침 0).

---

## 승인이 필요한 결정

`design-system` 스킬은 "새 부품·새 토큰은 만들기 전에 묻는다"고 한다. 이 계획을 승인하면 아래도 승인한 것으로 본다.

| # | 결정 | 근거 |
|---|---|---|
| D1 | `design/tokens.json`에 상태 색 3개 추가: `success #15803D`, `warning #B45309`, `demo #7C3AED`. 위험은 기존 `destructive #A51926`을 쓴다 | 값은 [[06-UI-UX\|06]] §3.1. 흰 바탕 대비: success 5.0:1, warning 5.0:1, destructive 7.6:1, demo 5.7:1 (AA 4.5:1 이상). 연한 바탕 위 글자는 4.5:1 아래로 떨어질 수 있어 흰 바탕에만 쓴다 |
| D2 | 새 shadcn 부품 `web/components/ui/accordion.tsx`를 손으로 쓴다(Base UI Accordion, base-nova 모양) | FAQ 접근성(버튼·`aria-expanded`·Enter/Space). CLI는 네트워크와 `globals.css` 덮어쓰기 위험이 있어 쓰지 않는다 |
| D3 | `web/project.json`의 title·description을 SOL RADAR로 바꾼다 | 로고 워드마크·바닥글·모든 화면의 기본 `<title>`·description이 이 파일에서 온다. 지금은 템플릿 문구 |
| D4 | `web/e2e/responsive.spec.ts`에서 `/`를 빼고, `site-header.spec.ts`의 320px 시험을 1280px 시험으로 바꾼다 | 첫 화면이 데스크톱 전용이 됐다(ADR-007). 1280·1440·1920 넘침은 `landing.spec.ts`가 본다. 다른 템플릿 경로의 320px 검사는 건드리지 않는다 |
| D5 | 메뉴 연결: 주요 기능 → `#features`(E), 분석 방식 → `#analysis`(F 작동 방식, 바로 뒤에 G 분석 원칙), 서비스 소개 → `#about`(D 문제 공감, 작은 제목 "서비스 소개") | 요청의 메뉴 이름과 구역 내용이 가장 가까운 짝 |
| D6 | 시작하기: 개인 조직이 있는 로그인 사용자는 `/<slug>/dashboard`, 그 밖은 `/auth/sign-up`. 로그인은 늘 `/auth/login` | 요청 4절. 템플릿 인증(Supabase) 화면이 실제로 있다(`web/app/auth/login`·`sign-up`). 로그인 화면은 이미 로그인한 사람을 대시보드로 보낸다 |
| D7 | 템플릿 `web/components/dashboard-preview.tsx`는 랜딩에서 쓰지 않게 되지만 지우지 않는다 | 이번 작업에서 만든 파일이 아니다. 지울지는 사용자가 정한다. → 구현 뒤 사용자 결정으로 삭제(2026-10-16) |
| D8 | 파란색(`brand`)을 작은 제목, 미리보기 선택 표시, 점수 막대, 단계 표시, 아이콘에 쓴다. 주요 버튼은 남색(`primary`) 그대로 | 요청 "네이비 텍스트와 블루 포인트". 템플릿 스킬의 "brand는 차트·선택 표시에만"보다 사용자 요청이 앞선다 |
| D9 | 등장 애니메이션은 페이지를 열 때 히어로·미리보기에만, 그리고 미리보기 공고를 바꿀 때 분석 패널에만 준다. 스크롤에 따라 나타나는 효과는 쓰지 않는다 | 스크롤 효과는 JS가 늦으면 내용이 숨고, 전체 화면 스크린샷(증거)에 빈 구역이 찍힌다. → 구현 뒤 사용자 결정으로 바꿈(2026-10-16): 레퍼런스 edgelink.me 를 잰 값대로 히어로 아래 블록에 스크롤 등장 효과를 넣었다(`web/components/landing/reveal.tsx`, 20% 보이면 500ms 동안 24px 위로, 한 번만). 걱정했던 두 문제는 이렇게 막았다: 숨김은 JS 가 붙은 뒤 화면 아래에 있는 블록에만 걸고(JS 가 없거나 늦으면 그대로 보인다), 증거 스크린샷은 끝까지 스크롤하거나 움직임 줄이기로 찍는다 |
| D10 | **Phase 0과의 관계**: 계획을 쓸 때의 Phase 0 초안은 `web/`를 지우고 `apps/web`을 새로 만들 예정이었다. 이 계획은 랜딩 부품을 `web/components/landing/`에 모아 옮기기 쉽게만 했다 | 구현 중 [[16-DECISIONS\|ADR-017]](Next.js + Supabase, 코드는 `web/` 유지)이 채택되고 그 초안은 폐기됐다. 랜딩은 `web/`에 그대로 남고, `startHrefFor`는 Supabase 인증(`getMyHome`)을 그대로 쓴다 |

## 파일 지도

```text
design/tokens.json                                   # Task 1 (상태 색 3개)
web/app/globals.css                                  # Task 1 (pnpm tokens 생성물)
web/project.json, web/components/logo.tsx            # Task 1 (이름·설명·레이더 아이콘)
web/components/landing/analysis.ts (+ .test.ts)      # Task 2 (권고 규칙, 순수 함수)
web/components/landing/format.ts (+ .test.ts)        # Task 2 (금액·날짜 표시)
web/components/landing/demo-bids.ts (+ .test.ts)     # Task 2 (가상 공고 3건)
web/components/landing/status-badges.tsx            # Task 3 (권고·자격·예시 데이터·개발 예정 배지)
web/components/landing/product-preview.tsx          # Task 3 (클라이언트, Base UI Tabs)
web/components/landing/product-preview.browser.test.tsx  # Task 3
web/components/landing/landing-links.ts (+ .test.ts) # Task 4 (구역 링크·시작하기 목적지)
web/components/landing/desktop-notice.tsx, hero.tsx, product-preview-section.tsx  # Task 4
web/components/site-header.tsx, web/components/site-footer.tsx  # Task 4 (수정)
web/app/page.tsx                                     # Task 4 (교체), Task 5·6 (구역 추가)
web/e2e/sticky-header.ts (new), landing.spec.ts (rewrite)        # Task 4
web/e2e/site-header.spec.ts, home.spec.ts, responsive.spec.ts, operations.spec.ts  # Task 4 (수정)
web/components/landing/section-heading.tsx, icon-chip.tsx       # Task 5
web/components/landing/problem-section.tsx, features-section.tsx, feature-previews.tsx  # Task 5
web/components/landing/how-it-works-section.tsx, principles-section.tsx                 # Task 5
web/e2e/landing-sections.spec.ts (new)               # Task 5, Task 6 (이어서)
web/components/ui/accordion.tsx (new)                # Task 6
web/components/landing/faq-section.tsx, final-cta-section.tsx  # Task 6
docs/evidence/landing/*.png, docs/PROGRESS.md        # Task 7
```

## 요구사항 대조

| 요구 | 태스크 |
|---|---|
| A 내비게이션(워드마크·메뉴 3·로그인·시작하기, 구역 이동, 고정 시 가리지 않음) | 1(워드마크), 4(머리말·sticky·`scroll-mt-20`), 5(메뉴 이동 시험) |
| B 히어로(보조 문구·메인 카피·설명·두 버튼·안내) | 4 |
| C 제품 분석 미리보기(기관·예산·마감·점수·자격·권고·근거·확인 사항·원문 자리, 예시 데이터 배지, 수주 확률 안내, 3건 전환) | 2(데이터·규칙), 3(화면), 4(배치·`#demo`) |
| D 문제 공감 3상황 + 기능으로 잇는 문장 | 5 |
| E 주요 기능 4(작은 제품 UI, 개발 예정 표시) | 5 |
| F 작동 방식 3단계(하는 일·얻는 것) | 5 |
| G 분석 원칙 4 | 5 |
| H FAQ 5(접근 가능한 아코디언) | 6 |
| I 마지막 CTA(두 버튼, MVP 개발 중 안내) | 6 |
| J 푸터(이름·한 줄 소개·메뉴 3·저작권, 약관 링크 없음) | 4 |
| 4절 동작(루트 경로, 인증·대시보드 유지, 시작하기 목적지, `href="#"` 없음, 데모 데이터 분리, SEO, 접근성, 가로 넘침 없음, 허위 정보 없음) | 2·4·6, 시험은 4·6 |
| 5절 완료 기준(CTA·이동, 일관성, 인증 유지, 1440·1280 확인, lint·type·build, 브라우저·콘솔) | 7 |
| 모바일·태블릿 확인, 모바일 메뉴 | **범위 제외**(사용자 지시, ADR-007) |

---

### Task 1: 상태 색 토큰과 SOL RADAR 이름

**Files:**
- Modify: `design/tokens.json` (`colors`에 3개, `$comment`에 한 문장)
- Generate: `web/app/globals.css` (`pnpm tokens`)
- Modify: `web/project.json`
- Modify: `web/components/logo.tsx` (아이콘 `LayersIcon` → `RadarIcon`)

**Interfaces:**
- Produces: Tailwind 색 클래스 `text-success`·`border-success/30`·`text-warning`·`border-warning/30`·`text-demo`·`border-demo/30`(Task 3·5가 쓴다). `project.title === "SOL RADAR"`(머리말·바닥글·e2e가 읽는다).

- [ ] **Step 1: 토큰 추가** — `design/tokens.json`의 `"destructive": "#A51926",` 바로 아래에 세 줄을 넣는다.

```json
    "destructive": "#A51926",
    "success": "#15803D",
    "warning": "#B45309",
    "demo": "#7C3AED",
```

`$comment` 문자열 끝(마지막 `."` 앞)에 다음 문장을 이어 붙인다(앞에 공백 하나):

```text
 success·warning 은 상태 색이다(충족·BID 는 success, 확인 필요·WATCH 는 warning, 미충족·NO-BID 는 destructive). demo 는 '예시 데이터' 표시 전용이다(docs/06-UI-UX.md §3.1). 셋 다 글자·아이콘·테두리에만 쓰고 흰 바탕(background·card) 위에 둔다 — 연한 바탕 위에서는 대비가 4.5:1 아래로 떨어질 수 있다.
```

- [ ] **Step 2: 생성물 갱신**

Run: `pnpm tokens && grep -nE -- "--(success|warning|demo)" web/app/globals.css`
Expected: `:root`의 `--success: #15803D;` 등 3줄과 `@theme inline`의 `--color-success: var(--success);` 등 3줄, 모두 6줄.

- [ ] **Step 3: 대비 확인(파일을 남기지 않는 한 줄 계산)**

Run:
```bash
node -e 'const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};for(const h of ["#15803D","#B45309","#A51926","#7C3AED","#1B64DA"])console.log(h,(1.05/(L(h)+0.05)).toFixed(2))'
```
Expected: 다섯 값 모두 4.5 이상(대략 5.02 · 5.02 · 7.59 · 5.70 · 5.42). 4.5 미만이 있으면 멈추고 사용자에게 알린다.

- [ ] **Step 4: `web/project.json` 교체**

```json
{
  "title": "SOL RADAR",
  "description": "공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원 플랫폼. 공고 요구사항과 기업의 기술·자격·실적을 비교해 먼저 검토할 사업과 판단 근거를 정리합니다."
}
```

- [ ] **Step 5: 로고 아이콘** — `web/components/logo.tsx`에서 `import { LayersIcon } from "lucide-react";`를 `import { RadarIcon } from "lucide-react";`로, `<LayersIcon className="size-4" />`를 `<RadarIcon className="size-4" />`로 바꾼다. 나머지(주석 포함)는 그대로 둔다.

- [ ] **Step 6: 검증**

Run: `pnpm check:tokens && pnpm check:colors && pnpm -C web type-check && pnpm -C web test`
Expected: 모두 통과.

- [ ] **Step 7: 커밋**

```bash
git add design/tokens.json web/app/globals.css web/project.json web/components/logo.tsx
git commit -m "feat(web): 상태 색 토큰과 SOL RADAR 이름을 더한다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 분석 예시의 권고 규칙과 데모 데이터

**Files:**
- Create: `web/components/landing/analysis.ts`, `web/components/landing/analysis.test.ts`
- Create: `web/components/landing/format.ts`, `web/components/landing/format.test.ts`
- Create: `web/components/landing/demo-bids.ts`, `web/components/landing/demo-bids.test.ts`

**Interfaces:**
- Produces (`@/components/landing/analysis`):
  - `type QualificationStatus = "SATISFIED" | "NEEDS_REVIEW" | "NOT_SATISFIED"`
  - `type Recommendation = "BID" | "WATCH" | "NO_BID"`
  - `type QualificationCheck = { requirement: string; status: QualificationStatus; note: string }`
  - `type ScoreFactor = { label: string; points: number; max: number }`
  - `type Verdict = { recommendation: Recommendation; reason: string }`
  - `BID_THRESHOLD = 75`, `WATCH_THRESHOLD = 50`
  - `scoreOf(factors: readonly ScoreFactor[]): number`
  - `countByStatus(checks: readonly QualificationCheck[]): Record<QualificationStatus, number>`
  - `recommend(checks: readonly QualificationCheck[], score: number): Verdict`
- Produces (`@/components/landing/format`): `formatWon(won: number): string`, `formatDate(isoDate: string): string`
- Produces (`@/components/landing/demo-bids`): `type DemoBid`(아래 코드), `DEMO_BIDS: readonly DemoBid[]`(3건, 0번이 대표 예시)

- [ ] **Step 1: 실패하는 시험 — `analysis.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  countByStatus,
  recommend,
  scoreOf,
  type QualificationCheck,
} from "@/components/landing/analysis";

// docs/08-SCORING.md §5.2 결정 정책 v0.1. 필수 자격이 점수보다 먼저다.
const check = (status: QualificationCheck["status"]): QualificationCheck => ({
  requirement: "필수 자격",
  status,
  note: "",
});

describe("recommend", () => {
  it("필수 자격이 하나라도 미충족이면 점수가 높아도 NO_BID 다", () => {
    expect(recommend([check("SATISFIED"), check("NOT_SATISFIED")], 95)).toEqual({
      recommendation: "NO_BID",
      reason: "필수 자격 미충족 1건이 있어 참여를 권고하지 않습니다. 점수는 참고용입니다.",
    });
  });

  it("확인 필요가 남아 있으면 BID 기준 이상이어도 WATCH 다", () => {
    expect(recommend([check("SATISFIED"), check("NEEDS_REVIEW")], 82)).toEqual({
      recommendation: "WATCH",
      reason: "필수 자격 확인 필요 1건이 남아 있어 BID로 권고하지 않습니다.",
    });
  });

  it("미충족과 확인 필요가 같이 있으면 미충족이 이긴다", () => {
    expect(recommend([check("NEEDS_REVIEW"), check("NOT_SATISFIED")], 90).recommendation).toBe(
      "NO_BID",
    );
  });

  it.each([
    [100, "BID"],
    [75, "BID"],
    [74, "WATCH"],
    [50, "WATCH"],
    [49, "NO_BID"],
  ] as const)("자격을 모두 충족하면 %i점은 %s 다", (score, expected) => {
    expect(recommend([check("SATISFIED")], score).recommendation).toBe(expected);
  });

  it("자격을 모두 충족하고 75점 이상이면 그 사실을 이유로 든다", () => {
    expect(recommend([check("SATISFIED")], 88).reason).toBe(
      "필수 자격을 모두 충족하고 적합도가 75점 이상입니다.",
    );
  });
});

describe("scoreOf · countByStatus", () => {
  it("점수는 요소 점수의 합이다", () => {
    expect(
      scoreOf([
        { label: "a", points: 24, max: 30 },
        { label: "b", points: 58, max: 70 },
      ]),
    ).toBe(82);
  });

  it("상태별 개수를 센다", () => {
    expect(
      countByStatus([check("SATISFIED"), check("SATISFIED"), check("NEEDS_REVIEW")]),
    ).toEqual({ SATISFIED: 2, NEEDS_REVIEW: 1, NOT_SATISFIED: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C web exec vitest run components/landing/analysis.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/landing/analysis"`.

- [ ] **Step 3: 구현 — `analysis.ts`**

```ts
// 랜딩 분석 예시의 권고 규칙. 실제 규칙 엔진이 아니라 docs/08-SCORING.md §5.2 결정 정책 v0.1 을 옮긴 것이다.
// 예시 데이터의 권고는 손으로 적지 않고 이 규칙으로 계산한다 — 따로 적으면 점수·자격 상태와 어긋날 수 있다.

export type QualificationStatus = "SATISFIED" | "NEEDS_REVIEW" | "NOT_SATISFIED";
export type Recommendation = "BID" | "WATCH" | "NO_BID";

export type QualificationCheck = {
  requirement: string;
  status: QualificationStatus;
  note: string;
};

export type ScoreFactor = { label: string; points: number; max: number };

export type Verdict = { recommendation: Recommendation; reason: string };

export const BID_THRESHOLD = 75;
export const WATCH_THRESHOLD = 50;

export const scoreOf = (factors: readonly ScoreFactor[]): number =>
  factors.reduce((total, factor) => total + factor.points, 0);

export const countByStatus = (
  checks: readonly QualificationCheck[],
): Record<QualificationStatus, number> => ({
  SATISFIED: checks.filter((check) => check.status === "SATISFIED").length,
  NEEDS_REVIEW: checks.filter((check) => check.status === "NEEDS_REVIEW").length,
  NOT_SATISFIED: checks.filter((check) => check.status === "NOT_SATISFIED").length,
});

// 필수 자격이 점수보다 먼저다. 미충족이면 점수와 상관없이 NO-BID, 확인 필요가 남으면 BID 를 내지 않는다.
// 이유 문장은 권고를 정한 첫 조건을 그대로 말한다.
export function recommend(checks: readonly QualificationCheck[], score: number): Verdict {
  const counts = countByStatus(checks);
  if (counts.NOT_SATISFIED > 0) {
    return {
      recommendation: "NO_BID",
      reason: `필수 자격 미충족 ${counts.NOT_SATISFIED}건이 있어 참여를 권고하지 않습니다. 점수는 참고용입니다.`,
    };
  }
  if (counts.NEEDS_REVIEW > 0) {
    return {
      recommendation: "WATCH",
      reason: `필수 자격 확인 필요 ${counts.NEEDS_REVIEW}건이 남아 있어 BID로 권고하지 않습니다.`,
    };
  }
  if (score >= BID_THRESHOLD) {
    return {
      recommendation: "BID",
      reason: `필수 자격을 모두 충족하고 적합도가 ${BID_THRESHOLD}점 이상입니다.`,
    };
  }
  return score >= WATCH_THRESHOLD
    ? {
        recommendation: "WATCH",
        reason: `필수 자격은 충족하지만 적합도가 ${BID_THRESHOLD}점 미만이라 조건을 더 검토할 사업입니다.`,
      }
    : { recommendation: "NO_BID", reason: `적합도가 ${WATCH_THRESHOLD}점 미만입니다.` };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm -C web exec vitest run components/landing/analysis.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: 실패하는 시험 — `format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { formatDate, formatWon } from "@/components/landing/format";

describe("formatWon", () => {
  it.each([
    [1_450_000_000, "14억 5,000만 원"],
    [880_000_000, "8억 8,000만 원"],
    [2_300_000_000, "23억 원"],
    [35_000_000, "3,500만 원"],
    [5_000, "5,000원"],
  ])("%i원은 %s", (won, expected) => {
    expect(formatWon(won)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("YYYY-MM-DD 를 앞자리 0 없이 점으로 잇는다", () => {
    expect(formatDate("2026-11-05")).toBe("2026. 11. 5.");
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm -C web exec vitest run components/landing/format.test.ts`
Expected: FAIL — 모듈을 찾지 못함.

- [ ] **Step 7: 구현 — `format.ts`**

```ts
// 금액은 억·만 단위로 줄여 읽기 쉽게 한다. 날짜는 예시 데이터라 시간대 변환이 필요 없는 YYYY-MM-DD 만 받는다.
export function formatWon(won: number): string {
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const parts = [
    eok > 0 ? `${eok}억` : null,
    man > 0 ? `${man.toLocaleString("ko-KR")}만` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `${parts.join(" ")} 원` : `${won.toLocaleString("ko-KR")}원`;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm -C web exec vitest run components/landing/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: 실패하는 시험 — `demo-bids.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEMO_BIDS } from "@/components/landing/demo-bids";

// 랜딩 미리보기가 보여 주는 숫자·상태·권고가 서로 맞는지 고정한다. 요청이 정한 대표 예시는 0번이다.
describe("DEMO_BIDS", () => {
  it("예시 공고는 3건이고 id 가 겹치지 않는다", () => {
    expect(DEMO_BIDS).toHaveLength(3);
    expect(new Set(DEMO_BIDS.map((bid) => bid.id)).size).toBe(3);
  });

  it("대표 예시는 82점, 확인 필요 1건, WATCH 다", () => {
    const [first] = DEMO_BIDS;
    expect(first.title).toBe("공공기관 업무지원 시스템 고도화");
    expect(first.score).toBe(82);
    expect(first.counts).toEqual({ SATISFIED: 2, NEEDS_REVIEW: 1, NOT_SATISFIED: 0 });
    expect(first.recommendation).toBe("WATCH");
    expect(first.reasons.join(" ")).toContain("유사 사업 실적 보유");
    expect(first.reasons.join(" ")).toContain("주요 기술 요구사항 부합");
    expect(first.followUps).toContain("필수 증빙의 유효기간 확인 필요");
  });

  it("세 권고(BID·WATCH·NO_BID)를 한 번씩 보여 준다", () => {
    expect(DEMO_BIDS.map((bid) => bid.recommendation).toSorted()).toEqual([
      "BID",
      "NO_BID",
      "WATCH",
    ]);
  });

  it("확인 필요나 미충족이 있는 공고는 BID 가 아니다", () => {
    DEMO_BIDS.filter((bid) => bid.counts.NEEDS_REVIEW + bid.counts.NOT_SATISFIED > 0).forEach(
      (bid) => expect(bid.recommendation).not.toBe("BID"),
    );
  });

  it("확인 필요가 있는 공고는 추가 확인 사항을 적어 둔다", () => {
    DEMO_BIDS.filter((bid) => bid.counts.NEEDS_REVIEW > 0).forEach((bid) =>
      expect(bid.followUps.length).toBeGreaterThan(0),
    );
  });

  it("요소 점수는 0 이상 만점 이하이고, 만점의 합은 100 이다", () => {
    DEMO_BIDS.forEach((bid) => {
      bid.factors.forEach((factor) => {
        expect(factor.points).toBeGreaterThanOrEqual(0);
        expect(factor.points).toBeLessThanOrEqual(factor.max);
      });
      expect(bid.factors.reduce((total, factor) => total + factor.max, 0)).toBe(100);
    });
  });

  it("기관 이름은 가상임을 밝힌다", () => {
    DEMO_BIDS.forEach((bid) => expect(bid.agency).toMatch(/^가상 /));
  });
});
```

- [ ] **Step 10: 실패 확인**

Run: `pnpm -C web exec vitest run components/landing/demo-bids.test.ts`
Expected: FAIL — 모듈을 찾지 못함.

- [ ] **Step 11: 구현 — `demo-bids.ts`**

```ts
import {
  countByStatus,
  recommend,
  scoreOf,
  type QualificationCheck,
  type QualificationStatus,
  type Recommendation,
  type ScoreFactor,
} from "@/components/landing/analysis";

// 랜딩 분석 예시의 가상 공고. 기관·사업·숫자는 모두 지어낸 것이고 실제 공고·기관과 관계없다.
// 기관 이름은 "가상"으로 시작해 실제 기관으로 읽히지 않게 한다. 원문 주소는 두지 않는다(링크를 만들지 않는다).
// 이 파일에는 입력만 적는다. 점수는 요소 점수의 합, 권고는 analysis.ts 의 규칙으로 계산한다.

type DemoBidInput = {
  id: string;
  title: string;
  agency: string;
  budgetWon: number;
  /** YYYY-MM-DD */
  proposalDue: string;
  factors: ScoreFactor[];
  checks: QualificationCheck[];
  reasons: string[];
  followUps: string[];
};

export type DemoBid = DemoBidInput & {
  score: number;
  recommendation: Recommendation;
  recommendationReason: string;
  counts: Record<QualificationStatus, number>;
};

// 요소와 만점은 docs/08-SCORING.md 의 가중치(30·25·20·15·10)를 따른다.
const factors = (
  tech: number,
  record: number,
  staff: number,
  size: number,
  strategy: number,
): ScoreFactor[] => [
  { label: "기술 스택 적합", points: tech, max: 30 },
  { label: "유사 수행 실적", points: record, max: 25 },
  { label: "인력 가용성", points: staff, max: 20 },
  { label: "규모 적합성", points: size, max: 15 },
  { label: "전략적 선호", points: strategy, max: 10 },
];

const SOFTWARE_BUSINESS: QualificationCheck = {
  requirement: "소프트웨어사업자 신고",
  status: "SATISFIED",
  note: "기업 프로필의 신고 정보와 일치합니다.",
};

const SME_ONLY: QualificationCheck = {
  requirement: "중소기업 제한경쟁 참가 자격",
  status: "SATISFIED",
  note: "기업 규모 정보와 일치합니다.",
};

const INPUTS: DemoBidInput[] = [
  {
    id: "demo-1",
    title: "공공기관 업무지원 시스템 고도화",
    agency: "가상 행정지원청",
    budgetWon: 1_450_000_000,
    proposalDue: "2026-11-20",
    factors: factors(24, 22, 16, 12, 8),
    checks: [
      SOFTWARE_BUSINESS,
      SME_ONLY,
      {
        requirement: "필수 증빙(인증서) 제출",
        status: "NEEDS_REVIEW",
        note: "등록된 증빙의 유효기간을 확인할 수 없습니다.",
      },
    ],
    reasons: [
      "유사 사업 실적 보유 — 최근 3년 업무지원 시스템 구축 2건",
      "주요 기술 요구사항 부합 — 요구 기술 6개 중 5개 보유",
    ],
    followUps: ["필수 증빙의 유효기간 확인 필요"],
  },
  {
    id: "demo-2",
    title: "통합 민원 포털 기능 개선",
    agency: "가상 문화정보원",
    budgetWon: 880_000_000,
    proposalDue: "2026-11-27",
    factors: factors(27, 23, 18, 12, 8),
    checks: [
      SOFTWARE_BUSINESS,
      SME_ONLY,
      {
        requirement: "직접생산확인증명",
        status: "SATISFIED",
        note: "유효기간 안의 증명서가 등록되어 있습니다.",
      },
    ],
    reasons: [
      "유사 사업 실적 보유 — 민원 포털 구축 3건",
      "주요 기술 요구사항 부합 — 요구 기술 5개 모두 보유",
    ],
    followUps: [],
  },
  {
    id: "demo-3",
    title: "원격 교육 플랫폼 구축",
    agency: "가상 교육연구원",
    budgetWon: 2_300_000_000,
    proposalDue: "2026-11-13",
    factors: factors(18, 12, 16, 10, 8),
    checks: [
      SOFTWARE_BUSINESS,
      {
        requirement: "원격교육 분야 수행 실적 1건 이상",
        status: "NOT_SATISFIED",
        note: "등록된 실적에 원격교육 분야 사업이 없습니다.",
      },
      SME_ONLY,
    ],
    reasons: [
      "필수 실적 요건 미충족 — 원격교육 분야 수행 실적 없음",
      "주요 기술 요구사항 일부 부합 — 요구 기술 7개 중 4개 보유",
    ],
    followUps: ["유사 분야 실적을 인정하는지 공고 원문 확인"],
  },
];

const withAnalysis = (input: DemoBidInput): DemoBid => {
  const score = scoreOf(input.factors);
  const { recommendation, reason } = recommend(input.checks, score);
  return {
    ...input,
    score,
    recommendation,
    recommendationReason: reason,
    counts: countByStatus(input.checks),
  };
};

export const DEMO_BIDS: readonly DemoBid[] = INPUTS.map(withAnalysis);
```

- [ ] **Step 12: 통과 확인**

Run: `pnpm -C web exec vitest run components/landing/`
Expected: PASS (analysis 11 · format 6 · demo-bids 7). 점수: demo-1 82 WATCH, demo-2 88 BID, demo-3 64 NO_BID.

- [ ] **Step 13: 서식·타입·린트·구조**

Run: `pnpm -C web format && pnpm -C web type-check && pnpm -C web lint && pnpm -C web lodestar`
Expected: 통과. `format`이 바꾼 것은 그대로 둔다.

- [ ] **Step 14: 커밋**

```bash
git add web/components/landing/analysis.ts web/components/landing/analysis.test.ts web/components/landing/format.ts web/components/landing/format.test.ts web/components/landing/demo-bids.ts web/components/landing/demo-bids.test.ts
git commit -m "feat(web): 랜딩 분석 예시 데이터와 권고 규칙 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 상태 배지와 제품 분석 미리보기

**Files:**
- Create: `web/components/landing/status-badges.tsx`
- Create: `web/components/landing/product-preview.tsx`
- Test: `web/components/landing/product-preview.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `DEMO_BIDS`, `DemoBid`, `formatWon`, `formatDate`, `QualificationStatus`, `Recommendation`. Task 1의 색 토큰.
- Produces:
  - `RecommendationBadge({ value: Recommendation; size?: "sm" | "md"; className?: string })`
  - `QualificationLabel({ status: QualificationStatus })`
  - `DemoBadge({ className?: string })` — 글자 "예시 데이터"
  - `PlannedBadge()` — 글자 "개발 예정"
  - `ProductPreview()` — 클라이언트 부품. `role="tablist"`(이름 "예시 공고 3건"), 공고마다 `role="tab"`, 선택한 공고의 `role="tabpanel"` 안에 h3(공고명)·`role="meter"`(이름 "SOL Score")

- [ ] **Step 1: 실패하는 시험 — `product-preview.browser.test.tsx`**

```tsx
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { ProductPreview } from "@/components/landing/product-preview";

// 랜딩의 분석 미리보기를 진짜 브라우저로 그려, 고르면 분석이 바뀌는지·키보드로 되는지·1280px 에서 넘치지 않는지 본다.

const [first, second] = DEMO_BIDS;
const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

// 랜딩처럼 본문 여백(px-8)과 단 폭(max-w-6xl) 안에 넣는다.
const render = async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(
    <main className="px-8">
      <div className="mx-auto max-w-6xl">
        <ProductPreview />
      </div>
    </main>,
  );
  mounted.push(root);
  await expect.element(page.getByRole("tablist")).toBeInTheDocument();
};

const tabOf = (title: string) => page.getByRole("tab", { name: new RegExp(title) });

describe("ProductPreview", () => {
  it("처음에는 대표 예시(82점·WATCH)를 보여 주고 점수 옆에 수주 확률이 아니라는 안내가 있다", async () => {
    await page.viewport(1280, 900);
    await render();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByRole("heading", { name: first.title })).toBeVisible();
    await expect
      .element(panel.getByRole("meter", { name: "SOL Score" }))
      .toHaveAttribute("aria-valuenow", "82");
    await expect
      .element(panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다."))
      .toBeVisible();
    await expect.element(panel.getByText("WATCH", { exact: true })).toBeVisible();
    await expect.element(panel.getByText("BID", { exact: true })).not.toBeInTheDocument();
    await expect.element(panel.getByText("충족 2 · 확인 필요 1 · 미충족 0")).toBeVisible();
    await expect.element(page.getByText("예시 데이터").first()).toBeVisible();
  });

  it("목록에서 다른 공고를 누르면 분석이 그 공고로 바뀐다", async () => {
    await render();
    await tabOf(second.title).click();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByRole("heading", { name: second.title })).toBeVisible();
    await expect
      .element(panel.getByRole("meter", { name: "SOL Score" }))
      .toHaveAttribute("aria-valuenow", String(second.score));
    await expect.element(panel.getByText("BID", { exact: true })).toBeVisible();
  });

  it("방향키로 목록을 옮기면 선택과 분석이 같이 바뀐다", async () => {
    await render();
    await tabOf(first.title).click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(tabOf(second.title)).toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("tabpanel").getByRole("heading", { name: second.title }))
      .toBeVisible();
  });

  it("공고 원문 자리는 링크가 아니라 예시라서 원문이 없다고 밝힌다", async () => {
    await render();
    await expect.element(page.getByText(/예시 공고라 연결할 원문이 없습니다/)).toBeVisible();
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("1280px 에서 화면 폭을 넘지 않는다", async () => {
    await page.viewport(1280, 900);
    await render();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C web exec vitest run --config vitest.browser.config.ts components/landing/product-preview.browser.test.tsx`
Expected: FAIL — `@/components/landing/product-preview`를 찾지 못함. (Chromium이 없다는 오류면 `pnpm -C web exec playwright install chromium` 뒤 다시.)

- [ ] **Step 3: 구현 — `status-badges.tsx`**

```tsx
import { cn } from "cn";
import {
  CircleArrowUpIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  EyeIcon,
  FlaskConicalIcon,
  OctagonXIcon,
  type LucideIcon,
} from "lucide-react";
import type { QualificationStatus, Recommendation } from "@/components/landing/analysis";

// 상태는 아이콘 + 글자 + 색을 함께 쓴다(docs/06-UI-UX.md §3.2). 색만으로 뜻을 전하지 않는다.
// 배지 바탕은 흰색(bg-background)이다 — 상태 색 글자는 연한 바탕 위에서 대비가 4.5:1 아래로 떨어질 수 있다.
type StatusStyle = { label: string; icon: LucideIcon; tone: string };

const RECOMMENDATION_STYLES: Record<Recommendation, StatusStyle> = {
  BID: { label: "BID", icon: CircleArrowUpIcon, tone: "border-success/30 text-success" },
  WATCH: { label: "WATCH", icon: EyeIcon, tone: "border-warning/30 text-warning" },
  NO_BID: { label: "NO-BID", icon: OctagonXIcon, tone: "border-destructive/30 text-destructive" },
};

const QUALIFICATION_STYLES: Record<QualificationStatus, StatusStyle> = {
  SATISFIED: { label: "충족", icon: CircleCheckIcon, tone: "text-success" },
  NEEDS_REVIEW: { label: "확인 필요", icon: CircleHelpIcon, tone: "text-warning" },
  NOT_SATISFIED: { label: "미충족", icon: CircleXIcon, tone: "text-destructive" },
};

// cn 은 type-* 끼리 합쳐 주지 않는다. 크기는 바탕에 두지 않고 size 로만 고른다.
const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border bg-background font-medium whitespace-nowrap";
const BADGE_SIZES = {
  sm: "px-1.5 py-0.5 type-caption [&_svg]:size-3.5",
  md: "px-2 py-1 type-label [&_svg]:size-4",
} as const;

export function RecommendationBadge({
  value,
  size = "sm",
  className,
}: {
  value: Recommendation;
  size?: keyof typeof BADGE_SIZES;
  className?: string;
}) {
  const { label, icon: Icon, tone } = RECOMMENDATION_STYLES[value];
  return (
    <span className={cn(BADGE, BADGE_SIZES[size], tone, className)}>
      <Icon aria-hidden />
      {label}
    </span>
  );
}

export function QualificationLabel({ status }: { status: QualificationStatus }) {
  const { label, icon: Icon, tone } = QUALIFICATION_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 type-label font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}

// 가상 데이터라는 표시. 실제 공고처럼 읽히지 않게 미리보기 머리와 공고 제목 위에 둔다(docs/09-SECURITY.md DEMO 원칙).
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn(BADGE, BADGE_SIZES.sm, "border-demo/30 text-demo", className)}>
      <FlaskConicalIcon aria-hidden />
      예시 데이터
    </span>
  );
}

// 아직 만들지 않은 기능에 붙인다. 이용할 수 있는 것처럼 보이지 않게 한다.
export function PlannedBadge() {
  return (
    <span className={cn(BADGE, BADGE_SIZES.sm, "border-border text-muted-foreground")}>
      개발 예정
    </span>
  );
}
```

- [ ] **Step 4: 구현 — `product-preview.tsx`**

```tsx
"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Link2OffIcon, RadarIcon } from "lucide-react";
import { DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import {
  DemoBadge,
  QualificationLabel,
  RecommendationBadge,
} from "@/components/landing/status-badges";

// 랜딩의 시각적 중심. 실제 화면이 아니라 가상 데이터(demo-bids.ts)로 그린 분석 화면이다.
// 왼쪽 목록에서 공고를 고르면 오른쪽 분석이 바뀐다. 목록과 분석의 관계가 탭과 같아 Base UI Tabs(세로)로 만든다.
// 패널을 그리는 데 시간이 들지 않아 방향키로 옮기면 바로 고른다(activateOnFocus).
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-left shadow-sm">
      <PreviewBar />
      <Tabs.Root
        defaultValue={DEMO_BIDS[0].id}
        orientation="vertical"
        className="grid grid-cols-[18rem_minmax(0,1fr)]"
      >
        <div className="border-r border-border bg-muted/40">
          <p
            id="demo-list-title"
            className="px-4 pt-4 pb-2 type-caption font-medium text-muted-foreground"
          >
            예시 공고 {DEMO_BIDS.length}건
          </p>
          <Tabs.List
            activateOnFocus
            aria-labelledby="demo-list-title"
            className="flex flex-col gap-1 px-2 pb-3"
          >
            {DEMO_BIDS.map((bid) => (
              <BidTab key={bid.id} bid={bid} />
            ))}
          </Tabs.List>
        </div>
        {DEMO_BIDS.map((bid) => (
          <Tabs.Panel
            key={bid.id}
            value={bid.id}
            className="min-w-0 p-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in"
          >
            <BidAnalysis bid={bid} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

// 창 머리. 주소 칸 대신 화면 이름과 분석 기준을 적는다 — 실제 서비스 주소처럼 보이지 않게 한다.
function PreviewBar() {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2.5">
      <RadarIcon aria-hidden className="size-4 text-brand" />
      <p className="type-label font-medium text-foreground">공고 분석</p>
      <span aria-hidden className="h-4 w-px bg-border" />
      <p className="type-caption text-muted-foreground">분석 기준: 가상 기업 프로필</p>
      <DemoBadge className="ml-auto" />
    </div>
  );
}

// 탭 안에는 글자 요소(span)만 둔다 — 버튼 안에 제목·블록 요소를 넣지 않는다.
function BidTab({ bid }: { bid: DemoBid }) {
  return (
    <Tabs.Tab
      value={bid.id}
      className="group/tab relative flex w-full flex-col items-start gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none hover:bg-background/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-active:border-border data-active:bg-background data-active:shadow-xs motion-safe:transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand opacity-0 group-data-active/tab:opacity-100"
      />
      <span className="type-label font-medium text-foreground">{bid.title}</span>
      <span className="type-caption text-muted-foreground">{bid.agency}</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="type-caption text-muted-foreground">
          SOL Score <span className="font-semibold text-foreground tabular-nums">{bid.score}</span>
        </span>
        <RecommendationBadge value={bid.recommendation} />
      </span>
    </Tabs.Tab>
  );
}

function BidAnalysis({ bid }: { bid: DemoBid }) {
  return (
    <article aria-labelledby={`${bid.id}-title`} className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <DemoBadge />
          <span className="type-caption text-muted-foreground">입찰공고</span>
        </div>
        <h3 id={`${bid.id}-title`} className="type-lead font-semibold text-foreground">
          {bid.title}
        </h3>
        <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border px-4 py-3">
          <Fact term="기관명" value={bid.agency} />
          <Fact term="사업 예산" value={formatWon(bid.budgetWon)} />
          <Fact term="제안서 마감" value={formatDate(bid.proposalDue)} />
        </dl>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <ScoreBlock bid={bid} />
        <RecommendationBlock bid={bid} />
      </div>
      <QualificationBlock bid={bid} />
      <div className="grid grid-cols-2 gap-4">
        <ListBlock title="주요 판단 근거" items={bid.reasons} empty="적힌 근거가 없습니다." />
        <ListBlock
          title="추가 확인 사항"
          items={bid.followUps}
          empty="추가로 확인할 사항이 없습니다."
        />
      </div>
      <SourceBlock />
    </article>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="type-caption text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 type-label font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function ScoreBlock({ bid }: { bid: DemoBid }) {
  const noteId = `${bid.id}-score-note`;
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-muted-foreground">SOL Score</h4>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="type-headline text-foreground tabular-nums">{bid.score}</span>
        <span className="type-label text-muted-foreground">/ 100</span>
      </p>
      <div
        role="meter"
        aria-label="SOL Score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bid.score}
        aria-describedby={noteId}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${bid.score}%` }} />
      </div>
      <p id={noteId} className="mt-3 type-caption text-muted-foreground">
        SOL Score는 사업 적합도이며 수주 확률이 아닙니다.
      </p>
    </div>
  );
}

function RecommendationBlock({ bid }: { bid: DemoBid }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-muted-foreground">참여 권고</h4>
      <RecommendationBadge value={bid.recommendation} size="md" className="mt-2" />
      <p className="mt-3 type-body text-foreground">{bid.recommendationReason}</p>
      <p className="mt-2 type-caption text-muted-foreground">
        권고는 참고 의견입니다. 최종 참여 여부는 담당자가 결정합니다.
      </p>
    </div>
  );
}

function QualificationBlock({ bid }: { bid: DemoBid }) {
  const { SATISFIED, NEEDS_REVIEW, NOT_SATISFIED } = bid.counts;
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h4 className="type-label font-medium text-foreground">참가 자격 검토</h4>
        <p className="type-caption text-muted-foreground">
          충족 {SATISFIED} · 확인 필요 {NEEDS_REVIEW} · 미충족 {NOT_SATISFIED}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {bid.checks.map((check) => (
          <li
            key={check.requirement}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-2.5"
          >
            <QualificationLabel status={check.status} />
            <div>
              <p className="type-label font-medium text-foreground">{check.requirement}</p>
              <p className="type-caption text-muted-foreground">{check.note}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-foreground">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 type-body text-foreground marker:text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 type-body text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

// 원문 연결 자리. 예시 공고에는 원문이 없어 링크를 만들지 않는다(가짜 주소·href="#" 금지).
function SourceBlock() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <Link2OffIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="type-caption text-muted-foreground">
        <span className="font-medium text-foreground">공고 원문</span> · 예시 공고라 연결할 원문이
        없습니다. 실제 서비스에서는 이 자리에 공고 원문과 첨부문서를 연결할 예정입니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm -C web exec vitest run --config vitest.browser.config.ts components/landing/product-preview.browser.test.tsx`
Expected: PASS (5 tests). 방향키 시험이 실패하면 Base UI Tabs의 세로 방향 키(`ArrowDown`)와 `activateOnFocus` 동작을 `web/node_modules/@base-ui/react/tabs/list/TabsList.d.ts`에서 확인하고 부품을 고친다(시험을 약하게 바꾸지 않는다).

- [ ] **Step 6: 서식·타입·린트·색·구조**

Run: `pnpm -C web format && pnpm -C web type-check && pnpm -C web lint && pnpm check:colors && pnpm -C web lodestar`
Expected: 통과.

- [ ] **Step 7: 커밋**

```bash
git add web/components/landing/status-badges.tsx web/components/landing/product-preview.tsx web/components/landing/product-preview.browser.test.tsx
git commit -m "feat(web): 랜딩 제품 분석 미리보기 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 마케팅 틀·히어로·미리보기 배치와 SEO

**Files:**
- Create: `web/components/landing/landing-links.ts`, `web/components/landing/landing-links.test.ts`
- Create: `web/components/landing/desktop-notice.tsx`, `web/components/landing/hero.tsx`, `web/components/landing/product-preview-section.tsx`
- Modify: `web/components/site-header.tsx` (통째 교체), `web/components/site-footer.tsx` (통째 교체)
- Modify: `web/app/page.tsx` (통째 교체)
- Create: `web/e2e/sticky-header.ts`
- Rewrite: `web/e2e/landing.spec.ts`, `web/e2e/site-header.spec.ts`
- Modify: `web/e2e/home.spec.ts`, `web/e2e/responsive.spec.ts`, `web/e2e/operations.spec.ts`

**Interfaces:**
- Consumes: Task 3 `ProductPreview`. `@/server/organization`의 `getMyHome(): Promise<MyHome>`, `type MyHome = { status: "no-database" } | { status: "signed-out" } | { status: "missing" } | { status: "ready"; personalSlug: string }`.
- Produces:
  - `SECTION_LINKS: readonly { href: "/#features" | "/#analysis" | "/#about"; label: string }[]`, `DEMO_HREF = "/#demo"`, `LOGIN_HREF = "/auth/login"`, `SIGN_UP_HREF = "/auth/sign-up"`, `startHrefFor(home: MyHome): string`
  - `SiteHeader({ startHref: string })`, `SiteFooter()`, `Hero({ startHref: string })`, `ProductPreviewSection()`(`<section id="demo">`, h2 "공고 분석 예시"), `DesktopNotice()`
  - e2e 도우미 `boxOf(locator)`, `expectBelowHeader(page, target)` (`web/e2e/sticky-header.ts`, Task 5·6이 쓴다)
  - 구역 id 규칙: 모든 구역 `<section>`은 `scroll-mt-20`을 갖는다(머리말 높이 64px + 여유).

- [ ] **Step 1: Next.js 16 문서 읽기** — 아래를 읽고 이 태스크 코드와 다르면 문서를 따른다.
  - `web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` (정적 `metadata`의 `title`·`description`·`openGraph`)
  - `web/node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`의 `scroll-behavior` 절(Next 16은 `scroll-behavior`를 덮어쓰지 않는다. 이 계획은 부드러운 스크롤을 쓰지 않는다)

- [ ] **Step 2: 실패하는 시험 — `landing-links.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { startHrefFor } from "@/components/landing/landing-links";

// 시작하기의 목적지. 로그인해 개인 조직이 있으면 대시보드로 바로 가고, 그 밖은 가입 화면에서 시작한다.
describe("startHrefFor", () => {
  it("로그인해 개인 조직이 있으면 그 조직의 대시보드로 간다", () => {
    expect(startHrefFor({ status: "ready", personalSlug: "kim" })).toBe("/kim/dashboard");
  });

  it.each(["signed-out", "no-database", "missing"] as const)("%s 이면 가입 화면으로 간다", (status) => {
    expect(startHrefFor({ status })).toBe("/auth/sign-up");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm -C web exec vitest run components/landing/landing-links.test.ts`
Expected: FAIL — 모듈을 찾지 못함.

- [ ] **Step 4: 구현 — `landing-links.ts`**

```ts
import type { MyHome } from "@/server/organization";

// 첫 화면 구역으로 가는 링크. 머리말·바닥글이 같이 쓴다. id 는 각 구역 부품(components/landing/*-section.tsx)이 갖는다.
// 메뉴 이름과 구역의 짝: 주요 기능 → 기능 소개, 분석 방식 → 작동 방식(바로 뒤에 분석 원칙), 서비스 소개 → 문제 공감.
export const SECTION_LINKS = [
  { href: "/#features", label: "주요 기능" },
  { href: "/#analysis", label: "분석 방식" },
  { href: "/#about", label: "서비스 소개" },
] as const;

export const DEMO_HREF = "/#demo";
export const LOGIN_HREF = "/auth/login";
export const SIGN_UP_HREF = "/auth/sign-up";

// 로그인했지만 개인 조직이 없는 계정(missing)도 가입 화면으로 보낸다. 가입 화면이 로그인 화면으로 넘기고, 로그인 화면이 안내한다.
export const startHrefFor = (home: MyHome): string =>
  home.status === "ready" ? `/${home.personalSlug}/dashboard` : SIGN_UP_HREF;
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm -C web exec vitest run components/landing/landing-links.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: e2e 도우미 — `web/e2e/sticky-header.ts`**

```ts
import { expect, type Locator, type Page } from "@playwright/test";

export const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("화면에 그려지지 않은 요소의 자리를 재려 했다");
  return box;
};

// 첫 화면의 머리말은 화면 위에 붙어 있다(sticky). 구역으로 옮겨 간 뒤 대상이 머리말 밑에 깔리지 않았는지 본다.
export const expectBelowHeader = async (page: Page, target: Locator) => {
  await expect(target).toBeInViewport();
  const header = await boxOf(page.getByRole("banner"));
  const box = await boxOf(target);
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
};
```

- [ ] **Step 7: 실패하는 e2e — `web/e2e/landing.spec.ts` 통째 교체**

```ts
import { expect, test, type Page } from "@playwright/test";
// 워드마크의 정본. 이름을 여기에 따로 적으면 project.json 을 바꿀 때 깨진다.
import project from "@/project.json";
import { expectBelowHeader } from "./sticky-header";

// 첫 화면(랜딩). 데스크톱 전용이라(docs/16-DECISIONS.md ADR-007) 1440px 을 기본으로 본다. 로그인·DB 없이 열린다.
// 같은 이름의 링크(시작하기·분석 예시 보기·로그인·메뉴·로고)가 머리말·본문·바닥글에 같이 있다. 랜드마크·구역 안에서 찾는다.
// 머리말은 site-header.spec.ts 가, 히어로 아래 구역은 landing-sections.spec.ts 가 본다.

test.use({ viewport: { width: 1440, height: 900 } });

const heroOf = (page: Page) => page.getByRole("region", { name: /수많은 공고 속/ });
const previewOf = (page: Page) => page.getByRole("region", { name: "공고 분석 예시" });

test("제목과 설명 메타데이터가 SOL RADAR 의 것이다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("SOL RADAR — 공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /수주 확률이 아닙니다/,
  );
});

test("히어로에 보조 문구·제목·설명·두 버튼·안내가 있고, 시작하기는 가입 화면으로 간다", async ({
  page,
}) => {
  await page.goto("/");
  const hero = heroOf(page);
  await expect(hero.getByText("공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원")).toBeVisible();
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText(
    /수많은 공고 속,\s*우리 회사가 검토할 사업부터\./,
  );
  await expect(hero.getByText(/참가 자격, 사업 적합도, 추가 확인 사항을 한눈에/)).toBeVisible();
  await expect(hero.getByRole("listitem")).toHaveText([
    "공식 API 기반 수집",
    /근거 중심 분석/,
    /담당자의 최종 결정/,
  ]);
  await expect(hero.getByRole("link", { name: "분석 예시 보기" })).toHaveAttribute(
    "href",
    "/#demo",
  );
  const start = hero.getByRole("link", { name: "시작하기", exact: true });
  await expect(start).toHaveAttribute("href", "/auth/sign-up");
  await start.click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  // DB 설정이 없는 빌드는 가입 폼 대신 연결 안내를 그린다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(회원가입|DB 가 연결되지 않았습니다)$/,
  );
});

test("분석 예시 보기를 누르면 미리보기로 가고, 머리말에 가리지 않는다", async ({ page }) => {
  await page.goto("/");
  await heroOf(page).getByRole("link", { name: "분석 예시 보기" }).click();
  await expect(page).toHaveURL(/\/#demo$/);
  await expectBelowHeader(page, previewOf(page).getByRole("tablist"));
});

test("미리보기는 예시 데이터라고 밝히고, 대표 예시의 점수·자격·권고가 맞는다", async ({ page }) => {
  await page.goto("/");
  const preview = previewOf(page);
  await expect(preview.getByText("예시 데이터").first()).toBeVisible();
  await expect(preview.getByText(/가상의 공고와 기업 정보로 만든 예시 화면/)).toBeVisible();
  const panel = preview.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "공공기관 업무지원 시스템 고도화" })).toBeVisible();
  for (const term of ["기관명", "사업 예산", "제안서 마감"]) {
    await expect(panel.getByText(term, { exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("meter", { name: "SOL Score" })).toHaveAttribute(
    "aria-valuenow",
    "82",
  );
  await expect(panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다.")).toBeVisible();
  await expect(panel.getByText("WATCH", { exact: true })).toBeVisible();
  await expect(panel.getByText("충족 2 · 확인 필요 1 · 미충족 0")).toBeVisible();
  await expect(panel.getByText(/유사 사업 실적 보유/)).toBeVisible();
  await expect(panel.getByText(/주요 기술 요구사항 부합/)).toBeVisible();
  await expect(panel.getByText("필수 증빙의 유효기간 확인 필요")).toBeVisible();
  // 원문 자리는 링크가 아니다. 예시 공고를 실제 공고처럼 꾸미지 않는다.
  await expect(preview.getByRole("link")).toHaveCount(0);
});

test("목록에서 다른 공고를 고르면 분석이 바뀐다", async ({ page }) => {
  await page.goto("/");
  const preview = previewOf(page);
  await preview.getByRole("tab", { name: /통합 민원 포털 기능 개선/ }).click();
  const panel = preview.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "통합 민원 포털 기능 개선" })).toBeVisible();
  await expect(panel.getByRole("meter", { name: "SOL Score" })).toHaveAttribute(
    "aria-valuenow",
    "88",
  );
  await expect(panel.getByText("BID", { exact: true })).toBeVisible();
});

[1280, 1440, 1920].forEach((width) =>
  test(`${width}px 폭에서 가로로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  }),
);

test("1280px 미만에서만 데스크톱 화면 안내가 보인다", async ({ page }) => {
  const notice = page.getByRole("note").filter({ hasText: "데스크톱 화면" });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await expect(notice).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(notice).toBeHidden();
});

// 등장 애니메이션은 motion-safe 에만 걸려 있다. 움직임 줄이기를 켜면 하나도 남지 않아야 한다.
const animatedCount = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("body *")].filter(
        (element) => getComputedStyle(element).animationName !== "none",
      ).length,
  );

test("움직임 줄이기를 켜면 등장 애니메이션이 하나도 없다", async ({ page }) => {
  await page.goto("/");
  // 먼저 애니메이션이 실제로 있는지 본다. 없으면 아래 단언이 늘 통과해 아무것도 지키지 못한다.
  expect(await animatedCount(page)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animatedCount(page)).toBe(0);
});

const FOOTER_GROUPS = [
  {
    title: "둘러보기",
    links: [
      { name: "주요 기능", href: "/#features" },
      { name: "분석 방식", href: "/#analysis" },
      { name: "서비스 소개", href: "/#about" },
    ],
  },
  {
    title: "계정",
    links: [
      { name: "로그인", href: "/auth/login" },
      { name: "회원가입", href: "/auth/sign-up" },
      { name: "비밀번호 재설정", href: "/auth/reset" },
    ],
  },
];

test("바닥글에 로고·한 줄 소개·메뉴·저작권이 있고, 없는 정책 화면으로 가는 링크는 없다", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: project.title, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(footer.getByText(project.description)).toBeVisible();
  await expect(footer.getByText(`© 2026 ${project.title}`)).toBeVisible();
  const nav = footer.getByRole("navigation", { name: "바닥글 메뉴" });
  for (const { title, links } of FOOTER_GROUPS) {
    const group = nav.getByRole("list", { name: title, exact: true });
    for (const { name, href } of links) {
      await expect(group.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
  }
  await expect(footer.getByRole("link", { name: /약관|개인정보/ })).toHaveCount(0);
});
```

- [ ] **Step 8: `web/e2e/site-header.spec.ts` 통째 교체**

```ts
import { expect, test } from "@playwright/test";
// 워드마크의 정본. 이름을 여기에 따로 적으면 project.json 을 바꿀 때 깨진다.
import project from "@/project.json";
import { boxOf } from "./sticky-header";

// 첫 화면(/)만 쓰는 마케팅 머리말. 데스크톱 전용이라(ADR-007) 좁은 폭용 메뉴가 없다. 기본 폭은 Desktop Chrome(1280px)이다.
// 같은 이름의 링크(로그인·시작하기·메뉴·로고)가 본문과 바닥글에도 있다. 머리말(banner) 안에서 찾는다.
// 메뉴를 눌러 구역으로 옮겨 가는 것은 landing-sections.spec.ts 가 본다(구역이 거기서 생긴다).
const ACCOUNT_LINKS = [
  { name: "로그인", href: "/auth/login" },
  { name: "시작하기", href: "/auth/sign-up" },
];
const SECTION_LINKS = [
  { name: "주요 기능", href: "/#features" },
  { name: "분석 방식", href: "/#analysis" },
  { name: "서비스 소개", href: "/#about" },
];

test("머리말의 로고는 첫 화면으로, 로그인·시작하기는 계정 화면으로 간다", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: project.title, exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  for (const { name, href } of ACCOUNT_LINKS) {
    const link = header.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }
});

test("주요 메뉴에 구역 링크 세 개가 차례대로 있다", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("banner").getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav.getByRole("link")).toHaveText(SECTION_LINKS.map(({ name }) => name));
  for (const { name, href } of SECTION_LINKS) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
});

test("첫 Tab 에 건너뛰기 링크가 보이고 누르면 본문으로 간다", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  // not-sr-only 가 높이·안쪽 여백을 되돌리지 않는지: 누를 수 있는 크기여야 한다.
  const box = await skip.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  // 다음 Tab 은 머리말의 링크가 아니라 본문의 첫 링크(히어로의 시작하기)다.
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("region", { name: /수많은 공고 속/ })
      .getByRole("link", { name: "시작하기", exact: true }),
  ).toBeFocused();
});

// 인증 틀(로그인·안내·없는 주소)도 같은 건너뛰기 링크를 쓴다. 없는 주소는 DB 없이 인증 틀을 그린다.
// 한 마디 주소(/<이름>)는 조직 주소(/[slug])라 404 가 아니다. 없는 주소는 조직 아래의 없는 화면으로 쓴다.
test("인증 틀에서도 건너뛰기 링크가 본문(main)으로 간다", async ({ page }) => {
  await page.goto("/acme/route-that-does-not-exist");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.getByRole("main")).toBeFocused();
});

test("1280px 에서 머리말이 한 줄이고 로고·메뉴·버튼이 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const names = [project.title, ...SECTION_LINKS.map(({ name }) => name), "로그인", "시작하기"];
  const items = names.map((name) => header.getByRole("link", { name, exact: true }));
  for (const item of items) await expect(item).toBeVisible();
  const boxes = await Promise.all(items.map(boxOf));
  // 한 줄이면 세로 가운데가 같다(로고와 버튼은 높이가 달라 위쪽 선은 다르다).
  const centers = boxes.map((box) => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  // 서로 겹치지 않고 화면 안에 차례로 놓인다.
  const edges = boxes.flatMap((box) => [box.x, box.x + box.width]);
  expect(edges).toEqual([...edges].sort((a, b) => a - b));
  expect(edges[0]).toBeGreaterThanOrEqual(0);
  expect(edges[edges.length - 1]).toBeLessThanOrEqual(1280);
});

test("아래로 내려도 머리말이 화면 맨 위에 붙어 있다", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const header = page.getByRole("banner");
  await expect(header).toBeInViewport();
  expect((await boxOf(header)).y).toBe(0);
});
```

- [ ] **Step 9: 나머지 e2e 손질**
  - `web/e2e/home.spec.ts`: `await expect(page.getByRole("main")).toContainText("/setup");`을 `await expect(page.getByRole("main")).toContainText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다.");`로 바꾼다.
  - `web/e2e/responsive.spec.ts`: `PATHS`의 `"/",` 줄을 지우고, 파일 머리 주석 첫 줄 아래에 다음 두 줄을 넣는다.
    ```ts
    // 첫 화면(/)은 데스크톱 전용이라(docs/16-DECISIONS.md ADR-007) 여기서 재지 않는다.
    // 1280·1440·1920px 넘침은 landing.spec.ts 가 본다.
    ```
  - `web/e2e/operations.spec.ts`(130행 근처): `const start = page.getByRole("main").getByRole("link", { name: "시작하기", exact: true });`를 아래로 바꾼다(Task 6 뒤에는 본문에 시작하기가 둘이다).
    ```ts
    const start = page
      .getByRole("region", { name: /수많은 공고 속/ })
      .getByRole("link", { name: "시작하기", exact: true });
    ```

- [ ] **Step 10: e2e 실패 확인**

Run: `pnpm -C web build && pnpm -C web exec playwright test e2e/landing.spec.ts e2e/site-header.spec.ts`
Expected: FAIL — 지금 랜딩에는 "수많은 공고 속" 구역·"공고 분석 예시" 구역·새 메뉴가 없다.

- [ ] **Step 11: 구현 — `desktop-notice.tsx`**

```tsx
import { MonitorIcon } from "lucide-react";

// 데스크톱 전용(docs/06-UI-UX.md §1, docs/16-DECISIONS.md ADR-007). 1280px 미만 레이아웃은 만들지 않고 이 안내만 띄운다.
export function DesktopNotice() {
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 type-label text-muted-foreground xl:hidden"
    >
      <MonitorIcon aria-hidden className="size-4 shrink-0" />
      SOL RADAR는 데스크톱 화면(1280px 이상)에 맞춰 만들었습니다. 좁은 화면에서는 일부가 잘리거나
      가로로 스크롤될 수 있습니다.
    </div>
  );
}
```

- [ ] **Step 12: 구현 — `hero.tsx`**

```tsx
import { cn } from "cn";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { buttonVariants } from "@/components/ui/button";

const PROMISES = ["공식 API 기반 수집", "근거 중심 분석", "담당자의 최종 결정"];

// 첫 화면의 머리 구역. 미리보기(ProductPreviewSection)가 바로 아래에 붙어 화면의 중심이 된다.
// 제목은 한 줄에 다 들어가지 않아 줄을 직접 나눈다 — 자동 줄바꿈은 "사업부터." 만 다음 줄로 떨어뜨린다.
export function Hero({ startHref }: { startHref: string }) {
  return (
    <section aria-labelledby="hero-title" className="px-8 pt-20 pb-12">
      <div className="mx-auto w-full max-w-6xl motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
        <p className="type-label font-medium text-brand">
          공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원
        </p>
        <h1 id="hero-title" className="mt-4 type-display text-foreground">
          수많은 공고 속,
          <br />
          우리 회사가 검토할 사업부터.
        </h1>
        <p className="mt-6 max-w-2xl type-lead text-muted-foreground">
          기업의 기술·자격·실적과 공고 요구사항을 비교해
          <br />
          참가 자격, 사업 적합도, 추가 확인 사항을 한눈에 확인하세요.
        </p>
        {/* 주요 버튼(default)은 시작하기 하나다. 분석 예시 보기는 테두리 버튼으로 낮춘다. */}
        <div className="mt-8 flex items-center gap-3">
          <Link href={startHref} className={buttonVariants({ size: "lg" })}>
            시작하기
          </Link>
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          <Link href={DEMO_HREF} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            분석 예시 보기
          </Link>
        </div>
        <ul className="mt-6 flex items-center gap-2 type-label text-muted-foreground">
          {PROMISES.map((promise, index) => (
            <li key={promise} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden>·</span>}
              {promise}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 13: 구현 — `product-preview-section.tsx`**

```tsx
import { ProductPreview } from "@/components/landing/product-preview";

// 분석 예시 보기(/#demo)가 오는 자리. 히어로 바로 아래에서 화면의 중심을 차지한다.
// 제목은 화면 낭독기용이다 — 보이는 이름은 미리보기 머리와 아래 설명이 대신한다.
export function ProductPreviewSection() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 px-8 pb-24">
      <div className="mx-auto w-full max-w-6xl motion-safe:animate-in motion-safe:delay-150 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
        <h2 id="demo-title" className="sr-only">
          공고 분석 예시
        </h2>
        <figure>
          <ProductPreview />
          <figcaption className="mt-3 type-caption text-muted-foreground">
            가상의 공고와 기업 정보로 만든 예시 화면입니다. 실제 공고·기관과 관계없고, 숫자는 화면
            설명을 위한 값입니다.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
```

- [ ] **Step 14: 구현 — `web/components/site-header.tsx` 통째 교체**

```tsx
import Link from "next/link";
import { LOGIN_HREF, SECTION_LINKS } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

// 첫 화면의 마케팅 머리말. 화면 위에 붙어 따라온다(sticky) — 구역은 scroll-mt-20 으로 머리말 높이만큼 내려앉는다.
// 시작하기의 목적지는 로그인 상태를 읽는 app/page.tsx 가 정해 내려 준다. 이 부품은 로그인 상태를 읽지 않는다.
// 데스크톱 전용(docs/16-DECISIONS.md ADR-007)이라 좁은 폭용 메뉴를 두지 않는다. 현재 위치 표시는 하지 않는다.
export function SiteHeader({ startHref }: { startHref: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-8 backdrop-blur-sm">
      {/* 가운데 칸이 메뉴다. 양쪽 칸을 같은 비율(1fr)로 두어 메뉴가 화면 가운데에 온다. */}
      <div className="mx-auto grid min-h-16 w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-6">
        <Link
          href="/"
          className="min-w-0 justify-self-start rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav aria-label="주요 메뉴">
          <ul className="flex items-center gap-1">
            {SECTION_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1 justify-self-end">
          <Link href={LOGIN_HREF} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            로그인
          </Link>
          <Link href={startHref} className={buttonVariants({ size: "sm" })}>
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 15: 구현 — `web/components/site-footer.tsx` 통째 교체**

```tsx
import Link from "next/link";
import { LOGIN_HREF, SECTION_LINKS, SIGN_UP_HREF } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
// 루트 layout 의 metadata 와 같은 글을 쓴다.
import project from "@/project.json";

// 실제로 있는 경로만 적는다 — 없는 주소나 바깥 주소를 넣지 않는다.
// 이용약관·개인정보처리방침 화면은 아직 없어 링크를 두지 않는다. 화면이 생기면 여기에 묶음을 더한다.
// 회사 주소·사업자번호·연락처·SNS 는 정해진 것이 없어 적지 않는다.
const GROUPS = [
  { id: "footer-sections", title: "둘러보기", links: SECTION_LINKS },
  {
    id: "footer-account",
    title: "계정",
    links: [
      { href: LOGIN_HREF, label: "로그인" },
      { href: SIGN_UP_HREF, label: "회원가입" },
      { href: "/auth/reset", label: "비밀번호 재설정" },
    ],
  },
] as const;

// 저작권 연도는 서비스를 처음 공개한 해다. 해마다 바꾸지 않는다.
const FIRST_PUBLISHED_YEAR = 2026;

// 로그인 상태를 읽지 않는 정적 부품이다. 바탕은 새 색을 만들지 않고 foreground·background 토큰을 맞바꿔 쓴다.
// 초점 링도 파란 ring 대신 밝은 색을 쓴다 — 어두운 바탕에서는 파랑이 잘 보이지 않는다.
export function SiteFooter() {
  return (
    <footer className="bg-foreground px-8 py-12 text-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-5 flex flex-col items-start gap-3">
            <Link
              href="/"
              className="max-w-full rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-background/60"
            >
              <Logo inverted />
            </Link>
            <p className="type-label text-background/70">{project.description}</p>
          </div>
          <nav aria-label="바닥글 메뉴" className="col-span-6 col-start-7 grid grid-cols-2 gap-8">
            {GROUPS.map((group) => (
              <div key={group.id}>
                {/* 묶음 이름은 제목 요소로 쓰지 않는다. 첫 화면의 제목 차례(h1·h2·h3)에 끼어들지 않고 목록의 이름만 된다. */}
                <p id={group.id} className="type-label font-medium text-background">
                  {group.title}
                </p>
                <ul aria-labelledby={group.id} className="mt-3 flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="inline-block rounded-sm py-1 type-label text-background/70 outline-none hover:text-background focus-visible:ring-3 focus-visible:ring-background/60"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="border-t border-background/15 pt-8 type-caption text-background/70">
          © {FIRST_PUBLISHED_YEAR} {project.title}
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 16: 구현 — `web/app/page.tsx` 통째 교체**

```tsx
import type { Metadata } from "next";
import { DesktopNotice } from "@/components/landing/desktop-notice";
import { Hero } from "@/components/landing/hero";
import { startHrefFor } from "@/components/landing/landing-links";
import { ProductPreviewSection } from "@/components/landing/product-preview-section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMyHome } from "@/server/organization";

const TITLE = "SOL RADAR — 공공 SI·AX 기업을 위한 AI 입찰 의사결정 지원";
const DESCRIPTION =
  "기업의 기술·자격·실적과 공고 요구사항을 비교해 참가 자격, 사업 적합도, 추가 확인 사항을 근거와 함께 정리합니다. SOL Score는 적합도 지표이며 수주 확률이 아닙니다.";

// og 이미지는 두지 않는다 — 절대 주소(metadataBase)가 아직 없다(app/layout.tsx 주석).
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "ko_KR",
    siteName: "SOL RADAR",
  },
};

// 시작하기의 목적지 때문에 로그인 상태를 읽는다. 어떻게 읽고 DB 가 없을 때 무엇을 돌려줄지는 도메인(getMyHome)이 정한다.
// 루트 layout 이 CSP nonce 때문에 모든 화면을 요청마다 그리므로, 여기서 로그인 상태를 읽어도 정적 렌더링을 잃지 않는다.
export default async function Home() {
  const startHref = startHrefFor(await getMyHome());
  return (
    <>
      <DesktopNotice />
      <SiteHeader startHref={startHref} />
      {/* 루트 layout 의 건너뛰기 링크가 여기로 온다. 머리말을 지나 본문부터 Tab 이 이어진다. */}
      {/* 바탕(muted 의 절반) 위에서 흰 카드가 드러난다. 구역 사이는 선 없이 여백으로만 나눈다. */}
      <main id="main-content" tabIndex={-1} className="flex-1 bg-muted/50 outline-none">
        <Hero startHref={startHref} />
        <ProductPreviewSection />
      </main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 17: e2e 통과 확인**

Run: `pnpm -C web format && pnpm -C web build && pnpm -C web exec playwright test e2e/landing.spec.ts e2e/site-header.spec.ts e2e/home.spec.ts e2e/operations.spec.ts e2e/responsive.spec.ts`
Expected: 모두 PASS. 바닥글의 `/#features`·`/#analysis`·`/#about`은 아직 갈 구역이 없다(Task 5에서 생긴다). 이 태스크의 시험은 href만 본다.

- [ ] **Step 18: 빠른 검증**

Run: `pnpm verify:quick`
Expected: 통과(서식·타입·린트·가드·단위 시험·lodestar·토큰·색).

- [ ] **Step 19: 커밋**

```bash
git add web/components/landing/landing-links.ts web/components/landing/landing-links.test.ts web/components/landing/desktop-notice.tsx web/components/landing/hero.tsx web/components/landing/product-preview-section.tsx web/components/site-header.tsx web/components/site-footer.tsx web/app/page.tsx web/e2e/sticky-header.ts web/e2e/landing.spec.ts web/e2e/site-header.spec.ts web/e2e/home.spec.ts web/e2e/responsive.spec.ts web/e2e/operations.spec.ts
git commit -m "feat(web): 랜딩 머리말·히어로·바닥글을 SOL RADAR로 교체" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 문제 공감·주요 기능·작동 방식·분석 원칙

**Files:**
- Create: `web/components/landing/section-heading.tsx`, `web/components/landing/icon-chip.tsx`
- Create: `web/components/landing/problem-section.tsx`
- Create: `web/components/landing/feature-previews.tsx`, `web/components/landing/features-section.tsx`
- Create: `web/components/landing/how-it-works-section.tsx`, `web/components/landing/principles-section.tsx`
- Modify: `web/app/page.tsx` (구역 4개 추가)
- Create: `web/e2e/landing-sections.spec.ts`

**Interfaces:**
- Consumes: Task 2 `DEMO_BIDS`·`formatDate`, Task 3 `PlannedBadge`·`QualificationLabel`, Task 4 `expectBelowHeader`·`scroll-mt-20` 규칙.
- Produces: `SectionHeading({ id, eyebrow, title, description?, className? })`, `IconChip({ icon: LucideIcon })`, 구역 `#about`(h2 "공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다."), `#features`(h2 "검토에 필요한 정보를 한 흐름으로 모읍니다"), `#analysis`(h2 "기업 정보를 등록하면, 검토할 사업이 명확해집니다."), `#principles`(h2 "점수만 보여주지 않고, 판단의 근거를 함께 제공합니다.").

- [ ] **Step 1: 실패하는 e2e — `web/e2e/landing-sections.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { expectBelowHeader } from "./sticky-header";

// 첫 화면의 히어로 아래 구역들. 데스크톱 전용이라 1440px 에서 본다. 구역은 h2 로 이름 붙은 region 이다.

test.use({ viewport: { width: 1440, height: 900 } });

const SECTIONS = [
  { link: "주요 기능", hash: "#features", title: "검토에 필요한 정보를 한 흐름으로 모읍니다" },
  {
    link: "분석 방식",
    hash: "#analysis",
    title: "기업 정보를 등록하면, 검토할 사업이 명확해집니다.",
  },
  {
    link: "서비스 소개",
    hash: "#about",
    title: "공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다.",
  },
];

SECTIONS.forEach(({ link, hash, title }) =>
  test(`머리말의 ${link} 링크는 그 구역으로 가고, 제목이 머리말에 가리지 않는다`, async ({
    page,
  }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 2, name: title });
    // 처음에는 화면 밖이어야 눌러서 옮겨 갔는지 알 수 있다.
    await expect(heading).not.toBeInViewport();
    await page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", { name: link, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${hash}$`));
    await expectBelowHeader(page, heading);
  }),
);

test("문제 공감 구역에 세 상황이 있다", async ({ page }) => {
  await page.goto("/");
  const about = page.getByRole("region", { name: SECTIONS[2].title });
  await expect(about.getByText("서비스 소개", { exact: true })).toBeVisible();
  await expect(about.getByRole("heading", { level: 3 })).toHaveText([
    /공고와 첨부문서/,
    /자격과 실적/,
    /판단 근거/,
  ]);
});

test("주요 기능은 네 가지이고, 모두 개발 예정이라고 밝힌다", async ({ page }) => {
  await page.goto("/");
  const features = page.getByRole("region", { name: SECTIONS[0].title });
  await expect(features.getByRole("heading", { level: 3 })).toHaveText([
    "공고 수집과 탐색",
    "기업 프로필 기반 자격 검토",
    "SOL Score와 판단 근거",
    "검토 이력과 변경 알림",
  ]);
  await expect(features.getByText("개발 예정", { exact: true })).toHaveCount(4);
  await expect(features.getByRole("note")).toContainText("아직 이용할 수 없습니다");
});

test("작동 방식은 세 단계이고, 단계마다 하는 일과 얻는 것이 있다", async ({ page }) => {
  await page.goto("/");
  const analysis = page.getByRole("region", { name: SECTIONS[1].title });
  await expect(analysis.getByRole("heading", { level: 3 })).toHaveText([
    "기업 프로필 등록",
    "공고와 요구사항 비교",
    "근거 확인 후 참여 결정",
  ]);
  const steps = analysis.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  for (const step of await steps.all()) {
    await expect(step).toContainText("하는 일");
    await expect(step).toContainText("얻는 것");
  }
});

test("분석 원칙 네 가지가 있다", async ({ page }) => {
  await page.goto("/");
  const principles = page.getByRole("region", {
    name: "점수만 보여주지 않고, 판단의 근거를 함께 제공합니다.",
  });
  await expect(principles.getByRole("heading", { level: 3 })).toHaveText([
    "원문과 근거를 연결합니다",
    "확인된 정보와 확인이 필요한 정보를 나눕니다",
    "적합도와 수주 확률을 구분합니다",
    "AI 권고와 최종 결정을 구분합니다",
  ]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C web build && pnpm -C web exec playwright test e2e/landing-sections.spec.ts`
Expected: FAIL — 구역이 없다.

- [ ] **Step 3: 구현 — `section-heading.tsx`**

```tsx
import { cn } from "cn";

// 구역 머리: 작은 이름 + 제목(h2) + 설명. 구역(section)은 aria-labelledby 로 이 h2 의 id 를 가리킨다.
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <p className="type-label font-medium text-brand">{eyebrow}</p>
      <h2 id={id} className="mt-3 type-headline text-balance text-foreground">
        {title}
      </h2>
      {description && <p className="mt-4 type-lead text-muted-foreground">{description}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 구현 — `icon-chip.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";

// 구역 안 항목 앞의 아이콘 칸. 장식이라 화면 낭독기에서 숨긴다 — 뜻은 옆 제목이 말한다.
export function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-brand"
    >
      <Icon className="size-4" />
    </span>
  );
}
```

- [ ] **Step 5: 구현 — `problem-section.tsx`**

```tsx
import { FilesIcon, ListChecksIcon, UsersIcon } from "lucide-react";
import { IconChip } from "@/components/landing/icon-chip";
import { SectionHeading } from "@/components/landing/section-heading";
import { Card } from "@/components/ui/card";

const PAINS = [
  {
    icon: FilesIcon,
    title: "공고와 첨부문서를 반복해서 열어 봅니다",
    body: "발주계획·사전규격·입찰공고가 따로 올라오고, 요구사항은 첨부문서 곳곳에 흩어져 있습니다.",
  },
  {
    icon: ListChecksIcon,
    title: "자격과 실적을 매번 손으로 대조합니다",
    body: "참가 자격과 수행 실적 요건을 회사 자료와 하나씩 맞춰 보는 일이 공고마다 되풀이됩니다.",
  },
  {
    icon: UsersIcon,
    title: "판단 근거가 담당자마다 흩어집니다",
    body: "왜 참여하거나 포기했는지가 메일과 메모에 남아, 다음 검토에서 다시 찾기 어렵습니다.",
  },
];

// 머리말의 "서비스 소개"(/#about)가 오는 자리. 마지막 문장이 다음 구역(주요 기능)으로 잇는다.
export function ProblemSection() {
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-x-8 gap-y-10">
        <SectionHeading
          id="about-title"
          eyebrow="서비스 소개"
          title="공고 검색보다 오래 걸리는 건, 참여 여부를 판단하는 일입니다."
          className="col-span-5"
        />
        <Card className="col-span-7 gap-0 py-0">
          <ul className="divide-y divide-border">
            {PAINS.map((pain) => (
              <li key={pain.title} className="flex gap-4 px-6 py-5">
                <IconChip icon={pain.icon} />
                <div>
                  <h3 className="type-heading text-foreground">{pain.title}</h3>
                  <p className="mt-1 type-body text-muted-foreground">{pain.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <p className="col-span-7 col-start-6 type-lead text-foreground">
          SOL RADAR는 이 과정을 하나의 검토 흐름으로 묶습니다. 공고를 모으고, 회사 정보와 대조하고,
          판단 근거와 함께 검토 순서를 정리합니다.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: 구현 — `feature-previews.tsx`**

```tsx
import { cn } from "cn";
import { BellRingIcon, MessageSquareTextIcon, SearchIcon, UserCheckIcon } from "lucide-react";
import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { formatDate } from "@/components/landing/format";
import { QualificationLabel } from "@/components/landing/status-badges";

// 주요 기능 카드 아래의 작은 제품 그림. 화면 낭독기에서 숨기고(aria-hidden) 초점을 막는다(inert) — 쓰는 쪽이 감싼다.
// 숫자와 공고는 미리보기와 같은 예시 데이터(demo-bids.ts)에서 가져온다. 따로 적으면 미리보기와 어긋난다.

const STAGES = ["발주계획", "사전규격", "입찰공고"];
const [FEATURED] = DEMO_BIDS;

export function CollectPreview() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 type-label text-muted-foreground">
          <SearchIcon className="size-3.5" />
          공고명·기관 검색
        </div>
        {STAGES.map((stage) => (
          <span
            key={stage}
            className={cn(
              "rounded-md border bg-background px-2 py-1 type-caption",
              stage === "입찰공고"
                ? "border-brand/40 text-brand"
                : "border-border text-muted-foreground",
            )}
          >
            {stage}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {DEMO_BIDS.map((bid) => (
          <li key={bid.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate type-label font-medium text-foreground">
                {bid.title}
              </span>
              <span className="type-caption text-muted-foreground">{bid.agency}</span>
            </span>
            <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
              마감 {formatDate(bid.proposalDue)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 세 상태를 한 번씩 보여 준다. 예시 공고의 자격 항목에서 상태마다 첫 항목을 고른다.
const SAMPLE_CHECKS = (["SATISFIED", "NEEDS_REVIEW", "NOT_SATISFIED"] as const)
  .map((status) => DEMO_BIDS.flatMap((bid) => bid.checks).find((check) => check.status === status))
  .filter((check) => check !== undefined);

export function QualifyPreview() {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-background">
      {SAMPLE_CHECKS.map((check) => (
        <li
          key={check.requirement}
          className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3 px-3 py-2.5"
        >
          <QualificationLabel status={check.status} />
          <span>
            <span className="block type-label font-medium text-foreground">
              {check.requirement}
            </span>
            <span className="type-caption text-muted-foreground">{check.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScorePreview() {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate type-label font-medium text-foreground">{FEATURED.title}</span>
        <span className="shrink-0 type-heading text-foreground tabular-nums">
          {FEATURED.score}
          <span className="ml-1 type-caption font-normal text-muted-foreground">/ 100</span>
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {FEATURED.factors.map((factor) => (
          <li
            key={factor.label}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3 type-caption"
          >
            <span className="text-muted-foreground">{factor.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${(factor.points / factor.max) * 100}%` }}
              />
            </span>
            <span className="text-right text-foreground tabular-nums">
              {factor.points}/{factor.max}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 type-caption text-muted-foreground">적합도 지표 · 수주 확률 아님</p>
    </div>
  );
}

// 대표 예시(WATCH)의 이력이다. 사람이 아직 결정하지 않았다는 것까지 보여 준다.
const EVENTS = [
  { icon: BellRingIcon, kind: "변경 알림", text: "첨부문서 1건이 추가되었습니다.", time: "10. 16. 09:12" },
  {
    icon: MessageSquareTextIcon,
    kind: "검토 의견",
    text: "필수 증빙의 유효기간을 발급기관에 확인하고 있습니다.",
    time: "10. 16. 14:20",
  },
  { icon: UserCheckIcon, kind: "참여 결정", text: "권고 WATCH · 담당자 결정 전", time: "대기" },
];

export function HistoryPreview() {
  return (
    <div className="rounded-lg border border-border bg-background">
      <p className="truncate border-b border-border px-4 py-2.5 type-label font-medium text-foreground">
        {FEATURED.title}
      </p>
      <ol className="flex flex-col gap-3 px-4 py-3">
        {EVENTS.map((event) => (
          <li key={event.kind} className="flex items-start gap-3">
            <event.icon className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block type-caption font-medium text-foreground">{event.kind}</span>
              <span className="type-caption text-muted-foreground">{event.text}</span>
            </span>
            <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
              {event.time}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 7: 구현 — `features-section.tsx`**

```tsx
import { cn } from "cn";
import {
  ClipboardCheckIcon,
  GaugeIcon,
  HistoryIcon,
  InfoIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CollectPreview,
  HistoryPreview,
  QualifyPreview,
  ScorePreview,
} from "@/components/landing/feature-previews";
import { IconChip } from "@/components/landing/icon-chip";
import { SectionHeading } from "@/components/landing/section-heading";
import { PlannedBadge } from "@/components/landing/status-badges";
import { Card } from "@/components/ui/card";

type Feature = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  preview: React.ReactNode;
  span: string;
};

// 칸 너비를 엇갈려(7·5 / 5·7) 같은 카드가 줄지어 반복되지 않게 한다.
// 지금은 어느 기능도 구현되지 않았다(Phase 0 전). 카드마다 "개발 예정"을 붙이고, 구현되면 그 카드에서 뗀다.
const FEATURES: Feature[] = [
  {
    id: "collect",
    icon: SearchIcon,
    title: "공고 수집과 탐색",
    body: "발주계획·사전규격·입찰공고를 모아, 기관·예산·마감·사업 단계 같은 조건으로 좁혀 봅니다.",
    preview: <CollectPreview />,
    span: "col-span-7",
  },
  {
    id: "qualify",
    icon: ClipboardCheckIcon,
    title: "기업 프로필 기반 자격 검토",
    body: "보유 기술·자격·실적을 공고의 필수 요건과 대조해 충족·미충족·확인 필요로 나눠 표시합니다.",
    preview: <QualifyPreview />,
    span: "col-span-5",
  },
  {
    id: "score",
    icon: GaugeIcon,
    title: "SOL Score와 판단 근거",
    body: "적합도 점수를 요소별로 나누고 항목마다 근거를 붙여, 어떤 공고부터 검토할지 정하도록 돕습니다.",
    preview: <ScorePreview />,
    span: "col-span-5",
  },
  {
    id: "history",
    icon: HistoryIcon,
    title: "검토 이력과 변경 알림",
    body: "담당자의 의견과 참여 결정을 기록하고, 관심 공고의 마감·예산·첨부 변경을 알려 줍니다.",
    preview: <HistoryPreview />,
    span: "col-span-7",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto w-full max-w-6xl">
        <SectionHeading
          id="features-title"
          eyebrow="주요 기능"
          title="검토에 필요한 정보를 한 흐름으로 모읍니다"
          description="공고 수집부터 참여 결정 기록까지, 담당자가 되풀이하던 확인 작업을 줄이는 데 집중합니다."
        />
        <p
          role="note"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 type-label text-muted-foreground"
        >
          <InfoIcon aria-hidden className="size-4 shrink-0 text-brand" />
          SOL RADAR는 MVP를 개발하고 있습니다. 아래 기능은 모두 개발 예정이며 아직 이용할 수
          없습니다.
        </p>
        <ul className="mt-10 grid grid-cols-12 gap-6">
          {FEATURES.map((feature) => (
            <li key={feature.id} className={cn("flex", feature.span)}>
              <Card className="w-full gap-0 py-0 hover:shadow-sm motion-safe:transition-shadow">
                <div className="flex flex-col gap-3 p-6">
                  <div className="flex items-center justify-between gap-3">
                    <IconChip icon={feature.icon} />
                    <PlannedBadge />
                  </div>
                  <h3 className="type-heading text-foreground">{feature.title}</h3>
                  <p className="type-body text-muted-foreground">{feature.body}</p>
                </div>
                {/* 그림이다. 무엇을 그린 것인지는 위 제목과 설명이 말한다. */}
                <div aria-hidden inert className="mt-auto border-t border-border bg-muted/40 p-5">
                  {feature.preview}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: 구현 — `how-it-works-section.tsx`**

```tsx
import { SectionHeading } from "@/components/landing/section-heading";
import { Card } from "@/components/ui/card";

// 단계마다 사용자가 하는 일과 얻는 것을 나란히 적는다. 번호는 글자로만 쓴다(색 원 번호 금지, design-system).
const STEPS = [
  {
    title: "기업 프로필 등록",
    action: "보유 기술, 자격, 사업 실적을 한 번 입력합니다.",
    result: "공고마다 회사 자료를 다시 찾지 않아도 됩니다.",
  },
  {
    title: "공고와 요구사항 비교",
    action: "관심 공고를 고르고 분석을 요청합니다.",
    result: "참가 자격과 수행 조건을 회사 정보와 비교한 결과를 충족·미충족·확인 필요와 적합도 점수로 받습니다.",
  },
  {
    title: "근거 확인 후 참여 결정",
    action: "판단 근거와 추가 확인 사항을 검토하고 참여 여부를 정합니다.",
    result: "결정과 사유가 기록으로 남아 팀이 같은 근거를 봅니다.",
  },
];

// 머리말의 "분석 방식"(/#analysis)이 오는 자리. 바로 뒤에 분석 원칙 구역이 이어진다.
export function HowItWorksSection() {
  return (
    <section id="analysis" aria-labelledby="analysis-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto w-full max-w-6xl">
        <SectionHeading
          id="analysis-title"
          eyebrow="분석 방식"
          title="기업 정보를 등록하면, 검토할 사업이 명확해집니다."
        />
        <ol className="mt-12 grid grid-cols-3 gap-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex">
              <Card className="w-full gap-0 p-6">
                <p className="type-label font-medium text-brand">{index + 1}단계</p>
                <h3 className="mt-2 type-heading text-foreground">{step.title}</h3>
                <dl className="mt-4 flex flex-col gap-3">
                  <div>
                    <dt className="type-caption font-medium text-muted-foreground">하는 일</dt>
                    <dd className="mt-1 type-body text-foreground">{step.action}</dd>
                  </div>
                  <div className="border-t border-border pt-3">
                    <dt className="type-caption font-medium text-muted-foreground">얻는 것</dt>
                    <dd className="mt-1 type-body text-foreground">{step.result}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 9: 구현 — `principles-section.tsx`**

```tsx
import { CircleHelpIcon, GaugeIcon, LinkIcon, UserCheckIcon } from "lucide-react";
import { IconChip } from "@/components/landing/icon-chip";
import { SectionHeading } from "@/components/landing/section-heading";

// 설계 원칙이다. 검증하지 않은 정확도·성능·보안 인증·수주 실적은 적지 않는다(docs/09-SECURITY.md 책임 있는 AI).
const PRINCIPLES = [
  {
    icon: LinkIcon,
    title: "원문과 근거를 연결합니다",
    body: "판단마다 공고 원문의 해당 부분을 함께 보여 주어, 결과를 원문에서 다시 확인할 수 있게 합니다.",
  },
  {
    icon: CircleHelpIcon,
    title: "확인된 정보와 확인이 필요한 정보를 나눕니다",
    body: "근거가 부족한 항목은 추측해 채우지 않고 '확인 필요'로 표시합니다.",
  },
  {
    icon: GaugeIcon,
    title: "적합도와 수주 확률을 구분합니다",
    body: "SOL Score는 회사와 사업의 적합도입니다. 수주 확률로 표현하지 않습니다.",
  },
  {
    icon: UserCheckIcon,
    title: "AI 권고와 최종 결정을 구분합니다",
    body: "BID·WATCH·NO-BID는 권고입니다. 참여 여부는 담당자가 정하고, 결정과 사유를 따로 기록합니다.",
  },
];

export function PrinciplesSection() {
  return (
    <section id="principles" aria-labelledby="principles-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-8">
        <SectionHeading
          id="principles-title"
          eyebrow="분석 원칙"
          title="점수만 보여주지 않고, 판단의 근거를 함께 제공합니다."
          description="SOL RADAR의 분석 화면은 다음 네 가지 원칙으로 설계하고 있습니다."
          className="col-span-4"
        />
        {/* 칸 사이 1px 틈으로 바탕(border 색)이 비쳐 가는 선이 된다. 선을 따로 긋지 않는다. */}
        <ul className="col-span-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs">
          {PRINCIPLES.map((principle) => (
            <li key={principle.title} className="flex flex-col gap-3 bg-card p-6">
              <IconChip icon={principle.icon} />
              <h3 className="type-heading text-foreground">{principle.title}</h3>
              <p className="type-body text-muted-foreground">{principle.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 10: `web/app/page.tsx`에 구역 넣기** — import 줄을 다음으로 바꾸고(경로 알파벳 순서),

```tsx
import type { Metadata } from "next";
import { DesktopNotice } from "@/components/landing/desktop-notice";
import { FeaturesSection } from "@/components/landing/features-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { startHrefFor } from "@/components/landing/landing-links";
import { PrinciplesSection } from "@/components/landing/principles-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { ProductPreviewSection } from "@/components/landing/product-preview-section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMyHome } from "@/server/organization";
```

`<main>` 안을 다음으로 바꾼다.

```tsx
        <Hero startHref={startHref} />
        <ProductPreviewSection />
        <ProblemSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PrinciplesSection />
```

- [ ] **Step 11: 통과 확인**

Run: `pnpm -C web format && pnpm -C web build && pnpm -C web exec playwright test e2e/landing-sections.spec.ts e2e/landing.spec.ts e2e/site-header.spec.ts`
Expected: 모두 PASS.

- [ ] **Step 12: 빠른 검증**

Run: `pnpm verify:quick`
Expected: 통과.

- [ ] **Step 13: 커밋**

```bash
git add web/components/landing/section-heading.tsx web/components/landing/icon-chip.tsx web/components/landing/problem-section.tsx web/components/landing/feature-previews.tsx web/components/landing/features-section.tsx web/components/landing/how-it-works-section.tsx web/components/landing/principles-section.tsx web/app/page.tsx web/e2e/landing-sections.spec.ts
git commit -m "feat(web): 랜딩 문제·기능·작동 방식·원칙 구역 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: FAQ와 마지막 CTA

**Files:**
- Create: `web/components/ui/accordion.tsx`
- Create: `web/components/landing/faq-section.tsx`, `web/components/landing/final-cta-section.tsx`
- Modify: `web/app/page.tsx` (구역 2개 추가)
- Modify: `web/e2e/landing-sections.spec.ts` (시험 4개 이어 붙이기)

**Interfaces:**
- Consumes: Task 4 `DEMO_HREF`·`expectBelowHeader`, Task 5 `SectionHeading`.
- Produces: `Accordion`·`AccordionItem`·`AccordionTrigger`·`AccordionContent`(`@/components/ui/accordion`, Base UI Accordion 감쌈), 구역 `#faq`(h2 "자주 묻는 질문"), `#get-started`(h2 "다음 사업 검토, 근거부터 확인하세요.", `FinalCtaSection({ startHref: string })`).

- [ ] **Step 1: 실패하는 e2e — `web/e2e/landing-sections.spec.ts` 끝에 이어 붙이기**

```ts
const FAQ_QUESTIONS = [
  "어떤 기업을 위한 서비스인가요?",
  "SOL Score가 높으면 수주 가능성이 높다는 뜻인가요?",
  "AI가 입찰 참여 여부를 자동으로 결정하나요?",
  "기업 정보가 부족해도 분석할 수 있나요?",
  "어떤 데이터를 활용하나요?",
];

test("FAQ 는 질문 다섯 개이고, 누르거나 Enter 로 답을 펼치고 접는다", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "자주 묻는 질문" });
  await expect(faq.getByRole("button")).toHaveText(FAQ_QUESTIONS);
  const score = faq.getByRole("button", { name: FAQ_QUESTIONS[1] });
  const scoreAnswer = faq.getByText("실제 수주 확률을 의미하지 않습니다.", { exact: false });
  await expect(score).toHaveAttribute("aria-expanded", "false");
  await expect(scoreAnswer).toBeHidden();
  await score.click();
  await expect(score).toHaveAttribute("aria-expanded", "true");
  await expect(scoreAnswer).toBeVisible();
  await score.press("Enter");
  await expect(score).toHaveAttribute("aria-expanded", "false");
  await expect(scoreAnswer).toBeHidden();
  const data = faq.getByRole("button", { name: FAQ_QUESTIONS[4] });
  await data.focus();
  await page.keyboard.press("Space");
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(faq.getByText(/실제 연동 범위는 개발 상태에 맞춰 안내합니다/)).toBeVisible();
});

test("주소에 #faq 를 붙여 열면 FAQ 제목이 머리말 아래에 보인다", async ({ page }) => {
  await page.goto("/#faq");
  await expectBelowHeader(page, page.getByRole("heading", { level: 2, name: "자주 묻는 질문" }));
});

test("마지막 구역에 시작하기·분석 예시 보기와 MVP 개발 중 안내가 있다", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("region", { name: "다음 사업 검토, 근거부터 확인하세요." });
  await expect(cta.getByText(/검토할 사업의 우선순위를 정리하세요/)).toBeVisible();
  await expect(cta.getByRole("link", { name: "시작하기", exact: true })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
  await expect(cta.getByRole("note")).toContainText("MVP를 개발하고 있습니다");
  const demo = cta.getByRole("link", { name: "분석 예시 보기" });
  await expect(demo).toHaveAttribute("href", "/#demo");
  await demo.click();
  await expect(page).toHaveURL(/\/#demo$/);
  await expectBelowHeader(
    page,
    page.getByRole("region", { name: "공고 분석 예시" }).getByRole("tablist"),
  );
});

test("첫 화면에는 빈 링크(href=\"#\")와 이름 없는 링크·버튼이 없다", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="#"], a:not([href])')).toHaveCount(0);
  for (const control of [
    ...(await page.getByRole("link").all()),
    ...(await page.getByRole("button").all()),
  ]) {
    await expect(control).toHaveAccessibleName(/\S/);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C web build && pnpm -C web exec playwright test e2e/landing-sections.spec.ts`
Expected: FAIL — "자주 묻는 질문"·"다음 사업 검토…" 구역이 없다. (빈 링크 시험은 이미 통과할 수 있다.)

- [ ] **Step 3: 구현 — `web/components/ui/accordion.tsx`**

```tsx
"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

// shadcn base-nova 의 accordion 모양을 이 저장소 규칙(글자 눈금·토큰 색·cn 패키지)에 맞춰 손으로 옮긴 것이다.
// Header 는 h3 로 그려진다(Base UI 기본). 열림·닫힘·Enter/Space·aria-expanded 는 Base UI 가 맡는다.
function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger flex flex-1 items-center justify-between gap-4 rounded-lg py-4 text-left type-heading text-foreground outline-none hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-aria-expanded/accordion-trigger:rotate-180 motion-safe:transition-transform motion-safe:duration-150"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

// 높이는 Base UI 가 재어 --accordion-panel-height 로 넘긴다. 여닫을 때 0 에서/로 줄어든다.
function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="h-(--accordion-panel-height) overflow-hidden data-ending-style:h-0 data-starting-style:h-0 motion-safe:transition-[height] motion-safe:duration-150 motion-safe:ease-out"
      {...props}
    >
      <div className={cn("pb-4 type-body text-muted-foreground", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
```

- [ ] **Step 4: 구현 — `faq-section.tsx`**

```tsx
import { SectionHeading } from "@/components/landing/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// 질문과 답은 요청 문구 그대로다. 실제 연동 범위처럼 개발 상태에 따라 바뀌는 답은 상태가 바뀌면 같이 고친다.
const FAQS = [
  {
    question: "어떤 기업을 위한 서비스인가요?",
    answer: "공공 SI·AX 사업을 검토하는 기업의 영업·사업기획·입찰 담당자를 위한 서비스입니다.",
  },
  {
    question: "SOL Score가 높으면 수주 가능성이 높다는 뜻인가요?",
    answer:
      "SOL Score는 기업 정보와 공고 요구사항을 비교한 적합도 지표입니다. 실제 수주 확률을 의미하지 않습니다.",
  },
  {
    question: "AI가 입찰 참여 여부를 자동으로 결정하나요?",
    answer: "분석 결과와 권고를 제공하며, 최종 참여 여부는 담당자가 결정합니다.",
  },
  {
    question: "기업 정보가 부족해도 분석할 수 있나요?",
    answer:
      "확인 가능한 정보로 분석하고, 판단 근거가 부족한 항목은 추가 확인이 필요하다고 표시합니다.",
  },
  {
    question: "어떤 데이터를 활용하나요?",
    answer:
      "공식 API로 수집하는 공공사업 정보와 사용자가 등록한 기업 정보를 활용하도록 설계하고 있습니다. 실제 연동 범위는 개발 상태에 맞춰 안내합니다.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 px-8 py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-8">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="자주 묻는 질문" className="col-span-4" />
        <Accordion className="col-span-8 rounded-xl border border-border bg-card px-6 shadow-xs">
          {FAQS.map((faq) => (
            <AccordionItem key={faq.question} value={faq.question}>
              <AccordionTrigger>{faq.question}</AccordionTrigger>
              <AccordionContent>{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: 구현 — `final-cta-section.tsx`**

```tsx
import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { DEMO_HREF } from "@/components/landing/landing-links";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// 마지막 권유. 지금 이용할 수 있는 것(계정)과 개발 중인 것(공고 분석)을 나눠 밝힌다.
export function FinalCtaSection({ startHref }: { startHref: string }) {
  return (
    <section id="get-started" aria-labelledby="get-started-title" className="scroll-mt-20 px-8 pb-24">
      <Card className="mx-auto w-full max-w-6xl gap-0 px-12 py-14">
        <div className="grid grid-cols-12 items-end gap-8">
          <div className="col-span-7">
            <h2 id="get-started-title" className="type-headline text-foreground">
              다음 사업 검토, 근거부터 확인하세요.
            </h2>
            <p className="mt-4 type-lead text-muted-foreground">
              우리 회사의 조건에 맞춰 공고를 비교하고,
              <br />
              검토할 사업의 우선순위를 정리하세요.
            </p>
          </div>
          <div className="col-span-5 flex items-center gap-3 justify-self-end">
            <Link href={startHref} className={buttonVariants({ size: "lg" })}>
              시작하기
            </Link>
            <Link
              href={DEMO_HREF}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              분석 예시 보기
            </Link>
          </div>
        </div>
        <p
          role="note"
          className="mt-10 flex items-start gap-2 border-t border-border pt-6 type-label text-muted-foreground"
        >
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          SOL RADAR는 MVP를 개발하고 있습니다. 지금은 계정 만들기와 로그인을 이용할 수 있고, 공고
          분석 기능은 개발 중입니다.
        </p>
      </Card>
    </section>
  );
}
```

- [ ] **Step 6: `web/app/page.tsx`에 구역 넣기** — import 줄을 다음으로 바꾸고(경로 알파벳 순서),

```tsx
import type { Metadata } from "next";
import { DesktopNotice } from "@/components/landing/desktop-notice";
import { FaqSection } from "@/components/landing/faq-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { startHrefFor } from "@/components/landing/landing-links";
import { PrinciplesSection } from "@/components/landing/principles-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { ProductPreviewSection } from "@/components/landing/product-preview-section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMyHome } from "@/server/organization";
```

`<PrinciplesSection />` 아래에 두 줄을 넣는다.

```tsx
        <PrinciplesSection />
        <FaqSection />
        <FinalCtaSection startHref={startHref} />
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm -C web format && pnpm -C web build && pnpm -C web exec playwright test e2e/landing-sections.spec.ts e2e/landing.spec.ts e2e/site-header.spec.ts e2e/operations.spec.ts`
Expected: 모두 PASS. 펼침 애니메이션 때문에 `toBeHidden`이 늦으면 Playwright가 기다린다(기본 5초). 그래도 실패하면 Base UI Panel이 닫힌 뒤 `hidden`을 붙이는지 `web/node_modules/@base-ui/react/accordion/panel/AccordionPanel.d.ts`의 `keepMounted`·`hiddenUntilFound` 설명을 확인하고 부품을 고친다.

- [ ] **Step 8: 빠른 검증**

Run: `pnpm verify:quick`
Expected: 통과(`check:colors`가 새 `accordion.tsx`도 본다).

- [ ] **Step 9: 커밋**

```bash
git add web/components/ui/accordion.tsx web/components/landing/faq-section.tsx web/components/landing/final-cta-section.tsx web/app/page.tsx web/e2e/landing-sections.spec.ts
git commit -m "feat(web): 랜딩 FAQ와 마지막 CTA 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 전체 검증·브라우저 확인·기록

**Files:**
- Create: `docs/evidence/landing/20261016-landing-loaded-1440.png`, `docs/evidence/landing/20261016-landing-loaded-1280.png`, `docs/evidence/landing/test-report.txt`
- Modify: `docs/PROGRESS.md` (작업 로그 한 줄)

**Interfaces:**
- Consumes: Task 1~6 전부.

- [ ] **Step 1: 전체 검증**

Run: `mkdir -p docs/evidence/landing && pnpm verify 2>&1 | tee docs/evidence/landing/test-report.txt | tail -40`
Expected: 공통 검사(format·test·tokens·colors·db-types)와 web `verify`(format·type-check·lint·lint-guards·test·lodestar·tokens·colors·build) 모두 통과. 실패하면 원인을 고치고 다시 돈다(검사를 끄지 않는다). 다시 돌면 리포트는 덮어써진다.

- [ ] **Step 2: E2E 전체(브라우저 부품 시험 포함)**

Run: `pnpm -C web test:e2e 2>&1 | tee -a docs/evidence/landing/test-report.txt | tail -40`
Expected: Playwright 전부 PASS + `test:browser`(ProductPreview 5개 포함) 전부 PASS. 포트 3100이 쓰이고 있으면 `E2E_PORT=3111 pnpm -C web test:e2e`.

- [ ] **Step 3: 리포트 확인** — `docs/evidence/landing/test-report.txt`를 열어 verify 끝 줄과 e2e 통과 수가 들어 있는지 본다. 비밀값(토큰·키)이 찍혔으면 그 줄을 지운다.

- [ ] **Step 4: 실제 화면 확인(Playwright MCP)** — `pnpm -C web start --hostname 127.0.0.1 --port 3200`을 백그라운드로 띄운 뒤:
  1. `browser_resize` 1440×900 → `browser_navigate` `http://127.0.0.1:3200/` → `browser_take_screenshot`(fullPage, 파일명 `20261016-landing-loaded-1440.png`). 저장된 경로를 도구 결과에서 확인해 `docs/evidence/landing/`으로 옮긴다.
  2. 같은 방법으로 1280×800 → `20261016-landing-loaded-1280.png`.
  3. 두 스크린샷을 직접 열어 본다: 머리말 한 줄, 히어로 제목 두 줄, 미리보기 두 단, 구역 순서(히어로 → 미리보기 → 서비스 소개 → 주요 기능 → 분석 방식 → 분석 원칙 → FAQ → CTA → 바닥글), 가로 스크롤 없음, 빈 구역 없음.
  4. 미리보기 목록의 세 공고를 차례로 눌러 점수·권고(82 WATCH · 88 BID · 64 NO-BID)가 바뀌는지 본다. Tab으로 목록에 들어가 방향키로 옮겨 초점 링이 보이는지 본다.
  5. 메뉴 세 개, 히어로·CTA의 두 버튼, 바닥글 링크를 눌러 본다.
  6. `browser_console_messages`(level error) → 0건이어야 한다. 있으면 원인을 고친다.
  7. `browser_emulate_media`로 `reducedMotion: reduce`를 켜고 새로 고쳐 히어로·미리보기가 움직이지 않고 바로 보이는지 본다.
  8. 서버를 끈다.

- [ ] **Step 5: `docs/PROGRESS.md` 작업 로그에 한 줄 추가** (표 맨 아래)

```markdown
| 2026-10-16 | 화면 | 템플릿 랜딩을 SOL RADAR 첫 화면으로 교체(`web/app/page.tsx`, `web/components/landing/`). 히어로·분석 미리보기(가상 공고 3건, 권고는 08 §5.2 규칙으로 계산: 82 WATCH·88 BID·64 NO-BID)·문제 공감·주요 기능(모두 "개발 예정")·작동 방식·분석 원칙·FAQ(Base UI Accordion)·CTA(MVP 개발 중 안내)·바닥글. 상태 색 토큰 `success`·`warning`·`demo` 추가(06 §3.1 값). `web/project.json` 이름·설명 교체. 데스크톱 전용이라 `responsive.spec.ts`에서 `/` 제외 | `pnpm verify`, `pnpm -C web test:e2e`(결과 `docs/evidence/landing/test-report.txt`), Playwright MCP 1440·1280 확인·콘솔 오류 0건(`docs/evidence/landing/`) | Phase 0 계획이 `web/`를 지우고 `apps/web`을 새로 만든다 — 랜딩 이식 단계 미반영(사용자 결정 필요). 로그인 상태의 시작하기 → 대시보드는 단위 시험만(로컬 Supabase 없어 `test:e2e:auth` 미실행). 템플릿 `dashboard-preview.tsx`는 쓰지 않게 됐지만 남겨 둠 |
```

검증 칸·남은 문제 칸은 실제로 돌린 결과에 맞게 고친다(돌리지 못한 것은 못 돌렸다고 적는다).

- [ ] **Step 6: 커밋**

```bash
git add docs/evidence/landing/test-report.txt docs/evidence/landing/20261016-landing-loaded-1440.png docs/evidence/landing/20261016-landing-loaded-1280.png docs/PROGRESS.md
git commit -m "docs: 랜딩 검증 증거와 진행 기록 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 보고** — 바꾼 파일, 구현한 내용, 검증 결과(통과·실패·못 돌린 것과 이유), 결정 D10(Phase 0 이식)을 사용자에게 짧게 알린다. 푸시하지 않는다.

## 관련 문서

- [[01-PRD|01 PRD]] — 제품 의도, 범위(데스크톱 전용, 모바일·결제 제외)
- [[06-UI-UX|06 UI]] — 데스크톱 원칙, 색·상태 표기, 접근성
- [[08-SCORING|08 SOL Score]] — 결정 정책 v0.1(권고 규칙)
- [[09-SECURITY|09 보안]] — 책임 있는 AI, DEMO 표시 원칙
- [[16-DECISIONS|16 ADR]] — ADR-007 범위 제외
- [[16-DECISIONS|16 ADR]] ADR-017 — Next.js + Supabase, 코드는 `web/` 유지(결정 D10)
- [[PROGRESS]] — 진행 기록
