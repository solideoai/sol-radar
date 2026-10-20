---
title: "main c2b12d3 실DB 사전 분석 확인 (2026-10-19)"
status: done
tags:
  - sol-radar
  - test
  - phase-5
  - evidence
updated: 2026-10-19
---

# main c2b12d3 실DB 사전 분석 확인

C3(수집)·C5-B(분석 클라이언트)가 main 에 들어간 뒤, 로컬 Supabase 와 격리 Compose 스택으로 `demo:reset` → `demo:preanalyze` 를 실제로 이어 돌렸다.

## 실행 조건

- 코드: main `c2b12d3` 와 같은 트리. 실행 모드 `SOL_RUN_MODE=mock`, `AI_PROVIDER=mock`.
- DB: 로컬 Supabase(`127.0.0.1:54321`). 마이그레이션 `20261019000009`·`20261019000010` 을 `supabase migration up --local` 로 적용했다. 클라우드 DB 는 건드리지 않았다.
- Compose 프로젝트 `sol-radar-gate3e`(격리, 127.0.0.1 포트 16380·19000·16333·18000). 끝난 뒤 볼륨까지 지웠다.

## 결과

`demo:reset`:

```
seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true
```

`demo:preanalyze`:

```
preanalyze: targets=18 completed=3 partial=15 failed=0
```

| 공고 | 상태 | 권고 | 점수 | error_code |
|---|---|---|---|---|
| DEMO-2026-0001 (FX-01) | COMPLETED | BID | 94 | |
| DEMO-2026-0003 (FX-03) | COMPLETED | NO_BID | 68 | |
| DEMO-2026-0016 (FX-16) | COMPLETED | NO_BID | 78 | |
| 나머지 15건 (FX-04~20) | PARTIAL | WATCH·BID | 58~93 | AI_UNAVAILABLE |

## 결함 (담당에 전달함)

1. **gateway mock 공식 응답 형식(주 원인).** `fixtures/kev` 파일이 없는 공고에서 mock 의 03 §5.7 공식 응답 `fit` 에 `probabilities`·`confidence` 가 없다(`services/ai/src/sol_ai/adapters/mock.py:176-178`, `kev_wire.py:168-172`).
   - worker 2단계 스키마(`web/server/scoring/analysis-input.model.ts:293-297`, 03 §5.4 :494)가 이 응답을 거절한다.
   - FX-04 응답에 두 필드만 더하면 통과한다(반증 확인).
2. **fixture 누락.** 07 :350 은 `fixtures/kev` 20건 전부(FX-12 생략 가능)를 정한다. 지금은 FX-01·02·03·16 네 건뿐이다.
3. **worker 분류.** 200 인데 wire 형식이 틀린 Kev 응답을 `AI_UNAVAILABLE` 로 바꾼다(`analysis.model.ts:348-357` → `analysis.service.ts:151-156` → `fallback.model.ts:69-70`).
   - 정본 03 :737·:595 와 ADR-030 B1 은 형식 오류를 `AI_UNAVAILABLE` 이 아니라 `enabled=false`·`RULES_ONLY` 로 본다.

circuit breaker, timeout, fixtureId, 연쇄 실패는 원인이 아님을 재현으로 배제했다.

## 1차 재실행 — 3b fit 수정(c5/gateway-fit-fix 13fcb96) 병합 트리

main `c2b12d3` + `13fcb96` 병합 트리(`c1e7e5c`)로 `demo:reset` 뒤 `demo:preanalyze` 를 다시 돌렸다.

```
preanalyze: targets=18 completed=18 partial=0 failed=0
```

- 15건의 PARTIAL·AI_UNAVAILABLE 이 모두 사라졌다. FX-01 은 94·BID 그대로다.
- 공식 경로를 탄 공고 여러 건에 `MODEL_RULE_DISAGREEMENT`·`KEV_NEEDS_REVIEW` 가 붙는다. 공식 분포(WATCH 0.70 등)가 규칙 권고와 다르기 때문이다. `fixtures/kev` 20건(ee 배정)이 들어오면 다시 본다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 595·web 4382·build), services/ai 565 passed.

