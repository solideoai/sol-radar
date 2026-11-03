import { describe, expect, it } from "vitest";
import { insightProgress } from "@/components/bids/insight-progress";

// 추천 분석 진행률(ADR-078, 디자인 스펙 7.2). 걸린 시간을 예상 시간(3분 대기 상한)에 견준 어림값이다.
const T = 3 * 60 * 1000;

describe("insightProgress", () => {
  it("0 에서 시작하고 예상 시간의 절반이면 50 이다", () => {
    expect(insightProgress(0, T)).toBe(0);
    expect(insightProgress(T / 2, T)).toBe(50);
  });

  it("시간이 지나도 줄지 않고, 예상 시간을 넘어도 99 를 넘지 않는다", () => {
    const steps = Array.from({ length: 400 }, (_, index) => insightProgress(index * 1_000, T));
    steps.forEach((value, index) => {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeLessThanOrEqual(99);
      if (index > 0) expect(value).toBeGreaterThanOrEqual(steps[index - 1]!);
    });
    expect(insightProgress(T, T)).toBe(99);
    expect(insightProgress(T * 10, T)).toBe(99);
  });

  it("음수 경과(클라이언트·서버 시계 차)는 0 이다", () => {
    expect(insightProgress(-5_000, T)).toBe(0);
  });
});
