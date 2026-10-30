---
title: "알림 전용 Worker 회사 첫 기동 기록 (2026-10-30 낮)"
status: active
tags: [sol-radar, ops, notify, outbox, kakao, deadline]
updated: 2026-10-30
---

# 알림 전용 Worker 회사 첫 기동 기록 (2026-10-30 낮)

실행서 `infra/company/README.md` §9(알림 전용 Worker)를 D0부터 D4까지 따랐다. 메인 세션이 회사 망에서 SSH로 스크립트를 돌렸다. D1·D2와 D3은 사용자에게 각각 승인을 받았다(2026-10-30 "1", "1"). 다른 세션(c0)의 요청으로 시작했지만, 다른 세션의 전달은 승인으로 치지 않았다.

지킨 조건:

- `sol-radar-notify` 프로젝트의 `notify-worker` 하나만 새로 띄웠다. ingest·analysis·documents·기업마당 Worker, dependency reporter, redis-api, AI gateway, Redis는 그대로 두었다.
- 카카오는 꺼진 채로 띄웠다(ADR-068 6번). `NOTIFY_KAKAO_PROVIDER`를 `mock`·`memo`로 두지 않았다. §9.6 카카오 실발송은 하지 않았다.
- 전체 Worker(`worker/main.ts`)는 회사에도 다른 곳에도 띄우지 않았다.
- 배포 checkout `sol-radar-deploy`의 HEAD는 옮기지 않았다. `sol-radar-app` HEAD(`cbb3831e86da`)와 22:15 재수집 예약(pid 162650)도 그대로다.
- `outbox_events`·`notifications`·`kakao_send_claims`에 손으로 쓰지 않았다. 운영 DB는 SELECT만 했다.
- `.env*` 파일은 열지 않았다. 존재만 확인했다.

## D0 읽기 확인 (12:41 KST)

- 배포 checkout: `/data/www/ai_workspace/sol-radar-deploy`, 브랜치 `deploy/sv02-20261030`, HEAD `7b5a79dc9054`(main `b1f4b6d4` + 회사 carry `9bb24b0`), 작업 트리 깨끗함. HEAD에 `web/worker/notify-only-main.ts`·`infra/compose.notify-only.company.yaml`·`web/worker/Dockerfile`이 있다. `b1f4b6d4`와 origin/main(`88e6e75f`) 사이에 `web/worker` 변경은 없다.
- 전체 Worker·다른 알림 컨테이너: 없음(멈춘 것 포함). `sol-radar-notify-worker` 이미지: 없음.
- `infra/.env.worker.local`: 있음(내용 안 읽음). `infra/.env`: 없음. 셸 `NOTIFY_KAKAO_PROVIDER`: 없음.

기동 전 확인 1(쌓인 outbox, 운영 DB 마이그레이션 73개·최신 `20261030001100`):

| 종류 | 상태 | DEMO | 건수 | 가장 오래된 것 |
|---|---|---|---:|---|
| `ANALYSIS_COMPLETE` | PENDING | 실공고 | 6(공고 3) | 2026-10-28 23:36 KST |
| `ANALYSIS_COMPLETE` | PENDING | DEMO | 21(공고 19) | 2026-10-25 15:00 KST |
| `REVIEW_ASSIGNED` | PENDING | DEMO | 1 | 2026-10-24 10:11 KST |
| `BID_RECOMMENDED` | PENDING | 실공고 | 3 | 2026-10-28 23:36 KST |
| `BID_RECOMMENDED` | PENDING | DEMO | 19 | 2026-10-25 15:00 KST |
| `KAKAO_TEST` | — | — | 0 | — |

- 인앱 28건의 받는 사람은 모두 admin@admin.com 한 사람이다(`org-01` owner·`sol_role=ADMIN`, 기동 전 알림 0건). 28건 모두 구성원·활동 계정·공고 조건을 통과했다. 주 발표 계정(sales)이 받을 것은 0건이다.
- 카카오 연결(`kakao_notify_links`): 0행.
- 사용자에게 보고하고 선택받았다: 28건을 미리 닫지 않고 그대로 처리한다(오래된 이벤트를 닫으면 알림 없이 "처리됨"으로 남아 기록이 사실과 달라진다).

기동 전 확인 2(마감 알림 첫 회차):

- KST 09:00 뒤: 예.
- 마감이 3일 안인 공고: 오늘(D-0) 실공고 38, D-3 실공고 98, D-1 0. DEMO 0.
- 첫 회차가 넣을 알림: 0건(D-3·D-1 공고에 관심 등록자·최신 결정 담당자가 없다).

## D1 이미지 빌드 · D2 `--check` (12:43 KST, 사용자 승인 "1")

