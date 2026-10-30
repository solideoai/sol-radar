import "server-only";
import { z } from "zod";

// 규칙 엔진의 입력 계약(단일 원천, ADR-016). 정본은 docs/15 §2(FieldState·EvidenceRef·CompanyEvidenceRef),
// docs/03 §4.1(RequirementExtraction)·§5.7(KevAssist), docs/05 §4.4(CompanyProfile), docs/08 §7(AnalysisInput).
// 잘못된 입력(필수 누락·타입 오류·범위 밖 점수·알 수 없는 state)은 여기서 거절한다. 값을 "고쳐서 살리지" 않는다.

export const ALGORITHM_VERSION = "sol-v0.2.1" as const;
// 저장된 스냅샷을 읽을 때(가정 재계산·추천 분석·인력 배치·재채점) 받는 버전. 계산은 늘 현재 규칙이다.
// sol-v0.2.0 은 입력 모양·가중치·임계값이 같고 자격 판정(사전 별칭·면허제한 여러 행)만 다르다.
export const READABLE_ALGORITHM_VERSIONS = ["sol-v0.2.0", ALGORITHM_VERSION] as const;
export const ANALYSIS_INPUT_SCHEMA_VERSION = "analysis-input/v0.1" as const;

// 가중치·임계값은 algorithm_version 에 묶인 config 다(08 §2·§5.2·§5.3). 값을 바꾸려면 버전을 올리고
// 이전 run 은 고치지 않고 새 run 을 만든다. 이 상수가 현재 버전의 정본이고 스키마가 같은지 검사한다.
// sol-v0.2.0(ADR-071)은 가중치·임계값이 v0.1.0 과 같고 빈 값 처리·기술 항목 거르기만 바뀌었다(08 §3).
// sol-v0.2.1(ADR-071 개정)은 점수가 같고 자격 판정만 바뀌었다: 자격 사전 별칭(중소기업·소상공인 확인서 등)과
// 면허제한 여러 행을 모두 보유하면 충족(08 §5.1).
export const SCORING_CONFIG = {
  algorithmVersion: ALGORITHM_VERSION,
  thresholds: { bid: 75, watch: 50, kevTau: 0.7 },
} as const;

const isoDatetime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
// 기간 경계는 날짜("2026-12-01") 또는 시각(ISO8601) 둘 다 받는다. scoring.model 의 availableFte 가 Date.parse 로 읽는다.
const dateLike = z.union([isoDate, isoDatetime]);
const krwString = z.string().regex(/^\d+$/, "KRW 정수 문자열이어야 한다");
const unitInterval = z.number().min(0).max(1);

export const fieldStateSchema = z.enum(["KNOWN", "UNKNOWN", "NOT_APPLICABLE", "CONFLICTED"]);
export type FieldState = z.infer<typeof fieldStateSchema>;

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
  fetchedAt: isoDatetime,
  match: z.enum(["EXACT", "NORMALIZED", "FUZZY", "FAILED"]).optional(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const companyEvidenceRefSchema = z.object({
  profileRevision: z.number().int().positive(),
  kind: z.enum(["LICENSE", "INDUSTRY_CODE", "TECHNOLOGY", "PROJECT", "STAFF", "FINANCIAL"]),
  recordKey: z.string().min(1),
  documentId: z.string().nullable(),
  quotedText: z.string().nullable(),
});
export type CompanyEvidenceRef = z.infer<typeof companyEvidenceRefSchema>;

// 15 §2 상태 규칙: KNOWN 이면 value 가 있고 근거가 1개 이상, 아니면 value 는 null 이다.
export function extractedFieldSchema<T extends z.ZodType>(value: T) {
  return z
    .object({
      value: value.nullable(),
      state: fieldStateSchema,
      evidence: z.array(evidenceRefSchema),
      note: z.string().max(200).optional(),
    })
    .superRefine((raw, ctx) => {
      // 제네릭 T 때문에 superRefine 의 인자 타입이 좁혀지지 않아 여기서만 넓은 타입으로 본다.
      const field = raw as { value: unknown; state: FieldState; evidence: unknown[] };
      if (field.state === "KNOWN") {
        if (field.value === null)
          ctx.addIssue({
            code: "custom",
            path: ["value"],
            message: "KNOWN 이면 value 가 있어야 한다",
          });
        if (field.evidence.length === 0)
          ctx.addIssue({
            code: "custom",
            path: ["evidence"],
            message: "KNOWN 이면 근거가 1개 이상이어야 한다",
          });
      } else if (field.value !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: `${field.state} 이면 value 는 null 이어야 한다`,
        });
      }
    });
}
export type ExtractedField<T> = {
  value: T | null;
  state: FieldState;
  evidence: EvidenceRef[];
  note?: string;
};

