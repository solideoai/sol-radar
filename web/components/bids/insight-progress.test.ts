import { describe, expect, it } from "vitest";
import {
  INSIGHT_EXPECTED_MS as T,
  INSIGHT_FILL_MAX_MS,
  insightFillMs,
  insightFillValue,
  insightProgress,
} from "@/components/bids/insight-progress";

// 추천 분석 진행률(ADR-078, 디자인 스펙 7.2). 예상 시간 T 까지 90 으로 고르게 오르고, 대기 상한까지 99 를 향해 천천히 오른다.
const LIMIT = 3 * 60 * 1000;

describe("insightProgress", () => {
  it("예상 시간까지 고르게 오른다: 0 에서 시작해 절반이면 45, 예상 시간이면 90", () => {
    expect(insightProgress(0, T, LIMIT)).toBe(0);
    expect(insightProgress(T / 2, T, LIMIT)).toBe(45);
    expect(insightProgress(T, T, LIMIT)).toBe(90);
    // 1초에 9씩 오른다.
    const perSecond = Array.from({ length: 10 }, (_, s) =>
      insightProgress((s + 1) * 1_000, T, LIMIT),
    );
    expect(perSecond).toEqual([9, 18, 27, 36, 45, 54, 63, 72, 81, 90]);
  });

  it("예상 시간 뒤로는 줄지 않고 천천히 올라 대기 상한에서 99 에 닿고, 넘지 않는다", () => {
    const steps = Array.from({ length: 400 }, (_, index) => insightProgress(index * 500, T, LIMIT));
    steps.forEach((value, index) => {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeLessThanOrEqual(99);
      if (index > 0) expect(value).toBeGreaterThanOrEqual(steps[index - 1]!);
    });
    expect(insightProgress(T + 60_000, T, LIMIT)).toBeLessThan(99);
    expect(insightProgress(LIMIT, T, LIMIT)).toBe(99);
    expect(insightProgress(LIMIT * 10, T, LIMIT)).toBe(99);
  });

  it("음수 경과(클라이언트·서버 시계 차)는 0 이다", () => {
    expect(insightProgress(-5_000, T, LIMIT)).toBe(0);
  });
});

describe("insightFillValue", () => {
  it("DONE 을 받은 값에서 100 까지 건너뛰지 않고 고르게 채운다", () => {
    const from = 45;
    const duration = insightFillMs(from);
    expect(duration).toBe(INSIGHT_FILL_MAX_MS);
    expect(insightFillValue(from, 0)).toBe(from);
    expect(insightFillValue(from, duration / 2)).toBe(72);
    expect(insightFillValue(from, duration)).toBe(100);
  });

  it("99 에서는 금방 100 이 되고, 100 이면 바로 100 이다", () => {
    expect(insightFillMs(99)).toBeLessThan(50);
    expect(insightFillValue(100, 0)).toBe(100);
  });
});
