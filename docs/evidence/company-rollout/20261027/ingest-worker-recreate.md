---
title: "회사 ingest Worker 재생성 기록"
status: active
tags: [sol-radar, ops, ingestion]
updated: 2026-10-27
---

# 회사 ingest Worker 재생성 기록 (2026-10-27)

10-27 회사 반영 실행서(git `3ae02acf` 의 `docs/plans/2026-10-27-company-rollout-attachments.md`) §5 를 했다. 사용자가 회사 터미널에서 단계마다 실행했고, 메인 세션이 출력을 보고 다음 단계를 정했다. 회사 서버에 직접 접속하지 않았다.

사용자 조건:
- 회사 운영 저장소 `sol-radar-app` 에서 한다.
- `infra/compose.company.yaml` 의 로컬 수정을 보존한다.
- 기존 이미지를 롤백용으로 남긴다.
- 일회용 컨테이너로 `--check` 를 통과한 뒤 재생성한다.
- `g2b-scheduled` 는 1개로 유지한다.
- LH 는 `enabled=false` 로 두고, 다른 외부 서비스도 켜지 않는다.
- `--unschedule` 은 쓰지 않는다.
- redis-api·AI gateway·분석 Worker 는 다시 만들지 않는다.
- Documents Worker 와 LH A단계는 보류한다.

## 결과

| 단계 | 시각(KST) | 결과 |
|---|---|---|
| 1 읽기 확인 | 18:05 이전 | 회사 HEAD `aa0c9f9`, GitHub main `24f2ac8`(문서 커밋 2개 앞섬). `web`·`infra/sources`·ingest·company compose 차이 0. 로컬 수정은 ` M infra/compose.company.yaml` 하나. 실행 중 ingest Worker 는 `sol-radar-ingest-worker:43e4e02465c2`(`c8c8562a8a8b`), working_dir `/data/www/ai_workspace/sol-radar-app/infra`, healthy. full worker(`worker/main.ts`) 없음 |
| 18시 정기 수집 | 18:00:01~18:07:34 | `SUCCEEDED`·`COMPLETE`, 273건(신규 253·변경 11·취소 7·격리 0), 호출 3회. 이 회차가 끝난 뒤에 재생성했다 |
| 2 코드 맞추기 | 18:05:44(백업 폴더 이름) | `compose.company.yaml` 사본과 diff 를 `/data/www/ai_workspace/sol-radar-company-originals/20261027-180544-app` 에 백업. `git merge --ff-only origin/main` → `24f2ac8`. 로컬 수정이 그대로 남았다(`cmp` 같음) |
| 3 롤백 이미지 | 18:05~18:09 | `sol-radar-ingest-worker:rollback-20261027` 태그 = `c8c8562a8a8b`(`43e4e02465c2` 와 같은 이미지) |
| 4 빌드 | 18:05~18:09 | `INGEST_WORKER_TAG=24f2ac84963c`, `config --quiet` 통과, 새 이미지 `2d2009a7218f`. 실행 중 컨테이너는 바뀌지 않았다 |
| 5 일회용 확인 | 18:05~18:09 | `--check` 통과. 외부 6종(`kwater-bid-notice`·`lh-bid-notice`·`kwater-procurement-plan`·`lh-pre-specification`·`g2b-procurement-request`·`kepco-ebid-contract`) 모두 `NOT_CALLABLE(DISABLED)`. `--status`: Job Scheduler 1개 `g2b-scheduled`(`every=-`, `pattern="0 */3 * * *"`, `tz=Asia/Seoul`, next 21:00), `waiting=0 active=0 delayed=1 failed=0` |
| 6 재생성 | 18:09:44(컨테이너 StartedAt) | `docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps --no-build ingest-worker` |
| 7 기동 확인 | 18:09 이후 | 이미지 `24f2ac84963c`(`sha256:2d2009a7218f…`), working_dir 그대로, `healthy`, `restarts=0`. 로그에 외부 6종 `NOT_CALLABLE(DISABLED)`·`ingest 큐 Job Scheduler 1개`·`id=g2b-scheduled every=- … next=2026-10-27T12:00:00.000Z`. 기동 즉시 수집 없음. `--status` 는 재생성 전과 같다(Scheduler 1개, `active=0`, `delayed=1`). redis-api·AI gateway·분석 Worker·dependency-reporter 는 이미지와 Up 시간이 그대로였다 |
| 8 21시 정기 수집 | 21:00:01~21:02:27 | `SUCCEEDED`·`COMPLETE`, 83건(신규 76·변경 4·취소 3·격리 0), 호출 1회. 수집 창 18:00~21:00 으로 직전 회차 끝에서 이어졌고 `windowCap` 없음. `timing.enqueuedAt` 18:09:46 KST(새 Worker 의 일정이 넣은 job), `queueDelayMs` 14. 외부 서비스 run 0건 |

18시·21시 회차 값은 운영 DB `ingest_runs` 조회 결과다(`job_key` `g2b:SCHEDULED:2026-10-27T09:00:00.000Z`·`…T12:00:00.000Z`).

## 실행서와 다른 점

- 실행서 §5 는 `sol-radar-deploy` checkout 을 전제로 한다. 실제 ingest Worker 는 `sol-radar-app/infra` 에서 기동돼 있어, 사용자 지시대로 같은 checkout 에서 했다. env 파일·registry 바인드 경로가 바뀌지 않는다.
- 새 코드(`43e4e024` → `24f2ac8`)에서 ingest 전용 Worker 가 쓰는 compose·registry·진입점·Dockerfile 은 바뀌지 않았다(`infra/sources/program-notices.yaml` 한 줄만 다르고 이 Worker 는 읽지 않는다). 바뀐 코드는 첨부 처리·알림 쪽이고, 이 Worker 는 documents job 을 넣지 않는다(`documents: false`).

## 되돌리기

필요하면 아래 명령으로 되돌린다. 일정은 같은 id 로 다시 걸리므로 `--unschedule` 은 쓰지 않는다.

```bash
cd /data/www/ai_workspace/sol-radar-app
export INGEST_WORKER_TAG=43e4e02465c2
docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps --no-build ingest-worker
```

## 남은 것

- Documents Worker(실행서 §8): 사용자 보류. 운영 첨부 3,152건이 모두 `PENDING`(18:00 기준)이다. 초기 처리량·동시성·Storage 비용을 확인하기 전에는 기동하지 않는다.
- LH A단계: 기존 회사 배포 검증 뒤로 보류.
