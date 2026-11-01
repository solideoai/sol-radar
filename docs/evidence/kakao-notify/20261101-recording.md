---
title: "카카오 추천 알림 녹화 기록 (2026-11-01)"
status: active
tags: [sol-radar, evidence, kakao-notify, ops, demo]
updated: 2026-11-01
---

# 카카오 추천 알림 녹화 기록 (2026-11-01)

[[16-DECISIONS|ADR-038]] 카카오 "나에게 보내기"를 발표용으로 녹화한 기록이다. 클레임이 없는 실공고 추천 1건을 사람이 다시 분석해 추천 카톡이 오는 장면을 찍었다. 운영 변경(알림 Worker 실발송 켜기·끄기, 재분석 1회)은 사용자 승인("A·B 승인, 17:15에 시작하자")으로 했다. 앞선 첫 실발송은 [10-30 기록](20261030-prod-live-send.md)에 있다.

## 고른 공고

- `90c955ea-4724-453f-a076-1b29adbb9ba1` "27년 AI 규제정보시스템 운영 및 유지관리 사업"(국무조정실), 마감 12-08, 첨부 3건 모두 PARSED.
- 녹화 전 최신 run: `sol-v0.2.1` 85점 BID(11-01 재채점), 검토 플래그 `MODEL_RULE_DISAGREEMENT`·`KEV_MANDATORY_RISK`.
- 녹화 전 이 공고의 `BID_RECOMMENDED` 이벤트·`kakao_send_claims`는 0건이었다. 실공고 추천 7건이 모두 그랬다.
- 같은 입력의 완료 run이 있어 "분석 요청"은 그 run을 그대로 돌려준다(`web/server/bids/bids.service.ts`). 그래서 "재분석"(강제 실행)을 눌렀다.

## 순서 (2026-11-01 KST)

| 시각 | 일 | 결과 |
|---|---|---|
| 17:15 | 녹화 전 확인(운영 DB SELECT) | 대기·실패 `BID_RECOMMENDED` 0, 이 공고 이벤트 0, `QUEUED`·`RUNNING` run 0 |
| 17:16 | 회사 알림 Worker를 `NOTIFY_KAKAO_PROVIDER=memo`로 재생성. 이미지 `sol-radar-notify-worker:7b5a79dc9054` 그대로 | healthy. 기동 로그 "카카오 발송: memo(카카오 나에게 보내기 실발송)", `SOL_RUN_MODE=live` |
| 17:36 | 운영 웹 `6604d975` 배포(설정 화면 소셜 계정 이메일 가림, 녹화 전 사용자 요청) | Vercel READY, `/health/ready` ok |
| 17:43:02 | 설정에서 카카오 알림을 켜고 테스트 발송 | `KAKAO_TEST` 이벤트 `02aeb718` PROCESSED |
| 17:43:59 | 공고 상세에서 "재분석" | run `6d309cf4` LIVE `sol-v0.2.1`, 17:44:04 COMPLETED, 85점 BID, 플래그 같음 |
| 17:44:05 | `BID_RECOMMENDED` 이벤트 `6b073f06` | 17:44:05 PROCESSED |
| 17:44:08 | 카카오 알림 `43abd920` | SENT. claim `BID:<user>:90c955ea-…` |
| 17:44:44 | 설정에서 카카오 알림을 끔 | `kakao_notify_links` `enabled=false`, CONNECTED 그대로 |
| 17:5x | 사용자가 받은 카톡의 [분석 보기]를 누름 | 공고 상세가 아니라 다른 사이트 첫 화면이 열렸다. 아래 "[분석 보기] 결함" |
| 18:05 | 운영 웹 `92ca1882` 배포(로그인 뒤 보던 업무 화면으로 복귀, 사용자 승인) | Vercel READY |
| 18:0x | 사용자가 회사 `infra/.env.worker.local` 의 `SITE_URL`을 고침 | 값은 아래 |
| 18:15:48 | 알림 Worker를 실발송 꺼짐으로 재생성 | 아래 "되돌리기" |

