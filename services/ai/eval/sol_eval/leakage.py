"""`leakage --bundle <dir>`: Bosun 번들(bosun/*.en.jsonl + manifest.json)의 누수 검사(docs/21 §3.6·§6, 22 §4.1, ADR-034 7번).

검사(위반이면 exit 1):
1. 클러스터 교차: train∩dev, train∩test, dev∩test 가 0.
2. fixture 유래 없음: itemId·noticeId 에 FX-01~FX-20 이 없고 bid.source 가 fixture 가 아니다.
3. held-out 기업 원형(manifest.heldOutCompanies)이 train 에 없다(index 의 companyId).
4. 같은 stateHash 가 다른 분할에 없다.
5. 유사 state(정규화 문자열 5-gram Jaccard ≥ threshold)가 분할을 넘지 않는다 — 기본은 경고,
   --fail-on-similarity 면 위반. 임계값은 --similarity 로 바꾼다(0.9 는 21 §3.6 MinHash 0.8 보다 보수적인 출발값. 근거 미확정).
6. 분할별 qid 가족·후보 분포가 각 ≥ min_share(기본 5%). train 은 위반, dev·test 는 경고(표본이 작아 희소 후보가 흔하다).
7. manifest.files 의 sha256 과 파일이 일치한다.

실모델·네트워크를 쓰지 않는다. state 원문은 리포트에 담지 않는다.
"""

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

from sol_eval.bosun_export import MANIFEST_FILE
from sol_eval.bosun_records import BOSUN_DIR, BOSUN_LANGUAGE
from sol_eval.dataset import SPLITS
from sol_eval.labels import qid_family
from sol_eval.manifest import sha256_file

LEAKAGE_REPORT_SCHEMA_VERSION = "sol-eval-leakage-report/v0.1"
DEFAULT_SIMILARITY_THRESHOLD = 0.9
DEFAULT_MIN_SHARE = 0.05
SHINGLE_SIZE = 5
# FX-01 ~ FX-20(fixtures/manifest.yaml). 앞뒤가 영숫자가 아닐 때만 맞는다
FIXTURE_ID = re.compile(r"(?<![A-Za-z0-9])FX-(0[1-9]|1[0-9]|20)(?![0-9])")
FIXTURE_SOURCE = "fixture"
_NON_WORD = re.compile(r"[^0-9a-zÀ-￿]+")


class LeakageInputError(ValueError):
    pass


@dataclass
class LeakageOptions:
    bundle_dir: Path
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    fail_on_similarity: bool = False
    min_share: float = DEFAULT_MIN_SHARE


@dataclass
class LeakageReport:
    bundle: str
    checks: dict[str, Any] = field(default_factory=dict)
    violations: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations

    def violation(self, check: str, message: str, **extra: Any) -> None:
        self.violations.append({"check": check, "message": message, **extra})

    def warning(self, check: str, message: str, **extra: Any) -> None:
        self.warnings.append({"check": check, "message": message, **extra})

    def to_json(self) -> dict[str, Any]:
        return {
            "schemaVersion": LEAKAGE_REPORT_SCHEMA_VERSION,
            "bundle": self.bundle,
            "ok": self.ok,
            "checks": self.checks,
            "violations": self.violations,
            "warnings": self.warnings,
        }


@dataclass
class BundleSplit:
    split: str
    records: list[dict[str, Any]]
    index_rows: list[dict[str, Any]]

    def clusters(self) -> set[str]:
        return {str(r.get("clusterId") or "") for r in self.records}

    def state_hashes(self) -> set[str]:
        return {str(r["stateHash"]) for r in self.records}

    def states_by_hash(self) -> dict[str, str]:
        return {str(r["stateHash"]): str(r["state"]) for r in self.records}

    def company_ids(self) -> set[str]:
        return {str(r.get("companyId") or "") for r in self.index_rows} - {""}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_no, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise LeakageInputError(f"{path.name}:{line_no}: JSON 이 아니다") from error
    return rows


