# Bosun v3.1 0.6B LoRA 이어 학습 — `sol_decision.train`

정본은 `docs/22-FINETUNE-RUNBOOK.md` §4 와 `docs/16-DECISIONS.md` ADR-034 7·9·10번이다. 이 문서는 학습기의 명령·인자·출력·금지 사항만 적는다.

## 금지 (먼저 읽는다)

- **GPU 실행은 사용자 승인 뒤**다. 승인 전에는 `--device cpu` smoke 만 돈다(ADR-034 10번).
- 물리 **GPU 0·2 사용 금지**. GPU 1(A40, 회사 PaddleOCR 과 공유)만 쓴다: `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`.
- **어떤 프로세스도 종료·이동하지 않는다**(PaddleOCR·`sol_decision.serve` 포함). 메모리가 모자라면 보고한다(22 §4.2 ①~④).
- 회사 서버 `datasets/decision/smoke.jsonl` **6건은 기능 검증 데이터**다. 학습·평가 데이터에 넣지 않고, 그것으로 만든 패키지·loss 로 성능을 말하지 않는다(ADR-034 7번).
- 학습 데이터 본문(state·instructions)·비밀값을 로그·리포트에 쓰지 않는다. `training_metrics.json`·`MODEL_CARD.md` 는 건수·sha256·loss 만 담는다.
- 유료 API·Hugging Face Hub 업로드·새 LoRA 초기화는 하지 않는다(공개 LoRA **이어 학습**만).

## 설치 (회사 서버 `.venv-bosun`)

모델 의존성은 `pyproject.toml` 의 `model` extra 다. 노트북·CI 는 extras 없이 설치하고 torch 를 import 하지 않는다.
회사 GPU 서버는 **기존 `.venv-bosun`(torch 2.8.0+cu128)에 `--no-deps` 로만 올린다**(README "설치", 12 추천안(사용자 위임 2026-10-21), `docs/22` §4 절차가 정본).
`uv sync --frozen --extra model` 은 쓰지 않는다 — `uv.lock` 의 `model` extra 가 torch 2.14.1 을 받아 회사 venv 를 바꾼다.

```bash
PY="$SOL_WORK/.venv-bosun/bin/python"
cd services/decision
uv pip install --python "$PY" --dry-run --no-deps -e .     # 계획만. 출력에 torch·transformers·peft 줄이 있으면 멈추고 보고
uv pip install --python "$PY" --no-deps -e .
uv pip check --python "$PY"                                # 빠진 순수 의존성만 명시 설치(docs/22 §4), torch 계열은 건드리지 않는다
"$PY" -c "import torch; print(torch.__version__)"          # 2.8.0+cu128 그대로
export HF_HUB_OFFLINE=1     # 백본 Qwen/Qwen3-0.6B@c1899de 는 HF 캐시에 있어야 한다(22 §2.2)
```

아래 표의 `python` 은 이 `"$PY"` 다. `uv run` 은 노트북(extras 없음) 전용이다.

## 명령

`$snap` 은 sha256 을 대조한 로컬 Bosun snapshot(22 §2.2), `$SOL_WORK` 는 `/data/www/ai_workspace/sol-radar` 다. 학습기는 시작 전에 `$snap/manifest.json` 의 `files` sha256 을 다시 대조하고, 어긋나면 중단한다.

