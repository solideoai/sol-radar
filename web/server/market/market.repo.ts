import "server-only";
import { getSupabase } from "@/server/supabase";
import { marketRowSchema, type MarketRow } from "./market.model";

export type MarketRepo = {
  /** 이 조직의 live 사업기회 중 나라장터 사본이 있고 readFrom 이후 게시·asOf 까지 처음 본 입찰공고 전부 */
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
// 화면 배지("나라장터 입찰공고 수집분")와 맞게 출처 사본 중 나라장터(G2B)가 하나라도 있는 사업기회만 읽는다.
// 대표 공고 출처(source_family)로 거르지 않는다. 같은 사업이면 refresh_bid_opportunity 가 KWATER·LH·KEPCO 를
// 나라장터보다 대표로 골라, 나라장터에도 실린 공고가 빠지기 때문이다. 단계(NOTICE)·제목·기관·예산·마감은 대표 공고 값이다.
// 한계: source_families 는 단계와 상관없이 모든 사본(STAGE_LINK 포함)의 출처를 모은다. 그래서 나라장터 사본이 사전규격뿐인
// LH 등 입찰공고도 센다. live 나라장터 사전규격 수집이 꺼져 있어 지금 영향은 없다(뷰는 바꾸지 않는다, 2026-10-28 재리뷰 8).
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
        .contains("source_families", ["G2B"])
        .eq("stage", "NOTICE")
        .lte("first_seen_at", asOf)
        .gte("published_at", readFrom)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (after !== null) request = request.gt("id", after);
      const { data, error } = await request;
      if (error) throw new Error("발주 현황 데이터를 읽지 못했습니다", { cause: error });
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
