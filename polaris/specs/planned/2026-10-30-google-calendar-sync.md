---
title: "입찰 일정 구글 캘린더 연동"
status: planned
created: 2026-10-30
updated: 2026-10-30
tags:
  - sol-radar
  - calendar
  - integration
---

# 입찰 일정 구글 캘린더 연동

## 승인과 기준

2026-10-30 사용자가 세 결정을 추천안대로 승인했다("1, 1, 1 추천안대로 진행해"). ① 화면 동결을 2026-11-01에서 **2026-11-03**으로 연기한다(제출 11-03·발표 11-04는 그대로, `docs/16-DECISIONS.md` ADR-054). ② 카카오 간편 로그인과 카카오 메시지(나에게 보내기) 실발송까지 됐다는 사용자 보고를 기록한다(증거 기록 경로 미확인). ③ 입찰 일정(`/calendar`)의 `.ics` 내려받기와 `GET /api/v1/calendar/ics`를 없애고 **구글 캘린더 연동**을 만든다. 이 결정은 `docs/16-DECISIONS.md` **ADR-073**이다(본문 2026-10-30 추가).

이 스펙은 ③의 설계와 ④ 작업 순서를 적는다. 기준 문서는 `docs/05-API-SPEC.md`(API 계약 규칙·오류 코드), `docs/06-UI-UX.md` §5.15(입찰 일정 화면), `docs/09-SECURITY.md`(비밀값·세션·CSRF), `docs/04-DATABASE.md`(표·RLS 규약), `docs/13-NOTIFICATIONS.md`와 `web/server/kakao-notify/`(토큰 암호화·연결 상태의 선례, ADR-038)다. 2026-10-30 `.ics` 계획([[2026-10-30-calendar-export|calendar export]])은 superseded이고, 그 계획의 일정별 "구글 캘린더에 추가" 링크(`googleCalendarUrl`, 새 창, OAuth 없음)는 그대로 둔다.

범위 밖: 자동 동기화(Worker 주기 실행)는 발표 뒤다. 양방향 동기화(구글 → SOL RADAR), 구독형 ICS 주소, 담당자 이름 전송, 조직 공용 캘린더 공유는 만들지 않는다. 결제·모바일 앱·승률 표시 금지는 그대로다(ADR-007).

## 방식

- **인증**: Supabase 로그인 연결(`linkIdentity`)에 구글 캘린더 권한을 얹는다. scope `https://www.googleapis.com/auth/calendar.events`, `access_type=offline`, `prompt=consent`. 구글 로그인이 연결돼 있지 않은 사용자는 캘린더 툴바의 [구글 캘린더 연동] 버튼이 구글 로그인(연결) 화면으로 보낸다. 돌아온 `/auth/callback?flow=google-calendar`에서 서버가 세션의 `provider_refresh_token`을 AES-256-GCM으로 암호화해 새 표 `google_calendar_links`에 저장한다. 이미 구글이 연결된 사용자는 `signInWithOAuth` + `login_hint`(연결된 구글 이메일)로 다시 동의받고, 돌아온 세션의 사용자 id가 시작 전과 다르면 세션을 끊고 실패로 처리한다(다른 계정으로 로그인되는 일을 막는다).
- **동작**: 수동 밀어넣기 한 가지다. 캘린더 툴바 버튼 하나가 지금 보는 달·보기(`org`·`mine`)·종류(`kinds`)의 일정을 사용자 구글 계정의 전용 보조 캘린더 **"SOL RADAR 입찰 일정"**(첫 밀어넣기 때 만들고 `calendar_id`를 저장한다)에 넣는다. 일정마다 `extendedProperties.private.solKey`(= 일정 `key`, `web/server/calendar/calendar.model.ts`의 `${kind}:${id}`)로 식별하고, 매핑 표 `google_calendar_events`로 만들기·갱신·삭제(그 달에서 사라진 일정)를 멱등하게 한다. 두 번 눌러도 중복이 0이어야 한다. 담당자 이름은 싣지 않는다(기존 `.ics`·링크와 같은 원칙).
- **구글 호출**: Vercel 함수 안에서 일정 수만큼 Google Calendar API를 부른다. 동시 4건으로 시작하고 상한(한 번에 넣는 최대 일정 수)은 측정 뒤 정한다. 토큰 갱신은 `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`으로 서버가 직접 한다. 갱신이 `invalid_grant`면 연결 행을 `EXPIRED`로 바꾸고 `409 GOOGLE_EXPIRED`를 준다.
- **env(웹 서버 전용, `NEXT_PUBLIC_` 아님)**: `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`(Supabase 구글 제공자에 넣은 것과 같은 값, 토큰 갱신용)·`GOOGLE_TOKEN_ENC_KEY`(base64 32바이트). ADR-018의 예외(카카오 알림 키를 서버에 두는 것, ADR-038)를 구글로 넓힌다. 값은 `web/.env.example`·`.env.example`에 이름만 적고, `pnpm check:env`가 셋 중 일부만 있으면 거부한다.
- **저장**: 새 표 둘(새 마이그레이션 파일로만). RLS는 본인 행만(`user_id = auth.uid()`). service role은 쓰지 않는다(Route Handler가 사용자 세션으로 읽고 쓴다).

