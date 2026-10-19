import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  analysisInputSchema,
  kevMockResponseSchema,
  normalizedBidSummarySchema,
  requirementExtractionSchema,
} from "./analysis-input.model";
import { buildInput, loadExtraction, withPatch } from "./test-support";

// 입력 계약(ADR-016): 필수 누락·타입 오류·범위 밖 점수·알 수 없는 state 는 zod 가 거절하고 오류 메시지에 경로가 있다.

const pathsOf = (error: unknown): string[] =>
  error instanceof ZodError ? error.issues.map((issue) => issue.path.join(".")) : [];
const failure = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    return pathsOf(error);
  }
  throw new Error("expected rejection");
};

describe("AnalysisInput zod 계약", () => {
  it("fixture 입력은 그대로 통과한다", () => {
    for (const id of [
      "FX-01",
      "FX-02",
      "FX-03",
      "FX-04",
      "FX-05",
      "FX-11",
      "FX-15",
      "FX-16",
      "FX-17",
    ])
      expect(analysisInputSchema.safeParse(buildInput(id)).success, id).toBe(true);
  });

  it("공고 필수 필드 누락(title·revisionId·fetchedAt)을 거절하고 경로를 알린다", () => {
    const bid = buildInput("FX-01").bid;
    const noTitle: Record<string, unknown> = { ...bid };
    delete noTitle.title;
    expect(failure(() => normalizedBidSummarySchema.parse(noTitle))).toEqual(["title"]);
    expect(failure(() => normalizedBidSummarySchema.parse({ ...bid, revisionId: "" }))).toEqual([
      "revisionId",
    ]);
    expect(failure(() => normalizedBidSummarySchema.parse({ ...bid, fetchedAt: "어제" }))).toEqual([
      "fetchedAt",
    ]);
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(buildInput("FX-01"), (draft) => void (draft.bid.title = "")),
        ),
      ),
    ).toEqual(["bid.title"]);
  });

  it("타입 오류: 예산은 KRW 정수 문자열, 마감은 ISO8601, 단계는 세 값 중 하나", () => {
    const bid = buildInput("FX-01").bid;
    expect(failure(() => normalizedBidSummarySchema.parse({ ...bid, budgetKrw: "12억" }))).toEqual([
      "budgetKrw",
    ]);
    expect(
      failure(() => normalizedBidSummarySchema.parse({ ...bid, budgetKrw: 1200000000 })),
    ).toEqual(["budgetKrw"]);
    expect(
      failure(() => normalizedBidSummarySchema.parse({ ...bid, deadlineAt: "2026-11-06" })),
    ).toEqual(["deadlineAt"]);
    expect(failure(() => normalizedBidSummarySchema.parse({ ...bid, stage: "AWARDED" }))).toEqual([
      "stage",
    ]);
  });

  it("알 수 없는 FieldState 와 KNOWN-value null 불일치를 거절한다", () => {
    const extraction = loadExtraction("FX-01");
    expect(
      failure(() =>
        requirementExtractionSchema.parse(
          withPatch(
            extraction,
            (draft) => void ((draft.domain as { state: string }).state = "MAYBE"),
          ),
        ),
      ),
    ).toEqual(["domain.state"]);
    expect(
      failure(() =>
        requirementExtractionSchema.parse(
          withPatch(extraction, (draft) => void (draft.domain.value = null)),
        ),
      ),
    ).toEqual(["domain.value"]);
    expect(
      failure(() =>
        requirementExtractionSchema.parse(
          withPatch(extraction, (draft) => void (draft.domain.evidence = [])),
        ),
      ),
    ).toEqual(["domain.evidence"]);
    expect(
      failure(() =>
        requirementExtractionSchema.parse(
          withPatch(extraction, (draft) => void (draft.deadlineAt.value = "2026-11-06T09:00:00Z")),
        ),
      ),
    ).toEqual(["deadlineAt.value"]);
  });

  it("범위 밖 Kev 점수(확률 >1, fit.score >4)와 알 수 없는 선택지를 거절한다", () => {
    const kev = buildInput("FX-01").kev!;
    expect(
      failure(() =>
        kevMockResponseSchema.parse(
          withPatch(kev, (draft) => void (draft.responses.mandatoryRisk.noul = 1.01)),
        ),
      ),
    ).toEqual(["responses.mandatoryRisk.noul"]);
    expect(
      failure(() =>
        kevMockResponseSchema.parse(
          withPatch(kev, (draft) => void (draft.responses.fit.score = 4.5)),
        ),
      ),
    ).toEqual(["responses.fit.score"]);
    expect(
      failure(() =>
        kevMockResponseSchema.parse(
          withPatch(
            kev,
            (draft) =>
              void ((draft.responses.recommendation as { choice: string }).choice = "MAYBE"),
          ),
        ),
      ),
    ).toEqual(["responses.recommendation.choice"]);
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(
            buildInput("FX-01"),
            (draft) => void (draft.kev!.responses.recommendation.probabilities.BID = -0.1),
          ),
        ),
      ),
    ).toEqual(["kev.responses.recommendation.probabilities.BID"]);
  });

  it("sol-v0.1.0 의 임계값(75/50/0.70)을 바꾸면 거절한다 — 바꾸려면 algorithmVersion 을 올린다", () => {
    const changed = withPatch(
      buildInput("FX-01"),
      (draft) => void (draft.config.thresholds.bid = 70),
    );
    expect(failure(() => analysisInputSchema.parse(changed))).toEqual(["config.thresholds"]);
    const otherVersion = withPatch(
      buildInput("FX-01"),
      (draft) =>
        void ((draft.config as { algorithmVersion: string }).algorithmVersion = "sol-v0.2.0"),
    );
    expect(failure(() => analysisInputSchema.parse(otherVersion))).toEqual([
      "config.algorithmVersion",
    ]);
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(buildInput("FX-01"), (draft) => void (draft.config.today = "2026/10/16")),
        ),
      ),
    ).toEqual(["config.today"]);
  });

  it("회사 프로필: 면허 status 는 HELD/NOT_HELD, 실적 금액은 KRW 문자열, 인력 fte 는 0~1", () => {
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(
            buildInput("FX-01"),
            (draft) => void ((draft.profile.licenses[0] as { status: string }).status = "UNKNOWN"),
          ),
        ),
      ),
    ).toEqual(["profile.licenses.0.status"]);
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(
            buildInput("FX-01"),
            (draft) => void (draft.profile.pastProjects[0].amountKrw = "12억"),
          ),
        ),
      ),
    ).toEqual(["profile.pastProjects.0.amountKrw"]);
    expect(
      failure(() =>
        analysisInputSchema.parse(
          withPatch(
            buildInput("FX-01"),
            (draft) => void (draft.team.members[0].availability[0].fte = 1.5),
          ),
        ),
      ),
    ).toEqual(["team.members.0.availability.0.fte"]);
  });

  it("extraction·kev 는 null 을 허용하고(추출 실패·Kev 장애), 그 외 타입은 거절한다", () => {
    expect(
      analysisInputSchema.safeParse(buildInput("FX-01", { extraction: null, kev: null })).success,
    ).toBe(true);
    expect(
      failure(() => analysisInputSchema.parse({ ...buildInput("FX-01"), extraction: "none" })),
    ).toEqual(["extraction"]);
  });
});
