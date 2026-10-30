---
title: "진행 상황"
doc: "progress"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-30
---

# 진행 상황

이 문서는 지금 상태의 정본이다. 형식은 현재 상태 요약, 기능 상태 표, 최근 작업 로그다([[16-DECISIONS|ADR-057]]). 표의 칸에는 현재 값과 증거 링크 하나만 둔다. 일정 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표에만 둔다. 옛 작업 로그와 지난 값은 git 이력에 있다.

## 현재 상태 요약 (2026-10-29)

- 공식 제출은 2026-11-03, 발표는 2026-11-04다([[16-DECISIONS|ADR-054]]). 발표는 덱 20분 + 녹화 클립이다. D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE 녹화(동국대 공고 최신 run 49 보류, [[16-DECISIONS|ADR-068]] 5번), C9 D1 리허설·촬영이다. C1 ④ 파서 "지원" 판정은 해커톤 뒤 벤치마크 뒤로 미뤘다(ADR-068 1번). 제출물(X4)은 초안이다.
- 운영에서 실공고를 수집·첨부 파싱·분석한다. 수집 출처는 나라장터·LH·KEPCO·K-water 입찰공고와 기업마당 부처 공고다. 실공고 분석과 추천 분석(ADR-066)이 운영에서 돈다(아래 운영 상태).
- SOL Score `sol-v0.2.0`([[16-DECISIONS|ADR-071]])을 2026-10-30 운영에 반영하고 화면에 보이는 run 390건을 다시 계산했다(모두 보류). 발표 대본은 ADR-059 2026-10-30 개정을 따른다. 가정 재계산은 S3 FX-01(세 자격 → 추천 92), S4는 FX-02 재분석(예상 59 보류) → 사람 비추천이다.
- 운영에 알림 Worker가 없어 인앱·카카오·마감 알림이 처리되지 않는다. 기동은 승인 뒤다(아래 "알림 처리" 행). 사용자가 운영 알림 Worker를 곧 구현할 예정이다(2026-10-29, 날짜는 [[12-ROADMAP|12 로드맵]] 남은 일정 제안 표).
- X6 파인튜닝과 실험 E0~E3·X1·X2는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.

### 운영 상태

