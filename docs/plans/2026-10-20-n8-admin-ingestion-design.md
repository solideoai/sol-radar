---
title: "디자인 스펙 — N8 데이터 수집 관리 (/admin/ingestion)"
doc: "design-n8-admin-ingestion"
status: done
tags:
  - sol-radar
  - ui
  - hackathon
created: 2026-10-20
updated: 2026-10-20
---

# 디자인 스펙: N8 데이터 수집 관리 (`/admin/ingestion`)

> [!success] 구현·병합 (2026-10-20)
> 이 스펙은 `n8/admin-ingestion` @ `1ac444c`로 구현돼 main `81249f0`에 병합됐다. ① 소스별 카드는 첫 구현에 없다. 정본은 [[06-UI-UX|06 UI]] §3.2·§5.8과 [[16-DECISIONS|ADR-035]] F3이다. 아래 "초안·사용자 승인 뒤 구현" 문구는 작성 당시 기록이다.

[[12-ROADMAP|12 로드맵]] 확장 컷의 "`/admin/ingestion` 화면"과 [[PROGRESS|진행 상황]]의 "데모 필수 N8"을 구현자가 추측 없이 옮길 수 있게 고정한다. 이 문서는 **초안**이며 사용자 승인 뒤 구현한다. 코드·정본·설정은 바꾸지 않는다. 화면 문구는 모두 초안이고 확정은 사용자 몫이다. 결정이 필요한 것은 §12에 D1~D15로 모았다.

> [!warning] 미검증 가정
> 코드와 문서만 읽고 썼다. 브라우저·dev 서버는 띄우지 않았다. 1440·1280 폭의 칸 너비는 계산값이다. `docs/evidence/demo-day/`가 아직 없어서, 실제 값은 `docs/evidence/phase-1/seed-summary.json`(2026-10-19 seed)과 수집 도메인 코드(`web/server/ingestion/`)에서 확인했다. `/api/v1/admin/ingestion/*` Route Handler는 이 작업 폴더에 아직 없다.

## 0. 범위

이미 정해진 것(조정 세션 판정, 2026-10-20):

- 조직 `sol_role=ADMIN` 전용 업무 화면이다. 위치는 `web/app/(app)/(work)/admin/ingestion/`이고 `(work)` 레이아웃과 앱 셸을 쓴다. 템플릿 운영자 화면 `web/app/admin/`(`profiles.is_admin`)은 쓰지 않는다.
- ADMIN이 아니면 **403**이다(06 §5.8, 06 §4). 화면은 `PeopleForbidden` 관례(`web/app/(app)/people/page.tsx:15`, `web/app/_lib/people-data.tsx:27`)대로 403 안내를 그린다. 서비스 운영자(`profiles.is_admin`)라도 지금 업무 조직의 `sol_role`이 ADMIN이 아니면 403이다.
- 사이드바 "시스템 > 데이터 수집 관리" 줄은 [[16-DECISIONS|ADR-021]] 노출 조건 5개를 채운 뒤에만 넣는다. 메뉴를 숨겨도 권한이 되지는 않는다.
- 수동 수집은 비동기다. `POST`는 `202`와 05 §6.5 모양의 본문(`status:"RUNNING"`, `summary` 전부 0, `startedAt`=요청 시각, `requestedBy`)을 준다. 화면은 이력 표를 다시 읽어(polling) 상태를 반영한다. worker가 행을 만들기 전에는 `GET /runs/:id`가 `404`일 수 있다.
- 화면 폭은 1440px 기준, 1280px 최소다. 모바일 레이아웃은 만들지 않는다.

| 넣는다 | 넣지 않는다 |
|---|---|
| 머리(제목·설명·[수동 수집 실행]), 실행 상태 줄, 소스별 카드 2장(D3), 실행 이력 표, 커서 "더 보기" | S5 변경 감지 장면 전체(LIVE 배치의 revision diff 화면·`BID_CHANGED` 알림 확인) |
| 수동 수집 대화상자(소스·배치 고르기, 실행 모드와 안 맞는 소스 비활성) | 템플릿 `/admin`(운영자 화면)의 이전·정리, `/ops` 분리(해커톤 이후, [[16-DECISIONS\|ADR-023]]) |
| 실행 상세 서랍(결과 수·격리·재시도·경고·중단 원인) | `/admin/sources`(registry 승인·호출량)·`/admin/ai/*` 화면 |
| polling(다시 읽기 주기·멈춤 조건), 오류 응답 처리(400·401·403·409×3·429·500·503) | 이력 표의 거르기·정렬 바꾸기(API에 쿼리가 없다, 건수가 적다) |
| 403 안내 화면 | run 취소·재실행 단추(API 없음), 일정 수집 설정 |
| | g2b 수집 구간·단계 입력(D8) |

범위 외 확인: 결제·구독, 1280px 미만 레이아웃·모바일, 승률 예측, 자동 투찰은 이 화면 어디에도 없다.

## 1. 기준

| 무엇 | 근거 |
|---|---|
| 화면 구성·빈 상태·권한 | `docs/06-UI-UX.md` §2(사이트맵 49행), §4(사이드바 153행·노출 조건), §4.1(181행 메뉴 표, 아이콘 `database`), §5.1(공통 상태), §5.8(`/admin/ingestion`), §10·§11·§12 |
| 글자 눈금 | 06 §3.3 기본 눈금(`title`·`heading`·`body`·`label`·`caption`). 대시보드 예외(B25)·사이드바 예외(B26)는 이 화면 본문과 상관없다 |
| API·DTO·오류 | `docs/05-API-SPEC.md` §1(28행 멱등, 30행 속도 제한), §2(75~77행), §4 `IngestionRunInput`·`IngestionRun`(361~376행), 428행 검증 규칙, §5 오류 코드(495·498·499·502행), §6.5·§6.6 예시 |
| 저장·정책 | `docs/04-DATABASE.md` §3 `ingest_runs`·`ingest_errors`(208·209행), enum(278~287행). `supabase/migrations/20261019000006_ingest_outbox_notifications_audit.sql`(공용 표, ADMIN만 읽기) |
| 수집 동작 | `docs/07-DATA-PIPELINE.md` §6.2 fixture 표(`FX-12` 격리, `FX-20` 429 두 번), 배치 표(371·372행 기대 `summary`), 376행 상태 규칙 |
| 데모 기대값 | `docs/11-TESTING.md` §5 #12(S5 LIVE `{changed:3, cancelled:1, skippedDuplicate:1}`)·#17(SEED 격리 1건·재시도 2회), §9 NAV-05·NAV-09. `docs/19-DEMO-SCENARIO.md` §3 3번, S5(155~160행), §5 196행("공공 API 오류: {코드}") |
| 보안 | `docs/09-SECURITY.md` 60·64행(ADMIN만), 86행(서비스키 가림), 87행(속도 제한·감사) |
| 화면 관례 | C6 스펙 `docs/plans/2026-10-19-c6-screens-design.md`(§3.3 상태 표기, §3.5 공통 상태, §5.3 표, §5.4.2 polling, §5.4.8 근거 서랍) |
| 코드 견본 | `web/app/(app)/(work)/layout.tsx`·`work.ts`(`requireWork`가 `role` 반환)·`empty-state.tsx`·`load-more.tsx`·`work-error.tsx`, `bids/page.tsx`·`loading.tsx`·`error.tsx`, `bids/[id]/use-analysis-run.ts`(polling 상수)·`api-envelope.ts`(CSRF 머리글·오류 봉투), `web/components/bids/status-badge.tsx`·`labels.ts`·`evidence-drawer.tsx`·`format.ts`, `web/components/app-shell.tsx`(`NAV`), `web/components/topbar-status.tsx`(`refreshTopbarStatus`) |
| 수집 코드 | `web/server/ingestion/` — `validation.ts`(격리·경고 코드, `missing: …` 상세 문구), `connector.model.ts`(오류 코드 대응), `retry.ts`(재시도 기록 `attempts`), `ingestion.service.ts`(재시도 기록을 저장하지 않음, 309행), `ingestion.queue.ts`(job data에 `stages` 없음) |
| 실제 값 | `docs/evidence/phase-1/seed-summary.json`: SEED run `summary {created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}`, 격리 `FX-12` = `noticeId DEMO-2026-0012`, `missing: [title]`, `runMode: MOCK` |

한계: 다른 브랜치의 미병합 화면(`c6/admin-ai-status` 등)은 보지 않았다. 이 폴더의 코드만 근거로 삼았다.

## 2. 흐름

```mermaid
flowchart TD
 E[/admin/ingestion 진입] --> G{로그인·가입 완료·업무 조직 1개?}
 G -- 아니오 --> R[기존 안내 화면으로 이동<br/>requireWork]
 G -- 예 --> A{sol_role = ADMIN?}
 A -- 아니오 --> F[403 안내 화면]
 A -- 예 --> L[목록 화면<br/>소스별 카드 + 실행 이력 첫 쪽]
 L -->|첫 쪽에 RUNNING 있음| P[polling 시작]
 L --> B[수동 수집 실행 단추]
 B --> D[대화상자: 소스·배치 고르기]
 D -->|POST 202| Q[대화상자 닫힘 · 상태 줄 '접수됨' · 이력 맨 위에 접수 행]
 D -->|400·409·429·5xx| DE[대화상자 안 오류 · 열린 채로]
 Q --> P
 P -->|행이 목록에 나타남| RUN[상태 줄 '실행 중']
 P -->|60초 지나도 목록에 없음| W[worker 미시작 안내 · polling 계속]
 RUN -->|SUCCEEDED·PARTIAL·FAILED| DONE[상태 줄 결과 · 화면 다시 그림 · 상단바 수집 지표 갱신]
 P -->|5분 초과| SLOW[확인 지연 · 자동 확인 멈춤 · 다시 확인 단추]
 L --> O[행의 시작 시각 단추]
 O --> S[실행 상세 서랍]
 S -->|GET :id 404, 이 화면에서 접수한 run| SP[아직 시작 전 · 서랍도 다시 읽음]
 S -->|GET :id 404, 그 밖| SN[찾을 수 없음]
```

## 3. 공통 규칙

### 3.1 경로·틀·권한 — UI 요구와 서버 요구를 나눈다

| 항목 | UI 요구("안 보이게") | 서버 요구("못 하게") |
|---|---|---|
| 화면 진입 | `page.tsx`가 `requireWork("/admin/ingestion")`를 부르고, `role !== "ADMIN"`이면 데이터를 읽지 않고 403 안내를 그린다(§4.9) | 데이터 읽기는 사용자 세션(anon 키)으로 하고 RLS 정책 "ADMIN 은 수집 run 읽기"·"ADMIN 은 수집 오류 읽기"가 막는다 |
| API | — | `GET·POST /api/v1/admin/ingestion/runs`, `GET …/runs/:id`는 `sol_role=ADMIN`이 아니면 `403 FORBIDDEN`(`details.required:["ADMIN"]`). 쿠키 인증 `POST`는 `X-Requested-With: sol-radar` 없으면 `403 CSRF_REJECTED` |
| 메뉴 | 노출 조건 5개를 채운 뒤 `NAV`에 한 줄 더한다. ADMIN에게만 보인다(D11) | 메뉴와 상관없이 위 서버 검사를 항상 한다(NAV-09) |
| 상단 막대 화면 이름 | 메뉴 노출 전에도 "데이터 수집 관리"가 보이게 한다(D11) | — |
| 감사 | 화면에는 감사 기록을 보이지 않는다 | 수동 수집 요청마다 `audit_logs`에 `INGEST_MANUAL`(조직·요청자·run)을 남긴다(`createSupabaseIngestAudit`, 07 §2) |

