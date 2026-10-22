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
