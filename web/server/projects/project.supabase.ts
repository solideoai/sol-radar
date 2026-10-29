import "server-only";
import {
  analysisStatusSchema,
  bidStageSchema,
  bidStatusSchema,
  effectiveStatus,
  isUuid,
  recommendationSchema,
  type PendingSourceRow,
} from "@/server/bids";
import { nameOf } from "@/server/shared";
import { getSupabase } from "@/server/supabase";
import {
  projectResultSchema,
  projectStatusSchema,
  type DecisionRecord,
  type ProjectAnalysisSummary,
  type ProjectEvent,
  type ProjectRecord,
} from "./project.model";
import {
  PROJECT_DB_CODES,
  type ProjectDbCode,
  type ProjectRepo,
  type RpcOutcome,
} from "./project.repo";

// 입찰 프로젝트 저장소. 사용자 세션(anon 키) + RLS 로만 읽고 쓴다(service role 키를 쓰지 않는다).
// 프로젝트·이력·결정·체크리스트는 조직 것이라 org_id 로 좁히고, 공고는 모든 조직이 함께 본다.
// 상태·결과·열기는 DB 함수(마이그레이션 20261022000300)만 바꾸고, 표에는 담당자·제출 마감 두 열만 쓴다(열 권한).

type Db = Awaited<ReturnType<typeof getSupabase>>;

// PostgreSQL 오류 코드
const RAISED = "P0001";
const FOREIGN_KEY_VIOLATION = "23503";

// 결정자가 탈퇴하면 reviewer_id 가 null 이다(on delete set null). 결정 이력(toReview)과 같은 이름을 쓴다.
const DELETED_REVIEWER_NAME = "탈퇴한 사용자";

type Person = { display_name: string | null; email: string | null } | null;
const personName = (person: Person) => nameOf(person?.display_name ?? null, person?.email ?? null);
const reviewerName = (reviewerId: string | null, reviewer: Person) =>
  reviewerId === null ? DELETED_REVIEWER_NAME : personName(reviewer);

const BID_FIELDS = "id,title,agency,notice_id,deadline_at,is_demo,status,latest_revision";
const OWNER_FIELDS =
  "owner:memberships!bid_projects_owner_fkey(profile:profiles!memberships_user_id_fkey(display_name,email))";
const PROJECT_FIELDS =
  "id,bid_id,status,owner_id,submission_due_override,result,result_note,result_recorded_at,closed_at,created_at,opened_by_review_id";

const PROJECT_SELECT = `${PROJECT_FIELDS},bid:bid_notices!bid_projects_bid_id_fkey(${BID_FIELDS}),${OWNER_FIELDS},opened_review:bid_reviews!bid_projects_opened_by_review_fkey(revision:bid_revisions!bid_reviews_revision_fkey(revision))`;

// 상세는 여는 결정(결정자·revision·가리킨 분석)과 상태 이력을 함께 읽는다.
// 행위자가 조직을 떠나면 RLS 가 프로필을 가려 actor 가 null 로 온다.
const DETAIL_SELECT = `${PROJECT_FIELDS},bid:bid_notices!bid_projects_bid_id_fkey(${BID_FIELDS}),${OWNER_FIELDS},opened_review:bid_reviews!bid_projects_opened_by_review_fkey(id,decided_at,reviewer_id,reviewer:profiles!bid_reviews_reviewer_id_fkey(display_name,email),revision:bid_revisions!bid_reviews_revision_fkey(revision),score_run:score_runs!bid_reviews_score_run_fkey(finished_at,score,recommendation,algorithm_version,input_snapshot_hash)),events:bid_project_events!bid_project_events_project_fkey(id,actor_id,from_status,to_status,note,created_at,actor:profiles!bid_project_events_actor_id_fkey(display_name,email))`;

const DECISION_SELECT =
  "id,bid_id,decision,decided_at,created_at,reviewer_id,reviewer:profiles!bid_reviews_reviewer_id_fkey(display_name,email)";

