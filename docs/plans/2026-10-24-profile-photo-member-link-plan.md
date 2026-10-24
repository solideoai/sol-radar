---
title: "프로필 사진·명부 연결 구현 계획"
status: draft
tags:
  - sol-radar
  - people
  - storage
  - implementation-plan
updated: 2026-10-24
---

# 프로필 사진·명부 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 본인·관리자가 프로필 사진을 Supabase Storage 에 올리고 바꾼다. 신규 입사자와 기존 가상 직원은 관리자 승인을 거쳐 조직도에 나온다.

**Architecture:**
- 사진은 private 버킷 `profile-photos` 에 둔다. 브라우저가 사용자 JWT 로 직접 올리고, 경로 포인터는 security definer RPC 로 저장한다. 화면은 서버가 사용자 JWT 로 만든 signed URL 로 그린다.
- 명부 연결은 `team_members.user_id` 로 한다. 가입 신청은 새 표 `member_join_requests` 와 RPC 3개로 처리한다.
- 웹에는 service role 을 쓰지 않는다.

**Tech Stack:** Next.js 16(App Router·server actions `refresh()`), React 19, Supabase(Postgres RLS·Auth·Storage), zod, Vitest, node:test + PGlite, Playwright(`web/e2e-auth`).

**Spec:** [[../../polaris/specs/in-progress/2026-10-24-profile-photo-member-link|설계]] (`polaris/specs/in-progress/2026-10-24-profile-photo-member-link.md`, 2026-10-24 사용자 승인). 실행자는 설계와 이 계획을 함께 읽는다.

## 실행 전제

- 작업 위치: worktree `sol-radar-worktrees/profile-photo`, 브랜치 `feat/profile-photo`, 기준 main `e7f12f3b`. worktree 의 `pnpm install` 에서 나는 prepare exit 1 은 무시해도 된다(의존성은 설치된다).
- 메일 작업은 main 에 들어왔다(`1fd58ff3`). `team_members.email` 은 null 을 허용하고 `(org_id, email)` 이 unique 다. 신규 입사자 행은 메일을 비워 둔다. Auth 메일을 명부에 복사하지 않는다(열 주석 "never linked to Auth"). `MemberRow.email` 은 그대로 유지한다.
- 같은 시간 작업과 경계(마스터 sol-radar-78 공지, 2026-10-24):
  - migration 번호는 `20261024000200`~`000399` 를 쓴다. N4b(sol-radar-a2, `feat/n4b-team-members-edit`)는 `20261024000400` 부터 쓴다.
  - N4b 는 새 파일, `team-members` POST·PATCH 라우트, migration 을 맡는다. `person-drawer.tsx`·`org-chart.tsx` 는 이 작업 몫이다. `web/server/people/index.ts` 배럴은 둘 다 한 줄씩 더할 수 있다.
  - 18:00 에 진행 상황과 22:00 가능 여부를 sol-radar-78 에 보낸다. 끝나면 브랜치·커밋·verify 결과를 보낸다.
- 무거운 검증(`pnpm verify`·`verify:quick`·`test:e2e*`·`next build`·`git commit`)은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 으로 감싼다.
- 작업자는 git add·commit·stash·checkout 을 하지 않는다. 커밋은 메인 세션이 한다. 아래 "Commit" 단계는 메인 세션 몫이다.
- `.env*` 파일은 어떤 도구로도 읽지 않는다. 가드에 막히면 돌아가지 말고 멈춰 보고한다.

## Global Constraints

- 웹 서버·클라이언트 번들에서 service role 금지(ADR-017·048, `web/app/_lib/deployment-role.ts`).
- 마이그레이션은 새 파일만 만든다. 번호는 `20261024000200`(Task 1), `20261024000300`(Task 5)이다.
- 버킷: 이름 `profile-photos`, `public: false`, `fileSizeLimit` 2097152(2MB), `allowedMimeTypes` `["image/jpeg","image/png","image/webp"]`.
- 객체 경로:
  - 본인: `^users/<uid>/<uuid>\.(jpg|png|webp)$`
  - 관리자: `^members/<team_member_id>/<uuid>\.(jpg|png|webp)$`
  - uuid 는 소문자 36자이고, 덮어쓰지 않는다(`upsert: false`).
- 업로드 전 처리: 입력은 jpeg·png·webp 중 하나이고 10485760(10MB) 이하여야 한다. 가운데 정사각형으로 자르고, 흰 바탕에 512×512 JPEG(quality 0.88)로 그려 `.jpg` 로 올린다.
- signed URL 만료는 3600초다. 서버에서 사용자 JWT(`getSupabase()`)로 만든다.
- 솔리데오 조직 id `db4c863c-cb6a-593d-93ff-709a17e0157a`(slug `org-01`). 신규 입사자 `person_code` 는 `SOL-N0001` 부터 시작한다(`^SOL-N\d{4}$`).
- 가입 신청 종류는 `NEW_HIRE`·`EXISTING`, 상태는 `PENDING`·`APPROVED`·`REJECTED` 이다. 승인 때 업무 역할 기본값은 `VIEWER` 다.
- 화면: 데스크톱 1280px 이상만 대상이다. 1440·1280 두 폭으로 확인한다. 색·글꼴은 `design/tokens.json` 생성물만 쓰고, 부품은 `web/components/ui/` 를 쓴다. 문구는 한국어다.
- 서버 코드는 `web/server/<도메인>/` 에 model·repo·service·index 로 두고, 파일 첫 줄은 `import "server-only";` 다. 다른 도메인은 배럴(`@/server/<도메인>`)로만 부른다.
- 시험은 MVP 핵심만 만든다(ADR-046). 삭제한 시험(`docs/evidence/verification/20261021-pruned-tests.json`)은 되살리지 않는다.
- 웹 코드를 쓰기 전에 `web/node_modules/next/dist/docs/` 의 server actions·`refresh` 문서를 확인한다.

## Review Focus

1. **잘못된 파일**: HEIC·GIF·10MB 초과·0바이트 파일을 고르면 업로드하지 않고 한국어 안내를 보인다. 아주 가로로 긴 사진은 가운데를 자른다. → Task 4 `photo-file.test.ts`.
2. **signed URL 만료**: 1시간 넘게 열어 둔 화면에서 사진을 못 불러오면 깨진 그림 대신 머리글자를 보인다. → Task 3 `person-avatar` 의 오류 대체를 https URL 에도 적용하고 unit 시험으로 고정.
3. **승인 경쟁**: 같은 가상 직원에 대한 신청 둘을 차례로 승인하면 두 번째는 500 이 아니라 "이미 다른 계정과 연결됨"이 된다. → Task 5 DB 시험, Task 6 서비스 결과 `member-taken`.
4. **한글 3자가 아닌 이름**: 표시 이름이 "Lee Gwanghui"·두 글자·이미 있는 이름인 신규 입사자도 승인되어 조직도에 나온다. → Task 5 DB 시험.
5. **역할이 바뀐 관리자**: 화면을 연 뒤 ADMIN 이 아니게 된 사람이 사진 변경·승인을 누르면 앱이 죽지 않고 "권한이 없습니다" 안내가 보인다. → Task 6·7 서비스 결과 `forbidden` 시험.

