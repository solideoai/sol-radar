"""로그에 남겨도 되는 것만 남긴다.

로그에는 요청 id·질문 수·상태 코드·지연만 쓴다. state 본문·질문 문구·API 키·예외 메시지(모델 라이브러리 메시지에
입력 조각이 실릴 수 있다)는 쓰지 않는다. 예외는 종류 이름만 남긴다.
"""

import logging
import unicodedata

logger = logging.getLogger("sol_decision")

MAX_LOG_ID_CHARS = 128
# 제어(Cc)·서식(Cf)·줄/문단 구분(Zl·Zp) 문자는 지운다(로그 줄 위조 방지)
_DROPPED_CATEGORIES = ("Cc", "Cf", "Zl", "Zp")


def log_id(value: str | None) -> str | None:
    """로그용 id. 제어 문자를 지우고 앞 128자만 남긴다."""
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if unicodedata.category(ch) not in _DROPPED_CATEGORIES)
    return cleaned[:MAX_LOG_ID_CHARS]


def error_name(error: BaseException) -> str:
    """예외의 종류 이름. 메시지는 쓰지 않는다."""
    return type(error).__name__


def log_request(request_id: str, *, questions: int, status: int, latency_ms: int) -> None:
    """요청 하나의 결과 한 줄."""
    logger.info(
        "systemone request_id=%s questions=%d status=%d latency_ms=%d",
        log_id(request_id),
        questions,
        status,
        latency_ms,
    )


def log_failure(request_id: str, *, code: str, error: BaseException | None = None) -> None:
    """실패 한 줄. 오류 코드와 예외 종류 이름만."""
    logger.warning(
        "systemone request_id=%s failed code=%s error=%s",
        log_id(request_id),
        code,
        error_name(error) if error is not None else "-",
    )
