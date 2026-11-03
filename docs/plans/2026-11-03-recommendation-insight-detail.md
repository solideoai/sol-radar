---
title: "추천 분석 팝업·상세화 단계 계획"
doc: "plan-20261103-recommendation-insight-detail"
status: draft
tags:
  - sol-radar
  - ai
  - qwen
  - insight
updated: 2026-11-03
---

# 추천 분석 팝업·상세화 단계 계획

> **작업자에게:** 구현은 촬영 전(2026-11-03 밤, 늦어도 2026-11-04)에 끝낸다([[16-DECISIONS|ADR-078]]). 자기 Task만 실행하고 시험을 먼저 쓴다(superpowers:test-driven-development). git 상태 변경(add·commit·stash·checkout)은 메인 세션만 한다. 훅·권한 거부에 막히면 돌아가지 말고 멈춰 보고한다.

**목표:** [추천 분석]을 누르면 팝업이 열리고, 진행률(0~100%)을 보인 뒤 지금의 약 3배 분량 설명(섹션 8개)을 보인다.

**구조:** 요청 흐름은 1단계 그대로다. 화면 POST → (Vercel relay) → 회사 redis-api가 PENDING 행·insight job → Analysis Worker가 gateway `POST /insight` → DONE·FAILED. 결과 읽기(GET)는 Vercel이 사용자 세션으로 한다(`web/app/api/v1/bids/[id]/analyses/[runId]/insight/route.ts`). 바뀌는 것은 출력 계약(v0.2), 검사·대체 방식, run·버전별 중복 규칙, 화면이다.

**스펙:** `polaris/specs/in-progress/2026-11-03-recommendation-insight-detail.md`. 디자인은 [[2026-11-03-recommendation-insight-detail-design|디자인 스펙]]. 계획과 스펙이 다르면 스펙을 따른다. 새 패키지는 없다.

## 사용자 결정(2026-11-03)

스펙 미결정과 디자인 스펙 열린 질문 가운데 제품 판단이 필요한 것이다. 2026-11-03 사용자가 아래 안을 모두 승인했다.

| # | 질문 | 결정 |
|---|---|---|
| Q1 (스펙 미결정 4) | 세부 칸 항목에 없는 근거 번호나 숨은 문자가 나오면 | 없는 근거 번호는 그 항목만 뺀다. 숨은 문자는 조작 신호라 어디서 나오든 전체를 대체한다 |
| Q2 (미결정 5) | 새 형식 재요청이 실패하면 옛 결과를 계속 보일지 | 보인다. 옛 결과 위에 실패 안내와 [다시 요청]을 띄운다. 그래서 GET이 최신 행과 최신 모델 설명을 함께 돌려준다(C4) |
| Q3 (미결정 9) | 진행 중 팝업을 새로고침하거나 다른 화면에서 돌아왔을 때 진행률 | 요청 시각(`createdAt`)부터 이어 센다(디자인 스펙 13절 안 1). 숫자가 뒤로 가지 않고, 다른 사람이 요청한 PENDING도 같은 진행률로 보인다. 3분 대기 상한도 같은 시각부터 잰다. 대신 훅의 경과 기준과 늦어짐 시험이 바뀐다(Task 4). 같은 페이지에서 닫았다 여는 것은 어느 쪽이든 이어진다 |
| Q4 (미결정 6) | 진행률이 99%에 닿는 시간 T | 3분 대기 상한과 같게 둔다(디자인 스펙 7.2). 99%에 닿을 때 늦음 안내가 함께 나와 99%에서 말없이 멈추는 구간이 없고, 상수도 하나다. 실제가 90초쯤이면 50% 근처에서 100%로 건너뛴다(일찍 끝난 것으로 읽힌다). 처음 계획한 90초 안은 숫자가 실제에 가깝지만 90초~3분 사이 99%에 멈춘다. 어느 쪽이든 운영 측정(Task 6 d) 뒤 다시 본다. DONE 뒤 100%를 보이는 시간은 600ms다. **2026-11-03 개정**: 운영 회사 Qwen 생성 6.4초·8.9초(2026-11-03 v0.2 2건)이라 5% 근처에서 100%로 건너뛰었다. 사용자 지시("균일한 속도로 가게")로 예상 시간 10초에 90%, 그 뒤 3분 상한까지 99%로 바꾸고, DONE 때 그 값에서 100%까지 이어 채운다([[06-UI-UX\|06]]) |
| Q5 (디자인 14절 1) | 구역 버튼 글자를 [추천 분석](요청)과 [추천 분석 보기](결과 있음)로 나눌지 | 나눈다. 누르면 모델을 부르는지가 글자로 구분된다. 스펙 3절 1번의 [추천 분석]은 요청 버튼에 그대로 남는다 |
| Q6 (디자인 14절 9) | 767px 이하 전체 화면 팝업 머리에 공고명 한 줄을 더할지 | 더한다(`type-caption`, 한 줄 말줄임). 전체 화면에서는 어느 공고인지 보이지 않는다 |
| Q7 (디자인 14절 10) | 움직임 줄이기에서 회전 아이콘 | 지금 코드대로 멈춘다. `docs/06-UI-UX.md:134` 문구를 코드에 맞춘다(Task 5) |
| Q8 (디자인 14절 7·11) | 공용 `dialog.tsx`의 닫기 이름 "Close"와 뒷막 흐림 | 이번 범위에서 건드리지 않는다. 이 팝업은 자체 [닫기]를 쓴다. 공용 부품 변경은 따로 승인받는다 |

