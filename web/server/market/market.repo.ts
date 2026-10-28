import "server-only";
import { getSupabase } from "@/server/supabase";
import { marketRowSchema, type MarketRow } from "./market.model";

export type MarketRepo = {
  /** 이 조직의 live 나라장터 입찰공고 중 readFrom 이후 게시·asOf 까지 처음 본 것 전부 */
  listLiveNotices(orgId: string, readFrom: string, asOf: string): Promise<MarketRow[]>;
};

// PostgREST 한 번의 응답 상한(max_rows 기본 1,000)을 넘지 않게 id 순으로 나눠 읽는다.
const PAGE_SIZE = 1000;
// 끝없는 반복을 막는 상한(20,000건). 넘으면 숫자를 덜 세지 않도록 읽기 실패로 둔다.
const MAX_PAGES = 20;
const COLUMNS =
  "id,bid_id,title,agency,status,budget_krw,source_conflict,published_at,deadline_at,categories,relevance_state";

// 사업기회 뷰(security_invoker)를 anon 키 + 세션으로 읽는다. 조직 격리는 RLS 가 한다.
// live 범위는 procurement_summary·procurement_live_metrics 와 같다(is_demo=false, 데모 수집기 아님, 처음 본 시각 ≤ 기준).
// 화면 배지("나라장터 입찰공고 수집분")와 맞게 대표 공고 출처가 나라장터(G2B)이고 입찰공고(NOTICE) 단계인 것만 읽는다.
export const marketRepo: MarketRepo = {
  async listLiveNotices(orgId, readFrom, asOf) {
    const client = await getSupabase();
    const rows: MarketRow[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let request = client
        .from("opportunity_list_items")
        .select(COLUMNS)
        .eq("org_id", orgId)
        .eq("is_demo", false)
        .neq("source", "fixture")
        .eq("source_family", "G2B")
        .eq("stage", "NOTICE")
        .lte("first_seen_at", asOf)
        .gte("published_at", readFrom)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (after !== null) request = request.gt("id", after);
      const { data, error } = await request;
      if (error) throw new Error("발주 현황 데이터를 읽지 못했습니다");
      for (const r of data)
        rows.push(
          marketRowSchema.parse({
            bidId: r.bid_id,
            title: r.title,
            agency: r.agency,
            status: r.status,
            budgetKrw: r.budget_krw,
            sourceConflict: r.source_conflict ?? false,
            publishedAt: r.published_at,
            deadlineAt: r.deadline_at,
            categories: r.categories ?? [],
            relevanceState: r.relevance_state ?? "UNCLASSIFIED",
          }),
        );
      const last = data.at(-1)?.id ?? null;
      if (data.length < PAGE_SIZE || last === null) return rows;
      after = last;
    }
    throw new Error("발주 현황 대상 공고가 너무 많아 집계하지 못했습니다");
  },
};
