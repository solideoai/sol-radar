"""`bosun_score`: Bosun 패키지로 bosun/*.en.jsonl 을 오프라인 채점한다(docs/21 §4.1·§4.3, 22 §4.4, ADR-034 7번).

    python -m sol_eval bosun_score --package <dir> --data bosun/test.en.jsonl --out runs/e4-test --seeds 0-5
    python -m sol_eval bosun_score --backend fake --data … --out …                 # 결정적 가짜(시험용)
    python -m sol_eval bosun_score --package <dir> --suite <jsonl> --suite-format decisionbench --out …

- 백엔드는 지연 import 다. 먼저 `package_check.verify_package_dir`(manifest sha256·최상위 *.py 대조. 위반이면
  ScoreInputError, exit 2) 를 지난 뒤 `AutoModelForCausalLM.from_pretrained(package, trust_remote_code=True, local_files_only=True)`
  뒤 Bosun 공개 API `model.predict(state=, instructions=, candidates=, decision_type=, seed=, row_id=)["probabilities"]`
  (후보 순서 리스트)를 부른다. 네트워크·모델 다운로드는 하지 않는다. **실모델 경로는 2026-10-20 미검증**이다
  (candidates 인자에 {id,label,description} 목록을 그대로 넘기는 것, decision_type 값이 questionType 과 같다는 것은 가정).
- `--device {auto,cpu,cuda}`(기본 auto: CUDA 가 있으면 cuda)·`--dtype {auto,fp32,bf16}`(기본 auto: cuda 는 bf16,
  cpu 는 fp32)는 services/decision 의 CLI(parity·train·calibrate·serve)와 같은 규칙이다. 실제로 쓴 값은
  report.json environment 의 device·dtype 에 남는다. GPU 사용 승인은 ADR-034 10번대로 사람이 실행 전에 한다(코드 게이트 아님).
- `--backend fake` 는 sha256(rowId:seed) 로 만드는 결정적 분포다. 모델이 아니다. 지표 계산·파일 모양 시험에만 쓴다.
- `--suite` 는 보조 회귀 평가 입력 자리(ADR-034 9번)다. DecisionBench 행(instruction·state_json·candidates_json·
  gold_candidate_id)을 같은 predict 경로로 채점한다. **실행은 DecisionBench 라이선스(`other`)·우리 데이터와의 중복·
  재배포 조건을 확인한 뒤 별도 승인으로만 한다.** 여기서는 어댑터와 가짜 행 시험만 둔다.
- 출력: predictions.jsonl(rowId·qid·seed·probabilities·argmax), rows.json(gold·예측 요약), report.json(패키지 경로·
  manifest sha256·데이터 sha256·seed 목록·지표). 지표의 기본 seed 는 서빙과 같은 0 이고 seed 별 지표도 함께 적는다.
- 회사 서버의 smoke 6건은 기능 검증 데이터라 성능 평가 입력으로 쓰지 않는다(ADR-034 7번).
"""

import hashlib
import json
import platform
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path
from typing import Any, Protocol

from sol_ai.adapters import kev_wire
from sol_eval.bosun_metrics import (
    ScoredRow,
    consistency,
    group_by,
    group_metrics,
    predicted_id,
)
from sol_eval.labels import qid_family
from sol_eval.leakage import read_jsonl
from sol_eval.manifest import sha256_file
from sol_eval.package_check import PackageVerificationError, verify_package_dir

SCORE_REPORT_SCHEMA_VERSION = "sol-eval-bosun-score-report/v0.1"
PREDICTIONS_FILE = "predictions.jsonl"
ROWS_FILE = "rows.json"
REPORT_FILE = "report.json"
PACKAGE_MANIFEST = "manifest.json"
# 패키지 안에서 sha256 을 기록하는 가중치 파일(22 §2.2). 없으면 건너뛴다
PACKAGE_WEIGHT_FILES = ("adapter/adapter_model.safetensors", "decision_embeddings.safetensors")
BACKEND_FAKE = "fake"
BACKEND_BOSUN = "bosun"
SUITE_FORMAT_DECISIONBENCH = "decisionbench"
SUITE_FORMATS = (SUITE_FORMAT_DECISIONBENCH,)
DEFAULT_SEEDS = "0-5"
PRIMARY_SEED = 0
# questionType → Bosun decision_type. 같은 값이라는 가정(미검증). 바뀌면 이 표만 고친다
DECISION_TYPE_BY_QUESTION_TYPE = {
    kev_wire.CHOICE: "choice",
    kev_wire.SCORE: "score",
    kev_wire.NOUL: "noul",
}
ENVIRONMENT_PACKAGES = ("torch", "transformers", "peft", "safetensors")
DEVICE_AUTO = "auto"
DEVICE_CPU = "cpu"
DEVICE_CUDA = "cuda"
DEVICE_CHOICES = (DEVICE_AUTO, DEVICE_CPU, DEVICE_CUDA)
DTYPE_AUTO = "auto"
DTYPE_FP32 = "fp32"
DTYPE_BF16 = "bf16"
DTYPE_CHOICES = (DTYPE_AUTO, DTYPE_FP32, DTYPE_BF16)
# torch 의 dtype 속성 이름. torch 는 BosunBackend 안에서만 import 한다
TORCH_DTYPE_NAMES = {DTYPE_FP32: "float32", DTYPE_BF16: "bfloat16"}


