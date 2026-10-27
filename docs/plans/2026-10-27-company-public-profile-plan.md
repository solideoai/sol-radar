---
title: "회사 역량 공개 자료 프로필·임원 권한 구현 계획"
doc: "plan-20261027-company-public-profile"
status: draft
tags:
  - sol-radar
  - company
  - auth
  - scoring
updated: 2026-10-27
---

# 회사 역량 공개 자료 프로필·임원 권한 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬은 superpowers:subagent-driven-development(추천) 또는 superpowers:executing-plans다. 작업 단위로 실행하고, 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** `/company`를 ADMIN·EXECUTIVE 전용으로 바꾸고, 공개 자료로 만든 실제 솔리데오 프로필을 출처와 함께 운영 DB에 새 revision으로 넣는다.

**구조:**
- 권한: 업무 역할에 `EXECUTIVE`를 더하고, 회사 역량 메뉴·페이지·API에서만 거른다. RLS는 그대로 둔다.
- 데이터 모양: 프로필 JSONB의 실적 금액·완료일을 nullable로 바꾸고, 출처·공개 이력은 새 열 두 개에 둔다.
- 반영 경로: 공개 자료 JSON을 vitest로 검증하고, 운영자 CLI가 dry-run 뒤에 넣는다.

**기술 스택:** Next.js 16 · Supabase(Postgres·RLS) · zod · Vitest · node:test(PGlite) · Python FastAPI(pydantic, `services/ai`).

**스펙:** `polaris/specs/in-progress/2026-10-27-company-public-profile.md`(사용자 결정 D1~D8). 실행자는 스펙과 이 계획을 함께 읽는다.

## 전역 제약

- 작업 폴더: `../sol-radar-worktrees/company-public-profile`, 브랜치 `feat/company-public-profile`(main에서 분기). main 병합은 통합 검증 뒤 사용자 확인을 받고 한다.
- 무거운 검증은 공용 슬롯 스크립트로 감싼다: `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/58e415e2-c7a2-4d61-a765-5bb0183b1d8c/scratchpad/verify-slot.sh <명령>`. 대상은 `pnpm verify`·`services/ai` `verify.sh`·`test:browser`·`next build`·`git commit`이다.
- 마이그레이션은 새 파일로만 쌓는다. `web/lib/database.types.ts`는 `pnpm db:types`로 만들어 같은 커밋에 넣는다.
- 역할 화면 표기는 코드 글자 그대로다(`EXECUTIVE`, `org-settings-copy.ts` D1). 안내 문구에만 "임원"을 쓴다.
- EXECUTIVE 권한 = VIEWER 권한 + 회사 역량 열람(D8). 쓰기 역할 목록(`ANALYSIS_ROLES`·`REVIEW_ROLES`·`MANAGE_PROJECT_ROLES`, SQL의 `array['ADMIN','SALES',…]`)에는 더하지 않는다.
- 가상 fixture(`fixtures/company/solideo-profile.json`), 골든, 08 §6.1 값은 바꾸지 않는다.
- 운영 DB·Vercel·회사 서버를 바꾸는 단계는 모두 실행 직전에 사용자 확인을 받는다. `pnpm db:push`는 `NODE_EXTRA_CA_CERTS=~/.supabase/prod-ca-2021.crt`와 함께 실행한다.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 막히면 우회하지 말고 멈춰 보고한다. 이 규칙은 하위 작업자 지시문에도 넣는다.
- 커밋 메시지는 `타입: 한국어 설명`, 첫 줄 50자 이내. 파일을 지정해 스테이징한다.

## 리뷰 초점

