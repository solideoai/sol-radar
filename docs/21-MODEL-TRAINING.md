---
title: "21. 모델 학습: 데이터셋·평가·파인튜닝"
doc: "21"
status: review
tags:
  - sol-radar
  - ai
  - evaluation
  - hackathon
updated: 2026-10-16
---

# 21. 모델 학습: 데이터셋·평가·파인튜닝

> [!tip] 심사 포인트
> "모델이 정말 쓸 만한가"를 숫자로 답하는 문서다. 실제 나라장터 공고와 가상 기업으로 평가셋을 만들고, 규칙만 쓴 경우와 Kev-9B(영어·한국어 입력)를 같은 지표로 비교한다. 파인튜닝은 지표가 목표에 못 미친다는 이유만으로 시작하지 않는다. 오류 분석에서 모델 자체의 판단 오류가 주된 원인으로 확인될 때만 회사 GPU 에서 LoRA 로 진행한다([[16-DECISIONS|ADR-020]]).

## 1. 범위

| 단계 | 내용 | 해커톤 |
|---|---|---|
| F0 | Kev-9B 베이스라인 추론, 한국어/영어 입력 비교, 평가셋 구축, 평가·비교 하네스, 학습셋 내보내기, LoRA 메모리 검증 스크립트 | **완료 조건** |
| F1 | 회사 GPU 에서 LoRA 메모리 검증 실행 | 회사 GPU 접근 시(완료 조건 아님) |
| F2 | Kev-9B LoRA 학습 | 후속. §4.4 판단 뒤에만 |
| F3 | 온도 보정·평가·반입·운영 모델 교체 | 후속. ADR |
| — | Qwen 파인튜닝 | 조건부(§5.6) |

모델 역할(Qwen = 추출·설명, Kev = 확률 분류, 규칙 = 명시 조건, SOL Score = 별도 산식)은 [[03-AI-PIPELINE|03 AI 파이프라인]] §1, 라벨 값과 사유 코드는 [[08-SCORING|08 점수]], Kev 질문 세트 `kev-qs/v0.2`와 state 는 03 §5 를 따른다. 실제 낙찰 결과는 학습 목표로 쓰지 않는다(승률 예측은 범위 밖, [[01-PRD|01 PRD]]).

## 2. 라벨

평가셋 라벨은 규칙 판정·Kev 질문과 같은 3값을 쓴다([[08-SCORING|08 점수]] 판정 라벨 절).

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
| train | 나머지 전부 | 해커톤에는 내보내기만. 학습 전 1,000 레코드 이상으로 늘린다 |

표본이 작아서 신뢰구간이 넓다. 해커톤 뒤 test 를 40 사업 이상으로 늘린 다음에 파인튜닝 착수(§4.4)를 판단하는 것이 바람직하다.

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

- **Kev JSONL**: `kev.train --data`·`kev.benchmark --data` 와 같은 형식이다. 한 줄에 `{"state": …, "questions": {qid: {"type","instructions","criteria","label","target"?}}}` 하나. state 는 서빙과 **같은 코드**(`services/ai/kev` 의 state 빌더)와 같은 템플릿 버전으로 만든다. `en`·`ko` 두 벌을 낸다.
- **Qwen SFT JSONL**(조건부 Qwen 파인튜닝용): 시스템 프롬프트 `req-extract/v0.1` + user 메시지 + gold JSON.
- **번들** `sol-dataset-{version}.tar`
  - `manifest.json`: 데이터셋 버전, git commit, 질문 세트·state 템플릿·라벨 스키마·마스킹 버전, 분할·라벨·출처별 개수, 파일별 sha256
  - 분할별 JSONL
  - `MODEL_TRAINING.md`(§5 절차)
- 빌더는 두 단계다. Node 스크립트(`pnpm dataset:build`, service role, seed 스크립트와 같은 지위)가 Supabase·MinIO 에서 `EvalItem` 을 만들고, Python(`services/ai`, DB 접근 없음)이 Kev·Qwen 형식으로 바꾼다.

## 4. 평가

### 4.1 하네스

- 위치: `services/ai/eval/`(Python, `uv run python -m sol_eval …`). 회사 GPU 서버에서 모델에 직접 붙거나 gateway URL 에 붙여 돌린다.
- 결과: `report.json`·`report.md`. 숫자 요약만 `docs/evidence/eval/` 에 둔다. 실제 RFP 원문은 증거 폴더에 넣지 않는다.
- Kev 지표는 `kev.benchmark --data` 를 감싸서 낸다(acc·nll·brier·ece·selective 등, 보정 전후). 체크포인트 비교는 `kev.compare --candidate --reference`(같은 데이터 해시끼리 짝지은 부트스트랩)로 한다.

> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev main `1f04cfa`)
> `kev/benchmark.py`(옵션 `--run|--remote`, `--suite|--data`, `--out`, `--split`, `--rotations`, `--date_facts`, 출력 `predictions.jsonl`·`rows.json`·`report.json`), `kev/metrics.py`(acc, nll, brier, ece, confident_error_rate, coverage_at_5pct_error, aurc, selective, score_mae, RPS), `kev/compare.py`(데이터 해시 일치 필요, nll·acc·brier 짝지은 부트스트랩)가 저장소에 있다.

### 4.2 비교 대상

| ID | 시스템 | 해커톤 |
|---|---|---|
| E0 | 규칙만(Kev 없음) | 필수 |
| E1 | Kev-9B@v1.0, `en` state | 필수 |
| E2 | Kev-9B@v1.0, `ko` state(`KEV_ALLOW_KO_STATE=true`, 평가 전용) | 필수 |
| E3 | Qwen3.5-9B 프롬프트 분류(같은 질문, 선택지 토큰 logprob 으로 분포) | 선택. "Kev 가 꼭 필요한가"를 판단하는 대조군 |
| E4 | Kev-9B + LoRA(`en`/`ko`) | 후속 |

### 4.3 지표

| 영역 | 지표 | 정의 |
|---|---|---|
| 파싱 | 형식별 파싱 성공률·품질 | [[03-AI-PIPELINE\|03 AI 파이프라인]] §10(실제 RFP 샘플 비교) |
| 추출 (Qwen) | 필드 state 정확도 | gold 와 `state` 일치 비율 |
| | 값 일치 | 스칼라는 정규화 정확 일치, 배열은 집합 F1 |
| | 필수 항목 재현율 | gold 의 `mandatory=true` 자격·실적·인력 중 찾아낸 비율(긴 공고문에서 놓치지 않는가) |
| | 인용 정확도 | 출력 인용 중 15 §5 검증(EXACT·NORMALIZED·FUZZY) 통과 비율. 가드 전 근거 없는 `KNOWN` 비율도 따로 |
| 분류 (규칙·Kev) | Accuracy, Macro-F1 | 3값 기준. 항목 종류(기술·실적·인력·자격)별로도 |
| | 정보부족-미충족 혼동률 | 정답 `NEEDS_REVIEW` → 예측 `NOT_SATISFIED`, 그리고 반대 방향. 둘을 따로 보고 |
| | 사유 코드 정확도 | `NEEDS_REVIEW` 정답 중 사유까지 맞힌 비율(규칙) |
| 보정 | Brier, ECE, NLL | 보정 전과 후 |
| | 선택적 정확도 | 확률 상위 구간만 골랐을 때의 정확도(coverage–risk) |
| 일관성 | 반복 일치 | 같은 요청 5회. Kev 는 분포 최대 편차, Qwen 추출은 필드 일치율 |
| | 선택지 순서 | `/v1/systemone/permute` `n_perm=6` 의 `argmax_stable` 비율과 `spread` |
| | 표현 변경 | state 줄 순서 섞기 + 용어집 동의어 치환 뒤 argmax 가 바뀐 비율 |
| 언어 | 한국어/영어 차이 | E1·E2 의 항목 id 짝 비교. ΔMacro-F1·ΔBrier·ΔECE 와 부트스트랩 95% 신뢰구간(하네스 자체 구현. `kev.compare` 는 같은 데이터 해시만 비교한다) |
| 성능 | 지연 | 요청당 p50·p95(Kev, Qwen 추출, 공고 1건 E2E) |
| | GPU 메모리 | 최대 점유(nvidia-smi 샘플링 또는 `torch.cuda.max_memory_allocated`) |
| | 처리량·비용 | 시간당 공고 수. 1,000건당 비용 = GPU 시간 단가(입력값) × 시간 |

모든 지표에 부트스트랩 95% 신뢰구간과 표본 수를 함께 적는다.

### 4.4 초기 목표 지표와 파인튜닝 착수 판단

**초기 목표 지표** (test 분할, Kev 담당 항목)
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
| `MODEL` | 위가 모두 정상인데 Kev 의 판단이 틀렸다 | 파인튜닝 후보 |

