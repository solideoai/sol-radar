# 인증 시험

자동 시험이 무엇을 보고, 무엇을 사람이 실제 키로 확인해야 하는지 나눠 적었습니다. **자동 시험 통과와 실제 OAuth 연동 확인은 다른 것입니다.**

## 자동 시험

2026-10-21 ADR-046으로 템플릿 회귀를 실제 삭제했습니다. 현재 범위는 [11 테스트의 현재 MVP 자동 시험](../11-TESTING.md#현재-mvp-자동-시험-adr-046-개정-2026-10-21)과 [축소 목록](../evidence/verification/20261021-pruned-tests.json)이 정본입니다. 아래 명령이 통과해도 삭제된 OAuth 콜백·계정 설정·탈퇴 등의 전수 회귀가 검증됐다고 해석하지 않습니다.

| 시험 | 명령 | 현재 범위 |
|---|---|---|
| DB 정책 | 루트 `pnpm test:db` | `scripts/database.test.mjs`의 현재 핵심 RLS·역할·조직 격리·저장 경계. 과거 인증 세부 정책 전체 목록과 다릅니다 |
| 웹 단위 | `pnpm -C web exec vitest run` | 현재 남은 핵심 계약·조직 격리 시험. 구 callback·identities·계정 설정 단위 파일은 삭제됐습니다 |
| 공개 E2E | `pnpm -C web test:e2e` | 현재 공개 화면·접근 흐름. 실행 여부와 결과는 해당 실행 기록으로 확인합니다 |
| 로그인 뒤 E2E | `pnpm -C web test:e2e:auth` | 현재 기본 인증의 `web/e2e-auth/isolation.spec.ts`·`permissions.spec.ts` 등 설정이 선택하는 시험. 로컬 Supabase가 필요하며 verify·CI 밖입니다. 삭제된 settings-account·관리자 계정 설정 회귀를 포함하지 않습니다 |

실제 OAuth 제공자 연동은 아래 수동 확인 대상입니다. 과거 콜백 단위 시험이 현재 남아 있다고 안내하지 않습니다. 아래 2026-10-15 실호출 기록도 당시 검증 이력이며 현재 자동 회귀 보장과 구분합니다.

## 로컬 Supabase 실호출 (2026-10-15 에 한 확인)

로컬 Supabase(CLI 2.120, ES256 서명)와 개발 서버에서 실제 토큰으로 확인한 것입니다. 시험 코드로 저장소에 남기지 않았습니다.

- DB: 가입 트리거, 본인의 `status`·`avatar_url` 수정 거절(42501), 운영자 아닌 사람의 정지 거절, 정지 → 토큰 갱신 실패(`refresh_token_not_found`)·새 로그인 실패(`user_banned`)·남은 토큰으로 조직이 빈 목록, 해제 → 다시 로그인, 유일한 owner 탈퇴 거절(`sole_owner`), 혼자인 팀과 함께 탈퇴, 탈퇴 뒤 토큰 갱신 실패.
- API: 토큰 없음·anon 키·service_role 키·`sub` 를 바꾼 토큰·만료 시각이 지난 토큰·JWT 가 아닌 값 → 401, 유효한 토큰 200, 다른 필드를 섞은 PATCH 는 표시 이름만 바뀜, 잘못된 본문 400,
  마지막 로그인 수단 409, 남의 로그인 수단 404, 두 번째 로그인 수단(DB 에 직접 넣은 구글) 해제 204, 일반 회원의 관리자 API 403, 운영자 정지 → 그 회원의 남은 토큰 403·갱신 실패, 해제 뒤 200,
  모든 기기 로그아웃 → 두 기기의 refresh token 모두 무효, 탈퇴 204 → 남은 토큰 401·계정 삭제·갱신 실패.
- 네이버: `custom:naver` 를 가짜 Client ID 로 OIDC 등록 → `/auth/v1/authorize?provider=custom:naver` 가 `https://nid.naver.com/oauth2/authorize` 로 PKCE(S256)·state·`scope=openid profile` 을 붙여 보냄.
- 화면(1280px): `?next=` 로그인, 로그인 수단 목록·연결 시작 실패 안내·돌아온 실패 안내(초점·주소 정리)·해제 대화상자, 운영자 정지 대화상자·상태 열, 정지된 계정의 로그인 거절 문구, 탈퇴(틀린 확인 낱말·성공 뒤 쿠키 삭제).

만료 시각이 지난 토큰은 서명이 맞는 진짜 만료 토큰이 아니라 `exp` 를 고친 토큰입니다(서명 키가 없어 만들 수 없음). 진짜 만료는 `getClaims`의 만료 검사가 맡습니다. 당시 단위 시험 결과는 이력이며 현재 자동 범위는 위 MVP 목록을 따릅니다.

## 실제 OAuth 수동 확인

실제 Client ID·Secret 이 있는 Supabase 프로젝트(클라우드 권장)에서 사람이 합니다. 제공자 설정은 [OAUTH-PROVIDERS.md](OAUTH-PROVIDERS.md).
결과는 이 표에 날짜와 함께 적습니다. **아래 항목은 아직 아무것도 확인하지 않았습니다.**

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| 1 | 구글 신규 가입 | 대시보드로 감, 프로필 이름·사진이 구글 것, `auth.identities` 에 `google` 한 줄 | 미확인 |
| 2 | 구글 재로그인 | 같은 user_id, 새 회원이 생기지 않음 | 미확인 |
| 3 | 카카오 신규 가입 | 위와 같음. 비즈 앱이 아니면 이메일 없음 → 마이페이지 이메일 "없음" | 미확인 |
| 4 | 카카오 재로그인 | 같은 user_id | 미확인 |
| 5 | 네이버 신규 가입 | 대시보드로 감, `provider = 'custom:naver'`·`provider_id` 가 비어 있지 않음 | 미확인 |
| 6 | 네이버 재로그인 | 같은 user_id | 미확인 |
| 7 | 이메일을 주지 않는 사용자 | 가입되고, 마이페이지 이메일 "없음", 초대 화면이 "이메일이 없는 계정" 안내 | 미확인 |
| 8 | 같은 계정 두 브라우저 동시 로그인 | 둘 다 로그인됨. 한쪽 "이 기기에서 로그아웃" 은 다른 쪽에 영향 없음, "모든 기기에서 로그아웃" 은 다른 쪽도 1시간 안에 끊김 | 미확인 |
| 9 | 제공자 동의 화면에서 취소 | `/auth/login` 에 "간편 로그인을 마치지 못했습니다" | 미확인 |
| 10 | 잘못된 콜백 (`/auth/callback?code=garbage`, 다른 브라우저에서 연 콜백) | 실패 안내, 로그인되지 않음 | 미확인 |
| 11 | 연결: 이메일 계정에 구글 연결 → 해제 | 목록에 구글이 생기고 "로그인 수단을 연결했습니다", 해제 뒤 사라짐 | 미확인 |
| 12 | 연결: 다른 회원이 쓰는 구글 계정 | 마이페이지에 "이미 다른 회원의 로그인 수단" 안내 | 미확인 |
| 13 | 같은 이메일의 이메일 가입자가 같은 이메일의 구글로 로그인 | Supabase 자동 연결 규칙대로(확인된 이메일이면 같은 회원). 결과를 적는다 | 미확인 |
| 14 | 정지된 회원이 간편 로그인 | `/auth/login` 에 정지 안내 | 미확인 |

확인 방법:

```sql
select u.id, u.email, i.provider, i.provider_id, i.identity_data ->> 'email' as provider_email
from auth.users u join auth.identities i on i.user_id = u.id
order by u.created_at desc limit 20;

select id, email, display_name, avatar_url, status from public.profiles order by created_at desc limit 20;
```

실패하면 Supabase 대시보드 → Logs → Auth 에서 그 시각의 오류를 봅니다. 네이버는 [OAUTH-PROVIDERS.md 의 수동 확인](OAUTH-PROVIDERS.md#수동-확인-실제-키)을 먼저 봅니다.

## 다시 돌리기

```bash
pnpm db:start            # 로컬 Supabase (Docker)
pnpm db:seed             # 시드 계정(비밀번호 seed-password-1234)
pnpm -C web dev
pnpm test:db             # DB 정책
pnpm -C web exec vitest run
pnpm -C web test:e2e:auth
```

API 를 손으로 부를 토큰은 시드 계정으로 받습니다(로컬 전용):

```js
const { data } = await supabase.auth.signInWithPassword({
  email: "seed-owner@example.test",
  password: "seed-password-1234",
});
// data.session.access_token 을 Authorization: Bearer 로 보낸다
```
