---
title: "21. 모델 학습: 데이터셋·평가·파인튜닝"
doc: "21"
status: review
tags:
  - sol-radar
  - ai
  - evaluation
  - hackathon
updated: 2026-11-02
---

# 21. 모델 학습: 데이터셋·평가·파인튜닝

> [!tip] 심사 포인트
> "모델이 정말 쓸 만한가"를 숫자로 답하는 문서다. 실제 나라장터 공고와 가상 기업으로 평가셋을 만들고, 규칙만 쓴 경우와 결정 모델 Bosun v3.1 0.6B(영어·한국어 입력)를 같은 지표로 비교한다. 파인튜닝은 지표가 목표에 못 미친다는 이유만으로 시작하지 않는다. 오류 분석에서 모델 자체의 판단 오류가 주된 원인으로 확인될 때만 회사 GPU 에서 LoRA 로 진행한다([[16-DECISIONS|ADR-020]]). Bosun v3.1 0.6B LoRA 비교 실험(E4)은 발표(11-05) 뒤 진행 예정이다(X6, [[16-DECISIONS|ADR-067]]). 날짜는 정하지 않았다(일정은 [[12-ROADMAP|12 로드맵]] "해커톤 이후" 컷, 사용자 확인). 데모 모델은 공개 Bosun v3.1 0.6B 그대로이고, 운영 반영은 위 판단을 그대로 따른다([[16-DECISIONS|ADR-034]]).
>
> 이 문서는 무엇을 왜 학습하는지 정한다. 모델을 어디서 받고, 회사 GPU 에서 어떤 명령으로 학습·보정·병합·반입하는지는 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]에 있다.

## 1. 범위

