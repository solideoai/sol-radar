---
title: "BOOST-2 가정 재계산 E2E — FX-03 정보통신공사업 보유 가정"
doc: "evidence-boost2-what-if-e2e"
status: final
tags: [sol-radar, test, ui]
updated: 2026-10-21
---

# BOOST-2 가정 재계산 E2E (FX-03)

- 실행: 2026-10-21 00:10~00:12 KST. globalSetup 준비 끝 00:11:44 KST.
- 기준 코드: `feat/boost2-what-if` `ed80342`(main `e92e4a6` 병합 포함).
  - 미커밋 변경은 최종 리뷰 수정 묶음의 시험 파일 4개뿐이다: `web/server/scoring/what-if.test.ts`, `web/server/bids/what-if.service.test.ts`, `web/app/api/v1/tenant-isolation.test.ts`, `web/e2e-auth/what-if.write.spec.ts`.
  - 앱·서버 코드는 커밋 그대로다.
- 명령: `pnpm -C web test:e2e:work`. `--no-deps` 와 프로젝트 지정 없이 전부 돌렸다.
- 기대값 근거: [[2026-10-20-boost2-what-if-ui|BOOST-2 디자인 스펙]] §4.3·§4.7·§6·§10, `fixtures/goldens/FX-03.json`(68 · NO_BID).
- 점수를 심지 않았고 요청도 가로채지 않았다. 화면은 실제 `POST /api/v1/analyses/{id}/what-if` 응답으로 그렸다.

## 결과

**36 passed (1.3m), 종료 코드 0.** 재시도 없음(`retries: 0`). 실패·건너뜀·did not run 은 0건이다.

| 프로젝트 | 통과 | 내용 |
| --- | ---: | --- |
| `work-guard` | 1 | 보안 가드 순수 함수 |
| `work-1440` | 14 | 읽기 spec(demo-badge·run-mode-badge·no-evidence·bid-isolation·work-screens) 1440×900 |
| `work-1280` | 14 | 같은 읽기 spec 1280×800 |
| `work-write` | 7 | bid-decision 2 · fx01-flow 2 · notifications 2 · **what-if 1** |
| 합계 | 36 | |

```
Running 36 tests using 2 workers
  …
  ✓   9 [work-1440] › e2e-auth/work-screens.spec.ts:115:7 › S3 /bids › S3 1·2·4·5번: 권고 BID + 점수 높은 순 → FX-01 상단, 결정 NO-BID → FX-03 규칙 우선 (2.4s)
  ✓  23 [work-1280] › e2e-auth/work-screens.spec.ts:115:7 › S3 /bids › S3 1·2·4·5번: 권고 BID + 점수 높은 순 → FX-01 상단, 결정 NO-BID → FX-03 규칙 우선 (2.3s)
  …
  ✓  36 [work-write] › e2e-auth/what-if.write.spec.ts:76:5 › FX-03: 정보통신공사업 보유 가정은 NO-BID → WATCH 를 보이지만 저장하지 않는다 (2.0s)

  36 passed (1.3m)
```

`work-screens.spec.ts` S3 5번(위 9·23번)은 이 브랜치가 바꾼 FX-03 필수자격 행을 두 폭에서 지난다. 바뀐 것은 첫 줄 묶음·스위치·제목 아래 안내 줄이다.

globalSetup(`web/e2e-auth/support/work-setup.ts`)의 마지막 줄:

```
seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true
preanalyze: targets=18 completed=18 partial=0 failed=0
```

axe: 이번 실행의 axe 보고는 23 scans·위반 0·노드 0 이다. `work-write/bid-detail-what-if`(띠 결과 상태) 스캔도 위반 0 이다. globalTeardown 이 쓴 `docs/evidence/phase-3/axe-report.json` 을 `20261021-boost2-axe-report.json`(이 폴더)으로 옮겨 두고, phase-3 의 파일·스크린샷은 커밋된 상태로 되돌렸다(Phase 3 증거는 이 브랜치가 바꾸지 않는다).

## what-if 시험이 확인한 것

| # | 단계 | 단언 |
| --- | --- | --- |
| 1 | 결정 기록 건수 | `GET /api/v1/bids/{FX-03}/reviews` 200. id 목록을 저장한다 |
| 2 | FX-03 상세 진입 | 레일 `권고 NO-BID` 이고 SOL Score 미터는 `68점 / 100점 (참고)` 다. 스위치 `정보통신공사업 등록 보유 가정` 이 하나 있다: `data-slot="what-if-switch"`·`data-code="ICT_CONSTRUCTION"`·꺼짐. 띠는 없다 |
| 3 | 스위치 켬 | 스위치가 켜지고 `data-slot="what-if-band"` 가 보인다. `aria-busy` 가 풀린다 |
| 4 | 비교표 | 권고 `NO-BID` → `WATCH`, SOL Score `68 / 100 참고` → `68 / 100 변화 없음`, 필수자격 `미충족` → `충족` |
| 5 | 고정 문구 | "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다." / "결정 모델 의견은 가정에 포함하지 않았습니다." 가 정확히 보인다. 칩 `정보통신공사업 등록 보유` 가 있다 |
| 6 | 금지 글자 | 띠 글자에 `확률`·`승률`·`가능성`·`수주`·`%` 가 없다 |
| 7 | axe | 띠 결과 상태 화면 전체 `assertNoAxe(page, "bid-detail-what-if")`: 위반 0 |
| 8 | 결정 패널 | 켠 뒤에도 레일은 `권고 NO-BID`·`68점 / 100점 (참고)` 그대로다 |
| 9 | 증거 | 1440·1280 스크린샷 |
| 10 | 새로 고침 | 스위치가 다시 그려진 뒤(꺼짐) 띠 0개, 레일 `권고 NO-BID` |
| 11 | 저장하지 않음 | reviews 건수·id 가 1번과 같다 |

