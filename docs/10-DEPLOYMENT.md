---
title: "10. Docker Compose 배포·실행 프로필"
doc: "10"
status: draft
tags:
  - sol-radar
  - ops
  - hackathon
updated: 2026-10-16
---

# 10. Docker Compose 배포·실행 프로필

## 원칙
DB·Auth는 Compose 밖의 **Supabase 클라우드 프로젝트**다(개발 환경, [[16-DECISIONS|16 ADR]] ADR-017). Compose는 그 둘레의 서비스만 띄운다: `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`, 그리고 선택으로 `web`. 데모·배포 실행 환경의 최종안(클라우드 그대로 / 로컬 Supabase CLI 대체 / 웹 배포처)은 **미결정**이다(16 미결정 표).

Compose 정의는 하나의 `infra/compose.yaml`이다. 실행 프로필은 Compose `--profile`과 env 묶음(`infra/env/<profile>.env.example` → `infra/.env`)의 조합이다. Redis·Qdrant·MinIO는 named volume. 이미지는 각각 버전(태그 또는 digest)을 고정한다. GPU가 없으면 `demo` 프로필로 구동한다. GPU 호스트는 NVIDIA Container Toolkit 설치 후 `nvidia-smi` 확인.

## 실행 프로필 3단
|프로필|대상 환경|AI 동작|추가 서비스|필수 env (요지)|기동 명령|
|---|---|---|---|---|---|
|`demo`|노트북 1대, GPU 없음, Docker Desktop, **인터넷 연결(Supabase 클라우드)**|`AI_PROVIDER=mock`: gateway가 fixture 기반 결정적 응답|없음 (seed는 Compose 서비스가 아니라 스크립트 `pnpm demo:reset`)|공통 env + `DEMO_MODE=true`, `AI_PROVIDER=mock`, `KEV_ENABLED=false`, `AI_HOSTED_APPROVED=false`, `DEMO_SEED_PASSWORD`(seed 전용)|`docker compose -f infra/compose.yaml --profile demo up -d --build`|
|`ai-local`|GPU 호스트 (사내 또는 클라우드 VM)|Qwen + Kev 실제 추론|`kev`, `qwen-runtime`|공통 env + `AI_PROVIDER=local`, `KEV_ENABLED=true`, `KEV_BASE_URL=http://kev:8009`, `QWEN_BASE_URL`, `QWEN_MODEL`(03 §3.2 후보). kev 컨테이너는 `KEV_RUN=jaredpalmer/kev-4b@v1.0`|`docker compose -f infra/compose.yaml -f infra/compose.gpu.yaml --profile ai-local up -d --build`|
|`ai-hosted`|GPU 없는 환경에서 실모델이 필요할 때|hosted API 호출. **미검증, 비용 발생, 사용자 승인 필요**|없음|공통 env + `AI_PROVIDER=hosted`, `AI_HOSTED_APPROVED=true`(승인 후만), `HOSTED_API_BASE_URL`, `HOSTED_API_KEY`(placeholder)|`docker compose -f infra/compose.yaml --profile ai-hosted up -d --build`|

- **공통 env**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`(공개 가능, 권한은 RLS가 정함), `SUPABASE_SERVICE_ROLE_KEY`(RLS를 무시하는 비밀. worker·seed 전용), `REDIS_URL`/`REDIS_PASSWORD`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`. `SUPABASE_DB_URL`은 마이그레이션 적용(`pnpm db:push`, 클라우드 DB를 바꾸므로 사용자 확인 뒤에만)과 상태 확인(`pnpm db:verify`)에만 쓴다. 자체 인증 서명 비밀이나 DB 컨테이너 비밀번호 변수는 없다(Auth·DB는 Supabase).
- env 전체 표(`AI_GATEWAY_URL`, `AI_TIMEOUT_MS`, `KEV_TIMEOUT_MS`, `KEV_QUESTION_SET`, `AI_PROMPT_VERSION` 등)는 [[03-AI-PIPELINE|03 AI 파이프라인]] §3이 원천이다. 여기 표는 프로필별로 달라지는 값만 적었다.
- `DEMO_MODE=true`면 공식 API connector를 비활성화하고 `fixtures/`만 읽는다. 적재되는 공고는 `is_demo=true`.
- 프로필 전환은 env 파일 교체 + 프로필 플래그만으로 끝난다. 코드 변경 없음 ([[16-DECISIONS|16 ADR]] ADR-008).
- `ai-hosted`는 사용자 명시 승인 후 `AI_HOSTED_APPROVED=true`로만 켠다 (ADR-010). 승인 플래그 없이 `hosted`를 지정하면 gateway가 기동을 거부한다. CI·테스트에서는 항상 `mock`.

