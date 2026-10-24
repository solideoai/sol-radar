---
title: "S-LIVE 운영 점검 (2026-10-24)"
doc: "slive-check-20261024"
status: partial
updated: 2026-10-24
---

# S-LIVE 운영 점검 — 2026-10-24 10:00~10:30 KST

마스터 sol-radar-78 배정(P0-4)에 따른 점검 기록이다. 최종 S-LIVE run 은 만들지 않았다. 새 수집·`pnpm demo:reset`·운영 env·회사 서버 변경은 하지 않았다. 기준 코드는 `origin/main@e7f12f3`이다.

## 결론

**갈래 미판정.** 운영 로그인을 하지 못해 1·3·4번(실공고 존재, 시험 분석 갈래, 분석 요약 띠·배지 화면)을 확인하지 못했다. 로그인 비밀번호는 `.env`의 `DEMO_SEED_PASSWORD`에만 있어 읽지 않았다. 사용자에게 자동화 브라우저 창에 직접 로그인해 달라고 요청했다. MCP 창 2회와 새 Chromium 창 1회(10분 대기)에서 모두 로그인이 들어오지 않았다. 스크린샷은 없다.

로그인 없이 확인한 사실과 추론은 아래와 같다.

## 1. 운영 health (로그인 없이)

[원본](health-unauth.tsv), 2026-10-24T01:12Z(10:12 KST).

| 주소 | 상태 | 응답 |
| --- | --- | --- |
| `https://www.solideos-radar.com/health/live` | 200 | `{"status":"ok"}` |
| `https://www.solideos-radar.com/health/ready` | 200 | `{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"local"}}` |
| `https://acropolissg.com/redis/health` | 401 | 미인증 기대값(`infra/company/README.md` §5) |
| `https://www.solideos-radar.com/api/v1/admin/ai/status` | 401 | 로그인 필요 |

10-22 기록([release](../../procurement-expansion/20261022-release.md))의 `ready 503`·회사 `502`·"회사 Gateway·Worker 미적용"과 달라졌다.

## 2. Worker·AI 모드 (코드 근거 추론, 관리자 AI 상태는 미확인)

- `checks.ai`는 Worker가 30초마다 Redis `sol-radar:dependency-health`에 TTL 120초로 남기는 보고다(`web/worker/dependency-health.ts`). Vercel(`SOL_DEPLOYMENT_ROLE=frontend`)의 `/health/ready`는 회사 redis-api의 응답을 그대로 전달한다(`web/app/_lib/application-health.ts`). redis-api는 보고의 `runMode`·Supabase URL·버킷이 자기 값과 모두 같을 때만 읽는다(`web/server/health/dependency-report.ts`). 따라서 10:12 KST에 **회사 redis-api와 같은 scope의 Worker가 살아서 보고 중**이었다.
- `ai:"local"`은 그 Worker가 본 AI gateway 공급자가 `local`이라는 뜻이다. `infra/run-modes.json`에서 `local`은 `live`·`fixture`에서만 허용되고 `mock`은 `AI_PROVIDER=mock`만 허용한다. 따라서 **회사 runtime(redis-api·Worker)의 `SOL_RUN_MODE`는 `live` 또는 `fixture`로 추정**된다. Vercel 자신의 `SOL_RUN_MODE`는 이 값으로 알 수 없다. 이후 sol-radar-78이 QUEUED run의 `run_mode=live`(회사 redis-api 값, `web/server/bids/bids.supabase.ts:518-519`)와 Vercel 머리말 "실행 모드: mock"으로 **회사 live·웹 mock**을 확인했다.
- `live`라면 Worker는 기동 즉시와 30분마다 G2B 일정 수집을 돈다(`web/worker/main.ts` `syncG2bSchedule`). 그러면 서비스 15129394 호출 예산이 이미 쓰이고 있을 수 있다. `/admin/ingestion`의 오늘 `quotaUsed`를 로그인 뒤 확인해야 한다.
- sol-radar-78의 9b 점검에서는 운영 분석이 `QUEUED`에서 멈췄다(run `6a90acc4`, 회사 Worker 미소비). health 보고가 살아 있어도 분석 큐 소비는 별개다. 원인은 78이 조사 중이다.

