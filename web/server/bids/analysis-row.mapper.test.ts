import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factorKeySchema } from "./bid.model";
import { KEV_DISCLAIMER } from "./analysis-view.model";
import type { QualificationCheckView } from "./analysis-view.model";
import { qualificationStatusOf, toAnalysisViewFromRows } from "./analysis-row.mapper";
import type {
  AnalysisRows,
  QualificationCheckRow,
  ScoreFactorRow,
  ScoreRunRow,
} from "./analysis-row.mapper";

type Golden = {
  factors: { factor: string; normalized: number; points: number; maxPoints: number }[];
  score: number;
  recommendation: "BID" | "WATCH" | "NO_BID";
};
const golden = (id: string): Golden =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `../fixtures/goldens/${id}.json`), "utf8"),
  ) as Golden;

const T0 = "2026-10-16T00:00:00Z";
const quote = {
  documentId: "d1",
  revisionId: "r1",
  page: 1,
  charStart: 0,
  charEnd: 5,
  quotedText: "소프트웨어",
  fetchedAt: T0,
};

function runRow(patch: Partial<ScoreRunRow> = {}): ScoreRunRow {
  return {
    ai_provider: "MOCK",
    algorithm_version: "sol-v0.1.0",
    bid_id: "bid-1",
    company_profile_id: "cp-1",
    created_at: T0,
    error_code: null,
    explanation: "설명",
    extraction_id: null,
    fallback_reason: null,
    finished_at: "2026-10-16T00:00:02Z",
    id: "run-1",
    idempotency_key: null,
    injection_suspected: false,
    input_snapshot: null,
    input_snapshot_hash: "h",
    kev_assist: null,
    kev_calibration: null,
    kev_model: null,
    kev_output: null,
    missing_factors: [],
    model_metadata: {},
    org_id: "org-1",
    profile_revision: 3,
    prompt_hash: null,
    question_set_version: null,
    queued_at: T0,
    qwen_model: null,
    recommendation: "BID",
    recommendation_basis: "RULES_ONLY",
    request_hash: null,
    requested_by: null,
    review_flags: [],
    revision_id: "r1",
    run_mode: "FIXTURE",
    score: 94,
    started_at: "2026-10-16T00:00:01Z",
    status: "COMPLETED",
    ...patch,
  };
}

function factorRows(g: Golden, patch: Partial<ScoreFactorRow> = {}): ScoreFactorRow[] {
  return g.factors.map((f, i) => ({
    id: `f${i}`,
    org_id: "org-1",
    score_run_id: "run-1",
    factor: f.factor,
    raw_value: {},
    normalized: f.normalized,
    points: f.points,
    max_points: f.maxPoints,
    missing: false,
    missing_reason: null,
    evidence: [],
    note: null,
    ...patch,
  }));
}

function checkRow(patch: Partial<QualificationCheckRow> = {}): QualificationCheckRow {
  return {
    id: "c1",
    org_id: "org-1",
    bid_id: "bid-1",
    revision_id: "r1",
    score_run_id: "run-1",
    requirement_code: "1426",
    requirement_name: "소프트웨어사업자",
    mandatory: true,
    outcome: "SATISFIED",
    reason: "보유",
    reason_code: null,
    basis: "EXTRACTION",
    evidence: [quote],
    profile_evidence: [
      { type: "INDUSTRY_CODE", ref: "industryCodes[0]", label: "소프트웨어사업자" },
    ],
    company_evidence: [],
    checked_at: "2026-10-16T00:00:02Z",
    ...patch,
  };
}

function rows(id: string, patch: Partial<AnalysisRows> = {}): AnalysisRows {
  const g = golden(id);
  return {
    run: runRow({ score: g.score, recommendation: g.recommendation }),
    revision: 1,
    factors: factorRows(g),
    checks: [checkRow()],
    assessments: [],
    ...patch,
  };
}

afterEach(() => vi.restoreAllMocks());

const dist = { SATISFIED: 0.9, NOT_SATISFIED: 0.05, NEEDS_REVIEW: 0.05 };

