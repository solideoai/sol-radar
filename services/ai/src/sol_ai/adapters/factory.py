"""어댑터 팩토리. AI_PROVIDER·KEV_ENABLED·AI_FAULT_INJECT 분기는 여기 한 곳에만 둔다.

엔드포인트와 검증 파이프라인은 AI_PROVIDER 를 보지 않는다. 실행 모드 위반(기동 거부)은 이보다 먼저
app.create_app 이 판정한다.
"""

import logging
from pathlib import Path

from sol_ai.adapters.base import Adapters
from sol_ai.adapters.mock import FAULT_GATEWAY_DOWN, FAULTS, MockKev, MockQwen
from sol_ai.adapters.unavailable import UnavailableKev, UnavailableQwen
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import V0_1, QuestionSet

logger = logging.getLogger("sol_ai.adapters")


def build_adapters(
    *,
    provider: str,
    kev_enabled: bool,
    fault: str | None,
    fixtures_root: Path,
    dictionary: QualificationDictionary,
    question_sets: dict[str, QuestionSet],
) -> Adapters:
    if provider == "mock":
        if fault is not None and fault not in FAULTS:
            logger.warning("AI_FAULT_INJECT 값을 알 수 없어 무시한다(허용: %s)", ", ".join(FAULTS))
            fault = None
        kev = (
            MockKev(fixtures_root, fault, dictionary, question_sets[V0_1]) if kev_enabled else None
        )
        return Adapters("mock", MockQwen(fixtures_root, fault), kev, fault == FAULT_GATEWAY_DOWN)

    # local·hosted: 이번 단계에 어댑터가 없다. mock 으로 바꾸지 않고 호출마다 "미접속"으로 끝낸다
    if fault is not None:
        logger.warning("AI_FAULT_INJECT 는 AI_PROVIDER=mock 에서만 유효하다. 무시한다")
    logger.error("AI_PROVIDER=%s 어댑터가 아직 없다. 추출·Kev 는 미접속으로 응답한다", provider)
    kev = UnavailableKev(provider) if kev_enabled else None
    return Adapters(provider, UnavailableQwen(provider), kev, gateway_down=False)