### env 파일 위치
세 파일 모두 깃에서 제외한다. 값은 `.env.example`·`infra/env/*.env.example`의 키 이름을 보고 채운다.

|파일|읽는 쪽|담는 값 (요지)|
|---|---|---|
|`infra/.env`|`docker compose -f infra/compose.yaml`의 변수 치환. Compose는 `--project-directory`가 없으면 첫 `-f` 파일의 디렉터리(`infra/`)를 프로젝트 디렉터리로 삼고 거기서 `.env`를 찾는다(https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/, 2026-10-16 확인). 컨테이너에 넘기는 값은 `compose.yaml`의 `environment`·`env_file`이 정한다|`worker`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `AI_GATEWAY_URL`, `DEMO_MODE`. `redis`·`minio`: 각 비밀번호. `ai-gateway`: `AI_*`·`KEV_*`·`HOSTED_*`|
|`web/.env.local`|Next.js `web/`(템플릿 위치)|`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REDIS_URL`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `AI_GATEWAY_URL`, `DEMO_MODE`, `API_CURSOR_SECRET`(목록 커서 HMAC 키, 32자 이상, [[05-API-SPEC\|05 API]] §3). **`SUPABASE_SERVICE_ROLE_KEY`는 넣지 않는다**(요청 처리는 사용자 세션 + RLS)|
|루트 `.env.local`|`pnpm db:push`·`pnpm db:verify`(템플릿 `scripts/db-push.sh`·`scripts/db-verify.sh`가 `SUPABASE_DB_URL`을 여기서 읽는다), `pnpm demo:reset`|`SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_SEED_PASSWORD`|

- service role 키는 `NEXT_PUBLIC_` 변수·브라우저 번들·로그에 절대 넣지 않는다([[09-SECURITY|09 보안]]).
- `pnpm check:env`는 세 파일의 placeholder를 센다. `pnpm check:env`·`pnpm demo:reset`은 아직 없다. Phase 0·1에서 만든다([[12-ROADMAP|12 로드맵]]).

### seed
seed 적용·재적용은 스크립트 `pnpm demo:reset`이다(Compose 서비스가 아니다). 루트 `.env.local`의 service role 키로 Supabase 프로젝트에 seed를 넣고, 다시 돌려도 같은 상태가 된다(멱등). 마이그레이션은 적용하지 않는다. 스키마 적용은 `pnpm db:push`(사용자 확인 뒤에만)이고, seed 전에 `pnpm db:verify`로 미적용 마이그레이션이 없는지 본다.

적재 내용: 조직 2개(`org-01` SOL테크, `org-02` 격리 확인용), 계정 5개(Supabase Auth 계정 + `profiles` + `memberships`. `org-01`에 `sol_role` ADMIN/SALES/ANALYST/VIEWER 각 1, 그중 `admin@soltech.invalid`는 `org_role=owner`. `org-02`에 VIEWER 1), 프로필 revision 2, fixture 20건 중 공고 19건 적재 + FX-12 1건 격리(title 누락 → `ingest_errors`). 공고는 공용 데이터라 조직 소유가 없다. 계정 비밀번호는 `DEMO_SEED_PASSWORD`로만 정한다. 템플릿의 `pnpm db:seed`는 로컬 Supabase에서만 쓰는 시험 계정용이라 데모 seed로 쓰지 않는다.

> [!warning] 미검증 가정
> - `ai-hosted`: hosted 공급자, 요청·응답 포맷, 가격 모두 미확인. Kev README의 Modal 배포 스크립트도 비용이 든다. 승인(`AI_HOSTED_APPROVED=true`) 전에는 구현·호출하지 않는다. 검증 방법은 [[03-AI-PIPELINE|03 AI 파이프라인]] §5.8.
> - Kev-0.8B의 CPU 실행 가능성은 미검증. 데모는 이것에 의존하지 않는다. 검증 절차는 03.
> - Qwen 런타임(vLLM 등)과 모델 선택은 03의 후보 표를 따른다. 한 GPU에 Qwen과 Kev 동시 적재가 어려우면 순차 실행 또는 GPU 분리.
> - worker가 `import "server-only"`인 `web/server` 코드를 쓰려면 `node --conditions=react-server`(또는 같은 효과의 실행 방식)가 필요하다고 본다. Phase 0에서 검증한다([[02-ARCHITECTURE|02 아키텍처]]).