## 3. 최종 S-LIVE run 절차 (문서 근거)

[[19-DEMO-SCENARIO|19]] §3 4번, [[18-HACKATHON|18]] §6·§7, `infra/company/README.md`, ADR-049 기준.

1. 마지막 `pnpm demo:reset`·`pnpm demo:preanalyze`를 먼저 끝낸다. reset이 데모 조직 `score_runs`를 지우기 때문이다.
2. 회사 Worker·AI gateway를 `SOL_RUN_MODE=live`, `AI_PROVIDER=local`, `DEMO_MODE=false`로 둔다. 서비스키 4개가 필요하다(`infra/run-modes.json` `requiredSecrets`). 운영 env 변경이므로 사용자 승인이 필요하다. (정정: health 보고의 scope 검사는 회사 redis-api와 Worker 사이에서만 한다. Vercel `SOL_RUN_MODE` 는 바꾸지 않는다. 최종 절차는 [10-25 절차서](20261025-slive-kakao-runbook.md) §3이다.)
3. `GET /api/v1/admin/ai/status`(admin)에서 `runMode=live`, `qwen.healthy=true`, `kev.registryMatch=true`를 확인한다. 둘 중 하나라도 false면 결과는 `PARTIAL`·`RULES_ONLY` 갈래가 된다.
4. live Worker는 기동 즉시 24h 창 수집을 1회 돈다. `/bids?origin=all`에서 `DEMO` 배지 없는 정보화사업 공고(출처 `g2b-bid-notice`) 1건을 고른다.
5. 상세에서 "분석 실행"을 누르고 `COMPLETED`(또는 `PARTIAL`)를 확인한다.
6. 공고번호·`score_runs.id`·상태·`run_mode`·모델 식별자·갈래를 `run-modes.md`에 적고 1440·1280 스크린샷을 남긴다.
7. Worker를 `mock`으로 되돌리거나 정지한다. 30분 반복 수집이 계속 호출을 쓰기 때문이다. 이후 `/health/ready`의 `checks.ai:"mock"`을 확인한다.

소요 시간(추정): 모드 전환과 재기동 10~20분, 24h 창 수집 약 3분(10-20 실측 2분 44초), 분석 1건은 규칙만일 때 3.4초(10-20 실측)다. Qwen·번역·Bosun 실추론 분석 시간은 측정 기록이 없다. 전체 30~40분을 잡는다.

## 4. 공공 API 호출 수

근거: [10-20 격리 live run](../20261020-1434/run-modes.md), [[07-DATA-PIPELINE|07]] §2.2.

| 항목 | 호출 수(서비스 15129394, 한도 1,000/일) |
| --- | --- |
| 24h 창 첫 수집 | 실측 266 = 목록 5쪽 + 새 revision 87 × 보조 3 |
| 30분 반복 1회 | 목록 1쪽 이상 + 그 사이 새 revision × 3 (실측 없음) |
| 하루 켜 두면 | 첫 수집 약 266 + 반복 48회 × 목록 1쪽 이상 + 하루 새 정보화 revision × 3. 24h 창 하나의 revision 수가 87이었으므로 하루 약 400~600으로 추정한다 |
| 분석 1건 | 공공 API 0 |

수집 1회는 목록과 보조 조회가 같은 서비스 예산을 쓴다. 이미 `live` Worker가 오늘 돌고 있다면 남은 예산은 `/admin/ingestion`의 `quotaUsed`를 보고 계산한다. 이번 점검에서 새 수집은 실행하지 않았다.

## 남은 확인 (로그인 뒤)

1. `/bids?origin=all`에서 `is_demo=false` 공고 수와 1건의 공고번호.
2. `GET /api/v1/admin/ai/status`의 `runMode`·`gateway.runMode`·`qwen.healthy`·`kev.registryMatch`, `/admin/ingestion`의 오늘 run·`quotaUsed`.
3. 실공고 1건 시험 분석의 상태(`QUEUED` 정체 여부 포함)와 갈래.
4. 분석 요약 띠의 "분석 실행 모드", 모델 식별자, "가상 회사 프로필로 분석" 배지. 1440·1280 스크린샷.