def load_bundle(bundle_dir: Path) -> tuple[dict[str, Any], dict[str, BundleSplit]]:
    manifest_path = bundle_dir / MANIFEST_FILE
    if not manifest_path.exists():
        raise LeakageInputError(f"{bundle_dir}: {MANIFEST_FILE} 이 없다")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    splits: dict[str, BundleSplit] = {}
    for split in SPLITS:
        records_path = bundle_dir / BOSUN_DIR / f"{split}.{BOSUN_LANGUAGE}.jsonl"
        if not records_path.exists():
            continue
        index_path = bundle_dir / BOSUN_DIR / f"{split}.{BOSUN_LANGUAGE}.index.jsonl"
        index_rows = read_jsonl(index_path) if index_path.exists() else []
        splits[split] = BundleSplit(split, read_jsonl(records_path), index_rows)
    if not splits:
        raise LeakageInputError(f"{bundle_dir}: {BOSUN_DIR}/*.{BOSUN_LANGUAGE}.jsonl 이 없다")
    return manifest, splits


# ---------------------------------------------------------------- 유사 state


def normalize_state(text: str) -> list[str]:
    """소문자·구두점 제거·공백 정규화 뒤 토큰 열."""
    return [t for t in _NON_WORD.split(text.lower()) if t]


def shingles(text: str, size: int = SHINGLE_SIZE) -> frozenset[tuple[str, ...]]:
    tokens = normalize_state(text)
    if len(tokens) < size:
        return frozenset({tuple(tokens)}) if tokens else frozenset()
    return frozenset(tuple(tokens[i : i + size]) for i in range(len(tokens) - size + 1))


def jaccard(a: frozenset, b: frozenset) -> float:
    if not a and not b:
        return 1.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def similar_pairs_across_splits(
    splits: dict[str, BundleSplit], threshold: float
) -> list[dict[str, Any]]:
    """분할을 넘는 (stateHash, stateHash, jaccard) 쌍. 분할 안 쌍은 보지 않는다(변형은 원래 비슷하다)."""
    shingle_sets = {
        split: {digest: shingles(state) for digest, state in bundle.states_by_hash().items()}
        for split, bundle in splits.items()
    }
    pairs: list[dict[str, Any]] = []
    for left, right in combinations(sorted(shingle_sets), 2):
        for digest_a, set_a in shingle_sets[left].items():
            for digest_b, set_b in shingle_sets[right].items():
                score = jaccard(set_a, set_b)
                if score >= threshold:
                    pairs.append(
                        {
                            "splits": [left, right],
                            "stateHashes": [digest_a, digest_b],
                            "jaccard": round(score, 4),
                        }
                    )
    return pairs


# ---------------------------------------------------------------- 검사


def check_cluster_overlap(splits: dict[str, BundleSplit], report: LeakageReport) -> None:
    overlaps: dict[str, int] = {}
    for left, right in combinations([s for s in SPLITS if s in splits], 2):
        shared = splits[left].clusters() & splits[right].clusters()
        overlaps[f"{left}∩{right}"] = len(shared)
        if shared:
            report.violation(
                "clusterOverlap",
                f"{left}∩{right} 클러스터 {len(shared)}건",
                clusterIds=sorted(shared)[:20],
            )
    report.checks["clusterOverlap"] = overlaps


def check_fixture_origin(splits: dict[str, BundleSplit], report: LeakageReport) -> None:
    hits: list[dict[str, str]] = []
    for split, bundle in splits.items():
        for record in bundle.records:
            item_id = str(record.get("itemId") or "")
            notice_id = str((record.get("bid") or {}).get("noticeId") or "")
            source = str((record.get("bid") or {}).get("source") or "")
            if (
                FIXTURE_ID.search(item_id)
                or FIXTURE_ID.search(notice_id)
                or source == FIXTURE_SOURCE
            ):
                hits.append({"split": split, "itemId": item_id, "noticeId": notice_id})
    report.checks["fixtureRows"] = len(hits)
    if hits:
        report.violation("fixtureOrigin", f"fixture 유래 레코드 {len(hits)}건", rows=hits[:20])


def check_held_out_companies(
    manifest: dict[str, Any], splits: dict[str, BundleSplit], report: LeakageReport
) -> None:
    declared = set(manifest.get("heldOutCompanies") or [])
    train = splits["train"].company_ids() if "train" in splits else set()
    leaked = sorted(declared & train)
    report.checks["heldOutCompanies"] = {
        "declared": sorted(declared),
        "inTrain": leaked,
        "indexHasCompanyIds": all(bool(b.index_rows) for b in splits.values()),
    }
    if leaked:
        report.violation("heldOutCompany", f"held-out 원형이 train 에 있다: {leaked}")
    if not declared:
        report.warning(
            "heldOutCompany", "manifest.heldOutCompanies 가 비어 있다(처음 보는 기업 지표 없음)"
        )