- 본문은 `AppPage`(`title="데이터 수집 관리"`, `contentClassName="max-w-360"` — `/bids`와 같은 단 폭)로 감싼다. `main`은 `AppPage`가 그린다.
- `loading.tsx`·`error.tsx`를 둔다(`/bids`와 같은 방식). `error.tsx`는 `WorkError`(`title="데이터 수집 관리"`, `contentClassName="max-w-360"`)다. 상세는 서랍이라(D1) `[id]` 경로와 `not-found.tsx`가 없다.
- 미인증·가입 미완료·업무 조직 0개/2개 이상은 `requireWork`가 이미 처리한다(로그인 화면·가입 보완·조직 상태 안내로 보낸다). 이 화면에서 새로 그리지 않는다.

### 3.2 화면 폭

C6 §3.2와 같다. 사이드바 256px, `AppPage` 좌우 여백 32px씩.

| 화면 폭 | 사이드바 펼침 | 사이드바 접음 |
|---|---|---|
| 1440px | 본문 1120px | 1376px |
| 1280px | 본문 960px | 1216px |

가장 좁은 경우(1280px·펼침, 960px)에서 가로로 넘치지 않아야 한다. 칸 수는 화면 폭이 아니라 단 폭(`@container`)으로 정한다. 서랍(480px)과 대화상자(480px)는 두 폭에서 같다.

### 3.3 상태 표기 — 수집 run

06 §3.2에는 수집 상태 줄이 없어 C6 §3.3의 아이콘·색을 그대로 빌린다. 아이콘 + 글자 + 색을 함께 쓰고, 색은 글자·아이콘·테두리에만 쓴다.

| 상태 | 표 칸 글자 | 서랍·상태 줄 글자 | 아이콘 (lucide-react) | 색 토큰 | `StatusBadge` 키 |
|---|---|---|---|---|---|
| 접수됨(화면 전용, D15) | `접수됨` | `접수됨 · 작업 시작 대기` | `LoaderCircleIcon`(회전) | `text-muted-foreground` | `QUEUED` |
| `RUNNING` | `실행 중` | `실행 중` | `LoaderCircleIcon`(회전) | `text-muted-foreground` | `RUNNING` |
| `SUCCEEDED` | `완료` | `완료` | `CheckIcon` | `text-success` | `COMPLETED` |
| `PARTIAL` | `부분 완료` | `부분 완료 (격리 N건)` | `TriangleAlertIcon` | `text-warning` | `PARTIAL` |
| `FAILED` | `실패` | `실패` | `OctagonAlertIcon` | `text-destructive` | `FAILED` |

회전 아이콘은 `StatusBadge`처럼 `animate-spin motion-reduce:animate-none`이다(C6 구현과 같다. 06 §3.3 문장과의 차이는 §11 5번).

### 3.4 용어·숫자·시각

| 값 | 화면 글자(초안) | 근거 |
|---|---|---|
| `source: "fixture"` | `데모 데이터 (fixture)`, 좁은 칸 `데모 데이터` | 05 `IngestionRunInput` |
| `source: "g2b"` | `나라장터 (g2b)`, 좁은 칸 `나라장터` | 05 |
| `batch: "seed"`·`"live"` | `배치 SEED`·`배치 LIVE`. 항상 앞에 "배치"를 붙인다 | 19 §2.1: 배치 LIVE는 실행 모드 live와 다르다 |
| `runMode` | `실행 모드 mock`·`fixture`·`live`. 항상 앞에 "실행 모드"를 붙인다 | 05 `RunMode`(소문자) |
| `trigger: "MANUAL"` | `수동 · {requestedBy.name}`. `requestedBy=null`이면 `수동 · 요청자 정보 없음` | 05, 04(on delete set null) |
| `trigger: "DEMO"` | `데모 초기화` (서랍: `데모 초기화 (pnpm demo:reset)`) | `seed-fixture-bids.ts` 58행 |
| `trigger: "SCHEDULED"` | `일정` | 05 |
| 시각 | 표: `formatKst` `2026-10-20 14:03`. 서랍: 초까지 `2026-10-20 14:03:05`. 모두 `<time dateTime={UTC 원값}>` + `title`에 UTC 원값 | 06 §11 |
| 상대 시각 | 소스별 카드에서만 `formatRelative`(`12분 전`) | C6 §3.4 |
| 걸린 시간 | `finishedAt - startedAt`: `12초`·`3분 4초`·`1시간 2분`. 진행 중이면 `실행 중`(초 단위로 흐르게 하지 않는다) | — |
| 건수 | 정수, `Intl.NumberFormat('ko-KR')`, `tabular-nums`, 오른쪽 정렬. 0은 `text-muted-foreground`. 100,000 이상은 `12.3만`(compact) + `title`·스크린리더에 전체 수 | §9 넘침 |
| run id | 표·제목: 앞 8자리(`d5367aa6`, `font-mono`). 서랍 아래에 전체 UUID | 06 §5.8 "run id" |
| 공고 식별 | `errors[].sourceKey` 원문 그대로, `font-mono`(D6) | 05 `errors` |

## 4. 화면 명세

### 4.1 정보 위계와 레이아웃

