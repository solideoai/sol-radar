# 스펙: 팀 설정·초대 메일·CSP·오류 기록 자리

- 최종 갱신: 2026-10-15
- 상태: 마침(2026-10-15). `pnpm verify`·`pnpm -C web test:e2e`·`pnpm -C web test:e2e:auth` 통과.

## 1. 목표

2026-10-15 평가의 다음 할 일 2~5번을 한 번에 마친다. [사용자 결정]

1. **팀 설정** — owner 가 팀 이름을 바꾸고 팀을 지운다.
2. **초대 메일** — 초대하면(새 초대·다시 초대) SMTP 로 메일을 보낸다. 설정이 없으면 지금처럼 메일 없이 동작한다.
3. **CSP** — nonce 방식의 Content-Security-Policy 를 모든 화면 응답에 단다.
4. **오류 기록 자리** — 외부 업체 없이 서버 오류를 구조화 로그(JSON 한 줄)로 남기고, 업체를 붙일 자리를 한 곳으로 모은다.

## 2. 비목표

- 팀 주소(slug) 바꾸기. 공유된 링크가 깨진다. [사용자 결정]
- 개인 조직의 이름 바꾸기·삭제. 개인 조직은 계정과 함께만 없어진다. [작성자 판단]
- 소유권 넘기기 화면. 역할 바꾸기가 이미 있다. [작성자 판단]
- 메일 발송 업체 SDK·발송 큐·재시도. 발송이 실패해도 초대는 되돌리지 않는다. [작성자 판단]
- 초대 밖의 메일(가입 확인·비밀번호 재설정)은 Supabase Auth 가 보내던 그대로 둔다. [작성자 판단]
- Sentry 같은 외부 오류 수집 업체 연결, 브라우저 오류를 서버로 모으는 경로, CSP 위반 보고(report-to) 수집. [사용자 결정]
- 랜딩(`/`)의 정적 렌더링. nonce 는 요청마다 만들어야 해서 `/` 도 동적 렌더링이 된다. `base-design` 스펙의 "`○ /` 유지"는 이 결정으로 바뀐다. [사용자 결정]

## 3. 완료의 정의

1. **DB** — 새 마이그레이션 한 장이 `organizations` 에 열 단위 `update (name)` 과 `delete` 권한을 주고, 팀(개인 조직이 아닌 조직)의 활동 회원 owner 만 이름을 바꾸고 지우게 정책을 단다.
   member·조직 밖의 사람·운영자·정지된 사람의 시도는 0행이다. 팀을 지우면 멤버십·초대·작업·활동이 함께 지워지고 실패하지 않는다(마지막 owner 보호·활동 기록 트리거에 걸리지 않는다).
   검증: `pnpm test:db`(`scripts/database.test.mjs` 의 새 묶음), 로컬 Supabase 에 적용, `pnpm db:types` 로 생성물 갱신.
2. **도메인** — `web/server/organization` 에 팀 이름 바꾸기·팀 지우기가 있다. 입력은 `unknown` 으로 받고 결과는 이름 붙은 합집합이다.
   이름 규칙은 팀을 만들 때의 규칙(앞뒤 공백 없이 1~40자)을 그대로 쓴다. 지우기는 사용자가 입력한 이름이 지금 팀 이름과 정확히 같을 때만 한다(서버에서도 확인).
   검증: 웹 단위 시험.
3. **화면** — 설정에 팀 탭이 생긴다(팀 조직에서만). owner 는 이름을 바꾸고, 팀 이름을 입력해 확인한 뒤 지운다. member 는 이름만 본다.
   지운 뒤에는 개인 조직의 대시보드로 가고 토스트로 알린다. 화면 모양은 디자인 스펙(`team-settings-mail-csp-errors.design.md`)을 따른다.
   검증: 로그인 E2E(`pnpm -C web test:e2e:auth`), 375·1280px 브라우저 확인.