## 일정과 중단 기준(2026-11-03)

- 사용자 "오늘 밤이나 내일 영상 찍으려고 하는데 그 전에 구현 다 하고 싶어". 이 기능만 화면 동결에서 빼서 촬영 전에 운영에 올린다(ADR-078 6번).
- 순서: Task 0 → Task 1·2·3·4 병렬(작업자마다 worktree, 같은 파일은 한 작업자) → Task 5 → Task 6. 작업자는 커밋하지 않는다. 메인 세션이 diff와 시험을 직접 확인하고 합친다.
- 검증: 개발 중 `pnpm verify:changed`, 통합 때 전체 `pnpm verify` 한 번(ADR-046). 무거운 검증은 `verify-slot.sh`로 감싼다.
- 운영 반영 전에 확인할 것:
  1. Task 6의 1~3(전체 검증, 격리 로컬 mock 확인, 독립 리뷰)을 통과했다.
  2. 사용자가 회사 서버에 SSH로 들어갈 수 있다. 회사 망 안에서만 열린다(`infra/company/README.md`).
  3. 회사 redis-api·Analysis Worker·AI gateway 재생성은 정기 수집을 피하는 시간 창 안에서 한다(같은 실행서).
  4. 로컬 main에는 아직 운영 전인 `sol-v0.2.2`(`dd63e6a1`, [[PROGRESS]] 사용자 결정 대기 5)가 있다. 이 계획의 main push와 회사 재생성에 함께 들어간다. 같이 낼지 먼저 정한다.
- 중단 기준(사용자 확인 필요): 촬영 시작 2시간 전까지 Task 6 운영 반영 a를 시작하지 못하면 이번 반영을 멈춘다. 그때는 클립 2를 지금 운영 화면(1단계 패널)으로 찍고 반영은 발표 뒤로 돌린다. a를 시작한 뒤에는 각 단계가 옛 코드와 함께 돌아도 깨지지 않으므로(Task 6 표) 중간에 멈춰도 운영은 동작한다. 단 b 뒤로는 FX-01이 팝업의 옛 형식 안내로 보인다.

## 계획이 정하는 것(스펙 미결정 1·2·3)

- **필드 이름·상한(미결정 1):** C2 표.
- **버전 열(미결정 2):** 새 열 `prompt_version`을 둔다. 기존 `prompt_hash`는 쓸 수 없다. 화면이 넣는 PENDING 행은 `prompt_hash`가 비어 있고 완료 때 worker가 채운다(`web/server/analysis/insight-store.ts` `finishDone`). 해시는 프롬프트 글자 하나만 바뀌어도 달라진다.
- **마이그레이션 위치(미결정 3):** 배포 1단계(맨 앞). 옛 코드와 함께 돌아도 깨지지 않는다(Task 6).

디자인 스펙 14절의 열린 질문 가운데 구현 방식에 관한 것도 여기서 정한다. 디자인 스펙과 다르게 정한 곳은 이 절이 앞선다.