## 2차 재실행 — ee fixtures/kev 20건(fixtures/kev-complete b40fac8) 병합 트리

main `5d9c7ee` + `b40fac8` 병합 트리(`ba2b0eb`)의 코드와 fixture 로 `demo:reset` 뒤 `demo:preanalyze` 를 돌렸다.

```
preanalyze: targets=18 completed=18 partial=0 failed=0
```

- 18건 모두 `RULES_WITH_KEV_ASSIST` 다.
- `KEV_NEEDS_REVIEW` 는 FX-04·05·11·13·17·19·20 의 7건이다(ee 보고와 같다).
- FX-07·08·09·10·14·15 의 공식 경로 `MODEL_RULE_DISAGREEMENT` 는 사라졌다.
- **기대와 다른 것: FX-13 에 `MODEL_RULE_DISAGREEMENT` 가 남는다(BID 85, Kev WATCH).**
  - ee 의 엔진 계산(`kev-fixtures-engine-scores.md` 67행)은 인용 검증 실패를 넣어 NEEDS_REVIEW → WATCH 를 기대한다.
  - 실제 run 은 `demo:reset` 이 넣은 캐시 추출(provider MOCK, qualifications `KNOWN`, warnings 없음)을 쓴다. gateway 인용 검증(11 G4, ADR-029 A1: FX-13 → 필드 UNKNOWN + CITATION_FAILED)을 거치지 않는다.
  - 그래서 `CITATION_FAILED` 가 붙지 않고 권고가 BID 가 된다. 이 결함은 kev fixture 브랜치가 아니라 main 에 이미 있다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 603·web 4382·build), services/ai 629 passed.

## 3차 재실행 — ee 추출 시드 제거(fix/demo-extraction-seed 1ac4161) 병합 트리

main `ca3b878` + `1ac4161` 병합 트리(`6075e41`)의 코드로 `demo:reset` 뒤 `demo:preanalyze` 를 돌렸다.

- `demo:reset` 뒤 데모 공고의 `requirement_extractions` 는 0행이다. 리셋 로그에서 "추출 N건" 이 빠졌다.
- `preanalyze: targets=18 completed=18 partial=0 failed=0`. 모든 run 의 추출이 worker → gateway `/extract` 로 새로 저장됐다(provider MOCK).
- **FX-13: WATCH 85, `CITATION_FAILED`·`KEV_NEEDS_REVIEW`, `MODEL_RULE_DISAGREEMENT` 없음.** 11 G4·ADR-029 A1 기대와 같다.
- **FX-05: 추출 status `PENDING_REVIEW`**, run 은 WATCH 83·`PARSE_UNSUPPORTED`·`KEV_NEEDS_REVIEW`.
- `MODEL_RULE_DISAGREEMENT` 는 FX-03 에만 남는다(07 :313, e8 기대값).
- 확인하지 못한 것: S6(gateway 정지 + FX-01 force 재분석이 저장된 추출로 PARTIAL). `demo:preanalyze` 에 force 가 없고, 재분석 Route Handler 는 C6 에 있다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 603·web 4383·build), services/ai 629 passed.

## 4차 재실행 — b3 보안 후속·분류 수정(c5/analysis-client 6d7f914) 병합 트리

main `219d273` + `6d7f914` 병합 트리(`f131d71`)로 돌렸다. 마이그레이션 `20261019000011_finish_score_run.sql` 은 로컬 Supabase 에만 적용했다. 적용 전에 접두어 없는 `idempotency_key` 행이 0행인 것을 확인했다(진행 중·전체 모두).

- `preanalyze: targets=18 completed=18 partial=0 failed=0`. 18건 모두 `RULES_WITH_KEV_ASSIST` 다.
- 권고·점수·플래그가 3차 재실행과 같다. FX-13 은 WATCH·`CITATION_FAILED`, `MODEL_RULE_DISAGREEMENT` 는 FX-03 만이다.
- 결과 저장이 `finish_score_run` RPC 한 번으로 바뀌었다. run 마다 `score_factors` 5행과 `qualification_checks` 가 저장됐다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 635·web 4870·build), services/ai 629 passed, `worker:check` 통과.

