---
title: "솔리데오 가상 인력 구현 계획 3 — DB·회원가입·필수 정보 보완"
status: in-progress
tags:
  - sol-radar
  - plan
  - auth
updated: 2026-10-16
---

# 솔리데오 DB·회원가입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 200명 가상 인력을 계정과 분리해 seed하고 이메일 가입·간편 가입·기존 사용자에게 부서/직급 필수 입력과 안전한 업무 진입 검증을 제공한다.

**Architecture:** [명부 계획](2026-10-16-solideo-people-data.md)의 안정 코드·네 JSON·공개 투영을 사용한다. `profile` 도메인이 가입 신고 정보·카탈로그 검증을 소유하고 Route Handler/화면이 auth·organization 도메인을 조합한다. `profiles`의 nullable FK와 RLS는 OAuth 초기 상태를 허용하고 서버 업무 가드가 미완료 접근을 막는다.

**Tech Stack:** Next.js 16.4, React 19, Supabase Postgres/RLS/Auth/SSR, zod 4, react-hook-form, 기존 Base UI Select, Vitest(node/browser), PGlite, Playwright.

**Spec:** [승인 스펙](../../polaris/specs/planned/2026-10-16-solideo-people-signup.md) §3·8~10, [04 DB](../04-DATABASE.md), [05 API](../05-API-SPEC.md) §8, [06 UI](../06-UI-UX.md) §5, [08 점수](../08-SCORING.md), [11 검증](../11-TESTING.md) PPL-04~07. 사진은 [별도 계획](2026-10-16-solideo-people-portraits.md)이며 가입 UI 완성의 선행 조건은 아니다.

## Global Constraints

- 회사 **솔리데오** 고정. 공개 옵션은 코드·표시명·버전 `solideo-organization/v1.0`만 전달한다. 회사 선택·새 회사 생성·전환 UI를 추가하지 않는다.
- 가입자 이름은 기존 **1~40자**. 명부 전용 세 글자 규칙을 실제 가입자에게 강제하지 않는다.
- Auth 메타데이터 키는 `name`, `department_code`, `job_title_code`. API 입출력은 `name`, `departmentId`, `jobTitleId`. 공개 코드를 DB UUID로 검증·매핑한다.
- 신고 값은 소속/권한 증명이 아니다. 멤버십·`org_role`·`sol_role`·`is_admin`을 자동 부여하거나 이름으로 가상 직원을 연결하지 않는다.
- `declared_department_id`·`declared_job_title_id`는 nullable + `ON DELETE SET NULL`. 현재 이름·카탈로그 유효성으로 서버가 `profileComplete`를 계산한다.
- 요청 DB 통로는 anon 키+사용자 세션이다. service role은 seed에만 사용한다. 새 표는 즉시 RLS, migration append-only, DB 타입은 생성한다.
- 데스크톱 1280px 이상, 검증 폭 1440·1280. 기존 토큰·Select·폼 패턴을 사용한다. 모바일·결제·전체 입찰 파이프라인을 만들지 않는다.
- 새 API는 `/api/v1` 계약을 따른다. 기존 템플릿 Bearer 전용 API의 인증·오류 형태를 조용히 바꾸지 않는다. 배포/클라우드 DB push는 별도 사용자 확인 없이 실행하지 않는다.

## Review Focus

1. 직접 Auth 가입·OAuth·낡은 카탈로그로 미완료 프로필 생성: Task 1의 null/위조 구분, Task 3의 보완·재로그인 검사.
2. 부서/직급만 바꿔 다른 조직 접근·관리자 권한 획득: Task 1의 직접 SQL/RLS·메타데이터 위조 검사.
3. 쿠키 PATCH CSRF·Bearer 폴백·남의 userId 주입: Task 2의 인증 소스·헤더·strict DTO 계약 검사.
4. `next`·직접 URL·Server Action/API로 보완 우회하거나 redirect loop: Task 3의 경로별 가드 및 OAuth 연결/비밀번호 복구 회귀 검사.
5. 카탈로그 재시드가 일반 계정을 지우거나 전체 200명을 가용 인력으로 계산: Task 1의 FK null/보존 검사, Task 4의 멱등·20 FTE/골든 검사.

---

## 실행 전 읽을 문서와 변경 파일

