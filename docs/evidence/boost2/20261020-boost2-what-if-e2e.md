---
title: "BOOST-2 가정 재계산 E2E — FX-03 정보통신공사업 보유 가정"
status: verified
tags: [sol-radar, testing, boost2, e2e]
updated: 2026-10-20
---

# BOOST-2 가정 재계산 E2E (FX-03)

- 날짜: 2026-10-20. 실행 시작 23:23:49 KST, globalSetup 준비 끝 23:24:19 KST.
- 기준 코드: `feat/boost2-what-if` `26beca1`(Task 4 화면) + 이번 작업의 미커밋 변경 3개(`web/playwright.work.config.ts`·`web/playwright.auth.config.ts` 정규식 한 줄씩, 새 `web/e2e-auth/what-if.write.spec.ts`).
- 시험: `web/e2e-auth/what-if.write.spec.ts`. 프로젝트는 `work-write`(1440×900)이고, 1280 증거는 시험 안에서 폭을 바꿔 찍었다.
- 기대값 근거: [[2026-10-20-boost2-what-if-ui|BOOST-2 디자인 스펙]] §4.3·§4.7·§6·§10, `fixtures/goldens/FX-03.json`(68 · NO_BID).
- 점수를 심거나 요청을 가로채지 않았다. 화면은 실제 `POST /api/v1/analyses/{id}/what-if` 응답으로 그렸다.

## 결과

```
Running 1 test using 1 worker

  ✓  1 [work-write] › e2e-auth/what-if.write.spec.ts:76:5 › FX-03: 정보통신공사업 보유 가정은 NO-BID → WATCH 를 보이지만 저장하지 않는다 (9.3s)

  1 passed (1.6m)
```

종료 코드 0. 재시도 없음(`retries: 0`). skip·`.only` 없음.

globalSetup(`web/e2e-auth/support/work-setup.ts`)의 마지막 줄:

```
seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true
preanalyze: targets=18 completed=18 partial=0 failed=0
```

## 시험이 확인한 것

| # | 단계 | 단언 |
| --- | --- | --- |
| 1 | 결정 기록 건수 | `GET /api/v1/bids/{FX-03}/reviews` 200. id 목록을 저장한다 |
| 2 | FX-03 상세 진입 | 참여 판단 레일 `권고 NO-BID`, SOL Score 미터 `68점 / 100점 (참고)`. 스위치 `정보통신공사업 등록 보유 가정` 하나가 보이고 `data-slot="what-if-switch"`·`data-code="ICT_CONSTRUCTION"`·꺼짐이다. 띠는 없다 |
| 3 | 스위치 켬 | 스위치 켜짐, `data-slot="what-if-band"` 가 보이고 `aria-busy` 가 풀린다 |
| 4 | 비교표 | 권고 `NO-BID` → `WATCH`, SOL Score `68 / 100 참고` → `68 / 100 변화 없음`, 필수자격 `미충족` → `충족` |
| 5 | 고정 문구 | "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다." / "결정 모델 의견은 가정에 포함하지 않았습니다." 가 정확히 보인다. 칩 `정보통신공사업 등록 보유` |
| 6 | 금지 글자 | 띠 글자에 `확률`·`승률`·`가능성`·`수주`·`%` 가 없다 |
| 7 | 결정 패널 | 켠 뒤에도 레일은 `권고 NO-BID`, `68점 / 100점 (참고)` 그대로다 |
| 8 | 증거 | 1440·1280 스크린샷 |
| 9 | 새로 고침 | 스위치가 다시 그려진 뒤(꺼짐) 띠가 0개, 레일 `권고 NO-BID` |
| 10 | 저장하지 않음 | reviews 건수·id 가 1번과 같다 |

2번의 스위치는 서버의 진입 호출(빈 가정)이 `assumable` 에 `ICT_CONSTRUCTION` 을 줄 때만 그려진다. 그래서 `demo:preanalyze` 가 만든 FX-03 run 에 입력 기록(`input_snapshot`)과 그 코드가 있다는 것도 이 시험이 확인한다(디자인 스펙 §4.7·§10 5번).
실행 뒤(globalTeardown 의 demo:reset → preanalyze 기준선) 격리 DB 의 FX-03 run: `COMPLETED · NO_BID · 68 · input_snapshot 있음 · run_mode MOCK · ai_provider MOCK`.

## 스크린샷

