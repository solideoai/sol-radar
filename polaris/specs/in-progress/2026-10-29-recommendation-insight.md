---
title: "추천 분석 — 버튼으로 부르는 Qwen 설명·Bosun 인력 입력·연 1회 재학습 구조"
status: in-progress
tags: [sol-radar, ai, qwen, bosun, analysis, hackathon]
updated: 2026-10-29
---

# 추천 분석 — 버튼으로 부르는 Qwen 설명·Bosun 인력 입력·연 1회 재학습 구조

사용자 요청(2026-10-29): "내 원래 계획은 지금 운영 DB에 적용한 가상 인물 200명의 데이터, 우리회사(솔리데오)가 가지고 있는 기술, 수행했던 프로젝트 등 이런 정보들을 Bosun에 파인튜닝해서 적합한 공고인지 파인튜닝을 해주고 그 결과를 Qwen Flash Next 모델을 API 호출해서 왜 추천하는지, 장점, 보완할 점 등을 보여주는 건데 어떻게 하면 좋을까?"

뒤이은 지시: "Bosun을 인력에 대한 부분은 파인튜닝 하지 않는 게 낫다는 거지? 그럼 회사가 수행했던 프로젝트를 1년에 한 번씩 파인튜닝하면 될 것 같은데 그리고 그걸 파인튜닝을 주기적으로 쉽게 할 수 있는 구조도 생각해보고 PaddleOCR은 이제 안 써서 신경 안 써도 되고 Qwen 분석은 분석할 때마다 호출해야 하니까 그러지말고 만약에 추천 공고를 눌렀을때, 화면에 추천 분석 버튼을 누르면 분석해서 이유를 보여주게 하자." → "다 추천대로 하자."

## 1. 왜 하는가

- 지금 분석 결과는 규칙 점수·요소별 사유·Bosun 참고 의견까지다. "왜 이 공고가 우리 회사에 맞는지, 무엇이 강점이고 무엇을 보완해야 하는지"를 사람 말로 정리한 설명이 없다. `/explain` 은 늘 템플릿 문장이고 Qwen 설명은 구현되지 않았다([[03-AI-PIPELINE|03]]).
- 회사 자료(가상 인력 200명, 솔리데오 기술, 과거 수행 사업)는 이미 규칙 엔진 입력에 있다. 이것을 Qwen 설명의 근거로도 쓰면 심사위원이 "회사 자료를 읽고 판단하는 제품"으로 본다.
- 분석마다 Qwen을 부르면 회사 GPU를 계속 쓰고 분석이 느려진다. 그래서 사람이 [추천 분석]을 눌렀을 때만 부른다.

성공한 모습: 분석된 공고의 상세 화면에서 [추천 분석]을 누르면 30초 안팎에 "판단 이유·강점·보완할 점"이 공고·회사 자료 인용과 함께 나온다. 판정(점수·추천/보류/비추천)은 그대로이고, 다시 열어도 같은 설명이 보인다.

## 2. 사용자 결정 (2026-10-29)

| 번호 | 질문 | 결정 |
|---|---|---|
| R1 | 지금 할 범위 | **A-1 인력 입력 + A-2 Qwen 설명을 지금 한다. Bosun 파인튜닝은 로드맵**(추천안 1번) |
| R2 | 판정 주체 | **판정은 규칙 엔진이 그대로 한다. Bosun은 참고 의견으로만 보인다**(ADR-034 §2 유지) |
| R3 | 인력 데이터 | **파인튜닝하지 않고 입력으로 넣는다.** 인력은 자주 바뀌므로 학습이 아니라 분석 때 읽는다 |
| R4 | 과거 수행 사업 | **1년에 한 번 파인튜닝한다. 주기적으로 쉽게 돌리는 구조를 설계한다**(구현은 발표 뒤) |
| R5 | PaddleOCR | **이제 쓰지 않는다. GPU 공유 조항(ADR-034 §10)을 고친다** |
| R6 | Qwen 호출 시점 | **분석마다 부르지 않는다. 공고 상세의 [추천 분석] 버튼을 누를 때만 부르고, 결과는 분석 run마다 저장한다** |
| R7 | 버튼을 보일 공고 | **분석된 모든 공고(추천·보류·비추천)**(추천안). 지금 DEMO·실공고에 추천(BID)이 0건이라서다 |
| R8 | 재학습 주기 | **연 1회 + 최종 결정 기록 200건이 쌓이면 수동 실행**(추천안) |

