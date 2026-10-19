"""외부 데이터(모델 출력·모델 서버 HTTP 응답)를 읽는 표준 JSON 파서(C5-A S4).

json.loads 는 NaN·Infinity·-Infinity 를 받는다. 표준 JSON(RFC 8259)에는 없는 값이라 거절한다.
fixture·정적 설정 파일은 저장소가 관리하는 값이라 여기를 거치지 않는다.
"""

import json
from typing import Any


def _reject_constant(name: str) -> float:
    raise ValueError(f"표준 JSON 밖 수 {name}")


def loads(text: str) -> Any:
    """표준 JSON 만 읽는다. 못 읽으면 ValueError(json.JSONDecodeError 포함).

    너무 깊게 중첩된 배열·객체(RecursionError)도 읽지 못한 것으로 본다.
    """
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except RecursionError:
        raise ValueError("JSON 중첩이 너무 깊다") from None


def parse_json(text: str) -> Any | None:
    """loads 와 같고, 못 읽으면 None."""
    try:
        return loads(text)
    except ValueError:
        return None