스위치는 서버의 진입 호출(빈 가정)이 `assumable` 에 `ICT_CONSTRUCTION` 을 줄 때만 그려진다. 그러니 2번은 `demo:preanalyze` 가 만든 FX-03 run 에 입력 기록과 그 코드가 있다는 것도 확인한다(디자인 스펙 §4.7·§10 5번).
실행 뒤(globalTeardown 이 되돌린 기준선) 격리 DB 상태:

- `score_runs` 18건, `bid_reviews` 2건.
- FX-03 run `COMPLETED · NO_BID · 68 · input_snapshot 있음`.

## 스크린샷

| 파일 | 폭 | 보이는 것 |
| --- | --- | --- |
| `20261021-phase3-bid-detail-what-if-1440.png` | 1440×900 | 점선 띠와 오른쪽 참여 판단 NO-BID 68 `참고` 가 한 화면에 있다. 띠: NO-BID → WATCH · 68 → 68 변화 없음 · 미충족 → 충족 · 고정 문구 두 줄 · 바뀐 요소 없음 |
| `20261021-phase3-bid-detail-what-if-1280.png` | 1280×800 | 같은 상태. "바뀐 자격 항목"·"요소별 점수"가 위아래로 쌓인다(§4.3 1280) |

파일 이름의 날짜는 서울 날짜다. 실행이 자정을 넘겨 `20261021-` 로 찍혔다. 이전 실행의 `20261020-` 두 장은 아래 "이전 실행" 기록이다.

## 실행 환경 (격리, 값은 적지 않는다)

- Supabase: 이 시험 전용 로컬 Supabase CLI 프로젝트 `sol-radar-93-e2e`(API `127.0.0.1:59721`, 마이그레이션 30개). 공용 로컬 Supabase(54321)와 클라우드 DB 는 쓰지 않았다.
- Compose: 프로젝트 `sol-radar-93-e2e`.
  - 서비스: redis `59791`·minio `59792`·ai-gateway `59794`·worker. worker 이미지는 `ed80342` 로 다시 빌드했다.
  - `SOL_RUN_MODE=mock`·`AI_PROVIDER=mock` 이고 G2B 서비스키는 비어 있다.
  - worker 의 Supabase 주소는 격리 API 다. harness `requireWorkerOnLocalSupabase` 를 통과했다.
- 유료·hosted 모델과 실공고 API 는 부르지 않았다.

실행 명령(`<…>` 는 값을 적지 않은 자리):

```sh
# worker 이미지 (이 프로젝트만, --remove-orphans 없음)
docker compose -p sol-radar-93-e2e --env-file <compose env 파일> -f infra/compose.yaml up -d --build --wait worker

# 빌드 (NEXT_PUBLIC_* 는 빌드 때 박힌다)
cd web && NEXT_PUBLIC_SUPABASE_URL=<격리 status API_URL> NEXT_PUBLIC_SUPABASE_ANON_KEY=<격리 status ANON_KEY> \
  NEXT_PUBLIC_AUTH_GOOGLE=false NEXT_PUBLIC_AUTH_KAKAO=false NEXT_PUBLIC_AUTH_NAVER=false SOL_RUN_MODE=mock \
  bash <verify-slot.sh> pnpm build

# E2E 전체
E2E_PORT=59780 SOL_RUN_MODE=mock KEV_ENABLED=true API_CURSOR_SECRET=<로컬 값> \
  REDIS_URL=redis://:<로컬 값>@127.0.0.1:59791 AI_GATEWAY_URL=http://127.0.0.1:59794 MINIO_ENDPOINT=http://127.0.0.1:59792 \
  NEXT_PUBLIC_SUPABASE_URL=<격리 status API_URL> NEXT_PUBLIC_SUPABASE_ANON_KEY=<격리 status ANON_KEY> \
  NEXT_PUBLIC_AUTH_GOOGLE=false NEXT_PUBLIC_AUTH_KAKAO=false NEXT_PUBLIC_AUTH_NAVER=false \
  SMTP_HOST=127.0.0.1 SMTP_PORT=59725 SITE_URL=http://localhost:59780 \
  SOL_RADAR_TEST_SUPABASE_WORKDIR=<격리 workdir> SOL_RADAR_TEST_SUPABASE_API_URL=http://127.0.0.1:59721 \
  DEMO_SEED_ENV_FILE=<seed env 파일> COMPOSE_PROJECT_NAME=sol-radar-93-e2e COMPOSE_ENV_FILES=<compose env 파일> \
  bash <verify-slot.sh> pnpm -C web test:e2e:work
```

## 이전 실행 (2026-10-20 23:23 KST)

- 기준 코드: `26beca1` + 미커밋 3개(설정 정규식 두 줄, 새 spec).
- 명령: `test:e2e:work --project=work-write --no-deps what-if`.
- 결과: `1 passed (1.6m)`.
- 읽기 프로젝트는 돌지 않았다.
- 그 뒤 spec 의 스크린샷 경로가 바뀌어 커밋된 spec 과 실행한 spec 이 달랐다.
- 그 실행의 스크린샷이 `20261020-phase3-bid-detail-what-if-{1440,1280}.png` 다. 위 실행이 이것을 대신한다.

## 관련 문서

- [[2026-10-20-boost2-what-if-ui|BOOST-2 가정 재계산 디자인 스펙]]
- [[11-TESTING|11 테스트]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
