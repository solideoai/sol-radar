---
title: "P0-8 사전규격·발주계획 단계 연결 — 구현 계획"
status: draft
tags:
  - sol-radar
  - plan
updated: 2026-10-21
---

# P0-8 사전규격·발주계획 단계 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고 상세의 단계 이력 아래에 "같은 사업의 다른 단계 공고"를 실제 DB 행으로 잇는다. 발주계획 → 사전규격 → 입찰공고를 공개 식별자로 잇고, 식별자가 없으면 제목이 비슷한 공고를 "연결 후보"로만 보인다. 데모에서는 FX-17(발주계획) ↔ FX-18(사전규격)이 이어지고 FX-19가 FX-01의 연결 후보로 보인다. live 사전규격·발주계획 응답의 정규화도 녹음 응답으로 만들어 둔다.

**Architecture:** 연결은 저장하지 않고 읽을 때 계산한다(새 표·마이그레이션 없음). bids 도메인의 새 서비스가 `bid_notices` 에서 지금 공고와 식별자가 맞는 행, 후보 풀을 anon 키 + RLS 로 읽고, 이미 있는 순수 함수 `linkStages`(`web/server/ingestion/stage-link.ts`, `@/server/ingestion` 배럴로 공개됨)로 연결·후보를 가린다. 화면은 서버 컴포넌트(`bids/[id]/page.tsx`)가 서비스를 바로 부르고 새 부품 `StageLinks` 에 넘긴다. `StageTimeline` 은 S5(93)가 고치므로 손대지 않는다. live 수집은 정규화 순수 함수까지만 만들고 worker 연결은 freeze 뒤 별도 계획이다.

**Tech Stack:** Next.js 16(App Router, 서버 컴포넌트) · Supabase(Postgres·RLS) · zod · Vitest(단위·브라우저).

**Spec:** 별도 스펙 파일은 없다. 정본 절이 스펙이다.
- `docs/12-ROADMAP.md` P0-8 "사전규격·발주계획 수집과 단계 연결 — StageTimeline에 실데이터", 확장 컷 순서(ADR-023)
- `docs/07-DATA-PIPELINE.md` §1.1(서비스 표), §2.2(요청 규칙·호출 시점), §4(공고 이력 연결), §6.2 FX-17~FX-20
- `docs/15-DATA-CONTRACTS.md` §3 `NormalizedBid`(`planRef`·`preSpecRef`), §8 registry(`g2b-pre-spec` 일정 실행, `g2b-order-plan` 하루 1회)
- `docs/06-UI-UX.md` §5 컴포넌트 표 `StageTimeline`(`stages[]`, 연결 후보 표시 FX-19)
- `docs/plans/2026-10-19-c6-screens-design.md` §5.4.3(단계 연결·연결 후보는 확장 컷)
- `docs/19-DEMO-SCENARIO.md` Q&A 예비 장면(FX-17 → FX-18)
- `docs/evidence/phase-0/external-deps-api-20261019.md` §10 6번(발주계획 파라미터)·마스킹 표, `fixtures/recorded/15129437`·`15129462`

배정은 sol-radar-12 지시(2026-10-21)다. 사용자 결정(10-21, 12 창): 확장 컷을 지금 병행하되 ① 덧붙이기만 ② 작업자가 겹치면 핵심 컷 먼저 ③ freeze 10-23 까지 green 아니면 데모에서 뺀다 ④ 승률·확률·모바일·결제 금지.

## Global Constraints