1. **옛 Worker·AI gateway가 null 금액을 받는 경우**: 새 revision을 넣은 뒤 분석이 PARTIAL·실패로 끝난다. 그래서 반영 순서에서 Worker와 AI gateway 갱신을 CLI `--apply`보다 앞에 둔다(Task 9 순서 4·7).
2. **EXECUTIVE가 쓰기 API를 직접 부르는 경우**: 분석 요청과 입찰 결정 API는 403, DB 쓰기 정책은 42501이어야 한다. Task 1과 Task 2의 시험이 이것을 고정한다.
3. **완료일이 null인 실적의 정렬과 표시**: 화면에서 이런 실적은 맨 아래로 가고 "공개 자료 없음"으로 보여야 한다. 정렬 함수 시험은 Task 5에 있다.
4. **출처 id가 `sources`에 없는 항목**: 화면에 끊긴 링크가 생긴다. 공개 프로필 파일 시험이 이것을 막는다(Task 6).
5. **EXECUTIVE에게 역할 목록이 비어 보이는 화면**: 조직 설정의 역할 고르기와 안내에 EXECUTIVE가 빠지는 경우다. Task 2의 문구 시험이 이것을 막는다.

---

## Task 0: 작업 폴더 준비

- [ ] main 최신에서 worktree를 만든다: `git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add ../sol-radar-worktrees/company-public-profile -b feat/company-public-profile main`
- [ ] 루트와 `web`에서 각각 `pnpm install --frozen-lockfile`을 실행한다. prepare 훅이 exit 1을 내도 의존성 설치가 끝났으면 계속한다.
- [ ] 스펙 파일을 `polaris/specs/in-progress/`로 옮긴다(`status: in-progress`). 커밋은 Task 8에서 문서와 함께 한다.

## Task 1: DB — EXECUTIVE 역할과 출처 열

**파일:**
- 만들기: `supabase/migrations/20261027000700_executive_role_company_sources.sql`
- 고치기: `web/lib/database.types.ts`(생성물), `scripts/database.test.mjs`

**인터페이스:**
- 내놓는 것
  - sol_role 값 `'EXECUTIVE'`.
  - `company_profiles.sources jsonb not null default '[]'`, `company_profiles.public_history jsonb not null default '[]'`. 두 열 모두 `jsonb_typeof(...) = 'array'` CHECK를 둔다.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`scripts/database.test.mjs`)

  `it("EXECUTIVE 역할 — 멤버십·초대·가입 승인에 저장되고 읽기 함수는 통과, 쓰기 정책은 막힌다")`
  - `memberships`·`invitations`에 `sol_role='EXECUTIVE'` insert 성공.
  - `decide_join_request(..., p_sol_role => 'EXECUTIVE')` 승인 성공.
  - EXECUTIVE JWT로 `select * from public.latest_ingest_run('live')`, `procurement_source_health('live')`, `procurement_last_scheduled_ingest('live')`가 권한 오류 없이 돈다.
  - EXECUTIVE JWT로 `score_runs` insert와 `bid_reviews` insert가 42501로 막힌다.
  - `sol_role='OWNER'` insert는 23514.

  `it("company_profiles 의 sources·public_history 는 기본 빈 배열이고 배열이 아니면 거부한다")`
  - 열을 빼고 insert하면 두 열이 `[]`.
  - `sources='{}'`는 23514.

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `node --test --test-name-pattern "EXECUTIVE|sources·public_history" scripts/database.test.mjs`
  - 기대: FAIL(check 제약 위반)

- [ ] **Step 3: 마이그레이션을 쓴다**
  - CHECK 제약 3개(`memberships_sol_role_check`·`invitations_sol_role_check`·`member_join_requests_sol_role_check`)를 drop 뒤 `EXECUTIVE`를 더해 다시 만든다. 실제 제약 이름은 PGlite에서 `pg_constraint`로 확인한다.
  - `create or replace`로 다시 정의하는 함수 4개. 최신 정의 본문을 그대로 옮기고 역할 목록에만 `'EXECUTIVE'`를 더한다.
    - `latest_ingest_run`, `procurement_source_health`: `20261023000200_procurement_reads.sql`
    - `procurement_last_scheduled_ingest`: `20261025000200_procurement_live_metrics.sql`
    - `decide_join_request`: `20261025000300_join_request_decide_version.sql`의 `p_sol_role not in (...)`
  - storage 정책 `sol_raw_documents_read`(`20261021000701`): drop 뒤 같은 본문에 `'EXECUTIVE'`를 더해 다시 만든다.
  - `company_profiles`에 위 두 열을 더한다.
  - 빠뜨린 곳 찾기: `grep -rnE "'VIEWER'" supabase/migrations/`를 함수 이름별 최신 정의와 맞춰 본다.

