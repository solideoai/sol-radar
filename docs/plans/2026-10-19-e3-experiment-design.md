---
title: "Kev 대조 실험 설계 — E0·E1·E2·E3 (해커톤 규모)"
status: review
tags:
  - sol-radar
  - ai
  - evaluation
  - plan
updated: 2026-10-19
---

# Kev 대조 실험 설계 — E0·E1·E2·E3 (해커톤 규모)

사용자 승인(2026-10-19, "Kev 및 E3 실험")에 따른 실험 설계다. [[21-MODEL-TRAINING|21 모델 학습]] §4.2의 E3(Qwen 프롬프트 분류)를 "선택"에서 **필수**로 올리고, 해커톤 안에서 돌릴 수 있는 규모로 줄인 판이다. 정본 반영은 [수상 전략 계획](2026-10-18-hackathon-award-plan.md) §5(21 §4.2·§3.5)에서 한다. 이 문서는 코드·정본·DB를 바꾸지 않는다.

## 1. 목적과 질문

답할 질문은 하나다. **"규칙 + Qwen 추출 위에 Kev-9B가 무엇을 더하는가"를 숫자로 말할 수 있는가.**

제약(사용자 결정, 변경 금지):

- 골든 94/72/68, SOL Score 가중치 30/25/20/15/10, 결정 임계 75/50은 그대로다. 실험이 점수 계산식을 건드리지 않는다.
- Kev 출력은 지금처럼 `reviewFlags` 추가와 참고 지표 표시만 한다. 점수·자격·권고 반영 코드 경로를 만들지 않는다([[08-SCORING|08 점수]] §5.5, [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]).
- 효과가 수치로 확인되지 않으면 발표·문서에서 "Kev로 개선"을 주장하지 않는다(§8).
- 실험은 모델·추론 경로(C5 `local`, C1 ③ 회사 GPU)가 준비된 뒤 돌린다. 모델 기동은 별도 승인 뒤다. 그 전에는 §6의 준비 작업만 한다.

## 2. 비교 대상

모든 시스템의 공통 입력은 같다: **규칙 엔진 판정 + Qwen3.5-9B `/extract` 추출(인용 검증 통과분) + `translations` + 회사 프로필**. 다른 것은 "그 위에 무엇을 더 묻는가"뿐이다.

| ID | 시스템 | 추가 입력 | 질문 답을 내는 주체 | 비고 |
|---|---|---|---|---|
| E0 | 규칙만 | 없음 | 규칙 엔진. `recommendation`·`req.{itemId}.status`는 규칙 결과를 그대로 라벨로 낸다. `mandatoryRisk`·`needsHumanReview`·`risk.*`는 신호 없음(`false` 고정, 확률 0.0) | 기준선. "Kev만 잡은 신호"의 비교 대상 |
| E1 | 규칙 + Kev-9B@v1.0, `en` state | [[03-AI-PIPELINE\|03]] §5.6 영어 템플릿 state(`en.v0.2`) | Kev `POST /v1/systemone` | 운영 경로와 같다 |
| E2 | 규칙 + Kev-9B@v1.0, `ko` state | 같은 구조의 한국어 템플릿(`ko.v0.2`). `KEV_ALLOW_KO_STATE=true`인 **평가용 gateway**(`SOL_RUN_MODE=fixture`) 또는 `sol_eval`이 `kev.serve`에 직접 | Kev | 평가 전용. 운영 사용 안 함([[16-DECISIONS\|ADR-012]] 개정) |
| E3 | 규칙 + Qwen3.5-9B 분류 | E1과 **같은 `en` state 텍스트**, 같은 질문 `instructions`·`criteria` | Qwen(vLLM) 선택지 로그확률 | "Kev가 꼭 필요한가"의 대조군 |
| E3-ko | 규칙 + Qwen3.5-9B 분류, `ko` state | E2와 같은 `ko` state | Qwen | 선택. Qwen은 한국어를 읽으므로 "영어 변환이 필요한가"를 함께 본다 |

E3 분포 계산(구현 때 확정, 둘 중 하나):

