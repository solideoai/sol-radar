---
title: "10-25 격리 E2E 결과(integration/freeze-1024 1차 @17c55609, 2차 @15c966c6, 3차 @466d2911, 4차 integration/release-1025 @04b4bf3a)"
status: done
tags: [sol-radar, evidence, e2e, integration]
updated: 2026-10-25
---

# 10-25 격리 E2E 결과(integration/freeze-1024 1차 @17c55609, 2차 @15c966c6, 3차 @466d2911, 4차 integration/release-1025 @04b4bf3a)

근거는 `docs/plans/2026-10-25-integration-finish-plan.md` T3 이고, 40 이 배정했다. 스택은 [[20261025-e2e/stack|stack.md]]에 있다.

## 결론

> [!note] 10-25 2차
> 15c966c6 + 테스트 전용 compose override 로 다시 돌려 18/18 통과했다. 아래 "10-25 2차" 절을 본다. 이 절부터 "화면 직접 확인"까지는 1차(17c55609) 기록이다.

> [!note] 10-25 4차(최종)
> 통합 커밋 04b4bf3a(integration/release-1025)에서 E2E 18/18 통과, 새 화면(DEMO 배지·수집 지표·live 0건·기관 라벨·원문 링크)과 사진 상한 직접 확인도 통과했다. 실패 0. 아래 "10-25 4차(통합 04b4bf3a)" 절을 본다.

- 실패 9건(읽기 6, 쓰기 3)의 원인은 하나다.
  - 모두 상단바 AI 지표 `AI: 확인 중` 단언에서 멈췄다.
  - 다른 원인의 실패는 없다.
  - 실패한 시험은 그 단언 뒤의 단계를 돌지 않았다. 아래 "돌지 않은 단계"에 적었고, 읽기 단계는 화면에서 직접 확인했다.
- 원인은 격리 환경 설정이다. 앱 결함이 아니다.
  - worker 가 Redis(`sol-radar:dependency-health`)에 올린 보고의 `scope.supabaseUrl` 은 `http://host.docker.internal:56321` 이다.
  - 웹 env 는 `http://127.0.0.1:56321` 이다.
  - 웹은 scope 문자열이 다르면 보고를 버린다(`web/server/health`). 그래서 `/health/ready` 가 503 을 낸다(`db ok, redis ok, storage unavailable, ai unavailable`).
  - 호스트에서 `host.docker.internal` 이 풀리지 않아 웹 주소를 맞추지 못했다.
  - 가드(`isSameLocalSupabase`)와 시험은 고치지 않았다.
- 화면 직접 확인은 전부 통과했다. 1440·1280 가로 넘침은 모두 0px 이다. 5xx 응답은 `/health/ready` 503 하나뿐이다.

## E2E

결과 줄 원문: `e2e-results.txt`.

|실행|통과|실패|돌지 않음|
|---|---|---|---|
|1차 전체 `test:e2e:work`|5|6|7(work-write 전부. 읽기 실패로 의존성이 막았다)|
|2차 `--project work-write --no-deps`|4|3|0|

globalSetup 은 두 번 모두 통과했다: `demo:reset`(seed 줄 일치) → mock 확인 → worker 주소 확인 → `preanalyze 18/18`.

### 실패 목록(원인 하나: 상단바 AI 지표가 "확인 중")

|시험|폭|멈춘 자리|그 전까지 통과한 것|
|---|---|---|---|
|bid-isolation G5|1440·1280|`shot()`(work-fixtures.ts:134)|상세 200, 제목, "아직 분석하지 않았습니다", 94 안 보임|
|demo-badge G8|1440·1280|`shot()`(work-fixtures.ts:134)|목록 19행 DEMO, 상단바 DEMO 툴팁|
|run-mode-badge V2-02|1440·1280|run-mode-badge.spec.ts:15 `AI: mock`|`/dashboard` 실행 모드 mock|
|bid-decision S4(FX-02)|1440|`shotBothWidths`(spec:112)|분석 실행 202, 대기·분석 중 상태|
|p1-navigation|1440|`capture`(spec:35)|관심 추가 200, 관심 공고 화면 1행|
|what-if FX-03|1440|`evidenceShot`(spec:141)|정보통신공사업 가정 NO-BID→WATCH, 레일 NO-BID 68 유지|

