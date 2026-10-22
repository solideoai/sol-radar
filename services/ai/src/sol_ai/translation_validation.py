"""영어 State 값의 공통 검증. 추출/번역 생성과 State 소비 양쪽이 같은 검사를 쓴다.

의미 동치의 증명은 아니다. 숫자·식별자·단위·명시적 조건의 손실을 보수적으로 거부한다.
"""

import re
from collections import Counter
from decimal import Decimal

from sol_ai.citation import norm
from sol_ai.guards import InjectionGuard

HANGUL = re.compile("[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]")
NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")
IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[.+/#-][A-Za-z0-9]+)*")
MAX_VALUE_CHARS = 2_000
UNITS = {
    "년": r"years?",
    "개월": r"months?",
    "일": r"days?",
    "건": r"projects?|contracts?|cases?",
    "명": r"people|persons?|staff|engineers?|developers?",
    "원": r"KRW|won",
    "%": r"%|percent",
    "억": r"hundred million|eok",
    "만": r"ten thousand|man",
}
CONDITIONS = (
    ("이상", r"at least|not less than|no less than|>=|minimum"),
    ("이하", r"at most|not more than|no more than|<=|maximum"),
    ("초과", r"more than|greater than|exceed|>"),
    ("미만", r"less than|fewer than|below|<"),
    ("이내", r"within|no (?:more|later) than|at most"),
    ("필수", r"mandatory|required|must"),
    ("불가", r"prohibited|not (?:allowed|permitted)|cannot|ineligible"),
    ("금지", r"prohibited|not (?:allowed|permitted)|forbidden"),
    ("제외", r"excluded|excluding|except|ineligible"),
    ("미보유", r"not held|does not hold|without"),
    ("유효", r"valid"),
)


def _numbers(text: str) -> Counter:
    return Counter(Decimal(t.replace(",", "")) for t in NUMBER_TOKEN.findall(text))


def _has_condition(text: str, pattern: str) -> bool:
    # 경계로 invalid/valid 같은 부분 일치를 막는다. 허용된 부정 표현(not less than 등)은
    # pattern 전체로 먼저 매칭하므로, 그 바깥의 not/no/never만 반대 의미로 거부한다.
    for match in re.finditer(rf"(?<!\w)(?:{pattern})(?!\w)", text, re.IGNORECASE):
        prefix = text[: match.start()]
        if not re.search(r"\b(?:not|no|never|without|no longer)\s+$", prefix, re.IGNORECASE):
            return True
    return False


def valid_translation(source: str, candidate: object, guard: InjectionGuard) -> bool:
    if not isinstance(candidate, str) or len(candidate) > MAX_VALUE_CHARS:
        return False
    text = norm(candidate)
    if (
        not text
        or not text.isascii()
        or not re.search(r"[A-Za-z]", text)
        or any(ord(c) < 32 or ord(c) == 127 for c in text)
        or text.lower() in {"(untranslated)", "(unknown)", "unknown", "n/a", "none"}
        or guard.matches(source)
        or guard.matches(candidate)
        or re.search(r"<\s*/?\s*(?:values|translations|system|assistant)\b", text, re.IGNORECASE)
        or _numbers(norm(source)) != _numbers(text)
    ):
        return False
    # 원문의 ASCII 기술/자격 식별자는 글자 그대로 보존한다(Java, ISO, RAG/LLM 등).
    if not set(IDENTIFIER.findall(source)) <= set(IDENTIFIER.findall(text)):
        return False
    for korean, english in CONDITIONS:
        if korean in source and not _has_condition(text, english):
            return False
    # 비교 표현은 해당 숫자에 붙어야 한다. 다른 절의 'at least'로 손실을 숨기지 못하게 한다.
    for match in re.finditer(
        r"(\d[\d,]*(?:\.\d+)?)\s*(?:개월|년|일|건|명|원|%)?\s*(이상|이하|초과|미만|이내)", source
    ):
        number, comparison = match.groups()
        digits = r",?".join(re.escape(c) for c in number.replace(",", ""))
        english = dict(CONDITIONS)[comparison]
        if not _has_condition(text, rf"(?:{english})\s*(?:of\s*)?{digits}(?![\d,])"):
            return False
    # 숫자를 그대로 두고 연수와 건수를 맞바꾸는 출력도 거부한다. 단위 앞에는 숫자 없는 짧은 수식어만 허용한다.
    for match in re.finditer(r"(\d[\d,]*(?:\.\d+)?)\s*(개월|년|일|건|명|원|%|억|만)", source):
        number, unit = match.groups()
        digits = number.replace(",", "")
        spelled = r",?".join(re.escape(c) for c in digits)
        if not re.search(
            rf"(?<![\d,]){spelled}(?![\d,])\s*(?:[A-Za-z-]+\s+){{0,5}}(?:{UNITS[unit]})(?![A-Za-z])",
            text,
            re.IGNORECASE,
        ):
            return False
    return True
