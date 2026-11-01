---
title: "과기정통부 R&D 공모 수집·부처 지원사업 탭 표시 구현 계획"
status: draft
tags: [sol-radar, plan, program-notices, msit, hackathon]
updated: 2026-11-01
---

# 과기정통부 R&D 공모 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공데이터포털 15074634 "과학기술정보통신부_사업공고"를 부처 지원사업 경로의 세 번째 출처 `msit`로 수집해 `/bids/programs`에 보이고, 랜딩 출처 띠에 과기정통부 로고를 더한다.

**Architecture:** 새 출처는 기존 `program_notices` 경로(설정 YAML → `runProgramNoticeRound` → upsert)에 그대로 얹는다. 파서 `msit.ts` 하나를 더하고, 회차 계획(`planOf`)을 출처별 빌더 표로 바꾼다. 회사 부처 공고 전용 Worker는 기업마당과 같은 정각 회차에서 과기정통부를 함께 부르고, 키가 없으면 과기정통부만 뺀다. 화면은 출처 필터·문구만 늘린다.

**Tech Stack:** Next.js 16 `web/`, 서버 도메인 `web/server/program-notices`, BullMQ Worker `web/worker`, Supabase 마이그레이션, Vitest, `node --test`(scripts), Playwright(랜딩 E2E).

**Spec:** `polaris/specs/planned/2026-11-01-msit-rnd-notices.md`(2026-11-01 사용자 승인). 실행자는 스펙과 이 계획을 같이 읽는다.

## Global Constraints

- 출처 키 `msit`, 라벨 `과기정통부`, 키 env `MSIT_ANNOUNCEMENT_API_KEY`, 허용 호스트 `apis.data.go.kr`(요청)·`www.msit.go.kr`(원문 링크).
- 요청: `GET https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList`, 파라미터 `ServiceKey`·`pageNo=1`·`numOfRows=<maxItems>`·`returnType=json`. `maxItems` 기본 50, 범위 1~99. 회차당 요청 1번.
- env 값은 포털 Encoding 키다. 코드는 `decodeURIComponent`로 한 번 풀고 `URLSearchParams`가 한 번만 인코딩한다.
- 키·요청 URL·응답 본문은 로그·`program_notice_runs`·오류 메시지·녹음 파일·시험 출력에 남기지 않는다. 가림 대상은 env 원문, 디코딩 값, 디코딩 값의 1회 인코딩 세 형태다.
- `.env` 파일은 어떤 도구로도 읽지 않는다. 키가 필요한 실행은 사용자가 `!`로 직접 돌린다.
- 제외 단어(제목에 있으면 저장 안 함, `dropped`에 넣지 않음): `선정결과` `선정 결과` `평가결과` `평가 결과` `수상작` `결과 공고` `결과공고`. `선정계획`은 남긴다.
- 정규화: `agency = "과학기술정보통신부 " + deptName`(없으면 `과학기술정보통신부`), `dedupeKey = dedupeKeyOf(title, "과학기술정보통신부")`, `sourceNoticeId = viewUrl의 nttSeqNo`, 신청 기간·요약·방법·대상 `null`, `tags []`, `isDemo false`. `managerName`·`managerTel`은 읽지 않는다.
- 화면 문구(그대로):
  - 설명: `기업마당·중기부 지원사업은 IT 관련 공고만, 과기정통부 R&D 신규 공모는 모두 보입니다. SOL Score와 권고는 계산하지 않습니다.`
  - 마감 칸·신청 기간: `공고문 확인`
  - 서랍 안내: `이 출처는 제목·등록일·담당 부서만 제공합니다. 신청 기간과 사업 내용은 원문의 첨부 공고문에서 확인하세요.`
- 출처 배지는 기존 중립색 그대로(ADR-058). 탭 이름·대시보드는 바꾸지 않는다.
- 화면 확인 폭 360·390·768·1280·1440px. 페이지 가로 넘침 없음.
- 마이그레이션·ADR 번호는 쓰기 직전 `origin/main`에서 최대 번호를 다시 확인한다.
- 무거운 검증(`pnpm verify*`, Playwright, `next build`, `git commit`)은 `verify-slot.sh`로 감싼다. 훅·게이트를 끄지 않는다.
- 운영 변경(실호출, `db:push`, 원격 push, 회사 Worker 재생성)은 항목마다 사용자 승인 뒤에만 한다.
- 이 계획의 자리표시: `<worktree>` = `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices`, `<verify-slot.sh>` = 메모리 heavy-verify-slots에 적힌 슬롯 스크립트 경로(없으면 그 본문으로 이 세션 scratchpad에 만들고 `bash … sh -c 'exit 3'`으로 종료 코드를 확인한다).

## Review Focus

1. **키가 아직 동기화되지 않았거나 만료됨**: 포털은 JSON을 요청해도 HTTP 200으로 XML 오류(`SERVICE_KEY_IS_NOT_REGISTERED_ERROR`)를 준다. 과기정통부 회차만 `FAILED RESPONSE_SHAPE`, 기업마당은 그대로 `SUCCEEDED`, 로그에 키 없음. 시험: Task 3 `rejects a gateway XML error`, Task 4 `keeps bizinfo when msit returns the gateway XML error`.
2. **항목이 하나뿐인 응답**: `item`이 배열이 아니라 객체로 온다. 한 건으로 읽어야 한다. 시험: Task 3 `reads a single item object`.
3. **키 형태가 섞임**: Encoding 키(`%2B`)·Decoding 키(`+`)·깨진 퍼센트 열. 앞의 둘은 같은 요청 URL, 깨진 값은 그 출처만 건너뜀. 시험: Task 3 `decodeServiceKey`.
4. **원문 주소가 상대 경로이거나 http**: `https://www.msit.go.kr/...`로 맞추고, 다른 호스트면 버린다. 시험: Task 3 `normalizes viewUrl and drops foreign hosts`.
5. **제목의 HTML 참조**: `R&amp;D`가 `R&D`로 보여야 한다. 시험: Task 3 샘플 첫 항목.

