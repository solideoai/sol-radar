---
title: "진행 상황"
doc: "progress"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-28
---

# 진행 상황

이 문서는 지금 상태의 정본이다. 형식은 현재 상태 요약, 기능 상태 표, 최근 작업 로그다([[16-DECISIONS|ADR-057]]). 일정 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표에만 둔다. 옛 작업 로그와 날짜별 절은 git 이력에 있다(원문: git `5261730f` 의 `docs/PROGRESS.md`).

## 현재 상태 요약 (2026-10-27)

- 공식 제출은 2026-11-03, 발표는 2026-11-04다([[16-DECISIONS|ADR-054]]). 발표는 덱 20분 + 녹화 클립이다. D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE, C9 D1 리허설·촬영, C1 ④ 파서 "지원" 판정이다. 제출물(X4)은 초안이다.
- P1 다섯 화면과 확장 컷 항목은 main에 있다(아래 기능 상태 표).
- 막힌 곳은 회사 반영이다(아래 운영 상태 "회사 반영" 행). 그 전까지 운영의 실공고 분석은 0건이다. 본문이 비어 `409 ANALYSIS_SOURCE_MISSING`이 난다.

### 운영 상태

값은 문서·증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 상태 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `5261730f` Production 배포 성공(그 전 `8cfaac31` 배포는 12:37 KST) | 2026-10-27 |
| `/health/ready` | 200(`db`·`redis`·`storage` ok, `ai: local`). `ai`는 회사 AI gateway가 보고한 provider 값이다 | 2026-10-27(시각 기록 없음) |
| 운영 DB | migration 63개, 마지막 `20261027000700`(회사 공개 프로필·`EXECUTIVE`). db-push·`db-verify` 통과. `000500`·`000600`은 [기록](evidence/prod-migrations/20261027/README.md), `000700`은 [기록](evidence/company-public-profile/20261027/prod-rollout.md) | 2026-10-27 |
| 나라장터 정기 수집 | 3시간마다(KST 00·03·…·21시). 정기 회차 2026-10-26 18:00~10-27 21:00 10회 모두 `SUCCEEDED`. live 공고 1,247건(`bid_notices` `is_demo=false`). 21:00 회차부터 새 ingest Worker `24f2ac84963c`가 돈다([기록](evidence/company-rollout/20261027/ingest-worker-recreate.md)) | 2026-10-27 21:02 KST(최신 수집) |
| 분석 | 실공고 0건. 실모델 run은 가상 공고 19건이다. FX-02 1건(66점 WATCH, 프로필 revision 2, [점검](evidence/demo-deadline/20261027/README.md) S4 절), DEMO 17건(프로필 revision 5, 43~75점 모두 WATCH, `Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, [기록](evidence/company-public-profile/20261027/prod-rollout.md)), FX-03 1건(프로필 revision 5, 53점 WATCH, [기록](evidence/company-public-profile/20261028/fx-forecast.md)) | 2026-10-28 09:47 KST |
| DEMO 공고 | 19건 그대로. 16건 마감 +15일([기록](evidence/demo-deadline/20261027/prod-run.md)). 운영 DEMO 삭제(실운영 전환 A단계)는 발표 뒤다. 백업 스키마 `demo_cleanup_20261026`이 있다. 회사 공개 프로필(revision 5)로 17건을 다시 분석했고, 2026-10-28에 FX-03도 다시 분석했다(53 WATCH). FX-02만 옛 분석(revision 2)이라 대시보드 "분석 대기" 1로 보인다. 발표 대본은 이 상태 그대로 쓴다([[16-DECISIONS\|ADR-059]]) | 2026-10-28 09:48 KST |
| 회사 반영 | 일부 완료(이 행이 정본이다). redis-api `aa0c9f9`(이미지 `9458368e`), AI gateway·Analysis Worker `9bb24b002f9b`로 갱신했다. gateway의 `KEV_BASE_URL`은 회사 호스트 Bosun `http://127.0.0.1:8009`로 바꿨다(Nginx `/sol-radar/kev` 경로는 없다). ingest Worker는 `sol-radar-app` `24f2ac8`에서 `24f2ac84963c`로 재생성했다(롤백 태그 `rollback-20261027`, `g2b-scheduled` 1개 유지, 외부 6종 비활성, 21:00 회차 `SUCCEEDED`, [기록](evidence/company-rollout/20261027/ingest-worker-recreate.md)). 남은 것: [[2026-10-27-company-rollout-attachments\|회사 반영 실행서]] §8 Documents Worker 기동(사용자 보류: 첨부 3,152건 `PENDING`의 처리량·동시성·Storage 비용 확인 전 기동 금지). LH A단계도 보류([기록](evidence/company-public-profile/20261027/prod-rollout.md)) | 2026-10-27 21:02 KST |
| 카카오 | 운영 연결·발송 0건 | 2026-10-27 |
| 알림 처리 | 처리되지 않는다(코드 확인, 문서 밖 발견 1). 회사 Worker(ingest·analysis·documents 전용)에 알림·마감 등록이 없다. 알림 전용 Worker를 main에 넣었다(`c2d5d0b7`, 실행서 `infra/company/README.md` §9). 회사 기동 전이다. 쌓인 outbox 수는 운영에서 세지 않았다 | 2026-10-27 |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트로 한다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]). 승인하면 최근 작업 로그에 한 줄로 남긴다 | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.
2. X6 파인튜닝(회사 GPU 학습)과 실험 E0~E3·X2의 실행 여부(미결정). [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]의 B2(회사 서버 준비·확인)·B5(F1~F3 실행·채점) 단계도 같이 미결정이다.
3. [[16-DECISIONS|ADR-055]](제안): 범위 밖 첨부를 `PENDING`으로 두고 우리 쪽 장애는 미루는 documents 계약 변경을 받아들일지.
4. [[16-DECISIONS|ADR-056]](제안): 첨부 일부만 파싱된 추출의 재사용을 분석 대기(A)로 막을지, `source_hash` 캐시 키(B)로 막을지.
5. 파서 "지원" 판정: 코드는 [[03-AI-PIPELINE|03]] §10.3 결정 규칙 4번 판정 없이 `PARSED`를 낸다. 규칙대로 고칠지, 실표본 6건으로 규칙을 바꿀지.
6. LH 입찰공고(15159012) 운영 반영. A단계(LH를 끈 채 코드를 main·회사 ingest Worker에 반영)는 나라장터 정기 수집 `SUCCEEDED`를 확인한 뒤 승인하고, B단계(registry 켜기)는 따로 승인한다([[2026-10-27-lh-bid-notice-activation|LH 활성화 계획]] §4).