통과: work-guard, no-evidence G4(1440·1280), run-mode-badge `origin=all`(1440·1280), 취소 공고 S3, FX-01 흐름(94 근거·WATCH 결정·이력), S7 org-02 자격 404, profile-photo(가입 신청 → 사진 → 승인 → 조직도 → 관리자 사진 변경).

### 돌지 않은 단계

- 읽기(아래 화면 확인에서 직접 봤다)
  - G5: axe, 자격 API 404, 상세 API 조직 칸 null, 분석 목록 빈 값, org-01 분석 id 404, 인력 시뮬레이션 빈 값
  - G8: axe, FX-01 제목 위 DEMO 배지와 툴팁
  - V2-02: 나머지 화면의 실행 모드, 분석 띠. 상단바 AI 지표는 같은 원인으로 "확인 중"이라 확인하지 못했다.
- 쓰기(직접 확인하지 않았다. `/etc/hosts` 를 고친 뒤 다시 돌려야 한다)
  - bid-decision S4: 완료 72·분해·사람 검토 권장, WATCH 결정 기록·이력, 저장 실패 상태
  - p1-navigation: 관심 해제, 분석 4건 비교, 프로젝트 저장, 인력 조회
  - what-if: 새로 고침하면 가정이 사라지는 단계

## 화면 직접 확인(localhost:3210, 같은 빌드)

원자료는 `screens/screen-check.json`, 스크린샷은 `screens/01~31`이다. 스크립트는 scratchpad `rh1025/screen-check.mjs` 다(저장소 밖).

|확인|1440|1280|
|---|---|---|
|ADMIN `/people` 직원 추가 → 검색 1행|통과(02)|대화상자 넘침 0px(12)|
|ADMIN 부서 이동 → 행의 팀 바뀜|통과(03)|행 메뉴 넘침 0px(13)|
|ADMIN 퇴사 처리 → 새로 고침 뒤 목록 0행|통과(04)|—|
|SALES `/people` 직원 추가 버튼|0(20)|0(25)|
|SALES 행 "관리" 메뉴|0. 화면 전체 " 관리" 버튼 1개는 행 밖이다(ADMIN 21 = 20행 + 1)|같음|
|SALES 서랍 사진 버튼|0(21)|0(26)|
|SALES `/settings/organization` 승인 버튼|0(22)|0(27)|
|`/org-chart` 펼친 팀 사진|14/14 로드(05)|14/14 로드(14)|
|ADMIN 서랍에서 직원 사진 변경|통과, 서명 URL `profile-photos/members/`(06)|사진 버튼 1(15)|
|`/settings` 내 사진 올리기|통과, 서명 URL `profile-photos/users/`(07)|넘침 0px(16)|
|`/settings/organization` 승인 표|가입 신청 구역 있음, 대기 0행(08). 승인 흐름은 profile-photo E2E 가 통과|넘침 0px(17)|
|FX-01 상세 SOL Score|목록 94, 레일 "94점 / 100점"(09)|같음(18)|
|FX-03 상세 SOL Score|목록 68, 레일 "68점 / 100점 (참고)"(10)|같음(19)|
|G8 목록 DEMO 19/19행, 상단바 툴팁, axe 위반 0|통과(23)|통과(28)|
|G8 FX-01 제목 위 DEMO·툴팁|통과|통과|
|V2-02 상단바 실행 모드 mock(4화면)|통과. AI 지표는 "확인 중"(24)|같음(29)|
|V2-02 FX-01 분석 띠: 실행 모드 mock·가상 프로필·AI mock|통과|통과|
|G5 org-02 VIEWER FX-01 상세: 200, 미분석, 94 안 보임, axe 0|통과(30)|통과(31)|
|G5 자격 API|404 `NOT_FOUND` `resource: analysis`|같음|
|G5 상세 API|200, latestAnalysis·latestReview null, reviews []|같음|
|G5 분석 목록 / org-01 분석 id / 인력 시뮬레이션|200 items [] / 404 / 200 빈 후보|1440 만(E2E 와 같다)|