- 덧붙이기만 한다. 핵심 컷 경로·계약은 바꾸지 않는다: 저장 RPC `ingest_save_revision`, 분석 job, `GET /api/v1/bids/:id` 응답(05 §4.3 `BidDetail.stageLinks` 그대로), `StageTimeline` 의 지금 동작.
- freeze(10-24 22:00, ADR-042. 처음 10-23 에서 바뀜)까지 green 이 아니면 데모에서 뺀다. 화면 진입점은 상세의 한 구역(`StageLinks`)뿐이라 그 한 줄을 빼면 사라진다.
- 승률·확률 표시 금지. 제목 유사도 숫자는 화면에 내지 않는다(확률로 읽힐 수 있다). 모바일·결제 코드 금지. 화면 확인은 1440·1280 두 폭만.
- 공공 API 실호출 금지. live 정규화는 `fixtures/recorded/` 녹음 응답만 쓴다. `AI_PROVIDER=mock`.
- 마이그레이션은 이 계획에 없다. 필요해지면 `20261021000400`~`000499` 대역만 쓰고, 3e 에 기준점을 보내기 전에 main 을 합쳐 main 최대 번호보다 크게 다시 붙이고 `pnpm db:types` 를 같은 커밋에 넣는다.
- 서버 파일은 `import "server-only";` 로 시작한다. 데이터는 anon 키 + RLS 로 읽는다(`bid_notices` 는 `authenticated` select + "활동 중 회원은 공고 읽기" 정책). service role 은 쓰지 않는다.
- 도메인은 배럴로만 부른다(`@/server/ingestion`, `@/server/bids`). lodestar 는 같은 domain 층끼리의 import 를 허용한다.
- `.env` 이름 파일은 어떤 도구로도 읽지 않는다(셸·node·python·스캔, env 이름 이어 붙이기 포함). `node --env-file` 금지. 가드·훅·린트에 막히면 돌아가지 말고 멈춰 보고한다. `eslint-disable`·`any`·`@ts-ignore`·`.only`·`.skip`·`--no-verify` 금지.
- 무거운 검증(`pnpm verify`·`verify:quick`·`test:browser`·e2e·build)과 `git commit` 은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 으로 감싼다.
- 작업자(서브에이전트)는 git 상태를 바꾸지 않는다. 커밋은 sol-radar-30 이 이 worktree 에서만 한다. main 병합·push 금지(병합은 3e).
- 겹치는 파일: 93(S5)이 `web/server/bids/index.ts`·`bids.repo.ts`·`bids.supabase.ts`·`web/components/bids/stage-timeline.tsx`·`bids/[id]/bid-detail-view.tsx` 를 고친다. 이 계획은 `bids.repo.ts`·`bids.supabase.ts`·`stage-timeline.tsx` 를 고치지 않는다. `index.ts`(내보내기 줄 추가)와 `bid-detail-view.tsx`(prop 하나·JSX 한 줄)는 93 에 먼저 알리고, 병합 때 충돌은 3e 가 줄 단위로 푼다.

## 판정 (이 계획이 정한 것 — 12·45 에 알린다)

