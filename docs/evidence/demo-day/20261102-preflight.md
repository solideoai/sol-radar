---
title: "촬영 전 확인 기록 (2026-11-01 밤)"
status: active
tags: [sol-radar, evidence, demo, ops]
updated: 2026-11-02
---

# 촬영 전 확인 기록 (2026-11-01 밤)

11-02 촬영([[12-ROADMAP|12 로드맵]] 남은 일정 제안 표) 전에 main 전체 검증과 D1 촬영 값을 확인한 기록이다. 운영은 읽기만 했다. 운영 DB는 Supabase MCP `execute_sql`(SELECT만)로 읽었고, 대상이 운영 프로젝트인지는 migration 기록(73개, 마지막 `20261030001100`)으로 확인했다. 시각은 KST다.

## main 전체 검증 (11-01 22:2x~22:49)

새 worktree(`git worktree add --detach … origin/main`, HEAD `fbe42d5b`, 마지막 코드 커밋 `f9dd9e4d`)에서 루트·web `pnpm install --frozen-lockfile` 뒤 `pnpm verify`를 돌렸다. main 폴더의 이번 작업 밖 미커밋 파일을 피하려고 따로 만들었다. exit 0.

| 검사 | 결과 |
|---|---|
| 루트 `node --test` | 316 통과 |
| web Vitest | 138파일 1,115 통과 |
| 타입·린트 가드레일·lodestar(계층 7·순환 없음)·토큰·색·DB 타입 | 통과 |
| `next build` | 성공, 정적 페이지 67 |
| AI gateway pytest | 264 통과 |
| 결정 모델 pytest | 57 통과 |

10-31 전체 검증(`652741e2`)은 web 1,097이었다. 늘어난 18건은 그 뒤 main에 들어간 인력 배치 사진·추천 팀 구성, 로그인 뒤 복귀, 소셜 이메일 가림, 나라장터 실패 사유 기록의 시험이다(커밋 `a27ab727`·`92ca1882`·`6604d975`·`eded3672`·`f9dd9e4d`).

## D1 촬영 값 (11-01 22:3x 운영 DB 읽기)

| 장면 | 읽은 값 | [[19-DEMO-SCENARIO\|19]] §2.2 기대값 |
|---|---|---|
| FX-01(`DEMO-2026-0001`) 최신 run | `dfac87db` `COMPLETED` 92 `BID`, `sol-v0.2.0`, 프로필 revision 6, `LIVE`·`LOCAL`(10-30 13:07) | 같음 |
| FX-01 추천 분석 | `91b8a6e5` `DONE`·`MODEL`(10-30 13:07) | 같음 |
| FX-02(`DEMO-2026-0002`) | run `6a90acc4` 하나뿐(66 `WATCH`, `sol-v0.1.0`, revision 2, 10-24). 결정 기록 1건(`WATCH`). 마감 11-14 18:00 | 같음(재분석 안 됨) |
| FX-16(`DEMO-2026-0016`) 최신 run | `3eb7809b` 70 `WATCH`, revision 6 | 같음 |
| DEMO 공고별 최신 revision 6 run | 추천 10 · 보류 8 | 같음 |
| S-LIVE 동국대 nDRIMS | `ed2e57d4` `COMPLETED` 49 `WATCH` `sol-v0.2.1`, 그 공고의 최신 run. 결정 모델 `NO_BID` 0.87 | 같음 |
| `/health/ready` | 200, `db`·`redis`·`storage` ok, `ai: local` | 같음 |

알림 outbox(최근 3일): `ANALYSIS_COMPLETE` 4건·`BID_RECOMMENDED` 2건·`KAKAO_TEST` 3건 모두 `PROCESSED`, 마지막 처리 11-01 17:44. `BID_CREATED` 675건·`BID_CHANGED` 118건은 `PENDING`이다. 이 둘은 조직 팬아웃 소비자가 없는 이벤트라 대기가 정상이다(닫힌 미결정 30-4). 알림 Worker가 18:15:48 재생성 뒤 살아 있는지는 그 뒤 처리할 이벤트가 없어 DB로 확인하지 못했다. S4 촬영 뒤 벨 알림으로 확인한다.

## 나라장터 정기 수집 실패의 모양 (11-01 22:4x 읽기)

`ingest_runs`(source `g2b`, operation `getBidPblancListInfoServc`)를 다시 읽어 [운영 읽기](../ingestion/20261101-ops-reads.md)의 "7번 실패"를 회차별로 나눴다. 원인은 여전히 모른다.

