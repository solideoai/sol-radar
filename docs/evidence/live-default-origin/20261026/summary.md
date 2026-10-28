---
title: "10-26 실공고 기본 출처(SOL_DEFAULT_ORIGIN=live) 격리 확인"
status: done
tags: [sol-radar, evidence, live-ingest, vercel]
updated: 2026-10-26
---

# 10-26 실공고 기본 출처(SOL_DEFAULT_ORIGIN=live) 격리 확인

운영 웹의 기본 공고 출처를 DEMO 에서 실공고로 바꾸기 전에, 코드 변경 없이 env 하나로 되는지 격리 스택에서 확인했다. 운영 환경은 바꾸지 않았다.

## 조건

- 코드: 운영 배포와 같은 00b51d56(분리 worktree, detached). 코드 변경 없음.
- DB: 격리 Supabase `sol-radar-live78`(포트 57421·57422), 마이그레이션 60개(마지막 20261025000310, 운영과 같음). 확인 뒤 `supabase stop --no-backup` 으로 내렸다.
- 데이터: `pnpm demo:reset`(DEMO 19건·가상 회사·가상 인력 200명) + 녹화된 나라장터 응답 `fixtures/recorded/15129394/getBidPblancListInfoServc.20261019.7d-p1.masked.json`(100건)과 보조 조회 녹화를 실제 수집 코드(`processIngestJob`, live, trigger SCHEDULED)로 넣었다. 네트워크 호출 0회.
  - 결과: run SUCCEEDED·COMPLETE, created 97·changed 3·quarantined 0, 예산 295회(목록 1 + 보조 98×3). 운영 D4 의 259회(목록 1 + 86×3)와 같은 계산이다.
- 웹: `next dev`, `SOL_RUN_MODE=mock`(운영 Vercel 과 같은 값으로 가정), Redis·AI gateway 없음(`/health/ready` 503, 상단 "AI: 확인 중"은 이 때문이다).
- 계정: SALES(`sales@soltech.invalid`). 폭 1440·1280.

## 결과

| 화면 | `SOL_DEFAULT_ORIGIN` 없음(지금 운영과 같음) | `SOL_DEFAULT_ORIGIN=live` |
|---|---|---|
| `/dashboard` | 상단 DEMO, 가상 공고 집계 | DEMO 0, 실공고 집계(신규 97·분석 대기 97·BID 0·기관별) |
| `/bids` | DEMO 19건만 | 실공고만("데이터 구분: 실제 공고"), 분석 상태 "미분석" |
| 실공고 상세 | **상단에 DEMO 배지가 뜬다(잘못된 표시)** | DEMO 없음. 수요기관·공고기관·예산·마감·공고번호 실제 값, "미분석"·"아직 분석하지 않았습니다" |
| `GET /api/v1/bids`(기본) | 19건 전부 demo | 30건 전부 live, demo 0 |
| `/dashboard?origin=demo`·`/bids?origin=demo` | — | 상단 DEMO, 행 DEMO 배지, "(가상)" 제목 유지 |
| DEMO 공고 상세 | — | 행 DEMO 배지·"출처 fixture" 유지, 상단 DEMO 는 없음(주소에 origin 이 없어서) |
| `/watchlist`·`/analysis`·`/workforce` | — | 오류 없음, DEMO 섞임 없음 |

- 모든 화면 가로 넘침 0px(1440·1280).
- 서버 5xx 는 `/health/ready` 503 뿐이다(격리 스택에 Redis·AI 를 붙이지 않음).

## 파일

- `live-*.png`, `live-check.json`: `SOL_DEFAULT_ORIGIN=live`.
- `noenv-*.png`, `noenv-check.json`: env 없음. `noenv-live-bid-detail-1440.png` 가 실공고 상세의 잘못된 DEMO 배지다.
- `live-workforce-1440.png`·`live-workforce-1280.png`: 인력 배치 화면.

## 운영 반영 확인(10-26 14:33 KST)

- env: Production 에 `SOL_DEFAULT_ORIGIN`(Config)이 14:27 무렵 추가됐다. 이 세션이 아니라 다른 곳(대시보드 작업으로 추정)에서 먼저 실행해, 이 세션은 env 추가·재배포를 하지 않았다. 다른 env 이름 17개는 그대로다.
- 배포: `dpl_8ChRFYZEEq5s2Tzoan8rbtfvr3mP`(`sol-radar-gviot56r4`), 커밋 00b51d56, Production, Ready(14:29:24 생성). `www.solideos-radar.com` 이 이 배포를 가리킨다. 직전 배포는 `dpl_27BxjHAommKSMzPCvca1Kpb5yWaG`(`sol-radar-eailbw0cq`).
- 화면: 사용자가 띄운 브라우저 창에서 직접 로그인했고(ADMIN 계정), 스크립트는 페이지 이동과 GET 만 했다. 1440·1280 모두 가로 넘침 0px, 5xx 0.

| 확인 | 결과 |
|---|---|
| `/dashboard` | 상단 DEMO 없음. 신규 90·분석 대기 90·BID 0·전체 90·마지막 수집 성공 13:53·기관별 실기관 |
| `/bids`·`/bids?origin=live` | "데이터 구분: 실제 공고", 나라장터 행만, "(가상)" 0, 분석 상태 "미분석" |
| 실공고 상세(R26BK01790797) | 상단·본문 DEMO 0. 수요기관·공고기관·예산·마감·공고번호 실제 값, "미분석"·"아직 분석하지 않았습니다" |
| `/bids?origin=demo`·`/dashboard?origin=demo` | 상단 DEMO, 행 DEMO 배지, "(가상)" 제목, 기존 분석(예: 89 WATCH) 유지 |
| DEMO 공고 상세 | 행 DEMO 배지 유지(상단 DEMO 는 주소에 origin 이 없어 없음) |
| `GET /api/v1/bids`(상태 4종) | 기본 90건 전부 live·미분석 90, `origin=live` 90, `origin=demo` 19건 전부 demo |

- 운영 DB(읽기 전용 SELECT, `supabase db query --linked`): fixture·is_demo=true 19건(score_runs 19), g2b-bid-notice·is_demo=false 90건(score_runs 0). CLI 가 조회 때 "Initialising login role..." 을 출력했다(원격 조회용 임시 로그인 역할 준비, 데이터 변경 없음).
- 파일: `prod-*.png`, `prod-check.json`.
