---
title: "목록 화면 이동 지연 원인과 조치 (2026-10-29)"
doc: "evidence-20261029-list-rpc-latency"
status: done
tags:
  - sol-radar
  - ops
updated: 2026-10-30
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
| `procurement_dataset_version` | 2.6초(10-29 23시 p50) | 22~117ms(10-29 23:58 KST 사이드바 이동) |
| `procurement_filter_options` | 6.1초(10-29 23시 p50) | 배포 뒤 첫 호출 2,582ms, 두·세 번째 `/bids` 방문은 호출 없음(캐시) |
| `/bids` 이동 한 번의 Supabase 대기 | 2.6초 + 2.1초 + 2.6초 차례(그동안 filter_options 6.1초) | 첫 방문 약 2.6초(캐시가 빈 filter_options), 다음부터 약 0.65초(version 22ms → 목록 597·355ms 병렬 → version 24ms) |
| `/dashboard` Supabase 대기 | 측정 없음 | 약 1.6초(summary 1,583ms·live_metrics 1,216ms·목록 72~1,324ms 병렬) |
| `/watchlist` Supabase 대기 | 측정 없음 | 약 0.1초(version 23ms·목록 31·25ms) |

완료 기준: version p50 50ms 이하, `/bids` 이동 한 번의 Supabase 대기 2.5초 이하, 같은 10분 안 두 번째 `/bids` 방문에서 `procurement_filter_options` 호출 없음. 잴 때는 Supabase edge 로그(`request.cf.colo='SYD'`)를 쓴다.

결과(운영 DB `20261029000500`·main `a9d3a107` 반영 뒤, 관리자 계정 한 명의 사이드바 이동): version과 두 번째 방문 캐시는 기준을 넘었다. `/bids` 대기는 캐시가 찬 뒤 0.65초이고, 배포 직후 첫 방문만 2.6초로 기준을 조금 넘었다. 사용자는 "약간 빨라졌지만 빠르다는 느낌은 없다"고 했다. 아래 2차 조치로 이어진다.

배포 뒤 함께 볼 것:

- Vercel `services` 배포(`vercel.json`)에서 서버 데이터 캐시가 인스턴스 사이에 공유되는지. `/bids` 방문 수 대비 `procurement_filter_options` 호출 수로 센다. 같은 배포에서 `/_next/image`가 404였다.
- RPC 오류가 캐시에 남지 않는지. `unstable_cache`는 throw를 캐시하지 않지만 시험의 가짜 캐시로는 증명되지 않는다.

## 2차 조치 (2026-10-30)

남은 대기의 원인은 IT 판정 함수 호출이다. 운영에서 authenticated 역할로 읽기만 해서 쟀다(사업기회 3,324건).

| 근거 | 값 |
|---|---|
| 함수 하나씩(단독) | summary 615ms(IT 범위 행 계산 약 220ms + 중복 후보 265ms)·live_metrics 351ms·filter_options 1,729ms |
| 판정 함수 `it_scope_of` 호출 대 같은 식 풀어 쓰기 | 165ms 대 11ms(결과 570건 같음) |
| 중복 후보 수: 공고마다 `it_scope(b)` 대 조인 | 265ms 대 38ms(27건 같음) |
| filter_options: 공고마다 `it_scope(b)` 대 조인 | 1,729ms 대 197ms(결과 jsonb 같음) |

원인은 두 가지다.

1. 뷰의 판정·정렬 함수 다섯 개(`20261029000300`)는 `set search_path=''`가 붙어 planner가 SQL 함수를 풀어 넣지 못하고 행마다 부른다. `opportunity_recommend_key`는 immutable인데 본문이 stable 함수(to_char·extract)를 쓴다. `opportunity_priority_tier`는 연산자가 많은 분야 인자를 본문에서 두 번 읽는다. 둘 다 그대로는 풀리지 않는다.
2. summary의 중복 후보 수와 filter_options는 공고마다 `it_scope(b)`(하위 조회 2개)를 부른다.

