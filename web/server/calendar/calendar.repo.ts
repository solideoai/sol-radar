import "server-only";
import { PROJECT_STATUSES, type ProjectStatus } from "@/server/projects";
import { nameOf } from "@/server/shared";
import { getSupabase } from "@/server/supabase";
import {
  EMPTY_RAW_SCHEDULE,
  RAW_SCHEDULE_KEYS,
  RAW_SITE_PLACE_KEY,
  isRelevantState,
  latestRelevanceState,
  latestRevisionOf,
  type CalendarBid,
  type CalendarRepo,
  type DeadlineWindow,
  type RawSchedule,
} from "./calendar.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 사용자 세션(anon 키) + RLS 로만 읽는다. bid_watches 는 RLS 가 본인 행만, bid_projects 는 내 조직 행만 연다.
// 그래도 org_id(와 관심은 user_id)를 조건에 적어 화면이 확인한 지금 조직 하나로 좁힌다(M17).
// 관심·열린 프로젝트는 사람이 하나씩 표시한 것이라 PostgREST 기본 1,000행 안이다.
// 원본 일정은 raw_payload 를 통째로 받지 않고 필요한 키만 경로(raw_payload->>키)로 고른다. revision 은 공고마다 몇 개뿐이라
// 다 받아 latest_revision 행만 쓴다(PostgREST 는 임베드를 부모 열과 비교해 거르지 못한다).

const RAW_FIELDS = [
  "revision",
  ...Object.entries(RAW_SCHEDULE_KEYS).map(([kind, key]) => `${kind}:raw_payload->>${key}`),
  `sitePlace:raw_payload->>${RAW_SITE_PLACE_KEY}`,
].join(",");
const REVISIONS = `revisions:bid_revisions!bid_revisions_bid_id_fkey(${RAW_FIELDS})`;
const BID_FIELDS = `id,title,agency,deadline_at,is_demo,status,latest_revision,${REVISIONS}`;
const OWNER_FIELDS =
  "owner:memberships!bid_projects_owner_fkey(profile:profiles!memberships_user_id_fkey(display_name,email))";
const WATCH_SELECT = `bid:bid_notices!bid_watches_bid_id_fkey(${BID_FIELDS})`;
const PROJECT_SELECT = `id,status,owner_id,submission_due_override,bid:bid_notices!bid_projects_bid_id_fkey(${BID_FIELDS}),${OWNER_FIELDS}`;
// 관련 공고: /gaps(server/gaps/gaps.repo.ts)와 같은 대상 조건에 최신 revision 의 관련성 평가를 더한다(마감 하한만 다르다).
const RELEVANT_SELECT =
  "id,title,agency,deadline_at,is_demo,status,latest_revision," +
  "opportunity:bid_opportunities!bid_opportunities_canonical_notice_id_fkey!inner(superseded_by)," +
  `revisions:bid_revisions!bid_revisions_bid_id_fkey(${RAW_FIELDS},` +
  "relevance:bid_relevance_assessments!bid_relevance_assessments_revision_id_fkey(state,created_at,id))";
const PAGE = 500;

type StoredRevision = { revision: number } & Record<keyof RawSchedule, string | null>;

type StoredBid = {
  id: string;
  title: string;
  agency: string | null;
  deadline_at: string | null;
  is_demo: boolean;
  status: string;
  latest_revision: number;
  revisions: StoredRevision[];
};

type StoredRelevantBid = StoredBid & {
  revisions: (StoredRevision & {
    relevance: { state: string; created_at: string; id: string }[];
  })[];
};

function projectStatusOf(value: string): ProjectStatus {
  const status = PROJECT_STATUSES.find((known) => known === value);
  if (status === undefined) throw new Error(`알 수 없는 입찰 프로젝트 상태: ${value}`);
  return status;
}

const rawScheduleOf = (revision: StoredRevision | undefined): RawSchedule =>
  revision === undefined
    ? EMPTY_RAW_SCHEDULE
    : {
        BID_BEGIN: revision.BID_BEGIN,
        QUALIFICATION_DUE: revision.QUALIFICATION_DUE,
        JOINT_AGREEMENT_DUE: revision.JOINT_AGREEMENT_DUE,
        SITE_BRIEFING: revision.SITE_BRIEFING,
        OPENING: revision.OPENING,
        sitePlace: revision.sitePlace,
      };

