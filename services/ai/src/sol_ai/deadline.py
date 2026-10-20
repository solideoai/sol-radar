"""요청 하나의 마감(C5-A S1, e8 확정 2026-10-19). 단조 시계로 "요청 시작 + 예산" 하나를 둔다.

/extract 는 AI_TIMEOUT_MS, /kev 는 KEV_TIMEOUT_MS 를 예산으로 핸들러가 요청마다 만든다. 같은 요청의 모델 호출
(추출 재시도, Kev 레지스트리 지연 대조와 v0.2 묶음)은 이 마감 하나를 나눠 쓴다. 시계는 시험에서 바꿀 수 있게 주입한다.

보장하는 것(R1, 구현은 adapters/http.py): HTTP 호출의 소켓 조작(TCP 연결·TLS 핸드셰이크·읽기·쓰기) 하나하나가
그 순간의 남은 시간만 timeout 으로 쓰고, 남은 시간이 없으면 소켓을 부르지 않는다. 그래서 모델 호출에 쓰는 시간은
예산 + ε(조작 사이의 계산 시간)다. 이름 조회(getaddrinfo)는 timeout 이 없어 이 보장 밖이다(허용 호스트가 회사
엔드포인트와 루프백뿐이라 받아들인다). 요청 본문을 느리게 읽는 서버에서는 쓰기 조각 하나 안의 send 들이 조각 시작
때의 timeout 을 같이 쓴다. 이 보장 위에서 worker 의 시간 제한(KEV+2s·AI+5s)이 gateway 의 소요보다 길다(ADR-031 C6).
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
