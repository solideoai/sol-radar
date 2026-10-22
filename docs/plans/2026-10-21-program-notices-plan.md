---
title: "구현 계획 — 부처 지원사업 공고 수집·목록 표시"
doc: "plan-program-notices"
status: draft
tags:
  - sol-radar
  - pipeline
  - ui
  - hackathon
created: 2026-10-21
updated: 2026-10-21
---

# 부처 지원사업 공고 수집·목록 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기업마당 지원사업 API 와 중기부 사업공고 RSS 를 worker 가 주기적으로 모아 새 표에 두고, `/bids/programs` 목록(나라장터 목록과 전환)에서 보여 준다.

**Architecture:** 새 서버 도메인 `web/server/program-notices/`(정규화·HTTP·저장·조회)와 worker 등록 하나(타이머 회차, notifier 와 같은 모양)를 덧붙인다. 저장은 새 표 `program_notices`·`program_notice_runs`(RLS)다. 화면은 새 경로 `/bids/programs` 와 두 목록을 잇는 링크 줄이고, 계약은 새 Route Handler `GET /api/v1/program-notices` 다. 나라장터 수집·분석 코드 경로는 건드리지 않는다(ADR-039 ①).

**Tech Stack:** Next.js 16 App Router · Supabase(Postgres·RLS) · zod · yaml · Vitest · Playwright · Node fetch.

**Spec:** `polaris/specs/in-progress/2026-10-21-agency-program-notices.md`(사용자 승인 2026-10-21). [사용자 결정]·[12 판단]은 바꾸지 않는다. 이 계획의 이름·모양은 [작업자 몫]이다.

## Global Constraints

- 덧붙이기만 한다. `infra/sources/registry.yaml`·`web/server/ingestion/source-registry.ts`·`OfficialApiConnector`·`ingest_save_revision`·분석 job·`bid_list_items`·`/api/v1/bids`·`ingest_runs` 계약은 고치지 않는다.
- 기존 파일 수정은 이 셋뿐이다: `web/app/(app)/(work)/bids/page.tsx`·`loading.tsx`(링크 줄 1개씩, 디자인 스펙 §12 Q2), `web/worker/main.ts`(등록 1줄 + import), `infra/compose.yaml`·env 예시·`infra/run-modes.json`(키 이름·경로). 시험(`main.test.ts`·`scripts/database.test.mjs`)·생성물(`database.types.ts`)·`package.json` 스크립트 한 줄·`scripts/recorded/README.md` 한 절은 각 Task 의 짝으로 더한다.
- 호출 호스트는 `www.bizinfo.go.kr`·`mss.go.kr` 둘뿐, `https:` 만. 리다이렉트는 따르지 않는다(`redirect: "manual"`, 3xx 는 실패).
- 기업마당 키 env 이름 `BIZINFO_API_KEY`. 서버(worker)만 읽는다. `NEXT_PUBLIC_` 금지, 로그·오류·run 기록·녹음·증거에 키를 남기지 않는다(`crtfcKey` 값 가림). live 필수 키가 아니다.
- `.env` 이름 파일은 어떤 도구로도 읽지 않는다(셸·node·python·스캔). env 이름을 문자열로 이어 붙이지 않는다. 막히면 멈추고 보고한다. 서브에이전트 지시문에도 넣는다.
- XML 은 `<!DOCTYPE`·`<!ENTITY` 가 있으면 통째로 거부한다(XXE 차단). 제목·개요는 평문으로 저장하고 화면은 글자로만 그린다(`dangerouslySetInnerHTML` 금지).
- 문의처(`refrncNm`)는 저장하지 않는다. 개요·신청방법·지원대상은 저장 전 전화·이메일 패턴을 가린다. 원본 응답 전체는 DB 에 넣지 않는다.
- 주기 기본 60분(env `PROGRAM_NOTICES_INTERVAL_MINUTES`). 기업마당 분야 기본 `["02"]`, 한 번 최대 100건. 중기부는 RSS 전체(20건).
- 설정 파일·env 가 틀려도 worker 기동과 나라장터 수집은 막지 않는다. 부처 수집만 끄고 로그 한 줄.
- 마이그레이션 번호 `20261023000800`~(10-21 12 대역 조정: 처음 `000500` 이었으나 클라우드에 먼저 적용된 `000600` 뒤로 옮김. 카카오 0601~·N2 0610~·S5 0620~·P0-8 0640~). `pnpm db:types` 결과를 같은 커밋에. 새 표 정책 시험은 `scripts/database.test.mjs`.
- 실호출: 중기부 RSS 녹음 1~2회만. 기업마당은 12 가 키 투입을 알릴 때까지 부르지 않는다(시험은 명세 모양의 가상 샘플).
- 무거운 검증·커밋은 `bash /private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/d905c94c-1dd3-4207-a362-5fb3bd476efc/scratchpad/verify-slot.sh <명령>` 로 감싼다. E2E 는 격리 compose·격리 Supabase(54321 금지).
- 화면은 1440·1280 두 폭. 점수·권고·분석·결정 버튼 없음. 승률·확률 표시 없음.