| 단계 | 내용 | 상태 |
|---|---|---|
| F0 | 결정 모델(공개 Bosun v3.1 0.6B) 베이스라인 추론 E1', 한국어/영어 입력 비교, 평가셋 구축, 평가·비교 하네스, 학습셋 내보내기(Bosun 질문 단위 레코드), LoRA 메모리 검증 스크립트 | 하네스의 Bosun 부분(`python -m sol_eval` 의 `export --format bosun`·`bosun_score`·`leakage`·`compare`)은 main 에 있다. 실측 리포트는 없다(`docs/evidence/eval/` 에 smoke 3건뿐) |
| F1 | 회사 GPU 에서 Bosun LoRA 메모리 검증 실행(GPU 서버 셸이 필요해 회사 측 실행, [[16-DECISIONS\|ADR-025]]). 물리 GPU 1(NVIDIA A40 46,068 MiB) 한 장만 쓴다. 회사 PaddleOCR 공유 전제는 ADR-066 으로 지웠다(우리는 PaddleOCR 을 쓰지 않는다. 회사 컨테이너는 건드리지 않고 학습 전 메모리를 확인한다). 서버의 torch 2.8.0+cu128·CUDA·bf16 은 `.venv-kev` 에서 확인했다. Bosun 용 `.venv-bosun` 은 사용자 보고이고 회사 확인 전이다. 결정 서버 `sol_decision.serve` 는 회사 호스트 `127.0.0.1:8009` 에서 공개 Bosun 을 서빙 중이다([[10-DEPLOYMENT\|10]] "회사 GPU 추론 엔드포인트"). GPU 에서의 Bosun 학습은 미실행([[22-FINETUNE-RUNBOOK\|22]] §3.1) | 발표 뒤 진행 예정(X6, [[16-DECISIONS\|ADR-067]]). 회사 실행 기록 없음. 학습 가능 여부는 F1 결과로만 확정한다 |
| F2 | Bosun v3.1 0.6B LoRA 이어 학습(`en`. 공개 LoRA 392 텐서만, decision 임베딩 동결) | 발표 뒤 진행 예정(X6, [[16-DECISIONS\|ADR-067]]). 비교 실험이라 §4.4 착수 조건을 기다리지 않는다(ADR-034) |
| F3 | 온도 보정·평가·반입·운영 모델 교체 | 발표 뒤 진행 예정(X6, [[16-DECISIONS\|ADR-067]]). 보정·E4 평가(E1' 대비)까지 한다. 반입·운영 모델 교체는 §4.4 판단·사용자 승인·ADR 을 거친다(ADR-034 9번) |
| — | Qwen 파인튜닝 | **하지 않는다**(2026-10-20 사용자 결정, §5.6). 추출·설명 모델은 회사가 운영하는 vLLM API 의 `Qwen3.8-Flash-Next-AWQ-INT4` 다 |

모델 역할(Qwen3.8-Flash-Next(회사 vLLM API) = 추출·설명, Bosun v3.1 0.6B = typed decision 확률 분류, 규칙 = 명시 조건, SOL Score = 별도 산식)은 [[03-AI-PIPELINE|03 AI 파이프라인]] §1, 라벨 값과 사유 코드는 [[08-SCORING|08 점수]], 결정 모델 질문 세트 `kev-qs/v0.2`(이름은 호환 유지, ADR-034)와 state 는 03 §5 를 따른다. 실제 낙찰 결과는 학습 목표로 쓰지 않는다(승률 예측은 범위 밖, [[01-PRD|01 PRD]]).

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
| 공고·RFP | `live` 모드로 수집한 실제 공고(`is_demo=false`, 정보화사업, 첨부 파싱 성공) | Supabase + Supabase Storage. 저장소에는 넣지 않는다 |
| 가상 기업 | 직접 설계한 원형 6개와 항목별 변형 | `fixtures/eval/companies/*.json`(가상이라 커밋) |
| 라벨 | 구성 라벨(`CONSTRUCTED`) + 사람 라벨(`HUMAN`) + 규칙 실버 라벨(`RULE_SILVER`) | 데이터셋 번들(Supabase Storage). 사람 라벨 원본은 `datasets/labels/`(gitignore) |
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
2. 사람이 JSONL 라벨 파일을 검수한다. `python -m sol_eval labels check` 가 형식·값 집합·근거 존재를 검사한다.
3. 추출 정답(gold `RequirementExtraction`)도 같은 방식이다. 인용은 인용 검증기([[15-DATA-CONTRACTS|15 데이터 계약]] §5)를 통과해야 한다.
4. 사람 라벨에는 라벨러 id·시각·도구 버전을 남긴다. test 의 10% 는 두 번째 사람이 다시 라벨링해 Cohen κ 를 잰다. 두 번째 사람이 없으면 이 지표가 빠졌다고 리포트에 적는다.
5. 초안 출처를 `draftedBy`(`RULE`·`QWEN`·`CLAUDE`·`NONE`)로 남긴다. 사람이 검수해 확정한 것만 `labelSource=HUMAN` 이다. Qwen 초안에서 시작한 gold 는 정답이 초안에 끌려갈 수 있다. 그래서 test 추출 gold 중 5건 이상은 초안 없이(`draftedBy=NONE`) 만들고, 이 묶음과 나머지의 Qwen 점수 차이를 함께 보고한다.

### 3.5 규모 (해커톤, 사용자 결정 2026-10-16)

| 분할 | 사업 수 | 사람 작업(추정) |
|---|---:|---|
| test | 20 | 추출 정답 20건(약 7~13시간), 의미 대응 라벨 150건 이상(약 3시간). 항목 라벨은 사업당 원형 4개 × 항목 약 8개(약 640건)로 대부분 구성 라벨이다 |
| dev | 10 | 임계값 τ·온도 보정용 |
| train | 나머지 전부 | X6 에서 1,000 레코드(질문 단위) 이상으로 내보내 F2 에 쓴다(ADR-034). test·dev 클러스터는 뺀다. 질문별 라벨 출처는 [[22-FINETUNE-RUNBOOK\|22]] §4.1 |
| **축소판**(ADR-023 X1) | fixture 20건 + 실제 공고 5건 | E0·E1'·E2·E3 비교와 E1' 오류 분석에 쓴다(발표 뒤 진행 예정, [[16-DECISIONS\|ADR-067]]). fixture 라벨은 [[07-DATA-PIPELINE\|07]] §6.2 기대 결과(mock 결정 모델 값은 정답이 아니다), 실공고 5건은 사람 라벨. 리포트는 아직 없다. 위 test 20·dev 10 은 X6 에서 만든다 |

표본이 작아서 신뢰구간이 넓다. X6 의 E4 는 test 20 으로 하는 비교 실험이다. 운영 반영(§4.4)은 test 를 40 사업 이상으로 늘린 다음에 판단하는 것이 바람직하다.

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

- **Bosun 질문 단위 레코드** `bosun/{split}.en.jsonl`(ADR-034, [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §4.2): Bosun 은 질문 하나당 forward 1회라 한 줄이 **질문 하나**다. `EvalItem`·`Label` 필드를 보존하고 `questionType`·`candidates`(03 §5.4 타입 변환 표)·`gold`(one-hot 또는 `Label.target` soft)를 더한다. state 는 서빙과 **같은 코드**(`sol_ai.kev_state_v02.build_state_v02`, `sol_eval/state.py` 가 부른다)와 같은 템플릿 버전(`en.v0.2`, `services/ai/kev/state-templates/`)으로 만들고, `instructions` 는 `services/ai/kev/question-sets/v0.2.json` 원문 그대로다([[16-DECISIONS|ADR-033]] E10). 학습·E1'·E4 는 `en` 만 쓴다. `export --format bosun` 은 `en` 만 쓴다. `ko` state 파일을 내는 것은 퇴역한 Kev 형식(`kev/{split}.ko.jsonl`)뿐이다. E2 는 이 Bosun 레코드 형식을 그대로 쓰고 state 만 한국어로 바꿔 오프라인 `bosun_score` 로 E1' 과 짝 비교한다([[16-DECISIONS|16]] 미결정 29-1·29-6). 파일은 같은 폴더의 `bosun/{split}.ko.jsonl` 이고(번들 `manifest.json` 에 언어를 기록한다), 레코드 최상위에 `language: "ko"` 를 더한다(없으면 `en`). `rowId`·질문 세트·후보·gold 는 `en` 과 같다. 지금 `compare` 는 두 run 의 데이터 sha256 이 같아야 해 E1'↔E2 를 거부한다. `export --format bosun` 은 `en` 만 내므로 언어 짝 비교(같은 `rowId`, 다른 데이터 파일) 코드는 없다. state 는 `services/ai/kev/state-templates/ko.v0.2.txt` 로 렌더한다. 결정 서버(8009)를 거치지 않으므로 운영 입력이 영어 state 만인 규칙(03)은 그대로다.
- **Qwen SFT JSONL**: 내보내지 않는다. Qwen 파인튜닝은 하지 않는다(2026-10-20 사용자 결정, §5.6). 추출 gold(`EvalItem.extraction`)는 EX0 측정에만 쓴다.
- **번들** `sol-dataset-{version}/` 폴더(그대로 보내고 `manifest.json` 의 파일별 sha256 으로 대조한다. tar 로 묶지 않는다, [[16-DECISIONS|16]] 미결정 29-3)
  - `manifest.json`: 데이터셋 버전, git commit, 질문 세트·state 템플릿·라벨 스키마·마스킹 버전, 분할·라벨·출처별 개수, 파일별 sha256, train∩(dev∪test) 클러스터 0건 확인, 질문별·선택지별 분포(각 ≥ 5%)
  - `bosun/{split}.en.jsonl`(`kev/` 디렉터리는 만들지 않는다)
  - `MODEL_TRAINING.md`(§5 절차)
- 빌더는 두 단계다. Node 스크립트(`pnpm dataset:build`(예정), service role, seed 스크립트와 같은 지위)가 Supabase·Supabase Storage 에서 `EvalItem` 을 만들고, Python(`services/ai`, DB 접근 없음)이 Bosun 레코드로 바꾼다(`python -m sol_eval export --format bosun`). Node 빌더는 아직 없다. 지금 `EvalItem` 은 `sol_eval build`(갈래 ①)가 녹음 구조화 필드 × 가상 기업 변형으로 만든다. `sol_eval` 은 DB 를 읽지 않는다.

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

### 3.8 데이터 출처와 레코드 구성

학습셋·평가셋의 출처와 질문 단위 레코드 구성이다. 레코드 형식과 번들은 §3.7, 라벨 규칙은 [[22-FINETUNE-RUNBOOK|22]] §4.1 이다.

원칙:
1. **공개·무료·이용 조건이 확인된 출처만** 쓴다. 필요한 것은 data.go.kr 서비스키 4개(보유, ADR-022)뿐이다.
2. 라벨은 구성(`CONSTRUCTED`)·규칙(`RULE_SILVER`)·사람(`HUMAN`)으로만 만든다. 유료 외부 모델 라벨은 없다.
3. 첨부(RFP) 원문은 번들에 **원문 전체로 넣지 않는다**. state 에는 추출값·인용 구절만 들어간다. 저작권·학습 사용 권리는 미확인이라(16 미결정 18) 회사 내부 학습에만 쓰고 Hugging Face 에 올리지 않는다.
4. 낙찰·개찰 결과는 수집도 라벨로도 쓰지 않는다(승률 예측 범위 밖, [[01-PRD|01]]).

| 층 | 출처 | 무엇을 쓰나 | 이용 조건 | 양·한도 | 상태 |
|---|---|---|---|---|---|
| **A1** | 나라장터 입찰공고정보서비스 `15129394`(data.go.kr) — `getBidPblancListInfoServc`(목록)·`…ChgHstryServc`(변경이력)·`…LicenseLimit`(면허제한)·`…PrtcptPsblRgn`(참가가능지역)·`…EorderAtchFileInfo`(e발주 첨부) | 공고 메타·예산·마감·**면허제한·참가지역**(구조화 자격 필드) | 이용허락범위 제한 없음(`infra/sources/registry.yaml` `redistributionLimit`). 개발계정 **1,000건/일/서비스**, `numOfRows` 최대 999 | 7일 용역 공고 3,555건 표본에서 정보화사업(`infoBizYn='Y'`)은 약 6% | 서비스키 있음, 실호출 통과 |
| A2 | 업종 및 근거법규 `15129467` | 업종 코드·근거 법규 전체 2,916행 → 자격 사전, `RULE_SILVER` 라벨 근거 | 같음 | 3페이지(999×3) 녹음본 `fixtures/recorded/15129467/` | 받아 둠 |
| A3 | 사전규격 `15129437`·발주계획 `15129462` | 단계 연결 | 같음 | — | 학습에 쓰지 않는다 |
| A4 | g2b 첨부(`https://www.g2b.go.kr`, 익명 GET) | 공고문·제안요청서 HWPX·PDF → 파싱 텍스트 → 회사 Qwen API 추출(갈래 ②) | 다운로드는 로그인 없이 200. 이용약관·저작권 미확인(미결정 16·18) → 내부 학습만 | 공고당 1~3건 | gateway `/parse` 구현([[03-AI-PIPELINE\|03]] §10). 회사 gateway 에 파서 3종이 들어갔고 Documents Worker 가 운영 중이다([기록](evidence/attachment-pipeline/20261028-documents-worker.md)) |
| **C** | 가상 기업 원형 6개(`fixtures/eval/companies/*.json`, §3.2) + 항목별 변형(§3.3) | 회사 쪽 state 와 라벨 | 우리가 만든 가상 데이터(실제 회사 이름·실적 없음) | 원형 6 × 변형 3~4 | 원형 6개 JSON 있음 |
| 참고 | 솔리데오 가상 프로필 `fixtures/company/solideo-profile.json`([[08-SCORING\|08]] §6.1) | 원형 2(중견 공공 SI)의 출발점 | 가상 | 1 | 있음 |

검토했으나 **쓰지 않는** 오픈 데이터:

| 후보 | 이유 |
|---|---|
| AI Hub(aihub.or.kr) 공공 행정문서·기계독해 데이터 | 이용 신청·약관 절차가 있고, 입찰 공고·RFP 도메인 데이터는 검색에서 확인하지 못했다 |
| Hugging Face 공개 한국어 데이터셋(KLUE·KorQuAD 등) | 조달 도메인이 아니고, Bosun 입력은 영어 템플릿 state 라 쓸 자리가 없다. 나라장터 공고를 모은 공개 HF 데이터셋은 찾지 못했다 |
| DecisionBench(Bosun 공개 학습·평가 데이터) | 도메인이 다르고 state 가 14~18.9k 자다. 회귀 기본 세트가 아니다. 라이선스·중복·재배포 조건 확인 뒤 보조 평가로만 쓴다(`bosun_score --suite … --suite-format decisionbench`, 실행은 별도 승인, ADR-034 9번) |
| EU TED(Tenders Electronic Daily) XML | 재사용 조건 페이지를 확인하지 못했고, 한국 조달 자격 체계와 달라 라벨 구성이 맞지 않는다 |
| 조달정보개방포털(data.g2b.go.kr) 대용량 파일 | 이용허락·다운로드 한도를 확인하지 못했다. A1 API 로 같은 공고를 받을 수 있어 필요 없다 |
| 낙찰·개찰·계약 데이터 | 범위 밖(위 원칙 4) |

**질문 하나 = 레코드 하나**다(§3.7). 질문 문구는 `services/ai/kev/question-sets/v0.2.json` 원문(확정, [[16-DECISIONS|ADR-033]] E10), state 는 `services/ai/kev/state-templates/en.v0.2.txt` 와 **서빙과 같은 빌더**로 만든다. 레코드마다 `qid`·`questionType`·`instructions`·`candidates`(타입별 변환 표 [[22-FINETUNE-RUNBOOK|22]] §4.1)·`state`·`stateHash`·`gold`·`labelSource`·`reason`·증거를 둔다. Bosun 은 state 를 자르지 않으므로(`truncation=False`, ctx 40,960) state 토큰 수는 manifest 기록용이다. 레코드는 두 갈래 중 하나로 만들고, 어느 갈래인지 manifest 와 E4 리포트에 적는다.

**갈래 ① 구조화 필드만(엔드포인트·파서 없이 된다)**

| 구성 | 값 |
|---|---|
| NOTICE 블록 | A1 목록·보조 조회 필드: 단계·기관(종류만)·예산·마감·계약 방법·**면허제한 행**(A2 업종 코드로 정규화)·참가가능지역·첨부 유무 |
| 추출 필드(`requiredSkills`·`pastPerformance`·`staffing` 본문 요구) | `UNKNOWN`(추출 안 함). "첨부를 읽지 못했다" 한 줄([[17-CLAUDE-IMPLEMENTATION\|17]] 절대 규칙) |
| COMPANY 블록 | 원형 6개 × 변형: 보유 면허(`HELD`/`NOT_HELD`/증빙 삭제), 수행 상한, 가용 FTE, 지역 |
| 질문·라벨 | `req.qualifications[*].status`(면허제한 ↔ 보유 면허: `SATISFIED`/`NOT_SATISFIED`/`NEEDS_REVIEW`, 구성 라벨), `risk.scale`(예산 vs 수행 상한, 규칙), `risk.schedule`(마감 vs 오늘, 규칙), `risk.staffing`(가용 FTE, 구성). 면허제한이 여러 행이면 `NEEDS_REVIEW`(`AMBIGUOUS_MATCH`, 미결정 19) |
| 규모 | 300 공고 × 원형 5(1개 홀드아웃) × 변형 3 × 질문 수 → 질문 레코드 수천 행 → **train ≥ 1,000행** 으로 샘플링. 선택지마다 정답 비율 5% 이상, 세 값이 1/3 에 가깝게 |
| state 길이 | 약 500~1,200 토큰(참고. Bosun 은 자르지 않는다) |

이 갈래가 가르치는 것은 "구조화 자격 필드와 회사 보유 상태를 보고 세 값을 가르는 것"과 "정보가 없으면 `NEEDS_REVIEW`" 다. 규칙이 이미 계산하는 항목이지만, 결정 모델은 참고 지표라 규칙과 **같은 방향**으로 보수적으로 답하게 만드는 것이 목적이다([[03-AI-PIPELINE|03]] §5.5).

**갈래 ② 추출 포함(회사 Qwen API 와 `/parse` PDF·HWPX 가 동작할 때만)**

- 갈래 ① 위에 A4 첨부 → `/parse` → `/extract`(회사 Qwen API, train 은 silver: 스키마·인용 검증 통과분만)를 더해 `req.requiredSkills[*].status`·`req.pastPerformance[*].status`·`risk.techGap` 을 구성 라벨로 더한다([[22-FINETUNE-RUNBOOK|22]] §4.1 표).
- Qwen 호출은 공고당 1회, 300건 ≤ 300회. 지연·호출 한도는 회사 확인 뒤 계산한다.
- state 길이 최대 6,000 토큰([[03-AI-PIPELINE|03]] §5.6). Bosun 에는 들어가고, 메모리·step 시간은 F1 에서 긴 레코드로 잰다.

**dev·test**: test 20·dev 10 사업(사람 라벨, 사용자 직접)을 쓴다. test 라벨이 끝나지 않으면 축소판(fixture 20건 + 실공고 5건, ADR-023 X1, §3.5)을 test 로 쓰고 그 사실을 리포트 첫 줄에 적는다. 어느 쪽이든 train 과 사업 클러스터가 겹치지 않는다.

## 4. 평가

### 4.1 하네스

- 위치: `services/ai/eval/`(Python, `uv run python -m sol_eval …`). 노트북에서 회사 추론 엔드포인트에 붙여 돌린다([[16-DECISIONS|ADR-025]]): 결정 모델은 `KEV_BASE_URL`(`sol_decision.serve`, Kev wire 호환) 직접 또는 평가용 gateway URL(공개 경로 `/sol-radar/kev`는 회사 nginx에 등록되지 않아 노트북에서 닿지 않는다. 결정 서버는 회사 호스트 `http://127.0.0.1:8009` 에서 서빙 중이고 운영 gateway 가 루프백으로 붙는다, [[10-DEPLOYMENT|10]] "회사 GPU 추론 엔드포인트"), Qwen 은 회사가 운영하는 vLLM API(`QWEN_BASE_URL=https://acropolissg.com/vllm/v1`, 모델 `Qwen3.8-Flash-Next-AWQ-INT4`). E4·E1'(와 언어 짝 비교용 E2)는 엔드포인트에 붙지 않는다([[16-DECISIONS|16]] 미결정 29-1). 회사가 서버 안에서 `python -m sol_eval bosun_score --package <dir> --data "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl" --seeds 0-5 --out "$SOL_WORK/runs/e4-test"`(경로는 절대 경로)로 채점한 출력 폴더(`predictions.jsonl`·`rows.json`·`report.json`)를 받아 `sol_eval` 이 오프라인으로 지표를 내고, 실행 전에 `report.json` 의 패키지 `manifest.json` sha256·test 파일 sha256 을 번들 manifest 와 대조한다([[16-DECISIONS|ADR-034]] 7번, [[22-FINETUNE-RUNBOOK|22]] §4.4). 요청당 지연은 E4 에서 재지 않는다.
- 결과: `report.json`·`report.md`. 숫자 요약만 `docs/evidence/eval/` 에 둔다. 실제 RFP 원문은 증거 폴더에 넣지 않는다.
- 결정 모델 지표(acc·nll·brier·ece·selective 등, 보정 전후)와 체크포인트 비교(같은 데이터 해시끼리 짝지은 부트스트랩)는 `sol_eval` 이 직접 계산한다.

> [!warning] 미검증 가정 (2026-10-20)
> - 순서 민감도는 Bosun 의 후보 제시 순서 seed(`sha256(f"{seed}:{row_id}:candidate-order")`) 0~5 로 6회 돌려 잰다. `sol_decision.serve` 에는 `permute` 엔드포인트가 없다.
> - `python -m sol_eval` 의 `bosun_score`·`export --format bosun`·`leakage`·`compare` 는 main 에 있고, 결정적 가짜 backend(`bosun_score --backend fake`)로 돌려 볼 수 있다. 실제 패키지 채점은 하지 않았다.

### 4.2 비교 대상

| ID | 시스템 | 상태 |
|---|---|---|
| E0 | 규칙만(결정 모델 없음) | 축소판(§3.5) 비교 대상. 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 리포트 없음 |
| E1' | 공개 Bosun v3.1 0.6B(`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`) zero-shot, `en` state | E4 의 기준선. 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 리포트 없음 |
| E2 | 공개 Bosun v3.1 0.6B, `ko` state(템플릿 `ko.v0.2`, 레코드 `bosun/{split}.ko.jsonl`, 서버 안 오프라인 `bosun_score`, 평가 전용. 내보내기 코드는 없다, [[16-DECISIONS\|16]] 미결정 29-6) | 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 리포트 없음 |
| E3 | Qwen3.8-Flash-Next(회사 vLLM API) 프롬프트 분류(같은 질문, 선택지 토큰 logprob 으로 분포) | 비교 대상([[16-DECISIONS\|ADR-023]] X1). 발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 모델은 회사 API 의 `Qwen3.8-Flash-Next-AWQ-INT4`([[16-DECISIONS\|ADR-034]]). "결정 모델이 꼭 필요한가"를 판단하는 대조군. 축소 규모(§3.5)로 E0·E1'·E2·E3 를 같은 입력에서 비교한다. 리포트 없음. 설계·판정 규칙·3안(유지/축소/제외)은 [E3 실험 설계](plans/2026-10-19-e3-experiment-design.md). 회사 vLLM 이 `prompt_logprobs` 를 주는지는 미검증 |
| E4 | Bosun v3.1 0.6B + LoRA(`en`, 공개 LoRA 이어 학습) | 발표 뒤 진행 예정(X6, [[16-DECISIONS\|ADR-067]]·ADR-034). E1' 과 같은 test 분할·데이터셋 버전·state 템플릿·질문 세트·평가 코드·seed 0~5·지표에서 짝 부트스트랩 95% CI(사업 클러스터 단위 우선, §4.3)로 비교. 서버 안 오프라인 채점(§4.1), 물리 GPU 1 에서 E4·E1' 순차. `ko` 는 후속 |
| EX0 | Qwen3.8-Flash-Next(회사 vLLM API) 추출 원본 | 리포트 없음. 회사 API 추출 품질 기준 측정만(§4.3 추출 행 + `(untranslated)` 비율). 파인튜닝 비교(EX1)는 하지 않는다(§5.6) |

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
| | 선택지 순서 | Bosun 후보 제시 순서 seed 0~5(6회, `python -m sol_eval bosun_score --seeds 0-5`)의 `argmax_stable` 비율과 `spread`. |
| | 표현 변경 | state 줄 순서 섞기 + 용어집 동의어 치환 뒤 argmax 가 바뀐 비율 |
| 언어 | 한국어/영어 차이 | E1'·E2 의 항목 id 짝 비교(둘 다 서버 안 오프라인 `bosun_score`. E2 는 E1' 레코드 형식에 state 만 한국어, [[16-DECISIONS\|16]] 미결정 29-1·29-6. 지금 `compare` 는 데이터 sha256 이 다르면 거부해 언어 짝 비교 코드는 없다). ΔMacro-F1·ΔBrier·ΔECE 와 부트스트랩 95% 신뢰구간(하네스 자체 구현) |
| 성능 | 지연 | 요청당 p50·p95(결정 모델, Qwen 추출, 공고 1건 E2E) |
| | GPU 메모리 | 최대 점유(nvidia-smi 샘플링 또는 `torch.cuda.max_memory_allocated`) |
| | 처리량·비용 | 시간당 공고 수. 1,000건당 비용 = GPU 시간 단가(입력값) × 시간 |

모든 지표에 부트스트랩 95% 신뢰구간과 표본 수를 함께 적는다.

**신뢰구간의 단위.** 같은 사업에서 파생된 가상 기업 변형과 질문은 독립 표본이 아니다(같은 공고·같은 추출을 공유한다). 그래서 E1'·E4 비교의 CI 는 **사업 클러스터 단위 paired bootstrap**(클러스터를 복원 추출하고 그 안의 항목·질문을 통째로 넣는다)을 우선 내고, 레코드 단위 CI 는 참고로 함께 적는다. 클러스터 수가 적으면(해커톤 test 20) 구간이 넓다. 그때는 개선 효과를 확정적으로 주장하지 않고 **탐색적 결과**로 보고한다. 표본 수는 레코드·질문·클러스터 세 가지를 모두 적는다.

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

> [!note] X6 의 예외 (ADR-034)
> X6 의 Bosun v3.1 0.6B LoRA 학습은 E4 비교 실험이다(발표 뒤 진행 예정, [[16-DECISIONS|ADR-067]]). 그래서 위 4번 조건을 기다리지 않는다. 운영 반영(레지스트리 서빙 항목·데모 모델 교체, SOL Score 반영)은 위 절차와 ADR 을 그대로 따르고 사용자 승인이 필요하다(ADR-034 9번). E4 가 E1' 보다 낫다고 말하려면 Δ 의 95% CI 가 0 을 포함하지 않아야 한다. Qwen 파인튜닝은 **하지 않는다**(2026-10-20 사용자 결정, §5.6). `EXTRACTION` 원인은 프롬프트·스키마·용어집·인용 검증으로 고친다.

목표 미달은 점추정이 아니라 신뢰구간으로 판단한다. 신뢰구간이 목표를 걸치면 "판단 보류" 로 두고, 사례별 오류 분석을 함께 낸다. SOL Score 에 결정 모델을 반영할지([[08-SCORING|08 점수]])도 같은 지표와 오류 분석으로 따로 판단한다.

## 5. 파인튜닝 — Bosun v3.1 0.6B LoRA (회사 GPU 1. X6 발표 뒤 진행 예정, 비교 실험이고 운영 반영은 후속)

X6 는 발표(11-05) 뒤 진행 예정이다([[16-DECISIONS|ADR-067]]). 날짜는 정하지 않았고 회사 서버에서 학습·채점을 돌린 기록은 없다. 이 절은 무엇을 언제 학습하고 결과를 어떻게 받아들이는지 정한다. 모델 출처(Hugging Face 리비전·sha256), 학습 환경, 질문별 학습 데이터, 명령, 돌려받을 것은 [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]]가 정본이다(ADR-034 로 Bosun 기준 개정). 대상 모델이 Bosun v3.1 0.6B 로 바뀐 근거(ADR-034)와 파일 목록은 [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) §4 다.

