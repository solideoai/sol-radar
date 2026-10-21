"""Vercel ASGI 진입점. 빌드의 앱 탐색은 모델 접속이나 런타임 설정을 요구하지 않는다."""

from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    from sol_ai.app import create_app
    from sol_ai.settings import Settings

    # 설정·레지스트리·모델 접속 검사는 function 기동 시 기존 gateway와 동일하게 수행한다.
    app.mount("/", create_app(Settings()))
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