---

### Task 1: 사진 저장 DB 와 Storage 정책

**Files:**
- Create: `supabase/migrations/20261024000200_profile_photos.sql`
- Modify: `scripts/db-verify.mjs` (`ALLOWED_DEFINER_FUNCTIONS`)
- Modify: `web/lib/database.types.ts` (생성물, `pnpm db:types`)
- Test: `scripts/database.test.mjs` (새 `describe("프로필 사진 — 경로·권한")`, 기존 "솔리데오 카탈로그·명부·점수 정책" 의 `setup` 패턴 재사용)

**Interfaces:**
- Produces (DB):
  - `profiles.photo_path text null`. check: `photo_path is null or photo_path ~ ('^users/' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')`.
  - `team_members.user_id uuid null unique references public.profiles(id) on delete set null`.
  - `team_members.photo_path text null`. check: `photo_path is null or photo_path ~ '^(users|members)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'`.
  - 비데모 행 허용: `team_members` 의 이름 한글 3자 check·`unique(org_id,name)`·`gender`/`portrait_path` NOT NULL 을 `is_demo=true` 행에만 걸도록 바꾼다.
    - 기존 제약 이름은 `select conname from pg_constraint where conrelid='public.team_members'::regclass` 로 확인한다.
    - 새로 걸 것: `check (not is_demo or name ~ '^[가-힣]{3}$')`, `check (is_demo or char_length(btrim(name)) between 1 and 40)`, `check (not is_demo or (gender is not null and portrait_path is not null))`, `create unique index team_members_demo_name_key on public.team_members(org_id, name) where is_demo`.
    - seed upsert 는 `on_conflict=id` 라 영향이 없다.
  - `public.set_my_photo(p_path text) returns void`
    - security definer, `set search_path=''`, authenticated 만 실행한다.
    - 활동 계정이 아니면 raise `hint='not_active'`. `p_path` 가 null 이 아니고 `users/<auth.uid()>/…` 패턴이 아니면 `hint='invalid_photo_path'`.
    - 본인이 연결된 `team_members` 행이 있으면 그 행의 `photo_path` 를 바꾸고, 없으면 `profiles.photo_path` 를 바꾼다.
  - `public.set_member_photo(p_member uuid, p_path text) returns void`
    - 호출자가 그 직원 조직의 ADMIN(`my_sol_org_ids(array['ADMIN'])`)이 아니면 `hint='forbidden'`.
    - `p_path` 는 null 이거나 `members/<p_member>/…` 여야 한다.
    - `team_members.photo_path` 만 바꾼다.
  - storage.objects 정책 (`bucket_id='profile-photos'`, `split_part` 사용. PGlite 에 `storage.foldername` 이 없다)
    - `profile_photos_insert` (insert, authenticated): `(select public.is_active_user())` 이고, 다음 둘 중 하나다.
      - 이름이 본인 경로 패턴이다.
      - `members/` 이고, 2번째 조각이 내가 ADMIN 인 조직의 `team_members.id` 다.
    - `profile_photos_read` (select, authenticated): 활동 계정이고, 다음 둘 중 하나다.
      - 본인 경로다(`profiles.photo_path` 는 check 로 본인 경로만 담으므로 따로 갈래를 두지 않는다).
      - `exists(team_members m where m.photo_path = name and m.org_id in (select my_org_ids()))`.
  - 실행 권한: 두 함수 모두 `revoke execute … from public, anon` 뒤 `grant … to authenticated`.
- Produces (db-verify): `"public.set_my_photo(text)"`, `"public.set_member_photo(uuid, text)"` 을 허용 목록에 더하고, 이유를 주석 한 줄로 단다.

- [ ] **Step 1: Write the failing tests** — `scripts/database.test.mjs` 에 아래를 추가한다.
  - `it("본인은 users/<내 id>/ 에만 사진을 올리고, members/ 는 그 조직 ADMIN 만 올린다")`
    - 준비: users[0] ADMIN(org-01), users[1] VIEWER(org-01), users[2] 비멤버.
    - users[1] 이 `users/<users[1]>/<uuid>.jpg` insert → 성공. `users/<users[0]>/…` insert → `/row-level security/`. `members/<member>/…` insert → 거부.
    - users[0] 이 `members/<member>/<uuid>.jpg` insert → 성공. anon insert → `/permission denied|row-level security/`.
  - `it("같은 조직은 명부에 연결된 사진을 읽고 다른 조직·비멤버는 0행이다")`
    - `team_members.photo_path` 에 넣은 객체를 users[1] 이 select 하면 1행, users[2] 는 0행.
  - `it("set_my_photo 는 내 경로만 받고 연결된 직원 행을 바꾸며 set_member_photo 는 ADMIN 만 한다")`
    - 남의 경로 → `invalid_photo_path`.
    - 연결 전에는 `profiles.photo_path` 가 바뀐다. `update team_members set user_id` 로 연결한 뒤에는 `team_members.photo_path` 가 바뀌고 `profiles.photo_path` 는 그대로다.
    - VIEWER 가 `set_member_photo` 를 부르면 `forbidden`.
  - `it("비데모 직원은 한글 3자가 아니어도·같은 이름이어도·성별과 정장 사진 없이 들어가고 데모 직원 제약은 그대로다")`
    - `is_demo=false`, name `'Lee Gwanghui'`, gender null, portrait null → 성공. 같은 이름 비데모 두 번째 → 성공.
    - `is_demo=true`, name `'Lee'` → `/check constraint/`. 같은 이름 데모 둘 → `/duplicate key/`.
