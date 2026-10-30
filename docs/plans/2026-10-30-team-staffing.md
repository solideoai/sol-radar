---
title: "추천 공고 팀별 인력 배치 구현 계획"
status: draft
tags: [sol-radar, plan, workforce, hackathon]
updated: 2026-10-30
---

# 추천 공고 팀별 인력 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/workforce` 에서 추천 공고 3건을 한 번에 불러오고, 공고마다 "어떤 역할이 몇 명 필요하고 어느 팀의 누가 맞는지"와 팀별로 "어느 공고에 누구를 내야 하는지"를 보인다.

**Architecture:** 계산은 지금 `simulateWorkforce` 가 읽는 분석 스냅샷(`input_snapshot`)과 현재 인력 명부만 쓴다. 공고 원문 역할("개발")을 직무 코드(`DEVELOPER`)로 바꾸는 대응표를 `web/server/shared` 에 두고, 역할별 필요·팀별 묶음·팀×공고 표를 순수 함수(`web/server/workforce/team-plan.ts`)로 만든다. 추천 공고는 기존 `GET /api/v1/opportunities` 의 추천순(ADR-069)으로 가져온다. 저장하지 않는다.

**Tech Stack:** Next.js 16 `web/`, 서버 도메인 `web/server/workforce`, 공용 `web/server/shared`, Vitest(노드·브라우저).

**Spec:** [[2026-10-29-feature-backlog|기능 백로그]] "2 + 8. Team staffing for recommended bids (merged)" 와 결정 D2 1안(저장 없이 배치 제안만).

## Global Constraints