절차:
1. test·dev 의 오답 항목마다 `stateTrace`(03 §5)와 단계별 중간 산출물을 따라가서 원인 코드 하나를 붙인다. 결과는 `error-analysis.jsonl`(`itemId`, `qid`, 정답, 예측, 원인 코드, 근거 메모, 분석자)에 남긴다.
2. 리포트에 원인 코드별 건수·비율과 대표 사례를 적는다.
3. `MODEL` 이 아닌 원인을 먼저 고치고 다시 평가한다.
4. 아래가 모두 해당할 때 LoRA 를 진행한다.
   - 다시 평가해도 목표 지표에 미달한다.
   - 남은 오류에서 `MODEL` 이 가장 큰 비중이다(제안: 절반 이상).
   - 그 오류 유형을 학습 데이터로 보완할 수 있다.
5. 결정은 사람이 하고 ADR 로 남긴다.

목표 미달은 점추정이 아니라 신뢰구간으로 판단한다. 신뢰구간이 목표를 걸치면 "판단 보류" 로 두고, 사례별 오류 분석을 함께 낸다. SOL Score 에 Kev 를 반영할지([[08-SCORING|08 점수]])도 같은 지표와 오류 분석으로 따로 판단한다.

### 4.5 베이스라인 수용 기준 (해커톤)

- E0·E1·E2 리포트가 test 분할로 나온다. 지표 표를 채우고, 채우지 못한 칸은 이유를 적는다.
- 같은 데이터셋 버전·commit 으로 다시 돌리면 Kev 지표가 같다. Kev 추론이 결정적이라는 가정이 틀리면 그 사실을 보고한다.
- 오류 분석(§4.4)을 E1 에 대해 한 번 수행한다.

## 5. 파인튜닝 (후속, 회사 GPU)

### 5.1 검증된 도구

