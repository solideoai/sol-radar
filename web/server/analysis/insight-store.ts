import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  InsightErrorCode,
  InsightFallbackReason,
  InsightPayload,
  InsightSource,
} from "@/server/insight";
import { toInsightRunSource, type InsightRunSource } from "./insight-request.model";

// ── 추천 분석 저장 port: recommendation_insights 마감과 run 읽기의 Supabase 구현(ADR-066) ──
// worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다. RLS 를 거치지 않으므로 행 하나를 다루는 질의에는 org_id 를 직접 건다.
// 마감은 status = 'PENDING' 인 행만 바꾼다. 이미 닫힌 행(정리가 STALE 로 닫음 등)은 건드리지 않는다.
// 오류 message 에는 표·동작·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

export type InsightFinishDone = {
  insightId: string;
  orgId: string;
  source: InsightSource;
  payload: InsightPayload;
  fallbackReason: InsightFallbackReason | null;
  modelName: string | null;
  promptHash: string;
  finishedAt: string;
};

export type InsightFinishFailed = {
  insightId: string;
  orgId: string;
  errorCode: InsightErrorCode;
  finishedAt: string;
};

export type InsightStore = {
  /** 아직 PENDING 인 행의 run. 없거나 이미 닫혔으면 null. */
  loadPending(insightId: string, orgId: string): Promise<{ scoreRunId: string } | null>;
  /** 끝난(COMPLETED·PARTIAL) run 과 요소·자격 행. 읽을 수 없으면 null. */
  loadRunSource(scoreRunId: string, orgId: string): Promise<InsightRunSource | null>;
  /** 바꿨으면 true. */
  finishDone(input: InsightFinishDone): Promise<boolean>;
  /** 바꿨으면 true. */
  finishFailed(input: InsightFinishFailed): Promise<boolean>;
  /** before 보다 먼저 만든 PENDING 을 모든 조직에서 FAILED(STALE)로 닫고 닫은 수를 돌려준다. */
  sweepStale(before: string, finishedAt: string): Promise<number>;
};

const RUN_COLUMNS =
  "id, org_id, status, input_snapshot, score, recommendation, recommendation_basis, review_flags, missing_factors, kev_assist, injection_suspected";

function failure(table: string, action: string, code: string | undefined): Error {
  return new Error(`${table} ${action} 실패: ${code ?? "UNKNOWN"}`);
}

function toJson(value: InsightPayload): Json {
  const json: Json = JSON.parse(JSON.stringify(value));
  return json;
}

export function createInsightStore(supabase: SupabaseClient<Database>): InsightStore {
  const insights = () => supabase.from("recommendation_insights");

  return {
    async loadPending(insightId, orgId) {
      const { data, error } = await insights()
        .select("score_run_id")
        .eq("id", insightId)
        .eq("org_id", orgId)
        .eq("status", "PENDING")
        .maybeSingle();
      if (error) throw failure("recommendation_insights", "읽기", error.code);
      return data === null ? null : { scoreRunId: data.score_run_id };
    },

    async loadRunSource(scoreRunId, orgId) {
      const { data: run, error } = await supabase
        .from("score_runs")
        .select(RUN_COLUMNS)
        .eq("id", scoreRunId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw failure("score_runs", "읽기", error.code);
      if (run === null) return null;
      const [factors, checks] = await Promise.all([
        supabase
          .from("score_factors")
          .select("factor, points, max_points, note, raw_value")
          .eq("score_run_id", scoreRunId)
          .eq("org_id", orgId),
        supabase
          .from("qualification_checks")
          .select("requirement_name, outcome, reason")
          .eq("score_run_id", scoreRunId)
          .eq("org_id", orgId)
          // 같은 run 이면 늘 같은 순서로 보낸다(필수 먼저, 이름 순).
          .order("mandatory", { ascending: false })
          .order("requirement_name"),
      ]);
      if (factors.error) throw failure("score_factors", "읽기", factors.error.code);
      if (checks.error) throw failure("qualification_checks", "읽기", checks.error.code);
      return toInsightRunSource({ run, factors: factors.data, checks: checks.data });
    },

    async finishDone(input) {
      const { data, error } = await insights()
        .update({
          status: "DONE",
          source: input.source,
          payload: toJson(input.payload),
          fallback_reason: input.fallbackReason,
          model_name: input.modelName,
          prompt_hash: input.promptHash,
          finished_at: input.finishedAt,
        })
        .eq("id", input.insightId)
        .eq("org_id", input.orgId)
        .eq("status", "PENDING")
        .select("id");
      if (error) throw failure("recommendation_insights", "완료 저장", error.code);
      return data.length > 0;
    },

    async finishFailed(input) {
      const { data, error } = await insights()
        .update({ status: "FAILED", error_code: input.errorCode, finished_at: input.finishedAt })
        .eq("id", input.insightId)
        .eq("org_id", input.orgId)
        .eq("status", "PENDING")
        .select("id");
      if (error) throw failure("recommendation_insights", "실패 저장", error.code);
      return data.length > 0;
    },

    async sweepStale(before, finishedAt) {
      const { data, error } = await insights()
        .update({ status: "FAILED", error_code: "STALE", finished_at: finishedAt })
        .eq("status", "PENDING")
        .lt("created_at", before)
        .select("id");
      if (error) throw failure("recommendation_insights", "정리", error.code);
      return data.length;
    },
  };
}