| # | 정한 것 | 고른 이유 | 버린 안 |
|---|---|---|---|
| D1 | 단계 연결은 **읽을 때 계산**한다. 새 표·마이그레이션·저장 RPC 변경 없음 | 가장 단순하고 되돌리기 쉽다. 수집 경로를 건드리지 않는다 | 수집 때 `bid_stage_links` 표에 저장(마이그레이션·RLS·worker 변경 필요) |
| D2 | 식별자 연결은 `linkStages` 규칙 그대로: 같은 `plan_ref`(단계가 다를 때) = `PLAN_REF`, 사전규격의 `notice_id` = 다른 공고의 `pre_spec_ref` = `PRE_SPEC_REF`. **같은 `is_demo` 끼리만** 잇는다 | 가상 공고(`DEMO-PLAN-0042`)와 실공고가 섞이지 않게 한다(07 §1.2 출처 구분) | 출처 무관하게 잇기 |
| D3 | 연결 후보는 지금 공고와 **단계가 다르고 같은 `is_demo`** 인 공고 중 게시일 최근 300건에서 `linkStages` 후보(제목 2-gram Dice ≥ 0.5, 가정값)만 낸다. 후보는 자동으로 잇지 않는다. 취소된 공고는 후보에서 뺀다(식별자로 이어진 취소 공고는 연결에 남는다, [[2026-10-21-p08-stage-links-ui-spec\|UI 스펙]] §11 질문 2 ①) | 07 §4 "제목 유사도만으로 자동 병합하지 않고 연결 후보로만". 300건 상한은 상세 한 번 읽기 비용을 묶는 가정값이다 | 같은 기관으로 좁히기(설계에 없는 조건), DB `pg_trgm` 계산(PGlite 시험에 확장이 없을 수 있다) |
| D4 | `GET /api/v1/bids/:id` 응답은 바꾸지 않는다. 화면은 서버 컴포넌트에서 새 서비스를 부른다. 06 의 `stages[]` 를 API 로 여는 일은 후속 | 핵심 컷 계약 불변(조건 ①) | `BidDetail` 에 `stages[]` 추가 |
| D5 | 화면은 `StageTimeline` 을 고치지 않고 바로 아래 새 부품 `StageLinks` 로 둔다. 연결도 후보도 없으면 구역을 그리지 않는다. 유사도 숫자는 내지 않는다 | S5(93)와 같은 파일을 피한다. 확률 표시 금지(조건 ④) | `StageTimeline` 안에 링크 넣기 |
| D6 | live 사전규격·발주계획은 이번에 **정규화 순수 함수 + 녹음 응답 시험까지만** 만든다. worker 연결(일정 실행·호출 예산·저장)은 freeze 뒤 별도 계획이고 env 기본 꺼짐으로 둔다 | live 호출이 생기는 일은 사용자 결정이고, 수집 경로(worker main·큐) 변경은 조건 ①에 걸린다 | 이번에 worker 까지 연결 |
| D7 | 사전규격 응답에는 상세 URL 이 없다. `sourceUrl` 은 첫 `specDocFileUrl1~5`(첨부 허용 목록 `https://www.g2b.go.kr/pn/` 안)로 하고, 없으면 필수 누락 격리(`MISSING_REQUIRED_FIELD`)다 | 확인되지 않은 상세 URL 꼴을 지어내지 않는다(09·17 "미확인 외부 명세는 만들지 않는다") | 나라장터 상세 URL 꼴을 추정해 만들기 |
| D8 | 정보화 필터: 사전규격은 `swBizObjYn='Y'` 를 기본 필터(교체 가능한 순수 함수)로 둔다. 발주계획은 필터 함수를 두지 않고, worker 연결 때 "입찰공고와 식별자로 이어지는 행만 저장"으로 정한다(후속 계획) | 녹음 표본 10건이 모두 `N`·비정보화라 다른 규칙의 근거가 없다. 발주계획에는 정보화 표시 필드가 없다 | 제목 키워드 필터(근거 없음) |

## 단계

### Task 1: 단계 연결 읽기 서비스 (`web/server/bids`)

**Files:**
- Create: `web/server/bids/stage-links.model.ts` — 화면이 받을 꼴(zod `strictObject`)
  - `StageLinkItem = { bidId, stage, noticeId, title, agency, status, basis: "PLAN_REF" | "PRE_SPEC_REF" }`
  - `StageLinkCandidateItem = { bidId, stage, noticeId, title, agency }`
  - `StageLinksView = { linked: StageLinkItem[]; candidates: StageLinkCandidateItem[] }`
- Create: `web/server/bids/stage-links.repo.ts` — 포트 `StageLinksRepo`
  - `findAnchor(bidId)` → 지금 공고의 `id·stage·notice_id·plan_ref·pre_spec_ref·title·agency·status·is_demo`, 없으면 null
  - `findByIdentifiers(anchor)` → 같은 `is_demo` 이고 (`plan_ref` = anchor.plan_ref) 또는 (`stage='PRE_SPEC'` 이고 `notice_id` = anchor.pre_spec_ref) 또는 (anchor 가 PRE_SPEC 이면 `pre_spec_ref` = anchor.notice_id) 인 행. anchor 자신 제외
  - `findCandidatePool(anchor, limit)` → 같은 `is_demo`, `stage <> anchor.stage`, `published_at desc nulls last, id desc`, `limit` 300
