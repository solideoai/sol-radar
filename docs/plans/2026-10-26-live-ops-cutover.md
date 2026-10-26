---
title: "10-26 실운영 전환: 3시간 정기 수집·수동 불러오기·DEMO 정리 실행서"
doc: "plan-20261026-live-ops-cutover"
status: active
tags:
  - sol-radar
  - hackathon
  - ops
  - ingestion
updated: 2026-10-26
---

# 10-26 실운영 전환 실행서

> [!todo] 한눈에 (기준 2026-10-26, 브랜치 feat/live-ops-schedule)
> 코드와 격리 시험은 끝났다. 운영 변경은 아래 단계마다 **사용자 승인 뒤에만** 한다. 이 문서는 실행 기록이 아니다.

## 1. 무엇이 바뀌나

| 영역 | 바뀌는 것 | 어디서 돈다 |
|---|---|---|
| 상단 바 | "실행 모드: mock"·"AI: local" 표시를 렌더링에서 뺐다. DEMO·수집 신선도·알림은 그대로 | Vercel |
| 정기 수집 | BullMQ Job Scheduler `g2b-scheduled` 를 `pattern "0 */3 * * *"`, `tz "Asia/Seoul"` 로 건다(매일 KST 00·03·06·09·12·15·18·21시). `every` 를 쓰지 않고, 기동 즉시 수집하지 않는다 | 회사 ingest 전용 Worker |
| 수동 수집 | 관리자 [지금 불러오기] → 회사 redis-api 가 큐에 넣고 ingest Worker 가 실제 API 를 부른다 | Vercel → 회사 redis-api → Worker |
| 수동 제한 | 사용자별 1시간(접수 시점부터), 전역 공유 실행 10분, 전역 하루 20회. Redis Lua 한 번으로 원자 처리 | 회사 redis-api |
| 호출 예산 | 같은 카운터 `quota:15129394:YYYYMMDD`(KST). 정기: 900부터 보조 조회 중단·1000 차단. 수동: 720부터 보조 조회 중단·800 차단(정기 몫 200 보호) | 회사 Worker |
| 분석 차단 | 최신 revision 본문이 비면 분석 버튼 비활성("공고 본문 미확보 · 분석 준비 중"), 서버도 409 `ANALYSIS_SOURCE_MISSING`. 첨부 텍스트는 분석 Worker 가 아직 읽지 않아(`EMPTY_ATTACHMENT_READER`) 판정에 넣지 않는다 | Vercel(중계 전) + 회사 redis-api |
| 신선도 | 마지막 성공이 210분(180+30)보다 오래되면 "수집 지연" | Vercel |
| DEMO 정리 | 운영 DB 의 fixture DEMO 공고 19건과 딸린 데이터 삭제 | 운영 DB(Supabase MCP 필요) |

마이그레이션은 없다. 새 표·열 없이 `ingest_runs.params.timing`(jsonb)과 Redis 키만 쓴다.

## 2. 새 설정

| 위치 | 이름 | 값 | 이유 |
|---|---|---|---|
| 회사 `infra/.env.redis-api.local` | `SOL_INGEST_MODE` | `live` | redis-api 는 `SOL_RUN_MODE`(웹과 같은 mock)로 수동 요청을 판정해 g2b 를 `RUN_MODE_MISMATCH` 로 거절한다. `SOL_RUN_MODE` 를 바꾸면 분석 Worker 보고와 모드가 어긋나 readiness 가 503 이 된다. 그래서 수동 수집 판정만 따로 둔다 |
| 회사 ingest-only Compose | `G2B_INGEST_INTERVAL_MINUTES` | 줄 삭제(남아 있어도 무시하고 "무시함" 한 줄만 남긴다) | 일정이 cron 고정이다 |
| Vercel | 없음 | — | 버튼 표시는 redis-api 의 `GET /api/v1/admin/ingestion/manual-gate` 가 주는 `ingestMode` 로 정한다 |

## 3. 호출 예산 추정과 보호

- 근거: 10-26 D4 1회 수집(24시간 창) = 목록 1회 + 보조 86건 × 3회 = 259회, 신규 90·변경 2.
- 정기 8회/일: 목록 8~24회 + 신규 공고당 보조 3회(하루 약 90건 → 약 270회) ≈ **하루 280~300회**.
- 수동: 창은 "직전 정기 창 끝 ~ 지금"이다. 정기 cursor 를 움직이지 않는다. 수동이 먼저 받은 공고는 다음 정기 회차에서 DUPLICATE 라 보조 조회를 다시 하지 않는다. 그래서 추가 비용은 회당 목록 1~2회다. 하루 20회 상한이면 최대 약 40회가 더 든다.
- 합계 추정 320~400회/일(재시도·변경 공고 여유 포함). 일 한도 1000 의 절반 아래다.
- 보호 장치:
  1. 수동은 800에서 멈춘다. 그래서 정기 목록 몫 200회는 수동이 쓸 수 없다.
  2. 정기 보조 조회는 900에서 멈춘다. 마지막 100회는 목록 수집만 쓴다. 판정은 공고 단위라, 899에서 시작한 공고는 보조 3회를 마저 써서 최대 902까지 간다(수동은 720 → 최대 722). 전체 한도(정기 1000·수동 800)는 호출마다 원자 예약이라 넘지 않는다.
  3. Redis 오류면 호출하지 않는다(fail-closed). 재시도도 HTTP 직전에 예약한다.