class ScoreInputError(ValueError):
    pass


@dataclass(frozen=True)
class ScoreInput:
    """채점할 질문 하나(Bosun 레코드 또는 외부 suite 행을 같은 모양으로)."""

    row_id: str
    qid: str
    question_type: str
    cluster_id: str
    instructions: str
    state: Any
    candidates: tuple[dict[str, Any], ...]
    gold_id: str
    gold_probabilities: tuple[float, ...]

    @property
    def candidate_ids(self) -> tuple[str, ...]:
        return tuple(str(c["id"]) for c in self.candidates)


class Backend(Protocol):
    name: str

    def predict(
        self,
        *,
        state: Any,
        instructions: str,
        candidates: Sequence[dict[str, Any]],
        decision_type: str,
        seed: int,
        row_id: str,
    ) -> list[float]: ...


class FakeBackend:
    """sha256(rowId:seed) 로 만드는 결정적 분포. 모델이 아니다(시험·파이프라인 점검용)."""

    name = BACKEND_FAKE

    def predict(
        self,
        *,
        state: Any,
        instructions: str,
        candidates: Sequence[dict[str, Any]],
        decision_type: str,
        seed: int,
        row_id: str,
    ) -> list[float]:
        digest = hashlib.sha256(f"{row_id}:{seed}".encode()).digest()
        k = len(candidates)
        if k == 0:
            raise ScoreInputError(f"{row_id}: 후보가 없다")
        weights = [1.0 + digest[1 + i % 31] / 255.0 for i in range(k)]
        weights[digest[0] % k] += 2.0
        total = sum(weights)
        return [w / total for w in weights]


def resolve_device(choice: str, *, cuda_available: bool) -> str:
    """auto 는 CUDA 가 있으면 cuda, 없으면 cpu. cuda 를 골랐는데 없으면 오류.

    services/decision `trainer/params.resolve_device` 와 같은 규칙이다(sol_eval 은 sol_decision 을 import 하지 않는다).
    """
    if choice not in DEVICE_CHOICES:
        raise ScoreInputError(f"알 수 없는 --device: {choice} (가능: {', '.join(DEVICE_CHOICES)})")
    if choice == DEVICE_AUTO:
        return DEVICE_CUDA if cuda_available else DEVICE_CPU
    if choice == DEVICE_CUDA and not cuda_available:
        raise ScoreInputError("--device cuda 를 골랐지만 CUDA 를 쓸 수 없다")
    return choice


def resolve_dtype(device: str, choice: str) -> str:
    """auto 는 cuda 면 bf16, cpu 면 fp32. 고르면 그대로(services/decision `resolve_dtype` 의 --bf16/--no-bf16 과 같다)."""
    if choice not in DTYPE_CHOICES:
        raise ScoreInputError(f"알 수 없는 --dtype: {choice} (가능: {', '.join(DTYPE_CHOICES)})")
    if choice == DTYPE_AUTO:
        return DTYPE_BF16 if device == DEVICE_CUDA else DTYPE_FP32
    return choice


