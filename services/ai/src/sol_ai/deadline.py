"""요청 하나의 마감(C5-A S1, e8 확정 2026-10-19). 단조 시계로 "요청 시작 + 예산" 하나를 둔다.

/extract 는 AI_TIMEOUT_MS, /kev 는 KEV_TIMEOUT_MS 를 예산으로 핸들러가 요청마다 만든다. 같은 요청의 모델 호출
(추출 재시도, Kev 레지스트리 지연 대조와 v0.2 묶음)은 이 마감 하나를 나눠 쓴다. 그래야 gateway 의 실제 소요가
worker 의 시간 제한(KEV+2s·AI+5s)보다 짧다(ADR-031 C6). 시계는 시험에서 바꿀 수 있게 주입한다.
"""

import time
from collections.abc import Callable


class Deadline:
    def __init__(self, seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._end = clock() + seconds

    def remaining(self) -> float:
        """남은 초. 마감이 지났으면 0 이하다."""
        return self._end - self._clock()

    def expired(self) -> bool:
        return self.remaining() <= 0
