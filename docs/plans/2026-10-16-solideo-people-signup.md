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


ADR-021 아래 후속 제약은 Task5~9에 적용하며 과거 Task1~4의 당시 구현 기록을 대체하지 않는다.

- 공유 Supabase `sol-radar`에 새 migration/변경된 seed를 적용하지 않는다. 클라우드 push·main 병합·기존 migration 수정·작업 초기화 금지. PGlite 후 고유 project_id/모든 포트의 별도 임시 Supabase에서 실제 검증한다.
- 기존200명 ID/UUID·이름·100/100 성별·팀38개 ID/표시명/목표·직급·사진 경로/manifest·27명/20FTE 입력을 보존한다. 사진 작업은9663의 독립 worker 소유이며 이 계획에서 수정하지 않는다.
- 부서는 `DIVISION`→`GROUP`→`TEAM`; `DIVISION`→`TEAM` 허용. kind 누락/null은 기존 TEAM, 불명확한 parentId는 null+이유다. 확인된 상위 조직만 추가하고 팀 합산으로 부모가 여러 개면 임의 선택하지 않는다. 본부/그룹 targetCount/sourceCount는 null이며 팀만 기존 양의 목표/원본 가중치를 갖는다. 가입 목록·200명 배분·소속은 TEAM만이다.
- fixture 구조 버전2를 추가해1/2를 읽되, 팀 공개 투영이 같으면 공개 catalogVersion `solideo-organization/v1.0`은 유지한다. 새 상위 ID는 SOL-D038 뒤에 안정적으로 추가한다.
- 운영200행과 scoring27행을 같은 직원 ID로 분리한다. 이미 구현한 예전 컬럼은 새 migration에서 검증·backfill 후 제거한다. 순수 계산 입력/골든 의미를 바꾸지 않는다.
- 새 가입은 profile만 만들고 개인 조직/멤버십을 만들지 않는다. 기존 개인 조직은 삭제하지 않는다. 현재 업무 조직은 `personal_owner_id IS NULL`인 실제 멤버십만 세어0→초대 안내,1→해당 조직,2+→차단이다. 신고 부서·이름·요청 org/slug/헤더로 조직이나 권한을 만들거나 고르지 않는다.
- 프로필/활성 상태를 업무 경계에서 먼저 검증한다. 보완·계정 관리·받은 초대는 조직 가입 없이도 접근한다. `/auth/organization-state` 설계는 가입 UI 스펙의 ADR-021 부록을 따른다. safe next의 auth 경로 제한을 넓히지 않고 `/dashboard`가 서버 재판정 진입점이다.
- 이번 범위는 요청한 가입/DB 정합화다. 기존 slug 화면은 서버가 고른 단일 조직과 일치할 때만 연결하는 호환 경로다. 완전한 slug 없는 앱 셸(N1), sol_role/ADMIN 구성원 정책 전체 전환(N2), /people, /ops, sidebar/P1은 별도 미완료로 기록하며 구현 완료로 주장하지 않는다. org_role·이메일·메타데이터로 sol_role을 추론하지 않는다.
- 새 업무 API가 없으므로 사용되지 않는 조직 middleware나 가짜 `/me`를 만들지 않는다. 0조직 API는 실제 호출자가 생길 때 `403 ORGANIZATION_REQUIRED`+초대 경로, 복수는 확정 `403 UNSUPPORTED_ACCOUNT_STATE`다. session 전용 employment API에는 조직을 요구하지 않는다.

