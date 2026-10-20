"""로그에 쓰는 요청 id 다듬기. 제어 문자를 지우고 앞 128자만 남긴다(로그 줄 위조·폭주 방지)."""

import unicodedata

MAX_LOG_ID_CHARS = 128
# 제어(Cc)·서식(Cf)·줄/문단 구분(Zl·Zp) 문자
_DROPPED_CATEGORIES = ("Cc", "Cf", "Zl", "Zp")


def log_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if unicodedata.category(ch) not in _DROPPED_CATEGORIES)
    return cleaned[:MAX_LOG_ID_CHARS]
