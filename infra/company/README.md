# 회사 런타임 배포

Vercel은 web 하나, 회사는 기존 Redis와 신규 redis-api·AI gateway·Worker를 실행한다. 모델 학습/반입 전 현재 실행 모드는 `mock`이다. 이 문서는 준비된 코드의 실행서이며 회사 기동 성공 기록이 아니다.

## 1. 회사 내부 현황 확인

실제 회사 터미널에서 검증된 commit의 checkout을 사용한다. 기존 Redis 이름을 확인해 다음 명령에 전달한다.

```bash
bash scripts/ops/company-inventory.sh sol-radar-redis
```

확인할 항목은 기존 Redis의 사용자 정의 network, 사설 TCP 인증, loopback6380의 빈 포트, 같은 Compose 프로젝트의 기존 app 컨테이너 유무다. Redis가 기본 `bridge`에만 있거나6380을 다른 프로세스가 쓰면 여기서 멈추고 연결 배치를 확인한다. 추정한 network·IP·비밀번호를 사용하지 않는다. 기존 Redis·Nginx·모델 프로세스를 재시작하거나 network를 임의 변경하지 않는다.

## 2. 서비스별 환경 파일

```bash
umask 077
cp -n infra/env/company.env.example infra/.env.company.local
cp -n infra/env/redis-api.env.example infra/.env.redis-api.local
cp -n infra/env/company-worker.env.example infra/.env.worker.local
cp -n infra/env/company-ai.env.example infra/.env.ai-gateway.local
chmod 600 infra/.env.company.local infra/.env.redis-api.local infra/.env.worker.local infra/.env.ai-gateway.local
```

각 파일의 placeholder를 현장의 실제 값으로 채운다. 기존 파일은 덮어쓰지 않는다.

| 파일 | 입력 |
| --- | --- |
| `.env.company.local` | 기존 Redis network 이름, 웹과 동일한 `SOL_RUN_MODE=mock` |
| `.env.redis-api.local` | Supabase URL/anon, 웹과 같은 cursor secret·서비스 token, 기존 Redis TCP URL, private 버킷 이름 |
| `.env.worker.local` | 같은 Supabase URL·Redis TCP URL·버킷 이름, Worker 전용 service role, 필요 시 수집 키 |
| `.env.ai-gateway.local` | 현재 `AI_PROVIDER=mock` 및 mock 설정. 실제 모델 자격은 검증한 fixture/live 전환 때만 추가 |

Redis URL은 API와 Worker가 동일해야 한다. Supabase/버킷/실행 모드도 동일해야 Worker 보고를 공유한다. `SOL_RUN_MODE`와 내부 `AI_GATEWAY_URL=http://ai-gateway:8000`은 Compose가 일관되게 주입한다. 서비스 token은 기존 Vercel `REDIS_API_TOKEN`과 같아야 하며 별도 임의 생성/교체하지 않는다. API와 AI gateway에는 Storage service role·수집 키를 주지 않는다.

## 3. 설정 확인·빌드

```bash
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml config --quiet
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml build redis-api ai-gateway worker
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml run --rm --no-deps worker node --conditions=react-server --import tsx worker/main.ts --check
```

`--check`는 모듈 import 확인만 하며 Redis/DB readiness나 작업 처리를 검증하지 않는다. 전체 `config` 출력에는 비밀값이 들어갈 수 있으므로 `--quiet`를 사용한다.

## 4. 신규 앱만 기동

기존 app 컨테이너가 없고, 현재 모드·대기 job·접속 대상·기동 영향을 확인한 경우 실행한다. Worker는 큐 소비·오래된 작업 복구·outbox 처리·Storage probe 쓰기/삭제를 시작한다. AI gateway의 health를 통과한 뒤 Worker가 시작된다.

```bash
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml up -d --no-recreate --wait --wait-timeout 180 redis-api ai-gateway worker
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml ps
```

회사 Compose에는 Redis/Qdrant/Nginx/DB/모델 서버가 없다. HTTP 게시 포트는 기존 Nginx upstream인 `127.0.0.1:6380` 하나뿐이다. AI gateway와 Worker는 호스트 포트를 공개하지 않는다. `--no-recreate`는 기존 컨테이너를 교체하지 않으므로 다른 버전이 이미 있으면 이 명령으로 업그레이드했다고 판단하지 않는다. `down`·`--remove-orphans`·volume 삭제를 하지 않는다.