**목적**: ADMIN이 공고 수집이 언제 어떻게 돌았는지, 무엇을 적재·격리·재시도했는지 확인하고, 필요하면 수집을 직접 실행한다(S0 3번 확인, S5 LIVE 배치 실행, S7 #17 확인).

**위계**: ① h1 "데이터 수집 관리" + 설명 + [수동 수집 실행] → ② 실행 상태 줄(있을 때만) → ③ 소스별 카드 2장 → ④ 실행 이력 표 + 더 보기. 실행 상세는 오른쪽 서랍(§4.7).

```text
1440px, 사이드바 펼침 (본문 1120)
데이터 수집 관리                                                                    [수동 수집 실행]
공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⟳ 수집 실행 중 · 데모 데이터 · 배치 LIVE · d5367aa6 · 14:03 시작                        [자세히] │  ← ② 있을 때만
└──────────────────────────────────────────────────────────────────────────────────────────────┘

소스별 최근 수집
┌ 데모 데이터 (fixture) ──────────────────────────┐ ┌ 나라장터 (g2b) ───────────────────────────────┐
│ 실행 모드 mock에서 실행할 수 있습니다            │ │ 실행 모드 live에서만 실행할 수 있습니다         │
│ 마지막 성공  2026-10-20 13:51 · 12분 전          │ │ 마지막 성공  2026-10-19 09:10 · 1일 전          │
│ 마지막 실패  없음                                │ │ 마지막 실패  없음                               │
│ 적재        신규 19 · 변경 0                     │ │ 적재        신규 3 · 변경 0                     │
│ 격리        1건                                  │ │ 격리        0건                                 │
└──────────────────────────────────────────────────┘ └────────────────────────────────────────────────┘

실행 이력
수집 실행 2건 표시
┌시작(152)─────────┬상태(112)──┬소스·방식(가변 424)──────────────────┬신규┬변경┬취소┬중복┬격리┬재시도┐
│2026-10-20 14:03  │⟳ 실행 중   │데모 데이터 · 배치 LIVE                 │   0│   2│   1│   0│   0│    0│
│실행 중           │d5367aa6   │실행 모드 mock · 수동 · 김솔관           │    │    │    │    │    │     │
├──────────────────┼───────────┼───────────────────────────────────────┼────┼────┼────┼────┼────┼─────┤
│2026-10-20 13:51  │⚠ 부분 완료 │데모 데이터 · 배치 SEED                 │  19│   0│   0│   0│   1│    2│
│12초              │a1b2c3d4   │실행 모드 mock · 데모 초기화             │    │    │    │    │    │     │
└──────────────────┴───────────┴───────────────────────────────────────┴────┴────┴────┴────┴────┴─────┘
                                            [더 보기]
```

```text
1280px, 사이드바 펼침 (본문 960)
데이터 수집 관리                                                [수동 수집 실행]
공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.

┌ ⟳ 수집 실행 중 · 데모 데이터 · 배치 LIVE · d5367aa6 · 14:03 시작    [자세히] ┐   ← 길면 두 줄, 단추는 오른쪽

소스별 최근 수집
┌ 데모 데이터 (fixture) ───────────────┐ ┌ 나라장터 (g2b) ───────────────────┐   ← 각 약 468px
│ …(1440과 같은 4줄)                    │ │ …                                  │
└──────────────────────────────────────┘ └────────────────────────────────────┘

실행 이력
┌시작(152)─────────┬상태(112)──┬소스·방식(가변 264)───────┬신규┬변경┬취소┬중복┬격리┬재시도┐
│2026-10-20 14:03  │⟳ 실행 중   │데모 데이터 · 배치 LIVE      │ …  (숫자 칸 각 72)
│실행 중           │d5367aa6   │실행 모드 mock · 수동 · 김…  │   ← 둘째 줄 말줄임
└──────────────────┴───────────┴────────────────────────────┴────┴────┴────┴────┴────┴─────┘
```

1440과 1280의 차이는 표의 "소스·방식" 칸 폭(424 ↔ 264px)과 카드 폭뿐이다. 칸 수·순서·글자 크기는 같다. 사이드바를 접으면(1376·1216px) "소스·방식" 칸만 넓어진다.

### 4.2 머리

| 요소 | 내용 | 부품 |
|---|---|---|
| h1 | `데이터 수집 관리` | `AppPage` `title`(`type-title`) |
| 설명 | `공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.` (뒤 문장은 [[16-DECISIONS\|ADR-030]] B18) | `AppPage` `description` |
| [수동 수집 실행] | 화면의 유일한 주요 단추(`Button` 기본 `default`, 36px). 누르면 대화상자(§4.6). 실행 중이면 비활성(D9) — `disabled` + `focusableWhenDisabled`(대화상자가 닫힌 뒤 초점이 단추로 돌아와도 사라지지 않게, `LoadMoreFooter`와 같은 방식). 비활성일 때 단추 바로 아래 `type-caption text-muted-foreground` 한 줄 `실행 중인 수집이 끝나면 다시 실행할 수 있습니다`를 두고 `aria-describedby`로 잇는다 | `AppPage` `actions` |

### 4.3 실행 상태 줄

진행 중이거나 이 화면에서 방금 끝난 run을 한 줄로 알린다. 06 §5.8 "실행 중 (run id)"의 자리다. 토스트는 쓰지 않는다(D13).

- 모양: `rounded-lg border px-4 py-3`, `flex flex-wrap items-center gap-x-3 gap-y-2`. 테두리는 실패면 `border-destructive`, 그 밖은 `border-border`. 바탕은 흰색(채움 없음). 왼쪽 아이콘 16px(§3.3 색), 글자 `type-body`, 오른쪽 [자세히](`Button variant="outline" size="sm"`, 그 run의 서랍을 연다).
- 접근성: 줄 전체가 `role="status" aria-live="polite" aria-atomic="true"`이다. 화면에서 상태를 알리는 곳은 여기 하나다. 단추는 그 밖에 둔다(낭독이 단추 이름까지 읽지 않게, 형제 요소로 배치).
- 보이는 때: 첫 쪽에 `RUNNING`이 있거나, 이 화면에서 접수한 run이 아직 진행 중이거나, 이 화면이 열린 동안 끝났을 때. 새로 고치면 진행 중인 run이 없을 때 사라진다.
- 진행 중 run이 둘 이상이면 가장 최근 것을 보이고 끝에 `외 N건`을 붙인다.

| 경우 | 글자(초안) |
|---|---|
| 접수됨 | `수집을 요청했습니다 · {소스} · 배치 {배치} · {id8} · 작업 시작을 기다리는 중` |
| 접수 뒤 60초 동안 목록에 안 나타남 | `수집 작업이 아직 시작되지 않았습니다(1분 지남). worker가 실행 중인지 확인하세요.` (polling은 계속) |
| 실행 중 | `수집 실행 중 · {소스} · 배치 {배치} · {id8} · {HH:mm} 시작` |
| 완료 | `수집이 끝났습니다 · 신규 {c} · 변경 {ch} · 취소 {ca} · 중복 {d} · 격리 {q} · 재시도 {r}` |
| 부분 완료 | `수집이 끝났지만 {q}건을 격리했습니다 · 신규 {c} · 변경 {ch} · 취소 {ca} · 중복 {d} · 재시도 {r}` |
| 실패 | `수집이 실패했습니다 · {첫 중단 원인 라벨} {코드}` (예: `공공 API 오류: API_QUOTA_EXCEEDED`) |
| 확인 지연(5분) | `수집이 5분 넘게 끝나지 않아 자동 확인을 멈췄습니다.` + [다시 확인](`outline sm`, polling을 처음 주기로 다시 시작) |
| 상태 읽기 연속 3회 실패 | `수집 상태를 확인하지 못했습니다. 다시 확인하는 중입니다.` (polling 계속) |

변경·취소가 1건 이상 끝났을 때만 둘째 줄 `type-label text-muted-foreground`로 `바뀐 공고는 자동으로 다시 분석하지 않습니다. 공고 상세에서 [재분석]을 누르세요.`를 붙인다(S5 다음 동작 안내. S5 장면 자체는 범위 밖).

### 4.4 소스별 카드 (06 §5.8 ①, D3)

구역 제목 h2 `소스별 최근 수집`(`type-heading`). 카드 2장, 순서 고정: 데모 데이터(fixture) → 나라장터(g2b). 단 폭 `@container` + `grid gap-4 @2xl:grid-cols-2`(960px·1120px 모두 2칸).

카드 = `Card size="sm"`(테두리 + `shadow-xs`, 안쪽 16px). `StatCard`는 값 하나만 받아 쓰지 않는다. 카드 안:

| 줄 | 보이는 것 | 데이터 |
|---|---|---|
| 제목 | `데모 데이터 (fixture)` / `나라장터 (g2b)` (h3, `type-heading`) | 고정 |
| 실행 가능 | 지금 모드에서 되면 `실행 모드 {runMode}에서 실행할 수 있습니다`, 아니면 `실행 모드 live에서만 실행할 수 있습니다` / `실행 모드 fixture·mock에서만 실행할 수 있습니다` (`type-caption text-muted-foreground`) | `currentRunMode()`(서버) |
| 마지막 성공 | `{formatKst} · {formatRelative}`, 없으면 `없음` | 그 소스의 최신 `SUCCEEDED`·`PARTIAL` run의 `finishedAt` |
| 마지막 실패 | `{formatKst} · {중단 원인 라벨} {코드}`, 없으면 `없음`. 값 글자 `text-destructive` + `OctagonAlertIcon` 14px | 그 소스의 최신 `FAILED` run의 `finishedAt`, 첫 `FAILURE` 오류 |
| 적재 | `신규 {created} · 변경 {changed}` | "마지막 성공" run의 `summary` |
| 격리 | `{quarantined}건` | 같은 run |

`dl` 2열(`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1`), `dt`는 `type-label text-muted-foreground`, `dd`는 `type-body tabular-nums`. 그 소스의 run이 하나도 없으면 4줄 대신 `수집 기록이 없습니다`(`type-body text-muted-foreground`).

데이터는 서버 컴포넌트가 수집 도메인을 직접 읽는다(소스마다 최신 성공 1건·최신 실패 1건, 사용자 세션·RLS). 새 공개 API는 만들지 않는다(§10). 카드는 run이 끝날 때 `router.refresh()`로만 바뀐다(polling으로 다시 계산하지 않는다).

### 4.5 실행 이력 표 (06 §5.8 ②)

구역 제목 h2 `실행 이력`. 그 아래 결과 줄 `수집 실행 {N}건 표시`(`type-label text-muted-foreground`, `role="status"` — `/bids`의 "공고 N건 표시"와 같다).

`Table` 부품, `table-fixed`, 머리 줄 40px, 셀 `px-3 py-2.5`, 행 높이 최소 44px(두 줄 셀이라 실제 약 64px), 홀짝 바탕 없음, hover `bg-muted/50`. 표 이름 `<caption className="sr-only">수집 실행 이력. 최근 실행이 위에 있습니다.</caption>`. 정렬은 `startedAt` 내림차순 고정(바꾸는 단추 없음).

| 열 | 폭(여백 포함) | 첫 줄 | 둘째 줄 | 필드 |
|---|---|---|---|---|
| 시작 | 152px | **단추**: 시작 시각 `2026-10-20 14:03`(`Button variant="link"`, `type-body tabular-nums`, 왼쪽 정렬). 누르면 서랍 | 걸린 시간 `12초` / `실행 중` / 접수 행은 `—` (`type-caption text-muted-foreground`) | `startedAt`, `finishedAt` |
| 상태 | 112px | `StatusBadge`(§3.3, 표 칸 글자) | run id 앞 8자리 `font-mono type-caption text-muted-foreground` | `status`, `id` |
| 소스·방식 | 나머지(1280: 264, 1440: 424) | `{소스 좁은 글자}` + fixture면 ` · 배치 {SEED·LIVE}` (`type-body`) | `실행 모드 {runMode} · {trigger 글자}` (`type-caption text-muted-foreground`, 한 줄 말줄임 + `title`에 전체) | `source`, `batch`, `runMode`, `trigger`, `requestedBy` |
| 신규 | 72px | 숫자 | — | `summary.created` |
| 변경 | 72px | 숫자 | — | `summary.changed` |
| 취소 | 72px | 숫자 | — | `summary.cancelled` |
| 중복 | 72px | 숫자 | — | `summary.skippedDuplicate` |
| 격리 | 72px | 숫자 | — | `summary.quarantined` |
| 재시도 | 72px | 숫자 | — | `summary.retried` |

- 숫자 6열(합 432px)은 오른쪽 정렬·`tabular-nums`다. `RUNNING` 행은 worker가 쪽마다 저장한 중간 값을 그대로 보인다(polling 때 바뀐다). 접수 행은 6열 모두 `—`.
- 06 §5.8의 "종료" 시각은 표에서 걸린 시간으로 대신하고 서랍에서 절대 시각을 보인다. 공공 API 호출 수(`quotaUsed`)·체크포인트(`cursor`)도 서랍에만 둔다(fixture는 늘 0이라 표 칸을 차지할 가치가 없다).
- 시작 단추의 접근성 이름: `aria-label="{시작 시각} 시작 수집 실행 {id8} 자세히 보기"`(보이는 글자를 앞에 둔다, WCAG 2.5.3) + `aria-haspopup="dialog"`. 행 전체 클릭은 두지 않는다(C6 `/bids` 제목 링크와 같다). 06 §10 "표 행 Enter로 열기"는 이 단추의 Enter로 채운다.
- 커서 쪽 넘김: 첫 쪽 20건은 서버가 그리고, 다음 쪽은 `useLoadMore`(`endpoint="/api/v1/admin/ingestion/runs"`) + `LoadMoreFooter`로 붙인다. [더 보기] → `불러오는 중…` → 실패 `더 불러오지 못했습니다 · [다시 시도]`, `400 INVALID_CURSOR`면 `목록이 바뀌었습니다 · [처음부터 보기]`(`router.push("/admin/ingestion")`). 붙인 뒤 초점은 새로 붙은 첫 행의 시작 단추로 옮긴다(`bid-list-more.tsx`와 같다). 같은 id가 두 쪽에 오면 처음 것만 남긴다(`mergeUnique`).
- polling이 첫 쪽을 다시 읽으면(§4.8) 첫 쪽에 있는 id의 행만 새 값으로 바꾸고, 새 id는 맨 위에 더한다. "더 보기"로 붙인 행은 버리지 않는다. 접수 행은 같은 id가 목록에 나타나면 그 행으로 바뀐다.

### 4.6 수동 수집 대화상자

[수동 수집 실행]이 연다. 데이터를 바꾸는 동작이라(LIVE 배치는 공고를 바꾸고 알림을 만든다) 고르기와 확인을 한 단계로 묶는다. 대화상자는 기존 `Dialog`(높이 `100dvh` 안 + 안쪽 스크롤, 초점 가두기·`Esc`), 폭 480px(`sm:max-w-[480px]`, 서랍과 같은 폭).

```text
┌ 수동 수집 실행 ───────────────────────────────── [×] ┐
│ 공고를 지금 수집합니다. 수집은 분석을 자동으로 시작하지 않습니다. │
│                                                       │
│ 소스                                                   │
│ (●) 데모 데이터 (fixture)                              │
│     저장소의 가상 공고 20건(FX-01~FX-20)을 읽습니다.     │
│ ( ) 나라장터 (g2b)                       ← 비활성(흐림) │
│     실행 모드 mock에서는 쓸 수 없습니다. live 모드에서만 됩니다. │
│                                                       │
│ 배치                                                   │
│ ( ) SEED · 처음 적재                                   │
│     공고 20건의 첫 revision을 적재합니다. 이미 적재했으면  │
│     모두 중복으로 건너뜁니다.                            │
│ ( ) LIVE · 변경분 투입                                  │
│     정정·취소·기한 변경·재전송 5건을 적재합니다. 공고가     │
│     바뀌고 알림이 생깁니다. 되돌리려면 pnpm demo:reset 을  │
│     다시 실행해야 합니다.                                │
│ 배치 LIVE는 실행 모드 live와 다릅니다.                   │
│                                                       │
│ (오류 자리, role="alert")                              │
│                                     [취소] [수집 실행]  │
└───────────────────────────────────────────────────────┘
```

| 요소 | 규칙 |
|---|---|
| 제목·설명 | `DialogTitle` `수동 수집 실행`, `DialogDescription` `공고를 지금 수집합니다. 수집은 분석을 자동으로 시작하지 않습니다.` |
| 소스 | `RadioGroup`(C6 §10.4에서 승인된 부품) + `fieldset`/`legend` `소스`. 지금 실행 모드와 안 맞는 소스는 **숨기지 않고 비활성**(`disabled`)으로 두고 설명 줄을 이유 문장으로 바꾼다(`aria-describedby`로 연결). `mock`·`fixture` 모드: g2b 비활성(`실행 모드 {mode}에서는 쓸 수 없습니다. live 모드에서만 됩니다.`). `live` 모드: fixture 비활성(`실행 모드 live에서는 쓸 수 없습니다. fixture·mock 모드에서만 됩니다.`). 쓸 수 있는 소스가 하나뿐이므로 그것을 미리 고른다 |
| 배치 | 소스가 fixture일 때만 보인다. `RadioGroup` + `legend` `배치`. 기본 선택 없음(D7). 고르기 전에는 [수집 실행] 비활성. 아래 `type-caption text-muted-foreground` `배치 LIVE는 실행 모드 live와 다릅니다.` |
| g2b 고름(live 모드) | 입력 칸 없이 안내 두 줄만(D8): `수집 구간: 직전 성공 지점부터 지금까지` · `단계: 입찰공고·사전규격·발주계획 전부`. 본문은 `{source:"g2b"}`만 보낸다 |
| 단추 | [취소](`outline`) [수집 실행](`default`). 보내는 동안 [수집 실행]은 `요청 중…` + 비활성(`focusableWhenDisabled`), 소스·배치도 잠근다 |
| 요청 | `POST /api/v1/admin/ingestion/runs`, 머리글 `X-Requested-With: sol-radar`·`Content-Type: application/json`·`Idempotency-Key`. 본문 `{source:"fixture", batch:"seed"|"live"}` 또는 `{source:"g2b"}`. 폼 검증은 05 `IngestionRunInput` 규칙(428행)과 같다 |
| 멱등 키 | 대화상자를 열 때 UUID 하나를 만든다. 네트워크 오류·5xx 뒤 같은 본문으로 다시 보내면 **같은 키**. 소스·배치를 바꾸면 **새 키**(같은 키 + 다른 본문 = `409 IDEMPOTENCY_KEY_REUSED`를 피한다). `202`를 받으면 키를 버린다 |
| 성공(`202`) | 대화상자를 닫고 초점은 [수동 수집 실행]으로(비활성이어도 초점 유지). 응답 본문으로 이력 표 맨 위에 접수 행을 더하고 상태 줄 "접수됨", polling 시작(§4.8) |
| 실패 | 대화상자를 연 채로 단추 위 오류 자리에 `role="alert"` 글자. 문구는 §4.11 |

### 4.7 실행 상세 서랍 (06 §5.8 ③④, D1·D2)

**같은 화면의 오른쪽 서랍**으로 한다(D1 추천). 이유:

1. S5·S7 조작이 한 화면에서 끝난다. 행을 열어 확인하고 닫으면 같은 자리로 돌아오고, 뒤의 이력 표는 polling으로 계속 바뀐다.
2. C6 근거 서랍(`EvidenceDrawer`: `Sheet side="right"`, 480px, 초점 가두기·`Esc`·연 단추로 초점 복귀)과 같은 부품·같은 폭을 쓴다. 새 부품이 없다.
3. 내용이 요약 숫자와 짧은 목록이라 480px에 맞는다. 별도 경로면 `[id]/page.tsx`·`loading`·`error`·`not-found`가 더 생기고, "아직 시작 전(404)" 상태는 어차피 클라이언트에서 다시 읽어야 한다.
4. 대신 주소 `?run=<id>`를 붙여(D2) 새로 고침·뒤로 가기·링크 공유가 된다. `window.history.pushState`로 바꿔 서버를 다시 부르지 않는다(Next 16 `04-linking-and-navigating.md` "native History API"). 닫으면 `?run`을 지운다(`pushState`라 뒤로 가기로도 닫힌다). `run` 값이 UUID 모양이 아니면 요청 없이 "찾을 수 없음" 상태다.

서랍 = `Sheet side="right"`, 폭 480px(`EvidenceDrawer`와 같은 덮어쓰기 클래스), 높이 화면 안 + 안쪽 스크롤. 열면 `GET /api/v1/admin/ingestion/runs/:id`를 읽는다. 열림 상태는 서랍 하나만 쓰므로 store가 아니라 화면 부품 상태 + 주소다.

```text
┌ 수집 실행 a1b2c3d4 ─────────────────────────── [×] ┐   480px
│ 데모 데이터 (fixture) · 배치 SEED · 실행 모드 mock   │  ← SheetDescription
│ [⚠ 부분 완료 (격리 1건)]                             │
│ 시작  2026-10-20 13:51:05                            │
│ 종료  2026-10-20 13:51:17 (12초)                     │
│ 방식  데모 초기화 (pnpm demo:reset)                  │
│ 공공 API 호출  0회                                   │
│ ┌ 신규 ─┬ 변경 ─┬ 취소 ─┐                           │
│ │ 19    │ 0     │ 0     │                           │
│ ├ 중복 ─┼ 격리 ─┼ 재시도┤                           │
│ │ 0     │ 1     │ 2     │                           │
│ └───────┴───────┴───────┘                           │
│ 격리 1건                                             │  h3
│ 필수 정보가 없거나 형식이 틀려 적재하지 않았습니다.     │
│ 공고 목록에 나오지 않습니다.                          │
│ ─────────────────────────────────────────            │
│ fixture:DEMO-2026-0012                               │  mono
│ ⚠ 필수 필드 누락  MISSING_REQUIRED_FIELD              │
│ 필드  title                                          │
│ missing: title                                       │  mono caption
│                                                      │
│ 재시도 2회                                           │  h3
│ 429 응답은 서버가 정한 대기 시간(Retry-After)을 지킨   │
│ 뒤 다시 요청합니다.                                   │
│ ─────────────────────────────────────────            │
│ fixture:FX-20 · 429 · 2초 대기 · 1번째 재시도          │  ← D4 채택 시
│ fixture:FX-20 · 429 · 2초 대기 · 2번째 재시도          │
│                                                      │
│ 실행 id  a1b2c3d4-…-…(전체)                          │  mono caption
│ 체크포인트  —                                         │
└──────────────────────────────────────────────────────┘
```

| 영역 | 보이는 것 | 데이터 |
|---|---|---|
| 제목 | `SheetTitle` `수집 실행 {id8}` | `id` |
| 부제 | `SheetDescription` `{소스} · 배치 {배치}`(fixture만) `· 실행 모드 {runMode}` | `source`, `batch`, `runMode` |
| 상태 | `StatusBadge`(서랍 글자) | `status`, `summary.quarantined` |
| 개요 `dl` | 시작(초까지) · 종료(초까지 + 걸린 시간, 진행 중이면 `실행 중`) · 방식(§3.4 trigger) · 공공 API 호출(`{quotaUsed}회`, fixture면 `0회 (fixture는 공공 API를 부르지 않습니다)`) | `startedAt`, `finishedAt`, `trigger`, `requestedBy`, `quotaUsed` |
| 결과 수 | `dl` 3열×2줄(`grid grid-cols-3`), 칸마다 `dt` `type-label text-muted-foreground` + `dd` `type-heading tabular-nums`. "변경" 아래 caption `새 revision`, "중복" 아래 caption `같은 내용 재수신, 저장 안 함` | `summary` 6개 |
| 오류 무리 | 아래 4무리. 건수가 0인 무리는 "격리"만 `격리한 레코드가 없습니다`로 남기고 나머지는 숨긴다. 무리마다 h3 + 설명 한 줄 + `ul divide-y divide-border` | `errors[]`(D5 `kind`로 나눈다) |
| 바닥 | `실행 id {전체 UUID}`·`체크포인트 {cursor ?? "—"}` (`font-mono type-caption text-muted-foreground wrap-anywhere`) | `id`, `cursor` |
| 다음 동작 안내 | 변경·취소가 1건 이상이면 `바뀐 공고는 자동으로 다시 분석하지 않습니다. 공고 상세에서 [재분석]을 누르세요.` (링크 없음, S5 범위 밖) | `summary.changed`, `summary.cancelled` |

**오류 무리** (순서 고정, 무리 판정은 D5):

| 무리 | 제목 | 설명 줄(초안) | 아이콘·색 | 행 모양 |
|---|---|---|---|---|
| 수집 중단 원인(`FAILURE`) | `수집 중단 원인` | `이 오류로 수집을 멈췄습니다. 이미 적재한 공고는 그대로 둡니다.` | `OctagonAlertIcon` `text-destructive` | 1줄 `{라벨} {code}` + `resultCode`가 있으면 ` · 결과 코드 {resultCode}`. 2줄 `sourceKey` mono. 3줄 `detail` mono caption |
| 격리(`QUARANTINE`) | `격리 {N}건` | `필수 정보가 없거나 형식이 틀려 적재하지 않았습니다. 공고 목록에 나오지 않습니다.` | `TriangleAlertIcon` `text-warning` | 1줄 `sourceKey` mono(공고 식별, D6). 2줄 `{라벨} {code}`. 3줄 `필드 {fields 쉼표 연결}`(D5, 없으면 줄 생략). 4줄 `detail` mono caption |
| 재시도(`RETRY`) | `재시도 {summary.retried}회` | `429 응답은 서버가 정한 대기 시간(Retry-After)을 지킨 뒤 다시 요청합니다.` | `RefreshCwIcon` `text-muted-foreground` | 한 줄 `{sourceKey} · {detail}`. D4에서 재시도 줄을 저장하지 않기로 하면 행 없이 설명 줄과 횟수만 |
| 경고(`WARNING`) | `경고 {N}건 · 적재함` | `일부 값을 읽지 못했지만 공고는 적재했습니다. 해당 값은 비어 있습니다.` | `CircleAlertIcon` `text-muted-foreground` | 격리와 같은 모양 |

오류 코드 라벨(초안, 코드 글자는 항상 함께 `font-mono`로 보인다):

| 코드 | 라벨 |
|---|---|
| `MISSING_REQUIRED_FIELD` | 필수 필드 누락 |
| `SCHEMA_INVALID` | 형식 오류 |
| `BUDGET_UNPARSED` / `DATE_UNPARSED` / `DATE_ORDER` / `ENCODING_DEGRADED` | 예산을 읽지 못함 / 날짜를 읽지 못함 / 날짜 순서 이상 / 글자 깨짐 |
| `API_HTTP_ERROR` / `API_RESULT_CODE` / `API_QUOTA_EXCEEDED` / `API_TIMEOUT` | `공공 API 오류:` 뒤에 코드 (19 §5 196행 문구) |
| `API_SERVICE_KEY_INVALID` | 공공 API 서비스키 거부 (키 값은 보이지 않습니다) |
| `RATE_LIMITED` | 요청 제한(429)이 계속되어 중단 |
| `SEED_ANCHOR_MISSING` | SEED 수집 기록이 없어 LIVE 배치를 시작할 수 없음 |
| `RETRY_WAIT` (D4 새 코드) | 재시도 대기 |
| 그 밖(`INGEST_*`, 모르는 코드) | 수집 오류 |

- 행이 50개를 넘는 무리는 처음 50개만 그리고 아래에 `{남은 수}건 더 보기`(`Button variant="link" size="sm"`, 50개씩 더 그린다, 응답은 이미 다 받았다). g2b live run의 경고 대량 대비다.
- `detail`·`sourceKey`는 일반 글자로만 그린다(HTML로 해석하지 않는다). 서비스키는 서버가 이미 가렸다([[09-SECURITY|09 보안]] 86행). 화면은 더 가리지 않는다.
- 서랍이 열린 run이 `RUNNING`이면 목록 polling의 같은 주기에 `GET :id`도 다시 읽는다(타이머를 따로 두지 않는다). 끝나면 멈춘다.

### 4.8 polling — 다시 읽기 주기와 멈춤 조건 (D14)

| 항목 | 규칙 |
|---|---|
| 읽는 것 | `GET /api/v1/admin/ingestion/runs`(커서 없음 = 첫 쪽, 서버가 그린 첫 쪽과 같은 크기). 서랍이 `RUNNING`·접수 run을 보고 있으면 같은 주기에 `GET …/runs/:id`도 |
| 시작 | ① `POST 202` 직후 ② 화면을 열 때(또는 `router.refresh()` 뒤) 첫 쪽에 `RUNNING`이 있을 때 ③ [다시 확인]을 누를 때 |
| 주기 | 분석 polling과 같은 상수(`use-analysis-run.ts`): 처음 60초는 2초, 그 뒤 5초. 시작 시점부터 300초가 상한 |
| 멈춤 — 정상 | 첫 쪽에 `RUNNING`이 없고 접수 행도 없을 때. 이때 한 번 `router.refresh()`(소스별 카드·첫 쪽을 서버가 다시 그림)와 `refreshTopbarStatus()`(상단바 "수집 N분 전" 갱신)를 부른다 |
| 멈춤 — 지연 | 300초가 지나면 멈추고 상태 줄 "확인 지연"(§4.3). [다시 확인]이 처음 주기로 다시 시작한다 |
| 멈춤 — 권한 | `401`·`403` 응답이면 멈추고 상태 줄 대신 오류 글자(`401`: `로그인이 만료되었습니다. 다시 로그인하세요.` + [로그인](링크 `/auth/login`), `403`: `이 화면을 볼 권한이 없어졌습니다.` + [새로 고침]) |
| 계속 — 일시 오류 | `429`·`5xx`·네트워크 오류는 다음 주기에 다시 읽는다. 연속 3회면 상태 줄에 "확인하지 못했습니다" 문구(§4.3), 성공하면 지운다 |
| worker 미시작 | 접수 행이 60초 지나도 목록에 없으면 상태 줄 안내(§4.3). polling은 상한까지 계속 |
| 떠날 때 | 화면을 떠나면 타이머와 요청을 모두 멈춘다(`AbortController`). 탭이 숨겨져도 멈추지 않는다(분석 polling과 같다) |
| 같은 때 한 번 | 이전 요청이 끝나기 전에는 다음 요청을 보내지 않는다 |
| 서버 요구 | 05 §1의 "`/admin/ingestion/runs` 조직당 5회/분"은 **`POST`만** 센다. `GET`을 세면 2초 polling이 바로 `429`가 된다(§10, §11 4번) |

끝난 순간의 알림은 상태 줄 하나(`aria-live="polite"`)가 맡는다. 같은 내용을 토스트로 다시 띄우지 않는다(D13).

### 4.9 권한 없음 화면 (403, D10)

`PeopleForbidden`의 구조(`AppPage` 제목 + `role="alert"` 문단)를 따르고 문구는 06 §5.1 403 문구를 쓴다. 데이터를 읽지 않는다.

```text
데이터 수집 관리
┌──────────────────────────────────────────────┐
│ 이 화면을 볼 권한이 없습니다                    │  ← role="alert", type-heading
│ 데이터 수집 관리는 업무 역할이 ADMIN인 구성원만   │
│ 볼 수 있습니다. 지금 역할: VIEWER               │  ← type-body text-muted-foreground
│ [대시보드로]                                    │  ← outline 링크 /dashboard
└──────────────────────────────────────────────┘
```

- 틀(사이드바·상단바)은 그대로 보인다. 상단바 화면 이름도 `데이터 수집 관리`(D11).
- 역할은 `requireWork`의 `role`(`SALES`·`ANALYST`·`VIEWER`) 원문을 쓴다.
- 운영자(`profiles.is_admin`)도 업무 역할이 ADMIN이 아니면 이 화면이다. 템플릿 `/admin`으로 보내지 않는다.
- HTTP 응답은 `PeopleForbidden`처럼 200 + 안내다. API는 `403 FORBIDDEN`이다(D10).
- 증거 스크린샷 이름: `…-admin-ingestion-forbidden-{1440,1280}.png`(06 §12, VIEWER).

### 4.10 상태표 — 화면

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 로딩(첫 진입) | 서버가 읽는 중(`loading.tsx`) | 제목·설명 글자 + 단추 자리 skeleton(120×36) + 카드 2장 skeleton(각 4줄) + 결과 줄 + 표 머리 1줄·행 8줄 skeleton(행 64px). `role="status"` + sr-only `수집 이력을 불러오는 중…`. skeleton은 `motion-reduce:animate-none` | 기다림. 사이드바·상단바 사용 |
| 빈 목록 | run 0건 | 카드 2장 모두 `수집 기록이 없습니다`. 표 자리 `EmptyState`(`DatabaseIcon`, 제목 `아직 수집을 실행하지 않았습니다`, 설명 `수집을 실행하면 실행마다 한 줄씩 여기에 남습니다.`, 동작 [수동 수집 실행] `outline` — 머리 단추와 같은 대화상자. 머리 단추가 `default`라 주요 단추는 하나다) | 수동 수집 실행 |
| 정상 | 1건 이상, 진행 중 없음 | 카드 2장 + 결과 줄 + 표. 상태 줄 없음 | 서랍 열기, 더 보기, 수동 수집 실행 |
| 접수됨 | `202` 뒤 목록에 아직 없음 | 표 맨 위 접수 행(`접수됨`, 숫자 `—`), 상태 줄 "접수됨", 머리 단추 비활성 + 도움말 | 접수 행 서랍 열기(§4.12 "아직 시작 전") |
| worker 미시작 | 접수 뒤 60초, 목록에 없음 | 상태 줄 "아직 시작되지 않았습니다(1분 지남)…" | 기다림, worker 확인 |
| 실행 중 | 첫 쪽에 `RUNNING` | 그 행 `실행 중` + 중간 숫자, 상태 줄 "실행 중", 머리 단추 비활성(D9). 시작 30분이 넘었으면 상태 줄 끝에 `30분 넘게 끝나지 않았습니다. worker 기록을 확인하세요.` | [자세히], 서랍에서 중간 결과 보기 |
| 완료 | 지켜보던 run이 `SUCCEEDED` | 행 `완료` + 최종 숫자, 상태 줄 "수집이 끝났습니다 · …", 카드·상단바 수집 지표 갱신 | [자세히], 다시 실행 |
| 격리 있음 | `PARTIAL`(격리 ≥1) | 행 `부분 완료`, 격리 칸 숫자, 상태 줄 "끝났지만 N건을 격리했습니다", 서랍 "격리 N건" 무리. S7 #17: SEED run = 격리 1(`fixture:DEMO-2026-0012`, `MISSING_REQUIRED_FIELD`, 필드 `title`) + 재시도 2 | [자세히]로 격리 행 확인 |
| 실패 | `FAILED` | 행 `실패`, 상태 줄(테두리 `destructive`) "수집이 실패했습니다 · 공공 API 오류: …", 카드 "마지막 실패" 갱신, 서랍 "수집 중단 원인" | [자세히], 원인 해결 뒤 다시 실행 |
| 확인 지연 | polling 300초 초과 | 상태 줄 "5분 넘게 끝나지 않아 자동 확인을 멈췄습니다" + [다시 확인] | 다시 확인, 새로 고침 |
| 상태 읽기 오류 | polling 연속 3회 실패(429·5xx·네트워크) | 상태 줄 "확인하지 못했습니다. 다시 확인하는 중입니다" | 기다림 |
| 세션 만료·권한 바뀜 | polling `401`·`403` | §4.8 문구, polling 멈춤 | 로그인, 새로 고침 |
| 더 보기 | `hasNext=true` | 표 아래 [더 보기](`outline`) | 더 보기 |
| 더 보기 실패 | 다음 쪽 요청 실패 | `더 불러오지 못했습니다` + [다시 시도] | 다시 시도 |
| 커서 무효 | `400 INVALID_CURSOR` | `목록이 바뀌었습니다` + [처음부터 보기] | 처음부터 보기 |
| 화면 오류 | 서버 읽기 실패(`error.tsx`) | `WorkError`: "불러오지 못했습니다" + 서버 문구 + 오류 ID + [다시 시도] | 다시 시도 |
| 권한 없음 | `sol_role ≠ ADMIN` | §4.9 403 안내 | 대시보드로 |
| 미인증·계정 상태 | 로그인 전, 가입 미완료, 업무 조직 0·2+ | `requireWork`가 기존 안내 화면으로 보낸다 | 그 화면의 동작 |
| 긴 글자 | 요청자 이름·오류 상세가 김 | 표: 둘째 줄 말줄임 + `title`. 서랍: 줄바꿈(`wrap-anywhere`) | — |
| 대량 데이터 | run 수백 건(live 일정 수집) | 20건씩 커서 쪽, 첫 쪽만 polling | 더 보기 |

### 4.11 상태표 — 수동 수집 대화상자

오류 글자는 단추 위 `role="alert"` 문단(`type-body`)이고, 둘째 줄에 `요청 ID {requestId}`(`font-mono type-caption text-muted-foreground`, 응답 본문 또는 `X-Request-Id`)를 둔다. 서버 `message`는 보이지 않고 아래 문구를 쓴다(서버 문구는 영어·내부 표현일 수 있다). 오류 뒤 초점은 오류 문단이 아니라 그대로 둔다(`role="alert"`가 읽는다).

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 열림 | 단추 누름 | 소스(맞는 것 미리 고름, 안 맞는 것 비활성 + 이유), 배치(고르지 않음), [수집 실행] 비활성 | 배치 고르기, 취소 |
| 보낼 수 있음 | 소스·배치 정해짐 | [수집 실행] 활성 | 수집 실행 |
| 요청 중 | `POST` 보냄 | [수집 실행] `요청 중…` 비활성, 라디오 잠김 | 기다림(`Esc`·[취소]로 닫아도 요청은 취소하지 않는다. 닫힌 뒤 `202`가 오면 접수 행을 더한다) |
| 성공 `202` | 접수됨 | 대화상자 닫힘, §4.10 "접수됨" | — |
| `400 VALIDATION_ERROR` | 본문 검증 실패 | `입력값이 올바르지 않습니다.` + `details.issues`의 `path`를 소스·배치 칸 아래 `FieldError`로(칸 이름: `source`→소스, `batch`→배치). 모르는 path는 문단에 이어 쓴다 | 고쳐서 다시 실행(새 키) |
| `409 RUN_MODE_MISMATCH` | 소스가 서버의 실행 모드와 다름(`details {runMode, source}`) | `지금 실행 모드({runMode})에서는 {source 글자} 수집을 할 수 없습니다. 실행 모드가 바뀌었을 수 있으니 화면을 새로 고치세요.` + [새로 고침](`outline sm`, `router.refresh()` → 소스 비활성 표시가 서버 모드로 다시 정해진다) | 새로 고침 |
| `409 IDEMPOTENCY_KEY_REUSED` | 같은 키로 다른 본문이 이미 접수됨 | `같은 요청 번호로 다른 내용이 이미 접수되었습니다. 다시 실행하면 새 번호로 요청합니다.` 화면은 새 키를 만든다 | 수집 실행(새 키) |
| `409 INGESTION_IN_PROGRESS` | 같은 소스가 이미 `RUNNING`(`details {runId}`) | `같은 소스의 수집이 이미 실행 중입니다.` + [실행 중인 수집 보기](`outline sm`: 대화상자를 닫고 그 run 서랍을 열고 polling 시작) | 실행 중인 수집 보기 |
| `429 RATE_LIMITED` | 조직당 1분 5회 초과 | `수집 요청이 너무 잦습니다(조직당 1분에 5회). {n}초 뒤 다시 시도하세요.` n = `Retry-After`(없으면 60). 그동안 [수집 실행] 비활성, 시간이 지나면 문구를 지우고 활성(초 단위로 다시 읽어 주지 않는다) | 기다린 뒤 다시(같은 키) |
| `401 UNAUTHENTICATED` | 세션 만료 | `로그인이 만료되었습니다. 다시 로그인하세요.` + [로그인] 링크 | 로그인 |
| `403 FORBIDDEN` | 역할이 바뀜 | `이 작업을 할 권한이 없습니다. 업무 역할이 ADMIN이어야 합니다.` | 닫기 |
| `403 CSRF_REJECTED` | CSRF 머리글 누락 | `요청을 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 시도하세요.` | 새로 고침 |
| `500 INTERNAL_ERROR` | 서버 예외 | `요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.` | 다시 시도(같은 키) |
| `503 SERVICE_UNAVAILABLE` | 의존성 연결 불가(`details.component`) | `queue`: `수집 작업을 대기열에 넣지 못했습니다. Redis·worker 상태를 확인하세요.` · `redis`: `요청 수를 확인하지 못했습니다. Redis 상태를 확인하세요.` · `db`: `데이터베이스에 연결하지 못했습니다.` · 그 밖: `잠시 뒤 다시 시도하세요.` | 다시 시도(같은 키) |
| 네트워크 오류 | 응답 없음 | `서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.`(`NETWORK_MESSAGE`) | 다시 시도(같은 키) |

### 4.12 상태표 — 실행 상세 서랍

| 상태 | 언제 | 보이는 것 | 사용자가 할 수 있는 것 |
|---|---|---|---|
| 읽는 중 | `GET :id` 대기 | 제목 `수집 실행 {id8}` + 본문 skeleton(배지·개요 4줄·숫자 6칸·목록 3줄), `role="status"` sr-only `수집 실행을 불러오는 중…` | 닫기 |
| 완료 | `SUCCEEDED` | 개요·숫자. 격리 무리 `격리한 레코드가 없습니다` | 닫기 |
| 실행 중 | `RUNNING` | 배지 `실행 중`, 종료 `실행 중`, 숫자는 중간 값(polling 주기마다 갱신) | 닫기 |
| 격리 있음 | `PARTIAL` | 격리 무리 N건(공고 식별·사유 코드·필드·상세) | 닫기 |
| 재시도 있음 | `summary.retried > 0` | 재시도 무리 `재시도 N회` + 행(D4) | 닫기 |
| 경고 있음 | 경고 오류 ≥1 | 경고 무리 | 닫기 |
| 실패 | `FAILED` | 맨 위 "수집 중단 원인" 무리(빨간 아이콘·글자) | 닫기 |
| 아직 시작 전 | `404`이고 그 id가 이 화면에서 접수한 run | `수집 작업이 아직 시작되지 않았습니다. 시작되면 여기에 표시됩니다.` + 202 본문의 소스·배치·실행 모드·요청 시각. polling 주기마다 `GET :id`를 다시 읽는다 | 닫기 |
| 찾을 수 없음 | `404`이고 접수 run이 아님, 또는 `?run=`이 UUID가 아님 | `수집 실행을 찾을 수 없습니다. 주소가 맞는지 확인하세요.` | 닫기 |
| 오류 | 그 밖 실패 | `불러오지 못했습니다` + `요청 ID` + [다시 시도] | 다시 시도, 닫기 |
| 권한 | `401`·`403` | §4.8 문구 | 로그인, 새로 고침 |
| 목록 많음 | 무리 행 > 50 | 50개 + `{남은 수}건 더 보기` | 더 보기 |

## 5. 화면 요소 ↔ 05 DTO

| 화면 요소 | `IngestionRun` 필드 | 비고 |
|---|---|---|
| 시작 단추·서랍 시작 | `startedAt` | 접수 행은 202 본문의 `startedAt`(=요청 시각) |
| 걸린 시간·서랍 종료 | `finishedAt` | `null`이면 진행 중 |
| 상태 배지 | `status` | 접수 행은 화면 상태 "접수됨"(D15) |
| run id | `id` | 202 본문의 `id`가 나중 행의 `id`와 같아야 한다(§10) |
| 소스·배치 | `source`, `batch` | `batch`는 fixture만 |
| 실행 모드 | `runMode` | Topbar 실행 모드와 다를 수 있다(지난 run) |
| 방식 | `trigger`, `requestedBy.name` | |
| 숫자 6칸 | `summary.created·changed·cancelled·skippedDuplicate·quarantined·retried` | |
| 공공 API 호출 | `quotaUsed` | 서랍만 |
| 체크포인트 | `cursor` | 서랍만 |
| 오류 무리·행 | `errors[].sourceKey·errorCode·resultCode·detail` + D5 `kind`·`fields` | |
| 소스별 카드 | (서버 도메인 읽기) 소스마다 최신 성공·실패 run | 새 공개 API 없음(D3) |
| 소스 비활성 | `currentRunMode()`(서버, `web/app/_lib/run-mode.ts`) | 대화상자 prop |

## 6. 화면 문구 (초안 — 확정은 사용자)

| 자리 | 문구 |
|---|---|
| 사이드바·상단바 이름 | `데이터 수집 관리` (06 §4.1) |
| h1 / 설명 | `데이터 수집 관리` / `공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.` |
| 주요 단추 / 비활성 도움말 | `수동 수집 실행` (06 §5.8·19 S5) / `실행 중인 수집이 끝나면 다시 실행할 수 있습니다` |
| 구역 제목 | `소스별 최근 수집`, `실행 이력` |
| 결과 줄 | `수집 실행 {N}건 표시` |
| 빈 상태 | `아직 수집을 실행하지 않았습니다` (06 §5.8) / `수집을 실행하면 실행마다 한 줄씩 여기에 남습니다.` |
| 카드 | `실행 모드 {mode}에서 실행할 수 있습니다` · `실행 모드 live에서만 실행할 수 있습니다` · `실행 모드 fixture·mock에서만 실행할 수 있습니다` · `마지막 성공` · `마지막 실패` · `적재` · `격리` · `없음` · `수집 기록이 없습니다` |
| 표 머리 | `시작` `상태` `소스·방식` `신규` `변경` `취소` `중복` `격리` `재시도` |
| 대화상자 | §4.6 그림의 글자 |
| 상태 줄 | §4.3 표 |
| 오류 | §4.8·§4.11·§4.12 표 |
| 서랍 | §4.7 표 |
| 403 | `이 화면을 볼 권한이 없습니다` / `데이터 수집 관리는 업무 역할이 ADMIN인 구성원만 볼 수 있습니다. 지금 역할: {role}` / `대시보드로` (06 §5.1) |

## 7. 접근성 체크 항목

- 제목 계층: h1(화면) → h2 `소스별 최근 수집`·`실행 이력` → h3 카드 제목. 서랍은 `SheetTitle`(대화상자 이름) → h3 오류 무리. 403 화면은 h1 하나 + 안내.
- 랜드마크: `main#main-content`는 `AppPage`가 그린다. 서랍·대화상자는 Base UI가 `role="dialog"`·`aria-modal`·이름(제목)·설명을 단다.
- 키보드 순서: 머리 [수동 수집 실행] → 상태 줄 [자세히]·[다시 확인] → 표 행마다 시작 단추 → [더 보기]. 카드는 초점을 받지 않는다(동작 없음).
- 표: `caption`(sr-only), `th scope="col"`, 숫자 오른쪽 정렬. 행마다 초점 받는 요소는 시작 단추 하나(탭 정지 최소). 단추 이름은 보이는 글자로 시작한다(WCAG 2.5.3).
- 서랍: 열면 초점은 서랍 안 첫 요소(닫기 단추, Base UI 기본), `Esc`로 닫고 연 단추로 초점 복귀. polling으로 행이 다시 그려져도 단추 `key`는 run `id`라 복귀 대상이 사라지지 않는다. 연 행이 다음 쪽으로 밀려 첫 쪽에서 빠지는 경우는 "더 보기"로 붙인 행을 버리지 않으므로 생기지 않는다.
- 대화상자: 라디오는 `fieldset`+`legend`, 비활성 라디오는 이유 문장을 `aria-describedby`로 읽힌다. 오류는 `role="alert"`, 칸 오류는 `FieldError`(`aria-invalid` + `aria-describedby`).
- 상태 변화: 상태 줄 하나만 `role="status" aria-live="polite" aria-atomic="true"`. 결과 줄(`수집 실행 N건 표시`)도 `role="status"`이지만 건수만 말한다. 같은 사건을 두 곳에서 읽지 않는다.
- 비활성 단추: [수동 수집 실행]·[수집 실행]은 `focusableWhenDisabled` + 이유 글자 `aria-describedby`. 초점이 사라지지 않는다.
- 색만으로 뜻을 전하지 않는다: 상태는 아이콘 + 글자, 실패 카드 값은 글자 "공공 API 오류: …"가 뜻을 말한다. 숫자 0의 회색은 강조 줄이기일 뿐 뜻이 아니다.
- 아이콘: 모두 16px(배지 안 14px), `aria-hidden`. 아이콘만 있는 단추 없음(서랍 닫기 단추는 `Sheet` 기본 sr-only 이름이 영어 `Close`라 `닫기`로 바꾼다 — C6 근거 서랍도 같은 문제, §11 6번).
- 대비: `success`·`warning`·`destructive`·`muted-foreground`를 흰 바탕 위 글자로만 쓴다(토큰 대비는 axe로 확인). 포커스 링은 부품 기본(`ring`).
- 움직임: 회전 아이콘·skeleton은 `motion-reduce:animate-none`, 서랍·대화상자 전환은 부품 기본.
- 시각: `<time dateTime>` + `title`(UTC). 스크린리더는 보이는 KST 글자를 읽는다.
- 검사: Playwright axe 위반 0건(06 §10). 1440·1280 두 폭에서 `loaded`·`empty`·`forbidden` 상태와 서랍·대화상자 열린 상태.

## 8. 토큰·부품 매핑

### 8.1 색 (`design/tokens.json`만, 새 색 없음)

| 쓰임 | 토큰 클래스 |
|---|---|
| 바탕·카드 | `bg-background`, `Card`(`bg-card` + `border` + `shadow-xs`) |
| 구역 선·표 줄 | `border-border`, `divide-border` |
| 보조 글자·0·캡션·진행 중 | `text-muted-foreground` |
| 완료 | `text-success` |
| 부분 완료·격리 | `text-warning` |
| 실패·중단 원인·실패 상태 줄 테두리 | `text-destructive`, `border-destructive` |
| 표 hover | `bg-muted/50` |
| 주요 단추 | `Button` 기본(`primary`) |

`brand`·`demo`·`chart-2`는 쓰지 않는다. 이 화면에는 `DEMO` 배지가 없다(run은 공고가 아니다. 상단바 `DEMO` 배지는 그대로).

### 8.2 글자 (앱 틀 기본 눈금만)

`type-title`(h1), `type-heading`(h2·h3·카드 제목·서랍 숫자), `type-body`(본문·표·오류 문단), `type-label`(표 머리·`dt`·결과 줄), `type-caption`(둘째 줄·run id·배지·상세). 식별자·코드·`sourceKey`·`detail`은 `font-mono`. 숫자는 `tabular-nums`.

### 8.3 간격 (Tailwind 눈금)

`AppPage` 안 구역 사이 `gap-6`(24), 구역 제목과 내용 `gap-3`(12), 카드 사이 `gap-4`(16), 카드 안쪽 16(`size="sm"`), 표 셀 `px-3 py-2.5`, 서랍 안쪽 `px-4 pb-4`·무리 사이 `gap-6`, 상태 줄 `px-4 py-3`.

### 8.4 부품

| 부품 | 쓰는 곳 | 비고 |
|---|---|---|
| `AppPage` | 화면·loading·error·403 | `contentClassName="max-w-360"` |
| `Button` | 머리·대화상자·상태 줄·서랍 | `default` 하나(머리), 나머지 `outline`·`link` |
| `Card`(`size="sm"`) | 소스별 카드 | |
| `Table` 일습 | 이력 표 | `table-fixed` |
| `StatusBadge` | 표·서랍·상태 줄 | **기존 부품 확장**: `kind: "ingestRun"`(값 `RUNNING·SUCCEEDED·PARTIAL·FAILED` + 화면 상태 `PENDING`)을 더하고 글자표 `INGEST_RUN_STATUS_LABEL`을 `labels.ts`에 둔다. 아이콘·색은 기존 `STATUS_ICON` 키를 빌린다(§3.3). 새 부품 아님 |
| `Dialog`·`RadioGroup`·`Field`(`FieldError`) | 수동 수집 대화상자 | `RadioGroup`은 C6 §10.4 승인분. react-hook-form + zod |
| `Sheet`(`side="right"`, 480px) | 실행 상세 서랍 | `EvidenceDrawer`와 같은 폭 덮어쓰기 |
| `Skeleton` | loading·서랍 읽는 중 | |
| `EmptyState` | 빈 목록 | `(work)/empty-state.tsx` |
| `useLoadMore`·`LoadMoreFooter` | 더 보기 | `(work)/load-more.tsx` |
| `WorkError` | `error.tsx` | |
| `api-envelope.ts`의 `failureOf`·`JSON_HEADERS`·`NETWORK_MESSAGE` | 대화상자·polling·서랍 | 지금은 `bids/[id]/`에 있다. 두 화면이 쓰게 되면 `(work)/` 쪽으로 옮기는 것은 구현자 판단(코드 위치만 바뀐다) |
| `formatKst`·`formatRelative` | 시각 | `components/bids/format.ts`. 초까지 표시는 같은 파일에 함수 하나 더 |
| `refreshTopbarStatus` | 수집 끝 | `components/topbar-status.tsx` |
| lucide 아이콘 | `DatabaseIcon`(메뉴·빈 상태), `LoaderCircleIcon`, `CheckIcon`, `TriangleAlertIcon`, `OctagonAlertIcon`, `RefreshCwIcon`, `CircleAlertIcon` | 16px |

화면 전용 조각(`IngestRunTable`, `RunIngestDialog`, `IngestRunDrawer`, `SourceCards`, `use-ingest-polling`)은 한 화면에서만 쓰므로 `web/app/(app)/(work)/admin/ingestion/` 안에 둔다(부품은 두 번 이상 쓴 것만 `components/`로).

### 8.5 새로 필요한 것 (제안 — 승인 필요)

| 무엇 | 이유 |
|---|---|
| 새 토큰 | **없음** |
| 새 shadcn 부품 | **없음** |
| `StatusBadge` 확장(`ingestRun` 종류) | 상태 표기를 C6와 같은 모양으로 맞추려면 기존 부품에 종류 하나를 더해야 한다. 공용 부품을 바꾸므로 알린다 |
| `AppShell` prop `solRole`(D11) | ADMIN 전용 메뉴를 숨기려면 셸이 역할을 알아야 한다. `(work)/layout.tsx`가 `business.current.solRole`을 넘긴다. 다른 틀(`PeopleReadLayout` 등)은 넘기지 않아도 되고, 없으면 ADMIN 전용 줄을 숨긴다 |

## 9. 넘침 위험 지점

| 위치 | 위험 | 처리 |
|---|---|---|
| 표 "소스·방식" 둘째 줄 | 1280에서 칸 264px(글자 240px). 긴 요청자 이름(가입 이름 최대 길이) | 한 줄 `truncate` + `title`에 전체 |
| 표 숫자 칸 72px(글자 48px) | 6자리 이상(`123,456`, 약 55px) | 100,000 이상은 `12.3만` + `title`·sr 전체 수(§3.4) |
| 표 시작 칸 152px | `2026-10-20 14:03`(약 118px) | `whitespace-nowrap`, 여유 10px. 글꼴 대체 시 확인 필요 |
| 상태 배지 112px | `부분 완료` + 아이콘(약 81px) | 여유 있음 |
| 상태 줄 | 1280에서 글자가 길다(부분 완료 문장 + 숫자 6개) | `flex-wrap`, [자세히]는 다음 줄로 내려가도 된다 |
| 카드 "마지막 실패" | `공공 API 오류: API_SERVICE_KEY_INVALID`(코드 23자) | `dd`에 `wrap-anywhere` |
| 서랍 `sourceKey`·`detail` | g2b registry 키 + 공고번호, 긴 상세 | `font-mono wrap-anywhere`, 잘라내지 않는다 |
| 서랍 오류 행 수 | live run 경고 수백 건 | 무리마다 50개 + 더 보기, 서랍 안 스크롤 |
| 대화상자 | 라디오 설명 문장이 4줄까지 | 폭 480px, `Dialog` 기본 `max-h-[calc(100dvh-2rem)]` + 안쪽 스크롤(지우지 않는다) |
| 머리 | 제목 + 단추 | `AppPage`가 `flex-wrap`·`min-w-0`을 이미 처리 |
| 경로 충돌 | `web/app/admin/`(`/admin`)과 `web/app/(app)/(work)/admin/ingestion/`(`/admin/ingestion`)이 같은 첫 경로 조각 `admin`을 쓴다 | 주소가 겹치지는 않는다. 구현 첫 단계에서 `pnpm -C web build`로 경로 충돌 오류가 없는지, `/admin`(운영자 틀의 404 가드)이 `/admin/ingestion`에 걸리지 않는지 확인한다(미검증) |

## 10. 서버·다른 작업자에게 필요한 것

화면이 위 명세대로 동작하려면 서버 쪽이 다음을 지켜야 한다. "못 하게"는 모두 서버 몫이다. 이 스펙을 쓰는 동안 같은 폴더에 생긴 서버 계획 [N8 구현 계획(서버)](2026-10-20-n8-admin-ingestion-plan.md) §1이 1~5번과 9번을 이미 같은 방향으로 정했다(job data에 `runId`, 속도 제한은 `POST` 순서 안, `limit` 기본 20, `INGESTION_IN_PROGRESS {runId}`, `stages`는 생략·`["NOTICE"]`만 받고 큐 전에 뺀다). 그 계획을 고치지 않았고, 아래는 화면 쪽에서 본 조건이다.

1. **Route Handler 3개**(`web/app/api/v1/admin/ingestion/runs/route.ts`·`[id]/route.ts`): 인증 → CSRF(`POST`) → `sol_role=ADMIN`(아니면 `403 FORBIDDEN`) → zod → 서비스. 오류는 05 §5 봉투 + `X-Request-Id`.
2. **202 본문의 `id` = 나중 `ingest_runs.id`**: 지금 `ingest_runs.id`는 DB 기본값(`gen_random_uuid()`)이고 job data에 run id가 없다(`ingestion.queue.ts`). Route Handler가 id를 만들어 job에 싣고 worker가 그 id로 행을 만들어야 접수 행·서랍이 이어진다.
3. **속도 제한은 `POST`만**: 조직당 5회/분, 초과 `429` + `Retry-After`. `GET` polling은 세지 않는다.
4. **`GET /runs` 쿼리**: `cursor`·`limit`(기본 20, `startedAt` 내림차순, 커서 변조 `400 INVALID_CURSOR`). 05 §2에 쿼리가 적혀 있지 않아 `/notifications`와 같은 `?cursor&limit`로 맞춘다.
5. **`409 INGESTION_IN_PROGRESS`**에 `details.runId`를 싣는다(05 §5 498행).
6. **소스별 카드용 도메인 읽기**(D3 채택 시): 소스마다 최신 성공 1건·최신 실패 1건(사용자 세션, RLS). 공개 API 아님.
7. **재시도 기록**(D4 채택 시): `retry.ts`가 이미 만드는 `attempts`를 `ingestion.service.ts` `pullPages`가 버리고 있다(309행). 기다린 재시도마다 `ingest_errors`에 한 줄.
8. **오류 표시 필드**(D5 채택 시): `errors[].kind`·`errors[].fields`.
9. **g2b `stages`**: 05 `IngestionRunInput.stages`가 있지만 job data 스키마(`ingestion.queue.ts`)는 `stages`를 받지 않는다. 서버 계획은 생략·`["NOTICE"]`만 받고 큐 전에 뺀다. 이 화면은 `stages`를 보내지 않으므로(D8) 영향이 없다. 05와 job 스키마의 차이는 pipeline 작업자 몫으로 남는다.
10. **감사**: 수동 수집 요청 1건 = `audit_logs` `INGEST_MANUAL` 1행(조직·요청자·run).

## 11. 정본과 어긋나거나 모호한 점 (결정은 사람 몫)

1. 06 §5.8 주요 동작 "배치 선택(`seed`/`live`)"에는 소스가 없고, 05 §2는 소스 `g2b`|`fixture`다. 이 스펙은 소스 → (fixture면) 배치 순서로 둘 다 고르게 했다.
2. 05 §6.5 SEED 예시의 격리 오류는 `sourceKey "fixture:FX-12"`, `detail "title 누락"`이지만 코드는 `sourceKeyOf(source, noticeId)` = `fixture:DEMO-2026-0012`, `missingFieldsDetail` = `missing: title`이다(`validation.ts`). 화면은 저장값을 그대로 보인다(D6). 05 예시를 코드에 맞춰 고치는 것은 docs-keeper 몫이다.
3. `19-DEMO-SCENARIO.md` 44행은 "live 배치(… FX-20 429 시퀀스)"라고 하지만 07 §6.2 fixture 표·배치 표와 11 #17은 FX-20 429를 **SEED 배치**에 둔다. 07이 단일 원천이라 이 스펙은 SEED run에 재시도 2회를 기대한다.
4. 05 §1 "`/admin/ingestion/runs` 조직당 5회/분"이 `GET`도 세는지 적혀 있지 않다. 세면 polling이 안 된다. `POST`만 센다고 정본에 적어야 한다(§10 3번).
5. 06 §3.3 "`prefers-reduced-motion`이면 회전 아이콘 제외 전부 끔"(회전 아이콘은 계속 돈다로 읽힌다)과 C6 구현 `StatusBadge`의 `motion-reduce:animate-none`(회전도 멈춘다)이 다르다. 이 스펙은 구현을 따른다.
6. `Sheet`·`Dialog` 닫기 단추의 sr-only 이름이 영어 `Close`다(`components/ui/dialog.tsx` 77행). 06 §10 "`aria-label`은 한국어"와 다르다. 이 화면만이 아니라 공용 부품 문제라 따로 고칠 일로 남긴다.
7. 06 §5.8 ④ "재시도 로그(429 대기 포함)"와 11 #17 "재시도 로그 2회 + `Retry-After` 대기"를 채울 데이터가 지금 저장되지 않는다(`summary.retried` 숫자만). D4.
8. 06 §5.1 403 문구("현재 역할 표시 + [대시보드로]")와 `PeopleForbidden` 문구("조회 권한이 없습니다")가 다르다. D10.
9. 11 §9 NAV-09 "로그인 사용자의 미출시 경로 직접 접근 404"를 그대로 읽으면, 노출 조건(시험 통과 포함)을 채우기 전에는 이 경로가 404여야 해서 시험을 돌릴 수 없다. D12.
10. 06 §3.2 상태 표에 수집 run 상태(`RUNNING`·`SUCCEEDED`·`PARTIAL`·`FAILED`)와 화면 전용 "접수됨"이 없다. §3.3 표를 06에 더할지는 docs-keeper·사용자 몫이다.
11. `ingest_runs`는 조직 표가 아니라 공용 표다(어느 조직이든 ADMIN이면 모든 run을 읽는다). 다른 조직 ADMIN이 요청한 run의 요청자를 보일지는 정본에 없다. 서버 계획 §1은 요청자가 지금 조직의 구성원이 아니면 `requestedBy:null`로 낸다고 정했다. 화면은 탈퇴한 사용자와 같은 `수동 · 요청자 정보 없음`으로 보인다(§3.4). 정본(05)에 이 규칙을 적을지는 docs-keeper·사용자 몫이다.
12. `GET /runs` 목록 항목도 `IngestionRun` 전체라 `errors[]`를 싣는다. live run의 경고가 많으면 목록 응답이 커진다. 화면은 목록의 `errors`를 쓰지 않는다. 목록에서 `errors`를 빈 배열로 줄지는 열린 질문이다(해커톤 데이터에서는 문제없다).

## 12. 결정 필요 항목

각 항목의 ①이 추천안이다.

| # | 결정할 것 | 선택지 | 추천 이유 |
|---|---|---|---|
| D1 | run 상세를 어디에 보이나 | ① 같은 화면 오른쪽 서랍(480px) ② 별도 경로 `/admin/ingestion/[id]` | §4.7: 데모 조작이 한 화면에서 끝나고, C6 근거 서랍과 같은 부품·폭이며, 경로 파일 4개가 줄어든다 |
| D2 | 서랍을 주소에 남기나 | ① `?run=<id>`를 `window.history.pushState`로(서버 재요청 없음, 뒤로 가기로 닫힘) ② 남기지 않음(C6 근거 서랍처럼 화면 상태만) | 새로 고침·링크 공유·E2E가 쉬워지고 비용이 작다 |
| D3 | 06 §5.8 ① 소스별 카드 | ① 카드 2장(fixture·g2b) 유지, 서버 컴포넌트가 수집 도메인을 직접 읽는다(새 공개 API 없음) ② 이번 컷에서 빼고 이력 표만 | 정본 06을 지키고, mock 모드에서도 S0에 남긴 live run의 마지막 성공을 보여 준다. 시간이 모자라면 가장 먼저 자를 항목이다 |
| D4 | 재시도 기록(06 §5.8 ④, 11 #17) | ① worker가 기다린 재시도마다 `ingest_errors`에 새 코드 `RETRY_WAIT` 한 줄(`detail` 예 `429 · Retry-After 2초 · 재시도 1/3`). 04 `error_code` 목록에 한 줄, 05 §6.5 예시 갱신 ② 기존 `RATE_LIMITED` 코드를 재시도 줄에도 쓴다 ③ 저장하지 않고 횟수만 보이며 11 #17 기대값을 "재시도 2회"로 고친다 | ①은 DTO 모양을 안 바꾸고, 이미 계산되는 `attempts`를 저장만 하면 된다. ②는 "재시도 후 회복"과 "재시도 끝에 중단"을 구분할 수 없다. ③은 정본 기대값을 낮춘다 |
| D5 | 오류를 무리(격리·경고·재시도·중단)로 나누는 곳과 "필드" 칸 | ① 서버 매퍼가 `errors[].kind`(`QUARANTINE`·`WARNING`·`RETRY`·`FAILURE`)와 `errors[].fields`(`missing: …`·`invalid: …`를 읽은 필드 이름)를 덧붙인다(05 DTO 추가 필드, 문구 형식을 정한 `validation.ts` 옆에서 읽는다) ② 화면이 코드 목록과 `detail` 앞머리를 읽어 나눈다 | 같은 `SCHEMA_INVALID`가 레코드 격리일 수도 있고 fixture 파일 오류로 run을 멈춘 것(`sourceKey fixture:page:N`)일 수도 있다. 판정을 서버 한 곳에서 시험하는 편이 안전하다 |
| D6 | 격리 행의 공고 식별 | ① 저장된 `sourceKey` 그대로(`fixture:DEMO-2026-0012`) + 05 예시를 코드에 맞춰 고침 ② fixture 수집은 `sourceKey`를 `fixture:FX-12`(fixture id)로 기록하게 worker를 바꾼다 | ①은 코드를 안 바꾼다. 발표자는 "DEMO-2026-0012 = FX-12"를 대본에 적는다. ②는 화면이 문서와 바로 맞지만 g2b와 fixture의 키 규칙이 갈린다 |
| D7 | 배치 기본 선택 | ① 기본 없음(고르기 전 [수집 실행] 비활성) ② LIVE 기본 ③ SEED 기본 | LIVE는 공고를 바꾸고 알림을 만들며 되돌리려면 `pnpm demo:reset`이 필요하다. 클릭 한 번을 더 쓰는 편이 리허설 사고보다 싸다 |
| D8 | g2b 수집 구간·단계 입력 | ① 입력 없음, 기본값 안내만(`{source:"g2b"}`) ② 고급 옵션(날짜 2칸·단계 체크박스) | 해커톤 시연은 mock 모드이고, job 스키마가 아직 `stages`를 받지 않는다(§10 9번) |
| D9 | 실행 중일 때 [수동 수집 실행] | ① 지금 모드에서 실행할 수 있는 소스의 `RUNNING`이 첫 쪽에 있거나 접수 행이 있으면 비활성 + 도움말. 30분 넘은 `RUNNING`은 상태 줄 경고. 최종 판정은 서버 `409 INGESTION_IN_PROGRESS` ② 비활성하지 않고 서버 `409`만 | 06 §5.8 "실행 중 버튼 비활성"을 따른다. worker가 죽어 `RUNNING`이 남는 경우를 경고로 드러낸다(서버의 오래된 run 처리 규칙은 정본에 없다) |
| D10 | 403 화면 | ① `PeopleForbidden` 구조 + 06 §5.1 문구(지금 역할 + [대시보드로]), HTTP 200 ② Next `forbidden()`으로 HTTP 403(`experimental.authInterrupts`를 켜야 하고 `forbidden.tsx`가 필요) ③ `PeopleForbidden` 문구 그대로("조회 권한이 없습니다") | ①은 조정 판정(PeopleForbidden 관례)과 06 정본 문구를 함께 지키고 실험 기능을 켜지 않는다. API는 어느 쪽이든 403이다 |
| D11 | 메뉴·상단바 이름 | ① `AppShell`에 `solRole`을 넘기고 `NAV` 줄에 `roles:["ADMIN"]`을 단다(노출 조건 충족 뒤 줄 추가). 상단바 화면 이름은 `NAV`와 별도 목록으로 등록해 메뉴가 없어도 `데이터 수집 관리`가 보인다 ② 메뉴를 모든 역할에 보이고 들어가면 403 | ①은 06 §4.1 "ADMIN만"과 맞다. ②는 셸을 안 바꾸지만 비ADMIN이 매번 403을 만난다 |
| D12 | 노출 조건 충족 전 경로 접근(NAV-09 "미출시 경로 404") | ① 경로는 구현과 함께 연다(ADMIN 200, 그 밖 403). 메뉴 줄만 조건 충족 뒤 더한다. NAV-09의 "미출시 경로"는 아직 파일이 없는 경로로 읽는다 ② `NAV`의 출시 표시 하나로 메뉴와 경로를 같이 열고, 출시 전에는 404 + 시험 환경만 env로 연다 | ①이 가장 단순하고 시험을 돌릴 수 있다. ②는 시험용 우회 장치가 필요하다 |
| D13 | 상태 변화 알림 방식 | ① 화면 위 상태 줄 하나(`role="status"`) + 행 배지, 토스트 없음 ② 접수·완료를 토스트로도 | 토스트도 낭독되어 같은 사건을 두 번 읽고, 토스트는 사라져 데모 화면에 결과가 남지 않는다 |
| D14 | polling 주기 | ① 분석과 같은 상수(2초 60초 → 5초, 300초 상한), worker 미시작 안내 60초, 연속 3회 실패 안내 ② 5초 고정 | 상수와 동작을 C6와 같게 두면 시험·설명이 하나로 끝난다. 데모 fixture 수집은 몇 초면 끝난다 |
| D15 | `202` 직후 목록에 아직 없는 run의 표시 | ① 화면 전용 상태 `접수됨`(작업 시작 대기) ② 202 본문대로 `실행 중` | worker가 멈춰 있으면 ②는 실행되지 않는 run을 "실행 중"이라고 보인다. ①은 그 차이를 드러내고 60초 안내와 이어진다 |

## 관련 문서

- [[06-UI-UX|06 UI]] — §4·§4.1 사이드바, §5.1 공통 상태, §5.8 `/admin/ingestion`, §10 접근성, §12 증거 상태명
- [[05-API-SPEC|05 API]] — §1 멱등·속도 제한, §2 엔드포인트, `IngestionRunInput`·`IngestionRun`, §5 오류 코드, §6.5·§6.6 예시
- [[04-DATABASE|04 DB]] — `ingest_runs`·`ingest_errors`, enum
- [[07-DATA-PIPELINE|07 수집]] — fixture 표·배치 표·격리·재시도
- [[09-SECURITY|09 보안]] — ADMIN 권한, 서비스키 가림, 속도 제한·감사
- [[11-TESTING|11 테스트]] — §5 #12·#17, §9 NAV-05·NAV-09
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — §3 3번, S5, §5 실패 대응
- [[16-DECISIONS|16 ADR]] — ADR-020·021·023·030 B18
- [[12-ROADMAP|12 로드맵]] — 확장 컷 순서
- [C6 화면 디자인 스펙](2026-10-19-c6-screens-design.md) — 상태 표기·polling·근거 서랍 관례