- Task5 원본 입력은 읽기 전용 `/Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx`, SHA-256 `d4febca8607f628d4fd405c5dac423d2eb0b7f6d4ab926f691ec45488b79a4c3`다. 원본 이름/연락처/제외 집합은 출력·저장·모델 프롬프트에 넣지 않는다.

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
- [x] **3. 구현:** 순수 snapshot/기간 FTE 함수만 추가하고 전체 입찰 분석 기능은 만들지 않는다. 로컬 seed/E2E에서 기존 5계정 재생성 뒤 인력 seed 2회, 안정 UUID·200명·추가 Auth 생성 0을 확인한다. 문서의 제품 데모 5계정과 현재 템플릿 로컬 시험 5계정은 목적이 다르므로 계정 이름/역할을 임의로 치환하지 않는다. OAuth 외부 제공자 설정은 후순위 그대로 두고 실제 OAuth E2E를 실행하지 않았으면 미실행으로 기록한다. 쓰기 E2E는 기존 `chromium-write` 단계에 둬 읽기 테스트와 상태를 충돌시키지 않는다.
- [ ] **4. 통과 확인:** `pnpm verify`, `pnpm -C web test:browser`, `pnpm -C web test:e2e`, 로컬 Supabase에서 `pnpm -C web test:e2e:auth`, 사진 완료 후 `pnpm people:check:release -- --input /Users/leegwanghui/dev/hackathon/sol-radar-inputs/people.xlsx`. 1440·1280 스크린샷/키보드·RLS·seed 멱등·실제 실행/미실행을 증거에 분리한다. 로컬 DB가 없으면 read-only 환경 점검을 하고 실행 가능한 로컬 DB 준비로 해결한다. 클라우드로 시험 대상을 바꾸지 않는다. 최종 독립 리뷰의 계약/보안 문제를 수정한 뒤 필요한 검사만 재실행한다.
- [x] **5. 커밋:** 이 태스크 scoring/E2E/support/검증 문서만 명시해 `git commit -m "test: 인력 가입 흐름과 가용성 회귀 검증"`. 세 계획의 완료 항목을 사실대로 갱신하고 검증 실패·미실행이 남으면 기능 전체 완료라고 보고하지 않는다.

Task4 현황(2026-10-16): 구현90c67bc 및 독립 리뷰 완료. 원래 구현자 수정·별도 검토 후 기존 계획 코드 QA 통과: verify/build·공개130·브라우저89(`83e1fac`), 인증92(`bff0daad`), 실제 seed2회·1440/1280 시각/키보드 검사. 단계4의 사진 release·사람 검수와 ADR-021 후속 정합화는 남아 있다. 전체 기능 완료를 뜻하지 않는다. [커밋별 증거](../evidence/people/20261016-people-integration.md).

## 계획 자체 검토

승인 스펙 §8은 Task 1~3, §9~10은 Task 4와 나머지 두 계획으로 연결했다. 공개 카탈로그·신고 정보·로그인 계정·가상 인력의 경계를 분리했고, 스키마/실제 Auth 오류/기존 API 호환을 각각 검사한다. 전체 점수 엔진·실제 OAuth 제공자 연동은 기존 Phase 범위를 유지하며 해당 미구현 부분을 통합 검증 완료로 과장하지 않는다. 실행은 데이터 계획 완료 후 사진/가입을 독립적으로 진행할 수 있고 최종 검증에서 합친다.


## ADR-021 후속 기준과 적용 순서 (2026-10-16)

기존 Task1~4의 코드 통합 QA 후 사용자 지시대로 후속 작업을 진행한다. 위 단계는 당시 구현·검증 기록이며, 아래 Task5~9와 이 절의 계약이 개인 조직 bootstrap·한 표 인력 저장·평면 카탈로그에 관한 과거 지시를 대체한다. 기존 실행 방식2와 현재 격리 worktree를 유지한다.

**정본:** 원본 체크아웃의 `114a10aa245b76909c4952c3c82a473337ba0cbd`에서 최신04·05·06·07·08·09·16과 승인된 sidebar 설계를 읽고 이 worktree에 동기화했다. 관련21·AI 설계·사용자 sidebar 입력 문서는 참조용이며 AI/전체 sidebar 구현 요청이 아니다. 원본 체크아웃·다른 세션 파일은 수정하지 않았다. 기존 증거·PROGRESS·가입 UI 자식 스펙은 보존한다.

추가 제약은 위 **Global Constraints**의 ADR-021 항목으로 통합했다. 모든 후속 task brief에 같은 계약을 전달한다.

**후속 Review Focus:** 계층 검증과 동일 팀 보존(Task5), populated-schema upgrade/RLS/seed conflict key(Task6), 직접 Auth/RPC/UPDATE와 FK cascade·기존 개인 조직 보존(Task7),0/1/2+실제 멤버십·위조 slug·재진입/복구/초대 예외(Task8), 별도 Supabase 실검증과 증거 정직성(Task9).

## Task 5: Hierarchy-capable catalog with unchanged roster/public projection

**Files:** modify `fixtures/people/solideo.departments.json`, `scripts/people/generate.mjs`, `scripts/people/check.mjs`, `scripts/people/workbook.mjs`, `scripts/people/allocation.mjs`, `scripts/people/seed.mjs` (legacy projection filter only) and its focused compatibility regression; create `scripts/people/departments.mjs` and `scripts/people/departments.test.mjs`; update `scripts/people/workbook.test.mjs`, `scripts/people/allocation.test.mjs`, `scripts/demo-people.test.mjs`; regenerate `web/server/profile/signup-options.generated.json` only if its public projection actually changes. Do not rewrite people/job-title/portrait fixtures.

