---
title: "C0 Phase 0 통합 기동 검증 (2026-10-19)"
status: done
tags:
  - sol-radar
  - test
  - phase-0
  - evidence
updated: 2026-10-19
---

# C0 Phase 0 통합 기동 검증

- 대상 커밋: main `cfc534d` (Phase 0 코드는 `1b824c8` 에 병합)
- 실행: 2026-10-19 09:21 ~ 09:27 KST (env 준비 포함 약 6분, 소스 확인까지 약 10분)
- 실행자: demo-verifier 에이전트. 앱 코드·설정·시험·정본 문서는 고치지 않았다. git 상태(add·commit·stash·checkout)를 바꾸지 않았다.
- 판정: **Phase 0 기동 기준 10개 항목 모두 통과** (항목 8 은 기대대로 "미구현(C5)" 확인). 결함 0건, 관찰·절차 메모 6건(아래).

## 격리 환경

| 항목 | 값 |
|---|---|
| Compose 프로젝트 | `-p sol-radar-c0verify` (파일의 `name: sol-radar` 를 덮음) |
| 호스트 포트 | redis 16380 · minio 19000 · qdrant 16333 · ai-gateway 18000 · web 13000 (모두 127.0.0.1) |
| env 파일 | 저장소 밖 스크래치 `.env` (`infra/env/demo.env.example` 복사, CHANGE_ME 5개를 무작위·로컬 값으로 채움). 저장소의 `.env*`·`web/.env.local`·`infra/.env` 는 읽지도 만들지도 않음 |
| Supabase | 공유 클라우드 DB 사용 안 함. 로컬 Supabase CLI 스택(`supabase_kong_sol-radar`, 127.0.0.1:54321)의 키를 `pnpm exec supabase status -o env` 로 얻어 스크래치 env 에만 넣음. worker 컨테이너는 `http://host.docker.internal:54321` 로 접근, `profiles` head select 만 수행(쓰기 없음) |
| 시작 전 상태 | 컨테이너 25개(다른 세션 Supabase 2벌·k8s), c0verify 볼륨 0, 대상 포트 5개 모두 비어 있음 |
| 비밀값 | 모든 증거는 스크래치 env 의 4개 비밀값(service role 키·redis 비밀번호·minio 사용자·비밀번호)을 `***` 로 마스킹해 저장. `set -x` 미사용 |

## 항목별 결과

