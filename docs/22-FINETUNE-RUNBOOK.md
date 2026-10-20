---
title: "22. 회사 GPU 파인튜닝 실행서: Kev-9B·Qwen3.5-9B"
doc: "22"
status: draft
tags:
  - sol-radar
  - ai
  - ops
updated: 2026-10-20
---

# 22. 회사 GPU 파인튜닝 실행서: Kev-9B·Qwen3.5-9B

> [!tip] 이 문서의 역할
> [[21-MODEL-TRAINING|21 모델 학습]]은 **무엇을 왜** 학습하는지(데이터셋·라벨·평가 지표·착수 판단)를 정한다. 이 문서는 **어떻게** 하는지를 적는다. 모델을 어디서 받는지, GPU 서버 환경을 어떻게 만드는지, 학습 데이터를 무엇으로 만드는지, 어떤 명령을 돌리고 무엇을 돌려받는지다. 회사 GPU 서버 셸에서 회사 담당자가 그대로 따라 할 수 있게 쓴다([[16-DECISIONS|ADR-025]]: 학습 실행은 회사).

> [!warning] 범위
> - **Kev-9B LoRA**: 해커톤 X6 트랙의 비교 실험이다([[16-DECISIONS|ADR-027]]). 데모·S-LIVE 모델은 `jaredpalmer/kev-9b@v1.0` 그대로다.
> - **Qwen3.5-9B LoRA SFT**: 방법만 준비한다. 해커톤에는 실행하지 않는다(ADR-027 U1). 착수는 21 §5.6 조건과 사람 결정·ADR을 거친다.
> - `sol_eval`·`pnpm dataset:build` 같은 우리 쪽 도구는 아직 없다(P0-9~P0-11, X6a·X6b에서 만든다). 아래에서 이 도구를 쓰는 단계는 그 구현을 전제로 한다.

## 1. 한눈에

| | Kev-9B | Qwen3.5-9B |
|---|---|---|
| 하는 일 | 요구사항별 충족 분류·기술 적합성·리스크 확률([[03-AI-PIPELINE\|03]] §5.10) | 공고문 요구조건 추출·영어 표기·설명([[03-AI-PIPELINE\|03]] §4) |
| 출발 모델 | `jaredpalmer/kev-9b@v1.0`(백본 `Qwen/Qwen3.5-9B-Base`) | `Qwen/Qwen3.5-9B`(post-trained, 지금 서빙하는 모델) |
| 학습 방식 | 공개 LoRA·pointer head 에서 이어 학습(`--init_from`) + 온도 보정 | LoRA SFT → 가중치 병합 → vLLM 서빙 |
| 도구 | `kev.train`·`kev.benchmark`·`kev.compare`(GitHub `jaredpalmer/kev`) | LLaMA-Factory `0.9.5` |
| 학습 데이터 | 실제 공고 × 가상 기업 변형의 영어 state + `kev-qs/v0.2` 라벨(§4.1), 공개 replay 2,000건 | `req-extract/v0.1` 프롬프트 + 공고 문서 → 정답 `RequirementExtraction` JSON(§5.2) |
| 비교 | E4 대 E1([[21-MODEL-TRAINING\|21]] §4.2) | EX1 대 EX0(§5.5) |
| 해커톤 | X6(실행) | 하지 않음(방법만) |

역할은 [[16-DECISIONS|ADR-025]]·ADR-027대로 나눈다.

| 우리(SOL RADAR) | 회사(GPU 서버) |
|---|---|
| 평가셋·학습셋 번들(`sol-dataset-{version}.tar`, sha256)·이 실행서·학습 요청서(§6)를 만든다 | 모델·코드를 받고(§2) 환경을 만든다(§3) |
| 사람 라벨(사용자 직접, ADR-027 U7) | F1 메모리 검증·F2 학습·F3 보정을 **물리 GPU 1 에서** 돌린다(§4) |
| 돌려받은 채점 출력을 노트북에서 오프라인으로 읽어 E4 지표를 내고(21 §4.1) 레지스트리 항목을 쓴다 | 서버 안에서 `kev.benchmark` 채점 4회·`kev.compare` 를 돌린다(ADR-027 10번 개정. 평가 전용 `kev.serve` 는 B안일 때만, §4.4) |
| 결과를 제출물에 적는다 | 돌려줄 것(§4.5)을 넘긴다. 데이터셋은 학습이 끝나면 지운다 |

회사 측 실행은 GPU 서버 셸(호스트 `sol-NF5280M6`, 계정 `bim`, 2026-10-20 확인)에서 한다. 서버에는 A40 46,068 MiB 가 3장 있고 SOL RADAR 는 **물리 index 1 한 장**만 쓴다(§3.1). 환경 확인 기록은 [F1 기록](evidence/kev-train-feasibility.md) §0 이다.

## 2. 모델과 자료 출처

### 2.1 출처 표 (2026-10-19 확인)

모두 Hugging Face Hub·GitHub·PyPI 공개 자료다. 토큰 없이 받는다(gated 아님). 리비전을 고정해 받고, 받은 뒤 sha256 을 대조한다(§2.2).

| 무엇 | 어디서 | 고정 리비전 | 라이선스 | 크기·확인 값 |
|---|---|---|---|---|
| Kev 코드(학습·평가·서빙) | https://github.com/jaredpalmer/kev | `1f04cfa28e6a708485b28a9585010b9e436b776e`(2026-10-15, 2026-10-19 기준 main 최신) | Apache-2.0 | `pip install kev`는 무관한 패키지다. 소스에서 설치한다 |
| Kev-9B 체크포인트(LoRA 어댑터 + pointer head) | https://huggingface.co/jaredpalmer/kev-9b | 태그 `v1.0`. 파일은 main `db029f08`·Kev 1.0 가중치 리비전 `b5d8c18e`와 바이트가 같다 | Apache-2.0 | `adapter_model.safetensors` sha256 `2b2a70cf4ef4440b…`, `head.pt` `8e1dab2c8e3664f6…`, 온도 2.19 |
| Kev 백본 | https://huggingface.co/Qwen/Qwen3.5-9B-Base | `68c46c4b3498877f3ef123c856ecfde50c39f404`(Kev-9B `training_config.json`의 `base_revision`) | Apache-2.0 | 9.65B, BF16 약 19.3 GB. 32층(Gated DeltaNet 24 + full attention 8) |
| Kev replay·회귀 자료 | 저장소 `evals/v7/decision-v7`(manifest·dev·test) + https://huggingface.co/datasets/jaredpalmer/kev-suites `v7/decision-v7/train.jsonl` | dataset `cc4bac803e73112689ec327ffa481c519cbc7a05` | 출처별(manifest `dataset_revisions`: imdb·banking77·ag_news·boolq·multi_nli 등 10개 공개 데이터셋) | `kev.train --suite … --replay N`이 train 분할을 Hub에서 받는다 |
| Qwen 추출 모델 | https://huggingface.co/Qwen/Qwen3.5-9B | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` | Apache-2.0 | 9.65B, BF16 약 19.3 GB. `Qwen3_5ForConditionalGeneration`(비전 인코더 포함). 기본이 thinking 모드 |
| Qwen 학습 도구 | https://github.com/hiyouga/LLaMA-Factory, PyPI `llamafactory` | `0.9.5`(2026-05-30) | Apache-2.0 | 템플릿 `qwen3_5`·`qwen3_5_nothink`가 있다. `transformers>=4.55,<=5.6.0`, `peft 0.18.x` |

쓰지 않는 것:
- `jaredpalmer/kev-9b@v1`: 더 예전 가중치다.
- `Qwen/Qwen3.5-9B-Base`로 추출 SFT: Base는 Kev 백본이다. 추출은 지금 서빙하는 post-trained 모델에서 이어 학습해야 지시 수행 능력을 잃지 않는다.
- QLoRA(4bit): Kev 학습 경로에 없다. Unsloth 문서는 Qwen3.5에서 4bit 학습을 권하지 않는다(양자화 오차가 크다).
- Kev 공식 `skills/kev-finetune`의 Modal 경로: 클라우드 GPU 과금이라 ADR-010 승인 대상이다. 이 문서는 같은 레시피를 회사 GPU에서 `kev.train`으로 직접 돈다.

