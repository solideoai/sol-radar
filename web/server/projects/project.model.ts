import "server-only";
import { z } from "zod";
import {
  compareDueOrder,
  type BidStatus,
  type PendingBidCard,
  type Recommendation,
} from "@/server/bids";
import type { SolRole } from "@/server/organization";
import type { TaskView } from "@/server/task";

// ── 입찰 프로젝트(P1 N6) 모델: 순수 타입과 규칙. 저장·화면을 모른다 ──
// 화면용 꼴은 UI 스펙(docs/plans/2026-10-21-n6-bid-projects-ui-spec.md) §4.0 의 이름을 그대로 쓴다.
// 실효 마감·경고 셋·다시 열기 가능·칸 안 순서는 여기서 정하고 화면은 계산하지 않는다.
// 결과(result)는 기록용이다. 점수·결정 모델·평가셋·학습셋에 쓰지 않는다(D4, isolation.test.ts 가 구조로 막는다).

export const PROJECT_STATUSES = ["PREPARING", "SUBMITTED", "AWAITING_RESULT", "CLOSED"] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const PROJECT_RESULTS = ["WON", "LOST", "CANCELLED", "NOT_SUBMITTED"] as const;
export const projectResultSchema = z.enum(PROJECT_RESULTS);
export type ProjectResult = z.infer<typeof projectResultSchema>;

export type { PendingBidCard };

export type ProjectWarnings = {
  // 최신 결정이 BID 가 아니면 그 값, BID 면 null
  latestDecision: Recommendation | null;
  // 여는 결정의 revision ≠ 공고 최신 revision
  bidAmended: boolean;
  // 공고 status = CANCELLED
  bidCancelled: boolean;
};

export type ProjectCard = {
  id: string;
  bidId: string;
  title: string;
  agency: string | null;
  isDemo: boolean;
  status: ProjectStatus;
  // submission_due_override ?? 공고 deadline_at
  effectiveDueAt: string | null;
  dueOverridden: boolean;
  owner: { id: string; name: string } | null;
  checklist: { done: number; total: number };
  // 열린 프로젝트에만 채운다(U13). 종료면 모두 꺼져 있다.
  warnings: ProjectWarnings;
  result: ProjectResult | null;
  closedAt: string | null;
};

export type ProjectBoard = { pending: PendingBidCard[]; projects: ProjectCard[] };

export type ProjectEvent = {
  id: string;
  // 행위자가 조직을 떠났거나 계정이 지워졌으면 null(화면은 "조직을 떠난 사용자")
  actor: string | null;
  from: ProjectStatus | null;
  to: ProjectStatus;
  note: string | null;
  createdAt: string;
};

export type ProjectAnalysisSummary = {
  finishedAt: string;
  solScore: number | null;
  recommendation: Recommendation | null;
  algorithmVersion: string;
  inputSnapshotHash: string | null;
};

export type ProjectOpenedBy = {
  reviewId: string;
  reviewer: string;
  decidedAt: string;
  revision: number;
  // 그 결정이 가리킨 분석. 결정에 분석이 없으면 null
  analysis: ProjectAnalysisSummary | null;
};

// 상세. 카드의 checklist(진행 수)는 checklistProgress 로 옮기고 checklist 에는 항목 줄을 싣는다.
export type ProjectDetail = Omit<ProjectCard, "checklist"> & {
  checklistProgress: ProjectCard["checklist"];
  bid: { id: string; noticeId: string; deadlineAt: string | null; latestRevision: number };
  submissionDueOverride: string | null;
  resultNote: string | null;
  resultRecordedAt: string | null;
  openedBy: ProjectOpenedBy;
  latestDecision: { decision: Recommendation; reviewer: string; decidedAt: string };
  // 새것부터
  events: ProjectEvent[];
  // 템플릿 TaskView(만든 순). canDelete 는 역할(ADMIN·SALES)로 정해져 있다.
  checklist: TaskView[];
  // sol_role ∈ {ADMIN, SALES}
  canManage: boolean;
  // CLOSED 이고 최신 결정이 closedAt 뒤의 BID
  reopenAvailable: boolean;
};

