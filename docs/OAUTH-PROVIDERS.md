# 간편 로그인 제공자 — 구글·카카오·네이버

제공자마다 콘솔에서 앱을 만들고, Supabase 에 Client ID·Secret 을 넣고, 웹에서 버튼을 켭니다. 비밀값은 웹에 두지 않습니다.
Supabase 쪽 공통 설정(Site URL·manual linking)은 [SUPABASE-SETUP.md](SUPABASE-SETUP.md) 에 있습니다.

## 공통

| | 값 |
|---|---|
| 제공자 콘솔에 넣을 콜백(Redirect URI) | 클라우드 `https://<ref>.supabase.co/auth/v1/callback` · 로컬 `http://127.0.0.1:54321/auth/v1/callback` |
| 웹의 돌아오는 주소 | `https://<사이트>/auth/callback` (Supabase 가 여기로 보낸다. Site URL 과 같은 호스트면 허용 목록에 적지 않아도 된다) |
| 버튼 켜기 | `web/.env.local` 에 `NEXT_PUBLIC_AUTH_GOOGLE=true`·`NEXT_PUBLIC_AUTH_KAKAO=true`·`NEXT_PUBLIC_AUTH_NAVER=true` → 다시 빌드 |
| 버튼 모양 | 각 회사 버튼 가이드(`web/app/auth/social-sign-in.tsx` 주석) |

**설정하지 않은 제공자의 버튼은 켜지 않습니다.** 켜고 누르면 Supabase 가 자기 주소에서 오류(`provider is not enabled`)를 보이고 사이트로 돌아오지 않습니다.
꺼 둔 제공자는 버튼과 마이페이지의 연결 버튼만 없고 다른 기능은 그대로입니다.

로컬 Supabase 에서 구글·카카오를 켜려면 `supabase/config.toml` 의 `[auth.external.google]`·`[auth.external.kakao]` 주석을 풀고
`supabase/.env`(깃 제외)에 아래 값을 적은 뒤 `pnpm db:stop` → `pnpm db:start` 합니다.

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET=
```

## 구글

Supabase 기본 제공자 `google`.

1. [Google Cloud Console](https://console.cloud.google.com/) → API 및 서비스 → **OAuth 동의 화면**: 앱 이름·지원 이메일, 범위 `openid`·`email`·`profile`. 운영 전에 게시(Publish)한다.
2. 사용자 인증 정보 → **OAuth 클라이언트 ID 만들기** → 웹 애플리케이션.
   - 승인된 JavaScript 원본: `https://<사이트>`(로컬 `http://localhost:3000`)
   - 승인된 리디렉션 URI: 위 "공통"의 Supabase 콜백
3. Supabase 대시보드 → Authentication → Sign In / Providers → **Google** → 켜고 Client ID·Client Secret 을 넣는다.
4. `NEXT_PUBLIC_AUTH_GOOGLE=true`.

구글은 확인된 이메일·이름(`full_name`)·사진(`avatar_url`)을 줍니다. 가입 트리거가 표시 이름과 이미지로 씁니다.

## 카카오

Supabase 기본 제공자 `kakao`.

