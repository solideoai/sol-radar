---
title: "SOL Score v0.2 운영 반영·전체 재채점 기록 (2026-10-30)"
status: active
tags: [sol-radar, evidence, scoring, deployment]
updated: 2026-10-30
---

# SOL Score v0.2 운영 반영·전체 재채점 기록 (2026-10-30)

[[16-DECISIONS|ADR-071]] 운영 반영 기록이다. 실행서는 `infra/company/README.md` §11이다. 단계마다 사용자 승인을 받았다("회사망에 들어왔어. 시작해", "1로 가자"(ADR-056 대안 A 함께 반영), "그래 둘 다 진행해"(DB 재채점·FX-01 추천 분석 1회)).

## 반영 순서

| 시각(KST) | 단계 | 결과 |
|---|---|---|
| 08:58 | 회사 읽기(`d0`) | 배포 checkout `sol-radar-deploy` `deploy/main-20261029-ri` `384e469857f0`, `sol-radar-app` `main` `cbb3831e86da`(그대로 둔다). Analysis Worker `sol-radar-analysis-worker:384e469857f0`, redis-api `a58834472738`(healthy), ai-gateway `384e469857f0`. 진행 중 refill·일괄 분석 프로세스 없음 |
| 09:07 | 이미지 준비(`prep`) | 배포 checkout에 `deploy/sv02-20261030` = `b1f4b6d4`(feature) + 회사 carry `9bb24b0` → `7b5a79dc9054`. `b1f4b6d4`와의 차이는 carry 두 파일뿐이다. Analysis Worker 이미지 `sol-radar-analysis-worker:7b5a79dc9054` 빌드. 기존 redis-api 이미지에 되돌리기 태그 `sol-radar-gateway-redis-api:rollback-20261030`(`a58834472738`)를 붙이고 새 redis-api 이미지 빌드. 실행 중 컨테이너는 그대로 |
| 09:15:12 | Analysis Worker 재생성(`up-worker`) | `analysis-worker image=sol-radar-analysis-worker:7b5a79dc9054`, 로그 `analysis-only worker started`, `{"event":"analysis.reconcile.summary","checked":0,"requeued":0,"failed":0,"inFlight":0}`. 재생성 전 `QUEUED`·`RUNNING` 0건 |
| 09:15:36 | redis-api 재생성(`up-rapi`) | 이미지 `d7754adbdfa9`, `health=healthy`. 루프백 `/health`는 토큰이 없어 `401`(정상) |
| 09:18:51 | 재채점 dry-run | `shown=390 current=0 targets=390 written=0 … invalid=0 failed=0 recommendation_changed=0 before[n=390 min=23 max=75 avg=48.0] after[n=390 min=43 max=95 avg=66.9]`, exit 0 |
| 09:20 | main push(Vercel 운영) | `a3d73b93..161686a9`(origin이 문서 커밋만큼 앞서 있어 `--no-ff` 병합). push 전 검사 통과. GitHub `Vercel success`, `/health/ready` 200 |
| 09:35:46 | 재채점 `--limit 5` | `targets=5 written=5 … failed=0 recommendation_changed=0 before[n=5 min=39 max=60 avg=50.6] after[n=5 min=62 max=89 avg=74.4]`, exit 0 |
| 09:37:40 | 재채점 나머지 | `shown=390 current=5 targets=385 written=385 existing=0 busy=0 invalid=0 failed=0 recommendation_changed=0 before[n=385 min=23 max=75 avg=48.0] after[n=385 min=43 max=95 avg=66.8]`, exit 0 |
| 09:41 | FX-01 [추천 분석] 1회 | 새 run `c03633ab`에 `bc32b12f` `DONE`·`MODEL`(`Qwen3.8-Flash-Next-AWQ-INT4`, 요청 00:41:21Z → 끝 00:41:24.9Z). 강점 3·보완할 점 3, 판단 이유에 92점과 자격 3건 확인 필요 |

- AI gateway·ingest·documents·기업마당 Worker·Redis는 바꾸지 않았다. gateway는 `384e469857f0` 그대로다.
- ADR-056 대안 A(추출 캐시 키에 입력 문서 집합)는 같은 Analysis Worker 이미지로 함께 반영됐다.
- 재채점은 일회용 컨테이너(`docker compose … run --rm --no-deps analysis-worker node --conditions=react-server --import tsx worker/score-rescore.ts --org-slug org-01`)로 돌렸다. 운영 Analysis Worker 컨테이너는 쓰지 않았다.
- 되돌리기: Worker는 `rb-worker 384e469857f0`, redis-api는 `rollback-20261030` 태그. 쓰지 않았다.

## DB 확인 (재채점 뒤, 읽기만)

| 묶음 | 새 run | 최저 | 최고 | 평균 | 중앙 | 75 이상 | 50 미만 | 권고 |
|---|---|---|---|---|---|---|---|---|
| 실공고 | 372 | 43 | 88 | 66.1 | 68 | 60 | 25 | 모두 WATCH |
| DEMO | 18 | 68 | 95 | 83.8 | 87 | 14 | 0 | 모두 WATCH |

