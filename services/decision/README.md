# sol-decision — 결정 모델 서버 (Bosun v3.1 0.6B, Kev wire 호환)

회사 GPU 서버에서 `127.0.0.1:8009` 로 띄우는 경량 HTTP 서버다. 노트북의 AI gateway(`services/ai`, `KEV_BASE_URL`)가
그대로 붙는다. 설계 정본은 `docs/03-AI-PIPELINE.md` §5.3·§5.4·§11 과 `docs/16-DECISIONS.md` ADR-034 3번이다.

- 요청·응답은 **Kev wire**(`POST /v1/systemone`)다. 게이트웨이의 `kev_wire.py` 파서·worker 의 `kev_output` 저장은 바꾸지 않는다.
- 모델은 `Hanno-Labs/bosun-v3.1-0.6b`(`trust_remote_code`)를 로컬 패키지에서만 올린다. 다운로드하지 않는다(`HF_HUB_OFFLINE=1`).
- 기동 때 패키지 `manifest.json` 의 sha256 을 파일과 대조하고, 다르면 기동을 거부한다(exit 78).
- 학습기(`train.py`·`trainer/`·`parity.py`)는 같은 패키지에 있다. 이 문서는 서버만 다룬다(학습은 `docs/TRAINING.md`).

## 설치

```bash
cd services/decision
uv sync --frozen                # 노트북·CI: 서버·시험만(torch 없음)
uv sync --frozen --extra model  # 회사 GPU 서버: torch·transformers·peft 포함
```

Python ≥ 3.12. 코어 모듈은 torch 를 import 하지 않는다. `--extra model` 없이도 `--backend fake` 로 wire·인증·마감을 점검할 수 있다.

## 기동 (회사 GPU 서버)

패키지 디렉터리는 Hugging Face snapshot(`manifest.json`·`config.json`·`adapter/`·`decision_embeddings.safetensors`·`tokenizer/`) 또는
학습본 run 디렉터리(같은 파일 구성 + `manifest.json`)다. 백본 `Qwen/Qwen3-0.6B@c1899de2…` snapshot 도 같은 `HF_HOME` 캐시에 있어야 한다
(Bosun 모델 코드가 `local_files_only` 로 찾는다).

```bash
export DECISION_API_KEY="$KEV_API_KEY"   # 노트북 게이트웨이의 KEV_API_KEY 와 같은 값. 셸 변수로만 다룬다
export HF_HUB_OFFLINE=1
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 \
python -m sol_decision.serve \
  --package "$HF_HOME/hub/models--Hanno-Labs--bosun-v3.1-0.6b/snapshots/5e78a37c8d86860ebac9ef2d5327d6299498498e" \
  --alias bosun-v3.1-0.6b --host 127.0.0.1 --port 8009
```

| 옵션 | 기본 | 뜻 |
|---|---|---|
| `--package DIR` | (bosun 백엔드는 필수) | 검증·로딩할 패키지 디렉터리 |
| `--alias` | `bosun-v3.1-0.6b` | 요청 `model` 값·`/v1/models` 의 `id`. 레지스트리 `requestModel` 과 같아야 한다 |
| `--backend` | `bosun` | `bosun` 또는 `fake`(결정적 가짜 분포. 모델이 아니다) |
| `--device` | `auto` | `auto`(cuda 있으면 cuda) · `cpu` · `cuda` |
| `--dtype` | `bf16` | `bf16` · `fp16` · `auto` |
| `--host` / `--port` | `127.0.0.1` / `8009` | `0.0.0.0` 은 이 플래그로 명시할 때만. env 로는 바꿀 수 없다 |
| `--seed` | `0` | Bosun 후보 제시 순서 seed(서빙 결정성) |

| 환경 변수 | 기본 | 뜻 |
|---|---|---|
| `DECISION_API_KEY` | (필수) | Bearer 키. 없으면 기동 거부 |
| `DECISION_TIMEOUT_MS` | `4500` | 요청 하나(질문 전부)의 마감. 넘으면 504. 게이트웨이 `KEV_TIMEOUT_MS`(5000)보다 짧게 둔다 |
| `DECISION_RUN` | `Hanno-Labs/bosun-v3.1-0.6b@5e78a37c` | `/v1/models` 의 `run`. 학습본이면 레지스트리 id(예 `bosun-sol-lora-v0.1`) |
| `DECISION_REVISION` | `5e78a37c8d86860ebac9ef2d5327d6299498498e` | `/v1/models` 의 `revision` |
| `DECISION_BASE` | 패키지 `config.json` 의 `base_model_name_or_path@base_model_revision[:8]` | `/v1/models` 의 `base` |

`lora`·`decision_embeddings_sha256` 은 env 가 아니라 **실제 파일의 sha256** 이다(manifest 와 대조한 값).

## 확인

