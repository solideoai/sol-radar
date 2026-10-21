"""슬롯 손실: `decision_logits(...)[:, :K]` 에 CE(one-hot) 또는 soft-CE(`gold.probabilities` 재배열).

`predict()` 가 `[:K]` 위에서 softmax 하므로 손실도 같은 K 슬롯 위의 log-softmax 다(256 슬롯 전체가 아니다).
배치 안 후보 수가 다르면 각 행의 K 밖 슬롯을 -inf 로 가려 같은 식을 쓴다. torch 가 필요하다.
"""

from __future__ import annotations

from collections.abc import Sequence

import torch
from torch import Tensor


def build_targets(
    slot_targets_per_row: Sequence[Sequence[float]], *, device: torch.device
) -> tuple[Tensor, Tensor]:
    """행별 슬롯 분포를 [B, Kmax] 로 패딩하고, 유효 슬롯 마스크 [B, Kmax] 를 함께 돌려준다."""

    if not slot_targets_per_row:
        raise ValueError("empty batch")
    widest = max(len(targets) for targets in slot_targets_per_row)
    targets = torch.zeros(len(slot_targets_per_row), widest, dtype=torch.float32, device=device)
    mask = torch.zeros(len(slot_targets_per_row), widest, dtype=torch.bool, device=device)
    for row, values in enumerate(slot_targets_per_row):
        count = len(values)
        targets[row, :count] = torch.tensor(values, dtype=torch.float32, device=device)
        mask[row, :count] = True
    return targets, mask


def slot_cross_entropy(slot_logits: Tensor, targets: Tensor, mask: Tensor) -> Tensor:
    """`slot_logits` [B, 256] 의 앞 Kmax 열에 마스크를 씌운 soft cross-entropy(배치 평균, float32)."""

    widest = targets.shape[1]
    if slot_logits.shape[0] != targets.shape[0] or slot_logits.shape[1] < widest:
        raise ValueError("slot_logits must be [B, >=Kmax]")
    logits = slot_logits[:, :widest].float()
    logits = logits.masked_fill(~mask, float("-inf"))
    log_probabilities = torch.log_softmax(logits, dim=-1)
    # 마스크된 슬롯은 target 0 이고 log_prob -inf 라 0 × -inf 를 피하려 명시적으로 0 으로 둔다
    per_slot = torch.where(mask, -(targets * log_probabilities), torch.zeros_like(targets))
    return per_slot.sum(dim=-1).mean()


def slot_probabilities(slot_logits: Tensor, candidate_count: int) -> Tensor:
    """`predict()` 와 같은 식: 앞 K 슬롯 logit 을 float 로 올려 softmax."""

    return torch.softmax(slot_logits[:candidate_count].float(), dim=-1)
