# 실행 모드 확인 (C9 2차 리허설) — 2026-10-21 11:45~12:09 KST · 커밋 4e62170

| 모드 | 기동 | 머리말 "실행 모드" | gateway `/health` `runMode`·`provider` | `GET /api/v1/admin/ai/status` | `qwen.healthy`·`kev.registryMatch` | 판정 |
|---|---|---|---|---|---|---|
| `live` | 시도하지 않음 | — | — | — | — | ❌ B2 대기(회사 GPU 엔드포인트 실측·B2 미완). `SOL_RUN_MODE` 를 바꾸지 않았고 회사 엔드포인트·나라장터 API 에 접속하지 않았다 |
| `fixture` | 시도하지 않음 | — | — | — | — | ❌ B2 대기(같은 사유) |
| `mock` | Compose 프로젝트 `sol-radar-c9-54` 5개 `healthy`(배정 세션이 미리 기동, 이 리허설에서 다시 올리지 않음). 기동 거부 없음 | "실행 모드: mock"(대시보드·목록·상세·관리자 수집 화면 전부) | `{"status":"ok","runMode":"mock","provider":"mock","kevEnabled":true,"qwen":{"model":"fixture",…},"kev":{"modelId":"mock","registryMatch":null},"questionSets":["kev-qs/v0.1"],…}` | **200** (ADMIN): `runMode: "mock"`, `provider: "mock"`, `hostedApproved: false`, `gateway.healthy: true`, `gateway.runMode: "mock"`, `qwen.model: "fixture"`·`qwen.healthy: true`, `kev.enabled: true`·`kev.modelId: "mock"`·`kev.registryMatch: null`, `questionSetVersion: "kev-qs/v0.1"`. SALES 는 **403** `FORBIDDEN {required:["ADMIN"]}` | 해당 없음(mock). `registryMatch: null` | ✅ |

- 마지막 모드: `mock`. web `/health/ready` `checks.ai: "mock"`(장애 주입 전·복구 뒤). 장애 주입 중에는 `/admin/ai/status` 가 200 `gateway.healthy: false`·`gateway.runMode: null` 이었다(`s6-fault-injection.txt`).
- 모드 값(컨테이너 환경에서 비밀 아닌 키만 `printenv`): ai-gateway `SOL_RUN_MODE=mock DEMO_MODE=true AI_PROVIDER=mock KEV_ENABLED=true AI_HOSTED_APPROVED=false AI_FALLBACK_TO_MOCK=false KEV_ALLOW_KO_STATE=false`, worker `SOL_RUN_MODE=mock DEMO_MODE=true`(나머지 키는 worker 에 주지 않는 구성). `pnpm check:env` → `실행 모드 mock, placeholder 0건, 모드 모순 0건`(`env-check.txt`).
- 외부 의존성 컷 규칙 갈래: "GPU 불가". `live`·`fixture`·S-LIVE(11a)·15번은 이번 리허설에서 빼고 사실대로 적는다. S-LIVE 실공고 공고번호·`score_runs` id 는 없다.
- `live` 호출량(Redis `quota:<serviceId>:<YYYYMMDD>`·`/admin/ingestion` `quotaUsed`)은 `live` 를 띄우지 않아 확인하지 않았다. `/admin/ingestion` 의 SEED·LIVE 배치 run 은 둘 다 `quotaUsed` 0("공공 API 호출 0회, fixture는 공공 API를 부르지 않습니다").
- 1차(20261020-1009)와 다른 점: `GET /api/v1/admin/ai/status` 가 404(미구현) → 200 으로 구현됐다.