| 단계 | 명령 |
|---|---|
| 동일성 검사(학습 전 필수) | `python -m sol_decision.parity --package "$snap" --data "$SOL_WORK/sol-dataset-v0.1/bosun/test.en.jsonl" --n 8` |
| CPU smoke(승인 불필요) | `python -m sol_decision.train --package "$snap" --data <작은 jsonl> --out "$SOL_WORK/runs/cpu-smoke" --device cpu --max-steps 2 --batch 1 --accum 1 --verify-reload` |
| F1 smoke(GPU 1, 승인 뒤) | `python -m sol_decision.train --package "$snap" --data …/bosun/train.en.jsonl --out "$SOL_WORK/runs/f1-b1a8" --max-steps 20 --batch 1 --accum 8 --grad-checkpointing --verify-reload` |
| F2 학습 | `python -m sol_decision.train --package "$snap" --data …/bosun/train.en.jsonl --out "$SOL_WORK/runs/bosun-sol-lora-v0.1" --seed 0 --epochs <F1 로 정함> --batch <F1 PASS 값> --accum <F1 PASS 값> --grad-checkpointing --verify-reload` |
| F3 보정(dev) | `python -m sol_decision.trainer.calibrate --data …/bosun/dev.en.jsonl --predictions "$SOL_WORK/runs/e4-dev/predictions.jsonl" --out "$SOL_WORK/runs/bosun-sol-lora-v0.1/calibration.json"` |
| F3 보정(직접 추론) | `python -m sol_decision.trainer.calibrate --data …/bosun/dev.en.jsonl --package "$SOL_WORK/runs/bosun-sol-lora-v0.1" --seeds 0-5 --out …/calibration.json` |
| 서버 전용 시험 | `SOL_BOSUN_PACKAGE="$snap" "$PY" -m pytest tests_model` (venv 의 torch·transformers 로. `uv run --extra model` 은 쓰지 않는다) |

`parity` 는 같은 레코드에서 ① `model.predict()` 확률과 ② 학습 경로(`render_decision_prompt` → chat template → `decision_logits[:, :K]` softmax → 후보 순서 복원) 확률의 최대 절대 오차를 내고, 프롬프트 문자열이 바이트 단위로 같은지도 본다. 허용치는 단건 `--tol 1e-4`, 왼쪽 패딩 배치 `--batch-tol 1e-2`(bf16 커널 차이 여유). 하나라도 넘으면 exit 1 이고 **학습을 시작하지 않는다**(ADR-034 미검증 콜아웃). 엄격 비교는 `--no-bf16`(fp32)로 돈다.

`calibrate` 는 dev 예측으로 온도 1개를 NLL 최소화(황금분할, `softmax(log p / T)`)로 맞춰 NLL·Brier·ECE(등폭 10 bins) 전후를 `calibration.json` 에 적는다. **서빙에 적용하지 않는다**(기록용, 22 §4.4). test 로 맞추지 않는다.

### 인자 (`python -m sol_decision.train --help`)

| 인자 | 기본 | 뜻 |
|---|---|---|
| `--package` | 필수 | 출발 Bosun 패키지 디렉터리(`manifest.json` sha256 대조 뒤 로딩) |
| `--data` | 필수 | `bosun/train.en.jsonl`(한 줄 = 질문 하나, 15 §4.1) |
| `--out` | 필수 | `runs/<name>/`. 비어 있지 않으면 중단(덮어쓰지 않는다, 22 §4.3) |
| `--lr` `--epochs` `--batch` `--accum` | `1e-4` `1` `1` `8` | AdamW, 마이크로 배치, gradient accumulation |
| `--max-steps` | `0`(전체) | F1 smoke 는 `20` |
| `--warmup-steps` `--weight-decay` `--max-grad-norm` | `0` `0.0` `1.0` | warmup 0 이면 상수 lr |
| `--grad-checkpointing` | 꺼짐 | 백본 gradient checkpointing(`use_reentrant=False`) |
| `--bf16` / `--no-bf16` | cuda=bf16, cpu=fp32 | dtype 강제 |
| `--device` | `auto` | `auto`·`cpu`·`cuda` |
| `--seed` | `0` | 재현성. 에폭 e 의 제시 순서 seed = `seed + e` |
| `--max-state-tokens` | `6144` | state 토큰 초과 레코드는 건너뛰고 개수를 기록(0 이 아니면 경고) |
| `--expect-tensors` `--expect-params` | `392` `10092544` | 학습 파라미터 집계가 다르면 중단(공개 r=16 어댑터 기준. 학습본을 이어 학습할 때도 같다) |
| `--verify-reload` | 꺼짐 | 저장 직후 `from_pretrained(out)` 로 다시 올려 `predict` 1회 |

## 무엇을 학습하고 무엇을 동결하나

