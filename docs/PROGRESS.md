---
title: "진행 상황"
doc: "progress"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-29
---

# 진행 상황

이 문서는 지금 상태의 정본이다. 형식은 현재 상태 요약, 기능 상태 표, 최근 작업 로그다([[16-DECISIONS|ADR-057]]). 표의 칸에는 현재 값과 증거 링크 하나만 둔다. 일정 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표에만 둔다. 옛 작업 로그와 지난 값은 git 이력에 있다.

## 현재 상태 요약 (2026-10-29)

- 공식 제출은 2026-11-03, 발표는 2026-11-04다([[16-DECISIONS|ADR-054]]). 발표는 덱 20분 + 녹화 클립이다. D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE 녹화(동국대 44 run, [[16-DECISIONS|ADR-068]] 5번), C9 D1 리허설·촬영이다. C1 ④ 파서 "지원" 판정은 해커톤 뒤 벤치마크 뒤로 미뤘다(ADR-068 1번). 제출물(X4)은 초안이다.
- 운영에서 실공고를 수집·첨부 파싱·분석한다. 수집 출처는 나라장터·LH·KEPCO·K-water 입찰공고와 기업마당 부처 공고다. 실공고 분석과 추천 분석(ADR-066)이 운영에서 돈다(아래 운영 상태).
- 운영에 알림 Worker가 없어 인앱·카카오·마감 알림이 처리되지 않는다. 기동은 승인 뒤다(아래 "알림 처리" 행).
- X6 파인튜닝과 실험 E0~E3·X1·X2는 발표 뒤 진행 예정([[16-DECISIONS|ADR-067]])이다.

### 운영 상태

값은 증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 현재 값 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `3ae02acf`(추천 분석) Production 배포 성공. 함수 지역 `syd1`([지역 기록](evidence/deployment/20261028-region-latency.md)). [기록](evidence/company-rollout/20261029/rec-insight-rollout.md) | 2026-10-29 11:31 KST |
| `/health/ready` | 200(`db`·`redis`·`storage` ok, `ai: local`). `ai`는 회사 AI gateway가 보고한 provider 값이다. [기록](evidence/company-rollout/20261029/rec-insight-rollout.md) | 2026-10-29 11:31 KST |
| 운영 DB | migration 66개, 마지막 `20261029000200`(추천 분석 보안 보강). db-push·`db-verify` 통과. [기록](evidence/company-rollout/20261029/rec-insight-rollout.md) | 2026-10-29 11:30 KST |
| 회사 반영 | AI gateway·Analysis Worker·redis-api는 `384e469857f0`(main + 회사 carry). gateway는 같은 호스트 Bosun `127.0.0.1:8009`를 부른다. `sol-radar-app` checkout은 22:15 보조 수집 예약 때문에 옮기지 않았다. [기록](evidence/company-rollout/20261029/rec-insight-rollout.md) | 2026-10-29 11:37 KST |
| 나라장터 정기 수집 | KST 3시간 정각. ingest Worker `cbb3831e86da`. 보조 조회(면허·지역·첨부)는 기능별 한도 각 1,000회이고, 밀린 공고는 같은 revision에 하루 100~200건씩 다시 채운다. [기록](evidence/ingestion/20261029-g2b-aux-budget.md) | 2026-10-29 10:49 KST |
| 외부 입찰공고(LH·KEPCO·K-water) | 같은 ingest Worker가 3시간 정각에 받는다. KEPCO는 공고 없는 날 HTTP 404를 빈 쪽으로 읽는다. 남은 외부 3종(K-water 발주계획·LH 사전규격·조달요청)은 꺼짐. [기록](evidence/ingestion/20261028-kepco-contract/no-data-404.md) | 2026-10-29 09:40 KST |
| 부처 공고(기업마당) | 전용 Worker가 3시간 정각에 받는다. 첫 정기 회차 `SUCCEEDED` 100/100, `program_notices` 100행. `/bids` "부처 지원사업" 탭 화면은 아직 보지 않았다. [기록](evidence/company-rollout/20261028/sources-rollout.md) | 2026-10-28 18:00 KST |
| 첨부 처리(Documents Worker) | 운영 중. `PARSED` 393·`FAILED` 0·다운로드 실패 0, `PENDING` 6,127(그 시각 기준). 지금 수는 미확인. [기록](evidence/attachment-pipeline/20261028-documents-worker.md) | 2026-10-28 19:0x KST |
| 분석 | 실공고 분석 run이 있다. 2026-10-29 3건 모두 보류(38·44·45)이고, 부경대 38은 `RULES_ONLY`이고 사용자 결정으로 멈췄다. DEMO는 FX-02만 옛 분석(66 보류, 프로필 revision 2), 나머지 18건은 revision 5. [기록](evidence/company-rollout/20261029/ai-gateway-rollout.md) | 2026-10-29 |
| 추천 분석 | 운영 반영. 실공고(재난 정신건강, 45 보류)·DEMO FX-01(58 보류) 모두 `DONE`·`MODEL`, 화면 금지어 0. [기록](evidence/company-rollout/20261029/rec-insight-rollout.md) | 2026-10-29 11:37 KST |
| DEMO 공고 | 19건 그대로, 16건 마감 +15일. 운영 DEMO 삭제는 발표 뒤다. FX-02는 촬영 때만 재분석한다([[16-DECISIONS\|ADR-059]]). [기록](evidence/demo-deadline/20261027/prod-run.md) | 2026-10-28 09:48 KST |
| 알림 처리 | 처리되지 않는다. 회사에 알림 전용 Worker가 없고 outbox만 쌓인다. 기동 전 쌓인 수는 실행서 §9.1 SQL로 센다(`infra/company/README.md` §9). [기록](evidence/company-rollout/20261028/sources-rollout.md) | 2026-10-28 |
| 카카오 | 운영 연결·발송 0건 | 2026-10-27 |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트와 직접 돌린 `pnpm verify`다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]) | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.