export const qualificationRequirementSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["LICENSE", "CERTIFICATION", "REGISTRATION", "OTHER"]),
  mandatory: z.boolean(),
  detail: z.string().optional(),
  code: z.string().nullable(),
});
export type QualificationRequirement = z.infer<typeof qualificationRequirementSchema>;

export const pastPerformanceRequirementSchema = z.object({
  description: z.string().min(1),
  minAmountKrw: krwString.optional(),
  minCount: z.number().int().nonnegative().optional(),
  withinYears: z.number().int().nonnegative().optional(),
  mandatory: z.boolean(),
});

export const staffingRequirementSchema = z.object({
  role: z.string().min(1),
  minCount: z.number().int().nonnegative().optional(),
  grade: z.string().optional(),
  condition: z.string().optional(),
  mandatory: z.boolean(),
});
export type StaffingRequirement = z.infer<typeof staffingRequirementSchema>;

export const requirementExtractionSchema = z.object({
  schemaVersion: z.literal("requirement-extraction/v0.1"),
  bidId: z.string().min(1),
  revisionId: z.string().min(1),
  model: z.object({
    provider: z.enum(["mock", "local", "hosted"]),
    name: z.string(),
    promptVersion: z.string(),
    promptHash: z.string(),
    temperature: z.number(),
    extractedAt: isoDatetime,
    latencyMs: z.number().nonnegative(),
    retries: z.number().int().min(0).max(1),
  }),
  summary: extractedFieldSchema(z.string()),
  projectType: extractedFieldSchema(z.enum(["SI", "AX", "MAINTENANCE", "CONSULTING", "OTHER"])),
  domain: extractedFieldSchema(z.string()),
  requiredSkills: extractedFieldSchema(z.array(z.string())),
  preferredSkills: extractedFieldSchema(z.array(z.string())),
  qualifications: extractedFieldSchema(z.array(qualificationRequirementSchema)),
  pastPerformance: extractedFieldSchema(z.array(pastPerformanceRequirementSchema)),
  staffing: extractedFieldSchema(z.array(staffingRequirementSchema)),
  budgetKrw: extractedFieldSchema(krwString),
  deadlineAt: extractedFieldSchema(isoDatetime),
  contractMethod: extractedFieldSchema(z.string()),
  restrictions: extractedFieldSchema(z.array(z.string())),
  submission: extractedFieldSchema(z.string()),
  injectionSuspected: z.boolean(),
  warnings: z.array(z.string()),
});
export type RequirementExtraction = z.infer<typeof requirementExtractionSchema>;

export const structuredRequirementKindSchema = z.enum([
  "LICENSE_LIMIT",
  "PERMITTED_INDUSTRY",
  "PARTICIPATION_REGION",
  "REGIONAL_JOINT_CONTRACT",
]);
export type StructuredRequirementKind = z.infer<typeof structuredRequirementKindSchema>;

// 04 bid_structured_requirements 한 행. 담당자 필드는 value 에 넣지 않는다(15 §3).
export const structuredRequirementSchema = z.object({
  kind: structuredRequirementKindSchema,
  seq: z.number().int().nonnegative(),
  code: z.string().nullable(),
  name: z.string().nullable(),
  value: z.record(z.string(), z.unknown()),
  sourceOperation: z.string().min(1),
});
export type StructuredRequirement = z.infer<typeof structuredRequirementSchema>;

export const bidStageSchema = z.enum(["PLAN", "PRE_SPEC", "NOTICE"]);

