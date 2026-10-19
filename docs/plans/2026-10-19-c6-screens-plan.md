---
title: "구현 계획 — C6 화면 A단계 (C2 병합 전)"
doc: "plan-c6-screens-a"
status: draft
tags:
  - sol-radar
  - ui
  - hackathon
created: 2026-10-19
updated: 2026-10-19
---

# C6 화면 A단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** C2(DB 표) 병합 전에 할 수 있는 C6 몫을 끝낸다. 05 DTO 모델, 라벨·서식, 표시 부품 전부, Topbar 지표 부품, 업무 서비스 규칙(가짜 저장으로 시험)까지다. 그래서 C2가 들어오면 저장소 연결·Route Handler·화면 조립(B단계)만 남는다.

**Architecture:** 화면이 받는 모양은 05 DTO다. zod 스키마는 새 도메인 `web/server/bids/` 한 곳에 둔다. 부품(`web/components/bids/*`)은 props만 받고 서버 모듈은 `import type`으로만 가리킨다. 권한(역할별 버튼 활성)은 서버가 계산해 boolean props로 넘긴다. 서비스는 템플릿 `task` 도메인처럼 `repo` 인자를 주입받고, 이번 단계에서는 가짜 repo로만 시험한다.

**Tech Stack:** Next.js 16 · React 19 · Tailwind v4 · shadcn(Base UI) · zod · react-hook-form + `@hookform/resolvers` · zustand · Vitest(node) · Vitest browser(Chromium, `*.browser.test.tsx`) · lucide-react 1.54.0

**Spec:** [디자인 스펙 — C6](2026-10-19-c6-screens-design.md). §12의 D1~D30은 사용자가 추천안(①)대로 일괄 승인했다(2026-10-19). 화면 문구·배치·상태표는 스펙이 정본이고, 이 계획은 파일·이름·시험만 정한다.

작업 폴더는 `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/c6-screens`이고 브랜치는 `c6/screens`다. 명령은 모두 이 폴더 기준이다.

## Global Constraints

- 화면 폭은 1440·1280만 본다. 1280px 미만 레이아웃, 모바일, 결제, 승률 예측, 자동 투찰은 만들지 않는다(ADR-007).
- 색·글꼴·글자 눈금은 `design/tokens.json`에서만 온다. 새 색과 새 눈금은 만들지 않는다(D14·D15). 상태 색(`success`·`warning`·`destructive`·`demo`)은 글자·아이콘·테두리에만 쓰고 바탕 채움은 하지 않는다.
- 상태는 아이콘 + 글자 + 색 셋으로 나타낸다(스펙 §3.3 표 그대로). 아이콘에는 `aria-hidden`을 단다.
- 09 고정 문구는 바꾸지 않는다. "수주 확률"·"낙찰 확률" 글자는 "아님"·"아닙니다"와 같은 문장 안에서만 나온다.
- 숫자 열은 `tabular-nums`로 오른쪽 정렬한다. 점수는 정수, 요소 점수는 소수 1자리(`24.0 / 30`), Kev 분포는 정수 %, 신호는 소수 2자리다(스펙 §3.4).
- `web/server/<도메인>/` 파일은 `import "server-only";`로 시작한다. 부품은 서버 모듈을 `import type`으로만 가리킨다. 클라이언트 번들에 server-only 모듈이 들어가면 빌드가 깨진다.
- 바깥에서는 도메인을 배럴(`@/server/<도메인>`)로만 부른다. 부모 상대경로는 쓰지 않고 `@/`를 쓴다. `eslint-disable`, `any`, `@ts-ignore`, `.only`, `.skip`은 금지다.
- `web/server/analysis/**`는 b3(c5/analysis-client) 소유라 만들지 않는다. `web/server/scoring/**`는 읽기만 한다.
- 정본(`docs/00~21`), `docs/PROGRESS.md`, `supabase/**`, `web/lib/database.types.ts`, `infra/**`는 고치지 않는다.
- 커밋 메시지는 `타입(범위): 한국어 설명` 형식으로 쓰고 첫 줄은 50자 이내다. 파일을 지정해 스테이징한다. push와 main 병합은 하지 않는다(조정 세션 e8이 병합한다).
- `pkill`·`killall`은 금지다. 자기가 띄운 PID만 끈다. 시간초과나 신호로 끊긴 검증은 통과·실패로 적지 않고 다시 돌린다.

## Review Focus

- 긴 제목(100자 넘음)과 긴 사유(2000자): 1280px에서 표와 레일이 가로로 넘치지 않고, 제목은 2줄에서 말줄임하며 상세 h1은 줄바꿈한다. 시험은 Task 7(`bid-table.browser.test.tsx` "긴 제목")과 Task 6(`decision-panel.browser.test.tsx` "긴 사유 이력")이 맡는다.
- `null`이 섞인 공고: 예산·마감·발주기관이 `null`이면 `—`와 스크린리더 "미공개"가 나오고 `NaN`·`Invalid Date`가 화면에 없다. 시험은 Task 3(`format.test.ts`)과 Task 7이 맡는다.
- 알림 `payload.link`가 바깥 주소일 때(`https://evil.example`, `//evil.example`): 앱 안 경로만 따르고, 그렇지 않으면 `/bids/{bidId}`로 간다. 시험은 Task 9(`notification.model.test.ts`)가 맡는다.
- 분석이 없는 공고와 PARTIAL·FAILED 분석: 부품이 `latestAnalysis=null`, `solScore=null`, `kev.enabled=false`를 받아도 터지지 않고 스펙 상태 글자를 보인다. 시험은 Task 5가 맡는다.
- 커서 변조: 서명이 맞지 않는 `cursor`는 `INVALID_CURSOR`로 거절하고, 필터가 바뀐 커서는 쓰지 않는다. 시험은 Task 9(`bid-query.test.ts`)가 맡는다.

---

## 이 계획의 범위와 내린 판단

