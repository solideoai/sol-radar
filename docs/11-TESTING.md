---
title: "11. 검증·테스트 전략과 데모 수용 기준"
doc: "11"
status: review
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-11-01
---

# 11. 검증·테스트 전략

> [!tip] 심사 포인트
> "어떻게 검증했나"에 파일 단위로 답한다. 골든 `G1`~`G11`과 실데이터 시험 `V2-01`~`V2-13`은 fixture·시험 파일·명령으로 묶여 있다(§3). 자동 시험이 없는 조건은 "자동 시험 없음"으로 적는다. 데모 체크리스트(§5)를 통과한 기록은 `docs/evidence/`에 남긴다(§6). 통과하지 못한 항목은 통과한 것처럼 적지 않는다. `S0`~`S7`은 [[19-DEMO-SCENARIO|19 데모 시나리오]]의 장면 번호이고, 평가 비교 대상 `E0`~`E4`([[21-MODEL-TRAINING|21]] §4.2)와 다르다.

## 1. 자동 테스트 매트릭스

시험 도구와 위치는 출발 템플릿의 관례를 따른다([[16-DECISIONS|ADR-017]]). 서버 도메인·Route Handler·수집·점수·worker는 모두 `web/` 안의 TypeScript라 Vitest 하나로 돌고, DB 권한은 PGlite 위의 정책 시험이 맡는다.

| 영역 | 도구 | 위치 | 필수 케이스 |
|---|---|---|---|
| 화면 단위 | Vitest(부품은 브라우저 모드 `*.browser.test.tsx`) | 대상 파일 옆 `*.test.ts(x)` | 결정 패널 역할별 활성, 출처 표시, 가정 재계산 띠 |
| 서버 도메인·Route Handler 계약 | Vitest | `web/server/<도메인>/*.test.ts`, `web/app/api/v1/*-contract.test.ts` | `sol_role`별 허용·거부([[05-API-SPEC\|05 API]]), 다른 조직 자원 404, zod 오류 코드, CSRF 헤더와 Bearer, `Idempotency-Key`, 커서 |
| DB 정책 | `node --test` + PGlite | `scripts/database.test.mjs`(`pnpm test:db`), `scripts/committed-integrations-db.test.mjs` | RLS 조직 격리, 공용 공고 표 읽기만, `sol_role` CHECK, 제약, 마이그레이션 재실행 |
| E2E | Playwright + axe | `web/e2e/`(로그인 전), `web/e2e-auth/`(로그인 뒤) | 로그인 → 목록 → 상세 → 분석 → 결정, DEMO 배지, 격리, a11y 위반 0 |
| 수집·worker | Vitest + fixtures | `web/server/ingestion/*.test.ts`, `web/worker/*.test.ts` | 정정·취소·중복·차수·429·누락, worker 쓰기의 `org_id` 지정, 호출 예산·에러코드 22, 첨부 다운로드 allowlist |
| 점수 | Vitest 골든 | `web/server/scoring/*.test.ts` | 0~100, 결정론, missing 정책, 자격 override, 결정 모델 승격 금지, 정보 부족 ≠ 미충족 |
| AI gateway | pytest | `services/ai/tests/` | `RequirementExtraction` 스키마, 인용 대조, 인젝션, 장애 대체, `/parse` 형식별 결과, 모드 모순·한국어 state 기동 거부 |
| 결정 서버 | pytest | `services/decision/tests/` | API 인증·입력 계약, backend 계산, gateway·worker wire 호환, `/v1/models` |
| 로컬 Compose | shell | `infra/smoke.sh` | 기동, 재기동 뒤 volume 유지, `/health/ready`, 큐 왕복 |

조직 격리(G5)는 세 겹이다: DB 정책 시험(RLS가 행을 숨기는지) → Route Handler 시험(숨긴 행을 404·빈 목록으로 바꾸는지) → E2E(실제 세션으로 안 보이는지). 앞의 둘은 `pnpm verify`에 들어간다.

모델 평가(추출 정확도, Macro-F1, 보정, 한국어/영어 차이, 지연)는 이 매트릭스에 없다. 통과/실패를 가르는 회귀가 아니라 측정이다(§3.4).

## 2. 실행 명령

```bash
pnpm verify                                       # 공통 검사 + web·ai·decision 프로젝트·빌드. 정본 verify.config.json
pnpm verify:changed                               # 개발 중 변경 영역만
pnpm test                                         # scripts/**/*.test.mjs (DB 정책 시험 포함)
pnpm test:db                                      # DB 정책만: supabase/migrations 를 PGlite 에 올려 검사
pnpm -C web test                                  # Vitest
pnpm -C web test:browser                          # 부품 브라우저 시험
pnpm -C web test:e2e                              # Playwright 로그인 전(web/e2e) + 부품 브라우저 시험
pnpm -C web test:e2e:auth                         # Playwright 로그인 뒤(web/e2e-auth, 로컬 Supabase·템플릿 시드)
pnpm -C web test:e2e:work                         # 업무 화면(web/e2e-auth, demo:reset·demo:preanalyze, 1440·1280)
pnpm -C web test:e2e:ingestion                    # /admin/ingestion(web/e2e-auth/admin-ingestion.spec.ts, 격리 로컬 Supabase)
uv run --project services/ai pytest               # AI gateway
bash infra/smoke.sh                               # 로컬 Compose ps + health + 큐 왕복
```

- 시험 하나만: `pnpm -C web exec vitest run <파일 또는 경로 조각> -t "<이름>"`, 루트 `node --test scripts/<이름>.test.mjs`. 아래 표의 `vitest <경로>`는 `pnpm -C web exec vitest run <경로>`, `e2e:auth`는 `pnpm -C web test:e2e:auth`의 줄임이다.
- 자동 시험은 모두 `SOL_RUN_MODE=mock`으로 돌고 실제 공공 API·회사 GPU 추론 엔드포인트를 부르지 않는다. 공공 API는 저장 응답 재생(`RecordedApiConnector`), 첨부는 `FixtureAttachmentFetcher`, 모델은 mock `ModelClient`로 대신한다.
- `test:e2e:auth`는 로컬 Supabase(`pnpm db:start`)와 `scripts/db-seed.mjs`를 전제로 하고, `web/.env.local`의 `SMTP_HOST`·`SMTP_PORT`·`MAIL_FROM`·`SITE_URL`이 필요하다(`pnpm db:start`가 채운다). 격리 실행에서는 같은 4개를 프로세스 env로 넘긴다([[16-DECISIONS|ADR-033]] E5).
- `test:e2e:work`(`web/playwright.work.config.ts`)는 로컬 Supabase·Compose 위에서 돌고, globalSetup이 `pnpm demo:reset` → 모드 확인 → `pnpm demo:preanalyze`(18건)로 데모 상태를 다시 만든다. DB를 다시 seed하므로 `pnpm verify`에 넣지 않는다.
- `infra/smoke.sh`는 Docker가 필요해 `pnpm verify` 밖에서 손으로 돌린다.
- **CI는 멈춰 있다.** GitHub Actions는 2026-10-24부터 계정 결제 문제로 job이 시작되지 않는다. 검사는 로컬 pre-push 게이트와 직접 돌린 `pnpm verify`이고 CI 통과를 근거로 쓰지 않는다.
- 개발 중에는 `pnpm verify:changed`, 통합·제출 전에는 전체 `pnpm verify`다(ADR-046, [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] "해커톤 검증 정책"). 같은 입력에서 통과한 검사를 다시 돌리지 않는다. 실패가 있으면 그 범위를 완료로 보고하지 않는다.

## 현재 MVP 자동 시험 (ADR-046)

2026-10-21 사용자 지시로 시험 파일·케이스를 실제로 지웠다. `skip`·탐색 제외는 쓰지 않는다. 지운 목록과 남긴 파일은 [정본 목록](evidence/verification/20261021-pruned-tests.json)이다. 지운 파일을 다시 만들지 않는다.

남긴 범위는 §1 매트릭스의 핵심 케이스다: 골든 94/72/68, 정보 부족·모델 장애·모델 승격 금지, 재현성·가정 재계산, 조직 격리·요청 계약, 수집 멱등·revision, 첨부 보안·키 가림, 알림 멱등·사람 결정, 기동·비용 승인 게이트.

- 축소 직후 수는 웹 23파일·286개, DB 정책 21개, AI 101개, 결정 57개, 브라우저 3파일, E2E 공개 45·인증 13·업무 16개다(정본 목록).
- 그 뒤 기능 시험이 더해져 2026-10-27 전체 `pnpm verify`는 루트 236·web 85파일 743개·`next build`·AI 166개·결정 57개였다([첨부 처리 구현 기록](evidence/attachment-pipeline/20261027-implementation.md)). 브라우저 부품 시험은 지금 20파일(`git ls-files 'web/**/*.browser.test.tsx'`)이다. 2026-10-31 구글 캘린더 연동 병합(`652741e2`) 뒤 전체 `pnpm verify`는 루트 316·web 135파일 1,097개·`next build`·AI 264개·결정 57개, exit 0이었다([[PROGRESS]]).
- 새 시험은 핵심 사용자 동작·권한·계산·저장이나 실제 결함을 직접 검증할 때만 더한다. 같은 계약을 여러 계층에서 반복하거나 상수·문구·목업 값·모든 입력 조합을 고정하는 시험은 만들지 않는다.

### 첨부 처리·파서·live 가드 시험

