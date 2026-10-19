"""아직 구현하지 않은 공급자(local·hosted)의 자리.

조용히 mock 으로 바꾸지 않는다(docs/03 §8). 호출은 "모델 미접속"(QWEN_UNAVAILABLE·KEV_UNAVAILABLE)으로 끝나고,
추출 응답 warnings 에 ADAPTER_NOT_IMPLEMENTED:<provider> 를 달아 이유를 밝힌다.
hosted 는 사용자 승인 전에 클라이언트를 구현·호출하지 않는다(ADR-010).
"""

from sol_ai.adapters.base import KevUnavailable, ModelOutput, ModelUnavailable
from sol_ai.contracts import ExtractRequest, KevRequest


def not_implemented_warning(provider: str) -> str:
    return f"ADAPTER_NOT_IMPLEMENTED:{provider}"


class UnavailableQwen:
    model_name = None
    prompt_hash = None

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def extract(self, request: ExtractRequest) -> ModelOutput:
        raise ModelUnavailable(
            f"{self.provider} Qwen adapter not implemented",
            [not_implemented_warning(self.provider)],
        )


class UnavailableKev:
    model_id = None
    registry_match = None
    question_sets: tuple[str, ...] = ()

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def answer(self, wire_request: dict, request: KevRequest) -> dict:
        raise KevUnavailable(f"{self.provider} Kev adapter not implemented")
