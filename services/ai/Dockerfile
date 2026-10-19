# AI gateway 이미지. 빌드 컨텍스트는 저장소 루트다:
#   docker build -f services/ai/Dockerfile -t <태그> .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app/services/ai

# 의존성 층: 소스가 바뀌어도 락파일이 같으면 재사용한다
COPY services/ai/pyproject.toml services/ai/uv.lock services/ai/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY services/ai/src ./src
RUN uv sync --frozen --no-dev

# 실행 모드 규칙 원천(Node 와 공유)
COPY infra/run-modes.json /app/infra/run-modes.json

# venv 의 python 이 PATH 에서 먼저 잡혀야 healthcheck 의 `python -c` 가 의존성을 쓴다
ENV PATH="/app/services/ai/.venv/bin:$PATH" \
    SOL_RUN_MODES_FILE=/app/infra/run-modes.json \
    AI_HOST=0.0.0.0

RUN useradd --system --uid 10001 --no-create-home sol
USER sol

EXPOSE 8000
CMD ["python", "-m", "sol_ai"]
