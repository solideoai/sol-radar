---
title: "구현 계획 — 카카오톡 추천 공고 알림(나에게 보내기)"
doc: "plan-kakao-memo-notify"
status: draft
tags:
  - sol-radar
  - pipeline
  - ui
  - hackathon
created: 2026-10-20
updated: 2026-10-20
---

# 카카오톡 추천 공고 알림 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> [!warning] 착수 조건 (2026-10-20 조정 세션 sol-radar-12 전달)
> 이 계획은 **문서만** 있다. 아래 두 가지가 끝나기 전에는 Task 1부터 시작하지 않는다.
> 1. 사용자가 ADR-018 예외(카카오 REST 키·시크릿·토큰 암호화 키를 웹 서버·worker env에 둔다)를 승인한다.
> 2. Task 0(S0 실수신 시험)을 사용자가 마치고, 휴대폰 알림이 울린다는 결과가 `docs/evidence/kakao-notify/s0.md` 에 있다.
> 정본 반영(ADR 제안·13 등)은 이 계획 밖이다. 설계 §13 목록으로 정본 담당 세션과 맞춘다.

**Goal:** 개인 설정에서 켠 사용자에게, 사람이 요청한 분석에서 BID·WATCH 권고가 처음 나온 공고를 카카오톡 "나와의 채팅"으로 피드형 한 통씩 보낸다.

**Architecture:** `finish_score_run` 이 같은 트랜잭션에 outbox `BID_RECOMMENDED` 를 쓴다. worker의 알림 소비자가 그 이벤트를 켠 조직 구성원에게 펼쳐 `notifications`(channel `KAKAO`) 행을 만들고, 발송 port(`mock` 또는 `memo`)로 보낸다. 카카오 연결은 Supabase 로그인과 따로 하는 OAuth(`scope=talk_message`)이고, 토큰은 웹 서버가 암호화해 본인 행에 RPC로 저장하며 worker만 복호화한다.

**Tech Stack:** Next.js 16 Route Handler · Supabase Postgres(RLS·열 권한·security definer RPC) · `web/worker`(service role) · `node:crypto` AES-256-GCM · `fetch` · Vitest · PGlite(`scripts/database.test.mjs`) · Playwright(1440·1280 확인).

**Spec:** [설계 문서](2026-10-20-kakao-memo-notify-design.md) (`docs/kakao-notify-design` @ `2d29dbf`). 실행자는 설계와 이 계획을 함께 읽는다.

**작업 폴더:** `/Users/leegwanghui/dev/hackathon/sol-radar-worktrees/kakao-notify` (브랜치 `docs/kakao-notify-design`. 구현 착수 때 `feat/kakao-notify` 로 새 브랜치를 그 시점 main 위에 만들고 이 두 문서를 가져간다). 착수 전에 루트·`web` 에서 각각 `pnpm install`(worktree 의 `prepare` exit 1 은 무시) — 그래야 `.husky/_` 가 생겨 커밋 게이트가 돈다.

## Global Constraints

- 새 패키지를 설치하지 않는다. 카카오 호출은 `fetch`, 암호화는 `node:crypto`.
- 카카오 API: 발송 `POST https://kapi.kakao.com/v2/api/talk/memo/default/send`(헤더 `Authorization: Bearer <access>`, `Content-Type: application/x-www-form-urlencoded;charset=utf-8`, 본문 `template_object`), 성공 `{"result_code":0}`. 인가 `GET https://kauth.kakao.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope=talk_message`. 토큰·갱신 `POST https://kauth.kakao.com/oauth/token`(`grant_type=authorization_code|refresh_token`, `client_id`, `client_secret`, `redirect_uri`, `code`|`refresh_token`). 새 `refresh_token` 은 응답에 있을 때만 바꾼다.
- 카카오 `unlink` 를 부르지 않는다.
- 피드 한도: 제목+설명 4줄, `item` 6자, `item_op` 25자(2줄), `buttons` 2개, `content` 에 `title` 필수로 둔다(이미지 없음).
- 발송 대상: `score_runs.requested_by` 가 있는 run만. `recommendation ∈ {BID, WATCH}`, `status ∈ {COMPLETED, PARTIAL}`. outbox 키 `<orgId>:<bidId>:BID_RECOMMENDED`.
- 알림 행 키: KAKAO `<outboxEventId>:<userId>:KAKAO`, 만료 인앱 `<outboxEventId>:<userId>:KAKAO_EXPIRED:IN_APP`, 시험 outbox `<userId>:<YYYY-MM-DDTHH:MI>:KAKAO_TEST`(UTC 분).
- 결과가 불분명한 실패(요청을 보낸 뒤 시간 초과)는 다시 보내지 않고 `DEAD`(`error` = `TIMEOUT_UNKNOWN`). 분명한 실패(연결 실패·5xx·429)는 기존 간격 5·10·20·40초, 5번째 실패면 `DEAD`.
- 한 사용자에게 1초에 1통을 넘지 않는다.
- env 이름: 웹 서버 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`(base64 32바이트)·`KAKAO_REDIRECT_URI`·`SITE_URL`(이미 있음). worker `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`NOTIFY_KAKAO_PROVIDER`(`mock` 기본 | `memo`)·`SITE_URL`. `NEXT_PUBLIC_` 금지. 오류·로그에는 키 이름만 싣고 값은 싣지 않는다.
- 로그·오류에 토큰·메시지 본문·공고명·카카오 사용자 ID를 싣지 않는다(기존 `notify.outbox` 한 줄 모양 유지).
- 카톡에 AI 서술(`score_runs.explanation`, Qwen 출력)을 싣지 않는다. 사유 줄은 `qualification_checks` 에서만 만든다.
- 문구(고정): 설정 설명 "추천 공고(BID·WATCH 권고)가 나오면 내 카톡 '나와의 채팅'으로 받습니다." · 연결 전 "카카오 계정을 먼저 연결해야 켤 수 있습니다. 연결할 때 카카오 화면에서 '카카오톡 메시지 전송' 동의를 한 번 묻습니다." · 만료 "카카오 연결이 만료되어 보내지 못하고 있습니다. 앱 안 알림으로도 알려 드립니다." · 만료 인앱 "카카오 연결이 만료되어 카카오톡 알림을 보내지 못하고 있습니다. 설정에서 다시 연결해 주세요." · 동의 거부 "메시지 전송에 동의해야 켤 수 있습니다." · 버튼 "카카오톡 알림 연결"·"시험 메시지 보내기"·"다시 연결"·"연결 해제".
- 마이그레이션은 새 파일로만. 번호는 착수 날 main 과 열린 브랜치의 마지막 번호(2026-10-20 기준 `20261019000019`) 뒤. 아래에서는 `20261021000001`·`20261021000002` 로 적는다. 마이그레이션과 `web/lib/database.types.ts`(`pnpm db:types`)는 같은 커밋.
- 서버 파일은 `import "server-only";` 로 시작, 도메인은 배럴(`@/server/<도메인>`)로만, `../` 대신 `@/`.
- 색은 `design/tokens.json` 만. 노란 버튼은 `bg-kakao text-kakao-foreground`.
- 화면 확인은 1440·1280. 무거운 검증(`pnpm verify`·e2e·build)은 사용자 환경의 검증 슬롯 스크립트로 감싼다.

