---
title: "21. 모델 학습: 데이터셋·평가·파인튜닝"
doc: "21"
status: review
tags:
  - sol-radar
  - ai
  - evaluation
  - hackathon
updated: 2026-10-20
---

# 21. 모델 학습: 데이터셋·평가·파인튜닝

> [!tip] 심사 포인트
> "모델이 정말 쓸 만한가"를 숫자로 답하는 문서다. 실제 나라장터 공고와 가상 기업으로 평가셋을 만들고, 규칙만 쓴 경우와 결정 모델 Bosun v3.1 0.6B(영어·한국어 입력)를 같은 지표로 비교한다. 파인튜닝은 지표가 목표에 못 미친다는 이유만으로 시작하지 않는다. 오류 분석에서 모델 자체의 판단 오류가 주된 원인으로 확인될 때만 회사 GPU 에서 LoRA 로 진행한다([[16-DECISIONS|ADR-020]]). 해커톤에는 사용자 결정으로 Bosun v3.1 0.6B LoRA 를 비교 실험(E4)으로 먼저 돌린다. 데모 모델은 공개 Bosun v3.1 0.6B 그대로이고, 운영 반영은 위 판단을 그대로 따른다([[16-DECISIONS|ADR-034]]. 2026-10-20 에 결정 모델이 Kev-9B 에서 Bosun 으로 바뀌었고 ADR-027 은 폐기됐다).
>
> 이 문서는 무엇을 왜 학습하는지 정한다. 모델을 어디서 받고, 회사 GPU 에서 어떤 명령으로 학습·보정·병합·반입하는지는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]에 있다.

## 1. 범위

