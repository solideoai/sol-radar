---
title: "SOL Score v0.2로 본 FX-02 재분석 미리 계산"
status: active
tags: [sol-radar, demo, scoring]
updated: 2026-10-30
---

# SOL Score v0.2로 본 FX-02 재분석 미리 계산 (2026-10-30)

S4 FX-02는 촬영 때 [재분석]을 누른다. 이 문서는 `sol-v0.2.0`([[16-DECISIONS|ADR-071]]) 반영 뒤 그 결과를 미리 계산한 기록이다. 운영 DB·AI는 부르지 않았다. 방법은 [v0.1 미리 계산](../../company-public-profile/20261028/fx-forecast.md)과 같다.

## 방법

- 규칙 엔진 `analyze()`와 가정 재계산 `whatIf()`(`web/server/scoring/`)를 그대로 불렀다.
- 입력
  - 공고·추출: fixture(`web/server/scoring/test-support`의 `buildInput("FX-02")`)
  - 회사 프로필: [revision 5 내용](../../company-public-profile/20261027/profile.json)의 `.profile`
  - 결정 모델: 없음(`kev: null`)
  - 마감: 운영 DB 값 2026-11-14 18:00 KST
- 한계: 운영 [재분석]은 Qwen 추출을 새로 한다(회사 gateway `req-extract/v0.2`, [[16-DECISIONS|ADR-064]]). 같은 방법으로 FX-01을 계산하면 86이고, 운영 FX-01(Qwen 추출, v0.2 재채점)은 92다. 화면 값이 다를 수 있다. 결정 모델 분포는 미리 알 수 없다.
- v0.2 전체 재채점은 FX-02를 다시 계산하지 않았다. 재채점은 최신 회사 프로필(revision 5) run만 고르는데, FX-02에는 revision 2 run(2026-10-24, 66 보류)뿐이다.

## 결과

| 분석한 날 | 점수 | 권고 | 기술 적합 | 유사 실적 | 인력 | 규모 적합 | 전략 선호 |
|---|---|---|---|---|---|---|---|
| 10-30 ~ 11-02 | **59** | WATCH | 19/30 | 0/25 | 20/20 | 15/15 | 5/10 |
| 11-03 ~ 11-04 | 53 | WATCH | 19/30 | 0/25 | 14/20 | 15/15 | 5/10 |

- 필수 자격: `NEEDS_REVIEW` 2건. 소프트웨어사업자 신고확인서(`SW_BUSINESS_REG`)·직접생산확인증명서(`DIRECT_PRODUCTION`), 사유 `COMPANY_EVIDENCE_MISSING`.
- 기술 적합 19/30: 필수 기술 6개 중 Java·Spring Boot 2개가 회사 기술 목록에 있다. 나머지 4개(PostgreSQL·Vue.js·SCORM 연동·WebRTC)와 우대 기술 2개(Kubernetes·AWS)는 `technologiesComplete=false`라 0.5로 계산한다(필수 0.667, 우대 0.5 → 0.633).
- 유사 실적 0/25: 공고 분야 "교육"과 같은 분야의 실적이 없다(실적 후보 모두 `domainMatch` 0).
- 인력 20/20: 필요 인력 미추출이라 예산 구간으로 20 FTE를 추정했고, 가용 95.5 FTE다. 11-03부터는 마감까지 영업일이 줄어 14/20이다.
- 규모 적합 15/15: 금액을 아는 실적이 없어 연 매출 대비 예산(28억 / 602억 = 4.6%)으로 판정했다.
- 전략 선호 5/10: 교육은 선호 분야가 아니고 기관 선호가 없어 분야 수준 0.5만 본다.

## 가정 재계산

| 분석한 날 | 켠 가정 | 가정 권고 | 가정 점수 |
|---|---|---|---|
| 10-30 ~ 11-02 | 소프트웨어사업자 | WATCH | 59 |
| 10-30 ~ 11-02 | 소프트웨어사업자 + 직접생산 | WATCH | 59 |
| 11-03 ~ 11-04 | 두 자격 모두 | WATCH | 53 |

두 자격을 모두 가정해도 50 이상 75 미만이라 보류다. v0.1(43)에서는 가정하면 비추천이었다. 그래서 2026-10-30 사용자 결정("1", [[16-DECISIONS|ADR-059]] 개정)으로 가정 재계산 장면을 S3 FX-01로 옮겼다. S4는 재분석 → 59 보류 → 사람이 비추천과 사유를 기록하는 장면이다.

## 원 출력

```text
2026-10-30 score=59 WATCH | skillMatch=19/30 pastPerformance=0/25 staffAvailability=20/20 scaleFit=15/15 strategicPreference=5/10 | SW_BUSINESS_REG:NEEDS_REVIEW DIRECT_PRODUCTION:NEEDS_REVIEW
  whatIf SW_BUSINESS_REG → {"rec":"WATCH","score":59}
  whatIf SW_BUSINESS_REG+DIRECT_PRODUCTION → {"rec":"WATCH","score":59}
2026-11-02 score=59 WATCH | skillMatch=19/30 pastPerformance=0/25 staffAvailability=20/20 scaleFit=15/15 strategicPreference=5/10 | SW_BUSINESS_REG:NEEDS_REVIEW DIRECT_PRODUCTION:NEEDS_REVIEW
  whatIf SW_BUSINESS_REG → {"rec":"WATCH","score":59}
  whatIf SW_BUSINESS_REG+DIRECT_PRODUCTION → {"rec":"WATCH","score":59}
2026-11-03 score=53 WATCH | skillMatch=19/30 pastPerformance=0/25 staffAvailability=14/20 scaleFit=15/15 strategicPreference=5/10 | SW_BUSINESS_REG:NEEDS_REVIEW DIRECT_PRODUCTION:NEEDS_REVIEW
  whatIf SW_BUSINESS_REG → {"rec":"WATCH","score":53}
  whatIf SW_BUSINESS_REG+DIRECT_PRODUCTION → {"rec":"WATCH","score":53}
FX-01 fixture check score=86 WATCH
```

계산 스크립트는 세션 scratchpad에 두었고 저장소에는 넣지 않았다. `web/`에서 `node --conditions=react-server --import tsx <스크립트> <저장소 경로>`로 돌렸다.

## 관련 문서

- [[19-DEMO-SCENARIO|19 데모 시나리오]] §2.2·§4 S4
- [[16-DECISIONS|16 ADR]] — ADR-059(발표 대본), ADR-071(SOL Score v0.2)
- [반영 기록](rollout.md)