- Create: `web/server/bids/stage-links.supabase.ts` — 위 포트의 Supabase 구현(`getSupabase()` anon + RLS, `bid_notices` 만 읽음. 값은 PostgREST `.eq`·`.or` 필터로 넘기고 문자열을 이어 붙여 필터를 만들지 않는다 — 식별자에 쉼표·괄호가 있으면 `.or` 를 쓰지 않고 쿼리를 나눈다)
- Create: `web/server/bids/stage-links.service.ts` — `getStageLinks(bidId, { repo })` → `{ ok: true, data: StageLinksView } | { ok: false, status: 404 | 500, message }`
  - anchor + 식별자 행 + 후보 풀을 합쳐(중복 id 제거) `linkStages` 에 넣고, anchor 가 낀 연결·후보만 남긴다. 정렬: 연결은 단계 순서(PLAN → PRE_SPEC → NOTICE) 다음 `noticeId`, 후보는 `linkStages` 순서(유사도 내림차순) 그대로, 최대 3건
- Modify: `web/server/bids/index.ts` — `getStageLinks`·`stageLinksRepo`·타입 내보내기 줄 추가(93 에 알림)
- Test: `web/server/bids/stage-links.service.test.ts`(메모리 가짜 repo), `web/server/bids/stage-links.supabase.test.ts`(기존 `bids.supabase.test.ts` 의 가짜 클라이언트 꼴로 쿼리 모양·`is_demo` 필터·자기 제외·한도 단언)

**완료 기준:**
- [ ] FX-18 꼴 → `linked` 에 FX-17(PLAN, `PLAN_REF`). FX-17 꼴 → `linked` 에 FX-18. 둘 다 `candidates` 에 서로 없음
- [ ] FX-19 꼴 → `linked` 비고 `candidates` 에 FX-01. FX-01 꼴 → `candidates` 에 FX-19
- [ ] `pre_spec_ref` 연결(live 꼴: NOTICE `pre_spec_ref=R26BD…` ↔ PRE_SPEC `notice_id=R26BD…`) → `PRE_SPEC_REF`
- [ ] `is_demo` 가 다른 같은 `plan_ref` 행은 잇지 않는다. 같은 단계끼리는 후보도 아니다
- [ ] 없는 공고 → 404, repo 오류 → 500(메시지 한국어, 내부 오류 문자열 노출 없음)
- [ ] 변형 확인: `is_demo` 조건을 빼면 해당 시험이 실패하는지 한 번 확인
- [ ] `pnpm -C web exec vitest run server/bids/stage-links` 통과, `pnpm verify:quick` 초록

### Task 2: 화면 `StageLinks` (디자인 스펙 먼저)

**Files:**
- Create: `docs/plans/2026-10-21-p08-stage-links-ui-spec.md` — `web-designer` 가 쓴다. 구역 위치(단계 이력 바로 아래), 연결 행(단계 라벨·제목 링크 `/bids/[id]`·공고번호·"식별자 연결" 근거), 후보 행(제목 링크·"연결 후보 · 자동으로 잇지 않았습니다"), 빈 상태(구역 없음), 읽기 실패(구역에 한 줄 안내, 상세는 그대로), 토큰·`type-*` 눈금·접근성
- Create: `web/components/bids/stage-links.tsx` — 서버에서 받은 `StageLinksView | null`(null = 읽기 실패)을 그린다. `STAGE_LABEL` 재사용
- Create: `web/components/bids/stage-links.browser.test.tsx` — 연결·후보·빈 상태·실패, 1440·1280 두 폭 스크린샷(`web/test-results` 에 찍고 `docs/evidence/p08/` 로 복사)
- Modify: `web/app/(app)/(work)/bids/[id]/page.tsx` — `getStageLinks(id, { repo: stageLinksRepo })` 를 기존 `Promise.all` 에 더하고, 실패면 `console.error` 한 줄 + `null` 로 넘긴다(상세는 그린다)
- Modify: `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx` — prop `stageLinks?: StageLinksView | null` 하나와 `StageTimeline` 아래 `<StageLinks …/>` 한 줄(93 에 알림)