## Review Focus

1. 기업마당 JSON 봉투가 명세 예시와 다를 수 있다(`jsonArray` 가 배열 또는 `{item:[…]}`, `item` 이 객체 하나). 셋 다 받고, 모르는 모양은 `RESPONSE_SHAPE` 실패로 남긴다 → Task 2 시험.
2. 신청기간 문자열이 `20261001 ~ 20261031` 외 모양(`상시`, `예산 소진시까지`, 빈 값, 한쪽만, `2026-10-01 ~ 2026-10-31`)으로 온다 → 마감 null, 행은 버리지 않는다 → Task 1 시험.
3. 오류 응답(HTML 오류 페이지·빈 본문·키 오류 JSON)이 200 으로 온다 → 항목 0건 + `RESPONSE_SHAPE` 실패, 이전 데이터 유지 → Task 2·4 시험.
4. 마감 판정의 "오늘"은 KST 날짜다. UTC 자정 근처에 오늘 마감 공고가 사라지면 안 된다 → Task 6 시험(`2026-10-21T15:30:00Z` 는 KST 10-22).
5. 같은 회차에서 한 소스가 던져도(파싱 예외·DB 오류) 다른 소스는 저장되고 worker 는 살아 있다 → Task 4·5 시험.

---

## 파일 구조

```
supabase/migrations/20261023000800_program_notices.sql   표 2개·RLS·인덱스·touch 트리거
web/lib/database.types.ts                                 pnpm db:types 생성물
scripts/database.test.mjs                                 정책 시험 추가
infra/sources/program-notices.yaml                        부처 소스 설정(자체 스키마)
infra/compose.yaml · infra/env/*.env.example · .env.example · infra/run-modes.json   키 이름·경로
web/server/program-notices/
  program-notice.model.ts      타입·zod(정규화 행·목록 질의·목록 항목)
  text.ts                      HTML→평문, 연락처 가림, 정규화 키
  dates.ts                     신청기간·등록일·RSS pubDate 파싱, KST 오늘
  bizinfo.ts                   요청 URL·응답 해석·항목 정규화
  mss-rss.ts                   RSS 해석(XXE 거부)·항목 정규화
  http.ts                      허용 호스트·리다이렉트 거부·크기·시간 제한·키 가림
  config.ts                    program-notices.yaml 읽기·검사(틀리면 소스 끔)
  recording.ts                 녹음 파일 형식(`sol-program-recorded/v0.1`) 읽기
  collect.service.ts           회차: 소스별 가져오기→정규화→저장→run 기록(소스 격리)
  program-notices.store.ts     worker 쓰기(service role 클라이언트 주입)
  list.service.ts              목록 질의 해석·중복 묶기·정렬
  program-notices.repo.ts      화면 읽기(anon + RLS, getSupabase)
  index.ts                     배럴
web/worker/program-notices.ts  설정 읽기·타이머 회차·등록 함수
web/worker/main.ts             WORKER_REGISTRATIONS 에 한 줄
scripts/recorded/record-program-notices.mjs  녹음 CLI(키는 process.env 로만)
fixtures/recorded/program-notices/mss/*.json  중기부 녹음(가림)
web/app/api/v1/program-notices/route.ts      GET 목록
web/app/(app)/(work)/bids/bids-source-nav.tsx      "나라장터 공고 | 부처 지원사업" 링크 줄
web/app/(app)/(work)/bids/programs/{page,program-list-view,program-notice-drawer,programs-copy,list-query}.tsx|ts
web/e2e-work/program-notices.spec.ts (또는 work 설정의 기존 폴더)   전환→목록→상세→원문 링크
docs/evidence/program-notices/                    스크린샷·녹음 보고
```

## 이름과 값 (모든 Task 공통)