- `NOTIFY_WORKER_TAG=7b5a79dc9054`. `docker compose -f infra/compose.notify-only.company.yaml config --quiet` 통과.
- 빌드 결과 `sol-radar-notify-worker:7b5a79dc9054`(이미지 ID `68db6caf6819`, 1.22GB). 같은 checkout·Dockerfile로 오전에 만든 Analysis Worker 이미지의 층을 캐시로 다시 썼다.
- `--check` exit 0:

```text
알림 outbox: 2000ms 마다 최대 50건(인앱 REVIEW_ASSIGNED·ANALYSIS_COMPLETE, 카카오 BID_RECOMMENDED·KAKAO_TEST)
카카오 발송: 꺼짐(NOTIFY_KAKAO_PROVIDER 빈 값. 카카오 이벤트는 재시도 뒤 DEAD)
마감 알림: 300000ms 마다(KST 09:00 뒤 그날 D-3·D-1, 관심 등록자·최신 결정 담당자)
notify-only worker 확인 통과: SOL_RUN_MODE=live
```

## D3 기동 (12:45:11 KST, 사용자 승인 "1")

```bash
docker compose -f infra/compose.notify-only.company.yaml up -d --no-deps --no-build notify-worker
```

컨테이너 `sol-radar-notify-notify-worker-1`, 이미지 `sol-radar-notify-worker:7b5a79dc9054`. 30초 뒤 `Up 30 seconds (healthy)`.

## D4 확인 (12:46~12:47 KST)

기동 로그:

```text
{"event":"notify.kakao.disabled","message":"SOL_RUN_MODE=live 인데 NOTIFY_KAKAO_PROVIDER 가 비어 카카오 발송을 껐다. 실발송은 memo, 흉내는 mock 으로 적는다"}
notify-only worker started: SOL_RUN_MODE=live
```

- 첫 회차: `{"event":"notify.outbox.summary","checked":50,"sent":28,"skipped":0,"retried":22,"dead":0}`.
- 105초 동안 `notify.outbox` 119줄: `ANALYSIS_COMPLETE` SENT 27, `REVIEW_ASSIGNED` SENT 1, `BID_RECOMMENDED` RETRY 88(22건 × 4회, `"errorName":"Error"`) 뒤 DEAD로 끝났다.
- `notify.outbox.failed`: 0줄. `notify.deadline.sent`: 없음(넣을 알림 0건).
- 다른 컨테이너의 이미지·상태는 기동 전과 같다.

운영 DB 다시 세기(12:47 KST):

| 종류 | 상태 | DEMO | 건수 | 시도 수 |
|---|---|---|---:|---:|
| `ANALYSIS_COMPLETE` | PROCESSED | 실공고 | 6 | 0 |
| `ANALYSIS_COMPLETE` | PROCESSED | DEMO | 21 | 0 |
| `REVIEW_ASSIGNED` | PROCESSED | DEMO | 1 | 0 |
| `BID_RECOMMENDED` | DEAD | 실공고 | 3 | 5 |
| `BID_RECOMMENDED` | DEAD | DEMO | 19 | 5 |

- `notifications`(최근 1시간): `ANALYSIS_COMPLETE`·IN_APP·SENT 27, `REVIEW_ASSIGNED`·IN_APP·SENT 1. 받는 사람 1명(admin@admin.com), 모두 읽지 않음.
- `kakao_send_claims` 0행, IN_APP이 아닌 알림 0행, `DEADLINE_APPROACHING` 0행.
- 인앱 두 종의 `PENDING`은 0이다.

## 남은 것

- admin@admin.com 벨에 읽지 않은 알림 28건이 있다. "모두 읽음" 기능은 없어서 한 건씩 읽어야 배지가 줄어든다. D1 촬영에 admin 계정이 나오면 이 배지가 보인다.
- 카카오 S0 수신 시험·실수신 녹화(§9.6)는 따로 승인받는다. 쌓인 `BID_RECOMMENDED`는 모두 `DEAD`라서 `memo`로 켜도 다시 보내지 않는다. 카카오 연결은 아직 0건이다.
- 마감 D-3·D-1 알림은 5분마다 돈다. 관심 등록·결정 담당자가 생긴 공고부터 나간다. 실제로 넣은 회차(`notify.deadline.sent`)는 아직 보지 못했다.
- ADR-056(분석이 첨부를 기다림): 09:15 Analysis Worker 재생성 뒤 실공고 분석이 없었다. 로그에는 `analysis.reconcile.summary` 206줄·`insight.job` 2줄뿐이고 `analysis.waiting_documents`·`DOCUMENTS_WAIT_TIMEOUT`은 0건이다. 대기 동작은 다음 실공고 분석 때 본다.

## 되돌리기

```bash
cd /data/www/ai_workspace/sol-radar-deploy
export NOTIFY_WORKER_TAG=7b5a79dc9054
docker compose -f infra/compose.notify-only.company.yaml stop notify-worker
```

넣은 알림 행·`DEAD` 이벤트는 지우지 않는다(§9.7).
