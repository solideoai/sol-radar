"""정본 공유 자료를 AI 서비스 번들 안에 복사한다. env·평가셋·인력 사진은 포함하지 않는다."""

import shutil
from pathlib import Path


def prepare(repo_root: Path, service_root: Path) -> None:
    destination = service_root / "_vercel_data"
    # 이전 빌드에서 삭제된 fixture가 남지 않게 생성물만 다시 만든다.
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir()
    shutil.copy2(repo_root / "infra" / "run-modes.json", destination / "run-modes.json")
    for name in ("extractions", "kev"):
        shutil.copytree(repo_root / "fixtures" / name, destination / "fixtures" / name)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    prepare(root.parents[1], root)
