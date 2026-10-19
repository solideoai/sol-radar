import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type PendingDocument = { id: string; bidId: string; revisionId: string };
export type PendingDocumentFinder = {
  findPendingDocuments(input: { after: string | null; limit: number }): Promise<PendingDocument[]>;
};

export function createPendingDocumentFinder(
  client: SupabaseClient<Database>,
): PendingDocumentFinder {
  return {
    async findPendingDocuments({ after, limit }) {
      const pending = client
        .from("bid_documents")
        .select("id,bid_id,revision_id")
        .eq("download_status", "PENDING")
        .order("id")
        .limit(limit);
      const { data, error } = await (after === null ? pending : pending.gt("id", after));
      if (error) throw new Error("문서 복구 조회 실패");
      return data.map((row) => ({ id: row.id, bidId: row.bid_id, revisionId: row.revision_id }));
    },
  };
}