**Interfaces:** `isTeamDepartment(department): boolean` treats absent/null kind as TEAM; `validateDepartmentHierarchy(departments, people): { errors, unresolvedParents, teamCounts, memberCounts }` returns safe IDs/reasons and `{departmentId,targetCount,actualCount,difference}` team rows plus `{departmentId,memberCount}` descendant-count rows. Error/unresolved entries use safe IDs and stable reason codes, never original personnel fields. `projectSignupOptions(departments, jobTitles)` retains its current public shape. Allocation/source comparison consume filtered team rows only, in the existing stable order.

- [x] Add tests: legacy v1 and explicit v2 catalog; DIVISION→GROUP→TEAM and DIVISION→TEAM; absent parent/kind allowed; missing/self/cyclic/depth-4 parent rejected; TEAM parent cannot be a TEAM; upper employee affiliation rejected; upper targets absent accepted; non-null upper targets rejected. Assert 38 public choices, 12 titles, unchanged option IDs/labels and no private fields.
- [x] Run `node --test scripts/people/departments.test.mjs scripts/people/allocation.test.mjs scripts/people/workbook.test.mjs scripts/demo-people.test.mjs` and observe the new cases fail for the intended missing behavior.
- [x] Implement hierarchy parsing/validation and add only evidenced upper rows/links. Make source comparison compare team projection rather than full augmented catalog; maintain 175 recognized/75 excluded/250 source-row provenance and private-name intersection checks. Keep strict known-team identity/allocation checks instead of simply deleting the `38` guard. Report unresolved parents and target/actual/difference.
- [x] Run the same tests and `pnpm people:check:fixtures`; require unchanged people/job-title/portrait hashes and all original team identity/allocation values. Private source comparison is separately reported if the original is available; fixture-only checks never imply it passed.
- [x] Keep the existing SQL consumer coherent before Task6: current departments.target_count is NOT NULL. In this intermediate stage only, seed.mjs projects TEAM/legacy rows to the old table and does not pretend upper rows were persisted. Add a focused real-PGlite legacy-seed regression; existing 38 persisted team rows/200 people/27 eligible assertions stay intact. Task6 removes this compatibility filter and persists parents+children with its new schema. No shared network seed.
- [x] Commit this bounded deliverable with normal hooks after required verification, e.g. `feat: 부서 계층 카탈로그 계약 반영`.

## Task 6: Append-only roster split and seed projection

**Files:** create proposed `supabase/migrations/20261016000003_adr021_people_catalog.sql`; modify `scripts/people/seed.mjs`, `scripts/people/seed.test.mjs`, `scripts/database.test.mjs`, and `scripts/db-verify.mjs` only if a new protected trigger/function requires an explicit allowlist entry; generate `web/lib/database.types.ts`. Preserve `web/server/scoring/scoring.model.ts` pure fixture input contract.

**Interfaces:** consume Task 5 catalog and unchanged roster. `seedSolideoPeople({client,orgId,fixtures})` continues to return `{peopleCount:200}`; extend its adapter contract to `client.upsert(table, rows, conflictColumn)` with explicit `id`/`member_id`. SQL produces `team_member_scoring.member_id = personUuid(personId)` and no duplicated scoring columns on operational rows.

- [x] Add PGlite tests for old-schema populated roster → new migration, fresh full migration, twice-run seed, no unauthorized scoring writes, same-org scoring FK and parent FK, team-only operational membership, 200/27 counts, and operational/scoring field separation. Include a real copied old eligible row so the backfill is exercised rather than tested only after empty schema creation.
- [x] Run `node --test scripts/people/seed.test.mjs scripts/database.test.mjs` for the intended new assertions; old-policy fixtures may need explicit historical data preparation, not disabled assertions.
- [x] In the new migration add hierarchy/target/source constraints, operational `updated_at`, and locked scoring table with organization SELECT-only RLS. Backfill eligible rows before dropping old columns; transactionally validate copied IDs/values before the drop. Define safe cascading delete behavior for scoring rows consistent with parent organization deletion and test it. Enforce employee team membership with a DB trigger or equivalent relational design, not a cross-table CHECK. Remove Task5's old-schema team-only persistence filter together with this migration. Seed validates hierarchy before any writes and writes parents first, then children, titles, people, scoring.
- [x] Update seed adapters and tests for scoring conflict key; preserve catalog-before-Auth ordering. Do not execute any network seed. Run `pnpm db:types`, the targeted tests, `pnpm -C web exec vitest run server/scoring`, and `pnpm check:db-types`. Assert fixed-input golden/capacity behavior remains unchanged; the full scoring pipeline and stored score_runs are not implemented here, so do not claim their end-to-end validation.
- [x] Commit with hooks, e.g. `feat: 명부 운영 정보와 점수 속성 분리`.

