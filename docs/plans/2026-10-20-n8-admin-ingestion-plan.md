---
title: "N8 /admin/ingestion — 구현 계획(서버)"
doc: "plan-20261020-n8-admin-ingestion"
status: done
tags:
  - sol-radar
  - plan
updated: 2026-10-20
---

# N8 `/admin/ingestion` — 구현 계획(서버)

> [!success] 구현·병합 (2026-10-20)
> 이 계획은 `n8/admin-ingestion` @ `1ac444c`로 구현돼 main `81249f0`에 병합됐다(마이그레이션 `20261019000019` 포함). 정본 반영은 [[16-DECISIONS|ADR-035]] F1~F3이다. 계획 본문은 고치지 않고 보관한다.

배정: sol-radar-aa(사용자 지시) → sol-radar-54. 판정: sol-radar-e8(2026-10-20). 브랜치 `n8/admin-ingestion`.
화면 계획은 디자인 스펙(`2026-10-20-n8-admin-ingestion-design.md`)이 나온 뒤 이 문서 아래에 더한다.
정본은 고치지 않는다. 정본 공백(재시도 로그·stages·멱등 키 형식·오래된 RUNNING 행)은 e8 이 다음 정본 묶음에 올린다.

## 1. 정해진 계약

| 항목 | 결정 |
|---|---|
| 권한 | 근무 조직 `sol_role = ADMIN` 만. 그 밖은 403 `FORBIDDEN {required:["ADMIN"]}`. 운영자(`profiles.is_admin`)도 sol_role 이 ADMIN 이 아니면 403 |
| 읽기 | GET 두 개는 사용자 세션(anon 키) + RLS(`ingest_runs`·`ingest_errors` 정책 `my_sol_org_ids(array['ADMIN'])`). service role 을 쓰지 않는다 |
| 쓰기 | POST 는 job 만 넣는다. `ingest_runs` 행은 worker 가 만든다(04 §3, 07:84) |
| 마이그레이션 | 없다 |

### POST `/api/v1/admin/ingestion/runs` 순서

`POST /bids/:id/analyses`(`server/bids/bids.service.ts` `requestAnalysis`)의 순서·봉투·16KB 본문 상한·`X-Requested-With`(CSRF)·속도 제한 위치를 따른다.

1. 역할: ADMIN 이 아니면 403. 이후 의존성(Redis·큐·DB)을 부르지 않는다.
2. `Idempotency-Key`: `^[A-Za-z0-9_-]{1,128}$` 가 아니면 400 `VALIDATION_ERROR`. 없으면 서버가 UUID 를 만든다(requestId).
3. 선언된 본문 크기가 16KB 를 넘으면 분석과 같은 응답.
4. 속도 제한: 조직당 5회/분(`app/_lib/rate-limit.ts`, 키 접두어 `ingest`). 넘으면 429 `RATE_LIMITED` + `retryAfterSeconds`(→ `Retry-After`). Redis 실패는 503 `{component:"redis"}`.
5. 본문 zod `IngestionRunInput`(05 :361-366, :428) 실패는 400 `VALIDATION_ERROR {issues}`.
   - `source`: `g2b`|`fixture`. fixture 는 `batch` 필수, `window`·`stages` 금지. g2b 는 `batch` 금지, `window` 는 최대 7일·`from < to`.
   - `batch` 는 소문자(`seed`|`live`)로 받아 대문자로 바꾼다.
   - `stages`: 생략과 `["NOTICE"]` 만 통과한다. 그 밖은 400. 큐에 넣기 전에 뺀다(job 스키마가 strict).
6. 실행 모드(`SOL_RUN_MODE`): `live` 는 g2b 만, `fixture`·`mock` 은 fixture 만. 어긋나면 409 `RUN_MODE_MISMATCH {runMode, source}`.
7. 멱등 재현(①): Redis 키 `idem:ingest:<orgId>:<requestId>` 값 `{requestHash, runId, startedAt}`.
   같은 해시면 첫 202 를 그대로 다시 준다(같은 runId·startedAt). 실행 중이어도 그렇다. 다른 해시면 409 `IDEMPOTENCY_KEY_REUSED`.
8. 진행 중(②): 같은 source 의 `status = RUNNING` 행을 사용자 세션으로 읽어 있으면 409 `INGESTION_IN_PROGRESS {runId}`.
   큐에만 있는 job 은 막지 않는다(worker 가 멱등).
9. 키 잡기: `SET NX EX 86400`. 경쟁에서 지면 7번 판정을 다시 한다.
10. 큐: job data `{source, batch|window, trigger:"MANUAL", jobKey:"manual:<orgId>:<requestId>", idempotencyKey:"<orgId>:<requestId>", requestedBy:<userId>, orgId, runId:<새 UUID>}`.
    실패하면 Redis 키를 지우고 503 `{component:"queue"}`.
