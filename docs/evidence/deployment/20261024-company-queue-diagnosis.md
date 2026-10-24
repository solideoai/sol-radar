---
title: "운영 분석 QUEUED 정체 진단 (2026-10-24)"
doc: "evidence-20261024-company-queue-diagnosis"
status: draft
tags:
  - sol-radar
  - ops
updated: 2026-10-24
---

# 운영 분석 QUEUED 정체 진단 (2026-10-24)

> [!warning] 코드 기준 진단이다
> 회사 서버에서 확인하기 전까지 원인은 추정이다. 아래 확인 명령은 읽기 전용이고 비밀값을 출력하지 않는다. 고치는 단계는 사용자가 회사 터미널에서 실행한다.

## 관찰 (sol-radar-9b, 10:05)

- 운영 FX-02 분석 요청은 202를 받았다. run `6a90acc4-3709-41af-850d-594c6549ad02` 는 5분 넘게 `QUEUED`, `startedAt` null, 오류 없음이다.
- QUEUED run의 `runMode` 는 `live`, provider는 `local` 이다. Vercel 머리말은 "실행 모드: mock · AI: local" 이다.
- `/health/ready` 200, `ai: local`. `GET /api/v1/admin/ai/status` 503 `{component:"redis-api"}`.

## 확실한 것 (코드 근거, 78이 직접 확인)

1. QUEUED 행의 `run_mode` 는 접수한 **회사 redis-api의 `SOL_RUN_MODE`** 에서 온다. `ai_provider` 는 mock이 아니면 무조건 `LOCAL` 이다(`web/server/bids/bids.supabase.ts:518-519`). Vercel은 `frontend` 라 회사 redis-api로 넘기기만 한다(`web/app/api/v1/bids/[id]/analyses/route.ts:41-42`). 따라서 **회사 redis-api는 `SOL_RUN_MODE=live`** 다.
2. Vercel 머리말의 실행 모드는 Vercel 자신의 `SOL_RUN_MODE`(mock)다. 실행서는 회사도 웹과 같은 `mock` 을 기대한다(`infra/company/README.md:30`).
3. Worker 보고(health의 `ai`)는 runMode·Supabase·버킷이 같을 때만 읽힌다. 큐(`bull:analysis:*`)에는 그런 필터가 없다. 같은 Redis에 붙은 다른 Worker(옛 구성, 다른 Supabase)가 job을 가져갈 수 있다.
4. `live` Worker는 G2B 정기 수집을 30분마다 돈다. 오늘 공공 API 호출 예산(서비스당 1,000건/일)을 쓰고 있을 수 있다.

## 원인 후보 (순위)

1. **회사 컨테이너가 옛 구성과 섞여 있다.** 옛 `compose.company.yaml` 에는 redis-api만 있고 `SOL_RUN_MODE` 주입이 없다. 실행서의 `--no-recreate` 는 옛 컨테이너를 교체하지 않는다. 운영자 셸에 export된 `SOL_RUN_MODE` 가 `--env-file` 보다 우선한다.
2. **job을 가져갔지만 대상 확인 전에 실패했다.** 이 경우 DB는 QUEUED·null·오류 없음으로 남는다. 다른 Worker가 가로챈 경우도 같다.
3. **analysis Worker가 멈췄거나 밀려 있다.** 동시 처리 수가 1이라 긴 live job 하나가 뒤를 막을 수 있다.

판별: 확인 명령 5의 `job` 이 비어 있거나 `consumers` 에 주소가 둘 이상이면 1·2번이다. `processedOn` 이 있고 `failedReason` 이 있으면 2번이다. `wait`·`active` 가 계속 쌓여 있으면 3번이다.

## 확인 명령 (회사 터미널, 저장소 checkout 위치, 읽기 전용)