- [ ] **Step 4: 통과를 확인한다**
  - 실행: Step 2 명령, 이어서 `node --test scripts/database.test.mjs`
  - 기대: PASS. 기존 시험도 전부 PASS.

- [ ] **Step 5: 타입을 다시 만든다**: `pnpm db:types`. diff에는 `company_profiles` 두 열만 나와야 한다.

- [ ] **Step 6: 커밋**: `feat(db): 임원 역할과 회사 프로필 출처 열 추가`

## Task 2: 웹 역할 목록과 회사 역량 접근 제한

**파일:**
- 고치기
  - 역할 목록: `web/server/organization/business-access.model.ts:5`, `web/server/join-request/join-request.model.ts:103`, `web/server/bids/bid.model.ts:77`, `web/server/people/people.service.ts:70`, `web/app/api/v1/_lib/fake-session.ts`
  - 역할 화면 문구: `web/app/(app)/(work)/settings/organization/org-settings-copy.ts`
  - 메뉴: `web/components/app-nav.ts:80`
  - 페이지·API: `web/app/(app)/(work)/company/page.tsx`, `web/app/api/v1/company-profile/route.ts`, `web/app/api/v1/company-profile/revisions/route.ts`
  - 배럴: `web/server/company-profile/company-profile.model.ts`, `web/server/company-profile/index.ts`
- 만들기: `web/app/(app)/(work)/company/company-forbidden.tsx`, `web/app/api/v1/company-profile-contract.test.ts`
- 시험 고치기: `web/app/api/v1/bids-contract.test.ts`(시험 3)

**인터페이스:**
- 내놓는 것
  - `export const COMPANY_PROFILE_READ_ROLES: readonly SolRole[] = ["ADMIN", "EXECUTIVE"]`
  - `export const canReadCompanyProfile = (role: SolRole): boolean`
  - 둘 다 `@/server/company-profile` 배럴에서 내보낸다.
  - `FAKE_USERS.executive`(id `10000000-0000-4000-8000-000000000005`, org-01, `EXECUTIVE`)

- [ ] **Step 1: 실패하는 시험을 쓴다** (`company-profile-contract.test.ts`)
  - 견본은 `watch-contract.test.ts`의 mock 구성이다. `vi.mock("@/server/company-profile", …)`로 `getCompanyProfile`·`listCompanyProfileRevisions`를 가짜로 둔다.
  - `it("ADMIN·EXECUTIVE 는 GET /company-profile·/revisions 200")`
  - `it("VIEWER·ANALYST·SALES 는 두 API 모두 403 FORBIDDEN 이고 프로필을 읽지 않는다")`: 응답 `error.code === "FORBIDDEN"`, 가짜 함수 호출 0회.
  - 같은 파일에 순수 함수 시험 두 개를 둔다.
    - `visibleNavGroups("VIEWER")`에 `/company`가 없고, `visibleNavGroups("EXECUTIVE")`와 `visibleNavGroups("ADMIN")`에는 있다.
    - `SOL_ROLE_ORDER`가 `["ADMIN","SALES","ANALYST","EXECUTIVE","VIEWER"]`이고, `SOL_ROLE_GUIDE`에 EXECUTIVE 줄이 있다.
  - `web/app/api/v1/bids-contract.test.ts`의 시험 3에 두 줄을 더한다.
    - `errorOf(await send(POST_ANALYSES, { user: FAKE_USERS.executive }), 403, "FORBIDDEN")`
    - `errorOf(await send(POST_REVIEWS, { user: FAKE_USERS.executive }), 403, "FORBIDDEN")`
    - 시험 이름에 EXECUTIVE를 더한다.

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `pnpm -C web exec vitest run app/api/v1/company-profile-contract.test.ts`
  - 기대: FAIL

