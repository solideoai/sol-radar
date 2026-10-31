---
title: "카카오 나에게 보내기 운영 실발송 기록 (2026-10-30)"
status: active
tags: [sol-radar, evidence, kakao-notify, ops]
updated: 2026-10-31
---

# 카카오 나에게 보내기 운영 실발송 기록 (2026-10-30)

[[16-DECISIONS|ADR-038]] 카카오 "나에게 보내기"의 운영 첫 실발송 기록이다. 그날 두 세션(알림 Worker 담당 `1ecc21a0`, 발송 확인 담당 `96ab62a6`)이 단계마다 사용자 승인을 받아 작업했고, 기록 문서는 남기지 않았다. 이 문서는 2026-10-31에 두 세션의 보고 원문과 운영 DB 읽기로 옮겨 적었다. 앞 단계(12:45 알림 Worker 첫 기동, 카카오 꺼짐)는 [알림 Worker 기동 기록](../company-rollout/20261030/notify-worker-rollout.md)에 있다.

## 순서 (2026-10-30 KST)

| 시각 | 일 | 결과 |
|---|---|---|
| 13:55 | 운영 설정 화면 [연결] | Vercel 콜백 `TOKEN_HTTP_401`(클라이언트 시크릿·REST 키 불일치)로 실패. 사용자가 값을 고쳤다 |
| 14:05:26 | 알림 Worker를 `memo`(실발송 켜짐) 그대로 다시 만듦(바뀐 env 읽기, 사용자 승인) | healthy. 직전 대기 카카오 이벤트 0 |
| 14:13:37 | 연결 | `kakao_notify_links` CONNECTED(admin@solideos.com). `KAKAO_TEST` 처리, SENT |
| 14:23:11~14:24:09 | 그 조직의 `BID_RECOMMENDED` `DEAD` 22건(DEMO 19·실공고 3)을 `PENDING`으로 되돌림(사용자 "22건 모두 되돌려봐") | 카톡 22통 SENT, 이벤트 22건 PROCESSED, 실패·만료 0. 내용은 10-27 분석 run 기준이라 SOL Score v0.2·프로필 revision 6 전 점수다 |
| 14:44 | 두 번째 `KAKAO_TEST` | PROCESSED |
| 15:12:32 | 추천 카톡 1통 | 사람이 요청한 분석(15:12 `sol-v0.2.0` run)이 추천·보류로 끝나 SENT |
| 15:31:16 | 연결 행 갱신 | `enabled=false`. 연결은 CONNECTED 그대로다. 누가 껐는지는 기록에 없다 |
| 15:47 | 알림 Worker를 꺼짐으로 되돌림(사용자 "1") | 기동 로그 `notify.kakao.disabled`, `NOTIFY_KAKAO_PROVIDER` 빈 값, healthy, 대기 카카오 0 |

카카오 간편 로그인은 이 기록의 범위 밖이다. 14:07 연결 시도는 카카오 앱 동의항목 미설정(`account_email`, KOE205)으로 거절됐고, 그 뒤 완료는 사용자 보고(10-30)다.

## 운영 DB 읽기 (2026-10-31 16:5x KST, SELECT만)

- `kakao_notify_links` 1행: CONNECTED, `enabled=false`, `last_result=SENT`. 생성 10-30 14:13:37, 갱신 15:31:16, 마지막 발송 15:12:32.
- `kakao_send_claims` 25행(14:13~15:12): 14시 24행(시험 2·되돌린 22), 15시 1행.
- `outbox_events`: `BID_RECOMMENDED` PROCESSED 23(마지막 15:12), `PENDING`·`DEAD` 0. `KAKAO_TEST` PROCESSED 2(마지막 14:44).

## 촬영 영향

- 되돌려 보낸 22개 공고(FX-01·FX-02 포함)는 다시 분석해도 카톡이 가지 않는다. 키 `<org>:<bid>:BID_RECOMMENDED`가 남아 있다. S4 FX-02 재분석 장면에서 카톡 수신을 보이려면 따로 정해야 한다.
- 꺼진 동안 사람이 요청한 분석은 `BID_RECOMMENDED`가 `DEAD`가 되고, 나중에 켜도 그 공고는 가지 않는다. 녹화할 공고는 켠 뒤에 분석한다.
- 녹화 전에 두 곳을 켠다. 회사 알림 Worker `memo`(승인 필요)와 연결 행 `enabled`(설정 개인 탭 카카오 칸)다.
- 실수신 화면 녹화는 아직 없다.
