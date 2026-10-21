import "server-only";

import { createHash } from "node:crypto";

export type ProcurementMatchStage =
  "PLAN" | "PROCUREMENT_REQUEST" | "PRE_SPEC" | "NOTICE" | "OPENING" | "AWARD" | "CONTRACT";

export interface OfficialOpportunityReference {
  providerNamespace: string;
  noticeId: string;
  agencyId: string;
  amendment?: string;
  stage?: ProcurementMatchStage;
  evidence: { sourceUrl: string; quote: string };
}

export interface OpportunityMatchInput {
  sourceFamily: string;
  sourceKey: string;
  partitionKey?: string;
  providerNamespace: string | null;
  noticeId: string | null;
  amendment: string | null;
  agency: { id: string | null; name: string | null };
  title: string | null;
  stage: ProcurementMatchStage;
  publishedAt: string | null;
  deadlineAt: string | null;
  amount: { value: string; type: string; unit: string; currency: string } | null;
  sourceUrl: string | null;
  attachmentHashes: readonly string[];
  isDemo: boolean;
  officialCrossReferences?: readonly OfficialOpportunityReference[];
  rebidOf?: string | null;
  lot?: string | null;
  year?: string | null;
  round?: string | null;
  provisional?: boolean;
}

export interface OpportunityMatchEvidence {
  field: string;
  left: string;
  right: string;
  sourceUrl?: string;
  quote?: string;
}

export interface OpportunityMatchResult {
  outcome: "CONFIRMED_DUPLICATE" | "CANDIDATE" | "DISTINCT";
  relationship:
    "SAME_SOURCE_RECORD" | "SOURCE_COPY" | "POSSIBLE_DUPLICATE" | "STAGE_LINK" | "SEPARATE";
  reasons: string[];
  evidence: OpportunityMatchEvidence[];
  policyVersion: string;
  inputHash: string;
}

const POLICY_VERSION = "opportunity-match-v0.1";

const identityValue = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "-" ? trimmed : null;
};
const hasEqualIdentity = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => identityValue(left) !== null && identityValue(left) === identityValue(right);

