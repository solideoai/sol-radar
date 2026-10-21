import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@/lib/database.types";
import { canonicalJson } from "./checksum";
import { normalizedBidSchema, type NormalizedBid } from "./normalized-bid.model";
import {
  matchProcurementOpportunities,
  normalizeOpportunityTitle,
  type OfficialOpportunityReference,
  type OpportunityMatchInput,
  type OpportunityMatchResult,
} from "./opportunity-match";
import { classifyProcurementRelevance, type ProcurementRelevanceInput } from "./relevance";

export interface ProcurementProjectionInput {
  bidId: string;
  revisionId: string;
  bid: NormalizedBid;
  rawPayload: Record<string, unknown>;
  officialCrossReferences?: readonly OfficialOpportunityReference[];
  relevanceMaterials?: Pick<ProcurementRelevanceInput, "body" | "attachments" | "reviewedEvidence">;
}

const SHORTLIST_LIMIT = 25;
const jsonOf = (value: unknown): Json => JSON.parse(JSON.stringify(value));
const hashOf = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const nonblank = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "-" ? value.trim() : null;
const nameKey = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const projectionError = (table: string, error: { code?: string }): Error =>
  new Error(
    `조달 투영: ${table} 실패 (${error.code && /^[A-Z0-9_]{1,40}$/u.test(error.code) ? error.code : "UNKNOWN"})`,
  );

const sourceFamilyOf = (bid: NormalizedBid): "G2B" | "KWATER" | "LH" | "KEPCO" | null => {
  if (bid.sourceMetadata) return bid.sourceMetadata.sourceFamily;
  if (bid.source.startsWith("g2b-")) return "G2B";
  if (bid.source.startsWith("kwater-")) return "KWATER";
  if (bid.source.startsWith("lh-")) return "LH";
  return bid.source === "kepco-ebid-contract" ? "KEPCO" : null;
};

const agencyIdentityOf = (
  input: ProcurementProjectionInput,
): {
  code_namespace: string;
  agency_code: string;
  name: string;
} | null => {
  const { bid, rawPayload } = input;
  const agencyName = nonblank(bid.agency);
  if (agencyName === null) return null;
  if (bid.isDemo)
    return {
      code_namespace: "DEMO_AGENCY",
      agency_code: hashOf(nameKey(agencyName)),
      name: agencyName,
    };
  const namespace = nonblank(bid.sourceMetadata?.agencyCodeNamespace);
  const code = nonblank(bid.sourceMetadata?.agencyCode);
  if (namespace && code) return { code_namespace: namespace, agency_code: code, name: agencyName };
  const g2bCode = nonblank(rawPayload.dminsttCd);
  const g2bName = nonblank(rawPayload.dminsttNm);
  return sourceFamilyOf(bid) === "G2B" &&
    g2bCode &&
    g2bName &&
    nameKey(g2bName) === nameKey(agencyName)
    ? { code_namespace: "G2B_AGENCY", agency_code: g2bCode, name: agencyName }
    : null;
};

const persistAgency = async (
  client: SupabaseClient<Database>,
  input: ProcurementProjectionInput,
): Promise<string | null> => {
  const identity = agencyIdentityOf(input);
  if (!identity) return null;
  const { data, error } = await client
    .from("procurement_agencies")
    .upsert(identity, { onConflict: "code_namespace,agency_code" })
    .select("id")
    .single();
  if (error) throw projectionError("procurement_agencies", error);
  return data.id;
};

const relevanceInputOf = (input: ProcurementProjectionInput): ProcurementRelevanceInput => ({
  title: input.bid.title,
  body:
    input.relevanceMaterials?.body === undefined
      ? input.bid.content || null
      : input.relevanceMaterials.body,
  officialIndustries: input.bid.structuredQualifications.flatMap((requirement) =>
    (requirement.kind === "PERMITTED_INDUSTRY" || requirement.kind === "LICENSE_LIMIT") &&
    requirement.code &&
    requirement.name
      ? [{ code: requirement.code, name: requirement.name }]
      : [],
  ),
  // File names and object keys are not parsed attachment evidence.
  attachments: input.relevanceMaterials?.attachments,
  reviewedEvidence: input.relevanceMaterials?.reviewedEvidence,
});

