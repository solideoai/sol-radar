import "server-only";
import { z } from "zod";
import { getSupabase } from "@/server/supabase";
import {
  analysisStatusSchema,
  bidStageSchema,
  bidStatusSchema,
  effectiveStatus,
  recommendationSchema,
} from "./bid.model";
import type { DashboardRepo, DashboardSource, DashboardStatusSource } from "./bids.repo";

// 대시보드 원천. 공고에 이 조직의 분석·결정을 붙여 읽고, 수집 신선도·안 읽은 알림 수·AI 상태를 함께 모은다.
// 집계(최신 1건 고르기·세기)는 서비스(getDashboardSummary)가 한다.

const BID_SELECT =
  "id,title,stage,status,deadline_at,score_runs!score_runs_bid_id_fkey(id,status,recommendation,review_flags,created_at),bid_reviews!bid_reviews_bid_id_fkey(decision,disagreement_flag,decided_at)";

// 0 이상 정수가 아니면 0 으로 읽는다. 요약 하나가 깨져도 대시보드 전체가 실패하지 않게 한다.
const countSchema = z.number().int().nonnegative().catch(0);
const summarySchema = z.object({
  created: countSchema,
  changed: countSchema,
  cancelled: countSchema,
  skippedDuplicate: countSchema,
  quarantined: countSchema,
  retried: countSchema,
});
// 생성 타입은 finished_at 을 non-null 로 적지만 RUNNING 동안은 null 이다. 그래서 받은 행을 다시 검사한다.
const ingestRunSchema = z.object({
  status: z.enum(["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]),
  started_at: z.string().min(1),
  finished_at: z.string().min(1).nullable(),
  summary: z.unknown(),
});

function freshnessOf(rows: unknown[]): DashboardSource["dataFreshness"] {
  if (rows.length === 0) {
    return { lastIngestAt: null, lastIngestStatus: null, lastIngestSummary: null };
  }
  const run = ingestRunSchema.parse(rows[0]);
  const summary = summarySchema.safeParse(run.summary ?? {});
  return {
    // 진행 중이면 끝난 시각이 없어 시작 시각을 쓴다.
    lastIngestAt: run.finished_at ?? run.started_at,
    lastIngestStatus: run.status,
    lastIngestSummary: summary.success ? summary.data : summarySchema.parse({}),
  };
}

type Db = Awaited<ReturnType<typeof getSupabase>>;

// 상단바 두 값(수집 신선도·안 읽은 알림 수). 대시보드 전체 읽기와 업무 틀이 함께 쓴다.
async function readStatus(db: Db, origin: "live" | "demo" | "all"): Promise<DashboardStatusSource> {
  const [ingest, unread] = await Promise.all([
    db.rpc("latest_ingest_run", { p_origin: origin }),
    db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (ingest.error) throw ingest.error;
  if (unread.error) throw unread.error;
  return { dataFreshness: freshnessOf(ingest.data ?? []), unreadNotifications: unread.count ?? 0 };
}

export function createDashboardRepo(config: {
  aiStatus: () => Promise<DashboardSource["ai"]>;
}): DashboardRepo {
  return {
    async load(orgId, origin) {
      const db = await getSupabase();
      const base = db
        .from("bid_notices")
        .select(BID_SELECT)
        .eq("score_runs.org_id", orgId)
        .eq("bid_reviews.org_id", orgId);
      const bidsQuery = origin === "all" ? base : base.eq("is_demo", origin === "demo");
      const projectQuery = db
        .from("bid_projects")
        .select("id,bid:bid_notices!inner(is_demo)", { count: "exact", head: true })
        .eq("org_id", orgId)
        .neq("status", "CLOSED");
      const [bids, status, ai, projects] = await Promise.all([
        bidsQuery,
        readStatus(db, origin),
        config.aiStatus(),
        origin === "all" ? projectQuery : projectQuery.eq("bid.is_demo", origin === "demo"),
      ]);
      if (bids.error) throw bids.error;
      if (projects.error) throw projects.error;
      const now = new Date();
      return {
        bids: bids.data.map((bid) => ({
          bidId: bid.id,
          title: bid.title,
          stage: bidStageSchema.parse(bid.stage),
          // CLOSED 는 저장하지 않고 마감으로 계산한다(ADR-030 B14).
          status: effectiveStatus(bidStatusSchema.parse(bid.status), bid.deadline_at, now),
          deadlineAt: bid.deadline_at,
          analyses: bid.score_runs.map((run) => ({
            id: run.id,
            status: analysisStatusSchema.parse(run.status),
            recommendation: recommendationSchema.nullable().parse(run.recommendation),
            reviewFlagCount: run.review_flags.length,
            createdAt: run.created_at,
          })),
          reviews: bid.bid_reviews.map((review) => ({
            decision: recommendationSchema.parse(review.decision),
            disagreementFlag: review.disagreement_flag,
            decidedAt: review.decided_at,
          })),
        })),
        activeProjects: projects.count ?? 0,
        dataFreshness: status.dataFreshness,
        ai,
        unreadNotifications: status.unreadNotifications,
      };
    },

    async loadStatus(origin) {
      return readStatus(await getSupabase(), origin);
    },
  };
}