```bash
DC="docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml"

# 1) 컨테이너·이미지·생성 시각·Compose 프로젝트: 옛 redis-api, 다른 worker 가 있는지
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.CreatedAt}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}'
$DC ps

# 2) 비밀이 아닌 env 만
for c in $(docker ps --format '{{.Names}}' | grep -Ei 'redis-api|worker|ai-gateway'); do echo "== $c"; docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" | grep -E '^(SOL_RUN_MODE|SOL_DEPLOYMENT_ROLE|AI_PROVIDER|NOTIFY_KAKAO_PROVIDER|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_STORAGE_(RAW|PARSED)_BUCKET)='; done
env | grep -c '^SOL_RUN_MODE='   # 1 이면 셸 값이 --env-file 보다 우선한다

# 3) REDIS_URL 비교: host·port·db·해시 앞 12자만 (redis-api·worker 컨테이너 각각)
docker exec <컨테이너> node -e 'const s=process.env.REDIS_URL.trim(),u=new URL(s);console.log(u.hostname,u.port||6379,u.pathname||"/",require("crypto").createHash("sha256").update(s).digest("hex").slice(0,12))'

# 4) 로그
$DC logs --since 30m worker 2>&1 | grep -E 'analysis\.(failed|completed|skipped|reconcile)|analysis (worker|queue) 오류|worker started|eviction|NOPERM' | tail -40
$DC logs --since 30m redis-api 2>&1 | grep -E 'analysis_(enqueue_failed|queue_error)' | tail

# 5) 큐·job 상태 (읽기 명령만, 마지막 인자는 analysisId)
$DC exec -T worker node --input-type=module -e '
import { Redis } from "ioredis"; const r=new Redis(process.env.REDIS_URL.trim(),{maxRetriesPerRequest:1}); const p="bull:analysis:",o={};
for (const k of ["wait","active","paused","delayed","prioritized","failed","completed"]) { const t=await r.type(p+k); o[k]=t==="list"?await r.llen(p+k):t==="zset"?await r.zcard(p+k):0; }
o.meta=await r.hgetall(p+"meta"); o.policy=(await r.info("memory")).match(/maxmemory_policy:(\S+)/)?.[1];
try { o.consumers=(await r.client("LIST")).split("\n").filter(l=>l.includes("YW5hbHlzaXM")).map(l=>l.match(/addr=\S+|name=\S+|cmd=\S+/g).join(" ")); } catch(e) { o.consumers=e.name; }
let c="0",key=null; do { const [n,ks]=await r.scan(c,"MATCH",p+"analysis_*_"+process.argv.at(-1),"COUNT",1000); c=n; key??=ks[0]??null; } while(c!=="0"&&!key);
if (key) o.job=await r.hmget(key,"processedOn","finishedOn","atm","failedReason");
console.log(JSON.stringify(o)); r.disconnect();' 6a90acc4-3709-41af-850d-594c6549ad02

# 6) Worker 가 보는 gateway 모드
$DC exec -T worker node -e 'fetch(process.env.AI_GATEWAY_URL+"/health").then(r=>r.json()).then(b=>console.log(b.runMode,b.provider))'
```

`consumers` 는 BullMQ 연결 이름(`YW5hbHlzaXM` = "analysis"의 base64)으로 찾는다. 비어 있으면 이름이 없거나 ACL이 `CLIENT LIST` 를 막은 것이다(추정).

## 고치는 방향 (추천, 사용자 실행)

목표는 오늘 회사 쪽을 웹과 같은 `mock` 으로 맞추는 것이다. 10-25 S-LIVE·카카오 녹화 때만 Vercel과 회사를 함께 `live` 로 바꾼다([[2026-10-24-freeze-priorities|10-24 우선순위]] §2-6·§3).

1. 위 1·2번 결과를 보고 옛 컨테이너나 다른 Worker가 있는지 확인한다.
2. 회사 셸에 `SOL_RUN_MODE` 가 export돼 있으면 `unset SOL_RUN_MODE` 한다. `infra/.env.company.local` 은 `SOL_RUN_MODE=mock`, `infra/.env.ai-gateway.local` 은 `AI_PROVIDER=mock` 으로 둔다.
3. 옛 Worker가 있으면 [회사 실행서](../../../infra/company/README.md) §6 순서대로 **옛 Worker를 먼저 정지**한다. 그다음 현재 compose로 세 서비스를 다시 만든다. `down`·`--remove-orphans`·volume 삭제는 하지 않는다.
4. 확인: 명령 2에서 세 컨테이너 모두 `SOL_RUN_MODE=mock` 이어야 한다. 운영 `/health/ready` 의 `ai` 는 `mock` 이어야 한다. 새 FX-02 분석이 `COMPLETED` 72로 끝나야 한다.

멈춘 run `6a90acc4` 는 Worker가 정상화되면 처리되고, 리허설 전 `pnpm demo:reset` 으로 정리된다.

## 관련 문서

- [[2026-10-24-freeze-priorities|10-24 freeze 전 우선순위]]
- [[10-DEPLOYMENT|10 배포]]
