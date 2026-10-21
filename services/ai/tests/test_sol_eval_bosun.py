"""sol_eval Bosun 경로(docs/15 §4.1, 21 §4.3, 22 §4.1, ADR-034 7·9번): export --format bosun · leakage · bosun_score · compare.

합성 EvalItem(사업 3개 × 원형 변형)만 쓴다. 네트워크·실모델·fixture 파일을 읽지 않는다.
기대값은 15 §4.1 표와 21 §4.3 정의에서 손으로 계산했다.
"""

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

import pytest

from sol_eval import __main__ as sol_eval_cli
from sol_eval import bosun_score as bosun_score_module
from sol_eval.__main__ import main, parser
from sol_eval.bosun_export import BosunExportError, BosunExportOptions, export_bosun
from sol_eval.bosun_metrics import (
    ScoredRow,
    accuracy,
    brier,
    confusion_rate,
    consistency,
    ece,
    expected_value_mae,
    macro_f1,
    nll,
    predicted_id,
    recall_of,
)
from sol_eval.bosun_records import V0_1_QIDS, row_id
from sol_eval.bosun_score import (
    ScoreInputError,
    ScoreOptions,
    make_backend,
    parse_seeds,
    resolve_device,
    resolve_dtype,
    score,
)
from sol_eval.compare import CompareError, CompareOptions, compare
from sol_eval.dataset import EvalItem, write_items
from sol_eval.leakage import LeakageOptions, check_bundle
from sol_eval.package_check import PackageVerificationError, verify_package_dir

REVISION_SUFFIX = "#01"
FETCHED_AT = "2026-10-01T00:00:00Z"
SKILLS = ("Java", "Spring Boot")
HELD_TECHS = ("Java", "Spring Boot", "PostgreSQL")
NOT_HELD_TECHS = ("Python",)
REQ0 = "req.requiredSkills[0].status"
REQ1 = "req.requiredSkills[1].status"
REQ_FAMILY = "req.requiredSkills[*].status"
REQ_CANDIDATES = ("SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW")
NOUL_CANDIDATES = ("true", "false")
SCORE_CANDIDATES = ("0", "1", "2", "3", "4")
# state 에는 공고 제목이 없다. 공고를 가르는 구조화 필드는 예산이다(N-D 는 N-A 와 같은 state 를 만들기 위한 것)
BUDGET_BY_NOTICE = {
    "N-A": "1200000000",
    "N-B": "800000000",
    "N-C": "2500000000",
    "N-D": "1200000000",
}


# ---------------------------------------------------------------- 합성 EvalItem


def notice_evidence(notice_id: str, text: str) -> dict[str, Any]:
    return {
        "documentId": None,
        "revisionId": notice_id + REVISION_SUFFIX,
        "fetchedAt": FETCHED_AT,
        "quotedText": text,
    }


def unknown() -> dict[str, Any]:
    return {"value": None, "state": "UNKNOWN", "evidence": []}


def extraction(notice_id: str, title: str) -> dict[str, Any]:
    ev = notice_evidence(notice_id, ", ".join(SKILLS))
    return {
        "schemaVersion": "requirement-extraction/v0.1",
        "bidId": notice_id,
        "revisionId": notice_id + REVISION_SUFFIX,
        "summary": {
            "value": title,
            "state": "KNOWN",
            "evidence": [notice_evidence(notice_id, title)],
        },
        "projectType": unknown(),
        "domain": unknown(),
        "requiredSkills": {
            "value": list(SKILLS),
            "state": "KNOWN",
            "evidence": [ev],
            "note": "[0],[1]→evidence[0]",
        },
        "preferredSkills": unknown(),
        "qualifications": unknown(),
        "pastPerformance": unknown(),
        "staffing": unknown(),
        "budgetKrw": {
            "value": BUDGET_BY_NOTICE[notice_id],
            "state": "KNOWN",
            "evidence": [notice_evidence(notice_id, BUDGET_BY_NOTICE[notice_id])],
        },
        "deadlineAt": unknown(),
        "contractMethod": unknown(),
        "restrictions": unknown(),
        "submission": unknown(),
        "injectionSuspected": False,
        "warnings": [],
    }


def company(company_id: str, variant: str, technologies: tuple[str, ...]) -> dict[str, Any]:
    return {
        "schemaVersion": "company-profile/v0.1",
        "revision": 2,
        "technologies": [{"name": t} for t in technologies],
        "technologiesComplete": bool(technologies),
        "licenses": [
            {"code": "SW_BUSINESS_REG", "name": "SW business registration", "status": "HELD"}
        ],
        "industryCodes": [],
        "pastProjects": [{"id": "P1", "name": "Portal", "amountKrw": "500000000"}],
        "financials": {"maxContractKrw": "3000000000"},
        "companyId": company_id,
        "variantId": variant,
    }


def company_evidence() -> dict[str, Any]:
    return {
        "profileRevision": 2,
        "kind": "TECHNOLOGY",
        "recordKey": "technologies[0]",
        "documentId": None,
        "quotedText": None,
    }


def label(
    qid: str,
    value: str,
    source: str = "CONSTRUCTED",
    *,
    notice_id: str = "N",
    reason: str | None = None,
    target: dict[str, float] | None = None,
    human: bool = False,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "qid": qid,
        "label": value,
        "labelSource": source,
        "draftedBy": "RULE" if source == "RULE_SILVER" else "NONE",
        "noticeEvidence": [notice_evidence(notice_id, "Java")] if qid.startswith("req.") else [],
        "companyEvidence": [company_evidence()] if qid.startswith("req.") else [],
    }
    if reason:
        out["reason"] = reason
    if target:
        out["target"] = target
    if human:
        out["labeler"] = "annotator-1"
        out["labeledAt"] = FETCHED_AT
    return out


