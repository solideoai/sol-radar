---
title: "Phase 0 구현 계획 — 실행 환경·실행 모드·AI gateway 골격·worker·health·공고 fixture"
status: final
tags:
  - sol-radar
  - plan
  - ops
updated: 2026-10-19
---

# Phase 0 실행 환경·공고 fixture Implementation Plan

> [!success] 보관 (2026-10-19)
> 이 설계안은 정본에 반영됐다(근거: main 병합 `1b824c8`, 최종 리뷰 반영 `88afb79`, Compose 프로젝트 이름 `9b2bdf1`, 정본 반영 `67877a1`, [[16-DECISIONS|16 ADR]] ADR-024 "제안(구현됨)", [[PROGRESS|진행 상황]] Phase 0 행·작업 로그 2026-10-19 "Phase 0" 행, 증거 `evidence/phase-0/c0-integration-20261019.md`). 수정하지 않고 보관한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose -f infra/compose.yaml --profile demo up -d --build` 한 번으로 redis·minio·qdrant·ai-gateway·worker 다섯 서비스가 healthy가 되고, 호스트의 web이 `/health/live`·`/health/ready`로 Supabase·Redis·MinIO·AI 상태를 알린다. `pnpm check:env`와 gateway가 실행 모드 모순 env를 거부한다. Phase 1 seed와 Phase 2 수집이 쓸 공고 fixture(`FX-01`~`FX-20`)와 그 검증기를 준비한다.

**Architecture:** 실행 모드 규칙은 `infra/run-modes.json` 한 파일이 원천이고, `scripts/check-env.mjs`(Node)와 gateway(`services/ai`, Python)가 같은 파일을 읽는다. web은 기존 `web/server/<도메인>` 구조에 `health` 도메인을 더하고, worker는 `web/worker`에서 `node --conditions=react-server --import tsx`로 `web/server` 코드를 그대로 불러 BullMQ `system` 큐의 `ping` job을 처리한다. Compose는 web을 띄우지 않고(호스트 `pnpm -C web start`), 서비스마다 필요한 env만 `environment`로 넘긴다.

**Tech Stack:** Next.js 16.4·React 19·Supabase(`@supabase/supabase-js`)·BullMQ·ioredis·tsx·Vitest / Python 3.12·uv·FastAPI·uvicorn·pydantic-settings·pytest·ruff / Docker Compose v2 / Node 22 `node:test`·`util.parseEnv`·`yaml`.

**Spec:** 별도 스펙 문서 없이 정본을 근거로 한다(황금 규칙 1). [[12-ROADMAP|12 로드맵]] Phase 0 행·P0-0·P0-1, [[11-TESTING|11 테스트]] §2·§3.2 V2-01·§3.3·§4 Phase 0 행·§6, [[10-DEPLOYMENT|10 배포]] 실행 모드·프로필·env 표·서비스 표·기동 절차, [[05-API-SPEC|05 API]] §1 health 행, [[14-OBSERVABILITY|14 관측]] health 절, [[03-AI-PIPELINE|03 AI 파이프라인]] §2 엔드포인트·§3 env 표, [[07-DATA-PIPELINE|07 수집]] fixture 절(07:300~430), [[08-SCORING|08 스코어링]] §6~7 worked example, [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] 절대 규칙·증거 저장, [[16-DECISIONS|16 ADR]] ADR-010·017·020·미결정 9번.

## Global Constraints

- 스택은 ADR-017. 별도 API 서버·ORM·Supabase Storage·Supabase Queues·pgvector를 들이지 않는다. worker 진입점은 `web/worker`다.
- 이번 Phase에는 마이그레이션을 만들지 않는다(SOL 스키마는 Phase 1). `pnpm db:push`·`pnpm demo:reset`은 실행하지 않는다.
- 자동 시험은 모두 `SOL_RUN_MODE=mock`으로 돈다. 공공 API·회사 GPU·hosted 모델을 부르지 않는다. hosted 클라이언트 코드는 만들지 않는다(ADR-010).
- 실행 모드: `SOL_RUN_MODE=live|fixture|mock`, 미지정이면 `mock`. 모드가 기본값을 정한다: `live` → `DEMO_MODE=false`·`AI_PROVIDER=local`·`KEV_ENABLED=true`, `fixture` → `true`·`local`·`true`, `mock` → `true`·`mock`·`true`(mock adapter가 응답). 모순이면 기동 거부하고 **모순된 키 이름만** 알린다. 값을 조용히 바꾸지 않는다.
- 비밀값(`SUPABASE_SERVICE_ROLE_KEY`·서비스키 4개 `G2B_*_SERVICE_KEY`(ADR-022)·`REDIS_PASSWORD`·`MINIO_ROOT_PASSWORD`·`KEV_API_KEY`·`HOSTED_API_KEY`)은 표준 출력·오류·로그·증거·`NEXT_PUBLIC_` 변수에 넣지 않는다. `web/.env.local`에는 `SUPABASE_SERVICE_ROLE_KEY`·`G2B_*_SERVICE_KEY`를 두지 않는다(10:54).
- `.env*` 실제 파일은 사람이 만든다. 에이전트는 읽거나 출력하지 않는다. placeholder 토큰은 `CHANGE_ME` 하나로 통일하고, `minioadmin`은 금지 기본값으로 placeholder와 같게 센다(09:200).
- 이미지 고정: `redis:8.8.3-alpine`, `qdrant/qdrant:v1.19.2-unprivileged`, `cgr.dev/chainguard/minio@sha256:2136d593beacf4461187035eca949fe49abd589d5079735025c711ca58fee0c8`(비root 65532). 호스트 포트는 `127.0.0.1:6380`(기본, `REDIS_HOST_PORT`)·`127.0.0.1:6333`·`127.0.0.1:9000`·`127.0.0.1:8000`만 연다. `0.0.0.0` 바인딩 금지.
- named volume: `redisdata`·`qdrantdata`·`miniodata`. 무한 재시작 대신 명확한 오류 출력(10:301).
- fixture는 모두 가상이다. `isDemo: true`, URL은 `https://demo.sol-radar.invalid/notices/FX-xx`, 이메일은 `.invalid` 도메인만, 실명·전화·실존 기업 실적 0건. 날짜 필드는 `+Nd`/`-Nd` 상대 표기(ADR-014).
- 웹 코드는 `web/node_modules/next/dist/docs/`의 Route Handler 안내를 먼저 읽는다. 도메인은 배럴(`@/server/<도메인>`)로만 부르고, `../` 대신 `@/`를 쓴다. `eslint-disable`·`any`·`@ts-ignore`·`.skip`·`.only` 금지.
- 커밋은 메인 세션이 작업마다 한다. 형식 `타입: 한국어 설명`(50자 이내), 파일을 지정해 스테이징한다. 작업자는 git 상태를 바꾸지 않는다.
- `.claude/settings.json`의 작업 폴더 변경(사용자가 `.github/**`·`web/lodestar.config.*` 편집 금지를 잠시 뺀 것)은 **스테이징·커밋하지 않는다.** 게이트 시험은 스테이징본을 본다. Task 2·3이 끝나면 사용자가 deny 줄을 되돌린다.

## 결정 (추천안으로 작성. 사용자 승인으로 확정)

정본이 "Phase 0에서 정한다"고 남긴 것과 문서끼리 어긋난 것이다. 확정되면 Task 9가 16 ADR에 "제안" 상태로 올린다.