| 단계 | 내용 | 해커톤 |
|---|---|---|
| F0 | 결정 모델(공개 Bosun v3.1 0.6B) 베이스라인 추론 E1', 한국어/영어 입력 비교, 평가셋 구축, 평가·비교 하네스, 학습셋 내보내기(Bosun 질문 단위 레코드), LoRA 메모리 검증 스크립트 | **완료 조건**. 하네스의 Bosun 부분(`sol_eval.export --format bosun`·`sol_eval.bosun_score`·`sol_eval.leakage`)은 B1 예정(2026-10-20 미구현) |
| F1 | 회사 GPU 에서 Bosun LoRA 메모리 검증 실행(GPU 서버 셸이 필요해 회사 측 실행, [[16-DECISIONS\|ADR-025]]). 물리 GPU 1(NVIDIA A40 46,068 MiB) 한 장만 쓰고, 회사 PaddleOCR vLLM(약 9,167 MiB, 2026-10-20 사용자 보고)과 **공유**한다. 서버 환경(venv `.venv-bosun`, torch 2.8.0+cu128·CUDA·bf16)은 2026-10-20 확인, GPU 에서의 Bosun 학습은 미실행([[22-FINETUNE-RUNBOOK\|22]] §3.1) | B4(10-24, 회사 측 실행, [[16-DECISIONS\|ADR-034]] 12번). 학습 가능 여부는 F1 결과로만 확정. 결과를 받으면 기록 |
| F2 | Bosun v3.1 0.6B LoRA 이어 학습(`en`. 공개 LoRA 392 텐서만, decision 임베딩 동결) | B4(회사 측 실행, ADR-034). 비교 실험이라 §4.4 착수 조건을 기다리지 않는다 |
| F3 | 온도 보정·평가·반입·운영 모델 교체 | 보정·E4 평가(E1' 대비)는 B5(10-25). 반입·운영 모델 교체는 후속이고 §4.4 판단·사용자 승인·ADR 을 거친다(ADR-034 9번) |
| — | Qwen 파인튜닝 | **하지 않는다**(2026-10-20 사용자 결정, §5.6). 추출·설명 모델은 회사가 운영하는 vLLM API 의 `Qwen/Qwen3.5-27B` 다 |

모델 역할(Qwen3.5-27B(회사 vLLM API) = 추출·설명, Bosun v3.1 0.6B = typed decision 확률 분류, 규칙 = 명시 조건, SOL Score = 별도 산식)은 [[03-AI-PIPELINE|03 AI 파이프라인]] §1, 라벨 값과 사유 코드는 [[08-SCORING|08 점수]], 결정 모델 질문 세트 `kev-qs/v0.2`(이름은 호환 유지, ADR-034)와 state 는 03 §5 를 따른다. 실제 낙찰 결과는 학습 목표로 쓰지 않는다(승률 예측은 범위 밖, [[01-PRD|01 PRD]]).

## 2. 라벨

평가셋 라벨은 규칙 판정·결정 모델 질문과 같은 3값을 쓴다([[08-SCORING|08 점수]] 판정 라벨 절).

- `SATISFIED`(충족): 공고 요구가 근거와 함께 `KNOWN` 이고, 회사 쪽에 충족 기록이 있다.
- `NOT_SATISFIED`(미충족): 공고 요구가 근거와 함께 `KNOWN` 이고, 회사 쪽에 **명시적 부정 근거**가 있다.
- `NEEDS_REVIEW`(확인 필요): 그 밖의 모든 경우. 사유 코드(`NOTICE_INFO_MISSING`·`NOTICE_CONFLICTED`·`COMPANY_EVIDENCE_MISSING`·`AMBIGUOUS_MATCH`·`PARSE_UNSUPPORTED`·`STAGE_NOT_APPLICABLE`)를 붙인다.

정보 부족은 미충족이 아니다. 평가 지표에서도 둘의 혼동을 따로 잰다(§4.3).

## 3. 데이터셋

### 3.1 구성

| 구성 | 출처 | 저장 |
|---|---|---|
| 공고·RFP | `live` 모드로 수집한 실제 공고(`is_demo=false`, 정보화사업, 첨부 파싱 성공) | Supabase + MinIO. 저장소에는 넣지 않는다 |
| 가상 기업 | 직접 설계한 원형 6개와 항목별 변형 | `fixtures/eval/companies/*.json`(가상이라 커밋) |
| 라벨 | 구성 라벨(`CONSTRUCTED`) + 사람 라벨(`HUMAN`) + 규칙 실버 라벨(`RULE_SILVER`) | 데이터셋 번들(MinIO). 사람 라벨 원본은 `datasets/labels/`(gitignore) |
| fixture `FX-01`~`FX-20` | 회귀 확인용 | 평가 통계에서 뺀다 |

### 3.2 가상 기업 원형

1. 대형 공공 SI
2. 중견 공공 SI(솔리데오와 비슷)
3. AI·RAG 전문 스타트업
4. 유지보수 전문
5. 데이터 플랫폼 전문
6. 실적 없는 신생

원형마다 기술(숙련도), 업종 코드, 면허·인증(`HELD`/`NOT_HELD`), 수행 실적(분야·금액·완료일·증빙), 인력(역할·등급·가용 FTE), 재무·수행 상한, 기술 목록 완결 여부(`technologies_complete`)를 가진다. 실제 회사 이름·실적은 쓰지 않는다.

### 3.3 대조 사례 (같은 공고 · 다른 기업)

공고의 요구사항 항목마다 원형을 고쳐 변형을 만든다. 변형의 라벨은 구성으로 정해진다.

| 변형 | 바꾸는 것 | 라벨 (`CONSTRUCTED`) |
|---|---|---|
| 충족 | 해당 기술·면허·실적·인력 기록과 증빙 추가 | `SATISFIED` |
| 명시적 미충족 | `NOT_HELD`, 요구치 미만 수치, `technologies_complete=true` 목록에서 기술 제거 | `NOT_SATISFIED` |
| 정보 부족(회사) | 해당 필드나 증빙 삭제, `technologies_complete=false` | `NEEDS_REVIEW` / `COMPANY_EVIDENCE_MISSING` |
| 정보 부족(공고) | 추출이 `UNKNOWN`·`CONFLICTED` 인 항목 | `NEEDS_REVIEW` / `NOTICE_*` |

- 동의어·상위개념 대응(예: "MSA 기반 클라우드 네이티브" ↔ "Spring Cloud + Kubernetes")은 구성으로 정답을 확정할 수 없다. 사람 라벨로 정한다.
- `techFit`·`perfRelevance`·`risk.*` 도 사람 라벨이다.
- 규칙 엔진이 계산하는 명시 조건은 `RULE_SILVER` 로 학습셋에만 넣는다. test 에는 `CONSTRUCTED`·`HUMAN` 만 쓴다.

### 3.4 라벨링 절차

해커톤에는 라벨링 화면을 만들지 않는다. JSONL 파일과 검증 CLI 로 한다.

1. 데이터셋 빌더가 항목·변형을 만들고, 규칙 판정과 Qwen 추출로 초안 라벨을 채운다.
2. 사람이 JSONL 라벨 파일을 검수한다. `sol_eval.labels check` 가 형식·값 집합·근거 존재를 검사한다.
3. 추출 정답(gold `RequirementExtraction`)도 같은 방식이다. 인용은 인용 검증기([[15-DATA-CONTRACTS|15 데이터 계약]] §5)를 통과해야 한다.
4. 사람 라벨에는 라벨러 id·시각·도구 버전을 남긴다. test 의 10% 는 두 번째 사람이 다시 라벨링해 Cohen κ 를 잰다. 두 번째 사람이 없으면 이 지표가 빠졌다고 리포트에 적는다.
5. 초안 출처를 `draftedBy`(`RULE`·`QWEN`·`CLAUDE`·`NONE`)로 남긴다. 사람이 검수해 확정한 것만 `labelSource=HUMAN` 이다. Qwen 초안에서 시작한 gold 는 정답이 초안에 끌려갈 수 있다. 그래서 test 추출 gold 중 5건 이상은 초안 없이(`draftedBy=NONE`) 만들고, 이 묶음과 나머지의 Qwen 점수 차이를 함께 보고한다.

### 3.5 규모 (해커톤, 사용자 결정 2026-10-16)

| 분할 | 사업 수 | 사람 작업(추정) |
|---|---:|---|
| test | 20 | 추출 정답 20건(약 7~13시간), 의미 대응 라벨 150건 이상(약 3시간). 항목 라벨은 사업당 원형 4개 × 항목 약 8개(약 640건)로 대부분 구성 라벨이다 |
| dev | 10 | 임계값 τ·온도 보정용 |
| train | 나머지 전부 | B3 에서 1,000 레코드(질문 단위) 이상으로 내보내 F2 에 쓴다(ADR-034. 처음은 ADR-027 X6b). test·dev 클러스터는 뺀다. 질문별 라벨 출처는 [[22-FINETUNE-RUNBOOK\|22]] §4.1 |
| **해커톤 축소판**(ADR-023 X1) | fixture 20건 + 실제 공고 5건 | 핵심 컷. fixture 라벨은 [[07-DATA-PIPELINE\|07]] §6.2 기대 결과(mock 결정 모델 값은 정답이 아니다), 실공고 5건은 사람 라벨. E0·E1'·E2·E3 비교와 E1' 오류 분석. 위 test 20·dev 10 은 B3(ADR-034. 처음은 ADR-027 X6a) |

표본이 작아서 신뢰구간이 넓다. 해커톤 B5 의 E4 는 test 20 으로 하는 비교 실험이다. 운영 반영(§4.4)은 해커톤 뒤 test 를 40 사업 이상으로 늘린 다음에 판단하는 것이 바람직하다.

### 3.6 분할과 누수 방지

- **사업 단위 분할**: `bidNtceNo`·`bfSpecRgstNo`·`orderPlanUntyNo`·`befBidBbancNo`(재공고의 이전 공고)를 union-find 로 묶어 사업 클러스터를 만들고, `hash(clusterId)` 로 train/dev/test 를 정한다. 같은 사업의 공고문과 RFP 가 두 분할에 걸치지 않는다.
- **유사 문서 병합**: 다른 클러스터인데 RFP 본문 MinHash Jaccard ≥ 0.8 이면 합친다(예: 같은 기관의 연례 유지보수).
- **기업 일반화**: 원형 하나는 train 에서 빼고 test 에만 둔다. "처음 보는 기업" 하위 지표로 보고한다.
- **개인정보 마스킹**: 담당자 이름·전화·이메일 필드는 처음부터 넣지 않는다. 본문·첨부 텍스트의 전화·이메일 패턴은 같은 길이의 마스킹 문자로 바꿔서 인용 오프셋이 그대로 맞게 한다([[09-SECURITY|09 보안]]).

### 3.7 형식과 내보내기

정본 형식은 `EvalItem` 하나다. 내보내기는 이것을 변환한다.

```ts
interface EvalItem {
  itemId: string;                          // "{clusterId}:{revisionId}:{companyVariantId}"
  split: "train" | "dev" | "test";
  clusterId: string;
  bid: { source: string; noticeId: string; amendmentNo: string; revisionId: string };
  extraction: RequirementExtraction;       // gold(test·dev) 또는 Qwen 출력(train)
  company: CompanyProfileSnapshot;         // 가상 기업 변형
  labels: {
    qid: string;                           // kev-qs/v0.2 의 qid (03 §5)
    label: string;                         // choice 선택지 / "true"|"false" / score 등급 index
    reason?: string;                       // NEEDS_REVIEW 사유 코드
    target?: Record<string, number>;       // 소프트 라벨(선택)
    labelSource: "CONSTRUCTED" | "HUMAN" | "RULE_SILVER";
    draftedBy: "RULE" | "QWEN" | "CLAUDE" | "NONE";
    noticeEvidence: EvidenceRef[];         // 15 §2
    companyEvidence: CompanyEvidenceRef[]; // 15 §2
  }[];
}
```

- **Bosun 질문 단위 레코드** `bosun/{split}.en.jsonl`(ADR-034, [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §4.2): Bosun 은 질문 하나당 forward 1회라 한 줄이 **질문 하나**다(Kev JSONL 의 "state 1 + 질문 N" 한 줄과 다르다. Kev 형식은 퇴역). `EvalItem`·`Label` 필드를 보존하고 `questionType`·`candidates`(03 §5.4 타입 변환 표)·`gold`(one-hot 또는 `Label.target` soft)를 더한다. state 는 서빙과 **같은 코드**(`services/ai/kev` 의 state 빌더)와 같은 템플릿 버전(`en.v0.2`)으로 만들고, `instructions` 는 `services/ai/kev/question-sets/v0.2.json` 원문 그대로다([[16-DECISIONS|ADR-033]] E10). 학습·E1'·E4 는 `en` 만 쓴다. E2 용 `ko` state 레코드의 파일 이름은 미확인(B1 에서 기록).
- **Qwen SFT JSONL**: 내보내지 않는다. Qwen 파인튜닝은 하지 않는다(2026-10-20 사용자 결정, §5.6). 추출 gold(`EvalItem.extraction`)는 EX0 측정에만 쓴다.
- **번들** `sol-dataset-{version}.tar`
  - `manifest.json`: 데이터셋 버전, git commit, 질문 세트·state 템플릿·라벨 스키마·마스킹 버전, 분할·라벨·출처별 개수, 파일별 sha256, train∩(dev∪test) 클러스터 0건 확인, 질문별·선택지별 분포(각 ≥ 5%)
  - `bosun/{split}.en.jsonl`(`kev/` 디렉터리는 만들지 않는다)
  - `MODEL_TRAINING.md`(§5 절차)
- 빌더는 두 단계다. Node 스크립트(`pnpm dataset:build`(예정), service role, seed 스크립트와 같은 지위)가 Supabase·MinIO 에서 `EvalItem` 을 만들고, Python(`services/ai`, DB 접근 없음)이 Bosun 레코드로 바꾼다(`sol_eval.export --format bosun`, **B1 예정(2026-10-20 미구현)**. 지금 `export.py` 는 Kev 레코드만 쓴다).

Bosun 레코드 예시(계획 §4.2 원문. 한 줄 = 질문 하나):

```json
{"rowId":"sha256(itemId:qid)","itemId":"…","clusterId":"…","split":"train",
 "bid":{"source":"g2b","noticeId":"…","revisionId":"…"},"companyVariantId":"…",
 "qid":"req.requiredSkills[0].status","questionType":"choice",
 "instructions":"<v0.2.json 원문>",
 "candidates":[{"id":"SATISFIED","label":"SATISFIED","description":"<criteria>"},
               {"id":"NOT_SATISFIED","label":"NOT_SATISFIED","description":"<criteria>"},
               {"id":"NEEDS_REVIEW","label":"NEEDS_REVIEW","description":"<criteria>"}],
 "state":"NOTICE\n- stage: NOTICE; agency: (Korean public agency); …\n\nCOMPANY (profile revision 2)\n- …",
 "stateHash":"…","stateTemplate":"en.v0.2","questionSet":"kev-qs/v0.2",
 "gold":{"candidateId":"NEEDS_REVIEW","probabilities":[0,0,1]},
 "labelSource":"CONSTRUCTED","reason":"INSUFFICIENT_EVIDENCE",
 "noticeEvidence":[…],"companyEvidence":[…]}
```

## 4. 평가

### 4.1 하네스

- 위치: `services/ai/eval/`(Python, `uv run python -m sol_eval …`). 노트북에서 회사 추론 엔드포인트에 붙여 돌린다([[16-DECISIONS|ADR-025]]): 결정 모델은 `KEV_BASE_URL`(`/sol-radar/kev` → `sol_decision.serve`, Kev wire 호환) 직접 또는 평가용 gateway URL, Qwen 은 회사가 운영하는 vLLM API(`QWEN_BASE_URL=https://acropolissg.com/vllm/v1`, 모델 `Qwen/Qwen3.5-27B`). E4·E1' 는 엔드포인트에 붙지 않는다. 회사가 서버 안에서 `sol_eval.bosun_score --package <dir> --data test.en.jsonl --seeds 0-5 --out runs/e4-test`(**B1 예정, 2026-10-20 미구현**)로 채점한 출력 폴더(`predictions.jsonl`·`rows.json`·`report.json`)를 받아 `sol_eval` 이 오프라인으로 지표를 내고, 실행 전에 `report.json` 의 패키지 `manifest.json` sha256·test 파일 sha256 을 번들 manifest 와 대조한다([[16-DECISIONS|ADR-034]] 7번, [[23-WEEKEND-FINETUNE|23]] §2.2). 요청당 지연은 E4 에서 재지 않는다.
- 결과: `report.json`·`report.md`. 숫자 요약만 `docs/evidence/eval/` 에 둔다. 실제 RFP 원문은 증거 폴더에 넣지 않는다.
- 결정 모델 지표(acc·nll·brier·ece·selective 등, 보정 전후)와 체크포인트 비교(같은 데이터 해시끼리 짝지은 부트스트랩)는 `sol_eval` 이 직접 계산한다. Kev 저장소의 `kev.benchmark`·`kev.compare` 는 쓰지 않는다(퇴역, ADR-034).

> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev main `1f04cfa`)
> `kev/benchmark.py`(옵션 `--run|--remote`, `--suite|--data`, `--out`, `--split`, `--rotations`, `--date_facts`, 출력 `predictions.jsonl`·`rows.json`·`report.json`), `kev/metrics.py`(acc, nll, brier, ece, confident_error_rate, coverage_at_5pct_error, aurc, selective, score_mae, RPS), `kev/compare.py`(데이터 해시 일치 필요, nll·acc·brier 짝지은 부트스트랩)가 저장소에 있다.
> 퇴역(ADR-034, 2026-10-20): 결정 모델이 Bosun 으로 바뀌어 위 도구는 쓰지 않는다. 이력으로 남긴다. `sol_eval.bosun_score` 는 같은 출력 파일 이름을 쓴다.

> [!warning] 미검증 가정 (2026-10-20)
> - 순서 민감도는 Kev 의 `POST /v1/systemone/permute`(`n_perm=6`) 대신 Bosun 의 후보 제시 순서 seed(`sha256(f"{seed}:{row_id}:candidate-order")`) 0~5 로 6회 돌려 잰다. `sol_decision.serve` 에는 `permute` 엔드포인트가 없다.
> - `sol_eval.bosun_score`·`sol_eval.export --format bosun`·`sol_eval.leakage` 는 B1 예정(2026-10-20 미구현)이다. B3 에서 가짜 출력으로 먼저 시험한다.

### 4.2 비교 대상

| ID | 시스템 | 해커톤 |
|---|---|---|
| E0 | 규칙만(결정 모델 없음) | 필수 |
| E1 | Kev-9B@v1.0, `en` state | **퇴역·미측정**([[16-DECISIONS\|ADR-034]] Q5). Kev-9B 는 가중치만 받았고 `kev.serve`·F1 은 실행하지 않았다. 범위 밖 |
| E1' | 공개 Bosun v3.1 0.6B(`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`) zero-shot, `en` state | 필수. E4 의 기준선 |
| E2 | 공개 Bosun v3.1 0.6B, `ko` state(`KEV_ALLOW_KO_STATE=true`, 평가 전용) | 필수 |
| E3 | Qwen3.5-27B(회사 vLLM API) 프롬프트 분류(같은 질문, 선택지 토큰 logprob 으로 분포) | **필수**([[16-DECISIONS\|ADR-023]], 2026-10-19. 모델은 2026-10-20 사용자 결정으로 회사 API 의 Qwen3.5-27B). "결정 모델이 꼭 필요한가"를 판단하는 대조군. 해커톤은 축소 규모(§3.5)로 E0·E1'·E2·E3 를 같은 입력에서 비교한다. 설계·판정 규칙·3안(유지/축소/제외)은 [E3 실험 설계](plans/2026-10-19-e3-experiment-design.md). 회사 vLLM 이 `prompt_logprobs` 를 주는지는 미검증 |
| E4 | Bosun v3.1 0.6B + LoRA(`en`, 공개 LoRA 이어 학습) | B5(ADR-034). E1' 과 같은 test 분할·데이터셋 버전·state 템플릿·질문 세트·평가 코드·seed 0~5·지표에서 짝 부트스트랩 95% CI(사업 클러스터 단위 우선, §4.3)로 비교. 서버 안 오프라인 채점(§4.1), 물리 GPU 1 에서 E4·E1' 순차. `ko` 는 후속 |
| EX0 | Qwen3.5-27B(회사 vLLM API) 추출 원본 | 회사 API 추출 품질 기준 측정만(§4.3 추출 행 + `(untranslated)` 비율). 파인튜닝 비교(EX1)는 하지 않는다(§5.6) |

### 4.3 지표

| 영역 | 지표 | 정의 |
|---|---|---|
| 파싱 | 형식별 파싱 성공률·품질 | [[03-AI-PIPELINE\|03 AI 파이프라인]] §10(실제 RFP 샘플 비교) |
| 추출 (Qwen) | 필드 state 정확도 | gold 와 `state` 일치 비율 |
| | 값 일치 | 스칼라는 정규화 정확 일치, 배열은 집합 F1 |
| | 필수 항목 재현율 | gold 의 `mandatory=true` 자격·실적·인력 중 찾아낸 비율(긴 공고문에서 놓치지 않는가) |
| | 인용 정확도 | 출력 인용 중 15 §5 검증(EXACT·NORMALIZED·FUZZY) 통과 비율. 가드 전 근거 없는 `KNOWN` 비율도 따로 |
| 분류 (규칙·결정 모델) | Accuracy, Macro-F1 | 3값 기준. 항목 종류(기술·실적·인력·자격)별로도 |
| | 정보부족-미충족 혼동률 | 정답 `NEEDS_REVIEW` → 예측 `NOT_SATISFIED`, 그리고 반대 방향. 둘을 따로 보고 |
| | 사유 코드 정확도 | `NEEDS_REVIEW` 정답 중 사유까지 맞힌 비율(규칙) |
| 보정 | Brier, ECE, NLL | 보정 전과 후 |
| | 선택적 정확도 | 확률 상위 구간만 골랐을 때의 정확도(coverage–risk) |
| 일관성 | 반복 일치 | 같은 요청 5회. 결정 모델은 분포 최대 편차, Qwen 추출은 필드 일치율 |
| | 선택지 순서 | Bosun 후보 제시 순서 seed 0~5(6회, `sol_eval.bosun_score --seeds 0-5`)의 `argmax_stable` 비율과 `spread`. Kev 의 `/v1/systemone/permute` `n_perm=6` 을 대체한다(ADR-034) |
| | 표현 변경 | state 줄 순서 섞기 + 용어집 동의어 치환 뒤 argmax 가 바뀐 비율 |
| 언어 | 한국어/영어 차이 | E1'·E2 의 항목 id 짝 비교. ΔMacro-F1·ΔBrier·ΔECE 와 부트스트랩 95% 신뢰구간(하네스 자체 구현) |
| 성능 | 지연 | 요청당 p50·p95(결정 모델, Qwen 추출, 공고 1건 E2E) |
| | GPU 메모리 | 최대 점유(nvidia-smi 샘플링 또는 `torch.cuda.max_memory_allocated`) |
| | 처리량·비용 | 시간당 공고 수. 1,000건당 비용 = GPU 시간 단가(입력값) × 시간 |

모든 지표에 부트스트랩 95% 신뢰구간과 표본 수를 함께 적는다.

**신뢰구간의 단위(2026-10-20 추가).** 같은 사업에서 파생된 가상 기업 변형과 질문은 독립 표본이 아니다(같은 공고·같은 추출을 공유한다). 그래서 E1'·E4 비교의 CI 는 **사업 클러스터 단위 paired bootstrap**(클러스터를 복원 추출하고 그 안의 항목·질문을 통째로 넣는다)을 우선 내고, 레코드 단위 CI 는 참고로 함께 적는다. 클러스터 수가 적으면(해커톤 test 20) 구간이 넓다. 그때는 개선 효과를 확정적으로 주장하지 않고 **탐색적 결과**로 보고한다. 표본 수는 레코드·질문·클러스터 세 가지를 모두 적는다.

### 4.4 초기 목표 지표와 파인튜닝 착수 판단

**초기 목표 지표** (test 분할, 결정 모델 담당 항목)
- Macro-F1 ≥ 0.80
- 정보부족→미충족 혼동률 ≤ 5%
- 보정 후 ECE ≤ 0.08

**미달해도 자동으로 파인튜닝하지 않는다.** 오류 분석으로 원인 단계를 먼저 가른다.

| 원인 코드 | 판정 기준 | 고칠 곳 |
|---|---|---|
| `PARSE` | 근거 문장이 파싱 텍스트에 없거나 깨졌다(표 누락, 셀 순서 뒤섞임 등) | 파서([[03-AI-PIPELINE\|03]] §10) |
| `EXTRACTION` | 파싱 텍스트에는 있는데 Qwen 추출 값·state 가 틀렸다 | 프롬프트·스키마·Qwen |
| `TRANSLATION` | 추출은 맞는데 영어 state 의 값이 원문과 다르다 | 용어집·번역 |
| `STATE` | 템플릿이 정보를 빠뜨렸거나 잘랐다(토큰 상한 등) | state 템플릿 |
| `RULE` | 규칙 엔진·사전·코드 매핑이 틀렸다 | 규칙·사전 |
| `LABEL` | 라벨 자체가 틀렸다 | 라벨 수정 후 재평가 |
| `MODEL` | 위가 모두 정상인데 결정 모델(Bosun)의 판단이 틀렸다 | 파인튜닝 후보 |

절차:
1. test·dev 의 오답 항목마다 `stateTrace`(03 §5)와 단계별 중간 산출물을 따라가서 원인 코드 하나를 붙인다. 결과는 `error-analysis.jsonl`(`itemId`, `qid`, 정답, 예측, 원인 코드, 근거 메모, 분석자)에 남긴다.
2. 리포트에 원인 코드별 건수·비율과 대표 사례를 적는다.
3. `MODEL` 이 아닌 원인을 먼저 고치고 다시 평가한다.
4. 아래가 모두 해당할 때 LoRA 를 진행한다.
   - 다시 평가해도 목표 지표에 미달한다.
   - 남은 오류에서 `MODEL` 이 가장 큰 비중이다(제안: 절반 이상).
   - 그 오류 유형을 학습 데이터로 보완할 수 있다.
5. 결정은 사람이 하고 ADR 로 남긴다.

> [!note] 해커톤 예외 (ADR-034, 2026-10-20. 처음은 ADR-027, 2026-10-19)
> 해커톤의 Bosun v3.1 0.6B LoRA 학습은 사용자 결정으로 하는 E4 비교 실험이다. 그래서 위 4번 조건을 기다리지 않는다. 운영 반영(레지스트리 서빙 항목·데모 모델 교체, SOL Score 반영)은 위 절차와 ADR 을 그대로 따르고 사용자 승인이 필요하다(ADR-034 9번). E4 가 E1' 보다 낫다고 말하려면 Δ 의 95% CI 가 0 을 포함하지 않아야 한다. Qwen 파인튜닝은 **하지 않는다**(2026-10-20 사용자 결정, §5.6). `EXTRACTION` 원인은 프롬프트·스키마·용어집·인용 검증으로 고친다.

목표 미달은 점추정이 아니라 신뢰구간으로 판단한다. 신뢰구간이 목표를 걸치면 "판단 보류" 로 두고, 사례별 오류 분석을 함께 낸다. SOL Score 에 결정 모델을 반영할지([[08-SCORING|08 점수]])도 같은 지표와 오류 분석으로 따로 판단한다.

## 5. 파인튜닝 — Bosun v3.1 0.6B LoRA (회사 GPU 1, PaddleOCR 과 공유. 해커톤 비교 실험 + 후속 운영 반영)

이 절은 무엇을 언제 학습하고 결과를 어떻게 받아들이는지 정한다. 모델 출처(Hugging Face 리비전·sha256), 학습 환경, 질문별 학습 데이터, 명령, 돌려받을 것은 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]가 정본이다(ADR-034 로 Bosun 기준 개정 예정). 대상 모델이 2026-10-20 에 Kev-9B 에서 Bosun v3.1 0.6B 로 바뀐 근거와 파일 목록은 [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §4 다.

### 5.1 도구

- Bosun 공식 학습 코드는 **없다**(모델 카드·Hanno Labs GitHub 저장소에 없음, 계획 §1.1). 학습·채점은 우리 코드다: `services/decision` 의 `sol_decision.train`(학습), `sol_eval.bosun_score`(오프라인 채점), `sol_eval.export --format bosun`(레코드 내보내기), `sol_eval.leakage`(누수 검사). 전부 **B1 예정(2026-10-20 미구현)**이다. Kev 저장소 도구(`kev.train`·`kev.benchmark`·`kev.compare`·`scripts/calibrate_checkpoint.py`)는 쓰지 않는다(퇴역).
- 학습 대상은 공개 LoRA 어댑터(PEFT, r=16, alpha 32, dropout 0.05, `q_proj k_proj v_proj o_proj gate_proj up_proj down_proj` 7모듈 × 28층 = 392 텐서, 10,092,544 파라미터)만이다. 공개본에서 **이어 학습**하고 새 LoRA 를 만들지 않는다(Kev `--init_from` 과 같은 원칙). decision token 임베딩(256행 입·출력)·백본(`Qwen/Qwen3-0.6B@c1899de`)·토크나이저는 동결한다(ADR-034 7번).
- 손실: `render_decision_prompt(...)` → `(content, presentation_order, candidate_to_slot)` → `decision_logits(input_ids, attention_mask)[:, :K]`(K = 후보 수)에 CE(one-hot) 또는 soft-CE(`gold.probabilities`). 에폭마다 `seed=epoch` 로 후보 제시 순서를 바꿔 slot 편향을 막는다. 왼쪽 패딩 필수(`decision_logits` 가 마지막 열 attention 1 을 요구). `predict()` 는 `torch.inference_mode()` 안이라 학습에 쓰지 않는다. 학습 전에 `predict` 와 `decision_logits` 경로의 확률이 같은지(seed 고정) 테스트한다(계획 §10 4번).
- 회사 서버의 CPU 2-step smoke(장난감 6건 `datasets/decision/smoke.jsonl`, 2026-10-20 사용자 보고)는 **파이프라인 증거**로만 `docs/evidence/bosun-train-feasibility.md`(신규)에 적는다. 성능 주장에 쓰지 않는다. 그 코드는 저장소 밖이라 반입·리뷰 뒤 `services/decision/train.py` 로 흡수한다(계획 §10 10번).

### 5.2 보유 GPU 에서의 LoRA 메모리 검증 (F1)

회사 GPU 는 NVIDIA A40 46,068 MiB(PyTorch 가용 44.16 GiB) 3장 중 **물리 index 1 한 장**이고(2026-10-20 확인, [[22-FINETUNE-RUNBOOK|22]] §3.1), 그 GPU 는 회사 PaddleOCR vLLM(약 9,167 MiB, 2026-10-20 사용자 보고·미검증)과 **공유**한다. 가용은 약 36,900 MiB 로 본다. "GPU 1 전용"·"5 MiB" 는 2026-10-20 오전 스냅샷의 기록이고 전제가 아니다(ADR-034 10번). 80 GB·H100·H200 을 전제하지 않고, 3장의 VRAM 을 합치지 않고, 어떤 프로세스도 종료·이동하지 않는다.

F1 은 GPU 1 에서 `infra/gpu/bosun-f1.sh`(**B1 예정, 2026-10-20 미구현**. `kev-f1.sh` 는 보존)가 `python -m sol_decision.train --max_steps 20`(bf16, batch 1, gradient checkpointing, 6,000 토큰 state 포함)을 돌려 최대 메모리(torch 최대 할당·nvidia-smi 최대), step 시간, OOM 여부, state 토큰이 상한을 넘은 레코드 수, checkpoint 저장·재로딩(`BosunForDecision.from_pretrained(<dir>)` 뒤 `predict`) 여부를 `docs/evidence/bosun-train-feasibility.md` 에 표로 남긴다. 사전 검사는 `infra/gpu/bosun-preflight.sh`(B1 예정. `.venv-bosun`, Bosun snapshot sha256 대조, GPU 1 공유 허용 목록 — PaddleOCR 프로세스는 FAIL 아님)다. 학습 가능 여부는 이 결과로만 확정한다. 20 step 통과만으로 F2 준비 완료라고 적지 않는다. 메모리 추정(F1 실측 전, 계획 §8): Bosun LoRA 학습 약 6~10 GB, `sol_decision.serve` 서빙 약 1.5~3 GB. 실패 시 검토 순서(state 축약 → batch·누적 → 공식 메모리 옵션 → **사용자 승인 대상**인 다중 GPU·클라우드 GPU 임대(ADR-010))는 [[22-FINETUNE-RUNBOOK|22]] §4.2(개정 예정)다. Kev-4B 로의 축소 선택지는 퇴역했다.

### 5.3 학습 (F2)

공개 학습 레시피가 없으므로 lr·에폭 수·배치·누적은 미확인(F1 step 시간·메모리를 보고 22 §4.3 개정판에 기록)이다. 고정인 것: 공개 LoRA 이어 학습, decision 임베딩 동결, 질문 단위 레코드(§3.7), 에폭마다 제시 순서 seed 변경, 라벨 원칙은 [[22-FINETUNE-RUNBOOK|22]] §4.1(구성·규칙 실버는 train 만·사람 라벨·유료 LLM 라벨 금지·누수 0). 공개 replay 자료는 없다(Kev 의 2,000건 replay 는 퇴역). 망각 평가 방법은 미확인(B2 에서 기록). 명령과 받아들이기 전 확인 항목은 22 §4.3, 보정(dev)과 E4 평가는 22 §4.4 다(둘 다 개정 예정).

### 5.4 반입과 모델 레지스트리

- 회사 GPU 에서 돌려받는 것은 [[22-FINETUNE-RUNBOOK|22]] §4.5 다(개정 예정): 학습본 패키지 `runs/bosun-sol-lora-v0.1/`(Hugging Face 레이아웃 그대로 — `config.json`·`adapter/`·`decision_embeddings.safetensors`(복사, 변경 없음)·`tokenizer/`·`serving.json`·`manifest.json` 의 파일 sha256), `train.log`, `runs/f1-results.md`, 채점 출력 폴더(`predictions.jsonl`·`rows.json`·`report.json`), `MODEL_CARD.md`. 데이터셋 원문은 돌려받지 않는다. 받으면 manifest sha256 을 먼저 대조한다.
- 레지스트리 항목 필드와 서빙 검증(서버 기동 시 패키지 sha256 대조, gateway 의 `GET /v1/models` 대조, `questionSet`·`stateTemplate` 호환성)은 [[03-AI-PIPELINE|03 AI 파이프라인]] §11 이 정본이다. 학습본 항목 id 는 `bosun-sol-lora-v0.1`(`kind: decision`, `init_from: bosun-v3.1-0.6b`, `run` 은 회사가 돌려준 manifest 로 채움)이고 `reports` 가 채워질 때까지 `default: false` 다.
- E4 평가 전용 항목은 B5 에서 패키지를 받은 뒤 넣는다. 데모 서빙 항목 `bosun-v3.1-0.6b`(공개본)는 바꾸지 않는다. 학습본으로의 교체는 같은 평가셋에서 Δ 의 95% CI 가 0 을 배제하는 개선과 dev·regression 안정성을 보이고 **사용자 승인**을 받은 뒤에만 한다(ADR-034 9번).
- 운영 모델 교체는 ADR 로 정한다. 기존 `score_runs` 는 덮어쓰지 않는다.

### 5.5 실행 위치와 데이터 경계

- 평가 하네스(`sol_eval`)는 노트북에서 회사 GPU 추론 엔드포인트에 붙여 돌리고, F1·F2·F3 는 GPU 서버 셸이 필요해 회사 측이 돌린다(해커톤 실추론과 같은 GPU, [[10-DEPLOYMENT|10 배포]], [[16-DECISIONS|ADR-025]]). 학습 요청서(F1·F2 명령·F3 보정·돌려받을 것·데이터 경계)는 B3 에서 만들어 회사에 넘긴다([[22-FINETUNE-RUNBOOK|22]] §6, 개정 예정).
- 회사 GPU 로 가는 데이터는 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 회사 프로필뿐이다. 회사 GPU 서버는 공개 가중치(Bosun·백본 `Qwen/Qwen3-0.6B`, 리비전 고정)·코드를 Hugging Face·GitHub 에서 받는다(외부망이 없으면 반입, [[22-FINETUNE-RUNBOOK|22]] §2.2).
- 첨부 원문의 저작권·재배포 조건은 미확인이다. 내부 분석과 사내 학습에만 쓰고, 외부 공개·배포 전에 법무를 확인한다.

### 5.6 Qwen 파인튜닝 — 하지 않는다

Qwen 파인튜닝은 **하지 않는다**(2026-10-20 사용자 결정. ADR-034 채택 당시의 "EX0 뒤 조건부 QLoRA" 는 같은 날 사용자 결정으로 철회). 추출·설명 모델은 회사가 이미 운영하는 vLLM API 의 `Qwen/Qwen3.5-27B`(`https://acropolissg.com/vllm/v1`)이고 우리는 띄우지도 학습하지도 않는다. EX0 은 그 API 의 추출 품질 기준 측정(§4.2)이며, 추출 지표 미달의 `EXTRACTION` 원인은 프롬프트·스키마·용어집·인용 검증으로 고친다. `Qwen/Qwen3-4B-Instruct-2507`(ADR-034 초안의 추출 모델)과 `/sol-radar/qwen`→8001 경로는 **백업용으로 보존**하고 쓰지 않는다. Qwen SFT JSONL 은 내보내지 않는다(§3.7). `sol_decision.train` 은 생성 모델 학습용이 아니다. [[22-FINETUNE-RUNBOOK|22]] §5 의 Qwen 절은 이력이다.

## 6. 운영자 CLI

| 명령 | 위치 | 하는 일 |
|---|---|---|
| `pnpm dataset:build --version sol-eval/v0.1`(예정) | 루트 스크립트(service role) | live 공고·추출·가상 기업 → `EvalItem` + 분할 + 마스킹 → MinIO |
| `uv run python -m sol_eval.export --version … --format bosun --out sol-dataset-v0.1.tar` | `services/ai` | `EvalItem` → Bosun 질문 단위 레코드(`bosun/{split}.en.jsonl`)·manifest. **B1 예정(2026-10-20 미구현)**. 지금 `export.py` 는 Kev 레코드만 쓴다 |
| `uv run python -m sol_eval.leakage <bundle>` | `services/ai` | 클러스터 교차·held-out 기업·fixture 포함·선택지 분포(각 ≥ 5%) 검사 → 리포트. B1 예정(2026-10-20 미구현) |
| `uv run python -m sol_eval.labels check <file>` | `services/ai` | 사람 라벨 파일 검증 |
| `uv run python -m sol_eval.run --system E1' --split test --kev-url … --gateway-url …` | `services/ai` | 평가 실행(E1'·E2·E3·EX0. 시스템 id 표기는 B1 에서 확정) → `report.json`·`report.md` |
| `uv run python -m sol_eval.bosun_score --package <dir> --data test.en.jsonl --seeds 0-5 --out runs/e4-test` | `services/ai`(회사 GPU 서버 안, 회사 측 실행) | 오프라인 채점(E1'·E4) → `predictions.jsonl`·`rows.json`·`report.json`. B1 예정(2026-10-20 미구현) |
| `infra/gpu/bosun-f1.sh` → `python -m sol_decision.train --max_steps 20 …` | `services/decision`(회사 GPU, 회사 측 실행) | §5.2 F1 메모리 smoke → 결과 표. B1 예정(2026-10-20 미구현). 이전 `sol_eval.probe-train`·`infra/gpu/kev-f1.sh` 는 퇴역(파일은 보존) |
| `pnpm eval:publish <report.json>`(예정) | 루트 스크립트 | 요약을 `eval_runs` 에 저장. 웹은 `GET /api/v1/admin/ai/eval-runs` 로 읽기만([[05-API-SPEC\|05 API]]) |

## 7. 수용 기준 (해커톤 F0·B3~B5)

- 데이터셋 v0.1(B3): test 20·dev 10 사업, 원형 6개, manifest·라벨 검증 통과, 사업 단위 분할 누수 0건(클러스터 교차 검사, `sol_eval.leakage`).
- 평가: E0·E1'·E2·E3·EX0 리포트와 E1' 오류 분석(§4.4)이 `docs/evidence/eval/` 에 있다. 핵심 컷(ADR-023)은 축소판(§3.5) 기준이고, E1' 과 E3 의 차이는 점추정이 아니라 부트스트랩 95% 신뢰구간으로 판정한다. 효과가 확인되지 않으면 개선을 주장하지 않고 3안을 제안한다. 지표 표에서 채우지 못한 칸은 이유를 적는다. E1(Kev-9B)은 "퇴역·미측정" 으로 적는다.
- 재현성: 같은 데이터셋 버전·commit·seed 로 다시 돌리면 결정 모델 지표가 같다. Bosun `predict` 가 seed 고정에서 결정적이라는 가정이 틀리면 그 사실을 보고한다.
- 내보내기(B3): train 1,000 레코드(질문 단위) 이상, 번들 sha256 기록, Bosun 레코드가 `sol_eval.bosun_score --data` 로 읽힌다(B1 뒤 노트북에서 가짜 출력으로, 회사 측 실행에서 실제로 확인), 학습 요청서가 회사에 전달됐다. manifest 와 E4 리포트에 train 레코드 수 외에 **고유 사업 클러스터 수, 가상 기업 변형 수, 질문 수, 라벨 출처별 비율(`CONSTRUCTED`/`HUMAN`/`RULE_SILVER`), 의미 판단 `HUMAN` 라벨 수, 요구사항 유형별(기술·실적·인력·자격) 분포**를 적는다. 규칙 엔진이 이미 푸는 항목(`RULE_SILVER`)을 결정 모델이 배웠다는 것만으로 AI 성능 개선을 주장하지 않는다. 개선 주장은 `CONSTRUCTED`·`HUMAN` 라벨 test 에서의 Δ 로만 한다.
- 메모리 검증 스크립트(`infra/gpu/bosun-preflight.sh`·`infra/gpu/bosun-f1.sh`, B1 예정)와 절차([[22-FINETUNE-RUNBOOK|22]] §4.2 개정판)가 있다. 실행 결과는 회사 측 실행 뒤 `docs/evidence/bosun-train-feasibility.md` 에 남긴다. Kev 기록 `docs/evidence/kev-train-feasibility.md`(§0 서버 환경 2026-10-20 기록, F1 미실행)는 삭제·개서하지 않는다(ADR-034 11번).
- 파인튜닝(B4·B5): 회사 측 실행 결과를 받으면 `bosun-train-feasibility.md`·패키지 `manifest.json`·E4 리포트(E1' 대비 Δ·95% CI, seed 0~5)를 `docs/evidence/eval/e4-<일시>.md` 에 남긴다. 받지 못하면 받지 못한 단계와 이유를 리포트에 적는다. 결과 수치의 통과 기준은 없고, 데모 모델 교체를 뜻하지 않는다(ADR-034 9번).

## 8. 미확인

계획 §10 의 위험 목록과 같다. 회사 서버 사실은 사용자 보고라 B2 에서 교차 확인한다.

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| Bosun 0.6B 의 우리 도메인 zero-shot 품질(9B → 0.6B. DecisionBench 에서 가장 약한 가족 `rubric_scoring_prioritization` 0.707 이 우리 `score` 문항과 비슷) | 미측정 | B3 E1'. τ 재조정은 dev 로 |
| Bosun 의 한국어·장문 state 성능(DecisionBench state 는 14~18.9k 자) | 미측정 | E1' vs E2 |
| 6,000 토큰 state × 11+N 문항 순차 prefill 지연이 `KEV_TIMEOUT_MS` 5000 안인지(예상 1~3초, 미측정) | 미측정 | B2 C1 ③ G3 p95([[03-AI-PIPELINE\|03]] §5.9). 넘으면 ADR-033 E4 규칙대로 두 곳을 함께 바꾼다 |
| Bosun 공식 학습 코드 없음 — 우리 trainer 가 `render_decision_prompt`·slot 손실을 서빙과 같게 재현하는지 | 미검증 | 학습 전 `predict`·`decision_logits` 확률 동일성 테스트(seed 고정) |
| Bosun 추론의 결정성(같은 입력·같은 seed 에 같은 분포) | 가정 | §7 재실행 비교 |
| Bosun LoRA 학습·서빙 메모리(A40, 6,000 토큰 state) | 추정(학습 약 6~10 GB, 서빙 약 1.5~3 GB, 계획 §8) | F1 |
| GPU 1 공유: PaddleOCR 피크 메모리·지연 간섭 | 미확인 | B2 `nvidia-smi` 기록, 회사 점유 추이 요청. 보수적 메모리 설정 |
| 회사 서버 보고(PaddleOCR 약 9,167 MiB, `.venv-bosun`(`.venv-qwen` 은 중단·백업), CPU 2-step 성공, `datasets/decision/smoke.jsonl`) | 미검증(사용자 보고) | B2 `nvidia-smi`·`pip list` 기록으로 교차 |
| 회사 2-step 학습 코드가 저장소 밖 | 재현 불가 | 반입·리뷰 뒤 `services/decision/train.py` 로 흡수 |
| 리비전 `5e78a37c`(지시서·레지스트리 핀)와 Hanno `jev-compatible-server` 핀 `87cea31` 의 가중치 동일 여부 | 커밋 메시지 기준 문서 차이만 | B2 두 리비전 `manifest.json` sha256 대조 |
| 회사 vLLM API(`Qwen/Qwen3.5-27B`)의 guided JSON(`response_format: json_schema`)·`prompt_logprobs` 지원, 추출·번역 품질, 서빙 파라미터·리비전 | 미검증(회사 운영) | B2 G2·G4, B3 EX0·E3 |
| 학습 시간대(10-24~25)·외부망·출력 폴더 전송 | 미확인 | 회사에 요청([[16-DECISIONS\|16 ADR]] 미결정 22·24번) |
| 첨부 원문의 학습 사용 권리 | 미확인 | 법무 |

## 관련 문서

- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — 모델 출처·학습 환경·학습 데이터 제작·명령·반입(ADR-034 로 Bosun 기준 개정 예정)
- [[23-WEEKEND-FINETUNE|23 주말 파인튜닝 계획]] — B4·B5 일정, 중단선, 오프라인 채점
- [[03-AI-PIPELINE|03 AI 파이프라인]] — 결정 모델 질문 세트 `kev-qs/v0.2`, state·`stateTrace`, Bosun 사실(§5.1)·wire 타입 변환(§5.4)·레지스트리 검증(§11), §10 문서 파서 계약·실제 RFP 샘플 비교
- [[07-DATA-PIPELINE|07 수집 파이프라인]] — 실데이터 수집
- [[08-SCORING|08 점수]] — 판정 라벨·사유 코드, SOL Score 와 결정 모델
- [[11-TESTING|11 테스트]] — 시스템 시험·골든·증거
- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `CompanyEvidenceRef`, 인용 검증
- [[16-DECISIONS|16 ADR]] — ADR-034(결정 모델 Bosun, ADR-027 폐기), ADR-020, ADR-010, ADR-012, ADR-023, 미결정 22·24번
- [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) — ADR-034 분석, Bosun 사실·레코드 형식 §4·위험 §10
- [[12-ROADMAP|12 로드맵]] — 파인튜닝 트랙 일정
- [[10-DEPLOYMENT|10 배포]] — 회사 추론 엔드포인트 연결·`sol_decision` 결정 모델 런타임·회사 vLLM API