> 스크린샷 이름은 실행 뒤 컨트롤러가 [[06-UI-UX|06]] §12 규칙(`YYYYMMDD-phaseN-<route>-<state>-<width>.png`, state `what-if`)에 맞춰 바꿨다. spec 의 저장 경로도 같은 이름으로 고쳤고, 이름 변경 뒤 E2E 는 다시 돌리지 않았다.

| 파일 | 폭 | 보이는 것 |
| --- | --- | --- |
| `20261020-phase3-bid-detail-what-if-1440.png` | 1440×900 | 점선 띠(NO-BID → WATCH · 68 → 68 변화 없음 · 미충족 → 충족 · 고정 문구 두 줄 · 바뀐 요소 없음)와 오른쪽 참여 판단 NO-BID 68 `참고` 가 한 화면에 있다 |
| `20261020-phase3-bid-detail-what-if-1280.png` | 1280×800 | 같은 상태. "바뀐 자격 항목"·"요소별 점수"가 위아래로 쌓인다(§4.3 1280) |

## 실행 환경 (격리, 값은 적지 않는다)

- Supabase: 이 시험 전용 로컬 Supabase CLI 프로젝트 `sol-radar-93-e2e`(API `127.0.0.1:59721`). 저장소의 `supabase/migrations` 30개를 복사해 적용했다. 공용 로컬 Supabase(54321)와 클라우드 DB 는 쓰지 않았다.
- Compose: 프로젝트 `sol-radar-93-e2e`(redis `59791`·minio `59792`·ai-gateway `59794`·worker). `SOL_RUN_MODE=mock`·`AI_PROVIDER=mock`, G2B 서비스키는 비어 있다. worker 의 Supabase 주소는 격리 API 를 가리킨다(harness `requireWorkerOnLocalSupabase` 통과).
- 유료·hosted 모델과 실공고 API 는 부르지 않았다.

실행 명령(`<…>` 는 값을 적지 않은 자리):

```sh
# 빌드 (NEXT_PUBLIC_* 는 빌드 때 박힌다)
cd web && NEXT_PUBLIC_SUPABASE_URL=<격리 status API_URL> NEXT_PUBLIC_SUPABASE_ANON_KEY=<격리 status ANON_KEY> \
  NEXT_PUBLIC_AUTH_GOOGLE=false NEXT_PUBLIC_AUTH_KAKAO=false NEXT_PUBLIC_AUTH_NAVER=false SOL_RUN_MODE=mock \
  bash <verify-slot.sh> pnpm build

# E2E
E2E_PORT=59780 SOL_RUN_MODE=mock KEV_ENABLED=true API_CURSOR_SECRET=<로컬 값> \
  REDIS_URL=redis://:<로컬 값>@127.0.0.1:59791 AI_GATEWAY_URL=http://127.0.0.1:59794 MINIO_ENDPOINT=http://127.0.0.1:59792 \
  NEXT_PUBLIC_SUPABASE_URL=<격리 status API_URL> NEXT_PUBLIC_SUPABASE_ANON_KEY=<격리 status ANON_KEY> \
  NEXT_PUBLIC_AUTH_GOOGLE=false NEXT_PUBLIC_AUTH_KAKAO=false NEXT_PUBLIC_AUTH_NAVER=false \
  SMTP_HOST=127.0.0.1 SMTP_PORT=59725 SITE_URL=http://localhost:59780 \
  SOL_RADAR_TEST_SUPABASE_WORKDIR=<격리 workdir> SOL_RADAR_TEST_SUPABASE_API_URL=http://127.0.0.1:59721 \
  DEMO_SEED_ENV_FILE=<seed env 파일> COMPOSE_PROJECT_NAME=sol-radar-93-e2e COMPOSE_ENV_FILES=<compose env 파일> \
  bash <verify-slot.sh> pnpm -C web test:e2e:work --project=work-write --no-deps what-if
```

- `--no-deps` 라 읽기 프로젝트(work-1440·work-1280)는 돌지 않았다. globalSetup·globalTeardown 은 돌았다.
- 이번 실행에서 axe 결과가 생기지 않아 `docs/evidence/phase-3/axe-report.json` 은 바뀌지 않았다(실행 전후 sha256 같음).

## 관련 문서

- [[2026-10-20-boost2-what-if-ui|BOOST-2 가정 재계산 디자인 스펙]]
- [[11-TESTING|11 테스트]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
