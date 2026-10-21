---
title: "N9 대시보드 카드 5개 검증 (2026-10-21)"
doc: evidence
status: draft
tags:
  - sol-radar
  - test
  - ui
updated: 2026-10-21
---

# N9 대시보드 카드 5개 검증

브랜치 `feat/n9-analysis-card`(worktree `sol-radar-worktrees/n9-dashboard-card`, base main `4e62170`). 계획은 [N9 계획](../../../plans/2026-10-21-n9-analysis-card-plan.md), 설계는 [사이드바 설계](../../../plans/2026-10-16-sidebar-ia-design.md) §2.3, 시험 기준은 [[11-TESTING|11]] §9 NAV-06 이다.

## 무엇을 바꿨나

- 카드 5개는 C6(`e900385`)에 이미 있었다. 값·계산·API 는 바꾸지 않았다.
- 카드 정의(이름·값·힌트·색)를 슬롯 배열 한 곳에 모았다: `web/app/(app)/(work)/dashboard/dashboard-card-slots.ts` 의 `DASHBOARD_CARD_SLOTS`(06 부품 표 `DashboardCardSlots`). 화면(`dashboard-view.tsx`)은 배열을 차례로 그리기만 한다. 다섯 번째 슬롯을 입찰 프로젝트(N6)로 바꿀 때는 마지막 항목 하나와 `DashboardSummary` 필드 하나만 바뀐다.
- NAV-06 시험을 더했다(`web/server/bids/dashboard.service.test.ts`). 집계 기준은 "공고별 끝난 분석(COMPLETED·PARTIAL·FAILED) 중 최신 1건, 진행 중 run 은 건너뛴다"이다(정본 문장은 45 `docs/sync-6-2-45` `61e9e22`).

## 시험

| 시험 | 결과 |
|---|---|
| `pnpm -C web exec vitest run server/bids/dashboard.service.test.ts "app/(app)/(work)/dashboard/dashboard-card-slots.test.ts"` | 2 파일 · 31 passed(NAV-06 10건, 슬롯 9건 새로 더함) |
| 변형 확인: ① 공고마다 모든 끝난 run 세기 ② 진행 중 run 도 최신으로 고르기 ③ 가장 이른 run 고르기 | 각각 6 · 3 · 7건 실패로 잡힘(원복 뒤 통과) |
| `pnpm -C web exec vitest run --config vitest.browser.config.ts "app/(app)/(work)/dashboard/dashboard-view.browser.test.tsx"`(검증 슬롯) | 17 passed. 시험 파일은 고치지 않았다(그려지는 DOM 이 같다) |

전체 `pnpm verify` 결과는 [[PROGRESS|진행 상황]] 작업 로그 행에 적는다.

## 실제 앱 확인

격리 Supabase(scratchpad 사본 `sol-radar-n9card`, API 59751, 마이그레이션 `20261019000019` 까지) + `pnpm demo:reset`(seed: orgs=2 users=5 people=200 bids=19 quarantined=1 reviews=2) + worktree `next dev -p 3215`(공개 키와 임시 `API_CURSOR_SECRET` 만 넘김). 공용 54321·클라우드는 쓰지 않았다. 키는 `supabase status` 에서 읽어 자식 프로세스 환경으로만 넘겼고 파일에 쓰지 않았다. 확인 뒤 dev 서버·격리 스택·볼륨을 내렸다.

> [!warning] 분석 행은 worker 가 아니라 격리 DB 에 직접 넣었다
> `demo:reset` 은 분석을 넣지 않는다(사전 분석은 `pnpm demo:preanalyze` 가 worker·gateway 로 한다). 이번에는 worker·gateway 를 띄우지 않고 org-01 의 `score_runs` 행을 SQL 로 넣어 사전 분석·재분석 상황을 만들었다. 카드가 읽는 열(status·recommendation·score·created_at)만 뜻이 있고, 입력 스냅숏은 자리 값이다.

로그인 계정은 admin(ADMIN, org-01)이다. 촬영 직전마다 Next 개발 표시(`nextjs-portal`)를 숨겼다.

| 파일 | 단계·폭 | DB 의 org-01 분석 | 분석 현황 카드 |
|---|---|---|---|
| `dashboard-0-no-analysis-1440.png` | seed 직후 · 1440 | 0건 | 0 · "아직 분석한 공고가 없습니다"(한 줄) |
| `dashboard-0-no-analysis-1280.png` | seed 직후 · 1280 | 0건 | 0 · 같은 문구가 **두 줄로 꺾임**(카드 폭 179px, 잘림·넘침 없음) |
| `dashboard-1-s2-1440.png`, `-1280.png` | S2 사전 분석(FX-02 제외 18건 COMPLETED, BID = FX-01·FX-18·FX-06) | run 18 · 공고 18 | **18 · 부분 0 · 실패 0** (19 S2 기대값) |
| `dashboard-2-force-rerun-1440.png`, `-1280.png` | FX-01 force 재분석 COMPLETED 한 건 더 + FX-18 재분석 RUNNING | run 20 · 공고 18 | **18 · 부분 0 · 실패 0** (모든 run 을 세면 19) |
| `dashboard-3-s6-partial-1440.png`, `-1280.png` | FX-01 재분석이 PARTIAL 로 끝남(S6) | run 21 · 공고 18 | **17 · 부분 1 · 실패 0** (19 S2 주석 "S6 뒤") |

다른 카드 값(BID 권고 3 · 검토 대기 16 · 마감 임박 1 · 수집 "적재 19 · 격리 1")은 S2 부터 끝까지 같았다. 여덟 장 모두 가로 넘침이 없다. 브라우저 콘솔 오류 20건은 모두 `/health/ready` 503 이다(AI gateway 를 띄우지 않음, dev 서버 로그로 경로 확인).

## 본 것 (N9 범위 밖)

- **재분석 중 BID 권고 표의 "—"**: `dashboard-2·3` 에서 FX-18 은 최신 run 이 RUNNING 이다. 그래서 BID 권고 표 둘째 줄의 SOL Score·권고가 "—"로 보인다. BID 권고 카드는 3 그대로다. 공고 목록(`/bids` 표·`latestAnalysis`)의 기존 동작이고 이번 변경과 무관하다. 3e 에 관찰로 넘겼다.
- **1280 빈 상태 문구 꺾임**: 위 표 둘째 줄. web-designer 가 짧은 문구("분석 기록 없음")와 이름 "분석 현황 (완료)"를 제안했다. 정본 문구를 바꾸는 일이라 이번에 하지 않고 정본 담당에 넘겼다([N9 계획](../../../plans/2026-10-21-n9-analysis-card-plan.md) §4 아래 표). 데모 S2 는 0건이 아니라 영향이 없다.

## 관련 문서

- [[06-UI-UX|06 UI]] §5.3 대시보드
- [[11-TESTING|11 테스트]] §9 NAV-06
- [[19-DEMO-SCENARIO|19 데모 시나리오]] S2
- [[PROGRESS|진행 상황]]