스펙 §11의 A1~A5 가운데 C2 표 없이 끝까지 시험할 수 있는 것만 담는다. 아래 네 가지는 스펙 §11과 다르게 B단계(C2 병합 뒤 따로 쓰는 계획)로 옮겼다. **e8의 판단이다.**

1. **Route Handler 9개와 Supabase repo를 B1로 옮긴다.** `web/lib/database.types.ts`에 C2 표가 아직 없어 repo를 타입 안전하게 쓸 수 없다. 저장소 시험 관례(서비스·repo는 진짜, 전송만 가짜)도 표가 있어야 성립한다.
2. **`(work)` 레이아웃, 화면 `page.tsx`, 옛 리다이렉트 `web/app/(app)/dashboard/page.tsx` 삭제(D1), `app-shell.tsx`의 `NAV` 교체를 B2로 옮긴다.** 화면이 데이터를 읽을 수 없는 상태로 메뉴만 바꾸면, 그 사이 `/dashboard` 메뉴가 깨진다.
3. **`getMyBusinessAccess`(D20)의 service·repo는 B1에서 가져온다.** 이 함수는 `memberships.sol_role` 열을 읽는데, 그 열은 C2 마이그레이션으로 생긴다. 이번에는 열에 기대지 않는 `business-access.model.ts`만 브랜치에서 그대로 복사한다.
4. **분석 DTO는 `web/server/bids/analysis-view.model.ts`에 둔다.** 스펙 §11은 `analysis/` 도메인을 말하지만, 그 폴더는 b3 소유다. 이름은 C4의 `AnalysisResult`와 섞이지 않게 `AnalysisView`로 한다.

도메인은 `bids` 하나로 시작한다. 결정·알림·대시보드 모델도 이 폴더에 둔다. lodestar 도메인 층은 다른 도메인을 런타임으로 부를 수 없어서다. 쪼개는 일은 B단계에서 필요할 때 한다.

## 파일 지도

| 파일 | 맡는 것 |
|---|---|
| `web/components/app-page.tsx` (수정) | `contentClassName` prop (브랜치와 같은 구현) |
| `web/app/api/v1/_lib/http.ts` (수정) | 오류 코드 6개 추가 |
| `web/server/organization/business-access.model.ts` (새, 브랜치 복사) | `SolRole`·`solRoleSchema`·`MyBusinessAccess` |
| `web/server/organization/index.ts` (수정) | `SolRole`·`MyBusinessAccess` 타입 export |
| `web/server/bids/bid.model.ts` | 05 §4.1·§4.3 enum·`BidListItem`·`BidDetail`·`Page` 스키마 |
| `web/server/bids/analysis-view.model.ts` | 05 §4.5 `AnalysisView`(D16 반영), `toAnalysisView()` |
| `web/server/bids/review.model.ts` | `ReviewInput`·`Review`, 역할 권한 함수 |
| `web/server/bids/notification.model.ts` | `Notification`, `safeNotificationLink()` |
| `web/server/bids/dashboard.model.ts` | `DashboardSummary` |
| `web/server/bids/bid-query.ts` | `/bids` 쿼리 파싱, 커서 서명·검증 |
| `web/server/bids/bids.service.ts` · `bids.repo.ts`(포트 타입만) | 목록·상세·분석 요청 규칙 |
| `web/server/bids/review.service.ts` · `notification.service.ts` · `dashboard.service.ts` | 결정 기록·알림·요약 규칙 |
| `web/server/bids/index.ts` | 배럴 |
| `web/components/bids/labels.ts` · `format.ts` | 라벨 표·서식 함수 |
| `web/components/bids/test-data.ts` | 부품 시험용 DTO(FX-01·02·03·PARTIAL·미분석) |
| `web/components/bids/status-badge.tsx` | `StatusBadge`·`DemoBadge` |
| `web/components/ui/radio-group.tsx` (shadcn add) | 결정 라디오 |
| `web/components/bids/analysis-status.tsx` · `score-gauge.tsx` · `score-factors.tsx` · `qualification-checklist.tsx` · `kev-opinion.tsx` · `analysis-banner.tsx` · `stage-timeline.tsx` | 상세 표시 부품 |
| `web/components/bids/evidence-store.ts` · `evidence-drawer.tsx` | 근거 서랍과 그 상태 |
| `web/components/bids/decision-panel.tsx` | 결정 패널 |
| `web/components/bids/bid-table.tsx` · `bid-filters.tsx` | 목록 표와 필터 |
| `web/components/topbar-status.tsx` | Topbar 지표 4개 + DEMO |
| `docs/evidence/phase-3/` | 시험 출력 |

---

### Task 1: 공용 기반 — 단 폭 prop, 오류 코드, 업무 역할 타입

**Files:**
- Modify: `web/components/app-page.tsx`
- Modify: `web/app/api/v1/_lib/http.ts:6-14`
- Create: `web/server/organization/business-access.model.ts`
- Modify: `web/server/organization/index.ts`
- Test: `web/server/organization/business-access.model.test.ts`

**Interfaces:**
- Produces: `AppPage({ ..., contentClassName?: string })`. `ApiErrorCode`는 기존 값에 더해 `FORBIDDEN`·`UNSUPPORTED_ACCOUNT_STATE`·`INVALID_CURSOR`(브랜치와 같은 순서·위치, `VALIDATION_ERROR` 다음)와 `ANALYSIS_IN_PROGRESS`·`IDEMPOTENCY_KEY_REUSED`·`RATE_LIMITED`(`NOT_FOUND` 앞)를 갖는다. `@/server/organization`에서 `type SolRole = "VIEWER" | "ANALYST" | "SALES" | "ADMIN"`과 `type MyBusinessAccess`를 쓸 수 있다.