11. 202 본문(05 §6.5 모양 `IngestionRun`): `id=runId`, `status:"RUNNING"`, summary 6개 0, `quotaUsed:0`, `errors:[]`, `cursor:null`,
    `finishedAt:null`, `startedAt`=요청 시각, `trigger:"MANUAL"`, `runMode`(소문자), `batch`(소문자 또는 null), `requestedBy:{id,name}`.

### GET `/api/v1/admin/ingestion/runs`·`/runs/:id`

- 목록: `Page<IngestionRun>`, `started_at desc, id desc` keyset, HMAC 커서(`CursorKind` 에 `"ingestionRuns"`, 조직을 지문에 넣는다).
  커서 비밀이 없으면 503 `{component:"cursor"}`, 틀린 커서는 400 `INVALID_CURSOR`. 쿼리 `limit` 기본 20.
- 단건: id 가 UUID 가 아니거나 행이 없으면 404 `NOT_FOUND {resource:"ingestionRun"}`. worker 가 행을 만들기 전에는 404 일 수 있다(화면은 목록을 다시 읽는다).
- `errors`: `ingest_errors` 행 → `{sourceKey, errorCode, resultCode, detail}`(detail 은 `redacted_detail`).
- `requestedBy`: 요청자가 **지금 조직(ctx.orgId)의 구성원**이면 `{id,name}`, 아니면 `null`(id 도 내보내지 않는다). `ingest_runs` 는 조직 구분 없는 공용 표라 어느 조직 ADMIN 이든 읽는다.
- `summary` 에 빠진 키는 0. `runMode`·`batch` 는 소문자로 낸다.

## 2. 파일

도메인 `web/server/ingestion`(다른 도메인 `@/server/bids` 를 import 하지 않는다 — lodestar):

| 파일 | 내용 |
|---|---|
| `ingestion-admin.model.ts` | `ingestionRunInputSchema`, `acceptsSourceForMode(runMode, source)`, `IngestionRunView`·행 타입, `toIngestionRunView(row, errors, requester)`, 결과 타입 `IngestionAdminResult<T>`(bids `ServiceResult` 와 같은 모양), 오류 코드 |
| `ingestion-admin.service.ts` | `listIngestionRuns`, `getIngestionRun`, `requestIngestionRun`. 의존성은 인자로 받는다(repo·queue·idempotency·limiter·runMode·now·newId·cursor 코덱) |
| `ingestion-admin.repo.ts` | 사용자 세션 읽기(`getSupabase()`): 목록(keyset)·단건·오류 행·진행 중 행·지금 조직 구성원 이름 |
| `ingestion.queue.ts` | job 공통 필드에 `runId: z.uuid().optional()` |
| `ingestion.store.ts` | `toIngestRunInsert`(:147)에 `id`(runId 가 있을 때만). worker 의 run 입력까지 runId 를 잇는다. 같은 jobKey 재실행은 기존 행(findRun) 그대로 |
| `index.ts` | 위 공개 함수·타입을 배럴로 |

app 층:

| 파일 | 내용 |
|---|---|
| `app/_lib/rate-limit.ts` | 키 접두어·한도 옵션. 분석 기본값(`rate:analysis:`, 30)과 기존 시험은 그대로 |
| `app/_lib/ingest-queue.ts` | `ingest` 큐 어댑터(`analysis-queue.ts` 견본: 큐 캐시·3000ms 제한·`describeQueueError`) |
| `app/_lib/idempotency-store.ts` | Redis `SET NX EX`·읽기·지우기 |
| `app/_lib/ingestion-deps.ts` | 수집 관리 의존성 묶음(커서 코덱은 `@/server/bids` 의 `cursorScope`·`signCursor`·`verifyCursor` 로 app 층에서 만든다) |
| `app/api/v1/_lib/http.ts` | `ApiErrorCode` 에 `RUN_MODE_MISMATCH`·`INGESTION_IN_PROGRESS`. `serviceResponse` 가 수집 결과도 받게 |
| `app/api/v1/_lib/work-route.ts` | `pathNotFound` resource 에 `"ingestionRun"` |
| `server/bids/bid-query.ts` | `CursorKind` 에 `"ingestionRuns"` |
| `app/api/v1/admin/ingestion/runs/route.ts` | GET·POST |
| `app/api/v1/admin/ingestion/runs/[id]/route.ts` | GET |

## 3. 시험(구현보다 먼저, RED 확인)

| 파일 | 고정할 것 |
|---|---|
| `server/ingestion/ingestion-admin.model.test.ts` | 입력 검증 표(05 :428 + stages + batch 대소문자), 모드·소스 표, DTO 변환(summary 기본값·소문자·errors·requestedBy null) |
| `server/ingestion/ingestion-admin.service.test.ts` | 1~11 순서 전부(403 이면 의존성 호출 0, 멱등 재현이 RUNNING 보다 먼저, 큐 실패 시 키 삭제, job data 정확값, 202 본문 정확값), 목록 커서·503·400, 단건 404, 다른 조직 요청자 null |
| `server/ingestion/ingestion.queue.test.ts`·`ingestion.store.test.ts` | runId 선택 필드, insert id |
| `app/_lib/rate-limit.test.ts` | 접두어·한도 옵션, 분석 기본값 불변 |
| `app/api/v1/admin-ingestion-contract.test.ts` | `bids-contract.test.ts` 구조: 401·CSRF·403(SALES·ANALYST·VIEWER, 백엔드 호출 0)·202·400·409 세 종류·429 Retry-After·503(redis·queue·cursor)·404·봉투 requestId = X-Request-Id·메서드 export |