## Compose 서비스
|service|이미지|내부 포트|호스트 노출|상태 저장|프로필|
|---|---|---:|---|---|---|
|worker|`web/` 코드로 빌드, 진입점 `web/worker`|-|없음|없음|기본|
|redis|`redis:8.8.3-alpine`|6379|`127.0.0.1:6379` (web을 호스트에서 띄울 때)|redisdata|기본|
|qdrant|`qdrant/qdrant:v1.19.2-unprivileged`|6333|`127.0.0.1:6333` (같은 조건)|qdrantdata|기본|
|minio|`cgr.dev/chainguard/minio@sha256:2136d593beacf4461187035eca949fe49abd589d5079735025c711ca58fee0c8` (비root UID 65532)|9000|`127.0.0.1:9000` (같은 조건)|miniodata|기본|
|ai-gateway|`services/ai/` 빌드|8000|`127.0.0.1:8000` (같은 조건)|model cache (선택)|기본 (`AI_PROVIDER`로 동작 결정)|
|web|`web/` 빌드|3000|3000|없음|선택. 기본은 호스트에서 `pnpm -C web start`|
|kev|아래 Kev Dockerfile|8009|없음|model cache|`ai-local`|
|qwen-runtime|03 §3.2 후보|내부|없음|model cache|`ai-local`|

- `postgres`·`api`·`seed-demo` 서비스는 없다. DB·Auth는 Supabase, seed는 `pnpm demo:reset`이다.
- MinIO는 Docker Hub `minio/minio`가 404라(2026-10-16 확인) Chainguard 이미지를 digest로 고정한다(비root 65532, 검증됨).
- web을 호스트에서 띄우면 Next 서버가 redis·qdrant·minio·ai-gateway에 닿아야 하므로 이 네 서비스만 `127.0.0.1`에 포트를 연다(외부 인터페이스에는 열지 않는다). Compose `web`을 쓰면 호스트 노출은 필요 없다. 둘 중 무엇을 기본으로 할지는 Phase 0에서 확정한다.
- HTTPS reverse proxy와 웹 배포처는 데모·배포 실행 환경 결정(미결정, ADR-017) 뒤에 정한다.

## 데모 당일 기동 절차
전제: D-1에 이미지 빌드·pull, `pnpm -C web build`, 마이그레이션 적용(`pnpm db:push`, 사용자 확인 뒤), 전체 리허설을 끝냈다 ([[12-ROADMAP|12 로드맵]]). 당일에는 스키마를 바꾸지 않는다. 증거는 `docs/evidence/demo-day/YYYYMMDD-HHMM/`에 저장한다([[11-TESTING|11 테스트]]).

> [!warning] 데모 네트워크 의존 (미결정)
> DB·Auth가 Supabase 클라우드 프로젝트라 1~12 모두 인터넷 연결이 필요하다. 연결이 끊기면 로그인·조회·분석 저장이 멈춘다. 대체 경로(로컬 Supabase CLI `pnpm db:start`로 대체, 사전 녹화 영상)는 **미결정**이다([[16-DECISIONS|16 ADR]] 미결정 표). 정해지기 전까지 데모 장소의 네트워크를 미리 확인한다.

