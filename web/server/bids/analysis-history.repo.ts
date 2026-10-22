import "server-only";
import { getSupabase } from "@/server/supabase";
import { analysisHistoryItemSchema, type AnalysisHistoryRepo } from "./analysis-history.model";
import { keysetFilter, pageOf } from "./postgrest";

// 입력 스냅샷·모델 분포를 이력 목록에 싣지 않는다.
export const analysisHistoryRepo: AnalysisHistoryRepo = {
  async list(orgId, query, after) {
    const db = await getSupabase();
    let request = db
      .from("score_runs")
      .select(
        "id,bid_id,profile_revision,status,run_mode,score,recommendation,error_code,review_flags,queued_at,finished_at,algorithm_version,created_at,revision:bid_revisions!score_runs_revision_fkey(revision),bid:bid_notices!score_runs_bid_id_fkey(title,is_demo)",
      )
      .eq("org_id", orgId);
    if (query.bidId !== null) request = request.eq("bid_id", query.bidId);
    if (query.status !== null) request = request.eq("status", query.status);
    if (query.runMode !== null) request = request.eq("run_mode", query.runMode.toUpperCase());
    if (query.recommendation !== null) request = request.eq("recommendation", query.recommendation);
    if (after !== null) request = request.or(keysetFilter("created_at", "desc", after, "desc"));
    const { data, error } = await request
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.limit + 1);
    if (error) throw error;
    return pageOf(
      data,
      query.limit,
      (row) => {
        if (row.revision === null || row.bid === null)
          throw new Error("분석 이력의 공고를 읽지 못했습니다");
        const scored = row.status === "COMPLETED" || row.status === "PARTIAL";
        return analysisHistoryItemSchema.parse({
          id: row.id,
          bidId: row.bid_id,
          bidTitle: row.bid.title,
          isDemo: row.bid.is_demo,
          revision: row.revision.revision,
          profileRevision: row.profile_revision,
          status: row.status,
          runMode: row.run_mode.toLowerCase(),
          solScore: scored ? row.score : null,
          recommendation: scored ? row.recommendation : null,
          errorCode: row.error_code,
          reviewFlags: row.review_flags,
          queuedAt: row.queued_at,
          finishedAt: row.finished_at,
          model: { algorithmVersion: row.algorithm_version },
        });
      },
      (row) => ({ sortValue: row.created_at, id: row.id }),
    );
  },
};