- 소스 키: `bizinfo`(기업마당), `mss`(중기부). 화면 배지 "기업마당"·"중기부".
- 정규화 행 `NormalizedProgramNotice`: `source`, `sourceNoticeId`, `title`, `agency: string|null`, `sourceUrl`(https), `publishedAt: string|null`(ISO), `applyStartOn: string|null`·`applyEndOn: string|null`(`YYYY-MM-DD`), `summary`·`applyMethod`·`target: string|null`, `tags: string[]`, `dedupeKey`, `fetchedAt`(ISO), `isDemo: boolean`.
- 기업마당 필드 대응: `pblancId`(없으면 `seq`) → id, `pblancNm`(없으면 `title`), `jrsdInsttNm`(없으면 `author`), `pblancUrl`(없으면 `link`, 상대경로면 `https://www.bizinfo.go.kr` 붙임), `creatPnttm`(없으면 `pubDate`), `reqstBeginEndDe`(없으면 `reqstDt`), `bsnsSumryCn`(없으면 `description`), `reqstMthPapersCn`, `trgetNm`, 태그 = `pldirSportRealmLclasCodeNm`(없으면 `lcategory`) + `hashTags` 쉼표 분리(공백 제거·중복 제거·최대 20). `refrncNm` 은 읽지 않는다.
- 중기부: 제목 `title`, 링크 `link`, 등록일 `pubDate`(`YYYYMMDDHHMMSS`, KST), id = 링크의 `bcIdx` 쿼리 값(없으면 링크 전체의 sha256 앞 16자), 소관기관 상수 `"중소벤처기업부"`, 신청기간·개요·방법·대상 null, 태그 `[]`.
- `isDemo`: 실제 공고(실호출·녹음 재생)는 `false`(나라장터 `normalize-g2b` 관례 `isDemo === (source === "fixture")`). 가상 샘플은 시험에만 쓰고 표에 넣지 않는다.
- 실패 코드(`program_notice_runs.error_code`): `KEY_MISSING`, `NO_RECORDING`, `HOST_NOT_ALLOWED`, `REDIRECT_BLOCKED`, `HTTP_ERROR`, `TIMEOUT`, `TOO_LARGE`, `RESPONSE_SHAPE`, `XML_DTD_REJECTED`, `STORE_FAILED`, `CONFIG_INVALID`. run 상태 `SUCCEEDED`·`PARTIAL`(일부 항목 버림)·`FAILED`·`SKIPPED`.
- 응답 크기 상한 2 MiB, 요청 시간 제한 10,000ms.

---

### Task 1: 순수 규칙 — 평문·연락처 가림·정규화 키·날짜

**Files:**
- Create: `web/server/program-notices/program-notice.model.ts`, `text.ts`, `dates.ts`, `index.ts`
- Test: `web/server/program-notices/text.test.ts`, `dates.test.ts`

**Interfaces:**
- Produces: `htmlToPlainText(raw: string): string`, `maskContacts(text: string): string`, `cleanText(raw: unknown, maxLength: number): string|null`(평문화 + 가림 + trim + 상한, 빈 값 null), `dedupeKeyOf(title: string, agency: string|null): string`, `parseApplyPeriod(raw: unknown): {startOn: string|null; endOn: string|null}`, `parseKstDateTime(raw: unknown): string|null`(`YYYY-MM-DD HH:MM:SS`·`YYYYMMDDHHMMSS`·`YYYY-MM-DD` → ISO), `kstToday(now: Date): string`(`YYYY-MM-DD`). 모델 타입 `ProgramNoticeSource`, `NormalizedProgramNotice`(zod `normalizedProgramNoticeSchema`).

- [ ] **Step 1: 실패하는 시험**
  - `htmlToPlainText("<p>가</p><p>나<br/>다</p>&amp;&lt;b&gt;")` → `"가\n나\n다\n&<b>"`(태그 제거, `<br>`·`</p>`·`</li>` 은 줄바꿈, 엔티티 5종·숫자 참조 풀기, 연속 빈 줄 하나로). `<script>x</script>` 는 내용째 빠진다.
  - `maskContacts("문의 02-123-4567, a.b@x.go.kr, 1588-1234")` → 전화·이메일·대표번호(`\d{4}-\d{4}`)가 같은 길이 `*`. 날짜 `2026-10-21` 은 그대로.
  - `dedupeKeyOf("[중기부] 2026년 스마트공장 지원사업 공고", "중소벤처기업부")` === `dedupeKeyOf("2026년  스마트공장 지원사업 공고", "중소벤처기업부 ")`(NFKC, 앞쪽 대괄호 머리말 제거, 공백·구두점 제거, 소문자).
  - `parseApplyPeriod("20261001 ~ 20261031")` → `{startOn:"2026-10-01", endOn:"2026-10-31"}`; `"2026-10-01 ~ 2026-10-31"` 같은 값; `"상시"`·`""`·`null`·`"20261001 ~"` → `endOn:null`(시작만 있으면 startOn 유지); 달력에 없는 날(`20261332`) → null.
  - `parseKstDateTime("20261021093000")` → `"2026-10-21T00:30:00.000Z"`; `"2026-10-21 09:30:00"` 같은 값; `"abc"` → null.
  - `kstToday(new Date("2026-10-21T15:30:00Z"))` → `"2026-10-22"`.