> [!success] 검증됨 (2026-10-19, Hugging Face API `api/models/*`·`api/models/jaredpalmer/kev-9b/tree/{v1.0,main}`, GitHub API `repos/jaredpalmer/kev`, PyPI `llamafactory`)
> - `jaredpalmer/kev-9b`: 태그 `v1.0`과 `main`의 파일 oid 가 모두 같다. `training_config.json`: `base Qwen/Qwen3.5-9B-Base`, `base_revision 68c46c4b…`, `lora 16`, `head_dim 256`, `lora_targets all`, `lr 2e-05`, `batch 2`, `accum 4`, `dtype bf16`, `weights_dtype fp32`, `checkpointing 1`, `max_state 7552`, `replay 10000`, `suite …/decision-v7`. 학습 환경 기록: torch `2.8.0+cu128`, NVIDIA H200.
> - Kev 저장소 `skills/kev-finetune/`(공식 미세조정 절차): 이어 학습은 init 체크포인트의 학습 인자를 레시피로 쓰고(lr 은 그 값, 상한 5e-5), 1 epoch, 공개 replay 2,000건, calibration 분할로 온도를 맞추고, development 분할로 기준선과 짝 부트스트랩 비교, 공개 `decision-v7` 300건으로 망각을 본다. Qwen3.5 백본은 Gated DeltaNet 커널(`flash-linear-attention==0.5.2`, Hopper 는 `triton>=3.7.1`)이 필요하다.
> - Kev `pyproject.toml`: Python `>=3.12,<3.14`, `torch>=2.6,<2.9`, `transformers>=5.17,<6`, `peft>=0.21`.
> - LLaMA-Factory `v0.9.5` `template.py`에 `qwen3_5`·`qwen3_5_nothink`가 있다. transformers `v5.6.0`에 `models/qwen3_5`가 있다.

### 2.2 받는 법과 무결성 확인

회사 GPU 서버는 밖에서 들어올 수 없다(ADR-025). 서버에서 밖으로(huggingface.co·github.com·pypi.org) 나갈 수 있는지는 확인하지 않았다(§7). 나갈 수 있으면 1안, 없으면 2안이다.

**1안: GPU 서버에서 직접 받는다**

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar     # SOL RADAR 전용 경로(2026-10-20 확인). /data 가용 약 1,011 GB
export HF_HOME=$SOL_WORK/hf                           # 백본 19.3 GB + 체크포인트·캐시. 100 GB 이상 비워 둔다
git clone https://github.com/jaredpalmer/kev.git "$SOL_WORK/kev"
git -C "$SOL_WORK/kev" checkout 1f04cfa28e6a708485b28a9585010b9e436b776e

# hf CLI 는 huggingface_hub 패키지에 있다(§3.2 설치 뒤 venv 의 hf). venv 에 아직 없으면 `uvx --from huggingface_hub hf download …`
hf download jaredpalmer/kev-9b --revision v1.0
hf download Qwen/Qwen3.5-9B-Base --revision 68c46c4b3498877f3ef123c856ecfde50c39f404
hf download jaredpalmer/kev-suites --repo-type dataset \
  --revision cc4bac803e73112689ec327ffa481c519cbc7a05 --include "v7/decision-v7/*"
