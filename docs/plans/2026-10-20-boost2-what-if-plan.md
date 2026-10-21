---
title: "계획 — BOOST-2 가정 재계산"
doc: "plan-boost2-what-if"
status: draft
tags:
  - sol-radar
  - hackathon
  - plan
created: 2026-10-20
updated: 2026-10-20
---

# BOOST-2 가정 재계산 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고 상세에서 미보유 자격을 "보유 가정"으로 켜면 저장된 분석 입력으로 점수·권고를 다시 계산해 원래 → 가정을 보여 준다. DB 쓰기는 없다.

**Architecture:** 순수 함수(`web/server/scoring/what-if.ts`)가 `input_snapshot`에 가정을 적용하고 `analyze()`를 부른다. `web/server/bids`의 서비스·repo가 run 의 스냅샷을 RLS 로 읽는다. Route Handler `POST /api/v1/analyses/{id}/what-if`가 서비스를 부른다. 화면은 상세 진입 때 빈 가정으로 한 번 불러 가정 가능 목록을 받고, 스위치마다 다시 부른다.

**Tech Stack:** Next.js 16 Route Handler, zod, Supabase(anon + RLS), Vitest(단위·계약·브라우저), Playwright(e2e-auth).

**Spec:** [[2026-10-20-demo-boost-design|설계]] §5·§6·§11 (`docs/plans/2026-10-20-demo-boost-design.md`)

## Global Constraints

- DB 쓰기 0: `score_runs`·`bid_reviews`·`audit_logs`·알림·outbox 불변(설계 §5.2, F3).
- 가정 계산은 `kev = null`. 원래 값도 같은 스냅샷에서 `kev = null`로 다시 계산한다(설계 §5.2).
- `config`·`bid`·`extraction`·`team`은 스냅샷 그대로. 바뀌는 것은 `profile.licenses`뿐(v1).
- 새 카드·띠에 확률·승률 문구 금지(F1).
- 띠 문구(정확히): "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다." + "결정 모델 의견은 가정에 포함하지 않았습니다."
- 오른쪽 "참여 판단" 패널은 원래 값을 유지한다(설계 §6).
- 도메인은 배럴로만 import. `import "server-only"`. `eslint-disable`·`any`·skip 금지.
- 무거운 검증(`pnpm verify`·`test:browser`·e2e·build)은 3e 공용 슬롯 스크립트로 감싼다. E2E 는 격리 Supabase·격리 compose 로만.
- 작업 폴더 `sol-radar-worktrees/demo-boost`(브랜치는 구현용 새 브랜치). main 병합은 ADR-037 정본 반영 뒤 3e 게이트.

## Review Focus

1. 가정 0개 → 원래와 가정의 점수·권고·자격 판정이 같다 → Task 1 시험.
2. 가정 가능하지 않은 코드(이미 보유, 사전 밖, 다른 공고의 코드) → 400, 계산 안 함 → Task 1·2 시험.
3. QUEUED·RUNNING run(스냅샷 없음) → 409 `ANALYSIS_IN_PROGRESS`, FAILED·스냅샷 파싱 실패 → 404 `{resource:"analysis", reason:"NO_SNAPSHOT"}` → Task 2 시험.
4. 다른 조직 run → 404(없는 것과 같음) → Task 2 계약 시험.
5. 스위치 연타 → 마지막 요청 결과만 그린다(앞 요청 응답 무시) → Task 4 브라우저 시험.

---

### Task 1: 가정 순수 함수

**Files:**
- Create: `web/server/scoring/what-if.ts`, `web/server/scoring/what-if.test.ts`
- Modify: `web/server/scoring/index.ts`(배럴 export)

**Interfaces:**
- Consumes: `analyze`, `analysisInputSchema`, `QUALIFICATION_CODES`, `QualificationCode`, `test-support.ts`의 `buildInput`(시험만)
- Produces:
  - `type Assumption = { kind: "QUALIFICATION"; code: QualificationCode }`
  - `type WhatIfSummary = { score: number; recommendation: Recommendation; qualificationStatus: QualificationOutcome; factors: { factor: FactorKey; points: number; maxPoints: number }[]; checks: { id: string; requirementName: string; requirementCode: string | null; outcome: QualificationOutcome; reasonCode: string | null }[] }`
  - `type WhatIfOutcome = { ok: true; assumable: QualificationCode[]; before: WhatIfSummary; after: WhatIfSummary } | { ok: false; rejected: Assumption[] }`
  - `function whatIf(rawSnapshot: unknown, assumptions: Assumption[]): WhatIfOutcome | null` (스냅샷 파싱 실패 → `null`)