- **옛 형식 판별(14절 4):** 화면은 `promptVersion`이 지금 버전과 다르면 옛 형식으로 본다(C4). 디자인 스펙 6절의 "새 칸 3개 키가 모두 없음" 기준 대신 이것을 쓴다. 서버 중복 판단(`isModelDone`, Task 2)과 같은 기준이어야 [새 형식으로 다시 분석]을 눌렀는데 서버가 중복으로 돌려주는 일이 없다. v0.2 gateway는 새 칸 세 키를 늘 보낸다(C3). v0.2 결과에서 키가 빠져 있으면 빈 섹션(P14)으로 그린다.
- **섹션 7 인력 가용(14절 5):** worker가 규칙 값 `staffing: { from, to, availableFte, eligibleStaff } | null`을 payload에 저장한다. `toInsightRequest`가 이미 계산하는 `staffAvailabilityInput` 결과다(`web/server/analysis/insight-request.model.ts:165-175`). 인용 글자를 쪼개지 않는다. 옛 형식 결과에는 이 값이 없으므로 섹션 7도 섹션 3·4·6처럼 새 형식에만 그린다. 디자인 스펙 6절 옛 형식 행의 "섹션 2·5·7·8"은 "섹션 2·5·8"이 된다.
- **자격 해설 짝짓기(14절 6):** 요청의 `qualificationChecks`에는 id가 없고 `label`만 있다(`web/server/analysis/gateway.model.ts:305`). `checkNotes.label`을 그 글자와 같게 받고(C2), 화면은 체크리스트의 `label`로 짝짓는다.
  - Task 0 확인(2026-11-03 운영 DB 읽기): 한 run 안에서 같은 `requirement_name`이 두 번 나오는 묶음이 167개 있다(최대 2건, 85개는 판정이 서로 다르다). 그래서 짝은 "요청 순서(필수 먼저, 이름 순)에서 그 이름을 가진 첫 미충족·확인 필요 자격"으로 정한다. gateway는 같은 `label`의 두 번째 `checkNotes` 항목을 뺀다. 템플릿도 이름마다 한 항목만 만든다.
- **재요청 실패 때 옛 결과(14절 8):** Q2에 따라 실패 안내 줄 아래에 옛 결과 섹션을 그대로 그린다.

## 전역 제약

- 판정(점수·권고·자격·`score_runs.explanation`)과 `/explain`·`/health` 응답 모양을 바꾸지 않는다. gateway 요청(`InsightRequest`) 모양도 바꾸지 않는다.
- 금지어는 그대로다. `%`는 진행 표시에만 쓴다(새 ADR).
- 마이그레이션은 새 파일로만 쓴다. 마이그레이션 날짜 번호와 ADR 번호는 쓰기 직전 main에서 확인한다. `pnpm db:types` 결과를 같은 커밋에 넣는다.
- 운영 반영(`pnpm db:push`, main push, 회사 서비스 교체, 운영 실호출)은 단계마다 사용자 승인을 받는다.
- 시험은 핵심 동작만 더한다(ADR-046). 바꾸는 기존 시험은 Task마다 이유를 적었다. 단언을 약하게 바꾸지 않는다.

## 공통 계약

### C1 DB: `recommendation_insights.prompt_version` (Task 2)

- 새 열 `prompt_version text`, null 허용. 화면 역할에는 insert 권한을 주지 않는다. 지금 insert 권한은 `org_id, score_run_id`뿐이다(`supabase/migrations/20261029000100_recommendation_insights.sql:85`). 그래서 사용자가 버전을 꾸며 제약을 피할 수 없다. worker(service role)가 DONE 때 쓴다.
- 기존 행: `prompt_hash is not null`이면 `'insight/v0.1'`로 채운다.
- 제약 `recommendation_insights_pending_or_model_once`를 **같은 이름으로** 다시 만든다. 이름이 같아야 `web/server/insight/insight.repo.ts:18`의 23P01 처리가 그대로 맞는다.

```sql
alter table public.recommendation_insights
  add column if not exists prompt_version text;
update public.recommendation_insights
  set prompt_version = 'insight/v0.1'
  where prompt_hash is not null and prompt_version is null;
alter table public.recommendation_insights
  drop constraint if exists recommendation_insights_pending_or_model_once;
alter table public.recommendation_insights
  add constraint recommendation_insights_pending_or_model_once
  exclude using btree (score_run_id with =)
  where (status = 'PENDING'
         or (status = 'DONE' and source = 'MODEL' and prompt_version = 'insight/v0.2'));
```

- 뜻: 지금 버전(v0.2)의 모델 설명이 있는 run에는 PENDING을 못 넣는다. 옛 버전이나 버전 없는 모델 설명은 막지 않는다. PENDING은 run당 하나(`recommendation_insights_one_pending`)인 규칙은 그대로다.
- 운영에는 이 SQL을 직접 실행한다(Task 6 a). 그래서 다시 돌려도 결과가 같은 꼴(`if not exists`·`if exists`, 빈 값만 채우기)로 쓴다. 나중의 `pnpm db:push`가 이 파일을 다시 돌려도 해가 없다.
- 다음에 버전을 올릴 때는 새 마이그레이션으로 이 글자를 바꾼다.
- 되돌리기: 새 마이그레이션으로 제약을 `20261029000200` 정의로 다시 만든다. 열은 남겨 둔다.

### C2 출력 계약 v0.2 (Task 0이 TS, Task 1이 Python)