const eventsOf = (input: ProcurementProjectionInput): TablesInsert<"bid_notice_events">[] => {
  const { bid } = input;
  const kinds = new Set<string>([
    ...(bid.revision === 1 ? ["CREATED"] : []),
    ...(bid.status === "CANCELLED" ? ["CANCELLED"] : bid.revision > 1 ? ["AMENDED"] : []),
    ...(bid.sourceMetadata?.providerEvent ? [bid.sourceMetadata.providerEvent] : []),
  ]);
  return [...kinds].map((kind) => ({
    bid_id: input.bidId,
    revision_id: input.revisionId,
    kind,
    provider_status: bid.sourceMetadata?.providerStatus ?? bid.original.status ?? null,
    occurred_at: bid.fetchedAt,
    evidence: {
      checksum: bid.checksum,
      timeBasis: "OBSERVED",
      status: bid.status,
      revision: bid.revision,
    },
  }));
};

const amountOf = (bid: NormalizedBid): OpportunityMatchInput["amount"] => {
  const amount = bid.sourceMetadata?.amounts.find(
    (candidate) =>
      candidate.amountKrw !== null &&
      candidate.amountKrw === bid.budgetKrw &&
      candidate.unit !== "UNVERIFIED" &&
      candidate.currency !== null,
  );
  if (amount)
    return { value: amount.amountKrw ?? "", type: amount.kind, unit: "KRW", currency: "KRW" };
  const budgetNote = bid.normalizationNotes?.find((note) => note.startsWith("budgetKrw:"));
  const type = budgetNote?.includes("asignBdgtAmt")
    ? "ASSIGNED_BUDGET"
    : budgetNote?.includes("presmptPrce")
      ? "ESTIMATED_PRICE"
      : null;
  return bid.budgetKrw !== null && type
    ? { value: bid.budgetKrw, type, unit: "KRW", currency: "KRW" }
    : null;
};

const matchInputOf = (
  bid: NormalizedBid,
  agencyId: string | null,
  attachmentHashes: string[],
  officialCrossReferences?: readonly OfficialOpportunityReference[],
): OpportunityMatchInput => ({
  sourceFamily: sourceFamilyOf(bid) ?? "DEMO",
  sourceKey: bid.source,
  partitionKey: bid.sourceMetadata?.providerCompanyId,
  providerNamespace: sourceFamilyOf(bid) ?? "DEMO",
  noticeId: bid.noticeId,
  amendment: bid.amendmentNo ?? null,
  agency: { id: agencyId, name: bid.agency },
  title: bid.title,
  stage: bid.stage,
  publishedAt: bid.noticeDate,
  deadlineAt: bid.deadlineAt,
  amount: amountOf(bid),
  sourceUrl: bid.sourceMetadata?.sourceUrlKind === "SERVICE_DOCUMENTATION" ? null : bid.sourceUrl,
  attachmentHashes,
  isDemo: bid.isDemo,
  officialCrossReferences,
  provisional: bid.sourceMetadata?.attributes.identityStatus === "PROVISIONAL",
});

const attachmentHashesOf = async (
  client: SupabaseClient<Database>,
  revisionId: string,
): Promise<string[]> => {
  const { data, error } = await client
    .from("bid_documents")
    .select("sha256")
    .eq("revision_id", revisionId)
    .not("sha256", "is", null)
    .limit(100);
  if (error) throw projectionError("bid_documents", error);
  return data.flatMap(({ sha256 }) => (sha256 ? [sha256] : []));
};