### 남은 일

- [[16-DECISIONS|ADR-056]] 대안 A(분석이 그 revision 문서 처리를 최대 300초 기다린다) 구현은 브랜치 `feat/analysis-wait-documents`에서 하고 있다. 검증·main 병합 뒤 회사 Analysis Worker 재생성(승인 뒤)으로 운영에 들어간다.
- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. 순서는 알림 전용 Worker 회사 기동(승인 뒤) → 카카오 연결·S0 수신 시험 → D1 리허설·촬영(S-LIVE·카카오 실수신, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출 → 발표다.
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 43(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]).
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
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]) | 완료, 운영 DB 적용 | [[07-DATA-PIPELINE\|07]] |
| 화면 개편 | 파스텔 선택색·묶음 머리 아이콘 사이드바·업무 화면 공통 틀·랜딩 업무 데모([[16-DECISIONS\|ADR-061]]), 권고 표기 추천·보류·비추천([[16-DECISIONS\|ADR-062]]) | 운영 배포. 화면 동결 일정은 12 | [증거](evidence/ui-refresh/README.md) |
| 자격 갭 | `/gaps`: 실공고 구조화 필드 1차 선별·막는 자격 순위·보유 가정([[16-DECISIONS\|ADR-060]]) | 운영 배포. 운영 실숫자 미확인(로그인 필요) | [증거](evidence/gaps/20261028/README.md) |
| 발주 현황 | `/market`: 기간·기관·분야·예산 구간·주별 집계, 자격 갭 묶음 겹쳐 보기([[16-DECISIONS\|ADR-060]]) | 운영 배포. 운영 실숫자 미확인 | [1440 스크린샷](evidence/market/20261028/market-overview-1440.png) |
| 입찰 일정 | `/calendar`: 관심·프로젝트·관련 실공고 마감과 나라장터 원본 일정 5종, 일정 종류 거르기([[16-DECISIONS\|ADR-060]]) | 운영 배포. 마감 D-3·D-1 알림은 알림 Worker 기동 전이라 오지 않는다 | [증거](evidence/calendar/20261028/README.md) |
| 추천 분석 | 공고 상세 [추천 분석]: 버튼을 누를 때만 Qwen이 판단 이유·강점·보완할 점을 근거 번호와 함께 쓴다. 판정은 규칙 엔진 그대로([[16-DECISIONS\|ADR-066]]) | 운영 반영. 연 1회 재학습 구현은 발표 뒤 | [운영 반영](evidence/company-rollout/20261029/rec-insight-rollout.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다. 이 절은 최근 10줄만 둔다.

- 2026-10-29 · 문서 정리 2차: 정본·제출물의 낡은 사실 고침, [[16-DECISIONS|ADR-067]](X6 발표 뒤) 추가, 16 218→156KB·PROGRESS 71→21KB, 끝난 계획 7개·링크 없는 증거 66개(7.2MB) 삭제(원본·계획은 git `03baf23d`) · 문서만 바꿔 `pnpm verify:changed` 검사 단계 0개, 깨진 링크 48→46(남은 것은 정리 전부터 있던 옛 증거 링크)
- 2026-10-29 · 추천 분석 운영 반영: 운영 DB `20261029000100`·`000200`, Vercel, 회사 AI gateway·Analysis Worker·redis-api 재생성 · `db-verify` 통과, `/health/ready` 200, 운영 화면 실공고·DEMO 각 1건 `DONE`·`MODEL`([기록](evidence/company-rollout/20261029/rec-insight-rollout.md))
- 2026-10-29 · 추천 분석 구현 main 병합([[16-DECISIONS|ADR-066]]) · 전체 `pnpm verify` exit 0, 격리 로컬 스택 끝까지 확인 통과([증거](evidence/rec-insight/README.md))
- 2026-10-29 · 나라장터 보조 조회 한도를 기능별로 나누고 같은 revision에 다시 채움 · `pnpm verify:changed` 통과, 회사 `--check` exit 0, 1건 채움 확인([기록](evidence/ingestion/20261029-g2b-aux-budget.md))
- 2026-10-29 · KEPCO 공고 없는 날 HTTP 404를 빈 쪽으로 읽고 조회 시작일을 3일 앞당김 · `pnpm verify:changed` 통과, 회사 재생성 healthy([기록](evidence/ingestion/20261028-kepco-contract/no-data-404.md))
- 2026-10-29 · 회사 AI gateway 두 번 교체(첨부 조립 v0.2 [[16-DECISIONS|ADR-064]], 번역 비교 표현 [[16-DECISIONS|ADR-065]], 인용 300자)와 실공고 3건 분석 · gateway `/health` ok·`registryMatch: true`·파서 3종([기록](evidence/company-rollout/20261029/ai-gateway-rollout.md))
- 2026-10-28 · 운영 조직도 0명 부서 해소와 본부·그룹 직속 직원([[16-DECISIONS|ADR-063]]) · `pnpm verify:changed` exit 0, 조직도 브라우저 시험 1440·1280 통과([증거](evidence/org-rebalance-20261028/))
- 2026-10-28 · 운영 화면 이동 지연 조치(함수 지역 `syd1`, 렌더 조회 합치기) · Supabase 호출 한 번 p50 660→16ms([기록](evidence/deployment/20261028-region-latency.md))
- 2026-10-28 · 화면 UI 개편과 권고 표기 추천·보류·비추천([[16-DECISIONS|ADR-061]]·[[16-DECISIONS|ADR-062]]) 운영 배포 · 랜딩 1440·1280 넘침·콘솔 오류 0([증거](evidence/ui-refresh/README.md))
- 2026-10-28 · 공공데이터 수집 서비스 회사 반영(LH·KEPCO·K-water 입찰공고, 기업마당 전용 Worker, Documents Worker) · LH 첫 회차 `SUCCEEDED` 26건, 기업마당 100/100, Documents `FAILED` 0([기록](evidence/company-rollout/20261028/sources-rollout.md))

## 관련 문서

- [[00-README|문서 인덱스]]
- [[10-DEPLOYMENT|10 배포]]
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷·남은 일정 제안
- [[16-DECISIONS|결정 기록]]
- [[18-HACKATHON|18 해커톤]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