- 한도에 막힌 정기 회차도 run 행을 열고 `QUOTA_EXCEEDED` 를 남긴다. 다음 정각 일정은 지워지지 않는다. 창 상한을 24시간으로 올렸다. 그래서 자정 뒤 첫 회차가 실패 창부터 이어 받아 빈틈이 생기지 않는다.

## 4. 적용 순서

GitHub `main` push 는 Vercel Production 자동 배포다(최근 Production 배포 6건 모두 `githubCommitRef: main`). 그래서 **push 승인 = Vercel 배포 승인**이다. 새 Vercel 은 옛 redis-api 와도 동작한다. 수동 불러오기만 "상태를 확인할 수 없음"으로 기존 대화상자로 돌아가고, 분석 차단은 Vercel 에서 바로 걸린다. 반대로 새 redis-api 도 옛 Vercel 과 동작한다(새 오류 코드는 옛 화면에서 일반 오류로 보인다). 어느 쪽을 먼저 해도 깨지지 않는다.

| 단계 | 내용 | 승인 | 되돌리기 |
|---|---|---|---|
| A | 운영 DB DEMO 삭제(§5) | 필요 | `04-restore.sql` |
| B | `main` push → Vercel 자동 배포 확인(§6) | 필요 | Vercel Instant Rollback |
| C | 회사 checkout 갱신(회사 전용 커밋 carry) + redis-api 재빌드·재생성 + `SOL_INGEST_MODE=live`(§7) | 필요 | 이전 브랜치·이미지로 재생성 |
| D | 회사 ingest-only Worker 이미지 빌드, `--status`·`--check`(§8) | 빌드는 필요(운영 영향 없음) | 이미지 남김 |
| E | ingest-only Worker 기동 = 3시간 일정 활성화(§9) | 필요 | stop → `--unschedule` |
| F | 운영 브라우저·수집 이력 최종 확인(§10) | 읽기 | — |

## 5. A — 운영 DB DEMO 삭제

실행서와 SQL 은 [[../evidence/demo-cleanup/20261026/summary|DEMO 정리 증거]]의 `01-inventory.sql`~`04-restore.sql` 이다. **Supabase MCP 가 연결된 세션에서만 한다.** CLI·psql 로 운영에 붙지 않는다.

1. MCP 대상 프로젝트가 `brtysdocxemrqhdezzqg` 인지 확인한다.
2. `01-inventory.sql` 을 실행한다(읽기). 공고 19·score_runs 19 와 표별 행 수가 증거의 기대값과 같은지 본다. C41~C57 이 하나라도 0 이 아니면 멈춘다.
3. 승인 뒤 `02b-backup-in-db.sql` 로 운영 DB 안에 백업 표를 만든다(한 트랜잭션, 네 역할 권한 회수). 02 JSON(약 2.2MB, 가상 직원 명부 스냅샷 포함)은 MCP 응답으로 받지 않는다.
4. DB 밖 사본을 받는다. 사람이 로컬에서 `pg_dump --data-only --table=demo_cleanup_20261026.backup` 를 돌리고 다른 DB 에 넣어 26행·`sha_ok` 를 확인한다. 읽기 전용이지만 MCP 밖 연결이므로 따로 승인받는다.
5. `03-delete.sql` 을 `v_dry_run := true` 로 돌려 `DRY_RUN_ROLLBACK` 을 확인한 뒤, 승인받고 `false` 로 돌린다(한 트랜잭션, 개수가 어긋나면 전체 중단). 수집 정각 사이, worker 가 한가할 때 돌린다.
6. `01-inventory.sql` 을 다시 실행해 대상 0·보존 수 그대로인지 확인한다.

되돌리기: notify worker 를 멈추거나 카카오가 mock 인지 확인한 뒤 `04-restore.sql` 을 `v_source := 'schema'` 로 돌린다(dry-run 먼저). PITR 이 꺼져 있으므로 3의 DB 안 표와 4의 파일이 복구 수단이다. 자세한 순서는 DEMO 정리 실행서의 "실행 순서"다.

## 6. B — push 와 Vercel 배포

```bash
git -C /Users/leegwanghui/dev/hackathon/sol-radar push origin main
```

- push 하면 로컬 main 에만 있던 문서 커밋(aa181cee·52fcc271)도 함께 올라간다.
- 확인: `vercel ls sol-radar --environment production` 에서 새 배포가 Ready 이고 `www.solideos-radar.com` 이 그 배포를 가리키는지 본다.
- 되돌리기: 직전 Production 배포(`sol-radar-gviot56r4`, 00b51d56)로 Instant Rollback 한다. 이후 새 배포는 자동 연결되지 않는다(undo 필요).