## 계획에서 정한 것 (스펙에 없던 실행 결정)

- 작업은 worktree `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices`, 브랜치 `feat/msit-rnd-notices`(기준 `origin/main`)에서 한다. main 폴더에는 다른 세션의 미커밋 변경이 있다.
- 실호출은 녹음 스크립트(`scripts/recorded/record-program-notices.mjs`)를 과기정통부용으로 넓힌 뒤 사용자가 `!`로 1회 돌린다. 그래서 Task 1이 녹음기, Task 2가 실호출이다.
- 화면·랜딩은 운영 DB에 `msit` 행이 생긴 뒤에만 운영에 나가야 한다(스펙 §8). main push가 곧 Vercel 배포라서, 회사 Worker는 **기능 브랜치를 원격에 올린 커밋 해시**로 빌드하고 main 병합·push는 DB 확인 뒤에 한다.
- `fetchedCount`는 제외한 건수까지 센다(응답에서 읽은 수). `droppedCount`·상태는 제외 건수를 보지 않는다.
- `planOf`는 출처가 셋이 되므로 `if` 갈래 대신 출처별 빌더 표(`Record<ProgramNoticeSource, …>`)로 바꾼다.
- `scripts/check-env.mjs`에 새 키를 넣지 않는다(`BIZINFO_API_KEY`도 없다. Vercel에는 넣지 않는 키다).

## File Structure

| 파일 | 책임 | 작업 |
| --- | --- | --- |
| `scripts/recorded/program-notices-lib.mjs` | 녹음 URL·가림·형식·흔적 검사 | Task 1 |
| `scripts/recorded/record-program-notices.mjs` | 녹음 CLI | Task 1 |
| `scripts/recorded/program-notices-lib.test.mjs` | 새 시험 | Task 1 |
| `fixtures/recorded/program-notices/msit/api.<KST날짜>.masked.json` | 첫 실호출 녹음 | Task 2 |
| `web/server/program-notices/msit.ts` | 새: 요청 URL·키 디코딩·응답 해석 | Task 3 |
| `web/server/program-notices/msit.test.ts`, `test-data/msit-sample.json` | 새 시험·샘플 | Task 3 |
| `program-notice.model.ts`, `config.ts`, `http.ts`, `recording.ts`, `bizinfo.ts`(`ParseResult`), `index.ts` | 출처 목록·설정·허용 호스트·녹음 키 검사 | Task 3 |
| `infra/sources/program-notices.yaml` | `msit` 설정 | Task 3 |
| `web/server/program-notices/collect.service.ts` | 출처별 계획 표, 제외 건수 로그 | Task 4 |
| `web/worker/program-notices-only-main.ts` + 시험 | 회사 Worker 출처 계산·기동 줄 | Task 4 |
| `supabase/migrations/<번호>_program_notices_msit_source.sql`, `web/lib/database.types.ts`, `scripts/committed-integrations-db.test.mjs` | check 제약 | Task 5 |
| `web/server/program-notices/list.service.ts` + 시험 | IT 필터 면제 | Task 6 |
| `web/app/(app)/(work)/bids/programs/*` | 필터·문구·마감 칸·서랍 | Task 7 |
| `web/components/landing/showcase-data.ts`, `web/public/landing/sources/msit.*`, `web/e2e/landing-showcase.spec.ts` | 랜딩 로고 | Task 8 |
| `infra/compose.yaml`, `infra/env/company-worker.env.example`, `docs/*`, `infra/company/README.md` | env 전달·정본 | Task 9 |

---

### Task 1: 녹음기가 과기정통부를 받는다

**Files:**
- Modify: `scripts/recorded/program-notices-lib.mjs:15-28,70-80,205-222`
- Modify: `scripts/recorded/record-program-notices.mjs:37-64,75-85,109-121`
- Create: `scripts/recorded/program-notices-lib.test.mjs`
- Move: 스펙·이 계획을 worktree로 옮긴다

**Interfaces:**
- Produces: `MSIT_BASE_URL`, `msitParams({ maxItems }) → { pageNo, numOfRows, returnType }`, `msitRequestUrl(envValue: string, params) → string`(깨진 키면 `Error`), `maskJsonBody(raw) → { body, maskedFields }`(옛 `maskBizinfoBody` 이름 바꿈), `scanProgramLeaks(...).serviceKey`.

- [ ] **Step 1: worktree를 만들고 문서를 옮긴다**

```bash
git -C /Users/leegwanghui/dev/hackathon/sol-radar fetch origin
git -C /Users/leegwanghui/dev/hackathon/sol-radar worktree add -b feat/msit-rnd-notices /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices origin/main
pnpm -C /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices install
pnpm -C /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices/web install
```
`prepare`가 exit 1을 내도 설치는 된 것이다(메모리 worktree-pnpm-install-hooks). 이 세션이 만든 두 파일을 옮긴다: main 폴더 `polaris/specs/planned/2026-11-01-msit-rnd-notices.md` → worktree `polaris/specs/in-progress/`, `docs/plans/2026-11-01-msit-rnd-notices.md` → worktree 같은 경로. main 폴더 사본은 지운다.

- [ ] **Step 2: 실패하는 시험을 쓴다** (`scripts/recorded/program-notices-lib.test.mjs`)

