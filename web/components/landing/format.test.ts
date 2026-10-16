import { describe, expect, it } from "vitest";
import { formatDate, formatWon } from "@/components/landing/format";

describe("formatWon", () => {
  it.each([
    [1_450_000_000, "14억 5,000만 원"],
    [880_000_000, "8억 8,000만 원"],
    [2_300_000_000, "23억 원"],
    [35_000_000, "3,500만 원"],
    [5_000, "5,000원"],
  ])("%i원은 %s", (won, expected) => {
    expect(formatWon(won)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("YYYY-MM-DD 를 앞자리 0 없이 점으로 잇는다", () => {
    expect(formatDate("2026-11-05")).toBe("2026. 11. 5.");
  });
});