**완료 기준:**
- [ ] 디자인 스펙을 받은 뒤 구현한다
- [ ] 브라우저 시험: FX-18 꼴에서 "발주계획" 행 링크가 `/bids/<FX-17 id>` 를 가리킨다. FX-19 꼴에서 후보 문구가 보이고 유사도 숫자는 없다. 빈 상태면 구역이 없다
- [ ] 1440·1280 스크린샷이 `docs/evidence/p08/` 에 있다. 넘침·잘림 없음
- [ ] 실제 앱 화면 확인: 격리 스택(격리 Supabase·격리 compose)을 띄울 수 있으면 FX-18·FX-19 상세를 1440·1280 으로 본다. 못 띄우면 못 했다고 적고 3e 병합 전 확인으로 넘긴다
- [ ] `pnpm verify` 초록(슬롯 스크립트)

### Task 3: live 사전규격·발주계획 정규화 (녹음 응답, worker 연결 없음)

**Files:**
- Create: `web/server/ingestion/g2b-stage.model.ts` — 사전규격·발주계획 서비스 id·오퍼레이션·source 상수(항목 검증은 마지막 `normalizedBidDraftSchema` 가 한다)
- Create: `web/server/ingestion/normalize-g2b-pre-spec.ts` — 항목 → `NormalizedBidDraft`
  - `source=g2b-pre-spec`, `stage=PRE_SPEC`, `status=OPEN`(응답에 종류 칸 없음), `noticeId=bfSpecRgstNo`, `preSpecRef=bfSpecRgstNo`. 차수 칸이 없어 `amendmentNo`·`planRef` 는 두지 않는다
  - `title=prdctClsfcNoNm`, `agency=rlDminsttNm`(없으면 `orderInsttNm`), `budgetKrw=asignBdgtAmt`, `noticeDate=rgstDt`, `deadlineAt=opninRgstClseDt`(의견등록 마감, KST → UTC)
  - `sourceUrl`·`attachments` = `specDocFileUrl1~5`(허용 목록 안만, D7)
  - 담당자 `ofclNm`·`ofclTelNo` 는 넣지 않는다. `bidNtceNoList` 는 아직 쓰지 않는다(연결은 입찰공고 쪽 `bfSpecRgstNo`)
- Create: `web/server/ingestion/normalize-g2b-order-plan.ts` — 항목 → `NormalizedBidDraft`
  - `source=g2b-order-plan`, `stage=PLAN`, `status=OPEN`, `noticeId=orderPlanUntyNo`, `planRef=orderPlanUntyNo`. `amendmentNo`·`preSpecRef` 는 두지 않는다
  - `title=bizNm`, `agency=orderInsttNm`, `budgetKrw=sumOrderAmt`, `noticeDate=nticeDt`, `deadlineAt=null`(발주계획에는 마감 없음, 15 `NOT_APPLICABLE`), `sourceUrl=orderPlanDtlUrl`
  - 담당자 `ofclNm`·`telNo` 는 넣지 않는다
- Create: `web/server/ingestion/g2b-stage-filter.ts` — 사전규격 정보화 필터 `swBizObjYn==='Y'`(교체 가능한 순수 함수, D8)
- Create: `web/server/ingestion/g2b-stage-request.ts` — 요청 파라미터 빌더: 사전규격 `inqryDiv=1`+`inqryBgnDt`/`inqryEndDt`(`YYYYMMDDHHMM`), 발주계획 `inqryDiv=1`+`orderBgnYm`/`orderEndYm`(`YYYYMM`). 시험만 하고 아무도 부르지 않는다
- Modify: `web/server/ingestion/index.ts` — 새 함수 내보내기 줄 추가
- Test: `web/server/ingestion/g2b-stage.test.ts` 하나 — `recorded-api.ts` 로 녹음 응답을 읽는다