- [ ] **Step 3: 구현한다**
  - 역할 enum 4곳과 `fake-session` 타입에 `EXECUTIVE`를 더한다. `people.service.ts:70`은 읽기 허용 목록이라 EXECUTIVE를 더한다.
  - `org-settings-copy.ts`
    - `SOL_ROLE_ORDER`에 VIEWER 앞으로 더한다.
    - `SOL_ROLE_ITEMS.EXECUTIVE = "EXECUTIVE"`.
    - 안내 문구: `{ role: "EXECUTIVE", text: "임원. VIEWER가 하는 일 + 회사 역량 열람" }`
  - `app-nav.ts` `/company` 항목에 `roles: ["ADMIN", "EXECUTIVE"]`를 단다.
  - 페이지: `if (!canReadCompanyProfile(work.role)) return <CompanyForbidden role={work.role} />;`. `CompanyForbidden`은 `IngestionForbidden`과 같은 틀이다.
    - 문구: "회사 역량은 업무 역할이 ADMIN 또는 EXECUTIVE인 구성원만 볼 수 있습니다. 지금 역할: {role}"
    - 이 화면은 데이터를 읽지 않는다.
  - API 두 개: `if (!canReadCompanyProfile(ctx.role)) return apiError(403, "FORBIDDEN", "회사 역량은 ADMIN·EXECUTIVE만 조회할 수 있습니다");`
  - 주석 "읽기는 업무 역할 전원"을 바뀐 규칙으로 고친다. 페이지와 API에 하나씩 있다.

- [ ] **Step 4: 통과를 확인한다**
  - 실행: Step 2 명령, 이어서 `pnpm verify:changed`
  - 기대: PASS

- [ ] **Step 5: 커밋**: `feat(web): 회사 역량을 관리자·임원 전용으로 제한`

## Task 3: 점수 — 금액·완료일이 없는 실적

**파일:**
- 고치기: `web/server/scoring/analysis-input.model.ts:206-258`, `web/server/scoring/factors.ts:190-240,297-342`
- 만들기: `web/server/scoring/unknown-project-values.test.ts`

**인터페이스:**
- 내놓는 것: `companyProfileSchema` 변경
  - `pastProjects[].amountKrw`: `krwString.nullable()`
  - `pastProjects[].completedAt`: `isoDate.nullable()`
  - `pastProjects[].note`: `z.string().optional()`
  - `sourceIds: z.array(z.string().min(1)).optional()`를 `technologies[]`·`licenses[]`·`industryCodes[]`·`pastProjects[]`·`financials`에 더한다.
  - `financials.note`: `z.string().optional()`
  - 기존 fixture는 그대로 통과해야 한다. 선택 필드가 없으면 출력에도 키가 없다.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`unknown-project-values.test.ts`)
  - `it("금액이 null 인 실적은 금액비 0.5")`: `pastPerformance(...).rawValue.candidates[0].amountRatio === 0.5`
  - `it("완료일이 null 인 실적은 최근성 0.2 이고 years 는 null")`
  - `it("규모 적합성은 null 금액을 최대 실적에서 뺀다")`: 실적 `[null, "1000000000"]`이면 `rawValue.largestPastKrw === "1000000000"`
  - `it("모든 금액이 null 이면 규모 적합성은 중립 0.5")`
  - `it("sourceIds·note 가 붙은 프로필도 파싱되고 기존 fixture 파싱 결과는 바뀌지 않는다")`: `companyProfileSchema.parse(fixture)`가 fixture와 deep equal.

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `pnpm -C web exec vitest run server/scoring/unknown-project-values.test.ts`
  - 기대: FAIL

- [ ] **Step 3: 구현한다**
  - `pastPerformance`: `completedAt === null`이면 `years: null`, `recency: 0.2`로 둔다. 금액은 `amountKrw === null ? 0 : Number(...)`로 바꿔서 기존 0.5 분기를 탄다.
  - `scaleFit`: `largestPast`를 셀 때 null을 뺀다.

- [ ] **Step 4: 통과와 회귀를 확인한다**
  - 실행: `pnpm -C web exec vitest run server/scoring`
  - 기대: 새 시험, `worked-examples.golden.test.ts`, `reproducibility.test.ts`가 모두 PASS.