## 3. 목표·하지 않을 것

목표:

- G1 공고 상세 화면에 [추천 분석] 버튼과 결과 패널을 둔다. 결과는 요약(판단 이유) 한 문단, 강점 최대 4개, 보완할 점 최대 4개이고, 항목마다 근거 인용(공고 원문·회사 자료)을 단다.
- G2 Qwen3.8-Flash-Next(회사 vLLM)를 AI gateway 새 경로로 부른다. 모델 출력은 검증한다. 숫자·금지어·판정 이름·인용 번호가 틀리면 규칙 결과로 만든 요약으로 대체하고 그 사실을 화면에 표시한다.
- G3 Bosun 결정 모델 입력(영어 state)에 인력 가용(`staffAvailability`)을 채운다. 규칙 엔진의 인력 요소와 같은 기간·FTE 규칙을 쓴다.
- G4 Bosun 연 1회 재학습 구조(데이터 내보내기 → 학습 → 평가 게이트 → 승인 → 교체·되돌리기)를 문서로 확정한다. PaddleOCR 조항을 고친다.

하지 않을 것:

- 판정(점수·권고·필수 자격)을 Qwen이나 Bosun이 바꾸지 않는다. Qwen 설명은 판정 이름(추천·보류·비추천)을 다시 쓰지 않는다.
- 분석 job 안에서 Qwen 설명을 부르지 않는다. 기존 `/explain`·`score_runs.explanation`·`/health` 응답 모양은 바꾸지 않는다.
- 인력 데이터로 Bosun을 학습하지 않는다. 해커톤 전에 Bosun을 재학습하거나 교체하지 않는다(GPU 학습은 별도 승인).
- 유료 hosted 모델을 부르지 않는다. 금지어(승률·확률·가능성·수주 금액·점유율·경쟁사·%)를 화면·모델 출력에 쓰지 않는다.
- 1280px 미만 배치, 결제, 승률 예측.

## 4. 설계

### 4.1 흐름

Vercel relay 마감은 15초이고 relay POST 성공은 202만 받는다. Qwen 생성은 15초를 넘을 수 있다. 그래서 분석과 같은 비동기 흐름을 쓴다.

1. 화면 POST `/api/v1/bids/{bidId}/analyses/{runId}/insight` → Vercel(frontend)은 역할을 확인하고 redis-api로 relay 한다.
2. redis-api가 사용자 JWT로 `recommendation_insights`에 `PENDING` 행을 넣고(RLS) BullMQ `insight` 큐에 job을 넣는다 → 202 `{insightId, status, deduplicated, pollUrl}`.
3. Analysis Worker(service role)가 job을 받아 저장된 분석 run(`input_snapshot`·요소·자격 행)으로 gateway 요청을 만들고 `POST /insight`를 부른다 → 행을 `DONE`(MODEL·TEMPLATE) 또는 `FAILED`로 닫는다.
4. 화면 GET 같은 경로 → Vercel이 RLS로 직접 읽는다(relay 없음). 화면은 2초 → 5초 간격으로 최대 3분 묻는다.

같은 run에 `PENDING`이 있으면 새로 만들지 않고 그 행을 돌려준다(job도 같은 jobId로 다시 넣는다). `DONE`·`MODEL`이 있으면 그대로 돌려준다. `FAILED`나 `DONE`·`TEMPLATE`이면 새로 요청할 수 있다. 10분 넘은 `PENDING`은 worker가 `FAILED`(`STALE`)로 닫는다.

### 4.2 저장

