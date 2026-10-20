"""녹음 응답(sol-recorded/v0.1, web/server/ingestion/recorded-api.ts recordedResponseSchema 와 같은 형식) 읽기.

담당자 필드는 녹음 단계에서 마스킹돼 있다. 여기서는 공고 식별·구조화 필드만 꺼내고 담당자 필드는 읽지 않는다.
"""

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

RECORDED_SCHEMA_VERSION = "sol-recorded/v0.1"
RESPONSE_ENVELOPE = "response"
OP_LIST = "getBidPblancListInfoServc"
OP_LICENSE = "getBidPblancListInfoLicenseLimit"
OP_REGION = "getBidPblancListInfoPrtcptPsblRgn"
OP_EORDER = "getBidPblancListInfoEorderAtchFileInfo"
OP_INDUSTRY = "getIndstrytyBaseLawrgltInfoList"
NOTICE_KEY = ("bidNtceNo", "bidNtceOrd")


class RecordedFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Recorded:
    path: Path
    schema_version: str
    registry_key: str
    operation: str
    fetched_at: str
    envelope: str
    result_code: str
    items: list[dict[str, Any]]
    raw_sha256: str


def load_recorded(path: Path) -> Recorded:
    data = json.loads(path.read_text(encoding="utf-8"))
    required = (
        "schemaVersion",
        "registryKey",
        "operation",
        "params",
        "fetchedAt",
        "envelope",
        "resultCode",
        "items",
        "masked",
        "rawSha256",
    )
    missing = [k for k in required if k not in data]
    if missing:
        raise RecordedFormatError(f"{path.name}: 녹음 필드가 없다 {missing}")
    if data["schemaVersion"] != RECORDED_SCHEMA_VERSION:
        raise RecordedFormatError(
            f"{path.name}: schemaVersion 이 {RECORDED_SCHEMA_VERSION} 이 아니다"
        )
    if data["masked"] is not True:
        raise RecordedFormatError(f"{path.name}: masked 가 true 가 아니다")
    if any(k.lower() == "servicekey" for k in data["params"]):
        raise RecordedFormatError(f"{path.name}: params 에 서비스키 파라미터가 있다")
    return Recorded(
        path=path,
        schema_version=data["schemaVersion"],
        registry_key=data["registryKey"],
        operation=data["operation"],
        fetched_at=data["fetchedAt"],
        envelope=data["envelope"],
        result_code=str(data["resultCode"]),
        items=list(data["items"]),
        raw_sha256=data["rawSha256"],
    )


def load_recorded_dir(directory: Path) -> list[Recorded]:
    if not directory.is_dir():
        raise RecordedFormatError(f"녹음 폴더가 없다: {directory}")
    return [load_recorded(p) for p in sorted(directory.rglob("*.masked.json"))]


def notice_key(row: dict[str, Any]) -> tuple[str, str]:
    return str(row.get("bidNtceNo", "")), str(row.get("bidNtceOrd", "000") or "000")


@dataclass
class NoticeRecord:
    key: tuple[str, str]
    row: dict[str, Any]
    registry_key: str
    fetched_at: str
    license_rows: list[dict[str, Any]] = field(default_factory=list)
    license_fetched_at: str | None = None
    region_rows: list[dict[str, Any]] = field(default_factory=list)
    region_fetched_at: str | None = None
    eorder_rows: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class RecordedBundle:
    notices: dict[tuple[str, str], NoticeRecord]
    files: list[Recorded]
    counts: dict[str, int]

    @property
    def masking_version(self) -> str:
        return RECORDED_SCHEMA_VERSION


def join_recordings(recordings: list[Recorded]) -> RecordedBundle:
    """목록 응답의 공고마다 면허제한·참가지역·e발주 행을 붙인다. 같은 (공고번호, 차수)는 먼저 읽은 것을 쓴다."""
    notices: dict[tuple[str, str], NoticeRecord] = {}
    sub: dict[str, dict[tuple[str, str], list[dict[str, Any]]]] = {
        OP_LICENSE: defaultdict(list),
        OP_REGION: defaultdict(list),
        OP_EORDER: defaultdict(list),
    }
    sub_fetched: dict[str, dict[tuple[str, str], str]] = {OP_LICENSE: {}, OP_REGION: {}}
    counts = {"files": len(recordings), "errorEnvelopes": 0, "duplicateNotices": 0}
    seen_rows: dict[str, set[tuple]] = defaultdict(set)
    for recorded in recordings:
        if recorded.envelope != RESPONSE_ENVELOPE or recorded.result_code != "00":
            counts["errorEnvelopes"] += 1
            continue
        if recorded.operation == OP_LIST:
            for row in recorded.items:
                key = notice_key(row)
                if key in notices:
                    counts["duplicateNotices"] += 1
                    continue
                notices[key] = NoticeRecord(key, row, recorded.registry_key, recorded.fetched_at)
        elif recorded.operation in sub:
            for row in recorded.items:
                key = notice_key(row)
                identity = (key, json.dumps(row, sort_keys=True, ensure_ascii=False))
                if identity in seen_rows[recorded.operation]:
                    continue
                seen_rows[recorded.operation].add(identity)
                sub[recorded.operation][key].append(row)
                if recorded.operation in sub_fetched:
                    sub_fetched[recorded.operation].setdefault(key, recorded.fetched_at)
    for key, notice in notices.items():
        notice.license_rows = sorted(
            sub[OP_LICENSE].get(key, []),
            key=lambda r: (int(r.get("lmtGrpNo") or 0), int(r.get("lmtSno") or 0)),
        )
        notice.license_fetched_at = sub_fetched[OP_LICENSE].get(key)
        notice.region_rows = sorted(
            sub[OP_REGION].get(key, []), key=lambda r: int(r.get("lmtSno") or 0)
        )
        notice.region_fetched_at = sub_fetched[OP_REGION].get(key)
        notice.eorder_rows = sub[OP_EORDER].get(key, [])
    counts["notices"] = len(notices)
    counts["noticesWithLicenseRows"] = sum(1 for n in notices.values() if n.license_rows)
    counts["noticesWithRegionRows"] = sum(1 for n in notices.values() if n.region_rows)
    counts["noticesWithEorderRows"] = sum(1 for n in notices.values() if n.eorder_rows)
    return RecordedBundle(notices, recordings, counts)


def load_industry_master(directory: Path) -> dict[str, str]:
    """업종 마스터(15129467) 코드 → 업종명. 폴더가 없으면 빈 사전(코드 확인 불가로 센다)."""
    codes: dict[str, str] = {}
    if not directory.is_dir():
        return codes
    for recorded in load_recorded_dir(directory):
        if recorded.operation != OP_INDUSTRY:
            continue
        for row in recorded.items:
            code = str(row.get("indstrytyCd", ""))
            if code:
                codes.setdefault(code, str(row.get("indstrytyNm", "")))
    return codes
