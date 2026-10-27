import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PendingDocumentFinder } from "@/server/ingestion";
import { claimResultSchema, type DocumentProcessingRepo } from "./document-processing.model";

// ── documents job 의 저장 port. worker 가 service role 클라이언트를 넘긴다(웹 runtime 에서는 쓰지 않는다) ──
// 상태 전이는 DB 함수(20261027000500)가 리스 소유를 확인하며 한다. 원본·텍스트 확정은 finish_document_storage(00700) 몫이다.
// 오류 message 에는 표·함수·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

type Client = SupabaseClient<Database>;

const storeError = (target: string, error: { code?: string | null }): Error =>
  new Error(
    `documents store 오류: ${target} ${typeof error.code === "string" && error.code ? error.code : "UNKNOWN"}`,
  );

/** keyset 커서의 첫 값. revision id 는 gen_random_uuid(v4)라 모두 이 값보다 크다 */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function createDocumentProcessingRepo(client: Client): DocumentProcessingRepo {
  return {
    async loadRevision({ bidId, revisionId }) {
      const revision = await client
        .from("bid_revisions")
        .select(
          "id, bid_id, revision, created_at, bid_notices!inner(is_demo, status, deadline_at, latest_revision)",
        )
        .eq("id", revisionId)
        .eq("bid_id", bidId)
        .maybeSingle();
      if (revision.error) throw storeError("bid_revisions.select", revision.error);
      if (revision.data === null) return null;
      const documents = await client
        .from("bid_documents")
        .select("id, name, download_status, parse_status")
        .eq("revision_id", revisionId)
        .eq("bid_id", bidId);
      if (documents.error) throw storeError("bid_documents.select", documents.error);
      const notice = revision.data.bid_notices;
      return {
        bidId: revision.data.bid_id,
        revisionId: revision.data.id,
        revision: revision.data.revision,
        createdAt: revision.data.created_at,
        notice: {
          isDemo: notice.is_demo,
          status: notice.status,
          deadlineAt: notice.deadline_at,
          latestRevision: notice.latest_revision,
        },
        documents: documents.data.map((row) => ({
          id: row.id,
          name: row.name,
          downloadStatus: row.download_status,
          parseStatus: row.parse_status,
        })),
      };
    },

    async claim(documentId, attemptId, leaseSeconds) {
      const { data, error } = await client.rpc("claim_document_processing", {
        p_document_id: documentId,
        p_attempt_id: attemptId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw storeError("claim_document_processing", error);
      const parsed = claimResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("documents store 오류: claim_document_processing SHAPE");
      return parsed.data;
    },

    async failDownload({ documentId, attemptId, errorCode, message }) {
      const { data, error } = await client.rpc("fail_document_download", {
        p_document_id: documentId,
        p_attempt_id: attemptId,
        p_error_code: errorCode,
        p_error_message: message,
      });
      if (error) throw storeError("fail_document_download", error);
      return data === true;
    },

    async failParse({ documentId, attemptId, status, errorCode, parserId, message }) {
      const { data, error } = await client.rpc("fail_document_parse", {
        p_document_id: documentId,
        p_attempt_id: attemptId,
        p_parse_status: status,
        p_error_code: errorCode,
        p_parser_id: parserId,
        p_error_message: message,
      });
      if (error) throw storeError("fail_document_parse", error);
      return data === true;
    },

    async release(documentId, attemptId) {
      const { data, error } = await client.rpc("release_document_processing", {
        p_document_id: documentId,
        p_attempt_id: attemptId,
      });
      if (error) throw storeError("release_document_processing", error);
      return data === true;
    },
  };
}

/**
 * 복구 회차가 job 을 넣을 revision(documents 전용 worker). 처리 범위(최신 revision·접수 중·마감 전·파서 형식·공고당 상한)는
 * DB 함수 document_processing_candidates 가 거른다. 돌려주는 id 는 keyset 커서 키(revision id)다.
 * live 만 쓴다: mock·fixture 의 옛 복구(@/server/ingestion createPendingDocumentFinder)는 그대로 둔다.
 */
export function createDocumentCandidateFinder(
  client: Client,
  options: { maxPerBid: number },
): PendingDocumentFinder {
  return {
    async findPendingDocuments({ after, limit, isDemo }) {
      const { data, error } = await client.rpc("document_processing_candidates", {
        p_is_demo: isDemo,
        p_after: after ?? NIL_UUID,
        p_limit: limit,
        p_max_per_bid: options.maxPerBid,
      });
      if (error) throw storeError("document_processing_candidates", error);
      return data.map((row) => ({
        id: row.revision_id,
        bidId: row.bid_id,
        revisionId: row.revision_id,
        revisionCreatedAt: row.revision_created_at,
      }));
    },
  };
}