- [ ] **Step 1: 브랜치 파일을 그대로 옮긴다.** `app-page.tsx`의 diff와 `business-access.model.ts`는 `/Users/leegwanghui/.codex/worktrees/5b0c/sol-radar`(`f579a2a`)의 내용과 바이트까지 같게 맞춘다. 비교 기준은 `git -C <브랜치> diff 89b2b5e..f579a2a -- web/components/app-page.tsx`다. 브랜치를 병합할 때 충돌을 없애려는 것이다.
- [ ] **Step 2: 실패하는 시험을 쓴다.** `business-access.model.test.ts`에서 `solRoleSchema.parse("SALES")` 성공, `solRoleSchema.safeParse("OWNER").success === false`를 확인한다.
- [ ] **Step 3: `index.ts`에 export 한 줄을 더한다.** `export type { MyBusinessAccess, SolRole } from "./business-access.model";`다. 같은 줄이 이미 있으면 더하지 않는다. `getMyBusinessAccess` export는 B1에서 더한다.
- [ ] **Step 4: `http.ts`의 `ApiErrorCode` union에 위 6개를 더한다.** 다른 줄은 바꾸지 않는다. `peopleResponse`는 가져오지 않는다(`@/server/people`이 main에 없다).
- [ ] **Step 5: 검증한다.** `pnpm -C web exec vitest run server/organization/business-access.model.test.ts`와 `pnpm -C web type-check`가 둘 다 PASS여야 한다.
- [ ] **Step 6: 커밋한다.** `feat(web): C6 공용 기반과 업무 역할 타입 추가`

### Task 2: 05 DTO 모델과 C4 → 화면 변환

**Files:**
- Create: `web/server/bids/bid.model.ts`, `web/server/bids/analysis-view.model.ts`, `web/server/bids/review.model.ts`, `web/server/bids/notification.model.ts`, `web/server/bids/dashboard.model.ts`, `web/server/bids/index.ts`
- Test: `web/server/bids/bid.model.test.ts`, `web/server/bids/analysis-view.model.test.ts`

**Interfaces:**
- Consumes: C4 타입(`import type { AnalysisResult as ScoringResult, ScoreFactor as ScoringFactor, QualificationCheck as ScoringCheck, KevAssist as ScoringKev } from "@/server/scoring"`, 타입 전용).
- Produces (배럴 `@/server/bids`):
  - enum 스키마와 타입은 05 §4.1의 값 그대로다. `bidStageSchema`, `bidStatusSchema`, `recommendationSchema`, `recommendationBasisSchema`, `analysisStatusSchema`, `qualificationOutcomeSchema`, `needsReviewReasonSchema`, `reviewFlagSchema`(17개), `factorKeySchema`, `runModeSchema`, `bidOriginSchema`, `roleSchema`(05 `Role`)가 있다. 여기에 `missingReasonSchema`(C4 `MissingReason` 8개, 스펙 §5.4.5 라벨 표의 키)를 더한다.
  - `pageSchema<T>(item: T)`는 `{ items: T[]; pageInfo: { cursor: string | null; nextCursor: string | null; hasNext: boolean } }`를 만든다.
  - `bidListItemSchema`·`bidDetailSchema`·`bidDocumentSchema`·`bidRevisionSummarySchema`·`structuredRequirementSchema`는 05 §4.3과 필드를 하나하나 맞춘다. `BidDetail.extraction`은 `z.unknown().nullable()`로 받고, 화면은 `itemId` 경로 조회 함수로만 읽는다.
  - `analysisViewSchema`(타입 `AnalysisView`)는 05 §4.5 `AnalysisResult`에 D16 변경 세 가지를 더한다. ① `missingFactors: { factor: FactorKey; reason: MissingReason }[]` ② `ScoreFactor`에 `missingReason: MissingReason | null` ③ `profileEvidence[].type`에 `"INDUSTRY_CODE"`. 하위 타입은 `ScoreFactorView`·`QualificationCheckView`·`KevView`(05 `kev`: 03 `KevAssist` + `KevAssistV02Fields`)·`RequirementAssessmentView`다.
  - `toAnalysisView(result: ScoringResult, meta: AnalysisRunMeta): AnalysisView`. `AnalysisRunMeta = { id; bidId; revisionId; revision; profileRevision; runMode; status; model; fallbackReason; evidence; errorCode; queuedAt; startedAt; finishedAt; checkedAt }`다. C4 → 05 이름 대응은 스펙 §7 표를 따른다(`score`→`solScore`, `factors`→`scoreBreakdown`, `qualificationStatus`+`qualificationChecks`→`qualification{status,checks}`, 행마다 `checkedAt` 붙이기).
  - `reviewInputSchema`(`reason` 10~2000자, 공백만은 거절), `reviewSchema`, `notificationSchema`, `dashboardSummarySchema`는 05 §4.6 그대로다.

- [ ] **Step 1: 실패하는 시험을 쓴다.** `bid.model.test.ts`에서 확인할 것:
  - `reviewFlagSchema.options.length === 17`
  - `bidListItemSchema.parse(<05 §4.3 모양 예시 1건>)` 성공
  - `budgetKrw: "1,200"`(숫자 문자열 아님)은 실패
  - `reviewInputSchema.safeParse({ decision: "BID", reason: "짧음" }).success === false`
  - `reviewInputSchema.safeParse({ decision: "BID", reason: "          " }).success === false`
- [ ] **Step 2: 실패하는 시험을 쓴다.** `analysis-view.model.test.ts`는 C4 모양 객체를 손으로 만든다. FX-01 골든 값은 `fixtures/goldens/FX-01.json`을 `node:fs`로 읽어 쓴다(점수 94, factors 24/25/20/15/10). 확인할 것:
  - `toAnalysisView(...)`의 `solScore === 94`
  - `scoreBreakdown.map(f => f.points)`가 골든 `factors[].points`와 같다
  - `qualification.checks[0].checkedAt === meta.checkedAt`
  - `missingFactors`가 `{factor, reason}` 모양으로 옮겨진다
  - `analysisViewSchema.parse(view)`가 성공한다
