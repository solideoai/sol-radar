"""형식별 파서 어댑터 목록(03 §10.1). 형식마다 env `PARSER_<형식>` 으로 고르고, 비우면 기본 어댑터다.

이 모듈은 무거운 라이브러리를 import 하지 않는다. 어댑터 모듈은 격리 하위 프로세스(worker)에서만 읽는다.
parserId 는 결과·저장 경로에 남는 값이라 라이브러리·자체 파서 버전을 함께 적는다.
"""

import importlib
from dataclasses import dataclass
from importlib import metadata

# 자체 파서(HWPX·HWP) 해석 규칙을 바꾸면 올린다. parserId 가 바뀌어 재처리 대상이 된다
OWN_PARSER_VERSION = "1"


def _version(distribution: str) -> str:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return "unknown"


@dataclass(frozen=True)
class ParserSpec:
    adapter_id: str  # env PARSER_<형식> 에 쓰는 값
    format: str
    module: str
    library: str | None  # 버전을 parserId 에 적을 배포 패키지
    own: bool  # 해석 규칙을 이 저장소가 가진 파서인가

    @property
    def parser_id(self) -> str:
        """예: pdfplumber@0.11.10, sol-hwpx@1, sol-hwp5@1+olefile@0.47"""
        library = f"{self.library}@{_version(self.library)}" if self.library else None
        if not self.own:
            return library or self.adapter_id
        own = f"{self.adapter_id}@{OWN_PARSER_VERSION}"
        return f"{own}+{library}" if library else own

    def load(self):
        """어댑터의 extract(data, limits) -> Extracted. worker 안에서만 부른다."""
        return importlib.import_module(self.module).extract


PARSERS = (
    ParserSpec("pdfplumber", "PDF", "sol_ai.parsers.pdf", library="pdfplumber", own=False),
    ParserSpec("sol-hwpx", "HWPX", "sol_ai.parsers.hwpx", library=None, own=True),
    ParserSpec("sol-hwp5", "HWP", "sol_ai.parsers.hwp", library="olefile", own=True),
)
DEFAULTS = {spec.format: spec for spec in PARSERS}
BY_ID = {spec.adapter_id: spec for spec in PARSERS}


def select(fmt: str, configured: str | None) -> ParserSpec | None:
    """env 값으로 어댑터를 고른다. 비어 있으면 기본, 모르는 값이나 다른 형식의 어댑터면 None."""
    value = (configured or "").strip()
    if not value:
        return DEFAULTS.get(fmt)
    spec = BY_ID.get(value)
    return spec if spec is not None and spec.format == fmt else None
