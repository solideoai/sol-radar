"""모델 레지스트리(services/ai/models/registry.yaml, docs/03 §11). 값을 모르는 항목은 null 이다."""

from dataclasses import dataclass
from pathlib import Path

import yaml

KIND_KEV = "kev"
KIND_QWEN = "qwen"
# 03 §11: Kev GET /v1/models 와 대조하는 필드. 레지스트리 값이 null 이면 대조하지 않는다(필드 이름은 미검증 가정)
KEV_MATCH_FIELDS = ("base", "lora", "temperature")


@dataclass(frozen=True)
class RegistryEntry:
    id: str
    kind: str
    run: str
    match_values: dict[str, object]
    question_set: str | None
    request_model: str | None
    default: bool


@dataclass(frozen=True)
class ModelRegistry:
    entries: tuple[RegistryEntry, ...]

    @classmethod
    def load(cls, path: Path) -> "ModelRegistry":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls(
            tuple(
                RegistryEntry(
                    id=e["id"],
                    kind=e["kind"],
                    run=e["run"],
                    match_values={f: e.get(f) for f in KEV_MATCH_FIELDS if e.get(f) is not None},
                    question_set=e.get("questionSet"),
                    request_model=e.get("requestModel"),
                    default=bool(e.get("default", False)),
                )
                for e in data["entries"]
            )
        )

    def kev(self, entry_id: str) -> RegistryEntry | None:
        return next((e for e in self.entries if e.kind == KIND_KEV and e.id == entry_id), None)

    def qwen_runs(self) -> set[str]:
        return {e.run for e in self.entries if e.kind == KIND_QWEN}

    def qwen_default(self) -> RegistryEntry | None:
        return next((e for e in self.entries if e.kind == KIND_QWEN and e.default), None)
