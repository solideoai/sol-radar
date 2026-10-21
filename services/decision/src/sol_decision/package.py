"""모델 패키지 디렉터리 검증(docs/03 §5.3·§11 "서빙 검증", ADR-034 3번).

패키지 = Hugging Face snapshot 또는 학습본 run 디렉터리. `manifest.json`(content-addressed, files → sha256)과
`config.json` 을 읽고, manifest 의 모든 파일을 실제 sha256 과 대조한다. 어댑터(`<adapter_subfolder>/adapter_model.safetensors`)와
decision 임베딩(`config.decision_embeddings_file`)은 manifest 에 꼭 있어야 한다. 누락·불일치면 PackageError(기동 거부, exit 78).

ModelIdentity: run·revision·base 는 CLI/env 값, 없으면 config.json(base)·공개 Bosun 값(PUBLIC_*). lora 와
decision_embeddings_sha256 은 실제 파일 sha256 이다(manifest 값과 같음을 대조한 뒤). 학습본 패키지도 같은 코드로 올린다.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sol_decision.backend import ModelIdentity

MANIFEST_FILE = "manifest.json"
CONFIG_FILE = "config.json"
ADAPTER_WEIGHTS = "adapter_model.safetensors"
DEFAULT_ADAPTER_SUBFOLDER = "adapter"
DEFAULT_DECISION_EMBEDDINGS = "decision_embeddings.safetensors"

# 공개 Bosun v3.1 0.6B(docs/03 §5.1, ADR-034 1번). run·base 는 `<repo>@<sha 앞 8자>`, revision 은 전체 sha
PUBLIC_REPO = "Hanno-Labs/bosun-v3.1-0.6b"
PUBLIC_REVISION = "5e78a37c8d86860ebac9ef2d5327d6299498498e"
PUBLIC_RUN = f"{PUBLIC_REPO}@{PUBLIC_REVISION[:8]}"
PUBLIC_BASE_REPO = "Qwen/Qwen3-0.6B"
PUBLIC_BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
PUBLIC_BASE = f"{PUBLIC_BASE_REPO}@{PUBLIC_BASE_REVISION[:8]}"
PUBLIC_LORA_SHA256 = "961d237bc60a88f133bc723dd3cbf1133f743a7fde673cee96d1171c67b425d5"
PUBLIC_DECISION_EMBEDDINGS_SHA256 = (
    "88f9e856054f78ac521ba0180052d25720c3786d1db4e80aa7a8ecf39be01188"
)
PUBLIC_IDENTITY = ModelIdentity(
    run=PUBLIC_RUN,
    base=PUBLIC_BASE,
    lora=PUBLIC_LORA_SHA256,
    revision=PUBLIC_REVISION,
    decision_embeddings_sha256=PUBLIC_DECISION_EMBEDDINGS_SHA256,
)

_CHUNK = 1024 * 1024


class PackageError(Exception):
    """패키지 위반. summary 는 "코드(상대 경로)" 다. 해시 값·비밀은 담지 않는다."""

    def __init__(self, code: str, path: str | None = None) -> None:
        self.code = code
        self.path = path
        self.summary = f"{code}({path})" if path else code
        super().__init__(self.summary)


@dataclass(frozen=True)
class PackageInfo:
    directory: Path
    manifest: dict[str, Any]
    config: dict[str, Any]
    adapter_path: str
    decision_embeddings_path: str
    lora_sha256: str
    decision_embeddings_sha256: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(directory: Path, name: str, missing_code: str, invalid_code: str) -> dict[str, Any]:
    path = directory / name
    if not path.is_file():
        raise PackageError(missing_code, name)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise PackageError(invalid_code, name) from error
    if not isinstance(data, dict):
        raise PackageError(invalid_code, name)
    return data


def _manifest_files(manifest: dict[str, Any]) -> dict[str, str]:
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise PackageError("MANIFEST_FILES_INVALID", MANIFEST_FILE)
    if not all(
        isinstance(k, str) and isinstance(v, str) and len(v) == 64 for k, v in files.items()
    ):
        raise PackageError("MANIFEST_FILES_INVALID", MANIFEST_FILE)
    return files


def _relative_in(directory: Path, relative: str) -> Path:
    """manifest 의 상대 경로가 패키지 밖(../·절대)을 가리키면 거절한다."""
    candidate = (directory / relative).resolve()
    if Path(relative).is_absolute() or directory.resolve() not in candidate.parents:
        raise PackageError("MANIFEST_PATH_OUTSIDE", relative)
    return candidate


def verify_package(directory: Path) -> PackageInfo:
    """manifest·config 를 읽고 모든 파일 sha256 을 대조한다. 위반이면 PackageError."""
    if not directory.is_dir():
        raise PackageError("PACKAGE_DIR_MISSING")
    manifest = _read_json(directory, MANIFEST_FILE, "MANIFEST_MISSING", "MANIFEST_INVALID")
    config = _read_json(directory, CONFIG_FILE, "CONFIG_MISSING", "CONFIG_INVALID")
    files = _manifest_files(manifest)

    adapter_subfolder = config.get("adapter_subfolder", DEFAULT_ADAPTER_SUBFOLDER) or ""
    adapter_path = (
        f"{adapter_subfolder}/{ADAPTER_WEIGHTS}" if adapter_subfolder else ADAPTER_WEIGHTS
    )
    embeddings_path = config.get("decision_embeddings_file", DEFAULT_DECISION_EMBEDDINGS)
    for required in (adapter_path, embeddings_path):
        if required not in files:
            raise PackageError("REQUIRED_FILE_NOT_IN_MANIFEST", required)

    for relative, expected in files.items():
        path = _relative_in(directory, relative)
        if not path.is_file():
            raise PackageError("FILE_MISSING", relative)
        if sha256_file(path) != expected.lower():
            raise PackageError("SHA256_MISMATCH", relative)

    return PackageInfo(
        directory=directory,
        manifest=manifest,
        config=config,
        adapter_path=adapter_path,
        decision_embeddings_path=embeddings_path,
        lora_sha256=files[adapter_path].lower(),
        decision_embeddings_sha256=files[embeddings_path].lower(),
    )


def _base_from_config(config: dict[str, Any]) -> str | None:
    repo = config.get("base_model_name_or_path")
    revision = config.get("base_model_revision")
    if isinstance(repo, str) and repo and isinstance(revision, str) and revision:
        return f"{repo}@{revision[:8]}"
    return None


def build_identity(
    info: PackageInfo,
    *,
    run: str | None = None,
    revision: str | None = None,
    base: str | None = None,
) -> ModelIdentity:
    """검증된 패키지와 CLI/env 값으로 /v1/models 항목을 만든다. 비면 config.json → 공개 Bosun 값."""
    return ModelIdentity(
        run=run or PUBLIC_RUN,
        base=base or _base_from_config(info.config) or PUBLIC_BASE,
        lora=info.lora_sha256,
        revision=revision or PUBLIC_REVISION,
        decision_embeddings_sha256=info.decision_embeddings_sha256,
    )
