"""분할 파일(sol-eval-split/v0.1) 읽기와, 파일이 없을 때의 개발용 유도(docs/21 §3.6 사업 단위 union-find + hash).

유도 분할은 x6a/recording 이 만드는 정본이 아니다. manifest 에 splitsSource=derived 로 남는다.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sol_eval.dataset import SPLITS

SPLIT_SCHEMA_VERSION = "sol-eval-split/v0.1"
# 유도 분할 비율(%): test 20 · dev 10 · train 70
DERIVED_RATIO = {"test": 20, "dev": 10}
LINK_FIELDS = ("bfSpecRgstNo", "orderPlanUntyNo", "befBidBbancNo")


class SplitFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Cluster:
    cluster_id: str
    split: str
    notice_ids: tuple[str, ...]


@dataclass
class Splits:
    source: str  # "file" | "derived"
    path: str | None
    dataset_version: str | None
    clusters: dict[str, Cluster]
    by_notice: dict[str, Cluster]
    raw: dict[str, Any] | None = None

    def lookup(self, notice_id: str) -> Cluster | None:
        return self.by_notice.get(notice_id)

    def counts(self) -> dict[str, int]:
        return {s: sum(1 for c in self.clusters.values() if c.split == s) for s in SPLITS}


def load_splits(path: Path) -> Splits:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != SPLIT_SCHEMA_VERSION:
        raise SplitFormatError(f"{path.name}: schemaVersion 이 {SPLIT_SCHEMA_VERSION} 이 아니다")
    clusters: dict[str, Cluster] = {}
    by_notice: dict[str, Cluster] = {}
    for entry in data["clusters"]:
        if entry["split"] not in SPLITS:
            raise SplitFormatError(
                f"{path.name}: split 값이 train/dev/test 밖이다 ({entry['clusterId']})"
            )
        cluster = Cluster(entry["clusterId"], entry["split"], tuple(entry["noticeIds"]))
        if cluster.cluster_id in clusters:
            raise SplitFormatError(f"{path.name}: clusterId 가 겹친다 ({cluster.cluster_id})")
        clusters[cluster.cluster_id] = cluster
        for notice_id in cluster.notice_ids:
            if notice_id in by_notice:
                raise SplitFormatError(f"{path.name}: 공고가 두 클러스터에 있다 ({notice_id})")
            by_notice[notice_id] = cluster
    return Splits("file", str(path), data.get("datasetVersion"), clusters, by_notice, data)


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def _split_of(cluster_id: str) -> str:
    bucket = int(hashlib.sha256(cluster_id.encode()).hexdigest()[:8], 16) % 100
    if bucket < DERIVED_RATIO["test"]:
        return "test"
    if bucket < DERIVED_RATIO["test"] + DERIVED_RATIO["dev"]:
        return "dev"
    return "train"


def derive_splits(rows: list[dict[str, Any]]) -> Splits:
    """bidNtceNo·bfSpecRgstNo·orderPlanUntyNo·befBidBbancNo 를 union-find 로 묶고 hash(clusterId) 로 나눈다."""
    uf = _UnionFind()
    notice_ids: list[str] = []
    for row in rows:
        notice_id = str(row["bidNtceNo"])
        notice_ids.append(notice_id)
        uf.find(f"N:{notice_id}")
        for field_name in LINK_FIELDS:
            value = str(row.get(field_name) or "").strip()
            if value:
                uf.union(f"N:{notice_id}", f"{field_name}:{value}")
    groups: dict[str, list[str]] = {}
    for notice_id in sorted(set(notice_ids)):
        groups.setdefault(uf.find(f"N:{notice_id}"), []).append(notice_id)
    clusters: dict[str, Cluster] = {}
    by_notice: dict[str, Cluster] = {}
    for members in sorted(groups.values()):
        digest = hashlib.sha256("|".join(members).encode()).hexdigest()[:8]
        cluster_id = f"c-{digest}"
        cluster = Cluster(cluster_id, _split_of(cluster_id), tuple(members))
        clusters[cluster_id] = cluster
        for notice_id in members:
            by_notice[notice_id] = cluster
    return Splits("derived", None, None, clusters, by_notice)


def splits_to_json(splits: Splits, created_at: str, recorded_root: str) -> dict[str, Any]:
    """유도 분할을 sol-eval-split/v0.1 모양으로(recording 담당이 만들 파일과 같은 틀)."""
    counts = splits.counts()
    return {
        "schemaVersion": SPLIT_SCHEMA_VERSION,
        "datasetVersion": splits.dataset_version or "derived",
        "createdAt": created_at,
        "sourceWindow": None,
        "recordedRoot": recorded_root,
        "derived": True,
        "clusters": [
            {
                "clusterId": c.cluster_id,
                "split": c.split,
                "noticeIds": list(c.notice_ids),
                "primaryNoticeId": c.notice_ids[0],
                "selectionReason": "derived: hash(clusterId) % 100",
            }
            for c in sorted(splits.clusters.values(), key=lambda c: c.cluster_id)
        ],
        "counts": counts,
    }