1. Docker Desktop 실행, 인터넷 연결 확인. `docker info`가 Server 정보를 출력하면 통과.
2. env 준비: `cp infra/env/demo.env.example infra/.env` 후 placeholder를 실제 값으로 교체. `web/.env.local`과 루트 `.env.local`도 채운다(위 "env 파일 위치" 표). `pnpm check:env`가 "placeholder 0건"을 출력하면 통과.
3. Supabase 프로젝트 접근·마이그레이션 상태 확인: `pnpm db:verify`가 `✓ DB 연결·마이그레이션 N개·RLS 활성화·화면 역할 권한·뷰·함수 확인`을 출력하면 통과. `미적용 마이그레이션: …` 또는 연결 오류면 중단한다(당일에 `pnpm db:push`로 고치지 않는다).
4. `docker compose -f infra/compose.yaml --profile demo up -d --build` → `docker compose -f infra/compose.yaml ps`에서 기본 5개 서비스(redis·minio·qdrant·ai-gateway·worker) `healthy`. `ps` 출력을 `compose-ps.txt`로 저장.
5. web 기동: `pnpm -C web start`(:3000). Compose `web`(선택)을 쓰면 4에서 함께 뜨고 `ps`에 `healthy`로 보인다.
6. seed: `pnpm demo:reset` 마지막 줄이 `seed: orgs=2 users=5 profileRevisions=2 bids=19 quarantined=1 reviews=2 isDemo=true` 형식인지 확인(사전 리뷰 2건은 FX-01, FX-03). 숫자가 다르면 중단.
7. `curl -s http://localhost:3000/health/ready`: `status` ok, `checks.db`(Supabase)·`checks.redis`·`checks.storage`(MinIO) ok, `checks.ai` `mock`. AI만 불가면 `status` degraded(HTTP 200)로 통과. db·redis·storage 중 하나라도 불가면 503 `status:"unavailable"`이므로 중단. 응답을 `health-ready.json`으로 저장. 응답 형식은 [[05-API-SPEC|05 API]], `checks.ai` 의미는 [[14-OBSERVABILITY|14 관측성]].
8. API 스모크: `org-01` 계정으로 Supabase Auth 비밀번호 로그인을 해 access token을 받는다(`supabase-js` `signInWithPassword` 또는 Auth REST `POST /auth/v1/token?grant_type=password`). `Authorization: Bearer <token>`으로 `GET /api/v1/bids` 19건 → `POST /api/v1/bids/:id/analyses` 202 → poll이 5초 안에 `COMPLETED`. Bearer 요청은 CSRF 헤더 검사 대상이 아니다([[05-API-SPEC|05 API]]).
9. 브라우저(폭 1440px, 줌 100%)에서 `/auth/login` → DEMO 배지와 우상단 `AI: mock` 표시 확인 → 목록 19건, 격리 1건(FX-12)은 관리자 수집 현황에만 표시 → 상세 1건이 자격·점수·근거·Kev 영역까지 렌더.
10. 장애 대체 리허설 (아래 "장애 주입" 절): `docker compose -f infra/compose.yaml stop ai-gateway` → FX-01 재분석 → 상세에 `PARTIAL` 배너, 우상단 `AI: unavailable` → `docker compose -f infra/compose.yaml start ai-gateway` → `ps`에서 ai-gateway `healthy` 확인 → FX-01 재분석 `COMPLETED`.
11. 테넌트 격리 리허설: `org-02` VIEWER(`viewer@other.invalid`)로 Supabase Auth 로그인해 받은 access token을 `Authorization: Bearer`로 붙여 `GET /api/v1/bids/{FX-01 id}/qualification-checks` → `404 NOT_FOUND`(RLS가 `org-01` 행을 보여 주지 않는다). 공고 자체(`GET /api/v1/bids/{FX-01 id}`)는 공용이라 200. 404 응답을 `isolation-404.json`으로 저장. 절차는 [[19-DEMO-SCENARIO|19 데모 시나리오]] S7.
12. 리허설로 생긴 리뷰·알림 초기화: `pnpm demo:reset` (멱등, DEMO 데이터 재생성). 브라우저 탭 1개만 남긴다.

> [!tip] 심사 포인트
> 10번이 "AI가 죽어도 제품이 동작한다"의 증거다. 데모 중 실제로 ai-gateway를 내리고 PARTIAL 배너를 보여 준다.

## 장애 주입 (데모 S6)
데모에서 쓰는 AI 장애 주입은 **(a) ai-gateway 컨테이너 중지** 하나다. [[02-ARCHITECTURE|02 아키텍처]] 장애 원칙 표의 "AI gateway 불가" 행과 같은 경로를 탄다.

|단계|명령|기대 결과|
|---|---|---|
|주입|`docker compose -f infra/compose.yaml stop ai-gateway`|Worker의 `/kev` 호출이 연결 거부로 즉시 실패(재시도 없음). FX-01 재분석이 1~2초 안에 `PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags`에 `AI_UNAVAILABLE`, 상세 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)"([[09-SECURITY\|09 보안]] 원문), 우상단 `AI: unavailable`, `/health/ready` `status: degraded`, `checks.ai: unavailable`|
|복구|`docker compose -f infra/compose.yaml start ai-gateway` → `docker compose -f infra/compose.yaml ps`에서 ai-gateway `healthy`|FX-01 재분석 `COMPLETED`, 우상단 `AI: mock`. 분석 1건으로는 circuit이 열리지 않으므로 대기 시간 없음|

후보 (b) `AI_FAULT_INJECT` env 토글은 컨테이너 재시작이 필요하고 (c) mock adapter의 장애 fixture는 "실제로 꺼졌다"는 인상이 약하다. 둘은 테스트([[11-TESTING|11 테스트]] 골든 시나리오 `G6`)에서만 쓴다.

