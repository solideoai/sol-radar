---
title: "web 단독 Vercel·회사 분석 런타임 조사와 최소 변경 계획"
status: review
tags:
  - sol-radar
  - ops
  - architecture
updated: 2026-10-22
---

# SOL RADAR 배포 검토 및 Implementation Plan

> 실행 담당자는 `superpowers:executing-plans`로 아래 단계를 순서대로 구현한다. 현재 요청은 조사와 계획 수립이며, 구현·운영 전환을 시작하지 않았다.

**Goal:** Vercel은 web만, 회사 서버는 기존 Redis·Next.js redis-api·worker·AI gateway·Bosun을 맡고 기존 GPU Qwen을 재사용한다.

**Architecture:** 기존 frontend → 인증된 HTTPS redis-api → BullMQ → worker → AI gateway 경로를 유지한다. 관리자 AI 상태 조회만 같은 HTTPS 경로로 옮기며 새 backend나 프록시를 만들지 않는다.

**Tech Stack:** Next.js, Supabase Auth/PostgreSQL/Storage, Redis/BullMQ, Python FastAPI, Docker Compose.

**Spec:** [사용자 확정 기준](../../polaris/specs/planned/2026-10-22-web-company-deployment.md).

## 1. 이번 조사 범위와 현재 배포

2026-10-22 00:25~00:31 KST 기준. Vercel 인증된 GET API, 환경변수 메타데이터와 비밀 아닌 설정값, 외부 HTTP/TLS·6379 TCP 연결, 코드와 기존 증거를 읽었다. 배포, env 수정, SSH 로그인, DB 쓰기, 컨테이너 실행, 모델 추론은 하지 않았다. 비밀값은 증거에 저장하지 않았다.

**현재 실제 운영 배포는 web 단독이 아니다.** Vercel API에서 다음을 확인했다. 사용자의 최종 목표와 현재 배포 상태를 구분한다.

- 프로젝트 `gwanghui97s-projects/sol-radar`, framework `services`, rootDirectory `null`(저장소 루트).
- 운영 배포 `dpl_6ZZZyhgF17v8VQ1QZPjkjfE6jDTH`, READY, 커밋 `3fded9990f56fb311be37ee39a558f5f7cb466f0`.
- 서비스 `web`(Next.js), `ai`(Python FastAPI), web → ai의 `AI_GATEWAY_URL` binding이 모두 존재한다.
- READY는 빌드/배포 상태이며 회사 분석 파이프라인의 정상 상태를 의미하지 않는다.

### Vercel Production 환경변수 확인

