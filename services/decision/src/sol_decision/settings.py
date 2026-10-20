"""환경 변수 설정(docs/03 §5.3, ADR-034 3번).

비밀은 DECISION_API_KEY 하나다. SecretStr 로 받아 Bearer 비교에만 쓰고 로그·응답·예외 메시지에 넣지 않는다.
키 이름은 대소문자를 구분하고, 빈 문자열은 미지정으로 본다(env_ignore_empty).
"""

from pydantic import PositiveInt, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, env_ignore_empty=True, extra="ignore")

    # 필수. 없으면 기동 거부(serve). 값은 노트북 게이트웨이의 KEV_API_KEY 와 같다
    DECISION_API_KEY: SecretStr | None = None
    # 요청 하나(질문 전부)의 마감. 넘으면 504
    DECISION_TIMEOUT_MS: PositiveInt = 4_500
    # /v1/models 의 run·revision·base. 비우면 패키지 config.json 과 공개 Bosun 값(package.PUBLIC_*)을 쓴다.
    # 학습본 패키지를 올릴 때 run(예: bosun-sol-lora-v0.1)·revision 을 여기로 준다
    DECISION_RUN: str | None = None
    DECISION_REVISION: str | None = None
    DECISION_BASE: str | None = None

    def api_key(self) -> SecretStr:
        """키가 없으면 ValueError. 호출자(serve)가 기동 거부로 바꾼다."""
        if self.DECISION_API_KEY is None or not self.DECISION_API_KEY.get_secret_value():
            raise ValueError("DECISION_API_KEY(MISSING)")
        return self.DECISION_API_KEY