## Review Focus

1. **한 사용자가 두 조직의 구성원이고 두 조직 모두 같은 공고에 BID가 나온 경우** → 같은 공고는 한 사람에게 한 통만 간다(설계 목표 2). Task 4에 `hasKakaoSentForBid` 시험.
2. **이벤트가 생긴 뒤 보내기 전에 사용자가 끄거나 연결을 해제한 경우** → 보내지 않는다(받는 사람을 보낼 때 다시 고른다). Task 4 시험.
3. **사용자가 카카오 앱에서 직접 연결을 끊었거나 동의를 철회한 경우**(갱신이 `invalid_grant`, 발송이 토큰 오류) → `EXPIRED` 로 바꾸고 만료 인앱 1건, 그 행은 `DEAD`. Task 3·4 시험.
4. **공고명이 아주 길거나, 발주처·마감·추정금액이 없거나, 마감이 이미 지난 경우** → 잘린 제목(…), `미공개`·`미정`·`마감 지남` 으로 채우고 던지지 않는다. Task 2 시험.
5. **카카오 동의 화면에서 거부하고 돌아온 경우(`error=access_denied`) 또는 `state` 가 맞지 않는 경우** → 저장하지 않고 설정 화면에 안내 문구. Task 6 시험.

---

### Task 0: S0 실수신 시험 (코드 없음, 사용자 진행)

**Files:**
- Create: `docs/evidence/kakao-notify/s0.md`

- [ ] **Step 1: 사용자가 카카오 앱을 준비한다** — 카카오 디벨로퍼스에서 앱 생성 → 카카오 로그인 활성화 → 동의항목 "카카오톡 메시지 전송" 선택 동의 → Redirect URI `http://localhost:3000/api/v1/me/kakao-notify/callback` → 플랫폼 웹 도메인 `http://localhost:3000`(+ 나라장터 원문 도메인 등록 시도) → 클라이언트 시크릿 발급.
- [ ] **Step 2: 사용자가 브라우저로 인가 → 토큰 → 발송을 한 번 한다** — 실행자는 명령 예시(인가 URL, 토큰 교환 `curl`, 피드 B형 `template_object` 를 넣은 발송 `curl`)를 저장소 밖 임시 파일로 사용자에게 건넨다. 키·토큰 값은 실행자가 보거나 저장하지 않는다.
- [ ] **Step 3: 결과를 적는다** — `s0.md` 에 날짜, 확인 4가지(휴대폰 알림 울림 예/아니오, `talk_message` 검수 없이 동작 예/아니오, `item_content` 표가 시안처럼 보임 예/아니오 + 스크린샷, 원문 도메인 등록 가능 예/아니오).
- [ ] **Step 4: 판정** — 알림이 울리지 않으면 여기서 멈추고 사용자에게 계속 여부를 묻는다. 원문 도메인 등록이 안 되면 Task 2의 `sourceUrl` 버튼 규칙을 "상세의 원문 자리" 쪽으로 쓴다.
- [ ] **Step 5: Commit** — `git add docs/evidence/kakao-notify/s0.md && git commit -m "docs: 카카오 나에게 보내기 S0 시험 결과"`

### Task 1: DB — 연결 표·RPC·이벤트 종류·`finish_score_run`

**Files:**
- Create: `supabase/migrations/20261021000001_kakao_notify_links.sql`
- Create: `supabase/migrations/20261021000002_bid_recommended_outbox.sql`
- Modify: `web/lib/database.types.ts`(생성물, `pnpm db:types`)
- Test: `scripts/database.test.mjs` (새 `describe("카카오톡 알림 연결 — kakao_notify_links")`, `describe("추천 공고 outbox — BID_RECOMMENDED")`)