## Kev 컨테이너 주의
> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev)
> - 소스에서 설치한다. `pip install kev`는 무관한 ORM 패키지다.
> - Python 3.12 또는 3.13 + uv.
> - README quickstart는 `--run jaredpalmer/kev-4b`(태그 없음, 최신 가중치). README "Kev 1.0" 절에 `--run jaredpalmer/kev-4b@v1.0`이 항상 같은 가중치를 로드한다고 명시돼 있다. 컨테이너 entrypoint는 고정 버전 명령을 쓴다:
>   `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0 --port 8009 --host 0.0.0.0`
> - 기본 바인딩이 127.0.0.1이므로 컨테이너에서는 `--host 0.0.0.0`이 필요하다. `--device cpu|cuda|mps|auto`(기본 `auto`). `KEV_API_KEY`를 주면 `Authorization: Bearer` 요구.
> - 보조 엔드포인트 `GET /v1/models`가 있어 healthcheck와 모델 식별자 기록에 쓴다.
> - 모델 4종: Kev-0.8B (Qwen3.5-0.8B-Base), Kev-4B (Qwen3.5-4B-Base, 권장 시작점), Kev-9B (Qwen3.5-9B-Base), Kev-27B (Qwen3.8-27B, 80GB GPU 필요). 릴리즈 "Kev 1.0": GitHub 태그 `kev-1.0`, Hub 리포 태그 `v1.0`. 라이선스 Apache-2.0.
> - API `POST /v1/systemone` (TypeSafe System One 호환), 질문 타입 `noul` / `choice` / `score`.
> - 모델 카드 `Languages: English`. 영어 외 언어는 잘 동작하지 않는 것으로 명시. 한국어 성능은 미측정 ([[16-DECISIONS|16 ADR]] 미결정 2번, ADR-012).

Dockerfile 스케치 (빌드 검증 전):
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir uv
WORKDIR /opt/kev
RUN git clone --depth 1 --branch kev-1.0 https://github.com/jaredpalmer/kev.git .
RUN uv sync --extra serve
ENV KEV_RUN=jaredpalmer/kev-4b@v1.0
EXPOSE 8009
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8009/v1/models')" || exit 1
CMD ["sh", "-c", "uv run --extra serve python -m kev.serve --run ${KEV_RUN} --port 8009 --host 0.0.0.0"]
```

> [!warning] 미검증 가정
> - CUDA 베이스 이미지가 필요한지(torch wheel에 CUDA 런타임 포함 여부)는 빌드 시 확인.
> - `uv sync --extra serve`가 lockfile 기준으로 재현되는지(`--frozen` 필요 여부) 빌드 시 확인.
> - 첫 기동 시 가중치 다운로드 시간은 미측정. `start-period` 600초는 추정값이며 `ai-local` 첫 기동에서 실측해 조정한다.
> - Kev-4B VRAM 요구량 미확인(README는 L40S/H100 권장만). `ai-local` 첫 기동에서 `nvidia-smi` 값을 기록한다.

## 샘플 GPU override 방향
```yaml
services:
  kev:
    profiles: [ai-local]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```
이것은 배포용 완성 Compose가 아닌 **요구 명세 예시**다. 실제 구현에서는 kev container entrypoint/모델 토큰/캐시 경로를 공식 repo 기준으로 구축하고 버전을 pin한다.

## 운영
- Compose 서비스: healthcheck, restart policy, log rotation, 비root 실행(MinIO UID 65532, qdrant `-unprivileged` 태그), 포트는 외부 인터페이스에 열지 않는다, 볼륨(redisdata·qdrantdata·miniodata) 백업 및 복구 리허설. 서비스 시작 시 Supabase·Redis readiness 확인, 무한 재시작 대신 명확한 오류 출력.
- 마이그레이션 선행: 새 마이그레이션은 `supabase/migrations/`에 새 파일로만 더하고, `pnpm db:push`(클라우드 DB를 바꾸므로 사용자 확인 뒤에만)로 적용한 뒤 `pnpm db:verify`로 확인하고 나서 worker·web을 새 코드로 띄운다. 타입 생성물은 `pnpm db:types`.
- DB 백업·복구는 Supabase가 관리한다. 플랜별 백업 주기·보존 기간·PITR 여부는 **미검증**이다. Supabase 대시보드에서 확인해 이 절에 기록한다.
- HTTPS reverse proxy·웹 배포처는 미결정(ADR-017 미결정 표).

## 관련 문서
- [[02-ARCHITECTURE|02 아키텍처]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[09-SECURITY|09 보안]]
- [[11-TESTING|11 테스트]]
- [[12-ROADMAP|12 로드맵]]
- [[14-OBSERVABILITY|14 관측성]]
- [[16-DECISIONS|16 ADR]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