가로 넘침은 위 모든 화면에서 0px 이다. `/people`·대화상자·행 메뉴·서랍·`/org-chart`·`/settings`·`/settings/organization`·FX-01·FX-03 을 1440·1280 두 폭에서 쟀다.

## 알려 둘 점

- 상세 화면을 처음 그리는 0.5초 안에는 `main#main-content` 가 둘이다. 하나는 숨어 있고, 스트리밍이 끝나면 하나만 남는다. 6초 동안 쟀다.
  - 결함은 아니다. 다만 그 사이에 엄격 locator 를 쓰면 두 개가 걸린다.
- E2E 가 저장소 증거 파일을 덮었다. worktree 에 수정으로 남아 있다(`docs/evidence/profile-photo/e2e/*.png` 8개, `docs/evidence/phase-3/axe-report.json`). 커밋하지 않았다.
- 화면 확인 뒤 기준선을 되돌렸다. 결과: `seed: … people=200 portraits=200 bids=19 …`, `preanalyze: targets=18 completed=18`. 시험 직원 0명, 직원 사진 경로 0건이다.
- 회사 서버와 운영 DB 는 건드리지 않았다.
  - 기본 `sol-radar-stack` 의 worker 는 5일 전부터 멈춰 있어 `compose exec` 대상이 될 수 없다.
  - 모든 compose 호출에 `COMPOSE_PROJECT_NAME=sol-radar-rh1025` 를 붙였다.

## 10-25 2차

40 이 재배정했다. 사용자 결정은 "호스트 `/etc/hosts` 에 전역 설정을 넣지 않고 테스트 전용 설정으로 푼다"이다.
대상은 `integration/freeze-1024` @15c966c6 이다(보안 수정 0e956774 포함).

### 조사: 이름 해석이 어디서 실패하나

|자리|`host.docker.internal`|`127.0.0.1:56321`|
|---|---|---|
|호스트 웹(Node) 프로세스|실패. `dns.lookup` → `ENOTFOUND`, `dscacheutil` 결과 없음|`/auth/v1/health` 200|
|호스트 브라우저(Playwright Chromium)|실패. `net::ERR_NAME_NOT_RESOLVED`|`goto` 200|
|worker 컨테이너 안|성공. Docker DNS `127.0.0.11` → `192.168.65.254`(Docker Desktop 호스트 게이트웨이). `/auth/v1/health` 200(GoTrue)|해당 없음. 1차 때 worker 의 loopback 에는 아무것도 없었다|

- 웹 Node 와 브라우저 둘 다 그 이름을 풀지 못한다.
  - 웹 env 를 `host.docker.internal` 로 바꾸면 서버 렌더링(Node)과 브라우저의 Supabase 호출이 둘 다 끊긴다.
  - `NEXT_PUBLIC_*` 는 빌드 때 번들에 들어가 브라우저도 같은 값을 쓴다.
- `host.docker.internal:56321` 이 가리켜야 할 서비스는 호스트에 열린 이 격리 스택의 Supabase Kong 이다.
  - Docker 호스트 56321 을 여는 컨테이너는 `supabase_kong_sol-radar-rh1025`(`0.0.0.0:56321->8000/tcp`) 하나뿐이다.
  - 같은 자료인지도 확인했다. rh1025 DB 에서 `score_runs` 첫 행 id 를 읽었다. 같은 id 를 worker 안에서 `host.docker.internal:56321/rest/v1/score_runs?id=eq.<id>` 로 조회하니 200 에 같은 행 1건이었다.
- 네트워크
  - worker 는 `sol-radar-rh1025_default`(192.168.0.5)에 있다.
  - Kong 은 `supabase_network_sol-radar-rh1025`(172.31.0.3)에 있다. 두 네트워크는 붙어 있지 않다.
  - worker 가 Supabase 에 닿는 실제 경로: worker → Docker DNS → `host.docker.internal`=192.168.65.254 → Docker 호스트 56321 → Kong 8000.
