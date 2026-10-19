import "server-only";
import { canonicalJson, finalizeRevision } from "./checksum";
import type { NormalizedBid, NormalizedBidDraft } from "./normalized-bid.model";
import { sourceKeyOf } from "./validation";

// ── 07 §4·§5 이력 연결·변경 감지: 이전 revision 과 새 draft 로 저장·이벤트·재분석을 정한다 ──
export type StoredRevision = {
  bidId: string;
  revision: number;
  checksum: string;
  normalized: NormalizedBid;
};

// 화면의 "무엇이 바뀌었나" 에 보일 필드. original·normalizationNotes 는 감사용이라 diff 에 넣지 않는다.
export const TRACKED_FIELDS = [
  "amendmentNo",
  "planRef",
  "preSpecRef",
  "stage",
  "status",
  "title",
  "agency",
  "budgetKrw",
  "noticeDate",
  "deadlineAt",
  "sourceUrl",
  "content",
  "attachments",
  "structuredQualifications",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type FieldChange = { field: TrackedField; before: unknown; after: unknown };

export type BidEventType = "BID_CREATED" | "BID_CHANGED";
export type BidEvent = { type: BidEventType; idempotencyKey: string };

export type ChangeDecision =
  | {
      kind: "CREATED";
      bid: NormalizedBid;
      changes: FieldChange[];
      event: BidEvent;
      reanalyze: boolean;
    }
  | {
      kind: "CHANGED";
      bid: NormalizedBid;
      changes: FieldChange[];
      event: BidEvent;
      reanalyze: boolean;
    }
  | {
      kind: "CANCELLED";
      bid: NormalizedBid;
      changes: FieldChange[];
      event: BidEvent;
      reanalyze: false;
    }
  | { kind: "DUPLICATE"; revision: number };

export function diffRevisions(
  before: NormalizedBidDraft,
  after: NormalizedBidDraft,
): FieldChange[] {
  return TRACKED_FIELDS.flatMap((field) => {
    // 선택 키가 없는 것과 null 은 같은 "값 없음" 으로 본다.
    const previous: unknown = before[field] ?? null;
    const next: unknown = after[field] ?? null;
    return canonicalJson(previous) === canonicalJson(next)
      ? []
      : [{ field, before: previous, after: next }];
  });
}

// 13 알림 멱등키 source + noticeId + revision + eventType. 재시도해도 같은 이벤트는 한 번만 나간다.
const eventOf = (bid: NormalizedBid, type: BidEventType): BidEvent => ({
  type,
  idempotencyKey: `${sourceKeyOf(bid.source, bid.noticeId)}:${bid.revision}:${type}`,
});

export function decideRevision(
  previous: StoredRevision | null,
  draft: NormalizedBidDraft,
): ChangeDecision {
  if (previous === null) {
    const bid = finalizeRevision(draft, 1);
    return {
      kind: "CREATED",
      bid,
      changes: [],
      event: eventOf(bid, "BID_CREATED"),
      reanalyze: bid.status !== "CANCELLED",
    };
  }

  // 같은 revision 번호로 확정했을 때 checksum 이 같으면 수집 시각만 다른 같은 공고다(FX-09).
  if (finalizeRevision(draft, previous.revision).checksum === previous.checksum) {
    return { kind: "DUPLICATE", revision: previous.revision };
  }

  const bid = finalizeRevision(draft, previous.revision + 1);
  const changes = diffRevisions(previous.normalized, bid);
  const event = eventOf(bid, "BID_CHANGED");

  // 취소는 새 분석을 돌리지 않는다. 기존 score_runs·bid_reviews 를 지우지 않는 것은 저장 쪽 몫이다.
  if (bid.status === "CANCELLED" && previous.normalized.status !== "CANCELLED") {
    return { kind: "CANCELLED", bid, changes, event, reanalyze: false };
  }
  return { kind: "CHANGED", bid, changes, event, reanalyze: bid.status !== "CANCELLED" };
}
