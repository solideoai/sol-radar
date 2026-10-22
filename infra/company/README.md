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
