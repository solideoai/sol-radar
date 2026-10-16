# 인증 보안

요청서의 보안 항목마다 무엇이 지키는지 적었습니다. Supabase 가 이미 하는 일은 다시 만들지 않았습니다.

| 항목 | 지키는 것 | 자리 |
|---|---|---|
| OAuth state | Supabase Auth 가 만들고 콜백에서 확인한다 | Supabase |
| PKCE | 브라우저↔Supabase(`@supabase/ssr` 의 PKCE 흐름, verifier 는 이 브라우저의 쿠키), Supabase↔제공자(네이버 OIDC 는 `pkce_enabled`) | `web/app/auth/social-sign-in.tsx`·`/auth/callback` |
| Redirect URL 검증 | Supabase 가 Site URL·Redirect URLs 허용 목록 밖으로는 보내지 않는다 | 대시보드 |
| Open Redirect | `next` 는 사이트 안 경로만(`safeNextPath`: `//`·`/\`·탭·줄바꿈·`javascript:` 거절) | `web/server/auth/auth.model.ts` |
| JWT 서명·클레임 | `getClaims` 가 JWKS 로 서명·만료를 보고, 서버가 `iss`·`aud`·`role`·`sub` 를 본다 | `web/server/supabase/client.ts`·`claims.ts` |
| 쿠키 | 아래 "쿠키" | `web/server/shared/auth-cookie.ts` |
| CSRF | 서버 함수는 Next 가 Origin 을 확인한다. `/api/*` 는 쿠키로 로그인되지 않는다(Bearer 만) | `web/app/api/_lib/http.ts` |
| CORS | 다른 출처의 브라우저 호출을 열지 않았다(헤더를 두지 않는다 = 기본 차단) | |
| CSP | 요청마다 새 nonce 를 가진 스크립트만 실행된다. 아래 "CSP" | `web/proxy.ts`·`web/server/csp/` |
| 요청 수 제한 | 아래 "요청 수 제한" | Supabase·배포 플랫폼 |
| service_role 키 | 인증·회원 기능은 쓰지 않는다. 정지·탈퇴도 DB 함수가 그 사람의 토큰으로 한다 | |
| 권한 상승 | `is_admin`·`status`·`avatar_url`·`email` 열은 화면 역할에 쓰기 권한이 없고, `is_admin`·`status` 는 트리거가 한 번 더 되돌린다 | 마이그레이션 |
| 계정 연결 소유권 | 연결은 지금 로그인한 사람에게만, 그 제공자에 실제로 로그인해야 붙는다. 남의 계정이면 `identity_already_exists` | Supabase |
| 마지막 로그인 수단 | 도메인과 Supabase 가 모두 거절한다 | `web/server/auth/auth.service.ts` |
| 계정 삭제 시 세션 | `auth.users` 삭제가 세션·refresh token 을 연쇄로 지운다. 남은 access token 은 프로필이 없어 401 | 마이그레이션 |
| 정지 시 세션 | 세션 삭제 + `banned_until`. 남은 access token 은 서버 403, 정책 도우미가 조직 데이터를 닫는다 | 마이그레이션 |
| 민감 정보 로그 | 토큰·키·쿠키를 로그에 쓰지 않는다. 오류 메시지에 토큰을 넣지 않는다. 서버 오류 기록은 쿠키·인증 헤더·요청 본문·검색어를 남기지 않는다 | `web/server/shared/error-report.ts` |

## 신뢰하는 값

- 요청자 id: 검증된 토큰의 `sub` 뿐. 화면·API 본문·경로의 userId 는 "누구인가"로 쓰지 않는다(관리자 API 의 경로 id 는 "누구를"이다).
- 역할·상태: 요청마다 DB 에서 읽는다. 토큰의 `app_metadata`·`user_metadata` 는 쓰지 않는다(`user_metadata` 는 본인이 바꿀 수 있다).
- 운영자 판정은 세 겹이다: API 문지기(`requireAdmin`), 도메인(`getAdminAccess`), DB(`admin_set_user_status` 안의 `is_admin()`·RLS 정책).

## 쿠키

`@supabase/ssr` 의 쿠키(`sb-<ref>-auth-token`, 길면 `.0`·`.1` 로 나뉜다):

| 속성 | 값 | 이유 |
|---|---|---|
| `SameSite` | `Lax` | 다른 사이트의 POST·fetch 에 쿠키가 실리지 않는다. 링크로 들어오는 GET 은 로그인된 채 열린다 |
| `Secure` | 운영 빌드에서 켬 | https 로만 오간다. 개발 서버(http)는 끈다 — 사파리가 http 의 Secure 쿠키를 받지 않는다 |
| `HttpOnly` | 끔 | 브라우저 클라이언트가 같은 세션으로 로그인·로그아웃·연결(linkIdentity)을 하려면 읽어야 한다(Supabase SSR 의 설계). XSS 가 나면 토큰이 읽히므로 화면에 `dangerouslySetInnerHTML` 을 쓰지 않고, 끼워 넣은 스크립트는 CSP(아래)가 막는다 |
| `Path`·`Max-Age` | `/`·400일 | 세션 수명은 쿠키가 아니라 Supabase 의 refresh token 이 정한다 |

로컬에서 운영 빌드(`pnpm build && pnpm start`)를 http 로 열면 사파리는 로그인이 유지되지 않습니다. 크롬·파이어폭스는 `localhost` 를 안전한 출처로 봐 동작합니다.

## CSP

`web/proxy.ts` 가 화면 요청마다 새 nonce 를 만들고, `web/server/csp/csp.model.ts` 의 `buildContentSecurityPolicy` 로 정책을 만들어
**요청 헤더**(Next 가 거기서 nonce 를 꺼내 자기 스크립트에 붙인다, `x-nonce` 도 함께)와 **응답 헤더** `Content-Security-Policy` 에 싣는다.
근거는 `web/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` 다.

| 지시어 | 값 | 이유 |
|---|---|---|
| `script-src` | `'self' 'nonce-…' 'strict-dynamic' https://t1.kakaocdn.net` (개발만 `'unsafe-eval'`) | nonce 를 가진 스크립트와 그 스크립트가 넣은 스크립트만 실행된다. 카카오 출처는 `'strict-dynamic'` 을 모르는 옛 브라우저용이다. React 는 개발 모드에서만 eval 로 서버 오류의 호출 스택을 다시 만든다 |
| `style-src` | `'self' 'unsafe-inline'` | 알림(sonner)이 nonce 없는 `<style>` 을 넣고, 서버가 그린 HTML 에 `style="…"` 속성(사이드바 폭·막대그래프 높이)이 있다. 속성은 nonce 로 열 수 없다. nonce 를 같이 적으면 브라우저가 `'unsafe-inline'` 을 무시하므로 적지 않는다. 스타일은 스크립트를 실행하지 못한다 |
| `img-src` | `'self' blob: data:` + `https://*.googleusercontent.com`·`https://*.kakaocdn.net`·`https://*.pstatic.net` | 간편 로그인 제공자의 프로필 사진. 이메일 가입은 가입 정보에 아무 https 주소나 넣을 수 있어, 목록 밖의 사진은 막고 이름 첫 글자를 그린다 |
| `connect-src` | `'self'` + `NEXT_PUBLIC_SUPABASE_URL` 의 출처 | 브라우저가 로그인·데이터를 Supabase 에 직접 요청한다. Realtime 을 쓰기 시작하면 `wss://` 출처를 더한다 |
| `frame-src` | `postcode.map.kakao.com` | 가입 화면 주소 검색의 검색 창. 카카오 스크립트가 화면의 scheme 을 따라 http·https 를 골라서 scheme 을 적지 않는다(https 화면에서는 https 만 맞는다) |
| `default-src`·`font-src` | `'self'` | 글꼴(Pretendard)은 빌드에 묶여 같은 출처에서 온다 |
| `object-src`·`base-uri`·`form-action`·`frame-ancestors` | `'none'`·`'self'`·`'self'`·`'none'` | 플러그인·`<base>` 바꿔치기·다른 곳으로 폼 보내기·다른 사이트의 iframe 을 막는다 |

- **모든 화면이 동적 렌더링이다.** 빌드 때 미리 그린 HTML 에는 nonce 가 없어 스크립트가 막힌다. 그래서 루트 `web/app/layout.tsx` 가 `connection()` 을 부르고,
  랜딩(`/`)·404 도 요청마다 그린다(`next build` 의 표에서 모두 `ƒ`). 정적 화면을 다시 만들면 그 화면은 운영에서 동작하지 않는다.
  예외는 Next 가 빌드 때 만드는 비상용 500 화면(`_global-error`)이다. 루트 layout 밖에서 렌더링 자체가 실패할 때만 나오고, 글은 보이지만 "다시 시도" 버튼은 동작하지 않는다.
- **proxy 가 거치지 않는 응답에는 CSP 가 없다**: `/api/*`(JSON, Bearer 로그인)·`_next/static`·`_next/image`·이미지 파일. 이들에도 `web/next.config.ts` 의 보안 헤더(`X-Frame-Options: DENY` 등)는 붙는다.
- Next 문서가 권하는 "prefetch 요청은 proxy 에서 빼기"는 따르지 않는다. 이 proxy 는 로그인 토큰도 갱신하는데, prefetch 도 서버 렌더라 빼면 서버 컴포넌트가 갱신한 토큰을 쿠키에 쓰지 못해 다음 요청에서 로그아웃될 수 있다.
- `upgrade-insecure-requests` 는 두지 않는다. 운영에서 여는 출처가 모두 https 라 바꿀 주소가 없고(프로필 사진도 DB 제약이 https 만 받는다),
  넣으면 http 로 여는 로컬 운영 빌드에서 http 주소(로컬 Supabase)로 가는 요청을 브라우저가 https 로 바꿔 실패할 수 있다.
- 바깥 출처(분석 도구·지도 등)를 더하면 `buildContentSecurityPolicy` 한 곳을 고치고, 운영 빌드를 브라우저로 열어 콘솔의 CSP 위반(`Refused to …`·`violates the following Content Security Policy directive`)이 0건인지 본다.
  `next/script` 로 넣는 스크립트는 서버 컴포넌트에서 `(await headers()).get("x-nonce")` 를 `nonce` 로 넘긴다.
- 위반 보고(`report-to`)는 받지 않는다(스펙의 비목표).

## 초대 메일

- SMTP 접속 정보·보내는 주소·사이트 주소(`SMTP_*`·`MAIL_FROM`·`SITE_URL`)는 서버 전용 변수입니다. 하나라도 없으면 보내지 않고 초대만 저장합니다.
- 보낼 수 있는 사람은 팀의 owner 뿐입니다(초대 insert 정책). 메일을 보내지 못해도 초대는 되돌리지 않고, 화면이 "직접 알려 주세요"라고 안내합니다.
- 조직 이름·표시 이름은 HTML 이스케이프하고, 줄바꿈·제어 문자는 공백으로 바꿔 메일 머리글이 끼어들지 못하게 합니다. 링크는 `SITE_URL` 로만 만들고 요청 헤더(Host)를 믿지 않습니다.
- SMTP 로그인을 쓰면 TLS 를 강제합니다(`requireTLS`). 암호화하지 못하면 비밀번호를 평문으로 보내지 않고 실패합니다.
- 실패 로그에는 오류 이름·코드·SMTP 응답 번호만 남깁니다. 받는 사람 주소가 든 오류 문장은 남기지 않습니다.
- owner 한 명이 보내는 양을 코드로 세지 않습니다. 발송 업체의 한도와 아래 요청 수 제한을 씁니다.

## 요청 수 제한

- 로그인·가입·토큰 갱신·OAuth·메일 요청은 **Supabase Auth 의 제한**을 씁니다(대시보드 → Authentication → Rate Limits). 코드에 다시 두지 않았습니다.
- `/api/*` 에는 코드 안 제한기를 두지 않았습니다. 서버리스(Vercel)에서 메모리 제한기는 인스턴스마다 따로 세어 실제로 막지 못합니다.
  필요하면 배포 플랫폼의 방화벽 규칙(Vercel Firewall → Rate Limiting, 예: `/api/` 경로·IP 당 분당 60회)을 겁니다. 한 대짜리 서버(Docker 등)로 옮기면 그때 코드 제한기를 검토합니다.

## 사용자 지정 도메인

Supabase 에 사용자 지정 도메인(예: `auth.example.com`)을 붙이면 토큰의 `iss` 가 그 도메인입니다. `NEXT_PUBLIC_SUPABASE_URL` 도 그 도메인으로 바꿔야 서버가 토큰을 받습니다(아니면 모든 API 가 401).

## 이메일 자동 연결

Supabase Auth 는 **확인된** 같은 이메일의 로그인 수단을 한 회원으로 자동 연결합니다(Supabase Auth 의 기본 동작이고 대시보드에 끄는 설정이 없습니다 — 소스 `internal/models/linking.go`). 확인되지 않았거나 이메일이 없으면 연결하지 않고 새 회원을 만듭니다.
이 저장소는 이메일로 계정을 합치는 코드를 두지 않습니다. 실제 동작은 [AUTH-TESTING.md](AUTH-TESTING.md) 의 수동 확인 13번에서 봅니다.

## 네이버 대안

네이버 OIDC 등록이 실제 키로 맞지 않으면, 안전한 대안은 둘입니다. 둘 다 지금은 만들지 않았습니다.

1. **네이버를 끈다** — `NEXT_PUBLIC_AUTH_NAVER` 를 두지 않는다. 다른 기능은 그대로다(가장 작은 변경).
2. **서버 어댑터 + Supabase 의 ID 토큰 로그인** — 서버가 네이버 OAuth 를 직접 처리하고(state·PKCE 확인), 네이버의 ID 토큰을
   `supabase.auth.signInWithIdToken({ provider: "custom:naver", token })` 로 Supabase 세션으로 바꾼다. 사용자 식별·세션은 여전히 Supabase 가 맡는다.
   Supabase 가 사용자 정의 OIDC 제공자의 ID 토큰 로그인을 받는지 먼저 확인해야 한다.

하지 않는 것: 서버가 직접 JWT 를 만들기, service_role 키로 사용자를 만들고 비밀번호·매직 링크로 로그인시키기(Supabase 밖의 두 번째 인증 체계가 된다).
