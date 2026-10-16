# 스펙: 소셜 로그인 모듈과 회원 관리

- 최종 갱신: 2026-10-15
- 상태: 마침(2026-10-15). 에이전트가 할 일은 끝났다. 남은 것은 사용자가 실제 키로 하는 OAuth 확인뿐이다(맨 아래 미결정 사항).

## 1. 목표

구글·카카오·네이버 간편 로그인을 다른 제품에서 그대로 다시 쓸 수 있는 인증 모듈로 마무리한다. 로그인·세션·토큰은 Supabase Auth 가 맡고,
이 저장소는 그 위에 회원 상태(정지)·탈퇴·계정 연결·인증 API 를 더한다. 서버 코드는 기존 규칙대로 Next.js 서버 계층(`web/server/<도메인>`)에 둔다. [사용자 결정]

## 2. 비목표

- NestJS 백엔드와 Docker Compose. 요청서의 NestJS 역할(JWT 검증·가드·사용자 API)은 Next.js 라우트 핸들러와 도메인 함수가 맡는다. [사용자 결정]
- 소프트 삭제·유예 기간·예약 파기(pg_cron). 탈퇴는 즉시 삭제다. 그래서 `status` 에 `deleted`, `deleted_at` 열을 두지 않는다. [사용자 결정]
- `profiles.role` 열. DB 기준은 `is_admin` 그대로이고, API·화면이 `role: "user" | "admin"` 으로 계산해 내보낸다. [사용자 결정]
- 앱(mobile)의 간편 로그인·계정 화면. [작성자 판단]
- 프로필 이미지 올리기. 이미지는 제공자가 준 주소를 보이기만 한다. [작성자 판단]
- 코드 안의 요청 수 제한(rate limit). 인증 요청(로그인·토큰 갱신·OAuth)은 Supabase Auth 의 제한을 쓰고, `/api/*` 는 배포 플랫폼(Vercel 방화벽 규칙)에 맡긴다.
  서버리스에서 메모리 제한기는 인스턴스마다 따로 세어 막는 척만 하기 때문이다. [작성자 판단]
- 이메일이 같다고 계정을 코드로 합치는 일. 같은 검증된 이메일의 자동 연결은 Supabase Auth 의 기본 동작이고, 이 저장소는 따로 합치지 않는다. [작성자 판단]

## 3. 완료의 정의

1. **DB** — 새 마이그레이션 한 장이 `profiles` 에 `avatar_url`·`status`(active·suspended)·`updated_at` 을 더하고, 가입 때 제공자 정보로 표시 이름·이미지를 채운다.
   정지·탈퇴 함수와 정책이 4.2 대로 동작한다. 검증: `pnpm test:db`(`scripts/database.test.mjs` 의 새 묶음), 로컬 Supabase 에 `pnpm db:start` 로 적용.
2. **인증 경계** — 서버가 믿는 로그인은 서명·만료·발급자(iss)·대상(aud)·역할을 확인한 JWT 하나다(쿠키든 `Authorization: Bearer` 든). 검증: 웹 단위 시험, 로컬 Supabase 의 실제 토큰으로 API 호출(유효·만료·변조·없음).
3. **API** — 4.3 의 경로가 계약대로 답한다. 검증: 라우트 단위 시험과 로컬 Supabase 실호출.
4. **마이페이지** — `/<slug>/settings` 에서 이미지·표시 이름·연결된 로그인 수단을 보고, 연결·해제·로그아웃(이 기기·모든 기기)·탈퇴를 한다. 마지막 로그인 수단은 해제하지 못한다.
   검증: 로그인 E2E(`pnpm -C web test:e2e:auth`)와 375·1280px 브라우저 확인.
5. **정지** — 운영자가 `/admin` 에서 정지·해제한다. 정지된 사람은 새로 로그인하지 못하고, 세션이 끊기고, 화면·API·조직 데이터에 닿지 못한다. 검증: DB 시험, 로그인 E2E, 로컬 실호출.
6. **네이버** — `custom:naver` 를 OIDC 방식으로 등록하는 설정법을 문서에 적는다. 실제 키로 하는 로그인은 사용자가 수동 절차로 확인한다(자동 시험 아님).
7. **문서** — `docs/AUTH-ARCHITECTURE.md`·`SUPABASE-SETUP.md`·`OAUTH-PROVIDERS.md`·`AUTH-API.md`·`AUTH-SECURITY.md`·`AUTH-TESTING.md`(Mermaid 4종 포함). `docs/database.md` 의 간편 로그인 절은 이 문서들을 가리킨다.
8. **전체 검증** — `pnpm verify`, `pnpm -C web test:e2e`, `pnpm -C web test:e2e:auth` 통과.

## 4. 인터페이스 계약

### 4.1 제공자 [사용자 결정]

