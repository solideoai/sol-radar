"""환경 변수 설정.

비밀값은 모델 서버 키(QWEN_API_KEY·KEV_API_KEY)뿐이다. SecretStr 로 받아 Authorization 헤더에만 쓰고
로그·응답·예외 메시지에 넣지 않는다. Supabase·MinIO 키는 받지 않는다.

판정에 쓰는 키 집합은 규칙 파일(infra/run-modes.json)에서 나온다. 여기에는 키를 따로 적지 않는다.
키 이름은 Node 처럼 대소문자를 구분해 읽는다(case_sensitive=True).
env 의 빈 문자열은 미지정으로 보고 기본값을 쓴다(env_ignore_empty=True, C5-A S11). compose 의 `${KEY:-}` 가 넘기는
빈 값이 기본값(KEV_QUESTION_SET·KEV_MODEL_ID 등)을 덮지 않게 한다. 실행 모드 판정(as_env)은 os.environ 을 직접
읽으므로 빈 값을 "" 그대로 본다(판정 규칙은 빈 값을 미지정으로 다룬다).
"""

import os

from pydantic import PositiveInt, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from sol_ai.run_mode import rule_env_keys


class Settings(BaseSettings):
    # extra="allow": 생성자에 직접 준 규칙 키(forbidden 등)도 model_extra 로 보존한다.
    model_config = SettingsConfigDict(extra="allow", case_sensitive=True, env_ignore_empty=True)

    SOL_RUN_MODE: str | None = None
    DEMO_MODE: str | None = None
    AI_PROVIDER: str | None = None
    KEV_ENABLED: str | None = None
    AI_HOSTED_APPROVED: str | None = None
    AI_HOST: str = "127.0.0.1"

    # 아래는 gateway 동작 키(docs/03 §3). 실행 모드 판정에는 쓰지 않는다.
    # 테스트(G6) 전용 장애 주입. AI_PROVIDER=mock 에서만 유효하다(K3).
    AI_FAULT_INJECT: str | None = None
    # "true" 일 때만 /kev 의 stateLanguage="ko" 를 받는다. 미지정은 "false" 와 같다.
    KEV_ALLOW_KO_STATE: str | None = None
    CITATION_FUZZY_MIN_RATIO: float = 0.92
    AI_PROMPT_VERSION: str = "req-extract/v0.1"
    # 실추론 Kev 어댑터가 쓸 질문 세트 버전. mock 은 kev-qs/v0.1 만 답한다(docs/03 §5.7).
    KEV_QUESTION_SET: str = "kev-qs/v0.1"
    QWEN_MODEL: str | None = None
    PARSER_PDF: str | None = None
    PARSER_HWPX: str | None = None
    PARSER_HWP: str | None = None
    # mock 이 읽는 fixture 디렉터리(extractions/·kev/ 를 담는다). 없으면 저장소 루트 fixtures/.
    SOL_FIXTURES_DIR: str | None = None

    # local 어댑터(docs/03 §3, ADR-025). URL 은 https, 또는 루프백(127.0.0.1·localhost·::1)의 http 만 받는다.
    # 호스트는 레지스트리 allowedHosts 또는 루프백만, 계정 정보(u:pw@)는 받지 않는다. 키는 둘 다 필수(Kev 는 켰을 때)이고
    # 출력 가능한 ASCII 만 받는다(C5-A S2·S3·S5·S6, local_setup)
    QWEN_BASE_URL: str | None = None
    QWEN_API_KEY: SecretStr | None = None
    KEV_BASE_URL: str | None = None
    KEV_API_KEY: SecretStr | None = None
    KEV_MODEL_ID: str = "kev-9b-v1.0"
    # 요청 하나의 마감(/extract·/kev, 재시도·묶음 포함). 호출마다 새로 쓰지 않는다(C5-A S1)
    AI_TIMEOUT_MS: PositiveInt = 60_000
    KEV_TIMEOUT_MS: PositiveInt = 5_000
    QWEN_CONTEXT_BUDGET_TOKENS: PositiveInt = 12_000
    # 모델 서버 미접속 때 mock 자동 대체. 구현하지 않는다(L3): "true" 면 local 기동 거부
    AI_FALLBACK_TO_MOCK: str | None = None

    def as_env(self, rules: dict) -> dict[str, str]:
        """판정용 env. 규칙 파일이 가리키는 키만, 프로세스 환경 + 생성자 값 순으로 모은다."""
        keys = rule_env_keys(rules)
        env = {key: os.environ[key] for key in keys if key in os.environ}
        explicit = {**self.model_dump(exclude={"AI_HOST"}), **(self.model_extra or {})}
        env.update({k: v for k, v in explicit.items() if k in keys and isinstance(v, str)})
        return env