1. **선택지 누적 로그확률(기본)**: 프롬프트(system: "아래 질문에 선택지 중 하나로만 답한다" + state + 질문 `instructions`·`criteria`) 뒤에 선택지 문자열을 하나씩 이어 붙여 vLLM `prompt_logprobs`로 선택지 토큰열의 누적 logprob을 구하고, 선택지별 값을 softmax로 정규화한다. 선택지가 여러 토큰이어도 공평하다.
2. **guided choice 첫 토큰(대체)**: `guided_choice=[선택지]`로 한 번 생성하고 `logprobs`에서 각 선택지 첫 토큰의 logprob을 읽어 정규화한다. 첫 토큰이 겹치는 선택지(`NOT_SATISFIED`·`NEEDS_REVIEW`)에는 쓰지 않는다.

질문 타입별 매핑은 Kev wire와 같다: `choice` → 선택지 분포, `noul` → `P(true)`, `score` → 등급 분포와 기대 등급 index. `temperature=0`, `seed=42`. 프롬프트 전문과 해시는 `services/ai/eval/sol_eval/systems/e3_prompt.v0.1.md`에 두고 리포트에 적는다.

## 3. 입력 (해커톤 규모)

| 묶음 | 건수 | 라벨 출처 | 저장 |
|---|---|---|---|
| fixture `FX-01`~`FX-20`(`FX-12` 격리 제외 → 19건 적재, 분석 가능 18건 + `FX-02`) | 20건 중 분석 가능한 19건 | [[07-DATA-PIPELINE\|07 수집]] §6.2 기대 권고·자격 결과를 `recommendation`·`req.*.status` 정답으로 쓴다(`labelSource=CONSTRUCTED`, `draftedBy=RULE`). `mandatoryRisk`·`needsHumanReview`·`risk.*`·`fit`은 사람이 라벨한다(`HUMAN`) | `fixtures/eval/labels/fixture.v0.1.jsonl`(가상 데이터라 커밋) |
| 실제 공고 | 5건 | C1·C3으로 수집·파싱한 live 공고. 사람 라벨(`HUMAN`, `draftedBy=NONE` 권장. 라벨러 id·시각·도구 버전 기록) | `datasets/labels/live.v0.1.jsonl`(gitignore. 인용 텍스트가 들어가므로 저장소 밖). 커밋본에는 문서 id·오프셋·라벨만 |

**07 §6.3의 mock Kev 값은 정답이 아니다.** `FX-03` `BID 0.55`는 "규칙이 Kev를 이긴다" 장면을 위한 고정값이다. 평가 통계에서 mock 값을 예측으로도 정답으로도 쓰지 않는다. mock은 하네스 계약 시험(§5)에서만 쓴다.

질문 세트(라벨이 있는 것만 채점):

| qid | 타입 | 정답 공간 | E0 예측 | 비고 |
|---|---|---|---|---|
| `recommendation` | choice | `BID`·`WATCH`·`NO_BID` | 규칙 권고 | v0.1 |
| `mandatoryRisk` | noul | `true`·`false` | `false` | v0.1. 정답은 "필수 항목 중 미충족·확인 불가가 실제로 있는가" |
| `needsHumanReview` | noul | `true`·`false` | `false` | v0.1 |
| `fit` | score 5등급 | 0~4 | 없음(채점 제외) | 표시용. 규칙 점수/20과의 상관만 보고 |
| `req.{itemId}.status` | choice | `SATISFIED`·`NOT_SATISFIED`·`NEEDS_REVIEW` | `rule_status` | v0.2. **Kev 담당 항목만**(`requiredSkills[i]`·`pastPerformance[i]` 분야 유사성·`staffing[i]` 역할·`qualifications[i]` 중 `code=null`). 사전 코드·숫자 조건 항목은 규칙 전용이라 제외 |
| `risk.schedule`·`risk.staffing`·`risk.scale`·`risk.techGap`·`risk.scopeAmbiguity` | noul | `true`·`false` | `false` | v0.2. 정답은 사람이 공고·프로필에서 근거를 찾아 정한다 |

예상 표본: 공고 단위 질문 약 24~25건 × 8종, 항목 단위 `req.*.status` 약 100~150건. **표본이 작아 신뢰구간이 넓다.** 모든 수치에 n과 부트스트랩 95% 신뢰구간을 붙이고, 이 결과로 일반화된 성능을 주장하지 않는다. 전체 평가셋(test 20·dev 10 사업)은 확장 컷이다.