- [ ] **Step 3: 시험이 실패하는지 확인한다.** `pnpm -C web exec vitest run server/bids` 결과가 FAIL(모듈 없음)이어야 한다.
- [ ] **Step 4: 스키마·변환·배럴을 구현한다.** 타입은 모두 `z.infer`로 얻는다(ADR-016).
- [ ] **Step 5: 검증한다.** 같은 명령이 PASS이고 `pnpm -C web lodestar`도 PASS여야 한다(도메인 → `@/server/scoring`은 타입 전용 import).
- [ ] **Step 6: 커밋한다.** `feat(web): 공고·분석 화면 DTO 모델 추가`

### Task 3: 라벨·서식과 부품 시험 데이터

**Files:**
- Create: `web/components/bids/labels.ts`, `web/components/bids/format.ts`, `web/components/bids/test-data.ts`
- Test: `web/components/bids/labels.test.ts`, `web/components/bids/format.test.ts`, `web/components/bids/test-data.test.ts`

**Interfaces:**
- Consumes: Task 2 타입(`import type`)
- Produces:
  - 라벨 표는 모두 `as const satisfies Record<…, string>`로 빠짐없이 채운다. `RECOMMENDATION_LABEL`(`NO_BID` → `"NO-BID"`), `QUALIFICATION_LABEL`, `ANALYSIS_STATUS_LABEL`(`{ long, short }`, PARTIAL은 `"부분 완료 (규칙만)"`/`"부분 완료"`), `REVIEW_FLAG_LABEL`(17), `NEEDS_REVIEW_REASON_LABEL`(6), `MISSING_REASON_LABEL`(8), `FACTOR_LABEL`(5, 순서 고정 배열 `FACTOR_ORDER`), `STAGE_LABEL`, `NOTIFICATION_TYPE_LABEL`(5), `KEV_RISK_LABEL`(5)이다. 글자는 스펙 §3.3·§5.4.4·§5.4.5·§5.4.7·§5.4.9·§5.5 표의 초안 그대로 쓴다.
  - `STATUS_ICON`은 상태 키에서 lucide 아이콘·색 클래스로 가는 표다(스펙 §3.3).
  - 서식 함수: `formatKrwFull(v: string | null): string`, `formatKrwCompact(v: string | null): { text: string; full: string }`, `dDay(deadlineAt: string | null, now: Date): { label: string; past: boolean } | null`, `formatKst(iso: string): string`(`"2026-11-06 18:00"`), `formatRelative(iso: string, now: Date): string`, `formatPoints(n: number): string`(`"24.0"`), `formatPercent(p: number): string`(`"71%"`), `formatSignal(p: number): string`(`"0.85"`)
  - `test-data.ts`가 내보내는 것: `FX01_VIEW`(BID 94, Kev 0.71/0.24/0.05, `규칙 권고와 같음`), `FX02_VIEW`(WATCH 72, 15.0/18.3/14.0/15.0/10.0, Kev 0.36/0.52/0.12, `KEV_NEEDS_REVIEW`), `FX03_VIEW`(NO_BID 68, `MODEL_RULE_DISAGREEMENT`, 미충족 1건 `INDUSTRY_CODE`), `FX01_PARTIAL_VIEW`(PARTIAL, `RULES_ONLY`, `AI_UNAVAILABLE`, `kev.enabled=false`), `BID_LIST`(BidListItem 3건 + `null` 필드 1건 + 제목 120자 1건), `REVIEWS_FX01`, `NOTIFICATIONS`

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `labels.test.ts`: `Object.keys(REVIEW_FLAG_LABEL).length === 17`, `MISSING_REASON_LABEL` 8개다. 모든 라벨 값을 이어 붙인 문자열에 `/수주\s?확률|낙찰\s?확률/`가 없다.
  - `format.test.ts`:
    - `formatKrwFull("1200000000") === "1,200,000,000원"`
    - `formatKrwCompact("1200000000").text === "12억"`, `formatKrwCompact("2160000000").text === "21.6억"`
    - `formatKrwFull(null) === "—"`
    - `dDay("2026-11-06T09:00:00Z", new Date("2026-10-16T00:00:00Z"))!.label === "D-21"`, 지난 마감은 `{ label: "마감", past: true }`, `dDay(null, now) === null`
    - `formatKst("2026-11-06T09:00:00Z") === "2026-11-06 18:00"`
    - `formatPoints(24) === "24.0"`, `formatPercent(0.71) === "71%"`
    - 어느 함수 결과에도 `"NaN"`·`"Invalid"`가 없다
  - `test-data.test.ts`(node): `FX01_VIEW`·`FX02_VIEW`·`FX03_VIEW`가 `analysisViewSchema.parse`를 통과한다. 각 `scoreBreakdown[].points`가 `fixtures/goldens/FX-0n.json`의 `factors[].points`와 같고, `solScore`가 골든 `score`와 같다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run components/bids`
- [ ] **Step 3: 구현한다.** 서식은 `Intl.NumberFormat("ko-KR")`(compact는 `notation: "compact", maximumFractionDigits: 1`)과 `Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul" })`를 쓴다. D-n은 서울 날짜끼리 뺀다.
- [ ] **Step 4: PASS를 확인한다.** 같은 명령으로 확인한다.
- [ ] **Step 5: 커밋한다.** `feat(web): 공고 화면 라벨·서식과 시험 데이터 추가`

### Task 4: 상태 배지와 결정 라디오 부품

**Files:**
- Create: `web/components/bids/status-badge.tsx`
- Create(생성 명령): `web/components/ui/radio-group.tsx`
- Test: `web/components/bids/status-badge.browser.test.tsx`

