"""`export --format bosun`: items.{split}.jsonl → bosun/{split}.en.jsonl + index + manifest.json(docs/15 §4.1, 21 §3.7).

- 레코드 변환 규칙은 bosun_records.py. 여기서는 파일 쓰기·단언·집계만 한다.
- 단언(위반이면 ExportError): 같은 (stateHash, qid) 에 다른 gold, 같은 공고×원형의 변형끼리 같은 state, en state 에 한글.
- 같은 (stateHash, qid) 에 같은 gold 는 첫 행만 남긴다(mergedDuplicateRows).
- manifest.json: 분할별 건수, qid 가족별·선택지별 분포(≥5% 아니면 warning), 파일 sha256,
  train∩(dev∪test) 클러스터 수, held-out 기업 원형 id(train 에 없는 companyId), state 토큰 최대값(글자/4 근사).
- kev/ 디렉터리는 만들지 않는다. 기존 Kev 형식 export 는 export.py 그대로다.
"""

import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sol_ai.kev_state import CHARS_PER_TOKEN
from sol_ai.question_sets import QuestionSet
from sol_eval.bosun_records import (
    BOSUN_DIR,
    BOSUN_LANGUAGE,
    BOSUN_STATE_TEMPLATE,
    BosunRecordError,
    build_record,
    exclusion_reason,
    gold_key,
)
from sol_eval.dataset import SPLITS, EvalItem, read_items
from sol_eval.labels import load_question_set, qid_family
from sol_eval.manifest import git_commit, sha256_file
from sol_eval.paths import QUESTION_SET_FILE, QUESTION_SET_VERSION, REPO_ROOT, STATE_TEMPLATE_FILES
from sol_eval.state import build_state, has_hangul, state_hash

BOSUN_MANIFEST_SCHEMA_VERSION = "sol-bosun-manifest/v0.1"
BOSUN_EXPORT_REPORT_SCHEMA_VERSION = "sol-eval-export-report/v0.2"
MANIFEST_FILE = "manifest.json"
EXPORT_REPORT_FILE = "export-report.json"
MIN_CANDIDATE_SHARE = 0.05


class BosunExportError(ValueError):
    pass


@dataclass
class BosunExportOptions:
    out_dir: Path
    splits: tuple[str, ...] = SPLITS
    min_share: float = MIN_CANDIDATE_SHARE


@dataclass
class SplitResult:
    split: str
    records: list[dict[str, Any]] = field(default_factory=list)
    index_rows: list[dict[str, Any]] = field(default_factory=list)
    items: int = 0
    labels: int = 0
    excluded: Counter = field(default_factory=Counter)
    merged_duplicate_rows: int = 0
    max_state_chars: int = 0
    # (qid 가족, 후보 id) → 건수
    distribution: Counter = field(default_factory=Counter)
    cluster_ids: set[str] = field(default_factory=set)
    company_ids: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)

    def distribution_json(self) -> dict[str, dict[str, dict[str, float | int]]]:
        totals: Counter = Counter()
        for (family, _candidate), n in self.distribution.items():
            totals[family] += n
        out: dict[str, dict[str, dict[str, float | int]]] = defaultdict(dict)
        for (family, candidate), n in sorted(self.distribution.items()):
            out[family][candidate] = {"count": n, "share": round(n / totals[family], 4)}
        return dict(out)

    def to_json(self) -> dict[str, Any]:
        return {
            "records": len(self.records),
            "items": self.items,
            "labels": self.labels,
            "excluded": dict(sorted(self.excluded.items())),
            "mergedDuplicateRows": self.merged_duplicate_rows,
            "clusters": len(self.cluster_ids),
            "companies": sorted(self.company_ids),
            "maxStateChars": self.max_state_chars,
            "maxStateTokensApprox": math.ceil(self.max_state_chars / CHARS_PER_TOKEN),
            "distribution": self.distribution_json(),
            "warnings": list(self.warnings),
        }


def _company_id(item: EvalItem) -> str:
    company = item.company_id()
    if company:
        return company
    # 빌더는 companyVariantId 를 "<companyId>:<variant>" 로 만든다. company 가 없으면 접두를 쓴다
    if item.companyVariantId and ":" in item.companyVariantId:
        return item.companyVariantId.split(":", 1)[0]
    return ""