- [ ] **Step 2: 실패 확인** — Run: `pnpm test:db`. Expected: 새 it 4개가 FAIL 한다(열·함수 없음). 기존 시험은 PASS.
- [ ] **Step 3: 마이그레이션 작성** — 위 Interfaces 그대로 쓴다. 정책 안의 `auth.uid()`·`is_active_user()` 는 `(select …)` 로 감싼다(`slowPolicies` 규칙). 맨 위 주석에 설계 문서 경로와 "버킷은 SQL 이 아니라 scripts/ops 가 만든다"를 적는다.
- [ ] **Step 4: 허용 목록·타입** — `scripts/db-verify.mjs` 에 두 서명을 더한다. 이어서 `pnpm db:types` 를 실행한다.
- [ ] **Step 5: 통과 확인** — Run: `pnpm test:db && pnpm check:db-types`. Expected: 전부 PASS, 타입 일치.
- [ ] **Step 6: Commit** — `git add supabase/migrations/20261024000200_profile_photos.sql scripts/db-verify.mjs scripts/database.test.mjs web/lib/database.types.ts` → `feat(db): 프로필 사진 경로와 Storage 정책`

### Task 2: 사진 버킷 준비 스크립트

**Files:**
- Modify: `scripts/ops/ensure-storage-buckets.mjs`
- Create: `scripts/storage-local-buckets.mjs`
- Modify: `package.json` (scripts 에 `"storage:local": "node scripts/storage-local-buckets.mjs"` 추가. 기존 스크립트는 바꾸지 않는다)
- Test: `scripts/storage.test.mjs`

**Interfaces:**
- Produces:
  - `export async function ensureProfilePhotoBucket(client, { apply = false, bucket = "profile-photos" } = {}): Promise<{ name: string; status: "ready" | "missing" | "created" }>`
    - 이미 있는 버킷이 public 이면 `storage_bucket_public` 를 던진다. 크기·MIME 이 다르면 `storage_bucket_limits_mismatch` 를 던진다.
    - sentinel 파일은 만들지 않는다. 이미지 MIME 만 허용하는 버킷이라 JSON 을 올릴 수 없기 때문이다.
  - `run()` 은 기존 두 버킷 다음에 이 함수도 부른다. `--apply` 가 없으면 상태만 출력한다.
  - `scripts/storage-local-buckets.mjs`: `supabase status --output env` 의 `API_URL`·`SERVICE_ROLE_KEY` 를 읽는다(`storage-local-smoke.mjs` 와 같은 방식). 호스트가 localhost·127.0.0.1 이 아니면 멈춘다. 세 버킷을 `apply: true` 로 준비한다.

- [ ] **Step 1: Write the failing test** — `test("photo bucket is private, 2MB, image-only and refuses public or mismatched buckets")`
  - 가짜 storage 로 다음을 확인한다.
    - dry-run → `{name:"profile-photos",status:"missing"}`.
    - apply → `createBucket("profile-photos", {public:false, fileSizeLimit:2097152, allowedMimeTypes:["image/jpeg","image/png","image/webp"]})`.
    - 기존 public 버킷 → reject `/storage_bucket_public/`. 기존 limit 50MB → reject `/storage_bucket_limits_mismatch/`.
- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/storage.test.mjs`. Expected: FAIL (`ensureProfilePhotoBucket` 없음).
- [ ] **Step 3: 구현** — 위 Interfaces 대로 만든다. 기존 `ensureStorageBuckets` 의 동작과 시험은 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** — Run: `node --test scripts/storage.test.mjs`. Expected: PASS.
- [ ] **Step 5: 로컬 버킷 준비** — 로컬 Supabase 가 켜져 있을 때 `pnpm storage:local` 을 실행한다. Expected: `profile-photos` 가 `created` 또는 `ready` 로 출력된다.
- [ ] **Step 6: Commit** — `git add scripts/ops/ensure-storage-buckets.mjs scripts/storage-local-buckets.mjs scripts/storage.test.mjs package.json` → `feat(ops): 프로필 사진 버킷 준비`

### Task 3: 사진 서버 도메인과 표시 우선순위

**Files:**
- Create: `web/server/shared/profile-photo.ts` (barrel `web/server/shared/index.ts` 에 export 추가. 브라우저에서도 쓴다)
- Create: `web/server/photos/photo.model.ts`, `photo.repo.ts`, `photo.service.ts`, `index.ts`
- Modify: `web/server/people/people.model.ts`, `people.repo.ts`, `people.service.ts`, `index.ts`
- Modify: `web/server/profile/profile.model.ts`, `profile.repo.ts`, `profile.service.ts`
- Modify: `web/server/csp/csp.model.ts` (`img-src` 에 `supabaseOrigin` 추가)
- Modify: `web/lib/demo-portrait.ts`, `web/components/people/person-avatar.tsx`
- Test: `web/server/photos/photo.model.test.ts`, `web/server/photos/photo.service.test.ts`, `web/server/people/people.photo.test.ts`, `web/lib/demo-portrait.test.ts`

**Interfaces:**
- Consumes: Task 1 의 열과 RPC.
- Produces:
  - `web/server/shared/profile-photo.ts`:
    - 상수: `PHOTO_BUCKET = "profile-photos"`, `PHOTO_MAX_BYTES = 2_097_152`, `PHOTO_INPUT_MAX_BYTES = 10_485_760`, `PHOTO_INPUT_TYPES = ["image/jpeg","image/png","image/webp"] as const`, `PHOTO_SIZE_PX = 512`.
    - `isOwnPhotoPath(path: string, userId: string): boolean`
    - `isMemberPhotoPath(path: string, memberId: string): boolean`
  - `web/server/photos` (배럴):
    - `signPhotoPaths(paths: readonly string[]): Promise<Map<string, string>>` — 빈 배열이면 호출하지 않는다. `createSignedUrls(paths, 3600)` 한 번으로 만들고, 실패한 경로는 Map 에서 뺀다.
    - `saveMyPhoto(pathInput: unknown): Promise<PhotoSaveResult>`
    - `saveMemberPhoto(memberIdInput: unknown, pathInput: unknown): Promise<PhotoSaveResult>`
    - `type PhotoSaveResult = { status: "saved" } | { status: "signed-out" } | { status: "invalid" } | { status: "forbidden" }`. RPC hint 는 `not_active`→signed-out, `invalid_photo_path`→invalid, `forbidden`→forbidden 으로 바꾼다.
    - 서비스는 RPC 전에 입력을 먼저 검사한다. 본인 경로는 `isOwnPhotoPath`, 직원 경로는 uuid 와 `isMemberPhotoPath` 로 본다. 틀리면 repo 를 부르지 않고 `invalid` 를 돌려준다. `null` 은 "사진 지우기"로 받는다.
    - 바꾸거나 지운 옛 객체는 Storage 에서 지우지 않는다(계획 판단, 아래 Self-Review 메모).
  - people:
    - `MemberRow` 에 `user_id: string | null; photo_path: string | null; linked_avatar_url: string | null` 를 더한다.
    - repo 는 `profile:profiles!team_members_user_id_fkey(avatar_url)` embed 를 펴서 `linked_avatar_url` 을 채운다.
    - `toTeamMemberListItem(row, scoringEligible, photoUrls: ReadonlyMap<string, string>)`.
    - `resolveMemberPortrait(row: MemberRow, photoUrls: ReadonlyMap<string,string>): string | null` 의 순서:
      1. `photoUrls.get(row.photo_path)`
      2. `is_demo` 이고 기존 정장 사진 규칙에 맞는 `portrait_path`
      3. `https://` 로 시작하는 `linked_avatar_url`
      4. `null`
    - `memberSchema.isDemo` 를 `z.boolean()` 으로 바꾼다.
    - `PeopleDirectory` 에 `canManagePhotos: boolean` 을 더한다. `currentPeopleOrganization` 이 `solRole === "ADMIN"` 을 함께 돌려준다.
    - `PeopleRepo` 에 `signPhotos(paths: readonly string[]): Promise<Map<string,string>>` 를 더한다. 기본은 `@/server/photos` 의 `signPhotoPaths` 다.
    - 단건 상세(`getTeamMember`)도 같은 방식으로 서명한다.
  - profile:
    - `ProfileRow` 에 `id`, `photo_path`, `linked_member: { photo_path: string | null; person_code: string; portrait_path: string | null; is_demo: boolean } | null` 을 더한다. `linked_member` 는 `team_members!team_members_user_id_fkey` 일대일 embed 다.
    - `ProfileView` 에 `userId: string`, `hasOwnPhoto: boolean`, `orgChartLinked: boolean` 을 더한다.
    - `avatarUrl` 의 의미는 "화면에 그릴 주소"로 바꾼다. 순서:
      1. 실효 경로(`linked_member?.photo_path ?? photo_path`)의 signed URL
      2. 연결된 데모 직원의 정장 사진
      3. 제공자 `avatar_url`
      4. `null`
    - `ProfileRepo` 에 `signPhoto(path: string): Promise<string | null>` 을 더한다.
  - `demo-portrait.ts` 에 `isDisplayablePortrait(url: string, personId: string | null | undefined): boolean` 을 더한다. 정장 경로이면 `demoPortraitPath(personId)` 와 같아야 하고, 그 밖에는 `https://`·`http://localhost`·`http://127.0.0.1` 절대 URL 만 참이다. `PersonAvatar` 는 이 함수를 쓴다. 불러오기 실패 때 머리글자로 바꾸는 동작은 그대로 둔다.

