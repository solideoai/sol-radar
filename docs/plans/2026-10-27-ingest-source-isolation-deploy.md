---
title: "10-27 외부 수집 서비스별 격리 운영 배포 실행서"
doc: "plan-20261027-ingest-source-isolation-deploy"
status: active
tags:
  - sol-radar
  - ops
  - ingestion
updated: 2026-10-27
---

# 10-27 외부 수집 서비스별 격리 운영 배포 실행서

> [!todo] 한눈에 (기준 2026-10-27, 브랜치 feat/ingest-source-isolation)
> 코드·시험·전체 `pnpm verify` 는 끝났다([증거](../evidence/ingestion/20261027-source-isolation/summary.md)). 아래 단계 2부터는 **사용자 승인 뒤에만** 한다. 이 문서는 실행 기록이 아니다.

## 1. 무엇이 바뀌고 무엇이 그대로인가

| 구분 | 내용 |
|---|---|
| 바뀜 | 외부 6종(K-water 2·LH 2·KEPCO·나라장터 조달요청)을 서비스마다 따로 판정한다. 키 없음·한도 미정·인증 실패는 그 서비스만 막는다. 상태를 Redis `ingest:source-readiness` 에 기록한다. 화면의 서비스별 [증분 수집]은 이 상태와 판정으로 막는다. 업종·근거법규는 "참조 데이터"로 분리한다 |
| 그대로 | `g2b-scheduled` 일정(cron `0 */3 * * *`, `Asia/Seoul`), 나라장터 창·예산(정기 900/1000, 수동 720/800), 수동 60분·공유 10분·하루 20회, registry.yaml, Compose 파일, env, DB 스키마(마이그레이션 없음) |
| 현재 registry 로 생기는 일 | 외부 6종이 모두 `enabled: false` 라 새 Worker 도 `NOT_CALLABLE(DISABLED)` 로 판정한다. 외부 일정은 생기지 않고 Job Scheduler 는 `g2b-scheduled` 하나 그대로다 |

## 2. 호환성

| 조합 | 결과 | 나라장터 |
|---|---|---|
| 옛 redis-api + 새 Worker | Worker 가 상태 키를 쓰지만 옛 redis-api 는 읽지 않는다. 외부 수동 요청은 옛 registry 판정(DISABLED)으로 503 | 영향 없음 |
| 새 redis-api + 옛 Worker | 상태 키가 없어 판정의 `services` 가 null 이다. 외부 수동 요청은 503 `WORKER_NOT_READY` | 영향 없음(나라장터 경로는 상태 키를 읽지 않는다) |
| 옛 Vercel + 새 redis-api | 옛 계약 스키마가 `services` 를 버린다. 서비스별 단추는 옛 화면에서 원래 막혀 있다 | 영향 없음 |
| 새 Vercel + 옛 redis-api | `services` 가 없어 외부 단추는 "수집 Worker 설정 대기"로 막힌다 | [지금 불러오기]·나라장터 단추 그대로 |

- **Redis 키 권한**: 새로 쓰는 키는 `ingest:source-readiness` 하나다(Worker `SET`, redis-api `GET`). redis-api 는 이미 `ingest:manual:*` 를 쓴다. 회사 Redis ACL 은 저장소에서 확인할 수 없다. 권한이 없으면 Worker 는 `외부 수집 상태 기록 실패: … NOPERM` 한 줄만 남기고 계속 돈다. redis-api 는 판정의 `services` 를 null 로 주고 외부 수동 요청을 503 으로 막는다. 둘 다 나라장터 수집과 [지금 불러오기]에는 영향이 없다. 다만 redis-api 로그에 판정 조회마다 redis 오류 줄이 남는다.
- **버전이 어긋날 때**: 상태 묶음(`services`)은 아는 서비스의 올바른 항목만 남기고, 모양이 아예 다르면 null 로 둔다. 어느 쪽이 새 서비스·새 상태를 먼저 알아도 판정 응답 전체나 다른 서비스는 거절되지 않는다.
- **g2b-scheduled 보존**: 새 Worker 는 기동 때 같은 id 로 upsert 해 1개를 유지하고, 외부 6종 id(`<key>-scheduled`)는 지운다(없으면 아무 일 없음).
- **registry.yaml**: 이번 변경에 없다. 회사 checkout 의 registry(Worker 마운트)와 redis-api 이미지 안 사본(`web/Dockerfile` 의 `COPY infra/sources/`)이 모두 지금 값 그대로다.
- **Compose**: `infra/compose.company.yaml`·`compose.ingest-only.company.yaml`·`compose.analysis-only.company.yaml` 모두 바뀌지 않았다. 분석 Worker 이미지 `sol-radar-ai-worker-worker:latest` 는 빌드하지 않는다.
- **나라장터 중단 가능성**: Worker 재생성 순간에 진행 중이거나 기다리던 회차가 있으면 그 회차가 끊기거나 지워질 수 있다(10-26 실행서 §9 와 같은 기존 동작). 단계 9 의 시간 창과 `--status` 0 확인으로 막는다. 다음 회차는 직전 성공 창 끝부터 받으므로 공고 빈틈은 생기지 않는다.