// 공고 상세 들어가기(UI 스펙 §4.3.2)의 상태. latestReviewId 는 판단에 쓴 최신 결정 id(만들기·다시 열기 POST 본문)다.
export type ProjectEntryState =
  | { state: "hidden"; latestReviewId: string | null }
  | { state: "create"; latestReviewId: string }
  | {
      state: "open";
      latestReviewId: string | null;
      project: { id: string; status: ProjectStatus };
      latestDecisionNotBid: Recommendation | null;
    }
  | {
      state: "closed";
      latestReviewId: string | null;
      project: { id: string; result: ProjectResult | null; closedAt: string | null };
      canManage: boolean;
    }
  | {
      state: "reopen";
      latestReviewId: string;
      project: { id: string; result: ProjectResult | null; closedAt: string | null };
    };

// ── 저장이 돌려주는 원천(저장 포트 project.repo.ts 가 이 꼴로 준다) ──

export type ProjectBidRecord = {
  id: string;
  title: string;
  agency: string | null;
  noticeId: string;
  deadlineAt: string | null;
  isDemo: boolean;
  // 저장된 값 그대로(취소 여부를 본다)
  status: BidStatus;
  latestRevision: number;
};

export type ProjectRecord = {
  id: string;
  bidId: string;
  status: ProjectStatus;
  owner: { id: string; name: string } | null;
  submissionDueOverride: string | null;
  result: ProjectResult | null;
  resultNote: string | null;
  resultRecordedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  openedByReviewId: string;
  // 여는 결정이 가리킨 공고 revision 번호
  openedRevision: number;
  bid: ProjectBidRecord;
};

export type DecisionRecord = {
  id: string;
  bidId: string;
  decision: Recommendation;
  decidedAt: string;
  createdAt: string;
  reviewer: string;
};

export type ProjectDetailRecord = ProjectRecord & {
  openedBy: ProjectOpenedBy;
  // 이 조직이 이 공고에 남긴 결정 전부. 최신 고르기는 pickLatestDecision 이 한다.
  decisions: DecisionRecord[];
  events: ProjectEvent[];
};

export type ChecklistStatusRow = { bidProjectId: string; status: string };

// ── 권한 ──

export const MANAGE_PROJECT_ROLES: readonly SolRole[] = ["ADMIN", "SALES"];
export const canManageProjects = (role: SolRole): boolean => MANAGE_PROJECT_ROLES.includes(role);

// ── 입력 규칙 (05 §2 /projects). 같은 규칙을 DB 제약·함수가 한 번 더 지킨다 ──

// bid_project_events.note·bid_projects.result_note check 와 같은 길이다.
export const PROJECT_NOTE_MAX = 500;
export const RESULT_NOTE_MAX = 2000;

const noteSchema = (max: number) =>
  z
    .string("메모는 글자여야 합니다")
    .trim()
    .min(1, "메모를 입력하세요")
    .max(max, `메모는 ${max}자 이하입니다`);

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// 시간대가 있는 ISO 시각은 그대로, 없는 값(datetime-local)은 한국 시각으로 읽어 UTC ISO 로 바꾼다.
const dueOverrideSchema = z.iso
  .datetime({ offset: true, local: true, message: "제출 마감은 날짜와 시각이어야 합니다" })
  .refine((value) => !value.startsWith("0000"), "제출 마감은 날짜와 시각이어야 합니다")
  .transform((value, ctx) => {
    const instant = Date.parse(HAS_ZONE.test(value) ? value : `${value}+09:00`);
    if (Number.isNaN(instant)) {
      ctx.addIssue({ code: "custom", message: "제출 마감은 날짜와 시각이어야 합니다" });
      return z.NEVER;
    }
    return new Date(instant).toISOString();
  });

export const createProjectInputSchema = z.strictObject({
  reviewId: z.uuid("결정 id 형식이 아닙니다"),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const projectPatchSchema = z
  .strictObject({
    status: projectStatusSchema.optional(),
    note: noteSchema(PROJECT_NOTE_MAX).optional(),
    ownerId: z.uuid("담당자 id 형식이 아닙니다").nullable().optional(),
    submissionDueOverride: dueOverrideSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === undefined &&
      value.ownerId === undefined &&
      value.submissionDueOverride === undefined
    ) {
      ctx.addIssue({ code: "custom", path: [], message: "바꿀 값이 없습니다" });
    }
    if (value.note !== undefined && value.status === undefined) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "메모는 상태와 함께 보냅니다" });
    }
  });
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

export const projectResultInputSchema = z.strictObject({
  result: projectResultSchema,
  note: noteSchema(RESULT_NOTE_MAX).optional(),
});
export type ProjectResultInput = z.infer<typeof projectResultInputSchema>;