**Interfaces:**
- Produces:
  - 표 `public.kakao_notify_links(user_id uuid pk → profiles(id) on delete cascade, enabled boolean not null default false, status text not null check in ('CONNECTED','EXPIRED'), access_token_enc text, refresh_token_enc text, access_expires_at timestamptz, refresh_expires_at timestamptz, last_sent_at timestamptz, last_result text check in ('SENT','FAILED','EXPIRED'), created_at, updated_at)`. RLS 켬. `authenticated`: select 정책 `user_id = auth.uid()`, 열 권한 `select (user_id, enabled, status, last_sent_at, last_result, updated_at)` 만. insert·update·delete 권한 없음. `anon` 권한 없음. `service_role` 전부.
  - RPC(전부 `security definer`, `search_path = ''`, `authenticated` 만 execute, `auth.uid()` null이면 `raise exception 'UNAUTHENTICATED'`):
    - `save_kakao_notify_link(p_access_token_enc text, p_refresh_token_enc text, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz) returns void` — 본인 행 upsert, `status='CONNECTED'`, `enabled=true`.
    - `set_kakao_notify_enabled(p_enabled boolean) returns void` — 켜기는 행이 있고 `CONNECTED` 일 때만, 아니면 `raise exception 'KAKAO_NOT_CONNECTED'`. 끄기는 행이 있으면 늘 된다.
    - `disconnect_kakao_notify() returns void` — 본인 행 delete.
    - `request_kakao_notify_test() returns boolean` — 본인 행이 `CONNECTED` 이고 `enabled` 가 아니면 `raise exception 'KAKAO_NOT_READY'`. outbox `KAKAO_TEST`(`org_id` null, `aggregate_type` `'kakao_notify_link'`, `aggregate_id` = uid, payload `{"userId": uid}`, 키 = 위 Global) insert, 같은 키면 false.
  - check 고침: `outbox_events_event_type_check` += `BID_RECOMMENDED`·`KAKAO_TEST`, `notifications_type_check` += `BID_RECOMMENDED`·`KAKAO_EXPIRED`. 부분 인덱스 `outbox_events_notify_due_idx` 를 drop·create 해 조건 이벤트 종류에 `BID_RECOMMENDED`·`KAKAO_TEST` 를 더한다.
  - `finish_score_run(p)` create or replace: `20261019000016` 본문 + 마감 뒤 `requested_by is not null and v_next.recommendation in ('BID','WATCH')` 이면 outbox `BID_RECOMMENDED`(`aggregate_type` `'score_run'`, payload `{scoreRunId, bidId, orgId, recommendation, status}`, 키 `<orgId>:<bidId>:BID_RECOMMENDED`, `on conflict do nothing`). 권한 줄은 `20261019000016` 2절과 같다.

- [ ] **Step 1: Write the failing tests** — `kakao_notify_links`: ① 본인은 자기 행의 허용 열만 읽고 `access_token_enc` select 는 permission denied ② 남의 행은 0행 ③ anon 은 표·RPC 모두 거부 ④ `set_kakao_notify_enabled(true)` 는 행 없으면 `KAKAO_NOT_CONNECTED` ⑤ `save_…` 뒤 `enabled=true,status='CONNECTED'` ⑥ `disconnect_…` 뒤 0행 ⑦ `request_kakao_notify_test()` 같은 분에 두 번 → true, false 이고 outbox 1행 ⑧ authenticated 가 `update kakao_notify_links` 직접 시도하면 거부. `BID_RECOMMENDED`: ⑨ requested run 이 BID 로 마감 → outbox 1행(키·payload 위 값) ⑩ 같은 공고를 다시 분석해 WATCH → 여전히 1행 ⑪ `requested_by` null(사전 분석) → 0행 ⑫ NO_BID → 0행 ⑬ 부분 인덱스 조건에 새 종류가 있음(기존 C7 인덱스 시험 모양).
- [ ] **Step 2: 실패 확인** — Run: `pnpm test:db` · Expected: 새 시험이 표·함수 없음으로 FAIL.
- [ ] **Step 3: 두 마이그레이션 작성** — 위 Produces 그대로. 파일 머리 주석은 기존 마이그레이션처럼 근거·담은 것·되돌리기를 적는다.
- [ ] **Step 4: 통과 확인** — Run: `pnpm test:db && pnpm db:types && pnpm check:db-types` · Expected: 전부 PASS, 생성물 갱신.
- [ ] **Step 5: Commit** — `git add supabase/migrations/20261021000001_kakao_notify_links.sql supabase/migrations/20261021000002_bid_recommended_outbox.sql web/lib/database.types.ts scripts/database.test.mjs && git commit -m "feat(db): 카카오 알림 연결 표와 추천 공고 outbox"`

### Task 2: 카카오 도메인 순수 규칙 — 토큰 암호화·피드·사유 줄·화면 상태

**Files:**
- Create: `web/server/kakao-notify/kakao-token.crypto.ts`, `web/server/kakao-notify/feed.model.ts`, `web/server/kakao-notify/kakao-notify.model.ts`, `web/server/kakao-notify/index.ts`
- Test: `web/server/kakao-notify/kakao-token.crypto.test.ts`, `feed.model.test.ts`, `kakao-notify.model.test.ts`

