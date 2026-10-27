---
title: "DEMO 마감 이동 운영 실행 기록"
status: done
tags: [sol-radar, db, ops, demo]
updated: 2026-10-27
---

# DEMO 마감 이동 운영 실행 기록 (2026-10-27)

운영 Supabase(`brtysdocxemrqhdezzqg`)에서 Supabase MCP `execute_sql` 로 실행했다. 실행서는 [README](README.md)다. 운영 migration 은 62개다(10-27 `20261027000500`·`000600` 적용 뒤). 01·02 는 그 두 migration 과 무관한 표만 읽고 쓴다.

## 1. 01 사전 조회

- Q1: 19행. BEFORE 16, NO_DEADLINE 3(FX-11·17·20). 목록 밖 0. 모든 행이 `rev_matches_notice=true`다.
- Q2 A 절: 14줄 모두 `ok=true`다.
  - A12 실행 역할: `bid_notices 주인 postgres / 실행 postgres / true`
  - A13 기록 스키마: 없음
  - A14 02 실행 가능: `예`
- Q2 B 절 sha256(04 뒤 같아야 한다):

| 표 | 행 | sha256 |
|---|---|---|
| bid_notices | 19 | `714b6fbd49ea735b44cc408593bc51f2fd8869314de3f8a290f8cc9b3a57852b` (10-26 값과 같음) |
| bid_revisions | 19 | `433539442aea9e765ad2325305559a3c46b84c7f88137f2aa3fd07a4602774aa` (10-26 값과 같음) |
| bid_opportunities | 19 | `aeca1d71d8b325e75bcdddd9a7911e0605fa33192b25573701484ed1ee3ef82f` |
| opportunity_notice_links | 19 | `972ded83a11456815a932122504b5e953efa2132e3fe517dd4767a081a5ef933` |
| score_runs | 19 | `f0f3c3580d54a1d374e79407b6f471b219adaaaf75d92174b8074e1aa1ce103a` |
| bid_reviews | 3 | `4f6d0f7d3d5659da339b2b367e4e757a39399a449c5120fdf5d82736474b0b27` |

- Q2 C 절: 비대상 공고 787건(모두 실공고), 비대상 revision 829건, 비대상 score_runs 0건.
- Q2 D 절: `normalized.deadlineAt`(16, 옮김), `.fetchedAt`(19), `.noticeDate`(19)만 있다. 다른 날짜 경로는 없다.
- Q2 E 절: 마감 알림 수신 후보 1건. 대상 score_runs 19 / 결정 3 / 관심 0 / 프로젝트 0.

### Q3 화면 숫자(이동 전, DEMO, org-01)

| 기준 시각 | 목록 기본 | 마감 임박(7일) | BID 권고 | 진행 중 WATCH | 신규 | 분석 대기 | 사전 단계 | 공고 마감 |
|---|---|---|---|---|---|---|---|---|
| 지금(10-27) | 14 | 2 (0002·0004) | 2 | 10 | 0 | 0 | 4 | 1 |
| 10-28 10:00 | 14 | 4 (0002·0004·0006·0010) | 2 | 10 | 0 | 0 | 4 | 1 |
| 11-03 10:00 | 12 | 8 | 2 | 8 | 0 | 0 | 4 | 3 |
| 11-04 14:00 | 10 | 7 | 1 | 7 | 0 | 0 | 4 | 5 |

### Q4 D-day(이동 전)

11-04 14:00 기준으로 마감인 공고: FX-14, FX-18, FX-19, FX-02, FX-04, FX-06, FX-10.
FX-03 은 D-Day, FX-08 은 D-1 이다.

### Q5 FX-02

- score_run `6a90acc4…`: COMPLETED, LIVE·LOCAL, 66 WATCH, snapshot today 2026-10-25, deadline `2026-10-30T09:00:00.000Z`, 생성 10-24 01:05 UTC.
- 결정 `ba5df651…`: WATCH, 10-24 01:11 UTC.

## 2. 02 dry-run

`v_dry_run = true` 그대로 한 번에 보냈다. 결과:

