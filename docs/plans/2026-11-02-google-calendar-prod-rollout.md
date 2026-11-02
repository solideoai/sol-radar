---
title: "구글 캘린더 연동 운영 반영 계획 (발표 뒤로 연기)"
doc: "plan-google-calendar-prod-rollout"
status: draft
tags:
  - sol-radar
  - ops
  - hackathon
created: 2026-11-02
updated: 2026-11-02
---

# 구글 캘린더 연동 운영 반영 계획 (발표 뒤로 연기)

[[16-DECISIONS|ADR-073]] 3번 구글 캘린더 연동의 운영 반영을 언제, 어떤 순서로 할지 적는다. 코드와 설계는 스펙 `polaris/specs/planned/2026-10-30-google-calendar-sync.md`가 정본이다.

## 결정

> [!todo] 운영 반영은 발표(2026-11-04) 뒤
> 사용자 결정(2026-11-02, 마스터 세션이 전달): "일단 구글 캘린더는 미룰게. 문서로 정리해놔"

- 미루는 것: Vercel Production 구글 env 3개 추가와 재배포, 운영 DB 마이그레이션 `20261030002000_google_calendar_links.sql` 적용(`pnpm db:push`), 실제 구글 계정 왕복 확인(로컬·운영).
- 그대로 두는 것: 운영에 나가 있는 코드. 구글 env가 없으면 연동 버튼과 설정 칸이 숨도록 이미 짜여 있어 되돌리지 않는다. 일정별 "구글 캘린더에 추가" 링크는 운영에서 지금도 동작한다.
- 화면 동결(2026-11-03) 전에는 위 항목을 하지 않는다. 발표의 녹화 클립에는 `/calendar`가 없고 질의응답 라이브에서만 연다([[18-HACKATHON|18 해커톤]] §6).

## 지금 운영 상태 (2026-11-02 기록)

| 항목 | 상태 | 근거 |
|---|---|---|
| 코드 | 2026-11-01 16:50 KST부터 운영 배포. 병합 `652741e2`를 처음 담은 push는 `8e03d793`(origin/main reflog 16:50:03), Vercel production `dpl_9YFJsQzDfRVBDKsL9DdWBR7DQyEo` READY. 운영 `/calendar`에 `.ics` 버튼과 `GET /api/v1/calendar/ics`가 없다 | git reflog, Vercel 배포 목록(2026-11-01 읽기) |
| 운영 DB | 구글 표 없음. 마지막 migration `20261030001100`, `to_regclass('public.google_calendar_links')` null. 저장소의 74번째 파일 `20261030002000`만 남았다 | 마스터 세션 운영 읽기(2026-11-01) |
| Vercel Production env | `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`·`GOOGLE_TOKEN_ENC_KEY` 없음 | 마스터 세션이 이름만 조회(값은 보지 않음) |
| 구글 로그인 | Production에 `NEXT_PUBLIC_AUTH_GOOGLE`이 있다(값 미확인). 운영 로그인 화면에 "구글 계정으로 로그인" 버튼이 있고, 사용자 운영 계정의 로그인 수단에 구글이 연결돼 있다. 그래서 운영 Supabase Google 제공자는 켜져 있다고 본다(추론) | 마스터 세션 확인(curl), 사용자 보고(2026-11-01) |

화면과 주소별 동작은 아래와 같다. 줄 번호는 `ae79640f` 기준이다.

- **설정 개인 탭**: 오류 표시 없이 "구글 캘린더" 칸만 숨고 나머지(카카오 칸 포함)는 열린다. 대신 볼 때마다 서버 로그 `google_calendar.load_failed`(`GoogleCalendarStoreError`)가 한 줄 남는다. 2026-11-01 17:23~17:44에 8회(사용자 1명)였다.
  - `web/app/(app)/[slug]/settings/page.tsx:20-26`: `loadGoogleView`가 `loadMyGoogleCalendar()` 실패를 잡아 로그를 남기고 null을 돌려준다. 같은 파일 `:60-64`에서 null이면 `google` prop이 빠진다.
  - `web/app/account/account-settings.tsx:203-215`: `google`이 있을 때만 칸을 그린다.
  - 실패 경로: `web/server/google-calendar/google-calendar.service.ts:142`는 Supabase 설정만 보고 구글 env는 보지 않는다. `web/server/google-calendar/google-calendar.repo.ts:85-94` `readMine`이 표 없음(PostgREST PGRST205)을 `GoogleCalendarStoreError`로 던진다.
- **입찰 일정 `/calendar`**: 구글 버튼이 없고 로그도 없다. `web/app/(app)/(work)/calendar/page.tsx:62-70`이 구글 env부터 보고, 없으면 DB를 읽지 않는다. 툴바 버튼은 `web/app/(app)/(work)/calendar/calendar-view.tsx:465`에서 숨는다.
- **주소를 직접 부를 때**(화면에는 이 주소로 가는 링크가 없다):
  - `GET`·`DELETE /api/v1/me/google-calendar` → 500(표 없음).
  - `GET /api/v1/me/google-calendar/connect` → 307 `/calendar?google=failed`(`web/app/api/v1/me/google-calendar/connect/route.ts:30-41`, 설정 없음 `NOT_CONFIGURED`).
  - `POST /api/v1/calendar/google/sync` → 503 `SERVICE_UNAVAILABLE` "구글 캘린더 연동이 준비되지 않았습니다."(`web/app/api/v1/calendar/google/sync/route.ts:170-171`).
  - `/auth/callback?flow=google-calendar` → 307 `/calendar?google=failed`. 일반 간편 로그인 콜백은 전과 같다.