- scope 는 문자열 완전 일치로 비교한다.
  - 웹: `web/server/health/health.service.ts:22` `supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "")`
  - worker: `web/worker/main.ts:576` 이 같은 식으로 자기 env 값을 보고에 싣는다.
  - 비교: `web/server/health/dependency-report.ts:34-38` 이 `report.scope[key] !== expected` 이면 보고를 버린다(`null`).
  - 그래서 두 프로세스의 `NEXT_PUBLIC_SUPABASE_URL` 문자열이 같아야 한다. 같은 곳을 가리켜도 호스트 이름이 다르면 버린다.

### 해결: 후보 A(테스트 전용 compose override + TCP 전달 사이드카)

- 고른 이유
  - 웹 Node 와 브라우저 둘 다 그 이름을 풀지 못한다.
  - 후보 B(브라우저 `--host-resolver-rules`)는 브라우저만 고친다. 웹 Node 의 이름 해석까지 바꾸려면 런타임 DNS 후킹이 더 필요하다.
  - A 는 컨테이너 쪽만 바꾸고, 호스트 프로세스는 `supabase status` 가 알려 주는 `API_URL`(`http://127.0.0.1:56321`)을 그대로 쓴다.
- 왜 loopback 이 맞나
  1. scope 비교가 문자열 일치를 요구한다(위 줄 번호).
  2. 호스트 쪽 두 프로세스가 풀 수 있는 주소는 `127.0.0.1:56321` 뿐이다.
  3. worker 안의 `127.0.0.1:56321` 은 socat 이 Docker 호스트 56321(이 스택의 Kong, 위에서 확인)로 넘긴다. 그래서 같은 문자열이 같은 서비스를 가리킨다.
  4. 전달 뒤 worker env URL 로 같은 행 조회를 다시 했고, 200 에 같은 행이었다.
  5. 가드 `isSameLocalSupabase` 는 loopback·같은 포트일 때 같다고 본다. 이번에는 실제로도 같은 Supabase 다.
- 파일(저장소 밖): `/private/tmp/claude-501/-Users-leegwanghui-dev-hackathon-sol-radar/38f54940-3c25-4e22-a954-b7ae0a540d49/scratchpad/rh1025/compose.rh1025-forward.yaml`
  - `worker.environment.NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:56321`
  - `supabase-forward`: `alpine/socat@sha256:603174b7…0287`(socat 1.8.1.3), `network_mode: "service:worker"`, `TCP-LISTEN:56321,fork,reuseaddr,bind=127.0.0.1` → `TCP:host.docker.internal:56321`
  - `extra_hosts` 는 넣지 않았다. 사이드카는 worker 의 네트워크 이름공간과 Docker DNS 를 함께 써서 이미 이름을 푼다. Docker 는 다른 컨테이너의 네트워크를 쓰는 컨테이너에 `extra_hosts` 를 허용하지 않는다.
- 적용 결과
  - worker env 는 `http://127.0.0.1:56321` 이다.
  - Redis 보고는 `scope.supabaseUrl: http://127.0.0.1:56321`, `storage: ok`, `ai: mock` 이다.
- 바꾸지 않은 것: 앱 코드, 가드, 시험 단언, `infra/compose.yaml`·`compose.company.yaml`, 기본 `sol-radar-stack`, 호스트 `/etc/hosts`.

### 적용 순서

1. worktree 를 `git -C <worktree> checkout --detach 15c966c6` 로 옮겼다.
   - 17c55609 → 15c966c6 변경은 6개 파일이다(migration 1, `scripts/database.test.mjs`, 증거 문서 4). 웹·worker 코드와 lockfile 은 바뀌지 않았다.
   - 덮인 증거 9개는 변경 파일과 겹치지 않아 그대로 넘어왔다.
2. 격리 DB 에 `20261025000100_join_request_snapshot_on_approve.sql` 만 적용했다.
   - 명령: `supabase migration up --local --workdir <scratchpad>/rh1025`
   - 적용 뒤 최신 버전은 20261025000100 이다. reset 하지 않았고 자료는 그대로다(직원 200, score_runs 18).
3. override 를 적용했다: `docker compose -p sol-radar-rh1025 … -f infra/compose.yaml -f <override> up -d`. worker 를 다시 만들었고 이미지는 다시 빌드하지 않았다.
4. 웹을 다시 빌드했다: `pnpm -C web build` exit 0(slot).