| 칸 | 모양 | 상한 | 비고 |
|---|---|---|---|
| `summary` | 문자열 | 800자 | 기존, 400자에서 늘림 |
| `strengths`·`improvements` | `[{text, refIds}]` | 각 6개, 항목 200자, refIds 4개 | 기존, 4개에서 늘림 |
| `factorNotes` | `[{factor, text, refIds}]` | 8개, 200자 | 새 칸, 없어도 됨. `factor`는 요청 `rules.factors[].factor` 중 하나 |
| `checkNotes` | `[{label, text, refIds}]` | 8개, 200자 | 새 칸, 없어도 됨. `label`은 요청 `rules.qualificationChecks[].label` 중 status가 NOT_SATISFIED·NEEDS_REVIEW인 것 |
| `nextSteps` | `[{text, refIds}]` | 5개, 200자 | 새 칸, 없어도 됨. 프롬프트는 3~5개를 요구한다 |
| `refs` | 지금과 같음 | 24개 | 새 칸의 refIds도 refs 안에 있어야 한다 |

- 새 칸은 `.optional()`로 둔다(기본값 `[]`를 넣지 않는다). 그러면 저장된 옛 payload 모양이 그대로 남는다.
- gateway 응답에 `promptVersion`(`"insight/v0.2"`)을 더한다. worker의 응답 스키마(`web/server/analysis/gateway.model.ts:179`)는 zod `object` 기본값대로 모르는 키를 버리므로, 배포 순서가 섞여도 깨지지 않는다.
- `INSIGHT_PROMPT_VERSION = "insight/v0.2"`를 `web/server/insight/insight.model.ts`에 둔다. gateway의 `INSIGHT_PROMPT_VERSION`(`services/ai/src/sol_ai/insight.py:42`)과 C1 마이그레이션 글자가 모두 같아야 한다. 루트 시험 하나가 세 파일을 읽어 같은지 본다(Task 2).
- `InsightView`에 `promptVersion: string | null`을 더한다.
- `INSIGHT_MAX_TOKENS`(`services/ai/src/sol_ai/adapters/qwen.py:55`)를 1024에서 4096으로 올린다(처음 3072, 사전 리뷰 Product W1로 4096. 한국어 글자에 JSON 키·근거 번호까지 더하면 3072를 넘을 수 있다). 판단 이유 800자, 요소 해설 5×150자, 자격 해설 2×150자, 강점·보완 8×120자, 확인할 것 4×120자를 더하면 약 3,300자로 상한 근처다. 보통은 2,000~2,700자로 본다.

### C3 검사·대체 (Task 1)

`validate_insight`(`services/ai/src/sol_ai/insight.py`)의 순서다.

1. JSON·모양(모르는 키, 글자·개수 상한) → 전체 대체(`INVALID_OUTPUT`).
2. 숨은 문자 → 전체 대체(`INVALID_OUTPUT`). Q1 결정에 따른다.
3. 판단 이유의 금지어·판정 표현·입력에 없는 숫자 → 전체 대체(사유는 지금과 같음).
4. 세부 항목(강점·보완할 점·요소 해설·자격 해설·확인할 것)마다: 금지어, 판정 표현, 입력에 없는 숫자, 없는 근거 번호(Q1), 요청에 없는 `factor`·`label` → 그 항목만 뺀다.
5. 남은 본문으로 MODEL을 돌려준다. 뺀 항목의 내용은 로그에 남기지 않는다.

v0.2 응답은 MODEL·TEMPLATE 모두 새 칸 세 키를 늘 보낸다. 항목이 모두 빠지거나 채울 것이 없으면 빈 목록(`[]`)으로 둔다.

템플릿(`template_insight`)은 지금 칸에 더해 새 칸을 채운다. 모든 문장은 같은 검사를 지난 것만 남긴다.

- `factorNotes`: 요소마다 `_factor_texts`(점수 + 요소 이유).
- `checkNotes`: NOT_SATISFIED·NEEDS_REVIEW 자격의 이유.
- `nextSteps`: 같은 자격마다 "{자격}: 참여하려면 충족 여부를 확인해야 합니다."

mock 어댑터는 템플릿을 모델 응답처럼 돌려주므로(`services/ai/src/sol_ai/adapters/mock.py:155-160`) 새 칸이 저절로 채워진다.

### C4 화면 (Task 4)