- [ ] **Step 1: Write the failing tests**
  - `photo.model.test.ts`
    - `isOwnPhotoPath("users/<u>/<uuid>.jpg","<u>")` 는 true.
    - 다른 uid·`../`·대문자 UUID·`.gif` 는 false.
    - `isMemberPhotoPath` 도 같은 방식으로 확인한다.
  - `people.photo.test.ts`
    - `resolveMemberPortrait` 4순위를 표 시험으로 확인한다: 서명 있음 / 데모 기본 / 비데모 제공자 사진 / 모두 없음.
    - `buildPeopleDirectory` 가 `is_demo=false` 행(`SOL-N0001`)을 parse 하고 `summary.totalCount` 에 넣는지 확인한다.
  - `demo-portrait.test.ts`(Review Focus 2): `isDisplayablePortrait("https://x.supabase.co/storage/v1/object/sign/…","SOL-N0001")===true`, `isDisplayablePortrait("/demo/people/SOL-P0002.png","SOL-P0001")===false`, `isDisplayablePortrait("javascript:alert(1)","SOL-P0001")===false`.
  - `photo.service.test.ts`(가짜 repo 주입, Review Focus 5)
    - `saveMemberPhoto("not-a-uuid", null)` → `invalid`. repo 호출 0회.
    - `saveMemberPhoto(<id A>, "members/<id B>/<uuid>.jpg")` → `invalid`. repo 호출 0회.
    - repo 가 hint `forbidden` 오류를 내면 → `forbidden`.
    - `saveMyPhoto("users/<남의 id>/<uuid>.jpg")` → `invalid`.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/photos server/people/people.photo.test.ts lib/demo-portrait.test.ts`. Expected: FAIL (모듈·함수 없음).
- [ ] **Step 3: 구현** — 위 Interfaces 대로 만든다. CSP 는 `["img-src","'self'","blob:","data:",...AVATAR_ORIGINS, ...(supabaseOrigin ? [supabaseOrigin] : [])]` 로 바꾼다.
- [ ] **Step 4: 통과 확인** — Run: 같은 vitest 명령과 `pnpm verify:changed`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): 프로필 사진 서명과 표시 우선순위`

### Task 4: 사진 고르기 부품과 본인 설정

**Files:**
- Create: `web/components/photo/photo-file.ts`, `web/components/photo/photo-file.test.ts`, `web/components/photo/photo-picker.tsx`
- Modify: `web/app/account/account-settings.tsx` (프로필 칸), `web/app/account/actions.ts`

**Interfaces:**
- Consumes: `PHOTO_*`(`@/server/shared`), `saveMyPhoto`·`PhotoSaveResult`(`@/server/photos`), `ProfileView.userId/hasOwnPhoto/avatarUrl`.
- Produces:
  - `checkPhotoFile(file: { type: string; size: number }): string | null` — 문제가 있으면 한국어 메시지, 없으면 null.
    - 형식 밖: "JPG·PNG·WEBP 사진만 올릴 수 있습니다"
    - 0바이트: "빈 파일입니다"
    - 10MB 초과: "10MB 이하 사진을 골라 주세요"
  - `centerSquare(width: number, height: number): { sx: number; sy: number; size: number }`
  - `newPhotoPath(prefix: string, id: string): string` → `${prefix}/${id}.jpg`
  - `<PhotoPicker objectPrefix: string; hasPhoto: boolean; save: (path: string | null) => Promise<PhotoSaveResult>; />` ("use client")
    - 순서: 파일 검사 → `createImageBitmap` → 512 canvas(흰 바탕) → `toBlob("image/jpeg", 0.88)` → `getSupabaseBrowser().storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false })` → `save(path)`.
    - 버튼: 사진이 없으면 "사진 올리기", 있으면 "사진 바꾸기"와 "사진 지우기"(`save(null)`).
    - 결과는 sonner toast 로 알린다. 업로드 중에는 버튼을 막는다.
  - `saveMyPhotoAction(path: unknown): Promise<PhotoSaveResult>` (`web/app/account/actions.ts`). `saved` 면 `refresh()` 한다.
  - AccountSettings 프로필 칸의 "여기서 바꿀 수 없습니다" 문구를 없앤다. 아바타 옆에 `PhotoPicker objectPrefix={`users/${profile.userId}`}` 를 둔다. 사이드바는 `ProfileView.avatarUrl` 을 그대로 쓰므로 바꾸지 않는다.

