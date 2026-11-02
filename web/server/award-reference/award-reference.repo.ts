import "server-only";
import { getSupabase } from "@/server/supabase";
import {
  AWARD_TARGET_RAW_KEYS,
  awardTargetOf,
  type AwardCandidateQuery,
  type AwardReferenceRepo,
  type AwardSampleRow,
  type AwardTargetRaw,
} from "./award-reference.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 사용자 세션(anon 키) + RLS 로만 읽는다. bid_notices·bid_revisions·procurement_award_history 는
// 활동 중 회원이 읽는다. 낙찰 이력 쓰기는 운영자 CLI(service role) 몫이라 여기에는 없다.
// 원문은 raw_payload 를 통째로 받지 않고 카드에 쓰는 키만 경로(raw_payload->>키)로 고른다.

const RAW_SELECT = AWARD_TARGET_RAW_KEYS.map((key) => `${key}:raw_payload->>${key}`).join(",");
const SAMPLE_SELECT =
  "id,bid_notice_no,procurement_class_no,procurement_mid_class_name,base_amount_krw,award_ratio";
// PostgREST 기본 최대 행 수(1,000) 안에서 id keyset 으로 넘긴다. 중분류는 한 해 수백 건을 넘을 수 있다.
const PAGE = 1000;

type StoredSample = {
  id: string;
  bid_notice_no: string;
  procurement_class_no: string;
  procurement_mid_class_name: string | null;
  base_amount_krw: number;
  award_ratio: number;
};

const toSample = (row: StoredSample): AwardSampleRow => ({
  bidNoticeNo: row.bid_notice_no,
  classNo: row.procurement_class_no,
  midClassName: row.procurement_mid_class_name,
  // numeric·bigint 는 PostgREST 가 숫자로 주지만 문자열로 와도 같은 값이 되게 바꾼다.
  baseAmountKrw: Number(row.base_amount_krw),
  awardRatio: Number(row.award_ratio),
});

async function readSamples(
  query: AwardCandidateQuery,
  scope: { column: "procurement_class_no" | "procurement_mid_class_name"; value: string },
): Promise<StoredSample[]> {
  const db = await getSupabase();
  const rows: StoredSample[] = [];
  for (let lastId: string | null = null; ;) {
    let page = db
      .from("procurement_award_history")
      .select(SAMPLE_SELECT)
      .eq(scope.column, scope.value)
      .eq("award_method_group", query.group)
      .gte("base_amount_krw", query.minBase)
      .lte("base_amount_krw", query.maxBase)
      .gte("opened_at", query.openedSince);
    if (lastId !== null) page = page.gt("id", lastId);
    const { data, error } = await page.order("id").limit(PAGE);
    if (error) throw new Error("낙찰 이력을 읽지 못했습니다", { cause: error });
    rows.push(...data);
    if (data.length < PAGE) break;
    lastId = data[data.length - 1].id;
  }
  return rows;
}

export const awardReferenceRepo: AwardReferenceRepo = {
  async loadTarget(bidId) {
    const db = await getSupabase();
    const notice = await db
      .from("bid_notices")
      .select("source,is_demo,latest_revision")
      .eq("id", bidId)
      .maybeSingle();
    if (notice.error) throw new Error("공고를 읽지 못했습니다", { cause: notice.error });
    if (notice.data === null) return null;
    const revision = await db
      .from("bid_revisions")
      .select(RAW_SELECT)
      .eq("bid_id", bidId)
      .eq("revision", notice.data.latest_revision)
      .maybeSingle()
      .overrideTypes<AwardTargetRaw, { merge: false }>();
    if (revision.error) throw new Error("공고 원문을 읽지 못했습니다", { cause: revision.error });
    return awardTargetOf(
      { source: notice.data.source, isDemo: notice.data.is_demo },
      revision.data,
    );
  },

  // 같은 분류와 같은 중분류를 따로 읽어 합친다(.or 문자열에 분류 이름을 넣지 않으려고). 겹치는 행은 id 로 한 번만 센다.
  async loadCandidates(query) {
    const [byClass, byMidClass] = await Promise.all([
      readSamples(query, { column: "procurement_class_no", value: query.classNo }),
      query.midClassName === null
        ? Promise.resolve([])
        : readSamples(query, {
            column: "procurement_mid_class_name",
            value: query.midClassName,
          }),
    ]);
    const unique = new Map([...byClass, ...byMidClass].map((row) => [row.id, row]));
    return [...unique.values()].map(toSample);
  },

  async loadDatasetMeta() {
    const db = await getSupabase();
    const [latest, earliest] = await Promise.all([
      db
        .from("procurement_award_history")
        .select("fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("procurement_award_history")
        .select("opened_at")
        .order("opened_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (latest.error)
      throw new Error("낙찰 이력 기준일을 읽지 못했습니다", { cause: latest.error });
    if (earliest.error)
      throw new Error("낙찰 이력 기간을 읽지 못했습니다", { cause: earliest.error });
    return {
      dataAsOf: latest.data?.fetched_at ?? null,
      earliestOpenedAt: earliest.data?.opened_at ?? null,
    };
  },
};