### 남은 일

- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. 순서는 회사 반영 → 실공고 S-LIVE 분석 run → D1 리허설·촬영(S-LIVE·카카오 실수신, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출 → 발표다.
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 43(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]). 촬영의 S4 [재분석]만 한다.
- 덱 pptx(`docs/submission/deck/sol-radar-deck.pptx`, git 밖)는 10-28 에 [[slides-spec|덱 제작 명세]]와 18장을 대조해 글·표·노트를 맞췄다(10-25 원본은 `sol-radar-backups/deck/` 에 백업). 그림·포스터는 옛 mock 화면 그대로라 촬영 뒤 바꾼다. 명세가 정본이다.
- 카카오 실수신 녹화 전에 사용자 연결과 S0 수신 시험을 한다.
- 열린 확인: 운영 로그인 화면 확인(DEMO 마감 이동 뒤), 로그인 뒤 E2E(`test:e2e:work`·`test:e2e:auth`, Compose 필요. 수집 장애 격리·사이드바 되돌림·실운영 전환 변경에서 미실행), 배포 뒤 사진 1장 올리기·지우기([릴리스 실행서](evidence/integration/20261025-release-runbook.md) §4).

**16에서 넘어온 할 일**(번호는 [[16-DECISIONS|16]]의 미결정·닫힌 미결정 번호):

- 해커톤 전
  - 회사 vLLM 장문 guided JSON·지연 실측(미결정 17), Bosun 질문당 지연 p95(미결정 24). `prompt_logprobs` 확인은 E3(X1, 미결정)용이다.
  - P1 화면을 어느 데모 장면에서 보일지 정한다([[18-HACKATHON|18]]·[[19-DEMO-SCENARIO|19]], [[16-DECISIONS|ADR-042]]).
- X6 파인튜닝·평가를 실행할 때(실행 여부 미결정)
  - F1 전 필수: 후보 목록 교차 시험. `services/ai/eval/sol_eval/bosun_records.py:70`과 `services/decision/src/sol_decision/contract.py:45`의 `candidates_for`가 따로 구현돼 있다(닫힌 미결정 26-12).
  - F1 전 필수: `infra/gpu/bosun-f1.sh` 결과 파서 키. 로그 `s/step`(214행)과 `training_metrics.json` snake_case 키(236행 등)가 학습기 출력(`metrics` 아래 camelCase)과 다르다(닫힌 미결정 26-15).
  - 채점 `--data` 파일 sha256을 번들 manifest와 대조한다(닫힌 미결정 26-17).
  - 회사 GPU 서버에 `sol_eval`을 설치한다. 절차 초안은 [[22-FINETUNE-RUNBOOK|22]] §3.2다(닫힌 미결정 29-2).
  - E2 한국어 내보내기(`--language ko`)와 언어 짝 비교를 만든다(닫힌 미결정 29-6).
- 해커톤 뒤·NestJS 전환 때
  - `X-Request-Id`를 이어 받는다. `web/app/api/v1/_lib/http.ts:45·47·55`가 응답마다 새 UUID를 만든다(닫힌 미결정 26-4, [[16-DECISIONS|ADR-028]] 전환 때).
  - 오래 남은 g2b `RUNNING` 행의 시간 기준 자동 `FAILED` 전환(닫힌 미결정 25). 지금은 `pnpm ops:close-stale-runs`로 푼다.
  - `stateTemplate` 대조. F1 산출물부터 의미가 있다(닫힌 미결정 26-13 (b)).
  - 결정 모델 `manifest.json` sha256 identity 대조(닫힌 미결정 28 ②).
  - 나라장터 목록과 부처 공고 섞기. 사용자가 원하면 다시 정한다([[16-DECISIONS|ADR-040]]).
  - 간편 로그인 제공자(구글·카카오·네이버) 설정. 상태는 미확인이다([[16-DECISIONS|ADR-018]] 후순위).

