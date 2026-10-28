---
title: "운영 화면 이동 지연 원인과 조치 (2026-10-28)"
doc: "evidence-20261028-region-latency"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-10-28
---

# 운영 화면 이동 지연 원인과 조치 (2026-10-28)

사용자 보고: 운영에서 사이드바 메뉴나 버튼을 누르면 한 번에 약 3초 걸린다.

## 원인

Vercel 함수가 기본 지역 `iad1`(버지니아)에서 돌았고 Supabase DB는 `ap-southeast-2`(시드니)에 있다. 화면 한 번에 Supabase를 5~6번 차례로 불렀고, 한 번마다 버지니아↔시드니를 오갔다.

| 근거 | 값 |
|---|---|
| 운영 응답 헤더 | `x-vercel-id: icn1::iad1::…`(서울 엣지 → 버지니아 함수) |
| DB 호스트 | `db.brtysdocxemrqhdezzqg.supabase.co` IPv6를 AWS `ip-ranges.json`에 대조하면 `ap-southeast-2`. 저장소 증거의 pooler 주소도 `aws-0-ap-southeast-2` |
| Supabase edge 로그(19:02~22:02 KST 3시간, `request.cf.colo = IAD`, authenticated) | 호출당 평균 573ms, p50 660ms, p95 871ms |
| 같은 쿼리의 DB 실행 시간(`pg_stat_statements`) | profiles 0.35ms, memberships 0.5~0.9ms, `resolve_solideo_employment` 0.8ms. DB는 느리지 않다 |
| 서울 회사 Worker 호출(`ICN`, service_role) | 140~150ms |

조치 전 클릭 한 번의 Supabase 호출(로그 실측, 22:00:48 KST):

```
profiles(is_admin,status)        665ms
profiles(내 프로필)              664ms
rpc/resolve_solideo_employment   687ms
memberships(조직)                660ms
memberships(sol_role)            646ms
상태 요약 4건(병렬)              907ms
→ Supabase 대기만 약 4.3초
```

공고 상세 화면은 같은 조회를 틀(layout)과 화면(page)이 한 벌씩 더 읽어 약 5초였다(21:59:30 KST 구간).

## 조치

1. `vercel.json` `regions: ["syd1"]`(main `fed1b5bd`). 배포 뒤 응답 헤더 `x-vercel-id: icn1::syd1::…`.
2. 틀과 화면이 각자 읽던 내 프로필·업무 조직을 React `cache`로 렌더 한 번에 한 번만 읽고, `requireWork`는 둘을 같이 읽는다(main `c7e95ddf`, `web/app/_lib/my-account.ts`). 서버 함수·라우트 핸들러에서는 `cache`가 아무 일도 하지 않는다(`web/node_modules/next/dist/docs/01-app/02-guides/authentication.md`).

## 조치 뒤

| 항목 | 조치 전(`IAD`) | 조치 뒤(`SYD`) |
|---|---|---|
| Supabase 호출 한 번(p50) | 660ms | 16ms |
| 상단바 요약 API 한 번(Supabase 대기) | 약 4.3초 | 약 0.26초 |
| 화면 이동 한 번(Supabase 대기) | 2.2~5초 | 0.13~0.5초(22:19:45 KST 이후 구간) |

2번 배포 뒤 화면 한 번에 프로필·조직 조회가 한 벌만 나간다(배포 전 `syd1` 구간은 2~3벌).

## 남은 것

- 화면별 무거운 쿼리: `/bids` 목록의 `procurement_dataset_version` RPC 180~540ms를 차례로 2번, 대시보드·시장의 `procurement_summary`·`procurement_live_metrics` 400~460ms, `/gaps`는 `bid_notices`를 500행씩 4번 차례로 읽는다(약 0.8초). DB 실행 시간이 원인이라 지역과 무관하다.
- 사용자↔함수 왕복: 서울↔시드니 한 번(비로그인 `/auth/login` 첫 응답 0.33~1.1초, 배포 직후 값 포함).
- 회사 Worker↔Supabase(서울↔시드니) 호출은 그대로 140~150ms다.
- Supabase 서울 이전은 사용자 결정으로 발표(2026-11-04) 뒤에 한다. 기존 프로젝트의 지역은 바꿀 수 없어 새 프로젝트로 옮겨야 한다. 운영 DB 93MB, Storage 7,365개(1.86GB), Auth 6명이다(22:2x KST 읽기 SELECT). 옮기면 `vercel.json` `regions`를 `icn1`로 바꾼다.

검증: `node --test scripts/redis-gateway.test.mjs` 3 통과, `pnpm verify:changed` exit 0(web 101파일 890), 커밋 게이트·pre-push 게이트(빌드 포함 `pnpm verify`) 통과. 로그인 화면 이동은 사용자 브라우저 사용 로그로만 쟀다(메인 세션은 운영 로그인을 하지 않았다).