- [ ] **Step 1: Write the failing test** — `photo-file.test.ts`(Review Focus 1)
  - `checkPhotoFile({type:"image/heic",size:1})` → 형식 메시지.
  - `{type:"image/png",size:0}` → "빈 파일입니다".
  - `{type:"image/jpeg",size:10_485_761}` → 크기 메시지.
  - `{type:"image/webp",size:1000}` → null.
  - `centerSquare(4000,1000)` → `{sx:1500,sy:0,size:1000}`. `centerSquare(800,1200)` → `{sx:0,sy:200,size:800}`.
  - `newPhotoPath("users/u","i")` → `"users/u/i.jpg"`.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run components/photo/photo-file.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로 만든다. 새 패키지는 설치하지 않는다.
- [ ] **Step 4: 통과·화면 확인**
  - Run: vitest 와 `pnpm verify:changed`. Expected: PASS.
  - 로컬 `pnpm -C web dev` 에서 `/<slug>/settings` 에 들어가 사진을 올리고 지운다. 사이드바 아바타가 바뀌는지 1440·1280 두 폭에서 본다. 콘솔에 CSP 위반이 0건이어야 한다.
- [ ] **Step 5: Commit** — `feat(web): 설정에서 내 프로필 사진 올리기`

### Task 5: 가입 신청 DB

**Files:**
- Create: `supabase/migrations/20261024000300_member_join_requests.sql`
- Modify: `scripts/db-verify.mjs`, `web/lib/database.types.ts`, `scripts/database.test.mjs`
- Modify: `scripts/demo-reset.mjs`

**Interfaces:**
- Consumes: Task 1(`team_members.user_id/photo_path`, 비데모 허용 제약, `profile_photos_read`).
- Produces (DB):
  - 표 `public.member_join_requests`:
    - `id uuid pk default gen_random_uuid()`
    - `org_id uuid not null → organizations on delete cascade`
    - `user_id uuid not null → profiles on delete cascade`
    - `kind text check in ('NEW_HIRE','EXISTING')`
    - `team_member_id uuid null → team_members on delete cascade`
    - `check ((kind='EXISTING') = (team_member_id is not null))`
    - `status text not null default 'PENDING' check in ('PENDING','APPROVED','REJECTED')`
    - `sol_role text null` (`memberships.sol_role` 과 같은 네 값 check)
    - 신청자 사본: `applicant_name text not null`, `applicant_email text not null`, `applicant_photo_path text null`, `department_id uuid not null`, `job_title_id uuid not null`. 부서·직급은 같은 조직 카탈로그를 가리키는 복합 FK 다(team_members 와 같은 방식).
      - 사본을 두는 이유: 대기 신청자는 아직 조직 멤버가 아니다. profiles RLS("같은 조직 멤버 프로필 읽기", `20261014000001`)로는 관리자가 신청자 프로필을 읽지 못한다.
      - submit 이 profiles 에서 값을 복사한다. 승인 때는 사본이 아니라 그 시점의 profiles 값을 쓴다.
    - `decided_by uuid null → profiles on delete set null`, `decided_at timestamptz`
    - `created_at`·`updated_at`(touch 트리거)
    - `unique index (org_id, user_id) where status='PENDING'`
  - 잠금과 정책: RLS 를 켠다. `revoke all` 뒤 `grant select to authenticated`. 정책 둘: 본인 행(`user_id=(select auth.uid())`), 그 조직 ADMIN(`org_id in (select my_sol_org_ids(array['ADMIN']))`). 쓰기 권한은 없다.
  - `public.find_unlinked_member(p_department text, p_name text) returns table(id uuid, person_code text, name text, job_title_label text)`
    - 활동 계정만 부를 수 있다.
    - org-01, `is_demo`, `user_id is null`, 부서 code = `p_department`, `name = btrim(p_name)` 이 정확히 맞는 행을 최대 1개 돌려준다.
  - `public.submit_join_request(p_kind text, p_team_member uuid default null, p_name text default null) returns uuid`
    - 이름·부서·직급 신고가 없으면 `hint='profile_incomplete'`.
    - 이미 연결된 계정이면 `hint='already_linked'`.
    - EXISTING 은 대상이 org-01·`is_demo`·미연결·`name = btrim(p_name)` 이어야 한다. 아니면 `hint='invalid_member'`.
    - 대기 중인 내 신청이 있으면 그 행을 새 값으로 고친다. 없으면 새로 만든다. 신청 id 를 돌려준다.
  - `public.decide_join_request(p_request uuid, p_approve boolean, p_sol_role text default 'VIEWER') returns text`
    - 신청 행을 `for update` 로 잠근다. 호출자가 그 조직 ADMIN 이 아니면 `hint='forbidden'`. PENDING 이 아니면 `hint='request_not_pending'`.
    - 거절: `REJECTED` 로 바꾸고 `decided_*` 를 채운다.
    - 승인:
      1. 멤버십이 없으면 `memberships(org_id,user_id,org_role='member',sol_role=p_sol_role)` 를 넣는다. 이미 멤버면 멤버십은 그대로 둔다.
      2. NEW_HIRE 는 `pg_advisory_xact_lock(hashtext('sol_new_hire_code'))` 뒤 다음 `SOL-N####` 로 `team_members` 를 넣는다. 값: `is_demo=false`, `name=profiles.display_name`, 신고 부서·직급, `user_id`, `photo_path=profiles.photo_path`.
      3. EXISTING 은 `update team_members set user_id=…, photo_path=coalesce(photo_path, profile.photo_path) where id=… and user_id is null`. 0행이면 `hint='member_taken'`. 성공하면 `profiles.declared_*` 를 그 직원의 부서·직급으로 맞춘다.
      4. `APPROVED`·`sol_role`·`decided_*` 를 채우고 `'APPROVED'`|`'REJECTED'` 를 돌려준다.
    - 감사: 신청 행(`decided_by`·`decided_at`·`status`)이 기록이다. audit_logs action 은 늘리지 않는다(계획 판단).
  - `profile_photos_read` 를 drop·create 해서 갈래를 하나 더한다: `exists(member_join_requests r where r.applicant_photo_path = name and r.status = 'PENDING' and r.org_id in (select my_sol_org_ids(array['ADMIN'])))`.
  - `set_my_photo` 를 `create or replace` 로 고쳐 문장 하나를 더한다: 내 PENDING 신청의 `applicant_photo_path` 도 같은 값으로 바꾼다. 신청 뒤에 사진을 바꿔도 관리자 화면이 따라간다.
  - db-verify 허용 목록: `"public.find_unlinked_member(text, text)"`, `"public.submit_join_request(text, uuid, text)"`, `"public.decide_join_request(uuid, boolean, text)"`.
