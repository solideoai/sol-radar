import { describe, expect, it } from "vitest";
import { reviewInputSchema } from "./review-input";

describe("reviewInputSchema", () => {
  it("10자 이상 사유는 통과한다", () => {
    expect(
      reviewInputSchema.safeParse({ decision: "BID", reason: "자격 요건을 모두 충족함" }).success,
    ).toBe(true);
  });
  it("짧은 사유는 거절한다", () => {
    expect(reviewInputSchema.safeParse({ decision: "BID", reason: "짧음" }).success).toBe(false);
  });
  it("공백만 있는 사유는 거절한다", () => {
    expect(reviewInputSchema.safeParse({ decision: "BID", reason: "          " }).success).toBe(
      false,
    );
  });
  it("2000자 초과는 거절하고 2000자는 통과한다", () => {
    expect(
      reviewInputSchema.safeParse({ decision: "WATCH", reason: "가".repeat(2000) }).success,
    ).toBe(true);
    expect(
      reviewInputSchema.safeParse({ decision: "WATCH", reason: "가".repeat(2001) }).success,
    ).toBe(false);
  });
  it("알 수 없는 결정은 거절한다", () => {
    expect(
      reviewInputSchema.safeParse({ decision: "MAYBE", reason: "충분히 긴 사유입니다 ok" }).success,
    ).toBe(false);
  });
});