// ── 규칙 ──

export const effectiveDueAt = (bidDeadlineAt: string | null, override: string | null) =>
  override ?? bidDeadlineAt;

// 앞으로 한 칸·뒤로 한 칸·종료(D3·M12). AWAITING_RESULT 의 앞으로 한 칸은 종료다. CLOSED 에서는 PATCH 로 나가지 못한다.
export function nextStatuses(status: ProjectStatus): {
  forward: ProjectStatus | null;
  back: ProjectStatus | null;
  canClose: boolean;
} {
  switch (status) {
    case "PREPARING":
      return { forward: "SUBMITTED", back: null, canClose: true };
    case "SUBMITTED":
      return { forward: "AWAITING_RESULT", back: "PREPARING", canClose: true };
    case "AWAITING_RESULT":
      return { forward: "CLOSED", back: "SUBMITTED", canClose: true };
    case "CLOSED":
      return { forward: null, back: null, canClose: false };
  }
}

const NO_WARNINGS: ProjectWarnings = {
  latestDecision: null,
  bidAmended: false,
  bidCancelled: false,
};

// 경고는 열린 프로젝트에만 싣는다(U13). 종료 뒤의 결정·정정은 진행을 막지 않는다.
export function warningsOf(input: {
  status: ProjectStatus;
  latestDecision: Recommendation | null;
  openedRevision: number;
  latestRevision: number;
  bidStatus: BidStatus;
}): ProjectWarnings {
  if (input.status === "CLOSED") return NO_WARNINGS;
  return {
    latestDecision:
      input.latestDecision !== null && input.latestDecision !== "BID" ? input.latestDecision : null,
    bidAmended: input.openedRevision !== input.latestRevision,
    bidCancelled: input.bidStatus === "CANCELLED",
  };
}

// 최신 결정은 decided_at desc, created_at desc, id desc 의 첫 행이다(DB 함수 open_bid_project·change_bid_project_status 와 같다).
export function pickLatestDecision<
  T extends Pick<DecisionRecord, "id" | "decidedAt" | "createdAt">,
>(decisions: readonly T[]): T | null {
  const later = (a: T, b: T): boolean => {
    const byDecided = Date.parse(a.decidedAt) - Date.parse(b.decidedAt);
    if (byDecided !== 0) return byDecided > 0;
    const byCreated = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (byCreated !== 0) return byCreated > 0;
    return a.id > b.id;
  };
  return decisions.reduce<T | null>(
    (best, decision) => (best === null || later(decision, best) ? decision : best),
    null,
  );
}

export function checklistProgressOf(
  rows: readonly ChecklistStatusRow[],
): ReadonlyMap<string, { done: number; total: number }> {
  const progress = new Map<string, { done: number; total: number }>();
  for (const row of rows) {
    const current = progress.get(row.bidProjectId) ?? { done: 0, total: 0 };
    progress.set(row.bidProjectId, {
      done: current.done + (row.status === "done" ? 1 : 0),
      total: current.total + 1,
    });
  }
  return progress;
}

// 종료 뒤에 내린 BID 결정이 최신이면 공고 상세에서 다시 열 수 있다(M12 ③). 같은 시각은 종료 전이다(DB 함수와 같다).
export function reopenAvailableOf(input: {
  status: ProjectStatus;
  closedAt: string | null;
  latestDecision: Pick<DecisionRecord, "decision" | "decidedAt"> | null;
}): boolean {
  const { status, closedAt, latestDecision } = input;
  if (status !== "CLOSED" || closedAt === null || latestDecision === null) return false;
  return (
    latestDecision.decision === "BID" && Date.parse(latestDecision.decidedAt) > Date.parse(closedAt)
  );
}

