import "server-only";

import { createHash } from "node:crypto";

export type RelevanceChannel = "title" | "officialIndustry" | "body" | "attachment";
export type ProcurementRelevanceState =
  "UNCLASSIFIED" | "CANDIDATE" | "RELEVANT" | "LOW_RELEVANCE" | "NEEDS_REVIEW";
export type ProcurementCategory =
  "AI_AX" | "SI_SW" | "CLOUD" | "DATA" | "SECURITY" | "DIGITAL_TWIN" | "OTHER";
export type ProcurementRelevanceTag = "smartcity" | "BIM" | "ISP" | "ISMP" | "maintenance";

export interface RelevanceReviewEvidence {
  channel: RelevanceChannel;
  documentId?: string;
  quote: string;
  start: number;
  end: number;
  polarity: "POSITIVE" | "UNRELATED";
  category: ProcurementCategory;
  reviewer: "human" | "verified_classifier";
  verificationId: string;
}

export interface ProcurementRelevanceInput {
  title?: string | null;
  body?: string | null;
  officialIndustries?: readonly { code: string; name: string }[];
  attachments?: readonly { id: string; text: string | null }[];
  reviewedEvidence?: readonly RelevanceReviewEvidence[];
}

export interface ProcurementRelevanceEvidence {
  channel: RelevanceChannel;
  documentId: string | null;
  quote: string;
  start: number;
  end: number;
  polarity: "POSITIVE" | "UNRELATED";
  category: ProcurementCategory;
  origin: "rule" | "human" | "verified_classifier";
  verificationId: string | null;
}

export interface ProcurementRelevanceResult {
  state: ProcurementRelevanceState;
  score: number | null;
  categories: ProcurementCategory[];
  tags: ProcurementRelevanceTag[];
  evidence: ProcurementRelevanceEvidence[];
  missingChannels: RelevanceChannel[];
  rejectedEvidence: { index: number; reason: string }[];
  policyVersion: string;
  inputHash: string;
}

const POLICY_VERSION = "relevance-v0.1";
const CHANNEL_POINTS: Record<RelevanceChannel, number> = {
  title: 30,
  officialIndustry: 20,
  body: 25,
  attachment: 25,
};
const CHANNELS = Object.keys(CHANNEL_POINTS) as RelevanceChannel[];

interface Material {
  channel: RelevanceChannel;
  documentId: string | null;
  text: string;
}

const CATEGORY_RULES: { category: ProcurementCategory; expression: RegExp }[] = [
  {
    category: "AI_AX",
    expression: /(?<![a-z0-9_])(?:AI|AX|LLM|RAG)(?![a-z0-9_])|인공지능|머신러닝|딥러닝/giu,
  },
  {
    category: "SI_SW",
    expression:
      /(?<![a-z0-9_])(?:SI|SW)(?![a-z0-9_])|정보\s*시스템|소프트웨어|시스템\s*통합|정보화|전산\s*시스템|정보\s*전략\s*계획|(?<![a-z0-9_])(?:ISP|ISMP)(?![a-z0-9_])/giu,
  },
  {
    category: "CLOUD",
    expression: /클라우드|(?<![a-z0-9_])(?:cloud|SaaS|PaaS|IaaS)(?![a-z0-9_])/giu,
  },
  {
    category: "DATA",
    expression: /데이터\s*(?:플랫폼|분석|관리|처리|웨어하우스|레이크)|빅데이터|데이터베이스/giu,
  },
  { category: "SECURITY", expression: /정보\s*보안|정보\s*보호|사이버\s*보안|네트워크\s*보안/giu },
  {
    category: "DIGITAL_TWIN",
    expression: /디지털\s*트윈|스마트\s*시티|(?<![a-z0-9_])(?:BIM|digital\s+twin)(?![a-z0-9_])/giu,
  },
];
const TAG_RULES: { tag: ProcurementRelevanceTag; expression: RegExp }[] = [
  { tag: "smartcity", expression: /스마트\s*시티|smart\s*city/iu },
  { tag: "BIM", expression: /(?<![a-z0-9_])BIM(?![a-z0-9_])/iu },
  { tag: "ISP", expression: /(?<![a-z0-9_])ISP(?![a-z0-9_])|정보\s*전략\s*계획/iu },
  { tag: "ISMP", expression: /(?<![a-z0-9_])ISMP(?![a-z0-9_])/iu },
  { tag: "maintenance", expression: /유지\s*보수|유지\s*관리|maintenance/iu },
];

const materialsOf = (input: ProcurementRelevanceInput): Material[] =>
  [
    { channel: "title" as const, documentId: null, text: input.title ?? "" },
    { channel: "body" as const, documentId: null, text: input.body ?? "" },
    ...(input.officialIndustries ?? []).map(({ code, name }) => ({
      channel: "officialIndustry" as const,
      documentId: code,
      text: name,
    })),
    ...(input.attachments ?? []).map(({ id, text }) => ({
      channel: "attachment" as const,
      documentId: id,
      text: text ?? "",
    })),
  ].filter(({ text }) => text.trim().length > 0);

