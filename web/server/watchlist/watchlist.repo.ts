import "server-only";
import { getSupabase } from "@/server/supabase";
import type { WatchlistRepo } from "./watchlist.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// bid_watches 의 RLS 가 본인 행(user_id = auth.uid(), 내 조직)만 연다. 그래도 org_id·user_id 를 조건에 적어
// 화면이 확인한 지금 조직 하나로 좁힌다(M17: 업무 조직은 하나다).
export const watchlistRepo: WatchlistRepo = {
  async bidExists(bidId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("bid_notices")
      .select("id")
      .eq("id", bidId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  // 이미 있으면 아무것도 하지 않는다(PK 충돌을 오류로 내지 않는다 — 두 창에서 동시에 눌러도 200).
  async addWatch({ orgId, userId }, bidId) {
    const { error } = await (
      await getSupabase()
    )
      .from("bid_watches")
      .upsert(
        { org_id: orgId, user_id: userId, bid_id: bidId },
        { onConflict: "org_id,user_id,bid_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  },

  async removeWatch({ orgId, userId }, bidId) {
    const { error } = await (
      await getSupabase()
    )
      .from("bid_watches")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("bid_id", bidId);
    if (error) throw error;
  },

  async isWatching({ orgId, userId }, bidId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("bid_watches")
      .select("bid_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("bid_id", bidId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  async countWatchers(bidId) {
    const { data, error } = await (
      await getSupabase()
    ).rpc("bid_watch_count", {
      p_bid_id: bidId,
    });
    if (error) throw error;
    return data;
  },

  async listMyWatchedBidIds({ orgId, userId }) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("bid_watches")
      .select("bid_id")
      .eq("org_id", orgId)
      .eq("user_id", userId);
    if (error) throw error;
    return data.map((row) => row.bid_id);
  },
};