def records_for_split(items: list[EvalItem], split: str, question_set: QuestionSet) -> SplitResult:
    result = SplitResult(split=split)
    first_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    group_states: dict[tuple[str, str, str], dict[str, str]] = defaultdict(dict)
    for item in items:
        result.items += 1
        document = build_state(item, BOSUN_LANGUAGE)
        state = document.text
        hangul = sum(1 for ch in state if has_hangul(ch))
        if hangul:
            raise BosunExportError(f"{item.itemId}: en state 에 한글 {hangul}자")
        digest = state_hash(state)
        company_id = _company_id(item)
        group_states[(item.bid.noticeId, item.bid.revisionId, company_id)][
            item.companyVariantId or item.itemId
        ] = digest
        kept = 0
        for label in item.labels:
            result.labels += 1
            reason = exclusion_reason(label, split, document.item_ids)
            if reason is not None:
                result.excluded[reason] += 1
                continue
            try:
                record = build_record(item, label, split, document, question_set)
            except BosunRecordError as error:
                raise BosunExportError(str(error)) from error
            key = (digest, label.qid)
            previous = first_by_key.get(key)
            if previous is not None:
                if gold_key(previous) != gold_key(record):
                    raise BosunExportError(
                        f"같은 state 에 다른 라벨: {label.qid} "
                        f"({previous['itemId']} vs {item.itemId})"
                    )
                result.merged_duplicate_rows += 1
                continue
            first_by_key[key] = record
            result.records.append(record)
            result.index_rows.append(
                {
                    "rowId": record["rowId"],
                    "itemId": item.itemId,
                    "qid": label.qid,
                    "clusterId": item.clusterId,
                    "companyId": company_id,
                    "stateHash": digest,
                }
            )
            result.distribution[(qid_family(label.qid), record["gold"]["candidateId"])] += 1
            kept += 1
        if kept:
            result.cluster_ids.add(item.clusterId or "")
            result.company_ids.add(company_id)
            result.max_state_chars = max(result.max_state_chars, len(state))
    for group, variants in group_states.items():
        digests = list(variants.values())
        if len(set(digests)) != len(digests):
            dup = sorted(v for v, d in variants.items() if digests.count(d) > 1)
            raise BosunExportError(f"변형끼리 state 가 같다: {group[0]} {group[2]} {dup}")
    return result


def share_warnings(result: SplitResult, min_share: float) -> list[str]:
    """qid 가족별로 후보마다 정답 비율이 min_share 미만이면 경고 한 줄."""
    candidates_by_family: dict[str, list[str]] = {}
    for record in result.records:
        family = qid_family(record["qid"])
        candidates_by_family.setdefault(family, [c["id"] for c in record["candidates"]])
    totals: Counter = Counter()
    for (family, _candidate), n in result.distribution.items():
        totals[family] += n
    warnings: list[str] = []
    for family, candidate_ids in sorted(candidates_by_family.items()):
        total = totals[family]
        for candidate in candidate_ids:
            share = result.distribution[(family, candidate)] / total
            if share < min_share:
                warnings.append(
                    f"{result.split} {family}: {candidate} 비율 {share:.1%} < {min_share:.0%}"
                    f" (n={total})"
                )
    return warnings


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def cluster_overlap(results: dict[str, SplitResult]) -> dict[str, Any]:
    def clusters(split: str) -> set[str]:
        return results[split].cluster_ids if split in results else set()

    train, dev, test = clusters("train"), clusters("dev"), clusters("test")
    return {
        "trainDev": len(train & dev),
        "trainTest": len(train & test),
        "devTest": len(dev & test),
        "trainInDevOrTest": len(train & (dev | test)),
    }


def held_out_companies(results: dict[str, SplitResult]) -> list[str]:
    train = results["train"].company_ids if "train" in results else set()
    held: set[str] = set()
    for split, result in results.items():
        if split != "train":
            held |= result.company_ids - train
    return sorted(c for c in held if c)


