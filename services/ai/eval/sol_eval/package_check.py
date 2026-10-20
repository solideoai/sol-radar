"""Bosun 패키지 디렉터리 검증(services/decision `package.verify_package` 와 같은 규칙의 sol_eval 사본).

`bosun_score --backend bosun` 은 `AutoModelForCausalLM.from_pretrained(trust_remote_code=True)` 로 패키지의
`modeling_bosun.py` 를 실행한다. 그 전에 `manifest.json`(files → sha256)의 모든 파일을 실제 sha256 과 대조하고,
`config.json` 과 최상위 `*.py`(remote code) 가 manifest 에 있는지 본다. 위반이면 PackageVerificationError —
요약은 "코드(상대 경로)" 이고 해시 값은 담지 않는다. sol_eval 은 services/decision 패키지를 import 하지 않으므로
규칙을 여기에 둔다(두 구현의 코드 이름은 같다).
"""

import json
from pathlib import Path
from typing import Any

from sol_eval.manifest import sha256_file

MANIFEST_FILE = "manifest.json"
CONFIG_FILE = "config.json"


class PackageVerificationError(ValueError):
    def __init__(self, code: str, path: str | None = None) -> None:
        self.code = code
        self.path = path
        self.summary = f"{code}({path})" if path else code
        super().__init__(self.summary)


def _manifest_files(directory: Path) -> dict[str, str]:
    path = directory / MANIFEST_FILE
    if not path.is_file():
        raise PackageVerificationError("MANIFEST_MISSING", MANIFEST_FILE)
    try:
        manifest: Any = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise PackageVerificationError("MANIFEST_INVALID", MANIFEST_FILE) from error
    files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(files, dict) or not files:
        raise PackageVerificationError("MANIFEST_FILES_INVALID", MANIFEST_FILE)
    if not all(
        isinstance(k, str) and isinstance(v, str) and len(v) == 64 for k, v in files.items()
    ):
        raise PackageVerificationError("MANIFEST_FILES_INVALID", MANIFEST_FILE)
    return files


def _relative_in(directory: Path, relative: str) -> Path:
    candidate = (directory / relative).resolve()
    if Path(relative).is_absolute() or directory.resolve() not in candidate.parents:
        raise PackageVerificationError("MANIFEST_PATH_OUTSIDE", relative)
    return candidate


def verify_package_dir(directory: Path) -> dict[str, str]:
    """검증을 지나면 manifest 의 files(상대 경로 → sha256)를 돌려준다."""
    if not directory.is_dir():
        raise PackageVerificationError("PACKAGE_DIR_MISSING")
    files = _manifest_files(directory)
    if CONFIG_FILE not in files:
        raise PackageVerificationError("REQUIRED_FILE_NOT_IN_MANIFEST", CONFIG_FILE)
    for script in sorted(path.name for path in directory.glob("*.py")):
        if script not in files:
            raise PackageVerificationError("REMOTE_CODE_NOT_IN_MANIFEST", script)
    for relative, expected in files.items():
        path = _relative_in(directory, relative)
        if not path.is_file():
            raise PackageVerificationError("FILE_MISSING", relative)
        if sha256_file(path) != expected.lower():
            raise PackageVerificationError("SHA256_MISMATCH", relative)
    return files
