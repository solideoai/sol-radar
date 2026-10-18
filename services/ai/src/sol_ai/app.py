"""FastAPI 앱. Phase 0 은 GET /health 만 연다."""

from fastapi import FastAPI

from sol_ai.run_mode import load_rules, resolve_run_mode
from sol_ai.settings import Settings


class RunModeError(Exception):
    """실행 모드 위반. 메시지에는 키 이름과 reason 만 담는다."""

    def __init__(self, summary: str) -> None:
        super().__init__(summary)
        self.summary = summary


def format_violations(violations) -> str:
    return ", ".join(f"{v.key}({v.reason})" for v in violations)


def create_app(settings: Settings) -> FastAPI:
    rules = load_rules()
    result = resolve_run_mode(settings.as_env(rules), rules)
    if result.violations:
        raise RunModeError(format_violations(result.violations))
    effective = result.effective or {}
    app = FastAPI(title="SOL RADAR AI gateway")

    @app.get("/health")
    def health() -> dict:
        # qwen·kev·questionSets·parsers 는 03:145 필드 자리다. Phase 2·5 에서 채운다.
        return {
            "status": "ok",
            "runMode": result.mode,
            "provider": effective["AI_PROVIDER"],
            "kevEnabled": effective["KEV_ENABLED"] == "true",
            "qwen": None,
            "kev": None,
            "questionSets": [],
            "parsers": [],
        }

    return app
