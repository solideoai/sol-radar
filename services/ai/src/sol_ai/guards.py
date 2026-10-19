"""프롬프트 인젝션 탐지(docs/03 §4.4 1·5단계, docs/09). 텍스트는 바꾸지 않고 의심 여부만 낸다.

패턴 원천은 services/ai/guards/injection-patterns.yaml 이다. 휴리스틱이라 통과가 안전을 보장하지 않는다.
"""

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from sol_ai.citation import norm

# 근거 없는 완화 문구를 보는 필드(03 §4.4 5단계)
RELAXATION_FIELDS = ("restrictions", "qualifications")


@dataclass(frozen=True)
class Pattern:
    id: str
    regex: re.Pattern[str]


def _compile(entries: list[dict]) -> tuple[Pattern, ...]:
    return tuple(Pattern(e["id"], re.compile(e["regex"], re.IGNORECASE)) for e in entries)


def _strings(value: Any) -> Iterator[str]:
    """값 안의 문자열을 모두 꺼낸다(배열 원소·객체의 문자열 필드 포함)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)


@dataclass(frozen=True)
class InjectionGuard:
    patterns: tuple[Pattern, ...]
    relaxation: tuple[Pattern, ...]

    @classmethod
    def load(cls, path: Path) -> "InjectionGuard":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls(_compile(data["patterns"]), _compile(data["relaxation"]))

    def matches(self, text: str) -> bool:
        normalized = norm(text)
        return any(p.regex.search(normalized) for p in self.patterns)

    def scan_input(self, texts: Iterable[str]) -> bool:
        """1단계: 공고 본문·첨부 텍스트."""
        return any(self.matches(text) for text in texts)

    def scan_output(self, extraction: dict, fields: Iterable[str]) -> bool:
        """출력 탐지: 필드 값·note 의 문자열에 지시문 패턴이 있거나,
        restrictions·qualifications 에 근거 없는(evidence=[]) 완화 문구가 값으로 있으면 의심.

        모델이 낸 값(스키마 정리 직후)을 기준으로 본다. 상태 정합성(STATE_FIXED)이 값을 지운 뒤에 보면
        "근거 없는 완화 문구"를 놓친다.
        """
        for name in fields:
            extracted = extraction[name]
            texts = [*_strings(extracted["value"]), *_strings(extracted.get("note"))]
            if any(self.matches(text) for text in texts):
                return True
            if name in RELAXATION_FIELDS and not extracted["evidence"]:
                values = [norm(text) for text in _strings(extracted["value"])]
                if any(p.regex.search(v) for p in self.relaxation for v in values):
                    return True
        return False