## 결과

- 재분석 점수·권고는 직전과 같다(85점 BID). 실공고 추천 7건(보류 349·비추천 10)은 바뀌지 않았다.
- 누적 카카오 추천 발송(`notifications` channel KAKAO, SENT): 10-30 23통, 11-01 1통.
- 같은 공고·같은 사람으로는 다시 보내지 않는다(claim 키). 이 공고로 다시 찍을 수 없다.
- 화면 녹화 파일은 사용자가 갖고 있다. 저장소에는 넣지 않는다.

## [분석 보기] 결함

증상: 카톡의 [분석 보기]를 누르면 공고 상세 대신 다른 사이트의 첫 화면이 열렸다(사용자 보고).

원인은 두 가지다.

1. 회사 알림 Worker의 `SITE_URL`이 `https://www.solideos.com`(회사 홈페이지)이었다. 카톡 링크는 `<SITE_URL>/bids/<bidId>`로 만든다(`web/server/kakao-notify/feed.model.ts`의 `toFeedTemplate`). 그래서 SOL RADAR가 아닌 회사 홈페이지로 갔다. 실행 중 컨테이너의 `printenv SITE_URL`로 확인했다. env 파일은 열지 않았다. 10-30 실발송 23통도 같은 값으로 나갔다.
2. 로그인하지 않고 업무 화면을 열면 `/auth/login`으로만 보냈다. 돌아올 화면(`?next=`)을 싣지 않아 로그인 뒤 대시보드로 갔다(`web/app/(app)/(work)/layout.tsx`, `work.ts`의 `requireWork`).

고친 것:

- 1은 사용자가 회사 `infra/.env.worker.local`의 `SITE_URL`을 `https://www.solideos-radar.com`으로 바꿨다. 18:15:48 재생성 뒤 컨테이너 값이 그 값이다.
- 2는 `92ca1882`다. 업무 레이아웃과 `requireWork`가 `loginPath(next)`로 `/auth/login?next=<보던 경로>`를 만든다. 로그인 화면은 원래 `?next=`로 보낸다. 사이트 밖 주소와 `/auth/…`는 싣지 않는다(`web/app/auth/employment-routing.test.ts`). 운영 확인(18:07): 로그인 없이 `/bids/90c955ea-…`를 열면 `307 → /auth/login?next=%2Fbids%2F90c955ea-…`이고, `/dashboard`는 `/auth/login`이다.

남은 확인:

- 카카오 개발자 콘솔의 Web 사이트 도메인에 `https://www.solideos-radar.com`이 있는지 사용자가 확인한다. 카카오는 등록하지 않은 도메인의 메시지 링크를 쓰지 않는 것으로 알지만, 이 저장소에서 확인한 사실은 아니다.
- 고친 링크로 카톡을 실제로 받아 [분석 보기]를 누르는 확인은 아직 하지 않았다. 90c955ea는 다시 보내지지 않으므로 다른 추천 공고로 한다(운영 변경, 별도 승인).
- 카톡 안 브라우저는 로그인 세션이 없어 로그인 화면부터 열린다. 구글 로그인은 앱 안 브라우저에서 막힐 수 있다.

## 되돌리기

- 18:15:48 `NOTIFY_WORKER_TAG=7b5a79dc9054`로 `NOTIFY_KAKAO_PROVIDER` 없이 재생성했다. 이미지는 그대로이고 healthy다.
- 기동 로그: "카카오 발송: 꺼짐(NOTIFY_KAKAO_PROVIDER 빈 값…)", `notify.kakao.disabled`, `SOL_RUN_MODE=live`.
- 컨테이너 `SITE_URL`은 `https://www.solideos-radar.com`이다.
- 카카오 연결은 17:44:44부터 `enabled=false`다.