- 배치·상태·문구는 디자인 스펙을 따른다.
- 진행률은 순수 함수 `insightProgress(elapsedMs, expectedMs): number`로 계산한다. 0에서 시작해 줄지 않는 정수이고, DONE 전에는 99를 넘지 않는다. DONE이면 화면이 100을 보인 뒤 내용으로 바꾼다.
- T는 3분 대기 상한과 같다(Q4). 따로 상수를 두지 않고 `pollLimitMs`를 쓴다. DONE이면 100%를 600ms 보인 뒤 내용으로 바꾼다. FAILED는 100%를 거치지 않는다(디자인 스펙 7.2).
- 경과의 시작점은 행의 `createdAt`(`web/server/insight/insight.model.ts:115`)이다(Q3). 이 화면에서 누른 새 요청은 클릭 시각을 그대로 쓰고, POST 가 이미 있던 요청으로 묶였을 때(`deduplicated`)만 행의 `createdAt`으로 바꾼다(사전 리뷰 QA W2, 기기·서버 시계 차). 음수면 0으로 본다. [다시 확인]은 누른 때부터 상한을 다시 잰다(QA W1).
- 지금 버전 글자는 서버 전용 모듈에 있어 클라이언트가 불러올 수 없다. 그래서 `pollLimitMs`처럼(`web/components/bids/recommendation-insight.tsx:24-26`) 서버 화면이 prop으로 넘기고, 화면은 `insight.promptVersion`과 비교해 옛 형식을 판단한다. 디자인 스펙 6절의 키 기준 대신 이것을 쓴다("계획이 정하는 것").
- Q2에 따라 GET 본문을 `{ insight, previous }`로 바꾼다. `previous`는 최신 행이 FAILED일 때 그 run의 마지막 DONE·MODEL(버전 무관)이고, 그 밖에는 null이다. 최신 행이 TEMPLATE이면 새 형식 대체 결과를 그대로 보인다. repo에 `latestModelInsight`를 더한다. 첫 화면 값 `getInsight`도 같은 `{ insight, previous }`를 돌려준다. 회사 relay 계약 시험(`web/app/api/v1/redis-gateway-contract.test.ts`)은 POST만 보므로 GET 변경과 관계없다.

## 파일 소유

같은 파일은 한 작업자만 맡는다.

| Task | 맡는 파일 |
|---|---|
| 0 계약 | `web/server/insight/insight.model.ts`·`insight.model.test.ts`·`index.ts`, `web/server/analysis/gateway.model.ts` |
| 1 gateway | `services/ai/prompts/insight.v0.2.md`(새), `services/ai/schemas/insight.v0.2.json`(새), `services/ai/src/sol_ai/{paths,insight,contracts}.py`, `services/ai/src/sol_ai/adapters/qwen.py`, `services/ai/tests/test_insight.py` |
| 2 DB·서버 | `supabase/migrations/<새 파일>`, `web/lib/database.types.ts`, `scripts/database.test.mjs`, `scripts/insight-prompt-version.test.mjs`(새), `web/server/insight/insight.repo.ts`·`insight.service.ts`·`insight-request.model.ts`와 각 시험 |
| 3 worker | `web/server/analysis/insight-request.model.ts`·`insight-store.ts`와 각 시험, `web/worker/insight-job.ts`·`insight-job.test.ts` |
| 4 화면 | `web/components/bids/recommendation-insight.tsx`, 팝업 부품(새, 이름은 디자인 스펙), `web/components/bids/insight-progress.ts`(새)·시험, `use-insight-request.ts`, `insight-test-data.ts`, `recommendation-insight.browser.test.tsx`, `web/app/(app)/(work)/bids/[id]/page.tsx`·`bid-detail-view.tsx`(prop 연결만)·`recommendation-insight-detail.browser.test.tsx` |
| 5 문서 | `docs/03`·`04`·`05`·`06`·`09`·`11`·`15`·`16`·`PROGRESS`, 스펙 폴더 이동 |
| 6 통합·배포 | 메인 세션 |

순서: Task 0 → (1·2·3·4 병렬. 3은 2의 `database.types.ts`를, 4는 디자인 스펙을 기다린다) → 5 → 6.

## Task 0: 공통 계약

- [ ] `insight.model.test.ts`에 시험을 먼저 쓴다.
  1. FX-01 옛 결과 모양(새 칸 없음)이 통과한다.
  2. 새 칸이 모두 있는 v0.2 결과가 통과한다.
  3. 새 칸의 refIds가 refs에 없으면 실패한다(`superRefine` 확장).
  4. 판단 이유가 801자이면 실패한다.
- [ ] `insightPayloadSchema`, `InsightView.promptVersion`, `INSIGHT_PROMPT_VERSION`을 C2대로 바꾼다. payload에 선택 칸 `staffing`(규칙 값, "계획이 정하는 것")을 더한다. `gateway.model.ts`의 `insightResponseSchema`도 같은 상한으로 맞추고 `promptVersion`을 선택 항목으로 더한다.
- [ ] 한 run의 `qualificationChecks`에서 `label`이 겹칠 수 있는지 규칙 엔진 출력에서 확인한다. 겹칠 수 있으면 짝짓기 방식을 사용자와 다시 정한다.
- [ ] 완료: `pnpm -C web exec vitest run server/insight/insight.model.test.ts` 통과.