```js
it("msitRequestUrl decodes the portal Encoding key once", () => {
  const url = new URL(msitRequestUrl("ab%2Bc%3D%3D", msitParams({ maxItems: 50 })));
  assert.equal(url.hostname, "apis.data.go.kr");
  assert.equal(url.searchParams.get("ServiceKey"), "ab+c==");
  assert.match(url.search, /ServiceKey=ab%2Bc%3D%3D(&|$)/);
  assert.equal(url.searchParams.get("numOfRows"), "50");
  assert.equal(url.searchParams.get("returnType"), "json");
  assert.equal(isAllowedProgramUrl(url.toString()), true);
  assert.throws(() => msitRequestUrl("%E0%A4%A", msitParams({ maxItems: 50 })));
});
it("maskJsonBody hides MSIT manager name and phone", () => {
  const raw = JSON.stringify({ items: [{ subject: "공모", managerName: "홍길동", managerTel: "044-202-4321" }] });
  const { body, maskedFields } = maskJsonBody(raw);
  assert.doesNotMatch(body, /홍길동|044-202-4321/);
  assert.deepEqual(maskedFields, ["managerName", "managerTel"]);
});
it("recording shape and leak scan reject a ServiceKey", () => {
  assert.throws(() => assertProgramRecordingShape({ ...validRecording, source: "msit", params: { ServiceKey: "x" } }), /인증키/);
  assert.equal(scanProgramLeaks("a?ServiceKey=zzz").serviceKey, 1);
});
```
`validRecording`은 `buildProgramRecording`으로 만든 정상 녹음이다.

- [ ] **Step 3: 실패를 확인한다**

Run: `node --test scripts/recorded/program-notices-lib.test.mjs`(worktree, Bash timeout 60000)
Expected: FAIL — `msitRequestUrl`·`maskJsonBody` export 없음.

- [ ] **Step 4: 라이브러리와 CLI를 고친다**
  - lib: `PROGRAM_NOTICE_HOSTS`에 `"apis.data.go.kr"`, `MSIT_BASE_URL`, `FILE_STEMS.msit = "api"`, `CONTACT_FIELDS`에 `managerName`·`managerTel`, `KEY_PARAM`을 `KEY_PARAMS = ["crtfckey", "servicekey"]`로, `scanProgramLeaks`에 `serviceKey: count(/servicekey/gi)`, `maskBizinfoBody` → `maskJsonBody`.
  - CLI: `--source msit` 허용, `MSIT_SETTINGS = { maxItems: 50 }`(YAML 기본값과 같다고 주석). `planRequest("msit")`은 `env.MSIT_ANNOUNCEMENT_API_KEY`가 비면 `StopRecording("MSIT_ANNOUNCEMENT_API_KEY 가 없다(값은 출력하지 않는다)")`, 깨진 키면 `"… 형식 오류(값은 출력하지 않는다)"`. `secrets`는 `secretForms(env 값) ∪ secretForms(디코딩 값)`. 가림은 `source === "mss" ? maskMssBody : maskJsonBody`. `itemCountOf("msit")`는 `"subject"` 키 개수. 요약에 `contentType`을 더한다. 머리 주석 사용법에 `--source msit` 한 줄.

- [ ] **Step 5: 통과를 확인한다**

Run: `node --test scripts/recorded/program-notices-lib.test.mjs` → PASS 3. 이어서 `pnpm record:program-notices -- --source msit --dry-run`(키 없는 셸) → `MSIT_ANNOUNCEMENT_API_KEY 가 없다` 로 exit 1.

- [ ] **Step 6: 커밋**

```bash
git -C <worktree> add polaris/specs/in-progress/2026-11-01-msit-rnd-notices.md docs/plans/2026-11-01-msit-rnd-notices.md scripts/recorded/program-notices-lib.mjs scripts/recorded/record-program-notices.mjs scripts/recorded/program-notices-lib.test.mjs
bash <verify-slot.sh> git -C <worktree> commit -m "feat: 과기정통부 공고 녹음 지원"
```

### Task 2: 실호출 1회로 응답 모양을 확인한다 (사용자 승인)

**Files:**
- Create: `fixtures/recorded/program-notices/msit/api.<KST YYYYMMDD>.masked.json`
- Modify: `scripts/recorded/README.md`("부처 공고 녹음" 절)

**Interfaces:**
- Produces: Task 3이 파서와 샘플에 쓰는 실제 응답 모양(봉투 경로, 정렬 순서, `pressDt` 형식, `viewUrl` 형식, 단건 모양).

- [ ] **Step 1: 승인을 받는다.** "data.go.kr 과기정통부 사업공고 1회 호출(무료, 50건)" 한 줄로 묻는다.
- [ ] **Step 2: 사용자가 실행한다**

```
! node --env-file=/Users/leegwanghui/dev/hackathon/sol-radar/infra/.env /Users/leegwanghui/dev/hackathon/sol-radar-worktrees/msit-rnd-notices/scripts/recorded/record-program-notices.mjs --source msit
```
Expected: 요약 JSON에 `httpStatus: 200`, `items` 50 안팎, `leaks` 전부 0, `file: fixtures/recorded/program-notices/msit/api.<날짜>.masked.json`.
`items: 0`이고 `contentType`이 XML이면 키 동기화 전이다(포털은 승인 뒤 반영까지 시간이 걸린다). 파일을 지우고 1시간 뒤 다시 부탁한다.

- [ ] **Step 3: 녹음을 읽고 다섯 가지를 적는다**: 봉투 경로, 최신 순인지(첫 항목 `pressDt`가 가장 늦은지), `pressDt` 형식, `viewUrl` 형식(절대·상대, http·https, `nttSeqNo` 위치), `fileName`·`fileUrl` 모양. README "부처 공고 녹음" 절에 녹음 시각·건수·sha256과 함께 남긴다.
- [ ] **Step 4: 갈림길**
  - 오래된 순이면 멈추고 사용자에게 알린다(스펙 §4: 요청 2번 구조 필요, 동결 전 반영 다시 판단).
  - 11-02 정오까지 녹음을 못 얻으면 Task 3에서 YAML `msit.enabled: false`로 두고 문서 예시 샘플로 진행한다(스펙 §8 "늦어질 때").
- [ ] **Step 5: 커밋** — 녹음 파일과 README. `git commit -m "test: 과기정통부 사업공고 첫 녹음"`.

### Task 3: 과기정통부 응답을 정규화 행으로 만든다