## 5. 준비 상태 확인 후 웹 전환

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://acropolissg.com/redis/health
```

미인증401이 기대값이다. 서비스 token을 안전하게 로드한 검사에서는 유효한 readiness를 확인한다. Worker 보고는30초 주기, TTL120초이며 보고가 없거나 Supabase/모드/버킷이 다르면503이다. 회사 연결 확인 뒤 같은 소스의 Vercel web-only를 배포하고 관리자 상태 GET·접수202→DB 조회→Worker 완료를 검사한다. Vercel의 기존 모델 자격 제거는 회사 자격 보존을 확인한 뒤 수행한다.

파인튜닝 Bosun 패키지와 실제 served identity는 아직 미확인이다. Qwen/Bosun 실추론이나 전체 첨부 파싱 완료를 mock health로 대신 주장하지 않는다. 기존 Qwen 프로세스·Nginx·Redis·MinIO는 보존한다.

## 6. F08 호출 예산 방식 전환 시 Worker 교체 순서

이 절은 별도 승인 후 실행할 운영 절차다. F08 개발·격리 검증 중에는 회사 Redis6379·loopback6380·Nginx `/redis/`·redis-api·운영 Worker에 접속하지 않는다(ADR-045).

**옛 Worker(호출 뒤 합산)와 새 Worker(HTTP 직전 예약)를 혼합 운용하면 예산 초과 방지를 보장할 수 없다.** 위 `--no-recreate` 최초 기동 명령으로 기존 Worker가 교체되었다고 판단하지 않는다.

1. 격리 Redis 검증을 통과한 코드와 이미지, 기존 큐/예약 작업, 진행 중 수집 run을 확인한다. 회사 Redis ACL은 운영자가 별도로 확인한다.
2. **옛 Worker 먼저 정지:** 모든 인스턴스의 ingest consumer에 새 작업을 받지 않게 하고 진행 중 HTTP·재시도·사후 합산을 마무리한 뒤 정상 종료한다. 기존 Worker 프로세스가 모두 종료됐는지 확인한다. 종료가 불확실하면 새 Worker를 시작하지 않는다.
3. **새 Worker 기동:** 같은 검증 버전의 Worker만 시작한다. 기존 `quota:{serviceId}:{YYYYMMDD}` 키와 TTL·큐·cursor는 보존한다. 예산 초기화·flush·삭제 또는 DB migration은 필요하지 않다.
4. 운영자가 승인된 최소 점검으로 오류 코드와 호출 수를 확인한다. ACL/연결 실패 시 수집 run은 `QUOTA_STORE_UNAVAILABLE`로 실패하고 외부 HTTP를 보내지 않아야 한다. quota 장애는 수집을 차단하며 Worker의 분석 등 다른 기능까지 종료시키는 정책은 아니다.
5. 롤백도 새 Worker를 먼저 모두 정지한 뒤 진행한다. 예산 초과 방지가 사라지는 옛 버전을 live 수집으로 곧바로 복구하지 말고 운영자가 재개 여부를 판단한다.

F08 quota 연결에 필요한 명령은 `GET`, `EVAL`, Lua 내부의 `INCR`, `EXPIRE`, `SET`이며 키 범위는 `~quota:*`다. 현재 구현은 `EVALSHA`를 호출하지 않아 필수 권한은 아니다. 향후 SHA 기반 호출로 바꾸면 `EVALSHA`도 별도 허용해야 한다. 기존 진단용 `QuotaStore.add()`를 사용하면 `INCRBY`가 추가로 필요하다. IORedis 연결 초기화의 `INFO`·`CLIENT SETINFO` 및 인증(`AUTH`/`HELLO`), 선택 DB를 쓰면 `SELECT`도 실제 클라이언트/Redis 버전에 맞춰 확인한다. `PING`은 연결 점검용이다. 이 목록은 **quota 연결의 최소 권한**이며 BullMQ 큐가 사용하는 명령·키 권한을 대체하지 않는다. EVAL이 막힌 동일 계정을 쓰는 live 수집은 전부 예약 단계에서 차단되므로 배포 전에 확인한다.

격리 검증 명령·출력·장애 재현은 [F08 Redis 검증 증거](../../docs/evidence/ingestion/20261022-f08-isolated-redis.md)를 따른다. 이 문서는 회사 ACL 변경이나 서비스 재시작을 수행했다는 기록이 아니다.

## 7. Ingest 전용 Worker

이 절은 별도 운영 승인 후 실행할 절차다. 회사 기동 성공 기록이 아니다. 근거 계획은 `docs/plans/2026-10-25-live-ingest-hourly-plan.md` §4 B1·§6이다. **[승인]** 표시 단계는 사용자 승인 뒤에만 실행한다.

목적: 기존 런타임(redis-api·AI gateway·Analysis Worker)을 그대로 둔 채, 나라장터 입찰공고 목록(`g2b-bid-notice`)과 보조 조회 3종만 실제로 수집하는 Worker를 따로 둔다. 먼저 `--once`로 창을 정해 1회만 수집해 결과를 보고, 그다음 승인을 받아 정기 일정(매일 KST 00·03·06·09·12·15·18·21시 정각, `Asia/Seoul` cron `0 */3 * * *`)을 켠다. 기존 스케줄러를 확인 없이 실행하지 않는다. Compose 파일은 `infra/compose.ingest-only.company.yaml`(프로젝트 `sol-radar-ingest`, 서비스 `ingest-worker` 하나), 진입점은 `web/worker/ingest-only-main.ts`다.

- 등록은 ingest 하나다. 의존성 보고·분석·알림·마감·부처 공고·Storage 정리는 돌리지 않는다. 의존성 보고는 scope에 실행 모드가 들어가, live 보고가 다른 모드의 보고를 덮으면 redis-api readiness가 503이 된다.
- Compose 파일의 `environment`(`SOL_RUN_MODE: live`, `SOURCES_REGISTRY_FILE`, `FIXTURES_DIR`, `AI_GATEWAY_URL`)는 `infra/.env.worker.local`의 같은 이름보다 우선한다. 일정은 코드에 고정이라 env로 바꾸지 않는다. `infra/.env.worker.local`에 옛 `G2B_INGEST_INTERVAL_MINUTES`가 남아 있으면 값과 형식에 상관없이 무시하고 `G2B_INGEST_INTERVAL_MINUTES 무시함: …` 한 줄만 남긴다(값은 찍지 않는다). live가 아니면 진입점이 Redis 연결 전에 exit 1로 멈춘다(mock·fixture로 뜨면 `g2b-scheduled` 일정을 지우기 때문이다).
- `infra/.env.worker.local`은 §2의 Worker 파일을 같이 쓴다. 수집 키 `G2B_BID_NOTICE_SERVICE_KEY`가 있어야 한다. 키 값을 터미널·로그에 출력하지 않는다. network는 Compose 파일에 `redis_default`(external)로 고정돼 있어 `--env-file`을 주지 않는다.
- 이미지는 `sol-radar-ingest-worker:<git SHA>`다. 회사 Analysis Worker가 쓰는 `sol-radar-ai-worker-worker:latest`를 빌드하거나 덮지 않는다(덮으면 Analysis Worker가 다음 기동 때 이 코드로 바뀐다). Compose의 모든 명령에 `INGEST_WORKER_TAG`가 필요하다. 없으면 `config`부터 실패한다.
- 호출 예산은 전체 Worker와 같은 카운터(`quota:15129394:YYYYMMDD`, 일 1000회, 900회부터 보조 조회 중단)를 쓴다. `--once`도 같은 예약을 거친다. 수동 수집(MANUAL) job은 같은 키를 세되 한도가 `1000 − 200 = 800`이다(`MANUAL_RESERVED_CALLS`, `web/worker/quota-store.ts`). 수동은 720회부터 보조 조회를 멈추고 800회에서 호출을 멈춰, 정기 수집 몫 200회가 남는다.
- 정기 회차의 수집 창은 `max(직전 SCHEDULED 성공 창 끝, 지금 − 24시간)`부터 지금까지다(최대 1440분). 직전 정기 회차가 실패했고 그 창이 24시간 안에 시작했으면 그 창과 cursor를 그대로 이어 쓴다(예산 소진 뒤 자정 회차가 빈틈 없이 잇는다). 잘라 낸 구간이 있으면 키 없는 `ingest.window.capped` 로그를 남기고 `ingest_runs.params.windowCap`에 기록한다. 잘린 구간을 자동으로 메우지 않는다. 필요하면 승인 뒤 `--once --window-minutes <N>`(1~1440)으로 받는다.
- 외부 서비스(K-water·LH·KEPCO·나라장터 조달요청)는 서비스마다 따로 판정한다(10-26 0순위). 키가 없거나 한도가 미정인 서비스만 빠지고 Worker는 계속 뜬다. `READY`인 서비스만 `<key>-scheduled` 일정을 같은 cron으로 걸고, 그 회차는 우선순위 10이라 같은 정각의 `g2b-scheduled`(우선순위 없음)가 먼저 돈다. 운영 중 인증 오류(resultCode 30·31)를 받으면 그 서비스만 `AUTH_FAILED`가 되고 다음 회차부터 API를 부르지 않는다(키를 고친 뒤 Worker 재시작으로 풀린다). 기동 때와 상태가 바뀔 때 Redis `ingest:source-readiness`(JSON, 키 값 없음)에 서비스별 상태를 남기고, redis-api는 이 값으로 화면의 서비스별 [증분 수집]을 막는다. 이 기록이 실패해도 수집은 계속하고 `외부 수집 상태 기록 실패: …` 한 줄만 남긴다.
- 외부 서비스의 정기 창은 최대 24시간이다(`EXTERNAL_WINDOW_CAP_MS`). 직전 창이 실패·실행 중·불완전 PARTIAL이고 24시간 안에 시작했으면 그 창을 다시 쓴다. 아니면 직전 창 끝(재시도가 필요했으면 시작)부터 이어 가되 지금 − 24시간보다 앞이면 자르고 `ingest.window.capped`·`params.windowCap`을 남긴다. KEPCO 전자입찰 계약은 응답 범위를 검증하지 못해 PARTIAL로 남지만 다음 90일 조각으로 cursor를 넘겨 같은 조각을 끝없이 되풀이하지 않는다.
- 첨부: 이 Worker는 documents job을 넣지 않고 첨부 재확인(reconciler)도 돌리지 않는다. 새 공고의 `bid_documents` 행은 `download_status = 'PENDING'`으로 남는다. 첨부 처리는 §8 Documents 전용 Worker가 맡는다. 그 복구 회차가 처리 범위 안의 PENDING 행을 다시 찾아 documents job을 넣는다.
- 분석도 하지 않는다. live 공고는 자동 분석되지 않는다.
- live는 fixture를 읽지 않는다. 회사 `fixtures/`는 UID 1001·600/700이라 Worker(UID 1000)가 읽지 못해도 된다. 권한을 바꾸지 않는다(`chmod` 금지).

### 7.1 D0 읽기 확인 (운영 영향 없음)

```bash
cd /data/www/ai_workspace/sol-radar-deploy
docker ps --no-trunc --format '{{.Names}}\t{{.Image}}\t{{.Command}}\t{{.Status}}'
git -C . log --oneline -1
git -C . status --short
```

**전체 Worker(`worker/main.ts`)가 같은 Redis에서 돌고 있으면 여기서 멈춘다.** 같은 `ingest` 큐를 두 소비자가 나눠 받아, live가 아닌 전체 Worker가 일정 job을 `RUN_MODE_MISMATCH`로 실패시킨다.

Supabase SQL로 직전 g2b 수집을 확인한다. 일정 첫 회차의 창이 직전 `SCHEDULED` 성공 run에서 이어진다(최대 24시간으로 잘린다).

```sql
select started_at, trigger, status, completeness, job_key, service_key,
       params->'window' as run_window, params->'windowCap' as window_cap,
       params->'timing' as timing, quota_used
from ingest_runs where source = 'g2b' order by started_at desc limit 5;
```

### 7.2 회사 전용 파일 보존 후 코드 반영 — **[승인]**

회사 checkout에는 저장소에 없던 `web/worker/analysis-only-main.ts`·`infra/compose.analysis-only.company.yaml`이 untracked로 있다. 이 SHA부터 같은 경로의 파일이 저장소에 들어 있어, 그대로 checkout하면 git이 거부한다. 원본을 먼저 백업한다. 실행 중인 Analysis Worker는 이미 빌드된 이미지로 돌기 때문에 영향받지 않는다.

```bash
BK="/data/www/ai_workspace/sol-radar-company-originals/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK/web/worker" "$BK/infra"
cp -p web/worker/analysis-only-main.ts "$BK/web/worker/"
cp -p infra/compose.analysis-only.company.yaml "$BK/infra/"
cmp web/worker/analysis-only-main.ts "$BK/web/worker/analysis-only-main.ts"
cmp infra/compose.analysis-only.company.yaml "$BK/infra/compose.analysis-only.company.yaml"
rm web/worker/analysis-only-main.ts infra/compose.analysis-only.company.yaml
git -C . fetch origin
git -C . checkout <SHA>
```

저장소 판과 원본을 비교한다. 저장소 판은 머리 주석 한 줄과 Prettier 줄바꿈(import 줄, `process.once` 중괄호, 끝 쉼표)만 다르다. 아래 비교가 두 줄 모두 `SAME`이어야 한다.

```bash
for f in web/worker/analysis-only-main.ts infra/compose.analysis-only.company.yaml; do
  a=$(tr -d ' \t\n,' < "$BK/$f" | sha256sum)
  b=$(grep -v '회사 운영 원본, 2026-10-25' "$f" | tr -d ' \t\n,' | sha256sum)
  [ "$a" = "$b" ] && echo "SAME $f" || echo "DIFF $f"