> [!success] 검증됨 (2026-11-01 16:20 KST, 격리 로컬 스택)
> 구글 마이그레이션만 뺀 73개를 올리고 구글 env 없이 seed 계정으로 확인했다. 설정 1440·390 모두 200, "구글 캘린더" 제목 0, 카카오 제목 1, 오류 상자 0. `/calendar` 1440·390 모두 200, 구글 버튼 0, 가로 넘침 0. 위 주소별 응답도 이때 본 값이다. 위 파일들은 그 뒤 `6604d975`(로그인 수단의 소셜 이메일 가림)만 바뀌었고 구글 칸과 관계없다.

## 다시 시작할 때의 순서

각 단계는 앞 단계가 끝난 뒤에 한다. [승인]은 그 단계만 따로 사용자 승인을 받는다.

1. 사용자 준비: 아래 A·B·D.
2. 격리 로컬 스택 실계정 왕복 [승인: 사용자 실제 구글 계정 호출]. 아래 "로컬 왕복 계획"대로 하고 증거를 `docs/evidence/google-calendar/`에 남긴다. refresh token을 받지 못하면 여기서 멈추고 설계를 다시 정한다.
3. Vercel Production env 3개 추가 → 재배포 [승인]. env는 새 배포부터 적용된다.
4. `pnpm db:push` [승인]. 범위는 `20261030002000` 하나다. 표 2개(`google_calendar_links`·`google_calendar_events`), RLS, 본인 행 정책 8개, `authenticated` grant.
5. 운영 설정·`/calendar`를 1440·390에서 확인한다. 운영 연결 1회(사용자 본인 행 쓰기, 사용자 구글 캘린더에 일정 생성)는 [승인] 뒤에 한다.

3을 4보다 먼저 하는 이유: 설정 칸은 구글 env를 보지 않고 표만 읽는다(`google-calendar.service.ts:142`). 표가 먼저 생기면 설정에 [연결]이 보이지만 env가 없어 `?google=failed`로 실패한다. env를 먼저 넣으면 표가 생길 때까지 칸이 숨어 있다. 그동안 설정 화면의 `load_failed` 로그는 계속 남고, env 배포 뒤에는 `/calendar`에도 같은 로그가 남는다(버튼은 숨은 채다).

## 사용자 할 일

새 OAuth 클라이언트를 만들지 않고, 운영 Supabase Google 제공자에 넣은 기존 구글 로그인 클라이언트를 그대로 쓴다. 이유는 "미확인과 위험" 4번이다.

- **A. Google Cloud**(기존 로그인 클라이언트가 속한 프로젝트)
  1. Google Calendar API를 켠다.
  2. OAuth 동의 화면(Data access)에 범위 `https://www.googleapis.com/auth/calendar.events`를 더한다.
  3. 게시 상태(Publishing status)를 확인한다. Testing이면 연결할 구글 계정을 테스트 사용자로 넣는다. In production이면 테스트 사용자는 필요 없다(차이는 "미확인과 위험" 2·3번).
  4. 같은 웹 클라이언트의 승인된 redirect URI에 로컬 왕복용 `http://127.0.0.1:59721/auth/v1/callback`을 더한다. 운영 `https://brtysdocxemrqhdezzqg.supabase.co/auth/v1/callback`은 구글 로그인이 되고 있으니 있을 것이다. 있는지만 본다.
- **B. Supabase 운영**: 바꾸지 않고 확인만 한다.
  - Google 제공자가 켜져 있는지. 클라이언트 ID·시크릿은 그대로 둔다.
  - "Allow manual linking"이 켜져 있는지. 구글 로그인 수단이 없는 계정이 `linkIdentity`로 연결할 때 필요하다.
  - Redirect URLs에 `https://www.solideos-radar.com/auth/callback**`가 있는지.
- **C. Vercel Production env**(순서 3, 승인 뒤)
  - `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`: 운영 Supabase Google 제공자와 같은 값.
  - `GOOGLE_TOKEN_ENC_KEY`: 운영 전용으로 새로 만든다. `openssl rand -base64 32`(base64 32바이트, 아니면 `pnpm check:env`가 `INVALID_FORMAT`).
  - `NEXT_PUBLIC_AUTH_GOOGLE`은 지금 값 그대로 둔다. 구글 캘린더 코드는 이 값을 읽지 않는다(읽는 곳은 `web/lib/auth-providers.ts`의 로그인 버튼뿐). `NEXT_PUBLIC_` 값은 빌드에 박혀 바꾸면 재빌드가 필요하고 구글 로그인에 영향이 간다.