조치(`supabase/migrations/20261030000100_inline_it_scope.sql`): 다섯 함수를 같은 서명·같은 값의 SQL 표준 본문(`return`)으로 다시 만든다. 본문 이름은 만들 때 고정되므로 search_path를 두지 않는다. `opportunity_recommend_key`·`opportunity_priority_tier`는 stable로 바꾸고, 분야 인자는 한 번만 읽는다. summary·filter_options는 `it_scope(b)`만 최신 revision·최신 관련성 조인으로 바꾼다. 웹 코드는 바뀌지 않는다. 시험은 `scripts/database.test.mjs` "IT 범위 판정·정렬 함수는 목록 뷰에 풀려 들어가고…"(마이그레이션을 빼면 실패 확인)와 기존 IT 범위·집계 시험이다.

| 항목 | 2차 조치 전(10-29 23:58 KST) | 2차 조치 뒤 |
|---|---|---|
| `/dashboard` Supabase 대기 | 약 1.6초 | 약 0.75초(summary 569~708ms·live_metrics 677~770ms·목록 94~751ms 병렬, 3회) |
| `/bids` Supabase 대기(캐시 찬 뒤) | 약 0.65초 | 약 0.4초(version 22~26ms → 목록 200~347ms 병렬 → version 22~26ms, 3회) |
| summary·live_metrics·filter_options 단독 | 615·351·1,729ms | 216·184·86ms(결과 같음: IT 범위 551건·중복 후보 27건·기관 305곳) |
| 목록 50건(추천순 정렬) 단독 | 측정 없음 | 127ms |

2차 조치 뒤 숫자는 운영 DB `20261030000100` 적용(db-push 미적용 0개·`db-verify` 마이그레이션 70개 통과) 뒤 2026-10-30 00:23 KST 관리자 계정의 사이드바 이동 edge 로그와 authenticated 단독 측정이다. 대시보드는 RPC 여러 개가 동시에 돌아 단독보다 2~4배 느리다.

Supabase advisor는 search_path를 두지 않은 다섯 함수를 `function_search_path_mutable`로 알린다. 다섯 함수 모두 security invoker이고 본문 이름이 고정돼 있다. `scripts/db-verify.mjs`의 search_path 고정 검사는 SECURITY DEFINER 함수만 본다.

## 남은 것

- 목록 뷰 `opportunity_list_items`를 미리 계산해 두기. 수집 Worker까지 바꿔야 한다. 2차 조치 뒤 숫자를 보고 다시 판단한다.
- 달력·공백 분석·공고 고르기 뷰 `bid_list_items`는 아직 공고마다 `it_scope(b)`를 부른다. 시연 동선(로그인 → 대시보드 → 입찰공고)에 없어 2차 조치에서 뺐다.
- 대시보드 `procurement_summary`·`procurement_live_metrics`는 캐시하지 않는다. 대시보드 규칙 M4("BID 권고" 카드와 BID 표 숫자가 갈라지지 않는다)와 새로 고침 버튼(`OpportunityRefresh`)이 캐시 동안 깨진다. 버전 확인 4번이 빠지면 동시 부하도 준다.
- 클라이언트 라우터 캐시(`experimental.staleTimes.dynamic`)는 쓰지 않는다. `router.refresh()`는 지금 경로의 캐시만 지운다. `/bids`에서 관심 등록 뒤 30초 안에 `/watchlist`로 가면 옛 목록이 보인다. 라이브 시연에서 틀린 화면이 더 나쁘다.
- Supabase 서울 이전: 원인이 네트워크가 아니다. 발표(2026-11-04) 뒤 일정 그대로다.

## 관련 문서

- [[20261028-region-latency|10-28 화면 이동 지연 기록]]
- [[16-DECISIONS|ADR-070]]
- [[10-DEPLOYMENT|10 배포]]
- [[PROGRESS|진행 상황]]