**문서 밖 발견**([[2026-10-27-docs-cleanup-plan|문서 정리 계획]] §3, 따로 정할 것):

1. 운영 알림이 처리되지 않는다(코드 확인). 회사 Worker는 수집·분석·첨부 전용 셋이고, 알림·마감 등록(`notifyWorkerRegistration`·`deadlineWorkerRegistration`)은 전체 Worker `web/worker/main.ts:857-914`에만 있다. 알림 전용 Worker(`web/worker/notify-only-main.ts`, `infra/compose.notify-only.company.yaml`)와 실행서(`infra/company/README.md` §9)를 준비했다. 회사 기동은 승인 뒤다. 처음 기동하면 쌓인 outbox가 나이 제한 없이 처리되어 지난 분석·배정 알림이 한꺼번에 벨에 뜬다. 기동 전에 실행서 §9.1의 읽기 전용 SQL로 센다. 카카오 실수신 녹화(§9.6)는 이 Worker가 떠야 한다.
2. 발표 중 데이터 출처가 바뀔 수 있다(main `5a9030dd`에서 고침, Vercel 배포). 사이드바 링크에 출처(`?origin=`)가 없어 운영 기본 출처(실공고)로 바뀌었다. 이제 마지막으로 본 목록 화면(`/dashboard`·`/bids`·`/watchlist`)의 출처를 창 안에 기억해 사이드바의 같은 세 링크에 붙인다(`web/components/nav-origin.ts`). 공고 상세를 거쳐도 이어지고, 새로 고치면 잊는다. 상단바 DEMO 배지는 여전히 주소의 `?origin=`만 읽는다(`web/components/topbar-demo-indicator.tsx:25`). 그래서 운영 공고 상세에서는 상단바 배지가 없다(제목 위 DEMO 배지는 있다).
3. ADR-044 때 코드가 남아 있다: `services/ai/app.py`·`services/ai/vercel_build.py`·`services/ai/tests/test_vercel.py`.
4. 회사 AI 모드 서술이 운영과 다르다. ADR-049·회사 실행서는 "mock 유지"라고 쓰고, 운영 readiness는 `ai: local`을 보고한다. 확인하려면 운영 조회 승인이 필요하다(미확인).
5. CI가 돌지 않는다(위 운영 상태).

## 기능 상태 표

