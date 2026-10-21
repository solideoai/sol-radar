"""프롬프트·슬롯: Bosun 모델 모듈의 `render_decision_prompt` 를 **그대로** 호출한다(ADR-034 7번).

- 모델 모듈은 `sys.modules[type(model).__module__]` 로 얻는다(패키지의 `modeling_bosun.py`). 시스템 프롬프트
  상수 `_SYSTEM_PROMPT` 도 그 모듈에서 가져오고 하드코딩하지 않는다.
- chat template 은 `predict()` 와 같은 인자(`tokenize=False`, `add_generation_prompt=True`,
  `enable_thinking=config.decision_prompt_enable_thinking`)로 적용한다.
- `render_decision_prompt` 의 두 번째 반환값은 `presentation_order`(슬롯 → 원래 후보 index)이고,
  세 번째는 `candidate_to_slot`(후보 id → 슬롯)이다. 정답 슬롯 = `candidate_to_slot[gold.candidateId]`.

torch 를 import 하지 않는다(순수 함수는 `tests/test_train_pure.py` 가 시험한다).
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import ModuleType
from typing import Any

from sol_decision.trainer.data import TrainRecord

SYSTEM_PROMPT_ATTR = "_SYSTEM_PROMPT"
RENDER_FUNCTION_ATTR = "render_decision_prompt"


class PromptContractError(RuntimeError):
    """모델 모듈이 기대한 함수·상수를 내놓지 않을 때."""


def model_module(model: Any) -> ModuleType:
    """로드된 모델 클래스가 정의된 모듈(`modeling_bosun`)을 돌려준다."""

    module_name = type(model).__module__
    module = sys.modules.get(module_name)
    if module is None:
        raise PromptContractError(f"model module '{module_name}' is not in sys.modules")
    for attribute in (RENDER_FUNCTION_ATTR, SYSTEM_PROMPT_ATTR):
        if not hasattr(module, attribute):
            raise PromptContractError(f"model module '{module_name}' lacks '{attribute}'")
    return module


@dataclass(frozen=True)
class RenderedPrompt:
    content: str
    prompt: str
    presentation_order: tuple[int, ...]
    candidate_to_slot: dict[str, int]
    gold_slot: int
    slot_targets: tuple[float, ...]


def slot_targets(
    probabilities: Sequence[float],
    candidate_ids: Sequence[str],
    candidate_to_slot: Mapping[str, int],
) -> list[float]:
    """후보 순서의 분포를 제시 슬롯 순서로 재배열한다(soft target)."""

    if len(probabilities) != len(candidate_ids):
        raise ValueError("probabilities and candidate_ids must have the same length")
    targets = [0.0] * len(candidate_ids)
    for candidate_id, probability in zip(candidate_ids, probabilities, strict=True):
        slot = candidate_to_slot[candidate_id]
        if not 0 <= slot < len(targets):
            raise ValueError(f"slot {slot} out of range for {len(targets)} candidates")
        targets[slot] = float(probability)
    return targets


def slot_to_candidate_order(
    slot_values: Sequence[float], presentation_order: Sequence[int]
) -> list[float]:
    """슬롯 순서의 값을 원래 후보 순서로 되돌린다(`predict()` 와 같은 방식)."""

    if len(slot_values) != len(presentation_order):
        raise ValueError("slot_values and presentation_order must have the same length")
    result = [0.0] * len(slot_values)
    for slot, candidate_index in enumerate(presentation_order):
        result[candidate_index] = float(slot_values[slot])
    return result


def check_order_consistency(
    presentation_order: Sequence[int],
    candidate_to_slot: Mapping[str, int],
    candidate_ids: Sequence[str],
) -> None:
    """두 반환값이 서로 맞는지(슬롯 s 의 후보 id 가 candidate_to_slot 에서 s 로 가는지) 확인한다."""

    if sorted(presentation_order) != list(range(len(candidate_ids))):
        raise PromptContractError("presentation_order is not a permutation of candidate indexes")
    for slot, candidate_index in enumerate(presentation_order):
        if candidate_to_slot.get(candidate_ids[candidate_index]) != slot:
            raise PromptContractError("candidate_to_slot disagrees with presentation_order")


def apply_chat_template(tokenizer: Any, model_config: Any, system_prompt: str, content: str) -> str:
    """`predict()` 와 같은 chat template 적용."""

    prompt = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=model_config.decision_prompt_enable_thinking,
    )
    return str(prompt)


def render_record(model: Any, record: TrainRecord, *, seed: int) -> RenderedPrompt:
    """레코드 하나를 Bosun 프롬프트로 만든다. 제시 순서는 `seed:row_id` 로 모델 코드가 섞는다."""

    module = model_module(model)
    render = getattr(module, RENDER_FUNCTION_ATTR)
    system_prompt = getattr(module, SYSTEM_PROMPT_ATTR)
    content, presentation_order, candidate_to_slot = render(
        state=record.state,
        instructions=record.instructions,
        candidates=[candidate.as_mapping() for candidate in record.candidates],
        decision_type=record.question_type,
        decision_tokens=model.decision_tokens,
        seed=seed,
        row_id=record.row_id,
        prompt_schema=model.config.prompt_schema,
    )
    order = tuple(int(index) for index in presentation_order)
    check_order_consistency(order, candidate_to_slot, record.candidate_ids)
    prompt = apply_chat_template(model.tokenizer, model.config, str(system_prompt), content)
    return RenderedPrompt(
        content=content,
        prompt=prompt,
        presentation_order=order,
        candidate_to_slot=dict(candidate_to_slot),
        gold_slot=int(candidate_to_slot[record.gold_candidate_id]),
        slot_targets=tuple(
            slot_targets(record.gold_probabilities, record.candidate_ids, candidate_to_slot)
        ),
    )