done
diff -u "$BK/web/worker/analysis-only-main.ts" web/worker/analysis-only-main.ts
```

`DIFF`가 나오면 회사 원본이 바뀐 것이다. 원본을 되돌려 놓고(`cp -p "$BK/<경로>" <경로>`) 진행을 멈춘 뒤 보고한다. 저장소 판으로 Analysis Worker를 다시 빌드하지 않는다.

### 7.3 D1 이미지 빌드 (외부 호출 없음)

```bash
export INGEST_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
docker compose -f infra/compose.ingest-only.company.yaml config --quiet
docker compose -f infra/compose.ingest-only.company.yaml build ingest-worker
docker image ls sol-radar-ingest-worker
```

새 이미지 `sol-radar-ingest-worker:$INGEST_WORKER_TAG`만 생긴다. 실행 중 컨테이너는 바뀌지 않는다.

### 7.4 D2 큐 상태 읽기 `--status` (읽기 전용)

```bash
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

Redis 읽기 명령(`LLEN`·`ZCARD`·`ZRANGE`·`HMGET`)만 보낸다. BullMQ Queue를 만들지 않아 큐 메타데이터도 쓰지 않는다. 출력은 다음 모양이다.

```text
ingest 큐 job 수: waiting=0 active=0 delayed=0 failed=0 completed=0 paused=0 prioritized=0
ingest 큐 Job Scheduler 0개
```

**Job Scheduler가 1개 이상이거나 waiting·active·delayed가 0이 아니면 멈추고 보고한다.** 누군가 이미 일정을 만들었거나 처리 대기 job이 있다는 뜻이다.

### 7.5 D3 설정 확인 `--check` (외부 호출 없음)

```bash
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --check
```

실행 모드(live)·Worker env 이름·registry·수집 키 env 이름과 정기 일정만 확인한다. Redis·Supabase·외부 API에는 접속하지 않는다. 통과하면 다음을 출력한다.

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

`외부 소스 …` 줄은 외부 서비스마다 기동 때 정한 상태다(env 이름·키 값은 찍지 않는다). 위는 현재 registry(외부 6종 `enabled: false`)의 출력이다. 상태는 다음 중 하나다.

| 상태 | 뜻 | 정기 수집 |
| --- | --- | --- |
| `READY` | registry 검증·활용승인·필드 매핑·한도·키가 모두 있고 기본 조회 방식이 녹음 응답으로 검증됐다 | 포함 |
| `NOT_CALLABLE(<이유>)` | registry 판정(`DISABLED`·`NOT_VERIFIED`·`NOT_APPROVED`·`NO_ENDPOINT`·`NO_FIELD_MAPPING`·`NO_SERVICE_KEY_ENV`) | 제외 |
| `QUOTA_UNVERIFIED` | `quota.daily`가 없다. 한도를 지어내지 않고 부르지 않는다 | 제외 |
| `KEY_MISSING`·`KEY_INVALID` | 키 env가 비었거나 형식이 틀렸다 | 제외 |
| `OPERATION_UNVERIFIED` | 기본 조회 방식이 아직 녹음 검증 전이다 | 제외 |
| `AUTH_FAILED` | 운영 중 인증 오류(resultCode 30·31)를 받았다. 기동 출력에는 없고 `ingest:source-readiness` 에만 생긴다. 일정은 남아 회차마다 API 호출 0회의 `SOURCE_AUTH_FAILED` run 이 쌓인다. 키를 고친 뒤 Worker 재시작으로 풀린다 | 회차는 돌지만 호출 안 함 |

외부 서비스가 이 중 어느 상태여도 나라장터 입찰공고 수집과 기동은 막히지 않는다. 나라장터 키·registry가 틀릴 때만 예전처럼 exit 1이다.

옛 `G2B_INGEST_INTERVAL_MINUTES`가 env에 있으면 마지막 줄 앞에 `G2B_INGEST_INTERVAL_MINUTES 무시함: 정기 수집은 매일 KST 00·03·06·09·12·15·18·21시 정각에 돈다`가 한 줄 더 나온다.

registry 파일이 없으면 경로와 오류 코드만 출력하고 exit 1이다.

### 7.6 D4 1회 수집 `--once --window-minutes 60` — **[승인] 실제 API 호출**

```bash
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --once --window-minutes 60
```

- 일정을 만들지 않는다. 이 프로세스 안에서 최근 60분 창을 1회 수집하고 끝난다. documents job도 넣지 않는다.
- **예상 호출: 약 60~190회(추정, 일 1000회 중).** 목록 1~2쪽(쪽당 100건)에 신규·변경 공고마다 보조 조회 최대 3회다. 시간당 공고를 20~60건으로 잡은 값이다. 900회에 닿으면 보조 조회가 멈춘다.
- run은 `trigger = 'SCHEDULED'`, `job_key = 'g2b:ONCE:<from>:<to>'`로 기록된다. 정기 회차(`g2b:SCHEDULED:<to>`)와 겹치지 않는다. `SUCCEEDED`·`COMPLETE`로 끝나면 이후 정기 회차는 이 창의 끝에서 이어진다.
- Redis·Supabase 준비 확인에 실패하면 외부 호출 전에 멈춘다. 출력은 다음 한 줄 요약이다. `SUCCEEDED`·`PARTIAL`이면 exit 0, 아니면 exit 1이다.

```text
ingest-only 1회 수집 시작: 창 <from> ~ <to>
ingest-only 1회 수집 결과: status=SUCCEEDED created=… changed=… skippedDuplicate=… quarantined=… quotaUsed=… alreadyFinished=false runId=…
```

### 7.7 D5 결과 확인 (운영 영향 없음)

7.1의 SQL을 다시 실행해 `g2b:ONCE:` run의 `status`·`completeness`·`quota_used`를 확인한다. `/admin/ingestion`에서 run 이력과 `quotaUsed`, 새 live 공고가 보이는지 확인한다. 호출 수가 예상보다 크게 많으면 일정을 켜지 않고 보고한다.

### 7.8 D6 정기 일정(KST 3시간 정각) 시작 — **[승인]**

```bash
docker compose -f infra/compose.ingest-only.company.yaml up -d --no-deps ingest-worker
```

**기동해도 즉시 수집하지 않는다.** 다음 KST 정각(00·03·…·21시)에 첫 회차가 돈다. 기동 로그에 `g2b-scheduled 일정: … 기동 즉시 수집하지 않고 다음 정각 <ISO> 부터 돈다` 한 줄이 남는다. 즉시 수집이 필요하면 7.6의 `--once`나 화면의 수동 수집을 쓴다. 첫 회차의 창은 직전 성공 창 끝(보통 D4의 끝)부터 그 정각까지이고 최대 24시간이다. 같은 id(`g2b-scheduled`)로 upsert하므로 옛 60분 `every` 일정이 남아 있어도 그 대기 회차를 지우고 cron 일정 하나로 바뀐다. 다시 기동해도 일정은 하나다(BullMQ 6.3.17 `addJobScheduler`).

### 7.9 D7 확인 (운영 영향 없음)