- [ ] **Step 2:** `pnpm -C web exec vitest run server/program-notices` → FAIL(모듈 없음).
- [ ] **Step 3:** 구현. 모든 파일 `import "server-only";`(시험은 기존 도메인처럼 `server-only` 모의를 따른다). 정규식만 쓴다(새 의존성 없음).
- [ ] **Step 4:** 같은 명령 PASS.
- [ ] **Step 5:** 커밋 `feat(program-notices): 평문·날짜·정규화 키 규칙`.

### Task 2: 소스 해석 — 기업마당 JSON·중기부 RSS·HTTP

**Files:**
- Create: `web/server/program-notices/bizinfo.ts`, `mss-rss.ts`, `http.ts`, `test-data/bizinfo-sample.json`(명세 모양 가상 샘플, 첫 줄 주석 대신 `"_note": "가상 샘플 — 시험 전용"`), `test-data/mss-sample.xml`(Task 7 녹음 뒤 녹음본으로 바꿀 수 있다)
- Test: `bizinfo.test.ts`, `mss-rss.test.ts`, `http.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `buildBizinfoUrl(input: {baseUrl: string; key: string; categories: readonly string[]; maxItems: number}): string` — `crtfcKey`·`dataType=json`·`searchCnt=<maxItems>`·`searchLclasId=<categories 쉼표>`.
  - `parseBizinfoBody(body: string, fetchedAt: string): ParseResult`, `parseMssRss(body: string, fetchedAt: string): ParseResult` — `ParseResult = {ok: true; notices: NormalizedProgramNotice[]; dropped: number} | {ok: false; errorCode: "RESPONSE_SHAPE" | "XML_DTD_REJECTED"}`.
  - `fetchProgramSource(url: string, deps: {fetch: FetchLike; secrets: readonly string[]; timeoutMs?: number; maxBytes?: number}): Promise<{ok: true; body: string; status: number} | {ok: false; errorCode: ProgramRunErrorCode; status?: number}>`, `redactProgramUrl(url: string, secrets: readonly string[]): string`, `PROGRAM_NOTICE_HOSTS = ["www.bizinfo.go.kr", "mss.go.kr"]`.
- [ ] **Step 1: 실패하는 시험**
  - 기업마당: 봉투 `{jsonArray:[…]}`·`{jsonArray:{item:[…]}}`·`{jsonArray:{item:{…}}}` 모두 같은 notices. 명세 필드 → 정규화 값(위 "이름과 값"). `refrncNm` 값이 결과 어디에도 없다. 개요의 전화번호가 `*`. 제목·id·URL 없는 항목은 버리고 `dropped` 를 센다. `"<html>…"`·`""`·`{"error":…}` → `RESPONSE_SHAPE`. `searchCnt` 는 `maxItems`, URL 에 `crtfcKey=` 가 있다.
  - 중기부: `pubDate 20261021093000` → `publishedAt "2026-10-21T00:30:00.000Z"`, `link …View.do?cbIdx=310&bcIdx=1065432…` → id `1065432`, 소관기관 `중소벤처기업부`, CDATA 제목 풀림. `<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>` 가 든 본문 → `XML_DTD_REJECTED`. `<item>` 이 없으면 `notices:[]`(ok). 날짜가 깨진 항목은 `publishedAt:null` 로 남긴다(제목·링크가 없으면 버림).
  - HTTP: `http://mss.go.kr/…` → `HOST_NOT_ALLOWED`(fetch 안 부름), `https://evil.example/` → 같음, `https://mss.go.kr.evil.example/` → 같음. fetch 가 302 → `REDIRECT_BLOCKED`. 500 → `HTTP_ERROR` + status. AbortError → `TIMEOUT`. 본문이 상한 초과 → `TOO_LARGE`. fetch 호출 인자 `redirect: "manual"`. fetch 가 키가 든 메시지로 던져도 결과·로그 문자열에 키가 없다. `redactProgramUrl("https://www.bizinfo.go.kr/…?crtfcKey=abc&dataType=json", ["abc"])` → `crtfcKey=[REDACTED]`.