class BosunBackend:
    """Bosun 패키지(HF 레이아웃)를 로컬에서만 올린다. torch·transformers 는 여기서만 import 한다.

    `trust_remote_code=True` 는 패키지의 `modeling_bosun.py` 를 실행하므로 검증(manifest sha256·최상위 *.py)을
    지난 디렉터리만 올린다. 위반이면 PackageVerificationError 를 내고 transformers 는 import 하지 않는다.
    입력 텐서는 Bosun 공개 API `predict` 가 모델 안에서 만든다. 여기서는 모델을 device 로 옮기기만 한다
    (services/decision `backend.BosunBackend` 와 같다).
    """

    name = BACKEND_BOSUN

    def __init__(
        self, package_dir: Path, device: str = DEVICE_AUTO, dtype: str = DTYPE_AUTO
    ) -> None:
        verify_package_dir(package_dir)
        if dtype not in DTYPE_CHOICES:
            raise ScoreInputError(f"알 수 없는 --dtype: {dtype} (가능: {', '.join(DTYPE_CHOICES)})")
        import torch
        from transformers import AutoModelForCausalLM

        self.package_dir = package_dir
        self.device = resolve_device(device, cuda_available=torch.cuda.is_available())
        self.dtype = resolve_dtype(self.device, dtype)
        model = AutoModelForCausalLM.from_pretrained(
            str(package_dir),
            trust_remote_code=True,
            local_files_only=True,
            dtype=getattr(torch, TORCH_DTYPE_NAMES[self.dtype]),
        )
        self.model = model.to(self.device)
        self.model.eval()

    def predict(
        self,
        *,
        state: Any,
        instructions: str,
        candidates: Sequence[dict[str, Any]],
        decision_type: str,
        seed: int,
        row_id: str,
    ) -> list[float]:
        result = self.model.predict(
            state=state,
            instructions=instructions,
            candidates=list(candidates),
            decision_type=decision_type,
            seed=seed,
            row_id=row_id,
        )
        return [float(p) for p in result["probabilities"]]


# ---------------------------------------------------------------- 입력


def parse_seeds(text: str) -> list[int]:
    """ "0-5" → [0..5], "0,2,4" → [0,2,4]. 비거나 음수면 오류."""
    seeds: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            low, high = part.split("-", 1)
            seeds.extend(range(int(low), int(high) + 1))
        else:
            seeds.append(int(part))
    if not seeds or any(s < 0 for s in seeds):
        raise ScoreInputError(f"seed 목록이 비었거나 음수다: {text!r}")
    return sorted(set(seeds))


def _probabilities(values: Any, size: int, where: str) -> tuple[float, ...]:
    if not isinstance(values, list) or len(values) != size:
        raise ScoreInputError(f"{where}: probabilities 길이가 후보 수와 다르다")
    out = tuple(float(v) for v in values)
    if abs(sum(out) - 1) > kev_wire.PROBABILITY_SUM_TOLERANCE:
        raise ScoreInputError(f"{where}: probabilities 합이 1 이 아니다")
    return out


def bosun_row_to_input(record: dict[str, Any]) -> ScoreInput:
    candidates = tuple(record["candidates"])
    gold = record["gold"]
    return ScoreInput(
        row_id=str(record["rowId"]),
        qid=str(record["qid"]),
        question_type=str(record["questionType"]),
        cluster_id=str(record.get("clusterId") or record["rowId"]),
        instructions=str(record["instructions"]),
        state=record["state"],
        candidates=candidates,
        gold_id=str(gold["candidateId"]),
        gold_probabilities=_probabilities(gold["probabilities"], len(candidates), record["rowId"]),
    )


def load_bosun_inputs(path: Path) -> list[ScoreInput]:
    inputs = [bosun_row_to_input(r) for r in read_jsonl(path)]
    if not inputs:
        raise ScoreInputError(f"{path}: 레코드가 없다")
    ids = [i.row_id for i in inputs]
    if len(set(ids)) != len(ids):
        raise ScoreInputError(f"{path}: rowId 가 겹친다")
    return inputs


def _suite_candidates(raw: Any) -> tuple[dict[str, Any], ...]:
    """DecisionBench candidates_json: 문자열 목록 또는 {id,label,description} 목록."""
    values = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(values, list) or not values:
        raise ScoreInputError("candidates_json 이 비어 있거나 목록이 아니다")
    out: list[dict[str, Any]] = []
    for value in values:
        if isinstance(value, dict):
            identifier = str(value.get("id", value.get("label")))
            out.append(
                {
                    "id": identifier,
                    "label": str(value.get("label", identifier)),
                    **({"description": value["description"]} if "description" in value else {}),
                }
            )
        else:
            out.append({"id": str(value), "label": str(value)})
    return tuple(out)


