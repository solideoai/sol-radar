# 참고 낙찰가 범위 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 나라장터 IT 공고 상세에 "참고 낙찰가 범위" 카드를 띄운다. 이 카드는 같은 분류·비슷한 금액대의 지난 낙찰률 사분위를 이번 공고 금액으로 바꿔 보여 준다. 마감은 2026-11-04 이다.

**Architecture:**

- 지난 공고와 낙찰 결과는 운영자 CLI(`web/worker/award-backfill.ts`)가 조달청 API 에서 한 번 받는다. 받은 것을 이어서 새 표 `public.procurement_award_history`에 넣는다.
- 웹은 그 표를 RLS(활동 회원 읽기)로 읽는다. 순수 함수로 표본을 고르고 사분위를 계산한다.
- 공고 상세에 카드 하나를 더한다.
- 도메인은 둘로 나눈다. 쓰기 쪽은 `web/server/award-history/`(service role, CLI 전용)이고, 읽기 쪽은 `web/server/award-reference/`(사용자 세션)다.

**Tech Stack:** Next.js 16 · React 19 · Tailwind v4 토큰 · Supabase(Postgres·RLS) · Vitest · PGlite 정책 시험 · Node 24 + tsx CLI

**Spec:** `polaris/specs/in-progress/2026-11-02-award-reference-price.md` (사용자 승인 2026-11-02 "승인할게 진행해")

## Global Constraints

- **카드 금지어**: 확률, 가능성, 승률, 예측, 보장, 수주 금액, 경쟁사(ADR-007, `docs/09-SECURITY.md`).
- **service role 키**: 웹 경로에서는 쓰지 않는다. CLI(`web/worker/award-backfill.ts`)만 쓴다(`docs/09-SECURITY.md:91`).
- **지난 공고 저장 위치**: `bid_notices`·`bid_revisions`에 쓰지 않는다. 새 표에만 쓴다.
- **카드를 보이는 공고**: `source = 'g2b-bid-notice'`, `is_demo = false`, 낙찰 방식 묶음이 `NEGOTIATION` 또는 `LOWER_LIMIT`인 공고만이다. 그 밖은 카드를 그리지 않는다(`null`).
- **고정값**: `AWARD_MIN_SAMPLE = 5`, `AWARD_RATIO_MIN = 0.3`, `AWARD_RATIO_MAX = 1.2`, `AWARD_LOOKBACK_MONTHS = 12`.
  - 넓히기 단계는 아래 세 가지다.
    1. 같은 분류번호 · 0.5~2배
    2. 같은 분류번호 · 1/3~3배
    3. 같은 중분류명 · 1/3~3배
- **저장하지 않는 것**: 낙찰업체명, 사업자번호, 담당자.
- **주석·문구 언어**: 주석과 화면 문구는 한국어, 식별자는 영어다. 색·글꼴은 `design/tokens.json` 토큰 유틸리티만 쓰고 raw hex 는 금지다.
- **작업자(Task A~D) 금지 사항**
  - git 상태를 바꾸지 않는다(add·commit·stash·checkout). 커밋은 메인 세션이 한다.
  - db:push, 운영 DB, 회사 서버, 조달청 실호출, 유료 API 를 쓰지 않는다.
  - `pkill`·`killall`, `.env*` 읽기를 하지 않는다.
  - 훅·가드·권한 거부에 막히면 우회하지 않는다. 멈추고 보고한다(`--no-verify`·`eslint-disable`·`any`·skip 금지).
  - 보고는 파일이 아니라 텍스트로 한다.