**Interfaces:**
- Produces:
  - `encryptKakaoToken(plain: string, keyBase64: string): string` · `decryptKakaoToken(sealed: string, keyBase64: string): string`. 모양 `v1.<iv>.<tag>.<ciphertext>`(각 base64url, iv 12바이트). 키가 32바이트가 아니면 `Error("KAKAO_TOKEN_ENC_KEY 형식 오류")`, 변조·다른 키면 `Error("KAKAO_TOKEN_DECRYPT_FAILED")`(값 없음).
  - `type QualificationSummaryInput = { mandatory: boolean; outcome: "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW" | "NOT_APPLICABLE" }[]`
  - `toReasonLine(checks: QualificationSummaryInput): string` — 필수 항목 중 `NEEDS_REVIEW` 가 n>0 이면 `확인 필요 n건`, 아니고 `NOT_SATISFIED` 가 m>0 이면 `필수 자격 미충족 m건`, 필수가 모두 `SATISFIED`·`NOT_APPLICABLE` 이면 `필수 자격 충족`, 필수가 0개면 `필수 자격 없음`.
  - `type BidFeedInput = { bidId: string; title: string; agency: string | null; deadlineAt: Date | null; budgetKrw: number | null; score: number | null; recommendation: "BID" | "WATCH"; status: "COMPLETED" | "PARTIAL"; reason: string; sourceUrl: string | null; siteUrl: string; now: Date }`
  - `type KakaoFeedTemplate = { object_type: "feed"; content: { title: string; description: string; link: KakaoLink }; item_content: { items: { item: string; item_op: string }[] }; buttons: { title: string; link: KakaoLink }[] }`, `type KakaoLink = { web_url: string; mobile_web_url: string }`
  - `toBidFeedTemplate(input: BidFeedInput): KakaoFeedTemplate` · `toTestFeedTemplate(siteUrl: string): KakaoFeedTemplate`
  - `type KakaoNotifyRow = { enabled: boolean; status: "CONNECTED" | "EXPIRED"; last_sent_at: string | null; last_result: "SENT" | "FAILED" | "EXPIRED" | null }`
  - `type KakaoNotifyView = { state: "DISCONNECTED" | "OFF" | "ON" | "EXPIRED"; lastSentAt: string | null; lastResult: KakaoNotifyRow["last_result"] }` · `toKakaoNotifyView(row: KakaoNotifyRow | null): KakaoNotifyView` (null→DISCONNECTED, EXPIRED→EXPIRED, CONNECTED+enabled→ON, CONNECTED+!enabled→OFF)

