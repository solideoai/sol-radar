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
개발·데모·프로덕션 모두 하나의 `infra/compose.yaml`. 실행 프로필은 Compose `--profile`과 env 묶음(`infra/env/<profile>.env.example`)의 조합이다. PostgreSQL·Redis·Qdrant·MinIO는 named volume. 이미지는 각각 버전 고정. GPU가 없으면 `demo` 프로필로 구동한다. GPU 호스트는 NVIDIA Container Toolkit 설치 후 `nvidia-smi` 확인.

## 실행 프로필 3단
|프로필|대상 환경|AI 동작|추가 서비스|필수 env (요지)|기동 명령|
|---|---|---|---|---|---|
|`demo`|노트북 1대, GPU 없음, Docker Desktop|`AI_PROVIDER=mock`: gateway가 fixture 기반 결정적 응답|`seed-demo` (1회 실행)|`DEMO_MODE=true`, `AI_PROVIDER=mock`, `KEV_ENABLED=false`, `AI_HOSTED_APPROVED=false`, `DEMO_SEED_PASSWORD`|`docker compose -f infra/compose.yaml --profile demo up -d --build`|
|`ai-local`|GPU 호스트 (사내 또는 클라우드 VM)|Qwen + Kev 실제 추론|`kev`, `qwen-runtime`|`AI_PROVIDER=local`, `KEV_ENABLED=true`, `KEV_BASE_URL=http://kev:8009`, `QWEN_BASE_URL`, `QWEN_MODEL`(03 §3.2 후보). kev 컨테이너는 `KEV_RUN=jaredpalmer/kev-4b@v1.0`|`docker compose -f infra/compose.yaml -f infra/compose.gpu.yaml --profile ai-local up -d --build`|
|`ai-hosted`|GPU 없는 환경에서 실모델이 필요할 때|hosted API 호출. **미검증, 비용 발생, 사용자 승인 필요**|없음|`AI_PROVIDER=hosted`, `AI_HOSTED_APPROVED=true`(승인 후만), `HOSTED_API_BASE_URL`, `HOSTED_API_KEY`(placeholder)|`docker compose -f infra/compose.yaml --profile ai-hosted up -d --build`|

- env 전체 표(`AI_TIMEOUT_MS`, `KEV_TIMEOUT_MS`, `KEV_QUESTION_SET`, `AI_PROMPT_VERSION` 등)는 [[03-AI-PIPELINE|03 AI 파이프라인]] §3이 원천이다. 여기 표는 프로필별로 달라지는 값만 적었다.
- `DEMO_MODE=true`면 공식 API connector를 비활성화하고 `fixtures/`만 읽는다. 적재되는 공고는 `is_demo=true`.
- seed 재적용은 `pnpm demo:reset`. 내부적으로 `docker compose -f infra/compose.yaml run --rm seed-demo`를 실행한다(migrate deploy + seed, 멱등). 적재 내용: 조직 2개(`org-01` SOL테크, `org-02` 격리 확인용), 계정 5개(`org-01`에 ADMIN/SALES/ANALYST/VIEWER 각 1, `org-02`에 VIEWER 1), 프로필 revision 2, fixture 20건 중 공고 19건 적재 + FX-12 1건 격리(title 누락 → `ingest_errors`). 공고는 공용 데이터라 조직 소유가 없다.
- 프로필 전환은 `.env` 교체 + 프로필 플래그만으로 끝난다. 코드 변경 없음 ([[16-DECISIONS|16 ADR]] ADR-008).
- `ai-hosted`는 사용자 명시 승인 후 `AI_HOSTED_APPROVED=true`로만 켠다 (ADR-010). 승인 플래그 없이 `hosted`를 지정하면 gateway가 기동을 거부한다. CI·테스트에서는 항상 `mock`.

> [!warning] 미검증 가정
> - `ai-hosted`: hosted 공급자, 요청·응답 포맷, 가격 모두 미확인. Kev README의 Modal 배포 스크립트도 비용이 든다. 승인(`AI_HOSTED_APPROVED=true`) 전에는 구현·호출하지 않는다. 검증 방법은 [[03-AI-PIPELINE|03 AI 파이프라인]] §5.8.
> - Kev-0.8B의 CPU 실행 가능성은 미검증. 데모는 이것에 의존하지 않는다. 검증 절차는 03.
> - Qwen 런타임(vLLM 등)과 모델 선택은 03의 후보 표를 따른다. 한 GPU에 Qwen과 Kev 동시 적재가 어려우면 순차 실행 또는 GPU 분리.

