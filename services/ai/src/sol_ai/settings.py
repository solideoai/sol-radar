"""환경 변수 설정. 비밀값은 받지 않는다.

판정에 쓰는 키 집합은 규칙 파일(infra/run-modes.json)에서 나온다. 여기에는 키를 따로 적지 않는다.
키 이름은 Node 처럼 대소문자를 구분해 읽는다(case_sensitive=True).
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

from sol_ai.run_mode import rule_env_keys


class Settings(BaseSettings):
    # extra="allow": 생성자에 직접 준 규칙 키(forbidden 등)도 model_extra 로 보존한다.
    model_config = SettingsConfigDict(extra="allow", case_sensitive=True)

    SOL_RUN_MODE: str | None = None
    DEMO_MODE: str | None = None
    AI_PROVIDER: str | None = None
    KEV_ENABLED: str | None = None
    AI_HOSTED_APPROVED: str | None = None
    AI_HOST: str = "127.0.0.1"

    def as_env(self, rules: dict) -> dict[str, str]:
        """판정용 env. 규칙 파일이 가리키는 키만, 프로세스 환경 + 생성자 값 순으로 모은다."""
        keys = rule_env_keys(rules)
        env = {key: os.environ[key] for key in keys if key in os.environ}
        explicit = {**self.model_dump(exclude={"AI_HOST"}), **(self.model_extra or {})}
        env.update({k: v for k, v in explicit.items() if k in keys and isinstance(v, str)})
        return env