| # | 결정 | 추천안 (이 계획의 전제) | 대안 | 근거 |
|---|---|---|---|---|
| D1 | web 실행 위치 | 호스트 `pnpm -C web start`. Compose에 `web` 없음 | Compose `web` | 10:167·173 |
| D2 | worker 실행 방식(미결정 9) | `node --conditions=react-server --import tsx worker/main.ts` | esbuild 번들 후 `node` | 16:57·81, 11:158 |
| D3 | worker health | 준비 확인 뒤 10초마다 heartbeat 파일 갱신, Compose healthcheck가 30초 안 갱신을 확인 | Redis 키 TTL | 14:37 |
| D4 | `AI_PROVIDER=hosted` 허용 모드 | `live`·`fixture`에서만, `AI_HOSTED_APPROVED=true`일 때만 | hosted 금지 | 정본 미정(03 모드 표에 hosted 없음) |
| D5 | 서비스키 4개(`G2B_*_SERVICE_KEY`, ADR-022) 필수 범위 | `live`에서만 4개 모두 필수. demo env 예시에는 줄을 두지 않음 | 모든 모드 필수 | 10:27·53·81 vs 11:176 |
| D6 | mock의 `KEV_ENABLED` | `true`(mock adapter) | `false` | 10:37·16:42 vs `ai-gateway-developer`·`infra-developer` 정의 |
| D7 | 실행 모드 규칙 원천 | `infra/run-modes.json` 하나. gateway 이미지는 저장소 루트를 빌드 컨텍스트로 써서 이 파일(향후 `fixtures/`)을 복사 | 언어별 복제 | 같은 규칙 두 구현의 표류 방지 |
| D8 | `infra/compose.gpu.yaml`·`ai-local` 실기동 | P0-0(회사 GPU 준비) 때 작성·검증. Phase 0은 `infra/env/ai-local.env.example`과 터널 절차만 | 지금 예시로 작성 | 10:298 "요구 명세 예시", GPU 없이 검증 불가 |
| D9 | 첨부 샘플 `fixtures/docs/` | Phase 2(파서와 함께). Phase 0 추출의 인용은 공고 본문(`content`)만 가리킴 | 지금 PDF·HWP 작성 | `/parse`는 Phase 2(P0-3) |
| D10 | mock Kev·골든 범위 | Phase 0은 Kev 4건(07:404-409 특수값)·골든 3건(08 worked example). 나머지 Kev 16건·골든 17건은 Phase 4 골든 확정 뒤 | 20건 전부 지금 | Kev `fit` 공식이 규칙 점수에 기대고, 점수는 Phase 4에서 고정(07:359) |
| D11 | 추출 fixture 수 | 19건(격리되는 `FX-12`는 revision이 없어 추출 없음) | 20건 | 04:373 "20" vs 04:369 |
| D12 | `FX-20` 배치 | `SEED`(429 두 번 뒤 200) | `LIVE` | 07:382·418 vs 19:44 |
| D13 | CI Python | `.github/workflows/ci.yml` project job에 `astral-sh/setup-uv`(SHA 고정) 단계를 `ai` 프로젝트일 때만 추가 | 설치 스크립트 | 사용자가 `.github/` 편집 허용 |
| D14 | worker 계층 | `web/lodestar.config.ts`에 `worker` 층(`worker/**` → domain·infra·shared) 추가 | 규칙 밖 방치 | 사용자가 lodestar 설정 편집 허용 |
| D15 | 템플릿 정리 범위(12:22) | Phase 0에서는 지우지 않는다. `tasks`는 유지(04:403), 옛 `/memos` 리다이렉트·`[slug]` 경로·팀 화면·`/admin` → `/ops`는 Phase 3 N1 앱 셸(조직 주소 없는 경로)에서 함께 정리 | 지금 삭제 | N1이 같은 경로를 다시 짜므로 두 번 손대지 않는다 |

## Review Focus

자동 시험이 직접 다루지 않으면 사람이 먼저 겪을 실패 다섯 가지다. 각 줄의 시험은 담당 작업에 들어 있다.

1. **비밀값이 출력에 섞이는 경우**: `check:env`·gateway 기동 거부 메시지에 키 이름만 나오고 값은 나오지 않아야 한다. → Task 1 `CLI 출력에 비밀값이 없다`, Task 2 `test_refusal_does_not_print_values`.
2. **의존 서비스가 응답 없이 멈춘 경우**(방화벽·잘못된 주소): `/health/ready`가 매달리지 않고 약 2초 안에 해당 항목을 `unavailable`로 돌려야 한다. → Task 4 `멈춘 검사는 시간 제한 뒤 unavailable`.
3. **대소문자·공백이 섞인 모드 값**(`LIVE`, ` mock`): 고쳐 읽지 않고 `SOL_RUN_MODE`를 모순으로 알려야 한다. → Task 1·2 표 시험.
4. **env가 비어 있는 web**(Supabase 미설정·`REDIS_URL` 없음): 500 예외가 아니라 503 + 해당 `checks` 항목 `unavailable`이어야 한다. → Task 4 `설정이 없으면 503`.
5. **fixture에 실제처럼 보이는 개인정보·URL**: `.invalid` 밖 이메일·전화번호 패턴·`*.invalid` 밖 `sourceUrl`이 들어오면 검증기가 막아야 한다. → Task 6 변형 시험.

## 작업 순서와 병렬

```text
물결 A:  Task 1 (check:env)        ‖ Task 3 (worker)
물결 B:  Task 2 (gateway, T1 뒤)   ‖ Task 4 (health, T3 뒤) ‖ Task 6 (fixture E1, T1 뒤)
물결 C:  Task 5 (Compose, T2·T3 뒤) ‖ Task 7 (fixture E2, T6 뒤)
물결 D:  Task 8 (통합 기동·증거, T4·T5 뒤) → Task 9 (정본·PROGRESS, T7·T8 뒤)
```

같은 파일은 한 작업만 고친다: 루트 `package.json`·`pnpm-lock.yaml`은 Task 1 → Task 6 순서, `web/package.json`·`web/pnpm-lock.yaml`은 Task 3만, `verify.config.json`·`.github/workflows/ci.yml`은 Task 2만, `web/lodestar.config.ts`는 Task 3만, `web/.env.example`·`web/proxy.ts`는 Task 4만, `infra/**`(run-modes.json 제외)·`web/worker/Dockerfile*`은 Task 5만, `scripts/bids/**`·`scripts/demo-bids.test.mjs`는 Task 6 → Task 7 순서.

| 작업 | 담당 에이전트 | 검토 |
|---|---|---|
| 1 | `infra-developer` | 새 에이전트 리뷰 + `security-auditor`(비밀 출력) |
| 2 | `ai-gateway-developer` (시험은 `test-ai`) | 새 에이전트 리뷰 |
| 3 | `pipeline-developer` | 새 에이전트 리뷰 |
| 4 | `backend-developer` (시험은 `test-server`) | 새 에이전트 리뷰 |
| 5 | `infra-developer` | 새 에이전트 리뷰 + `security-auditor`(포트·비밀) |
| 6·7 | 검증기 `backend-developer`, 데이터 `fixture-author` | 새 에이전트 리뷰(숫자 교차) |
| 8 | 메인 세션 (사용자 env 필요) | `demo-verifier` 기동 1~2·4·5·7 단계 재확인 |
| 9 | `docs-keeper` | 메인 세션 diff 확인 |

---

### Task 1: 실행 모드 규칙과 `pnpm check:env` (P0-1, V2-01 Node 쪽)

**Files:**
- Create: `infra/run-modes.json`
- Create: `scripts/run-mode.mjs`
- Create: `scripts/check-env.mjs`
- Test: `scripts/check-env.test.mjs`
- Modify: `package.json` (scripts에 `"check:env": "node scripts/check-env.mjs"`)

**Interfaces:**
- Produces `infra/run-modes.json` (내용 그대로):

```json
{
  "schemaVersion": "sol-run-modes/v1",
  "default": "mock",
  "modes": {
    "live": {
      "DEMO_MODE": ["false"],
      "AI_PROVIDER": ["local", "hosted"],
      "KEV_ENABLED": ["true"],
      "forbidden": { "AI_FALLBACK_TO_MOCK": "true", "KEV_ALLOW_KO_STATE": "true" },
      "requiredSecrets": ["G2B_BID_NOTICE_SERVICE_KEY", "G2B_PRE_SPEC_SERVICE_KEY", "G2B_ORDER_PLAN_SERVICE_KEY", "G2B_INDUSTRY_MASTER_SERVICE_KEY"]
    },
    "fixture": {
      "DEMO_MODE": ["true"],
      "AI_PROVIDER": ["local", "hosted"],
      "KEV_ENABLED": ["true"],
      "forbidden": {},
      "requiredSecrets": []
    },
    "mock": {
      "DEMO_MODE": ["true"],
      "AI_PROVIDER": ["mock"],
      "KEV_ENABLED": ["true"],
      "forbidden": {},
      "requiredSecrets": []
    }
  },
  "hostedApproval": { "provider": "hosted", "key": "AI_HOSTED_APPROVED", "value": "true" }
}
```

  배열의 첫 값이 그 모드의 기본값이다. 값 비교는 정확히 같은 문자열이다(대소문자·공백을 고치지 않는다).