새 표 `recommendation_insights`(run 하나에 요청 여러 건, 화면은 최신 1건). 열: `id`, `org_id`, `score_run_id`(복합 FK → `score_runs(id, org_id)`, 지우면 같이 지운다), `status`(PENDING·DONE·FAILED), `source`(MODEL·TEMPLATE, DONE만), `payload`(DONE만), `fallback_reason`, `model_name`, `prompt_hash`, `error_code`(FAILED만), `requested_by`, `created_at`, `finished_at`. `PENDING`은 run당 하나(부분 유일 색인).

RLS: 조직 구성원은 읽는다. ADMIN·SALES·ANALYST만 `PENDING` 행을 넣는다(자기 `requested_by`, 같은 조직의 COMPLETED·PARTIAL run). 사용자는 고치거나 지우지 못한다. 마감은 worker(service role)만 한다.

### 4.3 gateway `POST /insight`

- 입력: 공고 요약, 규칙 결과(점수·권고·근거 문장·요소·자격·검토 플래그·빠진 요소), Bosun 참고(검토 플래그), 회사 요약(이름·기술·인력 가용), 근거 목록(`B1…` 공고 인용, `C1…` 회사 자료).
- 출력: `summary`, `strengths[{text, refIds}]`, `improvements[{text, refIds}]`, `fallback`, `fallbackReason`, `model`, `promptHash`.
- 검증: JSON 모양, 글자·개수 상한, 입력에 없는 숫자, 금지어, 다른 판정 이름, 없는 인용 번호. 하나라도 걸리면 템플릿(규칙 결과로 만든 문장)으로 대체한다. 로그에 프롬프트·모델 출력을 남기지 않는다.
- mock: 같은 템플릿 내용을 모델 응답처럼 돌려주고 같은 검증을 거친다.

### 4.4 Bosun 인력 입력

`toKevRequest`의 `profileSummary.staffAvailability`(지금 늘 null)를 채운다. 값은 규칙 엔진 인력 요소(K6)와 같은 함수로 만든다: `{from, to, availableFte, eligibleStaff}`. 기간을 정할 수 없으면 null이다. gateway는 이미 이 칸을 받아 state의 STAFF 줄로 쓴다. 골든 점수는 바뀌지 않는다. 실제 Bosun의 stateHash·출력은 바뀔 수 있다.

### 4.5 Bosun 연 1회 재학습 구조(문서, 구현은 발표 뒤)

| 단계 | 내용 |
|---|---|
| 1 내보내기 | `scripts/ops/` 운영자 CLI가 과거 수행 사업 원공고, 앱의 최종 결정 기록(사람 라벨), 규칙 silver(train만)를 `datasets/decision/<버전>/`으로 내보낸다. 유료 LLM 라벨 금지 |
| 2 학습 | `infra/gpu/bosun-retrain.sh <데이터 버전>` 하나로 LoRA 학습. GPU 1만, 시작 전 GPU 메모리 확인 |
| 3 평가 게이트 | 현재 모델과 같은 test로 E4 채점. Δ 신뢰구간이 0을 넘을 때만 후보 |
| 4 포장 | manifest sha256, registry에 `candidate` |
| 5 승인·교체 | 사용자 승인 뒤 8009 서빙 패키지 경로를 바꾼다. 이전 패키지는 남겨 되돌린다 |

주기: 연 1회, 그리고 최종 결정 기록이 200건 쌓이면 수동 실행. 최소 test 20·dev 10 사업, train 1,000 질문 기록([[21-MODEL-TRAINING|21]] §3.5).

PaddleOCR: 회사 컨테이너 `archicm-paddleocr-vl-prod`는 우리 것이 아니므로 멈추지 않는다. 공유 전제는 지우고 "학습 전 GPU 1 메모리 확인"만 남긴다.

### 4.6 화면

상세의 분석 결과 아래(Bosun 참고 의견 다음)에 "추천 분석" 패널.

