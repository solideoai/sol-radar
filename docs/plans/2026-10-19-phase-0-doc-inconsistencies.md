---
title: "Phase 0 중 발견한 정본 불일치 목록"
status: review
tags:
  - sol-radar
  - plan
  - decision
updated: 2026-10-20
---

# Phase 0 중 발견한 정본 불일치 목록

> [!note] 해결 상태 (2026-10-20, 정본 반영 6차 확인)
> 아래 표의 "결정 필요" 열은 2026-10-19 작성 당시 값이다. 2026-10-20 정본 기준으로 해결된 것은 11건이다.
> - ADR-029: #1(A1, (b))·#2(A2, (a))·#3(A3, (a))·#4(A5)·#7(A6 D2)
> - #5는 제안대로 정리됐다(서비스키는 `live`만, ADR-024 D5(제안), [[11-TESTING|11 테스트]] §5 4번). #9는 ADR-035 F4(채택)로 19를 고쳤다(`FX-20`은 SEED 배치, ADR-024 D12, [[19-DEMO-SCENARIO|19]] §2)
> - ADR-030 B8: #12(hosted 미승인은 기동 거부). ADR-031 C3: #10(S3 필터 권고 `BID`). ADR-031 C9: #13(`FX-07` r2 77점)
> - #8은 작성 때 이미 해소였다.
> - #6은 `.claude/agents/infra-developer.md` 몫이라 정본 밖이다(2026-10-20에도 `production`·`infra/nginx/` 표기가 남아 있다).
> - #11·#14~#26은 이번에 다시 확인하지 않았다. 상태는 [[16-DECISIONS|16 ADR]] 미결정 21번이다.

Phase 0 구현([[16-DECISIONS|16 ADR]] ADR-024 제안)을 하면서 정본 문서끼리 어긋나거나 정본과 구현 사이에 차이가 생긴 곳이다. **정본은 고치지 않았다.** 어느 쪽이 맞는지는 사람이 정한다([[16-DECISIONS|16 ADR]] 미결정 21번). "구현 방식"은 Phase 0이 그 자리를 어떻게 처리했는지, 사람이 정하면 바뀔 수 있는 부분이다.

- 기준 커밋: main `1b824c8`(Phase 0 코드), `cfc534d`. 줄 번호는 2026-10-19 시점 정본이다. 문서가 고쳐지면 줄이 밀린다.
- 파일 이름은 `07:375`처럼 문서 번호와 줄로 줄여 적는다.
- "결정 필요"가 `아니오`인 항목은 표기·정리 수준이라 정본을 맞추면 끝난다. `Phase N`은 그 Phase의 골든·구현이 결과를 정하므로 그때 같이 정하면 된다.

## 불일치 표