### 5.1 도구

- Bosun 공식 학습 코드는 **없다**(모델 카드·Hanno Labs GitHub 저장소에 없음, 계획 §1.1). 학습·채점은 우리 코드다: `services/decision` 의 `sol_decision.train`(학습), `python -m sol_eval` 의 `bosun_score`(오프라인 채점)·`export --format bosun`(레코드 내보내기)·`leakage`(누수 검사)·`compare`(짝 부트스트랩 Δ·95% CI), `sol_decision.trainer.calibrate`(F3 보정). 전부 main 에 있고 실행 기록은 없다.
- 학습 대상은 공개 LoRA 어댑터(PEFT, r=16, alpha 32, dropout 0.05, `q_proj k_proj v_proj o_proj gate_proj up_proj down_proj` 7모듈 × 28층 = 392 텐서, 10,092,544 파라미터)만이다. 공개본에서 **이어 학습**하고 새 LoRA 를 만들지 않는다. decision token 임베딩(256행 입·출력)·백본(`Qwen/Qwen3-0.6B@c1899de`)·토크나이저는 동결한다(ADR-034 7번).
- 손실: `render_decision_prompt(...)` → `(content, presentation_order, candidate_to_slot)` → `decision_logits(input_ids, attention_mask)[:, :K]`(K = 후보 수)에 CE(one-hot) 또는 soft-CE(`gold.probabilities`). 에폭마다 `seed = --seed + epoch` 로 후보 제시 순서를 바꿔 slot 편향을 막는다. 왼쪽 패딩 필수(`decision_logits` 가 마지막 열 attention 1 을 요구). `predict()` 는 `torch.inference_mode()` 안이라 학습에 쓰지 않는다. 학습 전에 `predict` 와 `decision_logits` 경로의 확률이 같은지(seed 고정) `python -m sol_decision.parity` 로 확인한다(모델 필요, 미실행. 계획 §10 4번).
- 회사 서버의 CPU 2-step smoke(장난감 6건, 사용자 보고)는 파이프라인 증거로만 쓴다. 성능 주장에 쓰지 않는다. 그 코드는 저장소 밖이고 `services/decision/src/sol_decision/train.py` 가 대체했다([[22-FINETUNE-RUNBOOK|22]] §3.2).

