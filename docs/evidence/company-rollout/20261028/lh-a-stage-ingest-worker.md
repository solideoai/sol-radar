---
title: "LH A단계 회사 ingest Worker 재생성 기록"
status: active
tags: [sol-radar, ops, ingestion, lh]
updated: 2026-10-28
---

# LH A단계 회사 ingest Worker 재생성 기록 (2026-10-28)

[[../../../plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]] §4.2 A2~A5 를 했다. LH 는 `enabled: false` 그대로 두고 LH 코드만 회사 ingest Worker 에 넣었다. 메인 세션이 회사 망에서 SSH 로 점검·실행 스크립트를 돌렸다. A1(main `24f2ac84..1646e7d0` push, Vercel 배포 성공)은 2026-10-27 23:00 KST 에 했다.

사용자 조건:
- 회사 운영 저장소 `sol-radar-app` 에서 하고, `infra/compose.company.yaml` 의 로컬 수정을 보존한다.
- 직전 이미지를 롤백용 태그로 남긴다.
- 일회용 컨테이너로 `--check` 를 통과한 뒤 ingest Worker 만 재생성한다.
- `g2b-scheduled` 는 1개로 유지한다. `--unschedule`·Scheduler 수동 변경은 하지 않는다.
- LH API 를 부르지 않는다. redis-api·AI gateway·분석 Worker 는 바꾸지 않는다.
- 반영 커밋은 `1646e7d0` 으로 고정한다(사용자 결정 2026-10-28 오전: 그 사이 다른 세션이 main 을 `704be371` 까지 올렸지만 LH 범위만 반영).

## 결과

| 단계 | 시각(KST) | 결과 |
|---|---|---|
| 읽기 점검 | 08:50 | 회사 HEAD `24f2ac8`, 로컬 수정 ` M infra/compose.company.yaml` 하나. ingest Worker `sol-radar-ingest-worker:24f2ac84963c`(`2d2009a7218f`) healthy·restarts 0, working_dir `/data/www/ai_workspace/sol-radar-app/infra`. 진행 중 빌드 없음, 최근 3시간 sol-radar 컨테이너 변동 없음. `--status`: `g2b-scheduled` 1개 |
| 밤사이 정기 수집 | 00:00·03:00·06:00 | 모두 `SUCCEEDED`·`COMPLETE`. LH `ingest_runs` 0건 |
| 09시 정기 수집 | 09:00:01~09:07:26 | `SUCCEEDED`·`COMPLETE`, 21건, quota_used 68. 이 회차가 끝난 뒤 Git 을 갱신했다(registry 가 실행 중 Worker 에 읽기 전용으로 마운트되어 있다) |
| A2 Git 갱신 | 09:10 | `git merge --ff-only 1646e7d0` → HEAD `1646e7d033a1`. 바뀐 파일 32개(LH 코드·fixture·증거·registry LH 설명). `compose.company.yaml` 로컬 diff sha256 앞 16자리 `e911b0f06832f2cb` 가 갱신 전후 같다 |
| 롤백 태그 | 09:10 | `sol-radar-ingest-worker:rollback-20261027-lh` = `2d2009a7218f`(`24f2ac84963c` 와 같은 이미지) |
| A3 빌드·확인 | 09:10:44 | 새 이미지 `sol-radar-ingest-worker:1646e7d033a1`(`fc42d2faa573`). 실행 중 Worker 는 그대로. 일회용 `--check` exit 0: 외부 6종(kwater-bid-notice·lh-bid-notice·kwater-procurement-plan·lh-pre-specification·g2b-procurement-request·kepco-ebid-contract) 모두 `NOT_CALLABLE(DISABLED) · 정기 수집 제외`. `--status`: waiting 0·active 0·prioritized 0, Job Scheduler 1개 |
| A4 재생성 | 09:15:33~09:15:36 | 창 확인(정각 뒤 15분), 재생성 직전 `--status` waiting·active·prioritized 0·Scheduler 1개. `docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps ingest-worker`(`INGEST_WORKER_TAG=1646e7d033a1`) → healthy·restarts 0. 기동 로그에 외부 6종 `DISABLED`, `g2b-scheduled` 다음 정각 12:00 |
| 사후 점검 | 09:16 | 다른 sol-radar 컨테이너(redis-api·AI gateway·분석 Worker·dependency-reporter·redis) 생성 시각 그대로. redis-api healthy. 새 Worker 로그 오류 0줄. 웹 `/health/ready` 200(`db`·`redis`·`storage` ok, `ai: local`) |
| A5 12시 정기 수집 | 12:00:01~12:11:26 | 새 Worker 가 받아 정시 시작(queueDelayMs 7). `SUCCEEDED`·`COMPLETE`, 247건, quota_used 684, 685초. 오늘 5회차 모두 `SUCCEEDED`, LH `ingest_runs` 0건, `bid_notices` LH 0건 |
| 마지막 확인 | 12:13 | ingest Worker `1646e7d033a1` healthy·restarts 0, 회사 HEAD `1646e7d033a1`, Job Scheduler 1개(`g2b-scheduled`, 다음 15:00) |

처음 실행한 빌드 스크립트는 working_dir 기대값을 `sol-radar-app` 으로 잘못 적어 Git 을 바꾸기 전에 멈췄다(09:10:25). Compose 가 적는 작업 폴더는 compose 파일 폴더 `sol-radar-app/infra` 다. 기대값만 고쳐 다시 돌렸다.

## 되돌리기

registry 의 LH 가 `enabled: false` 인 동안만 이미지만 되돌린다.

```bash
cd /data/www/ai_workspace/sol-radar-app
INGEST_WORKER_TAG=rollback-20261027-lh docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps ingest-worker
```

재생성과 같은 시간 창(KST 정각 +15분 ~ 다음 정각 −30분)과 `--status` 조건을 지킨다. `--unschedule` 은 쓰지 않는다.

## 이 뒤의 일

- LH 를 켜는 registry 커밋(B1)은 다른 세션이 main `c5c88510` 에 넣었다. 회사 저장소는 `1646e7d0` 이라 운영 LH 는 꺼져 있다. 회사 반영(B2~B4)은 따로 승인한다.
- 회사 저장소를 main 최신으로 갱신하면 K-water·KEPCO 수집 변경(`0262aac4`·`209d5515`)도 함께 들어간다. registry 는 실행 중 Worker 에 마운트되어 있으므로 갱신과 재생성을 같은 창에서 한다.

## 관련 문서

- [[../../../plans/2026-10-27-lh-bid-notice-activation|LH 활성화 계획]]
- [10-27 ingest Worker 재생성 기록](../20261027/ingest-worker-recreate.md)
- [[../../../PROGRESS|진행 상황]]
