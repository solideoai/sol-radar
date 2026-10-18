# 데이터베이스

웹이 Supabase DB 를 씁니다. 처음 고르는 법은 [설치와 설정](setup.md#2-db-고르기), 자세한 규칙은
`database` 스킬(`.claude/skills/database/SKILL.md`)에 있습니다.

## 환경변수 파일 두 개

값은 **그 값을 읽는 프로그램의 폴더**에 둡니다. Next 는 `web/` 의 파일만 읽습니다.
둘 다 깃에 올라가지 않고, 각 폴더의 `.env.example` 에 설명이 있습니다.

| 파일 | 넣는 것 | 읽는 쪽 |
|---|---|---|
| `.env.local` (루트) | `SUPABASE_DB_URL` (Session pooler 주소, 비밀) | `pnpm db:push`·`db:verify` — 클라우드 전용 |
| `web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`, 쓸 때만 `SUPABASE_SERVICE_ROLE_KEY`, 초대 메일을 보낼 때만 `SMTP_HOST`·`SMTP_PORT`·`SMTP_USER`·`SMTP_PASSWORD`·`MAIL_FROM`·`SITE_URL`(서버 전용) | 웹 |

로컬 DB 면 `pnpm db:start` 가 `web/.env.local` 의 주소와 anon 키를 채웁니다. 파일에 이미 클라우드 주소가 있으면 덮지 않고 멈춥니다.

## 규칙

- 데이터 접근의 기본 통로는 **anon 키**입니다. 누가 무엇을 읽고 쓰는지는 코드가 아니라 DB 의 **RLS 정책**이 정합니다.
  `service_role` 키는 RLS 를 무시하므로 기본 통로로 쓰지 않습니다. 관리자 화면도 `profiles.is_admin` 과 정책으로 가립니다.
- 스키마 변경은 `supabase/migrations/` 에 **새 파일로만** 남깁니다. 이미 있는 파일을 고치거나 지우면 커밋 게이트가 막습니다.
- 표는 만드는 그 파일에서 바로 RLS 로 잠그고, 필요한 만큼만 정책으로 엽니다.
- 마이그레이션을 더하면 `pnpm db:types` 로 타입을 만들어 같은 커밋에 넣습니다. 웹의 Supabase 클라이언트에 이 타입이
  붙어 있어서 없는 표·열 이름은 컴파일 오류가 됩니다.
- 적용은 로컬이면 `pnpm db:start`(켜져 있어도 다시 돌리면 새 것만 적용), 클라우드면 `pnpm db:push` 뒤 `pnpm db:verify`.
- 로컬 시험 계정·데이터는 `pnpm db:seed` 가 넣습니다(소유자·멤버·조직 밖 사람·초대받은 사람·운영자와 "시드 팀"의 작업). 다시 돌리면 시드 계정과 그 조직만 지우고 처음부터 만듭니다. 로컬 주소가 아니면 거부합니다.
- 템플릿에는 `profiles` 표가 들어 있습니다. 가입하면 자동으로 행이 생기고, `is_admin` 으로 운영자를 가립니다.
  운영자만 여는 관리자 화면 `/admin`(`web/app/admin/`, 도메인 `@/server/admin`)은 가입한 사용자 목록을 기존 정책 "운영자는 전체 프로필 읽기"로만 읽습니다. 운영자가 아니면 404 입니다.
- 사용자가 만드는 데이터는 조직에 속합니다. 표에 `org_id` 를 두고 정책은 `org_id in (select public.my_org_ids())` 로 거릅니다([조직 견본](#조직-견본)).
  운영자(`is_admin`)는 조직 역할(`owner`·`member`)이 아니어서, 운영자도 남의 조직은 읽지 못합니다.

## 로그인 견본

웹이 **가입 → 이메일·비밀번호 로그인 → 본인 `profiles` 읽기 → 로그아웃**을 실제로 합니다.
`/auth/login`(`web/app/auth/login/`)에서 로그인하면 개인 조직의 대시보드(`/<slug>/dashboard`)로 가고, 프로필·표시 이름·로그아웃은 `/<slug>/settings`(`web/app/(app)/[slug]/settings/`)에 있습니다.
비밀번호 재설정(`/auth/reset` → 메일 링크 → `/auth/password`)도 끝까지 있습니다.
DB 설정이 없으면 화면이 연결이 없다고 알리고 멈춥니다. 새 기능을 만들 때 이 코드가 기준입니다.

| 자리 | 웹 |
|---|---|
| 가입 | `/auth/sign-up` — `auth.signUp`. 이름은 `user_metadata.name` 으로 보내 가입 트리거가 표시 이름으로 옮긴다. 휴대폰·주소(카카오 우편번호 검색)·생년월일·약관 동의는 화면에서 받기만 하고 아직 보내지 않는다(`web/app/auth/sign-up/sign-up-schema.ts`) |
| 메일 링크 확인 | 라우트 핸들러 `web/app/auth/confirm/route.ts` → 도메인 `@/server/auth` (가입 확인·비밀번호 재설정 공용) |
| 비밀번호 재설정 | `/auth/reset`(메일 요청) → `/auth/password`(새 비밀번호) |
| 로그인·로그아웃 | 클라이언트 컴포넌트가 `getSupabaseBrowser().auth.*` (세션은 쿠키, `web/proxy.ts` 가 갱신). 로그인하면 `?next=` 나 개인 조직의 대시보드, 로그아웃(이 기기만)하면 `/auth/login` 으로 간다 |
| 본인 프로필 읽기 | 설정 화면의 서버 컴포넌트 → 도메인 `@/server/profile` → `await getSupabase()` |
| 표시 이름 고치기 (쓰기 견본) | 설정 화면의 폼(`web/app/account/display-name-form.tsx`) → 서버 함수 `web/app/account/actions.ts` → 도메인 `@/server/profile` (zod 로 다시 검증) → `await getSupabase()` |
| 입력 검사 | react-hook-form + zod (화면의 편의) |
| 시험 | `web/server/profile/*.test.ts` (모델·서비스) |

- "본인 행만"은 RLS 가 지키지만 운영자는 정책상 모든 행을 읽습니다. 그래서 "내 프로필"은 로그인한 id 로 좁혀 읽습니다.
- 쓰기는 세 겹으로 지킵니다(`supabase/migrations/20261013000001_init.sql` 의 "표시 이름" 절). 권한은 `display_name` 열에만 주고,
  정책은 본인 행만 열고, 값의 규칙(앞뒤 공백 없이 1~40자)은 DB 제약이 마지막에 봅니다. 서버 함수는 누구의 행인지를 입력이 아니라 로그인에서 읽습니다.
- 서버에서 누가 로그인했는지는 `@/server/supabase` 의 `getAuthClaims()` 로 봅니다. 서명·만료(`auth.getClaims`)와 발급자·대상·역할을 확인한 토큰만 믿습니다(`getSession()` 은 서버에서 믿지 않습니다).
- 메일 링크는 `/auth/confirm?token_hash=…&type=…&next=…` 모양이고 메일 템플릿(`supabase/templates/`)이 정합니다. `next` 는 누구나 바꿔 보낼 수 있어
  이 사이트 안의 경로만 받습니다(`web/server/auth/auth.model.ts` 의 `safeNextPath`).
- 로컬은 `supabase/config.toml` 이 메일 확인을 켜고 템플릿을 읽습니다. 메일은 실제로 나가지 않고 메일함(`pnpm db:start` 가 알려 주는 주소)에 쌓이니 링크를 거기서 엽니다.
  `config.toml` 을 바꾼 뒤에는 `pnpm db:stop` 뒤 `pnpm db:start` 로 다시 켭니다.

### 간편 로그인과 회원 관리

구글·카카오·네이버 로그인, 마이페이지의 로그인 수단 연결·해제, 모든 기기 로그아웃, 회원 탈퇴, 운영자의 회원 정지, 회원 API(`/api/*`)는 인증 문서에 모았습니다.

| 문서 | 내용 |
|---|---|
| [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) | 역할 분리, 흐름도(로그인·토큰 검증·`auth.users`↔`profiles`·연결/해제), 코드 지도 |
| [SUPABASE-SETUP.md](SUPABASE-SETUP.md) | 환경 변수, 대시보드 설정(manual linking 등), 첫 운영자 |
| [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md) | 구글·카카오·네이버 콘솔 설정, 네이버를 OIDC 로 등록하는 이유와 수동 확인 |
| [AUTH-API.md](AUTH-API.md) | `/api/auth/*`·`/api/users/me`·`/api/admin/users/{id}/status` 계약 |
| [AUTH-SECURITY.md](AUTH-SECURITY.md) | 보안 항목별로 무엇이 지키는지, 쿠키, 요청 수 제한, 네이버 대안 |
| [AUTH-TESTING.md](AUTH-TESTING.md) | 자동 시험의 범위와 실제 OAuth 수동 확인 절차 |

- 로그인 화면의 버튼은 `web/.env.local` 에 켠 것(`NEXT_PUBLIC_AUTH_GOOGLE`·`_KAKAO`·`_NAVER=true`)만 보입니다. 그 제공자를 Supabase 에 설정한 뒤에만 켭니다.
- 처음 들어온 사람도 가입 트리거가 프로필(제공자의 이름·사진)과 개인 조직을 만듭니다.
- 회원 상태(`profiles.status`)·정지·탈퇴는 `supabase/migrations/20261015000001_account_status_and_deletion.sql` 에 있습니다.

## 조직 견본

**모든 데이터는 조직에 속합니다.** 가입하면 개인 조직(이름 "개인 공간", 무작위 8자 주소, 혼자만 씀)이 생기고, 협업은 팀 조직을 만들어
이메일로 초대합니다. 메일 설정(SMTP)이 있으면 초대 메일을 보내고, 없거나 보내지 못하면 초대한 사람이 직접 알립니다(아래 "초대 메일"). 웹 주소의 첫 마디가 조직이고(`/<slug>/dashboard`),
사이드바 맨 위의 조직 전환기로 옮겨 다닙니다. 사람이나 팀이 만드는 데이터의 표를 새로 만들 때 이 견본과 작업 견본이 기준입니다.

| 자리 | 웹 |
|---|---|
| 표 | `supabase/migrations/20261014000001_organizations.sql` — `organizations`·`memberships`·`invitations`. 팀 이름 바꾸기·지우기는 `20261015000002_team_settings.sql` |
| 도메인·로직 | `web/server/organization/` (model·repo·service·배럴) |
| 앱 틀·전환기 | `web/app/(app)/[slug]/layout.tsx` 가 주소의 조직이 내 조직인지 확인하고(아니면 404), `web/components/app-shell.tsx` 가 사이드바 맨 위에 전환기를 그린다 |
| 멤버·초대 | `/<slug>/settings/members` (`web/app/(app)/[slug]/settings/members/`) — 멤버 표, 역할 바꾸기·내보내기·나가기, 초대·취소. 개인 조직이면 팀 만들기 안내 |
| 팀 만들기 | `/teams/new` (`web/app/teams/new/`) — 이름과 주소(slug)를 받는다 |
| 팀 설정 | `/<slug>/settings/team` (`web/app/(app)/[slug]/settings/team/`) — owner 가 이름을 바꾸고 팀 이름을 입력해 확인한 뒤 지운다. member 는 보기만. 도메인 `renameTeam`·`deleteTeam` |
| 초대 메일 | 보내기 `web/server/organization/organization.mail.ts`, 내용 `organization.model.ts` 의 `toInvitationMailContent`. `inviteMember` 가 부른다 |
| 받은 초대 | `/invitations` (`web/app/invitations/`) — 수락·거절 |
| 옛 주소 | `/dashboard`·`/settings` 는 개인 조직의 같은 화면으로, `/memos` 는 개인 조직의 작업 화면(`/<slug>/tasks`)으로 보낸다 |
| 시험 | `web/server/organization/*.test.ts` (모델·서비스) |

- 역할은 `memberships.org_role` 의 `owner`·`member` 둘이고 enum 이 아니라 check 제약입니다. 멤버 관리(역할 변경·내보내기)와 초대는 owner 가, 나가기는 본인이 합니다.
- owner 만 하는 일은 `public.my_owner_org_ids()` 로 거릅니다(멤버 전원은 위 "규칙"의 `public.my_org_ids()`). 두 도우미는 `security definer` 입니다 —
  memberships 의 정책이 memberships 를 다시 읽으면 무한 재귀가 나서 그 고리를 끊습니다. 부른 사람 자신의 조직만 돌려주고 로그인 역할만 실행하며,
  `scripts/db-verify.mjs` 의 허용 목록에 이유와 함께 있습니다.
- 정책으로 쓰면 재귀가 나거나 행을 세야 하는 규칙은 트리거가 지킵니다. 마지막 owner 는 나가거나 `member` 로 내려가지 못하고(조직 행을 잠가 두 owner 가 동시에 서로 내려도 0명이 되지 않습니다),
  개인 조직과 이미 멤버인 이메일(자기 이메일 포함)에는 초대하지 못합니다. 같은 이메일을 다시 초대하면 만료가 7일로 새로 늘고, 수락하면 초대 행이 지워집니다.
- 조직에 들어오는 길은 셋입니다. 가입(가입 트리거가 개인 조직과 owner 멤버십을 만든다), 팀 만들기(만든 사람이 owner 가 된다), 초대 수락.
  수락은 `memberships` 의 insert 정책 하나가 판단합니다. 서명된 JWT 의 `email` 클레임이 초대 이메일과 같고, 만료 전이고, 초대받은 역할일 때만 들어옵니다. 거절은 초대 행 삭제입니다.
- 같은 조직의 멤버끼리는 서로의 이메일·표시 이름을 읽습니다(profiles 정책). 이때 `is_admin` 열도 함께 보입니다.
- 팀 주소는 소문자·숫자·하이픈 3~32자이고 최상위 경로 이름(`account`·`settings` 등)은 쓰지 못합니다. DB 제약(`organizations_slug_check`)이 마지막에 지킵니다.
- 계정을 지우는 관리 작업(JWT 없음)은 마지막 owner 보호를 통과합니다. 팀의 작업은 만든 사람만 비운 채 남고, 그 사람이 맡던 작업은 담당자가 빕니다.
- 팀 이름 바꾸기·지우기는 팀(개인 조직이 아닌 조직)의 활동 회원 owner 만 합니다. 화면 역할에 `organizations` 의 열 단위 `update (name)` 과 `delete` 가 있고,
  정책이 `personal_owner_id is null and id in (select public.my_owner_org_ids())` 로 거릅니다. member·조직 밖의 사람·운영자·정지된 사람의 시도는 오류 없이 0행이고, 서비스는 `forbidden` 을 돌려줍니다.
  주소(slug)와 개인 조직은 바꾸거나 지우지 못합니다(개인 조직은 계정과 함께만 없어집니다). 이름 규칙은 팀 만들기와 같습니다(앞뒤 공백 없이 1~40자).
- 팀을 지우면 멤버십·초대·작업·활동이 연쇄로 지워집니다. 마지막 owner 보호는 조직 행이 이미 없으면(같은 문장이 그 조직을 지우는 중) 비키고,
  활동 기록 트리거는 지워지는 조직의 일을 남기지 않습니다. 서비스는 사용자가 입력한 확인용 이름이 DB 의 지금 이름과 같을 때만 지웁니다(앞뒤 공백만 뗍니다).
  지워진 팀의 다른 멤버는 다음 요청에서 404 를 봅니다.
- DB 정책 시험은 `scripts/database.test.mjs` 의 "조직·멤버십·초대 정책" 묶음입니다. 조직 밖의 사람(운영자 포함)이 못 읽는지, owner 만 관리하는지, 마지막 owner·초대 규칙을 봅니다.
- 팀 주소(slug) 바꾸기·소유권 넘기기 화면(역할 바꾸기로 한다)은 이 견본에 없습니다.

### 초대 메일

초대(새 초대·같은 이메일 다시 초대)가 저장된 뒤 웹 서버가 SMTP 로 메일을 한 통 보냅니다. Supabase Auth 의 메일(가입 확인·비밀번호 재설정)과는 따로입니다.

- 보내는 조건: `web/.env.local`(운영은 배포 서비스)의 `SMTP_HOST`·`SMTP_PORT`·`MAIL_FROM`·`SITE_URL` 이 모두 있을 때만. `SMTP_USER`·`SMTP_PASSWORD` 는 인증이 있는 서버일 때 둘 다 적습니다.
  모두 서버 전용이고 `NEXT_PUBLIC_` 를 붙이지 않습니다. 이름과 설명은 `web/.env.example` 에 있습니다. 일부만 적으면 보내지 않고 빠진 변수 이름만 서버 로그에 남깁니다.
- 내용: 조직 이름, 초대한 사람(지금 초대를 누른 사람의 표시 이름, 없으면 이메일 앞부분), 역할, 만료일(서울 날짜), 받은 초대 화면 링크(`<SITE_URL>/invitations`). HTML 판과 텍스트 판을 함께 보냅니다.
  조직 이름·표시 이름은 HTML 이스케이프하고, 제목에 들어갈 때는 줄바꿈·제어 문자를 공백으로 바꿉니다. 받는 사람이 가입했든 안 했든 같은 메일이고, 링크를 열어 로그인(없으면 가입)한 뒤 수락합니다.
- 결과: `inviteMember` 의 `invited`·`renewed` 에 `mail` 이 붙습니다 — `sent`(SMTP 서버가 받음)·`not-configured`(설정 없음)·`failed`(접속 실패·거절·약 10초 시간 초과).
  어느 쪽이든 초대는 저장된 채 남고 되돌리지 않습니다. 화면은 `not-configured`·`failed` 면 "직접 알려 주세요"라고 안내합니다. 실패는 서버 로그에 JSON 한 줄(`event: "invitation-mail-failed"`, 오류 이름·코드·SMTP 응답 번호)로 남고, 받는 사람 주소는 남기지 않습니다.
- 암호화: 포트 465 는 처음부터 TLS, 그 밖(587 등)은 STARTTLS 입니다. `SMTP_USER` 를 적으면 TLS 를 강제해, 서버가 STARTTLS 를 못 하면 비밀번호를 평문으로 보내지 않고 실패합니다.
- 로컬: `supabase/config.toml` 의 `[local_smtp] smtp_port`(54325)가 메일함(Mailpit)의 SMTP 를 엽니다. `pnpm db:start` 가 `web/.env.local` 의 메일 설정이 비어 있을 때
  `SMTP_HOST=127.0.0.1`·`SMTP_PORT=54325`·`MAIL_FROM`·`SITE_URL`(config.toml 의 `site_url`)을 적습니다. 메일은 실제로 나가지 않고 메일함(http://127.0.0.1:54324)에 쌓입니다.
  시험은 메일함 API(`http://127.0.0.1:54324/api/v1/search?query=to:<주소>`)로 도착을 확인합니다. 손으로 적어 둔 메일 설정은 덮지 않습니다.

## 작업·활동 견본

로그인한 사람이 **지금 조직의 작업을 거르고 정렬하고 쪽으로 넘겨 읽고, 추가·편집·상태 바꾸기·삭제하는** 데이터 표 견본입니다.
`profiles` 가 "내 행 하나"의 기준이라면 `tasks` 는 "조직의 행 여러 개"의 기준입니다. 상태·마감일·담당자가 있어 대시보드가 상태 집계·기한·담당을 보여 줍니다.
활동 기록(`activities`)은 조직 안에서 누가 언제 무엇을 했는지 DB 트리거가 남기고, 대시보드가 최근 10개를 보여 줍니다.
로그인하지 않았거나 DB 가 연결되지 않았으면 작업 대신 안내를 보여 줍니다(앱 틀 `web/app/(app)/[slug]/layout.tsx` 이 그립니다).

| 자리 | 웹 |
|---|---|
| 표 | `supabase/migrations/20261014000004_tasks_and_activity.sql` — `tasks`(2·3절), `activities`(4절)와 기록 트리거(5절), 권한·정책(6절), 대시보드 집계 함수 `task_dashboard_stats`(7절). 같은 파일이 memos 를 지운다(1절) |
| 도메인·로직 | `web/server/task/`·`web/server/activity/` (model·repo·service·배럴). 지금 조직은 화면이 조직 도메인으로 확인해 `TaskScope`·`ActivityScope` 로 넘긴다. 두 도메인은 서로 부르지 않는다 |
| 화면 | `/<slug>/tasks` (`web/app/(app)/[slug]/tasks/`) — 데이터 표(상태·담당자로 거르기, 최근 만든 순·마감일 순, 한 쪽 20개), 추가·편집 대화상자, 상태 메뉴, 삭제 확인 대화상자, 빈 상태, `loading.tsx` |
| 요약 | `/<slug>/dashboard` (`web/app/(app)/[slug]/dashboard/`) — 카드 4개(열린 작업·기한 지남·이번 주 완료·내 담당), 최근 14일 날짜별 추가·완료 차트, 기한이 가까운 작업 5개, 최근 활동 10개. 수치는 `getTaskDashboard` 가 집계 함수 하나로, 피드는 `getRecentActivities` 가 낸다 |
| 쓰기 | 대화상자·상태 메뉴 → 서버 함수 → 도메인 `@/server/task` (zod 로 다시 검증) → `await getSupabase()`. 활동은 쓰는 길이 없고 트리거가 남긴다 |
| 시험 | `web/server/task/*.test.ts`·`web/server/activity/*.test.ts` (모델·서비스), DB 정책 `scripts/database.test.mjs` |

- 권한은 `authenticated` 의 `select`·`delete` 와 열 단위 `insert (org_id, title, description, status, due_date, assignee_id)`·`update (title, description, status, due_date, assignee_id)` 뿐입니다.
  만든 사람(`created_by`)은 기본값 `auth.uid()` 로, 완료 시각·고친 시각은 트리거(`tasks_set_timestamps`)가 채웁니다. `org_id` 는 고치지 못해 작업을 다른 조직으로 옮기지 못합니다. `anon`(로그아웃)은 아무것도 못 합니다.
- 정책은 네 가지입니다: 조직 작업 읽기·수정(멤버 전원), 조직 작업 추가(`with check` 로 내 조직이고 만든 사람이 나인지 봄), 만든 사람(아직 멤버일 때)이나 owner 의 삭제.
  운영자도 남의 조직 작업을 읽지 못합니다. 지울 수 없는 행을 지우려 하면 오류가 아니라 0행이 지워지므로, 서비스가 다시 읽어 `forbidden`·`gone`·`not-in-org` 를 가립니다.
- RLS 는 내가 멤버인 조직의 행을 모두 엽니다. 화면이 지금 조직 하나만 보이려면 `org_id` 로 좁힙니다(`web/server/task/task.repo.ts`·`web/server/activity/activity.repo.ts` 의 모든 질의).
- 담당자(`assignee_id`)는 `(org_id, assignee_id)` 로 `memberships (org_id, user_id)` 를 가리키는 복합 외래 키(`tasks_assignee_fkey`)입니다. 다른 조직 사람을 넣으면 DB 가 거절하고(서비스는 `assignee-not-member`),
  멤버가 나가거나 내보내지거나 계정이 지워지면 담당자만 비고 작업은 남습니다(`on delete set null (assignee_id)`).
- `created_by` 는 만든 사람 열입니다. `profiles` 를 가리키고 계정이 지워지면 비워집니다(`on delete set null`). 이름은 지금 멤버에서 찾고, 떠났으면 "떠난 멤버"로 보입니다.
  이름 규칙(표시 이름이 없으면 이메일 앞부분)은 `@/server/shared` 의 `nameOf` 하나를 앱 틀·멤버 목록과 같이 씁니다.
- 값의 규칙은 DB 제약이 마지막에 지킵니다: 제목은 앞뒤 공백 없이 1~120자(`tasks_title_check`), 설명은 1~2000자(`tasks_description_check`), 상태는 `todo`·`in_progress`·`done`(`tasks_status_check`, enum 아님),
  완료 시각은 완료일 때만 있습니다(`tasks_completed_at_check`). 서버(웹)의 zod 도 같은 규칙을 먼저 검사합니다. 마감일은 시각 없는 날짜입니다.
- 목록은 한 쪽 20개(`TASK_PAGE_SIZE`)이고 서버에서 나눕니다. 거르기·정렬·쪽은 URL 쿼리(`status`·`assignee`·`sort`·`page`)에 두고, 잘못된 값은 기본값으로, 범위를 넘은 쪽은 1쪽으로 봅니다.
- 대시보드 수치는 목록을 읽어 앱에서 세지 않고 DB 함수 `task_dashboard_stats` 하나가 냅니다. 호출한 사람의 권한(`security invoker`)으로 돌아 내 조직이 아니면 모두 0 이고,
  날짜는 서울 시간으로 가르며(이번 주는 월요일 0시부터), 지금 남은 작업의 `created_at`·`completed_at` 으로 셉니다.
- 활동 기록은 화면 역할에 `select` 만 있고, 정책 "조직 활동 읽기" 하나가 같은 조직 멤버에게 엽니다. 행은 `tasks`·`memberships`·`invitations` 의 트리거(`security definer`)만 넣습니다.
  - 남기는 일: 작업 만듦·완료함·다시 엶·담당자 바꿈·담당자 비움·지움, 멤버 들어옴(초대 수락)·역할 바뀜·나감·내보냄, 초대 보냄(역할만 남기고 이메일은 남기지 않음).
  - 남기지 않는 일: 할 일 ↔ 진행 중, 만들 때 정한 담당자, 멤버가 빠지며 외래 키가 비운 담당자, 가입·팀 만들기의 첫 owner 멤버십, 조직·계정 삭제로 연쇄로 지워지는 행.
- 기록은 대상이 지워져도 읽히도록 작업 제목(`task_title`)·대상 이름(`target_name`)·역할을 기록 시점의 사본으로 남깁니다. 행위자 이름은 사본이 없고 지금 멤버에서 찾습니다(떠났으면 "떠난 멤버").
  대상의 계정이 지워지면 이름 사본도 지웁니다. 사본을 만드는 `activity_name_of` 는 트리거만 부르고, 모든 역할의 실행 권한을 거둡니다.
- 실제 로그인한 뒤의 화면 동작(작업 추가·담당 지정·완료 → 대시보드 수치와 활동 피드)은 로컬 Supabase 가 있을 때 사람이 확인합니다. 자동 시험만으로 판정하지 않습니다.

### 클라우드에서 가입·재설정 메일 맞추기 (사람이 한 번)

대시보드 설정은 마이그레이션에 담기지 않습니다. Supabase 대시보드 → Authentication 에서 직접 맞춥니다.

1. **URL Configuration → Site URL** 에 웹의 운영 주소를 넣습니다. 메일 템플릿의 `{{ .SiteURL }}` 이 이 값입니다. 비워 두면 링크가 `localhost` 로 갑니다.
2. **Emails → Confirm signup** 에 `supabase/templates/confirmation.html` 의 내용을, **Reset password** 에 `supabase/templates/recovery.html` 의 내용을 붙여 넣습니다.
   기본 템플릿을 그대로 두면 링크가 `/auth/confirm` 으로 오지 않아 확인·재설정이 끝나지 않습니다.
   예전에 붙여 둔 템플릿(`next=/account`·`/account/password`)도 그대로 동작합니다. 옛 주소는 `web/next.config.ts` 가 `/auth/login`·`/auth/password` 로 넘깁니다.
3. 기본 메일 발송은 시간당 보낼 수 있는 수가 아주 적습니다. 운영 전에 **SMTP Settings** 에 자기 메일 서비스를 연결합니다.

### 실제 로그인 확인 (선택·수동)

로컬 Supabase 라면 로그인 뒤 흐름(대시보드·작업·권한 차이·격리·초대 수락·전환)은 `pnpm -C web test:e2e:auth` 가 시드 계정으로 자동 확인합니다.
손으로 볼 때도 `pnpm db:seed` 의 계정을 쓰면 가입·메일 확인을 건너뜁니다. 아래는 그 밖의 경우(클라우드 프로젝트, 가입·메일 링크·재설정)입니다.

`pnpm verify`·`test:e2e` 는 실제 Supabase 계정 없이 돕니다. 견본의 규칙(모델·서비스·입력 검사)은 단위 시험이, "본인 행·내 조직의 행만 읽힌다"는
DB 정책 시험(`scripts/database.test.mjs`)이 보지만 **실제 가입·메일 링크·비밀번호 재설정과 로그인 → 본인 프로필 읽기 → 로그아웃**, 두 계정의 초대 흐름은 자동으로 판정하지 않습니다.
연결한 Supabase 프로젝트와 시험용 계정이 있을 때만 사람이 직접 확인하세요.

1. `web/.env.local` 에 그 프로젝트의 공개 URL·anon 키를 넣고 마이그레이션을 적용해 둡니다.
2. `/auth/login` 에서 시험용 계정으로 로그인합니다. 개인 조직의 대시보드(`/<slug>/dashboard`)로 가는지 보고, 설정 화면에 본인 `profiles` 행 하나만 보이는지 확인합니다.
3. 로그아웃한 뒤(`/auth/login` 으로 갑니다) 설정 화면이 프로필을 읽지 못하는지 확인합니다.
4. 조직은 시험용 계정 둘(A·B)로 웹에서 확인합니다. A 가 전환기의 "새 팀 만들기"(`/teams/new`)로 팀을 만들고, 멤버 화면(`/<slug>/settings/members`)에서 B 의 이메일을 초대합니다.
5. B 로 로그인해 사이드바의 "받은 초대"(`/invitations`)에서 수락하고, 전환기로 팀에 들어가 A 가 만든 작업이 보이는지 확인합니다.
   B 가 작업을 A 에게 맡기고 완료하면 대시보드의 수치와 최근 활동에 남는지 봅니다.
6. A 가 B 를 내보낸 뒤 B 가 맡던 작업의 담당자가 비는지, B 가 그 팀의 주소(`/<slug>/tasks`)를 열면 404 이고 전환기에 그 팀이 없는지 확인합니다. 화면은 1440·1280px 폭에서 봅니다.

확인 위치에 따라 보는 것이 다릅니다. Supabase REST 를 직접 부르는 검사는 RLS 정책만 봅니다.
웹은 브라우저 쿠키 → `web/proxy.ts` 의 토큰 갱신 → 서버 렌더까지 이어져야 하므로 화면에서 따로 확인합니다.
자격 증명 없이 이 확인을 했다고 적지 않습니다.
