"""자격 코드 사전(services/ai/dictionaries/qualification-codes.yaml). gateway 가 qualifications[].code 를 채운다.

찾기 규칙은 web/server/scoring/qualification-codes.ts 와 같다: 이름을 소문자·공백 제거로 정규화 →
이름·별칭 정확 일치 → 길이 4 이상 별칭 중 이름에 포함된 가장 긴 것 → 없으면 None.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

_WHITESPACE = re.compile(r"\s+")
MIN_CONTAINED_ALIAS = 4


@dataclass(frozen=True)
class QualificationCode:
    code: str
    name: str
    aliases: tuple[str, ...]
    en: str


def _normalize(name: str) -> str:
    return _WHITESPACE.sub("", name.lower())


@dataclass(frozen=True)
class QualificationDictionary:
    entries: tuple[QualificationCode, ...]

    @classmethod
    def load(cls, path: Path) -> "QualificationDictionary":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls(
            tuple(
                QualificationCode(e["code"], e["name"], tuple(e["aliases"]), e["en"])
                for e in data["codes"]
            )
        )

    def lookup(self, name: str | None) -> str | None:
        """이름으로 코드를 찾는다. 모델이 낸 code 는 보지 않는다."""
        if not name:
            return None
        target = _normalize(name)
        # 사전 순서 그대로(코드 순, 이름 다음 별칭). 정렬은 안정 정렬이라 같은 길이면 앞 항목이 이긴다
        candidates = [
            (entry.code, _normalize(alias))
            for entry in self.entries
            for alias in (entry.name, *entry.aliases)
        ]
        for code, alias in candidates:
            if alias == target:
                return code
        contained = sorted(
            (c for c in candidates if len(c[1]) >= MIN_CONTAINED_ALIAS and c[1] in target),
            key=lambda c: -len(c[1]),
        )
        return contained[0][0] if contained else None

    def get(self, code: str | None) -> QualificationCode | None:
        return next((entry for entry in self.entries if entry.code == code), None)