**Files:**
- Create: `web/server/program-notices/msit.ts`, `web/server/program-notices/msit.test.ts`, `web/server/program-notices/test-data/msit-sample.json`
- Modify: `program-notice.model.ts:9-15`, `config.ts:11-57,89-95`, `http.ts:9,96-100`, `recording.ts:13-22`, `bizinfo.ts:16-18`, `index.ts`
- Modify: `infra/sources/program-notices.yaml`

**Interfaces:**
- Consumes: Task 2의 응답 모양.
- Produces:
  - `PROGRAM_NOTICE_SOURCES = ["bizinfo", "mss", "msit"] as const`, `PROGRAM_NOTICE_SOURCE_LABELS.msit = "과기정통부"`
  - `MSIT_KEY_ENV = "MSIT_ANNOUNCEMENT_API_KEY"`, `type MsitConfig = { enabled: boolean; baseUrl: string; keyEnv: "MSIT_ANNOUNCEMENT_API_KEY"; maxItems: number }`, `ProgramNoticesConfig.msit: SourceConfig<MsitConfig>`
  - `decodeServiceKey(raw: string | undefined): string | null`(빈 값·깨진 퍼센트 열이면 `null`)
  - `buildMsitUrl(input: { baseUrl: string; key: string; maxItems: number }): string`(`key`는 디코딩 값)
  - `parseMsitBody(body: string, fetchedAt: string): ParseResult`
  - `ParseResult`의 성공 갈래에 `excluded?: number`

- [ ] **Step 1: 샘플을 만든다.** `test-data/msit-sample.json`은 Task 2 녹음과 같은 봉투 모양의 가상 4건이다.
  - 신규 공모 2건. 하나는 제목 `2026년도 미래개척융합과학기술개발사업(한계돌파 R&amp;D) 신규과제 공모`, `deptName` `원천기술과`, `viewUrl` `http://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=3186001`
  - 선정결과 1건
  - 선정계획 1건
  - 녹음이 없으면 문서 필드(`subject`, `viewUrl`, `deptName`, `pressDt`)로 `response.body.items.item` 모양을 쓴다.
- [ ] **Step 2: 실패하는 시험을 쓴다** (`msit.test.ts`)

```ts
it("normalizes MSIT items, excludes result notices and keeps selection plans", () => {
  const parsed = parseMsitBody(sample, FETCHED_AT);
  if (!parsed.ok) throw new Error("parse failed");
  expect(parsed.excluded).toBe(1);
  expect(parsed.dropped).toBe(0);
  const first = parsed.notices.find((n) => n.sourceNoticeId === "3186001");
  expect(first).toMatchObject({
    source: "msit",
    title: "2026년도 미래개척융합과학기술개발사업(한계돌파 R&D) 신규과제 공모",
    agency: "과학기술정보통신부 원천기술과",
    sourceUrl: "https://www.msit.go.kr/bbs/view.do?sCode=user&bbsSeqNo=100&nttSeqNo=3186001",
    applyEndOn: null, summary: null, tags: [], isDemo: false,
  });
  expect(first?.dedupeKey).toBe(dedupeKeyOf(first?.title ?? "", "과학기술정보통신부"));
  expect(parsed.notices.some((n) => n.title.includes("선정계획"))).toBe(true);
});
it("reads a single item object", ...);                        // item: {…} → notices.length 1
it("normalizes viewUrl and drops foreign hosts or missing nttSeqNo", ...); // 상대 경로 → https://www.msit.go.kr/…, evil.example → dropped, nttSeqNo 없음 → dropped
it("rejects a gateway XML error and a non-00 resultCode", ...); // XML 본문·resultCode "30" → { ok: false, errorCode: "RESPONSE_SHAPE" }
it("keeps a row whose pressDt is unreadable", ...);            // "미정" → publishedAt null, "2026.10.28" → "2026-10-27T15:00:00.000Z"
it("decodeServiceKey and buildMsitUrl send the key once-encoded", () => {
  expect(decodeServiceKey("a%2Bb%3D")).toBe("a+b=");
  expect(decodeServiceKey("a+b=")).toBe("a+b=");
  expect(decodeServiceKey("%E0%A4%A")).toBeNull();
  expect(decodeServiceKey("  ")).toBeNull();
  const url = buildMsitUrl({ baseUrl: MSIT_URL, key: "a+b=", maxItems: 50 });
  expect(url).toContain("ServiceKey=a%2Bb%3D&");
  expect(new URL(url).searchParams.get("numOfRows")).toBe("50");
});
it("loads msit from the committed YAML and rejects another host", async () => { ... }); // 저장소 YAML → config.msit.ok; 임시 YAML(baseUrl https://evil.example/x) → msit.ok false, bizinfo ok
```
녹음이 있으면 하나를 더한다: `parses the first live recording` — 녹음 `body` → `ok`, `dropped` 0, 모든 행 `source "msit"`·`sourceUrl`이 `https://www.msit.go.kr/`로 시작.