- [ ] **Step 2:** FAIL 확인. **Step 3:** 구현. RSS 는 정규식으로 `<item>…</item>` 를 잘라 `title`·`link`·`pubDate` 만 읽는다(CDATA·엔티티 5종·숫자 참조 풀기). DTD 검사는 본문 전체에서 대소문자 무시. **Step 4:** PASS. **Step 5:** 커밋 `feat(program-notices): 기업마당·중기부 응답 해석과 허용 호스트`.

### Task 3: 표·정책 — 마이그레이션·DB 시험·생성 타입

**Files:**
- Create: `supabase/migrations/20261023000800_program_notices.sql`
- Modify: `web/lib/database.types.ts`(생성), `scripts/database.test.mjs`(새 describe, 그리고 표 목록을 고정한 기존 시험이 있으면 새 표를 그 기대값에 더한다)

**Interfaces:**
- Produces: `public.program_notices`(id uuid pk, source text check in ('bizinfo','mss'), source_notice_id text, title text, agency text null, source_url text check `~ '^https://'`, published_at timestamptz null, apply_start_on date null, apply_end_on date null, summary text null, apply_method text null, target text null, tags text[] not null default '{}', dedupe_key text not null, fetched_at timestamptz not null, is_demo boolean not null default false, created_at·updated_at timestamptz, unique(source, source_notice_id)), 인덱스 (apply_end_on), (published_at desc), (dedupe_key). `public.program_notice_runs`(id uuid pk, source text check, run_mode text check in ('LIVE','FIXTURE','MOCK'), status text check in ('SUCCEEDED','PARTIAL','FAILED','SKIPPED'), error_code text null, fetched_count·saved_count·dropped_count int not null default 0 check >= 0, started_at timestamptz not null default now(), finished_at timestamptz null), 인덱스 (source, started_at desc).
- 권한: 두 표 `revoke all … from anon, authenticated, public`. `program_notices` 만 `grant select … to authenticated` + 정책 "활동 중 회원은 부처 공고 읽기" `using ((select public.is_active_user()))`. `program_notice_runs` 는 화면 역할에 아무것도 주지 않는다(service role 전용). touch_updated_at 트리거는 `program_notices` 에.
- [ ] **Step 1: 실패하는 시험**(`scripts/database.test.mjs`, describe "부처 지원사업 공고 표 (20261023000800)"): 활동 회원 select 됨, 정지 회원 0행, anon select 거부, authenticated insert·update·delete 거부, `program_notice_runs` 는 authenticated select 거부, source check·https check 위반 insert(service role) 거부, 같은 (source, source_notice_id) 두 번 insert 거부.
- [ ] **Step 2:** `pnpm test:db` → FAIL. **Step 3:** 마이그레이션 작성, `pnpm db:types`. **Step 4:** `pnpm test:db`·`pnpm check:db-types` PASS. **Step 5:** 커밋 `feat(db): 부처 지원사업 공고 표와 RLS`(마이그레이션·타입·시험 한 커밋).

### Task 4: 설정·녹음·수집 회차 서비스

**Files:**
- Create: `infra/sources/program-notices.yaml`, `web/server/program-notices/config.ts`, `recording.ts`, `collect.service.ts`, `program-notices.store.ts`
- Test: `config.test.ts`, `recording.test.ts`, `collect.service.test.ts`