|#|내용|근거 위치|제안 (사람이 고른다)|결정 필요|구현 방식|
|---|---|---|---|---|---|
|1|`FX-13` 인용 검증 실패 결과가 문서마다 다르다. `CONFLICTED`와, `UNKNOWN` + `CITATION_FAILED`|07:375·399, 11:76·97 vs 03:771, 15:255|(a) `CONFLICTED`로 통일 (b) `UNKNOWN` + `CITATION_FAILED`로 통일. 03·15가 필드 상태 enum의 원천이라 (b)를 먼저 검토|해결 — ADR-029 (A1, (b) 선택)|fixture 추출 `FX-13`은 원문에 없는 인용을 그대로 담고 manifest tags에 `citation-mismatch-1`을 둔다. 결과 상태는 gateway가 정하므로 fixture에는 상태 이름이 없다|
|2|`FX-05` 추출이 `PENDING_REVIEW`가 되는 근거가 03 §4.4 조건에 없다|07:375·399 (FX-05), 03 §4.4|(a) 03 §4.4에 "첨부 파싱 실패 → `PENDING_REVIEW`" 조건 추가 (b) 07·11에서 `PENDING_REVIEW` 표기를 `UNKNOWN`으로|해결 — ADR-029 (A2, (a) 선택)|`FX-05` 추출은 필드를 `UNKNOWN`으로 두고 `warnings`에 `ATTACHMENT_PARSE_FAILED:FX-05-rfp`를 적는다. `PENDING_REVIEW` 값은 쓰지 않았다|
|3|`AI_FAULT_INJECT` 허용 값이 5개와 3개로 다르다|03:199 (5개) vs 에이전트 정의 `ai-gateway-developer`·`test-ai` (3개)|(a) 5개로 에이전트 정의 갱신 (b) 정본을 3개로 축소. 10·11도 5개를 쓰므로 (a)가 변경이 적다|해결 — ADR-029 (A3, (a) 선택)|Phase 0 gateway에는 `/extract`·`/kev`가 없어 장애 주입을 구현하지 않았다|
|4|`KEV_ENABLED` 기본값. `false`와 demo `true`|ADR-012 행·에이전트 정의 vs 10:37|(a) mock에서도 `true`(mock adapter가 응답)로 정본 통일 (b) `false`로 바꾸고 10 표 수정|해결 — ADR-029 (A5, 기본 `true`·세 모드 `false` 허용)|D6: mock 모드 `KEV_ENABLED=true`. `infra/run-modes.json`의 mock 규칙과 demo env 예시가 같다|
|5|`G2B_*` 서비스키가 mock에서 필요한지|11:176 (S0 체크리스트) vs 10:27·53·81|`live`에서만 필수로 11 S0 문구 수정 (ADR-022와 맞춤)|아니오 (제안대로 정리)|D5: demo env 예시에 `G2B_*` 줄이 없고 `live`에서만 필수. Compose worker는 `${KEY:-}`로 넘긴다|
|6|`infra-developer` 정의가 `production` 프로필·`kev-4b` 태그·`infra/nginx/`를 말한다|`.claude/agents/infra-developer.md` vs 10 (프로필 3단, Kev-9B `@v1.0`, reverse proxy 미결정)|에이전트 정의를 10에 맞춘다 (`production`·nginx 제거, 태그 `kev-1.0`/`kev-9b@v1.0`)|아니오 (정의 수정은 `.claude/` 담당)|Phase 0은 프로필을 쓰지 않는 단일 `compose.yaml`이고 nginx·production은 만들지 않았다|
|7|`/health/ready`에 실행 모드 필드가 없다. 그런데 `RunModeIndicator`가 거기서 읽는다|05:43 vs 06:378|(a) 05 응답에 `runMode` 추가 (b) 06 표시기가 gateway `/health`나 다른 응답에서 읽도록 변경|해결 — ADR-029 A6(D2: web 서버가 env `SOL_RUN_MODE`를 읽는다)|web `/health/ready` 응답은 `status`·`checks`(`db`·`redis`·`storage`·`ai`)만 담는다. gateway `/health`가 `runMode`·`provider`·`kevEnabled`를 돌려준다|
|8|`requirement_extractions` 20건|04:373|**해소**. 추출 fixture가 19건 + `FX-07` r1 = 20개라 04의 20과 맞는다 (Ruling 17)|아니오 (해소)|`FX-07.r01.json` 추가|
|9|`FX-20` 배치. `LIVE`와 `SEED`|19:44 vs 07:382·418|07(`SEED`, 429 두 번 뒤 적재)을 따르고 19:44를 고친다|예 (19 수정)|D12: manifest에서 `SEED`, 검증기도 `SEED` 기준|
|10|19 S3 "입찰공고" 필터 결과에 `PRE_SPEC`인 `FX-18`이 들어가고, 전체 분석 후에는 정렬 "`FX-01` > `FX-18` > `FX-06`"이 성립하지 않는다|19:128|S3 필터를 "권고 BID"로 바꾸고 정렬 문구를 실제 점수 순서로 맞춘다|예 (19 수정)|fixture는 `FX-18`을 `PRE_SPEC` 단계로 두고 08 식 82점으로 계산했다. 화면 필터는 Phase 3|
|11|19 S5 알림 목록에 `FX-08`이 빠졌다. `FX-10`의 S5 소속이 문서마다 다르다|19:153·155 vs 07:372 (`FX-10` S5 "—")|`FX-08`(취소)을 알림 대상에 넣을지, `FX-10`의 S5 소속을 07/19 어느 쪽으로 맞출지 결정|예|manifest tags: `FX-08`에 `S5`·`cancelled`, `FX-10`은 `normal`·`G1`·`re-notice`로 S5 없음(07 표의 "—"을 따름)|
|12|hosted 미승인 때 동작. 503과 기동 거부|03:137 (503) vs 03 기동 거부 서술, 10·ADR-010|기동 거부(실행 모드 모순 포함)로 통일하고 03:137의 503을 요청 단계 문구로 정리|예 (Phase 5 전)|`AI_PROVIDER=hosted`인데 `AI_HOSTED_APPROVED`가 `true`가 아니면 gateway와 `check:env`가 기동을 거부한다(gateway exit 78, 사유 `HOSTED_NOT_APPROVED`). 요청 단계 503은 만들지 않았다|
|13|`FX-07` r2의 08 식 계산이 77이고 07·19 목표는 76이다|07·19 (`designScore` 76), 08 식|(a) 목표를 77로 (b) 입력을 조정해 76 (c) 허용 오차 ±1을 정본에 명시|예 (Phase 4 골든이 확정)|manifest `designScore: 76`을 유지. 검증기는 `designScore` ±1을 허용한다(`sol-radar-02` 판정)|
|14|`FX-17`·`FX-20` 기대 결과 표기. "WATCH(조기 추적)"와 별도 enum `EARLY_TRACK`|07:379·382, 19:61 vs manifest enum|(a) 07 표기를 `EARLY_TRACK`으로 (b) enum을 없애고 `WATCH` + 태그로. 골든 대응은 `EARLY_TRACK` → 권고 `WATCH`|예 (Phase 4 전)|manifest `outcome`에 `EARLY_TRACK`을 두었고 분포는 BID 4·WATCH 10·NO_BID 2·CANCELLED 1·QUARANTINED 1·EARLY_TRACK 2|
|15|영업일 수. 7·11일과 6·10일|08:345·360 vs 2026-10-16(금) 기준 평일 수|08 예시 숫자를 6·10으로 고친다. 점수에는 영향이 없다 (구간이 같다)|아니오|`calculationDate: "2026-10-16"`로 계산했고 점수는 같다|
|16|"유형 지자체 ∈ agencies"|08:370|`agencyTypes`로 고친다 (프로필 필드 이름과 맞춤)|아니오|회사 프로필 fixture `fixtures/company/solideo-profile.json`(다른 세션 작업, 미커밋)은 `agencies`와 `agencyTypes`를 따로 둔다|
|17|사전 분석 목록과 S2 BID 건수. 19의 사전 분석 목록(`FX-01`·`03`·`14`, `FX-06`·`07` r1)에 `FX-18`이 없고, 11 S2는 "BID 3건(`FX-01`·`18`·`06`)"이다|19:98 vs 11:185|(a) 19 목록에 `FX-18` 추가 (b) 11 S2의 BID 3건 구성을 바꾼다|예|추출 fixture에 `FX-18`이 있고 사전 분석 대상 선정은 Phase 1 seed·Phase 5 mock이 정한다|
|18|`FX-11` missing 요소 개수. 데이터는 2건(domain `UNKNOWN` + 예산 null)이고 11은 1건|11:95, 08:27 (제목 키워드 규칙을 적용하면 1건 가능)|(a) 11을 2건으로 (b) `FX-11` domain 값을 채워 1건으로|예 (Phase 4 골든이 확정)|Ruling 20: 데이터 2건 유지, `WATCH` 유지|
|19|mandatory 기준어. 03의 기준어와 07·08 §5.2의 필수자격 경로|03:270 vs 07:398, 08 §5.2|한 경로로 통일하고 03 또는 07·08을 수정|예 (Phase 4·5 전)|추출 fixture는 `qualifications[].mandatory` 불리언을 쓴다|
|20|15 §2의 `NOT_APPLICABLE` 예 "발주계획 마감"이 PLAN `deadlineAt` `UNKNOWN`과 어긋난다|15 §2 vs PLAN 단계 fixture|PLAN 마감은 `NOT_APPLICABLE`이 아니라 `UNKNOWN`으로 15 예시를 고친다|아니오 (15 수정)|PLAN 단계 fixture(`FX-17`·`FX-20`)의 레코드 `deadlineAt`은 `null`이다. 추출 쪽 `UNKNOWN` 표기는 Phase 5 gateway가 정한다|
|21|`code`를 gateway가 채우는지와 `projectType` 근거|03:272 vs 03:320 (예시에 `code`가 있고 `projectType`에는 근거가 없다)|03:272 규칙에 맞게 예시를 고치거나 규칙에 예외를 명시|아니오 (03 수정)|추출 fixture는 `qualifications[].code`를 `null`로 두고(예: `FX-01`) `projectType`에도 `evidence`를 단다|
|22|`duplicate-delivery`의 설명. 같은 레코드를 2회 반환한다고 하면서 `SEED`의 `skippedDuplicate`는 0이다|07:349 vs 07:371·§6.4|`duplicate-delivery`가 `LIVE`의 `FX-09`에만 적용된다는 점을 07:349에 명시|아니오 (07 수정)|`FX-09`는 같은 payload를 `SEED`·`LIVE` 두 레코드로 가진다 (Ruling 11). connector가 재복제하지 않는다 (Phase 2)|
|23|mock Kev 파일 범위. "Kev 20건 전부", "규칙 선택지 0.60"과 Phase 0의 4건|07 §6.3, 19 vs D10 (4건), 03 §5.7 fallback|Phase 4 골든 전까지는 4건 + 03 §5.7 fallback이라고 07 §6.3·19를 고친다|예|07 §6.5에 현재 범위(Kev 4건·골든 3건)를 적었다. 나머지 16건은 Phase 4|
|24|`promptHash` 표기. "sha256:" 접두 유무|03:304 (접두 있음) vs 03:244·396 (접두 없음)|접두 없는 64자 hex로 통일 (fixture 값과 맞음)|아니오|추출 fixture의 `promptHash`는 접두 없는 hex다. seed·mock이 고정 값으로 덮는다 (Phase 1·5)|
|25|`FX-08` r1이 08 식으로 84.5점 `BID`라서 S2 "BID 권고 3건"(11:185·19:85)이 깨진다|11:185, 19:85, 08 식|(a) 현재 조정(fixture에 미보유 필수 기술을 더해 70점 `WATCH`)을 유지 (b) "BID 4건"을 받아들이고 11·19·fixture를 되돌린다|예|Ruling 24: `FX-08` r1에 미보유 필수 기술(Oracle·Nexacro)을 추가해 70점 `WATCH`로 맞췄다. (b)를 고르면 그 추가를 되돌린다|
|26|Phase 0 계획 브리프의 "`FX-11` missing 1건 유지" 문구가 틀렸다. 데이터는 2건을 유지한다|`docs/plans/2026-10-18-phase-0-infra.md`의 Task 6 브리프 문구|계획 문구를 "2건 유지"로 고치거나, 18번 결정에 따라 정한다|아니오 (18번에 종속)|Ruling 20과 같다|