### 5.2 보유 GPU 에서의 LoRA 메모리 검증 (F1)

회사 GPU 는 A40 3장 중 **물리 index 1 한 장**이다. 회사 PaddleOCR 공유 전제는 ADR-066 으로 지웠고, 학습·서빙 전에 GPU 1 메모리를 확인한다. 사양·사용량·공유 규칙·메모리 계획의 정본은 [[22-FINETUNE-RUNBOOK|22]] §3.1 이다. 80 GB·H100·H200 을 전제하지 않고, 3장의 VRAM 을 합치지 않고, 어떤 프로세스도 종료·이동하지 않는다.

F1 은 GPU 1 에서 `infra/gpu/bosun-f1.sh` 가 `python -m sol_decision.train --max-steps 20 --batch 1 --accum 8 --bf16 --grad-checkpointing --max-state-tokens 6144`(6,000 토큰 state 포함)를 돌려 최대 메모리·step 시간·OOM 여부·상한을 넘어 건너뛴 레코드 수·checkpoint 저장과 재로딩 여부를 `docs/evidence/bosun-train-feasibility.md` 에 표로 남긴다. 사전 검사는 `infra/gpu/bosun-preflight.sh` 다. 절차·합격 조건·실패 시 검토 순서(state 축약 → batch·누적 → 공식 메모리 옵션 → **사용자 승인 대상**인 다중 GPU·클라우드 GPU 임대, ADR-010)는 [[22-FINETUNE-RUNBOOK|22]] §4.2 다. 학습 가능 여부는 이 결과로만 확정한다. 20 step 통과만으로 F2 준비 완료라고 적지 않는다. 메모리 추정(F1 실측 전, 계획 §8): Bosun LoRA 학습 약 6~10 GB, `sol_decision.serve` 서빙 약 1.5~3 GB.