| 영역 | 파일 | 지키는 것 |
|---|---|---|
| 첨부 다운로드(V2-12) | `web/server/ingestion/g2b-attachment-fetcher.test.ts`, `attachment-security.test.ts` | 허용 목록 밖 요청 없음, 다른 호스트 리다이렉트 거부, 로그인 경로 `AUTH_REQUIRED`, 50 MiB 넘으면 끊음, 형식은 매직 바이트·sha256은 본문, DNS 사설 주소 거부([[09-SECURITY\|09]] SSRF) |
| documents job | `web/worker/documents-job.test.ts` | 공고당 상한, 다운로드 영구·일시 실패 구분, 파싱 실패와 gateway 불가 시 미루기, 리스 만료 재처리, 범위 밖·옛 jobId([[07-DATA-PIPELINE\|07]] "documents 큐 소비자 계약") |
| documents 전용 Worker | `web/worker/documents-only-main.test.ts` | live가 아니거나 env 값이 범위 밖이면 연결하지 않고 exit 1, 오류에 값을 싣지 않는다 |
| 텍스트 객체 읽기 | `web/server/documents/document-text.repo.test.ts` | 본문 문서 먼저, 문서당·전체 글자 상한, 계약이 다른 텍스트 객체 제외([[15-DATA-CONTRACTS\|15]] §5.5) |
| 분석 원문 판정 | `web/server/bids/analysis-readiness.test.ts`·`analysis-readiness.repo.test.ts`, `web/app/api/v1/redis-gateway-contract.test.ts` | 본문이 비어도 PARSED·PARTIAL 첨부가 있으면 202, 미파싱만 있으면 409 `ANALYSIS_SOURCE_MISSING` |
| 파서(V2-10) | `services/ai/tests/test_parse.py`·`test_health.py` | PDF·HWPX·HWP5 본문과 표 셀, 배포용·암호 HWP 미개봉, 스캔 PDF, 손상 문서, DTD 거부, 압축 폭탄, 시간 초과 시 하위 프로세스 종료, 알 수 없는 파서 설정 |
| DB 정책 | `scripts/database.test.mjs` "documents job — 문서별 처리 리스·실패 기록·처리 대상(20261027000500)" | 리스는 한 시도만, 실패 기록은 리스를 가진 시도만, 처리 대상 범위, 화면 역할 실행 금지 |
| DB 정책 | `scripts/database.test.mjs` "가입 약관 동의 기록 (20261027000600)" | 필수 동의 없으면 계정 없음, 항목별 시각, 본인만 읽고 아무도 고치거나 지우지 못함 |
| 카카오 live 가드(G11) | `web/worker/notify-outbox.test.ts` | live + 빈 발송 수단은 꺼짐·재시도 뒤 `DEAD`·claim과 알림 행 없음, live + `mock`은 경고([[13-NOTIFICATIONS\|13]]) |

실표본 측정은 자동 시험이 아니다. 실제 gateway `/parse`에 실표본 6건(PDF 2·HWPX 2·HWP 2)을 보내 web 계약(zod)을 모두 통과했고 6건 모두 `PARSED`였다(문서당 0.2~1.7초, [파서 확인](evidence/parser/20261027-parser-check.md)). 형식당 10건 사람 기준표는 아직 없다([[03-AI-PIPELINE|03]] §10.3).

### Redis HTTPS Gateway 회귀 (ADR-045)

- 범위 시험: `pnpm -C web exec vitest run app/api/v1/redis-gateway-contract.test.ts app/_lib/redis-api-client.test.ts app/_lib/deployment-role.test.ts proxy.test.ts`와 `node --test scripts/check-env.test.mjs scripts/redis-gateway.test.mjs`. 최초 인증 지연·늦은 전송 금지, 응답 헤더 뒤 연결 유실 재시도, backend AI probe 2초 뒤 200/degraded 유지, 정지된 계정의 backend 403, 잘못된 UTF-8/JSON JWT 401을 포함한다.
- 빌드 뒤 `pnpm -C web exec node --conditions=react-server --import tsx ../scripts/redis-gateway-local-smoke.mjs`는 Docker 없이 임시 Redis와 Next standalone으로 limiter·SET NX TTL·quota·BullMQ 왕복과 HTTP 차단, 308 목적지를 검사한다. 자기가 만든 프로세스·임시 파일만 정리한다.
- 회사 Redis·Nginx·실제 Supabase RLS·GPU를 거치는 E2E는 운영 증거로 따로 남긴다([[10-DEPLOYMENT|10 배포]]).
- Storage(ADR-048): `scripts/database.test.mjs` "Supabase Storage — immutable objects and private access"(정책·lease·중복 문서·복구), `web/worker/document-storage.test.ts`(실제 Supabase SDK로 immutable 업로드·checksum·응답 유실 복구), `web/server/documents/documents.service.test.ts`(60초 URL·오류 비노출), `scripts/storage.test.mjs`(bucket 비공개·한도·소유 검사)가 본다. 클라우드 Storage API·50MiB 업로드·회사 HTTPS는 운영 증거가 필요하고 PGlite나 가짜 HTTP 통과로 대신하지 않는다.

## 3. 골든 시나리오 ↔ fixture ↔ 테스트 ↔ 명령

골든 G1~G10은 `SOL_RUN_MODE=mock`에서만 단언한다. `fixture`·`live` 실모델 추출·분포는 mock과 다를 수 있으므로 골든 수치(`FX-01` 94·`FX-02` 72·`FX-03` 68, 결정 모델 71/24/5·36/52/12)를 단언하지 않는다([[16-DECISIONS|ADR-020]]). fixture ID는 [[07-DATA-PIPELINE|07 수집]] §6.2다. 시험 파일 열은 지금 저장소에 있는 파일만 적는다. 없으면 "자동 시험 없음"이고, 10-21 축소로 지운 파일은 [정본 목록](evidence/verification/20261021-pruned-tests.json)에 있다.

| # | 시나리오 | fixture | 시험 파일 | 명령 | 통과 기준 |
|---|---|---|---|---|---|
| G1 | 같은 공고 2회 수집 → bid 1건, revision 1, 이벤트 0 | `FX-09`(+`FX-10` 차수) | `web/server/ingestion/idempotent-upsert.test.ts` | `vitest server/ingestion` | `bid_notices` 1행, `bid_revisions` 1행, 알림 추가 0 |
| G2 | 마감일 변경 → revision diff, 알림 정확히 1건 | `FX-06`(+`FX-07`) | `web/server/ingestion/revision-diff.test.ts`, `web/server/notifications/outbox-dedupe.test.ts` | `vitest server/ingestion server/notifications` | 이벤트 단위 + 알림 멱등([[16-DECISIONS\|ADR-033]] E3): revision 2, diff에 `deadlineAt` 전/후, `BID_CHANGED` outbox 1건(다시 수집해도 1건), 같은 이벤트를 다시·동시에 처리해도 알림 1건(`<outboxEventId>:<userId>:IN_APP` UNIQUE) |
| G3 | 필수 업종 자격 부족 → 비추천(`NO_BID`), 결정 모델 `BID` 무시 | `FX-03`(+`FX-16`) | `web/server/scoring/kev-no-override.test.ts`(describe "G3·V2-06"), `worked-examples.golden.test.ts` | `vitest server/scoring` | 권고 비추천, `reviewFlags`에 `MODEL_RULE_DISAGREEMENT`, 점수 68 참고 표시 |
| G4 | 근거 문서 없음 → NEEDS_REVIEW/보류(`WATCH`), 수주확률 문구 없음 | `FX-04`(+`FX-05`) | `web/server/scoring/needs-review.test.ts`, `services/ai/tests/test_extraction_schema.py`, `web/e2e-auth/no-evidence.spec.ts` | `vitest server/scoring`, `pytest`, `e2e:auth` | 자격 `NEEDS_REVIEW`, 권고 보류, "수주 확률"이 "아님" 없이 단독 등장 0회 |
| G5 | 다른 orgId로 조회 → 404 | `FX-01` + `org-02` VIEWER 세션 | `scripts/database.test.mjs`("G5 — org-01 의 네 역할…"), `web/app/api/v1/tenant-isolation.test.ts`, `web/e2e-auth/bid-isolation.spec.ts` | `pnpm test:db`, `vitest app/api/v1`, `e2e:auth` | `GET /bids/{FX-01}/qualification-checks` 404, `GET /analyses/{org-01 분석}` 404, `GET /bids/{FX-01}/reviews` 빈 목록. DB에서 org-02 세션으로 org-01 조직 표 0행 |
| G6 | 결정 모델·Qwen 장애 → PARTIAL + 규칙만 | `FX-01` + `AI_FAULT_INJECT` | `web/server/scoring/analyze.partial.test.ts`, `services/ai/tests/test_gateway_fallback.py`. E2E 자동 시험 없음 | `vitest server/scoring`, `pytest` | `status=PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags`에 `AI_UNAVAILABLE`, 점수·자격 존재, 배너 문구가 09 고지와 같다 |
| G7 | API 429 → 재시도 후 성공 | `FX-20` | `web/server/ingestion/quota-ingestion.test.ts`(재시도 뒤 성공), `web/e2e-auth/admin-ingestion.spec.ts`(`summary.retried=2`). 커서 복구는 자동 시험 없음 | `vitest server/ingestion`, `test:e2e:ingestion` | 재시도 2회, 적재 1건 |
| G8 | 가상 DEMO 데이터는 가상 표시 | 전체(`FX-01` 대표) | `web/server/bids/demo-flag.test.ts`, `web/e2e-auth/demo-badge.spec.ts` | `vitest server/bids`, `e2e:auth` | 응답 `isDemo=true`, 목록·상세에 `DEMO` 칩, `?origin=demo`일 때 Topbar `DEMO` 배지, `DEMO_MODE=false`에서 fixture 미적재 |
| G9 | AI 파이프라인 수용 기준([[03-AI-PIPELINE\|03]] §9) | `fixtures/extractions/FX-01·02·03·04·05·13`, `fixtures/kev/*` | `services/ai/tests/test_extraction_schema.py`·`test_citation_verify.py`·`test_gateway_fallback.py`·`test_local_kev_v02.py`·`test_injection.py` | `pytest` | 인용 검증 실패(`FX-13`) → 필드 `UNKNOWN` + `note="CITATION_FAILED"`, `match=FAILED`, `warnings`에 `CITATION_FAILED:qualifications`(`CONFLICTED` 아님, [[16-DECISIONS\|ADR-029]] A1). 파싱 실패(`FX-05`) → `ATTACHMENT_PARSE_FAILED:*`로 `PENDING_REVIEW`(A2). 결정 모델 질문 스키마 일치 |
| G10 | 데이터 계약 수용 기준([[15-DATA-CONTRACTS\|15]] §9) | `FX-11`~`FX-14` | `NormalizedBid`·`EvidenceRef` 계약 시험 없음. 일부 필드는 `revision-diff.test.ts`·`procurement-projection.test.ts`가 지난다 | — | `NormalizedBid` 스키마, `fieldState` 4종, 원본·정규화 값 병기, null 대체 금지 |
| G11 | 추천 공고 카카오톡: 이벤트 멱등·받는 사람·한 사람 한 통([[16-DECISIONS\|ADR-038]]) | `FX-02`(S4 분석). DB 시험은 시험 안에서 만든 행 | `scripts/committed-integrations-db.test.mjs`, `web/worker/committed-features.test.ts`, `web/worker/notify-outbox.test.ts` | `pnpm test`, `vitest worker` | 사람이 요청한 run이 추천(`BID`)·보류면 `BID_RECOMMENDED` outbox 1건(키 `<orgId>:<bidId>:BID_RECOMMENDED`), 재분석해도 1건. 데모 사전 분석·비추천은 0건. 같은 이벤트를 다시·동시에 처리해도 한 사람 한 통, 결과 불분명이면 다시 보내지 않는다. 본인 연결 행만 안전한 열로 읽힌다. 시험은 `NOTIFY_KAKAO_PROVIDER=mock` |

