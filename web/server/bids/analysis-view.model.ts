import "server-only";
import { z } from "zod";
import {
  analysisStatusSchema,
  factorKeySchema,
  missingReasonSchema,
  needsReviewReasonSchema,
  qualificationOutcomeSchema,
  recommendationBasisSchema,
  recommendationSchema,
  requirementBasisSchema,
  requirementItemKindSchema,
  reviewFlagSchema,
  runModeSchema,
} from "./bid.model";

// 05 §4.5 AnalysisResult 를 화면용으로 옮긴 DTO. D16 변경 세 가지를 더한다.
// ① missingFactors 가 {factor, reason}[] ② ScoreFactor.missingReason ③ profileEvidence.type 에 INDUSTRY_CODE.

export const evidenceRefSchema = z.object({
  kind: z.enum(["TEXT", "API_FIELD"]).optional(),
  documentId: z.string().nullable(),
  revisionId: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  charStart: z.number().int().nonnegative().nullable().optional(),
  charEnd: z.number().int().nonnegative().nullable().optional(),
  apiField: z.string().optional(),
  apiSource: z.string().optional(),
  quotedText: z.string().min(1).max(300),
  sourceUrl: z.string().optional(),
  fetchedAt: z.string().min(1),
  match: z.enum(["EXACT", "NORMALIZED", "FUZZY", "FAILED"]).optional(),
});

export const companyEvidenceRefSchema = z.strictObject({
  profileRevision: z.number().int().positive(),
  kind: z.enum(["LICENSE", "INDUSTRY_CODE", "TECHNOLOGY", "PROJECT", "STAFF", "FINANCIAL"]),
  recordKey: z.string().min(1),
  documentId: z.string().nullable(),
  quotedText: z.string().nullable(),
});

export const scoreFactorViewSchema = z.strictObject({
  factor: factorKeySchema,
  rawValue: z.unknown(),
  normalized: z.number().nullable(),
  points: z.number(),
  maxPoints: z.number(),
  missing: z.boolean(),
  missingReason: missingReasonSchema.nullable(),
  evidence: z.array(evidenceRefSchema),
  note: z.string().nullable(),
});

export const qualificationCheckViewSchema = z.strictObject({
  id: z.string().min(1),
  requirementCode: z.string().nullable(),
  requirementName: z.string(),
  mandatory: z.boolean(),
  outcome: qualificationOutcomeSchema,
  reason: z.string(),
  reasonCode: needsReviewReasonSchema.nullable(),
  basis: requirementBasisSchema,
  evidence: z.array(evidenceRefSchema),
  profileEvidence: z.array(
    z.strictObject({
      type: z.enum(["LICENSE", "INDUSTRY_CODE", "PAST_PROJECT", "TECHNOLOGY", "FINANCIAL"]),
      ref: z.string(),
      label: z.string(),
    }),
  ),
  companyEvidence: z.array(companyEvidenceRefSchema),
  checkedAt: z.string().min(1),
});

export const requirementAssessmentViewSchema = z.strictObject({
  itemId: z.string().min(1),
  itemKind: requirementItemKindSchema,
  ruleStatus: qualificationOutcomeSchema,
  ruleReason: needsReviewReasonSchema.nullable(),
  basis: requirementBasisSchema,
  noticeEvidence: z.array(evidenceRefSchema),
  companyEvidence: z.array(companyEvidenceRefSchema),
  kev: z
    .strictObject({
      qid: z.string().min(1),
      distribution: z.record(qualificationOutcomeSchema, z.number()),
      label: qualificationOutcomeSchema,
    })
    .nullable(),
  flags: z.array(reviewFlagSchema),
});

export const KEV_DISCLAIMER =
  "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.";
export const SOL_SCORE_DISCLAIMER =
  "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.";

const legendFit = z.strictObject({
  score: z.number(),
  legend: z.record(z.string(), z.string()),
});

