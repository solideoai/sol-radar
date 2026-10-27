"""격리 하위 프로세스 진입점. stdin 으로 문서 바이트를 받아 stdout 에 ParseResult JSON 한 개를 쓴다.

gateway(`sol_ai.parse.DocumentParser`)가 요청마다 띄우고, 처리 시간을 넘기면 죽인다.
신뢰하지 않는 문서를 다루므로 환경 변수 없이(`env={}`)·`python -I` 로 돌고, Linux 에서는 주소 공간을 제한한다.
"""

import resource
import sys

from sol_ai.parsers import BY_ID
from sol_ai.parsers.document import Limits, run

# 압축 스트림 폭탄 등으로 메모리가 끝없이 늘지 않게 한다(Linux 만. macOS 는 RLIMIT_AS 를 강제하지 않는다)
MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024


def _limit_memory() -> None:
    if not sys.platform.startswith("linux"):
        return
    try:
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        limit = (
            MEMORY_LIMIT_BYTES if hard == resource.RLIM_INFINITY else min(hard, MEMORY_LIMIT_BYTES)
        )
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ValueError, OSError):
        # 컨테이너가 제한 변경을 막으면 그대로 간다. 부모의 처리 시간 상한은 남는다
        return


def main(adapter_id: str) -> int:
    spec = BY_ID.get(adapter_id)
    if spec is None:
        return 2
    _limit_memory()
    data = sys.stdin.buffer.read()
    result = run(spec.format, spec.parser_id, spec.load(), data, Limits())
    sys.stdout.buffer.write(result.model_dump_json().encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
