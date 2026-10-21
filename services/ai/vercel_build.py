"""Vercel 서비스 번들에 저장소 공용 데이터만 복사한다(Dockerfile과 같은 입력)."""

import shutil
from pathlib import Path


def main() -> None:
    service_root = Path(__file__).resolve().parent
    repository_root = service_root.parents[1]
    destination = service_root / "runtime_data"
    # 빌드 캐시에 삭제된 fixture가 남지 않도록 생성 폴더만 다시 만든다.
    if destination.exists():
        shutil.rmtree(destination)
    (destination / "infra").mkdir(parents=True)
    shutil.copy2(
        repository_root / "infra" / "run-modes.json",
        destination / "infra" / "run-modes.json",
    )
    for directory in ("extractions", "kev"):
        shutil.copytree(
            repository_root / "fixtures" / directory,
            destination / "fixtures" / directory,
        )


if __name__ == "__main__":
    main()