def check_state_hash_overlap(splits: dict[str, BundleSplit], report: LeakageReport) -> None:
    overlaps: dict[str, int] = {}
    for left, right in combinations([s for s in SPLITS if s in splits], 2):
        shared = splits[left].state_hashes() & splits[right].state_hashes()
        overlaps[f"{left}∩{right}"] = len(shared)
        if shared:
            report.violation(
                "stateHashOverlap",
                f"{left}∩{right} 같은 state {len(shared)}건",
                stateHashes=sorted(shared)[:20],
            )
    report.checks["stateHashOverlap"] = overlaps


def check_similar_states(
    splits: dict[str, BundleSplit], options: LeakageOptions, report: LeakageReport
) -> None:
    pairs = similar_pairs_across_splits(splits, options.similarity_threshold)
    report.checks["similarStates"] = {
        "threshold": options.similarity_threshold,
        "shingle": SHINGLE_SIZE,
        "pairs": len(pairs),
        "failOnSimilarity": options.fail_on_similarity,
    }
    if not pairs:
        return
    message = f"분할을 넘는 유사 state {len(pairs)}쌍 (Jaccard ≥ {options.similarity_threshold})"
    if options.fail_on_similarity:
        report.violation("similarStates", message, pairs=pairs[:20])
    else:
        report.warning("similarStates", message, pairs=pairs[:20])


def candidate_distribution(records: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """qid 가족 → 후보 id → 정답 건수. 한 번도 정답이 아닌 후보도 0 으로 둔다."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for record in records:
        family = qid_family(str(record["qid"]))
        for candidate in record.get("candidates") or []:
            counts[family].setdefault(str(candidate["id"]), 0)
        counts[family][str(record["gold"]["candidateId"])] += 1
    return {family: dict(c) for family, c in counts.items()}


def check_candidate_share(
    splits: dict[str, BundleSplit], min_share: float, report: LeakageReport
) -> None:
    summary: dict[str, Any] = {}
    for split, bundle in splits.items():
        distribution = candidate_distribution(bundle.records)
        summary[split] = {}
        for family, counts in sorted(distribution.items()):
            total = sum(counts.values())
            shares = {c: round(n / total, 4) for c, n in counts.items()} if total else {}
            summary[split][family] = {"n": total, "shares": shares}
            for candidate, share in shares.items():
                if share >= min_share:
                    continue
                message = (
                    f"{split} {family}: {candidate} 비율 {share:.1%} < {min_share:.0%} (n={total})"
                )
                if split == "train":
                    report.violation("candidateShare", message)
                else:
                    report.warning("candidateShare", message)
    report.checks["candidateShare"] = {"minShare": min_share, "bySplit": summary}


def check_manifest_files(manifest: dict[str, Any], bundle_dir: Path, report: LeakageReport) -> None:
    files = manifest.get("files") or {}
    mismatched: list[str] = []
    missing: list[str] = []
    for relative, expected in sorted(files.items()):
        path = bundle_dir / relative
        if not path.exists():
            missing.append(relative)
        elif sha256_file(path) != expected:
            mismatched.append(relative)
    unlisted = sorted(
        str(p.relative_to(bundle_dir))
        for p in (bundle_dir / BOSUN_DIR).glob(f"*.{BOSUN_LANGUAGE}*.jsonl")
        if str(p.relative_to(bundle_dir)) not in files
    )
    report.checks["manifestFiles"] = {
        "listed": len(files),
        "mismatched": mismatched,
        "missing": missing,
        "unlisted": unlisted,
    }
    if mismatched or missing or unlisted:
        report.violation(
            "manifestFiles",
            f"manifest sha256 불일치 {len(mismatched)}·없음 {len(missing)}·미등록 {len(unlisted)}",
        )


def check_bundle(options: LeakageOptions) -> LeakageReport:
    manifest, splits = load_bundle(options.bundle_dir)
    report = LeakageReport(bundle=str(options.bundle_dir))
    report.checks["records"] = {split: len(b.records) for split, b in splits.items()}
    check_cluster_overlap(splits, report)
    check_fixture_origin(splits, report)
    check_held_out_companies(manifest, splits, report)
    check_state_hash_overlap(splits, report)
    check_similar_states(splits, options, report)
    check_candidate_share(splits, options.min_share, report)
    check_manifest_files(manifest, options.bundle_dir, report)
    return report