// 15 §3 NormalizedBid.auxLookup: live 수집의 보조 조회 3종(면허제한·참가가능지역·e발주 첨부) 결과(07 §2.2).
// OK 가 아니면 구조화 자격이 비어 있어도 "제한 없음"이 아니라 "모름"이다. 규칙 엔진은 NEEDS_REVIEW 로 둔다.
export const auxLookupStatusSchema = z.enum(["OK", "FAILED", "SKIPPED_QUOTA"]);
export const auxLookupSchema = z.object({
  status: auxLookupStatusSchema,
  /** 결과를 받지 못한 보조 조회의 registryKey. OK 면 빈 배열 */
  failed: z.array(z.string()),
});
export type AuxLookup = z.infer<typeof auxLookupSchema>;

// NormalizedBid(15 §3) 가운데 규칙 엔진이 읽는 요약. revisionId·fetchedAt 은 API_FIELD 근거(EvidenceRef)를
// 만들 때 필요해서 필수다. attachmentsIncomplete 는 첨부 다운로드·파싱 실패를 호출자가 알려 주는 값(03 §5.7 과 같은 이름).
export const normalizedBidSummarySchema = z.object({
  noticeId: z.string().optional(),
  revisionId: z.string().min(1),
  title: z.string().min(1),
  agency: z.string().nullable(),
  stage: bidStageSchema,
  budgetKrw: krwString.nullable(),
  deadlineAt: isoDatetime.nullable(),
  noticeDate: isoDatetime.nullable(),
  fetchedAt: isoDatetime,
  projectPeriod: z.object({ startsAt: dateLike, endsAt: dateLike }).nullable().optional(),
  structuredQualifications: z.array(structuredRequirementSchema),
  attachmentsIncomplete: z.boolean().optional(),
  // 보조 조회를 시도한 live revision 에만 있다. fixture·보조 조회 전 revision 에는 없다(없으면 검사를 만들지 않는다)
  auxLookup: auxLookupSchema.optional(),
});
export type NormalizedBidSummary = z.infer<typeof normalizedBidSummarySchema>;

// 공개 자료 출처 id 목록. 없으면 키 자체가 없다.
const sourceIds = z.array(z.string().min(1)).optional();

export const licenseStatusSchema = z.enum(["HELD", "NOT_HELD"]);

// 05 §4.4 CompanyProfile 의 스냅샷. pastProjects 는 08 §3.2 의사코드가 읽는 모양(id·domain·amountKrw·completedAt·evidenceRef)이다.
export const companyProfileSchema = z.object({
  revision: z.number().int().positive(),
  name: z.string().optional(),
  isDemo: z.boolean(),
  technologies: z.array(
    z.object({
      name: z.string().min(1),
      level: z.enum(["BASIC", "INTERMEDIATE", "EXPERT"]).optional(),
      yearsOfExperience: z.number().nonnegative().optional(),
      sourceIds,
    }),
  ),
  technologiesComplete: z.boolean(),
  licenses: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      status: licenseStatusSchema,
      validUntil: isoDate.optional(),
      sourceIds,
    }),
  ),
  industryCodes: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      status: licenseStatusSchema,
      sourceIds,
    }),
  ),
  pastProjects: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      domain: z.string().min(1),
      // 공개 자료에 없으면 null. 점수는 중립값을 쓴다(금액비 0.5, 최근성 0.5 — sol-v0.2.0).
      amountKrw: krwString.nullable(),
      completedAt: isoDate.nullable(),
      evidenceRef: z.string().nullable().optional(),
      note: z.string().optional(),
      sourceIds,
    }),
  ),
  financials: z
    .object({
      fiscalYear: z.number().int(),
      annualRevenueKrw: krwString.optional(),
      capitalKrw: krwString.optional(),
      employeeCount: z.number().int().nonnegative().optional(),
      creditRating: z.string().optional(),
      maxContractKrw: krwString.optional(),
      note: z.string().optional(),
      sourceIds,
    })
    .nullable(),
  preferences: z
    .object({
      agencies: z.array(z.string()),
      agencyTypes: z.array(z.string()),
      domains: z.array(z.string()),
      excludedDomains: z.array(z.string()),
      excludedKeywords: z.array(z.string()),
    })
    .nullable(),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

