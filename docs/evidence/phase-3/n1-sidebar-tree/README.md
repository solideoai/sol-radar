---
title: "N1 사이드바 트리 검증 (2026-10-20)"
status: draft
tags:
  - sol-radar
  - test
  - ui
updated: 2026-10-20
---

# N1 사이드바 트리 검증

브랜치 `feat/sidebar-tree`(worktree `sol-radar-worktrees/sidebar-tree`, base main `9048995`). 설계는 [[06-UI-UX|06 UI]] §4·§4.1과 [사이드바 설계](../../../plans/2026-10-16-sidebar-ia-design.md) §2.1·§8(2026-10-20 행)이다.

## 무엇을 만들었나

- 메뉴 정의 한 곳(`web/components/app-nav.ts`): 묶음 5개(업무·AI 분석·입찰 관리·조직·시스템), 메뉴 11개 + 맨 아래 고정 칸 조직도. 메뉴마다 `released`/`planned`.
- 준비 중(`planned`) 메뉴 5개(관심 공고·분석 결과 비교·인력 배치 시뮬레이션·입찰 프로젝트·회사 역량)는 링크 없이 "준비 중"으로 보인다(사용자 결정 2026-10-20). 경로는 페이지가 없어 404 그대로다.
- main `e92e4a6`(회사 역량 `/company` 포함)을 합친 뒤 회사 역량을 `released` 로 바꿨다. 준비 중은 4개(관심 공고·분석 결과 비교·인력 배치 시뮬레이션·입찰 프로젝트)다. 아래 스크린샷은 그 전(준비 중 5개)에 찍었다.
- 데이터 수집 관리는 업무 역할 ADMIN 에게만 보인다. 세 레이아웃(`(work)`·`people-read`·`[slug]`)이 `sol_role` 을 틀에 넘긴다.
- 묶음 줄 접기(`aria-expanded`·`aria-controls`), 접힘 상태는 `localStorage` 에만 저장(실패해도 정상), 지금 화면의 묶음은 들어올 때 펼침.
- 활성 메뉴: `sidebar-accent` 바탕 + 트리 세로선 자리 3px `brand` 막대 + `aria-current="page"`.
- 접은 사이드바 64px 아이콘 줄: 묶음 줄 숨김, 묶음 사이 짧은 선, 툴팁(마우스·키보드 초점), 링크 `aria-label`.
- 설정 메뉴는 `/settings`(템플릿 `/{slug}/settings` 로 넘어감)이고, 템플릿 설정 경로에서도 활성으로 보인다.

## 시험

| 시험 | 결과 |
|---|---|
| `pnpm -C web exec vitest run components/app-nav.test.ts lib/stores/sidebar-groups.test.ts` | 30 passed |
| `pnpm -C web exec vitest run "app/(app)/[slug]/layout.test.ts"` | 8 passed(역할 전달 2건 추가, 보완 전 업무 조회 없음 단언 추가) |
| `pnpm -C web exec vitest run --config vitest.browser.config.ts components/app-shell.browser.test.tsx` | 22 passed(NAV-10 11건 포함, Pretendard 로 글자 폭 측정) |
| 변형 확인: 접기 `hidden` 제거·아이콘 폭 3rem·막대 폭 제거·들어올 때 펼침 제거 | 4건 실패로 잡힘(원복 뒤 통과) |
| 변형 확인: 아이콘 줄 사용자 칸 가운데 정렬 제거 | 1건 실패로 잡힘 |
| `pnpm -C web verify:quick` | exit 0, 210 파일 · 6,743 시험, lodestar·토큰·색 검사 통과 |
| `pnpm verify`(루트, 빌드 포함) | exit 0. 루트 729 · web 6,743 · `next build` 성공 |
| `pnpm -C web test:browser` | 32 파일 · 447 passed. 첫 실행에서 `people/person-drawer.browser.test.tsx` 초점 복귀 1건이 시간 초과로 실패했고(이번 변경과 무관한 파일, 다른 세션 검증과 동시 실행 중), 단독 3회·전체 재실행 모두 통과 |

## 실제 앱 확인

격리 Supabase(scratchpad 사본, API 59731) + `pnpm demo:reset -- --env-file`(seed: orgs=2 users=5 people=200 bids=19 quarantined=1) + worktree `next dev -p 3014`. 확인 뒤 dev 서버·격리 스택·볼륨을 지웠다. 공용 54321 은 쓰지 않았다.

| 파일 | 계정·폭 | 본 것 |
|---|---|---|
| `app-dashboard-admin-1440.png` | admin · 1440 | 묶음 5개, 준비 중 5개, 데이터 수집 관리 보임, 대시보드 활성 |
| `app-ingestion-admin-1280.png` | admin · 1280 | 가장 긴 줄 "인력 배치 시뮬레이션 준비 중" 말줄임 없음, 가로 넘침 없음 |
| `app-icon-rail-1280.png` | admin · 1280 | 64px 아이콘 줄, 묶음 사이 선, "입찰 공고" 툴팁, 위 막대에 조직 이름 |
| `app-groups-collapsed-1280.png` | admin · 1280 | AI 분석·입찰 관리를 접고 새로고침 → 접힘 유지, 지금 화면 묶음(시스템)은 접었어도 펼침 |
| `app-settings-viewer-1280.png` | viewer · 1280 | 데이터 수집 관리 숨김, `/org-01/settings` 에서 설정 활성 |

브라우저 콘솔 오류는 `/health/ready` 503 뿐이다(AI gateway 를 띄우지 않음). 하이드레이션 오류 없음. 화면 왼쪽 아래 "N" 동그라미는 Next 개발 도구 버튼이다.

## 남은 것

- 정본 반영(e8 담당): [[16-DECISIONS|16]] ADR-021 M22 개정(준비 중 메뉴 노출), [[06-UI-UX|06]] §4·§4.1 노출 문장과 64px 접힘 구현 상태, [[11-TESTING|11]] §9 NAV-10.
- 로그인 E2E(`test:e2e:auth`·`test:e2e:work`)는 돌리지 않았다(격리 Supabase 로 실제 화면만 확인).
- 같은 `app-shell.tsx` 의 `UserMenu` 를 worktree `sidebar-user-height`(다른 세션, 미커밋)도 고친다. 나중에 병합하는 쪽이 main 을 합쳐 두 변경을 모두 남기고 `test:browser` 를 다시 돌린다(3e 합의).
- N1 의 나머지(조직 주소 없는 경로 정리·`/ops` 분리)는 이번 범위 밖이다.

## 관련 문서

- [[06-UI-UX|06 UI]]
- [[PROGRESS|진행 상황]]
