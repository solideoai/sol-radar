"""어댑터 팩토리. AI_PROVIDER·KEV_ENABLED·AI_FAULT_INJECT 분기는 여기 한 곳에만 둔다.

엔드포인트와 검증 파이프라인은 AI_PROVIDER 를 보지 않는다. 실행 모드 위반(기동 거부)은 이보다 먼저
app.create_app 이 판정한다. local 기동 검사(설정·URL·레지스트리 대조)는 local_setup 이 한다.
"""

import logging

from sol_ai.adapters.base import Adapters
from sol_ai.adapters.local_setup import configure_local
from sol_ai.adapters.mock import FAULT_GATEWAY_DOWN, FAULTS, MockKev, MockQwen
from sol_ai.adapters.unavailable import UnavailableKev, UnavailableQwen
from sol_ai.paths import fixtures_dir
from sol_ai.qualifications import QualificationDictionary
from sol_ai.question_sets import V0_1, QuestionSet
from sol_ai.schema import ExtractionSchema
from sol_ai.settings import Settings

logger = logging.getLogger("sol_ai.adapters")


def build_adapters(
    settings: Settings,
    *,
    provider: str,
    kev_enabled: bool,
    dictionary: QualificationDictionary,
    question_sets: dict[str, QuestionSet],
    schema: ExtractionSchema,
    prompt_hash: str,
) -> Adapters:
    fault = settings.AI_FAULT_INJECT or None
    if provider != "mock" and fault is not None:
        logger.warning("AI_FAULT_INJECT 는 AI_PROVIDER=mock 에서만 유효하다. 무시한다")
        fault = None

    if provider == "mock":
        if fault is not None and fault not in FAULTS:
            logger.warning("AI_FAULT_INJECT 값을 알 수 없어 무시한다(허용: %s)", ", ".join(FAULTS))
            fault = None
        root = fixtures_dir(settings.SOL_FIXTURES_DIR)
        kev = MockKev(root, fault, dictionary, question_sets[V0_1]) if kev_enabled else None
        return Adapters("mock", MockQwen(root, fault), kev, fault == FAULT_GATEWAY_DOWN)

    if provider == "local":
        local = configure_local(
            settings,
            kev_enabled=kev_enabled,
            question_sets=question_sets,
            schema=schema,
            prompt_hash=prompt_hash,
        )
        return Adapters("local", local.qwen, local.kev)

    # hosted: 사용자 승인 전 클라이언트를 구현·호출하지 않는다(ADR-010). mock 으로 바꾸지 않고 미접속으로 끝낸다
    logger.error("AI_PROVIDER=%s 어댑터가 없다. 추출·Kev 는 미접속으로 응답한다", provider)
    kev = UnavailableKev(provider) if kev_enabled else None
    return Adapters(provider, UnavailableQwen(provider), kev)
