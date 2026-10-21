"""패키지 sha256 검증(03 §5.3 기동 검사). 임시 디렉터리에 가짜 manifest·파일을 만든다."""

import hashlib
import json
from pathlib import Path

import pytest

from sol_decision import package

CONFIG = {
    "architectures": ["BosunForDecision"],
    "base_model_name_or_path": "Qwen/Qwen3-0.6B",
    "base_model_revision": "c1899de289a04d12100db370d81485cdf75e47ca",
    "adapter_subfolder": "adapter",
    "decision_embeddings_file": "decision_embeddings.safetensors",
}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_package(
    root: Path, *, files: dict[str, bytes] | None = None, drop_from_manifest=()
) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    files = files or {
        "adapter/adapter_model.safetensors": b"adapter-bytes",
        "adapter/adapter_config.json": b"{}",
        "decision_embeddings.safetensors": b"embedding-bytes",
        "modeling_bosun.py": b"# model",
    }
    config_bytes = json.dumps(CONFIG).encode()
    (root / "config.json").write_bytes(config_bytes)
    manifest_files = {"config.json": _sha(config_bytes)}
    for relative, data in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest_files[relative] = _sha(data)
    for relative in drop_from_manifest:
        manifest_files.pop(relative)
    (root / "manifest.json").write_text(json.dumps({"files": manifest_files}), encoding="utf-8")
    return root


def test_valid_package_builds_identity(tmp_path):
    info = package.verify_package(make_package(tmp_path))
    assert info.lora_sha256 == _sha(b"adapter-bytes")
    assert info.decision_embeddings_sha256 == _sha(b"embedding-bytes")
    identity = package.build_identity(info)
    assert identity.run == package.PUBLIC_RUN
    assert identity.revision == package.PUBLIC_REVISION
    assert identity.base == "Qwen/Qwen3-0.6B@c1899de2"
    assert identity.lora == _sha(b"adapter-bytes")
    assert identity.decision_embeddings_sha256 == _sha(b"embedding-bytes")


def test_identity_overrides_for_trained_package(tmp_path):
    info = package.verify_package(make_package(tmp_path))
    identity = package.build_identity(
        info, run="bosun-sol-lora-v0.1", revision="run-2026-10-25", base="Qwen/Qwen3-0.6B@c1899de2"
    )
    assert identity.run == "bosun-sol-lora-v0.1"
    assert identity.revision == "run-2026-10-25"


def test_tampered_file_is_rejected(tmp_path):
    root = make_package(tmp_path)
    (root / "adapter" / "adapter_model.safetensors").write_bytes(b"adapter-bytez")
    with pytest.raises(package.PackageError) as error:
        package.verify_package(root)
    assert error.value.code == "SHA256_MISMATCH"
    assert error.value.summary == "SHA256_MISMATCH(adapter/adapter_model.safetensors)"
    assert _sha(b"adapter-bytes") not in error.value.summary


def test_missing_file_is_rejected(tmp_path):
    root = make_package(tmp_path)
    (root / "decision_embeddings.safetensors").unlink()
    with pytest.raises(package.PackageError, match="FILE_MISSING"):
        package.verify_package(root)


@pytest.mark.parametrize(
    "dropped", ["adapter/adapter_model.safetensors", "decision_embeddings.safetensors"]
)
def test_required_entries_must_be_in_manifest(tmp_path, dropped):
    root = make_package(tmp_path, drop_from_manifest=(dropped,))
    with pytest.raises(package.PackageError, match="REQUIRED_FILE_NOT_IN_MANIFEST"):
        package.verify_package(root)


def test_missing_manifest_or_config(tmp_path):
    root = make_package(tmp_path)
    (root / "manifest.json").unlink()
    with pytest.raises(package.PackageError, match="MANIFEST_MISSING"):
        package.verify_package(root)
    root = make_package(tmp_path)
    (root / "config.json").unlink()
    with pytest.raises(package.PackageError, match="CONFIG_MISSING"):
        package.verify_package(root)


def test_invalid_manifest_shapes(tmp_path):
    root = make_package(tmp_path)
    (root / "manifest.json").write_text("not json", encoding="utf-8")
    with pytest.raises(package.PackageError, match="MANIFEST_INVALID"):
        package.verify_package(root)
    (root / "manifest.json").write_text(json.dumps({"files": {"a": "short"}}), encoding="utf-8")
    with pytest.raises(package.PackageError, match="MANIFEST_FILES_INVALID"):
        package.verify_package(root)


def test_manifest_path_outside_package_is_rejected(tmp_path):
    root = make_package(tmp_path / "pkg")
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"x")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"]["../outside.bin"] = _sha(b"x")
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(package.PackageError, match="MANIFEST_PATH_OUTSIDE"):
        package.verify_package(root)


def test_missing_directory(tmp_path):
    with pytest.raises(package.PackageError, match="PACKAGE_DIR_MISSING"):
        package.verify_package(tmp_path / "nope")


def test_public_manifest_values_match_constants():
    """공개 manifest.json 의 sha256(docs/03 §5.1)과 상수가 같다."""
    assert package.PUBLIC_LORA_SHA256 == (
        "961d237bc60a88f133bc723dd3cbf1133f743a7fde673cee96d1171c67b425d5"
    )
    assert package.PUBLIC_DECISION_EMBEDDINGS_SHA256 == (
        "88f9e856054f78ac521ba0180052d25720c3786d1db4e80aa7a8ecf39be01188"
    )