## 3. 단계별 실행

변수: `<F>` 는 기능 커밋 `162a09ab`, `<T3>` 는 push 뒤 `origin/main`(fast-forward 라 기능 브랜치 HEAD 와 같다). 회사 경로는 `/data/www/ai_workspace/sol-radar-deploy` 다. Compose 전체 재기동(`up` 서비스 생략·`restart`·`down`)은 쓰지 않는다. 키 값을 출력하는 명령(`config` 무옵션·`env`·`printenv`·`.env*` 열람)도 쓰지 않는다.

### 1) 기능 브랜치 커밋 — 완료

```bash
git -C /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/ingest-source-isolation log --oneline -2
```

- 기대: 맨 위가 이 실행서 커밋, 그 아래가 기능 커밋 `162a09ab`. 그 부모는 `26efefc1`.

### 2) main 병합 준비 — [승인]

```bash
M=/Users/leegwanghui/dev/hackathon/sol-radar
git -C $M fetch origin
git -C $M rev-parse --short main origin/main                         # 둘 다 26efefc1
git -C $M merge-base --is-ancestor main feat/ingest-source-isolation && echo FF-OK
git -C $M diff --name-only main feat/ingest-source-isolation          # 이번 변경 파일만
git -C $M merge --ff-only feat/ingest-source-isolation
```

- 기대: `FF-OK`, `Fast-forward`. 트리가 검증한 worktree 와 같으므로 전체 `pnpm verify` 를 다시 돌리지 않는다(ADR-046).
- 중단: `main` ≠ `origin/main`, `FF-OK` 가 안 나옴, 목록에 이번 변경이 아닌 파일이 있음.
- 되돌리기(push 전): `git -C $M reset --keep 26efefc1c0b908e0bf168f8a2270e3eab623c1b4`

### 3) GitHub push — [승인] = Vercel Production 배포 승인

```bash
git -C $M push origin main
```

- 기대: `26efefc1..<T3>  main -> main`.
- 중단: `rejected`(non-fast-forward). force push 하지 않는다.
- 되돌리기: 단계 4 의 Vercel 되돌리기. 코드까지 되돌릴 때는 `git -C $M revert --no-edit 26efefc1..<T3>` 뒤 push(별도 승인).

### 4) Vercel Production 배포 확인 — 읽기

```bash
gh api repos/gwanghui97/sol-radar/commits/<T3>/statuses --jq '.[0] | [.context, .state, .target_url] | @tsv'
curl -sS -o /dev/null -w '%{http_code}\n' https://www.solideos-radar.com/api/v1/admin/ingestion/manual-gate
```

- 기대: `Vercel	success	…`, `401`(미로그인). Vercel 대시보드 Production 이 `<T3>` 배포를 가리킨다.
- 이 시점(옛 redis-api)의 `/admin/ingestion`: [지금 불러오기]·나라장터 단추는 그대로, 외부 서비스는 연결/인증 칸에 "활성화 대기", 참조 데이터 절이 보인다.
- 중단: `failure`·`error`, 5xx, 관리자 화면 오류.
- 되돌리기: Vercel 대시보드 → Deployments → 직전 Production(`26efefc1`, `8YGJA3ULFEG4U2dVnahQNjNhkDEd`) → Instant Rollback. 이후 새 배포는 자동 연결되지 않으므로 다시 올릴 때 Undo 한다.

### 5) 회사 서버 Git 갱신 — [승인]

```bash
cd /data/www/ai_workspace/sol-radar-deploy
git -C . status --short                                  # 비어 있어야 한다
CUR=$(git -C . branch --show-current); echo "$CUR"       # 현재 배포 브랜치(기록)
git -C . rev-parse --short=12 HEAD                       # 현재 커밋(기록)
git -C . fetch origin main
git -C . log --oneline origin/main..HEAD                 # 회사 전용 carry 커밋(보존 대상)
B=$(git -C . merge-base HEAD origin/main)
git -C . diff --name-only "$B" HEAD                      # carry 가 바꾼 경로
git -C . diff --name-only "$B" origin/main               # main 이 바꾼 경로
git -C . switch -c deploy/main-20261027 origin/main
git -C . cherry-pick $(git -C . rev-list --reverse "origin/main..$CUR")
git -C . diff --stat "$CUR" HEAD -- infra/sources infra/compose.company.yaml infra/compose.ingest-only.company.yaml infra/compose.analysis-only.company.yaml web/worker/analysis-only-main.ts
```

