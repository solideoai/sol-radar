"""회사 운영 vLLM API(Qwen) 실연결 확인. **사용자 확인 뒤 손으로만 실행한다.**

pytest(testpaths=tests)·verify.sh·CI 어디서도 저절로 돌지 않는다(scripts/ 는 시험 경로가 아니고 import 되지 않는다).
외부 네트워크를 부르므로 시험·검증 명령에 끼우지 않는다. 실행마다 회사 API 호출 예산을 쓴다.

사용법(services/ai 에서):
    QWEN_BASE_URL=https://acropolissg.com/vllm/v1 QWEN_MODEL=Qwen/Qwen3.8-Flash-Next QWEN_API_KEY=… \\
        uv run python scripts/probe-qwen-api.py [--dry-run] [--logprobs] [--timeout 30]

- env: QWEN_BASE_URL(끝의 /v1 유무 무관. settings.normalize_qwen_base_url 로 정규화), QWEN_MODEL, QWEN_API_KEY.
  키가 없으면 요청을 보내지 않고 exit 2 와 안내만 낸다.
- --dry-run: 보낼 요청 모양(메서드·URL·본문)만 출력하고 보내지 않는다. Authorization 헤더는 "설정됨" 여부만 적는다.
- 실행: ① GET /v1/models(id 목록, max_model_len 이 있으면 함께, QWEN_MODEL 포함 여부)
       ② POST /v1/chat/completions 아주 짧은 프롬프트 + response_format json_schema + chat_template_kwargs
          {enable_thinking: false} + max_tokens 64 → guided JSON 지원 여부(응답이 스키마대로 파싱되는지)·지연 ms
       ③ --logprobs 면 같은 엔드포인트에 prompt_logprobs 를 더해 응답에 prompt_logprobs 가 오는지
- 출력: JSON 한 줄(stdout). **키 값·Authorization 헤더는 절대 출력하지 않는다.** 오류 메시지도 예외 종류와
  HTTP 상태만 적는다. exit 0 = 요청을 보냈다(지원 여부는 JSON 의 값으로 본다), 1 = 전송 실패, 2 = 키 없음.

> 미검증 가정: vLLM 의 `response_format json_schema`·`chat_template_kwargs`·`prompt_logprobs` 받아들임과 응답 모양은
> 회사 서버 B2 확인 전이다(ADR-034 8번·미결정). 이 스크립트는 "그렇게 보냈을 때 무엇이 왔는지" 를 기록할 뿐이다.
"""

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any

import httpx

# uv run 이 sol_ai 패키지를 가상환경에 설치하므로 바로 import 한다(경로 조작 없음)
from sol_ai.settings import normalize_qwen_base_url

MODELS = "/v1/models"
CHAT_COMPLETIONS = "/v1/chat/completions"
EXIT_OK, EXIT_TRANSPORT, EXIT_NO_KEY = 0, 1, 2

# ② 아주 짧은 프롬프트. 스키마는 불리언 하나(guided JSON 지원 여부만 본다)
PROBE_SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}
PROBE_MESSAGES = [
    {"role": "system", "content": "Reply with JSON only."},
    {"role": "user", "content": 'Return {"ok": true}.'},
]


@dataclass(frozen=True)
class Target:
    base_url: str
    model: str
    has_key: bool

    def url(self, path: str) -> str:
        return self.base_url + path


def read_target() -> Target | None:
    """env 를 읽는다. QWEN_BASE_URL·QWEN_MODEL 이 없으면 None(안내는 호출자가 한다)."""
    base = os.environ.get("QWEN_BASE_URL", "").strip()
    model = os.environ.get("QWEN_MODEL", "").strip()
    if not base or not model:
        return None
    return Target(normalize_qwen_base_url(base), model, bool(os.environ.get("QWEN_API_KEY", "")))


def _headers() -> dict[str, str]:
    """Authorization 헤더. 여기서 만든 값은 요청에만 쓰고 어디에도 출력하지 않는다."""
    return {"Authorization": f"Bearer {os.environ['QWEN_API_KEY']}"}


def chat_body(model: str, *, logprobs: bool) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": PROBE_MESSAGES,
        "temperature": 0,
        "max_tokens": 64,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "probe", "schema": PROBE_SCHEMA},
        },
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if logprobs:
        # 미검증 가정: vLLM 확장 매개변수. 프롬프트 토큰별 로그 확률을 응답 prompt_logprobs 로 돌려준다고 가정한다
        body["prompt_logprobs"] = 1
        body["max_tokens"] = 1
    return body


def planned_requests(target: Target, *, logprobs: bool) -> list[dict[str, Any]]:
    """--dry-run 출력. Authorization 은 설정 여부만 적는다."""
    auth = "bearer(set)" if target.has_key else "bearer(missing)"
    plan = [
        {"method": "GET", "url": target.url(MODELS), "authorization": auth},
        {
            "method": "POST",
            "url": target.url(CHAT_COMPLETIONS),
            "authorization": auth,
            "body": chat_body(target.model, logprobs=False),
        },
    ]
    if logprobs:
        plan.append(
            {
                "method": "POST",
                "url": target.url(CHAT_COMPLETIONS),
                "authorization": auth,
                "body": chat_body(target.model, logprobs=True),
            }
        )
    return plan