```bash
docker compose -f infra/compose.ingest-only.company.yaml ps ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml logs --tail 50 ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

기동 로그에 `ingest 큐 Job Scheduler 1개`와 `id=g2b-scheduled every=- pattern="0 */3 * * *" tz=Asia/Seoul next=…`(next는 KST 정각의 UTC 시각)가 보여야 한다. 외부 서비스를 `READY`로 켰다면 그 수만큼 `<key>-scheduled`가 더 보이고, `외부 소스 …` 줄이 7.5와 같은 상태를 보인다. 현재 registry에서는 외부 일정이 없어 1개다. `every=3600000`이 보이면 옛 일정이 남은 것이다. `--status`도 Job Scheduler 1개를 보여야 한다. 회차마다 `{"event":"ingest.job.timing",…,"scheduledFor":…,"startedAt":…,"queueDelayMs":…}` 한 줄이 남고 같은 값이 `params->'timing'`에 기록된다(수동 job이 앞에서 돌면 정기 회차는 기다렸다 돌고 그 대기가 `queueDelayMs`다). 상태가 healthy인지, 첫 회차 run이 7.1 SQL에 `g2b:SCHEDULED:` job_key로 생겼는지 확인한다. 창이 잘렸으면 로그의 `ingest.window.capped`와 `params->'windowCap'`을 함께 본다.

### 7.10 되돌리기

```bash
export INGEST_WORKER_TAG=<기동한 SHA>   # docker ps 의 이미지 태그
docker compose -f infra/compose.ingest-only.company.yaml stop ingest-worker
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --unschedule
docker compose -f infra/compose.ingest-only.company.yaml run --rm --no-deps ingest-worker node --conditions=react-server --import tsx worker/ingest-only-main.ts --status
```

순서를 지킨다. 먼저 멈추고 나서 일정을 지운다. `--unschedule`은 이 Worker가 거는 ingest 큐 일정 전부(`g2b-scheduled`와 외부 서비스별 `<key>-scheduled`)와 그 다음 예정 job만 지운다(BullMQ `removeJobScheduler`). 출력은 `ingest 큐의 정기 일정을 지웠다: g2b-scheduled, kwater-bid-notice-scheduled, …` 한 줄이다. `ingest:source-readiness` 키는 지우지 않는다(다음 기동이 덮어쓴다). 이미 대기열에 올라간 job, quota 키, 수집한 live 공고는 지우지 않는다. 마지막 `--status`에서 Job Scheduler 0개를 확인한다. 이전 SHA 이미지는 지우지 않고 남겨 둔다. 다시 켤지는 운영자가 판단한다.

### 7.11 쓰지 않는 명령

- `docker compose … down`, `down -v`, `--remove-orphans`
- 전체 재시작(`docker compose restart`, 다른 컨테이너까지 걸리는 `docker restart`)
- Redis `FLUSHALL`·`FLUSHDB`, 큐 키 삭제
- 회사 `sol-radar-gateway` 프로젝트(`infra/compose.company.yaml`)의 `up`
- `sol-radar-ai-worker-worker:latest`를 만드는 빌드·태그(`docker build -t sol-radar-ai-worker-worker:latest`, `docker tag … sol-radar-ai-worker-worker:latest`)
- `fixtures/` 권한 변경(`chmod`·`chown`)
- 키 값을 출력하는 명령(`--quiet` 없는 `config`, 컨테이너 안 `env`·`printenv`, `.env*` 파일 열람)

## 8. Documents 전용 Worker

이 절은 별도 운영 승인 후 실행할 절차다. 회사 기동 성공 기록이 아니다. 근거는 `docs/evidence/attachment-pipeline/20261027-implementation.md`다. **[승인]** 표시 단계는 사용자 승인 뒤에만 실행한다.

목적: ingest 전용 Worker(§7)가 남긴 live 공고 첨부(`bid_documents.download_status = 'PENDING'`)를 나라장터에서 내려받아 Supabase Storage(`bid-documents`)에 두고, 회사 AI gateway `POST /parse`로 텍스트를 뽑아 `bid-parsed`에 저장한다. 분석은 이 텍스트를 읽는다. Compose 파일은 `infra/compose.documents-only.company.yaml`(프로젝트 `sol-radar-documents`, 서비스 `documents-worker` 하나), 진입점은 `web/worker/documents-only-main.ts`다. `infra/compose.company.yaml`(`sol-radar-gateway`)에는 넣지 않았다. 그 프로젝트의 `up`은 §7.11에서 쓰지 않는 명령이기 때문이다.

- 등록은 documents 하나다. documents 큐 소비자와 처리 범위 복구 회차(60초마다)만 돈다. 수집·분석·알림·의존성 보고·Storage 정리는 돌리지 않는다.
- 처리 범위: `is_demo = false`, 최신 revision, 상태 `OPEN`·`AMENDED`, 마감 전(마감 없음 포함) 공고만 다룬다. 공고마다 이름이 `.pdf`·`.hwp`·`.hwpx`인 첨부 가운데 공고서·공고문·제안요청서·과업지시서를 먼저, 서식·서약서 같은 양식을 맨 뒤로 정렬한 상위 `DOCUMENTS_MAX_PER_BID`(기본 3)건만 받는다. 그 밖의 첨부(xlsx·zip·docx, 상한 밖, 마감 지난 공고)는 받지 않고 `PENDING`으로 남는다. 받은 뒤 내용이 파서 형식이 아니면(매직 바이트) gateway에 보내지 않고 `UNSUPPORTED`(`UNSUPPORTED_FORMAT`)로 끝낸다.
- 속도: 나라장터 요청 사이 최소 `DOCUMENTS_FETCH_INTERVAL_MS`(기본 2000ms), 동시 처리 `DOCUMENTS_CONCURRENCY`(기본 2, 최대 2. gateway `/parse`의 동시 파서 수가 2다), 복구 회차마다 job을 넣는 revision `DOCUMENTS_ROUND_MAX_REVISIONS`(기본 10). 회차당 최대 10공고 × 3건 = 30건이고 분당 내려받기도 최대 30건이다. 값은 Compose `environment`(셸 변수)로만 바꾼다. 틀린 값이면 진입점이 키 이름만 출력하고 exit 1이다.
- 내려받기: `https://www.g2b.go.kr/pn/…`만 받는다. 리다이렉트는 같은 허용 목록 안에서 최대 3회다. 로그인·SSO 경로로 가면 `AUTH_REQUIRED`다. DNS 결과에 사설 주소가 섞이면 연결하지 않는다. 리다이렉트를 포함해 30초, 50 MiB를 넘으면 받는 도중에 끊는다. 세션·쿠키를 보내지 않는다.
- 상태 기록: 문서마다 DB 리스(`claim_document_processing`, 600초)를 잡는다. `AUTH_REQUIRED`·`HTTP_4XX`·`REDIRECT_BLOCKED`·`HOST_NOT_ALLOWED`·`TOO_LARGE`는 바로 `download_status = 'FAILED'`다. `TIMEOUT`·`HTTP_5XX`와 파서 시간 초과(`FAILED`·`PARSER_ERROR`)는 BullMQ 재시도(3회) 뒤 마지막 시도에서 `FAILED`로 남는다. `/parse`의 `UNSUPPORTED`(`NO_TEXT_LAYER`·`ENCRYPTED`·`DISTRIBUTION_PROTECTED`·`TOO_LARGE`)와 `FAILED`·`CORRUPTED`는 다시 부르지 않고 그대로 남긴다. Storage·gateway를 못 쓰면 기록하지 않고 10분씩 최대 12번(약 2시간) 미룬 뒤 `PENDING`으로 둔다. 그 job은 보존 기간(1일) 뒤 복구 회차가 다시 넣는다.
- `infra/.env.worker.local`은 §2의 Worker 파일을 같이 쓴다(`REDIS_URL`·`NEXT_PUBLIC_SUPABASE_URL`·service role 키·Storage 버킷 이름). 새 키는 없다. 키 값을 터미널·로그에 출력하지 않는다. 로그에는 문서 id·결과 코드만 남고 첨부 이름·URL·본문은 남지 않는다.
- 이미지는 `sol-radar-documents-worker:<git SHA>`다. `sol-radar-ai-worker-worker:latest`를 빌드하거나 덮지 않는다. Compose의 모든 명령에 `DOCUMENTS_WORKER_TAG`가 필요하다.
- **전체 Worker(`worker/main.ts`)를 같은 Redis에서 함께 띄우지 않는다.** 전체 Worker도 live에서 같은 documents 소비자·복구 회차를 가진다. 같은 첨부를 두 번 처리하지는 않지만(문서 리스·jobId 중복 제거), 나라장터 요청 간격이 프로세스마다 따로 계산된다.

### 8.1 D0 읽기 확인 (운영 영향 없음)

```bash
cd /data/www/ai_workspace/sol-radar-deploy
docker ps --no-trunc --format '{{.Names}}\t{{.Image}}\t{{.Command}}\t{{.Status}}'
curl -sS http://172.20.0.1:8000/health
```

- 전체 Worker(`worker/main.ts`)가 있으면 멈춘다.
- `/health`의 `parsers`가 형식마다 parserId(예: `pdfplumber@0.11.10`, `sol-hwpx@1`, `sol-hwp5@1+olefile@0.47`)를 보여야 한다. `null`이면 파서가 배포되지 않은 gateway다. 그 상태로 띄우면 원본만 받고 파싱은 미루다(약 2시간) `PENDING`으로 남는다. 파서 배포 뒤에 띄운다.
- Supabase SQL로 migration `20261027000500` 적용(함수 5개)과 처리 대상 수를 본다.

```sql
select proname from pg_proc where proname in ('claim_document_processing','fail_document_download',
  'fail_document_parse','release_document_processing','document_processing_candidates') order by 1;
select count(*) as revisions from public.document_processing_candidates(false, '00000000-0000-0000-0000-000000000000', 100, 3);
select download_status, parse_status, count(*) from bid_documents d join bid_notices n on n.id = d.bid_id
 where not n.is_demo group by 1, 2 order by 1, 2;
select id, public from storage.buckets where id in ('bid-documents', 'bid-parsed');
```

함수가 5개가 아니거나 버킷 두 개(`public = false`)가 없으면 멈춘다.

### 8.2 D1 이미지 빌드 (외부 호출 없음)

```bash
export DOCUMENTS_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
docker compose -f infra/compose.documents-only.company.yaml config --quiet
docker compose -f infra/compose.documents-only.company.yaml build documents-worker
docker image ls sol-radar-documents-worker
```

### 8.3 D2 설정 확인 `--check` (외부 호출 없음)

```bash
docker compose -f infra/compose.documents-only.company.yaml run --rm --no-deps documents-worker node --conditions=react-server --import tsx worker/documents-only-main.ts --check
```