- [ ] **Step 1: Write the failing tests** — 암호: 왕복이 원문과 같다, 같은 원문 두 번 암호화 결과가 다르다, 한 글자 바꾸면 `KAKAO_TOKEN_DECRYPT_FAILED`, 16바이트 키는 형식 오류. 피드(`now` = `2026-10-20T05:14:00Z`): BID·COMPLETED·`deadlineAt` `2026-10-30T09:00:00Z`·`budgetKrw` 1240000000·score 78 → `content.title` = 공고명, `description` = `BID 권고 · 필수 자격 충족`, items = `[발주처/가상시청, 마감/10-30(금) 18:00 · D-10, 추정금액/12.4억, 점수/78]`, buttons = `[분석 보기 → <siteUrl>/bids/<bidId>, 공고 원문 → sourceUrl]`. PARTIAL → description 끝에 ` · AI 없이 규칙만으로 분석`. agency·budget·score null → `미공개`, deadline null → `미정`, 지난 마감 → `<날짜> · 마감 지남`. 제목 120자 → 40자 + `…`(설명과 합쳐 4줄 안). `sourceUrl` null → 둘째 버튼 `공고 원문 → <siteUrl>/bids/<bidId>#source`. 모든 `item` ≤ 6자, `item_op` ≤ 25자. 금액 1억 미만은 `n,nnn만 원`. 사유 줄 4가지 분기. 화면 상태 4가지.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/kakao-notify` · Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 위 시그니처. 날짜·요일은 `Asia/Seoul`, D-n 은 서울 날짜 차이. 금액은 1억 이상 `x.x억`(소수 한 자리, 반올림).
- [ ] **Step 4: 통과 확인** — Run: 같은 명령 · Expected: PASS.
- [ ] **Step 5: Commit** — `git add web/server/kakao-notify && git commit -m "feat: 카카오 알림 피드·토큰 암호화 규칙"`

### Task 3: 카카오 API 클라이언트와 발송 port

**Files:**
- Create: `web/server/kakao-notify/kakao-api.ts`, `web/server/kakao-notify/kakao-sender.ts`, `web/server/kakao-notify/kakao-link.repo.ts`(`createKakaoLinkStore(client)`: service role 클라이언트로 `kakao_notify_links` 를 읽고 쓰는 `KakaoLinkStore` 구현, worker 전용)
- Modify: `web/server/kakao-notify/index.ts`
- Test: `web/server/kakao-notify/kakao-api.test.ts`, `kakao-sender.test.ts`, `kakao-link.repo.test.ts`(`markExpired` 가 CONNECTED 일 때만 true)

**Interfaces:**
- Consumes: Task 2 `KakaoFeedTemplate`, `encryptKakaoToken`, `decryptKakaoToken`.
- Produces:
  - `type KakaoTokenSet = { accessToken: string; refreshToken: string | null; accessExpiresAt: Date; refreshExpiresAt: Date | null; scopes: string[] }`
  - `type KakaoSendResult = { kind: "SENT" } | { kind: "TOKEN_INVALID" } | { kind: "RETRYABLE"; code: string } | { kind: "UNKNOWN_OUTCOME" } | { kind: "REJECTED"; code: string }`
  - `createKakaoApi(deps: { fetch: typeof fetch; restApiKey: string; clientSecret: string; timeoutMs: number; now: () => Date }): KakaoApi`
  - `type KakaoApi = { authorizeUrl(input: { redirectUri: string; state: string }): string; exchangeCode(input: { code: string; redirectUri: string }): Promise<KakaoTokenSet>; refresh(refreshToken: string): Promise<KakaoTokenSet | "INVALID_GRANT">; sendMemo(accessToken: string, template: KakaoFeedTemplate): Promise<KakaoSendResult> }`
  - `type StoredKakaoLink = { userId: string; accessTokenEnc: string; refreshTokenEnc: string | null; accessExpiresAt: Date; refreshExpiresAt: Date | null; status: "CONNECTED" | "EXPIRED" }`
  - `type KakaoLinkStore = { read(userId: string): Promise<StoredKakaoLink | null>; saveTokens(userId: string, sealed: { accessTokenEnc: string; refreshTokenEnc: string | null; accessExpiresAt: Date; refreshExpiresAt: Date | null }): Promise<void>; markExpired(userId: string): Promise<boolean /* CONNECTED→EXPIRED 로 바꿨으면 true */>; markResult(userId: string, result: "SENT" | "FAILED" | "EXPIRED", at: Date): Promise<void> }`
  - `type KakaoSender = { send(userId: string, template: KakaoFeedTemplate): Promise<KakaoSendResult | { kind: "EXPIRED"; changed: boolean }> }`
  - `createMockKakaoSender(deps: { links: KakaoLinkStore; now: () => Date }): KakaoSender`(늘 SENT, 외부 호출 0) · `createMemoKakaoSender(deps: { api: KakaoApi; links: KakaoLinkStore; encKey: string; now: () => Date; sleep: (ms: number) => Promise<void> }): KakaoSender`
  - 두 sender 모두 `send` 끝에 `links.markResult(userId, SENT|FAILED|EXPIRED, now)` 를 부른다(설정 칸의 "마지막 발송" 줄). UNKNOWN_OUTCOME·RETRYABLE·REJECTED 는 `FAILED` 로 적는다.

- [ ] **Step 1: Write the failing tests** — `kakao-api`(가짜 fetch): 발송 요청의 URL·헤더·`template_object` 직렬화, `result_code 0` → SENT, 401 → TOKEN_INVALID, 5xx·429 → RETRYABLE, fetch 가 연결 전에 던지면 RETRYABLE(`NETWORK`), 요청 뒤 `timeoutMs` 초과(AbortSignal) → UNKNOWN_OUTCOME, 400 → REJECTED. 토큰 교환 응답의 `expires_in`·`refresh_token_expires_in`·`scope` 를 `KakaoTokenSet` 으로, 갱신 응답에 `refresh_token` 이 없으면 `refreshToken: null`, `invalid_grant` → `"INVALID_GRANT"`. `authorizeUrl` 에 `scope=talk_message`·`state`. 오류 객체 message 에 토큰·응답 본문 없음. `memo sender`: 액세스 만료 5분 전이면 먼저 갱신하고 새 토큰을 암호화해 `saveTokens`; TOKEN_INVALID 면 한 번 갱신 뒤 한 번 재발송; 갱신이 INVALID_GRANT 면 `markExpired` 하고 `{kind:"EXPIRED", changed}`; 같은 사용자 연속 두 통이면 두 번째 전에 `sleep(≥1000-경과)`; 링크가 없거나 `EXPIRED` 면 `{kind:"EXPIRED", changed:false}`.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/kakao-notify` · Expected: 새 시험 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처. 시간 초과는 `AbortSignal.timeout(timeoutMs)`, 응답 헤더를 받기 전 abort 는 UNKNOWN_OUTCOME, DNS·연결 실패(`TypeError`, abort 아님)는 RETRYABLE. 기본 `timeoutMs` 는 worker 설정이 정한다(Task 5, 5000).
- [ ] **Step 4: 통과 확인** — 같은 명령 · PASS.
- [ ] **Step 5: Commit** — `git add web/server/kakao-notify && git commit -m "feat: 카카오 나에게 보내기 클라이언트"`

### Task 4: 알림 소비자 — `BID_RECOMMENDED` 펼치기·`KAKAO_TEST`·만료 인앱

**Files:**
- Create: `web/server/notifications/kakao.model.ts`, `web/server/notifications/kakao.service.ts`, `web/server/notifications/kakao.repo.ts`
- Modify: `web/server/notifications/outbox.model.ts`(`NOTIFY_EVENT_TYPES` 에 `BID_RECOMMENDED`·`KAKAO_TEST`. `NotificationRow.type` 은 `"REVIEW_ASSIGNED" | "ANALYSIS_COMPLETE" | "KAKAO_EXPIRED"` 로 넓힌다. `toNotificationIntent` 는 두 새 종을 받지 않는다), `web/server/notifications/outbox.service.ts`(`processEvent` 가 `toNotificationIntent` 전에 두 새 종을 `processKakaoEvent` 로 넘김, `OutboxBatchDeps` 에 `kakao: { store: KakaoOutboxStore; sender: KakaoSender; siteUrl: string }` 추가), `web/server/notifications/index.ts`
- Test: `web/server/notifications/kakao.model.test.ts`, `kakao.service.test.ts`, `kakao.repo.test.ts`, 기존 `outbox.service.test.ts`(두 종이 넘어가는지)