| 표 | 열 | 비고 |
|---|---|---|
| `google_calendar_links` | `user_id`(PK, `auth.users` 참조), `status`(`CONNECTED`\|`EXPIRED`), `google_email`, `refresh_token_enc`, `calendar_id`(null이면 보조 캘린더 아직 없음), `last_synced_at`, `last_result`(`SYNCED`\|`FAILED`\|`EXPIRED`), `created_at`·`updated_at` | 암호문만 저장. 평문 refresh token은 로그·응답에 쓰지 않는다 |
| `google_calendar_events` | `user_id`, `event_key`, `google_event_id`, `created_at`·`updated_at`. PK `(user_id, event_key)` | 연결 해제 때 함께 지운다(FK cascade). 구글 쪽 일정은 지우지 않는다 |

## API

`docs/05-API-SPEC.md` §2 표에 2026-10-30 반영했다. 요약:

| Method | Path | 권한 | 응답 |
|---|---|---|---|
| POST | `/api/v1/calendar/google/sync` | auth | 본문 `{month, view, kinds}` → `200 {created, updated, deleted, calendarId}`. `401`, `403 CSRF_REJECTED`, `409 GOOGLE_NOT_CONNECTED`, `409 GOOGLE_EXPIRED`, `503 SERVICE_UNAVAILABLE`(IT 공고 읽기 실패, `component:"calendar-relevant"`), `502 UPSTREAM_ERROR`(구글 오류) |
| GET | `/api/v1/me/google-calendar` | session(본인) | 연결 상태·구글 이메일·마지막 반영 시각·결과 |
| DELETE | `/api/v1/me/google-calendar` | session(본인) | `204`. 연결 행·매핑 행을 지운다. 구글 revoke는 부르지 않는다 |
| (삭제) | `GET /api/v1/calendar/ics` | — | Route Handler·계약 시험·화면 링크를 지운다 |

## 사용자 흐름

1. 연결 전: `/calendar` 툴바 [구글 캘린더 연동] → 구글 로그인(연결) 화면 → 동의 → `/auth/callback?flow=google-calendar` → 서버가 `provider_refresh_token` 암호화 저장 → `/calendar?google=connected`로 돌아와 버튼이 [구글 캘린더에 넣기]로 바뀐다.
2. 연결 뒤: [구글 캘린더에 넣기] → 지금 보는 달·보기·종류의 일정을 밀어넣는다 → 결과 띠 "구글 캘린더에 넣었습니다: 새로 n건 · 갱신 n건 · 삭제 n건" + 구글 캘린더 열기 링크(새 창).
3. 다시 누르기: 바뀐 것만 갱신되고 중복은 0이다. 그 달에서 사라진 일정은 지운다.
4. 만료: 밀어넣기가 `409 GOOGLE_EXPIRED`면 띠가 "구글 연결이 만료됐습니다. 다시 연결하세요"를 보이고 버튼이 [다시 연결]로 바뀐다(`login_hint`로 같은 계정 동의).
5. 해제: 설정 개인 탭 "구글 캘린더" 칸의 [연결 해제] → 확인 → `DELETE /me/google-calendar` → 칸이 "연결 안 됨"으로 바뀐다. 구글 캘린더의 일정은 남는다고 안내한다.
6. 일정별 "구글 캘린더에 추가" 링크(다가오는 14일 항목)는 연결 여부와 상관없이 그대로 쓴다.

데스크톱과 모바일(ADR-072)에서 같은 URL·쿼리·권한을 쓴다. 조직은 세션이 정하고, 보기 `mine`은 내 관심·담당 일정만이다.

## 화면별 명세

