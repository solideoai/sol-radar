---
title: "N9 대시보드 카드 5개 — 남은 일 계획"
doc: plan
status: draft
tags:
  - sol-radar
  - ui
  - test
updated: 2026-10-21
---

# N9 대시보드 카드 5개 — 남은 일 계획

확장 컷 N9([사이드바 설계](2026-10-16-sidebar-ia-design.md) §2.3·§3 N9, [[06-UI-UX|06 UI]] §5.3, [[11-TESTING|11]] NAV-06)의 남은 일이다. 브랜치 `feat/n9-analysis-card`(worktree `sol-radar-worktrees/n9-dashboard-card`, base main `4e62170`).

확장 컷을 핵심 컷과 함께 진행하는 조건(사용자 결정 2026-10-21, BOOST-2 와 같음)을 지킨다.

- 덧붙이기만 하고, 핵심 컷의 코드 경로·계약을 바꾸지 않는다.
- 작업자가 겹치면 핵심 컷이 먼저다.
- freeze 10-23 까지 green 이 아니면 데모에서 뺀다.
- 승률·확률 표시, 모바일, 결제는 하지 않는다.

## 1. 지금 상태

카드 5개는 C6(`e900385`)에 이미 있다. 다섯 번째 "분석 현황" 카드의 상태는 아래와 같다.

| 항목 | 상태 | 근거 |
|---|---|---|
| 값·힌트 | 값 = 완료 건수, 힌트 "부분 N · 실패 N", 0건이면 "아직 분석한 공고가 없습니다" | `web/app/(app)/(work)/dashboard/dashboard-view.tsx:77-85` |
| 집계 | 공고별 끝난 분석(COMPLETED·PARTIAL·FAILED) 중 최신 1건. QUEUED·RUNNING 은 세지 않는다 | `web/server/bids/dashboard.service.ts:52·71-80` |
| API | `DashboardSummary.analyses.latestByStatus` | `web/server/bids/dashboard.model.ts:43`, [[05-API-SPEC|05]] §4.6 |
| S2 값 | "완료 18 · 부분 0 · 실패 0" 리허설 확인 | `docs/evidence/demo-day/20261020-1009/checklist.md` 6행 |
| 시험 | 화면 5칸·0건 힌트(browser), RUNNING 제외·FAILED 따로(service) | `dashboard-view.browser.test.tsx`, `dashboard.service.test.ts` |

N9 완료 기준 중 남은 것은 셋이다.

1. **슬롯 정의 한 곳**: 설계 §2.3 "카드 정의는 코드 한 곳(카드 슬롯 배열)", 06 부품 표 `DashboardCardSlots`. 지금은 JSX 안에 다섯 줄로 흩어져 있다.
2. **NAV-06 시험**: "같은 공고 `force` 재분석 뒤 이중 집계 없음". `latestByStatus` 를 같은 공고의 끝난 run 여러 건으로 확인하는 시험이 없다. 지금 시험은 권고(`byRecommendation`)만 본다.
3. **실제 화면 증거**: 1440·1280 두 폭에서 재분석 뒤 카드 값.

## 2. 판단 (추천안대로 진행)

**"공고별 최신 1건"은 끝난 분석 중 최신으로 둔다(지금 구현 유지).**

- 설계 §2.3 문장("가장 최근 `created_at` 1건 … 그 1건이 QUEUED·RUNNING 이면 세지 않는다")은 재분석이 도는 동안 카드가 1 줄어든다고 읽힐 수 있다.
- 구현과 기존 시험은 재분석이 도는 동안 앞의 끝난 분석을 센다. [[05-API-SPEC|05]] §4.6 주석("공고별 최신 score_runs 1건 기준, QUEUED·RUNNING 제외")은 두 해석 모두 된다.
- 유지하는 까닭:
  - BID 권고·검토 대기(ADR-029 A6 D10·D11)와 같은 기준이다. 한 화면의 카드 다섯 개가 같은 "최신"을 쓴다.
  - S4·S6 라이브 분석 중에 숫자가 흔들리지 않는다.
  - 핵심 컷의 계약을 바꾸지 않는다.
- 설계 §2.3 문장 정리는 정본 담당(45)에 넘긴다: "공고별 끝난 분석(COMPLETED·PARTIAL·FAILED) 중 최신 1건. 진행 중(QUEUED·RUNNING) run 은 세지 않고 앞의 끝난 분석을 센다".

