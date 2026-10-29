import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { FACTOR_KEYS, analysisInputSchema, analyze, type AnalysisInput } from "@/server/scoring";
import { FACTOR_LABEL } from "@/server/shared";
import type { InsightGatewayResponse } from "./gateway.model";
import {
  toInsightPayload,
  toInsightRequest,
  toInsightRunSource,
  type InsightRunRows,
  type InsightRunSource,
} from "./insight-request.model";
import { buildAnalysisInput, fakeGateway, jsonReply, withPatch } from "./test-support";

// 추천 분석(ADR-066) gateway 요청 조립. 판정은 저장된 run 값을 그대로 옮기고, 근거 번호는 B = 공고 인용, C = 회사 자료다.

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

/** fixture 입력으로 규칙 엔진을 돌려 저장된 run 과 같은 모양을 만든다. */
function runSource(input: AnalysisInput = buildAnalysisInput("FX-01")): InsightRunSource {
  const result = analyze(input);
  return {
    scoreRunId: RUN_ID,
    orgId: ORG_ID,
    input,
    score: result.score,
    recommendation: result.recommendation,
    recommendationBasis: result.recommendationBasis,
    reviewFlags: result.reviewFlags,
    missingFactors: result.missingFactors.map((entry) => entry.factor),
    kevEnabled: result.kev.enabled,
    kevReviewFlags: ["KEV_NEEDS_REVIEW"],
    injectionSuspected: false,
    factors: result.factors.map((factor) => ({
      factor: factor.factor,
      points: factor.points,
      maxPoints: factor.maxPoints,
      reason: factor.note ?? "",
      rawValue: factor.rawValue,
    })),
    checks: result.qualificationChecks.map((check) => ({
      label: check.requirementName,
      status: check.outcome,
      reason: check.reason,
    })),
  };
}

const response = (overrides: Partial<InsightGatewayResponse> = {}): InsightGatewayResponse => ({
  summary: "공고 요구 기술과 회사 보유 기술이 맞습니다.",
  strengths: [{ text: "요구 기술을 보유했습니다.", refIds: ["B2", "C1"] }],
  improvements: [],
  fallback: false,
  fallbackReason: null,
  model: "Qwen/Qwen3.8-Flash-Next",
  promptHash: "a".repeat(64),
  ...overrides,
});