- G11은 모델도 카카오도 부르지 않는다(`mock` 발송 수단과 가짜 `fetch`). 운영 실발송은 시험 밖에서 사용자 승인 뒤에만 했다([[10-DEPLOYMENT|10 배포]] "카카오 앱 설정"). 운영 연결은 1건(admin@solideos.com, 2026-10-30)이다. 시험 발송(`KAKAO_TEST`)은 2026-10-30 2통과 2026-11-01 1건이고, 추천 카톡은 24통(2026-10-30 23통 + 2026-11-01 녹화 1통)이다([실발송 기록](evidence/kakao-notify/20261030-prod-live-send.md), [녹화 기록](evidence/kakao-notify/20261101-recording.md)).
- `web/e2e-auth/isolation.spec.ts`는 템플릿의 조직 화면 격리 시험이다. G5 E2E는 `bid-isolation.spec.ts`다.
- E2E가 화면의 요청을 기다릴 때 화면이 본문을 읽지 않는 요청(예: 결정 제출 `201`)에 `response.json()`을 걸면 30초 timeout으로 멈춘다. 상태 코드만 본다([[16-DECISIONS|ADR-035]] F5).

장애 주입은 두 가지를 구분한다.

| 용도 | 방법 | 비고 |
|---|---|---|
| 자동 시험(G6) | `AI_PROVIDER=mock` + `AI_FAULT_INJECT=kev_timeout\|qwen_error\|gateway_down\|qwen_unreachable\|kev_unreachable` 또는 mock 장애 fixture. `gateway_down`이면 `/extract`·`/kev`·`/explain`이 `503 {"errorCode":"AI_UNAVAILABLE","message"}`(시험 전용, [[16-DECISIONS\|ADR-029]] A3) | 컨테이너 없이 Vitest·pytest에서 재현. 값과 "데모·운영 금지" 규칙은 [[03-AI-PIPELINE\|03]] §3 |
| S6 녹화 | 대체 경로에서 `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` 재분석 → `start ai-gateway` | [[10-DEPLOYMENT\|10 배포]] "장애 주입". 운영에서는 하지 않는다 |

### 3.1 골든 외 회귀 케이스

| fixture | 검증 대상 | 시험 파일 |
|---|---|---|
| `FX-08` | 취소 → 재분석 없음, 검토 기록 보존, 버튼 비활성 | `web/components/bids/decision.browser.test.tsx`(취소 공고), `web/e2e-auth/bid-decision.write.spec.ts` |
| `FX-11` | 예산·마감 null → `missingFactors` 1건 | `web/server/scoring/needs-review.test.ts`·`analyze.partial.test.ts`·`reproducibility.test.ts`. 마감 집계 제외는 자동 시험 없음 |
| `FX-12` | 필수 필드 누락 → 격리, 관리자 화면 노출 | `web/server/ingestion/idempotent-upsert.test.ts`, `web/e2e-auth/admin-ingestion.spec.ts` |
| `FX-13` | 인용 검증 실패 → 필드 `UNKNOWN` + `CITATION_FAILED` | `services/ai/tests/test_citation_verify.py`·`test_extraction_schema.py`. 금액 텍스트 정규화는 자동 시험 없음 |
| `FX-14` | 마감 임박, `DEADLINE_APPROACHING` 하루 1회 | `scripts/database.test.mjs` "N3 관심 공고와 마감 알림", `web/worker/deadline-reminders.test.ts`. KST→UTC 변환은 자동 시험 없음 |
| `FX-15` | 수행 상한 초과 → `scaleFit` 0점 + `SCALE_LIMIT_EXCEEDED`(골든 68) | `web/server/scoring/needs-review.test.ts`·`requirement-status.test.ts`·`reproducibility.test.ts` |
| `FX-17`·`FX-18`·`FX-19` | `planRef` 단계 연결, 제목 유사도만이면 병합 없음 | `web/server/bids/stage-links-scope.test.ts`, `web/server/ingestion/procurement-projection.test.ts`·`external-ingestion.test.ts`, `requirement-status.test.ts`(PLAN `STAGE_NOT_APPLICABLE`) |
| `FX-01`~`FX-03` | [[08-SCORING\|08]] §6 worked example 수치 | `web/server/scoring/worked-examples.golden.test.ts` |
| 전체 | 재현성: 같은 `input_snapshot_hash` + `algorithm_version` → 같은 점수·요소별 `points` | `web/server/scoring/reproducibility.test.ts` |
| `FX-01`~`FX-03` | 가정 재계산([[16-DECISIONS\|ADR-037]]): `FX-03` 정보통신공사업 가정 → `NO_BID` → `WATCH`, 68 → 68, 가정 0개면 원래와 같음, 이미 충족·사전 밖 코드 거절, 입력 스냅샷 불변 | `web/server/scoring/what-if.test.ts`, `web/app/(app)/(work)/bids/[id]/what-if.browser.test.tsx` |
| `FX-03` | 가정 재계산 API: 401·CSRF 403·UUID 아님 404·다른 조직 404·본문 400·진행 중 409·스냅샷 없음 404·200, 저장소 쓰기 0 | `web/app/api/v1/what-if-contract.test.ts` |

### 3.2 실데이터·실행 모드 시험 (ADR-020)

파이프라인 v0.2(세 실행 모드, 나라장터 실수집·첨부 파싱, 실추론, 결정 모델 `kev-qs/v0.2`)의 시험이다. 모두 `mock`이나 저장 응답·스텁으로 돌고 실제 네트워크를 쓰지 않는다. P0 번호는 [[12-ROADMAP|12 로드맵]]의 해커톤 우선순위다.