## Task 7: Team-only declaration and signup without personal bootstrap

**Files:** create proposed `supabase/migrations/20261016000004_adr021_signup_bootstrap.sql`; modify `scripts/database.test.mjs`, `scripts/database-test-support.mjs` where legacy setup requires explicit historical personal rows, `scripts/db-seed.mjs`/`scripts/db-seed.test.mjs` for absent-personal compatibility only; regenerate types if needed. Review `web/server/profile/profile.repo.ts`, `.service.ts`, `employment.test.ts` and `profile.catalog.test.ts` for rejection mapping; preserve existing session-only API behavior.

**Interfaces:** same Auth metadata keys and `resolve_solideo_employment(text,text)` RPC signature; same employment DTO and profileComplete semantics. New auth users still get profiles but no personal org/membership; existing personal records remain intact.

- [x] Add tests for direct email/OAuth signup with 0 organization/membership creation, forged role/org metadata ignored, TEAM valid and DIVISION/GROUP invalid via signup/RPC/direct UPDATE, no-org own declaration allowed, suspended denied, and v00002 catalog-delete cascade preserved. Add an upgrade test that inserts a legacy personal org before this migration and proves it survives.
- [x] Run `pnpm test:db` and affected profile tests to observe intended failures, then replace functions in the new migration while retaining changed-column validation, grants, search_path and metadata sanitization. Do not remove the historical `create_personal_org` function used by old migrations.
- [x] Explicitly prepare historical personal org fixtures in tests that exercise preservation/deletion/task isolation. Do not restore implicit bootstrap in the global new-signup helper. `scripts/db-seed.mjs` currently dereferences `personal.id`; make its personal-task block conditional on an existing row and never create one as fallback. Its mock test must cover absent and preexisting personal rows without changing the existing five accounts or foreign memberships. This is repository code compatibility, not permission to run seed against shared Supabase.
- [x] Run PGlite, `node --test scripts/db-seed.test.mjs`, and affected profile tests; require no test skips/gate changes. Pair release with Task 8: do not deploy bootstrap removal before new account routing exists.
- [x] Commit with hooks, e.g. `fix: 가입 시 개인 조직 자동 생성 중단`.

## Task 8: Server organization resolver and minimum account-flow bridge

**Files:** also update affected `web/e2e-auth/` fixtures/specs/support, `scripts/db-seed.mjs`, `scripts/people/seed.mjs` CLI target selection only and their meaningful target/isolation regressions; modify `web/server/organization/organization.model.ts`, `.repo.ts`, `.service.ts`, `index.ts`, adjacent model/service tests; create `web/app/auth/organization-state/page.tsx` and `.test.ts`; modify `web/app/auth/login/page.tsx`/`.test.ts`, `web/app/auth/employment-routing.ts`/`.test.ts`, `web/app/auth/account/page.tsx`/`.test.ts`, `web/app/(app)/home.ts`, `web/app/(app)/[slug]/workspace.ts`, `layout.tsx`/`layout.test.ts`; inspect/update invitation acceptance UI (`web/app/invitations/`) and `web/app/(app)/employment-guard.test.ts`. Create a tested business-guard adapter in `web/app/api/v1/_lib/organization.ts` only when used by an actual business caller; do not add dead middleware or change employment to organization-required.

**Interfaces (one source of truth):**

```ts
type CurrentOrganizationResult =
  | { status: 'no-database' | 'signed-out' }
  | { status: 'no-org'; userId: string }
  | { status: 'multiple-orgs'; userId: string }
  | { status: 'ready'; userId: string; current: CurrentOrg };
resolveCurrentOrganization(rows: readonly MyOrgRow[]):
  | { status: 'no-org' }
  | { status: 'multiple-orgs' }
  | { status: 'ready'; current: CurrentOrg };
getCurrentOrganization(repo?: OrganizationRepo): Promise<CurrentOrganizationResult>;
```

