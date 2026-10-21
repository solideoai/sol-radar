"""Vercel ASGI 진입점. 로컬·Compose 진입점(python -m sol_ai)은 그대로 쓴다."""

import os
from pathlib import Path

from sol_ai.app import create_app
from sol_ai.settings import Settings

# Vercel에는 서비스 루트만 배포된다. 빌드 때 복사한 공용 데이터의 경로를 런타임에 정한다.
runtime_data = Path(__file__).resolve().parent / "runtime_data"
if runtime_data.is_dir():
    os.environ.setdefault("SOL_RUN_MODES_FILE", str(runtime_data / "infra" / "run-modes.json"))
    os.environ.setdefault("SOL_FIXTURES_DIR", str(runtime_data / "fixtures"))

app = create_app(Settings())