| 부분 | 상태 | 근거 |
|---|---|---|
| LoRA 어댑터(`lora_A`·`lora_B`, 7 모듈 × 28 층 = 392 텐서, 10,092,544 파라미터) | **학습** | ADR-034 7번. PEFT 가 `is_trainable=False` 로 올리므로 이름에 `lora_` 가 든 파라미터만 `requires_grad=True` 로 켠다 |
| 백본 `Qwen/Qwen3-0.6B@c1899de` | 동결 | |
| decision token 임베딩(입·출력 256행) | 동결 | 저장 시 원본 `decision_embeddings.safetensors` 를 복사하고 sha256 이 같은지 확인한다 |
| 토크나이저 | 동결 | `tokenizer/` 복사 |

손실: 모델 모듈의 `render_decision_prompt`(시스템 프롬프트 상수 포함)를 그대로 호출해 프롬프트·`presentation_order`·`candidate_to_slot` 을 받고, `predict()` 와 같은 chat template(`add_generation_prompt=True`, `enable_thinking=config.decision_prompt_enable_thinking`)을 적용한다. `decision_logits(input_ids, attention_mask)[:, :K]` 의 log-softmax 에 `gold.probabilities` 를 슬롯 순서로 재배열한 soft target 을 곱한 cross-entropy(one-hot 이면 보통 CE). 배치 >1 은 왼쪽 패딩(마지막 열 attention 1 필수). 제시 순서는 `seed:rowId` 로 모델 코드가 섞고, 에폭마다 seed 가 바뀌어 slot 편향을 막는다.

## 출력 레이아웃 `runs/<name>/`

| 파일 | 출처 |
|---|---|
| `config.json` `configuration_bosun.py` `modeling_bosun.py` `serving.json` `tokenizer/` | 원본 복사 |
| `decision_embeddings.safetensors` | 원본 복사(동결, sha256 동일 확인) |
| `adapter/adapter_config.json` `adapter/adapter_model.safetensors` | PEFT `save_pretrained`(학습된 LoRA) |
| `manifest.json` | 원본 형식. `files` sha256 재계산, `base_model`·`base_revision` 유지, `init_from`(출발 어댑터·임베딩 sha256, 공개본 `metrics`·`selected_epoch` 는 여기로 옮김)·`train`(데이터 sha256·step·loss·skip·하이퍼파라미터·환경) 추가 |
| `training_metrics.json` | 인자, 파라미터 집계, 환경(torch·transformers·peft·device·dtype), 데이터 sha256·라벨 분포, step 별 loss·lr·시간·`torch.cuda.max_memory_allocated` |
| `MODEL_CARD.md` | 데이터 sha256·건수·step·loss·skip 수·환경. 성능 주장 없음 |
| `calibration.json` | `trainer.calibrate` 가 따로 쓴다(F3) |

학습마다 `--out` 이름을 새로 짓는다(`v0.2`, `v0.3`). 패키지는 `sol_decision.serve --package runs/<name>` 와 `sol_eval.bosun_score --package runs/<name>` 가 그대로 올린다.

## 시험

- 기본 `pytest`(`tests/`, torch 없이)는 서버·wire·`/v1/models` 시험만 둔다. 학습기 순수 함수 시험은 2026-10-21 시험 정리에서 지웠다(`docs/evidence/verification/20261021-pruned-tests.json`).
- `tests_model/test_train_smoke.py`(**서버 전용**, 기본 `testpaths` 밖): `SOL_BOSUN_PACKAGE` 가 없으면 skip 이 아니라 명확한 실패다. 있으면 파라미터 집계 392/10,092,544, parity(fp32, 더미 레코드 3건), CPU 2 step 학습 → 저장 → manifest 대조 → 재로딩 `predict` 를 확인한다.

## 알려진 한계

- 공식 학습 코드가 없어 `predict`·`decision_logits` 동일성(parity)이 유일한 서빙 일치 증거다.
- lr·에폭·배치는 F1 실측 전 미확정(22 §4.3). 기본값은 Kev 레시피에서 가져온 출발값이다.
- 회사 서버의 기존 2-step 코드는 저장소 밖이라 이 학습기가 대체한다(계획 §10 10번). 결과 비교는 B2 에서 한다.