### 2차 E2E 결과: 18/18 통과

- 명령: `pnpm -C web test:e2e:work`(전체, slot) → `18 passed (1.7m)`, exit 0. 결과 줄 원문은 `e2e-results.txt` 끝 절이다.
- globalSetup 과 globalTeardown 이 모두 통과했다.
  - 순서: demo:reset seed 줄 → mock 확인 → worker 주소 확인(`127.0.0.1:56321` = status) → preanalyze 18/18
  - teardown 의 기준선 복구도 통과했다. 끝난 뒤 DB 는 데모 직원 200, score_runs 18 이다.
- axe 18회 스캔, 위반 0이다(`docs/evidence/phase-3/axe-report.json`).
- 꼭 확인할 것 세 가지
  - FX-02 완료 72점: bid-decision S4 통과. 분석 실행 → 대기·분석 중 → "SOL Score 72, 권고 WATCH" → 분해·사람 검토 권장 → WATCH 결정·이력 → 저장 실패 상태까지 돌았다.
  - 분석 결과 비교: p1-navigation 통과. 관심 추가·해제 → 분석 4건 비교 → 프로젝트 저장 → 인력 조회.
    - 비교 표 스크린샷에서 FX-02(경기도교육청 통합 LMS)가 72 / 100 이다.
  - 가정 분석 새로 고침: what-if 통과. NO-BID → WATCH 가정, 레일 NO-BID 68 유지, 새로 고침하면 가정이 사라진다.
- 1차 실패 9건이 모두 통과했다. 상단바 AI 지표는 모든 화면에서 `AI: mock` 이다(스크린샷 확인).

### 남은 실패

- 제품 결함: 없음
- 환경 결함: 없음. 1차의 9건은 환경 결함(worker·웹 Supabase 주소 문자열 불일치)이었고, 2차에서 override 로 해소했다.

### 2차가 만든 파일(커밋하지 않음)

- 1차부터 덮인 9개에 `docs/evidence/phase-3/isolation-404.json` 이 더해져 수정 파일은 10개다.
- E2E 증거 스크린샷 20개가 새로 생겼다(`docs/evidence/phase-3/e2e/20261025-*` 18개, `docs/evidence/boost2/20261025-*` 2개).
- 40 지시대로 커밋하지 않고 그대로 둔다.

## 10-25 3차(사진 상한)

대상은 `integration/freeze-1024` @466d2911 이다(`fix(db): 본인 사진 3장 상한과 삭제 정책 추가`). 40 이 배정했다.
2차와 같은 스택·override 를 썼다.

### 적용

1. `git -C <worktree> checkout --detach 466d2911` 로 옮겼다.
   - 15c966c6 → 466d2911 변경은 8개 파일이다: migration 1, `scripts/database.test.mjs`·`db-verify.mjs`·`verify-photo-quota-concurrency.mjs`, `web/components/photo/{photo-file.ts,photo-file.test.ts,photo-picker.tsx}`, `web/lib/database.types.ts`.
   - lockfile 은 바뀌지 않았다. 남아 있던 E2E 증거 파일과는 겹치지 않았다.
2. 격리 DB 에 `20261025000110_profile_photo_quota.sql` 만 적용했다(`supabase migration up --local`, reset 없음).
   - 적용 뒤 최신 버전은 20261025000110 이다.
   - `storage.objects` 정책은 `profile_photos_insert`·`profile_photos_delete_own`·`profile_photos_read` 다.
3. 웹을 다시 빌드했다: `pnpm -C web build` exit 0(slot).

### profile-photo E2E

- 명령: `pnpm -C web test:e2e:work --project work-write --no-deps e2e-auth/profile-photo.write.spec.ts`(slot) → `1 passed (48.1s)`
- 흐름: 가입 신청 → 사진 → 승인 → 조직도 → 관리자 사진 변경
- globalSetup·teardown 은 통과했다.

### 직접 확인(실제 Storage API 경로)