def build_manifest(
    out_dir: Path, results: dict[str, SplitResult], dataset_version: str
) -> dict[str, Any]:
    files: dict[str, str] = {}
    for path in sorted(out_dir.rglob("*")):
        if path.is_file() and path.name != MANIFEST_FILE:
            files[str(path.relative_to(out_dir))] = sha256_file(path)
    max_chars = max((r.max_state_chars for r in results.values()), default=0)
    template_file = STATE_TEMPLATE_FILES[BOSUN_LANGUAGE]
    return {
        "schemaVersion": BOSUN_MANIFEST_SCHEMA_VERSION,
        "format": "bosun",
        "datasetVersion": dataset_version,
        "createdAt": datetime.now(UTC).isoformat(),
        "gitCommit": git_commit(),
        "questionSet": {
            "version": QUESTION_SET_VERSION,
            "file": str(QUESTION_SET_FILE.relative_to(REPO_ROOT)),
            "sha256": sha256_file(QUESTION_SET_FILE),
        },
        "stateTemplate": {
            "name": BOSUN_STATE_TEMPLATE,
            "file": str(template_file.relative_to(REPO_ROOT)),
            "sha256": sha256_file(template_file),
        },
        "counts": {
            split: {
                "records": len(r.records),
                "items": r.items,
                "labels": r.labels,
                "clusters": len(r.cluster_ids),
                "excluded": dict(sorted(r.excluded.items())),
                "mergedDuplicateRows": r.merged_duplicate_rows,
            }
            for split, r in results.items()
        },
        "distribution": {split: r.distribution_json() for split, r in results.items()},
        "companiesBySplit": {split: sorted(r.company_ids) for split, r in results.items()},
        "heldOutCompanies": held_out_companies(results),
        "leakCheck": {"clusterOverlap": cluster_overlap(results)},
        "stateTokens": {
            "method": f"chars/{CHARS_PER_TOKEN} approximation",
            "tokenizerComputed": False,
            "maxChars": max_chars,
            "maxTokensApprox": math.ceil(max_chars / CHARS_PER_TOKEN),
            "bySplit": {
                split: math.ceil(r.max_state_chars / CHARS_PER_TOKEN)
                for split, r in results.items()
            },
        },
        "warnings": [w for r in results.values() for w in r.warnings],
        "files": files,
    }


def export_bosun(options: BosunExportOptions) -> dict[str, Any]:
    question_set = load_question_set()
    bosun_dir = options.out_dir / BOSUN_DIR
    bosun_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, SplitResult] = {}
    for split in options.splits:
        items_path = options.out_dir / f"items.{split}.jsonl"
        if not items_path.exists():
            continue
        result = records_for_split(read_items(items_path), split, question_set)
        result.warnings = share_warnings(result, options.min_share)
        _write_jsonl(bosun_dir / f"{split}.{BOSUN_LANGUAGE}.jsonl", result.records)
        _write_jsonl(bosun_dir / f"{split}.{BOSUN_LANGUAGE}.index.jsonl", result.index_rows)
        results[split] = result
    if not results:
        raise BosunExportError(f"{options.out_dir}: items.*.jsonl 이 없다. build 를 먼저 돈다")
    build_report = _read_json_if_exists(options.out_dir / "build-report.json")
    dataset_version = (
        build_report.get("datasetVersion") if build_report else None
    ) or options.out_dir.name
    summary: dict[str, Any] = {
        "schemaVersion": BOSUN_EXPORT_REPORT_SCHEMA_VERSION,
        "format": "bosun",
        "questionSet": question_set.version,
        "stateTemplate": BOSUN_STATE_TEMPLATE,
        "minCandidateShare": options.min_share,
        "splits": {
            split: {**r.to_json(), "file": f"{BOSUN_DIR}/{split}.{BOSUN_LANGUAGE}.jsonl"}
            for split, r in results.items()
        },
    }
    (options.out_dir / EXPORT_REPORT_FILE).write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    manifest = build_manifest(options.out_dir, results, dataset_version)
    (options.out_dir / MANIFEST_FILE).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    summary["manifest"] = {k: v for k, v in manifest.items() if k not in ("files", "distribution")}
    return summary