**Interfaces:**
- Produces:
  - `StatusBadge({ kind, value, variant = "badge" | "inline", showCode?: boolean })`. `kind`는 `"recommendation" | "qualification" | "analysis" | "decision" | "flag" | "bidStatus"`다. 모양은 스펙 §3.3 끝 문단(높이 20px, `rounded-sm`, `px-1.5`, `type-caption`, 아이콘 14px, 테두리 + 흰 바탕)을 따른다. `inline`은 테두리가 없다.
  - `DemoBadge({ withTooltip?: boolean })`: `withTooltip`이면 초점을 받고 툴팁은 09 고정 문구다.
  - `RadioGroup`·`RadioGroupItem`은 shadcn Base UI 생성물이다.

- [ ] **Step 1: 실패하는 브라우저 시험을 쓴다.**
  - `StatusBadge kind="recommendation" value="NO_BID"`는 글자 `NO-BID`를 보이고, 클래스에 `text-destructive`가 있으며, `svg[aria-hidden="true"]`가 1개다.
  - `kind="qualification" value="NEEDS_REVIEW"`에 `reasonCode="STAGE_NOT_APPLICABLE"`을 주면 `해당 없음`이 나온다.
  - `DemoBadge withTooltip`은 `tabIndex === 0`이고, 초점을 주면 "이 데이터는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다."가 보인다.
  - 배지 높이가 20px이다(`getBoundingClientRect().height`).
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run --config vitest.browser.config.ts components/bids/status-badge.browser.test.tsx`
- [ ] **Step 3: 구현한다.** 라벨·아이콘은 Task 3 표에서만 가져온다. `pnpm -C web dlx shadcn@latest add radio-group`을 실행한 뒤, design-system 스킬의 "생성물 다섯 가지 확인"으로 토큰 색만 쓰는지 본다.
- [ ] **Step 4: PASS를 확인하고 `pnpm -C web check:colors`도 PASS인지 본다.**
- [ ] **Step 5: 커밋한다.** `feat(web): 상태 배지와 결정 라디오 부품 추가`

### Task 5: 분석 표시 부품

**Files:**
- Create: `web/components/bids/analysis-status.tsx`, `score-gauge.tsx`, `score-factors.tsx`, `qualification-checklist.tsx`, `kev-opinion.tsx`, `analysis-banner.tsx`, `stage-timeline.tsx` (모두 `web/components/bids/`)
- Test: `web/components/bids/analysis-display.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2 타입, Task 3 라벨·서식·`test-data`, Task 4 `StatusBadge`
- Produces (props만 받는다):
  - `AnalysisStatus({ status: AnalysisStatus | null, at?: string, short?: boolean })`
  - `ScoreGauge({ score: number | null, reference?: boolean })`
  - `ScoreFactors({ factors: ScoreFactorView[], reviewFlags: ReviewFlag[], explanation: string | null, algorithmVersion: string, profileRevision: number, reference?: boolean, onOpenEvidence?: (ctx: EvidenceContext) => void })`
  - `QualificationChecklist({ qualification: AnalysisView["qualification"], onOpenEvidence })`
  - `KevOpinion({ kev: KevView, reviewFlags: ReviewFlag[], recommendation: Recommendation | null, ruleReason: string | null, errorCode: string | null })`
  - `AnalysisBanner({ analysis: AnalysisView | null, bidStatus: BidStatus, delayed?: boolean })`. 하나도 해당하지 않으면 `null`을 돌려준다.
  - `StageTimeline({ stage: BidStage, stageLinks, latestRevision: number })`
  - `EvidenceContext = { title: string; evidence: EvidenceRef[] }`. 이 타입은 `evidence-store.ts`(Task 6)에서 export하므로, Task 5는 그 타입 하나만 먼저 만든다.

