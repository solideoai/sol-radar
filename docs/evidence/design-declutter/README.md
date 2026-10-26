---
title: "AI 티 걷어내기 — 증거"
status: draft
tags:
  - sol-radar
  - ui
  - test
updated: 2026-10-26
---

# AI 티 걷어내기 — 증거 (2026-10-26)

[[2026-10-26-design-declutter-plan|구현 계획]] 통합 검증 기록이다. 작업 폴더 `sol-radar-worktrees/design-declutter`(브랜치 `feat/design-declutter`, 기준 main `52fcc271`). 화면은 격리 로컬 Supabase(데모 seed: 조직 2·사용자 5·공고 19)와 `next dev`로 찍었다.

## 검사 결과

| 검사 | 결과 |
|---|---|
| 전체 `pnpm verify` (서식·타입·린트 가드·web 단위 593·lodestar·토큰·색·DB 타입·`next build`·AI·결정 서비스 pytest) | exit 0 |
| 브라우저 시험 `procurement.browser.test.tsx`·`product-preview.browser.test.tsx` | 12/12 |
| `web/e2e` Playwright(랜딩 포함) | 45/45 |
| 대시보드 점검(`fx01-flow.write.spec.ts` 56~77행과 같은 locator, 저장소 밖 스크립트) | 11/11 |
| 사이드바 구조 점검(ADMIN `/dashboard` 1440·1280, SALES `/org-chart` 1280, 저장소 밖 스크립트) | 전부 통과 |
| 가로 넘침(`/dashboard`·`/bids`·`/org-chart`·`/`, 1440·1280) | 0px |
| `impeccable detect` 렌더(`/` 1440×900·1280×800)와 바뀐 소스 | 지적 0 (작업 전 랜딩 1건: 카드 안 카드) |
| 로그인 뒤 E2E `test:e2e:work`·`test:e2e:auth` | **돌리지 않음.** Compose(redis·AI gateway·worker)가 필요하다. 대시보드 단언은 위 점검으로 대신했다 |

사이드바 브라우저 시험 `web/components/app-shell.browser.test.tsx`는 2026-10-21 시험 축소로 이미 지워져 있어([정본 목록](../verification/20261021-pruned-tests.json)) 되살리지 않았다([[11-TESTING|11]] NAV-10).

## 화면

| 파일 | 내용 |
|---|---|
| `20261026-before-dashboard-1440.png` | 바꾸기 전 대시보드(숫자 카드 10개·트리 사이드바) |
| `20261026-after-dashboard-1440.png`·`-1280.png`·`-1280-full.png` | 숫자 띠·구분선 목록·두 단(1280은 한 단) |
| `20261026-after-bids-1280.png`·`20261026-after-org-chart-1440.png` | 다른 화면의 사이드바(글자만·묶음 3개·회색 활성) |
| `20261026-sidebar-collapsed-admin-1440.png` | 접은 64px 줄(아이콘·툴팁·묶음 사이 짧은 선, 2배 해상도) |
| `20261026-sidebar-sales-1280.png` | SALES: 아래 고정 칸에 데이터 수집 관리 없음 |
| `20261026-before-landing-1440-full.png` | 바꾸기 전 랜딩 전체 |
| `20261026-after-root-1440.png`·`-1280.png`·`-1440-full.png` | 랜딩: 첫 화면 점수·고지 보임, 구분선 행, 잉크 띠 마지막 안내 |

## 관련 문서

- [[2026-10-26-design-declutter-plan|구현 계획]]
- [[06-UI-UX|06 UI]] §3.4·§4.1·§5.3
- [[11-TESTING|11 테스트]] NAV-10
- [[PROGRESS|진행 상황]]
