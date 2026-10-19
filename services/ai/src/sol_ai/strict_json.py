"""외부 데이터(모델 출력·모델 서버 HTTP 응답)를 읽는 표준 JSON 파서(C5-A S4·R2·R3).

- json.loads 는 NaN·Infinity·-Infinity 를 받는다. 표준 JSON(RFC 8259)에는 없는 값이라 거절한다.
- 1e999 처럼 float 로 넘치는 수(inf·-inf)와, float 로 바꿀 때 넘치는 정수(약 1.8e308 초과)도 거절한다(R2).
  유한한 큰 수(1e308 등)는 받는다. 넘치는 값이 스키마를 지나 직렬화 때 null 이 되거나 float 필드에서 터지지 않게 한다.
- 배열·객체 중첩은 MAX_JSON_DEPTH 단까지만 받는다(R3). 파싱 전에 센다. 깊은 값이 파싱은 되고 응답 직렬화에서
  500 이 되지 않게 한다. 문자열 안의 괄호와 이스케이프(\\")는 세지 않는다.
  - 세는 일은 바이트 치환·변환과 누적 합 같은 C 수준 연산으로만 한다(R6). 글자마다 파이썬 반복을 돌지 않아
    4 MiB 에서도 json.loads 시간의 일부로 끝난다.

fixture·정적 설정 파일은 저장소가 관리하는 값이라 여기를 거치지 않는다.
"""

import json
import math
from array import array
from itertools import accumulate
from typing import Any

# 배열·객체 중첩 상한. 괄호 하나가 1단이다(최상위 [] 가 깊이 1)
MAX_JSON_DEPTH = 128

# 깊이를 셀 때 남기는 바이트: 따옴표와 괄호. { } 는 [ ] 로 바꿔 한 종류로 센다(깊이에는 괄호 종류가 상관없다)
_DEPTH_MARKS = b'"[]{}'
_NOT_DEPTH_MARKS = bytes(byte for byte in range(256) if byte not in _DEPTH_MARKS)
_ONE_BRACKET_KIND = bytes.maketrans(b"{}", b"[]")
# 괄호 → 걸음. 여는 괄호 +1, 닫는 괄호 -1(array("b") 에서 0xff 는 -1 이다)
_BRACKET_STEPS = bytes.maketrans(b"[]", b"\x01\xff")
# 벗기기 한 번이 괄호열을 1/_PEEL_MIN_SHRINK 보다 적게 줄이면 벗기기를 멈추고 누적 합으로 센다.
# 이어 가는 벗기기마다 1/4 이상 줄므로 벗기기 전체가 훑는 바이트는 처음 길이의 4 배 이하다. 1/8 로 두면 길이가
# 기하 분포인 사슬 묶음에서 벗기기가 너무 오래 이어졌다(4 MiB 실측: 1/8 약 106ms, 1/4 약 61ms, 벗기기 없이 약 49ms)
_PEEL_MIN_SHRINK = 4


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


def _outside_brackets(text: str) -> bytes:
    """문자열 밖의 괄호만 남긴 바이트(`[`·`]` 두 종류). 닫히지 않은 문자열이 있으면 그 여는 따옴표 앞까지다.

    UTF-8 에서 ASCII 바이트(따옴표·괄호·역슬래시)는 다른 글자의 일부가 되지 않는다. 짝 없는 서로게이트도
    surrogatepass 로 그대로 인코딩한다(json.loads 는 그런 str 도 받는다).
    """
    raw = text.encode("utf-8", "surrogatepass")
    # 이스케이프를 먼저 지운다. 역슬래시 연속에서 \\ 짝을 왼쪽부터 지우면(파서의 짝짓기와 같다) 남는 역슬래시는
    # 바로 뒤 글자를 이스케이프한다. 이어서 \" 를 지우면 남는 따옴표는 모두 문자열 경계다.
    # 다른 글자를 지우기 전에 해야 한다(\n 의 역슬래시가 뒤 따옴표에 붙지 않게)
    raw = raw.replace(b"\\\\", b"").replace(b'\\"', b"")
    marks = raw.translate(_ONE_BRACKET_KIND, _NOT_DEPTH_MARKS)
    # 붙은 따옴표 둘을 지운다. 빈 문자열이거나 괄호 없이 이웃한 두 문자열을 하나로 잇는 것이라 문자열 밖 괄호는
    # 그대로다. 짧은 문자열이 많은 글이 여기서 거의 다 빠진다
    marks = marks.replace(b'""', b"")
    if marks.count(b'"') % 2:
        # 닫히지 않은 문자열. 마지막 따옴표 뒤는 모두 그 문자열 안이라 세지 않는다
        marks = marks[: marks.rindex(b'"')]
    if b'"' in marks:
        # 따옴표로 나눈 조각 가운데 짝수 번째(0·2·4…)가 문자열 밖이다
        marks = b"".join(marks.split(b'"')[::2])
    return marks


def _check_depth(text: str) -> None:
    """중첩이 MAX_JSON_DEPTH 를 넘으면 ValueError.

    문자열 밖의 괄호열(_outside_brackets)에서 깊이를 센다. 최상위 [] 가 깊이 1 이다.
    - 벗기기: 괄호열에서 붙은 [] (안에 다른 괄호가 없는 배열·객체)를 한 번에 모두 지우면 짝이 맞는 괄호열의
      깊이가 정확히 1 준다. 얕고 넓은 글은 몇 번 만에 빈다. 한 번에 줄어드는 몫이 작으면(깊고 가지가 적은 글) 멈춘다.
    - 남은 괄호열은 걸음(+1·-1)의 누적 합 최대로 센다. 깊이 = 벗긴 횟수 + 누적 합 최대.

    표준 JSON 이면 이 셈이 파서의 실제 중첩과 같다. JSON 이 아닌 글(괄호 짝이 안 맞음·닫히지 않은 문자열)은
    여기서 판정하지 않는다. 파서가 거절한다. 그런 글에서도 이 셈은 앞부분의 실제 중첩보다 작지 않다(벗기기 한 번은
    누적 합 최대를 많아야 1 줄인다). 그래서 파서가 상한보다 깊이 들어가기 전에 여기서 멈춘다.
    """
    marks = _outside_brackets(text)
    peeled = 0
    while marks and peeled <= MAX_JSON_DEPTH:
        rest = marks.replace(b"[]", b"")
        if (len(marks) - len(rest)) * _PEEL_MIN_SHRINK < len(marks):
            break
        marks = rest
        peeled += 1
    deepest = max(accumulate(array("b", marks.translate(_BRACKET_STEPS)), initial=0))
    if peeled + deepest > MAX_JSON_DEPTH:
        raise ValueError("JSON 중첩이 너무 깊다")


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
