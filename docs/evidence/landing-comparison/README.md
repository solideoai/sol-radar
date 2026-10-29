---
title: "랜딩 비교 표 화면 확인 (2026-10-29)"
status: draft
tags: [sol-radar, landing, test]
updated: 2026-10-29
---

# 랜딩 비교 표 화면 확인 (2026-10-29)

랜딩 서비스 소개(`#about`)를 공고 수집 서비스 네 곳(첫 글자 + XX)과 SOL RADAR의 8행 기능 비교 표로 바꾼 결과다. 설계는 [랜딩 비교 표 스펙](../../../polaris/specs/in-progress/2026-10-29-landing-competitor-table.md), 칸 값의 근거는 [경쟁 서비스 재조사](../competitors/2026-10-29-competitors.md) 4절이다.

## 무엇을 증명하나

- 1440·1280 두 폭에서 표가 단 폭(1200px) 안에 들어가고 페이지 가로 넘침이 없다. 표 너비 1120px, 부모 1200px, 잘린 행 이름 0개(두 폭 같음).
- SOL RADAR 열만 옅은 `brand` 바탕이고, 칸마다 화면 낭독기 뜻 글자가 있다(예: SOL RADAR 칸 "✓제공").
- 기호 40개 모두 칸 바탕과 대비 4.5:1 이상이다. 처음 "—"는 `muted-foreground` 50%(2.29:1)였고, 최종 리뷰 뒤 `muted-foreground`로 올렸다.
- 설명 문장의 닫는 따옴표 뒤 조사("를"·"와")가 줄 맨 앞으로 떨어지지 않는다(1280에서 처음 찍었을 때 "를"이 떨어진 것을 고쳤다).

## 스크린샷

- `20261029-landing-home-comparison-1440.png` — 1440×900, 구역 전체
- `20261029-landing-home-comparison-1280.png` — 1280×800, 구역 전체

찍은 방법: 브랜치 `feat/landing-compare`를 `pnpm -C web build` 뒤 `pnpm -C web start`(`SOL_DEPLOYMENT_ROLE=standalone`)로 띄우고 Playwright chromium으로 `section#about`을 찍었다. 두 폭 모두 구역 폭이 1200px라 그림 크기가 같다.

## 시험

- `E2E_PORT=3131 pnpm -C web exec playwright test e2e/landing-sections.spec.ts` (브랜치 `feat/landing-compare`, 2026-10-29) → 17 passed
  - 새 시험: 비교 표 열·행·칸 뜻 글자·각주 / 타사 실명(속성 포함)·금지 문구 없음 / 1280 폭 표가 내용 폭 안 / 설명이 조사로 줄을 시작하지 않음 / 기호 대비 4.5:1 이상
  - 최종 리뷰 뒤 시험 세 개를 고치거나 더했다. 표에 `min-w-[1160px]`·`title="인포21C"`을 잠시 넣고 빌드하면 셋 다 실패한다(3 failed). 되돌리고 "—" 색을 고친 뒤 17개 모두 통과한다.
  - 구현 전 실행은 4 failed(구역 없음), 줄바꿈 시험은 고치기 전 1 failed(줄 시작 `["공", "있", "를"]`)
- `pnpm verify:changed` exit 0(web `verify:quick`: Vitest 995 passed, lodestar·토큰·색 검사 통과)