| 화면 | 구성 | 구체 파일(6단계, codex 커밋 뒤) |
|---|---|---|
| `/calendar` 툴바 | 보기 전환 옆 버튼 하나. 연결 전 [구글 캘린더 연동](테두리 작은 버튼, 캘린더 아이콘, `title` "구글 계정을 연결하고 이 달 일정을 보조 캘린더에 넣습니다"). 연결 뒤 [구글 캘린더에 넣기]. 만료면 [다시 연결]. `.ics` 내려받기 버튼은 지운다 | `web/app/(app)/(work)/calendar/calendar-view.tsx`, `page.tsx`(연결 상태를 서버에서 읽어 props), `calendar-copy.ts`(문구), `calendar/google-connect.tsx`(연결·동의 시작 클라이언트 부품) |
| 결과 띠 | 버튼 아래 한 줄. 진행 중 `aria-busy`·버튼 비활성, 성공 "새로 n건 · 갱신 n건 · 삭제 n건"과 [구글 캘린더 열기](새 창), 실패는 오류 코드별 문구(아래 상태 표) | `calendar-view.tsx` |
| 다가오는 14일 항목 | 기존 "구글 캘린더에 추가" 링크 유지 | 변경 없음 |
| 설정 개인 탭 | "구글 캘린더" 칸: 상태(연결 안 됨·연결됨 + 구글 이메일·만료), 마지막 반영 시각·결과, [연결 해제]. 카카오톡 알림 칸과 같은 모양 | `web/app/(app)/[slug]/settings/google-calendar-section.tsx`(새 파일), 설정 페이지에 칸 추가 |
| 인증 콜백 | `flow=google-calendar`면 `provider_refresh_token` 저장 뒤 `/calendar?google=connected\|consent_denied\|account_mismatch\|no_refresh_token`으로 보낸다. 다른 `flow`는 기존 동작 | `web/app/auth/callback/route.ts`, `web/server/auth/auth.service.ts` |

문구는 한국어, 금지 문구(승률·확률·수주 금액)는 쓰지 않는다. 새 색·토큰·외부 UI 패키지는 없다(`Button`·`Alert`·기존 설정 칸 재사용).

## 상태

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 연결 안 됨 | `google_calendar_links` 행 없음 | [구글 캘린더 연동] 버튼 | 연결 시작, 일정별 링크 사용 |
| 연결 중 | 구글 동의 화면으로 나간 뒤 돌아오기 전 | (구글 화면) | 동의·거부 |
| 동의 거부 | 콜백 `consent_denied` | 띠 "구글 캘린더 권한을 허용하지 않아 연결하지 않았습니다" | 다시 시도 |
| 다른 계정 | 콜백 사용자 id가 시작 전과 다름 | 세션을 끊고 로그인 화면 안내 "다른 계정으로 로그인되어 연결을 취소했습니다. 다시 로그인하세요" | 다시 로그인 |
| refresh 없음 | 콜백에 `provider_refresh_token`이 없음 | 띠 "구글이 갱신 토큰을 주지 않았습니다. 구글 계정 보안 설정에서 SOL RADAR 접근을 지우고 다시 연결하세요" | 다시 연결 |
| 연결됨 | 행 `CONNECTED` | [구글 캘린더에 넣기], 설정 칸에 이메일·마지막 반영 | 밀어넣기, 해제 |
| 넣는 중 | `POST /calendar/google/sync` 진행 | 버튼 비활성·`aria-busy`, "구글 캘린더에 넣는 중…" | 기다리기 |
| 성공 | `200` | "새로 n건 · 갱신 n건 · 삭제 n건" + [구글 캘린더 열기] | 다시 누르기(멱등) |
| 일부 실패 | 일정 일부의 구글 호출 실패 | `502 UPSTREAM_ERROR`, 띠 "구글 캘린더 오류로 일부를 넣지 못했습니다. 다시 눌러 주세요"(성공한 일정은 매핑에 남아 다음 번에 갱신으로 처리) | 다시 누르기 |
| IT 공고 읽기 실패 | `503`(`calendar-relevant`) | 띠 "IT 공고 일정을 불러오지 못해 넣지 않았습니다. 새로 고친 뒤 다시 시도하세요"(일부만 넣지 않는다) | 새로 고침 |
| 만료 | 갱신 `invalid_grant` → 행 `EXPIRED`, `409 GOOGLE_EXPIRED` | [다시 연결], 설정 칸 "만료" | 다시 연결(`login_hint`) |
| 빈 달 | 그 달 일정 0건 | "이 달에는 넣을 일정이 없습니다"(이전에 넣은 일정이 있으면 삭제 n건) | 달 이동 |
| 해제 | `DELETE` `204` | "연결 안 됨" + 안내 "구글 캘린더에 넣은 일정은 남습니다" | 다시 연결 |

## 접근성과 부품