```bash
curl -sS http://127.0.0.1:8009/health
# {"status":"ok","model":"bosun-v3.1-0.6b","backend":"bosun","device":"cuda","loadedAt":"…"}

curl -sS -H "Authorization: Bearer $DECISION_API_KEY" http://127.0.0.1:8009/v1/models
# {"object":"list","data":[{"id":"bosun-v3.1-0.6b","object":"model","run":"Hanno-Labs/bosun-v3.1-0.6b@5e78a37c",
#   "base":"Qwen/Qwen3-0.6B@c1899de2","lora":"961d237b…","revision":"5e78a37c…","decision_embeddings_sha256":"88f9e856…",
#   "temperature":null,"questionTypes":["choice","score","noul"]}]}
# run·base·lora·revision 이 services/ai/models/registry.yaml 의 bosun-v3.1-0.6b 항목과 글자 그대로 같아야 한다(03 §11)

curl -sS -i -H "Authorization: Bearer $DECISION_API_KEY" -H 'Content-Type: application/json' \
  http://127.0.0.1:8009/v1/systemone -d '{
  "model": "bosun-v3.1-0.6b",
  "state": "COMPANY: 12 engineers, Java/Spring, 3 public-sector projects.\nNOTICE: [R1] ISO 27001 required.",
  "questions": {
    "recommendation": {"type": "choice", "instructions": "Given the company profile and the notice requirements, which action should the sales team take?",
                       "criteria": {"BID": "Requirements are met and the fit is strong", "WATCH": "Promising but something must be confirmed first", "NO_BID": "A mandatory requirement is unmet or the fit is poor"}},
    "fit": {"type": "score", "instructions": "How well does this company'"'"'s capability match this notice overall?",
            "criteria": ["Very poor", "Poor", "Moderate", "Good", "Very good"]},
    "needsHumanReview": {"type": "noul", "instructions": "Does this notice contain ambiguity, conflicting figures or unusual conditions that a human should check before deciding?"}
  }}'
# HTTP/1.1 200 OK · x-typesafe-request-id: <uuid4>
# {"responses":{"recommendation":{"choice":"WATCH","confidence":0.6,"probabilities":{"BID":0.3,"WATCH":0.6,"NO_BID":0.1}},
#               "fit":{"score":2.4,"probabilities":{"0":…,"4":…},"confidence":…,"legend":["Very poor",…]},
#               "needsHumanReview":{"noul":0.42}},
#  "usage":{"input_tokens":0,"output_tokens":0},"latency_ms":…}
```

## 계약 요약

요청(게이트웨이 → 서버, Kev wire): `{model?, state: string|object, questions: {qid: {type, instructions, criteria?}}}`
- 알 수 없는 필드 거절. 질문 1~24개, qid 1~128자, 본문 1 MiB.
- `choice`: `criteria` 는 선택지 객체(2~255). `score`: 등급 이름 목록(2~255). `noul`: `{true?, false?}` 또는 없음.
- `model` 이 있으면 `--alias` 와 같아야 한다.

Bosun 변환(03 §5.4 표, 서빙·학습 공통 `contract.py`): choice → criteria 키 순서의 후보 `{id: key, label: key, description}`,
score → `{id: "0".."N-1", label}`, noul → `true`/`false`(description 기본 `yes`/`no`). 질문당 `predict` 1회, `seed` 는 설정값,
`row_id = sha256(qid + ":" + sha256(state))`. 확률은 **후보 id 로** 되돌린다(위치가 아니다).

응답: `{responses: {qid: 답}, usage: {input_tokens, output_tokens}, latency_ms}` + 헤더 `x-typesafe-request-id`.
- choice `{choice, confidence, probabilities{key}}` · score `{score: Σ i·p_i, probabilities{"0".."N-1"}, confidence, legend}` · noul `{noul: P(true)}`.
- 확률은 합 1 로 정규화한다. `usage` 는 0 고정(Bosun `predict` 가 토큰 수를 돌려주지 않는다).

| 상태 | `errorCode` | 뜻 |
|---|---|---|
| 401 | `UNAUTHORIZED` | `Authorization: Bearer` 없음·불일치(`/v1/*`·`/systemone`) |
| 413 | `PAYLOAD_TOO_LARGE` | 본문 1 MiB 초과 |
| 422 | `INVALID_REQUEST` | wire 형식 위반(`errors[{loc,msg,type}]` 동봉. 입력 값은 되돌리지 않는다) |
| 422 | `MODEL_MISMATCH` | 요청 `model` 이 alias 와 다름 |
| 500 | `INVALID_DISTRIBUTION` | 백엔드 확률이 분포가 아님(길이·NaN·음수·합 0) |
| 500 | `INFERENCE_FAILED` | 백엔드 예외 |
| 504 | `DEADLINE_EXCEEDED` | `DECISION_TIMEOUT_MS` 초과(질문 사이와 끝에서 검사. 진행 중인 forward 는 끊지 않는다) |

기동 거부(exit 78, stderr `기동 거부: …`): `DECISION_API_KEY(MISSING)`, `PACKAGE PACKAGE_REQUIRED`, `PACKAGE MANIFEST_MISSING(manifest.json)`,
`PACKAGE CONFIG_MISSING(config.json)`, `PACKAGE REQUIRED_FILE_NOT_IN_MANIFEST(<경로>)`, `PACKAGE FILE_MISSING(<경로>)`,
`PACKAGE SHA256_MISMATCH(<경로>)`, `PACKAGE MANIFEST_PATH_OUTSIDE(<경로>)`, `BACKEND MODEL_DEPENDENCIES_MISSING`, `BACKEND LOAD_FAILED(<예외 종류>)`.

로그에는 요청 id·질문 수·상태 코드·지연·예외 종류 이름만 남는다. state·질문 문구·키·예외 메시지는 남기지 않는다.
추론은 스레드 하나에서 한 요청씩 순차로 돈다(동시 요청은 줄을 선다).

## 검증

```bash
bash verify.sh     # ruff check · ruff format --check · pytest (torch 없이)
```

시험은 가짜 백엔드로 wire 3타입 왕복, 게이트웨이 `kev_wire.parse_response`·`kev_local.kev_registry_match` 와의 parity,
후보 id 매핑, 인증·상한·마감·오류 코드, 패키지 sha256 검증, 레지스트리 문자열 일치를 본다.
**실제 Bosun 로딩·추론·지연은 회사 서버에서만 확인한다**(가중치는 저장소에 없다): 기동 뒤 위 `curl` 셋과
`docs/03-AI-PIPELINE.md` §5.9 의 절차를 따른다.
