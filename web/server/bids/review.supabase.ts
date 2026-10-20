import "server-only";
import { getSupabase } from "@/server/supabase";
import { toReview } from "./bid-row.mapper";
import type { ReviewRow } from "./bid-row.mapper";
import { isUuid, recommendationSchema, roleSchema } from "./bid.model";
import type { ReviewRepo, ReviewTarget } from "./bids.repo";
import type { Review } from "./review.model";

// 사람 최종 결정 저장소. 사용자 세션(anon 키) + RLS 로만 읽고 쓴다.
// 공고는 모든 조직이 함께 보고, 결정·분석은 조직 것이라 org_id 로 좁힌다(여러 조직 사용자도 한 조직만 본다).

type Db = Awaited<ReturnType<typeof getSupabase>>;

// 결정자: 프로필(이름) + 멤버십(이 조직의 업무 역할). 담당자: (org_id, assignee_id) → memberships → 프로필.
// 결정자가 조직을 떠나면 RLS 가 프로필·멤버십을 가려 null 이 온다.
const REVIEW_SELECT =
  "id,org_id,bid_id,revision_id,score_run_id,reviewer_id,assignee_id,decision,reason,decided_at,created_at,system_recommendation,disagreement_flag,reviewer:profiles!bid_reviews_reviewer_id_fkey(display_name,email,memberships!memberships_user_id_fkey(org_id,sol_role)),assignee:memberships!bid_reviews_assignee_fkey(profile:profiles!memberships_user_id_fkey(display_name,email))";

type StoredReview = Omit<
  ReviewRow,
  | "reviewer_display_name"
  | "reviewer_email"
  | "reviewer_role"
  | "assignee_display_name"
  | "assignee_email"
> & {
  reviewer: {
    display_name: string | null;
    email: string | null;
    memberships: { org_id: string; sol_role: string }[];
  } | null;
  assignee: { profile: { display_name: string | null; email: string | null } | null } | null;
};

function toReviewRow(stored: StoredReview): ReviewRow {
  const { reviewer, assignee, ...row } = stored;
  const membership = reviewer?.memberships.find((m) => m.org_id === row.org_id);
  const role = roleSchema.safeParse(membership?.sol_role);
  return {
    ...row,
    reviewer_display_name: reviewer?.display_name ?? null,
    reviewer_email: reviewer?.email ?? null,
    reviewer_role: role.success ? role.data : null,
    assignee_display_name: assignee?.profile?.display_name ?? null,
    assignee_email: assignee?.profile?.email ?? null,
  };
}

// 공고 행이 있는지(조직과 상관없이). 상세·결정 이력이 404 를 가를 때 쓴다.
export async function bidExistsIn(db: Db, bidId: string): Promise<boolean> {
  const { data, error } = await db.from("bid_notices").select("id").eq("id", bidId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// 이 조직이 이 공고에 남긴 결정. 최신이 먼저다(뷰 bid_list_items 의 최신 결정과 같은 순서).
export async function readReviews(db: Db, orgId: string, bidId: string): Promise<Review[]> {
  const { data, error } = await db
    .from("bid_reviews")
    .select(REVIEW_SELECT)
    .eq("org_id", orgId)
    .eq("bid_id", bidId)
    .order("decided_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data.map((stored) => toReview(toReviewRow(stored)));
}

const SCORED = ["COMPLETED", "PARTIAL"] as const;

// 결정이 가리킬 분석. scoreRunId 가 있으면 그 run(이 조직·이 공고), 없으면 최신 점수 run 이다.
async function reviewAnalysis(
  db: Db,
  orgId: string,
  bidId: string,
  scoreRunId: string | undefined,
): Promise<ReviewTarget["analysis"]> {
  // 본문으로 온 id 라 형식이 틀릴 수 있다. uuid 열 비교 오류(500) 대신 "없음" 이다.
  if (scoreRunId !== undefined && !isUuid(scoreRunId)) return null;
  const base = db.from("score_runs").select("id,recommendation");
  const query =
    scoreRunId === undefined
      ? base
          .eq("org_id", orgId)
          .eq("bid_id", bidId)
          .in("status", SCORED)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
      : base.eq("id", scoreRunId).eq("org_id", orgId).eq("bid_id", bidId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return {
    id: data.id,
    recommendation: recommendationSchema.nullable().parse(data.recommendation),
  };
}

export const reviewRepo: ReviewRepo = {
  async getReviewTarget(orgId, bidId, scoreRunId) {
    const db = await getSupabase();
    const notice = await db
      .from("bid_notices")
      .select("latest_revision")
      .eq("id", bidId)
      .maybeSingle();
    if (notice.error) throw notice.error;
    if (notice.data === null) return null;
    const [revision, analysis] = await Promise.all([
      db
        .from("bid_revisions")
        .select("id")
        .eq("bid_id", bidId)
        .eq("revision", notice.data.latest_revision)
        .maybeSingle(),
      reviewAnalysis(db, orgId, bidId, scoreRunId),
    ]);
    if (revision.error) throw revision.error;
    if (revision.data === null) {
      throw new Error(`공고 ${bidId} 의 최신 revision 행이 없습니다`);
    }
    return { revisionId: revision.data.id, analysis };
  },

  async listReviews(orgId, bidId) {
    const db = await getSupabase();
    const [exists, reviews] = await Promise.all([
      bidExistsIn(db, bidId),
      readReviews(db, orgId, bidId),
    ]);
    return exists ? reviews : null;
  },

  async isOrgMember(orgId, userId) {
    if (!isUuid(userId)) return false;
    const db = await getSupabase();
    const { data, error } = await db
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  // reviewer_id 는 기본값(auth.uid()), system_recommendation·disagreement_flag 는 BEFORE INSERT 트리거가 채운다(O2).
  // 화면 역할에는 그 열의 insert 권한이 없다. 감사·담당자 outbox 는 AFTER INSERT 트리거가 같은 트랜잭션에 쓴다.
  async createReview(input) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("bid_reviews")
      .insert({
        org_id: input.orgId,
        bid_id: input.bidId,
        revision_id: input.revisionId,
        score_run_id: input.scoreRunId,
        assignee_id: input.assigneeUserId,
        decision: input.decision,
        reason: input.reason,
      })
      .select(REVIEW_SELECT)
      .single();
    if (error) throw error;
    return toReview(toReviewRow(data));
  },
};