Redis·Supabase·gateway·나라장터에 접속하지 않는다. 통과하면 다음 모양이다.

```text
documents 처리 범위: 공고당 3건, 회차(60초)당 revision 10개
나라장터 요청 간격 2000ms, 동시 처리 2, 리스 600초
Storage 버킷: 원본 bid-documents, 텍스트 bid-parsed
documents-only worker 확인 통과: SOL_RUN_MODE=live
```

### 8.4 D3 기동 — **[승인] 나라장터 첨부 실다운로드**

```bash
docker compose -f infra/compose.documents-only.company.yaml up -d --no-deps documents-worker
```

기동하면 바로 복구 회차가 돌아 처리 대상 revision 최대 10개를 큐에 넣고 내려받기를 시작한다. 처음 한 번은 2026-10-27 기준 PENDING 1,975행 가운데 범위 안의 것만 받는다(마감 전 공고 × 공고당 3건).

### 8.5 D4 확인 (운영 영향 없음)

```bash
docker compose -f infra/compose.documents-only.company.yaml ps documents-worker
docker compose -f infra/compose.documents-only.company.yaml logs --tail 100 documents-worker
```

- 기동 로그에 `{"event":"documents.enabled",…}`, 60초마다 `{"event":"documents.reconcile",…}`가 보인다.
- job마다 `{"event":"documents.job",…,"documents":[{"documentId":…,"outcome":…}]}` 한 줄이 남는다. `outcome`은 `PARSED`·`PARTIAL`·`UNSUPPORTED`·`PARSE_FAILED`·`DOWNLOAD_FAILED`·`DEFERRED`·`BUSY`·`RETRY` 등이다. `DEFERRED`가 계속되면 `detail`(`GATEWAY_UNREACHABLE`·`storage_upload_failed` 등)을 보고 멈춘다.
- 8.1의 상태별 SQL을 다시 실행해 `OK`·`PARSED`가 늘고 `FAILED`의 `download_error_code`가 한쪽으로 몰리지 않는지 본다. `AUTH_REQUIRED`·`HTTP_4XX`가 대부분이면 나라장터가 자동 다운로드를 막는 것이다. 멈추고 보고한다(07 §2.4 미검증 가정).

### 8.6 분석 연결 — **[승인]**

분석이 첨부 텍스트를 읽으려면 이 SHA의 코드가 세 곳에 모두 있어야 한다. 순서를 지킨다.

1. Analysis Worker: `analysis-only-main.ts`가 쓰는 `startAnalysisRuntime`이 첨부 텍스트 reader를 쓴다. 회사 Analysis Worker는 `sol-radar-ai-worker-worker:latest`(회사 운영 원본)로 돈다. §7.11대로 그 태그는 빌드하지 않는다. 대신 덮어쓰기 파일 `infra/compose.analysis-only.sha.company.yaml`을 원본 뒤에 함께 줘서, 같은 서비스를 SHA 태그 이미지 `sol-radar-analysis-worker:<SHA>`로 다시 만든다(2026-10-27 결정). 교체 전에는 분석이 첨부를 읽지 않는다.

   먼저 실행 중인 Analysis Worker가 이 Compose 프로젝트의 컨테이너인지 본다. 라벨이 `sol-radar-analysis-only`·`analysis-worker`가 아니면 멈춘다(아래 `up`이 두 번째 소비자를 만든다). 진행 중 분석(`score_runs.status` 가 `QUEUED`·`RUNNING`)이 없을 때 교체한다.

   ```bash
   docker ps --filter label=com.docker.compose.project=sol-radar-analysis-only --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
   export ANALYSIS_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
   A="docker compose -f infra/compose.analysis-only.company.yaml -f infra/compose.analysis-only.sha.company.yaml"
   $A config --quiet
   $A build analysis-worker
   $A up -d --no-deps analysis-worker
   $A ps analysis-worker
   $A logs --tail 30 analysis-worker
   ```

   기대: 이미지가 `sol-radar-analysis-worker:$ANALYSIS_WORKER_TAG`, 로그에 `analysis-only worker started`. 되돌리기는 덮어쓰기 파일 없이 원본만으로 다시 만든다. `latest` 이미지는 그대로 남아 있다.

   ```bash
   docker compose -f infra/compose.analysis-only.company.yaml up -d --no-deps analysis-worker
   ```
   ADR-056 대안 A(2026-10-29)부터 Analysis Worker도 `DOCUMENTS_MAX_PER_BID`로 기다릴 첨부 범위를 정한다. Documents Worker와 같은 값이어야 한다. Documents Compose는 셸 변수 `${DOCUMENTS_MAX_PER_BID:-}`를 `.env.worker.local`보다 앞세워 넘기고(비면 기본 3), 분석 원본 Compose는 `.env.worker.local`만 읽는다. 그래서 이 값은 `.env.worker.local`에 넣지 않고 두 Worker 모두 기본 3으로 둔다. 바꿔야 하면 두 Worker가 같은 값을 읽게 한 뒤 바꾼다. 값이 어긋나 분석 쪽이 크면 처리되지 않을 첨부를 300초까지 기다린다(그 뒤 `DOCUMENTS_WAIT_TIMEOUT`으로 분석한다).
2. redis-api: 분석 요청의 원문 확인(`ANALYSIS_READS_ATTACHMENT_TEXT = true`)이 바뀐다. 교체 전에는 본문 없는 live 공고를 계속 409로 막는다(안전한 쪽).
3. Vercel web: 같은 확인을 중계 전에 한다. 1·2가 끝난 뒤 배포한다. 먼저 배포해도 redis-api가 막지만, 화면의 분석 준비 표시가 먼저 바뀐다.

### 8.7 되돌리기

```bash
export DOCUMENTS_WORKER_TAG=<기동한 SHA>   # docker ps 의 이미지 태그
docker compose -f infra/compose.documents-only.company.yaml stop documents-worker
```

- 멈추면 진행 중 job이 끝나기를 최대 180초 기다린다. 넘으면 그 문서의 리스(600초)가 끝난 뒤 다음 기동이 이어 받는다. 큐에 남은 job·이미 저장한 원본·텍스트·`bid_documents` 상태는 지우지 않는다. 모두 사실 그대로의 기록이다.
- 분석 연결(8.6)을 되돌릴 때는 이전 SHA의 web·redis-api·Analysis Worker 이미지로 돌린다. 저장된 텍스트는 남아도 읽는 쪽이 없다.
- DB 함수(migration `20261027000500`)는 두어도 된다. 지워야 하면 새 migration으로 함수 5개만 drop한다(열·행은 이 migration이 만들지 않았다).
- 이전 SHA 이미지는 지우지 않고 남겨 둔다.

### 8.8 쓰지 않는 명령

§7.11과 같다. 그리고 다음을 더한다.

- 전체 Worker(`worker/main.ts`)를 같은 Redis에서 함께 기동
- `documents` 큐 키 삭제, `bid_documents` 상태를 SQL로 일괄 `PENDING`으로 되돌리기(필요하면 문서 id를 정해 따로 승인받는다)
- `DOCUMENTS_CONCURRENCY`를 2보다 크게(진입점이 거부한다)

## 9. Notify 전용 Worker

이 절은 별도 운영 승인 후 실행할 절차다. 회사 기동 성공 기록이 아니다. **[승인]** 표시 단계는 사용자 승인 뒤에만 실행한다.

목적: 인앱 알림(화면의 벨)·카카오 추천 공고 알림·관심 공고 마감 알림을 처리한다. 회사 서버의 ingest·analysis·documents 전용 Worker는 알림을 처리하지 않는다. 알림 등록(`notifyWorkerRegistration`·`deadlineWorkerRegistration`)은 전체 Worker(`web/worker/main.ts`)에만 있어서, 이 Worker가 없으면 운영 `outbox_events`가 쌓이기만 한다. Compose 파일은 `infra/compose.notify-only.company.yaml`(프로젝트 `sol-radar-notify`, 서비스 `notify-worker` 하나), 진입점은 `web/worker/notify-only-main.ts`다.