def decisionbench_row_to_input(row: dict[str, Any], line_no: int) -> ScoreInput:
    """DecisionBench 행 → ScoreInput. 열 이름(instruction·state_json·candidates_json·gold_candidate_id)은
    ADR-034 9번의 설계 가정이다. 실행 전 라이선스 확인이 먼저다."""
    candidates = _suite_candidates(row["candidates_json"])
    ids = [c["id"] for c in candidates]
    gold_id = str(row["gold_candidate_id"])
    if gold_id not in ids:
        raise ScoreInputError(f"suite:{line_no}: gold_candidate_id 가 후보 밖")
    state_raw = row.get("state_json")
    state = json.loads(state_raw) if isinstance(state_raw, str) else state_raw
    decision_type = str(row.get("decision_type") or kev_wire.CHOICE)
    row_id = str(
        row.get("id") or hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
    )
    return ScoreInput(
        row_id=row_id,
        qid=f"suite:{decision_type}",
        question_type=decision_type
        if decision_type in DECISION_TYPE_BY_QUESTION_TYPE
        else kev_wire.CHOICE,
        cluster_id=str(row.get("cluster_id") or row_id),
        instructions=str(row["instruction"]),
        state=state,
        candidates=candidates,
        gold_id=gold_id,
        gold_probabilities=tuple(1.0 if c == gold_id else 0.0 for c in ids),
    )


def load_suite_inputs(path: Path, suite_format: str) -> list[ScoreInput]:
    if suite_format != SUITE_FORMAT_DECISIONBENCH:
        raise ScoreInputError(
            f"알 수 없는 suite 형식: {suite_format} (가능: {', '.join(SUITE_FORMATS)})"
        )
    inputs = [decisionbench_row_to_input(r, i) for i, r in enumerate(read_jsonl(path), start=1)]
    if not inputs:
        raise ScoreInputError(f"{path}: suite 행이 없다")
    return inputs


# ---------------------------------------------------------------- 채점


def _package_info(package_dir: Path | None) -> dict[str, Any]:
    if package_dir is None:
        return {"path": None, "manifestSha256": None, "weights": {}}
    manifest = package_dir / PACKAGE_MANIFEST
    return {
        "path": str(package_dir),
        "manifestSha256": sha256_file(manifest) if manifest.exists() else None,
        "weights": {
            name: sha256_file(package_dir / name)
            for name in PACKAGE_WEIGHT_FILES
            if (package_dir / name).exists()
        },
    }


def _environment(engine: Backend) -> dict[str, Any]:
    versions: dict[str, str | None] = {}
    for name in ENVIRONMENT_PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": versions,
        # 실제로 올린 device·dtype(BosunBackend). 모델이 없는 백엔드(fake 등)는 None 이다
        "device": getattr(engine, "device", None),
        "dtype": getattr(engine, "dtype", None),
    }


def scored_row(item: ScoreInput, probabilities: Sequence[float]) -> ScoredRow:
    return ScoredRow(
        row_id=item.row_id,
        qid=item.qid,
        question_type=item.question_type,
        cluster_id=item.cluster_id,
        candidate_ids=item.candidate_ids,
        gold_id=item.gold_id,
        gold_probabilities=item.gold_probabilities,
        probabilities=tuple(probabilities),
    )


def predict_all(
    inputs: Sequence[ScoreInput], backend: Backend, seeds: Sequence[int]
) -> dict[int, list[ScoredRow]]:
    rows_by_seed: dict[int, list[ScoredRow]] = {}
    for seed in seeds:
        rows: list[ScoredRow] = []
        for item in inputs:
            probabilities = backend.predict(
                state=item.state,
                instructions=item.instructions,
                candidates=item.candidates,
                decision_type=DECISION_TYPE_BY_QUESTION_TYPE.get(
                    item.question_type, item.question_type
                ),
                seed=seed,
                row_id=item.row_id,
            )
            if len(probabilities) != len(item.candidates):
                raise ScoreInputError(f"{item.row_id}: 백엔드 분포 길이가 후보 수와 다르다")
            rows.append(scored_row(item, probabilities))
        rows_by_seed[seed] = rows
    return rows_by_seed


def metrics_report(rows_by_seed: dict[int, list[ScoredRow]], primary_seed: int) -> dict[str, Any]:
    primary = rows_by_seed[primary_seed]
    return {
        "primarySeed": primary_seed,
        "overall": group_metrics(primary),
        "byFamily": {
            family: group_metrics(rows)
            for family, rows in group_by(primary, lambda r: qid_family(r.qid)).items()
        },
        "byQuestionType": {
            kind: group_metrics(rows)
            for kind, rows in group_by(primary, lambda r: r.question_type).items()
        },
        "bySeed": {str(seed): group_metrics(rows) for seed, rows in sorted(rows_by_seed.items())},
        "consistency": {
            "overall": consistency(rows_by_seed),
            "byFamily": {
                family: consistency(
                    {
                        seed: [r for r in rows if qid_family(r.qid) == family]
                        for seed, rows in rows_by_seed.items()
                    }
                )
                for family in sorted({qid_family(r.qid) for r in primary})
            },
        },
    }


