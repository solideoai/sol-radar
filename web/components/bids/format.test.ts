import { describe, expect, it } from "vitest";
import {
  dDay,
  formatKrwCompact,
  formatKrwFull,
  fitOutOfFive,
  formatKst,
  formatKstDate,
  formatKstShort,
  formatPercent,
  formatPoints,
  formatRelative,
  formatSignal,
} from "./format";

const now = new Date("2026-10-16T00:00:00Z");

describe("금액", () => {
  it("전체 금액", () => {
    expect(formatKrwFull("1200000000")).toBe("1,200,000,000원");
    expect(formatKrwFull(null)).toBe("—");
  });
  it("압축 금액과 전체 금액", () => {
    expect(formatKrwCompact("1200000000")).toEqual({
      text: "12억",
      full: "1,200,000,000원",
    });
    expect(formatKrwCompact("2160000000").text).toBe("21.6억");
    expect(formatKrwCompact(null)).toEqual({ text: "—", full: "미공개" });
  });
});

describe("마감", () => {
  it("D-n 은 서울 날짜끼리 뺀다", () => {
    expect(dDay("2026-11-06T09:00:00Z", now)).toEqual({ label: "D-21", past: false });
  });
  it("자정 경계: UTC 로는 같은 날이어도 서울 날짜로 센다", () => {
    expect(dDay("2026-10-16T16:00:00Z", new Date("2026-10-16T14:00:00Z"))?.label).toBe("D-1");
  });
  it("당일은 D-Day, 지난 마감은 마감", () => {
    expect(dDay("2026-10-16T09:00:00Z", now)).toEqual({ label: "D-Day", past: false });
    expect(dDay("2026-10-15T09:00:00Z", now)).toEqual({ label: "마감", past: true });
  });
  it("null 이면 null", () => {
    expect(dDay(null, now)).toBeNull();
  });
});

describe("시각", () => {
  it("KST 로 보인다", () => {
    expect(formatKst("2026-11-06T09:00:00Z")).toBe("2026-11-06 18:00");
  });
  it("날짜만 쓰는 값은 서울 날짜다", () => {
    expect(formatKstDate("2026-11-06T09:00:00Z")).toBe("2026-11-06");
    expect(formatKstDate("2026-11-06T16:00:00Z")).toBe("2026-11-07");
    expect(formatKstDate("nope")).toBe("—");
  });
  it("표 칸용 짧은 날짜는 서울 날짜다", () => {
    expect(formatKstShort("2026-11-06T09:00:00Z")).toBe("11. 6.");
    expect(formatKstShort("2026-11-06T16:00:00Z")).toBe("11. 7.");
    expect(formatKstShort("nope")).toBe("—");
  });
  it("상대 시각", () => {
    expect(formatRelative("2026-10-16T00:00:00Z", new Date("2026-10-16T00:12:00Z"))).toBe(
      "12분 전",
    );
    expect(formatRelative("2026-10-16T00:00:00Z", new Date("2026-10-16T00:00:20Z"))).toBe(
      "방금 전",
    );
    expect(formatRelative("2026-10-16T00:00:00Z", new Date("2026-10-16T03:00:00Z"))).toBe(
      "3시간 전",
    );
    expect(formatRelative("2026-10-10T00:00:00Z", now)).toBe("6일 전");
    expect(formatRelative("2026-08-01T00:00:00Z", now)).toBe("2026-08-01 09:00");
  });
});

describe("숫자", () => {
  it("점수·퍼센트·신호", () => {
    expect(formatPoints(24)).toBe("24.0");
    expect(formatPoints(18.3)).toBe("18.3");
    expect(formatPercent(0.71)).toBe("71%");
    expect(formatSignal(0.85)).toBe("0.85");
  });
  it("잘못된 입력에도 NaN·Invalid 를 내지 않는다", () => {
    const out = [
      formatKrwFull("abc"),
      formatKrwCompact("abc").text,
      formatKst("not-a-date"),
      formatRelative("not-a-date", now),
      formatPoints(Number.NaN),
      formatPercent(Number.NaN),
      formatSignal(Number.NaN),
      dDay("not-a-date", now)?.label ?? "",
    ].join("|");
    expect(out).not.toMatch(/NaN|Invalid/);
  });
});

describe("Kev 적합도 n/5", () => {
  it("경계를 floor+1 로 바꾸고 1~5 로 자른다", () => {
    expect(fitOutOfFive(0)).toBe(1);
    expect(fitOutOfFive(3.5)).toBe(4);
    expect(fitOutOfFive(4)).toBe(5);
    expect(fitOutOfFive(4.9)).toBe(5);
    expect(fitOutOfFive(-1)).toBe(1);
    expect(fitOutOfFive(9)).toBe(5);
  });
});