## 3. 범위 밖

- 다른 카드 네 개의 값·모양, 카드 모양(StatCard), 표 두 개.
- API 계약(`DashboardSummary`)과 집계 코드(`dashboard.service.ts`). 시험만 더한다.
- 마이그레이션(없음), 사이드바·앱 셸(`app-nav`·`app-shell`, fa 담당).
- 다섯 번째 슬롯의 "진행 중 입찰 프로젝트" 교체(N6, P1).

## 4. 단계

| 단계 | 고칠 파일 | 완료 기준 |
|---|---|---|
| 1. 슬롯 정의 | 새 `web/app/(app)/(work)/dashboard/dashboard-card-slots.ts`·`.test.ts` | `DASHBOARD_CARD_SLOTS` 5개(id·이름·값 함수), 순서 BID 권고 → 검토 대기 → 마감 임박 → 수집 → 분석 현황. 수집 카드 계산(`ingestCard`)을 이곳으로 옮긴다. 시험: 순서·이름, S2 값, 0건 힌트, 부분·실패 힌트, 수집 실패 위험 색 |
| 2. 화면 연결 | `dashboard-view.tsx`(`SummaryCards` 가 슬롯을 그린다) | 그려지는 DOM 이 같다. 기존 `dashboard-view.browser.test.tsx` 를 고치지 않고 통과한다 |
| 3. NAV-06 시험 | `web/server/bids/dashboard.service.test.ts`(시험만 추가) | 같은 공고 COMPLETED → PARTIAL(`force`) = 부분 1, FAILED → COMPLETED = 완료 1, 같은 시각 두 건 = 뒤 행, 재분석 RUNNING 중 = 앞의 끝난 run, 공고 여러 건의 합 = 분석된 공고 수. 집계를 "모든 run 세기"로 바꾸면 실패하는지 변형으로 확인한다 |
| 4. 실제 화면 | `docs/evidence/phase-3/n9-dashboard-cards/` | 격리 Supabase(공용 54321·클라우드 안 씀) + `demo:reset` + 같은 공고에 끝난 run 두 건. 1440·1280 스크린샷, 카드 값이 이중 집계 없이 나온다 |
| 5. 검증·기록 | `docs/PROGRESS.md`(N9 체크·작업 로그) | `pnpm verify`(검증 슬롯), 대시보드 browser 시험 통과. 기준점 해시와 결과를 3e 에 보낸다 |

카드 모양은 바꾸지 않는다. web-designer 가 지금 카드를 06 §5.3·C6 설계와 대조해 확인했다(2026-10-21). 결론은 "N9 범위에서는 지금 모양 그대로"다. 상태 다섯 개(0건·완료만·부분·실패 있음·실패만·재분석 진행 중), 읽는 순서(이름 → 값 → 힌트), 색에 기대지 않음, 두 폭의 "부분 N · 실패 N" 한 줄이 모두 정본과 맞다.

정본 문구를 바꿔야 하는 제안 두 건은 이번에 하지 않고 정본 담당에 넘긴다.

| 제안 | 까닭 | 바뀌는 것 |
|---|---|---|
| 이름 "분석 현황" → "분석 현황 (완료)" | 값이 완료 건수인데 화면과 화면 읽기 어디에도 "완료"가 없다. S6 뒤 "17 · 부분 1"에서 17이 전체인지 완료만인지 헷갈린다. 같은 줄 "마감 임박 (7일)"과 같은 꼴이다 | 06·19 문구, browser 시험 기대값. S2 숫자는 그대로 |
| 0건 힌트 "아직 분석한 공고가 없습니다" → "분석 기록 없음" | 1280 카드 안쪽 145px 에서 두 줄로 꺾일 것으로 추정한다(실측 안 함). 수집 카드 "수집 기록 없음"과 짝이다 | 06 §5.3 빈 상태 문구, 시험 기대값. 데모 S2 는 0건이 아니라 영향 없음 |

## 관련 문서

- [[06-UI-UX|06 UI]] §5.3 대시보드
- [[05-API-SPEC|05 API]] §4.6 DashboardSummary
- [[11-TESTING|11 테스트]] §9 NAV-06
- [[12-ROADMAP|12 로드맵]] 확장 컷
- [[16-DECISIONS|16 결정]] ADR-021·023·029
- [[PROGRESS|진행 상황]]
