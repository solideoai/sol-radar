# Supabase 설정 — 인증

새 프로젝트에서 인증을 켜는 순서입니다. 환경 변수 파일 세 개의 전체 표와 DB 일반 설정은 [database.md](database.md),
제공자 콘솔(구글·카카오·네이버) 설정은 [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md) 에 있습니다.

## 순서

1. Supabase 프로젝트를 만든다(supabase.com → New project).
2. 환경 변수를 넣는다(아래 "환경 변수").
3. 마이그레이션을 적용한다: 루트에서 `pnpm db:push`(운영 DB 를 바꾸므로 확인 뒤에). 로컬은 `pnpm db:start` 가 적용한다.
4. 대시보드 설정을 한다(아래 "대시보드").
5. 제공자를 설정하고([OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md)) 켠 제공자의 `NEXT_PUBLIC_AUTH_*=true` 를 넣는다.
6. 웹을 다시 빌드·실행한다(`NEXT_PUBLIC_` 값은 빌드 때 박힌다).
7. 첫 운영자를 SQL 편집기에서 지정한다(아래).

## 환경 변수

웹(`web/.env.local`)에 필요한 것은 둘뿐입니다. 비밀값이 없어도 로그인·회원 관리가 모두 동작합니다.

| 이름 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) | 서버가 토큰의 발급자(iss)를 이 주소 + `/auth/v1` 로 확인한다 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키 또는 publishable 키(`sb_publishable_…`) | 브라우저에 나가도 되는 키. 권한은 RLS 가 정한다 |
| `NEXT_PUBLIC_AUTH_GOOGLE`·`_KAKAO`·`_NAVER` | `true` | 그 제공자를 Supabase 에 설정한 뒤에만. 없으면 그 버튼만 없다 |
| `SUPABASE_SERVICE_ROLE_KEY` | (선택) service_role 키 | 인증 기능은 쓰지 않는다. 넣는다면 접두어 없이, 서버 전용 |

요청서에 적힌 이름과의 대응:

| 요청서 | 이 저장소 |
|---|---|
| publishable 키 변수 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` 자리에 publishable 키를 넣는다(이름은 그대로 — `pnpm db:start`·문서가 이 이름을 쓴다) |
| 서버용 Supabase 주소·secret 키 | 쓰지 않는다. 서버도 공개 주소와 그 사람의 토큰으로 부르고, 관리 키가 필요한 기능이 없다 |
| 제공자별 사용 여부(`AUTH_*_ENABLED`) | `NEXT_PUBLIC_AUTH_*` — 버튼을 그리는 화면이 읽어야 해서 공개 값이다 |
| 앱 주소·API 주소 | 쓰지 않는다. API 는 같은 사이트의 `/api/*`, 돌아올 주소는 브라우저의 `window.location.origin` 이다 |

제공자의 Client ID·Secret 은 웹이 아니라 **Supabase 대시보드**에 둡니다. 로컬 Supabase 는 `supabase/.env`(깃 제외)에 둡니다([OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md)).

## 대시보드

| 메뉴 | 설정 | 왜 |
|---|---|---|
| Authentication → URL Configuration → **Site URL** | 운영 주소(`https://<도메인>`) | 메일 링크가 돌아올 주소. 이 호스트의 `/auth/callback` 은 따로 적지 않아도 허용된다 |
| 같은 곳 → **Redirect URLs** | 다른 호스트를 쓸 때만: `https://<다른 호스트>/auth/callback`(미리보기 배포면 `https://*-<팀>.vercel.app/**`) | 허용 목록에 없는 주소로는 돌려보내지 않는다(open redirect 방지) |
| Authentication → Sign In / Providers → **Allow manual linking** | 켠다 | 마이페이지의 "연결하기"(linkIdentity). 끄면 `manual_linking_disabled` 로 거절되고 화면이 안내한다 |
| 같은 곳 → 각 제공자 | [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md) | |
| Authentication → Email Templates | `supabase/templates/` 의 내용 | 메일 링크가 `/auth/confirm` 으로 오게 한다([database.md](database.md)) |
| Authentication → Rate Limits | 기본값 유지 또는 조정 | 로그인·토큰 갱신·메일 요청 수 제한. 코드에 따로 두지 않았다([AUTH-SECURITY.md](AUTH-SECURITY.md#요청-수-제한)) |
| Project Settings → JWT Keys | 비대칭 키(ECC P-256 등)를 권장 | 서버가 Auth 에 묻지 않고 JWKS 로 서명을 확인한다. 옛 HS256 이면 요청마다 Auth 서버에 확인한다 |
| Authentication → Sessions(유료 요금제) | 필요하면 세션 수명·비활동 시간 | |

로컬 Supabase 는 `supabase/config.toml` 이 같은 값을 갖고 있습니다(`site_url`, `enable_manual_linking = true`). 로컬은 ES256 키로 서명합니다.

## 첫 운영자

운영자 여부는 데이터라서 마이그레이션에 없습니다. SQL 편집기에서 지정합니다(화면 역할은 바꾸지 못합니다):

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = '<운영자 이메일>');
```

운영자는 `/admin` 에서 회원 목록을 보고 정지·해제합니다. 다른 운영자는 정지하지 못합니다 — 먼저 위 문장으로 `is_admin = false` 로 내립니다.

## 마이그레이션에 든 것

`supabase/migrations/20261015000001_account_status_and_deletion.sql`

- `profiles.avatar_url`·`status`(`active`·`suspended`)·`updated_at`
- 가입 트리거가 제공자의 이름·이미지로 프로필을 채운다(이미 가입한 사람도 빈 칸만 채운다)
- `admin_set_user_status(target, next_status)` — 운영자 전용 정지·해제
- `delete_my_account()` — 본인 탈퇴(즉시 삭제)
- 정지된 사람에게 정책 도우미(`my_org_ids`·`my_owner_org_ids`·`is_admin`)가 닫힌다

## 다른 Supabase 프로젝트로 옮기기

환경 변수 두 개(`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`)와 루트 `.env.local` 의 `SUPABASE_DB_URL` 을 바꾸고,
새 프로젝트에 `pnpm db:push` → 위 대시보드 설정 → 제공자 설정을 다시 합니다. 코드는 바꾸지 않습니다.