## 4. 지표

[[21-MODEL-TRAINING|21 모델 학습]] §4.3의 분류·보정·일관성·성능 영역을 쓴다. 추출 지표는 공통 입력이라 이 실험의 비교 대상이 아니다(별도 P0-4 증거).

| 영역 | 지표 | 정의·계산 | 대상 시스템 |
|---|---|---|---|
| 분류 | Accuracy, Macro-F1 | 3값(`req.*.status`)·3값(`recommendation`)·2값(noul) 각각. 항목 종류(기술·실적·인력·자격)별 분해 | E0·E1·E2·E3 |
| | 정보부족→미충족 혼동률 | 정답 `NEEDS_REVIEW` → 예측 `NOT_SATISFIED` 비율과 반대 방향을 따로 | E0·E1·E2·E3 |
| 보정 | Brier, ECE(10구간), NLL | 보정 전 값. τ=0.70 미보정 상태 그대로 | E1·E2·E3 |
| | 선택적 정확도 | 최대 확률 상위 50%·25%만 골랐을 때 정확도(coverage–risk 곡선) | E1·E2·E3 |
| 일관성 | 선택지 순서 민감도 | Kev는 `/v1/systemone/permute` `n_perm=6`의 `argmax_stable` 비율과 `spread`. E3는 선택지 순서를 같은 6가지로 바꿔 같은 값을 하네스가 계산 | E1·E2·E3 |
| | 반복 일치 | 같은 요청 5회의 분포 최대 편차 | E1·E2·E3 |
| | 표현 변경 | state 줄 순서 섞기 + 용어집 동의어 치환 뒤 argmax가 바뀐 비율 | E1·E3 |
| 신호 | **Kev만 잡은 유효 위험 신호 수** | 아래 정의 | E1 vs E0, E3 vs E0 |
| | 플래그 정밀도 | 유효 신호 / 전체 플래그 | E1·E2·E3 |
| 성능 | 지연 p50·p95 | 질문 묶음 요청 1회, 공고 1건 E2E(분할 요청 합산). 터널 포함 | E1·E2·E3 |
| | GPU 메모리 | `nvidia-smi` 최대 점유 | E1·E3 |
| 언어 | 한국어/영어 차이 | E1·E2(그리고 E3·E3-ko) 항목 짝 비교 ΔMacro-F1·ΔBrier·ΔECE, 짝 부트스트랩 95% CI | E1↔E2, E3↔E3-ko |
| 오류 | 원인 코드 분포 | 오답마다 `PARSE`·`EXTRACTION`·`TRANSLATION`·`STATE`·`RULE`·`LABEL`·`MODEL` 하나(21 §4.4) | E1 필수, E3 권장 |

**"유효 위험 신호" 정의**: E0가 신호를 내지 않은 항목(규칙 `SATISFIED` 또는 플래그 없음)에서 모델이 임계 τ=0.70 이상으로 `KEV_MANDATORY_RISK`·`KEV_NEEDS_REVIEW`·`KEV_REQUIREMENT_DISAGREEMENT`·`KEV_DELIVERY_RISK`에 해당하는 신호를 냈고, 사람이 공고 원문·회사 프로필에서 **근거(`EvidenceRef`·`CompanyEvidenceRef`)를 찾아 "검토가 필요했다"고 판정**한 것. 근거를 못 찾으면 잘못된 경고다. 판정자·시각·근거를 `signal-review.jsonl`에 남긴다. E3에도 같은 기준을 적용해 "모델이 더한 것"을 공평하게 센다.

모든 지표에 n과 부트스트랩 95% 신뢰구간(재표본 2,000회, seed 고정)을 적는다. 시스템 간 차이는 같은 항목으로 짝지은 부트스트랩으로 Δ와 CI를 낸다.

## 5. 하네스

위치 `services/ai/eval/sol_eval/`(Python, `uv run python -m sol_eval …`, [[21-MODEL-TRAINING|21 모델 학습]] §4.1·§6). `pnpm verify`·CI에는 실모델 실행을 넣지 않고, mock 계약 시험만 pytest에 넣는다([[11-TESTING|11 테스트]] §3.4).