- **D. 로컬 왕복용 파일** `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/google-calendar/.env.google.local`(git 밖)
  - `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`·`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`·`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`: 넷 다 기존 로그인 클라이언트 값.
  - `GOOGLE_TOKEN_ENC_KEY`: 로컬 전용 값을 따로 만든다.
  - 에이전트는 이 파일을 읽지 않고 `--env-file`과 Supabase `env()`로만 넘긴다. 값은 사용자가 넣는다.

## 로컬 왕복 계획

- 격리 로컬 스택을 쓴다. 기본 54321·기본 Compose는 쓰지 않는다. Supabase API 59721, 별도 `project_id`, 구글 마이그레이션 포함.
- Supabase 설정: `[auth.external.google] enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, `site_url`·`additional_redirect_urls`에 로컬 웹 주소의 `/auth/callback**`. manual linking은 저장소 `supabase/config.toml:42`에 이미 켜져 있다.
- 웹은 `NEXT_PUBLIC_AUTH_GOOGLE` 없이 띄운다. 꺼진 채로 연결되는지도 이때 본다.
- 순서(seed 계정은 구글 로그인 수단이 없어 첫 연결이 link 경로다. 운영 사용자는 이미 구글이 연결돼 있어 signin 경로라 둘 다 본다):
  1. 연결(link): `linkIdentity` + `calendar.events`·`access_type=offline`·`prompt=consent`.
  2. 같은 달 넣기 두 번: 두 번째는 새로 만든 일정 0건이고 구글 캘린더 "SOL RADAR 입찰 일정"에 중복이 없다.
  3. 해제.
  4. 다시 연결(signin): `signInWithOAuth` + `login_hint`(연결된 구글 이메일). 재동의 화면이 뜨고 refresh token을 새로 받는지 본다(`google-calendar.service.ts:155-180`).
  5. 넣기 한 번.
  6. 해제.
- 증거: 단계별 화면(1440·390), 서버 JSON 로그(`google_calendar.connect|sync|disconnect`, 토큰·이메일·일정 제목 없음), 넣기 결과 건수. 저장은 `docs/evidence/google-calendar/`.

## 미확인과 위험

1. **refresh token 실제 수신**: Supabase가 코드 교환 때 `provider_refresh_token`을 주는지는 실제 구글로 아직 확인하지 않았다(스펙 열린 질문 5). 주지 않으면 콜백이 `no_refresh_token`으로 끝나고, Supabase 세션 밖 구글 OAuth 직접 흐름으로 바꿔야 한다.
2. **Testing 상태의 7일 만료**: 게시 상태가 Testing이고 기본 범위 밖(`calendar.events`)을 요청하면 refresh token이 7일 뒤 만료된다(구글 문서 기준, 미실측). 만료되면 넣기가 `409 GOOGLE_EXPIRED`가 되고 [다시 연결]이 뜬다.
3. **In production 상태의 "확인되지 않은 앱" 경고**: `calendar.events`는 민감 범위라, 앱 검증 전에는 연결 때 경고 화면이 뜨고 "고급 → 이동"으로 넘어가야 한다. 검증 전 사용자 수 한도(100명)가 있다(구글 문서 기준, 미실측). 기존 로그인(이메일·프로필만 요청)은 영향이 없다.
4. **클라이언트 ID는 Supabase 제공자와 같아야 한다**: 웹 서버가 access token을 갱신할 때 `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`와 refresh token을 `https://oauth2.googleapis.com/token`에 보낸다(`web/server/google-calendar/google-api.ts:187-195`). refresh token은 Supabase가 자기 Google 제공자 클라이언트로 받은 것이고, 구글은 발급한 클라이언트로만 갱신해 준다(구글 일반 규칙, 미실측). 새 클라이언트를 쓰려면 Supabase 제공자 값을 바꿔야 해 지금 쓰는 구글 로그인에 영향이 간다.
5. **동의 화면에서 캘린더 체크를 끄면**: 연결은 되지만 넣기 때 구글이 403을 돌려 실패한다(`web/server/google-calendar/google-api.ts:124-126` `FORBIDDEN`). 다시 연결하며 체크를 켠다.
6. **다른 구글 계정 선택**: 연결 중 다른 계정을 고르면 세션을 끊고 `/auth/login?link=google-mismatch&next=/calendar`로 보낸다. 가입하지 않은 계정이면 빈 계정이 생긴다(ADR-073 받아들인 위험 ③).
7. **로그 잡음**: 표가 생기기 전까지 설정 화면을 볼 때마다 `google_calendar.load_failed`가 남는다. 기능 영향은 없다.

## 관련 문서

- [[16-DECISIONS|16 ADR]] — ADR-073 3번 "반영 상태"·받아들인 위험
- [[12-ROADMAP|12 로드맵]] — 남은 일정 제안·해커톤 이후 행
- [[PROGRESS|진행 상황]]
- [[05-API-SPEC|05 API 명세]] §2 — 구글 캘린더 경로와 오류 코드
- [[06-UI-UX|06 UI/UX]] §5.15 — `/calendar` 내보내기
- [[2026-10-30-calendar-export|옛 내보내기 계획]](퇴역)
