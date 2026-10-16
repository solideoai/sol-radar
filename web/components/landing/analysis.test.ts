import { describe, expect, it } from "vitest";
import {
  countByStatus,
  recommend,
  scoreOf,
  type QualificationCheck,
} from "@/components/landing/analysis";

// docs/08-SCORING.md §5.2 결정 정책 v0.1. 필수 자격이 점수보다 먼저다.
const check = (status: QualificationCheck["status"]): QualificationCheck => ({
  requirement: "필수 자격",
  status,
  note: "",
});

describe("recommend", () => {
  it("필수 자격이 하나라도 미충족이면 점수가 높아도 NO_BID 다", () => {
    expect(recommend([check("SATISFIED"), check("NOT_SATISFIED")], 95)).toEqual({
      recommendation: "NO_BID",
      reason: "필수 자격 미충족 1건이 있어 참여를 권고하지 않습니다. 점수는 참고용입니다.",
    });
  });

  it("확인 필요가 남아 있으면 BID 기준 이상이어도 WATCH 다", () => {
    expect(recommend([check("SATISFIED"), check("NEEDS_REVIEW")], 82)).toEqual({
      recommendation: "WATCH",
      reason: "필수 자격 확인 필요 1건이 남아 있어 BID로 권고하지 않습니다.",
    });
  });

  it("미충족과 확인 필요가 같이 있으면 미충족이 이긴다", () => {
    expect(recommend([check("NEEDS_REVIEW"), check("NOT_SATISFIED")], 90).recommendation).toBe(
      "NO_BID",
    );
  });

  it.each([
    [100, "BID"],
    [75, "BID"],
    [74, "WATCH"],
    [50, "WATCH"],
    [49, "NO_BID"],
  ] as const)("자격을 모두 충족하면 %i점은 %s 다", (score, expected) => {
    expect(recommend([check("SATISFIED")], score).recommendation).toBe(expected);
  });

  it("자격을 모두 충족하고 75점 이상이면 그 사실을 이유로 든다", () => {
    expect(recommend([check("SATISFIED")], 88).reason).toBe(
      "필수 자격을 모두 충족하고 적합도가 75점 이상입니다.",
    );
  });
});

describe("scoreOf · countByStatus", () => {
  it("점수는 요소 점수의 합이다", () => {
    expect(
      scoreOf([
        { label: "a", points: 24, max: 30 },
        { label: "b", points: 58, max: 70 },
      ]),
    ).toBe(82);
  });

  it("상태별 개수를 센다", () => {
    expect(countByStatus([check("SATISFIED"), check("SATISFIED"), check("NEEDS_REVIEW")])).toEqual({
      SATISFIED: 2,
      NEEDS_REVIEW: 1,
      NOT_SATISFIED: 0,
    });
  });
});