1. [Kakao Developers](https://developers.kakao.com/) → 내 애플리케이션 → 애플리케이션 추가.
2. 앱 설정 → 앱 키의 **REST API 키**가 Client ID 다.
3. 제품 설정 → 카카오 로그인 → **활성화**, Redirect URI 에 위 Supabase 콜백을 넣는다.
4. 카카오 로그인 → 보안 → **Client Secret** 을 만들고 "사용함"으로 둔다. 이 값이 Secret 이다.
5. 카카오 로그인 → 동의 항목: `profile_nickname`(닉네임)·`profile_image`(프로필 사진)를 켠다.
   이메일(`account_email`)은 비즈 앱(사업자 정보 등록)이어야 필수·선택 동의로 받을 수 있다.
6. Supabase 대시보드 → Providers → **Kakao** → 켜고 REST API 키·Client Secret 을 넣는다.
   이메일을 받지 않으면 같은 화면의 **Allow users without an email** 을 켠다(끄면 이메일 없는 사람의 가입이 실패한다).
7. `NEXT_PUBLIC_AUTH_KAKAO=true`.

이메일이 없는 카카오 회원은 프로필 이메일이 비고(화면은 "이메일 없음"), 같은 이메일 자동 연결도 일어나지 않습니다. 표시 이름은 카카오 닉네임으로 채워집니다.

## 네이버

Supabase 에 기본 제공자가 없어 **사용자 정의 제공자 `custom:naver`** 로 등록합니다. 방식은 **OIDC(자동 발견)** 입니다. OAuth2(수동 주소 입력)로 등록하지 않습니다.

### 왜 OIDC 인가 (검증 결과)

| 확인한 것 | 결과 |
|---|---|
| Supabase 의 OAuth2 사용자 정의 제공자가 사용자 id 를 읽는 법 | UserInfo 응답의 **맨 위** `sub` 만 읽는다. 속성 매핑(attribute_mapping)도 맨 위 키끼리만 옮긴다(Supabase Auth 소스 `internal/api/provider/custom_oauth.go` 의 `applyAttributeMapping`) |
| 네이버 UserInfo(`https://openapi.naver.com/v1/nid/me`) 응답 | `{ "resultcode", "message", "response": { "id", "email", "nickname", "profile_image", … } }` — id 가 `response` 안에 한 겹 들어 있다 |
| 그래서 OAuth2 로 등록하면 | `sub` 가 비어 Supabase 가 `error missing provider id` 로 로그인을 거절한다(`internal/models/identity.go` 의 `NewIdentity`). 다른 사람과 계정이 섞이지는 않는다 |
| 네이버의 OIDC 지원 | `https://nid.naver.com/.well-known/openid-configuration` 이 있다: issuer `https://nid.naver.com`, PKCE `S256`, ID 토큰 `RS256`, scope `openid`·`profile`, 토큰 인증 `client_secret_post` |
| 로컬 Supabase(CLI 2.120)에 OIDC 로 등록 | 디스커버리를 받아 등록되고, `/auth/v1/authorize?provider=custom:naver` 가 `https://nid.naver.com/oauth2/authorize` 로 `code_challenge_method=S256`·`state`·`scope=openid profile` 을 붙여 보낸다(가짜 Client ID 로 확인) |
| **확인하지 못한 것** | 실제 키로 하는 토큰 교환과 ID 토큰의 클레임(이메일·이름이 들어 있는지, nonce). 아래 "수동 확인" |

ID 토큰에는 `sub`(앱마다 다른 값, pairwise)만 있고 이메일·이름이 없을 수 있습니다. 그래서 **email optional 을 켭니다.**
그러면 네이버 회원은 이메일·표시 이름이 빈 채로 가입되고, 마이페이지에서 표시 이름을 정합니다. 같은 이메일 자동 연결도 일어나지 않습니다.

### 설정

1. [네이버 개발자 센터](https://developers.naver.com/apps/) → Application → 애플리케이션 등록.
   - 사용 API: **네이버 로그인**. 제공 정보: 회원이름·이메일·별명·프로필 사진 중 필요한 것.
   - 서비스 환경: PC 웹, 서비스 URL `https://<사이트>`, **Callback URL** 에 위 Supabase 콜백.
2. 애플리케이션 정보의 **Client ID**·**Client Secret** 을 받는다. 검수 전에는 등록한 멤버만 로그인된다(멤버 관리 메뉴).
3. Supabase 대시보드 → Authentication → Sign In / Providers → **New Provider** → **Auto-discovery (OIDC)**:

   | 칸 | 값 |
   |---|---|
   | Identifier | `custom:naver` (웹 버튼이 이 이름을 부른다 — `web/lib/auth-providers.ts`) |
   | Name | 네이버 |
   | Issuer | `https://nid.naver.com` |
   | Client ID·Secret | 2 의 값 |
   | Scopes | `openid profile` |
   | Email optional | 켠다 |
   | PKCE | 켠 채로 둔다(기본값) |

   폼에 보이는 Callback URL 이 1 에 넣은 주소와 같은지 본다.
4. `NEXT_PUBLIC_AUTH_NAVER=true`.

대시보드 대신 관리 API 로 만들 수도 있습니다(서버에서, service_role 키로 — 이 저장소 코드에는 넣지 않았습니다):

```js
await supabase.auth.admin.customProviders.createProvider({
  provider_type: "oidc",
  identifier: "custom:naver",
  name: "네이버",
  client_id: "<Client ID>",
  client_secret: "<Client Secret>",
  issuer: "https://nid.naver.com",
  scopes: ["openid", "profile"],
  email_optional: true,
});
```

로컬 Supabase 에는 `config.toml` 자리가 없어 위 관리 API 를 로컬 주소·로컬 service_role 키(`supabase status`)로 부릅니다. 무료 요금제는 사용자 정의 제공자를 3개까지 둡니다.

### 수동 확인 (실제 키)

1. 네이버 버튼으로 로그인 → 사이트로 돌아와 대시보드가 보이는가.
2. Studio(로컬 `http://127.0.0.1:54323`) 또는 대시보드 SQL 편집기에서:
   ```sql
   select provider, provider_id, identity_data from auth.identities where provider = 'custom:naver';
   select email, display_name, avatar_url from public.profiles where id = '<그 user_id>';
   ```
   `provider_id` 가 비어 있지 않은지, `identity_data` 에 email·name·picture 가 오는지 본다.
3. 로그아웃 뒤 다시 로그인 → 같은 user_id 인가(재로그인이 새 가입이 되지 않는가).
4. 실패하면 Supabase 대시보드 → Logs → Auth 에서 오류를 본다.
   - `nonce` 관련 오류면 제공자 설정에서 **Skip nonce check** 를 켠다.
   - 토큰 교환 오류면 Client Secret 과 Callback URL 을 다시 본다.
   - 그래도 맞지 않으면 네이버를 끈 채(`NEXT_PUBLIC_AUTH_NAVER` 없음) 둔다. 서버에서 네이버 OAuth 를 직접 처리하는 대안은 [AUTH-SECURITY.md](AUTH-SECURITY.md#네이버-대안) 에 적었다.

확인한 결과(이메일·이름이 오는지)는 이 문서와 스펙(`polaris/specs/done/social-auth-and-account.md` 의 미결정 사항)에 적습니다.

## 계정 연결 (마이페이지)

켜 둔 제공자는 마이페이지(`/<조직>/settings`)의 "로그인 수단"에 연결 버튼으로도 나옵니다. Supabase 의 **Allow manual linking** 이 켜져 있어야 합니다.
이미 다른 회원이 쓰는 제공자 계정은 연결되지 않고(`identity_already_exists`), 마지막 로그인 수단은 해제되지 않습니다.
