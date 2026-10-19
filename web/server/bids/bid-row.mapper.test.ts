import { describe, expect, it } from "vitest";
import { toBidDetail, toBidListItem, toNotification, toReview } from "./bid-row.mapper";
import type { BidListItemRow, NotificationRow, ReviewRow } from "./bid-row.mapper";

const T0 = "2026-10-16T00:00:00Z";

function listRow(patch: Partial<BidListItemRow> = {}): BidListItemRow {
  return {
    id: "bid-1",
    source: "G2B",
    notice_id: "N-1",
    title: "공고",
    agency: "기관",
    stage: "NOTICE",
    status: "OPEN",
    budget_krw: 1200000000,
    budget_krw_text: "1200000000",
    published_at: T0,
    deadline_at: "2026-12-01T00:00:00Z",
    latest_revision: 1,
    plan_ref: null,
    is_demo: true,
    source_url: "https://example.com/n1",
    last_synced_at: T0,
    docs_total: 2,
    docs_pending: 0,
    docs_parsed: 1,
    docs_partial: 0,
    docs_unsupported: 0,
    docs_failed: 1,
    docs_download_failed: 0,
    latest_run_id: "run-1",
    latest_run_status: "COMPLETED",
    latest_run_score: 94,
    latest_run_recommendation: "BID",
    latest_run_basis: "RULES_ONLY",
    latest_run_flags: ["KEV_NEEDS_REVIEW"],
    latest_run_created_at: T0,
    scored_recommendation: "BID",
    scored_score: 94,
    latest_decision: "BID",
    latest_decided_at: T0,
    latest_reviewer_display_name: "홍길동",
    latest_reviewer_email: "hong@example.com",
    ...patch,
  };
}

describe("toBidListItem", () => {
  it("budget_krw_text 를 문자열 그대로 싣고 demo 는 origin 으로 옮긴다", () => {
    const item = toBidListItem(listRow());
    expect(item.budgetKrw).toBe("1200000000");
    expect(item.origin).toBe("demo");
    expect(item.latestAnalysis).toEqual({
      id: "run-1",
      status: "COMPLETED",
      solScore: 94,
      recommendation: "BID",
      recommendationBasis: "RULES_ONLY",
      reviewFlags: ["KEV_NEEDS_REVIEW"],
      createdAt: T0,
    });
    expect(item.latestReview?.reviewerName).toBe("홍길동");
  });

  it("is_demo=false 면 live 이고 다운로드 실패 수를 옮긴다", () => {
    const item = toBidListItem(listRow({ is_demo: false, docs_download_failed: 1 }));
    expect(item.origin).toBe("live");
    expect(item.isDemo).toBe(false);
    expect(item.documentsStatus.downloadFailed).toBe(1);
  });

  it("분석이 없으면 latestAnalysis 가 null 이고 이름이 없으면 이메일 앞부분을 쓴다", () => {
    const item = toBidListItem(
      listRow({ latest_run_id: null, latest_reviewer_display_name: null }),
    );
    expect(item.latestAnalysis).toBeNull();
    expect(item.latestReview?.reviewerName).toBe("hong");
  });

  it("결정이 없으면 latestReview 가 null 이다", () => {
    expect(toBidListItem(listRow({ latest_decision: null })).latestReview).toBeNull();
  });
});

describe("toBidDetail", () => {
  const parts = (notice: BidListItemRow, now: Date) => ({
    notice,
    revisions: [],
    latestRevisionBody: { content: "본문", original: { noticeNo: "N-1" }, extra: 1 },
    documents: [],
    structured: [],
    extraction: null,
    latestAnalysis: null,
    reviews: [],
    now,
  });

  it("마감이 지난 OPEN 은 CLOSED 로 계산한다", () => {
    const detail = toBidDetail(
      parts(listRow({ deadline_at: "2026-10-01T00:00:00Z" }), new Date(T0)),
    );
    expect(detail.status).toBe("CLOSED");
    expect(detail.content).toBe("본문");
    expect(detail.original).toEqual({ noticeNo: "N-1" });
    expect(detail.extractionStatus).toBe("NONE");
    expect(detail.extraction).toBeNull();
  });

  it("마감 전이면 저장 상태를 그대로 쓴다", () => {
    expect(toBidDetail(parts(listRow(), new Date(T0))).status).toBe("OPEN");
  });

  it("추출 결과를 싣는다", () => {
    const detail = toBidDetail({
      ...parts(listRow(), new Date(T0)),
      extraction: { id: "e1", status: "COMPLETED", result: { a: 1 } },
    });
    expect(detail.extractionStatus).toBe("COMPLETED");
    expect(detail.extraction).toEqual({ a: 1 });
  });
});

describe("toReview", () => {
  const row: ReviewRow = {
    id: "rv1",
    org_id: "org-1",
    bid_id: "bid-1",
    revision_id: "r1",
    score_run_id: "run-1",
    reviewer_id: "u1",
    decision: "BID",
    reason: "적합",
    decided_at: T0,
    created_at: T0,
    assignee_id: null,
    system_recommendation: "WATCH",
    disagreement_flag: true,
    reviewer_display_name: null,
    reviewer_email: "kim@example.com",
    reviewer_role: null,
    assignee_display_name: null,
    assignee_email: null,
  };

  it("조직을 떠난 결정자는 role 이 null 이다", () => {
    const review = toReview(row);
    expect(review.reviewer).toEqual({ id: "u1", name: "kim", role: null });
    expect(review.assignee).toBeNull();
    expect(review.disagreementFlag).toBe(true);
  });

  it("담당자 이름을 옮긴다", () => {
    const review = toReview({
      ...row,
      reviewer_role: "SALES",
      assignee_id: "u2",
      assignee_display_name: "박",
    });
    expect(review.reviewer.role).toBe("SALES");
    expect(review.assignee).toEqual({ id: "u2", name: "박" });
  });
});

describe("toNotification", () => {
  const row: NotificationRow = {
    id: "n1",
    org_id: "org-1",
    user_id: "u1",
    type: "BID_CREATED",
    channel: "IN_APP",
    status: "SENT",
    idempotency_key: "k",
    payload: { bidId: "bid-1", title: "t", message: "m", link: "/bids/bid-1" },
    read_at: null,
    sent_at: T0,
    created_at: T0,
    error: null,
    provider_message_id: null,
  };

  it("올바른 알림은 DTO 로 옮긴다", () => {
    expect(toNotification(row)).toMatchObject({ id: "n1", readAt: null, createdAt: T0 });
  });
  it("payload 가 비었거나 type 을 모르면 null 이다", () => {
    expect(toNotification({ ...row, payload: {} })).toBeNull();
    expect(toNotification({ ...row, type: "UNKNOWN" })).toBeNull();
  });
});