```text
services/ai/eval/sol_eval/
  __main__.py            # run · labels · report 하위 명령
  dataset.py             # EvalItem 축소판 JSONL 읽기·검증
  labels.py              # 라벨 파일 검사(값 집합·근거 존재·중복)
  state.py               # services/ai/kev 의 state 빌더를 그대로 import (train/serve skew 방지)
  systems/
    base.py              # predict(item, questions) -> {qid: Distribution}
    e0_rules.py          # predictions.e0.jsonl 읽기 (규칙 엔진은 Node 쪽에서 미리 계산)
    e1_kev.py            # kev_wire 어댑터 재사용, en state
    e2_kev_ko.py         # ko state, KEV_ALLOW_KO_STATE 확인
    e3_qwen.py           # vLLM prompt_logprobs 분류, e3_prompt.v0.1.md
    mock.py              # fixtures/kev/FX-xx.json 재생 (계약 시험 전용)
  metrics.py             # acc·macro_f1·confusion·brier·ece·nll·selective·permute
  bootstrap.py           # 재표본·짝 비교
  report.py              # report.json · report.md
```

- **입력 JSONL**(21 §3.7 `EvalItem` 축소판): `itemId`, `source`(`fixture`·`live`), `bid{noticeId,revisionId}`, `extractionId`, `profileRevision`, `rulePredictions{qid: label}`, `labels[{qid, label, reason?, labelSource, draftedBy, labeler?, labeledAt?, noticeEvidence[], companyEvidence[]}]`. state는 하네스가 `state.py`로 만든다(저장하지 않고 `stateHash`만 리포트에).
- **E0 예측**: 규칙 엔진이 TypeScript(`web/server/scoring`)라 Node 스크립트 `scripts/eval/rules-predict.mjs`(가칭, C4 뒤)가 같은 항목을 돌려 `predictions.e0.jsonl`을 만든다. Python은 읽기만 한다. 21 §3.7의 "Node가 EvalItem을 만들고 Python이 평가" 2단 구조와 같다.
- **출력**: `report.json`(지표·CI·n·시스템·모델 id·`promptHash`·`stateTemplate`·질문 세트·데이터셋 sha256·git commit)과 `report.md`(발표용 표). 예측 원문은 `predictions.<system>.jsonl`. 증거 폴더 `docs/evidence/eval/<일시>-e0-e1-e2-e3/`에는 `report.md`·`report.json`·`error-analysis.jsonl`·`signal-review.jsonl`만 두고, 실제 RFP 원문·인용 텍스트는 넣지 않는다.
- **mock 계약 시험**(`services/ai/tests/test_sol_eval_contract.py`): `systems/mock.py`로 fixture 4건을 돌려 지표 파이프라인·리포트 스키마·부트스트랩 결정성(seed)을 확인한다. 실모델 없이 CI에서 돈다.
- **`kev.benchmark` 래핑**: E1·E2는 `kev.benchmark --remote --data`로 acc·nll·brier·ece를 한 번 더 뽑아 하네스 값과 대조한다(교차 검증용, 리포트 부록). E0·E3는 Kev 도구가 못 재므로 하네스 자체 지표가 정본이다. `kev.compare`는 같은 데이터 해시의 Kev 체크포인트끼리만 쓴다(E4 이후).
- 실행 위치: 회사 GPU 서버에서 `kev.serve`·vLLM에 직접 붙거나, 노트북 gateway(터널)로. 어느 쪽이든 `report.json`에 적는다.

## 6. 준비 순서 (C4·C5와 병렬)

**지금 할 수 있는 것(모델 없이)**

1. 라벨 파일 초안 `fixtures/eval/labels/fixture.v0.1.jsonl`: 07 §6.2 표에서 `recommendation`·`req.*.status` 정답을 옮기고(`draftedBy=RULE`), `mandatoryRisk`·`needsHumanReview`·`risk.*`는 fixture 본문·추출 fixture를 보고 사람이 채운다. `sol_eval labels check` 통과.
2. 질문 세트 ↔ 라벨 매핑 표(`services/ai/kev/question-sets/v0.1.json`·`v0.2.json`의 qid와 §3 표 일치 확인). `fit`·`techFit`·`perfRelevance`는 채점 제외로 표시.
3. 하네스 뼈대: `dataset.py`·`labels.py`·`metrics.py`·`bootstrap.py`·`report.py`·`systems/mock.py`와 계약 시험. `e1`·`e3`는 인터페이스와 wire 계약 시험만.
4. E3 프롬프트 `e3_prompt.v0.1.md` 초안과 선택지 로그확률 계산 방식 결정(§2).
5. 리포트 템플릿(`report.md` 표 형태, 발표 슬라이드 "실험 결과" 장과 같은 열).
6. 실공고 5건 선정 기준: 정보화사업 용역, 첨부 파싱 `PARSED`, 자격 조항이 있고, 기술·실적·인력 요구가 각각 1개 이상, 예산·마감이 있는 공고. 분야·기관을 겹치지 않게. C3 뒤 확정.
7. 신호 유효성 판정표(`signal-review.jsonl` 형식, 판정 기준 §4).

