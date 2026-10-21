"""모델 로딩·동결·학습 파라미터 집계(ADR-034 7번). torch 가 필요하다.

- 로딩: `AutoModelForCausalLM.from_pretrained(package_dir, trust_remote_code=True, local_files_only=True, dtype=…)`.
  패키지의 `modeling_bosun.py` 가 백본(HF 캐시)·어댑터(`is_trainable=False`)·decision 임베딩을 조립한다.
- 동결: 이름에 `lora_` 가 든 PEFT 파라미터만 `requires_grad=True`. 백본·decision token 임베딩(입·출력 256행)·토크나이저 동결.
- 집계: 공개 r=16 어댑터 기준 392 텐서 · 10,092,544 파라미터와 다르면 중단한다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import torch

EXPECTED_LORA_TENSORS = 392
EXPECTED_LORA_PARAMS = 10_092_544
LORA_NAME_MARKER = "lora_"


class ParameterContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class ParamTally:
    trainable_tensors: int
    trainable_params: int
    frozen_params: int
    total_params: int
    input_embedding_frozen: bool
    output_embedding_frozen: bool

    def to_dict(self) -> dict[str, int | bool]:
        return asdict(self)


def resolve_device(choice: str) -> torch.device:
    if choice == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if choice == "cuda" and not torch.cuda.is_available():
        raise ParameterContractError("--device cuda requested but CUDA is not available")
    return torch.device(choice)


def resolve_dtype(device: torch.device, bf16: bool | None) -> torch.dtype:
    """기본: cuda 는 bf16, cpu 는 fp32. `--bf16/--no-bf16` 으로 강제."""

    if bf16 is None:
        return torch.bfloat16 if device.type == "cuda" else torch.float32
    return torch.bfloat16 if bf16 else torch.float32


def load_bosun(package_dir: Path, *, device: torch.device, dtype: torch.dtype) -> Any:
    """패키지 디렉터리에서 Bosun 을 올린다(네트워크 없이. 백본은 HF 캐시, `HF_HUB_OFFLINE=1` 권장)."""

    from transformers import AutoModelForCausalLM

    if not (package_dir / "config.json").is_file():
        raise ParameterContractError(f"{package_dir} is not a Bosun package (config.json missing)")
    model = AutoModelForCausalLM.from_pretrained(
        str(package_dir),
        trust_remote_code=True,
        local_files_only=True,
        dtype=dtype,
    )
    model.to(device)
    model.eval()
    return model


def freeze_for_lora(model: Any) -> ParamTally:
    """LoRA 파라미터만 학습 대상으로 켠다. 나머지는 모두 동결."""

    trainable_tensors = 0
    trainable_params = 0
    frozen_params = 0
    for name, parameter in model.named_parameters():
        is_lora = LORA_NAME_MARKER in name
        parameter.requires_grad_(is_lora)
        if is_lora:
            trainable_tensors += 1
            trainable_params += parameter.numel()
        else:
            frozen_params += parameter.numel()
    input_weight = model.get_input_embeddings().weight
    output_weight = model.get_output_embeddings().weight
    return ParamTally(
        trainable_tensors=trainable_tensors,
        trainable_params=trainable_params,
        frozen_params=frozen_params,
        total_params=trainable_params + frozen_params,
        input_embedding_frozen=not input_weight.requires_grad,
        output_embedding_frozen=not output_weight.requires_grad,
    )


def assert_expected_tally(tally: ParamTally, *, expect_tensors: int, expect_params: int) -> None:
    if tally.trainable_tensors != expect_tensors or tally.trainable_params != expect_params:
        raise ParameterContractError(
            "trainable LoRA parameters do not match the expected adapter: "
            f"tensors {tally.trainable_tensors} (expected {expect_tensors}), "
            f"params {tally.trainable_params} (expected {expect_params})"
        )
    if not (tally.input_embedding_frozen and tally.output_embedding_frozen):
        raise ParameterContractError("decision token embeddings must stay frozen")


def trainable_parameters(model: Any) -> list[torch.nn.Parameter]:
    return [parameter for parameter in model.parameters() if parameter.requires_grad]


def enable_gradient_checkpointing(model: Any) -> None:
    """백본에 gradient checkpointing 을 켠다. 입력 임베딩이 동결이라 입력 grad 를 요구해 둔다."""

    peft_model = model.model
    peft_model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    peft_model.enable_input_require_grads()


def environment_versions() -> dict[str, str]:
    import peft
    import transformers

    return {
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "peft": peft.__version__,
        "cuda": torch.version.cuda or "none",
    }


def max_memory_mb(device: torch.device) -> float | None:
    if device.type != "cuda":
        return None
    return torch.cuda.max_memory_allocated(device) / (1024 * 1024)