값은 증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 현재 값 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `a145cdc0`(가상 직원 등급·수행 이력 직급 정합) Vercel 커밋 상태 success, 로그인 운영 화면 확인. SOL Score v0.2([[16-DECISIONS\|ADR-071]], [기록](evidence/sol-score-v02/20261030/rollout.md))는 `161686a9`부터. IT 공고만 보이기([[16-DECISIONS\|ADR-069]])는 `7f6909ec`부터. 함수 지역 `syd1`([지역 기록](evidence/deployment/20261028-region-latency.md)). [기록](evidence/people/20261030-grade-alignment/README.md) | 2026-10-30 10:13 KST |
| `/health/ready` | 200(`db`·`redis`·`storage` ok, `ai: local`). `ai`는 회사 AI gateway가 보고한 provider 값이다. [기록](evidence/sol-score-v02/20261030/rollout.md) | 2026-10-30 10:24 KST |
| 운영 DB | migration 73개, 마지막 `20261030001100`(가상 직원 등급·수행 이력 직급 정합). db-push·`db-verify` 통과. [기록](evidence/people/20261030-grade-alignment/README.md) | 2026-10-30 09:45 KST |
| 회사 반영 | Analysis Worker·redis-api는 `7b5a79dc9054`(`deploy/sv02-20261030` = SOL Score v0.2 + 회사 carry, [[16-DECISIONS\|ADR-056]] 대안 A 포함). AI gateway는 `384e469857f0` 그대로이고 같은 호스트 Bosun `127.0.0.1:8009`를 부른다. `sol-radar-app` checkout은 `cbb3831e86da` 그대로다(redis-api 빌드 context만 배포 checkout). 되돌리기 태그 `sol-radar-gateway-redis-api:rollback-20261030`. [기록](evidence/sol-score-v02/20261030/rollout.md) | 2026-10-30 09:15 KST |
| 나라장터 정기 수집 | KST 3시간 정각. ingest Worker `cbb3831e86da`. 보조 조회(면허·지역·첨부)는 기능별 한도 각 1,000회이고, 밀린 공고는 같은 revision에 하루 100~200건씩 다시 채운다. [기록](evidence/ingestion/20261029-g2b-aux-budget.md) | 2026-10-29 10:49 KST |
| 외부 입찰공고(LH·KEPCO·K-water) | 같은 ingest Worker가 3시간 정각에 받는다. KEPCO는 공고 없는 날 HTTP 404를 빈 쪽으로 읽는다. 남은 외부 3종(K-water 발주계획·LH 사전규격·조달요청)은 꺼짐. [기록](evidence/ingestion/20261028-kepco-contract/no-data-404.md) | 2026-10-29 09:40 KST |
| 부처 공고(기업마당) | 전용 Worker가 3시간 정각에 받는다. 첫 정기 회차 `SUCCEEDED` 100/100, `program_notices` 100행. `/bids` "부처 지원사업" 탭 화면은 아직 보지 않았다. [기록](evidence/company-rollout/20261028/sources-rollout.md) | 2026-10-28 18:00 KST |
| 첨부 처리(Documents Worker) | 운영 중. `PARSED` 393·`FAILED` 0·다운로드 실패 0, `PENDING` 6,127(그 시각 기준). 지금 수는 미확인. [기록](evidence/attachment-pipeline/20261028-documents-worker.md) | 2026-10-28 19:0x KST |
| 분석 | 2026-10-30 SOL Score v0.2로 화면에 보이는 run 390건을 저장 입력으로 다시 계산했다([[16-DECISIONS\|ADR-071]], AI 재호출 없음, 회사 일회용 컨테이너). 실공고 372건 43~88(평균 66.1, 75 이상 60건), DEMO 18건 68~95, 모두 보류, 실패 0·권고 변화 0·알림 0. 그 전 기록: IT 실공고 371건 1회 일괄 분석(10-29, [[16-DECISIONS\|ADR-069]] 5번, [기록](evidence/it-scope/prod-20261029/README.md)), 실공고 3건(10-29, 부경대는 `RULES_ONLY`로 멈춤). 새 공고는 자동 분석하지 않는다. DEMO는 FX-02만 옛 분석(66 보류, 프로필 revision 2, 재채점 대상 아님). [기록](evidence/sol-score-v02/20261030/rollout.md) | 2026-10-30 09:40 KST |
| 추천 분석 | 운영 반영. DEMO FX-01은 v0.2 재채점 run에 다시 만들었다(92 보류, `DONE`·`MODEL`). 재채점 전 run에 붙은 결과(실공고 2건 포함)는 run이 바뀌어 보이지 않는다. [기록](evidence/sol-score-v02/20261030/rollout.md) | 2026-10-30 09:41 KST |
| DEMO 공고 | 19건 그대로, 16건 마감 +15일. 운영 DEMO 삭제는 발표 뒤다. FX-02는 촬영 때만 재분석한다([[16-DECISIONS\|ADR-059]], 예상 59 보류). v0.2 재채점 뒤 FX-01 92·FX-03 90 보류. [기록](evidence/demo-deadline/20261027/prod-run.md) | 2026-10-30 09:40 KST |
| 알림 처리 | 처리되지 않는다. 회사에 알림 전용 Worker가 없고 outbox만 쌓인다. 기동 전 쌓인 수는 실행서 §9.1 SQL로 센다(`infra/company/README.md` §9). [기록](evidence/company-rollout/20261028/sources-rollout.md) | 2026-10-28 |
| 카카오 | 운영 연결·발송 0건 | 2026-10-27 |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트와 직접 돌린 `pnpm verify`다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]) | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.

### 남은 일