| # | 항목 | 기대 | 실제 | 결과 | 증거 파일 |
|---|---|---|---|---|---|
| 1 | `compose config --quiet` | exit 0 | exit 0. 프로젝트명 `sol-radar-c0verify`, 포트 override 4개 반영 | 통과 | `compose-config.txt` |
| 2 | `up -d --build` → `ps` | 5개 서비스 healthy | redis·minio·qdrant·ai-gateway·worker 모두 `healthy`. up 소요 17초(빌드 캐시 전부 적중, 콜드 빌드 시간은 미측정). healthy 까지 기동 후 약 25초 | 통과 | `compose-up.txt`, `compose-ps.txt`, `worker-logs.txt` |
| 3 | gateway `GET /health` | `runMode=mock`·`provider=mock`·`kevEnabled=true` | `{"status":"ok","runMode":"mock","provider":"mock","kevEnabled":true,...}` HTTP 200 | 통과 | `gateway-health.json` |
| 4 | 실행 모드 모순 기동 거부 | exit 78 + `기동 거부: AI_PROVIDER(...)` | (1) `run --rm -e SOL_RUN_MODE=live -e AI_PROVIDER=mock ai-gateway` → `기동 거부: DEMO_MODE(CONTRADICTS_MODE), AI_PROVIDER(CONTRADICTS_MODE)` exit 78. (2) `DEMO_MODE=false` 까지 주면 `기동 거부: AI_PROVIDER(CONTRADICTS_MODE)` exit 78. (3) 호스트 `check-env.mjs --root <스크래치 트리>` → `FAIL infra/.env AI_PROVIDER CONTRADICTS_MODE` 등, exit 1. (4) 모순 없는 트리 → 통과 exit 0 | 통과 | `run-mode-check.txt` |
| 5 | 서비스 간 네트워크(worker 컨테이너에서) | gateway 200, redis PONG | `http://ai-gateway:8000/health` 200(provider=mock), `redis:6379` PONG, `minio:9000` 200, `qdrant:6333/readyz` 200 | 통과 | `network-check.txt` |
| 6 | web `/health/live`·`/health/ready` | live 200, ready 의 checks | `pnpm -C web build` exit 0(33초). `next start -p 13000` 뒤 live `{"status":"ok"}` 200, ready `{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"mock"}}` 200, `cache-control: no-store`. `checks.db=ok` 는 `web/.env.local` 의 Supabase(내용 미열람) 기준 | 통과 | `health-ready.json`, `web-build.txt` |
| 7 | `infra/smoke.sh` | 5단계 통과 | `-p` 인자는 없지만 Compose 환경변수 `COMPOSE_PROJECT_NAME`(파일 `name:` 보다 우선)·`COMPOSE_ENV_FILES` 로 격리 프로젝트를 가리켜 실행. `ok 1`~`ok 5`, `smoke 통과`, 16초. redis 재시작 뒤에도 5개 healthy·ready ok·`worker:ping` 42ms | 통과 | `smoke.txt`, `post-smoke-state.txt` |
| 8 | `/extract`·`/kev` | 404 (미구현) | `POST /extract` 404, `POST /kev` 404, openapi paths = `/health` 뿐 | 미구현(C5), 기대와 일치 | `gateway-endpoints.txt` |
| 9 | fixture 검증기·파일 수 | 20건 ok, extractions 19·kev 4·goldens 3 | `{"ok":true,"errors":[]}`. 파일 수: `extractions` 20(= FX-12 격리 제외 19건 + `FX-07.r01.json` 개정 1건), `kev` 4, `goldens` 3, `bids` 20 | 통과 | `fixture-check.txt` |
| 10 | 포트·볼륨 충돌 | 충돌 0 | 실행 중 전체 30개(기존 25 + 5) 호스트 포트 중복 0. c0verify 볼륨 3개만 생성, 기존 `sol-radar_*` 볼륨 없음(건드리지 않음) | 통과 | `port-volume-check.txt` |

## 정리(`down -v`)

완료. `docs/evidence/phase-0/cleanup.txt`.

- web: 내가 띄운 `next-server` 프로세스 그룹(pid 68735)만 SIGTERM, 2초 안에 종료, 13000 반납.
- `docker compose -p sol-radar-c0verify -f infra/compose.yaml down -v` exit 0: 컨테이너 5·볼륨 3·네트워크 1 삭제.
- 뒤처리 확인: c0verify 컨테이너 0·볼륨 0·네트워크 0, 실행 중 컨테이너 25개(시작 시와 같음), 로컬 Supabase kong 2벌 모두 healthy 유지, 포트 5개 모두 반납.
- 남긴 것: 이미지 `sol-radar-c0verify-worker:latest`(1.19GB)·`sol-radar-c0verify-ai-gateway:latest`(220MB). `down -v` 는 이미지를 지우지 않고 지시도 `down -v` 까지라 두었다. 지우려면 `docker image rm sol-radar-c0verify-worker:latest sol-radar-c0verify-ai-gateway:latest`.
- 스크래치(`.../scratchpad/c0/`): env·런처 스크립트·로그. 저장소 밖이라 git 에 들어가지 않는다.

## 결함·관찰

앱 코드 결함은 찾지 못했다. 아래는 절차·문서 메모와 관찰이다.

