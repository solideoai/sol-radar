---
title: "회사 확인 자격 3건 운영 반영·프로필 교체 재채점 기록 (2026-10-30)"
status: active
tags: [sol-radar, ops, company-profile, scoring]
updated: 2026-10-30
---

# 회사 확인 자격 3건 운영 반영·프로필 교체 재채점 기록 (2026-10-30)

## 배경

운영 SOL Score v0.2 run 390건이 모두 보류였다(75점 이상 74건, 최고 95). 원인은 점수 계산식이 아니라 결정 정책 2단계(필수 자격 `NEEDS_REVIEW`면 점수와 무관하게 보류, `web/server/scoring/decision.ts:35`)다. v0.1 때도 403건이 같은 이유로 보류였다. 공개 자료 프로필(revision 5)의 보유 자격이 정보통신공사업 1건이라, 소프트웨어사업자·직접생산·중소기업 확인을 요구하는 공고가 `COMPANY_EVIDENCE_MISSING`으로 남았다.

사용자 결정(2026-10-30): "지금 진행해 미루지말고 솔리데오가 실제로 가진 자격은 다 있고 중소기업확인서랑 사업자등록증, 소프트웨어 사업자 다 확인했어".

## 바꾼 것

| 항목 | 내용 |
|---|---|
| 프로필 파일 | [profile.json](profile.json) = 10-27 파일(운영 revision 5와 기술 19·실적 33·재무·선호 일치 확인) + 자격 3건 `HELD`(소프트웨어사업자 신고확인서 `SW_BUSINESS_REG`, 직접생산확인증명서 `DIRECT_PRODUCTION`, 중소기업확인서 `SME_CONFIRMATION`) + 출처 `company-confirmed-20261030`(`COMPANY_CONFIRMED`, 확인자 "SOL RADAR 운영 관리자(2026-10-30 확인)"). 사업자등록증은 자격 코드가 없어 넣지 않았다. 직접생산확인증명서는 "다 있고"에 따라 넣었다 |
| 재채점 CLI | `web/worker/score-rescore.ts` 에 `--from-profile-revision <n>` 추가. revision n 프로필로 보이던 run 의 스냅샷에서 `profile` 만 최신 프로필로 바꿔 규칙으로 다시 계산하고, 새 run 은 최신 프로필에 묶는다. 멱등 키는 `…-sol-v0.2.0-p6-<원본 run>`. 최신 프로필 run 이 이미 있는 공고는 건너뛴다. Qwen·Bosun 은 부르지 않는다 |

결정 모델(Bosun) 출력은 revision 5 프로필로 만든 값 그대로다. 그래서 추천으로 바뀐 공고에 `MODEL_RULE_DISAGREEMENT`·`KEV_MANDATORY_RISK` 가 붙을 수 있다. 참고 지표라 권고·점수에는 영향이 없다.

## 운영 반영 (사용자가 로컬 Mac 에서 `!` 로 실행)

env 파일은 사용자가 경로만 지정했고 에이전트는 열지 않았다.

| 시각(KST) | 단계 | 결과 |
|---|---|---|
| 12:41 전후 | 프로필 CLI dry-run | host `brtysdocxemrqhdezzqg.supabase.co`, org-01, 다음 revision 6, 자격 추가 3·삭제 0, 기술·실적·업종 변화 0. `financials: true` 는 jsonb 키 순서 비교 오탐(값 같음) |
| 12:42:03 | 프로필 `--apply` | revision 6, id `7878c9eb-5ec3-4e72-8ba6-7a723e065607` |
| 12:42 | 재채점 dry-run(적용과 같은 명령 줄) | `profile 5->6 … shown=389 current=0 targets=389 … invalid=0 failed=0 recommendation_changed=15`, 점수 분포 전후 같음(min 43·max 95·avg 67.0) |
| 12:42:57~12:43:00 | 재채점 `--limit 5` | `written=5 … failed=0 recommendation_changed=1` |
| 12:43:49~12:47:06 | 재채점 나머지 | `shown=389 current=5 targets=384 written=384 existing=0 busy=0 invalid=0 failed=0 recommendation_changed=14` |

shown 이 390 이 아니라 389 인 것은 "2027년 경기도 대기환경진단평가시스템 유지관리 용역"(56점)이 같은 날 12:05 공고 revision 2 로 바뀌어 옛 run(revision 1)이 이미 화면에서 빠져 있었기 때문이다.

## DB 확인 (재채점 뒤, 읽기만)

- revision 6 run 389건 모두 `COMPLETED`, `requested_by` 없음. 진행 중 run 0, 최근 1시간 `FAILED` 0, 추천·분석 완료 outbox 0(수집 `BID_CREATED`·`BID_CHANGED` 뿐).
- 권고 분포(공고별 화면에 보이는 run):

| 묶음 | 추천 | 보류 | 비추천 |
|---|---|---|---|
| 실공고 371 | 2 (서울통계통합플랫폼 85, 실행형 AI 플랫폼 85) | 366 (43~88) | 3 (49점: 강서대·숭의여대·에듀오션) |
| DEMO 18 | 10 (FX-01 92·FX-03 90·FX-06 93·FX-07 85·FX-08 75·FX-09 89·FX-13 78·FX-14 89·FX-15 89·FX-18 94) | 8 (68~95) | 0 |

- 비추천 3건은 자격 확인이 풀리며 결정 정책이 점수 구간(50 미만)으로 내려간 결과다.
- 88점 해양환경공단 KOEM AI 구축은 공고 쪽 정보 부족(보조 조회 예산·자격 요건 추출 UNKNOWN)이라 그대로 보류다.
- DEMO 보류 8건의 원인: 참가 자격 요건 `NOTICE_INFO_MISSING`·`STAGE_NOT_APPLICABLE`(FX-04·05·11·17·19·20), 방산업체 지정 `COMPANY_EVIDENCE_MISSING`(FX-16 70), 점수 구간(FX-10 은 자격 충족, 73점).

## 발표 영향

- S3 FX-01 은 처음부터 추천 92다. "보류 92 → 자격 3개 가정 → 추천 92" 가정 재계산 장면은 성립하지 않는다(가정 스위치 대상 자격이 없다). DEMO 가운데 가정 재계산 스위치가 남은 공고는 FX-16(방산업체 지정, 가정해도 70 보류)뿐이다.
- FX-01 추천 분석(`bc32b12f`)은 run 이 바뀌어 화면에 보이지 않는다. 다시 만들려면 [추천 분석] = 회사 Qwen 호출이다.
- FX-02 는 재채점 대상이 아니었다(revision 2 run 뿐). S4 재분석 때 revision 6 프로필로 계산된다.

## 화면

운영 화면은 아직 보지 못했다. 로그인이 필요하고(`/dashboard?origin=demo` 307 → `/auth/login`), Playwright MCP 브라우저를 다른 세션이 쓰고 있었다.

## 되돌리기

revision 5 와 같은 내용으로 revision 7 을 넣고 `--from-profile-revision 6` 으로 다시 재채점한다. 옛 run 은 지우지 않는다.

## 관련 문서

- [[../../sol-score-v02/20261030/rollout|SOL Score v0.2 운영 반영]]
- [[../20261027/prod-rollout|회사 공개 프로필 운영 반영(10-27)]]
- [[16-DECISIONS|16 ADR]] — ADR-052·059·071
