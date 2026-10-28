---
title: "공개 프로필로 본 발표 공고 점수 미리 계산"
status: active
tags: [sol-radar, demo, company-profile]
updated: 2026-10-28
---

# 공개 프로필로 본 발표 공고 점수 미리 계산 (2026-10-28)

운영 회사 프로필이 공개 자료 프로필(revision 5, [반영 기록](../20261027/prod-rollout.md))로 바뀌었다. 이 문서는 그 뒤 발표 장면 S3·S4에 쓰는 DEMO 공고의 점수와 권고를 촬영 전에 계산한 기록이다. 운영 DB는 읽기(SELECT)만 했다. 재분석·AI 호출·데이터 변경은 하지 않았다.

## 방법

- 규칙 엔진 `analyze()`와 가정 재계산 `whatIf()`(`web/server/scoring/`)를 그대로 불렀다. 운영 [재분석]과 화면의 "보유 가정" 스위치가 쓰는 함수와 같다.
- 입력
  - 공고·추출: fixture(`web/server/scoring/test-support`의 `loadBid`·`loadExtraction`)
  - 회사 프로필: [revision 5 내용](../20261027/profile.json)의 `.profile`
  - 인력: fixture 200명
  - 결정 모델: 없음(`kev: null`)
  - 마감: 운영 DB의 +15일 이동 뒤 값(FX-02 2026-11-14 18:00 KST, FX-03 2026-11-19 18:00 KST)
- 검산: 같은 방법으로 17건을 계산해 운영 revision 5 재분석(2026-10-27, Qwen 추출)과 견줬다. 16건의 점수가 같았다. 나머지 1건 FX-13은 fixture 입력이 일부러 스키마를 어기는 시험용이라 계산하지 못했다.
- 한계: 운영 [재분석]은 Qwen 추출과 Bosun 실추론을 쓴다. 추출이 fixture와 다르면 점수도 다를 수 있다(추정). 결정 모델 분포는 미리 알 수 없다.

## FX-02 (S4)

| 분석한 날 | 점수 | 권고 | 필수 자격 |
|---|---|---|---|
| 10-28 ~ 11-02 | 43 | WATCH | `NEEDS_REVIEW` 2건: 소프트웨어사업자 신고확인서(`SW_BUSINESS_REG`)·직접생산확인증명서(`DIRECT_PRODUCTION`), 사유 `COMPANY_EVIDENCE_MISSING` |
| 11-03 ~ 11-04 | 37 | WATCH | 같음 |

요소별 점수(10-28 분석):

| 요소 | 점수 | 까닭 |
|---|---|---|
| 기술 적합 | 8 / 30 | 필수 기술 6개 중 2개(Java·Spring Boot). 없는 것: PostgreSQL·Vue.js·SCORM 연동·WebRTC. 우대 기술(Kubernetes·AWS) 0개 |
| 유사 실적 | 2.6 / 25 | 교육 분야 실적이 없다(공개 실적은 민원·기타) |
| 인력 가용성 | 20 / 20 | 11-03부터는 14 / 20(마감까지 영업일 9 → 일정 계수 0.7) |
| 규모 적합 | 7.5 / 15 | missing `PROFILE_PROJECTS_EMPTY`. 공개 실적에 금액이 없다 |
| 전략 선호 | 5 / 10 | 교육은 선호 분야(민원·데이터 플랫폼·AX·스마트시티) 밖 |

점수는 분석한 날 기준이다. 분석 때 저장한 입력 스냅샷에 그날 날짜가 들어간다. 그래서 11-02까지 재분석하면 11-04 발표 때도 43이 보인다(추정, 스냅샷 재계산이 같은 값을 내는 것은 아래 가정 재계산으로 확인).

가정 재계산(`whatIf`, 10-28 ~ 11-02 분석 기준. 11-03 이후 분석이면 43 대신 37이고 결과는 같다):

| 켠 스위치 | 가정 결과 |
|---|---|
| 없음 | 43 WATCH |
| `SW_BUSINESS_REG`만 | 43 WATCH(`DIRECT_PRODUCTION`이 아직 `NEEDS_REVIEW`) |
| `DIRECT_PRODUCTION`만 | 43 WATCH |
| 둘 다 | **43 NO-BID**, 필수 자격 `SATISFIED` |
| `ICT_CONSTRUCTION` | 거부(이 공고가 요구하지 않는 자격) |

