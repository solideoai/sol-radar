import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/server/supabase";
import {
  OpportunityReadError,
  opportunityItemSchema,
  opportunitySummarySchema,
  type OpportunityPage,
  type SourceFamily,
  type SourceServiceConfig,
  type SourceServiceStatus,
  type SourceSummary,
} from "./model";
import {
  fingerprint,
  signOpportunityCursor,
  verifyOpportunityCursor,
  type OpportunityQuery,
  type OpportunityCursor,
} from "./query";

type Client = SupabaseClient<Database>;
export const getOpportunityClient = getSupabase;
type Row = Database["public"]["Views"]["opportunity_list_items"]["Row"];
const fail = () =>
  new OpportunityReadError("SERVICE_UNAVAILABLE", "사업기회 데이터를 읽지 못했습니다");
const SORT_COLUMNS = {
  "publishedAt:desc": "published_at",
  "deadlineAt:asc": "deadline_at",
  "score:desc": "sol_score",
  "budgetKrw:desc": "budget_krw_value",
} as const;
const quoted = (s: unknown) => `"${String(s).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const itemOf = (r: Row) =>
  opportunityItemSchema.parse({
    id: r.id,
    bidId: r.bid_id,
    revisionId: r.revision_id,
    source: r.source,
    sourceFamily: r.source_family,
    sources: r.sources,
    noticeId: r.notice_id,
    title: r.title,
    agency: r.agency,
    agencyId: r.agency_id,
    companyId: r.company_id,
    stage: r.stage,
    status: r.status,
    budgetKrw: r.budget_krw,
    publishedAt: r.published_at,
    deadlineAt: r.deadline_at,
    isDemo: r.is_demo,
    firstSeenAt: r.first_seen_at,
    categories: r.categories,
    relevanceState: r.relevance_state,
    relevanceScore: r.relevance_score,
    sourceCount: r.source_count,
    sourceConflict: r.source_conflict ?? false,
    latestRun: r.latest_run_id ? { id: r.latest_run_id, status: r.latest_run_status } : null,
    latestAnalysis: r.analysis_id
      ? {
          id: r.analysis_id,
          status: r.analysis_status,
          solScore: r.sol_score,
          recommendation: r.recommendation,
        }
      : null,
    latestDecision: r.latest_decision,
    latestDecisionAt: r.latest_decision_at,
  });

// 관련성 순위·선택 정렬·UUID를 같은 순서로 비교한다. null은 끝에 두며 서명된 값도 PostgREST 문법에 맞게 인용한다.
export function opportunityKeyset(q: OpportunityQuery, c: OpportunityCursor): string {
  const col = SORT_COLUMNS[q.sort],
    id = `id.gt.${quoted(c.id)}`,
    rank = `relevance_rank.gt.${c.rank}`,
    rankEq = `relevance_rank.eq.${c.rank}`;
  const tie = q.siAiFirst ? `or(${rank},and(${rankEq},${id}))` : id;
  const dir = q.sort === "deadlineAt:asc" ? "gt" : "lt";
  const val = c.value === null ? `${col}.is.null` : `${col}.eq.${quoted(c.value)}`;
  const tail =
    c.value === null
      ? `and(${val},${tie})`
      : `or(${col}.${dir}.${quoted(c.value)},${col}.is.null,and(${val},${tie}))`;
  if (q.siAiFirst && !q.sortExplicit) {
    const within =
      c.value === null
        ? `and(${col}.is.null,${id})`
        : `or(${col}.${dir}.${quoted(c.value)},${col}.is.null,and(${val},${id}))`;
    return `or(${rank},and(${rankEq},${within}))`;
  }
  return tail;
}

function filtered(client: Client, orgId: string, q: OpportunityQuery, asOf: string) {
  let r = client
    .from("opportunity_list_items")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .lte("first_seen_at", asOf);
  if (q.origin !== "all") r = r.eq("is_demo", q.origin === "demo");
  const stages = q.stage.length
    ? q.stage
    : q.includeEarly
      ? ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC", "NOTICE"]
      : ["NOTICE"];
  r = r.in("stage", stages).in("status", q.status.length ? q.status : ["OPEN", "AMENDED"]);
  if (q.sourceFamily.length) r = r.overlaps("source_families", q.sourceFamily);
  if (q.agencyId.length) r = r.overlaps("agency_ids", q.agencyId);
  if (q.companyId.length) r = r.overlaps("company_ids", q.companyId);
  if (q.recommendation.includes("BID")) r = r.or("source_conflict.eq.false,recommendation.neq.BID");
  if (q.recommendation.length)
    r = r.in("recommendation", q.recommendation).in("analysis_status", ["COMPLETED", "PARTIAL"]);
  if (q.decision.length) {
    const non = q.decision.filter((v) => v !== "NONE");
    r = q.decision.includes("NONE")
      ? r.or(`latest_decision.is.null${non.length ? `,latest_decision.in.(${non.join(",")})` : ""}`)
      : r.in("latest_decision", non);
  }
  if (q.category.length) r = r.overlaps("categories", q.category);
  if (q.q) {
    const value = quoted(
      `%${q.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    );
    r = r.or(`title.ilike.${value},agency.ilike.${value},notice_id.ilike.${value}`);
  }
  return r;
}
async function versionOf(client: Client, orgId: string) {
  const r = await client.rpc("procurement_dataset_version", { p_org_id: orgId });
  if (r.error || !r.data) throw fail();
  return r.data;
}