- Produces (reset): `scripts/demo-reset.mjs` 를 다음과 같이 고친다.
  - `ORG_SCOPED_TABLES` 에 `member_join_requests` 를 더한다(team_members 보다 먼저 지운다).
  - `seedPeople` 뒤에 `client.update("team_members", { org_id: <org-01> }, { user_id: null, photo_path: null })` 를 부른다.
  - 데모 계정 `profiles.photo_path` 를 null 로 만든다.
  - 마지막 요약 줄은 그대로 `people=200` 이다.

- [ ] **Step 1: Write the failing tests** — `describe("가입 신청과 명부 연결")`
  - `it("비멤버 신규 입사자 신청을 ADMIN 이 승인하면 VIEWER 멤버십과 SOL-N0001 비데모 직원이 생긴다")`
    - 이름 `'Lee Gwanghui'` 로 Review Focus 4 를 확인한다.
    - 같은 이름의 두 번째 신규 입사자 → `SOL-N0002`.
  - `it("VIEWER·다른 조직 ADMIN 은 결정하지 못하고 이미 결정된 신청은 다시 결정하지 못한다")`
    - `forbidden` 과 `request_not_pending` 을 확인한다.
  - `it("같은 가상 직원에 대한 신청 둘은 먼저 승인된 것만 연결되고 두 번째는 member_taken 이다")` (Review Focus 3)
  - `it("find_unlinked_member 는 부서·이름이 정확히 맞는 미연결 데모 직원 하나만 주고 anon 은 거부한다")`
  - `it("ADMIN 은 대기 신청자의 사진을 읽고 다른 사람은 읽지 못한다")`
  - `it("이미 멤버인 계정의 신청 승인은 멤버십·업무 역할을 바꾸지 않고 연결만 한다")` (U10)
- [ ] **Step 2: 실패 확인** — Run: `pnpm test:db`. Expected: 새 it 6개 FAIL.
- [ ] **Step 3: 구현** — 마이그레이션·허용 목록·`pnpm db:types`·demo-reset 수정.
- [ ] **Step 4: 통과 확인** — Run: `pnpm test:db && pnpm check:db-types && pnpm verify:changed`. Expected: PASS. 로컬 `pnpm demo:reset` 을 2회 돌린다. 마지막 줄이 2회 모두 같고 `people=200` 이어야 한다.
- [ ] **Step 5: Commit** — `feat(db): 가입 신청과 명부 연결`

### Task 6: 가입 신청 화면(신규 입사자)과 관리자 승인 표

**Files:**
- Create: `web/server/join-request/join-request.model.ts`, `join-request.repo.ts`, `join-request.service.ts`, `index.ts`, `join-request.service.test.ts`
- Create: `web/app/auth/organization-state/join-request-panel.tsx`, `web/app/auth/organization-state/actions.ts`
- Modify: `web/app/auth/organization-state/page.tsx`
- Create: `web/app/(app)/(work)/settings/organization/org-join-request-table.tsx`
- Modify: `web/app/(app)/(work)/settings/organization/page.tsx`, `actions.ts`

**Interfaces:**
- Consumes: Task 5 RPC, `PhotoPicker`·`saveMyPhotoAction`(Task 4), `signPhotoPaths`(Task 3), `getMyBusinessAccess`(`@/server/organization`).
- Produces (`@/server/join-request`):
  - `getMyJoinRequest(): Promise<MyJoinRequest>`. 결과 모양:
    - `{ status: "signed-out" }`
    - `{ status: "none" }`
    - `{ status: "pending" | "rejected" | "approved"; kind: JoinKind; memberName: string | null }`
  - `submitMyJoinRequest(input: unknown): Promise<SubmitJoinResult>`. 입력은 `{ kind: "NEW_HIRE" } | { kind: "EXISTING"; teamMemberId: string; name: string }`. 결과 status: `submitted` | `already-linked` | `invalid-member` | `profile-incomplete` | `invalid` | `signed-out`.
  - `findUnlinkedMember(input: unknown): Promise<FindMemberResult>`. 입력은 `{ departmentId: string /* SOL-D### */; name: string }`. 결과 status: `found`(`member: { id, personCode, name, jobTitleLabel }`) | `not-found` | `invalid` | `signed-out`.
  - `listPendingJoinRequests(orgId: string): Promise<JoinRequestView[]>`
    - `JoinRequestView` 필드: `{ id, kind, applicantName, applicantEmail, departmentName, jobTitleLabel, memberName, memberPersonCode, photoUrl, createdAt }`.
    - 신청자 이름·이메일·사진은 신청 행 사본(`applicant_*`)에서 읽는다. profiles embed 는 쓰지 않는다(Task 5 이유).
    - 부서·직급 이름은 조직 카탈로그 embed 로 읽는다.
    - 신청자 사진은 `signPhotoPaths` 로 서명한다.
  - `decideOrgJoinRequest(input: unknown): Promise<DecideJoinResult>`
    - 입력: `{ requestId: uuid; approve: boolean; solRole?: SolRole }`. 서비스는 먼저 ADMIN 인지 확인한다(`org-settings.service.ts` 의 `requireOrgAdmin` 패턴).
    - 결과 status: `approved` | `rejected` | `member-taken` | `already-decided` | `forbidden` | `invalid` | `signed-out`.
- Produces (화면):
  - `/auth/organization-state` 에서 `noOrg` 일 때 제목과 내용:
    - 신청 없음: "가입 신청". 안내는 "관리자가 승인하면 조직도와 업무 화면이 열립니다".
    - pending: "관리자 승인 대기 중"
    - rejected: "가입 신청이 반려되었습니다". 다시 신청할 수 있다.
    - 어느 상태든 `JoinRequestPanel` 을 그린다. 패널: 사진 칸(`PhotoPicker`, `users/<uid>`), 종류 선택(라디오 "신규 입사자"·"기존 직원"), "가입 신청" 버튼. "기존 직원" 은 Task 9 전까지 숨긴다.
    - "받은 초대 보기" 링크는 그대로 둔다.
  - `OrgJoinRequestTable`: 대기 신청 목록이다.
    - 열: 사진·이름·이메일·종류·부서/직급·연결 대상.
    - 각 행에 업무 역할 선택(기본 VIEWER)과 "승인"·"거절" 버튼이 있다.
    - 결과마다 toast 로 알린다: forbidden "권한이 없습니다", member-taken "이미 다른 계정과 연결된 직원입니다", already-decided "이미 처리된 신청입니다".
  - actions: `submitJoin(input)`, `findMember(input)`(organization-state), `decideJoin(input)`(settings/organization). 성공하면 `refresh()` 한다.