- 기대: 두 경로 목록에 겹침 없음, cherry-pick 성공, 마지막 `diff --stat` 출력 없음(registry·Compose·분석 Worker 원본 그대로).
- 중단: `status` 가 비어 있지 않음, 경로 겹침, cherry-pick 충돌, 마지막 diff 에 출력이 있음.
- 되돌리기: `git -C . cherry-pick --abort; git -C . switch "$CUR"`. 브랜치를 바꿔도 실행 중 컨테이너는 바뀌지 않는다. Worker 가 마운트한 `infra/sources` 는 두 브랜치에서 같다.

### 6) redis-api 이미지 빌드·해당 컨테이너만 재생성 — [승인]

```bash
C="docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml"
$C images redis-api                                       # REPOSITORY 이름 확인(예: sol-radar-gateway-redis-api)
RAPI_REPO=<위 REPOSITORY>
OLD_RAPI=$(docker inspect -f '{{.Image}}' "$($C ps -q redis-api)"); echo "$OLD_RAPI"
docker image tag "$OLD_RAPI" "$RAPI_REPO:rollback-20261027"
$C build redis-api
$C up -d --no-deps --wait --wait-timeout 180 redis-api
$C ps redis-api
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6380/health
$C logs --tail 30 redis-api
```

- 기대: `ps` 가 `healthy`, `/health` 는 토큰 없이 `401`, 로그에 기동 오류 없음. 재생성 30초 남짓 Vercel 의 관리자 상태·분석 중계는 503 이다. AI gateway·분석 Worker 는 건드리지 않는다(`--no-deps`).
- 중단: `--wait` 실패·`unhealthy`, `/health` 가 `000`·5xx, Vercel 관리자 화면에서 "상태를 확인할 수 없습니다".
- 되돌리기:

```bash
docker image tag "$RAPI_REPO:rollback-20261027" "$RAPI_REPO:latest"
$C up -d --no-deps --no-build --wait --wait-timeout 180 redis-api
git -C . switch "$CUR"
```

### 7) ingest Worker 새 이미지 빌드 — [승인](운영 영향 없음)

```bash
docker ps --filter label=com.docker.compose.project=sol-radar-ingest --format '{{.Names}} {{.Image}} {{.Status}}'
OLD_TAG=<위 Image 의 콜론 뒤 SHA>                          # 되돌리기용 기록
export INGEST_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
W="docker compose -f infra/compose.ingest-only.company.yaml"
$W config --quiet
$W build ingest-worker
docker image ls sol-radar-ingest-worker
```

- 기대: `sol-radar-ingest-worker:$INGEST_WORKER_TAG` 가 새로 생기고 `$OLD_TAG` 이미지도 남는다. 실행 중 컨테이너는 그대로(`Up … (healthy)`).
- 중단: 빌드 실패. 실행 중 Worker 가 `healthy` 가 아님(먼저 원인 보고).
- 되돌리기: 필요 없음(이미지만 생긴다).

### 8) `--check`·`--status` — 읽기(외부 호출 없음)

```bash
$W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --check
$W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

기대 `--check`:

```text
registry: /srv/sol-radar/infra/sources/registry.yaml
g2b 소스(목록·보조): g2b-bid-notice, g2b-bid-license-limit, g2b-bid-region, g2b-bid-eorder-attach
외부 소스 kwater-bid-notice: NOT_CALLABLE(DISABLED) · 정기 수집 제외
외부 소스 lh-bid-notice: NOT_CALLABLE(DISABLED) · 정기 수집 제외
외부 소스 kwater-procurement-plan: NOT_CALLABLE(DISABLED) · 정기 수집 제외
외부 소스 lh-pre-specification: NOT_CALLABLE(DISABLED) · 정기 수집 제외
외부 소스 g2b-procurement-request: NOT_CALLABLE(DISABLED) · 정기 수집 제외
외부 소스 kepco-ebid-contract: NOT_CALLABLE(DISABLED) · 정기 수집 제외
ingest-only worker 확인 통과: SOL_RUN_MODE=live, 정기 수집 매일 KST 00·03·06·09·12·15·18·21시 정각
```

기대 `--status`(기존 Worker 가 도는 중):

```text
ingest 큐 job 수: waiting=0 active=0 delayed=0 failed=… completed=… paused=0 prioritized=0
ingest 큐 Job Scheduler 1개
  id=g2b-scheduled every=- pattern="0 */3 * * *" tz=Asia/Seoul next=<다음 KST 정각의 UTC>
