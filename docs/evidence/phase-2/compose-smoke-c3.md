---
title: "C3 병합 뒤 Compose 기동 smoke (2026-10-19)"
status: done
tags:
  - sol-radar
  - test
  - phase-2
  - evidence
updated: 2026-10-19
---

# C3 병합 뒤 Compose 기동 smoke

main `d933c9e`(C3 `c3/ingestion-core` @ `8595601` 병합)와 같은 트리(`e3eebe7`)에서 `infra/smoke.sh` 를 돌렸다.

## 실행 조건

- 트리: 별도 worktree, detached `1071cad`(a680480 + 8595601). 트리 해시 `e3eebe7` 는 main `d933c9e` 와 같다.
- Compose 프로젝트 이름: `sol-radar-gate3e`(`COMPOSE_PROJECT_NAME`). 다른 세션의 스택·로컬 Supabase 와 섞이지 않게 따로 띄웠다.
- 호스트 포트: redis 16380, minio 19000, qdrant 16333, ai-gateway 18000, web 3002. 모두 127.0.0.1.
- 실행 모드: `SOL_RUN_MODE=mock`, `AI_PROVIDER=mock`, `DEMO_MODE=true`.
- DB·Auth: 로컬 Supabase(`127.0.0.1:54321`). worker 는 `host.docker.internal:54321` 로 붙었다.
- Redis·MinIO 비밀번호는 이 실행에서 새로 만든 일회용 값이다. 끝난 뒤 `infra/.env` 와 볼륨을 지웠다.

## 결과

```
compose: ai-gateway=healthy minio=healthy qdrant=healthy redis=healthy worker=healthy
ready: {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"mock"}}
ok 1 서비스 5개 healthy
ok 2 web live
ok 3 web ready (db·redis·storage)
ok 4 worker ping
ok 5 redis 재시작 뒤 값 유지 (호스트 포트 16380)
smoke 통과
```

- worker 는 C3 의 등록 구조(`WORKER_REGISTRATIONS`: system·ingest)로 기동했다(`worker started`). fixture·소스 registry 마운트를 읽고 설정 검증을 통과했다.
- redis 재시작 동안 worker 가 `worker 오류: Error ECONNREFUSED` 를 한 번 남겼다. 재시작 뒤 다시 붙어 healthy 를 유지했다.

## 확인하지 않은 것

- fixture 모드에서 실제 ingest job 을 돌려 로컬 Supabase 에 공고를 저장하는 경로. 이 경로는 마이그레이션 `20261019000009` 를 로컬 DB 에 적용해야 한다. 로컬 DB 는 다른 세션과 같이 쓰므로 이번에는 적용하지 않았다.
- `demo:reset` 을 실제 Supabase 에 대고 돌리는 경로. 이유는 위와 같다.
- live 모드와 XML 게이트웨이 오류 분류.