def rows_summary(
    inputs: Sequence[ScoreInput], rows_by_seed: dict[int, list[ScoredRow]], primary_seed: int
) -> list[dict[str, Any]]:
    by_seed_row = {seed: {r.row_id: r for r in rows} for seed, rows in rows_by_seed.items()}
    summary: list[dict[str, Any]] = []
    for item in inputs:
        versions = {seed: by_seed_row[seed][item.row_id] for seed in sorted(by_seed_row)}
        primary = versions[primary_seed]
        summary.append(
            {
                "rowId": item.row_id,
                "qid": item.qid,
                "questionType": item.question_type,
                "clusterId": item.cluster_id,
                "candidateIds": list(item.candidate_ids),
                "gold": {
                    "candidateId": item.gold_id,
                    "probabilities": list(item.gold_probabilities),
                },
                "predicted": predicted_id(primary),
                "correct": predicted_id(primary) == item.gold_id,
                "confidence": round(max(primary.probabilities), 6),
                "probabilitiesBySeed": {
                    str(seed): [round(p, 6) for p in row.probabilities]
                    for seed, row in versions.items()
                },
                "argmaxStable": len({predicted_id(v) for v in versions.values()}) == 1,
            }
        )
    return summary


def write_outputs(
    out_dir: Path,
    inputs: Sequence[ScoreInput],
    rows_by_seed: dict[int, list[ScoredRow]],
    report: dict[str, Any],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / PREDICTIONS_FILE).open("w", encoding="utf-8") as handle:
        for seed, rows in sorted(rows_by_seed.items()):
            for row in rows:
                handle.write(
                    json.dumps(
                        {
                            "rowId": row.row_id,
                            "qid": row.qid,
                            "seed": seed,
                            "probabilities": [round(p, 8) for p in row.probabilities],
                            "argmax": predicted_id(row),
                        }
                    )
                    + "\n"
                )
    (out_dir / ROWS_FILE).write_text(
        json.dumps(rows_summary(inputs, rows_by_seed, report["metrics"]["primarySeed"]), indent=1)
        + "\n",
        encoding="utf-8",
    )
    (out_dir / REPORT_FILE).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@dataclass
class ScoreOptions:
    out_dir: Path
    data_path: Path
    seeds: Sequence[int]
    backend: str = BACKEND_BOSUN
    package_dir: Path | None = None
    suite_format: str | None = None
    primary_seed: int = PRIMARY_SEED
    device: str = DEVICE_AUTO
    dtype: str = DTYPE_AUTO


def make_backend(options: ScoreOptions) -> Backend:
    if options.backend == BACKEND_FAKE:
        return FakeBackend()
    if options.backend != BACKEND_BOSUN:
        raise ScoreInputError(f"알 수 없는 backend: {options.backend}")
    if options.package_dir is None or not options.package_dir.is_dir():
        raise ScoreInputError("--package <dir> 가 필요하다(backend bosun)")
    try:
        return BosunBackend(options.package_dir, device=options.device, dtype=options.dtype)
    except PackageVerificationError as error:
        raise ScoreInputError(f"--package 검증 실패: {error.summary}") from error


def score(options: ScoreOptions, backend: Backend | None = None) -> dict[str, Any]:
    if options.primary_seed not in options.seeds:
        raise ScoreInputError(f"기본 seed {options.primary_seed} 가 --seeds 에 없다")
    inputs = (
        load_suite_inputs(options.data_path, options.suite_format)
        if options.suite_format
        else load_bosun_inputs(options.data_path)
    )
    engine = backend or make_backend(options)
    rows_by_seed = predict_all(inputs, engine, options.seeds)
    report = {
        "schemaVersion": SCORE_REPORT_SCHEMA_VERSION,
        "createdAt": datetime.now(UTC).isoformat(),
        "backend": engine.name,
        "package": _package_info(options.package_dir),
        "data": {
            "path": str(options.data_path),
            "sha256": sha256_file(options.data_path),
            "rows": len(inputs),
            "clusters": len({i.cluster_id for i in inputs}),
            "suiteFormat": options.suite_format,
        },
        "seeds": list(options.seeds),
        "environment": _environment(engine),
        "metrics": metrics_report(rows_by_seed, options.primary_seed),
        "notes": [
            "smoke 6건은 성능 평가에 쓰지 않는다(ADR-034 7번)",
            "dev 분할만으로 일반 Decision 능력의 망각 여부를 평가하지 않는다(ADR-034 9번)",
        ],
    }
    write_outputs(options.out_dir, inputs, rows_by_seed, report)
    return report
