"""Qwen local 어댑터(AI_PROVIDER=local, docs/03 §4.3). vLLM OpenAI 호환 POST /v1/chat/completions.

- system: 프롬프트 파일의 {{REQUIREMENT_EXTRACTION_SCHEMA_JSON}} 를 스키마 파일 내용으로 바꾼 것. 데이터는 넣지 않는다.
- user: <notice/> + <document> 블록. 데이터는 <document> 안에만 넣고, 데이터 속 <document·</document·<notice 의
  "<" 는 전각 "＜"(U+FF1C)로 바꾼다(길이가 같고 NFKC 가 "<" 로 되돌려 인용 오프셋에 영향이 없다).
  첨부는 예산 안에서 문서마다 조각을 돌아가며 넣는다(build_user_message, req-extract/v0.2).
- 추론 설정(03 §4.3): temperature 0·top_p 1·max_tokens 4096·seed 42, 비사고 모드(chat_template_kwargs
  enable_thinking=false — Qwen3.5 계열은 기본이 사고 모드였다. Qwen3.8-Flash-Next 는 미확인이라 enable_thinking=false 를
  그대로 보낸다(03 §4.3)), JSON Schema guided JSON(response_format).
- 응답은 언제나 텍스트 JSON 으로 받아 파이프라인이 파싱·스키마 검증한다.
- guided JSON 대체(03 §4.3 "지원하지 않으면 텍스트 파싱 + 검증으로 대체", 미결정 26-3): 서버가 response_format 이 든
  요청을 400·422 로 거부하면 같은 마감 안에서 response_format 없이 한 번 다시 부른다. 그 답은 코드펜스·<think> 를 벗기고
  첫 "{" 부터 마지막 "}" 까지를 JSON 본문으로 보낸다(스키마·인용 검증 체인은 그대로 지난다). 두 번째도 400·422 면
  ExtractionFailed, 그 밖의 오류는 아래 분류 그대로다. 대체는 요청마다 한 번이고 서버 능력을 기억하지 않는다.
- 오류: 연결 실패·timeout·마감 초과·응답 과대·3xx·5xx·401·403·404 → ModelUnavailable(QWEN_UNAVAILABLE).
  400·422(대체 뒤에도)·내용 없음 → ExtractionFailed.
- 호출은 요청 마감(AI_TIMEOUT_MS, 핸들러가 만든다)의 남은 시간만 쓴다. 재시도도 같은 마감을 나눠 쓴다(C5-A S1).
"""

import json
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from itertools import islice

from sol_ai.adapters import http
from sol_ai.adapters.base import ExtractionFailed, ModelOutput, ModelUnavailable
from sol_ai.contracts import Attachment, ExtractRequest, InsightRequest
from sol_ai.deadline import Deadline
from sol_ai.paths import AI_ROOT, INSIGHT_PROMPT_FILE, INSIGHT_SCHEMA_FILE
from sol_ai.strict_json import parse_json

logger = logging.getLogger("sol_ai.qwen")