**Interfaces:**
- Consumes: Task 2 `toBidFeedTemplate`·`toTestFeedTemplate`·`toReasonLine`, Task 3 `KakaoSender`·`KakaoSendResult`.
- Produces:
  - `toKakaoEvent(event: OutboxEventRow): { kind: "RECOMMENDED"; orgId: string; bidId: string; scoreRunId: string; recommendation: "BID" | "WATCH"; status: "COMPLETED" | "PARTIAL" } | { kind: "TEST"; userId: string } | { kind: "INVALID" }` — `org_id` 와 payload `orgId` 가 다르면 INVALID.
  - `toKakaoNotificationRow(input: { outboxEventId: string; orgId: string; userId: string; bidId: string; title: string }): { org_id; user_id; type: "BID_RECOMMENDED"; channel: "KAKAO"; status: "PENDING"; idempotency_key: string; payload: NotificationPayload }`(link `/bids/<bidId>`, message `"<BID|WATCH> 권고"`)
  - `toKakaoExpiredRow(input: { outboxEventId: string; orgId: string; userId: string; bidId: string; title: string; now: Date }): NotificationRow`(type `KAKAO_EXPIRED`, channel `IN_APP`, status `SENT`, link `/settings`, message = Global 만료 인앱 문구)
  - `type KakaoOutboxStore = { listRecipients(orgId: string): Promise<string[]> /* 켬·CONNECTED·active·그 조직 멤버 */; readFeedSource(scoreRunId: string): Promise<{ title; agency; deadlineAt; budgetKrw; score; sourceUrl; checks: QualificationSummaryInput } | null>; hasKakaoSentForBid(userId: string, bidId: string): Promise<boolean>; ensureKakaoRow(row): Promise<{ id: string; status: "PENDING" | "SENT" | "FAILED" | "DEAD" }>; setKakaoRowStatus(id: string, status: "SENT" | "FAILED" | "DEAD", error: string | null, at: Date): Promise<void>; insertNotification(row: NotificationRow): Promise<void> }`
  - `processKakaoEvent(deps: { store: KakaoOutboxStore; sender: KakaoSender; siteUrl: string; now: () => Date }, event: OutboxEventRow): Promise<{ outcome: "SENT" | "SKIPPED_NO_RECIPIENT" | "SKIPPED_NO_BID" | "RETRY" | "DEAD"; sent: number; failed: number }>`
- 규칙: 받는 사람은 보낼 때 다시 고른다. 사람마다 `hasKakaoSentForBid` 가 true 면 건너뛴다. 행이 `SENT`·`DEAD` 면 건너뛴다. 결과 → SENT: 행 `SENT` · RETRYABLE: 행 `FAILED`, 이벤트는 재시도 · UNKNOWN_OUTCOME: 행 `DEAD`(`TIMEOUT_UNKNOWN`) · REJECTED: 행 `DEAD`(code) · EXPIRED(changed=true): 행 `DEAD`(`KAKAO_EXPIRED`) + `toKakaoExpiredRow` 1건 · EXPIRED(changed=false): 행 `DEAD`. 남은 `FAILED` 가 하나라도 있으면 이벤트는 기존 `toRetryUpdate`, 이벤트가 DEAD 가 되면 남은 행도 `DEAD`. `KAKAO_TEST` 는 행 없이 `sender.send` 만 하고(결과 기록은 sender 몫, Task 3) PROCESSED.

- [ ] **Step 1: Write the failing tests** — Review Focus 1~3 각각, 두 단계 멱등(같은 이벤트 두 번 처리 → 발송 1회), 셋 중 둘째가 RETRYABLE → 첫째 SENT 유지·둘째 FAILED·이벤트 FAILED, 다음 회차에 둘째만 발송, UNKNOWN_OUTCOME 은 다음 회차에 재발송 없음, 사전 분석 이벤트는 애초에 없으므로 생략, 받는 사람 0명 → SKIPPED_NO_RECIPIENT 로 PROCESSED, 공고 없음 → SKIPPED_NO_BID, 로그 줄에 수신자·공고명 없음, `KAKAO_TEST` 는 notifications 행 0. 기존 `outbox.service.test.ts` 의 IN_APP 두 종 시험은 그대로 통과.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/notifications` · Expected: 새 시험 FAIL, 기존 PASS.
- [ ] **Step 3: 구현** — 위 시그니처. `kakao.repo.ts` 는 `outbox.repo.ts` 처럼 service role 클라이언트를 받고 `NotificationStoreError` 를 던진다. `listRecipients` 는 `memberships` ⋈ `kakao_notify_links`(enabled, CONNECTED) ⋈ `profiles`(active).
- [ ] **Step 4: 통과 확인** — 같은 명령 · PASS.
- [ ] **Step 5: Commit** — `git add web/server/notifications && git commit -m "feat: 추천 공고 카카오 알림 펼치기"`

### Task 5: worker 연결과 env

**Files:**
- Modify: `web/worker/notify-outbox.ts`(`readKakaoSettings` 추가, `NotifierDeps` 에 `kakao` 를 받아 `processOutboxBatch` 로 넘김), `web/worker/main.ts`(`notifyWorkerRegistration` 이 kakao store·sender 를 만들어 넘김), `.env.example`, `infra/env/demo.env.example`, `infra/compose.yaml`(worker 에 새 env 전달이 필요하면)
- Test: `web/worker/notify-outbox.test.ts`, `web/worker/main.test.ts`

**Interfaces:**
- Consumes: Task 3 `createMockKakaoSender`·`createMemoKakaoSender`·`createKakaoApi`, Task 4 `processKakaoEvent`.
- Produces: `readKakaoSettings(env): { provider: "mock"; siteUrl: string } | { provider: "memo"; restApiKey: string; clientSecret: string; encKey: string; siteUrl: string; timeoutMs: 5000 }` — `NOTIFY_KAKAO_PROVIDER` 비면 `mock`(이때 `SITE_URL` 이 비면 `http://localhost:3000`), `mock`·`memo` 밖이면 `Error("worker env 오류: NOTIFY_KAKAO_PROVIDER")`, `memo` 인데 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`SITE_URL` 중 하나라도 비면 `Error("worker env 누락: <키 이름들>")`. `readNotifySettings` 는 그대로 두고 `notifyWorkerRegistration` 이 두 설정을 함께 읽는다.