Use existing authenticated `listMyOrgs(userId)` and actual `personal_owner_id`; deduplicate by orgId defensively. No resolver request parameters. Query errors remain errors, not NO_ORG. Active/profile completeness is checked by the existing application guard before business resolution; account-status failure takes precedence over release/role/resource checks. Do not manufacture a SolRole until its schema exists.

- [ ] Add resolver cases: zero rows; personal only; one business with/without personal; two business rows; order independence; duplicate orgId defensive normalization; forged slug/org input never selects another organization; DB exception remains error. Assert no organization or membership writes.
- [ ] Run `pnpm -C web exec vitest run server/organization app/auth/employment-routing.test.ts app/auth/login/page.test.ts 'app/(app)/employment-guard.test.ts' 'app/(app)/[slug]/layout.test.ts'`; implement the resolver and call it at every existing business page/action boundary, not layout alone.
- [ ] Add the minimum account-state page using existing AuthFrame/AccountCard: NO_ORG invitation guidance, `/invitations`, account management and logout; MULTIPLE_ORGS exact message “지원되지 않는 계정 상태입니다. 관리자에게 문의하세요”, account management/logout, no workspace. Re-evaluate on request and after invite acceptance. Preserve valid completion destinations but never bypass resolver/profile checks via `next`. Keep session-only account/employment/received-invitation routes accessible.
- [ ] **Explicit bounded routing choice:** for this compatibility slice, `/dashboard` can still bridge to the single server-resolved current organization's existing dashboard. Legacy `getMyWorkspace(slug)` must resolve current first, then only accept the same slug; mismatch/old personal path returns 404, not another workspace. This prevents client organization selection without rebuilding the app shell. It is intentionally not completion of ADR-021's slugless routing target; N1 must later move actual dashboard/settings content to canonical slugless routes and replace legacy links. Do not claim that target complete. Remove/hide the organization switch/create affordances in this bridged shell; do not introduce a new selector. Any retained direct template route/action must fail closed for unsupported account states.
- [ ] Retire the template `/teams/new` business-organization creation form and its public server action: READY direct access is an unreleased 404 with no mutation; NO_ORG/MULTIPLE use current-state handling, preserving signed-out/no-database guide/noindex behavior. This removes a template company-creation entry in the fixed-Solideo slice; it does not remove the 38 department TEAM selectors or complete N2 organization-admin/RLS policy work.
- [ ] Apply the separately assigned focused design in sibling `adr-021-account-ui-extension.md` when delivered; do not duplicate that design work. Designer coordination agrees on `/auth/organization-state`, read-error/loading states, and changing `/auth/account`'s completion-only return link to “서비스로 돌아가기” through this state route. Invitation acceptance reruns completion/current-org routing rather than trusting `result.slug`. This is the unavoidable UI work; it does not authorize sidebar redesign, new business dashboards, new UI APIs, or `/ops` migration.
- [ ] Test authenticated no-org fresh signup → declaration → invitation page; acceptance of sole org → READY; second org → unsupported; suspended/missing-profile first; wrong slug 404; no redirect loop; foreign next ignored; no-org employment/account unchanged. Run browser checks at 1440/1280 using mocked inputs by default.
- [ ] Prepare tested isolated-target harness support BEFORE independent QA: optional task env `SOL_RADAR_TEST_SUPABASE_WORKDIR` plus `SOL_RADAR_TEST_SUPABASE_API_URL` must select the exact absolute test project through CLI `--workdir`; verify returned local API origin matches the expected isolated origin before any seed/test writes and fail closed without default fallback. Installed CLI help confirms `--workdir` uses exactly the supplied directory. Cover root db-seed CLI, people-seed CLI and web auth local-status helper; default ordinary local behavior remains unchanged when test context is absent. Do not use PATH wrappers, skip scripts or shell-read credentials. Update obsolete personal/switcher-era test setup and clean owned fixture teams, preserving session/invitation/RLS/security assertions. Actual isolated live execution belongs to Task9, not a shared-stack smoke.
- [ ] Commit with hooks, e.g. `feat: 업무 멤버십으로 현재 조직 판단`.

## Existing tests and fixtures that need deliberate treatment

