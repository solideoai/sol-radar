import { describe, expect, it } from "vitest";
import { barAxisOf, formatEokMan } from "./award-reference-copy";

// 참고 낙찰가 카드 금액·막대 축(계획 docs/plans/2026-11-02-award-reference-price.md Review Focus 5).

describe("formatEokMan", () => {
  it("억·만 단위로 적고 만 원 아래는 버린다", () => {
    expect(formatEokMan(685_366_091)).toBe("6억 8,536만");
    expect(formatEokMan(30_000_000)).toBe("3,000만");
    expect(formatEokMan(12_050_000_000)).toBe("120억 5,000만");
    expect(formatEokMan(100_000_000)).toBe("1억");
  });
});

describe("barAxisOf", () => {
  it("가운데 절반이 80~100% 안이면 축을 넓히지 않는다", () => {
    expect(barAxisOf({ q1: 0.861, q3: 0.927 })).toEqual({ min: 0.8, max: 1 });
  });

  it("벗어난 쪽만 5%p 여유를 두고 5% 눈금으로 넓힌다", () => {
    expect(barAxisOf({ q1: 0.72, q3: 0.95 })).toEqual({ min: 0.65, max: 1 });
    expect(barAxisOf({ q1: 0.85, q3: 1.02 })).toEqual({ min: 0.8, max: 1.1 });
  });
});