- 계정은 `sales@soltech.invalid`(SALES), 웹은 localhost:3210(같은 빌드)이다. 그때 `/health/ready` 는 `db·redis·storage ok, ai mock` 이었다.
- 객체 개수는 격리 DB 에서 읽기 전용 트랜잭션(`begin read only`)으로 셌다: `storage.objects` 의 `profile-photos`, `users/<id>/` 접두.
- 원자료: `screens/photo-quota-check.json`(사용자 id 는 `<uid>` 로 가렸다). 스크린샷: `screens/40`·`41`.

|확인|결과|
|---|---|
|시작 상태|객체 0, `profiles.photo_path` null|
|1-1 `/settings` 내 사진 바꾸기(1번째)|성공. 정리 뒤 객체 1. Storage 호출: list 200 → 올리기 200 → list 200 → DELETE 200|
|1-2 바꾸기(2번째)|성공. 정리 뒤 객체 1. 올리기 전 정리(list·DELETE) → 올리기 200 → 저장 뒤 정리(list·DELETE 200)|
|1-3 바꾸기(3번째)|성공. 정리 뒤 객체 1(40)|
|1 결과|3번 모두 성공, 끝난 뒤 `users/<id>/` 객체 **1개**|
|2 "사진 지우기"|"사진을 지웠습니다", 객체 **0개**, `photo_path` null(41)|
|3-0 같은 사용자 JWT|`/auth/v1/token?grant_type=password` 200|
|3-2 Storage API 직접 올리기 1·2·3번째|모두 HTTP 200. 웹 정리를 거치지 않아 객체 3개|
|3-4 직접 올리기 4번째|**HTTP 400 `{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy","code":"AccessDenied"}`**|
|3-5 4번째 뒤 객체|3개 그대로|
|3-6 직접 올린 3개를 같은 JWT 로 지우기|HTTP 200, 3개 지움, 남은 객체 0(`profile_photos_delete_own`)|

- 1-1 의 저장 뒤 정리는 방금 저장한 사진도 지우기 목록에 넣는다(`ownPhotoCleanupPaths`). 그래도 객체가 1개로 남았다. 삭제 정책(`own_photo_deletable`)이 쓰는 사진을 지우지 않았다는 뜻이다.
- Storage API 는 RLS 거부를 HTTP 400 에 본문 `statusCode: "403"` 으로 돌려준다(Supabase Storage 의 응답 형식).

### 기준선 복구

1. `reset-baseline.mjs` 를 돌렸다.
   - 결과: `seed: … people=200 portraits=200 bids=19 …` → worker 주소 확인 → `preanalyze: targets=18 completed=18`
   - 스크립트의 worker 주소 확인은 override 기준(`127.0.0.1:56321` + `supabase-forward` 실행 중)으로 고쳤다.
2. 사진 정리: `cleanup-photos.mjs`
   - 대상: `profile-photos` 객체 중 `profiles`·`team_members`·대기 가입 신청 어디에서도 쓰지 않는 것. 읽기 전용 SQL 로 골랐다.
   - 로컬 service role 로 Storage API DELETE 를 불렀다. 14개를 지웠다(1·2·3차 시험 사진. 지워진 E2E 신규 입사자 계정 폴더와 `members/` 포함).
3. 복구 뒤 상태
   - `profile-photos` 객체 0, 사진 포인터 0(profiles·team_members)
   - 가입 신청 0, 계정 5
   - 데모 직원 200 ACTIVE, score_runs 18
   - `profile_photo_folders` 의 잠금 행은 남겨 두었다. 개수 계산에 쓰지 않는 줄 세우기용 행이다.

### 남은 실패

- 없음. 제품 결함 0, 환경 결함 0.

## 10-25 4차(통합 04b4bf3a)

대상은 `integration/release-1025` @04b4bf3a 다. `integration/freeze-1024`@6c044ffb 에 `feat/live-ingest-worker`@16e1ab6b 와 `feat/live-ingest-web`@a261e780 를 합친 통합 커밋이다. 40 이 배정했다.

### 적용

