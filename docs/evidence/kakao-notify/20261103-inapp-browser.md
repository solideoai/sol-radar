---
title: "카카오톡 안 창 → 기본 브라우저 넘김 기록 (2026-11-03)"
status: active
tags: [sol-radar, evidence, kakao-notify, demo]
updated: 2026-11-03
---

# 카카오톡 안 창 → 기본 브라우저 넘김 기록 (2026-11-03)

[[16-DECISIONS|ADR-079]] 구현·로컬 확인 기록이다. 운영 반영(main push = Vercel 배포)과 실기기 확인은 아래 "남은 것"이다.

## 증상과 원인

- 사용자 보고: 카톡 [분석 보기]·[공고 원문]을 누르면 카톡 안 창에 첫 화면이 로그인 없이 열리고, 그 창에서 로그인해도 공고로 가지 않는다. Safari에는 이미 로그인돼 있다.
- 운영 확인(14시, 카카오톡 user agent로 curl): 로그인 없이 `https://www.solideos-radar.com/bids/<id>` → `307 /auth/login?next=%2Fbids%2F<id>`. 링크가 공고 주소면 로그인 뒤 그 공고로 돌아온다(`92ca1882`).
- 카카오 발송은 2026-11-01 18:15:48부터 꺼져 있다. 사용자가 누른 카톡은 Worker `SITE_URL`이 회사 홈페이지일 때 나간 것이다([11-01 기록](20261101-recording.md)). 그 메시지의 링크는 바꿀 수 없다.
- 추정(미검증): 카카오가 콘솔에 등록하지 않은 도메인 링크를 등록된 사이트 도메인 첫 화면으로 바꾼다. 두 버튼 모두 첫 화면이 열린 증상과 맞는다. 카카오 공식 문서는 404로 열리지 않았다.
- 카톡 안 창은 Safari·Chrome과 로그인 쿠키를 나누지 않는다.

## 바꾼 것

- `web/app/auth/in-app-browser.ts`: user agent `KAKAOTALK` 판정, `kakaotalk://web/openExternal?url=` 주소 만들기.
- `web/app/auth/employment-routing.ts` `signInPath`: 카톡 안 창이면 `/auth/open-in-browser?next=<경로>`, 아니면 지금의 `loginPath`. 업무 레이아웃·`requireWork`가 이것을 쓴다.
- `web/app/auth/open-in-browser/`: 화면이 뜨면 한 번 넘기고, [브라우저로 열기] 버튼과 [이 창에서 로그인] 링크를 둔다. 카톡 밖에서 열면 로그인으로 보낸다. `next`는 `safeEmploymentNext`로 거르고 계정 화면·바깥 주소면 `/dashboard`다.

## 로컬 확인 (worktree dev 서버 :3317, DB 없음)

| 요청 | 결과 |
|---|---|
| 카톡 UA `/bids/90c955ea-…` | `307 /auth/open-in-browser?next=%2Fbids%2F90c955ea-…` |
| Safari UA 같은 주소 | `307 /auth/login?next=%2Fbids%2F90c955ea-…` |
| 카톡 UA 안내 화면 | `200` |
| 카톡 밖 안내 화면 | `307 /auth/login?next=…` |
| 카톡 UA `next=https://evil.example` | 버튼 `next` `/dashboard`, 로그인 링크 `/auth/login` |

- Playwright(카톡 UA) 360·390·768·1280·1440: 제목 "브라우저에서 엽니다", 가로 넘침 0, 콘솔 오류 0, `kakaotalk://web/openExternal?url=http%3A%2F%2Flocalhost%3A3317%2Fbids%2F90c955ea-…` 요청 확인(dev StrictMode라 2번). 스크린샷 [390](20261103-open-in-browser-390.png)·[1440](20261103-open-in-browser-1440.png).
- `pnpm verify:changed` exit 0(웹 `verify:quick`: 서식·타입·린트·계층·토큰·색, 시험 147파일 1,226건). `employment-routing.test.ts` 7건.

## 남은 것

- 운영 반영: main push(Vercel 배포, 사용자 승인).
- 카카오 개발자 콘솔 Web 사이트 도메인에 `https://www.solideos-radar.com` 등록 확인(사용자).
- 실기기: 아이폰·안드로이드 카톡 "나와의 채팅"에 공고 주소를 붙여 눌러 Safari·기본 브라우저로 넘어가는지. 실발송 없이 할 수 있다.
- 녹화용 새 카톡 한 통(발송 켜기·재분석, 운영 변경 승인). [공고 원문]은 녹화에서 누르지 않는다.
