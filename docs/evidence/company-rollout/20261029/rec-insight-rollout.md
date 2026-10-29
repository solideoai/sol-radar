---
title: "추천 분석 운영 반영 기록 (2026-10-29 오전)"
status: active
tags: [sol-radar, ops, rec-insight, ai-gateway, analysis-worker, redis-api]
updated: 2026-10-29
---

# 추천 분석 운영 반영 기록 (2026-10-29 오전)

[[../../../16-DECISIONS|ADR-066]] 추천 분석을 운영에 반영했다. 사용자 승인("①~④ 전부 승인", 회사 망)으로 메인 세션 45가 했다. 격리 로컬 스택 재확인(df, `92a27cd0`)이 통과한 뒤 시작했다.

지킨 조건:

- 회사에서는 AI gateway·Analysis Worker·redis-api 세 컨테이너만 다시 만들었다. ingest·Documents·기업마당 Worker, dependency reporter, Redis 는 그대로다.
- `sol-radar-app` checkout 의 HEAD(`cbb3831e86da`)는 옮기지 않았다. 22:15 보조 수집 예약(`sol-refill-20261029/run.sh`)이 이 값을 확인하고 돌기 때문이다. redis-api 는 빌드 context 만 배포 checkout 으로 덮어써 빌드했다.
- 교체 직전 운영 DB `score_runs` 의 `QUEUED`·`RUNNING` 은 0건이었다(SELECT).
- `.env*` 파일은 열지 않았다. compose 보간값 `SOL_RADAR_REDIS_NETWORK` 는 실행 중 redis-api 의 네트워크 이름(`redis_default`)을 읽어 지정했다.

## 순서와 결과

| 단계 | 시각(KST) | 내용 | 결과 |
|---|---|---|---|
| ① 운영 DB | 11:30 전 | `bash scripts/db-push.sh`(`NODE_EXTRA_CA_CERTS` 지정): `20261029000100_recommendation_insights`·`20261029000200_recommendation_insights_guard` | 적용. 미적용 0개, migration 66개. `db-verify` 통과. 제약 `recommendation_insights_pending_or_model_once` 있음 |
| ② main push | 11:30 | `da36696d..3ae02acf`(push 전 검사 공통·ai·web 통과) | Vercel success(02:31:58Z). `/health/ready` 200(`db`·`redis`·`storage` ok, `ai: local`) |
| ③-준비 | 11:31~11:33 | 배포 checkout `/data/www/ai_workspace/sol-radar-deploy` 에 `deploy/main-20261029-ri` = origin/main `3ae02acf` + 회사 carry `9bb24b0`(dependency reporter, cherry-pick `384e4698`). origin/main 과의 차이는 carry 두 파일뿐 | 이미지 `sol-radar-ai-gateway:384e469857f0`·`sol-radar-analysis-worker:384e469857f0`·`sol-radar-gateway-redis-api:latest`(`a58834472738`). 되돌리기 태그 `sol-radar-gateway-redis-api:rollback-20261029`(= 이전 `9458368e`) |
| ③ AI gateway | 11:34 | `ai-gateway` 만 재생성 | `/health` ok, 추출 `promptHash` `fa2ff603…` 그대로, 모델·Bosun `registryMatch`·파서 그대로 |
| ③ Analysis Worker | 11:35 | `analysis-worker` 만 재생성(`compose.analysis-only.sha.company.yaml`) | `analysis-only worker started`, 재시작 0 |
| ③ redis-api | 11:35 | `redis-api` 만 재생성(`--wait`) | healthy, 토큰 없는 `/health` 401 |
| ④ 운영 확인 | 11:36 | 관리자 계정으로 공고 상세 [추천 분석] 2회(회사 Qwen 호출 2회) | 아래 표 |

준비 단계에서 두 번 멈췄다. 둘 다 컨테이너를 바꾸기 전이다. 첫째는 45가 main 전체 해시를 잘못 넣은 것으로, 스크립트의 해시 대조가 막았다(fetch 만 됨). 둘째는 redis-api 를 `--env-file infra/.env.company.local` 로 부른 것이다. 실행 중 redis-api 는 그 파일 없이 기동돼 있었다(그 파일은 없다). 그래서 compose 파일만으로 부르고 네트워크 이름만 지정했다.

## 운영 확인

| 공고 | run | 행 | 결과 |
|---|---|---|---|
| 2026년 국가 재난 정신건강 전산시스템(실공고, 45 보류) | `e2620667` | `a8444ab5` | `DONE`·`MODEL`·`Qwen3.8-Flash-Next-AWQ-INT4`, 4.3초, 근거 4개(B1·B2·C1·C2), 강점 2·보완할 점 2 |
| DEMO-2026-0001 FX-01(58 보류) | `b0186368` | `2f2c485d` | `DONE`·`MODEL`, 3.5초, 근거 12개, 강점 3·보완할 점 3 |

- 두 행 모두 insight `promptHash` `f623bb44…`, 대체 없음. gateway 로그 `POST /insight` 200 두 번, Worker 로그 `insight.job` `DONE`·`MODEL` 두 번.
- 화면: 1440·1280 에서 문서 가로 넘침 0, 패널 넘침 0, 콘솔 오류 0. 근거 칩을 누르면 원문 인용이 펼쳐진다. 실 vLLM 응답의 근거 번호는 모두 요청 refs 안의 번호였다. guided 스키마로 받았는지 unguided 대체였는지는 로그에 남기지 않아 구분하지 못했다.
- 화면 글에 금지어(승률·확률·가능성·수주 금액·점유율·경쟁사·%)와 다른 판정 이름이 없었다.
- 스크린샷: [실공고 1440](../../rec-insight/prod-live-1440.png) · [실공고 1280](../../rec-insight/prod-live-1280.png) · [DEMO 1440](../../rec-insight/prod-demo-1440.png) · [DEMO 1280](../../rec-insight/prod-demo-1280.png)

운영 쓰기는 migration 2개와 추천 분석 행 2개다. 분석 run·점수·권고는 바뀌지 않았다.

## 되돌리기

- AI gateway: `AI_GATEWAY_TAG=2deb11861b3a` 로 같은 Compose 명령(`compose.ai-worker.company.yaml` + `/home/bim/sol-radar-overrides/ai-gateway.sha.yaml`).
- Analysis Worker: `ANALYSIS_WORKER_TAG=9bb24b002f9b` 로 `compose.analysis-only.company.yaml` + `compose.analysis-only.sha.company.yaml`.
- redis-api: `docker image tag sol-radar-gateway-redis-api:rollback-20261029 sol-radar-gateway-redis-api:latest` 뒤 `sol-radar-app` 에서 `SOL_RADAR_REDIS_NETWORK=redis_default docker compose -f infra/compose.company.yaml up -d --no-deps --no-build --wait redis-api`.
- 배포 브랜치 `deploy/main-20261029-gw2`(`2deb118`)가 남아 있다. 빌드 context 덮어쓰기 파일은 `/home/bim/sol-radar-overrides/redis-api.build-deploy.yaml` 이다.
- DB 표는 두어도 된다(읽는 쪽이 없으면 비어 있을 뿐이다).

## 관련 문서

- [[../../../PROGRESS|진행 상황]]
- [[ai-gateway-rollout|같은 날 오전 AI gateway 교체]]
- [[../../../../infra/company/README|회사 런타임 배포]]