def _send(client: httpx.Client, method: str, url: str, body: Any = None) -> dict[str, Any]:
    """요청 하나. 실패는 예외 종류 이름만 남긴다(URL 은 비밀이 아니지만 헤더·키는 담지 않는다)."""
    started = time.perf_counter()
    try:
        response = client.request(method, url, json=body, headers=_headers())
    except httpx.HTTPError as error:
        return {"error": type(error).__name__, "latencyMs": _elapsed(started)}
    parsed: Any
    try:
        parsed = response.json()
    except ValueError:
        parsed = None
    return {"status": response.status_code, "json": parsed, "latencyMs": _elapsed(started)}


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def summarize_models(reply: dict[str, Any], model: str) -> dict[str, Any]:
    data = reply.get("json")
    rows = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), list) else []
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    lengths = {
        row["id"]: row["max_model_len"]
        for row in rows
        if isinstance(row, dict) and "max_model_len" in row
    }
    return {
        "status": reply.get("status"),
        "error": reply.get("error"),
        "latencyMs": reply.get("latencyMs"),
        "ids": ids,
        "maxModelLen": lengths or None,
        "hasRequestedModel": model in ids,
    }


def _content(reply: dict[str, Any]) -> str | None:
    data = reply.get("json")
    try:
        content = data["choices"][0]["message"]["content"]
    except (TypeError, KeyError, IndexError):
        return None
    return content if isinstance(content, str) else None


def summarize_guided_json(reply: dict[str, Any]) -> dict[str, Any]:
    """guided JSON 판정: 200 이고 content 가 PROBE_SCHEMA 대로 파싱되면 supported, 400/422 면 rejected, 그 밖은 unknown."""
    status = reply.get("status")
    content = _content(reply)
    parsed: Any = None
    if content is not None:
        try:
            parsed = json.loads(content)
        except ValueError:
            parsed = None
    conforms = isinstance(parsed, dict) and set(parsed) == {"ok"} and isinstance(parsed["ok"], bool)
    if status == 200 and conforms:
        verdict = "supported"
    elif status in (400, 422):
        verdict = "rejected"
    else:
        verdict = "unknown"
    return {
        "status": status,
        "error": reply.get("error"),
        "latencyMs": reply.get("latencyMs"),
        "guidedJson": verdict,
        "contentConformsToSchema": conforms,
        "contentChars": len(content) if content is not None else None,
    }


def summarize_logprobs(reply: dict[str, Any]) -> dict[str, Any]:
    data = reply.get("json")
    present = isinstance(data, dict) and data.get("prompt_logprobs") is not None
    return {
        "status": reply.get("status"),
        "error": reply.get("error"),
        "latencyMs": reply.get("latencyMs"),
        "promptLogprobs": "present" if present else "absent",
    }


def run(target: Target, *, logprobs: bool, timeout: float) -> tuple[dict[str, Any], int]:
    result: dict[str, Any] = {"baseUrl": target.base_url, "model": target.model}
    # TLS 검증은 켠 채 두고, 프록시 환경 변수는 읽지 않는다(gateway 의 http 와 같은 원칙)
    with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
        models = _send(client, "GET", target.url(MODELS))
        result["models"] = summarize_models(models, target.model)
        chat = _send(
            client, "POST", target.url(CHAT_COMPLETIONS), chat_body(target.model, logprobs=False)
        )
        result["chatCompletions"] = summarize_guided_json(chat)
        if logprobs:
            lp = _send(
                client, "POST", target.url(CHAT_COMPLETIONS), chat_body(target.model, logprobs=True)
            )
            result["promptLogprobs"] = summarize_logprobs(lp)
    failed = any(isinstance(v, dict) and v.get("error") for v in result.values())
    return result, (EXIT_TRANSPORT if failed else EXIT_OK)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="요청 모양만 출력하고 보내지 않는다")
    parser.add_argument(
        "--logprobs", action="store_true", help="③ prompt_logprobs 지원 여부도 본다"
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="요청마다의 timeout(초)")
    args = parser.parse_args(argv)

    target = read_target()
    if target is None:
        print(
            "QWEN_BASE_URL 과 QWEN_MODEL 을 env 로 준다. 값은 infra/env/ai-local.env.example 참고",
            file=sys.stderr,
        )
        return EXIT_NO_KEY
    if args.dry_run:
        print(
            json.dumps(
                {"dryRun": True, "requests": planned_requests(target, logprobs=args.logprobs)},
                ensure_ascii=False,
            )
        )
        return EXIT_OK
    if not target.has_key:
        print(
            "QWEN_API_KEY 가 없어 요청을 보내지 않았다. 회사 제공 키를 env 로 주고 다시 실행한다(값은 infra/.env 에만).",
            file=sys.stderr,
        )
        return EXIT_NO_KEY
    result, code = run(target, logprobs=args.logprobs, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