- 등록은 둘이다. outbox 회차는 2초마다 최대 50건을 처리한다. 대상은 인앱 `REVIEW_ASSIGNED`·`ANALYSIS_COMPLETE`와 카카오 `BID_RECOMMENDED`·`KAKAO_TEST`다. 마감 회차는 5분마다 돌고, KST 09:00 뒤에 그날 D-3·D-1 인앱 알림을 넣는다. 수집·분석·documents·부처 공고·의존성 보고·Storage 정리는 돌리지 않는다.
- Redis: 알림 처리는 Redis를 쓰지 않는다. `outbox_events` 표와 DB 함수 `send_deadline_reminders`만 service role로 부른다. 다만 공용 기동 단계가 `REDIS_URL`을 요구하고, 준비 확인에서 Redis를 ping하고, 연결 하나를 열어 둔다. 그래서 `redis_default` network에 붙고 Redis가 닿아야 뜬다. 큐와 키는 만들지 않는다.
- 카카오: Compose가 `NOTIFY_KAKAO_PROVIDER`를 빈 값으로 덮는다. `infra/.env.worker.local`에 `mock`(예시 파일 값)이 있어도 Compose 값이 우선한다. live에서 빈 값이면 카카오 발송이 꺼진다. 기동 로그에 `notify.kakao.disabled` 경고가 한 줄 남는다. 꺼진 동안 카카오 이벤트는 claim·발송 없이 재시도(5·10·20·40초)를 거쳐 다섯 번째 실패에서 `DEAD`가 된다(약 80초). 나중에 `memo`로 켜도 이미 `DEAD`가 된 이벤트는 보내지 않는다. 인앱·마감 알림은 그대로 나간다.
- `mock`은 쓰지 않는다. `mock`은 보내지 않은 카카오를 `SENT`로 적는다. 또 사람·공고마다 영속 claim(`kakao_send_claims`)을 잡아서, 나중에 `memo`로 바꿔도 그 공고는 그 사람에게 다시 보내지 않는다.
- live에서만 뜬다. `SOL_RUN_MODE`가 live가 아니면 진입점이 Redis·Supabase에 닿기 전에 exit 1이다. mock·fixture 실행 모드는 빈 발송 수단을 `mock`으로 읽기 때문이다.
- `infra/.env.worker.local`은 §2의 Worker 파일을 같이 쓴다(`REDIS_URL`·`NEXT_PUBLIC_SUPABASE_URL`·service role 키). 카카오를 켤 때만 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`SITE_URL`이 필요하다(§9.6). 키 값을 터미널·로그에 출력하지 않는다. 로그에는 이벤트 id·종류·결과·시도 수·오류 이름만 남고 수신자·공고명·문구는 남지 않는다.
- 이미지는 `sol-radar-notify-worker:<git SHA>`다. `sol-radar-ai-worker-worker:latest`를 빌드하거나 덮지 않는다. Compose의 모든 명령에 `NOTIFY_WORKER_TAG`가 필요하다.
- **전체 Worker(`worker/main.ts`)를 같은 Supabase에 대고 함께 띄우지 않는다.** 회사 밖(로컬 Compose 등)에서 운영 Supabase를 가리키는 전체 Worker도 포함한다. 같은 알림을 두 번 보내지는 않는다. 인앱은 `notifications.idempotency_key`, 카카오는 claim, 마감은 `on conflict do nothing`이 막는다. 하지만 두 프로세스의 카카오 설정이 다르면 섞인다. `mock` 쪽이 claim을 먼저 잡으면 실제로 안 간 카카오가 `SENT`로 남고, 꺼진 쪽은 시도 수를 올려 `DEAD`를 앞당긴다.

### 9.1 D0 읽기 확인 (운영 영향 없음)

```bash
cd /data/www/ai_workspace/sol-radar-deploy
docker ps --no-trunc --format '{{.Names}}\t{{.Image}}\t{{.Command}}\t{{.Status}}'
git -C . log --oneline -1
```

- 전체 Worker(`worker/main.ts`)나 다른 `notify-only-main.ts` 컨테이너가 있으면 멈춘다.
- 아래 "기동 전 확인" SQL을 Supabase SQL 편집기에서 실행한다. 모두 읽기 전용이다. 결과를 보고한 뒤 §9.4 기동 승인을 받는다.

#### 기동 전 확인 1 — 쌓인 outbox

운영에서는 지금까지 알림 outbox가 한 번도 처리되지 않았다. 처음 기동하면 다음처럼 된다.

- 나이 제한이 없다. `PENDING`과 재시도 시각이 된 `FAILED`를 오래된 것부터 회차(2초)마다 50건씩 처리한다. 분당 최대 1,500건이다.
- 인앱 두 종: 받는 사람(`REVIEW_ASSIGNED`는 배정 대상, `ANALYSIS_COMPLETE`는 분석 요청자)이 그 조직 구성원이고 활동 계정이며 공고가 있으면 알림 1건을 넣는다. 아니면 알림 없이 `PROCESSED`로 닫는다. 알림의 `sent_at`·`created_at`은 처리한 시각이다. 그래서 며칠 전 분석·배정도 새 알림으로 한꺼번에 벨에 뜬다(읽지 않음).
- 카카오 두 종: 기본(꺼짐)이면 약 80초 안에 모두 `DEAD`가 된다. 발송·claim·`notifications` 행은 생기지 않는다. 처음부터 `memo`로 띄우면 쌓인 `BID_RECOMMENDED`마다 지금 연결(`enabled`·`CONNECTED`)한 그 조직 구성원에게 보낸다. 마감이 지난 공고도 `마감 지남` 표기로 보낸다. 이미 받은 사람·공고는 건너뛴다.
- 공고 이벤트(`BID_CREATED`·`BID_CHANGED`)는 고르지 않는다. `PENDING`으로 그대로 남는다.

```sql
-- 종류·상태·데모 여부별 이벤트 수(KAKAO_TEST 는 공고가 없어 is_demo 가 비어 있다)
select e.event_type, e.status, b.is_demo, count(*) as events,
       min(e.created_at) as oldest, max(e.created_at) as newest
from public.outbox_events e
left join public.bid_notices b on b.id::text = e.payload->>'bidId'
where e.event_type in ('REVIEW_ASSIGNED', 'ANALYSIS_COMPLETE', 'BID_RECOMMENDED', 'KAKAO_TEST')
group by 1, 2, 3 order by 1, 2, 3;

-- 인앱으로 한꺼번에 받을 사람(상위 20명). 실제 알림 수는 구성원·활동 계정·공고 확인 뒤라 이보다 작거나 같다
select e.event_type, coalesce(e.payload->>'assigneeUserId', e.payload->>'requestedBy') as user_id,
       count(*) as events, min(e.created_at) as oldest
from public.outbox_events e
where e.status in ('PENDING', 'FAILED') and e.event_type in ('REVIEW_ASSIGNED', 'ANALYSIS_COMPLETE')
group by 1, 2 order by events desc limit 20;

-- 카카오 연결 수. CONNECTED·enabled 가 0 이면 memo 로 켜도 BID_RECOMMENDED 는 받을 사람이 없어 닫힌다
select status, enabled, count(*) from public.kakao_notify_links group by 1, 2 order by 1, 2;
```

한 사람이 받을 인앱 알림이 많거나 오래된 이벤트가 많으면 멈추고 보고한다. 오래된 이벤트를 미리 닫을지는 범위(기간·종류)를 정해 따로 승인받는다. 이 실행서에는 쓰기 SQL을 두지 않는다.

#### 기동 전 확인 2 — 마감 알림 첫 회차

- 첫 회차는 기동하자마자 돈다. KST 09:00 전이면 0건이고, 09:00 뒤 첫 회차가 그날 몫을 넣는다. 놓친 날(어제의 D-3 등)은 메우지 않는다.
- 대상 공고: `deadline_at`이 지금보다 뒤이고 상태가 `OPEN`·`AMENDED`이며, 마감의 KST 날짜가 오늘부터 3일 또는 1일 뒤인 공고 전부다. 실공고·데모 공고를 가리지 않는다(`is_demo` 조건 없음).
- 받는 사람: 공고·조직마다 그 공고의 관심 등록자(`bid_watches`)와 최신 결정(`bid_reviews`, `decided_at` 최신 한 행)의 담당자다. 그 조직 구성원이고 활동 계정인 사람만 받는다. 그래서 관심·담당이 없는 실공고는 0건이다. 같은 사람·공고·D-n은 조직이 달라도 한 건이다.

```sql
-- 지금이 KST 09:00 뒤인가(아니면 첫 회차는 0건)
select ((now() at time zone 'UTC') + interval '9 hours')::time >= time '09:00' as after_0900_kst;

-- 마감이 3일 안인 공고 수(받는 사람과 상관없이). 1·3 이 오늘 대상이다
with t as (
  select now() as p_now, (now() at time zone 'UTC') + interval '9 hours' as kst_now
), due as (
  select b.id as bid_id, b.is_demo,
         ((b.deadline_at at time zone 'UTC') + interval '9 hours')::date - t.kst_now::date as days_left
  from public.bid_notices b cross join t
  where b.deadline_at is not null and b.deadline_at > t.p_now and b.status in ('OPEN', 'AMENDED')
)
select days_left, is_demo, count(*) as bids from due where days_left between 0 and 3
group by 1, 2 order by 1, 2;

-- 오늘 첫 회차가 넣을 알림 수. send_deadline_reminders(now()) 의 규칙을 그대로 옮긴 읽기 전용 질의다
with t as (
  select now() as p_now, (now() at time zone 'UTC') + interval '9 hours' as kst_now
), due as (
  select b.id as bid_id, b.is_demo,
         ((b.deadline_at at time zone 'UTC') + interval '9 hours')::date - t.kst_now::date as days_left
  from public.bid_notices b cross join t
  where b.deadline_at is not null and b.deadline_at > t.p_now and b.status in ('OPEN', 'AMENDED')
), due13 as (
  select * from due where days_left in (3, 1)
), latest_reviews as (
  select distinct on (r.org_id, r.bid_id) r.org_id, r.bid_id, r.assignee_id
  from public.bid_reviews r join due13 on due13.bid_id = r.bid_id
  order by r.org_id, r.bid_id, r.decided_at desc, r.id desc
), recipients as (
  select org_id, bid_id, assignee_id as user_id from latest_reviews where assignee_id is not null
  union
  select w.org_id, w.bid_id, w.user_id from public.bid_watches w join due13 on due13.bid_id = w.bid_id
)
select due13.days_left, due13.is_demo,
       count(distinct due13.bid_id) as bids,
       count(distinct (due13.bid_id, rc.user_id)) as reminders,
       count(distinct rc.user_id) as users
from recipients rc
join due13 on due13.bid_id = rc.bid_id
join public.memberships m on m.org_id = rc.org_id and m.user_id = rc.user_id
join public.profiles p on p.id = rc.user_id and p.status = 'active'
where not exists (
  select 1 from public.notifications n
  where n.idempotency_key = due13.bid_id::text || ':' || rc.user_id::text
        || ':DEADLINE_APPROACHING:D-' || due13.days_left::text
)
group by 1, 2 order by 1, 2;
```