| ID | 자동 검증할 조건 | 시험 파일 | P0 |
|---|---|---|---|
| V2-01 | **실행 모드 모순 기동 거부.** `SOL_RUN_MODE`와 직접 준 `DEMO_MODE`·`AI_PROVIDER`·`KEV_ENABLED`가 모순되면 `pnpm check:env`와 gateway가 키 이름을 알리고 기동을 거부한다(예: `live` + `AI_PROVIDER=mock`, `live` + `AI_FALLBACK_TO_MOCK=true`). 미지정이면 `mock`. `check:env`는 파일을 읽으므로 시험도 파일(또는 `--root` 임시 트리)에 값을 적는다 | `scripts/check-env.test.mjs`, `services/ai/tests/test_startup.py`·`test_rules_parity.py` | P0-1 |
| V2-02 | **출처·모드 기록과 표시.** 분석마다 `score_runs.run_mode`·`ai_provider`·`qwen_model`·`kev_model`·`question_set_version`, 수집마다 `ingest_runs.run_mode`·`source`. 화면: Topbar에 실행 모드·AI 표시 없음, 분석 요약 띠 "분석 실행 모드: live\|fixture\|mock"과 "AI: mock" 또는 "AI: local · Qwen3.8-Flash-Next-AWQ-INT4 · Hanno-Labs/bosun-v3.1-0.6b@5e78a37c"(받은 식별자 그대로, [[16-DECISIONS\|ADR-029]] A6 D12), `DEMO` 칩, `origin=live\|demo\|all` 필터, "가상 회사 프로필로 분석" 배지 | `web/server/bids/bid-query.test.ts`, `web/components/bids/notice-origin.test.ts`, `web/app/(app)/(work)/bids/[id]/bid-detail-origin.browser.test.tsx`, `web/e2e-auth/run-mode-badge.spec.ts`, `services/ai/tests/test_mock_identity.py` | P0-1, P0-7 |
| V2-03 | **실패 유형 4종 구분.** 공공 API 실패 → `ingest_runs.status`·`ingest_errors`, 기존 공고 유지. 첨부 다운로드 불가 → `download_status=FAILED` + 사유, `DOCUMENT_DOWNLOAD_FAILED`. 파싱 실패 → `parse_status`·`parse_error_code`, `PARSE_UNSUPPORTED`. 모델 서버 미접속 → `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록. 한 유형을 다른 코드로 기록하면 실패. gateway 미접속은 G6 | `web/server/ingestion/g2b-attachment-fetcher.test.ts`·`attachment-security.test.ts`·`quota-ingestion.test.ts`(에러코드 22), `web/worker/documents-job.test.ts`, `web/server/scoring/analyze.partial.test.ts`, `services/ai/tests/test_gateway_fallback.py`·`test_local_qwen.py` | P0-2~P0-4, P0-6 |
| V2-04 | **파싱 실패 내용을 AI가 추측하지 않는다.** Qwen 입력에는 파싱된 텍스트만, 근거 없는 값은 인용 검증에서 `UNKNOWN`. 결정 모델 state에는 "RFP attachment could not be read; requirements may be incomplete" 한 줄만, 읽지 못한 문서로 만든 질문 0개. `/explain`에 파싱 실패가 밝혀진다 | `services/ai/tests/test_extraction_schema.py`(`ATTACHMENT_PARSE_FAILED:*` → `PENDING_REVIEW`), `web/server/scoring/needs-review.test.ts`(FX-05 `PARSE_UNSUPPORTED`). state 한 줄·`/explain` 문장은 자동 시험 없음 | P0-3, P0-4 |
| V2-05 | **정보 부족 ≠ 미충족.** 공고 쪽 `UNKNOWN`·`CONFLICTED` → `NEEDS_REVIEW` + `NOTICE_INFO_MISSING`·`NOTICE_CONFLICTED`. 회사 기록 없음 → `NEEDS_REVIEW` + `COMPANY_EVIDENCE_MISSING`. 모든 `NOT_SATISFIED`에 공고 근거와 회사 쪽 명시적 부정 근거가 1건 이상. API 구조화 필드가 추출보다 우선이고 다르면 `CONFLICTED` | `web/server/scoring/requirement-status.test.ts` | P0-5 |
| V2-06 | **결정 모델(Bosun)은 규칙·점수·권고를 바꾸지 못한다.** 응답을 극단값·누락·오류로 바꿔도 판정·점수·`points`·권고가 byte-동일. 바뀌는 것은 `reviewFlags`(τ=0.70 "미보정")와 참고 지표뿐. `KevAssist.disclaimer`·`UNCALIBRATED`. "충족 확률"·"수주 확률" 단독 등장 0회 | `web/server/scoring/kev-no-override.test.ts` | P0-6 |
| V2-07 | **한국어 state 운영 거부.** `/kev`에 `stateLanguage:"ko"`가 `KEV_ALLOW_KO_STATE=true` 없이 오면 `422 KO_STATE_NOT_ALLOWED`, `live`와 함께 쓰면 기동 거부. 운영 `en` state에 한글 0자(번역 누락·거부면 Bosun 호출 차단, `TRANSLATION_INCOMPLETE`). 규칙 결과는 state에 0건 | `services/ai/tests/test_translation.py`·`test_local_kev_v02.py`·`test_startup.py`, `web/server/analysis/translation-pipeline.test.ts`, `web/server/bids/translation-review-flag.test.ts` | P0-6 |
| V2-08 | **레지스트리 불일치 기동 거부.** 결정 서버 `GET /v1/models`의 `run`·`base`·`lora`·`temperature`(있으면 `revision`)가 레지스트리 `KEV_MODEL_ID` 항목과 다르면 `REGISTRY_MISMATCH`로 거부. `questionSet` 불일치는 `QUESTION_SET_MISMATCH`, `stateTemplate` 대조는 없다([[16-DECISIONS\|16]] 미결정 26-13). 가중치 sha256 대조는 회사 몫이다 | 불일치 거부는 자동 시험 없음. 일치 쪽만 `services/ai/tests/test_health.py`(`registryMatch`)·`services/decision/tests/test_models_endpoint.py` | P0-6 |
| V2-09 | **mock 대체는 명시한다.** 기본 `AI_FALLBACK_TO_MOCK=false`에서 모델 불가 → `PARTIAL`·`RULES_ONLY`, mock 결과 0건. 해커톤 동안 자동 대체를 만들지 않아 세 모드 모두 `true`면 기동 거부다([[16-DECISIONS\|ADR-030]] B11). 공공 API가 실패해도 `FixtureConnector`로 바뀌지 않는다 | `scripts/check-env.test.mjs`(`live` 케이스), `services/ai/tests/test_rules_parity.py`. 대체 동작은 만들지 않았다 | P0-1 |
| V2-10 | **파서 결과와 품질.** PDF(텍스트 레이어)·HWPX·HWP → `PARSED` + 페이지별 `charOffset`, 부분 → `PARTIAL`, 스캔 PDF·zip·xlsx·암호·배포용 HWP·50 MB 초과 → `UNSUPPORTED` + `errorCode`. 형식은 매직 바이트로 판단 | `services/ai/tests/test_parse.py`·`test_health.py` | P0-3 |
| V2-11 | **호출 예산과 서비스키 보호.** Redis 카운터 `quota:{serviceId}:{YYYYMMDD}`(KST)가 90%에 닿으면 보조 조회를 멈춘다. 에러코드 22면 그 서비스의 그날 호출만 중단. 초당 30 tps 이하. 서비스키 4개 값이 로그·오류·`ingest_errors`·응답 본문에 0회 | `web/server/ingestion/quota-ingestion.test.ts`·`service-key-redaction.test.ts`, `web/worker/quota-store.test.ts` | P0-2 |
| V2-12 | **첨부 다운로드 allowlist.** `https://www.g2b.go.kr`만, 리다이렉트는 allowlist 안에서만, DNS 재확인 뒤 사설 IP 거부, 30 s, 50 MB([[09-SECURITY\|09]] SSRF) | `web/server/ingestion/g2b-attachment-fetcher.test.ts`·`attachment-security.test.ts` | P0-3 |
| V2-13 | **`/explain` 숫자 검사.** 입력에 없는 숫자가 있으면 템플릿 문장으로 바꾸고 `fallback:true` | 자동 시험 없음. 지금 `/explain`은 늘 템플릿을 쓴다([[02-ARCHITECTURE\|02]] "경계") | P0-7 |

측정 항목(자동 시험 아님, 증거로 남긴다):

- 파서 후보 비교(U13): 실제 RFP 샘플로 후보마다 누락과 라이선스를 비교한다([[07-DATA-PIPELINE|07 수집]]).
- 실공고 파싱 성공률(P0-3): 실제 공고 30건의 형식별 성공률. 목표치는 두지 않는다. 증거 자리는 `phase-2/parse-success-rate.md`이고 아직 없다([[03-AI-PIPELINE|03]] §10.3).
- Qwen 실추출 인용 검증 통과율과 실공고 1건 E2E 로그(P0-4), Bosun 응답 원문·`stateTrace`(P0-6). 증거는 `phase-5/`.

### 3.3 외부 의존성 점검 (P0-0)

결과는 `docs/evidence/phase-0/external-deps.md`에 항목마다 날짜·명령·결과(통과/막힘/대기)·막힌 이유로 적는다. 막힌 항목은 사용자에게 보고하고 "막힘"으로 남긴다.

| # | 확인할 것 | 남길 것 |
|---|---|---|
| ① | data.go.kr 오퍼레이션별 실제 응답 3건, 필드 매핑 | 오퍼레이션·`resultCode`·확인한 필드. 담당자 정보를 마스킹한 뒤 `RecordedApiConnector` 계약 시험에 쓴다 |
| ② | 공고 3건의 첨부 실제 다운로드 | 로그인·세션 필요 여부, HTTP 상태, 형식([[16-DECISIONS\|16]] 미결정 16) |
| ③ | 회사 vLLM API(`https://acropolissg.com/vllm/v1`)와 `sol_decision`(운영 `http://127.0.0.1:8009`, 회사 호스트 루프백. 공개 경로 `/sol-radar/kev`는 회사 nginx에 없다). 단계 G1~G6은 [[16-DECISIONS\|ADR-025]] 7번 | G1~G6 결과, `/v1/models`·레지스트리 대조, 지연 p50·p95([[03-AI-PIPELINE\|03]] §5.9 G3), guided JSON. GPU 메모리는 회사가 주는 값만 적는다(미결정 3·17·24) |
| ④ | 실제 RFP 샘플로 파서 후보 비교 | 후보·라이선스·누락 관찰 |

서비스키와 엔드포인트 키 값은 적지 않는다.

### 3.4 모델 평가 ([[21-MODEL-TRAINING|21 모델 학습]]에 위임)

평가는 실제 공고에서 모델이 얼마나 맞히는지를 재는 측정이다. 지표·비교 대상·오류 분석·수용 기준의 정본은 [[21-MODEL-TRAINING|21]] §4·§7이다.

- 평가셋: 실제 공고 × 가상 기업 원형 6개, test 20·dev 10 사업, 사람 검수는 추출 정답 20건과 의미 대응 라벨 150건 이상.
- 비교 E0(규칙만)·E1'(공개 Bosun zero-shot, 영어 state)·E2(한국어 state)·E3(Qwen3.8-Flash-Next logprob 대조군)·E4(LoRA)는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다([[16-DECISIONS|ADR-034]], [E3 실험 설계](plans/2026-10-19-e3-experiment-design.md)).
- 모든 지표에 부트스트랩 95% 신뢰구간과 표본 수를 적는다. 초기 목표(Macro-F1 0.80, 정보부족→미충족 혼동률 5%, 보정 후 ECE 0.08)에 못 미쳐도 자동으로 파인튜닝하지 않는다. 사람이 정한다.
- 명령은 `uv run python -m sol_eval …`이고 `pnpm verify`에 넣지 않는다. 숫자 요약만 `docs/evidence/eval/`에 두고 RFP 원문은 넣지 않는다.