- 구글 `google`, 카카오 `kakao`(Supabase 기본 제공자), 네이버 `custom:naver`.
- 네이버는 OAuth2 방식으로 등록하지 않는다. Supabase Auth 의 OAuth2 사용자 정의 제공자는 사용자 정보의 맨 위 키에서만 `sub` 를 읽는데,
  네이버 응답은 `response.id` 로 한 겹 들어 있어 로그인이 "error missing provider id" 로 실패한다(Supabase Auth 소스 `internal/api/provider/custom_oauth.go`).
  네이버는 OIDC 디스커버리(`https://nid.naver.com/.well-known/openid-configuration`, PKCE S256, RS256)를 내므로 OIDC 방식(issuer `https://nid.naver.com`)으로 등록한다.
  ID 토큰에 이메일이 없을 수 있어 `email_optional` 을 켠다. [작성자 판단]
- 버튼 표시는 지금처럼 `NEXT_PUBLIC_AUTH_GOOGLE`·`_KAKAO`·`_NAVER=true` 로 켠다. 값이 없으면 그 버튼만 없고 나머지는 동작한다.

### 4.2 DB [사용자 결정 + 작성자 판단]

- `profiles.avatar_url text` — `https://` 로 시작하는 2048자 이하이거나 null. 가입 트리거가 `raw_user_meta_data` 의 `avatar_url`·`picture` 에서 채운다. 화면 역할은 고치지 못한다.
- `profiles.display_name` — 비어 있으면 가입 트리거가 `full_name`·`name`·`nickname` 에서 앞뒤 공백을 걷고 40자로 잘라 채운다.
- `profiles.status text not null default 'active'` — `active`·`suspended`. 화면 역할은 고치지 못하고 운영자 함수만 바꾼다(권한 + 두 번째 잠금 트리거).
- `profiles.updated_at` — 행이 바뀔 때 트리거가 채운다.
- `public.delete_my_account()` — 로그인 역할만. 다른 멤버가 있는 팀의 유일한 owner 면 `sole_owner` 로 거절한다. 혼자인 팀은 지우고 `auth.users` 행을 지운다
  (프로필·멤버십·개인 조직·세션·연결된 로그인이 함께 지워지고, 팀 작업은 만든 사람만 비운 채 남는다).
- `public.admin_set_user_status(target uuid, next_status text)` — 운영자만. 자기 자신과 다른 운영자는 바꾸지 못한다. 정지하면 `auth.users.banned_until` 을 100년 뒤로 두고 세션을 지운다. 해제하면 둘 다 되돌린다.
- 정지된 사람: `is_admin()` 이 false, `my_org_ids()`·`my_owner_org_ids()` 가 비고, 본인 프로필의 표시 이름을 고치지 못한다. 본인 프로필은 읽는다(정지 안내를 보이려고).

### 4.3 API (`web/app/api/`) [작성자 판단]

- 인증은 `Authorization: Bearer <Supabase access token>` 만 받는다(쿠키를 받지 않아 CSRF 대상이 아니다). 웹 화면은 서버 함수를 쓴다.
- 응답 오류는 `{ "error": { "code": string, "message": string } }`. 401 `unauthenticated`, 403 `suspended`·`forbidden`, 404 `not_found`, 409 `sole_owner`·`last_identity`, 400 `invalid`.

| 메서드·경로 | 권한 | 하는 일 |
|---|---|---|
| `GET /api/auth/providers` | 공개 | 켜 둔 로그인 제공자 목록 |
| `GET /api/auth/me` | 로그인 | id·email·role·status·연결된 로그인 수단 |
| `POST /api/auth/logout-all` | 로그인 | 모든 기기의 세션을 끊는다(Supabase `scope: global`). 204 |
| `DELETE /api/auth/identities/:id` | 로그인 | 로그인 수단 하나를 해제한다. 마지막 하나면 409 |
| `GET /api/users/me` | 로그인 | 프로필(표시 이름·이미지·역할·상태·가입일) |
| `PATCH /api/users/me` | 로그인 | `{ displayName }` 만 고친다 |
| `DELETE /api/users/me` | 로그인 | 탈퇴. 204 |
| `PATCH /api/admin/users/:id/status` | 운영자 | `{ status: "active" \| "suspended" }` |

- 요청서의 NestJS 장치와의 대응: `SupabaseAuthGuard`·`CurrentUser` → `requireUser`, `RolesGuard`·`Roles` → `requireAdmin`, `Public` → 감싸지 않은 핸들러.

### 4.4 화면 [작성자 판단]