가정 가능 = `kev=null` 로 계산한 원래 결과의 필수 항목 가운데 `requirementCode`가 `QUALIFICATION_CODES` 키이고, `outcome === "NOT_SATISFIED"` 또는 (`outcome === "NEEDS_REVIEW"` 이고 `reasonCode === "COMPANY_EVIDENCE_MISSING"`)인 것. 적용 = 같은 코드가 `profile.licenses`에 있으면 `status: "HELD"`·`validUntil` 제거, 없으면 `{ code, name: QUALIFICATION_CODES[code].name, status: "HELD" }` 추가.

- [ ] **Step 1: 실패 시험 작성** — `what-if.test.ts`
  - `FX-03 정보통신공사업 가정 → NO_BID 에서 WATCH, 점수 68 그대로`: `whatIf(buildInput("FX-03"), [{kind:"QUALIFICATION",code:"ICT_CONSTRUCTION"}])` → `before.recommendation === "NO_BID"`, `after.recommendation === "WATCH"`, `before.score === 68`, `after.score === 68`, `after.qualificationStatus === "SATISFIED"`.
  - `가정 0개 → before 와 after 가 같다`(FX-01·FX-02·FX-03): `toEqual`.
  - `assumable 은 FX-03 에서 ["ICT_CONSTRUCTION"]`.
  - `가정 가능하지 않은 코드 → ok:false`: FX-03 에 `SW_BUSINESS_REG`(이미 충족) → `{ ok: false, rejected: [...] }`.
  - `입력 스냅샷을 바꾸지 않는다`: 호출 전후 `structuredClone` 비교.
  - `스냅샷이 스키마에 안 맞으면 null`: `whatIf({}, [])` → `null`.
- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/scoring/what-if.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — 위 Interfaces 대로. `analyze()`·계산식은 고치지 않는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `pnpm -C web exec vitest run server/scoring` 전체 PASS(골든 94/72/68 불변)
- [ ] **Step 5: 커밋** — `feat(scoring): 가정 재계산 순수 함수 추가`

### Task 2: 서비스·repo·Route Handler

**Files:**
- Modify: `web/server/bids/bids.repo.ts`(포트), `web/server/bids/bids.supabase.ts`(구현), `web/server/bids/index.ts`
- Create: `web/server/bids/what-if.service.ts`, `web/server/bids/what-if.service.test.ts`, `web/app/api/v1/analyses/[id]/what-if/route.ts`, `web/app/api/v1/what-if-contract.test.ts`
- Modify: 기존 fake repo(`bids.service.test.ts`·`bids-contract.test.ts`의 `BidsRepo` 가짜)에 새 메서드 기본값

**Interfaces:**
- Consumes: Task 1 `whatIf`, `Assumption`, `WhatIfOutcome`
- Produces:
  - `BidsRepo.getAnalysisSnapshot(orgId: string, id: string): Promise<{ status: AnalysisStatus; inputSnapshot: unknown } | null>` — `score_runs` 에서 `status,input_snapshot` 만, `.eq("id").eq("org_id")`
  - `computeWhatIf(orgId: string, id: string, body: unknown, deps: { repo: BidsRepo }): Promise<ServiceResult<{ assumable: string[]; before: WhatIfSummary; after: WhatIfSummary }>>`
  - 본문 zod: `{ assumptions: z.array(z.strictObject({ kind: z.literal("QUALIFICATION"), code: z.string().min(1).max(64) })).max(10) }`

오류 대응: 본문 오류·가정 불가 → 400 `VALIDATION_ERROR`(`details.issues`, 가정 불가는 `path:"assumptions"`, `rejected`). run 없음·다른 조직 → 404 `{resource:"analysis"}`. QUEUED·RUNNING → 409 `ANALYSIS_IN_PROGRESS`. FAILED·`whatIf`가 `null` → 404 `{resource:"analysis", reason:"NO_SNAPSHOT"}`. 라우트는 reviews POST 처럼 `readJsonBody` → `bodyTooLarge()`. 역할 제한 없음(읽기 계산).

- [ ] **Step 1: 실패 시험** — 서비스: 위 다섯 갈래 + "repo 쓰기 메서드를 하나도 부르지 않는다"(가짜 repo 의 쓰기 메서드가 `vi.fn` 이고 호출 0). 계약: 비로그인 401, CSRF 헤더 없음 403 `CSRF_REJECTED`, UUID 아닌 id 404, 다른 조직 404, FX-03 스냅샷 200 모양(`assumable`·`before`·`after`).
- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/bids/what-if.service.test.ts app/api/v1/what-if-contract.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 + `pnpm -C web exec vitest run app/api/v1 server/bids` PASS, `pnpm -C web lodestar` 통과
- [ ] **Step 5: 커밋** — `feat(api): 분석 가정 재계산 API 추가`