4. **초대 메일** — 서버 전용 환경 변수(SMTP 접속 정보·보내는 주소·사이트 주소)가 모두 있을 때만 보낸다. 이름은 `web/.env.example` 에 적는다. `NEXT_PUBLIC_` 를 붙이지 않는다.
   메일에는 조직 이름, 초대한 사람, 역할, 만료일, 받은 초대 화면(`<사이트 주소>/invitations`)으로 가는 링크가 있다. 조직 이름·표시 이름은 HTML 이스케이프한다.
   초대 결과에 메일 결과(보냄·설정 없음·실패)가 붙고, 화면 토스트가 그에 맞게 안내한다(설정 없음·실패면 "직접 알려 주세요"). 발송은 시간 제한(약 10초)을 두고 기다린다.
   로컬은 Supabase 의 내장 메일함 SMTP 포트를 열고 `pnpm db:start` 가 `web/.env.local` 에 로컬 SMTP 값을 적어, 메일함(http://127.0.0.1:54324)에서 비용 없이 확인한다.
   검증: 단위 시험(내용·이스케이프·설정 없음·실패), 로그인 E2E 가 메일함에서 도착을 확인한다.
5. **CSP** — `web/proxy.ts` 가 요청마다 nonce 를 만들어 요청·응답에 CSP 를 단다. 운영 정책은 최소한 다음을 지킨다:
   `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
   `connect-src` 는 Supabase 주소, `frame-src`·`script-src` 는 가입 화면의 카카오 우편번호 서비스, `img-src` 는 제공자 프로필 사진이 열리게 한다. 개발 모드만 `'unsafe-eval'` 을 더한다.
   `style-src` 에 `'unsafe-inline'` 이 필요하면 그 이유를 주석과 문서에 적는다. 기존 보안 헤더는 유지한다.
   검증: 운영 빌드(`next build` + `next start`)를 브라우저로 열어 랜딩·로그인·가입(주소 검색 대화상자 포함)·대시보드·작업·설정·관리자에서 콘솔의 CSP 위반이 0건. `web/e2e/operations.spec.ts` 가 헤더와 nonce 를 확인한다.
6. **오류 기록 자리** — `web/instrumentation.ts` 의 `onRequestError` 가 한 함수를 거쳐 JSON 한 줄(시각·digest·경로·메서드·라우트 종류·오류 이름과 메시지)을 남긴다.
   쿠키·인증 헤더·요청 본문·검색어는 남기지 않는다. 오류 경계(`error.tsx`·`global-error.tsx`)도 같은 함수 계열을 거쳐 브라우저 콘솔에 남긴다. 업체를 붙일 자리는 그 함수 하나다.
   검증: 단위 시험(형식·민감 정보 빠짐), 운영 빌드에서 일부러 낸 서버 오류가 로그에 한 줄로 남는지 확인(확인용 코드는 남기지 않는다).
7. **문서** — `docs/database.md`(초대 메일), `docs/AUTH-SECURITY.md`(CSP·초대 메일), `docs/first-deployment.md`(SMTP·사이트 주소 변수, 오류 로그 보는 곳)가 구현과 맞다.
8. **전체 검증** — `pnpm verify`, `pnpm -C web test:e2e`, `pnpm -C web test:e2e:auth` 통과.

## 4. 단계와 담당

| 단계 | 담당 | 고칠 곳 |
|---|---|---|
| 디자인 스펙 | `web-designer` | `polaris/specs/done/team-settings-mail-csp-errors.design.md` |
| 팀 설정·초대 메일 서버 | `backend-developer` | 새 마이그레이션, `web/server/organization/`, 메일 보내는 코드, `web/.env.example`, `supabase/config.toml`, `scripts/local-env.mjs`, 생성물(`pnpm db:types`), 문서 |
| CSP·오류 기록 | `backend-developer` | `web/proxy.ts`, `web/server/supabase/session.ts`, `web/next.config.ts`, `web/instrumentation.ts`, 오류 경계, `web/app/page.tsx`, 문서 |
| 팀 설정 화면·초대 토스트 | `frontend-developer` | `web/app/(app)/[slug]/settings/` |
| 단위·DB 정책 시험 | `test-server` | `web/server/**/*.test.ts`, `scripts/database.test.mjs` |
| E2E | `e2e-web` | `web/e2e/operations.spec.ts`, `web/e2e-auth/` |
| 스펙 대조·탐색 QA | `/spec-check`, `qa-web` | 읽기만 |

## 5. 엣지 케이스

- 정지된 owner 는 이름을 바꾸거나 지우지 못한다.
- member 가 서버 함수를 직접 POST 하면 0행이고 결과는 `forbidden` 이다.
- 개인 조직의 id 로 부르면 `personal-org` 로 거절한다.
- 팀이 지워진 뒤 다른 멤버의 화면은 다음 요청에서 404 다(지금 조직에서 빠졌을 때와 같다).
- 다시 초대(만료 갱신)도 메일을 다시 보낸다.
- 받는 사람이 가입했든 안 했든 같은 메일이다. 링크를 열고 로그인(없으면 가입)한 뒤 받은 초대에서 수락한다.
- SMTP 서버가 응답하지 않으면 시간 제한 뒤 `failed` 다. 초대는 저장된 채 남는다.

## 구현 메모

- 팀을 지우면 마지막 owner 보호 트리거가 연쇄 삭제를 막아 전체가 실패했다. `protect_last_owner` 를 다시 정의해 조직 행이 이미 지워지는 중이면 통과시킨다(`20261015000002_team_settings.sql`). [작성자 판단]
- 지우기의 확인 이름은 앞뒤 공백만 떼고 비교한다(휴대폰 자동 입력 대비). 지울 때도 이름까지 맞춰 지워, 그새 다른 owner 가 이름을 바꿨으면 지우지 않는다. [작성자 판단]
- member 가 틀린 이름으로 지우기를 직접 부르면 `forbidden` 이 아니라 `invalid` 다. 이름은 member 도 읽을 수 있어 새는 정보가 없다. [작성자 판단]
- 메일 변수 이름은 `SMTP_HOST`·`SMTP_PORT`·`SMTP_USER`·`SMTP_PASSWORD`·`MAIL_FROM`·`SITE_URL`. 로컬은 Supabase CLI 2.120 의 `[local_smtp]` 로 메일함 SMTP(54325)를 연다. [작성자 판단]
- 초대를 저장한 뒤 메일에 넣을 값을 읽는 조회가 실패하면 `inviteMember` 가 던진다(초대는 남는다). DB 오류를 삼키지 않으려고 그대로 두었다. [작성자 판단]
- 메일 발송 실패 로그는 `reportServerError` 를 거치지 않고 같은 JSON 형식으로 따로 남긴다. 처리한 실패이고, 받는 사람 주소가 든 오류 문장을 빼야 해서다. 업체를 붙일 자리는 처리하지 못한 오류(`reportServerError`·`reportBrowserError`)다. [작성자 판단]
- `style-src` 에 `'unsafe-inline'` 을 둔다. 알림(sonner)이 nonce 없는 `<style>` 을 넣고, 서버가 그린 `style="…"` 속성은 nonce 로 열 수 없다. 스크립트는 nonce 로만 연다. [작성자 판단]
- zod 4 가 처음 검사할 때 `new Function("")` 으로 eval 을 시험해 운영 빌드에서 CSP 위반이 났다(콘솔이 아니라 DevTools Issues 에만 보인다). `web/instrumentation-client.ts` 가 브라우저에서 `z.config({ jitless: true })` 를 부른다. `web/e2e/operations.spec.ts` 는 `securitypolicyviolation` 이벤트로 위반을 센다. [작성자 판단]
- 개인 조직의 `/<slug>/settings/team` 은 404 화면이지만 첫 응답 상태는 200 이다. `loading.tsx` 가 먼저 흘러 나가는 Next 동작이고 다른 화면의 404 와 같다. [작성자 판단]
- 띄어쓰기 없는 40자 팀 이름이 대시보드·작업·멤버 화면을 320px 에서 넘치게 했다(전부터 있던 결함). `components/app-page.tsx` 의 설명 줄에 `wrap-anywhere` 를 주었다. [작성자 판단]

## 미결정 사항
