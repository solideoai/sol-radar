import "server-only";
import { createHash } from "node:crypto";
import { isPlainRecord } from "./normalize-common";
import { normalizedBidSchema } from "./normalized-bid.model";
import { projectProcurementRevision } from "./procurement-projection";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/database.types";
import type { FixtureBatch } from "./fixture.model";
import type { IngestionRepo, IngestRunSource, IngestTrigger, StartedRun } from "./ingestion.port";
import {
  anchorOfParams,
  dbErrorCodeOf,
  toIngestErrorInsert,
  toIngestRunInsert,
  toLatestRunWindow,
  toManualAuditInsert,
  toQuotaUsedUpdate,
  toSaveRevisionParams,
  toStartedRun,
  toStoredRevision,
  toStructuredRequirementInserts,
  toSummaryJson,
  windowEndOfParams,
} from "./ingestion.store";

// 포트 타입은 ingestion.port.ts 에 있다. 구현(이 파일)·변환(store)이 서로를 import 하지 않게 나눴다.
export { EMPTY_INGEST_SUMMARY } from "./ingestion.port";
export type {
  IngestRunSource,
  IngestRunMode,
  IngestTrigger,
  IngestRunStatus,
  IngestSummary,
  StartRunInput,
  StartedRun,
  IngestErrorInput,
  SavedRevisionDecision,
  SaveRevisionInput,
  SavedRevision,
  IngestionRepo,
  LatestRunWindow,
} from "./ingestion.port";

// ── Supabase 구현(service role). worker·demo:reset 이 관리자 연결을 넘긴다 ──
// RLS 를 무시하는 연결이라 쓰는 표는 공용 수집 표(ingest_*·bid_*·outbox)와 조직을 명시한 감사 한 줄뿐이다.
// 오류에는 표 이름과 코드만 싣는다. PostgREST 의 message·details 는 행 값을 담을 수 있다.
type AdminClient = SupabaseClient<Database>;
type DbError = { code?: string; message?: string };

const UNIQUE_VIOLATION = "23505";
const FINISHED_RUN_STATUSES = ["SUCCEEDED", "PARTIAL"] as const;
// bid_structured_requirements_revision_id_kind_seq_key. 같은 revision 에 다시 쓰면 덮어써 멱등이다.
const STRUCTURED_CONFLICT_TARGET = "revision_id,kind,seq";

const repoError = (target: string, error: DbError): Error =>
  new Error(`수집 저장소: ${target} 실패 (${dbErrorCodeOf(error)})`);

