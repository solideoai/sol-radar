---
title: "main 전체 검증 (2026-11-03)"
status: active
tags: [sol-radar, evidence, verification]
updated: 2026-11-03
---

# main 전체 검증 (2026-11-03)

발표 장표 34장(검증한 것)의 시험 수를 오늘 기준으로 맞추려고 돌렸다. 새 worktree(`git worktree add … origin/main`, HEAD `bda82070`, 마지막 코드 커밋 `5e7ffb50`)에서 루트·web `pnpm install --frozen-lockfile` 뒤 `pnpm verify`를 실행했다. main 폴더의 이번 작업 밖 미커밋 파일을 피하려고 따로 만들었다. 14:52:40~14:56:52 KST, exit 0.

| 검사 | 결과 |
|---|---|
| 루트 `node --test` | 324 통과 |
| web Vitest | 147파일 1,226 통과 |
| 타입·린트 가드레일·lodestar(계층 7·순환 없음)·토큰·색·DB 타입 | 통과 |
| `next build` | 성공, 정적 페이지 68 |
| AI gateway pytest | 290 통과 |
| 결정 모델 pytest | 57 통과 |

합계 1,897건이다. 11-01 전체 검증([[20261102-preflight|촬영 전 확인 기록]], `fbe42d5b`)은 루트 316 · web 1,115 · AI gateway 264 · 결정 모델 57이었다.

기록을 올리기 전에 main이 `fbacecd3`로 움직였다(`faaf4c56` 사람 검토 배지 정리). 그 사이 바뀐 시험은 `web/components/bids/decision.browser.test.tsx` 하나이고, web `vitest run` 설정이 `*.browser.test.tsx`를 빼므로 위 시험 수는 같다.

`pnpm verify`는 브라우저 E2E를 돌리지 않는다. 장표의 "화면 흐름 158건"은 10-21 E2E(업무 흐름 33 · 로그인 뒤 125) 값이고 이번에 다시 돌리지 않았다.

## 관련 문서

- [[PROGRESS|진행 상황]]
- [[20261102-preflight|촬영 전 확인 기록]]