- **무거운 검증 감싸기**: `verify:changed`·`test:browser`·`next build`는 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/0713f978-edd3-4064-887f-e5da7f6816cf/scratchpad/verify-slot.sh <명령>`으로 감싼다. 경로가 없으면 짐작하지 말고 멈춰 보고한다.
- **새 worktree 설치**: 루트와 `web`에서 각각 `pnpm install`을 한다. `prepare` 단계의 exit 1 은 무시한다.

## Review Focus

1. **배정예산이 비고 부가세도 빈(면세) 공고**: 기준금액은 추정가격 그대로여야 한다. → Task 0 `baseAmountOf` 시험
2. **정정공고로 차수가 여럿인 공고**: 낙찰 행의 차수와 맞는 공고 차수로 이어야 하고, 없으면 같은 공고번호의 가장 큰 차수로 잇는다. → Task C `joinAwardWithNotice` 시험
3. **이번 공고가 지난 표본에 들어 있음**(재공고·같은 번호): 표본에서 빠져야 한다. → Task A `selectSample` 시험
4. **조달청 응답의 `items`가 한 건이면 배열이 아니라 객체로 옴**, 0건이면 빈 문자열로 옴: 둘 다 오류 없이 읽혀야 한다. → Task C `parseAwardItems` 시험
5. **아주 작은 금액(3,000만 원)과 큰 금액(120억 5,000만 원)**: 카드 금액이 "3,000만 원"·"120억 5,000만 원"으로 읽혀야 한다. → Task B `formatEokMan` 시험

---

## 세션 배정과 순서

| 작업 | 맡는 곳 | worktree · 브랜치 | 선행 |
| --- | --- | --- | --- |
| Task 0 계약·표 | 메인 | `award-reference-price` · `feat/award-reference-price` | 사용자 계획 확인 |
| Task S1 실호출 확인·녹음 | 메인 | 같음 | **실호출 승인** |
| Task A 읽기 도메인·정책 시험 | idle 세션 1 | `award-ref-read` · `feat/award-ref-read` | Task 0 커밋 |
| Task B 카드 화면 | idle 세션 2 | `award-ref-card` · `feat/award-ref-card` | Task 0 커밋 |
| Task C 수집 CLI | idle 세션 3 | `award-ref-ingest` · `feat/award-ref-ingest` | Task 0 + S1 커밋 |
| Task D 문서·랜딩 준비 | idle 세션 4 | `award-ref-docs` · `docs/award-ref-docs` | Task 0 커밋 |
| Task E 통합·연결 | 메인 | `feat/award-reference-price` | A·B·C |
| Task F 독립 검토 | idle 세션 5(읽기 전용) | 통합 브랜치 읽기 | E |
| Task G 운영 반영 S4~S6 | 메인 | — | F, 단계마다 승인 |
| Task H 랜딩·문서 push, 덱, 클립 | 메인 + 사용자 촬영 | D 병합 | G 운영 확인 |

- **worktree 위치**: 모두 `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/<이름>` 이다. A·B·D 는 Task 0 커밋에서 만들고, C 는 S1 커밋에서 만든다(`git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add <경로> -b <브랜치> <해시>`).
- **파일 소유**: 같은 파일은 한 작업자만 고친다. 아래 각 Task 의 Files 목록 밖은 건드리지 않는다.

---

### Task 0: 계약 타입·고정값·표 (메인)

**Files:**
- Create: `supabase/migrations/20261102000100_procurement_award_history.sql` (번호는 쓰기 직전 origin/main·다른 브랜치와 다시 확인)
- Modify: `web/lib/database.types.ts` (`pnpm db:types` 생성물)
- Create: `web/server/award-reference/award-reference.model.ts`
- Create: `web/server/award-reference/award-reference.model.test.ts`
- Create: `web/server/award-reference/index.ts`

**Interfaces:**
- Produces (`@/server/award-reference` 배럴):
  - `type AwardMethodGroup = "NEGOTIATION" | "LOWER_LIMIT" | "OTHER"`
  - `type BaseAmount = { amountKrw: number; kind: "ASSIGNED_BUDGET" | "ESTIMATED_PLUS_VAT" }`
  - `type Quartiles = { q1: number; median: number; q3: number }`
  - `type WidenStep = 1 | 2 | 3`
  - `type AwardTarget = { bidNoticeNo: string; classNo: string; className: string; midClassName: string | null; group: "NEGOTIATION" | "LOWER_LIMIT"; base: BaseAmount; priceWeight: number | null; lowerLimitRate: number | null }`
  - `type AwardSampleRow = { bidNoticeNo: string; classNo: string; midClassName: string | null; baseAmountKrw: number; awardRatio: number }`
  - `type AwardReference`는 다음 둘 가운데 하나다.
    - `{ kind: "RANGE"; group; step: WidenStep; sampleSize; periodMonths; scopeLabel; amountBand: { min: number; max: number }; base: BaseAmount; ratio: Quartiles; amountKrw: Quartiles; priceWeight; lowerLimitRate; dataAsOf: string }`
    - `{ kind: "TOO_FEW"; group; sampleSize; periodMonths; scopeLabel; priceWeight; lowerLimitRate; dataAsOf: string | null }`
    - `scopeLabel`은 분류명이다. step 3 이면 중분류명이다.
  - 고정값 `AWARD_MIN_SAMPLE`, `AWARD_RATIO_MIN`, `AWARD_RATIO_MAX`, `AWARD_LOOKBACK_MONTHS`, `AWARD_WIDEN_STEPS: readonly { step: WidenStep; scope: "CLASS" | "MID_CLASS"; min: number; max: number }[]`
  - `methodGroupOf(methodName: string | null | undefined): AwardMethodGroup`
  - `baseAmountOf(raw: { asignBdgtAmt?: string | null; presmptPrce?: string | null; vat?: string | null }): BaseAmount | null`
- 표 `public.procurement_award_history` 열 이름은 C(쓰기)와 A(읽기)가 같이 쓴다.
  - 열: `bid_notice_no`, `bid_notice_ord`, `title`, `procurement_class_no`, `procurement_class_name`, `procurement_mid_class_name`, `award_method_name`, `award_method_group`, `base_amount_krw`, `base_amount_kind`, `award_amount_krw`, `award_ratio`, `participant_count`, `opened_at`, `demand_agency`, `fetched_at`
  - 유일 키: `(bid_notice_no, bid_notice_ord)`

- [ ] **Step 1: 실패하는 시험 작성** `award-reference.model.test.ts`
  - `methodGroupOf`
    - `"협상에의한계약-협상에 의한 낙찰자 결정(SW사업)"` → `"NEGOTIATION"`
    - `"적격심사제-..."`, `"제한적최저가(낙찰하한율)"`, `"소액수의견적"` → `"LOWER_LIMIT"`
    - `"수의시담"`, `"최저가낙찰제"`, `null` → `"OTHER"`
  - `baseAmountOf`
    - `{asignBdgtAmt:"796011720"}` → `{amountKrw:796011720, kind:"ASSIGNED_BUDGET"}`
    - `{asignBdgtAmt:"", presmptPrce:"717909091", vat:"71790909"}` → `{amountKrw:789700000, kind:"ESTIMATED_PLUS_VAT"}`
    - `{asignBdgtAmt:"0", presmptPrce:"30000000", vat:""}` → `{amountKrw:30000000, kind:"ESTIMATED_PLUS_VAT"}`
    - 둘 다 비면 `null`, 숫자가 아니면 `null`
- [ ] **Step 2: 실패 확인**
  - 실행: `pnpm -C web exec vitest run server/award-reference/award-reference.model.test.ts`
  - 기대: FAIL(모듈 없음)
- [ ] **Step 3: 구현**
  - 위 타입·고정값·두 함수를 둔다. 첫 줄은 `import "server-only";`다.
  - `methodGroupOf`는 앞부분 일치로 판단한다.
  - `baseAmountOf`는 정수 원 단위만 받는다. 0 이하는 빈 값으로 본다.
  - 배럴 `index.ts`가 모두 내보낸다.
- [ ] **Step 4: 마이그레이션 작성**
  - `create table if not exists`로 위 열을 만든다.
  - 검사 제약을 둔다.
    - `award_method_group in ('NEGOTIATION','LOWER_LIMIT')`
    - `base_amount_kind in ('ASSIGNED_BUDGET','ESTIMATED_PLUS_VAT')`
    - `base_amount_krw > 0`, `award_amount_krw > 0`
    - `award_ratio between 0.3 and 1.2`
    - `award_ratio`는 `numeric(6,4)`
  - 색인 두 개: `(procurement_class_no, award_method_group, opened_at)`, `(procurement_mid_class_name, award_method_group, opened_at)`
  - 권한과 정책은 `bid_notices`를 따른다(`supabase/migrations/20261019000002_bid_notices.sql:271-281`).
    - `enable row level security`
    - `grant select ... to authenticated`
    - `drop policy if exists` + `create policy "활동 중 회원은 낙찰 이력 읽기" ... for select to authenticated using ((select public.is_active_user()))`
    - 쓰기 정책은 두지 않는다.
- [ ] **Step 5: 타입 생성·시험 통과**
  - 실행: `pnpm db:types`
  - 실행: `pnpm -C web exec vitest run server/award-reference/award-reference.model.test.ts`
  - 기대: PASS
- [ ] **Step 6: 커밋** (스펙·이 계획 포함)
  - 메시지: `feat: 참고 낙찰가 계약 타입·낙찰 이력 표`
  - 실행: `bash <verify-slot> git -C <worktree> commit -F <메시지 파일>`

### Task S1: 실호출 확인·녹음 (메인, 승인 뒤)

**Files:**
- Create: `fixtures/recorded/15129397/<오퍼레이션>.20261102.masked.json` (낙찰된 목록 현황 용역조회 1페이지 · 개찰결과 용역 목록 1페이지)
- Modify: `polaris/specs/in-progress/2026-11-02-award-reference-price.md` §4.2 결과 칸

- [ ] **Step 1: 호출**
  - 낙찰 결과 용역 조회를 최근 7일 1페이지(`numOfRows=20`)로 2~3회 부른다. 지난 공고는 기존 키로 1회, 협상·하한율 공고가 섞인 날을 고른다.
  - 키는 `infra/.env`에서 셸 env 로만 넘긴다. 세션은 파일을 열지 않는다.
- [ ] **Step 2: 판정**
  - 낙찰금액 필드 이름을 확인한다(예상 `sucsfbidAmt`). 협상 계약 행에 값이 있는지 본다.
  - 낙찰금액이 부가세 포함인지 본다(배정예산 대비 비율 분포로 판단).
  - `inqryDiv` 값의 뜻, 기간 최대 길이, `numOfRows` 최대를 확인한다.
  - **협상 행에 낙찰금액이 없으면 여기서 멈추고 사용자에게 보고한다.**
- [ ] **Step 3: 녹음**
  - 업체명·사업자번호·담당자를 `***`로 가린다. 형식은 기존 녹음 파일과 같다(`schemaVersion: "sol-recorded/v0.1"`).
- [ ] **Step 4: 커밋**
  - 메시지: `chore: 낙찰정보서비스 실응답 녹음`

### Task A: 읽기 도메인·정책 시험 (idle 세션 1)

**Files:**
- Modify: `web/server/award-reference/award-reference.model.ts` (함수 추가. Task 0 이후 A 소유)
- Modify: `web/server/award-reference/award-reference.model.test.ts`
- Create: `web/server/award-reference/award-reference.repo.ts`
- Create: `web/server/award-reference/award-reference.service.ts`
- Create: `web/server/award-reference/award-reference.service.test.ts`
- Modify: `web/server/award-reference/index.ts`
- Modify: `scripts/database.test.mjs` (끝에 `describe` 하나 추가)

**Interfaces:**
- Consumes: Task 0 의 타입·고정값
- Produces:
  - `quartilesOf(values: readonly number[]): Quartiles` (선형 보간, Postgres `percentile_cont`와 같은 값)
  - `selectSample(target: AwardTarget, rows: readonly AwardSampleRow[]): { step: WidenStep; rows: AwardSampleRow[] } | null`
  - `buildAwardReference(target: AwardTarget, rows: readonly AwardSampleRow[], meta: { dataAsOf: string | null; periodMonths: number }): AwardReference`
  - `type AwardReferenceRepo`
    - `loadTarget(bidId: string): Promise<AwardTarget | null>`
    - `loadCandidates(q: { classNo: string; midClassName: string | null; group: "NEGOTIATION" | "LOWER_LIMIT"; minBase: number; maxBase: number; openedSince: string }): Promise<AwardSampleRow[]>`
    - `loadDatasetMeta(): Promise<{ dataAsOf: string | null; earliestOpenedAt: string | null }>`
  - `getAwardReference(bidId: string, deps?: { repo?: AwardReferenceRepo; now?: Date }): Promise<AwardReference | null>` (배럴 공개)

- [ ] **Step 1: 실패하는 시험** `award-reference.model.test.ts`에 더한다.
  - `quartilesOf`
    - `[1,2,3,4]` → `{q1:1.75, median:2.5, q3:3.25}`
    - `[0.9]×5` → 모두 0.9
  - `selectSample`
    - 같은 분류·0.5~2배 6건 → step 1, 6건
    - 그 범위 4건 + 1/3~3배 2건 더 → step 2, 6건
    - 분류 3건 + 같은 중분류 다른 분류 3건 → step 3, 6건
    - 모두 합쳐 4건 → `null`
    - 이번 공고 번호와 같은 행은 어느 단계에서도 세지 않는다
  - `buildAwardReference`
    - 기준금액 796,011,720, 비율 `[0.861,0.894,0.927,...]` → `amountKrw`는 `Math.round(base × ratio)`
    - 5건 미만 → `kind:"TOO_FEW"`, `sampleSize`는 가장 넓힌 단계의 건수
    - step 3 → `scopeLabel`이 중분류명
- [ ] **Step 2: 실패 확인**
  - 실행: `pnpm -C web exec vitest run server/award-reference/award-reference.model.test.ts`
  - 기대: FAIL
- [ ] **Step 3: 구현** 세 함수
  - 후보는 넓힌 단계(1/3~3배, 분류 또는 중분류)로 한 번에 받는다. 단계별 거르기는 함수 안에서 한다.
- [ ] **Step 4: repo**
  - `getSupabase()`(사용자 세션, `@/server/supabase`)를 쓴다. 패턴은 `web/server/watchlist/watchlist.repo.ts`다.
  - `loadTarget`
    - `bid_notices`의 `source`, `is_demo`, `latest_revision`과 그 revision `raw_payload`의 필드를 읽는다: `bidNtceNo`, `pubPrcrmntClsfcNo`, `pubPrcrmntClsfcNm`, `pubPrcrmntMidClsfcNm`, `sucsfbidMthdNm`, `asignBdgtAmt`, `presmptPrce`, `VAT`, `bidPrceEvlRt`, `sucsfbidLwltRate`
    - 다음 경우 `null`이다: g2b 가 아님, 데모, `methodGroupOf`가 `OTHER`, 분류번호 없음, 기준금액 없음
  - `loadCandidates`
    - 분류번호 일치 또는 중분류명 일치(`or`)
    - 같은 묶음, 기준금액 범위, `opened_at >= openedSince`
  - `loadDatasetMeta`
    - `max(fetched_at)`, `min(opened_at)`
- [ ] **Step 5: service**
  - 순서: `loadTarget` → null 이면 null → `loadCandidates`(minBase = base/3, maxBase = base×3, openedSince = now − 12개월) → `buildAwardReference`
  - `periodMonths` = min(12, `earliestOpenedAt`부터 지금까지 개월 수, 올림)
  - 표에 행이 하나도 없으면(`dataAsOf === null`) null 이다. 수집 전에는 카드를 숨긴다.
  - 시험 `award-reference.service.test.ts`는 가짜 repo 로 세 갈래를 확인한다: null 대상, 빈 표, RANGE.
- [ ] **Step 6: 정책 시험** `scripts/database.test.mjs` 끝에 `describe("낙찰 이력 — 읽기 전용 (20261102000100)")`를 더한다. 기존 `describe("SOL RADAR 표 정책 …")`의 회원·비로그인 클라이언트 만드는 방법을 따른다.
  - 활동 회원 select 성공
  - 비로그인 select 0행 또는 거부
  - 활동 회원 insert 거부
- [ ] **Step 7: 통과 확인**
  - 실행: `pnpm -C web exec vitest run server/award-reference`
  - 실행: `node --test --test-name-pattern "낙찰 이력" scripts/database.test.mjs`
  - 기대: 모두 PASS
- [ ] **Step 8: 보고** (커밋은 메인)
  - 바꾼 파일 목록, 시험 출력 마지막 줄, 막힌 점

### Task B: 카드 화면 (idle 세션 2)

**Files:**
- Create: `web/app/(app)/(work)/bids/[id]/award-reference-card.tsx`
- Create: `web/app/(app)/(work)/bids/[id]/award-reference-copy.ts`
- Create: `web/app/(app)/(work)/bids/[id]/award-reference-copy.test.ts` (`formatEokMan`, 일반 vitest)
- Create: `web/app/(app)/(work)/bids/[id]/award-reference-card.browser.test.tsx` (렌더·폭. 같은 폴더 `what-if.browser.test.tsx` 방식, `vitest.browser.config.ts`가 돌린다)

**Interfaces:**
- Consumes: `import type { AwardReference } from "@/server/award-reference"` (Task 0)
- Produces:
  - `AwardReferenceCard({ reference }: { reference: AwardReference }): JSX.Element`
  - `formatEokMan(krw: number): string` (copy 파일, 만 원 아래 버림)

- [ ] **Step 1: 실패하는 시험**
  - `formatEokMan`
    - 685366091 → `"6억 8,536만"`
    - 30000000 → `"3,000만"`
    - 12050000000 → `"120억 5,000만"`
    - 100000000 → `"1억"`
  - RANGE 렌더
    - 제목 "참고 낙찰가 범위"
    - 큰 숫자 `"{q1} ~ {q3} 원"`
    - "중간값"
    - 기준 줄에 `"최근 12개월"`·`"38건"`
    - NEGOTIATION·priceWeight 10 → `"기술 90 : 가격 10"`
    - LOWER_LIMIT·lowerLimitRate 88 → `"낙찰하한율은 88%"`
    - step 3 → `"중분류로 넓힘"`
  - TOO_FEW 렌더: `"비슷한 지난 낙찰이 적어 범위를 보여 주지 않습니다"`, 큰 숫자 없음
  - 금지어: 렌더된 전체 글자가 `/확률|가능성|승률|예측|보장|수주 금액|경쟁사/`에 걸리지 않는다
- [ ] **Step 2: 실패 확인**
  - `formatEokMan` 시험은 `award-reference-copy.test.ts`, 렌더·금지어 시험은 `award-reference-card.browser.test.tsx`에 둔다.
  - 실행: `pnpm -C web exec vitest run "app/(app)/(work)/bids/[id]/award-reference-copy.test.ts"`
  - 실행: `bash <verify-slot> timeout -k 30 900 pnpm -C web test:browser -- "app/(app)/(work)/bids/[id]/award-reference-card.browser.test.tsx"`
  - 기대: FAIL
- [ ] **Step 3: 구현** 스펙 §2 A안 문구 그대로
  - 출처 줄: `"조달청 낙찰정보 · {dataAsOf YYYY-MM-DD} 기준"`
  - 중간값 줄: `"비슷한 공고 가운데 절반이 이 사이에서 낙찰됐습니다 · 중간값 {median} 원 ({배정예산|추정가격+부가세}의 {xx.x}%)"`
  - 기준 줄: `"기준: {scopeLabel} · {협상 계약|낙찰하한율 방식} · 금액 {min}~{max}배 · 최근 {n}개월 · {sampleSize}건"`
    - 1/3 은 `"0.33"`으로 적는다
    - step 3 이면 `" · 중분류로 넓힘"`을 붙인다
  - 고지 줄: `"지난 낙찰값을 모은 참고 값입니다. 최종 투찰가는 담당자가 정합니다."`
  - 막대: 가운데 절반 띠 + 중간값 선. 축은 기본 80~100%이고, q1·q3 가 벗어나면 5%p 여유를 두고 넓힌다.
  - 섹션에는 `aria-labelledby`를 두고, 숫자에는 `tabular-nums`를 쓴다.
  - 문구 상수는 copy 파일에 둔다. 색은 토큰 유틸리티만 쓴다(`design-system` 스킬).
- [ ] **Step 4: 통과 확인** 같은 명령으로 PASS
- [ ] **Step 5: 폭 확인**
  - 360·390·768·1280·1440px 에서 카드만 그린 브라우저 시험 스크린샷으로 확인한다(경로 규칙은 메모 `vitest-browser-screenshot-path`: `web/test-results`에 찍고 보고에 경로를 적는다).
  - 기준: 가로 넘침 없음, 큰 숫자 줄바꿈 자연스러움
  - 실행: `bash <verify-slot> timeout -k 30 900 pnpm -C web test:browser -- <그 파일>`
- [ ] **Step 6: 보고** (커밋은 메인): 파일, 시험 출력, 스크린샷 경로

### Task C: 수집 CLI (idle 세션 3, S1 뒤)

**Files:**
- Create: `web/server/award-history/award-history.model.ts` (응답 파싱·잇기·행 만들기, 순수)
- Create: `web/server/award-history/award-history.model.test.ts`
- Create: `web/server/award-history/award-history.fetch.ts` (`createG2bHttp`·`splitG2bWindow` 재사용, `web/server/ingestion` 배럴로 가져온다)
- Modify: `web/server/ingestion/index.ts` (배럴에 `createG2bHttp`와 필요한 타입 내보내기 한 줄 추가. 지금은 `splitG2bWindow`·`buildG2bListUrl`만 나간다)
- Create: `web/server/award-history/award-history.repo.ts` (service role 클라이언트로 upsert. 만드는 방법은 `web/worker/score-rescore.ts`를 따른다)
- Create: `web/server/award-history/index.ts`
- Create: `web/worker/award-backfill.ts`
- Create: `web/worker/award-backfill.test.ts` (인자 해석만)
- Modify: `web/package.json` (`"award:backfill": "node --conditions=react-server --import tsx worker/award-backfill.ts"`)

**Interfaces:**
- Consumes: Task 0 의 `methodGroupOf`, `baseAmountOf`, `AWARD_RATIO_MIN/MAX`(배럴), S1 녹음 파일과 필드 이름
- Produces:
  - `parseAwardItems(body: unknown): AwardApiRow[]`
  - `parseNoticeItems(body: unknown): NoticeApiRow[]`
  - `joinAwardWithNotice(award: AwardApiRow, notices: ReadonlyMap<string, NoticeApiRow[]>): AwardHistoryInsert | { skipped: "NO_NOTICE" | "OTHER_METHOD" | "NO_BASE" | "RATIO_OUT_OF_RANGE" | "NO_CLASS" }`
  - CLI 사용법: `pnpm -C web award:backfill -- --env-file <운영 DB env> --env-file <API 키 env> (--check | --dry-run | --apply) [--months 12] [--max-calls 400]`

- [ ] **Step 1: 실패하는 시험** (S1 녹음 파일 사용)
  - `parseAwardItems`: `items` 배열, 객체 한 건, 빈 문자열 모두 배열로 돌려준다
  - `joinAwardWithNotice`
    - 차수 일치면 그 차수
    - 없으면 같은 번호 최대 차수
    - 공고 없음 → `NO_NOTICE`
    - 수의시담 → `OTHER_METHOD`
    - 낙찰률 1.5 → `RATIO_OUT_OF_RANGE`
    - 정상 행의 `award_ratio`는 소수 넷째 자리
- [ ] **Step 2: 실패 확인**
  - 실행: `pnpm -C web exec vitest run server/award-history worker/award-backfill.test.ts`
- [ ] **Step 3: 구현** 모델·fetch·repo
  - 지난 공고는 `getBidPblancListInfoServc`를 `inqryDiv=1`로 기간을 잘라 받는다. 기간은 개찰일 범위 시작보다 2개월 앞부터다.
  - 낙찰은 S1 에서 확인한 오퍼레이션으로 개찰일 범위를 받는다.
  - 호출 수가 `--max-calls`에 닿으면 멈춘다. 그때 받은 데까지만 처리하고 "중단: 호출 상한"을 출력한다.
  - upsert 는 500행 묶음, `onConflict: "bid_notice_no,bid_notice_ord"`다.
- [ ] **Step 4: CLI**
  - `--env-file`은 여러 번 받아 `node:util` `parseEnv`로 합친다(`scripts/ops/close-stale-ingest-runs.mjs:24-70` 패턴). 기본값은 없다.
  - `--check`: 키 이름 4개 존재 여부(`G2B_AWARD_SERVICE_KEY`, `G2B_BID_NOTICE_SERVICE_KEY`, Supabase URL, service role)와 DB host 만 출력한다. 값은 출력하지 않는다.
  - `--dry-run`: 기간 조각별 `totalCount`를 `numOfRows=1`로 세어 예상 호출 수를 계산한다. 상한 안에서 받아 잇기까지 한 뒤 다음을 한 줄 JSON 으로 출력한다. 쓰기는 없다.
    - 저장 예정 수
    - 건너뛴 이유별 수
    - 묶음별 수
    - 분류 상위 10개
  - `--apply`: dry-run 과 같고, 마지막에 upsert 한다.
  - 키 값이 들어간 URL 은 로그에 남기지 않는다(`createG2bHttp`가 가린다).
- [ ] **Step 5: 통과 확인**
  - 같은 vitest 명령으로 PASS
  - `pnpm -C web exec tsc --noEmit -p .`는 slot 으로 감싼다
- [ ] **Step 6: 보고** (실호출·운영 실행은 하지 않는다)

### Task D: 문서·랜딩 준비 (idle 세션 4)

**Files:**
- Modify: `docs/evidence/competitors/2026-10-29-competitors.md` (⑬ 정의 넓힘, 경쟁사 칸 유지 이유 한 줄, SOL 칸 근거는 "운영 확인 뒤 채움" 자리)
- Modify: `web/components/landing/comparison-section.tsx` (`sol: "yes"`, hint `"지난 낙찰가 · 사정율 · 낙찰예측가"`)
- Modify: `web/e2e/landing-sections.spec.ts:51,71` (기대 칸 값)
- Modify: `docs/18-HACKATHON.md` (경쟁 비교 표 가격 줄·"관찰" 문단, 질의응답 "낙찰 확률은 안 보여 주나?"에 한 줄)
- Modify: `docs/16-DECISIONS.md` (ADR-077 행·본문: 가격 줄 변경, 확률 표시 없음 유지, 한 번 채우기·기간·표본 규칙, 이 기능만 11-04 동결 예외. 번호는 쓰기 직전 origin/main 확인)
- Modify: `docs/19-DEMO-SCENARIO.md` (실공고 상세 카드 장면 촬영 경로, 공고는 "dry-run 뒤 메인이 정함" 자리)
- Modify: `docs/submission/slides-spec.md` (비교 장표 가격 줄·발표자 노트, 부록 A 새 클립 행)

- [ ] **Step 1**: 위 파일을 고친다. Obsidian frontmatter·위키링크 규약을 지킨다. 금지어를 지킨다.
- [ ] **Step 2**: 확인
  - 실행: `pnpm -C web exec playwright test e2e/landing-sections.spec.ts`(slot 으로 감싼다)
  - 실행: `pnpm format:check`
- [ ] **Step 3**: 보고. 이 브랜치는 운영 화면 확인(Task G) 뒤에만 병합한다.

### Task E: 통합·연결 (메인)

**Files:**
- Modify: `web/app/(app)/(work)/bids/[id]/page.tsx` (`Promise.all`에 `getAwardReference(id).catch(() => { console.error(JSON.stringify({ event: "bid_detail_award_reference_failed", bidId: id })); return null; })`, prop `awardReference`)
- Modify: `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx` (prop `awardReference: AwardReference | null`. `WhatIfBand` 블록 다음, "단계 이력" `section` 앞에 `{awardReference !== null && <AwardReferenceCard reference={awardReference} />}`)

- [ ] **Step 1**: A·B·C diff 와 시험을 직접 돌려 확인한 뒤, 각 worktree 에서 커밋하고 `feat/award-reference-price`에 병합한다.
- [ ] **Step 2**: 연결 두 파일을 고친다.
- [ ] **Step 3**: 실행: `bash <verify-slot> pnpm verify:changed --base a7f17a1a`. 기대: 통과.
- [ ] **Step 4**: 커밋 `feat(web): 공고 상세 참고 낙찰가 범위 카드`

### Task F: 독립 검토 (idle 세션 5, 읽기 전용)

- [ ] **Step 1**: 검토 범위는 `git -C <worktree> diff a7f17a1a..feat/award-reference-price`다. 보는 것은 다음과 같다.
  - Global Constraints 위반
  - RLS
  - service role 이 웹 경로로 새는지
  - 금지어
  - Review Focus 5개가 시험으로 잡혔는지
  - 사분위·넓히기 규칙이 스펙 §3 과 같은지
- [ ] **Step 2**: 심각도 순 텍스트로 보고한다. 고치지 않는다.

### Task G: 운영 반영 (메인, 단계마다 사용자 승인)

- [ ] **S4 운영 표**: 마이그레이션 SQL 을 Supabase MCP 로 운영에 직접 실행한다(ADR-075 방식, `db:push` 금지). 확인 SELECT: 표·정책·색인
- [ ] **S5 한 번 채우기**: 사용자가 `!`로 실행한다.
  1. `pnpm -C web award:backfill -- --env-file <main>/.env.local --env-file <main>/infra/.env --check`
  2. 같은 명령에 `--dry-run`
  3. 같은 명령에 `--apply`
  - 확인 SELECT: 묶음·분류별 건수, 낙찰률 범위
  - 범위가 나오는 촬영 공고를 고른다. 동국대 S-LIVE 공고를 먼저 본다.
- [ ] **S6 main push**: `git push origin <통합 해시>:refs/heads/main`(게이트 통과). Vercel READY 를 확인한다.
  - 운영 확인: 협상 1건·하한율 1건 상세를 1440·390 에서 본다.
  - 데이터가 없는 공고(LH)에는 카드가 없어야 한다.

### Task H: 랜딩·문서·덱·클립 (메인 + 사용자)

- [ ] D 브랜치에 운영 확인일·공고번호를 채우고 병합한다. 그 뒤 main push 를 한다(승인).
- [ ] HTML 덱(`docs/submission/slides/index.html`)을 고친다. 먼저 백업을 `/Users/leegwanghui/dev/hackathon/sol-radar-backups/deck/`에 만든다. 비교 장표 SOL 가격 칸을 ✓ 로, 노트에서 "투찰 가격 분석은 하지 않습니다"를 바꾼다.
- [ ] `docs/PROGRESS.md` 작업 로그·기능 표를 갱신하고, `docs/evidence/award-reference/20261103-rollout.md`에 운영 반영 기록을 남긴다.
- [ ] 사용자가 클립을 촬영한다(19-DEMO-SCENARIO 새 장면).
