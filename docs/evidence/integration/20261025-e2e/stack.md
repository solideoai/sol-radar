---
title: "10-25 격리 E2E 스택(rh1025)"
status: done
tags: [sol-radar, evidence, e2e, integration]
updated: 2026-10-25
---

# 10-25 격리 E2E 스택(rh1025)

근거: `docs/plans/2026-10-25-integration-finish-plan.md` T3. 대상은 `integration/freeze-1024` @17c55609(사진 작업 전부 + N4b)다.
담당 세션은 a2, 배정은 40이다. 이 스택은 10-26 리허설에 다시 쓰므로 내리지 않았다.

## 코드

- worktree: `sol-radar-worktrees/e2e-rh1025`(detached). 1차는 17c55609, 2차는 15c966c6, 3차는 466d2911, 4차는 04b4bf3a, 7차는 7f1cbeca(integration/release-1025) 이다. 커밋하지 않는다.
- 루트·`web` 모두 `pnpm install --frozen-lockfile`.

## 격리 Supabase(CLI)

- workdir: `/private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/38f54940-3c25-4e22-a954-b7ae0a540d49/scratchpad/rh1025`
  - worktree 의 `supabase/migrations`(55개)·`supabase/templates` 를 복사했다. `config.toml` 은 project_id·포트만 바꿨다.
- `project_id = "sol-radar-rh1025"`
- 포트: API 56321, DB 56322, shadow 56320, 메일함 56324(웹)·56325(SMTP)
- 끈 서비스: studio·analytics·edge_runtime·imgproxy·postgres-meta·logflare·vector·supavisor·realtime
- Storage 버킷: `bid-documents`·`bid-parsed`·`profile-photos`(`pnpm storage:local`)
- 키: `supabase status` 의 로컬 기본값만 쓴다. 이 문서에 적지 않는다.

## Compose

- `COMPOSE_PROJECT_NAME=sol-radar-rh1025`(`docker compose -p sol-radar-rh1025 --env-file <scratchpad>/.env.rh1025-compose -f infra/compose.yaml`)
- 포트(127.0.0.1): redis 16380, qdrant 16333, ai-gateway 18000
- worker 의 `NEXT_PUBLIC_SUPABASE_URL`
  - 1차: `http://host.docker.internal:56321`(docker inspect 로 확인, 클라우드 아님)
  - 2차: override 로 `http://127.0.0.1:56321` 로 바꿨다. 사이드카 `sol-radar-rh1025-supabase-forward-1` 이 Docker 호스트 56321 로 전달한다.
- `SOL_RUN_MODE=mock`, `DEMO_MODE=true`, ai-gateway `/health` → `provider: mock`
- 카카오 알림 provider 는 비웠다.

## 웹

- E2E: Playwright webServer `next start` localhost:3200(`SOL_DEPLOYMENT_ROLE=standalone`)
- 화면 직접 확인: `next start` localhost:3210
- 웹 env 의 Supabase URL 은 `http://127.0.0.1:56321` 이다. `host.docker.internal` 이 호스트에서 풀리지 않아서다.
  - 1차 영향: worker 의 의존성 보고(scope.supabaseUrl)와 웹의 URL 문자열이 달라 상단바 AI 상태가 "확인 중"으로 남았다.
  - 2차: override 로 worker 도 같은 문자열을 써서 해소했다.
- 실행 env 는 scratchpad `run-env.mjs` 가 만든다. 키는 자식 프로세스 env 로만 넘긴다.
- seed 비밀번호는 격리용 임의 값이다. scratchpad `.env.rh1025-seed` 에 두고 `DEMO_SEED_ENV_FILE` 로 넘긴다.

## 다시 쓰는 법(10-26 리허설)

1. Supabase: `supabase start --workdir <scratchpad>/rh1025 --exclude imgproxy,studio,postgres-meta,logflare,vector,supavisor,realtime,edge-runtime`
2. Compose(10-25 2차부터 override 포함): `docker compose -p sol-radar-rh1025 --env-file <scratchpad>/rh1025/.env.rh1025-compose -f infra/compose.yaml -f <scratchpad>/rh1025/compose.rh1025-forward.yaml up -d`
   - worker 의 Supabase 주소는 `http://127.0.0.1:56321` 이다. 사이드카 `supabase-forward`(socat)가 worker 안의 이 주소를 Docker 호스트 56321 로 넘긴다. 이유는 summary.md "10-25 2차"에 있다.
3. 데모 기준선: `node <scratchpad>/rh1025/reset-baseline.mjs`
   - 순서는 `demo:reset -- --env-file <seed 파일>` → worker 주소 확인 → `demo:preanalyze` 다.
   - service role 은 로컬 status 값을 이 자식 env 로만 넘긴다. `run-env.mjs` 에는 넣지 않았다(웹 서버가 쓰지 않게).
   - 3차부터 worker 주소 확인은 override 기준이다(`127.0.0.1:56321` + `supabase-forward` 실행 중).
   - 사진까지 비우려면 이어서 `node <scratchpad>/rh1025/cleanup-photos.mjs` 를 돌린다. 쓰지 않는 `profile-photos` 객체를 Storage API 로 지운다.
   - 격리 DB migration 은 10-25 7차 기준 20261025000310 까지다(60개).
4. 웹: `SOL_DEPLOYMENT_ROLE=standalone node <scratchpad>/rh1025/run-env.mjs pnpm -C web start --hostname localhost --port 3210`

이름 없이 `docker compose` 를 부르면 기본 `sol-radar-stack`(클라우드 대상)을 쓴다. 반드시 `-p sol-radar-rh1025` 를 붙인다.

## 관련 문서

- [[20261025-e2e/summary|10-25 격리 E2E 결과]]