export const normalizeOpportunityTitle = (title: string | null): string =>
  (title ?? "")
    .normalize("NFKC")
    .replace(
      /^(?:\s*(?:\[(?:정정|변경|취소)(?:공고)?\]|\((?:정정|변경|취소)(?:공고)?\)|(?:정정|변경|취소)공고\s*:))+/u,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");

const hasSimilarTitle = (left: string, right: string): boolean => {
  const gramsOf = (title: string) => {
    const compact = title.replace(/\s/gu, "");
    return new Set(
      Array.from({ length: Math.max(0, compact.length - 2) }, (_, index) =>
        compact.slice(index, index + 3),
      ),
    );
  };
  if (left.length < 8 || right.length < 8 || left === right) return false;
  const leftGrams = gramsOf(left);
  const rightGrams = gramsOf(right);
  const shared = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return (2 * shared) / (leftGrams.size + rightGrams.size) >= 0.7;
};

const hasOfficialReference = (
  source: OpportunityMatchInput,
  target: OpportunityMatchInput,
): OfficialOpportunityReference | undefined =>
  source.officialCrossReferences?.find(
    (reference) =>
      hasEqualIdentity(reference.providerNamespace, target.providerNamespace) &&
      hasEqualIdentity(reference.noticeId, target.noticeId) &&
      hasEqualIdentity(reference.agencyId, target.agency.id) &&
      (reference.amendment === undefined ||
        hasEqualIdentity(reference.amendment, target.amendment)) &&
      (reference.stage === undefined || reference.stage === target.stage) &&
      /^https?:\/\//u.test(reference.evidence.sourceUrl) &&
      reference.evidence.quote.trim().length > 0,
  );

const separateReason = (
  left: OpportunityMatchInput,
  right: OpportunityMatchInput,
): string | null => {
  if (
    identityValue(left.agency.id) &&
    identityValue(right.agency.id) &&
    left.agency.id !== right.agency.id
  ) {
    return "AGENCY_DIFFERS";
  }
  for (const field of ["lot", "year", "round"] as const) {
    if (identityValue(left[field]) && identityValue(right[field]) && left[field] !== right[field]) {
      return `${field.toUpperCase()}_DIFFERS`;
    }
  }
  const rebidTitle = /(?:\[|\(|^|\s)(?:재입찰|재공고)(?:\]|\)|\s|$)/u;
  const hasRebidMismatch =
    Boolean(identityValue(left.rebidOf)) !== Boolean(identityValue(right.rebidOf)) ||
    rebidTitle.test(left.title ?? "") !== rebidTitle.test(right.title ?? "");
  if (
    hasRebidMismatch ||
    (identityValue(left.rebidOf) && identityValue(right.rebidOf) && left.rebidOf !== right.rebidOf)
  ) {
    return "REBID_SEPARATE_NOTICE";
  }
  return null;
};

const separateEvidence = (
  reason: string,
  left: OpportunityMatchInput,
  right: OpportunityMatchInput,
): OpportunityMatchEvidence[] => {
  if (reason === "AGENCY_DIFFERS") {
    return [{ field: "agencyId", left: left.agency.id ?? "", right: right.agency.id ?? "" }];
  }
  if (reason === "REBID_SEPARATE_NOTICE") {
    return [
      { field: "rebidOf", left: left.rebidOf ?? "", right: right.rebidOf ?? "" },
      { field: "title", left: left.title ?? "", right: right.title ?? "" },
    ];
  }
  const field = reason.replace("_DIFFERS", "").toLowerCase() as "lot" | "year" | "round";
  return [{ field, left: left[field] ?? "", right: right[field] ?? "" }];
};

const similarityEvidence = (
  left: OpportunityMatchInput,
  right: OpportunityMatchInput,
): { reasons: string[]; evidence: OpportunityMatchEvidence[] } => {
  const leftTitle = normalizeOpportunityTitle(left.title);
  const rightTitle = normalizeOpportunityTitle(right.title);
  const sharedHashes = left.attachmentHashes.filter(
    (hash) => hash && right.attachmentHashes.includes(hash),
  );
  const fields = [
    { field: "title", left: leftTitle, right: rightTitle, reason: "NORMALIZED_TITLE_MATCH" },
    { field: "agencyId", left: left.agency.id, right: right.agency.id, reason: "AGENCY_MATCH" },
    {
      field: "agencyName",
      left: left.agency.name,
      right: right.agency.name,
      reason: "AGENCY_NAME_MATCH",
    },
    {
      field: "publishedAt",
      left: left.publishedAt,
      right: right.publishedAt,
      reason: "PUBLISHED_AT_MATCH",
    },
    {
      field: "deadlineAt",
      left: left.deadlineAt,
      right: right.deadlineAt,
      reason: "DEADLINE_MATCH",
    },
    {
      field: "sourceUrl",
      left: left.sourceUrl,
      right: right.sourceUrl,
      reason: "SOURCE_URL_MATCH",
    },
  ].filter((item) => hasEqualIdentity(item.left, item.right));
  const sameAmount =
    left.amount !== null &&
    right.amount !== null &&
    left.amount.value === right.amount.value &&
    left.amount.type === right.amount.type &&
    left.amount.unit === right.amount.unit &&
    left.amount.currency === right.amount.currency;
  const similarTitle = hasSimilarTitle(leftTitle, rightTitle);
  return {
    reasons: [
      ...fields.map(({ reason }) => reason),
      ...(similarTitle ? ["SIMILAR_TITLE"] : []),
      ...(sameAmount ? ["COMPARABLE_AMOUNT_MATCH"] : []),
      ...(sharedHashes.length > 0 ? ["ATTACHMENT_HASH_MATCH"] : []),
    ],
    evidence: [
      ...fields.map(({ field, left: leftValue, right: rightValue }) => ({
        field,
        left: leftValue ?? "",
        right: rightValue ?? "",
      })),
      ...(similarTitle ? [{ field: "similarTitle", left: leftTitle, right: rightTitle }] : []),
      ...(sameAmount
        ? [
            {
              field: "amount",
              left: JSON.stringify(left.amount),
              right: JSON.stringify(right.amount),
            },
          ]
        : []),
      ...sharedHashes.map((hash) => ({ field: "attachmentHash", left: hash, right: hash })),
    ],
  };
};

/** This decision never rewrites source records, analysis targets, or final human decisions. */
export const matchProcurementOpportunities = (
  left: OpportunityMatchInput,
  right: OpportunityMatchInput,
): OpportunityMatchResult => {
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ policyVersion: POLICY_VERSION, left, right }))
    .digest("hex");
  const result = (
    outcome: OpportunityMatchResult["outcome"],
    relationship: OpportunityMatchResult["relationship"],
    reasons: string[],
    evidence: OpportunityMatchEvidence[] = [],
  ): OpportunityMatchResult => ({
    outcome,
    relationship,
    reasons,
    evidence,
    policyVersion: POLICY_VERSION,
    inputHash,
  });

  if (left.isDemo !== right.isDemo)
    return result(
      "DISTINCT",
      "SEPARATE",
      ["DEMO_LIVE_BOUNDARY"],
      [{ field: "isDemo", left: String(left.isDemo), right: String(right.isDemo) }],
    );
  const distinctReason = separateReason(left, right);
  if (distinctReason)
    return result(
      "DISTINCT",
      "SEPARATE",
      [distinctReason],
      separateEvidence(distinctReason, left, right),
    );

  const reference = hasOfficialReference(left, right) ?? hasOfficialReference(right, left);
  const referenceEvidence: OpportunityMatchEvidence[] = reference
    ? [
        {
          field: "officialCrossReference",
          left: reference.noticeId,
          right: reference.noticeId,
          ...reference.evidence,
        },
      ]
    : [];
  const similar = similarityEvidence(left, right);
  const hasTitleMatch =
    similar.reasons.includes("NORMALIZED_TITLE_MATCH") || similar.reasons.includes("SIMILAR_TITLE");
  const hasAgencyMatch =
    similar.reasons.includes("AGENCY_MATCH") || similar.reasons.includes("AGENCY_NAME_MATCH");
  const hasCandidateSignal =
    hasTitleMatch ||
    (hasAgencyMatch &&
      (similar.reasons.includes("SOURCE_URL_MATCH") ||
        similar.reasons.includes("ATTACHMENT_HASH_MATCH")));
  const isProvisional =
    left.provisional ||
    right.provisional ||
    !identityValue(left.noticeId) ||
    !identityValue(right.noticeId);

  if (left.stage !== right.stage) {
    if (reference && !isProvisional) {
      return result("DISTINCT", "STAGE_LINK", ["OFFICIAL_STAGE_REFERENCE"], referenceEvidence);
    }
    return hasCandidateSignal
      ? result(
          "CANDIDATE",
          "STAGE_LINK",
          ["STAGE_LINK_CANDIDATE", ...similar.reasons],
          similar.evidence,
        )
      : result("DISTINCT", "SEPARATE", ["STAGE_DIFFERS"]);
  }

  if (isProvisional) {
    return hasCandidateSignal
      ? result(
          "CANDIDATE",
          "POSSIBLE_DUPLICATE",
          ["PROVISIONAL_IDENTITY", ...similar.reasons],
          similar.evidence,
        )
      : result("DISTINCT", "SEPARATE", ["PROVISIONAL_IDENTITY"]);
  }

  const sameNotice = hasEqualIdentity(left.noticeId, right.noticeId);
  const sameAgency = hasEqualIdentity(left.agency.id, right.agency.id);
  const sameNamespace = hasEqualIdentity(left.providerNamespace, right.providerNamespace);
  const identityEvidence: OpportunityMatchEvidence[] = [
    {
      field: "providerNamespace",
      left: left.providerNamespace ?? "",
      right: right.providerNamespace ?? "",
    },
    { field: "noticeId", left: left.noticeId ?? "", right: right.noticeId ?? "" },
    { field: "agencyId", left: left.agency.id ?? "", right: right.agency.id ?? "" },
    { field: "amendment", left: left.amendment ?? "", right: right.amendment ?? "" },
  ];
  if (
    sameNotice &&
    sameAgency &&
    left.sourceFamily === right.sourceFamily &&
    hasEqualIdentity(left.sourceKey, right.sourceKey) &&
    (left.partitionKey ?? null) === (right.partitionKey ?? null)
  ) {
    return result(
      "CONFIRMED_DUPLICATE",
      "SAME_SOURCE_RECORD",
      ["SAME_SOURCE_NOTICE_REVISION"],
      identityEvidence,
    );
  }
  if (
    reference ||
    (sameNamespace && sameNotice && sameAgency && hasEqualIdentity(left.amendment, right.amendment))
  ) {
    return result(
      "CONFIRMED_DUPLICATE",
      "SOURCE_COPY",
      [reference ? "OFFICIAL_CROSS_REFERENCE" : "OFFICIAL_IDENTITY_MATCH"],
      reference ? referenceEvidence : identityEvidence,
    );
  }
  if (hasCandidateSignal || (sameNamespace && sameNotice && sameAgency)) {
    return result(
      "CANDIDATE",
      "POSSIBLE_DUPLICATE",
      [
        ...(sameNamespace && sameNotice && sameAgency ? ["AMENDMENT_UNCONFIRMED"] : []),
        ...similar.reasons,
      ],
      similar.evidence,
    );
  }
  return result("DISTINCT", "SEPARATE", ["NO_IDENTITY_EVIDENCE"], similar.evidence);
};
