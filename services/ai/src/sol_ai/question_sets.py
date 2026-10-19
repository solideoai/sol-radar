"""Kev 질문 세트(services/ai/kev/question-sets/*.json). 질문 문자열은 코드에 고정된 파일에서만 온다(docs/09).

파일의 질문 항목은 wire 질문 모양 그대로다. 문자열을 바꾸면 버전을 올린다(docs/03 §5.5).
세트는 version 과 language(파일의 "language", 없으면 en)로 구분한다. 한국어판(v0.2.ko.json)은 평가 전용이고
아직 어디서도 쓰지 않는다. 어떤 버전을 답하는지는 어댑터의 지원 집합이 정한다(파일이 있다고 지원하는 것이 아니다).
"""

import json
from dataclasses import dataclass
from pathlib import Path

from sol_ai.adapters import kev_wire

V0_1 = "kev-qs/v0.1"
V0_2 = "kev-qs/v0.2"
LANGUAGE_EN = "en"

# kev-qs/v0.1 질문 id(03 §5.5). KevAssist 의 같은 이름 필드로 옮긴다
Q_RECOMMENDATION = "recommendation"
Q_MANDATORY_RISK = "mandatoryRisk"
Q_NEEDS_HUMAN_REVIEW = "needsHumanReview"
Q_FIT = "fit"
V0_1_TYPES = {
    Q_RECOMMENDATION: kev_wire.CHOICE,
    Q_MANDATORY_RISK: kev_wire.NOUL,
    Q_NEEDS_HUMAN_REVIEW: kev_wire.NOUL,
    Q_FIT: kev_wire.SCORE,
}
# kev-qs/v0.2(03 §5.10): v0.1 네 질문 + 항목별 상태(틀) + 공고 단위 점수·리스크
Q_REQUIREMENT_STATUS = "req.{itemId}.status"
V0_2_TYPES = {
    **V0_1_TYPES,
    Q_REQUIREMENT_STATUS: kev_wire.CHOICE,
    "techFit": kev_wire.SCORE,
    "perfRelevance": kev_wire.SCORE,
    "risk.schedule": kev_wire.NOUL,
    "risk.staffing": kev_wire.NOUL,
    "risk.scale": kev_wire.NOUL,
    "risk.techGap": kev_wire.NOUL,
    "risk.scopeAmbiguity": kev_wire.NOUL,
}
# 파일에 있으면 질문 id·type 이 이 표와 같아야 한다
EXPECTED_TYPES = {V0_1: V0_1_TYPES, V0_2: V0_2_TYPES}


@dataclass(frozen=True)
class QuestionSet:
    version: str
    questions: dict[str, kev_wire.WireQuestion]
    language: str = LANGUAGE_EN


def load_question_sets(directory: Path, language: str = LANGUAGE_EN) -> dict[str, QuestionSet]:
    """디렉터리의 질문 세트 가운데 language(파일의 "language", 없으면 en)의 것을 버전 → 세트로 읽는다.

    언어가 다른 파일(예: v0.2.ko.json, 평가 전용)은 다른 언어 세트를 덮지 않는다. 세트가 있으면 질문 id·type 이
    03 §5.5·§5.10 과 같아야 하고(다르면 ValueError → 기동 실패), 영어 v0.1 은 반드시 있어야 한다.
    """
    sets: dict[str, QuestionSet] = {}
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("language", LANGUAGE_EN) != language:
            continue
        version = data["version"]
        if version in sets:
            raise ValueError(f"질문 세트 {version}({language}) 파일이 둘 이상이다")
        questions = {
            qid: kev_wire.question_from_file(qid, entry) for qid, entry in data["questions"].items()
        }
        expected = EXPECTED_TYPES.get(version)
        if expected is not None and {q: v.kind for q, v in questions.items()} != expected:
            raise ValueError(f"{version}({language}) 질문 id·type 이 03 §5.5·§5.10 과 다르다")
        sets[version] = QuestionSet(version, questions, language)
    if language == LANGUAGE_EN and V0_1 not in sets:
        raise ValueError(f"{V0_1} 질문 세트가 없다")
    return sets