- 새 run 390건 모두 `COMPLETED`, `requested_by` 없음(알림 0), 감사 행 390건. 실공고 가운데 369건은 일괄 분석 run을 다시 계산한 것이라 멱등 키가 `…:it-batch-rescore-sol-v0.2.0-…`다(`/projects` "검토 대기"에서 계속 빠진다).
- 재채점 시간대의 outbox는 수집의 `BID_CREATED`뿐이었다. 추천·분석 완료 이벤트는 없다. 진행 중 run 0.
- 권고가 바뀐 공고 0건. 공개 자료 프로필(revision 5)의 보유 자격이 정보통신공사업 1건이라 필수 자격 대부분이 `NEEDS_REVIEW`이기 때문이다([[16-DECISIONS|ADR-059]]).
- FX-02는 재채점 대상이 아니었다. 최신 프로필(revision 5) run이 없고 revision 2 run(66 보류)만 있다. 목록·대시보드에는 계속 "미분석"이고 대시보드 분석 대기 1·추천 권고 0이다.
- 재채점 전 run에 붙은 추천 분석 3건(FX-01 1건, 실공고 2건)은 run이 바뀌어 화면에 보이지 않는다. FX-01만 위에서 다시 만들었다.

## 발표 공고 값

| 공고 | 장면 | v0.1 | v0.2 run | v0.2 값 |
|---|---|---|---|---|
| FX-01 | S3 | 58 보류 | `c03633ab` | **92 보류**. 기술 적합 22.2/30 · 유사 실적 25/25 · 인력 20/20 · 규모 적합 15/15 · 전략 선호 10/10. 필수 자격 3건 `NEEDS_REVIEW`. 결정 모델 0.21 / 0.09 / 0.70, `MODEL_RULE_DISAGREEMENT` 그대로 |
| FX-01 가정 재계산 | S3 | 보류 58 → 보류 58 | 저장 안 함 | 스위치 1개 → 보류 92, 3개 → **추천 92**(요소 변화 없음) |
| FX-03 | 질의응답 | 53 보류 | `c014300a` | 90 보류. 소프트웨어사업자 1건 `NEEDS_REVIEW`. 가정하면 추천 90(저장 안 함) |
| FX-02 | S4 | 예상 43 | 재분석 전 | 예상 59 보류(11-03부터 53), 두 자격을 가정해도 보류([미리 계산](fx02-forecast.md)) |
| 동국대 nDRIMS(실공고) | S-LIVE | 44 보류 | `599324cb` | 49 보류, `RULES_WITH_KEV_ASSIST`·`MODEL_RULE_DISAGREEMENT`. `run_mode` `LIVE`, 모델 `Qwen3.8-Flash-Next-AWQ-INT4`·`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`, 추출 행 같음, 자격 판정 6건(근거 4건) |
| 국가 재난 정신건강(실공고) | 촬영 안 함 | 45 보류 | `7a143b12` | 65 보류 |
| 부경대(실공고) | 촬영 안 함 | 38 보류 | `05bab09e` | 53 보류 |

나머지 DEMO: FX-04 68 · FX-05 83 · FX-06 93 · FX-07 85 · FX-08 75 · FX-09 89 · FX-10 73 · FX-11 93 · FX-13 78 · FX-14 89 · FX-15 89 · FX-16 70 · FX-17 85 · FX-18 94 · FX-19 95 · FX-20 68(모두 보류).

FX-01·FX-03 가정 재계산은 운영 화면에서 스위치를 켜 확인하고 [가정 지우기]로 껐다. 가정 재계산은 DB에 쓰지 않는다([[16-DECISIONS|ADR-037]]).

## 화면

1440·1280 두 폭에서 봤다. 가로 넘침 0.

| 파일 | 내용 |
|---|---|
| [fx01-detail-1440.png](fx01-detail-1440.png) | FX-01 상세 전체 페이지: 분석 요약 띠(완료 2026-10-30 09:39 · live · `sol-v0.2.0` · 프로필 rev 5), 권고 보류 92, 분해 22.2 · 25 · 20 · 15 · 10, 결정 모델 21% / 9% / 70%, 추천 분석(2026-10-30 09:41 작성) |
| [fx01-detail-1280.png](fx01-detail-1280.png) | 같은 화면 1280 첫 화면 |
| [fx01-whatif1-1280.png](fx01-whatif1-1280.png) | 스위치 1개: 보류 → 보류, 92 → 92 |
| [fx01-whatif3-1440.png](fx01-whatif3-1440.png) | 스위치 3개: 보류 → 추천, 92 → 92 "변화 없음", 필수자격 확인 필요 → 충족, 결정 패널 보류 92 |
| [fx01-whatif3-1280.png](fx01-whatif3-1280.png) | 같은 가정 띠 1280 |
| [bids-live-after-limit5-1440.png](bids-live-after-limit5-1440.png) | `--limit 5` 직후 실공고 목록(재채점된 행 85, 아직 아닌 행 60) |

`fx01-whatif3-*`는 주소에 `?origin=demo` 없이 열어 상단바 `DEMO` 배지가 없다. 상세 머리의 `DEMO` 배지는 있다.

## 발표 대본 개정

FX-02는 두 자격을 가정해도 보류라 v0.1의 "가정하면 비추천" 장면이 성립하지 않는다. 사용자가 선택지 "1"을 골랐다([[16-DECISIONS|ADR-059]] 2026-10-30 개정). 가정 재계산은 S3 FX-01(클립 2, 슬라이드 10 2:05)로 옮겼고, S4는 재분석 → 59 보류 → 사람이 비추천과 사유를 기록하는 장면(클립 3, 슬라이드 12 2:05)이다. 반영 문서는 [[19-DEMO-SCENARIO|19]]·[[slides-spec|덱 제작 명세]]·[[18-HACKATHON|18]]이다.

## 관련 문서

- [[16-DECISIONS|16 ADR]] — ADR-059, ADR-071
- [[08-SCORING|08 SOL Score]]
- [[PROGRESS|진행 상황]]
- [FX-02 미리 계산](fx02-forecast.md)
