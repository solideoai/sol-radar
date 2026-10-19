"""외부 데이터(모델 출력·모델 서버 HTTP 응답)를 읽는 표준 JSON 파서(C5-A S4·R2·R3).

- json.loads 는 NaN·Infinity·-Infinity 를 받는다. 표준 JSON(RFC 8259)에는 없는 값이라 거절한다.
- 1e999 처럼 float 로 넘치는 수(inf·-inf)와, float 로 바꿀 때 넘치는 정수(약 1.8e308 초과)도 거절한다(R2).
  유한한 큰 수(1e308 등)는 받는다. 넘치는 값이 스키마를 지나 직렬화 때 null 이 되거나 float 필드에서 터지지 않게 한다.
- 배열·객체 중첩은 MAX_JSON_DEPTH 단까지만 받는다(R3). 파싱 전에 센다. 깊은 값이 파싱은 되고 응답 직렬화에서
  500 이 되지 않게 한다. 문자열 안의 괄호와 이스케이프(\\")는 세지 않는다.

fixture·정적 설정 파일은 저장소가 관리하는 값이라 여기를 거치지 않는다.
"""

import json
import math
import re
from typing import Any

# 배열·객체 중첩 상한. 괄호 하나가 1단이다(최상위 [] 가 깊이 1)
MAX_JSON_DEPTH = 128

# 깊이를 셀 때 보는 토큰: 닫힌 문자열 하나 | 닫히지 않은 따옴표 | 여는 괄호 | 닫는 괄호.
# 문자열은 한 번에 건너뛴다(안의 괄호·\" 를 세지 않는다). 문자열 패턴은 갈래가 겹치지 않아 길이에 비례해 끝난다
_DEPTH_TOKENS = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"|"|[\[{]|[\]}]', re.DOTALL)


def _reject_constant(name: str) -> float:
    raise ValueError(f"표준 JSON 밖 수 {name}")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("float 로 넘치는 수")
    return value


def _float_safe_int(text: str) -> int:
    value = int(text)
    try:
        float(value)
    except OverflowError:
        raise ValueError("float 로 넘치는 정수") from None
    return value


def _check_depth(text: str) -> None:
    """중첩이 MAX_JSON_DEPTH 를 넘으면 ValueError.

    JSON 이 아닌 글(괄호 짝이 안 맞음·닫히지 않은 문자열)은 여기서 판정하지 않는다. 파서가 거절한다.
    올바른 앞부분까지는 이 셈이 파서의 실제 중첩과 같으므로, 파서가 상한보다 깊이 들어가기 전에 여기서 멈춘다.
    """
    depth = 0
    for token in _DEPTH_TOKENS.finditer(text):
        start = token.start()
        first = text[start]
        if first == '"':
            if token.end() - start == 1:
                # 닫히지 않은 문자열. 뒤는 모두 문자열 안이므로 더 셀 것이 없다
                return
            continue
        if first in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ValueError("JSON 중첩이 너무 깊다")
        else:
            depth -= 1


def loads(text: str) -> Any:
    """표준 JSON 만 읽는다. 못 읽으면 ValueError(json.JSONDecodeError 포함).

    넘치는 수(R2)·상한을 넘는 중첩(R3)도 읽지 못한 것으로 본다. 상한 아래에서 나는 RecursionError 도 같다.
    """
    _check_depth(text)
    try:
        return json.loads(
            text,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
            parse_int=_float_safe_int,
        )
    except RecursionError:
        raise ValueError("JSON 중첩이 너무 깊다") from None


def parse_json(text: str) -> Any | None:
    """loads 와 같고, 못 읽으면 None."""
    try:
        return loads(text)
    except ValueError:
        return None
