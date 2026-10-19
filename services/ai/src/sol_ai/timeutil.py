"""ISO8601 시각 다루기. 오프셋 없는 시각은 받지 않는다(어느 시간대인지 추측하지 않는다)."""

import re
from datetime import UTC, datetime

# RFC 3339 date-time: 날짜·시각·초 필수, 소수 초 선택, Z 또는 ±hh:mm
_DATE_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")


def parse_instant(value: str) -> datetime | None:
    """오프셋이 있는 ISO8601 date-time 이면 datetime, 아니면 None."""
    if not _DATE_TIME.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def is_date_time(value: object) -> bool:
    """JSON Schema format "date-time" 검사. 문자열이 아닌 값은 format 대상이 아니다."""
    return not isinstance(value, str) or parse_instant(value) is not None


def to_utc_z(value: str) -> str:
    """같은 시각을 UTC Z 표기로. 소수 초가 없으면 초까지만 쓴다."""
    instant = parse_instant(value)
    if instant is None:
        raise ValueError("ISO8601 date-time 이 아니다")
    utc = instant.astimezone(UTC)
    text = utc.strftime("%Y-%m-%dT%H:%M:%S")
    if utc.microsecond:
        text += f".{utc.microsecond:06d}".rstrip("0")
    return text + "Z"