- `scripts/database.test.mjs`: personal-org helper assumptions around teamDb and my_org_ids; signup metadata case near line 2103 explicitly expects a personal organization; historical backfill near 1668 must remain a historical migration test. People block near 3523 inserts old scoring columns and must target the new split. Account-deletion/task-isolation tests should still test explicitly prepared historical personal data.
- `scripts/database-test-support.mjs`: `migratedDb()` inserts fresh users after full migrations; callers must stop assuming these users have personal rows. Do not silently add personal rows globally and hide the new signup contract.
- `scripts/people/seed.test.mjs`: currently asserts `departments.length === 38` and `team_members WHERE scoring_eligible`; change to 38 TEAM/legacy rows plus separately counted uppers and 27 scoring rows. Keep the original identity and 100/100 assertions.
- `web/server/organization/organization.service.test.ts`, `web/app/auth/login/page.test.ts`: personal home/missing tests must distinguish actual missing profile from valid NO_ORG. Keep getMyWorkspace's foreign-org non-disclosure tests.
- `web/e2e-auth/auth.setup.ts`, `support/account-page.ts`, `support/seed.ts`: login helpers expect random personal slug and organization switcher. Use explicit isolated test memberships for READY and explicit no-org cases; fresh signup helpers must no longer assert bootstrap.
- `web/e2e-auth/org-switcher.spec.ts`, `isolation.spec.ts`, `permissions.spec.ts`, `team-settings*.spec.ts`, `invitation.write.spec.ts`, `settings-account*.spec.ts`, `admin*.spec.ts` and account helpers contain personal/switcher assumptions. Replace obsolete UI behavior assertions with current-org isolation/account-state cases; preserve permission, foreign-row isolation, session revocation, deletion and invitation security assertions. Do not skip files or weaken the gate to retain old test counts.
- `web/e2e/protected.spec.ts`, `tasks.spec.ts`: legacy-route comments/expectations still say personal redirection. Update only route compatibility assertions; task functionality is not a new feature request.
- Current local seed creates a template team for its fixture and may preserve other real memberships. Never delete these to force a READY outcome. If that yields two business orgs, MULTIPLE_ORGS is the correct result. New auth E2E must use an isolated dataset/environment.

## Task 9: Verification and handoff

**Files:** consume the implementation's updated `web/e2e-auth/` and public/browser tests read-only; write `docs/evidence/people/20261016-adr021-people-integration.md`, `docs/11-TESTING.md`, `docs/PROGRESS.md`. Product/test harness defects return to the original implementer with scoped review; QA does not silently repair runtime code. Dedicated Supabase project files and private credentials stay outside tracked source. This task is owned by independent QA after implementation; a runtime fix returns to its original implementer and receives scoped review.

- [ ] After each bounded task, run appropriate checks and required normal gate with no bypass. At completion run `pnpm verify` including web build, `pnpm -C web test:browser`, and public E2E on an isolated web port if required by changed routing. Record commands/results against the actual final commit; old 773/293/92 totals are not targets to preserve.
- [ ] After PGlite passes, prepare a dedicated external temporary Supabase project/config with a unique project_id and every API/DB/studio/mail port distinct from the existing shared stack. Parent preflight found shared project `sol-radar` on API 54321, DB 54322, Studio 54323, mail web 54324, SMTP 54325; inspect occupancy again before selecting alternatives. Use cached images where available and only explicitly targeted temporary-project CLI commands. Do not use default `db:start`/reset, stop unrelated containers, or change the shared project's config.
- [ ] Copy the current append-only migrations to that dedicated test project, provision only its test fixtures/accounts, capture its own status without logging keys, and create a private isolated web environment pointing solely at that target. Use a unique web port and explicit test baseURL. Ensure any seed/test helper's project detection targets this test project rather than the repository's default project. Run updated authenticated signup/redirect/RLS E2E there; clean up only the owned temporary project after evidence capture. Until that exists, record auth E2E as not rerun for this delta, with PGlite/mocked coverage, and do not claim full completion under the repository gate.
- [ ] Independently review schema backfill/security and account-flow behavior; preserve original roster hashes, explicit unresolved hierarchy reasons, source privacy, and old evidence. Save new evidence in this worktree's `docs/evidence/people/` and append PROGRESS without overwriting another session's records.
- [ ] Deliver a precise completion statement: catalog/scoring/signup/resolver compatibility versus remaining slugless N1, sol_role/N2, people N4a, ops and other ADR-021 work. No shared migration/seed application, source integration, or merge is implied.
