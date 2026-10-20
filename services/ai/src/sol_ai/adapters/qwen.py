"""Qwen local 어댑터(AI_PROVIDER=local, docs/03 §4.3). vLLM OpenAI 호환 POST /v1/chat/completions.

- system: 프롬프트 파일의 {{REQUIREMENT_EXTRACTION_SCHEMA_JSON}} 를 스키마 파일 내용으로 바꾼 것. 데이터는 넣지 않는다.
- user: <notice/> + <document> 블록. 데이터는 <document> 안에만 넣고, 데이터 속 <document·</document·<notice 의
  "<" 는 전각 "＜"(U+FF1C)로 바꾼다(길이가 같고 NFKC 가 "<" 로 되돌려 인용 오프셋에 영향이 없다).
- 응답은 언제나 텍스트 JSON 으로 받아 파이프라인이 파싱·스키마 검증한다. guided JSON(response_format)을 서버가
  거부해도 다른 방식으로 우회하지 않는다.
- 오류: 연결 실패·timeout·마감 초과·응답 과대·3xx·5xx·401·403·404 → ModelUnavailable(QWEN_UNAVAILABLE).
  400·422·내용 없음 → ExtractionFailed.
- 호출은 요청 마감(AI_TIMEOUT_MS, 핸들러가 만든다)의 남은 시간만 쓴다. 재시도도 같은 마감을 나눠 쓴다(C5-A S1).
"""

import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from sol_ai.adapters import http
from sol_ai.adapters.base import ExtractionFailed, ModelOutput, ModelUnavailable
from sol_ai.contracts import Attachment, ExtractRequest
from sol_ai.deadline import Deadline
from sol_ai.strict_json import parse_json

logger = logging.getLogger("sol_ai.qwen")

CHAT_COMPLETIONS = "/v1/chat/completions"
SCHEMA_PLACEHOLDER = "{{REQUIREMENT_EXTRACTION_SCHEMA_JSON}}"
RETRY_NOTE_PREFIX = "\n\n이전 출력은 스키마를 위반했다: "
TRUNCATED_INPUT = "TRUNCATED_INPUT"
# 03 §4.3 추론 설정
INFERENCE = {"temperature": 0, "top_p": 1, "max_tokens": 4096, "seed": 42}
# 미검증 가정(G4): vLLM 이 이 모양의 guided JSON 을 받는지는 실서버 기동 때 확인한다
RESPONSE_FORMAT_NAME = "requirement_extraction"
BAD_REQUEST_STATUSES = frozenset({400, 422})

_TAG_START = re.compile(r"<(?=\s*/?\s*(?:document|notice)\b)", re.IGNORECASE)
FULLWIDTH_LESS_THAN = "＜"


def neutralize(text: str) -> str:
    """데이터 속 프롬프트 구분 태그의 "<" 를 "＜" 로. 길이가 같다."""
    return _TAG_START.sub(FULLWIDTH_LESS_THAN, text)


def attribute(value: object) -> str:
    """XML 속성 값. None 은 "null"."""
    text = "null" if value is None else str(value)
    return (
        text.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    )


def document_block(attrs: str, text: str) -> str:
    return f"<document {attrs}>\n{neutralize(text)}\n</document>"


@dataclass(frozen=True)
class Chunk:
    document_id: str
    page: int | None
    char_offset: int
    text: str


def attachment_chunks(attachment: Attachment) -> list[Chunk]:
    """pages 로 페이지 chunk 를 나눈다. pages 가 비면 문서 하나. 첫 페이지 앞 글자도 버리지 않는다."""
    text = attachment.text
    pages = sorted(attachment.pages, key=lambda p: p.charOffset)
    if not pages:
        return [Chunk(attachment.documentId, None, 0, text)]
    chunks = []
    if pages[0].charOffset > 0:
        chunks.append(Chunk(attachment.documentId, None, 0, text[: pages[0].charOffset]))
    for index, page in enumerate(pages):
        end = pages[index + 1].charOffset if index + 1 < len(pages) else len(text)
        chunks.append(
            Chunk(attachment.documentId, page.page, page.charOffset, text[page.charOffset : end])
        )
    return chunks