# Qwen 추출 LoRA 를 할 때만
hf download Qwen/Qwen3.5-9B --revision c202236235762e1c871ad0ccb60c8ee5ba337b9a
```

**2안: 다른 기계에서 받아 반입한다.** 같은 명령을 외부망이 있는 기계에서 돌리고 `$HF_HOME/hub`와 `$SOL_WORK/kev`(+ 파이썬 wheel 묶음 `uv pip download` 결과)를 GPU 서버로 옮긴다. 서버에서는 `export HF_HUB_OFFLINE=1`로 캐시만 쓴다. `kev.train --suite`의 replay 도 같은 리비전이 캐시에 있으면 오프라인으로 읽힌다. Kev 의 Hub 해석은 `huggingface_hub.snapshot_download`(`kev/checkpoint.py`)라 `HF_HOME`·`HF_HUB_OFFLINE` 을 그대로 따른다.

**무결성 확인**(받은 직후, 그리고 서빙 기동 전. `infra/gpu/kev-preflight.sh` 가 같은 값을 대조한다)

```bash
snap=$(ls -d $HF_HOME/hub/models--jaredpalmer--kev-9b/snapshots/*/ | head -1)
sha256sum "$snap/adapter_model.safetensors" "$snap/head.pt"
# 기대(2026-10-20 Hub v1.0 파일을 받아 계산, 173,178,096 B / 8,395,071 B):
#   adapter_model.safetensors 2b2a70cf4ef4440b6c22899e1f72c2f8ea5c6f65b19aa344539b4b8971d1f13d
#   head.pt                   8e1dab2c8e3664f6fee843e0257d57946c25e0210c61901ea77e71761f4244e1
```

레지스트리(`services/ai/models/registry.yaml` 항목 `kev-9b-v1.0`)의 `weights_sha256`·`head_sha256` 은 아직 `null` 이다(회사 운영에서 채운다, ADR-025). 위 값으로 채우는 것은 별도 결정이다. 학습본(우리가 돌려받는 체크포인트)도 같은 방식으로 `weights_sha256`·`head_sha256`를 레지스트리에 적고, 기동 전에 대조한다([[03-AI-PIPELINE|03]] §11). `kev.serve`는 `--run` 경로가 틀리면 오류 없이 `runs/smoke`로 대체하므로 이 대조를 빼지 않는다.

## 3. 학습 환경

### 3.1 GPU와 메모리

> [!success] 확인됨 (2026-10-20, 사용자가 서버 `sol-NF5280M6` 셸에서 실행. 출력 전문은 [F1 기록](evidence/kev-train-feasibility.md) §0)
> NVIDIA A40 **3장**(각 46,068 MiB). 드라이버 580.173.02(CUDA 13.0), CUDA Toolkit 12.8, RAM 약 125 GiB(가용 약 54 GiB), `/data` 가용 약 1,011 GB. GPU 0(4,747 MiB 사용 중)·2(9,240 MiB 사용 중)는 회사 기존 서비스가 쓰고 있어 **쓰지 않는다**. GPU 1(5 MiB 사용 중, Compute Capability 8.6)이 SOL RADAR 학습 전용이다. venv 안에서 `CUDA_VISIBLE_DEVICES=1` 로 torch 2.8.0+cu128 이 A40 을 `cuda:0` 으로 잡고 bf16 지원, 가용 44.16 GiB(총 44.42 GiB) 를 확인했다.

| 물리 GPU index(nvidia-smi) | 총 VRAM | 2026-10-20 사용량 | 정책 |
|---|---:|---:|---|
| 0 | 46,068 MiB | 4,747 MiB | 회사 기존 서비스. 프로세스 종료·모델 이동·설정 변경 금지 |
| 1 | 46,068 MiB | 5 MiB | **SOL RADAR 학습·채점 전용**(F1·F2·F3·E4) |
| 2 | 46,068 MiB | 9,240 MiB | 회사 기존 서비스. 위와 같다 |

바로잡는 것: ① GPU 는 2장이 아니라 3장이다(ADR-027 콜아웃의 "A40×2" 가정 종결). ② 학습에 쓸 수 있는 것은 그중 1장이다. 3장의 VRAM 을 합산해 학습 메모리로 보지 않고, 다중 GPU 학습(`torchrun`)도 하지 않는다. ③ 80 GB GPU·H100·H200 은 없다. ④ nvidia-smi 의 46,068 MiB 와 PyTorch 의 44.42 GiB(`torch.cuda.mem_get_info` 총량, GiB 단위)는 다른 수치다. 예산은 PyTorch 가용 44.16 GiB 를 기준으로 잡고 안전 여유를 둔다(§4.2 F1-D). ⑤ 학습이 되는지는 F1 결과로만 확정한다.

학습 메모리의 기준값은 아래다. A40 에서 잰 값은 아직 없다(F1 §4.2 에서 실측).

| 작업 | 알려진 값 | 출처 |
|---|---|---|
| Kev-9B LoRA 학습(공식 설정: fp32 백본, `max_state 7552`, `batch 2`) | 최대 74.1 GB, H200 1장 2.6시간(그 단계 데이터 기준) | Kev-9B 모델 카드 |
| Kev-9B LoRA 학습(이 실행서 설정: bf16 백본 약 19.3 GB, `--checkpointing 1`, `--batch 1 --accum 8`) | **추정** 30~45 GB. `--max_state` 가 클수록 늘어난다 | 23 §2.4 추정. A40 실측 전 |
| Kev-9B 서빙 | 상주 약 21.9 GB(모델 카드) / 약 17 GB(README) | 문서 불일치, [[03-AI-PIPELINE\|03]] §5.2 |
| `kev.benchmark` 채점(fp32 기본 경로) | 가중치 약 38.6 GB + state 길이에 비례한 작업 메모리(카드: H100 fp32 16k state 가 가중치 위로 4.6 GiB) | Kev-9B 모델 카드. 44 GiB 에 들어가는지 미검증(§4.4) |
| Qwen3.5-9B bf16 LoRA | 약 22 GB(짧은 시퀀스, Unsloth 최적화 기준). 긴 입력(§5.2)은 더 든다 | Unsloth Qwen3.5 문서 |
| Qwen3.5-9B 서빙(vLLM) | 가중치 약 19.3 GB + KV 캐시(`--gpu-memory-utilization`) | 가중치 크기에서 추정 |

- **GPU 1 전용·격리**: 모든 학습·보정·채점 명령은 `export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1` 아래에서 돌린다. 프로세스 안에서 GPU 1 은 `cuda:0` 으로 보인다(정상. `--device cuda` 가 그것을 쓴다). 이 변수는 현재 셸과 자식 프로세스에만 적용되고 SSH 재접속·새 세션에서는 사라지므로, `infra/gpu/kev-preflight.sh`·`infra/gpu/kev-f1.sh` 가 값을 확인하고 없으면 멈춘다. 두 스크립트는 `kill`·`pkill`·`docker compose down` 을 쓰지 않고 GPU 1 에 다른 프로세스가 있으면 종료하지 않고 멈춘다(회사에 확인). `CUDA_VISIBLE_DEVICES` 는 다른 사람의 GPU 1 사용을 막지 못하므로 실행 전후 `nvidia-smi` 로 확인한다.
- 추론 런타임(vLLM Qwen, `kev.serve` v1.0)이 어느 GPU 에 뜨는지는 미확인이다(2026-10-20 사용량으로는 아직 떠 있지 않다). GPU 1 에 뜨면 학습 시간대와 겹치므로 학습 중 내린다(23 §2.4). GPU 0·2 에 올릴 수 있는지는 회사가 정한다. GPU 1 을 다른 회사 작업에 쓸 가능성도 별도 확인 대상이다(16 미결정 22).
- GPU 메모리는 두 값을 함께 적는다. `kev.train` 이 `training_metrics.json` 의 `peak_device_bytes` 로 남기는 `torch.cuda.max_memory_allocated()` 최대값과, `nvidia-smi -i 1 --query-gpu=memory.used --format=csv -l 1` 로 학습 내내 기록한 최대값(할당자 예약분·CUDA 컨텍스트 포함, 안전 여유 판정 기준). `kev-f1.sh` 가 둘 다 기록한다.

### 3.2 Kev 환경

venv 는 이미 있다: `/data/www/ai_workspace/sol-radar/.venv-kev`(Python 3.12.3, torch 2.8.0+cu128, triton 3.4.0, 2026-10-20 확인). **지우거나 다시 만들지 않는다.** 아래는 그 venv 에 Kev 와 커널을 더하는 순서다. 2026-10-20 기준 Kev 설치·커널 실행은 **미실행**이다.

> [!success] 검증됨 (2026-10-20, 고정 커밋 `1f04cfa…` 소스·PyPI 메타데이터·fla 0.5.2 wheel)
> - Kev `pyproject.toml`: `requires-python >=3.12,<3.14`, `torch>=2.6,<2.9`, `transformers>=5.17,<6`, `peft>=0.21`, `numpy>=2.5.3`, `accelerate>=1.15.0`, `datasets>=3.0`, `scikit-learn>=1.9.1`, `pydantic>=2.9`. `flash-linear-attention`·`triton` 은 Kev 의 의존성이 아니라 따로 넣는다(공식 Modal 이미지 `modal_app.py` 와 같다). 3.12.3·torch 2.8.0 은 범위 안이다. PyPI(2026-10-20): transformers 최신 5.20.2, peft 0.21.2, numpy 2.5.4, triton 3.4.0 에 cp312 Linux wheel 있음.
> - torch 2.8.0 은 Linux x86_64 에서 `triton==3.4.0` 을 고정한다(PyPI `requires_dist`). `flash-linear-attention==0.5.2` 는 `fla-core==0.5.2` 와 `transformers>=4.45.0` 만 요구하고 triton 을 끌어오지 않는다(`fla-core[cuda]` 가 `triton>=3.3`). 그래서 fla 를 넣어도 torch·triton 이 바뀌지 않는다.
> - fla 0.5.2 가 triton 3.4.0~3.7.0 을 거부하는 조건은 `fla/ops/common/chunk_o.py` 의 `IS_NVIDIA_HOPPER`(장치 이름 `NVIDIA H*` 또는 Compute Capability 9)일 때뿐이다(fla#640, H20). A40 은 Compute Capability 8.6(Ampere)이라 이 조건에 걸리지 않는다. **A40 에서는 triton 을 3.7.1 로 올리지 않는다**(올리면 torch 의 고정을 깬다). Ampere 에서 커널이 실제로 도는지는 `kev-preflight.sh` 의 Gated DeltaNet smoke(fwd+bwd)로 확인한다.
> - Kev 의 fused 커널(`kev/fused_qwen35.py`)은 `flash-linear-attention==0.5.2` **정확히** 그 버전을 요구한다(다르면 `RuntimeError`, `KEV_FUSED=0` 으로 우회). 학습은 transformers 의 Qwen3.5 모델 경로를 쓰고, fla 가 없으면 transformers 가 느린 참조 구현으로 대체한다.
> - `causal-conv1d` 는 선택이다(DeltaNet short conv 의 CUDA 커널. 없으면 느린 참조 구현). Python 3.12·torch 2.8·cu12 prebuilt wheel 이 GitHub release v1.7.0 에 있다(`causal_conv1d-1.7.0+cu12torch2.8cxx11abiTRUE-cp312-cp312-linux_x86_64.whl`). F1 기본 후보에는 넣지 않고, step 시간이 문제일 때만 따로 검토한다.

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
source "$SOL_WORK/.venv-kev/bin/activate"
python -c "import torch; print(torch.__version__)"                  # 2.8.0+cu128 이어야 한다. 아니면 멈추고 보고

# 1) 설치 계획만 본다. torch·triton 이 바뀌거나 지워지는 줄이 있으면 설치하지 않고 보고한다(uv 가 없으면 pip 로 같은 패키지를 넣고 `pip check`)
uv pip install --python "$SOL_WORK/.venv-kev/bin/python" --dry-run \
  "kev @ file://$SOL_WORK/kev" "flash-linear-attention==0.5.2"
# 2) 계획이 torch 2.8.0+cu128·triton 3.4.0 을 유지하면 설치한다. --no-deps·--force-reinstall 은 쓰지 않는다
uv pip install --python "$SOL_WORK/.venv-kev/bin/python" \
  "kev @ file://$SOL_WORK/kev" "flash-linear-attention==0.5.2"
uv pip check --python "$SOL_WORK/.venv-kev/bin/python"             # 의존성 충돌 0
python -c "import torch, numpy, transformers, peft, fla, kev; print(torch.__version__, numpy.__version__, transformers.__version__, peft.__version__, fla.__version__)"

# 3) F1-A: GPU 1 매핑·bf16·커널 smoke·모델 sha256·데이터 길이까지 한 번에(§4.2)
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
bash infra/gpu/kev-preflight.sh
```

- `kev[serve]`(fastapi·uvicorn·typesafe-sdk)는 학습·채점에 필요 없다. B안(§4.4)으로 `kev.serve` 를 띄울 때만 `"kev[serve] @ file://…"` 로 더한다.
- `uv` 가 서버에 있는지는 미확인이다. 없으면 `"$SOL_WORK/.venv-kev/bin/pip" install "$SOL_WORK/kev" "flash-linear-attention==0.5.2"` 뒤 `pip check` 로 같은 확인을 한다(pip 에는 `--dry-run` 이 있다: `pip install --dry-run …`).
- 설치가 torch 를 다른 빌드(예: cu126·CPU)로 바꾸려 하면 강행하지 않는다. 원인(인덱스·제약)과 대안을 보고한다.
- 이후 명령은 이 venv 에서 `python -m kev.train` 등으로 돌린다. 저장소 스크립트는 `python "$SOL_WORK/kev/scripts/<이름>.py"` 로 부른다.

### 3.3 Qwen 환경 (조건부, §5)

Kev 와 LLaMA-Factory 는 transformers 범위가 겹치지 않는다(Kev `>=5.17`, LLaMA-Factory 0.9.5 `<=5.6.0`). venv 를 따로 만든다.

```bash
uv venv /opt/venv-qwen --python 3.12
source /opt/venv-qwen/bin/activate
uv pip install "llamafactory==0.9.5"
# Qwen3.5 의 linear attention 빠른 경로. 없으면 transformers 가 느린 torch 구현으로 대체한다
uv pip install flash-linear-attention causal-conv1d
python -c "from transformers import AutoConfig; print(AutoConfig.from_pretrained('Qwen/Qwen3.5-9B', revision='c202236235762e1c871ad0ccb60c8ee5ba337b9a').model_type)"   # qwen3_5
```

## 4. Kev-9B LoRA (X6, [[16-DECISIONS|ADR-027]])

순서: X6a 평가셋 → X6b 학습셋 번들·요청서 → **F1** 메모리 검증 → **F2** 학습 → **F3** 보정·E4 평가 → 결과 반영. 일정은 [[12-ROADMAP|12 로드맵]] Critical Path X6 행이 정본이다.

### 4.1 학습 데이터: 무엇을 학습하나

**한 레코드 = state 하나 + 질문 여러 개**다. Kev 가 서빙에서 받는 요청(`POST /v1/systemone`)과 같은 모양에 질문마다 `label`을 붙인다.

```json
{"state": "NOTICE\n- stage: NOTICE; agency: (Korean public agency); ...\nCOMPANY (profile revision 2)\n- technologies: ...",
 "questions": {
   "req.requiredSkills[0].status": {"type": "choice", "instructions": "<v0.2.json 원문>",
     "criteria": {"SATISFIED": "...", "NOT_SATISFIED": "...", "NEEDS_REVIEW": "..."}, "label": "NOT_SATISFIED"},
   "risk.techGap": {"type": "noul", "instructions": "<v0.2.json 원문>", "label": true}}}
```

| 구성 | 어디서 오나 | 규칙 |
|---|---|---|
| 공고 | `live` 모드로 수집한 실제 나라장터 정보화사업 공고·RFP(`is_demo=false`, 첨부 파싱 성공). Supabase·MinIO 에 있다 | 개인정보 마스킹(21 §3.6). fixture `FX-01`~`FX-20`은 넣지 않는다(회귀용) |
| 추출 | train 은 Qwen3.5-9B `/extract` 출력, dev·test 는 사람이 확정한 gold(21 §3.7) | 인용 검증 통과 값만 `KNOWN` |
| 회사 | 가상 기업 원형 6개(`fixtures/eval/companies/*.json`, 21 §3.2)와 항목별 변형(21 §3.3) | 실제 회사 이름·실적은 쓰지 않는다. 원형 하나는 train 에서 뺀다(처음 보는 기업 지표) |
| state | `services/ai/kev`의 state 빌더(서빙과 **같은 코드**), 템플릿 `en.v0.2` | `ko` state 는 E2 평가 전용이다. 해커톤 LoRA 는 `en`만(ADR-027 M3) |
| 질문 | `services/ai/kev/question-sets/v0.2.json`의 `instructions`·`criteria` **원문 그대로** | 서빙과 문구가 다르면 학습 효과가 줄어든다(Kev data-format 문서) |

**어떤 질문에 어떤 라벨을 붙이나**(train)

| 질문 | 라벨 출처 | train 에 넣나 |
|---|---|---|
| `req.{itemId}.status`(`requiredSkills`·`pastPerformance` 분야·`staffing` 역할·사전 코드 없는 `qualifications`) | `CONSTRUCTED`: 같은 공고에 회사 변형 셋(충족·명시적 미충족·정보 부족)을 만들어 라벨을 구성으로 정한다(21 §3.3) | 넣는다. 세 값이 각각 1/3 가까이 되게 변형을 만든다 |
| 같은 항목 중 규칙이 판정하는 명시 조건(금액·건수·사전 코드 자격) | `RULE_SILVER`: 규칙 엔진 결과 | 넣는다(train 만). test 에는 쓰지 않는다 |
| `risk.techGap`·`risk.scale`·`risk.staffing`·`risk.schedule` | 변형이 그 조건을 직접 바꾼 경우만 `CONSTRUCTED`(예: 핵심 기술을 `technologies_complete=true` 목록에서 뺐다 → `risk.techGap=true`) | 구성으로 정해지는 것만 |
| `techFit`·`perfRelevance`·동의어·상위개념 대응 | `HUMAN`만 정답이 된다 | 사람 라벨이 있는 것만. 해커톤 사람 라벨은 test·dev 용이라 train 에는 넣지 않는다(학습하지 않은 질문은 v1.0 행동을 유지한다) |
| v0.1 질문(`mandatoryRisk`·`recommendation`·`needsHumanReview`·`fit`) | — | 넣지 않는다(mock·데모 연속성용) |

- 정보 부족을 미충족으로 배우지 않게 하는 것이 핵심이다. "정보 부족(회사)" 변형은 증빙·필드를 지운 것이고 라벨은 `NEEDS_REVIEW`다(21 §2). 각 선택지가 정답인 비율이 5% 아래로 내려가면 안 된다(Kev data-format 문서).
- 유료 외부 모델(Claude 등)로 라벨 초안을 만들지 않는다(ADR-010 승인 전). 공식 kev-finetune 은 LLM 생성 데이터를 쓰지만 우리는 구성·규칙·사람 라벨만 쓴다.

**규모와 분할**

| 분할 | 크기 | 쓰임 |
|---|---|---|
| train | 1,000 레코드 이상(ADR-027 X6b). 예: train 사업 60개 × 원형 5개 × 변형 3~4개 | F2 학습. Kev 문서 기준 300~600 은 첫 실험, 1,000~3,000 이 실사용 규모다 |
| dev | 10 사업(21 §3.5) | F3 온도 보정. 학습에 넣지 않는다 |
| test | 20 사업 | E1·E4 비교. 학습·보정에 쓰지 않는다 |

- 사업 단위 분할과 유사 문서 병합(21 §3.6)으로 같은 사업이 두 분할에 걸치지 않게 한다. train 에 test·dev 클러스터가 0건인지 번들 manifest 에 적는다.
- 같은 state 에 서로 다른 라벨이 붙은 레코드는 Kev 가 충돌로 버린다. 변형끼리 state 가 한 줄 이상 다른지 내보낼 때 검사한다.

**길이 제한(중요).** `kev.train`의 기본 학습 컨텍스트는 state 384 토큰이다(`kev/model.py` `MAX_STATE`). 우리 state 는 최대 6,000 토큰이다([[03-AI-PIPELINE|03]] §5.6). 그래서 `--max_state`를 반드시 준다. 그보다 긴 레코드는 학습에서 빠지고 로그에 `dropped N of M records that exceed the training context`가 찍힌다. **이 줄의 N이 0이 아니면 학습을 받아들이지 않고** F1 결과에 맞춰 state 를 줄이거나(질문을 나눠 state 를 짧게) `--max_state`를 늘린다.

**번들**: `sol-dataset-{version}.tar` = `manifest.json`(버전·git commit·질문 세트·state 템플릿·마스킹 버전·분할별 개수·파일별 sha256·train 레코드 state 토큰 수 최대값) + `kev/train.en.jsonl`·`kev/dev.en.jsonl`·`kev/test.en.jsonl` + 이 문서의 해당 절. 만드는 명령은 [[21-MODEL-TRAINING|21]] §6(`pnpm dataset:build`(예정) → `sol_eval.export`).

### 4.2 F1 메모리 검증

F1 은 네 단계다(A 환경 사전 검증 → B 최소 메모리 20 step → C 단계적 컨텍스트 증가 → D 측정·합격 판정). 실행은 `infra/gpu/kev-preflight.sh`(F1-A)와 `infra/gpu/kev-f1.sh`(F1-B·C)로 하고, 결과는 [F1 기록](evidence/kev-train-feasibility.md)에 옮긴다. 모든 단계는 물리 GPU 1 만 쓴다(§3.1). 2026-10-20 기준 네 단계 모두 **미실행**이다.

`--init_from jaredpalmer/kev-9b@v1.0` 이면 `--base`·`--base_revision`·`--lora 16`·`--head_dim 256`·`--option_isolation 0`·`--special_embeddings 0` 이 고정이다(`kev/checkpoint.py` `COMPAT_FIELDS` = base·base_revision·lora·head_dim·option_isolation·special_embeddings·weights. 다르면 거부). `--lora_targets all` 은 그 목록에 없지만 어댑터 텐서가 모듈 집합과 하나라도 어긋나면 `_load_adapter_into` 가 거부하므로 v1.0 `training_config.json` 의 값(`all`)을 그대로 준다. `--base` 기본값은 `Qwen/Qwen3-0.6B-Base` 라서 **반드시 준다**. `--weights_dtype` 은 호환 검사 대상이 아니라 바꿀 수 있다. `--init_from` 을 빼고 새 LoRA 를 처음부터 학습하는 변경은 하지 않는다.

**F1-A 환경 사전 검증** — `bash infra/gpu/kev-preflight.sh`(§3.2 끝). 확인 항목: `CUDA_VISIBLE_DEVICES=1`·`CUDA_DEVICE_ORDER=PCI_BUS_ID`, nvidia-smi GPU 1 uuid 와 `cuda:0` uuid 일치, GPU 1 에 다른 프로세스 없음·여유 40,000 MiB 이상, torch 2.8.0+cu128·CUDA·bf16, numpy·transformers·peft 범위, Kev 고정 커밋·`kev.train --help`, fla 0.5.2·triton 3.4.0·Gated DeltaNet 커널 smoke(fwd+bwd, bf16), `kev-9b@v1.0` adapter/head sha256(§2.2 값)·백본·replay 캐시, 학습 데이터 형식(`kev.data.load_records`)·라벨 비율·`--max_state` 1024/2048/4096/6144 별 `dropped` 수, 디스크. 통과하면 `runs/preflight-ok` 를 남기고 `kev-f1.sh` 가 그것을 요구한다.

**F1-B 최소 메모리 테스트** — 기본 후보 한 칸: Kev-9B v1.0 LoRA 이어 학습, bf16, batch 1, accum 8, checkpointing 1, `--max_state 1024`, 20 step. `kev-f1.sh --max_state 1024` 가 아래 명령을 돌리고 `nvidia-smi -i 1 … -l 1` 기록을 함께 남긴다.

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1    # 물리 GPU 1 → 프로세스 안 cuda:0
python -m kev.train \
  --data "$SOL_WORK/sol-dataset-v0.1/kev/train.en.jsonl" \
  --init_from jaredpalmer/kev-9b@v1.0 \
  --base Qwen/Qwen3.5-9B-Base --base_revision 68c46c4b3498877f3ef123c856ecfde50c39f404 \
  --lora 16 --head_dim 256 --lora_targets all --option_isolation 0 --special_embeddings 0 \
  --device cuda --dtype bf16 --weights_dtype bf16 --checkpointing 1 \
  --batch 1 --accum 8 --max_state 1024 \
  --max_steps 20 --out "$SOL_WORK/runs/f1-ms1024-b1a8" --seed 0 2>&1 | tee "$SOL_WORK/runs/f1-ms1024-b1a8.log"
```

**F1-C 단계적 컨텍스트 증가** — 앞 칸이 PASS 일 때만 다음 칸. OOM 이 나면 더 큰 값을 시도하지 않는다. F1-A 의 `--max_state` 별 `dropped` 표에서 실제 데이터가 다 들어가는 값까지만 올리고 나머지 칸은 생략해도 된다(갈래 ① 번들은 2048 에서 끝날 수 있다, 23 §4.4).

| 순서 | 명령 | 통과 기준 |
|---|---|---|
| 1 | `kev-f1.sh --max_state 1024` | OOM 없음, `dropped 0 of M`, nvidia-smi 최대 ≤ 41,000 MiB, checkpoint 저장 |
| 2 | `kev-f1.sh --max_state 2048` | 같다 |
| 3 | `kev-f1.sh --max_state 4096` | 같다 |
| 4 | `kev-f1.sh --max_state 6144` | 같다(갈래 ② 상한, 03 §5.6) |
| 5(선택) | 통과한 최대 `--max_state` 에서 `--batch 2 --accum 4 --tag b2`(속도) 또는 `--row_budget N --length_sort 1`(긴 state 를 질문 단위로 나눠 pass 당 패딩 토큰 상한) | 들어가면 F2 에 쓴다. 안 들어가면 1×8 |

기대(추정, A40 실측 전): 고정 백본 fp32 약 38.6 GB → bf16 약 19.3 GB. LoRA r16 어댑터(173 MB)·pointer head(8 MB)·AdamW 상태는 합쳐 1 GB 미만. 나머지는 state·branch 길이에 비례하는 활성값이다. `--checkpointing 1` 이 활성값을 줄이고 속도를 낮춘다. `--batch 1 --accum 8` 의 유효 배치 8 은 공식 설정(2×4)과 같다.

**F1-D 측정과 합격 조건** — 칸마다 `kev-f1.sh` 가 `runs/<run>.summary.md` 와 `runs/f1-results.md` 에 적는다: 물리 GPU index(+uuid), PyTorch 버전, Kev git commit, Base model revision, LoRA checkpoint revision(`init_from` 해석 경로·adapter sha256 = `training_config.json` `init_source`), GPU peak VRAM 두 값(`training_metrics.json` `peak_device_bytes` = `torch.cuda.max_memory_allocated`, nvidia-smi `memory.used` 최대), 평균 step 시간(로그 `s/rec` × batch × accum, wall), 학습된 레코드 수(`records_seen`), `dropped` 수, OOM 여부, checkpoint 저장 여부(adapter·head sha256), 로그 경로. 합격은 네 조건 전부다: OOM 없음 · `dropped 0` · nvidia-smi 최대 ≤ 41,000 MiB(46,068 MiB 의 약 89%. GPU 를 전부 쓰도록 계획하지 않는다) · checkpoint 저장. **20 step PASS 만으로 F2 준비 완료라고 적지 않는다.** state 가 잘려 중요한 요구사항이 빠지는 번들(`dropped` > 0, 또는 F1-A 길이 표에서 잘림)은 실패로 보고 원인(긴 `pastPerformance` 목록 등)을 고쳐 번들을 다시 만든 뒤 F2 로 간다. 21 §7 의 데이터 보고 항목(클러스터 수·변형 수·질문 수·라벨 출처 비율·의미 판단 HUMAN 수·요구사항 유형 분포)도 F2 전에 채운다.

F1 이 전부 실패하면 이 순서로 검토하고 결과를 사용자에게 보고한다. ①~⑤ 는 같은 모델·같은 LoRA 구조 안의 조정이라 바로 해 본다. ⑥ 이후는 **사용자 승인 대상**이고 자동으로 넘어가지 않는다.

① 불필요하게 긴 state 제거·구조 개선(질문을 나눠 state 를 짧게, `pastPerformance` 상한) ② `--max_state` 축소(F1-A 의 실제 데이터 길이 표 기준) ③ `--batch`·`--row_budget`·`--length_sort` 조정 ④ `--checkpointing 1`·`--weights_dtype bf16` 등 `kev.train --help` 에 있는 메모리 절감 옵션 재확인 ⑤ 같은 모델·같은 LoRA 구조에서 가능한 추가 최적화(`--shared_prefix 1`: 하이브리드 백본에서 레코드의 state 를 한 번만 통과시키고 질문 branch 를 거기서 잇는 공식 옵션. Kev 는 exact 라고 적는다) ⑥ **Kev-4B 전환**(`--init_from jaredpalmer/kev-4b@v1.0`, `--base Qwen/Qwen3.5-4B-Base --base_revision 1001bb4d826a52d1f399e183466143f4da7b741b`). 9B 실험과 아키텍처·성능 비교 조건이 달라지므로 사용자 승인 뒤에만 한다(23 §3.3) ⑦ 다중 GPU 학습·클라우드 GPU 임대(ADR-010)·Kev 소스 포크(오프로딩·QLoRA)는 모두 사용자 승인 대상이고, GPU 0·2 는 어떤 경우에도 쓰지 않는다. `--init_from` 없이 새 LoRA 를 시작하는 안은 공개 Kev 학습 성과를 잃어 E4 의 뜻이 달라지므로 자동 경로에서 뺐다(사용자가 따로 정할 때만).

같은 F1 시간에 F3 보정 경로(§4.4 1안)도 20 step 체크포인트로 한 번 돌려 본다. 그때 `kev.benchmark` 의 채점 dtype 이 GPU 1 에 들어가는지(§4.4)도 함께 본다.

### 4.3 F2 학습

F1 을 통과한 설정만 쓴다. `--max_state`·`--batch`·`--accum`(·`--row_budget`·`--length_sort`)은 F1-D 의 PASS 칸 값이다. F1 값과 다르게 바꾸면 그 근거를 `MODEL_CARD.md` 와 [F1 기록](evidence/kev-train-feasibility.md) §3 에 적는다. 나머지는 공식 kev-finetune 이어 학습 레시피와 같다. 물리 GPU 1 만 쓴다.

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
bash infra/gpu/kev-preflight.sh                                  # 다시 통과해야 시작(GPU 1 점유·데이터·캐시)
nvidia-smi -i 1 --query-gpu=timestamp,memory.used --format=csv -l 5 > "$SOL_WORK/runs/kev-9b-sol-lora-v0.1.nvidia-smi.csv" &
SAMPLER=$!                                                       # 끝나면 이 PID 만 멈춘다(kill "$SAMPLER")
python -m kev.train \
  --data "$SOL_WORK/sol-dataset-v0.1/kev/train.en.jsonl" \
  --init_from jaredpalmer/kev-9b@v1.0 \
  --base Qwen/Qwen3.5-9B-Base --base_revision 68c46c4b3498877f3ef123c856ecfde50c39f404 \
  --lora 16 --head_dim 256 --lora_targets all --option_isolation 0 --special_embeddings 0 \
  --suite "$SOL_WORK/kev/evals/v7/decision-v7" --replay 2000 \
  --epochs 1 --lr 2e-5 --p_none_pair 0.25 \
  --device cuda --dtype bf16 --weights_dtype bf16 --checkpointing 1 \
  --batch 1 --accum 8 --max_state <F1 PASS 값> \
  --out "$SOL_WORK/runs/kev-9b-sol-lora-v0.1" --seed 0 2>&1 | tee "$SOL_WORK/runs/kev-9b-sol-lora-v0.1.train.log"
```

- `--suite` 를 줘도 `--base_revision` 은 필수다. `decision-v7` manifest 의 `base_revisions` 에는 Qwen3-0.6B·4B 만 있고 9B 는 없어서, 빼면 `kev.train` 이 "base not pinned by the suite; pass --base_revision" 으로 멈춘다(2026-10-20 소스 확인).
- 예상 시간은 F1 의 step 시간 × F2 step 수(train 레코드 + replay 2,000)/8 로 재추정한다. **실측 전 미확정**이다. 공식 H200 2.6시간은 다른 GPU·다른 데이터 값이라 쓰지 않는다.

- `--replay 2000`: 공개 `decision-v7` train 2,000건을 섞어 일반 능력을 잃지 않게 한다(공식 기본). 데이터가 3,000 레코드를 넘으면 500 으로 줄여도 된다. 0 은 버리는 실험에만 쓴다.
- `--lr 2e-5`: Kev-9B 자신의 이어 학습 lr 이다. 상한 5e-5 를 넘기지 않는다. 망각이 보이면 반으로 줄인다.
- `--epochs 1`: train 이 1,000 레코드를 넘고 1 epoch 끝에도 loss 가 내려가고 있을 때만 2 로 올린다. 올린 뒤에는 평균 확신도가 정확도보다 많이 높아지지 않았는지 본다.
- `--perm_kl 0.1`: 선택지 순서 불변성 손실이다. 공개 Kev 는 쓰지 않았다. 일관성 지표(21 §4.3 선택지 순서)가 나쁠 때만 켠다.
- 받아들이기 전 확인: 로그의 `dropped` 0건, `replay: 2000 of … suite training records mixed with … from …` 줄, loss 가 발산하지 않음.
- 학습마다 `--out` 이름을 새로 짓는다(`v0.2`, `v0.3`). 덮어쓰지 않는다.

### 4.4 F3 보정과 평가

**보정(dev 분할).** 온도는 dev 로만 맞춘다. test 로 맞추지 않는다.

```bash
export SOL_WORK=/data/www/ai_workspace/sol-radar
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1        # 채점·보정도 물리 GPU 1 만
cd "$SOL_WORK"
# 1) dev 를 채점해 rows.json 을 만든다
python -m kev.benchmark --run runs/kev-9b-sol-lora-v0.1 --data sol-dataset-v0.1/kev/dev.en.jsonl --out runs/kev-9b-sol-lora-v0.1-dev
# 2) 온도를 head.pt 에 쓴다(1안)
python "$SOL_WORK/kev/scripts/calibrate_checkpoint.py" --run runs/kev-9b-sol-lora-v0.1 \
  --rows runs/kev-9b-sol-lora-v0.1-dev/rows.json --allow-in-distribution
```

- `calibrate_checkpoint.py`는 학습과 같은 출처의 행을 기본으로 거부한다. 우리 dev 는 같은 출처(실제 공고 × 가상 기업)의 **사업 단위 홀드아웃**이라 `--allow-in-distribution`이 필요하고, 스크립트가 그 사실을 `head.pt`에 기록한다. 공식 kev-finetune 도 사용자 데이터의 calibration 분할로 온도를 맞춘다.
- 스크립트가 행의 출처를 알 수 없다며 거부하면 2안: kev-finetune 과 같은 방법(raw logit, min NLL, micro, `kev.metrics.fit_temperature`)으로 온도 T 를 구해 `--temperature T --reason "sol dev split, min NLL micro"`로 쓴다. 어느 경로였는지 돌려받는 `MODEL_CARD.md`에 적는다.

**평가.** E4 는 E1 과 **같은 test 분할·같은 데이터셋 버전**에서 비교한다(21 §4.2).

```bash
# 같은 셸(CUDA_VISIBLE_DEVICES=1). 모델은 한 번에 하나씩 순서대로 올린다(E4 → E1). 동시에 띄우지 않는다
# test 채점: 학습본과 기준선
python -m kev.benchmark --run runs/kev-9b-sol-lora-v0.1 --data sol-dataset-v0.1/kev/test.en.jsonl --out runs/e4-test --rotations 6
python -m kev.benchmark --run jaredpalmer/kev-9b@v1.0   --data sol-dataset-v0.1/kev/test.en.jsonl --out runs/e1-test --rotations 6
# 짝 부트스트랩(데이터 해시가 같아야 한다. --out 은 필수 인자다)
python -m kev.compare --candidate runs/e4-test --reference runs/e1-test --out runs/e4-vs-e1
# 망각 확인: 공개 decision-v7 development
python -m kev.benchmark --run runs/kev-9b-sol-lora-v0.1 --suite "$SOL_WORK/kev/evals/v7/decision-v7" --out runs/e4-regression
python -m kev.benchmark --run jaredpalmer/kev-9b@v1.0   --suite "$SOL_WORK/kev/evals/v7/decision-v7" --out runs/e1-regression
```

- 우리 쪽 E4 리포트(21 §4.3 지표 전부, 정보부족→미충족 혼동률 포함)는 `sol_eval`이 위 출력 폴더 4개(`rows.json`·`predictions.jsonl`·`report.json`)를 통째로 돌려받아 **오프라인**으로 낸다(ADR-027 10번 개정, [[23-WEEKEND-FINETUNE|23]] §2.2 A안). 엔드포인트에 붙지 않는다. 실행 전에 `report.json`의 체크포인트 id와 test 파일 sha256이 번들 manifest와 같은지 대조한다. 순서 민감도는 `--rotations 6`으로 잰다. 요청당 지연은 E4에서 재지 않는다.
- `report.json` 에 대조할 필드가 있다(2026-10-20 `kev/benchmark.py` 확인): `run`(체크포인트 경로 또는 Hub id), `suite_sha256`(`--data` 파일의 sha256), `rotations`, `split`(`custom`), `calibration_applied`, `environment`(torch·transformers·peft·fla·triton·causal-conv1d 버전, 장치, dtype). E1·E4 의 `environment` 가 같아야 비교가 성립한다.
- 채점 dtype: `kev.benchmark` 의 기본은 fp32 평가 경로(`LoadOptions.from_env`, 공개 수치와 같은 경로)다. 9B fp32 가중치 약 38.6 GB 가 GPU 1 의 44 GiB 에 state 작업 메모리까지 들어가는지는 **미검증**이고 F1 때 dev 채점으로 확인한다. 안 들어가면 E1·E4 **둘 다** 같은 대체 dtype(`KEV_DTYPE=bf16`)으로 채점하고 `report.json` `environment` 와 `MODEL_CARD.md` 에 적는다. 한쪽만 바꾸지 않는다.
- 신뢰구간: 같은 사업에서 파생된 회사 변형·질문은 독립 표본이 아니다. `kev.compare` 의 레코드 단위 부트스트랩 외에 `sol_eval` 이 사업 클러스터 단위 paired bootstrap 을 우선 낸다(21 §4.3). 표본이 작으면 개선을 확정하지 않고 탐색적 결과로 적는다.
- 받아들이는 기준(공식 kev-finetune 기준을 따른다): 망각 확인에서 정확도 하락이 약 2%p 이내, 보정 뒤 확신 오류율(p≥0.9 오답)이 기준선 이하, 평균 확신도가 정확도에서 몇 %p 안. 이 중 하나라도 어기면 결과는 보고하되 서빙 후보로 올리지 않는다.
- "E4 가 E1 보다 낫다"는 Δ의 95% 신뢰구간이 0을 포함하지 않을 때만 말한다(ADR-027 2번).

학습본은 HTTPS 로 서빙하지 않는다(회사 nginx 는 `https://acropolissg.com/sol-radar` location 하나만 등록할 수 있다, ADR-027 10번 개정). 지연·`permute` 실측이 꼭 필요할 때만 B안(23 §2.2): 우리 `infra/gpu/model-router.conf`에 `/kev-lora/` → `127.0.0.1:8010` 블록을 더해 라우터 컨테이너만 다시 띄우고 아래를 띄운다. 회사 nginx 는 손대지 않는다.

```bash
# B안일 때만
KEV_API_KEY="$KEV_API_KEY" python -m kev.serve --run runs/kev-9b-sol-lora-v0.1 --host 127.0.0.1 --port 8010
```

### 4.5 돌려받을 것

| 받는 것 | 내용 |
|---|---|
| 체크포인트 폴더 | `adapter_model.safetensors`·`adapter_config.json`·`head.pt`(온도 포함)·`training_config.json`·토크나이저 파일 |
| 로그 | F1: `runs/preflight-*.log`, `runs/f1-*.summary.md`, `runs/f1-results.md`, `runs/f1-*.log`·`*.nvidia-smi.csv`, 각 run 의 `training_metrics.json`. F2: `train.log`(`dropped`·`replay` 줄 포함), `training_metrics.json`(`peak_device_bytes`·`wall_seconds`), `nvidia-smi` 기록 csv |
| 리포트 | dev 보정 결과(온도, 보정 경로 1안/2안), `kev.benchmark` test·regression `report.json`, `kev.compare` 결과(`runs/e4-vs-e1`) |
| `MODEL_CARD.md` | 데이터셋 버전·sha256, Kev commit, 하이퍼파라미터(F1 값과 다르면 근거), GPU(NVIDIA A40 46,068 MiB, 물리 index 1, 드라이버 580.173.02, torch 2.8.0+cu128), 학습 시간(실측), 채점 dtype |
| sha256 목록 | 어댑터·`head.pt` |

데이터셋 원문은 돌려받지 않는다. 회사는 학습이 끝나면 번들을 지운다. Hugging Face Hub 에 올리지 않는다. 레지스트리 반입과 운영 교체 규칙은 [[21-MODEL-TRAINING|21]] §5.4다.

## 5. Qwen3.5-9B LoRA SFT (조건부)

### 5.1 착수 조건

[[21-MODEL-TRAINING|21]] §5.6 그대로다. 추출 지표(21 §4.3 추출 행)가 목표에 못 미치고, 오류 분석에서 `EXTRACTION` 원인이 주된 것일 때만 검토한다. 사람이 결정하고 ADR 로 남긴다. 해커톤에는 하지 않는다(ADR-027 U1).

### 5.2 학습 데이터: 무엇을 학습하나

**한 레코드 = 추출 호출 한 번**이다. 서빙과 같은 입력에 정답 출력을 붙인다.

| 역할 | 내용 | 규칙 |
|---|---|---|
| system | `services/ai/prompts/req-extract.v0.1.md` 전문 + JSON Schema([[03-AI-PIPELINE\|03]] §4.3) | 서빙과 같은 프롬프트 버전. 바꾸면 학습셋도 새로 만든다 |
| user | gateway 가 조립하는 `<notice …/>` + `<document …>` 본문·첨부 chunk | gateway 의 조립 코드를 **그대로** 불러 만든다. `QWEN_CONTEXT_BUDGET_TOKENS`도 서빙과 같다 |
| assistant | 정답 `RequirementExtraction` JSON(공백 없는 한 줄, 스키마 순서) | 모든 `KNOWN` 값은 인용 검증(15 §5) EXACT·NORMALIZED 통과. 근거 없으면 `UNKNOWN`, 충돌이면 `CONFLICTED` |

```json
{"messages": [
  {"role": "system", "content": "너는 대한민국 공공 입찰 공고에서 요구조건을 추출하는 도구다. ..."},
  {"role": "user", "content": "<notice id=\"...\" .../>\n<document id=\"null\" kind=\"body\">...</document>"},
  {"role": "assistant", "content": "{\"schemaVersion\":\"...\",...}"}]}
```

정답을 어디서 얻나(위가 우선):

| 출처 | 라벨 | 쓰임 |
|---|---|---|
| 사람이 처음부터 만든 gold(`draftedBy=NONE`)와 초안을 사람이 고친 gold(`labelSource=HUMAN`) | 가장 정확하다 | test·dev 는 이것만. train 에는 test·dev 밖 사업의 사람 교정분만 |
| 자동 검증을 통과한 모델 출력(silver) | 회사 GPU 의 Qwen3.5-9B(또는 회사가 올릴 수 있는 더 큰 Apache-2.0 공개 모델)로 같은 입력을 여러 번 추출 → 스키마 통과 + 모든 `KNOWN` 값 인용 통과 + API 구조화 필드(예정가격 `presmptPrce`·마감 `bidClseDt`·면허 `lcnsLmtNm`·지역 `prtcptPsblRgnNm`)와 일치하는 출력만 남긴다 | train 만. 필드 하나라도 걸리면 레코드를 버린다(그 필드만 `UNKNOWN`으로 바꿔 넣지 않는다. 틀린 `UNKNOWN`을 배운다) |
| 유료 외부 모델 초안(`draftedBy=CLAUDE` 등) | — | ADR-010 승인 전에는 쓰지 않는다 |

꼭 넣을 사례:
- 값이 원문에 없어 `UNKNOWN`이어야 하는 필드, 본문과 첨부가 달라 `CONFLICTED`인 필드.
- 첨부 파싱 실패(`ATTACHMENT_PARSE_FAILED`)로 본문만 들어간 입력 — 첨부 내용을 추측하지 않는 출력.
- 문서 안에 지시문이 있는 입력 — 지시를 따르지 않고 추출만 한 출력([[09-SECURITY|09 보안]]).
- 긴 RFP 에서 `mandatory=true` 자격·실적·인력을 끝까지 찾은 출력(필수 항목 재현율).

규모·분할·길이:
- train 300~1,000 레코드(사업 단위), dev 10·test 20 사업은 21 §3.5 와 같은 분할을 쓴다. fixture `FX-01`~`FX-20`은 넣지 않는다.
- 레코드 토큰 수(system + user + assistant)가 `cutoff_len`을 넘으면 정답이 잘린 채 학습된다. 내보낼 때 넘는 레코드를 빼고 개수를 manifest 에 적는다.
- 개인정보 마스킹과 사업 단위 분할은 21 §3.6 그대로다.

번들: `qwen/train.jsonl`·`qwen/dev.jsonl`·`qwen/test.jsonl`과 LLaMA-Factory 등록 파일 `qwen/dataset_info.json`.

```json
{"sol_extract_train": {"file_name": "train.jsonl", "formatting": "sharegpt",
  "columns": {"messages": "messages"},
  "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}}}
```

### 5.3 학습 (LLaMA-Factory)

`sol-qwen-sft.yaml`:

```yaml
### model
model_name_or_path: Qwen/Qwen3.5-9B
model_revision: c202236235762e1c871ad0ccb60c8ee5ba337b9a

### method
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 16
lora_alpha: 32
lora_dropout: 0.05
lora_target: all
freeze_vision_tower: true          # 텍스트만 학습한다
freeze_multi_modal_projector: true

### dataset
dataset: sol_extract_train
dataset_dir: /data/sol-dataset-v0.1/qwen
template: qwen3_5_nothink          # 서빙도 비사고 모드다(03 §4.3)
cutoff_len: 16384                  # F1 처럼 메모리를 보고 정한다. 서빙 컨텍스트 예산 + 출력 4,096 이상
preprocessing_num_workers: 8

### output
output_dir: /data/runs/qwen3.5-9b-sol-extract-lora-v0.1
logging_steps: 10
save_steps: 200
plot_loss: true
report_to: none

### train
per_device_train_batch_size: 1
gradient_accumulation_steps: 8
learning_rate: 1.0e-4
num_train_epochs: 2.0
lr_scheduler_type: cosine
warmup_ratio: 0.05
bf16: true
```

```bash
source /opt/venv-qwen/bin/activate
llamafactory-cli train sol-qwen-sft.yaml
```

- 먼저 `max_steps: 20`을 더해 메모리·step 시간을 잰다(Kev F1 과 같은 방식). OOM 이면 `cutoff_len`을 줄이고, 넘는 레코드를 번들에서 뺀다.
- 값(`lora_rank`·`learning_rate`·`num_train_epochs`)은 LLaMA-Factory 예시(`examples/train_lora/qwen3_lora_sft.yaml`)를 출발점으로 둔 초기값이다. dev 지표로 한 번만 조정하고 test 로는 조정하지 않는다.

### 5.4 병합과 서빙

Qwen3.5(`Qwen3_5ForConditionalGeneration`) 어댑터를 vLLM 에서 LoRA 로 바로 얹는 경로는 확인하지 않았다. 공개 사례 중에는 어댑터 키 경로가 맞지 않아 오류 없이 기본 모델 출력이 나온다는 보고가 있다. 그래서 **가중치를 병합한 전체 모델**을 서빙한다.

`sol-qwen-merge.yaml`:

```yaml
model_name_or_path: Qwen/Qwen3.5-9B
model_revision: c202236235762e1c871ad0ccb60c8ee5ba337b9a
adapter_name_or_path: /data/runs/qwen3.5-9b-sol-extract-lora-v0.1
template: qwen3_5_nothink
export_dir: /data/models/qwen3.5-9b-sol-extract-v0.1
export_size: 5
export_device: cpu
export_legacy_format: false
```

```bash
llamafactory-cli export sol-qwen-merge.yaml
sha256sum /data/models/qwen3.5-9b-sol-extract-v0.1/*.safetensors > qwen-merged.sha256
vllm serve /data/models/qwen3.5-9b-sol-extract-v0.1 --served-model-name qwen3.5-9b-sol-extract-v0.1 \
  --host 127.0.0.1 --port 8001 --api-key "$QWEN_API_KEY"
```

- 병합본에 원본의 `preprocessor_config.json`·`chat_template.jinja`가 있는지 확인한다. 없으면 같은 리비전 원본에서 복사한다.
- vLLM 은 Qwen3.5 를 지원하는 버전이어야 한다(Unsloth 문서: 0.16.0 은 미지원). 지금 데모용 vLLM 과 같은 버전을 쓴다.
- 서빙 교체는 ADR 로 정한다. 교체하면 gateway `QWEN_MODEL`·레지스트리 항목(`weights_sha256` = `qwen-merged.sha256`)을 바꾼다. 추출 재사용 키가 `(model.name, promptHash)`라 기존 추출은 덮어쓰지 않는다([[03-AI-PIPELINE|03]] §4.3).
- 같은 모델이 `translations`와 `/explain`도 맡는다. 병합본으로 바꾸면 그 둘의 시험([[11-TESTING|11 테스트]] V2·AI pytest)도 다시 돈다.

### 5.5 평가 (EX0 · EX1)

- EX0 = `Qwen/Qwen3.5-9B` 원본, EX1 = 병합본. 같은 test 분할에서 21 §4.3 추출 지표(필드 state 정확도·값 일치·필수 항목 재현율·인용 정확도·근거 없는 `KNOWN` 비율)를 사업 단위 짝 부트스트랩 95% 신뢰구간으로 비교한다.
- 회귀: fixture `FX-01`~`FX-20` 추출의 인용 검증 통과율, 인젝션 fixture 의 `INJECTION_SUSPECTED` 유지, JSON 스키마 위반률, 지연 p50·p95.
- 효과는 신뢰구간이 0을 포함하지 않을 때만 주장한다.

## 6. 회사에 넘기는 학습 요청서 (X6b)

보낼 것:
1. 데이터셋 번들 `sol-dataset-{version}.tar`와 sha256. 실제 공고(공공 데이터, 개인정보 마스킹)와 가상 기업만 들어 있다. Supabase 키·서비스키·회사 기밀은 없다.
2. 이 문서 §2~§4(Kev). Qwen 은 착수가 결정됐을 때 §5 를 따로 보낸다.
3. 실행 순서와 받아들이는 기준: F1 격자 → F2 → F3 → test·regression 채점 → 평가 전용 `kev.serve`.

물을 것(C1 P2·P3 요청과 함께, 16 미결정 22). GPU 모델·VRAM·장수는 2026-10-20 서버에서 확인했다(§3.1). 남은 것:
1. 토·일에 물리 GPU 1 을 SOL RADAR 가 독점해도 되는지(다른 회사 작업이 GPU 1 을 쓸 가능성)와 학습 시간대.
2. 데모 추론 런타임(vLLM Qwen, `kev.serve` v1.0)을 어느 GPU 에 띄울 계획인지. GPU 1 이면 학습 중 내린다. GPU 0·2 는 회사 결정이다.
3. GPU 서버에서 huggingface.co·github.com·pypi.org 로 나갈 수 있는지(없으면 §2.2 2안).
4. 일요일(10-25)에 서버 안에서 채점 4회(`kev.benchmark` E4·E1 × test·regression)와 `kev.compare`를 돌리고 출력 폴더(`report.json`·`rows.json`·`predictions.jsonl`)를 보내 줄 수 있는지. 라우터·nginx 변경은 요청하지 않는다(23 §8).

돌려받을 것: §4.5.

## 7. 미확인

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| 회사 GPU 사양 | **확인(2026-10-20)**: A40 46,068 MiB ×3, 학습은 물리 GPU 1 한 장(§3.1) | [F1 기록](evidence/kev-train-feasibility.md) §0 |
| 외부망(Hugging Face·GitHub·PyPI)·학습 시간대·GPU 1 공유 가능성·추론 런타임 위치 | 미확인 | §6 요청(16 미결정 22) |
| 모델 라우터·vLLM·`kev.serve` 포트(8080·8001·8009)의 실제 실행 상태 | 미확인(2026-10-20 GPU 사용량으로는 추론 런타임이 아직 없다) | C1 ③ G1·G2 |
| Kev 공식 소스 설치, 학습 의존성 호환(torch 2.8·transformers ≥5.17·peft ≥0.21·numpy), `uv` 설치 여부 | 미실행 | §3.2 `--dry-run` → 설치 → `kev-preflight.sh` |
| Ampere(A40, CC 8.6)에서 `flash-linear-attention 0.5.2` + triton 3.4.0 | 소스 확인: fla 의 triton 3.4~3.7.0 거부는 Hopper 전용(§3.2). A40 에서 실제로 도는지는 미실행 | `kev-preflight.sh` 커널 smoke → F1-B 20 step |
| Kev-9B 체크포인트·Qwen3.5-9B-Base 다운로드와 sha256, Kev 모델 로딩 | 미실행 | §2.2 → `kev-preflight.sh` |
| `--weights_dtype bf16` 의 메모리 절감과 9B 에서 `--max_state 1024~6144` 가 44 GiB 에 들어가는지, 최대 GPU 메모리·step 시간 | 추정(23 §2.4 30~45 GB) | F1-B·C(§4.2) |
| `kev.benchmark` fp32 채점(가중치 약 38.6 GB)이 GPU 1 에 들어가는지 | 미검증 | F1 때 dev 채점. 안 되면 E1·E4 둘 다 `KEV_DTYPE=bf16`(§4.4) |
| `calibrate_checkpoint.py --allow-in-distribution`이 우리 dev 행을 받는지 | 미확인 | F1 때 20 step 체크포인트로(§4.4) |
| Kev-9B 학습 시간(공식 H200 1장 2.6시간은 그 단계 데이터 기준. A40 값은 아니다) | A40 미측정. F1 step 시간으로 재추정하기 전까지 **미확정** | F1 → F2 |
| `kev-suites` 출처별 재배포 조건 | 출처별 상이 | replay 는 회사 내부 학습에만 쓴다. 결과물을 공개하지 않는다 |
| `kev.benchmark` 출력(`rows.json`·`predictions.jsonl`) 스키마가 `sol_eval` 입력으로 충분한지, `--rotations` 가 `permute n_perm=6` 과 같은 뜻인지 | 미확인 | F1 20 step 체크포인트의 dev 채점 출력(10-24, 23 §10) |
| Qwen3.5-9B 를 LLaMA-Factory 0.9.5 로 텍스트만 LoRA SFT, 긴 `cutoff_len` 메모리 | 미실행 | §5.3 20 step |
| vLLM 에서 Qwen3.5 LoRA 어댑터 직접 서빙 | 미확인(오류 없는 실패 보고 있음) | 쓰지 않고 병합본 서빙(§5.4) |
| 지금 gateway 가 Qwen 을 비사고 모드로 부르는지 | 미확인 | C1 ③ G4([[03-AI-PIPELINE\|03]] §4.3) |
| 첨부 원문의 학습 사용 권리 | 미확인 | 법무([[21-MODEL-TRAINING\|21]] §5.5) |

## 관련 문서

- [[21-MODEL-TRAINING|21 모델 학습]] — 데이터셋·라벨·평가 지표·오류 분석·착수 판단·레지스트리 반입
- [[03-AI-PIPELINE|03 AI 파이프라인]] — Qwen 추출 명세·프롬프트, Kev 질문 세트 `kev-qs/v0.2`·state 템플릿, 레지스트리 서빙 검증
- [[16-DECISIONS|16 ADR]] — ADR-010(유료 승인), ADR-025(회사 GPU 엔드포인트), ADR-027(Kev LoRA X6)
- [[12-ROADMAP|12 로드맵]] — X6 일정
- [[10-DEPLOYMENT|10 배포]] — 회사 GPU 추론 엔드포인트·모델 라우터
- [[09-SECURITY|09 보안]] — 데이터 경계·프롬프트 인젝션
- [[15-DATA-CONTRACTS|15 데이터 계약]] — `EvidenceRef`, 인용 검증