## Task 1: gateway 출력 v0.2·검사·템플릿

- [ ] `services/ai/tests/test_insight.py`에 시험을 먼저 쓴다.
  1. 새 칸이 모두 있는 모델 출력이 MODEL로 통과하고 응답에 `promptVersion`이 있다.
  2. 요소 해설 1개에 금지어 → 그 항목만 빠지고 MODEL.
  3. 요청에 없는 `factor`나 `label` → 그 항목만 빠진다.
  4. 세부 항목의 없는 근거 번호 → 그 항목만 빠진다(Q1).
  5. 판단 이유에 금지어 → TEMPLATE.
  6. 템플릿이 새 칸을 규칙 값으로 채우고 모든 문장이 검사를 지난다.
- [ ] **바꾸는 기존 시험:** `test_unknown_ref_falls_back`, `test_forbidden_word_falls_back`·`test_unknown_number_falls_back` 가운데 항목 쪽 사례, `test_insight_endpoint_mock_is_deterministic`의 기대값. 이유: 스펙 4.3이 항목 쪽 실패를 "그 항목만 제외"로 바꿨다. 바꾼 시험은 그 항목이 빠졌는지와 나머지가 MODEL인지 **둘 다** 본다. 판단 이유 쪽 사례는 전체 대체 단언을 그대로 둔다.
- [ ] 프롬프트 `insight.v0.2.md`: 1단계 규칙 1~8을 유지한다. 출력 모양·분량(판단 이유 4~6문장 800자, 요소마다 해설, 확인할 것 3~5개)을 바꾸고 "입력에 없는 개수·비율을 만들지 않는다"를 더한다. 스키마 `insight.v0.2.json`(guided JSON), `paths.py`, `INSIGHT_PROMPT_VERSION = "insight/v0.2"`, `INSIGHT_MAX_TOKENS = 3072`.
- [ ] v0.1 프롬프트·스키마 파일은 참조가 없어진 것을 grep으로 확인한 뒤 지운다(promptHash는 이미 행에 남아 있다).
- [ ] 완료: `services/ai/verify.sh` 통과(ruff·서식·pytest). pytest-timeout 플러그인이 없어 Bash 쪽 시간 제한을 120초로 둔다.

## Task 2: DB·서버 중복 규칙

- [ ] `scripts/database.test.mjs`의 "추천 분석 요청" 묶음에 시험을 먼저 쓴다.
  1. v0.1 DONE·MODEL 뒤에는 admin·sales·analyst가 PENDING을 넣을 수 있다.
  2. v0.2 DONE·MODEL 뒤에는 23P01.
  3. authenticated가 `prompt_version`을 넣으려 하면 permission denied.
- [ ] **바꾸는 기존 시험:** 2620~2640행 사례는 세 번째 행을 `prompt_hash = 'p-3'`만으로 DONE·MODEL로 닫는다. 이제 `prompt_version = 'insight/v0.2'`도 넣어 닫는다. 23P01 단언은 그대로 둔다. 이유: 버전 없는 모델 설명은 C1에서 막지 않는 대상이 됐다.
- [ ] `scripts/insight-prompt-version.test.mjs`(새): `insight.model.ts`, `insight.py`, 새 마이그레이션의 버전 글자가 같은지 본다.
- [ ] 마이그레이션(C1)을 쓰고 `pnpm db:types`를 돌린다.
- [ ] `insight.repo.ts`: `INSIGHT_COLUMNS`에 `prompt_version`을 넣고 `promptVersion`으로 옮긴다. `insight.service.ts`의 `isModelDone`은 `promptVersion === INSIGHT_PROMPT_VERSION`일 때만 참이다. `insight.service.test.ts`: 최신이 v0.1 DONE·MODEL이면 새 PENDING(`deduplicated: false`), v0.2이면 있던 행(`deduplicated: true`).
- [ ] Q2에 따라 `latestModelInsight`와 GET 본문 `previous`(C4)도 이 Task에서 한다.
- [ ] 완료: `pnpm test:db`, `node --test scripts/insight-prompt-version.test.mjs`, `pnpm -C web exec vitest run server/insight` 통과.

## Task 3: worker 저장

- [ ] 시험을 먼저 쓴다.
  1. `insight-request.model.test.ts`: `toInsightPayload`가 새 칸이 가리킨 refs를 남기고 아무도 가리키지 않은 refs는 뺀다.
  2. `insight-job.test.ts`: 응답의 `promptVersion`이 `finishDone`으로 넘어간다. 없으면(옛 gateway) null.
  3. `insight-request.model.test.ts`: payload `staffing`이 `staffAvailabilityInput` 값과 같고, 필요 FTE를 모르거나 인력 명부가 비면 null이다(사업 기간을 모르면 기본 기간을 쓴다).
