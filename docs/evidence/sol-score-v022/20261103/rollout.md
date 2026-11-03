---
title: "SOL Score v0.2.2 운영 반영 기록 (2026-11-03)"
status: active
tags: [sol-radar, evidence, scoring, deployment]
updated: 2026-11-03
---

# SOL Score v0.2.2 운영 반영 기록 (2026-11-03)

[[16-DECISIONS|ADR-071]] `sol-v0.2.2` 자격 판정 개정(공고 인용이 없어도 회사가 보유한 자격은 충족)과 목록 "자격 확인" 표시의 운영 반영 기록이다. 실행서는 `infra/company/README.md` §11.8이다. 사용자가 "오늘 반영"을 고른 뒤 단계마다 승인했다(1단계 회사 준비·재생성 "진행", 2단계 main push "재생성 직후 push", 3단계 재채점 "오늘 재채점").

## 반영 순서 (2026-11-03 KST)

| 시각 | 단계 | 결과 |
|---|---|---|
| 10:05 | 코드 | main `dd63e6a1`. 커밋 게이트 통과, 깨끗한 worktree에서 `pnpm verify` 통과(루트 322·web 146파일 1,200·`next build`·Python 264+57) |
| 10:21 | 브랜치 push | `fix/sol-v022` = `dd63e6a1`(push 전 검사 통과). 운영 Vercel은 그대로 |
| 10:22~10:24 | 회사 이미지 준비 | 배포 checkout `sol-radar-deploy` `deploy/sv021-20261030` `efab8acc144b` → `deploy/sv022-20261103` = `dd63e6a1` + 회사 carry(dependency reporter) → `a7ba50830419`. Analysis Worker 이미지 `sol-radar-analysis-worker:a7ba50830419`, redis-api 이미지 `e1095030d1fd`, redis-api 되돌리기 태그 `rollback-20261103`(= 옛 `b365db5b9cef`). 실행 중 컨테이너는 그대로. 실행 중 컨테이너에 checkout 바인드 마운트 없음 확인 |
| 10:25 | 재채점 dry-run(일회용 컨테이너, `--changed-only --dry-run`) | `shown=382 current=0 targets=382 written=0 existing=0 busy=0 unchanged=310 invalid=0 failed=0 recommendation_changed=3 before[n=382 min=43 max=95 avg=66.9] after[n=382 min=43 max=95 avg=66.9]`, exit 0, `CHANGED` 72줄 |
| 10:25 | 운영 DB 읽기(dry-run CHANGED 72건) | DEMO 0, 추천 분석(`recommendation_insights`)·검토(`bid_reviews`) 붙은 run 0. 비추천으로 바뀌는 49점 1건은 S-LIVE 촬영 공고 동국대 `ed2e57d4`(남은 확인 필요가 회사 보유 `SME_CONFIRMATION` 하나뿐). 사용자에게 알리고 "오늘 재채점" 결정을 받음 |
| 11:26:39~11:26:50 | Analysis Worker 재생성 | `sol-radar-analysis-worker:a7ba50830419`, `analysis.reconcile.summary` checked 0·inFlight 0. 직전 운영 DB `QUEUED`·`RUNNING` 0 |
| 11:26:50~11:27:01 | redis-api 재생성 | `e1095030d1fd`, `healthy` |

- 처음 11:15 재생성 시도는 로컬 ssh가 접속(nc 프록시) 단계에서 멈춰 서버 스크립트가 시작되지 않았다(서버 로그 없음, 컨테이너 그대로). 내 ssh PID만 끝내고 11:26에 다시 돌렸다.
- 되돌리기: Worker는 `ANALYSIS_WORKER_TAG=efab8acc144b`로 같은 compose `up -d --no-deps analysis-worker`, redis-api는 `rollback-20261103`을 `latest`로 다시 태그한 뒤 `up -d --no-deps redis-api`. 쓰지 않았다.
- 로그 원문: 회사 `/data/www/ai_workspace/sv022-prep-20261103.log`·`rescore-v022-dryrun-20261103.log`·`sv022-recreate-20261103.log`.
- AI gateway(`384e469857f0`)·ingest·documents·기업마당·알림 Worker·Redis는 바꾸지 않았다.