- [ ] **Step 3: 실패를 확인한다** — `pnpm -C web exec vitest run server/program-notices/msit.test.ts`(Bash timeout 60000) → FAIL(모듈 없음).
- [ ] **Step 4: 구현한다**
  - `msit.ts`: `MSIT_AGENCY = "과학기술정보통신부"`, `MSIT_SITE = { origin: "https://www.msit.go.kr", hosts: ["www.msit.go.kr"] }`, `MSIT_EXCLUDED_TITLE_WORDS`(Global Constraints 7개)
  - 항목 펼치기(`itemsOf`)는 Task 2에서 확인한 봉투를 받는다. 그 밖에 `item`이 배열·객체인 두 경우와 `items`가 `{item:{…}}` 배열인 경우를 받는다. 그 밖은 `null`이고 `RESPONSE_SHAPE`다.
  - `header.resultCode`가 있고 `"00"`이 아니면 `RESPONSE_SHAPE`다.
  - 제목은 `cleanText(subject, LIMITS.title)`로 다듬는다. 제외 단어 판정은 다듬은 제목으로 한다.
  - `pressDt`는 `YYYY.MM.DD`·`YYYYMMDD`를 `YYYY-MM-DD`로 바꾼 뒤 `parseKstDateTime`에 넘긴다. 시각이 붙은 형식은 그대로 넘긴다.
  - 행 검증은 `normalizedProgramNoticeSchema.safeParse`다(`bizinfo.ts` `toNotice`와 같은 모양).
  - `config.ts`: `msitSchema = z.strictObject({ enabled, baseUrl: httpsOn("apis.data.go.kr"), keyEnv: z.literal(MSIT_KEY_ENV), maxItems: z.number().int().min(1).max(99) })`, `loadProgramNoticesConfig`에 `msit: sourceConfig("msit", msitSchema, sources.msit)`. 머리 주석의 "두 소스"를 "세 소스"로.
  - `http.ts`: `PROGRAM_NOTICE_HOSTS`에 `"apis.data.go.kr"`. 키 쿼리 가림 정규식을 `/([?&](?:crtfcKey|ServiceKey)=)[^&#]*/gi`로.
  - `recording.ts`: 키 파라미터 검사를 `crtfckey`·`servicekey` 둘로.
  - `index.ts`: `parseMsitBody`, `decodeServiceKey`, `MSIT_KEY_ENV` export.
  - YAML `msit` 항목은 다음과 같다. 주석은 공공데이터포털 15074634 문서 주소, Encoding 키를 그대로 넣는다는 안내다.

```yaml
  msit:
    # 과학기술정보통신부 사업공고(공공데이터포털 15074634). 공고번호·신청기간은 응답에 없다.
    enabled: true   # Task 2 녹음을 못 얻었으면 false
    baseUrl: https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList
    keyEnv: MSIT_ANNOUNCEMENT_API_KEY
    maxItems: 50
```

- [ ] **Step 5: 통과를 확인한다** — 같은 명령 PASS. `pnpm -C web exec tsc --noEmit`이 `SOURCE_LABEL`(`programs-copy.ts:11`)에서 `msit` 누락으로 실패하면 이 Task에서 라벨 한 줄(`msit: "과기정통부"`)만 더한다(나머지 화면은 Task 7).
- [ ] **Step 6: 커밋** — `feat: 과기정통부 사업공고 응답 정규화`.

### Task 4: 회차와 회사 Worker가 과기정통부를 함께 돈다

**Files:**
- Modify: `web/server/program-notices/collect.service.ts:49-85,207-218`
- Modify: `web/worker/program-notices-only-main.ts:31-109,115-129`
- Test: `web/worker/program-notices-only-main.test.ts`

**Interfaces:**
- Consumes: Task 3의 `parseMsitBody`, `buildMsitUrl`, `decodeServiceKey`, `ProgramNoticesConfig.msit`.
- Produces: `SCHEDULED_SOURCES = ["bizinfo", "msit"]`, `ProgramNoticesPlan.sources: ProgramNoticeSource[]`, 로그 이벤트 `program_notices.excluded`.

- [ ] **Step 1: 실패하는 시험을 쓴다** (`program-notices-only-main.test.ts`)
  - 기존 `expect(SCHEDULED_SOURCES).toEqual(["bizinfo"])` → `["bizinfo", "msit"]`.
  - 기존 "retries a 5xx…" 시험의 `sources: SCHEDULED_SOURCES` → `sources: ["bizinfo"]`(그 시험은 기업마당 재시도만 본다).
  - 새 시험 셋:

```ts
it("--check skips MSIT without its key and includes it with the key, printing no key value", async () => {
  const without = await run(liveEnv);
  expect(without.codes).toEqual([0]);
  expect(without.out).toContain("과기정통부: MSIT_ANNOUNCEMENT_API_KEY 없음 또는 형식 오류, 건너뜀");
  const withKey = await run({ ...liveEnv, MSIT_ANNOUNCEMENT_API_KEY: "msit%2Bkey%3D" });
  expect(withKey.out).toContain("과기정통부: 최대 50건 · MSIT_ANNOUNCEMENT_API_KEY SET");
  expect(withKey.out).not.toMatch(/msit%2Bkey|msit\+key/);
});
it("saves MSIT notices as SUCCEEDED, logs the excluded count, and never logs the key", async () => {
  // fetch: apis.data.go.kr → msit-sample.json body, 그 밖 → 기업마당 녹음
  expect(runs.find((r) => r.source === "msit")).toMatchObject({ status: "SUCCEEDED", droppedCount: 0, fetchedCount: 4, savedCount: 3 });
  expect(logs.join("\n")).toContain('"event":"program_notices.excluded","source":"msit","excluded":1');
  expect([...logs, JSON.stringify(runs)].join("\n")).not.toMatch(/msit%2Bkey|msit\+key|msit%252Bkey/);
});
it("keeps bizinfo when msit returns the gateway XML error", async () => {
  // apis.data.go.kr → 200 "<OpenAPI_ServiceResponse>…SERVICE_KEY_IS_NOT_REGISTERED_ERROR…"
  expect(runs).toMatchObject([
    { source: "bizinfo", status: "SUCCEEDED" },
    { source: "msit", status: "FAILED", errorCode: "RESPONSE_SHAPE" },
  ]);
});
```
- [ ] **Step 2: 실패를 확인한다** — `pnpm -C web exec vitest run worker/program-notices-only-main.test.ts` → FAIL.
- [ ] **Step 3: 구현한다**
  - `collect.service.ts`: `planOf`를 `const PLAN_BUILDERS: Record<ProgramNoticeSource, (config: ProgramNoticesConfig) => SourcePlan | null>`로 바꾼다. `msit` 빌더의 `liveRequest`는 `decodeServiceKey(env[keyEnv])`가 `null`이면 `{ ok: false }`(→ `SKIPPED KEY_MISSING`)다. `secrets`는 `[env 원문, 디코딩 값, encodeURIComponent(디코딩 값)]`의 중복 제거다.
  - `collectSource`: `const { notices, dropped, excluded = 0 } = parsed.value`, `fetchedCount: notices.length + dropped + excluded`, `excluded > 0`이면 `deps.log(JSON.stringify({ event: "program_notices.excluded", source, excluded }))`. 상태 계산은 지금처럼 `dropped`만 본다.
  - Worker: `SCHEDULED_SOURCES = ["bizinfo", "msit"]`, 주석은 "2026-11-01 사용자 결정: 과기정통부 추가, 중기부는 계속 부르지 않는다"이다. 내부 함수 `msitPlanOf(config, env): { included: boolean; line: string }`가 네 경우의 줄을 만든다.
    - 포함: `과기정통부: 최대 ${maxItems}건 · ${keyEnv} SET`
    - 설정 오류: `과기정통부: ${reason}, 건너뜀`
    - 꺼짐: `과기정통부: 꺼짐(program-notices.yaml sources.msit.enabled), 건너뜀`
    - 키 없음·형식 오류: `과기정통부: MSIT_ANNOUNCEMENT_API_KEY 없음 또는 형식 오류, 건너뜀`
  - `readProgramNoticesPlan`은 기업마당 규칙(던짐)을 그대로 두고 `sources`·`lines`에 위 결과를 더한다. `runScheduledRound`는 `sources: plan.sources`. 머리 주석의 "소스는 기업마당 하나다"와 명령 설명의 "기업마당 요청 1회"를 고친다.