웹 코드를 쓰기 전에 `web/node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `forms.md`, `backend-for-frontend.md`, `01-app/03-api-reference/03-file-conventions/route.md`를 읽는다. 로컬 `architecture`, `database`, `conventions`, `design-system`, `testing` 스킬을 해당 태스크에 적용한다. 새로운 필수 정보 화면은 구현 전에 `.claude/agents/web-designer.md`의 디자인 스펙과 06 문서의 고정 회사·필드·오류·로딩·초점 규약을 확정한다.

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261016000001_solideo_people_signup.sql` 및 `20261016000002_declared_employment_cascade.sql` | 3개 표·신고 FK·검증/가입 트리거·권한/RLS. 실행 시 같은 번호가 생겼다면 더 큰 새 번호 사용 |
| `scripts/people/seed.mjs`, `scripts/people/seed.test.mjs` | 안정 UUID 매핑·로컬 전용 카탈로그/명부 upsert |
| `scripts/database.test.mjs`, `scripts/db-seed.mjs`, `scripts/db-seed.test.mjs` | RLS·기존 로그인 E2E seed의 신고 정보 보완 |
| `web/lib/database.types.ts` | `pnpm db:types` 생성물 |
| `web/server/shared/employment.ts`, `web/server/shared/index.ts` | 클라이언트/서버 공용 zod DTO 스키마와 배럴. 서버 전용 import·개인 명부 없음 |
| `web/server/profile/profile.{model,repo,service}.ts`, `profile.catalog.ts`, `index.ts` | 프로필 상태·공개 옵션·본인 신고 정보 검증/저장 |
| `web/app/api/v1/_lib/http.ts`, `signup-options/route.ts`, `me/employment/route.ts` | v1 응답·세션/CSRF·공개 옵션/본인 API |
| `web/app/auth/employment-fields.tsx`, `complete-profile/{page.tsx,complete-profile-form.tsx}` | 기존 Select로 공통 부서/직급 필드·보완 폼 |
| `web/app/auth/sign-up/{page.tsx,sign-up-form.tsx,sign-up-schema.ts}` | 이메일 가입 카탈로그·필수 검증·Auth 요청 매핑 |
| `web/app/auth/{login/page.tsx,callback/route.ts,confirm/route.ts}` | 인증 후 보완 경로 처리, 안전한 next 유지 |
| `web/app/(app)/employment-guard.ts`, `web/app/(app)/[slug]/workspace.ts` | 서버 업무 진입 검증, 기존 페이지/액션이 사용하는 공통 지점 |
| `web/server/scoring/{staff-availability.model.ts,staff-availability.test.ts,index.ts}` | 명부→계산 스냅샷/가용 FTE의 순수 함수와 회귀 검사 |
| `web/e2e-auth/signup-employment.spec.ts`, `signup-employment.write.spec.ts` | 읽기·쓰기 분리한 로컬 통합 흐름 |

테스트는 변경 파일 옆 `*.test.ts`/`*.browser.test.tsx`에 둔다. profile/scoring 도메인은 `import "server-only";`로 시작하고 외부 호출은 배럴만 쓴다. 브라우저에서도 쓰는 공용 zod DTO는 기존 `server/shared` 패턴대로 서버 전용 import를 넣지 않으며 `@/server/shared` 배럴로 쓴다. 현재 lodestar에서 domain→lib 런타임 import는 금지되어 있으므로 DTO를 lib에 두거나 계층 규칙을 바꾸지 않는다.

## Task 1: 카탈로그·가상 명부·신고 FK와 로컬 seed

**Files:** 위 migration, `scripts/people/seed.mjs`, `scripts/people/seed.test.mjs` Create; `scripts/database.test.mjs`, `scripts/db-seed.mjs`, `scripts/db-seed.test.mjs`, `scripts/db-verify.mjs`, `package.json` Modify; `web/lib/database.types.ts` Generate.