자격 판정은 점수에 들어가지 않는다. 그래서 두 자격이 모두 있다고 가정하면 `NEEDS_REVIEW` 상한(WATCH)이 풀리고 43점(50 미만)대로 NO-BID가 된다.

## FX-03 (옛 S3 장면)

- 운영 최신 분석: 프로필 revision 2, `mock` run(2026-10-20), 68 NO-BID, 결정 모델 BID 0.55 / WATCH 0.30 / NO_BID 0.15, `MODEL_RULE_DISAGREEMENT`. 사유는 "정보통신공사업 등록 없음"이다. 공개 프로필은 정보통신공사업을 보유(`HELD`)로 적는다. 목록·대시보드는 최신 프로필로 만든 분석만 붙이므로 FX-03은 "미분석"으로 보인다(`supabase/migrations/20261023000200_procurement_reads.sql`).
- revision 5로 재분석하면(계산, 날짜 무관): 53 WATCH. 필수 자격은 `ICT_CONSTRUCTION` `SATISFIED`, `SW_BUSINESS_REG` `NEEDS_REVIEW`. 가정 재계산은 `SW_BUSINESS_REG` 하나만 켤 수 있고 결과는 53 WATCH(자격 `SATISFIED`)다.
- **실제 재분석(2026-10-28 09:47 KST, 사용자 승인)**: 운영 화면 [재분석] 1회. run `46822701`, `COMPLETED`, 프로필 revision 5, `live`·`local`, `Qwen3.8-Flash-Next-AWQ-INT4` + `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`, `RULES_WITH_KEV_ASSIST`, 대체 없음. 결과 53 WATCH로 계산과 같다. 자격도 계산과 같다(`ICT_CONSTRUCTION` `SATISFIED`, `SW_BUSINESS_REG` `NEEDS_REVIEW` `COMPANY_EVIDENCE_MISSING`). 결정 모델은 NO_BID(BID 0.05 / WATCH 0.24 / NO_BID 0.71), `MODEL_RULE_DISAGREEMENT`, missing `scaleFit`. 화면: [1440](fx03-reanalysis-1440.png)·[1280](fx03-reanalysis-1280.png), 대시보드 분석 대기 1 · BID 권고 0 · 진행 중 WATCH 14([1440](dashboard-demo-after-fx03-1440.png)).

## FX-01 (새 S3 장면, 운영 저장값)

운영 revision 5 run(2026-10-27 17:23 KST, `LIVE`)의 값이다.

- 58 WATCH.
- 필수 자격 3건 모두 `NEEDS_REVIEW`, 사유 `COMPANY_EVIDENCE_MISSING`이다. 해당 자격은 소프트웨어사업자 신고확인서·직접생산확인증명서·중소기업확인서이고, 공고 인용은 각 1건이다.
- 결정 모델 분포는 BID 0.21 / WATCH 0.09 / NO_BID 0.70이고, `MODEL_RULE_DISAGREEMENT`가 붙었다.

## 운영 DEMO 공고 최신 분석 (2026-10-28 조회, FX-03은 재분석 뒤 값)

`score_runs`에서 공고마다 최신 `COMPLETED`·`PARTIAL` run을 골랐다. "결정 모델" 열은 Bosun이 고른 선택지와 분포(BID / WATCH / NO_BID)다.