- [ ] **Step 1: Write the failing test** — `join-request.service.test.ts`(가짜 repo·access 주입)
  - `decideOrgJoinRequest` 가 ADMIN 이 아닌 access 에서 repo 를 부르지 않고 `forbidden` 을 낸다(Review Focus 5).
  - repo 가 `member_taken` hint 를 내면 `member-taken` 이 된다.
  - `request_not_pending` hint 는 `already-decided` 가 된다.
  - 잘못된 uuid 는 `invalid` 가 된다.
  - `submitMyJoinRequest({kind:"EXISTING"})` 처럼 `teamMemberId` 가 없으면 `invalid` 가 된다.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/join-request`. Expected: FAIL.
- [ ] **Step 3: 구현** — 도메인, 화면, 액션을 만든다. 승인 표는 `/settings/organization` 의 구성원 표 위에 둔다.
- [ ] **Step 4: 통과·화면 확인**
  - Run: vitest 와 `pnpm verify:changed`. Expected: PASS.
  - 로컬에서 새 계정으로 complete-profile → 가입 신청 → admin 계정으로 승인 → 신청자 `/org-chart` 에 새 사람과 사진이 보이는지 1440·1280 에서 본다.
- [ ] **Step 5: Commit** — `feat(web): 가입 신청과 관리자 승인`

### Task 7: 관리자 조직도 사진 변경

**Files:**
- Modify: `web/components/people/person-drawer.tsx`, `web/components/people/org-chart-directory.tsx`
- Create: `web/app/(app)/org-chart/actions.ts`

**Interfaces:**
- Consumes: `PeopleDirectory.canManagePhotos`, `TeamMemberListItem.isDemo`(Task 3), `PhotoPicker`(Task 4), `saveMemberPhoto`(Task 3).
- Produces:
  - `saveMemberPhotoAction(memberId: unknown, path: unknown): Promise<PhotoSaveResult>`. 먼저 `requireCompleteEmployment("/org-chart")` 를 부르고, `saved` 면 `refresh()` 한다.
  - `PersonDrawer` 에 prop `canManagePhotos: boolean` 을 더한다. 참이면 헤더 아바타 아래에 `PhotoPicker objectPrefix={`members/${person.id}`}` 를 둔다.
  - 헤더 꼬리표: `isDemo` 면 "DEMO · 가상 인물", 아니면 "신규 입사자".

- [ ] **Step 1: 구현** — 위 Interfaces 대로 만든다. 서버 규칙 시험은 Task 3 `photo.service.test.ts` 가 이미 덮는다. 화면 흐름은 Task 10 E2E 가 덮는다.
- [ ] **Step 2: 화면 확인**
  - admin 계정으로 `/org-chart` 에서 가상 직원 한 명의 사진을 바꾼다. 다른 계정(VIEWER)에서도 바뀐 사진이 보여야 한다.
  - VIEWER 의 드로어에는 버튼이 없어야 한다. 1440·1280 두 폭에서 본다. Run: `pnpm verify:changed`. Expected: PASS.
- [ ] **Step 3: Commit** — `feat(web): 관리자가 조직도에서 사진 변경`

### Task 8: 이미 조직에 있는 계정의 조직도 신청 (U10)

**Files:**
- Modify: `web/app/account/account-settings.tsx`, `web/app/(app)/[slug]/settings/page.tsx`

**Interfaces:**
- Consumes: `getMyJoinRequest`, `JoinRequestPanel`(Task 6), `ProfileView.orgChartLinked`(Task 3).
- Produces: `AccountSettings` 에 prop `orgChart?: { linked: boolean; request: MyJoinRequest }` 를 더한다.
  - 연결 안 됨: 프로필 칸 아래에 "조직도에 나를 추가·연결" 소제목과 `JoinRequestPanel` 을 둔다. 사진 칸은 이미 위에 있으므로 패널의 사진 칸은 숨긴다.
  - 연결됨: "조직도에 연결됨"만 보인다.
  - `/auth/account`(조직 없음) 화면에는 넘기지 않는다.

- [ ] **Step 1: 구현** — 새 로직이 없는 화면 연결이라 시험은 Task 10 E2E 가 덮는다.
- [ ] **Step 2: 확인** — Run: `pnpm verify:changed`. admin 계정으로 설정 → 신규 입사자 신청 → `/settings/organization` 에서 자기 신청 승인 → `/org-chart` 에 본인이 나오는지 본다.
- [ ] **Step 3: Commit** — `feat(web): 기존 계정의 조직도 신청`

### Task 9: 기존 직원 연결 화면 (시간이 모자라면 이 Task 를 뺀다, U8)

**Files:**
- Modify: `web/app/auth/organization-state/join-request-panel.tsx`

**Interfaces:**
- Consumes: `findMember`·`submitJoin` 액션(Task 6), `getSignupOptions().departments`, `demoPortraitPath`.
- Produces: "기존 직원" 라디오를 연다.
  - 흐름: 부서 선택 + 이름 입력 → "찾기" → 찾으면 카드 하나(정장 사진·이름·직급)와 "본인 맞음, 연결 신청" 버튼을 보인다. 못 찾으면 "이 부서에 연결할 수 있는 같은 이름의 직원이 없습니다" 를 보인다.
  - 신청 결과 `invalid-member` → "이미 연결됐거나 이름이 맞지 않습니다".

- [ ] **Step 1: 구현과 확인** — 로컬에서 새 계정으로 부서 `SOL-D…` 와 가상 직원 이름을 넣고 신청한 뒤 admin 이 승인한다. 그 직원 자리 사진이 신청자의 사진으로 바뀌는지 본다. Run: `pnpm verify:changed`.
- [ ] **Step 2: Commit** — `feat(web): 기존 직원 명부 연결 신청`

### Task 10: 시연 E2E·문서·통합 검증

**Files:**
- Create: `web/e2e-auth/profile-photo.write.spec.ts`
- Modify: `web/playwright.work.config.ts` (`WRITE` 정규식에 `profile-photo` 추가), `web/playwright.auth.config.ts` (`WORK` 정규식에 `profile-photo\.write` 추가. 템플릿 seed 설정에서는 돌지 않게 한다)
- Modify: `docs/16-DECISIONS.md` (새 ADR: ADR-019 개정, 설계 C15), `docs/PROGRESS.md`
- Create: `docs/evidence/profile-photo/` (스크린샷·검증 로그)

**Interfaces:**
- Consumes:
  - `createTestAccount`·`clearEmployment`·`signInByApi`·`removeTestAccounts`(`web/e2e-auth/support/account-admin.ts`)
  - `localAdmin`·`shot`·`assertNoAxe`(`support/work-fixtures.ts`)
  - 로그인은 `support/work-setup.ts:196-221` 의 magiclink 방식을 따른다: `localAdmin().call("POST","/auth/v1/admin/generate_link",{type:"magiclink",email})` → `/auth/confirm?type=email&next=…&token_hash=…`. 관리자는 `admin@admin.com`(데모 seed `scripts/demo/plan.mjs`, org-01 owner·ADMIN)이다.
  - 업로드 입력은 `web/public/demo/people/SOL-P0001.png` 를 쓴다.

- [ ] **Step 1: E2E 작성** — `test("간편 로그인 신규 입사자: 가입 신청 → 사진 → 관리자 승인 → 조직도 사진 → 관리자 사진 변경")`
  1. 부서 신고가 없는 시험 계정을 만들어 간편 로그인 첫 진입을 흉내 낸다(`clearEmployment`).
  2. 로그인 → `/auth/complete-profile` 에서 부서·직급 입력 → `/auth/organization-state` 에서 사진 업로드 → "가입 신청" → "관리자 승인 대기 중" 이 보인다.
  3. admin 이 `/settings/organization` 에서 승인한다.
  4. 신청자가 `/org-chart` 에서 자기 카드의 `img` src 에 `/storage/v1/object/sign/profile-photos/users/` 가 있는지 확인한다.
  5. admin 이 가상 직원 한 명의 사진을 바꾸고, `members/` 서명 URL 이 보이는지 확인한다.
  6. 1440·1280 스크린샷과 `assertNoAxe` 를 남긴다. work-write 프로젝트는 1440 하나라서 시험 안에서 `page.setViewportSize` 로 1280 도 찍는다(설정 주석의 관례).
  7. 끝나면 `removeTestAccounts` 로 시험 계정을 지운다. 명부 연결·신청·사진 포인터는 globalTeardown 의 `demo:reset`(Task 5 수정분)이 되돌린다.
- [ ] **Step 2: 실행**
  - 전제: 로컬 Supabase 에 버킷이 있어야 한다. 먼저 `pnpm storage:local` 을 실행한다.
  - Run: `bash <slot> pnpm -C web test:e2e:work profile-photo`. 의존 프로젝트(work-1440·work-1280 읽기 시험)도 함께 돈다.
  - Expected: profile-photo 시험 1 passed, 나머지 0 failed. 결과는 `docs/evidence/profile-photo/` 에 복사한다.
- [ ] **Step 3: 문서** — ADR 을 새 번호로 "채택(2026-10-24 사용자 설계 승인)"으로 적는다. 내용: ADR-019 개정(명부↔계정은 관리자 승인으로만 연결), Storage 예외(profile-photos private). `docs/PROGRESS.md` 에 한 절을 더한다. frontmatter `updated` 와 위키링크를 확인한다.
- [ ] **Step 4: 통합 검증** — Run: `bash <slot> pnpm verify`. Expected: exit 0. 그다음 독립 리뷰를 1회 받는다(`superpowers:requesting-code-review`, 보안 관점 포함: Storage 정책·RPC·service role 미사용).
- [ ] **Step 5: Commit** — `test(e2e): 프로필 사진 시연 흐름` 과 `docs: 프로필 사진 ADR·진행 기록`

### Task 11: 클라우드 적용 (사용자 확인 필수, U11)

운영 DB 는 2026-10-24 10:30 기준 이력 50개·미적용 0이다(`20261024000100` 포함, sol-radar-78 확인). 이 기능으로 올라갈 것은 migration 2개와 버킷 1개뿐이다.

- [ ] **Step 1: 병합 준비** — 브랜치를 그때의 origin/main 위로 맞춘다. N4b 가 먼저 들어왔으면 `pnpm db:types` → `pnpm test:db` 를 다시 돌린다. main 병합은 sol-radar-78 이 한다.
- [ ] **Step 2: 보고** — sol-radar-78 에 다음을 보낸다: 브랜치·커밋, `pnpm verify` 결과, 올라갈 migration 2개(`20261024000200_profile_photos`·`20261024000300_member_join_requests`), 버킷 계획(`profile-photos`, private, 2MB, jpeg·png·webp).
- [ ] **Step 3: 적용** — `pnpm db:push`·`pnpm db:verify` 와 버킷 `--apply`(`node scripts/ops/ensure-storage-buckets.mjs --apply`, service role 이 필요한 운영자 CLI)는 사용자 승인 범위에서 sol-radar-78 이 한다. 이 세션은 클라우드에 직접 적용하지 않는다.
- [ ] **Step 4: 운영 확인** — 적용과 배포가 끝났다는 알림을 받으면 운영 화면에서 사진 업로드를 1회 한다. 콘솔 CSP 위반이 0건인지 확인하고 증거를 남긴다.

## Self-Review 메모

- 설계 G1~G6·U1~U11·C1~C15 를 Task 1~11 에 대응시켰다.
  - C1·C2: Task 6(organization-state)
  - C3: Task 5 `find_unlinked_member`, Task 9
  - C4: 사진은 선택 사항, Task 6
  - C5: 재신청, Task 5 submit 갱신
  - C6·C7: Task 5·6
  - C8: Task 5 NEW_HIRE
  - C9·C10: Task 3
  - C11: Task 4
  - C12: Task 5 reset
  - C13: Task 1·5
  - C14: Task 5 정책
  - C15: Task 10
- 계획에서 새로 정한 것:
  - audit_logs action 은 늘리지 않고 신청 행을 기록으로 쓴다(Task 5).
  - 사진 버킷에는 sentinel 을 두지 않는다(Task 2).
  - 출력 형식은 JPEG 로 고정한다(Global Constraints).
  - 신청 행에 신청자 사본(이름·이메일·사진·부서·직급)을 둔다. 관리자는 RLS 때문에 비멤버 프로필을 읽지 못한다(Task 5).
  - 바꾸거나 지운 옛 사진 객체는 Storage 에 남긴다. 덮어쓰지 않는 경로 규칙과 signed URL 만료가 우선이고, 정리는 해커톤 뒤로 미룬다(Task 3).
- 확인한 코드 사실:
  - 같은 조직 멤버끼리 profiles 를 읽는 정책이 있다. 그래서 승인된 신규 입사자의 제공자 사진(`linked_avatar_url`) embed 가 동작한다.
  - E2E 는 데모 seed 를 쓰는 `playwright.work.config.ts` 의 work-write 에서 돈다. 템플릿 seed(`test:e2e:auth`)에는 org-01 관리자가 없다.