### 5.3 학습 (F2)

공개 학습 레시피가 없으므로 lr·에폭 수·배치·누적은 미확인이다. 학습기 기본값(`--lr 1e-4`·`--epochs 1`·`--batch 1`·`--accum 8`)은 출발값일 뿐이고, F1 step 시간·메모리를 보고 22 §4.3 에 기록한다. 고정인 것: 공개 LoRA 이어 학습, decision 임베딩 동결, 질문 단위 레코드(§3.7), 에폭마다 제시 순서 seed 변경, 라벨 원칙은 [[22-FINETUNE-RUNBOOK|22]] §4.1(구성·규칙 실버는 train 만·사람 라벨·유료 LLM 라벨 금지·누수 0). 공개 replay 자료는 없다. 망각(회귀) 확인은 내부 dev 세트가 기본이다(ADR-034 9번, 사용자 결정 2026-10-20). dev 만으로 Bosun 의 일반 Decision 능력이 망각되지 않았다고 주장하지 않는다. DecisionBench 공개 평가 분할은 라이선스·중복·재배포 조건을 확인한 뒤 보조 평가로만 쓰고(16 미결정 24), 입력 자리는 `python -m sol_eval bosun_score --suite <JSONL> --suite-format decisionbench`다. 실행은 별도 승인이다. 명령과 받아들이기 전 확인 항목은 22 §4.3, 보정(dev)과 E4 평가는 22 §4.4 다.

