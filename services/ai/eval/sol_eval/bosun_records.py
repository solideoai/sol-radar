"""EvalItem·Label → Bosun 질문 단위 레코드(docs/15 §4.1, 22 §4.1, ADR-034 7번): 한 줄 = 질문 하나.

- rowId = sha256(itemId + ":" + qid). state 는 서빙 빌더(state.py)의 en.v0.2 문자열 그대로, stateHash = sha256(state).
- candidates: choice 는 criteria 키 순서 {id, label, description}, score 는 {id:"i", label:legend[i]},
  noul 은 {id:"true"/"false", label 같음, description: criteria 문구 또는 "yes"/"no"}.
- gold: candidates 순서의 분포. Label.target 이 있으면 soft, 없으면 one-hot.
- 제외 규칙(22 §4.1 표): v0.1 4문항 전부, RULE_SILVER 는 train 만, techFit·perfRelevance 는 HUMAN 만,
  risk.* 는 CONSTRUCTED 만, state 에 [itemId] 표시가 없는 req.* 항목.
- 같은 (stateHash, qid) 에 다른 gold 가 붙으면 충돌이다(호출자가 ExportError 로 바꾼다).

순수 함수만 둔다. 파일을 쓰지 않는다.
"""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sol_ai.adapters import kev_wire
from sol_ai.question_sets import (
    Q_FIT,
    Q_MANDATORY_RISK,
    Q_NEEDS_HUMAN_REVIEW,
    Q_RECOMMENDATION,
    RISK_QIDS,
    SCORE_QIDS,
    QuestionSet,
)
from sol_eval.dataset import EvalItem, Label
from sol_eval.labels import allowed_labels, parse_req_qid, question_for
from sol_eval.paths import QUESTION_SET_VERSION
from sol_eval.state import StateDocument, state_hash

BOSUN_LANGUAGE = "en"
BOSUN_STATE_TEMPLATE = "en.v0.2"
BOSUN_DIR = "bosun"
# 학습하지 않는 참고 질문(ADR-034 2번). 레코드를 만들지 않는다
V0_1_QIDS = (Q_RECOMMENDATION, Q_FIT, Q_MANDATORY_RISK, Q_NEEDS_HUMAN_REVIEW)
NOUL_DEFAULT_DESCRIPTIONS = {"true": "yes", "false": "no"}

# 제외 사유 코드(export-report·manifest 의 excluded 집계 키)
EXCLUDE_V0_1 = "v01Question"
EXCLUDE_RULE_SILVER_OUTSIDE_TRAIN = "ruleSilverOutsideTrain"
EXCLUDE_SCORE_NOT_HUMAN = "scoreNotHuman"
EXCLUDE_RISK_NOT_CONSTRUCTED = "riskNotConstructed"
EXCLUDE_NO_STATE_MARKER = "noStateMarker"


class BosunRecordError(ValueError):
    """레코드를 만들 수 없는 라벨(질문 세트 밖 qid, 선택지 밖 label, target 키 불일치)."""


@dataclass(frozen=True)
class Candidate:
    id: str
    label: str
    description: str | None = None

    def to_json(self) -> dict[str, str]:
        out = {"id": self.id, "label": self.label}
        if self.description is not None:
            out["description"] = self.description
        return out


def row_id(item_id: str, qid: str) -> str:
    return hashlib.sha256(f"{item_id}:{qid}".encode()).hexdigest()


def candidates_for(question: kev_wire.WireQuestion) -> list[Candidate]:
    """질문 타입별 후보(15 §4.1 변환 규칙). 순서가 gold.probabilities 의 순서다."""
    if question.kind == kev_wire.CHOICE:
        criteria = question.criteria if isinstance(question.criteria, dict) else {}
        return [Candidate(key, key, text) for key, text in criteria.items()]
    if question.kind == kev_wire.SCORE:
        legend = question.criteria if isinstance(question.criteria, list) else []
        return [Candidate(str(index), name) for index, name in enumerate(legend)]
    criteria = question.criteria if isinstance(question.criteria, dict) else {}
    return [
        Candidate(key, key, criteria.get(key, NOUL_DEFAULT_DESCRIPTIONS[key]))
        for key in ("true", "false")
    ]


def gold_for(label: Label, candidates: list[Candidate]) -> dict[str, Any]:
    """gold{candidateId, probabilities[]}. target 이 있으면 soft(후보 순서로 펼친다), 없으면 one-hot."""
    ids = [c.id for c in candidates]
    if label.label not in ids:
        raise BosunRecordError(f"{label.qid}: label 이 후보 밖")
    if label.target is None:
        probabilities = [1.0 if c == label.label else 0.0 for c in ids]
    else:
        if set(label.target) - set(ids):
            raise BosunRecordError(f"{label.qid}: target 의 키가 후보 밖")
        probabilities = [float(label.target.get(c, 0.0)) for c in ids]
    return {"candidateId": label.label, "probabilities": probabilities}


def exclusion_reason(label: Label, split: str, state_item_ids: Iterable[str]) -> str | None:
    """레코드로 만들지 않는 라벨이면 사유 코드, 만들면 None(22 §4.1 표)."""
    if label.qid in V0_1_QIDS:
        return EXCLUDE_V0_1
    if label.labelSource == "RULE_SILVER" and split != "train":
        return EXCLUDE_RULE_SILVER_OUTSIDE_TRAIN
    if label.qid in SCORE_QIDS and label.labelSource != "HUMAN":
        return EXCLUDE_SCORE_NOT_HUMAN
    if label.qid in RISK_QIDS and label.labelSource != "CONSTRUCTED":
        return EXCLUDE_RISK_NOT_CONSTRUCTED
    parsed = parse_req_qid(label.qid)
    if parsed is not None and f"{parsed[0]}[{parsed[1]}]" not in set(state_item_ids):
        return EXCLUDE_NO_STATE_MARKER
    return None


def build_record(
    item: EvalItem,
    label: Label,
    split: str,
    document: StateDocument,
    question_set: QuestionSet,
) -> dict[str, Any]:
    """레코드 하나. 필드 순서는 15 §4.1 표 순서다."""
    question = question_for(label.qid, question_set)
    if question is None:
        raise BosunRecordError(f"{item.itemId} {label.qid}: 질문 세트에 없는 qid")
    if label.label not in allowed_labels(question):
        raise BosunRecordError(f"{item.itemId} {label.qid}: label 이 선택지 밖")
    candidates = candidates_for(question)
    state = document.text
    return {
        "rowId": row_id(item.itemId, label.qid),
        "itemId": item.itemId,
        "clusterId": item.clusterId,
        "split": split,
        "bid": {
            "source": item.bid.source,
            "noticeId": item.bid.noticeId,
            "revisionId": item.bid.revisionId,
        },
        "companyVariantId": item.companyVariantId,
        "qid": label.qid,
        "questionType": question.kind,
        "instructions": question.instructions,
        "candidates": [c.to_json() for c in candidates],
        "state": state,
        "stateHash": state_hash(state),
        "stateTemplate": BOSUN_STATE_TEMPLATE,
        "questionSet": QUESTION_SET_VERSION,
        "gold": gold_for(label, candidates),
        "labelSource": label.labelSource,
        "reason": label.reason,
        "noticeEvidence": list(label.noticeEvidence),
        "companyEvidence": [ref.model_dump() for ref in label.companyEvidence],
    }


def gold_key(record: dict[str, Any]) -> tuple[str, tuple[float, ...]]:
    """충돌 판정용 gold 표현(candidateId + 분포)."""
    gold = record["gold"]
    return gold["candidateId"], tuple(round(p, 6) for p in gold["probabilities"])