**Interfaces:**
- Consumes: Task 1·2, Task 3 표 이름.
- Produces:
  - 설정 파일 모양: `schemaVersion: program-notices/v0.1`, `sources.bizinfo: {enabled: true, baseUrl: "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do", keyEnv: BIZINFO_API_KEY, categories: ["02"], maxItems: 100}`, `sources.mss: {enabled: true, baseUrl: "https://mss.go.kr/rss/smba/board/310.do"}`.
  - `loadProgramNoticesConfig(file: string): Promise<{ok: true; config: ProgramNoticesConfig} | {ok: false; reason: string}>` — 없거나 틀리면 ok:false(던지지 않는다). baseUrl 호스트가 `PROGRAM_NOTICE_HOSTS` 밖이면 그 소스 ok:false 사유. `keyEnv` 는 `^BIZINFO_API_KEY$` 만 받는다.
  - 녹음 형식 `sol-program-recorded/v0.1`: `{schemaVersion, source, params(키 없음, crtfcKey 이름 있으면 거부), fetchedAt, httpStatus, contentType, body(가린 원문 문자열), rawSha256, masked: true, maskedFields: string[], note}`. `loadProgramRecordings(dir: string, source): Promise<ProgramRecording[]>`(폴더 없으면 `[]`, 형식이 틀린 파일은 건너뛰고 개수 반환).
  - `ProgramNoticesStore = {upsertNotices(rows: NormalizedProgramNotice[]): Promise<number>; recordRun(run: ProgramRun): Promise<void>}`, `createSupabaseProgramNoticesStore(admin: SupabaseClient<Database>)` — `onConflict: "source,source_notice_id"`.
  - `runProgramNoticeRound(deps: {config; runMode: "live"|"fixture"|"mock"; env: Record<string,string|undefined>; fetch: FetchLike; store; recordingsDir: string; now: () => Date; log: (line: string) => void}): Promise<ProgramRun[]>` — 소스마다 독립 try/catch. live: 기업마당 키가 비면 `SKIPPED KEY_MISSING`(fetch 안 부름), 아니면 fetch→parse→upsert. mock·fixture: 녹음 재생(없으면 `SKIPPED NO_RECORDING`, fetch 안 부름). 파싱 결과 0건·실패면 upsert 하지 않는다(마지막 성공 데이터 유지). 로그는 JSON 한 줄 `{event:"program_notices.round", source, status, errorCode, saved, dropped}` — URL·키·본문 없음.
- [ ] **Step 1: 실패하는 시험**: 설정 없음·schemaVersion 다름·호스트 밖 → ok:false 사유(값 없이 키 이름만). 녹음에 `crtfcKey` 파라미터 → 형식 오류로 건너뜀. 회차: (a) live + 키 없음 → bizinfo SKIPPED/KEY_MISSING, mss SUCCEEDED, fetch 는 mss 만 1번; (b) mss parse 가 던져도 bizinfo 저장됨, 반환 run 2개; (c) store.upsertNotices 가 던지면 그 소스 FAILED/STORE_FAILED, 다른 소스 영향 없음; (d) mock + 녹음 → fetch 0번, 녹음 fetchedAt 이 `fetchedAt` 으로 저장; (e) 로그·run 어디에도 키 문자열(`test-key-123`)이 없다; (f) 항목 일부 버림 → PARTIAL, dropped 수.
- [ ] **Step 2:** FAIL. **Step 3:** 구현(`yaml` 패키지는 web 에 이미 있다). **Step 4:** PASS. **Step 5:** 커밋 `feat(program-notices): 설정·녹음·수집 회차`.

### Task 5: worker 등록·실행 환경

**Files:**
- Create: `web/worker/program-notices.ts`, Test: `web/worker/program-notices.test.ts`
- Modify: `web/worker/main.ts`(import + `programNoticesWorkerRegistration` 를 `WORKER_REGISTRATIONS` 끝에), `infra/compose.yaml`(worker env `BIZINFO_API_KEY: ${BIZINFO_API_KEY:-}`, `PROGRAM_NOTICES_INTERVAL_MINUTES:`, `PROGRAM_NOTICES_CONFIG_FILE: /srv/sol-radar/infra/sources/program-notices.yaml` — `SOURCES_REGISTRY_FILE` 줄 바로 아래), `.env.example`·`infra/env/*.env.example`(빈 `BIZINFO_API_KEY=`·주석), `infra/run-modes.json`(바꿀 필요가 없으면 그대로. `scripts/check-env.mjs`·`check-policy` 가 키 등록을 요구하면 거기에 맞춘다)

**Interfaces:**
- Consumes: Task 4 `runProgramNoticeRound`·`loadProgramNoticesConfig`·`createSupabaseProgramNoticesStore`.
- Produces: `readProgramNoticeSettings(env): {ok: true; intervalMs: number; configFile: string; recordingsDir: string} | {ok: false; reason: string}`(간격 1~1440 분 정수, 기본 60. 설정 파일 기본 `<SOURCES_REGISTRY_FILE 폴더>/program-notices.yaml`, 없으면 `../infra/sources/program-notices.yaml`. 녹음 폴더 `<FIXTURES_DIR>/recorded/program-notices`), `startProgramNoticeCollector(deps, timers)`(기동 때 한 번 + 간격마다, 겹치지 않음, 회차 오류 삼킴, stop 은 진행 회차 최대 5초 대기 — `startNotifier` 와 같은 모양), `programNoticesWorkerRegistration: WorkerRegistration`(1단계에서 던지지 않는다: 설정·env 가 틀리면 `program_notices.disabled` 로그 한 줄 + 빈 Closable).
- [ ] **Step 1: 실패하는 시험**: 간격 `"0"`·`"abc"`·`"1441"` → ok:false; 등록 함수가 틀린 env 에서도 resolve 하고 로그 한 줄; 타이머 회차가 겹치지 않음; stop 대기. `main.test.ts` 의 등록 목록 시험이 있으면 새 등록을 기대값에 더한다.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** `pnpm -C web exec vitest run worker` PASS, `pnpm check:env`(있으면) PASS. **Step 5:** 커밋 `feat(worker): 부처 지원사업 공고 주기 수집 등록`.

