"""아직 구현하지 않은 공급자(hosted)의 자리.

조용히 mock 으로 바꾸지 않는다(docs/03 §8). 호출은 "모델 미접속"(QWEN_UNAVAILABLE·KEV_UNAVAILABLE)으로 끝나고,
추출 응답 warnings 에 ADAPTER_NOT_IMPLEMENTED:<provider> 를 달아 이유를 밝힌다.
hosted 는 사용자 승인 전에 클라이언트를 구현·호출하지 않는다(ADR-010).
"""

from sol_ai.adapters.base import KevReply, KevUnavailable, ModelOutput, ModelUnavailable
from sol_ai.contracts import ExtractRequest, KevRequest
from sol_ai.deadline import Deadline


def not_implemented_warning(provider: str) -> str:
    return f"ADAPTER_NOT_IMPLEMENTED:{provider}"


class UnavailableQwen:
    model_name = None
    prompt_hash = None

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def extract(
        self, request: ExtractRequest, retry_note: str | None = None, *, deadline: Deadline
    ) -> ModelOutput:
        raise ModelUnavailable(
            f"{self.provider} Qwen adapter not implemented",
            [not_implemented_warning(self.provider)],
        )


class UnavailableKev:
    model_id = None
    assist_model = None
    request_model = ""
    registry_match = None
    question_sets: tuple[str, ...] = ()

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def precheck(self) -> None:
        raise KevUnavailable(f"{self.provider} Kev adapter not implemented")

    def answer(self, wire_request: dict, request: KevRequest, *, deadline: Deadline) -> KevReply:
        raise KevUnavailable(f"{self.provider} Kev adapter not implemented")