- [ ] **Step 5: 커밋**: `feat(scoring): 금액·완료일 모르는 실적 처리`

## Task 4: AI gateway — null 금액 받기

**파일:**
- 고치기: `services/ai/src/sol_ai/contracts.py:139-142`(`ProfileProject.amountKrw: KrwString | None = None`), `services/ai/src/sol_ai/kev_state.py:363-371`
- 만들기: `services/ai/tests/test_profile_unknown_amount.py`

- [ ] **Step 1: 실패하는 시험을 쓴다**
  - `test_unknown_amount_counts_project_but_not_amounts`: 실적 `[{"amountKrw": None}, {"amountKrw": "1000000000"}]`이면 state 줄의 건수는 2, 최대 금액은 `1,000,000,000`, 금액 목록에 null이 없다.
  - `test_all_unknown_amounts_omit_largest`: 금액이 모두 None이면 최대 금액 문구가 없다.
  - 프로필을 만드는 방법은 `services/ai/tests/support.py`의 기존 헬퍼를 따른다.

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `cd services/ai && uv run pytest tests/test_profile_unknown_amount.py -q`
  - 기대: FAIL(ValidationError)

- [ ] **Step 3: 구현한다**: `company_past_performance`에서 건수는 `len(pastProjects)`로 센다. 금액 목록과 최대 금액은 None이 아닌 값만 쓴다.

- [ ] **Step 4: 통과를 확인한다**
  - 실행: Step 2 명령, 이어서 `bash <verify-slot.sh> bash services/ai/verify.sh`
  - 기대: PASS

- [ ] **Step 5: 커밋**: `feat(ai): 금액 모르는 실적을 결정 모델 입력에 허용`

## Task 5: 회사 역량 화면 — 출처·공개 이력·빈 칸

**파일:**
- 고치기
  - 모델: `web/server/company-profile/company-profile.model.ts`(`PROFILE_COLUMNS`에 `sources,public_history`, 파싱)
  - 화면: `web/components/company/company-profile-view.tsx:78-91`, `web/components/company/company-panels.tsx`
- 만들기: `web/components/company/source-links.tsx`, `web/server/company-profile/company-profile.model.test.ts`

**인터페이스:**
- 소비하는 것: Task 1 열, Task 3 스키마.
- 내놓는 것(`company-profile.model.ts`, 배럴로 내보냄)
  - `profileSourceSchema = z.object({ id: z.string().min(1), kind: z.enum(["PUBLIC","COMPANY_CONFIRMED"]), title: z.string().min(1), url: z.string().url().nullable(), retrievedAt: isoDate, confirmedBy: z.string().optional(), quote: z.string().optional() })`
  - `publicHistoryEntrySchema = z.object({ year: z.number().int(), kind: z.enum(["CERTIFICATION","REGISTRATION","AWARD"]), name: z.string().min(1), sourceIds: z.array(z.string().min(1)) })`
  - `CompanyProfile`에 `sources: ProfileSource[]`, `publicHistory: PublicHistoryEntry[]`를 더한다.
  - `sortProjectsForDisplay(projects): PastProject[]`: 완료일 내림차순, null은 맨 아래, null끼리는 이름순.
  - `latestRetrievedAt(sources): string | null`

- [ ] **Step 1: 실패하는 시험을 쓴다** (`company-profile.model.test.ts`)
  - `it("sources·public_history 를 파싱해 CompanyProfile 에 싣는다")`
  - `it("sources 모양이 틀리면 CompanyProfileDataError")`
  - `it("sortProjectsForDisplay 는 완료일 null 을 맨 아래로")`
  - `it("latestRetrievedAt 은 가장 늦은 확인일, 출처가 없으면 null")`

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `pnpm -C web exec vitest run server/company-profile`
  - 기대: FAIL

