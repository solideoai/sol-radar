"""어댑터 계약과 실패 예외. 엔드포인트·검증 파이프라인은 이 계약만 보고 공급자(mock·local·hosted)를 모른다."""

from dataclasses import dataclass
from typing import Protocol

from sol_ai.contracts import ExtractRequest, KevRequest
from sol_ai.deadline import Deadline


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
    """모델 응답 원문과 payload.model 에 쓸 값.

    model_block 이 있으면 파이프라인은 그 블록을 그대로 쓴다(mock: fixture 의 model 블록, K13).
    없으면 파이프라인이 공급자·프롬프트 해시와 아래 시각·지연, 자기가 센 재시도로 model 블록을 만든다.
    warnings 는 입력 조립에서 생긴 경고 코드다(예: TRUNCATED_INPUT).
    """

    text: str
    model_block: dict | None = None
    extracted_at: str | None = None
    latency: int | float | None = None
    warnings: tuple[str, ...] = ()


class QwenAdapter(Protocol):
    provider: str
    # GET /health 의 qwen.model·qwen.promptHash. model_name 이 None 이면 쓸 수 있는 Qwen 어댑터가 없다
    model_name: str | None
    prompt_hash: str | None

    def extract(
        self, request: ExtractRequest, retry_note: str | None = None, *, deadline: Deadline
    ) -> ModelOutput:
        """retry_note 가 있으면 재시도 호출이다(03 §4.3: user message 끝에 검증 오류 요약을 붙인다).

        deadline 은 요청 하나의 마감이다. 첫 호출과 재시도가 같은 객체를 받는다(C5-A S1).
        """
        ...


@dataclass(frozen=True)
class KevReply:
    """Kev wire 응답 본문과 응답 헤더의 요청 id(x-typesafe-request-id)."""

    body: dict
    request_id: str | None = None


class KevClient(Protocol):
    """Kev 서버 한 대. wire 요청 본문을 받아 wire 응답 본문을 돌려준다."""

    provider: str
    # GET /health 의 kev.modelId. None 이면 쓸 수 있는 Kev 어댑터가 없다
    model_id: str | None
    # KevAssist.model(local: 레지스트리 run, mock: "mock")
    assist_model: str | None
    # wire 요청 본문의 "model"(local: 레지스트리 requestModel)
    request_model: str
    registry_match: bool | None
    # 이 Kev 가 답하는 질문 세트 버전. 앞의 것이 기본이다
    question_sets: tuple[str, ...]

    def precheck(self) -> None:
        """서버를 부르기 전 판정(mock 의 장애 주입). 실패면 KevUnavailable."""
        ...

    def answer(self, wire_request: dict, request: KevRequest, *, deadline: Deadline) -> KevReply:
        """deadline 은 요청 하나의 마감이다. 레지스트리 지연 대조와 v0.2 묶음 모두가 같은 객체를 받는다(C5-A S1)."""
        ...


@dataclass(frozen=True)
class Adapters:
    provider: str
    qwen: QwenAdapter
    # KEV_ENABLED=false 면 None
    kev: KevClient | None
    # AI_FAULT_INJECT=gateway_down(mock 전용): /extract·/kev·/explain 이 503 AI_UNAVAILABLE
    gateway_down: bool = False
