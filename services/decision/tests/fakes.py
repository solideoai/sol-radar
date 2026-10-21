"""시험용 백엔드. 제품의 FakeBackend 와 달리 시나리오(id 기반 분포·지연·예외·잘못된 분포)를 흉내 낸다."""

import threading
import time
from collections.abc import Mapping, Sequence
from typing import Any

from sol_decision.backend import ModelIdentity

IDENTITY = ModelIdentity(
    run="test/run@00000000",
    base="test/base@00000000",
    lora="a" * 64,
    revision="0" * 40,
    decision_embeddings_sha256="b" * 64,
)


class ByIdBackend:
    """후보 id 마다 정해진 가중치를 돌려준다(후보 제시 순서와 무관). 모르는 id 는 기본 가중치."""

    name = "by-id"
    device = "cpu"

    def __init__(self, weights: Mapping[str, float], default: float = 0.01) -> None:
        self._weights = dict(weights)
        self._default = default
        self.calls: list[dict[str, Any]] = []

    def predict(
        self,
        *,
        state: Any,
        instructions: str,
        candidates: Sequence[Mapping[str, Any]],
        decision_type: str,
        seed: int,
        row_id: str,
    ) -> list[float]:
        self.calls.append(
            {
                "state": state,
                "instructions": instructions,
                "candidates": [dict(c) for c in candidates],
                "decision_type": decision_type,
                "seed": seed,
                "row_id": row_id,
            }
        )
        return [self._weights.get(str(c["id"]), self._default) for c in candidates]

    def identity(self) -> ModelIdentity:
        return IDENTITY


class ScriptedBackend:
    """predict 마다 미리 정한 리스트를 순서대로 돌려준다(길이·NaN 같은 잘못된 분포 시험)."""

    name = "scripted"
    device = "cpu"

    def __init__(self, outputs: Sequence[Sequence[float]]) -> None:
        self._outputs = [list(o) for o in outputs]

    def predict(self, **_: Any) -> list[float]:
        return self._outputs.pop(0)

    def identity(self) -> ModelIdentity:
        return IDENTITY


class SlowBackend:
    """질문마다 delay 초 멈춘 뒤 균등 분포."""

    name = "slow"
    device = "cpu"

    def __init__(self, delay: float) -> None:
        self._delay = delay

    def predict(self, *, candidates: Sequence[Mapping[str, Any]], **_: Any) -> list[float]:
        time.sleep(self._delay)
        return [1 / len(candidates)] * len(candidates)

    def identity(self) -> ModelIdentity:
        return IDENTITY


class RaisingBackend:
    """predict 가 예외를 낸다. 메시지에 state 조각을 넣어 로그에 새지 않는지 본다."""

    name = "raising"
    device = "cpu"

    def __init__(self, message: str = "boom") -> None:
        self._message = message

    def predict(self, **_: Any) -> list[float]:
        raise RuntimeError(self._message)

    def identity(self) -> ModelIdentity:
        return IDENTITY


class BlockingBackend:
    """predict 가 release 될 때까지 멈춘다(마감을 넘긴 forward·대기열 시험). started 로 들어온 것을 알린다."""

    name = "blocking"
    device = "cpu"

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def predict(self, *, candidates: Sequence[Mapping[str, Any]], **_: Any) -> list[float]:
        self.calls += 1
        self.started.set()
        self.release.wait(10)
        return [1 / len(candidates)] * len(candidates)

    def identity(self) -> ModelIdentity:
        return IDENTITY
