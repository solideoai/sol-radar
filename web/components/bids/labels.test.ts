import { describe, expect, it } from "vitest";
import {
  ANALYSIS_STATUS_LABEL,
  EXTRA_STATUS_LABEL,
  FACTOR_LABEL,
  FLAG_ICON,
  FACTOR_ORDER,
  KEV_RISK_LABEL,
  MISSING_REASON_LABEL,
  NEEDS_REVIEW_REASON_LABEL,
  NOTIFICATION_ICON,
  NOTIFICATION_TYPE_LABEL,
  QUALIFICATION_LABEL,
  RECOMMENDATION_LABEL,
  REVIEW_RECOMMENDED_FLAGS,
  REVIEW_FLAG_LABEL,
  STAGE_LABEL,
  STATUS_ICON,
  kevRecordMissing,
  ruleReasonOf,
} from "./labels";
import { FX01_PARTIAL_VIEW, FX01_VIEW, FX02_VIEW } from "./test-data";

describe("라벨 표", () => {
  it("플래그 17개, missing 사유 8개, 사유 6개, 요소 5개", () => {
    expect(Object.keys(REVIEW_FLAG_LABEL)).toHaveLength(17);
    expect(Object.keys(MISSING_REASON_LABEL)).toHaveLength(8);
    expect(Object.keys(NEEDS_REVIEW_REASON_LABEL)).toHaveLength(6);
    expect(Object.keys(FACTOR_LABEL)).toHaveLength(5);
    expect(Object.keys(NOTIFICATION_TYPE_LABEL)).toHaveLength(7);
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
    expect(Object.keys(NOTIFICATION_ICON)).toHaveLength(7);
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

describe("플래그 표", () => {
  it("사람 검토 권장 플래그는 정확히 5개다", () => {
    expect([...REVIEW_RECOMMENDED_FLAGS].sort()).toEqual(
      [
        "INJECTION_SUSPECTED",
        "KEV_MANDATORY_RISK",
        "KEV_NEEDS_REVIEW",
        "KEV_REQUIREMENT_DISAGREEMENT",
        "MODEL_RULE_DISAGREEMENT",
      ].sort(),
    );
  });
  it("아이콘 표는 17개 키를 가지고 권장만 warning 이다", () => {
    expect(Object.keys(FLAG_ICON).sort()).toEqual(Object.keys(REVIEW_FLAG_LABEL).sort());
    for (const [flag, { className }] of Object.entries(FLAG_ICON)) {
      const recommended = (REVIEW_RECOMMENDED_FLAGS as readonly string[]).includes(flag);
      expect(className).toBe(recommended ? "text-warning" : "text-muted-foreground");
    }
  });
});

describe("ruleReasonOf", () => {
  const withStatus = (status: "SATISFIED" | "NOT_SATISFIED" | "NEEDS_REVIEW") =>
    ({ qualification: { status, checks: [] } }) as Parameters<typeof ruleReasonOf>[0];
  it("자격 상태로 사유를 정한다", () => {
    expect(ruleReasonOf(withStatus("NOT_SATISFIED"))).toBe("필수자격 미충족");
    expect(ruleReasonOf(withStatus("NEEDS_REVIEW"))).toBe("자격 확인 필요");
    expect(ruleReasonOf(withStatus("SATISFIED"))).toBe("SOL Score 기준");
  });
  it("rulePath 가 있으면 우선한다", () => {
    const v = withStatus("SATISFIED");
    expect(ruleReasonOf(v, "MANDATORY_NOT_SATISFIED")).toBe("필수자격 미충족");
    expect(ruleReasonOf(v, "QUALIFICATION_NEEDS_REVIEW")).toBe("자격 확인 필요");
    expect(ruleReasonOf(v, "MISSING_FACTORS")).toBe("미확인 요소 2개 이상");
    for (const path of ["SCORE_BID", "SCORE_WATCH", "SCORE_NO_BID"])
      expect(ruleReasonOf(v, path)).toBe("SOL Score 기준");
    expect(ruleReasonOf(withStatus("NOT_SATISFIED"), "알 수 없는 값")).toBe("필수자격 미충족");
    expect(ruleReasonOf(withStatus("NOT_SATISFIED"), null)).toBe("필수자격 미충족");
  });
});

describe("kevRecordMissing(판단 7)", () => {
  // kev_assist 가 null 인 저장 행은 kev.enabled=false 로 옮겨진다. 모델은 Kev 를 썼는데 불가 플래그가 없으면 기록이 없는 것이다.
  const unrecorded = { ...FX02_VIEW, reviewFlags: [], kev: FX01_PARTIAL_VIEW.kev };
  it("Kev 가 꺼져 있고 모델 Kev 정보가 있고 불가 플래그가 없으면 true 다", () => {
    expect(kevRecordMissing(unrecorded)).toBe(true);
  });
  it("Kev 가 켜져 있으면 false 다", () => {
    expect(kevRecordMissing(FX01_VIEW)).toBe(false);
  });
  it("모델 Kev 정보가 없으면(Kev 를 쓰지 않은 run) false 다", () => {
    expect(kevRecordMissing({ ...unrecorded, model: { ...unrecorded.model, kev: null } })).toBe(
      false,
    );
  });
  it("KEV_UNAVAILABLE·AI_UNAVAILABLE 이 있으면 false 다", () => {
    expect(kevRecordMissing({ ...unrecorded, reviewFlags: ["KEV_UNAVAILABLE"] })).toBe(false);
    expect(kevRecordMissing({ ...unrecorded, reviewFlags: ["AI_UNAVAILABLE"] })).toBe(false);
    expect(kevRecordMissing({ ...unrecorded, reviewFlags: ["KEV_NEEDS_REVIEW"] })).toBe(true);
  });
});

describe("KEV_UNAVAILABLE 라벨(ADR-031 C6·ADR-032 D9)", () => {
  it("미접속과 응답 형식 오류를 함께 뜻하므로 'Kev 사용 불가'다", () => {
    expect(REVIEW_FLAG_LABEL.KEV_UNAVAILABLE).toBe("Kev 사용 불가");
  });
});
