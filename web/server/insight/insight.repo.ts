import "server-only";
import { getSupabase } from "@/server/supabase";
import type { InsightRepo } from "./insight-request.model";
import {
  insightErrorCodeSchema,
  insightFallbackReasonSchema,
  insightPayloadSchema,
  insightSourceSchema,
  insightStatusSchema,
  type InsightView,
} from "./insight.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 사용자 JWT 클라이언트(getSupabase)만 쓴다. 조직 격리·역할·완료 run 검사는 recommendation_insights 의 RLS 가 다시 한다.
// org_id 를 조건에 적어 화면이 확인한 지금 조직 하나로 좁힌다(M17).

const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";
const ONE_PENDING = "recommendation_insights_one_pending";
const PENDING_OR_MODEL_ONCE = "recommendation_insights_pending_or_model_once";
const INSIGHT_COLUMNS =
  "id, score_run_id, status, source, payload, fallback_reason, model_name, prompt_version, error_code, created_at, finished_at";

type InsightRow = {
  id: string;
  score_run_id: string;
  status: string;
  source: string | null;
  payload: unknown;
  fallback_reason: string | null;
  model_name: string | null;
  prompt_version: string | null;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
};

// 값 목록은 DB check 와 같다. 어긋난 행은 worker 계약 위반이라 던진다(조용히 빈 값으로 바꾸지 않는다).
const toInsightView = (row: InsightRow): InsightView => ({
  id: row.id,
  scoreRunId: row.score_run_id,
  status: insightStatusSchema.parse(row.status),
  source: row.source === null ? null : insightSourceSchema.parse(row.source),
  payload: row.payload === null ? null : insightPayloadSchema.parse(row.payload),
  fallbackReason:
    row.fallback_reason === null ? null : insightFallbackReasonSchema.parse(row.fallback_reason),
  modelName: row.model_name,
  promptVersion: row.prompt_version,
  errorCode: row.error_code === null ? null : insightErrorCodeSchema.parse(row.error_code),
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

export const insightRepo: InsightRepo = {
  async findRun(orgId, runId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("score_runs")
      .select("id, bid_id, status")
      .eq("org_id", orgId)
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    return data === null ? null : { id: data.id, bidId: data.bid_id, status: data.status };
  },

  async latestInsight(orgId, runId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("recommendation_insights")
      .select(INSIGHT_COLUMNS)
      .eq("org_id", orgId)
      .eq("score_run_id", runId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data === null ? null : toInsightView(data);
  },

  // 버전은 거르지 않는다. 새 형식 재요청이 실패했을 때 화면이 옛 결과를 계속 보이는 데 쓴다(ADR-078 Q2).
  async latestModelInsight(orgId, runId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("recommendation_insights")
      .select(INSIGHT_COLUMNS)
      .eq("org_id", orgId)
      .eq("score_run_id", runId)
      .eq("status", "DONE")
      .eq("source", "MODEL")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data === null ? null : toInsightView(data);
  },

  // status·requested_by 는 열 권한이 없어 기본값(PENDING·auth.uid())이 들어간다.
  async insertPending(orgId, runId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("recommendation_insights")
      .insert({ org_id: orgId, score_run_id: runId })
      .select("id")
      .single();
    if (error) {
      // 같은 run 에 PENDING 이 있거나(23505) 모델 설명이 이미 있다(23P01). 서비스가 그 행을 다시 읽는다.
      if (error.code === UNIQUE_VIOLATION && error.message.includes(ONE_PENDING)) return null;
      if (error.code === EXCLUSION_VIOLATION && error.message.includes(PENDING_OR_MODEL_ONCE))
        return null;
      throw error;
    }
    return data.id;
  },
};