| 변수 | 확인 결과 | 판정 |
| --- | --- | --- |
| `SOL_DEPLOYMENT_ROLE` | `frontend` | 목표 역할과 일치 |
| `REDIS_API_BASE_URL` | `https://acropolissg.com/redis` | 목표 HTTPS 주소와 일치 |
| `REDIS_API_TOKEN` | sensitive로 등록됨 | 값·형식·회사 값과의 일치는 미검증 |
| `SOL_RUN_MODE` | `mock` | 현재 실제 Qwen 추론 모드가 아님 |
| `REDIS_API_TIMEOUT_MS` | `15000` | 업무 접수 제한. health 클라이언트는 별도 5초 |
| Storage bucket | `bid-documents`, `bid-parsed` | 코드 기본값과 일치 |
| `QWEN_BASE_URL`, `QWEN_MODEL`, `QWEN_API_KEY`, `AI_PROVIDER` | Production에 sensitive로 등록됨 | 회사 gateway 이전 뒤 Vercel에서 정리할 대상. 값은 읽지 못했으며 변경하지 않음 |
| `REDIS_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `G2B_*` | Production 목록에 없음 | 웹의 권한 분리 방향과 일치 |

현재 프로젝트 설정값과 배포 생성 때의 env 스냅샷은 구분해야 한다. 배포 시각보다 이른 변수 등록시각은 확인했지만 sensitive 값의 실행 시점 정합성을 별도 검증했다고 주장하지 않는다.

## 2. 503 조사 결과

| 확인 대상 | 직접 관측 | 해석/한계 |
| --- | --- | --- |
| 운영 `/health/live` | 200, `status=ok` | 웹 프로세스 응답 정상 |
| 운영 `/health/ready` | 503, 4개 checks 모두 unavailable | 회사 상태를 얻지 못했을 때도 이 응답을 사용 |
| 회사 `/redis/health` | HTTPS/TLS 성공, Nginx 502 HTML, 미인증 GET | **확인된 실패는 회사 redis-api 앞단의 upstream 응답**. 인증 handler의 정상 401까지 도달했음을 확인하지 못함 |
| 회사 `/sol-radar/healthz` | 404 | 과거 문서의 모델 라우터 경로 사용 가능 여부 미확인 |
| 회사 `/sol-radar/kev/v1/models` | 404 | 이 외부 경로에서 Bosun identity를 확인할 수 없음. 회사 내부 프로세스가 없다는 증거는 아님 |
| `acropolissg.com:6379` | 외부 TCP 연결 4초 timeout | 이 관측 지점에서는 연결되지 않음. 서버 방화벽·모든 IP의 비공개 설정을 증명하지는 않음 |

코드 흐름은 `web/app/_lib/application-health.ts` → `readRedisApiReadiness()` → `REDIS_API_BASE_URL + /health`다. `web/app/_lib/redis-api-client.ts:218`은 200/503 이외의 응답을 거절하고, 236행 catch는 원인과 무관하게 503/all-unavailable을 만든다. **회사 502는 이 응답을 만드는 충분한 실패 조건**이며, 기존 시험도 502 → 503 변환을 검증한다.

단, 회사 토큰 일치와 Vercel의 실제 outbound 요청 로그를 확보하지 못했으므로 이것을 유일한 원인이라고 단정하지 않는다. sensitive 토큰 형식 오류도 같은 catch에 들어갈 수 있다. 확인된 회사 502를 먼저 해소해야 이후 인증·종속 서비스 상태를 판정할 수 있다.

Nginx upstream의 구체적 원인(6380 listener 부재, 컨테이너 종료, 다른 upstream 주소/포트, upstream reset 등)은 아직 미확정이다. 회사 SSH 대상이 없어 내부 socket/container/Nginx error log를 조사하지 못했다. 기존 [회사 적용 기록](../evidence/first-bundle/20261022-production-deployment.md)도 접속 경로 부재와 회사 runtime 미적용을 명시한다. 설정 변경 없이 현장 조회가 다음 단계다.

**DB·Redis·Storage·AI 각각이 모두 장애라는 뜻은 아니다.** 같은 배포의 선행 기록은 Supabase migration 34개와 두 private Storage bucket 검증 성공, 사용자 로그인·DB 조회 성공을 담고 있다. 이는 기존 증거이며 이번에 DB/Storage 검증을 재실행하지 않았다.

Vercel runtime 로그는 1시간 요청이 보존기간 제한으로 거절됐고, 최근 5분의 `/health/ready` 검색은 기록 0건이었다. 현재 catch는 실패 사유를 기록하지 않아 로그만으로 upstream 502와 다른 실패를 구분하기 어렵다.

## 3. 구현된 기능과 추가 작업

| 항목 | 코드 근거 | 현황 |
| --- | --- | --- |
| 로그인·인증·조직/RLS·결과 조회 | `web/server/auth`, `web/server/supabase`, `web/app/api/v1` | 기존 구현 재사용. 별도 DB/backend 불필요 |
| 분석 접수 HTTPS 전달 | `web/app/api/v1/bids/[id]/analyses/route.ts`, `_lib/redis-api-client.ts` | frontend에서 접수만 회사 API에 전달. 조회는 기존 RLS 유지 |
| 회사 업무 API | `web/Dockerfile`, `infra/compose.company.yaml` | 같은 Next.js 코드·`redis-api` 역할. loopback6380·기존 external Redis network 사용. 실제 회사 기동 미확인 |
| 업무 API 보호 | `_lib/redis-api-auth.ts`, `redis-api-path.ts`, API 공통 `work-route.ts` | 서비스 토큰 timing-safe 비교/교체 토큰, 경로 allowlist, 사용자 JWT 검증·업무 권한/RLS. redirect 수동 거절, 크기·마감·멱등키 제한 |
| Worker → AI | `web/worker/analysis-runtime.ts`, `analysis-job.ts`, `web/server/analysis/analysis.service.ts` | BullMQ 소비 → 캐시 없으면 `/extract` → 조건부 `/kev` → `/explain` → 결과 저장. 전체 재작성 불필요 |
| Qwen/Bosun 어댑터 | `services/ai/src/sol_ai/adapters/{qwen,kev_local,local_setup}.py` | Qwen chat completions, Bosun `/v1/systemone`, 시작 시 registry 대조. KEV 호환 이름 유지 |
| readiness | `web/worker/dependency-health.ts`, `web/server/health/dependency-report.ts` | worker가 30초마다 Storage/AI 결과, TTL120초. mode/Supabase/bucket scope 불일치·만료는 unavailable |
| 관리자 AI 상세 상태 | `web/app/api/v1/admin/ai/status/route.ts` | frontend 분기 없이 `getAiStatus()`가 gateway를 직접 호출. web 단독 구조에 맞게 변경 필요 |
| 회사 배포 묶음 | `infra/compose.company.yaml` | redis-api만 정의. 로컬 compose의 worker/gateway Dockerfile을 재사용해 회사 배치를 보완해야 함 |
| 파인튜닝 Bosun | `services/decision`, `services/ai/models/registry.yaml` | 서빙·패키지 검증·학습 도구는 구현. active registry는 공개 Bosun 패키지이며, 사용자 학습본 반입·served identity는 미확인 |
| 첨부 전체 파이프라인 | `analysis-runtime.ts`의 `EMPTY_ATTACHMENT_READER`, AI `app.py` parser 경고 | 문서 소비자·실파서 연결은 남아 있음. 이번 배포 변경 범위와 분리해 기존 담당 작업으로 추적 |

Qwen은 직전 [실호출 증거](../evidence/phase-5/qwen-probe-20261021-2343.json)에서 `/models`와 간단한 JSON 추론 200이 확인됐다. 이번에는 모델 프로세스·설정·포트에 접근하거나 추론을 다시 실행하지 않았다. gateway `/health`는 시작 때의 모델 정보이며 매 요청마다 실제 모델 추론을 수행하지 않는다.

## 4. 최소 변경 계획

### 공통 제약과 검토 초점

- 위 스펙의 보존 조건을 모든 단계에 적용한다. 운영 적용은 이 계획의 승인과 회사 inventory 확보 뒤에만 한다.
- 신규 시험은 실제 실패/경계에 한정한다: 관리자 권한·정확한 GET 경로, 모델 상태 DTO 불일치/기한 초과, readiness 502 원인 기록, worker scope/TTL, web-only 구성의 AI 재포함 방지. 기존 coverage가 있으면 시험을 중복 추가하지 않는다.
- `web/` 코드 구현 전에 설치된 `web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`를 읽는다.

### Task 1: 회사 내부 읽기 전용 조사

**변경 파일:** 없음. **입력:** 실제 SSH 사용자·host·port 또는 내부 터미널. **산출:** socket/container/network, 안전하게 가린 upstream 오류, token 일치 여부, gateway/Bosun 접근 경로·패키지 identity.

- [ ] 아래 읽기 전용 명령으로 실제 이름/포트를 확인한다. placeholder를 추정해서 실행하지 않는다.

```bash
ssh -p <확인한_포트> <사용자@회사서버>
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
ss -lnt
docker inspect <기존_Redis_컨테이너> --format '{{json .NetworkSettings.Networks}}'
curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:6380/health
```

- [ ] Nginx의 현재 `/redis/` upstream과 해당 시각 error log를 읽는다. 전체 환경·원시 로그·프로세스 인자를 공개하지 않는다. reload/restart하지 않는다.
- [ ] 기존 Redis 자격을 서버 안에서만 로드해 PING, `sol-radar:dependency-health` GET/PTTL과 scope를 읽는다. 토큰/접속 문자열을 셸 인자나 출력에 넣지 않는다. health를 위해 worker를 새로 실행하지 않는다(worker는 일정/큐/Storage 쓰기를 수행한다).
- [ ] 회사 토큰으로 `/redis/health` 상태와 schema를 확인한다. Vercel sensitive 토큰은 값을 역추출하지 않고 기존 공유 자격의 출처/설정 이력을 대조한다. 불일치가 확인돼도 이번 단계에서 교체하지 않는다.
- [ ] Bosun의 기존 프로세스·device·패키지 manifest·`/v1/models`를 읽어 학습본임을 확인한다. 현재 외부 KEV 경로는404이므로 작동한다고 가정하지 않는다.

**완료 기준:** 502를 발생시킨 정확한 upstream 자원과 실패 이유를 식별. 접근이 없으면 그 한계를 유지하고 배포하지 않는다.

### Task 2: 관리자 AI 상태의 회사 API 전달과 readiness 진단

**Modify:** `web/app/api/v1/admin/ai/status/route.ts`, `web/app/_lib/redis-api-path.ts`, `web/app/_lib/redis-api-client.ts`, `web/app/_lib/redis-api-contract.ts`.
**Test:** 기존 `web/app/_lib/redis-api-client.test.ts`, `web/app/api/v1/redis-gateway-contract.test.ts`, `web/app/_lib/deployment-role.test.ts`.

**Interfaces:** 기존 `relayRedisApi(request, targetPath, overrides)`에 정확한 `GET /api/v1/admin/ai/status`만 추가한다. 응답은 이미 배럴로 노출된 `@/server/health`의 `aiStatusSchema`를 사용한다. 회사 runtime에서는 기존 `getAiStatus(role, currentRunMode)`를 그대로 호출한다.

- [ ] frontend ADMIN 요청에 한해서 회사 API로 GET을 보낸다. 서비스 토큰+사용자 JWT, 회사 측 ADMIN 검증을 유지한다. GET에 body/멱등키를 새로 만들지 않는다. 일반 GET 프록시로 넓히지 않는다.
- [ ] 회사 redis-api의 `AI_GATEWAY_URL`은 worker와 같은 사설 gateway를 가리킨다. Vercel에서 직접 gateway/Qwen/Bosun에 연결하지 않는다. 모델 키는 redis-api에 넣지 않는다.
- [ ] 기존 200의 `gateway.healthy=false`, 401/403, 422 `HOSTED_NOT_APPROVED` 의미와 DTO를 보존한다. 회사 API 자체가 안 되면503을 반환한다. 내부 주소 표시는 기존 관리자 DTO의 정제 규칙을 유지한다.
- [ ] `readRedisApiReadiness()`에 안전한 서버 진단을 추가한다. `CONFIG_INVALID`, `UPSTREAM_HTTP`, `TIMEOUT`, `NETWORK`, `INVALID_RESPONSE`, `INCONSISTENT_RESPONSE`와 HTTP 상태·elapsedMs·요청 추적값만 기록한다. 토큰·URL·응답 원문·원시 exception message를 기록하지 않는다. 공개 readiness 계약과 503/200-degraded 기준은 유지한다.
- [ ] 핵심 시험: ADMIN의 회사 GET 성공·non-ADMIN403·미인증401·다른 GET 경로 거절, schema 오류/timeout503, upstream502 진단 분류와 비밀 미포함. 기존 POST 재시도·멱등 처리도 그대로 통과해야 한다.

**영향:** 관리자 상태가 실제 worker가 쓰는 회사 gateway를 나타낸다. readiness의 공개 응답은 같고 운영 로그에서 실패 구간을 알 수 있다. 새로운 HTTP 서버는 없다.

### Task 3: 회사 런타임 구성과 web 단독 배포 파일

**Modify:** `infra/compose.company.yaml`, `infra/env/redis-api.env.example`, `vercel.json`.
**Create:** `infra/env/company.env.example`(실값 없는 회사 gateway/worker 입력 예시).
**Conditional modify:** `services/ai/models/registry.yaml`은 실제 파인튜닝 Bosun identity를 확보한 경우에만 새 항목을 추가. Qwen 항목은 유지한다.
**Docs:** `docs/02-ARCHITECTURE.md`, `docs/10-DEPLOYMENT.md`, `docs/16-DECISIONS.md`, `docs/CLAUDE.md`, `docs/00-README.md`, `web/.env.example`의 이전 AI binding 설명을 이 스펙으로 동기화. 병행 작업과 diff를 합친다.

- [ ] 회사 compose에 기존 `services/ai/Dockerfile`, `web/worker/Dockerfile`을 재사용한 gateway/worker 정의를 추가한다. 기존 Redis external network·인증을 사용하고 새 Redis/Qdrant/Nginx를 올리지 않는다. 각 프로세스에 필요한 변수만 전달한다.
- [ ] Bosun 연결 방식은 Task1의 실제 배치를 따른다. gateway URL 검사는 **HTTPS 또는 같은 namespace의 loopback HTTP만** 허용한다. `http://host.docker.internal:8009`나 Docker DNS 이름을 임의로 넣으면 보안 검사를 통과하지 않는다. 기존 HTTPS 경로가 없으면 기존 모델을 건드리지 않고 가능한 동일 호스트/namespace 배치를 먼저 검토·보고한다. 추측한 주소를 배포 파일에 고정하지 않는다.
- [ ] `vercel.json`의 `services.ai`, web `bindings`만 제거하고 web와 catch-all rewrite는 유지한다. 현재 프로젝트 루트/Services 설정을 유지하면서 **실행 서비스는 web 하나**로 만드는 것이 가장 작은 변경이다. 별도의 Vercel 프로젝트를 만들지 않는다. [공식 Services 문서](https://vercel.com/docs/services)의 단일 서비스 구성을 따른다.
- [ ] Qwen 변수와 AI provider를 회사 gateway에만 공급한다. `SOL_RUN_MODE`는 web/API/worker/gateway에 맞춘다. 실제 추론 확인은 fixture를 우선 사용할 수 있으나 모드 전환은 별도 보고 후 실행한다. Bosun을 검증하지 않고 임의로 활성화/비활성화해 완료 처리하지 않는다.
- [ ] 설정 검증은 `docker compose ... config --quiet`, Vercel 설정의 서비스 목록/바인딩 부재 검사와 빌드로 수행한다. 기존 서비스/포트/volume의 추가·삭제·교체가 없는지 diff를 확인한다.

**영향:** Vercel AI 함수가 새 배포에서 사라지고 회사 app runtime이 분석을 수행한다. 기존 모델·Redis·Nginx 변경은 포함하지 않는다. 회사 기존 container와 이름/포트가 겹치면 중단하고 보고한다.

### Task 4: 검증 후 운영 적용 보고

- [ ] 개발 변경은 `pnpm verify:changed`, 통합은 `pnpm verify`를 한 번 실행한다. 변경 흐름의 관리자 상태·분석 접수/조회 시험을 확인한다.
- [ ] 운영 적용 전에 실제 자원명, SHA, env **이름만**, 실행할 명령, 기존 container 보존 여부, live 작업/과금/Storage probe 쓰기 영향을 보고한다. 다음 명령은 **승인 후 새 서비스가 필요하다고 확인된 경우의 예시**이며 이번에 실행하지 않았다.

```bash
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml config --quiet
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml build redis-api ai-gateway worker
docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml up -d --no-deps --no-recreate redis-api ai-gateway worker
```

`--no-recreate`는 기존 container를 보존한다. 기존에 다른 버전이 실행 중이면 이 명령으로 교체하지 않고 별도 보고한다. `down`, `--remove-orphans`, Nginx reload, 기존 모델 restart, Redis 재생성은 수행하지 않는다. 위 명령은 Task3에서 회사 배치를 확정하기 전에는 실행할 수 없다.

- [ ] 회사 HTTPS 미인증401·정상 token readiness, Redis 사설 접속, worker 보고TTL/scope, gateway 및 Bosun identity를 확인한 다음 Vercel web-only를 배포한다.
- [ ] 배포 명령 후보: `pnpm dlx vercel@65.0.0 --prod --scope gwanghui97s-projects`(해당 프로젝트에 연결된 검증 SHA checkout에서만). `QWEN_*`·`AI_PROVIDER`의 Vercel Production 변수 제거는 회사 gateway 설정이 준비된 뒤 별도 변경 목록으로 보고한다. sensitive 키를 삭제한 뒤 다시 읽어 복구할 수 있다고 가정하지 않는다.
- [ ] 승인된 공고1건으로 접수202→worker 완료→사용자 RLS 조회, 관리자 모델상태, `/health/ready`를 검증한다. 캐시 재사용만으로 Qwen/Bosun 실호출 성공을 주장하지 않는다. 모델 health만 green이면 실추론 검증은 별도로 남긴다.

**운영 영향:** worker 시작은 큐 소비·수집 일정·Storage health 파일 쓰기/삭제를 발생시킬 수 있다. 먼저 실행 모드와 대기 job을 조회한다. 롤백은 이전 web release/새로 띄운 app runtime에 한정하고 DB reset·기존 모델 변경을 포함하지 않는다.

## 5. 이번 검증과 남은 정보

기존 시험만 실행했다:

```bash
pnpm -C web exec vitest run app/_lib/deployment-role.test.ts app/_lib/redis-api-client.test.ts app/api/v1/redis-gateway-contract.test.ts worker/dependency-health.test.ts
```

**4개 파일·54개 시험 통과**. 코드 변경이 없는 조사이므로 전체 verify·빌드·E2E·실분석은 재실행하지 않았다. 다른 세션의 미커밋 코드 변경은 이 결과의 배포 승인이 아니다.

이번에 추가한 파일은 이 계획, Polaris 스펙, 안전하게 정리한 JSON 증거뿐이다. 기존 코드·vercel.json·Compose·운영 설정은 수정하지 않았다. 회사 SSH 사용자/host/port 또는 내부 터미널이 확보돼야 Nginx502의 최종 원인, 공유 토큰 일치, Redis 실제 listen/방화벽, worker/AI gateway 실행 여부, Bosun 학습본/연결 경로를 확정할 수 있다.

## 관련 문서

- [확정 기준](../../polaris/specs/planned/2026-10-22-web-company-deployment.md)
- [이번 조사 증거](../evidence/deployment/20261022-readonly-review.json)
- [직전 운영 적용 기록](../evidence/first-bundle/20261022-production-deployment.md)
- [[10-DEPLOYMENT|기존 배포 문서]]
- [[16-DECISIONS|기존 결정 이력]]
