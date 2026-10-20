import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDuration,
  formatKstClock,
  formatKstSeconds,
  shortRunId,
} from "./ingest-format";

// 수집 화면 서식(디자인 스펙 §3.4 시각·걸린 시간·건수·run id, §9 넘침). 시각은 늘 서울 기준이다(실행 환경 시간대와 무관).

const START = "2026-10-20T04:51:05.000Z"; // 서울 13:51:05

const after = (ms: number): string => new Date(Date.parse(START) + ms).toISOString();

describe("formatKstSeconds — 서랍 시각", () => {
  it("UTC 를 서울 시각 초까지 쓴다", () => {
    expect(formatKstSeconds("2026-10-20T05:03:05.000Z")).toBe("2026-10-20 14:03:05");
  });

  it("서울 자정을 넘기면 날짜가 바뀌고 시는 00 이다(24 가 아니다)", () => {
    expect(formatKstSeconds("2026-10-20T15:00:00.000Z")).toBe("2026-10-21 00:00:00");
  });

  it("연말 UTC 저녁은 서울 새해다", () => {
    expect(formatKstSeconds("2026-12-31T15:00:09.000Z")).toBe("2027-01-01 00:00:09");
  });

  it("오프셋이 붙은 ISO 도 서울로 맞춘다", () => {
    expect(formatKstSeconds("2026-10-20T14:03:05+09:00")).toBe("2026-10-20 14:03:05");
  });

  it("읽을 수 없는 시각은 — 이다", () => {
    expect(formatKstSeconds("not-a-date")).toBe("—");
  });
});

describe("formatKstClock — 상태 줄 시각", () => {
  it("서울 시:분이다", () => {
    expect(formatKstClock("2026-10-20T05:03:59.000Z")).toBe("14:03");
  });

  it("서울 자정은 00:00 이다", () => {
    expect(formatKstClock("2026-10-20T15:00:00.000Z")).toBe("00:00");
  });

  it("읽을 수 없는 시각은 — 이다", () => {
    expect(formatKstClock("")).toBe("—");
  });
});

describe("formatDuration — 걸린 시간", () => {
  it("끝나지 않았으면 null 이다(화면은 '실행 중')", () => {
    expect(formatDuration(START, null)).toBeNull();
  });

  it.each([
    [0, "0초"],
    [12_000, "12초"],
    [59_999, "59초"],
    [60_000, "1분"],
    [184_000, "3분 4초"],
    [3_599_000, "59분 59초"],
    [3_600_000, "1시간"],
    [3_720_000, "1시간 2분"],
    [3_725_000, "1시간 2분"],
    [7_200_000, "2시간"],
  ])("%i ms 는 %s 다", (ms, text) => {
    expect(formatDuration(START, after(ms))).toBe(text);
  });

  it("종료가 시작보다 앞이면 null 이다", () => {
    expect(formatDuration(START, after(-1_000))).toBeNull();
  });

  it("시각을 읽을 수 없으면 null 이다", () => {
    expect(formatDuration("bad", after(1_000))).toBeNull();
    expect(formatDuration(START, "bad")).toBeNull();
  });
});

describe("shortRunId", () => {
  it("run id 앞 8자리다", () => {
    expect(shortRunId("d5367aa6-1b2c-4d3e-8f90-0123456789ab")).toBe("d5367aa6");
  });
});

describe("formatCount — 건수(§3.4, §9)", () => {
  it("0 은 '0' 이다", () => {
    expect(formatCount(0)).toEqual({ text: "0", full: "0" });
  });

  it("100,000 미만은 천 단위 쉼표 전체 수다", () => {
    expect(formatCount(99_999)).toEqual({ text: "99,999", full: "99,999" });
  });

  it("100,000 부터 만 단위로 줄이고 full 에 전체 수를 둔다", () => {
    expect(formatCount(100_000)).toEqual({ text: "10만", full: "100,000" });
  });

  it("소수 첫째 자리까지 줄인다(12.3만)", () => {
    expect(formatCount(123_456)).toEqual({ text: "12.3만", full: "123,456" });
  });

  it("백만 단위도 72px 칸에 맞게 줄인다", () => {
    expect(formatCount(1_234_567)).toEqual({ text: "123.5만", full: "1,234,567" });
  });
});
