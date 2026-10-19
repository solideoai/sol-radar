"""시험용 가짜 모델 서버(vLLM·kev.serve 흉내). 127.0.0.1 의 포트 0(자동 배정)에만 열린다.

표준 라이브러리 http.server + 스레드. 받은 요청(메서드·경로·헤더·본문)을 기록하고, 경로마다 정한 응답을 돌려준다.
지연(delay)은 이벤트 대기로 흉내 내서 close() 가 기다리는 요청을 바로 풀어 준다(스레드가 남지 않는다).
실제 회사 엔드포인트·외부 네트워크는 쓰지 않는다.
"""

import json
import socket
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from support import KEV_RUN, QWEN_RUN, extraction_fixture, kev_fixture


@dataclass(frozen=True)
class Reply:
    status: int = 200
    json_body: object = None
    raw_body: bytes | None = None
    headers: dict = field(default_factory=dict)
    delay: float = 0.0

    def body(self) -> bytes:
        if self.raw_body is not None:
            return self.raw_body
        return json.dumps(self.json_body, ensure_ascii=False).encode("utf-8")


@dataclass(frozen=True)
class Recorded:
    method: str
    path: str
    headers: dict
    body: bytes

    def json(self):
        return json.loads(self.body.decode("utf-8"))


class FakeModelServer:
    def __init__(self, port: int = 0) -> None:
        self.requests: list[Recorded] = []
        self._routes: dict[tuple[str, str], list[Reply]] = {}
        self._responders: dict = {}
        self._release = threading.Event()
        self._lock = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                headers = {k.lower(): v for k, v in self.headers.items()}
                reply = owner._take(self.command, self.path, headers, body)
                if reply.delay:
                    owner._release.wait(reply.delay)
                payload = reply.body()
                self.send_response(reply.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                for key, value in reply.headers.items():
                    self.send_header(key, value)
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = _handle
            do_POST = _handle

            def log_message(self, *args) -> None:  # 시험 출력에 접근 로그를 남기지 않는다
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def route(self, method: str, path: str, *replies: Reply) -> "FakeModelServer":
        """경로의 응답 차례. 마지막 응답은 그 뒤 호출에도 계속 쓴다."""
        with self._lock:
            self._responders.pop((method, path), None)
            self._routes[(method, path)] = list(replies)
        return self

    def respond_with(self, method: str, path: str, responder) -> "FakeModelServer":
        """받은 요청(Recorded)으로 응답을 만드는 함수를 둔다(질문 수가 요청마다 다른 Kev v0.2 묶음용)."""
        with self._lock:
            self._routes.pop((method, path), None)
            self._responders[(method, path)] = responder
        return self

    def _take(self, method: str, path: str, headers: dict, body: bytes) -> Reply:
        recorded = Recorded(method, path, headers, body)
        with self._lock:
            self.requests.append(recorded)
            responder = self._responders.get((method, path))
            queue = self._routes.get((method, path))
            if responder is None:
                if not queue:
                    return Reply(404, {"error": "not found"})
                return queue.pop(0) if len(queue) > 1 else queue[0]
        return responder(recorded)

    def calls(self, method: str, path: str) -> list[Recorded]:
        with self._lock:
            return [r for r in self.requests if r.method == method and r.path == path]

    def close(self) -> None:
        self._release.set()
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def free_port() -> int:
    """지금 비어 있는 127.0.0.1 포트. 바로 닫으므로 그 주소로 연결하면 거부된다(닫힌 포트)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def closed_url() -> str:
    return f"http://127.0.0.1:{free_port()}"


# ---------------------------------------------------------------- 응답 본문


def vllm_models(*model_ids: str) -> dict:
    """vLLM OpenAI 호환 GET /v1/models."""
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in model_ids]}


def kev_models(run: str = KEV_RUN, *, top_level: bool = False) -> dict:
    """kev.serve GET /v1/models(필드 이름 run 은 03 §11 미검증 가정)."""
    model = {"id": "kev", "run": run, "base": "Qwen/Qwen3.5-9B", "lora": None, "temperature": 1.0}
    return model if top_level else {"object": "list", "data": [model]}


def chat_completion(content: str | None, *, model: str = QWEN_RUN) -> dict:
    message = (
        {"role": "assistant"} if content is None else {"role": "assistant", "content": content}
    )
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def extraction_output(fixture_id: str = "FX-01") -> str:
    """모델 출력 흉내: 추출 fixture 에서 gateway 가 채우는 model 블록을 뺀 JSON 문자열."""
    data = extraction_fixture(fixture_id)
    data.pop("model", None)
    return json.dumps(data, ensure_ascii=False)


def kev_answer(fixture_id: str = "FX-01", latency_ms: int = 123) -> dict:
    """kev.serve POST /v1/systemone 응답(03 §5.4): responses·usage·latency_ms."""
    fixture = kev_fixture(fixture_id)
    return {
        "responses": fixture["responses"],
        "usage": {"input_tokens": 512, "output_tokens": 4},
        "latency_ms": latency_ms,
    }