- [ ] **Step 1: 실패하는 브라우저 시험을 쓴다.** 컨테이너 폭은 616px(1280 상세 주 영역)과 776px 두 가지다.
  - `ScoreFactors FX02_VIEW`: 행 5개가 `FACTOR_ORDER` 순서다. 숫자 글자는 `15.0 / 25`… 순이다. `[role=meter]` 5개의 `aria-valuenow`가 15·18.3·14·15·10이다. 바닥 줄에 `SOL Score 72`가 있다.
  - FX-11처럼 `missing=true`인 행은 `미확인` 배지와 사유 글자 `MISSING_REASON_LABEL[reason]`이 보인다.
  - `ScoreGauge score={68} reference`는 `참고`를 보인다.
  - `QualificationChecklist FX03_VIEW.qualification`은 `미충족 1`을 요약하고, 행에 `회사:` 근거 라벨이 있다. 증거가 빈 `NEEDS_REVIEW` 행은 09 고정 INSUFFICIENT_DATA 문장을 보인다.
  - `KevOpinion FX01_VIEW.kev`는 `71%`·`24%`·`5%`를 보이고 `규칙 권고와 같음`을 보인다. `FX03_VIEW`는 `규칙 우선`과 06 고정 문장을 보인다. `FX01_PARTIAL_VIEW`는 `사용 불가`를 보이고 고지 3줄은 없다. `kev.enabled=false`이고 플래그가 없으면 `사용 안 함`이다.
  - `AnalysisBanner FX01_PARTIAL_VIEW`는 `role=status`에 09 고정 PARTIAL 문장과 `AI_UNAVAILABLE`을 보인다. `bidStatus="CANCELLED"`면 취소 문장이 나온다. `analysis=null`이고 취소가 아니면 아무것도 그리지 않는다.
  - 모든 부품을 616px에 그렸을 때 `scrollWidth <= clientWidth`이다(가로 넘침 0).
  - 문서 전체 글자에 `/수주\s?확률(?!.{0,20}아)/`이 0건이다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run --config vitest.browser.config.ts components/bids/analysis-display.browser.test.tsx`
- [ ] **Step 3: 스펙 §5.4.2~§5.4.7 표대로 구현한다.** 막대는 `role="meter"` + `aria-valuetext`다. 규칙 점수 막대는 `bg-brand`, Kev 막대는 `bg-muted-foreground`다. v0.2 필드(`scores`·`risks`·`calibration`)가 `null`이 아니면 스펙 §5.4.7 v0.2 표를 그린다.
- [ ] **Step 4: PASS를 확인한다.**
- [ ] **Step 5: 커밋한다.** `feat(web): 분석 결과 표시 부품 추가`

### Task 6: 근거 서랍과 결정 패널

**Files:**
- Create: `web/components/bids/evidence-store.ts`, `web/components/bids/evidence-drawer.tsx`, `web/components/bids/decision-panel.tsx`
- Test: `web/components/bids/evidence-store.test.ts`, `web/components/bids/decision.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2 `reviewInputSchema`의 **모양**. 클라이언트에서 server-only 모듈을 부를 수 없으므로 같은 규칙을 `decision-panel.tsx` 안의 zod로 다시 적는다. 같은지는 Step 1 시험으로 확인한다.
- Produces:
  - `useEvidenceStore`(zustand): `{ open: boolean; context: EvidenceContext | null; openWith(ctx): void; close(): void }`
  - `EvidenceDrawer({ content: string | null, sourceUrl: string, documents: BidDocument[] })`. `Sheet side="right"`, 폭 480px이다.
  - `DecisionPanel({ analysis: AnalysisView | null, reviews: Review[], members: { id: string; name: string }[], currentUserId: string, canRecordReview: boolean, bidStatus: BidStatus, onSubmit: (input: ReviewInputValues) => Promise<SubmitResult> })`. `SubmitResult = { ok: true } | { ok: false; status: number; code: string; message: string; requestId?: string; field?: "reason" | "assigneeUserId" }`다. 전송(fetch)은 B2의 화면 조립이 넘기고, 이 부품은 결과를 보여 주기만 한다.

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `evidence-store.test.ts`: `openWith`를 부르면 `open=true`가 되고 context가 저장된다. `close`를 부르면 `open=false`가 된다.
  - `decision.browser.test.tsx`:
    - 라디오 `BID`가 `FX01_VIEW.recommendation`으로 미리 선택된다(D21).
    - 사유 9자를 넣고 제출하면 `onSubmit`이 불리지 않는다. 사유 칸이 `aria-invalid="true"`가 되고 "사유를 10자 이상 적어 주세요"가 보이며 초점이 사유 칸에 있다.
    - `canRecordReview=false`면 라디오·사유·버튼이 `disabled`이고 "결정은 ADMIN·SALES 역할만 기록할 수 있습니다"가 보인다.
    - `onSubmit`이 `{ ok:false, status:500, code:"INTERNAL_ERROR", requestId:"r-1" }`를 돌려주면 폼 위에 `INTERNAL_ERROR`와 `r-1`이 보이고 입력이 그대로 남는다.
    - 2000자 사유 이력은 3줄 말줄임이고 [펼치기]가 있다. 레일 폭 320px에서 가로 넘침이 0이다.
    - `EvidenceDrawer`를 열면 `role=dialog`가 생긴다. `Esc`를 누르면 닫히고 초점이 연 버튼으로 돌아간다. `documentId=null`인 근거는 `<mark>` 1개를 보인다.
- [ ] **Step 2: 실패를 확인한다.** node 시험과 browser 시험을 둘 다 돌린다.
- [ ] **Step 3: 스펙 §5.4.8·§5.4.9·§5.4.10대로 구현한다.** 폼은 react-hook-form + `zodResolver`, 라디오는 Task 4 `RadioGroup`, 담당자는 `Select`(기본 = `currentUserId`)다.
- [ ] **Step 4: PASS를 확인한다.**
- [ ] **Step 5: 커밋한다.** `feat(web): 근거 서랍과 결정 패널 추가`

### Task 7: 목록 표와 필터

**Files:**
- Create: `web/components/bids/bid-table.tsx`, `web/components/bids/bid-filters.tsx`
- Test: `web/components/bids/bid-list.browser.test.tsx`

**Interfaces:**
- Consumes: Task 3 `BID_LIST`·서식, Task 4 배지, Task 9의 쿼리 키 이름(`q`·`stage`·`recommendation`·`decision`·`origin`·`sort`). Task 9보다 먼저 하면 키 이름은 이 줄을 기준으로 한다.
- Produces:
  - `BidTable({ items: BidListItem[], caption: string, compact?: boolean })`. `compact`는 대시보드 표(5열, 스펙 §5.2)다.
  - `BidFilters({ defaultOrigin: "demo" | "live" })`. URL 쿼리를 읽고 쓴다(`useRouter`·`useSearchParams`). 기본값은 URL에 적지 않는다.

- [ ] **Step 1: 실패하는 브라우저 시험을 쓴다.** 컨테이너 폭은 960px이다.
  - 10열 머리가 스펙 §5.3 순서로 있다. `table.scrollWidth <= container.clientWidth`이다.
  - 제목 120자 행은 2줄 말줄임이다(행 높이가 3줄 높이보다 작다). `title` 속성에는 전체 제목이 있다.
  - `budgetKrw=null` 행은 예산 칸이 `—`이고 sr-only `미공개`가 있다.
  - `isDemo=true` 행에는 `DEMO`가, `false` 행에는 `나라장터`가 있다.
  - `documentsStatus.failed=1` 행 제목 뒤에 sr-only `첨부 원문 확인 필요`가 있다.
  - `BidFilters`에서 정렬을 `점수 높은 순`으로 바꾸면 URL이 `?sort=score%3Adesc`가 된다. 다시 기본값으로 돌리면 `sort` 키가 사라진다. 기본이 아닌 값이 있을 때만 `필터 초기화`가 보인다.
- [ ] **Step 2: 실패를 확인하고 구현한 뒤 PASS를 확인한다.** 열 폭은 스펙 §5.3 숫자(64·72·가변·120·80·72·80·88·96·88)이고 `table-fixed`다.
- [ ] **Step 3: 커밋한다.** `feat(web): 공고 목록 표와 필터 부품 추가`

