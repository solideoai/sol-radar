---
title: "공고 0건 빈 상태 [수집 실행] 단추 (미결정 26-6, 2026-10-21)"
status: done
tags:
  - sol-radar
  - test
  - phase-3
  - evidence
updated: 2026-10-21
---

# 공고 0건 빈 상태 [수집 실행] 단추

`/dashboard` 와 `/bids`(조건 없는 목록)에서 공고가 한 건도 없을 때의 빈 상태를 역할별로 1440·1280px 두 폭에서 찍었다. 근거는 06 §5.3 빈 상태 행과 16 미결정 26-6 행이다. 대상은 브랜치 `fix/empty-state-ingest`(기점 main `d116c66`)다. 스크린샷은 `5628c35` 위에서 찍었다. 그 뒤 main 변경은 `docs/` 뿐이라 화면 코드는 같다.

- ADMIN: "아직 수집된 공고가 없습니다" 아래 [수집 실행] 단추(outline, 36px)가 있다. 누르면 `/admin/ingestion` 으로 간다. 그 화면의 [수동 수집 실행] 대화상자에서 수집을 돌린다.
- ADMIN 이 아닌 역할(SALES·ANALYST·VIEWER): 단추가 없고 "관리자에게 수집을 요청하세요" 안내만 있다. 스크린샷은 SALES 로 찍었다.
- 조건이 있는데 0건인 목록("조건에 맞는 공고가 없습니다" + [필터 초기화])은 바꾸지 않았다.

## 찍은 방법

- DB 없이 브라우저 부품 시험(Vitest 브라우저 모드, Chromium)으로 그렸다. 실제 DB 를 비우지 않았고 클라우드·`54321` Supabase 를 쓰지 않았다.
- 화면은 업무 틀(`AppShell`, 사이드바 펼침, `solRole` 은 ADMIN·SALES) + `AppPage` + 화면 본문(`DashboardView`·`BidListView`)이다. 조직은 "솔리데오", 사용자 이름은 "데모 관리자"·"데모 영업"이라는 가짜 값을 넣었다. 사이드바의 "데이터 수집 관리"도 ADMIN 에게만 보여서 단추 규칙과 같다.
- 위 막대의 상태 묶음(DEMO·실행 모드·AI·수집·알림)은 그리지 않았다. 실제 화면에서는 `(work)` layout 이 값을 읽어 넣는다.
- 찍는 시험 파일은 증거를 남기는 데만 쓰고 지웠다(커밋하지 않음). 두 폭 모두 `document.documentElement.scrollWidth` 가 화면 폭을 넘지 않는지 확인한 뒤 찍었다.

## 파일

| 역할 | 화면 | 1440 | 1280 |
|---|---|---|---|
| ADMIN | `/dashboard` | `admin/20261021-phase3-dashboard-empty-1440.png` | `admin/20261021-phase3-dashboard-empty-1280.png` |
| ADMIN | `/bids` | `admin/20261021-phase3-bids-list-empty-1440.png` | `admin/20261021-phase3-bids-list-empty-1280.png` |
| SALES | `/dashboard` | `sales/20261021-phase3-dashboard-empty-1440.png` | `sales/20261021-phase3-dashboard-empty-1280.png` |
| SALES | `/bids` | `sales/20261021-phase3-bids-list-empty-1440.png` | `sales/20261021-phase3-bids-list-empty-1280.png` |

파일 이름은 06 §12 의 `YYYYMMDD-phaseN-<route>-<state>-<width>.png` 를 따른다. 역할은 이름에 넣을 자리가 없어 폴더(`admin/`·`sales/`)로 나눴다.

## 시험

- `web/app/(app)/(work)/empty-state.test.ts`: `canRunIngestion` 은 ADMIN 만 true, SALES·ANALYST·VIEWER 는 false.
- `web/app/(app)/(work)/dashboard/dashboard-view.browser.test.tsx`: ADMIN 이면 [수집 실행] 링크가 `/admin/ingestion`(높이 36px)이고 요청 문구가 없다. ADMIN 이 아니면 요청 문구만 있고 단추·링크가 없다.
- `web/app/(app)/(work)/bids/bid-list-more.browser.test.tsx`: 대시보드와 같은 두 갈래를 본다. 조건이 있는 0건은 ADMIN 이어도 [수집 실행]이 없다.
- 변형 확인: 빈 상태의 역할 갈래를 뒤집거나 `canRunIngestion` 을 `!== "ADMIN"` 으로 바꾸면 각각 시험 4개가 실패했다. 확인한 뒤 되돌렸다.

## 관련 문서

- [[06-UI-UX|06 UI]] §5.3·§12
- [[16-DECISIONS|16 결정]] 미결정 26-6
