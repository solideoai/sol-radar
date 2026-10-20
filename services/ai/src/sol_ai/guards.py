"""프롬프트 인젝션 탐지(docs/03 §4.4 1·5단계, docs/09). 텍스트는 바꾸지 않고 의심 여부만 낸다.

패턴 원천은 services/ai/guards/injection-patterns.yaml 이다. 휴리스틱이라 통과가 안전을 보장하지 않는다.
대조는 가드 전용 정규화(guard_norm) 텍스트에 한다. 인용 오프셋의 정본 norm 은 바꾸지 않는다.
"""

import re
import sys
import unicodedata
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from sol_ai.citation import norm

# 근거 없는 완화 문구를 보는 필드(03 §4.4 5단계)
RELAXATION_FIELDS = ("restrictions", "qualifications")
_WHITESPACE = re.compile(r"\s+")


@lru_cache(maxsize=1)
def _format_characters() -> re.Pattern[str]:
    """Unicode 일반 범주 Cf 문자 전부(이 파이썬의 Unicode 데이터 기준). 처음 쓸 때 한 번 만든다."""
    chars = "".join(
        chr(code) for code in range(sys.maxunicode + 1) if unicodedata.category(chr(code)) == "Cf"
    )
    return re.compile(f"[{re.escape(chars)}]")


def guard_norm(text: str) -> str:
    """M1(보안 점검): norm 뒤 Unicode 서식 문자(Cf: 소프트 하이픈·제로폭·방향 제어·단어 결합자 등)를 모두
    지우고 공백을 다시 접는다. "ig\u00adnore" 같은 표기로 패턴을 피하지 못하게 한다."""
    stripped = _format_characters().sub("", norm(text))
    return _WHITESPACE.sub(" ", stripped).strip()


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
        normalized = guard_norm(text)
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
                values = [guard_norm(text) for text in _strings(extracted["value"])]
                if any(p.regex.search(v) for p in self.relaxation for v in values):
                    return True
        return False
