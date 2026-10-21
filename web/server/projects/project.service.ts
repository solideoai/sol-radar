import "server-only";
import {
  issuesOf,
  isUuid,
  reviewPendingBids,
  type AnalysisContext,
  type BidListOrigin,
} from "@/server/bids";
import type { ChecklistScope, TaskView } from "@/server/task";
import {
  MANAGE_PROJECT_ROLES,
  canManageProjects,
  checklistProgressOf,
  createProjectInputSchema,
  pickLatestDecision,
  projectEntryOf,
  projectPatchSchema,
  projectResultInputSchema,
  projectStatusSchema,
  sortProjectCards,
  toProjectCard,
  toProjectDetail,
  type DecisionRecord,
  type ProjectBoard,
  type ProjectDetail,
  type ProjectEntryState,
} from "./project.model";
import type { ProjectRepo, RpcOutcome } from "./project.repo";

// 입찰 프로젝트 서비스(05 §2 /projects). 예상한 실패는 결과로 돌려주고, HTTP 로 옮기는 일은 Route Handler 가 한다.
// 순서는 결정 기록(recordReview)과 같다: 권한 → 본문 → 대상 → 담당자 → 쓰기.
// 쓰기는 DB 함수(open·change_status·record_result)와 열 권한 두 칸(owner_id·submission_due_override)뿐이다.

export type ProjectErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PROJECT_REQUIRES_BID_DECISION"
  | "PROJECT_ALREADY_OPEN"
  | "LATEST_DECISION_NOT_BID"
  | "INVALID_PROJECT_TRANSITION";

export type ProjectServiceResult<T> =
  | { ok: true; status: 200 | 201; data: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      code: ProjectErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };
type ProjectFailure = Extract<ProjectServiceResult<never>, { ok: false }>;

export type ProjectDeps = {
  repo: ProjectRepo;
  // 체크리스트 줄(템플릿 작업 도메인 listProjectChecklist). 상세가 싣는다.
  checklist: (scope: ChecklistScope, projectId: string) => Promise<TaskView[]>;
  // 검토 대기 칸의 출처(실행 모드의 기본값, defaultOrigin)
  origin: BidListOrigin;
};

