import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type PendingDocument = {
  id: string;
  bidId: string;
  revisionId: string;
  /** 첨부가 속한 bid_revisions 행의 created_at. documents jobId 를 만든다(C1') */
  revisionCreatedAt: string;
};
export type PendingDocumentFinder = {
  /** isDemo: 실행 모드 범위(C6'). mock·fixture 는 데모 공고(true)만, live 는 실제 공고(false)만 본다 */
  findPendingDocuments(input: {
    after: string | null;
    limit: number;
    isDemo: boolean;
  }): Promise<PendingDocument[]>;
};

// C2': 다운로드를 기다리는 첨부(PENDING)와, 다운로드는 됐지만 파싱을 기다리는 첨부(OK·PENDING)가 복구 대상이다.
const PENDING_FILTER =
  "download_status.eq.PENDING,and(download_status.eq.OK,parse_status.eq.PENDING)";

export function createPendingDocumentFinder(
  client: SupabaseClient<Database>,
): PendingDocumentFinder {
  return {
    async findPendingDocuments({ after, limit, isDemo }) {
      // !inner 라 공고·revision 이 조건에 맞지 않는 첨부는 행째 빠진다. 공고 범위는 bid_notices.is_demo 로 거른다(C6').
      const pending = client
        .from("bid_documents")
        .select("id,bid_id,revision_id,bid_notices!inner(is_demo),bid_revisions!inner(created_at)")
        .eq("bid_notices.is_demo", isDemo)
        .or(PENDING_FILTER)
        .order("id")
        .limit(limit);
      const { data, error } = await (after === null ? pending : pending.gt("id", after));
      if (error) throw new Error("문서 복구 조회 실패");
      return data.map((row) => ({
        id: row.id,
        bidId: row.bid_id,
        revisionId: row.revision_id,
        revisionCreatedAt: row.bid_revisions.created_at,
      }));
    },
  };
}
