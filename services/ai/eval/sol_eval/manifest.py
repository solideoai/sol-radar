"""번들 manifest(docs/21 §3.7, 22 §4.1, 23 §4.5): 데이터셋 버전·git commit·질문 세트·state 템플릿·마스킹 버전·갈래·
분할별 레코드·질문 수·state 토큰 최대값(근사)·파일별 sha256·누수 0 확인.

build-report.json·export-report.json·items.*.jsonl 을 읽어 manifest.json 을 쓴다. 다른 파일은 바꾸지 않는다.
"""

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sol_eval.dataset import SPLITS, read_items
from sol_eval.paths import (
    QUALIFICATION_CODES_FILE,
    QUESTION_SET_FILE,
    QUESTION_SET_VERSION,
    REPO_ROOT,
    SCHEMA_FILE,
    STATE_TEMPLATE_FILES,
)

MANIFEST_SCHEMA_VERSION = "sol-dataset-manifest/v0.1"
MANIFEST_FILE = "manifest.json"


class ManifestError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ManifestError(f"{path.name} 이 없다. build·export 를 먼저 돈다")
    return json.loads(path.read_text(encoding="utf-8"))


def leak_check(out_dir: Path) -> dict[str, Any]:
    clusters: dict[str, set[str]] = {}
    notices: dict[str, set[str]] = {}
    companies: dict[str, set[str]] = {}
    for split in SPLITS:
        path = out_dir / f"items.{split}.jsonl"
        items = read_items(path) if path.exists() else []
        clusters[split] = {i.clusterId or "" for i in items}
        notices[split] = {i.bid.noticeId for i in items}
        companies[split] = {i.company_id() or "" for i in items}
    held = clusters["test"] | clusters["dev"]
    held_notices = notices["test"] | notices["dev"]
    return {
        "testDevClustersInTrain": len(held & clusters["train"]),
        "testDevNoticesInTrain": len(held_notices & notices["train"]),
        "testClustersInDev": len(clusters["test"] & clusters["dev"]),
        "companiesBySplit": {s: sorted(companies[s]) for s in SPLITS},
    }


def write_manifest(out_dir: Path) -> dict[str, Any]:
    build_report = _read_json(out_dir / "build-report.json")
    export_report = _read_json(out_dir / "export-report.json")
    leaks = leak_check(out_dir)
    holdout = set(build_report.get("holdoutCompanies") or [])
    outside = {s: sorted(holdout & set(leaks["companiesBySplit"][s])) for s in ("train", "dev")}
    leaks["holdoutCompanyOutsideTest"] = sum(len(v) for v in outside.values())
    if (
        leaks["testDevClustersInTrain"]
        or leaks["testDevNoticesInTrain"]
        or leaks["holdoutCompanyOutsideTest"]
    ):
        raise ManifestError(f"누수가 있다: {leaks}")

    max_tokens = 0
    max_chars = 0
    counts: dict[str, Any] = {}
    for split, by_lang in export_report["splits"].items():
        counts[split] = {
            "items": build_report["counts"].get(f"items.{split}", 0),
            "clusters": build_report["counts"].get(f"clusters.{split}", 0),
            "labels": build_report["counts"].get(f"labels.{split}", 0),
            "labelsBySource": build_report.get("labelsBySource", {}).get(split, {}),
            "records": {lang: r["records"] for lang, r in by_lang.items()},
            "questions": {lang: r["questions"] for lang, r in by_lang.items()},
        }
        for report in by_lang.values():
            max_tokens = max(max_tokens, report["maxStateTokensApprox"])
            max_chars = max(max_chars, report["maxStateChars"])

    files: dict[str, str] = {}
    for path in sorted(out_dir.rglob("*")):
        if path.is_file() and path.name != MANIFEST_FILE:
            files[str(path.relative_to(out_dir))] = sha256_file(path)

    manifest = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "datasetVersion": build_report["datasetVersion"],
        "createdAt": datetime.now(UTC).isoformat(),
        "gitCommit": git_commit(),
        "branch": build_report["branch"],
        "asOf": build_report["asOf"],
        "questionSet": {
            "version": QUESTION_SET_VERSION,
            "file": str(QUESTION_SET_FILE.relative_to(REPO_ROOT)),
            "sha256": sha256_file(QUESTION_SET_FILE),
        },
        "stateTemplates": {
            lang: {
                "name": f"{lang}.v0.2",
                "file": str(path.relative_to(REPO_ROOT)),
                "sha256": sha256_file(path),
            }
            for lang, path in STATE_TEMPLATE_FILES.items()
        },
        "extractionSchema": {
            "file": str(SCHEMA_FILE.relative_to(REPO_ROOT)),
            "sha256": sha256_file(SCHEMA_FILE),
        },
        "qualificationDictionary": {
            "file": str(QUALIFICATION_CODES_FILE.relative_to(REPO_ROOT)),
            "sha256": sha256_file(QUALIFICATION_CODES_FILE),
        },
        "maskingVersion": build_report["maskingVersion"],
        "recordedFiles": build_report.get("recordedFiles", []),
        "splitsSource": build_report.get("splitsSource"),
        "splitsFile": build_report.get("splitsFile"),
        "companies": build_report.get("companies", []),
        "holdoutCompany": build_report.get("holdoutCompany"),
        "holdoutCompanies": sorted(holdout),
        "counts": counts,
        "stateTokens": {
            "method": "chars/4 approximation",
            "tokenizerComputed": False,
            "maxChars": max_chars,
            "maxTokensApprox": max_tokens,
            "maxStateForTraining": export_report.get("maxStateTokens"),
        },
        "leakCheck": {k: v for k, v in leaks.items() if k != "companiesBySplit"},
        "companiesBySplit": leaks["companiesBySplit"],
        "warnings": {
            "build": build_report.get("warnings", []),
            "export": {
                split: {lang: r.get("warnings", []) for lang, r in by_lang.items()}
                for split, by_lang in export_report["splits"].items()
            },
        },
        "files": files,
    }
    (out_dir / MANIFEST_FILE).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest
