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

## 현재 상태 요약 (2026-10-28)

- 공식 제출은 2026-11-03, 발표는 2026-11-04다([[16-DECISIONS|ADR-054]]). 발표는 덱 20분 + 녹화 클립이다. D1 운영 사이트(`https://www.solideos-radar.com` + `?origin=demo`)는 녹화 촬영 경로이자 질의응답 라이브다. 발표 전 `pnpm demo:reset`은 하지 않는다.
- 핵심 컷 C0~C9에서 남은 것은 C8 S-LIVE, C9 D1 리허설·촬영, C1 ④ 파서 "지원" 판정이다. 제출물(X4)은 초안이다.
- P1 다섯 화면과 확장 컷 항목은 main에 있다(아래 기능 상태 표).
- 회사 반영은 2026-10-28에 Documents Worker 기동까지 했다(아래 운영 상태 "회사 반영" 행). 그 전까지 운영의 실공고 분석은 0건이었다. 본문이 비어 `409 ANALYSIS_SOURCE_MISSING`이 났다. 첨부가 파싱된 뒤의 실공고 분석 수는 아직 세지 않았다.
- 운영 수집 출처는 나라장터·LH·KEPCO·K-water 입찰공고와 기업마당 부처 공고다(2026-10-28, 아래 운영 상태).

### 운영 상태

값은 문서·증거에 적힌 것이고, 시각은 그 기록의 시각이다.

