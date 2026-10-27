import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/server/supabase";
import {
  OpportunityReadError,
  opportunityItemSchema,
  opportunitySummarySchema,
  opportunityLiveMetricsSchema,
  type OpportunityPage,
  type SourceFamily,
  type SourceServiceConfig,
  type SourceServiceStatus,
  type SourceSummary,
} from "./model";
import { DEFAULT_INGEST_STALE_AFTER_MS } from "./freshness";
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
    changedAt: r.changed_at,
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
    .from(q.watched === "me" ? "watched_opportunity_list_items" : "opportunity_list_items")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .lte("first_seen_at", asOf);
  // live 는 is_demo=false 이면서 저장된 source 가 데모 수집기(fixture)가 아닌 것만이다. 어느 쪽인지 모르는 행은
  // 실제 공고로 세지 않고 전체(all)에서만 "출처 미확인"으로 보인다(10-25 계획 B2, 화면 components/bids/notice-origin).
  if (q.origin === "demo") r = r.eq("is_demo", true);
  if (q.origin === "live") r = r.eq("is_demo", false).neq("source", "fixture");
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
  userId?: string,
): Promise<OpportunityPage> {
  if (!secret || secret.length < 32) throw fail();
  if (q.watched && !userId) throw fail();
  const scope = fingerprint(orgId, q, userId);
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
// 상세 "마지막 변경". 이 조직의 사업기회 중 이 공고가 대표 공고인 것의 changed_at 이다. 대표 공고가 아니면 null.
export async function getOpportunityChangedAt(
  client: Client,
  orgId: string,
  bidId: string,
): Promise<string | null> {
  const r = await client
    .from("opportunity_list_items")
    .select("changed_at")
    .eq("org_id", orgId)
    .eq("bid_id", bidId)
    .order("changed_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (r.error) throw fail();
  return r.data[0]?.changed_at ?? null;
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
// 대시보드 실수집 지표: 진행 중 WATCH 수와 기관별 공고 수 상위 N. 범위는 getOpportunitySummary 와 같다(RLS 는 호출자).
export async function getOpportunityLiveMetrics(
  client: Client,
  orgId: string,
  origin: "live" | "demo" | "all",
  asOf = new Date().toISOString(),
  agencyLimit = 5,
) {
  const r = await client.rpc("procurement_live_metrics", {
    p_org_id: orgId,
    p_origin: origin,
    p_as_of: asOf,
    p_agency_limit: agencyLimit,
  });
  if (r.error) throw fail();
  return opportunityLiveMetricsSchema.parse(r.data);
}
// 마지막 정기(SCHEDULED) 수집 시작 시각. 업무 역할이 없거나 기록이 없으면 null 이다.
export async function getLastScheduledIngestAt(
  client: Client,
  origin: "live" | "demo" | "all",
): Promise<string | null> {
  const r = await client.rpc("procurement_last_scheduled_ingest", { p_origin: origin });
  if (r.error) throw fail();
  return z.string().nullable().parse(r.data);
}
const numberOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export async function getSourceSummary(
  client: Client,
  origin: "live" | "demo" | "all",
  configs: SourceServiceConfig[],
  // 마지막 완전 성공이 이보다 오래되면 DEGRADED 다(freshness.ts ingestStaleAfterMs).
  staleAfterMs = DEFAULT_INGEST_STALE_AFTER_MS,
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
      Date.now() - Date.parse(run.finished_at) <= staleAfterMs;
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
  const notices = services.filter((s) => s.role === "NOTICE");
  return {
    isDemo: origin === "demo",
    generatedAt: new Date().toISOString(),
    references: services.filter((s) => s.role === "REFERENCE"),
    groups: (Object.keys(labels) as SourceFamily[]).map((sourceFamily) => {
      const list = notices.filter((s) => s.sourceFamily === sourceFamily);
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
