import { describe, expect, it } from "vitest";
import {
  ANALYSIS_STATUS_LABEL,
  EXTRA_STATUS_LABEL,
  FACTOR_LABEL,
  FACTOR_ORDER,
  KEV_RISK_LABEL,
  MISSING_REASON_LABEL,
  NEEDS_REVIEW_REASON_LABEL,
  NOTIFICATION_ICON,
  NOTIFICATION_TYPE_LABEL,
  QUALIFICATION_LABEL,
  RECOMMENDATION_LABEL,
  REVIEW_FLAG_LABEL,
  STAGE_LABEL,
  STATUS_ICON,
} from "./labels";

describe("라벨 표", () => {
  it("플래그 17개, missing 사유 8개, 사유 6개, 요소 5개", () => {
    expect(Object.keys(REVIEW_FLAG_LABEL)).toHaveLength(17);
    expect(Object.keys(MISSING_REASON_LABEL)).toHaveLength(8);
    expect(Object.keys(NEEDS_REVIEW_REASON_LABEL)).toHaveLength(6);
    expect(Object.keys(FACTOR_LABEL)).toHaveLength(5);
    expect(Object.keys(NOTIFICATION_TYPE_LABEL)).toHaveLength(5);
    expect(Object.keys(KEV_RISK_LABEL)).toHaveLength(5);
  });
  it("요소 순서는 점수표 순이다", () => {
    expect(FACTOR_ORDER).toEqual([
      "skillMatch",
      "pastPerformance",
      "staffAvailability",
      "scaleFit",
      "strategicPreference",
    ]);
  });
  it("스펙 표의 대표 글자", () => {
    expect(RECOMMENDATION_LABEL.NO_BID).toBe("NO-BID");
    expect(ANALYSIS_STATUS_LABEL.PARTIAL).toEqual({
      long: "부분 완료 (규칙만)",
      short: "부분 완료",
    });
    expect(QUALIFICATION_LABEL.NEEDS_REVIEW).toBe("확인 필요");
    expect(STAGE_LABEL.PRE_SPEC).toBe("사전규격");
    expect(EXTRA_STATUS_LABEL.NOT_APPLICABLE).toBe("해당 없음");
  });
  it("상태 아이콘 표는 모든 권고·자격 키를 가진다", () => {
    for (const key of ["BID", "WATCH", "NO_BID", "SATISFIED", "NEEDS_REVIEW", "NOT_SATISFIED"]) {
      expect(STATUS_ICON).toHaveProperty(key);
    }
    expect(STATUS_ICON.NO_BID.className).toBe("text-destructive");
    expect(Object.keys(NOTIFICATION_ICON)).toHaveLength(5);
  });
  it("수주·낙찰 확률 글자를 쓰지 않는다", () => {
    const all = JSON.stringify([
      RECOMMENDATION_LABEL,
      QUALIFICATION_LABEL,
      ANALYSIS_STATUS_LABEL,
      EXTRA_STATUS_LABEL,
      REVIEW_FLAG_LABEL,
      NEEDS_REVIEW_REASON_LABEL,
      MISSING_REASON_LABEL,
      FACTOR_LABEL,
      STAGE_LABEL,
      NOTIFICATION_TYPE_LABEL,
      KEV_RISK_LABEL,
    ]);
    expect(all).not.toMatch(/수주\s?확률|낙찰\s?확률/);
  });
});
