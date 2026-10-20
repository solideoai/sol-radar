"""EvalItem JSONL → Kev JSONL(docs/21 §3.7, 22 §4.1): 한 줄 = {"state": …, "questions": {qid: {...}}}.

- state 는 서빙 빌더(state.py)로 만든다. en·ko 두 벌.
- instructions·criteria 는 v0.2.json 원문 그대로(req 틀은 {itemId} 만 항목 경로로 바꾼다. 서빙과 같다).
- label 형: choice 는 선택지 문자열, noul 은 JSON boolean, score 는 등급 index 정수(22 §4.1 예시 기준).
- 단언: 같은 state 에 다른 라벨 0건, 같은 공고×원형의 변형끼리 state 가 다름, en state 에 한글 0자.
- 경고: 선택지별 정답 비율 5% 미만, --max-state(글자/4 근사) 초과 레코드.
"""

import hashlib
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sol_ai.adapters import kev_wire
from sol_ai.kev_state import CHARS_PER_TOKEN
from sol_ai.question_sets import Q_REQUIREMENT_STATUS, QuestionSet
from sol_eval.dataset import SPLITS, EvalItem, Label, read_items
from sol_eval.labels import (
    allowed_labels,
    load_question_set,
    parse_req_qid,
    qid_family,
    question_for,
)
from sol_eval.state import LANGUAGES, build_state, has_hangul, state_hash

MIN_LABEL_SHARE = 0.05
DEFAULT_MAX_STATE_TOKENS = 2048


class ExportError(ValueError):
    pass


@dataclass
class ExportOptions:
    out_dir: Path
    languages: tuple[str, ...] = LANGUAGES
    max_state_tokens: int = DEFAULT_MAX_STATE_TOKENS
    splits: tuple[str, ...] = SPLITS


@dataclass
class SplitLanguageReport:
    records: int = 0
    questions: int = 0
    items: int = 0
    merged_duplicates: int = 0
    dropped_no_marker: int = 0
    dropped_items_without_questions: int = 0
    max_state_chars: int = 0
    over_max_state: int = 0
    hangul_in_en: int = 0
    label_counts: Counter = field(default_factory=Counter)
    state_hashes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    max_state_tokens: int = DEFAULT_MAX_STATE_TOKENS
    # stateHash → itemIds (state 원문 없이 레코드를 item 으로 되돌리는 색인)
    index: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    def to_json(self, max_tokens: int) -> dict[str, Any]:
        return {
            "records": self.records,
            "questions": self.questions,
            "items": self.items,
            "mergedDuplicateStates": self.merged_duplicates,
            "droppedLabelsWithoutStateMarker": self.dropped_no_marker,
            "droppedItemsWithoutQuestions": self.dropped_items_without_questions,
            "maxStateChars": self.max_state_chars,
            "maxStateTokensApprox": math.ceil(self.max_state_chars / CHARS_PER_TOKEN),
            "tokenMethod": f"chars/{CHARS_PER_TOKEN} approximation (tokenizer not computed)",
            "recordsOverMaxState": self.over_max_state,
            "maxStateTokens": max_tokens,
            "hangulCharsInEnState": self.hangul_in_en,
            "labelsByFamilyAndValue": {
                f"{f}={v}": n for (f, v), n in sorted(self.label_counts.items())
            },
            "stateFingerprint": hashlib.sha256(
                "".join(sorted(self.state_hashes)).encode()
            ).hexdigest(),
            "warnings": self.warnings,
        }


def typed_label(label: Label, question: kev_wire.WireQuestion) -> Any:
    if question.kind == kev_wire.NOUL:
        return label.label == "true"
    if question.kind == kev_wire.SCORE:
        return int(label.label)
    return label.label


def question_entry(label: Label, question: kev_wire.WireQuestion) -> dict[str, Any]:
    entry: dict[str, Any] = {
        kev_wire.QUESTION_TYPE: question.kind,
        kev_wire.QUESTION_INSTRUCTIONS: question.instructions,
    }
    if question.criteria is not None:
        entry[kev_wire.QUESTION_CRITERIA] = question.criteria
    entry["label"] = typed_label(label, question)
    if label.target is not None:
        entry["target"] = label.target
    return entry


def _ordered_labels(
    item: EvalItem, state_item_ids: list[str], question_set: QuestionSet
) -> list[Label]:
    """state 의 항목 순서(req) → 질문 세트 파일 순서(공고 단위)."""
    by_qid = {label.qid: label for label in item.labels}
    ordered: list[Label] = []
    for item_id in state_item_ids:
        qid = Q_REQUIREMENT_STATUS.replace("{itemId}", item_id)
        if qid in by_qid:
            ordered.append(by_qid.pop(qid))
    for qid in question_set.questions:
        if qid in by_qid:
            ordered.append(by_qid.pop(qid))
    ordered.extend(by_qid.values())
    return ordered