// 검토 대기 칸의 원본. 대시보드(createDashboardRepo.load)와 같은 질의에 기관·데모 여부와
// 분석의 멱등 키(IT 일괄 분석 run 을 대기에서 뺀다, ADR-069)를 더한다.
const PENDING_SELECT =
  "id,title,agency,is_demo,stage,status,deadline_at,score_runs!score_runs_bid_id_fkey(id,status,recommendation,review_flags,created_at,idempotency_key),bid_reviews!bid_reviews_bid_id_fkey(decision,disagreement_flag,decided_at)";

type StoredBid = {
  id: string;
  title: string;
  agency: string | null;
  notice_id: string;
  deadline_at: string | null;
  is_demo: boolean;
  status: string;
  latest_revision: number;
};
type StoredProject = {
  id: string;
  bid_id: string;
  status: string;
  owner_id: string | null;
  submission_due_override: string | null;
  result: string | null;
  result_note: string | null;
  result_recorded_at: string | null;
  closed_at: string | null;
  created_at: string;
  opened_by_review_id: string;
  bid: StoredBid | null;
  owner: { profile: Person } | null;
  opened_review: { revision: { revision: number } | null } | null;
};
type StoredDecision = {
  id: string;
  bid_id: string;
  decision: string;
  decided_at: string;
  created_at: string;
  reviewer_id: string | null;
  reviewer: Person;
};

function toProjectRecord(row: StoredProject): ProjectRecord {
  // 공고·여는 결정은 외래 키로 묶여 지워지지 않는다. 없으면 저장과 코드가 어긋난 것이라 던진다.
  if (row.bid === null) throw new Error(`입찰 프로젝트 ${row.id} 의 공고를 읽지 못했습니다`);
  const openedRevision = row.opened_review?.revision?.revision;
  if (openedRevision === undefined) {
    throw new Error(`입찰 프로젝트 ${row.id} 의 여는 결정 revision 을 읽지 못했습니다`);
  }
  return {
    id: row.id,
    bidId: row.bid_id,
    status: projectStatusSchema.parse(row.status),
    owner:
      row.owner_id === null
        ? null
        : { id: row.owner_id, name: personName(row.owner?.profile ?? null) },
    submissionDueOverride: row.submission_due_override,
    result: projectResultSchema.nullable().parse(row.result),
    resultNote: row.result_note,
    resultRecordedAt: row.result_recorded_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    openedByReviewId: row.opened_by_review_id,
    openedRevision,
    bid: {
      id: row.bid.id,
      title: row.bid.title,
      agency: row.bid.agency,
      noticeId: row.bid.notice_id,
      deadlineAt: row.bid.deadline_at,
      isDemo: row.bid.is_demo,
      status: bidStatusSchema.parse(row.bid.status),
      latestRevision: row.bid.latest_revision,
    },
  };
}

const toDecision = (row: StoredDecision): DecisionRecord => ({
  id: row.id,
  bidId: row.bid_id,
  decision: recommendationSchema.parse(row.decision),
  decidedAt: row.decided_at,
  createdAt: row.created_at,
  reviewer: reviewerName(row.reviewer_id, row.reviewer),
});

type StoredRun = {
  finished_at: string | null;
  score: number | string | null;
  recommendation: string | null;
  algorithm_version: string;
  input_snapshot_hash: string | null;
} | null;

// 끝나지 않은 분석(시각 없음)은 요약하지 않는다. numeric 은 문자열로 올 수 있어 숫자로 바꾼다.
function toAnalysisSummary(run: StoredRun): ProjectAnalysisSummary | null {
  if (run === null || run.finished_at === null) return null;
  return {
    finishedAt: run.finished_at,
    solScore: run.score === null ? null : Number(run.score),
    recommendation: recommendationSchema.nullable().parse(run.recommendation),
    algorithmVersion: run.algorithm_version,
    inputSnapshotHash: run.input_snapshot_hash,
  };
}

type StoredEvent = {
  id: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
  actor: Person;
};
const toEvent = (row: StoredEvent): ProjectEvent => ({
  id: row.id,
  actor: row.actor_id === null || row.actor === null ? null : personName(row.actor),
  from: projectStatusSchema.nullable().parse(row.from_status),
  to: projectStatusSchema.parse(row.to_status),
  note: row.note,
  createdAt: row.created_at,
});

