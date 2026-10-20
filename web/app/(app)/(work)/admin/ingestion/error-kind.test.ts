import { describe, expect, it } from "vitest";
import {
  CONNECTOR_FAILURE_KINDS,
  QUARANTINE_CODES,
  SEED_ANCHOR_MISSING,
  WARNING_CODES,
  ingestErrorCodeOf,
} from "@/server/ingestion";
import {
  QUARANTINE_ERROR_CODES,
  WARNING_ERROR_CODES,
  errorCodeLabel,
  errorKindOf,
  groupErrorsByKind,
  primaryFailureOf,
  type IngestRunError,
} from "./error-kind";

// 수집 오류 코드 → 서랍 무리(N8 구현 계획 §4 D5, 디자인 스펙 §4.7 오류 무리·코드 라벨, §4.3 실패 줄).
// 화면 표는 서버 코드 목록을 손으로 옮긴 것이라, 서버 목록을 기준으로 돌려 서버에 코드가 더해지면 빨개지게 한다.

const err = (errorCode: string, sourceKey = "fixture:DEMO-2026-0012"): IngestRunError => ({
  sourceKey,
  errorCode,
  resultCode: null,
  detail: `${errorCode} 상세`,
});

describe("errorKindOf — 서버 코드 목록을 모두 덮는다", () => {
  it.each(QUARANTINE_CODES)("서버 격리 코드 %s 는 QUARANTINE 이다", (code) => {
    expect(errorKindOf(code)).toBe("QUARANTINE");
  });

  it.each(WARNING_CODES)("서버 경고 코드 %s 는 WARNING 이다", (code) => {
    expect(errorKindOf(code)).toBe("WARNING");
  });

  it("화면의 격리 코드 표는 서버 QUARANTINE_CODES 와 같은 집합이다", () => {
    expect(new Set(QUARANTINE_ERROR_CODES)).toEqual(new Set(QUARANTINE_CODES));
  });

  it("화면의 경고 코드 표는 서버 WARNING_CODES 와 같은 집합이다", () => {
    expect(new Set(WARNING_ERROR_CODES)).toEqual(new Set(WARNING_CODES));
  });
});

describe("errorKindOf — 중단·기타", () => {
  it.each(["RUN_MODE_MISMATCH", "WINDOW_INVALID", "SEED_ANCHOR_MISSING", "RATE_LIMITED"])(
    "중단 코드 %s 는 FAILURE 다",
    (code) => {
      expect(errorKindOf(code)).toBe("FAILURE");
    },
  );

  it("수집 서비스의 SEED_ANCHOR_MISSING 상수도 FAILURE 다", () => {
    expect(errorKindOf(SEED_ANCHOR_MISSING)).toBe("FAILURE");
  });

  it.each([
    "API_HTTP_ERROR",
    "API_RESULT_CODE",
    "API_QUOTA_EXCEEDED",
    "API_TIMEOUT",
    "API_SERVICE_KEY_INVALID",
    "API_SOMETHING_NEW",
  ])("API_ 접두어 코드 %s 는 FAILURE 다", (code) => {
    expect(errorKindOf(code)).toBe("FAILURE");
  });

  it.each(["INGEST_UNKNOWN", "RETRY_WAIT", "", "api_http_error", "XAPI_HTTP_ERROR"])(
    "표에 없는 코드 %j 는 OTHER 다",
    (code) => {
      expect(errorKindOf(code)).toBe("OTHER");
    },
  );
});