### 5.4 반입과 모델 레지스트리

- 회사 GPU 에서 돌려받는 것은 [[22-FINETUNE-RUNBOOK|22]] §4.5 다: 학습본 패키지 `runs/bosun-sol-lora-v0.1/`(Hugging Face 레이아웃 그대로 — `config.json`·`adapter/`·`decision_embeddings.safetensors`(복사, 변경 없음)·`tokenizer/`·`serving.json`·`manifest.json` 의 파일 sha256), `train.log`, `training_metrics.json`, `runs/f1-results.md`, 채점 출력 폴더(`predictions.jsonl`·`rows.json`·`report.json`), `MODEL_CARD.md`. 데이터셋 원문은 돌려받지 않는다. 받으면 manifest sha256 을 먼저 대조한다.
- 레지스트리 항목 필드와 서빙 검증(서버 기동 시 패키지 sha256 대조, gateway 의 `GET /v1/models` 대조, `questionSet`·`stateTemplate` 호환성)은 [[03-AI-PIPELINE|03 AI 파이프라인]] §11 이 정본이다. 학습본 항목 id 는 `bosun-sol-lora-v0.1` 이고 패키지를 받은 뒤 레지스트리에 추가한다. 지금 레지스트리에 없다. 상태 규칙은 03 §11 이 정본이다.
- E4 평가 전용 항목은 패키지를 받은 뒤 넣는다. 데모 서빙 항목 `bosun-v3.1-0.6b`(공개본)는 바꾸지 않는다. 학습본으로의 교체는 같은 평가셋에서 Δ 의 95% CI 가 0 을 배제하는 개선과 dev·regression 안정성을 보이고 **사용자 승인**을 받은 뒤에만 한다(ADR-034 9번).
- 운영 모델 교체는 ADR 로 정한다. 기존 `score_runs` 는 덮어쓰지 않는다.

### 5.5 실행 위치와 데이터 경계

- 평가 하네스(`sol_eval`)는 노트북에서 회사 GPU 추론 엔드포인트에 붙여 돌리고, F1·F2·F3 는 GPU 서버 셸이 필요해 회사 측이 돌린다(해커톤 실추론과 같은 GPU, [[10-DEPLOYMENT|10 배포]], [[16-DECISIONS|ADR-025]]). 학습 요청서(F1·F2 명령·F3 보정·돌려받을 것·데이터 경계)는 X6 에서 만들어 회사에 넘긴다(아직 없다, [[22-FINETUNE-RUNBOOK|22]] §6).
- 회사 GPU 로 가는 데이터는 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 회사 프로필뿐이다. 회사 GPU 서버는 공개 가중치(Bosun·백본 `Qwen/Qwen3-0.6B`, 리비전 고정)·코드를 Hugging Face·GitHub 에서 받는다(외부망이 없으면 반입, [[22-FINETUNE-RUNBOOK|22]] §2.2).
- 첨부 원문의 저작권·재배포 조건은 미확인이다. 내부 분석과 사내 학습에만 쓰고, 외부 공개·배포 전에 법무를 확인한다.

