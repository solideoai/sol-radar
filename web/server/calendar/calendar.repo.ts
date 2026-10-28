import "server-only";
import { PROJECT_STATUSES, type ProjectStatus } from "@/server/projects";
import { nameOf } from "@/server/shared";
import { getSupabase } from "@/server/supabase";
import type { CalendarBid, CalendarRepo } from "./calendar.model";

// ── 저장: Supabase 를 부르는 자리. 규칙은 두지 않는다 ──
// 사용자 세션(anon 키) + RLS 로만 읽는다. bid_watches 는 RLS 가 본인 행만, bid_projects 는 내 조직 행만 연다.
// 그래도 org_id(와 관심은 user_id)를 조건에 적어 화면이 확인한 지금 조직 하나로 좁힌다(M17).
// 관심·열린 프로젝트는 사람이 하나씩 표시한 것이라 PostgREST 기본 1,000행 안이다.

const BID_FIELDS = "id,title,agency,deadline_at,is_demo,status";
const OWNER_FIELDS =
  "owner:memberships!bid_projects_owner_fkey(profile:profiles!memberships_user_id_fkey(display_name,email))";
const WATCH_SELECT = `bid:bid_notices!bid_watches_bid_id_fkey(${BID_FIELDS})`;
const PROJECT_SELECT = `id,status,owner_id,submission_due_override,bid:bid_notices!bid_projects_bid_id_fkey(${BID_FIELDS}),${OWNER_FIELDS}`;

type StoredBid = {
  id: string;
  title: string;
  agency: string | null;
  deadline_at: string | null;
  is_demo: boolean;
  status: string;
};

function projectStatusOf(value: string): ProjectStatus {
  const status = PROJECT_STATUSES.find((known) => known === value);
  if (status === undefined) throw new Error(`알 수 없는 입찰 프로젝트 상태: ${value}`);
  return status;
}

const toBid = (row: StoredBid): CalendarBid => ({
  id: row.id,
  title: row.title,
  agency: row.agency,
  deadlineAt: row.deadline_at,
  isDemo: row.is_demo,
  cancelled: row.status === "CANCELLED",
});

export const calendarRepo: CalendarRepo = {
  async load({ orgId, userId }) {
    const db = await getSupabase();
    const [watches, projects] = await Promise.all([
      db.from("bid_watches").select(WATCH_SELECT).eq("org_id", orgId).eq("user_id", userId),
      db.from("bid_projects").select(PROJECT_SELECT).eq("org_id", orgId).neq("status", "CLOSED"),
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
};