## 5차 재실행 — ee 데모 viewer 신고(cb7b557)·ingest close-all(d054f3f) 병합 트리

main `cfe8f0a` + `cb7b557` + `d054f3f` 병합 트리(`c49fb73`)로 돌렸다. 공유 로컬 DB 는 e8 의 C6 연기 확인 뒤라 000001~000012 가 적용된 상태다.

- `demo:reset` 전 `viewer@other.invalid` 의 신고 부서·직급은 null 이었다. 리셋 뒤 SOL-D035·SOL-J011 로 채워졌다(이미 있던 Auth 계정도 갱신). 이 값이 없으면 업무 API 가 403 PROFILE_INCOMPLETE 다.
- 리셋으로 C6 연기 확인이 남긴 FX-02 FAILED run 4건이 지워졌다.
- `preanalyze: targets=18 completed=18 partial=0 failed=0`, 18건 모두 `RULES_WITH_KEV_ASSIST`, `MODEL_RULE_DISAGREEMENT` 는 FX-03 만이다.
- compose worker env 에 새 키 4개(G2B_INGEST_INTERVAL_MINUTES·ANALYSIS_STALE_*·ANALYSIS_RECONCILE_INTERVAL_MS)를 값 없이 둔 상태로 worker 가 정상 기동했다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 639·web 4872·build), services/ai 894 passed, `worker:check` 통과.
- 확인하지 못한 것: S7(다른 조직 404)은 C6 API 가 main 에 들어와야 볼 수 있다.

## 6차 재실행 — b3 보안 3차 후속(c5/analysis-client e899a09) 병합 트리

main `0c1c6fc` + `e899a09` 병합 트리(`6c6b71f`)로 돌렸다. 마이그레이션 `20261019000013_finish_score_run_status.sql` 은 로컬 Supabase 에만 적용했다. 로컬 이력에는 C6 의 000012 가 이미 있어서, 적용할 때 c6/screens 의 000012 파일을 임시로 옆에 두었다가 지웠다. 지금 로컬 이력은 000009~000013 이다.

- `preanalyze: targets=18 completed=18 partial=0 failed=0`. 18건 모두 `RULES_WITH_KEV_ASSIST`, `score_factors` 90행(18×5), `MODEL_RULE_DISAGREEMENT` 는 FX-03 만이다.
- 병합 트리 검증: db-types 일치, `pnpm verify` exit 0(루트 645·web 4946·build), services/ai 894 passed, `worker:check` 통과.

## 7차 — ee documents 큐 계약(fix/documents-queue-contract 58636d1) 병합 트리

main `1ab448a` + `58636d1` 병합 트리(`9e22a41`)로 `demo:reset` 뒤 격리 스택을 띄웠다(mock).

- `demo:reset` 뒤 첨부 18행은 모두 데모 공고이고 `download_status=PENDING` 이다.
- worker 기동 로그: `{"event":"documents.reconcile","checked":18,"queued":18,"failed":0,"nextCursor":null}`. 실제 PostgREST 에서 `bid_notices!inner(is_demo)`·or 필터·revision embed 가 해석됐다.
- Redis `bull:documents:*` job 18개 모두 `documents-<uuid>-<13자리 ms>` 모양이다. ms 는 `bid_revisions.created_at` 의 epoch ms 와 같다(2건 대조). job opts 에 attempts 3·exponential 2000·removeOnComplete 86400·removeOnFail 604800 이 들어 있다.
- `demo:preanalyze` 18/18 completed.
- 병합 트리 검증: 변경분 정책 검사, db-types 일치, `pnpm verify` exit 0(루트 653·web 5005·build), services/ai 898, `worker:check`.

## 8차 — ee compose AI 시간 제한 env(fix/compose-ai-timeouts 01fa51a)

main `a955a41` + `01fa51a` 병합 트리(`adf9c52`)로 격리 스택을 두 번 띄웠다. 공유 로컬 DB 는 C6 E2E 뒤 e8 이 되돌린 상태다(run 18건).