def _records_for(
    items: list[EvalItem],
    language: str,
    question_set: QuestionSet,
    report: SplitLanguageReport,
    split: str,
) -> list[dict[str, Any]]:
    by_state: dict[str, dict[str, Any]] = {}
    index = report.index
    group_states: dict[tuple[str, str, str], dict[str, str]] = defaultdict(dict)
    for item in items:
        report.items += 1
        document = build_state(item, language)
        state = document.text
        digest = state_hash(state)
        if language == "en":
            report.hangul_in_en += sum(1 for ch in state if has_hangul(ch))
        group = (item.bid.noticeId, item.bid.revisionId, item.company_id() or "")
        variant = item.companyVariantId or item.itemId
        group_states[group][variant] = digest
        questions: dict[str, Any] = {}
        for label in _ordered_labels(item, document.item_ids, question_set):
            if label.labelSource == "RULE_SILVER" and split != "train":
                raise ExportError(f"{item.itemId} {label.qid}: RULE_SILVER 는 train 에만 둔다")
            parsed = parse_req_qid(label.qid)
            if parsed is not None:
                item_id = f"{parsed[0]}[{parsed[1]}]"
                if item_id not in document.item_ids:
                    # 사전 코드 자격처럼 state 에 [itemId] 표시가 없는 항목은 질문을 만들 수 없다
                    report.dropped_no_marker += 1
                    continue
            question = question_for(label.qid, question_set)
            if question is None:
                raise ExportError(f"{item.itemId} {label.qid}: 질문 세트에 없는 qid")
            if label.label not in allowed_labels(question):
                raise ExportError(f"{item.itemId} {label.qid}: label 이 선택지 밖")
            questions[label.qid] = question_entry(label, question)
        if not questions:
            report.dropped_items_without_questions += 1
            continue
        existing = by_state.get(state)
        if existing is None:
            by_state[state] = {kev_wire.STATE: state, kev_wire.QUESTIONS: questions}
        else:
            report.merged_duplicates += 1
            for qid, entry in questions.items():
                previous = existing[kev_wire.QUESTIONS].get(qid)
                if previous is not None and previous["label"] != entry["label"]:
                    raise ExportError(
                        f"같은 state 에 다른 라벨: {qid} ({index[digest][0]} vs {item.itemId})"
                    )
                existing[kev_wire.QUESTIONS].setdefault(qid, entry)
        index[digest].append(item.itemId)
        report.max_state_chars = max(report.max_state_chars, len(state))
        if len(state) / CHARS_PER_TOKEN > report.max_state_tokens:
            report.over_max_state += 1
    for group, variants in group_states.items():
        if len(set(variants.values())) != len(variants):
            dup = [v for v, d in variants.items() if list(variants.values()).count(d) > 1]
            raise ExportError(f"변형끼리 state 가 같다: {group[0]} {group[2]} {dup}")
    records = list(by_state.values())
    for record in records:
        for qid, entry in record[kev_wire.QUESTIONS].items():
            report.label_counts[(qid_family(qid), str(entry["label"]).lower())] += 1
        report.questions += len(record[kev_wire.QUESTIONS])
    report.records = len(records)
    report.state_hashes = [state_hash(r[kev_wire.STATE]) for r in records]
    return records


def _balance_warnings(report: SplitLanguageReport, question_set: QuestionSet) -> None:
    totals: Counter = Counter()
    for (family, _value), n in report.label_counts.items():
        totals[family] += n
    for family, total in totals.items():
        sample_qid = family.replace("[*]", "[0]")
        question = question_for(sample_qid, question_set)
        if question is None:
            continue
        for value in allowed_labels(question):
            share = report.label_counts[(family, value.lower())] / total
            if share < MIN_LABEL_SHARE:
                report.warnings.append(
                    f"{family}: {value} 비율 {share:.1%} < {MIN_LABEL_SHARE:.0%} (n={total})"
                )


def export(options: ExportOptions) -> dict[str, Any]:
    question_set = load_question_set()
    kev_dir = options.out_dir / "kev"
    kev_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "schemaVersion": "sol-eval-export-report/v0.1",
        "questionSet": question_set.version,
        "languages": list(options.languages),
        "maxStateTokens": options.max_state_tokens,
        "splits": {},
    }
    for split in options.splits:
        items_path = options.out_dir / f"items.{split}.jsonl"
        if not items_path.exists():
            continue
        items = read_items(items_path)
        summary["splits"][split] = {}
        for language in options.languages:
            report = SplitLanguageReport(max_state_tokens=options.max_state_tokens)
            records = _records_for(items, language, question_set, report, split)
            _balance_warnings(report, question_set)
            if report.hangul_in_en:
                raise ExportError(f"{split}.{language}: en state 에 한글 {report.hangul_in_en}자")
            target = kev_dir / f"{split}.{language}.jsonl"
            with target.open("w", encoding="utf-8") as handle:
                for record in records:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            index_path = kev_dir / f"{split}.{language}.index.jsonl"
            with index_path.open("w", encoding="utf-8") as handle:
                for digest, item_ids in sorted(report.index.items()):
                    handle.write(json.dumps({"stateHash": digest, "itemIds": item_ids}) + "\n")
            summary["splits"][split][language] = {
                **report.to_json(options.max_state_tokens),
                "file": str(target.relative_to(options.out_dir)),
            }
    (options.out_dir / "export-report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return summary