**모델이 있어야 하는 것(C5 `local` + C1 ③ 뒤, 모델 기동은 별도 승인)**

8. E0 예측 생성(C4 규칙 엔진 뒤).
9. E1·E2·E3(·E3-ko) 실행, permute·반복·표현 변경 시험, 지연·VRAM 기록.
10. 오류 분석(E1 필수)과 신호 유효성 판정.
11. 리포트·3안 제안.

## 7. 판정 규칙과 3안

주 지표: `req.*.status`와 `recommendation`의 Macro-F1, 정보부족→미충족 혼동률, 플래그 정밀도, 유효 신호 수, 지연 p95. 모든 비교는 짝 부트스트랩 Δ와 95% CI로 본다. **CI가 0을 걸치면 "차이 없음"으로 보고한다.** 점추정만으로 우열을 말하지 않는다.

| 조건(모두 만족) | 제안 | 발표에서 말할 수 있는 것 |
|---|---|---|
| **(1) 보조 위험 신호 탐지기로 유지**: E1이 E0 대비 유효 신호를 3건 이상 더 잡고, 플래그 정밀도 ≥ 0.5이며, 혼동률이 E0보다 나쁘지 않고, Macro-F1 Δ(E1−E3)의 CI가 0을 걸치거나 E1이 우세 | 지금 구조 그대로(참고 지표·플래그) | "규칙이 놓친 검토 신호 N건을 사람 확인으로 추가로 잡았다(잘못된 경고 M건, n=…)" |
| **(2) 역할 축소**: 유효 신호가 1~2건이거나 정밀도 < 0.5인데 특정 질문(예: `mandatoryRisk`·`needsHumanReview`)만 정밀도 ≥ 0.5 | 그 질문만 남기고 나머지 Kev 질문은 화면에서 뺀다. 질문 세트 버전을 올린다 | "Kev는 필수 자격 위험 경고 한 가지 용도로만 쓴다" |
| **(3) 규칙 + Qwen을 MVP 기본 경로**: E3가 Macro-F1에서 E1보다 우세하고 Δ CI가 0을 제외하거나, E1의 유효 신호가 0건이거나, E1 공고당 p95 지연이 데모 예산(분할 요청 합산 15초)을 넘거나, ECE > 0.25로 분포가 신뢰할 수 없음 | `KEV_ENABLED=false`를 기본으로, Kev는 "평가 결과 효과 미확인" 상태로 문서에만 남김. E3 분류를 참고 지표로 쓸지는 별도 결정 | "소형 결정 모델을 평가했고 지금 규모에서는 효과를 확인하지 못해 규칙 + Qwen으로 간다" |
| **판단 보류**: 위 어느 쪽도 아님(신호 1~2건, 모든 Δ CI가 0을 걸침) | (1)로 두되 화면·발표에 "효과 미검증(n=…)" 표기 | 수치와 CI만 말한다 |

영어 전용 모델의 한국어 한계 검토 항목: E1↔E2 Δ(한국어 state가 더 나쁘면 영어 변환이 필요하다는 근거, 더 좋거나 같으면 변환 비용을 재검토), `translations` 품질(숫자 보존 실패로 `(untranslated)`가 된 값의 비율, `TRANSLATION` 원인 오류 수), E3↔E3-ko(한국어를 읽는 모델이 변환 없이 더 나은가). 결론은 21 §4.4 절차대로 사람이 내리고 [[16-DECISIONS|16 ADR]]에 남긴다. 파인튜닝 착수는 이 실험 결과만으로 정하지 않는다.

