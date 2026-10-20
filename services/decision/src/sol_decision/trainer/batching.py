"""배치 하나의 forward: 렌더 → 토크나이즈(왼쪽 패딩) → `decision_logits` → 슬롯 손실. torch 가 필요하다.

학습(`sol_decision.train`)과 동일성 검사(`sol_decision.parity`)가 같은 함수를 쓴다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import torch
from torch import Tensor

from sol_decision.trainer.data import TrainRecord
from sol_decision.trainer.loss import build_targets, slot_cross_entropy
from sol_decision.trainer.prompting import RenderedPrompt, render_record


def encode_prompts(
    tokenizer: Any, prompts: Sequence[str], device: torch.device
) -> dict[str, Tensor]:
    """`predict()` 와 같은 토크나이즈(`truncation=False`). 여럿이면 왼쪽 패딩 — 마지막 열 attention 이 전부 1 이어야 한다."""

    tokenizer.padding_side = "left"
    encoded = tokenizer(
        list(prompts), return_tensors="pt", padding=len(prompts) > 1, truncation=False
    )
    attention_mask = encoded["attention_mask"]
    if not bool(torch.all(attention_mask[:, -1] == 1)):
        raise RuntimeError("left padding failed: last attention column is not all ones")
    return {key: value.to(device) for key, value in encoded.items()}


@dataclass(frozen=True)
class BatchOutput:
    loss: Tensor
    slot_logits: Tensor
    rendered: tuple[RenderedPrompt, ...]
    prompt_tokens: int


def forward_batch(
    model: Any, records: Sequence[TrainRecord], *, seed: int, device: torch.device
) -> BatchOutput:
    """레코드 묶음의 손실. 제시 순서는 `seed`(에폭마다 바뀜)와 레코드 `rowId` 로 모델 코드가 정한다."""

    rendered = tuple(render_record(model, record, seed=seed) for record in records)
    encoded = encode_prompts(model.tokenizer, [item.prompt for item in rendered], device)
    targets, mask = build_targets([item.slot_targets for item in rendered], device=device)
    slot_logits = model.decision_logits(
        input_ids=encoded["input_ids"], attention_mask=encoded["attention_mask"]
    )
    loss = slot_cross_entropy(slot_logits, targets, mask)
    return BatchOutput(
        loss=loss,
        slot_logits=slot_logits,
        rendered=rendered,
        prompt_tokens=int(encoded["input_ids"].shape[1]),
    )