### 5.6 Qwen 파인튜닝 — 하지 않는다

Qwen 파인튜닝은 **하지 않는다**(2026-10-20 사용자 결정. ADR-034 채택 당시의 "EX0 뒤 조건부 QLoRA" 는 같은 날 사용자 결정으로 철회). 추출·설명 모델은 회사가 이미 운영하는 vLLM API 의 `Qwen3.8-Flash-Next-AWQ-INT4`(`https://acropolissg.com/vllm/v1`)이고 우리는 띄우지도 학습하지도 않는다. EX0 은 그 API 의 추출 품질 기준 측정(§4.2)이며, 추출 지표 미달의 `EXTRACTION` 원인은 프롬프트·스키마·용어집·인용 검증으로 고친다. ADR-034 초안의 Qwen3-4B 안은 퇴역했다(레지스트리 `status: backup`). Qwen SFT JSONL 은 내보내지 않는다(§3.7). `sol_decision.train` 은 생성 모델 학습용이 아니다. [[22-FINETUNE-RUNBOOK|22]] §5 의 Qwen 절은 이력이다.

### 5.7 연 1회 재학습 구조 (ADR-066, 구현은 발표 뒤)

회사가 수행한 사업은 해마다 늘어난다. 그래서 Bosun 은 **연 1회** 다시 학습한다. 앱의 최종 결정 기록이 **200건** 쌓이면 연 1회를 기다리지 않고 수동으로도 돌린다(2026-10-29 사용자 결정). 인력은 학습하지 않는다. 인력은 자주 바뀌므로 분석 때 `staffAvailability` 입력으로 넣는다(ADR-066 5번).

| 단계 | 하는 일 | 자리 |
|---|---|---|
| 1 내보내기 | 과거 수행 사업의 원공고, 앱의 최종 결정 기록(사람 라벨), 규칙 silver(train 만)를 질문 단위 레코드(§3.7)로 내보낸다. 유료 LLM 라벨은 쓰지 않는다. 분할과 누수 검사는 §3.6 | `scripts/ops/` 운영자 CLI → `datasets/decision/<데이터 버전>/` |
| 2 학습 | 명령 하나로 LoRA 를 학습한다. GPU 1 만 쓰고, 시작 전에 메모리를 확인한다 | `infra/gpu/bosun-retrain.sh <데이터 버전>`(F2 명령을 감싼다) |
| 3 평가 게이트 | 지금 서빙 모델과 같은 test 로 E4 를 채점한다. Δ 의 95% CI 가 0 을 배제하고 dev·regression 이 안정일 때만 후보가 된다(§4.4, ADR-034 9번) | `sol_eval.bosun_score` |
| 4 포장 | manifest sha256 을 만들고 레지스트리에 `status: backup` 으로 넣는다(§5.4) | `services/ai/models/registry.yaml` |
| 5 승인·교체 | 사용자 승인 뒤 8009 서빙 패키지 경로만 바꾼다. 이전 패키지는 남겨 env 하나로 되돌린다 | 회사 Compose |

- 최소 규모는 §3.5 를 따른다(test 20·dev 10 사업, train 질문 기록 1,000건). 모자라면 그 해에는 학습하지 않고 기록만 남긴다.
- 데이터 버전은 `<연도>-<회차>`(예: `2027-1`)이고, 학습본 id 는 `bosun-sol-lora-<데이터 버전>` 이다. 기존 `score_runs` 는 덮어쓰지 않는다.
- 해커톤 전에는 재학습하지 않는다. 위 CLI·스크립트도 아직 없다.

## 6. 운영자 CLI

