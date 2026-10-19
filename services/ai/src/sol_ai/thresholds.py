"""Kev 임계값 τ 와 보정 상태(services/ai/kev/thresholds.v0.x.json, docs/03 §5.13)."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Thresholds:
    version: str
    status: str
    threshold: float
    dataset_version: str | None

    @classmethod
    def load(cls, path: Path) -> "Thresholds":
        data = json.loads(path.read_text(encoding="utf-8"))
        threshold = data["threshold"]
        if isinstance(threshold, bool) or not isinstance(threshold, int | float):
            raise TypeError(f"{path.name}: threshold 가 숫자가 아니다")
        if not 0 <= threshold <= 1 or data["status"] not in ("UNCALIBRATED", "CALIBRATED"):
            raise ValueError(f"{path.name}: threshold·status 가 범위 밖이다")
        return cls(data["version"], data["status"], threshold, data.get("datasetVersion"))