const toBid = (row: StoredBid): CalendarBid => ({
  id: row.id,
  title: row.title,
  agency: row.agency,
  deadlineAt: row.deadline_at,
  isDemo: row.is_demo,
  cancelled: row.status === "CANCELLED",
  rawSchedule: rawScheduleOf(latestRevisionOf(row.latest_revision, row.revisions)),
});

/**
 * 관련 업종 실공고 가운데 공고 마감이 window 안인 것. 대상 조건은 /gaps 와 같다:
 * live(is_demo=false, 데모 수집기 아님) 입찰공고(stage=NOTICE), OPEN·AMENDED(취소 제외), 대표 공고(superseded_by 없음).
 * 마감 하한만 다르다. /gaps 는 지금 이후, 여기는 window.from(오늘 0시 − 14일) 이후라 마감이 지난 공고의 개찰도 남는다.
 * 나라장터 공고는 마감이 지나도 status 가 OPEN·AMENDED 로 남는다(CLOSED 는 화면 뷰가 계산한다).
 * 관련성(최신 revision 의 최신 평가)은 임베드로 거를 수 없어 읽은 뒤 고른다. 1,000행 제한은 id keyset 으로 넘긴다.
 */
async function readRelevantBids(window: DeadlineWindow): Promise<CalendarBid[]> {
  const db = await getSupabase();
  const bids: CalendarBid[] = [];
  for (let lastId: string | null = null; ;) {
    let page = db
      .from("bid_notices")
      .select(RELEVANT_SELECT)
      .eq("is_demo", false)
      .neq("source", "fixture")
      .eq("stage", "NOTICE")
      .in("status", ["OPEN", "AMENDED"])
      .gte("deadline_at", window.from)
      .lt("deadline_at", window.to)
      .is("opportunity.superseded_by", null);
    if (lastId !== null) page = page.gt("id", lastId);
    const { data, error } = await page
      .order("id")
      .limit(PAGE)
      .overrideTypes<StoredRelevantBid[], { merge: false }>();
    if (error) throw new Error("입찰 일정의 관련 공고를 읽지 못했습니다", { cause: error });
    for (const row of data) {
      const latest = latestRevisionOf(row.latest_revision, row.revisions);
      const state = latestRelevanceState(
        (latest?.relevance ?? []).map(({ state, created_at, id }) => ({
          state,
          createdAt: created_at,
          id,
        })),
      );
      if (isRelevantState(state)) bids.push(toBid(row));
    }
    if (data.length < PAGE) break;
    lastId = data[data.length - 1].id;
  }
  return bids;
}

export const calendarRepo: CalendarRepo = {
  async load({ orgId, userId }) {
    const db = await getSupabase();
    const [watches, projects] = await Promise.all([
      db
        .from("bid_watches")
        .select(WATCH_SELECT)
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .overrideTypes<{ bid: StoredBid | null }[], { merge: false }>(),
      db
        .from("bid_projects")
        .select(PROJECT_SELECT)
        .eq("org_id", orgId)
        .neq("status", "CLOSED")
        .overrideTypes<
          {
            id: string;
            status: string;
            owner_id: string | null;
            submission_due_override: string | null;
            bid: StoredBid | null;
            owner: { profile: { display_name: string | null; email: string | null } | null } | null;
          }[],
          { merge: false }
        >(),
    ]);
    if (watches.error) throw watches.error;
    if (projects.error) throw projects.error;
    return {
      // 공고는 외래 키로 묶여 있다. RLS 가 가린 행(null)은 일정에 넣지 않는다.
      watchedBids: watches.data.flatMap((row) => (row.bid === null ? [] : [toBid(row.bid)])),
      projects: projects.data.flatMap((row) =>
        row.bid === null
          ? []
          : [
              {
                id: row.id,
                status: projectStatusOf(row.status),
                ownerId: row.owner_id,
                ownerName:
                  row.owner_id === null
                    ? null
                    : nameOf(
                        row.owner?.profile?.display_name ?? null,
                        row.owner?.profile?.email ?? null,
                      ),
                submissionDueOverride: row.submission_due_override,
                bid: toBid(row.bid),
              },
            ],
      ),
    };
  },
  loadRelevant: readRelevantBids,
};