- [ ] **Step 4: 통과를 확인한다** — 같은 명령 PASS. `pnpm -C web exec vitest run worker/committed-features.test.ts`도 PASS(mock 재생에 msit 녹음이 있으면 msit도 SUCCEEDED, 없으면 SKIPPED).
- [ ] **Step 5: 커밋** — `feat(worker): 회사 부처 공고 회차에 과기정통부 추가`.

### Task 5: DB가 `msit` 출처를 받는다

**Files:**
- Create: `supabase/migrations/<번호>_program_notices_msit_source.sql`
- Modify: `web/lib/database.types.ts`(생성물), `scripts/committed-integrations-db.test.mjs:102-116`

- [ ] **Step 1: 실패하는 시험을 쓴다** — 기존 "public programs allow…" 시험 앞부분에 더한다.

```js
await db.query("insert into public.program_notices(source,source_notice_id,title,source_url,dedupe_key,fetched_at) values ('msit','3186001','신규과제 공모','https://www.msit.go.kr/bbs/view.do?nttSeqNo=3186001','program-2',now())");
await db.query("insert into public.program_notice_runs(source,run_mode,status) values ('msit','LIVE','SUCCEEDED')");
await assert.rejects(db.query("insert into public.program_notices(source,source_notice_id,title,source_url,dedupe_key,fetched_at) values ('ntis','1','x','https://www.ntis.go.kr/1','program-3',now())"), /program_notices_source_check/);
```
그 뒤 회원 조회 행 수 단언을 `1` → `2`로.
- [ ] **Step 2: 실패를 확인한다** — `node --test scripts/committed-integrations-db.test.mjs`(Bash timeout 120000) → FAIL(check 위반).
- [ ] **Step 3: 마이그레이션을 쓴다.** 번호는 `git -C <worktree> ls-tree --name-only origin/main supabase/migrations/ | tail -1`보다 크게 한다.

```sql
-- 과기정통부 사업공고(msit)를 부처 공고 출처에 더한다(스펙 2026-11-01-msit-rnd-notices §5).
alter table public.program_notices drop constraint program_notices_source_check;
alter table public.program_notices add constraint program_notices_source_check check (source in ('bizinfo', 'mss', 'msit'));
alter table public.program_notice_runs drop constraint program_notice_runs_source_check;
alter table public.program_notice_runs add constraint program_notice_runs_source_check check (source in ('bizinfo', 'mss', 'msit'));
```
- [ ] **Step 4: 통과를 확인한다** — 같은 명령 PASS. `pnpm db:types` 실행 후 `git diff --stat web/lib/database.types.ts`(check 제약만 바뀌어 차이가 없을 수 있다. 차이가 있으면 같은 커밋에 넣는다).
- [ ] **Step 5: 커밋** — `feat(db): 부처 공고 출처에 과기정통부 추가`.

### Task 6: 목록이 과기정통부 공고를 IT 필터 없이 보인다

**Files:**
- Modify: `web/server/program-notices/list.service.ts:9-16,202`
- Test: `web/server/program-notices/list.service.test.ts`

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
it("과기정통부 공고는 IT 단어가 없어도 보인다", async () => {
  const msit = { ...row("msit", "2026년도 국제공동연구 신속지원사업 신규과제 공모"), source: "msit" };
  expect(isItProgramNotice(msit)).toBe(false);
  const shown = await list([msit]);
  expect(shown.items.map((item) => item.id)).toEqual(["msit"]);
  expect(shown.hasAnyNotice).toBe(true);
});
it("과기정통부 쌍둥이가 기업마당에도 있으면 기업마당 행이 보인다", async () => {
  const biz = { ...row("biz", "국제공동연구 신속지원사업 공모"), dedupe_key: "twin" };
  const msit = { ...row("msit", "국제공동연구 신속지원사업 공모"), source: "msit", dedupe_key: "twin" };
  expect((await list([biz, msit])).items.map((item) => item.id)).toEqual(["biz"]);
});
it("출처 조건 msit 를 받는다", () => {
  expect(parseProgramNoticeListQuery({ source: "msit" })).toMatchObject({ ok: true, value: { source: "msit" } });
});
```
- [ ] **Step 2: 실패를 확인한다** — `pnpm -C web exec vitest run server/program-notices/list.service.test.ts` → 첫 두 시험 FAIL.
- [ ] **Step 3: 구현한다** — `:202`를 `stored.filter((row) => row.source === "msit" || isItProgramNotice(row))`로. 머리 주석에 "과기정통부 공고는 R&D 공모라 IT 필터를 거치지 않는다(2026-11-01 사용자 결정)" 한 줄.
- [ ] **Step 4: 통과를 확인한다** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat: 과기정통부 공고 IT 필터 면제`.