export function projectEntryOf(input: {
  project: {
    id: string;
    status: ProjectStatus;
    closedAt: string | null;
    result: ProjectResult | null;
  } | null;
  latestDecision: Pick<DecisionRecord, "id" | "decision" | "decidedAt"> | null;
  bidStatus: BidStatus;
  canManage: boolean;
}): ProjectEntryState {
  const { project, latestDecision, bidStatus, canManage } = input;
  const latestReviewId = latestDecision?.id ?? null;
  if (project === null) {
    // 취소된 공고에서는 만들기를 그리지 않는다(UI 스펙 §11-4 추천안. DB 함수는 취소를 보지 않는다).
    const canCreate =
      latestDecision !== null &&
      latestDecision.decision === "BID" &&
      canManage &&
      bidStatus !== "CANCELLED";
    return canCreate
      ? { state: "create", latestReviewId: latestDecision.id }
      : { state: "hidden", latestReviewId };
  }
  if (project.status !== "CLOSED") {
    return {
      state: "open",
      latestReviewId,
      project: { id: project.id, status: project.status },
      latestDecisionNotBid:
        latestDecision !== null && latestDecision.decision !== "BID"
          ? latestDecision.decision
          : null,
    };
  }
  const closed = { id: project.id, result: project.result, closedAt: project.closedAt };
  if (
    canManage &&
    latestDecision !== null &&
    reopenAvailableOf({ status: project.status, closedAt: project.closedAt, latestDecision })
  ) {
    return { state: "reopen", latestReviewId: latestDecision.id, project: closed };
  }
  return { state: "closed", latestReviewId, project: closed, canManage };
}

export function toProjectCard(
  record: ProjectRecord,
  latestDecision: Pick<DecisionRecord, "decision"> | null,
  checklist: { done: number; total: number },
): ProjectCard {
  return {
    id: record.id,
    bidId: record.bidId,
    title: record.bid.title,
    agency: record.bid.agency,
    isDemo: record.bid.isDemo,
    status: record.status,
    effectiveDueAt: effectiveDueAt(record.bid.deadlineAt, record.submissionDueOverride),
    dueOverridden: record.submissionDueOverride !== null,
    owner: record.owner,
    checklist,
    warnings: warningsOf({
      status: record.status,
      latestDecision: latestDecision?.decision ?? null,
      openedRevision: record.openedRevision,
      latestRevision: record.bid.latestRevision,
      bidStatus: record.bid.status,
    }),
    result: record.result,
    closedAt: record.closedAt,
  };
}

const STATUS_ORDER: Record<ProjectStatus, number> = {
  PREPARING: 0,
  SUBMITTED: 1,
  AWAITING_RESULT: 2,
  CLOSED: 3,
};

// 칸 안 순서(UI 스펙 U18): 열린 칸은 실효 마감 가까운 순(지난 마감·마감 없음 뒤, 같으면 제목 가나다),
// 종료 칸은 종료 최근 순. 상태 순서로 먼저 묶으므로 화면이 칸으로 나눠도 순서가 그대로다.
export function sortProjectCards(cards: readonly ProjectCard[], now: Date): ProjectCard[] {
  const nowMs = now.getTime();
  return cards.toSorted((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.status === "CLOSED") {
      const byClosed = Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "");
      if (!Number.isNaN(byClosed) && byClosed !== 0) return byClosed;
      return a.title.localeCompare(b.title, "ko") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }
    return compareDueOrder(
      { id: a.id, dueAt: a.effectiveDueAt, title: a.title },
      { id: b.id, dueAt: b.effectiveDueAt, title: b.title },
      nowMs,
    );
  });
}

const newestFirst = (a: ProjectEvent, b: ProjectEvent): number =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function toProjectDetail(
  record: ProjectDetailRecord,
  checklist: TaskView[],
  canManage: boolean,
): ProjectDetail {
  const latest = pickLatestDecision(record.decisions);
  // 여는 결정이 같은 조직의 결정을 가리키고(복합 외래 키) 결정은 지워지지 않는다. 없으면 저장과 코드가 어긋난 것이다.
  if (latest === null) throw new Error(`입찰 프로젝트 ${record.id} 의 최신 결정을 찾지 못했습니다`);
  const { checklist: progress, ...card } = toProjectCard(record, latest, {
    done: checklist.filter((item) => item.status === "done").length,
    total: checklist.length,
  });
  return {
    ...card,
    checklistProgress: progress,
    bid: {
      id: record.bid.id,
      noticeId: record.bid.noticeId,
      deadlineAt: record.bid.deadlineAt,
      latestRevision: record.bid.latestRevision,
    },
    submissionDueOverride: record.submissionDueOverride,
    resultNote: record.resultNote,
    resultRecordedAt: record.resultRecordedAt,
    openedBy: record.openedBy,
    latestDecision: {
      decision: latest.decision,
      reviewer: latest.reviewer,
      decidedAt: latest.decidedAt,
    },
    events: record.events.toSorted(newestFirst),
    checklist,
    canManage,
    reopenAvailable: reopenAvailableOf({
      status: record.status,
      closedAt: record.closedAt,
      latestDecision: latest,
    }),
  };
}
