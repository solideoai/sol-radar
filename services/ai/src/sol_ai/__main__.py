"""python -m sol_ai: 설정을 검증하고 통과하면 uvicorn 으로 연다. 위반이면 exit 78(EX_CONFIG)."""

import sys

import uvicorn

from sol_ai.app import RunModeError, create_app
from sol_ai.settings import Settings

EX_CONFIG = 78
PORT = 8000


def main() -> int:
    settings = Settings()
    try:
        app = create_app(settings)
    except RunModeError as error:
        # 키 이름과 reason 만 쓴다. 값은 쓰지 않는다.
        print(f"기동 거부: {error.summary}", file=sys.stderr)
        return EX_CONFIG
    uvicorn.run(app, host=settings.AI_HOST, port=PORT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