## 8. 정직성·보고 형식

리포트 머리에 고정으로 적는다: 데이터셋 버전·sha256, n(공고·항목), 라벨 출처 분포(`CONSTRUCTED`/`HUMAN`), 라벨러 수(두 번째 라벨러가 없으면 Cohen κ 미측정이라고 적는다), 모델 id(`jaredpalmer/kev-9b@v1.0`, `Qwen/Qwen3.5-9B`)·`promptHash`·`stateTemplate`·질문 세트 버전, 실행 위치·날짜, 한계("fixture 19 + 실공고 5의 예비 실험이며 일반화된 성능을 뜻하지 않는다").

| 쓸 수 있는 문장 | 쓸 수 없는 문장 |
|---|---|
| "fixture 19건과 실제 공고 5건에서 Kev-9B 참고 지표는 규칙이 놓친 검토 신호 N건을 추가로 잡았고(사람 확인), 잘못 경고한 건은 M건이었다(n=…, 95% CI …)." | "Kev 덕분에 정확도가 올랐다."(수치·CI 없이) |
| "같은 입력에서 Qwen 분류(E3)와 Kev(E1)의 Macro-F1 차이는 Δ=…(95% CI …)로 통계적으로 구분되지 않았다." | "Kev가 BID/WATCH/NO-BID를 결정한다." |
| "Kev는 점수·자격·권고에 반영되지 않는 참고 지표이며 보정 전(UNCALIBRATED)이다." | "Kev가 낙찰 확률·충족 확률을 예측한다." |
| "영어 전용 모델이라 한국어 입력은 영어 템플릿으로 바꿔 넣었고, 한국어 state와의 차이는 Δ=…였다." | "한국어 공고에서 검증된 모델이다." |
| "표본이 작아 신뢰구간이 넓다. 확장 평가는 해커톤 뒤다." | "실험으로 성능을 입증했다." |

mock Kev 값(07 §6.3)으로 만든 데모 장면(S3 `FX-03`)은 "고정 응답"이라고 말하고 실험 결과와 섞지 않는다.

## 9. 일정과 산출물

| 시점 | 작업 | 선행 |
|---|---|---|
| 10-19~20 | §6 1~7(라벨 초안·매핑·하네스 뼈대·mock 계약 시험·E3 프롬프트·리포트 템플릿·선정 기준) | 없음 |
| 10-21~23 | E0 예측 생성, 실공고 5건 선정·파싱·사람 라벨, 신호 판정표 | C4, C3 |
| 10-24~25 (X1) | E1·E2·E3(·E3-ko) 실행, 오류 분석, 신호 판정, 리포트, 3안 제안 | C5 `local`, C1 ③, 모델 기동 승인 |
| 10-25~26 | 발표 슬라이드 "실험 결과" 장 반영, ADR 제안 | X4 |

산출물:

- `fixtures/eval/labels/fixture.v0.1.jsonl`, `datasets/labels/live.v0.1.jsonl`(gitignore)
- `services/ai/eval/sol_eval/**`, `services/ai/tests/test_sol_eval_contract.py`
- `scripts/eval/rules-predict.mjs`(E0 예측)
- `docs/evidence/eval/<일시>-e0-e1-e2-e3/{report.md, report.json, error-analysis.jsonl, signal-review.jsonl}`
- `eval_runs` 표 등록(`pnpm eval:publish`, [[04-DATABASE|04 DB]] §3.7)은 선택
- 16 ADR 제안 행(3안 중 하나, 결정은 사람)

## 관련 문서

- [[21-MODEL-TRAINING|21 모델 학습]] — E0~E4 정의, 지표, 오류 원인 코드, 하네스
- [[03-AI-PIPELINE|03 AI 파이프라인]] — `kev-qs/v0.1`·`v0.2`, state 템플릿, `KEV_ALLOW_KO_STATE`
- [[08-SCORING|08 점수]] — Kev 플래그 처리, 점수 미반영, 반영 절차
- [[11-TESTING|11 테스트]] — 평가는 CI 밖, 증거 규칙
- [[07-DATA-PIPELINE|07 수집]] — fixture 기대 결과, mock Kev 값
- [수상 전략 계획](2026-10-18-hackathon-award-plan.md) — X1 일정, 정본 변경 범위