```

- 중단: `--check` exit 1, 외부 줄 중 하나라도 `READY` 이거나 `· 정기 수집`(= 추가 기관 활성화, 이번 승인 범위 밖), Job Scheduler 가 1개가 아님, `every=` 에 숫자, waiting·active·prioritized 가 0 이 아님(끝날 때까지 기다렸다 다시 본다).
- 되돌리기: 필요 없음(읽기).

### 9) 기존 Worker 만 재생성 — [승인]

시간 창: KST 정각 +15분 ~ 다음 정각 −30분(예: 09:15~11:30). 직전에 단계 8 의 `--status` 를 다시 보고 waiting·active·prioritized 0 을 확인한다.

```bash
$W up -d --no-deps ingest-worker
$W ps ingest-worker
$W logs --tail 60 ingest-worker
```

- 기대 로그: 외부 소스 6줄(단계 8 과 같음), `g2b-scheduled 일정: … 기동 즉시 수집하지 않고 다음 정각 <ISO> 부터 돈다`, `ingest 큐 Job Scheduler 1개`, `  id=g2b-scheduled every=- pattern="0 */3 * * *" tz=Asia/Seoul next=…`, `ingest-only worker started: SOL_RUN_MODE=live, …`. `외부 수집 상태 기록 실패` 줄이 있으면 Redis ACL 이 새 키를 막은 것이다. 나라장터는 영향이 없으니 진행하되 보고한다.
- 중단: 컨테이너 `Restarting`·`Exited`, started 줄 없음, Job Scheduler 가 1개가 아님.
- 되돌리기:

```bash
export INGEST_WORKER_TAG=$OLD_TAG
$W up -d --no-deps ingest-worker
$W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status   # Job Scheduler 1개
```

옛 Worker 도 같은 id 로 `g2b-scheduled` 를 upsert 한다. 현재 registry 로는 외부 일정이 생기지 않았으므로 `--unschedule` 은 쓰지 않는다. 남은 `ingest:source-readiness` 키는 옛 코드가 읽지 않고, 새 redis-api 에서도 외부 6종이 DISABLED 라 해가 없다(지우려면 별도 승인).

### 10) 스케줄러 1개·Healthcheck 확인 — 읽기

```bash
$W run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
docker inspect -f '{{.State.Health.Status}}' "$($W ps -q ingest-worker)"
$C ps redis-api
```

- 기대: `ingest 큐 Job Scheduler 1개`(g2b-scheduled 만), `healthy`, redis-api `healthy`.
- 중단·되돌리기: 단계 9 의 되돌리기.

### 11) 관리자 데이터 수집 화면 — 읽기(1440·1280)

`https://www.solideos-radar.com/admin/ingestion` 을 ADMIN 계정으로 연다. **단추는 누르지 않는다**(누르면 실제 API 를 부른다. 별도 승인).

- 상단: [지금 불러오기]와 `정기 수집: 매일 00·03·06·09·12·15·18·21시(KST) · 다음 HH:MM`.
- 개발자 도구 Network: `GET /api/v1/admin/ingestion/manual-gate` 200, 응답 본문의 `services` 에 외부 6종이 `NOT_CALLABLE`·`reason: "DISABLED"`.
- 서비스 표: 나라장터 입찰공고 [증분 수집]은 쿨다운이 아니면 활성. 나머지 8개는 비활성이고 연결/인증 칸에 "활성화 대기" 또는 "필드 매핑 미구현".
- 표 아래 "참조 데이터" 절에 "나라장터 업종 및 근거법규 15129467".
- 중단: "수동 불러오기 상태를 확인할 수 없습니다", 5xx, 나라장터 단추가 이유 없이 비활성. 되돌리기는 단계 6(redis-api) 또는 4(Vercel).

### 12) 나라장터 수집 정상 동작 — 읽기

다음 KST 정각 +10분 뒤:

```bash
$W logs --since 20m ingest-worker | grep -E 'ingest\.job\.timing|ingest\.window\.capped|SOURCE_|QUOTA_'
```

```sql
select started_at, trigger, status, completeness, job_key, quota_used, params->'timing' as timing
from ingest_runs where source = 'g2b' order by started_at desc limit 5;
```

- 기대: 그 정각의 `SCHEDULED` run 하나, `job_key = 'g2b:SCHEDULED:<정각>'`, `status` `SUCCEEDED`(또는 사유가 남은 `PARTIAL`), `quota_used` 가 평소 범위, `ingest.job.timing` 한 줄.
- 중단: 정각 +15분까지 run 없음, `FAILED`, `QUOTA_STORE_UNAVAILABLE`. 단계 9 의 되돌리기를 한다.

## 4. 전체 되돌리기 순서

Worker(단계 9) → redis-api(단계 6) → Vercel(단계 4) 순으로 되돌린다. 셋은 서로 독립이라 하나만 되돌려도 된다(§2 호환성). DB·registry·env 는 바꾸지 않았으므로 되돌릴 것이 없다.

## 관련 문서

- [[2026-10-26-live-ops-cutover|10-26 실운영 전환 실행서]]
- [[../../infra/company/README|회사 런타임 배포]]
- [[../PROGRESS|진행 상황]]
