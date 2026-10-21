import { describe, expect, it } from "vitest";
import { deadlineOf, kstDate, periodText } from "./program-format";

const TODAY = "2026-10-21";

describe("kstDate", () => {
  it("ISO 시각을 서울 날짜(YYYY-MM-DD)로 바꾼다", () => {
    expect(kstDate("2026-10-20T03:00:00Z")).toBe("2026-10-20");
    expect(kstDate("2026-10-20T12:00:00+09:00")).toBe("2026-10-20");
  });

  it("UTC 15시(서울 자정) 경계에서 서울 날짜로 넘어간다", () => {
    expect(kstDate("2026-10-21T14:59:59Z")).toBe("2026-10-21");
    expect(kstDate("2026-10-21T15:00:00Z")).toBe("2026-10-22");
    expect(kstDate("2026-10-21T15:30:00Z")).toBe("2026-10-22");
  });

  it("값이 없거나 시각이 아니면 —", () => {
    expect(kstDate(null)).toBe("—");
    expect(kstDate("상시")).toBe("—");
  });
});

describe("deadlineOf", () => {
  it("마감이 오늘 뒤면 D-n 과 짧은 날짜, 화면 낭독 글자를 준다", () => {
    expect(deadlineOf("2026-10-31", TODAY)).toEqual({
      label: "D-10",
      past: false,
      srText: "10일 남음",
      short: "10. 31.",
    });
  });

  it("마감이 오늘이면 하루 내내 D-Day 다(목록 거르기와 같은 서울 날짜 비교)", () => {
    expect(deadlineOf("2026-10-21", TODAY)).toEqual({
      label: "D-Day",
      past: false,
      srText: "오늘 마감",
      short: "10. 21.",
    });
  });

  it("마감이 지났으면 마감", () => {
    expect(deadlineOf("2026-09-30", TODAY)).toEqual({
      label: "마감",
      past: true,
      srText: "마감 지남",
      short: "9. 30.",
    });
  });

  it("해를 넘겨도 날짜 차이로 센다", () => {
    expect(deadlineOf("2027-01-05", "2026-12-30")?.label).toBe("D-6");
  });

  it("마감이 없거나 날짜 모양이 아니면 null(기간 미표기)", () => {
    expect(deadlineOf(null, TODAY)).toBeNull();
    expect(deadlineOf("상시", TODAY)).toBeNull();
    expect(deadlineOf("2026-13-01", TODAY)).toBeNull();
  });
});

describe("periodText", () => {
  it("시작과 마감이 있으면 기간 뒤에 D-n", () => {
    expect(periodText("2026-10-01", "2026-10-31", TODAY)).toBe("2026-10-01 ~ 2026-10-31 (D-10)");
    expect(periodText("2026-10-01", "2026-10-21", TODAY)).toBe("2026-10-01 ~ 2026-10-21 (D-Day)");
    expect(periodText("2026-09-01", "2026-09-30", TODAY)).toBe("2026-09-01 ~ 2026-09-30 (마감)");
  });

  it("시작이 없으면 마감만", () => {
    expect(periodText(null, "2026-10-31", TODAY)).toBe("~ 2026-10-31 (D-10)");
  });

  it("마감이 없으면 시작 ~ 미표기, 둘 다 없으면 기간 미표기", () => {
    expect(periodText("2026-10-01", null, TODAY)).toBe("2026-10-01 ~ 미표기");
    expect(periodText(null, null, TODAY)).toBe("기간 미표기");
  });
});