- [ ] **Step 3: 구현한다**
  - `ProfileMeta`: `isDemo`면 지금 칩을 그대로 둔다. 아니면 "공개 자료 기준 · 확인일 {latestRetrievedAt}" 칩을 보인다.
  - `ProjectsPanel`
    - 정렬은 `sortProjectsForDisplay`로 한다.
    - 금액·완료일이 null이면 "공개 자료 없음"(muted)으로 표시한다.
    - 사업명 아래에 `note`(있으면)와 `SourceLinks`를 둔다.
  - `LicensesPanel`
    - 항목마다 `SourceLinks`를 단다. 출처가 `COMPANY_CONFIRMED`면 "회사 확인" 표시를 붙인다.
    - 아래에 "인증·등록 이력(점수 미사용)" 목록을 둔다(연도·이름·출처).
  - `TechPanel`·`FinancialsPanel`: `SourceLinks`를 달고, 재무 `note`를 보인다.
  - 프로필 아래에 "출처" 목록을 둔다(제목·URL·확인일·종류). 링크는 `target="_blank" rel="noreferrer"`로 연다.
  - 색·글꼴은 `design-system` 스킬을 따른다. 새 토큰은 만들지 않는다.

- [ ] **Step 4: 통과를 확인한다**
  - 실행: Step 2 명령, 이어서 `pnpm verify:changed`
  - 기대: PASS

- [ ] **Step 5: 커밋**: `feat(web): 회사 역량에 출처·공개 이력 표시`

## Task 6: 운영자 CLI와 공개 프로필 파일 검사

**파일:**
- 만들기: `scripts/ops/company-profile.mjs`, `scripts/ops/company-profile.test.mjs`, `web/server/company-profile/public-profile-file.test.ts`
- 고치기: `package.json`(`"ops:company-profile": "node scripts/ops/company-profile.mjs"`)

**인터페이스:**
- 소비하는 것: Task 1 열, `scripts/demo/rest-client.mjs` `createRestClient`, `scripts/ops/close-stale-ingest-runs.mjs` `resolveOpsEnv`, `scripts/people/seed.mjs` `orgUuid`.
- 내놓는 것
  - `planCompanyProfileRevision({ client, document, createdByEmail })`
    - 돌려주는 값: `{ orgId, nextRevision, createdBy, row, changes }`
    - `document`: `{ profile, sources, publicHistory, note }`
    - `changes`: 직전 revision 대비 `{ technologies, licenses, pastProjects }`의 더한 것·뺀 것 이름 목록과 `financials` 변경
  - `applyCompanyProfileRevision({ client, plan })`: 돌려주는 값은 `{ id, revision }`
  - 사용법: `node scripts/ops/company-profile.mjs --env-file <path> --file <json> --created-by <email> [--apply]`

- [ ] **Step 1: 실패하는 시험을 쓴다** (`company-profile.test.mjs`, `demo-admin.test.mjs`처럼 가짜 client를 쓴다)
  - `test("dry-run 은 다음 revision 을 계산하고 아무것도 쓰지 않는다")`
  - `test("apply 는 org-01 에 is_demo=false·revision max+1·sources·public_history 로 넣는다")`
  - `test("created-by 가 org-01 ADMIN 이 아니면 거부")`
  - `test("profile.isDemo 가 true 이거나 조직 slug 가 org-01 이 아니면 거부")`

  공개 프로필 파일 검사(`public-profile-file.test.ts`). 대상 파일은 `docs/evidence/company-public-profile/20261027/profile.json`이다.
  - `it("companyProfileSchema 로 파싱되고 isDemo=false")`
  - `it("모든 기술·자격·업종·실적·재무 항목의 sourceIds 가 하나 이상이고 sources 에 있다")`
  - `it("HELD 자격은 PUBLIC 출처에 quote 가 있거나 COMPANY_CONFIRMED 출처에 confirmedBy 가 있다")`
  - `it("pastProjects.domain 은 DOMAINS 값이다")`

- [ ] **Step 2: 실패를 확인한다**
  - 실행: `node --test scripts/ops/company-profile.test.mjs`
  - 기대: FAIL
  - 파일 검사는 Task 7이 JSON을 만든 뒤에 통과한다. 그 전에는 파일이 없어서 실패한다. 그래서 이 시험의 커밋은 Task 7과 같이 한다.