describe("toAnalysisViewFromRows", () => {
  it("FX-01: 점수·요소 순서·자격 상태를 골든과 맞춘다", () => {
    const view = toAnalysisViewFromRows(rows("FX-01"));
    expect(view.solScore).toBe(94);
    expect(view.scoreBreakdown.map((f) => f.points)).toEqual(
      golden("FX-01").factors.map((f) => f.points),
    );
    expect(view.scoreBreakdown.map((f) => f.factor)).toEqual(factorKeySchema.options);
    expect(view.qualification.status).toBe("SATISFIED");
    expect(view.runMode).toBe("fixture");
    expect(view.model.provider).toBe("mock");
  });

  it("요소 행이 뒤섞여도 factorKeySchema 순서로 낸다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({ ...base, factors: [...base.factors].reverse() });
    expect(view.scoreBreakdown.map((f) => f.factor)).toEqual(factorKeySchema.options);
  });

  it("numeric 열이 문자열로 와도 숫자로 바꾼다", () => {
    // numeric 열은 PostgREST 에서 문자열로 올 수 있다
    const g = golden("FX-03");
    const base = rows("FX-03");
    const factors = base.factors.map((f) => ({
      ...f,
      points: String(f.points) as unknown as number,
    }));
    const view = toAnalysisViewFromRows({ ...base, factors });
    expect(view.scoreBreakdown.map((f) => f.points)).toEqual(g.factors.map((f) => f.points));
  });

  it("FX-03: 필수 NOT_SATISFIED 이면 자격 NOT_SATISFIED, 지시문 의심이면 NEEDS_REVIEW", () => {
    const base = rows("FX-03", {
      checks: [checkRow({ outcome: "NOT_SATISFIED", reason: "미보유" })],
    });
    expect(toAnalysisViewFromRows(base).qualification.status).toBe("NOT_SATISFIED");
    const injected = toAnalysisViewFromRows({
      ...base,
      run: { ...base.run, injection_suspected: true },
    });
    expect(injected.qualification.status).toBe("NEEDS_REVIEW");
    expect(injected.injectionSuspected).toBe(true);
  });

  it("kev_assist 가 null 이면 꺼짐이고 모델 이름은 kev_model 에서 온다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({
      ...base,
      run: {
        ...base.run,
        kev_assist: null,
        kev_model: "jaredpalmer/kev-9b@v1.0",
        question_set_version: "kev-qs/v0.2",
      },
    });
    expect(view.kev.enabled).toBe(false);
    expect(view.kev.disclaimer).toBe(KEV_DISCLAIMER);
    expect(view.model.kev).toEqual({
      model: "jaredpalmer/kev-9b@v1.0",
      questionSetVersion: "kev-qs/v0.2",
    });
  });

  it("kev_assist 모양이 틀리면 꺼짐으로 읽고 로그를 한 번 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({ ...base, run: { ...base.run, kev_assist: { bad: 1 } } });
    expect(view.kev.enabled).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ event: "kev_assist_invalid", scoreRunId: "run-1" }),
    );
  });

  it("qwen·kev 모델 정보는 저장 열에서 만든다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({
      ...base,
      run: {
        ...base.run,
        qwen_model: "qwen3",
        prompt_hash: null,
        model_metadata: {
          provider: "mock",
          qwen: { name: "qwen3", promptVersion: "p1", promptHash: "x" },
        },
      },
    });
    expect(view.model.qwen).toEqual({ name: "qwen3", promptVersion: "p1", promptHash: "" });
    expect(view.model.kev).toBeNull();
    const legacy = toAnalysisViewFromRows({
      ...base,
      run: { ...base.run, qwen_model: "qwen3", model_metadata: { promptVersion: "p0" } },
    });
    expect(legacy.model.qwen?.promptVersion).toBe("p0");
    const noMeta = toAnalysisViewFromRows({
      ...base,
      run: {
        ...base.run,
        qwen_model: "qwen3",
        model_metadata: { promptVersion: 3, qwen: { promptVersion: 4 } },
      },
    });
    expect(noMeta.model.qwen?.promptVersion).toBe("");
  });

  it("사유 없는 누락 요소는 missingFactors 에서 빠지고 행에는 missing 이 남는다", () => {
    const base = rows("FX-01");
    const factors = base.factors.map((f) =>
      f.factor === "scaleFit"
        ? { ...f, missing: true, missing_reason: null }
        : f.factor === "skillMatch"
          ? { ...f, missing: true, missing_reason: "BID_DOMAIN_UNKNOWN" }
          : f,
    );
    const view = toAnalysisViewFromRows({ ...base, factors });
    expect(view.missingFactors).toEqual([{ factor: "skillMatch", reason: "BID_DOMAIN_UNKNOWN" }]);
    const scale = view.scoreBreakdown.find((f) => f.factor === "scaleFit");
    expect(scale?.missing).toBe(true);
    expect(scale?.missingReason).toBeNull();
  });

  it("evidence: FAILED 는 빼고 같은 인용은 하나로 합친다", () => {
    const base = rows("FX-01");
    const failed = { ...quote, quotedText: "실패", match: "FAILED" };
    const factors = base.factors.map((f, i) => (i === 0 ? { ...f, evidence: [quote, failed] } : f));
    const view = toAnalysisViewFromRows({
      ...base,
      factors,
      checks: [checkRow({ evidence: [quote, { ...quote, quotedText: "다른 인용" }] })],
    });
    expect(view.evidence.map((e) => e.quotedText)).toEqual(["소프트웨어", "다른 인용"]);
  });

  it("점수 run 이 아니면 점수·분해를 비우고 자격은 NEEDS_REVIEW 다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({
      ...base,
      run: {
        ...base.run,
        status: "QUEUED",
        score: null,
        recommendation: null,
        recommendation_basis: null,
      },
    });
    expect(view.solScore).toBeNull();
    expect(view.qualification).toEqual({ status: "NEEDS_REVIEW", checks: [] });
    expect(view.scoreBreakdown).toEqual([]);
    expect(view.missingFactors).toEqual([]);
    expect(view.evidence).toEqual([]);
  });

  it("kev_assist=null 이면 로그를 남기지 않는다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    toAnalysisViewFromRows(rows("FX-01"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("writer 모양의 유효한 kev_assist(enabled=true)는 그대로 읽는다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = rows("FX-01");
    const kev = {
      enabled: true,
      provider: "mock",
      model: "kev-mock",
      questionSetVersion: "kev-qs/v0.2",
      suggestedOption: "BID",
      probabilities: { BID: 0.7, WATCH: 0.2, NO_BID: 0.1 },
      confidence: 0.7,
      mandatoryRisk: 0.1,
      needsHumanReview: 0.2,
      fit: null,
      scores: null,
      risks: null,
      calibration: null,
      stateTrace: null,
      latencyMs: 12,
      requestId: "req-1",
      disclaimer: KEV_DISCLAIMER,
    };
    const view = toAnalysisViewFromRows({ ...base, run: { ...base.run, kev_assist: kev } });
    expect(view.kev).toEqual(kev);
    expect(spy).not.toHaveBeenCalled();
  });

  it("PARTIAL run 도 점수 run 으로 읽는다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({ ...base, run: { ...base.run, status: "PARTIAL" } });
    expect(view.status).toBe("PARTIAL");
    expect(view.solScore).toBe(94);
    expect(view.scoreBreakdown).toHaveLength(5);
  });

  it("FAILED run 은 점수·분해를 비우고 오류 코드를 싣는다", () => {
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({
      ...base,
      run: {
        ...base.run,
        status: "FAILED",
        score: null,
        recommendation: null,
        recommendation_basis: null,
        error_code: "AI_UNAVAILABLE",
      },
    });
    expect(view.solScore).toBeNull();
    expect(view.errorCode).toBe("AI_UNAVAILABLE");
    expect(view.qualification).toEqual({ status: "NEEDS_REVIEW", checks: [] });
    expect(view.scoreBreakdown).toEqual([]);
  });

  it("점수 run 인데 check 행이 없으면 자격은 NEEDS_REVIEW 다", () => {
    const view = toAnalysisViewFromRows({ ...rows("FX-01"), checks: [] });
    expect(view.qualification).toEqual({ status: "NEEDS_REVIEW", checks: [] });
  });

  it("목록에 없는 factor 행은 버리고 로그를 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = rows("FX-01");
    const extra = { ...base.factors[0]!, id: "fx", factor: "mystery" };
    const view = toAnalysisViewFromRows({ ...base, factors: [...base.factors, extra] });
    expect(view.scoreBreakdown).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ event: "score_factor_unknown", factor: "mystery" }),
    );
  });

  it("항목 Kev 분포가 일부 키만 있으면 null + 로그 1회, throw 하지 않는다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = rows("FX-01");
    const view = toAnalysisViewFromRows({
      ...base,
      assessments: [
        {
          id: "a9",
          org_id: "org-1",
          score_run_id: "run-1",
          created_at: T0,
          item_id: "qualifications[0]",
          item_kind: "QUALIFICATION",
          rule_status: "SATISFIED",
          rule_reason: null,
          basis: "EXTRACTION",
          notice_evidence: [],
          company_evidence: [],
          kev_label: "SATISFIED",
          kev_distribution: { qid: "q1", distribution: { SATISFIED: 0.9 } },
          flags: [],
        },
      ],
    });
    expect(view.requirementAssessments[0]?.kev).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ event: "kev_distribution_invalid", id: "a9" }),
    );
  });

  it("항목 판정의 Kev 분포는 qid 가 있을 때만 싣는다", () => {
    const base = rows("FX-01");
    const row = {
      id: "a1",
      org_id: "org-1",
      score_run_id: "run-1",
      created_at: T0,
      item_id: "qualifications[0]",
      item_kind: "QUALIFICATION",
      rule_status: "SATISFIED",
      rule_reason: null,
      basis: "EXTRACTION",
      notice_evidence: [quote],
      company_evidence: [],
      kev_distribution: null,
      kev_label: null,
      flags: [],
    };
    const view = toAnalysisViewFromRows({ ...base, assessments: [row] });
    expect(view.requirementAssessments[0]?.kev).toBeNull();
    const withKev = toAnalysisViewFromRows({
      ...base,
      assessments: [
        {
          ...row,
          kev_label: "SATISFIED",
          kev_distribution: { qid: "q1", distribution: dist },
        },
      ],
    });
    expect(withKev.requirementAssessments[0]?.kev).toEqual({
      qid: "q1",
      distribution: dist,
      label: "SATISFIED",
    });
  });
});

describe("qualificationStatusOf", () => {
  const check = (mandatory: boolean, outcome: QualificationCheckView["outcome"]) =>
    ({ mandatory, outcome }) as QualificationCheckView;

  it("지시문 의심이 가장 먼저다", () => {
    expect(qualificationStatusOf([check(true, "NOT_SATISFIED")], true)).toBe("NEEDS_REVIEW");
  });
  it("필수 NOT_SATISFIED > 필수 NEEDS_REVIEW > SATISFIED", () => {
    expect(
      qualificationStatusOf([check(true, "NEEDS_REVIEW"), check(true, "NOT_SATISFIED")], false),
    ).toBe("NOT_SATISFIED");
    expect(qualificationStatusOf([check(true, "NEEDS_REVIEW")], false)).toBe("NEEDS_REVIEW");
    expect(qualificationStatusOf([check(true, "SATISFIED")], false)).toBe("SATISFIED");
  });
  it("필수가 아닌 항목은 보지 않는다", () => {
    expect(qualificationStatusOf([check(false, "NOT_SATISFIED")], false)).toBe("SATISFIED");
    expect(qualificationStatusOf([], false)).toBe("SATISFIED");
  });
});