## main push·Vercel·재채점 쓰기

| 시각 | 단계 | 결과 |
|---|---|---|
| 11:31 | main push 1차 | push 전 검사에서 막힘. `app/(app)/(work)/gaps/gaps-view.browser.test.tsx` 1건이 15초 시간 초과(기계 부하 17~19, 다른 세션 검증 동시 실행). 이번 변경과 무관한 화면이고 같은 커밋이 10:21 브랜치 push 검사에서는 통과했다 |
| 11:36 | main push 2차(검증 칸 잡고 다시) | push 전 검사 통과(공통 59초·web 3분 34초). `f55c34c7..dd63e6a1` |
| 11:38 | Vercel production | `dpl_DnS36Fuebz1rNLvta4nwx718rpXh` READY(`dd63e6a1`, `syd1`), `solideos-radar.com` 별칭. `/health/ready` 200 `{"db":"ok","redis":"ok","storage":"ok","ai":"local"}` |
| 11:40 | 재채점 쓰기(일회용 컨테이너, `--changed-only`) | `shown=382 current=0 targets=382 written=72 existing=0 busy=0 unchanged=310 invalid=0 failed=0 recommendation_changed=3 before[n=382 min=43 max=95 avg=66.9] after[n=382 min=43 max=95 avg=66.9]`, exit 0, `CHANGED` 72줄(dry-run과 같다) |

## 반영 뒤 확인 (운영 DB 읽기·운영 화면)

- 화면 run 382건이 공고마다 최신 1건이다. 실공고 364건: 추천 9(79~85)·보류 344(43~88, 평균 66.1)·비추천 11(모두 49), 80점 이상 30건. DEMO 18건: 추천 10(75~94)·보류 8(68~95), FX-01 92 추천·FX-03 90 추천·FX-16 70 보류 그대로. 화면 run 가운데 `sol-v0.2.2`는 72건, `QUEUED`·`RUNNING` 0.
- 점수 구간과 권고가 다른 공고: 추천인데 75점 미만 0, 비추천인데 50점 이상 0. 75점 이상 보류 52(실공고 48·DEMO 4)와 50점 미만 보류 13은 모두 필수 자격 확인 필요가 남은 공고다(보조 조회 호출 예산 미조회·지역 제한·판단 어려운 자격·DEMO 설계 사례). 반영 전은 54·14였다.
- S-LIVE 촬영 공고 동국대(`R26BK01791870`, 마감 2026-11-06 11:00)의 최신 run은 `2c69dc11`(`sol-v0.2.2`, `LIVE`, 49 비추천, `review_flags` `KEV_MANDATORY_RISK`)다. 이전 run `ed2e57d4`는 49 보류·`MODEL_RULE_DISAGREEMENT`였다. 남은 확인 필요가 회사 보유 중소기업확인서(`SME_CONFIRMATION`, 공고 인용 없음) 하나뿐이어서 충족이 됐고, 50점 미만이라 비추천이다. 결정 모델 출력(비추천 0.87)은 그대로라 이제 규칙과 같다.
- 운영 화면(로그인 상태, Playwright): `/bids?origin=live` 1440·390에서 보류 배지 아래 "자격 확인" 15곳, 가로 넘침 없음([1440](prod-bids-live-1440.png)·[390](prod-bids-live-390.png)). 동국대 상세 1440: 권고 비추천 49, 자격 "공고 인용은 찾지 못했지만 회사가 보유해 충족", 사람 검토 권장 칸 `KEV_MANDATORY_RISK`([그림](prod-s-live-dongguk-1440.png)).
- 로그 원문: 회사 `/data/www/ai_workspace/rescore-v022-write-20261103.log`.