- Produces `resolveRunMode(env: Record<string, string | undefined>, rules?: RunModeRules) → { mode: "live" | "fixture" | "mock" | null, effective: { DEMO_MODE: string, AI_PROVIDER: string, KEV_ENABLED: string } | null, violations: Array<{ key: string, reason: "UNKNOWN_MODE" | "CONTRADICTS_MODE" | "FORBIDDEN_IN_MODE" | "HOSTED_NOT_APPROVED" }> }` in `scripts/run-mode.mjs`. 규칙 파일은 기본으로 `infra/run-modes.json`을 읽는다.
- Produces `checkEnv({ root: string }) → Promise<{ ok: boolean, mode: string | null, counts: { placeholder: number, contradiction: number, missing: number, forbidden: number }, problems: Array<{ file: string, key: string, code: "MISSING_FILE" | "MISSING_KEY" | "PLACEHOLDER" | "FORBIDDEN_KEY" | "UNKNOWN_MODE" | "CONTRADICTS_MODE" | "FORBIDDEN_IN_MODE" | "HOSTED_NOT_APPROVED" }> }>` in `scripts/check-env.mjs`. env 파일은 `node:util`의 `parseEnv`로 읽는다.
- 읽는 파일과 필수 키(Phase 0 범위. 이후 Phase가 키를 더한다):
  - `infra/.env` (필수 파일): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`. 실행 모드는 이 파일로 판정한다. 모드의 `requiredSecrets`도 이 파일에서 찾는다. `live`·`fixture`면 `QWEN_BASE_URL`·`KEV_BASE_URL`·`KEV_API_KEY`, `AI_PROVIDER=hosted`면 `HOSTED_API_BASE_URL`·`HOSTED_API_KEY`도 필수.
  - `web/.env.local` (필수 파일): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REDIS_URL`, `MINIO_ENDPOINT`, `AI_GATEWAY_URL`. 금지 키: `SUPABASE_SERVICE_ROLE_KEY`, 서비스키 4개(`G2B_BID_NOTICE_SERVICE_KEY`·`G2B_PRE_SPEC_SERVICE_KEY`·`G2B_ORDER_PLAN_SERVICE_KEY`·`G2B_INDUSTRY_MASTER_SERVICE_KEY`), 그리고 이름이 `NEXT_PUBLIC_`로 시작하면서 `SERVICE_ROLE` 또는 `G2B`를 포함하는 키.
  - 루트 `.env.local` (선택 파일, Phase 1부터 필수): 있으면 placeholder만 센다.
- placeholder: 값에 `CHANGE_ME`가 들어 있거나 값이 정확히 `minioadmin`.
- CLI: `node scripts/check-env.mjs [--root <dir>]`. 문제마다 `FAIL <file> <KEY> <code>` 한 줄을 stderr에 쓰고(값은 쓰지 않는다), 마지막 줄을 stdout에 쓴다.
  - 통과: `check:env 통과: 실행 모드 <mode>, placeholder 0건, 모드 모순 0건` + exit 0
  - 실패: `check:env 실패: 실행 모드 <mode|알 수 없음>, placeholder <n>건, 모드 모순 <n>건, 누락 <n>건, 금지 <n>건` + exit 1

- [ ] **Step 1: 실패하는 시험 작성** — `scripts/check-env.test.mjs` (`node:test`, `node:assert/strict`, 임시 폴더는 `mkdtemp`)
  - `resolveRunMode: 미지정이면 mock` → `mode === "mock"`, `effective.AI_PROVIDER === "mock"`, `violations` 빈 배열.
  - `resolveRunMode: 정상 조합 통과` 표: `{SOL_RUN_MODE:"live"}`, `{SOL_RUN_MODE:"fixture", AI_PROVIDER:"local"}`, `{SOL_RUN_MODE:"mock", KEV_ENABLED:"true"}`, `{SOL_RUN_MODE:"fixture", AI_PROVIDER:"hosted", AI_HOSTED_APPROVED:"true"}` → 모두 `violations.length === 0`.
  - `resolveRunMode: 모순은 키 이름으로 알린다` 표 (입력 → 기대 `{key, reason}`):
    - `live` + `AI_PROVIDER=mock` → `AI_PROVIDER`·`CONTRADICTS_MODE`
    - `live` + `AI_FALLBACK_TO_MOCK=true` → `AI_FALLBACK_TO_MOCK`·`FORBIDDEN_IN_MODE`
    - `live` + `KEV_ALLOW_KO_STATE=true` → `KEV_ALLOW_KO_STATE`·`FORBIDDEN_IN_MODE`
    - `mock` + `DEMO_MODE=false` → `DEMO_MODE`·`CONTRADICTS_MODE`
    - `fixture` + `AI_PROVIDER=mock` → `AI_PROVIDER`·`CONTRADICTS_MODE`
    - `mock` + `AI_PROVIDER=hosted` → `AI_PROVIDER`·`CONTRADICTS_MODE`
    - `fixture` + `AI_PROVIDER=hosted` (승인 없음) → `AI_HOSTED_APPROVED`·`HOSTED_NOT_APPROVED`
    - `SOL_RUN_MODE=LIVE` → `SOL_RUN_MODE`·`UNKNOWN_MODE`
    - `SOL_RUN_MODE=" mock"` → `SOL_RUN_MODE`·`UNKNOWN_MODE`
  - `checkEnv: infra/.env 가 없으면 MISSING_FILE`.
  - `checkEnv: CHANGE_ME 와 minioadmin 을 placeholder 로 센다` → `counts.placeholder === 2`.
  - `checkEnv: web/.env.local 의 SUPABASE_SERVICE_ROLE_KEY 는 FORBIDDEN_KEY`.
  - `checkEnv: live 인데 빠진 서비스키마다 MISSING_KEY, mock 은 통과` → `G2B_PRE_SPEC_SERVICE_KEY`만 비우면 그 키 이름으로 `MISSING_KEY` 1건.
  - `CLI: 통과하면 exit 0 과 정해진 마지막 줄` → stdout 마지막 줄이 `check:env 통과: 실행 모드 mock, placeholder 0건, 모드 모순 0건`.
  - `CLI 출력에 비밀값이 없다` → 실패하는 임시 폴더에 `SUPABASE_SERVICE_ROLE_KEY=sk-test-SECRET-123`, `REDIS_PASSWORD=pw-SECRET-456` 등을 넣고 실행. exit 1, stdout+stderr에 `SECRET`이 0회.

- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/check-env.test.mjs` / Expected: FAIL (`Cannot find module` 등)
- [ ] **Step 3: `infra/run-modes.json`·`scripts/run-mode.mjs`·`scripts/check-env.mjs` 구현, `package.json`에 `check:env` 추가.** 직접 실행 판정은 `scripts/people/check.mjs`와 같은 방식(`import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href`)을 쓴다.
- [ ] **Step 4: 통과 확인** — Run: `node --test scripts/check-env.test.mjs` / Expected: PASS. 이어서 `pnpm verify:quick` PASS.
- [ ] **Step 5: 커밋(메인 세션)** — `feat: 실행 모드 규칙과 env 검사 추가`

---

### Task 2: AI gateway 골격 (`services/ai`, V2-01 Python 쪽)

**Files:**
- Create: `services/ai/pyproject.toml`, `services/ai/uv.lock`, `services/ai/.python-version`(`3.12`), `services/ai/verify.sh`
- Create: `services/ai/src/sol_ai/__init__.py`, `__main__.py`, `run_mode.py`, `settings.py`, `app.py`
- Create: `services/ai/Dockerfile`, `services/ai/Dockerfile.dockerignore`
- Test: `services/ai/tests/test_run_mode.py`, `services/ai/tests/test_health.py`, `services/ai/tests/test_startup.py`
- Modify: `verify.config.json` (projects에 `ai` 추가), `.github/workflows/ci.yml` (project job에 setup-uv 단계)

**Interfaces:**
- Consumes: `infra/run-modes.json`(Task 1). 경로는 env `SOL_RUN_MODES_FILE`, 없으면 `Path(__file__).resolve().parents[4] / "infra" / "run-modes.json"`.
- Produces `resolve_run_mode(env: Mapping[str, str], rules: dict) -> RunModeResult` (`mode`, `effective`, `violations: list[Violation(key, reason)]`) in `sol_ai/run_mode.py`. Task 1과 같은 규칙·같은 reason 문자열.
- Produces `create_app(settings: Settings) -> FastAPI` in `sol_ai/app.py`. `GET /health` 응답(Phase 0, 키 순서 무관):

```json
{"status": "ok", "runMode": "mock", "provider": "mock", "kevEnabled": true, "qwen": null, "kev": null, "questionSets": [], "parsers": []}
```

  `qwen`·`kev`·`questionSets`·`parsers`는 03:145 필드 자리이고 Phase 2·5에서 채운다. `provider`는 web `checks.ai`가 읽는다(Task 4).
- Produces `python -m sol_ai`: 설정을 검증하고 통과하면 `uvicorn`으로 `AI_HOST`(기본 `127.0.0.1`, 이미지에서는 `0.0.0.0`):8000을 연다. 위반이 있으면 stderr에 `기동 거부: <KEY>(<reason>)[, ...]` 한 줄을 쓰고 exit 78(EX_CONFIG).
- Produces `verify.config.json` 항목:

```json
{
  "name": "ai",
  "directory": "services/ai",
  "marker": "pyproject.toml",
  "setup": { "command": "uv", "args": ["sync", "--frozen"] },
  "verify": { "command": "bash", "args": ["verify.sh"] },
  "quick": { "command": "bash", "args": ["verify.sh"] }
}
```

  `verify.sh`는 `set -euo pipefail` 뒤 `uv run --frozen ruff check .`, `uv run --frozen ruff format --check .`, `uv run --frozen pytest`를 차례로 돈다.
- 의존성: 런타임 `fastapi`, `uvicorn`, `pydantic-settings`. 개발 `pytest`, `httpx`, `ruff`. 버전은 설치 시점 최신 안정판을 `uv add`로 고정한다.
- Dockerfile: 빌드 컨텍스트는 저장소 루트(D7). `python:3.12-slim` + `ghcr.io/astral-sh/uv`(태그 고정)에서 `uv` 바이너리를 복사하고, `uv sync --frozen --no-dev`, `infra/run-modes.json`을 `/app/infra/run-modes.json`으로 복사, `SOL_RUN_MODES_FILE=/app/infra/run-modes.json`·`AI_HOST=0.0.0.0`, 비root 사용자, `CMD ["python", "-m", "sol_ai"]`. `Dockerfile.dockerignore`는 `services/ai/**`와 `infra/run-modes.json` 밖을 전부 뺀다.

- [ ] **Step 1: 실패하는 시험 작성**
  - `test_run_mode.py`: Task 1의 정상 4건·모순 9건 표를 그대로 `pytest.mark.parametrize`로 옮긴다. 시험 이름에 `v2_01`을 넣는다(예: `test_v2_01_contradiction_names_key`).
  - `test_health.py::test_health_mock_mode` → `TestClient(create_app(Settings(SOL_RUN_MODE="mock")))`의 `GET /health`가 200이고 본문이 위 JSON과 같다.
  - `test_startup.py::test_refuses_live_with_mock_provider` → `subprocess.run([sys.executable, "-m", "sol_ai"], env={..., "SOL_RUN_MODE": "live", "AI_PROVIDER": "mock"})`의 `returncode == 78`, stderr에 `AI_PROVIDER` 포함.
  - `test_startup.py::test_refuses_unapproved_hosted` → `SOL_RUN_MODE=fixture`, `AI_PROVIDER=hosted`, 승인 없음 → 78, stderr에 `AI_HOSTED_APPROVED`.
  - `test_startup.py::test_refusal_does_not_print_values` → 위 경우에 `HOSTED_API_KEY=sk-test-SECRET-123`을 함께 주고 stdout+stderr에 `SECRET` 0회.
- [ ] **Step 2: 실패 확인** — Run: `uv run --project services/ai pytest` / Expected: FAIL (`ModuleNotFoundError: sol_ai`)
- [ ] **Step 3: `uv init`·`uv add`로 프로젝트를 만들고 위 인터페이스대로 구현.** hosted·Qwen·Kev 어댑터와 `/extract`·`/kev`·`/parse`·`/explain`은 만들지 않는다(Phase 2·5).
- [ ] **Step 4: 통과 확인** — Run: `bash services/ai/verify.sh` (cwd `services/ai`) / Expected: ruff 0건, pytest 전부 PASS.
- [ ] **Step 5: 이미지 확인** — Run: `docker build -f services/ai/Dockerfile -t sol-ai:phase0 .` 후 `docker run --rm -e SOL_RUN_MODE=live -e AI_PROVIDER=mock sol-ai:phase0` / Expected: exit 78, `기동 거부: AI_PROVIDER(CONTRADICTS_MODE)`. 이미지 태그는 시험 뒤 지운다.
- [ ] **Step 6: CI 등록** — `verify.config.json`에 `ai` 항목, `.github/workflows/ci.yml` project job의 `corepack enable` 다음에 `astral-sh/setup-uv`(커밋 SHA 고정, 뒤에 버전 주석, `if: matrix.project.name == 'ai'`) 단계를 넣는다. SHA는 `gh api repos/astral-sh/setup-uv/git/ref/tags/<버전>`으로 확인한다.
- [ ] **Step 7: 전체 확인** — Run: `pnpm verify` / Expected: common·web·ai 모두 PASS(게이트 시험 `scripts/gate-integrity.test.mjs` 포함). CI 실제 통과는 push 승인 뒤 확인한다(Task 8 보고에 "CI 미확인"으로 적는다).
- [ ] **Step 8: 커밋(메인 세션)** — `feat: AI gateway 골격과 실행 모드 기동 거부`

---

### Task 3: worker 진입점 (미결정 9번 검증)

**Files:**
- Modify: `web/package.json`, `web/pnpm-lock.yaml` (`bullmq`, `ioredis` 의존성, `tsx` 의존성 — 컨테이너에서도 쓰므로 dependencies)
- Modify: `web/lodestar.config.ts` (`worker` 층)
- Create: `web/worker/env.ts`, `web/worker/system-queue.ts`, `web/worker/readiness.ts`, `web/worker/heartbeat.ts`, `web/worker/main.ts`, `web/worker/ping.ts`
- Test: `web/worker/env.test.ts`, `web/worker/system-queue.test.ts`, `web/worker/main.test.ts`

**Interfaces:**
- Produces `readWorkerEnv(env: NodeJS.ProcessEnv): WorkerEnv` in `web/worker/env.ts`. `WorkerEnv = { redisUrl: string, heartbeatFile: string }`. 필수 `REDIS_URL`·`NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`가 없으면 `Error("worker env 누락: <KEY>[, <KEY>]")`(값 없이). `WORKER_HEARTBEAT_FILE` 기본 `/tmp/sol-worker-heartbeat`.
- Produces `SYSTEM_QUEUE = "system"`, `PING_JOB = "ping"`, `processSystemJob(job: { name: string }): Promise<{ pong: true }>` in `web/worker/system-queue.ts`. 모르는 job 이름은 `Error("unknown system job: <name>")`.
- Produces `checkReadiness(deps): Promise<void>` in `web/worker/readiness.ts`: Redis `PING`과 `getSupabaseAdmin().from("profiles").select("id", { head: true }).limit(1)`을 각각 5초 제한으로 확인한다. 실패하면 어느 쪽인지(`redis`·`supabase`)만 담은 오류.
- Produces `startWorker(env = process.env): Promise<{ close(): Promise<void> }>` in `web/worker/main.ts`: env 읽기 → 준비 확인 → BullMQ `Worker(SYSTEM_QUEUE, processSystemJob)` → heartbeat 10초 간격 시작. 직접 실행되면 `SIGTERM`·`SIGINT`에서 `close()` 후 exit 0, 기동 실패면 stderr 한 줄 + exit 1. `--check` 인자면 모듈만 불러 `worker modules loaded`를 찍고 exit 0.
- Produces `web/worker/ping.ts`: env는 `REDIS_URL`만 읽는다(Supabase 키 불필요). `SYSTEM_QUEUE`에 `ping`을 넣고 `QueueEvents`로 10초까지 기다려 `queue round-trip ok <ms>ms` + exit 0, 아니면 exit 1.
- Produces `web/package.json` scripts:
  - `"worker": "node --conditions=react-server --import tsx worker/main.ts"`
  - `"worker:check": "node --conditions=react-server --import tsx worker/main.ts --check"`
  - `"worker:ping": "node --conditions=react-server --import tsx worker/ping.ts"`
- Produces `web/lodestar.config.ts` 층: `{ name: "worker", path: "worker/**", canImport: ["domain", "infra", "shared"] }`(주석: worker 는 service role 을 쓰는 유일한 런타임이라 infra 를 직접 부른다). 다른 층의 `canImport`에는 `worker`를 넣지 않는다.

- [ ] **Step 1: 실패하는 시험 작성**
  - `env.test.ts`: `REDIS_URL` 없음 → 메시지에 `REDIS_URL` 포함, `SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123"`을 준 경우에도 메시지에 `SECRET` 0회. 기본 heartbeat 경로 `/tmp/sol-worker-heartbeat`.
  - `system-queue.test.ts`: `processSystemJob({ name: "ping" })` → `{ pong: true }`, `{ name: "nope" }` → reject `unknown system job: nope`.
  - `main.test.ts`: BullMQ·준비 확인·heartbeat를 주입한 `startWorker`가 준비 확인 실패 시 reject하고 worker를 만들지 않는다. `close()`가 worker·heartbeat 타이머를 모두 닫는다.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run worker` / Expected: FAIL
- [ ] **Step 3: 의존성 추가와 구현.** `pnpm -C web add bullmq ioredis tsx`. `main.ts`는 `@/server/supabase`의 `getSupabaseAdmin`을 배럴로 부른다.
- [ ] **Step 4: 통과 확인** — Run: `pnpm -C web exec vitest run worker` / Expected: PASS
- [ ] **Step 5: 실행 방식 검증(미결정 9)** — Run: `pnpm -C web worker:check` / Expected: `worker modules loaded`, exit 0. 대조: `cd web && node --import tsx worker/main.ts --check` / Expected: `server-only` 오류로 실패(조건이 실제로 필요함을 확인). 두 출력을 Task 8 증거용으로 `docs/evidence/phase-0/worker-conditions.txt`에 저장한다. 조건을 줘도 `next/headers` 등으로 실패하면 멈추고 보고한다(D2 대안 esbuild로 바꿀지 사용자 결정).
- [ ] **Step 6: 계층 확인** — `lodestar.config.ts`에 `worker` 층을 넣고 Run: `pnpm -C web lodestar` / Expected: PASS. 일부러 `web/worker`에서 `@/app/...`를 부르는 임시 줄을 넣어 실패하는지 확인한 뒤 지운다.
- [ ] **Step 7: 전체 확인** — Run: `pnpm -C web verify:quick` / Expected: PASS
- [ ] **Step 8: 커밋(메인 세션)** — `feat: worker 진입점과 system 큐 추가`

---

### Task 4: web `/health/live`·`/health/ready`

**Files:**
- Create: `web/server/health/health.model.ts`, `health.repo.ts`, `health.service.ts`, `index.ts`
- Test: `web/server/health/health.model.test.ts`, `web/server/health/health.service.test.ts`
- Modify: `web/server/supabase/client.ts`, `web/server/supabase/index.ts` (`getSupabaseAnon` 추가)
- Create: `web/app/health/live/route.ts`, `web/app/health/ready/route.ts`
- Test: `web/app/health/ready/route.test.ts`
- Modify: `web/proxy.ts` (matcher에서 `health` 제외), `web/proxy.test.ts`
- Modify: `web/.env.example` (`REDIS_URL`, `MINIO_ENDPOINT`, `AI_GATEWAY_URL` 안내 줄)

**Interfaces:**
- Consumes: `ioredis`(Task 3이 설치), gateway `GET /health`의 `provider`(Task 2).
- Produces `health.model.ts`:
  - `type CheckState = "ok" | "unavailable"`, `type AiState = "mock" | "local" | "hosted" | "unavailable"`
  - `type Readiness = { status: "ok" | "degraded" | "unavailable"; checks: { db: CheckState; redis: CheckState; storage: CheckState; ai: AiState } }`
  - `toReadiness(checks: Readiness["checks"]): { httpStatus: 200 | 503; body: Readiness }` — db·redis·storage 중 하나라도 `unavailable`이면 503 `unavailable`, AI만 `unavailable`이면 200 `degraded`, 모두 정상이면 200 `ok`(05:43, 14:33-35).
- Produces `health.repo.ts` 검사 함수(각각 2초 제한, 예외를 밖으로 던지지 않고 `unavailable`):
  - `probeDb(): Promise<CheckState>` — `getSupabaseAnon().from("profiles").select("id", { head: true }).limit(1).abortSignal(AbortSignal.timeout(2000))`의 `error`가 없으면 ok. Supabase 미설정이면 unavailable.
  - `probeRedis(url: string | undefined): Promise<CheckState>` — `ioredis`를 `lazyConnect`·`connectTimeout: 2000`·`maxRetriesPerRequest: 0`으로 만들어 `PING === "PONG"`이면 ok, 끝나면 `disconnect()`.
  - `probeStorage(endpoint: string | undefined): Promise<CheckState>` — `GET ${MINIO_ENDPOINT}/minio/health/live`가 200이면 ok.
  - `probeAi(gatewayUrl: string | undefined): Promise<AiState>` — `GET ${AI_GATEWAY_URL}/health` 본문의 `provider`가 `mock`·`local`·`hosted` 중 하나면 그 값, 아니면 unavailable.
- Produces `getReadiness(probes?: Probes): Promise<{ httpStatus: 200 | 503; body: Readiness }>` in `health.service.ts` — 네 검사를 동시에 돌린다. `probes` 기본값은 repo 함수 + `process.env`.
- Produces `getSupabaseAnon(): SupabaseClient<Database>` in `web/server/supabase/client.ts` — 쿠키·헤더를 읽지 않는 anon 클라이언트(세션 저장·갱신 끔). 배럴에서 내보낸다.
- Produces routes: `GET /health/live` → 200 `{ "status": "ok" }`, `GET /health/ready` → `getReadiness()` 결과. 두 응답 모두 `Cache-Control: no-store`. 인증 없음(05:42-43 `public`). 캐시·동적 처리 방식은 `web/node_modules/next/dist/docs/`의 Route Handler 안내를 따른다.
- Produces `web/proxy.ts` matcher: `"/((?!api(?:/|$)|health(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"`.

- [ ] **Step 1: 실패하는 시험 작성**
  - `health.model.test.ts` 표: 모두 ok + ai `mock` → 200 `ok` / ai `unavailable` → 200 `degraded` / redis `unavailable` → 503 `unavailable` / db `unavailable` + ai `mock` → 503 `unavailable`이고 `checks.ai === "mock"` 유지.
  - `health.service.test.ts`: `멈춘 검사는 시간 제한 뒤 unavailable` — 끝나지 않는 Promise를 주는 가짜 fetch·Redis로 `getReadiness()`가 2.5초 안에 `checks.storage === "unavailable"`(가짜 타이머 사용). `provider: "local"` 응답 → `checks.ai === "local"`, `provider: "weird"` → `unavailable`.
  - `route.test.ts`: `설정이 없으면 503` — `REDIS_URL`·`MINIO_ENDPOINT`·`AI_GATEWAY_URL`·Supabase env를 `vi.stubEnv`로 비우면 `GET` 응답 503, 본문 `status === "unavailable"`, `Cache-Control === "no-store"`. 기존 `web/app/api/v1/me/employment/route.test.ts`의 `vi.stubEnv`·`unstubAllEnvs` 패턴을 따른다.
  - `proxy.test.ts`: matcher 문자열을 정규식으로 바꿔 `/health/ready`·`/health/live`는 맞지 않고 `/dashboard`·`/healthy-team/dashboard`는 맞는지 확인.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/health app/health proxy` / Expected: FAIL
- [ ] **Step 3: 위 인터페이스대로 구현.** `app/health/**`(ui 층)는 `@/server/health` 배럴만 부른다.
- [ ] **Step 4: 통과 확인** — Run: `pnpm -C web exec vitest run server/health app/health proxy` / Expected: PASS
- [ ] **Step 5: 전체 확인** — Run: `pnpm verify` / Expected: PASS(빌드 포함)
- [ ] **Step 6: 커밋(메인 세션)** — `feat: web health 엔드포인트 추가`

---

### Task 5: Compose·env 예시·worker 이미지·smoke

**Files:**
- Create: `infra/compose.yaml`
- Create: `infra/env/demo.env.example`, `infra/env/ai-local.env.example`
- Create: `web/worker/Dockerfile`, `web/worker/Dockerfile.dockerignore`
- Create: `infra/smoke.sh`
- Modify: `.gitignore` (이미 `infra/.env`를 막는지 확인하고, 아니면 추가)

**Interfaces:**
- Consumes: gateway 이미지 규약(Task 2), `pnpm worker`·`pnpm worker:ping`·heartbeat 파일(Task 3), `/health/ready`(Task 4).
- Produces `infra/compose.yaml`:
  - `name: sol-radar`. 서비스 5개 `redis`·`minio`·`qdrant`·`ai-gateway`·`worker`. 프로필을 붙이지 않는다(`--profile demo`를 줘도 같은 5개가 뜬다. 10:37).
  - env는 `env_file`이 아니라 서비스별 `environment`에 필요한 키만 넘긴다(값은 `infra/.env` 치환).
    - `redis`: `REDIS_PASSWORD`. 명령 `redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes`.
    - `minio`: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`. 명령 `server /data`.
    - `qdrant`: 없음.
    - `ai-gateway`: `SOL_RUN_MODE`, `DEMO_MODE`, `AI_PROVIDER`, `AI_HOSTED_APPROVED`, `AI_FALLBACK_TO_MOCK`, `KEV_ENABLED`, `KEV_ALLOW_KO_STATE`. 빌드 `context: ..`, `dockerfile: services/ai/Dockerfile`. `extra_hosts: ["host.docker.internal:host-gateway"]`(ai-local 터널용). Supabase·G2B 키는 넘기지 않는다.
    - `worker`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `AI_GATEWAY_URL=http://ai-gateway:8000`, `SOL_RUN_MODE`, `DEMO_MODE`, 서비스키 4개 `G2B_*_SERVICE_KEY`(10:53, ADR-022). 빌드 `context: ../web`, `dockerfile: worker/Dockerfile`. `depends_on: redis: condition: service_healthy`.
  - 포트: `127.0.0.1:6380:6379`(`REDIS_HOST_PORT` 기본), `127.0.0.1:9000:9000`, `127.0.0.1:6333:6333`, `127.0.0.1:8000:8000`. worker는 포트 없음.
  - volume: `redisdata:/data`, `miniodata:/data`, `qdrantdata:/qdrant/storage`.
  - restart: redis·minio·qdrant `unless-stopped`, ai-gateway·worker `on-failure:3`.
  - logging: 공통 `x-logging`(json-file, `max-size: 10m`, `max-file: "3"`).
  - healthcheck(interval 10s, timeout 5s, retries 5):
    - redis: `redis-cli --no-auth-warning -a "$$REDIS_PASSWORD" ping`의 `PONG`
    - qdrant: `GET /readyz` 200
    - minio: `GET /minio/health/live` 200
    - ai-gateway: `python -c` urllib로 `http://127.0.0.1:8000/health` 200
    - worker: `node -e`로 heartbeat 파일 mtime이 30초 이내
    - qdrant·minio 이미지에는 shell·curl이 없을 수 있다. Step 2에서 이미지 안의 도구를 먼저 확인하고 그 도구로 쓴다. 이미지 안에 쓸 도구가 없으면 멈추고 보고한다(이미지 교체는 10 변경이라 사용자 결정).
- Produces `infra/env/demo.env.example`: `SOL_RUN_MODE=mock`, `DEMO_MODE=true`, `AI_PROVIDER=mock`, `KEV_ENABLED=true`, `AI_HOSTED_APPROVED=false`, `AI_FALLBACK_TO_MOCK=false`, `KEV_ALLOW_KO_STATE=false`, 그리고 `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`REDIS_PASSWORD`·`MINIO_ROOT_USER`·`MINIO_ROOT_PASSWORD`는 `CHANGE_ME`. `G2B_*_SERVICE_KEY` 줄은 두지 않는다(D5). `AI_FAULT_INJECT`는 넣지 않는다. 맨 위 주석에 `cp infra/env/demo.env.example infra/.env` 후 값을 채우라는 안내와 파일별 비밀 규칙.
- Produces `infra/env/ai-local.env.example`: `SOL_RUN_MODE=live`(주석으로 `fixture` 안내), `DEMO_MODE=false`, `AI_PROVIDER=local`, `KEV_ENABLED=true`, `AI_FALLBACK_TO_MOCK=false`, `QWEN_BASE_URL=http://host.docker.internal:8001`, `QWEN_MODEL=Qwen/Qwen3.5-9B`, `KEV_BASE_URL=http://host.docker.internal:8009`, `KEV_MODEL_ID=kev-9b-v1.0`, `KEV_QUESTION_SET=kev-qs/v0.2`, `KEV_API_KEY=CHANGE_ME`, 서비스키 4개(`G2B_BID_NOTICE_SERVICE_KEY`·`G2B_PRE_SPEC_SERVICE_KEY`·`G2B_ORDER_PLAN_SERVICE_KEY`·`G2B_INDUSTRY_MASTER_SERVICE_KEY`)는 각각 `CHANGE_ME`, 공통 키는 `CHANGE_ME`. 터널 명령 `ssh -N -L 8001:127.0.0.1:8001 -L 8009:127.0.0.1:8009 <user>@<gpu-host>`을 주석으로(10:134). 호스트·계정 값은 적지 않는다.
- Produces `web/worker/Dockerfile`: `node:22-slim`(`.nvmrc` 22), corepack pnpm, `package.json`·`pnpm-lock.yaml`로 `pnpm install --frozen-lockfile`, `worker`·`server`·`lib`·`tsconfig.json` 복사, 비root, `CMD ["pnpm", "worker"]`. `Dockerfile.dockerignore`는 `node_modules`·`.next`·`e2e*`·`test-results`·`playwright-report`·`.env*`를 뺀다.
- Produces `infra/smoke.sh` (`set -euo pipefail`, 실패 단계 이름을 찍고 exit 1):
  1. `docker compose -f infra/compose.yaml ps --format '{{.Service}} {{.Health}}'`에서 5개 모두 `healthy`
  2. `curl -fsS http://127.0.0.1:3000/health/live`
  3. `curl -s -o <tmp> -w '%{http_code}' http://127.0.0.1:3000/health/ready`가 200이고 `checks.db`·`checks.redis`·`checks.storage`가 `ok`(판정은 `node -e`로 JSON 파싱)
  4. `pnpm -C web worker:ping`(env `REDIS_URL`은 호출한 셸이 준다) 성공
  5. volume 유지: redis에 `SET sol:smoke <시각>` → `docker compose restart redis` → healthy 대기 → 같은 값
  - 비밀값을 출력하지 않는다(`set -x` 금지).

- [ ] **Step 1: 설정 검사** — 임시 env를 스크래치 폴더에 만들고(무작위 비밀번호, 가짜 Supabase 주소) Run: `docker compose --env-file <tmp-env> -f infra/compose.yaml config --quiet` / Expected: exit 0
- [ ] **Step 2: 이미지 도구 확인** — `docker run --rm --entrypoint sh <image> -c 'command -v curl wget bash'` 등으로 qdrant·minio 이미지 안 도구를 확인하고 healthcheck 명령을 정한다. 결과를 PR 설명용으로 기록한다.
- [ ] **Step 3: 기동 확인(인프라 4개)** — Run: `docker compose --env-file <tmp-env> -f infra/compose.yaml up -d --build redis minio qdrant ai-gateway` 후 `ps` / Expected: 4개 `healthy`, `curl http://127.0.0.1:8000/health`의 `runMode` `mock`. worker는 가짜 Supabase 주소로 기동이 거부되어야 한다: `up worker` 후 로그 마지막 줄이 `supabase` 준비 실패 한 줄이고 재시작이 3회에서 멈춘다.
- [ ] **Step 4: 모순 env 거부** — 임시 env에 `SOL_RUN_MODE=live`, `AI_PROVIDER=mock`을 넣고 `up ai-gateway` / Expected: 컨테이너 exit 78, 로그에 `기동 거부: AI_PROVIDER(CONTRADICTS_MODE)`.
- [ ] **Step 5: 정리** — Run: `docker compose --env-file <tmp-env> -f infra/compose.yaml down -v` (이 작업이 만든 볼륨만 지운다는 것을 `docker volume ls`로 앞뒤 대조). 기존 컨테이너·볼륨은 건드리지 않는다.
- [ ] **Step 6: 서식·검증** — Run: `pnpm format:check && pnpm verify:quick` / Expected: PASS
- [ ] **Step 7: 커밋(메인 세션)** — `feat: Compose 기본 서비스와 env 예시 추가`

---

### Task 6: 공고 fixture E1 — manifest·공고 20건·검증기

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (루트 devDependency `yaml`, scripts `"bids:check": "node scripts/bids/check.mjs"`)
- Create: `scripts/bids/check.mjs`
- Test: `scripts/demo-bids.test.mjs`
- Create: `fixtures/manifest.yaml`, `fixtures/bids/FX-01.json` … `fixtures/bids/FX-20.json`

**Interfaces:**
- Produces `fixtures/manifest.yaml` 형태(07:314 "배치 순서, FX-ID, 시나리오 태그"를 이 계획이 필드로 정한다. Task 9가 07에 반영):

```yaml
schemaVersion: sol-fixtures/v1.0
calculationDate: "2026-10-16" # 08:301 계산 기준일
batches:
  SEED: [FX-01, FX-02, ..., FX-20] # 20건 순서
  LIVE: [FX-06, FX-07, FX-08, FX-09, FX-10]
fixtures:
  - id: FX-01
    stage: NOTICE
    tags: [normal, G5, G6, G8, S3, S6, S7]
    expected: { outcome: BID, designScore: 94 }
  # ... FX-20 까지
```

  `expected.outcome ∈ BID | WATCH | NO_BID | CANCELLED | QUARANTINED | EARLY_TRACK`, `designScore`는 07 표에 숫자가 있는 7건(FX-01 94, FX-02 72, FX-03 68, FX-06 78, FX-07 76, FX-15 58, FX-18 82)만, 나머지는 `null`. FX-07은 r2 결과(BID 76)를 적고 r1(WATCH 68)은 `tags`에 `r1-WATCH-68`.
- Produces `fixtures/bids/FX-xx.json` 형태(07:326-349): `{ fixtureId, isDemo: true, stage, connectorBehavior, records: [{ amendmentNo, ingestBatch, noticeId, planRef, title, agency, budgetKrw, noticeDate, deadlineAt, stage, sourceUrl, content, attachments: [{ name, objectKey }] }] }`. FX별 값은 07:361-382 표와 19 데모 장면을 따른다. 첨부 `objectKey`는 `fixtures/docs/FX-xx-<이름>.(pdf|hwp|hwpx)` 형식만 적고 파일은 Phase 2에서 만든다(D9). FX-12는 `title`을 일부러 뺀다. FX-17 마감은 `deadlineAt: null`이고 "2027년 3월 발주 예정"은 `content`에 쓴다.
- Produces `checkBidFixtures({ root: string }) → Promise<{ ok: boolean, errors: Array<{ code: string, fixtureId?: string }> }>` in `scripts/bids/check.mjs`. CLI는 `scripts/people/check.mjs`와 같은 모양(JSON 한 줄 출력, 실패 시 exit 1). 검사:
  1. manifest `schemaVersion`, `fixtures`가 FX-01~FX-20 정확히 20개·중복 없음, `SEED` 20건, `LIVE` 5건이 위 목록과 같음
  2. 파일마다 `fixtureId`가 파일 이름과 같고 `isDemo === true`
  3. `stage ∈ NOTICE|PLAN|PRE_SPEC`, `connectorBehavior ∈ normal|duplicate-delivery|rate-limit-then-ok`, `amendmentNo`가 두 자리, `ingestBatch ∈ SEED|LIVE`이고 manifest 배치와 일치
  4. `noticeId`가 `^DEMO-2026-\d{4}$`, `planRef`는 `null` 또는 `^DEMO-PLAN-\d{4}$`, `budgetKrw`는 `null` 또는 숫자 문자열, `noticeDate`·`deadlineAt`은 `null` 또는 `^[+-]\d+d$`
  5. `sourceUrl === "https://demo.sol-radar.invalid/notices/" + fixtureId`
  6. `title`이 빈 값이면 manifest `expected.outcome === "QUARANTINED"`인 FX만 허용
  7. 문자열 전체에서 `.invalid`가 아닌 이메일 0건, 전화번호 패턴(`0\d{1,2}-\d{3,4}-\d{4}`) 0건
  8. 분포: stage NOTICE 16·PLAN 2·PRE_SPEC 2, outcome BID 4·WATCH 10·NO_BID 2·CANCELLED 1·QUARANTINED 1·EARLY_TRACK 2(07:384)

- [ ] **Step 1: 실패하는 시험 작성(검증기 담당)** — `scripts/demo-bids.test.mjs`: 정상 fixture를 읽어 `structuredClone` 뒤 변형하는 표 시험(`scripts/demo-people.test.mjs` 80행 패턴). 변형마다 기대 `code`:
  - `isDemo: false` → `NOT_DEMO`
  - `sourceUrl`을 `https://www.g2b.go.kr/...`로 → `SOURCE_URL`
  - `content`에 `kim@example.com` → `PII_EMAIL`
  - `content`에 `010-1234-5678` → `PII_PHONE`
  - `deadlineAt: "2026-11-01"` → `RELATIVE_DATE`
  - FX-01 `title` 삭제 → `TITLE_MISSING`
  - manifest에서 FX-20 제거 → `MANIFEST_IDS`
  - FX-07 outcome을 WATCH로 → `DISTRIBUTION`
  - CLI: `spawnSync(process.execPath, ["scripts/bids/check.mjs"])` → exit 0, stdout JSON `ok: true`, stderr 빈 문자열.
- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/demo-bids.test.mjs` / Expected: FAIL
- [ ] **Step 3: 검증기 구현** — `pnpm add -D yaml`(루트), `scripts/bids/check.mjs`.
- [ ] **Step 4: 데이터 작성(fixture-author)** — manifest와 공고 20건. 숫자는 07 표·08 §6·19와 맞추고, 어긋나는 문서 값은 고치지 말고 보고 목록에 적는다(알려진 것: FX-13 결과, S3 필터의 FX-18, S5 알림의 FX-08, 05:645 격리 `sourceKey`).
- [ ] **Step 5: 통과 확인** — Run: `node --test scripts/demo-bids.test.mjs && pnpm bids:check && pnpm format:check` / Expected: PASS, `{"ok":true,...}`
- [ ] **Step 6: 커밋(메인 세션)** — `feat: 공고 fixture 20건과 검증기 추가`

---

### Task 7: 공고 fixture E2 — mock 추출 19건·mock Kev 4건·골든 3건

**Files:**
- Create: `fixtures/extractions/FX-xx.json` 19건(FX-12 제외, D11)
- Create: `fixtures/kev/FX-01.json`, `FX-02.json`, `FX-03.json`, `FX-16.json`
- Create: `fixtures/goldens/FX-01.json`, `FX-02.json`, `FX-03.json`
- Modify: `scripts/bids/check.mjs`, `scripts/demo-bids.test.mjs`

**Interfaces:**
- Consumes: `fixtures/bids/*`의 `records[].content`(인용 대상), manifest.
- Produces `fixtures/extractions/FX-xx.json`: 03:236-287 `RequirementExtraction` 그대로. `schemaVersion: "requirement-extraction/v0.1"`, `model: { provider: "mock", name: "fixture", promptVersion: "req-extract/v0.1", ... }`, `bidId: "FX-xx"`, `revisionId: "FX-xx#<마지막 amendmentNo>"`(seed가 UUID로 바꾼다), 모든 `evidence[]`는 `documentId: null`(본문 인용, D9)이고 `quotedText`는 5~300자. 상태(`PENDING_REVIEW` 등)는 파일에 적지 않는다(gateway·worker가 계산).
- Produces `fixtures/kev/FX-xx.json`: `{ schemaVersion: "kev-mock/v0.1", fixtureId, provider: "mock", questionSetVersion: "kev-qs/v0.1", responses: { recommendation: { choice, confidence, probabilities: { BID, WATCH, NO_BID } }, mandatoryRisk: { noul }, needsHumanReview: { noul }, fit: { score, legend, probabilities, confidence } }, usage, latency_ms }`. 질문별 wire 필드는 03:491을 따른다. `fit.score`는 표시값 − 1.
- Produces `fixtures/goldens/FX-xx.json`: `{ schemaVersion: "sol-golden/v0.1", fixtureId, calculationDate: "2026-10-16", factors: [{ factor, normalized, points, maxPoints }], total, score, recommendation, reviewFlags }`. `factor` 순서 `skillMatch`(30)·`pastPerformance`(25)·`staffAvailability`(20)·`scaleFit`(15)·`strategicPreference`(10).
- 검증기 추가 검사:
  1. manifest에서 `QUARANTINED`가 아닌 FX마다 추출 파일이 있음, `QUARANTINED`는 없음
  2. `quotedText`가 그 FX 레코드 `content` 안에 그대로 있음. 예외는 manifest `tags`에 `citation-mismatch-1`이 있는 FX(FX-13)만, 정확히 1건
  3. 상태가 `KNOWN`인 값 필드는 `evidence` 1건 이상
  4. Kev: 확률 합 1(오차 1e-6), `fit.score` = 표시값 − 1
  5. 골든: `points` 합을 소수 첫째 자리 반올림한 `total`, `Math.round(total) === score`, `maxPoints`가 30·25·20·15·10

- [ ] **Step 1: 실패하는 시험 작성** — `scripts/demo-bids.test.mjs`에 더한다.
  - 07:394-400 필수 케이스:
    - FX-01 필수 기술 5·우대 2·자격 3·인원 합 12, 인용 3건 모두 본문 일치
    - FX-02 필수 6·우대 2, `staffing` 상태 `UNKNOWN`, 인용 2건
    - FX-03 `quotedText`에 `정보통신공사업법에 따른 정보통신공사업 등록업체`
    - FX-04 인용 0건
    - FX-13 본문에 없는 인용 정확히 1건
    - FX-11 `staffing` 상태 `KNOWN`(missing 요소 1건 유지, 08:97-98·155)
  - Kev 07:404-409 값:
    - FX-01 0.71/0.24/0.05·0.05·0.12·fit 3.5
    - FX-02 0.36/0.52/0.12·0.10·0.74·2.2
    - FX-03 0.55/0.30/0.15·0.85·0.58·1.8
    - FX-16 0.10/0.20/0.70·0.90·0.30·0.6
  - 골든 08:377-384:
    - FX-01 24.0/25.0/20.0/15.0/10.0 → 94 BID, `reviewFlags` 빈 배열
    - FX-02 15.0/18.3/14.0/15.0/10.0 → 72 WATCH, `KEV_NEEDS_REVIEW`
    - FX-03 20.0/12.2/20.0/9.0/7.0 → 68 NO_BID, `MODEL_RULE_DISAGREEMENT`
  - 변형: 인용 한 건을 본문에 없는 문장으로 바꾸면 `CITATION_NOT_IN_CONTENT`, 확률 합 0.9 → `KEV_PROBABILITY_SUM`, FX-01 `points` 하나를 바꾸면 `GOLDEN_TOTAL`.
- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/demo-bids.test.mjs` / Expected: FAIL
- [ ] **Step 3: 검증기 확장 후 데이터 작성(fixture-author).** 추출 내용은 07 표의 기대 결과(권고·자격 판정)와 08 §6 솔리데오 프로필에 맞춘다. 본문 인용이 성립하도록 필요하면 Task 6의 `content`를 함께 고친다(같은 담당).
- [ ] **Step 4: 통과 확인** — Run: `node --test scripts/demo-bids.test.mjs && pnpm bids:check && pnpm verify:quick` / Expected: PASS
- [ ] **Step 5: 커밋(메인 세션)** — `feat: mock 추출·Kev·골든 fixture 추가`

---

### Task 8: Phase 0 통합 기동과 증거

사용자가 실제 env 파일을 만들어야 한다. 에이전트는 `.env*`를 읽지 않는다.

**Files:**
- Create: `docs/evidence/phase-0/compose-ps.txt`, `health-ready.json`, `health-ready-degraded.json`, `test-report.txt`, `run-mode-check.txt`, `worker-conditions.txt`(Task 3), `smoke.txt`, `external-deps.md`

- [ ] **Step 1: 사용자 준비 확인** — 사용자에게 `cp infra/env/demo.env.example infra/.env`, `web/.env.local`에 Supabase 클라우드 개발 프로젝트 값과 `REDIS_URL=redis://:<비밀번호>@127.0.0.1:6380`·`MINIO_ENDPOINT=http://127.0.0.1:9000`·`AI_GATEWAY_URL=http://127.0.0.1:8000`을 채우고 `SUPABASE_SERVICE_ROLE_KEY`가 `web/.env.local`에 있으면 빼 달라고 요청한다(D12).
- [ ] **Step 2: env 검사** — Run: `pnpm check:env` / Expected: `check:env 통과: 실행 모드 mock, placeholder 0건, 모드 모순 0건`. 이 출력과 `node --test scripts/check-env.test.mjs`·`uv run --project services/ai pytest tests/test_run_mode.py tests/test_startup.py` 출력을 `run-mode-check.txt`에 저장(첫 줄에 명령·커밋 해시).
- [ ] **Step 3: 기동** — Run: `docker compose -f infra/compose.yaml --profile demo up -d --build` 후 `docker compose -f infra/compose.yaml ps` / Expected: 5개 `healthy`. 출력을 `compose-ps.txt`에 저장.
- [ ] **Step 4: web·health** — Run: `pnpm -C web build && pnpm -C web start`(백그라운드) 후 `curl -s http://localhost:3000/health/ready` / Expected: 200, `checks.db/redis/storage = ok`, `checks.ai = mock`. `health-ready.json`에 저장.
- [ ] **Step 5: AI 장애 리허설** — `docker compose -f infra/compose.yaml stop ai-gateway` → `/health/ready`가 200 `degraded`·`checks.ai = unavailable`(`health-ready-degraded.json`) → `start ai-gateway` → healthy 복귀.
- [ ] **Step 6: smoke** — Run: `REDIS_URL=... bash infra/smoke.sh`(값은 사용자가 셸에 넣는다) / Expected: 5단계 PASS. 출력을 `smoke.txt`에 저장.
- [ ] **Step 7: 전체 검증** — Run: `pnpm verify` / Expected: PASS. stdout 전체를 `test-report.txt`에 저장(11:226, 요약 금지).
- [ ] **Step 8: P0-0 기록** — `external-deps.md`에 ①~④를 11 §3.3 형식으로 적는다. 서비스키·회사 GPU가 준비되지 않았으면 "대기(사유)"로 적고 통과로 쓰지 않는다. 키 값·GPU 주소는 적지 않는다.
- [ ] **Step 9: 독립 확인** — `demo-verifier`에게 10 기동 절차 1·2·4·5·7단계 재실행을 맡긴다(3·6단계는 Phase 1 산출물이 필요해 제외, 이유를 적는다).
- [ ] **Step 10: 커밋(메인 세션)** — `docs: Phase 0 기동 증거 기록`

---

### Task 9: 정본·PROGRESS 동기화

다른 세션이 `docs/` 정본을 고치는 중이면 시작하지 않는다(작업 전 `git status docs/` 확인, 미커밋 정본 변경이 있으면 사용자에게 묻는다).

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/16-DECISIONS.md`, `docs/10-DEPLOYMENT.md`, `docs/07-DATA-PIPELINE.md`, `docs/11-TESTING.md`

- [ ] **Step 1: PROGRESS** — Phase 0 체크(P0-0은 "대기"로 남김), 작업 로그 한 줄(변경·검증·남은 문제).
- [ ] **Step 2: 16 ADR** — 미결정 9번에 Task 3 결과(`--conditions=react-server` + tsx 동작 여부)를 적고, D1~D15를 "제안" 상태 ADR로 올린다(채택은 사람이 한다).
- [ ] **Step 3: 10 배포** — env 표에 새 키(`MINIO_ENDPOINT`, `WORKER_HEARTBEAT_FILE`, `AI_HOST`, `SOL_RUN_MODES_FILE`), web 호스트 실행 확정(D1), worker healthcheck 방식(D3), healthcheck 명령.
- [ ] **Step 4: 07 수집** — manifest 필드, Kev mock·골든 파일 envelope, 추출 `bidId`·`revisionId` 표기 규칙.
- [ ] **Step 5: 11 테스트** — §2 "pytest 미등록" 경고 갱신(등록됨), V2-01 시험 파일 실재 표시.
- [ ] **Step 6: 정본 정정 제안 목록** — 아래 "알려진 정본 불일치"를 16 미결정 표에 제안으로 올리고 사용자 판단을 받는다. frontmatter `updated`와 위키링크 규약을 지킨다.
- [ ] **Step 7: 검사·커밋(메인 세션)** — Run: `pnpm format:check` / Expected: PASS. 커밋 `docs: Phase 0 결과를 정본에 반영`

## 알려진 정본 불일치 (이번에 고치지 않고 보고)

- FX-13 인용 실패 결과: `CONFLICTED`(07:375·399, 11:76·97) vs `UNKNOWN`+`CITATION_FAILED`(03:771, 15:255). fixture 내용은 같고 결과 판정은 Phase 5.
- FX-05 `PENDING_REVIEW` 근거: 03 §4.4의 `PENDING_REVIEW` 조건(인젝션·인용 실패 50% 초과)에 파싱 실패가 없다.
- `AI_FAULT_INJECT` 값 5개(03:199) vs 3개(에이전트 정의). `KEV_ENABLED` 기본 `false`(ADR-012 행, 에이전트 정의) vs demo `true`(10:37).
- 서비스키 4개(`G2B_*_SERVICE_KEY`) mock 필요 여부(11:176). `infra-developer`의 `production` 프로필·`kev-4b` 태그·`infra/nginx/`.
- `/health/ready`에 실행 모드 필드 없음(05:43) vs `RunModeIndicator`가 거기서 읽음(06:378). Phase 3 전에 정한다.
- 04:373 `requirement_extractions` 20 vs 적재 19. 19:44 FX-20 LIVE vs 07 SEED. 19:128 S3 "입찰공고" 필터에 PRE_SPEC FX-18. 19:155 S5 알림에 FX-08 누락.
- 03:137 "hosted 미승인 503"과 "기동 거부"의 모순.

## 실행 결과 (2026-10-19)

- 분담: 4세션이 worktree 로 나눠 맡았다. Task 1·2(실행 모드 규칙·AI gateway) `sol-radar-14`, Task 3·4(worker·web health) `sol-radar-83`, Task 6·7(공고 fixture) `sol-radar-02`, Task 5·병합·Task 8·9·최종 리뷰 `sol-radar-50`(조정).
- main 병합: 코드 `1b824c8`(최종 `88afb79`까지), Compose 프로젝트 이름 변경 `9b2bdf1`, 보완 증거 `ce74f64`. C0 통합 검증 증거는 `evidence/phase-0/c0-integration-20261019.md`.
- 검증: `pnpm verify` exit 0(vitest 927·pytest 28). C0 통합 검증 10항목 통과, 보완 검증 5항목(degraded 리허설·`stop worker` exit 0 포함) 통과. 증거 `evidence/phase-0/task8-gaps-20261019.md`.
- 조정 기록(Ruling 1~33)은 `.superpowers/sdd/2026-10-18-phase-0-infra/progress.md`다. 다음 Phase 로 넘긴 minor 와 parked 항목도 거기 있다.
- 남은 것: P0-0 외부 의존성 점검(`evidence/phase-0/external-deps.md` 대기), `checks.db` 의 Supabase 클라우드 검증(지금은 로컬 Supabase CLI 기준), GitHub Actions CI 미실행(계정 결제 한도). 계획이 정본에 맡긴 결정은 [[16-DECISIONS|ADR-024]] 제안으로, 정본 불일치는 [Phase 0 정본 불일치 목록](2026-10-19-phase-0-doc-inconsistencies.md)으로 올렸다.

## 관련 문서

- [[12-ROADMAP|12 로드맵]] — Phase 0 행, P0-0·P0-1
- [[11-TESTING|11 테스트]] — §3.2 V2-01, §3.3, §4 Phase 0
- [[10-DEPLOYMENT|10 배포]]
- [[07-DATA-PIPELINE|07 수집]] — fixture
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[16-DECISIONS|16 ADR]] — 미결정 9번
- [[PROGRESS]]