- [ ] **Step 3: CLI를 구현한다**
  - env 처리는 `demo-admin.mjs`의 `main`과 같다(`--env-file`, `parseEnv`, `resolveOpsEnv`).
  - 출력은 JSON 하나다: 대상 host, 조직, 다음 revision, `changes`, `apply` 여부.
  - `--apply`가 없으면 쓰지 않는다.

- [ ] **Step 4: 통과를 확인한다**
  - 실행: `node --test scripts/ops/company-profile.test.mjs`
  - 기대: PASS

- [ ] **Step 5: 커밋**: `feat(ops): 회사 프로필 revision 운영 CLI`. CLI와 시험만 커밋한다. 파일 검사 시험은 Task 7에서 커밋한다.

## Task 7: 공개 자료 수집 (Task 1~6과 병렬 가능)

**파일:**
- 만들기: `docs/evidence/company-public-profile/20261027/profile.json`, `docs/evidence/company-public-profile/20261027/ledger.md`

**규칙:** 스펙 §5 B1·B2를 그대로 따른다. 공개 페이지와 공공데이터 API만 쓴다. 로그인이 필요한 곳과 웹 화면 긁기는 쓰지 않는다. 값이 없으면 비운다.

- [ ] **Step 1: 홈페이지·기사·잡코리아에서 값을 모은다**
  - 대상은 스펙 B1 표의 URL이다.
  - `ledger.md`에 값 하나마다 한 줄을 적는다: 항목 | 값 | 출처 id | URL | 확인일 | 원문 인용.

- [ ] **Step 2: 채용공고 상세에서 기술 이름을 모은다**
  - 회사가 요구·사용한다고 적은 기술만 모은다. 공고 여러 건에 나온 기술을 우선한다.

- [ ] **Step 3: 나라장터 계약 기록을 확인한다**
  - data.go.kr 조달청 계약·낙찰 서비스가 업체명이나 사업자번호로 거를 수 있는지 문서로 확인한다.
  - 활용 신청이나 키가 필요하면 멈추고 사용자에게 요청한다. 키는 사용자가 넣는다.
  - 받을 수 있으면 정보화·SW 용역, 최근 5년과 진행 중인 계약만 모은다(스펙 B2). 지분율이 공개돼 있으면 금액에 곱하고, 총액은 비고에 적는다.

- [ ] **Step 4: 공개 조회로 자격의 현재 유효성을 확인한다**
  - 대상: KOSA 소프트웨어사업자, 직접생산확인, 중소기업 확인, 정보통신공사업.
  - 확인된 것만 `HELD`로 적고, 조회 결과 문구를 `quote`에 넣는다.

- [ ] **Step 5: 확인 못 한 자격을 사용자에게 한 번에 묻는다(D7)**
  - 목록을 보낸다. 사용자가 보유라고 답한 것만 `COMPANY_CONFIRMED` 출처로 넣는다(`confirmedBy`: 사용자 이름, `retrievedAt`: 답한 날).

- [ ] **Step 6: `profile.json`을 쓴다**
  - 모양: `{ profile, sources, publicHistory, note }`. `profile`은 `companyProfileSchema` 모양이고 `isDemo: false`, `name: "㈜솔리데오"`, `technologiesComplete: false`, `preferences: null`이다.
  - `revision`은 CLI가 덮어쓴다. 파일에는 1을 둔다.

- [ ] **Step 7: 검사한다**
  - 실행: `pnpm -C web exec vitest run server/company-profile/public-profile-file.test.ts`
  - 기대: PASS

- [ ] **Step 8: 커밋**: `docs: 솔리데오 공개 자료 프로필 수집`. `profile.json`, `ledger.md`, `public-profile-file.test.ts`를 함께 커밋한다.

## Task 8: 문서