- `KEV_TIMEOUT_MS=8000 AI_TIMEOUT_MS=90000` 을 셸에 두고 띄우면 ai-gateway·worker 둘 다 같은 값을 받는다(`printenv`). 5개 서비스 healthy, `demo:preanalyze` 18/18.
- 두 변수를 셸에서 지우고 띄우면 두 컨테이너 모두 변수가 없다. gateway 는 기본값으로 정상 기동한다(`/health` runMode mock).
- 코드 변경이 없어 `pnpm verify` 는 main `a955a41` 결과(루트 653·web 5005·AI 898)와 같다.

## 9차 — b3 C7 인앱 알림(c7/notifications 04d9e9b) 병합 트리

main `a955a41` + `04d9e9b` 병합 트리(`40d8738`)로 확인했다. 마이그레이션 000016·000017 은 로컬 Supabase 에만 적용했다(로컬 이력에 C6 000012 가 있어 그 파일을 임시로 옆에 두었다가 지웠다). 지금 로컬 이력은 000001~000017 이다.

- psql 로 담당자(sales@soltech.invalid)가 있는 bid_reviews 1행을 넣자 REVIEW_ASSIGNED outbox 1건이 PENDING 으로 생겼다.
- C7 worker 를 띄우자 `notify.outbox` REVIEW_ASSIGNED SENT, summary checked 1·sent 1. 실제 PostgREST 에서 `findDue` 의 `.or("status.eq.PENDING,and(status.eq.FAILED,next_attempt_at.lte.<ISO>)")` 가 해석됐다.
- 만들어진 알림: type REVIEW_ASSIGNED, status SENT, channel IN_APP, link `/bids/<uuid>`, 수신자 sales@soltech.invalid, 조직 org-01. outbox 행은 PROCESSED 다. BID_CREATED 19건은 PENDING 그대로다(소비자 없음).
- 부분 인덱스 `outbox_events_notify_due_idx` 가 만들어졌다. 표가 작아 실제 계획에 쓰이는지는 확인하지 않았다.
- 확인한 뒤 `demo:reset` + `demo:preanalyze` 로 되돌렸다. run 18·알림 0·리뷰 2(seed)·REVIEW_ASSIGNED 0.
- 병합 트리 검증: 변경분 정책, db-types 일치, `pnpm verify` exit 0(루트 672·web 146파일 5278·build), services/ai 898, `worker:check`.
- ANALYSIS_COMPLETE 경로(사용자가 요청한 run 의 마감)는 요청 Route Handler 가 C6 에 있어 실DB 로 보지 못했다. PGlite 시험(outbox-dedupe.test.ts)으로만 확인됐다.

## 10차 — 3b C5-A 보안 후속 2차(c5/gateway-hardening 480ac63) 병합 트리, mock 회귀

main `a955a41` + `480ac63` 병합 트리(`b35204a`)로 `demo:reset` 뒤 `demo:preanalyze` 를 돌렸다.

- gateway `/health`: runMode mock, provider mock, questionSets `kev-qs/v0.1`(데모 기본값이 그대로다).
- `preanalyze: targets=18 completed=18 partial=0 failed=0`. 18건 모두 `RULES_WITH_KEV_ASSIST` 이고, `MODEL_RULE_DISAGREEMENT` 는 FX-03 만, `CITATION_FAILED` 는 FX-13 만이다. 이전 기준선과 같다.
- 병합 트리 검증: 변경분 정책, db-types 일치, `pnpm verify` exit 0(루트 655·web 5005·build), services/ai 1291.

## 11차 — 3b C5-A 보안 후속 3차(c5/gateway-hardening-3 6f106b8) 병합 트리, mock 회귀

main `a955a41` + `6f106b8`(480ac63 + httpcore 의존 선언·Kev 응답 1 MiB·깊이 셈 가속) 병합 트리(`c7ced48`)로 `demo:reset` 뒤 `demo:preanalyze` 를 돌렸다.

- `preanalyze: targets=18 completed=18 partial=0 failed=0`, 18건 `RULES_WITH_KEV_ASSIST`, `MODEL_RULE_DISAGREEMENT` FX-03 만, `CITATION_FAILED` FX-13 만. 기준선과 같다.
- 병합 트리 검증: 변경분 정책, `pnpm verify` exit 0(루트 655·web 5005·build), services/ai 1370.
