---
title: "목록 화면 이동 지연 원인과 조치 (2026-10-29)"
doc: "evidence-20261029-list-rpc-latency"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-10-29
---

# 목록 화면 이동 지연 원인과 조치 (2026-10-29)

사용자 보고: 운영에서 사이드바로 `/bids`·`/watchlist`·`/dashboard`를 열면 한 번에 5~7초 걸린다. 직전 조치(함수 지역 `syd1`, 렌더 한 번에 프로필·조직 한 번 읽기)는 [[20261028-region-latency|10-28 화면 이동 지연 기록]]이다.

## 원인

지역이 아니라 목록 화면이 부르는 RPC 두 개다. 목록 커서의 데이터 버전 `procurement_dataset_version(p_org_id)`는 조직의 뷰 `opportunity_list_items` 행 전체를 `to_jsonb`로 해시한다(`supabase/migrations/20261023000200_procurement_reads.sql`, 호출은 `web/server/opportunities/repo.ts:141`). 목록 한 번에 앞뒤로 두 번 돈다. 필터 선택지 `procurement_filter_options(p_origin)`는 `20261029000300_it_bid_scope` 뒤 공고마다 `it_scope()` 하위 조회 2개를 돈다(호출은 `repo.ts:343`). 둘 다 사업기회 건수에 비례해 느려진다.

운영 Supabase `brtysdocxemrqhdezzqg`에서 2026-10-29에 쟀다.

| 근거 | 값 |
|---|---|
| 함수 지역과 Supabase 호출 | 함수 지역 `syd1`, Supabase 호출 p50 14ms(SYD·authenticated 1.9만 건). 지역은 원인이 아니다 |
| `/bids` 이동 한 번(23:00:44 KST 로그) | `procurement_dataset_version` 2.6초 → 목록 `opportunity_list_items` 2.1초 → `procurement_dataset_version` 2.6초가 차례로 돈다. 그동안 `procurement_filter_options`가 6.1초 걸린다 |
| authenticated 역할로 함수 하나씩 | version 921ms·summary 585ms·live_metrics 345ms·filter_options 1,685ms. 운영에서는 동시에 돌아 더 느리다 |
| 시간대별 p50(KST, version·filter_options) | 10-28 23시 263ms·23ms, 10-29 16시 1.8초·3.3초, 10-29 23시 2.6초·6.1초 |
| 사업기회 건수 | 3,309건, 하루 800~1,200건씩 는다. 뷰 전체를 계산하는 비용은 건수에 비례해 커진다 |
| 원본 표 해시 시제품(authenticated) | 18.6ms(뷰 해시 921ms) |

## 조치

결정은 [[16-DECISIONS|ADR-070]]이다.

1. `procurement_dataset_version` 본문만 뷰 전체 해시에서 원본 표 9개 값(건수와 열 해시)의 `md5`로 바꾼다. 서명·반환형·권한이 같아 웹 코드는 그대로다(`supabase/migrations/20261029000500_list_dataset_version.sql`).
2. `loadOpportunityFilters`(`web/app/_lib/opportunity-data.ts`)가 필터 선택지를 Next 서버 데이터 캐시(`unstable_cache`, 10분, 태그 `opportunity-filter-options`)에 출처별로 둔다. 캐시 안에서도 요청 사용자의 Supabase client를 쓴다.

## 조치 뒤

| 항목 | 조치 전 | 조치 뒤 |
|---|---|---|
| `procurement_dataset_version` p50 | 2.6초(10-29 23시) | |
| `procurement_filter_options` p50 | 6.1초(10-29 23시) | |
| `/bids` 이동 한 번의 Supabase 대기 | 2.6초 + 2.1초 + 2.6초 차례(그동안 filter_options 6.1초) | |

완료 기준: version p50 50ms 이하, `/bids` 이동 한 번의 Supabase 대기 2.5초 이하, 같은 10분 안 두 번째 `/bids` 방문에서 `procurement_filter_options` 호출 없음. 잴 때는 Supabase edge 로그(`request.cf.colo='SYD'`)를 쓴다.

배포 뒤 함께 볼 것:

- Vercel `services` 배포(`vercel.json`)에서 서버 데이터 캐시가 인스턴스 사이에 공유되는지. `/bids` 방문 수 대비 `procurement_filter_options` 호출 수로 센다. 같은 배포에서 `/_next/image`가 404였다.
- RPC 오류가 캐시에 남지 않는지. `unstable_cache`는 throw를 캐시하지 않지만 시험의 가짜 캐시로는 증명되지 않는다.

## 남은 것

- 목록 뷰 `opportunity_list_items` 자체의 1~2초(10-29 23시 로그 2.1초). 미리 계산해 두려면 수집 Worker까지 바꿔야 한다. 사용자가 이번 범위에서 고르지 않았다.
- 대시보드 `procurement_summary`·`procurement_live_metrics`는 캐시하지 않는다. 대시보드 규칙 M4("BID 권고" 카드와 BID 표 숫자가 갈라지지 않는다)와 새로 고침 버튼(`OpportunityRefresh`)이 캐시 동안 깨진다. 버전 확인 4번이 빠지면 동시 부하도 준다.
- 클라이언트 라우터 캐시(`experimental.staleTimes.dynamic`)는 쓰지 않는다. `router.refresh()`는 지금 경로의 캐시만 지운다. `/bids`에서 관심 등록 뒤 30초 안에 `/watchlist`로 가면 옛 목록이 보인다. 라이브 시연에서 틀린 화면이 더 나쁘다.
- Supabase 서울 이전: 원인이 네트워크가 아니다. 발표(2026-11-04) 뒤 일정 그대로다.

## 관련 문서

- [[20261028-region-latency|10-28 화면 이동 지연 기록]]
- [[16-DECISIONS|ADR-070]]
- [[10-DEPLOYMENT|10 배포]]
- [[PROGRESS|진행 상황]]