export async function listOpportunities(
  client: Client,
  orgId: string,
  q: OpportunityQuery,
  secret: string | null,
): Promise<OpportunityPage> {
  if (!secret || secret.length < 32) throw fail();
  const scope = fingerprint(orgId, q);
  const c = q.cursor ? verifyOpportunityCursor(q.cursor, scope, secret) : null;
  if (q.cursor && !c)
    throw new OpportunityReadError(
      "INVALID_CURSOR",
      "목록 조건이 바뀌었거나 커서가 만료되었습니다",
    );
  const version = await versionOf(client, orgId);
  if (c && c.version !== version)
    throw new OpportunityReadError(
      "INVALID_CURSOR",
      "데이터가 변경되었습니다. 첫 페이지를 다시 열어 주세요",
    );
  const asOf = c?.asOf ?? q.asOf ?? new Date().toISOString();
  let request = filtered(client, orgId, q, asOf);
  if (q.siAiFirst && !q.sortExplicit)
    request = request.order("relevance_rank", { ascending: true });
  request = request.order(SORT_COLUMNS[q.sort], {
    ascending: q.sort === "deadlineAt:asc",
    nullsFirst: false,
  });
  if (q.siAiFirst && q.sortExplicit) request = request.order("relevance_rank", { ascending: true });
  request = request.order("id", { ascending: true });
  if (c) request = request.or(opportunityKeyset(q, c));
  const [result, total] = await Promise.all([
    request.limit(q.limit + 1),
    filtered(client, orgId, q, asOf).limit(0),
  ]);
  if (result.error || total.error || version !== (await versionOf(client, orgId))) throw fail();
  const rows = result.data.slice(0, q.limit),
    hasNext = result.data.length > q.limit,
    last = rows.at(-1);
  const nextCursor =
    hasNext && last?.id
      ? signOpportunityCursor(
          {
            scope,
            version,
            asOf,
            issuedAt: c?.issuedAt ?? Date.now(),
            id: last.id,
            rank: last.relevance_rank ?? 3,
            value: q.sort === "budgetKrw:desc" ? last.budget_krw : last[SORT_COLUMNS[q.sort]],
          },
          secret,
        )
      : null;
  return {
    items: rows.map(itemOf),
    total: total.count ?? 0,
    asOf,
    pageInfo: { cursor: q.cursor, nextCursor, hasNext },
  };
}
export async function getOpportunitySummary(
  client: Client,
  orgId: string,
  origin: "live" | "demo" | "all",
  asOf = new Date().toISOString(),
) {
  const r = await client.rpc("procurement_summary", {
    p_org_id: orgId,
    p_origin: origin,
    p_as_of: asOf,
  });
  if (r.error) throw fail();
  return opportunitySummarySchema.parse(r.data);
}
const numberOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export async function getSourceSummary(
  client: Client,
  origin: "live" | "demo" | "all",
  configs: SourceServiceConfig[],
): Promise<SourceSummary> {
  const r = await client.rpc("procurement_source_health", { p_origin: origin });
  if (r.error) throw fail();
  const services: SourceServiceStatus[] = configs.map((config) => {
    const run = r.data.find((row) => row.service_key === config.key);
    const summary = run?.summary;
    const counts =
      typeof summary === "object" && summary !== null && !Array.isArray(summary) ? summary : {};
    const complete =
      run?.status === "SUCCEEDED" &&
      run.completeness === "COMPLETE" &&
      run.finished_at !== null &&
      Date.now() - Date.parse(run.finished_at) <= 60 * 60 * 1000;
    const status = !config.enabled ? "NOT_CONFIGURED" : complete ? "HEALTHY" : "DEGRADED";
    // 키 발급과 실제 인증 결과는 별도다. 성공이 보장된 COMPLETE live 응답 또는 고정 인증 오류만 상태 근거다.
    return {
      ...config,
      status,
      connectionStatus: run ? (run.status === "FAILED" ? "ERROR" : "CONNECTED") : "NOT_VERIFIED",
      authStatus:
        run?.auth_status === "VERIFIED"
          ? "VERIFIED"
          : run?.auth_status === "FAILED"
            ? "FAILED"
            : "NOT_VERIFIED",
      lastIngestAt: run?.started_at ?? null,
      lastSuccessAt: run?.last_success_at ?? null,
      counts: {
        fetched: run?.fetched_count ?? 0,
        created: numberOf(counts.created),
        updated: numberOf(counts.changed),
        duplicates: numberOf(counts.skippedDuplicate),
        errors: run?.error_count ?? 0,
        quarantined: numberOf(counts.quarantined),
      },
    };
  });
  const labels: Record<SourceFamily, string> = {
    G2B: "나라장터",
    KWATER: "K-water",
    LH: "LH",
    KEPCO: "KEPCO",
  };
  return {
    isDemo: origin === "demo",
    generatedAt: new Date().toISOString(),
    groups: (Object.keys(labels) as SourceFamily[]).map((sourceFamily) => {
      const list = services.filter((s) => s.sourceFamily === sourceFamily);
      return {
        sourceFamily,
        label: labels[sourceFamily],
        services: list,
        healthyServices: list.filter((s) => s.status === "HEALTHY").length,
        enabledServices: list.filter((s) => s.enabled).length,
        lastSuccessAt:
          list
            .map((s) => s.lastSuccessAt)
            .filter((s): s is string => s !== null)
            .sort()
            .at(-1) ?? null,
        status:
          list.some((s) => s.enabled) && list.some((s) => s.status !== "HEALTHY")
            ? "DEGRADED"
            : list.some((s) => s.enabled)
              ? "HEALTHY"
              : "NOT_CONFIGURED",
      };
    }),
  };
}
export async function getOpportunityFilterOptions(client: Client, origin: "live" | "demo" | "all") {
  const r = await client.rpc("procurement_filter_options", { p_origin: origin });
  if (r.error) throw fail();
  const option = z.object({ id: z.string(), name: z.string() });
  return z.object({ agencies: z.array(option), companies: z.array(option) }).parse(r.data);
}