- [ ] `toInsightPayload`가 새 칸을 옮기고 인용 집합에 새 칸의 refIds를 더한다. `staffing`을 규칙 값으로 채운다. `InsightFinishDone`에 `promptVersion`을 더하고 `finishDone`이 `prompt_version`을 쓴다.
- [ ] 완료: `pnpm -C web exec vitest run server/analysis/insight-request.model.test.ts worker/insight-job.test.ts` 통과.

## Task 4: 화면

- [ ] 디자인 스펙을 읽고 시험을 먼저 쓴다(`recommendation-insight.browser.test.tsx`, 가짜 시계).
  1. [추천 분석]을 누르면 팝업이 열리고 진행률 0%가 보인다. 시간이 지나면 오르고, DONE 없이는 99%를 넘지 않는다. DONE이면 100%를 보인 뒤 내용이 나온다.
  2. v0.2 결과로 섹션 8개가 보인다.
  3. 옛 형식 결과는 있는 칸만 보이고, 요청 가능 역할에게만 "새 형식으로 다시 분석"이 보인다. 누르면 POST 한다.
  4. 상세 화면 구역은 상태·판단 이유 첫 문장·버튼만 보인다.
  5. 3분이 넘으면 진행률 99%에 늦음 안내와 [다시 확인]이 보인다.
  6. Esc로 닫히고, 닫으면 초점이 버튼으로 돌아간다.
  7. (Q3) `createdAt`이 1분 전인 PENDING으로 화면을 열면 진행률이 0%가 아니라 1분만큼 진행된 값에서 시작한다.
- [ ] `insight-progress` 단위 시험: 0에서 시작, 줄지 않음, 99 이하.
- [ ] **바꾸는 기존 시험:** "어느 상태에서나 고지를 보이고, 패널 글자에 금지어가 없다"(240행)를 둘로 나눈다. 결과 상태에서는 팝업·구역 전체 글자에 금지어(`%` 포함)가 없다. 진행 상태에서는 진행 표시 요소 밖 글자에 금지어가 없고, 진행 표시 요소는 `%` 하나만 허용한다. 근거는 새 ADR(`%` 예외)이다.
- [ ] **바꾸는 기존 시험(Q3):** 늦어짐 시험(`recommendation-insight.browser.test.tsx:217` 근처)은 지금 훅이 잰 시작 시각부터 3분을 센다. 이제 행의 `createdAt`부터 센다. 기다리는 시간 단언은 그대로 두고 시험 데이터의 `createdAt`을 맞춘다.
- [ ] 부품: 지금 패널을 축소형 구역과 팝업으로 나눈다. `use-insight-request`는 경과의 시작 시각을 내보낸다(C4). 서버 화면이 지금 버전 글자를 prop으로 넘긴다(C4).
- [ ] 완료: `pnpm -C web exec vitest run --config vitest.browser.config.ts components/bids/recommendation-insight.browser.test.tsx "app/(app)/(work)/bids/[id]/recommendation-insight-detail.browser.test.tsx"` 통과. 360·390·768·1280·1440px 스크린샷을 `web/test-results`에 찍어 `docs/evidence/rec-insight-detail/`로 옮긴다.

## Task 5: 문서

- [ ] [[16-DECISIONS|ADR-078]](2026-11-03에 썼다)의 "반영 상태"와 색인 상태 칸을 운영 반영 결과로 고친다. 구현 중 바뀐 것이 있으면 본문 "설계자 판단"에 개정 메모로 단다.
- [ ] 운영에서 FX-01 새 형식 팝업을 확인한 뒤에만 클립 2 추천 분석 장면을 고친다: [[18-HACKATHON|18]] §6 클립 2 줄, [[19-DEMO-SCENARIO|19]] S3 6번·대체 표·촬영 전 점검, [[slides-spec|덱 제작 명세]] 클립 2 캡션·노트. 확인 전에는 고치지 않는다(ADR-078 촬영).
- [ ] `docs/03-AI-PIPELINE.md`(insight 출력 계약), `04-DATABASE.md`(열·제약), `05-API-SPEC.md`(InsightView·GET 본문), `06-UI-UX.md`(§6.2 추천 분석 구역 표·팝업, 134행 움직임 문구는 Q7), `09-SECURITY.md`(195행 제약 설명), `11-TESTING.md`, `15-DATA-CONTRACTS.md`, `PROGRESS.md`.
- [ ] 스펙 `polaris/specs/planned/…` → `in-progress/`(구현 시작 때), `done/`(운영 확인 뒤).

## Task 6: 통합·배포

