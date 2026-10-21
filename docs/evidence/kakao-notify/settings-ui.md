---
title: 카카오톡 알림 설정 칸 화면 증거
tags: [evidence, kakao-notify]
---

# 카카오톡 알림 설정 칸 — 1440·1280 화면 증거

- 찍은 날: 2026-10-21, 브랜치 `feat/kakao-notify` `96ea0e4`
- 방법: 임시 Vitest 브라우저 시험(커밋하지 않음)으로 업무 틀(`AppShell`) + `AppPage` + `SettingsNav` + `AccountSettings`(카카오 칸 포함)를 그렸다.
  가짜 사용자·조직(솔리데오, `sol_role=SALES`)이고 DB·카카오는 부르지 않는다. 폭마다 `document.documentElement.scrollWidth ≤ 폭` 을 확인했다(통과).
- 가상의 데모 계정이다(`sales.demo@solideo.example`). 실명·실제 메일 주소가 아니다.

| 파일 | 상태(설계 §9) |
|---|---|
| `settings-1-disconnected-{1440,1280}.png` | ① 연결 전: 스위치 잠김 + 안내 + 카카오 노랑 [카카오톡 알림 연결] |
| `settings-2-on-connected-{1440,1280}.png` | ③ 켜짐: 마지막 발송 줄 + [시험 메시지 보내기]. 주소 `?kakao=connected` 로 그렸다 — 성공 안내는 toast 라서 이 시험(toast mock)에는 보이지 않는다 |
| `settings-3-off-{1440,1280}.png` | ② 연결됨·꺼짐: 스위치 끔 + [연결 해제] |
| `settings-4-expired-{1440,1280}.png` | ④ 연결 만료: 스위치 켬 + 경고 문구 + [다시 연결] |

- 로그인 수단의 구글 표시가 비어 보이는 것은 시험에서 `next/image` 를 빈 부품으로 바꿨기 때문이다(화면 결함 아님).
- 실제 앱(로그인·DB)에서의 흐름 확인은 격리 스택 mock E2E 에서 따로 한다.