async function readDecisions(db: Db, orgId: string, bidIds: readonly string[]) {
  if (bidIds.length === 0) return [];
  const { data, error } = await db
    .from("bid_reviews")
    .select(DECISION_SELECT)
    .eq("org_id", orgId)
    .in("bid_id", [...new Set(bidIds)]);
  if (error) throw error;
  return data.map(toDecision);
}

type DbError = { code?: string; message?: string; details?: string | null };
const isProjectDbCode = (value: string | undefined): value is ProjectDbCode =>
  PROJECT_DB_CODES.some((code) => code === value);

// DB 함수가 올린 거절(P0001 + 알려진 코드)만 결과로 돌려주고, 나머지는 던진다.
function rejection(error: DbError): Extract<RpcOutcome<never>, { ok: false }> {
  if (error.code !== RAISED || !isProjectDbCode(error.message)) throw error;
  const detail = error.details ?? null;
  return { ok: false, code: error.message, detail };
}

export const projectRepo: ProjectRepo = {
  async listBoard(orgId) {
    const db = await getSupabase();
    const projects = await db.from("bid_projects").select(PROJECT_SELECT).eq("org_id", orgId);
    if (projects.error) throw projects.error;
    const records = projects.data.map(toProjectRecord);
    if (records.length === 0) return { projects: [], decisions: [], checklist: [] };
    const [decisions, checklist] = await Promise.all([
      readDecisions(
        db,
        orgId,
        records.map((record) => record.bidId),
      ),
      db
        .from("tasks")
        .select("bid_project_id,status")
        .eq("org_id", orgId)
        .in(
          "bid_project_id",
          records.map((record) => record.id),
        ),
    ]);
    if (checklist.error) throw checklist.error;
    return {
      projects: records,
      decisions,
      checklist: checklist.data.flatMap((row) =>
        row.bid_project_id === null
          ? []
          : [{ bidProjectId: row.bid_project_id, status: row.status }],
      ),
    };
  },

  async loadPendingSource(orgId, origin) {
    const db = await getSupabase();
    const base = db
      .from("bid_notices")
      .select(PENDING_SELECT)
      .eq("score_runs.org_id", orgId)
      .eq("bid_reviews.org_id", orgId);
    const { data, error } = await (origin === "all" ? base : base.eq("is_demo", origin === "demo"));
    if (error) throw error;
    const now = new Date();
    return data.map((bid): PendingSourceRow => ({
      bidId: bid.id,
      title: bid.title,
      agency: bid.agency,
      isDemo: bid.is_demo,
      stage: bidStageSchema.parse(bid.stage),
      // CLOSED 는 저장하지 않고 마감으로 계산한다(ADR-030 B14). 대시보드와 같다.
      status: effectiveStatus(bidStatusSchema.parse(bid.status), bid.deadline_at, now),
      deadlineAt: bid.deadline_at,
      analyses: bid.score_runs.map((run) => ({
        id: run.id,
        status: analysisStatusSchema.parse(run.status),
        recommendation: recommendationSchema.nullable().parse(run.recommendation),
        reviewFlagCount: run.review_flags.length,
        createdAt: run.created_at,
        idempotencyKey: run.idempotency_key,
      })),
      reviews: bid.bid_reviews.map((review) => ({
        decision: recommendationSchema.parse(review.decision),
        disagreementFlag: review.disagreement_flag,
        decidedAt: review.decided_at,
      })),
    }));
  },

  async getDetail(orgId, id) {
    if (!isUuid(id)) return null;
    const db = await getSupabase();
    const { data, error } = await db
      .from("bid_projects")
      .select(DETAIL_SELECT)
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const record = toProjectRecord(data);
    const opened = data.opened_review;
    if (opened === null) throw new Error(`입찰 프로젝트 ${id} 의 여는 결정을 읽지 못했습니다`);
    const decisions = await readDecisions(db, orgId, [record.bidId]);
    return {
      ...record,
      openedBy: {
        reviewId: opened.id,
        reviewer: reviewerName(opened.reviewer_id, opened.reviewer),
        decidedAt: opened.decided_at,
        revision: record.openedRevision,
        analysis: toAnalysisSummary(opened.score_run),
      },
      decisions,
      events: data.events.map(toEvent),
    };
  },

  async findRef(orgId, id) {
    if (!isUuid(id)) return null;
    const db = await getSupabase();
    const { data, error } = await db
      .from("bid_projects")
      .select("id,bid_id,status")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data === null
      ? null
      : { id: data.id, bidId: data.bid_id, status: projectStatusSchema.parse(data.status) };
  },

  async getEntrySource(orgId, bidId) {
    if (!isUuid(bidId)) return null;
    const db = await getSupabase();
    const [notice, project, decisions] = await Promise.all([
      db.from("bid_notices").select("id,status").eq("id", bidId).maybeSingle(),
      db
        .from("bid_projects")
        .select("id,status,closed_at,result")
        .eq("org_id", orgId)
        .eq("bid_id", bidId)
        .maybeSingle(),
      readDecisions(db, orgId, [bidId]),
    ]);
    if (notice.error) throw notice.error;
    if (project.error) throw project.error;
    if (notice.data === null) return null;
    return {
      // 저장된 값 그대로(취소 여부만 본다)
      bidStatus: bidStatusSchema.parse(notice.data.status),
      project:
        project.data === null
          ? null
          : {
              id: project.data.id,
              status: projectStatusSchema.parse(project.data.status),
              closedAt: project.data.closed_at,
              result: projectResultSchema.nullable().parse(project.data.result),
            },
      decisions,
    };
  },

  async countActive(orgId, origin) {
    const db = await getSupabase();
    const query = db
      .from("bid_projects")
      .select("id,bid:bid_notices!inner(is_demo)", { count: "exact", head: true })
      .eq("org_id", orgId)
      .neq("status", "CLOSED");
    const { count, error } = await (origin === "all"
      ? query
      : query.eq("bid.is_demo", origin === "demo"));
    if (error) throw error;
    return count ?? 0;
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

  async openProject(reviewId) {
    const db = await getSupabase();
    const { data, error } = await db.rpc("open_bid_project", { p_review_id: reviewId });
    if (error) return rejection(error);
    const row = data[0];
    if (row === undefined) throw new Error("open_bid_project 가 행을 돌려주지 않았습니다");
    return { ok: true, value: { projectId: row.project_id, reopened: row.reopened } };
  },

  // 메모가 없으면 빈 글자를 보낸다. 함수가 앞뒤 공백을 지우고 비면 null 로 저장한다.
  async patch(projectId, changes) {
    const db = await getSupabase();
    const { error } = await db.rpc("patch_bid_project", {
      p_project_id: projectId,
      ...(changes.status === undefined ? {} : { p_status: changes.status }),
      p_note: changes.note ?? "",
      p_owner_changed: changes.ownerId !== undefined,
      ...(changes.ownerId == null ? {} : { p_owner_id: changes.ownerId }),
      p_due_changed: changes.submissionDueOverride !== undefined,
      ...(changes.submissionDueOverride == null ? {} : { p_due_at: changes.submissionDueOverride }),
    });
    return error ? rejection(error) : { ok: true, value: null };
  },

  async changeStatus(projectId, toStatus, note) {
    const db = await getSupabase();
    const { error } = await db.rpc("change_bid_project_status", {
      p_project_id: projectId,
      p_to_status: toStatus,
      p_note: note ?? "",
    });
    return error ? rejection(error) : { ok: true, value: null };
  },

  async recordResult(projectId, result, note) {
    const db = await getSupabase();
    const { error } = await db.rpc("record_bid_project_result", {
      p_project_id: projectId,
      p_result: result,
      p_note: note ?? "",
    });
    return error ? rejection(error) : { ok: true, value: null };
  },

  async updateFields(orgId, id, changes) {
    const db = await getSupabase();
    const { data, error } = await db
      .from("bid_projects")
      .update({
        ...(changes.ownerId === undefined ? {} : { owner_id: changes.ownerId }),
        ...(changes.submissionDueOverride === undefined
          ? {}
          : { submission_due_override: changes.submissionDueOverride }),
      })
      .eq("org_id", orgId)
      .eq("id", id)
      .select("id");
    if (error) {
      if (
        error.code === FOREIGN_KEY_VIOLATION &&
        (error.message ?? "").includes("bid_projects_owner_fkey")
      ) {
        return "owner-not-member";
      }
      throw error;
    }
    return data.length > 0 ? "saved" : "missing";
  },
};