- [[16-DECISIONS|ADR-056]] 대안 A(분석이 그 revision 문서 처리를 최대 300초 기다린다)는 2026-10-30 회사 Analysis Worker `7b5a79dc9054`에 들어갔다. 대기 동작을 운영 로그로 아직 보지 않았다.
- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. 순서는 알림 전용 Worker 회사 기동(승인 뒤) → 카카오 연결·S0 수신 시험 → D1 리허설·촬영(S-LIVE·카카오 실수신, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출 → 발표다.
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 59(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]).
- 덱 pptx(`docs/submission/deck/sol-radar-deck.pptx`, git 밖)는 [[slides-spec|덱 제작 명세]]와 18장을 대조해 맞췄다. 그림·포스터는 옛 mock 화면이라 촬영 뒤 바꾼다. 명세가 정본이다.
- 화면 동결 뒤 덱 클립을 찍는다([[16-DECISIONS|ADR-061]]). 사용자 승인 뒤 운영 읽기로 랜딩 출처 9곳 수집을 확인하고, 연결 안 된 곳의 로고를 뺄지 사용자가 정한다([출처 연결 목록](plans/2026-10-28-landing-sources-to-connect.md)).
- 열린 확인: 운영 로그인 화면(`/gaps`·`/market`·`/calendar` 실숫자, 부처 지원사업 탭), 로그인 뒤 E2E(`test:e2e:work`·`test:e2e:auth`, Compose 필요), 배포 뒤 사진 1장 올리기·지우기([릴리스 실행서](evidence/integration/20261025-release-runbook.md) §4), 나라장터 보조 정보 밤 일괄 채우기 결과.

**16에서 넘어온 할 일**(번호는 [[16-DECISIONS|16]]의 미결정·닫힌 미결정 번호):

- 해커톤 전
  - 회사 vLLM 장문 guided JSON·지연 실측(미결정 17), Bosun 질문당 지연 p95(미결정 24). `prompt_logprobs` 확인은 E3(X1)용이고 E3는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.
  - P1 화면을 어느 데모 장면에서 보일지 정한다([[18-HACKATHON|18]]·[[19-DEMO-SCENARIO|19]], [[16-DECISIONS|ADR-042]]).
- 발표 뒤 X6 실행 때([[16-DECISIONS|ADR-067]])
  - F1 전 필수: 후보 목록 교차 시험. `services/ai/eval/sol_eval/bosun_records.py:70`과 `services/decision/src/sol_decision/contract.py:45`의 `candidates_for`가 따로 구현돼 있다(닫힌 미결정 26-12).
  - F1 전 필수: `infra/gpu/bosun-f1.sh` 결과 파서 키. 로그 `s/step`(214행)과 `training_metrics.json` snake_case 키(236행 등)가 학습기 출력(`metrics` 아래 camelCase)과 다르다(닫힌 미결정 26-15).
  - 채점 `--data` 파일 sha256을 번들 manifest와 대조한다(닫힌 미결정 26-17).
  - 회사 GPU 서버에 `sol_eval`을 설치한다. 절차 초안은 [[22-FINETUNE-RUNBOOK|22]] §3.2다(닫힌 미결정 29-2).
  - E2 한국어 내보내기(`--language ko`)와 언어 짝 비교를 만든다(닫힌 미결정 29-6).
- 해커톤 뒤·NestJS 전환 때
  - `X-Request-Id`를 이어 받는다. `web/app/api/v1/_lib/http.ts:45·47·55`가 응답마다 새 UUID를 만든다(닫힌 미결정 26-4, [[16-DECISIONS|ADR-028]]).
  - 오래 남은 g2b `RUNNING` 행의 시간 기준 자동 `FAILED` 전환(닫힌 미결정 25). 지금은 `pnpm ops:close-stale-runs`로 푼다.
  - `stateTemplate` 대조(닫힌 미결정 26-13 (b))와 결정 모델 `manifest.json` sha256 identity 대조(닫힌 미결정 28 ②).
  - 나라장터 목록과 부처 공고 섞기. 사용자가 원하면 다시 정한다([[16-DECISIONS|ADR-040]]).
  - 간편 로그인 제공자(구글·카카오·네이버) 설정. 상태는 미확인이다([[16-DECISIONS|ADR-018]] 후순위).
  - Supabase 서울(`ap-northeast-2`) 이전과 함수 지역 `icn1` 전환(사용자 결정으로 발표 뒤, [기록](evidence/deployment/20261028-region-latency.md)).
  - 추천 분석 연 1회 재학습 구현([[16-DECISIONS|ADR-066]]).

**문서 밖 발견**(따로 정할 것):