const sentenceAt = (text: string, start: number, end: number): string => {
  const prefix = text.slice(0, start);
  const previousBoundary = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("\n"));
  const suffixBoundary = text.slice(end).search(/[.\n]/u);
  return text.slice(previousBoundary + 1, suffixBoundary < 0 ? text.length : end + suffixBoundary);
};

const ruleEvidenceOf = (material: Material): ProcurementRelevanceEvidence[] =>
  CATEGORY_RULES.flatMap(({ category, expression }) =>
    [...material.text.matchAll(expression)].flatMap((match) => {
      const start = match.index;
      const end = start + match[0].length;
      // Excluded work is not positive channel evidence merely because it names a technology.
      if (
        /포함되지|해당하지|제외(?:한다|된다|됨|대상)|아니(?:다|며|므로)/u.test(
          sentenceAt(material.text, start, end),
        )
      ) {
        return [];
      }
      return [
        {
          channel: material.channel,
          documentId: material.documentId,
          quote: match[0],
          start,
          end,
          polarity: "POSITIVE" as const,
          category,
          origin: "rule" as const,
          verificationId: null,
        },
      ];
    }),
  );

const reviewRejection = (
  review: RelevanceReviewEvidence,
  material: Material | undefined,
): string | null => {
  if (!material) return "MATERIAL_UNAVAILABLE";
  if (!review.verificationId.trim()) return "VERIFICATION_REQUIRED";
  if (
    !Number.isInteger(review.start) ||
    !Number.isInteger(review.end) ||
    review.start < 0 ||
    review.end <= review.start ||
    review.end > material.text.length ||
    material.text.slice(review.start, review.end) !== review.quote
  )
    return "QUOTE_MISMATCH";
  if (review.polarity === "POSITIVE" && review.category === "OTHER")
    return "RELATED_CATEGORY_REQUIRED";
  if (
    review.polarity === "UNRELATED" &&
    (review.channel === "title" ||
      review.channel === "officialIndustry" ||
      review.quote.trim() !== material.text.trim())
  )
    return "FULL_SCOPE_REVIEW_REQUIRED";
  return null;
};

const stateOf = (score: number | null, hasUnrelatedReview: boolean): ProcurementRelevanceState => {
  if (score !== null && score > 0 && hasUnrelatedReview) return "NEEDS_REVIEW";
  if (score !== null && score >= 50) return "RELEVANT";
  if (score !== null && score > 0) return "CANDIDATE";
  return hasUnrelatedReview ? "LOW_RELEVANCE" : "UNCLASSIFIED";
};

/** Reviewed model evidence must already have passed the upstream semantic verifier. */
export const classifyProcurementRelevance = (
  input: ProcurementRelevanceInput,
): ProcurementRelevanceResult => {
  const materials = materialsOf(input);
  const reviews = (input.reviewedEvidence ?? []).map((review, index) => ({
    review,
    index,
    reason: reviewRejection(
      review,
      materials.find(
        (material) =>
          material.channel === review.channel &&
          material.documentId === (review.documentId ?? null),
      ),
    ),
  }));
  const acceptedReviews: ProcurementRelevanceEvidence[] = reviews
    .filter(({ reason }) => reason === null)
    .map(({ review }) => ({
      channel: review.channel,
      documentId: review.documentId ?? null,
      quote: review.quote,
      start: review.start,
      end: review.end,
      polarity: review.polarity,
      category: review.category,
      origin: review.reviewer,
      verificationId: review.verificationId,
    }));
  const evidence = [...materials.flatMap(ruleEvidenceOf), ...acceptedReviews];
  const positive = evidence.filter(({ polarity }) => polarity === "POSITIVE");
  const positiveChannels = new Set(positive.map(({ channel }) => channel));
  const hasUnrelatedReview = acceptedReviews.some(({ polarity }) => polarity === "UNRELATED");
  const score =
    positive.length > 0 || hasUnrelatedReview
      ? CHANNELS.reduce(
          (total, channel) => total + (positiveChannels.has(channel) ? CHANNEL_POINTS[channel] : 0),
          0,
        )
      : null;
  const positiveMaterials = materials.filter((material) =>
    positive.some(
      (item) => item.channel === material.channel && item.documentId === material.documentId,
    ),
  );
  const categories = [...new Set(positive.map(({ category }) => category))];

  return {
    state: stateOf(score, hasUnrelatedReview),
    score,
    categories: categories.length > 0 ? categories : ["OTHER"],
    tags: TAG_RULES.filter(({ expression }) =>
      positiveMaterials.some(({ text }) => expression.test(text)),
    ).map(({ tag }) => tag),
    evidence,
    missingChannels: CHANNELS.filter(
      (channel) => !materials.some((material) => material.channel === channel),
    ),
    rejectedEvidence: reviews.flatMap(({ index, reason }) =>
      reason === null ? [] : [{ index, reason }],
    ),
    policyVersion: POLICY_VERSION,
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion: POLICY_VERSION,
          materials,
          reviews: input.reviewedEvidence ?? [],
        }),
      )
      .digest("hex"),
  };
};