- 마이페이지(`/<slug>/settings` 의 계정 탭): 프로필(이미지·이메일·계정 유형·표시 이름), 로그인 수단(연결됨·연결하기·해제), 비밀번호, 세션(로그아웃·모든 기기에서 로그아웃), 회원 탈퇴(확인 대화상자).
- 로그아웃 버튼은 이 기기만 끊는다(`scope: local`). 지금까지는 기본값(global)이라 모든 기기가 끊겼다.
- 로그인 화면: `?next=` 를 받아(사이트 안 경로만) 이메일·간편 로그인 뒤 그리로 보낸다. 정지된 계정과 연결 실패는 안내를 보인다.
- 관리자 사용자 목록: 상태 열과 정지·해제 버튼(확인 대화상자). 자기 자신과 다른 운영자 줄에는 버튼이 없다.

## 5. 엣지 케이스와 실패 시나리오

- 정지 직후에도 이미 받은 access token 은 만료(기본 1시간)까지 서명이 맞다. 서버(화면·API)는 요청마다 DB 의 상태를 읽어 막고, DB 는 정책 도우미가 막는다. [작성자 판단]
- 탈퇴 직후의 access token 도 같다. 프로필 행이 없으면 서버가 401 로 본다. [작성자 판단]
- 이메일을 주지 않는 제공자(카카오 비즈 앱 아님·네이버 ID 토큰): 프로필 이메일이 비고, 같은 이메일 자동 연결도 일어나지 않는다. [작성자 판단]
- 연결하려는 소셜 계정이 이미 다른 회원의 것: Supabase 가 `identity_already_exists` 로 거절하고, 마이페이지가 안내한다. [작성자 판단]
- 수동 연결(manual linking)이 꺼진 프로젝트: 연결 버튼을 누르면 Supabase 가 `manual_linking_disabled` 로 거절하고, 마이페이지가 설정법을 안내한다. [작성자 판단]
- 콜백의 `next` 가 바깥 주소: 지금처럼 버리고 `/auth/login` 으로 보낸다. 로그인 화면의 `?next=` 도 같은 규칙이다. [작성자 판단]
- 발급자(iss)는 `NEXT_PUBLIC_SUPABASE_URL` + `/auth/v1` 과 같아야 한다. 사용자 지정 도메인을 쓰면 이 값을 그 도메인으로 맞춘다(문서). [작성자 판단]

## 구현 메모

- 2026-10-15 DB 시험 담당이 찾은 결함: 정지된 사람이 남은 토큰으로 팀을 만들거나 초대를 수락할 수 있었다. 활동 회원 도우미 `is_active_user()` 를 만들어 "팀 만들기"·"초대 수락" 정책에 넣었다(`scripts/db-verify.mjs` 허용 목록에 이유와 함께). [작성자 판단]
- 정지된 회원은 탈퇴하지 못한다(hint `suspended`). 지우고 같은 소셜 계정으로 다시 가입해 정지를 빠져나가지 못하게 한다. [작성자 판단]
- 연결에 성공하고 돌아오면 콜백이 `?link=linked` 를 붙이고 마이페이지가 토스트로 알린다(디자인 스펙의 열린 질문 1). [작성자 판단]
- 로그인 수단 목록의 회사 표시(`web/components/provider-mark.tsx`)에 `kakao`·`naver` 토큰을 쓴다. 네이버의 흰 N 은 초록 바탕 없이는 보이지 않는다. `design-system` 스킬의 쓰임 규칙을 한 줄 넓혔다(디자인 스펙의 제안 1). [작성자 판단]
- 로그인 쿠키에 운영 빌드에서만 `Secure` 를 더했다(`web/server/shared/auth-cookie.ts`). `HttpOnly` 는 브라우저 클라이언트가 읽어야 해서 켜지 않는다. [작성자 판단]
- `/api/*` 는 Bearer 토큰만 받는다. 서버 연결(`getSupabase`)은 Authorization 헤더가 있으면 그 토큰으로, 없으면 쿠키로 붙는다 — 그래서 기존 도메인 함수가 API 에서도 그대로 RLS 아래에서 돈다. [작성자 판단]
- 웹 린트가 깃 제외 산출물(`playwright-report/`·`test-results/`)을 검사해 E2E 가 한 번 실패하면 깨졌다. 제외 목록에 더했다(소스 검사는 그대로). [작성자 판단]
- 디자인 스펙의 열린 질문 가운데 정지 사유 입력·감사 기록, 문의 창구, 관리자 목록의 상태 거르기, 소셜 전용 계정에 비밀번호 더하기, 탈퇴를 막는 팀 미리 보기는 이번에 하지 않는다. [작성자 판단]

## 미결정 사항

- 네이버 OIDC ID 토큰의 클레임(이메일·이름 유무, nonce 처리). 실제 키로 확인한 뒤 `docs/OAUTH-PROVIDERS.md` 와 이 스펙을 고친다.
- 실제 키로 하는 OAuth 확인(구글·카카오·네이버의 가입·재로그인·연결). `docs/AUTH-TESTING.md` 의 표가 아직 모두 미확인이다.
