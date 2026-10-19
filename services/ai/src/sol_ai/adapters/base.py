"""어댑터 계약과 실패 예외. 엔드포인트·검증 파이프라인은 이 계약만 보고 공급자(mock·local·hosted)를 모른다."""

from dataclasses import dataclass
from typing import Protocol

from sol_ai.contracts import ExtractRequest, KevRequest


class AdapterError(Exception):
    """어댑터 실패. warnings 는 응답 warnings 에 그대로 더할 코드다(원문·값을 담지 않는다)."""

    def __init__(self, reason: str, warnings: list[str] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.warnings = list(warnings or [])


class ExtractionFailed(AdapterError):
    """모델이 응답했지만 쓸 수 있는 추출이 아니다 → EXTRACTION_FAILED."""


class ModelUnavailable(AdapterError):
    """gateway → Qwen 미접속(연결 거부·timeout·어댑터 없음) → QWEN_UNAVAILABLE."""


class KevUnavailable(AdapterError):
    """gateway → Kev 미접속·timeout·오류 → KEV_UNAVAILABLE."""


@dataclass(frozen=True)
class ModelOutput:
    """모델 응답 원문과 gateway 가 model 블록에 적을 메타데이터."""

    text: str
    extracted_at: str
    latency: int | float
    retries: int = 0


class QwenAdapter(Protocol):
    provider: str
    # GET /health 의 qwen.model. None 이면 쓸 수 있는 Qwen 어댑터가 없다
    model_name: str | None

    def extract(self, request: ExtractRequest) -> ModelOutput: ...


class KevClient(Protocol):
    """Kev 서버 한 대. wire 요청 본문을 받아 wire 응답 본문을 돌려준다."""

    provider: str
    # GET /health 의 kev.modelId. None 이면 쓸 수 있는 Kev 어댑터가 없다
    model_id: str | None
    registry_match: bool | None
    # 이 Kev 가 답하는 질문 세트 버전. 앞의 것이 기본이다
    question_sets: tuple[str, ...]

    def answer(self, wire_request: dict, request: KevRequest) -> dict: ...


@dataclass(frozen=True)
class Adapters:
    provider: str
    qwen: QwenAdapter
    # KEV_ENABLED=false 면 None
    kev: KevClient | None
    # AI_FAULT_INJECT=gateway_down(mock 전용): /extract·/kev·/explain 이 503 AI_UNAVAILABLE
    gateway_down: bool = False