- [ ] **Step 1: Write the failing tests** — 빈 값 → mock, `memo`+키 누락 → 이름만 담긴 오류(값 없음), 잘못된 값 → 오류, mock 이면 fetch 호출 0.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run worker/notify-outbox worker/main` · FAIL.
- [ ] **Step 3: 구현** — 위 시그니처. env 예시에는 주석 처리한 키 이름만 적고 값은 비운다.
- [ ] **Step 4: 통과 확인** — 같은 명령 · PASS. `node scripts/check-policy.mjs --staged`(스테이징 뒤) 통과.
- [ ] **Step 5: Commit** — `git add web/worker/notify-outbox.ts web/worker/main.ts web/worker/notify-outbox.test.ts web/worker/main.test.ts .env.example infra/env/demo.env.example && git commit -m "feat(worker): 카카오 발송 수단 env 연결"` (compose 를 고쳤으면 함께)

### Task 6: 카카오 연결 Route Handler

**Files:**
- Create: `web/server/kakao-notify/oauth-state.ts`, `web/server/kakao-notify/kakao-notify.repo.ts`, `web/server/kakao-notify/kakao-notify.service.ts`, `web/app/api/v1/me/kakao-notify/route.ts`, `web/app/api/v1/me/kakao-notify/connect/route.ts`, `web/app/api/v1/me/kakao-notify/callback/route.ts`, `web/app/api/v1/me/kakao-notify/test/route.ts`
- Modify: `web/server/kakao-notify/index.ts`
- Test: `web/server/kakao-notify/oauth-state.test.ts`, `kakao-notify.service.test.ts`, `web/app/api/v1/me/kakao-notify/route.test.ts`(`me/employment/route.test.ts` 모양)

**Interfaces:**
- Consumes: Task 1 RPC 넷, Task 2 `encryptKakaoToken`·`toKakaoNotifyView`, Task 3 `createKakaoApi`.
- Produces:
  - `createOAuthState(input: { userId: string; now: Date; secret: string }): string` · `verifyOAuthState(input: { state: string; userId: string; now: Date; secret: string }): boolean` — HMAC-SHA256, 수명 10분, 쿠키 `kakao_notify_state`(HttpOnly·SameSite=Lax·운영 Secure·Path `/api/v1/me/kakao-notify`). secret 은 `KAKAO_TOKEN_ENC_KEY` 에서 HKDF(`info` `"kakao-oauth-state"`)로 뽑는다.
  - 서비스: `getMyKakaoNotify(): Promise<KakaoNotifyView>` · `startKakaoConnect(): Promise<{ redirectTo: string; stateCookie: string }>` · `completeKakaoConnect(params: URLSearchParams, stateCookie: string | undefined): Promise<KakaoConnectOutcome>` · `setMyKakaoNotifyEnabled(enabled: boolean)` · `disconnectMyKakaoNotify()` · `requestMyKakaoNotifyTest(): Promise<"QUEUED" | "THROTTLED">`
  - `type KakaoConnectOutcome = "connected" | "consent_denied" | "state_mismatch" | "failed"` — 콜백은 `/settings?kakao=<outcome>` 으로 보낸다. 설정 화면이 이 값을 읽는다(Task 7).
  - 경로: GET `/me/kakao-notify` → `KakaoNotifyView` · PATCH `{enabled:boolean}`(zod) → 204, 연결 전 409 `KAKAO_NOT_CONNECTED` · DELETE → 204 · GET `/connect` → 302 카카오 + state 쿠키 · GET `/callback` → 302 `/settings?kakao=…` + 쿠키 지움 · POST `/test` → 202 또는 429 `KAKAO_TEST_THROTTLED`, 연결·켬 아님 409 `KAKAO_NOT_READY`. 모두 `requireUser`(상태 변경은 `X-Requested-With: sol-radar`).

- [ ] **Step 1: Write the failing tests** — Review Focus 5(거부·state 불일치·쿠키 없음 → 저장 RPC 호출 0, outcome 값), 토큰 응답 `scope` 에 `talk_message` 없음 → `consent_denied`, 정상 → `save_kakao_notify_link` 에 암호문(평문 아님)이 넘어감, 남의 userId 로 만든 state 는 거부, 10분 지난 state 거부, PATCH 헤더 없음 → 403 `CSRF_REJECTED`, 비로그인 401, `/test` 같은 분 두 번 → 202·429.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web exec vitest run server/kakao-notify app/api/v1/me/kakao-notify` · FAIL.
- [ ] **Step 3: 구현** — 위 시그니처. Route Handler 작성 전에 `web/node_modules/next/dist/docs/` 의 Route Handler·cookies 안내를 읽는다(Next.js 16).
- [ ] **Step 4: 통과 확인** — 같은 명령 · PASS.
- [ ] **Step 5: Commit** — `git add web/server/kakao-notify web/app/api/v1/me/kakao-notify && git commit -m "feat: 카카오톡 알림 연결 API"`

### Task 7: 화면 — 설정 칸과 인앱 목록 필터