- 버튼·링크는 접근 이름을 갖고, 결과 띠는 `role="status"`로 읊는다. 진행 중은 `aria-busy`와 비활성으로 중복 실행을 막는다.
- 새 창 링크는 `rel="noopener noreferrer"`와 "(새 창)" 접근 이름을 붙인다.
- 모바일(ADR-072)에서 툴바 버튼은 44px 영역, 띠는 한 열로 줄바꿈한다.
- 기존 `Button`·`Alert`·설정 칸 부품만 쓰고, 색은 `foreground`·`muted-foreground`·`border`·상태색만 쓴다.
- 보안: refresh token은 암호문만 저장하고 응답·로그에 평문을 쓰지 않는다. `POST`·`DELETE`는 `X-Requested-With: sol-radar`(CSRF). 콜백은 `flow`·`next`를 화이트리스트로 검사하고 외부 주소로 보내지 않는다. 연결·해제·밀어넣기 결과는 `audit_logs`에 남긴다(토큰 값 없이).

## 구현 단계와 완료 기준

| 단계 | 고칠 파일 | 완료 기준 |
|---|---|---|
| 0 범위·문서 | 12·18·05·submission README·백로그·calendar-export 계획·이 스펙(16·06·CLAUDE는 codex 커밋 뒤) | 동결 11-03 반영, ics 제거·구글 연동 결정 기록 |
| 1 확인 | auth callback에서 `provider_refresh_token` 수신 | 로컬 Supabase + 구글 테스트 클라이언트로 확인. 실패 시 별도 OAuth로 전환 보고 |
| 2 저장·암호화 | migration `google_calendar_links`·`google_calendar_events`(RLS 본인 행), `scripts/database.test.mjs`, `pnpm db:types`, 카카오 암호화(`web/server/kakao-notify/kakao-token.crypto.ts`)를 `web/server/shared`로 일반화 | PGlite 정책 시험 통과, 카카오 시험 그대로 통과 |
| 3 도메인 `web/server/google-calendar/` | `model`·`repo`·`google-api`(fetch)·`service`·`index` | 단위 시험: 본문 매핑·멱등 결정·토큰 만료→`EXPIRED`·동시 4건 실패 집계 |
| 4 인증 흐름 | `calendar/google-connect.tsx`, `auth.service` `flow=google-calendar` | 연결됨/동의 거부/다른 계정/refresh 없음 네 결과 시험 |
| 5 API | ics 삭제, `POST /calendar/google/sync`, `GET`·`DELETE /me/google-calendar` | 401·403·409·503·502 라우트 시험 |
| 6 화면(codex 커밋 뒤) | `calendar-view`·`page`·`calendar-copy`, settings `google-calendar-section` | 브라우저 시험 교체, 1440·1280·390 확인 |
| 7 통합 검증 | `pnpm verify`, 실제 구글 1회 왕복, `docs/evidence/google-calendar/`, PROGRESS | exit 0, 두 번 눌러도 중복 0 |

검증 규칙은 `docs/17-CLAUDE-IMPLEMENTATION.md` 해커톤 검증 정책(ADR-046)이다. 개발 중 `pnpm verify:changed`, 통합 때 전체 `pnpm verify`. 실제 구글 계정 왕복은 1회만 하고 결과(연결·밀어넣기 두 번·해제)를 `docs/evidence/google-calendar/`에 남긴다. 운영 DB 적용(`pnpm db:push`)과 Vercel env 추가는 사용자 확인 뒤다.

## 열린 질문 (사용자가 준비할 것)

1. **Google Cloud**: 프로젝트에서 Google Calendar API를 켜고, OAuth 동의 화면에 범위 `https://www.googleapis.com/auth/calendar.events`를 추가한다. 앱이 "테스트" 상태면 연결할 구글 계정을 테스트 사용자로 등록한다(민감 범위라 게시에는 검수가 필요할 수 있다, 미검증).
2. **Supabase**: Authentication → Providers → Google에 같은 클라이언트 ID·시크릿, "Allow manual linking" 켜기(`linkIdentity`). 리디렉션 URL에 운영·로컬 `/auth/callback`이 있어야 한다.
3. **env 값**: `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`(Supabase와 같은 값)·`GOOGLE_TOKEN_ENC_KEY`(base64 32바이트, 새로 만든다). 로컬 `web/.env.local`과 Vercel 운영 env 둘 다. 값은 사용자가 넣는다.
4. **운영 `NEXT_PUBLIC_AUTH_GOOGLE`**: 지금 운영 로그인 화면에 구글 버튼이 켜져 있는지 미확인이다. 꺼져 있으면 구글 로그인 연결이 불가능하므로 켜야 하는지 정한다(ADR-018 "간편 로그인 제공자 설정은 후순위"의 개정).
5. **1단계 결과**: Supabase 세션이 `provider_refresh_token`을 주지 않으면(설정·공급자에 따라 다를 수 있다, 미검증) 별도 OAuth 왕복으로 바꿔야 한다. 그때 다시 보고한다.
6. **상한**: 한 번에 넣는 최대 일정 수와 Vercel 함수 시간 안의 동시 4건이 충분한지 측정 뒤 정한다.
