"""결정 백엔드(docs/03 §5.4, ADR-034 3번).

- DecisionBackend: predict(후보 순서대로의 확률 리스트)·identity(/v1/models 값)·name·device.
- FakeBackend: 결정적 가짜 분포. 시험과 `--backend fake`(wire·인증·마감 점검용) 에 쓴다.
- BosunBackend: 실제 모델. torch·transformers 는 load() 안에서만 import 한다(이 모듈을 import 해도 torch 가 들어오지
  않는다). AutoModelForCausalLM.from_pretrained(package_dir, trust_remote_code=True, local_files_only=True) 로 올리고
  model.predict(...)["probabilities"] 를 쓴다. 다운로드하지 않는다(HF_HUB_OFFLINE=1).
- row_id: sha256(qid + ":" + sha256(state)) 16진. seed 는 설정값(기본 0). 같은 state·qid 면 후보 제시 순서가 같다
  (서빙 결정성).
"""

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

QUESTION_TYPES = ("choice", "score", "noul")


@dataclass(frozen=True)
class ModelIdentity:
    """GET /v1/models 한 항목의 값. 레지스트리(services/ai/models/registry.yaml) 대조 필드(03 §11)."""

    run: str
    base: str
    lora: str
    revision: str
    decision_embeddings_sha256: str
    question_types: tuple[str, ...] = QUESTION_TYPES


class BackendUnavailable(RuntimeError):
    """백엔드를 올릴 수 없다. 메시지는 사유 코드뿐이다."""


class DecisionBackend(Protocol):
    name: str
    device: str

    def predict(
        self,
        *,
        state: Any,
        instructions: str,
        candidates: Sequence[Mapping[str, Any]],
        decision_type: str,
        seed: int,
        row_id: str,
    ) -> Sequence[float]: ...

    def identity(self) -> ModelIdentity: ...


def state_hash(state: Any) -> str:
    """state 의 sha256. 문자열은 그대로, 객체는 canonical JSON 으로."""
    text = (
        state
        if isinstance(state, str)
        else json.dumps(state, sort_keys=True, separators=(",", ":"))
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def row_id_for(qid: str, state: Any) -> str:
    """Bosun predict 의 row_id. sha256(qid + ":" + sha256(state))."""
    return hashlib.sha256(f"{qid}:{state_hash(state)}".encode()).hexdigest()


class FakeBackend:
    """결정적 가짜 분포. row_id·타입·후보 id 로 정해지고 후보 수만큼 돌려준다. 모델이 아니다."""

    name = "fake"
    device = "cpu"

    def __init__(self, identity: ModelIdentity | None = None) -> None:
        self._identity = identity or ModelIdentity(
            run="fake", base="fake", lora="fake", revision="fake", decision_embeddings_sha256="fake"
        )

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
        ids = ":".join(str(candidate["id"]) for candidate in candidates)
        digest = hashlib.sha256(f"{seed}:{row_id}:{decision_type}:{ids}".encode()).digest()
        weights = [1 + digest[index % len(digest)] for index in range(len(candidates))]
        total = sum(weights)
        return [weight / total for weight in weights]

    def identity(self) -> ModelIdentity:
        return self._identity


_DTYPES = {"bf16": "bfloat16", "fp16": "float16", "auto": "auto"}


class BosunBackend:
    """실제 Bosun. load() 전에는 torch 를 import 하지 않는다."""

    name = "bosun"

    def __init__(
        self,
        package_dir: Path,
        identity: ModelIdentity,
        *,
        device: str = "auto",
        dtype: str = "bf16",
    ) -> None:
        if dtype not in _DTYPES:
            raise ValueError("dtype 은 bf16·fp16·auto 중 하나다")
        self._package_dir = package_dir
        self._identity = identity
        self._requested_device = device
        self._dtype = dtype
        self._model: Any = None
        self.device = device

    def load(self) -> "BosunBackend":
        """모델을 올린다. 의존성이 없으면 BackendUnavailable(MODEL_DEPENDENCIES_MISSING)."""
        # 네트워크 다운로드 금지(ADR-034 3번). 로컬 패키지와 캐시만 읽는다
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        try:
            import torch
            from transformers import AutoModelForCausalLM
        except ImportError as error:
            raise BackendUnavailable("MODEL_DEPENDENCIES_MISSING") from error
        device = self._requested_device
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = _DTYPES[self._dtype]
        model = AutoModelForCausalLM.from_pretrained(
            str(self._package_dir),
            trust_remote_code=True,
            local_files_only=True,
            dtype=getattr(torch, dtype) if dtype != "auto" else "auto",
        )
        self._model = model.to(device)
        self.device = device
        return self

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
        if self._model is None:
            raise BackendUnavailable("MODEL_NOT_LOADED")
        result = self._model.predict(
            state=state,
            instructions=instructions,
            candidates=list(candidates),
            decision_type=decision_type,
            seed=seed,
            row_id=row_id,
        )
        return [float(value) for value in result["probabilities"]]

    def identity(self) -> ModelIdentity:
        return self._identity
