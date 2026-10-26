---
title: "AI 티 걷어내기 구현 계획"
doc: "plan-20261026-design-declutter"
status: complete
tags:
  - sol-radar
  - ui
updated: 2026-10-26
---

# AI 티 걷어내기 구현 계획

> [!todo] 한눈에 (기준 2026-10-26, main `52fcc271`)
> 스펙: `polaris/specs/done/2026-10-26-design-declutter.md`. 화면 배치와 스타일만 바꾼다. 서버·DB·API·값은 그대로다.
> 작업 폴더는 `../sol-radar-worktrees/design-declutter`(브랜치 `feat/design-declutter`)다. main 병합은 통합 검증 뒤 사용자 확인을 받고 한다.

## 0. 준비

- worktree 생성, `web`에서 `pnpm install --frozen-lockfile`.
- 읽을 것: `design-system` 스킬, impeccable `craft-floor.md`, 고치는 부품의 Base UI·Next 문서(`web/node_modules/next/dist/docs/`).
- 무거운 검증(`pnpm verify`·`test:browser`·`test:e2e*`·`next build`·`git commit`)은 공용 슬롯 스크립트로 감싼다.

## 1. 사이드바 — 작업자 A

| 파일 | 할 일 |
|---|---|
| `web/components/app-nav.ts` | 묶음 3개(업무·분석·회사)와 아래 고정 칸 메뉴(설정·데이터 수집 관리)로 재구성. `icon` 필드는 접은 64px 줄에서 쓰므로 남긴다(S1) |
| `web/components/app-shell.tsx` | 접기 묶음 줄·트리 선·brand 막대 제거, 묶음 이름은 고정 글자, 활성은 회색 바탕+600. 펼친 상태에서 메뉴 아이콘을 숨기고 접은 64px 줄에서만 보인다(S1). 머리는 `Logo` + 회사 이름(접으면 로고 마크만), 사용자 칸 한 줄 |
| `web/lib/stores/sidebar-groups.ts` | 묶음 접기가 없어지면 쓰는 곳이 없어 지운다 |
| `design/tokens.json` → `pnpm tokens` | S2가 흰색이면 `colors.sidebar`만 `#FFFFFF`로 |
| `web/e2e-auth/support/people-read-cases.ts` | 조직도 위치 단언(`sidebar-footer`)을 새 위치(회사 묶음)로 |

완료 기준: 스펙 수용 기준 1. 1440·1280 스크린샷(대시보드·입찰 공고·관리자 계정 화면).

## 2. 대시보드 — 작업자 B

| 파일 | 할 일 |
|---|---|
| `web/app/(app)/(work)/dashboard/dashboard-view.tsx` | 요약 숫자 띠, 왼쪽 주 영역·오른쪽 칸 배치, 카드 상자 제거, 중복 후보 문구 이동 |
| (새 부품 없음) | 숫자 띠는 이 화면에서만 쓰므로 `dashboard-view.tsx` 안에 둔다(design-system "두 번 이상 쓴 것만 부품"). `StatCard`는 템플릿 `[slug]/dashboard`가 쓰므로 남긴다 |
| `web/components/work/opportunities-review-rows.tsx`·`opportunities-source-status.tsx` | 상자 없이 쓰도록 필요한 만큼만 |
| `web/app/(app)/(work)/dashboard/loading.tsx` | 새 배치에 맞춘 skeleton |
| `web/app/(app)/(work)/dashboard/procurement.browser.test.tsx` | "KPI5" 시험을 숫자 띠 기준으로. 값·라벨·+3px 글자 단언은 유지 |

완료 기준: 스펙 수용 기준 2. `region` 이름("공공조달 요약"·"수집 지표")과 제목("우선 검토할 입찰"·"수집 소스 상태")은 유지해 `fx01-flow` E2E를 깨지 않는다.

## 3. 랜딩 — 작업자 C

| 파일 | 할 일 |
|---|---|
| `hero.tsx`·`final-cta-section.tsx` | 버튼 색 그림자 제거, L2 |
| `product-preview.tsx`·`product-preview-section.tsx` | 창 점·`shadow-xl` 제거, 중립 무대 |
| `features-section.tsx`·`feature-previews.tsx` | 구분선 행(번호 없음), 아이콘·지그재그·색 교차 제거 |
| `how-it-works-section.tsx` | 번호 "01", 본문 색 |
| `principles-section.tsx` | 구분선 행(번호 없음) |
| `problem-section.tsx`·`section-heading.tsx` | L1 |
| `web/e2e/landing-sections.spec.ts`·`product-preview.browser.test.tsx` | 바뀐 구조에 맞춤(고지·앵커·제목 단언은 유지) |

완료 기준: 스펙 수용 기준 3. 1440×900·1280×800 첫 화면에서 점수와 고지가 보인다(06 §3.4).

## 4. 문서 — 메인 세션

[[06-UI-UX|06]] §3.4·§4·§4.1·§5.3을 새 결정으로 고치고 2026-10-18 U4 사이드바 결정이 바뀐 것을 적는다. [[PROGRESS]] 작업 로그, `docs/evidence/design-declutter/` 스크린샷.

## 5. 통합 검증 — 메인 세션

1. A·B·C를 `feat/design-declutter`에 모은다(같은 파일 없음).
2. 전체 `pnpm verify`, `pnpm -C web test:browser`, `pnpm -C web test:e2e`. 로컬 Supabase가 있으면 `test:e2e:auth`.
3. 1440·1280 스크린샷 직접 확인, `impeccable detect` 렌더 검사.
4. 독립 리뷰 1회(구현하지 않은 에이전트).
5. 사용자 확인 뒤 main 병합. push·배포는 따로 요청받을 때.

## 병렬

1·2·3은 고치는 파일이 겹치지 않아 동시에 진행한다. 작업자는 각자 worktree에서 일하고 git 상태를 바꾸지 않는다(커밋·병합은 메인 세션). 작업자 보고는 diff·스크린샷·시험으로 직접 확인한 뒤 받아들인다.

## 관련 문서

- [[06-UI-UX|06 UI]]
- [[PROGRESS|진행 상황]]