### Task 6: 목록 조회·Route Handler

**Files:**
- Create: `web/server/program-notices/list.service.ts`, `program-notices.repo.ts`, `web/app/api/v1/program-notices/route.ts`
- Test: `list.service.test.ts`, `web/app/api/v1/program-notices/route.test.ts`

**Interfaces:**
- Produces:
  - `parseProgramNoticeListQuery(raw: RawQuery): {ok: true; value: ProgramNoticeListQuery} | {ok: false; issues: QueryIssue[]}` — `source=bizinfo|mss`(없으면 둘 다), `q`(소관기관 검색어, 1~50자, 공백만이면 무시), `sort=deadline|published`(기본 deadline), `includeClosed=true|false`(기본 false). 모르는 키는 무시, 값이 틀리면 400.
  - `ProgramNoticeListItem = {id, source, title, agency, sourceUrl, publishedAt, applyStartOn, applyEndOn, summary, applyMethod, target, tags, isDemo}`.
  - `listProgramNotices(query, deps: {repo: ProgramNoticesRepo; today: string}): Promise<{items: ProgramNoticeListItem[]; total: number; hasAnyNotice: boolean; isCapped: boolean}>` — repo 는 등록일 최신 순 최대 600행(`LIST_FETCH_LIMIT`)을 읽고, 거르고 정렬한 뒤 300행(`LIST_MAX_ITEMS`)에서 자른다. `hasAnyNotice` 는 거르기 전 저장 행이 있는지, `isCapped` 는 300행을 넘어 잘렸는지다(디자인 스펙 §12 Q3). 마감 지난 것(applyEndOn < today) 은 `includeClosed` 가 아니면 뺀다(null 은 늘 남김). 두 소스가 다 보일 때 같은 `dedupe_key` 면 기업마당 행만 남긴다. 정렬 deadline: applyEndOn 오름차순, null 뒤, 같으면 publishedAt 내림차순. published: publishedAt 내림차순, null 뒤.
  - `GET /api/v1/program-notices` → `businessRoute` + `serviceResponse` 봉투, 200 `{items, total, hasAnyNotice, isCapped}`, 400 `VALIDATION_ERROR`. today 는 `kstToday(new Date())`.
- [ ] **Step 1: 실패하는 시험**: 위 규칙마다 1개(Review Focus 4 의 KST 오늘 포함), 중복 묶기에서 `source=mss` 필터면 중기부 행이 남는다, `q` 는 소관기관 부분 일치(대소문자·공백 무시), Route 400·200 모양(기존 `/api/v1/bids` route 시험 관례).
- [ ] **Step 2:** FAIL. **Step 3:** 구현. repo 는 `getSupabase()`(anon + 세션, RLS)로 `program_notices` 를 읽는다. **Step 4:** PASS. **Step 5:** 커밋 `feat(program-notices): 목록 조회와 GET /api/v1/program-notices`.

### Task 7: 중기부 녹음

**Files:**
- Create: `scripts/recorded/record-program-notices.mjs`(+ `.test.mjs`: 가림·키 검사·형식), `fixtures/recorded/program-notices/mss/rss-310.<YYYYMMDD>.masked.json`, `docs/evidence/program-notices/recording-<YYYYMMDD>.md`
- Modify: `package.json` 스크립트 `record:program-notices`, `scripts/recorded/README.md` 한 절

**Interfaces:**
- Produces: Task 4 녹음 형식 파일. CLI `pnpm record:program-notices -- --source mss|bizinfo`. 기업마당 키는 `process.env.BIZINFO_API_KEY` 로만 받는다(`.env` 파일을 읽지 않는다). 키가 없으면 bizinfo 는 거부.
- [ ] **Step 1:** 시험(가림: 전화·이메일·`refrncNm` 값 → `***`, 녹음 params 에 `crtfcKey` 없음, 저장 뒤 키 4형태 0건 검사 함수). **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS 뒤 **중기부 1회 실호출**로 녹음, Task 2 의 `test-data/mss-sample.xml` 이 실제 모양과 다르면 시험을 실제 모양에 맞춘다. 리다이렉트·호스트가 명세와 다르면 멈추고 12 에 보고. **Step 5:** 커밋 `feat(recorded): 중기부 사업공고 RSS 녹음`. 기업마당 녹음은 12 의 키 알림 뒤 같은 CLI 로 하고 별도 커밋.

