---
title: "진행 상황"
status: draft
tags:
  - sol-radar
  - progress
updated: 2026-10-27
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
| 운영 DB | migration 63개, 마지막 `20261027000700`(회사 공개 프로필·`EXECUTIVE`). db-push·`db-verify` 통과. `000500`·`000600`은 [기록](evidence/prod-migrations/20261027/README.md), `000700` 운영 적용 기록은 회사 공개 프로필 작업에서 커밋 예정 | 2026-10-27 |
| 나라장터 정기 수집 | 3시간마다(KST 00·03·…·21시). 2026-10-26 13:51부터 7회 모두 `SUCCEEDED`, 실공고 592건 | 2026-10-27 09:03 KST(최신 수집) |
| 분석 | 실공고 0건. 실모델 run은 FX-02(가상 공고) 1건, 66점 WATCH(`Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, [점검](evidence/demo-deadline/20261027/README.md) S4 절) | 2026-10-27 |
| DEMO 공고 | 19건 그대로. 16건 마감 +15일([기록](evidence/demo-deadline/20261027/prod-run.md)). 운영 DEMO 삭제(실운영 전환 A단계)는 발표 뒤다. 백업 스키마 `demo_cleanup_20261026`이 있다 | 2026-10-27 12:57 KST |
| 회사 반영 | 진행 중(이 행이 정본이다). [[2026-10-27-company-rollout-attachments\|회사 반영 실행서]]의 D0 읽기 확인을 기다린다. 범위는 redis-api·ingest Worker 재생성, gateway 파서, Analysis Worker 교체, Documents Worker 기동이다. 회사 공개 프로필용 gateway·Analysis Worker 갱신도 이때 같이 한다 | 2026-10-27 |
| 카카오 | 운영 연결·발송 0건 | 2026-10-27 |
| 알림 처리 | 미확인(문서 밖 발견 1) | 미확인 |
| CI | GitHub Actions job이 2026-10-24부터 계정 결제 문제로 시작되지 않는다. 검사는 로컬 pre-push 게이트로 한다 | 2026-10-27 |
| hosted 모델 API | 승인 0건, 쓰지 않는다([[16-DECISIONS\|ADR-010]]). 승인하면 최근 작업 로그에 한 줄로 남긴다 | — |

### 사용자 결정 대기

1. [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표 확인.
2. X6 파인튜닝(회사 GPU 학습)과 실험 E0~E3·X2의 실행 여부(미결정). [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]의 B2(회사 서버 준비·확인)·B5(F1~F3 실행·채점) 단계도 같이 미결정이다.
3. [[16-DECISIONS|ADR-055]](제안): 범위 밖 첨부를 `PENDING`으로 두고 우리 쪽 장애는 미루는 documents 계약 변경을 받아들일지.
4. [[16-DECISIONS|ADR-056]](제안): 첨부 일부만 파싱된 추출의 재사용을 분석 대기(A)로 막을지, `source_hash` 캐시 키(B)로 막을지.
5. 파서 "지원" 판정: 코드는 [[03-AI-PIPELINE|03]] §10.3 결정 규칙 4번 판정 없이 `PARSED`를 낸다. 규칙대로 고칠지, 실표본 6건으로 규칙을 바꿀지.
6. 회사 공개 프로필([[16-DECISIONS|ADR-052]])의 남은 운영 반영. migration `000700`과 웹 배포는 끝났다. 남은 순서는 회사 AI gateway·Analysis Worker 갱신(첨부 반영과 한 번에) → `pnpm ops:company-profile` dry-run·`--apply`(사용자 확인) → DEMO 공고 재분석이다([[16-DECISIONS|ADR-052]] 반영 순서 4·6·7·8단계, [스펙](../polaris/specs/in-progress/2026-10-27-company-public-profile.md) B4).
   - **영향**: `--apply` 뒤에는 DEMO 분석의 회사 프로필이 바뀐다. 12·18·19의 S4 예상(78 BID·72 WATCH, fixture 프로필 기준)이 달라지고, 옛 분석은 "미분석"으로 보인다(스펙 B4 8단계·D6 개정).

### 남은 일

- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. 순서는 회사 반영 → 실공고 S-LIVE 분석 run → D1 리허설·촬영(S-LIVE·카카오 실수신, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출 → 발표다.
- 리허설 중 FX-02를 재분석하지 않는다. 하면 최신 분석이 78 BID가 되어 대시보드 BID 수와 권고 알림이 바뀐다. 촬영·발표의 S4 [재분석]만 한다.
- 카카오 실수신 녹화 전에 사용자 연결과 S0 수신 시험을 한다.
- 열린 확인: 운영 로그인 화면 확인(DEMO 마감 이동 뒤), 로그인 뒤 E2E(`test:e2e:work`·`test:e2e:auth`, Compose 필요. 수집 장애 격리·사이드바 되돌림·실운영 전환 변경에서 미실행), 배포 뒤 사진 1장 올리기·지우기([릴리스 실행서](evidence/integration/20261025-release-runbook.md) §4).

**16에서 넘어온 할 일**(번호는 [[16-DECISIONS|16]]의 미결정·닫힌 미결정 번호):

- 해커톤 전
  - 회사 vLLM 장문 guided JSON·지연 실측(미결정 17), Bosun 질문당 지연 p95(미결정 24). `prompt_logprobs` 확인은 E3(X1, 미결정)용이다.
  - `QUESTION_SET_MISMATCH` 기동 거부(`services/ai/src/sol_ai/adapters/local_setup.py:144-145`)에 시험이 없다. 다르면 거부·`null`이면 통과 시험 2건을 더한다(닫힌 미결정 26-13 (a)).
  - FX-03 seed 리뷰 사유 "Kev 가 BID 를 제시해도"(`scripts/demo/plan.mjs:323`)를 "결정 모델이 BID 를 제시해도"로 고친다(닫힌 미결정 30-2 (b)). 운영 DEMO 데이터에 이미 든 문구는 그대로다(추정, D1은 `demo:reset`을 하지 않는다).
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

1. 운영 알림이 처리되지 않을 수 있다(추정). 회사 Worker는 수집·분석·첨부 전용 셋이다. 알림·마감 등록(`notifyWorkerRegistration`·`deadlineWorkerRegistration`)은 전체 Worker `web/worker/main.ts:857-914`에만 있다. 카카오 실수신 녹화 전에 회사에서 확인한다.
2. 발표 중 데이터 출처가 바뀔 수 있다. DEMO 배지는 URL의 `?origin=`만 읽는다(`web/components/topbar-demo-indicator.tsx:25`). 사이드바 "입찰 공고" 링크는 `/bids`라 출처 값이 없다(`web/components/app-nav.ts:52`). 운영 기본 출처가 실공고라 사이드바를 누르면 DEMO 대신 실공고 목록이 보인다.
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
| 회사 공개 프로필 | 운영 DB 공개 자료 프로필, `EXECUTIVE` 역할([[16-DECISIONS\|ADR-052]]) | main·운영 DB(`000700`)·Vercel 반영. 회사 반영·CLI `--apply`·DEMO 재분석 남음(사용자 결정 대기 6) | [로컬 확인](evidence/company-public-profile/20261027/local/local-check.md) |
| 프로필 사진 | 비공개 버킷 `profile-photos`, 가입 신청 승인([[16-DECISIONS\|ADR-051]]) | 운영 적용(migration·버킷·웹 배포). 기존 직원 찾기(U8)·재신청 진입점(U10) 화면은 없다 | [기록](evidence/integration/20261025-prod-apply-db-storage.md) |
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]) | 완료, 운영 DB 적용 | [[07-DATA-PIPELINE\|07]] |
| 화면 정리 | 사이드바 묶음 3개·트리·아이콘, 대시보드 "공공조달 요약" 숫자 띠, 랜딩 | 완료(운영 배포) | [기록](evidence/sidebar-tree/README.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다.

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