// scoring.model 의 ScoringTeam 과 같은 모양(토큰 입력 계약). 이름·성별·사진은 넣지 않는다(08 §9).
const capacityPeriodFields = { startsAt: dateLike, endsAt: dateLike };
export const scoringTeamSchema = z.object({
  members: z.array(
    z.object({
      personId: z.string().min(1),
      role: z.string(),
      grade: z.string().nullable(),
      skills: z.array(z.string()),
      availability: z.array(z.object({ ...capacityPeriodFields, fte: unitInterval })),
    }),
  ),
  assignments: z.array(
    z.object({
      personId: z.string().min(1),
      ...capacityPeriodFields,
      allocationPercent: z.number().min(0).max(100),
    }),
  ),
  asOf: isoDatetime,
});
export type ScoringTeamInput = z.infer<typeof scoringTeamSchema>;

export const recommendationSchema = z.enum(["BID", "WATCH", "NO_BID"]);
export type Recommendation = z.infer<typeof recommendationSchema>;

export const kevQuestionSetVersionSchema = z.enum(["kev-qs/v0.1", "kev-qs/v0.2"]);

// fixtures/kev/FX-xx.json 의 wire 형식(03 §5.4). 확률은 0~1, fit.score 는 0부터 세는 index(0~4).
export const kevMockResponseSchema = z.object({
  schemaVersion: z.literal("kev-mock/v0.1").optional(),
  fixtureId: z.string().optional(),
  provider: z.enum(["mock", "local", "hosted"]),
  model: z.string().nullable().optional(),
  questionSetVersion: kevQuestionSetVersionSchema,
  requestId: z.string().nullable().optional(),
  responses: z.object({
    recommendation: z.object({
      choice: recommendationSchema,
      confidence: unitInterval,
      probabilities: z.object({ BID: unitInterval, WATCH: unitInterval, NO_BID: unitInterval }),
    }),
    mandatoryRisk: z.object({ noul: unitInterval }),
    needsHumanReview: z.object({ noul: unitInterval }),
    fit: z.object({
      score: z.number().min(0).max(4),
      legend: z.record(z.string(), z.string()),
      probabilities: z.record(z.string(), unitInterval),
      confidence: unitInterval,
    }),
  }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
  latency_ms: z.number().nonnegative().optional(),
});
export type KevMockResponse = z.infer<typeof kevMockResponseSchema>;

export const scoringConfigSchema = z
  .object({
    algorithmVersion: z.enum(READABLE_ALGORITHM_VERSIONS),
    thresholds: z.object({ bid: z.number(), watch: z.number(), kevTau: z.number() }),
    today: isoDate,
  })
  .superRefine((config, ctx) => {
    const fixed = SCORING_CONFIG.thresholds;
    const given = config.thresholds;
    if (given.bid !== fixed.bid || given.watch !== fixed.watch || given.kevTau !== fixed.kevTau)
      ctx.addIssue({
        code: "custom",
        path: ["thresholds"],
        message: `${ALGORITHM_VERSION} 의 임계값은 ${fixed.bid}/${fixed.watch}/${fixed.kevTau} 로 고정이다. 바꾸려면 algorithmVersion 을 올린다`,
      });
  });
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const aiUnavailableReasonSchema = z.enum([
  "AI_UNAVAILABLE",
  "EXTRACTION_FAILED",
  "QWEN_UNAVAILABLE",
]);
export type AiUnavailableReason = z.infer<typeof aiUnavailableReasonSchema>;

export const analysisInputSchema = z.object({
  schemaVersion: z.literal(ANALYSIS_INPUT_SCHEMA_VERSION),
  bid: normalizedBidSummarySchema,
  extraction: requirementExtractionSchema.nullable(),
  profile: companyProfileSchema,
  team: scoringTeamSchema,
  kev: kevMockResponseSchema.nullable(),
  config: scoringConfigSchema,
  // 추출이 없거나 gateway 가 죽어 규칙만 계산할 때 호출자가 주는 사유(03 §8). 있으면 status=PARTIAL.
  aiUnavailableReason: aiUnavailableReasonSchema.nullable().optional(),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