| 회차(시작) | 상태 | 닫힌 시각 | 받은 건수 |
|---|---|---|---|
| 10-30 18:00 | `SUCCEEDED` | 10-30 18:00 | 236 |
| 10-30 21:00 | `FAILED` | **10-31 18:00**(21시간 열림) | 0 |
| 10-31 00:00~18:00 | 행 없음 | — | — |
| 10-31 21:00 · 11-01 00:00·03·06·09·12 | `FAILED` 6회 | 시작과 같은 분(0초) | 0 |
| 11-01 15:00 · 18:00 · 21:00 | `SUCCEEDED` | — | 0 · 0 · 0 |
| 11-01 16:17 수동 | `SUCCEEDED` | 16:19 | 52(신규 33·변경 17) |

- 같은 ingest Worker의 LH·KEPCO·K-water 회차와 기업마당 Worker 회차는 10-31 낮에도 돌았다(각 6~7회). 그래서 Worker가 죽은 것이 아니라 나라장터 회차만 멈췄다.
- 10-30 21:00 회차가 열려 있는 동안 나라장터 회차가 새로 생기지 않았다. 열린 회차가 다음 회차를 막은 것으로 보인다(추정, 코드 확인 안 함).
- 실패 행의 `summary`에는 실패 사유가 없다. 사유 기록 수정(main `e2223bdc`)은 회사 ingest Worker에 들어가지 않았다.
- 11-01 15·18·21시 회차는 성공했지만 0건이다. 일요일이라 정상일 수 있다. 같은 시간대 평일(10-29·10-30)은 회차마다 144~279건이었다. 평일 첫 확인은 11-02 09:00·12:00 회차다.
- 수동 수집은 10-30 18:00~10-31 15:00 구간을 받았다. 10-31 15:00~11-01 15:00 구간 공고를 받았는지는 확인하지 않았다.

## 로컬 Compose 리허설 (11-02 08:56~09:05)

클립 6(S5)·클립 4 앞부분(S6) 촬영용 격리 스택을 띄우고 대본대로 한 번 돌렸다. 공용 로컬 DB(54321)와 기본 Compose 프로젝트(`sol-radar-stack`)는 쓰지 않았다.

- 구성: 위 검증 worktree에서 Supabase CLI 격리 사본(project_id `sol-radar-film`, API 58321, studio·realtime 끔), Compose 프로젝트 `sol-radar-film`(redis 6391·qdrant 6341·ai-gateway 8091·worker), web `next start` 3000. 실행 모드 `mock`. Supabase 키는 `supabase status`에서 env 파일로 바로 옮겼고, `infra/.env`·루트 `.env.local`(운영 값)은 쓰지 않았다. worker의 Supabase 주소는 `http://host.docker.internal:58321`(`docker inspect`로 확인)이다.
- `pnpm demo:reset -- --env-file <격리 env>`: `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true`, 수집 요약 `{created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}`([[19-DEMO-SCENARIO|19]] §3.2 3번과 같음). `demo-preanalyze`: `targets=18 completed=18 partial=0 failed=0`.
- FX-01: 94 추천, 결정 모델 추천 71% · 보류 24% · 비추천 5%(로컬 `mock`).
- S5: admin@solideos.com으로 `/admin/ingestion` 수동 수집 LIVE 배치 → 변경 3·취소 1·중복 1, 신규 0·격리 0·재시도 0. FX-07 revisions: 예산 18억 → 21.6억, 공고 상태 공고 → 정정 공고, 필수 기술 Kubernetes 추가. FX-09는 revision 1 그대로([수집 결과](20261102-local-rehearsal/s5-ingest-result-1440.png), [FX-07 diff](20261102-local-rehearsal/s5-fx07-revisions-1440.png)).
- S6: `COMPOSE_PROJECT_NAME=sol-radar-film`·`COMPOSE_ENV_FILES=<격리 compose env>`를 둔 셸에서 `docker compose -f infra/compose.yaml stop ai-gateway` → sales@soltech.invalid로 FX-01 [재분석] → 3초 뒤 "부분 완료 (규칙만)", 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)", 94 추천 유지, 결정 패널 "AI 사용 불가 `AI_UNAVAILABLE`", 결정 모델 "사용 불가", 분석 이력 2건([화면](20261102-local-rehearsal/s6-fx01-partial-1440.png)). 덱 자막의 "AI: mock · 응답 없음(규칙만)" 문구는 첫 화면에 보이지 않았다.
- 리허설 뒤 gateway를 다시 켜고 `demo:reset`·`demo-preanalyze`를 다시 돌려 시작 상태로 돌렸다(수집 기록 1건, FX-07 revision 1, FX-01 run 1건 94, FX-02 run 0건).
- 알려진 차이: 격리 web의 `/health/ready`는 `storage`·`ai`가 `unavailable`이다. web(`127.0.0.1:58321`)과 worker(`host.docker.internal:58321`)의 Supabase 주소 표기가 달라 web이 worker 의존성 보고를 버린다(`web/server/health/dependency-report.ts` scope 대조). 분석·수집 흐름에는 영향이 없고 클립에 나오지 않는다.

## 관련 문서

- [[PROGRESS|진행 상황]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[12-ROADMAP|12 로드맵]]