**Files:**
- Create: `web/app/(app)/[slug]/settings/kakao-notify-section.tsx`, `web/app/(app)/[slug]/settings/kakao-notify-section.browser.test.tsx`
- Modify: `design/tokens.json`(`$comment` 의 kakao 문장에 "카카오톡 알림 연결 버튼" 용도를 더한다) + 생성물 `web/app/globals.css`(`pnpm tokens`, 같은 커밋), `web/app/account/account-settings.tsx`(로그인 수단 절 바로 아래에 `SettingsSection id="settings-kakao-notify" title="카카오톡 알림"`, `loadAccountSettings` 가 `getMyKakaoNotify()` 도 읽음, `kakao` 검색 값을 받음), `web/app/(app)/[slug]/settings/page.tsx`(`searchParams.kakao` 전달), `web/server/bids/notification.model.ts`(zod type enum += `BID_RECOMMENDED`·`KAKAO_EXPIRED`), `web/server/bids/notification.supabase.ts`(list 에 `.eq("channel", "IN_APP")`), `web/server/bids/dashboard.supabase.ts`(안 읽음 수에 같은 조건)
- Test: 위 browser 시험, 기존 `web/server/bids/*` 시험에 channel 조건 단언 추가

**Interfaces:**
- Consumes: Task 2 `KakaoNotifyView`, Task 6 경로·`KakaoConnectOutcome`.
- Produces: `KakaoNotifySection(props: { view: KakaoNotifyView; outcome: KakaoConnectOutcome | null })` — 상태 4개는 설계 §9·Global 문구 그대로. 스위치는 `components/ui` 의 기존 스위치 부품(없으면 checkbox 기반 기존 패턴), 연결 버튼은 `<a href="/api/v1/me/kakao-notify/connect">`(GET 이동).

- [ ] **Step 1: Write the failing tests** — 상태별 렌더(DISCONNECTED: 스위치 disabled + 연결 버튼, OFF: 스위치 꺼짐 + 연결 해제, ON: 마지막 발송 줄 + 시험 버튼, EXPIRED: 경고 + 다시 연결), 스위치 토글이 PATCH 를 `X-Requested-With: sol-radar` 로 부름, outcome 문구 4종. 서버: 목록·안 읽음 수가 `channel=IN_APP` 만, `KAKAO_EXPIRED` 행이 목록 스키마를 통과.
- [ ] **Step 2: 실패 확인** — Run: `pnpm -C web test:browser -- kakao-notify-section && pnpm -C web exec vitest run server/bids` · FAIL.
- [ ] **Step 3: 구현** — 위 Produces. 마지막 발송 시각은 서울 시각 `MM-DD HH:mm`.
- [ ] **Step 4: 통과·화면 확인** — 같은 명령 PASS. `pnpm -C web dev` 로 1440·1280 두 폭에서 네 상태를 스크린샷(`docs/evidence/kakao-notify/settings-1440-*.png`·`settings-1280-*.png`).
- [ ] **Step 5: Commit** — `git add` 위 파일들 + 스크린샷 · `git commit -m "feat(web): 개인 설정에 카카오톡 알림 칸 추가"`

### Task 8: 전체 검증과 실발송 녹화

**Files:**
- Create: `docs/evidence/kakao-notify/live-send.md`(+ 녹화 파일 경로)

- [ ] **Step 1: 전체 검증** — Run: 검증 슬롯 스크립트로 감싼 `pnpm verify` · Expected: 공통·web 모두 통과.
- [ ] **Step 2: mock 끝까지** — 격리 스택(`NOTIFY_KAKAO_PROVIDER=mock`)에서 FX-02 라이브 분석 → `notifications` 에 KAKAO `SENT` 1행, 다시 분석해도 1행. 쿼리 결과를 `live-send.md` 에.
- [ ] **Step 3: 실발송 (사용자 승인 뒤)** — 사용자가 env 를 `memo` 로 바꾸고 키를 넣은 뒤 FX-02 라이브 분석 → 사용자 휴대폰 수신을 녹화. 실행자는 키 값을 보지 않는다.
- [ ] **Step 4: 독립 검증 요청** — `security-auditor`(토큰·열 권한·state·로그), `test-server`(시험이 정말 실패할 수 있는지 변형 확인)에 넘기고 결과를 받는다.
- [ ] **Step 5: Commit** — `git add docs/evidence/kakao-notify && git commit -m "docs: 카카오 알림 검증 증거"`. 병합은 병합 게이트 세션 절차로 한다(main 직접 병합 금지).

## 계획 밖 (다른 세션)

- 정본 반영: ADR-038(제안). 제안 단계는 16의 행·상세·미결정 5번만(설계 부록 A 문구, 정본 6-1 끝 커밋 위 새 브랜치). 본문은 ADR-038·ADR-018 예외 채택 뒤 정본 담당 세션이 설계 §13 표대로 반영한다.
- `docs/PROGRESS.md` 작업 로그는 정본 담당 세션이 쓴다.
- 19 데모 시나리오의 녹화 장면 추가.

## 관련 문서

- [설계 문서](2026-10-20-kakao-memo-notify-design.md)
- [[16-DECISIONS|16 ADR]] (ADR-038 제안, ADR-006·018)
- [[13-NOTIFICATIONS|13 알림]]
- [[04-DATABASE|04 DB]]
- [[05-API-SPEC|05 API]]
- [[06-UI-UX|06 UI]]
- [[09-SECURITY|09 보안]]
- [[11-TESTING|11 테스트]]