| 공고 | 프로필 rev | 점수 | 권고 | 결정 모델 | 플래그 |
|---|---|---|---|---|---|
| FX-01 | 5 | 58 | WATCH | NO_BID 0.21 / 0.09 / 0.70 | `MODEL_RULE_DISAGREEMENT` |
| FX-02 | 2 | 66 | WATCH | BID 0.47 / 0.07 / 0.46 | `MODEL_RULE_DISAGREEMENT`·`KEV_MANDATORY_RISK` |
| FX-03 | 5 | 53 | WATCH | NO_BID 0.05 / 0.24 / 0.71 | `MODEL_RULE_DISAGREEMENT` |
| FX-04 | 5 | 60 | WATCH | WATCH 0.02 / 0.58 / 0.40 | — |
| FX-05 | 5 | 75 | WATCH | NO_BID 0.08 / 0.18 / 0.74 | `MODEL_RULE_DISAGREEMENT` |
| FX-06 | 5 | 58 | WATCH | NO_BID 0.10 / 0.29 / 0.62 | `MODEL_RULE_DISAGREEMENT` |
| FX-07 | 5 | 43 | WATCH | NO_BID 0.05 / 0.19 / 0.76 | `MODEL_RULE_DISAGREEMENT` |
| FX-08 | 5 | 60 | WATCH | NO_BID 0.10 / 0.16 / 0.74 | `MODEL_RULE_DISAGREEMENT` |
| FX-09 | 5 | 51 | WATCH | WATCH 0.03 / 0.51 / 0.46 | — |
| FX-10 | 5 | 55 | WATCH | NO_BID 0.04 / 0.15 / 0.81 | `MODEL_RULE_DISAGREEMENT` |
| FX-11 | 5 | 73 | WATCH | WATCH 0.02 / 0.62 / 0.36 | — |
| FX-13 | 5 | 65 | WATCH | NO_BID 0.15 / 0.29 / 0.56 | `MODEL_RULE_DISAGREEMENT` |
| FX-14 | 5 | 57 | WATCH | NO_BID 0.10 / 0.15 / 0.74 | `MODEL_RULE_DISAGREEMENT` |
| FX-15 | 5 | 63 | WATCH | NO_BID 0.04 / 0.17 / 0.79 | `MODEL_RULE_DISAGREEMENT` |
| FX-16 | 5 | 65 | WATCH | NO_BID 0.05 / 0.07 / 0.88 | `MODEL_RULE_DISAGREEMENT` |
| FX-17 | 5 | 58 | WATCH | NO_BID 0.02 / 0.21 / 0.77 | `MODEL_RULE_DISAGREEMENT` |
| FX-18 | 5 | 62 | WATCH | NO_BID 0.12 / 0.36 / 0.52 | `MODEL_RULE_DISAGREEMENT` |
| FX-19 | 5 | 63 | WATCH | NO_BID 0.08 / 0.31 / 0.61 | `MODEL_RULE_DISAGREEMENT` |
| FX-20 | 5 | 60 | WATCH | NO_BID 0.02 / 0.20 / 0.78 | `MODEL_RULE_DISAGREEMENT` |

- 운영 화면 기준 BID 권고는 0건이다. revision 5 분석은 모두 WATCH다. 재분석 전에는 옛 revision 2의 FX-03(68 NO-BID)이 유일한 NO-BID였고 목록에서는 "미분석"으로 보였다. 지금 "미분석"은 FX-02 하나다.
- 운영에서 FX-12(`DEMO-2026-0012`)는 없다.

## 발표에 주는 영향

사용자 결정(2026-10-28, 선택지 1)은 공개 프로필을 그대로 두고 데이터도 바꾸지 않는 것이다. 대본과 문서 숫자만 바꾼다. 반영한 문서는 [[../../../19-DEMO-SCENARIO|19 데모 시나리오]]·[[../../../18-HACKATHON|18 해커톤]]·[[../../../submission/slides-spec|덱 제작 명세]]·[[../../../12-ROADMAP|12 로드맵]]·[[../../../16-DECISIONS|16 결정]] ADR-059다.

- S3: FX-01로 근거 인용과 규칙 우선(결정 모델 NO_BID 0.70, 규칙 WATCH, `MODEL_RULE_DISAGREEMENT`)을 보인다. FX-03은 장면에서 뺐다.
- S4: FX-02를 [재분석]해 43 WATCH(필수 자격 2건 확인 필요)를 보인다. 이어서 두 자격 "보유 가정"을 켜면 NO-BID가 된다. 마무리 말은 "자격이 있어도 이 사업은 적합도가 낮다"이다.
- BID 장면은 덱의 계산 예시(가상 프로필 FX-01 94 BID, `mock` 골든)로 설명한다.
- FX-03은 2026-10-28 사용자 승인으로 revision 5로 재분석했다(53 WATCH, 위 FX-03 절). 촬영 장면에는 쓰지 않는다.