**완료 기준:**
- [ ] 사전규격 녹음 10건 → 10건 모두 `normalizedBidDraftSchema` 통과(또는 URL 없는 건 격리 사유가 정확), 정규화 결과에 `ofclNm`·`ofclTelNo` 값 없음
- [ ] 발주계획 녹음 10건 → 10건 통과, `planRef === noticeId`, `deadlineAt === null`, 담당자 값 없음
- [ ] 발주계획 `error08` 녹음 → 기존 envelope 해석이 오류로 읽는다(정규화하지 않음)
- [ ] 사전규격 필터: 녹음 10건 모두 `N` → 0건 통과, `Y` 로 바꾼 사본 → 통과
- [ ] 정규화한 사전규격·발주계획과 입찰공고(`plan_ref`·`pre_spec_ref` 를 맞춘 합성 행)를 `linkStages` 에 넣으면 `PLAN_REF`·`PRE_SPEC_REF` 로 이어진다
- [ ] `pnpm verify` 초록

### Task 4 (freeze 뒤, 이 브랜치 밖): worker 연결

별도 계획으로 쓴다. 들어갈 것: 사전규격 일정 실행·발주계획 하루 1회 job, 서비스별 호출 예산 카운터(`quota:15129437:*`·`quota:15129462:*`), env 기본 꺼짐(`G2B_STAGE_INGEST_ENABLED`, 이름은 그때 확정), 발주계획은 입찰공고와 이어지는 행만 저장(D8), 저장은 기존 `ingest_save_revision` 그대로. live 호출이 생기므로 켜는 것은 사용자 결정이다.

## freeze(10-24 22:00) 전 최소 범위

- **반드시**: Task 1·Task 2. fixture·mock 데이터(`pnpm demo:reset` 의 FX-17~FX-19)로 상세에서 단계 연결과 연결 후보가 보인다. 이것으로 19 Q&A 예비 장면(FX-17 → FX-18)이 화면에서 돈다.
- **되면**: Task 3. freeze 전에 green 이면 같은 기준점에 넣고, 아니면 다음 묶음으로 미룬다(데모 장면에 쓰이지 않는다).
- freeze 까지 Task 1·2 가 green 이 아니면 `bid-detail-view.tsx` 의 `<StageLinks>` 한 줄과 page 의 읽기를 빼고 데모에서 뺀다(조건 ③).

## 정본 문서에 반영할 것 (45 에 넘긴다, 이 브랜치는 `docs/plans/`·`docs/PROGRESS.md`·`docs/evidence/p08/` 만 쓴다)

- 07 §4: 읽을 때 계산(D1), 같은 `is_demo` 끼리(D2), 후보 풀 300건 가정값(D3). §1.1 표의 P0-8 행 구현 상태
- 06 §5 `StageTimeline` 행: 연결·후보는 `StageLinks` 구역이 맡는다(D5)
- 05 §4.3: `stages[]` 는 API 에 아직 없다(D4)
- 07 §3 또는 15 §3: 사전규격·발주계획 매핑 표(Task 3), 사전규격 `sourceUrl` 규칙(D7), 정보화 필터(D8)
- 12 P0-8 완료 기준 "StageTimeline에 실데이터": fixture 데이터로는 Task 2, live 실데이터는 Task 4 뒤

## 검증·증거

- 단계마다 해당 Vitest 를 돌리고, Task 끝마다 `pnpm verify:quick`, Task 2·3 끝에 `pnpm verify`(슬롯 스크립트).
- 증거: `docs/evidence/p08/`(시험 출력 요약, 1440·1280 스크린샷). 작업 뒤 `docs/PROGRESS.md` 작업 로그에 한 행.
- 코드 검토: 08 에 읽기 검토를 맡긴다. 작업자 보고는 diff·시험을 직접 보고 받아들인다.
- 3e 에 보낼 것: 브랜치·해시·`pnpm verify` 결과·겹치는 파일 목록(93 과 같은 `index.ts`·`bid-detail-view.tsx`).

## 관련 문서

- [[12-ROADMAP|12 로드맵]]
- [[07-DATA-PIPELINE|07 수집]]
- [[15-DATA-CONTRACTS|15 데이터 계약]]
- [[06-UI-UX|06 화면]]
- [[16-DECISIONS|16 결정]]
- [[PROGRESS|진행 상황]]