무거운 검증(`pnpm verify`·`test:browser`·`test:e2e`·`next build`)은
`bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 으로 감싼다. 단일 시험 파일 실행은 감싸지 않는다.

## 4. 화면(디자인 스펙 결정, 2026-10-20 54)

디자인 스펙 `2026-10-20-n8-admin-ingestion-design.md` §12 의 결정 항목을 이렇게 정한다.

| # | 결정 |
|---|---|
| D1·D2 | 추천안. 상세는 같은 화면 오른쪽 서랍, `?run=<id>` 를 `history.pushState` 로 남긴다 |
| D3 | 추천안이지만 마지막 순서다. 시간이 모자라면 가장 먼저 자른다. 서버는 수집 도메인 함수로 소스마다 최신 성공·실패 1건을 사용자 세션으로 읽는다(새 공개 API 없음) |
| D4 | **채택하지 않는다.** e8 판정대로 화면은 `summary.retried` 횟수만 보인다. worker·`retry.ts` 는 고치지 않는다 |
| D5 | **DTO 를 바꾸지 않는다**(05 그대로). 격리·경고·중단 구분은 화면 모듈의 `errorCode → 종류` 표로 한다. 서버의 `QUARANTINE_CODES`·`WARNING_CODES` 를 모두 덮는지 단위 시험으로 고정한다. "필드" 칸은 두지 않고 `detail` 을 그대로 보인다 |
| D6 | 저장값 그대로 보인다. 05 예시 차이는 e8 에 알린다(정본은 고치지 않는다) |
| D7~D10·D13~D15 | 추천안 |
| D11·D12 | 경로는 구현과 함께 연다. **사이드바 줄과 `AppShell` `solRole` prop 은 이번에 넣지 않는다.** C6 B2(사이드바 글자 +3px)가 `app-shell.tsx` 를 고치는 중이고, e8 판정상 ADR-021 노출 조건을 채운 뒤에 넣는다. 마지막에 e8 과 시점을 정한다 |

## 5. 보안 점검 뒤 판정(e8, 2026-10-20)

security-auditor 결과: 차단 0, 경고 1(W1), 참고 3.

| 항목 | 판정 |
|---|---|
| W1 조직 간 id 노출(RLS 층) | 새 마이그레이션 `20261019000019`. `ingest_runs` 의 `authenticated` select 를 열 단위로 줄인다(`id, source, run_mode, trigger, batch, cursor, status, summary, quota_used, started_at, finished_at`). `job_key`·`idempotency_key`·`requested_by`·`params` 는 뺀다. 행 정책은 그대로이고 `anon` 에는 주지 않는다. 머리 주석에 이유와 되돌리는 법(새 마이그레이션으로 표 전체 select 재부여)을 적는다 |
| W1 요청자 | `ingest_runs.requested_by` 대신 조직 소유 `audit_logs`(action `INGEST_MANUAL`, `target_id = runId`)의 `actor_id` 를 `ctx.orgId` 로 읽는다. 이름은 지금처럼 지금 조직 `memberships` 로 좁힌다. repo 의 `select("*")` 는 명시 열로 바꾼다 |
| W1 시험 | `scripts/database.test.mjs`: ① 허용 열 select 통과 ② 뺀 열 하나라도 select 하면 권한 오류(org-01·org-02 ADMIN 모두) ③ `latest_ingest_run`(definer) 그대로 |
| W1 적용 | `pnpm db:types` diff 확인(있으면 같은 커밋). 공용 로컬 DB 적용은 3e 와 시간을 맞춘 뒤, 클라우드 push 는 사용자 승인 뒤 3e |
| I1 재현 202 의 요청자 | 고친다. 멱등 기록에 `requesterId` 를 더하고 재현 때 그 사람을 지금 조직 구성원에서 찾는다 |
| I2 24시간 뒤 같은 키 | 코드 그대로. 05:28 "키 24시간 보존" 이 이미 있다 |
| C1 공용 G2B 할당량 | 해커톤 범위에서 받아들인다(한 조직·fixture 모드). 해커톤 뒤 보안 후속 |
| I3 `sm:max-w-[480px]` | 대화상자 너비 덮어쓰기라 모바일 레이아웃이 아니다. 그대로 둔다 |

## 관련 문서

- [[05-API-SPEC|05 API]] §2 수집 관리, §6.5·6.6
- [[06-UI-UX|06 UI/UX]] §5.8 수집 관리
- [[07-DATA-PIPELINE|07 데이터 파이프라인]]
- [[16-DECISIONS|16 결정]] ADR-021·023·030