describe("toInsightRequest", () => {
  it("refs 는 공고 인용 B·회사 자료 C 로 번호를 매긴다", () => {
    const source = runSource();
    const { request, refs } = toInsightRequest(source, REQUEST_ID);
    const extraction = source.input.extraction;
    const bidRefs = refs.filter((ref) => ref.kind === "BID");
    const companyRefs = refs.filter((ref) => ref.kind === "COMPANY");

    expect(request.refs).toEqual(refs);
    expect(bidRefs.map((ref) => ref.id)).toEqual(bidRefs.map((_, index) => `B${index + 1}`));
    expect(bidRefs.length).toBeGreaterThan(0);
    expect(bidRefs.length).toBeLessThanOrEqual(12);
    // 공고 쪽 첫 근거는 추출 필드의 첫 근거 인용 그대로다.
    expect(bidRefs.map((ref) => ref.quotedText)).toContain(
      extraction?.qualifications.evidence[0]?.quotedText,
    );
    expect(bidRefs.map((ref) => ref.quotedText)).toContain(
      extraction?.requiredSkills.evidence[0]?.quotedText,
    );

    expect(companyRefs.map((ref) => ref.id)).toEqual(
      companyRefs.map((_, index) => `C${index + 1}`),
    );
    const labels = companyRefs.map((ref) => ref.label);
    expect(labels.filter((label) => label === "과거 수행 사업").length).toBeLessThanOrEqual(5);
    expect(labels.filter((label) => label === "보유 기술").length).toBeLessThanOrEqual(5);
    expect(labels.filter((label) => label === "투입 가능 인력")).toHaveLength(1);
    // 유사 실적 요소가 고른 실적(FX-01 은 P1)이 첫 회사 자료다.
    const selected = source.input.profile.pastProjects.find((project) => project.id === "P1");
    expect(companyRefs[0]).toMatchObject({ label: "과거 수행 사업" });
    expect(companyRefs[0].quotedText).toContain(selected?.name);
    expect(companyRefs.find((ref) => ref.label === "보유 기술")?.quotedText).toBeTruthy();
    expect(companyRefs.find((ref) => ref.label === "투입 가능 인력")?.quotedText).toContain(
      request.company.staff?.from,
    );
  });

  it("공고 요약·판정은 저장된 run 값을 그대로 옮기고 마감은 KST 날짜다", () => {
    const source = runSource();
    const { request } = toInsightRequest(source, REQUEST_ID);
    expect(request.requestId).toBe(REQUEST_ID);
    expect(request.bid).toEqual({
      title: source.input.bid.title,
      agency: source.input.bid.agency,
      budgetKrw: source.input.bid.budgetKrw,
      deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(request.rules).toMatchObject({
      score: source.score,
      recommendation: source.recommendation,
      recommendationBasis: source.recommendationBasis,
      reviewFlags: source.reviewFlags,
      missingFactors: source.missingFactors,
    });
    expect(request.rules.qualificationChecks).toEqual(source.checks);
  });

  it("요소 이름은 화면과 같은 한국어 이름이다", () => {
    const { request } = toInsightRequest(
      { ...runSource(), missingFactors: ["staffAvailability"] },
      REQUEST_ID,
    );
    expect(request.rules.factors.map((factor) => factor.label)).toEqual(
      Object.values(FACTOR_LABEL),
    );
    expect(request.rules.factors[0]).not.toHaveProperty("rawValue");
    expect(request.rules.missingFactors).toEqual([FACTOR_LABEL.staffAvailability]);
  });

  it("Bosun 을 쓰지 않았으면 bosun 은 null 이다", () => {
    const used = toInsightRequest(runSource(), REQUEST_ID).request;
    expect(used.bosun).toEqual({ reviewFlags: ["KEV_NEEDS_REVIEW"] });
    const notUsed = toInsightRequest({ ...runSource(), kevEnabled: false }, REQUEST_ID).request;
    expect(notUsed.bosun).toBeNull();
  });

  it("인력 기간이 없으면 company.staff 는 null 이고 인력 근거도 없다", () => {
    const input = buildAnalysisInput("FX-01");
    const source = { ...runSource(), input: { ...input, team: { ...input.team, members: [] } } };
    const { request, refs } = toInsightRequest(source, REQUEST_ID);
    expect(request.company.staff).toBeNull();
    expect(refs.some((ref) => ref.label === "투입 가능 인력")).toBe(false);
  });

  it("상한을 넘는 입력을 자른다", () => {
    const base = runSource();
    const check = { label: "가".repeat(120), status: "NEEDS_REVIEW" as const, reason: "확인 필요" };
    const input = withPatch(base.input, (draft) => {
      draft.profile.technologies = Array.from({ length: 15 }, (_, index) => ({
        name: `기술${index + 1}`,
        sourceIds: [],
      }));
      draft.profile.pastProjects[0].name = "나".repeat(400);
    });
    const { request, refs } = toInsightRequest(
      {
        ...base,
        input,
        // 요소 5개를 두 번(10개). 유사 실적 rawValue 가 남아 있어 긴 실적 이름이 근거로 들어간다.
        factors: [...base.factors, ...base.factors],
        checks: Array.from({ length: 25 }, () => check),
      },
      REQUEST_ID,
    );
    expect(request.rules.factors).toHaveLength(8);
    expect(request.rules.qualificationChecks).toHaveLength(20);
    expect(request.rules.qualificationChecks[0].label).toHaveLength(80);
    expect(request.company.technologies).toHaveLength(10);
    expect(refs.length).toBeLessThanOrEqual(24);
    for (const ref of refs) {
      expect(ref.label.length).toBeLessThanOrEqual(80);
      expect(ref.quotedText.length).toBeLessThanOrEqual(300);
    }
    expect(refs.some((ref) => ref.quotedText.startsWith("나".repeat(300)))).toBe(true);
  });

  // 보안 리뷰 중-2: 인젝션 의심 run 의 공고 원문을 모델에 넘기지 않는다. gateway 는 이 값이면 모델을 부르지 않는다.
  it("인젝션 의심 run 은 injectionSuspected 를 켜고 공고 인용(B)을 빼고 보낸다", () => {
    const normal = toInsightRequest(runSource(), REQUEST_ID);
    expect(normal.request.injectionSuspected).toBe(false);
    expect(normal.refs.some((ref) => ref.kind === "BID")).toBe(true);

    const suspected = toInsightRequest({ ...runSource(), injectionSuspected: true }, REQUEST_ID);
    expect(suspected.request.injectionSuspected).toBe(true);
    expect(suspected.refs.filter((ref) => ref.kind === "BID")).toHaveLength(0);
    expect(suspected.request.refs).toEqual(suspected.refs);
    // 회사 자료는 남기고 번호는 C1 부터다.
    expect(suspected.refs.map((ref) => ref.id)).toEqual(
      normal.refs.filter((ref) => ref.kind === "COMPANY").map((ref) => ref.id),
    );
    expect(suspected.refs[0]).toMatchObject({ id: "C1", kind: "COMPANY" });
  });
});

describe("toInsightPayload", () => {
  it("항목이 가리키지 않은 refs 를 뺀다", () => {
    const { refs } = toInsightRequest(runSource(), REQUEST_ID);
    const payload = toInsightPayload(response(), refs);
    expect(payload.refs.map((ref) => ref.id)).toEqual(["B2", "C1"]);
    expect(payload).toMatchObject({
      summary: "공고 요구 기술과 회사 보유 기술이 맞습니다.",
      strengths: [{ text: "요구 기술을 보유했습니다.", refIds: ["B2", "C1"] }],
      improvements: [],
    });
  });

  it("요청에 없던 근거 번호를 가리키면 던진다", () => {
    const { refs } = toInsightRequest(runSource(), REQUEST_ID);
    expect(() =>
      toInsightPayload(
        response({ improvements: [{ text: "보완이 필요합니다.", refIds: ["B99"] }] }),
        refs,
      ),
    ).toThrow();
  });
});

describe("GatewayClient.insight", () => {
  it("/insight 로 보내고 계약에 맞는 응답만 받는다", async () => {
    const { request } = toInsightRequest(runSource(), REQUEST_ID);
    const ok = fakeGateway({ "/insight": jsonReply(response()) });
    const result = await ok.gateway.insight(request);
    expect(result).toMatchObject({ ok: true, value: response(), attempts: 1 });
    expect(ok.bodyOf("/insight")).toMatchObject({ requestId: REQUEST_ID, refs: request.refs });

    // fallback 이면 fallbackReason 이 있어야 한다(표 check 와 같은 규칙).
    const broken = fakeGateway({
      "/insight": jsonReply(response({ fallback: true, fallbackReason: null, model: null })),
    });
    expect(await broken.gateway.insight(request)).toMatchObject({
      ok: false,
      failure: { kind: "INVALID_RESPONSE" },
    });
  });

  it("인젝션 의심으로 모델을 부르지 않은 템플릿 응답(INJECTION_SUSPECTED)을 받는다", async () => {
    const { request } = toInsightRequest({ ...runSource(), injectionSuspected: true }, REQUEST_ID);
    const template = response({
      strengths: [],
      fallback: true,
      fallbackReason: "INJECTION_SUSPECTED",
      model: null,
    });
    const gateway = fakeGateway({ "/insight": jsonReply(template) });
    expect(await gateway.gateway.insight(request)).toMatchObject({ ok: true, value: template });
    expect(gateway.bodyOf("/insight")).toMatchObject({ injectionSuspected: true });
  });
});

describe("toInsightRunSource", () => {
  const toJson = (value: unknown): Json => {
    const json: Json = JSON.parse(JSON.stringify(value));
    return json;
  };

  /** 분석 저장(finish_score_run)이 남기는 행 모양. 요소는 일부러 거꾸로 넣는다. */
  function runRows(input = buildAnalysisInput("FX-02")): InsightRunRows {
    const result = analyze(input);
    return {
      run: {
        id: RUN_ID,
        org_id: ORG_ID,
        status: "COMPLETED",
        input_snapshot: toJson(input),
        score: result.score,
        recommendation: result.recommendation,
        recommendation_basis: result.recommendationBasis,
        review_flags: [...result.reviewFlags, "CITATION_FAILED"],
        missing_factors: [],
        kev_assist: toJson(result.kev),
        injection_suspected: false,
      },
      factors: result.factors.toReversed().map((factor) => ({
        factor: factor.factor,
        points: factor.points,
        max_points: factor.maxPoints,
        note: factor.note,
        raw_value: toJson(factor.rawValue),
      })),
      checks: result.qualificationChecks.map((check) => ({
        requirement_name: check.requirementName,
        outcome: check.outcome,
        reason: check.reason,
      })),
    };
  }

  it("저장된 run 행을 점수표 순 요소·Bosun 플래그와 함께 읽는다", () => {
    const rows = runRows();
    const source = toInsightRunSource(rows);
    expect(source).toMatchObject({
      scoreRunId: RUN_ID,
      orgId: ORG_ID,
      score: 72,
      recommendation: "WATCH",
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
      kevEnabled: true,
      kevReviewFlags: ["KEV_NEEDS_REVIEW"],
      reviewFlags: ["KEV_NEEDS_REVIEW", "CITATION_FAILED"],
      injectionSuspected: false,
    });
    expect(source?.factors.map((factor) => factor.factor)).toEqual([...FACTOR_KEYS]);
    // 스냅샷은 입력 계약으로 읽는다(계약 밖 키는 버린다).
    expect(source?.input).toEqual(analysisInputSchema.parse(buildAnalysisInput("FX-02")));
    expect(source?.checks).toHaveLength(rows.checks.length);
  });

  it("review_flags 의 INJECTION_SUSPECTED 나 injection_suspected 열이 참이면 인젝션 의심이다", () => {
    const rows = runRows();
    const flagged = {
      ...rows.run,
      review_flags: [...rows.run.review_flags, "INJECTION_SUSPECTED"],
    };
    expect(toInsightRunSource({ ...rows, run: flagged })?.injectionSuspected).toBe(true);
    const column = { ...rows.run, injection_suspected: true };
    expect(toInsightRunSource({ ...rows, run: column })?.injectionSuspected).toBe(true);
    expect(toInsightRunSource(rows)?.injectionSuspected).toBe(false);
  });

  it("끝나지 않은 run·입력 계약과 다른 스냅샷·모르는 판정 값이면 null 이다", () => {
    const rows = runRows();
    expect(toInsightRunSource({ ...rows, run: { ...rows.run, status: "RUNNING" } })).toBeNull();
    expect(
      toInsightRunSource({ ...rows, run: { ...rows.run, input_snapshot: { bid: null } } }),
    ).toBeNull();
    expect(
      toInsightRunSource({
        ...rows,
        checks: [{ requirement_name: "자격", outcome: "MAYBE", reason: "모름" }],
      }),
    ).toBeNull();
  });
});