**파일:** `docs/16-DECISIONS.md`(ADR-052), `docs/04-DATABASE.md` §3.2, `docs/05-API-SPEC.md` §2·§4.4, `docs/06-UI-UX.md` §5.6, `docs/08-SCORING.md` §3.2·§3.4·§4, `docs/09-SECURITY.md`(RBAC 표·프로필 열람), `docs/PROGRESS.md`, 스펙 frontmatter

- [ ] ADR-052를 "채택"으로 적는다. 사용자 결정 D1~D8이 근거다.
  - 내용 1: ADR-020 "회사 프로필" 줄을 개정한다. 운영 DB는 공개 자료 프로필(`is_demo=false`)이고, 로컬·시험·`demo:reset`은 가상 프로필이다.
  - 내용 2: EXECUTIVE 역할과 RLS를 그대로 둔 이유(스펙 §4-5).
  - ADR-020 본문 위에 개정 콜아웃을 단다.
- [ ] 08에 null 금액(금액비 0.5)·null 완료일(최근성 0.2)·규모 적합성의 null 제외를 적는다. 05 §4.4에는 nullable 필드와 `sources`·`publicHistory`를 적는다.
- [ ] frontmatter와 위키링크 규약을 지키고, `pnpm format`을 돌린다.
- [ ] 커밋: `docs: 회사 공개 프로필·임원 역할 ADR-052`

## Task 9: 통합 검증

- [ ] 전체 검증을 돌린다.
  - 실행: `bash <verify-slot.sh> pnpm verify`
  - 기대: exit 0
- [ ] 로컬 화면을 확인한다.
  - 준비: `pnpm db:start` → `pnpm demo:reset` → CLI로 로컬에 `--apply` → 로컬 계정 하나를 EXECUTIVE로 바꾼다.
  - ADMIN·EXECUTIVE·VIEWER로 `/company`를 열고, 1440·1280px 스크린샷을 `docs/evidence/company-public-profile/20261027/`에 남긴다.
  - 공고 하나를 분석해 새 revision으로 SCORED가 나오는지 본다. `AI_PROVIDER=mock`으로 한다.
- [ ] 독립 리뷰를 1회 받는다(`security-auditor`: 역할·403·RLS 유지 판단). 받은 지적을 확인하고 반영한다.
- [ ] 사용자 확인 뒤 main에 병합하고 push한다.

## Task 10: 운영 반영 (단계마다 실행 직전 사용자 확인)

1. `NODE_EXTRA_CA_CERTS=~/.supabase/prod-ca-2021.crt pnpm db:push`. 이어서 `pnpm db:verify`.
2. Vercel 운영 배포 READY와 `/health/ready` 200을 확인한다.
3. 진행 중인 회사 서버 배포가 없는지 확인한다. 예: 서비스별 수집 격리 반영(2026-10-27 승인 대기). 있으면 같은 창에 묶을지 사용자와 정한다.
4. 회사 AI gateway와 Worker를 새 코드로 갱신한다(`infra/company/README.md`). 수집 Worker 재시작 시점은 사용자와 정한다.
5. DEMO 정리 실행서 03 삭제를 돌린다(D6, `docs/evidence/demo-cleanup/20261026/summary.md` 절차, Worker가 한가할 때).
6. `pnpm ops:company-profile -- --env-file <운영 env> --file docs/evidence/company-public-profile/20261027/profile.json --created-by <ADMIN 이메일>`을 dry-run으로 돌려 출력을 사용자에게 보인다.
7. 사용자 확인 뒤 같은 명령에 `--apply`를 붙여 돌린다.
8. 다시 분석한다. 시연할 공고부터 하고, live 24시간 호출 예산 약 260회 안에서 나눈다.
9. 운영에서 ADMIN으로 `/company`를 열어 확인하고, 운영 반영 증거를 `docs/evidence/company-public-profile/`에 남긴다.
10. 스펙을 `polaris/specs/done/`으로 옮기고 PROGRESS를 갱신한다.

## 관련 문서

- [[16-DECISIONS|결정 기록]]
- [[08-SCORING|08 스코어링]]
- [[06-UI-UX|06 UI]]
- [[09-SECURITY|09 보안]]
- [[PROGRESS|진행 상황]]