def item(
    cluster: str,
    split: str,
    notice_id: str,
    company_id: str,
    variant: str,
    technologies: tuple[str, ...],
    labels: list[dict[str, Any]],
    *,
    title: str | None = None,
) -> EvalItem:
    variant_id = f"{company_id}:{variant}"
    return EvalItem.model_validate(
        {
            "itemId": f"{cluster}:{notice_id}{REVISION_SUFFIX}:{variant_id}",
            "split": split,
            "clusterId": cluster,
            "source": "live",
            "bid": {
                "source": "g2b",
                "noticeId": notice_id,
                "amendmentNo": "01",
                "revisionId": notice_id + REVISION_SUFFIX,
            },
            "extraction": extraction(notice_id, title or f"Public SI project {notice_id}"),
            "attachmentsIncomplete": True,
            "company": company(company_id, variant, technologies),
            "profileRevision": 2,
            "companyVariantId": variant_id,
            "labels": labels,
        }
    )


def synthetic_items() -> dict[str, list[EvalItem]]:
    """train 6 · dev 2 · test 3 레코드가 나와야 하는 합성 세트(제외 규칙 각 1건 이상)."""
    train = [
        item(
            "c-A",
            "train",
            "N-A",
            "01",
            "q-held",
            HELD_TECHS,
            [
                label(REQ0, "SATISFIED", notice_id="N-A"),
                label(REQ1, "SATISFIED", "RULE_SILVER", notice_id="N-A"),
                label("risk.scale", "false"),
                label("risk.staffing", "false", "RULE_SILVER"),
                label("techFit", "3"),
                label("recommendation", "BID"),
            ],
        ),
        item(
            "c-A",
            "train",
            "N-A",
            "01",
            "q-not-held",
            NOT_HELD_TECHS,
            [label(REQ0, "NOT_SATISFIED", notice_id="N-A"), label("risk.scale", "true")],
        ),
        item(
            "c-A",
            "train",
            "N-A",
            "02",
            "q-missing",
            (),
            [
                label(
                    REQ0,
                    "NEEDS_REVIEW",
                    notice_id="N-A",
                    reason="COMPANY_EVIDENCE_MISSING",
                    target={"NEEDS_REVIEW": 0.8, "NOT_SATISFIED": 0.2},
                )
            ],
        ),
    ]
    dev = [
        item(
            "c-B",
            "dev",
            "N-B",
            "01",
            "q-held",
            HELD_TECHS,
            [
                label(REQ0, "SATISFIED", notice_id="N-B"),
                label("techFit", "4", "HUMAN", human=True),
                label(REQ1, "SATISFIED", "RULE_SILVER", notice_id="N-B"),
            ],
        )
    ]
    test = [
        item(
            "c-C",
            "test",
            "N-C",
            "06",
            "q-held",
            HELD_TECHS,
            [label(REQ0, "SATISFIED", notice_id="N-C"), label("risk.scale", "true")],
        ),
        item(
            "c-C",
            "test",
            "N-C",
            "06",
            "q-not-held",
            NOT_HELD_TECHS,
            [label(REQ0, "NOT_SATISFIED", notice_id="N-C")],
        ),
    ]
    return {"train": train, "dev": dev, "test": test}


def write_bundle_items(out_dir: Path, items: dict[str, list[EvalItem]]) -> None:
    for split, rows in items.items():
        write_items(out_dir / f"items.{split}.jsonl", rows)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    out = tmp_path / "v-test"
    write_bundle_items(out, synthetic_items())
    export_bosun(BosunExportOptions(out_dir=out))
    return out


# ---------------------------------------------------------------- export --format bosun


def test_export_bosun_writes_only_bosun_dir_and_manifest(bundle: Path) -> None:
    names = sorted(p.name for p in (bundle / "bosun").iterdir())
    assert names == [
        "dev.en.index.jsonl",
        "dev.en.jsonl",
        "test.en.index.jsonl",
        "test.en.jsonl",
        "train.en.index.jsonl",
        "train.en.jsonl",
    ]
    assert not (bundle / "kev").exists()
    assert (bundle / "manifest.json").exists()
    assert (bundle / "export-report.json").exists()


def test_export_bosun_record_fields_follow_contract(bundle: Path) -> None:
    records = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    held = next(r for r in records if r["companyVariantId"] == "01:q-held" and r["qid"] == REQ0)
    assert list(held) == [
        "rowId",
        "itemId",
        "clusterId",
        "split",
        "bid",
        "companyVariantId",
        "qid",
        "questionType",
        "instructions",
        "candidates",
        "state",
        "stateHash",
        "stateTemplate",
        "questionSet",
        "gold",
        "labelSource",
        "reason",
        "noticeEvidence",
        "companyEvidence",
    ]
    assert held["rowId"] == hashlib.sha256(f"{held['itemId']}:{REQ0}".encode()).hexdigest()
    assert held["rowId"] == row_id(held["itemId"], REQ0)
    assert held["bid"] == {"source": "g2b", "noticeId": "N-A", "revisionId": "N-A#01"}
    assert held["questionType"] == "choice"
    assert held["stateTemplate"] == "en.v0.2"
    assert held["questionSet"] == "kev-qs/v0.2"
    assert held["stateHash"] == hashlib.sha256(held["state"].encode()).hexdigest()
    assert "[requiredSkills[0]]" in held["state"]
    assert "[requiredSkills[0]]" in held["instructions"]
    assert [c["id"] for c in held["candidates"]] == list(REQ_CANDIDATES)
    assert held["candidates"][2]["description"].startswith("The information is missing")
    assert held["gold"] == {"candidateId": "SATISFIED", "probabilities": [1.0, 0.0, 0.0]}
    assert held["labelSource"] == "CONSTRUCTED"
    assert held["reason"] is None
    assert held["noticeEvidence"][0]["quotedText"] == "Java"
    assert held["companyEvidence"][0]["kind"] == "TECHNOLOGY"