CHAT_COMPLETIONS = "/v1/chat/completions"
SCHEMA_PLACEHOLDER = "{{REQUIREMENT_EXTRACTION_SCHEMA_JSON}}"
RETRY_NOTE_PREFIX = "\n\n이전 출력은 스키마를 위반했다: "
TRUNCATED_INPUT = "TRUNCATED_INPUT"
# 첨부 조각의 최대 글자 수. 쪽이 없는 문서(HWP·HWPX)와 긴 쪽을 나누는 단위이자 여러 문서에 예산을 나누는 단위다
CHUNK_CHARS = 2_500
# 같은 문서의 다른 형식을 알아보는 지문(앞 4,000 글자의 8글자 조각)과 같다고 보는 Jaccard 유사도
FINGERPRINT_CHARS = 4_000
SHINGLE_CHARS = 8
DUPLICATE_SIMILARITY = 0.6
# 03 §4.3 추론 설정
INFERENCE = {"temperature": 0, "top_p": 1, "max_tokens": 4096, "seed": 42}
# 03 §4.3 비사고 모드(미결정 26-7). vLLM 은 chat_template_kwargs 를 템플릿에 그대로 넘긴다
CHAT_TEMPLATE_KWARGS = {"enable_thinking": False}
# 미검증 가정(G4): vLLM 이 이 모양의 guided JSON 을 받는지는 실서버 기동 때 확인한다
RESPONSE_FORMAT_NAME = "requirement_extraction"
# 추천 분석(POST /insight) 출력 v0.2(ADR-078): 판단 이유 800자 + 요소·자격 해설, 강점·보완, 확인할 것. 보통 2,000~2,700자이고
# 상한을 다 채우면 약 3,300자다. 한국어 글자에 JSON 키·근거 번호까지 더하면 3072토큰을 넘을 수 있고, 잘리면 전체가 템플릿이 된다.
# 그래서 추출과 같은 4096토큰으로 둔다(계획 C2, 사전 리뷰 Product W1). 요청 본문은 번역과 같은 64KiB 까지
INSIGHT_MAX_TOKENS = 4096
INSIGHT_MAX_REQUEST_BYTES = 64 * 1024
INSIGHT_ITEM_GROUPS = ("strengths", "improvements", "factorNotes", "checkNotes", "nextSteps")
BAD_REQUEST_STATUSES = frozenset({400, 422})
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_CODE_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n\s*```\s*$", re.DOTALL)

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


def piece_end(text: str, start: int, stop: int, limit: int) -> int:
    """text[start:stop] 의 앞 limit 글자 안에서 자를 위치. 언제나 start 보다 크다.

    남은 글자가 limit 이하면 stop. 아니면 뒤쪽 절반 안의 마지막 문장 끝(". " 뒤), 없으면 마지막 공백 뒤,
    둘 다 없으면 limit 글자에서 자른다. 파서 출력은 블록을 공백 하나로 잇고 줄바꿈이 없어 문단 경계를 볼 수 없다.
    """
    end = start + limit
    if end >= stop:
        return stop
    floor = start + limit // 2
    for mark in (". ", " "):
        found = text.rfind(mark, floor, end)
        if found != -1:
            return found + len(mark)
    return end


def attachment_chunks(attachment: Attachment) -> list[Chunk]:
    """쪽(pages)마다 나누고, 쪽이 없거나(HWP·HWPX) CHUNK_CHARS 보다 긴 쪽은 piece_end 로 다시 나눈다.

    조각의 char_offset 은 원문 기준 절대 위치이고 page 는 그 조각이 든 쪽이다. 첫 쪽 앞 글자도 버리지 않는다.
    조각을 이으면 원문 그대로다. 빈 조각은 내지 않는다.
    """
    text = attachment.text
    bounds: list[tuple[int | None, int]] = [
        (page.page, page.charOffset)
        for page in sorted(attachment.pages, key=lambda p: p.charOffset)
    ]
    if not bounds or bounds[0][1] > 0:
        bounds.insert(0, (None, 0))
    chunks = []
    for index, (page, start) in enumerate(bounds):
        stop = bounds[index + 1][1] if index + 1 < len(bounds) else len(text)
        position = start
        while position < stop:
            end = piece_end(text, position, stop, CHUNK_CHARS)
            chunks.append(Chunk(attachment.documentId, page, position, text[position:end]))
            position = end
    return chunks


def fingerprint(text: str) -> frozenset[str]:
    """앞 FINGERPRINT_CHARS 글자(문자·숫자만)의 SHINGLE_CHARS 글자 조각. 띄어쓰기·기호·표 구분자 차이를 지운다."""
    letters = "".join(islice((ch for ch in text if ch.isalnum()), FINGERPRINT_CHARS))
    return frozenset(
        letters[i : i + SHINGLE_CHARS] for i in range(len(letters) - SHINGLE_CHARS + 1)
    )


def same_document(left: frozenset[str], right: frozenset[str]) -> bool:
    """Jaccard 유사도가 DUPLICATE_SIMILARITY 이상이면 같은 문서의 다른 형식이다. 짧은 문서가 긴 문서의 앞부분과
    겹치는 것만으로는 같다고 보지 않는다(크기 차이가 유사도를 낮춘다)."""
    union = len(left | right)
    return union > 0 and len(left & right) >= DUPLICATE_SIMILARITY * union


def distinct_attachments(attachments: list[Attachment]) -> list[Attachment]:
    """같은 문서의 다른 형식(예: 같은 공고서의 PDF·HWPX)은 하나만 남긴다. 자리는 앞의 것을 쓴다.

    쪽이 있는 것(PDF)을 남긴다. 근거에 쪽 번호가 남고, 인용 검증이 그 쪽 범위에서 먼저 찾는다(citation._page_scope).
    둘 다 쪽이 있거나 둘 다 없으면 앞의 것이다. gateway 는 첨부 이름을 받지 않아(contracts.Attachment) 내용으로 본다.
    """
    kept: list[tuple[frozenset[str], Attachment]] = []
    for attachment in attachments:
        mark = fingerprint(attachment.text)
        same = next((i for i, (other, _) in enumerate(kept) if same_document(mark, other)), None)
        if same is None:
            kept.append((mark, attachment))
        elif attachment.pages and not kept[same][1].pages:
            kept[same] = (mark, attachment)
    return [attachment for _, attachment in kept]


def build_user_message(request: ExtractRequest, budget_tokens: int) -> tuple[str, bool]:
    """03 §4.3 user message. 본문은 언제나 넣는다. 첨부는 같은 문서의 다른 형식을 하나로 줄이고, 문서마다
    앞 조각부터 한 조각씩 돌아가며 넣는다. 남은 예산보다 긴 조각을 만나면 남은 만큼 그 앞부분을 넣고 멈춘다.
    블록은 첨부 순서, 문서 안에서는 원문 순서로 낸다.

    토큰 수는 글자 수로 근사한다(한국어 보수 근사, 미검증 가정). 예산은 본문·chunk 텍스트에만 센다.
    돌려주는 bool 은 첨부 글자를 뺐는지(TRUNCATED_INPUT). 같은 문서라서 뺀 형식은 세지 않는다.
    """
    meta = request.meta
    notice = (
        f'<notice id="{attribute(request.bidId)}" revision="{attribute(request.revisionId)}" '
        f'stage="{attribute(meta.stage)}" agency="{attribute(meta.agency)}" '
        f'budgetKrw="{attribute(meta.budgetKrw)}" deadlineAt="{attribute(meta.deadlineAt)}" />'
    )
    blocks = [notice, document_block('id="null" kind="body"', request.body)]
    room = budget_tokens - len(request.body)
    queues = [deque(attachment_chunks(a)) for a in distinct_attachments(request.attachments)]
    taken: list[list[Chunk]] = [[] for _ in queues]
    truncated = False
    while not truncated and any(queues):
        for queue, picked in zip(queues, taken, strict=True):
            if not queue:
                continue
            chunk = queue.popleft()
            if len(chunk.text) > room:
                truncated = True
                if room > 0:
                    end = piece_end(chunk.text, 0, len(chunk.text), room)
                    picked.append(replace(chunk, text=chunk.text[:end]))
                break
            room -= len(chunk.text)
            picked.append(chunk)
    for chunk in (c for picked in taken for c in picked):
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


def unwrap_json_text(content: str) -> str:
    """guided JSON 없이 받은 답에서 JSON 본문을 꺼낸다(03 §4.3 텍스트 파싱 대체).

    <think>…</think> 를 지우고, 전체가 코드펜스면 그 안을, 아니면 첫 "{" 부터 마지막 "}" 까지를 돌려준다.
    "{" 또는 "}" 가 없으면 그대로 돌려준다(파이프라인의 JSON 파싱이 실패로 판정한다). 문자열 안의 괄호는 보지
    않지만, 출력이 JSON 객체 하나라는 전제(프롬프트 규칙 1)에서 바깥 괄호 둘은 언제나 객체의 것이다.
    """
    text = _THINK_BLOCK.sub("", content).strip()
    fenced = _CODE_FENCE.match(text)
    if fenced is not None:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


def _utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _only(array: dict, values: list[str], key: str | None = None) -> None:
    """guided 배열 스키마가 values 안의 글만 받게 한다. key 가 있으면 항목 객체의 그 칸, 없으면 배열 항목 자체다.

    values 가 비면 그 배열은 빈 배열만 받는다.
    """
    holder, name = (array["items"]["properties"], key) if key else (array, "items")
    holder[name] = {"type": "string", "enum": values} if values else {"type": "string"}
    if not values:
        array["maxItems"] = 0


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

    def _body(
        self,
        user: str,
        *,
        guided: bool = True,
        system: str | None = None,
        schema: dict | None = None,
        name: str = RESPONSE_FORMAT_NAME,
    ) -> dict:
        body = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self._system if system is None else system},
                {"role": "user", "content": user},
            ],
            **INFERENCE,
            "chat_template_kwargs": dict(CHAT_TEMPLATE_KWARGS),
        }
        if guided:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": name, "schema": self._schema if schema is None else schema},
            }
        return body

    def _call(self, user: str, *, guided: bool, deadline: Deadline) -> http.HttpReply:
        try:
            return http.call(
                self._endpoint,
                "POST",
                CHAT_COMPLETIONS,
                deadline=deadline,
                json_body=self._body(user, guided=guided),
            )
        except http.TransportFailure as error:
            logger.warning("qwen call failed: %s", error)
            raise ModelUnavailable("qwen transport failure") from None

    def extract(
        self, request: ExtractRequest, retry_note: str | None = None, *, deadline: Deadline
    ) -> ModelOutput:
        user, truncated = build_user_message(request, self._budget)
        if retry_note is not None:
            user += RETRY_NOTE_PREFIX + retry_note
        started = time.perf_counter()
        guided = True
        reply = self._call(user, guided=True, deadline=deadline)
        if reply.status in BAD_REQUEST_STATUSES:
            # guided JSON(response_format)을 못 받는 서버로 본다. 같은 마감 안에서 텍스트 파싱 경로로 한 번 대체한다
            logger.warning(
                "qwen rejected guided request: status=%d, retrying once without response_format",
                reply.status,
            )
            guided = False
            reply = self._call(user, guided=False, deadline=deadline)
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
            content if guided else unwrap_json_text(content),
            extracted_at=_utc_now(),
            latency=latency,
            warnings=(TRUNCATED_INPUT,) if truncated else (),
        )

    def translate(self, values: dict[str, str], *, deadline: Deadline) -> str:
        """동일 endpoint/인증/HTTP 방어, 별도 prompt/schema. 새 Deadline이나 의미 재시도는 없다."""
        from sol_ai.translation import MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES

        system = (AI_ROOT / "prompts/state-translate.v0.1.md").read_text(encoding="utf-8")
        schema = json.loads((AI_ROOT / "schemas/state-translation.v0.1.json").read_text())
        schema["properties"]["translations"]["properties"] = {
            path: {"type": "string", "minLength": 1, "maxLength": 2000} for path in values
        }
        schema["properties"]["translations"]["additionalProperties"] = False
        user = json.dumps({"values": values}, ensure_ascii=True)
        for guided in (True, False):
            body = self._body(
                user, guided=guided, system=system, schema=schema, name="state_translation"
            )
            if len(json.dumps(body).encode("utf-8")) > MAX_REQUEST_BYTES:
                raise ExtractionFailed("translation request too large")
            try:
                reply = http.call(
                    self._endpoint,
                    "POST",
                    CHAT_COMPLETIONS,
                    deadline=deadline,
                    json_body=body,
                    max_bytes=MAX_RESPONSE_BYTES,
                )
            except http.TransportFailure:
                raise ModelUnavailable("translation transport failure") from None
            if guided and reply.status in BAD_REQUEST_STATUSES:
                continue
            if not reply.ok:
                raise ModelUnavailable("translation unavailable")
            content = _content(reply.text)
            if content is None:
                raise ExtractionFailed("translation reply has no content")
            # 추출의 관대한 unwrap 경로와 다르게 번역은 JSON 객체 전체를 엄격히 검증한다.
            return content
        raise ExtractionFailed("translation request rejected")

    @property
    def insight_model(self) -> str | None:
        return self.model_name

    def insight(self, request: InsightRequest, *, deadline: Deadline) -> str:
        """translate 와 같은 연결·대체 규칙(guided → 400·422 면 unguided 1회). 새 Deadline·내용 재시도는 없다.

        user 는 요청 JSON 에서 requestId·injectionSuspected 를 뺀 것이다. guided 스키마의 refIds 는 요청 refs 의 id 로,
        요소 해설의 factor 는 요청 요소 키로, 자격 해설의 label 은 미충족·확인 필요 자격 이름으로 좁힌다.
        """
        system = INSIGHT_PROMPT_FILE.read_text(encoding="utf-8")
        schema = json.loads(INSIGHT_SCHEMA_FILE.read_text(encoding="utf-8"))
        groups = schema["properties"]
        ref_ids = [ref.id for ref in request.refs]
        for group in INSIGHT_ITEM_GROUPS:
            _only(groups[group]["items"]["properties"]["refIds"], ref_ids)
        _only(
            groups["factorNotes"],
            [*dict.fromkeys(f.factor for f in request.rules.factors)],
            "factor",
        )
        _only(groups["checkNotes"], [c.label for c in request.rules.review_checks()], "label")
        user = json.dumps(request.model_input(), ensure_ascii=False)
        for guided in (True, False):
            body = self._body(user, guided=guided, system=system, schema=schema, name="insight")
            body["max_tokens"] = INSIGHT_MAX_TOKENS
            if len(json.dumps(body).encode("utf-8")) > INSIGHT_MAX_REQUEST_BYTES:
                raise ExtractionFailed("insight request too large")
            try:
                reply = http.call(
                    self._endpoint, "POST", CHAT_COMPLETIONS, deadline=deadline, json_body=body
                )
            except http.TransportFailure:
                raise ModelUnavailable("insight transport failure") from None
            if guided and reply.status in BAD_REQUEST_STATUSES:
                continue
            if not reply.ok:
                raise ModelUnavailable("insight unavailable")
            content = _content(reply.text)
            if content is None:
                raise ExtractionFailed("insight reply has no content")
            return content if guided else unwrap_json_text(content)
        raise ExtractionFailed("insight request rejected")