1. ADR-044 때 코드가 남아 있다: `services/ai/app.py`·`services/ai/vercel_build.py`·`services/ai/tests/test_vercel.py`.
2. 회사 AI 모드 서술이 운영과 다르다. 회사 실행서 §2 표는 `.env.ai-gateway.local`을 "현재 `AI_PROVIDER=mock`"이라고 쓰고, 운영 readiness는 `ai: local`을 보고한다. 운영 AI gateway는 회사 전용 `sol-radar-ai-worker` 프로젝트의 `infra/.env.ai-local`을 쓴다([[10-DEPLOYMENT|10 배포]] "회사 Compose 프로젝트").

## 기능 상태 표

해커톤 컷의 정의는 [[12-ROADMAP|12 로드맵]]이다. 이 표가 각 항목의 현재 상태다. "main"은 main에 병합됐다는 뜻이다.

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| C0 | Phase 0 마감: Compose·gateway 골격·health | 완료 | [통합 기동](evidence/phase-0/c0-integration-20261019.md) |
| C1 | P0-0 외부 의존성 ①~④ | ①②③ 완료(운영 실모델 분석). ④ 파서 구현·운영 반영. "지원" 판정은 해커톤 뒤 벤치마크 뒤 적용([[16-DECISIONS|ADR-068]] 1번) | [점검표](evidence/phase-0/external-deps.md) |
| C2 | DB·RLS·`sol_role`·`pnpm demo:reset` | 완료. 운영 DB migration 66개 | [[04-DATABASE\|04]] |
| C3 | 수집·정규화·revision·documents job·첨부 다운로드 | 완료. 운영 3시간 정기 수집, Documents Worker 운영 중 | [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| C4 | 규칙 엔진·골든 94/72/68·인력 200명 입력 | 완료. FX-15 68, 가용 95.5 FTE([[16-DECISIONS\|ADR-043]]) | [골든](evidence/phase-4/goldens-report.txt) |
| C5 | gateway `/extract`·`/kev`·`/explain`·`/parse`·`/insight`, worker 분석·`PARTIAL`, `local` 어댑터 | 완료. 운영 gateway에 파서 3종 | [회사 반영](evidence/company-rollout/20261029/ai-gateway-rollout.md) |
| C6 | `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`, Route Handler | 완료 | [[06-UI-UX\|06]] |
| C7 | 결정 기록·audit·outbox·인앱 알림 2종 | 완료(코드). 운영 알림 처리는 알림 Worker 기동 뒤 | [[13-NOTIFICATIONS\|13]] |
| C8 | S-LIVE 실공고 `live` 분석·녹화 | 운영 실공고 분석 run 있음(재난 정신건강 45 보류, Bosun 정상). 녹화 남음 | [기록](evidence/company-rollout/20261029/ai-gateway-rollout.md) |
| C9 | 리허설·대체 경로·세 모드 | 로컬 `mock` 리허설 기록 있음. D1 리허설·촬영 남음 | [리허설 로그](evidence/demo-day/rehearsal-log.md) |
| X1 | E3 대조 실험(축소 규모) | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]) | [[21-MODEL-TRAINING\|21]] |
| X2 | 임팩트 예비 실험 n=3 | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]) | [[01-PRD\|01]] |
| X3 | 경쟁 서비스 비교 | 완료 | [비교](evidence/competitors/2026-10-19-competitors.md) |
| X4 | 제출물: 덱 20분·녹화 클립·기술 자료 | 초안. 완성 남음 | `docs/submission/` |
| X6 | Bosun LoRA 파인튜닝 트랙 | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 도구는 main에 있고 회사 서버 실행 기록은 없다 | [[22-FINETUNE-RUNBOOK\|22]] |
| 평가 리포트 | E0·E2·E3 전체 평가셋 리포트, `/admin/ai/eval-runs` | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). `/admin/ai/eval-runs`는 코드 없음 | [[12-ROADMAP\|12]] |
| BOOST-2 | 가정 재계산 | 완료(main, E2E 통과) | [E2E](evidence/boost2/20261020-boost2-what-if-e2e.md) |
| KAKAO | 카카오 "나에게 보내기" | main·운영 migration. 운영 연결 0건. S0 수신 시험·실수신 녹화 남음(알림 Worker 기동 뒤) | [[16-DECISIONS\|ADR-038]] |
| S5 | 변경 감지(revision diff·`BID_CHANGED`) | 완료(main). `BID_CHANGED`는 outbox에만 남고 조직 팬아웃은 남은 일이다(닫힌 미결정 30-4) | [기록](evidence/s5/summary.md) |
| N1 | 앱 셸·사이드바(ADR-021) | 완료(main). `/ops` 분리는 해커톤 뒤 | [[06-UI-UX\|06]] §4 |
| N2 | 설정 개인·조직 탭 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| N4a | `/people`·`/org-chart`, 본부·그룹 직속([[16-DECISIONS\|ADR-063]]) | 완료(main·운영) | [기록](evidence/people/20261019-people-read.md) |
| N8 | `/admin/ingestion` 데이터 수집 관리 | 완료(main·운영) | [보고](evidence/phase-3/admin-ingestion/20261020-n8-admin-ingestion-report.md) |
| N9 | 대시보드 카드 5개 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| P0-8 | 사전규격·발주계획 단계 연결 | 완료(main) | [기록](evidence/p08/README.md) |
| P1 | N3 관심 공고·N5 분석 결과 비교·N6 입찰 프로젝트·N7 인력 배치 시뮬레이션·N4b 조직·인력 ADMIN 편집([[16-DECISIONS\|ADR-042]]) | 완료(main·운영 배포) | [N3~N7](evidence/navigation/20261022-implementation.md) |
| 부처 공고 | 부처 지원사업 공고 수집·목록([[16-DECISIONS\|ADR-040]]) | 완료. 운영은 기업마당 전용 Worker. 화면 확인 남음 | [기업마당 정기 수집](evidence/program-notices/20261028-bizinfo-schedule.md) |
| 메일 알림 | [[16-DECISIONS\|ADR-041]] | 해커톤에서 뺐다(코드 없음) | [[13-NOTIFICATIONS\|13]] |
| 운영 구성 | Vercel web + 회사 redis-api·AI gateway·전용 Worker 4종(ingest·analysis·documents·부처 공고), Storage `bid-documents`·`bid-parsed`([[16-DECISIONS\|ADR-045·048·049]]) | 운영 중. 알림 Worker는 준비만 했다 | [[10-DEPLOYMENT\|10]] |
| 실운영 전환 | 3시간 정기 수집·수동 수집 gate·본문 없는 공고 분석 차단·상단바 실행 모드 표시 제거 | 운영 중. 운영 DEMO 삭제는 발표 뒤 | [기록](evidence/live-ops/20261026/summary.md) |
| 첨부 처리 | 다운로더·Documents Worker·`/parse`·분석의 첨부 텍스트 읽기([[16-DECISIONS\|ADR-054]] 3번)·첨부 조립 v0.2([[16-DECISIONS\|ADR-064]]) | 운영 중. ADR-055·056 제안 | [회사 기동](evidence/attachment-pipeline/20261028-documents-worker.md) |
| live 가드 | live에서 카카오 발송 수단이 비면 발송 끔. 이메일 가입 약관 동의 저장(`user_consents`) | main·운영 DB·Vercel. 간편 가입(OAuth) 동의는 후속 | [검증](evidence/live-guards/20261027.md) |
| 수집 장애 격리 | 외부 서비스별 키·한도 상태, 준비된 서비스만 정기 수집 | 운영 중. 켠 외부 서비스는 LH·KEPCO·K-water 입찰공고 | [기록](evidence/ingestion/20261027-source-isolation/summary.md) |
| 공공 입찰 확장 | 사업기회 연결·11열 목록·수집 운영([[16-DECISIONS\|ADR-047]]) | main·운영. 남은 외부 3종은 서비스별 검증 뒤 켠다 | [[2026-10-28-all-sources-activation\|계획]] |
| LH 입찰공고 | 정규화, LH 한정 인증·데이터 없음 판정, EUC-KR 응답 읽기 | 운영 수집 중 | [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md) |
| KEPCO·K-water 입찰공고 | KEPCO 전자입찰 계약·K-water 입찰공고 정규화와 정기 수집 | 운영 수집 중. KEPCO 첨부 주소는 해커톤 동안 막아 둔다([[16-DECISIONS|ADR-068]] 3번) | [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| 회사 공개 프로필 | 운영 DB 공개 자료 프로필(revision 5), `EXECUTIVE` 역할([[16-DECISIONS\|ADR-052]]) | 운영 반영. DEMO 18건이 이 프로필로 분석됐다 | [운영 반영](evidence/company-public-profile/20261027/prod-rollout.md) |
| 프로필 사진 | 비공개 버킷 `profile-photos`, 가입 신청 승인([[16-DECISIONS\|ADR-051]]) | 운영 적용. 기존 직원 찾기(U8)·재신청 진입점(U10) 화면은 없다 | [기록](evidence/integration/20261025-prod-apply-db-storage.md) |
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]). 인물 서랍 수행 이력·자격증, 이력 v2(1인당 3~5건·가상 발주기관) | 명부 완료·운영 DB 적용. 이력 v2 운영 DB `20261029001000` 적용(2026-10-29) | [[07-DATA-PIPELINE\|07]] · [수행 이력](evidence/people/20261029-project-history/README.md) |
| 화면 개편 | 파스텔 선택색·묶음 머리 아이콘 사이드바·업무 화면 공통 틀·랜딩 업무 데모([[16-DECISIONS\|ADR-061]]), 권고 표기 추천·보류·비추천([[16-DECISIONS\|ADR-062]]) | 운영 배포. 화면 동결 일정은 12 | [증거](evidence/ui-refresh/README.md) |
| 자격 갭 | `/gaps`: 실공고 구조화 필드 1차 선별·막는 자격 순위·보유 가정([[16-DECISIONS\|ADR-060]]) | 운영 배포. 운영 실숫자 미확인(로그인 필요) | [증거](evidence/gaps/20261028/README.md) |
| 발주 현황 | `/market`: 기간·기관·분야·예산 구간·주별 집계, 자격 갭 묶음 겹쳐 보기([[16-DECISIONS\|ADR-060]]) | 운영 배포. 운영 실숫자 미확인 | [1440 스크린샷](evidence/market/20261028/market-overview-1440.png) |
| 입찰 일정 | `/calendar`: 관심·프로젝트·관련 실공고 마감과 나라장터 원본 일정 5종, 일정 종류 거르기([[16-DECISIONS\|ADR-060]]) | 운영 배포. 마감 D-3·D-1 알림은 알림 Worker 기동 전이라 오지 않는다 | [증거](evidence/calendar/20261028/README.md) |
| 추천 분석 | 공고 상세 [추천 분석]: 버튼을 누를 때만 Qwen이 판단 이유·강점·보완할 점을 근거 번호와 함께 쓴다. 판정은 규칙 엔진 그대로([[16-DECISIONS\|ADR-066]]) | 운영 반영. 연 1회 재학습 구현은 발표 뒤 | [운영 반영](evidence/company-rollout/20261029/rec-insight-rollout.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다. 이 절은 최근 10줄만 둔다.

- 2026-10-30 · 인물 수행 이력·조직도 검색 리뷰 후속(`fix/people-review-followups`): 가상 직원 등급·수행 이력을 직급에 맞춤(사용자 결정 "등급·이력 함께", `synthetic-people/v3`: 인턴 초급 1건·담당 초급·책임 중급/고급·수석·팀장 고급/특급에 최근 PL/PM·본부장 특급, 마이그레이션 `20261030001000`은 직급이 fixture 와 같은 데모 행의 `grade`·`past_projects`·`capability_version`만 바꿈, 운영에서 직급이 다른 SOL-P0065(그룹장)는 `20261030001100`이 운영 직급 기준으로 맞춤, 등급은 점수 계산이 읽지 않음), 조직도 이름 찾기에 한글 조합 중 Enter 시험 2건 추가, 이전 증거의 건수 정정(3건 42·4건 88·5건 70) · `node --test scripts/people/*.test.mjs` 12/12(변형 5건 실패 확인), 브라우저 시험 9/9(변형 2건 실패 확인), `pnpm verify:changed` exit 0(web 999시험·AI 264·결정 57). 운영 DB `20261030001000`·`20261030001100` 적용(73개, `db-verify` 통과, 데모 200행 v3), main `a145cdc0` Vercel 배포 성공, 로그인 운영 화면 1440·1280 확인 20/20·콘솔 오류 0([기록](evidence/people/20261030-grade-alignment/README.md))
- 2026-10-30 · SOL Score `sol-v0.2.0`([[16-DECISIONS|ADR-071]]): 모르는 실적 금액·완료일은 빼고 계산, 금액 모르면 연 매출 대비 규모, 기술 아닌 요구 항목 거르기·목록에 없는 기술 0.5, 기관 선호 없으면 분야만. 저장 입력으로 다시 계산하는 `pnpm -C web score:rescore`(실행서 `infra/company/README.md` §11). main `161686a9` · `pnpm verify:changed` exit 0(웹 119파일·1001시험, lodestar), 전체 `pnpm verify` exit 0, 골든 94/72/68 그대로. 운영 반영: 회사 Analysis Worker·redis-api `7b5a79dc9054`(09:15) → main push(Vercel, 09:20) → 재채점 390건(09:35·09:37, 실공고 최고 60→88·DEMO 75→95, 실패 0·권고 변화 0·알림 0) → FX-01 추천 분석 다시 만듦(09:41). 발표 대본 ADR-059 개정(사용자 "1"): 가정 재계산은 S3 FX-01(세 자격 → 추천 92, 운영 화면 확인), S4는 FX-02 재분석(예상 59) → 사람 비추천. 19·덱 명세·18·10·11·12·제출 문서 숫자 갱신([기록](evidence/sol-score-v02/20261030/rollout.md))
- 2026-10-30 · 목록·대시보드 2차 가속([[16-DECISIONS|ADR-070]] 보강): 남은 대기(대시보드 약 1.6초·`/bids` 약 0.65초)의 원인인 IT 판정·정렬 함수 다섯 개를 planner가 풀어 넣도록 다시 만들고, summary 중복 후보·filter_options의 공고별 `it_scope(b)`를 조인으로(`20261030000100`). 운영 DB 반영, 대시보드 대기 약 1.6→0.75초·`/bids` 약 0.65→0.4초 · `database.test.mjs` 새 시험 마이그레이션 없이 실패·있으면 통과, IT 범위·집계 시험 11건 통과, 운영 읽기 측정 filter_options 1,729→197ms·중복 후보 265→38ms([기록](evidence/deployment/20261029-list-rpc-latency.md))
- 2026-10-30 · 운영 `/bids` 에 잠깐 "Minified React error #441" 이 보인 원인 확인: 10-29 16:42:53~55 KST `procurement_filter_options` 4건이 8초 statement timeout(57014, Supabase edge·postgres 로그)으로 실패해 서버 컴포넌트가 던졌다. 23:53 필터 캐시 배포 뒤 이 RPC 호출 0건·Supabase 4xx·5xx 0건. 업무 화면 오류 상자(`work-error.tsx`)가 Next 16.4·React 19.3 운영 문구를 가린 메시지로 알아보지 못해 영어 원문을 보여 주던 것을 한국어 대체 문구로 고침 · `work-error.test.ts` 새 시험(고치기 전 실패 확인), `pnpm verify:changed` exit 0(web 999시험). 화면 확인·배포 전
- 2026-10-29 · 조직도 이름 찾기 고침(`feat/org-search`): 재현해 보니 항목을 고르지 않은 Enter 는 목록만 닫았고, 목록이 닫히면 친 이름이 지워졌다(Base UI Combobox `value=null`). Autocomplete 로 바꾸고 [검색] 버튼·Enter 검색 추가 — 1명이면 그 팀으로 가고 여럿·없음은 목록·안내를 연다 · 새 브라우저 시험 7건(고치기 전 7건 실패 확인), `pnpm verify:changed` 통과(web 996시험), `test:browser` 105건 통과, 1440·1280 화면 확인([스크린샷](evidence/org-search/)). 로그인 E2E(`e2e-auth`)는 돌리지 않음
- 2026-10-29 · 인물 서랍에 수행 이력·자격증 구역 추가, 가상 직원 수행 이력 v2(1인당 3~5건·가상 발주기관 14곳·등급별 경력, 마이그레이션 `20261029001000`은 `past_projects`·`capability_version`만 바꿈, 점수 입력 불변). 운영 DB `20261029001000` 적용·`db-verify` 통과(마이그레이션 69개, v2 200행·발주기관 200), Vercel 운영 배포 `c8b4a504`(10-30 00:24). pre-push 를 막던 랜딩 업무 데모 E2E 를 순간 측정으로 보강(`e7cd5915`) · `node --test scripts/people/*.test.mjs` 9/9(변형 5건 실패 확인), `people:check:fixtures` ok, `pnpm verify:changed` exit 0(web 996시험), 격리 Supabase에 마이그레이션 적용 v2 200행, 서랍 1440·1280 넘침 0, 랜딩 시험 반복 8회 수정 전 8 failed·뒤 8 passed. `test:e2e:auth`·운영 로그인 화면 미확인([기록](evidence/people/20261029-project-history/README.md))
- 2026-10-29 · 목록 화면 이동 5~7초의 원인은 지역이 아니라 뷰 `opportunity_list_items` 전체를 계산하는 버전 확인 RPC(이동 한 번에 2번)와 공고마다 IT 판정을 도는 필터 선택지 RPC다. 조치([[16-DECISIONS|ADR-070]]): 목록 버전을 원본 표 해시로(`20261029000500`), 필터 선택지를 서버 데이터 캐시(10분)로. 운영 DB `000500`·main `a9d3a107` 반영 · 반영 뒤 edge 로그로 version 22~117ms, 두 번째 `/bids` 방문 filter_options 호출 없음([기록](evidence/deployment/20261029-list-rpc-latency.md))
- 2026-10-29 · 지원사업 IT 판정을 제목 본문(괄호 밖)으로 좁힘([[16-DECISIONS|ADR-069]] 7번): 사업개요·괄호 안 사업명은 보지 않는다 · `list.service.test.ts` 새 시험 수정 전 실패 확인, `pnpm verify:changed` exit 0(web 996시험), 운영 지원사업 104건 대조로 마감 전 IT 30→19건
- 2026-10-29 · IT 공고만 보이기([[16-DECISIONS|ADR-069]]): 목록·집계·고르기 목록에서 IT 아닌 공고 숨김, 분야 칩 8개, AI·SI 우선 + 추천순, 지원사업 IT만, 검토 대기에서 일괄 분석 제외. 운영 DB `000300`·`000400`, main `7f6909ec`, 회사에서 IT 실공고 371건 1회 일괄 분석 · 통합 브랜치 전체 `pnpm verify` exit 0(web 시험 995건)·`test:browser` 98건, 독립 리뷰 1회 반영, `db-verify` 통과, D1 10개 화면 1440·1280 넘침 0, 일괄 분석 `completed=371 failed=0`([기록](evidence/it-scope/prod-20261029/README.md), [화면 증거](evidence/it-scope/bids-qa-20261029.md))
- 2026-10-29 · 랜딩 서비스 소개를 공고 수집 서비스 4곳(첫 글자 + XX)과 SOL RADAR의 8행 기능 비교 표로 교체해 운영 배포(`32569fa6`·설명 문구 `3d1477c4`, [스펙](../polaris/specs/done/2026-10-29-landing-competitor-table.md), [경쟁 재조사](evidence/competitors/2026-10-29-competitors.md)). 뒤이어 주요 기능 "공고 수집과 탐색" 문구를 운영 출처로 고치고, [[18-HACKATHON|18]] §3.2.1·덱 명세 슬라이드 9를 같은 표로 바꿈 · `e2e/landing-sections.spec.ts` 17 passed(구현 전 4 failed, 최종 리뷰 뒤 대비·넘침·실명 시험 보완), 병합 뒤 전체 `pnpm verify` exit 0, 운영 1440·1280 표 넘침 0·실명 0·기호 대비 최저 5.03:1·콘솔 오류 0([증거](evidence/landing-comparison/README.md))

## 관련 문서

- [[00-README|문서 인덱스]]
- [[10-DEPLOYMENT|10 배포]]
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷·남은 일정 제안
- [[16-DECISIONS|결정 기록]]
- [[18-HACKATHON|18 해커톤]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
