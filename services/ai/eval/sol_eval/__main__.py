"""python -m sol_eval: labels check · build · export · manifest (docs/21 §6, e3 설계 §5).

DB·네트워크·실모델을 쓰지 않는다. 문제가 있으면 exit 1, 입력 형식 오류는 exit 2.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from sol_eval import DATASET_VERSION
from sol_eval.build_branch1 import BuildOptions, build
from sol_eval.dataset import DatasetFormatError
from sol_eval.export import ExportError, ExportOptions, export
from sol_eval.labels import check_file, format_summary
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
    )
    summary = export(options)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
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

    e = sub.add_parser("export", help="EvalItem → Kev JSONL(en·ko)")
    common(e)
    e.add_argument("--languages", default="en,ko")
    e.add_argument(
        "--max-state", type=int, default=2048, help="state 토큰 상한(글자/4 근사, 초과는 경고)"
    )
    e.set_defaults(func=cmd_export)

    m = sub.add_parser("manifest", help="번들 manifest.json")
    common(m)
    m.set_defaults(func=cmd_manifest)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return args.func(args)
    except (DatasetFormatError, ExportError, ManifestError, ValueError, FileNotFoundError) as error:
        print(f"오류: {error}", file=sys.stderr)
        return EX_FORMAT


if __name__ == "__main__":
    sys.exit(main())
