#!/usr/bin/env bash
# services/ai 검증: 린트, 서식, 시험을 차례로 돈다.
set -euo pipefail
cd "$(dirname "$0")"
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
