"""모델 레지스트리(services/ai/models/registry.yaml, docs/03 §11). 값을 모르는 항목은 null 이다.

allowedHosts(C5-A S2, e8 확정 2026-10-19): local 모델 서버 URL 이 가리킬 수 있는 호스트(루프백 밖). 실제로 쓸
호스트와 글자 그대로 같아야 한다. 목록이 아니거나 비었거나 소문자 호스트 문자열이 아닌 항목이 있으면 기동을 거부한다.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

from sol_ai.errors import StartupRefused

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


class RegistryError(StartupRefused):
    """레지스트리 파일 위반. summary 는 "MODEL_REGISTRY(사유)" 뿐이다(경로·값을 담지 않는다)."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"MODEL_REGISTRY({reason})")


def _allowed_hosts(value: object) -> frozenset[str]:
    """문자열 목록이고 비지 않았으며, 항목마다 앞뒤 공백 없는 소문자 문자열이어야 한다."""
    if not isinstance(value, list) or not value:
        raise RegistryError("ALLOWED_HOSTS_INVALID")
    if not all(isinstance(h, str) and h and h == h.strip().lower() for h in value):
        raise RegistryError("ALLOWED_HOSTS_INVALID")
    return frozenset(value)


@dataclass(frozen=True)
class ModelRegistry:
    entries: tuple[RegistryEntry, ...]
    allowed_hosts: frozenset[str]

    @classmethod
    def load(cls, path: Path) -> "ModelRegistry":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise RegistryError("INVALID_FILE")
        allowed_hosts = _allowed_hosts(data.get("allowedHosts"))
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
            ),
            allowed_hosts,
        )

    def kev(self, entry_id: str) -> RegistryEntry | None:
        return next((e for e in self.entries if e.kind == KIND_KEV and e.id == entry_id), None)

    def qwen_runs(self) -> set[str]:
        return {e.run for e in self.entries if e.kind == KIND_QWEN}

    def qwen_default(self) -> RegistryEntry | None:
        return next((e for e in self.entries if e.kind == KIND_QWEN and e.default), None)