### Task 7: `/bids/programs`에 과기정통부 필터와 문구를 더한다

**Files:**
- Modify: `web/app/(app)/(work)/bids/programs/programs-copy.ts:7-14,19,35-45`
- Modify: `program-filters.tsx:22,33-37`, `program-format.ts:64-75`, `program-table.tsx:141-158`, `program-notice-drawer.tsx:90-92,141-144`
- Create: `web/app/(app)/(work)/bids/programs/program-format.test.ts`

**Interfaces:**
- Produces:
  - `CHECK_NOTICE_FILE = "공고문 확인"`
  - `noPeriodText(source: ProgramNoticeListItem["source"]): string`(msit면 `CHECK_NOTICE_FILE`, 아니면 `NO_PERIOD`)
  - `DRAWER_COPY.titleOnlyMsit`
  - `periodText(applyStartOn, applyEndOn, today, source)`(네 번째 인자 추가, 호출처는 서랍 하나)

- [ ] **Step 1: 실패하는 시험을 쓴다** (`program-format.test.ts`)

```ts
it("마감이 없는 과기정통부 공고는 공고문 확인으로 보인다", () => {
  expect(periodText(null, null, "2026-11-02", "msit")).toBe("공고문 확인");
  expect(periodText(null, null, "2026-11-02", "bizinfo")).toBe("기간 미표기");
});
it("화면 출처 이름은 서버 출처 이름과 같다", () => {
  expect(SOURCE_LABEL).toEqual(PROGRAM_NOTICE_SOURCE_LABELS);
});
```
- [ ] **Step 2: 실패를 확인한다** — `pnpm -C web exec vitest run "app/(app)/(work)/bids/programs/program-format.test.ts"` → FAIL.
- [ ] **Step 3: 구현한다**
  - `PROGRAMS_DESCRIPTION`·서랍 안내를 Global Constraints 문구로 바꾼다.
  - `SOURCE_ITEMS`에 `{ value: "msit", label: "과기정통부" }`를 더하고, 필터 머리 주석을 `source=bizinfo|mss|msit`로 고친다.
  - `DeadlineCell`이 `source`를 받아 `noPeriodText(source)`를 쓴다.
  - 서랍의 `titleOnly` 자리는 `item.source === "msit" ? DRAWER_COPY.titleOnlyMsit : DRAWER_COPY.titleOnly`다.
- [ ] **Step 4: 통과를 확인한다** — 같은 명령 PASS, `pnpm -C web exec tsc --noEmit` 통과.
- [ ] **Step 5: 화면을 직접 본다** (메모리 isolated-e2e-stacks)
  - 격리 Supabase를 띄우고 시험 계정을 넣는다.
  - 행을 넣는다: `msit` 3건(그중 하나는 `apply_end_on` null, 제목 R&D 공모), 같은 dedupe의 `bizinfo` 1건, IT 기업마당 1건.
  - 확인할 것: 출처 "과기정통부" 선택, 목록 마감 칸 "공고문 확인", 서랍 안내 문구, 원문 링크 `target="_blank" rel="noopener noreferrer"`, 360·390·768·1280·1440 폭 가로 넘침 없음.
  - 스크린샷은 `docs/evidence/program-notices/20261102-msit/`에 둔다. 끝나면 내가 띄운 스택만 내린다.
- [ ] **Step 6: 커밋** — `feat(web): 부처 지원사업 탭에 과기정통부 출처 추가`.

### Task 8: 랜딩 출처 띠에 과기정통부를 더한다

**Files:**
- Create: `web/public/landing/sources/msit.svg`(또는 `.png`)
- Modify: `web/components/landing/showcase-data.ts:59-93`, `web/e2e/landing-showcase.spec.ts:44-51`

- [ ] **Step 1: 시험을 먼저 고친다** — `toHaveLength(9)`·`toHaveCount(9)` 두 곳 → `10`. 주석 "9개(18개가 아니다)" → "10개(20개가 아니다)". `DATA_SOURCES`에서 `중소벤처기업부` 다음이 `과학기술정보통신부`인지 보는 단언 한 줄:

```ts
expect(DATA_SOURCES.map((s) => s.name).slice(5, 7)).toEqual(["중소벤처기업부", "과학기술정보통신부"]);
```
- [ ] **Step 2: 로고를 구한다**
  - 과기정통부 누리집 CI 안내(상징·로고 내려받기)의 공식 파일을 scratchpad의 빈 폴더에 내려받는다.
  - 마크와 국문 기관명이 함께 있는 시그니처형을 고른다. 그림은 바꾸지 않고 바깥 여백만 자른다.
  - CI 파일을 못 구하면 누리집 머리말 로고 파일을 그대로 쓴다.
  - 파일을 직접 열어 확인한 뒤 `web/public/landing/sources/msit.svg`(또는 png)로 둔다.
- [ ] **Step 3: 데이터를 고친다**
  - `{ name: "과학기술정보통신부", logo: { src: "/landing/sources/msit.svg", width: <파일 폭>, height: <파일 높이> } }`를 `중소벤처기업부` 다음에 넣는다.
  - 머리 주석 "9곳" → "10곳"으로 고치고, 로고 출처(CI 파일인지 머리말 로고인지)를 적는다.
  - `work-demo-data`의 `COLLECTED`는 데모 장면이라 고치지 않는다. 랜딩 부품에 출처 수를 적은 다른 문구는 없다(2026-11-01 `grep "9곳|9개|아홉" web/components/landing` 결과 이 주석 하나).
- [ ] **Step 4: 통과를 확인한다**
  - `bash <verify-slot.sh> pnpm -C web exec playwright test e2e/landing-showcase.spec.ts` → PASS.
  - 랜딩을 360·1440 폭으로 열어 로고 크기가 이웃 로고와 맞는지 본다. 스크린샷은 같은 증거 폴더에 둔다.
