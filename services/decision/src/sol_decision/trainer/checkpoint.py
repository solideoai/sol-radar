"""학습본 패키지 저장(docs/22 §4.3·§4.5): 원본 HF 레이아웃 그대로 `runs/<name>/` 에 쓴다.

- 복사: `config.json`·`configuration_bosun.py`·`modeling_bosun.py`·`decision_embeddings.safetensors`(동결이라 변경 없음,
  sha256 동일 확인)·`serving.json`·`tokenizer/`.
- 새로 씀: `adapter/`(PEFT `save_pretrained`)·`manifest.json`(원본 형식, `files` sha256 재계산, `base_model`·`base_revision`
  유지, `init_from`·`train` 추가)·`training_metrics.json`·`MODEL_CARD.md`.

모델 객체는 duck typing 으로만 다루므로 torch 를 import 하지 않는다(manifest 재계산은 가짜 파일로 시험한다).
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sol_decision.trainer.data import sha256_file

COPY_FILES = (
    "config.json",
    "configuration_bosun.py",
    "modeling_bosun.py",
    "decision_embeddings.safetensors",
    "serving.json",
)
COPY_DIRS = ("tokenizer",)
ADAPTER_DIR = "adapter"
ADAPTER_WEIGHTS = "adapter/adapter_model.safetensors"
DECISION_EMBEDDINGS = "decision_embeddings.safetensors"
MANIFEST = "manifest.json"
# manifest `files` 에 넣지 않는 우리 산출물
MANIFEST_EXCLUDED = frozenset(
    {MANIFEST, "training_metrics.json", "MODEL_CARD.md", "calibration.json", "train.log"}
)
# 원본 manifest 의 공개본 성적은 학습본의 성적이 아니라 `init_from` 아래로 옮긴다
SOURCE_ONLY_KEYS = ("metrics", "selected_epoch")


class CheckpointError(RuntimeError):
    pass


def read_manifest(package_dir: Path) -> dict[str, Any]:
    path = package_dir / MANIFEST
    if not path.is_file():
        raise CheckpointError(f"{MANIFEST} not found in {package_dir}")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), dict):
        raise CheckpointError(f"{MANIFEST} must be an object with a 'files' map")
    return manifest


def verify_manifest(package_dir: Path, manifest: Mapping[str, Any]) -> list[str]:
    """manifest `files` 의 sha256 과 실제 파일을 대조해 어긋난 상대 경로를 돌려준다(빈 목록이면 통과)."""

    mismatched: list[str] = []
    for relative, expected in manifest["files"].items():
        path = package_dir / relative
        if not path.is_file() or sha256_file(path) != expected:
            mismatched.append(relative)
    return mismatched


def copy_package_sources(source_dir: Path, out_dir: Path) -> list[str]:
    """동결된 파일을 복사한다. 복사 뒤 sha256 이 원본과 같은지 확인한다."""

    out_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for name in COPY_FILES:
        source = source_dir / name
        if not source.is_file():
            raise CheckpointError(f"source package lacks {name}")
        target = out_dir / name
        shutil.copyfile(source, target)
        if sha256_file(source) != sha256_file(target):
            raise CheckpointError(f"copy of {name} does not match the source")
        copied.append(name)
    for name in COPY_DIRS:
        source = source_dir / name
        if not source.is_dir():
            raise CheckpointError(f"source package lacks {name}/")
        target = out_dir / name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
        copied.extend(sorted(str(path.relative_to(out_dir)) for path in target.rglob("*")))
    return copied


def check_decision_embeddings_unchanged(
    source_dir: Path, out_dir: Path, source_manifest: Mapping[str, Any]
) -> str:
    """decision 임베딩은 동결이라 sha256 이 원본·원본 manifest 와 같아야 한다."""

    digest = sha256_file(out_dir / DECISION_EMBEDDINGS)
    if digest != sha256_file(source_dir / DECISION_EMBEDDINGS):
        raise CheckpointError("decision_embeddings.safetensors differs from the source package")
    expected = source_manifest["files"].get(DECISION_EMBEDDINGS)
    if expected is not None and expected != digest:
        raise CheckpointError("decision_embeddings.safetensors differs from the source manifest")
    return digest


def save_adapter(model: Any, out_dir: Path) -> Path:
    """PEFT 어댑터만 저장한다. PEFT 가 함께 쓰는 README.md 는 원본 레이아웃에 없으므로 지운다.

    `save_embedding_layers=False`: Bosun 은 토큰 임베딩을 resize 하므로 PEFT 기본값 "auto" 가 임베딩 전체를
    어댑터 파일에 끼워 넣을 수 있다. 임베딩은 동결이고 `decision_embeddings.safetensors` 가 따로 있다.
    """

    adapter_dir = out_dir / ADAPTER_DIR
    adapter_dir.mkdir(parents=True, exist_ok=True)
    model.model.save_pretrained(
        str(adapter_dir), safe_serialization=True, save_embedding_layers=False
    )
    readme = adapter_dir / "README.md"
    if readme.exists():
        readme.unlink()
    weights = out_dir / ADAPTER_WEIGHTS
    if not weights.is_file():
        raise CheckpointError("PEFT save_pretrained did not write adapter_model.safetensors")
    return adapter_dir


def package_file_hashes(out_dir: Path) -> dict[str, str]:
    """`files` 재계산: 패키지 안 모든 파일(우리 메타 파일 제외)의 sha256, 경로 정렬."""

    hashes: dict[str, str] = {}
    for path in sorted(out_dir.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(out_dir).as_posix()
        if relative in MANIFEST_EXCLUDED or "__pycache__" in path.parts:
            continue
        hashes[relative] = sha256_file(path)
    return hashes


def build_manifest(
    source_manifest: Mapping[str, Any],
    files: Mapping[str, str],
    *,
    init_from: Mapping[str, Any],
    train: Mapping[str, Any],
) -> dict[str, Any]:
    """원본 형식을 유지하며 `files` 를 바꾸고 `init_from`·`train` 을 더한다."""

    manifest: dict[str, Any] = {
        key: value for key, value in source_manifest.items() if key not in SOURCE_ONLY_KEYS
    }
    for key in ("base_model", "base_revision"):
        if key not in manifest:
            raise CheckpointError(f"source manifest lacks '{key}'")
    source_meta = {key: source_manifest[key] for key in SOURCE_ONLY_KEYS if key in source_manifest}
    manifest["files"] = dict(sorted(files.items()))
    manifest["init_from"] = {**source_meta, **init_from}
    manifest["train"] = dict(train)
    return manifest


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_manifest(
    out_dir: Path,
    source_manifest: Mapping[str, Any],
    *,
    init_from: Mapping[str, Any],
    train: Mapping[str, Any],
) -> dict[str, Any]:
    manifest = build_manifest(
        source_manifest, package_file_hashes(out_dir), init_from=init_from, train=train
    )
    write_json(out_dir / MANIFEST, manifest)
    return manifest


def render_model_card(
    *,
    run_name: str,
    init_from: Mapping[str, Any],
    train: Mapping[str, Any],
    metrics_summary: Mapping[str, Any],
    label_distribution: Mapping[str, Any],
    environment: Mapping[str, Any],
) -> str:
    """MODEL_CARD.md 본문(한국어). 데이터 본문은 넣지 않고 sha256·건수·step·loss·skip 만 적는다."""

    created = datetime.now(UTC).isoformat(timespec="seconds")
    lines = [
        f"# {run_name}",
        "",
        f"- 생성: {created}",
        "- 학습기: `sol_decision.train`(Bosun v3.1 0.6B 공개 LoRA 이어 학습, ADR-034 7번)",
        "- 동결: 백본·decision token 임베딩(입·출력 256행)·토크나이저. 학습: LoRA 파라미터만",
        "- 보정: 미적용. `calibration.json` 은 `sol_decision.trainer.calibrate` 가 dev 로 따로 만든다",
        "",
        "## 출발점",
        "",
    ]
    lines += [f"- {key}: `{value}`" for key, value in init_from.items() if key != "metrics"]
    lines += ["", "## 학습 설정", ""]
    lines += [f"- {key}: `{value}`" for key, value in train.items()]
    lines += ["", "## 결과", ""]
    lines += [f"- {key}: `{value}`" for key, value in metrics_summary.items()]
    lines += [
        "",
        "## 학습 데이터 분포",
        "",
        "```json",
        json.dumps(label_distribution, indent=2),
        "```",
    ]
    lines += ["", "## 환경", ""]
    lines += [f"- {key}: `{value}`" for key, value in environment.items()]
    lines += [
        "",
        "> 성능 주장 없음. E4·E1' 비교는 `sol_eval.bosun_score` 오프라인 채점과 짝 부트스트랩 95% CI 로만 한다(22 §4.4).",
        "> 회사 서버의 `datasets/decision/smoke.jsonl` 6건으로 만든 패키지는 기능 검증용이다.",
        "",
    ]
    return "\n".join(lines)
