# 인증·회원 API

앱(모바일)·다른 서비스가 부르는 HTTP 주소입니다. 웹 화면은 이 주소 대신 서버 함수를 씁니다. 코드는 `web/app/api/`.

## 인증

- `Authorization: Bearer <Supabase access token>` 헤더만 받습니다. 토큰은 supabase-js 로 로그인한 세션의 `session.access_token` 입니다.
  쿠키로는 로그인되지 않습니다(CSRF 대상이 되지 않게).
- 서버는 서명(JWKS)·만료·발급자(`iss` = `NEXT_PUBLIC_SUPABASE_URL` + `/auth/v1`)·대상(`aud` = `authenticated`)·역할(`role` = `authenticated`)을 확인합니다.
- 역할(`role`)·상태(`status`)는 토큰이 아니라 요청마다 DB(`profiles`)에서 읽습니다. 정지되면 다음 요청부터 403 입니다.
- 토큰 갱신은 토큰을 가진 쪽(supabase-js)이 합니다. 서버는 토큰을 저장하지 않습니다.
- 다른 출처의 브라우저 호출(CORS)은 열지 않았습니다. 앱(네이티브)은 CORS 와 상관없습니다.

## 오류

```json
{ "error": { "code": "unauthenticated", "message": "로그인이 필요합니다. …" } }
```

| 상태 | code | 언제 |
|---|---|---|
| 400 | `invalid` | 본문이 JSON 객체가 아니거나 값이 틀림 |
| 401 | `unauthenticated` | 토큰 없음·서명/만료/발급자가 틀림·탈퇴한 회원(응답에 `WWW-Authenticate: Bearer`) |
| 403 | `suspended` | 정지된 회원 |
| 403 | `forbidden` | 운영자 전용 |
| 404 | `not_found` | 대상 없음(남의 것도 없는 것과 같다) |
| 409 | `sole_owner`·`last_identity`·`self`·`admin_target` | 아래 각 주소 |
| 503 | `not_configured` | 서버에 Supabase 설정이 없음 |

모든 응답은 `Cache-Control: no-store` 입니다.

## 주소

### `GET /api/auth/providers` — 공개

이 배포에서 켜 둔 간편 로그인 제공자. `supabaseProvider` 를 `supabase.auth.signInWithOAuth({ provider })` 에 넘깁니다.

```json
{ "providers": [{ "id": "google", "supabaseProvider": "google" }, { "id": "naver", "supabaseProvider": "custom:naver" }] }
```

### `GET /api/auth/me`

```json
{
  "id": "uuid", "email": "a@example.com 또는 null", "role": "user | admin", "status": "active",
  "identities": [{ "id": "identity uuid", "provider": "email | google | kakao | custom:naver", "email": null, "linkedAt": "…", "lastSignInAt": "…" }],
  "canUnlink": true
}
```

### `POST /api/auth/logout-all` → 204

모든 기기의 세션을 끊습니다(Supabase `signOut({ scope: "global" })`). refresh token 이 모두 무효가 되고, 이미 받은 access token 은 만료(기본 1시간)까지 남습니다.
받은 쪽은 들고 있는 토큰을 버립니다. 요청서의 "지원 가능 방식 검증": Supabase Auth 의 `POST /logout?scope=global` 이 그 사람의 토큰으로 동작합니다(로컬 확인).

### `DELETE /api/auth/identities/{id}` → 204

로그인 수단 하나를 해제합니다. `id` 는 `GET /api/auth/me` 의 `identities[].id`.
마지막 하나면 409 `last_identity`, 내 것이 아니거나 없으면 404.

연결(추가)은 API 가 아니라 클라이언트의 `supabase.auth.linkIdentity({ provider })` 입니다 — 제공자 로그인 화면을 거쳐야 해서 브라우저·앱이 직접 엽니다.

### `GET /api/users/me`

```json
{ "id": "uuid", "email": null, "displayName": "홍길동", "avatarUrl": "https://… 또는 null", "role": "user", "status": "active", "joinedAt": "…" }
```

### `PATCH /api/users/me`

본문 `{ "displayName": "새 이름" }`(앞뒤 공백을 걷고 1~40자). 다른 필드(`role`·`status`·`avatarUrl`·`id` …)는 읽지 않습니다 — DB 권한도 열지 않았습니다.
응답은 `GET /api/users/me` 와 같습니다.

### `DELETE /api/users/me` → 204

탈퇴. **즉시 삭제되고 되돌릴 수 없습니다.** 프로필·멤버십·개인 조직·연결된 로그인 수단·모든 세션이 지워지고, 팀에 남긴 작업은 만든 사람만 비운 채 남습니다.
다른 멤버가 있는 팀의 유일한 owner 면 409 `sole_owner`(owner 를 넘기거나 팀을 나간 뒤 다시).

### `PATCH /api/admin/users/{id}/status` — 운영자

본문 `{ "status": "suspended" | "active" }`. 정지하면 그 회원의 새 로그인·토큰 갱신이 막히고(`auth.users.banned_until`) 모든 세션이 끊깁니다.
자기 자신은 409 `self`, 다른 운영자는 409 `admin_target`, 없는 회원은 404.

## 예시

```bash
TOKEN=<access token>
curl -s http://localhost:3000/api/users/me -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH http://localhost:3000/api/users/me -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"displayName":"홍길동"}'
```

로컬에서 토큰을 얻는 법: `pnpm db:seed` 의 시드 계정으로 `supabase.auth.signInWithPassword` 를 부르고 `data.session.access_token` 을 씁니다([AUTH-TESTING.md](AUTH-TESTING.md)).
