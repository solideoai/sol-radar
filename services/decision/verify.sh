#!/usr/bin/env bash
# services/decision 검증: 린트, 서식, 시험을 차례로 돈다. 모델 의존 검증(실제 Bosun 로딩)은 회사 서버에서만 한다(README).
set -euo pipefail
cd "$(dirname "$0")"
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