### Task 3: 디자인 스펙

**Files:** Create: `docs/plans/2026-10-20-boost2-what-if-ui.md`(web-designer 에이전트)

- [ ] **Step 1:** web-designer 에게 설계 §5.1·§6·Global Constraints 문구를 주고 스위치·띠의 상태(불러오는 중·오류·가정 없음·가정 있음), 1440·1280 배치, 토큰·shadcn 부품 매핑을 받는다. Task 1·2 와 나란히 해도 된다.
- [ ] **Step 2:** 사용자에게 스펙을 보여 주고 승인받는다.

### Task 4: 화면

**Files:**
- Create: `web/app/(app)/(work)/bids/[id]/request-what-if.ts`, `web/components/bids/what-if-band.tsx`, `web/components/bids/what-if.browser.test.tsx`
- Modify: `web/components/bids/qualification-checklist.tsx`(선택 prop `assumable?: ReadonlySet<string>`, `assumed?: ReadonlySet<string>`, `onToggleAssumption?: (code: string) => void`), `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx`(상태·요청·띠 배치)

**Interfaces:**
- Consumes: Task 2 응답 모양, `api-envelope.ts`의 `JSON_HEADERS`·`failureOf`
- Produces: `requestWhatIf(analysisId: string, codes: string[]): Promise<{ ok: true; data: WhatIfResponse } | ({ ok: false } & ApiFailure)>`

동작: 최신 분석이 COMPLETED·PARTIAL 이고 필수 항목에 `NOT_SATISFIED` 또는 `COMPANY_EVIDENCE_MISSING`가 있을 때만 진입 시 빈 가정으로 한 번 부른다. `assumable`에 든 행에만 스위치. 연타 시 마지막 요청만 반영(AbortController). 가정이 하나라도 켜지면 분석 요약 띠 아래에 `WhatIfBand`. "가정 지우기"는 상태만 비운다.

- [ ] **Step 1: 실패 시험** — 띠가 원래·가정 권고·점수를 그린다. 문구 두 줄 정확히 일치. 띠 안에 "확률"·"승률" 글자가 없다. 스위치 연타 시 마지막 응답만 그린다. 결정 패널의 권고는 바뀌지 않는다.
- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run --config vitest.browser.config.ts components/bids/what-if.browser.test.tsx`
- [ ] **Step 3: 구현**(Task 3 스펙대로)
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 기존 `bid-detail-view.browser.test.tsx` PASS
- [ ] **Step 5: 커밋** — `feat(web): 공고 상세 가정 재계산 화면`

### Task 5: E2E·증거

**Files:** Create: `web/e2e-auth/what-if.write.spec.ts`, `docs/evidence/boost2/`(스크린샷·출력)

- [ ] **Step 1:** 격리 Supabase + 격리 compose 에서 `pnpm db:seed`·`demo:preanalyze` 뒤, sales 로그인 → FX-03 → "정보통신공사업 등록" 스위치 → 띠 "NO-BID → WATCH", 68 → 68 → 결정 패널 NO-BID 유지 → 새로고침 뒤 띠 없음 → `GET /api/v1/bids/{FX-03}/reviews` 건수 전후 같음.
- [ ] **Step 2:** `pnpm -C web test:e2e:auth -- what-if` PASS. 1440·1280 스크린샷 저장.
- [ ] **Step 3:** 슬롯 스크립트로 `pnpm verify` 통과, security-auditor 점검(쓰기 없음·RLS·확률 문구).
- [ ] **Step 4: 커밋** — `test(web): 가정 재계산 E2E·증거 추가`

### Task 6 (선택, 시간이 남을 때만): 기술 보유 가정

설계 §5.1 표 둘째 줄. `Assumption`에 `{ kind: "TECHNOLOGY"; name: string }`를 더하고 `profile.technologies`에 추가한다. 데모(설계 §11-2)는 쓰지 않으므로 10-22 까지 Task 1~5 가 green 일 때만 한다.

## 이 계획 밖

- BOOST-1: 게이트(분포 측정) 결과를 보고 별도 계획.
- ADR-037 정본 반영: 45 가 알려 줄 `docs/sync-6` 6-1 끝 해시에서 새 브랜치로, diff 는 3e 전에 45 에게.