## 7. C — 회사 checkout 갱신과 redis-api

회사 checkout 은 `deploy/main-20261026`(00b51d56 + 회사 전용 커밋 carry, Dependency Reporter 포함)이다. 새 목표 커밋을 `<T2>` 라 한다.

```bash
cd /data/www/ai_workspace/sol-radar-deploy
git -C . status --short                         # 비어 있어야 한다
git -C . branch --show-current                  # deploy/main-20261026
git -C . log --oneline 00b51d56..HEAD           # 회사 전용 커밋(보존 대상)
git -C . fetch origin main
git -C . merge-base --is-ancestor 00b51d56 <T2> && echo OK
# 겹침 확인: 두 목록에 같은 경로가 있으면 멈추고 보고한다
git -C . diff --name-only 00b51d56 HEAD
git -C . diff --name-only 00b51d56 <T2>
git -C . switch -c deploy/main-20261026b <T2>
git -C . cherry-pick 00b51d56..deploy/main-20261026
```

- cherry-pick 이 충돌하면 `git -C . cherry-pick --abort && git -C . switch deploy/main-20261026` 로 돌아가고 멈춘다.
- `infra/.env.redis-api.local` 에 `SOL_INGEST_MODE=live` 한 줄을 넣는다(편집기로, 값 출력 금지).
- redis-api 만 다시 빌드하고 재생성한다. AI gateway·분석 Worker 는 건드리지 않는다(`--no-deps`).

```bash
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml build redis-api
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml up -d --no-deps --wait --wait-timeout 180 redis-api
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml ps redis-api
```

- 재생성하는 30초 남짓 동안 Vercel 의 분석 요청·관리자 상태 중계는 503 이다.
- 되돌리기: `git -C . switch deploy/main-20261026` 뒤 같은 build·up 을 하고, `SOL_INGEST_MODE` 줄을 지운다.

## 8. D — ingest-only Worker 이미지와 점검

```bash
export INGEST_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
docker compose -f infra/compose.ingest-only.company.yaml config --quiet
docker compose -f infra/compose.ingest-only.company.yaml build ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --check
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

- `--check` 는 "정기 수집 매일 KST 00·03·06·09·12·15·18·21시 정각"을 출력해야 한다.
- `--status` 에서 Job Scheduler 0개, waiting·active·delayed 0 이어야 한다. **0 이 아니면 멈춘다.** 수동 요청 job 이 이미 쌓여 있으면 기동하는 순간 실제 API 를 부른다.

## 9. E — 3시간 정기 일정 활성화

```bash
docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml logs --tail 50 ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

- 기동 즉시 수집하지 않는다. 로그에 "다음 정각 … 부터 돈다"가 찍힌다.
- `--status` 에 `g2b-scheduled pattern=0 */3 * * * tz=Asia/Seoul` 과 다음 실행(KST 정각)이 보여야 한다.
- 첫 정기 회차의 창은 D4 `--once` 창 끝(10-26 13:53)부터 이어진다(24시간 상한 안).
- 되돌리기: 회사 실행서(`infra/company/README.md`) §7.10 의 순서(stop → `--unschedule` → `--status` 0개)를 따른다.
- 회사 `infra/compose.company.yaml` 의 전체 `worker` 서비스(`worker/main.ts`)는 `SOL_RUN_MODE` 가 live 가 아니면 기동할 때 `g2b-scheduled` 를 지운다(이번 변경 전부터 있던 동작). 분석은 기존 분석 전용 Worker 가 맡으므로 이 서비스를 띄우지 않는다. §7 의 `up --no-deps redis-api` 는 redis-api 만 다시 만든다.
- 이후 ingest Worker 를 다시 띄울 때는 정각 직후(수동 job 뒤에서 정기 회차가 기다리는 동안)를 피한다. 기동 때 같은 id 로 일정을 다시 거는 upsert 가 기다리던 그 회차를 지운다. 다음 회차가 직전 성공 창 끝부터 받아 공고 빈틈은 없지만, 그 정각의 run 기록은 남지 않는다. `--status` 에서 waiting·active 0 을 보고 재기동한다.

## 10. F — 최종 확인

- `/admin/ingestion`: [지금 불러오기], "정기 수집: 매일 00·03·…·21시(KST) · 다음 HH:MM".
- 한 번 눌러 접수 → run 완료 → 신규·변경·호출량·마지막 수집 갱신 → "다음 불러오기 가능: HH:MM" 을 확인한다. 실제 API 를 1회 부르므로 승인 범위에 넣는다.
- 첫 정기 정각 뒤:

```sql
select started_at, trigger, status, job_key, params->'timing' as timing, quota_used
from ingest_runs where source = 'g2b' order by started_at desc limit 5;
```

- 실공고 상세의 분석 버튼은 비활성이고, 상단 바에 실행 모드·AI 표시가 없어야 한다.

## 관련 문서

- [[2026-10-25-live-ingest-hourly-plan|10-25 1시간 주기 수집 계획]]
- [[../../infra/company/README|회사 런타임 배포]]
- [[../PROGRESS|진행 상황]]
