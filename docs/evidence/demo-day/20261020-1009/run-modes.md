# 실행 모드 확인 (C9 1차 리허설) — 2026-10-20 10:14~10:25 KST · 커밋 72bfb9c

| 모드 | 기동 | 머리말 "실행 모드" | gateway `/health` `runMode`·`provider` | `GET /api/v1/admin/ai/status` | `qwen.healthy`·`kev.registryMatch` | 판정 |
|---|---|---|---|---|---|---|
| `live` | 시도하지 않음 | — | — | — | — | ❌ 회사 GPU 엔드포인트 미제공(C1 ③ 대기, ADR-025). 나라장터 서비스키·호출량도 쓰므로 이번 리허설에서 띄우지 않음 |
| `fixture` | 시도하지 않음 | — | — | — | — | ❌ 회사 GPU 엔드포인트 미제공(C1 ③ 대기) |
| `mock` | `docker compose -p sol-radar-dd-c9 -f infra/compose.yaml up -d --build` 1회, 5개 `healthy`, 기동 거부 없음 | "실행 모드: mock" (대시보드·목록·상세 전부) | `{"status":"ok","runMode":"mock","provider":"mock","kevEnabled":true,"kev":{"modelId":"mock","registryMatch":null},"questionSets":["kev-qs/v0.1"]}` | **404 (미구현)** | 해당 없음(mock) | ✅ (`/admin/ai/status` 제외) |

- 마지막 모드: `mock`. web `/health/ready` `checks.ai: "mock"` (장애 주입 전·복구 뒤 모두).
- 외부 의존성 컷 규칙 갈래: "GPU 불가" — `live`·`fixture`·S-LIVE(11a)·15번은 이번 리허설에서 빼고 사실대로 적는다. S-LIVE 실공고 공고번호·`score_runs` id 없음.
- `/admin/sources` 도 404. `live` 호출량(`quotaUsedToday`) 확인 불가.
- env: `infra/.env` `SOL_RUN_MODE=mock DEMO_MODE=true AI_PROVIDER=mock KEV_ENABLED=true AI_HOSTED_APPROVED=false AI_FALLBACK_TO_MOCK=false KEV_ALLOW_KO_STATE=false`, `web/.env.local` `SOL_RUN_MODE=mock`. `pnpm check:env` → `실행 모드 mock, placeholder 0건, 모드 모순 0건`.