- 저장하지 않는다(ADR-021, 백로그 D2 1안). 새 표·마이그레이션을 만들지 않고 `assignments` 에 쓰지 않는다.
- `web/server/scoring`·`web/server/analysis` 는 고치지 않는다. 분석 입력과 FX-02 점수(촬영값)는 그대로다.
- 금지 문구: 승률·확률·가능성·수주 금액·점유율·경쟁사. "부족 n명"은 후보 수 비교이며 인력 부족 확정이 아니라고 화면에 적는다.
- 화면 확인은 1440px·1280px 두 폭. 모바일 폭은 확인하지 않는다.
- 도메인 import 는 배럴(`@/server/<도메인>`)로만, `../` 대신 `@/`. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip` 금지.
- 사용자에게 보이는 글자·주석은 한국어, 식별자는 영어.
- 화면 동결 2026-11-01 전에 main 에 들어가야 한다. push(=Vercel 운영 배포)는 사용자 승인 뒤 메인 세션이 한다.

## Review Focus

1. 공고 역할 문구가 대응표에 없다(예: "감리원") → 그 역할은 `roleCode: null`, 팀 목록 비움, `shortfall = minCount`, 화면에 "직무 대응 없음 · 사람이 확인"이다. 다른 직무로 짐작하지 않는다. (Task 2 시험)
2. 실공고 대부분은 `staffing` 이 UNKNOWN 이다 → `roleNeeds` 는 빈 배열, 화면은 "역할 정보 없음"과 예산 구간 FTE, 그리고 기술 일치 후보의 팀 묶음을 보인다. (Task 2·3 시험)
3. 추천 공고가 0건이다 → 안내 문구를 보이고, 선택과 결과를 바꾸지 않고, 시뮬레이션을 부르지 않는다. (Task 3 시험)
4. 같은 사람이 두 공고의 후보다 → 팀×공고 표의 두 칸에 모두 나오고, 기존 "공고 간 공유 후보" 경고도 그대로 나온다. (Task 2 시험)
5. 부서가 없는 직원(`department: null`) → "부서 미지정" 묶음에 들어간다. 사라지지 않는다. (Task 2 시험)

---

### Task 1: 직무 코드 대응표

**Files:**
- Create: `web/server/shared/work-role.ts`
- Create: `web/server/shared/work-role.test.ts`
- Modify: `web/server/shared/index.ts` (배럴에 내보내기 추가)
- Modify: `web/components/people/person-drawer.tsx:199-211` (지역 `ROLE_LABELS`·`roleLabel` 를 지우고 `WORK_ROLE_LABELS`·`workRoleLabel` 사용)

**Interfaces:**
- Produces:
  - `WORK_ROLE_CODES = ["PM","PL","DEVELOPER","DATA_AI","DBA","DEVOPS","SECURITY","DESIGNER","QA","BUSINESS_ANALYST"] as const`
  - `type WorkRoleCode = (typeof WORK_ROLE_CODES)[number]`
  - `WORK_ROLE_LABELS: Record<WorkRoleCode, string>` — 지금 `person-drawer.tsx` 의 값 그대로(DEVELOPER "개발자", DATA_AI "데이터·AI", DEVOPS "DevOps", QA "QA", DESIGNER "디자이너", BUSINESS_ANALYST "업무 분석", SECURITY "보안", DBA "DBA", PM "PM", PL "PL")
  - `workRoleLabel(code: string): string` — 모르는 코드는 그대로
  - `workRoleOf(text: string): WorkRoleCode | null`

`workRoleOf` 규칙(코드 생성기 `scripts/people/capabilities.mjs` 의 직무 10종에 맞춘다):

1. 공백을 지우고 소문자로 바꾼다.
2. 정규화한 값이 코드 이름과 같으면(`"pm"`, `"devops"`, `"business_analyst"`) 그 코드다.
3. 아니면 아래 표를 **위에서부터** 보고 처음 맞는 코드를 돌려준다. 영문 낱말(pm·pl·dba·db·qa·ba·ai·ui·ux)은 원문을 `/[a-z]+/g` 로 자른 영문 낱말과 **같을 때만** 맞는다(`"dbms"` 는 `db` 가 아니다). 한글 낱말은 포함이면 맞는다.
4. 아무것도 맞지 않으면 `null` 이다.

| 순서 | 코드 | 영문 낱말(같을 때) | 한글 낱말(포함) |
|---|---|---|---|
| 1 | PM | pm | 사업관리, 사업책임, 프로젝트관리, 프로젝트책임, 총괄 |
| 2 | PL | pl | 개발책임, 파트리더 |
| 3 | DBA | dba, db | 데이터베이스 |
| 4 | DATA_AI | ai | 인공지능, 데이터, 머신러닝, 빅데이터 |
| 5 | SECURITY | security | 보안, 정보보호 |
| 6 | DEVOPS | devops | 인프라, 클라우드, 시스템엔지니어, 네트워크, 서버 |
| 7 | DESIGNER | ui, ux | 디자인, 디자이너, 퍼블리 |
| 8 | QA | qa | 테스트, 품질, 시험 |
| 9 | BUSINESS_ANALYST | ba | 업무분석, 분석가, 컨설, 기획 |
| 10 | DEVELOPER | — | 개발, 프로그래머, 엔지니어 |

- [ ] **Step 1: 실패하는 시험 쓰기** — `work-role.test.ts`

```ts
it.each([
  ["PM", "PM"], ["pl", "PL"], ["개발", "DEVELOPER"], ["개발자", "DEVELOPER"],
  ["개발책임자", "PL"], ["AI 엔지니어", "DATA_AI"], ["빅데이터 분석가", "DATA_AI"],
  ["데이터베이스 관리자", "DBA"], ["정보보호 컨설턴트", "SECURITY"],
  ["UI/UX 디자이너", "DESIGNER"], ["테스트 엔지니어", "QA"], ["업무분석", "BUSINESS_ANALYST"],
  ["사업관리자", "PM"], ["클라우드 엔지니어", "DEVOPS"],
])("%s → %s", (text, code) => expect(workRoleOf(text)).toBe(code));
it.each(["감리원", "DBMS", "", "  "])("%s 는 대응 없음", (text) => expect(workRoleOf(text)).toBeNull());
it("모르는 코드 이름은 그대로 보인다", () => expect(workRoleLabel("UNKNOWN_ROLE")).toBe("UNKNOWN_ROLE"));
```

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/shared/work-role.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: `work-role.ts` 구현, 배럴 내보내기, 서랍이 새 표를 쓰게 바꾸기.** 이 층은 아무것도 import 하지 않는다(`server-only` 도 넣지 않는다 — 서랍이 브라우저에서 부른다).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS. `pnpm -C web exec vitest run components/people` 도 PASS(서랍 표기 그대로).
- [ ] **Step 5: 보고** — 바꾼 파일과 시험 결과를 텍스트로 남긴다. 커밋은 메인 세션이 한다.

### Task 2: 역할별 필요·팀 묶음·팀×공고 표 계산

**Files:**
- Create: `web/server/workforce/team-plan.ts`
- Create: `web/server/workforce/team-plan.test.ts`
- Modify: `web/server/workforce/workforce.model.ts` (아래 타입 추가, `WorkforceCandidate` 에 `grade`)
- Modify: `web/server/workforce/workforce.service.ts` (`candidatesOf` 역할 매칭, 결과에 새 칸)
- Modify: `web/server/workforce/index.ts` (새 타입 내보내기)
- Test: `web/server/workforce/workforce.service.test.ts` (연결 시험 1건 추가)

**Interfaces:**
- Consumes: `workRoleOf`, `type WorkRoleCode` (`@/server/shared`), `type StaffingRequirement` (`@/server/scoring`)
- Produces (`workforce.model.ts`):

```ts
export const UNASSIGNED_DEPARTMENT = "부서 미지정";
export type WorkforceTeamPerson = {
  personId: string; name: string; jobTitle: string | null;
  role: string; grade: string | null; isDemo: boolean;
  availableFte: number; // 분석 당시 그 공고 기간의 가용 FTE
};
export type WorkforceTeamSupply = {
  department: string; // 없으면 UNASSIGNED_DEPARTMENT
  people: WorkforceTeamPerson[];
  availableFte: number; // people 합, 소수 둘째 자리 반올림
};
export type WorkforceRoleNeed = {
  role: string; // 공고 원문 역할
  roleCode: WorkRoleCode | null;
  minCount: number; // minCount ?? 1
  grade: string | null;
  mandatory: boolean;
  supplyCount: number; // 같은 직무 후보 중 availableFte > 0 인 사람 수
  shortfall: number; // max(0, minCount - supplyCount)
  teams: WorkforceTeamSupply[]; // 같은 직무 후보의 부서 묶음
};
export type WorkforceTeamPlanCell = { bidId: string; people: WorkforceTeamPerson[]; roles: string[] };
export type WorkforceTeamPlanRow = { department: string; personCount: number; cells: WorkforceTeamPlanCell[] };
// WorkforceCandidate 에 grade: string | null 추가
// WorkforceBidResult 에 roleNeeds: WorkforceRoleNeed[]; teams: WorkforceTeamSupply[] 추가(분석 없음이면 둘 다 [])
// WorkforceResult 에 teamPlan: WorkforceTeamPlanRow[] 추가
```

- Produces (`team-plan.ts`, 순수 함수):
  - `teamsOf(candidates: WorkforceCandidate[]): WorkforceTeamSupply[]`
  - `roleNeedsOf(staffing: StaffingRequirement[] | null, candidates: WorkforceCandidate[]): WorkforceRoleNeed[]`
  - `teamPlanOf(bids: Pick<WorkforceBidResult, "bidId" | "teams" | "roleNeeds">[]): WorkforceTeamPlanRow[]`

정렬·규칙(시험이 고정한다):
- 사람: `availableFte` 큰 순, 같으면 이름 `localeCompare(…, "ko")`.
- 팀: 사람 수 많은 순 → `availableFte` 큰 순 → 부서 이름 순.
- `roleNeedsOf`: 역할마다 `workRoleOf(role)` 로 코드를 찾고, 후보 가운데 `candidate.role === roleCode` 인 사람만 `teamsOf` 로 묶는다. 코드가 `null` 이면 `teams: []`, `supplyCount: 0`.
- `teamPlanOf`: 모든 공고의 `teams` 를 부서로 모은다. 칸은 `bids` 순서대로 하나씩(사람이 없으면 `people: []`, `roles: []`). `roles` 는 그 칸 사람의 직무 코드와 같은 `roleNeeds[].roleCode` 의 원문 `role` 을 중복 없이 모은 것. 줄은 `personCount`(중복 없는 사람 수) 많은 순 → 부서 이름 순.
- `candidatesOf` 역할 매칭: `workRoleOf(role)` 가 코드를 내면 `code === member.role`, `null` 이면 지금처럼 대소문자 무시 원문 비교. `grade` 는 `member.grade`.
- 서비스: 분석이 있으면 `staffing` 이 KNOWN 이고 값이 있을 때만 `roleNeedsOf(staffing.value, candidates)`, 아니면 `[]`. `teams = teamsOf(candidates)`. `teamPlan = teamPlanOf(bids)`.

- [ ] **Step 1: 실패하는 시험 쓰기** — `team-plan.test.ts` (후보는 시험 안의 작은 생성 함수로 만든다)

```ts
it("원문 역할을 직무 코드로 바꿔 부서별로 묶고 부족 인원을 센다", () => {
  // 후보: DEVELOPER 개발1팀 2명(1, 0.5 FTE), DEVELOPER 부서 없음 1명(0 FTE), PM 사업팀 1명
  const needs = roleNeedsOf([{ role: "개발", minCount: 4, mandatory: true }], candidates);
  expect(needs[0]).toMatchObject({ role: "개발", roleCode: "DEVELOPER", minCount: 4, supplyCount: 2, shortfall: 2 });
  expect(needs[0].teams.map((t) => t.department)).toEqual(["개발1팀", "부서 미지정"]);
  expect(needs[0].teams[0].availableFte).toBe(1.5);
});
it("대응 없는 역할은 짐작하지 않는다", () => {
  expect(roleNeedsOf([{ role: "감리원", mandatory: false }], candidates)[0])
    .toMatchObject({ roleCode: null, minCount: 1, supplyCount: 0, shortfall: 1, teams: [] });
});
it("staffing 이 없으면 역할 필요는 비어 있다", () => expect(roleNeedsOf(null, candidates)).toEqual([]));
it("같은 사람이 두 공고 후보면 팀×공고 표의 두 칸에 모두 나온다", () => {
  const plan = teamPlanOf([bidA, bidB]); // 둘 다 개발1팀의 같은 personId 를 후보로 가진다
  const row = plan.find((r) => r.department === "개발1팀");
  expect(row?.cells.map((c) => c.people.map((p) => p.personId))).toEqual([["dev-1"], ["dev-1"]]);
  expect(row?.personCount).toBe(1);
  expect(row?.cells[0].roles).toEqual(["개발"]);
});
```

`workforce.service.test.ts` 에 추가:

```ts
it("FX-01 추출의 '개발 10명'이 DEVELOPER 직원을 후보로 잡는다", async () => {
  // setup() 의 input.extraction 에 fixtures/extractions/FX-01.json 을 넣고, 팀원 role 을 "DEVELOPER" 로 둔다
  const result = await simulateWorkforce("org", ["bid"], { repo }, NOW);
  if (!result.ok) throw new Error("시뮬레이션 실패");
  const item = result.data.bids[0];
  expect(item.roleNeeds.map((n) => [n.role, n.roleCode, n.minCount])).toEqual([
    ["PM", "PM", 1], ["PL", "PL", 1], ["개발", "DEVELOPER", 10],
  ]);
  expect(item.candidates.map((p) => p.personId)).toEqual(["eligible"]);
  expect(item.teams[0].department).toBe("개발부");
});
```

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run server/workforce` → 새 시험 FAIL, 기존 3건 PASS
- [ ] **Step 3: 타입·`team-plan.ts`·서비스 구현.** 기존 과부하·공유 후보 계산(`currentConflicts`)은 고치지 않는다.
- [ ] **Step 4: 통과 확인** — `pnpm -C web exec vitest run server/workforce app/api/v1/workforce-contract.test.ts` PASS
- [ ] **Step 5: 보고** — 텍스트로 남긴다. 커밋은 메인 세션.