def test_export_bosun_candidates_for_noul_and_score_and_soft_gold(bundle: Path) -> None:
    train = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    risk = next(r for r in train if r["qid"] == "risk.scale" and r["gold"]["candidateId"] == "true")
    assert risk["questionType"] == "noul"
    assert [c["id"] for c in risk["candidates"]] == list(NOUL_CANDIDATES)
    assert risk["candidates"][0]["description"].startswith("The project is much larger")
    assert risk["gold"]["probabilities"] == [1.0, 0.0]

    soft = next(r for r in train if r["companyVariantId"] == "02:q-missing")
    assert soft["gold"] == {"candidateId": "NEEDS_REVIEW", "probabilities": [0.0, 0.2, 0.8]}
    assert soft["reason"] == "COMPANY_EVIDENCE_MISSING"

    dev = read_jsonl(bundle / "bosun" / "dev.en.jsonl")
    tech_fit = next(r for r in dev if r["qid"] == "techFit")
    assert tech_fit["questionType"] == "score"
    assert tech_fit["candidates"] == [
        {"id": "0", "label": "Very poor"},
        {"id": "1", "label": "Poor"},
        {"id": "2", "label": "Moderate"},
        {"id": "3", "label": "Good"},
        {"id": "4", "label": "Very good"},
    ]
    assert tech_fit["gold"] == {"candidateId": "4", "probabilities": [0.0, 0.0, 0.0, 0.0, 1.0]}
    assert tech_fit["labelSource"] == "HUMAN"


def test_export_bosun_applies_exclusion_rules(bundle: Path) -> None:
    train = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    dev = read_jsonl(bundle / "bosun" / "dev.en.jsonl")
    test = read_jsonl(bundle / "bosun" / "test.en.jsonl")
    assert (len(train), len(dev), len(test)) == (6, 2, 3)
    all_qids = [r["qid"] for r in train + dev + test]
    assert not set(all_qids) & set(V0_1_QIDS)
    # RULE_SILVER 는 train 만: train 의 req[1] 은 있고 dev 의 req[1] 은 없다
    assert [r["labelSource"] for r in train if r["qid"] == REQ1] == ["RULE_SILVER"]
    assert REQ1 not in [r["qid"] for r in dev]
    # techFit 은 HUMAN 만, risk.* 는 CONSTRUCTED 만
    assert "techFit" not in [r["qid"] for r in train]
    assert "risk.staffing" not in [r["qid"] for r in train]
    report = json.loads((bundle / "export-report.json").read_text(encoding="utf-8"))
    assert report["format"] == "bosun"
    assert report["splits"]["train"]["excluded"] == {
        "riskNotConstructed": 1,
        "scoreNotHuman": 1,
        "v01Question": 1,
    }
    assert report["splits"]["dev"]["excluded"] == {"ruleSilverOutsideTrain": 1}


def test_export_bosun_index_and_manifest(bundle: Path) -> None:
    index = read_jsonl(bundle / "bosun" / "train.en.index.jsonl")
    records = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    assert [(i["rowId"], i["itemId"]) for i in index] == [
        (r["rowId"], r["itemId"]) for r in records
    ]
    assert {i["companyId"] for i in index} == {"01", "02"}
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["format"] == "bosun"
    assert manifest["questionSet"]["version"] == "kev-qs/v0.2"
    assert manifest["stateTemplate"]["name"] == "en.v0.2"
    assert {s: c["records"] for s, c in manifest["counts"].items()} == {
        "train": 6,
        "dev": 2,
        "test": 3,
    }
    assert manifest["leakCheck"]["clusterOverlap"] == {
        "trainDev": 0,
        "trainTest": 0,
        "devTest": 0,
        "trainInDevOrTest": 0,
    }
    assert manifest["heldOutCompanies"] == ["06"]
    assert manifest["companiesBySplit"] == {"train": ["01", "02"], "dev": ["01"], "test": ["06"]}
    train_dist = manifest["distribution"]["train"][REQ_FAMILY]
    assert {k: v["count"] for k, v in train_dist.items()} == {
        "SATISFIED": 2,
        "NOT_SATISFIED": 1,
        "NEEDS_REVIEW": 1,
    }
    assert train_dist["SATISFIED"]["share"] == 0.5
    assert not [w for w in manifest["warnings"] if w.startswith("train ")]
    assert any(w.startswith(f"dev {REQ_FAMILY}: NOT_SATISFIED") for w in manifest["warnings"])
    assert manifest["stateTokens"]["tokenizerComputed"] is False
    assert manifest["stateTokens"]["maxTokensApprox"] == math.ceil(
        max(len(r["state"]) for r in records) / 4
    )
    for relative, digest in manifest["files"].items():
        assert hashlib.sha256((bundle / relative).read_bytes()).hexdigest() == digest
    assert "bosun/train.en.jsonl" in manifest["files"]
    assert "manifest.json" not in manifest["files"]


def test_export_bosun_fails_on_conflicting_gold_for_same_state(tmp_path: Path) -> None:
    out = tmp_path / "conflict"
    items = synthetic_items()
    # 다른 공고·다른 클러스터인데 구조화 필드·회사가 같아 state 가 같고 라벨만 다르다
    items["train"].append(
        item(
            "c-D",
            "train",
            "N-D",
            "01",
            "q-held",
            HELD_TECHS,
            [label(REQ0, "NOT_SATISFIED", notice_id="N-D")],
        )
    )
    write_bundle_items(out, items)
    with pytest.raises(BosunExportError, match="같은 state 에 다른 라벨"):
        export_bosun(BosunExportOptions(out_dir=out))


