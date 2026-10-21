import "server-only";
import { getSupabase } from "@/server/supabase";
import { bidStageSchema, bidStatusSchema } from "./bid.model";
import type { StageLinkRow, StageLinksRepo } from "./stage-links.repo";

// 단계 연결 저장소. 사용자 세션(anon 키) + RLS 로 bid_notices 만 읽는다(공고는 모든 조직이 함께 본다).
// 식별자 값은 .eq 로만 넘긴다. or=(…) 문자열을 이어 붙이지 않아 식별자의 쉼표·괄호가 필터를 바꾸지 못한다.

type Db = Awaited<ReturnType<typeof getSupabase>>;

const COLUMNS = "id,stage,notice_id,plan_ref,pre_spec_ref,title,agency,status,deadline_at,is_demo";

type StoredRow = Omit<StageLinkRow, "stage" | "status"> & { stage: string; status: string };
type Settled = { data: StoredRow[] | null; error: unknown };

// DB 의 check 제약과 같은 값 집합이다. 벗어나면 조용히 넘기지 않고 던진다.
const toRow = (stored: StoredRow): StageLinkRow => ({
  ...stored,
  stage: bidStageSchema.parse(stored.stage),
  status: bidStatusSchema.parse(stored.status),
});

const hasValue = (value: string | null): value is string => value !== null && value.trim() !== "";

async function rowsOf(query: PromiseLike<Settled>): Promise<StageLinkRow[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toRow);
}

// 같은 is_demo 이고 지금 공고가 아닌 행만 보는 질의의 시작.
const sameOrigin = (db: Db, anchor: StageLinkRow) =>
  db.from("bid_notices").select(COLUMNS).eq("is_demo", anchor.is_demo).neq("id", anchor.id);

function identifierQueries(db: Db, anchor: StageLinkRow): PromiseLike<Settled>[] {
  // 같은 발주계획 번호(PLAN_REF).
  const byPlanRef = hasValue(anchor.plan_ref)
    ? [sameOrigin(db, anchor).eq("plan_ref", anchor.plan_ref)]
    : [];
  // 지금 공고가 가리키는 사전규격(PRE_SPEC_REF).
  const preSpecOfAnchor = hasValue(anchor.pre_spec_ref)
    ? [sameOrigin(db, anchor).eq("stage", "PRE_SPEC").eq("notice_id", anchor.pre_spec_ref)]
    : [];
  // 지금 공고가 사전규격이면, 이 사전규격 번호를 가리키는 공고.
  const referringToAnchor =
    anchor.stage === "PRE_SPEC"
      ? [sameOrigin(db, anchor).eq("pre_spec_ref", anchor.notice_id)]
      : [];
  return [...byPlanRef, ...preSpecOfAnchor, ...referringToAnchor];
}

const uniqueById = (rows: StageLinkRow[]): StageLinkRow[] => [
  ...new Map(rows.map((row) => [row.id, row])).values(),
];

export const stageLinksRepo: StageLinksRepo = {
  async findAnchor(bidId) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("bid_notices")
      .select(COLUMNS)
      .eq("id", bidId)
      .maybeSingle();
    if (error) throw error;
    return data === null ? null : toRow(data);
  },

  async findRelated(anchor, poolLimit) {
    const db = await getSupabase();
    // 후보 풀: 단계가 다른 최근 공고. 게시일 없는 행은 뒤로.
    const pool = sameOrigin(db, anchor)
      .neq("stage", anchor.stage)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(poolLimit);
    const groups = await Promise.all([...identifierQueries(db, anchor), pool].map(rowsOf));
    return uniqueById(groups.flat());
  },
};