### Task 3: 화면 — 추천 공고 불러오기, 역할·팀 표시, 팀별 지원 요청 표

**Files:**
- Modify: `web/app/(app)/(work)/workforce/workforce-view.tsx` (불러오기 버튼, `simulate(bids)` 인자화)
- Modify: `web/app/(app)/(work)/workforce/workforce-results.tsx` (`BidCard` 후보 목록 → 역할별·팀별, 새 절 "팀별 지원 요청")
- Modify: `web/app/(app)/(work)/workforce/workforce-query.ts` (`WORKFORCE_DESCRIPTION`)
- Create: `web/app/(app)/(work)/workforce/workforce-view.browser.test.tsx`
- Modify: `docs/06-UI-UX.md` 의 `/workforce` 줄(449행 근처)과 관련 절
- Evidence: `docs/evidence/workforce/20261030-team-staffing/` (1440·1280 스크린샷, README)

**Interfaces:**
- Consumes: Task 2 의 `WorkforceResult.teamPlan`, `WorkforceBidResult.roleNeeds`·`teams`, `UNASSIGNED_DEPARTMENT`; 화면 부품은 `@/server/workforce` 를 타입으로만 부른다. 직무 이름은 `workRoleLabel`(`@/server/shared`).
- 추천 공고 요청: `GET /api/v1/opportunities?origin=<origin>&recommendation=BID&status=OPEN&status=AMENDED&limit=3`(기본 정렬이 ADR-069 추천순·AI·SI 우선이다). 응답은 `z.object({ items: z.array(z.object({ bidId: z.uuid(), title: z.string(), isDemo: z.boolean() })) })` 로 읽는다.