### 9.2 D1 이미지 빌드 (외부 호출 없음)

```bash
export NOTIFY_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
docker compose -f infra/compose.notify-only.company.yaml config --quiet
docker compose -f infra/compose.notify-only.company.yaml build notify-worker
docker image ls sol-radar-notify-worker
```

### 9.3 D2 설정 확인 `--check` (외부 호출 없음)

```bash
docker compose -f infra/compose.notify-only.company.yaml run --rm --no-deps notify-worker node --conditions=react-server --import tsx worker/notify-only-main.ts --check
```

Redis·Supabase·카카오에 접속하지 않는다. 통과하면 다음 모양이다.

```text
알림 outbox: 2000ms 마다 최대 50건(인앱 REVIEW_ASSIGNED·ANALYSIS_COMPLETE, 카카오 BID_RECOMMENDED·KAKAO_TEST)
카카오 발송: 꺼짐(NOTIFY_KAKAO_PROVIDER 빈 값. 카카오 이벤트는 재시도 뒤 DEAD)
마감 알림: 300000ms 마다(KST 09:00 뒤 그날 D-3·D-1, 관심 등록자·최신 결정 담당자)
notify-only worker 확인 통과: SOL_RUN_MODE=live
```

`카카오 발송:` 줄이 `꺼짐`이 아니면 멈춘다. 셸 변수나 `infra/.env`에 `NOTIFY_KAKAO_PROVIDER`가 남아 있다는 뜻이다(셸이면 `unset NOTIFY_KAKAO_PROVIDER`).

### 9.4 D3 기동 — **[승인] 쌓인 알림 처리 시작**

```bash
docker compose -f infra/compose.notify-only.company.yaml up -d --no-deps notify-worker
```

기동하면 바로 outbox 회차와 마감 회차가 돈다. §9.1에서 센 이벤트가 인앱 알림으로 들어가고, 카카오 이벤트는 약 80초 안에 `DEAD`가 된다.

첫 기동은 이 기본(카카오 꺼짐)으로 한다. 처음부터 `NOTIFY_KAKAO_PROVIDER=memo`로 띄우지 않는다. 쌓인 `BID_RECOMMENDED`를 `DEAD`로 정리한 뒤 §9.6에서 `memo`로 바꾼다(사용자 결정 2026-10-29, `docs/16-DECISIONS.md` ADR-068 6번).

### 9.5 D4 확인 (운영 영향 없음)

```bash
docker compose -f infra/compose.notify-only.company.yaml ps notify-worker
docker compose -f infra/compose.notify-only.company.yaml logs --tail 100 notify-worker
```

- 기동 로그에 `{"event":"notify.kakao.disabled",…}`와 `notify-only worker started: SOL_RUN_MODE=live`가 보인다.
- 처리한 이벤트마다 `{"event":"notify.outbox","outboxEventId":…,"eventType":…,"outcome":…}` 한 줄, 회차마다 `{"event":"notify.outbox.summary",…}` 한 줄이 남는다. 빈 회차는 줄을 남기지 않는다. 카카오 이벤트는 `"outcome":"RETRY"`가 네 번 남은 뒤 `"outcome":"DEAD"`로 끝난다.
- `{"event":"notify.outbox.failed",…}`가 이어지면(DB 오류, 최대 60초 간격으로 늦춘다) 멈추고 보고한다.
- 마감 알림을 넣으면 `{"event":"notify.deadline.sent","inserted":…}`가 남는다.
- §9.1 첫 SQL을 다시 실행해 인앱 두 종의 `PENDING`이 0이 되고 `PROCESSED`가 늘었는지 본다. 넣은 알림은 다음으로 센다.

```sql
select type, channel, status, count(*) from public.notifications
where created_at > now() - interval '1 hour' group by 1, 2, 3 order by 1, 2, 3;
```

### 9.6 카카오 S0 수신 시험·실수신 녹화 — **[승인] 카카오 실발송**

카카오 "나에게 보내기"를 실제로 보낸다. 켜 둔 동안에는 사람이 요청한 분석이 `BID`·`WATCH`로 끝날 때마다 그 조직에서 카카오를 켠 구성원에게 간다. 시험이 끝나면 바로 끈다.

1. `infra/.env.worker.local`에 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`SITE_URL`을 넣는다. 값은 웹(Vercel)과 같아야 한다. 특히 `KAKAO_TOKEN_ENC_KEY`가 다르면 웹이 저장한 연결 토큰을 풀지 못한다. 값을 출력하지 않는다.
2. memo 설정을 확인한다. 하나라도 비면 이름만 출력하고 exit 1이다.

   ```bash
   NOTIFY_KAKAO_PROVIDER=memo docker compose -f infra/compose.notify-only.company.yaml run --rm --no-deps notify-worker node --conditions=react-server --import tsx worker/notify-only-main.ts --check
   ```

   `카카오 발송: memo(카카오 나에게 보내기 실발송)`이 보여야 한다.
3. §9.1의 카카오 SQL로 `PENDING`·`FAILED`인 `BID_RECOMMENDED`가 없는지 본다. 있으면 켜는 순간 보내므로 멈추고 보고한다.
4. 켠다. 설정이 바뀌어 컨테이너를 다시 만든다.

   ```bash
   NOTIFY_KAKAO_PROVIDER=memo docker compose -f infra/compose.notify-only.company.yaml up -d --no-deps notify-worker
   ```

5. 사용자가 개인 설정에서 카카오를 연결하고 시험 메시지를 보낸다(사용자당 24시간 10건). 휴대폰 수신과 알림 울림을 확인한다. 로그에 `"eventType":"KAKAO_TEST","outcome":"SENT","sent":1`이 남는다. `"failed":1`이면 연결 표의 `last_result`를 본다.
6. 끈다. 셸 변수 없이 다시 만들면 빈 값(꺼짐)으로 돌아간다.

   ```bash
   docker compose -f infra/compose.notify-only.company.yaml up -d --no-deps notify-worker
   docker compose -f infra/compose.notify-only.company.yaml logs --tail 20 notify-worker
   ```

   기동 로그에 `notify.kakao.disabled`가 다시 보여야 한다.

### 9.7 되돌리기

```bash
export NOTIFY_WORKER_TAG=<기동한 SHA>   # docker ps 의 이미지 태그
docker compose -f infra/compose.notify-only.company.yaml stop notify-worker
```

- 멈추면 진행 중 회차를 등록마다 최대 5초 기다린다. 처리하지 못한 이벤트는 `PENDING`·`FAILED`로 남고 다음 기동이 이어 받는다.
- 이미 넣은 알림 행, `DEAD`가 된 이벤트, 카카오 claim(`kakao_send_claims`)은 지우지 않는다. 모두 사실 그대로의 기록이다.
- 이전 SHA 이미지는 지우지 않고 남겨 둔다.

### 9.8 쓰지 않는 명령

§7.11과 같다. 그리고 다음을 더한다.

- 전체 Worker(`worker/main.ts`)를 같은 Supabase에 대고 함께 기동
- `NOTIFY_KAKAO_PROVIDER=mock`으로 기동
- `outbox_events`·`notifications`·`kakao_send_claims`의 일괄 `update`·`delete`(필요하면 범위를 정해 따로 승인받는다)

## 10. 부처 공고(기업마당) 전용 Worker

이 절은 별도 운영 승인 후 실행할 절차다. 회사 기동 성공 기록이 아니다. **[승인]** 표시 단계는 사용자 승인 뒤에만 실행한다.