describe("errorCodeLabel — §4.7 코드 라벨", () => {
  it.each([
    ["MISSING_REQUIRED_FIELD", "필수 필드 누락"],
    ["SCHEMA_INVALID", "형식 오류"],
    ["BUDGET_UNPARSED", "예산을 읽지 못함"],
    ["DATE_UNPARSED", "날짜를 읽지 못함"],
    ["DATE_ORDER", "날짜 순서 이상"],
    ["ENCODING_DEGRADED", "글자 깨짐"],
    ["API_SERVICE_KEY_INVALID", "공공 API 서비스키 거부 (키 값은 보이지 않습니다)"],
    ["RATE_LIMITED", "요청 제한(429)이 계속되어 중단"],
    ["SEED_ANCHOR_MISSING", "SEED 수집 기록이 없어 LIVE 배치를 시작할 수 없음"],
  ])("%s 의 라벨은 %s 다", (code, label) => {
    expect(errorCodeLabel(code)).toBe(label);
  });

  it.each(["API_HTTP_ERROR", "API_RESULT_CODE", "API_QUOTA_EXCEEDED", "API_TIMEOUT"])(
    "%s 는 19 §5 문구 앞부분 '공공 API 오류:' 이다",
    (code) => {
      expect(errorCodeLabel(code)).toBe("공공 API 오류:");
    },
  );

  it("모르는 코드는 '수집 오류' 다", () => {
    expect(errorCodeLabel("INGEST_UNKNOWN")).toBe("수집 오류");
  });

  it.each([...QUARANTINE_CODES, ...WARNING_CODES])(
    "서버 격리·경고 코드 %s 는 전용 라벨이 있다('수집 오류'로 떨어지지 않는다)",
    (code) => {
      expect(errorCodeLabel(code)).not.toBe("수집 오류");
    },
  );
});

describe("groupErrorsByKind", () => {
  it("errors 를 네 무리로 나누고 무리 안의 순서는 서버 순서 그대로다", () => {
    const errors = [
      err("DATE_UNPARSED", "fixture:A"),
      err("MISSING_REQUIRED_FIELD", "fixture:B"),
      err("API_TIMEOUT", "g2b:page:start"),
      err("SCHEMA_INVALID", "fixture:C"),
      err("INGEST_UNKNOWN", "fixture:D"),
      err("BUDGET_UNPARSED", "fixture:E"),
    ];
    const groups = groupErrorsByKind(errors);
    expect(groups.FAILURE.map((e) => e.sourceKey)).toEqual(["g2b:page:start"]);
    expect(groups.QUARANTINE.map((e) => e.sourceKey)).toEqual(["fixture:B", "fixture:C"]);
    expect(groups.WARNING.map((e) => e.sourceKey)).toEqual(["fixture:A", "fixture:E"]);
    expect(groups.OTHER.map((e) => e.sourceKey)).toEqual(["fixture:D"]);
  });

  it("빈 목록이면 네 무리 모두 비어 있다", () => {
    expect(groupErrorsByKind([])).toEqual({ FAILURE: [], QUARANTINE: [], WARNING: [], OTHER: [] });
  });
});

describe("primaryFailureOf — 실패 run 의 대표 원인(§4.3)", () => {
  it("중단 코드가 기타 코드보다 뒤에 있어도 중단 코드를 고른다", () => {
    const failure = err("API_QUOTA_EXCEEDED", "g2b:page:3");
    expect(primaryFailureOf([err("INGEST_UNKNOWN"), err("MISSING_REQUIRED_FIELD"), failure])).toBe(
      failure,
    );
  });

  it("중단 코드가 여럿이면 서버 순서의 첫 줄이다", () => {
    const first = err("RATE_LIMITED", "fixture:page:2");
    expect(primaryFailureOf([first, err("API_TIMEOUT", "fixture:page:3")])).toBe(first);
  });

  it("중단 코드가 없으면 기타 코드의 첫 줄이다", () => {
    const other = err("INGEST_UNKNOWN");
    expect(primaryFailureOf([err("DATE_ORDER"), other])).toBe(other);
  });

  it("격리·경고만 있으면 고르지 않는다(null)", () => {
    expect(primaryFailureOf([err("MISSING_REQUIRED_FIELD"), err("ENCODING_DEGRADED")])).toBeNull();
  });

  it("오류가 없으면 null 이다", () => {
    expect(primaryFailureOf([])).toBeNull();
  });

  // ingestion.service failRun 은 connector 실패를 ingestErrorCodeOf(failure) 로 남기고 run 을 FAILED 로 끝낸다.
  // 그 코드는 run 을 멈춘 원인이라 상태 줄 "수집이 실패했습니다 · {라벨} {코드}"에 나와야 한다.
  it.each(CONNECTOR_FAILURE_KINDS)(
    "connector 실패 %s 로 멈춘 run 의 유일한 오류는 대표 원인으로 고른다",
    (kind) => {
      const stop = err(ingestErrorCodeOf({ kind, detail: "page 실패" }), "fixture:page:start");
      expect(primaryFailureOf([stop])).toBe(stop);
    },
  );
});
