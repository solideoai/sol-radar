import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AwardHistoryInsert } from "./award-history.model";

// ── 저장: procurement_award_history upsert. 운영자 CLI(award-backfill)가 service role 클라이언트를 넘긴다 ──
// 웹 서버는 이 파일을 쓰지 않는다(읽기는 award-reference 가 사용자 세션 + RLS 로 한다).

export const AWARD_UPSERT_CHUNK = 500;
const ON_CONFLICT = "bid_notice_no,bid_notice_ord";

export type AwardHistoryRepo = {
  /** 500행씩 (공고번호, 차수) 기준 upsert. 쓴 행 수를 돌려준다 */
  upsert(rows: readonly AwardHistoryInsert[], fetchedAt: string): Promise<number>;
};

/** 실패하면 Postgres 오류 코드만 담아 던진다(메시지·세부는 값이 섞일 수 있어 싣지 않는다). */
export class AwardHistoryWriteFailed extends Error {
  constructor(
    readonly code: string,
    readonly written: number,
  ) {
    super(`낙찰 이력을 쓰지 못했다(code ${code}, 앞서 쓴 행 ${written})`);
    this.name = "AwardHistoryWriteFailed";
  }
}

export function createAwardHistoryRepo(client: SupabaseClient<Database>): AwardHistoryRepo {
  return {
    async upsert(rows, fetchedAt) {
      let written = 0;
      for (let start = 0; start < rows.length; start += AWARD_UPSERT_CHUNK) {
        const chunk = rows
          .slice(start, start + AWARD_UPSERT_CHUNK)
          .map((row) => ({ ...row, fetched_at: fetchedAt }));
        const { error } = await client
          .from("procurement_award_history")
          .upsert(chunk, { onConflict: ON_CONFLICT });
        if (error) throw new AwardHistoryWriteFailed(error.code || "UNKNOWN", written);
        written += chunk.length;
      }
      return written;
    },
  };
}