### Task 8: Topbar 지표 부품

**Files:**
- Create: `web/components/topbar-status.tsx`
- Test: `web/components/topbar-status.browser.test.tsx`

**Interfaces:**
- Consumes: Task 3 서식, Task 4 `DemoBadge`
- Produces: `TopbarStatus({ runMode: RunMode, initialSummary: TopbarSummary | null, initialAi: AiIndicator | null })`
  - `TopbarSummary = Pick<DashboardSummary, "dataFreshness" | "unreadNotifications">`
  - `AiIndicator = "mock" | "local" | "hosted" | "unavailable"`
  - 30초마다 `fetch("/health/ready")`와 `fetch("/api/v1/dashboard/summary")`로 다시 읽는다(창이 초점을 얻을 때도 읽는다). 내보내는 `refreshTopbarStatus()`는 바로 한 번 읽는다(D4·D5).
  - zustand `useTopbarStore`에는 마지막 값과 실패 여부를 둔다.
  - 이 단계에서 `app-shell.tsx`는 고치지 않는다(B2에서 한 줄 넣는다).

- [ ] **Step 1: 실패하는 브라우저 시험을 쓴다.** `fetch`는 `vi.stubGlobal`로 바꾼다.
  - `runMode="mock"`이면 `DEMO`가 있고 `실행 모드: mock` 값이 `text-warning`이다. `runMode="live"`면 `DEMO`가 없다.
  - `/health/ready`가 `{status:"degraded", checks:{ai:"unavailable"}}`를 주면 `AI: unavailable`이 보인다. 숨은 `role=status`가 "AI 연결이 끊겼습니다"를 한 번만 갖는다.
  - `/health/ready`가 503이면 마지막 값을 유지하고, 툴팁은 "상태를 확인하지 못했습니다"다.
  - `lastIngestAt`이 2시간 전이면 `수집 지연 · 2시간 전`(warning)이다. `null`이면 `수집 기록 없음`이다. `initialSummary=null`이면 `—`다.
  - 벨은 `unreadNotifications=12`면 `9+`이고 `aria-label="알림, 안 읽음 12건"`이다. 0이면 숫자 배지가 없다.
  - Topbar 폭 1024px 안에서 지표 묶음이 한 줄이다(높이가 48px 이하).
- [ ] **Step 2: 실패를 확인하고 구현한 뒤 PASS를 확인한다.** 순서는 `DEMO → 실행 모드 → AI → 수집 → 벨`로 고정이고 사이에 세로 `Separator`를 둔다(스펙 §4.2).
- [ ] **Step 3: 커밋한다.** `feat(web): Topbar 실행 모드·AI·수집·알림 지표 추가`

### Task 9: 업무 서비스 규칙 (가짜 저장으로 시험)

**Files:**
- Create: `web/server/bids/bid-query.ts`, `web/server/bids/bids.repo.ts`(포트 타입만), `web/server/bids/bids.service.ts`, `web/server/bids/review.service.ts`, `web/server/bids/notification.service.ts`, `web/server/bids/dashboard.service.ts`
- Modify: `web/server/bids/notification.model.ts`, `web/server/bids/review.model.ts`, `web/server/bids/index.ts`
- Test: `web/server/bids/bid-query.test.ts`, `bids.service.test.ts`, `review.service.test.ts`, `notification.model.test.ts`, `dashboard.service.test.ts`

