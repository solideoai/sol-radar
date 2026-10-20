---
title: "사이드바 사용자 칸 실화면 확인 (2026-10-20)"
status: done
tags:
  - sol-radar
  - test
  - phase-3
  - evidence
updated: 2026-10-20
---

# 사이드바 사용자 칸 실화면 확인

로그인한 `/dashboard` 에서 사이드바 맨 아래 사용자 칸이 이름·이메일을 말줄임 없이 다 보이는지 1440·1280px 두 폭에서 확인했다. 대상은 브랜치 `fix/sidebar-user-height`(커밋 `d28c640` 사용자 칸 줄바꿈 + 이번 `devIndicators` 위치 변경)다.

## 실행 조건

- 트리: worktree `sol-radar-worktrees/sidebar-user-height`, 브랜치 `fix/sidebar-user-height` @ `410f79f` 에 `web/next.config.ts` 변경을 더한 작업 트리.
- DB·Auth: 격리 로컬 Supabase(`project_id = sol-radar-9c`, API `127.0.0.1:59821`, DB `59822`). 공용 `54321` 은 쓰지 않았다. studio·realtime·storage 등은 끄고 띄웠다.
- 데이터: `pnpm demo:reset -- --env-file <격리 env>`(`SOL_RUN_MODE=fixture`). 출력 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`.
- 웹: `pnpm exec next dev -p 3921`(개발 서버). 웹 env 에는 service role 키를 넣지 않았다(URL·anon 키·실행 모드·일회용 커서 키만).
- Redis·MinIO·gateway 는 띄우지 않았다. 상단바 AI 상태가 "확인 중"인 것은 그 때문이고 이 확인과 관계없다.
- 계정: 데모 `admin@soltech.invalid`(김관리, ADMIN). 비밀번호는 이 실행에서만 쓴 일회용 값이다.
- 브라우저: `web` 의 Playwright(Chromium) 독립 스크립트. 공용 Playwright MCP 브라우저는 다른 세션이 쓰고 있어서 쓰지 않았다.

## 결과

| 폭 | 버튼 높이 | 이름 | 이메일 | 말줄임 | 버튼 밖으로 나감 | 가로 넘침 |
|---|---|---|---|---|---|---|
| 1440 | 58px | 김관리 (16px) | admin@soltech.invalid (15px) | 없음 | 없음 | 없음 |
| 1280 | 58px | 김관리 (16px) | admin@soltech.invalid (15px) | 없음 | 없음 | 없음 |

원값은 `measure.json` 이다. 긴 이름·이메일(줄바꿈되는 경우)은 `web/components/app-shell.browser.test.tsx` 의 1280·1440 시험이 잰다.

### 처음 화면에서 더 찾은 것

개발 서버(`next dev`)의 화면 표시(검은 "N" 동그라미)가 기본 위치인 왼쪽 아래에 떠서 사용자 칸의 아바타를 덮고 이름 첫 글자에 닿았다. 사용자가 처음 물은 "테스트 중이라 그런가"가 이것일 수 있다. 배포 빌드에는 없는 표시라 `web/next.config.ts` 에 `devIndicators: { position: "bottom-right" }` 를 두어 오른쪽 아래로 옮겼다. 아래 스크린샷은 옮긴 뒤다(오른쪽 아래에 N 이 보인다).

## 파일

| 파일 | 무엇 |
|---|---|
| `dashboard-1440.png`·`dashboard-1280.png` | 로그인한 `/dashboard` 전체 화면 |
| `sidebar-footer-1440.png`·`sidebar-footer-1280.png` | 사이드바 맨 아래 칸(조직도·사용자 칸)만 |
| `measure.json` | 폭별 버튼 크기, 줄마다 글자 크기·말줄임·버튼 안 여부, 페이지 가로 넘침 |

## 정리

- 개발 서버: 띄운 프로세스 3개(pnpm·next·next-server)만 PID 로 끝냈다. 3921 포트 닫힘.
- 격리 Supabase: `supabase stop --no-backup --workdir <scratchpad>/sb`. `sol-radar-9c` 컨테이너·볼륨 0개.
- env 파일: worktree `web/.env.local`(scratchpad 파일로의 링크)와 scratchpad 의 격리 env 두 개를 지웠다.
