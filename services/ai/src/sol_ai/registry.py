"""모델 레지스트리(services/ai/models/registry.yaml, docs/03 §11, ADR-034 6번). 값을 모르는 항목은 null 이다.

- kind: decision(결정 모델. 옛 kev 는 읽기 호환)·qwen. 그 밖의 값은 기동을 거부한다.
- status: active(기본)·retired·backup. KEV_MODEL_ID·QWEN_MODEL 로 고를 수 있는 항목은 active 뿐이다. retired·backup 은
  이력·롤백용이라 읽되 기동 대조 대상에서 뺀다(local_setup 이 상태 이름을 거부 사유로 쓴다).
- qwen 기본 항목은 active 이고 default: true 인 항목 하나다. 둘 이상이면 기동을 거부한다.
- 결정 모델 서버 GET /v1/models 대조(RegistryEntry.matches): run 이 같고, base·lora·temperature 중 레지스트리 값이 null
  이 아닌 것이 모두 같아야 한다(lora 는 어댑터 sha256 문자열). revision 은 서버 응답에 그 키가 있고 레지스트리 값도 null
  이 아닐 때만 함께 대조한다(회사 운영 값을 모르면 null 로 두므로 강제하지 않는다).

allowedHosts(C5-A S2, e8 확정 2026-10-19): local 모델 서버 URL 이 가리킬 수 있는 호스트(루프백 밖). 실제로 쓸
호스트와 글자 그대로 같아야 한다. 목록이 아니거나 비었거나 소문자 호스트 문자열이 아닌 항목이 있으면 기동을 거부한다.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

from sol_ai.errors import StartupRefused

KIND_KEV = "kev"
KIND_DECISION = "decision"
KIND_QWEN = "qwen"
# KEV_MODEL_ID 로 고르는 결정 모델 종류(옛 이름 kev 는 읽기 호환)
DECISION_KINDS = frozenset({KIND_KEV, KIND_DECISION})
KINDS = DECISION_KINDS | {KIND_QWEN}

STATUS_ACTIVE = "active"
STATUS_RETIRED = "retired"
STATUS_BACKUP = "backup"
STATUSES = frozenset({STATUS_ACTIVE, STATUS_RETIRED, STATUS_BACKUP})

# 03 §11: 결정 모델 서버 GET /v1/models 와 대조하는 필드. 레지스트리 값이 null 이면 대조하지 않는다
KEV_MATCH_FIELDS = ("base", "lora", "temperature")
# 서버 응답에 키가 있을 때만 대조하는 필드
REVISION_FIELD = "revision"


@dataclass(frozen=True)
class RegistryEntry:
    id: str
    kind: str
    run: str
    match_values: dict[str, object]
    question_set: str | None
    request_model: str | None
    default: bool
    status: str = STATUS_ACTIVE
    revision: str | None = None
    base_revision: str | None = None
    decision_embeddings_sha256: str | None = None

    @property
    def active(self) -> bool:
        return self.status == STATUS_ACTIVE

    def matches(self, model: object) -> bool:
        """결정 모델 서버 /v1/models 의 모델 객체 하나가 이 항목과 같은가(모듈 머리말의 대조 규칙)."""
        if not isinstance(model, dict) or model.get("run") != self.run:
            return False
        if any(model.get(field) != value for field, value in self.match_values.items()):
            return False
        if self.revision is not None and REVISION_FIELD in model:
            return model[REVISION_FIELD] == self.revision
        return True


class RegistryError(StartupRefused):
    """레지스트리 파일 위반. summary 는 "MODEL_REGISTRY(사유)" 뿐이다(경로·값을 담지 않는다)."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"MODEL_REGISTRY({reason})")


def _allowed_hosts(value: object) -> frozenset[str]:
    """문자열 목록이고 비지 않았으며, 항목마다 앞뒤 공백 없는 소문자 문자열이어야 한다."""
    if not isinstance(value, list) or not value:
        raise RegistryError("ALLOWED_HOSTS_INVALID")
    if not all(isinstance(h, str) and h and h == h.strip().lower() for h in value):
        raise RegistryError("ALLOWED_HOSTS_INVALID")
    return frozenset(value)


def _optional_str(entry: dict, field: str) -> str | None:
    """null 이거나 문자열인 선택 필드. 다른 타입이면 FIELD_INVALID."""
    value = entry.get(field)
    if value is not None and not isinstance(value, str):
        raise RegistryError("FIELD_INVALID")
    return value


def _entry(data: object) -> RegistryEntry:
    if not isinstance(data, dict):
        raise RegistryError("ENTRY_INVALID")
    entry_id, kind, run = data.get("id"), data.get("kind"), data.get("run")
    if not all(isinstance(v, str) and v for v in (entry_id, kind, run)):
        raise RegistryError("ENTRY_INVALID")
    if kind not in KINDS:
        raise RegistryError("KIND_INVALID")
    status = data.get("status", STATUS_ACTIVE)
    if status not in STATUSES:
        raise RegistryError("STATUS_INVALID")
    return RegistryEntry(
        id=entry_id,
        kind=kind,
        run=run,
        match_values={f: data.get(f) for f in KEV_MATCH_FIELDS if data.get(f) is not None},
        question_set=_optional_str(data, "questionSet"),
        request_model=_optional_str(data, "requestModel"),
        default=bool(data.get("default", False)),
        status=status,
        revision=_optional_str(data, REVISION_FIELD),
        base_revision=_optional_str(data, "base_revision"),
        decision_embeddings_sha256=_optional_str(data, "decision_embeddings_sha256"),
    )


@dataclass(frozen=True)
class ModelRegistry:
    entries: tuple[RegistryEntry, ...]
    allowed_hosts: frozenset[str]

    @classmethod
    def load(cls, path: Path) -> "ModelRegistry":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
            raise RegistryError("INVALID_FILE")
        allowed_hosts = _allowed_hosts(data.get("allowedHosts"))
        entries = tuple(_entry(e) for e in data["entries"])
        if len({e.id for e in entries}) != len(entries):
            raise RegistryError("DUPLICATE_ID")
        defaults = [e for e in entries if e.kind == KIND_QWEN and e.active and e.default]
        if len(defaults) > 1:
            raise RegistryError("QWEN_DEFAULT_AMBIGUOUS")
        return cls(entries, allowed_hosts)

    def decision(self, entry_id: str) -> RegistryEntry | None:
        """KEV_MODEL_ID 항목. 상태와 무관하게 찾는다(호출자가 active 가 아니면 상태 이름으로 거부한다)."""
        return next(
            (e for e in self.entries if e.kind in DECISION_KINDS and e.id == entry_id), None
        )

    def qwen_entry(self, run: str) -> RegistryEntry | None:
        """run 이 같은 qwen 항목. 상태와 무관하게 찾는다."""
        return next((e for e in self.entries if e.kind == KIND_QWEN and e.run == run), None)

    def qwen_runs(self) -> set[str]:
        """고를 수 있는(active) qwen run 집합."""
        return {e.run for e in self.entries if e.kind == KIND_QWEN and e.active}

    def qwen_default(self) -> RegistryEntry | None:
        return next(
            (e for e in self.entries if e.kind == KIND_QWEN and e.active and e.default), None
        )