- [ ] **Step 5: 커밋** — `feat(web): 랜딩 출처에 과기정통부 추가`.

### Task 9: env 전달과 정본 문서

**Files:**
- Modify: `infra/compose.yaml:155-160`(로컬 worker env `MSIT_ANNOUNCEMENT_API_KEY: ${MSIT_ANNOUNCEMENT_API_KEY:-}`, 기업마당 줄 옆)
- Modify: `infra/env/company-worker.env.example:24-28`(`MSIT_ANNOUNCEMENT_API_KEY=` + "공공데이터포털 15074634, Encoding 키 그대로" 주석)
- Modify: `docs/16-DECISIONS.md`(새 ADR), `docs/07-DATA-PIPELINE.md` §1.3 출처 표, `docs/10-DEPLOYMENT.md:107-112`, `infra/company/README.md` §10, `docs/PROGRESS.md`

- [ ] **Step 1: 겹침을 확인한다** — main 폴더 `git status --short docs/16-DECISIONS.md docs/PROGRESS.md docs/07-DATA-PIPELINE.md docs/10-DEPLOYMENT.md`에 다른 세션의 미커밋 변경이 있으면 그 파일은 미루고 사용자에게 알린다. `git -C <worktree> fetch origin && git -C <worktree> rebase origin/main`.
- [ ] **Step 2: ADR을 쓴다.** 번호는 `origin/main`의 마지막 ADR + 1(11-01 기준 073 → 074)이다. 담을 것:
  - 과기정통부 직접 연결(2026-10-21 스펙 §2 결정 변경)
  - IT 필터 면제(ADR-069 예외)
  - 제외 단어 규칙
  - NTIS 보류 근거(공고 API 없음, robots `Disallow: /`, RSS 로그인)
  - IRIS 보류 근거(API 없음, 약관 미확인, 운영 기관 이관 중)
  - 상태는 "채택(2026-11-01 사용자 승인)"이다. 형식은 기존 ADR과 같게, frontmatter·위키링크 규약을 지킨다.
- [ ] **Step 3: 나머지 문서를 고친다.**
  - 07 §1.3: 출처 행 하나
  - 10-DEPLOYMENT: 회사 Worker env에 새 키, Vercel에는 넣지 않음
  - 회사 README §10: `--check`에 나오는 과기정통부 줄과 키 없을 때의 동작
  - PROGRESS: 기능 상태 행과 최근 작업 로그
- [ ] **Step 4: 검사** — `pnpm -C <worktree> format:check`(문서), `docker compose -f infra/compose.yaml config -q`.
- [ ] **Step 5: 커밋** — `docs: 과기정통부 사업공고 출처 정본 반영`.

### Task 10: 통합 검증

- [ ] **Step 1:** `bash <verify-slot.sh> pnpm -C <worktree> verify` → 마지막 줄 통과. 실패하면 원인을 고치고 다시 돌린다(게이트를 끄지 않는다).
- [ ] **Step 2:** `/predeploy-review`(code·infra·qa 프로필)로 변경을 본다. 짚은 결함을 고치고 해당 시험을 다시 돈다.
- [ ] **Step 3:** 키 흔적 검사 — `git -C <worktree> grep -nIi "servicekey=" -- fixtures` 결과가 0줄이어야 한다(녹음 params·본문에 키 파라미터 없음). 녹음 파일은 `scanProgramLeaks`가 이미 0을 확인했다.

## 운영 반영 (단계마다 사용자 승인, 스펙 §8)

| 순서 | 할 일 | 확인 |
| --- | --- | --- |
| O1 | 운영 DB 마이그레이션. `NODE_EXTRA_CA_CERTS=$HOME/.supabase/prod-ca-2021.crt bash scripts/db-push.sh --check` → 목록에 이번 파일 하나뿐인지 확인 → 적용 → `bash scripts/db-verify.sh` | `--check` 재실행에 미적용 0 |
| O2 | 기능 브랜치 push(`git -C <worktree> push -u origin feat/msit-rnd-notices`, Vercel은 미리보기만) → 회사 `sol-radar-app`에서 그 커밋 해시로 부처 공고 Worker 재생성 | 아래 세부 |
| O3 | main 병합 → 병합본 `pnpm verify` → main push(Vercel 운영 배포) | 배포 READY, 운영 `/bids/programs?source=msit` 390·1440 화면, 랜딩 로고 10개 |

O2 세부(실행서 `infra/company/README.md` §10, 메모리 company-server-ops):
- 정각+15분 ~ 다음 정각−30분 안에만 한다.
- 지금 Worker 이미지 태그와 `sol-radar-app` HEAD를 확인하고 `rollback-*` 태그를 남긴다.
- HEAD를 옮기기 전에 그 HEAD를 보는 예약 작업이 있는지 본다.
- `compose.company.yaml`의 회사 로컬 수정은 보존한다.
- main이 기능 브랜치 기준점 뒤로 움직였으면 다른 세션 변경이 섞이므로 사용자에게 먼저 묻는다.
- `--check` 출력에 `과기정통부: 최대 50건 · MSIT_ANNOUNCEMENT_API_KEY SET`이 나와야 한다.
- 다음 정각 회차 뒤 운영 DB를 읽어 확인한다.

```sql
select source, status, error_code, fetched_count, saved_count, dropped_count, started_at
from public.program_notice_runs where started_at > now() - interval '4 hours' order by started_at desc;
select count(*) from public.program_notices where source = 'msit';
```
`bizinfo`·`msit` 둘 다 `SUCCEEDED`이고 `msit` 행이 1건 이상이어야 O3로 간다. 증거는 `docs/evidence/program-notices/20261102-msit.md`에 남기고(키·URL 없이), 스펙을 `polaris/specs/done/`으로 옮긴다.

**늦어질 때**(스펙 §8): O2 확인이 11-03 동결까지 안 되면 O3를 발표 뒤로 미룬다. O1·O2는 `msit.enabled: false`면 아무 일도 하지 않으므로 그대로 둔다.