해커톤 컷의 정의는 [[12-ROADMAP|12 로드맵]]이다. 이 표가 각 항목의 현재 상태다. "main"은 main에 병합됐다는 뜻이다.

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| C0 | Phase 0 마감: Compose·gateway 골격·health | 완료 | [통합 기동](evidence/phase-0/c0-integration-20261019.md) |
| C1 | P0-0 외부 의존성 ①~④ | ①② 완료. ③ Qwen probe 통과, 운영 실모델 run 1건. ④ 파서 구현, 실표본 비교·"지원" 판정 규칙은 남음 | [점검표](evidence/phase-0/external-deps.md), [[03-AI-PIPELINE\|03]] §10.3 |
| C2 | DB·RLS·`sol_role`·`pnpm demo:reset` | 완료. 운영 DB migration 63개 | [[04-DATABASE\|04]] |
| C3 | 수집·정규화·revision·documents job·첨부 다운로드 | 수집 완료(운영 3시간 정기 수집). documents job·다운로더는 main·운영 DB 적용, 회사 반영 대기 | [구현](evidence/attachment-pipeline/20261027-implementation.md) |
| C4 | 규칙 엔진·골든 94/72/68·인력 200명 입력 | 완료. FX-15 68, 가용 95.5 FTE([[16-DECISIONS\|ADR-043]]) | [골든](evidence/phase-4/goldens-report.txt) |
| C5 | gateway `/extract`·`/kev`·`/explain`·`/parse`, worker 분석·`PARTIAL`, `local` 어댑터 | 완료. `/parse` 파서는 회사 반영 대기 | [파서 확인](evidence/parser/20261027-parser-check.md) |
| C6 | `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`, Route Handler | 완료 | [[06-UI-UX\|06]] |
| C7 | 결정 기록·audit·outbox·인앱 알림 2종 | 완료 | [[13-NOTIFICATIONS\|13]] |
| C8 | S-LIVE 실공고 1건 `live` 분석·녹화 | 남음. 운영 실공고 분석 0건. 그 전 기록은 격리 로컬 1건(`PARTIAL`·`RULES_ONLY`) | [기록](evidence/demo-day/20261020-1434/run-modes.md) |
| C9 | 리허설·대체 경로·세 모드 | 로컬 `mock` 리허설 기록 있음. D1 리허설·촬영 남음 | [리허설 로그](evidence/demo-day/rehearsal-log.md) |
| X1 | E3 대조 실험(축소 규모) | 미결정 | [[21-MODEL-TRAINING\|21]] |
| X2 | 임팩트 예비 실험 n=3 | 미결정 | [[01-PRD\|01]] |
| X3 | 경쟁 서비스 비교 | 완료 | [비교](evidence/competitors/2026-10-19-competitors.md) |
| X4 | 제출물: 덱 20분·녹화 클립·기술 자료 | 초안. 완성 남음 | `docs/submission/` |
| X6 | Bosun LoRA 파인튜닝 트랙 | 실행 여부 미결정([[16-DECISIONS\|ADR-054]]). 도구는 main에 있고 회사 서버 실행 기록은 없다 | [[22-FINETUNE-RUNBOOK\|22]] |
| BOOST-2 | 가정 재계산 | 완료(main, E2E 통과) | [E2E](evidence/boost2/20261020-boost2-what-if-e2e.md) |
| KAKAO | 카카오 "나에게 보내기" | main, 운영 migration 적용. 운영 연결 0건. S0 수신 시험·실수신 녹화 남음 | [[16-DECISIONS\|ADR-038]] |
| S5 | 변경 감지(revision diff·`BID_CHANGED`) | 완료(main). `BID_CHANGED`는 outbox에만 남는다. 조직 팬아웃(벨 알림)은 남은 일이다(`web/server/notifications/outbox.model.ts:6`, [[16-DECISIONS\|16]] 닫힌 미결정 30-4) | [기록](evidence/s5/summary.md) |
| N1 | 앱 셸·사이드바(ADR-021) | 완료(main). `/ops` 분리는 해커톤 뒤 | [[06-UI-UX\|06]] §4 |
| N2 | 설정 개인·조직 탭 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| N4a | `/people`·`/org-chart` | 완료(main) | [기록](evidence/people/20261019-people-read.md) |
| N8 | `/admin/ingestion` 데이터 수집 관리 | 완료(main, migration 운영 적용) | [보고](evidence/phase-3/admin-ingestion/20261020-n8-admin-ingestion-report.md) |
| N9 | 대시보드 카드 5개 | 완료(main) | [통합 기록](evidence/committed-integrations/integration.md) |
| P0-8 | 사전규격·발주계획 단계 연결 | 완료(main) | [기록](evidence/p08/README.md) |
| 부처 공고 | 부처 지원사업 공고 수집·목록([[16-DECISIONS\|ADR-040]]) | 완료(main) | [기록](evidence/program-notices/recording-20261021.md) |
| 평가 리포트 | E0·E2·E3 전체 평가셋 리포트, `/admin/ai/eval-runs` | 리포트는 미결정, `/admin/ai/eval-runs`는 코드 없음 | [[12-ROADMAP\|12]] |
| 메일 알림 | [[16-DECISIONS\|ADR-041]] | 해커톤에서 뺐다(코드 없음) | [[13-NOTIFICATIONS\|13]] |
| P1 | N3 관심 공고·N5 분석 결과 비교·N6 입찰 프로젝트·N7 인력 배치 시뮬레이션·N4b 조직·인력 ADMIN 편집([[16-DECISIONS\|ADR-042]]) | 완료(main·운영 배포) | [N3~N7](evidence/navigation/20261022-implementation.md), [N4b](evidence/n4b-team-edit/20261024-verify.md) |
| 운영 구성 | Vercel web + 회사 redis-api·AI gateway·Worker 3종, Storage `bid-documents`·`bid-parsed`([[16-DECISIONS\|ADR-045·048·049]]) | 운영 중. 회사 AI 모드는 문서 밖 발견 4 | [[10-DEPLOYMENT\|10]] |
| 실운영 전환 | 3시간 정기 수집·수동 수집 gate·본문 없는 공고 분석 차단·상단바 실행 모드 표시 제거 | 운영 중. 운영 DEMO 삭제는 발표 뒤 | [기록](evidence/live-ops/20261026/summary.md) |
| 첨부 처리 | 다운로더·Documents Worker·`/parse`·분석의 첨부 텍스트 읽기([[16-DECISIONS\|ADR-054]] 3번) | main·운영 DB·Vercel 반영, 회사 반영 대기. ADR-055·056 제안 | [구현](evidence/attachment-pipeline/20261027-implementation.md), [격리 실행](evidence/attachment-pipeline/20261027-isolated-run.md) |
| live 가드 | live에서 카카오 발송 수단이 비면 발송 끔. 이메일 가입 약관 동의 저장(`user_consents`) | main·운영 DB·Vercel 반영. 간편 가입(OAuth) 동의는 후속 | [검증](evidence/live-guards/20261027.md) |
| 수집 장애 격리 | 외부 서비스별 키·한도 상태, 준비된 서비스만 정기 수집 | main·Vercel 반영, 회사 반영 대기. 기관별 registry 활성화 남음 | [기록](evidence/ingestion/20261027-source-isolation/summary.md) |
| 공공 입찰 확장 | 사업기회 연결·11열 목록·수집 운영([[16-DECISIONS\|ADR-047]]) | main·운영 적용. 신규 6개 서비스는 서비스별 검증 뒤 켠다 | [기록](evidence/procurement-expansion/20261022-release.md) |
| LH 입찰공고 | LH 입찰공고(15159012) 수집: 정규화, LH 한정 인증·데이터 없음 판정, EUC-KR 응답 읽기 | 브랜치 `feat/lh-bid-notice`(main 미병합). 실응답 10건 모두 정규화. registry `enabled: false`·`NOT_VERIFIED`·`NOT_REQUESTED`. 운영 반영 A단계·B단계 승인 대기(사용자 결정 대기 6) | [[2026-10-27-lh-bid-notice-activation\|계획]], [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md) |
| 회사 공개 프로필 | 운영 DB 공개 자료 프로필, `EXECUTIVE` 역할([[16-DECISIONS\|ADR-052]]) | main·운영 DB(`000700`, 프로필 revision 5)·Vercel·회사 gateway·Analysis Worker 반영, DEMO 17건 재분석 완료, FX-03 재분석(2026-10-28, 53 WATCH). 발표 대본은 [[16-DECISIONS\|ADR-059]]로 정했다 | [로컬 확인](evidence/company-public-profile/20261027/local/local-check.md) |
| 프로필 사진 | 비공개 버킷 `profile-photos`, 가입 신청 승인([[16-DECISIONS\|ADR-051]]) | 운영 적용(migration·버킷·웹 배포). 기존 직원 찾기(U8)·재신청 진입점(U10) 화면은 없다 | [기록](evidence/integration/20261025-prod-apply-db-storage.md) |
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]) | 완료, 운영 DB 적용 | [[07-DATA-PIPELINE\|07]] |
| 화면 정리 | 사이드바 묶음 3개·트리·아이콘, 대시보드 "공공조달 요약" 숫자 띠, 랜딩 | 완료(운영 배포) | [기록](evidence/sidebar-tree/README.md) |
| 자격 갭 | 자격 갭 레이더 `/gaps`: 실공고 구조화 필드 1차 선별·막는 자격 순위·보유 가정([[16-DECISIONS\|ADR-060]]) | 구현 `cc2bf41e`·`7372c2d1`, 사이드바 등록 `897dd998`, 통합 브랜치 `feat/new-menus`, main 병합·운영 배포 전. 운영 화면 실숫자 미확인(로그인 필요). 첨부 자격·AI 미사용 | [스펙](../polaris/specs/in-progress/2026-10-28-gaps-market-calendar.md) §5, [증거](evidence/gaps/20261028/README.md) |
| 발주 현황 | 발주 현황 `/market`: 수집 입찰공고 기간·기관·분야·예산 구간·주별 집계 1단계([[16-DECISIONS\|ADR-060]]) | 구현 `3434311d`·`37d70cbe`·`619713e0`, 사이드바 등록 `0dc98749`, 통합 브랜치 `feat/new-menus`, main 병합·운영 배포 전. 2단계(자격 갭 묶음 겹쳐 보기, 스펙 B2) 남음 | 스펙 §6, [1440 스크린샷](evidence/market/20261028/market-overview-1440.png) |
| 입찰 일정 | 입찰 일정 `/calendar`: 관심 공고·입찰 프로젝트 마감 달력([[16-DECISIONS\|ADR-060]]) | 구현 `9ec773a5`·`b5255a09`, 사이드바 등록 `4e5e88bc`, 통합 브랜치 `feat/new-menus`, main 병합·운영 배포 전. 마감 D-3·D-1 알림(기존 `deadline_reminders`)은 운영 알림 Worker 기동 전이라 오지 않고, 화면에도 안내하지 않는다(위 "알림 처리" 행) | [증거](evidence/calendar/20261028/README.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다.

- 2026-10-28 · 사이드바 새 메뉴 3개(업무 "입찰 일정" `/calendar`, 분석 "자격 갭 레이더" `/gaps`·"발주 현황" `/market`, [[16-DECISIONS|ADR-060]] 2026-10-28 사용자 채택)와 정본 문서 반영(01 FR-23~25, 06 §4.1·§5.13~§5.15, 11 §9 NAV-GAPS·NAV-MARKET·NAV-CAL, 16 ADR-060·ADR-021 개정, 12·00·20). 발표 반영: 덱 슬라이드 6 클립 7(S-GAPS 30초, 7·11에서 15초씩 줄여 20:00 유지), 18 §3.2·§4·§6·§7·§8, 19 S-GAPS·§3.1·§5·§6. 통합 브랜치 `feat/new-menus`(main 병합·운영 배포 전). 새 표·마이그레이션 없음, 운영 DB 쓰기 0. 운영 DB 읽기 SELECT 2회(스펙 §3, [2회차 기록](evidence/gaps/20261028/prod-readonly-check.md)) · 전체 `pnpm verify` exit 0(`feat/new-menus` `897dd998`: 루트 272·web 97파일 853·`next build`(`/gaps`·`/market`·`/calendar` 포함)·AI 170·결정 57), 새 단위·브라우저 시험 통과와 변형 실패 확인, 1440·1280 mock 스크린샷. 미실행: 로그인한 실제 앱 화면 확인, 운영 화면 실숫자, main 병합·운영 배포, 발주 현황 2단계(B2)

- 2026-10-28 · 사이드바를 design.actibooky.com 사이드바 톤으로 정리(사용자 결정 A안, [[16-DECISIONS|ADR-021]] 3차 개정): 트리 세로선·들여쓰기 제거, 묶음 줄은 회색 묶음 이름 + 오른쪽 접기 화살표(펼친 묶음은 마우스·초점 때만), 메뉴 아이콘 회색(활성·hover만 글자색), 활성 굵기 600→500, 묶음 사이 16px. 글자 +3px·펼친 상태 아이콘·묶음 접기는 그대로. 규칙은 [[06-UI-UX|06]] §4.1·`design-system` 스킬 · `pnpm verify:changed` 통과(web 813), 기존 사이드바 브라우저 시험 통과, `AppShell` 단독 Vitest 브라우저로 1440·1280 펼침·묶음 hover·접은 묶음·64px 스크린샷, 가장 긴 메뉴 말줄임 없음·묶음 이름/메뉴/고정 칸 아이콘 왼쪽 x=16 일치([증거](evidence/sidebar-actibooky/20261028/README.md)). 미실행: 로그인 뒤 실제 업무 화면, 운영 배포
- 2026-10-28 · 사용자 제공 S·레이더 심볼로 공통 로고와 탭 아이콘 교체. 원본 보존, 웹용 lossless WebP 약 15KB·표시 32px, 이전 아이콘 주소도 PNG로 연결. 로컬 웹사이트 3000번 포트 실행·기본 브라우저 열기 · `pnpm verify:changed` 통과(web 813), 기존 사이드바 브라우저 시험 1개 통과, 마지막 아이콘 이동 설정 ESLint·Prettier 및 HTTP 확인 통과. 랜딩 1440·1280px 로고 로드·가로 넘침 0([증거](evidence/logo-replacement/20261028/README.md)). 미실행: 전체 빌드·로그인 뒤 업무/관리자 화면. 운영 배포 전
- 2026-10-28 · design.actibooky.com DESIGN_RULES 대조 뒤 테두리 상자 모서리를 `rounded-lg`(8px) 하나로 맞췄다(`Card` 부품, 화면에서 만든 상자 17곳, 랜딩 탭 `rounded-[10px]`). 대화상자만 `rounded-xl`. 본문 14px 는 정본대로 유지(사용자 결정). 규칙은 [[06-UI-UX|06]] §3.3·`design-system` 스킬 · `pnpm verify:changed` 통과(web 813), 격리 로컬 Supabase 시드 로그인으로 11개 경로 1440·1280px 상자 모서리 8px 외 0개·가로 넘침 0([증거](evidence/radius-unify/20261028/README.md)). 미확인: 공고 상세(시드에 분석 결과 없음)
- 2026-10-28 · 공개 자료 프로필 기준 발표 대본([[16-DECISIONS|ADR-059]]): FX-01·02·03 점수를 규칙 엔진으로 미리 계산했고([기록](evidence/company-public-profile/20261028/fx-forecast.md)), 19 §2.2·S2~S4, 18, 12, 16, 덱 제작 명세(슬라이드 5·6·10·12·14·17, 부록 A·D), 제출 문서의 숫자를 고쳤다. 운영 쓰기는 사용자 승인 뒤 FX-03 [재분석] 1회다(09:47 KST, 53 WATCH, `RULES_WITH_KEV_ASSIST`, 대체 0, 미리 계산과 같음, [화면](evidence/company-public-profile/20261028/fx03-reanalysis-1440.png)). 대시보드는 분석 대기 1 · BID 권고 0 · 진행 중 WATCH 14가 됐다. 그 밖에는 운영 DB를 읽기(SELECT)만 했다. 10 배포 D1 확인 절차의 옛 FX-02 예상(78 BID)도 고쳤다 · 문서 전용. 검증: 바꾼 문서 prettier --check 통과, 위키링크·상대 링크 검사에서 새 깨짐 없음, `pnpm verify:changed --dry-run` 실행 단계 없음(문서만). 덱은 명세와 18장을 대조해 15장(2·5·6·7·8·9·10·11·12·13·14·15·16·17·18)의 글·표·노트를 고쳤다. validate 통과, Keynote PDF 렌더로 넘침을 확인했다(슬라이드 6·14 줄임)
- 2026-10-28 · 사이드바 로고 아래 조직 이름 줄을 빼고, 로고를 대시보드 링크로 바꿨다(보던 출처 `?origin=` 을 이어 감, 접으면 `aria-label` "대시보드로 이동") · `pnpm verify:changed` 통과(web 813), 사이드바 출처 브라우저 시험 통과(로고 링크 단언 추가), `AppShell` 단독 1440·1280 펼침·접힘 스크린샷([증거](evidence/sidebar-logo-link/20261028/logo-1280-open-focus.png)). 미실행: 로그인 뒤 실제 대시보드 화면(로컬 시드 로그인 실패)
- 2026-10-27 · main `c2d5d0b7`·`5a9030dd`·`80affcf0` push·Vercel 배포 success. 회사 서버 접속 없이 할 수 있는 일을 했다.
  - 알림 전용 Worker 진입점·Compose·회사 실행서 §9를 준비했다. 회사 기동 전이다.
  - 사이드바 링크가 보던 출처(`?origin=`)를 이어 가게 했다.
  - `QUESTION_SET_MISMATCH` 기동 거부 시험 2건을 더했다.
  - FX-03 seed 문구 "Kev"를 "결정 모델"로, 옛 polaris 경로 주석 2곳을 고쳤다.
  - 검증: 새 시험(notify 5·출처 규칙 2·사이드바 브라우저 1·AI 2)이 통과했다. 변경을 되돌리면 실패하는 것도 확인했다. worker 이미지 빌드와 `--network none`에서 `--check` exit 0을 확인했다.
  - 미실행: 격리 Supabase 실동작, 로그인 뒤 E2E.
- 2026-10-27 · LH 입찰공고(15159012) 연동, 브랜치 `feat/lh-bid-notice`(main 미병합): 정규화·LH 한정 판정·합성 응답 9개·녹음 스크립트(`7e4d55cd`). 사용자 승인 실호출 2회(15:13 첫 녹음은 한글 깨짐, 15:47 다시 녹음)로 EUC-KR 읽기·`YYYY/MM/DD HH:mm` 일시·금액 단위를 고침(`602d7c2d`). 실응답 fixture `fixtures/recorded/15159012/`·재생 시험(`b59148f2`), 활성화 사전 검토(`94b09810`). registry `enabled: false` 그대로 · 실응답 10건 모두 정규화·어긋난 칸 0·경고 0, 재생 시험 변형 3종 실패 확인, 전체 `pnpm verify` exit 0(루트 249·web 770·`next build`·AI 166·결정 57)([첫 실호출](evidence/ingestion/20261027-lh-bid-notice/first-call.md), [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md)). main `24f2ac84` 병합 뒤 검증은 병합 커밋 메시지에 있다
- 2026-10-27 · 공고 출처 배지를 기관 로고 상징 색으로(나라장터·K-water·LH·KEPCO, [[16-DECISIONS|ADR-058]]) · `pnpm -C web verify:quick` exit 0, 루트 `pnpm test` 259 통과, 출처 배지 브라우저 시험 통과, `next build` 통과, 1440·1280 화면([증거](evidence/source-brand-colors/20261027/README.md)). 배포 전
- 2026-10-27 · 회사 ingest Worker 재생성(`sol-radar-app` `aa0c9f9` → `24f2ac8` fast-forward, `compose.company.yaml` 로컬 수정 보존, 이미지 `43e4e02465c2` → `24f2ac84963c`, 롤백 태그 `rollback-20261027`) · 일회용 `--check` 통과(외부 6종 `DISABLED`), `--status` Job Scheduler 1개, healthy·restarts 0, 18:00 회차 `SUCCEEDED`(273건) 뒤 재생성, 21:00 회차 `SUCCEEDED`·`COMPLETE`(83건, 창 연속) ([기록](evidence/company-rollout/20261027/ingest-worker-recreate.md))
- 2026-10-27 · 결정 모델 연결 문서 정정: 회사 nginx에 없는 `/sol-radar/kev` 경로 전제를 02·03·09·11·16·18·20·21·22·제출 문서·`infra/env` 예시·`compose.gpu.yaml`·레지스트리 주석에서 운영 구성(같은 호스트 `http://127.0.0.1:8009`)으로 고침. 지난 계획서 2개는 확인 메모만 추가 · `format:check` 통과
- 2026-10-27 · 회사 반영(redis-api `aa0c9f9`, AI gateway·Analysis Worker `9bb24b002f9b`, gateway `KEV_BASE_URL` 회사 호스트 Bosun 직결), 회사 공개 프로필 revision 5(기술 이름 영어 1건, Bosun 번역 누락 해소), DEMO 17건 재분석 · 17건 `COMPLETED`·`RULES_WITH_KEV_ASSIST`·대체 0, 모두 WATCH 43~75점, gateway `/health` `registryMatch: true`, 운영 대시보드 1440·1280px 분석 대기 15 → 2([기록](evidence/company-public-profile/20261027/prod-rollout.md)). 10 배포·`infra/gpu`의 없는 Nginx `/sol-radar/kev` 경로 전제를 정정
- 2026-10-27 · 회사 공개 프로필 운영 `--apply`(revision 3, 실적 설명 내부 표기를 고친 revision 4), 회사 역량 이력 탭 배치 깨짐 수정 · CLI dry-run·apply exit 0, 운영 DB 조회로 revision 4·내부 표기 0건 확인, `pnpm verify:changed` exit 0(web 779), 운영 화면 1440·1280px 확인(이력 행 이름 칸 0px → 수정 구조로 847px 이상). DEMO 15건 "분석 대기"([기록](evidence/company-public-profile/20261027/prod-rollout.md))
- 2026-10-27 · 문서 정리: 지난 일정·끝난 계획 41개를 지우고 이 문서를 새 형식으로 바꿨다([[16-DECISIONS|ADR-057]], [[2026-10-27-docs-cleanup-plan|계획]]) · 문서 전용. 링크 검사·표 위키링크 검사 통과. 코드 검사·빌드 미실행
- 2026-10-27 · 회사 공개 프로필 운영 반영: 운영 DB `20261027000700`, main `5261730f` push·Vercel 배포 · db-push·`db-verify` 통과(63개), Vercel 배포 success. 운영 적용 기록은 회사 공개 프로필 작업에서 커밋 예정
- 2026-10-27 · 회사 공개 자료 프로필·`EXECUTIVE` 역할 main 병합(migration `20261027000700`, ADR-052) · 전체 `pnpm verify` exit 0, 최종 리뷰 Critical 0, 로컬 격리 스택 화면·분석 확인([증거](evidence/company-public-profile/20261027/local/local-check.md))
- 2026-10-27 · 운영 반영: Vercel main `8cfaac31`, 운영 DB `20261027000500`·`000600`, DEMO 16건 마감 +15일 · `db-verify` 통과(당시 62개), DEMO `03-verify` 모두 ok. 운영 로그인 화면 확인 미실행
- 2026-10-27 · 첨부 처리(다운로더·Documents Worker·파서·분석 연결)·live 가드 main 병합 · 전체 `pnpm verify` exit 0(루트 236·web 743·`next build`·AI 166·결정 57), 실표본 6건 `PARSED`, 격리 스택 실동작 통과([기록](evidence/attachment-pipeline/20261027-isolated-run.md))
- 2026-10-27 · 외부 수집 서비스별 장애 격리·배포 실행서 · 관련 23파일 342개 통과, 전체 `pnpm verify` exit 0(web 727·AI 153·결정 57·빌드). 로그인 뒤 E2E 미실행
- 2026-10-27 · 전체 점검·사용자 결정 반영(ADR-054: 마감·발표일, D1 유지, 운영 DEMO 삭제 보류, 첨부 처리 구현, X6 미결정) · 문서 전용. 링크 경로·frontmatter 확인
- 2026-10-26 · 사이드바 트리·아이콘 되돌림(사용자 결정) · 전체 `pnpm verify` exit 0(web 689·AI 153·결정 57·빌드), 격리 Supabase 점검 스크립트 1440·1280 실패 0([증거](evidence/sidebar-tree/README.md)). 로그인 뒤 E2E 미실행
- 2026-10-26 · 실운영 전환(3시간 정기 수집·수동 gate·본문 없는 분석 차단·상단바 표시 제거) push·Vercel 배포, 회사 redis-api `SOL_INGEST_MODE=live` · 전체 `pnpm verify` exit 0(web 689), 실 Redis 일정·gate 통합 통과, 격리 브라우저 29/29. Compose가 필요한 e2e-auth 일부 미실행
- 2026-10-26 · 화면 정리(사이드바 묶음 3개·대시보드 숫자 띠·랜딩) · 전체 `pnpm verify` exit 0, 브라우저 시험 12/12, `web/e2e` 45/45, 1440·1280 가로 넘침 0([증거](evidence/design-declutter/README.md))
- 2026-10-25~26 · 운영 DB migration 10개(누적 60개)·사진 버킷 `profile-photos`·release Vercel 배포 · `db-verify` 60개 통과, 버킷 사후 검증 8개 PASS, 전체 `pnpm verify` exit 0, 격리 E2E 18/18([증거](evidence/integration/20261026-deploy-prep.md))
- 2026-10-24 · 운영 DB migration 14개(누적 50개), 운영 smoke, N4b main 병합. 운영 실모델 분석 1건(FX-02 66 WATCH)이 끝나 결함 W1(분석 요청 202 뒤 `QUEUED` 정지, 회사 Worker 미소비)이 해소됐다 · `pnpm db:verify` 통과([증거](evidence/people-email/20261024-verify.md)), [smoke 결과](evidence/deployment/20261024-prod-smoke/results.json)

## 관련 문서

- [[00-README|문서 인덱스]]
- [[10-DEPLOYMENT|10 배포]]
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷·남은 일정 제안
- [[16-DECISIONS|결정 기록]]
- [[18-HACKATHON|18 해커톤]]
- [[07-DATA-PIPELINE|공고·인력 fixture]]
- [[11-TESTING|검증 기준]]
- [[21-MODEL-TRAINING|모델 학습]]
