import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  AnalysisContextLoader,
  AnalysisRunTracker,
  ExtractionCacheKey,
  ScoreRunStatus,
} from "./analysis-job.model";
import type { AnalysisRunRecord, ExtractionRecord } from "./analysis.model";
import type { AnalysisRunSink, ExtractionStore } from "./analysis.service";
import {
  toExtractSource,
  toExtractionRow,
  toFailedUpdate,
  toLoadedContext,
  toQualificationCheckRows,
  toRequirementAssessmentRows,
  toRunningUpdate,
  toScoreFactorRows,
  toScoreRunResultUpdate,
  type AttachmentTextReader,
} from "./analysis-store.model";

// ── 저장: 분석 port 네 개의 Supabase 구현. supabase-js 호출만 두고 규칙은 analysis-store.model 에 둔다 ──
// worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다. service role 은 RLS 를 거치지 않으므로
// 조직 표(score_runs·company_profiles·team_member_scoring·assignments·자식 3표)의 모든 질의·쓰기에 org_id 를 직접 건다.
// 오류는 일반 Error 라 job 이 재시도한다. message 에는 표·동작·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

export type AnalysisStores = {
  loader: AnalysisContextLoader;
  tracker: AnalysisRunTracker;
  extraction: ExtractionStore;
  sink: AnalysisRunSink;
};

type Client = SupabaseClient<Database>;

/** 끝나지 않은 run. 이미 끝난(COMPLETED·PARTIAL·FAILED) run 은 바꾸지 않는다. */
const ACTIVE_RUN_STATUSES: readonly ScoreRunStatus[] = ["QUEUED", "RUNNING"];
/** 캐시로 쓸 수 있는 추출 행(e8 판정 2: 성공 행만 저장한다). */
const SUCCESS_EXTRACTION_STATUSES: readonly string[] = ["COMPLETED", "PENDING_REVIEW"];

const SCORE_RUN_COLUMNS =
  "id, org_id, bid_id, revision_id, company_profile_id, idempotency_key, status, queued_at";
const REVISION_COLUMNS = "id, bid_id, revision, raw_payload, normalized, fetched_at";
const STRUCTURED_COLUMNS = "kind, seq, code, name, value, source_operation";
const EXTRACTION_COLUMNS = "id, status, payload, translations";
const PROFILE_COLUMNS =
  "revision, name, is_demo, technologies, technologies_complete, licenses, industry_codes, past_projects, financials, preferences";
const TEAM_SCORING_COLUMNS = "member_id, role, grade, skills, availability";
const ASSIGNMENT_COLUMNS = "member_id, starts_at, ends_at, allocation_percent";

/** "analysis store 오류: <표>.<동작> <code>". code 가 없으면 UNKNOWN 이다. */
function storeError(table: string, action: string, error: { code?: string | null }): Error {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  return new Error(`analysis store 오류: ${table}.${action} ${code}`);
}

function createLoader(client: Client, attachments: AttachmentTextReader): AnalysisContextLoader {
  return {
    async load(target, cacheKey) {
      const run = await client
        .from("score_runs")
        .select(SCORE_RUN_COLUMNS)
        .eq("id", target.scoreRunId)
        .eq("org_id", target.orgId)
        .maybeSingle();
      if (run.error) throw storeError("score_runs", "select", run.error);
      if (run.data === null) return null;
      const scoreRun = run.data;

      const revision = await client
        .from("bid_revisions")
        .select(REVISION_COLUMNS)
        .eq("id", scoreRun.revision_id)
        .eq("bid_id", scoreRun.bid_id)
        .maybeSingle();
      if (revision.error) throw storeError("bid_revisions", "select", revision.error);
      if (revision.data === null) return null;

      const structured = await client
        .from("bid_structured_requirements")
        .select(STRUCTURED_COLUMNS)
        .eq("revision_id", scoreRun.revision_id)
        .order("kind")
        .order("seq");
      if (structured.error) {
        throw storeError("bid_structured_requirements", "select", structured.error);
      }

      const extraction = await selectCachedExtraction(client, scoreRun.revision_id, cacheKey);

      const profile = await client
        .from("company_profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", scoreRun.company_profile_id)
        .eq("org_id", target.orgId)
        .maybeSingle();
      if (profile.error) throw storeError("company_profiles", "select", profile.error);
      if (profile.data === null) return null;

      const teamScoring = await client
        .from("team_member_scoring")
        .select(TEAM_SCORING_COLUMNS)
        .eq("org_id", target.orgId)
        .order("member_id");
      if (teamScoring.error) throw storeError("team_member_scoring", "select", teamScoring.error);

      const assignments = await client
        .from("assignments")
        .select(ASSIGNMENT_COLUMNS)
        .eq("org_id", target.orgId)
        .order("member_id")
        .order("starts_at");
      if (assignments.error) throw storeError("assignments", "select", assignments.error);

      const documents = await attachments.readRevisionDocuments(scoreRun.revision_id);

      return toLoadedContext({
        scoreRun,
        revision: revision.data,
        structured: structured.data,
        extraction,
        profile: profile.data,
        teamScoring: teamScoring.data,
        assignments: assignments.data,
        documents,
      });
    },
  };
}

/**
 * 그 revision 의 가장 최근 성공 추출 1행. cacheKey 가 있으면 (model_name, prompt_hash) 가 같은 행만,
 * null(gateway /health 실패)이면 어떤 모델이 추출했는지 모르므로 키와 상관없이 고른다(e8 판정 S6).
 */
async function selectCachedExtraction(
  client: Client,
  revisionId: string,
  cacheKey: ExtractionCacheKey,
) {
  const successRows = client
    .from("requirement_extractions")
    .select(EXTRACTION_COLUMNS)
    .eq("revision_id", revisionId)
    .in("status", SUCCESS_EXTRACTION_STATUSES);
  const keyed =
    cacheKey === null
      ? successRows
      : successRows.eq("model_name", cacheKey.modelName).eq("prompt_hash", cacheKey.promptHash);
  const extraction = await keyed.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (extraction.error) throw storeError("requirement_extractions", "select", extraction.error);
  return extraction.data;
}

function createExtractionStore(client: Client, attachments: AttachmentTextReader): ExtractionStore {
  return {
    async loadSource(context) {
      const revisionId = context.bid.revisionId;
      const revision = await client
        .from("bid_revisions")
        .select("normalized")
        .eq("id", revisionId)
        .eq("bid_id", context.bidId)
        .single();
      if (revision.error) throw storeError("bid_revisions", "select", revision.error);
      return toExtractSource(
        revision.data.normalized,
        await attachments.readRevisionDocuments(revisionId),
      );
    },

    async save(record: ExtractionRecord) {
      const saved = await client
        .from("requirement_extractions")
        .upsert(toExtractionRow(record), { onConflict: "revision_id,model_name,prompt_hash" })
        .select("id")
        .single();
      if (saved.error) throw storeError("requirement_extractions", "upsert", saved.error);
      return { id: saved.data.id };
    },
  };
}

/** 바뀐 행 수는 보지 않는다. 이미 끝난 run 이면 0행이 맞다. */
function createTracker(client: Client): AnalysisRunTracker {
  return {
    async markRunning(input) {
      const updated = await client
        .from("score_runs")
        .update(toRunningUpdate(input))
        .eq("id", input.scoreRunId)
        .eq("org_id", input.orgId)
        .in("status", ACTIVE_RUN_STATUSES);
      if (updated.error) throw storeError("score_runs", "update", updated.error);
    },

    async markFailed(input) {
      const updated = await client
        .from("score_runs")
        .update(toFailedUpdate(input))
        .eq("id", input.scoreRunId)
        .eq("org_id", input.orgId)
        .in("status", ACTIVE_RUN_STATUSES);
      if (updated.error) throw storeError("score_runs", "update", updated.error);
    },
  };
}

/**
 * 자식 3표를 모두 쓴 뒤에 score_runs 를 마감한다(e8 판정 3). 중간에 실패하면 마감하지 않고 던진다.
 * run 이 RUNNING 으로 남아 재시도가 같은 행을 다시 쓴다(score_factors 는 요소가 늘 다섯이라 upsert,
 * requirement_assessments·qualification_checks 는 그 run 의 행을 지우고 넣는다).
 */
function createSink(client: Client): AnalysisRunSink {
  return {
    async save(record: AnalysisRunRecord) {
      const factors = await client
        .from("score_factors")
        .upsert(toScoreFactorRows(record), { onConflict: "score_run_id,factor" });
      if (factors.error) throw storeError("score_factors", "upsert", factors.error);

      // 재시도가 다른 추출로 항목을 줄이면 upsert 는 옛 항목 행을 남긴다. 그 run 의 행을 지우고 넣는다.
      const removedAssessments = await client
        .from("requirement_assessments")
        .delete()
        .eq("score_run_id", record.scoreRunId)
        .eq("org_id", record.orgId);
      if (removedAssessments.error) {
        throw storeError("requirement_assessments", "delete", removedAssessments.error);
      }

      const assessmentRows = toRequirementAssessmentRows(record);
      if (assessmentRows.length > 0) {
        const assessments = await client.from("requirement_assessments").insert(assessmentRows);
        if (assessments.error) {
          throw storeError("requirement_assessments", "insert", assessments.error);
        }
      }

      const removed = await client
        .from("qualification_checks")
        .delete()
        .eq("score_run_id", record.scoreRunId)
        .eq("org_id", record.orgId);
      if (removed.error) throw storeError("qualification_checks", "delete", removed.error);

      const checkRows = toQualificationCheckRows(record);
      if (checkRows.length > 0) {
        const checks = await client.from("qualification_checks").insert(checkRows);
        if (checks.error) throw storeError("qualification_checks", "insert", checks.error);
      }

      const finished = await client
        .from("score_runs")
        .update(toScoreRunResultUpdate(record))
        .eq("id", record.scoreRunId)
        .eq("org_id", record.orgId)
        .in("status", ACTIVE_RUN_STATUSES)
        .select("id");
      if (finished.error) throw storeError("score_runs", "finish", finished.error);
      // 다른 시도가 이미 끝냈거나 FAILED 로 표시한 run 이다.
      if (finished.data.length === 0) {
        throw new Error("analysis store 오류: score_runs.finish NOT_RUNNING");
      }
    },
  };
}

/** service role 클라이언트로 네 port 를 만든다. 클라이언트는 받기만 하고 모듈에 담아 두지 않는다. */
export function createAnalysisStores(
  client: SupabaseClient<Database>,
  attachments: AttachmentTextReader,
): AnalysisStores {
  return {
    loader: createLoader(client, attachments),
    tracker: createTracker(client),
    extraction: createExtractionStore(client, attachments),
    sink: createSink(client),
  };
}