**Interfaces:**
- Produces:
  - `parseBidListQuery(query: Readonly<Record<string, string | string[] | undefined>>, runMode: RunMode): { ok: true; value: BidListQuery } | { ok: false; issues: { path: string; message: string }[] }`. 스펙 §5.3의 핵심 6개(`q`·`stage`·`recommendation`·`decision`·`origin`·`sort`)에 `cursor`·`limit`(기본 20, 1~100)을 받는다. `origin` 기본값은 `mock`·`fixture` → `demo`, `live` → `live`다.
  - `signCursor(payload: CursorPayload, secret: string): string`, `verifyCursor(cursor: string, query: BidListQuery, secret: string): { ok: true; payload } | { ok: false; code: "INVALID_CURSOR" }`. 서명은 HMAC-SHA256(`node:crypto`), 본문은 base64url이다(05 §3). payload에 필터 지문(`queryFingerprint`)을 넣어, 필터가 바뀐 커서는 거절한다.
  - `BidsRepo`(포트 타입): `listBids(orgId, query, after)`, `getBid(orgId, id)`, `listAnalyses(orgId, bidId, after)`, `getAnalysis(orgId, id)`, `findRunningAnalysis(orgId, bidId)`, `findCompletedSameInput(orgId, bidId, profileRevision)`, `createAnalysisRun(...)`, `findIdempotency(orgId, key)`. 구현체는 B1에서 만든다.
  - `AnalysisQueue`(포트 타입): `enqueue(runId: string): Promise<void>`
  - `canRequestAnalysis(role: SolRole): boolean`(ADMIN·SALES·ANALYST), `canRecordReview(role: SolRole): boolean`(ADMIN·SALES)
  - `requestAnalysis(ctx: { orgId; userId; role }, bidId: string, input: unknown, idempotencyKey: string | null, deps: { repo: BidsRepo; queue: AnalysisQueue }): Promise<ServiceResult<AnalysisAccepted>>`
  - `recordReview(ctx, bidId, input: unknown, deps: { repo: ReviewRepo }): Promise<ServiceResult<Review>>`
  - `ServiceResult<T> = { ok: true; status: 200 | 201 | 202; data: T } | { ok: false; status: 400 | 403 | 404 | 409 | 429; code: ApiCode; message: string; details?: Record<string, unknown> }`. 여기서 `ApiCode`는 Task 1 오류 코드 가운데 서비스가 내는 것이다. Route Handler(B1)는 이 결과를 `apiError`·`json`으로 옮기기만 한다.
  - `safeNotificationLink(n: Notification): string`
  - `getDashboardSummary(orgId, origin, deps: { repo: DashboardRepo }, now: Date): Promise<DashboardSummary>`. `byRecommendation`은 공고별 최신 1건 기준이고(D10), `reviews.pending`은 최신 분석이 있고 사람 결정이 없는 공고 수다(D11).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `bid-query.test.ts`:
    - `parseBidListQuery({}, "mock").value.origin === "demo"`, `"live"`면 `"live"`다.
    - `sort=bogus`면 `ok:false`이고 `path: "sort"`다. `q`가 101자면 `ok:false`다.
    - `isDemo=true&origin=live`면 `ok:false`다(05 §3).
    - 서명한 커서를 같은 쿼리로 `verifyCursor`하면 `ok`다. 한 글자를 바꾸면 `INVALID_CURSOR`다. `stage`를 바꾼 쿼리로 검증해도 `INVALID_CURSOR`다.
  - `bids.service.test.ts`(가짜 repo·queue):
    - VIEWER면 `requestAnalysis`가 `403 FORBIDDEN`이다.
    - 실행 중인 분석이 있으면 `409 ANALYSIS_IN_PROGRESS`다.
    - 같은 `Idempotency-Key`에 다른 본문이 오면 `409 IDEMPOTENCY_KEY_REUSED`다. 같은 본문이면 첫 응답을 그대로 준다.
    - `force:false`이고 같은 입력의 완료 run이 있으면 `202`, `deduplicated:true`이고 queue가 불리지 않는다.
    - `force:true`면 새 run을 만들고 queue가 1회 불린다. `pollUrl === "/api/v1/analyses/{id}"`다.
    - 다른 조직 공고(`getBid → null`)는 `404 NOT_FOUND`다.
  - `review.service.test.ts`:
    - ANALYST는 `403`이다.
    - 사유가 9자면 `400 VALIDATION_ERROR`이고 `details.issues[0].path === "reason"`이다.
    - 담당자가 조직 밖이면 `404 NOT_FOUND`이고 `details.resource === "assignee"`다.
    - 정상이면 `201`이다. `decision`과 최신 권고가 다르면 `disagreementFlag=true`다.
  - `notification.model.test.ts`:
    - `link: "/bids/abc"`는 그대로다.
    - `link`가 `"https://evil.example"`, `"//evil.example"`, `"/\\evil.example"`면 각각 `/bids/{bidId}`가 된다.
  - `dashboard.service.test.ts`: 같은 공고에 COMPLETED BID run과 PARTIAL BID run이 있어도 `byRecommendation.BID === 1`이다. 결정이 없는 분석 공고 2건이면 `reviews.pending === 2`다.
- [ ] **Step 2: 실패를 확인한다.** `pnpm -C web exec vitest run server/bids`
- [ ] **Step 3: 구현한다.** 서비스는 템플릿 `task.service.ts`처럼 결과를 돌려주는 방식이다. 예상한 실패는 결과로 돌려주고, 잘못된 호출만 던진다. 비밀(`API_CURSOR_SECRET`)은 인자로 받는다. env는 B1의 Route Handler가 읽는다.
- [ ] **Step 4: PASS를 확인한다.** 이어서 `pnpm -C web lodestar`도 PASS여야 한다.
- [ ] **Step 5: 커밋한다.** `feat(web): 공고·분석·결정·알림 서비스 규칙 추가`

### Task 10: 단계 마감 검증과 증거

**Files:**
- Create: `docs/evidence/phase-3/c6-a-test-report.txt`

- [ ] **Step 1: 전체 검증을 돌린다.** 이 worktree에서 `pnpm install`(루트·web)을 한 뒤 `pnpm verify`가 exit 0이어야 한다.
- [ ] **Step 2: 브라우저 시험을 돌린다.** `pnpm -C web test:browser`가 PASS여야 한다. 실패하면 원인을 고치고, 단언을 약하게 만들지 않는다.
- [ ] **Step 3: 증거를 남긴다.** 두 명령의 마지막 요약 줄(시험 수·통과 수)과 실행 시각을 `c6-a-test-report.txt`에 적는다.
- [ ] **Step 4: 독립 검증을 받는다.** `test-server`(Task 2·9)와 `check-stub` 스킬(구현된 척하는 코드 탐지) 결과를 받고, 지적을 고친다.
- [ ] **Step 5: 커밋한다.** `test(web): C6 A단계 검증 증거 기록`

---

## B단계 미리보기 (C2 병합 뒤 별도 계획)

이 계획의 범위가 아니다. 순서만 적는다.

1. **B1**: `getMyBusinessAccess` service·repo(브랜치 복사), `BidsRepo`·`ReviewRepo`·`NotificationRepo`·`DashboardRepo` Supabase 구현, Route Handler 9개와 `PATCH /notifications/:id/read`(D8), 계약 시험(템플릿 route 시험 관례), `pnpm test:db`
2. **B2**: `web/app/(app)/(work)/layout.tsx`, `requireWork()`, 네 화면의 `page`·`loading`·`error`·`not-found`, 옛 `web/app/(app)/dashboard/page.tsx` 삭제(D1 승인됨), `app-shell.tsx`의 `NAV` 3줄과 `<TopbarStatus>` 한 줄, web env `SOL_RUN_MODE` 읽기(D2)와 `check:env` 등록(2f의 infra 커밋 뒤)
3. **B3**: E2E(1440·1280 스크린샷 `docs/evidence/phase-3/e2e/`), axe 0
4. **C**: C5 analysis job 연결(b3), C7 알림, C8 S-LIVE

## 관련 문서

- [디자인 스펙 — C6](2026-10-19-c6-screens-design.md)
- [[05-API-SPEC|05 API]]
- [[06-UI-UX|06 UI·UX]]
- [[12-ROADMAP|12 로드맵]]
- [수상 전략 계획](2026-10-18-hackathon-award-plan.md)
