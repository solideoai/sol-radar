"""python -m sol_decision.serve: 패키지를 검증하고 백엔드를 올린 뒤 uvicorn 으로 연다(docs/03 §5.3, ADR-034 3번).

기동 거부(exit 78, EX_CONFIG): DECISION_API_KEY 없음, 패키지 sha256 불일치·누락, 모델 의존성 없음, 모델 로딩 실패.
stderr 에는 "기동 거부: 코드(상대 경로)" 만 쓴다(값·해시·비밀 없음).
기본 바인딩은 127.0.0.1:8009 다. 0.0.0.0 은 --host 로 명시할 때만.
"""

import argparse
import logging
import sys
from pathlib import Path

import uvicorn

from sol_decision.app import DEFAULT_ALIAS, ServerConfig, create_app
from sol_decision.backend import BackendUnavailable, BosunBackend, DecisionBackend, FakeBackend
from sol_decision.logsafe import error_name
from sol_decision.package import PackageError, build_identity, verify_package
from sol_decision.settings import Settings

EX_CONFIG = 78
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8009


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m sol_decision.serve",
        description="Bosun 결정 모델을 Kev wire 호환 HTTP 로 서빙한다",
    )
    parser.add_argument("--package", type=Path, help="모델 패키지 디렉터리(snapshot 또는 run)")
    parser.add_argument("--alias", default=DEFAULT_ALIAS, help="요청 model 값·/v1/models id")
    parser.add_argument("--backend", choices=("bosun", "fake"), default="bosun")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--dtype", choices=("bf16", "fp16", "auto"), default="bf16")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--seed", type=int, default=0, help="Bosun 후보 제시 순서 seed")
    return parser


def build_backend(args: argparse.Namespace, settings: Settings) -> DecisionBackend:
    """패키지 검증 → identity → 백엔드. 위반은 PackageError·BackendUnavailable 로 올린다."""
    if args.backend == "bosun" and args.package is None:
        raise PackageError("PACKAGE_REQUIRED")
    identity = None
    if args.package is not None:
        info = verify_package(args.package)
        identity = build_identity(
            info,
            run=settings.DECISION_RUN,
            revision=settings.DECISION_REVISION,
            base=settings.DECISION_BASE,
        )
    if args.backend == "fake":
        return FakeBackend(identity)
    assert identity is not None
    return BosunBackend(args.package, identity, device=args.device, dtype=args.dtype).load()


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    settings = Settings()
    try:
        api_key = settings.api_key()
    except ValueError as error:
        print(f"기동 거부: {error}", file=sys.stderr)
        return EX_CONFIG
    try:
        backend = build_backend(args, settings)
    except PackageError as error:
        print(f"기동 거부: PACKAGE {error.summary}", file=sys.stderr)
        return EX_CONFIG
    except BackendUnavailable as error:
        print(f"기동 거부: BACKEND {error}", file=sys.stderr)
        return EX_CONFIG
    except (OSError, ValueError, RuntimeError, ImportError, TypeError, KeyError) as error:
        # 모델 로딩 실패(캐시에 백본 없음·파일 손상·CUDA 오류 등). 종류 이름만 쓴다
        print(f"기동 거부: BACKEND LOAD_FAILED({error_name(error)})", file=sys.stderr)
        return EX_CONFIG
    app = create_app(
        backend,
        ServerConfig(
            api_key=api_key,
            alias=args.alias,
            timeout_ms=settings.DECISION_TIMEOUT_MS,
            seed=args.seed,
            max_queue=settings.DECISION_MAX_QUEUE,
            allow_ko_state=settings.DECISION_ALLOW_KO_STATE,
        ),
    )
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