const fail = (
  status: ProjectFailure["status"],
  code: ProjectErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ProjectFailure =>
  details === undefined
    ? { ok: false, status, code, message }
    : { ok: false, status, code, message, details };

const forbidden = () =>
  fail(403, "FORBIDDEN", "입찰 프로젝트를 고칠 권한이 없습니다", {
    required: MANAGE_PROJECT_ROLES,
  });
const invalidBody = (error: Parameters<typeof issuesOf>[0]) =>
  fail(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", { issues: issuesOf(error) });

type NotFoundResource = "project" | "review" | "owner" | "bid";
const NOT_FOUND_MESSAGES: Record<NotFoundResource, string> = {
  project: "입찰 프로젝트를 찾을 수 없습니다",
  review: "결정을 찾을 수 없습니다",
  owner: "담당자를 찾을 수 없습니다",
  bid: "공고를 찾을 수 없습니다",
};
const notFound = (resource: NotFoundResource) =>
  fail(404, "NOT_FOUND", NOT_FOUND_MESSAGES[resource], { resource });

// "전>후" → {from, to}. 모르는 값은 null 로 둔다(화면은 코드만 보고 다시 읽는다).
function transitionOf(detail: string | null): { from: string | null; to: string | null } {
  const [from = "", to = ""] = (detail ?? "").split(">");
  const status = (value: string) => projectStatusSchema.safeParse(value).data ?? null;
  return { from: status(from), to: status(to) };
}

// DB 함수 거절 → 응답. 대상(공고·결정 id)은 서비스가 이미 아는 값을 싣는다.
function fromDb(
  outcome: Extract<RpcOutcome<unknown>, { ok: false }>,
  target: { missing: NotFoundResource; bidId?: string; reviewId?: string },
): ProjectFailure {
  switch (outcome.code) {
    case "NOT_FOUND":
      return notFound(target.missing);
    case "FORBIDDEN":
      return forbidden();
    case "PROJECT_REQUIRES_BID_DECISION":
      return fail(
        409,
        "PROJECT_REQUIRES_BID_DECISION",
        "이 공고의 최신 결정이 BID 일 때만 입찰 프로젝트를 열 수 있습니다",
        target.reviewId === undefined ? {} : { reviewId: target.reviewId },
      );
    case "PROJECT_ALREADY_OPEN":
      return fail(409, "PROJECT_ALREADY_OPEN", "이 공고에는 이미 열린 입찰 프로젝트가 있습니다", {
        projectId: outcome.detail,
      });
    case "LATEST_DECISION_NOT_BID":
      return fail(
        409,
        "LATEST_DECISION_NOT_BID",
        "최신 결정이 BID 가 아니어서 다음 단계로 넘길 수 없습니다",
        {
          ...(target.bidId === undefined ? {} : { bidId: target.bidId }),
          latestDecision: outcome.detail === null || outcome.detail === "" ? null : outcome.detail,
        },
      );
    case "INVALID_PROJECT_TRANSITION":
      return fail(
        409,
        "INVALID_PROJECT_TRANSITION",
        "지금 상태에서는 그 상태로 바꿀 수 없습니다",
        transitionOf(outcome.detail),
      );
  }
}

const scopeOf = (ctx: AnalysisContext): ChecklistScope => ({
  orgId: ctx.orgId,
  userId: ctx.userId,
  canManage: canManageProjects(ctx.role),
});

async function detailOf(
  ctx: AnalysisContext,
  id: string,
  deps: ProjectDeps,
): Promise<ProjectDetail | null> {
  const record = await deps.repo.getDetail(ctx.orgId, id);
  if (record === null) return null;
  const scope = scopeOf(ctx);
  const checklist = await deps.checklist(scope, id);
  return toProjectDetail(record, checklist, scope.canManage);
}

// 공고별 최신 결정. 고르기 규칙은 pickLatestDecision 하나다.
function latestByBid(decisions: readonly DecisionRecord[]): ReadonlyMap<string, DecisionRecord> {
  const latest = new Map<string, DecisionRecord>();
  for (const decision of decisions) {
    const current = latest.get(decision.bidId);
    const best = pickLatestDecision(current === undefined ? [decision] : [current, decision]);
    if (best !== null) latest.set(decision.bidId, best);
  }
  return latest;
}

// GET /projects — 보드. 검토 대기 칸과 프로젝트 카드(칸 순서)를 함께 싣는다. 읽기는 모든 업무 역할이 한다.
export async function getProjectBoard(
  ctx: AnalysisContext,
  deps: ProjectDeps,
  now: Date = new Date(),
): Promise<ProjectServiceResult<ProjectBoard>> {
  const [pendingSource, source] = await Promise.all([
    deps.repo.loadPendingSource(ctx.orgId, deps.origin),
    deps.repo.listBoard(ctx.orgId),
  ]);
  const latest = latestByBid(source.decisions);
  const progress = checklistProgressOf(source.checklist);
  const cards = source.projects.map((record) =>
    toProjectCard(
      record,
      latest.get(record.bidId) ?? null,
      progress.get(record.id) ?? { done: 0, total: 0 },
    ),
  );
  return {
    ok: true,
    status: 200,
    data: {
      pending: reviewPendingBids({ bids: pendingSource }, now),
      projects: sortProjectCards(cards, now),
    },
  };
}

// GET /projects/:id — 상세. 다른 조직·없는 id 는 같은 404 다.
export async function getProject(
  ctx: AnalysisContext,
  id: string,
  deps: ProjectDeps,
): Promise<ProjectServiceResult<ProjectDetail>> {
  if (!isUuid(id)) return notFound("project");
  const detail = await detailOf(ctx, id, deps);
  return detail === null ? notFound("project") : { ok: true, status: 200, data: detail };
}

// POST /projects {reviewId} — 열기(201)·다시 열기(200). 조직은 DB 함수가 세션으로 정한다.
export async function openProject(
  ctx: AnalysisContext,
  input: unknown,
  deps: ProjectDeps,
): Promise<ProjectServiceResult<ProjectDetail>> {
  if (!canManageProjects(ctx.role)) return forbidden();
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) return invalidBody(parsed.error);
  const { reviewId } = parsed.data;

  const opened = await deps.repo.openProject(reviewId);
  if (!opened.ok) return fromDb(opened, { missing: "review", reviewId });
  const detail = await detailOf(ctx, opened.value.projectId, deps);
  if (detail === null) return notFound("project");
  return { ok: true, status: opened.value.reopened ? 200 : 201, data: detail };
}

// PATCH /projects/:id — 상태(+메모)·담당자·제출 마감. 상태를 먼저 바꾸고(거절되면 아무것도 안 바뀐다) 그다음 열을 고친다.
export async function updateProject(
  ctx: AnalysisContext,
  id: string,
  input: unknown,
  deps: ProjectDeps,
): Promise<ProjectServiceResult<ProjectDetail>> {
  if (!canManageProjects(ctx.role)) return forbidden();
  const parsed = projectPatchSchema.safeParse(input);
  if (!parsed.success) return invalidBody(parsed.error);
  const { status, note, ownerId, submissionDueOverride } = parsed.data;
  if (!isUuid(id)) return notFound("project");

  const { repo } = deps;
  const ref = await repo.findRef(ctx.orgId, id);
  if (ref === null) return notFound("project");
  if (typeof ownerId === "string" && !(await repo.isOrgMember(ctx.orgId, ownerId))) {
    return notFound("owner");
  }

  if (status !== undefined) {
    const changed = await repo.changeStatus(id, status, note ?? null);
    if (!changed.ok) return fromDb(changed, { missing: "project", bidId: ref.bidId });
  }

  const changes = {
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(submissionDueOverride === undefined ? {} : { submissionDueOverride }),
  };
  if (Object.keys(changes).length > 0) {
    const saved = await repo.updateFields(ctx.orgId, id, changes);
    if (saved === "missing") return notFound("project");
    if (saved === "owner-not-member") return notFound("owner");
  }

  const detail = await detailOf(ctx, id, deps);
  return detail === null ? notFound("project") : { ok: true, status: 200, data: detail };
}

// POST /projects/:id/result — 결과 기록·덮어쓰기. 상태는 바꾸지 않는다. 결과는 기록용이다(D4).
export async function recordProjectResult(
  ctx: AnalysisContext,
  id: string,
  input: unknown,
  deps: ProjectDeps,
): Promise<ProjectServiceResult<ProjectDetail>> {
  if (!canManageProjects(ctx.role)) return forbidden();
  const parsed = projectResultInputSchema.safeParse(input);
  if (!parsed.success) return invalidBody(parsed.error);
  if (!isUuid(id)) return notFound("project");

  const recorded = await deps.repo.recordResult(id, parsed.data.result, parsed.data.note ?? null);
  if (!recorded.ok) return fromDb(recorded, { missing: "project" });
  const detail = await detailOf(ctx, id, deps);
  return detail === null ? notFound("project") : { ok: true, status: 200, data: detail };
}

// 공고 상세의 들어가기(UI 스펙 §4.3.2). 공고가 없거나 다른 조직이면 404 {resource:"bid"}.
export async function getProjectEntry(
  ctx: AnalysisContext,
  bidId: string,
  deps: Pick<ProjectDeps, "repo">,
): Promise<ProjectServiceResult<ProjectEntryState>> {
  if (!isUuid(bidId)) return notFound("bid");
  const source = await deps.repo.getEntrySource(ctx.orgId, bidId);
  if (source === null) return notFound("bid");
  return {
    ok: true,
    status: 200,
    data: projectEntryOf({
      project: source.project,
      latestDecision: pickLatestDecision(source.decisions),
      bidStatus: source.bidStatus,
      canManage: canManageProjects(ctx.role),
    }),
  };
}

// 대시보드 "진행 중인 입찰 프로젝트" 수(CLOSED 제외).
export function countActiveProjects(
  orgId: string,
  deps: Pick<ProjectDeps, "repo">,
): Promise<number> {
  return deps.repo.countActive(orgId);
}