| 항목 | 상태 | 마지막 확인 |
|---|---|---|
| web(Vercel) | main `fcefbfea`(화면 개편 2차: 랜딩 업무 데모·권고 표기 추천·보류·비추천) Production 배포 성공. 비로그인 랜딩 1440·1280 영어 권고 글자·넘침·깨진 이미지·콘솔 오류·400 이상 응답 0, `/login` 200, `/health/ready` ok. 1차는 `14bfc514`. 그 뒤 업무 데모 1.25배 빠르게(`848513fe`)·출처 고지 아래로 이동(아래 작업 로그). 함수 지역 `syd1`(main `fed1b5bd`)·렌더 조회 합치기(main `c7e95ddf`) 배포, 응답 `x-vercel-id: icn1::syd1`([기록](evidence/deployment/20261028-region-latency.md)) | 2026-10-28 22:20 KST |
| `/health/ready` | 200(`db`·`redis`·`storage` ok, `ai: local`). `ai`는 회사 AI gateway가 보고한 provider 값이다 | 2026-10-27(시각 기록 없음) |
| 운영 DB | migration 63개, 마지막 `20261027000700`(회사 공개 프로필·`EXECUTIVE`). db-push·`db-verify` 통과. `000500`·`000600`은 [기록](evidence/prod-migrations/20261027/README.md), `000700`은 [기록](evidence/company-public-profile/20261027/prod-rollout.md) | 2026-10-27 |
| 나라장터 정기 수집 | 3시간마다(KST 00·03·…·21시). 정기 회차 2026-10-26 18:00~10-28 18:00 17회 모두 `SUCCEEDED`(18:00 회차 317건, 생성 292). ingest Worker는 2026-10-28 18:55 `d171a7162e17`로 다시 만들었다. 같은 Worker가 LH·KEPCO·K-water 입찰공고도 같은 3시간 정각에 차례로 받는다(아래 "외부 입찰공고" 행, [기록](evidence/company-rollout/20261028/sources-rollout.md)) | 2026-10-28 18:23 KST(최신 수집) |
| 외부 입찰공고(LH·KEPCO·K-water) | 운영 수집 중. LH 12:15 켬(15:00 첫 회차 26건), KEPCO·K-water 15:16 켬. 18:00 회차: K-water `PARTIAL`(325건, 생성 317, 처음 본 진행 상태 8건 격리 → 사용자 결정으로 마감 처리, 18:55 반영, 21:00 회차부터 적용), LH `SUCCEEDED`(5건 모두 중복), KEPCO `PARTIAL`(생성 71, 범위 미검증이라 늘 `PARTIAL`). 15:59 누군가 옛 이미지로 되돌린 것을 16:03 사용자 결정으로 다시 바로잡았다(누가 했는지 미확인). 남은 외부 3종(K-water 발주계획·LH 사전규격·조달요청)은 꺼짐 | 2026-10-28 18:55 KST |
| 분석 | 실공고 0건. 실모델 run은 가상 공고 19건이다. FX-02 1건(66점 보류(`WATCH`), 프로필 revision 2, [점검](evidence/demo-deadline/20261027/README.md) S4 절), DEMO 17건(프로필 revision 5, 43~75점 모두 보류, `Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, [기록](evidence/company-public-profile/20261027/prod-rollout.md)), FX-03 1건(프로필 revision 5, 53점 보류, [기록](evidence/company-public-profile/20261028/fx-forecast.md)) | 2026-10-28 09:47 KST |
| DEMO 공고 | 19건 그대로. 16건 마감 +15일([기록](evidence/demo-deadline/20261027/prod-run.md)). 운영 DEMO 삭제(실운영 전환 A단계)는 발표 뒤다. 백업 스키마 `demo_cleanup_20261026`이 있다. 회사 공개 프로필(revision 5)로 17건을 다시 분석했고, 2026-10-28에 FX-03도 다시 분석했다(53 보류). FX-02만 옛 분석(revision 2)이라 대시보드 "분석 대기" 1로 보인다. 발표 대본은 이 상태 그대로 쓴다([[16-DECISIONS\|ADR-059]]) | 2026-10-28 09:48 KST |
| 회사 반영 | 일부 완료(이 행이 정본이다). redis-api `aa0c9f9`(이미지 `9458368e`), AI gateway·Analysis Worker `9bb24b002f9b`로 갱신했다. gateway의 `KEV_BASE_URL`은 회사 호스트 Bosun `http://127.0.0.1:8009`로 바꿨다(Nginx `/sol-radar/kev` 경로는 없다). ingest Worker는 2026-10-28 09:15 `sol-radar-app` `1646e7d0`(LH A단계, 사용자 결정으로 이 커밋에 고정)에서 `1646e7d033a1`로 재생성했다(롤백 태그 `rollback-20261027-lh` = 직전 `24f2ac84963c`, `g2b-scheduled` 1개 유지, 외부 6종 비활성, 12:00 회차 `SUCCEEDED`, [기록](evidence/company-rollout/20261028/lh-a-stage-ingest-worker.md). 그 전 재생성은 [10-27 기록](evidence/company-rollout/20261027/ingest-worker-recreate.md)). 오후에는 회사 HEAD를 `d171a716`까지 올리며 ingest Worker를 세 번 더 바꿨다(12:15 LH registry, 15:16 `209d551590c9` KEPCO·K-water, 18:55 `d171a7162e17` K-water 상태). 기업마당 전용 Worker는 16:43에 띄웠다(`db442be15481`, [기록](evidence/company-rollout/20261028/sources-rollout.md)). [[2026-10-27-company-rollout-attachments\|회사 반영 실행서]] §8 Documents Worker는 사용자 승인("2단계로 켜기")으로 18:16 시범(`DOCUMENTS_ROUND_MAX_REVISIONS=1`, 47건 중 `FAILED` 0) 뒤 18:34 기본 속도로 기동했다(이미지 `sol-radar-documents-worker:db442be15481`, healthy·재시작 0, [기록](evidence/attachment-pipeline/20261028-documents-worker.md)). 밀린 첨부 처리 중(아래 "첨부 처리(Documents Worker)" 행). 남은 것: 알림 전용 Worker(아래 "알림 처리" 행) | 2026-10-28 18:55 KST |
| 첨부 처리(Documents Worker) | 운영 중(2026-10-28 18:16 1단계 1 revision/회차, 18:34 2단계 기본 10). 19:0x 기준 `PARSED` 393·`PARTIAL` 3·`UNSUPPORTED` 3·`FAILED` 0, 다운로드 실패 0, 받은 첨부 약 167MB. `PENDING` 6,127건이 남았다(18:00 나라장터 회차가 새 공고를 더했다). 중간 확인은 45 세션이 DB로 한다([기동 기록](evidence/attachment-pipeline/20261028-documents-worker.md)) | 2026-10-28 19:0x KST |
| 부처 공고(기업마당) | 운영 수집 중. 전용 Worker(KST 3시간 정각, 기업마당만, `infra/company/README.md` §10)를 회사에 띄웠다(`db442be15481`, 16:43:41). 16:43 `--once` 100/100 저장, 18:00 첫 정기 회차 `SUCCEEDED` 100/100. 운영 `program_notices` 기업마당 100행([기록](evidence/company-rollout/20261028/sources-rollout.md)). `/bids` "부처 지원사업" 탭 화면은 아직 보지 않았다 | 2026-10-28 18:00 KST |
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
6. KEPCO 첨부 주소(`http://srm.kepco.net`)를 첨부 허용 목록에 넣을지. 지금은 모두 `ATTACHMENT_URL_BLOCKED`다. (LH B단계는 2026-10-28 12:15 반영을 끝냈다, [기록](evidence/company-rollout/20261028/sources-rollout.md).)

### 남은 일

- 날짜는 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표(사용자 확인 전)에 있다. 순서는 회사 반영 → 실공고 S-LIVE 분석 run → D1 리허설·촬영(S-LIVE·카카오 실수신, 로컬 Compose의 S5·S6) → 덱·녹화 클립 완성 → 제출 → 발표다.
- 리허설 중 FX-02를 재분석하지 않는다. 촬영 때 "이전 분석 66(가상 프로필) → 새 분석 43(공개 자료 프로필, 예상)"이 보여야 한다([[16-DECISIONS|ADR-059]]). 촬영의 S4 [재분석]만 한다.
- 덱 pptx(`docs/submission/deck/sol-radar-deck.pptx`, git 밖)는 10-28 에 [[slides-spec|덱 제작 명세]]와 18장을 대조해 글·표·노트를 맞췄다(10-25 원본은 `sol-radar-backups/deck/` 에 백업). 그림·포스터는 옛 mock 화면 그대로라 촬영 뒤 바꾼다. 명세가 정본이다.
- 카카오 실수신 녹화 전에 사용자 연결과 S0 수신 시험을 한다.
- 화면 개편(ADR-061): 1차 배포 완료(10-28) → 랜딩 업무 데모 2차 배포 → 11-01부터 화면 동결·덱 클립 촬영. 2026-11-02 사용자 승인 뒤 운영 읽기 SELECT로 랜딩 출처 9곳 수집을 확인하고, 연결 안 된 곳은 로고를 뺄지 사용자가 정한다([출처 연결 목록](plans/2026-10-28-landing-sources-to-connect.md)).
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
  - Supabase 서울(`ap-northeast-2`) 이전과 함수 지역 `icn1` 전환. 2026-10-28 사용자 결정으로 발표 뒤다. 새 프로젝트·데이터·첨부 복사, 간편 로그인 콜백 주소, Vercel·회사 Worker 환경변수 교체가 필요하다([기록](evidence/deployment/20261028-region-latency.md))

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
| 부처 공고 | 부처 지원사업 공고 수집·목록([[16-DECISIONS\|ADR-040]]) | 완료(main). 회사 운영 수집은 전용 Worker(기업마당, KST 3시간 정각) main `db442be1`, 회사 반영·첫 정기 회차 `SUCCEEDED`(2026-10-28 18:00, 100건). 화면 확인 남음 | [기록](evidence/program-notices/recording-20261021.md), [기업마당 정기 수집](evidence/program-notices/20261028-bizinfo-schedule.md) |
| 평가 리포트 | E0·E2·E3 전체 평가셋 리포트, `/admin/ai/eval-runs` | 리포트는 미결정, `/admin/ai/eval-runs`는 코드 없음 | [[12-ROADMAP\|12]] |
| 메일 알림 | [[16-DECISIONS\|ADR-041]] | 해커톤에서 뺐다(코드 없음) | [[13-NOTIFICATIONS\|13]] |
| P1 | N3 관심 공고·N5 분석 결과 비교·N6 입찰 프로젝트·N7 인력 배치 시뮬레이션·N4b 조직·인력 ADMIN 편집([[16-DECISIONS\|ADR-042]]) | 완료(main·운영 배포) | [N3~N7](evidence/navigation/20261022-implementation.md), [N4b](evidence/n4b-team-edit/20261024-verify.md) |
| 운영 구성 | Vercel web + 회사 redis-api·AI gateway·Worker 3종, Storage `bid-documents`·`bid-parsed`([[16-DECISIONS\|ADR-045·048·049]]) | 운영 중. 회사 AI 모드는 문서 밖 발견 4 | [[10-DEPLOYMENT\|10]] |
| 실운영 전환 | 3시간 정기 수집·수동 수집 gate·본문 없는 공고 분석 차단·상단바 실행 모드 표시 제거 | 운영 중. 운영 DEMO 삭제는 발표 뒤 | [기록](evidence/live-ops/20261026/summary.md) |
| 첨부 처리 | 다운로더·Documents Worker·`/parse`·분석의 첨부 텍스트 읽기([[16-DECISIONS\|ADR-054]] 3번) | main·운영 DB·Vercel·회사 반영(Documents Worker 2026-10-28 18:16 시범, 18:34 기본 속도, `FAILED` 0, 밀린 첨부 처리 중). 실공고 분석 요청은 첨부 처리 뒤 별도 승인. ADR-055·056 제안 | [구현](evidence/attachment-pipeline/20261027-implementation.md), [격리 실행](evidence/attachment-pipeline/20261027-isolated-run.md), [회사 기동](evidence/attachment-pipeline/20261028-documents-worker.md), [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| live 가드 | live에서 카카오 발송 수단이 비면 발송 끔. 이메일 가입 약관 동의 저장(`user_consents`) | main·운영 DB·Vercel 반영. 간편 가입(OAuth) 동의는 후속 | [검증](evidence/live-guards/20261027.md) |
| 수집 장애 격리 | 외부 서비스별 키·한도 상태, 준비된 서비스만 정기 수집 | main·Vercel·회사 반영. registry에서 LH·KEPCO·K-water 입찰공고를 켰다(2026-10-28). 나머지 외부 3종은 꺼짐 | [기록](evidence/ingestion/20261027-source-isolation/summary.md), [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| 공공 입찰 확장 | 사업기회 연결·11열 목록·수집 운영([[16-DECISIONS\|ADR-047]]) | main·운영 적용. 신규 6개 서비스는 서비스별 검증 뒤 켠다 | [기록](evidence/procurement-expansion/20261022-release.md) |
| LH 입찰공고 | LH 입찰공고(15159012) 수집: 정규화, LH 한정 인증·데이터 없음 판정, EUC-KR 응답 읽기 | main 병합(`1646e7d0`)·Vercel 반영. 실응답 10건 모두 정규화. main registry는 `c5c88510`에서 켬(`APPROVED`·`VERIFIED`). 회사 B단계 반영 2026-10-28 12:15, 15:00 첫 정기 회차 `SUCCEEDED`(26건) | [[2026-10-27-lh-bid-notice-activation\|계획]], [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md), [A단계 회사 반영](evidence/company-rollout/20261028/lh-a-stage-ingest-worker.md), [B단계·이후](evidence/company-rollout/20261028/sources-rollout.md) |
| KEPCO·K-water 입찰공고 | KEPCO 전자입찰 계약(예산 = 원 단위로 읽힌 추정가격, 하루 한도 100 자체 상한)·K-water 입찰공고(참가신청만 `OPEN`, 확인한 13개 상태는 `CLOSED`, 처음 보는 상태는 격리) 정규화와 정기 수집 | main `0262aac4`·`209d5515`·`d171a716`, 회사 반영(2026-10-28 15:16, K-water 상태 추가 18:55). 18:00 첫 회차 KEPCO 71건 생성·K-water 317건 생성. KEPCO 첨부 주소 허용은 미결정(사용자 결정 대기 6) | [[2026-10-28-all-sources-activation\|계획]], [회사 반영](evidence/company-rollout/20261028/sources-rollout.md) |
| 회사 공개 프로필 | 운영 DB 공개 자료 프로필, `EXECUTIVE` 역할([[16-DECISIONS\|ADR-052]]) | main·운영 DB(`000700`, 프로필 revision 5)·Vercel·회사 gateway·Analysis Worker 반영, DEMO 17건 재분석 완료, FX-03 재분석(2026-10-28, 53 보류). 발표 대본은 [[16-DECISIONS\|ADR-059]]로 정했다 | [로컬 확인](evidence/company-public-profile/20261027/local/local-check.md) |
| 프로필 사진 | 비공개 버킷 `profile-photos`, 가입 신청 승인([[16-DECISIONS\|ADR-051]]) | 운영 적용(migration·버킷·웹 배포). 기존 직원 찾기(U8)·재신청 진입점(U10) 화면은 없다 | [기록](evidence/integration/20261025-prod-apply-db-storage.md) |
| 인력 200명 | 가상 명부·사진 200장·전원 계산 대상([[16-DECISIONS\|ADR-019·043]]) | 완료, 운영 DB 적용 | [[07-DATA-PIPELINE\|07]] |
| 화면 정리 | 사이드바 묶음 3개·트리·아이콘, 대시보드 "공공조달 요약" 숫자 띠, 랜딩 | 완료(운영 배포) | [기록](evidence/sidebar-tree/README.md) |
| 자격 갭 | 자격 갭 레이더 `/gaps`: 실공고 구조화 필드 1차 선별·막는 자격 순위·보유 가정([[16-DECISIONS\|ADR-060]]) | 구현 `cc2bf41e`·`7372c2d1`, 사이드바 등록 `897dd998`, main `e2203b72`·운영 배포(2026-10-28 Vercel success). 운영 화면 실숫자 미확인(로그인 필요). 첨부 자격·AI 미사용 | [스펙](../polaris/specs/done/2026-10-28-gaps-market-calendar.md) §5, [증거](evidence/gaps/20261028/README.md) |
| 발주 현황 | 발주 현황 `/market`: 수집 입찰공고 기간·기관·분야·예산 구간·주별 집계 1단계([[16-DECISIONS\|ADR-060]]) | 구현 `3434311d`·`37d70cbe`·`619713e0`, 사이드바 등록 `0dc98749`, main `e2203b72`·운영 배포(2026-10-28 Vercel success). 2단계(자격 갭 묶음 겹쳐 보기, 스펙 B2) `e0fca05f` | 스펙 §6, [1440 스크린샷](evidence/market/20261028/market-overview-1440.png) |
| 입찰 일정 | 입찰 일정 `/calendar`: 관심 공고·입찰 프로젝트 마감 달력, 조직 전체 보기의 관련 업종 실공고 마감과 나라장터 입찰공고 원본 일정 5종, 일정 종류 거르기([[16-DECISIONS\|ADR-060]]) | 구현 `9ec773a5`·`b5255a09`·`f284effc`, 사이드바 등록 `4e5e88bc`, main `e2203b72`·운영 배포(2026-10-28 Vercel success). 원본 일정·관련 공고 반영(`218ee1f1`·`6da869df`, 2026-10-28 main 병합·push). 마감 D-3·D-1 알림(기존 `deadline_reminders`)은 운영 알림 Worker 기동 전이라 오지 않고, 화면에도 안내하지 않는다(위 "알림 처리" 행) | [증거](evidence/calendar/20261028/README.md) |

## 최근 작업 로그

형식: `날짜 · 변경 · 검증`. 검증에는 실제로 돌린 명령과 결과만 적는다.

- 2026-10-28 · 랜딩 첫 화면에 출처 로고 줄까지(사용자 요청 "들어왔을 때 공고를 가져오는 곳 로고까지 보이게, 큰 제목은 줄이고 올리고", 이어서 "하단에 여백 살짝"): 히어로 제목 `display` 64/76 → 52/64(히어로 전용 눈금), 히어로 위 여백·흐르는 줄 위아래 여백·로고 카드 높이(112 → 96px)를 줄이고 업무 데모 판 위에 여백을 더했다. 브라우저 높이 800에서 출처 로고 줄 629~725px·고지 문장 737~757px(아래 43px 비움)·데모 판 805px부터. 06 §3.4·design-system 스킬 눈금 표 맞춤, E2E에 1280·1440×800 첫 화면 단언 추가 · `pnpm verify:changed` exit 0, `next build` exit 0, 랜딩 E2E 3파일 28 통과, 메인 세션 Playwright MCP로 1440·1280×800 확인·넘침 0
- 2026-10-28 · 랜딩 업무 데모 위치를 출처 줄 고지 문장 아래로(사용자 요청 "동영상이 '기관 로고는 공고 데이터 출처 표시이며 제휴·인증을 뜻하지 않습니다.' 이 글씨 밑으로"): 랜딩 순서 히어로 → 수행 서비스 줄 → 출처 줄(고지 문장) → 업무 데모 → 분석 예시. 06 §3.4·ADR-061·design-system 스킬 문구와 랜딩 E2E(데모가 고지 문장·출처 줄 아래인지 위치 단언, 화면에 들어온 뒤 장면 확인) 맞춤 · `pnpm verify:changed` exit 0(web 890), `next build` exit 0, 랜딩 E2E 3파일 27 통과, 메인 세션 Playwright MCP로 `next start` 1440·1280에서 고지 문장 아래 28px에 데모 판·넘침 0
- 2026-10-28 · 운영 화면 이동 지연 조치(사용자 보고 "메뉴·버튼 클릭마다 3초", [기록](evidence/deployment/20261028-region-latency.md)): Vercel 함수가 `iad1`(버지니아)에서 시드니 Supabase를 화면당 5~6번 차례로 불러 호출당 평균 573ms였다. `vercel.json` `regions: ["syd1"]`(main `fed1b5bd`), 틀·화면의 내 프로필·업무 조직 조회를 React `cache`로 합치고 `requireWork`는 같이 읽음(main `c7e95ddf`). Supabase 호출 p50 660ms → 16ms, 화면 이동 한 번의 Supabase 대기 2.2~5초 → 0.13~0.5초 · 검증: `node --test scripts/redis-gateway.test.mjs` 3 통과, `pnpm verify:changed` exit 0(web 101파일 890), 커밋 게이트·pre-push(빌드 포함) 통과, 운영 응답 `x-vercel-id: icn1::syd1`, Supabase edge 로그 전후 비교. 미실행: 메인 세션의 운영 로그인 화면 확인(사용자 사용 로그로만 잼). 남은 것: `/bids`·대시보드·`/gaps`의 무거운 RPC·쿼리(0.2~0.8초), Supabase 서울 이전은 사용자 결정으로 발표 뒤
- 2026-10-28 · 랜딩 업무 데모 1.25배 빠르게(사용자 요청 "너무 느리다. 1.25배 빠르게 해줘"): 단계 시간·커서 이동·장면 전환·행 등장 간격·숫자 오름·점수 막대 시간을 모두 ÷1.25, 한 바퀴 약 31초 → 약 25초. 06 §3.4·ADR-061 문구 맞춤, 운영 상태 web 행을 2차 배포(`fcefbfea`)로 갱신 · `pnpm verify:changed` exit 0(web 101파일 890), `next build` exit 0, 랜딩 E2E 2파일 25 통과, 메인 세션 Playwright MCP로 `next start` 1440에서 한 바퀴 24.8초·수집 장면 끝에 숫자·완료 표시가 다 나온 뒤 넘어감·넘침 0·콘솔 오류 0
- 2026-10-28 · 화면 개편 스펙 완료 이동([[16-DECISIONS|ADR-061]]): [스펙](../polaris/specs/done/2026-10-28-ui-refresh.md)을 `polaris/specs/done/`으로 옮기고 결과 절을 더했다. 수용 기준 6개 중 충족 4(사이드바·공통 틀·스크린샷·검증, 공통 틀은 권고 표기 ADR-062로 바뀜), 바뀜 1(랜딩 영상 → HTML 업무 데모), 운영 이미지 200은 1차 충족·2차는 45 확인이다. 배포는 1차 main `14bfc514`, 2차 `fcefbfea`. 남은 것은 11-01 화면 동결·덱 클립, 11-02 출처 9곳 운영 확인이다. 스펙 링크 5곳(06·16·PROGRESS·계획·증거 README)을 새 경로로 고쳤다 · 문서 전용. 검증: `pnpm verify:changed` 통과

- 2026-10-28 · 공공데이터 수집 서비스 회사 반영(사용자 승인 단계마다, [기록](evidence/company-rollout/20261028/sources-rollout.md)): 12:15 LH registry 켬(회사 HEAD `c5c88510`). 15:16 KEPCO·K-water 입찰공고 켬(`209d5515`, ingest 이미지 `209d551590c9`). 15:59 누군가 옛 이미지 `24f2ac84963c`로 되돌림. 16:03 사용자 결정으로 `209d551590c9`로 다시 만듦(누가 했는지 미확인). 16:43 기업마당 전용 Worker(`db442be1`, 이미지 `db442be15481`) `--once` 100/100 뒤 기동. 18:16·18:34 Documents Worker 1·2단계(45 판정 뒤). 18:00 회차에서 K-water 처음 본 진행 상태 8건(제안서제출 5·기술협상 2·PQ심사 1)이 격리됐다. 사용자 결정("셋 다 CLOSED")으로 `external-normalize-kwater.ts` 상태 표에 더하고 재생 시험 1개를 추가했다. main `d171a716` push, 18:55 ingest 이미지 `d171a7162e17`로 다시 만듦. 회사 서버는 `/data/www/ai_workspace` 안에서만, redis-api·AI gateway·Analysis Worker 변경 0 · 검증: K-water 수정 `pnpm verify:changed` exit 0(web 100파일 889·AI 170·결정 57), 새 시험은 `기술협상`을 상태 표에서 빼면 실패함을 확인했다. 커밋 게이트·pre-push 통과. 회사 일회용 `--check`는 단계마다 exit 0이었다(18:55: LH·KEPCO·K-water `READY`, 3종 `DISABLED`). 재생성 뒤 healthy·restarts 0, Job Scheduler 4개, 다른 Worker 그대로. 운영 DB 읽기 SELECT(18:00 회차 `ingest_runs`, `bid_documents` 상태 수). 미실행: 21:00 회차 K-water 격리 0건 확인, `/bids` "부처 지원사업" 탭 화면
- 2026-10-28 · 권고 표기 코드 반영과 화면 개편 2차 배포 준비([[16-DECISIONS|ADR-062]]): 앱(0f `99d8bc24`)·랜딩(df `5e2ccb67`)의 권고·결정 표기를 추천·보류·비추천으로 바꿨다. 표기 정본은 `web/server/shared/recommendation-label.ts` 하나이고 화면·설명 문장·카카오 문구가 같이 쓴다(받침 조사 포함). 이미 저장된 설명 문장은 DB를 고치지 않고 화면 모델에서 옛 템플릿 문구만 바꾼다(`a09c4575`, 사용자 선택). 알림 이름 "추천 공고"는 그대로(사용자 선택), `services/ai` 템플릿은 다음 회사 배포 때. 값 `BID`·`WATCH`·`NO_BID`·DB·API는 그대로. origin/main `c45d32cd`·`3f7426ed`·`8aaac07a`(README·출처 로고 컬러·흐르는 줄 hover 멈춤 제거)를 통합 branch에 병합(`d8d210f1`, 06·16 문장 충돌은 양쪽 유지). Documents Worker 기동 판단 운영 읽기와 시범·기본 속도 기동 기록([기록](evidence/attachment-pipeline/20261028-documents-worker.md)), 1차 배포 운영 랜딩 스크린샷([1440](evidence/ui-refresh/prod-1028/landing-1440.png)·[1280](evidence/ui-refresh/prod-1028/landing-1280.png)) · 전체 `pnpm verify` exit 0(`d8d210f1`: 루트 286·web 101파일 889·`next build`·AI 170·결정 57). 작업자 확인: 앱 `test:e2e:work`(격리) 18 통과·`test:browser` 86·1440·1280 화면 8종 넘침·줄바꿈 0, 랜딩 E2E 40 통과(영어 권고 글자 0 시험 추가), 옛 설명 변환 단위 시험(구현 전 실패 확인). 메인 세션 Playwright MCP로 3120 dev 랜딩 1440·1280 영어 권고 글자 0·넘침 0·배지 높이 32px 확인. 미실행: 2차 배포 뒤 운영 화면 확인(이 커밋 push 뒤)
- 2026-10-28 · 권고 표기 문서 반영([[16-DECISIONS|ADR-062]]): 설계 문서 00~20·PROGRESS 현재 상태와 기능 표·제출 문서 5개·진행 중 스펙 3개·design-system 스킬의 화면 표기와 설명을 추천·보류·비추천으로 바꿨다. 값(DB·API·fixture·결정 모델 출력)은 `BID`·`WATCH`·`NO_BID` 코드 글꼴로 남겼다. ADR 본문 원문·지난 작업 로그·옛 스크린샷 설명·`docs/plans/`는 고치지 않았다 · 문서 전용. 검증: `pnpm verify:changed` 통과
- 2026-10-28 · 화면 UI 전체 개편([[16-DECISIONS|ADR-061]], 사용자 승인, [스펙](../polaris/specs/done/2026-10-28-ui-refresh.md)): 선택·켜짐 파스텔 토큰 `selected`, 사이드바 묶음 머리 아이콘·메뉴 글자만 들여 쓰기(ADR-021 4차 개정, 사용자가 스크린샷 확정), 업무 화면 공통 틀(경로 → 제목 → 구분선, 표 머리 줄·둥근 테두리, `Chip`, 카드 그림자 없음, 선택 표시 3종), 랜딩 흐르는 줄 둘(솔리데오 수행 서비스 17개·공고 출처 9곳 로고만, U8). 영상 구역은 2차 배포. 작업자 넷(0f·ac·09·df)이 화면을 나눠 맡고 통합 branch `feat/ui-refresh` `b8aac468`로 합쳤다. 서버·DB·API·문구 뜻 변경 없음. 연결 안 된 출처 7곳은 [목록](plans/2026-10-28-landing-sources-to-connect.md), 11-02 운영 확인 · 전체 `pnpm verify` exit 0(`83af32c6`: 루트 286·web 885·`next build`·AI 170·결정 57), 리뷰 후속(`b8aac468`)은 `pnpm verify:changed --base 83af32c6` 통과·브라우저 14, 공개 E2E 51 통과(`83af32c6` 빌드), 독립 리뷰 1회(상 1건은 W2 커밋으로 이미 고쳐짐, 중 2건·하 2건 반영, 하 3건 기록만: 흐르는 줄 멈춤 버튼·분석 예시 탭 색 외 표시·출처 줄 제목), 화면별 1440·1280 스크린샷([증거](evidence/ui-refresh/README.md)). `test:e2e:work`(격리 스택): 1회차(`83af32c6`) axe `label-content-name-mismatch` 4건(사이드바 로고 링크, main `e9224f46`부터 있던 결함)·1280 페이지 열기 시간 초과 1건, 2회차(`b8aac468`, 로고 이름 고침) 17 통과·1 실패(격리 스택 Storage 버킷 누락, `pnpm storage:local` 뒤 그 spec 만 재실행 통과), 전 화면 점검 22경로 × 1440·1280 HTTP 200·넘침 0·pageerror 0. 미실행: `test:e2e:work` 전체 3회차, 운영 데이터 화면(배포 뒤). 1차 배포: 사용자 승인으로 main `14bfc514` fast-forward·push(pre-push 게이트 통과, 그 커밋에서 전체 `pnpm verify` exit 0), Vercel success, 운영 비로그인 랜딩·로그인·랜딩 자원 26개 200, 1440·1280 넘침·깨진 이미지·콘솔 오류 0. 운영 녹화 영상(21초)은 실공고 점수 칸이 비어 쓰지 않았고, 사용자 지시로 HTML 업무 데모(`721afe8f`, 가상 공고, 한 바퀴 약 30초)로 바꿨다. 데모 검증: 새 E2E 3개 먼저 실패 확인, 랜딩 E2E 39 통과, `pnpm verify:changed` 통과, 메인 세션이 Playwright MCP로 3120 dev 에서 한 바퀴 순환·1440·1280 넘침 0·13px 미만 0·콘솔 오류 0 확인
- 2026-10-28 · 기업마당 정기 수집(사용자 결정: 전용 Worker·기업마당만·`program_notices` 유지·회사 녹음 1회로 실응답 검증): 부처 공고 전용 Worker `web/worker/program-notices-only-main.ts`(큐 `program-notices`, 일정 `bizinfo-scheduled` Asia/Seoul `0 */3 * * *`, `--check`·`--status`·`--once`·`--unschedule`)와 `infra/compose.program-notices-only.company.yaml`, 실행서 `infra/company/README.md` §10. 부처 공고 live 요청에 수집과 같은 재시도(시간 초과·429·5xx 최대 3번 더). 실응답 녹음(e3, 회사 일회용 컨테이너 16:05 KST 1회, 100건)을 `fixtures/recorded/program-notices/bizinfo/`에 넣고, 명세와 다른 해시태그 칸(`hashtags`)을 고쳤고 지역 16개 전부는 "전국"으로 줄였다. ingest 큐·registry·마이그레이션·화면은 그대로, 회사·운영 쓰기 0, 운영 DB 읽기 SELECT 3회. main `db442be1` · 검증: `pnpm verify:changed` exit 0(루트 286·web 99파일 886·AI 170·결정 57), 새 시험 3개 변형 실패 4건 확인, 격리 로컬 Supabase에 녹음 재생 저장 100행(다시 돌려도 100행, 네트워크 0), 임시 Redis로 Worker 실기동 `--status` Job Scheduler 1개·다음 18:00 KST, 재기동 뒤 1개, `--unschedule` 뒤 0개([증거](evidence/program-notices/20261028-bizinfo-schedule.md)). 미실행: 전체 `pnpm verify`, 화면 확인. 회사 반영은 같은 날 따로 했다(위 "공공데이터 수집 서비스 회사 반영" 줄)
- 2026-10-28 · 입찰 일정 원본 일정·관련 공고 반영(운영 달력이 비어 있어 사용자 선택 1번, [[16-DECISIONS|ADR-060]] 후속): 조직 전체 보기에 관련 업종(`RELEVANT`·`CANDIDATE`) 실공고 마감과 나라장터 입찰공고 원본(`raw_payload`) 일정 5종(제출 시작·자격 등록 마감·협정서 마감·현장설명회·개찰), 일정 종류 거르기 칩 7개(`?kinds=`), 다가오는 14일 8건 + 접기([[06-UI-UX|06]] §5.15). 공공 API 추가 호출·Worker·마이그레이션·service role 0, 운영 DB 읽기 SELECT 1회([기록](evidence/calendar/20261028/prod-raw-check.md)). `218ee1f1`·`6da869df`, 2026-10-28 main 병합·push · 검증: 전체 `pnpm verify` exit 0(루트 286·web 98파일 880·`next build`·AI 170·결정 57), 서버 시험 34·브라우저 시험 9(변형 실패 확인), 09 독립 리뷰(하 5건 중 4건 반영), 격리 로컬 Supabase 로그인 QA(1440·1280, 59개 중 55 + 상한 밖 4개 내 일정에서 확인, 하 2건 수정), 응답 크기(가상 관련 222건, prod 빌드) 2.2MB → 516KB·gzip 41KB([증거](evidence/calendar/20261028/README.md)). 미실행: 관련 공고 읽기 실패 안내 줄 화면 확인(시험만), 로그인한 운영 화면
- 2026-10-28 · LH A단계 회사 반영: `sol-radar-app` `24f2ac8` → `1646e7d0` fast-forward(사용자 결정으로 main 최신이 아닌 이 커밋에 고정, `compose.company.yaml` 로컬 수정 보존), 롤백 태그 `rollback-20261027-lh`(= `24f2ac84963c`), 09:15 ingest Worker만 `1646e7d033a1`로 재생성. LH API 호출 0회 · 일회용 `--check` exit 0(외부 6종 `DISABLED`), `--status` Job Scheduler 1개, healthy·restarts 0, 다른 sol-radar 컨테이너 그대로, `/health/ready` 200, 12:00 회차 `SUCCEEDED`·`COMPLETE`(247건), LH `ingest_runs` 0건([기록](evidence/company-rollout/20261028/lh-a-stage-ingest-worker.md))
- 2026-10-28 · 발주 현황 2단계(B2): 기관·분야 행 아래 자격 갭 판정 묶음 분포 겹쳐 보기(기간 내 마감 전 공고만, 회사 프로필 없으면 생략, 판정 실패는 안내 한 줄과 원인 로그) `e0fca05f`. 독립 리뷰 상·중 0·하 3 반영. 새 표·마이그레이션 없음 · 전체 `pnpm verify` exit 0(`f22feac4`: 루트 286·web 97파일 858·`next build`·AI 170·결정 57), 단위 32·브라우저 3 통과와 변형 실패 확인, 격리 로컬 DB 응답 크기 측정(가상 2,000건 market+gaps 약 1.59MB, [증거](evidence/market/20261028/README.md)). 미실행: 운영 응답 크기·시간, 로그인한 운영 화면
- 2026-10-28 · 사이드바 새 메뉴 3개(업무 "입찰 일정" `/calendar`, 분석 "자격 갭 레이더" `/gaps`·"발주 현황" `/market`, [[16-DECISIONS|ADR-060]] 2026-10-28 사용자 채택)와 정본 문서 반영(01 FR-23~25, 06 §4.1·§5.13~§5.15, 11 §9 NAV-GAPS·NAV-MARKET·NAV-CAL, 16 ADR-060·ADR-021 개정, 12·00·20). 발표 반영: 덱 슬라이드 6 클립 7(S-GAPS 30초, 7·11에서 15초씩 줄여 20:00 유지), 18 §3.2·§4·§6·§7·§8, 19 S-GAPS·§3.1·§5·§6. main `e2203b72` push·운영 배포(Vercel success). 새 표·마이그레이션 없음, 운영 DB 쓰기 0. 운영 DB 읽기 SELECT 2회(스펙 §3, [2회차 기록](evidence/gaps/20261028/prod-readonly-check.md)) · 전체 `pnpm verify` exit 0(`feat/new-menus` `897dd998`: 루트 272·web 97파일 853·`next build`(`/gaps`·`/market`·`/calendar` 포함)·AI 170·결정 57), 새 단위·브라우저 시험 통과와 변형 실패 확인, 1440·1280 mock 스크린샷, 격리 로컬 Supabase 로그인 QA(세 화면·사이드바 순서·/gaps 계산 중 상태·VIEWER, 하 1건 `f284effc` 로 수정). 미실행: 로그인한 운영 화면 실숫자(배포 뒤 비로그인 `/gaps`·`/market`·`/calendar` 는 로그인 화면으로 307 확인)

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
- 2026-10-27 · LH 입찰공고(15159012) 연동, 브랜치 `feat/lh-bid-notice`(10-27 23:00 main `1646e7d0`으로 병합·push): 정규화·LH 한정 판정·합성 응답 9개·녹음 스크립트(`7e4d55cd`). 사용자 승인 실호출 2회(15:13 첫 녹음은 한글 깨짐, 15:47 다시 녹음)로 EUC-KR 읽기·`YYYY/MM/DD HH:mm` 일시·금액 단위를 고침(`602d7c2d`). 실응답 fixture `fixtures/recorded/15159012/`·재생 시험(`b59148f2`), 활성화 사전 검토(`94b09810`). registry `enabled: false` 그대로 · 실응답 10건 모두 정규화·어긋난 칸 0·경고 0, 재생 시험 변형 3종 실패 확인, 전체 `pnpm verify` exit 0(루트 249·web 770·`next build`·AI 166·결정 57)([첫 실호출](evidence/ingestion/20261027-lh-bid-notice/first-call.md), [정규화 검증](evidence/ingestion/20261027-lh-bid-notice/normalization-check.md)). main `24f2ac84` 병합 뒤 검증은 병합 커밋 메시지에 있다
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