// 05 kev: 03 KevAssist + KevAssistV02Fields. enabled=false 면 값은 null.
export const kevViewSchema = z.strictObject({
  enabled: z.boolean(),
  provider: z.enum(["mock", "local", "hosted"]).nullable(),
  model: z.string().nullable(),
  questionSetVersion: z.enum(["kev-qs/v0.1", "kev-qs/v0.2"]).nullable(),
  suggestedOption: recommendationSchema.nullable(),
  probabilities: z.record(recommendationSchema, z.number()).nullable(),
  confidence: z.number().nullable(),
  mandatoryRisk: z.number().nullable(),
  needsHumanReview: z.number().nullable(),
  fit: legendFit.nullable(),
  scores: z.strictObject({ techFit: legendFit, perfRelevance: legendFit }).nullable(),
  risks: z
    .array(
      z.strictObject({
        qid: z.enum([
          "risk.schedule",
          "risk.staffing",
          "risk.scale",
          "risk.techGap",
          "risk.scopeAmbiguity",
        ]),
        probability: z.number(),
        overThreshold: z.boolean(),
      }),
    )
    .nullable(),
  calibration: z
    .strictObject({
      status: z.enum(["UNCALIBRATED", "CALIBRATED"]),
      datasetVersion: z.string().nullable(),
      threshold: z.number(),
      thresholdsVersion: z.string(),
    })
    .nullable(),
  stateTrace: z
    .strictObject({
      stateHash: z.string(),
      template: z.enum(["en.v0.2", "ko.v0.2"]),
      lines: z.array(
        z.strictObject({
          lineNo: z.number().int(),
          text: z.string(),
          noticeEvidence: z.array(evidenceRefSchema),
          companyEvidence: z.array(companyEvidenceRefSchema),
          itemIds: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
  latencyMs: z.number().nullable(),
  requestId: z.string().nullable(),
  disclaimer: z.literal(KEV_DISCLAIMER),
});

export const analysisViewSchema = z.strictObject({
  id: z.string().min(1),
  bidId: z.string().min(1),
  revisionId: z.string().min(1),
  revision: z.number().int().positive(),
  profileRevision: z.number().int().positive(),
  runMode: runModeSchema,
  status: analysisStatusSchema,
  solScore: z.number().min(0).max(100).nullable(),
  recommendation: recommendationSchema.nullable(),
  recommendationBasis: recommendationBasisSchema.nullable(),
  explanation: z.string().nullable(),
  qualification: z.strictObject({
    status: qualificationOutcomeSchema,
    checks: z.array(qualificationCheckViewSchema),
  }),
  requirementAssessments: z.array(requirementAssessmentViewSchema),
  scoreBreakdown: z.array(scoreFactorViewSchema),
  missingFactors: z.array(z.strictObject({ factor: factorKeySchema, reason: missingReasonSchema })),
  reviewFlags: z.array(reviewFlagSchema),
  injectionSuspected: z.boolean(),
  kev: kevViewSchema,
  fallbackReason: z.enum(["QWEN_UNAVAILABLE", "KEV_UNAVAILABLE"]).nullable(),
  evidence: z.array(evidenceRefSchema),
  model: z.strictObject({
    provider: z.enum(["mock", "local", "hosted"]),
    qwen: z
      .strictObject({ name: z.string(), promptVersion: z.string(), promptHash: z.string() })
      .nullable(),
    kev: z.strictObject({ model: z.string(), questionSetVersion: z.string() }).nullable(),
    algorithmVersion: z.string(),
  }),
  errorCode: z.string().nullable(),
  queuedAt: z.string().min(1),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  disclaimer: z.literal(SOL_SCORE_DISCLAIMER),
});

export type AnalysisView = z.infer<typeof analysisViewSchema>;
export type ScoreFactorView = z.infer<typeof scoreFactorViewSchema>;
export type QualificationCheckView = z.infer<typeof qualificationCheckViewSchema>;
export type KevView = z.infer<typeof kevViewSchema>;
export type RequirementAssessmentView = z.infer<typeof requirementAssessmentViewSchema>;