화면 규칙:
- 선택 절 맨 위에 `[추천 공고 불러오기]`(outline) 버튼과 도움말 "추천 공고를 추천순(AI·SI 우선)으로 3건까지 고르고 바로 조회합니다." 누르면 선택을 그 공고들로 **바꾸고** 곧바로 조회한다. 0건이면 선택·결과를 그대로 두고 `role="alert"` 로 "추천 공고가 없습니다. 공고를 직접 고르세요." 요청 실패면 "추천 공고를 읽지 못했습니다. 다시 시도해 주세요."
- `BidCard`: "필요 인력/가용" 아래에 **역할별 필요 인력** 목록. 줄마다 `{role} · {minCount}명 필요 · 후보 {supplyCount}명{shortfall ? ` · 부족 ${shortfall}명` : ""}`, 그 아래 팀마다 `{department} {people.length}명 · 가용 {availableFte} FTE` 와 이름(직무·등급). `roleCode` 가 없으면 "직무 대응 없음 · 사람이 확인". `roleNeeds` 가 비면 "역할 정보 없음 · 필요 인력은 예산 구간 추정입니다."와 `teams` 묶음(기존 평면 후보 목록을 팀 묶음으로 바꾼다. 6명 넘으면 `<details>` 접기는 유지).
- "부족"은 후보 수와 비교한 값이라는 한 줄: "부족은 분석 당시 후보 수와 비교한 값이며 인력 부족 확정을 뜻하지 않습니다."
- 새 절 "팀별 지원 요청"(기존 "현재 배정과 기간 충돌" 절 앞): `Table`(`table-fixed`), 첫 열 팀, 열마다 공고 제목(링크), 칸에 이름 목록과 `roles` 를 `·` 로. 빈 칸은 "—". `teamPlan` 이 비면 "팀별로 묶을 후보가 없습니다."
- 1280px 에서 공고 3열·팀 표가 가로로 넘치지 않는다.