## 4. 수용 기준 (Phase별)

| Phase | 통과 조건 | 증거 |
|---|---|---|
| 0 | 로컬 Compose 4개 서비스 healthy, web `/health/live`·`/health/ready` 200(`checks.db` = Supabase 연결). worker가 `web/server` 도메인 코드를 불러 기동(`--conditions=react-server`). `pnpm verify` 통과. `pnpm check:env` 모드 모순 거부(V2-01). P0-0 점검 결과를 항목별로 기록(§3.3) | `phase-0/compose-ps.txt`, `health-ready.json`, `test-report.txt`, `run-mode-check.txt`, `external-deps.md` |
| 1 | `pnpm test:db` 통과(RLS·`sol_role` CHECK·조직 격리, 마이그레이션 재실행). 새 표마다 정책 시험. `pnpm db:push`는 사용자 확인 뒤. seed 2회 멱등. G5 | `phase-1/test-db.txt`, `migrate.log`, `test-isolation.txt` |
| 2 | G1·G2·G7·G10 + §3.1 수집 케이스, `SEED` summary `{created:19, quarantined:1, retried:2}`. V2-03(공고·첨부)·V2-10·V2-11·V2-12, 단계 연결(P0-8). live 수집 요약(P0-2)과 실공고 형식별 파싱 성공률(P0-3) | `phase-2/test-ingestion.txt`, `seed-summary.json`, `ingest-run-live-<일시>.json`, `parse-success-rate.md` |
| 3 | E2E 로그인 → 목록 → 상세, axe 위반 0, G8, V2-02 화면 부분, NAV(§9) | `phase-3/e2e/*.png`, `axe-report.json` |
| 4 | G3·G4 + worked example 3건, missing 정책, 재현성(`mock`). V2-05, V2-06 점수 부분 | `phase-4/goldens-report.txt`, `coverage-summary.txt` |
| 5 | G6·G9, V2-04·V2-06~V2-09·V2-13, `mock` 전체 흐름. 실추론: 인용 검증 통과율과 실공고 1건 E2E 로그(P0-4), Bosun 응답 원문·`stateTrace`(P0-6). 실추론 증거가 없는 항목은 미검증으로 적는다 | `phase-5/ai-fallback.txt`, `test-ai.txt`, 실추론 로그 |
| 6 | 결정 기록 → 감사로그, 알림 1건 규칙, E2E | `phase-6/e2e/*.png`, `test-notifications.txt` |
| 7 | §5.1 전 항목(대체 경로는 §5.2의 S5·S6), 비밀값 로그 유출 0, `pnpm verify`·E2E·smoke PASS, 대체 경로 리허설(세 모드·엔드포인트 미접속 → `PARTIAL`·`RULES_ONLY` → 재접속) | `demo-day/<일시>/checklist.md`, `run-modes.md` |
| 평가 트랙 | P0-9~P0-11과 Bosun LoRA(F1·F2·F3)는 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]])이다. 기준은 [[21-MODEL-TRAINING\|21]] §7 | `eval/`, `bosun-train-feasibility.md`(실행 뒤) |

**가정 재계산(ADR-037 BOOST-2) 통과 조건**: ① 단위·계약 시험(§3.1 `FX-03` 두 행): 정보통신공사업 가정 → 비추천 → 보류, 68 → 68, 쓰기 0. ② 브라우저 시험: 띠가 원래·가정 권고와 점수를 그리고, 고정 문구 두 줄("가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다." / "결정 모델 의견은 가정에 포함하지 않았습니다.")이 정확히 같고, "확률"·"승률"·"가능성"·"수주"·"%"가 없고, 연타하면 마지막 응답만 그리고, 결정 패널 권고가 그대로다. ③ E2E(`test:e2e:work`, `web/e2e-auth/what-if.write.spec.ts`): sales → `FX-03` → 스위치 → "비추천 → 보류"·"68 → 68" → 결정 패널 비추천 → 새로 고침 뒤 띠 없음 → `GET /api/v1/bids/{FX-03}/reviews` 건수 불변, 1440·1280 스크린샷. ④ `pnpm verify` 통과, 골든 94/72/68 불변. 증거는 `docs/evidence/boost2/`.

## 5. 데모 수용 체크리스트

발표 본편은 덱과 녹화 클립이다([[16-DECISIONS|ADR-054]], [[19-DEMO-SCENARIO|19 데모 시나리오]]). 녹화 촬영과 질의응답 라이브는 운영 사이트(D1)이고, S5·S6은 로컬 Compose에서 녹화한다. 체크리스트는 촬영 전과 리허설 때 통과시키고 `docs/evidence/demo-day/YYYYMMDD-HHMM/checklist.md`에 ✅/❌와 스크린샷 이름으로 기록한다. ❌ 항목은 발표에서 "미구현"으로 말한다. 통과한 척하지 않는다.

데모 계정은 `admin@solideos.com`, `sales@soltech.invalid`, `analyst@soltech.invalid`, `viewer@soltech.invalid`(`org-01`), `viewer@other.invalid`(`org-02`)다. 비밀번호는 `DEMO_SEED_PASSWORD`에만 두고 문서에 쓰지 않는다.

### 5.1 D1 본선(촬영·라이브)

운영 사이트 `https://www.solideos-radar.com`에서 한다. 실행 모드는 운영 그대로 `live`다. 명령과 이유는 [[10-DEPLOYMENT|10 배포]] "D1 당일 운영 확인"이다.

| # | 장면 | 단계 | 행동 | 기대 화면·응답 | 실패 시 대체 |
|---|---|---|---|---|---|
| D0 | S0 | 운영 상태 | `curl -sS https://www.solideos-radar.com/health/ready` | 200, `db`·`redis`·`storage` ok, `ai: local`. 응답을 `health-ready.json`으로 저장 | AI만 불가면 `degraded`이고 S4는 규칙만 결과로 설명한다. 503이면 녹화 클립으로 진행하고 사실대로 말한다 |
| D1 | S0 | 로그인 | `sales@soltech.invalid`로 `/auth/login` | `/dashboard`. `?origin=demo`를 붙이면 Topbar `DEMO` 배지. Topbar에 실행 모드·AI 표시는 없다 | `admin@solideos.com`로 대체 |
| D2 | S2 | 대시보드 | `/dashboard?origin=demo` | "공공조달 요약" 숫자 띠(신규 발견·마감 임박 (7일)·분석 대기·추천 권고·진행 중 입찰 프로젝트)와 목록([[06-UI-UX\|06]] §5.3) | 숫자가 리허설 기록과 다르면 기록만 하고 진행 |
| D3 | S2 | 목록 | `/bids?origin=demo`, 권고 추천 필터, 점수 내림차순 | 모든 행 `DEMO` 칩, `FX-12` 미노출. 11열이고 1440·1280에서 표 안에서만 가로 스크롤(페이지 가로 스크롤 없음) | — |
| D4 | S3 | 상세·규칙 우선 | `FX-01` | 자격 3건 충족(회사 확인 출처)·92 추천·점수 분해 5행·근거 드로어 원문 하이라이트. 결정 모델 분포(비추천 쪽)와 `규칙 우선` 배지(`MODEL_RULE_DISAGREEMENT`), 추천 분석 패널 `DONE`·`MODEL`(버튼은 누르지 않는다). 값은 [[19-DEMO-SCENARIO\|19]] §2.2 | 드로어 실패 시 원문 링크 새 탭 |
| D5 | S3 | 가정 재계산 | `FX-16` "방산업체 지정" 보유 가정 → [가정 지우기] | 띠 보류 → 보류, 70 → 70, 필수 자격 확인 필요 → 충족, 고정 문구 두 줄, 결정 패널 보류 70 그대로, `bid_reviews` 불변 | 스위치가 없거나 실패하면 D4까지만 |
| D6 | S4 | 즉석 재분석 | `FX-02` → [재분석]. 촬영·발표 때만 누른다 | 202 → `완료`. 예상 점수와 운영 기록 66 보류 설명은 [[10-DEPLOYMENT\|10]] "D1 당일 운영 확인" 3번이다 | 60초 넘으면 새로고침하고 사유 기록. 실패하면 66 보류 기록으로 설명 |
| D7 | S4 | 사람 결정 | `FX-02` 결정 패널에서 결정 + 사유 + 담당자(발표자) → [결정 기록] | "마지막 결정: … · 담당자 · 시각", `bid_reviews` +1, 감사로그 1건, 알림 벨에 `REVIEW_ASSIGNED`. `analyst@soltech.invalid`로 보면 읽기 전용 | — |
| D8 | S-LIVE | 실공고 | `/bids?origin=live` → 분석된 실공고 1건 | `DEMO` 칩 없음, 출처 `g2b-bid-notice`, 원문 링크 실제 URL, 요약 띠 "분석 실행 모드: live"·"AI: local · Qwen3.8-Flash-Next-AWQ-INT4 · Hanno-Labs/bosun-v3.1-0.6b@5e78a37c"·"공개 자료 회사 프로필로 분석"([[16-DECISIONS\|ADR-052]]) | 분석된 실공고 run이 없으면 찍지 않고 발표에서 그렇게 말한다([[19-DEMO-SCENARIO\|19]] §3) |
| D9 | S7 | 격리 | `viewer@other.invalid` token으로 `GET /api/v1/bids/{FX-01}/qualification-checks`·`GET /api/v1/analyses/{org-01 분석 id}` | 둘 다 404. 화면에서는 `FX-01` 본문만 보이고 점수·자격·검토 없음 | 운영에 `org-02` 계정이 없으면 5.2의 16번으로 찍는다 |
| D10 | — | 하지 않는 것 | — | 운영 DB `pnpm demo:reset` 없음, 실행 모드 전환 없음, 리허설 중 `FX-02` 재분석 없음(하면 59 보류가 최신으로 저장되어 "미분석 → 재분석" 장면이 사라진다, [[10-DEPLOYMENT\|10]] "D1 당일 운영 확인" 5번), 운영 장애 주입 없음 | — |
| D11 | 마감 | 증거 | 각 단계 스크린샷 | `demo-day/<일시>/screenshots/` | — |