### Task 8: 화면 — 링크 줄·목록·상세

**Files:**
- Create: `web/app/(app)/(work)/bids/bids-source-nav.tsx`, `web/app/(app)/(work)/bids/programs/page.tsx`·`loading.tsx`·`error.tsx`·`programs-copy.ts`·`list-query.ts`(+`.test.ts`)·`program-list-view.tsx`·`program-notice-drawer.tsx`, 브라우저 시험 `program-list.browser.test.tsx`
- Modify: `web/app/(app)/(work)/bids/page.tsx`(AppPage 첫 자식으로 `<BidsSourceNav current="g2b" />` 한 줄 + import), `web/app/(app)/(work)/bids/loading.tsx`(같은 한 줄, 디자인 스펙 §12 Q2)

**Interfaces:**
- Consumes: Task 6 `listProgramNotices`·`parseProgramNoticeListQuery`·`ProgramNoticeListItem`. 서버 페이지는 Route Handler 를 거치지 않고 서비스를 직접 부른다(`/bids` 첫 쪽과 같은 관례).
- 디자인은 `web-designer` 스펙(`docs/plans/2026-10-21-program-notices-design.md`)을 먼저 받는다. 고정할 것: 링크 줄은 `SettingsNav` 모양(링크 + `aria-current="page"`, 2px 밑줄), 제목은 `/bids` 그대로("입찰 공고")이고 `/bids/programs` h1 만 "부처 지원사업 공고"(디자인 스펙 §12 Q1). 열: 출처 배지·공고명·소관기관·신청 마감(없으면 "기간 미표기")·등록일. 필터: 출처, 소관기관 검색어, 정렬, "마감 지난 공고 포함" 토글 — 주소 쿼리가 정본. 상세는 서랍(Sheet): 개요·신청방법·지원대상·태그, "문의처는 원문에서 확인하세요", "원문 보기"(`target="_blank" rel="noopener noreferrer"`). 빈 상태 "수집된 부처 지원사업 공고가 없습니다". 점수·권고·분석·결정 버튼 없음. 글자는 평문(`whitespace-pre-line`).
- [ ] **Step 1:** 브라우저 시험(1280 폭 넘침 없음, 서랍 열림·닫힘 초점, 원문 링크 속성) 실패 확인. **Step 2:** 구현. **Step 3:** `pnpm -C web test:browser` 해당 파일 PASS, `pnpm -C web lodestar`·`pnpm check:colors` PASS. **Step 4:** 1440·1280 스크린샷 `docs/evidence/program-notices/`. **Step 5:** 커밋 `feat(web): 부처 지원사업 공고 목록과 상세 서랍`.

### Task 9: E2E·검증·기준점

**Files:**
- Create: E2E 시험 1개(`web/e2e-work/` 관례 또는 `playwright.work.config.ts` 의 testDir 아래 `program-notices.spec.ts`)
- [ ] **Step 1:** 격리 Supabase(scratchpad 사본, 597xx 포트)·격리 compose 로 mock 모드 worker 를 띄워 녹음 적재 → E2E: `/bids` → "부처 지원사업" → 목록 N건(녹음 건수와 같음) → 행 → 서랍 → 원문 링크 `target`·`rel`. **Step 2:** PASS, 로그를 `docs/evidence/program-notices/` 에. **Step 3:** `verify-slot.sh pnpm verify` 통과, 루트·web·ai 시험 수 기록. **Step 4:** 정본 절 목록(07·15·04·05·06·09·10·19)을 45 에 보내 합의(문서는 45 와 정한 대로). **Step 5:** 3e 에 기준점(브랜치 해시·병합한 main 해시·verify 개수·작업 트리 깨끗 여부), 12 에 한 줄.

## 일정·보고

- 계획 완료 → 12 한 줄. Task 1~7 끝 → "백엔드 완료". Task 8 끝 → "화면 완료". Task 9 끝 → "기준점".
- 병렬: Task 3(backend-developer + test-server)과 web-designer 디자인 스펙은 Task 1·2 와 함께 시작한다. Task 4~6 은 1~3 뒤, Task 8 은 6·디자인 스펙 뒤.
- 목표 10-22 저녁 기준점, 늦어도 10-23 freeze 전 green. 못 맞추면 데모에서 빠진다(ADR-039 ③).