| # | 구분 | 내용 | 담당 |
|---|---|---|---|
| M1 | 절차 | `pnpm check:env` 는 process.env 를 보지 않고 `infra/.env`·`web/.env.local` 파일만 읽는다(`scripts/check-env.mjs`). 지시서의 `SOL_RUN_MODE=live AI_PROVIDER=mock pnpm check:env` 는 아무것도 검사하지 못하므로, 스크래치 트리의 `infra/.env` 에 모순 값을 적고 `--root` 로 검사했다(저장소 `infra/.env` 는 만들지 않음). 11 §4 V2-01 의 시험 절차 문구를 파일 기준으로 맞추면 좋겠다 | docs-keeper |
| M2 | 절차 | `infra/smoke.sh` 는 `-p` 를 받지 않는다(`COMPOSE=(docker compose -f ...)`). Compose 의 `COMPOSE_PROJECT_NAME`·`COMPOSE_ENV_FILES` 환경변수로 격리 실행이 가능했다. 10 에 "격리 실행법" 한 줄을 적어 두면 재현이 쉽다 | docs-keeper (선택) |
| M3 | 관찰 | smoke 5단계의 redis 재시작 중 worker 로그에 `worker 오류: Error ECONNREFUSED` 2줄. 재연결 뒤 healthy 유지·`worker:ping` 정상. 결함 아님(ioredis 재연결 소음). 로그를 줄이고 싶으면 pipeline 쪽 선택 과제 | pipeline-developer (FYI) |
| M4 | 관찰 | `run --rm -e SOL_RUN_MODE=live -e AI_PROVIDER=mock` 은 env 파일의 `DEMO_MODE=true` 도 함께 모순이라 거부 메시지에 `DEMO_MODE` 가 먼저 나온다. 규칙대로다. `AI_PROVIDER` 단독 거부는 (2) 로 따로 확인했다 | 없음 |
| M5 | 관찰 | worker 가 로컬 Supabase CLI 스택에 닿은 것은 Docker Desktop 이 `host.docker.internal` 을 기본 제공하기 때문이다. `infra/compose.yaml` 의 `extra_hosts` 는 ai-gateway 에만 있어 Linux 호스트에서는 worker 가 로컬 스택에 못 닿는다. 데모는 클라우드 Supabase 라 영향 없음 | infra-developer (FYI) |
| M6 | 관찰 | 빌드는 캐시 전부 적중(ai-gateway 이미지는 10시간 전 빌드와 동일 ID). 콜드 빌드 시간은 이 검증에서 재지 않았다 | 없음 |

가드 훅 메모: 스크래치 `.env` 를 `cp` 로 복사해 비교용 트리를 만들려던 명령을 `.claude/hooks/guard.sh`(3-2 `.env` 셸 읽기 규칙)가 막았다. 돌아가지 않고, 비교용 트리는 `.env` 를 읽지 않는 방식(예시 파일 + 더미 값 생성)으로 다시 만들었다. 증거 마스킹(`mask.mjs`)은 스크래치 env 를 node 로 읽어 값을 `***` 로 바꾸는 용도로만 썼고 값을 출력하지 않았다.

## 증거 파일 (`docs/evidence/phase-0/`)

`compose-config.txt` · `compose-up.txt` · `compose-ps.txt` · `gateway-health.json` · `gateway-endpoints.txt` · `run-mode-check.txt` · `network-check.txt` · `worker-logs.txt` · `web-build.txt` · `health-ready.json` · `smoke.txt` · `post-smoke-state.txt` · `fixture-check.txt` · `port-volume-check.txt` · `cleanup.txt` · 이 문서.

각 파일 첫 줄은 실행 명령·커밋 해시·실행 시각이다(11 §6). `docs/evidence/README.md` 의 "예정" 표(Phase 0 행: `compose-ps.txt`·`health-ready.json`·`run-mode-check.txt`)를 "있는 증거"로 옮기는 일은 docs-keeper 몫이다.

## 관련 문서

- [[11-TESTING|11 테스트]] §4 Phase 0 수용 기준, §6 증거 규칙
- [[10-DEPLOYMENT|10 배포]] 기동 절차
- [[16-DECISIONS|16 결정 기록]] ADR-017
- [[README|증거 색인]]

증거 JSON 두 파일(`gateway-health.json`·`health-ready.json`)은 응답 본문만 담는다(커밋 게이트의 Prettier 검사 때문). 실행 명령·커밋 해시·시각·2회차 헤더 전문은 `gateway-health.log.txt`·`health-ready.log.txt`에 있다.