- [ ] **Step 1: 실패하는 브라우저 시험 쓰기** — `workforce-view.browser.test.tsx`. `fetch` 는 `vi.stubGlobal` 로 막는다.

```ts
it("추천 공고 0건이면 안내만 하고 조회하지 않는다", async () => {
  // fetch: /api/v1/opportunities → { items: [] }
  // [추천 공고 불러오기] 클릭 → "추천 공고가 없습니다. 공고를 직접 고르세요." 보임
  // /api/v1/workforce/simulation 호출 0회
});
it("추천 공고를 불러오면 선택을 바꾸고 팀별 지원 요청 표를 그린다", async () => {
  // fetch: opportunities → 2건, simulation → teamPlan 1줄(개발1팀, 두 칸에 같은 사람)인 WorkforceResult
  // 선택 목록 = 두 공고 제목, 표 머리 = 팀 + 두 공고 제목, 개발1팀 줄 두 칸 모두 그 사람 이름
});
it("역할 정보가 없으면 '역할 정보 없음'과 팀 묶음을 보인다", async () => {
  // initialResult 의 bids[0].roleNeeds = [], teams = [{ department: "부서 미지정", … }]
});
```

- [ ] **Step 2: 실패 확인** — `pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/workforce"` → FAIL
- [ ] **Step 3: 화면 구현** — 색·글꼴은 토큰 클래스만(`design-system` 스킬). 버튼 중복 클릭은 기존 `inFlight` 로 막는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 변경 범위 검증** — `bash <verify-slot.sh> pnpm verify:changed` exit 0(슬롯 스크립트 경로는 메모 [[heavy-verify-slots]])
- [ ] **Step 6: 화면 확인** — 격리 로컬 스택(메모 [[isolated-e2e-stacks]], 54321·기본 compose 쓰지 않기)에서 데모 조직으로 `/workforce` 를 열고 [추천 공고 불러오기]. 1440·1280 스크린샷과 가로 넘침 0 을 `docs/evidence/workforce/20261030-team-staffing/` 에 README 와 함께 남긴다.
- [ ] **Step 7: 문서** — `docs/06-UI-UX.md` 의 `/workforce` 설명에 "추천 공고 불러오기·역할별 필요·팀별 지원 요청, 저장 없음"을 더한다(frontmatter `updated` 갱신). `docs/PROGRESS.md` 는 메인 세션이 고친다.
- [ ] **Step 8: 보고** — 텍스트로 남긴다. 커밋은 메인 세션.