1. worktree 를 `git checkout --detach 04b4bf3a` 로 옮겼다. 남아 있던 E2E 산출물(추적 파일 10개 수정, 미추적 파일)은 충돌 없이 그대로 두었다.
2. 466d2911..04b4bf3a 는 69파일(+3244 −216)이다. 락파일·`package.json`·`infra/compose.yaml` 은 바뀌지 않아 install 을 다시 하지 않았다. compose 는 회사용 파일만 바뀌었다.
3. 격리 DB 에 `20261025000200_procurement_live_metrics` 하나만 `supabase migration up --local` 로 적용했다. reset 은 하지 않았다. 적용 뒤 migration 58개, 마지막 20261025000200 이다.
4. compose 는 override 를 포함해 `up -d --build` 했다(exit 0).
   - `worker`·`ai-gateway` 이미지를 통합 트리로 다시 빌드했다. worker 이미지 빌드 확인을 겸한다.
   - worker 와 `supabase-forward` 를 다시 만들었다. 사이드카는 새 worker 의 네트워크(`container:<worker id>`)에 붙었다.
   - worker env 는 `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321`, `SOL_RUN_MODE=mock` 이다. Redis 의존성 보고의 scope 도 `127.0.0.1:56321` 이다(storage ok, ai mock).
   - worker 로그는 mock 회차뿐이다. live g2b 수집은 `SOL_RUN_MODE=live` 에서만 돈다.
5. 웹 `pnpm -C web build` exit 0.

### E2E: 18/18 통과

`pnpm -C web test:e2e:work` 전체(1.6분, exit 0). 출력은 [[20261025-e2e/e2e-results.txt|e2e-results.txt]] 의 4차 절이다.

|꼭 볼 것|시험|결과|
|---|---|---|
|FX-02 72|`bid-decision.write` S4: 분석 실행 → 완료 72·분해·사람 검토 권장 → WATCH 결정 → 저장 실패 상태|통과|
|분석 비교|`p1-navigation.write`: 관심 → 분석 4건 비교 → 프로젝트 저장 → 인력 조회|통과|
|what-if 갱신|`what-if.write` FX-03: 정보통신공사업 보유 가정 NO-BID → WATCH, 저장 안 함|통과|
|프로필 사진 상한|`profile-photo.write`(신규 입사자 사진 흐름) + 아래 직접 확인|통과|

### 프로필 사진 상한 직접 확인(같은 빌드)

3차 스크립트(`photo-quota-check.mjs`)를 이 빌드의 localhost:3210 에 다시 돌렸다. 결과는 `screens-4/photo-quota-check.json` 이다.

|확인|결과|
|---|---|
|`/settings` 에서 내 사진 3번 바꾸기|3번 모두 성공, 매번 정리 뒤 객체 1개|
|내 사진 지우기|성공, 객체 0, `photo_path` null|
|같은 사용자 JWT 로 Storage API 에 직접 3개|모두 HTTP 200, 객체 3개|
|직접 4번째|**HTTP 400 `{"statusCode":"403",…,"message":"new row violates row-level security policy"}`**, 객체 3개 그대로|
|직접 올린 3개를 같은 JWT 로 지우기|HTTP 200, 3개 지움, 남은 객체 0|

화면: `screens-4/q-settings-photo-third-1440.png`, `screens-4/q-settings-photo-removed-1440.png`

### 새 화면 확인(1440·1280)

스크립트 `dashboard-check.mjs` 로 `sales@soltech.invalid`(org-01) 화면을 두 서버 설정에서 보았다.

- A(`a-noenv-*`): E2E 와 같은 env. `G2B_INGEST_INTERVAL_MINUTES` 가 없다.
- B(`b-interval60-*`): 수동 3210 서버에만 `G2B_INGEST_INTERVAL_MINUTES=60` 을 주었다. 비밀이 아닌 설정이고, "다음 수집 예정" 카드를 보려고 넣었다.

두 설정 모두 1440·1280 가로 넘침 0px, 5xx 0건이다.