### 5.2 대체 경로(로컬 Compose, S5·S6 녹화)

S5·S6 녹화, 운영에 `org-02` 계정이 없을 때의 S7, 운영 사이트를 쓸 수 없을 때 쓴다. 격리 로컬 Supabase(`pnpm db:start`)와 `SOL_RUN_MODE=mock`이고, 기대 수치(94·72·68, 결정 모델 71/24/5·36/52/12)는 mock 골든이다([[19-DEMO-SCENARIO|19]] §2·§3.2). 기동 절차는 [[10-DEPLOYMENT|10 배포]] "대체 경로·녹화용(S5·S6) 기동 절차"다. 운영 DB에는 아무것도 돌리지 않는다.

| # | 장면 | 단계 | 행동 | 기대 화면·응답 | 실패 시 대체 |
|---|---|---|---|---|---|
| 0 | S0 | 환경 | env가 `SOL_RUN_MODE=mock`·`AI_FALLBACK_TO_MOCK=false`이고 로컬 Supabase를 가리키는지, web은 URL/anon만·service role은 worker/seed만인지 `pnpm check:env`로 확인(값은 출력하지 않는다). 포트 3000 비어 있음 | — | 포트 충돌 프로세스 종료 |
| 1 | S0 | 엔드포인트(`live`·`fixture` 리허설만) | 회사 GPU 추론 엔드포인트 G1·G2 확인([[10-DEPLOYMENT\|10]]) | `GET /v1/models` 응답과 레지스트리 대조 | 미접속이면 `mock`만으로 진행 |
| 2 | S0 | 기동 | `docker compose -f infra/compose.yaml up -d --build` 후 `ps` | 4개 서비스 `healthy`, web `/health/ready` 200, `checks.ai: mock` | 1회 재기동, 그래도 실패면 녹화 생략 |
| 3 | S0 | seed | `pnpm demo:reset` | 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`, `ingest_runs.summary` `{created:19, quarantined:1, retried:2}`, `bid_reviews` 2건(`FX-01` 추천, `FX-03` 비추천) | seed 재실행(멱등) |
| 4 | S0 | 세 모드(리허설) | `live` → `fixture` → `mock` 순서로 바꾸며 worker·ai-gateway 재시작, 모드마다 `GET /api/v1/admin/ai/status`(ADMIN). 마지막은 `mock` | 기동 거부 없음, `runMode` 일치, `live`·`fixture`는 `qwen.healthy: true`·`kev.registryMatch: true`(gateway `/health` 기준이라 기동 뒤 죽은 모델 서버는 못 잡는다, [[16-DECISIONS\|ADR-035]] F6). `live` 오늘 호출량은 Redis 예산 카운터(`redis-cli GET quota:<serviceId>:<YYYYMMDD>`, KST)와 `/admin/ingestion` 실행 상세 `quotaUsed`로 본다. `run-modes.md`에 기록 | 기동 거부면 모순 키를 고친다. 실패한 모드는 빼고 기록 |
| 4a | S0 | 사전 분석 | `mock`에서 `pnpm demo:preanalyze`(사용자 확인 뒤). 그 뒤 reset을 돌렸으면 다시 한다 | 18건(`FX-02`·격리 `FX-12` 제외) `COMPLETED`. `MODEL_RULE_DISAGREEMENT`는 `FX-03`에만, `KEV_NEEDS_REVIEW`는 `FX-04`·`05`·`11`·`13`·`17`·`19`·`20`([[16-DECISIONS\|ADR-031]] C11) | 실패 건 기록 |
| 5~11 | S2~S4 | 전체 대체일 때만 | 5.1의 D1~D7과 같은 경로(`localhost:3000`, `?origin=demo`). D4·D5는 로컬 `mock` 대본으로 `FX-01` → `FX-03`, `FX-03` "정보통신공사업 등록" 보유 가정(비추천 → 보류, 68 그대로)이다([[19-DEMO-SCENARIO\|19]] §2). S4는 미분석 `FX-02`에 [분석 실행] | `FX-01` 94·분해 24.0/25.0/20.0/15.0/10.0·결정 모델 71/24/5, `FX-03` 비추천 68, `FX-02` 72 보류·15.0/18.3/14.0/15.0/10.0·36/52/12(10초 이내 `완료`), 대시보드 추천 권고 `FX-01` 94·`FX-18` 82·`FX-06` 78 | 숫자 불일치는 기록 |
| 12 | S5 | 변경 수집 | `/admin/ingestion`(`admin@solideos.com`) → 수동 수집 `LIVE`(fixture의 live 배치, `SOL_RUN_MODE=live`면 `409 RUN_MODE_MISMATCH`) → `FX-07` [재분석](수집은 분석을 넣지 않는다, [[16-DECISIONS\|ADR-031]] C15) | 🔔 +1(`FX-07` 재분석의 `ANALYSIS_COMPLETE`). `FX-07` revision 2 → 68 → 77(엔진 77.3), 보류 → 추천. `FX-06` diff 마감 +14 → +28, `BID_CHANGED` outbox 1건(벨 알림 없음). `FX-09` revision 늘지 않음. `FX-08` `취소됨`. summary `{changed:3, cancelled:1, skippedDuplicate:1}` | 수집 실패 시 이력 표 오류를 보이고 다음 장면 |
| 13 | S6 | 장애 주입 | `docker compose -f infra/compose.yaml stop ai-gateway` → `FX-01` [재분석] `force=true` | 수 초 안에 `부분 완료 (규칙만)`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)", `RULES_ONLY`, 요약 띠 "· 응답 없음(규칙만)", `/health/ready` `degraded`. 점수 94·자격 3건 그대로 | 다시 찍는다 |
| 14 | S6 | 복구 | `docker compose -f infra/compose.yaml start ai-gateway` → `healthy` → `FX-01` [재분석] | `완료`, 요약 띠 `AI: mock`, 결정 모델 분포 다시 표시 | — |
| 15 | S6(리허설) | 엔드포인트 재접속 | `fixture`로 바꾸고 엔드포인트를 노트북에서 차단([[10-DEPLOYMENT\|10]] 기동 절차 10번) → 재분석 → 해제 → `GET /v1/models` → 재분석 → `mock`으로 되돌리고 `pnpm demo:reset` → `pnpm demo:preanalyze` | 끊긴 동안 `PARTIAL`·`RULES_ONLY`, `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`(`AI_UNAVAILABLE` 아님), mock 결과 0건. 재접속 뒤 `완료`. 소요 시간을 `rehearsal-log.md`에 기록 | 재접속이 안 되면 `mock`만 |
| 16 | S7 | 격리 | `viewer@other.invalid` token으로 D9와 같은 요청 | 둘 다 404([[09-SECURITY\|09]] IDOR, RLS) | API 응답 JSON으로 대체 |
| 17 | S7 | 관리자 | `/admin/ingestion` | `SEED` run에 격리 1건(`FX-12`, `fixture:DEMO-2026-0012` `MISSING_REQUIRED_FIELD` `missing: title`), `FX-20` 재시도 2회(`summary.retried`, [[16-DECISIONS\|ADR-035]] F5) | — |
| 18 | 마감 | 증거 | 각 단계 스크린샷, `compose-ps.txt`·`isolation-404.json` | `demo-day/<일시>/` | — |

## 6. 심사용 증거 산출물 (`docs/evidence/`)

```text
docs/evidence/
  README.md                         # 주장 → 증거 파일 색인 (심사위원용)
  phase-0/  compose-ps.txt  health-ready.json  test-report.txt  run-mode-check.txt  external-deps.md
  phase-1/  test-db.txt  migrate.log  test-isolation.txt  seed-summary.json
  phase-2/  test-ingestion.txt  ingest-run-live-<일시>.json  parse-success-rate.md
  phase-3/  e2e/*.png  axe-report.json
  phase-4/  goldens-report.txt  coverage-summary.txt
  phase-5/  test-ai.txt  ai-fallback.txt  (실추론 로그)
  phase-6/  test-notifications.txt  e2e/*.png
  boost2/                                  # ADR-037 가정 재계산 통과 조건 ③
  eval/                                    # 평가 숫자 요약 (21 §4, RFP 원문 금지)
  demo-day/ rehearsal-log.md               # 리허설 날짜·소요 시간·실패 단계·재접속 소요 시간
  demo-day/ YYYYMMDD-HHMM/  checklist.md  run-modes.md  health-ready.json  screenshots/*.png  isolation-404.json
```

규칙:

- 시험 출력은 명령 전체 stdout을 그대로 저장한다. 첫 줄에 실행 명령과 커밋 해시 또는 날짜.
- 스크린샷 파일명은 `YYYYMMDD-phaseN-<route>-<state>-<width>.png`([[17-CLAUDE-IMPLEMENTATION|17]]). `state`는 `loaded | empty | loading | error | forbidden | partial | demo-badge | what-if`([[06-UI-UX|06 UI]] §12), `width`는 1440·1280. 데모 촬영은 `phaseN` 자리에 `demo`를 쓴다.
- 커버리지는 요약만 둔다. 실패한 실행도 `-FAIL`을 붙여 저장한다.
- 비밀값·토큰이 든 로그는 저장 전에 마스킹한다([[09-SECURITY|09 보안]]). 실제 공공 API 응답은 담당자 정보를 빼고, 서비스키가 든 요청 URL은 남기지 않는다.
- 실제 RFP 원문은 넣지 않는다. 숫자·건수·형식만 적는다([[16-DECISIONS|16]] 미결정 18).

| 주장 | 어디서 확인 | 증거 파일 |
|---|---|---|
| 같은 입력이면 같은 점수 | [[08-SCORING\|08]] §6 | `phase-4/goldens-report.txt` |
| 규칙이 결정 모델을 뒤집지 못한다 | G3, V2-06 | `phase-4/goldens-report.txt`, `FX-03` 상세 스크린샷 |
| AI 없이도 완결된다 | G6 | `phase-5/ai-fallback.txt`, `*-demo-bid-detail-partial-1440.png` |
| 조직 간 데이터 격리 | G5 | `phase-1/test-db.txt`, `demo-day/*/isolation-404.json` |
| 중복 수집·중복 알림 없음 | G1, G2 | `demo-day/20261021-1144/s5-ingestion.txt`(같은 공고 재수집 `skippedDuplicate` 1, FX-09 revision 1 그대로). 알림 멱등 시험 출력 파일은 없다 |
| 가상 데이터를 가상이라고 표시 | G8 | `phase-3/e2e/*demo-badge*.png` |
| 자동 시험은 실제 외부 API·모델을 부르지 않는다 | §2 | 증거 파일 없음 |
| 실제 나라장터 공고를 수집해 분석한다 | P0-0·P0-2 | `phase-0/external-deps.md`, `company-rollout/20261029/ai-gateway-rollout.md` |
| 처리할 수 없는 첨부는 확인 필요로 표시한다 | V2-03·V2-10 | [파서 확인](evidence/parser/20261027-parser-check.md). 실공고 형식별 성공률(`phase-2/parse-success-rate.md`)은 아직 없다 |
| 정보 부족을 미충족으로 판정하지 않는다 | V2-05 | `phase-4/goldens-report.txt` |
| mock 결과를 실제 모델 결과처럼 보이지 않는다 | V2-02, V2-09 | `phase-5/ai-fallback.txt` |

## 7. MVP 완료 조건

제출 전 최종 코드에서 `pnpm verify`(서식·타입·린트·단위·DB 정책·두 Python 서비스 pytest·빌드)·E2E·smoke가 모두 PASS다. `verify`에 든 시험은 같은 입력에서 다시 돌리지 않는다(ADR-046). 시연 흐름(§5) 통과, API 비밀 로그 유출 없음, 수집 중복 없음, 모든 점수에 근거·`algorithm_version`·프로필 revision, 사람 최종 결정이 `bid_reviews`와 감사로그에 남는다. 성능은 실측치를 기록하고 비현실적인 수치를 성공으로 주장하지 않는다.

해커톤 MVP는 실제 나라장터 수집과 회사 GPU 추론 엔드포인트의 실추론(Qwen3.8-Flash-Next·Bosun v3.1 0.6B, [[16-DECISIONS|ADR-025·034]])까지 포함한다. 데모 필수 P0의 완료 기준은 [[12-ROADMAP|12 로드맵]]이다. 실모델 경로는 증거가 있는 항목만 검증됨으로 적고 나머지는 **미검증**이다. hosted 경로는 사용자 승인 전에는 쓰지 않는다. 평가·Bosun LoRA는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.

## 8. 솔리데오 인력·가입 수용 기준 (ADR-019)

골든과 구분해 PPL 번호를 쓴다. 검증 기록은 [명부 통합](evidence/people/20261016-people-integration.md)·[가입·인력 저장 정합화](evidence/people/20261016-adr021-people-integration.md)·[승인 사진 통합](evidence/people/20261017-portraits-integration.md)·[조직·인력 조회](evidence/people/20261019-people-read.md)에 있다.

| ID | 자동 검증할 조건 | 위치 / 명령 |
|---|---|---|
| PPL-01 | 명부 200명·고유 ID/이름 200·남녀 100/100·한글 세 글자·원본 정규화 이름과 교집합 0. 부서 계층: 순환·없는 `parentId`·자기 참조·깊이 3 초과·팀이 아닌 직원 소속은 실패([[16-DECISIONS\|ADR-021]]) | `pnpm people:check:fixtures`(`scripts/people/check.mjs`). 원본 대조는 아래 로컬 절차 |
| PPL-02 | 팀별 목표 합 200·최대 나머지 배분·직급/부서 참조 유효·재실행 결정론 | 같은 명령 |
| PPL-03 | portrait manifest READY 200·고유 경로/해시 200·PNG·정사각형·남녀 100/100 | `pnpm people:check:release` + 정장·서로 다른 얼굴·품질 사람 검수표 |
| PPL-04 | 인력 200명 seed 2회 멱등·기존 5계정 ID 유지·명부 seed가 Auth를 만들지 않음·카탈로그/인력 RLS 격리·가입 신고 정보로 권한 상승 불가 | `scripts/database.test.mjs` "솔리데오 카탈로그·명부·점수 정책", `scripts/people/*.test.mjs` |
| PPL-05 | 이메일 가입의 부서·직급 필수·위조 코드 거부·본인 정보만 저장. 약관 필수 셋이 없으면 계정 없음 | `scripts/database.test.mjs` "가입 약관 동의 기록 (20261027000600)". 가입 화면 스키마는 이메일 도메인 고정만 `web/app/auth/sign-up/sign-up-schema.test.ts` |
| PPL-06 | 간편 가입·필수 정보 보완·업무 화면/API 우회 차단·가입이 자동 조직 합류를 만들지 않음 | 자동 시험 없음. 1440·1280·키보드는 손으로 확인 |
| PPL-07 | 200명 전원 계산 대상·고정 기간 가용 95.5 FTE([[16-DECISIONS\|ADR-043]]), 기간 경계·동시 배정, 골든 94/72/68과 FX-15 68, 운영 편집 뒤 기존 `score_runs` 불변 | `web/server/scoring/*.test.ts`(`vitest server/scoring`), `scripts/database.test.mjs` "N4b 직원 추가·이동·퇴사 (20261024000400)" |

| 명령 | 검사 범위 |
|---|---|
| `pnpm people:check:fixtures` | 저장된 카탈로그·명부·manifest 구조, 배분·참조·남녀 100/100·200명 가상 역할·자격증·실적·가용성·기존 배정 7건·95.5 FTE. 원본·이미지 파일은 요구하지 않고 `sourceComparison: "not-run"` |
| `pnpm people:check -- --input /절대경로/people.xlsx` | fixture 검사 + 원본 해시·250행(팀 175 + 제외 75)·팀명/직급 가중치·ID 재현·정규화 원본 이름 일치 0. 성공 시 `sourceComparison: "passed"`, 원본 누락은 `SOURCE_REQUIRED` |
| `pnpm people:check:release -- --input /절대경로/people.xlsx` | 원본 대조 + READY 200·고유 경로/해시·PNG/정사각형·실제 SHA-256. PLANNED는 `PORTRAITS_INCOMPLETE` |

- 원본 엑셀·실명 제외 집합은 저장소와 자동 시험에 넣지 않는다. 원본 없는 초록불은 로컬 원본 대조 완료가 아니다. 결과는 오류 코드와 안전한 인물 ID만 출력한다.
- 팀 구역과 사용자 승인 비팀 제외 구역이 원본 인력 행을 중복 없이 모두 분류해야 한다. 양쪽에 걸리거나 어디에도 없는 행은 실패한다.
- 이미지 해시가 다르다는 사실만으로 서로 다른 얼굴을 보장하지 않는다. 사람 검수를 한 것처럼 기록하지 않는다. 이미지 생성은 시험에서 부르지 않는다.

## 9. 사이드바·업무 확장 수용 기준 (ADR-021)

| ID | 자동 검증할 조건 | 시험 파일 |
|---|---|---|
| NAV-01 | 업무 역할 5개(ADMIN·SALES·ANALYST·EXECUTIVE·VIEWER, `web/server/organization/business-access.model.ts:5`)별 사이드바 노출과 URL 직접 접근 거부(403·404) | 자동 시험 없음. 템플릿 역할은 `web/e2e-auth/permissions.spec.ts` |
| NAV-02 | `/ops`: 비운영자·조직 ADMIN 모두 404 | 자동 시험 없음 |
| NAV-03 | 현재 조직: 업무 멤버십 0개 초대 안내 / 1개 진입 / 2개 이상 `403 UNSUPPORTED_ACCOUNT_STATE`. 요청의 조직 ID는 무시·거부 | 자동 시험 없음. 업무 역할 판정은 `web/server/organization/business-access.service.test.ts` |
| NAV-04 | 조직·인력 조회: 200명, 3단 트리, 상위 표시 인원 = 하위 팀 합, 검색·필터, 다른 조직 0행 | `scripts/database.test.mjs` "솔리데오 카탈로그·명부·점수 정책". 화면은 자동 시험 없음 |
| NAV-05 | 데이터 수집 관리: ADMIN 외 403(서버 가드 + RLS), 빈 상태, 출처·실행 모드 표시 | `web/e2e-auth/admin-ingestion.spec.ts`, `web/app/(app)/(work)/admin/ingestion/manual-gate.test.ts`·`service-collect.test.ts` |
| NAV-06 | 대시보드 분석 현황: 공고별 최신 1건 집계, `force` 재분석 뒤 이중 집계 없음 | `scripts/database.test.mjs` "ADR047 — 재분석·단계 연결·출처 충돌·재판정에도 현재 결과와 집계가 정확하다" |
| NAV-07 | 설정 조직 탭: 비ADMIN 403·RLS 거부, 업무 역할 변경 감사 | `web/server/organization/org-settings-access.test.ts`, `scripts/database.test.mjs` "N2 audits changed roles…"·"업무 역할 변경은 그 조직의 ADMIN 만 한다…" |
| NAV-08 | 템플릿 설정·가입 정보 보완(PPL-05·06) 회귀 없음 | PPL-05·06과 같다 |
| NAV-09 | 메뉴 노출과 라우트 접근 분리: 미인증은 기존 인증 정책(화면 로그인 안내, API 401), 미출시 경로 404, 구현된 경로는 메뉴와 별개로 허용 역할 200, 권한 없는 역할 403 | 자동 시험 없음(10-21 축소) |
| NAV-10 | 사이드바([[06-UI-UX\|06]] §4.1): 묶음 업무·분석·회사, 펼친 상태는 묶음 줄에만 아이콘·메뉴는 글자만(묶음 이름 선에 맞춰 들여 씀), 지금 메뉴 `aria-current`·연한 파랑 바탕·파란 글자·굵기 600, VIEWER도 남은 메뉴가 있는 묶음을 봄, 접은 64px 줄은 묶음 줄 없이 메뉴 아이콘·초점 고리, 출처(`?origin=`) 이어 가기. 메뉴 15개·맨 아래 고정 칸(ADMIN만)·준비 중 메뉴·`localStorage`는 자동 시험 없음 | `web/components/app-shell-nav.browser.test.tsx`, `web/components/app-shell-origin.browser.test.tsx`. 1440·1280 스크린샷([증거](evidence/sidebar-actibooky/20261028/README.md)) |
| NAV-P1-01 | 관심 공고: 본인만·다른 조직 0행, 멱등 토글, 관심 인원 수만 공개, 마감 알림 1건 | `scripts/database.test.mjs` "N3 관심 공고와 마감 알림", `web/app/api/v1/watch-contract.test.ts`, `web/app/(app)/(work)/watch-toggle.browser.test.tsx` |
| NAV-P1-02 | 입찰 프로젝트: 추천 결정 없이 생성 거부, 결정 변경 시 경고·상태 전진 차단, 상태 이력·감사, 체크리스트 쓰기는 SALES·ADMIN만, 점수·결정 모델에 쓰이지 않음 | `scripts/database.test.mjs` "입찰 프로젝트 — 핵심 저장·권한·원자성", `web/app/api/v1/projects-contract.test.ts`, `web/server/projects/project.model.test.ts` |
| NAV-P1-03 | 인력 배치 시뮬레이션: 가용 FTE = 최신 `score_runs` 스냅샷 값, 기간 충돌 탐지, 후보는 200명 안, 저장 없음 | `web/app/api/v1/workforce-contract.test.ts`, `web/server/workforce/workforce.service.test.ts` |
| NAV-P1-04 | 조직·인력 편집: ADMIN만, 감사, 편집 뒤 골든 94/72/68 그대로, 기존 `score_runs` 불변 | `web/app/api/v1/team-members-edit-contract.test.ts`, `scripts/database.test.mjs` "N4b 직원 추가·이동·퇴사 (20261024000400)" |
| NAV-GAPS | 자격 갭 레이더([[16-DECISIONS\|ADR-060]]): 면허제한 1행 보유·면허제한 없음 + 보조 조회 OK → 참가 가능, 1행 기록 없음 → 회사 기록 없음, 2행 가운데 기록 없는 행 → 사람 확인 필요(AND/OR 미확인), 2행 모두 보유 → 참가 가능(`sol-v0.2.1`), 보조 조회 없음·미완료 → 사람 확인 필요, `NOT_HELD` → 미보유, 판정이 `assessQualifications`(추출 없음)의 `structured:*`와 같음, 보유 가정을 켜면 회사 기록 없음 → 참가 가능 이동과 예산 합(나머지 행을 보유한 조건 묶음 공고도 열림), 다른 확인 필요가 남은 공고는 순위에 세지 않음 | `web/server/gaps/gaps.model.test.ts`, `web/app/(app)/(work)/gaps/gaps-view.browser.test.tsx`(mock, 1440·1280) |
| NAV-MARKET | 발주 현황([[16-DECISIONS\|ADR-060]]): 기간·주 경계(KST, 월요일 시작 13주), 관련성 거르기와 취소 공고 제외, 예산 없음·출처 금액 충돌은 합에서 빼고 미확인 구간, 1,000건씩 나눠 읽기, 2단계 겹쳐 보기(기간 내 마감 전 공고만 묶음, 회사 프로필 없음이면 생략, 판정 실패는 안내와 원인 로그, 기관 키가 1단계와 같음) | `web/server/market/market.service.test.ts`, `web/app/(app)/(work)/market/market-view.browser.test.tsx`(mock, 1440·1280) |
| NAV-CAL | 입찰 일정([[16-DECISIONS\|ADR-060]]): KST 날짜 경계(UTC 15:00 → 다음 날), 관심 + 프로젝트 한 건, 제출 마감 변경 두 건·같은 시각 한 건, 조직 전체·내 일정 거르기, 월 칸 5·6주, 다가오는 14일 경계. 2026-10-28 원본 일정 후속: 원본 시각 KST 해석(오프셋 없음, 초 없음)·빈 값·날짜만 있는 값은 일정 없음, `?kinds=` 해석(없으면 전부, 모르는 값 무시, 빈 값은 0건), 같은 공고·종류·시각 겹침 제거(관심·프로젝트 표시가 붙은 쪽을 남김), 일정 종류 거르기 칩(켜짐·꺼짐 글자, 전체 보기), 다가오는 목록 8건 + 접기, 다가오는 목록 총 40건 상한·넘침 줄, 날 메뉴 15건 상한·넘침 줄. 저장 질의: 관련 공고 대상 조건(live 대표 입찰공고·`OPEN`·`AMENDED`·최신 판정 `RELEVANT`·`CANDIDATE`), id keyset 이어 읽기, 원본 키 6개만 경로로 읽음(`bidClseDt` 안 읽음), 내 일정은 관련 공고를 읽지 않음, 마감 하한 14일 경계, 관련 공고 읽기 실패 시 관심·프로젝트 일정 유지와 안내 | `web/server/calendar/calendar.model.test.ts`, `web/server/calendar/calendar.repo.test.ts`, `web/app/(app)/(work)/calendar/calendar-view.browser.test.tsx`(mock, 1440·1280) |
| REC-INSIGHT | 추천 분석([[16-DECISIONS\|ADR-066]]): ADMIN·SALES·ANALYST만 요청, 사용자당 분당 3회 넘으면 429, 같은 run의 `DONE`·`MODEL`은 다시 쓰고 큐에 넣지 않음, `PENDING` 중복 요청은 하나로 묶음, 모델·`TEMPLATE`·`FAILED` 상태, 인젝션 의심이면 모델을 부르지 않고 `TEMPLATE`(`INJECTION_SUSPECTED`)·[다시 요청] 없음, 금지어·근거 없는 숫자·다른 라벨이면 `TEMPLATE`로 대체, 프롬프트·출력 로그 없음, 10분 넘은 `PENDING`은 `FAILED`(`STALE`), DB 제약 `recommendation_insights_pending_or_model_once` | `services/ai/tests/test_insight.py`, `web/server/insight/insight.service.test.ts`·`insight.model.test.ts`·`insight.repo.test.ts`, `web/worker/insight-job.test.ts`, `web/app/_lib/insight-queue.test.ts`, `web/app/api/v1/redis-gateway-contract.test.ts`, `scripts/database.test.mjs` "추천 분석 요청 (20261029000100)", `web/components/bids/recommendation-insight.browser.test.tsx`, `web/app/(app)/(work)/bids/[id]/recommendation-insight-detail.browser.test.tsx` |
| — | P1 흐름 묶음: 관심 → 분석 비교 → 프로젝트 저장 → 인력 조회 | `web/e2e-auth/p1-navigation.write.spec.ts` |

## 모바일 웹 검증 (ADR-072)

2026-10-30 사용자 승인으로 1280px 미만 반응형 웹을 검증 범위에 포함한다. 360·390·768·1280·1440px에서 페이지 전체 가로 넘침을 확인하고 비교 표·조직도는 영역 안에서 스크롤한다. 네이티브 앱은 범위 밖이다.

핵심 회귀는 기존 브라우저 시험에 통합한다: 랜딩 메뉴·예시 공고 전환, 업무 메뉴 서랍, 필터의 임시 선택→취소/적용과 적용 조건 해제, 모바일 공고의 0점·상충·초기 단계·관심 동작, 상세 보조 패널 흐름, 선택 월 전체 일정(월말 포함). 단순 배치마다 중복 시험이나 전수 입력 행렬을 만들지 않는다(ADR-046).

## 관련 문서

- [[07-DATA-PIPELINE|07 수집]] — fixture `FX-01`~`FX-20` 명세
- [[08-SCORING|08 SOL Score]] — worked example과 missing 정책
- [[06-UI-UX|06 UI]] — E2E가 검사하는 화면 상태·문구
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 보고 형식, 증거 저장, 해커톤 검증 정책
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 장면·계정·촬영 경로
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷과 일정
- [[16-DECISIONS|16 ADR]] — ADR-017(시험 도구·위치), ADR-020(실행 모드·실데이터·평가), ADR-046(시험 축소), ADR-054(발표 경로 D1)
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가셋·지표·오류 분석
- [[03-AI-PIPELINE|03 AI 파이프라인]] — 실행 모드 env, 장애 주입 값
- [[10-DEPLOYMENT|10 배포]] — D1 당일 운영 확인, 대체 경로 기동 절차
