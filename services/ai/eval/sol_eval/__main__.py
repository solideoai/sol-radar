"""python -m sol_eval: labels check · build · export · manifest · leakage · bosun_score · compare (docs/21 §6, ADR-034).

DB·네트워크를 쓰지 않는다. 실모델은 bosun_score --backend bosun(기본)만 로컬 패키지에서 올린다.
문제(라벨 검사 실패·누수 위반)가 있으면 exit 1, 입력 형식 오류는 exit 2.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from sol_eval import DATASET_VERSION
from sol_eval.bosun_score import (
    BACKEND_BOSUN,
    BACKEND_FAKE,
    DEFAULT_SEEDS,
    SUITE_FORMAT_DECISIONBENCH,
    SUITE_FORMATS,
    ScoreInputError,
    ScoreOptions,
    parse_seeds,
    score,
)
from sol_eval.build_branch1 import BuildOptions, build
from sol_eval.compare import (
    DEFAULT_BOOTSTRAP_SEED,
    DEFAULT_ITERATIONS,
    CompareError,
    CompareOptions,
    compare,
)
from sol_eval.dataset import DatasetFormatError
from sol_eval.export import FORMAT_KEV, FORMATS, ExportError, ExportOptions, export
from sol_eval.labels import check_file, format_summary
from sol_eval.leakage import (
    DEFAULT_MIN_SHARE,
    DEFAULT_SIMILARITY_THRESHOLD,
    LeakageInputError,
    LeakageOptions,
    check_bundle,
)
from sol_eval.manifest import ManifestError, write_manifest
from sol_eval.paths import (
    DEFAULT_COMPANIES_DIR,
    DEFAULT_INDUSTRY_DIR,
    DEFAULT_OUT_DIR,
    DEFAULT_RECORDED_DIR,
    DEFAULT_SPLITS_FILE,
    FALLBACK_COMPANY_FILE,
    FALLBACK_RECORDED_DIR,
    resolve,
)

EX_PROBLEMS = 1
EX_FORMAT = 2


def _out_dir(value: str | None, version: str) -> Path:
    return resolve(value) if value else DEFAULT_OUT_DIR / version


def cmd_labels_check(args: argparse.Namespace) -> int:
    path = resolve(args.file)
    result = check_file(path)
    for line in format_summary(result):
        print(line)
    for problem in result.problems:
        print(f"PROBLEM {problem}")
    print("OK" if result.ok else f"FAILED ({len(result.problems)} problems)")
    return 0 if result.ok else EX_PROBLEMS


def cmd_build(args: argparse.Namespace) -> int:
    recorded = resolve(args.recorded) if args.recorded else DEFAULT_RECORDED_DIR
    if not recorded.is_dir():
        print(f"녹음 폴더가 없어 C1 녹음으로 대체한다: {recorded} → {FALLBACK_RECORDED_DIR}")
        recorded = FALLBACK_RECORDED_DIR
    options = BuildOptions(
        recorded_dir=recorded,
        industry_dir=resolve(args.industry) if args.industry else DEFAULT_INDUSTRY_DIR,
        companies_dir=resolve(args.companies) if args.companies else DEFAULT_COMPANIES_DIR,
        company_file=resolve(args.company_file) if args.company_file else FALLBACK_COMPANY_FILE,
        splits_file=(resolve(args.splits) if args.splits else DEFAULT_SPLITS_FILE)
        if not args.derive_splits
        else None,
        out_dir=_out_dir(args.out, args.version),
        as_of=date.fromisoformat(args.as_of),
        dataset_version=args.version,
        holdout_company=args.holdout_company,
        max_train_records=args.max_train_records,
        include_missing_license_rows=args.include_missing_license_rows,
    )
    report = build(options)
    print(json.dumps(report.to_json(), ensure_ascii=False, indent=2))
    print(f"wrote {options.out_dir}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    options = ExportOptions(
        out_dir=_out_dir(args.out, args.version),
        languages=tuple(args.languages.split(",")),
        max_state_tokens=args.max_state,
        format=args.format,
    )
    summary = export(options)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def cmd_leakage(args: argparse.Namespace) -> int:
    report = check_bundle(
        LeakageOptions(
            bundle_dir=resolve(args.bundle),
            similarity_threshold=args.similarity,
            fail_on_similarity=args.fail_on_similarity,
            min_share=args.min_share,
        )
    )
    payload = report.to_json()
    if args.out:
        out = resolve(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if report.ok else EX_PROBLEMS


def cmd_bosun_score(args: argparse.Namespace) -> int:
    if args.suite and args.data:
        raise ScoreInputError("--data 와 --suite 는 함께 쓰지 않는다")
    if not args.suite and not args.data:
        raise ScoreInputError("--data 또는 --suite 가 필요하다")
    options = ScoreOptions(
        out_dir=resolve(args.out),
        data_path=resolve(args.suite or args.data),
        seeds=parse_seeds(args.seeds),
        backend=args.backend,
        package_dir=resolve(args.package) if args.package else None,
        suite_format=args.suite_format if args.suite else None,
    )
    report = score(options)
    shown = {k: v for k, v in report.items() if k != "metrics"}
    shown["metrics"] = {
        "overall": report["metrics"]["overall"],
        "consistency": report["metrics"]["consistency"]["overall"],
    }
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    print(f"wrote {options.out_dir}")
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    report = compare(
        CompareOptions(
            candidate_dir=resolve(args.candidate),
            reference_dir=resolve(args.reference),
            out_dir=resolve(args.out),
            prediction_seed=args.seed,
            iterations=args.iterations,
            bootstrap_seed=args.bootstrap_seed,
        )
    )
    shown = {k: v for k, v in report.items() if k != "bootstrap"}
    shown["bootstrap"] = report["bootstrap"]["cluster"]
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    return 0


def cmd_manifest(args: argparse.Namespace) -> int:
    manifest = write_manifest(_out_dir(args.out, args.version))
    shown = {k: v for k, v in manifest.items() if k not in ("files", "recordedFiles")}
    shown["files"] = len(manifest["files"])
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="sol_eval", description=__doc__)
    sub = root.add_subparsers(dest="command", required=True)

    labels = sub.add_parser("labels", help="라벨 파일 검사")
    labels_sub = labels.add_subparsers(dest="labels_command", required=True)
    check = labels_sub.add_parser("check", help="형식·값 집합·근거 존재·중복·HUMAN 메타 검사")
    check.add_argument("file")
    check.set_defaults(func=cmd_labels_check)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--version", default=DATASET_VERSION, help="데이터셋 버전(기본 v0.1)")
        p.add_argument("--out", help="출력 폴더(기본 datasets/sol-eval/<version>)")

    b = sub.add_parser("build", help="갈래 ① EvalItem JSONL 빌드")
    common(b)
    b.add_argument(
        "--as-of", required=True, help="risk.schedule 기준일 YYYY-MM-DD(manifest 에 기록)"
    )
    b.add_argument(
        "--recorded",
        help="녹음 폴더(기본 fixtures/recorded/train, 없으면 fixtures/recorded/15129394)",
    )
    b.add_argument("--industry", help="업종 마스터 녹음 폴더(기본 fixtures/recorded/15129467)")
    b.add_argument("--companies", help="원형 폴더(기본 fixtures/eval/companies)")
    b.add_argument("--company-file", help="원형 폴더가 없을 때 쓸 프로필 하나(기본 솔리데오)")
    b.add_argument("--splits", help="분할 파일(기본 fixtures/eval/splits.v0.1.json)")
    b.add_argument(
        "--derive-splits",
        action="store_true",
        help="분할 파일 대신 union-find+hash 유도 분할(개발용)",
    )
    b.add_argument("--holdout-company", default="06", help="test 에만 두는 원형 id 접두(기본 06)")
    b.add_argument(
        "--max-train-records", type=int, help="train item 상한(sha256(itemId) 순 결정적 표본)"
    )
    b.add_argument(
        "--include-missing-license-rows",
        action="store_true",
        help="indstrytyLmtYn=Y 인데 면허제한 행이 없는 공고도 qualifications UNKNOWN 으로 넣는다",
    )
    b.set_defaults(func=cmd_build)

    e = sub.add_parser(
        "export", help="EvalItem → Kev JSONL(en·ko) 또는 Bosun 질문 단위 JSONL(--format bosun)"
    )
    common(e)
    e.add_argument(
        "--format",
        default=FORMAT_KEV,
        choices=FORMATS,
        help="kev(기본): kev/{split}.{lang}.jsonl · bosun: bosun/{split}.en.jsonl + manifest.json",
    )
    e.add_argument("--languages", default="en,ko", help="kev 형식만. bosun 은 en 고정")
    e.add_argument(
        "--max-state",
        type=int,
        default=2048,
        help="kev 형식만. state 토큰 상한(글자/4 근사, 초과는 경고)",
    )
    e.set_defaults(func=cmd_export)

    lk = sub.add_parser(
        "leakage", help="Bosun 번들 누수 검사(클러스터·fixture·held-out·state·분포·sha256)"
    )
    lk.add_argument("--bundle", required=True, help="manifest.json 과 bosun/ 이 있는 폴더")
    lk.add_argument(
        "--similarity",
        type=float,
        default=DEFAULT_SIMILARITY_THRESHOLD,
        help="유사 state 5-gram Jaccard 임계(기본 0.9)",
    )
    lk.add_argument(
        "--fail-on-similarity", action="store_true", help="유사 state 를 경고가 아니라 위반으로"
    )
    lk.add_argument(
        "--min-share",
        type=float,
        default=DEFAULT_MIN_SHARE,
        help="후보별 최소 정답 비율(기본 0.05)",
    )
    lk.add_argument("--out", help="리포트 JSON 저장 위치(선택)")
    lk.set_defaults(func=cmd_leakage)

    bs = sub.add_parser("bosun_score", help="Bosun 패키지 오프라인 채점(E1'·E4)")
    bs.add_argument("--package", help="Bosun 패키지 폴더(HF 레이아웃). backend bosun 에 필수")
    bs.add_argument("--data", help="bosun/{split}.en.jsonl")
    bs.add_argument(
        "--out", required=True, help="출력 폴더(predictions.jsonl·rows.json·report.json)"
    )
    bs.add_argument(
        "--seeds", default=DEFAULT_SEEDS, help='후보 제시 순서 seed("0-5" 또는 "0,2,4")'
    )
    bs.add_argument(
        "--backend",
        default=BACKEND_BOSUN,
        choices=(BACKEND_BOSUN, BACKEND_FAKE),
        help="bosun(기본, 로컬 패키지) 또는 fake(결정적 가짜, 시험용)",
    )
    bs.add_argument("--suite", help="외부 보조 평가 JSONL(ADR-034 9번). 라이선스 확인 뒤에만 실행")
    bs.add_argument("--suite-format", default=SUITE_FORMAT_DECISIONBENCH, choices=SUITE_FORMATS)
    bs.set_defaults(func=cmd_bosun_score)

    cp = sub.add_parser("compare", help="두 bosun_score 출력의 짝 부트스트랩 Δ·95%% CI")
    cp.add_argument("--candidate", required=True, help="예: runs/e4-test")
    cp.add_argument("--reference", required=True, help="예: runs/e1p-test")
    cp.add_argument("--out", required=True)
    cp.add_argument("--seed", type=int, default=0, help="비교할 예측 seed(기본 0, 서빙과 같다)")
    cp.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    cp.add_argument("--bootstrap-seed", type=int, default=DEFAULT_BOOTSTRAP_SEED)
    cp.set_defaults(func=cmd_compare)

    m = sub.add_parser("manifest", help="번들 manifest.json")
    common(m)
    m.set_defaults(func=cmd_manifest)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return args.func(args)
    except (
        DatasetFormatError,
        ExportError,
        ManifestError,
        LeakageInputError,
        ScoreInputError,
        CompareError,
        ValueError,
        FileNotFoundError,
    ) as error:
        print(f"오류: {error}", file=sys.stderr)
        return EX_FORMAT


if __name__ == "__main__":
    sys.exit(main())