|화면|확인|결과|
|---|---|---|
|`/dashboard?origin=demo`|상단바 DEMO 배지|보임|
||"DEMO · 예시 공고 기준" 문구|1번|
||수집 지표 줄|전체 수집 공고 15 · 진행 중 WATCH 10 · 마지막 수집 성공 "— 성공 기록 없음" · 기관 상위 5(강원특별자치도·경기도교육청·광주광역시·국민건강보험공단·국방부 각 1건)|
||다음 수집 예정|A 숨김, B 있음("— 정기 수집 기록 없음")|
||공공조달 요약|신규 발견 15 · 분석 대기 1 · BID 권고 2 · 마감 임박 1 · 진행 중 프로젝트 0|
|`/dashboard?origin=live`|상단바 DEMO 배지·문구|없음·0번. 본문 "DEMO" 0번|
||수집 지표 줄|전체 0 · WATCH 0 · "— 성공 기록 없음" · "기관이 확인된 입찰공고 없음"|
||다음 수집 예정|A 숨김, B 있음("— 정기 수집 기록 없음")|
||공공조달 요약|모두 0, "아직 수집된 공고가 없습니다"|
|FX-01 상세(`/bids?origin=demo` 에서 진입)|기관 줄|"수요기관 세종특별자치시 · 예산 1,200,000,000원 · 마감 2026-11-15 18:00 (D-21)"|
||원문 링크|글자 "원문 보기", aria-label "원문 보기 (새 탭)", href `https://demo.sol-radar.invalid/notices/FX-01`|

격리 DB 의 공고는 `is_demo=true, source=fixture` 19건뿐이다. live 보기가 0건이므로 DEMO 공고가 live 로 세지지 않는다.

스크린샷(`screens-4/`):

- `a-noenv-dashboard-demo-1440.png`·`a-noenv-dashboard-demo-1280.png`
- `a-noenv-dashboard-live-1440.png`·`a-noenv-dashboard-live-1280.png`
- `a-noenv-bid-detail-fx01-1440.png`·`a-noenv-bid-detail-fx01-1280.png`
- `b-interval60-dashboard-demo-1440.png`·`b-interval60-dashboard-demo-1280.png`
- `b-interval60-dashboard-live-1440.png`·`b-interval60-dashboard-live-1280.png`
- `b-interval60-bid-detail-fx01-1440.png`·`b-interval60-bid-detail-fx01-1280.png`
- 값: `a-noenv-dashboard-check.json`·`b-interval60-dashboard-check.json`

### 알려 둘 점(결함 아님)

- demo 보기의 "마지막 수집 성공"이 "— 성공 기록 없음"이다.
  - seed 수집 기록은 `fixture | MOCK | DEMO | status PARTIAL | completeness COMPLETE` 1건이다. fixture 1건을 격리했기 때문이다.
  - 수집 소스 상태(`procurement_source_health`)는 `status='SUCCEEDED'` 이고 `completeness='COMPLETE'` 인 기록만 성공으로 센다.
  - 규칙대로 나온 값이다. 데모에서 "성공 기록 없음"이 어색하면 문구나 seed 를 판단할 사람이 정한다.
- "다음 수집 예정" 카드는 `G2B_INGEST_INTERVAL_MINUTES` 가 없으면 숨는다(설계). E2E·A 는 이 env 없이 돌렸다.
- "전체 수집 공고" 아래 "입찰공고 · 출처 사본은 1건"은 고정 안내 문구다(`dashboard-view.tsx`). 개수가 아니어서 live 0건 화면에도 그대로 보인다.

### 기준선 복구

1. `reset-baseline.mjs`: `seed: orgs=2 users=5 … people=200 portraits=200 bids=19 quarantined=1` → worker 주소 확인 → `preanalyze: targets=18 completed=18`
2. `cleanup-photos.mjs`: 쓰지 않는 사진 객체 2개를 지웠다.
3. 복구 뒤(읽기 전용 SQL): team_members 200, score_runs 18, 계정 5, `profile-photos` 객체 0, 공고 `true|fixture` 19, migration 58(마지막 20261025000200)
4. 수동 3210 서버는 껐다. 격리 Supabase 와 compose(override 포함)는 켜 두었다.

### 실패 분류

- 없음. 제품 결함 0, 환경 결함 0.
- 4차가 만든 파일(커밋하지 않음): `screens-4/` 전체, 이 절, e2e-results.txt 4차 절. 앞선 차수의 덮인 증거·미추적 파일도 그대로 두었다.

## 관련 문서

- [[20261025-e2e/stack|10-25 격리 E2E 스택]]
