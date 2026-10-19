"""Kev 질문 세트(services/ai/kev/question-sets/*.json). 질문 문자열은 코드에 고정된 파일에서만 온다(docs/09).

파일의 질문 항목은 wire 질문 모양 그대로다. 문자열을 바꾸면 버전을 올린다(docs/03 §5.5).
"""

import json
from dataclasses import dataclass
from pathlib import Path

from sol_ai.adapters import kev_wire

V0_1 = "kev-qs/v0.1"

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


@dataclass(frozen=True)
class QuestionSet:
    version: str
    questions: dict[str, kev_wire.WireQuestion]


def load_question_sets(directory: Path) -> dict[str, QuestionSet]:
    """디렉터리의 질문 세트를 버전 → 세트로 읽는다. v0.1 은 03 §5.5 의 4질문·타입과 같아야 한다."""
    sets: dict[str, QuestionSet] = {}
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        questions = {
            qid: kev_wire.question_from_file(qid, entry) for qid, entry in data["questions"].items()
        }
        sets[data["version"]] = QuestionSet(data["version"], questions)
    v01 = sets.get(V0_1)
    if v01 is None or {q: v01.questions[q].kind for q in v01.questions} != V0_1_TYPES:
        raise ValueError(f"{V0_1} 질문 세트가 03 §5.5 와 다르다")
    return sets
