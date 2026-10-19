"""RequirementExtraction JSON Schema(draft 2020-12)와 프롬프트 해시.

- `prune`: 스키마 밖 키를 버린다(docs/09 "스키마 밖 필드는 폐기"). 값은 바꾸지 않는다.
- `errors`: 스키마 검증. format "date-time" 은 오프셋 있는 ISO8601 만 통과한다.
"""

import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from sol_ai.paths import SCHEMA_FILE
from sol_ai.timeutil import is_date_time

DEFS_PREFIX = "#/$defs/"


def _format_checker() -> FormatChecker:
    checker = FormatChecker(formats=())
    checker.checks("date-time")(is_date_time)
    return checker


@dataclass(frozen=True)
class ExtractionSchema:
    text: str
    schema: dict
    validator: Draft202012Validator

    @classmethod
    def load(cls, path: Path) -> "ExtractionSchema":
        # 해시에 쓰므로 줄바꿈을 바꾸지 않고 바이트 그대로 읽는다
        text = path.read_bytes().decode("utf-8")
        schema = json.loads(text)
        Draft202012Validator.check_schema(schema)
        return cls(text, schema, Draft202012Validator(schema, format_checker=_format_checker()))

    def _resolve(self, sub: dict) -> dict:
        while "$ref" in sub:
            sub = self.schema["$defs"][sub["$ref"].removeprefix(DEFS_PREFIX)]
        return sub

    def prune(self, instance: Any, sub: dict | None = None) -> Any:
        """additionalProperties=false 인 객체에서 properties 밖 키를 버린 사본을 돌려준다."""
        sub = self._resolve(self.schema if sub is None else sub)
        if isinstance(instance, dict) and "properties" in sub:
            properties = sub["properties"]
            closed = sub.get("additionalProperties", True) is False
            return {
                key: self.prune(value, properties[key]) if key in properties else value
                for key, value in instance.items()
                if key in properties or not closed
            }
        if isinstance(instance, list) and "items" in sub:
            return [self.prune(item, sub["items"]) for item in instance]
        return instance

    def errors(self, instance: Any) -> list[str]:
        """위반 위치·검사 이름만 돌려준다(값은 담지 않는다. 로그에 원문이 새지 않게)."""
        found = sorted(self.validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
        return ["/".join(str(p) for p in e.absolute_path) + f":{e.validator}" for e in found]

    def is_valid(self, instance: Any) -> bool:
        return self.validator.is_valid(instance)


@lru_cache(maxsize=1)
def default_schema() -> ExtractionSchema:
    """저장소 스키마 파일. 프로세스 안에서 한 번만 읽고 메타 스키마 검사를 한다(앱마다 다시 하지 않는다)."""
    return ExtractionSchema.load(SCHEMA_FILE)


def prompt_hash(prompt_file: Path, schema_text: str, version: str) -> str:
    """docs/03 §4.3: sha256(system prompt 전문 + "\\n" + JSON Schema 파일 내용 + "\\n" + AI_PROMPT_VERSION).

    64자 hex, 접두 없음.
    """
    prompt = prompt_file.read_bytes().decode("utf-8")
    return hashlib.sha256(f"{prompt}\n{schema_text}\n{version}".encode()).hexdigest()