def build_user_message(request: ExtractRequest, budget_tokens: int) -> tuple[str, bool]:
    """03 §4.3 user message. 본문은 언제나 넣고 첨부 chunk 는 예산을 넘는 것부터 뺀다.

    토큰 수는 글자 수로 근사한다(한국어 보수 근사, 미검증 가정). 예산은 본문·chunk 텍스트에만 센다.
    돌려주는 bool 은 chunk 를 뺐는지(TRUNCATED_INPUT).
    """
    meta = request.meta
    notice = (
        f'<notice id="{attribute(request.bidId)}" revision="{attribute(request.revisionId)}" '
        f'stage="{attribute(meta.stage)}" agency="{attribute(meta.agency)}" '
        f'budgetKrw="{attribute(meta.budgetKrw)}" deadlineAt="{attribute(meta.deadlineAt)}" />'
    )
    blocks = [notice, document_block('id="null" kind="body"', request.body)]
    used = len(request.body)
    truncated = False
    for chunk in (c for a in request.attachments for c in attachment_chunks(a)):
        if used + len(chunk.text) > budget_tokens:
            truncated = True
            break
        used += len(chunk.text)
        attrs = (
            f'id="{attribute(chunk.document_id)}" kind="attachment" '
            f'page="{attribute(chunk.page)}" charOffset="{chunk.char_offset}"'
        )
        blocks.append(document_block(attrs, chunk.text))
    return "\n".join(blocks), truncated


def system_prompt(prompt_text: str, schema_text: str) -> str:
    return prompt_text.replace(SCHEMA_PLACEHOLDER, schema_text)


def _content(reply_text: str) -> str | None:
    body = parse_json(reply_text)
    try:
        content = body["choices"][0]["message"]["content"]
    except (TypeError, KeyError, IndexError):
        return None
    return content if isinstance(content, str) else None


def _utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class LocalQwen:
    provider = "local"

    def __init__(
        self,
        *,
        endpoint: http.Endpoint,
        model: str,
        system: str,
        schema: dict,
        budget_tokens: int,
        prompt_hash: str,
    ) -> None:
        self._endpoint = endpoint
        self._system = system
        self._schema = schema
        self._budget = budget_tokens
        self.model_name: str | None = model
        self.prompt_hash: str | None = prompt_hash

    def _body(self, user: str) -> dict:
        return {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self._system},
                {"role": "user", "content": user},
            ],
            **INFERENCE,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": RESPONSE_FORMAT_NAME, "schema": self._schema},
            },
        }

    def extract(
        self, request: ExtractRequest, retry_note: str | None = None, *, deadline: Deadline
    ) -> ModelOutput:
        user, truncated = build_user_message(request, self._budget)
        if retry_note is not None:
            user += RETRY_NOTE_PREFIX + retry_note
        started = time.perf_counter()
        try:
            reply = http.call(
                self._endpoint,
                "POST",
                CHAT_COMPLETIONS,
                deadline=deadline,
                json_body=self._body(user),
            )
        except http.TransportFailure as error:
            logger.warning("qwen call failed: %s", error)
            raise ModelUnavailable("qwen transport failure") from None
        latency = int((time.perf_counter() - started) * 1000)
        if reply.status in BAD_REQUEST_STATUSES:
            logger.warning("qwen rejected request: status=%d", reply.status)
            raise ExtractionFailed(f"qwen status {reply.status}")
        if not reply.ok:
            logger.warning("qwen unavailable: status=%d", reply.status)
            raise ModelUnavailable(f"qwen status {reply.status}")
        content = _content(reply.text)
        if content is None:
            raise ExtractionFailed("qwen reply has no message content")
        return ModelOutput(
            content,
            extracted_at=_utc_now(),
            latency=latency,
            warnings=(TRUNCATED_INPUT,) if truncated else (),
        )