def test_export_cli_format_bosun(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "cli"
    write_bundle_items(out, synthetic_items())
    assert main(["export", "--format", "bosun", "--out", str(out)]) == 0
    assert (out / "bosun" / "train.en.jsonl").exists()
    assert not (out / "kev").exists()
    assert json.loads(capsys.readouterr().out)["format"] == "bosun"


# ---------------------------------------------------------------- leakage


def rewrite_split(
    bundle: Path, split: str, rows: list[dict[str, Any]], rehash: bool = True
) -> None:
    path = bundle / "bosun" / f"{split}.en.jsonl"
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )
    if rehash:
        rehash_manifest(bundle)


def rehash_manifest(bundle: Path) -> None:
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for relative in manifest["files"]:
        manifest["files"][relative] = hashlib.sha256((bundle / relative).read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def violations(bundle: Path, **options: Any) -> list[str]:
    report = check_bundle(LeakageOptions(bundle_dir=bundle, **options))
    return [v["check"] for v in report.violations]


def test_leakage_passes_on_clean_bundle(bundle: Path) -> None:
    report = check_bundle(LeakageOptions(bundle_dir=bundle))
    assert report.ok
    assert report.checks["clusterOverlap"] == {"train∩dev": 0, "train∩test": 0, "dev∩test": 0}
    assert report.checks["fixtureRows"] == 0
    assert report.checks["heldOutCompanies"]["declared"] == ["06"]
    assert report.checks["similarStates"]["pairs"] == 0
    assert report.checks["manifestFiles"]["mismatched"] == []
    # dev 의 희소 후보는 경고일 뿐이다
    assert any(w["check"] == "candidateShare" for w in report.warnings)
    assert main(["leakage", "--bundle", str(bundle)]) == 0


def test_leakage_cluster_overlap_fails(bundle: Path) -> None:
    rows = read_jsonl(bundle / "bosun" / "test.en.jsonl")
    rows[0]["clusterId"] = "c-A"
    rewrite_split(bundle, "test", rows)
    assert violations(bundle) == ["clusterOverlap"]
    assert main(["leakage", "--bundle", str(bundle)]) == 1


def test_leakage_fixture_origin_fails(bundle: Path) -> None:
    rows = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    rows[0]["itemId"] = "FX-03:FX-03#01:01:q-held"
    rewrite_split(bundle, "train", rows)
    assert violations(bundle) == ["fixtureOrigin"]
    rows[0]["itemId"] = "c-A:N-A#01:01:q-held"
    rows[0]["bid"]["noticeId"] = "FX-20"
    rewrite_split(bundle, "train", rows)
    assert violations(bundle) == ["fixtureOrigin"]
    # FX-21·FX-003 은 fixture id 가 아니다
    rows[0]["bid"]["noticeId"] = "FX-21"
    rewrite_split(bundle, "train", rows)
    assert violations(bundle) == []


def test_leakage_held_out_company_in_train_fails(bundle: Path) -> None:
    index_path = bundle / "bosun" / "train.en.index.jsonl"
    index = read_jsonl(index_path)
    index[0]["companyId"] = "06"
    index_path.write_text("".join(json.dumps(r) + "\n" for r in index), encoding="utf-8")
    rehash_manifest(bundle)
    assert violations(bundle) == ["heldOutCompany"]


def test_leakage_same_state_hash_across_splits_fails(bundle: Path) -> None:
    train = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    test = read_jsonl(bundle / "bosun" / "test.en.jsonl")
    test[0]["state"] = train[0]["state"]
    test[0]["stateHash"] = train[0]["stateHash"]
    rewrite_split(bundle, "test", test)
    assert violations(bundle) == ["stateHashOverlap"]


def test_leakage_similar_state_warns_unless_flagged(bundle: Path) -> None:
    train = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    test = read_jsonl(bundle / "bosun" / "test.en.jsonl")
    test[0]["state"] = train[0]["state"] + "\n- extra: one more line"
    test[0]["stateHash"] = hashlib.sha256(test[0]["state"].encode()).hexdigest()
    rewrite_split(bundle, "test", test)
    report = check_bundle(LeakageOptions(bundle_dir=bundle))
    assert report.ok
    assert report.checks["similarStates"]["pairs"] == 1
    assert [w["check"] for w in report.warnings if w["check"] == "similarStates"] == [
        "similarStates"
    ]
    assert violations(bundle, fail_on_similarity=True) == ["similarStates"]
    assert violations(bundle, similarity_threshold=0.999) == []
    assert main(["leakage", "--bundle", str(bundle), "--fail-on-similarity"]) == 1


def test_leakage_candidate_share_fails_in_train_only(bundle: Path) -> None:
    train = read_jsonl(bundle / "bosun" / "train.en.jsonl")
    for row in train:
        if row["qid"].startswith("req."):
            row["gold"] = {"candidateId": "SATISFIED", "probabilities": [1.0, 0.0, 0.0]}
    rewrite_split(bundle, "train", train)
    report = check_bundle(LeakageOptions(bundle_dir=bundle))
    messages = [v["message"] for v in report.violations]
    assert [v["check"] for v in report.violations] == ["candidateShare", "candidateShare"]
    assert any("NOT_SATISFIED 비율 0.0%" in m for m in messages)
    assert any("NEEDS_REVIEW 비율 0.0%" in m for m in messages)


def test_leakage_manifest_sha_mismatch_fails(bundle: Path) -> None:
    rows = read_jsonl(bundle / "bosun" / "dev.en.jsonl")
    rows[0]["reason"] = "NOTICE_INFO_MISSING"
    rewrite_split(bundle, "dev", rows, rehash=False)
    report = check_bundle(LeakageOptions(bundle_dir=bundle))
    assert [v["check"] for v in report.violations] == ["manifestFiles"]
    assert report.checks["manifestFiles"]["mismatched"] == ["bosun/dev.en.jsonl"]


# ---------------------------------------------------------------- 지표(손으로 계산한 값)


def req_row(row: str, gold: str, probabilities: tuple[float, ...], cluster: str = "c") -> ScoredRow:
    return ScoredRow(
        row_id=row,
        qid=REQ0,
        question_type="choice",
        cluster_id=cluster,
        candidate_ids=REQ_CANDIDATES,
        gold_id=gold,
        gold_probabilities=tuple(1.0 if c == gold else 0.0 for c in REQ_CANDIDATES),
        probabilities=probabilities,
    )


REQ_ROWS = [
    req_row("r1", "SATISFIED", (0.7, 0.2, 0.1)),
    req_row("r2", "NEEDS_REVIEW", (0.2, 0.5, 0.3)),
    req_row("r3", "NEEDS_REVIEW", (0.1, 0.1, 0.8)),
    req_row("r4", "NOT_SATISFIED", (0.3, 0.3, 0.4)),
]


def test_choice_metrics_match_hand_computation() -> None:
    assert [predicted_id(r) for r in REQ_ROWS] == [
        "SATISFIED",
        "NOT_SATISFIED",
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
    ]
    assert accuracy(REQ_ROWS) == 0.5
    # S: F1 1.0 · NS: tp0 fp1 fn1 → 0 · NR: tp1 fp1 fn1 → 0.5
    assert macro_f1(REQ_ROWS) == pytest.approx(0.5)
    assert recall_of(REQ_ROWS, "NEEDS_REVIEW") == 0.5
    assert confusion_rate(REQ_ROWS, "NEEDS_REVIEW", "NOT_SATISFIED") == 0.5
    assert confusion_rate(REQ_ROWS, "NOT_SATISFIED", "NEEDS_REVIEW") == 1.0
    assert brier(REQ_ROWS) == pytest.approx((0.14 + 0.78 + 0.06 + 0.74) / 4)
    assert nll(REQ_ROWS) == pytest.approx(
        -(math.log(0.7) + math.log(0.3) + math.log(0.8) + math.log(0.3)) / 4
    )
    # 구간마다 1행: |1−0.7| + |0−0.5| + |1−0.8| + |0−0.4| 를 4 로 나눈다
    assert ece(REQ_ROWS) == pytest.approx(0.35)


def test_argmax_tie_prefers_later_candidate_like_serving() -> None:
    assert predicted_id(req_row("t", "SATISFIED", (0.4, 0.4, 0.2))) == "NOT_SATISFIED"
    assert predicted_id(req_row("t", "SATISFIED", (0.4, 0.2, 0.4))) == "NEEDS_REVIEW"


def test_score_and_noul_metrics() -> None:
    score_row = ScoredRow(
        "s1", "techFit", "score", "c", SCORE_CANDIDATES, "3", (0, 0, 0, 1.0, 0), (0, 0, 0.5, 0.5, 0)
    )
    assert expected_value_mae([score_row]) == pytest.approx(0.5)
    assert predicted_id(score_row) == "3"
    noul_rows = [
        ScoredRow("n1", "risk.scale", "noul", "c", NOUL_CANDIDATES, "true", (1.0, 0.0), (0.5, 0.5)),
        ScoredRow(
            "n2", "risk.scale", "noul", "c", NOUL_CANDIDATES, "false", (0.0, 1.0), (0.6, 0.4)
        ),
    ]
    assert [predicted_id(r) for r in noul_rows] == ["true", "true"]
    assert accuracy(noul_rows) == 0.5
    assert brier(noul_rows) == pytest.approx((0.5 + 0.72) / 2)


def test_consistency_across_seeds() -> None:
    seed0 = [
        req_row("r1", "SATISFIED", (0.7, 0.2, 0.1)),
        req_row("r2", "SATISFIED", (0.5, 0.3, 0.2)),
    ]
    seed1 = [
        req_row("r1", "SATISFIED", (0.9, 0.05, 0.05)),
        req_row("r2", "SATISFIED", (0.3, 0.5, 0.2)),
    ]
    result = consistency({0: seed0, 1: seed1})
    assert result["seeds"] == [0, 1]
    assert result["argmaxStable"] == 0.5
    assert result["spreadMean"] == pytest.approx(0.05)
    assert result["spreadMax"] == pytest.approx(0.1)


# ---------------------------------------------------------------- bosun_score


def test_parse_seeds() -> None:
    assert parse_seeds("0-5") == [0, 1, 2, 3, 4, 5]
    assert parse_seeds("4,0,2") == [0, 2, 4]
    with pytest.raises(ScoreInputError):
        parse_seeds("")


def test_bosun_score_fake_backend_writes_outputs(bundle: Path, tmp_path: Path) -> None:
    data = bundle / "bosun" / "test.en.jsonl"
    out = tmp_path / "runs" / "fake-test"
    report = score(ScoreOptions(out_dir=out, data_path=data, seeds=[0, 1, 2], backend="fake"))
    predictions = read_jsonl(out / "predictions.jsonl")
    assert len(predictions) == 3 * 3
    assert set(predictions[0]) == {"rowId", "qid", "seed", "probabilities", "argmax"}
    assert all(abs(sum(p["probabilities"]) - 1) < 1e-6 for p in predictions)
    rows = json.loads((out / "rows.json").read_text(encoding="utf-8"))
    assert len(rows) == 3
    assert set(rows[0]["probabilitiesBySeed"]) == {"0", "1", "2"}
    saved = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert saved["backend"] == "fake"
    assert saved["package"]["manifestSha256"] is None
    assert saved["data"]["sha256"] == hashlib.sha256(data.read_bytes()).hexdigest()
    assert saved["seeds"] == [0, 1, 2]
    assert saved["metrics"]["overall"]["n"] == 3
    assert set(saved["metrics"]["byFamily"]) == {REQ_FAMILY, "risk.scale"}
    assert "needsReviewRecall" in saved["metrics"]["byFamily"][REQ_FAMILY]
    assert saved["metrics"]["consistency"]["overall"]["seeds"] == [0, 1, 2]
    assert report["metrics"]["bySeed"]["0"] == saved["metrics"]["overall"]
    # 같은 입력·seed 는 같은 분포(결정적)
    again = score(
        ScoreOptions(out_dir=tmp_path / "again", data_path=data, seeds=[0], backend="fake")
    )
    assert again["metrics"]["overall"] == saved["metrics"]["bySeed"]["0"]


def test_bosun_score_cli_with_fake_backend(bundle: Path, tmp_path: Path) -> None:
    out = tmp_path / "cli-run"
    code = main(
        [
            "bosun_score",
            "--backend",
            "fake",
            "--data",
            str(bundle / "bosun" / "dev.en.jsonl"),
            "--out",
            str(out),
            "--seeds",
            "0-1",
        ]
    )
    assert code == 0
    assert (out / "report.json").exists()
    assert main(["bosun_score", "--backend", "fake", "--out", str(out)]) == 2


# ---------------------------------------------------------------- device·dtype(26-16, torch 없이)


def test_bosun_score_cli_device_and_dtype_default_to_auto() -> None:
    """services/decision CLI 와 같게 기본은 auto 다(CUDA 가 있으면 cuda·bf16, 없으면 cpu·fp32)."""
    args = parser().parse_args(["bosun_score", "--out", "x"])
    assert (args.device, args.dtype) == ("auto", "auto")
    args = parser().parse_args(["bosun_score", "--out", "x", "--device", "cpu", "--dtype", "bf16"])
    assert (args.device, args.dtype) == ("cpu", "bf16")
    with pytest.raises(SystemExit):
        parser().parse_args(["bosun_score", "--out", "x", "--device", "mps"])
    with pytest.raises(SystemExit):
        parser().parse_args(["bosun_score", "--out", "x", "--dtype", "fp16"])


@pytest.mark.parametrize(
    ("choice", "cuda_available", "expected"),
    [
        ("auto", True, "cuda"),
        ("auto", False, "cpu"),
        ("cpu", True, "cpu"),
        ("cpu", False, "cpu"),
        ("cuda", True, "cuda"),
    ],
)
def test_resolve_device(choice: str, cuda_available: bool, expected: str) -> None:
    assert resolve_device(choice, cuda_available=cuda_available) == expected


def test_resolve_device_rejects_cuda_without_cuda_and_unknown_choice() -> None:
    with pytest.raises(ScoreInputError, match="CUDA"):
        resolve_device("cuda", cuda_available=False)
    with pytest.raises(ScoreInputError, match="--device"):
        resolve_device("mps", cuda_available=True)


@pytest.mark.parametrize(
    ("device", "choice", "expected"),
    [
        ("cuda", "auto", "bf16"),
        ("cpu", "auto", "fp32"),
        ("cuda", "fp32", "fp32"),
        ("cpu", "bf16", "bf16"),
    ],
)
def test_resolve_dtype(device: str, choice: str, expected: str) -> None:
    assert resolve_dtype(device, choice) == expected


def test_resolve_dtype_rejects_unknown_choice() -> None:
    with pytest.raises(ScoreInputError, match="--dtype"):
        resolve_dtype("cpu", "fp16")


def test_make_backend_passes_device_and_dtype(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[Path, str, str]] = []

    class RecordingBackend:
        name = "bosun"

        def __init__(self, package_dir: Path, device: str, dtype: str) -> None:
            calls.append((package_dir, device, dtype))

    monkeypatch.setattr(bosun_score_module, "BosunBackend", RecordingBackend)
    package = tmp_path / "pkg"
    package.mkdir()
    base = ScoreOptions(
        out_dir=tmp_path / "o", data_path=tmp_path / "d", seeds=[0], package_dir=package
    )
    make_backend(base)
    make_backend(
        ScoreOptions(
            out_dir=tmp_path / "o",
            data_path=tmp_path / "d",
            seeds=[0],
            package_dir=package,
            device="cuda",
            dtype="bf16",
        )
    )
    assert calls == [(package, "auto", "auto"), (package, "cuda", "bf16")]


def test_bosun_score_cli_forwards_device_and_dtype(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[ScoreOptions] = []

    def fake_score(options: ScoreOptions) -> dict[str, Any]:
        seen.append(options)
        return {"metrics": {"overall": {}, "consistency": {"overall": {}}}}

    monkeypatch.setattr(sol_eval_cli, "score", fake_score)
    data = tmp_path / "d.jsonl"
    data.write_text("", encoding="utf-8")
    args = ["bosun_score", "--data", str(data), "--out", str(tmp_path / "o")]
    assert main(args) == 0
    assert main([*args, "--device", "cpu", "--dtype", "fp32"]) == 0
    assert [(o.device, o.dtype) for o in seen] == [("auto", "auto"), ("cpu", "fp32")]


def test_bosun_score_report_records_backend_device_and_dtype(bundle: Path, tmp_path: Path) -> None:
    data = bundle / "bosun" / "dev.en.jsonl"
    fake = score(ScoreOptions(out_dir=tmp_path / "fake", data_path=data, seeds=[0], backend="fake"))
    assert (fake["environment"]["device"], fake["environment"]["dtype"]) == (None, None)

    class LoadedBackend(StaticBackend):
        device = "cpu"
        dtype = "fp32"

    loaded = score(
        ScoreOptions(out_dir=tmp_path / "loaded", data_path=data, seeds=[0]),
        backend=LoadedBackend({}),
    )
    saved = json.loads((tmp_path / "loaded" / "report.json").read_text(encoding="utf-8"))
    assert (saved["environment"]["device"], saved["environment"]["dtype"]) == ("cpu", "fp32")
    assert loaded["environment"] == saved["environment"]


def _bosun_package(root: Path, *, files: dict[str, bytes] | None = None) -> Path:
    """가짜 Bosun 패키지(HF 레이아웃 + manifest.json). 모델이 아니다."""
    root.mkdir(parents=True, exist_ok=True)
    files = files or {
        "config.json": b'{"architectures": ["BosunForDecision"]}',
        "modeling_bosun.py": b"# model",
        "configuration_bosun.py": b"# config",
        "adapter/adapter_model.safetensors": b"adapter-bytes",
        "decision_embeddings.safetensors": b"embedding-bytes",
    }
    manifest = {}
    for relative, data in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest[relative] = hashlib.sha256(data).hexdigest()
    (root / "manifest.json").write_text(json.dumps({"files": manifest}), encoding="utf-8")
    return root


def test_verify_package_dir_passes_and_returns_manifest_files(tmp_path: Path) -> None:
    root = _bosun_package(tmp_path / "pkg")
    files = verify_package_dir(root)
    assert set(files) >= {"config.json", "modeling_bosun.py", "configuration_bosun.py"}


@pytest.mark.parametrize(
    ("tamper", "summary"),
    [
        (
            lambda r: (r / "modeling_bosun.py").write_bytes(b"# tampered"),
            "SHA256_MISMATCH(modeling_bosun.py)",
        ),
        (
            lambda r: (r / "planted.py").write_bytes(b"# planted"),
            "REMOTE_CODE_NOT_IN_MANIFEST(planted.py)",
        ),
        (
            lambda r: (r / "decision_embeddings.safetensors").unlink(),
            "FILE_MISSING(decision_embeddings.safetensors)",
        ),
        (lambda r: (r / "manifest.json").unlink(), "MANIFEST_MISSING(manifest.json)"),
    ],
)
def test_verify_package_dir_rejects_tampered_package(tmp_path: Path, tamper, summary: str) -> None:
    root = _bosun_package(tmp_path / "pkg")
    tamper(root)
    with pytest.raises(PackageVerificationError) as error:
        verify_package_dir(root)
    assert error.value.summary == summary
    # 요약은 코드(경로)만. 해시 값(64 hex)은 담지 않는다
    assert not re.search(r"[0-9a-f]{64}", str(error.value))


def test_bosun_backend_refuses_tampered_package_before_loading(tmp_path: Path) -> None:
    """--backend bosun 은 검증 실패 시 transformers 를 import 하지 않고 ScoreInputError 로 끝난다(exit 2)."""
    root = _bosun_package(tmp_path / "pkg")
    (root / "modeling_bosun.py").write_bytes(b"# tampered")
    options = ScoreOptions(
        out_dir=tmp_path / "out", data_path=tmp_path / "x.jsonl", seeds=[0], package_dir=root
    )
    with pytest.raises(ScoreInputError, match=r"SHA256_MISMATCH\(modeling_bosun\.py\)"):
        make_backend(options)


def test_bosun_score_decisionbench_suite_adapter(tmp_path: Path) -> None:
    suite = tmp_path / "suite.jsonl"
    rows = [
        {
            "id": "db-1",
            "instruction": "Pick the safer option.",
            "state_json": json.dumps({"facts": ["a", "b"]}),
            "candidates_json": json.dumps(["A", "B", "C"]),
            "gold_candidate_id": "B",
        },
        {
            "id": "db-2",
            "instruction": "Is the claim supported?",
            "state_json": json.dumps({"claim": "x"}),
            "candidates_json": json.dumps(
                [{"id": "true", "label": "yes"}, {"id": "false", "label": "no"}]
            ),
            "gold_candidate_id": "true",
            "decision_type": "noul",
        },
        {
            "instruction": "Rate the plan.",
            "state_json": json.dumps({"plan": "y"}),
            "candidates_json": json.dumps(["0", "1", "2"]),
            "gold_candidate_id": "2",
        },
    ]
    suite.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    out = tmp_path / "suite-run"
    report = score(
        ScoreOptions(
            out_dir=out,
            data_path=suite,
            seeds=[0],
            backend="fake",
            suite_format="decisionbench",
        )
    )
    assert report["data"]["rows"] == 3
    assert report["data"]["suiteFormat"] == "decisionbench"
    saved_rows = json.loads((out / "rows.json").read_text(encoding="utf-8"))
    assert [r["qid"] for r in saved_rows] == ["suite:choice", "suite:noul", "suite:choice"]
    assert saved_rows[1]["candidateIds"] == ["true", "false"]
    assert len(saved_rows[2]["rowId"]) == 64
    bad = tmp_path / "bad.jsonl"
    bad.write_text(
        json.dumps({**rows[0], "gold_candidate_id": "Z"}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ScoreInputError, match="gold_candidate_id"):
        score(
            ScoreOptions(
                out_dir=tmp_path / "bad-run",
                data_path=bad,
                seeds=[0],
                backend="fake",
                suite_format="decisionbench",
            )
        )


# ---------------------------------------------------------------- compare


class StaticBackend:
    """시험용: rowId → 분포 표. 표에 없으면 균등."""

    name = "static"

    def __init__(self, table: dict[str, list[float]]) -> None:
        self.table = table

    def predict(self, *, state, instructions, candidates, decision_type, seed, row_id):
        return self.table.get(row_id, [1 / len(candidates)] * len(candidates))


def test_compare_reports_delta_with_cluster_bootstrap(bundle: Path, tmp_path: Path) -> None:
    data = bundle / "bosun" / "train.en.jsonl"
    records = read_jsonl(data)

    def table(correct: bool) -> dict[str, list[float]]:
        out: dict[str, list[float]] = {}
        for record in records:
            ids = [c["id"] for c in record["candidates"]]
            gold = ids.index(record["gold"]["candidateId"])
            wrong = (gold + 1) % len(ids)
            winner = gold if correct else wrong
            out[record["rowId"]] = [
                0.9 if i == winner else 0.1 / (len(ids) - 1) for i in range(len(ids))
            ]
        return out

    candidate_dir, reference_dir = tmp_path / "cand", tmp_path / "ref"
    for out_dir, correct in ((candidate_dir, True), (reference_dir, False)):
        score(
            ScoreOptions(out_dir=out_dir, data_path=data, seeds=[0], backend="fake"),
            backend=StaticBackend(table(correct)),
        )
    options = CompareOptions(
        candidate_dir=candidate_dir,
        reference_dir=reference_dir,
        out_dir=tmp_path / "cmp",
        iterations=200,
    )
    report = compare(options)
    cluster = report["bootstrap"]["cluster"]
    assert cluster["unit"] == "cluster"
    assert cluster["units"] == 1  # 합성 train 은 클러스터 c-A 하나다
    assert report["point"]["candidate"]["accuracy"] == 1.0
    assert report["point"]["reference"]["accuracy"] == 0.0
    assert cluster["accuracy"]["delta"] == 1.0
    assert cluster["accuracy"]["ci95"] == [1.0, 1.0]
    assert cluster["accuracy"]["improvementClaimable"] is True
    assert cluster["ece"]["betterWhen"] == "lower"
    assert report["claim"]["primaryMetric"] == "macroF1"
    assert report["claim"]["improvementClaimable"] is True
    record = report["bootstrap"]["record"]
    assert record["units"] == len(records)
    assert record["macroF1"]["ci95"][0] > 0
    # 결정적: 같은 seed 로 다시 돌리면 같은 구간
    assert compare(options)["bootstrap"] == report["bootstrap"]
    assert (tmp_path / "cmp" / "report.json").exists()


def half_correct_table(records: list[dict[str, Any]], correct: set[str]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for record in records:
        ids = [c["id"] for c in record["candidates"]]
        gold = ids.index(record["gold"]["candidateId"])
        winner = gold if record["rowId"] in correct else (gold + 1) % len(ids)
        out[record["rowId"]] = [
            0.8 if i == winner else 0.2 / (len(ids) - 1) for i in range(len(ids))
        ]
    return out


def test_compare_flags_no_improvement_when_ci_includes_zero(bundle: Path, tmp_path: Path) -> None:
    data = bundle / "bosun" / "train.en.jsonl"
    records = read_jsonl(data)
    half = {r["rowId"] for i, r in enumerate(records) if i % 2 == 0}
    others = {r["rowId"] for r in records} - half
    for name, correct in (("a", half), ("b", others)):
        score(
            ScoreOptions(out_dir=tmp_path / name, data_path=data, seeds=[0], backend="fake"),
            backend=StaticBackend(half_correct_table(records, correct)),
        )
    report = compare(
        CompareOptions(tmp_path / "a", tmp_path / "b", tmp_path / "ab", iterations=300)
    )
    # 정확도는 둘 다 3/6 → Δ 0. 레코드 부트스트랩 구간은 0 을 걸치고 개선 주장 불가
    assert report["point"]["candidate"]["accuracy"] == report["point"]["reference"]["accuracy"]
    for unit in ("cluster", "record"):
        entry = report["bootstrap"][unit]["accuracy"]
        assert entry["delta"] == 0.0
        assert entry["ci95"][0] <= 0 <= entry["ci95"][1]
        assert entry["ciIncludesZero"] is True
        assert entry["improvementClaimable"] is False
    record = report["bootstrap"]["record"]["accuracy"]
    assert record["ci95"][0] < 0 < record["ci95"][1]


def test_compare_identical_runs_claim_nothing(bundle: Path, tmp_path: Path) -> None:
    data = bundle / "bosun" / "train.en.jsonl"
    records = read_jsonl(data)
    table = half_correct_table(records, {r["rowId"] for r in records[:4]})
    for name in ("a", "b"):
        score(
            ScoreOptions(out_dir=tmp_path / name, data_path=data, seeds=[0], backend="fake"),
            backend=StaticBackend(table),
        )
    report = compare(CompareOptions(tmp_path / "a", tmp_path / "b", tmp_path / "ab", iterations=50))
    for unit in ("cluster", "record"):
        for name in ("macroF1", "accuracy", "needsReviewRecall", "ece"):
            entry = report["bootstrap"][unit][name]
            assert entry["delta"] == 0.0 and entry["ci95"] == [0.0, 0.0]
            assert entry["improvementClaimable"] is False
    assert report["claim"]["improvementClaimable"] is False


def test_compare_rejects_different_data(bundle: Path, tmp_path: Path) -> None:
    for name, split in (("x", "train"), ("y", "dev")):
        score(
            ScoreOptions(
                out_dir=tmp_path / name,
                data_path=bundle / "bosun" / f"{split}.en.jsonl",
                seeds=[0],
                backend="fake",
            )
        )
    with pytest.raises(CompareError, match="rowId 집합"):
        compare(CompareOptions(tmp_path / "x", tmp_path / "y", tmp_path / "xy", iterations=10))
    # rowId 는 같지만 데이터 sha256 이 다르면 거절한다
    report_path = tmp_path / "x" / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report["data"]["sha256"] = "0" * 64
    report_path.write_text(json.dumps(report), encoding="utf-8")
    score(
        ScoreOptions(
            out_dir=tmp_path / "z",
            data_path=bundle / "bosun" / "train.en.jsonl",
            seeds=[0],
            backend="fake",
        )
    )
    with pytest.raises(CompareError, match="sha256"):
        compare(CompareOptions(tmp_path / "x", tmp_path / "z", tmp_path / "xz", iterations=10))