export function createSupabaseIngestionRepo(
  client: AdminClient,
  options: { now?: () => Date } = {},
): IngestionRepo {
  const now = options.now ?? (() => new Date());

  const startedOf = (row: Tables<"ingest_runs">): StartedRun => ({
    ...toStartedRun(row),
    completeness:
      row.completeness === "PARTIAL"
        ? "PARTIAL"
        : row.completeness === "UNKNOWN"
          ? "UNKNOWN"
          : "COMPLETE",
    fetchedCount: row.fetched_count,
  });

  const findRun = async (jobKey: string): Promise<Tables<"ingest_runs"> | null> => {
    const { data, error } = await client
      .from("ingest_runs")
      .select("*")
      .eq("job_key", jobKey)
      .maybeSingle();
    if (error) throw repoError("ingest_runs 조회", error);
    return data;
  };

  // 끝나지 않은(RUNNING·FAILED) run 은 다시 RUNNING 으로 열어 저장된 cursor 부터 잇는다. 끝난 run 은 그대로 돌려준다.
  const reopen = async (row: Tables<"ingest_runs">): Promise<StartedRun> => {
    const started = startedOf(row);
    if (
      started.status === "SUCCEEDED" ||
      (started.status === "PARTIAL" && started.completeness === "COMPLETE")
    )
      return started;
    const { data, error } = await client
      .from("ingest_runs")
      .update({ status: "RUNNING", finished_at: null })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw repoError("ingest_runs 재개", error);
    return startedOf(data);
  };

  const latestFinishedParams = async (
    source: IngestRunSource,
    filter: { batch: FixtureBatch } | { trigger: IngestTrigger },
  ): Promise<Json | null> => {
    const base = client
      .from("ingest_runs")
      .select("params")
      .eq("source", source)
      .in("status", [...FINISHED_RUN_STATUSES]);
    const query =
      "batch" in filter ? base.eq("batch", filter.batch) : base.eq("trigger", filter.trigger);
    const { data, error } = await query
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw repoError("ingest_runs 조회", error);
    return data?.params ?? null;
  };

  return {
    async startRun(input) {
      const existing = await findRun(input.jobKey);
      if (existing) return reopen(existing);
      const { data, error } = await client
        .from("ingest_runs")
        .insert({
          ...toIngestRunInsert(input),
          service_key: input.serviceKey ?? null,
          operation: input.operation ?? null,
          partition_key: input.partitionKey ?? null,
          completeness: input.serviceKey === undefined ? "COMPLETE" : "UNKNOWN",
        })
        .select("*")
        .single();
      if (!error) return startedOf(data);
      // 같은 jobKey 를 두 worker 가 동시에 열면 하나만 들어간다. 진 쪽은 들어간 run 을 이어 받는다.
      if (error.code === UNIQUE_VIOLATION) {
        const raced = await findRun(input.jobKey);
        if (raced) return reopen(raced);
      }
      throw repoError("ingest_runs 추가", error);
    },

    async findLatestRevision(source, noticeId) {
      const notice = await client
        .from("bid_notices")
        .select("id")
        .eq("source", source)
        .eq("notice_id", noticeId)
        .maybeSingle();
      if (notice.error) throw repoError("bid_notices 조회", notice.error);
      if (!notice.data) return null;
      const revision = await client
        .from("bid_revisions")
        .select("bid_id, revision, checksum, normalized")
        .eq("bid_id", notice.data.id)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (revision.error) throw repoError("bid_revisions 조회", revision.error);
      return revision.data ? toStoredRevision(revision.data) : null;
    },

    async findLatestSeedAnchor(source) {
      return anchorOfParams(await latestFinishedParams(source, { batch: "SEED" }));
    },

    async findLatestRunWindowEnd(source, trigger, scope = {}) {
      let query = client
        .from("ingest_runs")
        .select("params")
        .eq("source", source)
        .eq("trigger", trigger)
        .eq("status", "SUCCEEDED")
        .eq("completeness", "COMPLETE");
      if (source === "g2b" && scope.serviceKey === "g2b-bid-notice") {
        // 서비스 구분 전의 G2B 이력은 입찰공고뿐이었다. 새 조달요청 창과 섞지 않고 이어 읽는다.
        query = query.or("service_key.eq.g2b-bid-notice,service_key.is.null");
      } else if (scope.serviceKey !== undefined) {
        query = query.eq("service_key", scope.serviceKey);
      }
      if (scope.operation !== undefined) query = query.eq("operation", scope.operation);
      if (scope.partitionKey !== undefined) query = query.eq("partition_key", scope.partitionKey);
      const { data, error } = await query
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw repoError("ingest_runs 성공 창 조회", error);
      return windowEndOfParams(data?.params ?? null);
    },

    // C8: 상태와 상관없이 가장 최근 run 이다(FAILED 창을 다시 쓰려고). 끝난 run 만 보는 위 둘과 다르다.
    async findLatestRunWindow(source, trigger, scope = {}) {
      let query = client
        .from("ingest_runs")
        .select("status, params, completeness")
        .eq("source", source)
        .eq("trigger", trigger);
      if (source === "g2b" && scope.serviceKey === "g2b-bid-notice") {
        query = query.or("service_key.eq.g2b-bid-notice,service_key.is.null");
      } else if (scope.serviceKey !== undefined) {
        query = query.eq("service_key", scope.serviceKey);
      }
      if (scope.operation !== undefined) query = query.eq("operation", scope.operation);
      if (scope.partitionKey !== undefined) query = query.eq("partition_key", scope.partitionKey);
      const { data, error } = await query
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw repoError("ingest_runs 조회", error);
      return data
        ? {
            ...toLatestRunWindow(data),
            completeness:
              data.completeness === "PARTIAL"
                ? "PARTIAL"
                : data.completeness === "UNKNOWN"
                  ? "UNKNOWN"
                  : "COMPLETE",
          }
        : null;
    },

    async saveRevision(input) {
      const { data, error } = await client.rpc("ingest_save_revision", {
        p: toSaveRevisionParams(input),
      });
      if (error) throw repoError("ingest_save_revision", error);
      const [saved] = data ?? [];
      if (!saved)
        throw new Error("수집 저장소: ingest_save_revision 이 저장한 행을 돌려주지 않았다");
      // RPC 는 (bid_id, revision_id) 만 돌려준다. documents jobId(C1')에 쓸 created_at 은 저장한 행에서 따로 읽는다.
      const created = await client
        .from("bid_revisions")
        .select("created_at")
        .eq("id", saved.revision_id)
        .eq("bid_id", saved.bid_id)
        .single();
      if (created.error) throw repoError("bid_revisions 조회", created.error);
      // 구조화 자격은 RPC 밖에서 쓴다(RPC 는 이 표를 모른다). 행이 없으면 요청을 보내지 않는다.
      const structured = toStructuredRequirementInserts(
        { bidId: saved.bid_id, revisionId: saved.revision_id },
        input.decision.bid.structuredQualifications,
      );
      if (structured.length > 0) {
        const upserted = await client
          .from("bid_structured_requirements")
          .upsert(structured, { onConflict: STRUCTURED_CONFLICT_TARGET });
        if (upserted.error) throw repoError("bid_structured_requirements 저장", upserted.error);
      }
      await projectProcurementRevision(client, {
        bidId: saved.bid_id,
        revisionId: saved.revision_id,
        bid: input.decision.bid,
        rawPayload: input.rawPayload,
      });
      return {
        bidId: saved.bid_id,
        revisionId: saved.revision_id,
        revisionCreatedAt: created.data.created_at,
      };
    },

    async ensureRevisionProjection(source, noticeId) {
      const notice = await client
        .from("bid_notices")
        .select("id")
        .eq("source", source)
        .eq("notice_id", noticeId)
        .maybeSingle();
      if (notice.error) throw repoError("bid_notices 투영 복구 조회", notice.error);
      if (!notice.data) return;
      const row = await client
        .from("bid_revisions")
        .select("id,normalized,raw_payload")
        .eq("bid_id", notice.data.id)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row.error) throw repoError("bid_revisions 투영 복구 조회", row.error);
      if (!row.data) return;
      const parsed = normalizedBidSchema.safeParse(row.data.normalized);
      if (!parsed.success || !isPlainRecord(row.data.raw_payload))
        throw new Error("수집 저장소: 투영 복구 스키마 오류");
      await projectProcurementRevision(client, {
        bidId: notice.data.id,
        revisionId: row.data.id,
        bid: parsed.data,
        rawPayload: row.data.raw_payload,
      });
    },

    async recordPayload(runId, capture) {
      const payloadHash = createHash("sha256").update(capture.sanitizedPayload).digest("hex");
      const payload: Json =
        capture.contentType === "application/json"
          ? JSON.parse(capture.sanitizedPayload)
          : { xml: capture.sanitizedPayload };
      if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 2 * 1024 * 1024)
        throw new Error("수집 저장소: 정제 원본 증거 크기 초과");
      const row = {
        run_id: runId,
        service_key: capture.serviceKey,
        operation: capture.operation,
        partition_key: capture.partitionKey,
        content_type: capture.contentType,
        sanitized_payload: payload,
        payload_hash: payloadHash,
      };
      const saved = await client
        .from("ingest_payloads")
        .upsert(row, { onConflict: "run_id,service_key,operation,partition_key,payload_hash" })
        .select("id")
        .single();
      if (saved.error) throw repoError("ingest_payloads 저장", saved.error);
      return saved.data.id;
    },

    async recordRunItem(runId, item) {
      const result = await client
        .from("ingest_run_items")
        .upsert(
          {
            run_id: runId,
            source_record_key: item.sourceRecordKey,
            payload_hash: item.payloadHash,
            payload_id: item.payloadId,
            bid_id: item.bidId ?? null,
            revision_id: item.revisionId ?? null,
            outcome: item.outcome,
            error_code: item.errorCode ?? null,
          },
          { onConflict: "run_id,source_record_key,payload_hash", ignoreDuplicates: true },
        )
        .select("id");
      if (result.error) throw repoError("ingest_run_items 저장", result.error);
      return (result.data?.length ?? 0) > 0;
    },

    async recordError(runId, error) {
      const result = await client.from("ingest_errors").insert(toIngestErrorInsert(runId, error));
      if (result.error) throw repoError("ingest_errors 추가", result.error);
    },

    async saveCheckpoint(runId, checkpoint) {
      const { error } = await client
        .from("ingest_runs")
        .update({
          cursor: checkpoint.cursor,
          ...(checkpoint.completeness === undefined
            ? {}
            : { completeness: checkpoint.completeness }),
          ...(checkpoint.fetchedCount === undefined
            ? {}
            : { fetched_count: checkpoint.fetchedCount }),
          summary: toSummaryJson(checkpoint.summary),
          ...toQuotaUsedUpdate(checkpoint.quotaUsed),
        })
        .eq("id", runId);
      if (error) throw repoError("ingest_runs 체크포인트", error);
    },

    async finishRun(runId, result) {
      const { error } = await client
        .from("ingest_runs")
        .update({
          status: result.status,
          ...(result.completeness === undefined ? {} : { completeness: result.completeness }),
          ...(result.fetchedCount === undefined ? {} : { fetched_count: result.fetchedCount }),
          summary: toSummaryJson(result.summary),
          finished_at: now().toISOString(),
          ...toQuotaUsedUpdate(result.quotaUsed),
        })
        .eq("id", runId);
      if (error) throw repoError("ingest_runs 종료", error);
    },
  };
}

/** 수동 수집 감사(6-6). audit_logs 에 조직·요청자·run 을 남긴다. */
export function createSupabaseIngestAudit(
  client: AdminClient,
): (input: { orgId: string; actorId: string | null; runId: string }) => Promise<void> {
  return async (input) => {
    const { error } = await client.from("audit_logs").insert(toManualAuditInsert(input));
    if (error) throw repoError("audit_logs 추가", error);
  };
}