const shortlistOf = async (
  client: SupabaseClient<Database>,
  input: ProcurementProjectionInput,
  agencyId: string | null,
) => {
  const officialIds = [
    ...new Set(
      [
        input.bid.noticeId,
        input.bid.planRef,
        input.bid.preSpecRef,
        ...(input.officialCrossReferences ?? []).map(({ noticeId }) => noticeId),
      ].filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, SHORTLIST_LIMIT);
  const exact = await client
    .from("bid_notices")
    .select("id,procuring_agency_id")
    .eq("is_demo", input.bid.isDemo)
    .neq("id", input.bidId)
    .in("notice_id", officialIds)
    .order("id")
    .limit(SHORTLIST_LIMIT);
  if (exact.error) throw projectionError("bid_notices 공식 식별자 후보", exact.error);
  const title = normalizeOpportunityTitle(input.bid.title);
  const token = title
    .split(" ")
    .filter((part) => part.length >= 3 && !/^\d+(?:년|년도)?$/u.test(part))
    .sort((left, right) => right.length - left.length)[0]
    ?.slice(0, 16);
  if (!token) return exact.data;
  const escapedToken = token.replace(/[\\%_]/gu, "\\$&");
  const query = client
    .from("bid_notices")
    .select("id,procuring_agency_id")
    .eq("is_demo", input.bid.isDemo)
    .neq("id", input.bidId)
    .ilike("title", `%${escapedToken}%`);
  const scoped = input.bid.agency
    ? query.eq("agency", input.bid.agency)
    : agencyId
      ? query.eq("procuring_agency_id", agencyId)
      : query;
  const named = await scoped
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(SHORTLIST_LIMIT);
  if (named.error) throw projectionError("bid_notices 제목 후보", named.error);
  return [...new Map([...exact.data, ...named.data].map((row) => [row.id, row])).values()];
};

const conservativeDecision = (decision: OpportunityMatchResult): OpportunityMatchResult =>
  decision.outcome === "CONFIRMED_DUPLICATE" &&
  !decision.reasons.includes("OFFICIAL_CROSS_REFERENCE")
    ? {
        ...decision,
        outcome: "CANDIDATE",
        relationship: "POSSIBLE_DUPLICATE",
        reasons: ["OFFICIAL_REFERENCE_REQUIRED_FOR_LINK", ...decision.reasons],
      }
    : decision;

const linkOfficialReference = async (
  client: SupabaseClient<Database>,
  input: ProcurementProjectionInput,
  candidateId: string,
  decision: OpportunityMatchResult,
): Promise<void> => {
  if (
    !decision.reasons.some(
      (reason) => reason === "OFFICIAL_CROSS_REFERENCE" || reason === "OFFICIAL_STAGE_REFERENCE",
    )
  )
    return;
  const reference = decision.evidence.find(({ field }) => field === "officialCrossReference");
  if (!reference?.sourceUrl || !reference.quote) return;
  const target = await client
    .from("opportunity_notice_links")
    .select("opportunity_id")
    .eq("bid_id", candidateId)
    .single();
  if (target.error) throw projectionError("opportunity_notice_links", target.error);
  const { error } = await client.rpc("link_bid_opportunity", {
    p_bid_id: input.bidId,
    p_opportunity_id: target.data.opportunity_id,
    p_relation: decision.relationship === "STAGE_LINK" ? "STAGE_LINK" : "DUPLICATE",
    p_evidence: {
      kind: "OFFICIAL_REFERENCE",
      reference: reference.sourceUrl,
      quote: reference.quote,
      policyVersion: decision.policyVersion,
      inputHash: decision.inputHash,
    },
  });
  if (error) throw projectionError("link_bid_opportunity", error);
};

const persistRelevance = async (
  client: SupabaseClient<Database>,
  input: ProcurementProjectionInput,
): Promise<void> => {
  const relevance = classifyProcurementRelevance(relevanceInputOf(input));
  const assessment = await client.from("bid_relevance_assessments").upsert(
    {
      revision_id: input.revisionId,
      policy_version: relevance.policyVersion,
      input_hash: relevance.inputHash,
      state: relevance.state,
      categories: relevance.categories,
      tags: relevance.tags,
      relevance_score: relevance.score,
      evidence: jsonOf(relevance.evidence),
      missing_channels: relevance.missingChannels,
    },
    { onConflict: "revision_id,policy_version,input_hash", ignoreDuplicates: true },
  );
  if (assessment.error) throw projectionError("bid_relevance_assessments", assessment.error);
};

/** Worker/admin clients are supplied by the caller; this helper never obtains credentials. */
export const projectProcurementRevision = async (
  client: SupabaseClient<Database>,
  input: ProcurementProjectionInput,
): Promise<void> => {
  const events = await client
    .from("bid_notice_events")
    .upsert(eventsOf(input), { onConflict: "revision_id,kind", ignoreDuplicates: true });
  if (events.error) throw projectionError("bid_notice_events", events.error);
  const agencyId = await persistAgency(client, input);
  const metadata = input.bid.sourceMetadata;
  const current = await client
    .from("bid_notices")
    .update({
      source_family: sourceFamilyOf(input.bid),
      ...(metadata
        ? {
            service_id: metadata.serviceId,
            provider_company_id: metadata.providerCompanyId ?? null,
          }
        : {}),
      provider_record_key: metadata?.providerRecordKey ?? input.bid.noticeId,
      procuring_agency_id: agencyId,
    })
    .eq("id", input.bidId)
    .eq("latest_revision", input.bid.revision)
    .select("id");
  if (current.error) throw projectionError("bid_notices metadata", current.error);
  // Historical evidence is retained; an older saved revision cannot project current metadata or links.
  if (current.data.length === 0) return persistRelevance(client, input);
  const candidates = await shortlistOf(client, input, agencyId);
  if (candidates.length === 0) return persistRelevance(client, input);
  const currentMatch = matchInputOf(
    input.bid,
    agencyId,
    await attachmentHashesOf(client, input.revisionId),
    input.officialCrossReferences,
  );
  for (const candidate of candidates) {
    const latest = await client
      .from("bid_revisions")
      .select("id,normalized,raw_payload")
      .eq("bid_id", candidate.id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw projectionError("bid_revisions 후보", latest.error);
    if (!latest.data) continue;
    const parsed = normalizedBidSchema.safeParse(latest.data.normalized);
    if (!parsed.success) throw new Error("조달 투영: 후보 normalized 계약 불일치");
    const candidateMatch = matchInputOf(
      parsed.data,
      candidate.procuring_agency_id,
      await attachmentHashesOf(client, latest.data.id),
    );
    const isCurrentLeft = input.bidId < candidate.id;
    const decision = conservativeDecision(
      matchProcurementOpportunities(
        isCurrentLeft ? currentMatch : candidateMatch,
        isCurrentLeft ? candidateMatch : currentMatch,
      ),
    );
    const revisions = isCurrentLeft
      ? {
          leftRevisionId: input.revisionId,
          rightRevisionId: latest.data.id,
          leftChecksum: input.bid.checksum,
          rightChecksum: parsed.data.checksum,
        }
      : {
          leftRevisionId: latest.data.id,
          rightRevisionId: input.revisionId,
          leftChecksum: parsed.data.checksum,
          rightChecksum: input.bid.checksum,
        };
    const persisted = await client.from("notice_match_candidates").upsert(
      {
        left_bid_id: isCurrentLeft ? input.bidId : candidate.id,
        right_bid_id: isCurrentLeft ? candidate.id : input.bidId,
        outcome: decision.outcome,
        reasons: decision.reasons,
        evidence: jsonOf({ ...decision, ...revisions }),
        policy_version: decision.policyVersion,
        input_hash: hashOf({ inputHash: decision.inputHash, ...revisions }),
      },
      { onConflict: "left_bid_id,right_bid_id,policy_version,input_hash", ignoreDuplicates: true },
    );
    if (persisted.error) throw projectionError("notice_match_candidates", persisted.error);
    await linkOfficialReference(client, input, candidate.id, decision);
  }
  // Missing-assessment repair can retry any earlier partial write without creating another revision.
  await persistRelevance(client, input);
};

/** A separate worker invocation repairs only missing current assessments; it performs no source/API calls. */
export const backfillProcurementRelevance = async (
  client: SupabaseClient<Database>,
  limit = 100,
): Promise<{ processed: number }> => {
  const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
  const { data, error } = await client.rpc("procurement_missing_relevance_revisions", {
    p_limit: boundedLimit,
  });
  if (error) throw projectionError("procurement_missing_relevance_revisions", error);
  for (const row of data) {
    const parsed = normalizedBidSchema.safeParse(row.normalized);
    if (
      !parsed.success ||
      typeof row.raw_payload !== "object" ||
      row.raw_payload === null ||
      Array.isArray(row.raw_payload)
    ) {
      throw new Error("조달 투영: 보완 revision 계약 불일치");
    }
    await projectProcurementRevision(client, {
      bidId: row.bid_id,
      revisionId: row.revision_id,
      bid: parsed.data,
      rawPayload: row.raw_payload,
    });
  }
  return { processed: data.length };
};