> [!success] 검증됨 (2026-10-16, https://github.com/jaredpalmer/kev main `1f04cfa`, https://huggingface.co/jaredpalmer/kev-9b)
> - `python -m kev.train`: LoRA 기본(`--lora 16`, `--lora_targets all|dense|attn|qv`), full FT `--full_ft 1`. **QLoRA·bitsandbytes 는 없다.**
> - `--init_from`: 로컬 폴더나 Hub id(`@tag`)에서 LoRA 와 pointer head 를 이어서 학습한다. 기동 전에 `base`·`base_revision`·`lora`·`head_dim`·`option_isolation`·`special_embeddings`·`weights` 가 체크포인트와 같은지 검사한다(`kev/checkpoint.py` `COMPAT_FIELDS`). `--base` 기본값이 `Qwen/Qwen3-0.6B-Base` 라서 9B 는 `--base Qwen/Qwen3.5-9B-Base` 를 **반드시** 준다.
> - `jaredpalmer/kev-9b@v1.0` = `db029f08`(저장소 `docs/releases/kev-1.0.md` 기준 Kev-9B v2). `@v1` 은 더 예전 버전이다.
> - 공식 9B 학습 설정: `lora 16`, `head_dim 256`, `max_state 7552`, `batch 2`, `accum 4`, `dtype bf16`, `weights_dtype fp32`. H200 1장, 2.6시간, 최대 74.1 GB.
> - 학습 데이터: JSONL, choice 는 선택지 이름, noul 은 `true`/`false`, score 는 0부터 세는 등급 번호. `target` 으로 소프트 라벨.
> - 보정: `scripts/calibrate_checkpoint.py` 가 온도를 `head.pt` 에 쓴다. 학습 분포와 같은 행은 거부한다.
> - CPU 오프로딩은 full FT optimizer(`kev/full_ft.py`)에만 있고 LoRA 경로에는 없다.
> - 모델 카드 `language: en`. README 는 다른 언어에 짧은 미세조정이 도움이 된다고만 적었다(절차·수치 없음).

### 5.2 보유 GPU 에서의 LoRA 메모리 검증 (F1)

80 GB 를 전제하지 않는다. 회사 GPU 에서 `--max_steps 20` 짧은 실행을 아래 격자로 돌리고 최대 메모리, step 시간, OOM 여부를 `docs/evidence/kev-train-feasibility.md` 에 표로 남긴다.

`--init_from jaredpalmer/kev-9b@v1.0` 이면 `--base Qwen/Qwen3.5-9B-Base`, `--lora 16`, `--head_dim 256` 은 고정이다. 조절하는 값:

| 순서 | 조절 | 기대 효과 |
|---|---|---|
| 1 | `--weights_dtype bf16` | 고정 backbone 이 fp32 약 36 GB → bf16 약 18 GB(추정). `weights_dtype` 은 호환 검사 대상이 아니라 `--init_from` 과 함께 쓸 수 있다 |
| 2 | `--dtype bf16` | autocast forward(CUDA 전용) |
| 3 | `--checkpointing 1` | 활성값 메모리 감소, 속도 저하 |
| 4 | `--batch 1 --accum 8` | micro-batch 최소화, 유효 배치 유지 |
| 5 | `--max_state` 1024 → 2048 → 4096 → 7552 | 시퀀스가 길수록 활성값 증가. 운영 state 상한은 6,000 토큰 |
| 6 | `--row_budget N` | 한 pass 의 패딩 토큰 상한 |

격자 끝에서도 OOM 이면 아래 순서로 검토하고 사용자에게 보고한다.
1. state 축약(질문을 나눠 state 를 줄인다)
2. `--init_from` 없이 새 LoRA(`--lora_targets attn|qv`, 낮은 rank). 공개 Kev 의 학습 성과를 잃으므로 E1 과 비교한다
3. Kev-4B(`--init_from jaredpalmer/kev-4b@v1.0`, `--base Qwen/Qwen3.5-4B-Base`)
4. 클라우드 GPU 임대(비용, 사용자 승인. [[16-DECISIONS|ADR-010]])
5. Kev 소스를 고쳐 오프로딩·QLoRA 추가(포크 유지보수 부담, 마지막 수단)

### 5.3 학습 명령 (F2 예시, F1 결과로 값 확정)

```bash
uv run python -m kev.train \
  --base Qwen/Qwen3.5-9B-Base \
  --init_from jaredpalmer/kev-9b@v1.0 \
  --data train.en.jsonl \
  --lr 2e-5 --epochs 2 \
  --weights_dtype bf16 --dtype bf16 --checkpointing 1 \
  --batch 1 --accum 8 --max_state 4096 \
  --perm_kl 0.1 \
  --out runs/kev-9b-sol-v0.1 --seed 0
```

- `--perm_kl` 은 선택지 순서 불변성 손실이다. 일관성 지표가 나쁠 때 켠다.
- 공개 레시피의 suite 를 쓸 수 있으면 `--replay N` 으로 일반 능력이 잊히는 것을 막는다(가용성 미확인).
- 보정은 dev 분할로 한다. dev 는 학습에서 빠져 있어야 한다.

### 5.4 반입과 모델 레지스트리

- 회사 GPU 에서 돌려받는 것: 체크포인트 폴더(어댑터 + `head.pt` + `training_config.json`), `kev.benchmark` 리포트, `sol_eval` 리포트, `MODEL_CARD.md`(데이터셋 버전·commit·하이퍼파라미터·지표). 데이터셋 원문은 돌려받지 않는다.
- 레지스트리: `services/ai/models/registry.yaml`(git 관리, 가중치 제외).
  - 항목 필드: `id`(예: `kev-9b-sol-lora-v0.1`), `run`(로컬 경로 또는 비공개 Hub `repo@rev`), `base`, `base_revision`, `init_from`, `lora`, `weights_sha256`, `head_sha256`, `temperature`, `dataset`(버전·sha256), `questionSet`, `stateTemplate`, `reports`
  - 공개 모델도 항목으로 둔다(예: `kev-9b-v1.0` → `jaredpalmer/kev-9b@v1.0`).
- 서빙 검증은 [[03-AI-PIPELINE|03 AI 파이프라인]] §11·[[10-DEPLOYMENT|10 배포]]를 따른다. Kev 컨테이너가 기동 전에 sha256 을 대조하고, gateway 는 `GET /v1/models` 의 `run`·`base`·`lora`·`temperature` 가 레지스트리와 다르면 기동을 거부한다. `kev.serve` 는 경로가 틀리면 오류 없이 `runs/smoke` 로 대체하기 때문이다.
- 호환성: 학습셋 state 와 서빙 state 를 같은 코드·같은 템플릿 버전으로 만든다. 레지스트리의 `questionSet`·`stateTemplate` 이 gateway 설정과 다르면 기동을 거부한다.
- 운영 모델 교체는 ADR 로 정한다. 기존 `score_runs` 는 덮어쓰지 않는다.

### 5.5 실행 위치와 데이터 경계

- 평가 하네스와 F1·F2 는 회사 GPU 서버에서 돌린다(해커톤 실추론과 같은 서버, [[10-DEPLOYMENT|10 배포]]).
- 회사 GPU 로 가는 데이터는 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 회사 프로필뿐이다.
- 첨부 원문의 저작권·재배포 조건은 미확인이다. 내부 분석과 사내 학습에만 쓰고, 외부 공개·배포 전에 법무를 확인한다.

### 5.6 Qwen 파인튜닝 (조건부)

추출 지표(§4.3 추출 행)가 목표에 못 미치고 오류 분석에서 `EXTRACTION` 원인이 주된 것일 때만 검토한다. 목표치는 베이스라인을 본 뒤 사용자가 정한다. 이미 내보낸 Qwen SFT JSONL 을 쓰고, 학습 도구는 그때 정한다(Kev 도구는 생성 모델 학습용이 아니다).

## 6. 운영자 CLI

| 명령 | 위치 | 하는 일 |
|---|---|---|
| `pnpm dataset:build --version sol-eval/v0.1` | 루트 스크립트(service role) | live 공고·추출·가상 기업 → `EvalItem` + 분할 + 마스킹 → MinIO |
| `uv run python -m sol_eval.export --version … --out sol-dataset-v0.1.tar` | `services/ai` | `EvalItem` → Kev JSONL(en·ko)·Qwen SFT JSONL·manifest |
| `uv run python -m sol_eval.labels check <file>` | `services/ai` | 사람 라벨 파일 검증 |
| `uv run python -m sol_eval.run --system E1 --split test --kev-url … --gateway-url …` | `services/ai` | 평가 실행 → `report.json`·`report.md` |
| `uv run python -m sol_eval.probe-train …` | `services/ai`(회사 GPU) | §5.2 메모리 격자 실행 → 결과 표 |
| `pnpm eval:publish <report.json>` | 루트 스크립트 | 요약을 `eval_runs` 에 저장. 웹은 `GET /api/v1/admin/ai/eval-runs` 로 읽기만([[05-API-SPEC\|05 API]]) |

## 7. 수용 기준 (해커톤 F0)

- 데이터셋 v0.1: test 20·dev 10 사업, 원형 6개, manifest·라벨 검증 통과, 사업 단위 분할 누수 0건(클러스터 교차 검사).
- 평가: E0·E1·E2 리포트와 E1 오류 분석이 `docs/evidence/eval/` 에 있다.
- 내보내기: 번들 sha256 기록, Kev JSONL 이 `kev.benchmark --data` 로 읽힌다(회사 GPU 에서 확인).
- 메모리 검증 스크립트와 절차가 있다. 실행 결과는 회사 GPU 접근 뒤 `docs/evidence/kev-train-feasibility.md` 에 남긴다.

## 8. 미확인

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| Kev 의 한국어 성능 | 미측정 | E2 |
| Kev-9B 추론 메모리(모델 카드 21.9 GB vs README 약 17 GB) | 문서 불일치 | 회사 GPU 첫 기동에서 실측 |
| bf16 backbone 의 LoRA 메모리 절감 효과 | 추정 | §5.2 |
| 공개 레시피 suite 의 `--replay` 사용 가능 여부 | 미확인 | F1 |
| Kev 추론의 결정성(같은 입력 같은 분포) | 가정 | §4.5 재실행 비교 |
| 첨부 원문의 학습 사용 권리 | 미확인 | 법무 |

## 관련 문서

- [[03-AI-PIPELINE|03 AI 파이프라인]] — Kev 질문 세트 `kev-qs/v0.2`, state·`stateTrace`, 레지스트리 검증
- [[07-DATA-PIPELINE|07 수집 파이프라인]] — 실데이터 수집
- [[03-AI-PIPELINE|03 AI 파이프라인]] §10 — 문서 파서 계약·실제 RFP 샘플 비교
- [[08-SCORING|08 점수]] — 판정 라벨·사유 코드, SOL Score 와 Kev
- [[11-TESTING|11 테스트]] — 시스템 시험·골든·증거
- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `CompanyEvidenceRef`, 인용 검증
- [[16-DECISIONS|16 ADR]] — ADR-020, ADR-010, ADR-012
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 서버·터널·Kev 컨테이너
