---
title: 카카오톡 추천 공고 알림 — 끝까지 확인(mock)과 실발송
tags: [evidence, kakao-notify]
---

# 카카오톡 추천 공고 알림 — 끝까지 확인

계획 Task 8 의 증거다. Step 2(mock 끝까지)는 아래에 있고, Step 3(실발송·녹화)은 사용자 승인 뒤에 이 문서에 더한다.

## Step 2 — mock 끝까지(격리 스택)

- 실행: 2026-10-21 17:36~17:37, 브랜치 `feat/kakao-notify` `ce134b0`. 실행 전에 `web/server`·`web/app`·`web/worker`·`supabase` 가
  `ce134b0` 과 같은지(시험 파일 제외) `git diff --quiet` 로 확인했다. 그때 바뀐 것은 시험 파일 4개(변형 확인 보강)뿐이다.
- 스택(모두 이 시험만을 위해 띄우고 끝나면 내렸다. 끝난 뒤 컨테이너·볼륨·3105 포트 0):
  - 격리 로컬 Supabase(project `sol-radar-dc-kakao`, 127.0.0.1:58321). 카카오 마이그레이션 4개(이때 번호 `20261021000001`~`000004`)까지 Postgres 17 에 적용됐다.
  - Redis(`redis:7-alpine`)·AI gateway(`sol-radar-gate3e-ai-gateway`, `SOL_RUN_MODE=mock`·`AI_PROVIDER=mock`) 컨테이너
  - 호스트 worker(`node --conditions=react-server --import tsx worker/main.ts`), `next dev -p 3105`
- `NOTIFY_KAKAO_PROVIDER` 는 비웠다(mock). 카카오 API 는 부르지 않았고 카카오 키도 넣지 않았다.
- 키는 `supabase status` 에서 실행 프로세스 환경으로만 넘겼다. 시험 스크립트는 키를 파일에 쓰거나 출력하지 않았다.
  (`supabase start` 가 자기 기동 로그에 로컬 기본 키를 찍는데, 그 로그는 저장소 밖 작업 폴더에만 있다.)
- 순서: `pnpm demo:reset` → 이영업(SALES) 비밀번호 로그인 → 사용자 토큰으로 `save_kakao_notify_link` RPC(형식만 맞는 가짜 암호문)
  → FX-02 분석 요청(`POST /api/v1/bids/<id>/analyses`, Bearer) → worker 분석·알림 처리 → DB 확인.
  같은 공고를 `force` 로 다시 분석하고, 시험 메시지와 `/connect` 출처 검사를 본다.
- 판정: **모든 항목 기대대로**. 추천 1건이 카카오 1통(mock SENT)이 됐고, 다시 분석해도 1통이다. 인앱 목록에는 카카오 기록이 없다.

### 1. seed
```
seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true
```
### 2. 연결(사용자 세션 RPC)·화면 상태
- save_kakao_notify_link(이영업 토큰) HTTP 204
- GET /api/v1/me/kakao-notify → `{"state":"ON","lastSentAt":null,"lastResult":null}`

### 3. 분석 1 (FX-02, requested_by=이영업)
- POST /api/v1/bids/<FX-02>/analyses → HTTP 202, run d9e23bfc-d9c4-4656-b354-7d03ae220890
- run 결과: COMPLETED / 권고 WATCH

```
outbox BID_RECOMMENDED (event_type|status|idempotency_key 가 <orgId>:<bidId>:BID_RECOMMENDED 인가):
BID_RECOMMENDED|PROCESSED|t
notifications KAKAO (type|channel|status|받는 사람이 이영업인가|키가 <eventId>:<userId>:KAKAO 꼴인가):
BID_RECOMMENDED|KAKAO|SENT|t|t
kakao_notify_links 이영업 (status|enabled|last_result|last_sent_at 있음):
CONNECTED|t|SENT|t
```

### 4. 같은 공고 다시 분석(force)
- HTTP 202, run 9297e803-7947-4456-99df-8a06e1171b61 → COMPLETED / 권고 WATCH
- BID_RECOMMENDED outbox 행 수: 1 (1 이어야 한다)
- KAKAO 알림 행 수: 1 (1 이어야 한다)
- ANALYSIS_COMPLETE outbox 행 수: 2 (run 마다 1)

### 5. 인앱 목록(channel=IN_APP 만)
- GET /api/v1/notifications 의 type 목록: ['ANALYSIS_COMPLETE', 'ANALYSIS_COMPLETE']
- DB 의 이영업 알림(type|channel): BID_RECOMMENDED/KAKAO, ANALYSIS_COMPLETE/IN_APP, ANALYSIS_COMPLETE/IN_APP

### 6. 시험 메시지
- POST /test 첫 번째 HTTP 202(202), 같은 분 두 번째 HTTP 429(429)
- KAKAO_TEST outbox (status|org_id 없음): PROCESSED|true
- KAKAO_TEST 로 만든 notifications 행: 0 (0 이어야 한다)
- 연결 행 last_result: SENT

### 7. /connect 출처 검사
- Sec-Fetch-Site: cross-site → 307 http://localhost:3105/settings?kakao=failed (설정 화면 ?kakao=failed)

### worker 로그(카카오·알림 줄)
```
{"event":"notify.outbox","outboxEventId":"75d72945-b865-47f4-9b33-167f23570df4","eventType":"BID_RECOMMENDED","outcome":"SENT","sent":1,"failed":0}
{"event":"notify.outbox","outboxEventId":"9422d172-1655-401e-853d-c914eb42667a","eventType":"ANALYSIS_COMPLETE","outcome":"SENT"}
{"event":"notify.outbox.summary","checked":2,"sent":2,"skipped":0,"retried":0,"dead":0}
{"event":"notify.outbox","outboxEventId":"86f1b7e6-64d8-4941-b1c1-15d8f43a187b","eventType":"ANALYSIS_COMPLETE","outcome":"SENT"}
{"event":"notify.outbox.summary","checked":1,"sent":1,"skipped":0,"retried":0,"dead":0}
{"event":"notify.outbox","outboxEventId":"4aef3387-6d67-4aa3-8172-77c0366ff87b","eventType":"KAKAO_TEST","outcome":"SENT","sent":1,"failed":0}
{"event":"notify.outbox.summary","checked":1,"sent":1,"skipped":0,"retried":0,"dead":0}
```

## Step 3 — 실발송(사용자 승인 대기)

- 사용자가 `NOTIFY_KAKAO_PROVIDER=memo` 와 카카오 키 넷을 넣은 뒤, FX-02 라이브 분석으로 휴대폰 수신을 녹화한다. 실행자는 키 값을 보지 않는다.
- 아직 하지 않았다.