## 사람이 먼저 정할 것

점수와 데모 장면에 영향이 있는 항목을 먼저 본다.

1. 25번: S2 "BID 권고 3건"을 지킬지 "BID 4건"을 받아들일지. 지금은 fixture를 조정해 3건을 지켰다.
2. 1·2·12번: Phase 5 gateway를 구현하기 전에 인용 실패·파싱 실패·hosted 미승인 처리를 정한다. 1·2번은 ADR-029로 해결했다. 12번의 구현 방식(기동 거부, 요청 단계 503 없음)은 ADR-030 B8로 채택됐다.
3. 13·14·18번: Phase 4 골든이 확정하지만, 허용 오차(±1)를 정본에 적을지 정한다.
4. 7번: Phase 3 화면 전에 실행 모드 표시기의 읽는 곳을 정한다. ADR-029 A6 D2로 해결했다.

## 관련 문서

- [[16-DECISIONS|16 ADR]] — 미결정 21번, ADR-024 제안
- [[07-DATA-PIPELINE|07 수집 파이프라인]] — §6.5 Phase 0 구현 형태
- [[08-SCORING|08 스코어링]]
- [[11-TESTING|11 테스트]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [Phase 0 구현 계획](2026-10-18-phase-0-infra.md)
- [[PROGRESS]]
