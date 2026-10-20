"""라벨 검사(docs/21 §3.4 2단계 `sol_eval.labels check`): 형식·값 집합·근거 존재·중복·HUMAN 메타.

값 집합은 services/ai/kev/question-sets/v0.2.json(12 qid)에서 읽는다. choice 는 선택지, noul 은 "true"/"false",
score 는 등급 index("0"~"4")다. NEEDS_REVIEW 에는 사유 코드 6종 중 하나가 붙는다(21 §2).
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from sol_ai.adapters import kev_wire
from sol_ai.question_sets import (
    REQUIREMENT_LABELS,
    V0_2,
    QuestionSet,
    load_question_sets,
)
from sol_eval.dataset import EvalItem, Label, read_items
from sol_eval.paths import QUESTION_SETS_DIR

NEEDS_REVIEW = "NEEDS_REVIEW"
REQ_QID = re.compile(
    r"^req\.(requiredSkills|pastPerformance|staffing|qualifications)\[(\d+)\]\.status$"
)
NOUL_LABELS = ("true", "false")


def load_question_set() -> QuestionSet:
    return load_question_sets(QUESTION_SETS_DIR)[V0_2]


def parse_req_qid(qid: str) -> tuple[str, int] | None:
    match = REQ_QID.fullmatch(qid)
    if match is None:
        return None
    return match.group(1), int(match.group(2))


def question_for(qid: str, question_set: QuestionSet) -> kev_wire.WireQuestion | None:
    """qid 의 질문. req.<itemId>.status 는 틀을 펼친다. 세트에 없으면 None."""
    if parse_req_qid(qid) is not None:
        item_id = qid[len("req.") : -len(".status")]
        return question_set.item_question(item_id)
    return question_set.questions.get(qid)


def allowed_labels(question: kev_wire.WireQuestion) -> tuple[str, ...]:
    if question.kind == kev_wire.CHOICE:
        return tuple(question.criteria or {})
    if question.kind == kev_wire.NOUL:
        return NOUL_LABELS
    return tuple(str(i) for i in range(len(question.criteria or [])))


def qid_family(qid: str) -> str:
    """통계용 묶음: req.<field>.status 는 필드별로, 나머지는 qid 그대로."""
    parsed = parse_req_qid(qid)
    return f"req.{parsed[0]}[*].status" if parsed else qid


@dataclass
class CheckResult:
    items: int = 0
    labels: int = 0
    problems: list[str] = field(default_factory=list)
    by_family_label: Counter = field(default_factory=Counter)
    by_source: Counter = field(default_factory=Counter)
    by_drafted: Counter = field(default_factory=Counter)

    @property
    def ok(self) -> bool:
        return not self.problems


def _extraction_has_item(item: EvalItem, field_name: str, index: int) -> bool | None:
    """extraction 이 있으면 그 항목이 KNOWN 배열 안에 있는지. 없으면 None(검사 불가)."""
    if item.extraction is None:
        return None
    extracted = item.extraction[field_name]
    if extracted["state"] != "KNOWN" or not isinstance(extracted["value"], list):
        return False
    return index < len(extracted["value"])


def check_label(item: EvalItem, label: Label, question_set: QuestionSet) -> list[str]:
    where = f"{item.itemId} {label.qid}"
    problems: list[str] = []
    question = question_for(label.qid, question_set)
    if question is None:
        return [f"{where}: {V0_2} 에 없는 qid"]
    allowed = allowed_labels(question)
    if label.label not in allowed:
        problems.append(f"{where}: label 이 선택지 밖 ({question.kind}: {allowed})")
    parsed = parse_req_qid(label.qid)
    if label.reason is not None and label.label != NEEDS_REVIEW:
        problems.append(f"{where}: reason 은 NEEDS_REVIEW 에만 붙는다")
    if parsed is not None:
        if label.label == NEEDS_REVIEW and label.reason is None:
            problems.append(f"{where}: NEEDS_REVIEW 에 사유 코드가 없다")
        if label.label in REQUIREMENT_LABELS and label.label != NEEDS_REVIEW:
            if not label.noticeEvidence:
                problems.append(f"{where}: {label.label} 에 공고 쪽 근거(noticeEvidence)가 없다")
            if not label.companyEvidence:
                problems.append(f"{where}: {label.label} 에 회사 쪽 근거(companyEvidence)가 없다")
        present = _extraction_has_item(item, *parsed)
        if present is False:
            problems.append(f"{where}: extraction 의 KNOWN 배열에 그 항목이 없다")
    if label.labelSource == "HUMAN" and (not label.labeler or not label.labeledAt):
        problems.append(f"{where}: HUMAN 라벨에는 labeler·labeledAt 가 필요하다")
    if label.target is not None:
        if set(label.target) - set(allowed):
            problems.append(f"{where}: target 의 키가 선택지 밖이다")
        elif abs(sum(label.target.values()) - 1) > kev_wire.PROBABILITY_SUM_TOLERANCE:
            problems.append(f"{where}: target 의 합이 1 이 아니다")
    return problems


def check_items(items: list[EvalItem], question_set: QuestionSet) -> CheckResult:
    result = CheckResult(items=len(items))
    seen_items: set[str] = set()
    for item in items:
        if item.itemId in seen_items:
            result.problems.append(f"{item.itemId}: itemId 가 겹친다")
        seen_items.add(item.itemId)
        seen_qids: set[str] = set()
        for label in item.labels:
            result.labels += 1
            if label.qid in seen_qids:
                result.problems.append(
                    f"{item.itemId} {label.qid}: 같은 item 에 같은 qid 가 둘이다"
                )
            seen_qids.add(label.qid)
            result.problems.extend(check_label(item, label, question_set))
            result.by_family_label[(qid_family(label.qid), label.label)] += 1
            result.by_source[label.labelSource] += 1
            result.by_drafted[label.draftedBy] += 1
    return result


def check_file(path: Path) -> CheckResult:
    items = read_items(path)
    return check_items(items, load_question_set())


def format_summary(result: CheckResult) -> list[str]:
    lines = [f"items {result.items}, labels {result.labels}, problems {len(result.problems)}"]
    lines.append(
        "labelSource: " + ", ".join(f"{k} {v}" for k, v in sorted(result.by_source.items()))
    )
    lines.append(
        "draftedBy: " + ", ".join(f"{k} {v}" for k, v in sorted(result.by_drafted.items()))
    )
    families = sorted({family for family, _ in result.by_family_label})
    for family in families:
        counts = {label: n for (f, label), n in result.by_family_label.items() if f == family}
        total = sum(counts.values())
        parts = ", ".join(f"{label} {n} ({n / total:.0%})" for label, n in sorted(counts.items()))
        lines.append(f"{family}: {parts}")
    return lines