| 상태 | 보이는 것 |
|---|---|
| 없음·요청 가능 | 한 줄 안내 + [추천 분석] |
| 없음·읽기 전용(EXECUTIVE·VIEWER) | "아직 추천 분석이 없습니다." |
| 진행 중 | 진행 표시 + "공고와 회사 자료를 읽고 정리하고 있습니다" |
| 3분 넘음 | "응답이 늦어지고 있습니다" + [다시 확인] |
| 완료·모델 | 판단 이유, 강점, 보완할 점, 항목별 인용 칩, 모델 이름·만든 시각 |
| 완료·대체 | 같은 배치 + "모델 설명을 쓰지 못해 규칙 결과로 정리했습니다" + [다시 요청] |
| 실패 | "추천 분석을 만들지 못했습니다" + [다시 요청] |

늘 보이는 고지: "판정은 규칙 엔진이 하고, 최종 참여 결정은 사람이 합니다."

## 5. 작업 분배

| 세션 | 맡는 것 |
|---|---|
| 45 | 계약 파일(Task 0)·문서(ADR-066 등)·통합·전체 검증·배포 |
| 09 | gateway `/insight`(계약·검증·템플릿·프롬프트·어댑터·mock) |
| ac | Bosun 인력 입력, gateway 클라이언트, 요청 조립, worker insight job |
| 0f | 마이그레이션·RLS·타입·정책 시험, 도메인 repo·service, 경로·relay·큐 생산자 |
| df | 패널·버튼·폴링·상세 화면 연결·브라우저 시험·스크린샷 |

단계와 파일은 [[2026-10-29-recommendation-insight|단계 계획]]에 있다.

## 6. 일정

| 날짜 | 일 |
|---|---|
| 10-29 | 계획·분배, 각 작업 구현 |
| 10-30 오전 | 45 통합·전체 `pnpm verify`·로컬 스택 확인 |
| 10-30 오후 | 사용자 승인 뒤 `db:push`·main push·회사 gateway·Analysis Worker·redis-api 교체 |
| 10-31 | 운영 화면 1440·1280 확인, 실공고 1건·DEMO 1건 추천 분석, 촬영 |
| 11-01 | 화면 동결 |

## 7. 수용 기준

- A1 분석된 공고 상세에서 [추천 분석]을 누르면 PENDING → DONE이 되고, 판단 이유·강점·보완할 점·인용이 보인다. 새로고침해도 같은 결과다.
- A2 같은 run에서 두 번 눌러도(또는 relay 재시도) 행·job은 하나다.
- A3 EXECUTIVE·VIEWER에게는 버튼이 없고 POST는 403이다. 다른 조직 run은 404다.
- A4 모델 출력에 금지어·입력에 없는 숫자·다른 판정 이름·없는 인용 번호가 있으면 템플릿으로 대체되고 화면에 대체 표시가 나온다.
- A5 gateway가 꺼져 있으면 FAILED가 되고 [다시 요청]으로 새 요청이 된다. worker가 꺼져 있으면 3분 뒤 늦음 안내, 10분 뒤 FAILED(STALE).
- A6 분석 결과(점수·권고·`score_runs.explanation`)와 `/explain`·`/health` 응답은 변경 전과 같다.
- A7 Bosun 요청의 `staffAvailability`가 인력 요소와 같은 기간·FTE로 채워진다. 골든 시험 통과.
- A8 전체 `pnpm verify`·`services/ai/verify.sh` 통과. 1440·1280 스크린샷.
- A9 ADR-066과 03·04·05·06·15·21·22·PROGRESS가 구현과 맞다. ADR-034 §10의 PaddleOCR 공유 문구가 고쳐져 있다.

## 8. 남은 것

- 발표 뒤: 재학습 CLI·스크립트 구현, 첫 연간 재학습(GPU 승인), NestJS 이전 때 insight 경로 옮기기(ADR-028).

## 9. 결과

(통합 뒤 45가 적는다.)

## 관련 문서

- [[2026-10-29-recommendation-insight|단계 계획]]
- [[16-DECISIONS|결정 기록]] ADR-034·ADR-066
- [[03-AI-PIPELINE|03 AI 파이프라인]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]