1. 전체 `pnpm verify`와 `services/ai/verify.sh`를 돌린다.
2. 격리 로컬 스택(mock)에서 확인한다. FX-01 옛 형식 → "새 형식으로 다시 분석" → 진행률 → v0.2 팝업. 기본 Compose와 54321 포트는 쓰지 않는다.
3. 독립 리뷰를 한 번 받는다(security-auditor: 제약 변경, `%` 예외, 항목 제외 경로). 그다음 `/predeploy-review`.
4. 운영 반영. 단계마다 승인을 받는다.

| 단계 | 할 일 | 옛 코드와 함께 돌 때 |
|---|---|---|
| a | 운영 DB에 C1 마이그레이션과 같은 SQL을 직접 실행한다. `pnpm db:push`는 쓰지 않는다. 미룬 구글 캘린더 표(`20261030002000`)까지 적용되기 때문이다(ADR-075·077 선례, `schema_migrations` 미기록). 실행 전 `--check`로 미적용 목록을 본다 | 옛 redis-api는 모든 DONE·MODEL을 중복으로 보므로 동작이 그대로다. 옛 worker는 `prompt_version`을 쓰지 않는다(null) |
| b | main push(Vercel)와 회사 redis-api·Analysis Worker 교체. 같은 커밋 해시 | 옛 gateway는 v0.1 결과를 내고 새 코드가 그대로 읽는다 |
| c | 회사 AI gateway 교체 | Vercel이 먼저 새 스키마를 가져야 한다. 옛 Vercel은 800자 판단 이유를 읽다 실패한다 |
| d | 운영 FX-01 추천 분석을 다시 요청한다(회사 Qwen 1회. run 재분석이 아니라 FX-01 run `dfac87db`·점수는 그대로). 글자 수 비율(스펙 3절 5)과 소요 시간(10)을 기록하고, T(Q4)와 3분 상한을 다시 볼지 정한다 | — |

- b와 c 사이에는 다시 요청하지 않는다. 옛 gateway가 옛 형식을 또 만든다.
- b와 c는 같은 시간 창에서 바로 잇는다(독립 리뷰 낮음 1, 2026-11-03). 그 사이 옛 gateway 결과는 `prompt_version`이 null이라 중복으로 보지 않으므로, 다른 사용자가 [새 형식으로 다시 분석]을 누를 때마다 Qwen을 부른다. 상한은 사용자당 분당 3회다.
- a는 Supabase MCP `execute_sql` 한 번으로 `begin; set local lock_timeout = '5s';` + 마이그레이션 본문 + `commit;`을 실행한다(독립 리뷰 낮음 3). 문장마다 커밋하는 `psql -f`는 쓰지 않는다. drop과 add 사이에 제약이 빈 순간이 생기기 때문이다.
- 되돌리기(사전 리뷰 Infra W-2, 2026-11-03): c 뒤에 문제가 생기면 c(회사 AI gateway)만 되돌린다. 새 웹·worker는 v0.1·v0.2를 모두 읽는다. c 뒤에 b를 되돌리면 옛 코드가 v0.2 행(판단 이유 400자 초과)을 읽지 못해 그 run의 GET·POST가 500이 된다. b는 앞으로 고치기만 한다.
- 증거는 `docs/evidence/rec-insight-detail/`에 둔다.

## 위험

| 위험 | 대응 |
|---|---|
| 출력이 4096토큰에서 잘려 JSON이 깨지고 전체 대체 | 4d에서 대체 사유를 본다. `INVALID_OUTPUT`이면 상한을 올리거나 상한 글자 수를 줄인다 |
| 생성이 3분을 넘음 | 4d 측정 뒤 Q4를 다시 정한다 |
| 버전 글자가 세 곳에서 어긋나 중복 규칙이 풀림 | `scripts/insight-prompt-version.test.mjs` |
| 회사 vLLM이 커진 guided JSON 스키마를 거절 | 1단계처럼 guided 없이 한 번 다시 부른다(`test_insight_retries_once_without_guided_json`). 4d에서 확인한다 |
| 자격 이름에 숨은 문자가 있으면 guided 목록에 그대로 들어가 모델 결과가 늘 `INVALID_OUTPUT`(독립 리뷰 낮음 2) | 2026-11-03 운영 `qualification_checks.requirement_name` 읽기에서 숨은 문자 0건이라 이번에는 고치지 않는다. 생기면 guided 목록과 `_keep_items`의 자격 이름 집합에서 템플릿처럼 뺀다 |

## 관련 문서

- [[2026-10-29-recommendation-insight|1단계 계획]]
- [[2026-11-03-recommendation-insight-detail-design|디자인 스펙]]
- [[16-DECISIONS|결정 기록]] ADR-061·ADR-066·ADR-078
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[04-DATABASE|04 데이터베이스]]