| 명령 | 위치 | 하는 일 |
|---|---|---|
| `pnpm dataset:build --version sol-eval/v0.1`(예정) | 루트 스크립트(service role) | live 공고·추출·가상 기업 → `EvalItem` + 분할 + 마스킹 → Supabase Storage |
| `uv run python -m sol_eval export --format bosun [--version v0.1] [--out <폴더>]` | `services/ai` | `EvalItem` → Bosun 질문 단위 레코드(`bosun/{split}.en.jsonl`)·index·`manifest.json`(기본 출력 `datasets/sol-eval/<version>/`). 이 폴더를 통째로 `sol-dataset-v0.1/` 이름으로 보낸다(또는 `--out` 으로 그 이름을 준다. 서버 스크립트 기본 경로가 `$SOL_WORK/sol-dataset-v0.1/` 다. tar 로 묶지 않는다, 16 미결정 29-3). `--format` 을 빼면 퇴역 Kev 형식이다 |
| `uv run python -m sol_eval leakage --bundle <폴더> [--out <리포트.json>]` | `services/ai` | 클러스터 교차·held-out 기업·fixture 포함·같은/유사 state·선택지 분포(각 ≥ 5%)·manifest sha256 검사 → 리포트(위반이면 exit 1). |
| `uv run python -m sol_eval labels check <file>` | `services/ai` | 사람 라벨 파일 검증 |
| `python -m sol_eval bosun_score --package <dir> --data "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl" --seeds 0-5 --out "$SOL_WORK/runs/e4-test"` | 회사 GPU 서버의 `.venv-bosun`(`uv run` 아님. 설치는 22 §3.2, 회사 측 실행). 경로는 절대 경로로 준다 | 오프라인 채점(E1'·E4, 언어 짝 비교용 E2) → `predictions.jsonl`·`rows.json`·`report.json`. `--backend fake` 는 시험용, `--suite` 는 외부 보조 평가(ADR-034 9번, 실행은 별도 승인) |
| `uv run python -m sol_eval compare --candidate runs/e4-test --reference runs/e1p-test --out runs/e4-vs-e1p` | `services/ai`(노트북) | 두 채점 출력의 짝 부트스트랩 Δ·95% CI. `rowId` 집합이나 데이터 sha256 이 다르면 거부한다(그래서 지금은 E1'↔E2 언어 짝 비교를 못 한다, 16 미결정 29-6). |
| `SOL_GPU_SHARE_APPROVED=1 SOL_TRAIN_APPROVED=1 bash infra/gpu/bosun-f1.sh [--batch B --accum A]` → `python -m sol_decision.train --max-steps 20 …` | 저장소 루트(회사 GPU 서버, 회사 측 실행. `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`, preflight 통과 표식 `$SOL_WORK/runs/bosun-preflight-ok` 필요) | §5.2 F1 메모리 smoke → 결과 표, 미실행. 이전 `infra/gpu/kev-f1.sh` 는 퇴역(파일은 보존) |
| `pnpm eval:publish <report.json>`(예정) | 루트 스크립트 | 요약을 `eval_runs` 에 저장. 웹 읽기 경로 `GET /api/v1/admin/ai/eval-runs` 도 미구현이다([[05-API-SPEC\|05 API]]) |

## 7. 수용 기준 (X6 실행 시)

- 데이터셋 v0.1: test 20·dev 10 사업, 원형 6개, manifest·라벨 검증 통과, 사업 단위 분할 누수 0건(클러스터 교차 검사, `python -m sol_eval leakage`).
- 평가: E0·E1'·E2·E3·EX0 리포트와 E1' 오류 분석(§4.4)이 `docs/evidence/eval/` 에 있다. E0~E3 비교(ADR-023 X1)는 축소판(§3.5) 기준이고, E1' 과 E3 의 차이는 점추정이 아니라 부트스트랩 95% 신뢰구간으로 판정한다. 효과가 확인되지 않으면 개선을 주장하지 않고 3안을 제안한다. 지표 표에서 채우지 못한 칸은 이유를 적는다.
- 재현성: 같은 데이터셋 버전·commit·seed 로 다시 돌리면 결정 모델 지표가 같다. Bosun `predict` 가 seed 고정에서 결정적이라는 가정이 틀리면 그 사실을 보고한다.
- 내보내기: train 1,000 레코드(질문 단위) 이상, 번들 sha256 기록, Bosun 레코드가 `python -m sol_eval bosun_score --data` 로 읽힌다(노트북에서 `--backend fake` 로, 회사 측 실행에서 실제로 확인), 학습 요청서가 회사에 전달됐다. manifest 와 E4 리포트에 train 레코드 수 외에 **고유 사업 클러스터 수, 가상 기업 변형 수, 질문 수, 라벨 출처별 비율(`CONSTRUCTED`/`HUMAN`/`RULE_SILVER`), 의미 판단 `HUMAN` 라벨 수, 요구사항 유형별(기술·실적·인력·자격) 분포**를 적는다. 규칙 엔진이 이미 푸는 항목(`RULE_SILVER`)을 결정 모델이 배웠다는 것만으로 AI 성능 개선을 주장하지 않는다. 개선 주장은 `CONSTRUCTED`·`HUMAN` 라벨 test 에서의 Δ 로만 한다.
- 메모리 검증 스크립트(`infra/gpu/bosun-preflight.sh`·`infra/gpu/bosun-f1.sh`)와 절차([[22-FINETUNE-RUNBOOK|22]] §4.2)가 있다. 실행 결과는 회사 측 실행 뒤 `docs/evidence/bosun-train-feasibility.md` 에 남긴다. Kev 기록 `docs/evidence/kev-train-feasibility.md`(§0 서버 환경 2026-10-20 기록, F1 미실행)는 삭제·개서하지 않는다(ADR-034 11번).
- 파인튜닝: 회사 측 실행 결과를 받으면 `bosun-train-feasibility.md`·패키지 `manifest.json`·E4 리포트(E1' 대비 Δ·95% CI, seed 0~5)를 `docs/evidence/eval/e4-<일시>.md` 에 남긴다. 받지 못하면 받지 못한 단계와 이유를 리포트에 적는다. 결과 수치의 통과 기준은 없고, 데모 모델 교체를 뜻하지 않는다(ADR-034 9번).

## 8. 미확인

모델 품질·메모리·회사 서버 사실·회사 Qwen API 지원 범위의 미확인 항목은 [[22-FINETUNE-RUNBOOK|22]] §7 한 곳에 모은다.

## 다기관 입력 평가 데이터 (ADR-047)

ADR-047 [설계](../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md) §8은 다기관 데이터를 기존 평가/학습 계약에 연결하는 영향도만 다룬다. 같은 opportunity 의 출처 사본·모든 revision·동일 첨부가 train/dev/test 를 넘지 않도록 묶고 source 별 추출/관련성 오류를 구분한다. 관련성 라벨을 자격충족/기업적합도/수주결과 라벨로 대체하지 않는다.

Bosun LoRA 비교 실험·공개 모델 데모·Qwen 학습 제외·운영 승격 승인·자료 이용권 검토는 유지한다. 신규 API 연동이 학습/재배포 허락을 보증하지 않으며, 데이터 export·학습·모델 교체는 실행하지 않았다. 현재 코드·검증·적용 여부는 [격리 구현 보고](evidence/procurement-expansion/20261021-implementation.md)와 [main 통합·운영 적용 기록](evidence/procurement-expansion/20261022-release.md)에서 구분한다.

## 관련 문서

- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — 모델 출처·학습 환경·학습 데이터 제작·명령·반입(ADR-034 Bosun 기준)
- [[03-AI-PIPELINE|03 AI 파이프라인]] — 결정 모델 질문 세트 `kev-qs/v0.2`, state·`stateTrace`, Bosun 사실(§5.1)·wire 타입 변환(§5.4)·레지스트리 검증(§11), §10 문서 파서 계약·실제 RFP 샘플 비교
- [[07-DATA-PIPELINE|07 수집 파이프라인]] — 실데이터 수집
- [[08-SCORING|08 점수]] — 판정 라벨·사유 코드, SOL Score 와 결정 모델
- [[11-TESTING|11 테스트]] — 시스템 시험·골든·증거
- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, `CompanyEvidenceRef`, 인용 검증
- [[16-DECISIONS|16 ADR]] — ADR-034(결정 모델 Bosun, ADR-027 폐기), ADR-067(X6·E0~E3·X2 발표 뒤 진행 예정), ADR-020, ADR-010, ADR-012, ADR-023, 미결정 22·24번
- [분석·변경 계획](plans/2026-10-20-bosun-qwen4b-migration-plan.md) — ADR-034 분석, Bosun 사실·레코드 형식 §4·위험 §10
- [[12-ROADMAP|12 로드맵]] — 일정
- [[10-DEPLOYMENT|10 배포]] — 회사 추론 엔드포인트 연결·`sol_decision` 결정 모델 런타임·회사 vLLM API
