import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { nameOf } from "@/server/shared";
import type { AnalysisView } from "./analysis-view.model";
import { bidDetailSchema } from "./bid-detail.model";
import type { BidDetail } from "./bid-detail.model";
import {
  bidListItemSchema,
  bidOriginalSchema,
  bidStatusSchema,
  effectiveStatus,
  extractionStatusSchema,
} from "./bid.model";
import type {
  BidDocument,
  BidListItem,
  BidRevisionSummary,
  Role,
  StructuredRequirement,
} from "./bid.model";
import { notificationSchema } from "./notification.model";
import type { Notification } from "./notification.model";
import { reviewSchema } from "./review.model";
import type { Review } from "./review.model";

export type BidListItemRow = Database["public"]["Views"]["bid_list_items"]["Row"];
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

// 결정 한 건과 결정자·담당자 표시 정보. 결정자가 조직을 떠나면 role 이 null 이다.
export type ReviewRow = Database["public"]["Tables"]["bid_reviews"]["Row"] & {
  reviewer_display_name: string | null;
  reviewer_email: string | null;
  reviewer_role: Role | null;
  assignee_display_name: string | null;
  assignee_email: string | null;
};

// 뷰에는 사전규격 번호가 없어 상세 조회가 bid_notices 에서 따로 덧붙인다.
export type BidDetailNotice = BidListItemRow & { pre_spec_ref?: string | null };

export type BidDetailParts = {
  notice: BidDetailNotice;
  revisions: BidRevisionSummary[];
  latestRevisionBody: unknown;
  documents: BidDocument[];
  structured: StructuredRequirement[];
  extraction: { id: string; status: string; result: unknown } | null;
  latestAnalysis: AnalysisView | null;
  reviews: Review[];
  now: Date;
};

const revisionBodySchema = z.looseObject({
  content: z.string(),
  original: bidOriginalSchema,
});

// 뷰는 모든 열이 null 허용으로 생성된다. 스키마가 필수 열의 null 을 거른다.
function listItemFields(row: BidListItemRow) {
  return {
    id: row.id,
    source: row.source,
    noticeId: row.notice_id,
    title: row.title,
    agency: row.agency,
    stage: row.stage,
    status: row.status,
    budgetKrw: row.budget_krw_text,
    publishedAt: row.published_at,
    deadlineAt: row.deadline_at,
    latestRevision: row.latest_revision,
    planRef: row.plan_ref,
    isDemo: row.is_demo,
    sourceUrl: row.source_url,
    lastSyncedAt: row.last_synced_at,
    origin: row.is_demo === true ? "demo" : "live",
    documentsStatus: {
      total: row.docs_total ?? 0,
      pending: row.docs_pending ?? 0,
      parsed: row.docs_parsed ?? 0,
      partial: row.docs_partial ?? 0,
      unsupported: row.docs_unsupported ?? 0,
      failed: row.docs_failed ?? 0,
      downloadFailed: row.docs_download_failed ?? 0,
    },
    latestReview:
      row.latest_decision === null
        ? null
        : {
            decision: row.latest_decision,
            decidedAt: row.latest_decided_at,
            reviewerName: nameOf(row.latest_reviewer_display_name, row.latest_reviewer_email),
          },
  };
}

export function toBidListItem(row: BidListItemRow): BidListItem {
  return bidListItemSchema.parse({
    ...listItemFields(row),
    latestAnalysis:
      row.latest_run_id === null
        ? null
        : {
            id: row.latest_run_id,
            status: row.latest_run_status,
            solScore: row.latest_run_score === null ? null : Number(row.latest_run_score),
            recommendation: row.latest_run_recommendation,
            recommendationBasis: row.latest_run_basis,
            reviewFlags: row.latest_run_flags ?? [],
            createdAt: row.latest_run_created_at,
          },
  });
}

export function toBidDetail(parts: BidDetailParts): BidDetail {
  const { notice, extraction, now } = parts;
  const body = revisionBodySchema.parse(parts.latestRevisionBody);
  const deadlineAt = notice.deadline_at;
  // 저장된 상태가 OPEN·AMENDED 여도 마감이 지났으면 CLOSED 로 계산한다(ADR-030 B14).
  const status = effectiveStatus(bidStatusSchema.parse(notice.status), deadlineAt, now);
  return bidDetailSchema.parse({
    ...listItemFields(notice),
    status,
    content: body.content,
    original: body.original,
    revisions: parts.revisions,
    documents: parts.documents,
    stageLinks: { planRef: notice.plan_ref, preSpecRef: notice.pre_spec_ref ?? null },
    structuredQualifications: parts.structured,
    extraction: extraction === null ? null : extraction.result,
    extractionStatus: extractionStatusSchema.parse(
      extraction === null ? "NONE" : extraction.status,
    ),
    latestAnalysis: parts.latestAnalysis,
    reviews: parts.reviews,
  });
}

export function toReview(row: ReviewRow): Review {
  return reviewSchema.parse({
    id: row.id,
    bidId: row.bid_id,
    revisionId: row.revision_id,
    scoreRunId: row.score_run_id,
    reviewer: {
      id: row.reviewer_id,
      name: nameOf(row.reviewer_display_name, row.reviewer_email),
      role: row.reviewer_role,
    },
    decision: row.decision,
    reason: row.reason,
    decidedAt: row.decided_at,
    assignee:
      row.assignee_id === null
        ? null
        : { id: row.assignee_id, name: nameOf(row.assignee_display_name, row.assignee_email) },
    systemRecommendationAtDecision: row.system_recommendation,
    disagreementFlag: row.disagreement_flag,
  });
}

// 알려진 모양이 아닌 알림은 목록에서 뺀다(O11). 호출자가 null 을 걸러 낸다.
export function toNotification(row: NotificationRow): Notification | null {
  const parsed = notificationSchema.safeParse({
    id: row.id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    payload: row.payload,
    readAt: row.read_at,
    createdAt: row.created_at,
  });
  return parsed.success ? parsed.data : null;
}