```
ERROR:  P0001: DRY_RUN_ROLLBACK: 모든 확인 통과(공고 16·revision 16 옮김 확인, 대상 밖 묶음 13 개 그대로). v_dry_run = false 로 다시 돌린다
```

직후 확인:

| 항목 | 값 |
|---|---|
| 기록 스키마 | 없음 |
| `bid_notices_touch_updated_at` | `O`(켜짐) |
| bid_notices·bid_revisions 의 ShareRowExclusive 잠금 | 0 |
| `idle in transaction` 연결 | 0 |
| FX-02 마감 | 10-30 18:00 KST 그대로 |
| DEMO bid_notices sha256 | `714b6fbd…` 그대로 |

## 3. 02 적용

사용자 진행 지시 뒤, `v_dry_run` 한 줄만 `false` 로 바꿔 한 번에 보냈다. 적용 시각은 2026-10-27 03:57:37 UTC(12:57 KST)다. 끝의 SELECT 는 19행이고 `ok` 가 모두 true 였다.

| FX | 옮긴 뒤 마감(KST) |
|---|---|
| FX-14 | 11-06 18:00 |
| FX-18·FX-19 | 11-11 18:00 |
| FX-02 | 11-14 18:00 |
| FX-04 | 11-16 18:00 |
| FX-06·FX-10 | 11-18 18:00 |
| FX-03 | 11-19 18:00 |
| FX-08 | 11-20 18:00 |
| FX-07 | 11-22 18:00 |
| FX-13 | 11-23 18:00 |
| FX-05·FX-16 | 11-24 18:00 |
| FX-01 | 11-25 18:00 |
| FX-09 | 11-29 18:00 |
| FX-15 | 12-04 18:00 |
| FX-11·FX-17·FX-20 | 없음(그대로) |

## 4. 03 확인

- Q1: bid_notices 19행, bid_revisions 19행 모두 다섯 검사(값·+15일·다른 열·updated_at/공고 마감 일치·적용 직후와 같음) true.
- Q2: 모든 줄 `ok=true`.
  - A: 적용됨, 되돌림 없음, 기록 19(16)·19(16)
  - B: 새 마감 19, 다른 열 그대로 19, `updated_at` 그대로 19, 새 글자 19, 다른 내용 그대로 19, 가장 이른 마감 11-06 18:00(FX-14), FX-02 11-14 18:00
  - C: 대상 묶음 지금 = 적용 직후. bid_notices `1a9fe5fd…`, bid_revisions `39edfb13…`
  - D: 실공고 787 same, revision 829 same, changed_other·missing 0, 대상 밖 묶음 13개 그대로
  - E: 트리거 `O`, 기록 스키마 노출 0, 대상 사업기회에 대상 밖 공고 0

## 5. 01 Q3 다시(이동 뒤)

| 기준 시각 | 목록 기본 | 마감 임박(7일) | BID 권고 | 진행 중 WATCH | 공고 마감 |
|---|---|---|---|---|---|
| 지금(10-27) | 15 | 0 | 2 | 11 | 0 |
| 10-28 10:00 | 15 | 0 | 2 | 11 | 0 |
| 11-03 10:00 | 15 | 1 (FX-14) | 2 | 11 | 0 |
| 11-04 14:00 | 15 | 1 (FX-14) | 2 | 11 | 0 |

실행서 예상(11-04 목록 15·마감 임박 1(FX-14)·마감 0)과 같다.

## 6. 화면 확인

하지 못했다. 운영 대시보드·입찰 공고 목록은 로그인해야 열린다(`/dashboard?origin=demo` → 307 `/auth/login`). 운영에 시험 계정을 새로 만들지 않았다. 로그인한 사람이 `?origin=demo` 대시보드·목록을 1440·1280 폭에서 본다.

## 되돌리기

[04-rollback.sql](04-rollback.sql) 을 dry-run 으로 먼저 보낸 뒤 `v_dry_run` 만 false 로 바꿔 보낸다. 되돌린 뒤 01 Q2 B 절 sha256 은 위 1절 값(bid_notices `714b6fbd…`, bid_revisions `43353944…`)과 같아야 한다.
