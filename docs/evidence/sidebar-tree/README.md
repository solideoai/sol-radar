---
title: "사이드바 트리·아이콘 되돌리기 — 증거"
status: draft
tags:
  - sol-radar
  - ui
  - test
updated: 2026-10-26
---

# 사이드바 트리·아이콘 되돌리기 — 증거 (2026-10-26)

[[PROGRESS]] "사이드바 트리·아이콘 되돌리기" 절의 화면 확인 기록이다. 작업 폴더 `sol-radar-worktrees/sidebar-tree`(브랜치 `feat/sidebar-tree`, 기준 main `db796a72`, 바꾼 코드는 `web/components/app-shell.tsx`·`web/components/app-nav.ts`·`web/lib/stores/sidebar-groups.ts`). 화면은 격리 로컬 Supabase(`sol-radar-tree1026`, 데모 seed: 조직 2·사용자 5·공고 19)와 `next dev`(포트 3471)로 찍었다. 스크린샷은 2배 해상도다.

## 검사 결과

저장소 밖 점검 스크립트(Playwright)로 확인했다. 새 시험 파일은 만들지 않았다([[11-TESTING|11]] NAV-10, [정본 목록](../verification/20261021-pruned-tests.json)).

| 검사 | ADMIN `/dashboard` 1440·1280 | SALES `/org-chart` 1280 |
|---|---|---|
| 묶음 3개 이름·순서(업무·분석·회사)와 묶음별 메뉴, 보조 메뉴(ADMIN 설정·데이터 수집 관리 / SALES 설정) | 통과 | 통과 |
| 펼친 상태: 메뉴마다 아이콘이 글자 왼쪽(주요 10개, 보조 ADMIN 2·SALES 1, 세로 가운데 차 2px 이하) | 통과 | 통과 |
| 묶음 줄 버튼 3개, `aria-expanded="true"`, `aria-controls`가 같은 이름의 묶음 `ul`을 가리킴, 화살표 하나만, 굵기 600 | 통과 | 통과 |
| 보조 메뉴에 묶음 줄 없음 | 통과 | 통과 |
| 묶음 목록 왼쪽 세로선 `border-left` 1px solid | 통과 | 통과 |
| "인력 배치 시뮬레이션" 말줄임 없음(글자 132px = 칸 132px), 다른 메뉴 이름도 말줄임 0 | 통과 | 통과 |
| 낮은 창(높이 560)에서 메뉴 영역이 스크롤될 때도 말줄임 없음 | 통과 | 통과 |
| 묶음 접기 → `aria-expanded="false"`·목록 `hidden` → `localStorage` `["analysis"]` → 새로고침 뒤에도 접힘, 나머지 2개 펼침 | 통과 | 통과 |
| 지금 화면의 묶음을 접고 새로고침하면 다시 펼침, 접어 둔 분석 묶음의 화면(`/analysis`)으로 들어가면 분석 묶음 펼침 | 통과 | 통과 |
| 활성: `aria-current="page"` 하나, `sidebar-accent` 바탕(마우스를 올려도 같음), 굵기 600, `brand` 막대 없음, 나머지 메뉴는 바탕 없음·400 | 통과 | 통과 |
| 펼친 폭 256px, 흰 바탕 `rgb(255,255,255)`, 오른쪽 1px 선, 가로 넘침 0 | 통과 | 통과 |
| 접은 64px: 분석 묶음을 접어 둔 채로도 아이콘 10개, 보조 아이콘, 묶음 줄 0, 짧은 선 2개, 목록 이름 유지, `aria-label`·툴팁, 가로 넘침 0 | 통과 | 통과 |
| 다시 펴면 접어 둔 묶음은 그대로 접힘 | 통과 | 통과 |
| 사용자 칸 한 줄(높이 40px), 이메일은 열린 메뉴 안에만 | 통과 | 통과 |
| `pageerror`·하이드레이션 콘솔 오류 | 0 | 0 |

단언 수는 ADMIN 93개, SALES 49개이고 실패는 0이다.

### 세로 스크롤바와 말줄임

- 사이드바 메뉴 영역(`[data-slot="sidebar-content"]`)에는 `no-scrollbar`(`scrollbar-width: none`)가 붙어 있다. 그래서 스크롤이 생겨도 막대가 폭을 차지하지 않는다(실측 막대 폭 0px).
- 1280×800에서는 메뉴 영역이 넘치지 않는다. ADMIN은 596/596px, SALES는 630/630px다. 높이 560에서는 454/356px로 스크롤되고, 메뉴 이름은 132/132px 그대로다.
- 헤드리스 기본값 `--hide-scrollbars`를 빼고 페이지 전체에 폭 17px 스크롤바를 강제로 그렸다(Windows 기본 막대와 비슷한 폭).
  - 1280×800·1280×560 모두 사이드바 폭 256px, 메뉴 칸 219px, "인력 배치 시뮬레이션" 132/132px로 바뀌지 않았다.

## 화면

| 파일 | 내용 |
|---|---|
| `20261026-admin-expanded-1440.png`·`-1280.png` | 펼친 사이드바: 묶음 줄(화살표+회색 굵은 글자), 세로선 안쪽 메뉴, 글자 왼쪽 아이콘, 회색 바탕 활성 |
| `20261026-admin-group-collapsed-1440.png` | 분석 묶음을 접은 상태(▸ 분석, 목록 숨김) |
| `20261026-admin-collapsed-1440.png` | 접은 64px 줄(분석 묶음을 접어 둔 채로도 아이콘 10개, 묶음 사이 짧은 선) |
| `20261026-sales-expanded-1280.png` | SALES `/org-chart`: 회사 묶음의 조직도 활성, 아래 고정 칸은 설정만 |
| `20261026-admin-scrolling-1280x560-sidebar.png` | 높이 560에서 메뉴 영역이 스크롤되는 사이드바(막대 없음, 고정 칸 자리 그대로) |

## 관련 문서

- [[06-UI-UX|06 UI]] §4.1(2026-10-26 2차 결정)
- [[16-DECISIONS|ADR-021]] 2026-10-26 2차 개정
- [[2026-10-26-design-declutter-plan|AI 티 걷어내기 계획]]
- [[11-TESTING|11 테스트]] NAV-10
- [[PROGRESS|진행 상황]]
