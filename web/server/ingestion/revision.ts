import "server-only";
import {
  canonicalJson,
  computeBidChecksum,
  finalizeRevision,
  revisionSourceMetadata,
} from "./checksum";
import {
  EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
  type NormalizedBid,
  type NormalizedBidDraft,
} from "./normalized-bid.model";
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
export type TrackedField = (typeof TRACKED_FIELDS)[number] | "sourceMetadata";

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
  | { kind: "DUPLICATE"; revision: number }
  // 이미 더 새 차수가 저장된 공고의 이전 차수(5-E). 저장·이벤트 없음
  | { kind: "STALE"; revision: number; amendmentNo: string };

const AMENDMENT_NUMBER = /^\d+$/;

/** 둘 다 숫자 차수이고 draft 가 더 작을 때만 이전 차수다. 숫자로 비교해 '9' < '10' 이다. */
export function isOlderAmendment(
  draftAmendmentNo: string | undefined,
  latestAmendmentNo: string | undefined,
): boolean {
  if (draftAmendmentNo === undefined || latestAmendmentNo === undefined) return false;
  if (!AMENDMENT_NUMBER.test(draftAmendmentNo) || !AMENDMENT_NUMBER.test(latestAmendmentNo)) {
    return false;
  }
  return Number(draftAmendmentNo) < Number(latestAmendmentNo);
}

/**
 * 5-C: 레코드에 status 가 없는 fixture 공고는 revision 2 부터 정정(AMENDED)이다. live 의 변경공고 → AMENDED 와 뜻을 맞춘다.
 * 정규화는 revision 을 모르므로 revision 을 확정하는 여기서 정한다. 레코드에 status 가 있으면(FX-08 CANCELLED) 그 값을 쓴다.
 */
export function statusForRevision(draft: NormalizedBidDraft, revision: number): NormalizedBidDraft {
  const hasRecordStatus = draft.original.status !== undefined;
  if (draft.source !== "fixture" || hasRecordStatus || revision < 2) return draft;
  return { ...draft, status: "AMENDED" };
}

const finalizeAt = (draft: NormalizedBidDraft, revision: number): NormalizedBid =>
  finalizeRevision(statusForRevision(draft, revision), revision);

export function diffRevisions(
  before: NormalizedBidDraft,
  after: NormalizedBidDraft,
): FieldChange[] {
  // 기존 v0.2 변경 목록은 유지하고 v0.3 공급자 메타데이터의 변경 근거를 더한다.
  const fields: readonly TrackedField[] =
    before.schemaVersion === EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION ||
    after.schemaVersion === EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION
      ? [...TRACKED_FIELDS, "sourceMetadata"]
      : TRACKED_FIELDS;
  return fields.flatMap((field) => {
    // 선택 키가 없는 것과 null 은 같은 "값 없음" 으로 본다.
    const previous: unknown =
      field === "sourceMetadata" ? revisionSourceMetadata(before) : (before[field] ?? null);
    const next: unknown =
      field === "sourceMetadata" ? revisionSourceMetadata(after) : (after[field] ?? null);
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
    const bid = finalizeAt(draft, 1);
    return {
      kind: "CREATED",
      bid,
      changes: [],
      event: eventOf(bid, "BID_CREATED"),
      reanalyze: bid.status !== "CANCELLED",
    };
  }

  // 한 창에 같은 공고의 000·001 이 함께 온다(실측). 최신하고만 비교하면 다시 받을 때마다 둘이 번갈아 새 revision 이 된다.
  const draftAmendmentNo = draft.amendmentNo;
  if (
    draftAmendmentNo !== undefined &&
    isOlderAmendment(draftAmendmentNo, previous.normalized.amendmentNo)
  ) {
    return { kind: "STALE", revision: previous.revision, amendmentNo: draftAmendmentNo };
  }

  // v0.3의 구 hash에도 participationStatus가 들어 있다. 저장 스냅샷을 같은 정책으로
  // 메모리에서만 다시 계산해 정책 전환만으로 revision을 만들지 않는다. v0.2 비교는 그대로다.
  const previousChecksum =
    previous.normalized.schemaVersion === EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION
      ? computeBidChecksum(previous.normalized)
      : previous.checksum;
  if (finalizeAt(draft, previous.revision).checksum === previousChecksum) {
    return { kind: "DUPLICATE", revision: previous.revision };
  }

  const bid = finalizeAt(draft, previous.revision + 1);
  const changes = diffRevisions(previous.normalized, bid);
  const event = eventOf(bid, "BID_CHANGED");

  // 취소는 새 분석을 돌리지 않는다. 기존 score_runs·bid_reviews 를 지우지 않는 것은 저장 쪽 몫이다.
  if (bid.status === "CANCELLED" && previous.normalized.status !== "CANCELLED") {
    return { kind: "CANCELLED", bid, changes, event, reanalyze: false };
  }
  return { kind: "CHANGED", bid, changes, event, reanalyze: bid.status !== "CANCELLED" };
}