목적: 기업마당 지원사업정보 API(`https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do`)를 나라장터 수집과 같은 시각(매일 KST 00·03·06·09·12·15·18·21시 정각)에 1회 불러 `program_notices`에 저장한다. 부처 공고 주기 수집(`programNoticesWorkerRegistration`, 60분)은 전체 Worker(`web/worker/main.ts`)에만 있어 회사에서는 돌지 않았다(2026-10-28 운영 `program_notices`·`program_notice_runs` 0행). Compose 파일은 `infra/compose.program-notices-only.company.yaml`(프로젝트 `sol-radar-program-notices`, 서비스 `program-notices-worker` 하나), 진입점은 `web/worker/program-notices-only-main.ts`다.

- 소스는 기업마당 하나다(사용자 결정 2026-10-28). 중기부 사업공고 RSS는 부르지 않는다. 요청 값은 `infra/sources/program-notices.yaml`이다(분야 `02` 기술, 최대 100건, JSON). 회차마다 요청 1회이고, 시간 초과·429·5xx만 수집과 같은 규칙(`web/server/ingestion/retry.ts`, 1·2·4초 + jitter)으로 최대 3번 더 부른다.
- 일정은 자기 큐 `program-notices`의 Job Scheduler `bizinfo-scheduled` 하나다(`Asia/Seoul` cron `0 */3 * * *`). 기동 즉시 부르지 않고 다음 정각부터 돈다. ingest 큐와 그 일정(`g2b-scheduled`·`<key>-scheduled`)·quota 키는 만들거나 지우지 않는다. 그래서 ingest 전용 Worker를 다시 만들지 않고 따로 켜고 끈다.
- 저장은 `(source, source_notice_id)` upsert다. 같은 공고를 다시 받으면 그 행을 덮어쓰고 행 수는 늘지 않는다. 해석에 실패하거나 0건이면 저장하지 않아 마지막으로 받은 데이터가 그대로 보인다. 회차마다 `program_notice_runs`에 한 행(`SUCCEEDED`·`PARTIAL`·`FAILED`·`SKIPPED`와 오류 코드)을 남긴다. 회차가 `FAILED`여도 일정은 남고 다음 정각에 다시 돈다.
- 로그에는 상태·건수·오류 코드만 남는다. `BIZINFO_API_KEY` 값·요청 URL(`crtfcKey` 포함)·응답 본문은 남지 않는다.
- live에서만 뜬다. `SOL_RUN_MODE`가 live가 아니거나, `infra/.env.worker.local`의 `BIZINFO_API_KEY`가 비었거나, 설정 파일이 틀리면 `--check`·기동이 env·경로 이름만 출력하고 exit 1이다.
- `infra/.env.worker.local`은 §2의 Worker 파일을 같이 쓴다(`REDIS_URL`·`NEXT_PUBLIC_SUPABASE_URL`·service role 키·`BIZINFO_API_KEY`). 그 파일의 `PROGRAM_NOTICES_INTERVAL_MINUTES`는 전체 Worker용이라 이 Worker는 읽지 않는다.
- Redis는 BullMQ 큐 하나(`bull:program-notices:*`)만 쓴다. `redis_default` network에 붙는다. 호스트 포트는 열지 않는다.
- 이미지는 `sol-radar-program-notices-worker:<git SHA>`다. `sol-radar-ai-worker-worker:latest`와 ingest 이미지를 빌드하거나 덮지 않는다. Compose의 모든 명령에 `PROGRAM_NOTICES_WORKER_TAG`가 필요하다.
- **전체 Worker(`worker/main.ts`)를 같은 Supabase에 대고 함께 띄우지 않는다.** 그쪽은 기동 즉시와 60분마다 기업마당·중기부를 따로 부른다. 저장은 upsert라 겹치지 않지만 호출이 늘어난다.
- 기동·재생성은 다른 Worker와 같이 KST 정각 +15분 ~ 다음 정각 −30분에만 한다.

### 10.1 D0 읽기 확인 (운영 영향 없음)

회사 저장소 HEAD가 배포할 SHA인지 확인한다. HEAD를 옮기는 것(ff)은 별도 승인이다. 이 절의 코드는 `infra/sources/`를 바꾸지 않아 실행 중인 ingest Worker의 registry 마운트에 영향이 없다.

```sql
select source, count(*), max(fetched_at) from public.program_notices group by 1;
select source, run_mode, status, error_code, fetched_count, saved_count, started_at
from public.program_notice_runs order by started_at desc limit 5;
```

### 10.2 D1 이미지 빌드 (외부 호출 없음)

```bash
export PROGRAM_NOTICES_WORKER_TAG="$(git -C . rev-parse --short=12 HEAD)"
docker compose -f infra/compose.program-notices-only.company.yaml config --quiet
docker compose -f infra/compose.program-notices-only.company.yaml build program-notices-worker
docker image ls sol-radar-program-notices-worker
```

새 이미지 `sol-radar-program-notices-worker:$PROGRAM_NOTICES_WORKER_TAG`만 생긴다. 실행 중 컨테이너는 바뀌지 않는다.

### 10.3 D2 설정 확인 `--check`·`--status` (외부 호출 없음)

```bash
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --check
```

Redis·Supabase·기업마당에 접속하지 않는다. 통과하면 다음 모양이다.

```text
부처 공고 설정: /srv/sol-radar/infra/sources/program-notices.yaml
기업마당: 분야 02 · 최대 100건 · BIZINFO_API_KEY SET
정기 수집: 매일 KST 00·03·06·09·12·15·18·21시 정각(Asia/Seoul), 큐 program-notices, 일정 bizinfo-scheduled
program-notices-only worker 확인 통과: SOL_RUN_MODE=live
```

```bash
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --status
```

Redis 읽기만 한다. 처음에는 `Job Scheduler 0개`다.

### 10.4 D3 1회 수집 `--once` — **[승인] 기업마당 실호출 1회**

```bash
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --once
```

일정을 만들지 않고 이 프로세스에서 기업마당을 1회 불러(실패하면 재시도 최대 3회) 운영 `program_notices`에 저장한다. 결과 한 줄이 다음 모양이면 exit 0이다. `FAILED`·`SKIPPED`면 exit 1이고 멈춘 뒤 보고한다.

```text
program-notices-only 1회 수집 결과: source=bizinfo status=SUCCEEDED fetched=100 saved=100 dropped=0 errorCode=-
```

§10.1 SQL로 `bizinfo` 행 수(100)와 `program_notice_runs`의 `LIVE`·`SUCCEEDED` 한 행을 확인한다. 화면은 `/bids`의 "부처 지원사업" 탭이다.

### 10.5 D4 기동 — **[승인] 정기 수집 시작**

```bash
docker compose -f infra/compose.program-notices-only.company.yaml up -d --no-deps program-notices-worker
```

### 10.6 D5 확인 (운영 영향 없음)

```bash
docker compose -f infra/compose.program-notices-only.company.yaml ps program-notices-worker
docker compose -f infra/compose.program-notices-only.company.yaml logs --tail 50 program-notices-worker
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --status
```

- 기동 로그에 `bizinfo-scheduled 일정: … 다음 정각 <ISO> 부터 돈다`와 `program-notices-only worker started: SOL_RUN_MODE=live`가 보인다.
- `--status`에 `Job Scheduler 1개`, `- bizinfo-scheduled 0 */3 * * * Asia/Seoul 다음 <다음 정각>`이 보인다. 다시 만들어도 1개다.
- 다음 정각 뒤 로그에 `{"event":"program_notices.round","source":"bizinfo","runMode":"LIVE","status":"SUCCEEDED",…}` 한 줄이 남는다. 재시도했으면 `{"event":"program_notices.retried",…}`가 앞에 남는다. §10.1 SQL로 run 행을 확인한다.
- ingest 쪽은 바뀌지 않는다. `ingest-only-main.ts --status`(§7)의 Job Scheduler 수가 이 기동 전과 같아야 한다.

### 10.7 되돌리기

```bash
export PROGRAM_NOTICES_WORKER_TAG=<기동한 SHA>   # docker ps 의 이미지 태그
docker compose -f infra/compose.program-notices-only.company.yaml stop program-notices-worker
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --unschedule
docker compose -f infra/compose.program-notices-only.company.yaml run --rm --no-deps program-notices-worker node --conditions=react-server --import tsx worker/program-notices-only-main.ts --status
```

순서를 지킨다. 먼저 멈추고 나서 일정을 지운다. `--unschedule`은 `program-notices` 큐의 `bizinfo-scheduled`만 지운다. 마지막 `--status`에서 `Job Scheduler 0개`를 확인한다. 저장한 `program_notices`·`program_notice_runs` 행은 지우지 않는다. 이전 SHA 이미지는 남겨 둔다.

### 10.8 쓰지 않는 명령

§7.11과 같다. 그리고 다음을 더한다.

- 전체 Worker(`worker/main.ts`)를 같은 Supabase에 대고 함께 기동
- ingest 전용 Worker(`sol-radar-ingest`)의 `up`·`--force-recreate`·`--unschedule`(이 Worker 반영에는 필요 없다)
- `program_notices`·`program_notice_runs`의 일괄 `update`·`delete`(필요하면 범위를 정해 따로 승인받는다)