## Compose 서비스
|service|내부 포트|호스트 노출|상태 저장|프로필|
|---|---:|---|---|---|
|web|3000|3000|없음|기본|
|api|4000|4000|없음|기본|
|worker|-|-|없음|기본|
|postgres|5432|없음|pgdata|기본|
|redis|6379|없음|redisdata|기본|
|qdrant|6333|없음|qdrantdata|기본|
|minio|9000|없음|miniodata|기본|
|ai-gateway|8000|없음|model cache (선택)|기본 (`AI_PROVIDER`로 동작 결정)|
|seed-demo|-|-|없음|`demo` (migrate + seed 후 종료)|
|kev|8009|없음|model cache|`ai-local`|
|qwen-runtime|내부|없음|model cache|`ai-local`|
|nginx|80/443|80/443|certs|`production`|

## 데모 당일 기동 절차
전제: D-1에 이미지 빌드·pull과 전체 리허설을 끝냈다 ([[12-ROADMAP|12 로드맵]]). 당일은 네트워크 없이도 1~12가 끝나야 한다.

1. Docker Desktop 실행. `docker info`가 Server 정보를 출력하면 통과.
2. `cp infra/env/demo.env.example .env` 후 `POSTGRES_PASSWORD`, `JWT_SECRET`, `MINIO_ROOT_PASSWORD`, `DEMO_SEED_PASSWORD`를 placeholder가 아닌 값으로 교체. `pnpm check:env`가 "placeholder 0건"을 출력하면 통과.
3. `docker compose -f infra/compose.yaml --profile demo up -d --build`.
4. `docker compose -f infra/compose.yaml ps`: 기본 8개 서비스 `healthy`, `seed-demo`는 `exited (0)`.
5. `docker compose -f infra/compose.yaml logs seed-demo` 마지막 줄이 `seed: orgs=2 users=5 profileRevisions=2 bids=19 quarantined=1 reviews=2 isDemo=true` 형식인지 확인(사전 리뷰 2건은 FX-01, FX-03). 숫자가 다르면 중단.
6. `curl -s http://localhost:4000/health/ready`: `status` ok, `checks.db`·`checks.redis`·`checks.storage` ok, `checks.ai` `mock`. AI만 불가면 `status` degraded로 통과. 응답 형식은 [[05-API-SPEC|05 API]], `checks.ai` 의미는 [[14-OBSERVABILITY|14 관측성]].
7. API 스모크: 로그인 → `GET /api/v1/bids` 19건 → `POST /api/v1/bids/:id/analyses` 202 → poll이 5초 안에 `COMPLETED`.
8. 브라우저(폭 1440px, 줌 100%)에서 `/login` → DEMO 배지와 우상단 `AI: mock` 표시 확인 → 목록 19건, 격리 1건(FX-12)은 관리자 수집 현황에만 표시 → 상세 1건이 자격·점수·근거·Kev 영역까지 렌더.
9. 장애 대체 리허설 (아래 "장애 주입" 절): `docker compose -f infra/compose.yaml stop ai-gateway` → FX-01 재분석 → 상세에 `PARTIAL` 배너, 우상단 `AI: unavailable` → `docker compose -f infra/compose.yaml start ai-gateway` → `ps`에서 ai-gateway `healthy` 확인 → FX-01 재분석 `COMPLETED`.
10. 테넌트 격리 리허설: `org-02` VIEWER 토큰으로 `GET /api/v1/bids/{FX-01 id}/qualification-checks` → `404 NOT_FOUND`. 공고 자체(`GET /api/v1/bids/{FX-01 id}`)는 공용이라 200. 절차는 [[19-DEMO-SCENARIO|19 데모 시나리오]] S7.
11. 증거 저장: `docker compose -f infra/compose.yaml ps > docs/evidence/demo-day/compose-ps.txt`, 6의 응답을 `docs/evidence/demo-day/health-ready.json`으로 저장.
12. 리허설로 생긴 리뷰·알림 초기화: `pnpm demo:reset` (멱등, DEMO 데이터 재생성). 브라우저 탭 1개만 남긴다.

> [!tip] 심사 포인트
> 9번이 "AI가 죽어도 제품이 동작한다"의 증거다. 데모 중 실제로 ai-gateway를 내리고 PARTIAL 배너를 보여 준다.

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
Healthcheck, restart policy, log rotation, migration 선행, 비root 실행, Postgres 외부포트 기본 비공개, HTTPS reverse proxy(`production` 프로필), 볼륨 백업 및 복구 리허설. 서비스 시작 시 DB readiness 확인, 무한 재시작 대신 명확한 오류 출력.

## 관련 문서
- [[02-ARCHITECTURE|02 아키텍처]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[09-SECURITY|09 보안]]
- [[12-ROADMAP|12 로드맵]]
- [[14-OBSERVABILITY|14 관측성]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
