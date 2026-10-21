import { describe, expect, it } from "vitest";
import { kstToday, parseApplyPeriod, parseKstDateTime } from "./dates";

describe("parseApplyPeriod", () => {
  it("YYYYMMDD ~ YYYYMMDD 를 날짜 둘로 읽는다", () => {
    expect(parseApplyPeriod("20261001 ~ 20261031")).toEqual({
      startOn: "2026-10-01",
      endOn: "2026-10-31",
    });
  });

  it("YYYY-MM-DD ~ YYYY-MM-DD 와 YYYY.MM.DD 도 읽는다", () => {
    expect(parseApplyPeriod("2026-10-01 ~ 2026-10-31")).toEqual({
      startOn: "2026-10-01",
      endOn: "2026-10-31",
    });
    expect(parseApplyPeriod("2026.10.01~2026.10.31")).toEqual({
      startOn: "2026-10-01",
      endOn: "2026-10-31",
    });
  });

  it("상시·빈 값·문자열이 아니면 둘 다 null 이다", () => {
    for (const raw of ["상시", "예산 소진시까지", "", null, undefined, 20261031]) {
      expect(parseApplyPeriod(raw)).toEqual({ startOn: null, endOn: null });
    }
  });

  it("한쪽만 있으면 그쪽만 남긴다", () => {
    expect(parseApplyPeriod("20261001 ~")).toEqual({ startOn: "2026-10-01", endOn: null });
    expect(parseApplyPeriod("~ 20261031")).toEqual({ startOn: null, endOn: "2026-10-31" });
  });

  it("달력에 없는 날은 null 이다", () => {
    expect(parseApplyPeriod("20261332 ~ 20260230")).toEqual({ startOn: null, endOn: null });
  });
});

describe("parseKstDateTime", () => {
  it("YYYYMMDDHHMMSS 를 KST 로 보고 UTC ISO 로 바꾼다", () => {
    expect(parseKstDateTime("20261021093000")).toBe("2026-10-21T00:30:00.000Z");
  });

  it("YYYY-MM-DD HH:MM:SS 와 날짜만도 읽는다", () => {
    expect(parseKstDateTime("2026-10-21 09:30:00")).toBe("2026-10-21T00:30:00.000Z");
    expect(parseKstDateTime("2026-10-21")).toBe("2026-10-20T15:00:00.000Z");
  });

  it("못 읽으면 null 이다", () => {
    for (const raw of ["abc", "20261321093000", "2026-10-21 25:00:00", "", null, 5]) {
      expect(parseKstDateTime(raw)).toBeNull();
    }
  });
});

describe("kstToday", () => {
  it("KST 날짜를 낸다(UTC 15시 뒤는 다음 날)", () => {
    expect(kstToday(new Date("2026-10-21T15:30:00Z"))).toBe("2026-10-22");
    expect(kstToday(new Date("2026-10-21T14:59:59Z"))).toBe("2026-10-21");
  });
});