**Interfaces:** Produces SQL `departments`, `job_titles`, `team_members`와 `profiles.declared_department_id/declared_job_title_id`. Node `personUuid(personId:string):string`, `seedSolideoPeople({client,orgId:string,fixtures}):Promise<{peopleCount:number}>`; `client`는 seed의 service role 클라이언트이며 인력 함수에는 Auth admin 인터페이스를 전달하지 않는다. UUID v5의 DNS namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8`에서 `sol-radar:org-01:<안정 코드>`를 사용해 인물·카탈로그 UUID를 파생하고, 조직은 `sol-radar:org-01`/`sol-radar:org-02`를 사용한다. CLI `pnpm people:seed`는 기존 로컬 URL 거절 규칙을 재사용한다. SQL `resolve_solideo_employment(p_department text,p_job_title text)`는 안정 코드 또는 FK UUID 문자열을 받아 `{department_id,department_code,department_name,job_title_id,job_title_code,job_title_label}` 1행 또는 검증 오류만 반환한다. 조직에 아직 합류하지 않은 본인의 신고 정보를 읽고 쓸 때도 필요한 최소 카탈로그 변환용이다.

- [x] **1. 실패 시험 작성:** `scripts/database.test.mjs`에서 04 DB 열/복합 FK/RLS, 타 조직 0행, 카탈로그·명부 일반 사용자 쓰기 거부, 본인 신고 값만 변경, 알려지지 않은/다른 회사 코드 거부, 메타데이터 `is_admin` 위조 무효를 단언한다. OAuth처럼 메타데이터가 없으면 nullable 생성, 하나만 있거나 빈/위조 값이면 거절한다. Solideo 비멤버가 resolver로 허용 코드/자기 신고 FK를 변환하고 본인 UPDATE를 할 수 있지만 부서 가중치/명부/조직 데이터는 못 읽는지 검사한다. 카탈로그 삭제 시 일반 Auth 계정은 남고 신고 FK만 null이어야 한다. 원본 파일은 DB 시험에서 읽지 않는다.
- [x] **2. 실패 확인:** `pnpm test:db` → 새 표/FK/트리거가 없어 FAIL. seed 시험에는 같은 입력 두 번 실행 후 200행·동일 UUID·Auth API 호출 0·비로컬 거절을 먼저 추가하고 `node --test scripts/people/seed.test.mjs` FAIL을 확인한다.
- [x] **3. 구현:** 새 migration에 04 계약대로 표·UNIQUE/복합 FK·RLS/권한을 정의한다. `profiles` 갱신은 본인+활성 계정+고정 솔리데오 카탈로그만 허용하고 이름/두 FK를 하나의 UPDATE로 저장한다. resolver만 SECURITY DEFINER·고정 search_path·authenticated 실행으로 열어 공개 코드/표시명과 FK UUID만 변환하고 임의 org_id·인원·권한은 받거나 반환하지 않는다. 실제 프로필 UPDATE는 사용자 세션+기존 본인 RLS를 거친다. `handle_new_user`를 새 migration에서 교체하되 기존 OAuth 이름/HTTPS avatar 추출·개인 조직 bootstrap을 보존한다. 트리거는 정해진 카탈로그만 조회하며 search_path를 고정한다. 기존 5개 로컬 시험 계정·템플릿 시험 조직은 유지하고, Solideo 카탈로그를 Auth 계정보다 먼저 seed한 뒤 시험 계정에 유효한 신고 정보를 준다. `org-01` Solideo·숨은 `org-02` fixture 조직은 명시 UUID로 구분하고 템플릿 팀을 암묵적으로 Solideo로 바꾸지 않는다. 새 Auth 계정 200개나 전체 데모 reset을 추가하지 않는다.
- [x] **4. 통과 확인:** `pnpm db:types`, `pnpm test:db`, `node --test scripts/people/seed.test.mjs scripts/db-seed.test.mjs` PASS. `test:db`의 기존 배포 전 검증도 새 migration을 적용한 PGlite로 검사한다. `scripts/db-verify.mjs` allowlist에는 resolver의 공개 필드 변환만 허용하는 이유와 `public.resolve_solideo_employment(text, text)` 시그니처만 더한다. 검사 자체는 유지한다. `pnpm db:verify`는 실제 연결 DB용이므로 이번 로컬 구현 검증 명령으로 사용하지 않는다.
- [x] **5. 커밋:** migration·타입·seed·정책 시험·package만 명시해 `git commit -m "feat: 솔리데오 인력과 가입 정보 저장 구조"`.

## Task 2: profile 도메인과 v1 API 계약

**Files:** Create `web/server/shared/employment.ts`, `web/server/profile/profile.catalog.ts`, `web/app/api/v1/_lib/http.ts`, `web/app/api/v1/signup-options/route.ts`, `web/app/api/v1/me/employment/route.ts`와 인접 시험; Modify `web/server/shared/index.ts`, profile model/repo/service/index 및 인접 시험.

**Interfaces:** 공용 zod에서 `SignupOptions`, `EmploymentInput`, `EmploymentState`를 추론하며 05 §8과 이름/필드/값이 일치한다. Produces `getSignupOptions():SignupOptions`, `getMyEmployment(repo?:ProfileRepo):Promise<EmploymentResult>`, `saveMyEmployment(input:unknown,repo?:ProfileRepo):Promise<EmploymentResult>`; `EmploymentResult={status:"ready",state:EmploymentState}|{status:"signed-out"|"suspended"|"missing"|"no-database"}|{status:"invalid",fields:Record<string,string>}`. Repo `updateEmployment(id:string,input:EmploymentInput):Promise<boolean>`는 resolver로 코드→FK 검증 후 단일 UPDATE한다. 조회도 현재 본인 FK→코드 변환을 거친다. `ProfileView`에 `employment`·`profileComplete`를 추가한다. v1 helper `requireCompleteUser(request:Request):Promise<{ok:true,user:AuthUser}|{ok:false,response:Response}>`는 인증과 본인 완료 상태만 검사하며 이후 업무 API가 별도로 조직 권한을 검사한다.

- [x] **1. 실패 시험 작성:** profile 시험에서 `name:null`이면 두 선택이 있어도 미완료, 유효 이름+선택이면 완료, 없는/삭제된 코드면 미완료, 임의 `userId/orgId/is_admin/profileComplete` 필드는 strict DTO에서 거절됨을 단언한다. Route 시험은 public 옵션 정확 키, 미로그인 401, 정지 403, PATCH 쿠키+CSRF 없음 403, 유효 쿠키+`X-Requested-With: sol-radar` 200, Bearer는 헤더 없이 200, 잘못된 Bearer를 쿠키로 우회하지 않음, 오류 `requestId`·`Cache-Control:no-store`를 검사한다. 사용자 A가 B의 정보를 쓰는 경로는 없어야 한다.
- [x] **2. 실패 확인:** `pnpm -C web exec vitest run server/profile app/api/v1` → 새 함수/API 미구현 FAIL.
- [x] **3. 구현:** 공개 투영만 읽는 catalog 함수와 공유 zod를 만들고 기존 profile에 추가한다. 서버는 현재 이름·FK/카탈로그 유효성을 다시 계산한다. 새 v1 helper가 세션/Bearer 검증과 CSRF·대문자 오류 envelope를 제공한다. `/me/employment`는 조직 소속 전에도 본인만 쓸 수 있다. 기존 `/api/_lib/http.ts`와 템플릿 API의 Bearer 전용 계약을 유지하고 회귀 시험을 돌린다. 무효 Auth 가입 오류는 Supabase의 실제 오류에서 UI 필드 오류로 매핑하며 v1 envelope라고 가정하지 않는다.
- [x] **4. 통과 확인:** 위 Vitest 및 `pnpm -C web exec vitest run app/api/users app/api/auth app/api/admin` PASS. 기존 프로필 mock도 새 필드를 포함하도록 갱신하고 타입/계층 검사 PASS.
- [x] **5. 커밋:** 공용 DTO·profile·v1 handler·해당 시험만 명시해 `git commit -m "feat: 가입 카탈로그와 본인 정보 API 추가"`.

## Task 3: 가입 폼·보완 화면·업무 진입 가드

**Files:** 위 auth 필드/보완 화면/가드 Create; sign-up 3파일·login/callback/confirm·workspace Modify. 기존 업무 페이지/액션 중 가드를 호출하지 않는 진입점도 Modify: `web/app/(app)/home.ts`, `web/app/(app)/[slug]/tasks/actions.ts`, `settings/members/actions.ts`, `settings/team/actions.ts`. Test `web/app/auth/sign-up/sign-up-schema.test.ts`, `web/app/auth/employment-fields.browser.test.tsx`, `web/app/auth/complete-profile/complete-profile-form.browser.test.tsx`, `web/app/(app)/employment-guard.test.ts`, 콜백/confirm·페이지/액션 인접 계약 시험.

**Interfaces:** Produces `createSignUpSchema(options:SignupOptions)`(기존 검증+필수 코드), `toSignUpRequest(values:SignUpValues)`(승인 Auth metadata), `EmploymentFields({options,control,disabled})`, `requireCompleteEmployment(next:string):Promise<void>`. 페이지/액션이 도메인 배럴들을 조합하며 도메인끼리 런타임 호출하지 않는다. 보완 폼은 `PATCH /api/v1/me/employment`와 필수 CSRF 헤더를 쓴다.

- [x] **1. 실패 시험 작성:** 이름 1~40자/약관/비밀번호/선택 사항 기존 검사 유지 + 부서/직급 빈 값·위조 코드 거절·Auth metadata 정확 키를 단언한다. 브라우저 시험은 회사 솔리데오 표시, 회사 selector 없음, 키보드 선택, 오류 필드 초점, 제출 중 중복 방지, 저장 실패 후 입력 유지/재시도를 검사한다. 가드 시험은 `next` 직접 진입·내부 이동·Server Action 호출에서 미완료면 `/auth/complete-profile`, v1 업무 helper는 `403 PROFILE_INCOMPLETE`+`completionPath`를 반환하게 한다. 완료자의 권한은 기존 멤버십/RLS로 검사한다.
- [x] **2. 실패 확인:** `pnpm -C web exec vitest run app/auth app/\(app\)/employment-guard.test.ts`와 해당 browser 시험을 실행해 요구 기능 부재로 FAIL을 확인한다.
- [x] **3. 구현:** 가입 페이지가 서버에서 옵션을 받아 폼에 전달하고 이름 가까이에 부서·직급/직책 필수 Select를 둔다. `/auth/complete-profile`는 현재 이름/선택값으로 시작하고 원자적 PATCH 성공 후 안전한 내부 next 또는 기존 홈으로 이동한다. login은 기존 next 분기보다 먼저 완료를 확인한다. callback/confirm은 인증 성공 후 확인하되 OAuth 계정 연결·비밀번호 복구·실패 경로를 가로채지 않는다. 모든 업무 페이지와 mutation/API 경계에서 가드를 호출하며 layout/proxy만으로 막지 않는다. 로그인·콜백·옵션·본인 보완·로그아웃·계정 복구·초대 안내는 허용한다. 초대 수락 후에도 미완료 업무 진입은 막는다.
- [x] **4. 통과 확인:** 위 단위/browser 검사 PASS. 페이지·Server Action·기존 API 목록을 대조해 실제 업무 데이터 진입점의 우회가 없는지 기록한다. 기존 템플릿 API 중 업무 데이터 엔드포인트가 없으면 없는 것으로 기록하고 가상의 입찰 API를 만들지 않는다. 계정 관리/로그아웃/정지 안내와 조직 권한 검증 회귀 PASS. 1440·1280에서 가로 넘침·Select 팝업·Tab/방향키/Enter·라벨·오류 초점을 확인한다.
- [x] **5. 커밋:** 이 태스크 auth/업무 가드·호출 지점·시험 파일만 명시해 `git commit -m "feat: 가입 부서 직급과 정보 보완 적용"`.

## Task 4: 인력 계산 회귀·seed 멱등·통합 검증

**Files:** Create scoring 3파일과 `web/e2e-auth/signup-employment.spec.ts`, `signup-employment.write.spec.ts`, `docs/evidence/people/20261016-people-integration.md`; Modify `web/e2e-auth/support/seed.ts`, `scripts/demo-people.test.mjs`, `docs/11-TESTING.md`, `docs/PROGRESS.md`.

**Interfaces:** Produces `toScoringTeam(people,assignments,asOf:string):{members,assignments,asOf}`(계산 대상만, 이름/성별/사진 제외), `availableFte(team,period:{startsAt:string,endsAt:string}):number`, `toPeopleProfile(people,assignments,asOf:string):{financials:{employeeCount:number},team:ReturnType<typeof toScoringTeam>}`. 재무의 인원 수는 전체 명부 길이에서 계산하며 team은 27명만 포함한다. 기존 전체 점수 엔진은 아직 없으므로 이 태스크는 08 §3.3의 인력 계산과 §6 worked example의 나머지 요소값을 결합한 회귀를 명시적으로 구분한다. 전체 공고/추출/규칙 엔진 통합 골든은 Phase 4까지 미완료로 남긴다.

- [x] **1. 실패 시험 작성:** `financials.employeeCount=200`과 200명→27명 snapshot, 역할 2/4/18/3, 2026-12~2027-06 가용 20 FTE, 비대상 173명의 스킬·가용성 변경/성별·사진 변경에도 계산 결과 동일, 배정 기간 겹침/경계·100% 배정 제외를 단언한다. 명부 길이를 바꾼 합성 입력에서는 employeeCount도 바뀌어야 한다. 08 §6의 FX-01/02/03 fixture 요소와 새 인력 계산을 사용한 합계가 `[94,72,68]`인지 검사한다. 상수를 그대로 반환하거나 점수 배열을 스스로 합격시키는 시험을 만들지 않는다. E2E는 이메일 필수 입력→확인/재로그인 유지, 간편 가입과 같은 미완료 DB 상태→보완→업무 접근, 기존 미완료 계정의 직접 URL/API 차단·로그아웃 허용, 보완만으로 org-01 접근 불가를 검사한다.
- [x] **2. 실패 확인:** `pnpm -C web exec vitest run server/scoring`과 `pnpm -C web exec playwright test -c playwright.auth.config.ts signup-employment --list`로 실패 시험/실행 대상이 존재하는지 확인한다. E2E는 목록 확인을 실행 통과로 기록하지 않는다.
- [ ] **3. 구현:** 순수 snapshot/기간 FTE 함수만 추가하고 전체 입찰 분석 기능은 만들지 않는다. 로컬 seed/E2E에서 기존 5계정 재생성 뒤 인력 seed 2회, 안정 UUID·200명·추가 Auth 생성 0을 확인한다. 문서의 제품 데모 5계정과 현재 템플릿 로컬 시험 5계정은 목적이 다르므로 계정 이름/역할을 임의로 치환하지 않는다. OAuth 외부 제공자 설정은 후순위 그대로 두고 실제 OAuth E2E를 실행하지 않았으면 미실행으로 기록한다. 쓰기 E2E는 기존 `chromium-write` 단계에 둬 읽기 테스트와 상태를 충돌시키지 않는다.
- [ ] **4. 통과 확인:** `pnpm verify`, `pnpm -C web test:browser`, `pnpm -C web test:e2e`, 로컬 Supabase에서 `pnpm -C web test:e2e:auth`, 사진 완료 후 `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx`. 1440·1280 스크린샷/키보드·RLS·seed 멱등·실제 실행/미실행을 증거에 분리한다. 로컬 DB가 없으면 read-only 환경 점검을 하고 실행 가능한 로컬 DB 준비로 해결한다. 클라우드로 시험 대상을 바꾸지 않는다. 최종 독립 리뷰의 계약/보안 문제를 수정한 뒤 필요한 검사만 재실행한다.
- [ ] **5. 커밋:** 이 태스크 scoring/E2E/support/검증 문서만 명시해 `git commit -m "test: 인력 가입 흐름과 가용성 회귀 검증"`. 세 계획의 완료 항목을 사실대로 갱신하고 검증 실패·미실행이 남으면 기능 전체 완료라고 보고하지 않는다.

Task4 구현자 현황(2026-10-16): 순수 계산10건 RED→GREEN, 신규 읽기3/쓰기4 E2E 발견. 단계3의 실제 로컬 seed2회·단계4 전체 통합/화면 QA는 구현자와 다른 최종 QA 담당자가 실행한다. E2E 목록 확인을 실행 PASS로 기록하지 않는다. 단계3/4/전체 기능은 그 결과 전까지 미완료다. [증거 초안](../evidence/people/20261016-people-integration.md).

## 계획 자체 검토

승인 스펙 §8은 Task 1~3, §9~10은 Task 4와 나머지 두 계획으로 연결했다. 공개 카탈로그·신고 정보·로그인 계정·가상 인력의 경계를 분리했고, 스키마/실제 Auth 오류/기존 API 호환을 각각 검사한다. 전체 점수 엔진·실제 OAuth 제공자 연동은 기존 Phase 범위를 유지하며 해당 미구현 부분을 통합 검증 완료로 과장하지 않는다. 실행은 데이터 계획 완료 후 사진/가입을 독립적으로 진행할 수 있고 최종 검증에서 합친다.
