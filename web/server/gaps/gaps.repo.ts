import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/server/supabase";
import type { GapNoticeRow } from "./gaps.model";

// 로그인한 사람의 클라이언트(anon + RLS)로 읽는다. 공고·revision·구조화 요건·관련성 표는 활동 중 회원 읽기다.
// 대상(§5 A1): live(is_demo=false, 데모 수집기 아님) 입찰공고(stage=NOTICE)이고 OPEN·AMENDED, 마감이 지금 이후.
// 중복 출처는 사업기회 목록(opportunity_list_items)처럼 대표 공고(canonical, superseded_by 없음)만 센다.
// PostgREST 한 번 응답은 1,000행까지라 id 순으로 나눠 읽는다. offset 이 아니라 마지막 id 다음부터 읽어(keyset)
// 수집 Worker 가 도는 중 페이지 사이에 행이 들어오거나 빠져도 같은 공고를 두 번 세거나 건너뛰지 않는다.

export type GapsRepo = {
  liveNotices: (nowIso: string) => Promise<GapNoticeRow[]>;
};

const PAGE = 500;
const COLUMNS =
  // budget_krw 는 numeric 이라 text 로 읽어 정밀도를 지킨다(opportunity_list_items 와 같은 방식).
  "id,title,agency,stage,budget_krw:budget_krw::text,deadline_at,latest_revision,last_synced_at," +
  "opportunity:bid_opportunities!bid_opportunities_canonical_notice_id_fkey!inner(superseded_by)," +
  "revisions:bid_revisions!bid_revisions_bid_id_fkey(id,revision,fetched_at,aux:normalized->auxLookup," +
  "requirements:bid_structured_requirements!bid_structured_requirements_revision_fkey(kind,seq,code,name,value,source_operation)," +
  "relevance:bid_relevance_assessments!bid_relevance_assessments_revision_id_fkey(state,created_at,id))";

/** 대상 공고를 전부 읽는다. 클라이언트를 받는 것은 로컬 DB 확인 스크립트가 같은 질의를 보내게 하려는 것이다. */
export async function readLiveNotices(
  db: SupabaseClient<Database>,
  nowIso: string,
): Promise<GapNoticeRow[]> {
  const rows: GapNoticeRow[] = [];
  for (let lastId: string | null = null; ;) {
    let page = db
      .from("bid_notices")
      .select(COLUMNS)
      .eq("is_demo", false)
      .neq("source", "fixture")
      .eq("stage", "NOTICE")
      .in("status", ["OPEN", "AMENDED"])
      .gt("deadline_at", nowIso)
      .is("opportunity.superseded_by", null);
    if (lastId !== null) page = page.gt("id", lastId);
    const { data, error } = await page
      .order("id")
      .limit(PAGE)
      .overrideTypes<GapNoticeRow[], { merge: false }>();
    if (error) throw new Error("자격 갭 레이더 공고를 읽지 못했습니다", { cause: error });
    rows.push(...data);
    if (data.length < PAGE) break;
    lastId = data[data.length - 1].id;
  }
  return rows;
}

export const gapsRepo: GapsRepo = {
  liveNotices: async (nowIso) => readLiveNotices(await getSupabase(), nowIso),
};
